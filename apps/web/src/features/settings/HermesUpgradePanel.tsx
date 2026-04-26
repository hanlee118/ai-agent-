import { useCallback, useEffect, useState } from 'react';
import { Bot, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { systemApi, type HermesUpgradeState } from '../../lib/api';
import { cn } from '../../lib/utils';

type HermesUpgradePanelProps = {
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
};

function formatTs(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN');
}

export default function HermesUpgradePanel({ addToast }: HermesUpgradePanelProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [state, setState] = useState<HermesUpgradeState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await systemApi.getHermesUpgradeState();
      setState(next);
    } catch (error) {
      addToast(`加载 Hermes 升级状态失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateConfig = useCallback(async (patch: Partial<HermesUpgradeState['config']>) => {
    if (!state) return;
    setSaving(true);
    try {
      const next = await systemApi.updateHermesUpgradeConfig({
        enabled: patch.enabled,
        autoApply: patch.autoApply,
        minKnowledgeSyncForSuggestion: patch.minKnowledgeSyncForSuggestion,
        minSkillImportForSuggestion: patch.minSkillImportForSuggestion,
      });
      setState(next);
      addToast('Hermes 升级配置已更新', 'success');
    } catch (error) {
      addToast(`配置更新失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [addToast, state]);

  const runEvaluation = useCallback(async () => {
    setRunning(true);
    try {
      const next = await systemApi.evaluateHermesUpgradeNow();
      setState(next);
      addToast('已执行 Hermes 升级评估', 'success');
    } catch (error) {
      addToast(`执行评估失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setRunning(false);
    }
  }, [addToast]);

  const applySuggestion = useCallback(async (id: string) => {
    try {
      const next = await systemApi.applyHermesSuggestion(id);
      setState(next);
      addToast('建议已应用', 'success');
    } catch (error) {
      addToast(`应用建议失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    }
  }, [addToast]);

  const dismissSuggestion = useCallback(async (id: string) => {
    try {
      const next = await systemApi.dismissHermesSuggestion(id);
      setState(next);
      addToast('建议已忽略', 'info');
    } catch (error) {
      addToast(`忽略建议失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    }
  }, [addToast]);

  const config = state?.config;

  return (
    <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(15,23,42,0.88))] shadow-[0_20px_60px_rgba(2,6,23,0.28)]">
      <div className="border-b border-white/10 bg-white/[0.04] px-6 py-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-2xl border border-white/10 bg-white/[0.06] p-2 text-slate-100">
            <Bot size={18} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Hermes 自我升级闭环</h2>
            <p className="mt-1 text-sm leading-6 text-slate-400">
              记录 Hermes 知识同步/技能导入事件，自动评估并生成升级建议，支持手动应用或自动应用。
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-3 text-xs">
            <p className="text-slate-500">知识同步事件</p>
            <p className="mt-1 text-lg font-semibold text-white">{state?.counters.knowledgeSyncEvents ?? '-'}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-3 text-xs">
            <p className="text-slate-500">技能导入事件</p>
            <p className="mt-1 text-lg font-semibold text-white">{state?.counters.skillImportEvents ?? '-'}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-3 text-xs">
            <p className="text-slate-500">待处理建议</p>
            <p className="mt-1 text-lg font-semibold text-cyan-100">{state?.pendingSuggestions.length ?? '-'}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-3 text-xs">
            <p className="text-slate-500">最近应用</p>
            <p className="mt-1 text-xs text-slate-200">{formatTs(state?.lastAppliedAt)}</p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="rounded-2xl border border-white/10 bg-slate-950/35 p-3 text-sm text-slate-200">
            <div className="flex items-center justify-between">
              <span>启用 Hermes 升级闭环</span>
              <input
                type="checkbox"
                checked={Boolean(config?.enabled)}
                onChange={(e) => void updateConfig({ enabled: e.target.checked })}
                disabled={saving || loading}
              />
            </div>
          </label>

          <label className="rounded-2xl border border-white/10 bg-slate-950/35 p-3 text-sm text-slate-200">
            <div className="flex items-center justify-between">
              <span>自动应用建议</span>
              <input
                type="checkbox"
                checked={Boolean(config?.autoApply)}
                onChange={(e) => void updateConfig({ autoApply: e.target.checked })}
                disabled={saving || loading}
              />
            </div>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void runEvaluation()}
            disabled={running || loading}
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 disabled:opacity-60"
          >
            <RefreshCw size={14} className={cn((running || loading) && 'animate-spin')} /> 立即评估
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
          >
            刷新状态
          </button>
          <p className="text-xs text-slate-500">
            最近事件: {formatTs(state?.lastEventAt)} · 最近评估: {formatTs(state?.lastEvaluatedAt)}
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">待处理升级建议</p>
          {(state?.pendingSuggestions.length ?? 0) > 0 ? (
            state?.pendingSuggestions.map((item) => (
              <article key={item.id} className="rounded-2xl border border-white/10 bg-slate-950/30 p-3">
                <p className="text-sm font-semibold text-white">{item.title}</p>
                <p className="mt-1 text-xs leading-6 text-slate-400">{item.detail}</p>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void applySuggestion(item.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-emerald-300/30 bg-emerald-400/10 px-2 py-1 text-[11px] font-semibold text-emerald-100"
                  >
                    <CheckCircle2 size={13} /> 应用
                  </button>
                  <button
                    type="button"
                    onClick={() => void dismissSuggestion(item.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-300/30 bg-rose-400/10 px-2 py-1 text-[11px] font-semibold text-rose-100"
                  >
                    <XCircle size={13} /> 忽略
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-6 text-sm text-slate-500">
              当前没有待处理升级建议。
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
