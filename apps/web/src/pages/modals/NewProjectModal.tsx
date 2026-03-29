import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { FileUp, Upload, Zap } from 'lucide-react';
import {
  issuesApi,
  projectsApi,
  roleSetsApi,
  type IssuePreview,
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
  timeline: '' | '1周内' | '2周内' | '1个月内' | '排期待定';
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

const formatClarificationBlock = (clarification: ClarificationAnswers) => [
  `交付深度: ${clarification.deliveryDepth || '未指定'}`,
  `期望周期: ${clarification.timeline || '未指定'}`,
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

const buildLocalIssuePreview = (input: string, industryCode: string, roleIds: string[]): IssuePreview => ({
  issueId: `local-${Date.now()}`,
  title: fallbackSuggestName(input) || '新需求',
  summary: input.trim(),
  industryCode,
  recommendedRoleIds: roleIds,
  soulRoleId: 'ROLE_ANALYST',
  conflicts: [],
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
  refinement: {
    problemStatement: input.trim(),
    expectedOutcome: '形成可执行需求并进入研发流程',
    inScopeDraft: ['围绕核心场景交付 MVP'],
    outOfScopeDraft: ['不扩展二期功能'],
    acceptanceDraft: ['目标可验证', '范围可验收', '团队可执行'],
  },
  contextAlignment: {
    productName: '未配置产品名称',
    missionAnchor: '请先在产品说明文档填写使命，以便自动对齐设计。',
    matchedGoals: [],
    matchedPrinciples: [],
    contextNotes: [],
  },
  designBlueprint: {
    designTheme: fallbackSuggestName(input) || '需求设计草案',
    valueNarrative: '围绕产品长期目标落地本次需求，保持可执行与可验证。',
    targetUsers: ['核心业务使用者'],
    coreScenarios: ['围绕核心场景交付 MVP'],
    proposedMilestones: ['需求澄清', '方案设计', '研发实现', '验收回填'],
  },
  suggestedAnswers: [
    {
      questionId: 'goal',
      answer: '围绕本次需求提升核心业务效率并与产品使命保持一致。',
      reason: '基于默认产品方法论生成',
    },
    {
      questionId: 'scope',
      answer: '必须交付核心流程闭环，不做与本次目标无关的扩展功能。',
      reason: '基于范围收敛原则生成',
    },
    {
      questionId: 'acceptance',
      answer: '核心流程可演示，关键目标可验证，并形成方案文档与排期。',
      reason: '基于验收模板生成',
    },
  ],
  relatedHistory: [],
  requirementContract: {
    objective: '围绕本次需求提升核心业务效率并与产品使命保持一致。',
    inScope: ['必须交付核心流程闭环，不做与目标无关扩展'],
    outOfScope: ['不扩展二期功能'],
    acceptanceCriteria: ['核心流程可演示', '关键目标可验证', '形成方案文档与排期'],
    artifacts: ['客户汇报方案（PPT）', '实施方案（Word）', '设计审查卡', 'Demo 原型', '项目排期'],
    designTheme: fallbackSuggestName(input) || '需求设计草案',
    valueNarrative: '围绕产品长期目标落地本次需求，保持可执行与可验证。',
  },
  discussion: roleIds.slice(0, 4).map((roleId, index) => ({
    id: `local-discussion-${roleId}-${index}`,
    roleId,
    roleLabel: roleLabel(roleId),
    focus: index === 0 ? '需求理解与边界识别' : '协作推进建议',
    concern: index === 0 ? '需要确认业务目标、范围边界与验收标准。' : '需要明确职责分工与依赖。',
    proposal: index === 0 ? '先完成必答澄清，再进入执行。' : '按 SOP 分工并同步阶段结论。',
  })),
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
});

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
  const [issueAnswers, setIssueAnswers] = useState<Record<string, string>>({});
  const [conflictAcknowledged, setConflictAcknowledged] = useState(false);
  const [conflictResolution, setConflictResolution] = useState('');
  const [discussionAcknowledged, setDiscussionAcknowledged] = useState(false);
  const [analysisRecommendations, setAnalysisRecommendations] = useState<AgentRecommendation[]>([]);
  const [detectedDomains, setDetectedDomains] = useState<string[]>([]);
  const [clarification, setClarification] = useState<ClarificationAnswers>(INITIAL_CLARIFICATION);
  const [isParsing, setIsParsing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
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

  const resetState = () => {
    setIsImporting(false);
    setStep('input');
    setRawInput('');
    setIssueSourceType('text');
    setParsedProject(null);
    setIssuePreview(null);
    setIssueAnswers({});
    setConflictAcknowledged(false);
    setConflictResolution('');
    setDiscussionAcknowledged(false);
    setAnalysisRecommendations([]);
    setDetectedDomains([]);
    setClarification(INITIAL_CLARIFICATION);
    setIsParsing(false);
    setIsCreating(false);
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

      setIssuePreview(resolvedPreview);
      setIssueAnswers(applySuggestedAnswers(resolvedPreview.questions || [], resolvedPreview.suggestedAnswers || []));
      setConflictAcknowledged((resolvedPreview.conflicts || []).every((conflict) => conflict.severity !== 'critical'));
      setDiscussionAcknowledged((resolvedPreview.discussion || []).length === 0);
      setDetectedDomains(domains);
      setAnalysisRecommendations(recommendations);
      setClarification(INITIAL_CLARIFICATION);
      setParsedProject({
        name: parsedIntent.name || resolvedPreview.title || fallbackSuggestName(input) || '新项目',
        description: parsedIntent.description || resolvedPreview.summary || input,
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

    const clarificationBlock = formatClarificationBlock(clarification);
    const issueAnswersBlock = formatIssueAnswersBlock(issueAnswers);
    const optionalBlock = [
      clarification.deliveryDepth ? `交付深度: ${clarification.deliveryDepth}` : null,
      clarification.timeline ? `期望周期: ${clarification.timeline}` : null,
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
          `使命锚点: ${issuePreview.contextAlignment.missionAnchor}`,
          issuePreview.contextAlignment.matchedGoals.length > 0
            ? `对齐目标: ${issuePreview.contextAlignment.matchedGoals.join('；')}`
            : null,
          issuePreview.contextAlignment.matchedPrinciples.length > 0
            ? `对齐原则: ${issuePreview.contextAlignment.matchedPrinciples.join('；')}`
            : null,
        ]
          .filter(Boolean)
          .join('\n')
      : '';
    const blueprintBlock = issuePreview
      ? [
          `主题: ${issuePreview.designBlueprint.designTheme}`,
          `价值叙事: ${issuePreview.designBlueprint.valueNarrative}`,
          `目标用户: ${issuePreview.designBlueprint.targetUsers.join('、')}`,
          `核心场景: ${issuePreview.designBlueprint.coreScenarios.join('；')}`,
        ].join('\n')
      : '';
    const requirementContractBlock = issuePreview
      ? [
          `目标: ${issuePreview.requirementContract.objective}`,
          `In Scope: ${issuePreview.requirementContract.inScope.join('；')}`,
          `Out of Scope: ${issuePreview.requirementContract.outOfScope.join('；')}`,
          `验收: ${issuePreview.requirementContract.acceptanceCriteria.join('；')}`,
        ].join('\n')
      : '';
    const historyReferenceBlock = issuePreview && issuePreview.relatedHistory.length > 0
      ? issuePreview.relatedHistory
          .map((item) => `- ${item.title}（${item.validationStatus} / ${item.relevance}%）`)
          .join('\n')
      : '';
    const finalDescription = [
      parsedProject.description,
      '',
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
          `需求摘要: ${parsedProject.description}`,
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
                        <p className="text-[11px] text-slate-400 leading-relaxed">{issuePreview.summary}</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <p className="text-xs text-slate-400">需求细化草案（Agent 初步理解）</p>
                      <div className="p-3 rounded-xl bg-white/5 border border-border-subtle space-y-2">
                        <p className="text-xs text-slate-200">
                          <span className="text-slate-400">问题定义：</span>
                          {issuePreview.refinement.problemStatement}
                        </p>
                        <p className="text-xs text-slate-200">
                          <span className="text-slate-400">预期结果：</span>
                          {issuePreview.refinement.expectedOutcome}
                        </p>
                        <div className="text-xs">
                          <p className="text-slate-400">建议范围（In Scope）</p>
                          <ul className="mt-1 space-y-1">
                            {issuePreview.refinement.inScopeDraft.map((item) => (
                              <li key={item} className="text-slate-300">- {item}</li>
                            ))}
                          </ul>
                        </div>
                        <div className="text-xs">
                          <p className="text-slate-400">明确不做（Out of Scope）</p>
                          <ul className="mt-1 space-y-1">
                            {issuePreview.refinement.outOfScopeDraft.map((item) => (
                              <li key={item} className="text-slate-300">- {item}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <p className="text-xs text-slate-400">与产品说明文档的对齐结论</p>
                      <div className="p-3 rounded-xl bg-white/5 border border-border-subtle space-y-2">
                        <p className="text-xs text-slate-200">
                          <span className="text-slate-400">产品：</span>
                          {issuePreview.contextAlignment.productName}
                        </p>
                        <p className="text-xs text-slate-200">
                          <span className="text-slate-400">使命锚点：</span>
                          {issuePreview.contextAlignment.missionAnchor}
                        </p>
                        {issuePreview.contextAlignment.matchedGoals.length > 0 && (
                          <p className="text-xs text-slate-200">
                            <span className="text-slate-400">目标对齐：</span>
                            {issuePreview.contextAlignment.matchedGoals.join('；')}
                          </p>
                        )}
                        {issuePreview.contextAlignment.matchedPrinciples.length > 0 && (
                          <p className="text-xs text-slate-200">
                            <span className="text-slate-400">原则对齐：</span>
                            {issuePreview.contextAlignment.matchedPrinciples.join('；')}
                          </p>
                        )}
                        {issuePreview.contextAlignment.contextNotes.length > 0 && (
                          <div className="text-xs">
                            <p className="text-slate-400">上下文参考</p>
                            <ul className="mt-1 space-y-1">
                              {issuePreview.contextAlignment.contextNotes.map((note) => (
                                <li key={note} className="text-slate-300">- {note}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <p className="text-xs text-slate-400">产品设计草案（基于上下文自动完善）</p>
                      <div className="p-3 rounded-xl bg-white/5 border border-border-subtle space-y-2">
                        <p className="text-xs text-slate-200">
                          <span className="text-slate-400">设计主题：</span>
                          {issuePreview.designBlueprint.designTheme}
                        </p>
                        <p className="text-xs text-slate-200">
                          <span className="text-slate-400">价值叙事：</span>
                          {issuePreview.designBlueprint.valueNarrative}
                        </p>
                        <p className="text-xs text-slate-200">
                          <span className="text-slate-400">目标用户：</span>
                          {issuePreview.designBlueprint.targetUsers.join('、')}
                        </p>
                        <div className="text-xs">
                          <p className="text-slate-400">核心场景</p>
                          <ul className="mt-1 space-y-1">
                            {issuePreview.designBlueprint.coreScenarios.map((item) => (
                              <li key={item} className="text-slate-300">- {item}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>

                    {issuePreview.relatedHistory.length > 0 && (
                      <div className="space-y-3">
                        <p className="text-xs text-slate-400">历史相似需求（长期记忆复用）</p>
                        <div className="space-y-2">
                          {issuePreview.relatedHistory.map((item) => (
                            <div key={item.id} className="p-3 rounded-xl bg-white/5 border border-border-subtle space-y-1">
                              <p className="text-xs font-semibold text-white">{item.title}</p>
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
                        <p className="text-xs text-slate-200">
                          <span className="text-slate-400">目标：</span>
                          {issuePreview.requirementContract.objective}
                        </p>
                        <div className="text-xs">
                          <p className="text-slate-400">In Scope</p>
                          <ul className="mt-1 space-y-1">
                            {issuePreview.requirementContract.inScope.map((item) => (
                              <li key={item} className="text-slate-300">- {item}</li>
                            ))}
                          </ul>
                        </div>
                        <div className="text-xs">
                          <p className="text-slate-400">Out of Scope</p>
                          <ul className="mt-1 space-y-1">
                            {issuePreview.requirementContract.outOfScope.map((item) => (
                              <li key={item} className="text-slate-300">- {item}</li>
                            ))}
                          </ul>
                        </div>
                        <div className="text-xs">
                          <p className="text-slate-400">验收标准</p>
                          <ul className="mt-1 space-y-1">
                            {issuePreview.requirementContract.acceptanceCriteria.map((item) => (
                              <li key={item} className="text-slate-300">- {item}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>

                    {issuePreview.discussion.length > 0 && (
                      <div className="space-y-3">
                        <p className="text-xs text-slate-400">基于 Issue 的多角色讨论结论</p>
                        <div className="space-y-2">
                          {issuePreview.discussion.map((item) => (
                            <div key={item.id} className="p-3 rounded-xl bg-white/5 border border-border-subtle space-y-1">
                              <p className="text-xs font-semibold text-white">
                                {item.roleLabel} · {item.focus}
                              </p>
                              <p className="text-[11px] text-slate-400">关注点: {item.concern}</p>
                              <p className="text-[11px] text-slate-500">建议: {item.proposal}</p>
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
                        {(['1周内', '2周内', '1个月内', '排期待定'] as const).map((item) => (
                          <button
                            key={item}
                            onClick={() => setClarification((prev) => ({ ...prev, timeline: item }))}
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
                      rows={3}
                      value={parsedProject.description}
                      onChange={(event) =>
                        setParsedProject((prev) => (prev ? { ...prev, description: event.target.value } : prev))
                      }
                      className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
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
