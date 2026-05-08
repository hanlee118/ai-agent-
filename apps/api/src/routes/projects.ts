/**
 * ⚠️ V1 维护模式
 * 此文件仅接受 bug 修复，不接受新功能。
 * 新功能请在 workflows-v2.ts 或 workflow-v2/ 目录下实现。
 * 详见 docs/ARCHITECTURE-EVOLUTION.md
 */
import express from "express";
import type { Response } from "express";
import type {
  InterventionInput,
  ProjectMessageInput,
  RoleType,
  StageRejectInput,
  StageSubmissionInput,
  TaskUpdateInput
} from "@occ/shared";
import {
  ROLE_LABELS,
  STAGE_LABELS
} from "@occ/shared";
import {
  approveProject,
  archiveProjectAcceptanceReport,
  closeProject,
  createProject,
  deleteProject,
  findProject,
  getDesignInterventionSignal,
  getProjectExecutionProtocolPrecheck,
  getProjectLifecycleQualityAudit,
  interveneProject,
  listProjectExecutions,
  listStructuredMergeRequests,
  listProjectTasks,
  listProjects,
  listTasks,
  postProjectMessage,
  getProjectTemplateGatePrecheck,
  reconcileProjectDeliverablesNow,
  rejectProjectStage,
  runProjectStageAgent,
  resumeProject,
  submitCurrentStage,
  startProjectWarmupAfterCreate,
  updateTaskStatus
} from "../data/repository.js";
import { getRuntimeStatus } from "../agents/runtime.js";
import { syncTaskStatus } from "../services/gitlab-sync-policy.js";
import {
  buildProjectIssueFirstMessage,
  ensureProjectIssueFirst
} from "../services/project-issue-first.js";
import {
  confirmProjectPostCreatePrep,
  evaluateProjectPostCreatePrepStatus,
  runProjectPostCreatePrep,
  saveProjectPostCreatePrepDraft
} from "../system/post-create-prep.js";
import { getStageRealModelGateRoles } from "../system/project-stage-execution.js";
import { prisma } from "../db.js";
import { getProjectRole, isPermissionAllowed, type ProjectRole } from "../security/rbac.js";
import { previewRequirement } from "../utils/project-parser.js";
import { generateOfficialSiteArtifact } from "../utils/official-site.js";
import {
  publishProjectMainIssueNote,
  publishTaskIssueNote,
  syncProjectGitLabHarness,
  upsertQualityGateRepairIssue
} from "./gitlab.js";
import {
  bindProjectInputsToWorkflowEntryStages,
  createProjectInputs,
  importRelayInputs,
  listProjectInputs
} from "../workflow-v2/project-modes.js";
import { getActiveWorkflow, addStageOutputArtifact } from "../workflow-v2/workflow-orchestrator.js";
import { validateBody } from "../validation/middleware.js";
import {
  MutationOptionalSchema,
  MutationPassthroughSchema,
  ProjectAutomationUpdateSchema,
  ProjectCleanupRequestSchema,
  ProjectCreateSchema,
  ProjectInterveneSchema,
  ProjectMessageSchema,
  ProjectParseRequestSchema,
  ProjectPostCreatePrepConfirmSchema,
  ProjectPostCreatePrepSchema,
  ProjectPreviewRequestSchema,
  ProjectRejectSchema,
  ProjectStageSubmitSchema,
  TaskStatusUpdateSchema
} from "../validation/schemas.js";

const PROJECT_DIRECT_CREATE_ENABLED = String(process.env.PROJECT_DIRECT_CREATE_ENABLED ?? "false").trim().toLowerCase() === "true";
const PROJECT_PARSE_LEGACY_ENABLED = process.env.PROJECT_PARSE_LEGACY_ENABLED === "true";
const QUALITY_GATE_REPAIR_DEFAULT_LIMIT = 80;
const QUALITY_GATE_REPAIR_STAGE_LABELS: Record<string, string> = {
  INIT: "项目立项",
  ANALYSIS: "需求分析",
  DESIGN: "需求设计/视觉设计",
  DEV: "代码开发",
  ACCEPT: "测试验收"
};
const LIFECYCLE_AUDIT_STAGE_ORDER: Array<"INIT" | "ANALYSIS" | "DESIGN" | "DEV" | "ACCEPT"> = [
  "INIT",
  "ANALYSIS",
  "DESIGN",
  "DEV",
  "ACCEPT"
];
const QUALITY_GATE_REPAIR_DEFAULT_VALIDATIONS = [
  "pnpm --filter @occ/api typecheck",
  "pnpm --filter @occ/web typecheck",
  "pnpm --filter @occ/web build"
];
const PROJECT_LIST_TOTAL_CACHE_TTL_MS = Math.max(
  3_000,
  Number(process.env.PROJECT_LIST_TOTAL_CACHE_TTL_MS ?? 20_000)
);
let projectListTotalCache: { value: number; expiresAt: number } | null = null;
const TASK_LIST_TOTAL_CACHE_TTL_MS = Math.max(
  3_000,
  Number(process.env.TASK_LIST_TOTAL_CACHE_TTL_MS ?? 15_000)
);
const PROJECT_DETAIL_SOFT_TIMEOUT_MS = Math.max(
  300,
  Number(process.env.PROJECT_DETAIL_SOFT_TIMEOUT_MS ?? 1_200)
);
const taskListTotalCache = new Map<string, { value: number; expiresAt: number }>();
const projectDetailSnapshotCache = new Map<string, {
  updatedAt: number;
  value: unknown;
}>();
const PROJECT_DETAIL_STALE_MAX_AGE_MS = Math.max(
  3_000,
  Number(process.env.PROJECT_DETAIL_STALE_MAX_AGE_MS ?? 15_000)
);
const projectDetailRefreshInflight = new Map<string, Promise<void>>();
const PROJECT_DETAIL_PREWARM_ENABLED = String(process.env.PROJECT_DETAIL_PREWARM_ENABLED ?? "true").trim().toLowerCase() !== "false";
const PROJECT_DETAIL_PREWARM_LIMIT = Math.max(
  1,
  Number(process.env.PROJECT_DETAIL_PREWARM_LIMIT ?? 8)
);
const PROJECT_DETAIL_PREWARM_DELAY_MS = Math.max(
  500,
  Number(process.env.PROJECT_DETAIL_PREWARM_DELAY_MS ?? 2_500)
);

async function ensureProjectExists(projectId: string) {
  const count = await prisma.project.count({
    where: { id: projectId }
  });
  return count > 0;
}

async function getCachedTaskTotal(key: string, where: Record<string, unknown>) {
  const now = Date.now();
  const cached = taskListTotalCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  const value = await prisma.task.count({ where });
  taskListTotalCache.set(key, {
    value,
    expiresAt: now + TASK_LIST_TOTAL_CACHE_TTL_MS
  });
  return value;
}
let buildProjectRequiredActionsDelegate: ((project: unknown, runtime: unknown) => ProjectRequiredAction[]) | null = null;
let formatRequiredActionsMessageDelegate: ((actions: ProjectRequiredAction[]) => string) | null = null;

function buildProjectRequiredActions(project: unknown, runtime: unknown): ProjectRequiredAction[] {
  if (buildProjectRequiredActionsDelegate) {
    return buildProjectRequiredActionsDelegate(project, runtime);
  }
  return [];
}

function formatRequiredActionsMessage(actions: ProjectRequiredAction[]) {
  if (formatRequiredActionsMessageDelegate) {
    return formatRequiredActionsMessageDelegate(actions);
  }
  return actions.map((item) => item.title).join("；");
}

async function withSoftTimeout<T>(
  task: Promise<T>,
  timeoutMs: number
): Promise<{ timedOut: boolean; value?: T }> {
  let timer: NodeJS.Timeout | null = null;
  try {
    const timeoutPromise = new Promise<{ timedOut: boolean; value?: T }>((resolve) => {
      timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
      timer.unref?.();
    });
    const valuePromise = task.then((value) => ({ timedOut: false as const, value }));
    return await Promise.race([valuePromise, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function refreshProjectDetailSnapshot(projectId: string) {
  const existing = projectDetailRefreshInflight.get(projectId);
  if (existing) {
    return existing;
  }
  const promise = (async () => {
    const project = await findProject(projectId, {
      detailLevel: "api",
      skipWorkflowStateReconcile: true
    });
    if (!project) {
      return;
    }
    const runtime = await getRuntimeStatus();
    const requiredActions = buildProjectRequiredActions(project, runtime);
    const postCreatePrep = await resolveProjectPostCreatePrepState(project);
    if (postCreatePrep.required && !postCreatePrep.completed) {
      requiredActions.unshift(buildPostCreatePrepRequiredAction({
        missingItems: postCreatePrep.missingItems
      }));
    }
    const payload = {
      ...project,
      permissions: LEGACY_DEV_AUTH_BYPASS
        ? { projectRole: "owner", canApprove: true, canDelete: true, canEdit: true }
        : { projectRole: null, canApprove: false, canDelete: false, canEdit: false },
      requiredActions,
      postCreatePrep
    };
    projectDetailSnapshotCache.set(projectId, {
      updatedAt: Date.now(),
      value: payload
    });
  })().finally(() => {
    projectDetailRefreshInflight.delete(projectId);
  });
  projectDetailRefreshInflight.set(projectId, promise);
  return promise;
}

let projectDetailPrewarmStarted = false;
function scheduleProjectDetailPrewarm() {
  if (projectDetailPrewarmStarted || !PROJECT_DETAIL_PREWARM_ENABLED) {
    return;
  }
  projectDetailPrewarmStarted = true;
  const timer = setTimeout(() => {
    void (async () => {
      try {
        const candidates = await prisma.project.findMany({
          where: {
            status: { in: ["active", "blocked", "paused"] }
          },
          orderBy: [{ updatedAt: "desc" }],
          take: PROJECT_DETAIL_PREWARM_LIMIT,
          select: { id: true }
        });
        for (const item of candidates) {
          await refreshProjectDetailSnapshot(item.id);
        }
      } catch (error) {
        console.warn(
          "[project] detail prewarm failed:",
          error instanceof Error ? error.message : String(error)
        );
      }
    })();
  }, PROJECT_DETAIL_PREWARM_DELAY_MS);
  timer.unref?.();
}
scheduleProjectDetailPrewarm();
type LifecycleReplayJob = {
  id: string;
  projectId: string;
  status: "running" | "completed";
  startedAt: string;
  completedAt: string | null;
  attempted: Array<{ stageType: string; role: RoleType }>;
  succeeded: Array<{ stageType: string; role: RoleType }>;
  failed: Array<{ stageType: string; role: RoleType; reason: string }>;
  latestAudit?: unknown;
};
const lifecycleReplayJobs = new Map<string, LifecycleReplayJob>();

function sanitizeReplayReason(value: unknown) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const PROJECT_PREP_GITLAB_BASE_URL = String(process.env.GITLAB_BASE_URL || "https://gitlab.com")
  .trim()
  .replace(/\/+$/, "");
type CurrentUserLike = {
  id: string;
  role: string;
  name?: string;
  email?: string;
};
type ProjectPermissionSnapshot = {
  projectRole: ProjectRole | null;
  canApprove: boolean;
  canDelete: boolean;
  canEdit: boolean;
};
const LEGACY_DEV_AUTH_BYPASS = process.env.NODE_ENV !== "production";

type PostCreatePrepDraftLike = {
  discussion?: string;
  analysis?: string;
  rawRequirements?: string;
  prd?: string;
  debateSummary?: string;
  discussionTrace?: string;
  feedback?: string;
};

function parsePostCreatePrepDraft(body: unknown): PostCreatePrepDraftLike | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }
  const record = body as Record<string, unknown>;
  return {
    discussion: typeof record.discussion === "string" ? record.discussion : undefined,
    analysis: typeof record.analysis === "string" ? record.analysis : undefined,
    rawRequirements: typeof record.rawRequirements === "string" ? record.rawRequirements : undefined,
    prd: typeof record.prd === "string" ? record.prd : undefined,
    debateSummary: typeof record.debateSummary === "string" ? record.debateSummary : undefined,
    discussionTrace: typeof record.discussionTrace === "string" ? record.discussionTrace : undefined,
    feedback: typeof record.feedback === "string" ? record.feedback : undefined
  };
}

function hasPostCreatePrepDraftValue(draft: PostCreatePrepDraftLike | undefined) {
  if (!draft) {
    return false;
  }
  return [
    draft.discussion,
    draft.analysis,
    draft.rawRequirements,
    draft.prd,
    draft.debateSummary,
    draft.discussionTrace,
    draft.feedback
  ].some((item) => typeof item === "string");
}

function normalizePrepTraceMetaValue(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeRegExpForPrepTrace(value: string) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function upsertPrepDiscussionTraceMetaLine(source: string, key: string, value: unknown) {
  const normalizedKey = normalizePrepTraceMetaValue(key);
  if (!normalizedKey) {
    return String(source || "").trim();
  }
  const normalizedValue = normalizePrepTraceMetaValue(value);
  const linePattern = new RegExp(`(^|\\n)-\\s*${escapeRegExpForPrepTrace(normalizedKey)}:\\s*[^\\n]*(?=\\n|$)`, "i");
  let next = String(source || "").trim();
  if (!normalizedValue) {
    next = next.replace(linePattern, "").replace(/\n{3,}/g, "\n\n").trim();
    return next;
  }
  const nextLine = `- ${normalizedKey}: ${normalizedValue}`;
  if (linePattern.test(next)) {
    return next.replace(linePattern, `$1${nextLine}`).replace(/\n{3,}/g, "\n\n").trim();
  }
  const roundMarker = "\n## 讨论回合记录";
  if (next.includes(roundMarker)) {
    return next.replace(roundMarker, `\n${nextLine}${roundMarker}`).replace(/\n{3,}/g, "\n\n").trim();
  }
  return `${next}\n${nextLine}`.trim();
}

function upsertPrepDiscussionTraceMeta(source: string, fields: Record<string, unknown>) {
  return Object.entries(fields).reduce((acc, [key, value]) => {
    return upsertPrepDiscussionTraceMetaLine(acc, key, value);
  }, String(source || "").trim());
}

function buildPrepGitLabIssueUrl(projectPath: string, issueIid: number) {
  const normalizedPath = normalizePrepTraceMetaValue(projectPath);
  const normalizedIid = Number(issueIid);
  if (!normalizedPath || !Number.isInteger(normalizedIid) || normalizedIid <= 0) {
    return "";
  }
  return `${PROJECT_PREP_GITLAB_BASE_URL}/${normalizedPath}/-/issues/${normalizedIid}`;
}

function truncatePrepNoteBlock(value: unknown, maxLength = 1800) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "_未生成_";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(200, maxLength)).trim()}\n\n...（内容过长，已截断）`;
}

function getCurrentUserFromLocals(res: Response): CurrentUserLike | null {
  const raw = res.locals?.currentUser as Partial<CurrentUserLike> | undefined;
  const id = String(raw?.id || "").trim();
  const role = String(raw?.role || "").trim().toLowerCase();
  if (!id || !role) {
    return null;
  }
  return {
    id,
    role,
    name: typeof raw?.name === "string" ? raw.name : undefined,
    email: typeof raw?.email === "string" ? raw.email : undefined
  };
}

function sendForbidden(res: Response, message = "当前账号没有执行该操作的权限") {
  res.status(403).json({
    success: false,
    error: {
      code: "FORBIDDEN",
      message
    }
  });
}

async function buildProjectPermissions(projectId: string, user: CurrentUserLike): Promise<ProjectPermissionSnapshot> {
  const projectRole = await getProjectRole({
    projectId,
    userId: user.id
  });
  return {
    projectRole,
    canApprove: isPermissionAllowed({
      userRole: user.role,
      projectRole,
      permission: "approve"
    }),
    canDelete: isPermissionAllowed({
      userRole: user.role,
      projectRole,
      permission: "delete"
    }),
    canEdit: isPermissionAllowed({
      userRole: user.role,
      projectRole,
      permission: "edit"
    })
  };
}

function buildPostCreatePrepIssueNoteBody(input: {
  projectId: string;
  projectName: string;
  triggeredBy: string;
  draft: PostCreatePrepDraftLike | undefined;
}) {
  return [
    "### 创建后预备阶段 · 多Agent讨论回填",
    `- projectId: ${normalizePrepTraceMetaValue(input.projectId)}`,
    `- projectName: ${normalizePrepTraceMetaValue(input.projectName)}`,
    `- triggeredBy: ${normalizePrepTraceMetaValue(input.triggeredBy || "projects_route_manual_trigger")}`,
    `- generatedAt: ${new Date().toISOString()}`,
    "",
    "#### 多Agent讨论结论",
    truncatePrepNoteBlock(input.draft?.discussion),
    "",
    "#### 项目详情理解确认草案",
    truncatePrepNoteBlock(input.draft?.analysis),
    "",
    "#### 核心输入回填摘要",
    `- rawRequirements: ${truncatePrepNoteBlock(input.draft?.rawRequirements, 800)}`,
    `- prd: ${truncatePrepNoteBlock(input.draft?.prd, 800)}`,
    `- debateSummary: ${truncatePrepNoteBlock(input.draft?.debateSummary, 800)}`
  ].join("\n");
}

function normalizeStringArrayInput(input: unknown) {
  if (!Array.isArray(input)) {
    return [] as string[];
  }
  return input
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function normalizeProjectType(input: unknown) {
  const normalized = String(input ?? "").trim().toLowerCase();
  if (normalized === "standalone" || normalized === "relay") {
    return normalized as "standalone" | "relay";
  }
  return "complete" as const;
}

function isProjectModeTemplateCompatible(input: {
  projectType: "complete" | "standalone" | "relay";
  workflowTemplateKey: unknown;
}) {
  const normalizedTemplateKey = String(input.workflowTemplateKey ?? "").trim().toLowerCase();
  const templateKey = normalizedTemplateKey || "standard_software_development";
  if (input.projectType === "complete") {
    return templateKey === "standard_software_development"
      || templateKey === "full"
      || templateKey === "lean"
      || templateKey === "maintenance"
      || templateKey === "none";
  }
  return templateKey === "none"
    || templateKey === "requirements_design"
    || templateKey === "visual_design"
    || templateKey === "tech_design"
    || templateKey === "code_dev"
    || templateKey === "qa_acceptance";
}

function normalizeProjectInputs(input: unknown) {
  type NormalizedProjectInput = {
    name: string;
    type: string;
    description?: string;
    content?: string;
    filePath?: string;
    referenceDeliverableId?: string;
    inputSource?: "manual" | "imported_from_project" | "template_generated";
  };

  if (!Array.isArray(input)) {
    return [] as NormalizedProjectInput[];
  }
  return input.reduce<NormalizedProjectInput[]>((acc, item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return acc;
      }
      const record = item as Record<string, unknown>;
      const name = String(record.name ?? "").trim();
      if (!name) {
        return acc;
      }
      const sourceRaw = String(record.inputSource ?? "").trim();
      const inputSource = sourceRaw === "imported_from_project" || sourceRaw === "template_generated"
        ? sourceRaw
        : "manual";
      acc.push({
        name,
        type: String(record.type ?? "").trim() || "document",
        description: String(record.description ?? "").trim() || undefined,
        content: String(record.content ?? "").trim() || undefined,
        filePath: String(record.filePath ?? "").trim() || undefined,
        referenceDeliverableId: String(record.referenceDeliverableId ?? "").trim() || undefined,
        inputSource: inputSource as "manual" | "imported_from_project" | "template_generated"
      });
      return acc;
    }, []);
}

function normalizeStatusFilter(input: unknown) {
  const allowed = new Set(["active", "paused", "blocked", "completed"]);
  const values = normalizeStringArrayInput(input).map((item) => item.toLowerCase());
  return new Set(values.filter((item) => allowed.has(item)));
}

function parseRepairLimit(input: unknown) {
  const value = Number(input);
  if (!Number.isFinite(value)) {
    return QUALITY_GATE_REPAIR_DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(300, Math.floor(value)));
}

function resolveEntryNodeIdsFromGraph(graphValue: unknown) {
  const graph = graphValue && typeof graphValue === "object" && !Array.isArray(graphValue)
    ? graphValue as { nodes?: Array<{ id?: unknown }>; edges?: Array<{ to?: unknown }> }
    : {};
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const targets = new Set(edges.map((edge) => String(edge?.to ?? "").trim()).filter(Boolean));
  return nodes
    .map((node) => String(node?.id ?? "").trim())
    .filter((nodeId) => nodeId && !targets.has(nodeId));
}

async function syncProjectInputsToLatestWorkflow(projectId: string) {
  const workflow = await prisma.workflow.findFirst({
    where: { projectId },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      stageGraph: true
    }
  });
  if (!workflow) {
    return;
  }
  const entryNodeIds = resolveEntryNodeIdsFromGraph(workflow.stageGraph);
  if (entryNodeIds.length === 0) {
    return;
  }
  await bindProjectInputsToWorkflowEntryStages({
    workflowId: workflow.id,
    projectId,
    entryNodeIds
  });
}

function shouldSyncProjectInputsSynchronously() {
  const fallback = process.env.NODE_ENV === "test" ? "true" : "false";
  return String(process.env.PROJECT_INPUT_SYNC_SYNC ?? fallback).trim().toLowerCase() === "true";
}

function scheduleProjectInputSync(projectId: string, reason: string) {
  if (shouldSyncProjectInputsSynchronously()) {
    return syncProjectInputsToLatestWorkflow(projectId);
  }
  void syncProjectInputsToLatestWorkflow(projectId).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[project] async input sync failed for ${projectId} (${reason}): ${message}`);
  });
  return Promise.resolve();
}

