import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Task } from '../types';
import { fetchOpenClawData } from '../lib/adapters';

export function useTasks(projectId?: string) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchOpenClawData();
      const allTasks = data.tasks || [];
      setTasks(projectId ? allTasks.filter((task) => task.projectId === projectId) : allTasks);
    } catch (err) {
      setTasks([]);
      setError(err instanceof Error ? err.message : 'Failed to fetch tasks');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { tasks, loading, error, refresh };
}

export function useTask(taskId?: string) {
  const { tasks, loading, error, refresh } = useTasks();
  const task = useMemo(() => tasks.find((item) => item.id === taskId) || null, [tasks, taskId]);
  return { task, tasks, loading, error, refresh };
}
