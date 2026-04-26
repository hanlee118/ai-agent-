import { Prisma } from "@prisma/client";
import type { TaskDelegation, TaskDelegationMode, TaskDelegationStatus } from "@occ/shared";
import { prisma } from "../db.js";
import { sendOpenClawAgentMessage, findOpenClawAgent } from "../openclaw/workspace.js";
import { buildDelegationContext } from "./context-packing.js";
import { ingestKnowledgeItem } from "../workflow-v2/knowledge-service.js";
import { extractKnowledgeFromStageOutput } from "../workflow-v2/knowledge-llm.js";
import {
  buildTaskCollaboration,
  hasBlockingDependencies
} from "./task-collaboration.js";
import {
  deriveDefaultOwnerAgentId,
  isTaskDoneLikeStatus,
  isTaskTerminalStatus
} from "./task-coordination.js";
import { publishDelegationSummary, publishEscalation, syncTaskStatus } from "./gitlab-sync-policy.js";

const DELEGATION_MODES = new Set<TaskDelegationMode>([
  "research",
  "coding",
  "validation",
  "summarization",
  "review",
  "clarification"
]);
const FINAL_DELEGATION_STATUSES = new Set<TaskDelegationStatus>([
  "completed",
  "failed",
  "cancelled",
  "expired"
]);
const RETRYABLE_DELEGATION_STATUSES = new Set<TaskDelegationStatus>([
  "failed",
  "cancelled",
  "expired"
]);

export type CreateDelegationInput = {
  title?: string;
  goal: string;
  targetAgentId?: string;
  mode?: TaskDelegationMode;
  inputContextRef?: string;
  inputSummary?: string;
  resultSchema?: string;
  budgetTokens?: number;
  timeoutSec?: number;
  spawnDepth?: number;
  maxRetries?: number;
  clarificationDeliverableId?: string;
  clarificationTargetRole?: string;
};

type CompleteDelegationInput = {
  outputSummary: string;
  outputPayloadJson?: Prisma.InputJsonValue;
  outputArtifactsJson?: Prisma.InputJsonValue;
  clarificationResponse?: string;
  clarificationRespondedBy?: string;
  clarificationRespondedAt?: Date;
};

type FinalDelegationStatus = "failed" | "cancelled" | "expired";

const AUTO_KNOWLEDGE_EXTRACTION_ENABLED = String(process.env.AUTO_KNOWLEDGE_EXTRACTION ?? "false").trim().toLowerCase() === "true";

function assertNonEmpty(value: unknown, field: string) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

function normalizeInteger(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) ? number : undefined;
}

async function ensureAgentExists(agentId: string) {
  const agent = await findOpenClawAgent(agentId);
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  return agent;
}

