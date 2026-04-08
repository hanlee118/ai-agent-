import type {
  ContextScope,
  CoordinationMode,
  DelegationPolicy,
  RoleType,
  SyncPolicy,
  Task,
  TaskParticipant,
  TaskParticipantRole,
  TaskStatus
} from "@occ/shared";
import { prisma } from "../db.js";
import { findOpenClawAgent } from "../openclaw/workspace.js";
import {
  buildTaskCollaboration,
  hasBlockingDependencies
} from "./task-collaboration.js";
import { publishEscalation, syncTaskStatus } from "./gitlab-sync-policy.js";
import { publishTaskIssueNote } from "../routes/gitlab.js";

const COORDINATION_MODES = new Set<CoordinationMode>([
  "single_owner",
  "team_collab",
  "delegated_execution"
]);
const DELEGATION_POLICIES = new Set<DelegationPolicy>(["forbidden", "manual_only", "auto_allowed"]);
const SYNC_POLICIES = new Set<SyncPolicy>(["db_only", "db_plus_gitlab", "full_mirror"]);
const CONTEXT_SCOPES = new Set<ContextScope>(["local", "stage", "project", "cross_project"]);
const PARTICIPANT_ROLES = new Set<TaskParticipantRole>(["owner", "supporter", "reviewer", "observer"]);
const TERMINAL_TASK_STATUSES = new Set<string>(["done", "completed", "cancelled", "rejected"]);

const ROLE_TO_AGENT_ID: Record<RoleType, string> = {
  ROLE_ASSISTANT: "main",
  ROLE_PM: "project_manager",
  ROLE_ANALYST: "requirements_analyst",
  ROLE_PRODUCT: "product_director",
  ROLE_DESIGN: "jeremy",
  ROLE_ARCH: "rd_director",
  ROLE_DEV: "rd_manager",
  ROLE_QA: "qa_engineer",
  ROLE_HR: "hr_director"
};

function assertNonEmpty(value: unknown, field: string) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

