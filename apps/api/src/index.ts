import express from "express";
import cors from "cors";
import helmet from "helmet";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type {
  AuthLoginInput,
  OpenClawBatchAgentMessageInput,
  OpenClawAgentMessageInput,
  OpenClawBatchTaskUpdateInput,
  OpenClawCreateAgentInput,
  OpenClawAgentSettingsInput,
  OpenClawInstructionPreviewInput,
  OpenClawMemoryEntryInput,
  AuthSetupInput,
  InterventionInput,
  OpenClawDocumentUpdateInput,
  OpenClawTaskUpdateInput,
  NotificationInboxUpdateInput,
  PromptTemplateChannel,
  PromptTemplateUpsertInput,
  ProjectMessageInput,
  RuntimeSettingsInput,
  StageRejectInput,
  StageSubmissionInput,
  TaskUpdateInput,
  RoleType,
  StageType
} from "@occ/shared";
import { ROLE_LABELS, STAGE_LABELS } from "@occ/shared";
import {
  ensureSeedData,
  approveProject,
  archiveProjectAcceptanceReport,
  closeProject,
  createProject,
  deleteProject,
  findProject,
  getSystemHealth,
  interveneProject,
  listProjectTasks,
  listProjectExecutions,
  listTasks,
  listProjects,
  runProjectStageAgent,
  postProjectMessage,
  reconcileProjectDeliverablesNow,
  rejectProjectStage,
  resumeProject,
  submitCurrentStage,
  updateTaskStatus
} from "./data/repository.js";
import { getRuntimeStatus, getStageModelPolicy, previewStageModelPlan, getStageModelUsage } from "./agents/runtime.js";
import {
  getRuntimeSettings,
  validateRuntimeSettings,
  updateRuntimeSettings
} from "./system/runtime-config.js";
import { listAuditLogs, writeAuditLog } from "./system/audit-log.js";
import { listNotificationInbox, updateNotificationInboxState } from "./system/notifications.js";
import { createPromptTemplate, listPromptTemplates, markPromptTemplateUsed } from "./system/prompt-templates.js";
import { getSystemReadiness } from "./system/readiness.js";
import {
  getDesignModelPolicyHealth,
  repairDesignModelPolicy
} from "./system/design-model-policy-health.js";
import {
  buildDeliverableTemplatePromptBlock,
  resolveDeliverableTemplate
} from "./system/deliverable-templates.js";
import {
  getCachedLocalAgentMonitorOverview,
  subscribeLocalAgentMonitor,
  ensureLocalAgentMonitorLive
} from "./system/local-agent-monitor.js";
import {
  clearSessionCookie,
  createSessionCookie,
  getAuthStatus,
  loginAdmin,
  logoutAdmin,
  parseSessionToken,
  setupAdmin,
  validateSession
} from "./security/auth.js";
import { previewRequirement } from "./utils/project-parser.js";
import { generateOfficialSiteArtifact } from "./utils/official-site.js";
import {
  buildOpenClawProjectReport,
  createOpenClawAgent,
  findOpenClawAgent,
  findOpenClawProject,
  getOpenClawStatusSummary,
  getOpenClawWorkspace,
  listOpenClawAgentSla,
  listOpenClawAgents,
  listOpenClawProjects,
  addOpenClawAgentMemory,
  previewOpenClawAgentInstruction,
  sendOpenClawBatchAgentMessage,
  sendOpenClawAgentMessage,
  updateOpenClawAgentSettings,
  updateOpenClawProjectTasks,
  updateOpenClawProjectTask,
  updateOpenClawAgentDocument
} from "./openclaw/workspace.js";
import { createModelsRouter } from "./routes/models.js";
import { createAgentsRouter } from "./routes/agents.js";
import { createTeamRouter } from "./routes/team.js";
import { createRoleSetsRouter } from "./routes/role-sets.js";
import { createProductContextRouter } from "./routes/product-context.js";
import { createIssuesRouter } from "./routes/issues.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);
const host = String(process.env.HOST ?? "127.0.0.1").trim() || "127.0.0.1";
const webDistPath = fileURLToPath(new URL("../../web/dist", import.meta.url));
const webGeneratedPath = fileURLToPath(new URL("../../web/public/generated", import.meta.url));
const siteGeneratedPath = fileURLToPath(new URL("../../../site/generated", import.meta.url));
const projectAutoAdvanceIntervalMs = Math.max(5000, Number(process.env.PROJECT_AUTO_ADVANCE_INTERVAL_MS ?? 12000));

const projectAutomationState: {
  enabled: boolean;
  intervalMs: number;
  running: boolean;
  lastRunAt: string | null;
  lastError: string | null;
  lastSummary: string;
} = {
  enabled: process.env.PROJECT_AUTO_ADVANCE !== "false",
  intervalMs: projectAutoAdvanceIntervalMs,
  running: false,
  lastRunAt: null,
  lastError: null,
  lastSummary: "尚未执行"
};

let projectAutomationTimer: ReturnType<typeof setInterval> | null = null;
let projectAutomationKickTimer: ReturnType<typeof setTimeout> | null = null;
const projectAdvanceLocks = new Set<string>();

const STAGE_AUTO_DELIVERABLE_TITLES: Record<StageType, string[]> = {
  INIT: ["项目章程.md"],
  ANALYSIS: ["需求分析文档.md", "项目排期方案.md"],
  DESIGN: ["客户汇报方案.ppt.md", "实施方案说明.word.md", "设计审查卡.md"],
  DEV: ["技术方案与选型.md", "Demo原型说明.md"],
  ACCEPT: ["测试报告.md", "产品说明文档回填.md"]
};

type StageRunAttempt = {
  stageType: StageType;
  role: RoleType;
  model: string;
  route: string;
  status: "success" | "failed" | "skipped";
  elapsedMs: number;
  startedAt: string;
  error?: string;
};

type StageRunSnapshot = {
  provider: string;
  model: string;
  body: string;
  title: string;
  thinkingSummary: string;
  degraded?: boolean;
  attempts?: StageRunAttempt[];
};

type AutoSubmissionQuality = {
  pass: boolean;
  score: number;
  issues: string[];
  diagnostics: string[];
};

type AutoStageSubmission = {
  submission: StageSubmissionInput;
  quality: AutoSubmissionQuality;
};

type ProjectRequiredAction = {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  action: "submit_stage_deliverable" | "open_design_review" | "review_pending_stage" | "resolve_blocked_tasks" | "reconcile_deliverables" | "refresh_runtime";
  ctaLabel: string;
};

const GENERIC_OUTPUT_PATTERNS = [
  /固定仪表盘、项目观测室、Agent 中心三大页面/,
  /让实时输出始终成为视觉中心/,
  /把审批与紧急介入做成明确的强动作/,
  /避免常规 SaaS 模板感/,
  /优先打通数据库、仓储和实时执行流/
];

function buildAutoStageTitle(project: NonNullable<Awaited<ReturnType<typeof findProject>>>) {
  return STAGE_AUTO_DELIVERABLE_TITLES[project.currentStage]?.[0] || `自动提交-${project.currentStage}阶段.md`;
}

async function withProjectLock<T>(projectId: string, task: () => Promise<T>): Promise<T> {
  if (projectAdvanceLocks.has(projectId)) {
    throw new Error("PROJECT_ADVANCE_IN_PROGRESS");
  }
  projectAdvanceLocks.add(projectId);
  try {
    return await task();
  } finally {
    projectAdvanceLocks.delete(projectId);
  }
}

function buildDesignReviewPayload(
  project: NonNullable<Awaited<ReturnType<typeof findProject>>>,
  model: string
): NonNullable<StageSubmissionInput["designReview"]> {
  const keywordLine = project.parsedIntent.keywords.slice(0, 3).join(" / ");
  const visualDirection = keywordLine || (/(苹果|apple)/i.test(`${project.name} ${project.description}`)
    ? "Apple 风格极简官网（大留白、清晰层级、克制动效）"
    : "围绕需求主链路的高可读信息架构");

  return {
    visualDirection,
    brandTone: "专业、明确、可执行",
    uxPrinciples: ["主链路优先", "减少认知切换", "反馈及时可解释"],
    accessibilityChecklist: ["文本对比度达标", "键盘可达", "语义结构完整"],
    approvedBy: "系统自动审查",
    approved: true,
    notes: `自动推进生成，来源模型 ${model}`
  };
}

function buildDesignRequiredSections(
  project: NonNullable<Awaited<ReturnType<typeof findProject>>>,
  title: string
) {
  const keywordLine = project.parsedIntent.keywords.slice(0, 4).join(" / ") || "需求到研发闭环";
  const isAppleStyle = /(苹果|apple)/i.test(`${project.name} ${project.description}`);
  const visualTheme = isAppleStyle
    ? "Apple 风格：克制、清晰、留白、强调内容优先"
    : "可信执行风格：重点突出闭环路径与执行证据";

  return [
    "## 视觉方案",
    `- 目标交付物：${title}`,
    `- 视觉主题：${visualTheme}`,
    `- 核心关键词：${keywordLine}`,
    "- 视觉重心：把“需求输入→协作→执行→验收回填”主链路放在首屏可见区域。",
    "## 版式策略",
    "- 首屏采用价值主张 + 关键 CTA 双列布局，减少多余叙述。",
    "- 中部用流程区块呈现阶段衔接关系，避免离散信息堆叠。",
    "- 底部统一放置演示预约入口与验收证据跳转。",
    "## 组件清单",
    "- Hero 标题/副标题/双 CTA 组件",
    "- 闭环流程时间线组件（5 阶段）",
    "- 执行证据卡片组件（模型、角色、时间、状态）",
    "- 验收与回填组件（产物链接、版本、状态）",
    "## 品牌语气",
    "- 文案风格直接、可执行、避免空泛和夸大。",
    "- 所有模块优先回答“这个功能如何推进需求落地”。",
    "- 结尾必须给出下一步行动与责任角色。"
  ].join("\n");
}

function buildAutoSubmissionChecklist(
  stageType: StageType,
  title: string
) {
  const template = resolveDeliverableTemplate(title, stageType);
  return template.acceptanceChecklist.map((item) => `- ${item}`);
}

function normalizeStageText(input: string) {
  return String(input || "").replace(/\s+/g, " ").trim();
}

function countHits(source: string, items: string[]) {
  if (!source || items.length === 0) {
    return 0;
  }
  const lowered = source.toLowerCase();
  return items.filter((item) => {
    const normalized = String(item || "").trim().toLowerCase();
    return normalized && lowered.includes(normalized);
  }).length;
}

function buildStageTaskEvidence(
  project: NonNullable<Awaited<ReturnType<typeof findProject>>>
) {
  const currentTasks = project.tasks
    .filter((task) => task.stageType === project.currentStage)
    .slice(0, 8);

  if (currentTasks.length === 0) {
    return ["- 当前阶段暂无任务，请先补充任务后再推进审批。"];
  }

  return currentTasks.map((task, index) => (
    `- ${index + 1}. ${task.title}（${task.status} / 优先级 ${task.priority}）\n  - 说明: ${task.description || "待补充"}`
  ));
}

function buildDeliverableSpecificSections(
  stageType: StageType,
  title: string,
  project: NonNullable<Awaited<ReturnType<typeof findProject>>>
) {
  const template = resolveDeliverableTemplate(title, stageType);
  return [
    "## 专业模板约束",
    ...buildDeliverableTemplatePromptBlock(title, stageType, project.parsedIntent.keywords).map((line) => (line.startsWith("- ") ? line : `- ${line}`)),
    "",
    "## 模板章节骨架（请结合 Agent 输出正文补全）",
    ...template.requiredSections.flatMap((section) => ([
      section,
      "- 结合项目上下文补充该章节关键内容。"
    ])),
    "",
    "## 交付细化说明",
    "- 说明本交付物如何作为下一阶段输入。",
    "- 说明可验证证据与审批关注点。"
  ];
}

function summarizeModelAttempts(run: StageRunSnapshot) {
  const attempts = Array.isArray(run.attempts) ? run.attempts : [];
  if (attempts.length === 0) {
    return ["- 无模型尝试记录（可能为脚本模式或旧版本运行）。"];
  }
  return attempts.slice(0, 6).map((attempt, index) => (
    `- ${index + 1}. ${attempt.model} @ ${attempt.route} · ${attempt.status} · ${attempt.elapsedMs}ms${attempt.error ? ` · ${attempt.error}` : ""}`
  ));
}

function evaluateAutoSubmissionQuality(input: {
  project: NonNullable<Awaited<ReturnType<typeof findProject>>>;
  title: string;
  stageType: StageType;
  content: string;
  run: StageRunSnapshot;
}) {
  const normalized = normalizeStageText(input.content);
  const lowered = normalized.toLowerCase();
  const issues: string[] = [];
  const diagnostics: string[] = [];
  let score = 100;
  const strictRealModel = process.env.STRICT_REAL_MODEL_OUTPUT === "true";

  if (input.run.provider === "scripted") {
    score -= strictRealModel ? 42 : 8;
    diagnostics.push("执行模式: scripted（降级）");
    if (strictRealModel) {
      issues.push("当前输出来自 scripted 降级模式，不满足真实模型执行要求。");
    }
  }
  if (input.run.degraded) {
    score -= strictRealModel ? 28 : 6;
    diagnostics.push("执行状态: degraded（真实模型失败后降级）");
    if (strictRealModel) {
      issues.push("真实模型调用失败后降级，内容可靠性不足。");
    }
  }

  if (normalized.length < 900) {
    score -= 20;
    issues.push("正文内容长度不足，交付细节不够完整。");
  }

  const requiredSections = [
    "## 自动推进元信息",
    "## 需求对齐",
    "## 本阶段任务证据",
    "## Agent 输出正文",
    "## 审阅要点"
  ];
  const missing = requiredSections.filter((section) => !input.content.includes(section));
  if (missing.length > 0) {
    score -= missing.length * 10;
    issues.push(`缺少关键章节: ${missing.join("、")}`);
  }

  const keywordHits = countHits(lowered, input.project.parsedIntent.keywords.slice(0, 6));
  diagnostics.push(`关键词命中: ${keywordHits}/${Math.max(1, input.project.parsedIntent.keywords.slice(0, 6).length)}`);
  if (input.project.parsedIntent.keywords.length > 0 && keywordHits < Math.min(2, input.project.parsedIntent.keywords.length)) {
    score -= 12;
    issues.push("与原始需求关键词对齐不足。");
  }

  const constraints = input.project.parsedIntent.constraints.slice(0, 4);
  const constraintHits = countHits(lowered, constraints);
  diagnostics.push(`约束命中: ${constraintHits}/${Math.max(1, constraints.length)}`);
  if (constraints.length > 0 && constraintHits === 0) {
    score -= 10;
    issues.push("未覆盖关键约束条件。");
  }

  const stageTasks = input.project.tasks
    .filter((task) => task.stageType === input.stageType)
    .slice(0, 6);
  const taskTitleHits = countHits(lowered, stageTasks.map((task) => task.title));
  diagnostics.push(`任务证据命中: ${taskTitleHits}/${Math.max(1, stageTasks.length)}`);
  if (stageTasks.length > 0 && taskTitleHits < Math.min(2, stageTasks.length)) {
    score -= 14;
    issues.push("未充分引用本阶段任务证据，缺少可追溯性。");
  }

  const genericHits = GENERIC_OUTPUT_PATTERNS.filter((pattern) => pattern.test(input.content)).length;
  if (genericHits >= 2) {
    score -= 16;
    issues.push("命中多条历史模板化文案，存在泛化输出风险。");
  }

  const template = resolveDeliverableTemplate(input.title, input.stageType);
  const missingTemplateSections = template.requiredSections.filter((section) => !input.content.includes(section));
  if (missingTemplateSections.length > 0) {
    score -= Math.min(18, missingTemplateSections.length * 3);
    issues.push(`未完整覆盖专业模板章节: ${missingTemplateSections.slice(0, 4).join("、")}${missingTemplateSections.length > 4 ? "..." : ""}`);
  }

  const pass = score >= 72 && issues.length === 0;
  return {
    pass,
    score: Math.max(0, Math.min(100, score)),
    issues,
    diagnostics
  } satisfies AutoSubmissionQuality;
}

