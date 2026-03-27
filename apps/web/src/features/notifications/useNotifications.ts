import { useCallback, useEffect, useMemo, useState } from 'react';
import { notificationsApi, type NotificationInboxItem } from '../../lib/api';
import type { Agent, Project, Session, Task } from '../../types';

export type NotificationItem = {
  id: string;
  title: string;
  content: string;
  time: string;
  type: 'info' | 'success' | 'warning';
  read: boolean;
  sourceKey?: string;
  to?: string;
};

type ToastFn = (message: string, type?: 'success' | 'error' | 'info') => void;

type UseNotificationsParams = {
  isLoggedIn: boolean;
  agents: Agent[];
  projects: Project[];
  tasks: Task[];
  sessions: Session[];
  addToast: ToastFn;
};

export function useNotifications({
  isLoggedIn,
  agents,
  projects,
  tasks,
  sessions,
  addToast,
}: UseNotificationsParams) {
  const [inboxNotifications, setInboxNotifications] = useState<NotificationInboxItem[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [markingAllRead, setMarkingAllRead] = useState(false);

  const toRelativeLabel = useCallback((dateInput: string | Date | null | undefined): string => {
    if (!dateInput) return '刚刚';
    const timestamp = new Date(dateInput).getTime();
    if (!Number.isFinite(timestamp)) return '刚刚';
    const diffMs = Date.now() - timestamp;
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    return `${Math.floor(hours / 24)} 天前`;
  }, []);

  const refreshNotifications = useCallback(async () => {
    try {
      setNotificationsLoading(true);
      const list = await notificationsApi.listInbox('zh-CN');
      setInboxNotifications(Array.isArray(list) ? list : []);
    } catch {
      setInboxNotifications([]);
    } finally {
      setNotificationsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoggedIn) {
      setInboxNotifications([]);
      return;
    }
    void refreshNotifications();
  }, [isLoggedIn, refreshNotifications]);

  const fallbackNotifications = useMemo<NotificationItem[]>(() => {
    const items: NotificationItem[] = [];

    tasks
      .filter((task) => task.status === 'Blocked')
      .slice(0, 2)
      .forEach((task) => {
        items.push({
          id: `task-blocked-${task.id}`,
          sourceKey: `task-blocked-${task.id}`,
          title: '任务阻塞提醒',
          content: `${task.agent || '系统'} 的任务「${task.title}」当前处于阻塞状态，请及时处理。`,
          time: toRelativeLabel(task.updatedAt || task.createdAt),
          type: 'warning',
          read: false,
          to: task.projectId ? `/projects/${task.projectId}` : '/projects',
        });
      });

    projects
      .filter((project) => project.status === 'Blocked' || (project.status as string) === 'At Risk' || project.phase === '风险阶段')
      .slice(0, 2)
      .forEach((project) => {
        items.push({
          id: `project-risk-${project.id}`,
          sourceKey: `project-risk-${project.id}`,
          title: '项目风险预警',
          content: `项目「${project.name}」状态为 ${project.status}，建议优先复盘关键依赖。`,
          time: toRelativeLabel(project.updatedAt),
          type: 'warning',
          read: false,
          to: `/projects/${project.id}`,
        });
      });

    sessions.slice(0, 2).forEach((session) => {
      const agent = agents.find((item) => item.id === session.agentId);
      const project = projects.find((item) => item.id === session.projectId);
      items.push({
        id: `session-${session.id}`,
        sourceKey: `session-${session.id}`,
        title: session.status === 'active' ? '会话进行中' : '会话状态更新',
        content: `${agent?.name || 'Agent'} 正在处理 ${project?.name || '项目任务'}。`,
        time: toRelativeLabel(session.updatedAt || session.startTime),
        type: session.status === 'active' ? 'info' : 'success',
        read: false,
        to: agent?.id ? `/agents/${agent.id}` : '/monitoring',
      });
    });

    if (items.length === 0) {
      items.push({
        id: 'system-normal',
        title: '系统状态',
        content: '当前未检测到新的风险或阻塞事件。',
        time: '刚刚',
        type: 'info',
        read: false,
        to: '/dashboard',
      });
    }

    return items.slice(0, 6);
  }, [tasks, projects, sessions, agents, toRelativeLabel]);

  const notifications = useMemo<NotificationItem[]>(() => {
    if (inboxNotifications.length === 0) {
      return fallbackNotifications;
    }

    return inboxNotifications
      .slice(0, 8)
      .map((item) => ({
        id: item.id || item.sourceKey,
        sourceKey: item.sourceKey,
        title: item.title,
        content: item.detail,
        time: toRelativeLabel(item.timestamp || item.updatedAt),
        read: Boolean(item.read),
        type: (item.severity === 'critical' || item.severity === 'warning' ? 'warning' : 'info') as 'info' | 'success' | 'warning',
        to: item.to,
      }));
  }, [inboxNotifications, fallbackNotifications, toRelativeLabel]);

  const unreadNotificationCount = notifications.filter((item) => !item.read).length;

  const markAllNotificationsRead = useCallback(async () => {
    if (inboxNotifications.length === 0) {
      addToast('当前没有可标记的通知', 'info');
      return;
    }

    const pending = inboxNotifications.filter((item) => !item.read);
    if (pending.length === 0) {
      addToast('通知已全部为已读状态', 'info');
      return;
    }

    setMarkingAllRead(true);
    try {
      await Promise.all(
        pending.map((item) =>
          notificationsApi.updateInbox(item.sourceKey, { read: true, workflowStatus: 'acknowledged' }),
        ),
      );
      await refreshNotifications();
      addToast('已全部标为已读', 'success');
    } catch (error) {
      addToast(`标记失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setMarkingAllRead(false);
    }
  }, [addToast, inboxNotifications, refreshNotifications]);

  const markNotificationRead = useCallback(async (notification: { sourceKey?: string; read?: boolean }) => {
    if (!notification.sourceKey || notification.read) {
      return;
    }

    try {
      await notificationsApi.updateInbox(notification.sourceKey, {
        read: true,
        workflowStatus: 'acknowledged',
      });
      await refreshNotifications();
    } catch {
      // ignore notification state update errors on click
    }
  }, [refreshNotifications]);

  return {
    notifications,
    unreadNotificationCount,
    notificationsLoading,
    markingAllRead,
    refreshNotifications,
    markAllNotificationsRead,
    markNotificationRead,
  };
}
