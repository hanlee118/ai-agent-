import { useCallback, useEffect, useMemo, useState } from 'react';
import { modelsApi, type Model as ApiModel } from '../lib/api';
import type { Model } from '../types';

function mapApiModel(model: ApiModel): Model {
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    status: model.status === 'Offline' ? 'Offline' : model.status === 'Degraded' ? 'Degraded' : 'Healthy',
    totalTokens: Number(model.totalTokens || 0),
    dailyTokens: Number(model.dailyTokens || 0),
    currentTask: model.currentTask || '待分配任务',
    latency: model.latency || 'unknown',
    throughput: model.throughput || 'unknown',
    tokenSource: model.tokenSource || (Number(model.totalTokens || 0) > 0 || Number(model.dailyTokens || 0) > 0 ? 'model_counter' : 'unknown'),
    telemetryQuality: model.telemetryQuality || (Number(model.totalTokens || 0) > 0 || Number(model.dailyTokens || 0) > 0 ? 'estimated' : 'unknown'),
    costMode: model.costMode || (Number(model.totalTokens || 0) > 0 || Number(model.dailyTokens || 0) > 0 ? 'estimated' : 'unknown'),
    logs: [],
  };
}

export function useModels() {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await modelsApi.list();
      setModels((list || []).map(mapApiModel));
    } catch (err) {
      setModels([]);
      setError(err instanceof Error ? err.message : 'Failed to fetch models');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { models, loading, error, refresh };
}

export function useModel(id?: string) {
  const { models, loading, error, refresh } = useModels();
  const model = useMemo(() => models.find((item) => item.id === id) || null, [models, id]);
  return { model, models, loading, error, refresh };
}
