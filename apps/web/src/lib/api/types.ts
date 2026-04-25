import type {
  ProjectDetail as SharedProjectDetail,
  Task as SharedTask,
  TaskDelegation as SharedTaskDelegation,
  TaskDependencySummary as SharedTaskDependencySummary,
  TaskExecutionContext as SharedTaskExecutionContext,
  TaskParticipant as SharedTaskParticipant,
} from '@occ/shared';

export interface Model {
  id: string;
  name: string;
  provider: string;
  apiKey?: string;
  apiBaseUrl?: string;
  status: 'Healthy' | 'Degraded' | 'Offline';
  isRuntimeDefault?: boolean;
  source?: 'registry' | 'runtime';
  totalTokens: number;
  dailyTokens: number;
  tokenLimit: number;
  currentTask?: string;
  latency?: string;
  throughput?: string;
  tokenSource?: 'usage_logs' | 'model_counter' | 'runtime_inferred' | 'unknown';
  telemetryQuality?: 'measured' | 'estimated' | 'unknown';
  costMode?: 'estimated' | 'unknown';
  createdAt: string;
  updatedAt: string;
}

export interface ModelLog {
  id: string;
  timestamp: string;
  type: 'bash' | 'json' | 'assistant' | 'system';
  content: string;
  label?: string;
}

export interface ModelMetrics {
  totalTokens: number;
  dailyTokens: number;
  weeklyTokens: number[];
  avgLatency: string;
  avgThroughput: string;
  dailyCosts: { date: string; cost: number }[];
  tokenDistribution: { model: string; tokens: number }[];
  dataSources?: {
    tokens: 'usage_logs' | 'model_counter' | 'unknown';
    latency: 'project_execution' | 'unknown';
    throughput: 'usage_logs' | 'unknown';
    cost: 'estimated_by_tokens' | 'unknown';
  };
  quality?: 'measured' | 'estimated' | 'unknown';
  samples?: {
    usageLogs: number;
    projectExecutions: number;
  };
  notes?: string[];
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  integrationEngine?: 'openclaw' | 'hermes' | 'managed' | string;
  builtin?: boolean;
  status: 'Idle' | 'Thinking' | 'Executing' | 'Offline';
  load: number;
  currentModelId?: string;
  fallbackModel?: string;
  tasks: number;
  memoryCount?: number;
  tokensUsed: number;
  tokenLimit: number;
  sessionCount?: number;
  soul?: string;
  sop?: string[];
  createdAt: string;
}

export interface TopologyNode {
  id: string;
  name: string;
  role: string;
  status: string;
  x?: number;
  y?: number;
}

