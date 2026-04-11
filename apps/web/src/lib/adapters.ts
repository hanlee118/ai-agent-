import type { Agent, AgentStatus, Project, ProjectStatus, Session, Task } from '../types';

const API_BASE = '/api';

export interface OpenClawTaskItem {
  id: string;
  sourceTaskId: string;
  projectId: string;
  projectName: string;
  agentId: string;
  agentName: string;
  title: string;
  status: 'todo' | 'in_progress' | 'blocked' | 'done' | 'unknown';
  statusLabel: string;
  progress: number;
  deadline?: string;
  blockers: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface OpenClawProjectDetail {
  id: string;
  name: string;
  status: 'active' | 'blocked' | 'completed' | 'planned';
  progress: number;
  description: string;
  currentFocus?: string;
  updatedAt?: string;
  agentIds: string[];
  tasks: OpenClawTaskItem[];
}

export interface OpenClawAgentSummary {
  agentId: string;
  name: string;
  title: string;
  responsibility: string;
  model: string;
  status: 'active' | 'idle' | 'offline' | 'attention';
  activeSessionCount: number;
  sessionCount: number;
  taskCount: number;
  blockedTaskCount: number;
  memoryEntryCount: number;
  usage?: {
    totalTokensToday?: number;
    dailyLimit?: number;
  };
  commander?: {
    maxDailyTokens?: number;
  };
  lastActiveAt?: string;
}

export interface OpenClawAgentDetail {
  agentId: string;
  name: string;
  title?: string;
  responsibility?: string;
  soul?: {
    content: string;
    exists?: boolean;
    path?: string;
    updatedAt?: string;
  };
  sop?: {
    content: string;
    exists?: boolean;
    path?: string;
    updatedAt?: string;
  };
  memoryEntries?: OpenClawAgentMemoryEntry[];
  tasks?: OpenClawTaskItem[];
}

export interface OpenClawAgentMemoryEntry {
  id: string;
  summary: string;
  content: string;
  type: string;
  createdAt: string;
  updatedAt: string;
}

export interface OpenClawWorkspaceOverview {
  syncedAt: string;
  rootPath: string;
  totalSessions: number;
  projects?: Array<{
    id: string;
    name: string;
    relativePath?: string;
    taskCount?: number;
    status?: string;
  }>;
  agents?: Array<{
    agentId: string;
    name: string;
    title?: string;
    workspacePath?: string;
  }>;
}

export interface OpenClawRuntimeInfo {
  mode?: string;
  provider?: string;
  model?: string;
  modelName?: string;
  version?: string;
  features?: Record<string, unknown>;
}

type ApiEnvelope<T> = {
  success: boolean;
  data?: T;
  error?: {
    message?: string;
  };
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isApiEnvelope<T>(value: unknown): value is ApiEnvelope<T> {
  return Boolean(value) && typeof value === 'object' && 'success' in (value as Record<string, unknown>);
}

function unwrapPayload<T>(payload: unknown): T {
  if (isApiEnvelope<T>(payload)) {
    if (!payload.success) {
      throw new Error(payload.error?.message || 'OpenClaw request failed');
    }
    return payload.data as T;
  }
  return payload as T;
}

type CoreProjectSummary = {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'blocked' | 'completed';
  currentStage: 'INIT' | 'ANALYSIS' | 'DESIGN' | 'DEV' | 'ACCEPT';
  progress: number;
  updatedAt: string;
  pendingApproval: boolean;
  currentRole: string;
  summary: string;
  openTaskCount: number;
};

type CoreProjectTask = {
  id: string;
  projectId: string;
  stageType: 'INIT' | 'ANALYSIS' | 'DESIGN' | 'DEV' | 'ACCEPT';
  title: string;
  description: string;
  assignee: string;
  status: 'todo' | 'in_progress' | 'blocked' | 'done';
  priority: 'low' | 'normal' | 'high';
  updatedAt: string;
};

type CoreProjectDetail = CoreProjectSummary & {
  description: string;
  team: string[];
  tasks: CoreProjectTask[];
};

type CoreTaskBoardItem = {
  id: string;
  projectId: string;
  stageType: 'INIT' | 'ANALYSIS' | 'DESIGN' | 'DEV' | 'ACCEPT';
  title: string;
  description: string;
  assignee: string;
  status: 'todo' | 'in_progress' | 'blocked' | 'done';
  priority: 'low' | 'normal' | 'high';
  updatedAt: string;
  projectName: string;
  projectStatus: 'active' | 'paused' | 'blocked' | 'completed';
  projectCurrentStage: 'INIT' | 'ANALYSIS' | 'DESIGN' | 'DEV' | 'ACCEPT';
  projectPendingApproval: boolean;
  projectUpdatedAt: string;
};

const ROLE_LABELS: Record<string, string> = {
  ROLE_ASSISTANT: '总助理',
  ROLE_PM: '项目经理',
  ROLE_ANALYST: '需求分析师',
  ROLE_PRODUCT: '产品总监',
  ROLE_DESIGN: '视觉设计总监',
  ROLE_ARCH: '研发总监',
  ROLE_DEV: '研发经理',
  ROLE_QA: '测试工程师',
  ROLE_HR: 'HR总监',
};

const STAGE_LABELS: Record<string, string> = {
  INIT: '立项',
  ANALYSIS: '分析',
  DESIGN: '设计',
  DEV: '开发',
  ACCEPT: '验收',
};

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    credentials: 'include',
  });

  const rawText = await response.text();
  let payload: unknown = null;

  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = { message: rawText };
    }
  }

  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'message' in payload
      ? String((payload as { message?: unknown }).message ?? '')
      : response.statusText;
    throw new Error(message || 'OpenClaw request failed');
  }

  return unwrapPayload<T>(payload);
}

