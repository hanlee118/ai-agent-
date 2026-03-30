import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { FileUp, Upload, Zap } from 'lucide-react';
import {
  ApiRequestError,
  issuesApi,
  productContextApi,
  projectsApi,
  roleSetsApi,
  type IssuePreview,
  type IssueDebateTaskStatus,
  type IssueSourceType,
  type IndustryRoleSetSummary,
  type IndustryTeamConfig,
  type ParsedProjectIntent,
} from '../../lib/api';
import { sendBatchAgentMessage } from '../../lib/adapters';
import { agents } from '../../lib/runtimeCollections';
import { cn } from '../../lib/utils';
import SurfaceModal from '../impl/SurfaceModal';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onProjectCreated?: () => Promise<void> | void;
};

type Priority = 'High' | 'Medium' | 'Low';

type ParsedProjectDraft = {
  name: string;
  description: string;
  phase: string;
  agents: string[];
  priority: Priority;
  team: string[];
};

type IssueEditableDraft = {
  summary: string;
  problemStatement: string;
  expectedOutcome: string;
  inScopeDraft: string;
  outOfScopeDraft: string;
  acceptanceDraft: string;
  missionAnchor: string;
  matchedGoals: string;
  matchedPrinciples: string;
  contextNotes: string;
  designTheme: string;
  valueNarrative: string;
  targetUsers: string;
  coreScenarios: string;
  contractObjective: string;
  contractInScope: string;
  contractOutOfScope: string;
  contractAcceptance: string;
};

type AgentRecommendation = {
  agentId: string;
  roleId: string;
  name: string;
  role: string;
  reason: string;
  score: number;
};

type ClarificationAnswers = {
  deliveryDepth: '' | 'MVP闭环' | '核心流程+管理后台' | '完整一期';
  timeline: '' | '1小时内' | '24小时内' | '1周内' | '2周内' | '1个月内' | '排期待定' | '自定义';
  customTimeline: string;
  collaboration: '' | '并行推进' | '串行推进' | '先分析后研发';
  confirmScope: boolean;
  confirmExecution: boolean;
  successCriteria: string;
  extraConstraints: string;
};

const ROLE_HINTS: Record<string, RegExp[]> = {
  ROLE_PM: [/pm|项目|经理|协调|管理/i],
  ROLE_ANALYST: [/分析|需求|业务|analyst/i],
  ROLE_PRODUCT: [/产品|prd|体验|设计|ui|ux/i],
  ROLE_DESIGN: [/视觉|品牌|页面|官网|landing|design|designer|ui|ux/i],
  ROLE_ARCH: [/架构|architect|系统|后端|服务/i],
  ROLE_DEV: [/开发|研发|工程|dev|前端|后端|代码/i],
  ROLE_QA: [/测试|qa|质量|验收/i],
  ROLE_HR: [/人力|组织|hr|人事/i],
};

const ROLE_LABELS: Record<string, string> = {
  ROLE_ASSISTANT: '总助理',
  ROLE_PM: '项目经理',
  ROLE_ANALYST: '需求分析师',
  ROLE_PRODUCT: '产品总监',
  ROLE_DESIGN: '视觉设计总监',
  ROLE_ARCH: '研发总监',
  ROLE_DEV: '研发经理',
  ROLE_QA: '测试工程师',
  ROLE_HR: 'HR总监',
};

const DOMAIN_RULES: Array<{ domain: string; patterns: RegExp[]; rolePatterns: RegExp[] }> = [
  {
    domain: '需求分析',
    patterns: [/需求|业务|场景|流程|用户|prd|产品/i],
    rolePatterns: [/产品|需求|分析|pm|product|analyst/i],
  },
  {
    domain: '架构研发',
    patterns: [/架构|后端|接口|api|服务|数据库|性能|研发|开发|工程/i],
    rolePatterns: [/架构|研发|工程|dev|backend|architect/i],
  },
  {
    domain: '前端体验',
    patterns: [/前端|页面|ui|ux|交互|工作台|dashboard|web|移动端/i],
    rolePatterns: [/前端|设计|ui|ux|产品|web|frontend/i],
  },
  {
    domain: '测试验收',
    patterns: [/测试|验收|质量|回归|qa|bug/i],
    rolePatterns: [/测试|qa|质量/i],
  },
  {
    domain: '部署运维',
    patterns: [/部署|发布|运维|监控|告警|ci|cd|devops/i],
    rolePatterns: [/运维|ops|devops|平台/i],
  },
];

const INITIAL_CLARIFICATION: ClarificationAnswers = {
  deliveryDepth: '',
  timeline: '',
  customTimeline: '',
  collaboration: '',
  confirmScope: false,
  confirmExecution: false,
  successCriteria: '',
  extraConstraints: '',
};

function Badge({ children, variant = 'default' }: any) {
  const variants: any = {
    default: 'bg-white/5 text-slate-400 border-border-subtle',
    primary: 'bg-primary/20 text-primary border-primary/20',
    accent: 'bg-accent/20 text-accent border-accent/20',
    warning: 'bg-warning/20 text-warning border-warning/20',
    danger: 'bg-danger/20 text-danger border-danger/20',
  };
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border', variants[variant])}>
      {children}
    </span>
  );
}

const fallbackSuggestName = (input: string) => {
  const trimmed = input.trim();
  if (!trimmed) {
    return '';
  }

  const candidate = trimmed
    .replace(/(请|帮我|我们|需要|想要|希望|做一个|做个|创建|搭建|开发|实现|一个|项目|系统)/g, ' ')
    .replace(/[，。,.!?]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join('');

  return candidate ? `${candidate.slice(0, 16)}项目` : '新项目';
};

const inferPriorityFromText = (input: string): Priority => {
  const lower = input.toLowerCase();
  return /(紧急|立即|尽快|高优|asap|critical|urgent)/.test(lower)
    ? 'High'
    : /(低优|可延期|不紧急|nice to have|backlog)/.test(lower)
      ? 'Low'
      : 'Medium';
};

const detectDomains = (input: string) => {
  const hit = DOMAIN_RULES
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(input)))
    .map((rule) => rule.domain);
  return hit.length > 0 ? hit : ['需求分析', '架构研发'];
};

const fallbackParseNaturalLanguage = (input: string): ParsedProjectIntent => {
  const trimmed = input.trim();
  const firstSentence =
    trimmed
      .split(/[。！？.!?\n]/)
      .map((line) => line.trim())
      .find(Boolean) || trimmed;

  const matchedName = trimmed.match(/(?:项目|系统|平台|应用|工作台|MVP)(?:名称|叫|名为)?[:：]?\s*([^\n，。；]{2,24})/);
  let safeName = matchedName?.[1]?.trim() || fallbackSuggestName(firstSentence) || '新项目';
  if (!/(项目|系统|平台|应用|工作台|MVP)/.test(safeName)) {
    safeName = `${safeName}项目`;
  }
  if (safeName.length > 32) {
    safeName = `${safeName.slice(0, 32)}...`;
  }

  return {
    name: safeName,
    description: trimmed,
    phase: '规划中',
    agents: [],
    team: [],
    priority: inferPriorityFromText(trimmed),
  };
};

const normalizeRoleId = (value: string) => value.trim().toUpperCase();

const getAgentRoleId = (agent: { id: string; role: string }) => {
  const id = normalizeRoleId(agent.id);
  const role = normalizeRoleId(agent.role);
  if (id.startsWith('ROLE_')) {
    return id;
  }
  if (role.startsWith('ROLE_')) {
    return role;
  }
  return role || id;
};

const roleLabel = (roleId: string) => ROLE_LABELS[normalizeRoleId(roleId)] || roleId;

const buildAgentRecommendations = (
  input: string,
  suggestedTeam: string[] = [],
  options?: {
    allowedRoleIds?: string[];
    mustHaveSoulRole?: boolean;
    soulRoleId?: string;
  },
) => {
  const normalizedInput = input.trim();
  const domains = detectDomains(normalizedInput);
  const allowedRoleSet = new Set((options?.allowedRoleIds || []).map((role) => normalizeRoleId(role)));
  const candidateAgents = allowedRoleSet.size > 0
    ? agents.filter((agent) => allowedRoleSet.has(getAgentRoleId(agent)))
    : agents;

  const recommendations = candidateAgents
    .map((agent) => {
      const profile = `${agent.name} ${agent.role}`.toLowerCase();
      const agentRoleId = getAgentRoleId(agent);
      let score = 0;
      const reasons: string[] = [];

      if (normalizedInput.includes(agent.name) || normalizedInput.includes(agent.role)) {
        score += 3;
        reasons.push('需求中直接提及该 Agent/角色');
      }

      suggestedTeam.forEach((teamRole) => {
        const hints = ROLE_HINTS[teamRole] || [];
        if (hints.some((hint) => hint.test(profile))) {
          score += 4;
          reasons.push(`匹配解析建议团队角色 ${teamRole}`);
        }
      });

      DOMAIN_RULES.forEach((rule) => {
        const hitDomain = rule.patterns.some((pattern) => pattern.test(normalizedInput));
        const hitAgent = rule.rolePatterns.some((pattern) => pattern.test(profile));
        if (hitDomain && hitAgent) {
          score += 3;
          reasons.push(`擅长「${rule.domain}」`);
        }
      });

      if (agent.status !== 'Offline') {
        score += 1;
      }

      return {
        agentId: agent.id,
        roleId: agentRoleId,
        name: agent.name,
        role: agent.role,
        score,
        reason: reasons.length > 0 ? reasons.slice(0, 2).join('；') : `可参与 ${domains.join('、')} 协作`,
      } as AgentRecommendation;
    })
    .sort((left, right) => right.score - left.score);

  const selected = recommendations.filter((item) => item.score > 0).slice(0, 4);
  if (selected.length > 0) {
    const enforced = [...selected];
    if (options?.mustHaveSoulRole && options.soulRoleId) {
      const soulRoleId = normalizeRoleId(options.soulRoleId);
      const hasSoul = enforced.some((item) => normalizeRoleId(item.roleId) === soulRoleId);
      if (!hasSoul) {
        const soulAgent = recommendations.find((item) => normalizeRoleId(item.roleId) === soulRoleId);
        if (soulAgent) {
          enforced.unshift({
            ...soulAgent,
            reason: `灵魂角色必选：${roleLabel(soulRoleId)}（需求理解与边界识别）`,
            score: Math.max(soulAgent.score, 100),
          });
        }
      }
    }
    return enforced.slice(0, 5);
  }

  const fallback = candidateAgents.slice(0, 3).map((agent) => ({
    agentId: agent.id,
    roleId: getAgentRoleId(agent),
    name: agent.name,
    role: agent.role,
    score: 1,
    reason: '默认推荐参与需求分析与执行规划',
  }));

  if (options?.mustHaveSoulRole && options.soulRoleId) {
    const soulRoleId = normalizeRoleId(options.soulRoleId);
    const hasSoul = fallback.some((item) => normalizeRoleId(item.roleId) === soulRoleId);
    if (!hasSoul) {
      const soulAgent = candidateAgents.find((agent) => normalizeRoleId(getAgentRoleId(agent)) === soulRoleId);
      if (soulAgent) {
        fallback.unshift({
          agentId: soulAgent.id,
          roleId: getAgentRoleId(soulAgent),
          name: soulAgent.name,
          role: soulAgent.role,
          score: 100,
          reason: `灵魂角色必选：${roleLabel(soulRoleId)}（需求理解与边界识别）`,
        });
      }
    }
  }

  return fallback.slice(0, 5);
};

const resolveTimelineLabel = (clarification: ClarificationAnswers) => {
  if (!clarification.timeline) {
    return '';
  }
  if (clarification.timeline !== '自定义') {
    return clarification.timeline;
  }
  const custom = clarification.customTimeline.trim();
  return custom || '自定义（待填写）';
};

