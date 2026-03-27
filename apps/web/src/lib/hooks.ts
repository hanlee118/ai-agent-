import { useState, useEffect, useCallback } from 'react';
import * as api from './api';

// ============ useApi Hook ============
export function useApi<T>(
  fetchFn: () => Promise<T>,
  deps: any[] = []
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchFn();
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Fetch failed');
    } finally {
      setLoading(false);
    }
  }, deps);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, setData, loading, error, refetch };
}

// ============ useModels Hook ============
export function useModels() {
  const [models, setModels] = useState<api.Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchModels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.modelsApi.list();
      setModels(result);
    } catch (err: any) {
      // Fallback to mock data if API fails
      console.warn('Using mock data for models:', err.message);
      setModels(getMockModels());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const createModel = async (data: Parameters<typeof api.modelsApi.create>[0]) => {
    try {
      const newModel = await api.modelsApi.create(data);
      setModels(prev => [...prev, newModel]);
      return newModel;
    } catch (err: any) {
      throw err;
    }
  };

  const updateModel = async (id: string, data: Partial<api.Model>) => {
    try {
      const updated = await api.modelsApi.update(id, data);
      setModels(prev => prev.map(m => m.id === id ? updated : m));
      return updated;
    } catch (err: any) {
      throw err;
    }
  };

  const deleteModel = async (id: string) => {
    try {
      await api.modelsApi.delete(id);
      setModels(prev => prev.filter(m => m.id !== id));
    } catch (err: any) {
      throw err;
    }
  };

  return { models, setModels, loading, error, refetch: fetchModels, createModel, updateModel, deleteModel };
}

// ============ OpenClaw Agents Hook ============
// Fetches from /openclaw/agents (OpenClaw workspace), not /agents (app DB)

