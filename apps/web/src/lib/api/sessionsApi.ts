import { request } from './core';
import type { Session } from './types';

export const sessionsApi = {
  async list(params?: { projectId?: string; agentId?: string; status?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.projectId) searchParams.set('projectId', params.projectId);
    if (params?.agentId) searchParams.set('agentId', params.agentId);
    if (params?.status) searchParams.set('status', params.status);
    const query = searchParams.toString();
    return request<Session[]>(`/sessions${query ? `?${query}` : ''}`);
  },
};