async function buildProjectQualityGateRepairResult(input: {
  projectId: string;
  dryRun: boolean;
  projectPath?: string;
  validationCommands: string[];
}) {
  const project = await findProject(input.projectId);
  if (!project) {
    return {
      projectId: input.projectId,
      status: "not_found" as const,
      blockingStageCount: 0,
      created: [] as Array<{ stageType: string; stageLabel: string; issueIid: number; issueUrl: string; marker: string }>,
      reused: [] as Array<{ stageType: string; stageLabel: string; issueIid: number; issueUrl: string; marker: string }>,
      failed: [] as Array<{ stageType: string; stageLabel: string; reason: string }>
    };
  }

  const lifecycleAudit = await getProjectLifecycleQualityAudit(project.id);
  if (!lifecycleAudit) {
    return {
      projectId: project.id,
      projectName: project.name,
      status: "audit_unavailable" as const,
      blockingStageCount: 0,
      created: [] as Array<{ stageType: string; stageLabel: string; issueIid: number; issueUrl: string; marker: string }>,
      reused: [] as Array<{ stageType: string; stageLabel: string; issueIid: number; issueUrl: string; marker: string }>,
      failed: [] as Array<{ stageType: string; stageLabel: string; reason: string }>
    };
  }

  const blockingStages = lifecycleAudit.stageAudits.filter((stage) => !stage.pass);
  const stagePlans = blockingStages.map((stage) => ({
    stageType: stage.stageType,
    stageLabel: QUALITY_GATE_REPAIR_STAGE_LABELS[stage.stageType] || stage.stageLabel || stage.stageType,
    stageStatus: stage.stageStatus,
    stageIssues: stage.issues || []
  }));

  const created: Array<{ stageType: string; stageLabel: string; issueIid: number; issueUrl: string; marker: string }> = [];
  const reused: Array<{ stageType: string; stageLabel: string; issueIid: number; issueUrl: string; marker: string }> = [];
  const failed: Array<{ stageType: string; stageLabel: string; reason: string }> = [];

  if (!input.dryRun) {
    for (const stage of stagePlans) {
      const result = await upsertQualityGateRepairIssue({
        projectId: project.id,
        projectName: project.name,
        stageType: stage.stageType,
        stageLabel: stage.stageLabel,
        stageStatus: stage.stageStatus,
        currentStage: lifecycleAudit.currentStage,
        stageIssues: stage.stageIssues,
        validationCommands: input.validationCommands,
        projectPath: input.projectPath
      });
      if (!result.ok) {
        failed.push({
          stageType: stage.stageType,
          stageLabel: stage.stageLabel,
          reason: result.message
        });
        continue;
      }
      const record = {
        stageType: stage.stageType,
        stageLabel: stage.stageLabel,
        issueIid: result.data.issueIid,
        issueUrl: result.data.issueUrl,
        marker: result.data.marker
      };
      if (result.data.action === "created") {
        created.push(record);
      } else {
        reused.push(record);
      }
    }
  }

  return {
    projectId: project.id,
    projectName: project.name,
    status: "ok" as const,
    pass: lifecycleAudit.pass,
    blockingStageCount: blockingStages.length,
    blockingStages: stagePlans,
    dryRun: input.dryRun,
    created,
    reused,
    failed
  };
}

function formatTerminalCollaborationViolation(message: string) {
  const normalized = String(message || "").trim();
  const match = normalized.match(/TERMINAL_COLLAB_PROTOCOL_VIOLATION:\s*missing_fields=([^;]+);\s*section=([a-z]+)/i);
  if (!match) {
    return "";
  }

  const rawFields = String(match[1] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const labelMap: Record<string, string> = {
    factsConfirmed: "factsConfirmed（已确认事实）",
    assumptions: "assumptions（当前假设）",
    decisions: "decisions（已做决策）",
    handoff: "handoff（交给下游 Agent 的明确输入与动作）",
    openQuestions: "openQuestions（待确认问题或风险空白）"
  };
  const formattedFields = rawFields.map((field) => labelMap[field] || field).join("、");
  const sectionState = String(match[2] || "").toLowerCase() === "present"
    ? "已检测到协作交接卡区块，但字段未填写完整"
    : "未检测到完整协作交接卡区块";
  return `最新执行未通过协作交接卡协议：${sectionState}，缺少字段 ${formattedFields || "unknown"}。请补齐 factsConfirmed / assumptions / decisions / handoff / openQuestions 后重试。`;
}

function buildExecutionProtocolFailureDiagnostics(input: {
  rawMessage: string;
  protocolGatePrecheck?: ExecutionProtocolPrecheckRecord;
}): ExecutionProtocolFailureDiagnostics {
  const rawMessage = String(input.rawMessage || "").trim();
  const upper = rawMessage.toUpperCase();
  const categories = new Set<ExecutionProtocolFailureCategory>();

  if (
    upper.includes("REAL_MODEL_GATE_FAILED")
    || upper.includes("MODEL_ATTEMPT_TIMEOUT")
    || upper.includes("REQUEST_TIMEOUT")
    || upper.includes("ETIMEDOUT")
    || upper.includes("ECONNRESET")
    || upper.includes("EAI_AGAIN")
    || upper.includes("RUNTIME")
  ) {
    categories.add("runtime_or_model");
  }
  if (upper.includes("TERMINAL_COLLAB_PROTOCOL_VIOLATION")) {
    categories.add("collaboration");
  }
  if (upper.includes("STAGE_TEMPLATE_VALIDATION_FAILED")) {
    categories.add("stage_template");
  }

  const precheck = input.protocolGatePrecheck;
  const missingChecks: ExecutionProtocolFailureMissingCheck[] = [];
  const blockingIssues = Array.isArray(precheck?.blockingIssues)
    ? precheck.blockingIssues.filter((item) => String(item || "").trim().length > 0)
    : [];

  for (const check of precheck?.protocolChecks || []) {
    if (check.passed) {
      continue;
    }
    if (check.category === "collaboration") {
      categories.add("collaboration");
    } else if (check.category === "skill") {
      categories.add("skill_evidence");
    } else {
      categories.add("content_evidence");
    }
    missingChecks.push({
      source: "protocol",
      key: check.key,
      label: check.label,
      detail: check.detail
    });
  }

  for (const check of precheck?.contentChecks || []) {
    if (check.passed) {
      continue;
    }
    categories.add("content_evidence");
    missingChecks.push({
      source: "content",
      key: check.key,
      label: check.label
    });
  }

  for (const issue of blockingIssues.slice(0, 4)) {
    const normalizedIssue = String(issue || "").trim();
    if (!normalizedIssue) {
      continue;
    }
    if (/真实模型|model|runtime|超时|timeout|连接/i.test(normalizedIssue)) {
      categories.add("runtime_or_model");
    } else if (/模板|template/i.test(normalizedIssue)) {
      categories.add("stage_template");
    } else if (/协作|交接|collab/i.test(normalizedIssue)) {
      categories.add("collaboration");
    } else {
      categories.add("content_evidence");
    }
    missingChecks.push({
      source: "blocking",
      key: `blocking-${missingChecks.length + 1}`,
      label: "阻断项",
      detail: normalizedIssue
    });
  }

  const uniqueMissingChecks: ExecutionProtocolFailureMissingCheck[] = [];
  const dedupeSet = new Set<string>();
  for (const item of missingChecks) {
    const dedupeKey = `${item.source}|${item.key}|${item.label}|${item.detail || ""}`;
    if (dedupeSet.has(dedupeKey)) {
      continue;
    }
    dedupeSet.add(dedupeKey);
    uniqueMissingChecks.push(item);
  }

  const categoryOrder: ExecutionProtocolFailureCategory[] = [
    "runtime_or_model",
    "collaboration",
    "skill_evidence",
    "content_evidence",
    "stage_template",
    "unknown"
  ];
  const orderedCategories = categoryOrder.filter((category) => categories.has(category));

  const primaryCategory = orderedCategories[0] || "unknown";
  const summaryByCategory: Record<ExecutionProtocolFailureCategory, string> = {
    runtime_or_model: "执行协议门禁未通过：模型/运行时链路存在异常，请先修复运行时配置后重试。",
    collaboration: "执行协议门禁未通过：多 Agent 协作交接卡不完整，请补齐交接字段并重试。",
    skill_evidence: "执行协议门禁未通过：缺少阶段要求的技能调用证据，请补齐对应技能输出。",
    content_evidence: "执行协议门禁未通过：交付物缺少关键执行证据（代码路径/命令验证/结果）。",
    stage_template: "执行协议门禁未通过：当前交付物模板结构不完整，请先补齐模板章节与检查项。",
    unknown: "执行协议门禁未通过：请先根据缺失检查项补齐证据后再重试。"
  };

  return {
    primaryCategory,
    categories: orderedCategories.length > 0
      ? orderedCategories
      : (["unknown"] as ExecutionProtocolFailureCategory[]),
    summary: summaryByCategory[primaryCategory],
    missingChecks: uniqueMissingChecks.slice(0, 8),
    blockingIssues
  };
}

const EXECUTION_PROTOCOL_FALLBACK_ACTION_ORDER: ProjectRequiredAction["action"][] = [
  "submit_stage_deliverable",
  "reconcile_deliverables",
  "resolve_blocked_tasks",
  "review_pending_stage",
  "refresh_runtime"
];

const EXECUTION_PROTOCOL_ACTION_ORDER: Record<
  ExecutionProtocolFailureCategory,
  ProjectRequiredAction["action"][]
> = {
  runtime_or_model: [
    "refresh_runtime",
    "submit_stage_deliverable",
    "reconcile_deliverables",
    "resolve_blocked_tasks",
    "review_pending_stage"
  ],
  collaboration: [
    "submit_stage_deliverable",
    "reconcile_deliverables",
    "resolve_blocked_tasks",
    "review_pending_stage",
    "refresh_runtime"
  ],
  skill_evidence: [
    "submit_stage_deliverable",
    "reconcile_deliverables",
    "review_pending_stage",
    "refresh_runtime",
    "resolve_blocked_tasks"
  ],
  content_evidence: [
    "submit_stage_deliverable",
    "reconcile_deliverables",
    "resolve_blocked_tasks",
    "review_pending_stage",
    "refresh_runtime"
  ],
  stage_template: [
    "reconcile_deliverables",
    "submit_stage_deliverable",
    "review_pending_stage",
    "resolve_blocked_tasks",
    "refresh_runtime"
  ],
  unknown: EXECUTION_PROTOCOL_FALLBACK_ACTION_ORDER
};

function buildExecutionProtocolRecoveryActions(input: {
  project: ProjectRecord;
  requiredActions: ProjectRequiredAction[];
  diagnostics: ExecutionProtocolFailureDiagnostics;
}) {
  const base = buildRealModelGateRecoveryActions({
    project: input.project,
    requiredActions: input.requiredActions
  });
  const order = EXECUTION_PROTOCOL_ACTION_ORDER[input.diagnostics.primaryCategory] || REAL_MODEL_GATE_ACTION_ORDER;
  const rank = new Map(order.map((action, index) => [action, index]));

  const withFallback = [...base.requiredActions];
  if (input.diagnostics.primaryCategory === "runtime_or_model") {
    if (!withFallback.some((item) => item.action === "refresh_runtime")) {
      withFallback.unshift(createFallbackRequiredAction("refresh_runtime", input.project));
    }
  } else if (!withFallback.some((item) => item.action === "submit_stage_deliverable")) {
    withFallback.unshift(createFallbackRequiredAction("submit_stage_deliverable", input.project));
  }
  if (!withFallback.some((item) => item.action === "review_pending_stage")) {
    withFallback.push(createFallbackRequiredAction("review_pending_stage", input.project));
  }

  const ordered = [...withFallback]
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftRank = rank.has(left.item.action) ? Number(rank.get(left.item.action)) : 99;
      const rightRank = rank.has(right.item.action) ? Number(rank.get(right.item.action)) : 99;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.item);

  const deduped: ProjectRequiredAction[] = [];
  const seen = new Set<ProjectRequiredAction["action"]>();
  for (const action of ordered) {
    if (seen.has(action.action)) {
      continue;
    }
    seen.add(action.action);
    deduped.push(action);
  }

  return {
    requiredActions: deduped,
    recoveryPlan: deduped.map((action, index) => ({
      step: index + 1,
      action: action.action,
      title: action.title
    }))
  };
}

