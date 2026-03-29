import { request } from './core';
import type { Deliverable, Pagination, Project, Stage } from './types';

export type ParsedProjectIntent = {
  name: string;
  description: string;
  phase: string;
  agents: string[];
  team: string[];
  priority: 'High' | 'Medium' | 'Low';
};

export type ProjectAcceptanceReport = {
  projectId: string;
  projectName: string;
  generatedAt: string;
  status: string;
  currentStage: string;
  progress: number;
  pendingApproval: boolean;
  summary: {
    stageCount: number;
    deliverableCount: number;
    approvedDeliverables: number;
    blockedTasks: number;
    inProgressTasks: number;
    completedTasks: number;
    signoffApproved: number;
    signoffRejected: number;
    signoffPending: number;
  };
  stages: Array<{
    stageType: string;
    stageLabel: string;
    assignee: string;
    status: string;
    progress: number;
    startedAt?: string;
    endedAt?: string;
    deliverables: {
      total: number;
      approved: number;
      submitted: number;
      rejected: number;
      draft: number;
      latestUpdatedAt?: string;
    };
    acceptance: {
      result: 'approved' | 'rejected' | 'pending' | 'none';
      note: string;
    };
  }>;
  signoffHistory: Array<{
    id: string;
    timestamp: string;
    stageType?: string;
    stageLabel: string;
    decision: 'approved' | 'rejected' | 'pending';
    actor: string;
    reason: string;
  }>;
  archivedReports: Array<{
    id: string;
    name: string;
    version: number;
    updatedAt: string;
  }>;
  comparison?: {
    baselineName: string;
    baselineGeneratedAt: string;
    note: string;
    delta: {
      deliverableCount: number;
      approvedDeliverables: number;
      blockedTasks: number;
      inProgressTasks: number;
      completedTasks: number;
      signoffApproved: number;
      signoffRejected: number;
      signoffPending: number;
    };
  };
  recentTimeline: Array<{
    id: string;
    timestamp: string;
    type: string;
    title: string;
    content: string;
    priority: string;
    agentId?: string;
  }>;
  recentDeliverables: Array<{
    id: string;
    stageType: string;
    name: string;
    status: string;
    version: number;
    createdBy: string;
    updatedAt: string;
  }>;
  recommendations: string[];
};

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

  async getAcceptanceReport(id: string) {
    return request<ProjectAcceptanceReport>(`/projects/${id}/acceptance-report`);
  },

  async exportAcceptanceReportMarkdown(id: string) {
    return request<string>(`/projects/${id}/acceptance-report.md`);
  },

  async archiveAcceptanceReport(id: string, title?: string) {
    return request<{
      projectId: string;
      archived: boolean;
      deliverableName: string;
    }>(`/projects/${id}/acceptance-report/archive`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
  },

  async getDetail(id: string) {
    return request<{
      id: string;
      name: string;
      status: string;
      currentStage: string;
      pendingApproval: boolean;
      progress: number;
      summary?: string;
      stages?: Array<{
        type: string;
        label: string;
        assignee: string;
        status: 'pending' | 'active' | 'completed' | 'blocked' | 'rejected';
        progress: number;
        startedAt?: string;
        endedAt?: string;
      }>;
      tasks?: Array<{
        id: string;
        projectId: string;
        stageType: string;
        title: string;
        description: string;
        assignee: string;
        status: 'todo' | 'in_progress' | 'blocked' | 'done';
        priority: 'low' | 'normal' | 'high';
        updatedAt: string;
      }>;
      deliverables?: Array<{
        id: string;
        name: string;
        type: string;
        status: 'draft' | 'submitted' | 'approved' | 'rejected';
        stageType: string;
        content?: string;
        version?: number;
        createdBy?: string;
        updatedAt: string;
      }>;
      timeline?: Array<{
        id: string;
        timestamp: string;
        agentId?: string;
        type: string;
        title: string;
        content: string;
        priority: 'low' | 'normal' | 'high' | 'urgent';
      }>;
    }>(`/projects/${id}`);
  },

  async create(data: {
    name: string;
    description?: string;
    requirements?: string;
    team?: string[];
  }) {
    return request<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async parse(input: string) {
    return request<ParsedProjectIntent>('/projects/parse', {
      method: 'POST',
      body: JSON.stringify({ input }),
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

  async close(id: string) {
    return request(`/projects/${id}/close`, {
      method: 'POST',
    });
  },

  async remove(id: string) {
    return request<{ success: boolean; id: string }>(`/projects/${id}`, {
      method: 'DELETE',
    });
  },

  async advance(id: string) {
    return request(`/projects/${id}/advance`, {
      method: 'POST',
    });
  },

  async getAutomation() {
    return request<{
      enabled: boolean;
      intervalMs: number;
      running: boolean;
      lastRunAt: string | null;
      lastError: string | null;
      lastSummary: string;
    }>('/projects/automation');
  },

  async setAutomation(data: { enabled: boolean; intervalMs?: number }) {
    return request<{
      enabled: boolean;
      intervalMs: number;
      running: boolean;
      lastRunAt: string | null;
      lastError: string | null;
      lastSummary: string;
    }>('/projects/automation', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async runAutomationOnce() {
    return request<{
      enabled: boolean;
      intervalMs: number;
      running: boolean;
      lastRunAt: string | null;
      lastError: string | null;
      lastSummary: string;
    }>('/projects/automation/run', {
      method: 'POST',
    });
  },

  async submitStage(
    id: string,
    data: {
      title?: string;
      content: string;
      designReview?: {
        visualDirection: string;
        brandTone: string;
        uxPrinciples: string[];
        accessibilityChecklist: string[];
        approvedBy: string;
        approved: boolean;
        notes?: string;
      };
    },
  ) {
    return request(`/projects/${id}/stages/submit`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async approve(id: string) {
    return request(`/projects/${id}/approve`, {
      method: 'POST',
    });
  },

  async reject(id: string, reason: string) {
    return request(`/projects/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },
};
