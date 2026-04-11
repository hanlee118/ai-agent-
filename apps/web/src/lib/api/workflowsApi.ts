import { request } from './core';

export type WorkflowStageOverview = {
  id: string;
  nodeId: string;
  templateKey: string;
  status: 'pending' | 'running' | 'reviewing' | 'completed' | 'failed' | 'skipped' | string;
  assignedAgents: string[];
  outputArtifactCount: number;
  contextMemoryCount: number;
  gate: {
    passed: boolean;
    violationCount: number;
    violations: string[];
  };
  isCurrent: boolean;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type WorkflowProjectOverview = {
  workflowId: string;
  projectId: string;
  name: string;
  status: 'draft' | 'active' | 'completed' | 'archived' | string;
  template: {
    id: string;
    key: string;
    name: string;
  };
  currentStageIds: string[];
  nodes: Array<{
    id: string;
    templateKey: string;
    config: Record<string, unknown>;
  }>;
  edges: Array<{
    from: string;
    to: string;
    condition: string | null;
  }>;
  stages: WorkflowStageOverview[];
  updatedAt: string;
};

export const workflowsApi = {
  async getProjectOverview(projectId: string) {
    const id = encodeURIComponent(String(projectId || '').trim());
    return request<WorkflowProjectOverview>(`/v1/workflows/projects/${id}/overview`);
  },
};

