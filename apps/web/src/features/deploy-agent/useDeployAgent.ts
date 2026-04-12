import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Agent, Model, Project } from '../../types';
import { agentsApi, openclawAgentsApi } from '../../lib/api';

type ToastFn = (message: string, type?: 'success' | 'error' | 'info') => void;

type UseDeployAgentParams = {
  isOpen: boolean;
  agents: Agent[];
  projects: Project[];
  models: Model[];
  addToast: ToastFn;
};

export function useDeployAgent({ isOpen, agents, projects, models, addToast }: UseDeployAgentParams) {
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [isCustom, setIsCustom] = useState(false);
  const [customTemplateRaw, setCustomTemplateRaw] = useState('');
  const [agentName, setAgentName] = useState('');
  const [targetEngine, setTargetEngine] = useState<'openclaw' | 'hermes' | 'managed'>('openclaw');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);

  const uniqueRoles = useMemo(() => {
    const seen = new Set<string>();
    const roles: Array<{ id: string; name: string; desc: string; role: string; modelId?: string }> = [];
    agents.forEach((agent) => {
      const role = (agent.role || '').trim() || '通用 Agent';
      if (!seen.has(role)) {
        seen.add(role);
        roles.push({
          id: `role:${role}`,
          name: role,
          desc: `参考 ${agent.name} 的配置`,
          role,
          modelId: agent.currentModelId || '',
        });
      }
    });
    return roles.slice(0, 6);
  }, [agents]);

  const resolveModelRoute = useCallback((modelIdOrRoute: string) => {
    const normalized = String(modelIdOrRoute || '').trim();
    if (!normalized) {
      return '';
    }
    const matchedById = models.find((item) => String(item.id || '').trim() === normalized);
    if (matchedById?.name) {
      return String(matchedById.name).trim();
    }
    const matchedByName = models.find((item) => String(item.name || '').trim() === normalized);
    if (matchedByName?.name) {
      return String(matchedByName.name).trim();
    }
    return normalized;
  }, [models]);

  const resolveModelId = useCallback((modelIdOrRoute: string) => {
    const normalized = String(modelIdOrRoute || '').trim();
    if (!normalized) {
      return '';
    }
    const matchedById = models.find((item) => String(item.id || '').trim() === normalized);
    if (matchedById?.id) {
      return String(matchedById.id).trim();
    }
    const normalizedLower = normalized.toLowerCase();
    const matchedByName = models.find((item) => String(item.name || '').trim().toLowerCase() === normalizedLower);
    if (matchedByName?.id) {
      return String(matchedByName.id).trim();
    }
    return '';
  }, [models]);

  const pickDefaultModelRoute = useCallback(() => {
    const preferred = models.find((item) => !String(item.id || '').startsWith('runtime-'));
    if (preferred?.name) {
      return String(preferred.name).trim();
    }
    const first = models[0];
    if (first?.name) {
      return String(first.name).trim();
    }
    return 'openai/gpt-5.4';
  }, [models]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setSelectedProjectId(projects[0]?.id || '');
    setAgentName('');
    setTargetEngine('openclaw');
    setSelectedTemplate(null);
    setIsCustom(false);
    setCustomTemplateRaw('');
  }, [isOpen, projects]);

  const selectedTemplateConfig = useMemo(
    () => uniqueRoles.find((item) => item.id === selectedTemplate),
    [uniqueRoles, selectedTemplate],
  );

  const parseCustomTemplate = useCallback(() => {
    const trimmed = customTemplateRaw.trim();
    if (!trimmed) {
      return {
        role: '',
        soul: '',
        sop: [] as string[],
        modelId: '',
      };
    }

    try {
      const parsed = JSON.parse(trimmed) as {
        role?: unknown;
        soul?: unknown;
        sop?: unknown;
        capabilities?: unknown;
        modelId?: unknown;
      };
      const role = String(parsed.role ?? '').trim();
      const soul = String(parsed.soul ?? '').trim();
      const modelId = String(parsed.modelId ?? '').trim();
      const rawSop = Array.isArray(parsed.sop) ? parsed.sop : Array.isArray(parsed.capabilities) ? parsed.capabilities : [];
      const sop = rawSop.map((item) => String(item ?? '').trim()).filter(Boolean);
      return { role, soul, sop, modelId };
    } catch {
      return null;
    }
  }, [customTemplateRaw]);

  const buildAgentId = useCallback((input: string) => {
    const base = input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || `agent_${Date.now().toString(36)}`;
    const used = new Set(agents.map((item) => String(item.id || '').trim()).filter(Boolean));
    if (!used.has(base)) {
      return base;
    }
    let index = 2;
    let candidate = `${base}_${index}`;
    while (used.has(candidate)) {
      index += 1;
      candidate = `${base}_${index}`;
    }
    return candidate;
  }, [agents]);

  const deployAgent = useCallback(async (onDeployed?: () => Promise<void> | void, onClose?: () => void) => {
    const safeName = agentName.trim();
    if (!safeName) {
      addToast('请输入 Agent 名称', 'error');
      return false;
    }

    const parsedCustom = parseCustomTemplate();
    if (parsedCustom === null) {
      addToast('自定义模板 JSON 解析失败，请检查格式', 'error');
      return false;
    }

    const role = selectedTemplateConfig?.role || parsedCustom.role || 'Custom Agent';
    const modelRoute = resolveModelRoute(
      selectedTemplateConfig?.modelId
      || parsedCustom.modelId
      || pickDefaultModelRoute(),
    ) || pickDefaultModelRoute();
    const managedModelId = resolveModelId(
      selectedTemplateConfig?.modelId
      || parsedCustom.modelId
      || models[0]?.id
      || '',
    ) || String(models[0]?.id || '').trim();
    const soul = parsedCustom.soul || undefined;
    const sop = parsedCustom.sop.length > 0 ? parsedCustom.sop : undefined;
    const agentId = buildAgentId(safeName);

    setIsDeploying(true);
    try {
      if (targetEngine === 'openclaw') {
        await openclawAgentsApi.create({
          agentId,
          name: safeName,
          title: role,
          model: modelRoute,
          intro: soul,
          soul,
          sop: sop && sop.length > 0 ? `# SOP\n\n${sop.map((step, index) => `${index + 1}. ${step}`).join('\n')}\n` : undefined,
          responsibility: role,
        });
      } else {
        if (!managedModelId) {
          addToast('当前没有可用模型，请先在模型中心创建模型后再部署 Managed/Hermes Agent', 'error');
          return false;
        }
        await agentsApi.create({
          name: safeName,
          role: agentId,
          modelId: managedModelId,
          integrationEngine: targetEngine,
          soul,
          sop,
        });
      }

      if (onDeployed) {
        await onDeployed();
      }

      addToast(`Agent 部署成功，执行主体：${targetEngine === 'openclaw' ? 'OpenClaw' : targetEngine === 'hermes' ? 'Hermes' : 'Managed'}`, 'success');
      if (selectedProjectId) {
        addToast('当前版本请在项目详情中手动关联 Agent', 'info');
      }
      onClose?.();
      return true;
    } catch (error) {
      addToast(`部署失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      return false;
    } finally {
      setIsDeploying(false);
    }
  }, [
    agentName,
    parseCustomTemplate,
    selectedTemplateConfig?.role,
    selectedTemplateConfig?.modelId,
    targetEngine,
    resolveModelRoute,
    resolveModelId,
    pickDefaultModelRoute,
    buildAgentId,
    addToast,
    selectedProjectId,
    models,
  ]);

  return {
    selectedTemplate,
    setSelectedTemplate,
    isCustom,
    setIsCustom,
    customTemplateRaw,
    setCustomTemplateRaw,
    agentName,
    setAgentName,
    targetEngine,
    setTargetEngine,
    selectedProjectId,
    setSelectedProjectId,
    isDeploying,
    uniqueRoles,
    deployAgent,
  };
}
