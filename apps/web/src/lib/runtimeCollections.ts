import type { Agent, Model, Project, Session, Task } from '../types';

export let models: Model[] = [];
export let agents: Agent[] = [];
export let sessions: Session[] = [];
export let projects: Project[] = [];
export let tasks: Task[] = [];

export const syncRuntimeCollections = (payload: {
  models: Model[];
  agents: Agent[];
  projects: Project[];
  tasks: Task[];
  sessions: Session[];
}) => {
  models = payload.models;
  agents = payload.agents;
  projects = payload.projects;
  tasks = payload.tasks;
  sessions = payload.sessions;
};
