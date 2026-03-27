// API Service Layer
// Base URL: /api (Vite proxy forwards to localhost:8787)

const API_BASE = '/api';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  
  const config: RequestInit = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    credentials: 'include', // Send cookies
  };

  try {
    const response = await fetch(url, config);
    const data: ApiResponse<T> = await response.json();
    
    if (!data.success) {
      throw new Error(data.error?.message || 'Request failed');
    }
    
    return data.data as T;
  } catch (error) {
    console.error(`API Error [${endpoint}]:`, error);
    throw error;
  }
}

// ============ Auth API ============
export const authApi = {
  async getStatus() {
    return request<{
      setupComplete: boolean;
      authenticated: boolean;
      user?: { id: string; name: string; email: string };
    }>('/auth/status');
  },

  async login(email: string, password: string) {
    return request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  async logout() {
    return request('/auth/logout', { method: 'POST' });
  },
};

// ============ Models API ============
export const modelsApi = {
  async list() {
    return request<Model[]>('/models');
  },

  async get(id: string) {
    return request<Model>(`/models/${id}`);
  },

  async create(data: {
    name: string;
    provider: string;
    apiKey?: string;
    apiBaseUrl?: string;
    tokenLimit?: number;
  }) {
    return request<Model>('/models', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async update(id: string, data: Partial<Model>) {
    return request<Model>(`/models/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async delete(id: string) {
    return request(`/models/${id}`, { method: 'DELETE' });
  },

  async getLogs(id: string, type?: string, limit = 50) {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    params.set('limit', limit.toString());
    return request<ModelLog[]>(`/models/${id}/logs?${params}`);
  },

  async getMetrics(id: string) {
    return request<ModelMetrics>(`/models/${id}/metrics`);
  },

  async healthCheck(id: string) {
    return request<{ reachable: boolean; latency: string; error: string | null }>(
      `/models/${id}/health-check`,
      { method: 'POST' }
    );
  },
};

// ============ Agents API ============
export const agentsApi = {
  async list() {
    return request<Agent[]>('/agents');
  },

  async get(id: string) {
    return request<Agent>(`/agents/${id}`);
  },

  async create(data: {
    name: string;
    role: string;
    modelId?: string;
    soul?: string;
    sop?: string[];
  }) {
    return request<Agent>('/agents', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateSoul(id: string, content: string) {
    return request(`/agents/${id}/soul`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    });
  },

  async updateSop(id: string, steps: string[]) {
    return request(`/agents/${id}/sop`, {
      method: 'PATCH',
      body: JSON.stringify({ steps }),
    });
  },

  async switchModel(id: string, modelId: string) {
    return request(`/agents/${id}/model`, {
      method: 'PATCH',
      body: JSON.stringify({ modelId }),
    });
  },

  async delete(id: string) {
    return request(`/agents/${id}`, { method: 'DELETE' });
  },
};

// ============ Team Topology API ============
export const teamApi = {
  async getTopology() {
    return request<{
      nodes: TopologyNode[];
      edges: TopologyEdge[];
    }>('/team/topology');
  },
};

// ============ Projects API ============
export const projectsApi = {
  async list(params?: { status?: string; page?: number; limit?: number }) {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    const query = searchParams.toString();
    return request<{ data: Project[]; pagination: Pagination }>(
      `/projects${query ? `?${query}` : ''}`
    );
  },

  async get(id: string) {
    return request<Project>(`/projects/${id}`);
  },

  async create(data: {
    name: string;
    description?: string;
    requirements?: string;
  }) {
    return request<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async update(id: string, data: Partial<Project>) {
    return request<Project>(`/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async getStages(id: string) {
    return request<Stage[]>(`/projects/${id}/stages`);
  },

  async getDeliverables(id: string) {
    return request<Deliverable[]>(`/projects/${id}/deliverables`);
  },

  async submitDeliverable(
    projectId: string,
    data: {
      stage: string;
      title: string;
      content: string;
      attachments?: string[];
    }
  ) {
    return request<Deliverable>(`/projects/${projectId}/deliverables`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ============ Tasks API ============
export const tasksApi = {
  async list(params?: { projectId?: string; status?: string; assignee?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.projectId) searchParams.set('projectId', params.projectId);
    if (params?.status) searchParams.set('status', params.status);
    if (params?.assignee) searchParams.set('assignee', params.assignee);
    const query = searchParams.toString();
    return request<Task[]>(`/tasks${query ? `?${query}` : ''}`);
  },

  async create(data: {
    title: string;
    description?: string;
    projectId: string;
    assignee?: string;
    priority?: string;
    due?: string;
  }) {
    return request<Task>('/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async update(id: string, data: Partial<Task>) {
    return request<Task>(`/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },
};

// ============ Decisions API ============
export const decisionsApi = {
  async list(status?: string) {
    const params = status ? `?status=${status}` : '';
    return request<Decision[]>(`/decisions${params}`);
  },

  async approve(id: string) {
    return request(`/decisions/${id}/approve`, { method: 'POST' });
  },

  async reject(id: string, reason: string) {
    return request(`/decisions/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async revise(id: string, reason: string) {
    return request(`/decisions/${id}/revise`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },
};

// ============ Notifications API ============
export const notificationsApi = {
  async list(params?: { severity?: string; status?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.severity) searchParams.set('severity', params.severity);
    if (params?.status) searchParams.set('status', params.status);
    const query = searchParams.toString();
    return request<Notification[]>(`/notifications${query ? `?${query}` : ''}`);
  },

  async update(id: string, status: string) {
    return request(`/notifications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },

  async markAllRead() {
    return request('/notifications/read-all', { method: 'POST' });
  },
};

// ============ Audit Logs API ============
export const auditApi = {
  async list(params?: {
    startTime?: string;
    endTime?: string;
    action?: string;
    userId?: string;
  }) {
    const searchParams = new URLSearchParams();
    if (params?.startTime) searchParams.set('startTime', params.startTime);
    if (params?.endTime) searchParams.set('endTime', params.endTime);
    if (params?.action) searchParams.set('action', params.action);
    if (params?.userId) searchParams.set('userId', params.userId);
    const query = searchParams.toString();
    return request<AuditLog[]>(`/audit-logs${query ? `?${query}` : ''}`);
  },
};

// ============ System API ============
export const systemApi = {
  async getHealth() {
    return request<SystemHealth>('/system/health');
  },

  async getRuntime() {
    return request<SystemRuntime>('/system/runtime');
  },
};

// Type Definitions
export interface Model {
  id: string;
  name: string;
  provider: string;
  apiKey?: string;
  apiBaseUrl?: string;
  status: 'Healthy' | 'Degraded' | 'Offline';
  totalTokens: number;
  dailyTokens: number;
  tokenLimit: number;
  currentTask?: string;
  latency?: string;
  throughput?: string;
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
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  status: 'Idle' | 'Thinking' | 'Executing' | 'Offline';
  load: number;
  currentModelId?: string;
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

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'done';
  priority?: 'high' | 'medium' | 'low';
  assignee?: string;
  projectId: string;
  progress?: number;
  due?: string;
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

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  memory: { used: number; total: number };
  cpu: { load: number };
  database: 'connected' | 'disconnected';
  openclaw: 'connected' | 'disconnected';
}

export interface SystemRuntime {
  mode: string;
  version: string;
  features: {
    sse: boolean;
    websocket: boolean;
    auth: boolean;
  };
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
}