function isAutoApprovalReady(project: NonNullable<Awaited<ReturnType<typeof findProject>>>) {
  const currentStageDeliverables = project.deliverables
    .filter((item) => item.stageType === project.currentStage)
    .sort((left, right) => right.version - left.version);
  const latest = currentStageDeliverables[0];
  if (!latest) {
    return false;
  }
  const content = String(latest.content || "");
  if (!content.includes("## 自动质检")) {
    return false;
  }
  return /自动质检结论:\s*通过/.test(content);
}

function hasApprovedDesignReview(content: string) {
  const source = String(content || "");
  return source.includes("## 设计审查卡") && /审查结论:\s*通过/.test(source);
}

function buildProjectRequiredActions(
  project: NonNullable<Awaited<ReturnType<typeof findProject>>>,
  runtime?: Awaited<ReturnType<typeof getRuntimeStatus>>
) {
  const actions: ProjectRequiredAction[] = [];
  const currentStageDeliverables = project.deliverables
    .filter((item) => item.stageType === project.currentStage)
    .sort((left, right) => right.version - left.version);

  if (project.pendingApproval) {
    if (currentStageDeliverables.length === 0) {
      actions.push({
        id: "missing-stage-deliverable",
        severity: "critical",
        title: "当前阶段缺少交付物，无法验收",
        detail: `请先提交 ${STAGE_LABELS[project.currentStage] || project.currentStage} 阶段交付物，再执行审批。`,
        action: "submit_stage_deliverable",
        ctaLabel: "前往提交交付物"
      });
    }

    const notReady = currentStageDeliverables.filter((item) => !isDeliverableReadyForAcceptance({
      status: item.status,
      content: item.content
    }));
    if (notReady.length > 0) {
      actions.push({
        id: "deliverable-not-ready",
        severity: "warning",
        title: "交付物内容不完整或质检未通过",
        detail: `待补足交付物：${notReady.map((item) => item.name).join("、")}。请补全内容并重新提交。`,
        action: "reconcile_deliverables",
        ctaLabel: "重建交付物内容"
      });
    }

    if (project.currentStage === "DESIGN" && !currentStageDeliverables.some((item) => hasApprovedDesignReview(String(item.content || "")))) {
      actions.push({
        id: "design-review-required",
        severity: "critical",
        title: "设计阶段缺少通过的设计审查卡",
        detail: "请补充完整设计审查卡（视觉方案、版式策略、组件清单、品牌语气）并通过审查。",
        action: "open_design_review",
        ctaLabel: "提交设计审查卡"
      });
    }

    if (isAutoApprovalReady(project)) {
      actions.push({
        id: "ready-for-review",
        severity: "info",
        title: "当前阶段已具备验收条件",
        detail: "请执行人工验收决策（通过或驳回），以推进下一阶段。",
        action: "review_pending_stage",
        ctaLabel: "执行阶段验收"
      });
    }
  } else if (project.currentStage === "DESIGN" && currentStageDeliverables.length === 0) {
    actions.push({
      id: "design-phase-no-deliverable",
      severity: "info",
      title: "设计阶段尚未提交交付物",
      detail: "建议先完成设计审查卡，再提交设计交付物，避免后续阶段返工。",
      action: "open_design_review",
      ctaLabel: "填写设计审查卡"
    });
  }

  const blockedTasks = project.tasks.filter((task) => task.stageType === project.currentStage && task.status === "blocked");
  if (blockedTasks.length > 0) {
    actions.push({
      id: "blocked-tasks",
      severity: "warning",
      title: "当前阶段存在阻塞任务",
      detail: `阻塞任务 ${blockedTasks.length} 个：${blockedTasks.slice(0, 3).map((task) => task.title).join("、")}${blockedTasks.length > 3 ? "..." : ""}`,
      action: "resolve_blocked_tasks",
      ctaLabel: "前往处理阻塞任务"
    });
  }

  if (runtime && runtime.requestedMode === "openai-compatible" && !runtime.configured) {
    actions.push({
      id: "runtime-not-configured",
      severity: "critical",
      title: "真实模型未配置完整，当前可能降级执行",
      detail: "请补全 API Base URL / API Key / Model，确保阶段输出来自真实模型调用。",
      action: "refresh_runtime",
      ctaLabel: "检查运行时配置"
    });
  }

  if (
    runtime
    && runtime.requestedMode === "openai-compatible"
    && runtime.configured
    && String(project.liveSession?.provider || "").trim().toLowerCase() === "scripted"
  ) {
    actions.push({
      id: "runtime-degraded",
      severity: "warning",
      title: "当前阶段已降级到脚本输出",
      detail: "真实模型调用连续失败（如 401/超时），请检查模型通道、密钥权限与可用模型策略后重试。",
      action: "refresh_runtime",
      ctaLabel: "修复模型通道"
    });
  }

  return actions;
}

function formatRequiredActionsMessage(actions: ProjectRequiredAction[]) {
  if (actions.length === 0) {
    return "当前流程需要你补充信息后再继续。";
  }
  const lines = actions
    .slice(0, 3)
    .map((action, index) => `${index + 1}. ${action.title}（${action.ctaLabel}）`);
  return `当前流程需要你先补足以下事项：\n${lines.join("\n")}`;
}

async function buildAutoStageSubmissions(
  project: NonNullable<Awaited<ReturnType<typeof findProject>>>,
  options?: {
    action?: string;
    metadata?: Prisma.InputJsonValue;
  }
): Promise<AutoStageSubmission[]> {
  const titles = STAGE_AUTO_DELIVERABLE_TITLES[project.currentStage] || [buildAutoStageTitle(project)];
  const submissions: AutoStageSubmission[] = [];
  const templateGuidance = titles.flatMap((title) => {
    const template = resolveDeliverableTemplate(title, project.currentStage as StageType);
    return [
      `[${title}] -> ${template.label}`,
      ...buildDeliverableTemplatePromptBlock(title, project.currentStage as StageType, project.parsedIntent.keywords)
        .map((line) => `  ${line}`)
    ];
  });
  const run = await runProjectStageAgent({
    projectId: project.id,
    action: options?.action || "stage.auto_submission",
    metadata: options?.metadata,
    projectName: project.name,
    projectDescription: project.description,
    parsedIntent: project.parsedIntent,
    stageType: project.currentStage as StageType,
    role: project.currentRole as RoleType,
    summary: [
      `请围绕原始需求输出当前阶段完整交付内容，供以下交付物复用：${titles.join("、")}`,
      "必须引用至少 3 个需求关键词、2 个当前阶段任务标题，并给出可验收条目与下一阶段输入。",
      "以下是交付模板约束（请严格遵循）：",
      ...templateGuidance
    ].join("\n")
  });
  const stageTaskEvidence = buildStageTaskEvidence(project);
  const attemptsSummary = summarizeModelAttempts(run as StageRunSnapshot);
  const runGeneratedAt = new Date().toISOString();

  for (const title of titles) {
    const checklist = buildAutoSubmissionChecklist(project.currentStage as StageType, title);
    const template = resolveDeliverableTemplate(title, project.currentStage as StageType);
    const deliverableSpecificSections = buildDeliverableSpecificSections(project.currentStage as StageType, title, project);
    let content = [
      `# ${title}`,
      "",
      "## 自动推进元信息",
      `- 项目: ${project.name} (${project.id})`,
      `- 阶段: ${STAGE_LABELS[project.currentStage]} (${project.currentStage})`,
      `- 执行角色: ${ROLE_LABELS[project.currentRole] || project.currentRole}`,
      `- 执行引擎: ${run.provider} · 模型 ${run.model}`,
      `- 生成时间: ${runGeneratedAt}`,
      "",
      "## 模型尝试轨迹",
      ...attemptsSummary,
      "",
      "## 需求对齐",
      `- 原始需求: ${project.description}`,
      `- 关键词: ${project.parsedIntent.keywords.join(" / ") || "无"}`,
      `- 约束: ${project.parsedIntent.constraints.join("；") || "无"}`,
      `- 风险: ${project.parsedIntent.risks.join("；") || "无"}`,
      "",
      "## 本阶段任务证据",
      ...stageTaskEvidence,
      "",
      "## Agent 输出正文",
      run.body,
      "",
      "## 交付聚焦",
      `- 当前交付物: ${title}`,
      `- 交付目的: ${STAGE_LABELS[project.currentStage]}阶段可验收产物，支撑后续确认与推进`,
      "",
      "## 模板章节骨架（自动补齐）",
      ...template.requiredSections.flatMap((section) => ([section, "- 待补充：请结合本阶段任务证据与 Agent 正文完善本节。"])),
      "",
      "## 验收检查清单",
      ...template.acceptanceChecklist.map((item) => `- ${item}`),
      "",
      ...deliverableSpecificSections,
      "",
      "## 审阅要点",
      ...checklist
    ].join("\n");

    const quality = evaluateAutoSubmissionQuality({
      project,
      title,
      stageType: project.currentStage as StageType,
      content,
      run: run as StageRunSnapshot
    });

    content = [
      content,
      "",
      "## 自动质检",
      `- 自动质检结论: ${quality.pass ? "通过" : "待补充"}`,
      `- 质量评分: ${quality.score}/100`,
      ...quality.diagnostics.map((item) => `- ${item}`),
      ...(quality.issues.length > 0 ? ["- 风险项:", ...quality.issues.map((item) => `  - ${item}`)] : ["- 风险项: 无"])
    ].join("\n");

    const submission: StageSubmissionInput = {
      title,
      content
    };

    if (project.currentStage === "DESIGN") {
      content = `${content}\n\n${buildDesignRequiredSections(project, title)}`;
      submission.content = content;
      submission.designReview = buildDesignReviewPayload(project, run.model);
    }

    submissions.push({
      submission,
      quality
    });
  }

  return submissions;
}

async function buildAutoStageSubmission(
  project: NonNullable<Awaited<ReturnType<typeof findProject>>>,
  options?: {
    action?: string;
    metadata?: Prisma.InputJsonValue;
  }
) {
  const submissions = await buildAutoStageSubmissions(project, options);
  return submissions[0]?.submission || {
    title: buildAutoStageTitle(project),
    content: `# ${buildAutoStageTitle(project)}\n\n暂无自动内容，请手动补充。`
  };
}

async function submitStageSubmissionBundle(
  projectId: string,
  submissions: AutoStageSubmission[]
) {
  if (submissions.length === 0) {
    return;
  }

  for (let index = 0; index < submissions.length; index += 1) {
    const submission = submissions[index].submission;
    const isLast = index === submissions.length - 1;
    await submitCurrentStage(projectId, submission, {
      finalizeApproval: isLast
    });
  }
}