export function useAgents() {
  const [agents, setAgents] = useState<api.Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const primary = await api.agentsApi.list();
      setAgents(primary);
    } catch (err: any) {
      // Fallback: OpenClaw workspace endpoint
      try {
        const result = await fetch('/api/openclaw/agents', { credentials: 'include' });
        if (!result.ok) throw new Error(`HTTP ${result.status}`);
        const data = await result.json();

        const mapped: api.Agent[] = (Array.isArray(data) ? data : []).map((a: any) => ({
          id: a.agentId,
          name: a.name || a.agentId,
          role: a.title || a.responsibility || 'Agent',
          status: a.status === 'active' ? 'Idle' : a.status === 'running' ? 'Executing' : a.status === 'thinking' ? 'Thinking' : 'Offline',
          load: 0,
          currentModelId: a.model || 'unknown',
          tasks: a.taskCount || 0,
          memoryCount: 0,
          tokensUsed: 0,
          tokenLimit: 100000,
          sessionCount: a.sessionCount || 0,
          soul: a.intro,
          createdAt: a.lastActiveAt || new Date().toISOString(),
        }));

        setAgents(mapped);
      } catch (openClawErr: any) {
        console.warn('Using mock data for agents:', openClawErr.message || err.message);
        setAgents(getMockAgents());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const createAgent = async (data: Parameters<typeof api.agentsApi.create>[0]) => {
    try {
      const newAgent = await api.agentsApi.create(data);
      setAgents(prev => [...prev, newAgent]);
      return newAgent;
    } catch (err: any) {
      throw err;
    }
  };

  const updateAgentSoul = async (id: string, soul: string) => {
    try {
      await api.agentsApi.updateSoul(id, soul);
      setAgents(prev => prev.map(a => a.id === id ? { ...a, soul } : a));
    } catch (err: any) {
      throw err;
    }
  };

  const updateAgentSop = async (id: string, sop: string[]) => {
    try {
      await api.agentsApi.updateSop(id, sop);
      setAgents(prev => prev.map(a => a.id === id ? { ...a, sop } : a));
    } catch (err: any) {
      throw err;
    }
  };

  const switchAgentModel = async (id: string, modelId: string) => {
    try {
      await api.agentsApi.switchModel(id, modelId);
      setAgents(prev => prev.map(a => a.id === id ? { ...a, currentModelId: modelId } : a));
    } catch (err: any) {
      throw err;
    }
  };

  const deleteAgent = async (id: string) => {
    try {
      await api.agentsApi.delete(id);
      setAgents(prev => prev.filter(a => a.id !== id));
    } catch (err: any) {
      throw err;
    }
  };

  return { agents, setAgents, loading, error, refetch: fetchAgents, createAgent, updateAgentSoul, updateAgentSop, switchAgentModel, deleteAgent };
}

// ============ OpenClaw Projects Hook ============
// Fetches from /openclaw/projects (OpenClaw workspace), not /projects (app DB)

export function useProjects() {
  const [projects, setProjects] = useState<api.Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Call OpenClaw workspace endpoint
      const result = await fetch('/api/openclaw/projects', { credentials: 'include' });
      if (!result.ok) throw new Error(`HTTP ${result.status}`);
      const data = await result.json();
      
      // Map OpenClaw project format to frontend Project type
      const mapped: api.Project[] = (Array.isArray(data) ? data : []).map((p: any) => ({
        id: p.id,
        name: p.name,
        description: p.description || '',
        status: p.status === 'planning' ? 'paused' : p.status === 'blocked' ? 'blocked' : 'active',
        phase: p.currentFocus || '规划中',
        progress: p.progress || 0,
        owner: p.currentFocus?.split(' · ')[0] || '未知',
        agents: [],
        createdAt: p.updatedAt || new Date().toISOString(),
        updatedAt: p.updatedAt || new Date().toISOString(),
      }));
      
      setProjects(mapped);
    } catch (err: any) {
      console.warn('Using mock data for projects:', err.message);
      setProjects(getMockProjects());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const createProject = async (data: Parameters<typeof api.projectsApi.create>[0]) => {
    try {
      const newProject = await api.projectsApi.create(data);
      setProjects(prev => [...prev, newProject]);
      return newProject;
    } catch (err: any) {
      throw err;
    }
  };

  const updateProject = async (id: string, data: Partial<api.Project>) => {
    try {
      const updated = await api.projectsApi.update(id, data);
      setProjects(prev => prev.map(p => p.id === id ? updated : p));
      return updated;
    } catch (err: any) {
      throw err;
    }
  };

  return { projects, setProjects, loading, error, refetch: fetchProjects, createProject, updateProject };
}

// ============ useDecisions Hook ============
export function useDecisions() {
  const [decisions, setDecisions] = useState<api.Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDecisions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.decisionsApi.list();
      setDecisions(result);
    } catch (err: any) {
      console.warn('Using mock data for decisions:', err.message);
      setDecisions(getMockDecisions());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDecisions();
  }, [fetchDecisions]);

  const approveDecision = async (id: string) => {
    try {
      await api.decisionsApi.approve(id);
      setDecisions(prev => prev.map(d => d.id === id ? { ...d, status: 'approved' } : d));
    } catch (err: any) {
      throw err;
    }
  };

  const rejectDecision = async (id: string, reason: string) => {
    try {
      await api.decisionsApi.reject(id, reason);
      setDecisions(prev => prev.map(d => d.id === id ? { ...d, status: 'rejected' } : d));
    } catch (err: any) {
      throw err;
    }
  };

  const reviseDecision = async (id: string, reason: string) => {
    try {
      await api.decisionsApi.revise(id, reason);
      setDecisions(prev => prev.map(d => d.id === id ? { ...d, status: 'revised' } : d));
    } catch (err: any) {
      throw err;
    }
  };

  return { decisions, setDecisions, loading, error, refetch: fetchDecisions, approveDecision, rejectDecision, reviseDecision };
}

// ============ useNotifications Hook ============
export function useNotifications() {
  const [notifications, setNotifications] = useState<api.Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.notificationsApi.list();
      setNotifications(result);
    } catch (err: any) {
      console.warn('Using mock data for notifications:', err.message);
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const markAsRead = async (id: string) => {
    try {
      await api.notificationsApi.update(id, 'read');
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, status: 'read' } : n));
    } catch (err: any) {
      throw err;
    }
  };

  const markAllRead = async () => {
    try {
      await api.notificationsApi.markAllRead();
      setNotifications(prev => prev.map(n => ({ ...n, status: 'read' })));
    } catch (err: any) {
      throw err;
    }
  };

  return { notifications, setNotifications, loading, error, refetch: fetchNotifications, markAsRead, markAllRead };
}

