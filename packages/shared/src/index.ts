export type StageType = "INIT" | "ANALYSIS" | "DESIGN" | "DEV" | "ACCEPT";
export type ProjectStatus = "active" | "paused" | "blocked" | "completed";
export type StageStatus = "pending" | "active" | "completed" | "blocked" | "rejected";
export type DeliverableStatus = "draft" | "submitted" | "approved" | "rejected";
export type CoordinationMode = "single_owner" | "team_collab" | "delegated_execution";
export type DelegationPolicy = "forbidden" | "manual_only" | "auto_allowed";
export type SyncPolicy = "db_only" | "db_plus_gitlab" | "full_mirror";
export type ContextScope = "local" | "stage" | "project" | "cross_project";
export type TaskParticipantRole = "owner" | "supporter" | "reviewer" | "observer";
export type TaskDependencyType = "blocks" | "soft_depends" | "relates_to";
export type TaskDelegationMode = "research" | "coding" | "validation" | "summarization" | "review";
export type TaskDelegationStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "expired";
export type TaskBlockedReasonCode =
  | "dependency_blocked"
  | "delegation_failed"
  | "pending_approval"
  | "external_sync_blocked"
  | "manual_intervention_required";
export type TaskNextActionCode =
  | "waiting_for_owner"
  | "waiting_for_reviewer"
  | "waiting_for_dependency"
  | "waiting_for_retry"
  | "waiting_for_approval";
export type TaskGitLabSyncStatus = "not_synced" | "sync_required" | "synced";
export type RoleType =
  | "ROLE_ASSISTANT"
  | "ROLE_PM"
  | "ROLE_ANALYST"
  | "ROLE_PRODUCT"
  | "ROLE_DESIGN"
  | "ROLE_ARCH"
  | "ROLE_DEV"
  | "ROLE_QA"
  | "ROLE_HR";
export type TimelinePriority = "low" | "normal" | "high" | "urgent";
export type RuntimeMode = "scripted" | "openai-compatible";
export type ProjectExecutionMode = "complete" | "standalone" | "relay";
export type ProjectStageExecutionMode = "direct_model" | "terminal_agent";
export type TaskStatus =
  | "draft"
  | "ready"
  | "assigned"
  | "todo"
  | "in_progress"
  | "blocked"
  | "pending_review"
  | "pending_approval"
  | "done"
  | "completed"
  | "rejected"
  | "cancelled";
export type TaskPriority = "low" | "normal" | "high";
export type ServiceStatus = "healthy" | "degraded";
export type RuntimeValidationStatus = "unknown" | "healthy" | "failed";
export type NotificationSeverity = "critical" | "warning" | "info";
export type NotificationWorkflowStatus = "open" | "acknowledged" | "resolved";
export type ExecutionProtocolMemoryPolicy = "current_project_or_high_relevance_only";
export type ExecutionProtocolCriticalStageMode = "terminal_agent_first";
export type PromptTemplateScope = "global" | "project" | "personal";
export type PromptTemplateChannel =
  | "project_room_guidance"
  | "project_room_emergency"
  | "project_room_deliverable"
  | "openclaw_agent"
  | "openclaw_batch";

export interface ParsedIntent {
  keywords: string[];
  constraints: string[];
  risks: string[];
  suggestedTeam: RoleType[];
  summary: string;
}

export interface Deliverable {
  id: string;
  name: string;
  type: "markdown" | "pdf" | "code";
  content: string;
  version: number;
  status: DeliverableStatus;
  stageType: StageType;
  createdBy: RoleType;
  updatedAt: string;
}

export interface Stage {
  type: StageType;
  label: string;
  assignee: RoleType;
  status: StageStatus;
  progress: number;
  startedAt?: string;
  endedAt?: string;
}

