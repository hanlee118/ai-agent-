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
import type { ProjectStatus, Task } from '../types';
import { useSSE } from '../hooks/useSSE';
import {
  projectsApi,
  ApiRequestError,
  type ProjectAcceptanceReport,
  type ProjectExecutionRecord,
  type ProjectFinalArtifactsReport,
  type ProjectRequiredAction,
} from '../lib/api';
import { agents, projects, tasks } from '../lib/runtimeCollections';
import SurfaceModal from './impl/SurfaceModal';

type ProjectRoomTab = '任务' | '阶段' | '交付物' | '时间线';
type ProjectRoomTabParam = 'tasks' | 'stages' | 'deliverables' | 'timeline';
type CoreStageStatus = 'pending' | 'active' | 'completed' | 'blocked' | 'rejected';
type CoreTaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done';
type DeliverableStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

type ProjectDetailResponse = {
  id: string;
  name: string;
  status: string;
  currentStage: string;
  pendingApproval: boolean;
  progress: number;
  summary?: string;
  team?: string[];
  stages?: Array<{
    type: string;
    label: string;
    assignee: string;
    status: CoreStageStatus;
    progress: number;
    startedAt?: string;
    endedAt?: string;
  }>;
  tasks?: Array<{
    id: string;
    projectId: string;
    stageType: string;
    title: string;
    description: string;
    assignee: string;
    status: CoreTaskStatus;
    priority: 'low' | 'normal' | 'high';
    updatedAt: string;
  }>;
  deliverables?: Array<{
    id: string;
    name: string;
    type: string;
    status: DeliverableStatus;
    stageType: string;
    content?: string;
    version?: number;
    createdBy?: string;
    updatedAt: string;
  }>;
  timeline?: Array<{
    id: string;
    timestamp: string;
    agentId?: string;
    type: string;
    title: string;
    content: string;
    priority: 'low' | 'normal' | 'high' | 'urgent';
  }>;
  requiredActions?: ProjectRequiredAction[];
};

type ProjectDeliverable = NonNullable<ProjectDetailResponse['deliverables']>[number];
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

