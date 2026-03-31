import { CheckCircle2, Copy, Download, ExternalLink, FileText } from 'lucide-react';
import type { ProjectFinalArtifactsReport } from '../../lib/api';
import type { DeliverableStatus } from './projectRoomShared';
import { Badge } from './Badge';

type StageItem = {
  type: string;
  label: string;
};

type StageDeliverable = {
  id: string;
  name: string;
  type: string;
  stageType: string;
  status: DeliverableStatus;
  version?: number;
  createdBy?: string;
  updatedAt: string;
  content?: string;
};

type FinalArtifact = ProjectFinalArtifactsReport['artifacts'][number];

type Props = {
  isLoadingFinalArtifacts: boolean;
  finalArtifacts: ProjectFinalArtifactsReport | null;
  finalArtifactsGenerationText: string | null;
  finalArtifactsGenerationStatus?: NonNullable<ProjectFinalArtifactsReport['generation']>['status'];
  isTriggeringFinalArtifacts: boolean;
  finalArtifactsRunning: boolean;
  quickFinalArtifacts: FinalArtifact[];
  downloadingArtifactKey: string | null;
  stageItems: StageItem[];
  deliverablesByStage: Map<string, StageDeliverable[]>;
  DELIVERABLE_STATUS_LABELS: Record<DeliverableStatus, string>;
  stageLabelMap: Record<string, string>;
  onGenerateFinalArtifacts: (force: boolean) => void;
  onOpenFinalArtifact: (artifact: FinalArtifact) => void;
  onDownloadFinalArtifact: (artifact: FinalArtifact) => void;
  onCopyFinalArtifactLink: (artifact: FinalArtifact) => void;
  onPreviewDeliverable: (item: StageDeliverable) => void;
  getArtifactModelLabel: (artifact: FinalArtifact) => string;
  getStageModelLabel: (stageType?: string) => string;
  getStageDeliverableStats: (stageType: string) => {
    approved: number;
    rejected: number;
    submitted: number;
    draft: number;
    readable: number;
    unreadable: number;
  };
  roleLabel: (roleId?: string) => string;
  isDeliverableReadable: (item: Pick<StageDeliverable, 'content'>) => boolean;
  statusVariantByDeliverable: (status: DeliverableStatus) => 'primary' | 'accent' | 'danger' | 'default';
};

export default function DeliverablesPanel({
  isLoadingFinalArtifacts,
  finalArtifacts,
  finalArtifactsGenerationText,
  finalArtifactsGenerationStatus,
  isTriggeringFinalArtifacts,
  finalArtifactsRunning,
  quickFinalArtifacts,
  downloadingArtifactKey,
  stageItems,
  deliverablesByStage,
  DELIVERABLE_STATUS_LABELS,
  stageLabelMap,
  onGenerateFinalArtifacts,
  onOpenFinalArtifact,
  onDownloadFinalArtifact,
  onCopyFinalArtifactLink,
  onPreviewDeliverable,
  getArtifactModelLabel,
  getStageModelLabel,
  getStageDeliverableStats,
  roleLabel,
  isDeliverableReadable,
  statusVariantByDeliverable,
}: Props) {
  return (
    <>
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
              onClick={() => onGenerateFinalArtifacts(finalArtifactsGenerationStatus === 'failed')}
              disabled={isTriggeringFinalArtifacts || finalArtifactsRunning}
              className="px-2.5 py-1 rounded-md bg-primary/15 border border-primary/30 text-[11px] text-primary hover:bg-primary/25 disabled:opacity-60"
            >
              {isTriggeringFinalArtifacts ? '启动中...' : finalArtifactsRunning ? '生成中...' : '生成最终成果'}
            </button>
          </div>
        </div>

        {finalArtifactsGenerationText ? (
          <div className={`rounded-xl border p-3 text-xs ${
            finalArtifactsGenerationStatus === 'failed'
              ? 'border-danger/40 bg-danger/10 text-danger'
              : finalArtifactsRunning
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-primary/40 bg-primary/10 text-primary'
          }`}>
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
                  <p className="text-[11px] text-slate-500">生成模型: {getArtifactModelLabel(artifact)}</p>
                  <p className="text-[11px] text-slate-400 whitespace-pre-wrap break-words">{artifact.excerpt || '暂无摘要'}</p>
                  {artifact.issue ? <p className="text-[11px] text-warning">{artifact.issue}</p> : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenFinalArtifact(artifact)}
                      className="px-2.5 py-1 rounded-md bg-white/5 border border-border-subtle text-[11px] text-slate-200 hover:bg-white/10 flex items-center gap-1"
                    >
                      {artifact.source === 'link' ? <ExternalLink size={11} /> : <FileText size={11} />}
                      {artifact.source === 'link' ? '打开链接' : '查看内容'}
                    </button>
                    {artifact.content ? (
                      <button
                        type="button"
                        onClick={() => onDownloadFinalArtifact(artifact)}
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
                        onClick={() => onCopyFinalArtifactLink(artifact)}
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
                  <p className="text-sm font-semibold text-white">{stage.label || stageLabelMap[stage.type] || stage.type}</p>
                  <Badge variant="default">{stageDeliverables.length} 份交付</Badge>
                </div>
                <p className="text-[11px] text-slate-500">
                  验收统计: 通过 {acceptanceStats.approved} · 驳回 {acceptanceStats.rejected} · 待处理 {acceptanceStats.submitted} · 可查阅 {acceptanceStats.readable}
                </p>
                <p className="text-[11px] text-slate-500">生成模型: {getStageModelLabel(stage.type)}</p>

                {stageDeliverables.length > 0 ? (
                  <div className="space-y-2">
                    {stageDeliverables.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => onPreviewDeliverable(item)}
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
    </>
  );
}
