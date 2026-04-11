import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Database,
  Download,
  FilePenLine,
  Filter,
  History,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
} from 'lucide-react';
import {
  ApiRequestError,
  knowledgeApi,
  type KnowledgeCurationApplyResult,
  type KnowledgeCurationPreview,
  type KnowledgeDetailItem,
  type KnowledgeListItem,
  type KnowledgeOperationLog,
  type KnowledgeScope,
} from '../lib/api';

type ToastFn = (message: string, type?: 'success' | 'error' | 'info') => void;

type Props = {
  addToast: ToastFn;
};

type KnowledgeHubDeepLinkState = {
  scope: KnowledgeScope | 'all';
  projectId: string;
  agentId: string;
  query: string;
  stageContext: string;
  fromDeepLink: boolean;
};

const SCOPE_OPTIONS: Array<{ label: string; value: KnowledgeScope | 'all' }> = [
  { label: '全部作用域', value: 'all' },
  { label: '全局', value: 'global' },
  { label: '项目', value: 'project' },
  { label: 'Agent', value: 'agent' },
  { label: '模板', value: 'template' },
];

const CSV_JOIN = (values: string[] | undefined) => (values || []).join(', ');

const CSV_SPLIT = (raw: string) =>
  raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const HUMAN_DATE = (value: string | null | undefined) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
};

const readDeepLinkState = (): KnowledgeHubDeepLinkState => {
  if (typeof window === 'undefined') {
    return {
      scope: 'all',
      projectId: '',
      agentId: '',
      query: '',
      stageContext: '',
      fromDeepLink: false,
    };
  }
  const params = new URLSearchParams(window.location.search);
  const tab = String(params.get('app_tab') || '').trim();
  const scopeRaw = String(params.get('kb_scope') || '').trim().toLowerCase();
  const scope = (['all', 'global', 'project', 'agent', 'template'] as const).includes(scopeRaw as KnowledgeScope | 'all')
    ? (scopeRaw as KnowledgeScope | 'all')
    : 'all';
  const projectId = String(params.get('kb_project_id') || '').trim();
  const agentId = String(params.get('kb_agent_id') || '').trim();
  const query = String(params.get('kb_query') || '').trim();
  const stageContext = String(params.get('kb_stage') || '').trim();
  return {
    scope,
    projectId,
    agentId,
    query,
    stageContext,
    fromDeepLink: tab === 'knowledge-hub' && Boolean(projectId || agentId || query || stageContext || scopeRaw),
  };
};

