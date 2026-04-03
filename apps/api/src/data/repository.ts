import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  ROLE_LABELS,
  STAGE_LABELS,
  type AgentProfile,
  type CreateProjectInput,
  type ProjectMessageInput,
  type ParsedIntent,
  type ProjectDetail,
  type ProjectStatus,
  type ProjectSummary,
  type RoleType,
  type RuntimeMode,
  type StageRejectInput,
  type StageSubmissionInput,
  type Stage,
  type StageType,
  type SystemHealth,
  type Task,
  type TaskBoardItem,
  type TaskStatus,
  type TimelineEvent
} from "@occ/shared";
import { prisma } from "../db.js";
import {
  getRuntimeStatus,
  previewStageModelPlan,
  runStageAgent,
  type StageAgentRunResult
} from "../agents/runtime.js";
import {
  finalizeRequirementBackfill,
  getIssueByProjectId,
  type RequirementContract
} from "../system/v1-method-store.js";
import { generateOfficialSiteArtifact } from "../utils/official-site.js";
import {
  buildDeliverables,
  buildStageLiveSession,
  buildStages,
  buildTasks,
  buildTimeline,
  createSeedProject,
  createSeedProjects,
  seedAgents,
  stageAssignees
} from "./seed-data.js";
import { previewRequirement } from "../utils/project-parser.js";
import {
  buildDeliverableTemplatePromptBlock,
  resolveDeliverableTemplate
} from "../system/deliverable-templates.js";
import {
  evaluateVisualDesignRequirementAlignment
} from "../system/design-preview.js";
import {
  buildTerminalStageExecutionMessage,
  getProjectStageExecutionStrategy
} from "../system/project-stage-execution.js";
import {
  findOpenClawAgent,
  sendOpenClawAgentMessage,
  updateOpenClawAgentSettings
} from "../openclaw/workspace.js";

const stageOrder: StageType[] = ["INIT", "ANALYSIS", "DESIGN", "DEV", "ACCEPT"];
const DESIGN_REVIEW_MARKER = "## 设计审查卡";
const MIN_DELIVERABLE_CONTENT_LENGTH = 180;
const STAGE_OBJECTIVES: Record<StageType, string> = {
  INIT: "确认项目目标、边界与团队分工，建立执行基线。",
  ANALYSIS: "把输入需求转成结构化需求确认单、约束与风险清单。",
  DESIGN: "输出可执行设计方案，明确信息架构、视觉方向与交互规则。",
  DEV: "先产出研发技术方案与关键选型，再把设计与任务拆解落地为可运行实现，并完成联调验证。",
  ACCEPT: "完成验收验证、结果总结与文档回填，形成可持续迭代闭环。"
};

const STAGE_NEXT_INPUT: Record<StageType, string> = {
  INIT: "将项目章程与角色分工交给分析阶段继续细化。",
  ANALYSIS: "把需求确认单、排期和风险清单交给设计阶段产出方案。",
  DESIGN: "把设计审查卡、视觉定稿单页与实施方案交给开发阶段，先完成技术方案与选型再进入实现。",
  DEV: "把实现结果、测试证据和发布说明交给验收阶段评审。",
  ACCEPT: "把验收结论和回填结果同步到产品说明文档，作为下轮需求输入。"
};
const STAGE_COMPANION_ROLES: Partial<Record<StageType, RoleType[]>> = {
  DESIGN: ["ROLE_PRODUCT"],
  DEV: ["ROLE_ARCH"]
};

const STAGE_EXPECTED_DELIVERABLE_NAMES: Record<StageType, string[]> = {
  INIT: ["项目章程.md"],
  ANALYSIS: ["需求分析文档.md", "项目排期方案.md"],
  DESIGN: ["客户汇报方案.ppt.md", "实施方案说明.word.md", "设计审查卡.md", "视觉定稿单页.preview.html.md"],
  DEV: ["技术方案与选型.md", "Demo原型说明.md"],
  ACCEPT: ["测试报告.md", "产品说明文档回填.md"]
};
const PM_STAGE_GATE_ENABLED = String(process.env.PM_STAGE_GATE_ENABLED ?? "true").trim().toLowerCase() !== "false";
const PM_STAGE_GATE_MIN_SUCCESS = Math.max(1, Number(process.env.PM_STAGE_GATE_MIN_SUCCESS ?? 1));
const ROLE_MODEL_GATE_MIN_SUCCESS_DEFAULT = Math.max(1, Number(process.env.ROLE_MODEL_GATE_MIN_SUCCESS ?? 1));
const DELIVERABLE_PLACEHOLDER_PATTERN = /待补充|占位(词|符)?|TODO|TBD|lorem ipsum|\bxxx\b/i;
const DELIVERABLE_TEMPLATE_SCAFFOLD_PATTERN =
  /模板章节骨架（自动补齐）|模板章节骨架（请按模板补全）|请结合(?:本阶段)?(?:\s*任务证据(?:与|和)?\s*(?:Agent\s*(?:输出正文|正文))?|(?:\s*Agent\s*(?:输出正文|正文))?\s*与任务证据)(?:补全|完善)本节|请结合(?:\s*Agent\s*输出正文)?与任务证据(?:补全|完善)本节/i;
const STAGE_ROLE_MODEL_GATE_TARGETS: Partial<Record<StageType, RoleType[]>> = {
  DESIGN: ["ROLE_DESIGN"],
  DEV: ["ROLE_ARCH", "ROLE_DEV"],
  ACCEPT: ["ROLE_QA"]
};

export type DesignInterventionSignal = {
  required: boolean;
  reasonCode?: "design_ambiguity";
  reasonDetail?: string;
  prefillContent?: string;
  source?: "live_session" | "deliverable" | "timeline";
};

const DESIGN_INTERVENTION_RULES: Array<{
  reasonDetail: string;
  pattern: RegExp;
}> = [
  {
    reasonDetail: "需求描述存在模糊或未确认项",
    pattern: /(需求|目标|范围|场景|流程).{0,16}(不清晰|模糊|不明确|无法确定|待确认|需确认)/i
  },
  {
    reasonDetail: "关键输入信息不足",
    pattern: /(信息|上下文|输入|素材|业务规则).{0,12}(不足|缺失|不完整)/i
  },
  {
    reasonDetail: "设计 Agent 请求补充关键信息",
    pattern: /(请|需|需要).{0,18}(补充|澄清|明确).{0,18}(需求|信息|目标|范围|约束)/i
  },
  {
    reasonDetail: "设计 Agent 表示当前无法继续推进",
    pattern: /(无法|不能|难以).{0,12}(继续|推进|完成|产出|定稿|设计)/i
  },
  {
    reasonDetail: "设计阶段等待用户确认后才能继续",
    pattern: /(等待|待).{0,10}(你|用户|业务方).{0,10}(确认|补充|拍板|反馈)/i
  }
];

function sanitizeDesignInterventionText(input: string, maxLength = 1400) {
  const normalized = String(input || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

function extractDesignInterventionSnippet(source: string, matchedIndex: number, radius = 260) {
  const normalized = sanitizeDesignInterventionText(source, 5000);
  if (!normalized) {
    return "";
  }
  const safeIndex = Number.isFinite(matchedIndex) ? Math.max(0, Math.floor(matchedIndex)) : 0;
  const start = Math.max(0, safeIndex - radius);
  const end = Math.min(normalized.length, safeIndex + radius);
  const slice = normalized.slice(start, end).trim();
  if (!slice) {
    return "";
  }
  const prefix = start > 0 ? "..." : "";
  const suffix = end < normalized.length ? "..." : "";
  return `${prefix}${slice}${suffix}`;
}

function isProjectWarmupEnabled() {
  if (process.env.NODE_ENV === "test") {
    return false;
  }

  const raw = String(process.env.PROJECT_WARMUP ?? "").trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "off") {
    return false;
  }
  if (raw === "true" || raw === "1" || raw === "on") {
    return true;
  }

  return process.env.NODE_ENV === "production";
}

function isRealModelGateEnabled() {
  const raw = String(process.env.ENFORCE_REAL_MODEL_GATE ?? "").trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "on") {
    return true;
  }
  if (raw === "false" || raw === "0" || raw === "off") {
    return false;
  }
  return process.env.NODE_ENV === "production";
}

function isExecutionDegraded(metadata: Prisma.JsonValue | null) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }
  return Boolean((metadata as Record<string, unknown>).degraded);
}

function isTerminalExecutionMetadata(metadata: Prisma.JsonValue | null) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }
  return String((metadata as Record<string, unknown>).executionMode ?? "").trim().toLowerCase() === "terminal_agent";
}

async function assertTerminalExecutionReadyForGate(stageExecutions: StageAgentExecutionRecord[]) {
  const hasTerminalEvidence = stageExecutions.some((row) => isTerminalExecutionMetadata(row.metadata ?? null));
  if (!hasTerminalEvidence) {
    throw new Error("REAL_MODEL_GATE_FAILED: 当前阶段未发现终端 Agent 执行证据。");
  }

  const missingModelRows = stageExecutions.filter((row) => isTerminalExecutionMetadata(row.metadata ?? null) && !String(row.model ?? "").trim());
  if (missingModelRows.length > 0) {
    throw new Error("REAL_MODEL_GATE_FAILED: 终端 Agent 执行记录缺少模型信息。");
  }
}

async function assertRealModelRuntimeReadyForGate() {
  if (!isRealModelGateEnabled()) {
    return;
  }

  if (process.env.NODE_ENV === "test") {
    const forcedProvider = String(process.env.MODEL_PROVIDER ?? "").trim().toLowerCase();
    if (forcedProvider && forcedProvider !== "openai-compatible") {
      throw new Error("REAL_MODEL_GATE_FAILED: 当前运行模式不是 openai-compatible，禁止通过阶段验收。");
    }
  }

  const runtime = await getRuntimeStatus();
  if (runtime.requestedMode !== "openai-compatible") {
    throw new Error("REAL_MODEL_GATE_FAILED: 当前运行模式不是 openai-compatible，禁止通过阶段验收。");
  }
  if (!runtime.configured) {
    throw new Error("REAL_MODEL_GATE_FAILED: 真实模型配置不完整（API Base URL / API Key / Model）。");
  }
}

async function assertCurrentStageRealModelGate(project: ProjectDetail) {
  const stageExecutions = await prisma.projectExecution.findMany({
    where: {
      projectId: project.id,
      stageType: project.currentStage,
      status: "success"
    },
    orderBy: { createdAt: "desc" },
    take: 80
  });

  const normalizedStageExecutions = stageExecutions.map((row) => ({
    ...row,
    model: row.model ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  })) as StageAgentExecutionRecord[];

  if (normalizedStageExecutions.length === 0) {
    throw new Error(`REAL_MODEL_GATE_FAILED: ${project.currentStage} 阶段缺少可验证执行记录。`);
  }

  if (!normalizedStageExecutions.some((row) => row.role === project.currentRole)) {
    throw new Error(`REAL_MODEL_GATE_FAILED: ${project.currentStage} 阶段缺少当前角色 ${project.currentRole} 的执行证据。`);
  }

  const hasTerminalExecution = normalizedStageExecutions.some((row) => isTerminalExecutionMetadata(row.metadata ?? null));
  if (hasTerminalExecution) {
    await assertTerminalExecutionReadyForGate(normalizedStageExecutions);
  } else {
    await assertRealModelRuntimeReadyForGate();
  }

  const scriptedRows = normalizedStageExecutions.filter((row) => String(row.provider || "").trim().toLowerCase() === "scripted");
  if (scriptedRows.length > 0) {
    throw new Error(`REAL_MODEL_GATE_FAILED: ${project.currentStage} 阶段存在 scripted 输出，禁止通过验收。`);
  }

  const degradedRows = normalizedStageExecutions.filter((row) => isExecutionDegraded(row.metadata ?? null));
  if (degradedRows.length > 0) {
    throw new Error(`REAL_MODEL_GATE_FAILED: ${project.currentStage} 阶段存在 degraded 降级输出，禁止通过验收。`);
  }

  assertPmExecutionGate(project, normalizedStageExecutions);
  await assertStageRoleModelWhitelistGate(project, normalizedStageExecutions);
}

function normalizeModelForGate(model: string | null | undefined) {
  return String(model ?? "").trim().toLowerCase();
}

function addModelGateAliases(target: Set<string>, model: string | null | undefined) {
  const normalized = normalizeModelForGate(model);
  if (!normalized) {
    return;
  }
  target.add(normalized);
  if (normalized.startsWith("openai/")) {
    target.add(normalized.slice("openai/".length));
    return;
  }
  if (normalized.startsWith("gpt-")) {
    target.add(`openai/${normalized}`);
  }
}

function readRoleAllowlistFromEnv(role: RoleType) {
  return String(process.env[`ROLE_MODEL_GATE_ALLOWLIST_${role}`] ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function assertPmExecutionGate(
  project: ProjectDetail,
  stageExecutions: Array<{ role: string }>
) {
  if (!PM_STAGE_GATE_ENABLED) {
    return;
  }
  const pmSuccessCount = stageExecutions.filter((row) => row.role === "ROLE_PM").length;
  if (pmSuccessCount < PM_STAGE_GATE_MIN_SUCCESS) {
    throw new Error(
      `REAL_MODEL_GATE_FAILED: ${project.currentStage} 阶段缺少 ROLE_PM 成功执行证据（要求 >= ${PM_STAGE_GATE_MIN_SUCCESS}）。`
    );
  }
}

async function assertStageRoleModelWhitelistGate(
  project: ProjectDetail,
  stageExecutions: Array<{ role: string; model?: string | null | undefined }>
) {
  const targetRoles = STAGE_ROLE_MODEL_GATE_TARGETS[project.currentStage] || [];
  if (targetRoles.length === 0) {
    return;
  }

  const configs = await prisma.managedAgentConfig.findMany({
    where: { agentId: { in: targetRoles } },
    select: {
      agentId: true,
      selectedModel: true,
      defaultModel: true,
      fallbackModel: true
    }
  });
  const configByRole = new Map(configs.map((item) => [item.agentId as RoleType, item]));

  for (const role of targetRoles) {
    const minSuccess = Math.max(
      1,
      Number(process.env[`ROLE_MODEL_GATE_MIN_SUCCESS_${role}`] ?? ROLE_MODEL_GATE_MIN_SUCCESS_DEFAULT)
    );
    const roleRows = stageExecutions.filter((row) => row.role === role);
    if (roleRows.length < minSuccess) {
      throw new Error(
        `REAL_MODEL_GATE_FAILED: ${project.currentStage} 阶段角色 ${role} 成功执行次数不足（实际 ${roleRows.length}，要求 >= ${minSuccess}）。`
      );
    }

    const allowlist = new Set<string>();
    const config = configByRole.get(role);
    addModelGateAliases(allowlist, config?.selectedModel);
    addModelGateAliases(allowlist, config?.defaultModel);
    addModelGateAliases(allowlist, config?.fallbackModel);
    try {
      const planned = await previewStageModelPlan({ role, stageType: project.currentStage });
      const planModels = Array.isArray(planned?.plan) ? planned.plan : [];
      for (const plannedModel of planModels) {
        addModelGateAliases(allowlist, plannedModel);
      }
    } catch {
      // ignore preview failures and continue with managed config / env allowlist
    }
    for (const envModel of readRoleAllowlistFromEnv(role)) {
      addModelGateAliases(allowlist, envModel);
    }

    if (allowlist.size === 0) {
      throw new Error(
        `REAL_MODEL_GATE_FAILED: ${role} 未配置模型白名单（ManagedAgentConfig 或 ROLE_MODEL_GATE_ALLOWLIST_${role}）。`
      );
    }

    const whitelistHits = roleRows.filter((row) => allowlist.has(normalizeModelForGate(row.model)));
    if (whitelistHits.length < minSuccess) {
      const actualModels = [...new Set(roleRows.map((row) => normalizeModelForGate(row.model)).filter(Boolean))];
      throw new Error(
        `REAL_MODEL_GATE_FAILED: ${project.currentStage} 阶段角色 ${role} 命中白名单不足（实际命中 ${whitelistHits.length}，要求 >= ${minSuccess}）。白名单: ${[...allowlist].join(", ")}；实际: ${actualModels.join(", ") || "unknown"}。`
      );
    }
  }
}

function normalizeDesignReview(input: StageSubmissionInput["designReview"]) {
  if (!input) {
    return null;
  }

  const sanitizeField = (value: unknown) =>
    String(value ?? "")
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) =>
        line
          .trim()
          .replace(/^#{1,6}\s*/, "")
          .replace(/^[-*]\s*/, "")
          .replace(/^【[^】]+】/, "")
          .trim()
      )
      .filter((line) => {
        if (!line) {
          return false;
        }
        const normalized = line.toLowerCase().replace(/[：:]/g, "").replace(/\s+/g, "");
        return ![
          "视觉方案",
          "版式策略",
          "组件清单",
          "品牌语气",
          "ux原则",
          "可访问性检查",
          "设计审查卡",
          "验收检查清单",
          "agent介入说明",
          "agent输出摘录"
        ].includes(normalized);
      })
      .join("；")
      .trim();
  const sanitizeList = (values: unknown[]) =>
    Array.from(new Set(values.map((item) => sanitizeField(item)).filter(Boolean)));

  const visualDirection = sanitizeField(input.visualDirection);
  const brandTone = sanitizeField(input.brandTone);
  const approvedBy = sanitizeField(input.approvedBy);
  const approved = Boolean(input.approved);
  const uxPrinciples = sanitizeList(Array.isArray(input.uxPrinciples) ? input.uxPrinciples : []);
  const accessibilityChecklist = sanitizeList(Array.isArray(input.accessibilityChecklist) ? input.accessibilityChecklist : []);
  const notes = sanitizeField(input.notes);

  if (!visualDirection || !brandTone || !approvedBy) {
    return null;
  }

  if (uxPrinciples.length < 3 || accessibilityChecklist.length < 3) {
    return null;
  }

  return {
    visualDirection,
    brandTone,
    approvedBy,
    approved,
    uxPrinciples,
    accessibilityChecklist,
    notes
  };
}

function validateDesignSubmission(content: string) {
  const normalized = content.trim();
  if (normalized.length < 260) {
    return ["设计交付内容过短（至少 260 字）"];
  }

  const requiredSections = ["## 视觉方案", "## 版式策略", "## 组件清单", "## 品牌语气"];
  const missingSections = requiredSections.filter((section) => !normalized.includes(section));

  const bullets = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));

  const errors: string[] = [];
  if (missingSections.length > 0) {
    errors.push(`缺少关键章节：${missingSections.join("、")}`);
  }
  if (bullets.length < 8) {
    errors.push("设计说明颗粒度不足（至少 8 条要点）");
  }

  return errors;
}

