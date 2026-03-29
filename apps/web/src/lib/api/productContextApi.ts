import { request } from './core';

export interface ProductContext {
  id: 'default';
  productName: string;
  background: string;
  mission: string;
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
  async get() {
    return request<ProductContext>('/product-context');
  },

  async update(payload: {
    productName: string;
    background: string;
    mission: string;
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
};
