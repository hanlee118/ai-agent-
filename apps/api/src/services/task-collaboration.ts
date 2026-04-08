import type {
  TaskBlockedReason,
  TaskDelegationSummary,
  TaskDependencySummary,
  TaskGitLabSyncInfo,
  TaskNextAction,
  TaskStatus
} from "@occ/shared";

const GITLAB_BASE_URL = String(process.env.GITLAB_BASE_URL || "https://gitlab.com").trim().replace(/\/$/, "");

const DONE_STATUSES = new Set(["done", "completed"]);

function toIsoString(value?: Date | null) {
  return value ? value.toISOString() : undefined;
}

function formatBlockedReasonLabel(code: TaskBlockedReason["code"]) {
  switch (code) {
    case "dependency_blocked":
      return "依赖阻塞";
    case "delegation_failed":
      return "委派执行失败";
    case "pending_approval":
      return "等待审批";
    case "external_sync_blocked":
      return "外部同步阻塞";
    case "manual_intervention_required":
    default:
      return "需要人工介入";
  }
}

function formatNextActionLabel(code: TaskNextAction["code"]) {
  switch (code) {
    case "waiting_for_owner":
      return "等待 Owner 接手";
    case "waiting_for_reviewer":
      return "等待 Reviewer 处理";
    case "waiting_for_dependency":
      return "等待依赖任务完成";
    case "waiting_for_retry":
      return "等待重试";
    case "waiting_for_approval":
    default:
      return "等待审批";
  }
}

