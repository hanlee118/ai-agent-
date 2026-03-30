import { ROLE_LABELS, type RoleType } from "@occ/shared";
import { previewRequirement } from "../utils/project-parser.js";
import { runStageAgent, getRuntimeStatus } from "../agents/runtime.js";

export interface IssueDebateOpinion {
  id: string;
  roleId: RoleType;
  roleLabel: string;
  focus: string;
  concern: string;
  proposal: string;
  provider: string;
  model: string;
  elapsedMs: number;
  mode: "model" | "scripted" | "fallback";
  rawPreview: string;
}

export interface IssueDebateResult {
  mode: "model" | "fallback";
  generatedAt: string;
  consensus: string[];
  divergences: string[];
  opinions: IssueDebateOpinion[];
  note?: string;
}

interface BuildIssueDebateInput {
  input: string;
  title: string;
  summary: string;
  recommendedRoleIds: RoleType[];
  soulRoleId: RoleType;
  industryCode: string;
}

const THEME_RULES: Array<{ id: string; label: string; keywords: string[] }> = [
  { id: "scope", label: "范围应先收敛到可交付 MVP", keywords: ["mvp", "范围", "收敛", "首期", "二期", "边界"] },
  { id: "metrics", label: "验收标准需要量化", keywords: ["验收", "指标", "时效", "命中率", "量化", "kpi"] },
  { id: "evidence", label: "输出应包含证据链与可追溯信息", keywords: ["证据", "可追溯", "来源", "依据", "审计"] },
  { id: "alerting", label: "需要告警机制与及时反馈", keywords: ["告警", "预警", "实时", "及时", "通知"] },
  { id: "workflow", label: "先澄清后执行，减少返工风险", keywords: ["澄清", "确认", "返工", "依赖", "阶段"] }
];

const FALLBACK_FOCUS: Record<RoleType, string> = {
  ROLE_ASSISTANT: "协同编排与待办收敛",
  ROLE_PM: "里程碑与推进节奏",
  ROLE_ANALYST: "需求理解与边界识别",
  ROLE_PRODUCT: "价值定义与决策口径",
  ROLE_DESIGN: "决策界面与信息可读性",
  ROLE_ARCH: "数据链路与架构约束",
  ROLE_DEV: "可实现性与交付节奏",
  ROLE_QA: "验收标准与质量门禁",
  ROLE_HR: "协作资源与组织节奏"
};

function normalizeText(input: string) {
  return String(input || "").replace(/\s+/g, " ").trim();
}

