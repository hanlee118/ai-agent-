import type { Agent, Model, Project, Session, Task } from '../types';
import type { Model as ApiModel } from './api';

export function buildRuntimeModels(
  runtime: unknown,
  agents: Agent[],
  projects: Project[],
  tasks: Task[],
  sessions: Session[],
): Model[] {
  const runtimeInfo = (runtime ?? {}) as {
    provider?: string;
    model?: string;
    modelName?: string;
    mode?: string;
  };

  const provider = runtimeInfo.provider || 'OpenClaw Runtime';
  const modelName = runtimeInfo.modelName || runtimeInfo.model || `${provider} Core`;
  const runtimeMode = runtimeInfo.mode || 'normal';

  const totalTokens = Math.max(
    agents.reduce((sum, agent) => sum + (agent.tokensUsed || 0), 0) + sessions.reduce((sum, session) => sum + (session.tokens || 0), 0),
    1,
  );
  const dailyTokens = Math.max(agents.reduce((sum, agent) => sum + (agent.tokensUsed || 0), 0), 1);
  const activeSessions = sessions.filter((session) => session.status === 'active').length;
  const throughputBase = Math.max(agents.length * 3 + activeSessions * 5 + tasks.length, 8);
  const latencyBase = runtimeMode === 'production' ? 120 : 180;

  const status: Model['status'] = runtimeMode === 'degraded'
    ? 'Degraded'
    : runtimeMode === 'offline'
      ? 'Offline'
      : 'Healthy';

  return [
    {
      id: 'runtime',
      name: modelName,
      provider,
      status,
      totalTokens,
      dailyTokens,
      currentTask: projects[0]?.name ? `推进项目: ${projects[0].name}` : '等待任务分配',
      latency: `${latencyBase + Math.min(activeSessions * 8, 220)}ms`,
      throughput: `${throughputBase.toFixed(1)} t/s`,
      logs: [],
    },
  ];
}

export function toUiModel(model: ApiModel): Model {
  const normalizedStatus: Model['status'] =
    model.status === 'Offline'
      ? 'Offline'
      : model.status === 'Degraded'
        ? 'Degraded'
        : 'Healthy';

  const currentTask = model.currentTask?.trim()
    || '待分配任务';

  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    status: normalizedStatus,
    totalTokens: Number(model.totalTokens || 0),
    dailyTokens: Number(model.dailyTokens || 0),
    currentTask,
    latency: model.latency || 'N/A',
    throughput: model.throughput || 'N/A',
    logs: [],
  };
}