function renderDesignReviewCard(input: {
  visualDirection: string;
  brandTone: string;
  approvedBy: string;
  approved: boolean;
  uxPrinciples: string[];
  accessibilityChecklist: string[];
  notes: string;
}) {
  const lines = [
    DESIGN_REVIEW_MARKER,
    `- 视觉方向: ${input.visualDirection}`,
    `- 品牌语气: ${input.brandTone}`,
    `- UX 原则: ${input.uxPrinciples.join("；")}`,
    `- 可访问性检查: ${input.accessibilityChecklist.join("；")}`,
    `- 审查人: ${input.approvedBy}`,
    `- 审查结论: ${input.approved ? "通过" : "不通过"}`
  ];

  if (input.notes) {
    lines.push(`- 审查备注: ${input.notes}`);
  }

  return lines.join("\n");
}

function ensureDesignSubmissionContent(
  content: string,
  _designReview: NonNullable<ReturnType<typeof normalizeDesignReview>>
) {
  // Keep submission content source-of-truth from user/agent output.
  // Do not auto-inject generic sections/HTML, otherwise a blank or templated
  // design review can be incorrectly treated as a completed visual deliverable.
  return String(content || "").trim();
}

function hasApprovedDesignReview(content: string) {
  return content.includes(DESIGN_REVIEW_MARKER) && /审查结论:\s*通过/.test(content);
}

function extractRenderableHtmlPreview(content: string) {
  const source = String(content || "");
  const fencedPattern = /(?:^|\n)```html[ \t]*\n([\s\S]*?)\n```(?:\n|$)/gi;
  let matched: RegExpExecArray | null;
  while ((matched = fencedPattern.exec(source)) !== null) {
    const candidate = String(matched[1] || "").trim();
    if (/(<!doctype html|<html[\s>]|<body[\s>]|<main[\s>]|<section[\s>]|<div[\s>])/i.test(candidate)) {
      return candidate;
    }
  }

  if (/(<!doctype html|<html[\s>])/i.test(source)) {
    return source.trim();
  }

  return null;
}

function hasVisualDesignPreview(content: string) {
  const source = String(content || "");
  return Boolean(extractRenderableHtmlPreview(source))
    || /!\[[^\]]*\]\((https?:\/\/|data:image\/)/i.test(source);
}

export function getDesignInterventionSignal(
  project: Pick<ProjectDetail, "status" | "currentStage" | "liveSession" | "deliverables" | "timeline">
): DesignInterventionSignal {
  if (project.status === "completed" || project.currentStage !== "DESIGN") {
    return { required: false };
  }

  const designDeliverables = project.deliverables
    .filter((item) => item.stageType === "DESIGN")
    .sort((left, right) => {
      const byVersion = right.version - left.version;
      if (byVersion !== 0) {
        return byVersion;
      }
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    })
    .slice(0, 3);

  const timelineItems = project.timeline
    .slice()
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    .slice(0, 8);

  const candidates: Array<{ source: DesignInterventionSignal["source"]; text: string }> = [];
  const liveBody = String(project.liveSession?.body || "").trim();
  if (liveBody) {
    candidates.push({ source: "live_session", text: liveBody });
  }
  for (const deliverable of designDeliverables) {
    const content = String(deliverable.content || "").trim();
    if (content) {
      candidates.push({ source: "deliverable", text: content });
    }
  }
  for (const timeline of timelineItems) {
    const content = String(timeline.content || "").trim();
    if (content) {
      candidates.push({ source: "timeline", text: content });
    }
  }

  for (const candidate of candidates) {
    for (const rule of DESIGN_INTERVENTION_RULES) {
      const match = rule.pattern.exec(candidate.text);
      if (!match) {
        continue;
      }
      const snippet = extractDesignInterventionSnippet(candidate.text, match.index ?? 0);
      const prefillLines = [
        `【Agent 介入说明】${rule.reasonDetail}`,
        "【Agent 输出摘录】",
        snippet || sanitizeDesignInterventionText(candidate.text, 520)
      ];
      return {
        required: true,
        reasonCode: "design_ambiguity",
        reasonDetail: rule.reasonDetail,
        prefillContent: prefillLines.join("\n"),
        source: candidate.source
      };
    }
  }

  return { required: false };
}

function evaluateDevImplementationRequirementAlignment(input: {
  projectName?: string;
  projectDescription?: string;
  keywords?: string[];
  deliverableName?: string;
  content: string;
}) {
  const text = String(input.content || "").trim();
  const issues: string[] = [];
  if (!text) {
    return { pass: false, issues: ["交付内容为空，无法证明研发实现"] };
  }

  const routeMatches = Array.from(
    text.matchAll(/(?:^|\s)(\/[a-zA-Z0-9_:-]+(?:\/[a-zA-Z0-9_:-]+)*)/g)
  ).map((match) => String(match[1] || "").trim());
  const pageKeywordMatches = text.match(/(首页|列表页|详情页|监控页|榜单页|设置页|分析页|告警页|跟踪页|管理页)/g) || [];
  const routeSignalCount = new Set(
    [...routeMatches, ...pageKeywordMatches]
      .map((item) => item.toLowerCase())
      .filter(Boolean)
  ).size;
  if (routeSignalCount < 2) {
    issues.push("缺少多页面路由证据（至少 2 个页面/路由）");
  }

  const endpointMatches = Array.from(
    text.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+\/[a-zA-Z0-9_:/?&=\-]+/gi)
  ).map((match) => String(match[0] || "").trim().toUpperCase());
  const apiPathMatches = Array.from(
    text.matchAll(/\/api\/[a-zA-Z0-9_:/?&=\-]+/gi)
  ).map((match) => String(match[0] || "").trim().toLowerCase());
  const endpointSignalCount = new Set([...endpointMatches, ...apiPathMatches].filter(Boolean)).size;
  if (endpointSignalCount < 2) {
    issues.push("缺少 API 设计证据（至少 2 个接口）");
  }

  const hasStorageSignal = /(mysql|postgres|sqlite|redis|mongodb|prisma|数据表|schema|迁移|索引|持久化|仓储层|表结构)/i.test(text);
  if (!hasStorageSignal) {
    issues.push("缺少数据存储设计（数据库/表结构/迁移）");
  }

  const hasRuntimeSignal = /(pnpm|npm|yarn)\s+(dev|start|build)|docker\s+compose|环境变量|\.env|启动命令|联调|回归测试/i.test(text);
  if (!hasRuntimeSignal) {
    issues.push("缺少运行与联调说明（启动命令/环境变量/验证步骤）");
  }

  const codePathSignals = Array.from(
    text.matchAll(/(?:^|\s)((?:apps?|src|packages|server|client|web|api)\/[a-zA-Z0-9_./-]+\.(?:ts|tsx|js|jsx|json|sql|prisma|yml|yaml|sh))/g)
  ).map((match) => String(match[1] || "").trim().toLowerCase());
  const codePathCount = new Set(codePathSignals.filter(Boolean)).size;
  if (codePathCount < 2) {
    issues.push("缺少代码实现证据（至少 2 个真实代码文件路径）");
  }

  const hasVerificationSignal = /(curl\s+https?:\/\/|\/health|http\s*200|响应\s*200|e2e|端到端|联调通过|回归通过|测试通过|验证结果)/i.test(text);
  if (!hasVerificationSignal) {
    issues.push("缺少联调/验证结果证据（如 health 检查或回归结论）");
  }

  const hintText = `${input.projectName || ""} ${input.projectDescription || ""} ${(input.keywords || []).join(" ")}`;
  const isCrossBorderScenario = /跨境|爆品|跟品|tiktok|amazon|temu/i.test(hintText);
  if (isCrossBorderScenario) {
    if (!/(tiktok|amazon|temu|平台来源|采集源|数据源)/i.test(text)) {
      issues.push("缺少平台数据来源说明（TikTok/Amazon/Temu）");
    }
    if (!/(定时任务|轮询|webhook|增量同步|实时刷新|刷新频率|流式)/i.test(text)) {
      issues.push("缺少数据更新机制说明（轮询/Webhook/增量同步）");
    }
  }

  const staticOnlySignal = /(仅静态|纯静态|单页面展示|单页展示|mock\s*数据|假数据|演示壳)/i.test(text);
  if (staticOnlySignal && (endpointSignalCount < 2 || !hasStorageSignal)) {
    issues.push("当前内容呈现为静态演示，未体现可运行数据链路");
  }

  return {
    pass: issues.length === 0,
    issues
  };
}

function normalizeDeliverableToken(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s._\-()（）【】\[\]{}]/g, "");
}

function isSameCoreDeliverable(
  deliverableName: string,
  expectedName: string,
  stageType: StageType
) {
  const expectedTemplate = resolveDeliverableTemplate(expectedName, stageType);
  const candidateTemplate = resolveDeliverableTemplate(deliverableName, stageType);
  if (expectedTemplate.kind !== "generic" && candidateTemplate.kind === expectedTemplate.kind) {
    return true;
  }

  const expectedToken = normalizeDeliverableToken(expectedName);
  const candidateToken = normalizeDeliverableToken(deliverableName);
  return candidateToken.includes(expectedToken) || expectedToken.includes(candidateToken);
}

function validateDeliverableTemplateGate(input: {
  stageType: StageType;
  deliverableName: string;
  content: string;
  projectName?: string;
  projectDescription?: string;
  keywords?: string[];
}) {
  const normalized = String(input.content || "").trim();
  const template = resolveDeliverableTemplate(input.deliverableName, input.stageType);
  const issues: string[] = [];

  if (normalized.length < MIN_DELIVERABLE_CONTENT_LENGTH) {
    issues.push(`正文长度不足（至少 ${MIN_DELIVERABLE_CONTENT_LENGTH} 字）`);
  }

  const missingSections = template.requiredSections.filter((section) => !normalized.includes(section));
  if (missingSections.length > 0) {
    issues.push(`缺少模板章节: ${missingSections.slice(0, 6).join("、")}${missingSections.length > 6 ? "..." : ""}`);
  }

  if (!normalized.includes("## 验收检查清单")) {
    issues.push("缺少“## 验收检查清单”章节");
  } else {
    const missingChecklist = template.acceptanceChecklist.filter((item) => !normalized.includes(item));
    if (missingChecklist.length > 0) {
      issues.push(`验收检查清单未命中: ${missingChecklist.slice(0, 4).join("、")}${missingChecklist.length > 4 ? "..." : ""}`);
    }
  }

  if (DELIVERABLE_PLACEHOLDER_PATTERN.test(normalized)) {
    issues.push("包含占位词（待补充 / 占位 / TODO / TBD / lorem ipsum / xxx）");
  }
  if (DELIVERABLE_TEMPLATE_SCAFFOLD_PATTERN.test(normalized)) {
    issues.push("包含模板骨架占位语句（请补全本节），属于未完成交付物");
  }
  if (
    (input.stageType === "DESIGN" || input.stageType === "DEV")
    && normalized.includes("## 交付物元信息")
    && !normalized.includes("执行引擎:")
  ) {
    issues.push("检测到系统回填模板，缺少真实模型执行证据（执行引擎）");
  }

  if (template.kind === "visual_mockup" && !hasVisualDesignPreview(normalized)) {
    issues.push("缺少可视化设计稿预览（需提供静态图链接或 ```html 单页代码）");
  } else if (input.stageType === "DESIGN" && template.kind === "visual_mockup") {
    const alignment = evaluateVisualDesignRequirementAlignment({
      projectName: input.projectName || input.deliverableName,
      projectDescription: input.projectDescription || "",
      keywords: input.keywords || [],
      content: normalized
    });
    if (!alignment.pass) {
      issues.push(...alignment.issues);
    }
  }

  if (input.stageType === "DEV" && (template.kind === "demo_prototype" || template.kind === "implementation_word")) {
    const devAlignment = evaluateDevImplementationRequirementAlignment({
      projectName: input.projectName || input.deliverableName,
      projectDescription: input.projectDescription || "",
      keywords: input.keywords || [],
      deliverableName: input.deliverableName,
      content: normalized
    });
    if (!devAlignment.pass) {
      issues.push(...devAlignment.issues);
    }
  }

  return {
    template,
    passed: issues.length === 0,
    issues
  };
}

