import { request } from './core';
import type { Notification, NotificationInboxItem } from './types';

export const notificationsApi = {
  async list(params?: { severity?: string; status?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.severity) searchParams.set('severity', params.severity);
    if (params?.status) searchParams.set('status', params.status);
    const query = searchParams.toString();
    return request<Notification[]>(`/notifications${query ? `?${query}` : ''}`);
  },

  async listInbox(locale: 'zh-CN' | 'en-US' = 'zh-CN') {
    const searchParams = new URLSearchParams();
    searchParams.set('locale', locale);
    return request<NotificationInboxItem[]>(`/notifications?${searchParams.toString()}`);
  },

  async update(id: string, status: string) {
    return request(`/notifications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },

  async updateInbox(sourceKey: string, data: {
    read?: boolean;
    assignedTo?: string;
    confirmedBy?: string;
    workflowStatus?: 'open' | 'acknowledged' | 'resolved';
  }) {
    return request<NotificationInboxItem>(`/notifications/${encodeURIComponent(sourceKey)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async markAllRead() {
    const list = await notificationsApi.listInbox('zh-CN');
    const pending = list.filter((item) => !item.read);
    await Promise.all(
      pending.map((item) =>
        notificationsApi.updateInbox(item.sourceKey, {
          read: true,
          workflowStatus: 'acknowledged',
        }),
      ),
    );
    return { updated: pending.length };
  },
};