/**
 * @openapi
 * /api/projects/parse:
 *   post:
 *     tags: [Projects]
 *     summary: 解析自然语言需求并生成项目草案
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProjectParsePayload'
 *     responses:
 *       200:
 *         description: 解析成功
 *       400:
 *         $ref: '#/components/responses/Validation400'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *
 * /api/projects/preview:
 *   post:
 *     tags: [Projects]
 *     summary: 预览需求解析意图
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [description]
 *             properties:
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: 预览成功
 *       400:
 *         $ref: '#/components/responses/Validation400'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *
 * /api/projects:
 *   get:
 *     tags: [Projects]
 *     summary: 查询项目列表
 *     responses:
 *       200:
 *         description: 项目列表
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *   post:
 *     tags: [Projects]
 *     summary: 创建项目
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProjectCreatePayload'
 *     responses:
 *       201:
 *         description: 创建成功
 *       400:
 *         $ref: '#/components/responses/Validation400'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *
 * /api/projects/cleanup/candidates:
 *   get:
 *     tags: [Projects]
 *     summary: 查询可清理项目候选
 *     responses:
 *       200:
 *         description: 候选列表
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *
 * /api/projects/cleanup:
 *   post:
 *     tags: [Projects]
 *     summary: 执行项目清理
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProjectCleanupPayload'
 *     responses:
 *       200:
 *         description: 清理结果
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       409:
 *         $ref: '#/components/responses/Conflict409'
 *
 * /api/projects/automation:
 *   get:
 *     tags: [Projects]
 *     summary: 查询自动推进配置状态
 *     responses:
 *       200:
 *         description: 自动推进状态
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *   put:
 *     tags: [Projects]
 *     summary: 更新自动推进配置
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProjectAutomationPayload'
 *     responses:
 *       200:
 *         description: 更新成功
 *       400:
 *         $ref: '#/components/responses/Validation400'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *
 * /api/projects/automation/run:
 *   post:
 *     tags: [Projects]
 *     summary: 手动触发自动推进执行一轮
 *     responses:
 *       200:
 *         description: 触发成功
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       409:
 *         $ref: '#/components/responses/Conflict409'
 *
 * /api/projects/{id}:
 *   get:
 *     tags: [Projects]
 *     summary: 查询项目详情
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 项目详情
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *   delete:
 *     tags: [Projects]
 *     summary: 删除项目
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 删除成功
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/projects/{id}/advance:
 *   post:
 *     tags: [Projects]
 *     summary: 推进项目执行一轮
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       409:
 *         $ref: '#/components/responses/Conflict409'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/projects/{id}/reconcile-deliverables:
 *   post:
 *     tags: [Projects]
 *     summary: 重新对齐项目交付物
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 对齐完成
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/projects/{id}/executions:
 *   get:
 *     tags: [Projects]
 *     summary: 查询项目执行记录
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: 执行记录列表
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/projects/{id}/acceptance-report:
 *   get:
 *     tags: [Projects]
 *     summary: 查询验收报告
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 验收报告
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/projects/{id}/acceptance-report.md:
 *   get:
 *     tags: [Projects]
 *     summary: 下载验收报告 Markdown
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Markdown 内容
 *         content:
 *           text/markdown:
 *             schema:
 *               type: string
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         description: 项目不存在
 *
 * /api/projects/{id}/acceptance-report/archive:
 *   post:
 *     tags: [Projects]
 *     summary: 归档验收报告
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *     responses:
 *       200:
 *         description: 归档成功
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/projects/{id}/final-artifacts:
 *   get:
 *     tags: [Projects]
 *     summary: 查询最终交付物报告
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: generate
 *         schema:
 *           type: string
 *           enum: [auto, false]
 *     responses:
 *       200:
 *         description: 最终交付物状态
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/projects/{id}/final-artifacts/generate:
 *   post:
 *     tags: [Projects]
 *     summary: 触发最终交付物异步生成
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               force:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: 已排队
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/projects/{id}/final-artifacts/job:
 *   get:
 *     tags: [Projects]
 *     summary: 查询最终交付物最新任务进度
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 任务进度
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/projects/{id}/final-artifacts/jobs/{jobId}:
 *   get:
 *     tags: [Projects]
 *     summary: 查询指定最终交付物任务
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 任务详情
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/projects/{id}/official-site:
 *   get:
 *     tags: [Projects]
 *     summary: 获取官网产物链接
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 官网产物
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *       409:
 *         $ref: '#/components/responses/Conflict409'
 *
 * /api/projects/{id}/tasks:
 *   get:
 *     tags: [Projects]
 *     summary: 查询项目任务列表
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 任务列表
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *
 * /api/tasks:
 *   get:
 *     tags: [Projects]
 *     summary: 查询全部任务列表
 *     responses:
 *       200:
 *         description: 任务列表
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *
 * /api/projects/{id}/approve:
 *   post:
 *     tags: [Projects]
 *     summary: 审批通过当前阶段
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 审批通过
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *       409:
 *         $ref: '#/components/responses/Conflict409'
 *       422:
 *         $ref: '#/components/responses/Unprocessable422'
 *
 * /api/projects/{id}/reject:
 *   post:
 *     tags: [Projects]
 *     summary: 驳回当前阶段
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/StageRejectPayload'
 *     responses:
 *       200:
 *         description: 驳回成功
 *       400:
 *         $ref: '#/components/responses/Validation400'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *       409:
 *         $ref: '#/components/responses/Conflict409'
 *
 * /api/projects/{id}/intervene:
 *   post:
 *     tags: [Projects]
 *     summary: 人工强制介入
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InterventionPayload'
 *     responses:
 *       200:
 *         description: 介入成功
 *       400:
 *         $ref: '#/components/responses/Validation400'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/projects/{id}/resume:
 *   post:
 *     tags: [Projects]
 *     summary: 恢复项目执行
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 恢复成功
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/projects/{id}/close:
 *   post:
 *     tags: [Projects]
 *     summary: 关闭项目
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 关闭成功
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/projects/{id}/stages/submit:
 *   post:
 *     tags: [Projects]
 *     summary: 提交阶段交付物
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/StageSubmitPayload'
 *     responses:
 *       200:
 *         description: 提交成功
 *       400:
 *         $ref: '#/components/responses/Validation400'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *       422:
 *         $ref: '#/components/responses/Unprocessable422'
 *
 * /api/projects/{id}/messages:
 *   post:
 *     tags: [Projects]
 *     summary: 向项目发送消息
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProjectMessagePayload'
 *     responses:
 *       200:
 *         description: 发送成功
 *       400:
 *         $ref: '#/components/responses/Validation400'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/tasks/{taskId}:
 *   patch:
 *     tags: [Projects]
 *     summary: 更新任务状态
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TaskPatchPayload'
 *     responses:
 *       200:
 *         description: 更新成功
 *       400:
 *         $ref: '#/components/responses/Validation400'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/projects/{id}/live:
 *   get:
 *     tags: [Projects]
 *     summary: 订阅项目实时输出流（SSE）
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: SSE event-stream
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         description: 项目不存在
 */
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

type ProjectRecord = NonNullable<Awaited<ReturnType<typeof findProject>>>;
type ExecutionProtocolPrecheckRecord = NonNullable<Awaited<ReturnType<typeof getProjectExecutionProtocolPrecheck>>>;
type ExecutionProtocolFailureCategory =
  | "runtime_or_model"
  | "collaboration"
  | "skill_evidence"
  | "content_evidence"
  | "stage_template"
  | "unknown";
type ExecutionProtocolFailureMissingCheck = {
  source: "protocol" | "content" | "blocking";
  key: string;
  label: string;
  detail?: string;
};
type ExecutionProtocolFailureDiagnostics = {
  primaryCategory: ExecutionProtocolFailureCategory;
  categories: ExecutionProtocolFailureCategory[];
  summary: string;
  missingChecks: ExecutionProtocolFailureMissingCheck[];
  blockingIssues: string[];
};

type ProjectAutomationState = {
  enabled: boolean;
  autoApproveWhenReady: boolean;
  intervalMs: number;
  running: boolean;
  lastRunAt: string | null;
  lastError: string | null;
  lastSummary: string;
};

type FinalArtifactsJobState = {
  jobId: string;
  projectId: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  step: string;
  message?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  report?: unknown;
  officialSite?: {
    url: string;
    filePath?: string;
  };
};

