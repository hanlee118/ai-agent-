import { request } from './core';
import type { Model, ModelLog, ModelMetrics } from './types';

export const modelsApi = {
  async list() {
    return request<Model[]>('/models');
  },

  async get(id: string) {
    return request<Model>(`/models/${id}`);
  },

  async create(data: {
    name: string;
    provider: string;
    apiKey?: string;
    apiBaseUrl?: string;
    tokenLimit?: number;
  }) {
    return request<Model>('/models', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async update(id: string, data: Partial<Model>) {
    return request<Model>(`/models/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async delete(id: string) {
    return request(`/models/${id}`, { method: 'DELETE' });
  },

  async getLogs(id: string, type?: string, limit = 50) {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    params.set('limit', limit.toString());
    return request<ModelLog[]>(`/models/${id}/logs?${params.toString()}`);
  },

  async getMetrics(id: string) {
    return request<ModelMetrics>(`/models/${id}/metrics`);
  },

  async healthCheck(id: string) {
    return request<{ reachable: boolean; latency: string; error: string | null }>(
      `/models/${id}/health-check`,
      { method: 'POST' },
    );
  },

  async setDefault(id: string) {
    return request<{
      model: Model;
      runtime: {
        provider: string;
        apiBaseUrl: string;
        modelName: string;
        apiKeyConfigured: boolean;
        apiKeyPreview?: string;
      };
    }>(`/models/${id}/set-default`, {
      method: 'POST',
    });
  },

  async discover(data?: {
    provider?: string;
    apiBaseUrl?: string;
    apiKey?: string;
  }) {
    return request<{
      provider: string;
      apiBaseUrl: string;
      discovered: number;
      synced: number;
      models: Model[];
    }>('/models/discover', {
      method: 'POST',
      body: JSON.stringify(data ?? {}),
    });
  },
};
