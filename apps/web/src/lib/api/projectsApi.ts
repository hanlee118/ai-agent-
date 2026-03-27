import { request } from './core';
import type { Deliverable, Pagination, Project, Stage } from './types';

export const projectsApi = {
  async list(params?: { status?: string; page?: number; limit?: number }) {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    const query = searchParams.toString();
    return request<{ data: Project[]; pagination: Pagination }>(`/projects${query ? `?${query}` : ''}`);
  },

  async get(id: string) {
    return request<Project>(`/projects/${id}`);
  },

  async create(data: {
    name: string;
    description?: string;
    requirements?: string;
  }) {
    return request<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async update(id: string, data: Partial<Project>) {
    return request<Project>(`/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async getStages(id: string) {
    return request<Stage[]>(`/projects/${id}/stages`);
  },

  async getDeliverables(id: string) {
    return request<Deliverable[]>(`/projects/${id}/deliverables`);
  },

  async submitDeliverable(
    projectId: string,
    data: {
      stage: string;
      title: string;
      content: string;
      attachments?: string[];
    },
  ) {
    return request<Deliverable>(`/projects/${projectId}/deliverables`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async intervene(id: string, command: string) {
    return request(`/projects/${id}/intervene`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    });
  },

  async resume(id: string) {
    return request(`/projects/${id}/resume`, {
      method: 'POST',
    });
  },
};