async function runProjectAutomationTick(options?: { force?: boolean }) {
  const force = options?.force === true;

  if ((!projectAutomationState.enabled && !force) || projectAutomationState.running) {
    return;
  }

  projectAutomationState.running = true;
  const runStartedAt = new Date().toISOString();

  try {
    const summaries = await listProjects();
    const activeProjects = summaries.filter((project) => project.status === "active");

    let advanced = 0;
    let approved = 0;
    let skipped = 0;
    let failed = 0;
    let awaitingConfirmation = 0;
    let firstError: string | null = null;

    for (const summary of activeProjects) {
      if (projectAdvanceLocks.has(summary.id)) {
        skipped += 1;
        continue;
      }

      try {
        await withProjectLock(summary.id, async () => {
          const project = await findProject(summary.id);
          if (!project || project.status !== "active") {
            skipped += 1;
            return;
          }

          if (project.pendingApproval) {
            skipped += 1;
            awaitingConfirmation += 1;
            firstError = firstError ?? `project ${project.id} pending user confirmation`;
            return;
          }

          const submissions = await buildAutoStageSubmissions(project, {
            action: "stage.auto_submission.automation"
          });
          await submitStageSubmissionBundle(project.id, submissions);

          const refreshed = await findProject(project.id);
          if (refreshed?.pendingApproval) {
            awaitingConfirmation += 1;
            const qualityPass = submissions.every((item) => item.quality.pass);
            if (!qualityPass) {
              firstError = firstError ?? `project ${project.id} has pending quality issues, waiting for manual confirmation`;
            } else {
              firstError = firstError ?? `project ${project.id} is waiting for manual stage confirmation`;
            }
          }
          advanced += 1;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "project automation failed";
        if (message === "PROJECT_ADVANCE_IN_PROGRESS") {
          skipped += 1;
        } else {
          failed += 1;
          firstError = firstError ?? message;
        }
      }
    }

    projectAutomationState.lastRunAt = runStartedAt;
    projectAutomationState.lastError = firstError;
    projectAutomationState.lastSummary = `active=${activeProjects.length}, advanced=${advanced}, approved=${approved}, awaitingConfirmation=${awaitingConfirmation}, skipped=${skipped}, failed=${failed}`;
  } catch (error) {
    projectAutomationState.lastRunAt = runStartedAt;
    projectAutomationState.lastError = error instanceof Error ? error.message : "unknown automation error";
    projectAutomationState.lastSummary = "执行失败";
  } finally {
    projectAutomationState.running = false;
  }
}

function kickProjectAutomationTick() {
  if (!projectAutomationState.enabled) {
    return;
  }

  if (projectAutomationKickTimer) {
    return;
  }

  projectAutomationKickTimer = setTimeout(() => {
    projectAutomationKickTimer = null;
    void runProjectAutomationTick();
  }, 150);
}

function restartProjectAutomationTicker() {
  if (projectAutomationTimer) {
    clearInterval(projectAutomationTimer);
    projectAutomationTimer = null;
  }

  projectAutomationTimer = setInterval(() => {
    void runProjectAutomationTick();
  }, projectAutomationState.intervalMs);
}

type AcceptanceStageReport = {
  stageType: string;
  stageLabel: string;
  assignee: string;
  status: string;
  progress: number;
  startedAt?: string;
  endedAt?: string;
  deliverables: {
    total: number;
    approved: number;
    submitted: number;
    rejected: number;
    draft: number;
    latestUpdatedAt?: string;
  };
  acceptance: {
    result: "approved" | "rejected" | "pending" | "none";
    note: string;
  };
};

type AcceptanceSignoffRecord = {
  id: string;
  timestamp: string;
  stageType?: string;
  stageLabel: string;
  decision: "approved" | "rejected" | "pending";
  actor: string;
  reason: string;
};

type AcceptanceReportSnapshot = {
  generatedAt: string;
  status: string;
  currentStage: string;
  summary: {
    deliverableCount: number;
    approvedDeliverables: number;
    blockedTasks: number;
    inProgressTasks: number;
    completedTasks: number;
    signoffApproved: number;
    signoffRejected: number;
    signoffPending: number;
  };
};

type AcceptanceReportComparison = {
  baselineName: string;
  baselineGeneratedAt: string;
  note: string;
  delta: {
    deliverableCount: number;
    approvedDeliverables: number;
    blockedTasks: number;
    inProgressTasks: number;
    completedTasks: number;
    signoffApproved: number;
    signoffRejected: number;
    signoffPending: number;
  };
};

type ProjectAcceptanceReport = {
  projectId: string;
  projectName: string;
  generatedAt: string;
  status: string;
  currentStage: string;
  progress: number;
  pendingApproval: boolean;
  summary: {
    stageCount: number;
    deliverableCount: number;
    approvedDeliverables: number;
    blockedTasks: number;
    inProgressTasks: number;
    completedTasks: number;
    signoffApproved: number;
    signoffRejected: number;
    signoffPending: number;
  };
  stages: AcceptanceStageReport[];
  signoffHistory: AcceptanceSignoffRecord[];
  archivedReports: Array<{
    id: string;
    name: string;
    version: number;
    updatedAt: string;
  }>;
  comparison?: AcceptanceReportComparison;
  recentTimeline: Array<{
    id: string;
    timestamp: string;
    type: string;
    title: string;
    content: string;
    priority: string;
    agentId?: string;
  }>;
  recentDeliverables: Array<{
    id: string;
    stageType: string;
    name: string;
    status: string;
    version: number;
    createdBy: string;
    updatedAt: string;
  }>;
  recommendations: string[];
};

type FinalArtifactRecord = {
  key: string;
  category: string;
  required: boolean;
  ready: boolean;
  issue?: string;
  source: "deliverable" | "link";
  deliverableId?: string;
  name: string;
  stageType?: string;
  status?: string;
  version?: number;
  updatedAt?: string;
  content?: string;
  excerpt?: string;
  url?: string;
  filePath?: string;
};

type ProjectFinalArtifactsReport = {
  projectId: string;
  projectName: string;
  status: string;
  currentStage: string;
  generatedAt: string;
  readyForAcceptance: boolean;
  coverage: {
    required: number;
    provided: number;
    missing: number;
  };
  artifacts: FinalArtifactRecord[];
  missingRequired: string[];
  checklist: string[];
  generation?: FinalArtifactsJobProgress;
};

type FinalArtifactsJobStatus = "queued" | "running" | "completed" | "failed";

type FinalArtifactsJobProgress = {
  jobId: string;
  projectId: string;
  status: FinalArtifactsJobStatus;
  progress: number;
  step: string;
  message?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
};

type FinalArtifactsJobState = FinalArtifactsJobProgress & {
  report?: ProjectFinalArtifactsReport;
  officialSite?: {
    url: string;
    filePath?: string;
  };
};

const FINAL_REQUIRED_ARTIFACTS: Array<{
  key: string;
  category: string;
  required: boolean;
  patterns: RegExp[];
}> = [
  {
    key: "schedule",
    category: "项目排期",
    required: true,
    patterns: [/排期|里程碑|schedule/i]
  },
  {
    key: "ppt",
    category: "客户汇报方案（PPT）",
    required: true,
    patterns: [/ppt|汇报方案|路演|汇报/i]
  },
  {
    key: "word",
    category: "实施方案（Word）",
    required: true,
    patterns: [/word|实施方案|执行方案|落地方案/i]
  },
  {
    key: "demo",
    category: "Demo / 原型",
    required: true,
    patterns: [/demo|原型|演示页|官网演示/i]
  },
  {
    key: "acceptance_report",
    category: "验收报告",
    required: true,
    patterns: [/验收报告|测试报告|回填|acceptance/i]
  }
];

const FINAL_ARTIFACT_JOB_RETENTION_MS = Math.max(10 * 60 * 1000, Number(process.env.FINAL_ARTIFACT_JOB_RETENTION_MS ?? 45 * 60 * 1000));
const FINAL_ARTIFACT_RECONCILE_TIMEOUT_MS = Math.max(8_000, Number(process.env.FINAL_ARTIFACT_RECONCILE_TIMEOUT_MS ?? 25_000));
const FINAL_ARTIFACT_SITE_TIMEOUT_MS = Math.max(8_000, Number(process.env.FINAL_ARTIFACT_SITE_TIMEOUT_MS ?? 25_000));
const finalArtifactsJobsById = new Map<string, FinalArtifactsJobState>();
const finalArtifactsLatestJobByProject = new Map<string, string>();

function toFinalArtifactsJobProgress(job?: FinalArtifactsJobState | null): FinalArtifactsJobProgress | undefined {
  if (!job) {
    return undefined;
  }
  return {
    jobId: job.jobId,
    projectId: job.projectId,
    status: job.status,
    progress: job.progress,
    step: job.step,
    message: job.message,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error
  };
}

function getLatestFinalArtifactsJob(projectId: string) {
  const jobId = finalArtifactsLatestJobByProject.get(projectId);
  if (!jobId) {
    return undefined;
  }
  const job = finalArtifactsJobsById.get(jobId);
  if (!job) {
    finalArtifactsLatestJobByProject.delete(projectId);
    return undefined;
  }
  return job;
}

function purgeExpiredFinalArtifactsJobs() {
  const now = Date.now();
  for (const [jobId, job] of finalArtifactsJobsById.entries()) {
    const baseline = job.finishedAt || job.startedAt;
    if (!baseline) {
      continue;
    }
    if (now - new Date(baseline).getTime() <= FINAL_ARTIFACT_JOB_RETENTION_MS) {
      continue;
    }
    finalArtifactsJobsById.delete(jobId);
    if (finalArtifactsLatestJobByProject.get(job.projectId) === jobId) {
      finalArtifactsLatestJobByProject.delete(job.projectId);
    }
  }
}

function attachFinalArtifactsGeneration(
  report: ProjectFinalArtifactsReport,
  job?: FinalArtifactsJobState
): ProjectFinalArtifactsReport {
  return {
    ...report,
    generation: toFinalArtifactsJobProgress(job)
  };
}

async function withAsyncTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
  });
  try {
    return await Promise.race<T | undefined>([promise, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function runFinalArtifactsGenerationJob(jobId: string) {
  const job = finalArtifactsJobsById.get(jobId);
  if (!job) {
    return;
  }

  const update = (patch: Partial<FinalArtifactsJobState>) => {
    const current = finalArtifactsJobsById.get(jobId);
    if (!current) {
      return;
    }
    finalArtifactsJobsById.set(jobId, {
      ...current,
      ...patch
    });
  };

  try {
    update({
      status: "running",
      progress: 10,
      step: "加载项目上下文",
      message: "正在拉取项目和交付物数据...",
      startedAt: job.startedAt || new Date().toISOString(),
      finishedAt: undefined,
      error: undefined
    });

    let project = await findProject(job.projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    update({
      progress: 38,
      step: "补齐并校验交付物",
      message: "正在执行交付物补齐与模板对齐..."
    });

    const reconciled = await withAsyncTimeout(
      reconcileProjectDeliverablesNow(job.projectId),
      FINAL_ARTIFACT_RECONCILE_TIMEOUT_MS
    );
    if (reconciled) {
      project = reconciled;
    } else {
      update({
        message: `交付物补齐超时（>${FINAL_ARTIFACT_RECONCILE_TIMEOUT_MS}ms），继续使用当前已产出内容。`
      });
    }

    let officialSite: { url: string; filePath?: string } | undefined;
    if (project.status === "completed") {
      update({
        progress: 72,
        step: "生成最终演示站点",
        message: "正在构建可访问的演示成果..."
      });
      try {
        const artifact = await withAsyncTimeout(
          generateOfficialSiteArtifact(project),
          FINAL_ARTIFACT_SITE_TIMEOUT_MS
        );
        if (!artifact) {
          update({
            message: `演示站点生成超时（>${FINAL_ARTIFACT_SITE_TIMEOUT_MS}ms），先返回文档成果。`
          });
        } else {
          officialSite = {
            url: artifact.publicPath,
            filePath: artifact.filePaths[0]
          };
        }
      } catch (error) {
        // 允许站点生成失败，不阻断报告本身。
        update({
          message: `演示站点生成失败，继续产出报告：${error instanceof Error ? error.message : String(error)}`
        });
      }
    }

    update({
      progress: 92,
      step: "汇总最终验收产物",
      message: "正在生成最终验收报告..."
    });
    const report = buildProjectFinalArtifactsReport(project, officialSite);
    const finishedAt = new Date().toISOString();
    update({
      status: "completed",
      progress: 100,
      step: "已完成",
      message: "最终验收产物已生成，可开始验收。",
      finishedAt,
      report,
      officialSite
    });
  } catch (error) {
    update({
      status: "failed",
      progress: 100,
      step: "生成失败",
      message: "最终验收产物生成失败，请查看错误并重试。",
      error: error instanceof Error ? error.message : String(error),
      finishedAt: new Date().toISOString()
    });
  } finally {
    purgeExpiredFinalArtifactsJobs();
  }
}

function startFinalArtifactsGenerationJob(projectId: string, options?: { force?: boolean }) {
  purgeExpiredFinalArtifactsJobs();
  const latest = getLatestFinalArtifactsJob(projectId);
  if (!options?.force && latest && (latest.status === "queued" || latest.status === "running")) {
    return latest;
  }

  const nextJob: FinalArtifactsJobState = {
    jobId: randomUUID(),
    projectId,
    status: "queued",
    progress: 0,
    step: "已入队",
    message: "已创建生成任务，等待执行...",
    startedAt: new Date().toISOString()
  };
  finalArtifactsJobsById.set(nextJob.jobId, nextJob);
  finalArtifactsLatestJobByProject.set(projectId, nextJob.jobId);

  setTimeout(() => {
    void runFinalArtifactsGenerationJob(nextJob.jobId);
  }, 0);

  return nextJob;
}

function buildExcerpt(content: string, limit = 120) {
  const raw = String(content || "");
  const pickSection = (title: string) => {
    const regex = new RegExp(`${title}\\n([\\s\\S]*?)(\\n##\\s|$)`);
    const matched = raw.match(regex);
    return matched?.[1]?.trim() || "";
  };

  const preferred = [
    pickSection("## 验收检查清单"),
    pickSection("## Agent 输出正文"),
    pickSection("## 项目摘要"),
    pickSection("## 当前结论"),
    pickSection("## 阶段目标"),
    pickSection("## 当前任务清单")
  ].find((item) => item.length > 0) || raw;

  const normalized = preferred.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "暂无正文";
  }
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function isDeliverableReadyForAcceptance(input: {
  status?: string;
  content?: string;
}) {
  const status = String(input.status || "").toLowerCase();
  const content = String(input.content || "");
  const length = content.trim().length;
  if (status === "draft" || !status) {
    return false;
  }
  if (length < 120) {
    return false;
  }
  if (content.includes("## 自动质检") && !/自动质检结论:\s*通过/.test(content)) {
    return false;
  }
  return true;
}

function deliverableStatusScore(status: string) {
  if (status === "approved") return 4;
  if (status === "submitted") return 3;
  if (status === "rejected") return 2;
  if (status === "draft") return 1;
  return 0;
}

function deliverableQualityScore(content: string) {
  const normalized = String(content || "");
  let score = 0;
  if (normalized.includes("执行引擎:")) score += 2;
  if (normalized.includes("## 本阶段任务证据")) score += 2;
  if (normalized.includes("## 模型尝试轨迹")) score += 1;
  if (normalized.includes("## 自动质检")) score += 2;
  if (/自动质检结论:\s*通过/.test(normalized)) score += 3;
  if (
    /(固定仪表盘、项目观测室、Agent 中心三大页面|让实时输出始终成为视觉中心|把审批与紧急介入做成明确的强动作|避免常规 SaaS 模板感)/.test(normalized)
  ) {
    score -= 2;
  }
  return score;
}

function pickBestDeliverable(
  deliverables: NonNullable<Awaited<ReturnType<typeof findProject>>>["deliverables"],
  patterns: RegExp[]
) {
  const candidates = deliverables.filter((item) => patterns.some((pattern) => pattern.test(item.name)));
  if (candidates.length === 0) {
    return undefined;
  }
  return candidates.sort((left, right) => {
    const statusDelta = deliverableStatusScore(right.status) - deliverableStatusScore(left.status);
    if (statusDelta !== 0) {
      return statusDelta;
    }
    const qualityDelta = deliverableQualityScore(String(right.content || "")) - deliverableQualityScore(String(left.content || ""));
    if (qualityDelta !== 0) {
      return qualityDelta;
    }
    const contentDelta = String(right.content || "").trim().length - String(left.content || "").trim().length;
    if (contentDelta !== 0) {
      return contentDelta;
    }
    const versionDelta = (right.version || 0) - (left.version || 0);
    if (versionDelta !== 0) {
      return versionDelta;
    }
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  })[0];
}

function buildProjectFinalArtifactsReport(
  project: NonNullable<Awaited<ReturnType<typeof findProject>>>,
  officialSite?: { url: string; filePath?: string }
): ProjectFinalArtifactsReport {
  const deliverables = [...project.deliverables]
    .sort((left, right) => {
      const updatedDelta = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      if (updatedDelta !== 0) {
        return updatedDelta;
      }
      return (right.version || 0) - (left.version || 0);
    });

  const artifacts: FinalArtifactRecord[] = [];
  const missingRequired: string[] = [];

  for (const target of FINAL_REQUIRED_ARTIFACTS) {
    const matched = pickBestDeliverable(deliverables, target.patterns);
    if (!matched) {
      if (target.required) {
        missingRequired.push(target.category);
      }
      continue;
    }

    const ready = isDeliverableReadyForAcceptance({
      status: matched.status,
      content: matched.content
    });
    if (target.required && !ready) {
      missingRequired.push(target.category);
    }

    artifacts.push({
      key: target.key,
      category: target.category,
      required: target.required,
      ready,
      issue: ready ? undefined : "当前仍为草稿或正文不足，尚不满足最终验收。",
      source: "deliverable",
      deliverableId: matched.id,
      name: matched.name,
      stageType: matched.stageType,
      status: matched.status,
      version: matched.version,
      updatedAt: matched.updatedAt,
      content: matched.content,
      excerpt: buildExcerpt(matched.content)
    });
  }

  const acceptedSummary = deliverables.find((item) => item.name.includes("产品说明文档回填"));
  if (acceptedSummary && !artifacts.some((item) => item.deliverableId === acceptedSummary.id)) {
    artifacts.push({
      key: "backfill_doc",
      category: "产品说明文档回填",
      required: false,
      ready: isDeliverableReadyForAcceptance({
        status: acceptedSummary.status,
        content: acceptedSummary.content
      }),
      source: "deliverable",
      deliverableId: acceptedSummary.id,
      name: acceptedSummary.name,
      stageType: acceptedSummary.stageType,
      status: acceptedSummary.status,
      version: acceptedSummary.version,
      updatedAt: acceptedSummary.updatedAt,
      content: acceptedSummary.content,
      excerpt: buildExcerpt(acceptedSummary.content)
    });
  }

  if (officialSite?.url) {
    artifacts.push({
      key: "official_site",
      category: "演示站点链接",
      required: false,
      ready: true,
      source: "link",
      name: "官网演示页",
      stageType: "ACCEPT",
      status: "approved",
      updatedAt: new Date().toISOString(),
      url: officialSite.url,
      filePath: officialSite.filePath,
      excerpt: officialSite.filePath ? `本地文件：${officialSite.filePath}` : "可直接打开在线演示页"
    });
  }

  const required = FINAL_REQUIRED_ARTIFACTS.filter((item) => item.required).length;
  const provided = FINAL_REQUIRED_ARTIFACTS
    .filter((item) => item.required)
    .reduce((count, item) => {
      const matched = artifacts.find((artifact) => artifact.key === item.key);
      return count + (matched?.ready ? 1 : 0);
    }, 0);
  const readyForAcceptance = missingRequired.length === 0
    && project.status === "completed"
    && project.currentStage === "ACCEPT";
  const checklist = [
    readyForAcceptance ? "关键验收产物齐全，可进入最终验收确认。" : "关键验收产物尚不完整，请先补齐缺失项。",
    "请逐项打开并核对：目标一致性、内容完整性、可演示性。",
    "确认无误后，建议执行“归档到交付物”并保留验收报告版本。"
  ];

  return {
    projectId: project.id,
    projectName: project.name,
    status: project.status,
    currentStage: project.currentStage,
    generatedAt: new Date().toISOString(),
    readyForAcceptance,
    coverage: {
      required,
      provided,
      missing: missingRequired.length
    },
    artifacts,
    missingRequired,
    checklist
  };
}

function computeStageAcceptanceResult(input: {
  approved: number;
  rejected: number;
  submitted: number;
  total: number;
}): AcceptanceStageReport["acceptance"] {
  if (input.total === 0) {
    return {
      result: "none",
      note: "当前阶段暂无交付物，请先提交产出后再验收。"
    };
  }
  if (input.rejected > 0) {
    return {
      result: "rejected",
      note: `存在 ${input.rejected} 份驳回交付物，建议先返工后再推进。`
    };
  }
  if (input.approved === input.total) {
    return {
      result: "approved",
      note: "当前阶段交付物均已通过验收。"
    };
  }
  if (input.submitted > 0 || input.approved > 0) {
    return {
      result: "pending",
      note: "已有交付物提交，仍需完成剩余验收决策。"
    };
  }
  return {
    result: "pending",
    note: "阶段已启动，但尚未进入可验收状态。"
  };
}

const ACCEPTANCE_SNAPSHOT_PREFIX = "<!-- ACCEPTANCE_SNAPSHOT ";
const ACCEPTANCE_SNAPSHOT_SUFFIX = " -->";
const REPORT_STAGE_ENTRIES = Object.entries(STAGE_LABELS);

function toAcceptanceSnapshot(report: ProjectAcceptanceReport): AcceptanceReportSnapshot {
  return {
    generatedAt: report.generatedAt,
    status: report.status,
    currentStage: report.currentStage,
    summary: {
      deliverableCount: report.summary.deliverableCount,
      approvedDeliverables: report.summary.approvedDeliverables,
      blockedTasks: report.summary.blockedTasks,
      inProgressTasks: report.summary.inProgressTasks,
      completedTasks: report.summary.completedTasks,
      signoffApproved: report.summary.signoffApproved,
      signoffRejected: report.summary.signoffRejected,
      signoffPending: report.summary.signoffPending
    }
  };
}

function renderAcceptanceSnapshotComment(report: ProjectAcceptanceReport) {
  return `${ACCEPTANCE_SNAPSHOT_PREFIX}${JSON.stringify(toAcceptanceSnapshot(report))}${ACCEPTANCE_SNAPSHOT_SUFFIX}`;
}

function parseAcceptanceSnapshotFromMarkdown(content: string): AcceptanceReportSnapshot | null {
  const match = content.match(/<!-- ACCEPTANCE_SNAPSHOT ([\s\S]+?) -->/);
  if (!match?.[1]) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[1]) as AcceptanceReportSnapshot;
    if (!parsed || !parsed.summary) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function inferStageTypeFromEventText(text: string): string | undefined {
  const normalized = String(text || "").toUpperCase();
  for (const [stageType, stageLabel] of REPORT_STAGE_ENTRIES) {
    if (normalized.includes(stageType.toUpperCase()) || String(text).includes(stageLabel)) {
      return stageType;
    }
  }
  return undefined;
}

function buildSignoffHistory(
  project: NonNullable<Awaited<ReturnType<typeof findProject>>>
): AcceptanceSignoffRecord[] {
  return project.timeline
    .filter((event) => ["approval_done", "approval_rejected", "approval_required"].includes(event.type))
    .map((event) => {
      const stageType = inferStageTypeFromEventText(`${event.title}\n${event.content}`);
      const stageLabel = stageType ? (STAGE_LABELS as Record<string, string>)[stageType] : "未知阶段";
      const decision: AcceptanceSignoffRecord["decision"] =
        event.type === "approval_done"
          ? "approved"
          : event.type === "approval_rejected"
            ? "rejected"
            : "pending";

      return {
        id: event.id,
        timestamp: event.timestamp,
        stageType,
        stageLabel,
        decision,
        actor: event.agentId || "系统",
        reason: event.content || event.title
      };
    })
    .slice(0, 30);
}

function summarizeLatestSignoff(signoffHistory: AcceptanceSignoffRecord[]) {
  const latestByStage = new Map<string, AcceptanceSignoffRecord>();
  for (const record of signoffHistory) {
    const key = record.stageType || record.stageLabel || record.id;
    if (!latestByStage.has(key)) {
      latestByStage.set(key, record);
    }
  }

  const latestRecords = [...latestByStage.values()];
  return {
    approved: latestRecords.filter((item) => item.decision === "approved").length,
    rejected: latestRecords.filter((item) => item.decision === "rejected").length,
    pending: latestRecords.filter((item) => item.decision === "pending").length
  };
}

function buildProjectAcceptanceReport(
  project: NonNullable<Awaited<ReturnType<typeof findProject>>>
): ProjectAcceptanceReport {
  const now = new Date().toISOString();
  const stages = project.stages.map((stage) => {
    const stageDeliverables = project.deliverables.filter((item) => item.stageType === stage.type);
    const approved = stageDeliverables.filter((item) => item.status === "approved").length;
    const submitted = stageDeliverables.filter((item) => item.status === "submitted").length;
    const rejected = stageDeliverables.filter((item) => item.status === "rejected").length;
    const draft = stageDeliverables.filter((item) => item.status === "draft").length;
    const latestUpdatedAt = stageDeliverables
      .map((item) => item.updatedAt)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

    return {
      stageType: stage.type,
      stageLabel: stage.label,
      assignee: stage.assignee,
      status: stage.status,
      progress: stage.progress,
      startedAt: stage.startedAt,
      endedAt: stage.endedAt,
      deliverables: {
        total: stageDeliverables.length,
        approved,
        submitted,
        rejected,
        draft,
        latestUpdatedAt
      },
      acceptance: computeStageAcceptanceResult({
        total: stageDeliverables.length,
        approved,
        submitted,
        rejected
      })
    } satisfies AcceptanceStageReport;
  });

  const blockedTasks = project.tasks.filter((task) => task.status === "blocked").length;
  const inProgressTasks = project.tasks.filter((task) => task.status === "in_progress").length;
  const completedTasks = project.tasks.filter((task) => task.status === "done").length;
  const approvedDeliverables = project.deliverables.filter((item) => item.status === "approved").length;
  const signoffHistory = buildSignoffHistory(project);
  const signoffSummary = summarizeLatestSignoff(signoffHistory);
  const signoffApproved = signoffSummary.approved;
  const signoffRejected = signoffSummary.rejected;
  const signoffPending = signoffSummary.pending;
  const archivedReportDeliverables = project.deliverables
    .filter((item) => item.stageType === "ACCEPT" && item.name.startsWith("阶段验收报告"))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const archivedReports = archivedReportDeliverables.slice(0, 8).map((item) => ({
    id: item.id,
    name: item.name,
    version: item.version,
    updatedAt: item.updatedAt
  }));

  const snapshotCandidates = archivedReportDeliverables
    .map((item) => ({
      name: item.name,
      snapshot: parseAcceptanceSnapshotFromMarkdown(item.content)
    }));

  const baselineSnapshot = snapshotCandidates.find((item) => {
    if (!item.snapshot) {
      return false;
    }
    const summary = item.snapshot.summary;
    const sameAsCurrent = summary.deliverableCount === project.deliverables.length
      && summary.approvedDeliverables === approvedDeliverables
      && summary.blockedTasks === blockedTasks
      && summary.inProgressTasks === inProgressTasks
      && summary.completedTasks === completedTasks
      && summary.signoffApproved === signoffApproved
      && summary.signoffRejected === signoffRejected
      && summary.signoffPending === signoffPending;
    return !sameAsCurrent;
  }) || snapshotCandidates.find((item) => Boolean(item.snapshot));

  const comparison = baselineSnapshot?.snapshot
    ? {
        baselineName: baselineSnapshot.name,
        baselineGeneratedAt: baselineSnapshot.snapshot.generatedAt,
        note: "与最近一次归档报告相比（仅对比汇总指标）。",
        delta: {
          deliverableCount: project.deliverables.length - baselineSnapshot.snapshot.summary.deliverableCount,
          approvedDeliverables: approvedDeliverables - baselineSnapshot.snapshot.summary.approvedDeliverables,
          blockedTasks: blockedTasks - baselineSnapshot.snapshot.summary.blockedTasks,
          inProgressTasks: inProgressTasks - baselineSnapshot.snapshot.summary.inProgressTasks,
          completedTasks: completedTasks - baselineSnapshot.snapshot.summary.completedTasks,
          signoffApproved: signoffApproved - baselineSnapshot.snapshot.summary.signoffApproved,
          signoffRejected: signoffRejected - baselineSnapshot.snapshot.summary.signoffRejected,
          signoffPending: signoffPending - baselineSnapshot.snapshot.summary.signoffPending
        }
      } satisfies AcceptanceReportComparison
    : undefined;

  const recommendations: string[] = [];
  if (project.pendingApproval) {
    recommendations.push("当前阶段存在待审批交付物，请尽快执行通过/驳回决策。");
  }
  if (blockedTasks > 0) {
    recommendations.push(`当前存在 ${blockedTasks} 个阻塞任务，建议优先人工干预并分配补救动作。`);
  }
  if (project.status !== "completed" && approvedDeliverables < project.deliverables.length) {
    recommendations.push("项目尚未完全收敛，建议在验收前确认各阶段交付物状态。");
  }
  if (project.status === "completed" && recommendations.length === 0) {
    recommendations.push("项目已完成，可归档并回填产品说明文档。");
  }
  if (recommendations.length === 0) {
    recommendations.push("建议保持当前节奏，持续关注阶段验收状态变化。");
  }

  return {
    projectId: project.id,
    projectName: project.name,
    generatedAt: now,
    status: project.status,
    currentStage: project.currentStage,
    progress: project.progress,
    pendingApproval: project.pendingApproval,
    summary: {
      stageCount: project.stages.length,
      deliverableCount: project.deliverables.length,
      approvedDeliverables,
      blockedTasks,
      inProgressTasks,
      completedTasks,
      signoffApproved,
      signoffRejected,
      signoffPending
    },
    stages,
    signoffHistory,
    archivedReports,
    comparison,
    recentTimeline: project.timeline.slice(0, 20).map((item) => ({
      id: item.id,
      timestamp: item.timestamp,
      type: item.type,
      title: item.title,
      content: item.content,
      priority: item.priority,
      agentId: item.agentId
    })),
    recentDeliverables: project.deliverables.slice(0, 20).map((item) => ({
      id: item.id,
      stageType: item.stageType,
      name: item.name,
      status: item.status,
      version: item.version,
      createdBy: item.createdBy,
      updatedAt: item.updatedAt
    })),
    recommendations
  };
}

function renderAcceptanceReportMarkdown(report: ProjectAcceptanceReport) {
  const stageLines = report.stages.map((stage) => {
    return [
      `### ${stage.stageLabel} (${stage.stageType})`,
      `- 负责人: ${stage.assignee}`,
      `- 阶段状态: ${stage.status} / 进度 ${stage.progress}%`,
      `- 交付物: 总计 ${stage.deliverables.total}，通过 ${stage.deliverables.approved}，待处理 ${stage.deliverables.submitted}，驳回 ${stage.deliverables.rejected}，草稿 ${stage.deliverables.draft}`,
      `- 验收结论: ${stage.acceptance.result}（${stage.acceptance.note}）`,
      `- 时间: 开始 ${stage.startedAt || "-"} / 结束 ${stage.endedAt || "-"}`
    ].join("\n");
  });

  const timelineLines = report.recentTimeline.slice(0, 10).map((item) =>
    `- [${item.timestamp}] ${item.title} (${item.type} / ${item.priority})`
  );
  const deliverableLines = report.recentDeliverables.slice(0, 10).map((item) =>
    `- ${item.name} (${item.stageType} / v${item.version} / ${item.status} / ${item.updatedAt})`
  );
  const signoffLines = report.signoffHistory.slice(0, 12).map((item) =>
    `- [${item.timestamp}] ${item.stageLabel} / ${item.decision} / ${item.actor}：${item.reason}`
  );
  const comparisonLines = report.comparison
    ? [
        `- 基线报告: ${report.comparison.baselineName}`,
        `- 基线时间: ${report.comparison.baselineGeneratedAt}`,
        `- 交付物变化: ${report.comparison.delta.deliverableCount >= 0 ? "+" : ""}${report.comparison.delta.deliverableCount}`,
        `- 已通过交付物变化: ${report.comparison.delta.approvedDeliverables >= 0 ? "+" : ""}${report.comparison.delta.approvedDeliverables}`,
        `- 阻塞任务变化: ${report.comparison.delta.blockedTasks >= 0 ? "+" : ""}${report.comparison.delta.blockedTasks}`,
        `- 已完成任务变化: ${report.comparison.delta.completedTasks >= 0 ? "+" : ""}${report.comparison.delta.completedTasks}`,
        `- 签核变化(通过/驳回/待处理): ${report.comparison.delta.signoffApproved >= 0 ? "+" : ""}${report.comparison.delta.signoffApproved} / ${report.comparison.delta.signoffRejected >= 0 ? "+" : ""}${report.comparison.delta.signoffRejected} / ${report.comparison.delta.signoffPending >= 0 ? "+" : ""}${report.comparison.delta.signoffPending}`,
        `- 说明: ${report.comparison.note}`
      ]
    : ["- 暂无可对比基线（请至少归档一次验收报告）。"];

  return [
    `# 项目阶段验收报告`,
    ``,
    `- 项目ID: ${report.projectId}`,
    `- 项目名称: ${report.projectName}`,
    `- 生成时间: ${report.generatedAt}`,
    `- 状态: ${report.status} / 当前阶段 ${report.currentStage} / 进度 ${report.progress}%`,
    `- 待审批: ${report.pendingApproval ? "是" : "否"}`,
    ``,
    `## 全局汇总`,
    `- 阶段数: ${report.summary.stageCount}`,
    `- 交付物总数: ${report.summary.deliverableCount}`,
    `- 已通过交付物: ${report.summary.approvedDeliverables}`,
    `- 任务状态: 阻塞 ${report.summary.blockedTasks} / 进行中 ${report.summary.inProgressTasks} / 已完成 ${report.summary.completedTasks}`,
    `- 签核记录: 通过 ${report.summary.signoffApproved} / 驳回 ${report.summary.signoffRejected} / 待处理 ${report.summary.signoffPending}`,
    ``,
    `## 阶段验收详情`,
    ...stageLines,
    ``,
    `## 阶段签核记录`,
    ...(signoffLines.length > 0 ? signoffLines : ["- 暂无"]),
    ``,
    `## 报告对比（相对上次归档）`,
    ...comparisonLines,
    ``,
    `## 最近交付物`,
    ...(deliverableLines.length > 0 ? deliverableLines : ["- 暂无"]),
    ``,
    `## 最近时间线`,
    ...(timelineLines.length > 0 ? timelineLines : ["- 暂无"]),
    ``,
    `## 建议动作`,
    ...report.recommendations.map((item) => `- ${item}`),
    ``,
    renderAcceptanceSnapshotComment(report)
  ].join("\n");
}

// CORS 配置 - 生产环境禁止通配符
const corsOrigin = process.env.NODE_ENV === "production"
  ? (process.env.ALLOWED_ORIGINS?.split(",").map(origin => origin.trim()).filter(Boolean) || [])
  : true; // 开发环境允许任意源

if (process.env.NODE_ENV === "production" && !process.env.ALLOWED_ORIGINS) {
  throw new Error("生产环境必须设置 ALLOWED_ORIGINS 环境变量，不允许使用通配符");
}

app.use(cors({
  origin: corsOrigin,
  credentials: true
}));

// 安全 Headers
app.use(helmet({
  strictTransportSecurity: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  xFrameOptions: { action: "deny" },
  xContentTypeOptions: true,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  xDownloadOptions: false,
  xPermittedCrossDomainPolicies: false
}));
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  const requestId = randomUUID();
  const startedAt = Date.now();

  res.locals.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  res.on("finish", () => {
    console.log(
      JSON.stringify({
        requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt
      })
    );
  });

  next();
});

app.get("/api/auth/status", asyncRoute(async (req, res) => {
  res.json(await getAuthStatus(parseSessionToken(req.headers.cookie)));
}));

app.post("/api/auth/setup", asyncRoute(async (req, res) => {
  const payload = req.body as AuthSetupInput;
  const password = String(payload?.password ?? "").trim();

  if (password.length < 8) {
    res.status(400).json({ message: "password must be at least 8 characters" });
    return;
  }

  try {
    const session = await setupAdmin(password);
    res.setHeader("Set-Cookie", createSessionCookie(session.token));
    await safeAudit(req, res, {
      actorType: "admin",
      actorLabel: "管理员",
      action: "auth.setup",
      resourceType: "system",
      summary: "已完成管理员初始化"
    });
    res.status(201).json(await getAuthStatus(session.token));
  } catch (error) {
    const message = error instanceof Error ? error.message : "初始化失败";
    const statusCode = message.includes("已配置") ? 409 : 400;
    res.status(statusCode).json({ message });
  }
}));

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const payload = req.body as AuthLoginInput;
  const password = String(payload?.password ?? "").trim();

  if (!password) {
    res.status(400).json({ message: "password is required" });
    return;
  }

  try {
    const session = await loginAdmin(password);
    res.setHeader("Set-Cookie", createSessionCookie(session.token));
    await safeAudit(req, res, {
      actorType: "admin",
      actorLabel: "管理员",
      action: "auth.login",
      resourceType: "system",
      summary: "管理员已登录"
    });
    res.json(await getAuthStatus(session.token));
  } catch (error) {
    const message = error instanceof Error ? error.message : "登录失败";
    const statusCode = message.includes("尚未完成初始化") ? 428 : 401;
    res.status(statusCode).json({ message });
  }
}));

