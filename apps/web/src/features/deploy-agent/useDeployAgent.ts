import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Agent, Model, Project } from '../../types';
import { agentsApi, openclawAgentsApi } from '../../lib/api';
import {
  DEPLOY_ROLE_TEMPLATES,
  getDeployRoleTemplateById,
  isKnownRoleTemplate,
  type DeployRoleTemplate,
} from './roleTemplates';

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
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [remoteTemplates, setRemoteTemplates] = useState<DeployRoleTemplate[]>([]);

  const dynamicRoleTemplates = useMemo(() => {
    const seen = new Set<string>();
    const roles: DeployRoleTemplate[] = [];
    agents.forEach((agent) => {
      const roleRaw = (agent.role || '').trim();
      const role = roleRaw || '自定义 Agent';
      const roleUpper = role.toUpperCase();
      if (!seen.has(roleUpper) && !isKnownRoleTemplate(roleUpper)) {
        seen.add(roleUpper);
        roles.push({
          id: `dynamic:${role}`,
          name: role,
          desc: `参考 ${agent.name} 的在线配置`,
          roleId: role,
          suggestedAgentName: `${role.replace(/\s+/g, '-') || 'Custom'}-Agent`,
          soul: '',
          sop: [],
          modelId: agent.currentModelId || '',
        });
      }
    });
    return roles.slice(0, 8);
  }, [agents]);

  const templateOptions = useMemo(
    () => [...(remoteTemplates.length > 0 ? remoteTemplates : DEPLOY_ROLE_TEMPLATES), ...dynamicRoleTemplates],
    [dynamicRoleTemplates, remoteTemplates],
  );

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
    let cancelled = false;
    void (async () => {
      try {
        const templates = await agentsApi.listTemplates();
        if (cancelled) {
          return;
        }
        const normalized = (Array.isArray(templates) ? templates : [])
          .filter((item) => String(item.id || '').trim() && String(item.name || '').trim())
          .map((item) => ({
            ...item,
            id: String(item.id || '').trim(),
            name: String(item.name || '').trim(),
            desc: String(item.desc || '').trim(),
            suggestedAgentName: String(item.suggestedAgentName || '').trim(),
            soul: String(item.soul || '').trim(),
            sop: Array.isArray(item.sop) ? item.sop.map((step) => String(step || '').trim()).filter(Boolean) : [],
            modelId: String(item.modelId || '').trim() || undefined,
          }));
        setRemoteTemplates(normalized.length > 0 ? normalized : DEPLOY_ROLE_TEMPLATES);
      } catch {
        if (!cancelled) {
          setRemoteTemplates(DEPLOY_ROLE_TEMPLATES);
        }
      }
    })();
    setSelectedProjectId(projects[0]?.id || '');
    setAgentName('');
    setSelectedTemplate(DEPLOY_ROLE_TEMPLATES[0]?.id || null);
    setIsCustom(false);
    setCustomTemplateRaw('');
    return () => {
      cancelled = true;
    };
  }, [isOpen, projects]);

  const selectedTemplateConfig = useMemo(
    () => templateOptions.find((item) => item.id === selectedTemplate) || getDeployRoleTemplateById(selectedTemplate),
    [templateOptions, selectedTemplate],
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
        roleId?: unknown;
        soul?: unknown;
        sop?: unknown;
        capabilities?: unknown;
        modelId?: unknown;
      };
      const role = String(parsed.roleId ?? parsed.role ?? '').trim();
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

    const role = selectedTemplateConfig?.roleId || parsedCustom.role || 'Custom Agent';
    const modelRoute = resolveModelRoute(
      selectedTemplateConfig?.modelId
      || parsedCustom.modelId
      || pickDefaultModelRoute(),
    ) || pickDefaultModelRoute();
    const soul = parsedCustom.soul || selectedTemplateConfig?.soul || undefined;
    const sop = parsedCustom.sop.length > 0
      ? parsedCustom.sop
      : (selectedTemplateConfig?.sop.length ? selectedTemplateConfig.sop : undefined);
    const agentId = buildAgentId(safeName);

    setIsDeploying(true);
    try {
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

      if (onDeployed) {
        await onDeployed();
      }

      addToast(`Agent 部署成功（${selectedTemplateConfig?.name || role}）`, 'success');
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
    selectedTemplateConfig?.roleId,
    selectedTemplateConfig?.modelId,
    resolveModelRoute,
    pickDefaultModelRoute,
    buildAgentId,
    addToast,
    selectedProjectId,
    selectedTemplateConfig?.name,
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
    selectedProjectId,
    setSelectedProjectId,
    isDeploying,
    templateOptions,
    deployAgent,
  };
}