function extractBlockedReasonNote(description: string) {
  const source = String(description || "").trim();
  if (!source) {
    return "";
  }
  const matched = source.match(/## Blocked Reason\s*([\s\S]*?)(?:\n##\s|$)/i);
  if (!matched?.[1]) {
    return "";
  }
  return matched[1]
    .split("\n")
    .map((line) => line.trim().replace(/^[-*]\s*/, ""))
    .filter(Boolean)
    .join(" ")
    .trim();
}

function buildTaskDependencySummary(input: Array<{
  id: string;
  projectId: string;
  taskId: string;
  dependsOnTaskId: string;
  type: string;
  createdAt: Date;
  dependsOnTask?: {
    title: string;
    status: string;
    ownerAgentId: string | null;
  } | null;
}>): TaskDependencySummary[] {
  return input.map((item) => ({
    id: item.id,
    projectId: item.projectId,
    taskId: item.taskId,
    dependsOnTaskId: item.dependsOnTaskId,
    type: item.type as TaskDependencySummary["type"],
    createdAt: item.createdAt.toISOString(),
    dependsOnTaskTitle: item.dependsOnTask?.title || undefined,
    dependsOnTaskStatus: item.dependsOnTask?.status as TaskStatus | undefined,
    dependsOnOwnerAgentId: item.dependsOnTask?.ownerAgentId ?? undefined
  }));
}

function buildDelegationSummary(input: Array<{
  id: string;
  mode: string;
  status: string;
  targetAgentId: string | null;
  outputSummary: string | null;
  failureReason: string | null;
  retryCount: number;
  maxRetries: number;
  startedAt: Date | null;
  completedAt: Date | null;
  expiredAt: Date | null;
}>): TaskDelegationSummary[] {
  return input.map((item) => ({
    id: item.id,
    mode: item.mode as TaskDelegationSummary["mode"],
    status: item.status as TaskDelegationSummary["status"],
    targetAgentId: item.targetAgentId ?? undefined,
    outputSummary: item.outputSummary ?? undefined,
    failureReason: item.failureReason ?? undefined,
    retryCount: item.retryCount,
    maxRetries: item.maxRetries,
    startedAt: toIsoString(item.startedAt),
    completedAt: toIsoString(item.completedAt),
    expiredAt: toIsoString(item.expiredAt)
  }));
}

export function deriveTaskBlockedReason(input: {
  status: string;
  description: string;
  syncPolicy?: string | null;
  projectPendingApproval?: boolean;
  dependencies?: TaskDependencySummary[];
  delegationSummary?: TaskDelegationSummary[];
  gitlab?: TaskGitLabSyncInfo;
}): TaskBlockedReason | undefined {
  const blockingDependency = (input.dependencies || []).find(
    (item) => item.type === "blocks" && item.dependsOnTaskStatus && !DONE_STATUSES.has(item.dependsOnTaskStatus)
  );
  if (blockingDependency) {
    return {
      code: "dependency_blocked",
      label: formatBlockedReasonLabel("dependency_blocked"),
      detail: `依赖任务 ${blockingDependency.dependsOnTaskTitle || blockingDependency.dependsOnTaskId} 尚未完成。`,
      dependsOnTaskId: blockingDependency.dependsOnTaskId,
      dependsOnTaskTitle: blockingDependency.dependsOnTaskTitle
    };
  }

  if (input.status === "pending_approval" || input.projectPendingApproval) {
    return {
      code: "pending_approval",
      label: formatBlockedReasonLabel("pending_approval"),
      detail: "当前任务或所在项目正在等待人工审批/验收。"
    };
  }

  const failedDelegation = (input.delegationSummary || []).find((item) =>
    ["failed", "cancelled", "expired"].includes(item.status)
  );
  if (input.status === "blocked" && failedDelegation) {
    return {
      code: "delegation_failed",
      label: formatBlockedReasonLabel("delegation_failed"),
      detail: failedDelegation.failureReason || "最近一次 delegation 未成功完成。",
      delegationId: failedDelegation.id
    };
  }

  if (input.status === "blocked" && input.syncPolicy === "full_mirror" && input.gitlab?.status !== "synced") {
    return {
      code: "external_sync_blocked",
      label: formatBlockedReasonLabel("external_sync_blocked"),
      detail: "该任务要求同步 GitLab，但当前尚未建立可用 issue 绑定。"
    };
  }

  if (input.status === "blocked") {
    return {
      code: "manual_intervention_required",
      label: formatBlockedReasonLabel("manual_intervention_required"),
      detail: extractBlockedReasonNote(input.description) || "当前任务需要人工介入后才能继续推进。"
    };
  }

  return undefined;
}

export function deriveTaskNextAction(input: {
  ownerAgentId?: string | null;
  reviewAgentId?: string | null;
  status: string;
  blockedReason?: TaskBlockedReason;
  delegationSummary?: TaskDelegationSummary[];
}): TaskNextAction | undefined {
  if (!input.ownerAgentId) {
    return {
      code: "waiting_for_owner",
      label: formatNextActionLabel("waiting_for_owner"),
      detail: "先指派明确的 owner，再进入执行。",
    };
  }

  if (input.blockedReason?.code === "dependency_blocked") {
    return {
      code: "waiting_for_dependency",
      label: formatNextActionLabel("waiting_for_dependency"),
      detail: `等待依赖任务 ${input.blockedReason.dependsOnTaskTitle || input.blockedReason.dependsOnTaskId || ""} 完成后再继续。`.trim(),
      actorAgentId: input.ownerAgentId || undefined,
      dependsOnTaskId: input.blockedReason.dependsOnTaskId
    };
  }

  if (input.blockedReason?.code === "delegation_failed") {
    const failedDelegation = (input.delegationSummary || []).find((item) =>
      ["failed", "cancelled", "expired"].includes(item.status)
    );
    if (failedDelegation) {
      return {
        code: "waiting_for_retry",
        label: formatNextActionLabel("waiting_for_retry"),
        detail: failedDelegation.retryCount < failedDelegation.maxRetries
          ? "评估失败 delegation 是否应重试，并由 owner 决定是否重新排队。"
          : "当前 retry 预算已用尽，请由 owner 决定是重新创建 delegation 还是人工接管。",
        actorAgentId: input.ownerAgentId || undefined
      };
    }
  }

  if (input.status === "pending_review") {
    return {
      code: "waiting_for_reviewer",
      label: formatNextActionLabel("waiting_for_reviewer"),
      detail: "等待 reviewer 给出审阅结论或修复意见。",
      actorAgentId: input.reviewAgentId || undefined
    };
  }

  if (input.status === "pending_approval" || input.blockedReason?.code === "pending_approval") {
    return {
      code: "waiting_for_approval",
      label: formatNextActionLabel("waiting_for_approval"),
      detail: "等待人工审批/验收结果后再决定后续动作。",
      actorAgentId: input.reviewAgentId || input.ownerAgentId || undefined
    };
  }

  return undefined;
}

export function buildTaskGitLabInfo(input: {
  syncPolicy?: string | null;
  status?: string;
  blockedReason?: TaskBlockedReason;
  nextAction?: TaskNextAction;
  binding?: {
    gitlabProjectId: string;
    issueIid: number | null;
    bindingType: string;
    lastSyncedAt: Date | null;
    lastSyncHash: string | null;
  } | null;
}): TaskGitLabSyncInfo | undefined {
  const syncPolicy = input.syncPolicy || undefined;
  if (!syncPolicy && !input.binding) {
    return undefined;
  }

  if (!input.binding?.issueIid || !input.binding.gitlabProjectId) {
    return {
      status: syncPolicy === "full_mirror" ? "sync_required" : "not_synced",
      syncPolicy: syncPolicy as TaskGitLabSyncInfo["syncPolicy"],
      summary: input.blockedReason
        ? `${input.blockedReason.label}，${input.nextAction?.label || "等待处理"}`
        : input.nextAction?.label || "尚未建立 GitLab 绑定"
    };
  }

  return {
    status: "synced",
    syncPolicy: syncPolicy as TaskGitLabSyncInfo["syncPolicy"],
    projectPath: input.binding.gitlabProjectId,
    issueIid: input.binding.issueIid,
    webUrl: `${GITLAB_BASE_URL}/${input.binding.gitlabProjectId}/-/work_items/${input.binding.issueIid}`,
    lastSyncedAt: toIsoString(input.binding.lastSyncedAt),
    lastSyncHash: input.binding.lastSyncHash ?? undefined,
    summary: input.blockedReason
      ? `${input.status || "task"} · ${input.blockedReason.label} · ${input.nextAction?.label || "等待处理"}`
      : `${input.status || "task"} · ${input.nextAction?.label || "已同步"}`,
    bindingType: input.binding.bindingType as TaskGitLabSyncInfo["bindingType"]
  };
}

export function buildTaskCollaboration(input: {
  status: string;
  description: string;
  syncPolicy?: string | null;
  ownerAgentId?: string | null;
  reviewAgentId?: string | null;
  projectPendingApproval?: boolean;
  dependencies?: Array<{
    id: string;
    projectId: string;
    taskId: string;
    dependsOnTaskId: string;
    type: string;
    createdAt: Date;
    dependsOnTask?: {
      title: string;
      status: string;
      ownerAgentId: string | null;
    } | null;
  }>;
  delegations?: Array<{
    id: string;
    mode: string;
    status: string;
    targetAgentId: string | null;
    outputSummary: string | null;
    failureReason: string | null;
    retryCount: number;
    maxRetries: number;
    startedAt: Date | null;
    completedAt: Date | null;
    expiredAt: Date | null;
  }>;
  gitlabBinding?: {
    gitlabProjectId: string;
    issueIid: number | null;
    bindingType: string;
    lastSyncedAt: Date | null;
    lastSyncHash: string | null;
  } | null;
}) {
  const dependencies = buildTaskDependencySummary(input.dependencies || []);
  const delegationSummary = buildDelegationSummary(input.delegations || []);
  const preliminaryGitlab = buildTaskGitLabInfo({
    syncPolicy: input.syncPolicy,
    status: input.status,
    binding: input.gitlabBinding || null
  });
  const blockedReason = deriveTaskBlockedReason({
    status: input.status,
    description: input.description,
    syncPolicy: input.syncPolicy,
    projectPendingApproval: input.projectPendingApproval,
    dependencies,
    delegationSummary,
    gitlab: preliminaryGitlab
  });
  const nextAction = deriveTaskNextAction({
    ownerAgentId: input.ownerAgentId,
    reviewAgentId: input.reviewAgentId,
    status: input.status,
    blockedReason,
    delegationSummary
  });
  const gitlab = buildTaskGitLabInfo({
    syncPolicy: input.syncPolicy,
    status: input.status,
    blockedReason,
    nextAction,
    binding: input.gitlabBinding || null
  });

  return {
    blockedReason,
    nextAction,
    dependencies,
    delegationSummary,
    gitlab
  };
}

export function hasBlockingDependencies(dependencies: TaskDependencySummary[]) {
  return dependencies.some(
    (item) => item.type === "blocks" && item.dependsOnTaskStatus && !DONE_STATUSES.has(item.dependsOnTaskStatus)
  );
}