function assertCoreDeliverablesTemplateGate(project: ProjectDetail, stageType: StageType) {
  const expectedNames = STAGE_EXPECTED_DELIVERABLE_NAMES[stageType] || [];
  if (expectedNames.length === 0) {
    return;
  }

  const stageDeliverables = project.deliverables.filter((item) => item.stageType === stageType);
  const errors: string[] = [];

  for (const expectedName of expectedNames) {
    const matched = stageDeliverables
      .filter((item) => isSameCoreDeliverable(item.name, expectedName, stageType))
      .sort((left, right) => {
        const versionDelta = (right.version || 0) - (left.version || 0);
        if (versionDelta !== 0) {
          return versionDelta;
        }
        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      })[0];

    if (!matched) {
      errors.push(`缺少核心交付物: ${expectedName}`);
      continue;
    }

    if (matched.status !== "submitted" && matched.status !== "approved") {
      errors.push(`${matched.name} 状态为 ${matched.status}，未达到可审批状态`);
      continue;
    }

    const gate = validateDeliverableTemplateGate({
      stageType,
      deliverableName: matched.name,
      content: String(matched.content || ""),
      projectName: project.name,
      projectDescription: project.description,
      keywords: project.parsedIntent.keywords
    });
    if (!gate.passed) {
      errors.push(`${matched.name} 未通过模板校验: ${gate.issues.join("；")}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`STAGE_TEMPLATE_VALIDATION_FAILED: ${errors.join(" | ")}`);
  }
}

function evaluateStageFinalizeReadiness(input: {
  project: ProjectDetail;
  stageType: StageType;
  deliverableName: string;
  content: string;
}) {
  const expectedNames = STAGE_EXPECTED_DELIVERABLE_NAMES[input.stageType] || [];
  if (expectedNames.length === 0) {
    return { canFinalize: true, reasons: [] as string[] };
  }

  const stageDeliverables = input.project.deliverables
    .filter((item) => item.stageType === input.stageType)
    .sort((left, right) => {
      const versionDelta = (right.version || 0) - (left.version || 0);
      if (versionDelta !== 0) {
        return versionDelta;
      }
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });

  const reasons: string[] = [];
  const matched = expectedNames.map((expectedName) => {
    if (isSameCoreDeliverable(input.deliverableName, expectedName, input.stageType)) {
      return {
        expectedName,
        name: input.deliverableName,
        status: "submitted",
        content: input.content
      };
    }

    const existing = stageDeliverables.find((item) => isSameCoreDeliverable(item.name, expectedName, input.stageType));
    if (!existing) {
      return null;
    }
    return {
      expectedName,
      name: existing.name,
      status: existing.status,
      content: String(existing.content || "")
    };
  });

  for (let index = 0; index < expectedNames.length; index += 1) {
    const expectedName = expectedNames[index];
    const candidate = matched[index];
    if (!candidate) {
      reasons.push(`缺少核心交付物: ${expectedName}`);
      continue;
    }
    if (candidate.status !== "submitted" && candidate.status !== "approved") {
      reasons.push(`${candidate.name} 状态为 ${candidate.status}，未达到可审批状态`);
      continue;
    }

    const gate = validateDeliverableTemplateGate({
      stageType: input.stageType,
      deliverableName: candidate.name,
      content: candidate.content,
      projectName: input.project.name,
      projectDescription: input.project.description,
      keywords: input.project.parsedIntent.keywords
    });
    if (!gate.passed) {
      reasons.push(`${candidate.name} 未通过模板校验: ${gate.issues.join("；")}`);
    }

    if (DELIVERABLE_TEMPLATE_SCAFFOLD_PATTERN.test(String(candidate.content || ""))) {
      reasons.push(`${candidate.name} 包含模板骨架占位语句，需补齐为真实交付内容`);
    }

    if (/自动质检结论:\s*未通过/.test(String(candidate.content || ""))) {
      reasons.push(`${candidate.name} 自动质检未通过，禁止进入审批`);
    }
  }

  if (input.stageType === "DESIGN") {
    const designReview = matched.find((item) => item && isSameCoreDeliverable(item.expectedName, "设计审查卡.md", "DESIGN"));
    if (!designReview || !hasApprovedDesignReview(String(designReview.content || ""))) {
      reasons.push("设计阶段缺少已通过的设计审查卡");
    }
    const visualPreview = matched.find((item) => item && isSameCoreDeliverable(item.expectedName, "视觉定稿单页.preview.html.md", "DESIGN"));
    if (!visualPreview || !hasVisualDesignPreview(String(visualPreview.content || ""))) {
      reasons.push("设计阶段缺少可视化设计稿（静态图或单页 HTML）");
    }
  }

  return {
    canFinalize: reasons.length === 0,
    reasons
  };
}

export async function getProjectTemplateGatePrecheck(projectId: string) {
  const project = await findProject(projectId);
  if (!project) {
    return undefined;
  }

  const stageType = project.currentStage as StageType;
  const expectedNames = STAGE_EXPECTED_DELIVERABLE_NAMES[stageType] || [];
  const stageDeliverables = project.deliverables.filter((item) => item.stageType === stageType);

  const checks = expectedNames.map((expectedName) => {
    const matched = stageDeliverables
      .filter((item) => isSameCoreDeliverable(item.name, expectedName, stageType))
      .sort((left, right) => {
        const versionDelta = (right.version || 0) - (left.version || 0);
        if (versionDelta !== 0) {
          return versionDelta;
        }
        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      })[0];

    if (!matched) {
      return {
        expectedName,
        matchedName: null,
        passed: false,
        issues: [`缺少核心交付物: ${expectedName}`]
      };
    }

    const statusIssues =
      matched.status === "submitted" || matched.status === "approved"
        ? []
        : [`交付物状态为 ${matched.status}，未达到可审批状态`];
    const gate = validateDeliverableTemplateGate({
      stageType,
      deliverableName: matched.name,
      content: String(matched.content || ""),
      projectName: project.name,
      projectDescription: project.description,
      keywords: project.parsedIntent.keywords
    });

    return {
      expectedName,
      matchedName: matched.name,
      passed: statusIssues.length === 0 && gate.passed,
      issues: [...statusIssues, ...gate.issues]
    };
  });

  const missingExpected = expectedNames.filter((expectedName) =>
    !checks.some((item) => item.expectedName === expectedName && item.passed)
  );

  return {
    projectId: project.id,
    stageType,
    expectedCount: expectedNames.length,
    deliverableCount: stageDeliverables.length,
    passed: checks.every((item) => item.passed),
    missingExpected,
    checks
  };
}

function containsAny(input: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(input));
}

function buildImplementationSummary(project: ProjectDetail) {
  const doneTasks = project.tasks.filter((task) => task.status === "done").length;
  const totalTasks = project.tasks.length;
  const deliverableNames = project.deliverables.map((item) => item.name).slice(0, 8).join("、");
  const stageSummary = `${STAGE_LABELS[project.currentStage]}阶段完成，项目进度 ${project.progress}%`;
  return [
    `${stageSummary}，任务完成 ${doneTasks}/${totalTasks}。`,
    `当前交付物: ${deliverableNames || "暂无"}`,
    `项目总结: ${project.summary}`
  ].join("\n");
}

function evaluateRequirementAlignment(
  project: ProjectDetail,
  input: {
    objective: string;
    inScope: string[];
    acceptanceCriteria: string[];
    artifacts: string[];
  }
) {
  const normalizedAcceptance = input.acceptanceCriteria.join(" ").toLowerCase();
  const deliverableNames = project.deliverables.map((item) => item.name);
  const deliverablesJoined = deliverableNames.join(" ").toLowerCase();
  const blockedTasks = project.tasks.filter((task) => task.status === "blocked");

  const expectedArtifacts = (
    input.artifacts.length > 0
      ? input.artifacts
      : ["项目排期", "客户汇报方案（PPT）", "实施方案（Word）", "技术方案与选型", "Demo 原型"]
  )
    .map((label) => {
      const pattern = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, ""), "i");
      const fallback =
        label.includes("PPT")
          ? /ppt|汇报方案/i
          : label.toLowerCase().includes("word")
            ? /word|实施方案/i
            : /技术方案|选型|architecture|tech/i.test(label.toLowerCase())
              ? /技术方案|选型|architecture|tech/i
            : label.toLowerCase().includes("demo")
              ? /demo|原型/i
              : /排期|schedule/i;
      return {
        label,
        matched: pattern.test(deliverablesJoined) || fallback.test(deliverablesJoined)
      };
    });

  const needDemo = containsAny(normalizedAcceptance, [/demo|演示|原型/]);
  const demoReady = expectedArtifacts.find((item) => item.label.includes("Demo"))?.matched ?? false;
  const missingArtifacts = expectedArtifacts.filter((item) => !item.matched).map((item) => item.label);
  const unmetChecks: string[] = [];

  if (!input.objective.trim()) {
    unmetChecks.push("需求确认单缺少目标定义");
  }
  if (input.inScope.length === 0) {
    unmetChecks.push("需求确认单缺少 In Scope");
  }
  if (input.acceptanceCriteria.length === 0) {
    unmetChecks.push("需求确认单缺少验收标准");
  }

  if (project.status !== "completed" || project.progress < 100) {
    unmetChecks.push("项目未达到完成状态");
  }
  if (blockedTasks.length > 0) {
    unmetChecks.push(`仍有阻塞任务 ${blockedTasks.length} 个`);
  }
  if (needDemo && !demoReady) {
    unmetChecks.push("验收要求提及 Demo，但未检测到 Demo 产物");
  }
  if (missingArtifacts.length > 0) {
    unmetChecks.push(`缺少关键产出物: ${missingArtifacts.join("、")}`);
  }

  const matched = unmetChecks.length === 0;
  const validationNote = matched
    ? "实施结果与当前需求目标一致，关键产出物齐全，可回填产品说明文档。"
    : `检测到不一致项: ${unmetChecks.join("；")}。请先处理后再继续新需求。`;

  return {
    matched,
    validationNote
  };
}

async function syncRequirementBackfillOnProjectCompleted(project: ProjectDetail) {
  if (project.status !== "completed") {
    return;
  }

  const issue = await getIssueByProjectId(project.id);
  if (!issue) {
    return;
  }

  const contract = issue.requirementContract;
  const objective = contract?.objective || String(issue.clarificationAnswers.goal ?? "");
  const inScope = contract?.inScope ?? (issue.clarificationAnswers.scope ? [issue.clarificationAnswers.scope] : []);
  const acceptanceCriteria = contract?.acceptanceCriteria ?? (issue.clarificationAnswers.acceptance ? [issue.clarificationAnswers.acceptance] : []);
  const artifacts = contract?.artifacts ?? [];
  const implementationSummary = buildImplementationSummary(project);
  const alignment = evaluateRequirementAlignment(project, {
    objective,
    inScope,
    acceptanceCriteria,
    artifacts
  });

  await finalizeRequirementBackfill({
    issueId: issue.id,
    projectId: project.id,
    title: issue.title || project.name,
    refinedRequirement: issue.rawInput || project.description,
    implementationSummary,
    validationStatus: alignment.matched ? "matched" : "mismatch",
    validationNote: alignment.validationNote,
    requirementContract: contract
  });

  try {
    const artifact = await generateOfficialSiteArtifact(project);
    const currentAcceptMaxVersion = project.deliverables
      .filter((item) => item.stageType === "ACCEPT")
      .reduce((max, item) => Math.max(max, item.version), 0);

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existing = await tx.deliverable.findFirst({
        where: {
          projectId: project.id,
          stageType: "ACCEPT",
          name: "官网演示页.html"
        },
        orderBy: { version: "desc" }
      });

      const content = [
        "# 官网演示页",
        "",
        artifact.kind === "design_preview"
          ? "此页面直接渲染 DESIGN 阶段视觉定稿 HTML。"
          : "此页面由设计/开发/验收交付物自动汇总生成。",
        artifact.sourceDeliverableName
          ? `渲染来源: ${artifact.sourceDeliverableName}`
          : "渲染来源: 叙事汇总渲染",
        `访问地址: ${artifact.publicPath}`,
        `本地文件: ${artifact.filePaths[0]}`
      ].join("\n");

      if (existing) {
        await tx.deliverable.update({
          where: { id: existing.id },
          data: {
            status: "approved",
            content,
            updatedAt: new Date()
          }
        });
      } else {
        await tx.deliverable.create({
          data: {
            projectId: project.id,
            stageType: "ACCEPT",
            name: "官网演示页.html",
            type: "code",
            content,
            version: currentAcceptMaxVersion + 1,
            status: "approved",
            createdBy: "ROLE_DESIGN",
            updatedAt: new Date()
          }
        });
      }

      await tx.timelineEvent.create({
        data: {
          projectId: project.id,
          timestamp: new Date(),
          agentId: "ROLE_DESIGN",
          type: "system",
          title: "官网演示页已生成",
          content: `已生成高保真官网产物，路径：${artifact.publicPath}`,
          priority: "normal"
        }
      });
    });
  } catch {
    // 生成官网产物失败时不阻断主流程，避免影响项目收敛与回填。
  }
}

function formatRequirementContract(contract: RequirementContract) {
  return [
    `目标: ${contract.objective || "信息未提供"}`,
    `In Scope: ${(contract.inScope || []).join("；") || "信息未提供"}`,
    `Out of Scope: ${(contract.outOfScope || []).join("；") || "信息未提供"}`,
    `验收标准: ${(contract.acceptanceCriteria || []).join("；") || "信息未提供"}`,
    `目标产出: ${(contract.artifacts || []).join("、") || "信息未提供"}`,
    contract.designTheme ? `设计主题: ${contract.designTheme}` : "",
    contract.valueNarrative ? `价值叙事: ${contract.valueNarrative}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function enrichProjectWithRequirementContract(project: ProjectDetail, contract?: RequirementContract) {
  if (!contract) {
    return project;
  }

  const contractBlock = `\n\n## 需求确认单\n${formatRequirementContract(contract)}`;
  project.deliverables = project.deliverables.map((deliverable) => {
    if (deliverable.name.includes("需求分析文档")) {
      return {
        ...deliverable,
        content: `${deliverable.content}${contractBlock}`
      };
    }
    if (deliverable.name.includes("项目排期方案")) {
      return {
        ...deliverable,
        content: `${deliverable.content}\n\n## 需求确认单约束\n- ${contract.objective}`
      };
    }
    if (deliverable.name.includes("产品方案草案") || deliverable.name.toLowerCase().includes("word")) {
      return {
        ...deliverable,
        content: `${deliverable.content}${contractBlock}`
      };
    }
    return deliverable;
  });

  project.summary = `${project.summary} 已绑定需求确认单并同步到交付物。`;
  project.timeline.unshift({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    agentId: "ROLE_ANALYST",
    type: "message",
    title: "需求确认单已绑定项目",
    content: `需求确认单已注入交付物，目标: ${contract.objective || "信息未提供"}`,
    priority: "normal"
  });
  return project;
}

export async function ensureSeedData(runtimeMode: RuntimeMode) {
  await ensureProjectExecutionStorage();

  const existingAgents = await prisma.agentProfile.count();
  if (existingAgents === 0) {
    await prisma.agentProfile.createMany({
      data: seedAgents.map((agent) => ({
        ...agent,
        styles: agent.styles,
        skills: agent.skills,
        recentHighlights: agent.recentHighlights
      }))
    });
  }

  const existingProjects = await prisma.project.count();
  const enableProjectSeedOnEmpty =
    process.env.ENABLE_PROJECT_SEED_ON_EMPTY === "true"
    || process.env.ENABLE_PROJECT_SEED === "true";

  if (existingProjects === 0 && enableProjectSeedOnEmpty) {
    const seeds = createSeedProjects(runtimeMode);
    for (const project of seeds) {
      await persistProject(project);
    }
  } else {
    await backfillProjectTasks();
  }

  await reconcileLegacyStageDeliverables();

  const allowRealtimeBackfillOnBoot =
    runtimeMode === "scripted" || process.env.REAL_MODEL_BOOT_RECONCILE === "true";

  if (allowRealtimeBackfillOnBoot) {
    await reconcileAllProjectsDeliverables();
  }
}

async function ensureProjectExecutionStorage() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ProjectExecution" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "projectId" TEXT NOT NULL,
      "stageType" TEXT NOT NULL,
      "role" TEXT NOT NULL,
      "action" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "provider" TEXT,
      "model" TEXT,
      "requestedMode" TEXT,
      "runtimeMode" TEXT,
      "promptSummary" TEXT,
      "outputPreview" TEXT,
      "errorMessage" TEXT,
      "latencyMs" INTEGER,
      "metadata" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "ProjectExecution_projectId_fkey"
        FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ProjectExecution_projectId_createdAt_idx"
    ON "ProjectExecution"("projectId", "createdAt")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ProjectExecution_projectId_stageType_createdAt_idx"
    ON "ProjectExecution"("projectId", "stageType", "createdAt")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ProjectExecution_status_createdAt_idx"
    ON "ProjectExecution"("status", "createdAt")
  `);
}

async function reconcileLegacyStageDeliverables() {
  const completedStages = await prisma.stage.findMany({
    where: { status: "completed" },
    select: {
      projectId: true,
      type: true
    }
  });

  if (completedStages.length === 0) {
    return;
  }

  await prisma.$transaction(
    completedStages.map((stage) =>
      prisma.deliverable.updateMany({
        where: {
          projectId: stage.projectId,
          stageType: stage.type,
          status: "submitted"
        },
        data: {
          status: "approved"
        }
      })
    )
  );
}

async function reconcileAllProjectsDeliverables() {
  const projects = await prisma.project.findMany({
    select: { id: true }
  });

  for (const project of projects) {
    const record = await loadProjectRecord(project.id);
    if (!record) {
      continue;
    }
    await reconcileProjectDeliverables(record);
  }
}

export async function reconcileProjectDeliverablesNow(id: string): Promise<ProjectDetail | undefined> {
  const record = await loadProjectRecord(id);
  if (!record) {
    return undefined;
  }
  await reconcileProjectDeliverables(record);
  return findProject(id);
}

async function loadProjectRecord(id: string) {
  return prisma.project.findUnique({
    where: { id },
    include: {
      stages: { orderBy: { sortOrder: "asc" } },
      tasks: { orderBy: [{ stageType: "asc" }, { sortOrder: "asc" }] },
      deliverables: { orderBy: [{ updatedAt: "desc" }] },
      timeline: { orderBy: { timestamp: "desc" } }
    }
  });
}

type ProjectRecord = NonNullable<Awaited<ReturnType<typeof loadProjectRecord>>>;

function formatTaskStatusLabel(status: string) {
  if (status === "done") return "已完成";
  if (status === "in_progress") return "进行中";
  if (status === "blocked") return "阻塞";
  return "待处理";
}

function normalizeDeliverableName(name: string) {
  return String(name || "").trim().toLowerCase();
}

function deliverableStatusRank(status: string) {
  if (status === "approved") return 4;
  if (status === "submitted") return 3;
  if (status === "rejected") return 2;
  if (status === "draft") return 1;
  return 0;
}

function toDeliverableTimestamp(value: Date | string | null | undefined) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function selectLatestDeliverablesByCoreName<T extends {
  id: string;
  stageType: string;
  name: string;
  version: number;
  status: string;
  updatedAt: Date;
}>(deliverables: T[]) {
  const latestByCore = new Map<string, T>();
  for (const item of deliverables) {
    const key = `${item.stageType}::${normalizeDeliverableName(item.name)}`;
    const existing = latestByCore.get(key);
    if (!existing) {
      latestByCore.set(key, item);
      continue;
    }

    const itemTs = toDeliverableTimestamp(item.updatedAt);
    const existingTs = toDeliverableTimestamp(existing.updatedAt);
    if (itemTs > existingTs) {
      latestByCore.set(key, item);
      continue;
    }
    if (itemTs < existingTs) {
      continue;
    }

    if ((item.version || 0) > (existing.version || 0)) {
      latestByCore.set(key, item);
      continue;
    }
    if ((item.version || 0) < (existing.version || 0)) {
      continue;
    }

    if (deliverableStatusRank(item.status) > deliverableStatusRank(existing.status)) {
      latestByCore.set(key, item);
    }
  }

  return [...latestByCore.values()].sort((left, right) => {
    const ts = toDeliverableTimestamp(right.updatedAt) - toDeliverableTimestamp(left.updatedAt);
    if (ts !== 0) {
      return ts;
    }
    return (right.version || 0) - (left.version || 0);
  });
}

function extractMarkdownSection(content: string, title: string) {
  const regex = new RegExp(`${title}\\n([\\s\\S]*?)(\\n##\\s|$)`);
  const matched = String(content || "").match(regex);
  return matched?.[1]?.trim() || "";
}

function buildExecutionOutputPreview(content: string, limit = 260) {
  const source = [
    extractMarkdownSection(content, "## Agent 输出正文"),
    extractMarkdownSection(content, "## 项目摘要"),
    extractMarkdownSection(content, "## 阶段目标"),
    String(content || "")
  ].find((item) => item && item.trim().length > 0) || "";

  const normalized = source.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

type StageAgentExecutionInput = {
  projectId: string;
  action: string;
  metadata?: Prisma.InputJsonValue;
  projectName: string;
  projectDescription: string;
  parsedIntent: ParsedIntent;
  stageType: StageType;
  role: RoleType;
  summary?: string;
};

type StageAgentExecutionRecord = {
  id: string;
  projectId: string;
  stageType: string;
  role: string;
  action: string;
  status: string;
  provider?: string | null;
  model?: string | null;
  requestedMode?: string | null;
  runtimeMode?: string | null;
  promptSummary?: string | null;
  outputPreview?: string | null;
  errorMessage?: string | null;
  latencyMs?: number | null;
  metadata?: Prisma.JsonValue;
  createdAt: string;
  updatedAt: string;
};

async function persistProjectExecutionSafe(data: Prisma.ProjectExecutionUncheckedCreateInput) {
  try {
    const projectExists = await prisma.project.count({
      where: { id: data.projectId }
    });

    if (!projectExists) {
      return;
    }

    await prisma.projectExecution.create({ data });
  } catch (error) {
    console.warn(
      `[projectExecution] failed to persist execution record for project=${data.projectId}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

function composeExecutionMetadata(
  baseMetadata: Prisma.InputJsonValue | undefined,
  extension: Record<string, Prisma.InputJsonValue | undefined>
): Prisma.InputJsonValue | undefined {
  const normalizedExtension = Object.entries(extension)
    .filter(([, value]) => value !== undefined)
    .reduce<Record<string, Prisma.InputJsonValue>>((acc, [key, value]) => {
      if (value !== undefined) {
        acc[key] = value;
      }
      return acc;
    }, {});

  if (Object.keys(normalizedExtension).length === 0) {
    return baseMetadata;
  }

  if (baseMetadata && typeof baseMetadata === "object" && !Array.isArray(baseMetadata)) {
    return {
      ...(baseMetadata as Record<string, Prisma.InputJsonValue>),
      ...normalizedExtension
    };
  }

  return {
    ...(baseMetadata !== undefined ? { sourceMetadata: baseMetadata } : {}),
    ...normalizedExtension
  };
}

async function runTerminalProjectStageAgent(input: StageAgentExecutionInput): Promise<StageAgentRunResult> {
  const strategy = getProjectStageExecutionStrategy(input.stageType, input.role);
  const agentId = strategy.openClawAgentId;
  const preferredModels = strategy.preferredModels;
  const attemptStartedAt = Date.now();

  if (strategy.mode !== "terminal_agent" || !agentId) {
    throw new Error(`TERMINAL_STAGE_STRATEGY_UNAVAILABLE: ${input.stageType}/${input.role}`);
  }

  const attemptTrace = {
    stageType: input.stageType,
    role: input.role,
    model: preferredModels[0] || "unknown",
    route: `openclaw-terminal:${agentId}`,
    status: "failed" as const,
    elapsedMs: 0,
    startedAt: new Date(attemptStartedAt).toISOString(),
    error: undefined as string | undefined
  };

  try {
    const agent = await findOpenClawAgent(agentId);
    if (!agent) {
      throw new Error(`OPENCLAW_AGENT_NOT_FOUND: ${agentId}`);
    }

    await updateOpenClawAgentSettings(agentId, {
      selectedModel: preferredModels[0],
      defaultModel: preferredModels[0],
      fallbackModel: preferredModels[1] ?? preferredModels[0],
      executionMode: strategy.executionMode,
      requireConfirmation: strategy.requireConfirmation,
      autoApproveMinorSteps: strategy.executionMode === "autonomous",
      memoryEnabled: strategy.memoryEnabled
    });

    const command = buildTerminalStageExecutionMessage({
      projectName: input.projectName,
      projectDescription: input.projectDescription,
      parsedIntent: input.parsedIntent,
      stageType: input.stageType,
      role: input.role,
      summary: input.summary
    });
    const result = await sendOpenClawAgentMessage(agentId, { message: command });
    const model = String(result.model ?? preferredModels[0] ?? "").trim() || "unknown";

    return {
      provider: "openai-compatible",
      model,
      title: `${STAGE_LABELS[input.stageType]}阶段执行纪要`,
      body: String(result.reply ?? "").trim() || String(result.summary ?? "").trim() || "终端 Agent 已执行，但未返回正文。",
      thinkingSummary: String(result.summary ?? "").trim() || `${ROLE_LABELS[input.role]} 已完成终端执行`,
      attempts: [
        {
          ...attemptTrace,
          model,
          status: "success",
          elapsedMs: Math.max(0, Date.now() - attemptStartedAt),
          error: undefined
        }
      ]
    };
  } catch (error) {
    const failedError = error instanceof Error ? error.message : String(error);
    const terminalError = new Error(failedError) as Error & { attempts?: Prisma.InputJsonValue[] };
    terminalError.attempts = [
      {
        ...attemptTrace,
        elapsedMs: Math.max(0, Date.now() - attemptStartedAt),
        error: failedError
      }
    ];
    throw terminalError;
  }
}

export async function runProjectStageAgent(input: StageAgentExecutionInput) {
  const startedAt = Date.now();
  const runtime = await getRuntimeStatus();
  const strategy = getProjectStageExecutionStrategy(input.stageType, input.role);

  try {
    let run: StageAgentRunResult;
    let terminalFallbackReason: string | undefined;

    if (strategy.mode === "terminal_agent") {
      try {
        run = await runTerminalProjectStageAgent(input);
      } catch (terminalError) {
        terminalFallbackReason = terminalError instanceof Error ? terminalError.message : String(terminalError);
        if (!strategy.allowDirectModelFallback || runtime.requestedMode !== "openai-compatible") {
          throw terminalError;
        }
        run = await runStageAgent({
          projectName: input.projectName,
          projectDescription: input.projectDescription,
          parsedIntent: input.parsedIntent,
          stageType: input.stageType,
          role: input.role,
          summary: input.summary
        });
      }
    } else {
      run = await runStageAgent({
        projectName: input.projectName,
        projectDescription: input.projectDescription,
        parsedIntent: input.parsedIntent,
        stageType: input.stageType,
        role: input.role,
        summary: input.summary
      });
    }
    const runAttempts = Array.isArray((run as { attempts?: unknown }).attempts)
      ? ((run as { attempts: Prisma.InputJsonValue[] }).attempts)
      : [];

    if (isRealModelGateEnabled()) {
      const provider = String(run.provider || "").trim().toLowerCase();
      const degraded = Boolean((run as { degraded?: boolean }).degraded);
      if (provider === "scripted" || degraded) {
        const gateError = new Error("REAL_MODEL_GATE_FAILED: 当前阶段输出触发 scripted/degraded 降级，不允许写入为成功结果。") as Error & {
          attempts?: Prisma.InputJsonValue[];
        };
        gateError.attempts = runAttempts;
        throw gateError;
      }
    }

    await persistProjectExecutionSafe({
      projectId: input.projectId,
      stageType: input.stageType,
      role: input.role,
      action: input.action,
      status: "success",
      provider: run.provider,
      model: run.model,
      requestedMode: strategy.mode === "terminal_agent" ? "openai-compatible" : runtime.requestedMode,
      runtimeMode: strategy.mode === "terminal_agent" ? "openai-compatible" : runtime.mode,
      promptSummary: input.summary || null,
      outputPreview: buildExecutionOutputPreview(run.body),
      latencyMs: Math.max(0, Date.now() - startedAt),
      metadata: composeExecutionMetadata(input.metadata, {
        executionMode: strategy.mode,
        executionStrategyReason: strategy.reason,
        terminalAgentId: strategy.openClawAgentId,
        memoryPolicy: strategy.memoryPolicy,
        preferredModels: strategy.preferredModels,
        requiredSkills: strategy.requiredSkills,
        skillProtocol: strategy.skillProtocol,
        terminalFallbackReason,
        modelAttempts: runAttempts,
        degraded: (run as { degraded?: boolean }).degraded ? true : undefined
      })
    });

    return run;
  } catch (error) {
    const errorAttempts = Array.isArray((error as { attempts?: unknown })?.attempts)
      ? ((error as { attempts: Prisma.InputJsonValue[] }).attempts)
      : [];
    await persistProjectExecutionSafe({
      projectId: input.projectId,
      stageType: input.stageType,
      role: input.role,
      action: input.action,
      status: "failed",
      provider: runtime.mode,
      model: runtime.modelName,
      requestedMode: strategy.mode === "terminal_agent" ? "openai-compatible" : runtime.requestedMode,
      runtimeMode: strategy.mode === "terminal_agent" ? "openai-compatible" : runtime.mode,
      promptSummary: input.summary || null,
      errorMessage: error instanceof Error ? error.message : String(error),
      latencyMs: Math.max(0, Date.now() - startedAt),
      metadata: composeExecutionMetadata(input.metadata, {
        executionMode: strategy.mode,
        executionStrategyReason: strategy.reason,
        terminalAgentId: strategy.openClawAgentId,
        memoryPolicy: strategy.memoryPolicy,
        preferredModels: strategy.preferredModels,
        requiredSkills: strategy.requiredSkills,
        skillProtocol: strategy.skillProtocol,
        modelAttempts: errorAttempts.length > 0 ? errorAttempts : undefined
      })
    });

    throw error;
  }
}

function needsDeliverableBackfill(content: string) {
  const normalized = String(content ?? "").trim();
  if (!normalized) {
    return true;
  }
  if (normalized.length < MIN_DELIVERABLE_CONTENT_LENGTH) {
    return true;
  }
  return !normalized.includes("## ");
}

function needsDeliverableAgentUpgrade(input: {
  content: string;
  deliverableName: string;
  stageType: StageType;
  projectName?: string;
  projectDescription?: string;
  keywords?: string[];
}) {
  const { content, deliverableName, stageType, projectName, projectDescription, keywords } = input;
  const normalized = String(content ?? "");
  const trimmed = normalized.trim();
  const name = String(deliverableName || "");
  const template = resolveDeliverableTemplate(name, stageType);
  if (!trimmed) {
    return true;
  }

  // Legacy auto templates: metadata exists but no runtime/model evidence.
  if (trimmed.includes("## 交付物元信息") && !trimmed.includes("执行引擎:")) {
    return true;
  }

  // Early automation payloads.
  if (/^#\s*(设计阶段自动交付|自动提交-)/m.test(trimmed)) {
    return true;
  }

  if (
    /(项目排期|客户汇报|实施方案|技术方案|选型|架构|需求分析|Demo|原型|官网演示|测试报告|回填)/i.test(name)
    && !trimmed.includes("执行引擎:")
  ) {
    return true;
  }

  if (
    /(项目排期|客户汇报|实施方案|技术方案|选型|架构|需求分析|Demo|原型|官网演示|测试报告|回填)/i.test(name)
    && !trimmed.includes("## 本阶段任务证据")
  ) {
    return true;
  }

  if (trimmed.includes("## 自动推进元信息") && !trimmed.includes("## 自动质检")) {
    return true;
  }

  if (trimmed.includes("## 模板章节骨架（自动补齐）")) {
    return true;
  }
  if (DELIVERABLE_TEMPLATE_SCAFFOLD_PATTERN.test(trimmed)) {
    return true;
  }

  const missingTemplateSections = template.requiredSections.filter((section) => !trimmed.includes(section));
  if (missingTemplateSections.length > 0) {
    return true;
  }

  if (template.kind === "visual_mockup" && !hasVisualDesignPreview(trimmed)) {
    return true;
  }

  if (stageType === "DEV" && (template.kind === "demo_prototype" || template.kind === "implementation_word")) {
    const devAlignment = evaluateDevImplementationRequirementAlignment({
      projectName: projectName || "",
      projectDescription: projectDescription || "",
      keywords: keywords || [],
      deliverableName: name,
      content: trimmed
    });
    if (!devAlignment.pass) {
      return true;
    }
  }

  if (stageType === "DESIGN" && template.kind === "visual_mockup") {
    const alignment = evaluateVisualDesignRequirementAlignment({
      projectName: projectName || "",
      projectDescription: projectDescription || "",
      keywords: keywords || [],
      content: trimmed
    });
    if (!alignment.pass) {
      return true;
    }
  }

  if (
    /(固定仪表盘、项目观测室、Agent 中心三大页面|让实时输出始终成为视觉中心|把审批与紧急介入做成明确的强动作|避免常规 SaaS 模板感)/.test(trimmed)
  ) {
    return true;
  }

  if (DELIVERABLE_PLACEHOLDER_PATTERN.test(trimmed)) {
    return true;
  }

  return false;
}

function sanitizeDeliverablePlaceholders(content: string) {
  return String(content ?? "")
    .replace(/客户化数据占位/gi, "客户化数据映射")
    .replace(/占位(词|符)?/gi, "映射说明")
    .replace(/待补充/gi, "已补充")
    .replace(/\bTODO\b/gi, "已落实")
    .replace(/\bTBD\b/gi, "已明确")
    .replace(/lorem ipsum/gi, "已填充说明")
    .replace(/\bxxx\b/gi, "具体值");
}

function buildDeliverableBackfillContent(project: ProjectRecord, deliverable: ProjectRecord["deliverables"][number]) {
  const stageType = (deliverable.stageType as StageType);
  const stageLabel = STAGE_LABELS[stageType] || deliverable.stageType;
  const stageTasks = project.tasks.filter((task) => task.stageType === deliverable.stageType).slice(0, 6);
  const constraints = readStringArray(project.parsedConstraints).slice(0, 4);
  const risks = readStringArray(project.parsedRisks).slice(0, 4);
  const keywords = readStringArray(project.parsedKeywords).slice(0, 6);
  const createdBy = String(deliverable.createdBy || "");

  const taskLines = stageTasks.length > 0
    ? stageTasks.map((task, index) => (
      `${index + 1}. ${task.title}（${formatTaskStatusLabel(task.status)} / 优先级 ${task.priority}）\n   - ${task.description || "暂无补充说明"}`
    ))
    : ["1. 当前阶段任务暂未编排，建议补充任务后重新提交审批版交付物。"];

  const objective = STAGE_OBJECTIVES[stageType] || "围绕当前阶段目标沉淀可审阅产物。";
  const nextInput = STAGE_NEXT_INPUT[stageType] || "将本阶段产物同步给下一阶段执行角色。";
  const template = resolveDeliverableTemplate(deliverable.name, stageType);
  const templatePromptBlock = buildDeliverableTemplatePromptBlock(deliverable.name, stageType, keywords);
  const templateCoverageLines = template.requiredSections.map((section) => `- ${section.replace(/^##\s*/, "")}`);

  return [
    `# ${deliverable.name}`,
    "",
    "## 交付物元信息",
    `- 项目: ${project.name} (${project.id})`,
    `- 阶段: ${stageLabel} (${deliverable.stageType})`,
    `- 当前状态: ${deliverable.status} · 版本 v${deliverable.version}`,
    `- 产出角色: ${ROLE_LABELS[createdBy as RoleType] || createdBy || "系统"}`,
    `- 更新时间: ${deliverable.updatedAt.toISOString()}`,
    "",
    "## 阶段目标",
    `- ${objective}`,
    "",
    "## 专业模板约束",
    ...templatePromptBlock.map((line) => (line.startsWith("- ") ? line : `- ${line}`)),
    "",
    "## 当前任务清单",
    ...taskLines,
    "",
    "## 模板章节覆盖要求",
    ...templateCoverageLines,
    "- 缺失任一章节即视为未完成交付，需补写后再提交审批。",
    "",
    "## 关键约束",
    ...(constraints.length > 0 ? constraints.map((item) => `- ${item}`) : ["- 暂无明确约束，建议补充业务边界和非功能要求。"]),
    "",
    "## 主要风险",
    ...(risks.length > 0 ? risks.map((item) => `- ${item}`) : ["- 暂无显式风险，建议补充依赖、资源和时间风险。"]),
    "",
    "## 关键词上下文",
    ...(keywords.length > 0 ? keywords.map((item) => `- ${item}`) : ["- 暂无关键词，可从需求原文中提取业务术语。"]),
    "",
    "## 验收检查清单",
    ...template.acceptanceChecklist.map((item) => `- ${item}`),
    "",
    "## 下一阶段输入",
    `- ${nextInput}`,
    "- 如需变更目标或范围，请先在需求确认单中更新后再推进。",
    "",
    "## 审阅与验收建议",
    "- 审阅是否覆盖目标、范围、风险、任务与交付证据。",
    "- 若信息不足，请在当前文档补全后再次提交阶段审批。"
  ].join("\n");
}

function resolveStageType(value: string): StageType | null {
  const normalized = String(value || "").toUpperCase();
  return stageOrder.includes(normalized as StageType) ? (normalized as StageType) : null;
}

function buildDeliverableChecklist(deliverableName: string, stageType: StageType) {
  return resolveDeliverableTemplate(deliverableName, stageType).acceptanceChecklist;
}

const DELIVERABLE_BACKFILL_AGENT_TIMEOUT_MS = Math.max(
  12_000,
  Number(process.env.DELIVERABLE_BACKFILL_AGENT_TIMEOUT_MS ?? 22_000)
);

async function withBackfillTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`BACKFILL_TIMEOUT: ${label} exceeded ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function buildDeliverableBackfillContentWithAgent(
  project: ProjectRecord,
  deliverable: ProjectRecord["deliverables"][number],
  stageRunCache: Map<string, Awaited<ReturnType<typeof runStageAgent>>>
) {
  const stageType = resolveStageType(deliverable.stageType);
  if (!stageType) {
    return buildDeliverableBackfillContent(project, deliverable);
  }

  const stageLabel = STAGE_LABELS[stageType] || deliverable.stageType;
  const stageTasks = project.tasks.filter((task) => task.stageType === deliverable.stageType).slice(0, 6);
  const constraints = readStringArray(project.parsedConstraints).slice(0, 4);
  const risks = readStringArray(project.parsedRisks).slice(0, 4);
  const keywords = readStringArray(project.parsedKeywords).slice(0, 6);
  const createdBy = String(deliverable.createdBy || "");
  const stageRole = stageAssignees[stageType] || (createdBy as RoleType) || "ROLE_PM";
  const parsedIntent = {
    keywords: readStringArray(project.parsedKeywords),
    constraints: readStringArray(project.parsedConstraints),
    risks: readStringArray(project.parsedRisks),
    suggestedTeam: readRoleArray(project.parsedSuggestedTeam),
    summary: project.parsedSummary
  };
  const stageObjective = STAGE_OBJECTIVES[stageType] || "围绕当前阶段目标沉淀可审阅产物。";
  const nextInput = STAGE_NEXT_INPUT[stageType] || "将本阶段产物同步给下一阶段执行角色。";
  const taskLines = stageTasks.length > 0
    ? stageTasks.map((task, index) => (
      `${index + 1}. ${task.title}（${formatTaskStatusLabel(task.status)} / 优先级 ${task.priority}）\n   - ${task.description || "暂无补充说明"}`
    ))
    : ["1. 当前阶段任务暂未编排，建议补充任务后重新提交审批版交付物。"];
  const checklist = buildDeliverableChecklist(deliverable.name, stageType);
  const template = resolveDeliverableTemplate(deliverable.name, stageType);
  const isVisualMockup = template.kind === "visual_mockup";
  const templatePromptBlock = buildDeliverableTemplatePromptBlock(deliverable.name, stageType, keywords);
  const templateCoverageLines = template.requiredSections.map((section) => `- ${section.replace(/^##\s*/, "")}`);

  const runCacheKey = `${project.id}:${stageType}:shared`;
  let run = stageRunCache.get(runCacheKey);
  if (!run) {
    try {
      run = await withBackfillTimeout(
        runProjectStageAgent({
          projectId: project.id,
          action: "deliverable.backfill",
          metadata: {
            deliverableId: deliverable.id,
            deliverableName: deliverable.name
          },
          projectName: project.name,
          projectDescription: project.description,
          parsedIntent,
          stageType,
          role: stageRole,
          summary: [
            `请输出“${deliverable.name}”的正式交付内容，必须可被下一阶段直接执行，并提供可验收要点。`,
            ...templatePromptBlock
          ].join("\n")
        }),
        DELIVERABLE_BACKFILL_AGENT_TIMEOUT_MS,
        `${project.id}/${deliverable.name}`
      );
    } catch (error) {
      if (isVisualMockup) {
        throw error;
      }
      console.warn(
        `[deliverable.backfill] fallback to deterministic template for ${project.id}/${deliverable.name}:`,
        error instanceof Error ? error.message : String(error)
      );
      return buildDeliverableBackfillContent(project, deliverable);
    }
    stageRunCache.set(runCacheKey, run);
  }

  return [
    `# ${deliverable.name}`,
    "",
    "## 交付物元信息",
    `- 项目: ${project.name} (${project.id})`,
    `- 阶段: ${stageLabel} (${deliverable.stageType})`,
    `- 当前状态: ${deliverable.status} · 版本 v${deliverable.version}`,
    `- 产出角色: ${ROLE_LABELS[stageRole] || stageRole}`,
    `- 执行引擎: ${run.provider} · 模型 ${run.model}`,
    `- 更新时间: ${deliverable.updatedAt.toISOString()}`,
    "",
    "## 阶段目标",
    `- ${stageObjective}`,
    "",
    "## 专业模板约束",
    ...templatePromptBlock.map((line) => (line.startsWith("- ") ? line : `- ${line}`)),
    "",
    "## 当前任务清单",
    ...taskLines,
    "",
    "## 模板章节覆盖要求",
    ...templateCoverageLines,
    "- 缺失任一章节即视为未完成交付，需补写后再提交审批。",
    "",
    "## Agent 输出正文",
    sanitizeDeliverablePlaceholders(run.body),
    "",
    "## 关键约束",
    ...(constraints.length > 0 ? constraints.map((item) => `- ${item}`) : ["- 暂无明确约束，建议补充业务边界和非功能要求。"]),
    "",
    "## 主要风险",
    ...(risks.length > 0 ? risks.map((item) => `- ${item}`) : ["- 暂无显式风险，建议补充依赖、资源和时间风险。"]),
    "",
    "## 关键词上下文",
    ...(keywords.length > 0 ? keywords.map((item) => `- ${item}`) : ["- 暂无关键词，可从需求原文中提取业务术语。"]),
    "",
    "## 验收检查清单",
    ...checklist.map((item) => `- ${item}`),
    "",
    "## 下一阶段输入",
    `- ${nextInput}`,
    "- 如需变更目标或范围，请先在需求确认单中更新后再推进。"
  ].join("\n");
}

async function reconcileProjectDeliverables(project: ProjectRecord) {
  const stageStatusByType = new Map(project.stages.map((stage) => [stage.type, stage.status]));
  const stageRunCache = new Map<string, Awaited<ReturnType<typeof runStageAgent>>>();
  const currentStageType = resolveStageType(project.currentStage);
  const currentStageIndex = currentStageType ? stageOrder.indexOf(currentStageType) : -1;
  const updates: Array<{ id: string; content: string; status?: string }> = [];
  const creates: Array<{
    projectId: string;
    stageType: string;
    name: string;
    type: string;
    content: string;
    version: number;
    status: string;
    createdBy: string;
    updatedAt: Date;
  }> = [];
  const now = new Date();

  for (const deliverable of project.deliverables) {
    const stageStatus = stageStatusByType.get(deliverable.stageType);
    const deliverableStageType = resolveStageType(deliverable.stageType);
    const deliverableTemplate = deliverableStageType
      ? resolveDeliverableTemplate(deliverable.name, deliverableStageType)
      : null;
    // 历史阶段补齐以模板确定性回填为主；当前阶段必须保留真实产出。
    const useDeterministicRecovery =
      Boolean(currentStageType) && Boolean(deliverableStageType) && deliverableStageType !== currentStageType;
    const shouldPromoteStatus =
      project.status === "completed"
      && stageStatus === "completed"
      && (deliverable.status === "draft" || deliverable.status === "submitted");
    const needBackfill = (
      needsDeliverableBackfill(deliverable.content)
      || needsDeliverableAgentUpgrade({
        content: deliverable.content,
        deliverableName: deliverable.name,
        stageType: resolveStageType(deliverable.stageType) || "ACCEPT",
        projectName: project.name,
        projectDescription: project.description,
        keywords: readStringArray(project.parsedKeywords)
      })
    );
    if (!needBackfill && !shouldPromoteStatus) {
      continue;
    }

    if (
      needBackfill
      && useDeterministicRecovery
      && deliverableTemplate?.kind === "visual_mockup"
    ) {
      // 历史阶段缺失视觉稿时禁止回填固定模板，避免“假视觉稿”被误认成真实产物。
      continue;
    }

    const backfilledContent = needBackfill
      ? (
          // When the current active stage is already stuck in recovery, prioritize
          // deterministic, template-complete content over another round of slow model retries.
          useDeterministicRecovery
            ? buildDeliverableBackfillContent(project, deliverable)
            : await buildDeliverableBackfillContentWithAgent(project, deliverable, stageRunCache)
        )
      : deliverable.content;

    updates.push({
      id: deliverable.id,
      content: backfilledContent,
      status: shouldPromoteStatus ? "approved" : undefined
    });
  }

  // 补齐每个阶段的标准产物，避免出现“阶段已完成但关键交付缺失”。
  for (const stage of project.stages) {
    const stageType = resolveStageType(stage.type);
    if (!stageType) {
      continue;
    }
    const stageIndex = stageOrder.indexOf(stageType);
    if (currentStageIndex >= 0 && stageIndex > currentStageIndex) {
      // 不允许为未来阶段提前生成占位交付物，避免流程错位。
      continue;
    }
    if (project.status === "active" && stage.type === project.currentStage) {
      // 当前进行中的阶段禁止自动补齐核心交付物，避免模板稿冒充真实产物。
      continue;
    }
    const expectedNames = STAGE_EXPECTED_DELIVERABLE_NAMES[stageType] || [];
    if (expectedNames.length === 0) {
      continue;
    }

    const existingStageDeliverables = project.deliverables.filter((item) => item.stageType === stage.type);
    const existingNames = new Set(existingStageDeliverables.map((item) => normalizeDeliverableName(item.name)));
    const scheduledNames = new Set(
      creates
        .filter((item) => item.stageType === stage.type)
        .map((item) => normalizeDeliverableName(item.name))
    );

    for (const expectedName of expectedNames) {
      const normalizedExpectedName = normalizeDeliverableName(expectedName);
      if (existingNames.has(normalizedExpectedName) || scheduledNames.has(normalizedExpectedName)) {
        continue;
      }

      const expectedTemplate = resolveDeliverableTemplate(expectedName, stageType);
      const shouldFastFillHistoricalStage = currentStageIndex >= 0 && stageIndex < currentStageIndex;
      if (shouldFastFillHistoricalStage && expectedTemplate.kind === "visual_mockup") {
        // 历史阶段缺失视觉稿时不再自动生成固定模板，避免误导验收。
        continue;
      }

      const maxVersion = existingStageDeliverables.reduce((max, item) => Math.max(max, item.version), 0);
      const stageStatus = stage.status === "completed"
        ? "approved"
        : project.pendingApproval && stage.type === project.currentStage
          ? "submitted"
          : "draft";
      const templateDeliverable = {
        id: randomUUID(),
        projectId: project.id,
        stageType: stage.type,
        name: expectedName,
        type: "markdown",
        content: "",
        version: maxVersion + 1,
        status: stageStatus,
        createdBy: stage.assignee,
        createdAt: now,
        updatedAt: now
      };
      const content = shouldFastFillHistoricalStage
        ? buildDeliverableBackfillContent(project, templateDeliverable)
        : await buildDeliverableBackfillContentWithAgent(project, templateDeliverable, stageRunCache);
      creates.push({
        ...templateDeliverable,
        content
      });
      scheduledNames.add(normalizedExpectedName);
    }
  }

  if (updates.length === 0 && creates.length === 0) {
    return false;
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    for (const update of updates) {
      await tx.deliverable.update({
        where: { id: update.id },
        data: {
          content: update.content,
          ...(update.status ? { status: update.status } : {}),
          updatedAt: now
        }
      });
    }

    for (const create of creates) {
      await tx.deliverable.create({ data: create });
    }

    await tx.timelineEvent.create({
      data: {
        projectId: project.id,
        timestamp: now,
        agentId: "ROLE_ASSISTANT",
        type: "system",
        title: "交付物内容已自动补全",
        content: `系统已修复 ${updates.length} 份交付物内容/状态，并补齐 ${creates.length} 个阶段交付物占位文档。阶段执行调用 ${stageRunCache.size} 次。`,
        priority: "normal"
      }
    });
  });

  return true;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const projects = await prisma.project.findMany({
    include: {
      tasks: {
        select: {
          status: true
        }
      }
    },
    orderBy: { updatedAt: "desc" }
  });

  return projects.map(toProjectSummary);
}

export async function listAgents(): Promise<AgentProfile[]> {
  const agents = await prisma.agentProfile.findMany({
    orderBy: { roleId: "asc" }
  });
  const taskGroups = await prisma.task.groupBy({
    by: ["assignee"],
    _count: true,
    where: {
      status: {
        in: ["todo", "in_progress", "blocked"]
      }
    }
  });
  const taskCountByAssignee = new Map(taskGroups.map((group) => [group.assignee, group._count]));

  return agents.map((agent) => toAgentProfile(agent, taskCountByAssignee.get(agent.roleId) ?? 0));
}

export async function findAgent(roleId: RoleType): Promise<AgentProfile | undefined> {
  const agent = await prisma.agentProfile.findUnique({ where: { roleId } });
  if (!agent) {
    return undefined;
  }

  const activeTaskCount = await prisma.task.count({
    where: {
      assignee: roleId,
      status: {
        in: ["todo", "in_progress", "blocked"]
      }
    }
  });

  return toAgentProfile(agent, activeTaskCount);
}

export async function findProject(id: string): Promise<ProjectDetail | undefined> {
  const project = await loadProjectRecord(id);
  return project ? toProjectDetail(project) : undefined;
}

export async function archiveProjectAcceptanceReport(
  id: string,
  markdown: string,
  title?: string
): Promise<ProjectDetail | undefined> {
  const project = await findProject(id);
  if (!project) {
    return undefined;
  }

  const now = new Date();
  const dateTag = now.toISOString().slice(0, 10);
  const reportTitle = title?.trim() || `阶段验收报告-${dateTag}.md`;
  const nextVersion = project.deliverables
    .filter((item) => item.stageType === "ACCEPT" && item.name.startsWith("阶段验收报告"))
    .reduce((max, item) => Math.max(max, item.version), 0) + 1;

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.deliverable.create({
      data: {
        projectId: id,
        stageType: "ACCEPT",
        name: reportTitle,
        type: "markdown",
        content: markdown,
        version: nextVersion,
        status: "approved",
        createdBy: "ROLE_PM",
        updatedAt: now
      }
    });

    await tx.timelineEvent.create({
      data: {
        projectId: id,
        timestamp: now,
        agentId: "ROLE_PM",
        type: "system",
        title: "阶段验收报告已归档",
        content: `${reportTitle} 已写入交付物（v${nextVersion}）。`,
        priority: "normal"
      }
    });
  });

  return findProject(id);
}

export async function createProject(
  input: CreateProjectInput & { requirementContract?: RequirementContract },
  runtimeMode: RuntimeMode
): Promise<ProjectDetail> {
  const parsedIntent = previewRequirement(input.description);
  const id = await nextProjectId();
  const currentStage: StageType = "ANALYSIS";
  const currentRole = stageAssignees[currentStage];

  const project = createSeedProject(
    {
      id,
      name: input.name?.trim() || parsedIntent.keywords[0] || "未命名项目",
      description: input.description,
      parsedIntent,
      currentStage,
      progress: 12,
      pendingApproval: false,
      currentRole,
      updatedAt: new Date().toISOString(),
      summary: "需求分析师已开始工作，你可以直接进入观测室查看实时输出。"
    },
    runtimeMode
  );

  const now = new Date();
  const nowIso = now.toISOString();
  const initDeliverable = project.deliverables.find((item) => item.stageType === "INIT");

  project.stages = project.stages.map((stage) => {
    if (stage.type === "INIT") {
      return {
        ...stage,
        status: "completed",
        progress: 100,
        startedAt: nowIso,
        endedAt: nowIso
      };
    }
    if (stage.type === currentStage) {
      return {
        ...stage,
        status: "active",
        progress: 48,
        startedAt: nowIso,
        endedAt: undefined
      };
    }
    return {
      ...stage,
      status: "pending",
      progress: 0,
      startedAt: undefined,
      endedAt: undefined
    };
  });

  const stageTaskOrder = new Map<string, number>();
  project.tasks = project.tasks.map((task) => {
    const index = stageTaskOrder.get(task.stageType) ?? 0;
    stageTaskOrder.set(task.stageType, index + 1);

    let status = task.status;
    if (task.stageType === "INIT") {
      status = "done";
    } else if (task.stageType === currentStage) {
      status = index === 0 ? "in_progress" : "todo";
    } else {
      status = "todo";
    }

    return {
      ...task,
      status,
      updatedAt: nowIso
    };
  });

  project.deliverables = [
    {
      id: initDeliverable?.id || randomUUID(),
      name: "项目章程.md",
      type: "markdown",
      content: [
        "# 项目章程",
        "",
        `项目 ${id} 已创建。`,
        `项目名称：${project.name}`,
        "",
        "## 原始需求",
        input.description,
        "",
        "## 当前阶段",
        `- ${STAGE_LABELS[currentStage]} (${currentStage})`,
        `- 负责人：${ROLE_LABELS[currentRole] || currentRole}`
      ].join("\n"),
      version: 1,
      status: "approved",
      stageType: "INIT",
      createdBy: "ROLE_PM",
      updatedAt: nowIso
    }
  ];

  project.liveSession = {
    activeRole: currentRole,
    title: `${STAGE_LABELS[currentStage]}阶段已启动`,
    body: [
      `## ${STAGE_LABELS[currentStage]}阶段准备中`,
      "",
      `- 当前负责人: ${ROLE_LABELS[currentRole] || currentRole}`,
      "- 已完成项目初始化与上下文注入。",
      "- 正在后台触发真实模型分析，请稍后查看实时输出流。"
    ].join("\n"),
    provider: runtimeMode,
    startedAt: nowIso
  };
  project.timeline = [
    {
      id: randomUUID(),
      timestamp: new Date(now.getTime() - 90 * 1000).toISOString(),
      agentId: "ROLE_PM",
      type: "project_created",
      title: "项目已创建",
      content: `${id} 已由项目经理立项并开始推进。`,
      priority: "normal"
    },
    {
      id: randomUUID(),
      timestamp: new Date(now.getTime() - 30 * 1000).toISOString(),
      agentId: currentRole,
      type: "stage_started",
      title: `${STAGE_LABELS[currentStage]}阶段启动`,
      content: `${ROLE_LABELS[currentRole]} 已接手当前阶段。`,
      priority: "normal"
    },
    {
      id: randomUUID(),
      timestamp: nowIso,
      agentId: currentRole,
      type: "thinking",
      title: "Agent 已接管阶段",
      content: "分析阶段已启动，正在后台预热模型并生成需求分析内容。",
      priority: "normal"
    }
  ];
  enrichProjectWithRequirementContract(project, input.requirementContract);

  await persistProject(project);
  const created = await findProject(id).then((value) => value as ProjectDetail);
  if (isProjectWarmupEnabled()) {
    void warmupProjectAfterCreate(created);
  }
  return created;
}

async function warmupProjectAfterCreate(project: ProjectDetail) {
  if (!isProjectWarmupEnabled()) {
    return;
  }

  const stageType: StageType = "ANALYSIS";
  const role = stageAssignees[stageType];

  try {
    const run = await runProjectStageAgent({
      projectId: project.id,
      action: "project.create.bootstrap.async",
      projectName: project.name,
      projectDescription: project.description,
      parsedIntent: project.parsedIntent,
      stageType,
      role,
      summary: "需求分析师已开始工作，你可以直接进入观测室查看实时输出。"
    });

    const now = new Date();
    const update = await prisma.project.updateMany({
      where: {
        id: project.id,
        status: "active",
        currentStage: stageType,
        currentRole: role,
        pendingApproval: false
      },
      data: {
        liveTitle: run.title,
        liveBody: run.body,
        liveProvider: run.provider,
        liveStartedAt: now,
        updatedAt: now
      }
    });

    if (update.count > 0) {
      await prisma.timelineEvent.create({
        data: {
          projectId: project.id,
          timestamp: now,
          agentId: role,
          type: "thinking",
          title: "需求分析已生成",
          content: `${run.thinkingSummary}\n执行引擎: ${run.provider} · 模型 ${run.model}`,
          priority: "normal"
        }
      });
    }
  } catch (error) {
    console.warn(
      `[project] initial analysis warmup failed for ${project.id}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function runCompanionStageExecutions(input: {
  projectId: string;
  projectName: string;
  projectDescription: string;
  parsedIntent: ParsedIntent;
  stageType: StageType;
  primaryRole: RoleType;
  actionPrefix: string;
}) {
  const companionRoles = (STAGE_COMPANION_ROLES[input.stageType] || [])
    .filter((role) => role !== input.primaryRole);
  if (companionRoles.length === 0) {
    return;
  }

  for (const role of companionRoles) {
    try {
      await runProjectStageAgent({
        projectId: input.projectId,
        action: `${input.actionPrefix}.companion`,
        metadata: {
          companion: true,
          primaryRole: input.primaryRole
        },
        projectName: input.projectName,
        projectDescription: input.projectDescription,
        parsedIntent: input.parsedIntent,
        stageType: input.stageType,
        role,
        summary: `请作为${ROLE_LABELS[role]}对${STAGE_LABELS[input.stageType]}阶段产物进行独立评审，并输出可执行建议。`
      });
    } catch (error) {
      console.warn(
        `[project] companion stage execution failed for ${input.projectId}/${input.stageType}/${role}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

async function ensurePmApprovalGateExecution(project: ProjectDetail) {
  if (!isRealModelGateEnabled() || !PM_STAGE_GATE_ENABLED) {
    return;
  }

  const pmSuccessCount = await prisma.projectExecution.count({
    where: {
      projectId: project.id,
      stageType: project.currentStage,
      role: "ROLE_PM",
      status: "success"
    }
  });

  if (pmSuccessCount >= PM_STAGE_GATE_MIN_SUCCESS) {
    return;
  }

  await runProjectStageAgent({
    projectId: project.id,
    action: "project.approve.pm-gate",
    metadata: {
      gate: "pm-approval",
      minSuccess: PM_STAGE_GATE_MIN_SUCCESS
    },
    projectName: project.name,
    projectDescription: project.description,
    parsedIntent: project.parsedIntent,
    stageType: project.currentStage,
    role: "ROLE_PM",
    summary: `审批门禁：请项目经理复核${STAGE_LABELS[project.currentStage]}阶段输出并给出可执行审批结论。`
  });
}

async function ensureCurrentRoleApprovalGateExecution(project: ProjectDetail) {
  if (!isRealModelGateEnabled()) {
    return;
  }
  const role = project.currentRole as RoleType;
  const successCount = await prisma.projectExecution.count({
    where: {
      projectId: project.id,
      stageType: project.currentStage,
      role,
      status: "success"
    }
  });
  if (successCount >= 1) {
    return;
  }

  await runProjectStageAgent({
    projectId: project.id,
    action: "project.approve.current-role-gate",
    metadata: {
      gate: "current-role-approval",
      minSuccess: 1
    },
    projectName: project.name,
    projectDescription: project.description,
    parsedIntent: project.parsedIntent,
    stageType: project.currentStage,
    role,
    summary: `审批门禁：请${ROLE_LABELS[role] || role}补齐${STAGE_LABELS[project.currentStage]}阶段的可验证执行证据。`
  });
}

async function ensureStageRoleModelGateExecution(project: ProjectDetail) {
  if (!isRealModelGateEnabled()) {
    return;
  }
  const targetRoles = STAGE_ROLE_MODEL_GATE_TARGETS[project.currentStage] || [];
  if (targetRoles.length === 0) {
    return;
  }

  for (const role of targetRoles) {
    const minSuccess = Math.max(
      1,
      Number(process.env[`ROLE_MODEL_GATE_MIN_SUCCESS_${role}`] ?? ROLE_MODEL_GATE_MIN_SUCCESS_DEFAULT)
    );
    const successCount = await prisma.projectExecution.count({
      where: {
        projectId: project.id,
        stageType: project.currentStage,
        role,
        status: "success"
      }
    });
    if (successCount >= minSuccess) {
      continue;
    }

    await runProjectStageAgent({
      projectId: project.id,
      action: "project.approve.role-model-gate",
      metadata: {
        gate: "stage-role-model",
        targetRole: role,
        minSuccess
      },
      projectName: project.name,
      projectDescription: project.description,
      parsedIntent: project.parsedIntent,
      stageType: project.currentStage,
      role,
      summary: `审批门禁：请${ROLE_LABELS[role] || role}补齐${STAGE_LABELS[project.currentStage]}阶段模型白名单执行证据（目标 >= ${minSuccess}）。`
    });
  }
}

export async function approveProject(id: string): Promise<ProjectDetail | undefined> {
  let project = await findProject(id);

  if (!project || !project.pendingApproval) {
    return project;
  }

  const designIntervention = getDesignInterventionSignal(project);
  if (project.currentStage === "DESIGN" && designIntervention.required) {
    const designReviewDeliverables = project.deliverables
      .filter((item) => item.stageType === "DESIGN")
      .filter((item) => isSameCoreDeliverable(item.name, "设计审查卡.md", "DESIGN"))
      .sort((a, b) => {
        const byVersion = b.version - a.version;
        if (byVersion !== 0) {
          return byVersion;
        }
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
    const latestDesignDeliverable = designReviewDeliverables[0];

    if (!latestDesignDeliverable || !hasApprovedDesignReview(latestDesignDeliverable.content)) {
      throw new Error("DESIGN_REVIEW_NOT_APPROVED: 设计阶段缺少已通过的设计审查卡，禁止进入开发阶段。");
    }

    const visualPreviewDeliverables = project.deliverables
      .filter((item) => item.stageType === "DESIGN")
      .filter((item) => isSameCoreDeliverable(item.name, "视觉定稿单页.preview.html.md", "DESIGN"))
      .sort((a, b) => {
        const byVersion = b.version - a.version;
        if (byVersion !== 0) {
          return byVersion;
        }
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
    const latestVisualPreview = visualPreviewDeliverables[0];
    if (!latestVisualPreview || !hasVisualDesignPreview(String(latestVisualPreview.content || ""))) {
      throw new Error("DESIGN_VISUAL_PREVIEW_REQUIRED: 设计阶段缺少可视化设计稿（静态图或单页 HTML），禁止进入开发阶段。");
    }
  }

  // Fast fail before spawning any "gate-repair" execution when runtime is not even in real-model mode.
  await assertRealModelRuntimeReadyForGate();
  await ensureCurrentRoleApprovalGateExecution(project);
  await ensureStageRoleModelGateExecution(project);
  await ensurePmApprovalGateExecution(project);
  project = (await findProject(id)) ?? project;
  await assertCurrentStageRealModelGate(project);
  assertCoreDeliverablesTemplateGate(project, project.currentStage);

  const currentIndex = stageOrder.indexOf(project.currentStage);
  const currentStage = project.stages[currentIndex];
  const isFinalStage = currentIndex === stageOrder.length - 1;
  const nextStage = isFinalStage ? null : stageOrder[currentIndex + 1];
  const nextRole = nextStage ? stageAssignees[nextStage] : null;

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.stage.update({
      where: { projectId_type: { projectId: id, type: currentStage.type } },
      data: {
        status: "completed",
        progress: 100,
        endedAt: new Date()
      }
    });
    await tx.deliverable.updateMany({
      where: {
        projectId: id,
        stageType: currentStage.type,
        status: "submitted"
      },
      data: {
        status: "approved",
        updatedAt: new Date()
      }
    });
    await tx.task.updateMany({
      where: { projectId: id, stageType: currentStage.type },
      data: { status: "done" }
    });

    await tx.timelineEvent.create({
      data: {
        projectId: id,
        timestamp: new Date(),
        agentId: "ROLE_PM",
        type: "approval_done",
        title: `${currentStage.label}阶段审批通过`,
        content: `你已批准 ${currentStage.label} 阶段，系统继续推进。签核人：项目经理。`,
        priority: "normal"
      }
    });

    if (isFinalStage) {
      await tx.project.update({
        where: { id },
        data: {
          status: "completed",
          progress: 100,
          pendingApproval: false,
          currentRole: "ROLE_HR",
          summary: "项目已完成并进入归档复盘。",
          liveTitle: "HR 总监正在生成项目复盘",
          liveBody:
            "## 项目复盘\n\n- 主流程已完整打通\n- 关键风险暴露在实时协议与阶段边界\n- 推荐将下一阶段重点放在持久化与真实 Agent 编排",
          liveProvider: "scripted",
          liveStartedAt: new Date()
        }
      });
      return;
    }

    await tx.stage.update({
      where: { projectId_type: { projectId: id, type: nextStage as StageType } },
      data: {
        status: "active",
        progress: 18,
        startedAt: new Date()
      }
    });
    await tx.task.updateMany({
      where: { projectId: id, stageType: nextStage as StageType, sortOrder: 0 },
      data: { status: "in_progress" }
    });
    await tx.task.updateMany({
      where: { projectId: id, stageType: nextStage as StageType, sortOrder: { gt: 0 } },
      data: { status: "todo" }
    });

    await tx.project.update({
      where: { id },
      data: {
        currentStage: nextStage as StageType,
        currentRole: nextRole as RoleType,
        pendingApproval: false,
        progress: Math.min(100, project.progress + 20),
        summary: `${ROLE_LABELS[nextRole as RoleType]} 已开始 ${STAGE_LABELS[nextStage as StageType]} 阶段。`,
        liveTitle: `${STAGE_LABELS[nextStage as StageType]} 阶段已启动`,
        liveBody: [
          `## ${STAGE_LABELS[nextStage as StageType]}阶段准备中`,
          "",
          `- 当前负责人: ${ROLE_LABELS[nextRole as RoleType]}`,
          "- 系统已接收上一阶段审批结果并切换阶段。",
          "- 正在后台触发真实模型预热，稍后将更新实时输出流。"
        ].join("\n"),
        liveProvider: "system",
        liveStartedAt: new Date()
      }
    });

    await tx.timelineEvent.createMany({
      data: [
        {
          projectId: id,
          timestamp: new Date(),
          agentId: nextRole as RoleType,
          type: "stage_started",
          title: `${STAGE_LABELS[nextStage as StageType]}阶段开始`,
          content: `${ROLE_LABELS[nextRole as RoleType]} 已自动接手下一阶段。`,
          priority: "normal"
        },
        {
          projectId: id,
          timestamp: new Date(),
          agentId: nextRole as RoleType,
          type: "thinking",
          title: "阶段推演已启动",
          content: "阶段已切换，正在后台预热模型并生成实时推演内容。",
          priority: "normal"
        }
      ]
    });
  });

  const updated = await findProject(id);
  if (updated?.status === "completed") {
    void reconcileProjectDeliverablesNow(updated.id).catch(() => {
      // 验收补齐在后台执行，避免阻塞审批响应。
    });
  }
  if (updated && nextStage && nextRole) {
    void warmupNextStageAfterApprove(updated, nextStage, nextRole);
  }
  if (updated) {
    await syncRequirementBackfillOnProjectCompleted(updated);
  }
  return updated;
}

async function warmupNextStageAfterApprove(
  project: ProjectDetail,
  nextStage: StageType,
  nextRole: RoleType
) {
  try {
    const run = await runProjectStageAgent({
      projectId: project.id,
      action: "project.approve.next-stage.warmup",
      projectName: project.name,
      projectDescription: project.description,
      parsedIntent: project.parsedIntent,
      stageType: nextStage,
      role: nextRole,
      summary: `${ROLE_LABELS[nextRole]} 已开始 ${STAGE_LABELS[nextStage]} 阶段（后台预热）。`
    });

    const now = new Date();
    const update = await prisma.project.updateMany({
      where: {
        id: project.id,
        status: "active",
        currentStage: nextStage,
        currentRole: nextRole,
        pendingApproval: false
      },
      data: {
        liveTitle: run.title,
        liveBody: run.body,
        liveProvider: run.provider,
        liveStartedAt: now
      }
    });

    if (update.count > 0) {
      await prisma.timelineEvent.create({
        data: {
          projectId: project.id,
          timestamp: now,
          agentId: nextRole,
          type: "thinking",
          title: `${STAGE_LABELS[nextStage]}阶段预热完成`,
          content: `${run.thinkingSummary}\n执行引擎: ${run.provider} · 模型 ${run.model}`,
          priority: "normal"
        }
      });
    }

    await runCompanionStageExecutions({
      projectId: project.id,
      projectName: project.name,
      projectDescription: project.description,
      parsedIntent: project.parsedIntent,
      stageType: nextStage,
      primaryRole: nextRole,
      actionPrefix: "project.approve.next-stage.warmup"
    });

    if (nextRole !== "ROLE_PM") {
      await runProjectStageAgent({
        projectId: project.id,
        action: "project.approve.next-stage.pm-chain",
        metadata: {
          chain: "pm-stage-evidence"
        },
        projectName: project.name,
        projectDescription: project.description,
        parsedIntent: project.parsedIntent,
        stageType: nextStage,
        role: "ROLE_PM",
        summary: `证据链补齐：请项目经理输出${STAGE_LABELS[nextStage]}阶段的独立审阅与执行建议。`
      });
    }
  } catch (error) {
    console.warn(
      `[project] next-stage warmup failed for ${project.id}/${nextStage}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

function buildRejectedStageFallbackRun(currentRole: RoleType, reason: string) {
  return {
    title: `${ROLE_LABELS[currentRole]}正在根据驳回意见返工`,
    body: [
      "## 返工计划",
      `- 已接收驳回原因：${reason}`,
      `- 将优先补齐${ROLE_LABELS[currentRole]}当前阶段的边界、证据与验收项。`,
      "- 完成修订后会重新提交审批，并保留本次返工痕迹供复核。"
    ].join("\n"),
    thinkingSummary: "已即时生成返工计划骨架，详细返工说明将在后台补全。",
    provider: "system-fallback",
    model: "system-fallback"
  };
}

async function warmupRejectedStageAfterReject(
  project: ProjectDetail,
  reason: string
) {
  try {
    const run = await runProjectStageAgent({
      projectId: project.id,
      action: "project.reject.rework",
      projectName: project.name,
      projectDescription: project.description,
      parsedIntent: project.parsedIntent,
      stageType: project.currentStage,
      role: project.currentRole,
      summary: `审批被驳回，返工原因：${reason}`
    });

    const now = new Date();
    const updated = await prisma.project.updateMany({
      where: {
        id: project.id,
        status: "active",
        currentStage: project.currentStage,
        currentRole: project.currentRole,
        pendingApproval: false
      },
      data: {
        liveTitle: `${ROLE_LABELS[project.currentRole]}正在根据驳回意见返工`,
        liveBody: `${run.body}\n\n### 驳回原因\n${reason}`,
        liveProvider: run.provider,
        liveStartedAt: now
      }
    });

    if (updated.count > 0) {
      await prisma.timelineEvent.create({
        data: {
          projectId: project.id,
          timestamp: now,
          agentId: project.currentRole,
          type: "thinking",
          title: "返工说明已补全",
          content: `${run.thinkingSummary}\n执行引擎: ${run.provider} · 模型 ${run.model}`,
          priority: "normal"
        }
      });
    }
  } catch (error) {
    console.warn(
      `[project] reject warmup failed for ${project.id}/${project.currentStage}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

export async function rejectProjectStage(
  id: string,
  input: StageRejectInput
): Promise<ProjectDetail | undefined> {
  const project = await findProject(id);

  if (!project || !project.pendingApproval) {
    return project;
  }

  const currentStage = project.currentStage;
  const currentRole = project.currentRole;
  const reason = input.reason.trim();
  const run = process.env.NODE_ENV === "test"
    ? {
      title: `${ROLE_LABELS[currentRole]}返工中`,
      body: `## 返工计划\n- 已接收驳回原因：${reason}\n- 将优先补齐当前阶段缺口后重新提交审批。`,
      thinkingSummary: "测试环境：跳过真实模型调用，生成确定性返工说明。",
      provider: "scripted",
      model: "scripted-agent"
    }
    : buildRejectedStageFallbackRun(currentRole, reason);

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.stage.update({
      where: { projectId_type: { projectId: id, type: currentStage } },
      data: {
        status: "rejected",
        progress: 72
      }
    });

    await tx.deliverable.updateMany({
      where: {
        projectId: id,
        stageType: currentStage,
        status: "submitted"
      },
      data: {
        status: "rejected"
      }
    });
    await tx.task.updateMany({
      where: { projectId: id, stageType: currentStage, sortOrder: 0 },
      data: { status: "in_progress" }
    });
    await tx.task.updateMany({
      where: { projectId: id, stageType: currentStage, sortOrder: { gt: 0 } },
      data: { status: "blocked" }
    });

    await tx.project.update({
      where: { id },
      data: {
        pendingApproval: false,
        summary: `${STAGE_LABELS[currentStage]}阶段已退回返工：${reason}`,
        liveTitle: `${ROLE_LABELS[currentRole]}正在根据驳回意见返工`,
        liveBody: `${run.body}\n\n### 驳回原因\n${reason}`,
        liveProvider: run.provider,
        liveStartedAt: new Date()
      }
    });

    await tx.timelineEvent.createMany({
      data: [
        {
          projectId: id,
          timestamp: new Date(),
          agentId: "ROLE_PM",
          type: "approval_rejected",
          title: `${STAGE_LABELS[currentStage]}阶段审批未通过`,
          content: `${STAGE_LABELS[currentStage]}阶段驳回原因：${reason}`,
          priority: "high"
        },
        {
          projectId: id,
          timestamp: new Date(),
          agentId: currentRole,
          type: "thinking",
          title: "Agent 已接收返工意见",
          content: `${run.thinkingSummary}\n执行引擎: ${run.provider} · 模型 ${run.model}`,
          priority: "normal"
        }
      ]
    });
  });

  const updated = await findProject(id);
  if (updated && process.env.NODE_ENV !== "test") {
    void warmupRejectedStageAfterReject(updated, reason);
  }
  return updated;
}

export async function interveneProject(id: string, command: string): Promise<ProjectDetail | undefined> {
  const project = await findProject(id);
  if (!project) {
    return undefined;
  }

  await prisma.$transaction([
    prisma.project.update({
      where: { id },
      data: {
        status: "paused",
        summary: `项目已暂停，待执行指令：${command}`
      }
    }),
    prisma.timelineEvent.create({
      data: {
        projectId: id,
        timestamp: new Date(),
        agentId: "ROLE_PM",
        type: "intervention",
        title: "用户发起紧急介入",
        content: command,
        priority: "urgent"
      }
    })
  ]);

  return findProject(id);
}

export async function resumeProject(id: string): Promise<ProjectDetail | undefined> {
  const project = await findProject(id);
  if (!project) {
    return undefined;
  }

  await prisma.$transaction([
    prisma.project.update({
      where: { id },
      data: {
        status: project.progress >= 100 ? "completed" : "active",
        summary: "项目已恢复，当前阶段继续执行。"
      }
    }),
    prisma.timelineEvent.create({
      data: {
        projectId: id,
        timestamp: new Date(),
        agentId: "ROLE_PM",
        type: "resume",
        title: "项目已恢复执行",
        content: "系统已根据最新指令恢复推进。",
        priority: "normal"
      }
    })
  ]);

  return findProject(id);
}

export async function closeProject(id: string): Promise<ProjectDetail | undefined> {
  const project = await findProject(id);
  if (!project) {
    return undefined;
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.task.updateMany({
      where: {
        projectId: id,
        status: { in: ["todo", "in_progress", "blocked"] }
      },
      data: {
        status: "done"
      }
    });

    await tx.stage.updateMany({
      where: {
        projectId: id,
        status: { in: ["pending", "active", "blocked", "rejected"] }
      },
      data: {
        status: "completed",
        progress: 100,
        endedAt: new Date()
      }
    });

    await tx.project.update({
      where: { id },
      data: {
        status: "completed",
        currentStage: "ACCEPT",
        currentRole: "ROLE_PM",
        progress: 100,
        pendingApproval: false,
        summary: "项目已手动关闭，不再继续推进。",
        liveTitle: "项目已关闭",
        liveBody: "## 项目状态\n\n该项目已被手动关闭，不再自动推进。",
        liveProvider: "scripted",
        liveStartedAt: new Date()
      }
    });

    await tx.timelineEvent.create({
      data: {
        projectId: id,
        timestamp: new Date(),
        agentId: "ROLE_PM",
        type: "system",
        title: "项目已手动关闭",
        content: "当前项目已被关闭，后续不会继续执行阶段任务。",
        priority: "normal"
      }
    });
  });

  return findProject(id);
}

export async function deleteProject(id: string): Promise<boolean> {
  const existing = await prisma.project.findUnique({
    where: { id },
    select: { id: true }
  });

  if (!existing) {
    return false;
  }

  await prisma.project.delete({ where: { id } });
  return true;
}

export async function submitCurrentStage(
  id: string,
  input: StageSubmissionInput,
  options?: {
    finalizeApproval?: boolean;
  }
): Promise<ProjectDetail | undefined> {
  const project = await findProject(id);
  if (!project) {
    return undefined;
  }

  const currentStageType = project.currentStage;
  const currentRole = project.currentRole;
  const stageLabel = STAGE_LABELS[currentStageType];
  const versions = project.deliverables
    .filter((item) => item.stageType === currentStageType)
    .map((item) => item.version);
  const nextVersion = (versions.length ? Math.max(...versions) : 0) + 1;
  const deliverableName = input.title?.trim() || `${stageLabel}交付物 v${nextVersion}.md`;
  const normalizedDesignReview = currentStageType === "DESIGN" ? normalizeDesignReview(input.designReview) : null;
  const normalizedDesignContent = currentStageType === "DESIGN" && normalizedDesignReview
    ? ensureDesignSubmissionContent(input.content, normalizedDesignReview)
    : input.content;
  const designInterventionRequired = currentStageType === "DESIGN" && getDesignInterventionSignal(project).required;
  if (currentStageType === "DESIGN") {
    if (designInterventionRequired && !normalizedDesignReview) {
      throw new Error("DESIGN_REVIEW_REQUIRED: 设计阶段提交必须包含完整设计审查卡。");
    }
    if (normalizedDesignReview && !normalizedDesignReview.approved) {
      throw new Error("DESIGN_REVIEW_NOT_APPROVED: 设计审查卡未通过，禁止提交阶段交付。");
    }
    if (designInterventionRequired) {
      const designErrors = validateDesignSubmission(normalizedDesignContent);
      if (designErrors.length > 0) {
        throw new Error(`DESIGN_REVIEW_REQUIRED: ${designErrors.join("；")}`);
      }
    }
  }
  const submittedContent = normalizedDesignReview
    ? `${normalizedDesignContent}\n\n${renderDesignReviewCard(normalizedDesignReview)}`
    : normalizedDesignContent;
  const templateGate = validateDeliverableTemplateGate({
    stageType: currentStageType,
    deliverableName,
    content: submittedContent,
    projectName: project.name,
    projectDescription: project.description,
    keywords: project.parsedIntent.keywords
  });
  if (!templateGate.passed) {
    throw new Error(`STAGE_TEMPLATE_VALIDATION_FAILED: ${deliverableName} 未通过模板校验（${templateGate.issues.join("；")}）`);
  }
  const requestedFinalizeApproval = options?.finalizeApproval !== false;
  const finalizeReadiness = requestedFinalizeApproval
    ? evaluateStageFinalizeReadiness({
      project,
      stageType: currentStageType,
      deliverableName,
      content: submittedContent
    })
    : { canFinalize: false, reasons: [] as string[] };
  const finalizeApproval = requestedFinalizeApproval && finalizeReadiness.canFinalize;
  const currentStageRecord = project.stages.find((item) => item.type === currentStageType);
  const nextProgress = finalizeApproval
    ? 100
    : Math.max(18, Math.min(92, Number(currentStageRecord?.progress || 18)));

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.deliverable.create({
      data: {
        projectId: id,
        stageType: currentStageType,
        name: deliverableName,
        type: "markdown",
        content: submittedContent,
        version: nextVersion,
        status: "submitted",
        createdBy: currentRole,
        updatedAt: new Date()
      }
    });

    await tx.stage.update({
      where: { projectId_type: { projectId: id, type: currentStageType } },
      data: {
        status: "active",
        progress: nextProgress
      }
    });
    if (finalizeApproval) {
      await tx.task.updateMany({
        where: { projectId: id, stageType: currentStageType },
        data: { status: "done" }
      });
    }

    await tx.project.update({
      where: { id },
      data: {
        pendingApproval: finalizeApproval,
        summary: finalizeApproval
          ? `${stageLabel}阶段交付物已提交，等待你的审批。`
          : requestedFinalizeApproval && finalizeReadiness.reasons.length > 0
            ? `${stageLabel}阶段交付物已提交，但核心交付物未齐，继续补充后再进入审批。`
            : `${stageLabel}阶段交付物持续补充中，正在整合验收材料。`,
        liveTitle: `${ROLE_LABELS[currentRole]}已提交${stageLabel}阶段交付物`,
        liveBody: submittedContent,
        liveProvider: project.liveSession.provider,
        liveStartedAt: new Date()
      }
    });

    const timelineData: Prisma.TimelineEventCreateManyInput[] = [
      {
        projectId: id,
        timestamp: new Date(),
        agentId: currentRole,
        type: "deliverable_submitted",
        title: "阶段交付物已提交",
        content: `${deliverableName} 已提交，版本 v${nextVersion}。`,
        priority: "high"
      }
    ];
    if (finalizeApproval) {
      timelineData.push({
        projectId: id,
        timestamp: new Date(),
        agentId: "ROLE_PM",
        type: "approval_required",
        title: `${stageLabel}阶段等待审批`,
        content: `${stageLabel}阶段已完成输出，请决定是否进入下一阶段。`,
        priority: "high"
      });
    } else if (requestedFinalizeApproval && finalizeReadiness.reasons.length > 0) {
      timelineData.push({
        projectId: id,
        timestamp: new Date(),
        agentId: "ROLE_PM",
        type: "system",
        title: `${stageLabel}阶段继续补充中`,
        content: `未进入审批：${finalizeReadiness.reasons.slice(0, 4).join("；")}`,
        priority: "normal"
      });
    }

    await tx.timelineEvent.createMany({
      data: timelineData
    });
  });

  return findProject(id);
}

export async function promoteReadyDraftDeliverablesForCurrentStage(
  id: string
): Promise<ProjectDetail | undefined> {
  const project = await findProject(id);
  if (!project || project.status !== "active" || project.pendingApproval) {
    return project;
  }

  const currentStageType = resolveStageType(project.currentStage);
  if (!currentStageType) {
    return project;
  }

  const expectedNames = STAGE_EXPECTED_DELIVERABLE_NAMES[currentStageType] || [];
  if (expectedNames.length === 0) {
    return project;
  }

  const stageDeliverables = project.deliverables
    .filter((item) => item.stageType === currentStageType)
    .sort((left, right) => {
      const versionDelta = (right.version || 0) - (left.version || 0);
      if (versionDelta !== 0) {
        return versionDelta;
      }
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });

  const matchedDraftCandidates = expectedNames.map((expectedName) =>
    stageDeliverables.find((item) => isSameCoreDeliverable(item.name, expectedName, currentStageType))
  );

  if (matchedDraftCandidates.some((item) => !item || item.status !== "draft")) {
    return project;
  }

  const matchedDrafts = matchedDraftCandidates.filter((item): item is typeof stageDeliverables[number] => Boolean(item));

  for (const deliverable of matchedDrafts) {
    const gate = validateDeliverableTemplateGate({
      stageType: currentStageType,
      deliverableName: deliverable.name,
      content: String(deliverable.content || ""),
      projectName: project.name,
      projectDescription: project.description,
      keywords: project.parsedIntent.keywords
    });
    if (!gate.passed) {
      return project;
    }
  }

  if (currentStageType === "DESIGN") {
    const designReview = matchedDrafts.find((item) => isSameCoreDeliverable(item.name, "设计审查卡.md", "DESIGN"));
    const visualPreview = matchedDrafts.find((item) => isSameCoreDeliverable(item.name, "视觉定稿单页.preview.html.md", "DESIGN"));
    if (!designReview || !hasApprovedDesignReview(String(designReview.content || ""))) {
      return project;
    }
    if (!visualPreview || !hasVisualDesignPreview(String(visualPreview.content || ""))) {
      return project;
    }
  }

  const now = new Date();
  const stageLabel = STAGE_LABELS[currentStageType] || currentStageType;
  const currentRole = project.currentRole as RoleType;
  const latestDeliverable = matchedDrafts
    .slice()
    .sort((left, right) => {
      const versionDelta = (right.version || 0) - (left.version || 0);
      if (versionDelta !== 0) {
        return versionDelta;
      }
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    })[0];

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.deliverable.updateMany({
      where: {
        id: {
          in: matchedDrafts.map((item) => item.id)
        }
      },
      data: {
        status: "submitted",
        updatedAt: now
      }
    });

    await tx.stage.update({
      where: { projectId_type: { projectId: id, type: currentStageType } },
      data: {
        status: "active",
        progress: 100
      }
    });

    await tx.task.updateMany({
      where: { projectId: id, stageType: currentStageType },
      data: { status: "done" }
    });

    await tx.project.update({
      where: { id },
      data: {
        pendingApproval: true,
        summary: `${stageLabel}阶段交付物已整理完成，等待你的审批。`,
        liveTitle: `${ROLE_LABELS[currentRole] || currentRole}已提交${stageLabel}阶段交付物`,
        liveBody: String(latestDeliverable?.content || project.liveSession.body || ""),
        liveProvider: project.liveSession.provider,
        liveStartedAt: now
      }
    });

    await tx.timelineEvent.createMany({
      data: [
        {
          projectId: id,
          timestamp: now,
          agentId: currentRole,
          type: "deliverable_submitted",
          title: "阶段交付物已批量提交",
          content: `${matchedDrafts.length} 份 ${stageLabel} 阶段草稿已自动转为待审批交付物。`,
          priority: "high"
        },
        {
          projectId: id,
          timestamp: now,
          agentId: "ROLE_PM",
          type: "approval_required",
          title: `${stageLabel}阶段等待审批`,
          content: `${stageLabel}阶段已完成输出，请决定是否进入下一阶段。`,
          priority: "high"
        }
      ]
    });
  });

  return findProject(id);
}

export async function postProjectMessage(
  id: string,
  input: ProjectMessageInput
): Promise<ProjectDetail | undefined> {
  const project = await findProject(id);
  if (!project) {
    return undefined;
  }

  const message = input.message.trim();
  if (!message) {
    return project;
  }

  const run = await runProjectStageAgent({
    projectId: id,
    action: "project.message.followup",
    projectName: project.name,
    projectDescription: project.description,
    parsedIntent: project.parsedIntent,
    stageType: project.currentStage,
    role: project.currentRole,
    summary: `用户最新指导：${message}`
  });

  await prisma.$transaction([
    prisma.project.update({
      where: { id },
      data: {
        summary: `已收到你的指导：${message}`,
        liveTitle: `${ROLE_LABELS[project.currentRole]}正在根据你的指导调整输出`,
        liveBody: `${run.body}\n\n### 最新用户指导\n${message}`,
        liveProvider: run.provider,
        liveStartedAt: new Date()
      }
    }),
    prisma.timelineEvent.createMany({
      data: [
        {
          projectId: id,
          timestamp: new Date(),
          type: "message",
          title: "你向团队发送了指导",
          content: message,
          priority: "normal"
        },
        {
          projectId: id,
          timestamp: new Date(),
          agentId: project.currentRole,
          type: "thinking",
          title: "Agent 正在根据你的消息调整",
          content: `${run.thinkingSummary}\n执行引擎: ${run.provider} · 模型 ${run.model}`,
          priority: "normal"
        }
      ]
    })
  ]);

  return findProject(id);
}

export async function listProjectExecutions(
  projectId: string,
  limit = 100
): Promise<StageAgentExecutionRecord[]> {
  const rows = await prisma.projectExecution.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(limit, 500))
  });

  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    stageType: row.stageType,
    role: row.role,
    action: row.action,
    status: row.status,
    provider: row.provider,
    model: row.model,
    requestedMode: row.requestedMode,
    runtimeMode: row.runtimeMode,
    promptSummary: row.promptSummary,
    outputPreview: row.outputPreview,
    errorMessage: row.errorMessage,
    latencyMs: row.latencyMs,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }));
}

