import type {
  NotificationInboxItem,
  NotificationInboxUpdateInput,
  NotificationSeverity
} from "@occ/shared";
import { prisma } from "../db.js";
import { listProjects, listTasks, getSystemHealth } from "../data/repository.js";
import { listAuditLogs } from "./audit-log.js";
import { getRuntimeStatus } from "../agents/runtime.js";
import { listOpenClawAgents } from "../openclaw/workspace.js";

type LiveNotificationCandidate = {
  sourceKey: string;
  sourceType: string;
  severity: NotificationSeverity;
  category: string;
  title: string;
  detail: string;
  actionLabel: string;
  to: string;
  timestamp?: string;
};

export async function listNotificationInbox(locale: "zh-CN" | "en-US" = "zh-CN"): Promise<NotificationInboxItem[]> {
  const candidates = await buildLiveNotificationCandidates(locale);

  await Promise.all(
    candidates.map((item) =>
      prisma.notificationState.upsert({
        where: { sourceKey: item.sourceKey },
        update: {
          sourceType: item.sourceType,
          severity: item.severity,
          category: item.category,
          title: item.title,
          detail: item.detail,
          actionLabel: item.actionLabel,
          to: item.to,
          eventAt: item.timestamp ? new Date(item.timestamp) : null,
          lastSeenAt: new Date()
        },
        create: {
          sourceKey: item.sourceKey,
          sourceType: item.sourceType,
          severity: item.severity,
          category: item.category,
          title: item.title,
          detail: item.detail,
          actionLabel: item.actionLabel,
          to: item.to,
          eventAt: item.timestamp ? new Date(item.timestamp) : null,
          lastSeenAt: new Date()
        }
      })
    )
  );

  const states = await prisma.notificationState.findMany({
    where: {
      sourceKey: {
        in: candidates.map((item) => item.sourceKey)
      }
    }
  });

  const stateByKey = new Map(states.map((item) => [item.sourceKey, item]));

  return candidates
    .map((item) => {
      const state = stateByKey.get(item.sourceKey);
      return {
        id: state?.id ?? item.sourceKey,
        sourceKey: item.sourceKey,
        sourceType: item.sourceType,
        severity: item.severity,
        category: item.category,
        title: item.title,
        detail: item.detail,
        actionLabel: item.actionLabel,
        to: item.to,
        timestamp: item.timestamp,
        read: state?.isRead ?? false,
        assignedTo: state?.assignedTo ?? undefined,
        confirmedBy: state?.confirmedBy ?? undefined,
        workflowStatus: normalizeWorkflowStatus(state?.workflowStatus),
        updatedAt: (state?.updatedAt ?? new Date()).toISOString()
      } satisfies NotificationInboxItem;
    })
    .sort((left, right) => (right.timestamp ?? "").localeCompare(left.timestamp ?? ""));
}

export async function updateNotificationInboxState(
  sourceKey: string,
  input: NotificationInboxUpdateInput
): Promise<NotificationInboxItem | null> {
  const existing = await prisma.notificationState.findUnique({ where: { sourceKey } });
  if (!existing) {
    return null;
  }

  const updated = await prisma.notificationState.update({
    where: { sourceKey },
    data: {
      isRead: input.read ?? existing.isRead,
      assignedTo: input.assignedTo === undefined ? existing.assignedTo : (input.assignedTo || null),
      confirmedBy: input.confirmedBy === undefined ? existing.confirmedBy : (input.confirmedBy || null),
      workflowStatus: input.workflowStatus ?? existing.workflowStatus
    }
  });

  return {
    id: updated.id,
    sourceKey: updated.sourceKey,
    sourceType: updated.sourceType,
    severity: normalizeSeverity(updated.severity),
    category: updated.category,
    title: updated.title,
    detail: updated.detail,
    actionLabel: updated.actionLabel,
    to: updated.to,
    timestamp: updated.eventAt?.toISOString(),
    read: updated.isRead,
    assignedTo: updated.assignedTo ?? undefined,
    confirmedBy: updated.confirmedBy ?? undefined,
    workflowStatus: normalizeWorkflowStatus(updated.workflowStatus),
    updatedAt: updated.updatedAt.toISOString()
  };
}