interface CreateProjectsRouterOptions {
  asyncRoute: (
    handler: (req: express.Request, res: express.Response) => Promise<void>
  ) => express.RequestHandler;
  safeAudit: (
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
  ) => Promise<void>;
  sendEvent: (res: express.Response, event: string, data: unknown) => void;
  splitScript: (input: string, size: number) => string[];
  projectAutomationState: ProjectAutomationState;
  restartProjectAutomationTicker: () => void;
  runProjectAutomationTick: (options?: { force?: boolean }) => Promise<void>;
  kickProjectAutomationTick: (options?: { force?: boolean }) => void;
  projectAdvanceLocks: Set<string>;
  projectAdvanceJobs: Map<string, Promise<void>>;
  projectAdvanceJobErrors: Map<string, { message: string; at: string }>;
  projectAdvanceStates: Map<string, {
    projectId: string;
    status: string;
    updatedAt: string;
    startedAt?: string;
    finishedAt?: string;
    attempt?: number;
    message?: string;
    lastError?: string;
    lastErrorAt?: string;
  }>;
  markProjectAdvanceCancelled: (projectId: string) => void;
  clearProjectAdvanceCancelled: (projectId: string) => void;
  ensureManualAdvanceJob: (projectId: string) => void;
  buildProjectRequiredActions: (project: any, runtime: any) => ProjectRequiredAction[];
  formatRequiredActionsMessage: (actions: ProjectRequiredAction[]) => string;
  buildProjectAcceptanceReport: (
    project: any,
    options?: {
      executions?: Array<{
        role: string;
        status: string;
        model?: string | null;
        provider?: string | null;
        createdAt: string;
        updatedAt: string;
      }>;
      lifecycleAudit?: {
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
    }
  ) => any;
  renderAcceptanceReportMarkdown: (report: any) => string;
  getLatestFinalArtifactsJob: (projectId: string) => any;
  startFinalArtifactsGenerationJob: (projectId: string, options?: { force?: boolean }) => any;
  buildProjectFinalArtifactsReport: (project: any, officialSite?: any, executions?: any) => any;
  attachFinalArtifactsGeneration: (report: any, job?: any) => any;
  toFinalArtifactsJobProgress: (job?: any) => any;
  finalArtifactsJobsById: Map<string, any>;
}

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
  ROLE_AUDITOR: "巡检治理",
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

const GITLAB_HARNESS_SYNC_STAGES = new Set(["DEV", "ACCEPT"]);
const PROJECT_ADVANCE_POLL_MIN_MS = 2000;
const PROJECT_ADVANCE_POLL_MAX_MS = 20000;
const PROJECT_ADVANCE_STORM_THRESHOLD = Math.max(
  4,
  Number(process.env.PROJECT_ADVANCE_STORM_THRESHOLD ?? 6)
);
const PROJECT_ADVANCE_STALE_JOB_MS = Math.max(
  30_000,
  Number(process.env.PROJECT_ADVANCE_STALE_JOB_MS ?? 45_000)
);
const PROJECT_ADVANCE_RECOVERY_COOLDOWN_MS = Math.max(
  20_000,
  Number(process.env.PROJECT_ADVANCE_RECOVERY_COOLDOWN_MS ?? 45_000)
);
const projectAdvancePollHints = new Map<string, {
  pollAfterMs: number;
  lastAt: number;
  inProgressCount: number;
  lastRecoveryAt?: number;
}>();

function resetProjectAdvancePollHint(projectId: string) {
  projectAdvancePollHints.delete(projectId);
}

function nextProjectAdvancePollAfterMs(projectId: string, recovering = false) {
  const now = Date.now();
  const existing = projectAdvancePollHints.get(projectId);
  const stale = !existing || now - existing.lastAt > 60_000;
  const base = stale
    ? (recovering ? 3500 : PROJECT_ADVANCE_POLL_MIN_MS)
    : existing.pollAfterMs;
  const next = Math.min(
    PROJECT_ADVANCE_POLL_MAX_MS,
    Math.max(
      PROJECT_ADVANCE_POLL_MIN_MS,
      Math.round(base * (recovering ? 1.45 : 1.3) + (recovering ? 350 : 120))
    )
  );
  const inProgressCount = stale ? 1 : existing.inProgressCount + 1;
  projectAdvancePollHints.set(projectId, {
    pollAfterMs: next,
    lastAt: now,
    inProgressCount,
    lastRecoveryAt: existing?.lastRecoveryAt
  });
  return next;
}

function markProjectAdvanceRecovery(projectId: string) {
  const existing = projectAdvancePollHints.get(projectId);
  if (!existing) {
    projectAdvancePollHints.set(projectId, {
      pollAfterMs: PROJECT_ADVANCE_POLL_MIN_MS,
      lastAt: Date.now(),
      inProgressCount: 1,
      lastRecoveryAt: Date.now()
    });
    return;
  }
  projectAdvancePollHints.set(projectId, {
    ...existing,
    lastRecoveryAt: Date.now()
  });
}

function tryRecoverStalledAdvanceJob(input: {
  projectId: string;
  hasLock: boolean;
  hasJob: boolean;
  ensureManualAdvanceJob: (projectId: string) => void;
  projectAdvanceLocks: Set<string>;
  projectAdvanceJobs: Map<string, Promise<void>>;
}) {
  if (!input.hasJob && !input.hasLock) {
    return false;
  }

  const hint = projectAdvancePollHints.get(input.projectId);
  if (!hint) {
    return false;
  }

  const now = Date.now();
  const storming = hint.inProgressCount >= PROJECT_ADVANCE_STORM_THRESHOLD;
  const stale = now - hint.lastAt >= PROJECT_ADVANCE_STALE_JOB_MS;
  const cooldownReady = !hint.lastRecoveryAt
    || now - hint.lastRecoveryAt >= PROJECT_ADVANCE_RECOVERY_COOLDOWN_MS;
  if (!cooldownReady || (!storming && !stale)) {
    return false;
  }

  input.projectAdvanceJobs.delete(input.projectId);
  input.projectAdvanceLocks.delete(input.projectId);
  input.ensureManualAdvanceJob(input.projectId);
  markProjectAdvanceRecovery(input.projectId);
  return true;
}

function isRecoverableAdvanceFailure(message: string) {
  const normalized = String(message || "").toUpperCase();
  if (normalized.includes("REAL_MODEL_GATE_FAILED")) {
    // 门禁失败通常需要人工修复运行时配置或链路，不应进入无限自动重试。
    return false;
  }
  return normalized.includes("MODEL_ATTEMPT_TIMEOUT")
    || normalized.includes("REQUEST_TIMEOUT")
    || normalized.includes("ETIMEDOUT")
    || normalized.includes("ECONNRESET")
    || normalized.includes("EAI_AGAIN")
    || normalized.includes("STAGE_TEMPLATE_VALIDATION_FAILED");
}

const REAL_MODEL_GATE_ACTION_ORDER: ProjectRequiredAction["action"][] = [
  "refresh_runtime",
  "submit_stage_deliverable",
  "reconcile_deliverables",
  "open_design_review",
  "resolve_blocked_tasks",
  "review_pending_stage"
];

function hasApprovedDesignReview(content: string) {
  const source = String(content || "");
  return source.includes("## 设计审查卡") && /审查结论:\s*通过/.test(source);
}

function hasVisualDesignPreview(content: string) {
  const source = String(content || "");
  return /```html[\s\S]*?```/i.test(source)
    || /<!doctype html/i.test(source)
    || /<html[\s>]/i.test(source)
    || /!\[[^\]]*\]\((https?:\/\/|data:image\/)/i.test(source);
}

async function resolveProjectPostCreatePrepState(project: ProjectRecord) {
  return evaluateProjectPostCreatePrepStatus({
    projectId: project.id,
    description: project.description,
    projectInputs: project.projectInputs,
    projectType: project.projectType
  });
}

function buildPostCreatePrepRequiredAction(input: {
  missingItems: string[];
}): ProjectRequiredAction {
  const requiresConfirmOnly = input.missingItems.length > 0
    && input.missingItems.every((item) => item === "用户确认预备内容");
  return {
    id: "post-create-prep-required",
    severity: "critical",
    title: "项目尚未完成需求分析与多Agent决策预备",
    detail: requiresConfirmOnly
      ? "草案已生成，但仍需人工确认通过后才能进入正式项目详情页。"
      : (input.missingItems.length > 0
        ? `缺失项：${input.missingItems.join("；")}。请先执行“创建后需求预备”再推进阶段。`
        : "请先执行“创建后需求预备”再推进阶段。"),
    action: "run_post_create_prep",
    ctaLabel: requiresConfirmOnly ? "前往预备阶段确认" : "执行创建后需求预备"
  };
}

function createFallbackRequiredAction(
  action: ProjectRequiredAction["action"],
  project: ProjectRecord
): ProjectRequiredAction {
  const stageLabel = String(project.currentStage || "当前阶段");
  switch (action) {
    case "refresh_runtime":
      return {
        id: "real-model-gate-repair",
        severity: "critical",
        title: "当前阶段未通过真实模型门禁",
        detail: "请修复模型通道（API Key / Base URL / 可用模型）并重新执行本阶段，再进行验收。",
        action: "refresh_runtime",
        ctaLabel: "修复模型通道"
      };
    case "submit_stage_deliverable":
      return {
        id: "missing-stage-deliverable",
        severity: "critical",
        title: "当前阶段缺少交付物",
        detail: `请先补齐 ${stageLabel} 的交付物后，再重新执行阶段验收。`,
        action: "submit_stage_deliverable",
        ctaLabel: "自动生成当前阶段交付物"
      };
    case "reconcile_deliverables":
      return {
        id: "reconcile-stage-deliverables",
        severity: "warning",
        title: "请重建当前阶段交付物",
        detail: "建议先执行一次交付物重建，补齐模板章节与执行证据，再重新验收。",
        action: "reconcile_deliverables",
        ctaLabel: "重建交付物内容"
      };
    case "open_design_review":
      return {
        id: "design-review-required",
        severity: "critical",
        title: "设计阶段缺少可确认设计审查产物",
        detail: "请补充并通过设计审查卡，同时提供静态图或单页 HTML 视觉稿后再验收。",
        action: "open_design_review",
        ctaLabel: "提交设计审查卡"
      };
    case "resolve_blocked_tasks":
      return {
        id: "blocked-tasks",
        severity: "warning",
        title: "当前阶段存在阻塞任务",
        detail: "请先解除阻塞任务，再继续验收流程。",
        action: "resolve_blocked_tasks",
        ctaLabel: "前往处理阻塞任务"
      };
    case "review_pending_stage":
    default:
      return {
        id: "review-pending-stage",
        severity: "info",
        title: "完成修复后请重新执行阶段验收",
        detail: "以上修复动作完成后，请重新点击通过/驳回，完成当前阶段确认。",
        action: "review_pending_stage",
        ctaLabel: "执行阶段验收"
      };
  }
}

function buildRealModelGateRecoveryActions(input: {
  project: ProjectRecord;
  requiredActions: ProjectRequiredAction[];
}) {
  const requiredByAction = new Map<ProjectRequiredAction["action"], ProjectRequiredAction>();
  for (const action of input.requiredActions) {
    if (!requiredByAction.has(action.action)) {
      requiredByAction.set(action.action, action);
    }
  }

  const currentStageDeliverables = input.project.deliverables
    .filter((item) => item.stageType === input.project.currentStage)
    .sort((left, right) => right.version - left.version);
  const missingStageDeliverables = currentStageDeliverables.length === 0;
  const hasDesignReview = input.project.currentStage === "DESIGN"
    && currentStageDeliverables.some((item) => hasApprovedDesignReview(String(item.content || "")));
  const hasVisualPreview = input.project.currentStage === "DESIGN"
    && currentStageDeliverables.some((item) =>
      /视觉定稿|视觉设计稿|单页预览|mockup|wireframe|preview\.html/i.test(String(item.name || ""))
      && hasVisualDesignPreview(String(item.content || ""))
    );
  const designInterventionRequired = getDesignInterventionSignal(input.project).required;
  const hasBlockedTasks = input.project.tasks.some(
    (task) => task.stageType === input.project.currentStage && task.status === "blocked"
  );

  const needAction = (action: ProjectRequiredAction["action"]) => {
    if (action === "refresh_runtime") {
      return true;
    }
    if (action === "submit_stage_deliverable") {
      return missingStageDeliverables || requiredByAction.has(action);
    }
    if (action === "reconcile_deliverables") {
      return requiredByAction.has(action);
    }
    if (action === "open_design_review") {
      return requiredByAction.has(action)
        || (input.project.currentStage === "DESIGN" && designInterventionRequired && (!hasDesignReview || !hasVisualPreview));
    }
    if (action === "resolve_blocked_tasks") {
      return hasBlockedTasks || requiredByAction.has(action);
    }
    if (action === "review_pending_stage") {
      return input.project.pendingApproval || requiredByAction.has(action);
    }
    return requiredByAction.has(action);
  };

  const orderedActions: ProjectRequiredAction[] = [];
  for (const action of REAL_MODEL_GATE_ACTION_ORDER) {
    if (!needAction(action)) {
      continue;
    }
    orderedActions.push(requiredByAction.get(action) || createFallbackRequiredAction(action, input.project));
  }

  for (const action of input.requiredActions) {
    if (orderedActions.some((item) => item.action === action.action)) {
      continue;
    }
    orderedActions.push(action);
  }

  const recoveryPlan = orderedActions.map((action, index) => ({
    step: index + 1,
    action: action.action,
    title: action.title
  }));

  return {
    requiredActions: orderedActions,
    recoveryPlan
  };
}

async function trySyncGitLabHarness(input: {
  projectId: string;
  stageType?: string;
  closeOnComplete?: boolean;
  reason: string;
}) {
  const normalizedStage = String(input.stageType || "").trim().toUpperCase();
  const closeOnComplete = Boolean(input.closeOnComplete);
  const shouldSync = GITLAB_HARNESS_SYNC_STAGES.has(normalizedStage) || closeOnComplete;
  if (!shouldSync) {
    return;
  }

  try {
    const result = await syncProjectGitLabHarness({
      projectId: input.projectId,
      stageType: normalizedStage || undefined,
      closeOnComplete
    });
    if (!result.ok) {
      console.warn(`[GitLab Harness] sync skipped (${input.reason}): ${result.code} ${result.message}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.warn(`[GitLab Harness] sync failed (${input.reason}): ${message}`);
  }
}

export function createProjectsRouter(options: CreateProjectsRouterOptions) {
  const {
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
    projectAdvanceStates,
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
  } = options;
  buildProjectRequiredActionsDelegate = buildProjectRequiredActions;
  formatRequiredActionsMessageDelegate = formatRequiredActionsMessage;

  const router = express.Router();
router.post("/api/projects/parse", validateBody(ProjectParseRequestSchema), asyncRoute(async (req, res) => {
  if (!PROJECT_PARSE_LEGACY_ENABLED) {
    res.status(410).json({
      success: false,
      error: {
        code: "PROJECT_PARSE_LEGACY_DISABLED",
        message: "自然语言规则解析已停用。请通过 /api/issues/preview 获取真实模型讨论后的正式结论。"
      }
    });
    return;
  }

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

router.post("/api/projects/preview", validateBody(ProjectPreviewRequestSchema), asyncRoute(async (req, res) => {
  const description = String(req.body?.description ?? "").trim();

  if (!description) {
    res.status(400).json({ message: "description is required" });
    return;
  }

  res.json(previewRequirement(description));
}));

router.get("/api/projects", asyncRoute(async (req, res) => {
  const summary = String(req.query.summary ?? "true").trim().toLowerCase() !== "false";
  const truncateText = (value: string, limit = 200) => {
    const source = String(value || "");
    return source.length > limit ? `${source.slice(0, limit)}...` : source;
  };
  const pageRaw = Number(req.query.page ?? 1);
  const pageSizeRaw = Number(req.query.pageSize ?? req.query.limit ?? 20);
  const page = Number.isFinite(pageRaw) ? Math.max(1, Math.floor(pageRaw)) : 1;
  const pageSize = Number.isFinite(pageSizeRaw) ? Math.max(1, Math.min(100, Math.floor(pageSizeRaw))) : 20;
  const offset = (page - 1) * pageSize;
  const projects = await listProjects({ limit: pageSize, offset });
  const now = Date.now();
  const total = projectListTotalCache && projectListTotalCache.expiresAt > now
    ? projectListTotalCache.value
    : await prisma.project.count();
  if (!projectListTotalCache || projectListTotalCache.expiresAt <= now) {
    projectListTotalCache = {
      value: total,
      expiresAt: now + PROJECT_LIST_TOTAL_CACHE_TTL_MS
    };
  }
  res.setHeader("X-Page", String(page));
  res.setHeader("X-Page-Size", String(pageSize));
  res.setHeader("X-Total-Count", String(total));
  const currentUser = getCurrentUserFromLocals(res);
  if (!currentUser) {
    res.json(summary
      ? projects.map((project) => ({
        ...project,
        name: truncateText(project.name, 200),
        summary: truncateText(project.summary || "", 200)
      }))
      : projects);
    return;
  }

  const projectIds = projects.map((item) => item.id);
  const projectRoleMap = new Map<string, ProjectRole | null>();
  if (currentUser.role !== "admin" && projectIds.length > 0) {
    const members = await prisma.projectMember.findMany({
      where: {
        userId: currentUser.id,
        projectId: { in: projectIds }
      },
      select: {
        projectId: true,
        role: true
      }
    });
    for (const member of members) {
      const role = String(member.role || "").trim().toLowerCase();
      if (role === "owner" || role === "editor" || role === "viewer") {
        projectRoleMap.set(member.projectId, role);
      }
    }
  }

  res.json(projects.map((project) => {
    const projectRole = currentUser.role === "admin" ? "owner" : (projectRoleMap.get(project.id) || null);
    const payload = {
      ...project,
      name: summary ? truncateText(project.name, 200) : project.name,
      summary: summary ? truncateText(project.summary || "", 200) : project.summary,
    };
    return {
      ...payload,
      permissions: {
        projectRole,
        canApprove: isPermissionAllowed({
          userRole: currentUser.role,
          projectRole,
          permission: "approve"
        }),
        canDelete: isPermissionAllowed({
          userRole: currentUser.role,
          projectRole,
          permission: "delete"
        }),
        canEdit: isPermissionAllowed({
          userRole: currentUser.role,
          projectRole,
          permission: "edit"
        })
      }
    };
  }));
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

const CLEANUP_TEST_NAME_PATTERN = /(复测|冒烟|测试|验证|巡检|高保真|闭环能力版|HTTP真实流转版|设计增强版|重新启用创建|创建即推进|阶段B-|验收版|命题验收|真实设计验收|阶段接力|全流程|单阶段|sandbox|tmp|\bV1\b)/i;

function normalizeProjectNameForCleanup(input: string) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()（）\[\]【】]/g, "")
    .replace(/[-_]\d{8,}$/i, "")
    .replace(/\d{12,}$/i, "");
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

router.get("/api/projects/cleanup/candidates", asyncRoute(async (_req, res) => {
  const projects = await listProjects();
  const candidates = buildProjectCleanupCandidates(projects);
  res.json({
    success: true,
    data: candidates,
  });
}));

router.post("/api/projects/cleanup", validateBody(ProjectCleanupRequestSchema), asyncRoute(async (req, res) => {
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
        markProjectAdvanceCancelled(id);
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

router.get("/api/projects/automation", asyncRoute(async (_req, res) => {
  res.json({
    enabled: projectAutomationState.enabled,
    autoApproveWhenReady: projectAutomationState.autoApproveWhenReady,
    intervalMs: projectAutomationState.intervalMs,
    running: projectAutomationState.running,
    lastRunAt: projectAutomationState.lastRunAt,
    lastError: projectAutomationState.lastError,
    lastSummary: projectAutomationState.lastSummary
  });
}));

router.put("/api/projects/automation", validateBody(ProjectAutomationUpdateSchema), asyncRoute(async (req, res) => {
  const enabled = req.body?.enabled;
  const autoApproveWhenReady = req.body?.autoApproveWhenReady;
  const intervalMsInput = Number(req.body?.intervalMs ?? projectAutomationState.intervalMs);

  if (typeof enabled !== "boolean") {
    res.status(400).json({ message: "enabled must be boolean" });
    return;
  }
  if (autoApproveWhenReady !== undefined && typeof autoApproveWhenReady !== "boolean") {
    res.status(400).json({ message: "autoApproveWhenReady must be boolean when provided" });
    return;
  }

  projectAutomationState.enabled = enabled;
  if (typeof autoApproveWhenReady === "boolean") {
    projectAutomationState.autoApproveWhenReady = autoApproveWhenReady;
  }
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
    detail: `intervalMs=${projectAutomationState.intervalMs}; autoApproveWhenReady=${projectAutomationState.autoApproveWhenReady}`
  });

  res.json({
    enabled: projectAutomationState.enabled,
    autoApproveWhenReady: projectAutomationState.autoApproveWhenReady,
    intervalMs: projectAutomationState.intervalMs,
    running: projectAutomationState.running,
    lastRunAt: projectAutomationState.lastRunAt,
    lastError: projectAutomationState.lastError,
    lastSummary: projectAutomationState.lastSummary
  });
}));

router.post("/api/projects/automation/run", validateBody(MutationOptionalSchema), asyncRoute(async (req, res) => {
  const wasRunning = projectAutomationState.running;
  void runProjectAutomationTick({ force: true });

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.automation.run_once",
    resourceType: "project",
    summary: "手动触发自动推进执行一轮"
  });

  res.status(202).json({
    enabled: projectAutomationState.enabled,
    autoApproveWhenReady: projectAutomationState.autoApproveWhenReady,
    intervalMs: projectAutomationState.intervalMs,
    running: projectAutomationState.running,
    lastRunAt: projectAutomationState.lastRunAt,
    lastError: projectAutomationState.lastError,
    lastSummary: projectAutomationState.lastSummary,
    accepted: !wasRunning,
    message: wasRunning ? "当前已有自动推进任务在运行，本次请求已忽略重复触发。" : "已触发一轮自动推进，请稍后刷新状态。"
  });
}));

router.post("/api/projects", validateBody(ProjectCreateSchema), asyncRoute(async (req, res) => {
  if (!PROJECT_DIRECT_CREATE_ENABLED) {
    res.status(409).json({
      success: false,
      error: {
        code: "PROJECT_ISSUE_FIRST_REQUIRED",
        message: "当前环境已启用 issue-first 门禁，不允许直接创建项目。请先通过 New Project Issue 流程完成需求确认后再创建。"
      }
    });
    return;
  }

  const description = String(req.body?.description ?? "").trim();

  if (!description) {
    res.status(400).json({ message: "description is required" });
    return;
  }
  const projectType = normalizeProjectType(req.body?.projectType);
  const parentProjectId = String(req.body?.parentProjectId ?? "").trim() || undefined;
  const relaySourceStageId = String(req.body?.relaySourceStageId ?? "").trim() || undefined;
  const projectInputs = normalizeProjectInputs(req.body?.projectInputs);
  if (projectType === "relay" && !parentProjectId) {
    res.status(400).json({ message: "parentProjectId is required when projectType=relay" });
    return;
  }
  if (!isProjectModeTemplateCompatible({ projectType, workflowTemplateKey: req.body?.workflowTemplateKey })) {
    const message = projectType === "complete"
      ? "workflowTemplateKey must be standard_software_development or none when projectType=complete"
      : "workflowTemplateKey must be one of requirements_design/visual_design/tech_design/code_dev/qa_acceptance/none for standalone or relay projectType";
    res.status(400).json({ message });
    return;
  }

  const project = await createProject(
    {
      name: req.body?.name,
      description,
      team: req.body?.team,
      projectType,
      parentProjectId,
      relaySourceStageId,
      projectInputs,
      workflowTemplateKey: req.body?.workflowTemplateKey,
      autoStartWorkflow: req.body?.autoStartWorkflow
    },
    (await getRuntimeStatus()).mode
  );
  clearProjectAdvanceCancelled(project.id);
  const currentUser = getCurrentUserFromLocals(res);
  if (currentUser) {
    await prisma.projectMember.upsert({
      where: {
        projectId_userId: {
          projectId: project.id,
          userId: currentUser.id
        }
      },
      update: {
        role: "owner"
      },
      create: {
        projectId: project.id,
        userId: currentUser.id,
        role: "owner"
      }
    });
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.created",
    resourceType: "project",
    resourceId: project.id,
    summary: `创建项目 ${project.name}`
  });

  const issueFirst = await ensureProjectIssueFirst({ projectId: project.id }).catch((error) => ({
    ok: false,
    enforced: true,
    code: "ISSUE_FIRST_CHECK_FAILED",
    message: error instanceof Error ? error.message : String(error)
  }));
  if (issueFirst.ok) {
    const prepState = await resolveProjectPostCreatePrepState(project as ProjectRecord);
    if (prepState.required && !prepState.completed) {
      void runProjectPostCreatePrep({
        projectId: project.id,
        triggeredBy: "project_created_auto_prep"
      }).catch((error) => {
        console.warn(
          `[project] async post-create-prep failed for ${project.id}:`,
          error instanceof Error ? error.message : String(error)
        );
      });
    } else {
      void startProjectWarmupAfterCreate(project).catch((error) => {
        console.warn(
          `[project] async warmup after create failed for ${project.id}:`,
          error instanceof Error ? error.message : String(error)
        );
      });
    }
  } else {
    console.warn(`[ProjectIssueFirst] project create gated for ${project.id}: ${issueFirst.code} ${issueFirst.message}`);
  }

  res.status(201).json(project);
}));

router.post("/api/projects/:id/advance", validateBody(MutationOptionalSchema), asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);

  const hasAdvanceLock = projectAdvanceLocks.has(projectId);
  const hasAdvanceJob = projectAdvanceJobs.has(projectId);
  if (hasAdvanceLock || hasAdvanceJob) {
    const recovered = tryRecoverStalledAdvanceJob({
      projectId,
      hasLock: hasAdvanceLock,
      hasJob: hasAdvanceJob,
      ensureManualAdvanceJob,
      projectAdvanceLocks,
      projectAdvanceJobs
    });
    const pollAfterMs = nextProjectAdvancePollAfterMs(projectId, recovered);
    if (recovered) {
      projectAdvanceStates.set(projectId, {
        ...(projectAdvanceStates.get(projectId) || {
          projectId,
          status: "recovering",
          updatedAt: new Date().toISOString()
        }),
        status: "recovering",
        updatedAt: new Date().toISOString(),
        message: "推进状态恢复中，已重新拉起任务"
      });
    }
    res.status(409).json({
      success: false,
      error: {
        code: "PROJECT_ADVANCE_IN_PROGRESS",
        message: recovered
          ? "检测到推进状态长时间未收敛，已自动执行恢复重试，请稍后刷新。"
          : "该项目正在推进中，请稍后刷新。",
        pollAfterMs,
        recoveryAttempted: recovered
      }
    });
    return;
  }

  const project = await findProject(projectId);

  if (!project) {
    resetProjectAdvancePollHint(projectId);
    res.status(404).json({ message: "Project not found" });
    return;
  }

  if (project.status !== "active") {
    resetProjectAdvancePollHint(projectId);
    res.status(409).json({ message: "Project is not active" });
    return;
  }

  const issueFirst = await ensureProjectIssueFirst({ projectId }).catch((error) => ({
    ok: false,
    enforced: true,
    code: "ISSUE_FIRST_CHECK_FAILED",
    message: error instanceof Error ? error.message : String(error)
  }));
  if (!issueFirst.ok) {
    resetProjectAdvancePollHint(projectId);
    res.status(409).json({
      success: false,
      error: {
        code: "PROJECT_ISSUE_FIRST_REQUIRED",
        message: buildProjectIssueFirstMessage(issueFirst)
      }
    });
    return;
  }

  const postCreatePrep = await resolveProjectPostCreatePrepState(project);
  if (postCreatePrep.required && !postCreatePrep.completed) {
    resetProjectAdvancePollHint(projectId);
    const actions = [buildPostCreatePrepRequiredAction({
      missingItems: postCreatePrep.missingItems
    })];
    res.status(409).json({
      success: false,
      error: {
        code: "REQUIRES_USER_INTERVENTION",
        message: formatRequiredActionsMessage(actions),
        requiredActions: actions,
        postCreatePrep
      }
    });
    return;
  }

  const runtime = await getRuntimeStatus();
  const requiredActions = buildProjectRequiredActions(project, runtime);
  const needsDesignReviewInput = requiredActions.some((item) => item.action === "open_design_review");
  const blockedByUserIntervention = project.pendingApproval;

  if (needsDesignReviewInput) {
    resetProjectAdvancePollHint(projectId);
    res.status(409).json({
      success: false,
      error: {
        code: "REQUIRES_USER_INTERVENTION",
        message: formatRequiredActionsMessage(requiredActions),
        requiredActions
      }
    });
    return;
  }

  if (blockedByUserIntervention) {
    resetProjectAdvancePollHint(projectId);
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

  const lastJobError = projectAdvanceJobErrors.get(projectId);
  if (lastJobError) {
    projectAdvanceJobErrors.delete(projectId);
    if (lastJobError.message === "PROJECT_ADVANCE_IN_PROGRESS") {
      const recovered = tryRecoverStalledAdvanceJob({
        projectId,
        hasLock: projectAdvanceLocks.has(projectId),
        hasJob: projectAdvanceJobs.has(projectId),
        ensureManualAdvanceJob,
        projectAdvanceLocks,
        projectAdvanceJobs
      });
      const pollAfterMs = nextProjectAdvancePollAfterMs(projectId, recovered);
      res.status(409).json({
        success: false,
        error: {
          code: "PROJECT_ADVANCE_IN_PROGRESS",
          message: recovered
            ? "检测到推进状态未收敛，系统已自动执行恢复重试，请稍后刷新。"
            : "该项目正在推进中，请稍后刷新。",
          pollAfterMs,
          recoveryAttempted: recovered
        }
      });
      return;
    }
    const latestProject = await findProject(projectId);
    const latestRuntime = await getRuntimeStatus();
    const latestRequiredActions = latestProject
      ? buildProjectRequiredActions(latestProject, latestRuntime)
      : [];

    if (lastJobError.message.startsWith("DESIGN_REVIEW_REQUIRED:") || lastJobError.message.startsWith("DESIGN_VISUAL_PREVIEW_REQUIRED:")) {
      resetProjectAdvancePollHint(projectId);
      const actions = latestRequiredActions.length > 0
        ? latestRequiredActions
        : [{
          id: "design-review-required",
          severity: "critical" as const,
          title: "设计阶段缺少可确认设计产物",
          detail: "请补充设计审查卡并提供静态图或单页 HTML 视觉稿后再推进。",
          action: "open_design_review" as const,
          ctaLabel: "提交设计审查卡"
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

    if (lastJobError.message.startsWith("REAL_MODEL_GATE_FAILED:")) {
      resetProjectAdvancePollHint(projectId);
      const recovery = buildRealModelGateRecoveryActions({
        project: latestProject ?? project,
        requiredActions: latestRequiredActions
      });
      res.status(422).json({
        success: false,
        error: {
          code: "REAL_MODEL_GATE_FAILED",
          message: lastJobError.message.replace("REAL_MODEL_GATE_FAILED:", "").trim(),
          requiredActions: recovery.requiredActions,
          recoveryPlan: recovery.recoveryPlan
        }
      });
      return;
    }

    if (isRecoverableAdvanceFailure(lastJobError.message)) {
      ensureManualAdvanceJob(projectId);
      const pollAfterMs = nextProjectAdvancePollAfterMs(projectId, true);
      res.status(409).json({
        success: false,
        error: {
          code: "PROJECT_ADVANCE_IN_PROGRESS",
          message: `上一轮推进遇到可恢复错误，系统已自动重试：${lastJobError.message}`,
          pollAfterMs
        }
      });
      return;
    }

    resetProjectAdvancePollHint(projectId);
    res.status(409).json({
      success: false,
      error: {
        code: "PROJECT_ADVANCE_FAILED",
        message: `上一轮推进失败：${lastJobError.message}`
      }
    });
    return;
  }

  ensureManualAdvanceJob(projectId);
  if (!projectAdvanceJobs.has(projectId) && !projectAdvanceLocks.has(projectId)) {
    resetProjectAdvancePollHint(projectId);
    res.status(503).json({
      success: false,
      error: {
        code: "PROJECT_ADVANCE_UNAVAILABLE",
        message: "当前环境未成功启动自动推进任务，请检查 PROJECT_MANUAL_ADVANCE_ENABLED 与服务日志。"
      }
    });
    return;
  }
  const pollAfterMs = nextProjectAdvancePollAfterMs(projectId);
  res.status(409).json({
    success: false,
    error: {
      code: "PROJECT_ADVANCE_IN_PROGRESS",
      message: "已开始推进当前阶段，正在后台生成交付物，请稍后刷新。",
      pollAfterMs
    }
  });
}));

router.get("/api/projects/:id/advance-status", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const hasAdvanceLock = projectAdvanceLocks.has(projectId);
  const hasAdvanceJob = projectAdvanceJobs.has(projectId);
  const inProgress = hasAdvanceLock || hasAdvanceJob;
  const pollAfterMs = inProgress ? nextProjectAdvancePollAfterMs(projectId) : undefined;
  const latestError = projectAdvanceJobErrors.get(projectId);
  const state = projectAdvanceStates.get(projectId) || {
    projectId,
    status: inProgress ? "running" : "idle",
    updatedAt: new Date().toISOString(),
    message: inProgress ? "推进任务正在运行" : "暂无推进任务"
  };

  res.json({
    success: true,
    data: {
      projectId,
      inProgress,
      hasAdvanceLock,
      hasAdvanceJob,
      pollAfterMs,
      state,
      latestError: latestError || (state.lastError
        ? { message: state.lastError, at: state.lastErrorAt || state.updatedAt }
        : null)
    }
  });
}));

router.post("/api/projects/:id/reconcile-deliverables", validateBody(MutationOptionalSchema), asyncRoute(async (req, res) => {
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
  const issueFirst = await ensureProjectIssueFirst({ projectId }).catch((error) => ({
    ok: false,
    enforced: true,
    code: "ISSUE_FIRST_CHECK_FAILED",
    message: error instanceof Error ? error.message : String(error)
  }));
  res.json({
    ...project,
    requiredActions,
    issueFirst
  });
}));

router.get("/api/projects/:id/template-gate-precheck", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const precheck = await getProjectTemplateGatePrecheck(projectId);
  if (!precheck) {
    res.status(404).json({ message: "Project not found" });
    return;
  }
  res.json(precheck);
}));

router.get("/api/projects/:id/execution-protocol-precheck", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const precheck = await getProjectExecutionProtocolPrecheck(projectId);
  if (!precheck) {
    res.status(404).json({ message: "Project not found" });
    return;
  }
  res.json(precheck);
}));

router.get("/api/projects/:id/lifecycle-quality-audit", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const audit = await getProjectLifecycleQualityAudit(projectId);
  if (!audit) {
    res.status(404).json({ message: "Project not found" });
    return;
  }
  res.json(audit);
}));

router.post("/api/projects/:id/lifecycle-quality-audit/replay", validateBody(MutationOptionalSchema), asyncRoute(async (req, res) => {
  const projectId = String(req.params.id || "").trim();
  if (!projectId) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "project id is required"
      }
    });
    return;
  }

  const project = await findProject(projectId);
  if (!project) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: `Project not found: ${projectId}`
      }
    });
    return;
  }

  const replayRoleTimeoutMs = Math.max(30_000, Number(req.body?.roleTimeoutMs ?? 240_000));
  const jobId = `replay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job: LifecycleReplayJob = {
    id: jobId,
    projectId: project.id,
    status: "running",
    startedAt: new Date().toISOString(),
    completedAt: null,
    attempted: [],
    succeeded: [],
    failed: []
  };
  lifecycleReplayJobs.set(jobId, job);

  void (async () => {
    for (const stageType of LIFECYCLE_AUDIT_STAGE_ORDER) {
      const roles = getStageRealModelGateRoles(stageType);
      for (const role of roles) {
        job.attempted.push({ stageType, role });
        const stageRoleTimeoutMs = stageType === "DESIGN"
          ? (role === "ROLE_DESIGN"
            ? Math.max(replayRoleTimeoutMs, 300_000)
            : Math.max(replayRoleTimeoutMs, 240_000))
          : replayRoleTimeoutMs;
        const replaySummary = stageType === "DESIGN"
          ? `回放：${ROLE_LABELS[role]}补齐${STAGE_LABELS[stageType]}可验证执行证据（精简输出，优先结论与关键证据）。`
          : `回放：${ROLE_LABELS[role]}补齐${STAGE_LABELS[stageType]}真实执行证据。`;
        try {
          await Promise.race([
            runProjectStageAgent({
              projectId: project.id,
              projectName: project.name,
              projectDescription: project.description,
              parsedIntent: project.parsedIntent,
              stageType,
              role,
              action: "project.lifecycle_audit.replay_real_execution",
              summary: replaySummary,
              metadata: {
                replay: "lifecycle-quality-audit",
                stageType,
                role,
                strictRealModel: true
              }
            }),
            new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error(`replay_timeout_${stageRoleTimeoutMs}ms`)), stageRoleTimeoutMs);
            })
          ]);
          job.succeeded.push({ stageType, role });
        } catch (error) {
          job.failed.push({
            stageType,
            role,
            reason: sanitizeReplayReason(error instanceof Error ? error.message : String(error))
          });
        }
      }
    }
    job.latestAudit = await getProjectLifecycleQualityAudit(project.id);
    job.status = "completed";
    job.completedAt = new Date().toISOString();
  })().catch((error) => {
    job.failed.push({
      stageType: "INIT",
      role: "ROLE_PM",
      reason: sanitizeReplayReason(error instanceof Error ? error.message : String(error))
    });
    job.status = "completed";
    job.completedAt = new Date().toISOString();
  });

