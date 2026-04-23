import type { TaskDelegation } from '../../lib/api';

export const ROLE_LABELS: Record<string, string> = {
  ROLE_ASSISTANT: '总助理',
  ROLE_PM: '项目经理',
  ROLE_ANALYST: '需求分析师',
  ROLE_PRODUCT: '产品总监',
  ROLE_DESIGN: '视觉设计总监',
  ROLE_ARCH: '研发总监',
  ROLE_DEV: '研发经理',
  ROLE_QA: '测试工程师',
  ROLE_HR: 'HR总监',
};

export const STAGE_LABELS: Record<string, string> = {
  INIT: '项目立项',
  ANALYSIS: '需求分析',
  DESIGN: '需求设计/视觉设计',
  DEV: '代码开发',
  ACCEPT: '测试验收',
};

export const TASK_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  ready: '就绪',
  assigned: '已分派',
  todo: '待处理',
  in_progress: '进行中',
  blocked: '已阻塞',
  pending_review: '待审阅',
  pending_approval: '待审批',
  done: '已完成',
  completed: '已完成',
  rejected: '已驳回',
  cancelled: '已取消',
};

export const COORDINATION_MODE_LABELS: Record<string, string> = {
  single_owner: '单 owner',
  team_collab: '团队协作',
  delegated_execution: '委派执行',
};

export const DELEGATION_POLICY_LABELS: Record<string, string> = {
  forbidden: '禁止委派',
  manual_only: '手动委派',
  auto_allowed: '允许自动委派',
};

export const SYNC_POLICY_LABELS: Record<string, string> = {
  db_only: '仅数据库',
  db_plus_gitlab: '数据库 + GitLab',
  full_mirror: '全量镜像',
};

export const CONTEXT_SCOPE_LABELS: Record<string, string> = {
  local: '本任务',
  stage: '当前阶段',
  project: '当前项目',
  cross_project: '跨项目',
};

export const DELEGATION_STATUS_LABELS: Record<TaskDelegation['status'], string> = {
  queued: '排队中',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  expired: '已超时',
};

export const DEFAULT_AGENT_BY_ROLE: Record<string, string> = {
  ROLE_ASSISTANT: 'main',
  ROLE_PM: 'project_manager',
  ROLE_ANALYST: 'requirements_analyst',
  ROLE_PRODUCT: 'product_director',
  ROLE_DESIGN: 'jeremy',
  ROLE_ARCH: 'rd_director',
  ROLE_DEV: 'rd_manager',
  ROLE_QA: 'qa_engineer',
  ROLE_HR: 'hr_director',
};

export function roleLabel(roleId?: string) {
  return ROLE_LABELS[String(roleId || '')] || roleId || '系统';
}

export function statusVariantByTask(status: string) {
  if (status === 'done' || status === 'completed' || status === 'Completed') return 'primary';
  if (status === 'in_progress' || status === 'pending_review' || status === 'pending_approval' || status === 'In Progress') return 'accent';
  if (status === 'blocked' || status === 'rejected' || status === 'cancelled' || status === 'Blocked') return 'danger';
  return 'default';
}

export function statusVariantByDelegation(status: TaskDelegation['status']) {
  if (status === 'completed') return 'primary';
  if (status === 'running') return 'accent';
  if (status === 'failed' || status === 'expired' || status === 'cancelled') return 'danger';
  return 'default';
}

export function gitlabStatusBadge(status?: string) {
  if (status === 'synced') {
    return { label: 'GitLab 已同步', variant: 'primary' as const };
  }
  if (status === 'sync_required') {
    return { label: 'GitLab 待同步', variant: 'warning' as const };
  }
  return { label: 'GitLab 未同步', variant: 'default' as const };
}
