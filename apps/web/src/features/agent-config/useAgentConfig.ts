import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Agent, Model } from '../../types';
import { agentsApi, openclawAgentsApi } from '../../lib/api';

const DEFAULT_AGENT_TOKEN_LIMIT = 100000000;

type ToastFn = (message: string, type?: 'success' | 'error' | 'info') => void;
type ConfigSource = 'openclaw' | 'managed';

type UseAgentConfigParams = {
  isOpen: boolean;
  agentId?: string | null;
  agents: Agent[];
  models: Model[];
  addToast: ToastFn;
};

export function useAgentConfig({
  isOpen,
  agentId,
  agents,
  models,
  addToast,
}: UseAgentConfigParams) {
  const fallbackAgent = useMemo<Agent>(() => (
    agents.find((item) => item.id === agentId) || agents[0] || {
      id: '',
      name: '未选择 Agent',
      role: '待配置角色',
      status: 'Idle',
      load: 0,
      currentModelId: '',
      tasks: 0,
      memoryCount: 0,
      tokensUsed: 0,
      tokenLimit: DEFAULT_AGENT_TOKEN_LIMIT,
      sessionCount: 0,
    }
  ), [agents, agentId]);

  const [agentName, setAgentName] = useState(fallbackAgent.name);
  const [agentRole, setAgentRole] = useState(fallbackAgent.role);
  const [selectedModelId, setSelectedModelId] = useState(fallbackAgent.currentModelId || models[0]?.id || '');
  const [loadedModelRoute, setLoadedModelRoute] = useState(fallbackAgent.currentModelId || '');
  const [soulInput, setSoulInput] = useState('');
  const [loadedSoul, setLoadedSoul] = useState('');
  const [sopInput, setSopInput] = useState('');
  const [loadedSop, setLoadedSop] = useState<string[]>([]);
  const [configSource, setConfigSource] = useState<ConfigSource>('openclaw');
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const resolveModelOptionId = useCallback((modelRouteOrId: string) => {
    const normalized = String(modelRouteOrId || '').trim();
    if (!normalized) {
      return '';
    }
    const byId = models.find((item) => String(item.id || '').trim() === normalized);
    if (byId?.id) {
      return byId.id;
    }
    const normalizedLower = normalized.toLowerCase();
    const byName = models.find((item) => String(item.name || '').trim().toLowerCase() === normalizedLower);
    if (byName?.id) {
      return byName.id;
    }
    return normalized;
  }, [models]);

  const resolveModelRoute = useCallback((selectedIdOrRoute: string) => {
    const normalized = String(selectedIdOrRoute || '').trim();
    if (!normalized) {
      return '';
    }
    const byId = models.find((item) => String(item.id || '').trim() === normalized);
    if (byId?.name) {
      return String(byId.name).trim();
    }
    const byName = models.find((item) => String(item.name || '').trim() === normalized);
    if (byName?.name) {
      return String(byName.name).trim();
    }
    return normalized;
  }, [models]);

  const parseSopText = useCallback((value: string) => (
    value
      .split('\n')
      .map((line) => line.replace(/^\d+[.)]\s*/, '').replace(/^[-*]\s*/, '').trim())
      .filter(Boolean)
  ), []);

  useEffect(() => {
    const seedModelOptionId = resolveModelOptionId(fallbackAgent.currentModelId || models[0]?.id || '');
    setAgentName(fallbackAgent.name);
    setAgentRole(fallbackAgent.role);
    setSelectedModelId(seedModelOptionId);
    setLoadedModelRoute(resolveModelRoute(seedModelOptionId));
    setSoulInput('');
    setLoadedSoul('');
    setSopInput('');
    setLoadedSop([]);
    setConfigSource('openclaw');
  }, [fallbackAgent.id, fallbackAgent.name, fallbackAgent.role, fallbackAgent.currentModelId, isOpen, models, resolveModelOptionId, resolveModelRoute]);

  useEffect(() => {
    if (!isOpen || !fallbackAgent.id) {
      return;
    }

    let active = true;
    const loadDetail = async () => {
      setIsLoadingDetail(true);
      try {
        try {
          const detail = await openclawAgentsApi.get(fallbackAgent.id);
          if (!active) {
            return;
          }

          const detailSoul = String(detail.soul?.content ?? '').trim();
          const detailSop = parseSopText(String(detail.sop?.content ?? ''));
          const detailModelId = String(
            detail.commander?.selectedModel
            || detail.model
            || fallbackAgent.currentModelId
            || models[0]?.id
            || '',
          ).trim();

          setConfigSource('openclaw');
          setAgentName(detail.name || fallbackAgent.name);
          setAgentRole(detail.title || detail.responsibility || fallbackAgent.role);
          setSelectedModelId(resolveModelOptionId(detailModelId));
          setLoadedModelRoute(resolveModelRoute(detailModelId));
          setSoulInput(detailSoul);
          setLoadedSoul(detailSoul);
          setSopInput(detailSop.join('\n'));
          setLoadedSop(detailSop);
          return;
        } catch {
          // fallback to managed /api/agents
        }

        const detail = await agentsApi.get(fallbackAgent.id);
        if (!active) {
          return;
        }
        const detailSoul = detail.soul?.trim?.() || '';
        const detailSop = Array.isArray(detail.sop) ? detail.sop.map((step) => String(step).trim()).filter(Boolean) : [];

        setConfigSource('managed');
        setAgentName(detail.name || fallbackAgent.name);
        setAgentRole(detail.role || fallbackAgent.role);
        setSelectedModelId(resolveModelOptionId(detail.currentModelId || fallbackAgent.currentModelId || models[0]?.id || ''));
        setLoadedModelRoute(resolveModelRoute(detail.currentModelId || fallbackAgent.currentModelId || ''));
        setSoulInput(detailSoul);
        setLoadedSoul(detailSoul);
        setSopInput(detailSop.join('\n'));
        setLoadedSop(detailSop);
      } catch (error) {
        addToast(`加载 Agent 配置失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      } finally {
        if (active) {
          setIsLoadingDetail(false);
        }
      }
    };

    void loadDetail();
    return () => {
      active = false;
    };
  }, [isOpen, fallbackAgent.id, fallbackAgent.name, fallbackAgent.role, fallbackAgent.currentModelId, addToast, models, parseSopText, resolveModelOptionId, resolveModelRoute]);

  const parseSopInput = useCallback(() => (
    sopInput
      .split('\n')
      .map((line) => line.replace(/^\d+\.\s*/, '').replace(/^[-*]\s*/, '').trim())
      .filter(Boolean)
  ), [sopInput]);

  const isSameStringArray = useCallback((left: string[], right: string[]) => {
    if (left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => item === right[index]);
  }, []);

  const saveConfig = useCallback(async (onUpdated?: () => Promise<void> | void, onClose?: () => void) => {
    if (!fallbackAgent.id) {
      addToast('未选择可配置的 Agent', 'error');
      return false;
    }

    const nextSoul = soulInput.trim();
    if (loadedSoul.trim() && !nextSoul) {
      addToast('SOUL 内容不能为空', 'error');
      return false;
    }

    const nextSop = parseSopInput();
    const selectedModelRoute = resolveModelRoute(selectedModelId);
    const hasModelChange = Boolean(selectedModelRoute) && selectedModelRoute !== loadedModelRoute;
    const hasSoulChange = nextSoul !== loadedSoul.trim();
    const hasSopChange = !isSameStringArray(nextSop, loadedSop);

    if (!hasModelChange && !hasSoulChange && !hasSopChange) {
      addToast('未检测到配置变更', 'info');
      return false;
    }

    setIsSaving(true);
    try {
      if (configSource === 'openclaw') {
        if (hasModelChange && selectedModelRoute) {
          await openclawAgentsApi.updateSettings(fallbackAgent.id, { selectedModel: selectedModelRoute });
        }
        if (hasSoulChange) {
          if (!nextSoul) {
            addToast('SOUL 内容不能为空', 'error');
            return false;
          }
          await openclawAgentsApi.updateDocument(fallbackAgent.id, 'soul', nextSoul);
        }
        if (hasSopChange) {
          if (nextSop.length === 0) {
            addToast('SOP 至少保留一步', 'error');
            return false;
          }
          const sopContent = `# SOP\n\n${nextSop.map((step, index) => `${index + 1}. ${step}`).join('\n')}\n`;
          await openclawAgentsApi.updateDocument(fallbackAgent.id, 'sop', sopContent);
        }
      } else {
        if (hasModelChange && selectedModelId) {
          const matchedModel = models.find((item) => String(item.id || '').trim() === selectedModelId);
          if (!matchedModel) {
            addToast('当前选择的模型不是已注册模型，无法写入本地 Agent 配置', 'error');
            return false;
          }
          await agentsApi.switchModel(fallbackAgent.id, selectedModelId);
        }
        if (hasSoulChange && nextSoul) {
          await agentsApi.updateSoul(fallbackAgent.id, nextSoul);
        }
        if (hasSopChange) {
          await agentsApi.updateSop(fallbackAgent.id, nextSop);
        }
      }
      if (onUpdated) {
        await onUpdated();
      }
      addToast('Agent 配置已更新', 'success');
      onClose?.();
      return true;
    } catch (error) {
      addToast(`保存失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [
    fallbackAgent.id,
    selectedModelId,
    loadedModelRoute,
    soulInput,
    loadedSoul,
    parseSopInput,
    isSameStringArray,
    loadedSop,
    configSource,
    models,
    resolveModelRoute,
    addToast,
  ]);

  const canDelete = Boolean(fallbackAgent.id) && fallbackAgent.id !== 'main';

  const deleteAgent = useCallback(async (onUpdated?: () => Promise<void> | void, onClose?: () => void) => {
    if (!fallbackAgent.id) {
      addToast('未选择可删除的 Agent', 'error');
      return false;
    }
    if (fallbackAgent.id === 'main') {
      addToast('核心 Agent 不允许删除', 'error');
      return false;
    }

    setIsSaving(true);
    try {
      if (configSource === 'openclaw') {
        await openclawAgentsApi.delete(fallbackAgent.id);
      } else {
        await agentsApi.delete(fallbackAgent.id);
      }

      if (onUpdated) {
        await onUpdated();
      }
      addToast('Agent 已删除', 'success');
      onClose?.();
      return true;
    } catch (error) {
      addToast(`删除失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [fallbackAgent.id, configSource, addToast]);

  return {
    fallbackAgent,
    configSource,
    canDelete,
    agentName,
    setAgentName,
    agentRole,
    setAgentRole,
    selectedModelId,
    setSelectedModelId,
    soulInput,
    setSoulInput,
    sopInput,
    setSopInput,
    isLoadingDetail,
    isSaving,
    saveConfig,
    deleteAgent,
  };
}
