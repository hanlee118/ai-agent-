import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookText, ClipboardList, PencilLine } from 'lucide-react';
import { ApiRequestError, productContextApi } from '../../lib/api';
import { cn } from '../../lib/utils';

type Props = {
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
};

type Draft = {
  productName: string;
  background: string;
  mission: string;
  executionEngines: string;
  executionPriority: string;
  gitlabGovernance: string;
  hermesUpgradeLoop: string;
  goals: string;
  principles: string;
  constraints: string;
  forbiddenKeywords: string;
  requiredKeywords: string;
};

type ContextView = 'overview' | 'edit' | 'history';

type HistoryItem = {
  id: string;
  title: string;
  status: 'planned' | 'in_progress' | 'done';
  validationStatus: 'pending' | 'matched' | 'mismatch';
  validationNote?: string;
  implementationSummary?: string;
  requirementContract?: {
    objective: string;
    inScope: string[];
    outOfScope: string[];
    acceptanceCriteria: string[];
    artifacts: string[];
  };
  createdAt: string;
  completedAt?: string;
};

const EMPTY_DRAFT: Draft = {
  productName: '',
  background: '',
  mission: '',
  executionEngines: '',
  executionPriority: '',
  gitlabGovernance: '',
  hermesUpgradeLoop: '',
  goals: '',
  principles: '',
  constraints: '',
  forbiddenKeywords: '',
  requiredKeywords: '',
};

