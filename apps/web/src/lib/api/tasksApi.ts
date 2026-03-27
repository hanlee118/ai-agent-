import { request } from './core';
import type { Task } from './types';

export const tasksApi = {
  async list(params?: { projectId?: string; status?: string; assignee?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.projectId) searchParams.set('projectId', params.projectId);
    if (params?.status) searchParams.set('status', params.status);
    if (params?.assignee) searchParams.set('assignee', params.assignee);
    const query = searchParams.toString();
    return request<Task[]>(`/tasks${query ? `?${query}` : ''}`);
  },

  async create(data: {
    title: string;
    description?: string;
    projectId: string;
    assignee?: string;
    priority?: string;
    due?: string;
  }) {
    return request<Task>('/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async update(id: string, data: Partial<Task>) {
    return request<Task>(`/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },
};
