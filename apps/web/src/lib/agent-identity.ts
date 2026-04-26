import type { OpenClawAgentSummary } from './api/openclawAgentsApi';

export const ROLE_TO_OPENCLAW_AGENT_ID: Record<string, string> = {
  ROLE_PM: 'project_manager',
  ROLE_ANALYST: 'requirements_analyst',
  ROLE_PRODUCT: 'product_director',
  ROLE_DESIGN: 'jeremy',
  ROLE_ARCH: 'rd_director',
  ROLE_DEV: 'rd_manager',
  ROLE_QA: 'qa_engineer',
  ROLE_HR: 'hr_director',
};

export const OPENCLAW_AGENT_TO_ROLE_ID: Record<string, string> = Object.fromEntries(
  Object.entries(ROLE_TO_OPENCLAW_AGENT_ID).map(([roleId, agentId]) => [agentId, roleId]),
);

export const normalizeCompareValue = (value: string | null | undefined) =>
  String(value || '').trim().toLowerCase();

const normalizeToken = (value: string | null | undefined) =>
  normalizeCompareValue(value).replace(/[\s_-]+/g, '');

const expandAgentMatchTokens = (value: string | null | undefined) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return [];
  }
  const normalized = normalizeCompareValue(trimmed);
  const compact = normalizeToken(trimmed);
  return Array.from(new Set([trimmed.toLowerCase(), normalized, compact].filter(Boolean)));
};

export const matchOpenClawAgent = (
  list: OpenClawAgentSummary[],
  matchValues: Array<string | null | undefined>,
): OpenClawAgentSummary | null => {
  const tokens = new Set<string>();
  matchValues.forEach((value) => {
    expandAgentMatchTokens(value).forEach((token) => tokens.add(token));
  });
  if (tokens.size === 0) {
    return null;
  }
  const match = list.find((item) => {
    const itemTokens = new Set<string>();
    expandAgentMatchTokens(item.agentId).forEach((token) => itemTokens.add(token));
    expandAgentMatchTokens(item.name).forEach((token) => itemTokens.add(token));
    expandAgentMatchTokens(item.title).forEach((token) => itemTokens.add(token));
    for (const token of tokens) {
      if (itemTokens.has(token)) {
        return true;
      }
    }
    return false;
  });
  return match || null;
};

export const resolveOpenClawAgentBinding = (params: {
  agentId?: string | null;
  agentName?: string | null;
  agentRole?: string | null;
  list?: OpenClawAgentSummary[] | null;
}) => {
  const { agentId, agentName, agentRole, list } = params;
  const fallbackId = String(agentId || '').trim();
  const fallbackRole = String(agentRole || '').trim();
  const openclawList = Array.isArray(list) ? list : [];
  const matched = matchOpenClawAgent(openclawList, [
    fallbackId,
    agentName,
    fallbackRole,
    ROLE_TO_OPENCLAW_AGENT_ID[fallbackId],
    ROLE_TO_OPENCLAW_AGENT_ID[fallbackRole],
  ]);
  const directId = fallbackId && !/^ROLE_/i.test(fallbackId) ? fallbackId : '';
  const openclawAgentId = String(
    matched?.agentId
    || directId
    || ROLE_TO_OPENCLAW_AGENT_ID[fallbackId]
    || ROLE_TO_OPENCLAW_AGENT_ID[fallbackRole]
    || '',
  ).trim();
  const matchedTitle = String(matched?.title || '').trim();
  const linkedRoleId = String(
    OPENCLAW_AGENT_TO_ROLE_ID[openclawAgentId]
    || (matchedTitle.startsWith('ROLE_') ? matchedTitle : '')
    || (/^ROLE_/i.test(fallbackId) ? fallbackId : '')
    || fallbackRole
    || fallbackId
    || '',
  ).trim();

  return {
    openclawAgentId,
    linkedRoleId,
    matched,
  };
};
