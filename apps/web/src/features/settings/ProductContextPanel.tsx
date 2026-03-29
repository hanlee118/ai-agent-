import { useEffect, useState } from 'react';
import { BookText } from 'lucide-react';
import { productContextApi } from '../../lib/api';

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

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const context = await productContextApi.get();
        if (cancelled) {
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
        if (!cancelled) {
          addToast(`加载产品说明文档失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [addToast]);

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

  const textClassName = 'w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary/50';

  return (
    <section className="bg-surface-soft border border-border-subtle rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-border-subtle bg-white/5 flex items-center justify-between">
        <h2 className="font-semibold text-white flex items-center gap-2">
          <BookText size={18} className="text-primary" />
          产品说明文档（长期记忆）
        </h2>
        <button
          onClick={() => void handleSave()}
          disabled={loading || saving}
          className="px-3 py-1.5 bg-primary text-surface rounded-lg text-xs font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存文档'}
        </button>
      </div>

      <div className="p-6 space-y-4">
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">产品名称</label>
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
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">产品背景</label>
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
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">使命</label>
          <textarea
            rows={2}
            value={draft.mission}
            onChange={(event) => setDraft((prev) => ({ ...prev, mission: event.target.value }))}
            className={`${textClassName} resize-none`}
            placeholder="一句话描述产品长期使命。"
            disabled={loading}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">目标（每行一个）</label>
            <textarea
              rows={4}
              value={draft.goals}
              onChange={(event) => setDraft((prev) => ({ ...prev, goals: event.target.value }))}
              className={`${textClassName} resize-none`}
              placeholder="例如：\n提升需求落地效率\n降低跨团队沟通成本"
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">原则（每行一个）</label>
            <textarea
              rows={4}
              value={draft.principles}
              onChange={(event) => setDraft((prev) => ({ ...prev, principles: event.target.value }))}
              className={`${textClassName} resize-none`}
              placeholder="例如：\n文档驱动研发\n先确认再执行"
              disabled={loading}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">约束（每行一个）</label>
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
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">禁用关键词</label>
            <textarea
              rows={3}
              value={draft.forbiddenKeywords}
              onChange={(event) => setDraft((prev) => ({ ...prev, forbiddenKeywords: event.target.value }))}
              className={`${textClassName} resize-none`}
              placeholder="例如：绕过审计"
              disabled={loading}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">必含关键词</label>
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

        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">需求回填历史</label>
          <div className="space-y-2">
            {history.length > 0 ? (
              history.slice(0, 5).map((item) => (
                <div key={item.id} className="px-3 py-2 bg-white/5 border border-border-subtle rounded-xl text-xs">
                  <p className="text-slate-200 font-medium">{item.title}</p>
                  <p className="text-slate-500 mt-1">
                    状态: {item.status} · 校验: {item.validationStatus} · 创建于 {new Date(item.createdAt).toLocaleString('zh-CN')}
                  </p>
                  {item.completedAt && (
                    <p className="text-slate-500 mt-1">
                      完成于: {new Date(item.completedAt).toLocaleString('zh-CN')}
                    </p>
                  )}
                  {item.validationNote && <p className="text-slate-400 mt-1 leading-relaxed">说明: {item.validationNote}</p>}
                  {item.implementationSummary && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-slate-400">查看实施总结</summary>
                      <pre className="whitespace-pre-wrap text-[11px] text-slate-500 mt-2">{item.implementationSummary}</pre>
                    </details>
                  )}
                  {item.requirementContract && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-slate-400">查看需求合同</summary>
                      <div className="mt-2 space-y-1 text-[11px] text-slate-500">
                        <p>目标: {item.requirementContract.objective}</p>
                        <p>In Scope: {(item.requirementContract.inScope || []).join('；') || '暂无'}</p>
                        <p>Out of Scope: {(item.requirementContract.outOfScope || []).join('；') || '暂无'}</p>
                        <p>验收: {(item.requirementContract.acceptanceCriteria || []).join('；') || '暂无'}</p>
                        <p>产出: {(item.requirementContract.artifacts || []).join('、') || '暂无'}</p>
                      </div>
                    </details>
                  )}
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-500">暂无回填记录</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
