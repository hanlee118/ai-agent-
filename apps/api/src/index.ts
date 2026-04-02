import express from "express";
import cors from "cors";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
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
  getDesignInterventionSignal,
  getSystemHealth,
  interveneProject,
  listProjectTasks,
  listProjectExecutions,
  listTasks,
  listProjects,
  runProjectStageAgent,
  postProjectMessage,
  promoteReadyDraftDeliverablesForCurrentStage,
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
  buildRequirementAwareDesignSections,
  buildRequirementAwareVisualPreviewHtml,
  evaluateVisualDesignRequirementAlignment,
  resolveDesignRequirementProfile
} from "./system/design-preview.js";
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
import { createSystemRouter } from "./routes/system.js";
import { createNotificationsRouter } from "./routes/notifications.js";
import { createOpenClawRouter } from "./routes/openclaw.js";
import { createProjectsRouter } from "./routes/projects.js";
import { createGitLabRouter, syncProjectGitLabHarness } from "./routes/gitlab.js";
import { buildOpenApiSpec } from "./system/openapi.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);
const host = String(process.env.HOST ?? "127.0.0.1").trim() || "127.0.0.1";
const webDistPath = fileURLToPath(new URL("../../web/dist", import.meta.url));
const webGeneratedPath = fileURLToPath(new URL("../../web/public/generated", import.meta.url));
const siteGeneratedPath = fileURLToPath(new URL("../../../site/generated", import.meta.url));
const projectAutoAdvanceIntervalMs = Math.max(5000, Number(process.env.PROJECT_AUTO_ADVANCE_INTERVAL_MS ?? 12000));
const GITLAB_HARNESS_SYNC_STAGES = new Set<StageType>(["DEV", "ACCEPT"]);

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
const projectAdvanceJobs = new Map<string, Promise<void>>();
const projectAdvanceJobErrors = new Map<string, { message: string; at: string }>();

const STAGE_AUTO_DELIVERABLE_TITLES: Record<StageType, string[]> = {
  INIT: ["项目章程.md"],
  ANALYSIS: ["需求分析文档.md", "项目排期方案.md"],
  DESIGN: ["客户汇报方案.ppt.md", "实施方案说明.word.md", "设计审查卡.md", "视觉定稿单页.preview.html.md"],
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
  reasonCode?: "design_ambiguity";
  prefillContent?: string;
};

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

const GENERIC_OUTPUT_PATTERNS = [
  /固定仪表盘、项目观测室、Agent 中心三大页面/,
  /让实时输出始终成为视觉中心/,
  /把审批与紧急介入做成明确的强动作/,
  /避免常规 SaaS 模板感/,
  /优先打通数据库、仓储和实时执行流/
];

const MANUAL_ADVANCE_MAX_ATTEMPTS = Math.max(2, Number(process.env.MANUAL_ADVANCE_MAX_ATTEMPTS ?? 3));
const MANUAL_ADVANCE_ATTEMPT_TIMEOUT_MS = Math.max(
  45_000,
  Number(process.env.MANUAL_ADVANCE_ATTEMPT_TIMEOUT_MS ?? 180_000)
);
const MANUAL_ADVANCE_BACKOFF_BASE_MS = Math.max(
  900,
  Number(process.env.MANUAL_ADVANCE_BACKOFF_BASE_MS ?? 1_200)
);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(task: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function computeAdvanceBackoffMs(attempt: number, recovering = false) {
  const normalizedAttempt = Math.max(1, attempt);
  const base = Math.min(22_000, MANUAL_ADVANCE_BACKOFF_BASE_MS * (2 ** (normalizedAttempt - 1)));
  const jitter = Math.round(base * (recovering ? 0.3 : 0.2) * Math.random());
  return Math.min(28_000, base + jitter + (recovering ? 450 : 180));
}

function isTransientAdvanceErrorMessage(message: string) {
  const normalized = String(message || "").toUpperCase();
  return normalized.includes("MODEL_ATTEMPT_TIMEOUT")
    || normalized.includes("MANUAL_ADVANCE_ATTEMPT_TIMEOUT")
    || normalized.includes("REQUEST_TIMEOUT")
    || normalized.includes("ETIMEDOUT")
    || normalized.includes("ECONNRESET")
    || normalized.includes("EAI_AGAIN")
    || normalized.includes("429")
    || normalized.includes("503")
    || normalized.includes("REAL_MODEL_GATE_FAILED")
    || normalized.includes("PROJECT_ADVANCE_IN_PROGRESS");
}

function isTemplateValidationErrorMessage(message: string) {
  return String(message || "").includes("STAGE_TEMPLATE_VALIDATION_FAILED");
}

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

function summarizeAdvanceError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "advance failed");
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.length > 260 ? `${normalized.slice(0, 260)}...` : normalized;
}

