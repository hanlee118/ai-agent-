import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { agentsApi, type AgentRoleTemplate } from '../../lib/api';
import { cn } from '../../lib/utils';

type AgentRoleTemplatesPanelProps = {
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
};

const ROLE_OPTIONS = [
  { id: 'ROLE_ASSISTANT', label: '总助理' },
  { id: 'ROLE_PM', label: '项目经理' },
  { id: 'ROLE_ANALYST', label: '需求分析师' },
  { id: 'ROLE_PRODUCT', label: '产品总监' },
  { id: 'ROLE_DESIGN', label: '视觉设计总监' },
  { id: 'ROLE_ARCH', label: '研发总监' },
  { id: 'ROLE_DEV', label: '研发经理' },
  { id: 'ROLE_QA', label: '测试工程师' },
  { id: 'ROLE_HR', label: 'HR总监' },
] as const;

function buildDraftTemplate(): AgentRoleTemplate {
  const id = `role:custom:${Math.random().toString(36).slice(2, 10)}`;
  return {
    id,
    roleId: 'ROLE_PM',
    name: '新模板',
    desc: '请填写模板用途',
    suggestedAgentName: 'New-Agent',
    soul: '请填写该角色的核心目标、原则与行为约束。',
    sop: ['步骤 1：输入与目标澄清', '步骤 2：执行与产出', '步骤 3：验收与回填'],
  };
}

function sopToText(sop: string[]) {
  return (Array.isArray(sop) ? sop : []).join('\n');
}

