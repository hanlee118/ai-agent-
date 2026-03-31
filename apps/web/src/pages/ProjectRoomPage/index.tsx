import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BrainCircuit,
  Briefcase,
  CheckCircle2,
  Copy,
  Download,
  History,
  Layers,
  Terminal,
  Zap,
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';
import type { ProjectStatus, Task } from '../../types';
import { useSSE } from '../../hooks/useSSE';
import {
  projectsApi,
  ApiRequestError,
  type ProjectAcceptanceReport,
  type ProjectExecutionRecord,
  type ProjectFinalArtifactsReport,
  type ProjectRequiredAction,
} from '../../lib/api';
import { agents, projects, tasks } from '../../lib/runtimeCollections';
import SurfaceModal from '../impl/SurfaceModal';
import { Badge } from './Badge';
import ProjectHeader from './ProjectHeader';
import StageNavigator from './StageNavigator';
import TaskBoard from './TaskBoard';
import DeliverablesPanel from './DeliverablesPanel';
import Timeline from './Timeline';
import LiveSessionPanel from './LiveSessionPanel';
import SideDeliverablesPanel, { type ProjectRoomSideDeliverableItem } from './SideDeliverablesPanel';
import DesignReviewHistoryPanel, { type ProjectRoomDesignReviewHistoryItem } from './DesignReviewHistoryPanel';
import ProjectAgentsPanel from './ProjectAgentsPanel';
import AcceptanceReportModal from './AcceptanceReportModal';
import DesignReviewModal, { type ProjectRoomDesignReviewForm } from './DesignReviewModal';

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
  const [designReviewHistory, setDesignReviewHistory] = useState<ProjectRoomDesignReviewHistoryItem[]>([]);
  const [designReviewForm, setDesignReviewForm] = useState<ProjectRoomDesignReviewForm>({
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
            projectId: item.projectId,
            createdAt: item.updatedAt,
            updatedAt: item.updatedAt,
          }))
        : [],
    [detail?.tasks],
  );

  const effectiveProjectTasks = detailTasks.length > 0 ? detailTasks : fallbackTasks;

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
    if (project.agents.length > 0) {
      return agents.filter((agent) => project.agents.includes(agent.id));
    }
    const linkedAgentNames = new Set(effectiveProjectTasks.map((task) => task.agent));
    return agents.filter((agent) => linkedAgentNames.has(agent.id) || linkedAgentNames.has(agent.name));
  }, [project.agents, effectiveProjectTasks]);

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

  const projectDeliverablesSide = useMemo<ProjectRoomSideDeliverableItem[]>(() => {
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
      <ProjectHeader
        project={{ name: project.name, phase: project.phase }}
        currentStageLabel={STAGE_LABELS[currentStageType || ''] || project.phase}
        projectBlockedCount={projectBlockedCount}
        loadingDetail={loadingDetail}
        projectActionHint={projectActionHint}
        isIntervening={isIntervening}
        isDesignPhase={isDesignPhase}
        onOpenAcceptanceReport={() => { void handleOpenAcceptanceReport(); }}
        onIntervene={() => { void handleIntervene(); }}
        onOpenDesignReview={() => setIsDesignReviewOpen(true)}
      />

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
            <DeliverablesPanel
              isLoadingFinalArtifacts={isLoadingFinalArtifacts}
              finalArtifacts={finalArtifacts}
              finalArtifactsGenerationText={finalArtifactsGenerationText}
              finalArtifactsGenerationStatus={finalArtifactsGeneration?.status}
              isTriggeringFinalArtifacts={isTriggeringFinalArtifacts}
              finalArtifactsRunning={finalArtifactsRunning}
              quickFinalArtifacts={quickFinalArtifacts}
              downloadingArtifactKey={downloadingArtifactKey}
              stageItems={stageItems}
              deliverablesByStage={deliverablesByStage}
              DELIVERABLE_STATUS_LABELS={DELIVERABLE_STATUS_LABELS}
              stageLabelMap={STAGE_LABELS}
              onGenerateFinalArtifacts={(force) => { void handleGenerateFinalArtifacts(force); }}
              onOpenFinalArtifact={handleOpenFinalArtifact}
              onDownloadFinalArtifact={(artifact) => { void handleDownloadFinalArtifact(artifact); }}
              onCopyFinalArtifactLink={(artifact) => { void handleCopyFinalArtifactLink(artifact); }}
              onPreviewDeliverable={(item) => setPreviewDeliverable(item)}
              getArtifactModelLabel={getArtifactModelLabel}
              getStageModelLabel={getStageModelLabel}
              getStageDeliverableStats={getStageDeliverableStats}
              roleLabel={roleLabel}
              isDeliverableReadable={isDeliverableReadable}
              statusVariantByDeliverable={statusVariantByDeliverable}
            />
          ) : null}

          {activeTab === '任务' ? (
            <>
              <TaskBoard tasks={effectiveProjectTasks} />
              <LiveSessionPanel logs={recentLogs} />
            </>
          ) : null}

          {activeTab === '阶段' ? (
            <StageNavigator
              currentStageLabel={currentStageLabel}
              pendingApproval={Boolean(detail?.pendingApproval)}
              currentStageDeliverables={currentStageDeliverables}
              stageItems={stageItems}
              deliverablesByStage={deliverablesByStage}
              stageReviewAction={stageReviewAction}
              isReviewingStage={isReviewingStage}
              DELIVERABLE_STATUS_LABELS={DELIVERABLE_STATUS_LABELS}
              CORE_STAGE_STATUS_LABELS={CORE_STAGE_STATUS_LABELS}
              onPreviewDeliverable={(item) => setPreviewDeliverable(item)}
              onApproveStage={() => { void handleApproveStage(); }}
              onRejectStage={() => { void handleRejectStage(); }}
              isDeliverableReadable={isDeliverableReadable}
              roleLabel={roleLabel}
              statusVariantByDeliverable={statusVariantByDeliverable}
              statusVariantByStage={statusVariantByStage}
              getStageModelLabel={getStageModelLabel}
              getStageAcceptance={getStageAcceptance}
              getStageDeliverableStats={getStageDeliverableStats}
              stageLabelMap={STAGE_LABELS}
            />
          ) : null}

          {activeTab === '时间线' ? (
            <Timeline
              executionSummary={executionSummary}
              isLoadingExecutions={isLoadingExecutions}
              executionRecords={executionRecords}
              timelineEvents={timelineEvents}
              roleLabel={roleLabel}
              stageLabelMap={STAGE_LABELS}
            />
          ) : null}
        </main>

        <aside className="w-80 border-l border-border-subtle p-6 space-y-8 hidden lg:block bg-surface-soft/30">
          <SideDeliverablesPanel
            items={projectDeliverablesSide}
            onPreviewDeliverable={(item) => setPreviewDeliverable(item)}
          />

          {isDesignPhase ? (
            <DesignReviewHistoryPanel items={designReviewHistory} />
          ) : null}

          <ProjectAgentsPanel projectAgents={projectAgents} />
        </aside>
      </div>

      <AcceptanceReportModal
        isOpen={isAcceptanceReportOpen}
        onClose={() => setIsAcceptanceReportOpen(false)}
        acceptanceReport={acceptanceReport}
        isLoadingAcceptanceReport={isLoadingAcceptanceReport}
        isArchivingAcceptanceReport={isArchivingAcceptanceReport}
        isExportingAcceptanceReport={isExportingAcceptanceReport}
        onRefresh={() => { void handleOpenAcceptanceReport(); }}
        onArchive={() => { void handleArchiveAcceptanceReport(); }}
        onExport={() => { void handleExportAcceptanceReport(); }}
        finalArtifacts={finalArtifacts}
        finalArtifactsGenerationStatus={finalArtifactsGeneration?.status}
        finalArtifactsGenerationText={finalArtifactsGenerationText}
        isTriggeringFinalArtifacts={isTriggeringFinalArtifacts}
        finalArtifactsRunning={finalArtifactsRunning}
        onGenerateFinalArtifacts={(force) => { void handleGenerateFinalArtifacts(force); }}
        getArtifactModelLabel={getArtifactModelLabel}
        onOpenFinalArtifact={handleOpenFinalArtifact}
        onDownloadFinalArtifact={(artifact) => { void handleDownloadFinalArtifact(artifact); }}
        onCopyFinalArtifactLink={(artifact) => { void handleCopyFinalArtifactLink(artifact); }}
        downloadingArtifactKey={downloadingArtifactKey}
        signoffKeyword={signoffKeyword}
        onSignoffKeywordChange={setSignoffKeyword}
        signoffStageFilter={signoffStageFilter}
        onSignoffStageFilterChange={setSignoffStageFilter}
        signoffDecisionFilter={signoffDecisionFilter}
        onSignoffDecisionFilterChange={setSignoffDecisionFilter}
        signoffTimeFilter={signoffTimeFilter}
        onSignoffTimeFilterChange={setSignoffTimeFilter}
        signoffStageOptions={signoffStageOptions}
        stageLabelMap={STAGE_LABELS}
        filteredSignoffHistory={filteredSignoffHistory}
        isExportingSignoffMarkdown={isExportingSignoffMarkdown}
        isExportingSignoffCsv={isExportingSignoffCsv}
        isCopyingSignoffLink={isCopyingSignoffLink}
        onFilterRejected={() => setSignoffDecisionFilter('rejected')}
        onExportFilteredSignoffMarkdown={handleExportFilteredSignoffMarkdown}
        onExportFilteredSignoffCsv={handleExportFilteredSignoffCsv}
        onCopySignoffFilterLink={() => { void handleCopySignoffFilterLink(); }}
        onInspectSignoffStage={handleInspectSignoffStage}
        roleLabel={roleLabel}
      />

      <DesignReviewModal
        isOpen={isDesignReviewOpen}
        onClose={() => setIsDesignReviewOpen(false)}
        form={designReviewForm}
        setForm={setDesignReviewForm}
        tips={designReviewTips}
        isSubmitting={isSubmittingDesignReview}
        onSubmit={() => { void handleSubmitDesignReview(); }}
      />

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