function assertEnumValue<T extends string>(value: unknown, field: string, allowed: Set<T>): T {
  const normalized = assertNonEmpty(value, field) as T;
  if (!allowed.has(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

async function ensureAgentExists(agentId: string) {
  const agent = await findOpenClawAgent(agentId);
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  return agent;
}

function toIsoString(value?: Date | null) {
  return value ? value.toISOString() : undefined;
}

function toTask(task: {
  id: string;
  projectId: string;
  stageType: string;
  title: string;
  description: string;
  assignee: string;
  ownerAgentId: string | null;
  reviewAgentId: string | null;
  coordinationMode: string;
  delegationPolicy: string;
  syncPolicy: string;
  contextScope: string | null;
  parentTaskId: string | null;
  pendingDelegationCount: number;
  lastDelegatedAt: Date | null;
  status: string;
  priority: string;
  updatedAt: Date;
  project?: {
    pendingApproval: boolean;
  };
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
  gitlabSyncBindings?: Array<{
    gitlabProjectId: string;
    issueIid: number | null;
    bindingType: string;
    lastSyncedAt: Date | null;
    lastSyncHash: string | null;
  }>;
}): Task {
  const collaboration = buildTaskCollaboration({
    status: task.status,
    description: task.description,
    syncPolicy: task.syncPolicy,
    ownerAgentId: task.ownerAgentId,
    reviewAgentId: task.reviewAgentId,
    projectPendingApproval: task.project?.pendingApproval,
    dependencies: task.dependencies,
    delegations: task.delegations,
    gitlabBinding: task.gitlabSyncBindings?.[0] || null
  });
  return {
    id: task.id,
    projectId: task.projectId,
    stageType: task.stageType as Task["stageType"],
    title: task.title,
    description: task.description,
    assignee: task.assignee as RoleType,
    ownerAgentId: task.ownerAgentId ?? undefined,
    reviewAgentId: task.reviewAgentId ?? undefined,
    coordinationMode: task.coordinationMode as CoordinationMode,
    delegationPolicy: task.delegationPolicy as DelegationPolicy,
    syncPolicy: task.syncPolicy as SyncPolicy,
    contextScope: (task.contextScope || undefined) as ContextScope | undefined,
    parentTaskId: task.parentTaskId ?? undefined,
    pendingDelegationCount: task.pendingDelegationCount,
    lastDelegatedAt: toIsoString(task.lastDelegatedAt),
    blockedReason: collaboration.blockedReason,
    nextAction: collaboration.nextAction,
    dependencies: collaboration.dependencies,
    delegationSummary: collaboration.delegationSummary,
    gitlab: collaboration.gitlab,
    status: task.status as TaskStatus,
    priority: task.priority as Task["priority"],
    updatedAt: task.updatedAt.toISOString()
  };
}

function toTaskParticipant(participant: {
  id: string;
  projectId: string;
  taskId: string;
  agentId: string;
  role: string;
  createdAt: Date;
}): TaskParticipant {
  return {
    id: participant.id,
    projectId: participant.projectId,
    taskId: participant.taskId,
    agentId: participant.agentId,
    role: participant.role as TaskParticipantRole,
    createdAt: participant.createdAt.toISOString()
  };
}

function appendTaskNote(description: string, marker: string, note: string) {
  const trimmed = String(description || "").trim();
  const block = `${marker}\n${note.trim()}`;
  const pattern = new RegExp(`${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*$`, "m");
  if (pattern.test(trimmed)) {
    return trimmed.replace(pattern, block).trim();
  }
  return trimmed ? `${trimmed}\n\n${block}` : block;
}

async function ensureNoBlockingDependencies(tx: typeof prisma | any, taskId: string) {
  const dependencies = await tx.taskDependency.findMany({
    where: {
      taskId,
      type: "blocks"
    },
    include: {
      dependsOnTask: {
        select: {
          title: true,
          status: true,
          ownerAgentId: true
        }
      }
    }
  });
  const summary = buildTaskCollaboration({
    status: "blocked",
    description: "",
    dependencies
  }).dependencies;
  if (hasBlockingDependencies(summary)) {
    const first = summary.find((item) => item.type === "blocks" && item.dependsOnTaskStatus && !["done", "completed"].includes(item.dependsOnTaskStatus));
    throw new Error(`TASK_BLOCKED_BY_DEPENDENCIES:${first?.dependsOnTaskId || ""}`);
  }
}

export function isTaskTerminalStatus(status: string) {
  return TERMINAL_TASK_STATUSES.has(String(status || "").trim());
}

export function isTaskDoneLikeStatus(status: string) {
  return ["done", "completed"].includes(String(status || "").trim());
}

export function deriveDefaultOwnerAgentId(task: { assignee: string; ownerAgentId?: string | null }) {
  if (task.ownerAgentId) {
    return task.ownerAgentId;
  }
  return ROLE_TO_AGENT_ID[task.assignee as RoleType];
}

export async function getTaskById(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      project: {
        select: {
          pendingApproval: true
        }
      },
      dependencies: {
        include: {
          dependsOnTask: {
            select: {
              title: true,
              status: true,
              ownerAgentId: true
            }
          }
        }
      },
      delegations: {
        orderBy: [{ updatedAt: "desc" }],
        take: 3
      },
      gitlabSyncBindings: {
        where: { bindingType: "task" },
        orderBy: [{ updatedAt: "desc" }],
        take: 1
      }
    }
  });
  return task ? toTask(task) : undefined;
}

export async function listTaskParticipants(taskId: string) {
  const participants = await prisma.taskParticipant.findMany({
    where: { taskId },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }]
  });
  return participants.map(toTaskParticipant);
}

export async function assignOwner(taskId: string, ownerAgentId: string) {
  const normalizedOwnerAgentId = assertNonEmpty(ownerAgentId, "ownerAgentId");
  await ensureAgentExists(normalizedOwnerAgentId);

  const updated = await prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new Error("Task not found");
    }

    const nextStatus = task.status === "draft" || task.status === "ready" || task.status === "todo"
      ? "assigned"
      : task.status;
    const updatedTask = await tx.task.update({
      where: { id: taskId },
      data: {
        ownerAgentId: normalizedOwnerAgentId,
        status: nextStatus
      }
    });

    await tx.taskParticipant.upsert({
      where: {
        taskId_agentId_role: {
          taskId,
          agentId: normalizedOwnerAgentId,
          role: "owner"
        }
      },
      create: {
        projectId: task.projectId,
        taskId,
        agentId: normalizedOwnerAgentId,
        role: "owner"
      },
      update: {}
    });

    await tx.timelineEvent.create({
      data: {
        projectId: task.projectId,
        timestamp: new Date(),
        agentId: task.assignee,
        type: "system",
        title: "任务 Owner 已指派",
        content: `${task.title} 已指派给 ${normalizedOwnerAgentId}。`,
        priority: "normal"
      }
    });

    return updatedTask;
  });

  return toTask(updated);
}

