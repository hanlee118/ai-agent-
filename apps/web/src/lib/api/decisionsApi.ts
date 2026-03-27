import { request } from './core';
import type { Decision } from './types';

export const decisionsApi = {
  async list(status?: string) {
    const params = status ? `?status=${status}` : '';
    return request<Decision[]>(`/decisions${params}`);
  },

  async approve(id: string) {
    return request(`/decisions/${id}/approve`, { method: 'POST' });
  },

  async reject(id: string, reason: string) {
    return request(`/decisions/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async revise(id: string, reason: string) {
    return request(`/decisions/${id}/revise`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },
};