export default function KnowledgeHubPage({ addToast }: Props) {
  const deepLinkState = useMemo(() => readDeepLinkState(), []);
  const [scopeFilter, setScopeFilter] = useState<KnowledgeScope | 'all'>(deepLinkState.scope);
  const [projectIdFilter, setProjectIdFilter] = useState(deepLinkState.projectId);
  const [agentIdFilter, setAgentIdFilter] = useState(deepLinkState.agentId);
  const [query, setQuery] = useState(deepLinkState.query);
  const [stageContextFilter, setStageContextFilter] = useState(deepLinkState.stageContext);

  const [items, setItems] = useState<KnowledgeListItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedBulkIds, setSelectedBulkIds] = useState<string[]>([]);
  const [selectedDetail, setSelectedDetail] = useState<KnowledgeDetailItem | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [savingDetail, setSavingDetail] = useState(false);
  const [deletingDetail, setDeletingDetail] = useState(false);

  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editStageContext, setEditStageContext] = useState('');
  const [editTechStack, setEditTechStack] = useState('');
  const [editMetadata, setEditMetadata] = useState('{}');
  const [editMemoryType, setEditMemoryType] = useState('');

  const [newScope, setNewScope] = useState<KnowledgeScope>('project');
  const [newProjectId, setNewProjectId] = useState('');
  const [newAgentId, setNewAgentId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newTags, setNewTags] = useState('');
  const [creatingText, setCreatingText] = useState(false);

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);

  const [curationPreview, setCurationPreview] = useState<KnowledgeCurationPreview | null>(null);
  const [curationApplyResult, setCurationApplyResult] = useState<KnowledgeCurationApplyResult | null>(null);
  const [runningPreview, setRunningPreview] = useState(false);
  const [runningApply, setRunningApply] = useState(false);
  const [curationNormalize, setCurationNormalize] = useState(true);
  const [curationMerge, setCurationMerge] = useState(true);
  const [selectedDuplicateCanonicalIds, setSelectedDuplicateCanonicalIds] = useState<string[]>([]);

  const [operationLogs, setOperationLogs] = useState<KnowledgeOperationLog[]>([]);
  const [loadingOperationLogs, setLoadingOperationLogs] = useState(false);
  const [rollingBackOperationId, setRollingBackOperationId] = useState<string | null>(null);

  const [summaryProjectId, setSummaryProjectId] = useState(deepLinkState.projectId);
  const [projectSummary, setProjectSummary] = useState('');
  const [loadingSummary, setLoadingSummary] = useState(false);

  const selectedBulkSet = useMemo(() => new Set(selectedBulkIds), [selectedBulkIds]);

  useEffect(() => {
    if (!deepLinkState.fromDeepLink) {
      return;
    }
    const filters = [
      deepLinkState.projectId ? `project=${deepLinkState.projectId}` : null,
      deepLinkState.stageContext ? `stage=${deepLinkState.stageContext}` : null,
      deepLinkState.agentId ? `agent=${deepLinkState.agentId}` : null,
      deepLinkState.query ? `query=${deepLinkState.query}` : null,
    ].filter(Boolean);
    addToast(`已按深链条件加载知识：${filters.join(' / ') || '默认筛选'}`, 'info');
  }, [addToast, deepLinkState]);

  const listKnowledge = useCallback(async () => {
    setLoadingList(true);
    try {
      const result = await knowledgeApi.list({
        scope: scopeFilter === 'all' ? undefined : scopeFilter,
        projectId: projectIdFilter.trim() || undefined,
        agentId: agentIdFilter.trim() || undefined,
        stageContext: stageContextFilter.trim() || undefined,
        query: query.trim() || undefined,
        limit: 100,
      });
      setItems(result.items || []);
      setSelectedBulkIds((prev) => prev.filter((id) => result.items.some((item) => item.id === id)));
      if (selectedId && !result.items.some((item) => item.id === selectedId)) {
        setSelectedId(null);
        setSelectedDetail(null);
      }
    } catch (error) {
      addToast(error instanceof Error ? error.message : '加载知识列表失败', 'error');
    } finally {
      setLoadingList(false);
    }
  }, [addToast, agentIdFilter, projectIdFilter, query, scopeFilter, selectedId, stageContextFilter]);

  useEffect(() => {
    void listKnowledge();
  }, [listKnowledge]);

  const loadOperationLogs = useCallback(async () => {
    setLoadingOperationLogs(true);
    try {
      const result = await knowledgeApi.history({
        projectId: projectIdFilter.trim() || undefined,
        agentId: agentIdFilter.trim() || undefined,
        limit: 30,
      });
      setOperationLogs(result.logs || []);
    } catch (error) {
      addToast(error instanceof Error ? error.message : '加载知识操作历史失败', 'error');
    } finally {
      setLoadingOperationLogs(false);
    }
  }, [addToast, agentIdFilter, projectIdFilter]);

  useEffect(() => {
    void loadOperationLogs();
  }, [loadOperationLogs]);

  const loadDetail = useCallback(async (knowledgeId: string) => {
    setLoadingDetail(true);
    try {
      const detail = await knowledgeApi.get(knowledgeId);
      setSelectedDetail(detail);
      setEditTitle(detail.title || '');
      setEditContent(detail.content || '');
      setEditTags(CSV_JOIN(detail.tags));
      setEditStageContext(CSV_JOIN(detail.stageContext));
      setEditTechStack(CSV_JOIN(detail.techStack));
      setEditMetadata(JSON.stringify(detail.metadata || {}, null, 2));
      setEditMemoryType(detail.memoryType || '');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '加载知识详情失败', 'error');
    } finally {
      setLoadingDetail(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const toggleBulkSelect = (id: string) => {
    setSelectedBulkIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const toggleDuplicateGroupSelect = (canonicalId: string) => {
    setSelectedDuplicateCanonicalIds((prev) =>
      prev.includes(canonicalId)
        ? prev.filter((id) => id !== canonicalId)
        : [...prev, canonicalId],
    );
  };

  const selectAllDuplicateGroups = () => {
    if (!curationPreview) {
      return;
    }
    setSelectedDuplicateCanonicalIds(curationPreview.duplicateGroups.map((group) => group.canonicalId));
  };

  const handleSaveDetail = async () => {
    if (!selectedId) return;
    let parsedMetadata: Record<string, unknown> | undefined = undefined;
    if (editMetadata.trim()) {
      try {
        const parsed = JSON.parse(editMetadata) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          parsedMetadata = parsed as Record<string, unknown>;
        } else {
          addToast('metadata 必须是 JSON 对象', 'error');
          return;
        }
      } catch {
        addToast('metadata 不是合法 JSON', 'error');
        return;
      }
    }
    setSavingDetail(true);
    try {
      await knowledgeApi.update(selectedId, {
        title: editTitle.trim(),
        content: editContent,
        tags: CSV_SPLIT(editTags),
        stageContext: CSV_SPLIT(editStageContext),
        techStack: CSV_SPLIT(editTechStack),
        memoryType: (editMemoryType || undefined) as 'episodic' | 'semantic' | 'procedural' | undefined,
        metadata: parsedMetadata,
      });
      addToast('知识条目已更新', 'success');
      await listKnowledge();
      await loadDetail(selectedId);
    } catch (error) {
      addToast(error instanceof Error ? error.message : '更新失败', 'error');
    } finally {
      setSavingDetail(false);
    }
  };

  const handleDeleteDetail = async () => {
    if (!selectedId) return;
    if (!window.confirm('确认删除当前知识条目？该操作不可恢复。')) return;
    setDeletingDetail(true);
    try {
      await knowledgeApi.remove(selectedId, { triggeredBy: 'knowledge_hub_ui' });
      addToast('知识条目已删除', 'success');
      setSelectedId(null);
      setSelectedDetail(null);
      await listKnowledge();
      await loadOperationLogs();
    } catch (error) {
      addToast(error instanceof Error ? error.message : '删除失败', 'error');
    } finally {
      setDeletingDetail(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedBulkIds.length === 0) {
      addToast('请先勾选要删除的知识条目', 'info');
      return;
    }
    if (!window.confirm(`确认删除 ${selectedBulkIds.length} 条知识？该操作不可恢复。`)) return;
    try {
      const result = await knowledgeApi.bulkDelete(selectedBulkIds, 'knowledge_hub_ui');
      addToast(`批量删除完成，删除 ${result.count} 条`, 'success');
      setSelectedBulkIds([]);
      await listKnowledge();
      await loadOperationLogs();
    } catch (error) {
      addToast(error instanceof Error ? error.message : '批量删除失败', 'error');
    }
  };

  const handleCreateText = async () => {
    if (!newTitle.trim() || !newContent.trim()) {
      addToast('标题和内容不能为空', 'info');
      return;
    }
    setCreatingText(true);
    try {
      await knowledgeApi.createText({
        title: newTitle.trim(),
        content: newContent,
        scope: newScope,
        projectId: newProjectId.trim() || undefined,
        agentId: newAgentId.trim() || undefined,
        tags: CSV_SPLIT(newTags),
      });
      addToast('文本知识已创建', 'success');
      setNewTitle('');
      setNewContent('');
      await listKnowledge();
    } catch (error) {
      addToast(error instanceof Error ? error.message : '创建文本知识失败', 'error');
    } finally {
      setCreatingText(false);
    }
  };

  const handleUploadDocument = async () => {
    if (!uploadFile) {
      addToast('请先选择文件', 'info');
      return;
    }
    setUploadingFile(true);
    try {
      const content = await uploadFile.text();
      if (!content.trim()) {
        addToast('文件内容为空，无法导入', 'info');
        return;
      }
      const result = await knowledgeApi.uploadDocument({
        scope: newScope,
        projectId: newProjectId.trim() || undefined,
        agentId: newAgentId.trim() || undefined,
        tags: CSV_SPLIT(newTags),
        fileName: uploadFile.name,
        fileContent: content,
        triggeredBy: 'knowledge_hub_ui',
      });
      addToast(`文档已导入，共切分 ${result.count} 条知识`, 'success');
      setUploadFile(null);
      await listKnowledge();
      await loadOperationLogs();
    } catch (error) {
      addToast(error instanceof Error ? error.message : '文档导入失败', 'error');
    } finally {
      setUploadingFile(false);
    }
  };

  const handlePreviewCuration = async () => {
    setRunningPreview(true);
    try {
      const preview = await knowledgeApi.previewCuration({
        scope: scopeFilter === 'all' ? undefined : scopeFilter,
        projectId: projectIdFilter.trim() || undefined,
        agentId: agentIdFilter.trim() || undefined,
        limit: 300,
      });
      setCurationPreview(preview);
      setSelectedDuplicateCanonicalIds(preview.duplicateGroups.map((group) => group.canonicalId));
      addToast(`整理预览完成：${preview.duplicateGroups.length} 组重复项`, 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '整理预览失败', 'error');
    } finally {
      setRunningPreview(false);
    }
  };

  const handleApplyCuration = async () => {
    if (curationMerge && selectedDuplicateCanonicalIds.length === 0) {
      addToast('请选择至少一组重复项再执行合并，或先关闭“合并重复知识”', 'info');
      return;
    }
    setRunningApply(true);
    try {
      const result = await knowledgeApi.applyCuration({
        scope: scopeFilter === 'all' ? undefined : scopeFilter,
        projectId: projectIdFilter.trim() || undefined,
        agentId: agentIdFilter.trim() || undefined,
        limit: 300,
        normalizeFields: curationNormalize,
        mergeDuplicates: curationMerge,
        maxDuplicateGroups: 30,
        targetCanonicalIds: curationMerge ? selectedDuplicateCanonicalIds : [],
        triggeredBy: 'knowledge_hub_ui',
      });
      setCurationApplyResult(result);
      addToast(
        `整理完成：规范化 ${result.normalizedCount}，合并 ${result.mergedCount}，删除 ${result.deletedCount}`,
        'success',
      );
      await listKnowledge();
      await loadOperationLogs();
    } catch (error) {
      addToast(error instanceof Error ? error.message : '执行整理失败', 'error');
    } finally {
      setRunningApply(false);
    }
  };

  const handleLoadSummary = async () => {
    if (!summaryProjectId.trim()) {
      addToast('请输入项目 ID', 'info');
      return;
    }
    setLoadingSummary(true);
    try {
      const result = await knowledgeApi.projectSummary(summaryProjectId.trim());
      setProjectSummary(result.summary || '');
    } catch (error) {
      const message = error instanceof ApiRequestError ? error.message : '加载项目经验总结失败';
      addToast(message, 'error');
    } finally {
      setLoadingSummary(false);
    }
  };

  const handleRollbackOperation = async (operationId: string) => {
    if (!operationId) return;
    if (!window.confirm('确认回滚该操作？这会恢复/撤销相关知识变更。')) return;
    setRollingBackOperationId(operationId);
    try {
      const result = await knowledgeApi.rollbackHistory(operationId, 'knowledge_hub_ui');
      if (!result.success) {
        addToast(result.message || '该操作无法回滚', 'info');
      } else {
        addToast(`回滚完成，影响条目 ${result.restoredCount}`, 'success');
      }
      await Promise.all([listKnowledge(), loadOperationLogs()]);
    } catch (error) {
      addToast(error instanceof Error ? error.message : '回滚失败', 'error');
    } finally {
      setRollingBackOperationId(null);
    }
  };

  const summaryStats = useMemo(() => {
    const scopedCount = items.length;
    const selectedCount = selectedBulkIds.length;
    const duplicateGroups = curationPreview?.duplicateGroups.length || 0;
    const normalizeSuggestions = curationPreview?.normalizationSuggestions.length || 0;
    const selectedDuplicateGroups = selectedDuplicateCanonicalIds.length;
    return { scopedCount, selectedCount, duplicateGroups, normalizeSuggestions, selectedDuplicateGroups };
  }, [curationPreview, items.length, selectedBulkIds.length, selectedDuplicateCanonicalIds.length]);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-primary mb-2">
            <Database size={16} />
            <span className="text-[10px] font-bold uppercase tracking-widest">Knowledge Ops</span>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">知识治理中心</h1>
          <p className="text-slate-400 mt-1">支持手动新增/编辑/删除，并提供 Agent 沉淀知识自动整理能力。</p>
        </div>
        <button
          onClick={() => void listKnowledge()}
          disabled={loadingList}
          className="px-4 py-2 rounded-lg border border-border-subtle bg-white/5 text-sm font-semibold text-slate-200 hover:bg-white/10 transition-colors inline-flex items-center gap-2 disabled:opacity-60"
        >
          <RefreshCw size={14} className={loadingList ? 'animate-spin' : ''} />
          刷新
        </button>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-border-subtle bg-surface-soft p-4">
          <p className="text-[11px] uppercase tracking-widest text-slate-500">当前范围条目</p>
          <p className="text-2xl font-bold text-white mt-2">{summaryStats.scopedCount}</p>
        </div>
        <div className="rounded-xl border border-border-subtle bg-surface-soft p-4">
          <p className="text-[11px] uppercase tracking-widest text-slate-500">已勾选条目</p>
          <p className="text-2xl font-bold text-white mt-2">{summaryStats.selectedCount}</p>
        </div>
        <div className="rounded-xl border border-border-subtle bg-surface-soft p-4">
          <p className="text-[11px] uppercase tracking-widest text-slate-500">重复组</p>
          <p className="text-2xl font-bold text-warning mt-2">{summaryStats.duplicateGroups}</p>
        </div>
        <div className="rounded-xl border border-border-subtle bg-surface-soft p-4">
          <p className="text-[11px] uppercase tracking-widest text-slate-500">可规范化条目</p>
          <p className="text-2xl font-bold text-primary mt-2">{summaryStats.normalizeSuggestions}</p>
        </div>
      </section>

      <section className="rounded-2xl border border-border-subtle bg-surface-soft p-5 space-y-4">
        <div className="flex items-center gap-2 text-slate-300 text-sm font-semibold">
          <Filter size={14} />
          检索范围
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <select
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value as KnowledgeScope | 'all')}
            className="bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200"
          >
            {SCOPE_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
          <input
            value={projectIdFilter}
            onChange={(e) => setProjectIdFilter(e.target.value)}
            placeholder="projectId（可选）"
            className="bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200"
          />
          <input
            value={agentIdFilter}
            onChange={(e) => setAgentIdFilter(e.target.value)}
            placeholder="agentId（可选）"
            className="bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="关键词（标题/内容）"
            className="bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200"
          />
          <input
            value={stageContextFilter}
            onChange={(e) => setStageContextFilter(e.target.value)}
            placeholder="stageContext（如 requirements_design）"
            className="bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void listKnowledge()}
            disabled={loadingList}
            className="px-3 py-2 rounded-lg bg-primary text-surface text-sm font-semibold hover:bg-primary/90 disabled:opacity-60"
          >
            查询
          </button>
          <button
            onClick={() => void handleBulkDelete()}
            disabled={selectedBulkIds.length === 0}
            className="px-3 py-2 rounded-lg border border-danger/40 bg-danger/10 text-danger text-sm font-semibold hover:bg-danger/20 disabled:opacity-50"
          >
            批量删除
          </button>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <div className="rounded-2xl border border-border-subtle bg-surface-soft overflow-hidden">
            <div className="px-5 py-4 border-b border-border-subtle flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">知识条目列表</h2>
              <span className="text-xs text-slate-400">{items.length} 条</span>
            </div>
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-white/5 text-slate-400 text-xs uppercase tracking-widest">
                  <tr>
                    <th className="px-4 py-3 text-left">选择</th>
                    <th className="px-4 py-3 text-left">标题</th>
                    <th className="px-4 py-3 text-left">作用域</th>
                    <th className="px-4 py-3 text-left">标签</th>
                    <th className="px-4 py-3 text-left">创建时间</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      className={`border-t border-border-subtle/60 hover:bg-white/5 cursor-pointer ${selectedId === item.id ? 'bg-primary/10' : ''}`}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedBulkSet.has(item.id)}
                          onChange={() => toggleBulkSelect(item.id)}
                        />
                      </td>
                      <td className="px-4 py-3 text-slate-100">{item.title}</td>
                      <td className="px-4 py-3 text-slate-300">{item.scope}</td>
                      <td className="px-4 py-3 text-slate-400">{CSV_JOIN(item.tags.slice(0, 3)) || '-'}</td>
                      <td className="px-4 py-3 text-slate-500">{HUMAN_DATE(item.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loadingList && items.length === 0 && (
                <div className="p-8 text-center text-sm text-slate-500">当前筛选范围暂无知识条目</div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-border-subtle bg-surface-soft p-5 space-y-3">
            <div className="flex items-center gap-2 text-slate-200 font-semibold">
              <WandSparkles size={15} />
              知识整理（防止 Agent 沉淀混乱）
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={curationNormalize}
                  onChange={(e) => setCurationNormalize(e.target.checked)}
                />
                规范化字段（标签/阶段/技术栈）
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={curationMerge}
                  onChange={(e) => setCurationMerge(e.target.checked)}
                />
                合并重复知识
              </label>
              {curationPreview && curationPreview.duplicateGroups.length > 0 && (
                <span className="text-xs text-slate-500">
                  已选择 {summaryStats.selectedDuplicateGroups}/{curationPreview.duplicateGroups.length} 组重复项
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void handlePreviewCuration()}
                disabled={runningPreview}
                className="px-3 py-2 rounded-lg border border-border-subtle bg-white/5 text-sm font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-60 inline-flex items-center gap-2"
              >
                <Sparkles size={14} />
                {runningPreview ? '预览中...' : '预览整理结果'}
              </button>
              <button
                onClick={() => void handleApplyCuration()}
                disabled={runningApply}
                className="px-3 py-2 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent/90 disabled:opacity-60 inline-flex items-center gap-2"
              >
                <WandSparkles size={14} />
                {runningApply ? '执行中...' : '执行整理'}
              </button>
              {curationPreview && curationPreview.duplicateGroups.length > 0 && (
                <button
                  onClick={selectAllDuplicateGroups}
                  className="px-3 py-2 rounded-lg border border-border-subtle bg-white/5 text-xs font-semibold text-slate-200 hover:bg-white/10"
                >
                  选择全部重复组
                </button>
              )}
            </div>
            {curationPreview && curationPreview.duplicateGroups.length > 0 && (
              <div className="rounded-xl border border-border-subtle bg-surface-muted p-3 space-y-2 max-h-52 overflow-auto">
                <p className="text-xs text-slate-400 uppercase tracking-widest">重复组合并确认</p>
                {curationPreview.duplicateGroups.map((group) => (
                  <label key={group.canonicalId} className="flex items-start gap-2 text-sm text-slate-300">
                    <input
                      type="checkbox"
                      checked={selectedDuplicateCanonicalIds.includes(group.canonicalId)}
                      onChange={() => toggleDuplicateGroupSelect(group.canonicalId)}
                    />
                    <span>
                      <span className="font-semibold text-slate-200">主条目 {group.canonicalId.slice(0, 8)}</span>
                      <span className="text-slate-500"> · 重复 {group.duplicateIds.length} 条 · 相似度 {Math.round(group.similarity * 100)}%</span>
                      <span className="block text-xs text-slate-500 mt-0.5">
                        duplicates: {group.duplicateIds.map((id) => id.slice(0, 8)).join(', ')}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            {(curationPreview || curationApplyResult) && (
              <div className="rounded-xl border border-border-subtle bg-surface-muted p-4 text-sm text-slate-300 space-y-2">
                {curationPreview && (
                  <p>
                    预览: 共 {curationPreview.totalItems} 条，规范化建议 {curationPreview.normalizationSuggestions.length} 条，
                    重复组 {curationPreview.duplicateGroups.length} 组。
                  </p>
                )}
                {curationApplyResult && (
                  <p>
                    执行结果: 规范化 {curationApplyResult.normalizedCount} 条，合并 {curationApplyResult.mergedCount} 条，删除 {curationApplyResult.deletedCount} 条。
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-border-subtle bg-surface-soft p-5 space-y-3">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <FilePenLine size={16} />
              条目编辑
            </h2>
            {!selectedId && <p className="text-sm text-slate-500">在左侧选择一条知识后可编辑。</p>}
            {selectedId && (
              <>
                {loadingDetail && <p className="text-sm text-slate-400">加载详情中...</p>}
                {selectedDetail && (
                  <div className="space-y-3">
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200"
                      placeholder="标题"
                    />
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={7}
                      className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200"
                      placeholder="内容"
                    />
                    <input value={editTags} onChange={(e) => setEditTags(e.target.value)} placeholder="tags: 逗号分隔" className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200" />
                    <input value={editStageContext} onChange={(e) => setEditStageContext(e.target.value)} placeholder="stageContext: 逗号分隔" className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200" />
                    <input value={editTechStack} onChange={(e) => setEditTechStack(e.target.value)} placeholder="techStack: 逗号分隔" className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200" />
                    <select value={editMemoryType} onChange={(e) => setEditMemoryType(e.target.value)} className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200">
                      <option value="">memoryType（不变）</option>
                      <option value="episodic">episodic</option>
                      <option value="semantic">semantic</option>
                      <option value="procedural">procedural</option>
                    </select>
                    <textarea
                      value={editMetadata}
                      onChange={(e) => setEditMetadata(e.target.value)}
                      rows={4}
                      className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-300 font-mono"
                      placeholder="metadata JSON"
                    />
                    <p className="text-[11px] text-slate-500">
                      创建: {HUMAN_DATE(selectedDetail.createdAt)} / 访问次数: {selectedDetail.accessCount}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => void handleSaveDetail()}
                        disabled={savingDetail}
                        className="flex-1 px-3 py-2 rounded-lg bg-primary text-surface text-sm font-semibold hover:bg-primary/90 disabled:opacity-60"
                      >
                        {savingDetail ? '保存中...' : '保存'}
                      </button>
                      <button
                        onClick={() => void handleDeleteDetail()}
                        disabled={deletingDetail}
                        className="px-3 py-2 rounded-lg border border-danger/40 bg-danger/10 text-danger text-sm font-semibold hover:bg-danger/20 disabled:opacity-60 inline-flex items-center gap-2"
                      >
                        <Trash2 size={14} />
                        删除
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="rounded-2xl border border-border-subtle bg-surface-soft p-5 space-y-3">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Upload size={16} />
              手动补充知识
            </h2>
            <div className="grid grid-cols-1 gap-2">
              <select value={newScope} onChange={(e) => setNewScope(e.target.value as KnowledgeScope)} className="bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200">
                <option value="project">project</option>
                <option value="global">global</option>
                <option value="agent">agent</option>
                <option value="template">template</option>
              </select>
              <input value={newProjectId} onChange={(e) => setNewProjectId(e.target.value)} placeholder="projectId（可选）" className="bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200" />
              <input value={newAgentId} onChange={(e) => setNewAgentId(e.target.value)} placeholder="agentId（可选）" className="bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200" />
              <input value={newTags} onChange={(e) => setNewTags(e.target.value)} placeholder="tags: 逗号分隔" className="bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200" />
              <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="标题" className="bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200" />
              <textarea value={newContent} onChange={(e) => setNewContent(e.target.value)} rows={5} placeholder="文本知识内容" className="bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200" />
              <button onClick={() => void handleCreateText()} disabled={creatingText} className="px-3 py-2 rounded-lg bg-primary text-surface text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 inline-flex items-center justify-center gap-2">
                <FilePenLine size={14} />
                {creatingText ? '创建中...' : '创建文本知识'}
              </button>
              <div className="h-px bg-border-subtle my-1" />
              <input type="file" onChange={(e) => setUploadFile(e.target.files?.[0] || null)} className="text-sm text-slate-300" />
              <button onClick={() => void handleUploadDocument()} disabled={!uploadFile || uploadingFile} className="px-3 py-2 rounded-lg border border-border-subtle bg-white/5 text-sm font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-60 inline-flex items-center justify-center gap-2">
                <Download size={14} />
                {uploadingFile ? '导入中...' : '导入文档为知识'}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-border-subtle bg-surface-soft p-5 space-y-3">
            <h2 className="text-base font-semibold text-white">项目经验摘要</h2>
            <div className="flex gap-2">
              <input
                value={summaryProjectId}
                onChange={(e) => setSummaryProjectId(e.target.value)}
                placeholder="projectId"
                className="flex-1 bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200"
              />
              <button onClick={() => void handleLoadSummary()} disabled={loadingSummary} className="px-3 py-2 rounded-lg border border-border-subtle bg-white/5 text-sm font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-60">
                查询
              </button>
            </div>
            <textarea value={projectSummary} readOnly rows={5} className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-300" placeholder="点击查询后展示项目历史经验摘要..." />
          </div>

          <div className="rounded-2xl border border-border-subtle bg-surface-soft p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <History size={16} />
                操作历史与回滚
              </h2>
              <button
                onClick={() => void loadOperationLogs()}
                disabled={loadingOperationLogs}
                className="px-2 py-1 rounded border border-border-subtle bg-white/5 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-60"
              >
                刷新
              </button>
            </div>
            <div className="max-h-64 overflow-auto space-y-2 pr-1">
              {operationLogs.map((log) => (
                <div key={log.id} className="rounded-lg border border-border-subtle bg-surface-muted p-3 space-y-1">
                  <p className="text-xs text-slate-200 font-semibold">{log.summary}</p>
                  <p className="text-[11px] text-slate-500">
                    {log.operationType} · {HUMAN_DATE(log.createdAt)} · by {log.triggeredBy || '-'}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-500">id: {log.id.slice(0, 10)}...</span>
                    <button
                      onClick={() => void handleRollbackOperation(log.id)}
                      disabled={!log.canRollback || Boolean(log.rolledBackAt) || rollingBackOperationId === log.id}
                      className="px-2 py-1 rounded border border-warning/40 bg-warning/10 text-warning text-xs font-semibold hover:bg-warning/20 disabled:opacity-50 inline-flex items-center gap-1"
                    >
                      <RotateCcw size={12} />
                      {rollingBackOperationId === log.id ? '回滚中...' : (log.rolledBackAt ? '已回滚' : '回滚')}
                    </button>
                  </div>
                </div>
              ))}
              {!loadingOperationLogs && operationLogs.length === 0 && (
                <p className="text-sm text-slate-500">暂无可展示的操作历史</p>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