export interface Task {
  id: string;
  projectId: string;
  stageType: StageType;
  title: string;
  description: string;
  assignee: RoleType;
  ownerAgentId?: string;
  reviewAgentId?: string;
  coordinationMode?: CoordinationMode;
  delegationPolicy?: DelegationPolicy;
  syncPolicy?: SyncPolicy;
  contextScope?: ContextScope;
  parentTaskId?: string;
  pendingDelegationCount?: number;
  lastDelegatedAt?: string;
  blockedReason?: TaskBlockedReason;
  nextAction?: TaskNextAction;
  dependencies?: TaskDependencySummary[];
  delegationSummary?: TaskDelegationSummary[];
  gitlab?: TaskGitLabSyncInfo;
  status: TaskStatus;
  priority: TaskPriority;
  updatedAt: string;
}

export interface TaskBoardItem extends Task {
  projectName: string;
  projectStatus: ProjectStatus;
  projectCurrentStage: StageType;
  projectPendingApproval: boolean;
  projectUpdatedAt: string;
}

export interface TaskParticipant {
  id: string;
  projectId: string;
  taskId: string;
  agentId: string;
  role: TaskParticipantRole;
  createdAt: string;
}

export interface TaskDependency {
  id: string;
  projectId: string;
  taskId: string;
  dependsOnTaskId: string;
  type: TaskDependencyType;
  createdAt: string;
}

export interface TaskDependencySummary extends TaskDependency {
  taskTitle?: string;
  dependsOnTaskTitle?: string;
  dependsOnTaskStatus?: TaskStatus;
  dependsOnOwnerAgentId?: string;
}