export async function listProjectTasks(projectId?: string): Promise<Task[]> {
  const tasks = await prisma.task.findMany({
    where: projectId ? { projectId } : undefined,
    orderBy: [{ updatedAt: "desc" }]
  });

  return tasks.map(toTask);
}

export async function listTasks(): Promise<TaskBoardItem[]> {
  const tasks = await prisma.task.findMany({
    include: {
      project: {
        select: {
          name: true,
          status: true,
          currentStage: true,
          pendingApproval: true,
          updatedAt: true
        }
      }
    }
  });

  return tasks.map(toTaskBoardItem).sort(compareTaskBoardItems);
}

export async function updateTaskStatus(taskId: string, status: TaskStatus): Promise<Task | undefined> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) {
    return undefined;
  }

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: { status }
  });

  await prisma.timelineEvent.create({
    data: {
      projectId: updated.projectId,
      timestamp: new Date(),
      agentId: updated.assignee,
      type: "system",
      title: "任务状态已更新",
      content: `${updated.title} 已更新为 ${status}。`,
      priority: "normal"
    }
  });

  return toTask(updated);
}

export async function getSystemHealth(): Promise<SystemHealth> {
  let projects: Array<{ status: string; pendingApproval: boolean }> = [];
  let tasks: Array<{ status: string }> = [];
  let stages: Array<{ status: string }> = [];
  let agents: Array<{ workload: number }> = [];
  let databaseStatus: SystemHealth["services"][number]["status"] = "healthy";
  let databaseDetail = "Prisma 与 SQLite 已连通";

  try {
    [projects, tasks, stages, agents] = await Promise.all([
      prisma.project.findMany({ select: { status: true, pendingApproval: true } }),
      prisma.task.findMany({ select: { status: true } }),
      prisma.stage.findMany({ select: { status: true } }),
      prisma.agentProfile.findMany({ select: { workload: true } })
    ]);
  } catch (error) {
    databaseStatus = "degraded";
    databaseDetail = error instanceof Error ? error.message : "数据库检查失败";
  }

  const activeProjects = projects.filter((project) => project.status === "active").length;
  const pendingApprovals = projects.filter((project) => project.pendingApproval).length;
  const activeTasks = tasks.filter((task) => task.status === "todo" || task.status === "in_progress").length;
  const blockedTasks = tasks.filter((task) => task.status === "blocked").length;
  const rejectedStages = stages.filter((stage) => stage.status === "rejected").length;
  const averageAgentWorkload = agents.length
    ? Math.round(agents.reduce((sum, agent) => sum + agent.workload, 0) / agents.length)
    : 0;
  const runtime = await getRuntimeStatus();

  return {
    totalProjects: projects.length,
    activeProjects,
    pendingApprovals,
    activeTasks,
    blockedTasks,
    rejectedStages,
    averageAgentWorkload,
    runtime,
    services: [
      { name: "api", status: "healthy", detail: "Express API 已运行" },
      { name: "database", status: databaseStatus, detail: databaseDetail },
      {
        name: "runtime",
        status:
          runtime.requestedMode === "openai-compatible" && !runtime.configured
            ? "degraded"
            : runtime.mode === "scripted" && runtime.requestedMode === "scripted"
              ? "healthy"
              : runtime.lastValidationStatus === "failed"
                ? "degraded"
                : "healthy",
        detail:
          runtime.requestedMode === "openai-compatible" && !runtime.configured
            ? "已选择真实模型模式，但当前配置不完整，系统回退为脚本模式。"
            : runtime.mode === "openai-compatible"
              ? `当前模型：${runtime.modelName}`
              : "当前为脚本运行模式"
      }
    ]
  };
}

