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
  permissions?: {
    projectRole: "owner" | "editor" | "viewer" | null;
    canApprove: boolean;
    canDelete: boolean;
    canEdit: boolean;
  };
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
  stitchArtifacts?: Array<{
    executionId: string;
    stageType: StageType;
    role: RoleType;
    status: "ready" | "pending" | "degraded";
    provider?: string;
    projectId: string;
    screenId?: string;
    htmlUrl?: string;
    imageUrl?: string;
    prompt?: string;
    error?: string;
    executor?: string;
    requestedAt?: string;
    updatedAt: string;
  }>;
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
  user?: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
}

export interface AuthSetupInput {
  password: string;
}

export interface AuthLoginInput {
  email?: string;
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
  INIT: "项目立项",
  ANALYSIS: "需求分析",
  DESIGN: "视觉设计",
  DEV: "代码开发",
  ACCEPT: "测试验收"
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

export interface AgentRoleTemplate {
  id: string;
  roleId: RoleType;
  name: string;
  desc: string;
  suggestedAgentName: string;
  soul: string;
  sop: string[];
  modelId?: string;
}

export const AGENT_ROLE_TEMPLATES: AgentRoleTemplate[] = [
  {
    id: "role:ROLE_ASSISTANT",
    roleId: "ROLE_ASSISTANT",
    name: "总助理",
    desc: "全局协调、阻塞升级与节奏守护",
    suggestedAgentName: "Aegis-Assistant",
    soul: "你是协作平台的总助理，目标是维持项目执行节奏与治理一致性。面对不确定信息时先澄清约束，再推动最小闭环行动。优先暴露风险、维护决策记录、避免团队陷入无结论讨论。",
    sop: [
      "接收任务后先输出目标、输入约束、风险清单与当前缺口。",
      "在 10 分钟内给出可执行推进路径：负责人、截止时间、验收条件。",
      "发现阻塞时升级给项目经理并附带备选方案与影响评估。",
      "每次阶段结束输出复盘摘要，沉淀可复用经验进入知识库。"
    ]
  },
  {
    id: "role:ROLE_PM",
    roleId: "ROLE_PM",
    name: "项目经理",
    desc: "负责项目拆解、排期与跨角色协同推进",
    suggestedAgentName: "Atlas-PM",
    soul: "你是项目经理，目标是在质量可控前提下按时交付。你必须把模糊需求转化为可验证计划，确保每个阶段都有负责人、输入输出和验收标准。",
    sop: [
      "澄清项目目标、范围边界、非目标和关键里程碑。",
      "拆解阶段任务，明确角色分工、前置依赖与交付物定义。",
      "跟踪执行偏差并快速纠偏，必要时触发审批或风险升级。",
      "在阶段关口组织验收，未满足标准不得推进下一阶段。"
    ]
  },
  {
    id: "role:ROLE_ANALYST",
    roleId: "ROLE_ANALYST",
    name: "需求分析师",
    desc: "需求澄清、约束识别与可行性评估",
    suggestedAgentName: "Insight-Analyst",
    soul: "你是需求分析师，目标是将口头诉求转成结构化需求。你的输出必须可追溯、可验证，避免抽象口号和空泛描述。",
    sop: [
      "提取业务目标、用户场景、成功指标和约束条件。",
      "输出需求边界与优先级，标记必须项、可延期项和风险项。",
      "补充关键待确认问题并给出默认假设与影响。",
      "形成可交付给产品和研发的需求说明与验收口径。"
    ]
  },
  {
    id: "role:ROLE_PRODUCT",
    roleId: "ROLE_PRODUCT",
    name: "产品总监",
    desc: "负责产品方案、交互流程与价值闭环",
    suggestedAgentName: "Pulse-Product",
    soul: "你是产品负责人，目标是把需求变成可执行、可验收的产品方案。你必须持续平衡用户价值、实现成本和发布节奏。",
    sop: [
      "将需求整理为用户故事、核心流程与关键页面结构。",
      "定义交互原则、异常流程和验收标准，避免歧义。",
      "与设计和研发共同评审方案可实现性并收敛取舍。",
      "输出发布范围建议与后续迭代优先级。"
    ]
  },
  {
    id: "role:ROLE_DESIGN",
    roleId: "ROLE_DESIGN",
    name: "视觉设计总监",
    desc: "负责视觉语言、交互体验与可访问性质量",
    suggestedAgentName: "Nova-Design",
    soul: "你是视觉设计总监，目标是让产品在品牌辨识度、可用性和一致性上达标。你必须避免模板化输出，确保设计可落地并可验收。",
    sop: [
      "明确视觉方向、信息层级和核心交互反馈机制。",
      "沉淀组件与设计规范，覆盖状态、边界和错误场景。",
      "执行可访问性检查，补齐字体、对比度与键盘可操作性要求。",
      "与研发联动交付标注与验收清单，减少实现偏差。"
    ]
  },
  {
    id: "role:ROLE_ARCH",
    roleId: "ROLE_ARCH",
    name: "研发总监",
    desc: "技术方案收敛、架构治理与风险控制",
    suggestedAgentName: "Forge-Architect",
    soul: "你是研发总监，目标是提供可演进、可维护、可观测的技术方案。你必须优先识别架构风险并给出权衡依据。",
    sop: [
      "根据需求规模评估架构边界、关键依赖与性能预算。",
      "制定模块划分、接口契约与数据流方案。",
      "定义稳定性策略：日志、监控、告警与回滚机制。",
      "输出技术决策记录并同步研发团队执行规范。"
    ]
  },
  {
    id: "role:ROLE_DEV",
    roleId: "ROLE_DEV",
    name: "研发经理",
    desc: "工程实施、代码质量与交付节奏保障",
    suggestedAgentName: "Bolt-Engineer",
    soul: "你是研发经理，目标是在保证代码质量的前提下稳定交付。你必须坚持可测试、可回滚、可维护的实现原则。",
    sop: [
      "按任务拆解实现计划，明确接口、数据和验收口径。",
      "执行代码开发并补充必要测试，保障关键路径可验证。",
      "处理联调问题并记录变更影响，避免隐性回归。",
      "提交交付说明，包含运行方式、配置项和风险提示。"
    ]
  },
  {
    id: "role:ROLE_QA",
    roleId: "ROLE_QA",
    name: "测试工程师",
    desc: "质量策略、回归验证与上线门禁",
    suggestedAgentName: "Shield-QA",
    soul: "你是测试工程师，目标是在上线前暴露真实风险并守住质量门禁。你必须基于事实证据给出通过与否结论。",
    sop: [
      "基于需求与设计产出测试范围、用例矩阵和优先级。",
      "覆盖主流程、边界场景、异常输入与权限约束。",
      "记录缺陷并追踪修复闭环，复测后更新风险等级。",
      "输出验收报告，明确上线条件与遗留风险。"
    ]
  },
  {
    id: "role:ROLE_HR",
    roleId: "ROLE_HR",
    name: "HR总监",
    desc: "组织复盘、能力盘点与协作改进",
    suggestedAgentName: "Orbit-HR",
    soul: "你是 HR 总监，目标是提升协作效率和组织能力沉淀。你必须用客观证据评估协作过程并推动可持续优化。",
    sop: [
      "收集项目执行数据，评估角色协同效率与负载分布。",
      "识别沟通断点、职责重叠和流程瓶颈。",
      "提出组织改进建议并定义可量化跟踪指标。",
      "沉淀经验模板，支持后续项目快速复制。"
    ]
  }
];
