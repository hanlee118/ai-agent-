import { Copy, Download, ExternalLink, FileText } from 'lucide-react';
import type { ProjectAcceptanceReport, ProjectFinalArtifactsReport } from '../../lib/api';
import { cn } from '../../lib/utils';
import SurfaceModal from '../impl/SurfaceModal';
import { Badge } from './Badge';

type SignoffDecisionFilter = 'all' | 'approved' | 'rejected' | 'pending';
type SignoffTimeFilter = 'all' | '24h' | '7d' | '30d';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  acceptanceReport: ProjectAcceptanceReport | null;
  isLoadingAcceptanceReport: boolean;
  isArchivingAcceptanceReport: boolean;
  isExportingAcceptanceReport: boolean;
  onRefresh: () => void;
  onArchive: () => void;
  onExport: () => void;
  finalArtifacts: ProjectFinalArtifactsReport | null;
  finalArtifactsGenerationStatus?: NonNullable<ProjectFinalArtifactsReport['generation']>['status'];
  finalArtifactsGenerationText: string | null;
  isTriggeringFinalArtifacts: boolean;
  finalArtifactsRunning: boolean;
  onGenerateFinalArtifacts: (force: boolean) => void;
  getArtifactModelLabel: (artifact: ProjectFinalArtifactsReport['artifacts'][number]) => string;
  onOpenFinalArtifact: (artifact: ProjectFinalArtifactsReport['artifacts'][number]) => void;
  onDownloadFinalArtifact: (artifact: ProjectFinalArtifactsReport['artifacts'][number]) => void;
  onCopyFinalArtifactLink: (artifact: ProjectFinalArtifactsReport['artifacts'][number]) => void;
  downloadingArtifactKey: string | null;
  signoffKeyword: string;
  onSignoffKeywordChange: (value: string) => void;
  signoffStageFilter: string;
  onSignoffStageFilterChange: (value: string) => void;
  signoffDecisionFilter: SignoffDecisionFilter;
  onSignoffDecisionFilterChange: (value: SignoffDecisionFilter) => void;
  signoffTimeFilter: SignoffTimeFilter;
  onSignoffTimeFilterChange: (value: SignoffTimeFilter) => void;
  signoffStageOptions: string[];
  stageLabelMap: Record<string, string>;
  filteredSignoffHistory: ProjectAcceptanceReport['signoffHistory'];
  isExportingSignoffMarkdown: boolean;
  isExportingSignoffCsv: boolean;
  isCopyingSignoffLink: boolean;
  onFilterRejected: () => void;
  onExportFilteredSignoffMarkdown: () => void;
  onExportFilteredSignoffCsv: () => void;
  onCopySignoffFilterLink: () => void;
  onInspectSignoffStage: (stageType?: string) => void;
  roleLabel: (roleId?: string) => string;
};

