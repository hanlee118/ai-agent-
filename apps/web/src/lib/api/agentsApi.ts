import { request } from './core';
import type { Agent } from './types';

export const agentsApi = {
  async list() {
    return request<Agent[]>('/agents');
  },

  async get(id: string) {
    return request<Agent>(`/agents/${id}`);
  },

  async create(data: {
    name: string;
    role: string;
    modelId?: string;
    integrationEngine?: 'hermes' | 'openclaw' | 'managed';
    soul?: string;
    sop?: string[];
  }) {
    return request<Agent>('/agents', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateSoul(id: string, content: string) {
    return request(`/agents/${id}/soul`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    });
  },

  async updateSop(id: string, steps: string[]) {
    return request(`/agents/${id}/sop`, {
      method: 'PATCH',
      body: JSON.stringify({ steps }),
    });
  },

  async switchModel(id: string, modelId: string) {
    return request(`/agents/${id}/model`, {
      method: 'PATCH',
      body: JSON.stringify({ modelId }),
    });
  },

  async switchEngine(id: string, integrationEngine: 'hermes' | 'openclaw' | 'managed') {
    return request(`/agents/${id}/engine`, {
      method: 'PATCH',
      body: JSON.stringify({ integrationEngine }),
    });
  },

  async delete(id: string) {
    return request(`/agents/${id}`, { method: 'DELETE' });
  },
};
