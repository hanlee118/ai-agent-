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
  updatedAt?: string;
}

export interface OpenClawProjectDetail {
  id: string;
  name: string;
  status: 'active' | 'blocked' | 'completed' | 'planned';
  progress: number;
  description: string;
  currentFocus?: string;
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
}

export interface OpenClawAgentDetail {
  memoryEntries?: OpenClawAgentMemoryEntry[];
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

function mapAgent(agent: OpenClawAgentSummary): Agent {
  const load = clamp(agent.activeSessionCount * 35 + agent.taskCount * 12 + agent.blockedTaskCount * 8, 0, 100);
  const tokenLimit = agent.commander?.maxDailyTokens ?? agent.usage?.dailyLimit ?? 100000;

  return {
    id: agent.agentId,
    name: agent.name,
    role: agent.title || agent.responsibility || 'OpenClaw Agent',
    status: mapAgentStatus(agent.status, agent.activeSessionCount, agent.taskCount),
    load,
    currentModelId: inferModelId(agent.model),
    model: agent.model,
    tasks: agent.taskCount,
    memoryCount: agent.memoryEntryCount,
    tokensUsed: agent.usage?.totalTokensToday ?? 0,
    tokenLimit,
    sessionCount: agent.sessionCount,
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
    title: task.title,
    agent: task.agentName || task.agentId || '未分配',
    status: mapTaskStatus(task.status),
    progress,
  };
}

export interface AdaptedOpenClawData {
  agents: Agent[];
  projects: Project[];
  tasks: Task[];
  sessions: Session[];
  workspace: OpenClawWorkspaceOverview | null;
  runtime: OpenClawRuntimeInfo | null;
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
    sessions: [],
    workspace,
    runtime,
  };
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

export async function sendAgentMessage(agentId: string, message: string): Promise<unknown> {
  const safeId = encodeURIComponent(agentId);
  return request(`/openclaw/agents/${safeId}/message`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}
