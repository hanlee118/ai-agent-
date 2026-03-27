import { request } from './core';
import type { SystemAuditLog } from './types';

export const auditApi = {
  async list(params?: {
    startTime?: string;
    endTime?: string;
    action?: string;
    userId?: string;
    limit?: number;
  }) {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    const query = searchParams.toString();
    return request<SystemAuditLog[]>(`/system/audit-logs${query ? `?${query}` : ''}`);
  },

  async listSystem(limit = 50) {
    const searchParams = new URLSearchParams();
    searchParams.set('limit', limit.toString());
    return request<SystemAuditLog[]>(`/system/audit-logs?${searchParams.toString()}`);
  },
};