function toLines(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toMultiline(value: string[]) {
  return value.join('\n');
}

function fromUrlView(): ContextView {
  if (typeof window === 'undefined') {
    return 'overview';
  }
  const url = new URL(window.location.href);
  const value = url.searchParams.get('context_view');
  if (value === 'edit' || value === 'history' || value === 'overview') {
    return value;
  }
  return 'overview';
}

function syncUrlView(view: ContextView) {
  if (typeof window === 'undefined') {
    return;
  }
  const url = new URL(window.location.href);
  if (view === 'overview') {
    url.searchParams.delete('context_view');
  } else {
    url.searchParams.set('context_view', view);
  }
  const nextPath = `${url.pathname}${url.search}${url.hash}`;
  window.history.pushState(window.history.state, '', nextPath);
}

export default function ProductContextPanel({ addToast }: Props) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [view, setView] = useState<ContextView>(() => fromUrlView());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingHistoryId, setDeletingHistoryId] = useState<string | null>(null);
  const [deletingBatch, setDeletingBatch] = useState(false);
  const [showNonReusable, setShowNonReusable] = useState(false);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const loadContext = useCallback(async (signal?: { cancelled: boolean }) => {
    setLoading(true);
    try {
      const context = await productContextApi.get({
        summary: true,
        includeHistory: false,
      });
      const historyRes = await productContextApi.listHistory({
        page: 1,
        pageSize: 100,
        summary: true,
      });
      if (signal?.cancelled) {
        return;
      }
      setDraft({
        productName: context.productName,
        background: context.background,
        mission: context.mission,
        executionEngines: toMultiline(context.executionEngines || []),
        executionPriority: toMultiline(context.executionPriority || []),
        gitlabGovernance: toMultiline(context.gitlabGovernance || []),
        hermesUpgradeLoop: toMultiline(context.hermesUpgradeLoop || []),
        goals: toMultiline(context.goals),
        principles: toMultiline(context.principles),
        constraints: toMultiline(context.constraints),
        forbiddenKeywords: toMultiline(context.forbiddenKeywords),
        requiredKeywords: toMultiline(context.requiredKeywords),
      });
      setHistory(
        (historyRes.items || []).map((item) => ({
          id: item.id,
          title: item.title,
          status: item.status,
          validationStatus: item.validationStatus || 'pending',
          validationNote: item.validationNote,
          implementationSummary: item.implementationSummary,
          requirementContract: item.requirementContract,
          createdAt: item.createdAt,
          completedAt: item.completedAt,
        })),
      );
    } catch (error) {
      if (!signal?.cancelled) {
        addToast(`加载平台执行规范失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      }
    } finally {
      if (!signal?.cancelled) {
        setLoading(false);
      }
    }
  }, [addToast]);

  useEffect(() => {
    const signal = { cancelled: false };
    void loadContext(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [loadContext]);

  useEffect(() => {
    const onPopState = () => setView(fromUrlView());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    setSelectedHistoryIds([]);
  }, [showNonReusable, view]);

  useEffect(() => {
    const valid = new Set(history.map((item) => item.id));
    setSelectedHistoryIds((prev) => prev.filter((id) => valid.has(id)));
  }, [history]);

  const handleSave = async () => {
    if (!draft.productName.trim()) {
      addToast('请先填写平台名称', 'error');
      return;
    }

    setSaving(true);
    try {
      await productContextApi.update({
        productName: draft.productName.trim(),
        background: draft.background.trim(),
        mission: draft.mission.trim(),
        executionEngines: toLines(draft.executionEngines),
        executionPriority: toLines(draft.executionPriority),
        gitlabGovernance: toLines(draft.gitlabGovernance),
        hermesUpgradeLoop: toLines(draft.hermesUpgradeLoop),
        goals: toLines(draft.goals),
        principles: toLines(draft.principles),
        constraints: toLines(draft.constraints),
        forbiddenKeywords: toLines(draft.forbiddenKeywords),
        requiredKeywords: toLines(draft.requiredKeywords),
      });
      addToast('平台执行规范已保存', 'success');
      setView('overview');
      syncUrlView('overview');
    } catch (error) {
      addToast(`保存平台执行规范失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteHistory = async (historyId: string) => {
    if (!historyId) {
      return;
    }
    const confirmed = window.confirm('确认删除这条长期记忆吗？删除后将不再参与需求对齐。');
    if (!confirmed) {
      return;
    }

    setDeletingHistoryId(historyId);
    try {
      await productContextApi.deleteHistory(historyId);
      setHistory((prev) => prev.filter((item) => item.id !== historyId));
      setSelectedHistoryIds((prev) => prev.filter((id) => id !== historyId));
      addToast('长期记忆已删除', 'success');
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) {
        setHistory((prev) => prev.filter((item) => item.id !== historyId));
        setSelectedHistoryIds((prev) => prev.filter((id) => id !== historyId));
        addToast('长期记忆不存在，已从列表移除', 'info');
        return;
      }
      addToast(`删除长期记忆失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setDeletingHistoryId(null);
    }
  };

  const toggleHistorySelect = (historyId: string) => {
    setSelectedHistoryIds((prev) => (
      prev.includes(historyId) ? prev.filter((id) => id !== historyId) : [...prev, historyId]
    ));
  };

  const goToView = (next: ContextView) => {
    setView(next);
    syncUrlView(next);
  };

  const textClassName =
    'w-full rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-400/40';
  const labelClassName = 'text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500';
  const cardClassName = 'rounded-[24px] border border-white/10 bg-white/[0.03] p-5';

  const reusableHistory = history.filter((item) => item.status === 'done' && item.validationStatus === 'matched');
  const nonReusableHistory = history.filter((item) => !(item.status === 'done' && item.validationStatus === 'matched'));
  const historyCount = reusableHistory.length;
  const visibleHistory = showNonReusable ? nonReusableHistory : reusableHistory;
  const selectedCount = selectedHistoryIds.length;

  const handleSelectAllVisible = () => {
    setSelectedHistoryIds(visibleHistory.map((item) => item.id));
  };

  const clearSelection = () => {
    setSelectedHistoryIds([]);
  };

  const handleDeleteSelected = async () => {
    if (selectedHistoryIds.length === 0) {
      addToast('请先选择要删除的记录', 'info');
      return;
    }
    const confirmed = window.confirm(`确认批量删除 ${selectedHistoryIds.length} 条长期记忆吗？`);
    if (!confirmed) {
      return;
    }

    setDeletingBatch(true);
    try {
      const result = await productContextApi.deleteHistoryBatch(selectedHistoryIds);
      const removedIds = new Set(result.removedHistoryIds || []);
      setHistory((prev) => prev.filter((item) => !removedIds.has(item.id)));
      setSelectedHistoryIds([]);
      addToast(`已删除 ${result.removedCount} 条长期记忆`, 'success');
    } catch (error) {
      // Fallback for old backend versions that do not expose DELETE /product-context/history yet.
      try {
        let removedCount = 0;
        for (const historyId of selectedHistoryIds) {
          try {
            await productContextApi.deleteHistory(historyId);
            removedCount += 1;
          } catch (singleError) {
            if (!(singleError instanceof ApiRequestError && singleError.status === 404)) {
              throw singleError;
            }
          }
        }
        if (removedCount > 0) {
          const removedSet = new Set(selectedHistoryIds);
          setHistory((prev) => prev.filter((item) => !removedSet.has(item.id)));
          setSelectedHistoryIds([]);
          addToast(`批量接口不可用，已降级逐条删除 ${removedCount} 条`, 'info');
          return;
        }
      } catch {
        // keep original error below
      }
      addToast(`批量删除失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setDeletingBatch(false);
    }
  };
  const filledSections = [
    draft.productName,
    draft.background,
    draft.mission,
    draft.executionEngines,
    draft.executionPriority,
    draft.gitlabGovernance,
    draft.hermesUpgradeLoop,
    draft.goals,
    draft.principles,
    draft.constraints,
    draft.forbiddenKeywords,
    draft.requiredKeywords,
  ].filter((item) => item.trim()).length;

  const summary = useMemo(() => {
    const goals = toLines(draft.goals);
    const principles = toLines(draft.principles);
    const constraints = toLines(draft.constraints);
    const executionEngines = toLines(draft.executionEngines);
    const executionPriority = toLines(draft.executionPriority);
    const gitlabGovernance = toLines(draft.gitlabGovernance);
    const hermesUpgradeLoop = toLines(draft.hermesUpgradeLoop);
    return {
      executionEngines,
      executionPriority,
      gitlabGovernance,
      hermesUpgradeLoop,
      goals,
      principles,
      constraints,
      forbiddenKeywords: toLines(draft.forbiddenKeywords),
      requiredKeywords: toLines(draft.requiredKeywords),
    };
  }, [draft]);

  return (
    <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(15,23,42,0.9))] shadow-[0_24px_80px_rgba(2,6,23,0.3)]">
      <div className="border-b border-white/10 bg-white/[0.04] px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-2xl border border-white/10 bg-white/[0.06] p-2 text-slate-100">
              <BookText size={18} />
            </div>
            <div>
              <div className="inline-flex items-center rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-100">
                Platform Policy
              </div>
              <h2 className="mt-3 text-xl font-semibold text-white">平台执行规范与长期记忆</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                默认只展示摘要，避免在设置页堆叠大表单。点击进入独立页面后再编辑规范，或查看完整回填历史列表。
              </p>
            </div>
          </div>
          <div className="grid min-w-[220px] grid-cols-2 gap-3 rounded-[22px] border border-white/10 bg-slate-950/30 p-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">已填字段</p>
              <p className="mt-1 text-lg font-semibold text-white">{filledSections}/12</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">回填历史</p>
              <p className="mt-1 text-lg font-semibold text-cyan-100">{historyCount}</p>
              <p className="mt-0.5 text-[10px] text-slate-500">可复用 / 共 {history.length}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6 p-6">
        {view !== 'overview' ? (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/25 px-4 py-3">
            <button
              type="button"
              onClick={() => goToView('overview')}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-slate-200 transition hover:bg-white/[0.08]"
            >
              <ArrowLeft size={14} />
              返回摘要
            </button>
            <p className="text-xs text-slate-400">
              {view === 'edit' ? '规范编辑页面' : '回填历史页面'}
            </p>
          </div>
        ) : null}

        {view === 'overview' ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div className={cardClassName}>
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Foundation</p>
                <h3 className="mt-1 text-base font-semibold text-white">平台定位摘要</h3>
                <p className="mt-3 text-xs text-slate-500">平台名称</p>
                <p className="mt-1 text-sm text-slate-100">{draft.productName || '未填写'}</p>
                <p className="mt-3 text-xs text-slate-500">使命</p>
                <p className="mt-1 text-sm leading-6 text-slate-300">{draft.mission || '未填写'}</p>
                <p className="mt-3 text-xs text-slate-500">背景</p>
                <p className="mt-1 line-clamp-3 text-sm leading-6 text-slate-400">{draft.background || '未填写'}</p>
              </div>

              <div className={cardClassName}>
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Policy</p>
                <h3 className="mt-1 text-base font-semibold text-white">目标、原则与约束摘要</h3>
                <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-xl border border-white/10 bg-slate-950/30 p-3">
                    <p className="text-slate-500">执行引擎</p>
                    <p className="mt-1 text-slate-100">{summary.executionEngines.length}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-slate-950/30 p-3">
                    <p className="text-slate-500">调用优先级</p>
                    <p className="mt-1 text-slate-100">{summary.executionPriority.length}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-slate-950/30 p-3">
                    <p className="text-slate-500">GitLab 治理</p>
                    <p className="mt-1 text-slate-100">{summary.gitlabGovernance.length}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-slate-950/30 p-3">
                    <p className="text-slate-500">目标</p>
                    <p className="mt-1 text-slate-100">{summary.goals.length}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-slate-950/30 p-3">
                    <p className="text-slate-500">原则</p>
                    <p className="mt-1 text-slate-100">{summary.principles.length}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-slate-950/30 p-3">
                    <p className="text-slate-500">约束</p>
                    <p className="mt-1 text-slate-100">{summary.constraints.length}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-slate-950/30 p-3">
                    <p className="text-slate-500">关键词规则</p>
                    <p className="mt-1 text-slate-100">{summary.requiredKeywords.length + summary.forbiddenKeywords.length}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className={cardClassName}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">History</p>
                  <h3 className="mt-1 text-base font-semibold text-white">需求回填历史摘要（仅可复用）</h3>
                  <p className="mt-2 text-xs text-slate-400">默认只统计完整验收可复用记录，避免半成品污染后续参考。</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-950/35 px-3 py-2 text-sm text-cyan-100">
                  可复用 {historyCount} 条
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {reusableHistory.slice(0, 3).map((item) => (
                  <div key={item.id} className="rounded-xl border border-white/10 bg-slate-950/25 px-3 py-2 text-xs text-slate-300">
                    {item.title}
                  </div>
                ))}
                {reusableHistory.length === 0 ? <p className="text-xs text-slate-500">暂无可复用回填记录</p> : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => goToView('edit')}
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-200 disabled:opacity-50"
              >
                <PencilLine size={16} />
                进入规范编辑页
              </button>
              <button
                type="button"
                onClick={() => goToView('history')}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08]"
              >
                <ClipboardList size={16} />
                查看回填历史列表
              </button>
            </div>
          </>
        ) : null}

        {view === 'edit' ? (
          <>
            <div className={cardClassName}>
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Foundation</p>
                  <h3 className="mt-1 text-base font-semibold text-white">平台定位</h3>
                </div>
                <p className="text-xs text-slate-400">定义平台是谁、为什么存在，再继续往目标和约束展开。</p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className={labelClassName}>平台名称</label>
                  <input
                    type="text"
                    value={draft.productName}
                    onChange={(event) => setDraft((prev) => ({ ...prev, productName: event.target.value }))}
                    className={textClassName}
                    placeholder="例如：Aegis OS"
                    disabled={loading}
                  />
                </div>

                <div className="space-y-2">
                  <label className={labelClassName}>平台背景</label>
                  <textarea
                    rows={3}
                    value={draft.background}
                    onChange={(event) => setDraft((prev) => ({ ...prev, background: event.target.value }))}
                    className={`${textClassName} resize-none`}
                    placeholder="描述平台当前阶段、目标用户和业务上下文。"
                    disabled={loading}
                  />
                </div>

                <div className="space-y-2">
                  <label className={labelClassName}>使命</label>
                  <textarea
                    rows={2}
                    value={draft.mission}
                    onChange={(event) => setDraft((prev) => ({ ...prev, mission: event.target.value }))}
                    className={`${textClassName} resize-none`}
                    placeholder="一句话描述平台长期使命。"
                    disabled={loading}
                  />
                </div>
              </div>
            </div>

            <div className={cardClassName}>
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Engine Governance</p>
                  <h3 className="mt-1 text-base font-semibold text-white">引擎策略与升级闭环</h3>
                </div>
                <p className="text-xs text-slate-400">明确 OpenClaw / Hermes 分工、调用优先级与 Hermes 自我升级路径。</p>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className={labelClassName}>执行引擎分工（每行一个）</label>
                  <textarea
                    rows={4}
                    value={draft.executionEngines}
                    onChange={(event) => setDraft((prev) => ({ ...prev, executionEngines: event.target.value }))}
                    className={`${textClassName} resize-none`}
                    placeholder="例如：&#10;OpenClaw: 主执行引擎（项目推进/交付）&#10;Hermes: 设计与Agent自我升级增强"
                    disabled={loading}
                  />
                </div>
                <div className="space-y-2">
                  <label className={labelClassName}>调用优先级（每行一个）</label>
                  <textarea
                    rows={4}
                    value={draft.executionPriority}
                    onChange={(event) => setDraft((prev) => ({ ...prev, executionPriority: event.target.value }))}
                    className={`${textClassName} resize-none`}
                    placeholder="例如：&#10;工具优先&#10;技能次之&#10;最佳模型兜底"
                    disabled={loading}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className={labelClassName}>GitLab 治理规则（每行一个）</label>
                  <textarea
                    rows={3}
                    value={draft.gitlabGovernance}
                    onChange={(event) => setDraft((prev) => ({ ...prev, gitlabGovernance: event.target.value }))}
                    className={`${textClassName} resize-none`}
                    placeholder="例如：&#10;所有代码变更绑定 Issue/MR&#10;主分支合并必须通过 Pipeline&#10;发布需可追溯到提交与审批记录"
                    disabled={loading}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className={labelClassName}>Hermes 自我升级闭环（每行一个）</label>
                  <textarea
                    rows={4}
                    value={draft.hermesUpgradeLoop}
                    onChange={(event) => setDraft((prev) => ({ ...prev, hermesUpgradeLoop: event.target.value }))}
                    className={`${textClassName} resize-none`}
                    placeholder="例如：&#10;执行结果采集&#10;质量评估&#10;技能更新/策略修订&#10;审批发布与下次生效"
                    disabled={loading}
                  />
                </div>
              </div>
            </div>

            <div className={cardClassName}>
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Policy</p>
                  <h3 className="mt-1 text-base font-semibold text-white">目标、原则与约束</h3>
                </div>
                <p className="text-xs text-slate-400">把“必须坚持什么”和“绝不能越线什么”放在同一层进行管理。</p>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className={labelClassName}>目标（每行一个）</label>
                  <textarea
                    rows={4}
                    value={draft.goals}
                    onChange={(event) => setDraft((prev) => ({ ...prev, goals: event.target.value }))}
                    className={`${textClassName} resize-none`}
                    placeholder="例如：&#10;提升需求落地效率&#10;降低跨团队沟通成本"
                    disabled={loading}
                  />
                </div>
                <div className="space-y-2">
                  <label className={labelClassName}>原则（每行一个）</label>
                  <textarea
                    rows={4}
                    value={draft.principles}
                    onChange={(event) => setDraft((prev) => ({ ...prev, principles: event.target.value }))}
                    className={`${textClassName} resize-none`}
                    placeholder="例如：&#10;文档驱动研发&#10;先确认再执行"
                    disabled={loading}
                  />
                </div>
                <div className="space-y-2">
                  <label className={labelClassName}>约束（每行一个）</label>
                  <textarea
                    rows={3}
                    value={draft.constraints}
                    onChange={(event) => setDraft((prev) => ({ ...prev, constraints: event.target.value }))}
                    className={`${textClassName} resize-none`}
                    placeholder="例如：必须可审计"
                    disabled={loading}
                  />
                </div>
                <div className="space-y-2">
                  <label className={labelClassName}>禁用关键词</label>
                  <textarea
                    rows={3}
                    value={draft.forbiddenKeywords}
                    onChange={(event) => setDraft((prev) => ({ ...prev, forbiddenKeywords: event.target.value }))}
                    className={`${textClassName} resize-none`}
                    placeholder="例如：绕过审计"
                    disabled={loading}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className={labelClassName}>必含关键词</label>
                  <textarea
                    rows={3}
                    value={draft.requiredKeywords}
                    onChange={(event) => setDraft((prev) => ({ ...prev, requiredKeywords: event.target.value }))}
                    className={`${textClassName} resize-none`}
                    placeholder="例如：验收标准"
                    disabled={loading}
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => void handleSave()}
                disabled={loading || saving}
                className="rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-200 disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存规范'}
              </button>
            </div>
          </>
        ) : null}

        {view === 'history' ? (
          <div className={cardClassName}>
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">History</p>
                <h3 className="mt-1 text-base font-semibold text-white">需求回填历史列表</h3>
              </div>
              <p className="text-xs text-slate-400">默认展示可复用记录（完成+匹配），支持多选批量删除。</p>
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowNonReusable(false)}
                className={cn(
                  'rounded-xl border px-3 py-1.5 text-xs font-medium transition',
                  !showNonReusable
                    ? 'border-cyan-300/40 bg-cyan-400/10 text-cyan-100'
                    : 'border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]',
                )}
              >
                可复用记录 ({reusableHistory.length})
              </button>
              <button
                type="button"
                onClick={() => setShowNonReusable(true)}
                className={cn(
                  'rounded-xl border px-3 py-1.5 text-xs font-medium transition',
                  showNonReusable
                    ? 'border-amber-300/40 bg-amber-400/10 text-amber-100'
                    : 'border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]',
                )}
              >
                未完成/不匹配 ({nonReusableHistory.length})
              </button>
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/25 p-3">
              <button
                type="button"
                onClick={handleSelectAllVisible}
                disabled={visibleHistory.length === 0}
                className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/[0.08] disabled:opacity-50"
              >
                全选当前列表
              </button>
              <button
                type="button"
                onClick={clearSelection}
                disabled={selectedCount === 0}
                className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/[0.08] disabled:opacity-50"
              >
                清空选择
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteSelected()}
                disabled={selectedCount === 0 || deletingBatch}
                className="rounded-xl border border-rose-400/35 bg-rose-400/10 px-3 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-400/20 disabled:opacity-50"
              >
                {deletingBatch ? '批量删除中...' : `批量删除 (${selectedCount})`}
              </button>
            </div>

            <div className="space-y-3">
              {visibleHistory.length > 0 ? (
                visibleHistory.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-white/10 bg-slate-950/35 p-4 text-xs">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={selectedHistoryIds.includes(item.id)}
                            onChange={() => toggleHistorySelect(item.id)}
                            className="mt-0.5 h-4 w-4 rounded border-white/20 bg-slate-900 text-cyan-300 focus:ring-cyan-400/50"
                          />
                          <p className="font-medium text-slate-100">{item.title}</p>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-300">
                            {item.status}
                          </span>
                          <span
                            className={cn(
                              'rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em]',
                              item.validationStatus === 'matched'
                                ? 'border-emerald-400/30 text-emerald-200'
                                : item.validationStatus === 'mismatch'
                                  ? 'border-rose-400/30 text-rose-200'
                                  : 'border-amber-400/30 text-amber-200',
                            )}
                          >
                            {item.validationStatus}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => void handleDeleteHistory(item.id)}
                        disabled={deletingHistoryId === item.id || deletingBatch}
                        className="rounded-xl border border-rose-400/30 px-3 py-1.5 text-[10px] font-semibold text-rose-200 transition hover:bg-rose-400/10 disabled:opacity-50"
                      >
                        {deletingHistoryId === item.id ? '删除中...' : '删除'}
                      </button>
                    </div>
                    <p className="mt-3 text-slate-500">
                      创建于 {new Date(item.createdAt).toLocaleString('zh-CN')}
                      {item.completedAt ? ` · 完成于 ${new Date(item.completedAt).toLocaleString('zh-CN')}` : ''}
                    </p>
                    {item.validationNote ? <p className="mt-2 leading-relaxed text-slate-400">说明: {item.validationNote}</p> : null}
                    {item.implementationSummary ? (
                      <details className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                        <summary className="cursor-pointer text-slate-300">查看实施总结</summary>
                        <pre className="mt-3 whitespace-pre-wrap text-[11px] leading-6 text-slate-500">{item.implementationSummary}</pre>
                      </details>
                    ) : null}
                    {item.requirementContract ? (
                      <details className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                        <summary className="cursor-pointer text-slate-300">查看需求确认单</summary>
                        <div className="mt-3 space-y-1 text-[11px] leading-6 text-slate-500">
                          <p>目标: {item.requirementContract.objective}</p>
                          <p>In Scope: {(item.requirementContract.inScope || []).join('；') || '暂无'}</p>
                          <p>Out of Scope: {(item.requirementContract.outOfScope || []).join('；') || '暂无'}</p>
                          <p>验收: {(item.requirementContract.acceptanceCriteria || []).join('；') || '暂无'}</p>
                          <p>产出: {(item.requirementContract.artifacts || []).join('、') || '暂无'}</p>
                        </div>
                      </details>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/20 px-4 py-6 text-sm text-slate-500">
                  {showNonReusable ? '暂无未完成/不匹配记录' : '暂无可复用回填记录'}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
