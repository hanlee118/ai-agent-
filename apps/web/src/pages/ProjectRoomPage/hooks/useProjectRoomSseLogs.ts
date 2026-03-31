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

export function useProjectRoomSseLogs(effectiveProjectId: string | null | undefined) {
  const [sseLogs, setSseLogs] = useState<ProjectRoomSseLogItem[]>([]);
  const lastSnapshotDigestRef = useRef<string>('');
  const lastConnectedLogAtRef = useRef<number>(0);

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
      const digest = [
        String(payload.activeAgents ?? ''),
        String(payload.totalProjects ?? ''),
        String(payload.blockedTasks ?? ''),
        String(payload.inProgressTasks ?? ''),
      ].join(':');
      if (digest && digest === lastSnapshotDigestRef.current) {
        return;
      }
      lastSnapshotDigestRef.current = digest;
      timestamp = toLogTimestamp(payload.timestamp as string | undefined);
      message = `系统快照: 活跃Agent ${payload.activeAgents ?? 0} / 项目 ${payload.totalProjects ?? 0} / 进行中任务 ${payload.inProgressTasks ?? 0} / 阻塞任务 ${payload.blockedTasks ?? 0}`;
      type = Number(payload.blockedTasks ?? 0) > 0 ? 'danger' : 'primary';
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