  res.status(202).json({
    success: true,
    data: {
      projectId: project.id,
      jobId,
      status: "running",
      roleTimeoutMs: replayRoleTimeoutMs
    }
  });
}));

router.get("/api/projects/:id/lifecycle-quality-audit/replay/:jobId", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id || "").trim();
  const jobId = String(req.params.jobId || "").trim();
  const job = lifecycleReplayJobs.get(jobId);
  if (!projectId || !jobId || !job || job.projectId !== projectId) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "replay job not found"
      }
    });
    return;
  }

  res.json({
    success: true,
    data: job
  });
}));

router.post("/api/projects/:id/quality-gate/repair-issues", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
  const projectId = String(req.params.id || "").trim();
  if (!projectId) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "project id is required"
      }
    });
    return;
  }

  const dryRun = Boolean(req.body?.dryRun);
  const projectPath = String(req.body?.projectPath || "").trim() || undefined;
  const validationCommands = normalizeStringArrayInput(req.body?.validationCommands);
  const result = await buildProjectQualityGateRepairResult({
    projectId,
    dryRun,
    projectPath,
    validationCommands: validationCommands.length > 0
      ? validationCommands
      : QUALITY_GATE_REPAIR_DEFAULT_VALIDATIONS
  });

  if (result.status === "not_found") {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: `Project not found: ${projectId}`
      }
    });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.quality_gate_repair_issues.generated",
    resourceType: "project",
    resourceId: projectId,
    summary: dryRun
      ? `质量门禁修复 issue 预览：${result.blockingStageCount} 个阻断阶段`
      : `质量门禁修复 issue 执行：创建 ${result.created.length} / 复用 ${result.reused.length} / 失败 ${result.failed.length}`,
    detail: `dryRun=${dryRun}; blockingStages=${result.blockingStageCount}`
  });

  res.json({
    success: true,
    data: result
  });
}));