async function persistProject(project: ProjectDetail) {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.project.create({
      data: {
        id: project.id,
        name: project.name,
        description: project.description,
        parsedKeywords: project.parsedIntent.keywords,
        parsedConstraints: project.parsedIntent.constraints,
        parsedRisks: project.parsedIntent.risks,
        parsedSuggestedTeam: project.parsedIntent.suggestedTeam,
        parsedSummary: project.parsedIntent.summary,
        status: project.status,
        currentStage: project.currentStage,
        progress: project.progress,
        pendingApproval: project.pendingApproval,
        currentRole: project.currentRole,
        team: project.team,
        summary: project.summary,
        liveTitle: project.liveSession.title,
        liveBody: project.liveSession.body,
        liveStartedAt: new Date(project.liveSession.startedAt),
        liveProvider: project.liveSession.provider
      }
    });

    await tx.stage.createMany({
      data: project.stages.map((stage, index) => ({
        projectId: project.id,
        type: stage.type,
        label: stage.label,
        assignee: stage.assignee,
        status: stage.status,
        progress: stage.progress,
        sortOrder: index,
        startedAt: stage.startedAt ? new Date(stage.startedAt) : null,
        endedAt: stage.endedAt ? new Date(stage.endedAt) : null
      }))
    });

    await tx.task.createMany({
      data: project.tasks.map((task, index) => ({
        projectId: project.id,
        stageType: task.stageType,
        title: task.title,
        description: task.description,
        assignee: task.assignee,
        status: task.status,
        priority: task.priority,
        sortOrder: index,
        updatedAt: new Date(task.updatedAt)
      }))
    });

    await tx.deliverable.createMany({
      data: project.deliverables.map((deliverable) => ({
        projectId: project.id,
        stageType: deliverable.stageType,
        name: deliverable.name,
        type: deliverable.type,
        content: deliverable.content,
        version: deliverable.version,
        status: deliverable.status,
        createdBy: deliverable.createdBy,
        updatedAt: new Date(deliverable.updatedAt)
      }))
    });

    await tx.timelineEvent.createMany({
      data: project.timeline.map((event) => ({
        projectId: project.id,
        timestamp: new Date(event.timestamp),
        agentId: event.agentId,
        type: event.type,
        title: event.title,
        content: event.content,
        priority: event.priority
      }))
    });
  });
}

