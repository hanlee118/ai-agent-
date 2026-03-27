import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '../types';
import { fetchOpenClawData } from '../lib/adapters';

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchOpenClawData();
      setSessions(data.sessions || []);
    } catch (err) {
      setSessions([]);
      setError(err instanceof Error ? err.message : 'Failed to fetch sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { sessions, loading, error, refresh };
}

export function useSession(id?: string) {
  const { sessions, loading, error, refresh } = useSessions();
  const session = useMemo(() => sessions.find((item) => item.id === id) || null, [sessions, id]);
  return { session, sessions, loading, error, refresh };
}