const toTaskStatus = (status: CoreTaskStatus): Task['status'] => {
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

const toTaskProgress = (status: CoreTaskStatus) => {
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

const roleLabel = (roleId?: string) => ROLE_LABELS[String(roleId || '')] || roleId || '系统';
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

const statusVariantByDeliverable = (status: DeliverableStatus) => {
  if (status === 'approved') return 'primary';
  if (status === 'submitted') return 'accent';
  if (status === 'rejected') return 'danger';
  return 'default';
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
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [isIntervening, setIsIntervening] = useState(false);
  const [isReviewingStage, setIsReviewingStage] = useState(false);
  const [stageReviewAction, setStageReviewAction] = useState<'approve' | 'reject' | null>(null);
  const [projectActionHint, setProjectActionHint] = useState<string | null>(null);
  const [isSubmittingDesignReview, setIsSubmittingDesignReview] = useState(false);
  const [isDesignReviewOpen, setIsDesignReviewOpen] = useState(false);
  const [isAcceptanceReportOpen, setIsAcceptanceReportOpen] = useState(false);
  const [isLoadingAcceptanceReport, setIsLoadingAcceptanceReport] = useState(false);
  const [isExportingAcceptanceReport, setIsExportingAcceptanceReport] = useState(false);
  const [isArchivingAcceptanceReport, setIsArchivingAcceptanceReport] = useState(false);
  const [acceptanceReport, setAcceptanceReport] = useState<ProjectAcceptanceReport | null>(null);
  const [finalArtifacts, setFinalArtifacts] = useState<ProjectFinalArtifactsReport | null>(null);
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
  const signoffAutoOpenKeyRef = useRef<string | null>(null);
  const projectRoomUrlStateAppliedRef = useRef<string | null>(null);
  const lastSnapshotDigestRef = useRef<string>('');
  const lastConnectedLogAtRef = useRef<number>(0);
  const [previewDeliverable, setPreviewDeliverable] = useState<ProjectDeliverable | null>(null);
  const [requiredActionLoadingId, setRequiredActionLoadingId] = useState<string | null>(null);
  const [designReviewHistory, setDesignReviewHistory] = useState<Array<{
    submittedAt: string;
    reviewer: string;
    approved: boolean;
    visualDirection: string;
  }>>([]);
  const [designReviewForm, setDesignReviewForm] = useState({
    visualDirection: '',
    brandTone: '',
    layoutStrategy: '',
    componentSpecs: '',
    uxPrinciples: '',
    accessibilityChecklist: '',
    approvedBy: '视觉设计总监',
    notes: '',
    approved: true,
  });
  const missingProjectHandledRef = useRef<string | null>(null);
  const addToastRef = useRef(addToast);
  const onProjectMissingRef = useRef(onProjectMissing);
  const lastDetailErrorRef = useRef<{ projectId: string; message: string; at: number } | null>(null);

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

  const loadProjectDetail = useCallback(async () => {
    if (!effectiveProjectId) {
      setDetail(null);
      return;
    }
    setLoadingDetail(true);
    try {
      const next = await projectsApi.getDetail(effectiveProjectId);
      setDetail(next);
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

  const fallbackTasks = useMemo(
    () =>
      tasks.filter((task) => {
        const targetProjectId = effectiveProjectId;
        const taskProjectId = (task as Task & { projectId?: string }).projectId;
        if (targetProjectId && taskProjectId) {
          return taskProjectId === targetProjectId;
        }
        return Boolean(targetProjectId) && String(task.id).startsWith(`${targetProjectId}:`);
      }),
    [effectiveProjectId],
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
            stageType: item.stageType,
            projectId: item.projectId,
            createdAt: item.updatedAt,
            updatedAt: item.updatedAt,
          }))
        : [],
    [detail?.tasks],
  );

  const effectiveProjectTasks = detailTasks.length > 0 ? detailTasks : fallbackTasks;

  const groupedProjectTasks = useMemo(() => {
    const grouped = new Map<string, typeof effectiveProjectTasks>();
    for (const task of effectiveProjectTasks) {
      const stageType = String((task as Task & { stageType?: string }).stageType || 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN';
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
    if (Array.isArray(detail?.stages) && detail.stages.length > 0) {
      return [...detail.stages].sort((a, b) => STAGE_ORDER.indexOf(a.type) - STAGE_ORDER.indexOf(b.type));
    }
    return [
      {
        type: 'UNKNOWN',
        label: project.phase || '当前阶段',
        assignee: project.owner || '未分配',
        status: 'active' as CoreStageStatus,
        progress: project.progress || 0,
      },
    ];
  }, [detail?.stages, project.phase, project.owner, project.progress]);

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
      const taskRecord = task as Task & { updatedAt?: string; createdAt?: string };
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

  const quickFinalArtifacts = useMemo(
    () => (finalArtifacts?.artifacts || []).slice(0, 5),
    [finalArtifacts],
  );
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

  const isDesignPhase = useMemo(() => {
    const text = [project.phase, project.description, ...effectiveProjectTasks.map((task) => `${task.title} ${task.agent}`)]
      .join(' ')
      .toLowerCase();
    return /(design|设计|视觉|交互|页面|官网)/i.test(text);
  }, [project.phase, project.description, effectiveProjectTasks]);

  const getTaskTimestamp = (task: Task) => {
    const taskRecord = task as Task & { updatedAt?: string; createdAt?: string };
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
    lastSnapshotDigestRef.current = '';
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
      const digest = [
        String(payload.activeAgents ?? ''),
        String(payload.totalProjects ?? ''),
        String(payload.blockedTasks ?? ''),
        String(payload.inProgressTasks ?? ''),
      ].join(':');
      if (digest && digest === lastSnapshotDigestRef.current) {
        return;
      }
      lastSnapshotDigestRef.current = digest;
      timestamp = toLogTimestamp(payload.timestamp as string | undefined);
      message = `系统快照: 活跃Agent ${payload.activeAgents ?? 0} / 项目 ${payload.totalProjects ?? 0} / 进行中任务 ${payload.inProgressTasks ?? 0} / 阻塞任务 ${payload.blockedTasks ?? 0}`;
      type = Number(payload.blockedTasks ?? 0) > 0 ? 'danger' : 'primary';
    } else if (eventType === 'task_update') {
      timestamp = toLogTimestamp(payload.timestamp as string | undefined);
      const blocked = Number(payload.blockedTasks ?? 0);
      const inProgress = Number(payload.inProgressTasks ?? 0);
      const total = Number(payload.totalTasks ?? 0);
      message = blocked > 0
        ? `任务变化: 共 ${total} 条，进行中 ${inProgress}，阻塞 ${blocked}（需处理）`
        : `任务变化: 共 ${total} 条，进行中 ${inProgress}，阻塞 ${blocked}`;
      type = Number(payload.blockedTasks ?? 0) > 0 ? 'danger' : 'accent';
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
    } else if (eventType === 'agent_status') {
      timestamp = toLogTimestamp(payload.timestamp as string | undefined);
      const changedAgents = Array.isArray(payload.changedAgents)
        ? payload.changedAgents as Array<{ name?: string; status?: string; blockedTaskCount?: number; taskCount?: number }>
        : [];
      if (changedAgents.length === 0) {
        return;
      }
      const latest = changedAgents[0];
      actor = latest.name || 'Agent';
      const taskText = typeof latest.taskCount === 'number' ? ` · 任务 ${latest.taskCount}` : '';
      const blockedText = typeof latest.blockedTaskCount === 'number' ? ` · 阻塞 ${latest.blockedTaskCount}` : '';
      message = `状态变更为 ${latest.status || 'unknown'}${taskText}${blockedText}`;
      type = latest.status === 'attention' || latest.status === 'offline' ? 'danger' : 'primary';
    } else if (eventType === 'system') {
      timestamp = toLogTimestamp(payload.timestamp as string | undefined);
      const status = String(payload.status || 'ok');
      message = String(payload.message || '系统状态更新');
      type = status === 'degraded' ? 'danger' : 'primary';
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
  }, [appendSseLog, effectiveProjectId]);

  const sseEvents = useMemo(
    () => ['connected', 'snapshot', 'task_update', 'project_progress', 'agent_status', 'system', 'heartbeat'],
    [],
  );

  useSSE('/api/openclaw/events', {
    withCredentials: true,
    events: sseEvents,
    onEvent: handleProjectRoomSseEvent,
  });

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

  const currentStageType = detail?.currentStage || stageItems.find((stage) => stage.status === 'active')?.type || stageItems[0]?.type;
  const currentStageLabel = STAGE_LABELS[currentStageType || ''] || currentStageType || '当前阶段';
  const currentStageDeliverables = currentStageType ? (deliverablesByStage.get(currentStageType) || []) : [];
  const getDeliverableContentLength = (item: Pick<ProjectDeliverable, 'content'>) => String(item.content || '').trim().length;
  const isDeliverableReadable = (item: Pick<ProjectDeliverable, 'content'>) => getDeliverableContentLength(item) >= 120;

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
      return;
    }
    setIsLoadingFinalArtifacts(true);
    try {
      const report = await projectsApi.getFinalArtifacts(effectiveProjectId);
      setFinalArtifacts(report);
    } catch (error) {
      setFinalArtifacts(null);
      if (isProjectNotFoundError(error)) {
        return;
      }
      if (!options?.silent) {
        addToast(`加载最终验收成果失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
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
      loadFinalArtifacts(),
      loadExecutions({ silent: true }),
    ]);
  }, [onRefreshData, loadExecutions, loadFinalArtifacts, loadProjectDetail]);

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

  const handleGenerateFinalArtifacts = useCallback(async (force = false) => {
    if (!effectiveProjectId) {
      return;
    }
    setIsTriggeringFinalArtifacts(true);
    try {
      await projectsApi.generateFinalArtifacts(effectiveProjectId, force);
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
      addToast(`归档验收报告失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
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

  const handleOpenFinalArtifact = (artifact: FinalArtifactItem) => {
    if (artifact.source === 'link' && artifact.url) {
      window.open(artifact.url, '_blank', 'noopener,noreferrer');
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
        stageType: artifact.stageType || 'ACCEPT',
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
    if (!artifact.url) {
      addToast('该成果没有可复制链接', 'info');
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(artifact.url);
      } else {
        window.prompt('复制以下链接', artifact.url);
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
      .map((item) => item.trim())
      .filter(Boolean);

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
      await projectsApi.submitStage(project.id, {
        title: `设计审查卡 ${new Date().toLocaleDateString('zh-CN')}`,
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
    if (error.code === 'NO_PENDING_APPROVAL') {
      addToast(error.message || '当前没有待确认事项', 'info');
      void loadProjectDetail();
      return true;
    }
    const required = Array.isArray(error.details?.requiredActions)
      ? (error.details.requiredActions as ProjectRequiredAction[])
      : [];
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
        setIsDesignReviewOpen(true);
        addToast('请先完成设计审查卡，再继续推进', 'info');
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
              onClick={() => setIsDesignReviewOpen(true)}
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
                      <p className="text-[11px] text-slate-500">
                        生成模型: {getArtifactModelLabel(artifact)}
                      </p>
                      <p className="text-[11px] text-slate-400 whitespace-pre-wrap break-words">{artifact.excerpt || '暂无摘要'}</p>
                      {artifact.issue ? <p className="text-[11px] text-warning">{artifact.issue}</p> : null}
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenFinalArtifact(artifact)}
                          className="px-2.5 py-1 rounded-md bg-white/5 border border-border-subtle text-[11px] text-slate-200 hover:bg-white/10 flex items-center gap-1"
                        >
                          {artifact.source === 'link' ? <ExternalLink size={11} /> : <FileText size={11} />}
                          {artifact.source === 'link' ? '打开链接' : '查看内容'}
                        </button>
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
                          <div key={task.id} className="bg-surface-soft border border-border-subtle p-5 rounded-2xl space-y-4 hover:border-white/20 transition-all group">
                            <div className="flex justify-between items-start">
                              <div>
                                <h4 className="font-semibold text-white text-sm group-hover:text-primary transition-colors">{task.title}</h4>
                                <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                                  <BrainCircuit size={10} />
                                  指派给: {task.agent}
                                </p>
                              </div>
                              <Badge variant={task.status === 'Completed' ? 'primary' : task.status === 'In Progress' ? 'accent' : task.status === 'Blocked' ? 'danger' : 'default'}>
                                {task.status === 'Completed' ? '已完成' : task.status === 'In Progress' ? '进行中' : task.status === 'Blocked' ? '已阻塞' : '待处理'}
                              </Badge>
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
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
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
                          <p className="text-[11px] text-slate-500">
                            生成模型: {getArtifactModelLabel(artifact)}
                          </p>
                          <p className="text-xs text-slate-300 whitespace-pre-wrap break-words">{artifact.excerpt || '暂无摘要'}</p>
                          {artifact.issue ? <p className="text-[11px] text-warning">{artifact.issue}</p> : null}
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => handleOpenFinalArtifact(artifact)}
                              className="px-2.5 py-1 rounded-md bg-white/5 border border-border-subtle text-[11px] text-slate-200 hover:bg-white/10 flex items-center gap-1"
                            >
                              {artifact.source === 'link' ? <ExternalLink size={11} /> : <FileText size={11} />}
                              {artifact.source === 'link' ? '打开链接' : '查看内容'}
                            </button>
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
        title="设计审查卡（开发前必填）"
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