function toDelegation(delegation: {
  id: string;
  projectId: string;
  taskId: string;
  parentExecutionId: string | null;
  requestedByAgentId: string;
  targetAgentId: string | null;
  mode: string;
  status: string;
  title: string;
  goal: string;
  inputContextRef: string | null;
  inputSummary: string | null;
  resultSchema: string | null;
  outputSummary: string | null;
  outputPayloadJson: Prisma.JsonValue | null;
  outputArtifactsJson: Prisma.JsonValue | null;
  budgetTokens: number | null;
  timeoutSec: number | null;
  spawnDepth: number;
  retryCount: number;
  maxRetries: number;
  startedAt: Date | null;
  completedAt: Date | null;
  expiredAt: Date | null;
  failureReason: string | null;
  clarificationDeliverableId: string | null;
  clarificationTargetRole: string | null;
  clarificationResponse: string | null;
  clarificationRespondedBy: string | null;
  clarificationRespondedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): TaskDelegation {
  return {
    id: delegation.id,
    projectId: delegation.projectId,
    taskId: delegation.taskId,
    parentExecutionId: delegation.parentExecutionId ?? undefined,
    requestedByAgentId: delegation.requestedByAgentId,
    targetAgentId: delegation.targetAgentId ?? undefined,
    mode: delegation.mode as TaskDelegationMode,
    status: delegation.status as TaskDelegationStatus,
    title: delegation.title,
    goal: delegation.goal,
    inputContextRef: delegation.inputContextRef ?? undefined,
    inputSummary: delegation.inputSummary ?? undefined,
    resultSchema: delegation.resultSchema ?? undefined,
    outputSummary: delegation.outputSummary ?? undefined,
    outputPayloadJson: delegation.outputPayloadJson ?? undefined,
    outputArtifactsJson: delegation.outputArtifactsJson ?? undefined,
    budgetTokens: delegation.budgetTokens ?? undefined,
    timeoutSec: delegation.timeoutSec ?? undefined,
    spawnDepth: delegation.spawnDepth,
    retryCount: delegation.retryCount,
    maxRetries: delegation.maxRetries,
    startedAt: delegation.startedAt?.toISOString(),
    completedAt: delegation.completedAt?.toISOString(),
    expiredAt: delegation.expiredAt?.toISOString(),
    failureReason: delegation.failureReason ?? undefined,
    clarificationDeliverableId: delegation.clarificationDeliverableId ?? undefined,
    clarificationTargetRole: delegation.clarificationTargetRole ?? undefined,
    clarificationResponse: delegation.clarificationResponse ?? undefined,
    clarificationRespondedBy: delegation.clarificationRespondedBy ?? undefined,
    clarificationRespondedAt: delegation.clarificationRespondedAt?.toISOString(),
    createdAt: delegation.createdAt.toISOString(),
    updatedAt: delegation.updatedAt.toISOString()
  };
}

function summarizeText(input: string, limit = 320) {
  const normalized = String(input || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}...` : normalized;
}

function buildFinalizationTimelineMeta(status: FinalDelegationStatus, reason: string) {
  if (status === "cancelled") {
    return {
      title: "delegation 已取消",
      contentPrefix: "取消原因",
      priority: "normal" as const
    };
  }
  if (status === "expired") {
    return {
      title: "delegation 已超时",
      contentPrefix: "超时原因",
      priority: "high" as const
    };
  }
  return {
    title: "delegation 执行失败",
    contentPrefix: "失败原因",
    priority: "high" as const
  };
}

async function finalizeDelegation(
  delegationId: string,
  status: FinalDelegationStatus,
  reason: string
) {
  const failureReason = assertNonEmpty(reason, "reason");
  const timelineMeta = buildFinalizationTimelineMeta(status, failureReason);

  const updated = await prisma.$transaction(async (tx) => {
    const delegation = await tx.taskDelegation.findUnique({
      where: { id: delegationId },
      include: { task: true }
    });
    if (!delegation) {
      throw new Error("Delegation not found");
    }
    if (FINAL_DELEGATION_STATUSES.has(delegation.status as TaskDelegationStatus)) {
      throw new Error("Delegation is already final");
    }

    const nextPending = Math.max(0, delegation.task.pendingDelegationCount - 1);
    await tx.task.update({
      where: { id: delegation.taskId },
      data: {
        pendingDelegationCount: nextPending,
        status: isTaskTerminalStatus(delegation.task.status) ? delegation.task.status : "blocked"
      }
    });
    await tx.timelineEvent.create({
      data: {
        projectId: delegation.projectId,
        timestamp: new Date(),
        agentId: delegation.task.assignee,
        type: "system",
        title: timelineMeta.title,
        content: `${delegation.title} ${timelineMeta.contentPrefix}：${failureReason}`,
        priority: timelineMeta.priority
      }
    });

    return tx.taskDelegation.update({
      where: { id: delegationId },
      data: {
        status,
        startedAt: delegation.startedAt || new Date(),
        completedAt: new Date(),
        expiredAt: status === "expired" ? new Date() : null,
        failureReason
      }
    });
  });

  await publishEscalation(updated.taskId, failureReason).catch(() => undefined);
  await syncTaskStatus(updated.taskId).catch(() => undefined);
  return toDelegation(updated);
}

function buildDelegationInstruction(input: {
  projectName: string;
  taskTitle: string;
  mode: string;
  goal: string;
  context: Awaited<ReturnType<typeof buildDelegationContext>>;
}) {
  const artifacts = input.context.relevantArtifacts
    .slice(0, 4)
    .map((item) => `- ${item.name}（${item.stageType}/${item.status}）: ${item.excerpt}`)
    .join("\n");
  const constraints = input.context.constraints.slice(0, 6).map((item) => `- ${item}`).join("\n");
  const acceptance = input.context.acceptanceCriteria.map((item) => `- ${item}`).join("\n");
  return [
    "你正在执行一个受控 delegation 任务。",
    "请只解决当前 delegation goal，不要横向扩展功能，不要改写项目治理边界。",
    "",
    `项目: ${input.projectName}`,
    `任务: ${input.taskTitle}`,
    `Delegation 模式: ${input.mode}`,
    `Delegation Goal: ${input.goal}`,
    "",
    "## Task Context",
    input.context.taskSummary,
    "",
    "## Acceptance Criteria",
    acceptance,
    "",
    "## Relevant Artifacts",
    artifacts || "- 暂无额外 artifact",
    "",
    "## Constraints",
    constraints || "- 暂无额外约束",
    "",
    "## Output Format",
    input.context.resultFormat
  ].join("\n");
}

function renderMergedDelegationBlock(items: Array<{ title: string; status: string; outputSummary: string | null }>) {
  const body = items
    .map((item, index) => `${index + 1}. ${item.title}（${item.status}）\n- ${summarizeText(item.outputSummary || "暂无摘要", 220)}`)
    .join("\n");
  return ["## Delegation Merge", body || "暂无 delegation merge 内容"].join("\n");
}

function upsertDelegationBlock(description: string, block: string) {
  const marker = "## Delegation Merge";
  const normalized = String(description || "").trim();
  const pattern = /## Delegation Merge[\s\S]*$/;
  if (pattern.test(normalized)) {
    return normalized.replace(pattern, block).trim();
  }
  return normalized ? `${normalized}\n\n${block}` : block;
}

async function resolveDelegationTarget(input: {
  explicitTargetAgentId?: string | null;
  task: { assignee: string; ownerAgentId: string | null };
}) {
  const targetAgentId = input.explicitTargetAgentId || deriveDefaultOwnerAgentId(input.task);
  if (!targetAgentId) {
    throw new Error("Unable to resolve target agent for delegation");
  }
  await ensureAgentExists(targetAgentId);
  return targetAgentId;
}

export async function listTaskDelegations(taskId: string) {
  const delegations = await prisma.taskDelegation.findMany({
    where: { taskId },
    orderBy: [{ createdAt: "desc" }]
  });
  return delegations.map(toDelegation);
}

export async function createDelegation(taskId: string, requestedByAgentId: string, payload: CreateDelegationInput) {
  const goal = assertNonEmpty(payload.goal, "goal");
  const requestedBy = assertNonEmpty(requestedByAgentId, "requestedByAgentId");
  const mode = payload.mode && DELEGATION_MODES.has(payload.mode)
    ? payload.mode
    : "research";
  const spawnDepth = Math.max(0, normalizeInteger(payload.spawnDepth) ?? 0);
  if (spawnDepth > 1) {
    throw new Error("Delegation spawnDepth exceeds current limit");
  }
  if (payload.targetAgentId) {
    await ensureAgentExists(assertNonEmpty(payload.targetAgentId, "targetAgentId"));
  }

  const created = await prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({
      where: { id: taskId },
      include: {
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
        }
      }
    });
    if (!task) {
      throw new Error("Task not found");
    }
    if (task.delegationPolicy === "forbidden") {
      throw new Error("Task delegation is forbidden by policy");
    }
    if (isTaskTerminalStatus(task.status)) {
      throw new Error("Task is already terminal");
    }
    const collaboration = buildTaskCollaboration({
      status: task.status,
      description: task.description,
      syncPolicy: task.syncPolicy,
      ownerAgentId: task.ownerAgentId,
      reviewAgentId: task.reviewAgentId,
      dependencies: task.dependencies
    });
    if (hasBlockingDependencies(collaboration.dependencies)) {
      throw new Error(`TASK_BLOCKED_BY_DEPENDENCIES:${collaboration.dependencies.find((item) => item.type === "blocks" && item.dependsOnTaskStatus && !["done", "completed"].includes(item.dependsOnTaskStatus))?.dependsOnTaskId || ""}`);
    }

    const title = String(payload.title || `${mode}: ${goal}`).trim().slice(0, 120);
    const targetAgentId = payload.targetAgentId || deriveDefaultOwnerAgentId(task) || null;
    const nextTaskStatus = ["draft", "ready", "assigned", "todo"].includes(task.status) ? "in_progress" : task.status;
    const nextCoordinationMode = task.coordinationMode === "single_owner"
      ? "delegated_execution"
      : task.coordinationMode;

    const delegation = await tx.taskDelegation.create({
      data: {
        projectId: task.projectId,
        taskId,
        requestedByAgentId: requestedBy,
        targetAgentId,
        mode,
        status: "queued",
        title,
        goal,
        inputContextRef: payload.inputContextRef,
        inputSummary: payload.inputSummary,
        resultSchema: payload.resultSchema,
        budgetTokens: normalizeInteger(payload.budgetTokens),
        timeoutSec: normalizeInteger(payload.timeoutSec),
        spawnDepth,
        maxRetries: Math.max(0, normalizeInteger(payload.maxRetries) ?? 0),
        clarificationDeliverableId: payload.clarificationDeliverableId || null,
        clarificationTargetRole: payload.clarificationTargetRole || null
      }
    });

    await tx.task.update({
      where: { id: taskId },
      data: {
        ownerAgentId: task.ownerAgentId || deriveDefaultOwnerAgentId(task) || null,
        coordinationMode: nextCoordinationMode,
        pendingDelegationCount: { increment: 1 },
        lastDelegatedAt: new Date(),
        status: nextTaskStatus
      }
    });

    await tx.timelineEvent.create({
      data: {
        projectId: task.projectId,
        timestamp: new Date(),
        agentId: task.assignee,
        type: "system",
        title: "任务已创建 delegation",
        content: `${task.title} 创建 delegation：${title}`,
        priority: "normal"
      }
    });

    return delegation;
  });

  await syncTaskStatus(taskId).catch(() => undefined);
  return toDelegation(created);
}

export async function completeDelegation(delegationId: string, result: CompleteDelegationInput) {
  const outputSummary = assertNonEmpty(result.outputSummary, "outputSummary");

  const updated = await prisma.$transaction(async (tx) => {
    const delegation = await tx.taskDelegation.findUnique({
      where: { id: delegationId },
      include: { task: true }
    });
    if (!delegation) {
      throw new Error("Delegation not found");
    }
    if (FINAL_DELEGATION_STATUSES.has(delegation.status as TaskDelegationStatus)) {
      throw new Error("Delegation is already final");
    }

    return tx.taskDelegation.update({
      where: { id: delegationId },
      data: {
        status: "completed",
        startedAt: delegation.startedAt || new Date(),
        completedAt: new Date(),
        outputSummary,
        outputPayloadJson: result.outputPayloadJson,
        outputArtifactsJson: result.outputArtifactsJson,
        clarificationResponse: result.clarificationResponse || null,
        clarificationRespondedBy: result.clarificationRespondedBy || null,
        clarificationRespondedAt: result.clarificationRespondedAt || null,
        failureReason: null
      }
    });
  });

  await mergeDelegationResultIntoTask(updated.taskId, delegationId);
  return toDelegation(updated);
}

export async function failDelegation(delegationId: string, reason: string) {
  return finalizeDelegation(delegationId, "failed", reason);
}

export async function cancelDelegation(delegationId: string, reason: string) {
  return finalizeDelegation(delegationId, "cancelled", reason);
}

export async function expireDelegation(delegationId: string, reason = "delegation expired") {
  return finalizeDelegation(delegationId, "expired", reason);
}

export async function retryDelegation(delegationId: string) {
  const updated = await prisma.$transaction(async (tx) => {
    const delegation = await tx.taskDelegation.findUnique({
      where: { id: delegationId },
      include: { task: true }
    });
    if (!delegation) {
      throw new Error("Delegation not found");
    }
    if (!RETRYABLE_DELEGATION_STATUSES.has(delegation.status as TaskDelegationStatus)) {
      throw new Error("Delegation is not retryable");
    }
    if (delegation.retryCount >= delegation.maxRetries) {
      throw new Error("Delegation retry budget exhausted");
    }

    await tx.task.update({
      where: { id: delegation.taskId },
      data: {
        pendingDelegationCount: { increment: 1 },
        status: delegation.task.status === "blocked" || isTaskDoneLikeStatus(delegation.task.status)
          ? "in_progress"
          : delegation.task.status,
        lastDelegatedAt: new Date()
      }
    });

    return tx.taskDelegation.update({
      where: { id: delegationId },
      data: {
        status: "queued",
        retryCount: { increment: 1 },
        startedAt: null,
        completedAt: null,
        expiredAt: null,
        failureReason: null,
        outputSummary: null,
        outputPayloadJson: Prisma.JsonNull,
        outputArtifactsJson: Prisma.JsonNull
      }
    });
  });

  await syncTaskStatus(updated.taskId).catch(() => undefined);
  return toDelegation(updated);
}

export async function dispatchDelegation(delegationId: string) {
  const delegation = await prisma.taskDelegation.findUnique({
    where: { id: delegationId },
    include: {
      task: {
        include: {
          project: true,
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
          }
        }
      }
    }
  });
  if (!delegation) {
    throw new Error("Delegation not found");
  }
  if (delegation.status !== "queued") {
    throw new Error("Delegation is not dispatchable");
  }
  const collaboration = buildTaskCollaboration({
    status: delegation.task.status,
    description: delegation.task.description,
    syncPolicy: delegation.task.syncPolicy,
    ownerAgentId: delegation.task.ownerAgentId,
    reviewAgentId: delegation.task.reviewAgentId,
    projectPendingApproval: delegation.task.project.pendingApproval,
    dependencies: delegation.task.dependencies
  });
  if (hasBlockingDependencies(collaboration.dependencies)) {
    throw new Error(`TASK_BLOCKED_BY_DEPENDENCIES:${collaboration.dependencies.find((item) => item.type === "blocks" && item.dependsOnTaskStatus && !["done", "completed"].includes(item.dependsOnTaskStatus))?.dependsOnTaskId || ""}`);
  }

  const targetAgentId = await resolveDelegationTarget({
    explicitTargetAgentId: delegation.targetAgentId,
    task: delegation.task
  });
  await prisma.taskDelegation.update({
    where: { id: delegationId },
    data: {
      targetAgentId,
      status: "running",
      startedAt: new Date(),
      failureReason: null
    }
  });

  const context = await buildDelegationContext(delegation.taskId, delegationId);
  const message = buildDelegationInstruction({
    projectName: delegation.task.project.name,
    taskTitle: delegation.task.title,
    mode: delegation.mode,
    goal: delegation.goal,
    context
  });

  try {
    const result = await sendOpenClawAgentMessage(targetAgentId, { message });
    return await completeDelegation(delegationId, {
      outputSummary: summarizeText(result.reply || result.summary || "delegation completed"),
      outputPayloadJson: {
        ok: result.ok,
        summary: result.summary,
        reply: result.reply,
        sessionId: result.sessionId,
        model: result.model,
        provider: result.provider,
        durationMs: result.durationMs
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "delegation dispatch failed";
    await failDelegation(delegationId, message);
    throw error;
  }
}

export async function mergeDelegationResultIntoTask(taskId: string, delegationId: string) {
  const delegation = await prisma.taskDelegation.findUnique({
    where: { id: delegationId },
    include: {
      task: {
        select: {
          id: true,
          stageType: true,
          projectId: true,
          title: true
        }
      }
    }
  });
  if (!delegation) {
    throw new Error("Delegation not found");
  }
  if (delegation.status !== "completed") {
    throw new Error("Delegation is not completed");
  }

  await prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new Error("Task not found");
    }
    const completedDelegations = await tx.taskDelegation.findMany({
      where: {
        taskId,
        status: "completed"
      },
      orderBy: [{ completedAt: "desc" }, { updatedAt: "desc" }],
      take: 3
    });

    const pendingDelegationCount = Math.max(0, task.pendingDelegationCount - 1);
    const nextStatus = task.status === "blocked" ? "in_progress" : task.status;
    await tx.task.update({
      where: { id: taskId },
      data: {
        pendingDelegationCount,
        status: nextStatus,
        description: upsertDelegationBlock(
          task.description,
          renderMergedDelegationBlock(
            completedDelegations.map((item) => ({
              title: item.title,
              status: item.status,
              outputSummary: item.outputSummary
            }))
          )
        )
      }
    });

    await tx.timelineEvent.create({
      data: {
        projectId: task.projectId,
        timestamp: new Date(),
        agentId: task.assignee,
        type: "system",
        title: "delegation 结果已合并回任务",
        content: `${delegation.title} 的结果已合并到任务 ${task.title}。`,
        priority: "normal"
      }
    });
  });

  await publishDelegationSummary(taskId, delegationId).catch(() => undefined);
  await syncTaskStatus(taskId).catch(() => undefined);

  if (AUTO_KNOWLEDGE_EXTRACTION_ENABLED) {
    await tryAutoIngestDelegationKnowledge({
      projectId: delegation.task.projectId,
      stageType: delegation.task.stageType,
      taskTitle: delegation.task.title,
      mode: delegation.mode,
      outputSummary: delegation.outputSummary || "",
      outputPayloadJson: delegation.outputPayloadJson
    });
  }
}

async function tryAutoIngestDelegationKnowledge(input: {
  projectId: string;
  stageType: string;
  taskTitle: string;
  mode: string;
  outputSummary: string;
  outputPayloadJson: Prisma.JsonValue | null;
}) {
  const normalizedSummary = String(input.outputSummary || "").trim();
  if (!normalizedSummary) {
    return;
  }
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      name: true,
      description: true
    }
  });
  if (!project) {
    return;
  }
  const payloadText = input.outputPayloadJson ? JSON.stringify(input.outputPayloadJson) : "";
  const extraction = await extractKnowledgeFromStageOutput({
    projectName: project.name,
    projectDescription: project.description,
    stageKey: String(input.stageType || "ANALYSIS"),
    outputText: [normalizedSummary, payloadText].filter(Boolean).join("\n\n"),
    summary: normalizedSummary
  });
  await ingestKnowledgeItem({
    scope: "project",
    projectId: input.projectId,
    type: "text",
    title: `Delegation 知识提取 · ${input.taskTitle}`,
    content: extraction.summary,
    tags: [...new Set([
      ...extraction.tags,
      String(input.stageType || "").toLowerCase(),
      String(input.mode || "").toLowerCase(),
      "auto-extracted"
    ])],
    stageContext: [String(input.stageType || "ANALYSIS")],
    techStack: extraction.techStack,
    memoryType: extraction.memoryType,
    importanceScore: extraction.importanceScore,
    metadata: {
      source: "task_delegation_auto_extract",
      taskType: input.mode
    }
  });
}

export async function createClarificationDelegation(
  taskId: string,
  requestedByAgentId: string,
  payload: {
    question: string;
    targetAgentId?: string;
    targetRole?: string;
    deliverableId?: string;
    timeoutSec?: number;
  }
) {
  const question = assertNonEmpty(payload.question, "question");
  if (!payload.targetAgentId && !payload.targetRole) {
    throw new Error("targetAgentId or targetRole is required");
  }
  const delegation = await createDelegation(taskId, requestedByAgentId, {
    title: `clarification: ${question}`,
    goal: question,
    mode: "clarification",
    targetAgentId: payload.targetAgentId,
    timeoutSec: payload.timeoutSec,
    clarificationDeliverableId: payload.deliverableId,
    clarificationTargetRole: payload.targetRole
  });
  const updated = await prisma.taskDelegation.update({
    where: { id: delegation.id },
    data: {
      status: "running",
      startedAt: new Date()
    }
  });
  return toDelegation(updated);
}

export async function replyClarificationDelegation(
  delegationId: string,
  payload: {
    respondedByAgentId: string;
    response: string;
  }
) {
  const respondedByAgentId = assertNonEmpty(payload.respondedByAgentId, "respondedByAgentId");
  const response = assertNonEmpty(payload.response, "response");
  const delegation = await prisma.taskDelegation.findUnique({
    where: { id: delegationId },
    select: {
      id: true,
      mode: true,
      status: true
    }
  });
  if (!delegation) {
    throw new Error("Delegation not found");
  }
  if (delegation.mode !== "clarification") {
    throw new Error("Delegation is not clarification mode");
  }
  if (FINAL_DELEGATION_STATUSES.has(delegation.status as TaskDelegationStatus)) {
    throw new Error("Delegation is already final");
  }
  return completeDelegation(delegationId, {
    outputSummary: summarizeText(response, 400),
    outputPayloadJson: {
      clarification: true,
      response,
      respondedByAgentId
    },
    clarificationResponse: response,
    clarificationRespondedBy: respondedByAgentId,
    clarificationRespondedAt: new Date()
  });
}

export async function expireTimedOutClarificationDelegations() {
  const now = new Date();
  const candidates = await prisma.taskDelegation.findMany({
    where: {
      mode: "clarification",
      status: { in: ["queued", "running"] },
      timeoutSec: { gt: 0 }
    },
    select: {
      id: true,
      createdAt: true,
      startedAt: true,
      timeoutSec: true
    }
  });
  const expiredIds = candidates
    .filter((item) => {
      const baseAt = item.startedAt || item.createdAt;
      const timeoutMs = Math.max(1, Number(item.timeoutSec || 0)) * 1000;
      return baseAt.getTime() + timeoutMs <= now.getTime();
    })
    .map((item) => item.id);

  for (const delegationId of expiredIds) {
    await expireDelegation(delegationId, "clarification timeout: no response received");
  }
  return {
    scanned: candidates.length,
    expired: expiredIds.length
  };
}