app.post("/api/auth/logout", asyncRoute(async (req, res) => {
  const sessionToken = parseSessionToken(req.headers.cookie);
  await logoutAdmin(sessionToken);
  res.setHeader("Set-Cookie", clearSessionCookie());
  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "auth.logout",
    resourceType: "system",
    summary: "管理员已退出登录"
  });
  res.json({ ok: true });
}));

app.get("/health", asyncRoute(async (_req, res) => {
  res.json({
    ok: true,
    service: "occ-api",
    runtime: await getRuntimeStatus(),
    timestamp: new Date().toISOString()
  });
}));

app.get("/ready", asyncRoute(async (_req, res) => {
  const health = await getSystemHealth();
  const databaseHealthy = health.services.find((service) => service.name === "database")?.status === "healthy";
  const statusCode = databaseHealthy ? 200 : 503;

  res.status(statusCode).json({
    ok: databaseHealthy,
    timestamp: new Date().toISOString(),
    services: health.services
  });
}));

app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/auth/")) {
    next();
    return;
  }

  // 临时策略：开发环境放开联调端点，便于本地验证核心流程
  if (
    process.env.NODE_ENV !== "production"
    && (
      req.path.startsWith("/openclaw/")
      || req.path.startsWith("/projects")
      || req.path.startsWith("/tasks")
      || req.path.startsWith("/role-sets")
      || req.path.startsWith("/product-context")
      || req.path.startsWith("/issues")
      || req.path.startsWith("/system/design-model-policy/")
      || req.path.startsWith("/system/stage-model-policy")
    )
  ) {
    next();
    return;
  }

  void (async () => {
    const sessionToken = parseSessionToken(req.headers.cookie);
    const authStatus = await getAuthStatus(sessionToken);

    if (!authStatus.setupComplete) {
      res.status(428).json({
        message: "system setup required"
      });
      return;
    }

    const isValid = await validateSession(sessionToken);
    if (!isValid) {
      res.status(401).json({
        message: "authentication required"
      });
      return;
    }

    next();
  })().catch(next);
});