const formatClarificationBlock = (clarification: ClarificationAnswers) => [
  `交付深度: ${clarification.deliveryDepth || '未指定'}`,
  `期望周期: ${resolveTimelineLabel(clarification) || '未指定'}`,
  `协作方式: ${clarification.collaboration || '未指定'}`,
  `范围确认: ${clarification.confirmScope ? '已确认' : '未确认'}`,
  `执行确认: ${clarification.confirmExecution ? '已确认' : '未确认'}`,
  `成功标准: ${clarification.successCriteria.trim() || '未补充'}`,
  `额外约束: ${clarification.extraConstraints.trim() || '无'}`,
].join('\n');

const ISSUE_ANSWER_LABELS: Record<string, string> = {
  goal: '业务目标',
  scope: '范围边界',
  acceptance: '验收标准',
};

const formatIssueAnswersBlock = (answers: Record<string, string>) =>
  Object.entries(answers)
    .filter(([, value]) => String(value ?? '').trim())
    .map(([key, value]) => `${ISSUE_ANSWER_LABELS[key] || key}: ${String(value).trim()}`)
    .join('\n');

const toMultilineText = (items: string[] | undefined) => (items || []).join('\n');

const parseMultiline = (value: string) =>
  String(value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

const isCrossBorderSelectionNeed = (input: string) =>
  /(跨境|跨境电商|选品|跟品|爆品|tiktok|亚马逊|amazon|temu|榜单|热卖)/i.test(String(input || '').toLowerCase());

const buildIssueSummaryDraft = (input: string) => {
  const normalized = String(input || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  if (isCrossBorderSelectionNeed(normalized)) {
    return [
      '目标：搭建跨境电商爆品选品跟品机器人，自动识别潜力商品并给出优先级排序。',
      '触发：当商品流量或热度短时爆增时（覆盖 TikTok/亚马逊等平台）。',
      '产出：返回商品链接、排名变化与监控告警，支持实时跟品决策。',
    ].join(' ');
  }

  const sentences = normalized
    .split(/[。！？.!?\n]/)
    .map((item) => item.trim().replace(/[。！？.!?；;，,]+$/g, ''))
    .filter(Boolean);
  if (sentences.length >= 2) {
    return `目标：${sentences[0]}。补充：${sentences[1]}。`;
  }
  return normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized;
};

const extractLocalCrossBorderPlatforms = (input: string) => {
  const normalized = String(input || '').toLowerCase();
  const candidates: Array<{ label: string; pattern: RegExp }> = [
    { label: 'TikTok', pattern: /tiktok|抖音国际|抖音海外/i },
    { label: '亚马逊', pattern: /amazon|亚马逊/i },
    { label: 'Temu', pattern: /temu/i },
    { label: 'Shopee', pattern: /shopee/i },
    { label: 'Lazada', pattern: /lazada/i },
    { label: 'eBay', pattern: /ebay/i },
  ];
  return candidates.filter((item) => item.pattern.test(normalized)).map((item) => item.label);
};

const buildLocalDiscussionItems = (input: string, roleIds: string[]) => {
  const isCrossBorder = isCrossBorderSelectionNeed(input);
  const platforms = extractLocalCrossBorderPlatforms(input);
  const platformText = platforms.length > 0 ? platforms.join('、') : 'TikTok/亚马逊等跨境平台';

  return roleIds.slice(0, 5).map((roleId, index) => {
    if (isCrossBorder) {
      if (roleId === 'ROLE_ANALYST') {
        return {
          id: `local-discussion-${roleId}-${index}`,
          roleId,
          roleLabel: roleLabel(roleId),
          focus: '需求理解与业务信号拆解',
          concern: `已识别核心链路为“流量爆发 → 排名监控 → 链接跟品”，但抓取频率、TopN 阈值、告警阈值尚未确认。`,
          proposal: `结论：先围绕 ${platformText} 交付最小闭环；待确认后再扩展策略。`,
        };
      }
      if (roleId === 'ROLE_PRODUCT') {
        return {
          id: `local-discussion-${roleId}-${index}`,
          roleId,
          roleLabel: roleLabel(roleId),
          focus: '价值定义与决策口径',
          concern: '若榜单无证据链，运营侧无法信任结果并执行跟品决策。',
          proposal: '结论：候选商品需附来源、增速、竞争度与利润空间解释。',
        };
      }
      if (roleId === 'ROLE_DEV' || roleId === 'ROLE_ARCH') {
        return {
          id: `local-discussion-${roleId}-${index}`,
          roleId,
          roleLabel: roleLabel(roleId),
          focus: '数据链路与实现可行性',
          concern: '实时预警诉求较高，需要先确认数据源稳定性与限频策略。',
          proposal: '结论：先打通可追溯采集与规则引擎，再接告警与链接跳转。',
        };
      }
      if (roleId === 'ROLE_QA') {
        return {
          id: `local-discussion-${roleId}-${index}`,
          roleId,
          roleLabel: roleLabel(roleId),
          focus: '验收标准与质量门禁',
          concern: '未量化验收会导致“看起来可用，但无法证明有效”。',
          proposal: '结论：按命中率、告警时效、可追溯性三维验收。',
        };
      }
      return {
        id: `local-discussion-${roleId}-${index}`,
        roleId,
        roleLabel: roleLabel(roleId),
        focus: '协同推进与风险控制',
        concern: '讨论方向已形成，但关键参数未锁定前直接执行风险较高。',
        proposal: '结论：先完成澄清项确认，再进入任务下发。',
      };
    }

    return {
      id: `local-discussion-${roleId}-${index}`,
      roleId,
      roleLabel: roleLabel(roleId),
      focus: index === 0 ? '需求理解与边界识别' : '协作推进建议',
      concern: index === 0 ? '需要确认业务目标、范围边界与验收标准。' : '需要明确职责分工与依赖。',
      proposal: index === 0 ? '先完成必答澄清，再进入执行。' : '按 SOP 分工并同步阶段结论。',
    };
  });
};

const buildEditableDraftFromPreview = (preview: IssuePreview): IssueEditableDraft => ({
  summary: preview.summary || '',
  problemStatement: preview.refinement.problemStatement || '',
  expectedOutcome: preview.refinement.expectedOutcome || '',
  inScopeDraft: toMultilineText(preview.refinement.inScopeDraft),
  outOfScopeDraft: toMultilineText(preview.refinement.outOfScopeDraft),
  acceptanceDraft: toMultilineText(preview.refinement.acceptanceDraft),
  missionAnchor: preview.contextAlignment.missionAnchor || '',
  matchedGoals: toMultilineText(preview.contextAlignment.matchedGoals),
  matchedPrinciples: toMultilineText(preview.contextAlignment.matchedPrinciples),
  contextNotes: toMultilineText(preview.contextAlignment.contextNotes),
  designTheme: preview.designBlueprint.designTheme || '',
  valueNarrative: preview.designBlueprint.valueNarrative || '',
  targetUsers: toMultilineText(preview.designBlueprint.targetUsers),
  coreScenarios: toMultilineText(preview.designBlueprint.coreScenarios),
  contractObjective: preview.requirementContract.objective || '',
  contractInScope: toMultilineText(preview.requirementContract.inScope),
  contractOutOfScope: toMultilineText(preview.requirementContract.outOfScope),
  contractAcceptance: toMultilineText(preview.requirementContract.acceptanceCriteria),
});

const buildLocalIssuePreview = (input: string, industryCode: string, roleIds: string[]): IssuePreview => {
  const isCrossBorder = isCrossBorderSelectionNeed(input);
  const platforms = extractLocalCrossBorderPlatforms(input);
  const platformText = platforms.length > 0 ? platforms.join('、') : 'TikTok/亚马逊等跨境平台';
  const defaultDesignTheme = fallbackSuggestName(input) || '需求设计草案';
  const resolvedIndustry = String(industryCode || '').trim().toLowerCase();
  const requiresCrossBorderScene = resolvedIndustry === 'ecommerce';
  const sceneHitPassed = !requiresCrossBorderScene || isCrossBorder;
  const industrySuggestedPack: Record<string, { goal: string; scope: string; acceptance: string }> = {
    ecommerce: {
      goal: '围绕商品增长机会识别与转化效率，提升业务响应速度与选品决策质量。',
      scope: '必须交付：核心业务链路的数据采集、候选评估与执行闭环；不做：与增长目标无关的外围系统扩展。',
      acceptance: '验收标准：时效、命中率、转化贡献可量化，关键流程可演示且可追溯。',
    },
    fintech: {
      goal: '在保障合规与风险可控前提下，提升业务处理效率与决策准确性。',
      scope: '必须交付：核心业务流程、风险控制点与审计追踪；不做：未经审批的高风险自动化动作。',
      acceptance: '验收标准：满足合规检查与审计追踪要求，关键风险场景有可验证结果。',
    },
    saas: {
      goal: '提升需求落地效率与用户价值交付速度，减少跨角色协作返工。',
      scope: '必须交付：面向核心用户场景的可执行闭环；不做：超出当前版本目标的横向能力扩张。',
      acceptance: '验收标准：核心流程可演示、关键指标可验证、交付物可复用。',
    },
  };
  const industryPack = industrySuggestedPack[resolvedIndustry];
  const localConflicts: IssuePreview['conflicts'] = [];
  if (!sceneHitPassed) {
    localConflicts.push({
      id: 'crossborder-scene-not-hit',
      severity: 'critical',
      title: '场景命中校验未通过',
      detail: '当前行业为电商零售，但需求未命中跨境选品/跟品关键词（如：跨境、选品、跟品、爆品、TikTok、亚马逊）。',
      suggestion: '请补充跨境业务场景与目标平台后重新分析，否则不可进入确认创建。',
    });
  }

  const refinement = isCrossBorder
    ? {
        problemStatement: '当前缺少稳定的跨境爆品发现与跟品机制，选品响应慢、证据链分散、决策一致性不足。',
        expectedOutcome: '交付可演示的爆品选品跟品机器人 MVP，支持多平台监控、排名、链接追踪与告警。',
        inScopeDraft: [
          `接入 ${platformText} 的商品热度信号并建立候选池`,
          '输出候选商品评分与 TopN 排名（含证据来源）',
          '对重点商品进行价格/排名/销量趋势跟踪并触发告警',
          '提供商品链接跳转与人工确认闭环',
        ],
        outOfScopeDraft: ['不做自动下单、自动改价、自动投放等高风险动作'],
        acceptanceDraft: [
          '每日可输出候选榜单并附理由',
          '关键指标异常可在约定时效内触发告警',
          '至少完成2条真实样例从发现到跟品决策闭环',
        ],
      }
    : {
        problemStatement: input.trim(),
        expectedOutcome: '形成可执行需求并进入研发流程',
        inScopeDraft: ['围绕核心场景交付 MVP'],
        outOfScopeDraft: ['不扩展二期功能'],
        acceptanceDraft: ['目标可验证', '范围可验收', '团队可执行'],
      };

  const designTheme = isCrossBorder
    ? `跨境爆品选品与跟品机器人（${platformText}）`
    : defaultDesignTheme;
  const valueNarrative = isCrossBorder
    ? '围绕选品准确率与响应速度双目标，构建“发现-评估-跟品-复盘”闭环。'
    : '围绕产品长期目标落地本次需求，保持可执行与可验证。';
  const localDiscussion = buildLocalDiscussionItems(input, roleIds);
  const localConsensus = localDiscussion
    .map((item) => item.proposal)
    .filter(Boolean)
    .slice(0, 2)
    .map((item) => `共识：${item}`);

  return {
    issueId: `local-${Date.now()}`,
    title: fallbackSuggestName(input) || '新需求',
    summary: buildIssueSummaryDraft(input),
    industryCode,
    recommendedRoleIds: roleIds,
    soulRoleId: 'ROLE_ANALYST',
    conflicts: localConflicts,
    questions: [
      {
        id: 'goal',
        question: '这次需求最核心的业务目标是什么？',
        required: true,
        placeholder: '例如：将人工处理时长减少 40%',
      },
      {
        id: 'scope',
        question: '必须交付与明确不做的范围是什么？',
        required: true,
        placeholder: '例如：只做审批主流程，不做报表系统',
      },
      {
        id: 'acceptance',
        question: '如何验收本次需求已达标？',
        required: true,
        placeholder: '例如：核心流程成功率 >= 95%',
      },
    ],
    refinement,
    contextAlignment: {
      productName: '未配置产品名称',
      missionAnchor: isCrossBorder
        ? '让跨境团队更快发现爆品、持续跟踪商品变化，并基于数据证据完成跟品决策。'
        : '请先在产品说明文档填写使命，以便自动对齐设计。',
      matchedGoals: [],
      matchedPrinciples: [],
      contextNotes: [
        isCrossBorder ? '当前为本地降级分析结果，建议稍后重试以获取完整云端推理输出。' : '',
        requiresCrossBorderScene
          ? (sceneHitPassed
            ? '场景命中校验: 通过（已命中跨境选品/跟品关键词）。'
            : '场景命中校验: 未通过（缺少跨境选品/跟品关键词，当前需求不可直接通过）。')
          : '',
      ].filter(Boolean),
    },
    designBlueprint: {
      designTheme,
      valueNarrative,
      targetUsers: isCrossBorder ? ['跨境选品运营', '商品分析/数据运营', '品类负责人'] : ['核心业务使用者'],
      coreScenarios: isCrossBorder
        ? [`多平台爆发信号监控（${platformText}）`, '候选商品评分排行与证据链展示', '实时跟品告警与商品链接跳转']
        : ['围绕核心场景交付 MVP'],
      proposedMilestones: isCrossBorder
        ? ['需求澄清', '监控与评分规则设计', '研发实现', '验收回填']
        : ['需求澄清', '方案设计', '研发实现', '验收回填'],
    },
    suggestedAnswers: [
      {
        questionId: 'goal',
        answer: isCrossBorder
          ? '提升爆品识别命中率与跟品响应速度，保证决策可追溯可复盘。'
          : (industryPack?.goal || '围绕本次需求提升核心业务效率并与产品使命保持一致。'),
        reason: '基于行业习惯与角色协作结论生成',
      },
      {
        questionId: 'scope',
        answer: isCrossBorder
          ? '必须交付多平台监控、排名、告警和跟品链接闭环；不做自动下单/自动投放。'
          : (industryPack?.scope || '必须交付核心流程闭环，不做与本次目标无关的扩展功能。'),
        reason: '基于行业默认边界与范围收敛原则生成',
      },
      {
        questionId: 'acceptance',
        answer: isCrossBorder
          ? '每日榜单稳定产出且可解释，异常触发告警并完成至少2条真实跟品闭环。'
          : (industryPack?.acceptance || '核心流程可演示，关键目标可验证，并形成方案文档与排期。'),
        reason: '基于行业验收口径生成',
      },
    ],
    relatedHistory: [],
    requirementContract: {
      objective: isCrossBorder
        ? '提升跨境爆品识别与跟品决策效率，并保证结果可追溯。'
        : (industryPack?.goal || '围绕本次需求提升核心业务效率并与产品使命保持一致。'),
      inScope: isCrossBorder
        ? ['多平台信号监控', '候选商品评分排行', '实时告警与链接跟品']
        : ['必须交付核心流程闭环，不做与目标无关扩展'],
      outOfScope: isCrossBorder ? ['自动下单/自动投放', '二期扩展能力'] : ['不扩展二期功能'],
      acceptanceCriteria: isCrossBorder
        ? ['每日候选榜单可解释', '关键异常可告警', '完成真实样例闭环']
        : ['核心流程可演示', '关键目标可验证', '形成方案文档与排期'],
      artifacts: ['客户汇报方案（PPT）', '实施方案（Word）', '设计审查卡', 'Demo 原型', '项目排期'],
      designTheme,
      valueNarrative,
    },
    discussion: localDiscussion,
    debate: {
      mode: 'fallback',
      generatedAt: new Date().toISOString(),
      consensus: localConsensus,
      divergences: localDiscussion.length > 2 ? ['部分角色关注点存在差异，请在确认前核对关键参数。'] : [],
      note: '当前为本地降级讨论结果，建议恢复模型模式后重新分析。',
      opinions: localDiscussion.map((item, index) => ({
        id: `${item.id}-opinion`,
        roleId: item.roleId,
        roleLabel: item.roleLabel,
        focus: item.focus,
        concern: item.concern,
        proposal: item.proposal,
        provider: 'scripted',
        model: 'local-fallback',
        elapsedMs: 0,
        mode: 'fallback',
        rawPreview: `${item.concern} ${item.proposal}`.slice(0, 180),
      })),
    },
    expectedArtifacts: [
      {
        id: 'artifact-ppt',
        name: '客户汇报方案（PPT）',
        description: '面向客户的价值说明与阶段成果汇报材料。',
        stageType: 'DESIGN',
        ownerRoleId: 'ROLE_DESIGN',
      },
      {
        id: 'artifact-word',
        name: '实施方案（Word）',
        description: '需求、约束、验收口径与执行策略文档。',
        stageType: 'DESIGN',
        ownerRoleId: 'ROLE_DESIGN',
      },
      {
        id: 'artifact-design-review',
        name: '设计审查卡',
        description: '视觉方向、品牌语气、可访问性检查与审查结论。',
        stageType: 'DESIGN',
        ownerRoleId: 'ROLE_DESIGN',
      },
      {
        id: 'artifact-demo',
        name: 'Demo 原型',
        description: '覆盖核心链路的可演示原型。',
        stageType: 'DEV',
        ownerRoleId: 'ROLE_DEV',
      },
      {
        id: 'artifact-schedule',
        name: '项目排期',
        description: '里程碑、依赖与负责人计划。',
        stageType: 'ANALYSIS',
        ownerRoleId: 'ROLE_PM',
      },
    ],
    workflow: null,
  };
};

const applySuggestedAnswers = (
  questions: IssuePreview['questions'],
  suggestedAnswers: IssuePreview['suggestedAnswers'],
) =>
  Object.fromEntries(
    questions.map((question) => {
      const suggested = suggestedAnswers.find((item) => item.questionId === question.id)?.answer || '';
      return [question.id, suggested];
    }),
  );

export default function NewProjectModal({ isOpen, onClose, addToast, onProjectCreated }: Props) {
  const [isImporting, setIsImporting] = useState(false);
  const [step, setStep] = useState<'input' | 'analysis' | 'confirm'>('input');
  const [rawInput, setRawInput] = useState('');
  const [industryRoleSets, setIndustryRoleSets] = useState<IndustryRoleSetSummary[]>([]);
  const [selectedIndustryCode, setSelectedIndustryCode] = useState('');
  const [issueSourceType, setIssueSourceType] = useState<IssueSourceType>('text');
  const [selectedIndustryConfig, setSelectedIndustryConfig] = useState<IndustryTeamConfig | null>(null);
  const [isLoadingRoleSets, setIsLoadingRoleSets] = useState(false);
  const [isLoadingIndustryConfig, setIsLoadingIndustryConfig] = useState(false);
  const [parsedProject, setParsedProject] = useState<ParsedProjectDraft | null>(null);
  const [issuePreview, setIssuePreview] = useState<IssuePreview | null>(null);
  const [editableDraft, setEditableDraft] = useState<IssueEditableDraft | null>(null);
  const [issueAnswers, setIssueAnswers] = useState<Record<string, string>>({});
  const [deletingHistoryId, setDeletingHistoryId] = useState<string | null>(null);
  const [conflictAcknowledged, setConflictAcknowledged] = useState(false);
  const [conflictResolution, setConflictResolution] = useState('');
  const [discussionAcknowledged, setDiscussionAcknowledged] = useState(false);
  const [debateTaskId, setDebateTaskId] = useState<string | null>(null);
  const [debateTaskStatus, setDebateTaskStatus] = useState<IssueDebateTaskStatus | null>(null);
  const [debatePollingError, setDebatePollingError] = useState('');
  const [isPollingDebate, setIsPollingDebate] = useState(false);
  const [analysisRecommendations, setAnalysisRecommendations] = useState<AgentRecommendation[]>([]);
  const [detectedDomains, setDetectedDomains] = useState<string[]>([]);
  const [clarification, setClarification] = useState<ClarificationAnswers>(INITIAL_CLARIFICATION);
  const [isParsing, setIsParsing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSavingAlignment, setIsSavingAlignment] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    priority: 'Medium',
    dueDate: '',
    agentIds: [] as string[],
  });

  const allowedRoleIds = useMemo(
    () => selectedIndustryConfig?.roleSet.roleIds || [],
    [selectedIndustryConfig],
  );

  const requiresSoulRole = Boolean(selectedIndustryConfig?.assemblyRule.mustHaveSoulRole);
  const soulRoleId = selectedIndustryConfig?.assemblyRule.soulRoleId || selectedIndustryConfig?.roleSet.defaultSoulRoleId || '';

  const industryAgents = (() => {
    if (allowedRoleIds.length === 0) {
      return agents;
    }
    const allowed = new Set(allowedRoleIds.map((role) => normalizeRoleId(role)));
    return agents.filter((agent) => allowed.has(getAgentRoleId(agent)));
  })();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let cancelled = false;
    const loadRoleSets = async () => {
      setIsLoadingRoleSets(true);
      try {
        const list = await roleSetsApi.list();
        if (cancelled) {
          return;
        }
        setIndustryRoleSets(list);
        setSelectedIndustryCode((prev) => prev || list[0]?.industryCode || '');
      } catch (error) {
        if (!cancelled) {
          addToast(`加载行业角色集失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingRoleSets(false);
        }
      }
    };

    void loadRoleSets();

    return () => {
      cancelled = true;
    };
  }, [isOpen, addToast]);

  useEffect(() => {
    if (!isOpen || !selectedIndustryCode) {
      return;
    }

    let cancelled = false;
    const loadIndustryConfig = async () => {
      setIsLoadingIndustryConfig(true);
      try {
        const config = await roleSetsApi.get(selectedIndustryCode);
        if (!cancelled) {
          setSelectedIndustryConfig(config);
        }
      } catch (error) {
        if (!cancelled) {
          setSelectedIndustryConfig(null);
          addToast(`加载行业团队编排失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingIndustryConfig(false);
        }
      }
    };

    void loadIndustryConfig();

    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedIndustryCode, addToast]);

  useEffect(() => {
    if (!isOpen || !issuePreview?.issueId || !debateTaskId || !debateTaskStatus) {
      return;
    }
    if (debateTaskStatus === 'completed' || debateTaskStatus === 'failed') {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      setIsPollingDebate(true);
      try {
        const result = await issuesApi.getDebate(issuePreview.issueId, debateTaskId);
        if (cancelled) {
          return;
        }
        setDebateTaskStatus(result.status);
        setDebatePollingError(result.error || '');
        setIssuePreview((prev) => {
          if (!prev) {
            return prev;
          }
          return {
            ...prev,
            discussion: result.discussion?.length ? result.discussion : prev.discussion,
            debate: result.debate ?? prev.debate ?? null,
            debateTask: result.taskId
              ? {
                  taskId: result.taskId,
                  status: result.status,
                  pollAfterMs: result.pollAfterMs,
                }
              : prev.debateTask ?? null,
          };
        });

        if (result.status === 'completed') {
          setIsPollingDebate(false);
          setDiscussionAcknowledged(false);
          addToast('多角色辩论已完成，请确认最新讨论结论', 'success');
          return;
        }
        if (result.status === 'failed') {
          setIsPollingDebate(false);
          addToast(`多角色辩论未完成，已保留初步结论: ${result.error || '未知错误'}`, 'info');
          return;
        }

        const nextInterval = Math.max(800, Number(result.pollAfterMs ?? 1500));
        timer = setTimeout(() => {
          void poll();
        }, nextInterval);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setDebatePollingError(error instanceof Error ? error.message : '轮询失败');
        timer = setTimeout(() => {
          void poll();
        }, 2000);
      }
    };

    timer = setTimeout(() => {
      void poll();
    }, Math.max(400, Number(issuePreview.debateTask?.pollAfterMs ?? 800)));

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [isOpen, issuePreview?.issueId, issuePreview?.debateTask?.pollAfterMs, debateTaskId, debateTaskStatus, addToast]);

  const resetState = () => {
    setIsImporting(false);
    setStep('input');
    setRawInput('');
    setIssueSourceType('text');
    setParsedProject(null);
    setIssuePreview(null);
    setEditableDraft(null);
    setIssueAnswers({});
    setDeletingHistoryId(null);
    setConflictAcknowledged(false);
    setConflictResolution('');
    setDiscussionAcknowledged(false);
    setDebateTaskId(null);
    setDebateTaskStatus(null);
    setDebatePollingError('');
    setIsPollingDebate(false);
    setAnalysisRecommendations([]);
    setDetectedDomains([]);
    setClarification(INITIAL_CLARIFICATION);
    setIsParsing(false);
    setIsCreating(false);
    setIsSavingAlignment(false);
    setShowManualForm(false);
    setFormData({
      name: '',
      description: '',
      priority: 'Medium',
      dueDate: '',
      agentIds: [],
    });
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleImportProjectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const raw = await file.text();
      const normalized = raw.trim();
      if (!normalized) {
        addToast('文件内容为空，请重新选择', 'error');
        return;
      }
      const nextInput = normalized.slice(0, 6000);
      setRawInput(nextInput);
      setIsImporting(false);
      setStep('input');
      addToast(`已导入文件: ${file.name}`, 'success');
    } catch (error) {
      addToast(`文件读取失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      event.target.value = '';
    }
  };

  const handleToggleManualAgent = (agentId: string) => {
    setFormData((prev) => ({
      ...prev,
      agentIds: prev.agentIds.includes(agentId)
        ? prev.agentIds.filter((id) => id !== agentId)
        : [...prev.agentIds, agentId],
    }));
  };

  const handleParseInput = async () => {
    const input = rawInput.trim();
    if (!input) {
      addToast('请先输入项目需求', 'error');
      return;
    }

    setIsParsing(true);
    try {
      let preview: IssuePreview | null = null;
      try {
        preview = await issuesApi.preview({
          input,
          industryCode: selectedIndustryCode || selectedIndustryConfig?.roleSet.industryCode || 'saas',
          sourceType: issueSourceType,
        });
      } catch (error) {
        addToast(`Issue 预分析失败，已降级到本地解析: ${error instanceof Error ? error.message : '未知错误'}`, 'info');
      }

      let parsedIntent: ParsedProjectIntent;
      try {
        parsedIntent = await projectsApi.parse(input);
      } catch {
        parsedIntent = fallbackParseNaturalLanguage(input);
      }

      const parsedTeamRoleIds = (preview?.recommendedRoleIds || parsedIntent.team || []).map((role) => normalizeRoleId(role));
      const constrainedTeamRoleIds = allowedRoleIds.length > 0
        ? parsedTeamRoleIds.filter((roleId) => allowedRoleIds.some((allowed) => normalizeRoleId(allowed) === roleId))
        : parsedTeamRoleIds;

      const recommendations = buildAgentRecommendations(input, constrainedTeamRoleIds, {
        allowedRoleIds,
        mustHaveSoulRole: requiresSoulRole,
        soulRoleId,
      });
      const recommendedNames = recommendations.map((item) => item.name);
      const recommendedRoleIds = Array.from(new Set(recommendations.map((item) => normalizeRoleId(item.roleId))));
      const priority = parsedIntent.priority || inferPriorityFromText(input);
      const domains = detectDomains(input);

      const resolvedPreview = preview ?? buildLocalIssuePreview(
        input,
        selectedIndustryCode || selectedIndustryConfig?.roleSet.industryCode || 'saas',
        recommendedRoleIds,
      );
      const parsedDescription = String(parsedIntent.description || '').trim();
      const fullDescription = parsedDescription.length > input.length ? parsedDescription : input;

      setIssuePreview(resolvedPreview);
      setDebateTaskId(resolvedPreview.debateTask?.taskId ?? null);
      setDebateTaskStatus(
        resolvedPreview.debateTask?.status
          ?? (resolvedPreview.debate ? 'completed' : null),
      );
      setDebatePollingError('');
      setIsPollingDebate(Boolean(
        resolvedPreview.debateTask
          && (resolvedPreview.debateTask.status === 'queued' || resolvedPreview.debateTask.status === 'running'),
      ));
      setEditableDraft(buildEditableDraftFromPreview(resolvedPreview));
      setIssueAnswers(applySuggestedAnswers(resolvedPreview.questions || [], resolvedPreview.suggestedAnswers || []));
      setConflictAcknowledged((resolvedPreview.conflicts || []).every((conflict) => conflict.severity !== 'critical'));
      setDiscussionAcknowledged((resolvedPreview.discussion || []).length === 0);
      setDetectedDomains(domains);
      setAnalysisRecommendations(recommendations);
      setClarification(INITIAL_CLARIFICATION);
      setParsedProject({
        name: parsedIntent.name || resolvedPreview.title || fallbackSuggestName(input) || '新项目',
        description: fullDescription,
        phase: parsedIntent.phase || '规划中',
        agents: recommendedNames,
        priority,
        team: recommendedRoleIds,
      });
      setStep('analysis');
      if (requiresSoulRole && !recommendedRoleIds.includes(normalizeRoleId(soulRoleId))) {
        addToast(`已完成需求分析，但当前未匹配到灵魂角色 ${roleLabel(soulRoleId)}，请手动补充`, 'error');
      } else {
        addToast('已完成需求分析并自动分配 Agent，请继续澄清确认', 'success');
      }
    } catch (error) {
      addToast(`需求分析失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsParsing(false);
    }
  };

  const handleContinueFromAnalysis = () => {
    if (!parsedProject) {
      return;
    }

    if (issuePreview) {
      const hasSceneValidationFailure = issuePreview.conflicts.some(
        (conflict) => conflict.id === 'crossborder-scene-not-hit',
      );
      if (hasSceneValidationFailure) {
        addToast('场景命中校验未通过：请在需求中补充跨境选品/跟品关键词后再继续', 'error');
        return;
      }

      const missingRequiredQuestion = issuePreview.questions.find(
        (question) => question.required && !String(issueAnswers[question.id] ?? '').trim(),
      );
      if (missingRequiredQuestion) {
        addToast(`请先补充问题: ${missingRequiredQuestion.question}`, 'error');
        return;
      }

      const hasCriticalConflict = issuePreview.conflicts.some((conflict) => conflict.severity === 'critical');
      if (hasCriticalConflict && !conflictAcknowledged) {
        addToast('检测到关键冲突，请先确认冲突处理意见后再继续', 'error');
        return;
      }
      if (hasCriticalConflict && !conflictResolution.trim()) {
        addToast('请补充关键冲突的解决说明后再继续', 'error');
        return;
      }

      if ((issuePreview.discussion || []).length > 0 && !discussionAcknowledged) {
        addToast('请先确认多角色讨论结论，再进入创建确认卡', 'error');
        return;
      }
    }

    const currentRoleIds = parsedProject.team.map((role) => normalizeRoleId(role));
    if (requiresSoulRole && soulRoleId && !currentRoleIds.includes(normalizeRoleId(soulRoleId))) {
      addToast(`当前行业团队必须包含灵魂角色 ${roleLabel(soulRoleId)}，请先补充后再继续`, 'error');
      return;
    }

    const minRoles = selectedIndustryConfig?.assemblyRule.minRoles ?? 0;
    if (minRoles > 0 && currentRoleIds.length < minRoles) {
      addToast(`当前行业最少需要 ${minRoles} 个角色，请补充团队后再继续`, 'error');
      return;
    }

    const names = analysisRecommendations.map((item) => item.name);
    const roleIds = Array.from(new Set(analysisRecommendations.map((item) => normalizeRoleId(item.roleId))));
    setParsedProject((prev) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        agents: names.length > 0 ? names : prev.agents,
        team: roleIds.length > 0 ? roleIds : prev.team,
      };
    });
    setStep('confirm');
    addToast('澄清完成，请确认创建并启动执行', 'success');
  };

  const handleCreateFromParsed = async () => {
    if (!parsedProject) {
      return;
    }

    const effectiveSummary = String(editableDraft?.summary || issuePreview?.summary || parsedProject.description).trim();
    const effectiveProblemStatement = String(editableDraft?.problemStatement || issuePreview?.refinement.problemStatement || '').trim();
    const effectiveExpectedOutcome = String(editableDraft?.expectedOutcome || issuePreview?.refinement.expectedOutcome || '').trim();
    const effectiveInScopeDraft = parseMultiline(
      editableDraft?.inScopeDraft ?? toMultilineText(issuePreview?.refinement.inScopeDraft),
    );
    const effectiveOutOfScopeDraft = parseMultiline(
      editableDraft?.outOfScopeDraft ?? toMultilineText(issuePreview?.refinement.outOfScopeDraft),
    );
    const effectiveAcceptanceDraft = parseMultiline(
      editableDraft?.acceptanceDraft ?? toMultilineText(issuePreview?.refinement.acceptanceDraft),
    );
    const effectiveMissionAnchor = String(editableDraft?.missionAnchor || issuePreview?.contextAlignment.missionAnchor || '').trim();
    const effectiveGoals = parseMultiline(
      editableDraft?.matchedGoals ?? toMultilineText(issuePreview?.contextAlignment.matchedGoals),
    );
    const effectivePrinciples = parseMultiline(
      editableDraft?.matchedPrinciples ?? toMultilineText(issuePreview?.contextAlignment.matchedPrinciples),
    );
    const effectiveContextNotes = parseMultiline(
      editableDraft?.contextNotes ?? toMultilineText(issuePreview?.contextAlignment.contextNotes),
    );
    const effectiveDesignTheme = String(editableDraft?.designTheme || issuePreview?.designBlueprint.designTheme || '').trim();
    const effectiveValueNarrative = String(
      editableDraft?.valueNarrative || issuePreview?.designBlueprint.valueNarrative || '',
    ).trim();
    const effectiveTargetUsers = parseMultiline(
      editableDraft?.targetUsers ?? toMultilineText(issuePreview?.designBlueprint.targetUsers),
    );
    const effectiveCoreScenarios = parseMultiline(
      editableDraft?.coreScenarios ?? toMultilineText(issuePreview?.designBlueprint.coreScenarios),
    );
    const effectiveContractObjective = String(
      editableDraft?.contractObjective || issuePreview?.requirementContract.objective || '',
    ).trim();
    const effectiveContractInScope = parseMultiline(
      editableDraft?.contractInScope ?? toMultilineText(issuePreview?.requirementContract.inScope),
    );
    const effectiveContractOutOfScope = parseMultiline(
      editableDraft?.contractOutOfScope ?? toMultilineText(issuePreview?.requirementContract.outOfScope),
    );
    const effectiveContractAcceptance = parseMultiline(
      editableDraft?.contractAcceptance ?? toMultilineText(issuePreview?.requirementContract.acceptanceCriteria),
    );

    const clarificationBlock = formatClarificationBlock(clarification);
    const issueAnswersBlock = formatIssueAnswersBlock(issueAnswers);
    const optionalBlock = [
      clarification.deliveryDepth ? `交付深度: ${clarification.deliveryDepth}` : null,
      clarification.timeline ? `期望周期: ${resolveTimelineLabel(clarification)}` : null,
      clarification.collaboration ? `协作方式: ${clarification.collaboration}` : null,
      clarification.successCriteria.trim() ? `补充成功标准: ${clarification.successCriteria.trim()}` : null,
      clarification.extraConstraints.trim() ? `补充约束: ${clarification.extraConstraints.trim()}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    const artifactsBlock = (issuePreview?.expectedArtifacts || [])
      .map((artifact) => `- ${artifact.name}（${roleLabel(artifact.ownerRoleId)} / ${artifact.stageType}）`)
      .join('\n');
    const alignmentBlock = issuePreview
      ? [
          `产品: ${issuePreview.contextAlignment.productName}`,
          `使命锚点: ${effectiveMissionAnchor || '未填写'}`,
          effectiveGoals.length > 0
            ? `对齐目标: ${effectiveGoals.join('；')}`
            : null,
          effectivePrinciples.length > 0 ? `对齐原则: ${effectivePrinciples.join('；')}` : null,
          effectiveContextNotes.length > 0 ? `上下文参考: ${effectiveContextNotes.join('；')}` : null,
        ]
          .filter(Boolean)
          .join('\n')
      : '';
    const blueprintBlock = issuePreview
      ? [
          `主题: ${effectiveDesignTheme || '未填写'}`,
          `价值叙事: ${effectiveValueNarrative || '未填写'}`,
          `目标用户: ${effectiveTargetUsers.join('、') || '未填写'}`,
          `核心场景: ${effectiveCoreScenarios.join('；') || '未填写'}`,
        ].join('\n')
      : '';
    const requirementContractBlock = issuePreview
      ? [
          `目标: ${effectiveContractObjective || '未填写'}`,
          `In Scope: ${effectiveContractInScope.join('；') || '未填写'}`,
          `Out of Scope: ${effectiveContractOutOfScope.join('；') || '未填写'}`,
          `验收: ${effectiveContractAcceptance.join('；') || '未填写'}`,
        ].join('\n')
      : '';
    const historyReferenceBlock = issuePreview && issuePreview.relatedHistory.length > 0
      ? issuePreview.relatedHistory
          .map((item) => `- ${item.title}（${item.validationStatus} / ${item.relevance}%）`)
          .join('\n')
      : '';
    const finalDescription = [
      parsedProject.description || effectiveSummary,
      '',
      effectiveSummary ? `需求摘要: ${effectiveSummary}` : null,
      (effectiveProblemStatement || effectiveExpectedOutcome || effectiveInScopeDraft.length > 0 || effectiveOutOfScopeDraft.length > 0 || effectiveAcceptanceDraft.length > 0)
        ? [
            '需求细化草案:',
            effectiveProblemStatement ? `问题定义: ${effectiveProblemStatement}` : null,
            effectiveExpectedOutcome ? `预期结果: ${effectiveExpectedOutcome}` : null,
            effectiveInScopeDraft.length > 0 ? `建议范围: ${effectiveInScopeDraft.join('；')}` : null,
            effectiveOutOfScopeDraft.length > 0 ? `明确不做: ${effectiveOutOfScopeDraft.join('；')}` : null,
            effectiveAcceptanceDraft.length > 0 ? `初始验收: ${effectiveAcceptanceDraft.join('；')}` : null,
          ].filter(Boolean).join('\n')
        : null,
      selectedIndustryConfig
        ? `行业角色集: ${selectedIndustryConfig.roleSet.industryName} (${selectedIndustryConfig.roleSet.industryCode})`
        : null,
      selectedIndustryConfig
        ? `灵魂角色: ${roleLabel(selectedIndustryConfig.assemblyRule.soulRoleId)}`
        : null,
      issuePreview ? `Issue: ${issuePreview.title}` : null,
      '',
      issueAnswersBlock ? `需求固定结果:\n${issueAnswersBlock}` : null,
      alignmentBlock ? `\n文档对齐结论:\n${alignmentBlock}` : null,
      blueprintBlock ? `\n产品设计草案:\n${blueprintBlock}` : null,
      requirementContractBlock ? `\n需求合同:\n${requirementContractBlock}` : null,
      historyReferenceBlock ? `\n可复用历史经验:\n${historyReferenceBlock}` : null,
      artifactsBlock ? `\n目标产出物:\n${artifactsBlock}` : null,
      optionalBlock ? `\n可选扩展信息:\n${optionalBlock}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const assignedAgentIds = analysisRecommendations.length > 0
      ? Array.from(new Set(analysisRecommendations.map((item) => item.agentId)))
      : Array.from(
          new Set(
            parsedProject.team
              .map((roleId) =>
                agents.find((agent) => normalizeRoleId(getAgentRoleId(agent)) === normalizeRoleId(roleId))?.id,
              )
              .filter(Boolean),
          ),
        ) as string[];

    setIsCreating(true);
    try {
      let created: { id: string; name?: string };
      const canUseIssueConfirm = Boolean(issuePreview?.issueId && !issuePreview.issueId.startsWith('local-'));
      if (canUseIssueConfirm && issuePreview) {
        const confirmation = await issuesApi.confirm(issuePreview.issueId, {
          finalName: parsedProject.name,
          finalDescription,
          clarificationAnswers: {
            ...issueAnswers,
          },
          teamRoleIds: parsedProject.team,
          conflictResolution: conflictResolution.trim() || undefined,
        });
        created = confirmation.project;
      } else {
        created = await projectsApi.create({
          name: parsedProject.name,
          description: finalDescription,
          requirements: rawInput.trim() || parsedProject.description,
          team: parsedProject.team,
        });
      }

      if (assignedAgentIds.length > 0) {
        const artifactsText = (issuePreview?.expectedArtifacts || [])
          .map((artifact) => `- ${artifact.name}（${roleLabel(artifact.ownerRoleId)}）`)
          .join('\n');
        const executionInstruction = [
          `【新项目启动】${parsedProject.name}`,
          `项目ID: ${created.id}`,
          `需求摘要: ${effectiveSummary || parsedProject.description}`,
          '',
          '需求固定结论：',
          issueAnswersBlock || clarificationBlock,
          '',
          '需求合同：',
          requirementContractBlock || '按确认卡中的目标、范围、验收执行',
          historyReferenceBlock ? `\n历史参考:\n${historyReferenceBlock}` : '',
          '',
          '目标产出物：',
          artifactsText || '- 客户汇报方案（PPT）\n- 实施方案（Word）\n- 设计审查卡\n- Demo 原型\n- 项目排期',
          '',
          '请按以下节奏执行：',
          '1. 先完成需求分析与任务拆解',
          '2. 输出里程碑、风险与依赖，并明确产出负责人',
          '3. 确认后推进研发并持续回传进度',
        ].join('\n');

        try {
          await sendBatchAgentMessage(assignedAgentIds, executionInstruction);
          addToast(`项目创建成功，已向 ${assignedAgentIds.length} 个 Agent 下发执行指令`, 'success');
        } catch (error) {
          addToast(`项目已创建，但下发执行指令失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
        }
      } else {
        addToast('项目创建成功，暂未匹配到可下发指令的 Agent', 'info');
      }

      await onProjectCreated?.();
      handleClose();
    } catch (error: any) {
      addToast(`创建失败: ${error?.message || '未知错误'}`, 'error');
    } finally {
      setIsCreating(false);
    }
  };

  const handleManualSubmit = () => {
    if (!formData.name.trim()) {
      addToast('请输入项目名称', 'error');
      return;
    }

    if (!formData.description.trim()) {
      addToast('请输入项目描述', 'error');
      return;
    }

    const manualSelected = formData.agentIds
      .map((id) => agents.find((agent) => agent.id === id))
      .filter(Boolean);
    const manualNames = manualSelected.map((agent) => agent!.name);
    const manualRoleIds = Array.from(
      new Set(manualSelected.map((agent) => normalizeRoleId(getAgentRoleId(agent!)))),
    );

    if (requiresSoulRole && soulRoleId && !manualRoleIds.includes(normalizeRoleId(soulRoleId))) {
      addToast(`当前行业团队必须包含灵魂角色 ${roleLabel(soulRoleId)}`, 'error');
      return;
    }

    const minRoles = selectedIndustryConfig?.assemblyRule.minRoles ?? 0;
    if (minRoles > 0 && manualRoleIds.length < minRoles) {
      addToast(`当前行业最少需要 ${minRoles} 个角色，请继续选择`, 'error');
      return;
    }

    setAnalysisRecommendations(
      manualSelected.map((agent) => ({
        agentId: agent!.id,
        roleId: getAgentRoleId(agent!),
        name: agent!.name,
        role: agent!.role,
        score: 1,
        reason: '手动指定参与该项目',
      })),
    );
    setDetectedDomains(detectDomains(formData.description.trim()));
    setClarification((prev) => ({
      ...prev,
      confirmScope: true,
      confirmExecution: true,
    }));
    setParsedProject({
      name: formData.name.trim(),
      description: formData.description.trim(),
      phase: '规划中',
      agents: manualNames.length > 0 ? manualNames : agents.slice(0, 3).map((agent) => agent.name),
      priority: formData.priority as Priority,
      team: manualRoleIds,
    });
    setStep('confirm');
    addToast('已生成确认卡（手动模式）', 'success');
  };

  const handleUseManualFromParsed = () => {
    if (!parsedProject) {
      return;
    }

    const selectedIds = agents
      .filter((agent) => parsedProject.team.includes(normalizeRoleId(getAgentRoleId(agent))))
      .map((agent) => agent.id);

    setFormData({
      name: parsedProject.name,
      description: parsedProject.description,
      priority: parsedProject.priority,
      dueDate: '',
      agentIds: selectedIds,
    });
    setShowManualForm(true);
    setStep('input');
  };

  const handleDeleteHistoryReference = async (item: { id: string; issueId?: string; projectId?: string }) => {
    const identifiers = [item.id, item.issueId, item.projectId].filter(Boolean) as string[];
    if (identifiers.length === 0) {
      return;
    }
    const confirmed = window.confirm('确认删除这条长期记忆吗？删除后将不再用于需求对齐。');
    if (!confirmed) {
      return;
    }

    setDeletingHistoryId(item.id);
    try {
      let deleted = false;
      let lastError: unknown;
      for (const identifier of identifiers) {
        try {
          await productContextApi.deleteHistory(identifier);
          deleted = true;
          break;
        } catch (error) {
          lastError = error;
          if (!(error instanceof ApiRequestError) || error.status !== 404) {
            throw error;
          }
        }
      }

      if (!deleted) {
        throw (lastError instanceof Error ? lastError : new Error('History not found'));
      }

      setIssuePreview((prev) => {
        if (!prev) {
          return prev;
        }
        return {
          ...prev,
          relatedHistory: prev.relatedHistory.filter((history) => history.id !== item.id),
        };
      });
      addToast('长期记忆已删除', 'success');
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) {
        setIssuePreview((prev) => {
          if (!prev) {
            return prev;
          }
          return {
            ...prev,
            relatedHistory: prev.relatedHistory.filter((history) => history.id !== item.id),
          };
        });
        addToast('长期记忆不存在，已从列表移除', 'info');
        return;
      }
      addToast(`删除长期记忆失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setDeletingHistoryId(null);
    }
  };

  const handleSaveAlignmentToMemory = async () => {
    if (!issuePreview) {
      addToast('请先完成需求分析后再保存对齐修正', 'error');
      return;
    }

    const nextMission = String(editableDraft?.missionAnchor ?? issuePreview.contextAlignment.missionAnchor ?? '').trim();
    const nextGoals = parseMultiline(
      editableDraft?.matchedGoals ?? toMultilineText(issuePreview.contextAlignment.matchedGoals),
    );
    const nextPrinciples = parseMultiline(
      editableDraft?.matchedPrinciples ?? toMultilineText(issuePreview.contextAlignment.matchedPrinciples),
    );

    if (!nextMission && nextGoals.length === 0 && nextPrinciples.length === 0) {
      addToast('请至少填写使命锚点/目标对齐/原则对齐中的一项', 'error');
      return;
    }

    setIsSavingAlignment(true);
    try {
      const current = await productContextApi.get();
      const updated = await productContextApi.update({
        productName: current.productName,
        background: current.background,
        mission: nextMission || current.mission,
        goals: nextGoals.length > 0 ? nextGoals : current.goals,
        principles: nextPrinciples.length > 0 ? nextPrinciples : current.principles,
        constraints: current.constraints,
        forbiddenKeywords: current.forbiddenKeywords,
        requiredKeywords: current.requiredKeywords,
      });

      const savedGoals = nextGoals.length > 0 ? nextGoals : updated.goals;
      const savedPrinciples = nextPrinciples.length > 0 ? nextPrinciples : updated.principles;
      const savedMission = nextMission || updated.mission;
      setEditableDraft((prev) => (prev
        ? {
            ...prev,
            missionAnchor: savedMission,
            matchedGoals: savedGoals.join('\n'),
            matchedPrinciples: savedPrinciples.join('\n'),
          }
        : prev));
      setIssuePreview((prev) => {
        if (!prev) {
          return prev;
        }
        return {
          ...prev,
          contextAlignment: {
            ...prev.contextAlignment,
            missionAnchor: savedMission,
            matchedGoals: savedGoals,
            matchedPrinciples: savedPrinciples,
            contextNotes: [
              ...prev.contextAlignment.contextNotes.filter((item) => !item.startsWith('已保存对齐修正时间')),
              `已保存对齐修正时间: ${new Date().toLocaleString('zh-CN')}`,
            ],
          },
        };
      });
      addToast('已保存三项对齐修正到长期记忆', 'success');
    } catch (error) {
      addToast(`保存对齐修正失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsSavingAlignment(false);
    }
  };

  return (
    <SurfaceModal isOpen={isOpen} onClose={handleClose} title="创建新项目">
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">FR-010 自然语言创建</p>
          <button
            onClick={() => setIsImporting(!isImporting)}
            className="text-[10px] font-bold text-primary hover:underline uppercase tracking-widest flex items-center gap-1"
          >
            <Upload size={12} />
            {isImporting ? '返回创建流程' : '导入项目定义'}
          </button>
        </div>

        {!isImporting ? (
          <>
            {step === 'input' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">行业角色集</label>
                  <select
                    value={selectedIndustryCode}
                    onChange={(event) => setSelectedIndustryCode(event.target.value)}
                    disabled={isLoadingRoleSets}
                    className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none disabled:opacity-50"
                  >
                    {industryRoleSets.map((item) => (
                      <option key={item.id} value={item.industryCode}>
                        {item.industryName} ({item.industryCode})
                      </option>
                    ))}
                    {industryRoleSets.length === 0 && <option value="">暂无行业配置</option>}
                  </select>
                  {selectedIndustryConfig && (
                    <div className="p-3 bg-white/5 border border-border-subtle rounded-xl space-y-2">
                      <p className="text-[11px] text-slate-400">
                        灵魂角色: <span className="text-primary font-semibold">{roleLabel(selectedIndustryConfig.assemblyRule.soulRoleId)}</span>
                        {selectedIndustryConfig.assemblyRule.mustHaveSoulRole ? '（必选）' : ''}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        团队规模建议: {selectedIndustryConfig.assemblyRule.minRoles} - {selectedIndustryConfig.assemblyRule.maxRoles ?? 'N'}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedIndustryConfig.roleSet.roleIds.map((role) => (
                          <span key={role} className="px-2 py-1 text-[10px] rounded-lg bg-white/5 border border-border-subtle text-slate-300">
                            {roleLabel(role)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">需求来源类型</label>
                  <select
                    value={issueSourceType}
                    onChange={(event) => setIssueSourceType(event.target.value as IssueSourceType)}
                    className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none"
                  >
                    <option value="text">一句话需求</option>
                    <option value="journey">用户旅程</option>
                    <option value="meeting_notes">会议纪要</option>
                    <option value="competitor">竞品分析</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">项目需求（自然语言）</label>
                  <textarea
                    rows={5}
                    value={rawInput}
                    onChange={(event) => setRawInput(event.target.value)}
                    placeholder="例如：请创建一个电商客服优化项目，2周内完成 MVP，优先由多个 Agent 并行推进。"
                    className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => void handleParseInput()}
                    disabled={isParsing || isLoadingIndustryConfig || !rawInput.trim()}
                    className="py-3 bg-primary text-surface rounded-xl text-sm font-bold hover:bg-primary/90 transition-all disabled:opacity-50"
                  >
                    {isParsing ? 'AI 分析中...' : isLoadingIndustryConfig ? '加载行业配置中...' : 'AI 分析并分配 Agent'}
                  </button>
                  <button
                    onClick={() => setShowManualForm((prev) => !prev)}
                    className="py-3 bg-white/5 border border-border-subtle rounded-xl text-sm font-bold hover:bg-white/10 transition-all"
                  >
                    {showManualForm ? '收起手动表单' : '手动填写'}
                  </button>
                </div>

                {showManualForm && (
                  <div className="space-y-4 p-4 bg-white/5 border border-border-subtle rounded-2xl">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">项目名称</label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(event) => setFormData((prev) => ({ ...prev, name: event.target.value }))}
                        placeholder="例如: 智能供应链优化"
                        className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">项目描述</label>
                      <textarea
                        rows={3}
                        value={formData.description}
                        onChange={(event) => setFormData((prev) => ({ ...prev, description: event.target.value }))}
                        placeholder="简述项目目标、范围和关键约束..."
                        className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">优先级</label>
                        <select
                          value={formData.priority}
                          onChange={(event) => setFormData((prev) => ({ ...prev, priority: event.target.value as Priority }))}
                          className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none"
                        >
                          <option value="High">高 (High)</option>
                          <option value="Medium">中 (Medium)</option>
                          <option value="Low">低 (Low)</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">截止日期</label>
                        <input
                          type="date"
                          value={formData.dueDate}
                          onChange={(event) => setFormData((prev) => ({ ...prev, dueDate: event.target.value }))}
                          className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">分配团队</label>
                      <div className="flex flex-wrap gap-2">
                        {industryAgents.map((agent) => (
                          <label
                            key={agent.id}
                            className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-border-subtle rounded-xl cursor-pointer hover:bg-white/10 transition-colors"
                          >
                            <input
                              type="checkbox"
                              checked={formData.agentIds.includes(agent.id)}
                              onChange={() => handleToggleManualAgent(agent.id)}
                              className="accent-primary"
                            />
                            <span className="text-xs text-slate-300">{agent.name} · {roleLabel(getAgentRoleId(agent))}</span>
                          </label>
                        ))}
                        {industryAgents.length === 0 && (
                          <p className="text-xs text-slate-500">当前行业角色集中暂无可用 Agent</p>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={handleManualSubmit}
                      disabled={isCreating}
                      className="w-full py-3 bg-primary text-surface rounded-xl text-sm font-bold hover:bg-primary/90 transition-all mt-2 disabled:opacity-50"
                    >
                      生成确认卡
                    </button>
                  </div>
                )}
              </div>
            )}

            {step === 'analysis' && parsedProject && (
              <div className="space-y-5 p-5 bg-surface-soft border border-primary/20 rounded-2xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-primary">
                    <Zap size={14} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">需求分析与自动分配</span>
                  </div>
                  <Badge variant="primary">待补充</Badge>
                </div>

                <div className="space-y-3">
                  <p className="text-xs text-slate-400">识别领域</p>
                  <div className="flex flex-wrap gap-2">
                    {detectedDomains.map((domain) => (
                      <span key={domain} className="px-3 py-1.5 rounded-xl bg-white/5 border border-border-subtle text-xs text-slate-300">
                        {domain}
                      </span>
                    ))}
                  </div>
                </div>

                {issuePreview && (
                  <>
                    <div className="space-y-3">
                      <p className="text-xs text-slate-400">Issue 理解摘要</p>
                      <div className="p-3 rounded-xl bg-white/5 border border-border-subtle space-y-1">
                        <p className="text-sm font-bold text-white">{issuePreview.title}</p>
                        <textarea
                          rows={3}
                          value={editableDraft?.summary ?? issuePreview.summary}
                          onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, summary: event.target.value } : prev))}
                          className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-[11px] text-slate-300 leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                        />
                      </div>
                    </div>

                    <div className="space-y-3">
                      <p className="text-xs text-slate-400">需求细化草案（Agent 初步理解）</p>
                      <div className="p-3 rounded-xl bg-white/5 border border-border-subtle space-y-2">
                        <div className="space-y-1">
                          <p className="text-slate-400 text-xs">问题定义</p>
                          <textarea
                            rows={2}
                            value={editableDraft?.problemStatement ?? issuePreview.refinement.problemStatement}
                            onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, problemStatement: event.target.value } : prev))}
                            className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-slate-400 text-xs">预期结果</p>
                          <textarea
                            rows={2}
                            value={editableDraft?.expectedOutcome ?? issuePreview.refinement.expectedOutcome}
                            onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, expectedOutcome: event.target.value } : prev))}
                            className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-slate-400 text-xs">建议范围（In Scope，每行一条）</p>
                          <textarea
                            rows={3}
                            value={editableDraft?.inScopeDraft ?? toMultilineText(issuePreview.refinement.inScopeDraft)}
                            onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, inScopeDraft: event.target.value } : prev))}
                            className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-slate-400 text-xs">明确不做（Out of Scope，每行一条）</p>
                          <textarea
                            rows={3}
                            value={editableDraft?.outOfScopeDraft ?? toMultilineText(issuePreview.refinement.outOfScopeDraft)}
                            onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, outOfScopeDraft: event.target.value } : prev))}
                            className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-slate-400 text-xs">初始验收口径（每行一条）</p>
                          <textarea
                            rows={3}
                            value={editableDraft?.acceptanceDraft ?? toMultilineText(issuePreview.refinement.acceptanceDraft)}
                            onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, acceptanceDraft: event.target.value } : prev))}
                            className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs text-slate-400">与产品说明文档的对齐结论</p>
                        <button
                          onClick={() => void handleSaveAlignmentToMemory()}
                          disabled={isSavingAlignment}
                          className={cn(
                            'text-[10px] font-bold uppercase tracking-widest transition-colors',
                            isSavingAlignment ? 'text-slate-500 cursor-not-allowed' : 'text-primary hover:underline',
                          )}
                        >
                          {isSavingAlignment ? '保存中...' : '保存三项到长期记忆'}
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-500">可保存：使命锚点 / 目标对齐 / 原则对齐</p>
                      <div className="p-3 rounded-xl bg-white/5 border border-border-subtle space-y-2">
                        <p className="text-xs text-slate-200">
                          <span className="text-slate-400">产品：</span>
                          {issuePreview.contextAlignment.productName}
                        </p>
                        <div className="space-y-1">
                          <p className="text-slate-400 text-xs">使命锚点</p>
                          <textarea
                            rows={2}
                            value={editableDraft?.missionAnchor ?? issuePreview.contextAlignment.missionAnchor}
                            onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, missionAnchor: event.target.value } : prev))}
                            className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-slate-400 text-xs">目标对齐（每行一条）</p>
                          <textarea
                            rows={2}
                            value={editableDraft?.matchedGoals ?? toMultilineText(issuePreview.contextAlignment.matchedGoals)}
                            onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, matchedGoals: event.target.value } : prev))}
                            className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-slate-400 text-xs">原则对齐（每行一条）</p>
                          <textarea
                            rows={2}
                            value={editableDraft?.matchedPrinciples ?? toMultilineText(issuePreview.contextAlignment.matchedPrinciples)}
                            onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, matchedPrinciples: event.target.value } : prev))}
                            className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-slate-400 text-xs">上下文参考（每行一条）</p>
                          <textarea
                            rows={3}
                            value={editableDraft?.contextNotes ?? toMultilineText(issuePreview.contextAlignment.contextNotes)}
                            onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, contextNotes: event.target.value } : prev))}
                            className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <p className="text-xs text-slate-400">产品设计草案（基于上下文自动完善）</p>
                      <div className="p-3 rounded-xl bg-white/5 border border-border-subtle space-y-2">
                        <div className="space-y-1">
                          <p className="text-slate-400 text-xs">设计主题</p>
                          <input
                            type="text"
                            value={editableDraft?.designTheme ?? issuePreview.designBlueprint.designTheme}
                            onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, designTheme: event.target.value } : prev))}
                            className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40"
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-slate-400 text-xs">价值叙事</p>
                          <textarea
                            rows={2}
                            value={editableDraft?.valueNarrative ?? issuePreview.designBlueprint.valueNarrative}
                            onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, valueNarrative: event.target.value } : prev))}
                            className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-slate-400 text-xs">目标用户（每行一条）</p>
                          <textarea
                            rows={2}
                            value={editableDraft?.targetUsers ?? toMultilineText(issuePreview.designBlueprint.targetUsers)}
                            onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, targetUsers: event.target.value } : prev))}
                            className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-slate-400 text-xs">核心场景（每行一条）</p>
                          <textarea
                            rows={3}
                            value={editableDraft?.coreScenarios ?? toMultilineText(issuePreview.designBlueprint.coreScenarios)}
                            onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, coreScenarios: event.target.value } : prev))}
                            className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                          />
                        </div>
                      </div>
                    </div>

                    {issuePreview.relatedHistory.length > 0 && (
                      <div className="space-y-3">
                        <p className="text-xs text-slate-400">历史相似需求（长期记忆复用）</p>
                        <div className="space-y-2">
                          {issuePreview.relatedHistory.map((item) => (
                            <div key={item.id} className="p-3 rounded-xl bg-white/5 border border-border-subtle space-y-1">
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-xs font-semibold text-white">{item.title}</p>
                                <button
                                  onClick={() => void handleDeleteHistoryReference(item)}
                                  disabled={deletingHistoryId === item.id}
                                  className="px-2 py-1 rounded-lg border border-danger/40 text-danger text-[10px] hover:bg-danger/10 disabled:opacity-50"
                                >
                                  {deletingHistoryId === item.id ? '删除中...' : '删除'}
                                </button>
                              </div>
                              <p className="text-[11px] text-slate-400">
                                相关度: {item.relevance}% · 状态: {item.status} · 校验: {item.validationStatus}
                              </p>
                              <p className="text-[11px] text-slate-500">{item.hint}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-3">
                      <p className="text-xs text-slate-400">需求合同草案（可追溯）</p>
                      <div className="p-3 rounded-xl bg-white/5 border border-border-subtle space-y-2">
                        <div className="space-y-1">
                          <p className="text-slate-400 text-xs">目标</p>
                          <textarea
                            rows={2}
                            value={editableDraft?.contractObjective ?? issuePreview.requirementContract.objective}
                            onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, contractObjective: event.target.value } : prev))}
                            className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-slate-400 text-xs">In Scope（每行一条）</p>
                          <textarea
                            rows={3}
                            value={editableDraft?.contractInScope ?? toMultilineText(issuePreview.requirementContract.inScope)}
                            onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, contractInScope: event.target.value } : prev))}
                            className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-slate-400 text-xs">Out of Scope（每行一条）</p>
                          <textarea
                            rows={3}
                            value={editableDraft?.contractOutOfScope ?? toMultilineText(issuePreview.requirementContract.outOfScope)}
                            onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, contractOutOfScope: event.target.value } : prev))}
                            className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-slate-400 text-xs">验收标准（每行一条）</p>
                          <textarea
                            rows={3}
                            value={editableDraft?.contractAcceptance ?? toMultilineText(issuePreview.requirementContract.acceptanceCriteria)}
                            onChange={(event) => setEditableDraft((prev) => (prev ? { ...prev, contractAcceptance: event.target.value } : prev))}
                            className="w-full bg-surface-muted border border-border-subtle rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                          />
                        </div>
                      </div>
                    </div>

                    {issuePreview.discussion.length > 0 && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs text-slate-400">基于 Issue 的多角色讨论结论</p>
                          <div className="flex items-center gap-2">
                            {issuePreview.debateTask && (
                              <Badge variant={debateTaskStatus === 'failed' ? 'danger' : debateTaskStatus === 'completed' ? 'primary' : 'accent'}>
                                {debateTaskStatus === 'queued'
                                  ? '辩论排队中'
                                  : debateTaskStatus === 'running'
                                    ? '辩论进行中'
                                    : debateTaskStatus === 'completed'
                                      ? '辩论已完成'
                                      : debateTaskStatus === 'failed'
                                        ? '辩论失败'
                                        : issuePreview.debateTask.status}
                              </Badge>
                            )}
                            {issuePreview.debate && (
                              <Badge variant={issuePreview.debate.mode === 'model' ? 'primary' : 'warning'}>
                                {issuePreview.debate.mode === 'model' ? '模型多角色讨论' : '降级讨论'}
                              </Badge>
                            )}
                          </div>
                        </div>
                        {issuePreview.debateTask && (debateTaskStatus === 'queued' || debateTaskStatus === 'running' || isPollingDebate) ? (
                          <p className="text-[11px] text-accent">
                            正在异步生成多角色辩论结果，你可以先查看草案，系统会自动刷新为模型结论。
                          </p>
                        ) : null}
                        {debatePollingError ? (
                          <p className="text-[11px] text-warning">
                            辩论轮询异常: {debatePollingError}
                          </p>
                        ) : null}
                        {issuePreview.debate && (
                          <div className="p-3 rounded-xl bg-white/5 border border-border-subtle space-y-2">
                            <p className="text-[11px] text-slate-400">
                              生成时间: {new Date(issuePreview.debate.generatedAt).toLocaleString('zh-CN')}
                            </p>
                            {issuePreview.debate.consensus.length > 0 ? (
                              <div className="space-y-1">
                                <p className="text-[11px] text-slate-300">共识汇总</p>
                                {issuePreview.debate.consensus.map((item, index) => (
                                  <p key={`consensus-${index}`} className="text-[11px] text-slate-400 leading-relaxed">- {item}</p>
                                ))}
                              </div>
                            ) : null}
                            {issuePreview.debate.divergences.length > 0 ? (
                              <div className="space-y-1">
                                <p className="text-[11px] text-slate-300">分歧项</p>
                                {issuePreview.debate.divergences.map((item, index) => (
                                  <p key={`divergence-${index}`} className="text-[11px] text-warning leading-relaxed">- {item}</p>
                                ))}
                              </div>
                            ) : null}
                            {issuePreview.debate.note ? (
                              <p className="text-[11px] text-slate-500 leading-relaxed">说明: {issuePreview.debate.note}</p>
                            ) : null}
                          </div>
                        )}
                        <div className="space-y-2">
                          {issuePreview.discussion.map((item) => (
                            <div key={item.id} className="p-3 rounded-xl bg-white/5 border border-border-subtle space-y-1">
                              <p className="text-xs font-semibold text-white">
                                {item.roleLabel} · {item.focus}
                              </p>
                              <p className="text-[11px] text-slate-400 leading-relaxed">讨论要点: {item.concern}</p>
                              <p className="text-[11px] text-slate-500 leading-relaxed">结论建议: {item.proposal}</p>
                              {issuePreview.debate?.opinions?.find((opinion) => opinion.roleId === item.roleId) && (
                                <p className="text-[10px] text-slate-500">
                                  模型来源: {issuePreview.debate.opinions.find((opinion) => opinion.roleId === item.roleId)?.provider}/
                                  {issuePreview.debate.opinions.find((opinion) => opinion.roleId === item.roleId)?.model}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                        <label className="flex items-center gap-2 text-xs text-slate-300">
                          <input
                            type="checkbox"
                            className="accent-primary"
                            checked={discussionAcknowledged}
                            onChange={(event) => setDiscussionAcknowledged(event.target.checked)}
                          />
                          我确认以上讨论结论，可据此形成任务并进入执行
                        </label>
                      </div>
                    )}

                    {issuePreview.expectedArtifacts.length > 0 && (
                      <div className="space-y-3">
                        <p className="text-xs text-slate-400">预期产出物（创建后自动进入任务）</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {issuePreview.expectedArtifacts.map((artifact) => (
                            <div key={artifact.id} className="p-3 rounded-xl bg-white/5 border border-border-subtle">
                              <p className="text-xs font-semibold text-white">{artifact.name}</p>
                              <p className="text-[11px] text-slate-400 mt-1">{artifact.description}</p>
                              <p className="text-[10px] text-slate-500 mt-1">
                                负责人: {roleLabel(artifact.ownerRoleId)} · 阶段: {artifact.stageType}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-3">
                      <p className="text-xs text-slate-400">冲突检测</p>
                      {issuePreview.conflicts.length > 0 ? (
                        <div className="space-y-2">
                          {issuePreview.conflicts.map((conflict) => (
                            <div key={conflict.id} className="p-3 rounded-xl bg-white/5 border border-border-subtle space-y-1">
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant={
                                    conflict.severity === 'critical'
                                      ? 'danger'
                                      : conflict.severity === 'warning'
                                        ? 'warning'
                                        : 'accent'
                                  }
                                >
                                  {conflict.severity}
                                </Badge>
                                <p className="text-xs font-semibold text-white">{conflict.title}</p>
                              </div>
                              <p className="text-[11px] text-slate-400 leading-relaxed">{conflict.detail}</p>
                              {conflict.suggestion && (
                                <p className="text-[11px] text-slate-500">建议: {conflict.suggestion}</p>
                              )}
                            </div>
                          ))}
                          {issuePreview.conflicts.some((conflict) => conflict.severity === 'critical') && (
                            <div className="space-y-2">
                              <label className="flex items-center gap-2 text-xs text-slate-300">
                                <input
                                  type="checkbox"
                                  className="accent-primary"
                                  checked={conflictAcknowledged}
                                  onChange={(event) => setConflictAcknowledged(event.target.checked)}
                                />
                                我已确认冲突并接受按建议处理
                              </label>
                              <textarea
                                rows={2}
                                value={conflictResolution}
                                onChange={(event) => setConflictResolution(event.target.value)}
                                placeholder="请说明如何解决该冲突（必填）"
                                className="w-full bg-surface-muted border border-border-subtle rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                              />
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">未检测到与产品说明文档的明显冲突。</p>
                      )}
                    </div>

                    {issuePreview.questions.length > 0 && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-slate-400">需求细化必答（3 题）</p>
                          {issuePreview.suggestedAnswers.length > 0 && (
                            <button
                              onClick={() => setIssueAnswers(applySuggestedAnswers(issuePreview.questions, issuePreview.suggestedAnswers))}
                              className="text-[10px] font-bold text-primary hover:underline"
                            >
                              一键应用建议答案
                            </button>
                          )}
                        </div>
                        {issuePreview.suggestedAnswers.length > 0 && (
                          <div className="p-2 rounded-lg bg-white/5 border border-border-subtle">
                            {issuePreview.suggestedAnswers.map((item) => (
                              <p key={item.questionId} className="text-[10px] text-slate-400">
                                {ISSUE_ANSWER_LABELS[item.questionId] || item.questionId}: {item.reason}
                              </p>
                            ))}
                          </div>
                        )}
                        <div className="space-y-2">
                          {issuePreview.questions.map((question) => (
                            <div key={question.id} className="space-y-1">
                              <label className="text-xs text-slate-300">
                                {question.question}
                                {question.required ? <span className="text-danger ml-1">*</span> : null}
                              </label>
                              <input
                                type="text"
                                value={issueAnswers[question.id] ?? ''}
                                onChange={(event) =>
                                  setIssueAnswers((prev) => ({
                                    ...prev,
                                    [question.id]: event.target.value,
                                  }))
                                }
                                placeholder={question.placeholder || '请输入补充信息'}
                                className="w-full bg-surface-muted border border-border-subtle rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {issuePreview.workflow && (
                      <div className="space-y-3">
                        <p className="text-xs text-slate-400">推荐协作 SOP</p>
                        <div className="space-y-2">
                          {issuePreview.workflow.steps.slice(0, 5).map((step) => (
                            <div key={step.order} className="p-3 rounded-xl bg-white/5 border border-border-subtle">
                              <p className="text-xs font-semibold text-white">
                                {step.order}. {step.title} · {roleLabel(step.roleId)}
                              </p>
                              <p className="text-[11px] text-slate-500 mt-1">输入: {step.input}</p>
                              <p className="text-[11px] text-slate-500">输出: {step.output}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                <div className="space-y-3">
                  <p className="text-xs text-slate-400">自动分配的需求分析 Agent</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {analysisRecommendations.map((agent) => (
                      <div key={agent.agentId} className="p-3 rounded-xl bg-white/5 border border-border-subtle space-y-1">
                        <p className="text-sm font-bold text-white">
                          {agent.name}
                          {normalizeRoleId(agent.roleId) === normalizeRoleId(soulRoleId) && (
                            <span className="ml-2 text-[10px] text-primary font-semibold">灵魂角色</span>
                          )}
                        </p>
                        <p className="text-[11px] text-slate-500">{roleLabel(agent.roleId)}</p>
                        <p className="text-[11px] text-slate-400 leading-relaxed">{agent.reason}</p>
                      </div>
                    ))}
                    {analysisRecommendations.length === 0 && (
                      <p className="text-xs text-slate-500">暂无匹配 Agent，请切换行业或手动指定。</p>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-xs text-slate-400">可选扩展信息（非必填）</p>
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <p className="text-xs text-slate-300">交付深度</p>
                      <div className="flex flex-wrap gap-2">
                        {(['MVP闭环', '核心流程+管理后台', '完整一期'] as const).map((item) => (
                          <button
                            key={item}
                            onClick={() => setClarification((prev) => ({ ...prev, deliveryDepth: item }))}
                            className={cn(
                              'px-3 py-2 rounded-lg text-xs border transition-colors',
                              clarification.deliveryDepth === item
                                ? 'bg-primary/20 text-primary border-primary/30'
                                : 'bg-white/5 text-slate-300 border-border-subtle hover:bg-white/10',
                            )}
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs text-slate-300">期望周期</p>
                      <div className="flex flex-wrap gap-2">
                        {(['1小时内', '24小时内', '1周内', '2周内', '1个月内', '排期待定', '自定义'] as const).map((item) => (
                          <button
                            key={item}
                            onClick={() =>
                              setClarification((prev) => ({
                                ...prev,
                                timeline: item,
                                customTimeline: item === '自定义' ? prev.customTimeline : '',
                              }))
                            }
                            className={cn(
                              'px-3 py-2 rounded-lg text-xs border transition-colors',
                              clarification.timeline === item
                                ? 'bg-primary/20 text-primary border-primary/30'
                                : 'bg-white/5 text-slate-300 border-border-subtle hover:bg-white/10',
                            )}
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                      {clarification.timeline === '自定义' && (
                        <input
                          type="text"
                          value={clarification.customTimeline}
                          onChange={(event) =>
                            setClarification((prev) => ({ ...prev, customTimeline: event.target.value }))
                          }
                          placeholder="请输入自定义周期，例如：45分钟内 / 3个工作日"
                          className="w-full bg-surface-muted border border-border-subtle rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                        />
                      )}
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs text-slate-300">协作方式</p>
                      <div className="flex flex-wrap gap-2">
                        {(['并行推进', '串行推进', '先分析后研发'] as const).map((item) => (
                          <button
                            key={item}
                            onClick={() => setClarification((prev) => ({ ...prev, collaboration: item }))}
                            className={cn(
                              'px-3 py-2 rounded-lg text-xs border transition-colors',
                              clarification.collaboration === item
                                ? 'bg-primary/20 text-primary border-primary/30'
                                : 'bg-white/5 text-slate-300 border-border-subtle hover:bg-white/10',
                            )}
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-xs text-slate-400">执行确认（可选）</p>
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={clarification.confirmScope}
                      onChange={(event) =>
                        setClarification((prev) => ({ ...prev, confirmScope: event.target.checked }))
                      }
                    />
                    我确认当前项目目标与范围可进入执行拆解
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={clarification.confirmExecution}
                      onChange={(event) =>
                        setClarification((prev) => ({ ...prev, confirmExecution: event.target.checked }))
                      }
                    />
                    我确认允许系统按上述策略自动推动研发执行
                  </label>
                </div>

                <div className="space-y-3">
                  <p className="text-xs text-slate-400">补充信息（可选）</p>
                  <textarea
                    rows={2}
                    value={clarification.successCriteria}
                    onChange={(event) => setClarification((prev) => ({ ...prev, successCriteria: event.target.value }))}
                    placeholder="补充成功标准（例如：上线可演示版本、核心流程可闭环、关键接口响应时间）"
                    className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                  />
                  <textarea
                    rows={2}
                    value={clarification.extraConstraints}
                    onChange={(event) => setClarification((prev) => ({ ...prev, extraConstraints: event.target.value }))}
                    placeholder="补充约束（例如：必须本地部署、预算限制、兼容既有系统）"
                    className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                  />
                </div>

                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => setStep('input')}
                    className="flex-1 py-2.5 bg-white/5 border border-border-subtle rounded-xl text-xs font-bold hover:bg-white/10 transition-all"
                  >
                    返回修改需求
                  </button>
                  <button
                    onClick={handleContinueFromAnalysis}
                    className="flex-1 py-2.5 bg-primary text-surface rounded-xl text-xs font-bold hover:bg-primary/90 transition-all"
                  >
                    完成需求细化并生成确认卡
                  </button>
                </div>
              </div>
            )}

            {step === 'confirm' && parsedProject && (
              <div className="bg-surface-soft border border-warning/20 rounded-2xl p-5 space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-warning">
                    <Zap size={14} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">创建前理解确认卡</span>
                  </div>
                  <Badge variant="warning">待确认</Badge>
                </div>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">名称</label>
                    <input
                      type="text"
                      value={parsedProject.name}
                      onChange={(event) => setParsedProject((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
                      className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">描述</label>
                    <textarea
                      rows={6}
                      value={parsedProject.description}
                      onChange={(event) =>
                        setParsedProject((prev) => (prev ? { ...prev, description: event.target.value } : prev))
                      }
                      className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y min-h-[140px]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">阶段</label>
                      <select
                        value={parsedProject.phase}
                        onChange={(event) => setParsedProject((prev) => (prev ? { ...prev, phase: event.target.value } : prev))}
                        className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none"
                      >
                        <option value="规划中">规划中</option>
                        <option value="分析">分析</option>
                        <option value="设计">设计</option>
                        <option value="开发">开发</option>
                        <option value="验收">验收</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">优先级</label>
                      <select
                        value={parsedProject.priority}
                        onChange={(event) =>
                          setParsedProject((prev) =>
                            prev ? { ...prev, priority: event.target.value as Priority } : prev,
                          )
                        }
                        className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none"
                      >
                        <option value="High">高 (High)</option>
                        <option value="Medium">中 (Medium)</option>
                        <option value="Low">低 (Low)</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">需求固定结果</label>
                    <pre className="whitespace-pre-wrap text-xs text-slate-300 bg-surface-muted border border-border-subtle rounded-xl px-4 py-3">
                      {formatIssueAnswersBlock(issueAnswers) || formatClarificationBlock(clarification)}
                    </pre>
                  </div>
                  {(issuePreview?.expectedArtifacts || []).length > 0 && (
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">目标产出物</label>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {issuePreview!.expectedArtifacts.map((artifact) => (
                          <div key={artifact.id} className="px-3 py-2 rounded-xl bg-white/5 border border-border-subtle">
                            <p className="text-xs text-slate-200">{artifact.name}</p>
                            <p className="text-[10px] text-slate-500 mt-1">
                              {roleLabel(artifact.ownerRoleId)} · {artifact.stageType}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">执行团队</label>
                    <div className="flex flex-wrap gap-2">
                      {analysisRecommendations.length > 0
                        ? analysisRecommendations.map((agent) => (
                            <span key={agent.agentId} className="px-3 py-1.5 rounded-xl bg-white/5 border border-border-subtle text-xs text-slate-300">
                              {agent.name} · {roleLabel(agent.roleId)}
                            </span>
                          ))
                        : (parsedProject.team.length > 0 ? parsedProject.team : ['未识别，建议手动调整']).map((roleId) => (
                            <span key={roleId} className="px-3 py-1.5 rounded-xl bg-white/5 border border-border-subtle text-xs text-slate-300">
                              {roleLabel(roleId)}
                            </span>
                          ))}
                    </div>
                    {selectedIndustryConfig && (
                      <p className="text-[11px] text-slate-500">
                        行业: {selectedIndustryConfig.roleSet.industryName} · 灵魂角色: {roleLabel(selectedIndustryConfig.assemblyRule.soulRoleId)}
                        {requiresSoulRole ? '（必选）' : ''}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setStep('analysis')}
                    className="flex-1 py-2.5 bg-white/5 border border-border-subtle rounded-xl text-xs font-bold hover:bg-white/10 transition-all"
                  >
                    返回澄清
                  </button>
                  <button
                    onClick={handleUseManualFromParsed}
                    className="flex-1 py-2.5 bg-white/5 border border-border-subtle rounded-xl text-xs font-bold hover:bg-white/10 transition-all"
                  >
                    手动微调
                  </button>
                  <button
                    onClick={() => void handleCreateFromParsed()}
                    disabled={isCreating}
                    className="flex-1 py-2.5 bg-primary text-surface rounded-xl text-xs font-bold hover:bg-primary/90 transition-all disabled:opacity-50"
                  >
                    {isCreating ? '创建中...' : '确认创建并启动执行'}
                  </button>
                </div>
                <button
                  onClick={handleClose}
                  className="w-full py-2 bg-transparent border border-border-subtle rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-white/5 transition-all"
                >
                  取消
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="p-8 border-2 border-dashed border-border-subtle rounded-2xl bg-white/5 flex flex-col items-center justify-center space-y-4 group hover:border-primary/50 transition-all cursor-pointer">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
              <FileUp size={24} />
            </div>
            <div className="text-center">
              <p className="text-sm font-bold text-white">点击或拖拽文件到此处</p>
              <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-widest">支持 .json, .yaml, .md, .txt 项目文档</p>
            </div>
            <input
              type="file"
              className="hidden"
              id="project-file"
              accept=".txt,.md,.json,.yaml,.yml,.csv,.log,.xml"
              onChange={(event) => void handleImportProjectFile(event)}
            />
            <label
              htmlFor="project-file"
              className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-[10px] font-bold text-white transition-all cursor-pointer"
            >
              选择文件
            </label>
          </div>
        )}
      </div>
    </SurfaceModal>
  );
}
