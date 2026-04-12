import { useEffect, useMemo, useState } from 'react';
import { CloudUpload, DatabaseZap, KeyRound, RefreshCcw, Wrench } from 'lucide-react';
import { ApiRequestError, hermesApi, type HermesKnowledgeItem, type HermesSkillItem } from '../../lib/api';

type ToastFn = (message: string, type?: 'success' | 'error' | 'info') => void;

type HermesSyncPanelProps = {
  addToast: ToastFn;
  defaultProjectId?: string;
  onSynced?: () => Promise<void> | void;
};

const csvSplit = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const humanDate = (value: string | null | undefined) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
};

export default function HermesSyncPanel({ addToast, defaultProjectId, onSynced }: HermesSyncPanelProps) {
  const [projectId, setProjectId] = useState(defaultProjectId || '');
  const [limit, setLimit] = useState(10);
  const [apiKey, setApiKey] = useState('');
  const [stageType, setStageType] = useState('');

  const [knowledgeItems, setKnowledgeItems] = useState<HermesKnowledgeItem[]>([]);
  const [skills, setSkills] = useState<HermesSkillItem[]>([]);
  const [loadingKnowledge, setLoadingKnowledge] = useState(false);
  const [loadingSkills, setLoadingSkills] = useState(false);

  const [syncTitle, setSyncTitle] = useState('视觉规范偏好');
  const [syncContent, setSyncContent] = useState('组件化布局优先，移动端断点为 768px。');
  const [syncMemoryType, setSyncMemoryType] = useState<'episodic' | 'semantic' | 'procedural'>('semantic');
  const [syncTags, setSyncTags] = useState('hermes,design');
  const [syncStageContext, setSyncStageContext] = useState('');
  const [syncTechStack, setSyncTechStack] = useState('react,tailwind');
  const [syncingMemory, setSyncingMemory] = useState(false);

  const [skillName, setSkillName] = useState('Hermes UI Acceptance');
  const [skillKey, setSkillKey] = useState('hermes-ui-acceptance');
  const [skillInstruction, setSkillInstruction] = useState('Check layout density, contrast and interaction feedback before acceptance.');
  const [skillType, setSkillType] = useState('procedural');
  const [skillManifestJson, setSkillManifestJson] = useState('{"stageTypes":["ACCEPT"],"source":"hermes"}');
  const [importingSkill, setImportingSkill] = useState(false);

  useEffect(() => {
    if (defaultProjectId?.trim()) {
      setProjectId(defaultProjectId.trim());
    }
  }, [defaultProjectId]);

  const normalizedLimit = useMemo(() => Math.max(1, Math.min(200, Math.floor(Number(limit) || 10))), [limit]);

  const resolveErrorMessage = (error: unknown, fallback: string) => {
    if (error instanceof ApiRequestError) {
      return error.message;
    }
    return error instanceof Error ? error.message : fallback;
  };

  const handleLoadKnowledge = async () => {
    setLoadingKnowledge(true);
    try {
      const result = await hermesApi.exportKnowledge({
        projectId: projectId.trim() || undefined,
        limit: normalizedLimit,
        apiKey: apiKey.trim() || undefined,
      });
      setKnowledgeItems(result.items || []);
      addToast(`已拉取 ${result.items?.length || 0} 条 Hermes 知识视图`, 'success');
    } catch (error) {
      addToast(resolveErrorMessage(error, '拉取 Hermes 知识失败'), 'error');
    } finally {
      setLoadingKnowledge(false);
    }
  };

  const handleLoadSkills = async () => {
    setLoadingSkills(true);
    try {
      const result = await hermesApi.exportSkills({
        projectId: projectId.trim() || undefined,
        stageType: stageType.trim() || undefined,
        limit: normalizedLimit,
        apiKey: apiKey.trim() || undefined,
      });
      setSkills(result.skills || []);
      addToast(`已拉取 ${result.skills?.length || 0} 条 Hermes Skills`, 'success');
    } catch (error) {
      addToast(resolveErrorMessage(error, '拉取 Hermes Skills 失败'), 'error');
    } finally {
      setLoadingSkills(false);
    }
  };

  const handleSyncMemory = async () => {
    if (!syncTitle.trim() || !syncContent.trim()) {
      addToast('请先填写记忆标题和内容', 'info');
      return;
    }
    setSyncingMemory(true);
    try {
      await hermesApi.syncMemory({
        title: syncTitle.trim(),
        content: syncContent.trim(),
        projectId: projectId.trim() || undefined,
        memoryType: syncMemoryType,
        tags: csvSplit(syncTags),
        stageContext: csvSplit(syncStageContext),
        techStack: csvSplit(syncTechStack),
        apiKey: apiKey.trim() || undefined,
      });
      addToast('Hermes 记忆已同步到平台知识库', 'success');
      if (onSynced) {
        await onSynced();
      }
      await handleLoadKnowledge();
    } catch (error) {
      addToast(resolveErrorMessage(error, '同步 Hermes 记忆失败'), 'error');
    } finally {
      setSyncingMemory(false);
    }
  };

  const handleImportSkill = async () => {
    if (!skillName.trim() || !skillKey.trim() || !skillInstruction.trim()) {
      addToast('请先填写 Skill 名称、Key 与指令', 'info');
      return;
    }
    let parsedManifest: Record<string, unknown> = {};
    if (skillManifestJson.trim()) {
      try {
        const parsed = JSON.parse(skillManifestJson) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          parsedManifest = parsed as Record<string, unknown>;
        }
      } catch {
        addToast('manifest JSON 格式不正确', 'error');
        return;
      }
    }

    setImportingSkill(true);
    try {
      await hermesApi.importSkill({
        projectId: projectId.trim() || undefined,
        skillData: {
          name: skillName.trim(),
          skillKey: skillKey.trim(),
          instruction: skillInstruction.trim(),
          type: skillType.trim() || 'procedural',
          manifest: parsedManifest,
        },
        apiKey: apiKey.trim() || undefined,
      });
      addToast('Hermes Skill 已导入平台', 'success');
      await handleLoadSkills();
    } catch (error) {
      addToast(resolveErrorMessage(error, '导入 Hermes Skill 失败'), 'error');
    } finally {
      setImportingSkill(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border-subtle bg-surface-soft p-5 space-y-4">
      <div className="flex items-center gap-2 text-slate-200 font-semibold">
        <DatabaseZap size={16} />
        Hermes 集成桥（可视化联通）
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <input
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          placeholder="projectId（可选）"
          className="bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200"
        />
        <input
          value={String(limit)}
          onChange={(event) => setLimit(Number(event.target.value) || 10)}
          placeholder="limit"
          className="bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200"
        />
        <input
          value={stageType}
          onChange={(event) => setStageType(event.target.value)}
          placeholder="stageType（skills 可选）"
          className="bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200"
        />
        <div className="relative">
          <KeyRound size={14} className="absolute left-2.5 top-2.5 text-slate-500" />
          <input
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Hermes API Key（可选）"
            className="w-full bg-surface-muted border border-border-subtle rounded-lg pl-8 pr-3 py-2 text-sm text-slate-200"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => void handleLoadKnowledge()}
          disabled={loadingKnowledge}
          className="px-3 py-2 rounded-lg border border-border-subtle bg-white/5 text-sm font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-60 inline-flex items-center gap-2"
        >
          <RefreshCcw size={14} className={loadingKnowledge ? 'animate-spin' : ''} />
          拉取知识导出
        </button>
        <button
          onClick={() => void handleLoadSkills()}
          disabled={loadingSkills}
          className="px-3 py-2 rounded-lg border border-border-subtle bg-white/5 text-sm font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-60 inline-flex items-center gap-2"
        >
          <Wrench size={14} className={loadingSkills ? 'animate-spin' : ''} />
          拉取 Skills 导出
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="rounded-xl border border-border-subtle bg-surface-muted p-3 space-y-2">
          <p className="text-xs uppercase tracking-widest text-slate-500">知识导出预览（{knowledgeItems.length}）</p>
          <div className="max-h-44 overflow-auto space-y-2 pr-1">
            {knowledgeItems.map((item) => (
              <div key={item.id} className="rounded-lg border border-border-subtle bg-white/5 p-2">
                <p className="text-sm text-slate-200">{item.title}</p>
                <p className="text-[11px] text-slate-500 mt-1">{item.memoryType || '-'} · score {item.importanceScore ?? '-'}</p>
              </div>
            ))}
            {knowledgeItems.length === 0 ? <p className="text-sm text-slate-500">暂无数据</p> : null}
          </div>
        </div>
        <div className="rounded-xl border border-border-subtle bg-surface-muted p-3 space-y-2">
          <p className="text-xs uppercase tracking-widest text-slate-500">Skills 导出预览（{skills.length}）</p>
          <div className="max-h-44 overflow-auto space-y-2 pr-1">
            {skills.map((item) => (
              <div key={item.id} className="rounded-lg border border-border-subtle bg-white/5 p-2">
                <p className="text-sm text-slate-200">{item.name}</p>
                <p className="text-[11px] text-slate-500 mt-1">{item.skillKey} · {humanDate(item.updatedAt)}</p>
              </div>
            ))}
            {skills.length === 0 ? <p className="text-sm text-slate-500">暂无数据</p> : null}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="rounded-xl border border-border-subtle bg-surface-muted p-3 space-y-2">
          <p className="text-xs uppercase tracking-widest text-slate-500">推送一条 Hermes 记忆到平台</p>
          <input
            value={syncTitle}
            onChange={(event) => setSyncTitle(event.target.value)}
            placeholder="title"
            className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200"
          />
          <textarea
            value={syncContent}
            onChange={(event) => setSyncContent(event.target.value)}
            rows={3}
            placeholder="content"
            className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200"
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <select
              value={syncMemoryType}
              onChange={(event) => setSyncMemoryType(event.target.value as 'episodic' | 'semantic' | 'procedural')}
              className="bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200"
            >
              <option value="semantic">semantic</option>
              <option value="episodic">episodic</option>
              <option value="procedural">procedural</option>
            </select>
            <input
              value={syncTags}
              onChange={(event) => setSyncTags(event.target.value)}
              placeholder="tags: 逗号分隔"
              className="bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200"
            />
            <input
              value={syncTechStack}
              onChange={(event) => setSyncTechStack(event.target.value)}
              placeholder="techStack: 逗号分隔"
              className="bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200"
            />
          </div>
          <input
            value={syncStageContext}
            onChange={(event) => setSyncStageContext(event.target.value)}
            placeholder="stageContext: 逗号分隔"
            className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200"
          />
          <button
            onClick={() => void handleSyncMemory()}
            disabled={syncingMemory}
            className="px-3 py-2 rounded-lg bg-primary text-surface text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 inline-flex items-center gap-2"
          >
            <CloudUpload size={14} />
            {syncingMemory ? '同步中...' : '同步记忆'}
          </button>
        </div>

        <div className="rounded-xl border border-border-subtle bg-surface-muted p-3 space-y-2">
          <p className="text-xs uppercase tracking-widest text-slate-500">导入 Hermes Skill 到平台</p>
          <input
            value={skillName}
            onChange={(event) => setSkillName(event.target.value)}
            placeholder="skill name"
            className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200"
          />
          <input
            value={skillKey}
            onChange={(event) => setSkillKey(event.target.value)}
            placeholder="skill key"
            className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200"
          />
          <textarea
            value={skillInstruction}
            onChange={(event) => setSkillInstruction(event.target.value)}
            rows={3}
            placeholder="instruction"
            className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200"
          />
          <input
            value={skillType}
            onChange={(event) => setSkillType(event.target.value)}
            placeholder="type"
            className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-sm text-slate-200"
          />
          <textarea
            value={skillManifestJson}
            onChange={(event) => setSkillManifestJson(event.target.value)}
            rows={2}
            placeholder='manifest JSON, 例如 {"stageTypes":["ACCEPT"]}'
            className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-300 font-mono"
          />
          <button
            onClick={() => void handleImportSkill()}
            disabled={importingSkill}
            className="px-3 py-2 rounded-lg border border-border-subtle bg-white/5 text-sm font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-60 inline-flex items-center gap-2"
          >
            <CloudUpload size={14} />
            {importingSkill ? '导入中...' : '导入 Skill'}
          </button>
        </div>
      </div>
    </div>
  );
}

