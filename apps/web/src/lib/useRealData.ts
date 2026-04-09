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
import { ApiRequestError } from './api/core';
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

  const toDataLoadError = useCallback((err: unknown) => {
    if (err instanceof ApiRequestError && err.status === 401) {
      return new Error('OpenClaw 接口需要登录后才能访问，请先完成登录。');
    }
    return err instanceof Error ? err : new Error('Failed to load OpenClaw data');
  }, []);

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
      const [openClawResult, managedAgentsResult, coreDataResult] = await Promise.allSettled([
        fetchOpenClawData(),
        fetchManagedAgents(),
        fetchCoreProjectData(),
      ]);

      const managedAgents = managedAgentsResult.status === 'fulfilled' ? managedAgentsResult.value : [];
      if (coreDataResult.status === 'rejected') {
        throw toDataLoadError(coreDataResult.reason);
      }

      const coreData = coreDataResult.value;
      const openClawData = openClawResult.status === 'fulfilled' ? openClawResult.value : null;
      const mergedAgents = mergeAgents(managedAgents, openClawData?.agents ?? []);

      setAgents(mergedAgents.length > 0 ? mergedAgents : managedAgents);
      // 项目主数据仅以 core API 为准，避免回退到 OpenClaw 工作区样例项目。
      setProjects(coreData.projects);
      setTasks(coreData.tasks);
      setSessions(coreData.sessions);
      setWorkspace(openClawData?.workspace ?? null);
      setRuntime(openClawData?.runtime ?? null);

      if (openClawResult.status === 'rejected') {
        const normalizedError = toDataLoadError(openClawResult.reason);
        setError(`OpenClaw 辅助数据暂不可用，已回退到核心项目数据: ${normalizedError.message}`);
      }
    } catch (err) {
      const normalizedError = toDataLoadError(err);
      const message = normalizedError.message;
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
