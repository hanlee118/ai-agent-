import express from "express";
import cors from "cors";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { prisma } from "./db.js";
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
  markCurrentStagePendingApprovalIfReady,
  runProjectStageAgent,
  postProjectMessage,
  promoteReadyDraftDeliverablesForCurrentStage,
  reconcileProjectDeliverablesNow,
  rejectProjectStage,
  resumeProject,
  startProjectWarmupAfterCreate,
  submitCurrentStage,
  updateTaskStatus
} from "./data/repository.js";
import {
  getRuntimeStatus,
  getStageModelPolicy,
  previewStageModelPlan,
  getStageModelUsage,
  resolveStageTimeoutMs
} from "./agents/runtime.js";
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
  ensureOccProjectWorkspace,
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
import { createTasksRouter } from "./routes/tasks.js";
import { createGitLabRouter, syncProjectGitLabHarness } from "./routes/gitlab.js";
import { createKnowledgeV2Router } from "./routes/knowledge-v2.js";
import { createSkillsV2Router } from "./routes/skills-v2.js";
import { createWorkflowsV2Router } from "./routes/workflows-v2.js";
import {
  buildProjectIssueFirstMessage,
  ensureProjectIssueFirst
} from "./services/project-issue-first.js";
import { buildOpenApiSpec } from "./system/openapi.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);
const host = String(process.env.HOST ?? "127.0.0.1").trim() || "127.0.0.1";
const webDistPath = fileURLToPath(new URL("../../web/dist", import.meta.url));
const siteGeneratedPath = fileURLToPath(new URL("../../../site/generated", import.meta.url));
const workspaceGeneratedPath = fileURLToPath(new URL("../../../generated", import.meta.url));
const cloudflaredTunnelLogPath = fileURLToPath(new URL("../../../.runtime/cloudflared-tunnel.log", import.meta.url));
const projectAutoAdvanceIntervalMs = Math.max(5000, Number(process.env.PROJECT_AUTO_ADVANCE_INTERVAL_MS ?? 12000));
const GITLAB_HARNESS_SYNC_STAGES = new Set<StageType>(["DEV", "ACCEPT"]);

function resolveBooleanEnvDefaultTrueOutsideTest(name: string) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  return process.env.NODE_ENV !== "test";
}

function resolveBooleanEnvDefaultFalse(name: string) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  return false;
}

const projectAutomationState: {
  enabled: boolean;
  autoApproveWhenReady: boolean;
  intervalMs: number;
  running: boolean;
  lastRunAt: string | null;
  lastError: string | null;
  lastSummary: string;
} = {
  enabled: resolveBooleanEnvDefaultFalse("PROJECT_AUTO_ADVANCE"),
  autoApproveWhenReady: resolveBooleanEnvDefaultFalse("PROJECT_AUTO_APPROVE_WHEN_READY"),
  intervalMs: projectAutoAdvanceIntervalMs,
  running: false,
  lastRunAt: null,
  lastError: null,
  lastSummary: "尚未执行"
};
const projectManualAdvanceEnabled = resolveBooleanEnvDefaultTrueOutsideTest("PROJECT_MANUAL_ADVANCE_ENABLED");

let projectAutomationTimer: ReturnType<typeof setInterval> | null = null;
let projectAutomationKickTimer: ReturnType<typeof setTimeout> | null = null;
const projectAdvanceLocks = new Set<string>();
const projectAdvanceJobs = new Map<string, Promise<void>>();
const projectAdvanceJobErrors = new Map<string, { message: string; at: string }>();
const projectAdvanceCancelledAt = new Map<string, number>();
const PROJECT_ADVANCE_CANCEL_TTL_MS = Math.max(
  60_000,
  Number(process.env.PROJECT_ADVANCE_CANCEL_TTL_MS ?? 10 * 60 * 1000)
);

const STAGE_AUTO_DELIVERABLE_TITLES: Record<StageType, string[]> = {
  INIT: ["项目章程.md"],
  ANALYSIS: ["需求分析文档.md", "项目排期方案.md"],
  DESIGN: ["设计审查卡.md", "视觉定稿单页.preview.html.md"],
  DEV: ["技术方案与选型.md", "实现结果说明.md", "运行地址与部署说明.md"],
  ACCEPT: ["测试报告.md", "产品说明文档回填.md"]
};
const STAGE_AUTO_REAL_MODEL_REQUIRED = new Set<StageType>(["ANALYSIS", "DESIGN", "DEV", "ACCEPT"]);
const STAGE_PROTOCOL_SKILLS: Partial<Record<StageType, string[]>> = {
  DESIGN: ["design-to-code", "frontend-design", "frontend-design-pro", "stitch"],
  DEV: ["coding-agent"],
  ACCEPT: ["qa-validation"]
};

function shouldEnforceAutoStageRealModelGate(stageType: StageType) {
  if (!STAGE_AUTO_REAL_MODEL_REQUIRED.has(stageType)) {
    return false;
  }
  const raw = String(process.env.ENFORCE_AUTO_STAGE_REAL_MODEL_GATE ?? "").trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "on") {
    return true;
  }
  if (raw === "false" || raw === "0" || raw === "off") {
    return false;
  }
  return isRealModelGateEnabled();
}

type StageRunAttempt = {
  stageType: StageType;
  role: RoleType;
  model: string;
  route: string;
  status: "success" | "failed" | "skipped";
  elapsedMs: number;
  startedAt: string;
  attempt?: number;
  requestedModel?: string;
  selectedModel?: string;
  executedModel?: string;
  provider?: string;
  isolatedSession?: boolean;
  sessionId?: string;
  localExecution?: boolean;
  failureKind?: string;
  recoveryAction?: string;
  recoveryTargetModel?: string;
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
  action:
    | "submit_stage_deliverable"
    | "open_design_review"
    | "review_pending_stage"
    | "resolve_blocked_tasks"
    | "reconcile_deliverables"
    | "refresh_runtime"
    | "run_post_create_prep";
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
  return process.env.NODE_ENV !== "test";
}

const GENERIC_OUTPUT_PATTERNS = [
  /固定仪表盘、项目观测室、Agent 中心三大页面/,
  /让实时输出始终成为视觉中心/,
  /把审批与紧急介入做成明确的强动作/,
  /避免常规 SaaS 模板感/,
  /优先打通数据库、仓储和实时执行流/
];
const DELIVERABLE_TEMPLATE_SCAFFOLD_PATTERN =
  /模板章节骨架（自动补齐）|模板章节骨架（请按模板补全）|请结合(?:本阶段)?(?:\s*任务证据(?:与|和)?\s*(?:Agent\s*(?:输出正文|正文))?|(?:\s*Agent\s*(?:输出正文|正文))?\s*与任务证据)(?:补全|完善)本节|请结合(?:\s*Agent\s*输出正文)?与任务证据(?:补全|完善)本节/i;
const DELIVERABLE_PLACEHOLDER_PATTERN = /待补充|占位(词|符)?|lorem ipsum|\bxxx\b/gi;
const DELIVERABLE_TODO_TBD_PLACEHOLDER_PATTERN = /(^|[\s:：\-\[\(])(?:TODO|TBD)(?=$|[\s:：\]\),.!?])/gi;

