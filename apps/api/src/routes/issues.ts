import type { RoleType } from "@occ/shared";
import { randomUUID } from "node:crypto";
import express from "express";
import { getRuntimeStatus } from "../agents/runtime.js";
import { createProject } from "../data/repository.js";
import { getIndustryConfig, listIndustryConfigs } from "./role-sets.js";
import { asyncRoute, sendError, sendSuccess } from "./utils.js";
import {
  buildContextAlignment,
  buildDesignBlueprint,
  buildExpectedArtifacts,
  buildClarificationQuestions,
  buildIssueDiscussion,
  buildRelatedHistory,
  buildRequirementContract,
  buildRequirementRefinement,
  buildSuggestedAnswers,
  detectIndustry,
  detectConflicts,
  inferIssueSummary,
  inferIssueTitle,
  recommendRoles,
  synthesizeIssueArtifactsFromDebate
} from "../system/issue-engine.js";
import { buildIssueRoleDebate, type IssueDebateResult as RuntimeIssueDebateResult } from "../system/issue-debate.js";
import {
  appendRequirementBackfill,
  createIssueDraft,
  getIssue,
  getProductContext,
  listIssues,
  resolveRequirementMismatches,
  updateIssue,
  type IssueAnalysisGate,
  type IssueAnalysisGateCheck,
  type IssueDebateTaskStatus,
  type IssueDiscussionItem,
  type IssueSourceType
} from "../system/v1-method-store.js";

interface PreviewIssueBody {
  input?: unknown;
  industryCode?: unknown;
  sourceType?: unknown;
  debateMode?: unknown;
}

interface ConfirmIssueBody {
  clarificationAnswers?: unknown;
  finalName?: unknown;
  finalDescription?: unknown;
  teamRoleIds?: unknown;
  conflictResolution?: unknown;
}

const ROLE_IDS: RoleType[] = [
  "ROLE_ASSISTANT",
  "ROLE_PM",
  "ROLE_ANALYST",
  "ROLE_PRODUCT",
  "ROLE_DESIGN",
  "ROLE_ARCH",
  "ROLE_DEV",
  "ROLE_QA",
  "ROLE_HR"
];

function normalizeSourceType(input: unknown): IssueSourceType {
  const value = String(input ?? "").trim().toLowerCase();
  if (
    value === "meeting_notes"
    || value === "journey"
    || value === "competitor"
    || value === "file_import"
    || value === "prd"
  ) {
    return value;
  }
  return "text";
}

function normalizeDebateMode(input: unknown) {
  const value = String(input ?? "").trim().toLowerCase();
  if (value === "off") {
    return "off" as const;
  }
  if (value === "model") {
    return "model" as const;
  }
  return "auto" as const;
}

function normalizeRoleList(input: unknown) {
  if (!Array.isArray(input)) {
    return [] as RoleType[];
  }
  return input
    .map((item) => String(item ?? "").trim().toUpperCase())
    .filter((item): item is RoleType => ROLE_IDS.includes(item as RoleType));
}

function normalizeStringMap(input: unknown) {
  if (!input || typeof input !== "object") {
    return {} as Record<string, string>;
  }

  return Object.entries(input as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, value]) => {
    const k = String(key ?? "").trim();
    const v = String(value ?? "").trim();
    if (k && v) {
      acc[k] = v;
    }
    return acc;
  }, {});
}

interface CreateIssuesRouterOptions {
  onProjectCreated?: (projectId: string) => void | Promise<void>;
}

interface DebateTaskState {
  taskId: string;
  issueId: string;
  status: IssueDebateTaskStatus;
  createdAt: string;
  updatedAt: string;
  debate: RuntimeIssueDebateResult | null;
  discussion: IssueDiscussionItem[];
  discussionDraft: IssueDiscussionItem[];
  error?: string;
}

const ISSUE_DEBATE_POLL_AFTER_MS = Math.max(800, Number(process.env.ISSUE_DEBATE_POLL_MS ?? 1500));
const ISSUE_DEBATE_STALE_TIMEOUT_MS = Math.max(45_000, Number(process.env.ISSUE_DEBATE_STALE_TIMEOUT_MS ?? 180_000));
const issueDebateTaskStore = new Map<string, DebateTaskState>();
const issueLatestDebateTask = new Map<string, string>();

function nowIso() {
  return new Date().toISOString();
}