router.post("/api/projects/quality-gate/repair-issues", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
  const dryRun = Boolean(req.body?.dryRun);
  const projectPath = String(req.body?.projectPath || "").trim() || undefined;
  const includeHistorical = req.body?.includeHistorical !== false;
  const limit = parseRepairLimit(req.body?.limit);
  const validationCommands = normalizeStringArrayInput(req.body?.validationCommands);
  const selectedProjectIds = Array.from(new Set(normalizeStringArrayInput(req.body?.projectIds)));
  const statusFilter = normalizeStatusFilter(req.body?.statuses);

  const projects = await listProjects();
  const summaryById = new Map(projects.map((item) => [item.id, item]));

  let targetProjectIds: string[];
  if (selectedProjectIds.length > 0) {
    targetProjectIds = selectedProjectIds.filter((id) => summaryById.has(id));
  } else {
    const statusSet = statusFilter.size > 0
      ? statusFilter
      : includeHistorical
        ? null
        : new Set(["active", "blocked"]);
    targetProjectIds = projects
      .filter((item) => !statusSet || statusSet.has(item.status))
      .map((item) => item.id);
  }

  if (targetProjectIds.length > limit) {
    targetProjectIds = targetProjectIds.slice(0, limit);
  }

  const results: Array<Awaited<ReturnType<typeof buildProjectQualityGateRepairResult>>> = [];
  for (const projectId of targetProjectIds) {
    const item = await buildProjectQualityGateRepairResult({
      projectId,
      dryRun,
      projectPath,
      validationCommands: validationCommands.length > 0
        ? validationCommands
        : QUALITY_GATE_REPAIR_DEFAULT_VALIDATIONS
    });
    results.push(item);
  }

  const totals = results.reduce((acc, item) => {
    acc.processed += 1;
    acc.blockingStages += item.blockingStageCount;
    acc.created += item.created.length;
    acc.reused += item.reused.length;
    acc.failed += item.failed.length;
    if (item.status === "not_found" || item.status === "audit_unavailable") {
      acc.skipped += 1;
    } else if (item.blockingStageCount === 0) {
      acc.noBlocking += 1;
    } else {
      acc.withBlocking += 1;
    }
    return acc;
  }, {
    processed: 0,
    withBlocking: 0,
    noBlocking: 0,
    skipped: 0,
    blockingStages: 0,
    created: 0,
    reused: 0,
    failed: 0
  });

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.quality_gate_repair_issues.batch_generated",
    resourceType: "project",
    summary: dryRun
      ? `批量质量门禁修复 issue 预览：项目 ${totals.processed} 个，阻断阶段 ${totals.blockingStages} 个`
      : `批量质量门禁修复 issue 执行：创建 ${totals.created} / 复用 ${totals.reused} / 失败 ${totals.failed}`,
    detail: `dryRun=${dryRun}; includeHistorical=${includeHistorical}; requested=${targetProjectIds.length}; limit=${limit}`
  });

  res.json({
    success: true,
    data: {
      dryRun,
      includeHistorical,
      limit,
      requestedProjects: targetProjectIds.length,
      processedProjects: totals.processed,
      totals,
      projects: results
    }
  });
}));

router.get("/api/projects/:id/inputs", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId);
  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }
  const inputs = await listProjectInputs(projectId);
  res.json({
    success: true,
    data: {
      projectId,
      total: inputs.length,
      items: inputs
    }
  });
}));

router.post("/api/projects/:id/inputs", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId);
  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }
  const normalized = normalizeProjectInputs(Array.isArray(req.body?.items) ? req.body.items : [req.body]);
  if (normalized.length === 0) {
    res.status(400).json({ message: "at least one valid input item is required" });
    return;
  }
  const items = await createProjectInputs(projectId, normalized);
  await scheduleProjectInputSync(projectId, "post-create-prep");
  res.status(201).json({
    success: true,
    data: {
      projectId,
      total: items.length,
      items
    }
  });
}));

router.post("/api/projects/:id/relay/import", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
  const targetProjectId = String(req.params.id);
  const targetProject = await findProject(targetProjectId);
  if (!targetProject) {
    res.status(404).json({ message: "Project not found" });
    return;
  }
  const sourceProjectId = String(req.body?.sourceProjectId ?? "").trim();
  if (!sourceProjectId) {
    res.status(400).json({ message: "sourceProjectId is required" });
    return;
  }
  const sourceStageId = String(req.body?.sourceStageId ?? "").trim() || undefined;
  const sourceStageType = String(req.body?.sourceStageType ?? "").trim() || undefined;
  const relayType = String(req.body?.relayType ?? "").trim() || "full";
  const sourceDeliverableIds = normalizeStringArrayInput(req.body?.sourceDeliverableIds);
  const transformationConfig = req.body?.transformationConfig && typeof req.body.transformationConfig === "object"
    ? req.body.transformationConfig as Record<string, unknown>
    : undefined;

  const items = await importRelayInputs({
    targetProjectId,
    sourceProjectId,
    sourceStageId,
    sourceStageType,
    sourceDeliverableIds,
    relayType,
    transformationConfig
  });
  await syncProjectInputsToLatestWorkflow(targetProjectId);

  res.status(201).json({
    success: true,
    data: {
      targetProjectId,
      sourceProjectId,
      total: items.length,
      items
    }
  });
}));

router.get("/api/projects/:id", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const stale = projectDetailSnapshotCache.get(projectId);
  if (stale && (Date.now() - stale.updatedAt) <= PROJECT_DETAIL_STALE_MAX_AGE_MS) {
    void refreshProjectDetailSnapshot(projectId).catch(() => undefined);
    res.setHeader("X-Data-Stale", "true");
    res.setHeader("X-Data-Stale-At", new Date(stale.updatedAt).toISOString());
    res.json(stale.value);
    return;
  }
  const projectPromise = findProject(projectId, {
    detailLevel: "api",
    skipWorkflowStateReconcile: true,
  });
  const projectResult = await withSoftTimeout(projectPromise, PROJECT_DETAIL_SOFT_TIMEOUT_MS);

  if (projectResult.timedOut) {
    const stale = projectDetailSnapshotCache.get(projectId);
    if (stale) {
      res.setHeader("X-Data-Stale", "true");
      res.setHeader("X-Data-Stale-At", new Date(stale.updatedAt).toISOString());
      res.json(stale.value);
      return;
    }
    // 没有可回退快照时，继续等待真实查询结果，避免误报 404。
    const waitedProject = await projectPromise;
    if (!waitedProject) {
      res.status(404).json({ message: "Project not found" });
      return;
    }
    const runtime = await getRuntimeStatus();
    const requiredActions = buildProjectRequiredActions(waitedProject, runtime);
    const postCreatePrep = await resolveProjectPostCreatePrepState(waitedProject);
    const currentUser = getCurrentUserFromLocals(res);
    const permissions = currentUser
      ? await buildProjectPermissions(projectId, currentUser)
      : LEGACY_DEV_AUTH_BYPASS
        ? {
            projectRole: "owner",
            canApprove: true,
            canDelete: true,
            canEdit: true
          }
        : {
            projectRole: null,
            canApprove: false,
            canDelete: false,
            canEdit: false
          };
    if (postCreatePrep.required && !postCreatePrep.completed) {
      requiredActions.unshift(buildPostCreatePrepRequiredAction({
        missingItems: postCreatePrep.missingItems
      }));
    }
    const responsePayload = {
      ...waitedProject,
      permissions,
      requiredActions,
      postCreatePrep
    };
    projectDetailSnapshotCache.set(projectId, {
      updatedAt: Date.now(),
      value: responsePayload
    });
    res.json(responsePayload);
    return;
  }
  const project = projectResult.value;

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  const runtime = await getRuntimeStatus();
  const requiredActions = buildProjectRequiredActions(project, runtime);
  const postCreatePrep = await resolveProjectPostCreatePrepState(project);
  const currentUser = getCurrentUserFromLocals(res);
  const permissions = currentUser
    ? await buildProjectPermissions(projectId, currentUser)
    : LEGACY_DEV_AUTH_BYPASS
      ? {
          projectRole: "owner",
          canApprove: true,
          canDelete: true,
          canEdit: true
        }
      : {
          projectRole: null,
          canApprove: false,
          canDelete: false,
          canEdit: false
        };
  if (postCreatePrep.required && !postCreatePrep.completed) {
    requiredActions.unshift(buildPostCreatePrepRequiredAction({
      missingItems: postCreatePrep.missingItems
    }));
  }
  const responsePayload = {
    ...project,
    permissions,
    requiredActions,
    postCreatePrep
  };
  projectDetailSnapshotCache.set(projectId, {
    updatedAt: Date.now(),
    value: responsePayload
  });
  res.json(responsePayload);
}));

router.get("/api/projects/:id/executions", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const exists = await ensureProjectExists(projectId);
  if (!exists) {
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

router.get("/api/projects/:id/structured-merge-requests", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id ?? "").trim();
  const project = await findProject(projectId);
  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }
  const limitRaw = Number(req.query.limit ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;
  const items = await listStructuredMergeRequests(projectId, limit);
  res.json({
    projectId,
    total: items.length,
    items
  });
}));

