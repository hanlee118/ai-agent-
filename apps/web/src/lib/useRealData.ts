import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Agent, Project, Session, Task } from '../types';
import {
  fetchAgentMemory,
  fetchCoreProjectData,
  fetchOpenClawData,
  sendAgentMessage,
  type OpenClawAgentMemoryEntry,
  type OpenClawRuntimeInfo,
  type OpenClawWorkspaceOverview,
} from './adapters';
import { agentsApi } from './api';
import { useSSE } from '../hooks/useSSE';

export interface RealDataState {
  agents: Agent[];
  projects: Project[];
  tasks: Task[];
  sessions: Session[];
  workspace: OpenClawWorkspaceOverview | null;
  runtime: OpenClawRuntimeInfo | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  getAgentMemory: (agentId: string) => Promise<OpenClawAgentMemoryEntry[]>;
  sendAgentMessage: (agentId: string, message: string) => Promise<unknown>;
}

export function useRealData(): RealDataState {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [workspace, setWorkspace] = useState<OpenClawWorkspaceOverview | null>(null);
  const [runtime, setRuntime] = useState<OpenClawRuntimeInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoadedOnceRef = useRef(false);

  const fetchManagedAgents = useCallback(async (): Promise<Agent[]> => {
    try {
      const agents = await agentsApi.list();
      return agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        status: (agent.status as Agent['status']) || 'Idle',
        load: agent.load ?? 0,
        currentModelId: agent.currentModelId || '',
        fallbackModel: agent.fallbackModel || '',
        model: agent.currentModelId || '',
        tasks: agent.tasks ?? 0,
        memoryCount: agent.memoryCount ?? 0,
        tokensUsed: agent.tokensUsed ?? 0,
        tokenLimit: agent.tokenLimit ?? 1000000,
        sessionCount: agent.sessionCount ?? 0,
      }));
    } catch {
      return [];
    }
  }, []);

  const mergeAgents = useCallback((managedAgents: Agent[], runtimeAgents: Agent[]) => {
    if (runtimeAgents.length === 0) {
      return managedAgents;
    }

    const managedById = new Map(managedAgents.map((agent) => [agent.id, agent]));
    return runtimeAgents.map((runtimeAgent) => {
      const managed = managedById.get(runtimeAgent.id);
      return managed
        ? {
            ...runtimeAgent,
            ...managed,
            // Keep runtime model label so ModelNexus can reflect real invoking model names.
            model: runtimeAgent.model || managed.model || managed.currentModelId,
            lastActiveAt: runtimeAgent.lastActiveAt || managed.lastActiveAt,
          }
        : runtimeAgent;
    });
  }, []);

  const refresh = useCallback(async () => {
    const isFirstLoad = !hasLoadedOnceRef.current;
    if (isFirstLoad) {
      setLoading(true);
    }
    setError(null);

    try {
      const [data, managedAgents, coreData] = await Promise.all([
        fetchOpenClawData().catch(() => ({
          agents: [],
          projects: [],
          tasks: [],
          sessions: [],
          workspace: null,
          runtime: null,
        })),
        fetchManagedAgents().catch(() => []),
        fetchCoreProjectData().catch(() => ({ projects: [], tasks: [], sessions: [] })),
      ]);

      setAgents(mergeAgents(managedAgents, data.agents));
      // 项目主数据仅以 core API 为准，避免回退到 OpenClaw 工作区样例项目。
      setProjects(coreData.projects);
      setTasks(coreData.tasks);
      setSessions(coreData.sessions);
      setWorkspace(data.workspace);
      setRuntime(data.runtime);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load OpenClaw data';
      setError(message);
      if (isFirstLoad) {
        setAgents([]);
        setProjects([]);
        setTasks([]);
        setSessions([]);
        setWorkspace(null);
        setRuntime(null);
      }
    } finally {
      if (isFirstLoad) {
        hasLoadedOnceRef.current = true;
        setLoading(false);
      }
    }
  }, [fetchManagedAgents, mergeAgents]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) {
      return;
    }
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void refresh();
    }, 250);
  }, [refresh]);

  const sseEvents = useMemo(
    () => [
      'connected',
      'heartbeat',
      'snapshot',
      'task_update',
      'agent_status',
      'project_progress',
      'agent.status',
      'project.progress',
    ],
    [],
  );

  const handleSseOpen = useCallback(() => {
    setError(null);
  }, []);

  const handleSseEvent = useCallback(() => {
    scheduleRefresh();
  }, [scheduleRefresh]);

  const handleSseError = useCallback(() => {
    setError((prev) => prev ?? 'SSE connection interrupted, retrying...');
  }, []);

  useSSE('/api/openclaw/events', {
    withCredentials: true,
    maxRetries: 5,
    retryIntervalMs: 3000,
    events: sseEvents,
    onOpen: handleSseOpen,
    onEvent: handleSseEvent,
    onError: handleSseError,
  });

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  return {
    agents,
    projects,
    tasks,
    sessions,
    workspace,
    runtime,
    loading,
    error,
    refresh,
    getAgentMemory: fetchAgentMemory,
    sendAgentMessage,
  };
}