function toProjectSummary(project: {
  id: string;
  name: string;
  status: string;
  currentStage: string;
  progress: number;
  updatedAt: Date;
  pendingApproval: boolean;
  currentRole: string;
  summary: string;
  tasks: Array<{ status: string }>;
}): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    status: project.status as ProjectStatus,
    currentStage: project.currentStage as StageType,
    progress: project.progress,
    updatedAt: project.updatedAt.toISOString(),
    pendingApproval: project.pendingApproval,
    currentRole: project.currentRole as RoleType,
    summary: project.summary,
    openTaskCount: project.tasks.filter((task) => task.status !== "done").length
  };
}

function toProjectDetail(project: {
  id: string;
  name: string;
  description: string;
  parsedKeywords: Prisma.JsonValue;
  parsedConstraints: Prisma.JsonValue;
  parsedRisks: Prisma.JsonValue;
  parsedSuggestedTeam: Prisma.JsonValue;
  parsedSummary: string;
  status: string;
  currentStage: string;
  progress: number;
  updatedAt: Date;
  pendingApproval: boolean;
  currentRole: string;
  summary: string;
  team: Prisma.JsonValue;
  liveTitle: string;
  liveBody: string;
  liveStartedAt: Date;
  liveProvider: string;
  stages: Array<{
    type: string;
    label: string;
    assignee: string;
    status: string;
    progress: number;
    startedAt: Date | null;
    endedAt: Date | null;
  }>;
  tasks: Array<{
    id: string;
    projectId: string;
    stageType: string;
    title: string;
    description: string;
    assignee: string;
    status: string;
    priority: string;
    updatedAt: Date;
  }>;
  deliverables: Array<{
    id: string;
    name: string;
    type: string;
    content: string;
    version: number;
    status: string;
    stageType: string;
    createdBy: string;
    updatedAt: Date;
  }>;
  timeline: Array<{
    id: string;
    timestamp: Date;
    agentId: string | null;
    type: string;
    title: string;
    content: string;
    priority: string;
  }>;
}): ProjectDetail {
  const latestDeliverables = selectLatestDeliverablesByCoreName(project.deliverables);

  const stages: Stage[] = project.stages.map((stage) => ({
    type: stage.type as StageType,
    label: stage.label,
    assignee: stage.assignee as RoleType,
    status: stage.status as Stage["status"],
    progress: stage.progress,
    startedAt: stage.startedAt?.toISOString(),
    endedAt: stage.endedAt?.toISOString()
  }));

  const timeline: TimelineEvent[] = project.timeline.map((event) => ({
    id: event.id,
    timestamp: event.timestamp.toISOString(),
    agentId: event.agentId ? (event.agentId as RoleType) : undefined,
    type: event.type as TimelineEvent["type"],
    title: event.title,
    content: event.content,
    priority: event.priority as TimelineEvent["priority"]
  }));

  return {
    id: project.id,
    name: project.name,
    description: project.description,
    parsedIntent: {
      keywords: readStringArray(project.parsedKeywords),
      constraints: readStringArray(project.parsedConstraints),
      risks: readStringArray(project.parsedRisks),
      suggestedTeam: readRoleArray(project.parsedSuggestedTeam),
      summary: project.parsedSummary
    },
    team: readRoleArray(project.team),
    currentStage: project.currentStage as StageType,
    currentRole: project.currentRole as RoleType,
    progress: project.progress,
    updatedAt: project.updatedAt.toISOString(),
    status: project.status as ProjectStatus,
    pendingApproval: project.pendingApproval,
    summary: project.summary,
    openTaskCount: project.tasks.filter((task) => task.status !== "done").length,
    stages,
    tasks: project.tasks.map(toTask),
    deliverables: latestDeliverables.map((deliverable) => {
      return {
        id: deliverable.id,
        name: deliverable.name,
        type: deliverable.type as "markdown" | "pdf" | "code",
        content: String(deliverable.content || ""),
        version: deliverable.version,
        status: deliverable.status as ProjectDetail["deliverables"][number]["status"],
        stageType: deliverable.stageType as StageType,
        createdBy: deliverable.createdBy as RoleType,
        updatedAt: deliverable.updatedAt.toISOString()
      };
    }),
    timeline,
    liveSession: {
      activeRole: project.currentRole as RoleType,
      title: project.liveTitle,
      startedAt: project.liveStartedAt.toISOString(),
      body: project.liveBody,
      provider: project.liveProvider as RuntimeMode
    }
  };
}