app.use("/api/models", createModelsRouter());
app.use("/api/agents", createAgentsRouter());
app.use("/api/team", createTeamRouter());
app.use("/api/role-sets", createRoleSetsRouter());
app.use("/api/product-context", createProductContextRouter());
app.use("/api/issues", createIssuesRouter({
  onProjectCreated: () => {
    kickProjectAutomationTick();
  }
}));

app.get("/api/system/runtime", asyncRoute(async (_req, res) => {
  res.json(await getRuntimeStatus());
}));

app.get("/api/system/runtime/config", asyncRoute(async (_req, res) => {
  res.json(await getRuntimeSettings());
}));

app.put("/api/system/runtime/config", asyncRoute(async (req, res) => {
  const payload = req.body as RuntimeSettingsInput;

  if (!payload?.provider) {
    res.status(400).json({ message: "provider is required" });
    return;
  }

  const result = await updateRuntimeSettings(payload);
  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "runtime.config.updated",
    resourceType: "runtime",
    summary: `运行配置已更新为 ${result.provider}`,
    detail: `model=${result.modelName || "未设置"} apiBaseUrl=${result.apiBaseUrl || "未设置"}`
  });
  res.json(result);
}));

app.post("/api/system/runtime/validate", asyncRoute(async (_req, res) => {
  const result = await validateRuntimeSettings();
  await safeAudit(_req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "runtime.config.validated",
    resourceType: "runtime",
    summary: result.ok ? "运行配置校验通过" : "运行配置校验失败",
    detail: result.message
  });
  res.status(result.ok ? 200 : 422).json(result);
}));

app.get("/api/system/health", asyncRoute(async (_req, res) => {
  res.json(await getSystemHealth());
}));

app.get("/api/system/readiness", asyncRoute(async (_req, res) => {
  res.json(await getSystemReadiness());
}));

app.get("/api/system/design-model-policy/health", asyncRoute(async (_req, res) => {
  const result = await getDesignModelPolicyHealth();
  res.status(result.ok ? 200 : 503).json(result);
}));

app.get("/api/system/stage-model-policy", asyncRoute(async (_req, res) => {
  res.json({
    success: true,
    data: getStageModelPolicy()
  });
}));

app.get("/api/system/stage-model-policy/preview", asyncRoute(async (req, res) => {
  const role = String(req.query.role ?? "ROLE_DESIGN") as RoleType;
  const stageType = String(req.query.stage ?? "DESIGN") as StageType;
  const data = await previewStageModelPlan({ role, stageType });
  res.json({ success: true, data });
}));

app.get("/api/system/stage-model-policy/usage", asyncRoute(async (req, res) => {
  const lookbackHoursInput = Number(req.query.lookbackHours ?? 24);
  const limitInput = Number(req.query.limit ?? 600);
  const data = await getStageModelUsage({
    lookbackHours: Number.isFinite(lookbackHoursInput) ? lookbackHoursInput : 24,
    limit: Number.isFinite(limitInput) ? limitInput : 600
  });
  res.json({ success: true, data });
}));

app.post("/api/system/design-model-policy/repair", asyncRoute(async (req, res) => {
  const result = await repairDesignModelPolicy();
  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "design_model_policy.repaired",
    resourceType: "runtime",
    resourceId: "ROLE_DESIGN",
    summary: "已执行设计模型策略一键修复",
    detail: `selected=${result.after.designAgentConfig.selectedModel} fallback=${result.after.designAgentConfig.fallbackModel}`
  });
  res.status(result.ok ? 200 : 202).json(result);
}));

app.get("/api/system/local-agent-monitor", asyncRoute(async (_req, res) => {
  res.json(await getCachedLocalAgentMonitorOverview());
}));

app.get("/api/system/local-agent-monitor/live", asyncRoute(async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const initial = await getCachedLocalAgentMonitorOverview();
  sendEvent(res, "snapshot", initial);

  const unsubscribe = subscribeLocalAgentMonitor((overview) => {
    sendEvent(res, "snapshot", overview);
  });

  const heartbeat = setInterval(() => {
    sendEvent(res, "heartbeat", { timestamp: new Date().toISOString() });
  }, 20000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
}));

app.get("/api/system/audit-logs", asyncRoute(async (req, res) => {
  const limit = Number(req.query.limit ?? 50);
  res.json(await listAuditLogs(Number.isFinite(limit) ? limit : 50));
}));

app.get("/api/notifications", asyncRoute(async (req, res) => {
  const locale = req.query.locale === "en-US" ? "en-US" : "zh-CN";
  res.json(await listNotificationInbox(locale));
}));

app.patch("/api/notifications/:sourceKey", asyncRoute(async (req, res) => {
  const payload = req.body as NotificationInboxUpdateInput;
  const sourceKey = decodeURIComponent(String(req.params.sourceKey ?? "").trim());

  if (!sourceKey) {
    res.status(400).json({ message: "sourceKey is required" });
    return;
  }

  const updated = await updateNotificationInboxState(sourceKey, payload);
  if (!updated) {
    res.status(404).json({ message: "notification not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "notification.updated",
    resourceType: "notification",
    resourceId: sourceKey,
    summary: `通知状态已更新：${updated.title}`,
    detail: `read=${updated.read} assignedTo=${updated.assignedTo ?? ""} confirmedBy=${updated.confirmedBy ?? ""} workflowStatus=${updated.workflowStatus}`
  });

  res.json(updated);
}));

app.get("/api/prompt-templates", asyncRoute(async (req, res) => {
  const channel = String(req.query.channel ?? "").trim() as PromptTemplateChannel;
  const locale = req.query.locale === "en-US" ? "en-US" : "zh-CN";
  const projectId = String(req.query.projectId ?? "").trim() || undefined;

  if (!channel) {
    res.status(400).json({ message: "channel is required" });
    return;
  }

  res.json(await listPromptTemplates({ channel, locale, projectId }));
}));

app.post("/api/prompt-templates", asyncRoute(async (req, res) => {
  const payload = req.body as PromptTemplateUpsertInput;
  if (!payload?.title || !payload?.content || !payload?.channel) {
    res.status(400).json({ message: "title, content, and channel are required" });
    return;
  }

  const created = await createPromptTemplate(payload);
  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: payload.ownerLabel || "管理员",
    action: "prompt_template.created",
    resourceType: "prompt_template",
    resourceId: created.id,
    summary: `已创建模板：${created.title}`,
    detail: `${created.channel} / ${created.scope}`
  });
  res.status(201).json(created);
}));