async function executeManualAdvanceCycle(projectId: string) {
  await withProjectLock(projectId, async () => {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= MANUAL_ADVANCE_MAX_ATTEMPTS; attempt += 1) {
      const current = await findProject(projectId);
      if (!current || current.status !== "active" || current.pendingApproval) {
        return;
      }

      const promoted = await promoteReadyDraftDeliverablesForCurrentStage(projectId);
      if (promoted?.pendingApproval) {
        return;
      }

      try {
        const submissions = await withTimeout(
          buildAutoStageSubmissions(current, {
            action: "stage.auto_submission.manual_advance",
            metadata: {
              manualAdvanceAttempt: attempt,
              manualAdvanceMaxAttempts: MANUAL_ADVANCE_MAX_ATTEMPTS
            }
          }),
          MANUAL_ADVANCE_ATTEMPT_TIMEOUT_MS,
          `MANUAL_ADVANCE_ATTEMPT_TIMEOUT: round=${attempt} buildAutoStageSubmissions exceeded ${MANUAL_ADVANCE_ATTEMPT_TIMEOUT_MS}ms`
        );
        await withTimeout(
          submitStageSubmissionBundle(projectId, submissions),
          MANUAL_ADVANCE_ATTEMPT_TIMEOUT_MS,
          `MANUAL_ADVANCE_ATTEMPT_TIMEOUT: round=${attempt} submitStageSubmissionBundle exceeded ${MANUAL_ADVANCE_ATTEMPT_TIMEOUT_MS}ms`
        );
        return;
      } catch (error) {
        lastError = error;
        const message = summarizeAdvanceError(error);
        const isTemplateError = isTemplateValidationErrorMessage(message);
        const isTransientError = isTransientAdvanceErrorMessage(message);

        if (!isTemplateError && !isTransientError) {
          throw error;
        }

        const isRealModelGateError = message.includes("REAL_MODEL_GATE_FAILED");
        if (isTemplateError || isRealModelGateError) {
          await reconcileProjectDeliverablesNow(projectId).catch((reconcileError) => {
            console.warn(
              `[project.advance] auto reconcile failed for ${projectId}:`,
              reconcileError instanceof Error ? reconcileError.message : String(reconcileError)
            );
          });
        }

        if (!isTemplateError) {
          await validateRuntimeSettings().catch(() => {
            // ignore runtime validation errors, continue retry loop
          });
        }

        if (attempt < MANUAL_ADVANCE_MAX_ATTEMPTS) {
          const backoffMs = computeAdvanceBackoffMs(attempt, isRealModelGateError);
          await sleep(backoffMs);
          continue;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "manual advance failed"));
  });
}

function ensureManualAdvanceJob(projectId: string) {
  const existing = projectAdvanceJobs.get(projectId);
  if (existing) {
    return existing;
  }

  const job = (async () => {
    try {
      await executeManualAdvanceCycle(projectId);
      projectAdvanceJobErrors.delete(projectId);
    } catch (error) {
      const message = summarizeAdvanceError(error);
      // A transient lock race means another worker is already advancing this project.
      // Treat it as in-progress instead of persisting a failure signal.
      if (message === "PROJECT_ADVANCE_IN_PROGRESS") {
        return;
      }
      projectAdvanceJobErrors.set(projectId, {
        message,
        at: new Date().toISOString()
      });
      console.warn(`[project.advance] ${projectId} failed: ${message}`);
    }
  })().finally(() => {
    projectAdvanceJobs.delete(projectId);
  });

  projectAdvanceJobs.set(projectId, job);
  return job;
}

