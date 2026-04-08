import { prisma } from "../db.js";
import { publishTaskIssueNote, syncTaskGitLabHarness } from "../routes/gitlab.js";

function isHumanSyncWorthyTask(task: {
  priority: string;
  coordinationMode: string;
  syncPolicy: string;
  reviewAgentId: string | null;
  status: string;
}) {
  if (task.syncPolicy === "db_only") {
    return false;
  }
  if (task.syncPolicy === "full_mirror") {
    return true;
  }
  return task.priority === "high"
    || task.coordinationMode !== "single_owner"
    || Boolean(task.reviewAgentId)
    || ["blocked", "pending_review", "pending_approval"].includes(task.status);
}

export async function ensureTaskIssue(taskId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) {
    throw new Error("Task not found");
  }
  if (!isHumanSyncWorthyTask(task)) {
    return {
      skipped: true,
      reason: "task_not_selected_by_sync_policy"
    } as const;
  }
  return syncTaskGitLabHarness({ taskId });
}

export async function syncTaskStatus(taskId: string) {
  return ensureTaskIssue(taskId);
}

export async function publishDelegationSummary(taskId: string, delegationId: string) {
  const delegation = await prisma.taskDelegation.findUnique({ where: { id: delegationId } });
  if (!delegation) {
    throw new Error("Delegation not found");
  }
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) {
    throw new Error("Task not found");
  }
  if (!isHumanSyncWorthyTask(task)) {
    return {
      skipped: true,
      reason: "task_not_selected_by_sync_policy"
    } as const;
  }

  const body = [
    "delegation 摘要回写：",
    `- 标题: ${delegation.title}`,
    `- 模式: ${delegation.mode}`,
    `- 状态: ${delegation.status}`,
    `- 目标 Agent: ${delegation.targetAgentId || "未显式指定"}`,
    delegation.outputSummary
      ? `- 结果摘要: ${delegation.outputSummary}`
      : `- 失败原因: ${delegation.failureReason || "暂无"}`
  ].join("\n");

  return publishTaskIssueNote({
    taskId,
    body
  });
}

export async function publishEscalation(taskId: string, reason: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) {
    throw new Error("Task not found");
  }
  if (!isHumanSyncWorthyTask(task)) {
    return {
      skipped: true,
      reason: "task_not_selected_by_sync_policy"
    } as const;
  }

  return publishTaskIssueNote({
    taskId,
    body: `阻塞升级：\n- 当前任务已进入阻塞流\n- 原因: ${reason}`
  });
}

export async function closeTaskIssue(taskId: string) {
  return syncTaskGitLabHarness({ taskId });
}