app.post("/api/prompt-templates/:templateId/use", asyncRoute(async (req, res) => {
  const templateId = String(req.params.templateId ?? "").trim();
  if (!templateId) {
    res.status(400).json({ message: "templateId is required" });
    return;
  }

  res.json(await markPromptTemplateUsed(templateId));
}));


type ProjectParsePriority = "High" | "Medium" | "Low";

const PROJECT_PARSE_ROLE_LABELS: Record<RoleType, string> = {
  ROLE_ASSISTANT: "总助理",
  ROLE_PM: "项目经理",
  ROLE_ANALYST: "需求分析师",
  ROLE_PRODUCT: "产品总监",
  ROLE_DESIGN: "视觉设计总监",
  ROLE_ARCH: "研发总监",
  ROLE_DEV: "研发经理",
  ROLE_QA: "测试工程师",
  ROLE_HR: "HR总监"
};

const PROJECT_PARSE_ROLE_HINTS: Array<{ role: RoleType; patterns: RegExp[] }> = [
  { role: "ROLE_PM", patterns: [/项目经理/, /pm/, /排期/, /里程碑/] },
  { role: "ROLE_ANALYST", patterns: [/需求/, /分析/, /调研/] },
  { role: "ROLE_PRODUCT", patterns: [/产品/, /原型/, /交互/, /体验/] },
  { role: "ROLE_DESIGN", patterns: [/视觉/, /设计/, /品牌/, /ui/, /ux/, /页面/, /官网/] },
  { role: "ROLE_ARCH", patterns: [/架构/, /基础设施/, /infra/, /系统设计/] },
  { role: "ROLE_DEV", patterns: [/研发/, /开发/, /编码/, /后端/, /前端/, /联调/] },
  { role: "ROLE_QA", patterns: [/测试/, /验收/, /qa/, /质量/] },
  { role: "ROLE_HR", patterns: [/招聘/, /人力/, /hr/] }
];

function inferProjectPriority(input: string): ProjectParsePriority {
  if (/紧急|马上|立即|asap|今天|本周|高优先|关键/.test(input)) {
    return "High";
  }
  if (/低优先|不着急|后续|有空|慢慢/.test(input)) {
    return "Low";
  }
  return "Medium";
}

function inferProjectPhase(input: string): string {
  if (/验收|测试|上线|发布|交付/.test(input)) {
    return "验收";
  }
  if (/开发|编码|实现|联调|后端|前端/.test(input)) {
    return "开发";
  }
  if (/设计|原型|界面|交互|架构/.test(input)) {
    return "设计";
  }
  return "分析";
}

function inferProjectName(input: string, keywords: string[]): string {
  const quoted = input.match(/["“](.{2,40})["”]/);
  if (quoted?.[1]) {
    return quoted[1].trim();
  }

  const candidate = input
    .replace(/(请|帮我|我们|需要|想要|希望|做一个|做个|创建|搭建|开发|实现|一个|项目|系统)/g, " ")
    .replace(/[，。,.!?]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join("");

  if (candidate) {
    return candidate.slice(0, 16) + "项目";
  }

  if (keywords[0]) {
    return keywords[0] + "项目";
  }

  return "新项目";
}

function inferProjectTeam(input: string, suggestedTeam: RoleType[]): RoleType[] {
  const matched = PROJECT_PARSE_ROLE_HINTS
    .filter((entry) => entry.patterns.some((pattern) => pattern.test(input)))
    .map((entry) => entry.role);

  if (matched.length > 0) {
    return Array.from(new Set(matched));
  }

  return suggestedTeam.length > 0 ? suggestedTeam.slice(0, 6) : ["ROLE_PM", "ROLE_ANALYST", "ROLE_PRODUCT", "ROLE_DESIGN", "ROLE_DEV", "ROLE_QA"];
}

app.post("/api/projects/parse", asyncRoute(async (req, res) => {
  const input = String(req.body?.input ?? req.body?.description ?? "").trim();

  if (!input) {
    res.status(400).json({ message: "input is required" });
    return;
  }

  const parsedIntent = previewRequirement(input);
  const team = inferProjectTeam(input, parsedIntent.suggestedTeam);

  res.json({
    name: inferProjectName(input, parsedIntent.keywords),
    description: parsedIntent.summary || input,
    phase: inferProjectPhase(input),
    agents: team.map((role) => PROJECT_PARSE_ROLE_LABELS[role]),
    team,
    priority: inferProjectPriority(input)
  });
}));

app.post("/api/projects/preview", asyncRoute(async (req, res) => {
  const description = String(req.body?.description ?? "").trim();

  if (!description) {
    res.status(400).json({ message: "description is required" });
    return;
  }

  res.json(previewRequirement(description));
}));

app.get("/api/projects", asyncRoute(async (_req, res) => {
  res.json(await listProjects());
}));

type ProjectCleanupCandidate = {
  id: string;
  name: string;
  status: string;
  currentStage: string;
  updatedAt: string;
  reasons: string[];
  recommended: boolean;
};

const CLEANUP_TEST_NAME_PATTERN = /(复测|冒烟|测试|验证|巡检|高保真|闭环能力版|HTTP真实流转版|设计增强版|重新启用创建|创建即推进|阶段B-|验收版|\bV1\b)/i;

function normalizeProjectNameForCleanup(input: string) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()（）\[\]【】]/g, "");
}

function buildProjectCleanupCandidates(
  projects: Awaited<ReturnType<typeof listProjects>>,
): ProjectCleanupCandidate[] {
  const reasonMap = new Map<string, Set<string>>();
  const addReason = (id: string, reason: string) => {
    const current = reasonMap.get(id) || new Set<string>();
    current.add(reason);
    reasonMap.set(id, current);
  };

  for (const project of projects) {
    if (project.status === "paused") {
      addReason(project.id, "paused");
    }
    if (CLEANUP_TEST_NAME_PATTERN.test(project.name)) {
      addReason(project.id, "test_like");
    }
  }

  const grouped = new Map<string, typeof projects>();
  for (const project of projects) {
    const key = normalizeProjectNameForCleanup(project.name);
    const list = grouped.get(key) || [];
    list.push(project);
    grouped.set(key, list);
  }

  for (const [, group] of grouped) {
    if (group.length <= 1) {
      continue;
    }
    const sorted = [...group].sort(
      (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    );
    for (const duplicate of sorted.slice(1)) {
      addReason(duplicate.id, "duplicate_name");
    }
  }

  return projects
    .filter((project) => reasonMap.has(project.id))
    .map((project) => {
      const reasons = Array.from(reasonMap.get(project.id) || []);
      const recommended = reasons.includes("paused") || reasons.includes("test_like") || reasons.includes("duplicate_name");
      return {
        id: project.id,
        name: project.name,
        status: project.status,
        currentStage: project.currentStage,
        updatedAt: project.updatedAt,
        reasons,
        recommended,
      };
    })
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

app.get("/api/projects/cleanup/candidates", asyncRoute(async (_req, res) => {
  const projects = await listProjects();
  const candidates = buildProjectCleanupCandidates(projects);
  res.json({
    success: true,
    data: candidates,
  });
}));

app.post("/api/projects/cleanup", asyncRoute(async (req, res) => {
  const idsInput = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]) : [];
  const mode = String(req.body?.mode || "recommended");
  const dryRun = Boolean(req.body?.dryRun);
  const projects = await listProjects();
  const candidates = buildProjectCleanupCandidates(projects);
  const candidateIds = new Set(candidates.map((item) => item.id));
  const projectNameById = new Map(projects.map((project) => [project.id, project.name]));

  const idsFromBody: string[] = idsInput
    .map((item: unknown) => String(item || "").trim())
    .filter((item): item is string => Boolean(item));
  const dedupedIds = Array.from(new Set<string>(idsFromBody));

  const targetIds: string[] = idsFromBody.length > 0
    ? dedupedIds.filter((id) => candidateIds.has(id))
    : mode === "all_candidates"
      ? candidates.map((item) => item.id)
      : candidates.filter((item) => item.recommended).map((item) => item.id);

  const deleted: Array<{ id: string; name: string }> = [];
  const failed: Array<{ id: string; error: string }> = [];

  if (!dryRun) {
    for (const id of targetIds) {
      try {
        const removed = await deleteProject(id);
        if (!removed) {
          failed.push({ id, error: "not found" });
          continue;
        }
        deleted.push({
          id,
          name: projectNameById.get(id) || id,
        });
      } catch (error) {
        failed.push({
          id,
          error: error instanceof Error ? error.message : "delete failed",
        });
      }
    }
  }

  const remaining = dryRun ? projects.length : (await listProjects()).length;

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.cleanup",
    resourceType: "project",
    summary: dryRun
      ? `项目清理预览：候选 ${targetIds.length} 个`
      : `项目清理执行：删除 ${deleted.length} 个，失败 ${failed.length} 个`,
    detail: `mode=${mode}; dryRun=${dryRun}; requested=${targetIds.length}`,
  });

  res.json({
    success: true,
    data: {
      requested: targetIds.length,
      deleted,
      failed,
      remaining,
    },
  });
}));

app.get("/api/projects/automation", asyncRoute(async (_req, res) => {
  res.json({
    enabled: projectAutomationState.enabled,
    intervalMs: projectAutomationState.intervalMs,
    running: projectAutomationState.running,
    lastRunAt: projectAutomationState.lastRunAt,
    lastError: projectAutomationState.lastError,
    lastSummary: projectAutomationState.lastSummary
  });
}));

app.put("/api/projects/automation", asyncRoute(async (req, res) => {
  const enabled = req.body?.enabled;
  const intervalMsInput = Number(req.body?.intervalMs ?? projectAutomationState.intervalMs);

  if (typeof enabled !== "boolean") {
    res.status(400).json({ message: "enabled must be boolean" });
    return;
  }

  projectAutomationState.enabled = enabled;
  projectAutomationState.intervalMs = Number.isFinite(intervalMsInput)
    ? Math.max(5000, Math.round(intervalMsInput))
    : projectAutomationState.intervalMs;
  restartProjectAutomationTicker();

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.automation.updated",
    resourceType: "project",
    summary: `自动推进已${enabled ? "开启" : "关闭"}`,
    detail: `intervalMs=${projectAutomationState.intervalMs}`
  });

  res.json({
    enabled: projectAutomationState.enabled,
    intervalMs: projectAutomationState.intervalMs,
    running: projectAutomationState.running,
    lastRunAt: projectAutomationState.lastRunAt,
    lastError: projectAutomationState.lastError,
    lastSummary: projectAutomationState.lastSummary
  });
}));

app.post("/api/projects/automation/run", asyncRoute(async (req, res) => {
  await runProjectAutomationTick({ force: true });

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.automation.run_once",
    resourceType: "project",
    summary: "手动触发自动推进执行一轮"
  });

  res.json({
    enabled: projectAutomationState.enabled,
    intervalMs: projectAutomationState.intervalMs,
    running: projectAutomationState.running,
    lastRunAt: projectAutomationState.lastRunAt,
    lastError: projectAutomationState.lastError,
    lastSummary: projectAutomationState.lastSummary
  });
}));

app.post("/api/projects", asyncRoute(async (req, res) => {
  const description = String(req.body?.description ?? "").trim();

  if (!description) {
    res.status(400).json({ message: "description is required" });
    return;
  }

  const project = await createProject(
    {
      name: req.body?.name,
      description,
      team: req.body?.team
    },
    (await getRuntimeStatus()).mode
  );

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.created",
    resourceType: "project",
    resourceId: project.id,
    summary: `创建项目 ${project.name}`
  });
  kickProjectAutomationTick();
  res.status(201).json(project);
}));

app.post("/api/projects/:id/advance", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);

  if (projectAdvanceLocks.has(projectId)) {
    res.status(409).json({
      success: false,
      error: {
        code: "PROJECT_ADVANCE_IN_PROGRESS",
        message: "该项目正在推进中，请稍后重试。"
      }
    });
    return;
  }

  const project = await findProject(projectId);

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  if (project.status !== "active") {
    res.status(409).json({ message: "Project is not active" });
    return;
  }

  let latest: Awaited<ReturnType<typeof findProject>> | null = null;
  try {
    latest = await withProjectLock(projectId, async () => {
      const current = await findProject(projectId);
      if (!current) {
        return null;
      }

      if (current.pendingApproval) {
        return current;
      }

      const submissions = await buildAutoStageSubmissions(current, {
        action: "stage.auto_submission.manual_advance"
      });
      await submitStageSubmissionBundle(projectId, submissions);
      return findProject(projectId);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "advance failed";

    if (message === "PROJECT_ADVANCE_IN_PROGRESS") {
      res.status(409).json({
        success: false,
        error: {
          code: "PROJECT_ADVANCE_IN_PROGRESS",
          message: "该项目正在推进中，请稍后重试。"
        }
      });
      return;
    }

    if (message.startsWith("DESIGN_REVIEW_REQUIRED:")) {
      const latestProject = await findProject(projectId);
      if (!latestProject) {
        res.status(404).json({ message: "Project not found" });
        return;
      }

      const runtime = await getRuntimeStatus();
      const requiredActions = buildProjectRequiredActions(latestProject, runtime);
      res.status(409).json({
        success: false,
        error: {
          code: "REQUIRES_USER_INTERVENTION",
          message: formatRequiredActionsMessage(requiredActions),
          requiredActions: requiredActions.length > 0
            ? requiredActions
            : [{
              id: "design-review-required",
              severity: "critical",
              title: "设计阶段缺少设计审查卡",
              detail: "请补充设计审查卡后再推进。",
              action: "open_design_review",
              ctaLabel: "提交设计审查卡"
            }]
        }
      });
      return;
    }

    throw error;
  }

  if (!latest) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  const runtime = await getRuntimeStatus();
  const requiredActions = buildProjectRequiredActions(latest, runtime);
  const blockedByUserIntervention = latest.pendingApproval;

  if (blockedByUserIntervention) {
    const actions = requiredActions.length > 0
      ? requiredActions
      : [{
        id: "review-pending-stage",
        severity: "info" as const,
        title: "当前阶段待你确认",
        detail: "请先执行阶段验收（通过或驳回）后再继续推进。",
        action: "review_pending_stage" as const,
        ctaLabel: "执行阶段验收"
      }];
    res.status(409).json({
      success: false,
      error: {
        code: "REQUIRES_USER_INTERVENTION",
        message: formatRequiredActionsMessage(actions),
        requiredActions: actions
      }
    });
    return;
  }

  res.json({
    ...latest,
    requiredActions
  });
}));

