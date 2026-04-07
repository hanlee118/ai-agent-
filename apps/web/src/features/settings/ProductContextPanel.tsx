import { useCallback, useEffect, useState } from 'react';
import { BookText } from 'lucide-react';
import { ApiRequestError, productContextApi } from '../../lib/api';
import { cn } from '../../lib/utils';

type Props = {
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
};

type Draft = {
  productName: string;
  background: string;
  mission: string;
  goals: string;
  principles: string;
  constraints: string;
  forbiddenKeywords: string;
  requiredKeywords: string;
};

const EMPTY_DRAFT: Draft = {
  productName: '',
  background: '',
  mission: '',
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

export default function ProductContextPanel({ addToast }: Props) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingHistoryId, setDeletingHistoryId] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{
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
  }>>([]);

  const loadContext = useCallback(async (signal?: { cancelled: boolean }) => {
    setLoading(true);
    try {
      const context = await productContextApi.get();
      if (signal?.cancelled) {
        return;
      }
      setDraft({
        productName: context.productName,
        background: context.background,
        mission: context.mission,
        goals: toMultiline(context.goals),
        principles: toMultiline(context.principles),
        constraints: toMultiline(context.constraints),
        forbiddenKeywords: toMultiline(context.forbiddenKeywords),
        requiredKeywords: toMultiline(context.requiredKeywords),
      });
      setHistory(
        (context.requirementHistory || []).map((item) => ({
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
        addToast(`加载产品说明文档失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      }
    } finally {
      if (!signal?.cancelled) {
        setLoading(false);
      }
    }
  }, [addToast]);

  useEffect(() => {
    let cancelled = false;
    const signal = { cancelled: false };

    void loadContext(signal);
    return () => {
      cancelled = true;
      signal.cancelled = cancelled;
    };
  }, [loadContext]);

  const handleSave = async () => {
    if (!draft.productName.trim()) {
      addToast('请先填写产品名称', 'error');
      return;
    }

    setSaving(true);
    try {
      await productContextApi.update({
        productName: draft.productName.trim(),
        background: draft.background.trim(),
        mission: draft.mission.trim(),
        goals: toLines(draft.goals),
        principles: toLines(draft.principles),
        constraints: toLines(draft.constraints),
        forbiddenKeywords: toLines(draft.forbiddenKeywords),
        requiredKeywords: toLines(draft.requiredKeywords),
      });
      addToast('产品说明文档已保存', 'success');
    } catch (error) {
      addToast(`保存产品说明文档失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
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
      addToast('长期记忆已删除', 'success');
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) {
        setHistory((prev) => prev.filter((item) => item.id !== historyId));
        addToast('长期记忆不存在，已从列表移除', 'info');
        return;
      }
      addToast(`删除长期记忆失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setDeletingHistoryId(null);
    }
  };

  const textClassName =
    'w-full rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-400/40';
  const labelClassName = 'text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500';
  const cardClassName = 'rounded-[24px] border border-white/10 bg-white/[0.03] p-5';
  const historyCount = history.length;
  const filledSections = [
    draft.productName,
    draft.background,
    draft.mission,
    draft.goals,
    draft.principles,
    draft.constraints,
    draft.forbiddenKeywords,
    draft.requiredKeywords,
  ].filter((item) => item.trim()).length;

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
                Product Context
              </div>
              <h2 className="mt-3 text-xl font-semibold text-white">产品说明文档与长期记忆</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                把产品背景、使命、边界和长期记忆沉淀在同一块。后续需求对齐、协议门禁和回填记录都会围绕这里继续长出来。
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="grid min-w-[220px] grid-cols-2 gap-3 rounded-[22px] border border-white/10 bg-slate-950/30 p-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">已填字段</p>
                <p className="mt-1 text-lg font-semibold text-white">{filledSections}/8</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">回填历史</p>
                <p className="mt-1 text-lg font-semibold text-cyan-100">{historyCount}</p>
              </div>
            </div>
            <button
              onClick={() => void handleSave()}
              disabled={loading || saving}
              className="rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-200 disabled:opacity-50"
            >
              {saving ? '保存中...' : '保存文档'}
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-6 p-6">
        <div className={cardClassName}>
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Foundation</p>
              <h3 className="mt-1 text-base font-semibold text-white">产品定位</h3>
            </div>
            <p className="text-xs text-slate-400">先定义产品是谁、为什么存在，再继续往目标和约束展开。</p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className={labelClassName}>产品名称</label>
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
              <label className={labelClassName}>产品背景</label>
              <textarea
                rows={3}
                value={draft.background}
                onChange={(event) => setDraft((prev) => ({ ...prev, background: event.target.value }))}
                className={`${textClassName} resize-none`}
                placeholder="描述当前产品所处阶段、目标用户和业务上下文。"
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
                placeholder="一句话描述产品长期使命。"
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
            <p className="text-xs text-slate-400">把“必须坚持什么”和“绝不能越线什么”放在一层，后续扩展也不容易乱。</p>
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
                placeholder="例如：必须本地部署"
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

        <div className={cardClassName}>
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">History</p>
              <h3 className="mt-1 text-base font-semibold text-white">需求回填历史</h3>
            </div>
            <p className="text-xs text-slate-400">只保留最近最有价值的上下文，避免历史模板把当前项目带偏。</p>
          </div>

          <div className="space-y-3">
            {history.length > 0 ? (
              history.slice(0, 5).map((item) => (
                <div key={item.id} className="rounded-2xl border border-white/10 bg-slate-950/35 p-4 text-xs">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-100">{item.title}</p>
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
                      disabled={deletingHistoryId === item.id}
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
                暂无回填记录
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
