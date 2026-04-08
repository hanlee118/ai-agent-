import type { DeliverableStatus, StageType, Task, TaskExecutionContext, TimelineEvent } from "@occ/shared";
import { prisma } from "../db.js";

function excerptText(input: string, limit = 280) {
  const normalized = String(input || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*`_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}...` : normalized;
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
}): Task {
  return {
    id: task.id,
    projectId: task.projectId,
    stageType: task.stageType as Task["stageType"],
    title: task.title,
    description: task.description,
    assignee: task.assignee as Task["assignee"],
    ownerAgentId: task.ownerAgentId ?? undefined,
    reviewAgentId: task.reviewAgentId ?? undefined,
    coordinationMode: task.coordinationMode as Task["coordinationMode"],
    delegationPolicy: task.delegationPolicy as Task["delegationPolicy"],
    syncPolicy: task.syncPolicy as Task["syncPolicy"],
    contextScope: (task.contextScope || undefined) as Task["contextScope"],
    parentTaskId: task.parentTaskId ?? undefined,
    pendingDelegationCount: task.pendingDelegationCount,
    lastDelegatedAt: task.lastDelegatedAt?.toISOString(),
    status: task.status as Task["status"],
    priority: task.priority as Task["priority"],
    updatedAt: task.updatedAt.toISOString()
  };
}

function toTimelineEvent(event: {
  id: string;
  timestamp: Date;
  agentId: string | null;
  type: string;
  title: string;
  content: string;
  priority: string;
}): TimelineEvent {
  return {
    id: event.id,
    timestamp: event.timestamp.toISOString(),
    agentId: event.agentId as TimelineEvent["agentId"],
    type: event.type as TimelineEvent["type"],
    title: event.title,
    content: event.content,
    priority: event.priority as TimelineEvent["priority"]
  };
}

export async function buildTaskExecutionContext(taskId: string): Promise<TaskExecutionContext> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      project: true
    }
  });
  if (!task) {
    throw new Error("Task not found");
  }

  const [relevantArtifacts, relatedTasks, relevantTimeline, dependencies] = await Promise.all([
    prisma.deliverable.findMany({
      where: {
        projectId: task.projectId,
        OR: [
          { stageType: task.stageType },
          { status: "approved" }
        ]
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 6
    }),
    prisma.task.findMany({
      where: {
        projectId: task.projectId,
        id: { not: taskId },
        OR: [
          { stageType: task.stageType },
          { parentTaskId: taskId },
          ...(task.parentTaskId ? [{ parentTaskId: task.parentTaskId }] : [])
        ]
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 8
    }),
    prisma.timelineEvent.findMany({
      where: {
        projectId: task.projectId
      },
      orderBy: [{ timestamp: "desc" }],
      take: 10
    }),
    prisma.taskDependency.findMany({
      where: { taskId },
      include: {
        dependsOnTask: true
      },
      orderBy: [{ createdAt: "asc" }]
    })
  ]);

  const parsedConstraints = Array.isArray(task.project.parsedConstraints) ? task.project.parsedConstraints : [];
  const parsedRisks = Array.isArray(task.project.parsedRisks) ? task.project.parsedRisks : [];
  const dependencyConstraints = dependencies.map((item) => {
    return item.type === "blocks"
      ? `必须先确认依赖任务 ${item.dependsOnTask.title} 是否完成，再决定本任务最终状态。`
      : `与任务 ${item.dependsOnTask.title} 存在软依赖，请保持口径一致。`;
  });

  return {
    taskSummary: [
      `项目: ${task.project.name}`,
      `阶段: ${task.stageType}`,
      `任务: ${task.title}`,
      `目标: ${excerptText(task.description, 360) || "暂无额外描述"}`,
      task.ownerAgentId ? `Owner: ${task.ownerAgentId}` : "Owner: 未显式设置，按阶段默认负责人执行",
      task.reviewAgentId ? `Reviewer: ${task.reviewAgentId}` : "Reviewer: 暂未设置"
    ].join("\n"),
    acceptanceCriteria: [
      "输出必须直接服务当前 task，不得横向扩展页面或范围。",
      task.reviewAgentId ? `结果需能被 ${task.reviewAgentId} 直接审阅。` : "结果需具备可审阅摘要和证据。",
      task.pendingDelegationCount > 0 ? "回收 delegation 结果后再决定任务是否可关闭。" : "完成后需更新任务状态与摘要。"
    ],
    relevantArtifacts: relevantArtifacts.map((artifact) => ({
      id: artifact.id,
      name: artifact.name,
      stageType: artifact.stageType as StageType,
      status: artifact.status as DeliverableStatus,
      updatedAt: artifact.updatedAt.toISOString(),
      excerpt: excerptText(artifact.content)
    })),
    relevantTimeline: relevantTimeline.map(toTimelineEvent),
    relatedTasks: relatedTasks.map(toTask),
    constraints: [
      ...parsedConstraints.map((item) => String(item)),
      ...parsedRisks.map((item) => `风险提示: ${String(item)}`),
      ...dependencyConstraints,
      "优先引用 DB 中的 deliverables、timeline、task 状态，不要把全部 session history 原样展开。"
    ],
    resultFormat: "使用 Markdown 输出，至少包含 Summary / Evidence / Risks / Next Step 四段。"
  };
}

export async function buildDelegationContext(taskId: string, delegationId: string) {
  const [taskContext, delegation] = await Promise.all([
    buildTaskExecutionContext(taskId),
    prisma.taskDelegation.findUnique({ where: { id: delegationId } })
  ]);

  if (!delegation) {
    throw new Error("Delegation not found");
  }

  return {
    ...taskContext,
    taskSummary: `${taskContext.taskSummary}\nDelegation: ${delegation.title}\nGoal: ${delegation.goal}`,
    acceptanceCriteria: [
      ...taskContext.acceptanceCriteria,
      delegation.inputSummary ? `补充输入: ${delegation.inputSummary}` : "补充输入: 无",
      delegation.resultSchema ? `结果格式要求: ${delegation.resultSchema}` : "结果格式要求: 按标准 Markdown 四段输出"
    ],
    resultFormat: delegation.resultSchema || taskContext.resultFormat
  };
}

export async function buildReviewContext(taskId: string) {
  const taskContext = await buildTaskExecutionContext(taskId);
  return {
    ...taskContext,
    resultFormat: "请输出 Review Summary / Risks / Required Fixes / Approval Suggestion。"
  };
}
