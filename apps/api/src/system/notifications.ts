import type {
  NotificationInboxItem,
  NotificationInboxUpdateInput,
  NotificationSeverity
} from "@occ/shared";
import { prisma, withPrismaReadRetry } from "../db.js";
import { listProjects, listTasks, getSystemHealth } from "../data/repository.js";
import { listAuditLogs } from "./audit-log.js";
import { getRuntimeStatus } from "../agents/runtime.js";
import { listOpenClawAgents } from "../openclaw/workspace.js";
import { getUiPreferences } from "./ui-preferences.js";

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
type CandidateCacheBucket = {
  expiresAt: number;
  data: LiveNotificationCandidate[];
  inflight?: Promise<LiveNotificationCandidate[]>;
};

const LIVE_NOTIFICATION_CACHE_TTL_MS = Math.max(
  1000,
  Number.parseInt(String(process.env.NOTIFICATION_LIVE_CACHE_TTL_MS ?? "5000"), 10) || 5000
);
const liveCandidateCache = new Map<"zh-CN" | "en-US", CandidateCacheBucket>();

export async function listNotificationInbox(
  locale: "zh-CN" | "en-US" = "zh-CN",
  options?: { page?: number; pageSize?: number; summary?: boolean; summaryMaxLength?: number }
): Promise<NotificationInboxItem[]> {
  const page = Number.isFinite(Number(options?.page))
    ? Math.max(1, Math.floor(Number(options?.page)))
    : 1;
  const pageSize = Number.isFinite(Number(options?.pageSize))
    ? Math.max(1, Math.min(100, Math.floor(Number(options?.pageSize))))
    : 20;
  const offset = (page - 1) * pageSize;
  const summary = options?.summary !== false;
  const summaryMaxLength = Math.max(40, Math.floor(Number(options?.summaryMaxLength ?? 200)));
  const candidates = await getCachedLiveNotificationCandidates(locale);
  const candidateKeys = candidates.map((item) => item.sourceKey);
  const states = await withTimeoutFallback(
    withPrismaReadRetry("findMany", () => prisma.notificationState.findMany({
      where: {
        sourceKey: {
          in: candidateKeys
        }
      }
    })),
    1200,
    []
  );

  const stateByKey = new Map(states.map((item) => [item.sourceKey, item]));
  void ensureNotificationStateBackfill(candidates, stateByKey);

  return candidates
    .map((item) => {
      const state = stateByKey.get(item.sourceKey);
      const detail = String(item.detail || "");
      return {
        id: state?.id ?? item.sourceKey,
        sourceKey: item.sourceKey,
        sourceType: item.sourceType,
        severity: item.severity,
        category: item.category,
        title: item.title,
        detail: summary && detail.length > summaryMaxLength
          ? `${detail.slice(0, summaryMaxLength)}...`
          : detail,
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
    .sort((left, right) => (right.timestamp ?? "").localeCompare(left.timestamp ?? ""))
    .slice(offset, offset + pageSize);
}

export async function getNotificationInboxCandidateTotal(locale: "zh-CN" | "en-US" = "zh-CN") {
  const candidates = await getCachedLiveNotificationCandidates(locale);
  return candidates.length;
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
  const [projects, tasks, auditLogs, runtime, health, agents, uiPreferences] = await Promise.all([
    listProjects(),
    listTasks(),
    withTimeoutFallback(listAuditLogs(12), 1200, []),
    getRuntimeStatus(),
    withTimeoutFallback(getSystemHealth(), 1500, {
      totalProjects: 0,
      activeProjects: 0,
      pendingApprovals: 0,
      activeTasks: 0,
      blockedTasks: 0,
      rejectedStages: 0,
      averageAgentWorkload: 0,
      runtime: {
        mode: "scripted",
        requestedMode: "scripted",
        modelName: "scripted",
        configured: false,
        apiBaseUrl: "",
        apiKeyConfigured: false,
        configSource: "environment",
        lastValidationStatus: "failed",
        lastValidationError: "notifications_timeout_fallback"
      },
      services: []
    }),
    withTimeoutFallback(listOpenClawAgents(), 1200, []),
    withTimeoutFallback(getUiPreferences().catch(() => ({
      language: "zh" as const,
      workspacePath: "",
      autoSync: true,
      apiProtection: true,
      autonomousMode: false,
      usageAlert: true,
      usageAlertThresholdPercent: 80,
      source: "default" as const
    })), 1200, {
      language: "zh" as const,
      workspacePath: "",
      autoSync: true,
      apiProtection: true,
      autonomousMode: false,
      usageAlert: true,
      usageAlertThresholdPercent: 80,
      source: "default" as const
    })
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

  if (uiPreferences.usageAlert) {
    const thresholdPercent = Math.max(50, Math.min(95, Number(uiPreferences.usageAlertThresholdPercent || 80)));
    const thresholdRatio = thresholdPercent / 100;
    const tokenRiskAgents = agents
      .map((agent) => {
        const dailyLimit = Number(agent.commander.maxDailyTokens ?? agent.usage.dailyLimit ?? 0);
        const used = Number(agent.usage.totalTokensToday ?? 0);
        if (!Number.isFinite(dailyLimit) || dailyLimit <= 0 || !Number.isFinite(used) || used <= 0) {
          return null;
        }
        const ratio = used / dailyLimit;
        if (ratio < thresholdRatio) {
          return null;
        }
        return {
          agent,
          used,
          dailyLimit,
          ratio
        };
      })
      .filter((item): item is { agent: typeof agents[number]; used: number; dailyLimit: number; ratio: number } => Boolean(item))
      .sort((left, right) => right.ratio - left.ratio);

    for (const item of tokenRiskAgents.slice(0, 8)) {
      const percent = Math.round(item.ratio * 100);
      const limitText = `${item.used.toLocaleString()} / ${item.dailyLimit.toLocaleString()}`;
      next.push({
        sourceKey: `agent-token:${item.agent.agentId}`,
        sourceType: "agent_token_budget",
        severity: item.ratio >= 1 ? "critical" : "warning",
        category: isEnglish ? "Token budget" : "Token 预算",
        title: isEnglish
          ? `${item.agent.name} token usage reached ${percent}%`
          : `${item.agent.name} Token 使用达到 ${percent}%`,
        detail: isEnglish
          ? `Daily usage ${limitText}; alert threshold ${thresholdPercent}%.`
          : `日用量 ${limitText}；告警阈值 ${thresholdPercent}%。`,
        actionLabel: isEnglish ? "Open commander" : "进入指挥页",
        to: `/agents/${item.agent.agentId}`,
        timestamp: item.agent.usage.lastUsedAt || item.agent.lastActiveAt
      });
    }
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

async function getCachedLiveNotificationCandidates(locale: "zh-CN" | "en-US") {
  const now = Date.now();
  const bucket = liveCandidateCache.get(locale);
  if (bucket && bucket.data.length > 0 && bucket.expiresAt > now) {
    return bucket.data;
  }
  if (bucket?.inflight) {
    return bucket.inflight;
  }

  const inflight = buildLiveNotificationCandidates(locale);
  liveCandidateCache.set(locale, {
    expiresAt: now,
    data: bucket?.data ?? [],
    inflight
  });

  try {
    const data = await inflight;
    liveCandidateCache.set(locale, {
      expiresAt: Date.now() + LIVE_NOTIFICATION_CACHE_TTL_MS,
      data
    });
    return data;
  } finally {
    const latest = liveCandidateCache.get(locale);
    if (latest?.inflight === inflight) {
      liveCandidateCache.set(locale, {
        expiresAt: latest.expiresAt,
        data: latest.data
      });
    }
  }
}

async function ensureNotificationStateBackfill(
  candidates: LiveNotificationCandidate[],
  stateByKey: Map<string, { sourceKey: string }>
) {
  const missing = candidates.filter((item) => !stateByKey.has(item.sourceKey));
  if (missing.length === 0) {
    return;
  }

  try {
    await prisma.notificationState.createMany({
      data: missing.map((item) => ({
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
      })),
      skipDuplicates: true
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "unknown");
    console.warn(`[notifications] state backfill skipped: ${message}`);
  }
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

async function withTimeoutFallback<T>(task: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    const timeoutPromise = new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), timeoutMs);
      timer.unref?.();
    });
    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