function cleanMarkdownLine(line: string) {
  return String(line || "")
    .replace(/^[-*]\s+/, "")
    .replace(/^[#]+\s*/, "")
    .replace(/`/g, "")
    .trim();
}

function pickLineByPrefixes(lines: string[], prefixes: string[]) {
  const found = lines.find((line) => prefixes.some((prefix) => line.toLowerCase().startsWith(prefix.toLowerCase())));
  if (!found || !/[:：]/.test(found)) {
    return "";
  }
  const [, value = ""] = found.split(/[:：]/, 2);
  return normalizeText(value);
}

function pickFirstBullet(lines: string[]) {
  const bullet = lines.find((line) => /^[-*]\s+/.test(line));
  if (!bullet) {
    return "";
  }
  return normalizeText(cleanMarkdownLine(bullet));
}

function collectSectionLines(rawLines: string[]) {
  const sections: Array<{ heading: string; lines: string[] }> = [];
  let current: { heading: string; lines: string[] } | null = null;
  for (const line of rawLines) {
    if (/^#{2,}\s+/.test(line)) {
      current = { heading: cleanMarkdownLine(line), lines: [] };
      sections.push(current);
      continue;
    }
    if (current) {
      current.lines.push(line);
    }
  }
  return sections;
}

function pickBulletFromSection(sections: Array<{ heading: string; lines: string[] }>, keywords: string[]) {
  const section = sections.find((item) =>
    keywords.some((keyword) => item.heading.toLowerCase().includes(keyword.toLowerCase()))
  );
  if (!section) {
    return "";
  }
  return pickFirstBullet(section.lines);
}

function extractOpinionFields(body: string, thinkingSummary: string, roleId: RoleType) {
  const rawLines = String(body || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const lines = rawLines.map((line) => cleanMarkdownLine(line)).filter(Boolean);
  const sections = collectSectionLines(rawLines);

  const concern =
    pickBulletFromSection(sections, ["风险", "问题", "依赖"]) ||
    pickLineByPrefixes(lines, ["关注点", "风险", "问题", "核心风险", "关键风险"]) ||
    pickBulletFromSection(sections, ["业务背景", "场景"]) ||
    pickFirstBullet(rawLines) ||
    normalizeText(thinkingSummary || "需要先明确需求边界与执行约束。");

  const proposal =
    pickBulletFromSection(sections, ["下一步", "建议", "行动"]) ||
    pickLineByPrefixes(lines, ["结论建议", "建议", "结论", "行动建议", "下一步"]) ||
    normalizeText(lines.find((line) => line.includes("建议") || line.includes("结论")) || "") ||
    "先完成关键澄清，再推进任务拆解与执行。";

  return {
    focus: FALLBACK_FOCUS[roleId] || "多角色协同评审",
    concern: normalizeText(concern),
    proposal: normalizeText(proposal)
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`ISSUE_DEBATE_TIMEOUT:${label}:${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function getDebateRoles(input: { recommendedRoleIds: RoleType[]; soulRoleId: RoleType }) {
  const maxRoles = Math.max(3, Number(process.env.ISSUE_DEBATE_MAX_ROLES ?? 5));
  const ordered: RoleType[] = [];
  const push = (roleId: RoleType) => {
    if (!ordered.includes(roleId)) {
      ordered.push(roleId);
    }
  };
  push(input.soulRoleId);
  for (const roleId of input.recommendedRoleIds) {
    push(roleId);
  }
  return ordered.slice(0, maxRoles);
}

function fallbackConsensus(opinions: IssueDebateOpinion[]) {
  return opinions
    .map((item) => item.proposal)
    .filter(Boolean)
    .slice(0, 2)
    .map((item) => `角色共识建议：${item}`);
}

function fallbackDivergences(opinions: IssueDebateOpinion[]) {
  if (opinions.length < 2) {
    return [] as string[];
  }
  return [
    "不同角色对优先级与推进节奏存在差异，建议在确认卡中锁定“首期范围 + 验收口径”。"
  ];
}

function toConsensusAndDivergences(opinions: IssueDebateOpinion[]) {
  if (opinions.length === 0) {
    return { consensus: [] as string[], divergences: [] as string[] };
  }
  const threshold = Math.max(2, Math.ceil(opinions.length * 0.6));
  const byTheme = THEME_RULES.map((theme) => {
    const mentions = opinions.filter((item) => {
      const merged = `${item.concern} ${item.proposal}`.toLowerCase();
      return theme.keywords.some((keyword) => merged.includes(keyword.toLowerCase()));
    });
    return {
      theme,
      mentions
    };
  });

  const consensus = byTheme
    .filter((item) => item.mentions.length >= threshold)
    .map((item) => `${item.theme.label}（${item.mentions.length}/${opinions.length} 角色提及）`)
    .slice(0, 4);

  const divergences = byTheme
    .filter((item) => item.mentions.length > 0 && item.mentions.length < threshold)
    .map((item) => {
      const roles = item.mentions.map((mention) => mention.roleLabel).slice(0, 3).join("、");
      return `${item.theme.label}（仅 ${roles} 提及）`;
    })
    .slice(0, 4);

  return {
    consensus: consensus.length > 0 ? consensus : fallbackConsensus(opinions),
    divergences: divergences.length > 0 ? divergences : fallbackDivergences(opinions)
  };
}

function buildDebateSummaryPrompt(input: {
  issue: string;
  summary: string;
  industryCode: string;
  roleLabel: string;
}) {
  return [
    "你正在参与多角色需求辩论，请只给角色立场结论，不要输出完整PRD。",
    `行业: ${input.industryCode}`,
    `Issue: ${input.issue}`,
    `需求摘要: ${input.summary}`,
    `当前角色: ${input.roleLabel}`,
    "",
    "请至少明确：",
    "1) 关注点（最多2条）",
    "2) 风险（最多2条）",
    "3) 结论建议（最多2条）",
    "4) 需要用户确认的关键参数（至少1条）",
    "",
    "请尽量使用“关注点: ... / 结论建议: ...”格式，便于系统抽取。"
  ].join("\n");
}

export async function buildIssueRoleDebate(input: BuildIssueDebateInput): Promise<IssueDebateResult> {
  const runtime = await getRuntimeStatus();
  const selectedRoles = getDebateRoles({
    recommendedRoleIds: input.recommendedRoleIds,
    soulRoleId: input.soulRoleId
  });

  if (selectedRoles.length === 0) {
    return {
      mode: "fallback",
      generatedAt: new Date().toISOString(),
      consensus: [],
      divergences: [],
      opinions: [],
      note: "未匹配到可用角色，已跳过模型辩论。"
    };
  }

  const parsedIntent = previewRequirement(input.input);
  // 辩论任务已改为异步执行，不再需要过短超时。
  // 这里必须覆盖 runStageAgent 的内部阶段预算（通常约 90s），避免“模型仍在执行但外层提前判失败”。
  const roleTimeoutMs = Math.max(60000, Number(process.env.ISSUE_DEBATE_ROLE_TIMEOUT_MS ?? 130000));
  const settled = await Promise.allSettled(
    selectedRoles.map(async (roleId) => {
      const roleLabel = ROLE_LABELS[roleId] ?? roleId;
      const startedAt = Date.now();
      const run = await withTimeout(
        runStageAgent({
          projectName: input.title,
          projectDescription: input.input,
          parsedIntent,
          stageType: "ANALYSIS",
          role: roleId,
          summary: buildDebateSummaryPrompt({
            issue: input.input,
            summary: input.summary,
            industryCode: input.industryCode,
            roleLabel
          })
        }),
        roleTimeoutMs,
        roleId
      );
      const fields = extractOpinionFields(run.body, run.thinkingSummary, roleId);
      return {
        id: `debate-${roleId}-${Date.now()}`,
        roleId,
        roleLabel,
        focus: fields.focus,
        concern: fields.concern,
        proposal: fields.proposal,
        provider: run.provider,
        model: run.model,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        mode: run.provider === "scripted" ? "scripted" : "model",
        rawPreview: normalizeText(run.thinkingSummary || run.body).slice(0, 200)
      } as IssueDebateOpinion;
    })
  );

  const successfulOpinions = settled
    .filter((item): item is PromiseFulfilledResult<IssueDebateOpinion> => item.status === "fulfilled")
    .map((item) => item.value);
  const failed = settled.length - successfulOpinions.length;
  const opinionByRole = new Map(successfulOpinions.map((item) => [item.roleId, item]));
  const opinions: IssueDebateOpinion[] = selectedRoles.map((roleId, index) => {
    const existing = opinionByRole.get(roleId);
    if (existing) {
      return existing;
    }
    const roleLabel = ROLE_LABELS[roleId] ?? roleId;
    return {
      id: `debate-fallback-${roleId}-${Date.now()}-${index}`,
      roleId,
      roleLabel,
      focus: FALLBACK_FOCUS[roleId] || "多角色协同评审",
      concern: "该角色模型调用超时或失败，已降级为保底意见。",
      proposal: "请在确认卡补充该角色关注参数后再进入执行。",
      provider: "scripted",
      model: "debate-fallback",
      elapsedMs: roleTimeoutMs,
      mode: "fallback",
      rawPreview: "模型调用失败，已降级。"
    };
  });
  const realModelCount = opinions.filter((item) => item.mode === "model").length;
  const hasRealModel = realModelCount >= Math.min(2, selectedRoles.length);
  const derived = toConsensusAndDivergences(opinions);

  return {
    mode: hasRealModel ? "model" : "fallback",
    generatedAt: new Date().toISOString(),
    consensus: derived.consensus,
    divergences: derived.divergences,
    opinions,
    note: [
      runtime.mode === "scripted" ? "当前运行模式为 scripted，已使用降级辩论输出。" : "",
      realModelCount > 0 && !hasRealModel ? `仅 ${realModelCount} 个角色完成真实模型输出，未达到最小讨论阈值。` : "",
      failed > 0 ? `${failed} 个角色辩论调用失败，已用可用结果继续。` : ""
    ]
      .filter(Boolean)
      .join(" ")
      .trim() || undefined
  };
}
