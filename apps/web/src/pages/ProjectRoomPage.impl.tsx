import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BrainCircuit,
  Briefcase,
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileText,
  History,
  Layers,
  Plus,
  ShieldCheck,
  Terminal,
  Users,
  Zap,
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import type { ProjectStatus, Task as ViewTask } from '../types';
import { useSSE } from '../hooks/useSSE';
import {
  tasksApi,
  projectsApi,
  workflowsApi,
  ApiRequestError,
  type ProjectDetail,
  type TaskDelegation,
  type TaskDelegationBundle,
  type TaskDependencySummary,
  type ProjectAcceptanceReport,
  type ProjectExecutionRecord,
  type ProjectFinalArtifactsReport,
  type ProjectRequiredAction,
  type WorkflowProjectOverview,
} from '../lib/api';
import { agents, projects } from '../lib/runtimeCollections';
import SurfaceModal from './impl/SurfaceModal';
import { getReadyForReviewBlockReason, normalizeTaskActionError } from './ProjectRoomPage/taskCollaborationUi';
import { TaskDetailHeaderCard } from './ProjectRoomPage/TaskDetailHeaderCard';
import { TaskDelegationStatusPanel } from './ProjectRoomPage/TaskDelegationStatusPanel';

type ProjectRoomTab = '任务' | '阶段' | '交付物' | '时间线';
type ProjectRoomTabParam = 'tasks' | 'stages' | 'deliverables' | 'timeline';
type CoreStageStatus = 'pending' | 'active' | 'completed' | 'blocked' | 'rejected';
type ProjectDetailResponse = ProjectDetail & {
  requiredActions?: ProjectRequiredAction[];
  postCreatePrep?: {
    required: boolean;
    completed: boolean;
    missingItems: string[];
    draft?: {
      discussion: string;
      analysis: string;
      rawRequirements: string;
      prd: string;
      debateSummary: string;
      confirmed: boolean;
      confirmedBy?: string;
      confirmedAt?: string;
      confirmationNotes?: string;
    };
  };
};
type CoreTaskStatus = ProjectDetailResponse['tasks'][number]['status'];
type DeliverableStatus = ProjectDetailResponse['deliverables'][number]['status'];
type ProjectDeliverable = ProjectDetailResponse['deliverables'][number];
type ProjectStitchArtifact = NonNullable<ProjectDetailResponse['stitchArtifacts']>[number];
type ProjectRoomTaskItem = ViewTask & {
  rawStatus: CoreTaskStatus;
  description: string;
  stageType: string;
  projectId: string;
  assigneeRoleId: string;
  priority: 'low' | 'normal' | 'high';
  ownerAgentId?: string;
  reviewAgentId?: string;
  coordinationMode?: string;
  delegationPolicy?: string;
  syncPolicy?: string;
  contextScope?: string;
  parentTaskId?: string;
  pendingDelegationCount: number;
  lastDelegatedAt?: string;
  blockedReason?: NonNullable<ProjectDetailResponse['tasks'][number]['blockedReason']>;
  nextAction?: NonNullable<ProjectDetailResponse['tasks'][number]['nextAction']>;
  dependencies?: TaskDependencySummary[];
  delegationSummary?: NonNullable<ProjectDetailResponse['tasks'][number]['delegationSummary']>;
  gitlab?: NonNullable<ProjectDetailResponse['tasks'][number]['gitlab']>;
};
type SideDeliverableItem = {
  id: string;
  name: string;
  type: string;
  size: string;
  deliverable?: ProjectDeliverable;
};
type FinalArtifactItem = ProjectFinalArtifactsReport['artifacts'][number];
type ProjectRoomLogItem = {
  id: string;
  time: string;
  actor: string;
  message: string;
  type: 'danger' | 'accent' | 'primary';
  timestamp: number;
};
type ProtocolFailureCategory =
  | 'runtime_or_model'
  | 'collaboration'
  | 'skill_evidence'
  | 'content_evidence'
  | 'stage_template'
  | 'unknown';
type ProtocolFailureHint = {
  title: string;
  categories: ProtocolFailureCategory[];
  missingChecks: string[];
};

type ProjectRoomDesignReviewForm = {
  visualDirection: string;
  brandTone: string;
  layoutStrategy: string;
  componentSpecs: string;
  uxPrinciples: string;
  accessibilityChecklist: string;
  approvedBy: string;
  notes: string;
  approved: boolean;
};

type PrepDiscussionView = {
  consensus: string[];
  divergences: string[];
  roleDecisions: string[];
  anchor: string;
};

type PrepAnalysisView = {
  objective: string;
  designTheme: string;
  scenarios: string[];
  inScope: string[];
  outOfScope: string[];
  acceptance: string[];
  risks: string[];
};

type PrepRequirementContractView = {
  objective: string;
  inScope: string[];
  outOfScope: string[];
  acceptance: string[];
  artifacts: string[];
};

const DEFAULT_REVIEWER = '视觉设计总监';
const DEFAULT_UX_ITEMS = ['主路径优先', '关键反馈及时', '降低认知负担'];
const DEFAULT_A11Y_ITEMS = ['文本对比度达标', '键盘可达', '语义结构完整'];

const createDefaultDesignReviewForm = (): ProjectRoomDesignReviewForm => ({
  visualDirection: '',
  brandTone: '',
  layoutStrategy: '',
  componentSpecs: '',
  uxPrinciples: '',
  accessibilityChecklist: '',
  approvedBy: DEFAULT_REVIEWER,
  notes: '',
  approved: true,
});

const isDesignReviewFormBlank = (form: ProjectRoomDesignReviewForm) => {
  return ![
    form.visualDirection,
    form.brandTone,
    form.layoutStrategy,
    form.componentSpecs,
    form.uxPrinciples,
    form.accessibilityChecklist,
    form.notes,
  ].some((item) => String(item || '').trim().length > 0);
};

const isPrototypeLikeArtifact = (artifact: FinalArtifactItem) => {
  const text = [
    artifact.name,
    artifact.category,
    artifact.url,
    artifact.filePath,
    artifact.excerpt,
    artifact.stageType,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return /(dapp|mvp|prototype|原型|交互|preview|预览|\/generated\/)/i.test(text);
};

const DESIGN_REVIEW_NOISE_TITLES = new Set([
  '视觉方案',
  '版式策略',
  '组件清单',
  '品牌语气',
  'ux 原则',
  '可访问性检查',
  '设计审查卡',
  '验收检查清单',
  'agent 介入说明',
  'agent 输出摘录',
]);

const normalizePrefillLine = (value: string) =>
  value
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[-*]\s*/, '')
    .replace(/^【[^】]+】/, '')
    .trim();

const isNoiseLine = (value: string) => {
  const normalized = value.trim().toLowerCase().replace(/[：:]/g, '');
  return !normalized || DESIGN_REVIEW_NOISE_TITLES.has(normalized);
};

const sanitizePrefillText = (value: string) =>
  String(value || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(normalizePrefillLine)
    .filter((line) => !isNoiseLine(line))
    .join(' ')
    .trim();

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const extractSectionBullets = (source: string, title: string) => {
  const sectionPattern = new RegExp(`##\\s*${escapeRegExp(title)}\\s*([\\s\\S]*?)(?=\\n##\\s|$)`, 'i');
  const section = source.match(sectionPattern)?.[1] || '';
  return section
    .split('\n')
    .map((line) => normalizePrefillLine(line))
    .filter((line) => !isNoiseLine(line));
};

const pickLine = (source: string, patterns: RegExp[]) => {
  for (const pattern of patterns) {
    const matched = source.match(pattern);
    if (matched?.[1]) {
      const value = sanitizePrefillText(matched[1]);
      if (value) {
        return value;
      }
    }
  }
  return '';
};

const ensureAtLeastThree = (items: string[], fallback: string[]) => {
  const deduped = Array.from(new Set(items.map((item) => sanitizePrefillText(item)).filter(Boolean)));
  const merged = [...deduped];
  for (const candidate of fallback) {
    if (merged.length >= 3) {
      break;
    }
    if (!merged.includes(candidate)) {
      merged.push(candidate);
    }
  }
  return merged.slice(0, 6);
};

const normalizeMarkdownLine = (value: string) =>
  String(value || '')
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[-*]\s*/, '')
    .replace(/^\d+\.\s*/, '')
    .trim();

const extractMarkdownSubSection = (source: string, title: string) => {
  const pattern = new RegExp(`###\\s*${escapeRegExp(title)}\\s*([\\s\\S]*?)(?=\\n###\\s|$)`, 'i');
  return String(source.match(pattern)?.[1] || '').trim();
};

const splitInlineList = (value: string) =>
  String(value || '')
    .split(/[；;，,、\n]/)
    .map((item) => normalizeMarkdownLine(item))
    .filter(Boolean);

const extractBulletLines = (source: string) =>
  String(source || '')
    .split('\n')
    .map((line) => normalizeMarkdownLine(line))
    .filter(Boolean);

const parsePrepDiscussionView = (source: string): PrepDiscussionView => {
  const text = String(source || '').replace(/\r\n/g, '\n');
  const consensus = extractBulletLines(extractMarkdownSubSection(text, '共识'));
  const divergences = extractBulletLines(extractMarkdownSubSection(text, '分歧与处理'));
  const roleDecisions = extractBulletLines(extractMarkdownSubSection(text, '角色决策建议'));
  const anchorRaw = extractBulletLines(extractMarkdownSubSection(text, '决策锚点'));
  return {
    consensus,
    divergences,
    roleDecisions,
    anchor: anchorRaw[0] || '',
  };
};

const parsePrepAnalysisView = (source: string): PrepAnalysisView => {
  const text = String(source || '').replace(/\r\n/g, '\n');
  const objective = sanitizePrefillText(text.match(/(?:^|\n)-\s*目标[:：]\s*([^\n]+)/i)?.[1] || '');
  const designTheme = sanitizePrefillText(text.match(/(?:^|\n)-\s*设计主题[:：]\s*([^\n]+)/i)?.[1] || '');
  const scenarios = extractBulletLines(extractMarkdownSubSection(text, '核心场景'));
  const inScope = extractBulletLines(extractMarkdownSubSection(text, 'In Scope'));
  const outOfScope = extractBulletLines(extractMarkdownSubSection(text, 'Out of Scope'));
  const acceptance = extractBulletLines(extractMarkdownSubSection(text, '验收标准'));
  const risks = extractBulletLines(extractMarkdownSubSection(text, '关键风险与待确认'));
  return {
    objective,
    designTheme,
    scenarios,
    inScope,
    outOfScope,
    acceptance,
    risks,
  };
};

const parsePrepRequirementContractView = (source: string): PrepRequirementContractView => {
  const text = String(source || '').replace(/\r\n/g, '\n');
  const objective = sanitizePrefillText(text.match(/(?:^|\n)-\s*目标[:：]\s*([^\n]+)/i)?.[1] || '');
  const inScope = splitInlineList(text.match(/(?:^|\n)-\s*In Scope[:：]\s*([^\n]+)/i)?.[1] || '');
  const outOfScope = splitInlineList(text.match(/(?:^|\n)-\s*Out of Scope[:：]\s*([^\n]+)/i)?.[1] || '');
  const acceptance = splitInlineList(text.match(/(?:^|\n)-\s*验收[:：]\s*([^\n]+)/i)?.[1] || '');
  const artifacts = splitInlineList(text.match(/(?:^|\n)-\s*产出[:：]\s*([^\n]+)/i)?.[1] || '');
  return {
    objective,
    inScope,
    outOfScope,
    acceptance,
    artifacts,
  };
};

const buildDesignReviewPrefill = (input: {
  source: string;
  actionDetail?: string;
}): ProjectRoomDesignReviewForm | null => {
  const source = String(input.source || '').replace(/\r\n/g, '\n').trim();
  if (!source) {
    return null;
  }

  const visualDirection = pickLine(source, [
    /(?:视觉方向|视觉风格|视觉主题)[:：]\s*([^\n]+)/i,
    /##\s*视觉方案[\s\S]*?-\s*([^\n]+)/i,
  ]) || '请围绕业务主链路确认视觉方向';

  const brandTone = pickLine(source, [
    /(?:品牌语气|语气|品牌调性)[:：]\s*([^\n]+)/i,
    /##\s*品牌语气[\s\S]*?-\s*([^\n]+)/i,
  ]) || '专业、直接、可执行';

  const layoutStrategy = pickLine(source, [
    /(?:版式策略|布局策略|信息架构)[:：]\s*([^\n]+)/i,
  ]) || extractSectionBullets(source, '版式策略').slice(0, 4).join('；') || '首屏价值主张 -> 核心流程 -> 执行证据 -> CTA';

  const componentSpecs = pickLine(source, [
    /(?:组件规范|组件清单|模块清单)[:：]\s*([^\n]+)/i,
  ]) || extractSectionBullets(source, '组件清单').slice(0, 6).join('；') || 'Hero、能力卡、流程步骤、证据卡、CTA';

  const uxLine = pickLine(source, [/(?:UX\s*原则|交互原则|体验原则)[:：]\s*([^\n]+)/i]);
  const uxSection = extractSectionBullets(source, 'UX 原则');
  const uxPrinciples = ensureAtLeastThree([
    ...uxSection,
    ...uxLine.split(/[；;，,\n]/),
  ], DEFAULT_UX_ITEMS);

  const a11yLine = pickLine(source, [/(?:可访问性检查|无障碍清单|可访问性清单)[:：]\s*([^\n]+)/i]);
  const a11ySection = extractSectionBullets(source, '可访问性检查');
  const accessibilityChecklist = ensureAtLeastThree([
    ...a11ySection,
    ...a11yLine.split(/[；;，,\n]/),
  ], DEFAULT_A11Y_ITEMS);

  const compact = sanitizePrefillText(source).replace(/\s+/g, ' ').trim();
  const summary = compact.length > 220 ? `${compact.slice(0, 220)}...` : compact;
  const noteHead = input.actionDetail ? `触发原因: ${input.actionDetail}` : '触发原因: 设计 Agent 需要人工补充或确认';
  const notes = `${noteHead}\n\nAgent 思考摘录:\n${summary}`;

  return {
    visualDirection,
    brandTone,
    layoutStrategy,
    componentSpecs,
    uxPrinciples: uxPrinciples.join('\n'),
    accessibilityChecklist: accessibilityChecklist.join('\n'),
    approvedBy: DEFAULT_REVIEWER,
    notes,
    approved: true,
  };
};

const ROLE_LABELS: Record<string, string> = {
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

const STAGE_LABELS: Record<string, string> = {
  INIT: '立项',
  ANALYSIS: '分析',
  DESIGN: '设计',
  DEV: '开发',
  ACCEPT: '验收',
};

const WORKFLOW_TEMPLATE_STAGE_LABELS: Record<string, string> = {
  requirements_design: '需求设计',
  visual_design: '视觉设计',
  tech_design: '技术设计',
  code_dev: '代码研发',
  qa_acceptance: 'QA 验收',
  standard_software_development: '标准软件开发流程',
};

const WORKFLOW_TEMPLATE_TO_CORE_STAGE: Record<string, string> = {
  requirements_design: 'ANALYSIS',
  visual_design: 'DESIGN',
  tech_design: 'DEV',
  code_dev: 'DEV',
  qa_acceptance: 'ACCEPT',
  standard_software_development: 'INIT',
};

const WORKFLOW_OVERVIEW_FILTER_OPTIONS: Array<{
  key: 'all' | 'current' | 'running' | 'reviewing' | 'completed' | 'failed' | 'gate_blocked';
  label: string;
}> = [
  { key: 'all', label: '全部' },
  { key: 'current', label: '当前' },
  { key: 'running', label: '执行中' },
  { key: 'reviewing', label: '待门禁' },
  { key: 'completed', label: '已完成' },
  { key: 'failed', label: '失败' },
  { key: 'gate_blocked', label: '门禁阻塞' },
];

const STAGE_ORDER = ['INIT', 'ANALYSIS', 'DESIGN', 'DEV', 'ACCEPT'];
const PROJECT_ROOM_TAB_TO_PARAM: Record<ProjectRoomTab, ProjectRoomTabParam> = {
  任务: 'tasks',
  阶段: 'stages',
  交付物: 'deliverables',
  时间线: 'timeline',
};
const PROJECT_ROOM_PARAM_TO_TAB: Record<ProjectRoomTabParam, ProjectRoomTab> = {
  tasks: '任务',
  stages: '阶段',
  deliverables: '交付物',
  timeline: '时间线',
};

const CORE_STAGE_STATUS_LABELS: Record<CoreStageStatus, string> = {
  pending: '待开始',
  active: '进行中',
  completed: '已完成',
  blocked: '阻塞',
  rejected: '已驳回',
};

const WORKFLOW_STAGE_STATUS_LABELS: Record<string, string> = {
  pending: '待开始',
  running: '执行中',
  reviewing: '待门禁',
  completed: '已完成',
  failed: '失败',
  skipped: '已跳过',
};

const DELIVERABLE_STATUS_LABELS: Record<DeliverableStatus, string> = {
  draft: '草稿',
  submitted: '已提交',
  approved: '已通过',
  rejected: '已驳回',
};

const DELIVERABLE_STATUS_RANK: Record<DeliverableStatus, number> = {
  approved: 4,
  submitted: 3,
  rejected: 2,
  draft: 1,
};

const TASK_STATUS_LABELS: Record<CoreTaskStatus, string> = {
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

const COORDINATION_MODE_LABELS: Record<string, string> = {
  single_owner: '单 owner',
  team_collab: '团队协作',
  delegated_execution: '委派执行',
};

const DELEGATION_POLICY_LABELS: Record<string, string> = {
  forbidden: '禁止委派',
  manual_only: '手动委派',
  auto_allowed: '允许自动委派',
};

const SYNC_POLICY_LABELS: Record<string, string> = {
  db_only: '仅数据库',
  db_plus_gitlab: '数据库 + GitLab',
  full_mirror: '全量镜像',
};

const CONTEXT_SCOPE_LABELS: Record<string, string> = {
  local: '本任务',
  stage: '当前阶段',
  project: '当前项目',
  cross_project: '跨项目',
};

const DELEGATION_STATUS_LABELS: Record<TaskDelegation['status'], string> = {
  queued: '排队中',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  expired: '已超时',
};

const DEFAULT_AGENT_BY_ROLE: Record<string, string> = {
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

const normalizeDeliverableNameKey = (name: string) =>
  String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/(?:[._-]v?\d+)(?:\.md|\.markdown|\.txt|\.pdf|\.docx?)?$/i, '')
    .replace(/\.(md|markdown|txt|pdf|docx?)$/i, '');

const toDeliverableVersion = (value?: number) => (Number.isFinite(value) ? Number(value) : 0);

const toDeliverableTimestamp = (value?: string) => {
  const time = new Date(String(value || '')).getTime();
  return Number.isFinite(time) ? time : 0;
};

const toTaskStatus = (status: CoreTaskStatus): ViewTask['status'] => {
  switch (status) {
    case 'completed':
    case 'done':
      return 'Completed';
    case 'pending_review':
    case 'pending_approval':
    case 'assigned':
    case 'ready':
    case 'in_progress':
      return 'In Progress';
    case 'blocked':
    case 'rejected':
    case 'cancelled':
      return 'Blocked';
    case 'draft':
    case 'todo':
    default:
      return 'Pending';
  }
};

const toTaskProgress = (status: CoreTaskStatus) => {
  switch (status) {
    case 'completed':
    case 'done':
      return 100;
    case 'pending_review':
    case 'pending_approval':
    case 'assigned':
    case 'ready':
    case 'in_progress':
      return 60;
    case 'rejected':
    case 'cancelled':
    case 'blocked':
      return 35;
    case 'draft':
    case 'todo':
    default:
      return 0;
  }
};

const roleLabel = (roleId?: string) => ROLE_LABELS[String(roleId || '')] || roleId || '系统';
const workflowTemplateLabel = (templateKey?: string) => {
  const key = String(templateKey || '').trim();
  if (!key) {
    return '未命名阶段';
  }
  return WORKFLOW_TEMPLATE_STAGE_LABELS[key] || key;
};

const workflowTemplateToCoreStage = (templateKey?: string) => {
  const key = String(templateKey || '').trim();
  if (!key) {
    return '';
  }
  if (WORKFLOW_TEMPLATE_TO_CORE_STAGE[key]) {
    return WORKFLOW_TEMPLATE_TO_CORE_STAGE[key];
  }
  const lowered = key.toLowerCase();
  if (lowered.includes('qa') || lowered.includes('accept')) return 'ACCEPT';
  if (lowered.includes('design') || lowered.includes('visual') || lowered.includes('ui') || lowered.includes('ux')) return 'DESIGN';
  if (lowered.includes('requirement') || lowered.includes('analysis') || lowered.includes('prd')) return 'ANALYSIS';
  if (lowered.includes('dev') || lowered.includes('code') || lowered.includes('tech') || lowered.includes('arch')) return 'DEV';
  return '';
};

const workflowStatusToCoreStageStatus = (status?: string): CoreStageStatus => {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'completed' || normalized === 'skipped') return 'completed';
  if (normalized === 'running' || normalized === 'reviewing') return 'active';
  if (normalized === 'failed') return 'blocked';
  return 'pending';
};

const workflowStatusToProgress = (status?: string, isCurrent?: boolean): number => {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'completed' || normalized === 'skipped') return 100;
  if (normalized === 'reviewing') return 88;
  if (normalized === 'running') return 68;
  if (normalized === 'failed') return 38;
  if (isCurrent) return 22;
  return 0;
};
const isProjectNotFoundError = (error: unknown) =>
  /project not found/i.test(error instanceof Error ? error.message : String(error ?? ''));

const Badge = ({ children, variant = 'default' }: any) => {
  const variants: any = {
    default: 'bg-white/5 text-slate-400 border-border-subtle',
    primary: 'bg-primary/20 text-primary border-primary/20',
    accent: 'bg-accent/20 text-accent border-accent/20',
    warning: 'bg-warning/20 text-warning border-warning/20',
    danger: 'bg-danger/20 text-danger border-danger/20',
  };
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border', variants[variant])}>
      {children}
    </span>
  );
};

const statusVariantByStage = (status: CoreStageStatus) => {
  if (status === 'completed') return 'primary';
  if (status === 'active') return 'accent';
  if (status === 'blocked' || status === 'rejected') return 'danger';
  return 'default';
};

const statusVariantByWorkflowStage = (status: string) => {
  if (status === 'completed') return 'primary';
  if (status === 'running' || status === 'reviewing') return 'accent';
  if (status === 'failed') return 'danger';
  if (status === 'skipped') return 'warning';
  return 'default';
};

const workflowExecutionEngineLabel = (engine?: string) => {
  const normalized = String(engine || '').trim().toLowerCase();
  if (normalized === 'hybrid') return 'Hermes + OpenClaw';
  if (normalized === 'hermes') return 'Hermes';
  if (normalized === 'openclaw') return 'OpenClaw';
  if (normalized === 'manual') return '手动';
  return '未知';
};

const workflowExecutionEngineVariant = (engine?: string) => {
  const normalized = String(engine || '').trim().toLowerCase();
  if (normalized === 'hybrid') return 'accent';
  if (normalized === 'hermes') return 'primary';
  if (normalized === 'openclaw') return 'default';
  if (normalized === 'manual') return 'warning';
  return 'default';
};

const workflowAgentEngineLabel = (engine?: string) => {
  const normalized = String(engine || '').trim().toLowerCase();
  if (normalized === 'hermes') return 'Hermes';
  if (normalized === 'openclaw') return 'OpenClaw';
  return 'Unknown';
};

const workflowAgentEngineVariant = (engine?: string) => {
  const normalized = String(engine || '').trim().toLowerCase();
  if (normalized === 'hermes') return 'primary';
  if (normalized === 'openclaw') return 'default';
  return 'warning';
};

const workflowCollaborationStatusVariant = (status?: string) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'failed') return 'danger';
  return 'accent';
};

const workflowCollaborationSourceLabel = (source?: string) => {
  const normalized = String(source || '').trim().toLowerCase();
  if (normalized === 'workflow_v2_companion') return '协作复核';
  if (normalized === 'workflow_v2_companion_error') return '协作复核异常';
  return normalized || 'unknown';
};

const formatLocalDateTime = (value?: string | null) => {
  const text = String(value || '').trim();
  if (!text) {
    return '-';
  }
  const timestamp = new Date(text).getTime();
  if (!Number.isFinite(timestamp)) {
    return text;
  }
  return new Date(timestamp).toLocaleString('zh-CN');
};

const statusVariantByDeliverable = (status: DeliverableStatus) => {
  if (status === 'approved') return 'primary';
  if (status === 'submitted') return 'accent';
  if (status === 'rejected') return 'danger';
  return 'default';
};

const statusVariantByTask = (status: string) => {
  if (status === 'done' || status === 'completed' || status === 'Completed') return 'primary';
  if (status === 'in_progress' || status === 'pending_review' || status === 'pending_approval' || status === 'In Progress') return 'accent';
  if (status === 'blocked' || status === 'rejected' || status === 'cancelled' || status === 'Blocked') return 'danger';
  return 'default';
};

const statusVariantByDelegation = (status: TaskDelegation['status']) => {
  if (status === 'completed') return 'primary';
  if (status === 'running') return 'accent';
  if (status === 'failed' || status === 'expired' || status === 'cancelled') return 'danger';
  return 'default';
};

const gitlabStatusBadge = (status?: string) => {
  if (status === 'synced') {
    return { label: 'GitLab 已同步', variant: 'primary' as const };
  }
  if (status === 'sync_required') {
    return { label: 'GitLab 待同步', variant: 'warning' as const };
  }
  return { label: 'GitLab 未同步', variant: 'default' as const };
};

const parseExecutionProtocolFailureHint = (
  details: Record<string, unknown> | undefined,
  fallbackMessage: string,
): ProtocolFailureHint => {
  const failure = details && typeof details.protocolFailure === 'object' && details.protocolFailure
    ? (details.protocolFailure as {
        primaryCategory?: unknown;
        categories?: unknown;
        summary?: unknown;
        missingChecks?: unknown;
      })
    : null;
  const precheck = details && typeof details.protocolGatePrecheck === 'object' && details.protocolGatePrecheck
    ? (details.protocolGatePrecheck as {
        protocolChecks?: unknown;
        contentChecks?: unknown;
        blockingIssues?: unknown;
      })
    : null;
  const categories = Array.isArray(failure?.categories)
    ? (failure?.categories as unknown[])
        .map((item) => String(item || '').trim() as ProtocolFailureCategory)
        .filter((item) => item.length > 0)
    : [];
  const missingChecks: string[] = [];

  if (Array.isArray(failure?.missingChecks)) {
    for (const item of failure.missingChecks as Array<Record<string, unknown>>) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const label = String(item.label || '').trim();
      const detail = String(item.detail || '').trim();
      const text = detail ? `${label}: ${detail}` : label;
      if (text) {
        missingChecks.push(text);
      }
      if (missingChecks.length >= 4) {
        break;
      }
    }
  }

  if (missingChecks.length === 0 && precheck) {
    const protocolChecks = Array.isArray(precheck.protocolChecks)
      ? (precheck.protocolChecks as Array<Record<string, unknown>>)
      : [];
    for (const check of protocolChecks) {
      const passed = Boolean(check.passed);
      if (passed) {
        continue;
      }
      const label = String(check.label || '').trim();
      const detail = String(check.detail || '').trim();
      const text = detail ? `${label}: ${detail}` : label;
      if (text) {
        missingChecks.push(text);
      }
      if (missingChecks.length >= 4) {
        break;
      }
    }
    if (missingChecks.length < 4) {
      const contentChecks = Array.isArray(precheck.contentChecks)
        ? (precheck.contentChecks as Array<Record<string, unknown>>)
        : [];
      for (const check of contentChecks) {
        if (Boolean(check.passed)) {
          continue;
        }
        const label = String(check.label || '').trim();
        if (label) {
          missingChecks.push(label);
        }
        if (missingChecks.length >= 4) {
          break;
        }
      }
    }
    if (missingChecks.length < 4) {
      const blockingIssues = Array.isArray(precheck.blockingIssues)
        ? (precheck.blockingIssues as unknown[]).map((item) => String(item || '').trim()).filter(Boolean)
        : [];
      for (const issue of blockingIssues) {
        missingChecks.push(`阻断项: ${issue}`);
        if (missingChecks.length >= 4) {
          break;
        }
      }
    }
  }

  return {
    title: String(failure?.summary || fallbackMessage || '当前阶段未通过执行协议门禁，请先修复阻断项'),
    categories: categories.length > 0 ? categories : ['unknown'],
    missingChecks,
  };
};

