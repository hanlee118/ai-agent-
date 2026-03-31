import { CheckCircle2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { CoreStageStatus, DeliverableStatus } from './projectRoomShared';
import { Badge } from './Badge';

type StageItem = {
  type: string;
  label: string;
  assignee: string;
  status: CoreStageStatus;
  progress: number;
  startedAt?: string;
  endedAt?: string;
};

type StageDeliverable = {
  id: string;
  name: string;
  type: string;
  stageType: string;
  status: DeliverableStatus;
  createdBy?: string;
  updatedAt: string;
  content?: string;
};

type Props = {
  currentStageLabel: string;
  pendingApproval: boolean;
  currentStageDeliverables: StageDeliverable[];
  stageItems: StageItem[];
  deliverablesByStage: Map<string, StageDeliverable[]>;
  stageReviewAction: 'approve' | 'reject' | null;
  isReviewingStage: boolean;
  DELIVERABLE_STATUS_LABELS: Record<DeliverableStatus, string>;
  CORE_STAGE_STATUS_LABELS: Record<StageItem['status'], string>;
  onPreviewDeliverable: (item: StageDeliverable) => void;
  onApproveStage: () => void;
  onRejectStage: () => void;
  isDeliverableReadable: (item: Pick<StageDeliverable, 'content'>) => boolean;
  roleLabel: (roleId?: string) => string;
  statusVariantByDeliverable: (status: DeliverableStatus) => 'primary' | 'accent' | 'danger' | 'default';
  statusVariantByStage: (status: StageItem['status']) => 'primary' | 'accent' | 'danger' | 'default';
  getStageModelLabel: (stageType?: string) => string;
  getStageAcceptance: (stageType: string) => { label: string; variant: 'primary' | 'accent' | 'warning' | 'danger' | 'default' };
  getStageDeliverableStats: (stageType: string) => {
    approved: number;
    rejected: number;
    submitted: number;
    draft: number;
    readable: number;
    unreadable: number;
  };
  stageLabelMap: Record<string, string>;
  stageApprovalBlockedReason?: string | null;
  onOpenRuntimeConfig?: () => void;
};

export default function StageNavigator({
  currentStageLabel,
  pendingApproval,
  currentStageDeliverables,
  stageItems,
  deliverablesByStage,
  stageReviewAction,
  isReviewingStage,
  DELIVERABLE_STATUS_LABELS,
  CORE_STAGE_STATUS_LABELS,
  onPreviewDeliverable,
  onApproveStage,
  onRejectStage,
  isDeliverableReadable,
  roleLabel,
  statusVariantByDeliverable,
  statusVariantByStage,
  getStageModelLabel,
  getStageAcceptance,
  getStageDeliverableStats,
  stageLabelMap,
  stageApprovalBlockedReason,
  onOpenRuntimeConfig,
}: Props) {
  const isStageApprovalBlocked = Boolean(stageApprovalBlockedReason);

  return (
    <section className="space-y-4">
      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
        <CheckCircle2 size={14} />
        阶段验收中心
      </h3>

      <div className="bg-surface-soft border border-border-subtle rounded-2xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-white">当前阶段: {currentStageLabel}</p>
            <p className="text-xs text-slate-400 mt-1">状态: {pendingApproval ? '等待你的验收决策' : '当前无待验收阶段'}</p>
          </div>
          <Badge variant={pendingApproval ? 'warning' : 'primary'}>
            {pendingApproval ? '待验收' : '已同步'}
          </Badge>
        </div>

        <div className="space-y-2">
          <p className="text-xs text-slate-500">本阶段交付物</p>
          {currentStageDeliverables.length > 0 ? (
            <div className="space-y-2">
              {currentStageDeliverables.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onPreviewDeliverable(item)}
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

        {pendingApproval ? (
          <div className="space-y-2">
            <div className="flex gap-3">
              <button
                onClick={onApproveStage}
                disabled={isReviewingStage || isStageApprovalBlocked}
                className="px-4 py-2 bg-primary text-slate-950 hover:bg-primary/90 rounded-lg text-sm font-semibold disabled:opacity-60"
              >
                {stageReviewAction === 'approve'
                  ? '通过中...'
                  : isReviewingStage
                    ? '处理中...'
                    : isStageApprovalBlocked
                      ? '需先修复模型通道'
                      : '通过当前阶段验收'}
              </button>
              <button
                onClick={onRejectStage}
                disabled={isReviewingStage}
                className="px-4 py-2 bg-danger text-white hover:bg-danger/90 rounded-lg text-sm font-semibold disabled:opacity-60"
              >
                {stageReviewAction === 'reject' ? '驳回中...' : '驳回并返工'}
              </button>
            </div>
            {isStageApprovalBlocked ? (
              <div className="rounded-xl border border-warning/40 bg-warning/10 p-2.5">
                <p className="text-xs text-warning">{stageApprovalBlockedReason}</p>
                {onOpenRuntimeConfig ? (
                  <button
                    type="button"
                    onClick={onOpenRuntimeConfig}
                    className="mt-2 px-2.5 py-1 rounded-md bg-warning text-slate-950 hover:bg-warning/90 text-[11px] font-semibold"
                  >
                    前往修复模型通道
                  </button>
                ) : null}
              </div>
            ) : null}
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
                  <p className="text-sm font-semibold text-white">{stage.label || stageLabelMap[stage.type] || stage.type}</p>
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
                    onClick={() => onPreviewDeliverable(item)}
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
  );
}