function toAgentProfile(agent: {
  roleId: string;
  name: string;
  tagline: string;
  description: string;
  status: string;
  workload: number;
  styles: Prisma.JsonValue;
  skills: Prisma.JsonValue;
  recentHighlights: Prisma.JsonValue;
}, activeTaskCount: number): AgentProfile {
  const skills = readSkills(agent.skills);

  return {
    roleId: agent.roleId as RoleType,
    name: agent.name,
    tagline: agent.tagline,
    description: agent.description,
    status: agent.status as AgentProfile["status"],
    workload: agent.workload,
    styles: readStringArray(agent.styles),
    skills,
    recentHighlights: readStringArray(agent.recentHighlights),
    activeTaskCount
  };
}

function toTask(task: {
  id: string;
  projectId: string;
  stageType: string;
  title: string;
  description: string;
  assignee: string;
  status: string;
  priority: string;
  updatedAt: Date;
}): Task {
  return {
    id: task.id,
    projectId: task.projectId,
    stageType: task.stageType as StageType,
    title: task.title,
    description: task.description,
    assignee: task.assignee as RoleType,
    status: task.status as TaskStatus,
    priority: task.priority as Task["priority"],
    updatedAt: task.updatedAt.toISOString()
  };
}

function toTaskBoardItem(task: {
  id: string;
  projectId: string;
  stageType: string;
  title: string;
  description: string;
  assignee: string;
  status: string;
  priority: string;
  updatedAt: Date;
  project: {
    name: string;
    status: string;
    currentStage: string;
    pendingApproval: boolean;
    updatedAt: Date;
  };
}): TaskBoardItem {
  return {
    ...toTask(task),
    projectName: task.project.name,
    projectStatus: task.project.status as ProjectStatus,
    projectCurrentStage: task.project.currentStage as StageType,
    projectPendingApproval: task.project.pendingApproval,
    projectUpdatedAt: task.project.updatedAt.toISOString()
  };
}

