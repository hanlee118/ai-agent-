import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import type { TaskDelegation, TaskDependencySummary } from '../../lib/api';

type BadgeVariant = 'default' | 'primary' | 'accent' | 'warning' | 'danger';

type SelectedTaskLike = {
  id: string;
  dependencies?: TaskDependencySummary[];
  delegationSummary?: Array<{
    id: string;
    mode: string;
    status: TaskDelegation['status'];
    targetAgentId?: string;
    retryCount: number;
    maxRetries: number;
  }>;
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

export function TaskDelegationStatusPanel(props: {
  selectedTask: SelectedTaskLike;
  selectedTaskDelegations: TaskDelegation[];
  isLoadingTaskDelegations: boolean;
  taskActionLoadingKey: string | null;
  delegationStatusLabels: Record<TaskDelegation['status'], string>;
  statusVariantByDelegation: (status: TaskDelegation['status']) => BadgeVariant;
  getDispatchLoadingKey?: (delegationId: string) => string;
  getRetryLoadingKey?: (delegationId: string) => string;
  getCancelLoadingKey?: (delegationId: string) => string;
  emptyStateText?: string;
  onDispatch: (delegationId: string) => void;
  onRetry: (delegationId: string) => void;
  onCancel: (delegationId: string) => void;
}) {
  const {
    selectedTask,
    selectedTaskDelegations,
    isLoadingTaskDelegations,
    taskActionLoadingKey,
    delegationStatusLabels,
    statusVariantByDelegation,
    getDispatchLoadingKey,
    getRetryLoadingKey,
    getCancelLoadingKey,
    emptyStateText,
    onDispatch,
    onRetry,
    onCancel,
  } = props;

  const resolveDispatchLoadingKey = (delegationId: string) =>
    getDispatchLoadingKey ? getDispatchLoadingKey(delegationId) : `delegation-dispatch:${delegationId}`;
  const resolveRetryLoadingKey = (delegationId: string) =>
    getRetryLoadingKey ? getRetryLoadingKey(delegationId) : `delegation-retry:${delegationId}`;
  const resolveCancelLoadingKey = (delegationId: string) =>
    getCancelLoadingKey ? getCancelLoadingKey(delegationId) : `delegation-cancel:${delegationId}`;

  return (
    <div className="rounded-2xl border border-border-subtle bg-surface/60 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-widest text-slate-500">当前 delegation 状态</p>
        {isLoadingTaskDelegations ? <Badge variant="default">加载中</Badge> : null}
      </div>
      {selectedTask.dependencies && selectedTask.dependencies.length > 0 ? (
        <div className="rounded-xl border border-border-subtle bg-surface-soft/70 p-3 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">任务依赖</p>
          <div className="space-y-2">
            {selectedTask.dependencies.map((dependency) => (
              <div key={dependency.id} className="text-xs text-slate-300">
                <span className="font-medium">{dependency.dependsOnTaskTitle || dependency.dependsOnTaskId}</span>
                <span className="text-slate-500"> · {dependency.dependsOnTaskStatus || dependency.type}</span>
                {dependency.dependsOnOwnerAgentId ? (
                  <span className="text-slate-500"> · owner {dependency.dependsOnOwnerAgentId}</span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {selectedTask.delegationSummary && selectedTask.delegationSummary.length > 0 ? (
        <div className="rounded-xl border border-border-subtle bg-surface-soft/70 p-3 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">摘要视图</p>
          <div className="space-y-2">
            {selectedTask.delegationSummary.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                <Badge variant={statusVariantByDelegation(item.status)}>{delegationStatusLabels[item.status]}</Badge>
                <span>{item.mode}</span>
                <span className="text-slate-500">target {item.targetAgentId || '默认 owner'}</span>
                <span className="text-slate-500">retry {item.retryCount}/{item.maxRetries}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {selectedTaskDelegations.length > 0 ? (
        <div className="space-y-3">
          {selectedTaskDelegations.map((delegation) => (
            <div key={delegation.id} className="rounded-xl border border-border-subtle bg-surface-soft/70 p-3 space-y-3">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={statusVariantByDelegation(delegation.status)}>
                      {delegationStatusLabels[delegation.status]}
                    </Badge>
                    <Badge variant="default">{delegation.mode}</Badge>
                    <Badge variant="default">target: {delegation.targetAgentId || '默认 owner'}</Badge>
                    <Badge variant="default">retry {delegation.retryCount}/{delegation.maxRetries}</Badge>
                  </div>
                  <p className="text-sm font-semibold text-white">{delegation.title}</p>
                  <p className="text-xs text-slate-400 whitespace-pre-wrap break-words">{delegation.goal}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {delegation.status === 'queued' ? (
                    <button
                      type="button"
                      onClick={() => onDispatch(delegation.id)}
                      disabled={taskActionLoadingKey === resolveDispatchLoadingKey(delegation.id)}
                      className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-primary/90 disabled:opacity-60"
                    >
                      {taskActionLoadingKey === resolveDispatchLoadingKey(delegation.id) ? '执行中...' : '执行 delegation'}
                    </button>
                  ) : null}
                  {['failed', 'cancelled', 'expired'].includes(delegation.status) && delegation.retryCount < delegation.maxRetries ? (
                    <button
                      type="button"
                      onClick={() => onRetry(delegation.id)}
                      disabled={taskActionLoadingKey === resolveRetryLoadingKey(delegation.id)}
                      className="rounded-lg bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-60"
                    >
                      {taskActionLoadingKey === resolveRetryLoadingKey(delegation.id) ? '重试中...' : '重新排队'}
                    </button>
                  ) : null}
                  {delegation.status === 'queued' || delegation.status === 'running' ? (
                    <button
                      type="button"
                      onClick={() => onCancel(delegation.id)}
                      disabled={taskActionLoadingKey === resolveCancelLoadingKey(delegation.id)}
                      className="rounded-lg bg-danger/15 px-3 py-2 text-xs font-semibold text-danger hover:bg-danger/20 disabled:opacity-60"
                    >
                      {taskActionLoadingKey === resolveCancelLoadingKey(delegation.id) ? '取消中...' : '取消'}
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="grid gap-2 text-[11px] text-slate-500 md:grid-cols-2">
                <p>创建时间: {new Date(delegation.createdAt).toLocaleString('zh-CN')}</p>
                <p>开始时间: {delegation.startedAt ? new Date(delegation.startedAt).toLocaleString('zh-CN') : '未开始'}</p>
                <p>完成时间: {delegation.completedAt ? new Date(delegation.completedAt).toLocaleString('zh-CN') : '未完成'}</p>
                <p>超时时间: {delegation.expiredAt ? new Date(delegation.expiredAt).toLocaleString('zh-CN') : '无'}</p>
              </div>
              {delegation.outputSummary ? (
                <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-slate-200 whitespace-pre-wrap break-words">
                  {delegation.outputSummary}
                </div>
              ) : null}
              {delegation.failureReason ? (
                <div className="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-xs text-danger whitespace-pre-wrap break-words">
                  {delegation.failureReason}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-border-subtle bg-surface-soft p-4 text-xs text-slate-500">
          {emptyStateText || '当前任务还没有 delegation。可以先配置 owner/reviewer，再创建第一条 delegation，观察真实 dispatch、merge 与状态回写。'}
        </div>
      )}
    </div>
  );
}