const PROTOCOL_FAILURE_CATEGORY_LABELS: Record<ProtocolFailureCategory, string> = {
  runtime_or_model: '模型/运行时',
  collaboration: '协作交接',
  skill_evidence: '技能证据',
  content_evidence: '内容证据',
  stage_template: '模板结构',
  unknown: '待定位',
};

const ProjectRoom = ({
  projectId,
  addToast,
  onRefreshData,
  onProjectMissing,
}: {
  projectId: string | null;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onRefreshData?: () => Promise<void>;
  onProjectMissing?: (projectId: string) => void;
}) => {
  const [activeTab, setActiveTab] = useState<ProjectRoomTab>('任务');
  const [detail, setDetail] = useState<ProjectDetailResponse | null>(null);
  const [workflowOverview, setWorkflowOverview] = useState<WorkflowProjectOverview | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [isLoadingWorkflowOverview, setIsLoadingWorkflowOverview] = useState(false);
  const [isIntervening, setIsIntervening] = useState(false);
  const [isReviewingStage, setIsReviewingStage] = useState(false);
  const [stageReviewAction, setStageReviewAction] = useState<'approve' | 'reject' | null>(null);
  const [projectActionHint, setProjectActionHint] = useState<string | null>(null);
  const [protocolFailureHint, setProtocolFailureHint] = useState<ProtocolFailureHint | null>(null);
  const [isSubmittingDesignReview, setIsSubmittingDesignReview] = useState(false);
  const [isDesignReviewOpen, setIsDesignReviewOpen] = useState(false);
  const [isAcceptanceReportOpen, setIsAcceptanceReportOpen] = useState(false);
  const [isLoadingAcceptanceReport, setIsLoadingAcceptanceReport] = useState(false);
  const [isExportingAcceptanceReport, setIsExportingAcceptanceReport] = useState(false);
  const [isArchivingAcceptanceReport, setIsArchivingAcceptanceReport] = useState(false);
  const [acceptanceReport, setAcceptanceReport] = useState<ProjectAcceptanceReport | null>(null);
  const [finalArtifacts, setFinalArtifacts] = useState<ProjectFinalArtifactsReport | null>(null);
  const [finalArtifactsLoadError, setFinalArtifactsLoadError] = useState<string | null>(null);
  const [executionRecords, setExecutionRecords] = useState<ProjectExecutionRecord[]>([]);
  const [isLoadingFinalArtifacts, setIsLoadingFinalArtifacts] = useState(false);
  const [isTriggeringFinalArtifacts, setIsTriggeringFinalArtifacts] = useState(false);
  const [isLoadingExecutions, setIsLoadingExecutions] = useState(false);
  const [downloadingArtifactKey, setDownloadingArtifactKey] = useState<string | null>(null);
  const [downloadingDeliverableId, setDownloadingDeliverableId] = useState<string | null>(null);
  const [signoffStageFilter, setSignoffStageFilter] = useState<string>('all');
  const [signoffDecisionFilter, setSignoffDecisionFilter] = useState<'all' | 'approved' | 'rejected' | 'pending'>('all');
  const [signoffTimeFilter, setSignoffTimeFilter] = useState<'all' | '24h' | '7d' | '30d'>('all');
  const [signoffKeyword, setSignoffKeyword] = useState('');
  const [isExportingSignoffMarkdown, setIsExportingSignoffMarkdown] = useState(false);
  const [isExportingSignoffCsv, setIsExportingSignoffCsv] = useState(false);
  const [isCopyingSignoffLink, setIsCopyingSignoffLink] = useState(false);
  const [sseLogs, setSseLogs] = useState<ProjectRoomLogItem[]>([]);
  const [workflowOverviewFilter, setWorkflowOverviewFilter] = useState<'all' | 'current' | 'running' | 'reviewing' | 'completed' | 'failed' | 'gate_blocked'>('all');
  const [expandedWorkflowStageIds, setExpandedWorkflowStageIds] = useState<string[]>([]);
  const [workflowCollaborationRoleFilters, setWorkflowCollaborationRoleFilters] = useState<Record<string, string>>({});
  const signoffAutoOpenKeyRef = useRef<string | null>(null);
  const projectRoomUrlStateAppliedRef = useRef<string | null>(null);
  const completedProjectAutoTabRef = useRef<string | null>(null);
  const lastConnectedLogAtRef = useRef<number>(0);
  const projectRefreshTimerRef = useRef<number | null>(null);
  const [previewDeliverable, setPreviewDeliverable] = useState<ProjectDeliverable | null>(null);
  const [requiredActionLoadingId, setRequiredActionLoadingId] = useState<string | null>(null);
  const [prepDraftDiscussion, setPrepDraftDiscussion] = useState('');
  const [prepDraftAnalysis, setPrepDraftAnalysis] = useState('');
  const [prepDraftRawRequirements, setPrepDraftRawRequirements] = useState('');
  const [prepDraftPrd, setPrepDraftPrd] = useState('');
  const [prepDraftDebateSummary, setPrepDraftDebateSummary] = useState('');
  const [prepConfirmNotes, setPrepConfirmNotes] = useState('');
  const [isSavingPrepDraft, setIsSavingPrepDraft] = useState(false);
  const [isConfirmingPrepDraft, setIsConfirmingPrepDraft] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskDelegationBundles, setTaskDelegationBundles] = useState<Record<string, TaskDelegationBundle>>({});
  const [isLoadingTaskDelegations, setIsLoadingTaskDelegations] = useState(false);
  const [taskActionLoadingKey, setTaskActionLoadingKey] = useState<string | null>(null);
  const [ownerDraft, setOwnerDraft] = useState('');
  const [reviewerDraft, setReviewerDraft] = useState('');
  const [coordinationModeDraft, setCoordinationModeDraft] = useState('single_owner');
  const [delegationTitleDraft, setDelegationTitleDraft] = useState('');
  const [delegationGoalDraft, setDelegationGoalDraft] = useState('');
  const [delegationModeDraft, setDelegationModeDraft] = useState<TaskDelegation['mode']>('research');
  const [delegationTargetDraft, setDelegationTargetDraft] = useState('');
  const [delegationTimeoutDraft, setDelegationTimeoutDraft] = useState('900');
  const [delegationRetryDraft, setDelegationRetryDraft] = useState('1');
  const [designReviewHistory, setDesignReviewHistory] = useState<Array<{
    submittedAt: string;
    reviewer: string;
    approved: boolean;
    visualDirection: string;
  }>>([]);
  const [designReviewForm, setDesignReviewForm] = useState<ProjectRoomDesignReviewForm>(createDefaultDesignReviewForm());
  const missingProjectHandledRef = useRef<string | null>(null);
  const addToastRef = useRef(addToast);
  const onProjectMissingRef = useRef(onProjectMissing);
  const lastDetailErrorRef = useRef<{ projectId: string; message: string; at: number } | null>(null);
  const lastWorkflowErrorRef = useRef<{ projectId: string; message: string; at: number } | null>(null);

  useEffect(() => {
    addToastRef.current = addToast;
  }, [addToast]);

  useEffect(() => {
    onProjectMissingRef.current = onProjectMissing;
  }, [onProjectMissing]);

  const project = useMemo(
    () =>
      projects.find((p) => p.id === projectId) ||
      projects[0] || {
        id: projectId || '',
        name: projectId ? `项目 ${projectId}` : '暂无项目',
        description: '',
        status: 'Planning' as ProjectStatus,
        phase: projectId ? '加载中' : '待开始',
        progress: 0,
        owner: '',
        agents: [],
      },
    [projectId, projects],
  );

  const effectiveProjectId = projectId || project.id;

  useEffect(() => {
    setDesignReviewForm(createDefaultDesignReviewForm());
    setIsDesignReviewOpen(false);
    setProtocolFailureHint(null);
    setWorkflowOverviewFilter('all');
    setExpandedWorkflowStageIds([]);
    setWorkflowCollaborationRoleFilters({});
  }, [effectiveProjectId]);

  const loadProjectDetail = useCallback(async () => {
    if (!effectiveProjectId) {
      setDetail(null);
      return;
    }
    setLoadingDetail(true);
    try {
      const next = await projectsApi.getDetail(effectiveProjectId);
      setDetail(next);
      const nextRequiredActions = Array.isArray(next.requiredActions) ? next.requiredActions : [];
      if (nextRequiredActions.length === 0) {
        setProtocolFailureHint(null);
      }
      if (missingProjectHandledRef.current === effectiveProjectId) {
        missingProjectHandledRef.current = null;
      }
    } catch (error) {
      if (isProjectNotFoundError(error)) {
        if (missingProjectHandledRef.current !== effectiveProjectId) {
          missingProjectHandledRef.current = effectiveProjectId;
          onProjectMissingRef.current?.(effectiveProjectId);
        }
        return;
      }
      const message = `加载项目详情失败: ${error instanceof Error ? error.message : '未知错误'}`;
      const now = Date.now();
      const previous = lastDetailErrorRef.current;
      const isDuplicate = previous
        && previous.projectId === effectiveProjectId
        && previous.message === message
        && now - previous.at < 10000;
      if (!isDuplicate) {
        addToastRef.current(message, 'error');
        lastDetailErrorRef.current = { projectId: effectiveProjectId, message, at: now };
      }
    } finally {
      setLoadingDetail(false);
    }
  }, [effectiveProjectId]);

  useEffect(() => {
    void loadProjectDetail();
  }, [loadProjectDetail]);

  const loadWorkflowOverview = useCallback(async () => {
    if (!effectiveProjectId) {
      setWorkflowOverview(null);
      return;
    }
    setIsLoadingWorkflowOverview(true);
    try {
      const next = await workflowsApi.getProjectOverview(effectiveProjectId);
      setWorkflowOverview(next);
    } catch (error) {
      const requestError = error instanceof ApiRequestError ? error : null;
      const code = String(requestError?.code || '').toUpperCase();
      const isExpectedEmpty =
        requestError?.status === 404
        || code === 'NOT_FOUND'
        || code === 'SERVICE_UNAVAILABLE';
      if (isExpectedEmpty) {
        setWorkflowOverview(null);
        return;
      }

      const message = `加载工作流视图失败: ${error instanceof Error ? error.message : '未知错误'}`;
      const now = Date.now();
      const previous = lastWorkflowErrorRef.current;
      const isDuplicate = previous
        && previous.projectId === effectiveProjectId
        && previous.message === message
        && now - previous.at < 10000;
      if (!isDuplicate) {
        addToastRef.current(message, 'error');
        lastWorkflowErrorRef.current = { projectId: effectiveProjectId, message, at: now };
      }
    } finally {
      setIsLoadingWorkflowOverview(false);
    }
  }, [effectiveProjectId]);

  useEffect(() => {
    void loadWorkflowOverview();
  }, [loadWorkflowOverview]);

  const loadTaskDelegations = useCallback(
    async (taskId: string, options?: { silent?: boolean }) => {
      if (!taskId) {
        return null;
      }
      if (!options?.silent) {
        setIsLoadingTaskDelegations(true);
      }
      try {
        const next = await tasksApi.listDelegations(taskId);
        setTaskDelegationBundles((current) => ({ ...current, [taskId]: next }));
        return next;
      } catch (error) {
        if (!options?.silent) {
          addToastRef.current(
            `加载任务 delegation 失败: ${error instanceof Error ? error.message : '未知错误'}`,
            'error',
          );
        }
        return null;
      } finally {
        if (!options?.silent) {
          setIsLoadingTaskDelegations(false);
        }
      }
    },
    [],
  );

  const detailTasks = useMemo(
    () =>
      Array.isArray(detail?.tasks)
        ? detail.tasks.map((item) => ({
            id: item.id,
            title: item.title,
            agent: roleLabel(item.assignee),
            status: toTaskStatus(item.status),
            progress: toTaskProgress(item.status),
            rawStatus: item.status,
            description: item.description,
            stageType: item.stageType,
            projectId: item.projectId,
            assigneeRoleId: item.assignee,
            priority: item.priority,
            ownerAgentId: item.ownerAgentId,
            reviewAgentId: item.reviewAgentId,
            coordinationMode: item.coordinationMode,
            delegationPolicy: item.delegationPolicy,
            syncPolicy: item.syncPolicy,
            contextScope: item.contextScope,
            parentTaskId: item.parentTaskId,
            pendingDelegationCount: Number(item.pendingDelegationCount || 0),
            lastDelegatedAt: item.lastDelegatedAt,
            blockedReason: item.blockedReason,
            nextAction: item.nextAction,
            dependencies: item.dependencies,
            delegationSummary: item.delegationSummary,
            gitlab: item.gitlab,
            createdAt: item.updatedAt,
            updatedAt: item.updatedAt,
          }) satisfies ProjectRoomTaskItem)
        : [],
    [detail?.tasks],
  );

  const workflowScopedStageTypes = useMemo(() => {
    const nodes = Array.isArray(workflowOverview?.nodes) ? workflowOverview.nodes : [];
    if (nodes.length === 0) {
      return null;
    }
    const scoped = new Set<string>();
    for (const node of nodes) {
      const stageType = workflowTemplateToCoreStage(node.templateKey);
      if (stageType) {
        scoped.add(stageType);
      }
    }
    return scoped.size > 0 ? scoped : null;
  }, [workflowOverview?.nodes]);

  const effectiveProjectTasks = useMemo(() => {
    if (!workflowScopedStageTypes) {
      return detailTasks;
    }
    return detailTasks.filter((task) => workflowScopedStageTypes.has(String(task.stageType || '').trim().toUpperCase()));
  }, [detailTasks, workflowScopedStageTypes]);

  useEffect(() => {
    if (effectiveProjectTasks.length === 0) {
      setSelectedTaskId(null);
      return;
    }
    if (!selectedTaskId || !effectiveProjectTasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(effectiveProjectTasks[0].id);
    }
  }, [effectiveProjectTasks, selectedTaskId]);

  const selectedTask = useMemo(
    () => effectiveProjectTasks.find((task) => task.id === selectedTaskId) || effectiveProjectTasks[0] || null,
    [effectiveProjectTasks, selectedTaskId],
  );

  useEffect(() => {
    if (!selectedTask) {
      setOwnerDraft('');
      setReviewerDraft('');
      setCoordinationModeDraft('single_owner');
      setDelegationTitleDraft('');
      setDelegationGoalDraft('');
      setDelegationTargetDraft('');
      setDelegationModeDraft('research');
      setDelegationTimeoutDraft('900');
      setDelegationRetryDraft('1');
      return;
    }

    const defaultOwner = selectedTask.ownerAgentId || DEFAULT_AGENT_BY_ROLE[selectedTask.assigneeRoleId] || '';
    setOwnerDraft(defaultOwner);
    setReviewerDraft(selectedTask.reviewAgentId || '');
    setCoordinationModeDraft(selectedTask.coordinationMode || 'single_owner');
    setDelegationTargetDraft(defaultOwner);
    setDelegationModeDraft('research');
    setDelegationTimeoutDraft('900');
    setDelegationRetryDraft('1');
  }, [selectedTask]);

  useEffect(() => {
    if (!selectedTask) {
      return;
    }
    void loadTaskDelegations(selectedTask.id, {
      silent: Boolean(taskDelegationBundles[selectedTask.id]),
    });
  }, [loadTaskDelegations, selectedTask?.id, selectedTask?.updatedAt]);

  const selectedTaskBundle = selectedTask ? taskDelegationBundles[selectedTask.id] : undefined;
  const selectedTaskDelegations = selectedTaskBundle?.delegations || [];
  const readyForReviewBlockReason = useMemo(
    () =>
      getReadyForReviewBlockReason(
        selectedTask
          ? {
              reviewAgentId: selectedTask.reviewAgentId,
              pendingDelegationCount: selectedTask.pendingDelegationCount,
              blockedReason: selectedTask.blockedReason,
            }
          : null,
      ),
    [selectedTask],
  );

  const taskAgentOptions = useMemo(() => {
    const options = new Map<string, { id: string; label: string }>();

    agents.forEach((agentItem) => {
      const agentId = String(agentItem.id || '').trim();
      if (!agentId) {
        return;
      }
      options.set(agentId, {
        id: agentId,
        label: `${agentItem.name || agentId} (${agentId})`,
      });
    });

    detail?.team?.forEach((roleId) => {
      const agentId = DEFAULT_AGENT_BY_ROLE[String(roleId || '').trim()];
      if (!agentId) {
        return;
      }
      options.set(agentId, {
        id: agentId,
        label: `${roleLabel(roleId)} (${agentId})`,
      });
    });

    [selectedTask?.ownerAgentId, selectedTask?.reviewAgentId, DEFAULT_AGENT_BY_ROLE[selectedTask?.assigneeRoleId || '']]
      .filter(Boolean)
      .forEach((agentId) => {
        const normalized = String(agentId || '').trim();
        if (!normalized) {
          return;
        }
        if (!options.has(normalized)) {
          options.set(normalized, {
            id: normalized,
            label: normalized,
          });
        }
      });

    return Array.from(options.values()).sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'));
  }, [detail?.team, selectedTask]);

  const runTaskAction = useCallback(
    async (
      loadingKey: string,
      action: () => Promise<void>,
      successMessage: string,
      options?: {
        reloadDetail?: boolean;
        reloadDelegationsTaskId?: string;
      },
    ) => {
      setTaskActionLoadingKey(loadingKey);
      try {
        await action();
        if (options?.reloadDetail !== false) {
          await loadProjectDetail();
        }
        if (options?.reloadDelegationsTaskId) {
          await loadTaskDelegations(options.reloadDelegationsTaskId, { silent: true });
        }
        addToastRef.current(successMessage, 'success');
      } catch (error) {
        addToastRef.current(
          normalizeTaskActionError(error),
          'error',
        );
      } finally {
        setTaskActionLoadingKey(null);
      }
    },
    [loadProjectDetail, loadTaskDelegations],
  );

  const handleSaveTaskCoordination = useCallback(async () => {
    if (!selectedTask) {
      return;
    }

    const currentOwner = selectedTask.ownerAgentId || DEFAULT_AGENT_BY_ROLE[selectedTask.assigneeRoleId] || '';
    const nextOwner = ownerDraft.trim();
    const nextReviewer = reviewerDraft.trim();
    const nextMode = coordinationModeDraft.trim();
    const hasChanges =
      nextOwner !== currentOwner
      || nextReviewer !== String(selectedTask.reviewAgentId || '').trim()
      || nextMode !== String(selectedTask.coordinationMode || 'single_owner').trim();

    if (!hasChanges) {
      addToastRef.current('任务协作配置没有变化', 'info');
      return;
    }

    if (!nextOwner) {
      addToastRef.current('请先选择任务 owner', 'error');
      return;
    }

    await runTaskAction(
      `task-config:${selectedTask.id}`,
      async () => {
        if (nextOwner !== currentOwner) {
          await tasksApi.assignOwner(selectedTask.id, nextOwner);
        }
        if (nextReviewer !== String(selectedTask.reviewAgentId || '').trim()) {
          await tasksApi.setReviewer(selectedTask.id, nextReviewer || null);
        }
        if (nextMode !== String(selectedTask.coordinationMode || 'single_owner').trim()) {
          await tasksApi.setCoordinationMode(selectedTask.id, {
            coordinationMode: nextMode,
            delegationPolicy: selectedTask.delegationPolicy,
            syncPolicy: selectedTask.syncPolicy,
            contextScope: selectedTask.contextScope,
          });
        }
      },
      '任务协作配置已更新',
      { reloadDelegationsTaskId: selectedTask.id },
    );
  }, [coordinationModeDraft, ownerDraft, reviewerDraft, runTaskAction, selectedTask]);

  const handleCreateDelegation = useCallback(async () => {
    if (!selectedTask) {
      return;
    }
    const goal = delegationGoalDraft.trim();
    if (!goal) {
      addToastRef.current('请填写 delegation goal', 'error');
      return;
    }

    const requestedByAgentId =
      ownerDraft.trim()
      || selectedTask.ownerAgentId
      || DEFAULT_AGENT_BY_ROLE[selectedTask.assigneeRoleId]
      || '';

    if (!requestedByAgentId) {
      addToastRef.current('当前任务还没有可用 owner，请先配置 owner', 'error');
      return;
    }

    await runTaskAction(
      `task-delegation-create:${selectedTask.id}`,
      async () => {
        await tasksApi.createDelegation(selectedTask.id, {
          requestedByAgentId,
          title: delegationTitleDraft.trim() || undefined,
          goal,
          mode: delegationModeDraft,
          targetAgentId: delegationTargetDraft.trim() || undefined,
          timeoutSec: Number.isFinite(Number(delegationTimeoutDraft)) ? Number(delegationTimeoutDraft) : undefined,
          maxRetries: Number.isFinite(Number(delegationRetryDraft)) ? Number(delegationRetryDraft) : undefined,
        });
      },
      'delegation 已创建',
      { reloadDelegationsTaskId: selectedTask.id },
    );

    setDelegationTitleDraft('');
    setDelegationGoalDraft('');
  }, [
    delegationGoalDraft,
    delegationModeDraft,
    delegationRetryDraft,
    delegationTargetDraft,
    delegationTimeoutDraft,
    delegationTitleDraft,
    ownerDraft,
    runTaskAction,
    selectedTask,
  ]);

  const handleSyncTaskGitlab = useCallback(async () => {
    if (!selectedTask) {
      return;
    }
    setTaskActionLoadingKey(`task-sync:${selectedTask.id}`);
    try {
      const result = await tasksApi.syncGitlab(selectedTask.id);
      await loadProjectDetail();
      if (result?.skipped) {
        addToastRef.current(`未同步 GitLab: ${result.reason || '未命中同步策略'}`, 'info');
      } else if (result?.ok && result.data) {
        addToastRef.current(
          `GitLab 已同步: ${result.data.projectPath}#${result.data.issueIid}`,
          'success',
        );
      } else {
        addToastRef.current(result?.message || 'GitLab 同步失败', 'error');
      }
    } catch (error) {
      addToastRef.current(
        error instanceof Error ? error.message : 'GitLab 同步失败',
        'error',
      );
    } finally {
      setTaskActionLoadingKey(null);
    }
  }, [loadProjectDetail, selectedTask]);

  const groupedProjectTasks = useMemo(() => {
    const grouped = new Map<string, typeof effectiveProjectTasks>();
    for (const task of effectiveProjectTasks) {
      const stageType = String((task as ProjectRoomTaskItem).stageType || 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN';
      const list = grouped.get(stageType) || [];
      list.push(task);
      grouped.set(stageType, list);
    }

    const orderedStageTypes = [
      ...STAGE_ORDER.filter((stage) => grouped.has(stage)),
      ...Array.from(grouped.keys()).filter((stage) => !STAGE_ORDER.includes(stage)),
    ];

    return orderedStageTypes.map((stageType) => ({
      stageType,
      tasks: grouped.get(stageType) || [],
    }));
  }, [effectiveProjectTasks]);

  const stageItems = useMemo(() => {
    if (workflowOverview?.stages && workflowOverview.stages.length > 0) {
      const byCoreStage = new Map<string, {
        type: ProjectDetailResponse['stages'][number]['type'];
        label: string;
        assignee: string;
        status: CoreStageStatus;
        progress: number;
        startedAt?: string;
        endedAt?: string;
      }>();

      for (const stage of workflowOverview.stages) {
        const coreStage = workflowTemplateToCoreStage(stage.templateKey) || 'INIT';
        const mappedStatus = workflowStatusToCoreStageStatus(stage.status);
        const mappedProgress = workflowStatusToProgress(stage.status, stage.isCurrent);
        const assignee = stage.assignedAgents?.[0]
          || stage.assignedAgentProfiles?.[0]?.agentId
          || (coreStage === 'ANALYSIS'
            ? 'ROLE_ANALYST'
            : coreStage === 'DESIGN'
              ? 'ROLE_DESIGN'
              : coreStage === 'DEV'
                ? 'ROLE_DEV'
                : coreStage === 'ACCEPT'
                  ? 'ROLE_QA'
                  : 'ROLE_PM');
        const nextItem = {
          type: coreStage as ProjectDetailResponse['stages'][number]['type'],
          label: workflowTemplateLabel(stage.templateKey),
          assignee,
          status: mappedStatus,
          progress: mappedProgress,
          startedAt: stage.startedAt || undefined,
          endedAt: stage.completedAt || undefined,
        };
        const existing = byCoreStage.get(coreStage);
        if (!existing) {
          byCoreStage.set(coreStage, nextItem);
          continue;
        }
        const existingPriority = Number(existing.status === 'active') * 100 + existing.progress;
        const nextPriority = Number(nextItem.status === 'active') * 100 + nextItem.progress;
        if (nextPriority >= existingPriority) {
          byCoreStage.set(coreStage, nextItem);
        }
      }

      const workflowDriven = Array.from(byCoreStage.values())
        .sort((a, b) => STAGE_ORDER.indexOf(a.type) - STAGE_ORDER.indexOf(b.type));
      if (workflowDriven.length > 0) {
        return workflowDriven;
      }
    }

    if (Array.isArray(detail?.stages) && detail.stages.length > 0) {
      return [...detail.stages].sort((a, b) => STAGE_ORDER.indexOf(a.type) - STAGE_ORDER.indexOf(b.type));
    }
    return [
      {
        type: (detail?.currentStage || 'INIT') as ProjectDetailResponse['stages'][number]['type'],
        label: project.phase || '当前阶段',
        assignee: project.owner || '未分配',
        status: 'active' as CoreStageStatus,
        progress: project.progress || 0,
        startedAt: undefined,
        endedAt: undefined,
      },
    ];
  }, [detail?.currentStage, detail?.stages, project.phase, project.owner, project.progress, workflowOverview]);

  const rawDeliverables = useMemo(() => (Array.isArray(detail?.deliverables) ? detail.deliverables : []), [detail?.deliverables]);

  const deliverables = useMemo(() => {
    if (rawDeliverables.length <= 1) {
      return rawDeliverables;
    }

    const latestByCore = new Map<string, ProjectDeliverable>();
    for (const item of rawDeliverables) {
      const coreKey = `${item.stageType}::${normalizeDeliverableNameKey(item.name)}`;
      const existing = latestByCore.get(coreKey);
      if (!existing) {
        latestByCore.set(coreKey, item);
        continue;
      }

      const itemTime = toDeliverableTimestamp(item.updatedAt);
      const existingTime = toDeliverableTimestamp(existing.updatedAt);
      if (itemTime > existingTime) {
        latestByCore.set(coreKey, item);
        continue;
      }
      if (itemTime < existingTime) {
        continue;
      }

      const itemVersion = toDeliverableVersion(item.version);
      const existingVersion = toDeliverableVersion(existing.version);
      if (itemVersion > existingVersion) {
        latestByCore.set(coreKey, item);
        continue;
      }
      if (itemVersion < existingVersion) {
        continue;
      }

      const itemStatusRank = DELIVERABLE_STATUS_RANK[item.status] || 0;
      const existingStatusRank = DELIVERABLE_STATUS_RANK[existing.status] || 0;
      if (itemStatusRank > existingStatusRank) {
        latestByCore.set(coreKey, item);
      }
    }

    return [...latestByCore.values()].sort((a, b) => {
      const timeDelta = toDeliverableTimestamp(b.updatedAt) - toDeliverableTimestamp(a.updatedAt);
      if (timeDelta !== 0) {
        return timeDelta;
      }
      return toDeliverableVersion(b.version) - toDeliverableVersion(a.version);
    });
  }, [rawDeliverables]);
  const stitchArtifacts = useMemo<ProjectStitchArtifact[]>(
    () => (Array.isArray(detail?.stitchArtifacts) ? detail.stitchArtifacts : []),
    [detail?.stitchArtifacts],
  );

  const timelineItems = useMemo(
    () =>
      Array.isArray(detail?.timeline)
        ? [...detail.timeline].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        : [],
    [detail?.timeline],
  );

  const timelineEvents = useMemo(() => {
    if (timelineItems.length > 0) {
      return timelineItems;
    }

    const stageEvents = stageItems.flatMap((stage) => {
      const events: Array<{
        id: string;
        timestamp: string;
        agentId?: string;
        type: string;
        title: string;
        content: string;
        priority: 'low' | 'normal' | 'high' | 'urgent';
      }> = [];

      if (stage.startedAt) {
        events.push({
          id: `stage-start-${stage.type}-${stage.startedAt}`,
          timestamp: stage.startedAt,
          agentId: stage.assignee,
          type: 'stage_started',
          title: `${stage.label || STAGE_LABELS[stage.type] || stage.type} 开始`,
          content: `阶段负责人 ${roleLabel(stage.assignee)} 开始推进该阶段，当前完成度 ${stage.progress}%`,
          priority: stage.status === 'blocked' ? 'high' : 'normal',
        });
      }

      if (stage.endedAt) {
        events.push({
          id: `stage-end-${stage.type}-${stage.endedAt}`,
          timestamp: stage.endedAt,
          agentId: stage.assignee,
          type: 'stage_completed',
          title: `${stage.label || STAGE_LABELS[stage.type] || stage.type} 完成`,
          content: `阶段已结束，状态为 ${CORE_STAGE_STATUS_LABELS[stage.status] || stage.status}`,
          priority: stage.status === 'rejected' || stage.status === 'blocked' ? 'high' : 'low',
        });
      }

      return events;
    });

    const taskEvents = effectiveProjectTasks.map((task) => {
      const taskRecord = task as ProjectRoomTaskItem & { updatedAt?: string; createdAt?: string };
      const timestamp = taskRecord.updatedAt || taskRecord.createdAt || new Date().toISOString();
      return {
        id: `task-${task.id}-${timestamp}`,
        timestamp,
        agentId: task.agent,
        type: 'task_update',
        title: `任务状态更新: ${task.title}`,
        content: `当前状态 ${task.status}，进度 ${task.progress}%`,
        priority: task.status === 'Blocked' ? 'urgent' as const : task.status === 'In Progress' ? 'normal' as const : 'low' as const,
      };
    });

    const deliverableEvents = rawDeliverables.map((item) => ({
      id: `deliverable-${item.id}-${item.updatedAt}`,
      timestamp: item.updatedAt,
      agentId: item.createdBy,
      type: 'deliverable_update',
      title: `交付物更新: ${item.name}`,
      content: `${STAGE_LABELS[item.stageType] || item.stageType} · ${DELIVERABLE_STATUS_LABELS[item.status]}`,
      priority: item.status === 'rejected' ? 'high' as const : item.status === 'submitted' ? 'normal' as const : 'low' as const,
    }));

    return [...stageEvents, ...taskEvents, ...deliverableEvents]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 60);
  }, [timelineItems, stageItems, effectiveProjectTasks, rawDeliverables]);

  const deliverablesByStage = useMemo(() => {
    const grouped = new Map<string, typeof deliverables>();
    for (const item of deliverables) {
      const list = grouped.get(item.stageType) || [];
      list.push(item);
      grouped.set(item.stageType, list);
    }
    return grouped;
  }, [deliverables]);

  const deliverableById = useMemo(() => {
    const mapping = new Map<string, ProjectDeliverable>();
    deliverables.forEach((item) => {
      mapping.set(item.id, item);
    });
    return mapping;
  }, [deliverables]);

  const quickFinalArtifacts = useMemo(() => {
    const artifacts = finalArtifacts?.artifacts || [];
    if (artifacts.length <= 1) {
      return artifacts;
    }
    const score = (artifact: FinalArtifactItem) => (
      (artifact.required ? 20 : 0)
      + (artifact.ready ? 10 : 0)
      + (artifact.source === 'link' ? 4 : 0)
      + (isPrototypeLikeArtifact(artifact) ? 8 : 0)
    );
    return [...artifacts].sort((a, b) => score(b) - score(a));
  }, [finalArtifacts]);
  const prototypeFinalArtifact = useMemo(() => {
    const artifacts = quickFinalArtifacts;
    const interactive = artifacts.find((item) => item.key === 'interactive_prototype');
    if (interactive) {
      return interactive;
    }
    const dappOfficial = artifacts.find(
      (item) => item.key === 'official_site' && /\/generated\/liquidity-dapp-mvp\/[a-z0-9._-]+\.html/i.test(String(item.url || '')),
    );
    if (dappOfficial) {
      return dappOfficial;
    }
    return artifacts.find((item) => isPrototypeLikeArtifact(item));
  }, [quickFinalArtifacts]);
  const finalArtifactsGeneration = finalArtifacts?.generation;
  const finalArtifactsRunning = finalArtifactsGeneration?.status === 'queued' || finalArtifactsGeneration?.status === 'running';
  const finalArtifactsGenerationText = useMemo(() => {
    if (!finalArtifactsGeneration) {
      return null;
    }
    const progress = Number.isFinite(finalArtifactsGeneration.progress) ? Math.max(0, Math.min(100, Math.round(finalArtifactsGeneration.progress))) : 0;
    const step = finalArtifactsGeneration.step || '处理中';
    if (finalArtifactsGeneration.status === 'failed') {
      return `生成失败：${finalArtifactsGeneration.error || finalArtifactsGeneration.message || '未知错误'}`;
    }
    if (finalArtifactsGeneration.status === 'completed') {
      return '最终产物已生成完成';
    }
    return `${step} · ${progress}%`;
  }, [finalArtifactsGeneration]);

  const executionSummary = useMemo(() => {
    const total = executionRecords.length;
    const success = executionRecords.filter((item) => item.status === 'success').length;
    const failed = executionRecords.filter((item) => item.status === 'failed').length;
    const realModelRuns = executionRecords.filter(
      (item) => item.provider === 'openai-compatible' || item.runtimeMode === 'openai-compatible',
    ).length;
    return { total, success, failed, realModelRuns };
  }, [executionRecords]);

  const latestExecutionByStage = useMemo(() => {
    const mapping = new Map<string, ProjectExecutionRecord>();
    const timestampByStage = new Map<string, number>();
    executionRecords.forEach((record) => {
      const stageType = String(record.stageType || '').trim();
      if (!stageType) {
        return;
      }
      const timestamp = new Date(record.updatedAt || record.createdAt).getTime();
      const normalizedTimestamp = Number.isFinite(timestamp) ? timestamp : 0;
      const previous = timestampByStage.get(stageType) ?? -1;
      if (normalizedTimestamp >= previous) {
        timestampByStage.set(stageType, normalizedTimestamp);
        mapping.set(stageType, record);
      }
    });
    return mapping;
  }, [executionRecords]);

  const formatExecutionModelLabel = (record?: ProjectExecutionRecord | null) => {
    if (!record) {
      return '未知模型';
    }
    const model = String(record.model || '').trim() || 'n/a';
    const provider = String(record.provider || record.runtimeMode || '').trim() || 'unknown';
    return `${model} (${provider})`;
  };

  const isDesignLikeText = (text: string) => /(design|设计|视觉|交互|官网|landing|ui|ux)/i.test(String(text || '').toLowerCase());

  const getStageModelLabel = (stageType?: string) => {
    if (!stageType) {
      return '未知模型';
    }
    return formatExecutionModelLabel(latestExecutionByStage.get(stageType));
  };

  const getArtifactModelLabel = (artifact: FinalArtifactItem) => {
    if (artifact.stageType) {
      return getStageModelLabel(artifact.stageType);
    }
    const isDesignArtifact = isDesignLikeText(`${artifact.category} ${artifact.name}`);
    if (isDesignArtifact) {
      return getStageModelLabel('DESIGN');
    }
    return '未知模型';
  };

  const projectAgents = useMemo(() => {
    const selected = new Map<string, { id: string; name: string; role: string }>();

    const registerById = (rawId?: string) => {
      const memberId = String(rawId || '').trim();
      if (!memberId || selected.has(memberId)) {
        return;
      }

      const byExactId = agents.find((agent) => String(agent.id || '').trim() === memberId);
      if (byExactId) {
        selected.set(memberId, {
          id: memberId,
          name: byExactId.name || roleLabel(memberId),
          role: byExactId.role || roleLabel(memberId),
        });
        return;
      }

      const byRoleId = agents.find((agent) => String(agent.role || '').trim() === memberId);
      if (byRoleId) {
        selected.set(memberId, {
          id: memberId,
          name: byRoleId.name || roleLabel(memberId),
          role: roleLabel(memberId),
        });
        return;
      }

      selected.set(memberId, {
        id: memberId,
        name: roleLabel(memberId),
        role: roleLabel(memberId),
      });
    };

    detail?.team?.forEach((memberId) => registerById(memberId));
    detail?.stages?.forEach((stage) => registerById(stage.assignee));
    detail?.tasks?.forEach((task) => registerById(task.assignee));

    if (selected.size === 0) {
      project.agents.forEach((memberId) => registerById(memberId));
    }

    if (selected.size === 0) {
      const linkedAgentNames = new Set(
        effectiveProjectTasks.map((task) => String(task.agent || '').trim()).filter(Boolean),
      );
      agents.forEach((agent) => {
        if (linkedAgentNames.has(agent.id) || linkedAgentNames.has(agent.name) || linkedAgentNames.has(agent.role)) {
          registerById(agent.id);
        }
      });
    }

    return [...selected.values()];
  }, [detail?.stages, detail?.tasks, detail?.team, effectiveProjectTasks, project.agents]);

  const projectBlockedCount = effectiveProjectTasks.filter((task) => task.status === 'Blocked').length;

  const tabStats = useMemo(() => ({
    任务: effectiveProjectTasks.length,
    阶段: stageItems.length,
    交付物: deliverables.length,
    时间线: timelineEvents.length,
  }), [effectiveProjectTasks.length, stageItems.length, deliverables.length, timelineEvents.length]);

  const requiredActions = useMemo<ProjectRequiredAction[]>(
    () => (Array.isArray(detail?.requiredActions) ? detail.requiredActions : []),
    [detail?.requiredActions],
  );
  const postCreatePrep = detail?.postCreatePrep;
  const isPostCreatePrepBlocked = Boolean(postCreatePrep?.required && !postCreatePrep?.completed);
  const postCreatePrepRequiredAction = useMemo<ProjectRequiredAction | null>(() => {
    const action = requiredActions.find((item) => item.action === 'run_post_create_prep');
    if (action) {
      return action;
    }
    if (!isPostCreatePrepBlocked) {
      return null;
    }
    return {
      id: 'post-create-prep-required-fallback',
      severity: 'critical',
      title: '项目创建后需求预备未完成',
      detail: postCreatePrep?.missingItems?.length
        ? `缺失项：${postCreatePrep.missingItems.join('；')}`
        : '请先完成多Agent讨论结论与需求回填',
      action: 'run_post_create_prep',
      ctaLabel: '执行创建后需求预备',
    };
  }, [isPostCreatePrepBlocked, postCreatePrep?.missingItems, requiredActions]);

  useEffect(() => {
    const draft = postCreatePrep?.draft;
    setPrepDraftDiscussion(String(draft?.discussion || ''));
    setPrepDraftAnalysis(String(draft?.analysis || ''));
    setPrepDraftRawRequirements(String(draft?.rawRequirements || ''));
    setPrepDraftPrd(String(draft?.prd || ''));
    setPrepDraftDebateSummary(String(draft?.debateSummary || ''));
    setPrepConfirmNotes(String(draft?.confirmationNotes || ''));
  }, [
    postCreatePrep?.draft?.analysis,
    postCreatePrep?.draft?.debateSummary,
    postCreatePrep?.draft?.discussion,
    postCreatePrep?.draft?.prd,
    postCreatePrep?.draft?.rawRequirements,
    postCreatePrep?.draft?.confirmationNotes,
  ]);

  const designReviewRequiredAction = useMemo(
    () => requiredActions.find((action) => action.action === 'open_design_review') || null,
    [requiredActions],
  );

  const latestDesignExecution = useMemo(() => {
    const designRuns = executionRecords
      .filter((record) => String(record.stageType || '').toUpperCase() === 'DESIGN')
      .slice()
      .sort((left, right) => {
        const leftTime = new Date(left.updatedAt || left.createdAt).getTime();
        const rightTime = new Date(right.updatedAt || right.createdAt).getTime();
        return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
      });
    return designRuns[0] || null;
  }, [executionRecords]);

  const isDesignPhase = useMemo(() => {
    const stageType = detail?.currentStage || stageItems.find((stage) => stage.status === 'active')?.type || stageItems[0]?.type;
    return stageType === 'DESIGN' && String(detail?.status || '').toLowerCase() === 'active';
  }, [detail?.currentStage, detail?.status, stageItems]);

  const getTaskTimestamp = (task: ProjectRoomTaskItem) => {
    const taskRecord = task as ProjectRoomTaskItem & { updatedAt?: string; createdAt?: string };
    const rawDate = taskRecord.updatedAt || taskRecord.createdAt || new Date().toISOString();
    const date = new Date(rawDate);
    return Number.isNaN(date.getTime()) ? Date.now() : date.getTime();
  };

  const formatProjectLogTime = (date: string | Date | null | undefined) => {
    if (!date) {
      return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    const normalized = new Date(date);
    if (Number.isNaN(normalized.getTime())) {
      return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    return normalized.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const toLogTimestamp = (raw: string | Date | number | null | undefined) => {
    if (!raw && raw !== 0) {
      return Date.now();
    }
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? Date.now() : date.getTime();
  };

  const summarizeText = (text: string, max = 66) => {
    const normalized = String(text || '').trim().replace(/\s+/g, ' ');
    if (normalized.length <= max) {
      return normalized;
    }
    return `${normalized.slice(0, max)}...`;
  };

  useEffect(() => {
    setSseLogs([]);
    lastConnectedLogAtRef.current = 0;
  }, [effectiveProjectId]);

  const appendSseLog = useCallback((item: ProjectRoomLogItem) => {
    setSseLogs((prev) => {
      if (prev[0]?.id === item.id) {
        return prev;
      }
      return [item, ...prev].slice(0, 20);
    });
  }, []);

  const scheduleProjectRefresh = useCallback(() => {
    if (projectRefreshTimerRef.current !== null) {
      window.clearTimeout(projectRefreshTimerRef.current);
    }
    projectRefreshTimerRef.current = window.setTimeout(() => {
      projectRefreshTimerRef.current = null;
      void loadProjectDetail();
      void loadWorkflowOverview();
      void onRefreshData?.();
    }, 300);
  }, [loadProjectDetail, loadWorkflowOverview, onRefreshData]);

  const handleProjectRoomSseEvent = useCallback((event: MessageEvent) => {
    const eventType = event.type || 'message';
    let payload: Record<string, unknown> = {};
    try {
      payload = event.data ? JSON.parse(event.data) as Record<string, unknown> : {};
    } catch {
      payload = {};
    }

    if (eventType === 'heartbeat') {
      return;
    }

    let actor = '系统';
    let message = '';
    let type: ProjectRoomLogItem['type'] = 'primary';
    let timestamp = toLogTimestamp(payload.timestamp as string | undefined);

    if (eventType === 'connected') {
      const now = Date.now();
      if (now - lastConnectedLogAtRef.current < 15000) {
        return;
      }
      lastConnectedLogAtRef.current = now;
      timestamp = now;
      message = '实时通道已连接（SSE）';
    } else if (eventType === 'snapshot') {
      return;
    } else if (eventType === 'task_update') {
      const payloadProjectId = typeof payload.projectId === 'string' ? String(payload.projectId) : '';
      if (!payloadProjectId || payloadProjectId !== effectiveProjectId) {
        return;
      }
      timestamp = toLogTimestamp(payload.timestamp as string | undefined);
      const blocked = Number(payload.blockedTasks ?? 0);
      const inProgress = Number(payload.inProgressTasks ?? 0);
      const total = Number(payload.totalTasks ?? 0);
      message = blocked > 0
        ? `任务变化: 共 ${total} 条，进行中 ${inProgress}，阻塞 ${blocked}（需处理）`
        : `任务变化: 共 ${total} 条，进行中 ${inProgress}，阻塞 ${blocked}`;
      type = Number(payload.blockedTasks ?? 0) > 0 ? 'danger' : 'accent';
      scheduleProjectRefresh();
    } else if (eventType === 'project_progress') {
      timestamp = toLogTimestamp(payload.timestamp as string | undefined);
      const changedProjects = Array.isArray(payload.changedProjects)
        ? payload.changedProjects as Array<{ projectId?: string; name?: string; progress?: number; blockedTaskCount?: number }>
        : [];
      const related = changedProjects.find((item) => item.projectId === effectiveProjectId) || changedProjects[0];
      if (!related) {
        return;
      }
      actor = related.name || '项目';
      message = `进度更新: ${related.progress ?? 0}% · 阻塞 ${related.blockedTaskCount ?? 0}`;
      type = Number(related.blockedTaskCount ?? 0) > 0 ? 'danger' : 'accent';
      scheduleProjectRefresh();
    } else if (eventType === 'agent_status') {
      return;
    } else if (eventType === 'system') {
      return;
    } else {
      return;
    }

    appendSseLog({
      id: `${eventType}-${timestamp}-${actor}-${message}`,
      time: formatProjectLogTime(new Date(timestamp)),
      actor,
      message,
      type,
      timestamp,
    });
  }, [appendSseLog, effectiveProjectId, scheduleProjectRefresh]);

  const sseEvents = useMemo(
    () => ['connected', 'snapshot', 'task_update', 'project_progress', 'agent_status', 'system', 'heartbeat'],
    [],
  );

  useSSE('/api/openclaw/events', {
    withCredentials: true,
    events: sseEvents,
    onEvent: handleProjectRoomSseEvent,
  });

  useEffect(() => {
    return () => {
      if (projectRefreshTimerRef.current !== null) {
        window.clearTimeout(projectRefreshTimerRef.current);
      }
    };
  }, []);

  const recentLogs = useMemo(() => {
    const logs: ProjectRoomLogItem[] = [];

    effectiveProjectTasks
      .filter((task) => task.status === 'Blocked')
      .slice(0, 2)
      .forEach((task) => {
        const timestamp = getTaskTimestamp(task);
        logs.push({
          id: `task-blocked-${task.id}-${timestamp}`,
          time: formatProjectLogTime(new Date(timestamp)),
          actor: task.agent || '系统',
          message: `任务"${task.title}"被阻塞`,
          type: 'danger',
          timestamp,
        });
      });

    effectiveProjectTasks
      .filter((task) => task.status === 'In Progress')
      .slice(0, 3)
      .forEach((task) => {
        const timestamp = getTaskTimestamp(task);
        logs.push({
          id: `task-progress-${task.id}-${timestamp}`,
          time: formatProjectLogTime(new Date(timestamp)),
          actor: task.agent || '系统',
          message: `正在执行: ${task.title}`,
          type: 'accent',
          timestamp,
        });
      });

    timelineEvents.slice(0, 8).forEach((item) => {
      const timestamp = toLogTimestamp(item.timestamp);
      logs.push({
        id: `timeline-${item.id}-${timestamp}`,
        time: formatProjectLogTime(new Date(timestamp)),
        actor: roleLabel(item.agentId),
        message: `${item.title}${item.content ? ` · ${summarizeText(item.content)}` : ''}`,
        type: item.priority === 'urgent' || item.priority === 'high' ? 'danger' : item.priority === 'normal' ? 'accent' : 'primary',
        timestamp,
      });
    });

    executionRecords.slice(0, 8).forEach((record) => {
      const timestamp = toLogTimestamp(record.updatedAt || record.createdAt);
      const modelLabel = record.model || record.provider || record.runtimeMode || 'unknown';
      logs.push({
        id: `execution-${record.id}-${timestamp}`,
        time: formatProjectLogTime(new Date(timestamp)),
        actor: roleLabel(record.role),
        message: `${record.status === 'failed' ? '执行失败' : '执行完成'}: ${record.action} · ${modelLabel}`,
        type: record.status === 'failed' ? 'danger' : 'accent',
        timestamp,
      });
    });

    return [...logs, ...sseLogs].sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
  }, [effectiveProjectTasks, executionRecords, sseLogs, timelineEvents]);

  const projectDeliverablesSide = useMemo<SideDeliverableItem[]>(() => {
    if (deliverables.length > 0) {
      return deliverables.slice(0, 8).map((item) => ({
        id: item.id,
        name: item.name,
        type: `${STAGE_LABELS[item.stageType] || item.stageType} · ${DELIVERABLE_STATUS_LABELS[item.status]}`,
        size: new Date(item.updatedAt).toLocaleDateString('zh-CN'),
        deliverable: item,
      }));
    }

    const mapped = effectiveProjectTasks.slice(0, 6).map((task) => ({
      id: task.id,
      name: `${task.title}${task.status === 'Completed' ? '.md' : ''}`,
      type: task.status === 'Completed' ? '交付文档' : task.status === 'Blocked' ? '阻塞项' : '进行项',
      size: `${Math.max(1, Math.round((task.title.length + (task.progress || 0)) / 6))}kb`,
    }));

    return mapped.length > 0 ? mapped : [{ id: 'empty', name: '暂无交付物', type: '等待任务推进', size: '-' }];
  }, [deliverables, effectiveProjectTasks]);

  const currentStageType = stageItems.find((stage) => stage.status === 'active')?.type || detail?.currentStage || stageItems[0]?.type;
  const currentStageLabel = STAGE_LABELS[currentStageType || ''] || currentStageType || '当前阶段';
  const currentStageDeliverables = currentStageType ? (deliverablesByStage.get(currentStageType) || []) : [];
  const workflowStageRows = workflowOverview?.stages || [];
  const workflowStageSummary = workflowStageRows.reduce(
    (acc, item) => {
      acc.total += 1;
      if (item.status === 'completed') acc.completed += 1;
      if (item.status === 'running' || item.status === 'reviewing') acc.inProgress += 1;
      if (item.status === 'failed') acc.failed += 1;
      if (item.gate && item.gate.violationCount > 0) acc.gateBlocked += 1;
      if (item.isCurrent) acc.current += 1;
      return acc;
    },
    { total: 0, completed: 0, inProgress: 0, failed: 0, gateBlocked: 0, current: 0 },
  );
  const visibleWorkflowStageRows = useMemo(() => {
    if (workflowOverviewFilter === 'all') return workflowStageRows;
    if (workflowOverviewFilter === 'current') return workflowStageRows.filter((item) => item.isCurrent);
    if (workflowOverviewFilter === 'gate_blocked') {
      return workflowStageRows.filter((item) => item.gate && item.gate.violationCount > 0);
    }
    return workflowStageRows.filter((item) => item.status === workflowOverviewFilter);
  }, [workflowOverviewFilter, workflowStageRows]);
  const toggleWorkflowStageDetails = useCallback((stageId: string) => {
    setExpandedWorkflowStageIds((current) => {
      if (current.includes(stageId)) {
        return current.filter((item) => item !== stageId);
      }
      return [...current, stageId];
    });
  }, []);
  const setWorkflowStageCollaborationRoleFilter = useCallback((stageId: string, roleId: string) => {
    setWorkflowCollaborationRoleFilters((current) => ({
      ...current,
      [stageId]: roleId,
    }));
  }, []);
  const handleFocusWorkflowStageDeliverables = useCallback((templateKey: string) => {
    const stageType = workflowTemplateToCoreStage(templateKey);
    if (!stageType) {
      addToastRef.current(`未能识别阶段 ${workflowTemplateLabel(templateKey)} 对应的交付物分组`, 'info');
      return;
    }
    const items = deliverablesByStage.get(stageType) || [];
    if (items.length === 0) {
      addToastRef.current(`当前未找到 ${STAGE_LABELS[stageType] || stageType} 阶段交付物`, 'info');
      return;
    }
    setActiveTab('交付物');
    setPreviewDeliverable(items[0]);
    addToastRef.current(`已定位到 ${STAGE_LABELS[stageType] || stageType} 阶段交付物`, 'success');
  }, [deliverablesByStage]);
  const handleFocusWorkflowStageKnowledge = useCallback((
    templateKey: string,
    options?: { query?: string; agentId?: string; focusId?: string; focusTitle?: string; focusRole?: string },
  ) => {
    if (typeof window === 'undefined') {
      return;
    }
    if (!project.id) {
      addToastRef.current('当前项目不可用，无法跳转知识库', 'error');
      return;
    }
    const url = new URL(window.location.href);
    const params = url.searchParams;
    params.set('app_tab', 'knowledge-hub');
    params.set('kb_scope', 'project');
    params.set('kb_project_id', project.id);
    params.set('kb_stage', templateKey);
    const query = String(options?.query || '').trim();
    const agentId = String(options?.agentId || '').trim();
    const focusId = String(options?.focusId || '').trim();
    const focusTitle = String(options?.focusTitle || '').trim();
    const focusRole = String(options?.focusRole || '').trim();
    if (query) {
      params.set('kb_query', query);
    } else {
      params.delete('kb_query');
    }
    if (agentId) {
      params.set('kb_agent_id', agentId);
    } else {
      params.delete('kb_agent_id');
    }
    if (focusId) {
      params.set('kb_focus_id', focusId);
    } else {
      params.delete('kb_focus_id');
    }
    if (focusTitle) {
      params.set('kb_focus_title', focusTitle);
    } else {
      params.delete('kb_focus_title');
    }
    if (focusRole) {
      params.set('kb_focus_role', focusRole);
    } else {
      params.delete('kb_focus_role');
    }
    const nextUrl = `${url.pathname}${url.search ? url.search : ''}${url.hash}`;
    window.history.replaceState(window.history.state, '', nextUrl);
    if (typeof PopStateEvent === 'function') {
      window.dispatchEvent(new PopStateEvent('popstate'));
    } else {
      window.dispatchEvent(new Event('popstate'));
    }
    addToastRef.current(
      `已切换到知识中心（阶段: ${workflowTemplateLabel(templateKey)}${query ? ` / query: ${query}` : ''}）`,
      'success',
    );
  }, [project.id]);
  const getDeliverableContentLength = (item: Pick<ProjectDeliverable, 'content'>) => String(item.content || '').trim().length;
  const isDeliverableReadable = (item: Pick<ProjectDeliverable, 'content'>) => getDeliverableContentLength(item) >= 120;
  const isVisualPreviewDeliverable = (item: Pick<ProjectDeliverable, 'name' | 'stageType'>) =>
    item.stageType === 'DESIGN'
    && /视觉定稿|视觉设计稿|单页预览|mockup|wireframe|design preview|preview\.html/i.test(String(item.name || ''));
  const extractDeliverableHtmlPreview = (content?: string) => {
    const source = String(content || '');
    const fencedPattern = /(?:^|\n)```html[ \t]*\n([\s\S]*?)\n```(?:\n|$)/gi;
    let matched: RegExpExecArray | null;
    let lastCandidate: string | null = null;
    while ((matched = fencedPattern.exec(source)) !== null) {
      const candidate = String(matched[1] || '').trim();
      if (/(<!doctype html|<html[\s>]|<body[\s>]|<main[\s>]|<section[\s>]|<div[\s>])/i.test(candidate)) {
        lastCandidate = candidate;
      }
    }
    if (lastCandidate) {
      return lastCandidate;
    }
    if (/(<!doctype html|<html[\s>])/i.test(source)) {
      return source.trim();
    }
    return null;
  };
  const extractDeliverableImagePreview = (content?: string) => {
    const source = String(content || '');
    const markdownImage = source.match(/!\[[^\]]*\]\((https?:\/\/[^\s)]+|data:image\/[^\s)]+)\)/i);
    if (markdownImage && markdownImage[1]) {
      return markdownImage[1];
    }
    const rawImage = source.match(/(https?:\/\/[^\s"'()]+\.(?:png|jpg|jpeg|webp|gif|svg))/i);
    if (rawImage && rawImage[1]) {
      return rawImage[1];
    }
    return null;
  };
  const extractDeliverableStitchMeta = (content?: string) => {
    const source = String(content || '');
    if (!source) {
      return null;
    }
    const lines = source.split(/\r?\n/);
    const stitchMeta: {
      status?: string;
      provider?: string;
      generatedAt?: string;
      requestedAt?: string;
      projectId?: string;
      screenId?: string;
      htmlUrl?: string;
      imageUrl?: string;
      prompt?: string;
      error?: string;
      hint?: string;
      retryPolicy?: string;
      executor?: string;
    } = {};
    const keyMap: Record<string, keyof typeof stitchMeta> = {
      stitchstatus: 'status',
      status: 'status',
      状态: 'status',
      provider: 'provider',
      generatedat: 'generatedAt',
      requestedat: 'requestedAt',
      stitchprojectid: 'projectId',
      projectid: 'projectId',
      stitchscreenid: 'screenId',
      screenid: 'screenId',
      stitchhtmlurl: 'htmlUrl',
      htmlurl: 'htmlUrl',
      stitchimageurl: 'imageUrl',
      imageurl: 'imageUrl',
      stitchprompt: 'prompt',
      prompt: 'prompt',
      stitcherror: 'error',
      stitchhint: 'hint',
      stitchretrypolicy: 'retryPolicy',
      stitchexecutor: 'executor',
    };
    for (const line of lines) {
      const normalizedLine = line.trim().replace(/^[-*]\s*/, '');
      const separatorIndex = normalizedLine.includes('：')
        ? normalizedLine.indexOf('：')
        : normalizedLine.indexOf(':');
      if (separatorIndex <= 0) {
        continue;
      }
      const key = normalizedLine.slice(0, separatorIndex).trim().toLowerCase();
      const mappedKey = keyMap[key];
      if (!mappedKey) {
        continue;
      }
      const value = String(normalizedLine.slice(separatorIndex + 1) || '').trim();
      if (!value) {
        continue;
      }
      stitchMeta[mappedKey] = value;
    }
    if (!stitchMeta.projectId && !stitchMeta.htmlUrl && !stitchMeta.imageUrl && !stitchMeta.status) {
      return null;
    }
    if (!stitchMeta.status && (stitchMeta.htmlUrl || stitchMeta.imageUrl)) {
      stitchMeta.status = 'ready';
    }
    return stitchMeta;
  };
  const previewDeliverableStitchMeta = useMemo(
    () => (previewDeliverable ? extractDeliverableStitchMeta(previewDeliverable.content) : null),
    [previewDeliverable],
  );
  const activeStitchPreview = useMemo(() => {
    // 视觉稿预览仅使用 DESIGN 交付物内绑定的 Stitch 元信息，避免误用其他阶段或历史项目的稿件。
    return previewDeliverableStitchMeta || null;
  }, [previewDeliverableStitchMeta]);
  const previewDeliverableHtmlInline = useMemo(
    () => (previewDeliverable ? extractDeliverableHtmlPreview(previewDeliverable.content) : null),
    [previewDeliverable],
  );
  const previewDeliverableHtmlUrl = useMemo(
    () => {
      if (activeStitchPreview?.htmlUrl) {
        try {
          const parsed = new URL(activeStitchPreview.htmlUrl, window.location.origin);
          if (parsed.origin !== window.location.origin) {
            return null;
          }
        } catch {
          return null;
        }
        return activeStitchPreview.htmlUrl;
      }
      return null;
    },
    [activeStitchPreview],
  );
  const shouldPreferRemoteVisualPreview = useMemo(() => {
    if (!previewDeliverable || !isVisualPreviewDeliverable(previewDeliverable)) {
      return false;
    }
    const stitchStatus = String(activeStitchPreview?.status || '').toLowerCase();
    if (stitchStatus !== 'ready') {
      return false;
    }
    if (!previewDeliverableHtmlUrl && !activeStitchPreview?.imageUrl) {
      return false;
    }
    const remoteUpdatedAt = toDeliverableTimestamp(activeStitchPreview?.generatedAt || activeStitchPreview?.requestedAt);
    const deliverableUpdatedAt = toDeliverableTimestamp(previewDeliverable.updatedAt);
    if (!remoteUpdatedAt || !deliverableUpdatedAt) {
      return true;
    }
    return remoteUpdatedAt >= deliverableUpdatedAt;
  }, [activeStitchPreview, previewDeliverable, previewDeliverableHtmlUrl]);
  const useInlineVisualPreview = useMemo(
    () => Boolean(previewDeliverableHtmlInline) && !shouldPreferRemoteVisualPreview,
    [previewDeliverableHtmlInline, shouldPreferRemoteVisualPreview],
  );
  const previewDeliverableHtml = useMemo(
    () => (useInlineVisualPreview ? previewDeliverableHtmlInline : (previewDeliverableHtmlUrl || previewDeliverableHtmlInline)),
    [previewDeliverableHtmlInline, previewDeliverableHtmlUrl, useInlineVisualPreview],
  );
  const previewDeliverableImage = useMemo(() => {
    const parsed = previewDeliverable ? extractDeliverableImagePreview(previewDeliverable.content) : null;
    return parsed || activeStitchPreview?.imageUrl || null;
  }, [activeStitchPreview, previewDeliverable]);
  const previewDeliverableStitchStatusLabel = useMemo(() => {
    if (!activeStitchPreview?.status) {
      return null;
    }
    const status = activeStitchPreview.status.toLowerCase();
    if (status === 'ready') {
      return 'Stitch 已就绪';
    }
    if (status === 'pending') {
      return 'Stitch 生成中';
    }
    if (status === 'degraded') {
      return 'Stitch 降级';
    }
    return `Stitch: ${activeStitchPreview.status}`;
  }, [activeStitchPreview]);
  const previewDeliverableStitchStatusVariant = useMemo(() => {
    const status = String(activeStitchPreview?.status || '').toLowerCase();
    if (status === 'ready') {
      return 'primary' as const;
    }
    if (status === 'pending') {
      return 'warning' as const;
    }
    if (status === 'degraded') {
      return 'danger' as const;
    }
    return 'default' as const;
  }, [activeStitchPreview]);
  const canRenderVisualPreview = Boolean(
    previewDeliverable
    && isVisualPreviewDeliverable(previewDeliverable)
    && (previewDeliverableHtml || previewDeliverableImage),
  );

  const getStageAcceptance = (stageType: string) => {
    const items = deliverablesByStage.get(stageType) || [];
    if (items.length === 0) {
      return { label: '无交付物', variant: 'default' as const };
    }
    if (detail?.pendingApproval && detail.currentStage === stageType) {
      return { label: '待你验收', variant: 'warning' as const };
    }
    if (items.some((item) => item.status === 'rejected')) {
      return { label: '存在驳回项', variant: 'danger' as const };
    }
    if (items.every((item) => item.status === 'approved')) {
      return { label: '验收通过', variant: 'primary' as const };
    }
    if (items.some((item) => item.status === 'submitted')) {
      return { label: '待处理提交', variant: 'accent' as const };
    }
    return { label: '进行中', variant: 'default' as const };
  };

  const getStageDeliverableStats = (stageType: string) => {
    const items = deliverablesByStage.get(stageType) || [];
    const approved = items.filter((item) => item.status === 'approved').length;
    const rejected = items.filter((item) => item.status === 'rejected').length;
    const submitted = items.filter((item) => item.status === 'submitted').length;
    const draft = items.filter((item) => item.status === 'draft').length;
    const readable = items.filter((item) => isDeliverableReadable(item)).length;
    const unreadable = Math.max(0, items.length - readable);
    return { total: items.length, approved, rejected, submitted, draft, readable, unreadable };
  };

  const signoffStageOptions = useMemo(() => {
    if (!acceptanceReport) {
      return [];
    }
    return Array.from(
      new Set(
        acceptanceReport.signoffHistory
          .map((item) => item.stageType || 'UNKNOWN')
          .filter(Boolean),
      ),
    );
  }, [acceptanceReport]);

  const filteredSignoffHistory = useMemo(() => {
    if (!acceptanceReport) {
      return [];
    }

    const keyword = signoffKeyword.trim().toLowerCase();
    const now = Date.now();
    const timeWindowMs =
      signoffTimeFilter === '24h'
        ? 24 * 60 * 60 * 1000
        : signoffTimeFilter === '7d'
          ? 7 * 24 * 60 * 60 * 1000
          : signoffTimeFilter === '30d'
            ? 30 * 24 * 60 * 60 * 1000
            : null;

    return acceptanceReport.signoffHistory.filter((item) => {
      const stagePass = signoffStageFilter === 'all'
        ? true
        : (item.stageType || 'UNKNOWN') === signoffStageFilter;
      const decisionPass = signoffDecisionFilter === 'all'
        ? true
        : item.decision === signoffDecisionFilter;
      const keywordPass = keyword
        ? [item.stageLabel, item.stageType || '', item.decision, item.actor, item.reason]
          .join(' ')
          .toLowerCase()
          .includes(keyword)
        : true;
      const timePass = (() => {
        if (!timeWindowMs) {
          return true;
        }
        const ts = new Date(item.timestamp).getTime();
        if (Number.isNaN(ts)) {
          return false;
        }
        return now - ts <= timeWindowMs;
      })();
      return stagePass && decisionPass && keywordPass && timePass;
    });
  }, [acceptanceReport, signoffDecisionFilter, signoffKeyword, signoffStageFilter, signoffTimeFilter]);

  const readSignoffFiltersFromUrl = () => {
    if (typeof window === 'undefined') {
      return null;
    }

    const params = new URLSearchParams(window.location.search);
    const urlProjectId = params.get('signoff_project_id') || params.get('project_id');
    if (urlProjectId && project.id && urlProjectId !== project.id) {
      return null;
    }

    const stage = params.get('signoff_stage') || 'all';
    const decision = params.get('signoff_decision') || 'all';
    const time = params.get('signoff_time') || 'all';
    const keyword = params.get('signoff_keyword') || '';

    const safeDecision = ['all', 'approved', 'rejected', 'pending'].includes(decision)
      ? (decision as 'all' | 'approved' | 'rejected' | 'pending')
      : 'all';
    const safeTime = ['all', '24h', '7d', '30d'].includes(time)
      ? (time as 'all' | '24h' | '7d' | '30d')
      : 'all';

    return {
      stage: stage || 'all',
      decision: safeDecision,
      time: safeTime,
      keyword: keyword.trim(),
    };
  };

  const shouldAutoOpenAcceptanceReportFromUrl = () => {
    if (typeof window === 'undefined' || !project.id) {
      return false;
    }

    const params = new URLSearchParams(window.location.search);
    const urlProjectId = params.get('signoff_project_id') || params.get('project_id');
    if (!urlProjectId || urlProjectId !== project.id) {
      return false;
    }

    if (params.get('pr_modal') === 'acceptance-report') {
      return true;
    }

    return ['signoff_stage', 'signoff_decision', 'signoff_time', 'signoff_keyword']
      .some((key) => params.has(key));
  };

  const readProjectRoomStateFromUrl = () => {
    if (typeof window === 'undefined') {
      return null;
    }

    const params = new URLSearchParams(window.location.search);
    const urlProjectId = params.get('signoff_project_id') || params.get('project_id');
    if (urlProjectId && project.id && urlProjectId !== project.id) {
      return null;
    }

    const tabParam = params.get('pr_tab') as ProjectRoomTabParam | null;
    const modalParam = params.get('pr_modal');
    const tab = tabParam && tabParam in PROJECT_ROOM_PARAM_TO_TAB
      ? PROJECT_ROOM_PARAM_TO_TAB[tabParam]
      : null;
    const modal = modalParam === 'acceptance-report' ? 'acceptance-report' : null;

    return { tab, modal };
  };

  const syncProjectRoomUrlState = useCallback((options?: { withSignoffFilters?: boolean; modal?: 'acceptance-report' | null }) => {
    if (typeof window === 'undefined' || !project.id) {
      return;
    }

    const url = new URL(window.location.href);
    const params = url.searchParams;
    const withFilters = Boolean(options?.withSignoffFilters);

    params.set('app_tab', 'project-room');
    params.set('project_id', project.id);
    params.set('signoff_project_id', project.id);
    params.set('pr_tab', PROJECT_ROOM_TAB_TO_PARAM[activeTab]);

    if (options?.modal === 'acceptance-report') {
      params.set('pr_modal', 'acceptance-report');
    } else if (options?.modal === null) {
      params.delete('pr_modal');
    }

    if (withFilters) {
      params.set('signoff_stage', signoffStageFilter);
      params.set('signoff_decision', signoffDecisionFilter);
      params.set('signoff_time', signoffTimeFilter);
      const keyword = signoffKeyword.trim();
      if (keyword) {
        params.set('signoff_keyword', keyword);
      } else {
        params.delete('signoff_keyword');
      }
    }

    const nextSearch = params.toString();
    const nextUrl = `${url.pathname}${nextSearch ? `?${nextSearch}` : ''}${url.hash}`;
    window.history.replaceState(window.history.state, '', nextUrl);
  }, [activeTab, project.id, signoffDecisionFilter, signoffKeyword, signoffStageFilter, signoffTimeFilter]);

  const loadFinalArtifacts = useCallback(async (options?: { silent?: boolean }) => {
    if (!effectiveProjectId) {
      setFinalArtifacts(null);
      setFinalArtifactsLoadError(null);
      return;
    }
    setIsLoadingFinalArtifacts(true);
    try {
      const report = await projectsApi.getFinalArtifacts(effectiveProjectId);
      setFinalArtifacts(report);
      setFinalArtifactsLoadError(null);
    } catch (error) {
      setFinalArtifacts(null);
      if (isProjectNotFoundError(error)) {
        return;
      }
      const message = error instanceof Error ? error.message : '未知错误';
      setFinalArtifactsLoadError(message);
      if (!options?.silent) {
        addToast(`加载最终验收成果失败: ${message}`, 'error');
      }
    } finally {
      setIsLoadingFinalArtifacts(false);
    }
  }, [effectiveProjectId, addToast]);

  const loadExecutions = useCallback(async (options?: { silent?: boolean }) => {
    if (!effectiveProjectId) {
      setExecutionRecords([]);
      return;
    }
    setIsLoadingExecutions(true);
    try {
      const report = await projectsApi.getExecutions(effectiveProjectId, 120);
      setExecutionRecords(report.executions || []);
    } catch (error) {
      setExecutionRecords([]);
      if (isProjectNotFoundError(error)) {
        return;
      }
      if (!options?.silent) {
        addToast(`加载执行证据失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      }
    } finally {
      setIsLoadingExecutions(false);
    }
  }, [effectiveProjectId, addToast]);

  const refreshProjectView = useCallback(async () => {
    await onRefreshData?.();
    await Promise.all([
      loadProjectDetail(),
      loadWorkflowOverview(),
      loadFinalArtifacts(),
      loadExecutions({ silent: true }),
    ]);
  }, [onRefreshData, loadExecutions, loadFinalArtifacts, loadProjectDetail, loadWorkflowOverview]);

  useEffect(() => {
    void loadFinalArtifacts({ silent: true });
  }, [loadFinalArtifacts]);

  useEffect(() => {
    if (!effectiveProjectId || !finalArtifactsRunning) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      void loadFinalArtifacts({ silent: true });
    }, 2500);
    return () => {
      window.clearInterval(timer);
    };
  }, [effectiveProjectId, finalArtifactsGeneration?.jobId, finalArtifactsRunning, loadFinalArtifacts]);

  useEffect(() => {
    if (!effectiveProjectId || !detail || detail.status !== 'completed') {
      return;
    }
    if (completedProjectAutoTabRef.current === effectiveProjectId) {
      return;
    }
    if (activeTab === '任务') {
      setActiveTab('交付物');
    }
    completedProjectAutoTabRef.current = effectiveProjectId;
  }, [activeTab, detail, effectiveProjectId]);

  const handleGenerateFinalArtifacts = useCallback(async (force = false) => {
    if (!effectiveProjectId) {
      return;
    }
    setIsTriggeringFinalArtifacts(true);
    try {
      await projectsApi.generateFinalArtifacts(effectiveProjectId, force);
      setFinalArtifactsLoadError(null);
      addToast('最终验收产物生成任务已启动', 'success');
      await loadFinalArtifacts({ silent: true });
    } catch (error) {
      addToast(`启动最终产物生成失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsTriggeringFinalArtifacts(false);
    }
  }, [effectiveProjectId, addToast, loadFinalArtifacts]);

  useEffect(() => {
    void loadExecutions({ silent: true });
  }, [loadExecutions]);

  useEffect(() => {
    if (!project.id) {
      return;
    }

    syncProjectRoomUrlState({
      withSignoffFilters: isAcceptanceReportOpen,
      modal: isAcceptanceReportOpen ? 'acceptance-report' : null,
    });
  }, [activeTab, isAcceptanceReportOpen, project.id, signoffDecisionFilter, signoffKeyword, signoffStageFilter, signoffTimeFilter, syncProjectRoomUrlState]);

  const handleOpenAcceptanceReport = async () => {
    if (!project.id) {
      addToast('当前项目不可用，无法查看验收报告', 'error');
      return;
    }

    const urlFilters = readSignoffFiltersFromUrl();

    setIsAcceptanceReportOpen(true);
    setSignoffStageFilter(urlFilters?.stage || 'all');
    setSignoffDecisionFilter(urlFilters?.decision || 'all');
    setSignoffTimeFilter(urlFilters?.time || 'all');
    setSignoffKeyword(urlFilters?.keyword || '');
    setIsLoadingAcceptanceReport(true);
    try {
      const [report] = await Promise.all([
        projectsApi.getAcceptanceReport(project.id),
        loadFinalArtifacts({ silent: true }),
      ]);
      setAcceptanceReport(report);
    } catch (error) {
      setAcceptanceReport(null);
      addToast(`加载验收报告失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsLoadingAcceptanceReport(false);
    }
  };

  useEffect(() => {
    if (!project.id || isAcceptanceReportOpen) {
      return;
    }
    const roomState = readProjectRoomStateFromUrl();
    if (roomState?.tab) {
      setActiveTab(roomState.tab);
    }
    if (!shouldAutoOpenAcceptanceReportFromUrl()) {
      return;
    }
    if (typeof window === 'undefined') {
      return;
    }

    const autoOpenKey = `${project.id}|${window.location.search}`;
    if (signoffAutoOpenKeyRef.current === autoOpenKey) {
      return;
    }

    signoffAutoOpenKeyRef.current = autoOpenKey;
    void handleOpenAcceptanceReport();
  }, [isAcceptanceReportOpen, project.id, signoffKeyword, signoffDecisionFilter, signoffStageFilter, signoffTimeFilter]);

  useEffect(() => {
    if (!project.id || typeof window === 'undefined') {
      return;
    }

    const state = readProjectRoomStateFromUrl();
    if (!state?.tab) {
      return;
    }

    const applyKey = `${project.id}|${window.location.search}|${state.tab}`;
    if (projectRoomUrlStateAppliedRef.current === applyKey) {
      return;
    }

    projectRoomUrlStateAppliedRef.current = applyKey;
    setActiveTab(state.tab);
  }, [project.id]);

  const handleExportAcceptanceReport = async () => {
    if (!project.id) {
      addToast('当前项目不可用，无法导出验收报告', 'error');
      return;
    }

    setIsExportingAcceptanceReport(true);
    try {
      const markdown = await projectsApi.exportAcceptanceReportMarkdown(project.id);
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `acceptance-report-${project.id}.md`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);
      addToast('验收报告已导出', 'success');
    } catch (error) {
      addToast(`导出验收报告失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsExportingAcceptanceReport(false);
    }
  };

  const handleArchiveAcceptanceReport = async () => {
    if (!project.id) {
      addToast('当前项目不可用，无法归档验收报告', 'error');
      return;
    }

    setIsArchivingAcceptanceReport(true);
    try {
      const response = await projectsApi.archiveAcceptanceReport(project.id);
      await refreshProjectView();
      addToast(`验收报告已归档: ${response.deliverableName}`, 'success');
      const [report] = await Promise.all([
        projectsApi.getAcceptanceReport(project.id),
        loadFinalArtifacts({ silent: true }),
      ]);
      setAcceptanceReport(report);
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'ACCEPTANCE_QUALITY_GATE_BLOCKED') {
        const rawGate = (error.details as { error?: { qualityGate?: { blockingIssues?: string[] } } } | undefined)
          ?.error?.qualityGate;
        const blockingText = (rawGate?.blockingIssues || []).slice(0, 2).join('；');
        addToast(
          blockingText
            ? `归档已阻断：${blockingText}`
            : `归档已阻断：${error.message}`,
          'error',
        );
      } else {
      addToast(`归档验收报告失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      }
    } finally {
      setIsArchivingAcceptanceReport(false);
    }
  };

  const handleInspectSignoffStage = (stageType?: string) => {
    if (!stageType || stageType === 'UNKNOWN') {
      addToast('该签核记录未关联具体阶段', 'info');
      return;
    }

    setIsAcceptanceReportOpen(false);
    setActiveTab('交付物');

    const targetDeliverable = deliverables.find((item) => item.stageType === stageType && item.status === 'rejected')
      || deliverables.find((item) => item.stageType === stageType && item.status === 'submitted')
      || deliverables.find((item) => item.stageType === stageType);

    if (targetDeliverable) {
      setPreviewDeliverable(targetDeliverable);
      addToast(`已定位到 ${STAGE_LABELS[stageType] || stageType} 阶段交付物`, 'info');
      return;
    }

    addToast(`当前未找到 ${STAGE_LABELS[stageType] || stageType} 阶段交付物`, 'info');
  };

  const downloadText = (filename: string, content: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(url);
  };

  const resolveArtifactUrl = (rawUrl?: string) => {
    const url = String(rawUrl || '').trim();
    if (!url) {
      return '';
    }
    if (/^https?:\/\//i.test(url) || /^file:\/\//i.test(url)) {
      return url;
    }
    if (url.startsWith('/')) {
      return `${window.location.origin}${url}`;
    }
    return `${window.location.origin}/${url.replace(/^\.?\//, '')}`;
  };

  const resolveArtifactAccessUrls = (artifact: FinalArtifactItem) => {
    let localUrl = String(artifact.localUrl || '').trim();
    let publicUrl = String(artifact.publicUrl || '').trim();
    const rawUrl = String(artifact.url || '').trim();

    const isLocalHost = (host: string) => host === '127.0.0.1' || host === 'localhost' || host === '0.0.0.0';
    const normalizeGeneratedPath = (input: string) => {
      const value = String(input || '').trim();
      if (!value) {
        return '';
      }
      if (value.startsWith('/generated/')) {
        return value;
      }
      if (value.startsWith('generated/')) {
        return `/${value}`;
      }
      return '';
    };

    if (rawUrl) {
      if (/^https?:\/\//i.test(rawUrl)) {
        try {
          const parsed = new URL(rawUrl);
          if (isLocalHost(parsed.hostname)) {
            if (!localUrl) {
              localUrl = parsed.toString();
            }
          } else if (!publicUrl) {
            publicUrl = parsed.toString();
          }
          const generatedPath = normalizeGeneratedPath(parsed.pathname);
          if (generatedPath) {
            if (!localUrl) {
              localUrl = `http://127.0.0.1:8787${generatedPath}`;
            }
            if (!publicUrl && !isLocalHost(window.location.hostname)) {
              publicUrl = `${window.location.origin}${generatedPath}`;
            }
          }
        } catch {
          // ignore invalid absolute URL
        }
      } else {
        const generatedPath = normalizeGeneratedPath(rawUrl);
        if (generatedPath) {
          if (!localUrl) {
            localUrl = `http://127.0.0.1:8787${generatedPath}`;
          }
          if (!publicUrl && !isLocalHost(window.location.hostname)) {
            publicUrl = `${window.location.origin}${generatedPath}`;
          }
        }
      }
    }

    return { localUrl, publicUrl };
  };

  const handleOpenFinalArtifact = (artifact: FinalArtifactItem) => {
    const accessUrls = resolveArtifactAccessUrls(artifact);
    const preferredArtifactUrl = accessUrls.publicUrl || accessUrls.localUrl || artifact.url;
    if (artifact.source === 'link' && preferredArtifactUrl) {
      const resolvedUrl = resolveArtifactUrl(preferredArtifactUrl);
      if (!resolvedUrl) {
        addToast('该成果链接无效，无法打开', 'error');
        return;
      }
      window.open(resolvedUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    const target = artifact.deliverableId ? deliverableById.get(artifact.deliverableId) : undefined;
    if (target) {
      setPreviewDeliverable(target);
      return;
    }

    if (artifact.content) {
      setPreviewDeliverable({
        id: artifact.deliverableId || `virtual-${artifact.key}`,
        name: artifact.name,
        type: 'markdown',
        status: (artifact.status as DeliverableStatus) || 'approved',
        stageType: (artifact.stageType as ProjectDeliverable['stageType']) || 'ACCEPT',
        content: artifact.content,
        version: artifact.version || 1,
        createdBy: 'ROLE_PM',
        updatedAt: artifact.updatedAt || new Date().toISOString(),
      });
      return;
    }

    addToast('该成果当前无可预览内容', 'info');
  };

  const handleDownloadFinalArtifact = async (artifact: FinalArtifactItem) => {
    if (!artifact.content) {
      addToast('该成果暂无可下载正文', 'info');
      return;
    }
    setDownloadingArtifactKey(artifact.key);
    try {
      const fallbackExt = artifact.name.includes('.') ? '' : '.md';
      downloadText(
        `${artifact.name}${fallbackExt}`,
        artifact.content,
        'text/markdown;charset=utf-8',
      );
      addToast(`已下载 ${artifact.name}`, 'success');
    } catch (error) {
      addToast(`下载失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setDownloadingArtifactKey(null);
    }
  };

  const handleDownloadDeliverable = async (deliverable: ProjectDeliverable) => {
    const content = String(deliverable.content || '');
    if (!content.trim()) {
      addToast('该交付物暂无可下载正文', 'info');
      return;
    }

    setDownloadingDeliverableId(deliverable.id);
    try {
      const fallbackExt = deliverable.name.includes('.') ? '' : '.md';
      downloadText(
        `${deliverable.name}${fallbackExt}`,
        content,
        'text/markdown;charset=utf-8',
      );
      addToast(`已下载 ${deliverable.name}`, 'success');
    } catch (error) {
      addToast(`下载交付物失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setDownloadingDeliverableId(null);
    }
  };

  const handleCopyDeliverableContent = async (deliverable: ProjectDeliverable) => {
    const content = String(deliverable.content || '').trim();
    if (!content) {
      addToast('该交付物暂无正文可复制', 'info');
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
      } else {
        window.prompt('复制以下交付物正文', content);
      }
      addToast('交付物正文已复制', 'success');
    } catch (error) {
      addToast(`复制失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    }
  };

  const handleCopyFinalArtifactLink = async (artifact: FinalArtifactItem) => {
    const accessUrls = resolveArtifactAccessUrls(artifact);
    const preferredArtifactUrl = accessUrls.publicUrl || accessUrls.localUrl || artifact.url;
    const resolvedUrl = resolveArtifactUrl(preferredArtifactUrl);
    if (!resolvedUrl) {
      addToast('该成果没有可复制链接', 'info');
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(resolvedUrl);
      } else {
        window.prompt('复制以下链接', resolvedUrl);
      }
      addToast('成果链接已复制', 'success');
    } catch (error) {
      addToast(`复制失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    }
  };

  const getSignoffFilterSummary = () => {
    const stageLabel = signoffStageFilter === 'all' ? '全部阶段' : (STAGE_LABELS[signoffStageFilter] || signoffStageFilter);
    const decisionLabel =
      signoffDecisionFilter === 'all'
        ? '全部决策'
        : signoffDecisionFilter === 'approved'
          ? '通过'
          : signoffDecisionFilter === 'rejected'
            ? '驳回'
            : '待处理';
    const timeLabel =
      signoffTimeFilter === 'all'
        ? '全部时间'
        : signoffTimeFilter === '24h'
          ? '近 24 小时'
          : signoffTimeFilter === '7d'
            ? '近 7 天'
            : '近 30 天';

    return {
      stageLabel,
      decisionLabel,
      timeLabel,
      keyword: signoffKeyword.trim() || '无',
    };
  };

  const handleExportFilteredSignoffMarkdown = () => {
    if (filteredSignoffHistory.length === 0) {
      addToast('当前筛选结果为空，无法导出', 'info');
      return;
    }

    setIsExportingSignoffMarkdown(true);
    try {
      const summary = getSignoffFilterSummary();
      const lines = [
        '# 阶段签核筛选结果',
        '',
        `- 项目: ${project.name}`,
        `- 导出时间: ${new Date().toLocaleString('zh-CN')}`,
        '',
        '## 筛选摘要卡片',
        `- 阶段: ${summary.stageLabel}`,
        `- 决策: ${summary.decisionLabel}`,
        `- 时间窗口: ${summary.timeLabel}`,
        `- 关键词: ${summary.keyword}`,
        `- 命中记录: ${filteredSignoffHistory.length} 条`,
        '',
        '## 记录',
        ...filteredSignoffHistory.map((record, index) =>
          `${index + 1}. [${new Date(record.timestamp).toLocaleString('zh-CN')}] ${record.stageLabel} (${record.stageType || 'UNKNOWN'}) / ${record.decision} / ${roleLabel(record.actor)}\n   - ${record.reason}`,
        ),
      ];
      downloadText(
        `signoff-filtered-${project.id || 'project'}.md`,
        lines.join('\n'),
        'text/markdown;charset=utf-8',
      );
      addToast('签核筛选结果已导出为 Markdown', 'success');
    } catch (error) {
      addToast(`导出失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsExportingSignoffMarkdown(false);
    }
  };

  const escapeCsv = (value: string) => `"${String(value).replace(/"/g, '""')}"`;

  const handleExportFilteredSignoffCsv = () => {
    if (filteredSignoffHistory.length === 0) {
      addToast('当前筛选结果为空，无法导出', 'info');
      return;
    }

    setIsExportingSignoffCsv(true);
    try {
      const summary = getSignoffFilterSummary();
      const header = ['timestamp', 'stage_label', 'stage_type', 'decision', 'actor', 'reason'];
      const rows = filteredSignoffHistory.map((record) => [
        new Date(record.timestamp).toISOString(),
        record.stageLabel,
        record.stageType || 'UNKNOWN',
        record.decision,
        roleLabel(record.actor),
        record.reason.replace(/\n/g, ' '),
      ]);
      const csv = [
        `meta_key,meta_value`,
        `project_name,${escapeCsv(project.name)}`,
        `exported_at,${escapeCsv(new Date().toLocaleString('zh-CN'))}`,
        `filter_stage,${escapeCsv(summary.stageLabel)}`,
        `filter_decision,${escapeCsv(summary.decisionLabel)}`,
        `filter_time,${escapeCsv(summary.timeLabel)}`,
        `filter_keyword,${escapeCsv(summary.keyword)}`,
        `matched_count,${escapeCsv(String(filteredSignoffHistory.length))}`,
        ``,
        header.map(escapeCsv).join(','),
        ...rows.map((row) => row.map((cell) => escapeCsv(cell)).join(',')),
      ].join('\n');

      downloadText(
        `signoff-filtered-${project.id || 'project'}.csv`,
        csv,
        'text/csv;charset=utf-8',
      );
      addToast('签核筛选结果已导出为 CSV', 'success');
    } catch (error) {
      addToast(`导出失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsExportingSignoffCsv(false);
    }
  };

  const handleCopySignoffFilterLink = async () => {
    if (!project.id) {
      addToast('当前项目不可用，无法复制筛选链接', 'error');
      return;
    }

    if (typeof window === 'undefined') {
      return;
    }

    setIsCopyingSignoffLink(true);
    try {
      const url = new URL(window.location.href);
      const params = url.searchParams;
      params.set('app_tab', 'project-room');
      params.set('project_id', project.id);
      params.set('pr_tab', PROJECT_ROOM_TAB_TO_PARAM[activeTab]);
      params.set('pr_modal', 'acceptance-report');
      params.set('signoff_project_id', project.id);
      params.set('signoff_stage', signoffStageFilter);
      params.set('signoff_decision', signoffDecisionFilter);
      params.set('signoff_time', signoffTimeFilter);
      const keyword = signoffKeyword.trim();
      if (keyword) {
        params.set('signoff_keyword', keyword);
      } else {
        params.delete('signoff_keyword');
      }
      const link = url.toString();

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        window.prompt('复制以下链接', link);
      }

      addToast('筛选链接已复制，可用于复现当前视图', 'success');
    } catch (error) {
      addToast(`复制链接失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsCopyingSignoffLink(false);
    }
  };

  const handleIntervene = async () => {
    if (!project.id) {
      addToast('当前没有可干预的项目', 'error');
      return;
    }
    setIsIntervening(true);
    setProjectActionHint('正在触发紧急干预并等待 Agent 回写结果，预计 30-90 秒...');
    try {
      const command = projectBlockedCount > 0
        ? `紧急干预：项目 ${project.name} 当前有 ${projectBlockedCount} 个阻塞任务，请优先解除阻塞并同步最新 ETA。`
        : `紧急干预：项目 ${project.name} 请立即执行风险排查并提交状态报告。`;
      await projectsApi.intervene(project.id, command);
      await refreshProjectView();
      addToast('紧急干预已触发，系统正在同步项目状态', 'success');
    } catch (error) {
      if (guideRequiredActionsFromError(error)) {
        return;
      }
      addToast(`紧急干预失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsIntervening(false);
      setProjectActionHint(null);
    }
  };

  const handleApproveStage = async () => {
    if (!project.id || !detail?.pendingApproval) {
      addToast('当前阶段无需验收通过', 'info');
      return;
    }

    setIsReviewingStage(true);
    setStageReviewAction('approve');
    setProjectActionHint('正在执行阶段验收通过并推进下一阶段，预计 1-3 分钟...');
    addToast('正在执行阶段验收通过，预计 1-3 分钟，请稍候...', 'info');
    try {
      await projectsApi.approve(project.id);
      await refreshProjectView();
      addToast(`已通过 ${currentStageLabel} 阶段验收`, 'success');
    } catch (error) {
      if (guideRequiredActionsFromError(error)) {
        return;
      }
      addToast(`阶段验收失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsReviewingStage(false);
      setStageReviewAction(null);
      setProjectActionHint(null);
    }
  };

  const handleRejectStage = async () => {
    if (!project.id || !detail?.pendingApproval) {
      addToast('当前阶段无需驳回', 'info');
      return;
    }

    const reason = window.prompt('请输入驳回原因（将回写给对应阶段执行角色）', '交付物内容不完整，请补充关键路径与验收证据');
    if (!reason || !reason.trim()) {
      return;
    }

    setIsReviewingStage(true);
    setStageReviewAction('reject');
    setProjectActionHint('正在驳回当前阶段并回写返工建议，预计 30-90 秒...');
    addToast('正在驳回当前阶段并生成返工建议，请稍候...', 'info');
    try {
      await projectsApi.reject(project.id, reason.trim());
      await refreshProjectView();
      addToast(`已驳回 ${currentStageLabel} 阶段并要求返工`, 'info');
    } catch (error) {
      if (guideRequiredActionsFromError(error)) {
        return;
      }
      addToast(`驳回失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsReviewingStage(false);
      setStageReviewAction(null);
      setProjectActionHint(null);
    }
  };

  const splitChecklist = (input: string) =>
    input
      .split(/\n|；|;|,|，/)
      .map((item) => sanitizePrefillText(item))
      .filter(Boolean);

  const openDesignReviewModal = useCallback((action?: ProjectRequiredAction) => {
    setDesignReviewForm((prev) => {
      if (!isDesignReviewFormBlank(prev)) {
        return prev;
      }
      const source = [
        action?.prefillContent,
        latestDesignExecution?.outputPreview,
        latestDesignExecution?.promptSummary,
        latestDesignExecution?.errorMessage,
      ]
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .join('\n\n');
      const prefilled = buildDesignReviewPrefill({
        source,
        actionDetail: action?.detail,
      });
      return prefilled || prev;
    });
    setIsDesignReviewOpen(true);
  }, [latestDesignExecution]);

  const handleSubmitDesignReview = async () => {
    if (!project.id) {
      addToast('当前没有可提交审查卡的项目', 'error');
      return;
    }

    const uxPrinciples = splitChecklist(designReviewForm.uxPrinciples);
    const accessibilityChecklist = splitChecklist(designReviewForm.accessibilityChecklist);
    if (!designReviewForm.visualDirection.trim() || !designReviewForm.brandTone.trim()) {
      addToast('请补全视觉方向与品牌语气', 'error');
      return;
    }
    if (!designReviewForm.layoutStrategy.trim() || !designReviewForm.componentSpecs.trim()) {
      addToast('请补全版式策略与组件规范', 'error');
      return;
    }
    if (uxPrinciples.length < 3 || accessibilityChecklist.length < 3) {
      addToast('UX 原则与可访问性检查请至少各填写 3 条', 'error');
      return;
    }
    if (!designReviewForm.approvedBy.trim()) {
      addToast('请填写审查人', 'error');
      return;
    }

    setIsSubmittingDesignReview(true);
    try {
      const reviewChecklist = [
        '设计说明可支撑开发实施，不依赖口头解释。',
        '无障碍检查项至少 3 条并可验证。',
        '审查结论明确（通过/驳回）且有理由。',
      ];
      await projectsApi.submitStage(project.id, {
        title: `设计审查卡 ${new Date().toLocaleDateString('zh-CN')}`,
        finalizeApproval: false,
        content: [
          '# 设计阶段交付',
          '',
          '## 视觉方案',
          `- ${designReviewForm.visualDirection.trim()}`,
          '',
          '## 版式策略',
          `- ${designReviewForm.layoutStrategy.trim()}`,
          '',
          '## 组件清单',
          `- ${designReviewForm.componentSpecs.trim()}`,
          '',
          '## 品牌语气',
          `- ${designReviewForm.brandTone.trim()}`,
          '',
          '## UX 原则',
          ...uxPrinciples.map((item) => `- ${item}`),
          '',
          '## 可访问性检查',
          ...accessibilityChecklist.map((item) => `- ${item}`),
          '',
          '## 验收检查清单',
          ...reviewChecklist.map((item) => `- ${item}`),
        ].join('\n'),
        designReview: {
          visualDirection: designReviewForm.visualDirection.trim(),
          brandTone: designReviewForm.brandTone.trim(),
          uxPrinciples,
          accessibilityChecklist,
          approvedBy: designReviewForm.approvedBy.trim(),
          approved: designReviewForm.approved,
          notes: designReviewForm.notes.trim() || undefined,
        },
      });

      await refreshProjectView();
      setDesignReviewHistory((prev) => [
        {
          submittedAt: new Date().toISOString(),
          reviewer: designReviewForm.approvedBy.trim(),
          approved: designReviewForm.approved,
          visualDirection: designReviewForm.visualDirection.trim(),
        },
        ...prev,
      ].slice(0, 5));
      setIsDesignReviewOpen(false);
      addToast('设计审查卡已提交，待审批后可进入开发阶段', 'success');
    } catch (error) {
      if (guideRequiredActionsFromError(error)) {
        return;
      }
      addToast(`提交设计审查卡失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsSubmittingDesignReview(false);
    }
  };

  const designReviewTips = [
    '当设计 Agent 识别到需求不清晰/无法继续时，系统会自动预填该表单',
    '视觉方向必须明确（品牌气质 + 主色氛围）',
    '版式策略必须说明首屏到 CTA 的叙事顺序',
    '组件规范至少列出 Hero/能力卡/流程/案例/CTA',
    '无障碍清单至少包含对比度、键盘可达、语义结构',
  ];

  const formatRequiredActionsHint = (actions: ProjectRequiredAction[]) => {
    if (actions.length === 0) {
      return '请先补全当前阶段信息后再继续。';
    }
    const head = actions.slice(0, 2).map((item) => item.title).join('；');
    return actions.length > 2 ? `${head} 等 ${actions.length} 项` : head;
  };

  const guideRequiredActionsFromError = (error: unknown) => {
    if (!(error instanceof ApiRequestError)) {
      return false;
    }
    const details = error.details && typeof error.details === 'object'
      ? (error.details as Record<string, unknown>)
      : undefined;
    if (error.code === 'NO_PENDING_APPROVAL') {
      addToast(error.message || '当前没有待确认事项', 'info');
      void loadProjectDetail();
      return true;
    }
    const required = Array.isArray(details?.requiredActions)
      ? (details.requiredActions as ProjectRequiredAction[])
      : [];
    if (error.code === 'EXECUTION_PROTOCOL_GATE_FAILED') {
      const hint = parseExecutionProtocolFailureHint(
        details,
        error.message || '当前阶段未通过执行协议门禁，请先修复阻断项',
      );
      setProtocolFailureHint(hint);
      setActiveTab('交付物');
      addToast(hint.title, 'error');
      if (hint.missingChecks.length > 0) {
        addToast(`缺失检查项: ${hint.missingChecks.slice(0, 3).join('；')}`, 'info');
      }
      void loadProjectDetail();
      return true;
    }
    if (required.length === 0) {
      return false;
    }
    addToast(error.message || '当前步骤需要你先补充信息', 'info');
    addToast(`待处理事项: ${formatRequiredActionsHint(required)}`, 'info');
    void loadProjectDetail();
    return true;
  };

  const openRuntimeConfigHint = () => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('app_tab', 'settings');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search ? url.search : ''}${url.hash}`);
    }
    addToast('请前往设置页补全模型运行时配置（API Base URL / API Key / Model）', 'info');
  };

  const handleRequiredAction = async (action: ProjectRequiredAction) => {
    setRequiredActionLoadingId(action.id);
    try {
      if (action.action === 'submit_stage_deliverable') {
        setActiveTab('交付物');
        addToast('请先补全并提交当前阶段交付物', 'info');
        return;
      }
      if (action.action === 'open_design_review') {
        openDesignReviewModal(action);
        if (action.reasonCode === 'design_ambiguity') {
          addToast('已根据设计 Agent 的输出自动预填，你可以直接提交或补充编辑。', 'info');
        } else {
          addToast('请先完成设计审查卡，再继续推进', 'info');
        }
        return;
      }
      if (action.action === 'review_pending_stage') {
        setActiveTab('阶段');
        addToast('请在阶段验收中心执行通过或驳回', 'info');
        return;
      }
      if (action.action === 'resolve_blocked_tasks') {
        setActiveTab('任务');
        addToast('请先处理阻塞任务，再继续推进', 'info');
        return;
      }
      if (action.action === 'reconcile_deliverables') {
        if (!project.id) {
          addToast('当前项目不可用，无法重建交付物', 'error');
          return;
        }
        setProjectActionHint('正在重建阶段交付物并校验必需成果，预计 30-90 秒...');
        addToast('正在重建交付物，请稍候...', 'info');
        await projectsApi.reconcileDeliverables(project.id);
        await refreshProjectView();
        addToast('已重建交付物，请检查后继续推进', 'success');
        return;
      }
      if (action.action === 'run_post_create_prep') {
        if (!project.id) {
          addToast('当前项目不可用，无法执行创建后需求预备', 'error');
          return;
        }
        setProjectActionHint('正在生成多Agent讨论结论与需求回填草案，预计 15-60 秒...');
        addToast('正在执行创建后需求预备，请稍候...', 'info');
        const result = await projectsApi.runPostCreatePrep(project.id);
        await refreshProjectView();
        const completed = Boolean(result?.data?.postCreatePrep?.completed);
        if (completed) {
          addToast('创建后需求预备已完成，已解锁正式项目详情页', 'success');
        } else {
          addToast('草案已生成，请审阅并确认通过后进入正式详情页', 'info');
        }
        return;
      }
      if (action.action === 'refresh_runtime') {
        openRuntimeConfigHint();
        return;
      }
    } catch (error) {
      if (error instanceof ApiRequestError) {
        addToast(error.message, 'error');
      } else {
        addToast(`处理失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      }
    } finally {
      setRequiredActionLoadingId(null);
      setProjectActionHint(null);
    }
  };

  const handleSavePostCreatePrepDraft = async () => {
    if (!project.id) {
      addToast('当前项目不可用，无法保存预备草案', 'error');
      return;
    }
    setIsSavingPrepDraft(true);
    try {
      await projectsApi.savePostCreatePrepDraft(project.id, {
        discussion: prepDraftDiscussion,
        analysis: prepDraftAnalysis,
        rawRequirements: prepDraftRawRequirements,
        prd: prepDraftPrd,
        debateSummary: prepDraftDebateSummary,
      });
      await refreshProjectView();
      addToast('预备草案已保存', 'success');
    } catch (error) {
      if (error instanceof ApiRequestError) {
        addToast(error.message, 'error');
      } else {
        addToast(`保存失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      }
    } finally {
      setIsSavingPrepDraft(false);
    }
  };

  const handleConfirmPostCreatePrep = async () => {
    if (!project.id) {
      addToast('当前项目不可用，无法确认预备草案', 'error');
      return;
    }
    setIsConfirmingPrepDraft(true);
    try {
      const result = await projectsApi.confirmPostCreatePrep(project.id, {
        discussion: prepDraftDiscussion,
        analysis: prepDraftAnalysis,
        rawRequirements: prepDraftRawRequirements,
        prd: prepDraftPrd,
        debateSummary: prepDraftDebateSummary,
        notes: prepConfirmNotes,
      });
      await refreshProjectView();
      if (result?.data?.postCreatePrep?.completed) {
        addToast('预备阶段确认通过，已进入正式项目执行页', 'success');
      } else {
        const missing = result?.data?.postCreatePrep?.missingItems || [];
        addToast(missing.length > 0 ? `仍有缺失项: ${missing.join('；')}` : '预备阶段确认未通过', 'error');
      }
    } catch (error) {
      if (error instanceof ApiRequestError) {
        addToast(error.message, 'error');
      } else {
        addToast(`确认失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      }
    } finally {
      setIsConfirmingPrepDraft(false);
    }
  };

  const canConfirmPostCreatePrep = [
    prepDraftDiscussion,
    prepDraftAnalysis,
    prepDraftRawRequirements,
    prepDraftPrd,
    prepDraftDebateSummary,
  ].every((item) => String(item || '').trim().length > 0);
  const prepDiscussionView = useMemo(
    () => parsePrepDiscussionView(prepDraftDiscussion),
    [prepDraftDiscussion],
  );
  const prepAnalysisView = useMemo(
    () => parsePrepAnalysisView(prepDraftAnalysis),
    [prepDraftAnalysis],
  );
  const prepRequirementContractView = useMemo(
    () => parsePrepRequirementContractView([prepDraftPrd, prepDraftRawRequirements].join('\n\n')),
    [prepDraftPrd, prepDraftRawRequirements],
  );

  if (isPostCreatePrepBlocked) {
    return (
      <div className="h-full flex flex-col">
        <header className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6 border-b border-border-subtle flex items-center justify-between gap-3 bg-surface/50 backdrop-blur-md">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-warning/15 flex items-center justify-center border border-warning/30 text-warning shrink-0">
              <BrainCircuit size={20} />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-white truncate">{project.name}</h1>
              <p className="text-xs text-slate-400">预备阶段 · 多Agent讨论与需求回填</p>
            </div>
          </div>
          <Badge variant="warning">流程门禁中</Badge>
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <section className="max-w-5xl mx-auto space-y-4">
            <div className="space-y-5 p-5 bg-surface-soft border border-primary/20 rounded-2xl">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-primary">
                  <Zap size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">需求分析与多Agent决策预备</span>
                </div>
                <Badge variant="warning">阻断中</Badge>
              </div>

              <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="warning">Pre-Stage Gate</Badge>
                  <Badge variant={canConfirmPostCreatePrep ? 'primary' : 'warning'}>
                    {canConfirmPostCreatePrep ? '可确认' : '待补齐'}
                  </Badge>
                </div>
                <p className="text-xs leading-6 text-slate-300">
                  页面结构已按“创建项目分析阶段”同构：需求理解摘要、需求细化草案、需求确认单、多角色讨论、回填输入与确认门禁。
                </p>
                {(postCreatePrep?.missingItems || []).length > 0 ? (
                  <div className="space-y-1">
                    {(postCreatePrep?.missingItems || []).map((item) => (
                      <p key={item} className="text-[11px] text-warning">未完成 · {item}</p>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400">缺失项同步中，建议先执行一次“创建后需求预备”。</p>
                )}
              </div>

              <div className="space-y-3">
                <p className="text-xs text-slate-400">Issue 理解摘要</p>
                <div className="rounded-xl border border-border-subtle bg-white/5 p-3 space-y-1">
                  <p className="text-sm font-semibold text-white">
                    {prepRequirementContractView.objective || prepAnalysisView.objective || project.name}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    当前阶段: {currentStageLabel || '分析'} · 未通过预备确认前，系统不会进入正式阶段详情页。
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-xs text-slate-400">基于输入的多角色讨论结论</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-border-subtle bg-white/5 p-3 space-y-2">
                    <p className="text-[11px] text-slate-300">共识</p>
                    {(prepDiscussionView.consensus.length > 0 ? prepDiscussionView.consensus : ['待补充共识']).map((item, index) => (
                      <p key={`consensus-${index}`} className="text-[11px] text-slate-400 leading-relaxed">- {item}</p>
                    ))}
                  </div>
                  <div className="rounded-xl border border-border-subtle bg-white/5 p-3 space-y-2">
                    <p className="text-[11px] text-slate-300">分歧与处理</p>
                    {(prepDiscussionView.divergences.length > 0 ? prepDiscussionView.divergences : ['待补充分歧项']).map((item, index) => (
                      <p key={`divergence-${index}`} className="text-[11px] text-warning leading-relaxed">- {item}</p>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-border-subtle bg-white/5 p-3 space-y-2">
                  <p className="text-[11px] text-slate-300">角色决策建议</p>
                  {(prepDiscussionView.roleDecisions.length > 0 ? prepDiscussionView.roleDecisions : ['待补充角色建议']).map((item, index) => (
                    <p key={`role-${index}`} className="text-[11px] text-slate-400 leading-relaxed">- {item}</p>
                  ))}
                  {prepDiscussionView.anchor ? (
                    <p className="text-[11px] text-primary">决策锚点: {prepDiscussionView.anchor}</p>
                  ) : null}
                </div>
                <textarea
                  value={prepDraftDiscussion}
                  onChange={(event) => setPrepDraftDiscussion(event.target.value)}
                  placeholder="请填写或编辑多Agent讨论结论..."
                  className="min-h-36 w-full rounded-xl border border-border-subtle bg-surface-muted px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                />
              </div>

              <div className="space-y-3">
                <p className="text-xs text-slate-400">需求细化草案（项目详情理解确认）</p>
                <div className="rounded-xl border border-border-subtle bg-white/5 p-3 space-y-2">
                  <p className="text-[11px] text-slate-300">目标: {prepAnalysisView.objective || '待补充'}</p>
                  <p className="text-[11px] text-slate-300">设计主题: {prepAnalysisView.designTheme || '待补充'}</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <p className="text-[11px] text-slate-400">核心场景</p>
                      {(prepAnalysisView.scenarios.length > 0 ? prepAnalysisView.scenarios : ['待补充']).map((item, index) => (
                        <p key={`scenario-${index}`} className="text-[11px] text-slate-300">- {item}</p>
                      ))}
                    </div>
                    <div className="space-y-1">
                      <p className="text-[11px] text-slate-400">验收标准</p>
                      {(prepAnalysisView.acceptance.length > 0 ? prepAnalysisView.acceptance : ['待补充']).map((item, index) => (
                        <p key={`accept-${index}`} className="text-[11px] text-slate-300">- {item}</p>
                      ))}
                    </div>
                    <div className="space-y-1">
                      <p className="text-[11px] text-slate-400">In Scope</p>
                      {(prepAnalysisView.inScope.length > 0 ? prepAnalysisView.inScope : ['待补充']).map((item, index) => (
                        <p key={`inscope-${index}`} className="text-[11px] text-slate-300">- {item}</p>
                      ))}
                    </div>
                    <div className="space-y-1">
                      <p className="text-[11px] text-slate-400">Out of Scope / 风险</p>
                      {[...prepAnalysisView.outOfScope, ...prepAnalysisView.risks].length > 0
                        ? [...prepAnalysisView.outOfScope, ...prepAnalysisView.risks].map((item, index) => (
                          <p key={`risk-${index}`} className="text-[11px] text-warning">- {item}</p>
                        ))
                        : <p className="text-[11px] text-slate-400">- 待补充</p>}
                    </div>
                  </div>
                </div>
                <textarea
                  value={prepDraftAnalysis}
                  onChange={(event) => setPrepDraftAnalysis(event.target.value)}
                  placeholder="请填写或编辑项目理解与范围草案..."
                  className="min-h-36 w-full rounded-xl border border-border-subtle bg-surface-muted px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                />
              </div>

              <div className="space-y-3">
                <p className="text-xs text-slate-400">需求确认单草案（从回填输入解析）</p>
                <div className="rounded-xl border border-border-subtle bg-white/5 p-3 space-y-1">
                  <p className="text-[11px] text-slate-300">目标: {prepRequirementContractView.objective || '待补充'}</p>
                  <p className="text-[11px] text-slate-400">In Scope: {(prepRequirementContractView.inScope || []).join('；') || '待补充'}</p>
                  <p className="text-[11px] text-slate-400">Out of Scope: {(prepRequirementContractView.outOfScope || []).join('；') || '待补充'}</p>
                  <p className="text-[11px] text-slate-400">验收: {(prepRequirementContractView.acceptance || []).join('；') || '待补充'}</p>
                  <p className="text-[11px] text-slate-400">产出: {(prepRequirementContractView.artifacts || []).join('、') || '待补充'}</p>
                </div>
              </div>

              <div className="rounded-xl border border-border-subtle bg-white/5 p-4 space-y-3">
                <p className="text-xs text-slate-400">回填输入（可编辑）</p>
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-400">rawRequirements</p>
                  <textarea
                    value={prepDraftRawRequirements}
                    onChange={(event) => setPrepDraftRawRequirements(event.target.value)}
                    className="min-h-24 w-full rounded-xl border border-border-subtle bg-surface-muted px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-400">prd</p>
                  <textarea
                    value={prepDraftPrd}
                    onChange={(event) => setPrepDraftPrd(event.target.value)}
                    className="min-h-24 w-full rounded-xl border border-border-subtle bg-surface-muted px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-400">debateSummary</p>
                  <textarea
                    value={prepDraftDebateSummary}
                    onChange={(event) => setPrepDraftDebateSummary(event.target.value)}
                    className="min-h-24 w-full rounded-xl border border-border-subtle bg-surface-muted px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-border-subtle bg-white/5 p-4 space-y-2">
                <p className="text-xs text-slate-400">确认备注（可选）</p>
                <textarea
                  value={prepConfirmNotes}
                  onChange={(event) => setPrepConfirmNotes(event.target.value)}
                  placeholder="可填写本次确认的结论与限制说明"
                  className="min-h-20 w-full rounded-xl border border-border-subtle bg-surface-muted px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                />
                <p className="text-[11px] text-slate-400">
                  门禁说明: 必须完成“多Agent讨论结论 + 项目详情理解确认草案 + 核心输入回填 + 用户确认”才解锁正式页面。
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => postCreatePrepRequiredAction && void handleRequiredAction(postCreatePrepRequiredAction)}
                  disabled={!postCreatePrepRequiredAction || requiredActionLoadingId === postCreatePrepRequiredAction.id}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-primary/90 disabled:opacity-60"
                >
                  {postCreatePrepRequiredAction && requiredActionLoadingId === postCreatePrepRequiredAction.id
                    ? '处理中...'
                    : (postCreatePrepRequiredAction?.ctaLabel || '执行创建后需求预备')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSavePostCreatePrepDraft()}
                  disabled={isSavingPrepDraft}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-60"
                >
                  {isSavingPrepDraft ? '保存中...' : '保存草案'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmPostCreatePrep()}
                  disabled={isConfirmingPrepDraft || !canConfirmPostCreatePrep}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-400 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-300 disabled:opacity-60"
                >
                  {isConfirmingPrepDraft ? '确认中...' : '确认通过并进入正式详情'}
                </button>
                <button
                  type="button"
                  onClick={() => void refreshProjectView()}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
                >
                  刷新状态
                </button>
              </div>
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <header className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6 border-b border-border-subtle flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between bg-surface/50 backdrop-blur-md">
        <div className="w-full min-w-0 flex items-start sm:items-center gap-3 sm:gap-4">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary border border-primary/20 shrink-0">
            <Briefcase size={24} />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-white break-words">{project.name}</h1>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-1">
              <Badge variant="primary">阶段: {STAGE_LABELS[currentStageType || ''] || project.phase}</Badge>
              <span className="flex items-center gap-1.5 text-[10px] text-warning font-bold">
                <Zap size={10} />
                风险: {projectBlockedCount > 0 ? `${projectBlockedCount} 个任务阻塞` : '无阻塞风险'}
              </span>
              {loadingDetail ? <Badge variant="default">同步中</Badge> : null}
              {projectActionHint ? <Badge variant="accent">执行中</Badge> : null}
            </div>
            {projectActionHint ? <p className="mt-1 text-xs text-accent break-words">{projectActionHint}</p> : null}
          </div>
        </div>
        <div className="w-full xl:w-auto flex flex-wrap items-center justify-start xl:justify-end gap-2 sm:gap-3">
          <button
            onClick={() => void handleOpenAcceptanceReport()}
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap px-3 sm:px-4 py-2 bg-white/5 text-slate-200 hover:bg-white/10 rounded-lg text-xs sm:text-sm font-semibold transition-colors"
          >
            <CheckCircle2 size={16} />
            验收报告
          </button>
          <button
            onClick={() => void handleIntervene()}
            disabled={isIntervening}
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap px-3 sm:px-4 py-2 bg-danger text-white hover:bg-danger/90 rounded-lg text-xs sm:text-sm font-semibold transition-colors disabled:opacity-60"
          >
            <ShieldCheck size={16} />
            {isIntervening ? '干预中...' : '紧急干预'}
          </button>
          {isDesignPhase ? (
            <button
              onClick={() => openDesignReviewModal(designReviewRequiredAction || undefined)}
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap px-3 sm:px-4 py-2 bg-primary text-slate-950 hover:bg-primary/90 rounded-lg text-xs sm:text-sm font-semibold transition-colors"
            >
              <FileText size={16} />
              提交设计审查卡
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex-1 overflow-hidden flex">
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-8">
          <section className="rounded-2xl border border-border-subtle bg-surface-soft p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">主链状态</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="primary">当前阶段: {currentStageLabel}</Badge>
                  <Badge variant={detail?.pendingApproval ? 'warning' : 'accent'}>
                    {detail?.pendingApproval ? '等待验收决策' : '当前无待验收阶段'}
                  </Badge>
                  <Badge variant={requiredActions.length > 0 ? 'warning' : 'default'}>
                    待处理事项: {requiredActions.length}
                  </Badge>
                </div>
                <p className="text-sm text-slate-300">
                  {requiredActions.length > 0
                    ? requiredActions[0].detail
                    : detail?.pendingApproval
                      ? '当前阶段已经提交，下一步请在阶段验收中心执行通过或驳回。'
                      : currentStageDeliverables.length > 0
                        ? '当前阶段已有交付物，请优先检查交付内容与执行证据是否完整。'
                        : '当前阶段尚未形成可验收交付物，请先补足主链产出。'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {requiredActions.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => void handleRequiredAction(requiredActions[0])}
                    disabled={requiredActionLoadingId === requiredActions[0].id}
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-primary/90 disabled:opacity-60"
                  >
                    {requiredActionLoadingId === requiredActions[0].id ? '处理中...' : requiredActions[0].ctaLabel}
                  </button>
                ) : detail?.pendingApproval ? (
                  <button
                    type="button"
                    onClick={() => setActiveTab('阶段')}
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-primary/90"
                  >
                    前往阶段验收
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setActiveTab('交付物')}
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
                  >
                    查看当前交付物
                  </button>
                )}
              </div>
            </div>
          </section>

          {protocolFailureHint ? (
            <section className="rounded-2xl border border-danger/40 bg-danger/10 p-4 sm:p-5 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-danger">执行协议门禁阻断详情</h3>
                <Badge variant="danger">
                  {protocolFailureHint.categories
                    .slice(0, 2)
                    .map((category) => PROTOCOL_FAILURE_CATEGORY_LABELS[category] || category)
                    .join(' / ')}
                </Badge>
              </div>
              <p className="text-xs text-danger/90">{protocolFailureHint.title}</p>
              {protocolFailureHint.missingChecks.length > 0 ? (
                <div className="space-y-2">
                  {protocolFailureHint.missingChecks.slice(0, 4).map((item, index) => (
                    <p key={`${item}-${index}`} className="text-xs text-slate-200">
                      {index + 1}. {item}
                    </p>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {requiredActions.length > 0 ? (
            <section className="rounded-2xl border border-warning/40 bg-warning/10 p-4 sm:p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-warning">需要你补充与确认</h3>
                <Badge variant="warning">{requiredActions.length} 项待处理</Badge>
              </div>
              <p className="text-xs text-warning/90">
                当前流程存在不完整步骤，请按下面顺序补足后再继续推进。
              </p>
              <div className="space-y-2">
                {requiredActions.map((action) => (
                  <div key={action.id} className="rounded-xl border border-warning/40 bg-surface-soft/70 p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm text-white font-medium">{action.title}</p>
                      <Badge variant={action.severity === 'critical' ? 'danger' : action.severity === 'warning' ? 'warning' : 'accent'}>
                        {action.severity === 'critical' ? '高优先级' : action.severity === 'warning' ? '需处理' : '提示'}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-300">{action.detail}</p>
                    <button
                      type="button"
                      onClick={() => void handleRequiredAction(action)}
                      disabled={requiredActionLoadingId === action.id}
                      className="px-3 py-1.5 rounded-lg bg-primary text-slate-950 hover:bg-primary/90 text-xs font-semibold disabled:opacity-60"
                    >
                      {requiredActionLoadingId === action.id ? '处理中...' : action.ctaLabel}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <div className="w-full overflow-x-auto scrollbar-hide">
            <div className="inline-flex min-w-max items-center gap-2 p-1 bg-white/5 rounded-xl border border-border-subtle">
              {(['任务', '阶段', '交付物', '时间线'] as ProjectRoomTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    'px-4 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap inline-flex items-center gap-1.5',
                    activeTab === tab ? 'bg-surface-muted text-white shadow-sm' : 'text-slate-500 hover:text-slate-300',
                  )}
                >
                  {tab}
                  <span className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded-full border',
                    activeTab === tab ? 'border-white/20 text-slate-200 bg-white/10' : 'border-border-subtle text-slate-500 bg-white/5',
                  )}>
                    {tabStats[tab]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <section className="rounded-2xl border border-border-subtle bg-surface-soft/70 p-3 sm:p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">最终成果快照</h3>
              <div className="flex items-center gap-2">
                {isLoadingFinalArtifacts ? (
                  <Badge variant="default">同步中</Badge>
                ) : finalArtifacts ? (
                  <Badge variant={finalArtifacts.readyForAcceptance ? 'primary' : 'warning'}>
                    {finalArtifacts.readyForAcceptance
                      ? `可验收 ${finalArtifacts.coverage.provided}/${finalArtifacts.coverage.required}`
                      : `缺失 ${finalArtifacts.coverage.missing} 项`}
                  </Badge>
                ) : finalArtifactsLoadError ? (
                  <Badge variant="danger">加载失败</Badge>
                ) : (
                  <Badge variant="default">暂无数据</Badge>
                )}
                <button
                  type="button"
                  onClick={() => setActiveTab('交付物')}
                  className="px-2.5 py-1 rounded-md bg-white/5 border border-border-subtle text-[11px] text-slate-200 hover:bg-white/10"
                >
                  查看交付物
                </button>
                {prototypeFinalArtifact ? (
                  <button
                    type="button"
                    onClick={() => handleOpenFinalArtifact(prototypeFinalArtifact)}
                    className="px-2.5 py-1 rounded-md bg-primary/15 border border-primary/30 text-[11px] text-primary hover:bg-primary/25"
                  >
                    查看交互原型
                  </button>
                ) : null}
              </div>
            </div>
            {finalArtifacts ? (
              <div className="space-y-1.5">
                <p className="text-xs text-slate-500">
                  项目状态: {finalArtifacts.status} · 当前阶段: {finalArtifacts.currentStage}
                </p>
                {prototypeFinalArtifact ? (
                  <p className="text-xs text-primary">
                    原型交付物: {prototypeFinalArtifact.name}
                  </p>
                ) : null}
                <p className="text-xs text-slate-400">
                  {quickFinalArtifacts.slice(0, 3).map((artifact) => artifact.name).join('、') || '暂无关键产物'}
                </p>
              </div>
            ) : finalArtifactsLoadError ? (
              <p className="text-xs text-danger">最终成果读取失败：{finalArtifactsLoadError}</p>
            ) : (
              <p className="text-xs text-slate-500">正在读取最终成果摘要...</p>
            )}
          </section>

          {activeTab === '交付物' ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <CheckCircle2 size={14} />
                最终验收成果
              </h3>
              <div className="flex items-center gap-2">
                {isLoadingFinalArtifacts ? (
                  <Badge variant="default">同步中</Badge>
                ) : finalArtifacts ? (
                  <Badge variant={finalArtifacts.readyForAcceptance ? 'primary' : 'warning'}>
                    {finalArtifacts.readyForAcceptance
                      ? `已就绪 ${finalArtifacts.coverage.provided}/${finalArtifacts.coverage.required}`
                      : `待补齐 ${finalArtifacts.coverage.missing} 项`}
                  </Badge>
                ) : (
                  <Badge variant="default">暂无</Badge>
                )}
                <button
                  type="button"
                  onClick={() => void handleGenerateFinalArtifacts(finalArtifactsGeneration?.status === 'failed')}
                  disabled={isTriggeringFinalArtifacts || finalArtifactsRunning}
                  className="px-2.5 py-1 rounded-md bg-primary/15 border border-primary/30 text-[11px] text-primary hover:bg-primary/25 disabled:opacity-60"
                >
                  {isTriggeringFinalArtifacts ? '启动中...' : finalArtifactsRunning ? '生成中...' : '生成最终成果'}
                </button>
              </div>
            </div>

            {finalArtifactsGenerationText ? (
              <div className={cn(
                'rounded-xl border p-3 text-xs',
                finalArtifactsGeneration?.status === 'failed'
                  ? 'border-danger/40 bg-danger/10 text-danger'
                  : finalArtifactsRunning
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-primary/40 bg-primary/10 text-primary',
              )}>
                {finalArtifactsGenerationText}
              </div>
            ) : null}

            {finalArtifacts ? (
              <div className="space-y-3">
                {finalArtifacts.missingRequired.length > 0 ? (
                  <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                    缺失验收产物：{finalArtifacts.missingRequired.join('、')}
                  </div>
                ) : null}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {quickFinalArtifacts.map((artifact) => (
                    <div key={`${artifact.key}-${artifact.deliverableId || artifact.url || artifact.name}`} className="rounded-xl border border-border-subtle bg-surface-soft p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-slate-400">{artifact.category}</p>
                        <Badge variant={artifact.ready ? (artifact.required ? 'primary' : 'accent') : 'warning'}>
                          {artifact.ready ? (artifact.required ? '必需-就绪' : '附加') : '待完善'}
                        </Badge>
                      </div>
                      <p className="text-sm font-semibold text-white">{artifact.name}</p>
                      <p className="text-[11px] text-slate-500">
                        {artifact.stageType || '-'} · {artifact.status || '-'} · {artifact.updatedAt ? new Date(artifact.updatedAt).toLocaleString('zh-CN') : '-'}
                      </p>
                      {isPrototypeLikeArtifact(artifact) ? (
                        <p className="text-[11px] text-primary">该交付物支持交互预览</p>
                      ) : null}
                      <p className="text-[11px] text-slate-500">
                        生成模型: {getArtifactModelLabel(artifact)}
                      </p>
                      <p className="text-[11px] text-slate-400 whitespace-pre-wrap break-words">{artifact.excerpt || '暂无摘要'}</p>
                      {(() => {
                        const access = resolveArtifactAccessUrls(artifact);
                        return (
                          <div className="text-[11px] text-slate-400 space-y-1">
                            <p className="break-all">
                              本地地址：
                              {access.localUrl ? (
                                <a className="ml-1 text-primary hover:underline" href={resolveArtifactUrl(access.localUrl)} target="_blank" rel="noreferrer">
                                  {access.localUrl}
                                </a>
                              ) : (
                                <span className="ml-1 text-slate-500">待生成</span>
                              )}
                            </p>
                            <p className="break-all">
                              外网地址：
                              {access.publicUrl ? (
                                <a className="ml-1 text-primary hover:underline" href={resolveArtifactUrl(access.publicUrl)} target="_blank" rel="noreferrer">
                                  {access.publicUrl}
                                </a>
                              ) : (
                                <span className="ml-1 text-slate-500">待生成</span>
                              )}
                            </p>
                          </div>
                        );
                      })()}
                      {artifact.issue ? <p className="text-[11px] text-warning">{artifact.issue}</p> : null}
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenFinalArtifact(artifact)}
                          className="px-2.5 py-1 rounded-md bg-white/5 border border-border-subtle text-[11px] text-slate-200 hover:bg-white/10 flex items-center gap-1"
                        >
                          {artifact.source === 'link' ? <ExternalLink size={11} /> : <FileText size={11} />}
                          {isPrototypeLikeArtifact(artifact)
                            ? '查看交互原型'
                            : artifact.source === 'link'
                              ? '打开链接'
                              : '查看内容'}
                        </button>
                        {(() => {
                          const access = resolveArtifactAccessUrls(artifact);
                          return (
                            <>
                              {access.localUrl ? (
                                <button
                                  type="button"
                                  onClick={() => window.open(resolveArtifactUrl(access.localUrl), '_blank', 'noopener,noreferrer')}
                                  className="px-2.5 py-1 rounded-md bg-white/5 border border-border-subtle text-[11px] text-slate-300 hover:bg-white/10"
                                >
                                  打开本地地址
                                </button>
                              ) : null}
                              {access.publicUrl ? (
                                <button
                                  type="button"
                                  onClick={() => window.open(resolveArtifactUrl(access.publicUrl), '_blank', 'noopener,noreferrer')}
                                  className="px-2.5 py-1 rounded-md bg-white/5 border border-border-subtle text-[11px] text-slate-300 hover:bg-white/10"
                                >
                                  打开外网地址
                                </button>
                              ) : null}
                            </>
                          );
                        })()}
                        {artifact.content ? (
                          <button
                            type="button"
                            onClick={() => void handleDownloadFinalArtifact(artifact)}
                            disabled={downloadingArtifactKey === artifact.key}
                            className="px-2.5 py-1 rounded-md bg-primary/15 border border-primary/30 text-[11px] text-primary hover:bg-primary/25 disabled:opacity-60 flex items-center gap-1"
                          >
                            <Download size={11} />
                            {downloadingArtifactKey === artifact.key ? '下载中...' : '下载文件'}
                          </button>
                        ) : null}
                        {artifact.url ? (
                          <button
                            type="button"
                            onClick={() => void handleCopyFinalArtifactLink(artifact)}
                            className="px-2.5 py-1 rounded-md bg-white/5 border border-border-subtle text-[11px] text-slate-300 hover:bg-white/10 flex items-center gap-1"
                          >
                            <Copy size={11} />
                            复制链接
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {quickFinalArtifacts.length === 0 ? (
                    <div className="col-span-full rounded-xl border border-border-subtle bg-surface-soft p-4 text-xs text-slate-500">
                      暂无可展示的验收成果，请先推进阶段交付物。
                    </div>
                  ) : null}
                </div>
              </div>
            ) : finalArtifactsLoadError ? (
              <div className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-xs text-danger space-y-2">
                <p>最终验收成果加载失败：{finalArtifactsLoadError}</p>
                <button
                  type="button"
                  onClick={() => void loadFinalArtifacts()}
                  className="px-2.5 py-1 rounded-md bg-danger/15 border border-danger/40 text-[11px] text-danger hover:bg-danger/25"
                >
                  重新加载
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-border-subtle bg-surface-soft p-4 text-xs text-slate-500">
                正在准备验收成果清单...
              </div>
            )}
          </section>
          ) : null}

          {activeTab === '任务' ? (
            <>
              <section className="space-y-4">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <Layers size={14} />
                  活跃任务
                </h3>
                <div className="space-y-4">
                  {groupedProjectTasks.map((group) => (
                    <div key={group.stageType} className="rounded-2xl border border-border-subtle bg-surface-soft/40 p-3 sm:p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-bold text-slate-300 uppercase tracking-widest">
                          阶段: {STAGE_LABELS[group.stageType] || group.stageType}
                        </p>
                        <Badge variant="default">{group.tasks.length} 项任务</Badge>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {group.tasks.map((task) => (
                          <button
                            key={task.id}
                            type="button"
                            onClick={() => setSelectedTaskId(task.id)}
                            className={cn(
                              'w-full text-left bg-surface-soft border p-5 rounded-2xl space-y-4 transition-all group',
                              selectedTask?.id === task.id
                                ? 'border-primary/50 ring-1 ring-primary/30'
                                : 'border-border-subtle hover:border-white/20',
                            )}
                          >
                            <div className="flex justify-between items-start gap-3">
                              <div>
                                <h4 className="font-semibold text-white text-sm group-hover:text-primary transition-colors">{task.title}</h4>
                                <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                                  <BrainCircuit size={10} />
                                  指派给: {task.agent}
                                </p>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <Badge variant={statusVariantByTask(task.status)}>{TASK_STATUS_LABELS[task.rawStatus]}</Badge>
                                  <Badge variant="default">owner: {task.ownerAgentId || '未配置'}</Badge>
                                  {task.reviewAgentId ? <Badge variant="accent">reviewer: {task.reviewAgentId}</Badge> : null}
                                  <Badge variant={task.coordinationMode === 'delegated_execution' ? 'accent' : 'default'}>
                                    {COORDINATION_MODE_LABELS[task.coordinationMode || 'single_owner'] || task.coordinationMode || 'single_owner'}
                                  </Badge>
                                  {task.pendingDelegationCount > 0 ? (
                                    <Badge variant="warning">待回收 delegation: {task.pendingDelegationCount}</Badge>
                                  ) : null}
                                  <Badge variant={gitlabStatusBadge(task.gitlab?.status).variant}>
                                    {gitlabStatusBadge(task.gitlab?.status).label}
                                  </Badge>
                                </div>
                                {task.nextAction ? (
                                  <p className="mt-2 text-[11px] text-slate-400">
                                    下一步: {task.nextAction.label}
                                  </p>
                                ) : null}
                                {task.blockedReason ? (
                                  <p className="mt-1 text-[11px] text-warning">
                                    阻塞: {task.blockedReason.label}
                                  </p>
                                ) : null}
                              </div>
                              <ChevronRight size={16} className={cn('shrink-0 transition-transform', selectedTask?.id === task.id ? 'text-primary rotate-90' : 'text-slate-500')} />
                            </div>
                            <div className="space-y-2">
                              <div className="flex justify-between text-[10px] text-slate-500">
                                <span>进度</span>
                                <span>{task.progress}%</span>
                              </div>
                              <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                                <motion.div
                                  initial={{ width: 0 }}
                                  animate={{ width: `${task.progress}%` }}
                                  className={cn('h-full rounded-full transition-all duration-500', task.status === 'Blocked' ? 'bg-danger' : 'bg-primary')}
                                />
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {selectedTask ? (
                    <div className="rounded-2xl border border-primary/20 bg-surface-soft p-4 sm:p-5 space-y-5">
                      <TaskDetailHeaderCard
                        selectedTask={selectedTask}
                        defaultOwnerAgentId={DEFAULT_AGENT_BY_ROLE[selectedTask.assigneeRoleId] || ''}
                        stageLabels={STAGE_LABELS}
                        taskStatusLabels={TASK_STATUS_LABELS}
                        coordinationModeLabels={COORDINATION_MODE_LABELS}
                        delegationPolicyLabels={DELEGATION_POLICY_LABELS}
                        syncPolicyLabels={SYNC_POLICY_LABELS}
                        contextScopeLabels={CONTEXT_SCOPE_LABELS}
                        statusVariantByTask={statusVariantByTask}
                        roleLabel={roleLabel}
                        taskActionLoadingKey={taskActionLoadingKey}
                        readyForReviewBlockReason={readyForReviewBlockReason}
                        onSyncGitlab={() => void handleSyncTaskGitlab()}
                        onReadyForReview={() =>
                          void runTaskAction(
                            `task-review:${selectedTask.id}`,
                            async () => {
                              await tasksApi.readyForReview(selectedTask.id);
                            },
                            '任务已进入待审阅',
                            { reloadDelegationsTaskId: selectedTask.id },
                          )
                        }
                      />

                      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                        <div className="rounded-2xl border border-border-subtle bg-surface/60 p-4 space-y-4">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-bold uppercase tracking-widest text-slate-500">协作配置</p>
                            <Badge variant="default">待回收: {selectedTask.pendingDelegationCount}</Badge>
                          </div>
                          <div className="rounded-lg border border-border-subtle bg-surface/70 px-3 py-2 text-xs text-slate-400">
                            <p>GitLab 状态: {selectedTask.gitlab?.status || 'not_synced'}</p>
                            <p className="mt-1">最近同步: {selectedTask.gitlab?.lastSyncedAt ? new Date(selectedTask.gitlab.lastSyncedAt).toLocaleString('zh-CN') : '暂无'}</p>
                            <p className="mt-1">Issue: {selectedTask.gitlab?.issueIid ? `#${selectedTask.gitlab.issueIid}` : '未建立'}</p>
                            <p className="mt-1">同步摘要: {selectedTask.gitlab?.summary || '暂无摘要'}</p>
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <label className="space-y-1.5">
                              <span className="text-[11px] text-slate-500">Owner Agent</span>
                              <select
                                value={ownerDraft}
                                onChange={(event) => setOwnerDraft(event.target.value)}
                                className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-white outline-none focus:border-primary/40"
                              >
                                <option value="">请选择 owner</option>
                                {taskAgentOptions.map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="space-y-1.5">
                              <span className="text-[11px] text-slate-500">Reviewer Agent</span>
                              <select
                                value={reviewerDraft}
                                onChange={(event) => setReviewerDraft(event.target.value)}
                                className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-white outline-none focus:border-primary/40"
                              >
                                <option value="">暂不设置 reviewer</option>
                                {taskAgentOptions.map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="space-y-1.5">
                              <span className="text-[11px] text-slate-500">Coordination Mode</span>
                              <select
                                value={coordinationModeDraft}
                                onChange={(event) => setCoordinationModeDraft(event.target.value)}
                                className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-white outline-none focus:border-primary/40"
                              >
                                {Object.entries(COORDINATION_MODE_LABELS).map(([value, label]) => (
                                  <option key={value} value={value}>
                                    {label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <div className="rounded-lg border border-border-subtle bg-surface/70 px-3 py-2 text-xs text-slate-400">
                              <p>delegation policy: {DELEGATION_POLICY_LABELS[selectedTask.delegationPolicy || 'manual_only'] || selectedTask.delegationPolicy || 'manual_only'}</p>
                              <p className="mt-1">sync policy: {SYNC_POLICY_LABELS[selectedTask.syncPolicy || 'db_plus_gitlab'] || selectedTask.syncPolicy || 'db_plus_gitlab'}</p>
                              <p className="mt-1">context scope: {CONTEXT_SCOPE_LABELS[selectedTask.contextScope || 'local'] || selectedTask.contextScope || 'local'}</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleSaveTaskCoordination()}
                            disabled={taskActionLoadingKey === `task-config:${selectedTask.id}`}
                            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-60"
                          >
                            {taskActionLoadingKey === `task-config:${selectedTask.id}` ? '保存中...' : '保存协作配置'}
                          </button>
                        </div>

                        <div className="rounded-2xl border border-border-subtle bg-surface/60 p-4 space-y-4">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Delegation 控制台</p>
                            <Badge variant={selectedTaskDelegations.length > 0 ? 'accent' : 'default'}>
                              {selectedTaskDelegations.length} 条 delegation
                            </Badge>
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <label className="space-y-1.5 md:col-span-2">
                              <span className="text-[11px] text-slate-500">Delegation Goal</span>
                              <textarea
                                value={delegationGoalDraft}
                                onChange={(event) => setDelegationGoalDraft(event.target.value)}
                                rows={3}
                                placeholder="只写本 delegation 需要解决的子问题，不要横向扩功能"
                                className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-white outline-none focus:border-primary/40"
                              />
                            </label>
                            <label className="space-y-1.5">
                              <span className="text-[11px] text-slate-500">标题</span>
                              <input
                                value={delegationTitleDraft}
                                onChange={(event) => setDelegationTitleDraft(event.target.value)}
                                placeholder="可选，默认由 mode + goal 生成"
                                className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-white outline-none focus:border-primary/40"
                              />
                            </label>
                            <label className="space-y-1.5">
                              <span className="text-[11px] text-slate-500">Mode</span>
                              <select
                                value={delegationModeDraft}
                                onChange={(event) => setDelegationModeDraft(event.target.value as TaskDelegation['mode'])}
                                className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-white outline-none focus:border-primary/40"
                              >
                                <option value="research">research</option>
                                <option value="coding">coding</option>
                                <option value="validation">validation</option>
                                <option value="summarization">summarization</option>
                                <option value="review">review</option>
                              </select>
                            </label>
                            <label className="space-y-1.5">
                              <span className="text-[11px] text-slate-500">Target Agent</span>
                              <select
                                value={delegationTargetDraft}
                                onChange={(event) => setDelegationTargetDraft(event.target.value)}
                                className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-white outline-none focus:border-primary/40"
                              >
                                <option value="">默认 owner</option>
                                {taskAgentOptions.map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <div className="grid grid-cols-2 gap-3">
                              <label className="space-y-1.5">
                                <span className="text-[11px] text-slate-500">超时秒数</span>
                                <input
                                  value={delegationTimeoutDraft}
                                  onChange={(event) => setDelegationTimeoutDraft(event.target.value)}
                                  className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-white outline-none focus:border-primary/40"
                                />
                              </label>
                              <label className="space-y-1.5">
                                <span className="text-[11px] text-slate-500">最大重试</span>
                                <input
                                  value={delegationRetryDraft}
                                  onChange={(event) => setDelegationRetryDraft(event.target.value)}
                                  className="w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-white outline-none focus:border-primary/40"
                                />
                              </label>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleCreateDelegation()}
                            disabled={taskActionLoadingKey === `task-delegation-create:${selectedTask.id}`}
                            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-primary/90 disabled:opacity-60"
                          >
                            <Plus size={14} />
                            {taskActionLoadingKey === `task-delegation-create:${selectedTask.id}` ? '创建中...' : '创建 delegation'}
                          </button>
                        </div>
                      </div>

                      <TaskDelegationStatusPanel
                        selectedTask={selectedTask}
                        selectedTaskDelegations={selectedTaskDelegations}
                        isLoadingTaskDelegations={isLoadingTaskDelegations}
                        taskActionLoadingKey={taskActionLoadingKey}
                        delegationStatusLabels={DELEGATION_STATUS_LABELS}
                        statusVariantByDelegation={statusVariantByDelegation}
                        onDispatch={(delegationId) =>
                          void runTaskAction(
                            `delegation-dispatch:${delegationId}`,
                            async () => {
                              await tasksApi.dispatchDelegation(delegationId);
                            },
                            'delegation 已执行并回写任务',
                            { reloadDelegationsTaskId: selectedTask.id },
                          )
                        }
                        onRetry={(delegationId) =>
                          void runTaskAction(
                            `delegation-retry:${delegationId}`,
                            async () => {
                              await tasksApi.retryDelegation(delegationId);
                            },
                            'delegation 已重新排队',
                            { reloadDelegationsTaskId: selectedTask.id },
                          )
                        }
                        onCancel={(delegationId) =>
                          void runTaskAction(
                            `delegation-cancel:${delegationId}`,
                            async () => {
                              await tasksApi.cancelDelegation(delegationId, 'ProjectRoom 手动取消');
                            },
                            'delegation 已取消',
                            { reloadDelegationsTaskId: selectedTask.id },
                          )
                        }
                      />
                    </div>
                  ) : null}
                  {effectiveProjectTasks.length === 0 ? (
                    <div className="bg-surface-soft border border-border-subtle p-6 rounded-2xl text-center text-sm text-slate-500">
                      当前项目暂无任务数据
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                    <Terminal size={14} />
                    实时输出流
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    <span className="text-[10px] text-primary font-bold uppercase">直播</span>
                  </div>
                </div>
                <div className="bg-surface-muted border border-border-subtle rounded-2xl p-6 font-mono text-xs space-y-2 max-h-96 overflow-y-auto scrollbar-hide">
                  {recentLogs.map((log, i) => (
                    <p key={`${log.timestamp}-${i}`} className="text-slate-500">
                      <span className="text-slate-600">[{log.time}]</span>{' '}
                      <span className={log.type === 'danger' ? 'text-danger' : log.type === 'accent' ? 'text-accent' : 'text-primary'}>{log.actor}:</span>{' '}
                      {log.message}
                    </p>
                  ))}
                  {recentLogs.length === 0 ? <p className="text-slate-600">暂无实时日志</p> : null}
                  <div className="w-1 h-4 bg-primary animate-pulse inline-block align-middle ml-1" />
                </div>
              </section>
            </>
          ) : null}

          {activeTab === '阶段' ? (
            <section className="space-y-4">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <CheckCircle2 size={14} />
                阶段验收中心
              </h3>

              <div className="bg-surface-soft border border-border-subtle rounded-2xl p-5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-white">Workflow v2 阶段执行总览</p>
                    <p className="text-xs text-slate-400 mt-1">
                      {workflowOverview
                        ? `${workflowOverview.template.name} · ${workflowOverview.name}`
                        : '当前项目尚未发现可展示的 workflow-v2 运行态'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {isLoadingWorkflowOverview ? <Badge variant="default">同步中</Badge> : null}
                    {workflowOverview ? (
                      <Badge variant={workflowOverview.status === 'completed' ? 'primary' : workflowOverview.status === 'active' ? 'accent' : 'default'}>
                        {workflowOverview.status}
                      </Badge>
                    ) : (
                      <Badge variant="warning">未激活</Badge>
                    )}
                  </div>
                </div>

                {workflowOverview ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="default">阶段总数 {workflowStageSummary.total}</Badge>
                      <Badge variant="primary">已完成 {workflowStageSummary.completed}</Badge>
                      <Badge variant="accent">进行中 {workflowStageSummary.inProgress}</Badge>
                      <Badge variant={workflowStageSummary.gateBlocked > 0 ? 'warning' : 'default'}>
                        门禁阻塞 {workflowStageSummary.gateBlocked}
                      </Badge>
                      <Badge variant={workflowStageSummary.failed > 0 ? 'danger' : 'default'}>
                        执行失败 {workflowStageSummary.failed}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {WORKFLOW_OVERVIEW_FILTER_OPTIONS.map((option) => (
                        <button
                          key={option.key}
                          onClick={() => setWorkflowOverviewFilter(option.key)}
                          className={cn(
                            'px-2 py-1 rounded-lg text-[11px] border transition-colors',
                            workflowOverviewFilter === option.key
                              ? 'bg-primary/20 text-primary border-primary/30'
                              : 'bg-white/5 text-slate-400 border-border-subtle hover:bg-white/10',
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>

                    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                      {visibleWorkflowStageRows.map((item, index) => (
                        <div key={item.id} className="rounded-xl border border-border-subtle bg-white/5 p-3 space-y-2">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm text-white font-medium">
                                {index + 1}. {workflowTemplateLabel(item.templateKey)}
                              </p>
                              <p className="text-[11px] text-slate-500 mt-1">
                                node: {item.nodeId || '-'} · 角色证据: {item.collaboration?.roleCount ?? 0} · {item.collaboration?.analystInvolved ? '含需求分析师' : '缺需求分析师'}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {item.isCurrent ? <Badge variant="accent">当前</Badge> : null}
                              <Badge variant={statusVariantByWorkflowStage(item.status)}>
                                {WORKFLOW_STAGE_STATUS_LABELS[item.status] || item.status}
                              </Badge>
                            </div>
                          </div>

                          {(item.assignedAgentProfiles || []).length > 0 ? (
                            <div className="flex flex-wrap items-center gap-2">
                              {(item.assignedAgentProfiles || []).map((agent) => (
                                <Badge key={`${item.id}-${agent.agentId}`} variant={workflowAgentEngineVariant(agent.engine)}>
                                  {roleLabel(agent.agentId)} · {workflowAgentEngineLabel(agent.engine)}{agent.model ? ` · ${agent.model}` : ''}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[11px] text-slate-500">当前阶段暂未分配执行 Agent</p>
                          )}

                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="default">产物 {item.outputArtifactCount}</Badge>
                            <Badge variant="default">上下文 {item.contextMemoryCount}</Badge>
                            <Badge variant={workflowExecutionEngineVariant(item.executionEngine)}>
                              执行引擎 {workflowExecutionEngineLabel(item.executionEngine)}
                            </Badge>
                            <Badge variant={item.collaboration?.analystInvolved ? 'primary' : 'warning'}>
                              {item.collaboration?.analystInvolved ? '分析师复核已覆盖' : '分析师复核缺失'}
                            </Badge>
                            <Badge variant="default">
                              协作产物 {item.artifactSources?.companion ?? 0}
                            </Badge>
                            <button
                              onClick={() => toggleWorkflowStageDetails(item.id)}
                              className="px-2 py-1 rounded-lg text-[11px] border bg-white/5 text-slate-300 border-border-subtle hover:bg-white/10"
                            >
                              {expandedWorkflowStageIds.includes(item.id) ? '收起协作明细' : `协作明细 ${(item.collaborationArtifacts || []).length}`}
                            </button>
                            <Badge variant={item.gate.passed ? 'primary' : item.gate.violationCount > 0 ? 'warning' : 'default'}>
                              {item.gate.passed ? '门禁通过' : `门禁问题 ${item.gate.violationCount}`}
                            </Badge>
                            <button
                              onClick={() => handleFocusWorkflowStageDeliverables(item.templateKey)}
                              className="px-2 py-1 rounded-lg text-[11px] border bg-white/5 text-slate-300 border-border-subtle hover:bg-white/10"
                            >
                              查看交付物
                            </button>
                            <button
                              onClick={() => handleFocusWorkflowStageKnowledge(item.templateKey)}
                              className="px-2 py-1 rounded-lg text-[11px] border bg-white/5 text-slate-300 border-border-subtle hover:bg-white/10"
                            >
                              查看知识
                            </button>
                          </div>

                          <p className="text-[11px] text-slate-500">
                            来源: Hermes {item.artifactSources?.hermes ?? 0} · OpenClaw {item.artifactSources?.openclaw ?? 0} · Companion {item.artifactSources?.companion ?? 0} · Stitch {item.artifactSources?.stitch ?? 0}
                          </p>

                          {expandedWorkflowStageIds.includes(item.id) ? (() => {
                            const collaborationArtifacts = item.collaborationArtifacts || [];
                            const roleOptions = Array.from(
                              new Set(
                                collaborationArtifacts
                                  .map((artifact) => String(artifact.role || '').trim())
                                  .filter(Boolean),
                              ),
                            );
                            const selectedRole = workflowCollaborationRoleFilters[item.id] || 'all';
                            const visibleArtifacts = selectedRole === 'all'
                              ? collaborationArtifacts
                              : collaborationArtifacts.filter((artifact) => String(artifact.role || '').trim() === selectedRole);
                            return (
                              <div className="rounded-xl border border-border-subtle bg-surface-soft p-3 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">协作复核明细</p>
                                  <p className="text-[11px] text-slate-500">共 {visibleArtifacts.length} 条</p>
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    onClick={() => setWorkflowStageCollaborationRoleFilter(item.id, 'all')}
                                    className={cn(
                                      'px-2 py-1 rounded-lg text-[11px] border transition-colors',
                                      selectedRole === 'all'
                                        ? 'bg-primary/20 text-primary border-primary/30'
                                        : 'bg-white/5 text-slate-400 border-border-subtle hover:bg-white/10',
                                    )}
                                  >
                                    全部角色
                                  </button>
                                  {roleOptions.map((roleId) => (
                                    <button
                                      key={`${item.id}-role-${roleId}`}
                                      onClick={() => setWorkflowStageCollaborationRoleFilter(item.id, roleId)}
                                      className={cn(
                                        'px-2 py-1 rounded-lg text-[11px] border transition-colors',
                                        selectedRole === roleId
                                          ? 'bg-primary/20 text-primary border-primary/30'
                                          : 'bg-white/5 text-slate-400 border-border-subtle hover:bg-white/10',
                                      )}
                                    >
                                      {roleLabel(roleId)}
                                    </button>
                                  ))}
                                </div>

                                {visibleArtifacts.length > 0 ? (
                                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                                    {visibleArtifacts.map((artifact) => (
                                      <div key={artifact.id} className="rounded-lg border border-border-subtle bg-white/5 p-2 space-y-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <Badge variant={workflowCollaborationStatusVariant(artifact.status)}>
                                            {artifact.status === 'failed' ? 'FAILED' : 'SUCCESS'}
                                          </Badge>
                                          <Badge variant="default">{workflowCollaborationSourceLabel(artifact.source)}</Badge>
                                          <Badge variant="default">{roleLabel(artifact.role || artifact.agentId || 'unknown')}</Badge>
                                          {artifact.provider ? <Badge variant="default">{artifact.provider}</Badge> : null}
                                          {artifact.model ? <Badge variant="default">{artifact.model}</Badge> : null}
                                        </div>
                                        <div className="flex items-center justify-between gap-2">
                                          <p className="text-[11px] text-slate-300">
                                            {artifact.name} · {formatLocalDateTime(artifact.generatedAt)}
                                          </p>
                                          <button
                                            onClick={() => handleFocusWorkflowStageKnowledge(
                                              item.templateKey,
                                              {
                                                query: [artifact.role, artifact.primaryRole, artifact.name].filter(Boolean).join(' '),
                                                agentId: artifact.agentId || undefined,
                                                focusId: artifact.knowledgeId || artifact.id || undefined,
                                                focusTitle: artifact.name || undefined,
                                                focusRole: artifact.role || artifact.primaryRole || undefined,
                                              },
                                            )}
                                            className="px-2 py-1 rounded-lg text-[11px] border bg-white/5 text-slate-300 border-border-subtle hover:bg-white/10"
                                          >
                                            跳转知识
                                          </button>
                                        </div>
                                        <p className="text-[11px] text-slate-500 leading-relaxed">
                                          {artifact.preview || '暂无摘要内容'}
                                        </p>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-[11px] text-slate-500">当前筛选条件下暂无协作复核明细。</p>
                                )}
                              </div>
                            );
                          })() : null}

                          {item.gate.violations.length > 0 ? (
                            <p className="text-[11px] text-warning">
                              {item.gate.violations[0]}
                            </p>
                          ) : null}
                        </div>
                      ))}
                      {visibleWorkflowStageRows.length === 0 ? (
                        <p className="text-xs text-slate-500">当前筛选条件下暂无阶段。</p>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-slate-500">可先在项目创建时启用 workflow 模板，或在项目中初始化并启动 workflow-v2。</p>
                )}
              </div>

              <div className="bg-surface-soft border border-border-subtle rounded-2xl p-5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-white">当前阶段: {currentStageLabel}</p>
                    <p className="text-xs text-slate-400 mt-1">状态: {detail?.pendingApproval ? '等待你的验收决策' : '当前无待验收阶段'}</p>
                  </div>
                  <Badge variant={detail?.pendingApproval ? 'warning' : 'primary'}>
                    {detail?.pendingApproval ? '待验收' : '已同步'}
                  </Badge>
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-slate-500">本阶段交付物</p>
                  {currentStageDeliverables.length > 0 ? (
                    <div className="space-y-2">
                      {currentStageDeliverables.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => setPreviewDeliverable(item)}
                          className="w-full text-left p-3 rounded-xl border border-border-subtle bg-white/5 hover:bg-white/10 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm text-white font-medium">{item.name}</p>
                              <p className="text-[11px] text-slate-500 mt-1">
                                {new Date(item.updatedAt).toLocaleString('zh-CN')} · {roleLabel(item.createdBy)} · {isDeliverableReadable(item) ? '可查阅' : '正文待补全'}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={isDeliverableReadable(item) ? 'accent' : 'warning'}>
                                {isDeliverableReadable(item) ? '正文完整' : '正文偏短'}
                              </Badge>
                              <Badge variant={statusVariantByDeliverable(item.status)}>{DELIVERABLE_STATUS_LABELS[item.status]}</Badge>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">当前阶段暂无可验收交付物</p>
                  )}
                </div>

                {detail?.pendingApproval ? (
                  <div className="flex gap-3">
                    <button
                      onClick={() => void handleApproveStage()}
                      disabled={isReviewingStage}
                      className="px-4 py-2 bg-primary text-slate-950 hover:bg-primary/90 rounded-lg text-sm font-semibold disabled:opacity-60"
                    >
                      {stageReviewAction === 'approve' ? '通过中...' : isReviewingStage ? '处理中...' : '通过当前阶段验收'}
                    </button>
                    <button
                      onClick={() => void handleRejectStage()}
                      disabled={isReviewingStage}
                      className="px-4 py-2 bg-danger text-white hover:bg-danger/90 rounded-lg text-sm font-semibold disabled:opacity-60"
                    >
                      {stageReviewAction === 'reject' ? '驳回中...' : '驳回并返工'}
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {stageItems.map((stage) => {
                  const stageDeliverables = deliverablesByStage.get(stage.type) || [];
                  const acceptance = getStageAcceptance(stage.type);
                  const acceptanceStats = getStageDeliverableStats(stage.type);
                  return (
                    <div key={`${stage.type}-${stage.label}`} className="bg-surface-soft border border-border-subtle p-5 rounded-2xl space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-white">{stage.label || STAGE_LABELS[stage.type] || stage.type}</p>
                          <p className="text-xs text-slate-500 mt-1">负责人: {roleLabel(stage.assignee)}</p>
                        </div>
                        <Badge variant={statusVariantByStage(stage.status)}>{CORE_STAGE_STATUS_LABELS[stage.status] || stage.status}</Badge>
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between text-[10px] text-slate-500">
                          <span>完成度</span>
                          <span>{stage.progress}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                          <div className={cn('h-full rounded-full', stage.status === 'rejected' ? 'bg-danger' : 'bg-primary')} style={{ width: `${stage.progress}%` }} />
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-500">验收结果</span>
                        <Badge variant={acceptance.variant}>{acceptance.label}</Badge>
                      </div>

                      <p className="text-[11px] text-slate-500">
                        通过 {acceptanceStats.approved} · 驳回 {acceptanceStats.rejected} · 待处理 {acceptanceStats.submitted} · 草稿 {acceptanceStats.draft}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        生成模型: {getStageModelLabel(stage.type)}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        可查阅 {acceptanceStats.readable} · 待补正文 {acceptanceStats.unreadable}
                      </p>

                      <div className="space-y-1">
                        <p className="text-[11px] text-slate-500">阶段交付物 ({stageDeliverables.length})</p>
                        {stageDeliverables.length > 0 ? stageDeliverables.slice(0, 3).map((item) => (
                          <button
                            key={item.id}
                            onClick={() => setPreviewDeliverable(item)}
                            className="w-full text-left text-xs text-slate-300 p-2 rounded-lg bg-white/5 hover:bg-white/10"
                          >
                            <span className="inline-flex items-center gap-2">
                              <span>{item.name}</span>
                              <span className={cn('text-[10px]', isDeliverableReadable(item) ? 'text-primary' : 'text-warning')}>
                                {isDeliverableReadable(item) ? '可查阅' : '正文待补'}
                              </span>
                            </span>
                          </button>
                        )) : <p className="text-xs text-slate-500">暂无</p>}
                      </div>

                      <p className="text-[11px] text-slate-500">
                        开始: {stage.startedAt ? new Date(stage.startedAt).toLocaleString('zh-CN') : '-'} · 结束: {stage.endedAt ? new Date(stage.endedAt).toLocaleString('zh-CN') : '-'}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {activeTab === '交付物' ? (
            <section className="space-y-4">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <FileText size={14} />
                交付物检查
              </h3>
              <div className="space-y-5">
                {stitchArtifacts.length > 0 ? (
                  <div className="bg-surface-soft border border-border-subtle rounded-2xl p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-white">Stitch 设计历史（已关联当前项目）</p>
                      <Badge variant="accent">{stitchArtifacts.length} 条</Badge>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      仅展示与当前项目执行记录绑定的 Stitch 产物，避免出现“Stitch 有项目但平台无映射”的数据噪音。
                    </p>
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {stitchArtifacts.map((item) => (
                        <div key={item.executionId} className="rounded-xl border border-border-subtle bg-white/5 p-3 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs text-slate-200">
                              {STAGE_LABELS[item.stageType] || item.stageType} · {roleLabel(item.role)}
                            </p>
                            <Badge variant={item.status === 'ready' ? 'primary' : item.status === 'pending' ? 'warning' : 'danger'}>
                              {item.status}
                            </Badge>
                          </div>
                          <p className="text-[11px] text-slate-400">
                            stitchProjectId: {item.projectId}{item.screenId ? ` · screenId: ${item.screenId}` : ''} · {new Date(item.updatedAt).toLocaleString('zh-CN')}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {item.htmlUrl ? (
                              <a
                                href={item.htmlUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="px-2.5 py-1 rounded-md bg-primary/15 border border-primary/30 text-[11px] text-primary hover:bg-primary/25 inline-flex items-center gap-1"
                              >
                                <ExternalLink size={12} />
                                HTML
                              </a>
                            ) : null}
                            {item.imageUrl ? (
                              <a
                                href={item.imageUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="px-2.5 py-1 rounded-md bg-white/5 border border-border-subtle text-[11px] text-slate-200 hover:bg-white/10 inline-flex items-center gap-1"
                              >
                                <ExternalLink size={12} />
                                图片
                              </a>
                            ) : null}
                          </div>
                          {item.error ? <p className="text-[11px] text-warning">error: {item.error}</p> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {stageItems.map((stage) => {
                  const stageDeliverables = deliverablesByStage.get(stage.type) || [];
                  const acceptanceStats = getStageDeliverableStats(stage.type);
                  return (
                    <div key={`deliverables-${stage.type}`} className="bg-surface-soft border border-border-subtle rounded-2xl p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-white">{stage.label || STAGE_LABELS[stage.type] || stage.type}</p>
                        <Badge variant="default">{stageDeliverables.length} 份交付</Badge>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        验收统计: 通过 {acceptanceStats.approved} · 驳回 {acceptanceStats.rejected} · 待处理 {acceptanceStats.submitted} · 可查阅 {acceptanceStats.readable}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        生成模型: {getStageModelLabel(stage.type)}
                      </p>

                      {stageDeliverables.length > 0 ? (
                        <div className="space-y-2">
                          {stageDeliverables.map((item) => (
                            <button
                              key={item.id}
                              onClick={() => setPreviewDeliverable(item)}
                              className="w-full text-left border border-border-subtle rounded-xl p-4 bg-white/5 hover:bg-white/10 transition-colors"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-white">{item.name}</p>
                                  <p className="text-xs text-slate-500 mt-1">
                                    版本 v{item.version ?? 1} · 产出人 {roleLabel(item.createdBy)} · {new Date(item.updatedAt).toLocaleString('zh-CN')} · {isDeliverableReadable(item) ? '可查阅' : '正文待补全'}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge variant={isDeliverableReadable(item) ? 'accent' : 'warning'}>
                                    {isDeliverableReadable(item) ? '正文完整' : '正文偏短'}
                                  </Badge>
                                  <Badge variant={statusVariantByDeliverable(item.status)}>{DELIVERABLE_STATUS_LABELS[item.status]}</Badge>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">该阶段暂无交付物</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {activeTab === '时间线' ? (
            <section className="space-y-4">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <History size={14} />
                项目时间线
              </h3>

              <div className="bg-surface-soft border border-border-subtle rounded-2xl p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Agent 执行证据</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="default">总计 {executionSummary.total}</Badge>
                    <Badge variant="primary">成功 {executionSummary.success}</Badge>
                    <Badge variant={executionSummary.failed > 0 ? 'danger' : 'default'}>失败 {executionSummary.failed}</Badge>
                    <Badge variant={executionSummary.realModelRuns > 0 ? 'accent' : 'warning'}>
                      真实模型 {executionSummary.realModelRuns}
                    </Badge>
                  </div>
                </div>
                {isLoadingExecutions ? (
                  <p className="text-xs text-slate-500">执行证据同步中...</p>
                ) : executionRecords.length > 0 ? (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {executionRecords.slice(0, 12).map((record) => (
                      <div key={record.id} className="rounded-xl border border-border-subtle bg-white/5 p-3 space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs text-slate-300">
                            {new Date(record.createdAt).toLocaleString('zh-CN')} · {STAGE_LABELS[record.stageType] || record.stageType} · {roleLabel(record.role)}
                          </p>
                          <div className="flex items-center gap-2">
                            <Badge variant={record.status === 'failed' ? 'danger' : 'primary'}>{record.status}</Badge>
                            <Badge variant="accent">{record.provider || record.runtimeMode || 'unknown'}</Badge>
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-500">
                          action: {record.action} · model: {record.model || 'n/a'} · latency: {record.latencyMs ?? '-'}ms
                        </p>
                        {record.promptSummary ? (
                          <p className="text-[11px] text-slate-400 whitespace-pre-wrap">{record.promptSummary}</p>
                        ) : null}
                        {record.outputPreview ? (
                          <p className="text-[11px] text-slate-300 whitespace-pre-wrap">{record.outputPreview}</p>
                        ) : null}
                        {record.errorMessage ? (
                          <p className="text-[11px] text-danger whitespace-pre-wrap">{record.errorMessage}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">暂无执行证据（尚未触发阶段 Agent 调用）</p>
                )}
              </div>

              <div className="space-y-3">
                {timelineEvents.length > 0 ? timelineEvents.map((item) => (
                  <div key={item.id} className="bg-surface-soft border border-border-subtle rounded-2xl p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{item.title}</p>
                        <p className="text-xs text-slate-500 mt-1">
                          {new Date(item.timestamp).toLocaleString('zh-CN')} · {roleLabel(item.agentId)} · {item.type}
                        </p>
                      </div>
                      <Badge variant={item.priority === 'urgent' || item.priority === 'high' ? 'danger' : item.priority === 'normal' ? 'accent' : 'default'}>
                        {item.priority}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-300 mt-2 whitespace-pre-wrap">{item.content}</p>
                  </div>
                )) : (
                  <div className="bg-surface-soft border border-border-subtle rounded-2xl p-6 text-center text-sm text-slate-500">
                    暂无时间线事件
                  </div>
                )}
              </div>
            </section>
          ) : null}
        </main>

        <aside className="w-80 border-l border-border-subtle p-6 space-y-8 hidden lg:block bg-surface-soft/30">
          <section className="space-y-4">
            <h3 className="text-[10px] uppercase tracking-widest font-bold text-slate-500 flex items-center gap-2">
              <FileText size={12} />
              交付物
            </h3>
            <div className="space-y-2">
              {projectDeliverablesSide.map((file) => (
                <button
                  key={file.id}
                  onClick={() => {
                    if (file.deliverable) {
                      setPreviewDeliverable(file.deliverable);
                    }
                  }}
                  className="w-full flex items-center justify-between p-3 bg-white/5 rounded-xl border border-border-subtle hover:bg-white/10 transition-colors cursor-pointer group text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-slate-500 group-hover:text-primary transition-colors">
                      <FileText size={14} />
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs text-slate-300 font-medium block truncate">{file.name}</span>
                      <span className="text-[10px] text-slate-500">{file.type} • {file.size}</span>
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-slate-600 group-hover:text-white transition-colors" />
                </button>
              ))}
            </div>
          </section>

          {isDesignPhase ? (
            <section className="space-y-4">
              <h3 className="text-[10px] uppercase tracking-widest font-bold text-slate-500 flex items-center gap-2">
                <ShieldCheck size={12} />
                设计审查记录
              </h3>
              <div className="space-y-2">
                {designReviewHistory.length > 0 ? designReviewHistory.map((item, index) => (
                  <div key={`${item.submittedAt}-${index}`} className="p-3 rounded-xl border border-border-subtle bg-white/5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-white font-semibold">{item.visualDirection}</span>
                      <Badge variant={item.approved ? 'primary' : 'warning'}>{item.approved ? '通过' : '未通过'}</Badge>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      审查人: {item.reviewer} · {new Date(item.submittedAt).toLocaleString('zh-CN')}
                    </p>
                  </div>
                )) : (
                  <p className="text-[11px] text-slate-500">暂无设计审查记录</p>
                )}
              </div>
            </section>
          ) : null}

          <section className="space-y-4">
            <h3 className="text-[10px] uppercase tracking-widest font-bold text-slate-500 flex items-center gap-2">
              <Users size={12} />
              项目 Agent
            </h3>
            <div className="space-y-3">
              {projectAgents.slice(0, 4).map((agent) => (
                <div key={agent.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors cursor-pointer">
                  <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent text-[10px] font-bold border border-accent/20">
                    {agent.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white font-medium truncate">{agent.name}</p>
                    <p className="text-[10px] text-slate-500 truncate">{agent.role}</p>
                  </div>
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                </div>
              ))}
              {projectAgents.length === 0 ? <p className="text-[11px] text-slate-500 text-center py-2">暂无项目成员数据</p> : null}
              <button className="w-full py-2 bg-white/5 border border-dashed border-border-subtle rounded-xl text-[10px] font-bold text-slate-500 hover:text-white hover:border-white/20 transition-all flex items-center justify-center gap-2">
                <Plus size={12} />
                指派 Agent
              </button>
            </div>
          </section>
        </aside>
      </div>

      <SurfaceModal
        isOpen={isAcceptanceReportOpen}
        onClose={() => setIsAcceptanceReportOpen(false)}
        title="阶段验收报告"
        panelClassName="max-w-5xl"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-400">
              {acceptanceReport ? `生成时间: ${new Date(acceptanceReport.generatedAt).toLocaleString('zh-CN')}` : '点击刷新以加载最新报告'}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleOpenAcceptanceReport()}
                disabled={isLoadingAcceptanceReport}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-slate-200 disabled:opacity-60"
              >
                {isLoadingAcceptanceReport ? '刷新中...' : '刷新报告'}
              </button>
              <button
                type="button"
                onClick={() => void handleArchiveAcceptanceReport()}
                disabled={isArchivingAcceptanceReport || !acceptanceReport}
                className="px-3 py-1.5 rounded-lg bg-accent text-slate-950 hover:bg-accent/90 text-xs font-semibold disabled:opacity-60"
              >
                {isArchivingAcceptanceReport ? '归档中...' : '归档到交付物'}
              </button>
              <button
                type="button"
                onClick={() => void handleExportAcceptanceReport()}
                disabled={isExportingAcceptanceReport || !acceptanceReport}
                className="px-3 py-1.5 rounded-lg bg-primary text-slate-950 hover:bg-primary/90 text-xs font-semibold disabled:opacity-60 flex items-center gap-1.5"
              >
                <Download size={12} />
                {isExportingAcceptanceReport ? '导出中...' : '导出 Markdown'}
              </button>
            </div>
          </div>

          {isLoadingAcceptanceReport ? (
            <div className="rounded-xl border border-border-subtle bg-surface-muted p-6 text-sm text-slate-400">
              正在加载验收报告...
            </div>
          ) : null}

          {!isLoadingAcceptanceReport && !acceptanceReport ? (
            <div className="rounded-xl border border-border-subtle bg-surface-muted p-6 text-sm text-slate-500">
              暂无验收报告数据
            </div>
          ) : null}

          {acceptanceReport ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="rounded-xl border border-border-subtle bg-surface-soft p-3">
                  <p className="text-[11px] text-slate-500">项目状态</p>
                  <p className="text-sm font-semibold text-white mt-1">{acceptanceReport.status}</p>
                </div>
                <div className="rounded-xl border border-border-subtle bg-surface-soft p-3">
                  <p className="text-[11px] text-slate-500">当前阶段</p>
                  <p className="text-sm font-semibold text-white mt-1">{acceptanceReport.currentStage}</p>
                </div>
                <div className="rounded-xl border border-border-subtle bg-surface-soft p-3">
                  <p className="text-[11px] text-slate-500">交付通过率</p>
                  <p className="text-sm font-semibold text-white mt-1">
                    {acceptanceReport.summary.deliverableCount > 0
                      ? `${Math.round((acceptanceReport.summary.approvedDeliverables / acceptanceReport.summary.deliverableCount) * 100)}%`
                      : '0%'}
                  </p>
                </div>
                <div className="rounded-xl border border-border-subtle bg-surface-soft p-3">
                  <p className="text-[11px] text-slate-500">任务状态</p>
                  <p className="text-sm font-semibold text-white mt-1">
                    阻塞 {acceptanceReport.summary.blockedTasks} / 进行中 {acceptanceReport.summary.inProgressTasks}
                  </p>
                </div>
                <div className="rounded-xl border border-border-subtle bg-surface-soft p-3">
                  <p className="text-[11px] text-slate-500">签核统计</p>
                  <p className="text-sm font-semibold text-white mt-1">
                    通过 {acceptanceReport.summary.signoffApproved} / 驳回 {acceptanceReport.summary.signoffRejected}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">最终验收成果（可直接查阅）</h4>
                  <div className="flex items-center gap-2">
                    {finalArtifacts ? (
                      <Badge variant={finalArtifacts.readyForAcceptance ? 'primary' : 'warning'}>
                        {finalArtifacts.readyForAcceptance ? '可验收确认' : `缺失 ${finalArtifacts.coverage.missing} 项`}
                      </Badge>
                    ) : (
                      <Badge variant="default">同步中</Badge>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleGenerateFinalArtifacts(finalArtifactsGeneration?.status === 'failed')}
                      disabled={isTriggeringFinalArtifacts || finalArtifactsRunning}
                      className="px-2.5 py-1 rounded-md bg-primary/15 border border-primary/30 text-[11px] text-primary hover:bg-primary/25 disabled:opacity-60"
                    >
                      {isTriggeringFinalArtifacts ? '启动中...' : finalArtifactsRunning ? '生成中...' : '重建成果'}
                    </button>
                  </div>
                </div>

                {finalArtifactsGenerationText ? (
                  <div className={cn(
                    'rounded-xl border p-3 text-xs',
                    finalArtifactsGeneration?.status === 'failed'
                      ? 'border-danger/40 bg-danger/10 text-danger'
                      : finalArtifactsRunning
                        ? 'border-accent/40 bg-accent/10 text-accent'
                        : 'border-primary/40 bg-primary/10 text-primary',
                  )}>
                    {finalArtifactsGenerationText}
                  </div>
                ) : null}

                {finalArtifacts ? (
                  <>
                    {finalArtifacts.missingRequired.length > 0 ? (
                      <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                        缺失必需产物：{finalArtifacts.missingRequired.join('、')}
                      </div>
                    ) : null}

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      {finalArtifacts.artifacts.map((artifact) => (
                        <div key={`${artifact.key}-${artifact.deliverableId || artifact.url || artifact.name}`} className="rounded-xl border border-border-subtle bg-surface-soft p-4 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs text-slate-400">{artifact.category}</p>
                            <Badge variant={artifact.ready ? (artifact.required ? 'primary' : 'accent') : 'warning'}>
                              {artifact.ready ? (artifact.required ? '必需-就绪' : '附加') : '待完善'}
                            </Badge>
                          </div>
                          <p className="text-sm font-semibold text-white">{artifact.name}</p>
                          <p className="text-[11px] text-slate-500">
                            {artifact.stageType || '-'} · {artifact.status || '-'} · {artifact.updatedAt ? new Date(artifact.updatedAt).toLocaleString('zh-CN') : '-'}
                          </p>
                          {isPrototypeLikeArtifact(artifact) ? (
                            <p className="text-[11px] text-primary">该交付物支持交互预览</p>
                          ) : null}
                          <p className="text-[11px] text-slate-500">
                            生成模型: {getArtifactModelLabel(artifact)}
                          </p>
                          <p className="text-xs text-slate-300 whitespace-pre-wrap break-words">{artifact.excerpt || '暂无摘要'}</p>
                          {(() => {
                            const access = resolveArtifactAccessUrls(artifact);
                            return (
                              <div className="text-[11px] text-slate-400 space-y-1">
                                <p className="break-all">
                                  本地地址：
                                  {access.localUrl ? (
                                    <a className="ml-1 text-primary hover:underline" href={resolveArtifactUrl(access.localUrl)} target="_blank" rel="noreferrer">
                                      {access.localUrl}
                                    </a>
                                  ) : (
                                    <span className="ml-1 text-slate-500">待生成</span>
                                  )}
                                </p>
                                <p className="break-all">
                                  外网地址：
                                  {access.publicUrl ? (
                                    <a className="ml-1 text-primary hover:underline" href={resolveArtifactUrl(access.publicUrl)} target="_blank" rel="noreferrer">
                                      {access.publicUrl}
                                    </a>
                                  ) : (
                                    <span className="ml-1 text-slate-500">待生成</span>
                                  )}
                                </p>
                              </div>
                            );
                          })()}
                          {artifact.issue ? <p className="text-[11px] text-warning">{artifact.issue}</p> : null}
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => handleOpenFinalArtifact(artifact)}
                              className="px-2.5 py-1 rounded-md bg-white/5 border border-border-subtle text-[11px] text-slate-200 hover:bg-white/10 flex items-center gap-1"
                            >
                              {artifact.source === 'link' ? <ExternalLink size={11} /> : <FileText size={11} />}
                              {isPrototypeLikeArtifact(artifact)
                                ? '查看交互原型'
                                : artifact.source === 'link'
                                  ? '打开链接'
                                  : '查看内容'}
                            </button>
                            {(() => {
                              const access = resolveArtifactAccessUrls(artifact);
                              return (
                                <>
                                  {access.localUrl ? (
                                    <button
                                      type="button"
                                      onClick={() => window.open(resolveArtifactUrl(access.localUrl), '_blank', 'noopener,noreferrer')}
                                      className="px-2.5 py-1 rounded-md bg-white/5 border border-border-subtle text-[11px] text-slate-300 hover:bg-white/10"
                                    >
                                      打开本地地址
                                    </button>
                                  ) : null}
                                  {access.publicUrl ? (
                                    <button
                                      type="button"
                                      onClick={() => window.open(resolveArtifactUrl(access.publicUrl), '_blank', 'noopener,noreferrer')}
                                      className="px-2.5 py-1 rounded-md bg-white/5 border border-border-subtle text-[11px] text-slate-300 hover:bg-white/10"
                                    >
                                      打开外网地址
                                    </button>
                                  ) : null}
                                </>
                              );
                            })()}
                            {artifact.content ? (
                              <button
                                type="button"
                                onClick={() => void handleDownloadFinalArtifact(artifact)}
                                disabled={downloadingArtifactKey === artifact.key}
                                className="px-2.5 py-1 rounded-md bg-primary/15 border border-primary/30 text-[11px] text-primary hover:bg-primary/25 disabled:opacity-60 flex items-center gap-1"
                              >
                                <Download size={11} />
                                {downloadingArtifactKey === artifact.key ? '下载中...' : '下载文件'}
                              </button>
                            ) : null}
                            {artifact.url ? (
                              <button
                                type="button"
                                onClick={() => void handleCopyFinalArtifactLink(artifact)}
                                className="px-2.5 py-1 rounded-md bg-white/5 border border-border-subtle text-[11px] text-slate-300 hover:bg-white/10 flex items-center gap-1"
                              >
                                <Copy size={11} />
                                复制链接
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-xl border border-border-subtle bg-surface-soft p-4 space-y-1.5">
                      <h5 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">验收确认清单</h5>
                      {finalArtifacts.checklist.map((item) => (
                        <p key={item} className="text-xs text-slate-300">- {item}</p>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="rounded-xl border border-border-subtle bg-surface-soft p-4 text-xs text-slate-500">
                    正在加载最终验收成果...
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="rounded-xl border border-border-subtle bg-surface-soft p-4 space-y-2">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">报告对比（相对上次归档）</h4>
                  {acceptanceReport.comparison ? (
                    <div className="space-y-1.5 text-xs">
                      <p className="text-slate-400">
                        基线: {acceptanceReport.comparison.baselineName} · {new Date(acceptanceReport.comparison.baselineGeneratedAt).toLocaleString('zh-CN')}
                      </p>
                      <p className={cn('font-medium', acceptanceReport.comparison.delta.deliverableCount > 0 ? 'text-primary' : acceptanceReport.comparison.delta.deliverableCount < 0 ? 'text-danger' : 'text-slate-300')}>
                        交付物变化: {acceptanceReport.comparison.delta.deliverableCount >= 0 ? '+' : ''}{acceptanceReport.comparison.delta.deliverableCount}
                      </p>
                      <p className={cn('font-medium', acceptanceReport.comparison.delta.approvedDeliverables > 0 ? 'text-primary' : acceptanceReport.comparison.delta.approvedDeliverables < 0 ? 'text-danger' : 'text-slate-300')}>
                        已通过交付物变化: {acceptanceReport.comparison.delta.approvedDeliverables >= 0 ? '+' : ''}{acceptanceReport.comparison.delta.approvedDeliverables}
                      </p>
                      <p className={cn('font-medium', acceptanceReport.comparison.delta.blockedTasks < 0 ? 'text-primary' : acceptanceReport.comparison.delta.blockedTasks > 0 ? 'text-danger' : 'text-slate-300')}>
                        阻塞任务变化: {acceptanceReport.comparison.delta.blockedTasks >= 0 ? '+' : ''}{acceptanceReport.comparison.delta.blockedTasks}
                      </p>
                      <p className="text-slate-400">{acceptanceReport.comparison.note}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">暂无对比基线。请先执行一次“归档到交付物”。</p>
                  )}
                </div>
                <div className="rounded-xl border border-border-subtle bg-surface-soft p-4 space-y-2">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">历史归档报告</h4>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {acceptanceReport.archivedReports.slice(0, 6).map((item) => (
                      <p key={item.id} className="text-xs text-slate-300">
                        {item.name} · v{item.version} · {new Date(item.updatedAt).toLocaleString('zh-CN')}
                      </p>
                    ))}
                    {acceptanceReport.archivedReports.length === 0 ? (
                      <p className="text-xs text-slate-500">暂无历史归档报告</p>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">阶段验收明细</h4>
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {acceptanceReport.stages.map((stage) => (
                    <div key={stage.stageType} className="rounded-xl border border-border-subtle bg-surface-soft p-4 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-white">{stage.stageLabel}</p>
                        <Badge
                          variant={
                            stage.acceptance.result === 'approved'
                              ? 'primary'
                              : stage.acceptance.result === 'rejected'
                                ? 'danger'
                                : stage.acceptance.result === 'pending'
                                  ? 'warning'
                                  : 'default'
                          }
                        >
                          {stage.acceptance.result}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-400">
                        负责人: {roleLabel(stage.assignee)} · 阶段状态: {stage.status} · 进度: {stage.progress}%
                      </p>
                      <p className="text-xs text-slate-500">
                        交付物: {stage.deliverables.total}（通过 {stage.deliverables.approved} / 待处理 {stage.deliverables.submitted} / 驳回 {stage.deliverables.rejected}）
                      </p>
                      <p className="text-xs text-slate-500">{stage.acceptance.note}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">阶段签核记录</h4>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={signoffKeyword}
                    onChange={(event) => setSignoffKeyword(event.target.value)}
                    placeholder="搜索原因/角色/阶段..."
                    className="px-3 py-1.5 rounded-lg bg-surface-muted border border-border-subtle text-xs text-slate-200 placeholder:text-slate-500 min-w-48"
                  />
                  <select
                    value={signoffStageFilter}
                    onChange={(event) => setSignoffStageFilter(event.target.value)}
                    className="px-3 py-1.5 rounded-lg bg-surface-muted border border-border-subtle text-xs text-slate-200"
                  >
                    <option value="all">全部阶段</option>
                    {signoffStageOptions.map((stageType) => (
                      <option key={stageType} value={stageType}>
                        {STAGE_LABELS[stageType] || stageType}
                      </option>
                    ))}
                  </select>
                  <select
                    value={signoffDecisionFilter}
                    onChange={(event) => setSignoffDecisionFilter(event.target.value as 'all' | 'approved' | 'rejected' | 'pending')}
                    className="px-3 py-1.5 rounded-lg bg-surface-muted border border-border-subtle text-xs text-slate-200"
                  >
                    <option value="all">全部决策</option>
                    <option value="approved">通过</option>
                    <option value="rejected">驳回</option>
                    <option value="pending">待处理</option>
                  </select>
                  <select
                    value={signoffTimeFilter}
                    onChange={(event) => setSignoffTimeFilter(event.target.value as 'all' | '24h' | '7d' | '30d')}
                    className="px-3 py-1.5 rounded-lg bg-surface-muted border border-border-subtle text-xs text-slate-200"
                  >
                    <option value="all">全部时间</option>
                    <option value="24h">近 24 小时</option>
                    <option value="7d">近 7 天</option>
                    <option value="30d">近 30 天</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setSignoffDecisionFilter('rejected')}
                    className="px-3 py-1.5 rounded-lg bg-danger/20 border border-danger/40 text-xs text-danger hover:bg-danger/30"
                  >
                    只看驳回项
                  </button>
                  <button
                    type="button"
                    onClick={handleExportFilteredSignoffMarkdown}
                    disabled={isExportingSignoffMarkdown}
                    className="px-3 py-1.5 rounded-lg bg-white/5 border border-border-subtle text-xs text-slate-300 hover:bg-white/10 disabled:opacity-60"
                  >
                    {isExportingSignoffMarkdown ? '导出中...' : '导出筛选 Markdown'}
                  </button>
                  <button
                    type="button"
                    onClick={handleExportFilteredSignoffCsv}
                    disabled={isExportingSignoffCsv}
                    className="px-3 py-1.5 rounded-lg bg-white/5 border border-border-subtle text-xs text-slate-300 hover:bg-white/10 disabled:opacity-60"
                  >
                    {isExportingSignoffCsv ? '导出中...' : '导出筛选 CSV'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCopySignoffFilterLink()}
                    disabled={isCopyingSignoffLink}
                    className="px-3 py-1.5 rounded-lg bg-white/5 border border-border-subtle text-xs text-slate-300 hover:bg-white/10 disabled:opacity-60"
                  >
                    {isCopyingSignoffLink ? '复制中...' : '复制筛选链接'}
                  </button>
                  <span className="text-xs text-slate-500">筛选后 {filteredSignoffHistory.length} 条</span>
                </div>
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {filteredSignoffHistory.map((record) => (
                    <div key={record.id} className="rounded-xl border border-border-subtle bg-surface-soft p-3 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-white font-medium">
                          {record.stageLabel}
                          {record.stageType ? ` (${record.stageType})` : ''}
                        </p>
                        <Badge
                          variant={
                            record.decision === 'approved'
                              ? 'primary'
                              : record.decision === 'rejected'
                                ? 'danger'
                                : 'warning'
                          }
                        >
                          {record.decision}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        {new Date(record.timestamp).toLocaleString('zh-CN')} · {roleLabel(record.actor)}
                      </p>
                      <p className="text-xs text-slate-300 whitespace-pre-wrap break-words">{record.reason}</p>
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => handleInspectSignoffStage(record.stageType)}
                          className="px-2.5 py-1 rounded-md bg-white/5 border border-border-subtle text-[11px] text-slate-300 hover:bg-white/10"
                        >
                          查看该阶段交付物
                        </button>
                      </div>
                    </div>
                  ))}
                  {filteredSignoffHistory.length === 0 ? (
                    <p className="text-xs text-slate-500">暂无签核记录</p>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="rounded-xl border border-border-subtle bg-surface-soft p-4 space-y-2">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">最近交付物</h4>
                  <div className="space-y-1.5 max-h-44 overflow-y-auto">
                    {acceptanceReport.recentDeliverables.slice(0, 8).map((item) => (
                      <p key={item.id} className="text-xs text-slate-300">
                        {item.name} · {item.stageType} · v{item.version} · {item.status}
                      </p>
                    ))}
                    {acceptanceReport.recentDeliverables.length === 0 ? <p className="text-xs text-slate-500">暂无</p> : null}
                  </div>
                </div>
                <div className="rounded-xl border border-border-subtle bg-surface-soft p-4 space-y-2">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">建议动作</h4>
                  <div className="space-y-1.5">
                    {acceptanceReport.recommendations.map((item) => (
                      <p key={item} className="text-xs text-slate-300">- {item}</p>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </SurfaceModal>

      <SurfaceModal
        isOpen={isDesignReviewOpen}
        onClose={() => setIsDesignReviewOpen(false)}
        title="设计审查卡（需求不清晰时介入）"
        panelClassName="max-w-3xl"
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-2">
              <span className="text-xs text-slate-400">视觉方向</span>
              <input
                value={designReviewForm.visualDirection}
                onChange={(e) => setDesignReviewForm((prev) => ({ ...prev, visualDirection: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-surface-muted border border-border-subtle text-sm text-white"
                placeholder="例如：可信赖科技蓝 + 高信息密度"
              />
            </label>
            <label className="space-y-2">
              <span className="text-xs text-slate-400">品牌语气</span>
              <input
                value={designReviewForm.brandTone}
                onChange={(e) => setDesignReviewForm((prev) => ({ ...prev, brandTone: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-surface-muted border border-border-subtle text-sm text-white"
                placeholder="例如：专业、直接、可执行"
              />
            </label>
          </div>

          <label className="space-y-2 block">
            <span className="text-xs text-slate-400">版式策略</span>
            <textarea
              value={designReviewForm.layoutStrategy}
              onChange={(e) => setDesignReviewForm((prev) => ({ ...prev, layoutStrategy: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 rounded-lg bg-surface-muted border border-border-subtle text-sm text-white"
              placeholder="例如：首屏价值说明 -> 能力矩阵 -> 流程闭环 -> 案例 -> CTA"
            />
          </label>

          <label className="space-y-2 block">
            <span className="text-xs text-slate-400">组件规范</span>
            <textarea
              value={designReviewForm.componentSpecs}
              onChange={(e) => setDesignReviewForm((prev) => ({ ...prev, componentSpecs: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 rounded-lg bg-surface-muted border border-border-subtle text-sm text-white"
              placeholder="例如：Hero、能力卡、流程步骤、案例引用、联系 CTA"
            />
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-2 block">
              <span className="text-xs text-slate-400">UX 原则（至少 3 条，换行分隔）</span>
              <textarea
                value={designReviewForm.uxPrinciples}
                onChange={(e) => setDesignReviewForm((prev) => ({ ...prev, uxPrinciples: e.target.value }))}
                rows={4}
                className="w-full px-3 py-2 rounded-lg bg-surface-muted border border-border-subtle text-sm text-white"
                placeholder={'主路径优先\n强反馈\n低认知负担'}
              />
            </label>
            <label className="space-y-2 block">
              <span className="text-xs text-slate-400">可访问性清单（至少 3 条，换行分隔）</span>
              <textarea
                value={designReviewForm.accessibilityChecklist}
                onChange={(e) => setDesignReviewForm((prev) => ({ ...prev, accessibilityChecklist: e.target.value }))}
                rows={4}
                className="w-full px-3 py-2 rounded-lg bg-surface-muted border border-border-subtle text-sm text-white"
                placeholder={'对比度 >= 4.5\n键盘可达\n语义化标题结构'}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-2">
              <span className="text-xs text-slate-400">审查人</span>
              <input
                value={designReviewForm.approvedBy}
                onChange={(e) => setDesignReviewForm((prev) => ({ ...prev, approvedBy: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-surface-muted border border-border-subtle text-sm text-white"
              />
            </label>
            <label className="space-y-2 block">
              <span className="text-xs text-slate-400">审查备注</span>
              <input
                value={designReviewForm.notes}
                onChange={(e) => setDesignReviewForm((prev) => ({ ...prev, notes: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-surface-muted border border-border-subtle text-sm text-white"
                placeholder="可选"
              />
            </label>
          </div>

          <div className="p-3 rounded-xl border border-border-subtle bg-white/5 space-y-1">
            {designReviewTips.map((tip) => (
              <p key={tip} className="text-xs text-slate-400">- {tip}</p>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={designReviewForm.approved}
                onChange={(e) => setDesignReviewForm((prev) => ({ ...prev, approved: e.target.checked }))}
              />
              审查通过（不勾选将无法提交）
            </label>
            <button
              onClick={() => void handleSubmitDesignReview()}
              disabled={isSubmittingDesignReview || !designReviewForm.approved}
              className="px-4 py-2 bg-primary text-slate-950 rounded-lg text-sm font-semibold disabled:opacity-60"
            >
              {isSubmittingDesignReview ? '提交中...' : '提交审查卡'}
            </button>
          </div>
        </div>
      </SurfaceModal>

      <SurfaceModal
        isOpen={Boolean(previewDeliverable)}
        onClose={() => setPreviewDeliverable(null)}
        title={previewDeliverable?.name || '交付物预览'}
        panelClassName="max-w-4xl"
      >
        <div className="space-y-3">
          {previewDeliverable ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={statusVariantByDeliverable(previewDeliverable.status)}>{DELIVERABLE_STATUS_LABELS[previewDeliverable.status]}</Badge>
                <Badge variant={isDeliverableReadable(previewDeliverable) ? 'accent' : 'warning'}>
                  {isDeliverableReadable(previewDeliverable) ? '正文完整' : `正文偏短 (${getDeliverableContentLength(previewDeliverable)} 字)`}
                </Badge>
                {previewDeliverableStitchStatusLabel ? (
                  <Badge variant={previewDeliverableStitchStatusVariant}>{previewDeliverableStitchStatusLabel}</Badge>
                ) : null}
                <span className="text-xs text-slate-500">
                  阶段: {STAGE_LABELS[previewDeliverable.stageType] || previewDeliverable.stageType} ·
                  版本 v{previewDeliverable.version ?? 1} ·
                  产出人 {roleLabel(previewDeliverable.createdBy)} ·
                  生成模型 {getStageModelLabel(previewDeliverable.stageType)} ·
                  更新于 {new Date(previewDeliverable.updatedAt).toLocaleString('zh-CN')}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleDownloadDeliverable(previewDeliverable)}
                  disabled={downloadingDeliverableId === previewDeliverable.id}
                  className="px-3 py-1.5 rounded-md bg-primary/15 border border-primary/30 text-xs text-primary hover:bg-primary/25 disabled:opacity-60 flex items-center gap-1"
                >
                  <Download size={12} />
                  {downloadingDeliverableId === previewDeliverable.id ? '下载中...' : '下载交付物'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopyDeliverableContent(previewDeliverable)}
                  className="px-3 py-1.5 rounded-md bg-white/5 border border-border-subtle text-xs text-slate-200 hover:bg-white/10 flex items-center gap-1"
                >
                  <Copy size={12} />
                  复制正文
                </button>
              </div>
              {isVisualPreviewDeliverable(previewDeliverable) ? (
                <div className="rounded-xl border border-warning/20 bg-warning/8 p-3">
                  <p className="text-xs font-semibold text-white">这是交付物静态预览，不是 5173 的实时项目页面</p>
                  <p className="mt-1 text-[11px] leading-5 text-slate-300">
                    该窗口仅用于确认设计稿或 HTML 产物本身是否可读、可审查。
                    如果要判断项目当前状态、审批结果或新建项目弹窗内容，请回到实时前端页面与 API 状态查看。
                  </p>
                  <p className="mt-1 text-[11px] leading-5 text-slate-300">
                    说明：视觉设计稿属于 DESIGN 阶段产物（设计 Agent 输出）；最终可运行原型属于 DEV/ACCEPT 阶段产物（研发 Agent 输出），两者不等价。
                  </p>
                </div>
              ) : null}
              {activeStitchPreview ? (
                <div className="rounded-xl border border-border-subtle bg-surface-soft/30 p-3 space-y-2">
                  <p className="text-xs text-slate-200 font-medium">Stitch 回传信息</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-slate-300">
                    {activeStitchPreview.projectId ? <span>projectId: {activeStitchPreview.projectId}</span> : null}
                    {activeStitchPreview.screenId ? <span>screenId: {activeStitchPreview.screenId}</span> : null}
                    {activeStitchPreview.provider ? <span>provider: {activeStitchPreview.provider}</span> : null}
                    {activeStitchPreview.executor ? <span>executor: {activeStitchPreview.executor}</span> : null}
                    {activeStitchPreview.generatedAt ? <span>generatedAt: {activeStitchPreview.generatedAt}</span> : null}
                    {activeStitchPreview.requestedAt ? <span>requestedAt: {activeStitchPreview.requestedAt}</span> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {activeStitchPreview.htmlUrl ? (
                      <a
                        href={activeStitchPreview.htmlUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 rounded-md bg-primary/15 border border-primary/30 text-xs text-primary hover:bg-primary/25"
                      >
                        打开 Stitch HTML
                      </a>
                    ) : null}
                    {activeStitchPreview.imageUrl ? (
                      <a
                        href={activeStitchPreview.imageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 rounded-md bg-white/5 border border-border-subtle text-xs text-slate-200 hover:bg-white/10"
                      >
                        打开 Stitch 图片
                      </a>
                    ) : null}
                  </div>
                  {activeStitchPreview.error ? (
                    <p className="text-[11px] text-warning">stitchError: {activeStitchPreview.error}</p>
                  ) : null}
                  {activeStitchPreview.hint ? (
                    <p className="text-[11px] text-slate-400">stitchHint: {activeStitchPreview.hint}</p>
                  ) : null}
                </div>
              ) : null}
              {shouldPreferRemoteVisualPreview && !previewDeliverableStitchMeta ? (
                <p className="text-[11px] text-slate-400">
                  检测到更新的 Stitch 设计回传，已优先展示最新可用稿，避免旧正文片段造成预览偏差。
                </p>
              ) : null}
              {canRenderVisualPreview ? (
                <div className="rounded-xl border border-border-subtle bg-surface-soft/40 p-3 space-y-2">
                  <p className="text-xs text-slate-300">视觉设计预览（确认后再进入开发）</p>
                  {useInlineVisualPreview ? (
                    <iframe
                      title="视觉设计预览"
                      sandbox=""
                      srcDoc={previewDeliverableHtmlInline || undefined}
                      className="w-full h-[58vh] rounded-lg border border-border-subtle bg-white"
                    />
                  ) : null}
                  {!useInlineVisualPreview && previewDeliverableHtmlUrl ? (
                    <iframe
                      title="视觉设计预览（Stitch）"
                      sandbox=""
                      src={previewDeliverableHtmlUrl}
                      className="w-full h-[58vh] rounded-lg border border-border-subtle bg-white"
                    />
                  ) : null}
                  {!useInlineVisualPreview && !previewDeliverableHtmlUrl && previewDeliverableImage ? (
                    <img
                      src={previewDeliverableImage}
                      alt="视觉设计稿预览"
                      className="w-full max-h-[58vh] object-contain rounded-lg border border-border-subtle bg-slate-950"
                    />
                  ) : null}
                </div>
              ) : null}
              {previewDeliverable && isVisualPreviewDeliverable(previewDeliverable) && !canRenderVisualPreview ? (
                <p className="text-xs text-warning">
                  当前未检测到可渲染的视觉预览，请在交付物中补充静态图链接或 ```html 单页代码。
                </p>
              ) : null}
              <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-border-subtle bg-surface-muted p-4">
                <pre className="text-xs leading-6 text-slate-200 whitespace-pre-wrap break-words">{previewDeliverable.content || '该交付物暂无正文内容。'}</pre>
              </div>
            </>
          ) : null}
        </div>
      </SurfaceModal>
    </div>
  );
};

export default ProjectRoom;
