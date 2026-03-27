import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Agent, Model, Project } from '../../types';
import { agentsApi } from '../../lib/api';

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

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setSelectedProjectId(projects[0]?.id || '');
    setAgentName('');
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
    const modelId = selectedTemplateConfig?.modelId || parsedCustom.modelId || models[0]?.id || undefined;
    const soul = parsedCustom.soul || undefined;
    const sop = parsedCustom.sop.length > 0 ? parsedCustom.sop : undefined;

    setIsDeploying(true);
    try {
      await agentsApi.create({
        name: safeName,
        role,
        modelId,
        soul,
        sop,
      });

      if (onDeployed) {
        await onDeployed();
      }

      addToast('Agent 部署成功，已加入团队', 'success');
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
    models,
    addToast,
    selectedProjectId,
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
    uniqueRoles,
    deployAgent,
  };
}
