import type { Agent, Project, Task } from './domain';

export type StatusVariant = 'primary' | 'accent' | 'warning' | 'danger' | 'default';

export interface AgentView extends Agent {
  initials: string;
  statusLabel: string;
  statusVariant: StatusVariant;
  loadLabel: string;
}

export interface ProjectView extends Project {
  statusLabel: string;
  statusVariant: StatusVariant;
  progressLabel: string;
  memberNames: string[];
}

export interface TaskView extends Task {
  statusLabel: string;
  statusVariant: StatusVariant;
  progressLabel: string;
}
