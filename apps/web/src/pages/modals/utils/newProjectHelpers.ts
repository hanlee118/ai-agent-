import type {
  IssuePreview,
  IndustryTeamConfig,
  ParsedProjectIntent,
} from '../../../lib/api';
import { agents } from '../../../lib/runtimeCollections';
import type {
  AgentRecommendation,
  ClarificationAnswers,
  IssueEditableDraft,
  Priority,
} from '../NewProjectModal.types';

export const ROLE_HINTS: Record<string, RegExp[]> = {
  ROLE_PM: [/pm|项目|经理|协调|管理/i],
  ROLE_ANALYST: [/分析|需求|业务|analyst/i],
  ROLE_PRODUCT: [/产品|prd|体验|设计|ui|ux/i],
  ROLE_DESIGN: [/视觉|品牌|页面|官网|landing|design|designer|ui|ux/i],
  ROLE_ARCH: [/架构|architect|系统|后端|服务/i],
  ROLE_DEV: [/开发|研发|工程|dev|前端|后端|代码/i],
  ROLE_QA: [/测试|qa|质量|验收/i],
  ROLE_HR: [/人力|组织|hr|人事/i],
};

export const ROLE_LABELS: Record<string, string> = {
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

export const DOMAIN_RULES: Array<{ domain: string; patterns: RegExp[]; rolePatterns: RegExp[] }> = [
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

export const INITIAL_CLARIFICATION: ClarificationAnswers = {
  deliveryDepth: '',
  timeline: '',
  customTimeline: '',
  collaboration: '',
  confirmScope: false,
  confirmExecution: false,
  successCriteria: '',
  extraConstraints: '',
};

export const ISSUE_ANSWER_LABELS: Record<string, string> = {
  goal: '业务目标',
  scope: '范围边界',
  acceptance: '验收标准',
};

export const fallbackSuggestName = (input: string) => {
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

export const inferPriorityFromText = (input: string): Priority => {
  const lower = input.toLowerCase();
  return /(紧急|立即|尽快|高优|asap|critical|urgent)/.test(lower)
    ? 'High'
    : /(低优|可延期|不紧急|nice to have|backlog)/.test(lower)
      ? 'Low'
      : 'Medium';
};

export const detectDomains = (input: string) => {
  const hit = DOMAIN_RULES
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(input)))
    .map((rule) => rule.domain);
  return hit.length > 0 ? hit : ['需求分析', '架构研发'];
};

export const fallbackParseNaturalLanguage = (input: string): ParsedProjectIntent => {
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

export const normalizeRoleId = (value: string) => value.trim().toUpperCase();

export const getAgentRoleId = (agent: { id: string; role: string; name?: string }) => {
  const id = normalizeRoleId(agent.id);
  const role = normalizeRoleId(agent.role);
  if (id.startsWith('ROLE_')) {
    return id;
  }
  if (role.startsWith('ROLE_')) {
    return role;
  }

  const profile = `${agent.name || ''} ${agent.role || ''}`.toLowerCase();
  const matchedRole = (Object.entries(ROLE_HINTS) as Array<[string, RegExp[]]>)
    .find(([, patterns]) => patterns.some((pattern) => pattern.test(profile)))?.[0];
  if (matchedRole) {
    return matchedRole;
  }

  return role || id;
};

export const roleLabel = (roleId: string) => ROLE_LABELS[normalizeRoleId(roleId)] || roleId;

export const buildAgentRecommendations = (
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
  const filteredAgents = allowedRoleSet.size > 0
    ? agents.filter((agent) => allowedRoleSet.has(getAgentRoleId(agent)))
    : agents;
  const candidateAgents = filteredAgents.length > 0 ? filteredAgents : agents;

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

export const resolveTimelineLabel = (clarification: ClarificationAnswers) => {
  if (!clarification.timeline) {
    return '';
  }
  if (clarification.timeline !== '自定义') {
    return clarification.timeline;
  }
  const custom = clarification.customTimeline.trim();
  return custom || '自定义（待填写）';
};

export const formatClarificationBlock = (clarification: ClarificationAnswers) => [
  `交付深度: ${clarification.deliveryDepth || '未指定'}`,
  `期望周期: ${resolveTimelineLabel(clarification) || '未指定'}`,
  `协作方式: ${clarification.collaboration || '未指定'}`,
  `范围确认: ${clarification.confirmScope ? '已确认' : '未确认'}`,
  `执行确认: ${clarification.confirmExecution ? '已确认' : '未确认'}`,
  `成功标准: ${clarification.successCriteria.trim() || '未补充'}`,
  `额外约束: ${clarification.extraConstraints.trim() || '无'}`,
].join('\n');

export const formatIssueAnswersBlock = (answers: Record<string, string>) =>
  Object.entries(answers)
    .filter(([, value]) => String(value ?? '').trim())
    .map(([key, value]) => `${ISSUE_ANSWER_LABELS[key] || key}: ${String(value).trim()}`)
    .join('\n');

export const toMultilineText = (items: string[] | undefined) => (items || []).join('\n');

export const parseMultiline = (value: string) =>
  String(value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

export const isCrossBorderSelectionNeed = (input: string) =>
  /(跨境|跨境电商|选品|跟品|爆品|tiktok|亚马逊|amazon|temu|榜单|热卖)/i.test(String(input || '').toLowerCase());

export const buildIssueSummaryDraft = (input: string) => {
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

export const extractLocalCrossBorderPlatforms = (input: string) => {
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

export const buildLocalDiscussionItems = (input: string, roleIds: string[]) => {
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

export const buildEditableDraftFromPreview = (preview: IssuePreview): IssueEditableDraft => ({
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

export const buildLocalIssuePreview = (input: string, industryCode: string, roleIds: string[]): IssuePreview => {
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
      artifacts: ['需求分析文档', '项目排期', '设计审查卡', '视觉定稿单页', '技术方案与选型', '实现结果说明', '运行地址与部署说明', '测试报告'],
      designTheme,
      valueNarrative,
    },
    discussion: [],
    discussionDraft: localDiscussion,
    debate: null,
    analysisGate: {
      canProceed: false,
      blockers: [
        '当前仅生成本地分析草稿，尚未获得真实模型多角色讨论结果。',
      ],
      checks: [
        {
          id: 'runtime-real-model',
          label: '运行时必须启用真实模型',
          passed: false,
          detail: '当前为本地降级分析，无法确认运行时真实模型状态。',
        },
        {
          id: 'debate-enabled',
          label: '必须启用真实多角色讨论',
          passed: false,
          detail: '本地草稿未创建真实多角色讨论任务。',
        },
        {
          id: 'debate-model-completed',
          label: '正式讨论必须由真实模型完成',
          passed: false,
          detail: '当前仅有规则草稿提示，不能作为正式分析结论。',
        },
      ],
      runtimeMode: 'local-fallback',
      requestedRuntimeMode: 'unknown',
    },
    expectedArtifacts: [
      {
        id: 'artifact-analysis-doc',
        name: '需求分析文档',
        description: '面向设计与研发的结构化需求、边界、约束、风险与验收标准。',
        stageType: 'ANALYSIS',
        ownerRoleId: 'ROLE_ANALYST',
      },
      {
        id: 'artifact-schedule',
        name: '项目排期',
        description: '里程碑、负责人、依赖与风险缓冲的执行排期。',
        stageType: 'ANALYSIS',
        ownerRoleId: 'ROLE_PM',
      },
      {
        id: 'artifact-design-review',
        name: '设计审查卡',
        description: '视觉方向、品牌语气、可访问性检查与审查结论。',
        stageType: 'DESIGN',
        ownerRoleId: 'ROLE_DESIGN',
      },
      {
        id: 'artifact-visual-preview',
        name: '视觉定稿单页',
        description: '可供业务确认和研发实现的静态图或 HTML 单页设计预览。',
        stageType: 'DESIGN',
        ownerRoleId: 'ROLE_DESIGN',
      },
      {
        id: 'artifact-tech-plan',
        name: '技术方案与选型',
        description: '研发实现前的系统边界、接口契约、数据链路与技术取舍。',
        stageType: 'DEV',
        ownerRoleId: 'ROLE_ARCH',
      },
      {
        id: 'artifact-impl-result',
        name: '实现结果说明',
        description: '真实页面、接口、代码改动与验证证据说明。',
        stageType: 'DEV',
        ownerRoleId: 'ROLE_DEV',
      },
      {
        id: 'artifact-runtime-delivery',
        name: '运行地址与部署说明',
        description: '运行入口、启动方式、环境变量与联调验证步骤。',
        stageType: 'DEV',
        ownerRoleId: 'ROLE_DEV',
      },
      {
        id: 'artifact-test-report',
        name: '测试报告',
        description: '面向验收阶段的测试范围、结果、阻断项与回归结论。',
        stageType: 'ACCEPT',
        ownerRoleId: 'ROLE_QA',
      },
    ],
    workflow: null,
  };
};

export const applySuggestedAnswers = (
  questions: IssuePreview['questions'],
  suggestedAnswers: IssuePreview['suggestedAnswers'],
) =>
  Object.fromEntries(
    questions.map((question) => {
      const suggested = suggestedAnswers.find((item) => item.questionId === question.id)?.answer || '';
      return [question.id, suggested];
    }),
  );

export const resolveAgentSelection = (
  config: IndustryTeamConfig | null,
  currentTeamRoleIds: string[],
  fallbackAgentIds: string[],
) => {
  const allowedRoleIds = config?.roleSet.roleIds || [];
  const allowed = new Set(allowedRoleIds.map((role) => normalizeRoleId(role)));
  const chosenByRole = agents
    .filter((agent) => currentTeamRoleIds.includes(normalizeRoleId(getAgentRoleId(agent))))
    .map((agent) => agent.id);

  const filteredFallback = fallbackAgentIds.filter((agentId) => {
    const agent = agents.find((item) => item.id === agentId);
    if (!agent) {
      return false;
    }
    if (allowed.size === 0) {
      return true;
    }
    return allowed.has(normalizeRoleId(getAgentRoleId(agent)));
  });

  return Array.from(new Set([...chosenByRole, ...filteredFallback]));
};
