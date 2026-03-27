export type AgentStatus = 'Idle' | 'Thinking' | 'Executing' | 'Offline';
export type ProjectStatus = 'Planning' | 'Development' | 'Testing' | 'Completed' | 'Blocked';

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
  currentModelId: string; // 当前使用的模型 ID
  model?: string; // 模型名称（用于 UI 显示）
  tasks: number;
  memoryCount: number;
  tokensUsed: number;
  tokenLimit: number; // 用户定义的 Token 限制
  sessionCount: number;
  lastActiveAt?: string;
}

export interface Session {
  id: string;
  agentId: string;
  modelId: string; // 记录该会话使用的模型
  projectId: string;
  startTime: string;
  duration: string;
  tokens: number;
  cost: number;
  status: 'active' | 'completed' | 'failed';
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
  status: 'Pending' | 'In Progress' | 'Completed' | 'Blocked';
  progress: number;
  projectId?: string;
  createdAt?: string;
  updatedAt?: string;
}
