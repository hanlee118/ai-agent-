import { useCallback, useEffect, useState } from 'react';
import type { Agent, Project, Session, Task } from '../types';
import {
  fetchAgentMemory,
  fetchOpenClawData,
  sendAgentMessage,
  type OpenClawAgentMemoryEntry,
  type OpenClawRuntimeInfo,
  type OpenClawWorkspaceOverview,
} from './adapters';
import { agentsApi } from './api';

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

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [data, managedAgents] = await Promise.all([
        fetchOpenClawData(),
        fetchManagedAgents(),
      ]);

      setAgents(managedAgents.length > 0 ? managedAgents : data.agents);
      setProjects(data.projects);
      setTasks(data.tasks);
      setSessions(data.sessions);
      setWorkspace(data.workspace);
      setRuntime(data.runtime);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load OpenClaw data';
      setError(message);
      setAgents([]);
      setProjects([]);
      setTasks([]);
      setSessions([]);
      setWorkspace(null);
      setRuntime(null);
    } finally {
      setLoading(false);
    }
  }, [fetchManagedAgents]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      return;
    }

    const eventSource = new EventSource('/api/openclaw/events', { withCredentials: true });
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefresh = () => {
      if (refreshTimer) {
        return;
      }
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void refresh();
      }, 250);
    };

    const onOpen = () => {
      setError(null);
    };

    const onStreamEvent = () => {
      scheduleRefresh();
    };

    const onError = () => {
      // Keep the stream alive when possible; browser will auto-reconnect.
      setError((prev) => prev ?? 'SSE connection interrupted, retrying...');
    };

    eventSource.addEventListener('open', onOpen);
    eventSource.addEventListener('message', onStreamEvent);
    eventSource.addEventListener('connected', onStreamEvent);
    eventSource.addEventListener('heartbeat', onStreamEvent);
    eventSource.addEventListener('snapshot', onStreamEvent);
    eventSource.addEventListener('task_update', onStreamEvent);
    eventSource.addEventListener('agent_status', onStreamEvent);
    eventSource.addEventListener('project_progress', onStreamEvent);
    // Backward compatibility with older event naming.
    eventSource.addEventListener('agent.status', onStreamEvent);
    eventSource.addEventListener('project.progress', onStreamEvent);
    eventSource.addEventListener('error', onError);

    return () => {
      eventSource.removeEventListener('open', onOpen);
      eventSource.removeEventListener('message', onStreamEvent);
      eventSource.removeEventListener('connected', onStreamEvent);
      eventSource.removeEventListener('heartbeat', onStreamEvent);
      eventSource.removeEventListener('snapshot', onStreamEvent);
      eventSource.removeEventListener('task_update', onStreamEvent);
      eventSource.removeEventListener('agent_status', onStreamEvent);
      eventSource.removeEventListener('project_progress', onStreamEvent);
      eventSource.removeEventListener('agent.status', onStreamEvent);
      eventSource.removeEventListener('project.progress', onStreamEvent);
      eventSource.removeEventListener('error', onError);
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      eventSource.close();
    };
  }, [refresh]);

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