export async function setReviewer(taskId: string, reviewerAgentId?: string | null) {
  const normalizedReviewerAgentId = String(reviewerAgentId || "").trim();
  if (normalizedReviewerAgentId) {
    await ensureAgentExists(normalizedReviewerAgentId);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new Error("Task not found");
    }

    const updatedTask = await tx.task.update({
      where: { id: taskId },
      data: {
        reviewAgentId: normalizedReviewerAgentId || null
      }
    });

    await tx.taskParticipant.deleteMany({
      where: {
        taskId,
        role: "reviewer"
      }
    });

    if (normalizedReviewerAgentId) {
      await tx.taskParticipant.upsert({
        where: {
          taskId_agentId_role: {
            taskId,
            agentId: normalizedReviewerAgentId,
            role: "reviewer"
          }
        },
        create: {
          projectId: task.projectId,
          taskId,
          agentId: normalizedReviewerAgentId,
          role: "reviewer"
        },
        update: {}
      });
    }

    await tx.timelineEvent.create({
      data: {
        projectId: task.projectId,
        timestamp: new Date(),
        agentId: task.assignee,
        type: "system",
        title: "任务 Reviewer 已设置",
        content: normalizedReviewerAgentId
          ? `${task.title} 的 reviewer 已设置为 ${normalizedReviewerAgentId}。`
          : `${task.title} 的 reviewer 已清空，当前需重新指定审阅人。`,
        priority: "normal"
      }
    });

    return updatedTask;
  });

  return toTask(updated);
}

export async function setCoordinationMode(taskId: string, mode: CoordinationMode) {
  const coordinationMode = assertEnumValue(mode, "coordinationMode", COORDINATION_MODES);

  const updated = await prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new Error("Task not found");
    }

    const updatedTask = await tx.task.update({
      where: { id: taskId },
      data: {
        coordinationMode
      }
    });

    await tx.timelineEvent.create({
      data: {
        projectId: task.projectId,
        timestamp: new Date(),
        agentId: task.assignee,
        type: "system",
        title: "任务协作模式已更新",
        content: `${task.title} 的 coordination mode 已更新为 ${coordinationMode}。`,
        priority: "normal"
      }
    });

    return updatedTask;
  });

  return toTask(updated);
}

export async function updateTaskPolicies(taskId: string, input: {
  delegationPolicy?: DelegationPolicy;
  syncPolicy?: SyncPolicy;
  contextScope?: ContextScope;
}) {
  const data: Record<string, string | null> = {};
  if (input.delegationPolicy) {
    data.delegationPolicy = assertEnumValue(input.delegationPolicy, "delegationPolicy", DELEGATION_POLICIES);
  }
  if (input.syncPolicy) {
    data.syncPolicy = assertEnumValue(input.syncPolicy, "syncPolicy", SYNC_POLICIES);
  }
  if (input.contextScope) {
    data.contextScope = assertEnumValue(input.contextScope, "contextScope", CONTEXT_SCOPES);
  }
  if (Object.keys(data).length === 0) {
    throw new Error("No task policy fields provided");
  }

  const updated = await prisma.task.update({
    where: { id: taskId },
    data
  });

  return toTask(updated);
}

