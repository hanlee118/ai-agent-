import type { Project, ProjectView, StatusVariant } from '../../types';

const statusMeta: Record<Project['status'], { label: string; variant: StatusVariant }> = {
  Planning: { label: '规划中', variant: 'default' },
  Development: { label: '开发中', variant: 'primary' },
  Testing: { label: '测试中', variant: 'accent' },
  Completed: { label: '已完成', variant: 'primary' },
  Blocked: { label: '阻塞', variant: 'danger' },
  'At Risk': { label: '风险中', variant: 'warning' },
};

export function toProjectView(project: Project, agentNameMap: Record<string, string> = {}): ProjectView {
  const meta = statusMeta[project.status] ?? statusMeta.Planning;

  return {
    ...project,
    statusLabel: meta.label,
    statusVariant: meta.variant,
    progressLabel: `${Math.round(project.progress || 0)}%`,
    memberNames: (project.agents || []).map((id) => agentNameMap[id] || id),
  };
}

export function toProjectViews(projects: Project[], agentNameMap: Record<string, string> = {}): ProjectView[] {
  return projects.map((project) => toProjectView(project, agentNameMap));
}
