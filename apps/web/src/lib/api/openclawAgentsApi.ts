import { request } from "./core";
import type { OpenClawProjectReport } from "./types";

export type OpenClawAgentDetail = {
  agentId: string;
  name: string;
  title?: string;
  responsibility?: string;
  model?: string;
  commander?: {
    selectedModel?: string;
  };
  soul?: {
    content?: string;
  };
  sop?: {
    content?: string;
  };
};

export type OpenClawAgentSummary = {
  agentId: string;
  name: string;
  title?: string;
};

export const openclawAgentsApi = {
  async list() {
    return request<OpenClawAgentSummary[]>(`/openclaw/agents`);
  },

  async get(agentId: string) {
    const safeId = encodeURIComponent(String(agentId || "").trim());
    return request<OpenClawAgentDetail>(`/openclaw/agents/${safeId}`);
  },

  async create(data: {
    agentId: string;
    name: string;
    title: string;
    model: string;
    intro?: string;
    soul?: string;
    sop?: string;
    responsibility?: string;
    allowedAgentIds?: string[];
    tools?: string[];
  }) {
    return request(`/openclaw/agents`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async updateSettings(
    agentId: string,
    data: {
      selectedModel?: string;
      defaultModel?: string;
      fallbackModel?: string;
      displayName?: string;
      title?: string;
      intro?: string;
      responsibility?: string;
      allowedAgentIds?: string[];
      tools?: string[];
    },
  ) {
    const safeId = encodeURIComponent(String(agentId || "").trim());
    return request(`/openclaw/agents/${safeId}/settings`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  async updateDocument(agentId: string, type: "soul" | "sop", content: string) {
    const safeId = encodeURIComponent(String(agentId || "").trim());
    return request(`/openclaw/agents/${safeId}/document/${type}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    });
  },

  async delete(agentId: string) {
    const safeId = encodeURIComponent(String(agentId || "").trim());
    return request(`/openclaw/agents/${safeId}`, { method: "DELETE" });
  },

  async getProjectReport(projectId: string) {
    const safeId = encodeURIComponent(String(projectId || "").trim());
    return request<OpenClawProjectReport>(`/openclaw/projects/${safeId}/report`);
  },
};
