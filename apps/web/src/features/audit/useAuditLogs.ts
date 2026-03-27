import { useCallback, useEffect, useMemo, useState } from 'react';
import { auditApi, type SystemAuditLog } from '../../lib/api';
import type { Agent, Project, Session, Task } from '../../types';

export type AuditLogRow = {
  time: string;
  actor: string;
  action: string;
  resource: string;
  status: '成功' | '警告' | '进行中';
  sortValue: number;
  raw: unknown;
};

type UseAuditLogsParams = {
  agents: Agent[];
  projects: Project[];
  tasks: Task[];
  sessions: Session[];
};

export function useAuditLogs({ agents, projects, tasks, sessions }: UseAuditLogsParams) {
  const [remoteLogs, setRemoteLogs] = useState<SystemAuditLog[]>([]);
  const [isLoadingRemoteLogs, setIsLoadingRemoteLogs] = useState(false);

  const formatLogTime = useCallback((value: string | Date | null | undefined) => {
    if (!value) {
      return '--:--:--';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '--:--:--';
    }
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }, []);

  const extractEntityDate = useCallback((entity: unknown): string | null => {
    if (!entity || typeof entity !== 'object') {
      return null;
    }

    const record = entity as Record<string, unknown>;
    const rawDate = record.updatedAt ?? record.createdAt ?? record.startTime ?? null;
    if (!rawDate) {
      return null;
    }

    if (typeof rawDate === 'string') {
      return rawDate;
    }

    if (rawDate instanceof Date) {
      return rawDate.toISOString();
    }

    return null;
  }, []);

  const localAuditLogs = useMemo<AuditLogRow[]>(() => {
    const logs: AuditLogRow[] = [];

    const recentSessions = sessions
      .slice()
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
      .slice(0, 5);

    recentSessions.forEach((session) => {
      const agent = agents.find((candidate) => candidate.id === session.agentId);
      const project = projects.find((candidate) => candidate.id === session.projectId);
      if (!agent && !project) {
        return;
      }

      const eventDate = extractEntityDate(session) ?? session.startTime;
      const timestamp = new Date(eventDate).getTime();

      logs.push({
        time: formatLogTime(eventDate),
        actor: agent?.name || 'Agent',
        action: session.status === 'active' ? '进行中任务' : '完成任务',
        resource: project?.name || '项目',
        status: session.status === 'active' ? '进行中' : '成功',
        sortValue: Number.isFinite(timestamp) ? timestamp : 0,
        raw: session,
      });
    });

    projects
      .filter((project) => project.status === 'Blocked')
      .slice(0, 2)
      .forEach((project) => {
        const eventDate = extractEntityDate(project) ?? new Date().toISOString();
        const timestamp = new Date(eventDate).getTime();
        logs.push({
          time: formatLogTime(eventDate),
          actor: '系统',
          action: '项目阻塞',
          resource: project.name,
          status: '警告',
          sortValue: Number.isFinite(timestamp) ? timestamp : 0,
          raw: project,
        });
      });

    tasks
      .filter((task) => task.status === 'Blocked')
      .slice(0, 2)
      .forEach((task) => {
        const eventDate = extractEntityDate(task) ?? new Date().toISOString();
        const timestamp = new Date(eventDate).getTime();
        logs.push({
          time: formatLogTime(eventDate),
          actor: task.agent || '系统',
          action: '任务阻塞',
          resource: task.title,
          status: '警告',
          sortValue: Number.isFinite(timestamp) ? timestamp : 0,
          raw: task,
        });
      });

    return logs.sort((a, b) => b.sortValue - a.sortValue).slice(0, 10);
  }, [agents, extractEntityDate, formatLogTime, projects, sessions, tasks]);

  const refreshAuditLogs = useCallback(async () => {
    setIsLoadingRemoteLogs(true);
    try {
      const list = await auditApi.listSystem(100);
      setRemoteLogs(Array.isArray(list) ? list : []);
    } catch {
      setRemoteLogs([]);
    } finally {
      setIsLoadingRemoteLogs(false);
    }
  }, []);

  useEffect(() => {
    void refreshAuditLogs();
  }, [refreshAuditLogs]);

  const normalizedRemoteLogs = useMemo<AuditLogRow[]>(() => {
    return remoteLogs
      .map((log) => {
        const createdAtTs = new Date(log.createdAt).getTime();
        const summary = log.summary?.trim() || log.action || '系统事件';
        const resource = log.resourceId ? `${log.resourceType}:${log.resourceId}` : log.resourceType;
        const content = `${summary} ${log.detail || ''}`.toLowerCase();
        const status: '成功' | '警告' | '进行中' =
          /failed|error|blocked|deny|rejected|失败|阻塞|警告/.test(content)
            ? '警告'
            : /pending|running|processing|进行中|处理中/.test(content)
              ? '进行中'
              : '成功';

        return {
          time: formatLogTime(log.createdAt),
          actor: log.actorLabel || log.actorType || '系统',
          action: summary,
          resource,
          status,
          sortValue: Number.isFinite(createdAtTs) ? createdAtTs : 0,
          raw: log,
        };
      })
      .sort((a, b) => b.sortValue - a.sortValue)
      .slice(0, 50);
  }, [formatLogTime, remoteLogs]);

  const auditLogs = useMemo(
    () => (normalizedRemoteLogs.length > 0 ? normalizedRemoteLogs : localAuditLogs),
    [localAuditLogs, normalizedRemoteLogs],
  );

  return {
    auditLogs,
    isLoadingRemoteLogs,
    refreshAuditLogs,
  };
}