export interface TaskDelegation {
  id: string;
  projectId: string;
  taskId: string;
  parentExecutionId?: string;
  requestedByAgentId: string;
  targetAgentId?: string;
  mode: TaskDelegationMode;
  status: TaskDelegationStatus;
  title: string;
  goal: string;
  inputContextRef?: string;
  inputSummary?: string;
  resultSchema?: string;
  outputSummary?: string;
  outputPayloadJson?: unknown;
  outputArtifactsJson?: unknown;
  budgetTokens?: number;
  timeoutSec?: number;
  spawnDepth: number;
  retryCount: number;
  maxRetries: number;
  startedAt?: string;
  completedAt?: string;
  expiredAt?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDelegationSummary {
  id: string;
  mode: TaskDelegationMode;
  status: TaskDelegationStatus;
  targetAgentId?: string;
  outputSummary?: string;
  failureReason?: string;
  retryCount: number;
  maxRetries: number;
  startedAt?: string;
  completedAt?: string;
  expiredAt?: string;
}

export interface TaskBlockedReason {
  code: TaskBlockedReasonCode;
  label: string;
  detail: string;
  dependsOnTaskId?: string;
  dependsOnTaskTitle?: string;
  delegationId?: string;
}

export interface TaskNextAction {
  code: TaskNextActionCode;
  label: string;
  detail: string;
  actorAgentId?: string;
  dependsOnTaskId?: string;
}

export interface TaskGitLabSyncInfo {
  status: TaskGitLabSyncStatus;
  syncPolicy?: SyncPolicy;
  projectPath?: string;
  issueIid?: number;
  webUrl?: string;
  lastSyncedAt?: string;
  lastSyncHash?: string;
  summary?: string;
  bindingType?: "task" | "project" | "stage" | "escalation";
}

export interface TaskExecutionContext {
  taskSummary: string;
  acceptanceCriteria: string[];
  relevantArtifacts: Array<{
    id: string;
    name: string;
    stageType: StageType;
    status: DeliverableStatus;
    updatedAt: string;
    excerpt: string;
  }>;
  relevantTimeline: TimelineEvent[];
  relatedTasks: Task[];
  constraints: string[];
  resultFormat: string;
}

export interface TimelineEvent {
  id: string;
  timestamp: string;
  agentId?: RoleType;
  type:
    | "project_created"
    | "stage_started"
    | "thinking"
    | "deliverable_submitted"
    | "approval_required"
    | "approval_done"
    | "approval_rejected"
    | "intervention"
    | "message"
    | "resume"
    | "system";
  title: string;
  content: string;
  priority: TimelinePriority;
}

export interface LiveSession {
  activeRole: RoleType;
  title: string;
  startedAt: string;
  body: string;
  provider: RuntimeMode;
}

export interface ProjectSummary {
  id: string;
  name: string;
  projectType?: ProjectExecutionMode;
  parentProjectId?: string;
  relaySourceStageId?: string;
  status: ProjectStatus;
  currentStage: StageType;
  progress: number;
  updatedAt: string;
  pendingApproval: boolean;
  currentRole: RoleType;
  summary: string;
  openTaskCount: number;
}

export interface ProjectDetail extends ProjectSummary {
  description: string;
  parsedIntent: ParsedIntent;
  team: RoleType[];
  projectInputs?: Array<{
    id: string;
    name: string;
    type: string;
    description?: string;
    content?: string;
    filePath?: string;
    referenceDeliverableId?: string;
    validationStatus: string;
    validationErrors?: string[];
    inputSource: string;
    createdAt: string;
  }>;
  stages: Stage[];
  tasks: Task[];
  deliverables: Deliverable[];
  timeline: TimelineEvent[];
  liveSession: LiveSession;
}

export interface AgentProfile {
  roleId: RoleType;
  name: string;
  tagline: string;
  description: string;
  status: "idle" | "working" | "offline";
  workload: number;
  styles: string[];
  skills: {
    professional: number;
    collaboration: number;
    learning: number;
    stability: number;
    innovation: number;
  };
  recentHighlights: string[];
  activeTaskCount?: number;
}

export interface RuntimeStatus {
  mode: RuntimeMode;
  requestedMode: RuntimeMode;
  modelName: string;
  configured: boolean;
  apiBaseUrl: string;
  apiKeyConfigured: boolean;
  configSource: "database" | "environment" | "default";
  lastValidatedAt?: string;
  lastValidationStatus: RuntimeValidationStatus;
  lastValidationError?: string | null;
}

export interface RuntimeSettings {
  provider: RuntimeMode;
  apiBaseUrl: string;
  modelName: string;
  apiKeyConfigured: boolean;
  apiKeyPreview: string;
  updatedAt?: string;
  lastValidatedAt?: string;
  lastValidationStatus: RuntimeValidationStatus;
  lastValidationError?: string | null;
}

export interface RuntimeSettingsInput {
  provider: RuntimeMode;
  apiBaseUrl?: string;
  modelName?: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface RuntimeValidationResult {
  ok: boolean;
  checkedAt: string;
  message: string;
  status: RuntimeValidationStatus;
  runtime: RuntimeStatus;
}

export interface ExecutionProtocolSettings {
  memoryEnabled: boolean;
  memoryPolicy: ExecutionProtocolMemoryPolicy;
  criticalStageMode: ExecutionProtocolCriticalStageMode;
  allowDirectModelFallbackForCriticalStages: boolean;
  requireSkillEvidence: boolean;
  requireCollaborationHandoff: boolean;
  blockDegradedWrites: boolean;
}

export interface ExecutionProtocolLocks {
  memoryEnabled: boolean;
  memoryPolicy: boolean;
  criticalStageMode: boolean;
  allowDirectModelFallbackForCriticalStages: boolean;
}

export interface ExecutionProtocolSettingsInput {
  requireSkillEvidence?: boolean;
  requireCollaborationHandoff?: boolean;
  blockDegradedWrites?: boolean;
}

export interface ExecutionProtocolStageRule {
  stageType: StageType;
  role: RoleType;
  mode: ProjectStageExecutionMode;
  openClawAgentId?: string;
  preferredModels: string[];
  requiredSkills: string[];
  requiredCollaborationFields: string[];
  memoryEnabled: boolean;
  memoryPolicy: ExecutionProtocolMemoryPolicy;
  allowDirectModelFallback: boolean;
  requireSkillEvidence: boolean;
  requireCollaborationHandoff: boolean;
  blockDegradedWrites: boolean;
}

export interface ExecutionProtocolSnapshot {
  source: "database" | "default";
  updatedAt?: string;
  settings: ExecutionProtocolSettings;
  locks: ExecutionProtocolLocks;
  stageMatrix: ExecutionProtocolStageRule[];
}

export interface AuthStatus {
  setupComplete: boolean;
  authenticated: boolean;
}

export interface AuthSetupInput {
  password: string;
}

export interface AuthLoginInput {
  password: string;
}

export interface AuditLogItem {
  id: string;
  actorType: "admin" | "system";
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

export interface NotificationInboxItem {
  id: string;
  sourceKey: string;
  sourceType: string;
  severity: NotificationSeverity;
  category: string;
  title: string;
  detail: string;
  actionLabel: string;
  to: string;
  timestamp?: string;
  read: boolean;
  assignedTo?: string;
  confirmedBy?: string;
  workflowStatus: NotificationWorkflowStatus;
  updatedAt: string;
}

export interface NotificationInboxUpdateInput {
  read?: boolean;
  assignedTo?: string | null;
  confirmedBy?: string | null;
  workflowStatus?: NotificationWorkflowStatus;
}

export interface PromptTemplate {
  id: string;
  title: string;
  content: string;
  scope: PromptTemplateScope;
  channel: PromptTemplateChannel;
  locale: "zh-CN" | "en-US";
  projectId?: string;
  ownerLabel?: string;
  usageCount: number;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromptTemplateUpsertInput {
  title: string;
  content: string;
  scope: PromptTemplateScope;
  channel: PromptTemplateChannel;
  locale: "zh-CN" | "en-US";
  projectId?: string;
  ownerLabel?: string;
}

export type OpenClawTaskState = "todo" | "in_progress" | "blocked" | "done" | "unknown";
export type OpenClawProjectState = "active" | "blocked" | "completed" | "planned";
export type OpenClawAgentPresence = "active" | "idle" | "offline" | "attention";
export type OpenClawEditableDocumentType = "soul" | "sop";
export type OpenClawExecutionMode = "confirm_first" | "autonomous";
export type OpenClawMemoryType = "fact" | "preference" | "workflow" | "project" | "reflection";

export interface OpenClawTaskItem {
  id: string;
  sourceTaskId: string;
  projectId: string;
  projectName: string;
  agentId: string;
  agentName: string;
  title: string;
  status: OpenClawTaskState;
  statusLabel: string;
  progress: number;
  deadline?: string;
  blockers: string[];
  updatedAt?: string;
}

export interface OpenClawProjectDocument {
  id: string;
  label: string;
  kind: string;
  extension: string;
  path: string;
  updatedAt: string;
  excerpt?: string;
}

export interface OpenClawProjectSummary {
  id: string;
  name: string;
  relativePath: string;
  absolutePath: string;
  status: OpenClawProjectState;
  progress: number;
  updatedAt: string;
  description: string;
  taskCount: number;
  blockedTaskCount: number;
  agentCount: number;
  agentIds: string[];
  blockerCount: number;
  currentFocus?: string;
}

export interface OpenClawProjectDetail extends OpenClawProjectSummary {
  tasks: OpenClawTaskItem[];
  blockers: string[];
  docs: OpenClawProjectDocument[];
  readmeExcerpt?: string;
  requirementsExcerpt?: string;
  agentIds: string[];
}

export interface OpenClawSessionSummary {
  key: string;
  sessionId: string;
  label: string;
  kind: string;
  channel?: string;
  chatType?: string;
  subject?: string;
  updatedAt: string;
  systemSent: boolean;
  abortedLastRun: boolean;
}

export interface OpenClawSessionMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool" | "other";
  text: string;
  timestamp: string;
}

export interface OpenClawEditableDocument {
  type: OpenClawEditableDocumentType;
  path: string;
  exists: boolean;
  content: string;
  updatedAt?: string;
}

export interface OpenClawAgentModelOption {
  id: string;
  label: string;
  tags: string[];
  available: boolean;
  source: "current" | "recommended" | "catalog";
}

export interface OpenClawAgentCommanderSettings {
  selectedModel: string;
  defaultModel: string;
  fallbackModel?: string;
  executionMode: OpenClawExecutionMode;
  requireConfirmation: boolean;
  autoApproveMinorSteps: boolean;
  maxPromptTokens?: number;
  maxCompletionTokens?: number;
  maxDailyTokens?: number;
  memoryEnabled: boolean;
  updatedAt?: string;
}

export interface OpenClawAgentUsageSummary {
  promptTokensToday: number;
  completionTokensToday: number;
  totalTokensToday: number;
  requestCountToday: number;
  dailyLimit?: number;
  remainingDailyTokens?: number;
  lastUsedAt?: string;
}

export interface OpenClawAgentUsageLogEntry {
  id: string;
  agentId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  status: string;
  commandType: string;
  createdAt: string;
}

export interface OpenClawAgentMemoryEntry {
  id: string;
  agentId: string;
  projectId?: string;
  type: OpenClawMemoryType;
  summary: string;
  content: string;
  importance: number;
  tags: string[];
  source?: string;
  lastAccessedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface OpenClawAgentSummary {
  agentId: string;
  name: string;
  emoji: string;
  title: string;
  responsibility: string;
  intro: string;
  model: string;
  workspacePath: string;
  agentDir?: string;
  status: OpenClawAgentPresence;
  lastActiveAt?: string;
  heartbeatEnabled: boolean;
  activeSessionCount: number;
  sessionCount: number;
  taskCount: number;
  blockedTaskCount: number;
  allowedAgentIds: string[];
  tools: string[];
  soulPath: string;
  sopPath: string;
  availableModels: OpenClawAgentModelOption[];
  commander: OpenClawAgentCommanderSettings;
  usage: OpenClawAgentUsageSummary;
  memoryEntryCount: number;
  currentTask?: OpenClawTaskItem;
}

export interface OpenClawAgentDetail extends OpenClawAgentSummary {
  openId?: string;
  vibe?: string;
  identitySource?: string;
  soul: OpenClawEditableDocument;
  sop: OpenClawEditableDocument;
  sessions: OpenClawSessionSummary[];
  recentMessages: OpenClawSessionMessage[];
  tasks: OpenClawTaskItem[];
  memoryEntries: OpenClawAgentMemoryEntry[];
  usageLogs: OpenClawAgentUsageLogEntry[];
}

export interface OpenClawWorkspaceOverview {
  syncedAt: string;
  rootPath: string;
  projects: OpenClawProjectSummary[];
  agents: OpenClawAgentSummary[];
  totalSessions: number;
}

export interface OpenClawDocumentUpdateInput {
  content: string;
  createIfMissing?: boolean;
}

export interface OpenClawAgentSettingsInput {
  displayName?: string;
  title?: string;
  intro?: string;
  responsibility?: string;
  allowedAgentIds?: string[];
  tools?: string[];
  selectedModel?: string;
  defaultModel?: string;
  fallbackModel?: string;
  executionMode?: OpenClawExecutionMode;
  requireConfirmation?: boolean;
  autoApproveMinorSteps?: boolean;
  maxPromptTokens?: number | null;
  maxCompletionTokens?: number | null;
  maxDailyTokens?: number | null;
  memoryEnabled?: boolean;
}

export interface OpenClawCreateAgentInput {
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
}

export interface OpenClawMemoryEntryInput {
  projectId?: string;
  type: OpenClawMemoryType;
  summary: string;
  content: string;
  importance?: number;
  tags?: string[];
  source?: string;
}

export interface OpenClawTaskUpdateInput {
  agentId?: string;
  agentName?: string;
  title?: string;
  status?: OpenClawTaskState;
  progress?: number;
  blockers?: string[];
  deadline?: string;
}

export interface OpenClawBatchTaskUpdateItem {
  taskId: string;
  patch: OpenClawTaskUpdateInput;
}

export interface OpenClawBatchTaskUpdateInput {
  updates: OpenClawBatchTaskUpdateItem[];
}

export interface OpenClawAgentMessageInput {
  message: string;
  preferredModel?: string;
  fallbackModels?: string[];
}

export interface OpenClawInstructionPreviewInput {
  message: string;
  projectId?: string;
  preferAutonomous?: boolean;
}

export interface OpenClawInstructionPreviewOption {
  id: string;
  label: string;
  tone: "primary" | "secondary" | "warning";
  recommended?: boolean;
}

export interface OpenClawInstructionPreview {
  agentId: string;
  message: string;
  goal: string;
  plan: string[];
  steps: string[];
  risks: string[];
  suggestion: string;
  needsConfirmation: boolean;
  recommendedAction: string;
  options: OpenClawInstructionPreviewOption[];
}

export interface OpenClawBatchAgentMessageInput {
  agentIds: string[];
  message: string;
}

export interface OpenClawAgentCommandResult {
  ok: boolean;
  agentId: string;
  summary: string;
  sessionId?: string;
  model?: string;
  provider?: string;
  durationMs?: number;
  reply: string;
  attempts?: OpenClawAgentAttemptTrace[];
}

export type OpenClawAgentAttemptStatus = "success" | "failed" | "skipped";

export interface OpenClawAgentAttemptTrace {
  attempt: number;
  route: string;
  status: OpenClawAgentAttemptStatus;
  startedAt: string;
  elapsedMs: number;
  requestedModel?: string;
  selectedModel?: string;
  executedModel?: string;
  provider?: string;
  isolatedSession?: boolean;
  sessionId?: string;
  localExecution?: boolean;
  failureKind?: string;
  recoveryAction?: string;
  recoveryTargetModel?: string;
  error?: string;
}

export interface OpenClawBatchAgentCommandResult {
  ok: boolean;
  requestedAgentIds: string[];
  completedCount: number;
  failedCount: number;
  results: OpenClawAgentCommandResult[];
}

export type OpenClawFindingSeverity = "critical" | "warn" | "info";

export interface OpenClawStatusFinding {
  id: string;
  severity: OpenClawFindingSeverity;
  title: string;
  detail: string;
  remediation?: string;
}

export interface OpenClawStatusSummary {
  syncedAt: string;
  runtimeVersion: string;
  defaultAgentId?: string;
  sessionCount: number;
  queuedSystemEventCount: number;
  secretDiagnosticCount: number;
  configuredChannels: string[];
  heartbeatAgents: string[];
  findings: OpenClawStatusFinding[];
}

export type OpenClawSlaState = "healthy" | "warning" | "stale";

export interface OpenClawAgentSlaItem {
  agentId: string;
  name: string;
  status: OpenClawAgentPresence;
  lastActiveAt?: string;
  minutesSinceActive?: number;
  activeSessionCount: number;
  taskCount: number;
  currentTaskTitle?: string;
  slaState: OpenClawSlaState;
}

export interface OpenClawProjectReport {
  projectId: string;
  projectName: string;
  generatedAt: string;
  summary: string;
  highlights: string[];
  blockers: string[];
  nextActions: string[];
  agentSummaries: Array<{
    agentId: string;
    name: string;
    status: OpenClawAgentPresence;
    lastActiveAt?: string;
    currentTaskTitle?: string;
  }>;
  markdown: string;
}

export interface SystemHealth {
  totalProjects: number;
  activeProjects: number;
  pendingApprovals: number;
  activeTasks: number;
  blockedTasks: number;
  rejectedStages: number;
  averageAgentWorkload: number;
  runtime: RuntimeStatus;
  services: Array<{
    name: "api" | "database" | "runtime";
    status: ServiceStatus;
    detail: string;
  }>;
}

export interface SystemReadiness {
  checkedAt: string;
  database: {
    url: string;
    path?: string;
    exists: boolean;
    managedAgentCount: number;
    memoryEntryCount: number;
    usageLogCount: number;
  };
  openclaw: {
    configPath: string;
    configExists: boolean;
    workspaceRoot: string;
    workspaceExists: boolean;
    configuredAgentCount: number;
    liveWorkspaceAgentCount: number;
    liveWorkspaceProjectCount: number;
  };
  runtime: RuntimeStatus;
  warnings: string[];
}

export type LocalAgentTool = "claude" | "codex" | "openclaw";
export type LocalAgentSessionState = "active" | "idle" | "stale";
export type LocalAgentPricingMode = "known" | "estimated" | "unavailable";

export interface LocalAgentUsageSummary {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  knownCostUsd: number;
  estimatedCostUsd: number;
  pricingMode: LocalAgentPricingMode;
}

export interface LocalAgentSessionItem {
  id: string;
  tool: LocalAgentTool;
  title: string;
  status: LocalAgentSessionState;
  path: string;
  updatedAt: string;
  lastMessage?: string;
  agentId?: string;
  projectLabel?: string;
  activeSignal?: string;
  model?: string;
  usage: LocalAgentUsageSummary;
}

export interface LocalAgentToolSummary {
  tool: LocalAgentTool;
  label: string;
  rootPath: string;
  available: boolean;
  sessionCount: number;
  activeCount: number;
  idleCount: number;
  staleCount: number;
  lastUpdatedAt?: string;
  usage: LocalAgentUsageSummary;
}

export interface LocalAgentMonitorOverview {
  scannedAt: string;
  tools: LocalAgentToolSummary[];
  sessions: LocalAgentSessionItem[];
  totals: LocalAgentUsageSummary;
}

export interface CreateProjectInput {
  name?: string;
  description: string;
  team?: RoleType[];
  projectType?: ProjectExecutionMode;
  parentProjectId?: string;
  relaySourceStageId?: string;
  projectInputs?: Array<{
    name: string;
    type: string;
    description?: string;
    content?: string;
    filePath?: string;
    referenceDeliverableId?: string;
    inputSource?: "manual" | "imported_from_project" | "template_generated";
  }>;
  workflowTemplateKey?: string;
  autoStartWorkflow?: boolean;
}

export interface InterventionInput {
  command: string;
}

export interface StageSubmissionInput {
  title?: string;
  content: string;
  designReview?: DesignReviewCardInput;
}

export interface DesignReviewCardInput {
  visualDirection: string;
  brandTone: string;
  uxPrinciples: string[];
  accessibilityChecklist: string[];
  approvedBy: string;
  approved: boolean;
  notes?: string;
}

export interface ProjectMessageInput {
  message: string;
}

export interface StageRejectInput {
  reason: string;
}

export interface TaskUpdateInput {
  status: TaskStatus;
}

export const STAGE_LABELS: Record<StageType, string> = {
  INIT: "立项",
  ANALYSIS: "分析",
  DESIGN: "设计",
  DEV: "开发",
  ACCEPT: "验收"
};

export const ROLE_LABELS: Record<RoleType, string> = {
  ROLE_ASSISTANT: "总助理",
  ROLE_PM: "项目经理",
  ROLE_ANALYST: "需求分析师",
  ROLE_PRODUCT: "产品总监",
  ROLE_DESIGN: "视觉设计总监",
  ROLE_ARCH: "研发总监",
  ROLE_DEV: "研发经理",
  ROLE_QA: "测试工程师",
  ROLE_HR: "HR总监"
};