async function buildLiveNotificationCandidates(locale: "zh-CN" | "en-US") {
  const isEnglish = locale === "en-US";
  const [projects, tasks, auditLogs, runtime, health, agents] = await Promise.all([
    listProjects(),
    listTasks(),
    listAuditLogs(12),
    getRuntimeStatus(),
    getSystemHealth(),
    listOpenClawAgents()
  ]);

  const next: LiveNotificationCandidate[] = [];
  const pendingProjects = projects.filter((project) => project.pendingApproval);
  const blockedTasks = tasks.filter((task) => task.status === "blocked");
  const overloadedAgents = agents.filter((agent) => agent.blockedTaskCount > 0 || agent.taskCount >= 3);

  if (runtime.mode === "scripted") {
    next.push({
      sourceKey: "runtime-scripted",
      sourceType: "runtime",
      severity: "critical",
      category: isEnglish ? "Runtime" : "运行态",
      title: isEnglish ? "Runtime is still using scripted fallback mode" : "当前仍在脚本回退模式运行",
      detail: isEnglish
        ? "The workspace is usable, but it is not yet running on a real model provider configuration."
        : "平台当前可用，但还没有完全运行在真实模型提供方配置上。",
      actionLabel: isEnglish ? "Open operations" : "进入系统运营",
      to: "/system"
    });
  }

  for (const project of pendingProjects) {
    next.push({
      sourceKey: `approval:${project.id}`,
      sourceType: "project_approval",
      severity: "warning",
      category: isEnglish ? "Approval" : "审批",
      title: isEnglish ? `${project.name} is waiting for approval` : `${project.name} 正在等待审批`,
      detail: isEnglish
        ? `Current stage ${project.currentStage} is blocked until approval is completed.`
        : `当前阶段 ${project.currentStage} 需要你的确认后才能继续。`,
      actionLabel: isEnglish ? "Open project room" : "进入项目作战室",
      to: `/projects/${project.id}`,
      timestamp: project.updatedAt
    });
  }

  for (const task of blockedTasks.slice(0, 8)) {
    next.push({
      sourceKey: `task:${task.id}`,
      sourceType: "blocked_task",
      severity: "critical",
      category: isEnglish ? "Blocked task" : "阻塞任务",
      title: isEnglish ? `${task.title} is blocked` : `${task.title} 已阻塞`,
      detail: isEnglish
        ? `${task.projectName} / ${task.stageType} requires intervention or reassignment.`
        : `${task.projectName} / ${task.stageType} 需要介入或改派。`,
      actionLabel: isEnglish ? "Open project room" : "进入项目作战室",
      to: `/projects/${task.projectId}`,
      timestamp: task.updatedAt
    });
  }

  for (const agent of overloadedAgents.slice(0, 8)) {
    next.push({
      sourceKey: `agent:${agent.agentId}`,
      sourceType: "agent_load",
      severity: agent.blockedTaskCount > 0 ? "critical" : "warning",
      category: isEnglish ? "Agent load" : "Agent 负载",
      title: isEnglish ? `${agent.name} needs attention` : `${agent.name} 需要关注`,
      detail: isEnglish
        ? `${agent.taskCount} tasks, ${agent.blockedTaskCount} blocked, mode ${agent.commander.executionMode}.`
        : `${agent.taskCount} 个任务，${agent.blockedTaskCount} 个阻塞，当前模式 ${agent.commander.executionMode}。`,
      actionLabel: isEnglish ? "Open commander" : "进入指挥页",
      to: `/agents/${agent.agentId}`,
      timestamp: agent.lastActiveAt
    });
  }

  for (const item of auditLogs.slice(0, 6)) {
    next.push({
      sourceKey: `audit:${item.id}`,
      sourceType: "audit",
      severity: "info",
      category: isEnglish ? "Governance" : "治理",
      title: item.summary,
      detail: `${item.actorLabel} · ${item.resourceType}${item.resourceId ? ` · ${item.resourceId}` : ""}`,
      actionLabel: isEnglish ? "Open audit" : "进入审计",
      to: "/audit",
      timestamp: item.createdAt
    });
  }

  if (health.pendingApprovals > 0) {
    next.push({
      sourceKey: "platform:pending-approvals",
      sourceType: "platform",
      severity: "warning",
      category: isEnglish ? "Platform" : "平台",
      title: isEnglish ? `${health.pendingApprovals} approvals are waiting in the queue` : `${health.pendingApprovals} 个审批正在等待处理`,
      detail: isEnglish
        ? "Clearing the queue will unblock downstream delivery and agent execution."
        : "尽快清理审批队列，可以解除后续交付和 Agent 执行阻塞。",
      actionLabel: isEnglish ? "Open notifications" : "进入通知中心",
      to: "/notifications"
    });
  }

  return next;
}

function normalizeSeverity(value: string): NotificationSeverity {
  if (value === "critical" || value === "warning") {
    return value;
  }

  return "info";
}

function normalizeWorkflowStatus(value?: string): NotificationInboxItem["workflowStatus"] {
  if (value === "acknowledged" || value === "resolved") {
    return value;
  }

  return "open";
}