app.post("/api/projects/:id/reconcile-deliverables", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await reconcileProjectDeliverablesNow(projectId);
  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.deliverables_reconciled",
    resourceType: "project",
    resourceId: project.id,
    summary: `重建项目 ${project.id} 交付物内容`
  });
  const runtime = await getRuntimeStatus();
  const requiredActions = buildProjectRequiredActions(project, runtime);
  res.json({
    ...project,
    requiredActions
  });
}));

app.get("/api/projects/:id", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId);

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  const runtime = await getRuntimeStatus();
  const requiredActions = buildProjectRequiredActions(project, runtime);
  res.json({
    ...project,
    requiredActions
  });
}));

app.get("/api/projects/:id/executions", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId);
  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  const limitInput = Number(req.query.limit ?? 120);
  const limit = Number.isFinite(limitInput) ? Math.max(1, Math.min(500, Math.round(limitInput))) : 120;
  const executions = await listProjectExecutions(projectId, limit);

  res.json({
    success: true,
    data: {
      projectId,
      total: executions.length,
      executions
    }
  });
}));

app.get("/api/projects/:id/acceptance-report", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId);

  if (!project) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Project not found"
      }
    });
    return;
  }

  const report = buildProjectAcceptanceReport(project);
  res.json({
    success: true,
    data: report
  });
}));

app.get("/api/projects/:id/acceptance-report.md", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId);

  if (!project) {
    res.status(404).type("text/plain; charset=utf-8").send("Project not found");
    return;
  }

  const report = buildProjectAcceptanceReport(project);
  const markdown = renderAcceptanceReportMarkdown(report);

  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=\"acceptance-report-${project.id}.md\"`
  );
  res.send(markdown);
}));

app.post("/api/projects/:id/acceptance-report/archive", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId);

  if (!project) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Project not found"
      }
    });
    return;
  }

  const report = buildProjectAcceptanceReport(project);
  const markdown = renderAcceptanceReportMarkdown(report);
  const title = String(req.body?.title ?? "").trim() || undefined;
  const updated = await archiveProjectAcceptanceReport(projectId, markdown, title);

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.acceptance_report.archived",
    resourceType: "project",
    resourceId: projectId,
    summary: `项目 ${projectId} 验收报告已归档`
  });

  res.json({
    success: true,
    data: {
      projectId,
      archived: true,
      deliverableName: title || `阶段验收报告-${new Date().toISOString().slice(0, 10)}.md`,
      updated
    }
  });
}));

app.get("/api/projects/:id/final-artifacts", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId);

  if (!project) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Project not found"
      }
    });
    return;
  }

  const autoGenerate = String(req.query.generate ?? "auto").toLowerCase() !== "false";
  let activeJob = getLatestFinalArtifactsJob(projectId);
  if (project.status === "completed" && autoGenerate && (!activeJob || activeJob.status === "failed")) {
    activeJob = startFinalArtifactsGenerationJob(projectId, {
      force: activeJob?.status === "failed"
    });
  }

  const report = activeJob?.status === "completed" && activeJob.report
    ? activeJob.report
    : buildProjectFinalArtifactsReport(project, activeJob?.officialSite);

  res.json({
    success: true,
    data: attachFinalArtifactsGeneration(report, activeJob)
  });
}));

app.post("/api/projects/:id/final-artifacts/generate", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId);
  if (!project) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Project not found"
      }
    });
    return;
  }

  const force = Boolean(req.body?.force);
  const job = startFinalArtifactsGenerationJob(projectId, { force });
  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.final_artifacts.generate",
    resourceType: "project",
    resourceId: projectId,
    summary: `触发项目 ${projectId} 最终产物异步生成任务 ${job.jobId}`
  });

  res.json({
    success: true,
    data: {
      projectId,
      queued: true,
      generation: toFinalArtifactsJobProgress(job)
    }
  });
}));

app.get("/api/projects/:id/final-artifacts/job", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId);
  if (!project) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Project not found"
      }
    });
    return;
  }

  const latest = getLatestFinalArtifactsJob(projectId);
  if (!latest) {
    res.json({
      success: true,
      data: {
        projectId,
        generation: null
      }
    });
    return;
  }

  res.json({
    success: true,
    data: {
      projectId,
      generation: toFinalArtifactsJobProgress(latest),
      report: latest.status === "completed" ? latest.report : undefined
    }
  });
}));

app.get("/api/projects/:id/final-artifacts/jobs/:jobId", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const jobId = String(req.params.jobId);
  const project = await findProject(projectId);
  if (!project) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Project not found"
      }
    });
    return;
  }

  const job = finalArtifactsJobsById.get(jobId);
  if (!job || job.projectId !== projectId) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Final artifacts job not found"
      }
    });
    return;
  }

  res.json({
    success: true,
    data: {
      projectId,
      generation: toFinalArtifactsJobProgress(job),
      report: job.status === "completed" ? job.report : undefined
    }
  });
}));

app.get("/api/projects/:id/official-site", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId);

  if (!project) {
    res.status(404).json({ message: "project not found" });
    return;
  }

  if (project.status !== "completed") {
    res.status(409).json({ message: "project is not completed yet" });
    return;
  }

  const artifact = await generateOfficialSiteArtifact(project);
  res.json({
    success: true,
    data: {
      projectId,
      url: artifact.publicPath,
      files: artifact.filePaths
    }
  });
}));

app.get("/api/projects/:id/tasks", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  res.json(await listProjectTasks(projectId));
}));

app.get("/api/tasks", asyncRoute(async (_req, res) => {
  res.json(await listTasks());
}));

app.post("/api/projects/:id/approve", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const current = await findProject(projectId);
  if (!current) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  if (!current.pendingApproval) {
    const runtime = await getRuntimeStatus();
    const requiredActions = buildProjectRequiredActions(current, runtime);
    res.status(409).json({
      success: false,
      error: {
        code: "NO_PENDING_APPROVAL",
        message: requiredActions.length > 0
          ? formatRequiredActionsMessage(requiredActions)
          : "当前阶段没有待确认事项，无需执行审批。",
        requiredActions
      }
    });
    return;
  }

  let project;
  try {
    project = await approveProject(projectId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "approve failed";
    if (message.startsWith("DESIGN_REVIEW_NOT_APPROVED:")) {
      res.status(422).json({ message: message.replace("DESIGN_REVIEW_NOT_APPROVED:", "").trim() });
      return;
    }
    if (message.startsWith("STAGE_TEMPLATE_VALIDATION_FAILED:")) {
      // 自动触发一次交付物补齐，避免用户反复手动点击验收。
      void reconcileProjectDeliverablesNow(projectId).catch((reconcileError) => {
        console.warn("Auto reconcile after template validation failed:", reconcileError);
      });
      res.status(422).json({
        success: false,
        error: {
          code: "STAGE_TEMPLATE_VALIDATION_FAILED",
          message: `${message.replace("STAGE_TEMPLATE_VALIDATION_FAILED:", "").trim()}（已自动触发交付物补齐，请稍后重试验收）`
        }
      });
      return;
    }
    throw error;
  }

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.approved",
    resourceType: "project",
    resourceId: project.id,
    summary: `批准项目阶段 ${project.currentStage}`
  });
  res.json(project);
}));

app.post("/api/projects/:id/reject", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const current = await findProject(projectId);
  if (!current) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  if (!current.pendingApproval) {
    const runtime = await getRuntimeStatus();
    const requiredActions = buildProjectRequiredActions(current, runtime);
    res.status(409).json({
      success: false,
      error: {
        code: "NO_PENDING_APPROVAL",
        message: requiredActions.length > 0
          ? formatRequiredActionsMessage(requiredActions)
          : "当前阶段没有待确认事项，无需驳回。",
        requiredActions
      }
    });
    return;
  }

  const payload = req.body as StageRejectInput;
  const reason = String(payload?.reason ?? "").trim();

  if (!reason) {
    res.status(400).json({ message: "reason is required" });
    return;
  }

  const project = await rejectProjectStage(projectId, { reason });

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.rejected",
    resourceType: "project",
    resourceId: project.id,
    summary: `退回项目阶段 ${project.currentStage}`,
    detail: reason
  });
  res.json(project);
}));

app.post("/api/projects/:id/intervene", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const payload = req.body as InterventionInput;
  const command = String(payload?.command ?? "").trim();

  if (!command) {
    res.status(400).json({ message: "command is required" });
    return;
  }

  const project = await interveneProject(projectId, command);

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.intervened",
    resourceType: "project",
    resourceId: project.id,
    summary: `项目 ${project.id} 已被人工介入`,
    detail: command
  });
  res.json(project);
}));

app.post("/api/projects/:id/resume", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await resumeProject(projectId);

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.resumed",
    resourceType: "project",
    resourceId: project.id,
    summary: `项目 ${project.id} 已恢复执行`
  });
  kickProjectAutomationTick();
  res.json(project);
}));

app.post("/api/projects/:id/close", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await closeProject(projectId);

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.closed",
    resourceType: "project",
    resourceId: project.id,
    summary: `项目 ${project.id} 已关闭`
  });
  res.json(project);
}));

app.delete("/api/projects/:id", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const deleted = await deleteProject(projectId);

  if (!deleted) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.deleted",
    resourceType: "project",
    resourceId: projectId,
    summary: `项目 ${projectId} 已删除`
  });

  res.json({ success: true, id: projectId });
}));

app.post("/api/projects/:id/stages/submit", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const payload = req.body as StageSubmissionInput;
  const content = String(payload?.content ?? "").trim();

  if (!content) {
    res.status(400).json({ message: "content is required" });
    return;
  }

  let project;
  try {
    project = await submitCurrentStage(projectId, {
      title: payload?.title,
      content,
      designReview: payload?.designReview
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "submit failed";
    if (message.startsWith("DESIGN_REVIEW_REQUIRED:")) {
      res.status(422).json({ message: message.replace("DESIGN_REVIEW_REQUIRED:", "").trim() });
      return;
    }
    if (message.startsWith("DESIGN_REVIEW_NOT_APPROVED:")) {
      res.status(422).json({ message: message.replace("DESIGN_REVIEW_NOT_APPROVED:", "").trim() });
      return;
    }
    if (message.startsWith("STAGE_TEMPLATE_VALIDATION_FAILED:")) {
      res.status(422).json({
        success: false,
        error: {
          code: "STAGE_TEMPLATE_VALIDATION_FAILED",
          message: message.replace("STAGE_TEMPLATE_VALIDATION_FAILED:", "").trim()
        }
      });
      return;
    }
    throw error;
  }

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.stage_submitted",
    resourceType: "project",
    resourceId: project.id,
    summary: `提交项目 ${project.id} 当前阶段交付物`
  });
  res.json(project);
}));

app.post("/api/projects/:id/messages", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const payload = req.body as ProjectMessageInput;
  const message = String(payload?.message ?? "").trim();

  if (!message) {
    res.status(400).json({ message: "message is required" });
    return;
  }

  const project = await postProjectMessage(projectId, { message });

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.message_sent",
    resourceType: "project",
    resourceId: project.id,
    summary: `向项目 ${project.id} 发送指导`,
    detail: message
  });
  res.json(project);
}));

