import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSSE } from '../../../hooks/useSSE';
import { formatProjectLogTime, toLogTimestamp } from '../projectRoomShared';

export type ProjectRoomSseLogItem = {
  id: string;
  time: string;
  actor: string;
  message: string;
  type: 'danger' | 'accent' | 'primary';
  timestamp: number;
};

type SnapshotFallbackMetrics = {
  activeAgents?: number;
  totalProjects?: number;
  inProgressTasks?: number;
  blockedTasks?: number;
};

type SnapshotMetrics = {
  activeAgents?: number;
  totalProjects?: number;
  inProgressTasks?: number;
  blockedTasks?: number;
  activeSessions?: number;
  totalSessions?: number;
  staleSessions?: number;
};

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const pickMetric = (...values: Array<unknown>): number | undefined => {
  for (const value of values) {
    const parsed = toNumber(value);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
};

const formatMetric = (value: number | undefined) => (value === undefined ? '-' : String(value));

const resolveSnapshotMetrics = (payload: Record<string, unknown>, fallback?: SnapshotFallbackMetrics): SnapshotMetrics => {
  const sessions = Array.isArray(payload.sessions)
    ? payload.sessions as Array<{ status?: unknown }>
    : [];
  const tools = Array.isArray(payload.tools)
    ? payload.tools as Array<{ activeCount?: unknown; sessionCount?: unknown }>
    : [];

  const activeSessions = sessions.filter((item) => item.status === 'active').length;
  const staleSessions = sessions.filter((item) => item.status === 'stale').length;
  const activeCountFromTools = tools.reduce((sum, item) => sum + (toNumber(item.activeCount) ?? 0), 0);

  return {
    activeAgents: pickMetric(payload.activeAgents, activeCountFromTools > 0 ? activeCountFromTools : undefined, fallback?.activeAgents),
    totalProjects: pickMetric(payload.totalProjects, fallback?.totalProjects),
    inProgressTasks: pickMetric(payload.inProgressTasks, fallback?.inProgressTasks),
    blockedTasks: pickMetric(payload.blockedTasks, fallback?.blockedTasks),
    activeSessions: sessions.length > 0 ? activeSessions : undefined,
    totalSessions: sessions.length > 0 ? sessions.length : undefined,
    staleSessions: sessions.length > 0 ? staleSessions : undefined,
  };
};

export function useProjectRoomSseLogs(
  effectiveProjectId: string | null | undefined,
  snapshotFallback?: SnapshotFallbackMetrics,
) {
  const [sseLogs, setSseLogs] = useState<ProjectRoomSseLogItem[]>([]);
  const lastSnapshotDigestRef = useRef<string>('');
  const lastConnectedLogAtRef = useRef<number>(0);
  const snapshotFallbackRef = useRef<SnapshotFallbackMetrics | undefined>(snapshotFallback);

  useEffect(() => {
    snapshotFallbackRef.current = snapshotFallback;
  }, [snapshotFallback]);

  useEffect(() => {
    setSseLogs([]);
    lastSnapshotDigestRef.current = '';
    lastConnectedLogAtRef.current = 0;
  }, [effectiveProjectId]);

  const appendSseLog = useCallback((item: ProjectRoomSseLogItem) => {
    setSseLogs((prev) => {
      if (prev[0]?.id === item.id) {
        return prev;
      }
      return [item, ...prev].slice(0, 20);
    });
  }, []);

  const handleProjectRoomSseEvent = useCallback((event: MessageEvent) => {
    const eventType = event.type || 'message';
    let payload: Record<string, unknown> = {};
    try {
      payload = event.data ? JSON.parse(event.data) as Record<string, unknown> : {};
    } catch {
      payload = {};
    }

    if (eventType === 'heartbeat') {
      return;
    }

    let actor = '系统';
    let message = '';
    let type: ProjectRoomSseLogItem['type'] = 'primary';
    let timestamp = toLogTimestamp(payload.timestamp as string | undefined);

    if (eventType === 'connected') {
      const now = Date.now();
      if (now - lastConnectedLogAtRef.current < 15000) {
        return;
      }
      lastConnectedLogAtRef.current = now;
      timestamp = now;
      message = '实时通道已连接（SSE）';
    } else if (eventType === 'snapshot') {
      const metrics = resolveSnapshotMetrics(payload, snapshotFallbackRef.current);
      const digest = [
        formatMetric(metrics.activeAgents),
        formatMetric(metrics.totalProjects),
        formatMetric(metrics.inProgressTasks),
        formatMetric(metrics.blockedTasks),
        formatMetric(metrics.activeSessions),
        formatMetric(metrics.totalSessions),
        formatMetric(metrics.staleSessions),
      ].join(':');
      if (digest && digest === lastSnapshotDigestRef.current) {
        return;
      }
      lastSnapshotDigestRef.current = digest;
      timestamp = toLogTimestamp(
        (payload.timestamp as string | undefined)
        || (payload.scannedAt as string | undefined),
      );
      const sessionSummary = metrics.totalSessions !== undefined
        ? ` / 活跃会话 ${formatMetric(metrics.activeSessions)}/${formatMetric(metrics.totalSessions)}`
        : '';
      message = `系统快照: 活跃Agent ${formatMetric(metrics.activeAgents)} / 项目 ${formatMetric(metrics.totalProjects)} / 进行中任务 ${formatMetric(metrics.inProgressTasks)} / 阻塞任务 ${formatMetric(metrics.blockedTasks)}${sessionSummary}`;
      type = (metrics.blockedTasks ?? 0) > 0 || (metrics.staleSessions ?? 0) > 0 ? 'danger' : 'primary';
    } else if (eventType === 'task_update') {
      timestamp = toLogTimestamp(payload.timestamp as string | undefined);
      const blocked = Number(payload.blockedTasks ?? 0);
      const inProgress = Number(payload.inProgressTasks ?? 0);
      const total = Number(payload.totalTasks ?? 0);
      message = blocked > 0
        ? `任务变化: 共 ${total} 条，进行中 ${inProgress}，阻塞 ${blocked}（需处理）`
        : `任务变化: 共 ${total} 条，进行中 ${inProgress}，阻塞 ${blocked}`;
      type = Number(payload.blockedTasks ?? 0) > 0 ? 'danger' : 'accent';
    } else if (eventType === 'project_progress') {
      timestamp = toLogTimestamp(payload.timestamp as string | undefined);
      const changedProjects = Array.isArray(payload.changedProjects)
        ? payload.changedProjects as Array<{ projectId?: string; name?: string; progress?: number; blockedTaskCount?: number }>
        : [];
      const related = changedProjects.find((item) => item.projectId === effectiveProjectId) || changedProjects[0];
      if (!related) {
        return;
      }
      actor = related.name || '项目';
      message = `进度更新: ${related.progress ?? 0}% · 阻塞 ${related.blockedTaskCount ?? 0}`;
      type = Number(related.blockedTaskCount ?? 0) > 0 ? 'danger' : 'accent';
    } else if (eventType === 'agent_status') {
      timestamp = toLogTimestamp(payload.timestamp as string | undefined);
      const changedAgents = Array.isArray(payload.changedAgents)
        ? payload.changedAgents as Array<{ name?: string; status?: string; blockedTaskCount?: number; taskCount?: number }>
        : [];
      if (changedAgents.length === 0) {
        return;
      }
      const latest = changedAgents[0];
      actor = latest.name || 'Agent';
      const taskText = typeof latest.taskCount === 'number' ? ` · 任务 ${latest.taskCount}` : '';
      const blockedText = typeof latest.blockedTaskCount === 'number' ? ` · 阻塞 ${latest.blockedTaskCount}` : '';
      message = `状态变更为 ${latest.status || 'unknown'}${taskText}${blockedText}`;
      type = latest.status === 'attention' || latest.status === 'offline' ? 'danger' : 'primary';
    } else if (eventType === 'system') {
      timestamp = toLogTimestamp(payload.timestamp as string | undefined);
      const status = String(payload.status || 'ok');
      message = String(payload.message || '系统状态更新');
      type = status === 'degraded' ? 'danger' : 'primary';
    } else {
      return;
    }

    appendSseLog({
      id: `${eventType}-${timestamp}-${actor}-${message}`,
      time: formatProjectLogTime(new Date(timestamp)),
      actor,
      message,
      type,
      timestamp,
    });
  }, [appendSseLog, effectiveProjectId]);

  const sseEvents = useMemo(
    () => ['connected', 'snapshot', 'task_update', 'project_progress', 'agent_status', 'system', 'heartbeat'],
    [],
  );

  useSSE('/api/openclaw/events', {
    withCredentials: true,
    events: sseEvents,
    onEvent: handleProjectRoomSseEvent,
  });

  return { sseLogs, appendSseLog };
}
