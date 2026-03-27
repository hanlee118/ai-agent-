import type { Session } from '../../types';

export interface SessionView {
  id: string;
  agentId: string;
  projectId: string;
  status: Session['status'];
  tokenLabel: string;
  costLabel: string;
  startedAt: string;
}

export function toSessionView(session: Session): SessionView {
  return {
    id: session.id,
    agentId: session.agentId,
    projectId: session.projectId,
    status: session.status,
    tokenLabel: `${session.tokens || 0}`,
    costLabel: `$${Number(session.cost || 0).toFixed(2)}`,
    startedAt: session.startTime,
  };
}

export function toSessionViews(sessions: Session[]): SessionView[] {
  return sessions.map(toSessionView);
}