app.patch("/api/tasks/:taskId", asyncRoute(async (req, res) => {
  const taskId = String(req.params.taskId);
  const payload = req.body as TaskUpdateInput;
  const status = payload?.status;

  if (!status) {
    res.status(400).json({ message: "status is required" });
    return;
  }

  const task = await updateTaskStatus(taskId, status);

  if (!task) {
    res.status(404).json({ message: "Task not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "task.updated",
    resourceType: "task",
    resourceId: task.id,
    summary: `任务 ${task.id} 状态更新为 ${task.status}`
  });
  res.json(task);
}));

app.get("/api/openclaw/workspace", asyncRoute(async (_req, res) => {
  res.json(await getOpenClawWorkspace());
}));

app.get("/api/openclaw/status", asyncRoute(async (req, res) => {
  const forceRefresh = String(req.query.refresh ?? "") === "true";
  res.json(await getOpenClawStatusSummary(forceRefresh));
}));

app.get("/api/openclaw/projects", asyncRoute(async (_req, res) => {
  res.json(await listOpenClawProjects());
}));

app.get("/api/openclaw/projects/:projectId", asyncRoute(async (req, res) => {
  const project = await findOpenClawProject(String(req.params.projectId));

  if (!project) {
    res.status(404).json({ message: "OpenClaw project not found" });
    return;
  }

  res.json(project);
}));

app.patch("/api/openclaw/projects/:projectId/tasks/:taskId", asyncRoute(async (req, res) => {
  const payload = req.body as OpenClawTaskUpdateInput;
  const project = await updateOpenClawProjectTask(
    String(req.params.projectId),
    String(req.params.taskId),
    payload
  );

  if (!project) {
    res.status(404).json({ message: "OpenClaw project task not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "openclaw.project.task.updated",
    resourceType: "openclaw-project",
    resourceId: String(req.params.projectId),
    summary: `更新 OpenClaw 项目任务 ${String(req.params.taskId)}`
  });
  res.json(project);
}));

app.patch("/api/openclaw/projects/:projectId/tasks", asyncRoute(async (req, res) => {
  const payload = req.body as OpenClawBatchTaskUpdateInput;
  const updates = Array.isArray(payload?.updates) ? payload.updates : [];

  if (updates.length === 0) {
    res.status(400).json({ message: "updates is required" });
    return;
  }

  const project = await updateOpenClawProjectTasks(String(req.params.projectId), payload);

  if (!project) {
    res.status(404).json({ message: "OpenClaw project task not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "openclaw.project.tasks.batch_updated",
    resourceType: "openclaw-project",
    resourceId: String(req.params.projectId),
    summary: `批量更新 ${updates.length} 个 OpenClaw 项目任务`
  });
  res.json(project);
}));

app.get("/api/openclaw/projects/:projectId/report", asyncRoute(async (req, res) => {
  const report = await buildOpenClawProjectReport(String(req.params.projectId));

  if (!report) {
    res.status(404).json({ message: "OpenClaw project not found" });
    return;
  }

  res.json(report);
}));

app.get("/api/openclaw/agents", asyncRoute(async (_req, res) => {
  res.json(await listOpenClawAgents());
}));

app.post("/api/openclaw/agents", asyncRoute(async (req, res) => {
  const payload = req.body as OpenClawCreateAgentInput;
  const agent = await createOpenClawAgent(payload);

  if (!agent) {
    res.status(500).json({ message: "failed to create OpenClaw agent" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "openclaw.agent.created",
    resourceType: "openclaw-agent",
    resourceId: agent.agentId,
    summary: `创建 OpenClaw Agent ${agent.name}`,
    detail: `model=${agent.model}`
  });
  res.status(201).json(agent);
}));

app.get("/api/openclaw/agents/:agentId", asyncRoute(async (req, res) => {
  const agent = await findOpenClawAgent(String(req.params.agentId));

  if (!agent) {
    res.status(404).json({ message: "OpenClaw agent not found" });
    return;
  }

  res.json(agent);
}));

app.put("/api/openclaw/agents/:agentId/settings", asyncRoute(async (req, res) => {
  const agentId = String(req.params.agentId);
  const payload = req.body as OpenClawAgentSettingsInput;
  const agent = await updateOpenClawAgentSettings(agentId, payload);

  if (!agent) {
    res.status(404).json({ message: "OpenClaw agent not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "openclaw.agent.settings.updated",
    resourceType: "openclaw-agent",
    resourceId: agentId,
    summary: `更新 OpenClaw Agent ${agent.name} 的指挥设置`,
    detail: JSON.stringify({
      selectedModel: payload.selectedModel,
      defaultModel: payload.defaultModel,
      fallbackModel: payload.fallbackModel,
      executionMode: payload.executionMode
    })
  });
  res.json(agent);
}));

app.post("/api/openclaw/agents/:agentId/preview", asyncRoute(async (req, res) => {
  const agentId = String(req.params.agentId);
  const payload = req.body as OpenClawInstructionPreviewInput;
  const preview = await previewOpenClawAgentInstruction(agentId, payload);

  if (!preview) {
    res.status(404).json({ message: "OpenClaw agent not found" });
    return;
  }

  res.json(preview);
}));

app.put("/api/openclaw/agents/:agentId/soul", asyncRoute(async (req, res) => {
  const agentId = String(req.params.agentId);
  const payload = req.body as OpenClawDocumentUpdateInput;
  const content = String(payload?.content ?? "").trim();

  if (!content) {
    res.status(400).json({ message: "content is required" });
    return;
  }

  const agent = await updateOpenClawAgentDocument(agentId, "soul", payload);
  if (!agent) {
    res.status(404).json({ message: "OpenClaw agent not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "openclaw.agent.soul.updated",
    resourceType: "openclaw-agent",
    resourceId: agentId,
    summary: `更新 OpenClaw Agent ${agent.name} 的 SOUL`
  });
  res.json(agent);
}));

app.put("/api/openclaw/agents/:agentId/sop", asyncRoute(async (req, res) => {
  const agentId = String(req.params.agentId);
  const payload = req.body as OpenClawDocumentUpdateInput;
  const content = String(payload?.content ?? "").trim();

  if (!content) {
    res.status(400).json({ message: "content is required" });
    return;
  }

  const agent = await updateOpenClawAgentDocument(agentId, "sop", payload);
  if (!agent) {
    res.status(404).json({ message: "OpenClaw agent not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "openclaw.agent.sop.updated",
    resourceType: "openclaw-agent",
    resourceId: agentId,
    summary: `更新 OpenClaw Agent ${agent.name} 的 SOP`
  });
  res.json(agent);
}));

app.post("/api/openclaw/agents/:agentId/message", asyncRoute(async (req, res) => {
  const payload = req.body as OpenClawAgentMessageInput;
  const message = String(payload?.message ?? "").trim();

  if (!message) {
    res.status(400).json({ message: "message is required" });
    return;
  }

  const result = await sendOpenClawAgentMessage(String(req.params.agentId), { message });
  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "openclaw.agent.message.sent",
    resourceType: "openclaw-agent",
    resourceId: String(req.params.agentId),
    summary: `向 OpenClaw Agent ${String(req.params.agentId)} 下发指令`,
    detail: message
  });
  res.json(result);
}));

app.post("/api/openclaw/agents/batch-message", asyncRoute(async (req, res) => {
  const payload = req.body as OpenClawBatchAgentMessageInput;
  const message = String(payload?.message ?? "").trim();
  const agentIds = Array.isArray(payload?.agentIds) ? payload.agentIds.map((item) => String(item)) : [];

  if (!message) {
    res.status(400).json({ message: "message is required" });
    return;
  }

  if (agentIds.length === 0) {
    res.status(400).json({ message: "agentIds is required" });
    return;
  }

  const result = await sendOpenClawBatchAgentMessage({ agentIds, message });
  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "openclaw.agent.batch_message.sent",
    resourceType: "openclaw-agent",
    summary: `批量向 ${result.requestedAgentIds.length} 个 OpenClaw Agent 下发指令`,
    detail: message
  });
  res.json(result);
}));

app.post("/api/openclaw/agents/:agentId/memory", asyncRoute(async (req, res) => {
  const agentId = String(req.params.agentId);
  const payload = req.body as OpenClawMemoryEntryInput;
  const agent = await addOpenClawAgentMemory(agentId, payload);

  if (!agent) {
    res.status(404).json({ message: "OpenClaw agent not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "openclaw.agent.memory.created",
    resourceType: "openclaw-agent",
    resourceId: agentId,
    summary: `为 OpenClaw Agent ${agent.name} 新增长期记忆`,
    detail: payload.summary
  });
  res.status(201).json(agent);
}));

app.get("/api/openclaw/sla", asyncRoute(async (_req, res) => {
  res.json(await listOpenClawAgentSla());
}));

type OpenClawRealtimeSnapshot = {
  timestamp: string;
  totalAgents: number;
  activeAgents: number;
  attentionAgents: number;
  offlineAgents: number;
  totalProjects: number;
  blockedProjects: number;
  completedProjects: number;
  totalTasks: number;
  blockedTasks: number;
  inProgressTasks: number;
  averageProjectProgress: number;
};

function buildOpenClawRealtimeSnapshot(
  agentList: Awaited<ReturnType<typeof listOpenClawAgents>>,
  projectList: Awaited<ReturnType<typeof listOpenClawProjects>>
): OpenClawRealtimeSnapshot {
  const totalTasks = projectList.reduce((sum, project) => sum + (project.taskCount || 0), 0);
  const blockedTasks = projectList.reduce((sum, project) => sum + (project.blockedTaskCount || 0), 0);
  const inProgressTasks = projectList.reduce(
    (sum, project) => sum + project.tasks.filter((task) => task.status === "in_progress").length,
    0
  );
  const averageProjectProgress = projectList.length > 0
    ? Math.round(projectList.reduce((sum, project) => sum + (project.progress || 0), 0) / projectList.length)
    : 0;

  return {
    timestamp: new Date().toISOString(),
    totalAgents: agentList.length,
    activeAgents: agentList.filter((agent) => agent.status === "active").length,
    attentionAgents: agentList.filter((agent) => agent.status === "attention").length,
    offlineAgents: agentList.filter((agent) => agent.status === "offline").length,
    totalProjects: projectList.length,
    blockedProjects: projectList.filter((project) => project.status === "blocked").length,
    completedProjects: projectList.filter((project) => project.status === "completed").length,
    totalTasks,
    blockedTasks,
    inProgressTasks,
    averageProjectProgress
  };
}

// SSE 实时事件端点
app.get("/api/openclaw/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  let closed = false;
  let previousSnapshot: OpenClawRealtimeSnapshot | null = null;
  let previousAgentState = new Map<string, string>();
  let previousProjectState = new Map<string, string>();

  const emit = (event: string, payload: unknown) => {
    if (closed) {
      return;
    }
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const emitRealtimeEvents = async () => {
    try {
      const [agentList, projectList] = await Promise.all([
        listOpenClawAgents(),
        listOpenClawProjects()
      ]);

      const snapshot = buildOpenClawRealtimeSnapshot(agentList, projectList);
      emit("snapshot", snapshot);

      const changedAgents = agentList
        .map((agent) => ({
          agentId: agent.agentId,
          name: agent.name,
          status: agent.status,
          blockedTaskCount: agent.blockedTaskCount,
          taskCount: agent.taskCount
        }))
        .filter((agent) => previousAgentState.has(agent.agentId) && previousAgentState.get(agent.agentId) !== agent.status);

      if (changedAgents.length > 0) {
        emit("agent_status", {
          timestamp: snapshot.timestamp,
          changedAgents
        });
      }

      const changedProjects = projectList
        .map((project) => ({
          projectId: project.id,
          name: project.name,
          status: project.status,
          progress: project.progress,
          blockedTaskCount: project.blockedTaskCount
        }))
        .filter((project) => {
          const previous = previousProjectState.get(project.projectId);
          const current = `${project.status}:${project.progress}:${project.blockedTaskCount}`;
          return Boolean(previous) && previous !== current;
        });

      if (changedProjects.length > 0) {
        emit("project_progress", {
          timestamp: snapshot.timestamp,
          changedProjects
        });
      }

      if (
        previousSnapshot
        && (
          previousSnapshot.blockedTasks !== snapshot.blockedTasks
          || previousSnapshot.inProgressTasks !== snapshot.inProgressTasks
          || previousSnapshot.totalTasks !== snapshot.totalTasks
        )
      ) {
        emit("task_update", {
          timestamp: snapshot.timestamp,
          totalTasks: snapshot.totalTasks,
          blockedTasks: snapshot.blockedTasks,
          inProgressTasks: snapshot.inProgressTasks
        });
      }

      previousSnapshot = snapshot;
      previousAgentState = new Map(agentList.map((agent) => [agent.agentId, agent.status]));
      previousProjectState = new Map(
        projectList.map((project) => [
          project.id,
          `${project.status}:${project.progress}:${project.blockedTaskCount}`
        ])
      );
    } catch (error) {
      emit("system", {
        timestamp: new Date().toISOString(),
        status: "degraded",
        message: error instanceof Error ? error.message : "failed to load realtime openclaw state"
      });
    }
  };

  emit("connected", { status: "ok" });
  void emitRealtimeEvents();

  // 每 30 秒心跳
  const heartbeat = setInterval(() => {
    emit("heartbeat", { time: new Date().toISOString() });
  }, 30000);

  // 每 5 秒轮询并基于真实数据推送事件
  const poller = setInterval(() => {
    void emitRealtimeEvents();
  }, 5000);

  req.on("close", () => {
    closed = true;
    clearInterval(heartbeat);
    clearInterval(poller);
    res.end();
  });
});

app.get("/api/projects/:id/live", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId);

  if (!project) {
    res.status(404).end();
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const fragments = splitScript(project.liveSession.body, 18);
  let index = 0;

  sendEvent(res, "session", {
    title: project.liveSession.title,
    activeRole: project.liveSession.activeRole,
    startedAt: project.liveSession.startedAt,
    provider: project.liveSession.provider
  });

  const interval = setInterval(async () => {
    const currentProject = await findProject(projectId);

    if (!currentProject) {
      clearInterval(interval);
      res.end();
      return;
    }

    if (currentProject.status === "paused") {
      sendEvent(res, "system", {
        title: "项目已暂停",
        content: "等待你的进一步指令。"
      });
      return;
    }

    if (index >= fragments.length) {
      sendEvent(res, "heartbeat", { done: true, timestamp: new Date().toISOString() });
      clearInterval(interval);
      return;
    }

    const delta = fragments[index];
    sendEvent(res, "agent_typing", {
      delta,
      activeRole: currentProject.liveSession.activeRole,
      timestamp: new Date().toISOString()
    });

    if (index === Math.floor(fragments.length / 2)) {
      sendEvent(res, "thinking_step", {
        content: "Agent 已完成半程推演，正在收敛结构与结论。",
        activeRole: currentProject.liveSession.activeRole
      });
    }

    index += 1;
  }, 600);

  req.on("close", () => {
    clearInterval(interval);
    res.end();
  });
}));

if (existsSync(webGeneratedPath)) {
  app.use("/generated", express.static(webGeneratedPath));
}
if (existsSync(siteGeneratedPath)) {
  app.use("/generated", express.static(siteGeneratedPath));
}

if (existsSync(webDistPath)) {
  app.use(express.static(webDistPath));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path === "/health" || req.path === "/ready") {
      next();
      return;
    }

    res.sendFile(path.join(webDistPath, "index.html"));
  });
}

function sendEvent(res: express.Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function splitScript(input: string, size: number) {
  const parts: string[] = [];

  for (let start = 0; start < input.length; start += size) {
    parts.push(input.slice(start, start + size));
  }

  return parts;
}

function asyncRoute(
  handler: (req: express.Request, res: express.Response) => Promise<void>
): express.RequestHandler {
  return (req, res, next) => {
    void handler(req, res).catch(next);
  };
}

async function start() {
  await ensureSeedData((await getRuntimeStatus()).mode);
  ensureLocalAgentMonitorLive();
  restartProjectAutomationTicker();
  if (projectAutomationState.enabled) {
    void runProjectAutomationTick();
  }

  app.listen(port, host, () => {
    console.log(
      `OCC API listening on http://${host}:${port}${existsSync(webDistPath) ? " (serving web dist)" : ""}`
    );
  });
}

async function safeAudit(
  req: express.Request,
  res: express.Response,
  input: {
    actorType: "admin" | "system";
    actorLabel: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    summary: string;
    detail?: string;
  }
) {
  try {
    await writeAuditLog({
      ...input,
      requestId: String(res.locals.requestId ?? ""),
      ipAddress: req.ip
    });
  } catch (error) {
    console.warn("Audit log write failed:", error);
  }
}

app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const requestId = String(res.locals.requestId ?? randomUUID());
  const message = error instanceof Error ? error.message : "Internal server error";

  console.error(
    JSON.stringify({
      requestId,
      method: req.method,
      path: req.originalUrl,
      error: message
    })
  );

  if (res.headersSent) {
    return;
  }

  res.status(500).json({
    message,
    requestId
  });
});

void start();