export interface TopologyEdge {
  from: string;
  to: string;
  label?: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  status: 'active' | 'paused' | 'blocked' | 'completed';
  phase: string;
  progress: number;
  owner?: string;
  agents: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Stage {
  type: string;
  status: string;
  progress: number;
}

export interface Deliverable {
  id: string;
  stage: string;
  title: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  submittedAt?: string;
  approvedAt?: string;
}

export type Task = SharedTask;
export type TaskDelegation = SharedTaskDelegation;
export type TaskDependencySummary = SharedTaskDependencySummary;
export type TaskParticipant = SharedTaskParticipant;
export type TaskExecutionContext = SharedTaskExecutionContext;
export type ProjectDetail = SharedProjectDetail;

export interface TaskDelegationBundle {
  task: Task;
  participants: TaskParticipant[];
  delegations: TaskDelegation[];
}

export interface Session {
  id: string;
  agentId: string;
  modelId: string;
  projectId: string;
  startTime: string;
  duration: string;
  tokens: number;
  cost: number;
  status: 'active' | 'completed' | 'failed';
  createdAt?: string;
  updatedAt?: string;
}

export interface Decision {
  id: string;
  type: string;
  title: string;
  description: string;
  projectId?: string;
  stage?: string;
  status: 'pending' | 'approved' | 'rejected' | 'revised';
  createdAt: string;
}

export interface Notification {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  status: 'unread' | 'read';
  createdAt: string;
}

export interface AuditLog {
  id: string;
  userId: string;
  userName?: string;
  action: string;
  target: string;
  targetName?: string;
  details?: string;
  changes?: { before: any; after: any };
  timestamp: string;
}

export interface NotificationInboxItem {
  id: string;
  sourceKey: string;
  sourceType: string;
  severity: 'critical' | 'warning' | 'info';
  category: string;
  title: string;
  detail: string;
  actionLabel: string;
  to: string;
  timestamp?: string;
  read: boolean;
  assignedTo?: string;
  confirmedBy?: string;
  workflowStatus: 'open' | 'acknowledged' | 'resolved';
  updatedAt: string;
}

export interface SystemAuditLog {
  id: string;
  actorType: 'admin' | 'agent' | 'system';
  actorLabel: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  summary: string;
  detail?: string;
  requestId?: string;
  ipAddress?: string;
  createdAt: string;
}

export interface SystemHealth {
  totalProjects: number;
  activeProjects: number;
  pendingApprovals: number;
  activeTasks: number;
  blockedTasks: number;
  rejectedStages: number;
  averageAgentWorkload: number;
  runtime?: Record<string, unknown>;
  services: Array<{
    name: string;
    status: string;
    detail: string;
  }>;
}

export interface SystemRuntime {
  mode?: string;
  requestedMode?: string;
  configured?: boolean;
  provider?: string;
  modelName?: string;
  configSource?: 'database' | 'environment' | 'default';
  version?: string;
  lastValidationStatus?: string;
  lastValidatedAt?: string;
  lastValidationError?: string | null;
  roleSetToggles?: {
    hrRoleEnabledByIndustry?: Record<string, boolean>;
  };
  features?: Record<string, unknown>;
}

export interface SystemRuntimeConfig {
  provider: 'scripted' | 'openai-compatible';
  apiBaseUrl: string;
  modelName: string;
  apiKeyConfigured: boolean;
  apiKeyPreview?: string;
  updatedAt: string;
  lastValidatedAt?: string;
  lastValidationStatus?: string;
  lastValidationError?: string | null;
  roleSetToggles?: {
    hrRoleEnabledByIndustry?: Record<string, boolean>;
  };
}

export interface SystemRuntimeConfigInput {
  provider: 'scripted' | 'openai-compatible';
  apiBaseUrl?: string;
  modelName?: string;
  apiKey?: string;
  clearApiKey?: boolean;
  roleSetToggles?: {
    hrRoleEnabledByIndustry?: Record<string, boolean>;
  };
}

export interface SystemExecutionProtocolSettings {
  memoryEnabled: boolean;
  memoryPolicy: 'current_project_or_high_relevance_only';
  criticalStageMode: 'terminal_agent_first';
  allowDirectModelFallbackForCriticalStages: boolean;
  requireSkillEvidence: boolean;
  requireCollaborationHandoff: boolean;
  blockDegradedWrites: boolean;
}

export interface SystemExecutionProtocolLocks {
  memoryEnabled: boolean;
  memoryPolicy: boolean;
  criticalStageMode: boolean;
  allowDirectModelFallbackForCriticalStages: boolean;
}

export interface SystemExecutionProtocolStageRule {
  stageType: string;
  role: string;
  mode: 'direct_model' | 'terminal_agent';
  openClawAgentId?: string;
  preferredModels: string[];
  requiredSkills: string[];
  requiredCollaborationFields: string[];
  memoryEnabled: boolean;
  memoryPolicy: 'current_project_or_high_relevance_only';
  allowDirectModelFallback: boolean;
  requireSkillEvidence: boolean;
  requireCollaborationHandoff: boolean;
  blockDegradedWrites: boolean;
}

export interface SystemExecutionProtocolSnapshot {
  source: 'database' | 'default';
  updatedAt?: string;
  settings: SystemExecutionProtocolSettings;
  locks: SystemExecutionProtocolLocks;
  stageMatrix: SystemExecutionProtocolStageRule[];
}

export interface SystemExecutionProtocolInput {
  requireSkillEvidence?: boolean;
  requireCollaborationHandoff?: boolean;
  blockDegradedWrites?: boolean;
}

export interface SystemUiPreferences {
  language: "zh" | "en";
  workspacePath: string;
  autoSync: boolean;
  apiProtection: boolean;
  autonomousMode: boolean;
  usageAlert: boolean;
  usageAlertThresholdPercent: number;
  source: "default" | "file";
  updatedAt?: string;
}

export interface SystemUiPreferencesInput {
  language?: "zh" | "en";
  workspacePath?: string;
  autoSync?: boolean;
  apiProtection?: boolean;
  autonomousMode?: boolean;
  usageAlert?: boolean;
  usageAlertThresholdPercent?: number;
}

export interface SystemUiAutonomousModeApplyResult {
  autonomousMode: boolean;
  scope: "all" | "core" | "design";
  executionMode: "autonomous" | "confirm_first";
  requireConfirmation: boolean;
  autoApproveMinorSteps: boolean;
  totalAgents: number;
  createdConfigs: number;
  updatedAgents: number;
  agentIds: string[];
}

export interface RuntimeRouteHealthItem {
  route: string;
  source: string;
  host: string;
  penaltyScore: number;
  authFailures: number;
  transientFailures: number;
  routeCooldownRemainingMs: number;
  sourceDemotionRemainingMs: number;
  updatedAt?: string;
  status: 'healthy' | 'degraded' | 'demoted' | 'cooldown';
}

export interface RuntimeRouteHealthSnapshot {
  generatedAt: string;
  routeCount: number;
  routes: RuntimeRouteHealthItem[];
}

export interface DesignModelPolicyHealthSnapshot {
  ok: boolean;
  timestamp: string;
  summary?: {
    status?: 'healthy' | 'degraded' | 'failed' | string;
    issueCount?: number;
    healthyFallbackCount?: number;
    nextAvailableFallback?: string | null;
  };
  issues?: string[];
}

export interface DebateCompareLogInput {
  baselineIssueId: string;
  compareIssueId: string;
  label?: string;
}

export interface DebateCompareRoleDiff {
  roleId: string;
  roleLabel: string;
  modelChanged: boolean;
  focusChanged: boolean;
  proposalChanged: boolean;
}

export interface DebateCompareLogResult {
  label: string;
  baselineIssueId: string;
  compareIssueId: string;
  roleComparison: DebateCompareRoleDiff[];
  changedRoleCount: number;
  roleCount: number;
  baseline: {
    debateStatus: string | null;
    debateMode: string | null;
  };
  compare: {
    debateStatus: string | null;
    debateMode: string | null;
  };
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
}
