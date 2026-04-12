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
  openQuestions: string[];
  handoff: string;
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

const ROLE_DEBATE_BRIEFS: Record<RoleType, { objective: string; pushback: string; handoff: string }> = {
  ROLE_ASSISTANT: {
    objective: "收敛分歧并保证结论可进入后续执行",
    pushback: "不能把未澄清事项当成既定事实",
    handoff: "把已确认结论同步给 PM 和后续执行角色"
  },
  ROLE_PM: {
    objective: "锁定 MVP 范围、推进顺序和阶段门禁",
    pushback: "反对关键依赖未确认就直接排期开工",
    handoff: "向产品、架构和研发同步首期边界与排期前提"
  },
  ROLE_ANALYST: {
    objective: "识别业务目标、核心链路和未澄清约束",
    pushback: "反对把模糊描述直接落成确定方案",
    handoff: "向产品和 PM 交接待确认项与业务边界"
  },
  ROLE_PRODUCT: {
    objective: "定义用户价值、MVP 决策口径和非目标",
    pushback: "反对堆功能而不说明优先级和价值取舍",
    handoff: "向设计和研发交接 P0 用户路径与非目标"
  },
  ROLE_DESIGN: {
    objective: "定义真实业务对象、关键视图和交互闭环",
    pushback: "反对只讲页面美观、不讲业务决策链路",
    handoff: "向产品和研发交接关键界面、状态和交互约束"
  },
  ROLE_ARCH: {
    objective: "明确数据链路、系统边界和技术风险",
    pushback: "反对数据来源和稳定性未确认就承诺能力",
    handoff: "向研发和 QA 交接接口、依赖和风险闸门"
  },
  ROLE_DEV: {
    objective: "确认真实实现路径、数据一致性和交付顺序",
    pushback: "反对用假数据或 mock fallback 掩盖主链问题",
    handoff: "向 PM 和 QA 交接实现边界与验证路径"
  },
  ROLE_QA: {
    objective: "定义可验证的验收标准和阻断条件",
    pushback: "反对只有主观描述、没有量化验收口径",
    handoff: "向 PM 和研发交接必测路径、样例和阻断条件"
  },
  ROLE_HR: {
    objective: "识别资源协同与责任边界风险",
    pushback: "反对角色责任不清导致执行失真",
    handoff: "向 PM 交接协作资源与责任边界风险"
  }
};

function normalizeText(input: string) {
  return String(input || "").replace(/\s+/g, " ").trim();
}

const DEBATE_SECTION_LABELS = new Set([
  "角色目标",
  "核心风险",
  "反对点",
  "角色结论",
  "待确认项",
  "开放问题",
  "handoff",
  "交接"
]);