export async function addParticipants(taskId: string, participants: Array<{ agentId: string; role: TaskParticipantRole }>) {
  if (!Array.isArray(participants) || participants.length === 0) {
    throw new Error("participants are required");
  }

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) {
    throw new Error("Task not found");
  }

  const normalized = [] as Array<{ agentId: string; role: TaskParticipantRole }>;
  for (const participant of participants) {
    const agentId = assertNonEmpty(participant?.agentId, "participant.agentId");
    const role = assertEnumValue(participant?.role, "participant.role", PARTICIPANT_ROLES);
    await ensureAgentExists(agentId);
    normalized.push({ agentId, role });
  }

  await prisma.$transaction(async (tx) => {
    for (const participant of normalized) {
      await tx.taskParticipant.upsert({
        where: {
          taskId_agentId_role: {
            taskId,
            agentId: participant.agentId,
            role: participant.role
          }
        },
        create: {
          projectId: task.projectId,
          taskId,
          agentId: participant.agentId,
          role: participant.role
        },
        update: {}
      });
    }
  });

  return listTaskParticipants(taskId);
}

export async function blockTask(taskId: string, reason: string, dependsOnTaskId?: string) {
  const blockReason = assertNonEmpty(reason, "reason");

  const updated = await prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new Error("Task not found");
    }

    if (dependsOnTaskId) {
      const dependencyTask = await tx.task.findUnique({ where: { id: dependsOnTaskId } });
      if (!dependencyTask || dependencyTask.projectId !== task.projectId) {
        throw new Error("dependsOnTaskId is invalid");
      }
      await tx.taskDependency.upsert({
        where: {
          taskId_dependsOnTaskId_type: {
            taskId,
            dependsOnTaskId,
            type: "blocks"
          }
        },
        create: {
          projectId: task.projectId,
          taskId,
          dependsOnTaskId,
          type: "blocks"
        },
        update: {}
      });
    }

    const updatedTask = await tx.task.update({
      where: { id: taskId },
      data: {
        status: "blocked",
        description: appendTaskNote(task.description, "## Blocked Reason", blockReason)
      }
    });

    await tx.timelineEvent.create({
      data: {
        projectId: task.projectId,
        timestamp: new Date(),
        agentId: task.assignee,
        type: "system",
        title: "任务已阻塞",
        content: `${task.title} 已阻塞：${blockReason}`,
        priority: "high"
      }
    });

    return updatedTask;
  });

  await publishEscalation(taskId, blockReason).catch(() => undefined);
  await syncTaskStatus(taskId).catch(() => undefined);
  return toTask(updated);
}

export async function unblockTask(taskId: string) {
  const updated = await prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new Error("Task not found");
    }

    const blockingDependencies = await tx.taskDependency.findMany({
      where: {
        taskId,
        type: "blocks",
        dependsOnTask: {
          status: {
            notIn: ["done", "completed"]
          }
        }
      }
    });
    if (blockingDependencies.length > 0) {
      throw new Error("Task still has blocking dependencies");
    }

    const nextStatus = task.ownerAgentId ? "in_progress" : "todo";
    const updatedTask = await tx.task.update({
      where: { id: taskId },
      data: {
        status: nextStatus
      }
    });

    await tx.timelineEvent.create({
      data: {
        projectId: task.projectId,
        timestamp: new Date(),
        agentId: task.assignee,
        type: "system",
        title: "任务已解除阻塞",
        content: `${task.title} 已解除阻塞并恢复为 ${nextStatus}。`,
        priority: "normal"
      }
    });

    return updatedTask;
  });

  await publishTaskIssueNote({
    taskId,
    body: "任务已进入待审阅，请 reviewer 给出结论并同步修复意见。"
  }).catch(() => undefined);
  await syncTaskStatus(taskId).catch(() => undefined);
  return toTask(updated);
}

export async function markReadyForReview(taskId: string) {
  const updated = await prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new Error("Task not found");
    }
    if (!task.reviewAgentId) {
      throw new Error("Task reviewer is not set");
    }
    if (task.pendingDelegationCount > 0) {
      throw new Error("Task still has pending delegations");
    }
    await ensureNoBlockingDependencies(tx, taskId);

    const updatedTask = await tx.task.update({
      where: { id: taskId },
      data: {
        status: "pending_review"
      }
    });

    await tx.timelineEvent.create({
      data: {
        projectId: task.projectId,
        timestamp: new Date(),
        agentId: task.assignee,
        type: "system",
        title: "任务已进入待审阅",
        content: `${task.title} 已进入 reviewer 审阅队列。`,
        priority: "normal"
      }
    });

    return updatedTask;
  });

  await syncTaskStatus(taskId).catch(() => undefined);
  return toTask(updated);
}