function buildDesignReviewPayload(
  project: NonNullable<Awaited<ReturnType<typeof findProject>>>,
  model: string
): NonNullable<StageSubmissionInput["designReview"]> {
  const profile = resolveDesignRequirementProfile({
    projectName: project.name,
    projectDescription: project.description,
    keywords: project.parsedIntent.keywords
  });

  return {
    visualDirection: profile.visualDirection,
    brandTone: profile.brandTone,
    uxPrinciples: profile.uxPrinciples,
    accessibilityChecklist: profile.accessibilityChecklist,
    approvedBy: "系统自动审查",
    approved: true,
    notes: `自动推进生成，来源模型 ${model}`
  };
}

function buildDesignRequiredSections(
  project: NonNullable<Awaited<ReturnType<typeof findProject>>>,
  title: string
) {
  return buildRequirementAwareDesignSections({
    projectName: project.name,
    projectDescription: project.description,
    keywords: project.parsedIntent.keywords,
    title
  });
}

function isVisualMockupDeliverableTitle(title: string) {
  return /视觉定稿|视觉设计稿|单页预览|mockup|wireframe|design preview|preview\.html/i.test(String(title || ""));
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

function buildVisualDesignPreviewHtml(
  project: NonNullable<Awaited<ReturnType<typeof findProject>>>,
  title: string,
  visualDirection: string
) {
  return buildRequirementAwareVisualPreviewHtml({
    projectName: project.name,
    projectDescription: project.description,
    keywords: project.parsedIntent.keywords,
    visualDirection: `${visualDirection}（${title}）`
  });
}

function hasRequirementAlignedVisualDesignPreview(
  project: NonNullable<Awaited<ReturnType<typeof findProject>>>,
  content: string
) {
  if (!hasVisualDesignPreview(content)) {
    return false;
  }
  return evaluateVisualDesignRequirementAlignment({
    projectName: project.name,
    projectDescription: project.description,
    keywords: project.parsedIntent.keywords,
    content
  }).pass;
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

function formatTaskStatusForEvidence(status: string) {
  if (status === "done") return "已完成";
  if (status === "in_progress") return "进行中";
  if (status === "blocked") return "阻塞";
  return "待处理";
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
    `- ${index + 1}. ${task.title}（${formatTaskStatusForEvidence(task.status)} / 优先级 ${task.priority}）\n  - 说明: ${task.description || "暂无补充说明"}`
  ));
}

