import { request } from './core';
import type { Agent } from './types';
import type { RoleType } from '@occ/shared';

export type AgentRoleTemplate = {
  id: string;
  roleId: RoleType;
  name: string;
  desc: string;
  suggestedAgentName: string;
  soul: string;
  sop: string[];
  modelId?: string;
};

export const agentsApi = {
  async list() {
    return request<Agent[]>('/agents');
  },

  async listTemplates() {
    return request<AgentRoleTemplate[]>('/agents/templates');
  },

  async createTemplate(data: AgentRoleTemplate) {
    return request<AgentRoleTemplate>('/agents/templates', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateTemplate(templateId: string, data: AgentRoleTemplate) {
    const safeId = encodeURIComponent(String(templateId || '').trim());
    return request<AgentRoleTemplate>(`/agents/templates/${safeId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteTemplate(templateId: string) {
    const safeId = encodeURIComponent(String(templateId || '').trim());
    return request<{ deleted: string; remaining: number }>(`/agents/templates/${safeId}`, {
      method: 'DELETE',
    });
  },

  async resetTemplates() {
    return request<{ templates: AgentRoleTemplate[] }>('/agents/templates/reset', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  async get(id: string) {
    return request<Agent>(`/agents/${id}`);
  },

  async create(data: {
    name: string;
    role: string;
    modelId?: string;
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

  async delete(id: string) {
    return request(`/agents/${id}`, { method: 'DELETE' });
  },
};