function mapAgentStatus(status: OpenClawAgentSummary['status'], activeSessionCount: number, taskCount: number): AgentStatus {
  if (status === 'offline') return 'Offline';
  if (status === 'attention') return 'Thinking';
  if (status === 'active') return 'Executing';
  if (activeSessionCount > 0 || taskCount > 0) return 'Executing';
  return 'Idle';
}

function inferModelId(modelName: string): string {
  const normalized = modelName.toLowerCase();
  if (normalized.includes('mini')) return 'm2';
  if (normalized.includes('kimi') || normalized.includes('moonshot')) return 'm3';
  return 'm1';
}

function mapProjectStatus(status: OpenClawProjectDetail['status']): ProjectStatus {
  switch (status) {
    case 'active':
      return 'Development';
    case 'planned':
      return 'Planning';
    case 'blocked':
      return 'Blocked';
    case 'completed':
      return 'Completed';
    default:
      return 'Planning';
  }
}

function mapCoreProjectStatus(project: CoreProjectSummary): ProjectStatus {
  if (project.status === 'completed') {
    return 'Completed';
  }
  if (project.status === 'blocked' || project.status === 'paused') {
    return 'Blocked';
  }
  if (project.currentStage === 'DEV') {
    return 'Development';
  }
  if (project.currentStage === 'ACCEPT') {
    return 'Testing';
  }
  return 'Planning';
}

function mapCoreTaskStatus(status: CoreProjectTask['status']): Task['status'] {
  switch (status) {
    case 'done':
      return 'Completed';
    case 'in_progress':
      return 'In Progress';
    case 'blocked':
      return 'Blocked';
    case 'todo':
    default:
      return 'Pending';
  }
}

function mapCoreTaskProgress(status: CoreProjectTask['status']) {
  switch (status) {
    case 'done':
      return 100;
    case 'in_progress':
      return 55;
    case 'blocked':
      return 35;
    case 'todo':
    default:
      return 0;
  }
}

