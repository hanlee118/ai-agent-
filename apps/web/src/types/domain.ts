export type AgentStatus = 'Idle' | 'Thinking' | 'Executing' | 'Offline';
export type ProjectStatus = 'Planning' | 'Development' | 'Testing' | 'Completed' | 'Blocked';
export type TaskStatus = 'Pending' | 'In Progress' | 'Completed' | 'Blocked';
export type SessionStatus = 'active' | 'completed' | 'failed';

export interface ModelLog {
  timestamp: string;
  type: 'bash' | 'json' | 'assistant' | 'system';
  content: string;
  label?: string;
}

export interface Model {
  id: string;
  name: string;
  provider: string;
  status: 'Healthy' | 'Degraded' | 'Offline';
  totalTokens: number;
  dailyTokens: number;
  currentTask: string;
  latency: string;
  throughput: string;
  logs: ModelLog[];
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  load: number;
  currentModelId: string;
  model?: string;
  tasks: number;
  memoryCount: number;
  tokensUsed: number;
  tokenLimit: number;
  sessionCount: number;
  lastActiveAt?: string;
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
  status: SessionStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  phase: string;
  progress: number;
  owner: string;
  agents: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface Task {
  id: string;
  title: string;
  agent: string;
  status: TaskStatus;
  progress: number;
  projectId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  resource: string;
  status: '成功' | '警告' | '进行中';
  details?: string;
}