router.post("/api/projects/:id/post-create-prep", validateBody(ProjectPostCreatePrepSchema), asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId);
  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  const issueFirst = await ensureProjectIssueFirst({ projectId }).catch((error) => ({
    ok: false,
    enforced: true,
    code: "ISSUE_FIRST_CHECK_FAILED",
    message: error instanceof Error ? error.message : String(error)
  }));
  if (!issueFirst.ok) {
    res.status(409).json({
      success: false,
      error: {
        code: "PROJECT_ISSUE_FIRST_REQUIRED",
        message: buildProjectIssueFirstMessage(issueFirst)
      }
    });
    return;
  }

  const draft = parsePostCreatePrepDraft(req.body);
  const hasDraft = hasPostCreatePrepDraftValue(draft);
  const triggeredBy = hasDraft
    ? "projects_route_manual_trigger_with_draft"
    : "projects_route_manual_trigger";
  if (hasDraft && draft) {
    await saveProjectPostCreatePrepDraft({
      projectId,
      draft,
      triggeredBy: "projects_route_manual_trigger_draft_prefill"
    });
  }

  let postCreatePrep = await runProjectPostCreatePrep({
    projectId,
    triggeredBy,
    feedback: draft?.feedback
  });
  const issueFirstData = issueFirst.ok && "data" in issueFirst ? issueFirst.data : undefined;
  const gitLabProjectPath = normalizePrepTraceMetaValue(issueFirstData?.projectPath);
  const gitLabIssueIid = Number(issueFirstData?.issueIid);
  const gitlabPublishRequired = Boolean(
    gitLabProjectPath
    && Number.isInteger(gitLabIssueIid)
    && gitLabIssueIid > 0
  );

  let gitlabPublishStatus = gitlabPublishRequired ? "pending" : "not_required";
  let gitlabPublishProjectPath = gitLabProjectPath;
  let gitlabPublishIssueIid = Number.isInteger(gitLabIssueIid) && gitLabIssueIid > 0 ? gitLabIssueIid : undefined;
  let gitlabPublishIssueUrl = gitlabPublishIssueIid ? buildPrepGitLabIssueUrl(gitlabPublishProjectPath, gitlabPublishIssueIid) : "";
  let gitlabPublishNoteUrl = "";
  let gitlabPublishError = "";

  if (gitlabPublishRequired && gitlabPublishIssueIid) {
    const publishResult = await publishProjectMainIssueNote({
      projectId,
      projectPath: gitlabPublishProjectPath,
      issueIid: gitlabPublishIssueIid,
      body: buildPostCreatePrepIssueNoteBody({
        projectId,
        projectName: project.name,
        triggeredBy,
        draft: postCreatePrep.draft
      })
    });
    if (publishResult.ok) {
      gitlabPublishStatus = "published";
      gitlabPublishProjectPath = normalizePrepTraceMetaValue(publishResult.data.projectPath || gitlabPublishProjectPath);
      gitlabPublishIssueIid = Number(publishResult.data.issueIid || gitlabPublishIssueIid);
      gitlabPublishIssueUrl = buildPrepGitLabIssueUrl(gitlabPublishProjectPath, gitlabPublishIssueIid);
      gitlabPublishNoteUrl = normalizePrepTraceMetaValue(publishResult.data.noteUrl);
      gitlabPublishError = "";
    } else {
      gitlabPublishStatus = "failed";
      gitlabPublishError = normalizePrepTraceMetaValue(`${publishResult.code || "UNKNOWN"}: ${publishResult.message || "发布失败"}`);
    }
  }

  const nextDiscussionTrace = upsertPrepDiscussionTraceMeta(
    String(postCreatePrep.draft?.discussionTrace || ""),
    {
      gitlabPublishRequired: gitlabPublishRequired ? "yes" : "no",
      gitlabPublishStatus,
      gitlabProjectPath: gitlabPublishProjectPath || undefined,
      gitlabIssueIid: gitlabPublishIssueIid ? String(gitlabPublishIssueIid) : undefined,
      gitlabIssueUrl: gitlabPublishIssueUrl || undefined,
      gitlabNoteUrl: gitlabPublishNoteUrl || undefined,
      gitlabPublishError: gitlabPublishError || undefined
    }
  );

  if (nextDiscussionTrace && nextDiscussionTrace !== String(postCreatePrep.draft?.discussionTrace || "").trim()) {
    postCreatePrep = await saveProjectPostCreatePrepDraft({
      projectId,
      draft: {
        discussionTrace: nextDiscussionTrace
      },
      triggeredBy: "projects_route_manual_trigger_gitlab_publish_status"
    });
  }
  await scheduleProjectInputSync(projectId, "post-create-prep-draft");

  const refreshed = await findProject(projectId);
  if (!refreshed) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  const runtime = await getRuntimeStatus();
  const requiredActions = buildProjectRequiredActions(refreshed, runtime);
  if (postCreatePrep.required && !postCreatePrep.completed) {
    requiredActions.unshift(buildPostCreatePrepRequiredAction({
      missingItems: postCreatePrep.missingItems
    }));
  } else if (postCreatePrep.required && postCreatePrep.completed) {
    void startProjectWarmupAfterCreate(refreshed).catch((error) => {
      console.warn(
        `[project] warmup after prep confirm failed for ${projectId}:`,
        error instanceof Error ? error.message : String(error)
      );
    });
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.post_create_prep",
    resourceType: "project",
    resourceId: projectId,
    summary: `执行项目 ${projectId} 创建后需求预备`
  });

  res.json({
    success: true,
    data: {
      project: refreshed,
      postCreatePrep,
      requiredActions
    }
  });
}));

router.post("/api/projects/:id/post-create-prep/draft", validateBody(ProjectPostCreatePrepSchema), asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId);
  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }
  const draft = parsePostCreatePrepDraft(req.body);
  const postCreatePrep = await saveProjectPostCreatePrepDraft({
    projectId,
    draft,
    triggeredBy: "projects_route_manual_draft_save"
  });
  await scheduleProjectInputSync(projectId, "post-create-prep-confirm");
  const refreshed = await findProject(projectId);
  if (!refreshed) {
    res.status(404).json({ message: "Project not found" });
    return;
  }
  const runtime = await getRuntimeStatus();
  const requiredActions = buildProjectRequiredActions(refreshed, runtime);
  if (postCreatePrep.required && !postCreatePrep.completed) {
    requiredActions.unshift(buildPostCreatePrepRequiredAction({
      missingItems: postCreatePrep.missingItems
    }));
  }
  res.json({
    success: true,
    data: {
      project: refreshed,
      postCreatePrep,
      requiredActions
    }
  });
}));

router.post("/api/projects/:id/post-create-prep/confirm", validateBody(ProjectPostCreatePrepConfirmSchema), asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId);
  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }
  const draft = parsePostCreatePrepDraft(req.body);
  const postCreatePrep = await confirmProjectPostCreatePrep({
    projectId,
    confirmedBy: typeof req.body?.confirmedBy === "string" ? req.body.confirmedBy : undefined,
    notes: typeof req.body?.notes === "string" ? req.body.notes : undefined,
    draft
  });
  await syncProjectInputsToLatestWorkflow(projectId);
  const refreshed = await findProject(projectId);
  if (!refreshed) {
    res.status(404).json({ message: "Project not found" });
    return;
  }
  const runtime = await getRuntimeStatus();
  const requiredActions = buildProjectRequiredActions(refreshed, runtime);
  if (postCreatePrep.required && !postCreatePrep.completed) {
    requiredActions.unshift(buildPostCreatePrepRequiredAction({
      missingItems: postCreatePrep.missingItems
    }));
  }
  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.post_create_prep.confirm",
    resourceType: "project",
    resourceId: projectId,
    summary: `确认项目 ${projectId} 创建后需求预备`
  });
  res.json({
    success: true,
    data: {
      project: refreshed,
      postCreatePrep,
      requiredActions
    }
  });
}));

router.get("/api/projects/:id/acceptance-report", asyncRoute(async (req, res) => {
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

  const executions = await listProjectExecutions(projectId, 200);
  const lifecycleAudit = await getProjectLifecycleQualityAudit(projectId);
  const report = buildProjectAcceptanceReport(project, { executions, lifecycleAudit });
  res.json({
    success: true,
    data: report
  });
}));

router.get("/api/projects/:id/acceptance-report.md", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId);

  if (!project) {
    res.status(404).type("text/plain; charset=utf-8").send("Project not found");
    return;
  }

  const executions = await listProjectExecutions(projectId, 200);
  const lifecycleAudit = await getProjectLifecycleQualityAudit(projectId);
  const report = buildProjectAcceptanceReport(project, { executions, lifecycleAudit });
  const markdown = renderAcceptanceReportMarkdown(report);

  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=\"acceptance-report-${project.id}.md\"`
  );
  res.send(markdown);
}));

