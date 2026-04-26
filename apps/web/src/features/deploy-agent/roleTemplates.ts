import { AGENT_ROLE_TEMPLATES, type AgentRoleTemplate } from '@occ/shared';

export type DeployRoleTemplate = Omit<AgentRoleTemplate, 'roleId'> & { roleId: string };

export const DEPLOY_ROLE_TEMPLATES: DeployRoleTemplate[] = AGENT_ROLE_TEMPLATES.map((item) => ({
  ...item,
  sop: Array.isArray(item.sop) ? item.sop.filter((step) => String(step || '').trim().length > 0) : [],
}));

const TEMPLATE_BY_ID = new Map(DEPLOY_ROLE_TEMPLATES.map((item) => [item.id, item]));

export function getDeployRoleTemplateById(id: string | null | undefined) {
  return TEMPLATE_BY_ID.get(String(id || '').trim());
}

export function isKnownRoleTemplate(roleIdOrName: string | null | undefined) {
  const normalized = String(roleIdOrName || '').trim().toUpperCase();
  return DEPLOY_ROLE_TEMPLATES.some((item) => item.roleId === normalized || item.name.toUpperCase() === normalized);
}
