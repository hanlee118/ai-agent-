import type { Agent, AgentView, StatusVariant } from '../../types';

const statusMeta: Record<Agent['status'], { label: string; variant: StatusVariant }> = {
  Idle: { label: '空闲', variant: 'default' },
  Thinking: { label: '思考中', variant: 'warning' },
  Executing: { label: '执行中', variant: 'primary' },
  Offline: { label: '离线', variant: 'danger' },
};

export function toAgentView(agent: Agent): AgentView {
  const meta = statusMeta[agent.status] ?? statusMeta.Idle;
  const initials = (agent.name || 'A')
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return {
    ...agent,
    initials,
    statusLabel: meta.label,
    statusVariant: meta.variant,
    loadLabel: `${Math.round(agent.load || 0)}%`,
  };
}

export function toAgentViews(agents: Agent[]): AgentView[] {
  return agents.map(toAgentView);
}
