import type { ProjectExecutionRecord } from '../../lib/api';
import type { Task } from '../../types';

export type ProjectRoomTab = '任务' | '阶段' | '交付物' | '时间线';
export type ProjectRoomTabParam = 'tasks' | 'stages' | 'deliverables' | 'timeline';
export type CoreStageStatus = 'pending' | 'active' | 'completed' | 'blocked' | 'rejected';
export type CoreTaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done';
export type DeliverableStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

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

export const STAGE_ORDER = ['INIT', 'ANALYSIS', 'DESIGN', 'DEV', 'ACCEPT'];

export const PROJECT_ROOM_TAB_TO_PARAM: Record<ProjectRoomTab, ProjectRoomTabParam> = {
  任务: 'tasks',
  阶段: 'stages',
  交付物: 'deliverables',
  时间线: 'timeline',
};

export const PROJECT_ROOM_PARAM_TO_TAB: Record<ProjectRoomTabParam, ProjectRoomTab> = {
  tasks: '任务',
  stages: '阶段',
  deliverables: '交付物',
  timeline: '时间线',
};

export const CORE_STAGE_STATUS_LABELS: Record<CoreStageStatus, string> = {
  pending: '待开始',
  active: '进行中',
  completed: '已完成',
  blocked: '阻塞',
  rejected: '已驳回',
};

export const DELIVERABLE_STATUS_LABELS: Record<DeliverableStatus, string> = {
  draft: '草稿',
  submitted: '已提交',
  approved: '已通过',
  rejected: '已驳回',
};

export const DELIVERABLE_STATUS_RANK: Record<DeliverableStatus, number> = {
  approved: 4,
  submitted: 3,
  rejected: 2,
  draft: 1,
};

export const normalizeDeliverableNameKey = (name: string) =>
  String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/(?:[._-]v?\d+)(?:\.md|\.markdown|\.txt|\.pdf|\.docx?)?$/i, '')
    .replace(/\.(md|markdown|txt|pdf|docx?)$/i, '');

export const toDeliverableVersion = (value?: number) => (Number.isFinite(value) ? Number(value) : 0);

export const toDeliverableTimestamp = (value?: string) => {
  const time = new Date(String(value || '')).getTime();
  return Number.isFinite(time) ? time : 0;
};

export const toTaskStatus = (status: CoreTaskStatus): Task['status'] => {
  switch (status) {
    case 'done':
      return 'Completed';
    case 'in_progress':
      return 'In Progress';
    case 'blocked':
      return 'Blocked';
    case 'todo':
    default:
      return 'Pending';
  }
};

export const toTaskProgress = (status: CoreTaskStatus) => {
  switch (status) {
    case 'done':
      return 100;
    case 'in_progress':
      return 60;
    case 'blocked':
      return 35;
    case 'todo':
    default:
      return 0;
  }
};

export const roleLabel = (roleId?: string) => ROLE_LABELS[String(roleId || '')] || roleId || '系统';

export const isProjectNotFoundError = (error: unknown) =>
  /project not found/i.test(error instanceof Error ? error.message : String(error ?? ''));

export const statusVariantByStage = (status: CoreStageStatus) => {
  if (status === 'completed') return 'primary';
  if (status === 'active') return 'accent';
  if (status === 'blocked' || status === 'rejected') return 'danger';
  return 'default';
};

export const statusVariantByDeliverable = (status: DeliverableStatus) => {
  if (status === 'approved') return 'primary';
  if (status === 'submitted') return 'accent';
  if (status === 'rejected') return 'danger';
  return 'default';
};

const readExecutionMetadataBoolean = (metadata: unknown, key: string) => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false;
  }
  const value = (metadata as Record<string, unknown>)[key];
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  return false;
};

export const getStageApprovalBlockReason = (record?: ProjectExecutionRecord | null) => {
  if (!record) {
    return '当前阶段缺少模型执行记录，请先执行一轮阶段任务后再验收。';
  }
  if (String(record.status || '').toLowerCase() !== 'success') {
    return `当前阶段最近一次模型执行失败${record.errorMessage ? `（${record.errorMessage}）` : ''}，请修复后重试。`;
  }
  if (String(record.provider || '').trim().toLowerCase() === 'scripted') {
    return '当前阶段输出来自 scripted 降级模式，禁止过阶段。';
  }
  if (readExecutionMetadataBoolean(record.metadata, 'degraded')) {
    return '当前阶段模型执行处于 degraded 状态，禁止过阶段。';
  }
  const requestedMode = String(record.requestedMode || '').trim().toLowerCase();
  if (requestedMode && requestedMode !== 'openai-compatible') {
    return '当前阶段未在真实模型模式下执行，禁止过阶段。';
  }
  return null;
};

export const formatExecutionModelLabel = (record?: ProjectExecutionRecord | null) => {
  if (!record) {
    return '未知模型';
  }
  const model = String(record.model || '').trim() || 'n/a';
  const provider = String(record.provider || record.runtimeMode || '').trim() || 'unknown';
  return `${model} (${provider})`;
};

export const isDesignLikeText = (text: string) =>
  /(design|设计|视觉|交互|官网|landing|ui|ux)/i.test(String(text || '').toLowerCase());

export const getTaskTimestamp = (task: Task) => {
  const taskRecord = task as Task & { updatedAt?: string; createdAt?: string };
  const rawDate = taskRecord.updatedAt || taskRecord.createdAt || new Date().toISOString();
  const date = new Date(rawDate);
  return Number.isNaN(date.getTime()) ? Date.now() : date.getTime();
};

export const formatProjectLogTime = (date: string | Date | null | undefined) => {
  if (!date) {
    return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  const normalized = new Date(date);
  if (Number.isNaN(normalized.getTime())) {
    return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  return normalized.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

export const toLogTimestamp = (raw: string | Date | number | null | undefined) => {
  if (!raw && raw !== 0) {
    return Date.now();
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? Date.now() : date.getTime();
};

export const formatIssueUpdatedRelative = (raw: string | null | undefined) => {
  if (!raw) {
    return '未知时间';
  }
  const ts = new Date(raw).getTime();
  if (Number.isNaN(ts)) {
    return '未知时间';
  }
  const diff = Date.now() - ts;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))} 小时前`;
  return `${Math.floor(diff / (24 * 60 * 60 * 1000))} 天前`;
};

export const formatIssueUpdatedAbsolute = (raw: string | null | undefined) => {
  if (!raw) {
    return '未知时间';
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return '未知时间';
  }
  return date.toLocaleString('zh-CN');
};

export const summarizeText = (text: string, max = 66) => {
  const normalized = String(text || '').trim().replace(/\s+/g, ' ');
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max)}...`;
};
