import { useCallback, useEffect, useMemo, useState } from 'react';
import { agentsApi, type Agent as ApiAgent } from '../lib/api';
import type { Agent } from '../types';

function mapApiAgent(agent: ApiAgent): Agent {
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    status: (agent.status as Agent['status']) || 'Idle',
    load: Number(agent.load || 0),
    currentModelId: agent.currentModelId || '',
    model: agent.currentModelId || '',
    tasks: Number(agent.tasks || 0),
    memoryCount: Number(agent.memoryCount || 0),
    tokensUsed: Number(agent.tokensUsed || 0),
    tokenLimit: Number(agent.tokenLimit || 100000000),
    sessionCount: Number(agent.sessionCount || 0),
  };
}

export function useAgents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await agentsApi.list();
      setAgents((list || []).map(mapApiAgent));
    } catch (err) {
      setAgents([]);
      setError(err instanceof Error ? err.message : 'Failed to fetch agents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { agents, loading, error, refresh };
}

export function useAgent(id?: string) {
  const { agents, loading, error, refresh } = useAgents();
  const agent = useMemo(() => agents.find((item) => item.id === id) || null, [agents, id]);
  return { agent, agents, loading, error, refresh };
}
