import { request } from './core';
import type { Task, TaskDelegation, TaskDelegationBundle, TaskExecutionContext } from './types';

export const tasksApi = {
  async list(params?: { projectId?: string; status?: string; assignee?: string }) {
    if (params?.projectId && !params.status && !params.assignee) {
      return request<Task[]>(`/projects/${encodeURIComponent(params.projectId)}/tasks`);
    }

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

  async assignOwner(taskId: string, ownerAgentId: string) {
    return request<Task>(`/tasks/${encodeURIComponent(taskId)}/assign`, {
      method: 'POST',
      body: JSON.stringify({ ownerAgentId }),
    });
  },

  async setReviewer(taskId: string, reviewAgentId?: string | null) {
    return request<Task>(`/tasks/${encodeURIComponent(taskId)}/reviewer`, {
      method: 'POST',
      body: JSON.stringify({ reviewAgentId: reviewAgentId ?? '' }),
    });
  },

  async setCoordinationMode(
    taskId: string,
    data: {
      coordinationMode: string;
      delegationPolicy?: string;
      syncPolicy?: string;
      contextScope?: string;
    },
  ) {
    return request<Task>(`/tasks/${encodeURIComponent(taskId)}/coordination-mode`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getContext(taskId: string) {
    return request<TaskExecutionContext>(`/tasks/${encodeURIComponent(taskId)}/context`);
  },

  async listDelegations(taskId: string) {
    return request<TaskDelegationBundle>(`/tasks/${encodeURIComponent(taskId)}/delegations`);
  },

  async createDelegation(
    taskId: string,
    data: {
      requestedByAgentId: string;
      goal: string;
      title?: string;
      targetAgentId?: string;
      mode?: string;
      inputContextRef?: string;
      inputSummary?: string;
      resultSchema?: string;
      budgetTokens?: number;
      timeoutSec?: number;
      spawnDepth?: number;
      maxRetries?: number;
    },
  ) {
    return request<TaskDelegation>(`/tasks/${encodeURIComponent(taskId)}/delegations`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async dispatchDelegation(delegationId: string) {
    return request<TaskDelegation>(`/delegations/${encodeURIComponent(delegationId)}/dispatch`, {
      method: 'POST',
    });
  },

  async completeDelegation(
    delegationId: string,
    data: {
      outputSummary: string;
      outputPayloadJson?: unknown;
      outputArtifactsJson?: unknown;
    },
  ) {
    return request<TaskDelegation>(`/delegations/${encodeURIComponent(delegationId)}/complete`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async failDelegation(delegationId: string, reason: string) {
    return request<TaskDelegation>(`/delegations/${encodeURIComponent(delegationId)}/fail`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async expireDelegation(delegationId: string, reason?: string) {
    return request<TaskDelegation>(`/delegations/${encodeURIComponent(delegationId)}/expire`, {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    });
  },

  async cancelDelegation(delegationId: string, reason: string) {
    return request<TaskDelegation>(`/delegations/${encodeURIComponent(delegationId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async retryDelegation(delegationId: string) {
    return request<TaskDelegation>(`/delegations/${encodeURIComponent(delegationId)}/retry`, {
      method: 'POST',
    });
  },

  async syncGitlab(taskId: string) {
    return request<{
      skipped?: boolean;
      reason?: string;
      ok?: boolean;
      code?: string;
      message?: string;
      data?: {
        taskId: string;
        projectId: string;
        projectPath: string;
        issueIid: number;
        syncedAt: string;
      };
    }>(`/tasks/${encodeURIComponent(taskId)}/sync/gitlab`, {
      method: 'POST',
    });
  },

  async readyForReview(taskId: string) {
    return request<Task>(`/tasks/${encodeURIComponent(taskId)}/ready-for-review`, {
      method: 'POST',
    });
  },
};