function mapCoreProject(project: CoreProjectDetail): Project {
  return {
    id: project.id,
    name: project.name,
    description: project.description || project.summary || '',
    status: mapCoreProjectStatus(project),
    phase: STAGE_LABELS[project.currentStage] || project.currentStage,
    progress: clamp(project.progress, 0, 100),
    owner: ROLE_LABELS[project.currentRole] || project.currentRole || '未分配',
    agents: Array.isArray(project.team) ? project.team : [],
    createdAt: project.updatedAt,
    updatedAt: project.updatedAt,
  };
}

function mapCoreProjectSummary(project: CoreProjectSummary): Project {
  return {
    id: project.id,
    name: project.name,
    description: project.summary || '',
    status: mapCoreProjectStatus(project),
    phase: STAGE_LABELS[project.currentStage] || project.currentStage,
    progress: clamp(project.progress, 0, 100),
    owner: ROLE_LABELS[project.currentRole] || project.currentRole || '未分配',
    agents: [],
    createdAt: project.updatedAt,
    updatedAt: project.updatedAt,
  };
}

function mapCoreTask(task: CoreProjectTask): Task {
  return {
    id: task.id,
    title: task.title,
    agent: ROLE_LABELS[task.assignee] || task.assignee || '未分配',
    status: mapCoreTaskStatus(task.status),
    progress: mapCoreTaskProgress(task.status),
    projectId: task.projectId,
    createdAt: task.updatedAt,
    updatedAt: task.updatedAt,
  };
}

function mapCoreTaskBoardItem(task: CoreTaskBoardItem): Task {
  return {
    id: task.id,
    title: task.title,
    agent: ROLE_LABELS[task.assignee] || task.assignee || '未分配',
    status: mapCoreTaskStatus(task.status),
    progress: mapCoreTaskProgress(task.status),
    projectId: task.projectId,
    createdAt: task.updatedAt,
    updatedAt: task.updatedAt,
  };
}