function isDebateTaskStale(task: DebateTaskState) {
  const updatedAtMs = Date.parse(task.updatedAt || task.createdAt);
  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }
  return (Date.now() - updatedAtMs) > ISSUE_DEBATE_STALE_TIMEOUT_MS;
}

function toDiscussionFromDebate(
  debate: RuntimeIssueDebateResult | null | undefined,
  fallback: IssueDiscussionItem[]
) {
  if (!debate || debate.opinions.length === 0) {
    return fallback;
  }

  return debate.opinions.map((item) => ({
    id: item.id,
    roleId: item.roleId,
    roleLabel: item.roleLabel,
    focus: item.focus,
    concern: item.concern,
    proposal: item.proposal
  }));
}

function buildIssueAnalysisGate(input: {
  runtime: Awaited<ReturnType<typeof getRuntimeStatus>>;
  debateStatus?: IssueDebateTaskStatus | null;
  debate?: { mode?: string | null } | null;
  shouldCreateDebateTask: boolean;
}): IssueAnalysisGate {
  const checks: IssueAnalysisGateCheck[] = [];

  const runtimeReady = input.runtime.mode !== "scripted";
  checks.push({
    id: "runtime-real-model",
    label: "运行时必须启用真实模型",
    passed: runtimeReady,
    detail: runtimeReady
      ? `当前运行模式为 ${input.runtime.mode}，可用于真实多角色讨论。`
      : "当前运行模式仍为 scripted，讨论输出可能是模板/降级结果。"
  });

  const debateEnabled = input.shouldCreateDebateTask;
  checks.push({
    id: "debate-enabled",
    label: "必须启用真实多角色讨论",
    passed: debateEnabled,
    detail: debateEnabled
      ? "已创建真实多角色讨论任务。"
      : "当前分析未启用真实多角色讨论，不能以草稿提示替代正式结论。"
  });

  const debateCompleted = input.debate?.mode === "model";
  const debateStatusLabel = input.debateStatus ?? "missing";
  checks.push({
    id: "debate-model-completed",
    label: "正式讨论必须由真实模型完成",
    passed: debateCompleted,
    detail: debateCompleted
      ? "真实模型多角色讨论已完成，可作为正式分析结论。"
      : debateStatusLabel === "queued" || debateStatusLabel === "running"
        ? "真实模型多角色讨论仍在进行中，需等待完成后再推进。"
        : debateStatusLabel === "failed"
          ? "真实模型多角色讨论执行失败，当前阶段已阻断。"
          : input.debate
            ? "当前仅得到降级/scripted 讨论结果，不能作为正式分析结论。"
            : "尚未产生真实模型多角色讨论结果。"
  });

  return {
    canProceed: checks.every((item) => item.passed),
    blockers: checks.filter((item) => !item.passed).map((item) => item.detail),
    checks,
    runtimeMode: input.runtime.mode,
    requestedRuntimeMode: String(input.runtime.requestedMode ?? input.runtime.mode)
  };
}

function createDebateTaskId(issueId: string) {
  return `debate-${issueId}-${randomUUID().slice(0, 8)}`;
}