function buildDeliverableSpecificSections(
  stageType: StageType,
  title: string,
  project: NonNullable<Awaited<ReturnType<typeof findProject>>>
) {
  return [
    "## 专业模板约束",
    ...buildDeliverableTemplatePromptBlock(title, stageType, project.parsedIntent.keywords).map((line) => (line.startsWith("- ") ? line : `- ${line}`)),
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
  const strictRealModel = process.env.STRICT_REAL_MODEL_OUTPUT === "true" || isRealModelGateEnabled();

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

  if (template.kind === "visual_mockup" && !hasVisualDesignPreview(input.content)) {
    score -= 20;
    issues.push("缺少可渲染视觉设计稿（需包含静态图或 ```html 单页代码）。");
  }
  if (input.stageType === "DESIGN" && template.kind === "visual_mockup" && hasVisualDesignPreview(input.content)) {
    const alignment = evaluateVisualDesignRequirementAlignment({
      projectName: input.project.name,
      projectDescription: input.project.description,
      keywords: input.project.parsedIntent.keywords,
      content: input.content
    });
    diagnostics.push(...alignment.diagnostics.map((item) => `设计对齐: ${item}`));
    if (!alignment.pass) {
      score -= 24;
      issues.push(...alignment.issues);
    }
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
  if (project.status === "completed") {
    return actions;
  }
  const currentStageDeliverables = project.deliverables
    .filter((item) => item.stageType === project.currentStage)
    .sort((left, right) => right.version - left.version);
  const designIntervention = getDesignInterventionSignal(project);

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
      content: item.content,
      project,
      stageType: item.stageType,
      deliverableName: item.name
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

    if (project.currentStage === "DESIGN" && designIntervention.required) {
      if (!currentStageDeliverables.some((item) => hasApprovedDesignReview(String(item.content || "")))) {
        actions.push({
          id: "design-review-required",
          severity: "critical",
          title: "设计阶段需要人工介入确认",
          detail: `检测到设计阶段存在“${designIntervention.reasonDetail || "需求澄清"}”信号，请确认或补充设计审查卡后继续推进。`,
          action: "open_design_review",
          ctaLabel: "提交设计审查卡",
          reasonCode: designIntervention.reasonCode,
          prefillContent: designIntervention.prefillContent
        });
      }

      const hasVisualPreview = currentStageDeliverables.some((item) =>
        isVisualMockupDeliverableTitle(item.name) && hasRequirementAlignedVisualDesignPreview(project, String(item.content || ""))
      );
      if (!hasVisualPreview) {
        actions.push({
          id: "design-visual-preview-required",
          severity: "critical",
          title: "设计阶段缺少可视化设计稿",
          detail: "请补充可确认的视觉稿（静态图或单页 HTML 预览），用于业务确认后再进入开发。",
          action: "open_design_review",
          ctaLabel: "补齐视觉设计稿",
          reasonCode: designIntervention.reasonCode,
          prefillContent: designIntervention.prefillContent
        });
      }
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
  } else if (project.currentStage === "DESIGN" && designIntervention.required && currentStageDeliverables.length === 0) {
    actions.push({
      id: "design-phase-no-deliverable",
      severity: "warning",
      title: "设计阶段需要先确认澄清项",
      detail: `检测到设计 Agent 存在“${designIntervention.reasonDetail || "需求澄清"}”阻塞，请先确认审查卡再继续。`,
      action: "open_design_review",
      ctaLabel: "填写设计审查卡",
      reasonCode: designIntervention.reasonCode,
      prefillContent: designIntervention.prefillContent
    });
  } else if (project.currentStage === "DESIGN" && designIntervention.required) {
    const hasVisualPreview = currentStageDeliverables.some((item) =>
      isVisualMockupDeliverableTitle(item.name) && hasRequirementAlignedVisualDesignPreview(project, String(item.content || ""))
    );
    if (!hasVisualPreview) {
      actions.push({
        id: "design-visual-preview-recommended",
        severity: "warning",
        title: "设计阶段需补齐可视化确认稿",
        detail: "当前检测到设计澄清需求，建议先补齐静态图或 HTML 预览再推进，避免返工。",
        action: "open_design_review",
        ctaLabel: "补齐视觉设计稿",
        reasonCode: designIntervention.reasonCode,
        prefillContent: designIntervention.prefillContent
      });
    }
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
      severity: isRealModelGateEnabled() ? "critical" : "warning",
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
    const templateCoverageLines = template.requiredSections.map((section) => `- ${section.replace(/^##\s*/, "")}`);
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
      "## 模板章节覆盖要求",
      ...templateCoverageLines,
      "- 缺失任一章节即视为未完成交付，需返工补齐。",
      "",
      "## 验收检查清单",
      ...template.acceptanceChecklist.map((item) => `- ${item}`),
      "",
      ...deliverableSpecificSections,
      "",
      "## 审阅要点",
      ...checklist
    ].join("\n");

    if (project.currentStage === "DESIGN" && isVisualMockupDeliverableTitle(title) && !hasVisualDesignPreview(content)) {
      const designReview = buildDesignReviewPayload(project, run.model);
      content = [
        content,
        "",
        "## 单页预览代码（HTML）",
        "```html",
        buildVisualDesignPreviewHtml(project, title, designReview.visualDirection),
        "```",
        "",
        "## 预览说明",
        "- 该 HTML 用于设计确认，开发阶段可按此结构实现真实页面。",
        "- 若需静态图，可对该单页截图并附在交付物中。"
      ].join("\n");
    }

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
      `- 自动质检结论: ${quality.pass ? "通过" : "未通过（需补全）"}`,
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

async function trySyncGitLabHarnessForProject(
  project: NonNullable<Awaited<ReturnType<typeof findProject>>>,
  options?: {
    stageType?: string;
    closeOnComplete?: boolean;
    reason?: string;
  }
) {
  const normalizedStage = String(options?.stageType || project.currentStage || "").trim().toUpperCase();
  const closeOnComplete = Boolean(options?.closeOnComplete || project.status === "completed");
  const shouldSync = GITLAB_HARNESS_SYNC_STAGES.has(normalizedStage as StageType) || closeOnComplete;

  if (!shouldSync) {
    return;
  }

  try {
    const result = await syncProjectGitLabHarness({
      projectId: project.id,
      stageType: normalizedStage || undefined,
      closeOnComplete
    });
    if (!result.ok) {
      console.warn(`[GitLab Harness] sync skipped (${options?.reason || "automation"}): ${result.code} ${result.message}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.warn(`[GitLab Harness] sync failed (${options?.reason || "automation"}): ${message}`);
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
          if (refreshed) {
            await trySyncGitLabHarnessForProject(refreshed, {
              reason: "project.automation_tick"
            });
          }
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

function evaluateDevImplementationEvidenceForAcceptance(input: {
  projectName?: string;
  projectDescription?: string;
  keywords?: string[];
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
    issues.push("缺少多页面路由证据");
  }

  const endpointMatches = Array.from(
    text.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+\/[a-zA-Z0-9_:/?&=\-]+/gi)
  ).map((match) => String(match[0] || "").trim().toUpperCase());
  const apiPathMatches = Array.from(
    text.matchAll(/\/api\/[a-zA-Z0-9_:/?&=\-]+/gi)
  ).map((match) => String(match[0] || "").trim().toLowerCase());
  const endpointSignalCount = new Set([...endpointMatches, ...apiPathMatches].filter(Boolean)).size;
  if (endpointSignalCount < 2) {
    issues.push("缺少 API 设计证据");
  }

  const hasStorageSignal = /(mysql|postgres|sqlite|redis|mongodb|prisma|数据表|schema|迁移|索引|持久化|仓储层|表结构)/i.test(text);
  if (!hasStorageSignal) {
    issues.push("缺少数据存储设计");
  }

  const hasRuntimeSignal = /(pnpm|npm|yarn)\s+(dev|start|build)|docker\s+compose|环境变量|\.env|启动命令|联调|回归测试/i.test(text);
  if (!hasRuntimeSignal) {
    issues.push("缺少运行与联调说明");
  }

  const codePathSignals = Array.from(
    text.matchAll(/(?:^|\s)((?:apps?|src|packages|server|client|web|api)\/[a-zA-Z0-9_./-]+\.(?:ts|tsx|js|jsx|json|sql|prisma|yml|yaml|sh))/g)
  ).map((match) => String(match[1] || "").trim().toLowerCase());
  const codePathCount = new Set(codePathSignals.filter(Boolean)).size;
  if (codePathCount < 2) {
    issues.push("缺少代码实现证据");
  }

  const hasVerificationSignal = /(curl\s+https?:\/\/|\/health|http\s*200|响应\s*200|e2e|端到端|联调通过|回归通过|测试通过|验证结果)/i.test(text);
  if (!hasVerificationSignal) {
    issues.push("缺少联调/验证结果证据");
  }

  const hintText = `${input.projectName || ""} ${input.projectDescription || ""} ${(input.keywords || []).join(" ")}`;
  const isCrossBorderScenario = /跨境|爆品|跟品|tiktok|amazon|temu/i.test(hintText);
  if (isCrossBorderScenario) {
    if (!/(tiktok|amazon|temu|平台来源|采集源|数据源)/i.test(text)) {
      issues.push("缺少平台数据来源说明");
    }
    if (!/(定时任务|轮询|webhook|增量同步|实时刷新|刷新频率|流式)/i.test(text)) {
      issues.push("缺少数据更新机制说明");
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

function isDeliverableReadyForAcceptance(input: {
  status?: string;
  content?: string;
  project?: NonNullable<Awaited<ReturnType<typeof findProject>>>;
  stageType?: string;
  deliverableName?: string;
}) {
  const status = String(input.status || "").toLowerCase();
  const content = String(input.content || "");
  const length = content.trim().length;
  const stageType = String(input.stageType || "").toUpperCase();
  if (status === "draft" || !status) {
    return false;
  }
  if (length < 120) {
    return false;
  }
  if (content.includes("## 自动质检") && !/自动质检结论:\s*通过/.test(content)) {
    return false;
  }
  if (
    input.project
    && stageType === "DESIGN"
    && isVisualMockupDeliverableTitle(String(input.deliverableName || ""))
    && !hasRequirementAlignedVisualDesignPreview(input.project, content)
  ) {
    return false;
  }
  if (input.project && stageType === "DEV") {
    const template = resolveDeliverableTemplate(String(input.deliverableName || ""), "DEV");
    if (template.kind === "demo_prototype" || template.kind === "implementation_word") {
      const alignment = evaluateDevImplementationEvidenceForAcceptance({
        projectName: input.project.name,
        projectDescription: input.project.description,
        keywords: input.project.parsedIntent.keywords,
        content
      });
      if (!alignment.pass) {
        return false;
      }
    }
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
      content: matched.content,
      project,
      stageType: matched.stageType,
      deliverableName: matched.name
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
        content: acceptedSummary.content,
        project,
        stageType: acceptedSummary.stageType,
        deliverableName: acceptedSummary.name
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
    const officialSiteExcerpt = officialSite.url
      ? `访问地址：${officialSite.url}（静态交付物汇总页）`
      : officialSite.filePath
        ? `本地文件：${officialSite.filePath}`
        : "可直接打开在线演示页";
    artifacts.push({
      key: "official_site",
      category: "静态交付物汇总页",
      required: false,
      ready: true,
      source: "link",
      name: "官网演示页",
      stageType: "ACCEPT",
      status: "approved",
      updatedAt: new Date().toISOString(),
      url: officialSite.url,
      filePath: officialSite.filePath,
      excerpt: officialSiteExcerpt
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

const enableApiDocs = process.env.ENABLE_API_DOCS !== "false";
if (enableApiDocs) {
  const openApiSpec = buildOpenApiSpec({ host, port });
  app.get("/api/docs.json", (_req, res) => {
    res.json(openApiSpec);
  });
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec, {
    explorer: true,
    customSiteTitle: "OCC API Docs"
  }));
}

app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/auth/")) {
    next();
    return;
  }

  // GitLab Webhook 需支持外部系统直连，不依赖后台登录态。
  if (req.path === "/gitlab/webhook") {
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
      || req.path.startsWith("/gitlab")
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
app.use("/api/system", createSystemRouter({
  asyncRoute,
  safeAudit,
  sendEvent
}));
app.use("/api/gitlab", createGitLabRouter());
app.use("/api", createNotificationsRouter({
  asyncRoute,
  safeAudit
}));


app.use(createProjectsRouter({
  asyncRoute,
  safeAudit,
  sendEvent,
  splitScript,
  projectAutomationState,
  restartProjectAutomationTicker,
  runProjectAutomationTick,
  kickProjectAutomationTick,
  projectAdvanceLocks,
  projectAdvanceJobs,
  projectAdvanceJobErrors,
  ensureManualAdvanceJob,
  buildProjectRequiredActions,
  formatRequiredActionsMessage,
  buildProjectAcceptanceReport,
  renderAcceptanceReportMarkdown,
  getLatestFinalArtifactsJob,
  startFinalArtifactsGenerationJob,
  buildProjectFinalArtifactsReport,
  attachFinalArtifactsGeneration,
  toFinalArtifactsJobProgress,
  finalArtifactsJobsById
}));

app.use("/api/openclaw", createOpenClawRouter({
  asyncRoute,
  safeAudit
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

function isDirectExecution() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  try {
    return path.resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
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

if (isDirectExecution()) {
  void start();
}

export { app, start };