function isMeaningfulDebateStatement(input: string) {
  const normalized = normalizeText(input)
    .replace(/^[-*]\s+/, "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[0-9]+[.)、]\s*/, "")
    .trim();
  if (!normalized) {
    return false;
  }
  const plain = normalized
    .replace(/[：:]+$/, "")
    .replace(/\*+/g, "")
    .trim()
    .toLowerCase();
  if (!plain) {
    return false;
  }
  if (DEBATE_SECTION_LABELS.has(plain) || DEBATE_SECTION_LABELS.has(normalized.replace(/[：:]+$/, "").trim())) {
    return false;
  }
  return true;
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

function pickBulletsFromSection(sections: Array<{ heading: string; lines: string[] }>, keywords: string[]) {
  const section = sections.find((item) =>
    keywords.some((keyword) => item.heading.toLowerCase().includes(keyword.toLowerCase()))
  );
  if (!section) {
    return [] as string[];
  }
  return section.lines
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => normalizeText(cleanMarkdownLine(line)))
    .filter(Boolean);
}

function pickFirstMeaningfulLineFromSection(
  sections: Array<{ heading: string; lines: string[] }>,
  keywords: string[]
) {
  const section = sections.find((item) =>
    keywords.some((keyword) => item.heading.toLowerCase().includes(keyword.toLowerCase()))
  );
  if (!section) {
    return "";
  }
  return section.lines
    .map((line) => normalizeText(cleanMarkdownLine(line)))
    .find((line) => isMeaningfulDebateStatement(line)) || "";
}

function extractOpinionFields(body: string, thinkingSummary: string, roleId: RoleType) {
  const rawLines = String(body || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const lines = rawLines.map((line) => cleanMarkdownLine(line)).filter(Boolean);
  const sections = collectSectionLines(rawLines);

  const focus =
    pickBulletFromSection(sections, ["角色目标", "关注点", "focus"]) ||
    pickLineByPrefixes(lines, ["角色目标", "关注点", "focus", "职责"]) ||
    FALLBACK_FOCUS[roleId] ||
    "多角色协同评审";

  const concern =
    pickBulletFromSection(sections, ["风险", "问题", "依赖"]) ||
    pickBulletFromSection(sections, ["反对点", "反对", "质疑"]) ||
    pickLineByPrefixes(lines, ["关注点", "风险", "问题", "核心风险", "关键风险"]) ||
    pickBulletFromSection(sections, ["业务背景", "场景"]) ||
    pickFirstBullet(rawLines) ||
    normalizeText(thinkingSummary || "需要先明确需求边界与执行约束。");

  const proposal =
    pickBulletFromSection(sections, ["角色结论", "建议", "行动", "handoff", "交接"]) ||
    pickLineByPrefixes(lines, ["角色结论", "结论建议", "建议", "结论", "行动建议", "下一步"]) ||
    pickFirstMeaningfulLineFromSection(sections, ["角色结论", "建议", "行动"]) ||
    normalizeText(
      lines.find((line) =>
        isMeaningfulDebateStatement(line)
        && (line.includes("建议") || line.includes("结论") || line.includes("下一步"))
      ) || ""
    ) ||
    "先完成关键澄清，再推进任务拆解与执行。";

  const openQuestions = pickBulletsFromSection(sections, ["待确认", "开放问题", "openquestion", "open question"]);
  const handoff =
    pickBulletFromSection(sections, ["handoff", "交接"]) ||
    pickLineByPrefixes(lines, ["handoff", "交接", "下游交接"]) ||
    pickFirstMeaningfulLineFromSection(sections, ["handoff", "交接"]) ||
    "将关键结论同步给下游角色，并在进入执行前补齐待确认项。";

  return {
    focus: normalizeText(focus),
    concern: normalizeText(concern),
    proposal: normalizeText(proposal),
    openQuestions,
    handoff: normalizeText(handoff)
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

function parseEnvFlag(value: string | undefined, defaultValue: boolean) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  return defaultValue;
}

export function selectIssueDebateRoles(input: { recommendedRoleIds: RoleType[]; soulRoleId: RoleType; maxRoles?: number }) {
  // 每次讨论至少保留「需求分析师 + 一个非分析角色」视角，避免单角色结论。
  const maxRoles = Math.max(2, Number(input.maxRoles ?? process.env.ISSUE_DEBATE_MAX_ROLES ?? 3));
  const ordered: RoleType[] = [];
  const push = (roleId: RoleType) => {
    if (!ordered.includes(roleId)) {
      ordered.push(roleId);
    }
  };
  // 强制分析师始终参与，并优先保留模板/推荐角色，再补齐常见协作角色。
  push(input.soulRoleId);
  push("ROLE_ANALYST");
  for (const roleId of input.recommendedRoleIds) {
    push(roleId);
  }
  const fallbackOrder: RoleType[] = [
    "ROLE_PM",
    "ROLE_PRODUCT",
    "ROLE_DESIGN",
    "ROLE_ARCH",
    "ROLE_DEV",
    "ROLE_QA"
  ];
  for (const roleId of fallbackOrder) {
    push(roleId);
  }
  return ordered.slice(0, maxRoles);
}

export function evaluateDebateModelSufficiency(input: {
  selectedRoles: RoleType[];
  opinions: IssueDebateOpinion[];
  minRealModelRoles?: number;
  requireAnalyst?: boolean;
}) {
  const requireAnalyst = input.requireAnalyst ?? true;
  const minRealModelRoles = Math.max(2, Number(input.minRealModelRoles ?? 2));
  const realModelRoles = new Set(
    input.opinions
      .filter((item) => item.mode === "model")
      .map((item) => item.roleId)
  );
  const analystReady = realModelRoles.has("ROLE_ANALYST");
  const nonAnalystReady = Array.from(realModelRoles).some((roleId) => roleId !== "ROLE_ANALYST");
  const effectiveMinRoles = Math.min(
    Math.max(2, input.selectedRoles.length),
    minRealModelRoles
  );
  const countReady = realModelRoles.size >= effectiveMinRoles;
  const analystConstraintReady = requireAnalyst ? analystReady && nonAnalystReady : true;
  return {
    passed: countReady && analystConstraintReady,
    realModelCount: realModelRoles.size,
    analystReady,
    nonAnalystReady,
    effectiveMinRoles
  };
}

async function runDebateRoleBatch(
  roles: RoleType[],
  execute: (roleId: RoleType) => Promise<IssueDebateOpinion>
) {
  const settled: PromiseSettledResult<IssueDebateOpinion>[] = [];
  for (const roleId of roles) {
    try {
      settled.push({
        status: "fulfilled",
        value: await execute(roleId)
      });
    } catch (error) {
      settled.push({
        status: "rejected",
        reason: error
      });
    }
  }
  return settled;
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
  roleId: RoleType;
  roleLabel: string;
}) {
  const brief = ROLE_DEBATE_BRIEFS[input.roleId] ?? ROLE_DEBATE_BRIEFS.ROLE_PRODUCT;
  return [
    "你正在参与多角色需求辩论，请只输出角色立场结论，不要输出完整 PRD。",
    `行业: ${input.industryCode}`,
    `Issue: ${input.issue}`,
    `需求摘要: ${input.summary}`,
    `当前角色: ${input.roleLabel}`,
    `角色目标: ${brief.objective}`,
    `必须坚持: ${brief.pushback}`,
    `下游交接目标: ${brief.handoff}`,
    "",
    "请严格使用下面的 Markdown 结构输出，字段名不要改：",
    "## 角色目标",
    "- 1 条",
    "## 核心风险",
    "- 1 到 2 条",
    "## 反对点",
    "- 1 条，写清你反对什么推进方式",
    "## 角色结论",
    "- 1 到 2 条，必须能指导后续动作",
    "## 待确认项",
    "- 至少 1 条",
    "## Handoff",
    "- 1 条，写清要交给谁、交什么",
    "",
    "要求：结论必须体现你的角色判断边界，不能写成通用模板，也不要复述需求原文。",
    "禁止把“角色结论”“建议”“下一步”等标题词本身当成结论内容。"
  ].join("\n");
}

export async function buildIssueRoleDebate(input: BuildIssueDebateInput): Promise<IssueDebateResult> {
  const runtime = await getRuntimeStatus();
  const selectedRoles = selectIssueDebateRoles({
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
  const debateConcurrency = Math.max(1, Number(process.env.ISSUE_DEBATE_CONCURRENCY ?? 2));
  const executeRole = async (roleId: RoleType) => {
    const roleLabel = ROLE_LABELS[roleId] ?? roleId;
    const startedAt = Date.now();
    const run = await withTimeout(
      runStageAgent({
        projectName: input.title,
        projectDescription: input.input,
        parsedIntent,
        stageType: "ANALYSIS",
        role: roleId,
        promptMode: "issue_debate",
        summary: buildDebateSummaryPrompt({
          issue: input.input,
          summary: input.summary,
          industryCode: input.industryCode,
          roleId,
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
      openQuestions: fields.openQuestions,
      handoff: fields.handoff,
      provider: run.provider,
      model: run.model,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      mode: run.provider === "scripted" ? "scripted" : "model",
      rawPreview: normalizeText(run.thinkingSummary || run.body).slice(0, 200)
    } as IssueDebateOpinion;
  };

  const settled: PromiseSettledResult<IssueDebateOpinion>[] = [];
  for (let index = 0; index < selectedRoles.length; index += debateConcurrency) {
    const batch = selectedRoles.slice(index, index + debateConcurrency);
    const batchSettled = await runDebateRoleBatch(batch, executeRole);
    settled.push(...batchSettled);
  }

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
      openQuestions: ["该角色真实模型输出缺失，需人工补充关键待确认项。"],
      handoff: "先补齐该角色待确认项，再进入下游执行。",
      provider: "scripted",
      model: "debate-fallback",
      elapsedMs: roleTimeoutMs,
      mode: "fallback",
      rawPreview: "模型调用失败，已降级。"
    };
  });
  const minRealModelRoles = Math.max(2, Number(process.env.ISSUE_DEBATE_MIN_REAL_MODEL_ROLES ?? 2));
  const requireAnalyst = parseEnvFlag(process.env.ISSUE_DEBATE_REQUIRE_ANALYST, true);
  const sufficiency = evaluateDebateModelSufficiency({
    selectedRoles,
    opinions,
    minRealModelRoles,
    requireAnalyst
  });
  const hasRealModel = sufficiency.passed;
  const derived = toConsensusAndDivergences(opinions);

  return {
    mode: hasRealModel ? "model" : "fallback",
    generatedAt: new Date().toISOString(),
    consensus: derived.consensus,
    divergences: derived.divergences,
    opinions,
    note: [
      runtime.mode === "scripted" ? "当前运行模式为 scripted，已使用降级辩论输出。" : "",
      sufficiency.realModelCount > 0 && !hasRealModel
        ? `仅 ${sufficiency.realModelCount} 个角色完成真实模型输出，最低要求 ${sufficiency.effectiveMinRoles} 个且需包含需求分析师与至少 1 个非分析角色。`
        : "",
      failed > 0 ? `${failed} 个角色辩论调用失败，已用可用结果继续。` : ""
    ]
      .filter(Boolean)
      .join(" ")
      .trim() || undefined
  };
}