router.post("/api/projects/:id/acceptance-report/archive", validateBody(MutationOptionalSchema), asyncRoute(async (req, res) => {
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

  const executions = await listProjectExecutions(projectId, 200);
  const lifecycleAudit = await getProjectLifecycleQualityAudit(projectId);
  const report = buildProjectAcceptanceReport(project, { executions, lifecycleAudit });
  const force = Boolean(req.body?.force);
  if (!force && report.qualityGate && !report.qualityGate.pass) {
    res.status(422).json({
      success: false,
      error: {
        code: "ACCEPTANCE_QUALITY_GATE_BLOCKED",
        message: `验收报告质量门禁未通过（阻断阶段 ${report.qualityGate.blockingStageCount} 项），禁止归档。`,
        qualityGate: report.qualityGate
      }
    });
    return;
  }
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

router.get("/api/projects/:id/final-artifacts", asyncRoute(async (req, res) => {
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

  const report = buildProjectFinalArtifactsReport(
    project,
    activeJob?.officialSite,
    await listProjectExecutions(projectId, 80)
  );

  res.json({
    success: true,
    data: attachFinalArtifactsGeneration(report, activeJob)
  });
}));

router.post("/api/projects/:id/final-artifacts/generate", validateBody(MutationOptionalSchema), asyncRoute(async (req, res) => {
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

router.get("/api/projects/:id/final-artifacts/job", asyncRoute(async (req, res) => {
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

router.get("/api/projects/:id/final-artifacts/jobs/:jobId", asyncRoute(async (req, res) => {
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

router.get("/api/projects/:id/official-site", asyncRoute(async (req, res) => {
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

  let artifact;
  try {
    artifact = await generateOfficialSiteArtifact(project);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/OFFICIAL_SITE_LINK_NOT_FOUND/i.test(message)) {
      res.status(409).json({
        success: false,
        error: {
          code: "OFFICIAL_SITE_LINK_NOT_FOUND",
          message: "未在项目交付物中找到可访问的 HTML 原型链接，请先提交真实交付链接。"
        }
      });
      return;
    }
    throw error;
  }
  const publicPath = String(artifact.publicPath || "").trim();
  const absoluteUrl = /^https?:\/\//i.test(publicPath)
    ? publicPath
    : `${req.protocol}://${req.get("host")}${publicPath.startsWith("/") ? publicPath : `/${publicPath}`}`;
  res.json({
    success: true,
    data: {
      projectId,
      kind: artifact.kind,
      url: absoluteUrl,
      publicPath,
      sourceDeliverableName: artifact.sourceDeliverableName,
      files: artifact.filePaths
    }
  });
}));

router.get("/api/projects/:id/tasks", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const exists = await ensureProjectExists(projectId);
  if (!exists) {
    res.status(404).json({ message: "Project not found" });
    return;
  }
  const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
  const assignee = typeof req.query.assignee === "string" ? req.query.assignee.trim() : "";
  const pageRaw = Number(req.query.page ?? 1);
  const pageSizeRaw = Number(req.query.pageSize ?? req.query.limit ?? 20);
  const page = Number.isFinite(pageRaw) ? Math.max(1, Math.floor(pageRaw)) : 1;
  const pageSize = Number.isFinite(pageSizeRaw) ? Math.max(1, Math.min(100, Math.floor(pageSizeRaw))) : 20;
  const tasks = await listProjectTasks(projectId, { status, assignee, page, pageSize });
  const where = {
    projectId,
    ...(status ? { status } : {}),
    ...(assignee ? { assignee } : {})
  };
  const total = await getCachedTaskTotal(`project:${projectId}:status:${status || "*"}:assignee:${assignee || "*"}`, where);
  res.setHeader("X-Page", String(page));
  res.setHeader("X-Page-Size", String(pageSize));
  res.setHeader("X-Total-Count", String(total));
  res.json(tasks);
}));

router.get("/api/tasks", asyncRoute(async (req, res) => {
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
  const assignee = typeof req.query.assignee === "string" ? req.query.assignee.trim() : "";
  const pageRaw = Number(req.query.page ?? 1);
  const pageSizeRaw = Number(req.query.pageSize ?? req.query.limit ?? 20);
  const page = Number.isFinite(pageRaw) ? Math.max(1, Math.floor(pageRaw)) : 1;
  const pageSize = Number.isFinite(pageSizeRaw) ? Math.max(1, Math.min(100, Math.floor(pageSizeRaw))) : 20;

  if (projectId) {
    const exists = await ensureProjectExists(projectId);
    if (!exists) {
      res.status(404).json({ message: "Project not found" });
      return;
    }
    const scopedTasks = await listProjectTasks(projectId, { status, assignee, page, pageSize });
    const where = {
      projectId,
      ...(status ? { status } : {}),
      ...(assignee ? { assignee } : {})
    };
    const total = await getCachedTaskTotal(`project:${projectId}:status:${status || "*"}:assignee:${assignee || "*"}`, where);
    res.setHeader("X-Page", String(page));
    res.setHeader("X-Page-Size", String(pageSize));
    res.setHeader("X-Total-Count", String(total));
    res.json(scopedTasks);
    return;
  }

  const tasks = await listTasks({ status, assignee, page, pageSize });
  const where = {
    ...(status ? { status } : {}),
    ...(assignee ? { assignee } : {})
  };
  const total = await getCachedTaskTotal(`global:status:${status || "*"}:assignee:${assignee || "*"}`, where);
  res.setHeader("X-Page", String(page));
  res.setHeader("X-Page-Size", String(pageSize));
  res.setHeader("X-Total-Count", String(total));
  res.json(tasks);
}));

const handleApproveProject = asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const currentUser = getCurrentUserFromLocals(res);
  if (!currentUser) {
    if (!LEGACY_DEV_AUTH_BYPASS) {
      res.status(401).json({ message: "authentication required" });
      return;
    }
  }
  if (currentUser) {
    const permissions = await buildProjectPermissions(projectId, currentUser);
    if (!permissions.canApprove) {
      sendForbidden(res, "仅项目负责人/编辑或管理员可以审批阶段");
      return;
    }
  }
  const current = await findProject(projectId);
  if (!current) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  const postCreatePrep = await resolveProjectPostCreatePrepState(current);
  if (postCreatePrep.required && !postCreatePrep.completed) {
    const actions = [buildPostCreatePrepRequiredAction({
      missingItems: postCreatePrep.missingItems
    })];
    res.status(409).json({
      success: false,
      error: {
        code: "REQUIRES_USER_INTERVENTION",
        message: formatRequiredActionsMessage(actions),
        requiredActions: actions,
        postCreatePrep
      }
    });
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
    if (message.startsWith("REAL_MODEL_GATE_FAILED:")) {
      const runtime = await getRuntimeStatus();
      const requiredActions = buildProjectRequiredActions(current, runtime);
      const recovery = buildRealModelGateRecoveryActions({
        project: current,
        requiredActions
      });
      res.status(422).json({
        success: false,
        error: {
          code: "REAL_MODEL_GATE_FAILED",
          message: message.replace("REAL_MODEL_GATE_FAILED:", "").trim(),
          requiredActions: recovery.requiredActions,
          recoveryPlan: recovery.recoveryPlan
        }
      });
      return;
    }
    if (message.startsWith("WORKFLOW_V2_GATE_BLOCKED:")) {
      res.status(422).json({
        success: false,
        error: {
          code: "WORKFLOW_V2_GATE_BLOCKED",
          message: message.replace("WORKFLOW_V2_GATE_BLOCKED:", "").trim() || "workflow-v2 门禁未通过，禁止审批推进。"
        }
      });
      return;
    }
    if (message.startsWith("WORKFLOW_V2_ACTIVE_WITHOUT_CURRENT_STAGE:")) {
      res.status(409).json({
        success: false,
        error: {
          code: "WORKFLOW_V2_ACTIVE_WITHOUT_CURRENT_STAGE",
          message: message.replace("WORKFLOW_V2_ACTIVE_WITHOUT_CURRENT_STAGE:", "").trim() || "workflow-v2 正在运行但当前阶段异常，请先修复流程状态。"
        }
      });
      return;
    }
    if (message.startsWith("DESIGN_REVIEW_NOT_APPROVED:")) {
      res.status(422).json({ message: message.replace("DESIGN_REVIEW_NOT_APPROVED:", "").trim() });
      return;
    }
    if (message.startsWith("DESIGN_VISUAL_PREVIEW_REQUIRED:")) {
      res.status(422).json({ message: message.replace("DESIGN_VISUAL_PREVIEW_REQUIRED:", "").trim() });
      return;
    }
    if (message.startsWith("DESIGN_STITCH_EVIDENCE_REQUIRED:")) {
      res.status(422).json({
        message: "设计阶段已启用 Stitch 硬门禁，当前输出缺少 Stitch 产物证据（链接/导出物）。"
      });
      return;
    }
    if (message.startsWith("DESIGN_STITCH_RUNTIME_FAILED:")) {
      res.status(422).json({
        message: `设计阶段调用 Stitch 失败：${message.replace("DESIGN_STITCH_RUNTIME_FAILED:", "").trim()}`
      });
      return;
    }
    if (message.startsWith("STAGE_TEMPLATE_VALIDATION_FAILED:")) {
      const templateGatePrecheck = await getProjectTemplateGatePrecheck(projectId);
      const autoReconcileEnabled = process.env.NODE_ENV !== "test";
      if (autoReconcileEnabled) {
        // 自动触发一次交付物补齐，避免用户反复手动点击验收。
        void reconcileProjectDeliverablesNow(projectId).catch((reconcileError) => {
          console.warn("Auto reconcile after template validation failed:", reconcileError);
        });
      }
      res.status(422).json({
        success: false,
        error: {
          code: "STAGE_TEMPLATE_VALIDATION_FAILED",
          message: autoReconcileEnabled
            ? `${message.replace("STAGE_TEMPLATE_VALIDATION_FAILED:", "").trim()}（已自动触发交付物补齐，请稍后重试验收）`
            : message.replace("STAGE_TEMPLATE_VALIDATION_FAILED:", "").trim(),
          templateGatePrecheck
        }
      });
      return;
    }
    if (message.startsWith("EXECUTION_PROTOCOL_GATE_FAILED:")) {
      const protocolGatePrecheck = await getProjectExecutionProtocolPrecheck(projectId);
      const rawProtocolMessage = message.replace("EXECUTION_PROTOCOL_GATE_FAILED:", "").trim();
      const runtime = await getRuntimeStatus();
      const requiredActions = buildProjectRequiredActions(current, runtime);
      const diagnostics = buildExecutionProtocolFailureDiagnostics({
        rawMessage: rawProtocolMessage,
        protocolGatePrecheck: protocolGatePrecheck || undefined
      });
      const recovery = buildExecutionProtocolRecoveryActions({
        project: current,
        requiredActions,
        diagnostics
      });
      const renderedMessage = formatTerminalCollaborationViolation(rawProtocolMessage)
        || diagnostics.summary
        || rawProtocolMessage;
      res.status(422).json({
        success: false,
        error: {
          code: "EXECUTION_PROTOCOL_GATE_FAILED",
          message: renderedMessage,
          rawMessage: rawProtocolMessage,
          protocolFailure: diagnostics,
          protocolGatePrecheck,
          requiredActions: recovery.requiredActions,
          recoveryPlan: recovery.recoveryPlan
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
  void trySyncGitLabHarness({
    projectId: project.id,
    stageType: project.currentStage,
    closeOnComplete: project.status === "completed",
    reason: "project.approve"
  });
  void ensureManualAdvanceJob(project.id);
  res.json(project);
});

router.post("/api/projects/:id/approve", validateBody(MutationOptionalSchema), handleApproveProject);
// Backward-compatible alias for clients using PUT semantics.
router.put("/api/projects/:id/approve", validateBody(MutationOptionalSchema), handleApproveProject);

router.post("/api/projects/:id/reject", validateBody(ProjectRejectSchema), asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const currentUser = getCurrentUserFromLocals(res);
  if (!currentUser) {
    if (!LEGACY_DEV_AUTH_BYPASS) {
      res.status(401).json({ message: "authentication required" });
      return;
    }
  }
  if (currentUser) {
    const permissions = await buildProjectPermissions(projectId, currentUser);
    if (!permissions.canApprove) {
      sendForbidden(res, "仅项目负责人/编辑或管理员可以驳回阶段");
      return;
    }
  }
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
  void trySyncGitLabHarness({
    projectId: project.id,
    stageType: project.currentStage,
    reason: "project.reject"
  });
  res.json(project);
}));

router.post("/api/projects/:id/intervene", validateBody(ProjectInterveneSchema), asyncRoute(async (req, res) => {
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
  void trySyncGitLabHarness({
    projectId: project.id,
    stageType: project.currentStage,
    reason: "project.intervene"
  });
  res.json(project);
}));

router.post("/api/projects/:id/resume", validateBody(MutationOptionalSchema), asyncRoute(async (req, res) => {
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
  void ensureManualAdvanceJob(project.id);
  void trySyncGitLabHarness({
    projectId: project.id,
    stageType: project.currentStage,
    reason: "project.resume"
  });
  res.json(project);
}));

router.post("/api/projects/:id/close", validateBody(MutationOptionalSchema), asyncRoute(async (req, res) => {
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
  void trySyncGitLabHarness({
    projectId: project.id,
    stageType: project.currentStage,
    closeOnComplete: true,
    reason: "project.close"
  });
  res.json(project);
}));

router.delete("/api/projects/:id", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const currentUser = getCurrentUserFromLocals(res);
  if (!currentUser) {
    if (!LEGACY_DEV_AUTH_BYPASS) {
      res.status(401).json({ message: "authentication required" });
      return;
    }
  }
  if (currentUser) {
    const permissions = await buildProjectPermissions(projectId, currentUser);
    if (!permissions.canDelete) {
      sendForbidden(res, "仅项目负责人或管理员可以删除项目");
      return;
    }
  }
  markProjectAdvanceCancelled(projectId);
  const deleted = await deleteProject(projectId);

  if (!deleted) {
    clearProjectAdvanceCancelled(projectId);
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

  projectAdvanceJobErrors.delete(projectId);
  projectAdvanceJobs.delete(projectId);
  projectAdvanceLocks.delete(projectId);
  projectAdvanceStates.delete(projectId);

  res.json({ success: true, id: projectId });
}));

router.post("/api/projects/:id/stages/submit", validateBody(ProjectStageSubmitSchema), asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const payload = req.body as StageSubmissionInput;
  const deliverables = Array.isArray((payload as { deliverables?: Array<{ name?: string; content?: string }> })?.deliverables)
    ? (payload as { deliverables?: Array<{ name?: string; content?: string }> }).deliverables ?? []
    : [];
  const normalizedDeliverableContent = deliverables
    .map((item) => {
      const name = String(item?.name ?? "").trim();
      const body = String(item?.content ?? "").trim();
      if (!name || !body) {
        return "";
      }
      return `## ${name}\n${body}`;
    })
    .filter(Boolean)
    .join("\n\n");
  const content = String(payload?.content ?? "").trim() || normalizedDeliverableContent;
  const finalizeApproval =
    typeof req.body?.finalizeApproval === "boolean"
      ? req.body.finalizeApproval
      : !/设计审查卡/i.test(String(payload?.title || ""));

  if (!content) {
    res.status(400).json({ message: "content is required" });
    return;
  }
  const stageSnapshot = await findProject(projectId);
  const shouldEnforceDevSourceCodeEvidence = String(stageSnapshot?.currentStage || "").toUpperCase() === "DEV";
  if (shouldEnforceDevSourceCodeEvidence) {
    const normalized = content.toLowerCase();
    const hasSourceCodeMarker = /(sourcecode|source code|代码路径|code path|src\/|apps\/|packages\/)/i.test(normalized);
    if (!hasSourceCodeMarker) {
      res.status(422).json({
        success: false,
        error: {
          code: "SOURCE_CODE_EVIDENCE_REQUIRED",
          message: "开发阶段提交缺少 sourceCode 证据，请在内容中包含代码路径或 sourceCode 章节。"
        }
      });
      return;
    }
  }

  let project;
  try {
    project = await submitCurrentStage(projectId, {
      title: payload?.title,
      content,
      designReview: payload?.designReview
    }, {
      finalizeApproval
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
    if (message.startsWith("DESIGN_VISUAL_PREVIEW_REQUIRED:")) {
      res.status(422).json({ message: message.replace("DESIGN_VISUAL_PREVIEW_REQUIRED:", "").trim() });
      return;
    }
    if (message.startsWith("DESIGN_STITCH_EVIDENCE_REQUIRED:")) {
      res.status(422).json({
        message: "设计阶段已启用 Stitch 硬门禁，当前输出缺少 Stitch 产物证据（链接/导出物）。"
      });
      return;
    }
    if (message.startsWith("DESIGN_STITCH_RUNTIME_FAILED:")) {
      res.status(422).json({
        message: `设计阶段调用 Stitch 失败：${message.replace("DESIGN_STITCH_RUNTIME_FAILED:", "").trim()}`
      });
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

  // Bridge legacy stage submission into workflow-v2 artifacts to avoid gate mismatch.
  try {
    const activeWorkflow = await getActiveWorkflow(projectId);
    const hasActiveWorkflowStage = Array.isArray(activeWorkflow.currentStageIds)
      && activeWorkflow.currentStageIds.length > 0;
    if (!hasActiveWorkflowStage) {
      res.status(409).json({
        success: false,
        error: {
          code: "WORKFLOW_STAGE_NOT_ACTIVE",
          message: "当前 workflow 未激活到可提交阶段，请先推进到目标阶段后再提交交付物。"
        }
      });
      return;
    }
    const currentStageIds = Array.isArray(activeWorkflow.currentStageIds) ? activeWorkflow.currentStageIds as string[] : [];
    const currentStageType = String(project.currentStage || "").toUpperCase();
    const templateByStageType: Record<string, string> = {
      ANALYSIS: "requirements_design",
      DESIGN: "visual_design",
      DEV: "code_dev",
      ACCEPT: "qa_acceptance"
    };
    const preferredTemplateKey = templateByStageType[currentStageType] || "";
    const stageIdFromCurrent = String(currentStageIds[0] || "").trim();
    const stageIdFromTemplate = String(
      activeWorkflow.stages.find((item) => String(item.templateKey || "").trim() === preferredTemplateKey)?.id || ""
    ).trim();
    const targetStageId = stageIdFromCurrent || stageIdFromTemplate;
    if (targetStageId) {
      const explicitTitle = String(payload?.title || "").trim();
      const artifactNames = new Set<string>();
      if (explicitTitle) {
        artifactNames.add(explicitTitle);
      }
      if (currentStageType === "DEV") {
        artifactNames.add("sourceCode");
      } else if (currentStageType === "ACCEPT") {
        artifactNames.add("testReport");
      } else if (!explicitTitle) {
        artifactNames.add("deliverable");
      }
      for (const artifactName of artifactNames) {
        await addStageOutputArtifact({
          stageId: targetStageId,
          artifact: {
            name: artifactName,
            type: "markdown",
            content,
            createdAt: new Date().toISOString(),
            metadata: {
              source: "legacy_stage_submit_bridge",
              projectId,
              stageType: project.currentStage
            }
          }
        });
      }
    }

    // Semantic fallback: when submit payload contains dev/qa evidence, bridge to matching workflow template stage
    // even if project.currentStage has drifted from workflow current stage.
    const normalizedTitle = String(payload?.title || "").toLowerCase();
    const normalizedContent = content.toLowerCase();
    const looksLikeSourceCode = /(sourcecode|source code|代码路径|src\/|apps\/|packages\/|变更证据)/i.test(
      `${normalizedTitle}\n${normalizedContent}`
    );
    const looksLikeTestReport = /(testreport|test report|测试报告|缺陷分级|测试覆盖矩阵)/i.test(
      `${normalizedTitle}\n${normalizedContent}`
    );
    if (looksLikeSourceCode) {
      const codeDevStage = activeWorkflow.stages.find((item) => String(item.templateKey || "") === "code_dev");
      if (codeDevStage) {
        await addStageOutputArtifact({
          stageId: codeDevStage.id,
          artifact: {
            name: "sourceCode",
            type: "markdown",
            content,
            createdAt: new Date().toISOString(),
            metadata: {
              source: "legacy_stage_submit_bridge_semantic",
              projectId,
              stageType: "DEV"
            }
          }
        });
      }
    }
    if (looksLikeTestReport) {
      const qaStage = activeWorkflow.stages.find((item) => String(item.templateKey || "") === "qa_acceptance");
      if (qaStage) {
        await addStageOutputArtifact({
          stageId: qaStage.id,
          artifact: {
            name: "testReport",
            type: "markdown",
            content,
            createdAt: new Date().toISOString(),
            metadata: {
              source: "legacy_stage_submit_bridge_semantic",
              projectId,
              stageType: "ACCEPT"
            }
          }
        });
      }
    }
  } catch {
    // Best effort bridge for compatibility; submission already succeeded in legacy path.
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.stage_submitted",
    resourceType: "project",
    resourceId: project.id,
    summary: `提交项目 ${project.id} 当前阶段交付物`
  });
  void trySyncGitLabHarness({
    projectId: project.id,
    stageType: project.currentStage,
    reason: "project.stage_submit"
  });
  res.json(project);
}));

router.post("/api/projects/:id/messages", validateBody(ProjectMessageSchema), asyncRoute(async (req, res) => {
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

router.patch("/api/tasks/:taskId", validateBody(TaskStatusUpdateSchema), asyncRoute(async (req, res) => {
  const taskId = String(req.params.taskId);
  const payload = req.body as TaskUpdateInput;
  const status = payload?.status;

  if (!status) {
    res.status(400).json({ message: "status is required" });
    return;
  }

  let task;
  try {
    task = await updateTaskStatus(taskId, status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "task update failed";
    if (message === "TASK_PENDING_DELEGATIONS") {
      res.status(409).json({
        success: false,
        error: {
          code: "TASK_PENDING_DELEGATIONS",
          message: "当前任务仍有未完成 delegation，不能直接标记为完成。"
        }
      });
      return;
    }
    if (message.startsWith("TASK_BLOCKED_BY_DEPENDENCIES:")) {
      res.status(409).json({
        success: false,
        error: {
          code: "TASK_BLOCKED_BY_DEPENDENCIES",
          message: "当前任务仍受 blocks 依赖限制，需先完成依赖任务后再推进。",
          dependsOnTaskId: message.replace("TASK_BLOCKED_BY_DEPENDENCIES:", "").trim() || undefined
        }
      });
      return;
    }
    throw error;
  }

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
  void trySyncGitLabHarness({
    projectId: task.projectId,
    stageType: task.stageType,
    reason: "task.update"
  });
  if (task.status === "pending_approval") {
    void publishTaskIssueNote({
      taskId: task.id,
      body: "任务已进入待审批状态，等待人工审批/验收结果。"
    }).catch(() => undefined);
  }
  if (task.status === "blocked" && task.blockedReason?.detail) {
    void publishTaskIssueNote({
      taskId: task.id,
      body: `任务进入阻塞状态：${task.blockedReason.detail}`
    }).catch(() => undefined);
  }
  void syncTaskStatus(task.id).catch(() => undefined);
  res.json(task);
}));
router.get("/api/projects/:id/live", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId, {
    detailLevel: "api",
    skipWorkflowStateReconcile: true
  });

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
    const currentProject = await findProject(projectId, {
      detailLevel: "api",
      skipWorkflowStateReconcile: true
    });

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

  return router;
}