function mapCoreSessions(
  projects: Array<Pick<CoreProjectSummary, 'id' | 'updatedAt'>>,
  tasks: Task[],
): Session[] {
  const sessions: Session[] = [];
  const now = Date.now();

  for (const project of projects) {
    const active = tasks
      .filter((task) => task.projectId === project.id && (task.status === 'In Progress' || task.status === 'Blocked'))
      .slice(0, 4);

    for (const task of active) {
      const updatedAt = task.updatedAt || new Date().toISOString();
      const startMs = new Date(updatedAt).getTime();
      const safeStartMs = Number.isNaN(startMs) ? now : startMs;
      const minutes = Math.max(1, Math.floor((now - safeStartMs) / 60000));

      sessions.push({
        id: `core-${project.id}-${task.id}`,
        agentId: task.agent,
        modelId: 'runtime',
        projectId: project.id,
        startTime: new Date(safeStartMs).toISOString(),
        duration: minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`,
        tokens: 0,
        cost: 0,
        status: task.status === 'Blocked' ? 'failed' : 'active',
        createdAt: new Date(safeStartMs).toISOString(),
        updatedAt,
      });
    }
  }

  return sessions.sort((a, b) => new Date(b.updatedAt || b.startTime).getTime() - new Date(a.updatedAt || a.startTime).getTime());
}

function mapTaskStatus(status: OpenClawTaskItem['status']): Task['status'] {
  switch (status) {
    case 'done':
      return 'Completed';
    case 'in_progress':
      return 'In Progress';
    case 'blocked':
      return 'Blocked';
    case 'todo':
    case 'unknown':
    default:
      return 'Pending';
  }
}

function mapProjectPhase(project: OpenClawProjectDetail): string {
  if (project.currentFocus && project.currentFocus.trim()) {
    return project.currentFocus;
  }

  switch (project.status) {
    case 'active':
      return '开发中';
    case 'planned':
      return '规划中';
    case 'blocked':
      return '阻塞中';
    case 'completed':
      return '已完成';
    default:
      return '进行中';
  }
}

function mapProjectOwner(project: OpenClawProjectDetail): string {
  const focusOwner = project.currentFocus?.split('·')?.[0]?.trim();
  return focusOwner || '未分配';
}

function normalizeAgentRoleLabel(agent: OpenClawAgentSummary): string {
  const title = String(agent.title || '').trim();
  if (title) {
    return title;
  }
  const responsibility = String(agent.responsibility || '').trim();
  const explicitRole = responsibility.match(/(?:职位|职务|核心角色|role|title)\s*[:：]\s*([^，,。；;\n]+)/i)?.[1]?.trim();
  if (explicitRole) {
    return explicitRole;
  }
  return 'OpenClaw Agent';
}

function mapAgent(agent: OpenClawAgentSummary): Agent {
  const load = clamp(agent.activeSessionCount * 35 + agent.taskCount * 12 + agent.blockedTaskCount * 8, 0, 100);
  const tokenLimit = agent.commander?.maxDailyTokens ?? agent.usage?.dailyLimit ?? 100000000;
  const runtimeModel = String(agent.model || '').trim();

  return {
    id: agent.agentId,
    name: agent.name,
    role: normalizeAgentRoleLabel(agent),
    integrationEngine: 'openclaw',
    status: mapAgentStatus(agent.status, agent.activeSessionCount, agent.taskCount),
    load,
    // Keep runtime model route string to avoid lossy m1/m2/m3 placeholders.
    currentModelId: runtimeModel,
    model: runtimeModel,
    tasks: agent.taskCount,
    memoryCount: agent.memoryEntryCount,
    tokensUsed: agent.usage?.totalTokensToday ?? 0,
    tokenLimit,
    sessionCount: agent.sessionCount,
    lastActiveAt: agent.lastActiveAt,
  };
}

function mapProject(project: OpenClawProjectDetail): Project {
  return {
    id: project.id,
    name: project.name,
    description: project.description || '',
    status: mapProjectStatus(project.status),
    phase: mapProjectPhase(project),
    progress: clamp(project.progress, 0, 100),
    owner: mapProjectOwner(project),
    agents: Array.isArray(project.agentIds) ? project.agentIds : [],
    updatedAt: project.updatedAt,
  };
}

function mapTask(project: OpenClawProjectDetail, task: OpenClawTaskItem, index: number): Task {
  const progress = Number.isFinite(task.progress)
    ? clamp(task.progress, 0, 100)
    : task.status === 'done'
      ? 100
      : task.status === 'in_progress'
        ? 50
        : 0;

  return {
    id: `${project.id}:${task.id || index}`,
    projectId: project.id,
    title: task.title,
    agent: task.agentName || task.agentId || '未分配',
    status: mapTaskStatus(task.status),
    progress,
    createdAt: task.createdAt ?? project.updatedAt,
    updatedAt: task.updatedAt ?? project.updatedAt,
  };
}

function formatSessionDuration(startAt: string, active: boolean): string {
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) {
    return active ? '进行中' : '已完成';
  }

  const diffMs = Date.now() - start.getTime();
  if (!Number.isFinite(diffMs) || diffMs <= 0) {
    return active ? '进行中' : '已完成';
  }

  const totalMinutes = Math.max(Math.floor(diffMs / 60000), 1);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${totalMinutes}m`;
  }

  return `${hours}h ${minutes}m`;
}

function deriveSessionProject(
  agentId: string,
  rawProjects: OpenClawProjectDetail[],
): OpenClawProjectDetail | undefined {
  return rawProjects.find((project) =>
    (project.agentIds || []).includes(agentId)
    || (project.tasks || []).some((task) => task.agentId === agentId),
  );
}

function mapSessions(rawAgents: OpenClawAgentSummary[], rawProjects: OpenClawProjectDetail[]): Session[] {
  const fallbackProjectId = rawProjects[0]?.id ?? '';
  const fallbackTime = new Date().toISOString();

  return rawAgents
    .filter((agent) => (agent.activeSessionCount ?? 0) > 0 || (agent.sessionCount ?? 0) > 0)
    .map((agent, index) => {
      const project = deriveSessionProject(agent.agentId, rawProjects);
      const startTime = agent.lastActiveAt || project?.updatedAt || fallbackTime;
      const sessionSlots = Math.max(agent.activeSessionCount || agent.sessionCount || 1, 1);
      const tokens = Math.round((agent.usage?.totalTokensToday ?? 0) / sessionSlots);
      const status: Session['status'] = (agent.activeSessionCount ?? 0) > 0 ? 'active' : 'completed';

      return {
        id: `${agent.agentId}-session-${index + 1}`,
        agentId: agent.agentId,
        modelId: inferModelId(agent.model),
        projectId: project?.id ?? fallbackProjectId,
        startTime,
        duration: formatSessionDuration(startTime, status === 'active'),
        tokens,
        cost: Number((tokens * 0.000002).toFixed(4)),
        status,
        createdAt: startTime,
        updatedAt: agent.lastActiveAt || project?.updatedAt || fallbackTime,
      };
    })
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
}

export interface AdaptedOpenClawData {
  agents: Agent[];
  projects: Project[];
  tasks: Task[];
  sessions: Session[];
  workspace: OpenClawWorkspaceOverview | null;
  runtime: OpenClawRuntimeInfo | null;
}

export interface AdaptedCoreProjectData {
  projects: Project[];
  tasks: Task[];
  sessions: Session[];
}

export async function fetchOpenClawData(): Promise<AdaptedOpenClawData> {
  const [rawAgents, rawProjects] = await Promise.all([
    request<OpenClawAgentSummary[]>('/openclaw/agents'),
    request<OpenClawProjectDetail[]>('/openclaw/projects'),
  ]);

  const optional = await Promise.allSettled([
    request<OpenClawWorkspaceOverview>('/openclaw/workspace'),
    request<OpenClawRuntimeInfo>('/system/runtime'),
  ]);

  const workspace = optional[0].status === 'fulfilled' ? optional[0].value : null;
  const runtime = optional[1].status === 'fulfilled' ? optional[1].value : null;

  return {
    agents: rawAgents.map(mapAgent),
    projects: rawProjects.map(mapProject),
    tasks: rawProjects.flatMap((project) => (project.tasks || []).map((task, index) => mapTask(project, task, index))),
    sessions: mapSessions(rawAgents, rawProjects),
    workspace,
    runtime,
  };
}

export async function fetchCoreProjectData(): Promise<AdaptedCoreProjectData> {
  const [summaries, taskBoard] = await Promise.all([
    request<CoreProjectSummary[]>('/projects'),
    request<CoreTaskBoardItem[]>('/tasks').catch(() => [] as CoreTaskBoardItem[]),
  ]);

  if (!Array.isArray(summaries) || summaries.length === 0) {
    return { projects: [], tasks: [], sessions: [] };
  }

  const projects = summaries.map(mapCoreProjectSummary);
  const tasks = Array.isArray(taskBoard) ? taskBoard.map(mapCoreTaskBoardItem) : [];
  const sessions = mapCoreSessions(summaries, tasks);

  return { projects, tasks, sessions };
}

export async function fetchAgentMemory(agentId: string): Promise<OpenClawAgentMemoryEntry[]> {
  const safeId = encodeURIComponent(agentId);

  try {
    return await request<OpenClawAgentMemoryEntry[]>(`/openclaw/agents/${safeId}/memory`);
  } catch {
    const detail = await request<OpenClawAgentDetail>(`/openclaw/agents/${safeId}`);
    return detail.memoryEntries || [];
  }
}

export async function fetchOpenClawAgentDetail(agentId: string): Promise<OpenClawAgentDetail> {
  const safeId = encodeURIComponent(agentId);
  return request<OpenClawAgentDetail>(`/openclaw/agents/${safeId}`);
}

export async function sendAgentMessage(agentId: string, message: string): Promise<unknown> {
  const safeId = encodeURIComponent(agentId);
  return request(`/openclaw/agents/${safeId}/message`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

export async function sendBatchAgentMessage(agentIds: string[], message: string): Promise<unknown> {
  return request('/openclaw/agents/batch-message', {
    method: 'POST',
    body: JSON.stringify({
      agentIds,
      message,
    }),
  });
}
