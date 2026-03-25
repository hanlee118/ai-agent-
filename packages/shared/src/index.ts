export type StageType = "INIT" | "ANALYSIS" | "DESIGN" | "DEV" | "ACCEPT";
export type ProjectStatus = "active" | "paused" | "blocked" | "completed";
export type StageStatus = "pending" | "active" | "completed" | "blocked" | "rejected";
export type DeliverableStatus = "draft" | "submitted" | "approved" | "rejected";
export type RoleType =
  | "ROLE_ASSISTANT"
  | "ROLE_PM"
  | "ROLE_ANALYST"
  | "ROLE_PRODUCT"
  | "ROLE_ARCH"
  | "ROLE_DEV"
  | "ROLE_QA"
  | "ROLE_HR";
export type TimelinePriority = "low" | "normal" | "high" | "urgent";
export type RuntimeMode = "scripted" | "openai-compatible";
export type TaskStatus = "todo" | "in_progress" | "blocked" | "done";
export type TaskPriority = "low" | "normal" | "high";
export type ServiceStatus = "healthy" | "degraded";
export type RuntimeValidationStatus = "unknown" | "healthy" | "failed";

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
}

export interface LocalAgentMonitorOverview {
  scannedAt: string;
  tools: LocalAgentToolSummary[];
  sessions: LocalAgentSessionItem[];
}

export interface CreateProjectInput {
  name?: string;
  description: string;
  team?: RoleType[];
}

export interface InterventionInput {
  command: string;
}

export interface StageSubmissionInput {
  title?: string;
  content: string;
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
  ROLE_ARCH: "研发总监",
  ROLE_DEV: "研发经理",
  ROLE_QA: "测试工程师",
  ROLE_HR: "HR总监"
};
