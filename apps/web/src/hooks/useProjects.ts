import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Project } from '../types';
import { fetchOpenClawData } from '../lib/adapters';

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchOpenClawData();
      setProjects(data.projects || []);
    } catch (err) {
      setProjects([]);
      setError(err instanceof Error ? err.message : 'Failed to fetch projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { projects, loading, error, refresh };
}

export function useProject(id?: string) {
  const { projects, loading, error, refresh } = useProjects();
  const project = useMemo(() => projects.find((item) => item.id === id) || null, [projects, id]);
  return { project, projects, loading, error, refresh };
}