function textToSop(input: string) {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export default function AgentRoleTemplatesPanel({ addToast }: AgentRoleTemplatesPanelProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [templates, setTemplates] = useState<AgentRoleTemplate[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [savingIds, setSavingIds] = useState<string[]>([]);
  const [deletingIds, setDeletingIds] = useState<string[]>([]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const loadTemplates = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await agentsApi.listTemplates();
      setTemplates(Array.isArray(list) ? list : []);
      setSelectedIds([]);
    } catch (error) {
      addToast(`加载角色模板失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const setField = useCallback((id: string, patch: Partial<AgentRoleTemplate>) => {
    setTemplates((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds((prev) => (prev.length === templates.length ? [] : templates.map((item) => item.id)));
  }, [templates]);

  const addTemplate = useCallback(() => {
    const draft = buildDraftTemplate();
    setTemplates((prev) => [draft, ...prev]);
    setSelectedIds((prev) => [draft.id, ...prev]);
  }, []);

  const saveTemplate = useCallback(async (template: AgentRoleTemplate) => {
    setSavingIds((prev) => [...prev, template.id]);
    try {
      try {
        await agentsApi.updateTemplate(template.id, template);
      } catch {
        await agentsApi.createTemplate(template);
      }
      addToast(`模板已保存: ${template.name}`, 'success');
      await loadTemplates();
    } catch (error) {
      addToast(`模板保存失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setSavingIds((prev) => prev.filter((item) => item !== template.id));
    }
  }, [addToast, loadTemplates]);

  const deleteSelected = useCallback(async () => {
    if (selectedIds.length === 0) {
      addToast('请先选择要删除的模板', 'info');
      return;
    }
    setDeletingIds(selectedIds);
    try {
      await Promise.all(selectedIds.map((id) => agentsApi.deleteTemplate(id)));
      addToast(`已删除 ${selectedIds.length} 个模板`, 'success');
      await loadTemplates();
    } catch (error) {
      addToast(`删除失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setDeletingIds([]);
    }
  }, [addToast, loadTemplates, selectedIds]);

  const resetTemplates = useCallback(async () => {
    setIsResetting(true);
    try {
      await agentsApi.resetTemplates();
      addToast('模板已恢复为平台默认基线', 'success');
      await loadTemplates();
    } catch (error) {
      addToast(`恢复默认失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsResetting(false);
    }
  }, [addToast, loadTemplates]);

  return (
    <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(15,23,42,0.88))] shadow-[0_20px_60px_rgba(2,6,23,0.28)]">
      <div className="border-b border-white/10 bg-white/[0.04] px-6 py-5">
        <h2 className="text-lg font-semibold text-white">Agent 角色模板管理</h2>
        <p className="mt-1 text-sm leading-6 text-slate-400">
          这里是平台级模板库，部署 Agent 时会优先读取此处配置。支持在线增删改与恢复默认模板。
        </p>
      </div>
      <div className="p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={addTemplate}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-white hover:bg-white/[0.1]"
          >
            <Plus size={14} /> 新增模板
          </button>
          <button
            type="button"
            onClick={() => void deleteSelected()}
            disabled={selectedIds.length === 0 || deletingIds.length > 0}
            className="inline-flex items-center gap-2 rounded-xl border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-xs font-semibold text-rose-100 disabled:opacity-60"
          >
            <Trash2 size={14} /> 删除选中（{selectedIds.length}）
          </button>
          <button
            type="button"
            onClick={() => void resetTemplates()}
            disabled={isResetting}
            className="inline-flex items-center gap-2 rounded-xl border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-100 disabled:opacity-60"
          >
            <RefreshCw size={14} className={cn(isResetting && 'animate-spin')} /> 恢复默认
          </button>
          <button
            type="button"
            onClick={selectAll}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-white hover:bg-white/[0.1]"
          >
            {selectedIds.length === templates.length && templates.length > 0 ? '取消全选' : '全选'}
          </button>
          <button
            type="button"
            onClick={() => void loadTemplates()}
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-white hover:bg-white/[0.1] disabled:opacity-60"
          >
            <RefreshCw size={14} className={cn(isLoading && 'animate-spin')} /> 刷新
          </button>
        </div>

        {templates.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-8 text-center text-sm text-slate-400">
            暂无模板，可点击“新增模板”创建。
          </div>
        ) : (
          <div className="space-y-4">
            {templates.map((template) => {
              const isSaving = savingIds.includes(template.id);
              const isDeleting = deletingIds.includes(template.id);
              return (
                <article key={template.id} className="rounded-2xl border border-white/10 bg-slate-950/30 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <label className="inline-flex items-center gap-2 text-sm text-slate-300">
                      <input
                        type="checkbox"
                        checked={selectedSet.has(template.id)}
                        onChange={() => toggleSelected(template.id)}
                        className="h-4 w-4 rounded border-white/20 bg-slate-900"
                      />
                      选择
                    </label>
                    <div className="text-[11px] text-slate-500 font-mono">{template.id}</div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-[11px] uppercase tracking-[0.16em] text-slate-500">模板名称</label>
                      <input
                        value={template.name}
                        onChange={(e) => setField(template.id, { name: e.target.value })}
                        className="w-full rounded-xl border border-white/10 bg-slate-950/55 px-3 py-2 text-sm text-white"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] uppercase tracking-[0.16em] text-slate-500">角色</label>
                      <select
                        value={template.roleId}
                        onChange={(e) => setField(template.id, { roleId: e.target.value as AgentRoleTemplate['roleId'] })}
                        className="w-full rounded-xl border border-white/10 bg-slate-950/55 px-3 py-2 text-sm text-white"
                      >
                        {ROLE_OPTIONS.map((role) => (
                          <option key={role.id} value={role.id}>{role.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] uppercase tracking-[0.16em] text-slate-500">模板简介</label>
                    <input
                      value={template.desc}
                      onChange={(e) => setField(template.id, { desc: e.target.value })}
                      className="w-full rounded-xl border border-white/10 bg-slate-950/55 px-3 py-2 text-sm text-white"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] uppercase tracking-[0.16em] text-slate-500">建议 Agent 名称</label>
                    <input
                      value={template.suggestedAgentName}
                      onChange={(e) => setField(template.id, { suggestedAgentName: e.target.value })}
                      className="w-full rounded-xl border border-white/10 bg-slate-950/55 px-3 py-2 text-sm text-white"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Soul</label>
                    <textarea
                      rows={3}
                      value={template.soul}
                      onChange={(e) => setField(template.id, { soul: e.target.value })}
                      className="w-full rounded-xl border border-white/10 bg-slate-950/55 px-3 py-2 text-sm text-white"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] uppercase tracking-[0.16em] text-slate-500">SOP（每行一步）</label>
                    <textarea
                      rows={4}
                      value={sopToText(template.sop)}
                      onChange={(e) => setField(template.id, { sop: textToSop(e.target.value) })}
                      className="w-full rounded-xl border border-white/10 bg-slate-950/55 px-3 py-2 text-sm text-white"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => void saveTemplate(template)}
                      disabled={isSaving || isDeleting}
                      className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-60"
                    >
                      <Save size={14} /> {isSaving ? '保存中...' : '保存'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