export default function AcceptanceReportModal({
  isOpen,
  onClose,
  acceptanceReport,
  isLoadingAcceptanceReport,
  isArchivingAcceptanceReport,
  isExportingAcceptanceReport,
  onRefresh,
  onArchive,
  onExport,
  finalArtifacts,
  finalArtifactsGenerationStatus,
  finalArtifactsGenerationText,
  isTriggeringFinalArtifacts,
  finalArtifactsRunning,
  onGenerateFinalArtifacts,
  getArtifactModelLabel,
  onOpenFinalArtifact,
  onDownloadFinalArtifact,
  onCopyFinalArtifactLink,
  downloadingArtifactKey,
  signoffKeyword,
  onSignoffKeywordChange,
  signoffStageFilter,
  onSignoffStageFilterChange,
  signoffDecisionFilter,
  onSignoffDecisionFilterChange,
  signoffTimeFilter,
  onSignoffTimeFilterChange,
  signoffStageOptions,
  stageLabelMap,
  filteredSignoffHistory,
  isExportingSignoffMarkdown,
  isExportingSignoffCsv,
  isCopyingSignoffLink,
  onFilterRejected,
  onExportFilteredSignoffMarkdown,
  onExportFilteredSignoffCsv,
  onCopySignoffFilterLink,
  onInspectSignoffStage,
  roleLabel,
}: Props) {
  return (
    <SurfaceModal
      isOpen={isOpen}
      onClose={onClose}
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
              onClick={onRefresh}
              disabled={isLoadingAcceptanceReport}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-slate-200 disabled:opacity-60"
            >
              {isLoadingAcceptanceReport ? '刷新中...' : '刷新报告'}
            </button>
            <button
              type="button"
              onClick={onArchive}
              disabled={isArchivingAcceptanceReport || !acceptanceReport}
              className="px-3 py-1.5 rounded-lg bg-accent text-slate-950 hover:bg-accent/90 text-xs font-semibold disabled:opacity-60"
            >
              {isArchivingAcceptanceReport ? '归档中...' : '归档到交付物'}
            </button>
            <button
              type="button"
              onClick={onExport}
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
                    onClick={() => onGenerateFinalArtifacts(finalArtifactsGenerationStatus === 'failed')}
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
                  finalArtifactsGenerationStatus === 'failed'
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
                  onChange={(event) => onSignoffKeywordChange(event.target.value)}
                  placeholder="搜索原因/角色/阶段..."
                  className="px-3 py-1.5 rounded-lg bg-surface-muted border border-border-subtle text-xs text-slate-200 placeholder:text-slate-500 min-w-48"
                />
                <select
                  value={signoffStageFilter}
                  onChange={(event) => onSignoffStageFilterChange(event.target.value)}
                  className="px-3 py-1.5 rounded-lg bg-surface-muted border border-border-subtle text-xs text-slate-200"
                >
                  <option value="all">全部阶段</option>
                  {signoffStageOptions.map((stageType) => (
                    <option key={stageType} value={stageType}>
                      {stageLabelMap[stageType] || stageType}
                    </option>
                  ))}
                </select>
                <select
                  value={signoffDecisionFilter}
                  onChange={(event) => onSignoffDecisionFilterChange(event.target.value as SignoffDecisionFilter)}
                  className="px-3 py-1.5 rounded-lg bg-surface-muted border border-border-subtle text-xs text-slate-200"
                >
                  <option value="all">全部决策</option>
                  <option value="approved">通过</option>
                  <option value="rejected">驳回</option>
                  <option value="pending">待处理</option>
                </select>
                <select
                  value={signoffTimeFilter}
                  onChange={(event) => onSignoffTimeFilterChange(event.target.value as SignoffTimeFilter)}
                  className="px-3 py-1.5 rounded-lg bg-surface-muted border border-border-subtle text-xs text-slate-200"
                >
                  <option value="all">全部时间</option>
                  <option value="24h">近 24 小时</option>
                  <option value="7d">近 7 天</option>
                  <option value="30d">近 30 天</option>
                </select>
                <button
                  type="button"
                  onClick={onFilterRejected}
                  className="px-3 py-1.5 rounded-lg bg-danger/20 border border-danger/40 text-xs text-danger hover:bg-danger/30"
                >
                  只看驳回项
                </button>
                <button
                  type="button"
                  onClick={onExportFilteredSignoffMarkdown}
                  disabled={isExportingSignoffMarkdown}
                  className="px-3 py-1.5 rounded-lg bg-white/5 border border-border-subtle text-xs text-slate-300 hover:bg-white/10 disabled:opacity-60"
                >
                  {isExportingSignoffMarkdown ? '导出中...' : '导出筛选 Markdown'}
                </button>
                <button
                  type="button"
                  onClick={onExportFilteredSignoffCsv}
                  disabled={isExportingSignoffCsv}
                  className="px-3 py-1.5 rounded-lg bg-white/5 border border-border-subtle text-xs text-slate-300 hover:bg-white/10 disabled:opacity-60"
                >
                  {isExportingSignoffCsv ? '导出中...' : '导出筛选 CSV'}
                </button>
                <button
                  type="button"
                  onClick={onCopySignoffFilterLink}
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
                        onClick={() => onInspectSignoffStage(record.stageType)}
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
  );
}
