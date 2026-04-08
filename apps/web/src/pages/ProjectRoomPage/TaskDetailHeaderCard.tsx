import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { cn } from '../../lib/utils';

type BadgeVariant = 'default' | 'primary' | 'accent' | 'warning' | 'danger';

type SelectedTaskLike = {
  id: string;
  title: string;
  description: string;
  status: string;
  rawStatus: string;
  coordinationMode?: string;
  delegationPolicy?: string;
  syncPolicy?: string;
  stageType: string;
  assigneeRoleId: string;
  ownerAgentId?: string;
  reviewAgentId?: string;
  contextScope?: string;
  lastDelegatedAt?: string;
  blockedReason?: {
    label: string;
    detail: string;
  };
  nextAction?: {
    label: string;
    detail: string;
    actorAgentId?: string;
  };
  gitlab?: {
    webUrl?: string;
    issueIid?: number;
  };
};

function Badge({ children, variant = 'default' }: { children: ReactNode; variant?: BadgeVariant }) {
  const variants: Record<BadgeVariant, string> = {
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
}

export function TaskDetailHeaderCard(props: {
  selectedTask: SelectedTaskLike;
  defaultOwnerAgentId: string;
  stageLabels: Record<string, string>;
  taskStatusLabels: Record<string, string>;
  coordinationModeLabels: Record<string, string>;
  delegationPolicyLabels: Record<string, string>;
  syncPolicyLabels: Record<string, string>;
  contextScopeLabels: Record<string, string>;
  statusVariantByTask: (status: string) => BadgeVariant;
  roleLabel: (roleId?: string) => string;
  taskActionLoadingKey: string | null;
  readyForReviewBlockReason: string | null;
  syncActionKey?: string;
  reviewActionKey?: string;
  onSyncGitlab: () => void;
  onReadyForReview: () => void;
}) {
  const {
    selectedTask,
    defaultOwnerAgentId,
    stageLabels,
    taskStatusLabels,
    coordinationModeLabels,
    delegationPolicyLabels,
    syncPolicyLabels,
    contextScopeLabels,
    statusVariantByTask,
    roleLabel,
    taskActionLoadingKey,
    readyForReviewBlockReason,
    syncActionKey,
    reviewActionKey,
    onSyncGitlab,
    onReadyForReview,
  } = props;

  const resolvedSyncActionKey = syncActionKey || `task-sync:${selectedTask.id}`;
  const resolvedReviewActionKey = reviewActionKey || `task-review:${selectedTask.id}`;

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusVariantByTask(selectedTask.status)}>{taskStatusLabels[selectedTask.rawStatus] || selectedTask.rawStatus}</Badge>
          <Badge variant="default">{coordinationModeLabels[selectedTask.coordinationMode || 'single_owner'] || selectedTask.coordinationMode || 'single_owner'}</Badge>
          <Badge variant="default">{delegationPolicyLabels[selectedTask.delegationPolicy || 'manual_only'] || selectedTask.delegationPolicy || 'manual_only'}</Badge>
          <Badge variant="default">{syncPolicyLabels[selectedTask.syncPolicy || 'db_plus_gitlab'] || selectedTask.syncPolicy || 'db_plus_gitlab'}</Badge>
        </div>
        <div>
          <h4 className="text-base font-semibold text-white">{selectedTask.title}</h4>
          <p className="mt-1 text-xs text-slate-400 whitespace-pre-wrap break-words">
            {selectedTask.description || '当前任务尚未补充描述'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
          <span>阶段: {stageLabels[selectedTask.stageType] || selectedTask.stageType}</span>
          <span>assignee: {roleLabel(selectedTask.assigneeRoleId)}</span>
          <span>owner: {selectedTask.ownerAgentId || defaultOwnerAgentId || '未配置'}</span>
          <span>reviewer: {selectedTask.reviewAgentId || '未配置'}</span>
          <span>context: {contextScopeLabels[selectedTask.contextScope || 'local'] || selectedTask.contextScope || 'local'}</span>
          <span>最近委派: {selectedTask.lastDelegatedAt ? new Date(selectedTask.lastDelegatedAt).toLocaleString('zh-CN') : '暂无'}</span>
        </div>
        {selectedTask.blockedReason ? (
          <div className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            <p className="font-semibold">{selectedTask.blockedReason.label}</p>
            <p className="mt-1 text-warning/90">{selectedTask.blockedReason.detail}</p>
          </div>
        ) : null}
        {selectedTask.nextAction ? (
          <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-slate-200">
            <p className="font-semibold text-primary">{selectedTask.nextAction.label}</p>
            <p className="mt-1 text-slate-300">{selectedTask.nextAction.detail}</p>
            {selectedTask.nextAction.actorAgentId ? (
              <p className="mt-1 text-[11px] text-slate-500">责任人: {selectedTask.nextAction.actorAgentId}</p>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onSyncGitlab}
          disabled={taskActionLoadingKey === resolvedSyncActionKey}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-60"
        >
          {taskActionLoadingKey === resolvedSyncActionKey ? '同步中...' : '同步 GitLab'}
        </button>
        {selectedTask.gitlab?.webUrl ? (
          <a
            href={selectedTask.gitlab.webUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
          >
            <ExternalLink size={14} />
            查看 Issue #{selectedTask.gitlab.issueIid}
          </a>
        ) : null}
        <button
          type="button"
          onClick={onReadyForReview}
          disabled={taskActionLoadingKey === resolvedReviewActionKey || Boolean(readyForReviewBlockReason)}
          title={readyForReviewBlockReason || '提交到 reviewer 审阅队列'}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-primary/90 disabled:opacity-60"
        >
          {taskActionLoadingKey === resolvedReviewActionKey ? '提交中...' : '提交审阅'}
        </button>
        {readyForReviewBlockReason ? (
          <p className="w-full text-right text-[11px] text-slate-500">{readyForReviewBlockReason}</p>
        ) : null}
      </div>
    </div>
  );
}
