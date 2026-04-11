export type AgentTask = {
  stageId: string;
  templateKey: string;
  description: string;
  inputs?: unknown[];
  tools?: string[];
  timeout?: number;
  context?: Record<string, unknown>;
  plan?: unknown;
};

export type AgentResult = {
  success: boolean;
  artifacts: Array<Record<string, unknown>>;
  executionTrace: {
    toolCalls?: Array<Record<string, unknown>>;
    decisions?: Array<Record<string, unknown>>;
    errors?: Array<Record<string, unknown>>;
    resolution?: string;
  };
  errorMessage?: string;
};

export type RoutingContext = {
  stageType: string;
  category?: string;
  preferredAgent?: 'hermes' | 'openclaw' | 'hybrid' | 'auto';
  complexity: number;
};

export type RoutingDecision = {
  agentIds: string[];
  strategy: 'hermes' | 'openclaw' | 'hybrid' | 'hybrid_sequential';
  reason: string;
};

export interface IAgentAdapter {
  execute(task: AgentTask, context: Record<string, unknown>): Promise<AgentResult>;
  syncSkill(skill: { id: string; skillKey: string; name: string; instruction: string }): Promise<void>;
  isHealthy(): Promise<boolean>;
}
