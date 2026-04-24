import { request } from './core';

export type WorkflowStageOverview = {
  id: string;
  nodeId: string;
  templateKey: string;
  status: 'pending' | 'running' | 'reviewing' | 'completed' | 'failed' | 'skipped' | string;
  assignedAgents: string[];
  assignedAgentProfiles: Array<{
    agentId: string;
    engine: 'hermes' | 'openclaw' | 'unknown' | string;
    model: string | null;
  }>;
  executionEngine: 'hybrid' | 'hermes' | 'openclaw' | 'manual' | 'unknown' | string;
  artifactSources: {
    hermes: number;
    hermesFallback: number;
    openclaw: number;
    companion: number;
    companionError: number;
    stitch: number;
    manual: number;
    other: number;
  };
  collaboration: {
    roleCount: number;
    roles: string[];
    analystInvolved: boolean;
    companionEvidenceCount: number;
  };
  collaborationArtifacts: Array<{
    id: string;
    name: string;
    source: string;
    role: string;
    primaryRole: string;
    agentId: string;
    provider: string | null;
    model: string | null;
    knowledgeId: string | null;
    status: 'success' | 'failed' | string;
    generatedAt: string | null;
    preview: string;
  }>;
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

export type WorkflowHermesRuntimeStatus = {
  checkedAt: string;
  runtime: {
    enabled: boolean;
    endpoint: string;
    stageMatchMode: string;
    timeoutMs: number;
    lastStageKey: string | null;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    lastFailureReason: string | null;
    lastSkipReason: string | null;
    totalAttempts: number;
    totalSuccess: number;
    totalFailures: number;
  };
  probe: {
    reachable: boolean;
    statusCode: number | null;
    latencyMs: number;
    message: string;
  } | null;
};

export const workflowsApi = {
  async getProjectOverview(projectId: string) {
    const id = encodeURIComponent(String(projectId || '').trim());
    return request<WorkflowProjectOverview>(`/v1/workflows/projects/${id}/overview`);
  },

  async getHermesRuntimeStatus(probe = true) {
    return request<WorkflowHermesRuntimeStatus>(`/v1/workflows/hermes/status?probe=${probe ? 'true' : 'false'}`);
  },
};