function startIssueDebateTask(input: {
  taskId: string;
  issueId: string;
  rawInput: string;
  title: string;
  summary: string;
  industryCode: string;
  recommendedRoleIds: RoleType[];
  soulRoleId: RoleType;
  fallbackDiscussion: IssueDiscussionItem[];
}) {
  const startedAt = nowIso();
  const queuedState: DebateTaskState = {
    taskId: input.taskId,
    issueId: input.issueId,
    status: "queued",
    createdAt: startedAt,
    updatedAt: startedAt,
    debate: null,
    discussion: [],
    discussionDraft: input.fallbackDiscussion
  };
  issueDebateTaskStore.set(input.taskId, queuedState);
  issueLatestDebateTask.set(input.issueId, input.taskId);

  void (async () => {
    const runningAt = nowIso();
    issueDebateTaskStore.set(input.taskId, {
      ...queuedState,
      status: "running",
      updatedAt: runningAt
    });

    await updateIssue(input.issueId, (current) => ({
      ...current,
      debateStatus: "running",
      debateTaskId: input.taskId,
      debateError: "",
      debateUpdatedAt: runningAt
    }));

    try {
      const debate = await buildIssueRoleDebate({
        input: input.rawInput,
        title: input.title,
        summary: input.summary,
        recommendedRoleIds: input.recommendedRoleIds,
        soulRoleId: input.soulRoleId,
        industryCode: input.industryCode
      });
      const discussion = toDiscussionFromDebate(debate, input.fallbackDiscussion);
      const formalDiscussion = debate.mode === "model" ? discussion : [];
      const draftIssue = await getIssue(input.issueId);
      const synthesized = debate.mode === "model"
        && draftIssue?.refinement
        && draftIssue.contextAlignment
        && draftIssue.designBlueprint
        && draftIssue.suggestedAnswers
        && draftIssue.requirementContract
        ? synthesizeIssueArtifactsFromDebate({
            rawInput: input.rawInput,
            productContext: await getProductContext(),
            industryCode: input.industryCode,
            questions: draftIssue.questions,
            expectedArtifacts: buildExpectedArtifacts(),
            draft: {
              summary: draftIssue.summary,
              refinement: draftIssue.refinement,
              contextAlignment: draftIssue.contextAlignment,
              designBlueprint: draftIssue.designBlueprint,
              suggestedAnswers: draftIssue.suggestedAnswers,
              requirementContract: draftIssue.requirementContract
            },
            debate
          })
        : null;
      const completedAt = nowIso();
      issueDebateTaskStore.set(input.taskId, {
        taskId: input.taskId,
        issueId: input.issueId,
        status: "completed",
        createdAt: startedAt,
        updatedAt: completedAt,
        debate,
        discussion: formalDiscussion,
        discussionDraft: input.fallbackDiscussion
      });

      await updateIssue(input.issueId, (current) => ({
        ...current,
        summary: synthesized?.summary ?? current.summary,
        refinement: synthesized?.refinement ?? current.refinement,
        contextAlignment: synthesized?.contextAlignment ?? current.contextAlignment,
        designBlueprint: synthesized?.designBlueprint ?? current.designBlueprint,
        suggestedAnswers: synthesized?.suggestedAnswers ?? current.suggestedAnswers,
        requirementContract: synthesized?.requirementContract ?? current.requirementContract,
        discussion: formalDiscussion,
        discussionDraft: input.fallbackDiscussion,
        debate,
        debateStatus: "completed",
        debateTaskId: input.taskId,
        debateError: "",
        debateUpdatedAt: completedAt
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Issue debate task failed";
      const failedAt = nowIso();
      issueDebateTaskStore.set(input.taskId, {
        taskId: input.taskId,
        issueId: input.issueId,
        status: "failed",
        createdAt: startedAt,
        updatedAt: failedAt,
        debate: null,
        discussion: [],
        discussionDraft: input.fallbackDiscussion,
        error: message
      });

      await updateIssue(input.issueId, (current) => ({
        ...current,
        discussion: [],
        discussionDraft: input.fallbackDiscussion,
        debate: current.debate ?? null,
        debateStatus: "failed",
        debateTaskId: input.taskId,
        debateError: message,
        debateUpdatedAt: failedAt
      }));
    }
  })();
}

export function createIssuesRouter(options: CreateIssuesRouterOptions = {}) {
  const router = express.Router();

  router.get("/", asyncRoute(async (req, res) => {
    const status = String(req.query.status ?? "").trim().toLowerCase();
    const data = await listIssues(
      status === "draft" || status === "confirmed" || status === "cancelled"
        ? status
        : undefined
    );
    sendSuccess(res, data);
  }));

  router.get("/:issueId/debate", asyncRoute(async (req, res) => {
    const issueId = String(req.params.issueId ?? "").trim();
    const issue = await getIssue(issueId);
    if (!issue) {
      sendError(res, 404, "NOT_FOUND", `Issue not found: ${issueId}`);
      return;
    }

    const requestedTaskId = String(req.query.taskId ?? "").trim();
    const taskId = requestedTaskId || issueLatestDebateTask.get(issueId) || issue.debateTaskId || "";
    let task = taskId ? issueDebateTaskStore.get(taskId) : null;
    if (task && task.issueId !== issueId) {
      sendError(res, 400, "VALIDATION_ERROR", "taskId does not belong to the issue");
      return;
    }

    if (task && (task.status === "queued" || task.status === "running") && isDebateTaskStale(task)) {
      const failedAt = nowIso();
      const timeoutMessage = "真实多角色讨论任务长时间未完成，已自动标记超时失败，请重新发起讨论。";
      task = {
        ...task,
        status: "failed",
        updatedAt: failedAt,
        error: timeoutMessage
      };
      issueDebateTaskStore.set(taskId, task);
      await updateIssue(issueId, (current) => ({
        ...current,
        debateStatus: "failed",
        debateTaskId: taskId,
        debateError: timeoutMessage,
        debateUpdatedAt: failedAt
      }));
    }

    const status: IssueDebateTaskStatus = task?.status
      ?? issue.debateStatus
      ?? (issue.debate ? "completed" : "failed");
    const discussion = task?.discussion?.length ? task.discussion : (issue.discussion ?? []);
    const discussionDraft = task?.discussionDraft?.length ? task.discussionDraft : (issue.discussionDraft ?? []);
    const debate = task?.debate ?? issue.debate ?? null;
    const error = task?.error || issue.debateError || "";
    const runtime = await getRuntimeStatus();
    const analysisGate = buildIssueAnalysisGate({
      runtime,
      debateStatus: status,
      debate,
      shouldCreateDebateTask: Boolean(issue.debateTaskId)
    });

    sendSuccess(res, {
      issueId,
      taskId: taskId || null,
      status,
      summary: issue.summary,
      refinement: issue.refinement ?? null,
      contextAlignment: issue.contextAlignment ?? null,
      designBlueprint: issue.designBlueprint ?? null,
      suggestedAnswers: issue.suggestedAnswers ?? [],
      requirementContract: issue.requirementContract ?? null,
      discussion,
      discussionDraft,
      debate,
      analysisGate,
      error: error || null,
      updatedAt: task?.updatedAt || issue.debateUpdatedAt || issue.updatedAt,
      pollAfterMs: status === "queued" || status === "running" ? ISSUE_DEBATE_POLL_AFTER_MS : 0
    });
  }));

  router.get("/:issueId", asyncRoute(async (req, res) => {
    const issueId = String(req.params.issueId ?? "").trim();
    const issue = await getIssue(issueId);
    if (!issue) {
      sendError(res, 404, "NOT_FOUND", `Issue not found: ${issueId}`);
      return;
    }
    sendSuccess(res, issue);
  }));

  router.post("/preview", asyncRoute(async (req, res) => {
    const payload = (req.body ?? {}) as PreviewIssueBody;
    const input = String(payload.input ?? "").trim();
    const industryCode = String(payload.industryCode ?? "").trim().toLowerCase();
    const sourceType = normalizeSourceType(payload.sourceType);
    const debateMode = normalizeDebateMode(payload.debateMode);

    if (!input) {
      sendError(res, 400, "VALIDATION_ERROR", "input is required");
      return;
    }

    const resolvedIndustryCode = industryCode || detectIndustry(input) || "saas";
    const config = getIndustryConfig(resolvedIndustryCode)
      ?? getIndustryConfig("saas")
      ?? listIndustryConfigs()[0];
    if (!config) {
      sendError(res, 503, "SERVICE_UNAVAILABLE", "No industry role sets configured");
      return;
    }

    const productContext = await getProductContext();
    const title = inferIssueTitle(input);
    const summary = inferIssueSummary(input);
    const conflicts = detectConflicts(input, productContext, {
      industryCode: config.roleSet.industryCode
    });
    const questions = buildClarificationQuestions(input);
    const refinement = buildRequirementRefinement(input);
    const contextAlignment = buildContextAlignment(input, productContext, {
      industryCode: config.roleSet.industryCode
    });
    const designBlueprint = buildDesignBlueprint({
      rawInput: input,
      refinement,
      alignment: contextAlignment
    });
    const recommendedRoleIds = recommendRoles(input, config);
    const ruleDiscussion = buildIssueDiscussion(
      input,
      recommendedRoleIds as RoleType[],
      config.assemblyRule.soulRoleId
    );
    const discussion = ruleDiscussion;
    const suggestedAnswers = buildSuggestedAnswers({
      rawInput: input,
      questions,
      refinement,
      alignment: contextAlignment,
      industryCode: config.roleSet.industryCode,
      discussion
    });
    const relatedHistory = buildRelatedHistory(input, productContext.requirementHistory ?? []);
    const expectedArtifacts = buildExpectedArtifacts();
    const requirementContract = buildRequirementContract({
      suggestedAnswers,
      refinement,
      designBlueprint,
      expectedArtifacts
    });
    const shouldCreateDebateTask = debateMode !== "off";
    const debateTaskId = shouldCreateDebateTask ? createDebateTaskId(`issue-${Date.now()}`) : undefined;
    const debateStatus: IssueDebateTaskStatus = shouldCreateDebateTask ? "queued" : "completed";
    const runtime = await getRuntimeStatus();
    const analysisGate = buildIssueAnalysisGate({
      runtime,
      debateStatus,
      debate: null,
      shouldCreateDebateTask
    });

    const issue = await createIssueDraft({
      title,
      sourceType,
      rawInput: input,
      industryCode: config.roleSet.industryCode,
      summary,
      recommendedRoleIds,
      soulRoleId: config.assemblyRule.soulRoleId,
      conflicts,
      questions,
      refinement,
      contextAlignment,
      designBlueprint,
      suggestedAnswers,
      relatedHistory,
      requirementContract,
      discussion: [],
      discussionDraft: discussion,
      debate: null,
      debateStatus,
      debateTaskId,
      debateError: "",
      debateUpdatedAt: nowIso()
    });

    const activeDebateTaskId = shouldCreateDebateTask
      ? issue.debateTaskId || createDebateTaskId(issue.id)
      : undefined;
    if (shouldCreateDebateTask && activeDebateTaskId) {
      startIssueDebateTask({
        taskId: activeDebateTaskId,
        issueId: issue.id,
        rawInput: input,
        title,
        summary,
        industryCode: config.roleSet.industryCode,
        recommendedRoleIds: recommendedRoleIds as RoleType[],
        soulRoleId: config.assemblyRule.soulRoleId,
        fallbackDiscussion: ruleDiscussion
      });
    }

    sendSuccess(res, {
      issueId: issue.id,
      title: issue.title,
      summary: issue.summary,
      industryCode: issue.industryCode,
      recommendedRoleIds: issue.recommendedRoleIds,
      soulRoleId: issue.soulRoleId,
      conflicts: issue.conflicts,
      questions: issue.questions,
      contextAlignment,
      designBlueprint,
      suggestedAnswers,
      relatedHistory,
      requirementContract,
      refinement,
      discussion: [],
      discussionDraft: discussion,
      debate: null,
      debateTask: activeDebateTaskId
        ? {
            taskId: activeDebateTaskId,
            status: "queued" as const,
            pollAfterMs: ISSUE_DEBATE_POLL_AFTER_MS
          }
        : null,
      analysisGate,
      expectedArtifacts,
      workflow: config.workflows.find((item) => item.isDefault) ?? config.workflows[0] ?? null
    });
  }));

  router.post("/:issueId/confirm", asyncRoute(async (req, res) => {
    const issueId = String(req.params.issueId ?? "").trim();
    const payload = (req.body ?? {}) as ConfirmIssueBody;
    const issue = await getIssue(issueId);

    if (!issue) {
      sendError(res, 404, "NOT_FOUND", `Issue not found: ${issueId}`);
      return;
    }

    if (issue.status === "confirmed" && issue.createdProjectId) {
      sendSuccess(res, issue);
      return;
    }

    const config = getIndustryConfig(issue.industryCode) ?? listIndustryConfigs()[0];
    if (!config) {
      sendError(res, 503, "SERVICE_UNAVAILABLE", "No industry role sets configured");
      return;
    }

    const clarificationAnswers = normalizeStringMap(payload.clarificationAnswers);
    const conflictResolution = String(payload.conflictResolution ?? "").trim();
    const requiredQuestions = issue.questions.filter((question) => question.required);
    const missingRequired = requiredQuestions.find((question) => !String(clarificationAnswers[question.id] ?? "").trim());
    if (missingRequired) {
      sendError(res, 400, "VALIDATION_ERROR", `missing required clarification: ${missingRequired.id}`);
      return;
    }
    const hasCriticalConflict = issue.conflicts.some((conflict) => conflict.severity === "critical");
    const hasSceneValidationFailure = issue.conflicts.some((conflict) => conflict.id === "crossborder-scene-not-hit");
    if (hasSceneValidationFailure) {
      sendError(res, 400, "VALIDATION_ERROR", "场景命中校验未通过：请补充跨境选品/跟品关键词后重新分析。");
      return;
    }
    if (hasCriticalConflict && !conflictResolution) {
      sendError(res, 400, "VALIDATION_ERROR", "missing required conflict resolution");
      return;
    }
    const hasMismatchConflict = issue.conflicts.some((conflict) => conflict.id === "unresolved-requirement-mismatch");
    if (hasMismatchConflict && conflictResolution) {
      await resolveRequirementMismatches({
        resolution: conflictResolution,
        limit: 3
      });
    }

    const runtime = await getRuntimeStatus();
    const analysisGate = buildIssueAnalysisGate({
      runtime,
      debateStatus: issue.debateStatus ?? null,
      debate: issue.debate ?? null,
      shouldCreateDebateTask: Boolean(issue.debateTaskId)
    });
    if (!analysisGate.canProceed) {
      res.status(409).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: analysisGate.blockers[0] || "分析阶段尚未满足推进条件。",
          analysisGate
        }
      });
      return;
    }

    const requestedTeamRoleIds = normalizeRoleList(payload.teamRoleIds);
    const selectedRoleIds = requestedTeamRoleIds.length > 0
      ? requestedTeamRoleIds
      : issue.recommendedRoleIds.filter((roleId): roleId is RoleType => ROLE_IDS.includes(roleId as RoleType));
    const allowedRoleSet = new Set(config.roleSet.roleIds);
    const constrainedRoleIds = selectedRoleIds.filter((roleId) => allowedRoleSet.has(roleId));

    if (config.assemblyRule.mustHaveSoulRole && !constrainedRoleIds.includes(config.assemblyRule.soulRoleId)) {
      constrainedRoleIds.unshift(config.assemblyRule.soulRoleId);
    }

    const finalName = String(payload.finalName ?? issue.title).trim() || issue.title;
    const finalDescription = String(payload.finalDescription ?? issue.rawInput).trim() || issue.rawInput;
    const clarificationBlock = Object.entries(clarificationAnswers)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
    const conflictResolutionBlock = conflictResolution ? `\n冲突解决说明:\n${conflictResolution}` : "";
    const projectDescription = clarificationBlock
      ? `${finalDescription}\n\n澄清补充:\n${clarificationBlock}${conflictResolutionBlock}`
      : finalDescription;
    const confirmedContract = {
      objective: clarificationAnswers.goal || issue.requirementContract?.objective || "",
      inScope: clarificationAnswers.scope
        ? [clarificationAnswers.scope, ...(issue.requirementContract?.inScope ?? [])]
        : issue.requirementContract?.inScope ?? [],
      outOfScope: issue.requirementContract?.outOfScope ?? [],
      acceptanceCriteria: clarificationAnswers.acceptance
        ? [clarificationAnswers.acceptance, ...(issue.requirementContract?.acceptanceCriteria ?? [])]
        : issue.requirementContract?.acceptanceCriteria ?? [],
      artifacts: issue.requirementContract?.artifacts ?? [],
      designTheme: issue.requirementContract?.designTheme,
      valueNarrative: issue.requirementContract?.valueNarrative
    };
    const requirementContractBlock = [
      "需求确认单:",
      `- 目标: ${confirmedContract.objective || "信息未提供"}`,
      `- In Scope: ${(confirmedContract.inScope || []).slice(0, 3).join("；") || "信息未提供"}`,
      `- Out of Scope: ${(confirmedContract.outOfScope || []).slice(0, 3).join("；") || "信息未提供"}`,
      `- 验收: ${(confirmedContract.acceptanceCriteria || []).slice(0, 3).join("；") || "信息未提供"}`,
      `- 产出: ${(confirmedContract.artifacts || []).join("、") || "信息未提供"}`
    ].join("\n");
    const finalProjectDescription = `${projectDescription}\n\n${requirementContractBlock}`;

    const project = await createProject(
      {
        name: finalName,
        description: finalProjectDescription,
        team: constrainedRoleIds,
        requirementContract: confirmedContract
      },
      runtime.mode
    );

    const updated = await updateIssue(issueId, (current) => ({
      ...current,
      clarificationAnswers,
      conflictResolution,
      requirementContract: confirmedContract,
      status: "confirmed",
      createdProjectId: project.id
    }));

    await appendRequirementBackfill({
      issueId: issue.id,
      projectId: project.id,
      title: finalName,
      refinedRequirement: finalProjectDescription,
      status: "in_progress",
      validationStatus: "pending",
      requirementContract: confirmedContract
    });

    await options.onProjectCreated?.(project.id);
    sendSuccess(res, {
      issue: updated,
      project,
      backfill: {
        summary: `需求已落地为项目 ${project.name}，并写入团队角色编排。`,
        teamRoleIds: constrainedRoleIds
      }
    });
  }));

  router.post("/:issueId/cancel", asyncRoute(async (req, res) => {
    const issueId = String(req.params.issueId ?? "").trim();
    const updated = await updateIssue(issueId, (current) => ({
      ...current,
      status: "cancelled"
    }));

    if (!updated) {
      sendError(res, 404, "NOT_FOUND", `Issue not found: ${issueId}`);
      return;
    }

    sendSuccess(res, updated);
  }));

  return router;
}