// ============ Mock Data Fallbacks ============
function getMockModels(): api.Model[] {
  return [
    { id: 'm1', name: 'Codex-4.0', provider: 'OpenAI', status: 'Healthy', totalTokens: 1250000, dailyTokens: 45000, tokenLimit: 10000000, createdAt: '2026-03-01T10:00:00Z', updatedAt: '2026-03-27T10:00:00Z' },
    { id: 'm2', name: 'MiniMax-6.5', provider: 'MiniMax', status: 'Healthy', totalTokens: 890000, dailyTokens: 32000, tokenLimit: 5000000, createdAt: '2026-03-01T10:00:00Z', updatedAt: '2026-03-27T10:00:00Z' },
    { id: 'm3', name: 'Kimi-Long', provider: 'Moonshot', status: 'Degraded', totalTokens: 650000, dailyTokens: 28000, tokenLimit: 3000000, createdAt: '2026-03-01T10:00:00Z', updatedAt: '2026-03-27T10:00:00Z' },
  ];
}

function getMockAgents(): api.Agent[] {
  return [
    { id: 'a1', name: '产品经理 Agent', role: 'ProductManager', status: 'Thinking', load: 65, currentModelId: 'm1', tasks: 3, tokensUsed: 520000, tokenLimit: 1000000, createdAt: '2026-03-01T10:00:00Z' },
    { id: 'a2', name: '架构师 Agent', role: 'Architect', status: 'Idle', load: 30, currentModelId: 'm1', tasks: 1, tokensUsed: 380000, tokenLimit: 1000000, createdAt: '2026-03-01T10:00:00Z' },
    { id: 'a3', name: '研发 Agent', role: 'Developer', status: 'Executing', load: 85, currentModelId: 'm2', tasks: 5, tokensUsed: 890000, tokenLimit: 1000000, createdAt: '2026-03-01T10:00:00Z' },
    { id: 'a4', name: '测试 Agent', role: 'QA', status: 'Idle', load: 20, currentModelId: 'm1', tasks: 0, tokensUsed: 210000, tokenLimit: 1000000, createdAt: '2026-03-01T10:00:00Z' },
    { id: 'a5', name: '运维 Agent', role: 'DevOps', status: 'Offline', load: 0, currentModelId: 'm1', tasks: 0, tokensUsed: 150000, tokenLimit: 1000000, createdAt: '2026-03-01T10:00:00Z' },
  ];
}

function getMockProjects(): api.Project[] {
  return [
    { id: 'p1', name: 'SaaS 管理工作台演示', description: 'Agent 团队从需求、设计、架构、研发到测试闭环的真实项目', status: 'active', phase: '开发中', progress: 45, owner: '研发经理', agents: ['a1', 'a2', 'a3', 'a5'], createdAt: '2026-03-01T10:00:00Z', updatedAt: '2026-03-27T10:00:00Z' },
    { id: 'p2', name: 'OpenClaw 核心', description: 'OpenClaw 核心框架升级与优化', status: 'active', phase: '规划中', progress: 15, owner: '架构师', agents: ['a1', 'a4'], createdAt: '2026-03-01T10:00:00Z', updatedAt: '2026-03-27T10:00:00Z' },
    { id: 'p3', name: 'Aegis OS UI', description: 'Aegis Agent OS 界面重构与体验优化', status: 'active', phase: '设计中', progress: 60, owner: 'Jeremy', agents: ['a2', 'a3'], createdAt: '2026-03-01T10:00:00Z', updatedAt: '2026-03-27T10:00:00Z' },
  ];
}

function getMockDecisions(): api.Decision[] {
  return [
    { id: 'd1', type: 'stage_approval', title: '需求分析确认', description: '产品经理 Agent 已完成需求分析，请确认执行计划', projectId: 'p1', stage: 'ANALYSIS', status: 'pending', createdAt: '2026-03-27T10:00:00Z' },
    { id: 'd2', type: 'model_switch', title: '模型切换建议', description: 'GPT-4 Turbo 负载过高，建议切换到 Claude', status: 'pending', createdAt: '2026-03-27T10:00:00Z' },
  ];
}