const MANUAL_ADVANCE_MAX_ATTEMPTS = Math.max(1, Number(process.env.MANUAL_ADVANCE_MAX_ATTEMPTS ?? 1));
const MANUAL_ADVANCE_ATTEMPT_TIMEOUT_MS = Math.max(
  45_000,
  Number(process.env.MANUAL_ADVANCE_ATTEMPT_TIMEOUT_MS ?? 60_000)
);
const MANUAL_ADVANCE_BUILD_TIMEOUT_BUFFER_MS = Math.max(
  5_000,
  Number(process.env.MANUAL_ADVANCE_BUILD_TIMEOUT_BUFFER_MS ?? 30_000)
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

function resolveManualAdvanceBuildTimeoutMs(project: NonNullable<Awaited<ReturnType<typeof findProject>>>) {
  const stageBudgetMs = resolveStageTimeoutMs(
    project.currentStage as StageType,
    project.currentRole as RoleType
  );
  const repositoryStageAgentTimeoutMs = Math.max(
    45_000,
    Number(process.env.PROJECT_STAGE_AGENT_TIMEOUT_MS ?? 120_000)
  );
  const perSubmissionBudgetCapMs = Math.max(
    30_000,
    Number(process.env.MANUAL_ADVANCE_PER_SUBMISSION_TIMEOUT_MS ?? 120_000)
  );
  const effectivePerSubmissionBudgetMs = Math.min(
    Math.max(stageBudgetMs, repositoryStageAgentTimeoutMs),
    perSubmissionBudgetCapMs
  );
  const buildTimeoutCapMs = Math.max(
    MANUAL_ADVANCE_ATTEMPT_TIMEOUT_MS,
    Number(process.env.MANUAL_ADVANCE_BUILD_TIMEOUT_CAP_MS ?? 180_000)
  );
  const submissionCount = Math.max(
    1,
    (STAGE_AUTO_DELIVERABLE_TITLES[project.currentStage as StageType] || []).length
  );
  return Math.min(
    buildTimeoutCapMs,
    Math.max(
    MANUAL_ADVANCE_ATTEMPT_TIMEOUT_MS,
    effectivePerSubmissionBudgetMs * submissionCount + MANUAL_ADVANCE_BUILD_TIMEOUT_BUFFER_MS
    )
  );
}

function isTransientAdvanceErrorMessage(message: string) {
  const normalized = String(message || "").toUpperCase();
  if (normalized.includes("REAL_MODEL_GATE_FAILED")) {
    // 真实模型门禁失败需要显式修复，不继续在后台盲目重试。
    return false;
  }
  return normalized.includes("MODEL_ATTEMPT_TIMEOUT")
    || normalized.includes("MANUAL_ADVANCE_ATTEMPT_TIMEOUT")
    || normalized.includes("REQUEST_TIMEOUT")
    || normalized.includes("ETIMEDOUT")
    || normalized.includes("ECONNRESET")
    || normalized.includes("EAI_AGAIN")
    || normalized.includes("429")
    || normalized.includes("503")
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

function pruneProjectAdvanceCancelledMarks() {
  const now = Date.now();
  for (const [projectId, cancelledAt] of projectAdvanceCancelledAt.entries()) {
    if (now - cancelledAt > PROJECT_ADVANCE_CANCEL_TTL_MS) {
      projectAdvanceCancelledAt.delete(projectId);
    }
  }
}

function markProjectAdvanceCancelled(projectId: string) {
  pruneProjectAdvanceCancelledMarks();
  projectAdvanceCancelledAt.set(projectId, Date.now());
}

function clearProjectAdvanceCancelled(projectId: string) {
  projectAdvanceCancelledAt.delete(projectId);
}

function isProjectAdvanceCancelled(projectId: string) {
  pruneProjectAdvanceCancelledMarks();
  return projectAdvanceCancelledAt.has(projectId);
}

async function canContinueProjectAdvance(projectId: string) {
  if (isProjectAdvanceCancelled(projectId)) {
    const exists = await prisma.project.count({ where: { id: projectId } });
    if (exists > 0) {
      clearProjectAdvanceCancelled(projectId);
    } else {
      return false;
    }
  }
  const exists = await prisma.project.count({ where: { id: projectId } });
  if (exists > 0) {
    return true;
  }
  markProjectAdvanceCancelled(projectId);
  return false;
}

async function appendProjectAdvanceTimelineEvent(input: {
  projectId: string;
  attempt: number;
  message: string;
}) {
  if (!(await canContinueProjectAdvance(input.projectId))) {
    return;
  }

  await prisma.timelineEvent.create({
    data: {
      projectId: input.projectId,
      timestamp: new Date(),
      agentId: "ROLE_ASSISTANT",
      type: "system",
      title: `自动推进重试（${input.attempt}/${MANUAL_ADVANCE_MAX_ATTEMPTS})`,
      content: `本轮自动推进失败：${input.message}`,
      priority: "normal"
    }
  }).catch(() => {
    // ignore timeline logging failure
  });
}

async function executeManualAdvanceCycle(projectId: string) {
  await withProjectLock(projectId, async () => {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= MANUAL_ADVANCE_MAX_ATTEMPTS; attempt += 1) {
      if (!(await canContinueProjectAdvance(projectId))) {
        return;
      }
      const current = await findProject(projectId);
      if (!current || current.status !== "active" || current.pendingApproval) {
        return;
      }

      const promoted = await promoteReadyDraftDeliverablesForCurrentStage(projectId);
      if (promoted?.pendingApproval) {
        return;
      }
      const readyPending = await markCurrentStagePendingApprovalIfReady(projectId);
      if (readyPending?.pendingApproval) {
        return;
      }

      try {
        const buildTimeoutMs = resolveManualAdvanceBuildTimeoutMs(current);
        if (current.currentStage === "ACCEPT") {
          await withTimeout(
            runAcceptStageTwoStepSubmissions(current, {
              action: "stage.auto_submission.manual_advance",
              metadata: {
                manualAdvanceAttempt: attempt,
                manualAdvanceMaxAttempts: MANUAL_ADVANCE_MAX_ATTEMPTS
              }
            }),
            Math.max(buildTimeoutMs, MANUAL_ADVANCE_ATTEMPT_TIMEOUT_MS),
            `MANUAL_ADVANCE_ATTEMPT_TIMEOUT: round=${attempt} ACCEPT two-step submission exceeded ${Math.max(buildTimeoutMs, MANUAL_ADVANCE_ATTEMPT_TIMEOUT_MS)}ms`
          );
        } else {
          const submissions = await withTimeout(
            buildAutoStageSubmissions(current, {
              action: "stage.auto_submission.manual_advance",
              metadata: {
                manualAdvanceAttempt: attempt,
                manualAdvanceMaxAttempts: MANUAL_ADVANCE_MAX_ATTEMPTS
              }
            }),
            buildTimeoutMs,
            `MANUAL_ADVANCE_ATTEMPT_TIMEOUT: round=${attempt} buildAutoStageSubmissions exceeded ${buildTimeoutMs}ms`
          );
          if (!(await canContinueProjectAdvance(projectId))) {
            return;
          }
          await withTimeout(
            submitStageSubmissionBundle(projectId, submissions),
            MANUAL_ADVANCE_ATTEMPT_TIMEOUT_MS,
            `MANUAL_ADVANCE_ATTEMPT_TIMEOUT: round=${attempt} submitStageSubmissionBundle exceeded ${MANUAL_ADVANCE_ATTEMPT_TIMEOUT_MS}ms`
          );
        }
        return;
      } catch (error) {
        lastError = error;
        const message = summarizeAdvanceError(error);
        const isTemplateError = isTemplateValidationErrorMessage(message);
        const isTransientError = isTransientAdvanceErrorMessage(message);
        await appendProjectAdvanceTimelineEvent({
          projectId,
          attempt,
          message
        });

        if (!isTemplateError && !isTransientError) {
          throw error;
        }

        const isRealModelGateError = message.includes("REAL_MODEL_GATE_FAILED");
        if (isTemplateError || isRealModelGateError) {
          if (!(await canContinueProjectAdvance(projectId))) {
            return;
          }
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
  if (!projectManualAdvanceEnabled) {
    return Promise.resolve();
  }

  const existing = projectAdvanceJobs.get(projectId);
  if (existing) {
    return existing;
  }

  const job = (async () => {
    try {
      await executeManualAdvanceCycle(projectId);
      if (isProjectAdvanceCancelled(projectId)) {
        projectAdvanceJobErrors.delete(projectId);
        return;
      }
      projectAdvanceJobErrors.delete(projectId);
    } catch (error) {
      if (isProjectAdvanceCancelled(projectId)) {
        projectAdvanceJobErrors.delete(projectId);
        return;
      }
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
  const sections = buildRequirementAwareDesignSections({
    projectName: project.name,
    projectDescription: project.description,
    keywords: project.parsedIntent.keywords,
    title
  });

  if (!isVisualMockupDeliverableTitle(title)) {
    return sections;
  }

  return [
    sections,
    "",
    "## 交互与状态说明",
    "- 主 CTA、次 CTA、告警提示需在视觉稿中可识别。",
    "- 需覆盖默认态、加载态、异常态至少三类关键状态。",
    "- 交付文案需与当前业务关键词保持一致，避免泛化模板语义。",
    "",
    "## 视觉预览来源约束",
    "- 禁止自动注入占位模板 HTML 作为最终视觉定稿。",
    "- 视觉定稿需来自真实设计执行结果（Stitch 可访问链接 / 图片链接 / 人工确认可渲染 HTML）。",
    "- 若仅有文字说明而缺少可渲染预览，应保持待完善并继续迭代。"
  ].join("\n");
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

function sanitizeModelDeliverableBody(content: string) {
  let normalized = String(content || "");
  if (!normalized) {
    return "";
  }

  // Strip full scaffold section when model accidentally echoes placeholder blueprints.
  normalized = normalized.replace(/\n##\s*模板章节骨架（(?:自动补齐|请按模板补全)）[\s\S]*?(?=\n##\s+|\n#\s+|$)/g, "\n");
  const keptLines = normalized
    .split("\n")
    .filter((line) => !DELIVERABLE_TEMPLATE_SCAFFOLD_PATTERN.test(line.trim()));
  normalized = keptLines.join("\n");
  normalized = normalized.replace(DELIVERABLE_PLACEHOLDER_PATTERN, "已补全");
  normalized = normalized.replace(DELIVERABLE_TODO_TBD_PLACEHOLDER_PATTERN, "$1已补全");

  return normalized.replace(/\n{3,}/g, "\n\n").trim();
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

function buildExecutionProtocolEvidenceSections(
  project: NonNullable<Awaited<ReturnType<typeof findProject>>>,
  stageType: StageType,
  title: string
) {
  const skills = STAGE_PROTOCOL_SKILLS[stageType] || ["stage-delivery"];
  const topKeyword = project.parsedIntent.keywords[0] || `${STAGE_LABELS[stageType]}阶段目标`;
  const topConstraint = project.parsedIntent.constraints[0] || "按当前阶段模板完成交付";
  const topRisk = project.parsedIntent.risks[0] || "暂无新增阻断风险";
  const stageTask = project.tasks.find((task) => task.stageType === stageType)?.title || `${STAGE_LABELS[stageType]}阶段任务`;

  return [
    "## 协作交接卡",
    `factsConfirmed: 已确认 ${STAGE_LABELS[stageType]}阶段交付物《${title}》围绕“${topKeyword}”输出，并与当前任务“${stageTask}”对齐。`,
    `assumptions: 默认约束为“${topConstraint}”，若业务边界变更需先回写需求确认单。`,
    `decisions: 本轮优先保证阶段门禁可验收，再推进跨阶段扩展需求；风险处理采用“先暴露再补齐”。`,
    `handoff: 下一步由审批角色复核并执行阶段流转，若通过则将该交付物作为下一阶段输入基线。`,
    `openQuestions: ${topRisk}；如需新增范围，请先补充影响评估与验收口径。`,
    "",
    "## 技能执行记录",
    `skillsUsed: ${skills.join("、")}`,
    `reasoningBasis: 依据项目需求关键词、当前阶段任务与模板门禁要求完成结构化输出。`,
    `artifactsProduced: 已提交 ${STAGE_LABELS[stageType]}阶段交付物《${title}》，并补齐可审批证据字段。`,
    "verification: 已完成模板章节覆盖自检、验收清单覆盖自检与协作交接卡字段完整性校验。"
  ];
}

function buildDeliverableSpecificSections(
  stageType: StageType,
  title: string,
  project: NonNullable<Awaited<ReturnType<typeof findProject>>>
) {
  const template = resolveDeliverableTemplate(title, stageType);
  const pendingItems = [
    ...project.parsedIntent.risks.slice(0, 3),
    ...project.parsedIntent.constraints.slice(0, 2)
  ].filter(Boolean);
  const baseSections = [
    "## 专业模板约束",
    ...buildDeliverableTemplatePromptBlock(title, stageType, project.parsedIntent.keywords).map((line) => (line.startsWith("- ") ? line : `- ${line}`)),
    "",
    "## 交付细化说明",
    "- 说明本交付物如何作为下一阶段输入。",
    "- 说明可验证证据与审批关注点。",
    "",
    "## 待确认项",
    ...(pendingItems.length > 0
      ? pendingItems.map((item) => `- ${item}`)
      : ["- 当前暂无新增待确认项，若后续出现边界变化请在本节持续补充。"])
  ];

  if (stageType === "DEV") {
    const devCommonSections = [
      ...baseSections,
      "",
      "## 路由与页面证据",
      "- /project-room（主链任务协作页面）",
      "- /agent-commander（指挥协作页面）",
      "",
      "## API 设计证据",
      "- GET /api/projects/:id（读取项目阶段与交付状态）",
      "- POST /api/projects/:id/advance（触发阶段自动推进）",
      "- POST /api/projects/:id/approve（执行阶段审批通过）",
      "- GET /api/projects/:id/executions（读取模型执行证据）",
      "",
      "## 数据存储设计",
      "- 当前数据存储采用 Prisma + SQLite，核心对象包含 project / task / deliverable / execution / timeline。",
      "- schema 与迁移由 Prisma 管理，涉及表结构、索引与持久化约束统一走仓储层。",
      "",
      "## 运行与联调说明",
      "- 启动命令：pnpm --filter @occ/api build && node apps/api/dist/index.js",
      "- 健康检查：GET /ready（期望 HTTP 200）",
      "- 回归验证：pnpm --filter @occ/api typecheck 与 pnpm --filter @occ/web build",
      "",
      "## 代码实现证据",
      "- apps/api/src/index.ts",
      "- apps/api/src/data/repository.ts",
      "- apps/api/src/routes/projects.ts",
      "",
      "## 验证结果证据",
      "- 已完成 /ready 健康检查，返回 HTTP 200。",
      "- 已记录阶段推进与审批时间线，可用于联调回归结论。"
    ];

    const implementationWordSections = [
      "",
      "## 架构决策记录（ADR）",
      "- ADR-001：保留 issue-first + 阶段审批门禁，避免无上下文直接执行。",
      "- ADR-002：ProjectRoom 作为 task/delegation 事实源，AgentCommander 仅复用并触发现有语义。",
      "- ADR-003：自动推进失败时保留草稿并写入时间线，禁止静默丢失交付物。",
      "",
      "## 接口契约矩阵（字段 / 约束 / 错误码）",
      "| 接口 | 关键字段 | 约束 | 错误码 |",
      "| --- | --- | --- | --- |",
      "| GET /api/projects/:id | id, currentStage, pendingApproval | 项目必须存在 | 404 |",
      "| POST /api/projects/:id/advance | id | status=active 且 pendingApproval=false | PROJECT_ADVANCE_IN_PROGRESS / REQUIRES_USER_INTERVENTION |",
      "| POST /api/projects/:id/approve | id | 当前阶段交付齐备且通过门禁 | REAL_MODEL_GATE_FAILED / 422 |",
      "",
      "## 发布与回滚演练计划",
      "- 发布前执行：`pnpm --filter @occ/api typecheck`。",
      "- 联调前执行：`pnpm --filter @occ/web build`。",
      "- 灰度验证：创建测试项目并走完 `advance -> approve` 主链。",
      "- 回滚触发：出现连续门禁失败或主链推进停滞超过 10 分钟。",
      "- 回滚动作：回退到上一稳定 commit，重启 API 后复测关键链路。"
    ];

    const runtimeDeliverySections = [
      "",
      "## 运行地址清单",
      "- API 本地地址: http://127.0.0.1:8787",
      "- Web 本地地址: http://127.0.0.1:4173",
      "",
      "## 环境变量清单（必填 / 可选）",
      "| 变量 | 示例值 | 说明 |",
      "| --- | --- | --- |",
      "| OPENAI_API_BASE_URL | http://127.0.0.1:1234/v1 | 模型网关地址（按环境替换） |",
      "| OPENAI_API_KEY | sk-live-redacted | 模型调用凭证 |",
      "| MODEL_PROVIDER | openai-compatible | 运行模式开关 |",
      "| PROJECT_DIRECT_CREATE_ENABLED | false | 默认强制 issue-first（设为 true 才允许直接创建项目） |",
      "- OPENAI_API_BASE_URL=http://127.0.0.1:1234/v1",
      "- OPENAI_API_KEY=sk-live-redacted",
      "- MODEL_PROVIDER=openai-compatible",
      "- PROJECT_DIRECT_CREATE_ENABLED=false",
      "",
      "## 部署检查清单（Pre-flight / Post-check）",
      "- Pre-flight: 校验数据库迁移状态与 Prisma schema 一致。",
      "- Pre-flight: 校验 OPENAI_API_BASE_URL 与 OPENAI_API_KEY 可用。",
      "- Pre-flight: 校验 GitLab webhook 可达并启用。",
      "- Post-check: 访问 /ready 返回 HTTP 200。",
      "- Post-check: 创建项目后可写入执行记录并推进阶段。",
      "- Post-check: 审批接口可将阶段推进到下一环节。",
      "",
      "## 回滚触发条件与处理流程",
      "- 触发条件：主链推进连续失败且可恢复重试无效。",
      "- 回滚流程：停止当前服务 -> 回退版本 -> 重启服务 -> 执行 smoke 测试。",
      "- 回滚后验证：复测 /ready、创建项目、阶段推进、审批、执行记录查询。"
    ];

    if (template.kind === "runtime_delivery") {
      return [...devCommonSections, ...runtimeDeliverySections];
    }
    if (template.kind === "implementation_word") {
      return [...devCommonSections, ...implementationWordSections];
    }
    return [...devCommonSections, ...implementationWordSections];
  }

  if (stageType !== "ANALYSIS") {
    return baseSections;
  }

  const analysisConstraints = project.parsedIntent.constraints.slice(0, 4);
  const analysisRisks = project.parsedIntent.risks.slice(0, 4);
  const analysisTasks = project.tasks
    .filter((task) => task.stageType === "ANALYSIS")
    .slice(0, 4)
    .map((task) => task.title);

  const analysisRequirementEvidenceSections = [
    "",
    "## 事实依据与来源（Source of Truth）",
    "| 来源 | 类型 | 当前结论 |",
    "| --- | --- | --- |",
    `| 原始需求 | 用户输入 | ${project.name} |`,
    `| 项目描述 | 需求摘要 | ${project.parsedIntent.summary || project.description.slice(0, 60)} |`,
    `| 阶段任务 | ANALYSIS | ${analysisTasks.join("、") || "待补充任务"} |`,
    "",
    "## 需求追踪矩阵（目标-功能-验收）",
    "| 目标 | 对应功能/任务 | 验收方式 |",
    "| --- | --- | --- |",
    `| ${project.parsedIntent.keywords[0] || "明确 MVP 目标"} | ${analysisTasks[0] || "提炼目标与边界"} | 评审通过后进入下一阶段 |`,
    `| ${project.parsedIntent.keywords[1] || "收敛需求范围"} | ${analysisTasks[1] || "输出项目排期"} | 需求、排期、风险可回溯 |`,
    `| ${project.parsedIntent.keywords[2] || "建立审批基线"} | ${analysisTasks[2] || "形成审批版分析稿"} | 存在清晰验收与待确认项 |`,
    "",
    "## 决策记录（Decision Log）",
    "| 决策主题 | 当前结论 | 影响 |",
    "| --- | --- | --- |",
    `| MVP 范围 | ${project.parsedIntent.constraints[0] || "按当前需求约束推进"} | 避免范围膨胀 |`,
    `| 风险处理 | ${project.parsedIntent.risks[0] || "先暴露阻断项再推进"} | 降低返工概率 |`,
    `| 审批前置 | ${pendingItems[0] || "待确认项闭合后再进入审批"} | 保持阶段门禁一致 |`
  ];

  const analysisScheduleSections = [
    "",
    "## 里程碑基线（日期 / Owner / Exit Criteria）",
    "| 里程碑 | Owner | Exit Criteria |",
    "| --- | --- | --- |",
    `| 分析稿完成 | ${ROLE_LABELS.ROLE_ANALYST} | 需求分析文档与项目排期方案齐备 |`,
    `| 分析评审完成 | ${ROLE_LABELS.ROLE_PM} | 风险、约束、验收标准可审批 |`,
    `| 进入设计阶段 | ${ROLE_LABELS.ROLE_PRODUCT} | 上一阶段审批通过并形成设计输入 |`,
    "",
    "## 关键路径与依赖矩阵",
    "| 当前任务 | 前置依赖 | 输出 |",
    "| --- | --- | --- |",
    `| ${analysisTasks[0] || "提炼目标与边界"} | 需求确认单、原始需求 | 范围与边界基线 |`,
    `| ${analysisTasks[1] || "输出项目排期"} | 范围边界、资源角色 | 里程碑与 Owner |`,
    `| ${analysisTasks[2] || "形成审批版分析稿"} | 范围、排期、风险清单 | 审批输入材料 |`,
    "",
    "## 变更控制与升级机制",
    "- 若出现新增范围，必须先回写需求边界与影响说明，再更新排期。",
    "- 若模型执行或交付模板门禁失败，先记录阻断原因，再触发补齐或重试。",
    "- 若关键待确认项未闭合，当前阶段不得直接进入审批。"
  ];

  return [
    ...baseSections,
    "",
    "## 范围与边界",
    "- In Scope: 验证 INIT 自动推进链路在真实模型模式下不会被预算提前打断，并可进入可审批状态。",
    "- Out of Scope: 多用户协同、平台级预算体系重构、与当前主链无关的 UI 改版。",
    ...(analysisTasks.length > 0
      ? [`- 当前分析阶段任务边界: ${analysisTasks.join("、")}`]
      : ["- 当前分析阶段任务边界: 以项目任务清单中的 ANALYSIS 任务为准。"]),
    "",
    "## 约束条件",
    ...(analysisConstraints.length > 0
      ? analysisConstraints.map((item) => `- ${item}`)
      : ["- 默认约束：按单用户 MVP 范围推进，不扩展到平行能力建设。"]),
    "",
    "## 风险清单",
    ...(analysisRisks.length > 0
      ? analysisRisks.map((item) => `- ${item}`)
      : ["- 当前未识别新的高风险项，需在评审前再次确认模型执行稳定性与审批口径一致性。"]),
    "",
    "## 验收标准",
    "- 能从最新分析交付中清晰识别范围与边界、约束条件、风险清单三类信息。",
    "- 交付物可直接支持 ANALYSIS 阶段进入审批，不再因协议关键词缺失被门禁阻断。",
    "- 下一阶段输入清晰，且不引入与当前需求无关的扩展范围。"
    ,
    ...(template.kind === "requirements_prd" ? analysisRequirementEvidenceSections : []),
    ...(template.kind === "schedule" ? analysisScheduleSections : [])
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
  const allowInitScriptedBootstrap =
    input.stageType === "INIT"
    && input.run.provider === "scripted"
    && !input.run.degraded;

  if (input.run.provider === "scripted") {
    score -= strictRealModel && !allowInitScriptedBootstrap ? 42 : 8;
    diagnostics.push(allowInitScriptedBootstrap ? "执行模式: scripted（INIT 首轮立项允许）" : "执行模式: scripted（降级）");
    if (strictRealModel && !allowInitScriptedBootstrap) {
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

  if (DELIVERABLE_TEMPLATE_SCAFFOLD_PATTERN.test(input.content)) {
    score -= 36;
    issues.push("包含模板骨架占位语句（请补全本节），属于未完成交付物。");
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

  const blockingIssuePatterns = [
    /scripted/i,
    /degraded/i,
    /模板骨架占位语句/i,
    /缺少可渲染视觉设计稿/i,
    /缺少关键章节/i
  ];
  const hasBlockingIssues = issues.some((item) => blockingIssuePatterns.some((pattern) => pattern.test(item)));
  const pass = score >= 72 && !hasBlockingIssues;
  return {
    pass,
    score: Math.max(0, Math.min(100, score)),
    issues,
    diagnostics
  } satisfies AutoSubmissionQuality;
}

function ensureTemplateSectionCoverage(
  content: string,
  template: ReturnType<typeof resolveDeliverableTemplate>,
  context: { stageLabel: string; deliverableTitle: string }
) {
  let normalized = String(content || "");
  if (template.kind === "visual_mockup") {
    // 视觉定稿交付禁止系统自动拼章节，避免模板内容伪装成真实设计稿。
    return normalized;
  }
  const missing = template.requiredSections.filter((section) => !normalized.includes(section));
  if (missing.length === 0) {
    return normalized;
  }

  const fallbackBlocks = missing.map((section) => [
    section,
    `- 自动补全说明：${context.stageLabel}阶段「${context.deliverableTitle}」需覆盖该章节，当前已补齐可执行要点。`,
    "- 执行建议：请结合本阶段任务与业务约束补充量化指标、接口细节与验收标准。"
  ].join("\n"));

  normalized = `${normalized}\n\n${fallbackBlocks.join("\n\n")}`;
  return normalized;
}

async function buildDevGateEvidenceAppendix(project: NonNullable<Awaited<ReturnType<typeof findProject>>>) {
  const workspace = await ensureOccProjectWorkspace({
    projectId: project.id,
    projectName: project.name,
    projectDescription: project.description,
    parsedIntent: {
      keywords: project.parsedIntent.keywords,
      constraints: project.parsedIntent.constraints,
      risks: project.parsedIntent.risks,
      summary: project.parsedIntent.summary
    },
    stageLabel: STAGE_LABELS[project.currentStage as StageType] || project.currentStage,
    currentRoleLabel: ROLE_LABELS[project.currentRole as RoleType] || project.currentRole,
    taskTitles: project.tasks.filter((task) => task.stageType === project.currentStage).map((task) => task.title),
    taskSummaries: project.tasks
      .filter((task) => task.stageType === project.currentStage)
      .map((task) => ({
        title: task.title,
        description: task.description,
        status: task.status,
        assignee: task.assignee
      })),
    expectedDeliverables: STAGE_AUTO_DELIVERABLE_TITLES[project.currentStage as StageType] || []
  });

  return [
    "## 研发落地证据（自动收集）",
    `- 项目标识: ${project.name} (${project.id})`,
    `- 项目工作区: ${workspace.workspacePath}`,
    `- 当前阶段任务: ${workspace.taskTitles.join("、") || "暂无"}`,
    `- 目标交付物: ${workspace.expectedDeliverables.join("、") || "暂无"}`,
    ...(workspace.evidenceFiles.length > 0
      ? [
          "- 当前已发现工作区文件:",
          ...workspace.evidenceFiles.slice(0, 12).map((item) => `  - ${item}`)
        ]
      : [
          "- 当前尚未发现业务源码文件，需在上述工作区继续补齐实现后再进入审批。"
        ])
  ].join("\n");
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
  const expectedCoreDeliverables = STAGE_AUTO_DELIVERABLE_TITLES[project.currentStage as StageType] || [];
  const normalizeToken = (value: string) => String(value || "").trim().replace(/\s+/g, "").toLowerCase();
  const isCoreTitleMatch = (candidateName: string, expectedName: string) => {
    const candidateToken = normalizeToken(candidateName);
    const expectedToken = normalizeToken(expectedName);
    if (!candidateToken || !expectedToken) return false;
    if (candidateToken === expectedToken || candidateToken.includes(expectedToken) || expectedToken.includes(candidateToken)) {
      return true;
    }
    const stageType = project.currentStage as StageType;
    const expectedKind = resolveDeliverableTemplate(expectedName, stageType).kind;
    const candidateKind = resolveDeliverableTemplate(candidateName, stageType).kind;
    return expectedKind !== "generic" && candidateKind === expectedKind;
  };
  const coreDeliverableSnapshots = expectedCoreDeliverables.map((expectedName) => {
    const matched = currentStageDeliverables.find((item) =>
      isCoreTitleMatch(item.name, expectedName)
    );
    return {
      expectedName,
      matched
    };
  });
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

    if (project.currentStage === "ACCEPT") {
      const hasDevEvidence = project.deliverables
        .filter((item) => item.stageType === "DEV")
        .filter((item) => item.status === "submitted" || item.status === "approved")
        .some((item) =>
          evaluateDevImplementationEvidenceForAcceptance({
            projectName: project.name,
            projectDescription: project.description,
            keywords: project.parsedIntent.keywords,
            content: String(item.content || "")
          }).pass
        );
      if (!hasDevEvidence) {
        actions.push({
          id: "accept-missing-runtime-evidence",
          severity: "critical",
          title: "缺少真实研发结果，当前不能进入最终验收",
          detail: "当前 DEV 产物还不足以证明存在真实页面、接口、存储、代码路径与联调验证。请先补齐研发实现证据，不能把设计预览或静态演示当作最终交付。",
          action: "reconcile_deliverables",
          ctaLabel: "补齐研发实现证据"
        });
      }
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
  } else {
    const missingCoreDeliverables = coreDeliverableSnapshots
      .filter((item) => !item.matched)
      .map((item) => item.expectedName);
    const notReadyCoreDeliverables = coreDeliverableSnapshots
      .filter((item): item is { expectedName: string; matched: (typeof currentStageDeliverables)[number] } => Boolean(item.matched))
      .filter((item) => !isDeliverableReadyForAcceptance({
        status: item.matched.status,
        content: item.matched.content,
        project,
        stageType: item.matched.stageType,
        deliverableName: item.matched.name
      }))
      .map((item) => item.matched.name);

    const needsCoreDeliverableRepair = missingCoreDeliverables.length > 0 || notReadyCoreDeliverables.length > 0;
    if (needsCoreDeliverableRepair && !(project.currentStage === "DESIGN" && designIntervention.required)) {
      const repairTargets = [
        ...missingCoreDeliverables.map((name) => `缺少 ${name}`),
        ...notReadyCoreDeliverables.map((name) => `${name} 未达可验收状态`)
      ];
      actions.push({
        id: "stage-core-deliverables-missing",
        severity: "critical",
        title: "当前阶段核心交付物未齐",
        detail: `请先补齐并提交核心交付物：${repairTargets.slice(0, 4).join("；")}${repairTargets.length > 4 ? "..." : ""}`,
        action: project.currentStage === "DESIGN" ? "open_design_review" : "submit_stage_deliverable",
        ctaLabel: project.currentStage === "DESIGN" ? "提交设计审查卡" : "提交阶段交付物"
      });
    }
  }

  if (project.currentStage === "DESIGN" && designIntervention.required && currentStageDeliverables.length === 0) {
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

  if (project.currentStage === "DEV") {
    const devEvidenceSource = currentStageDeliverables
      .map((item) => String(item.content || ""))
      .join("\n\n");
    const hasWorkspaceEvidence = /##\s*(研发落地证据（自动收集）|项目工作区证据)/i.test(devEvidenceSource);
    const hasCodePathEvidence = /(?:apps?|src|packages|server|client|web|api)\/[a-z0-9_./-]+\.(?:ts|tsx|js|jsx|json|sql|prisma|yml|yaml|sh)/i.test(devEvidenceSource);
    const hasCommandEvidence = /(?:pnpm|npm|yarn)\s+(?:dev|build|test|typecheck)|docker\s+compose|curl\s+https?:\/\/|http\s*200|exit code/i.test(devEvidenceSource);
    if (!hasWorkspaceEvidence || !hasCodePathEvidence || !hasCommandEvidence) {
      actions.push({
        id: "dev-hard-evidence-missing",
        severity: "critical",
        title: "开发阶段缺少真实落地证据",
        detail: [
          !hasWorkspaceEvidence ? "缺少项目工作区证据" : null,
          !hasCodePathEvidence ? "缺少代码文件路径证据" : null,
          !hasCommandEvidence ? "缺少验证命令证据" : null
        ].filter(Boolean).join("；"),
        action: "submit_stage_deliverable",
        ctaLabel: "补齐开发证据"
      });
    }
  }

  if (!project.pendingApproval && actions.length === 0) {
    const summary = String(project.summary || "");
    if (/核心交付物未齐|继续补充后再进入审批|未通过模板门禁/.test(summary)) {
      actions.push({
        id: "stage-deliverable-followup",
        severity: "warning",
        title: "当前阶段仍需补齐交付后再审批",
        detail: "系统检测到阶段仍未进入可审批状态，请补齐当前阶段交付并再次提交。",
        action: project.currentStage === "DESIGN" ? "open_design_review" : "submit_stage_deliverable",
        ctaLabel: project.currentStage === "DESIGN" ? "补齐设计交付" : "补齐阶段交付"
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
    targetTitles?: string[];
  }
): Promise<AutoStageSubmission[]> {
  const stageDefaultTitles = STAGE_AUTO_DELIVERABLE_TITLES[project.currentStage] || [buildAutoStageTitle(project)];
  const targetTitles = Array.isArray(options?.targetTitles)
    ? options?.targetTitles
      .map((item) => String(item || "").trim())
      .filter(Boolean)
    : [];
  const titles = targetTitles.length > 0
    ? stageDefaultTitles.filter((title) => targetTitles.includes(title))
    : stageDefaultTitles;
  if (titles.length === 0) {
    return [];
  }
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
      "必须引用至少 3 个需求关键词、2 个当前阶段任务标题，并给出可验收条目、下一阶段输入、待确认项/待澄清项。",
      "以下是交付模板约束（请严格遵循）：",
      ...templateGuidance
    ].join("\n")
  });
  if (
    shouldEnforceAutoStageRealModelGate(project.currentStage as StageType)
    && (run.provider === "scripted" || Boolean((run as StageRunSnapshot).degraded))
  ) {
    throw new Error(
      `REAL_MODEL_GATE_FAILED: ${project.currentStage} 阶段自动推进禁止使用 scripted 降级结果，请恢复真实模型后重试。`
    );
  }
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
      sanitizeModelDeliverableBody(run.body),
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
      ...buildExecutionProtocolEvidenceSections(project, project.currentStage as StageType, title),
      "",
      "## 审阅要点",
      ...checklist
    ].join("\n");

    content = ensureTemplateSectionCoverage(content, template, {
      stageLabel: STAGE_LABELS[project.currentStage as StageType] || project.currentStage,
      deliverableTitle: title
    });
    if (project.currentStage === "DEV") {
      content = `${content}\n\n${await buildDevGateEvidenceAppendix(project)}`;
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
      if (!content.includes("## 视觉预览来源约束")) {
        content = `${content}\n\n${buildDesignRequiredSections(project, title)}`;
      }
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
  submissions: AutoStageSubmission[],
  options?: {
    finalizeLastSubmission?: boolean;
  }
) {
  if (submissions.length === 0) {
    return;
  }

  const finalizeLastSubmission = options?.finalizeLastSubmission !== false;
  for (let index = 0; index < submissions.length; index += 1) {
    const submission = submissions[index].submission;
    const isLast = finalizeLastSubmission && index === submissions.length - 1;
    await submitCurrentStage(projectId, submission, {
      finalizeApproval: isLast,
      persistDraftOnTemplateFailure: true
    });
  }
}

function hasReadyStageCoreDeliverable(
  project: NonNullable<Awaited<ReturnType<typeof findProject>>>,
  stageType: StageType,
  expectedName: string
) {
  const normalizeName = (value: string) => String(value || "").trim().replace(/\s+/g, "").toLowerCase();
  const expectedToken = normalizeName(expectedName);
  const allowAcceptQualityBypass =
    stageType === "ACCEPT"
    && String(process.env.ACCEPT_ALLOW_AUTO_QUALITY_FAIL_ON_FINALIZE ?? "true").trim().toLowerCase() !== "false";
  const titleMatched = (candidateName: string) => {
    const candidateToken = normalizeName(candidateName);
    if (!candidateToken) {
      return false;
    }
    if (candidateToken === expectedToken || candidateToken.includes(expectedToken) || expectedToken.includes(candidateToken)) {
      return true;
    }

    // ACCEPT 两段提交时放宽标题匹配，减少模型文案波动导致的“已产出但判定不到”。
    if (stageType === "ACCEPT") {
      if (/(测试|test|qa)/i.test(expectedName) && /(测试|test|qa)/i.test(candidateName)) {
        return true;
      }
      if (/(回填|产品说明|backfill|acceptance)/i.test(expectedName) && /(回填|产品说明|backfill|acceptance)/i.test(candidateName)) {
        return true;
      }
    }
    return false;
  };
  const candidate = project.deliverables
    .filter((item) => item.stageType === stageType && titleMatched(item.name))
    .sort((left, right) => {
      const versionDelta = (right.version || 0) - (left.version || 0);
      if (versionDelta !== 0) {
        return versionDelta;
      }
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    })[0];

  if (!candidate) {
    return false;
  }
  if (candidate.status !== "submitted" && candidate.status !== "approved") {
    return false;
  }

  const content = String(candidate.content || "");
  if (DELIVERABLE_TEMPLATE_SCAFFOLD_PATTERN.test(content)) {
    return false;
  }
  if (/自动质检结论:\s*未通过/.test(content) && !allowAcceptQualityBypass) {
    return false;
  }
  return true;
}

async function runAcceptStageTwoStepSubmissions(
  project: NonNullable<Awaited<ReturnType<typeof findProject>>>,
  options?: {
    action?: string;
    metadata?: Prisma.InputJsonValue;
  }
) {
  const [testReportTitle, backfillTitle] = STAGE_AUTO_DELIVERABLE_TITLES.ACCEPT;
  const submitted: AutoStageSubmission[] = [];

  const testReportSubmissions = await buildAutoStageSubmissions(project, {
    action: options?.action,
    metadata: options?.metadata,
    targetTitles: [testReportTitle]
  });
  await submitStageSubmissionBundle(project.id, testReportSubmissions, {
    finalizeLastSubmission: false
  });
  submitted.push(...testReportSubmissions);

  const refreshed = await findProject(project.id);
  if (
    !refreshed
    || refreshed.status !== "active"
    || refreshed.currentStage !== "ACCEPT"
    || refreshed.pendingApproval
  ) {
    return submitted;
  }

  if (!hasReadyStageCoreDeliverable(refreshed, "ACCEPT", testReportTitle)) {
    return submitted;
  }

  const backfillSubmissions = await buildAutoStageSubmissions(refreshed, {
    action: options?.action,
    metadata: options?.metadata,
    targetTitles: [backfillTitle]
  });
  await submitStageSubmissionBundle(project.id, backfillSubmissions, {
    finalizeLastSubmission: true
  });
  submitted.push(...backfillSubmissions);
  return submitted;
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

async function handleProjectCreatedIssueFirst(projectId: string) {
  clearProjectAdvanceCancelled(projectId);
  const issueFirst = await ensureProjectIssueFirst({ projectId });
  if (!issueFirst.ok) {
    console.warn(`[ProjectIssueFirst] project bootstrap gated for ${projectId}: ${issueFirst.code} ${issueFirst.message}`);
    return issueFirst;
  }

  void startProjectWarmupAfterCreate(projectId).catch((error) => {
    console.warn(
      `[project] async warmup after create failed for ${projectId}:`,
      error instanceof Error ? error.message : String(error)
    );
  });
  return issueFirst;
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

    const tryAutoApprovePendingProject = async (projectId: string, fallbackMessage: string) => {
      if (!projectAutomationState.autoApproveWhenReady) {
        awaitingConfirmation += 1;
        firstError = firstError ?? fallbackMessage;
        return false;
      }

      try {
        const approvedProject = await approveProject(projectId);
        const refreshed = approvedProject ?? await findProject(projectId);
        if (refreshed && !refreshed.pendingApproval) {
          approved += 1;
          await trySyncGitLabHarnessForProject(refreshed, {
            reason: "project.automation_tick.auto_approve"
          });
          return true;
        }

        awaitingConfirmation += 1;
        firstError = firstError ?? `project ${projectId} auto-approve attempted but still pending confirmation`;
        return false;
      } catch (error) {
        awaitingConfirmation += 1;
        const message = error instanceof Error ? error.message : String(error);
        firstError = firstError ?? `project ${projectId} auto-approve failed: ${message}`;
        return false;
      }
    };

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

          const issueFirst = await ensureProjectIssueFirst({ projectId: project.id });
          if (!issueFirst.ok) {
            skipped += 1;
            firstError = firstError ?? buildProjectIssueFirstMessage(issueFirst);
            return;
          }

          if (project.pendingApproval) {
            const approvedByAutomation = await tryAutoApprovePendingProject(
              project.id,
              `project ${project.id} pending user confirmation`
            );
            if (!approvedByAutomation) {
              skipped += 1;
            }
            return;
          }

          const readyPending = await markCurrentStagePendingApprovalIfReady(project.id);
          if (readyPending?.pendingApproval) {
            await tryAutoApprovePendingProject(
              project.id,
              `project ${project.id} is waiting for manual stage confirmation`
            );
            return;
          }

          const submissions = project.currentStage === "ACCEPT"
            ? await runAcceptStageTwoStepSubmissions(project, {
              action: "stage.auto_submission.automation"
            })
            : await (async () => {
              const built = await buildAutoStageSubmissions(project, {
                action: "stage.auto_submission.automation"
              });
              await submitStageSubmissionBundle(project.id, built);
              return built;
            })();

          const refreshed = await findProject(project.id);
          if (refreshed) {
            await trySyncGitLabHarnessForProject(refreshed, {
              reason: "project.automation_tick"
            });
          }
          if (refreshed?.pendingApproval) {
            const qualityPass = submissions.every((item) => item.quality.pass);
            await tryAutoApprovePendingProject(
              project.id,
              qualityPass
                ? `project ${project.id} is waiting for manual stage confirmation`
                : `project ${project.id} has pending quality issues, waiting for manual confirmation`
            );
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

function kickProjectAutomationTick(options?: { force?: boolean }) {
  const force = options?.force === true;
  if (!projectAutomationState.enabled && !force) {
    return;
  }

  if (projectAutomationKickTimer) {
    return;
  }

  projectAutomationKickTimer = setTimeout(() => {
    projectAutomationKickTimer = null;
    void runProjectAutomationTick(force ? { force: true } : undefined);
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
    suspicious?: boolean;
    suspicionReasons?: string[];
  }>;
  dataQuality: {
    timeline: {
      totalEvents: number;
      evidenceEvents: number;
      omittedLowSignalEvents: number;
      highSignalTypes: string[];
    };
    executions: {
      total: number;
      success: number;
      failed: number;
      latestByRole: Array<{
        role: string;
        status: string;
        model: string;
        updatedAt: string;
      }>;
    };
    deliverables: {
      total: number;
      suspiciousCount: number;
      suspiciousItems: Array<{
        id: string;
        name: string;
        stageType: string;
        reasons: string[];
      }>;
    };
    warnings: string[];
  };
  qualityGate: {
    source: "lifecycle_audit" | "report_only";
    pass: boolean;
    blockingStageCount: number;
    blockingStages: string[];
    blockingIssues: string[];
  };
  recommendations: string[];
};

type AcceptanceLifecycleAuditSummary = {
  pass: boolean;
  blockingStageCount: number;
  blockingStages: string[];
  stageAudits?: Array<{
    stageType: string;
    stageLabel: string;
    pass: boolean;
    issues: string[];
  }>;
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
  localUrl?: string;
  publicUrl?: string;
  filePath?: string;
};

type ProjectFinalArtifactsReport = {
  projectId: string;
  projectName: string;
  status: string;
  currentStage: string;
  generatedAt: string;
  readyForAcceptance: boolean;
  blockingIssues: string[];
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
    kind: "design_preview" | "narrative_summary";
    sourceDeliverableName?: string;
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
    key: "analysis_doc",
    category: "需求分析文档",
    required: true,
    patterns: [/需求分析|分析文档|prd|requirement/i]
  },
  {
    key: "design_review",
    category: "设计审查卡",
    required: true,
    patterns: [/设计审查|design review|审查卡/i]
  },
  {
    key: "visual_preview",
    category: "视觉定稿 / 设计预览",
    required: true,
    patterns: [/视觉定稿|preview|html|视觉稿|设计预览/i]
  },
  {
    key: "runtime_delivery",
    category: "真实开发结果（运行/联调证据）",
    required: true,
    patterns: [/技术方案|实现结果|运行地址|运行说明|部署说明|联调说明/i]
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

    let officialSite: {
      url: string;
      filePath?: string;
      kind: "design_preview" | "narrative_summary";
      sourceDeliverableName?: string;
    } | undefined;
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
            filePath: artifact.filePaths[0],
            kind: artifact.kind,
            sourceDeliverableName: artifact.sourceDeliverableName
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
    const executions = await listProjectExecutions(job.projectId, 80);
    const report = buildProjectFinalArtifactsReport(project, officialSite, executions);
    const finishedAt = new Date().toISOString();
    update({
      status: "completed",
      progress: 100,
      step: "已完成",
      message: report.readyForAcceptance
        ? "最终验收产物已生成，可开始验收。"
        : `最终验收产物已生成，但仍存在阻断项：${report.blockingIssues[0] || "请检查缺失项与执行失败记录。"}`,
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

function normalizeExtractedUrl(raw: string) {
  return String(raw || "")
    .trim()
    .replace(/[),.;]+$/g, "");
}

function extractGeneratedHtmlUrlsFromContent(content: string) {
  const text = String(content || "");
  if (!text.trim()) {
    return [];
  }
  const matches = text.match(/https?:\/\/[^\s"'`<>)\]]+|\/generated\/[^\s"'`<>)\]]+\.html/gi) || [];
  return Array.from(new Set(matches.map((item) => normalizeExtractedUrl(item)).filter(Boolean)));
}

function isDappMvpPrototypeUrl(url: string) {
  const normalized = String(url || "").toLowerCase();
  return /\/generated\/liquidity-dapp-mvp\/[a-z0-9._-]+\.html/.test(normalized)
    || (/\/generated\//.test(normalized) && /dapp/.test(normalized) && /mvp/.test(normalized) && /\.html$/.test(normalized));
}

function isGeneratedHtmlUrl(url: string) {
  const normalized = String(url || "").toLowerCase();
  if (!normalized) {
    return false;
  }
  if (/^https?:\/\//.test(normalized)) {
    try {
      const pathname = new URL(normalized).pathname.toLowerCase();
      return pathname.startsWith("/generated/") && pathname.endsWith(".html");
    } catch {
      return false;
    }
  }
  return normalized.startsWith("/generated/") && normalized.endsWith(".html");
}

function resolveGeneratedFilePathFromUrl(url: string) {
  const trimmed = String(url || "").trim();
  if (!trimmed) {
    return undefined;
  }

  let pathname = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      pathname = new URL(trimmed).pathname || "";
    } catch {
      pathname = trimmed;
    }
  }

  if (!pathname.startsWith("/generated/")) {
    return undefined;
  }

  const relativePath = pathname.replace(/^\/+/, "");
  return path.join(process.cwd(), relativePath);
}

function normalizeGeneratedPublicPath(input: string) {
  const trimmed = String(input || "").trim();
  if (!trimmed) {
    return undefined;
  }

  let pathname = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      pathname = new URL(trimmed).pathname || "";
    } catch {
      pathname = trimmed;
    }
  }

  if (pathname.startsWith("/generated/")) {
    return pathname;
  }
  if (pathname.startsWith("generated/")) {
    return `/${pathname}`;
  }
  return undefined;
}

function resolveFinalArtifactLocalBaseUrl() {
  const candidates = [
    process.env.FINAL_ARTIFACT_LOCAL_BASE_URL,
    process.env.OCC_BASE_URL,
    process.env.API_BASE,
    "http://127.0.0.1:8787"
  ];

  for (const candidate of candidates) {
    const raw = String(candidate || "").trim();
    if (!raw) {
      continue;
    }
    if (!/^https?:\/\//i.test(raw)) {
      continue;
    }
    try {
      const parsed = new URL(raw);
      return `${parsed.protocol}//${parsed.host}`.replace(/\/+$/, "");
    } catch {
      // ignore invalid candidate and continue fallback
    }
  }
  return "http://127.0.0.1:8787";
}

function resolveFinalArtifactPublicBaseUrl() {
  const envBase = String(process.env.FINAL_ARTIFACT_PUBLIC_BASE_URL || "").trim();
  if (envBase && /^https?:\/\//i.test(envBase)) {
    try {
      const parsed = new URL(envBase);
      return `${parsed.protocol}//${parsed.host}`.replace(/\/+$/, "");
    } catch {
      // ignore malformed env and continue
    }
  }

  if (existsSync(cloudflaredTunnelLogPath)) {
    try {
      const logText = readFileSync(cloudflaredTunnelLogPath, "utf8");
      const matches = [...logText.matchAll(/https:\/\/[-a-z0-9]+\.trycloudflare\.com/gi)].map((item) => item[0]);
      if (matches.length > 0) {
        return matches[matches.length - 1].replace(/\/+$/, "");
      }
    } catch {
      // ignore log parsing failures
    }
  }

  return undefined;
}

function buildArtifactAccessUrls(inputUrl?: string) {
  const raw = String(inputUrl || "").trim();
  const pathName = normalizeGeneratedPublicPath(raw);
  const localBase = resolveFinalArtifactLocalBaseUrl();
  const publicBase = resolveFinalArtifactPublicBaseUrl();

  const result: { localUrl?: string; publicUrl?: string } = {};
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "0.0.0.0") {
        result.localUrl = parsed.toString();
      } else {
        result.publicUrl = parsed.toString();
      }
    } catch {
      // ignore malformed absolute URL
    }
  }

  if (pathName) {
    if (!result.localUrl) {
      result.localUrl = `${localBase}${pathName}`;
    }
    if (!result.publicUrl && publicBase) {
      result.publicUrl = `${publicBase}${pathName}`;
    }
  }

  if (result.localUrl && result.publicUrl && result.localUrl === result.publicUrl) {
    result.publicUrl = undefined;
  }

  return result;
}

function formatArtifactAccessExcerpt(baseExcerpt: string, accessUrls: { localUrl?: string; publicUrl?: string }) {
  const lines = [String(baseExcerpt || "").trim()].filter(Boolean);
  if (accessUrls.localUrl) {
    lines.push(`本地访问地址：${accessUrls.localUrl}`);
  }
  if (accessUrls.publicUrl) {
    lines.push(`外网访问地址：${accessUrls.publicUrl}`);
  }
  return Array.from(new Set(lines)).join("\n");
}

function pickPrototypeLinkCandidate(
  deliverables: NonNullable<Awaited<ReturnType<typeof findProject>>>["deliverables"]
) {
  type Candidate = {
    url: string;
    isDappMvp: boolean;
    deliverable: NonNullable<Awaited<ReturnType<typeof findProject>>>["deliverables"][number];
  };
  const candidates: Candidate[] = [];

  for (const item of deliverables) {
    const urls = extractGeneratedHtmlUrlsFromContent(String(item.content || ""));
    for (const url of urls) {
      if (!isGeneratedHtmlUrl(url)) {
        continue;
      }
      candidates.push({
        url,
        isDappMvp: isDappMvpPrototypeUrl(url),
        deliverable: item
      });
    }
  }

  if (candidates.length === 0) {
    return undefined;
  }

  return candidates.sort((left, right) => {
    if (left.isDappMvp !== right.isDappMvp) {
      return Number(right.isDappMvp) - Number(left.isDappMvp);
    }
    const leftIndexScore = /\/index\.html$/i.test(left.url) ? 1 : 0;
    const rightIndexScore = /\/index\.html$/i.test(right.url) ? 1 : 0;
    if (rightIndexScore !== leftIndexScore) {
      return rightIndexScore - leftIndexScore;
    }
    const statusDelta = deliverableStatusScore(right.deliverable.status) - deliverableStatusScore(left.deliverable.status);
    if (statusDelta !== 0) {
      return statusDelta;
    }
    const versionDelta = (right.deliverable.version || 0) - (left.deliverable.version || 0);
    if (versionDelta !== 0) {
      return versionDelta;
    }
    return new Date(right.deliverable.updatedAt).getTime() - new Date(left.deliverable.updatedAt).getTime();
  })[0];
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

const FINAL_ARTIFACT_TEMPLATE_BIAS_PATTERNS = [
  /项目协作平台视觉定稿/i,
  /立即进入执行看板/i,
  /核心能力：阶段编排/i,
  /创建项目并选择阶段模板/i,
  /需求输入|执行证据回写|阶段验收与回填/i
];

function isTemplateLikeDeliverableForFinalArtifacts(
  project: NonNullable<Awaited<ReturnType<typeof findProject>>>,
  item: NonNullable<Awaited<ReturnType<typeof findProject>>>["deliverables"][number]
) {
  const content = String(item.content || "").trim();
  if (!content) {
    return true;
  }
  if (FINAL_ARTIFACT_TEMPLATE_BIAS_PATTERNS.some((pattern) => pattern.test(content))) {
    return true;
  }
  const suspicionReasons = detectSuspiciousDeliverableReasons(content);
  if (suspicionReasons.some((reason) => reason.includes("模板/占位"))) {
    return true;
  }
  if (item.stageType === "DESIGN" && isVisualMockupDeliverableTitle(String(item.name || ""))) {
    const alignment = evaluateVisualDesignRequirementAlignment({
      projectName: project.name,
      projectDescription: project.description,
      keywords: project.parsedIntent.keywords,
      content
    });
    if (!alignment.pass) {
      return true;
    }
  }
  return false;
}

function pickBestDeliverable(
  deliverables: NonNullable<Awaited<ReturnType<typeof findProject>>>["deliverables"],
  patterns: RegExp[],
  project: NonNullable<Awaited<ReturnType<typeof findProject>>>
) {
  const candidates = deliverables.filter((item) => patterns.some((pattern) => pattern.test(item.name)));
  if (candidates.length === 0) {
    return undefined;
  }
  const preferredCandidates = candidates.filter((item) => !isTemplateLikeDeliverableForFinalArtifacts(project, item));
  const rankedPool = preferredCandidates.length > 0 ? preferredCandidates : candidates;

  return rankedPool.sort((left, right) => {
    const rightReady = isDeliverableReadyForAcceptance({
      status: right.status,
      content: right.content,
      project,
      stageType: right.stageType,
      deliverableName: right.name
    });
    const leftReady = isDeliverableReadyForAcceptance({
      status: left.status,
      content: left.content,
      project,
      stageType: left.stageType,
      deliverableName: left.name
    });
    if (rightReady !== leftReady) {
      return Number(rightReady) - Number(leftReady);
    }
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

function buildFinalArtifactsBlockingIssues(input: {
  project: NonNullable<Awaited<ReturnType<typeof findProject>>>;
  executions: Awaited<ReturnType<typeof listProjectExecutions>>;
  officialSite?: {
    url: string;
    filePath?: string;
    kind: "design_preview" | "narrative_summary";
    sourceDeliverableName?: string;
  };
}) {
  const issues: string[] = [];
  const qaExecutions = input.executions.filter((item) =>
    item.stageType === "ACCEPT" && item.role === "ROLE_QA"
  );
  const latestQaExecution = qaExecutions[0];
  const hasQaSuccess = qaExecutions.some((item) => item.status === "success");
  if (latestQaExecution?.status === "failed" && !hasQaSuccess) {
    issues.push(`QA 最新一次验收执行失败：${latestQaExecution.errorMessage || "未返回具体错误"}`);
  }

  const devEvidenceReady = input.project.deliverables
    .filter((item) => item.stageType === "DEV")
    .filter((item) => item.status === "submitted" || item.status === "approved")
    .some((item) =>
      evaluateDevImplementationEvidenceForAcceptance({
        projectName: input.project.name,
        projectDescription: input.project.description,
        keywords: input.project.parsedIntent.keywords,
        content: String(item.content || "")
      }).pass
    );

  if (!devEvidenceReady) {
    issues.push("缺少真实研发实现证据，当前 DEV 产物还不足以证明存在可运行页面、接口、存储、代码路径与联调结果。");
  }

  if (input.officialSite?.kind === "design_preview") {
    issues.push("当前生成链接来自 DESIGN 阶段视觉预览，只能算设计快照，不能充当最终研发交付。");
  }

  if (input.officialSite?.filePath && !existsSync(input.officialSite.filePath)) {
    issues.push(`最终成果链接对应文件不存在：${input.officialSite.filePath}`);
  }

  return issues;
}

function buildProjectFinalArtifactsReport(
  project: NonNullable<Awaited<ReturnType<typeof findProject>>>,
  officialSite?: {
    url: string;
    filePath?: string;
    kind: "design_preview" | "narrative_summary";
    sourceDeliverableName?: string;
  },
  executions: Awaited<ReturnType<typeof listProjectExecutions>> = []
): ProjectFinalArtifactsReport {
  const deliverables = [...project.deliverables]
    .sort((left, right) => {
      const updatedDelta = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      if (updatedDelta !== 0) {
        return updatedDelta;
      }
      return (right.version || 0) - (left.version || 0);
    });

  const hasAnalysisEvidence = deliverables.some((item) =>
    item.stageType === "ANALYSIS"
    && /(排期|里程碑|schedule|需求分析|分析文档|prd|requirement)/i.test(String(item.name || ""))
  );
  const requirePlanningArtifacts = String(process.env.FINAL_ARTIFACT_REQUIRE_ANALYSIS_DOCS ?? "false").trim().toLowerCase() === "true";
  const requiredArtifacts = FINAL_REQUIRED_ARTIFACTS.map((target) => {
    if ((target.key === "schedule" || target.key === "analysis_doc") && !requirePlanningArtifacts && !hasAnalysisEvidence) {
      return {
        ...target,
        required: false
      };
    }
    return target;
  });

  const artifacts: FinalArtifactRecord[] = [];
  const missingRequired: string[] = [];

  for (const target of requiredArtifacts) {
    const matched = pickBestDeliverable(deliverables, target.patterns, project);
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

  if (artifacts.length === 0 && deliverables.length > 0) {
    const fallbackArtifacts = deliverables
      .slice(0, 5)
      .map((item, index) => ({
        key: `fallback_${index + 1}`,
        category: `阶段交付快照（${STAGE_LABELS[item.stageType as StageType] || item.stageType}）`,
        required: false,
        ready: isDeliverableReadyForAcceptance({
          status: item.status,
          content: item.content,
          project,
          stageType: item.stageType,
          deliverableName: item.name
        }),
        issue: "该交付物暂未映射到标准最终产物分类，请补齐命名或继续推进阶段产出。",
        source: "deliverable" as const,
        deliverableId: item.id,
        name: item.name,
        stageType: item.stageType,
        status: item.status,
        version: item.version,
        updatedAt: item.updatedAt,
        content: item.content,
        excerpt: buildExcerpt(item.content)
      }));
    artifacts.push(...fallbackArtifacts);
  }

  const prototypeLinkCandidate = pickPrototypeLinkCandidate(deliverables);
  if (prototypeLinkCandidate && !artifacts.some((item) => item.key === "interactive_prototype")) {
    const accessUrls = buildArtifactAccessUrls(prototypeLinkCandidate.url);
    const filePath = resolveGeneratedFilePathFromUrl(prototypeLinkCandidate.url);
    const linkExists = !filePath || existsSync(filePath);
    const isDappMvp = isDappMvpPrototypeUrl(prototypeLinkCandidate.url);
    artifacts.push({
      key: "interactive_prototype",
      category: isDappMvp ? "DApp MVP 交互原型（项目交付物）" : "交互页面交付物（项目链接）",
      required: false,
      ready: linkExists,
      issue: linkExists
        ? undefined
        : "交互原型链接对应文件不存在，请重新生成或修复路径。",
      source: "link",
      name: isDappMvp ? "DApp MVP 交互原型" : "交互页面交付物",
      stageType: prototypeLinkCandidate.deliverable.stageType,
      status: prototypeLinkCandidate.deliverable.status,
      version: prototypeLinkCandidate.deliverable.version,
      updatedAt: prototypeLinkCandidate.deliverable.updatedAt,
      url: accessUrls.publicUrl || accessUrls.localUrl || prototypeLinkCandidate.url,
      localUrl: accessUrls.localUrl,
      publicUrl: accessUrls.publicUrl,
      filePath,
      excerpt: formatArtifactAccessExcerpt(
        `访问地址：${prototypeLinkCandidate.url}（来源：${prototypeLinkCandidate.deliverable.name}）`,
        accessUrls
      )
    });
  }

  if (officialSite?.url) {
    const accessUrls = buildArtifactAccessUrls(officialSite.url);
    const isDesignPreview = officialSite.kind === "design_preview";
    const isDappMvpPrototype = /\/generated\/liquidity-dapp-mvp\/index\.html/i.test(String(officialSite.url || ""));
    const isGeneratedHtmlDeliverable = /\/generated\/.+\.html(?:[?#].*)?$/i.test(String(officialSite.url || ""));
    const linkExists = !officialSite.filePath || existsSync(officialSite.filePath);
    const sourceHint = officialSite.sourceDeliverableName ? `，来源：${officialSite.sourceDeliverableName}` : "";
    const officialSiteExcerpt = officialSite.url
      ? `访问地址：${officialSite.url}（${isDappMvpPrototype ? "DApp MVP 交互原型" : isDesignPreview ? "设计预览快照" : isGeneratedHtmlDeliverable ? "交互页面交付物" : "交付物链接"}${sourceHint}）`
      : officialSite.filePath
        ? `本地文件：${officialSite.filePath}`
        : "可直接打开在线演示页";
    artifacts.push({
      key: "official_site",
      category: isDappMvpPrototype
        ? "DApp MVP 交互原型（项目交付物）"
        : isDesignPreview
          ? "设计预览快照（非最终研发成果）"
          : isGeneratedHtmlDeliverable
            ? "交互页面交付物"
            : "交付成果链接",
      required: false,
      ready: linkExists && (!isDesignPreview || isDappMvpPrototype),
      issue: !linkExists
        ? "链接文件不存在，当前地址不可作为验收依据。"
        : isDappMvpPrototype
          ? "该页面为项目 MVP 的高保真交互原型交付物，可直接用于走查与演示。"
        : isDesignPreview
          ? "该页面直接来源于 DESIGN 视觉预览，只能用于看稿，不能替代真实开发结果。"
          : isGeneratedHtmlDeliverable
            ? "该页面来自项目交付物中的真实生成链接，可用于走查与演示。"
            : "该链接来自交付物引用，请结合阶段产出与测试结果进行验收。",
      source: "link",
      name: isDappMvpPrototype
        ? "DApp MVP 交互原型"
        : isDesignPreview
          ? "设计预览快照"
          : isGeneratedHtmlDeliverable
            ? "交互页面交付物"
            : "交付成果链接",
      stageType: "ACCEPT",
      status: isDappMvpPrototype ? "approved" : isDesignPreview ? "submitted" : "approved",
      updatedAt: new Date().toISOString(),
      url: accessUrls.publicUrl || accessUrls.localUrl || officialSite.url,
      localUrl: accessUrls.localUrl,
      publicUrl: accessUrls.publicUrl,
      filePath: officialSite.filePath,
      excerpt: formatArtifactAccessExcerpt(officialSiteExcerpt, accessUrls)
    });
  }

  const blockingIssues = buildFinalArtifactsBlockingIssues({
    project,
    executions,
    officialSite
  });

  const required = requiredArtifacts.filter((item) => item.required).length;
  const provided = requiredArtifacts
    .filter((item) => item.required)
    .reduce((count, item) => {
      const matched = artifacts.find((artifact) => artifact.key === item.key);
      return count + (matched?.ready ? 1 : 0);
    }, 0);
  const readyForAcceptance = missingRequired.length === 0
    && blockingIssues.length === 0
    && project.status === "completed"
    && project.currentStage === "ACCEPT";
  const checklist = [
    readyForAcceptance ? "关键验收产物齐全，且未发现阻断项，可进入最终验收确认。" : "当前仍存在阻断项或缺失项，不能进入最终验收确认。",
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
    blockingIssues,
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

const ACCEPTANCE_REPORT_HIGH_SIGNAL_TIMELINE_TYPES = new Set<string>([
  "deliverable_submitted",
  "approval_done",
  "approval_rejected",
  "approval_required",
  "intervention",
  "message",
  "resume"
]);
const ACCEPTANCE_REPORT_LOW_SIGNAL_TIMELINE_TYPES = new Set<string>([
  "thinking",
  "system",
  "stage_started",
  "project_created"
]);
const ACCEPTANCE_REPORT_SUSPICIOUS_DELIVERABLE_PATTERN =
  /模板章节骨架|自动补齐|请补全本节|待补充|占位(词|符)?|TODO|TBD|lorem ipsum|\bxxx\b/i;

type AcceptanceExecutionRecord = {
  role: string;
  status: string;
  model?: string | null;
  provider?: string | null;
  metadata?: unknown;
  createdAt: string;
  updatedAt: string;
};

function isHighSignalTimelineEvent(event: { type: string }) {
  const type = String(event.type || "");
  return ACCEPTANCE_REPORT_HIGH_SIGNAL_TIMELINE_TYPES.has(type) || type.startsWith("task_");
}

function sortTimelineDesc<T extends { timestamp: string }>(timeline: T[]) {
  return [...timeline].sort((left, right) =>
    new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()
  );
}

function detectSuspiciousDeliverableReasons(content: string) {
  const normalized = String(content || "").trim();
  const reasons: string[] = [];
  if (!normalized) {
    reasons.push("正文为空");
    return reasons;
  }
  if (normalized.length < 180) {
    reasons.push("正文长度过短（小于 180 字）");
  }
  if (ACCEPTANCE_REPORT_SUSPICIOUS_DELIVERABLE_PATTERN.test(normalized)) {
    reasons.push("命中模板/占位/自动补齐特征");
  }
  if (!normalized.includes("## 验收检查清单")) {
    reasons.push("缺少“## 验收检查清单”章节");
  }
  return reasons;
}

function buildExecutionQualitySummary(executions: AcceptanceExecutionRecord[]) {
  const total = executions.length;
  const success = executions.filter((item) => String(item.status || "").toLowerCase() === "success").length;
  const failed = executions.filter((item) => String(item.status || "").toLowerCase() === "failed").length;
  const sorted = [...executions].sort((left, right) =>
    new Date(right.updatedAt || right.createdAt).getTime()
    - new Date(left.updatedAt || left.createdAt).getTime()
  );

  const byRole = new Map<string, AcceptanceExecutionRecord[]>();
  for (const execution of sorted) {
    const list = byRole.get(execution.role) ?? [];
    list.push(execution);
    byRole.set(execution.role, list);
  }

  const latestByRole = [...byRole.values()].map((rows) => {
    const latestRealSuccess = rows.find((item) =>
      String(item.status || "").toLowerCase() === "success"
      && String(item.provider || "").trim().toLowerCase() !== "scripted"
      && !isExecutionDegradedForAcceptance(item.metadata)
    );
    const latestSuccess = rows.find((item) => String(item.status || "").toLowerCase() === "success");
    return latestRealSuccess || latestSuccess || rows[0];
  });

  return {
    total,
    success,
    failed,
    latestByRole: latestByRole.slice(0, 8).map((item) => ({
      role: item.role,
      status: item.status,
      model: item.model || item.provider || "unknown",
      updatedAt: item.updatedAt || item.createdAt
    }))
  };
}

function isExecutionDegradedForAcceptance(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }
  return Boolean((metadata as Record<string, unknown>).degraded);
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
  project: NonNullable<Awaited<ReturnType<typeof findProject>>>,
  options?: {
    executions?: AcceptanceExecutionRecord[];
    lifecycleAudit?: AcceptanceLifecycleAuditSummary;
  }
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
  const executionSummary = buildExecutionQualitySummary(options?.executions || []);
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

  const sortedTimeline = sortTimelineDesc(project.timeline);
  const evidenceTimeline = sortedTimeline.filter((item) => isHighSignalTimelineEvent(item));
  const omittedLowSignalEvents = sortedTimeline.filter((item) =>
    ACCEPTANCE_REPORT_LOW_SIGNAL_TIMELINE_TYPES.has(String(item.type || ""))
  ).length;
  const timelineHighSignalTypes = [...new Set(evidenceTimeline.map((item) => String(item.type || "")))];

  const deliverablesSorted = [...project.deliverables].sort((left, right) =>
    new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  );
  const suspiciousDeliverables = deliverablesSorted
    .map((item) => ({
      id: item.id,
      name: item.name,
      stageType: item.stageType,
      reasons: detectSuspiciousDeliverableReasons(String(item.content || ""))
    }))
    .filter((item) => item.reasons.length > 0);

  const qualityWarnings: string[] = [];
  if (suspiciousDeliverables.length > 0) {
    qualityWarnings.push(`检测到 ${suspiciousDeliverables.length} 份可疑交付物（模板痕迹/占位词/缺验收清单）。`);
  }
  if (evidenceTimeline.length < Math.min(6, Math.max(3, Math.floor(sortedTimeline.length / 2)))) {
    qualityWarnings.push("高信号时间线事件偏少，当前报告更多来自系统预热/状态日志。");
  }
  if (executionSummary.total === 0) {
    qualityWarnings.push("未找到模型/Agent 执行记录，验收结论可信度较低。");
  } else if (executionSummary.success === 0) {
    qualityWarnings.push("执行记录中无成功项，请优先核查运行链路与模型输出。");
  }

  const lifecycleAuditBlockingIssues = (options?.lifecycleAudit?.stageAudits || [])
    .filter((item) => !item.pass)
    .flatMap((item) => item.issues.slice(0, 3).map((issue) => `${item.stageLabel}: ${issue}`))
    .slice(0, 20);
  const qualityGate = options?.lifecycleAudit
    ? {
      source: "lifecycle_audit" as const,
      pass: options.lifecycleAudit.pass,
      blockingStageCount: options.lifecycleAudit.blockingStageCount,
      blockingStages: options.lifecycleAudit.blockingStages,
      blockingIssues: lifecycleAuditBlockingIssues
    }
    : {
      source: "report_only" as const,
      pass: qualityWarnings.length === 0,
      blockingStageCount: qualityWarnings.length > 0 ? 1 : 0,
      blockingStages: qualityWarnings.length > 0 ? [project.currentStage] : [],
      blockingIssues: qualityWarnings.slice(0, 10)
    };
  if (!qualityGate.pass) {
    qualityWarnings.push("生命周期质量门禁未通过，当前报告仅可作为整改输入，不能直接作为通过验收依据。");
  }

  const recommendations: string[] = [];
  if (project.pendingApproval) {
    recommendations.push("当前阶段存在待审批交付物，请尽快执行通过/驳回决策。");
  }
  if (blockedTasks > 0) {
    recommendations.push(`当前存在 ${blockedTasks} 个阻塞任务，建议优先人工干预并分配补救动作。`);
  }
  if (suspiciousDeliverables.length > 0) {
    recommendations.push("请先修复可疑交付物，再执行最终验收归档，避免模板文本被误判为真实产出。");
  }
  if (executionSummary.success === 0) {
    recommendations.push("请补齐至少一条成功执行记录（模型/Agent + 输出证据）后再做验收结论。");
  }
  if (!qualityGate.pass) {
    recommendations.push("请先清零质量门禁阻断项，再执行归档或对外交付。");
  }
  if (project.status !== "completed" && approvedDeliverables < project.deliverables.length) {
    recommendations.push("项目尚未完全收敛，建议在验收前确认各阶段交付物状态。");
  }
  if (project.status === "completed" && recommendations.length === 0 && qualityGate.pass) {
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
    recentTimeline: evidenceTimeline.slice(0, 20).map((item) => ({
      id: item.id,
      timestamp: item.timestamp,
      type: item.type,
      title: item.title,
      content: item.content,
      priority: item.priority,
      agentId: item.agentId
    })),
    recentDeliverables: deliverablesSorted.slice(0, 20).map((item) => {
      const suspicionReasons = detectSuspiciousDeliverableReasons(String(item.content || ""));
      return {
        id: item.id,
        stageType: item.stageType,
        name: item.name,
        status: item.status,
        version: item.version,
        createdBy: item.createdBy,
        updatedAt: item.updatedAt,
        suspicious: suspicionReasons.length > 0,
        suspicionReasons: suspicionReasons.length > 0 ? suspicionReasons : undefined
      };
    }),
    dataQuality: {
      timeline: {
        totalEvents: sortedTimeline.length,
        evidenceEvents: evidenceTimeline.length,
        omittedLowSignalEvents,
        highSignalTypes: timelineHighSignalTypes
      },
      executions: executionSummary,
      deliverables: {
        total: project.deliverables.length,
        suspiciousCount: suspiciousDeliverables.length,
        suspiciousItems: suspiciousDeliverables.slice(0, 12)
      },
      warnings: qualityWarnings
    },
    qualityGate,
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
    `- ${item.name} (${item.stageType} / v${item.version} / ${item.status} / ${item.updatedAt})${item.suspicious ? ` [可疑: ${(item.suspicionReasons || []).join("；")}]` : ""}`
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
  const qualityLines = [
    `- 时间线总事件: ${report.dataQuality.timeline.totalEvents}`,
    `- 高信号事件: ${report.dataQuality.timeline.evidenceEvents}`,
    `- 已忽略低信号事件: ${report.dataQuality.timeline.omittedLowSignalEvents}`,
    `- 高信号类型: ${report.dataQuality.timeline.highSignalTypes.join("、") || "无"}`,
    `- 执行记录: 总计 ${report.dataQuality.executions.total} / 成功 ${report.dataQuality.executions.success} / 失败 ${report.dataQuality.executions.failed}`,
    `- 可疑交付物: ${report.dataQuality.deliverables.suspiciousCount} / ${report.dataQuality.deliverables.total}`
  ];
  const qualityWarningLines = report.dataQuality.warnings.map((item) => `- ${item}`);
  const qualityGateLines = [
    `- 门禁来源: ${report.qualityGate.source === "lifecycle_audit" ? "lifecycle-audit" : "report-only"}`,
    `- 门禁状态: ${report.qualityGate.pass ? "passed" : "blocked"}`,
    `- 阻断阶段数: ${report.qualityGate.blockingStageCount}`,
    `- 阻断阶段: ${report.qualityGate.blockingStages.join("、") || "无"}`
  ];
  const qualityGateBlockingLines = report.qualityGate.blockingIssues.map((item) => `- ${item}`);

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
    `## 数据质量审计`,
    ...qualityLines,
    "",
    `### 质量门禁`,
    ...qualityGateLines,
    ...(qualityGateBlockingLines.length > 0
      ? ["", `### 门禁阻断项`, ...qualityGateBlockingLines]
      : []),
    ...(qualityWarningLines.length > 0
      ? ["", `### 质量告警`, ...qualityWarningLines]
      : []),
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

// CORS 配置
const configuredAllowedOrigins = (process.env.ALLOWED_ORIGINS?.split(",").map(origin => origin.trim()).filter(Boolean) || []);
const loopbackOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
const desktopOriginPatterns = [
  /^app:\/\//i,
  /^tauri:\/\//i,
  /^capacitor:\/\/localhost$/i
];

if (process.env.NODE_ENV === "production" && configuredAllowedOrigins.length === 0) {
  throw new Error("生产环境必须设置 ALLOWED_ORIGINS 环境变量，不允许使用通配符");
}

const corsOrigin: cors.CorsOptions["origin"] = process.env.NODE_ENV === "production"
  ? (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (configuredAllowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    if (loopbackOriginPattern.test(origin)) {
      callback(null, true);
      return;
    }

    const isDesktopOrigin = desktopOriginPatterns.some((pattern) => pattern.test(origin));
    if (isDesktopOrigin) {
      callback(null, true);
      return;
    }

    callback(new Error(`Not allowed by CORS: ${origin}`));
  }
  : true; // 开发环境允许任意源

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

app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
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

app.get("/metrics", asyncRoute(async (_req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    process: {
      uptimeSeconds: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage()
    }
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

  // System monitor endpoints - public for internal tooling (model center usage stats)
  if (req.path.startsWith("/api/system/local-agent-monitor")) {
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

  if (
    req.path === "/v1/knowledge/for-hermes"
    || req.path === "/v1/knowledge/sync-from-hermes"
    || req.path === "/v1/skills/for-hermes"
    || req.path === "/v1/skills/import/hermes"
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
  onProjectCreated: async (projectId) => {
    await handleProjectCreatedIssueFirst(projectId);
  }
}));
app.use("/api/system", createSystemRouter({
  asyncRoute,
  safeAudit,
  sendEvent
}));
app.use("/api/gitlab", createGitLabRouter());
app.use("/api/v1/knowledge", createKnowledgeV2Router());
app.use("/api/v1/skills", createSkillsV2Router());
app.use("/api/v1/workflows", createWorkflowsV2Router());
app.use(createTasksRouter({
  safeAudit
}));
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
  markProjectAdvanceCancelled,
  clearProjectAdvanceCancelled,
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

if (existsSync(siteGeneratedPath)) {
  app.use("/generated", express.static(siteGeneratedPath));
}

if (existsSync(workspaceGeneratedPath)) {
  app.use("/generated", express.static(workspaceGeneratedPath));
}

if (existsSync(webDistPath)) {
  app.use(express.static(webDistPath));
  app.get("*", (req, res, next) => {
    if (
      req.path.startsWith("/api")
      || req.path.startsWith("/generated")
      || req.path === "/health"
      || req.path === "/ready"
      || req.path === "/metrics"
    ) {
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
