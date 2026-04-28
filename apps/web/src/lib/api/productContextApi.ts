import { request } from './core';

export interface ProductContext {
  id: 'default';
  productName: string;
  background: string;
  mission: string;
  executionEngines: string[];
  executionPriority: string[];
  gitlabGovernance: string[];
  hermesUpgradeLoop: string[];
  goals: string[];
  principles: string[];
  constraints: string[];
  forbiddenKeywords: string[];
  requiredKeywords: string[];
  requirementHistory?: Array<{
    id: string;
    issueId: string;
    projectId: string;
    title: string;
    refinedRequirement: string;
    status: 'planned' | 'in_progress' | 'done';
    validationStatus?: 'pending' | 'matched' | 'mismatch';
    validationNote?: string;
    implementationSummary?: string;
    requirementContract?: {
      objective: string;
      inScope: string[];
      outOfScope: string[];
      acceptanceCriteria: string[];
      artifacts: string[];
      designTheme?: string;
      valueNarrative?: string;
    };
    createdAt: string;
    updatedAt?: string;
    completedAt?: string;
  }>;
  updatedAt: string;
  createdAt: string;
}

export const productContextApi = {
  async get(params?: {
    summary?: boolean;
    includeHistory?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    const searchParams = new URLSearchParams();
    if (params?.summary !== undefined) searchParams.set('summary', String(params.summary));
    if (params?.includeHistory !== undefined) searchParams.set('includeHistory', String(params.includeHistory));
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
    const query = searchParams.toString();
    return request<ProductContext>(`/product-context${query ? `?${query}` : ''}`);
  },

  async update(payload: {
    productName: string;
    background: string;
    mission: string;
    executionEngines?: string[];
    executionPriority?: string[];
    gitlabGovernance?: string[];
    hermesUpgradeLoop?: string[];
    goals: string[];
    principles: string[];
    constraints: string[];
    forbiddenKeywords: string[];
    requiredKeywords: string[];
  }) {
    return request<ProductContext>('/product-context', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async deleteHistory(historyId: string) {
    return request<{ removed: boolean; historyId: string }>(`/product-context/history/${encodeURIComponent(historyId)}`, {
      method: 'DELETE',
    });
  },

  async deleteHistoryBatch(historyIds: string[]) {
    return request<{ removedCount: number; removedHistoryIds: string[] }>('/product-context/history', {
      method: 'DELETE',
      body: JSON.stringify({ historyIds }),
    });
  },

  async listHistory(params?: {
    page?: number;
    pageSize?: number;
    summary?: boolean;
  }) {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
    if (params?.summary !== undefined) searchParams.set('summary', String(params.summary));
    const query = searchParams.toString();
    return request<{ total: number; page: number; pageSize: number; items: NonNullable<ProductContext['requirementHistory']> }>(
      `/product-context/history${query ? `?${query}` : ''}`
    );
  },
};
