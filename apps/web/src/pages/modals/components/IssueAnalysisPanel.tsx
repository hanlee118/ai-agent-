import { Zap } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { NewProjectModalController } from '../hooks/useNewProjectModalController';
import { ISSUE_ANSWER_LABELS, applySuggestedAnswers, roleLabel, toMultilineText } from '../utils/newProjectHelpers';
import Badge from './Badge';

type Props = {
  controller: NewProjectModalController;
};

type ContentSource = 'model_debate' | 'rule_draft' | 'fallback';

function sourceBadgeVariant(source: ContentSource): 'primary' | 'warning' | 'accent' {
  if (source === 'model_debate') {
    return 'primary';
  }
  if (source === 'fallback') {
    return 'warning';
  }
  return 'accent';
}

function sourceBadgeLabel(source: ContentSource) {
  if (source === 'model_debate') {
    return '模型正式结论';
  }
  if (source === 'fallback') {
    return '降级结果';
  }
  return '规则草稿';
}

export default function IssueAnalysisPanel({ controller }: Props) {
  const {
    parsedProject,
    detectedDomains,
    issuePreview,
    editableDraft,
    setEditableDraft,
    handleSaveAlignmentToMemory,
    isSavingAlignment,
    deletingHistoryId,
    handleDeleteHistoryReference,
    debateTaskStatus,
    isPollingDebate,
    debatePollingError,
    discussionAcknowledged,
    setDiscussionAcknowledged,
    discussionOverride,
    setDiscussionOverride,
    conflictAcknowledged,
    setConflictAcknowledged,
    conflictResolution,
    setConflictResolution,
    isRefreshingDebate,
    handleRefreshDebate,
    issueAnswers,
    setIssueAnswers,
    handleContinueFromAnalysis,
    setStep,
  } = controller;

  if (!parsedProject) {
    return null;
  }

  const formalDiscussion = issuePreview?.discussion || [];
  const discussionDraft = issuePreview?.discussionDraft || [];
  const analysisGate = issuePreview?.analysisGate;
  const primaryAnalysisBlocker = analysisGate?.blockers?.[0] || '';
  const contentProvenance = issuePreview?.contentProvenance;

  return (
    <div className="space-y-5 p-5 bg-surface-soft border border-primary/20 rounded-2xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-primary">
          <Zap size={14} />
          <span className="text-[10px] font-bold uppercase tracking-widest">需求分析与自动分配</span>
        </div>
        <Badge variant="primary">待补充</Badge>
      </div>

      <div className="rounded-xl border border-primary/20 bg-primary/8 p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="primary">5173 实时弹窗</Badge>
          <Badge variant="accent">8787 实时接口</Badge>
          <Badge variant="warning">非静态预览页</Badge>
        </div>
        <p className="text-xs leading-6 text-slate-300">
          这里展示的是实时分析结果。仅当来源标记为“模型正式结论”时，才可作为正式推进依据；“规则草稿/降级结果”仅用于参考。
        </p>
        <p className="text-[11px] leading-5 text-slate-400">
          若你另开到 <span className="font-semibold text-white">`/generated/*.html`</span>、`4173` 或其他静态页面，
          那些内容只代表某次已导出的交付物快照，不代表这个弹窗此刻的实时状态。
        </p>
      </div>

      <div className="space-y-3">
        <p className="text-xs text-slate-400">识别领域</p>
        <div className="flex flex-wrap gap-2">
          {detectedDomains.map((domain) => (
            <span key={domain} className="px-3 py-1.5 rounded-xl bg-white/5 border border-border-subtle text-xs text-slate-300">
              {domain}
            </span>
          ))}
        </div>
      </div>

      {issuePreview && (
        <>
          {contentProvenance && (
            <div className={cn(
              'rounded-xl border p-3 space-y-1',
              contentProvenance.formalReady ? 'border-primary/30 bg-primary/10' : 'border-warning/30 bg-warning/10',
            )}>
              <Badge variant={contentProvenance.formalReady ? 'primary' : sourceBadgeVariant(contentProvenance.summary)}>
                {contentProvenance.formalReady ? '正式结果可推进' : sourceBadgeLabel(contentProvenance.summary)}
              </Badge>
              <p className="text-[11px] text-slate-300 leading-relaxed">{contentProvenance.note}</p>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-400">Issue 理解摘要</p>
              {contentProvenance && (
                <Badge variant={sourceBadgeVariant(contentProvenance.summary)}>
                  {sourceBadgeLabel(contentProvenance.summary)}
                </Badge>
              )}
            </div>
            <div className="p-3 rounded-xl bg-white/5 border border-border-subtle space-y-1">
              <p className="text-sm font-bold text-white">{issuePreview.title}</p>
              <textarea
                rows={3}
                value={editableDraft?.summary ?? issuePreview.summary}
                onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, summary: event.target.value } : prev))}
                className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-[11px] text-slate-300 leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-400">需求细化草案（Agent 初步理解）</p>
              {contentProvenance && (
                <Badge variant={sourceBadgeVariant(contentProvenance.refinement)}>
                  {sourceBadgeLabel(contentProvenance.refinement)}
                </Badge>
              )}
            </div>
            <div className="p-3 rounded-xl bg-white/5 border border-border-subtle space-y-2">
              <div className="space-y-1">
                <p className="text-slate-400 text-xs">问题定义</p>
                <textarea
                  rows={2}
                  value={editableDraft?.problemStatement ?? issuePreview.refinement.problemStatement}
                  onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, problemStatement: event.target.value } : prev))}
                  className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                />
              </div>
              <div className="space-y-1">
                <p className="text-slate-400 text-xs">预期结果</p>
                <textarea
                  rows={2}
                  value={editableDraft?.expectedOutcome ?? issuePreview.refinement.expectedOutcome}
                  onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, expectedOutcome: event.target.value } : prev))}
                  className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                />
              </div>
              <div className="space-y-1">
                <p className="text-slate-400 text-xs">建议范围（In Scope，每行一条）</p>
                <textarea
                  rows={3}
                  value={editableDraft?.inScopeDraft ?? toMultilineText(issuePreview.refinement.inScopeDraft)}
                  onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, inScopeDraft: event.target.value } : prev))}
                  className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                />
              </div>
              <div className="space-y-1">
                <p className="text-slate-400 text-xs">明确不做（Out of Scope，每行一条）</p>
                <textarea
                  rows={3}
                  value={editableDraft?.outOfScopeDraft ?? toMultilineText(issuePreview.refinement.outOfScopeDraft)}
                  onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, outOfScopeDraft: event.target.value } : prev))}
                  className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                />
              </div>
              <div className="space-y-1">
                <p className="text-slate-400 text-xs">初始验收口径（每行一条）</p>
                <textarea
                  rows={3}
                  value={editableDraft?.acceptanceDraft ?? toMultilineText(issuePreview.refinement.acceptanceDraft)}
                  onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, acceptanceDraft: event.target.value } : prev))}
                  className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-400">与产品说明文档的对齐结论</p>
              <div className="flex items-center gap-2">
                {contentProvenance && (
                  <Badge variant={sourceBadgeVariant(contentProvenance.contextAlignment)}>
                    {sourceBadgeLabel(contentProvenance.contextAlignment)}
                  </Badge>
                )}
                <button
                  onClick={() => void handleSaveAlignmentToMemory()}
                  disabled={isSavingAlignment}
                  className={cn(
                    'text-[10px] font-bold uppercase tracking-widest transition-colors',
                    isSavingAlignment ? 'text-slate-500 cursor-not-allowed' : 'text-primary hover:underline',
                  )}
                >
                  {isSavingAlignment ? '保存中...' : '保存三项到长期记忆'}
                </button>
              </div>
            </div>
            <p className="text-[10px] text-slate-500">可保存：使命锚点 / 目标对齐 / 原则对齐</p>
            <div className="p-3 rounded-xl bg-white/5 border border-border-subtle space-y-2">
              <p className="text-xs text-slate-200">
                <span className="text-slate-400">产品：</span>
                {issuePreview.contextAlignment.productName}
              </p>
              <div className="space-y-1">
                <p className="text-slate-400 text-xs">使命锚点</p>
                <textarea
                  rows={2}
                  value={editableDraft?.missionAnchor ?? issuePreview.contextAlignment.missionAnchor}
                  onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, missionAnchor: event.target.value } : prev))}
                  className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                />
              </div>
              <div className="space-y-1">
                <p className="text-slate-400 text-xs">目标对齐（每行一条）</p>
                <textarea
                  rows={2}
                  value={editableDraft?.matchedGoals ?? toMultilineText(issuePreview.contextAlignment.matchedGoals)}
                  onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, matchedGoals: event.target.value } : prev))}
                  className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                />
              </div>
              <div className="space-y-1">
                <p className="text-slate-400 text-xs">原则对齐（每行一条）</p>
                <textarea
                  rows={2}
                  value={editableDraft?.matchedPrinciples ?? toMultilineText(issuePreview.contextAlignment.matchedPrinciples)}
                  onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, matchedPrinciples: event.target.value } : prev))}
                  className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                />
              </div>
              <div className="space-y-1">
                <p className="text-slate-400 text-xs">上下文参考（每行一条）</p>
                <textarea
                  rows={3}
                  value={editableDraft?.contextNotes ?? toMultilineText(issuePreview.contextAlignment.contextNotes)}
                  onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, contextNotes: event.target.value } : prev))}
                  className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-400">产品设计草案（基于上下文自动完善）</p>
              {contentProvenance && (
                <Badge variant={sourceBadgeVariant(contentProvenance.designBlueprint)}>
                  {sourceBadgeLabel(contentProvenance.designBlueprint)}
                </Badge>
              )}
            </div>
            <div className="p-3 rounded-xl bg-white/5 border border-border-subtle space-y-2">
              <div className="space-y-1">
                <p className="text-slate-400 text-xs">设计主题</p>
                <input
                  type="text"
                  value={editableDraft?.designTheme ?? issuePreview.designBlueprint.designTheme}
                  onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, designTheme: event.target.value } : prev))}
                  className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div className="space-y-1">
                <p className="text-slate-400 text-xs">价值叙事</p>
                <textarea
                  rows={2}
                  value={editableDraft?.valueNarrative ?? issuePreview.designBlueprint.valueNarrative}
                  onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, valueNarrative: event.target.value } : prev))}
                  className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                />
              </div>
              <div className="space-y-1">
                <p className="text-slate-400 text-xs">目标用户（每行一条）</p>
                <textarea
                  rows={2}
                  value={editableDraft?.targetUsers ?? toMultilineText(issuePreview.designBlueprint.targetUsers)}
                  onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, targetUsers: event.target.value } : prev))}
                  className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                />
              </div>
              <div className="space-y-1">
                <p className="text-slate-400 text-xs">核心场景（每行一条）</p>
                <textarea
                  rows={3}
                  value={editableDraft?.coreScenarios ?? toMultilineText(issuePreview.designBlueprint.coreScenarios)}
                  onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, coreScenarios: event.target.value } : prev))}
                  className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                />
              </div>
            </div>
          </div>

          {issuePreview.relatedHistory.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">历史相似需求（长期记忆复用）</p>
              <div className="space-y-2">
                {issuePreview.relatedHistory.map((item) => (
                  <div key={item.id} className="p-3 rounded-xl bg-white/5 border border-border-subtle space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold text-white">{item.title}</p>
                      <button
                        onClick={() => void handleDeleteHistoryReference(item)}
                        disabled={deletingHistoryId === item.id}
                        className="px-2 py-1 rounded-lg border border-danger/40 text-danger text-[10px] hover:bg-danger/10 disabled:opacity-50"
                      >
                        {deletingHistoryId === item.id ? '删除中...' : '删除'}
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      相关度: {item.relevance}% · 状态: {item.status} · 校验: {item.validationStatus}
                    </p>
                    <p className="text-[11px] text-slate-500">{item.hint}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-400">需求确认单草案（可追溯）</p>
              {contentProvenance && (
                <Badge variant={sourceBadgeVariant(contentProvenance.requirementContract)}>
                  {sourceBadgeLabel(contentProvenance.requirementContract)}
                </Badge>
              )}
            </div>
            <div className="p-3 rounded-xl bg-white/5 border border-border-subtle space-y-2">
              <div className="space-y-1">
                <p className="text-slate-400 text-xs">目标</p>
                <textarea
                  rows={2}
                  value={editableDraft?.contractObjective ?? issuePreview.requirementContract.objective}
                  onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, contractObjective: event.target.value } : prev))}
                  className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                />
              </div>
              <div className="space-y-1">
                <p className="text-slate-400 text-xs">In Scope（每行一条）</p>
                <textarea
                  rows={3}
                  value={editableDraft?.contractInScope ?? toMultilineText(issuePreview.requirementContract.inScope)}
                  onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, contractInScope: event.target.value } : prev))}
                  className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                />
              </div>
              <div className="space-y-1">
                <p className="text-slate-400 text-xs">Out of Scope（每行一条）</p>
                <textarea
                  rows={3}
                  value={editableDraft?.contractOutOfScope ?? toMultilineText(issuePreview.requirementContract.outOfScope)}
                  onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, contractOutOfScope: event.target.value } : prev))}
                  className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                />
              </div>
              <div className="space-y-1">
                <p className="text-slate-400 text-xs">验收标准（每行一条）</p>
                <textarea
                  rows={3}
                  value={editableDraft?.contractAcceptance ?? toMultilineText(issuePreview.requirementContract.acceptanceCriteria)}
                  onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, contractAcceptance: event.target.value } : prev))}
                  className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                />
              </div>
            </div>
          </div>

          {(formalDiscussion.length > 0 || discussionDraft.length > 0 || analysisGate) && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-slate-400">基于 Issue 的多角色讨论</p>
                <div className="flex items-center gap-2">
                  {contentProvenance && (
                    <Badge variant={sourceBadgeVariant(contentProvenance.discussion)}>
                      {sourceBadgeLabel(contentProvenance.discussion)}
                    </Badge>
                  )}
                  {issuePreview.debateTask && (
                    <Badge variant={debateTaskStatus === 'failed' ? 'danger' : debateTaskStatus === 'completed' ? 'primary' : 'accent'}>
                      {debateTaskStatus === 'queued'
                        ? '辩论排队中'
                        : debateTaskStatus === 'running'
                          ? '辩论进行中'
                          : debateTaskStatus === 'completed'
                            ? '辩论已完成'
                            : debateTaskStatus === 'failed'
                              ? '辩论失败'
                              : issuePreview.debateTask.status}
                    </Badge>
                  )}
                  {issuePreview.debate && (
                    <Badge variant={issuePreview.debate.mode === 'model' ? 'primary' : 'warning'}>
                      {issuePreview.debate.mode === 'model' ? '模型多角色讨论' : '降级讨论'}
                    </Badge>
                  )}
                  {analysisGate && (
                    <Badge variant={analysisGate.canProceed ? 'primary' : 'danger'}>
                      {analysisGate.canProceed ? '可推进' : '阻断中'}
                    </Badge>
                  )}
                </div>
              </div>
              {analysisGate && (
                <div className={cn(
                  'rounded-xl border p-3 space-y-2',
                  analysisGate.canProceed
                    ? 'border-primary/30 bg-primary/10'
                    : 'border-danger/40 bg-danger/10',
                )}>
                  <p className={cn('text-xs font-semibold', analysisGate.canProceed ? 'text-primary' : 'text-danger')}>
                    {analysisGate.canProceed ? '分析阶段已满足推进条件' : '分析阶段阻断'}
                  </p>
                  {!analysisGate.canProceed && primaryAnalysisBlocker ? (
                    <p className="text-[11px] text-slate-200 leading-relaxed">{primaryAnalysisBlocker}</p>
                  ) : null}
                  <div className="space-y-1">
                    {analysisGate.checks.map((check) => (
                      <p key={check.id} className={cn('text-[11px] leading-relaxed', check.passed ? 'text-slate-400' : 'text-warning')}>
                        {check.passed ? '通过' : '未通过'} · {check.label}：{check.detail}
                      </p>
                    ))}
                  </div>
                </div>
              )}
              {issuePreview.debateTask && (debateTaskStatus === 'queued' || debateTaskStatus === 'running' || isPollingDebate) ? (
                <p className="text-[11px] text-accent">
                  正在异步生成真实多角色辩论结果。下方草稿只作参考，不能作为正式推进依据。
                </p>
              ) : null}
              {issuePreview.debate && issuePreview.debate.mode !== 'model' ? (
                <p className="text-[11px] text-warning">
                  当前为降级讨论（scripted/fallback），角色观点仅用于草稿提示，不可作为正式分析结论。
                </p>
              ) : null}
              {debatePollingError ? <p className="text-[11px] text-warning">辩论轮询异常: {debatePollingError}</p> : null}
              {issuePreview.debate && (
                <div className="p-3 rounded-xl bg-white/5 border border-border-subtle space-y-2">
                  <p className="text-[11px] text-slate-400">
                    生成时间: {new Date(issuePreview.debate.generatedAt).toLocaleString('zh-CN')}
                  </p>
                  {issuePreview.debate.consensus.length > 0 ? (
                    <div className="space-y-1">
                      <p className="text-[11px] text-slate-300">共识汇总</p>
                      {issuePreview.debate.consensus.map((item, index) => (
                        <p key={`consensus-${index}`} className="text-[11px] text-slate-400 leading-relaxed">- {item}</p>
                      ))}
                    </div>
                  ) : null}
                  {issuePreview.debate.divergences.length > 0 ? (
                    <div className="space-y-1">
                      <p className="text-[11px] text-slate-300">分歧项</p>
                      {issuePreview.debate.divergences.map((item, index) => (
                        <p key={`divergence-${index}`} className="text-[11px] text-warning leading-relaxed">- {item}</p>
                      ))}
                    </div>
                  ) : null}
                  {issuePreview.debate.note ? (
                    <p className="text-[11px] text-slate-500 leading-relaxed">说明: {issuePreview.debate.note}</p>
                  ) : null}
                </div>
              )}
              {formalDiscussion.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-300">正式讨论结论</p>
                  {formalDiscussion.map((item) => {
                    const opinion = issuePreview.debate?.opinions?.find((candidate) => candidate.roleId === item.roleId);
                    return (
                      <details key={item.id} className="p-3 rounded-xl bg-white/5 border border-border-subtle">
                        <summary className="text-xs font-semibold text-white cursor-pointer list-none">
                          {item.roleLabel} · {item.focus}
                        </summary>
                        <div className="space-y-1 pt-2">
                          <p className="text-[11px] text-slate-400 leading-relaxed">讨论要点: {item.concern}</p>
                          <p className="text-[11px] text-slate-300 leading-relaxed">结论建议: {item.proposal}</p>
                          {opinion && (
                            <p className="text-[10px] text-slate-500">
                              模型来源: {opinion.provider}/{opinion.model}
                            </p>
                          )}
                        </div>
                      </details>
                    );
                  })}
                </div>
              ) : null}
              {discussionDraft.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-300">讨论草稿提示（不可作为正式结果）</p>
                  {discussionDraft.map((item) => {
                    const opinion = issuePreview.debate?.opinions?.find((candidate) => candidate.roleId === item.roleId);
                    return (
                      <details key={item.id} className="p-3 rounded-xl border border-warning/20 bg-warning/5">
                        <summary className="text-xs font-semibold text-white cursor-pointer list-none">
                          {item.roleLabel} · {item.focus}
                        </summary>
                        <div className="space-y-1 pt-2">
                          <p className="text-[11px] text-slate-400 leading-relaxed">草稿要点: {item.concern}</p>
                          <p className="text-[11px] text-slate-300 leading-relaxed">草稿建议: {item.proposal}</p>
                          {opinion ? (
                            <p className="text-[10px] text-slate-500">
                              执行来源: {opinion.provider}/{opinion.model}
                            </p>
                          ) : (
                            <p className="text-[10px] text-slate-500">
                              当前仍为规则草稿，尚未绑定真实模型讨论输出
                            </p>
                          )}
                        </div>
                      </details>
                    );
                  })}
                </div>
              ) : null}
              {formalDiscussion.length > 0 ? (
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={discussionAcknowledged}
                    onChange={(event) => setDiscussionAcknowledged(event.target.checked)}
                  />
                  我确认以上正式讨论结论，可据此形成任务并进入执行
                </label>
              ) : null}
              <div className="space-y-2">
                <p className="text-[11px] text-slate-500">
                  如果你不同意正式结论，可补充修正意见；若当前仍是阻断状态，请先重新触发真实多角色讨论。
                </p>
                <textarea
                  rows={2}
                  value={discussionOverride}
                  onChange={(event) => setDiscussionOverride(event.target.value)}
                  placeholder="例如：请按B端场景优先，不做C端运营活动；将验收改为“下单转化率提升10%”。"
                  className="w-full bg-surface-muted border border-border-subtle rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <button
                    onClick={() => void handleRefreshDebate()}
                    disabled={isRefreshingDebate}
                    className="py-2 bg-white/5 border border-border-subtle rounded-xl text-xs font-bold hover:bg-white/10 transition-all disabled:opacity-50"
                  >
                    {isRefreshingDebate ? '重生成中...' : '重新生成真实多角色讨论'}
                  </button>
                  <button
                    onClick={() => setStep('input')}
                    className="py-2 bg-white/5 border border-border-subtle rounded-xl text-xs font-bold hover:bg-white/10 transition-all"
                  >
                    返回补充需求后再分析
                  </button>
                </div>
              </div>
            </div>
          )}

          {issuePreview.expectedArtifacts.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">预期产出物（创建后自动进入任务）</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {issuePreview.expectedArtifacts.map((artifact) => (
                  <div key={artifact.id} className="p-3 rounded-xl bg-white/5 border border-border-subtle">
                    <p className="text-xs font-semibold text-white">{artifact.name}</p>
                    <p className="text-[11px] text-slate-400 mt-1">{artifact.description}</p>
                    <p className="text-[10px] text-slate-500 mt-1">
                      负责人: {roleLabel(artifact.ownerRoleId)} · 阶段: {artifact.stageType}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <p className="text-xs text-slate-400">冲突检测</p>
            {issuePreview.conflicts.length > 0 ? (
              <div className="space-y-2">
                {issuePreview.conflicts.map((conflict) => (
                  <div key={conflict.id} className="p-3 rounded-xl bg-white/5 border border-border-subtle space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          conflict.severity === 'critical'
                            ? 'danger'
                            : conflict.severity === 'warning'
                              ? 'warning'
                              : 'accent'
                        }
                      >
                        {conflict.severity}
                      </Badge>
                      <p className="text-xs font-semibold text-white">{conflict.title}</p>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">{conflict.detail}</p>
                    {conflict.suggestion && <p className="text-[11px] text-slate-500">建议: {conflict.suggestion}</p>}
                  </div>
                ))}
                {issuePreview.conflicts.some((conflict) => conflict.severity === 'critical') && (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={conflictAcknowledged}
                        onChange={(event) => setConflictAcknowledged(event.target.checked)}
                      />
                      我已确认冲突并接受按建议处理
                    </label>
                    <textarea
                      rows={2}
                      value={conflictResolution}
                      onChange={(event) => setConflictResolution(event.target.value)}
                      placeholder="请说明如何解决该冲突（必填）"
                      className="w-full bg-surface-muted border border-border-subtle rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                    />
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500">未检测到与产品说明文档的明显冲突。</p>
            )}
          </div>

          {issuePreview.questions.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">需求细化必答（3 题）</p>
                <div className="flex items-center gap-2">
                  {contentProvenance && (
                    <Badge variant={sourceBadgeVariant(contentProvenance.suggestedAnswers)}>
                      {sourceBadgeLabel(contentProvenance.suggestedAnswers)}
                    </Badge>
                  )}
                  {issuePreview.suggestedAnswers.length > 0 && (
                    <button
                      onClick={() => setIssueAnswers(applySuggestedAnswers(issuePreview.questions, issuePreview.suggestedAnswers))}
                      className="text-[10px] font-bold text-primary hover:underline"
                    >
                      一键应用建议答案
                    </button>
                  )}
                </div>
              </div>
              {issuePreview.suggestedAnswers.length > 0 && (
                <div className="p-2 rounded-lg bg-white/5 border border-border-subtle">
                  {issuePreview.suggestedAnswers.map((item) => (
                    <p key={item.questionId} className="text-[10px] text-slate-400">
                      {ISSUE_ANSWER_LABELS[item.questionId] || item.questionId}: {item.reason}
                    </p>
                  ))}
                </div>
              )}
              <div className="space-y-2">
                {issuePreview.questions.map((question) => (
                  <div key={question.id} className="space-y-1">
                    <label className="text-xs text-slate-300">
                      {question.question}
                      {question.required ? <span className="text-danger ml-1">*</span> : null}
                    </label>
                    <input
                      type="text"
                      value={issueAnswers[question.id] ?? ''}
                      onChange={(event) =>
                        setIssueAnswers((prev) => ({
                          ...prev,
                          [question.id]: event.target.value,
                        }))
                      }
                      placeholder={question.placeholder || '请输入补充信息'}
                      className="w-full bg-surface-muted border border-border-subtle rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {issuePreview.workflow && (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">推荐协作 SOP</p>
              <div className="space-y-2">
                {issuePreview.workflow.steps.slice(0, 5).map((step) => (
                  <div key={step.order} className="p-3 rounded-xl bg-white/5 border border-border-subtle">
                    <p className="text-xs font-semibold text-white">
                      {step.order}. {step.title} · {roleLabel(step.roleId)}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">输入: {step.input}</p>
                    <p className="text-[11px] text-slate-500">输出: {step.output}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="flex gap-3 pt-1">
        <button
          onClick={() => setStep('input')}
          className="flex-1 py-2.5 bg-white/5 border border-border-subtle rounded-xl text-xs font-bold hover:bg-white/10 transition-all"
        >
          返回修改需求
        </button>
        <button
          onClick={handleContinueFromAnalysis}
          className="flex-1 py-2.5 bg-primary text-surface rounded-xl text-xs font-bold hover:bg-primary/90 transition-all"
        >
          下一步：团队分配与扩展信息
        </button>
      </div>
    </div>
  );
}