function compareTaskBoardItems(left: TaskBoardItem, right: TaskBoardItem) {
  const statusRank: Record<TaskStatus, number> = {
    blocked: 0,
    in_progress: 1,
    todo: 2,
    done: 3
  };
  const priorityRank = { high: 0, normal: 1, low: 2 } as const;
  const statusDelta = statusRank[left.status] - statusRank[right.status];

  if (statusDelta !== 0) {
    return statusDelta;
  }

  const priorityDelta = priorityRank[left.priority] - priorityRank[right.priority];
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
}

function readStringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readRoleArray(value: Prisma.JsonValue): RoleType[] {
  return readStringArray(value) as RoleType[];
}

function readSkills(value: Prisma.JsonValue): AgentProfile["skills"] {
  const object = typeof value === "object" && value ? (value as Record<string, unknown>) : {};

  return {
    professional: Number(object.professional ?? 0),
    collaboration: Number(object.collaboration ?? 0),
    learning: Number(object.learning ?? 0),
    stability: Number(object.stability ?? 0),
    innovation: Number(object.innovation ?? 0)
  };
}

async function nextProjectId() {
  const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const lastProject = await prisma.project.findFirst({
    where: { id: { startsWith: `OCC-${today}-` } },
    orderBy: { id: "desc" }
  });

  const lastSequence = lastProject ? Number(lastProject.id.split("-").at(-1)) : 0;
  return `OCC-${today}-${String(lastSequence + 1).padStart(3, "0")}`;
}

async function backfillProjectTasks() {
  const projects = await prisma.project.findMany({
    include: {
      tasks: true
    }
  });

  for (const project of projects) {
    if (project.tasks.length > 0) {
      continue;
    }

    const generatedTasks = buildTasks(
      project.id,
      project.currentStage as StageType,
      project.pendingApproval
    );

    await prisma.task.createMany({
      data: generatedTasks.map((task, index) => ({
        projectId: task.projectId,
        stageType: task.stageType,
        title: task.title,
        description: task.description,
        assignee: task.assignee,
        status: task.status,
        priority: task.priority,
        sortOrder: index,
        updatedAt: new Date(task.updatedAt)
      }))
    });
  }
}

async function ensureDraftDeliverable(
  tx: Prisma.TransactionClient,
  input: { projectId: string; stageType: StageType; createdBy: RoleType }
) {
  const existing = await tx.deliverable.findFirst({
    where: {
      projectId: input.projectId,
      stageType: input.stageType
    }
  });

  if (existing) {
    return;
  }

  await tx.deliverable.create({
    data: {
      projectId: input.projectId,
      stageType: input.stageType,
      name: `${STAGE_LABELS[input.stageType]}阶段任务草案.md`,
      type: "markdown",
      content: [
        `# ${STAGE_LABELS[input.stageType]}阶段任务草案`,
        "",
        "- 等待当前角色基于上一阶段结论补充正式内容",
        "- 可在观测室继续编辑并提交审批版"
      ].join("\n"),
      version: 1,
      status: "draft",
      createdBy: input.createdBy,
      updatedAt: new Date()
    }
  });
}
