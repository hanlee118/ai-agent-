import { ROLE_LABELS, type RoleType, type StageType } from "@occ/shared";
import type { IndustryTeamConfig } from "../routes/role-sets.js";
import type {
  IssueConflict,
  IssueQuestion,
  ProductContext,
  RequirementBackfillItem,
  RequirementContract
} from "./v1-method-store.js";

const ROLE_HINTS: Record<RoleType, RegExp[]> = {
  ROLE_ASSISTANT: [/助手|协调|助理|assistant/i],
  ROLE_PM: [/项目|排期|里程碑|pm|manager/i],
  ROLE_ANALYST: [/需求|业务|分析|用户|journey|meeting|analyst/i],
  ROLE_PRODUCT: [/产品|prd|体验|交互|流程|ui|ux|product/i],
  ROLE_DESIGN: [/视觉|品牌|页面|官网|landing|design|designer|ui|ux|动效|审美/i],
  ROLE_ARCH: [/架构|系统|服务|安全|性能|architecture|backend/i],
  ROLE_DEV: [/研发|开发|工程|代码|api|frontend|backend|dev/i],
  ROLE_QA: [/测试|验收|质量|回归|qa|bug/i],
  ROLE_HR: [/人力|招聘|组织|hr/i]
};

function normalizeText(input: string) {
  return input.trim().toLowerCase();
}

const INDUSTRY_LABELS: Record<string, string> = {
  saas: "SaaS 企业服务",
  ecommerce: "电商零售",
  fintech: "金融科技"
};

const INDUSTRY_KEYWORD_HINTS: Record<string, string[]> = {
  saas: ["saas", "企业服务", "企业软件", "crm", "erp", "b2b", "中后台", "中大型saas团队"],
  ecommerce: ["电商", "零售", "商品", "sku", "订单", "店铺", "选品", "跨境", "直播", "供应链", "客服", "ecommerce", "e-commerce", "retail"],
  fintech: ["金融", "支付", "风控", "合规", "授信", "交易", "反洗钱", "银行", "证券", "保险", "fintech"]
};

const CONTEXT_STOPWORDS = new Set([
  "用户",
  "需求",
  "系统",
  "项目",
  "平台",
  "团队",
  "功能",
  "流程",
  "场景",
  "产品",
  "业务",
  "实现",
  "支持",
  "优化"
]);

function includesAny(text: string, candidates: string[]) {
  return candidates.some((word) => text.includes(word.toLowerCase()));
}

function tokenize(text: string) {
  const normalized = text.toLowerCase();
  const latinTokens = normalized
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

  const hanGroups = Array.from(normalized.matchAll(/[\p{Script=Han}]{2,}/gu)).map((match) => match[0]);
  const hanBigrams: string[] = [];
  for (const group of hanGroups) {
    for (let i = 0; i < group.length - 1; i += 1) {
      hanBigrams.push(group.slice(i, i + 2));
    }
  }

  return Array.from(new Set([...latinTokens, ...hanBigrams]));
}

function detectIndustry(text: string) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return "";
  }

  const scores = Object.entries(INDUSTRY_KEYWORD_HINTS).map(([industryCode, keywords]) => ({
    industryCode,
    score: keywords.reduce((count, keyword) => (normalized.includes(keyword.toLowerCase()) ? count + 1 : count), 0)
  }));
  scores.sort((left, right) => right.score - left.score);
  if ((scores[0]?.score ?? 0) <= 0) {
    return "";
  }
  return scores[0].industryCode;
}

function hasContextTokenOverlap(rawInput: string, contextText: string) {
  const inputTokens = tokenize(rawInput).filter((token) => !CONTEXT_STOPWORDS.has(token));
  const contextTokens = new Set(tokenize(contextText).filter((token) => !CONTEXT_STOPWORDS.has(token)));
  return inputTokens.some((token) => contextTokens.has(token));
}

export interface RequirementRefinement {
  problemStatement: string;
  expectedOutcome: string;
  inScopeDraft: string[];
  outOfScopeDraft: string[];
  acceptanceDraft: string[];
}

export interface IssueDiscussionItem {
  id: string;
  roleId: RoleType;
  roleLabel: string;
  focus: string;
  concern: string;
  proposal: string;
}

export interface IssueExpectedArtifact {
  id: string;
  name: string;
  description: string;
  stageType: StageType;
  ownerRoleId: RoleType;
}

export interface IssueContextAlignment {
  productName: string;
  missionAnchor: string;
  matchedGoals: string[];
  matchedPrinciples: string[];
  contextNotes: string[];
}

export interface IssueDesignBlueprint {
  designTheme: string;
  valueNarrative: string;
  targetUsers: string[];
  coreScenarios: string[];
  proposedMilestones: string[];
}

export interface IssueSuggestedAnswer {
  questionId: string;
  answer: string;
  reason: string;
}

export interface IssueHistoryReference {
  id: string;
  issueId: string;
  projectId: string;
  title: string;
  status: "planned" | "in_progress" | "done";
  validationStatus: "pending" | "matched" | "mismatch";
  relevance: number;
  hint: string;
}

export function inferIssueTitle(rawInput: string) {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return "未命名需求";
  }

  const firstLine = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? trimmed;

  const firstSentence = firstLine
    .split(/[。！？.!?]/)
    .map((line) => line.trim())
    .find(Boolean) ?? firstLine;

  return firstSentence.length > 48 ? `${firstSentence.slice(0, 48)}...` : firstSentence;
}

function trimSentenceTail(input: string) {
  return String(input || "").trim().replace(/[。！？.!?；;，,]+$/g, "").trim();
}

function truncateText(input: string, limit: number) {
  const normalized = String(input || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit)}...`;
}

function extractCrossBorderPlatformLabels(text: string) {
  const normalized = normalizeText(text);
  const candidates: Array<{ label: string; pattern: RegExp }> = [
    { label: "TikTok", pattern: /tiktok|抖音国际|抖音海外/i },
    { label: "亚马逊", pattern: /amazon|亚马逊/i },
    { label: "Temu", pattern: /temu/i },
    { label: "Shopee", pattern: /shopee/i },
    { label: "Lazada", pattern: /lazada/i },
    { label: "eBay", pattern: /ebay/i },
    { label: "Shopify", pattern: /shopify/i }
  ];

  const labels = candidates
    .filter((item) => item.pattern.test(normalized))
    .map((item) => item.label);
  return Array.from(new Set(labels));
}

function inferTrafficTrigger(text: string) {
  const normalized = normalizeText(text);
  if (/(突然|短时|瞬时|大爆|暴涨|飙升|爆发)/i.test(normalized) && /(流量|热度|销量|排名|搜索)/i.test(normalized)) {
    return "当商品流量或热度短时爆增时";
  }
  if (/(流量|热度|销量|排名|搜索).*(增长|上升|上涨)/i.test(normalized)) {
    return "当商品流量或热度持续上涨时";
  }
  return "当商品指标异常上涨时";
}

function inferIssueMissionAnchor(rawInput: string) {
  const profile = detectScenarioProfile(rawInput);
  if (profile.isCrossBorderEcomSelection) {
    return "让跨境团队更快发现爆品、持续跟踪商品变化，并基于数据证据完成跟品决策。";
  }
  const headline = truncateText(trimSentenceTail(extractFirstSentence(rawInput)), 50);
  if (!headline) {
    return "让需求到研发闭环可追踪、可验收、可持续复用。";
  }
  return `围绕“${headline}”构建可追踪需求闭环，并确保交付可验收。`;
}

function buildFallbackAlignmentSuggestions(rawInput: string) {
  const profile = detectScenarioProfile(rawInput);
  const missionAnchor = inferIssueMissionAnchor(rawInput);

  if (profile.isCrossBorderEcomSelection) {
    return {
      goals: [
        "更早发现跨境平台中的爆量商品，并缩短跟品决策时间。",
        "用可追溯证据链完成候选商品排序，提升爆品判断命中率。",
        "持续跟踪已选商品变化，降低漏判与误判风险。"
      ],
      principles: [
        "证据优先，不只给结论，要给来源、增速与变化依据。",
        "人工可控，关键跟品决策默认保留人工确认。",
        "先打通最小闭环，再逐步扩展平台、类目与自动化能力。"
      ]
    };
  }

  return {
    goals: [
      `围绕“${missionAnchor}”提升核心业务响应速度与交付确定性。`,
      "减少需求到方案再到执行过程中的返工与信息损耗。"
    ],
    principles: [
      "目标清晰、范围收敛，先完成最小可交付闭环。",
      "结论可追溯、产出可验收，不依赖口头补充。",
      "优先保障主链路，再逐步扩展外围能力。"
    ]
  };
}

export function inferIssueSummary(rawInput: string) {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return "暂无描述";
  }

  const profile = detectScenarioProfile(rawInput);
  if (profile.isCrossBorderEcomSelection) {
    const platforms = extractCrossBorderPlatformLabels(rawInput);
    const platformText = platforms.length > 0 ? platforms.join("、") : "TikTok/亚马逊等跨境平台";
    const trigger = inferTrafficTrigger(rawInput);
    const summary = [
      "目标：搭建跨境电商爆品选品跟品机器人，自动识别潜力商品并给出优先级排序。",
      `触发：${trigger}（覆盖${platformText}）。`,
      "产出：返回商品链接、排名变化与监控告警，支持实时跟品决策。"
    ].join(" ");
    return truncateText(summary, 220);
  }

  const sentences = trimmed
    .split(/[。！？.!?\n]/)
    .map((item) => trimSentenceTail(item))
    .filter(Boolean);

  if (sentences.length >= 2) {
    const first = sentences[0];
    const second = sentences[1] && sentences[1] !== first ? sentences[1] : "";
    const combined = second
      ? `目标：${first}。补充：${second}。`
      : `目标：${first}。`;
    return truncateText(combined, 200);
  }

  const normalized = trimmed.replace(/\s+/g, " ");
  return truncateText(normalized, 180);
}

export function recommendRoles(rawInput: string, config: IndustryTeamConfig) {
  const text = normalizeText(rawInput);
  const candidates = config.roleSet.roleIds as RoleType[];

  const scored = candidates
    .map((roleId) => {
      const patterns = ROLE_HINTS[roleId] ?? [];
      let score = 0;
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          score += 2;
        }
      }
      if (roleId === config.assemblyRule.soulRoleId) {
        score += 3;
      }
      return { roleId, score };
    })
    .sort((a, b) => b.score - a.score);

  const selected = scored
    .filter((item) => item.score > 0)
    .slice(0, Math.max(config.assemblyRule.minRoles, 4))
    .map((item) => item.roleId);

  if (!selected.includes(config.assemblyRule.soulRoleId)) {
    selected.unshift(config.assemblyRule.soulRoleId as RoleType);
  }

  if (selected.length < config.assemblyRule.minRoles) {
    for (const roleId of candidates) {
      if (!selected.includes(roleId)) {
        selected.push(roleId);
      }
      if (selected.length >= config.assemblyRule.minRoles) {
        break;
      }
    }
  }

  // 需求设计团队基线：至少包含 PM + Product + Design，避免需求阶段跳过设计闸门。
  for (const baselineRole of ["ROLE_PM", "ROLE_PRODUCT", "ROLE_DESIGN"] as RoleType[]) {
    if (candidates.includes(baselineRole) && !selected.includes(baselineRole)) {
      selected.push(baselineRole);
    }
  }

  return selected.slice(0, config.assemblyRule.maxRoles ?? 8);
}

export function detectConflicts(
  rawInput: string,
  productContext: ProductContext,
  options?: { industryCode?: string }
): IssueConflict[] {
  const text = normalizeText(rawInput);
  const conflicts: IssueConflict[] = [];
  const profile = detectScenarioProfile(rawInput);
  const selectedIndustryCode = String(options?.industryCode ?? "").trim().toLowerCase();

  const unresolvedMismatches = (productContext.requirementHistory ?? [])
    .filter((item) => item.validationStatus === "mismatch")
    .slice(0, 3);
  if (unresolvedMismatches.length > 0) {
    conflicts.push({
      id: "unresolved-requirement-mismatch",
      severity: "critical",
      title: "产品设计AI提示：存在未解决的需求回填冲突",
      detail: `以下需求与实施结果不一致，需先处理: ${unresolvedMismatches.map((item) => item.title).join("、")}`,
      suggestion: "请先在产品说明文档中处理冲突需求，并给出解决说明后再继续创建新需求。"
    });
  }

  if (productContext.forbiddenKeywords.length > 0) {
    const hits = productContext.forbiddenKeywords.filter((keyword) => text.includes(keyword.toLowerCase()));
    if (hits.length > 0) {
      conflicts.push({
        id: "forbidden-keywords",
        severity: "critical",
        title: "触发产品禁用词约束",
        detail: `需求中命中禁用词: ${hits.join("、")}`,
        suggestion: "请修改需求描述，或在确认时说明为何需要特批。"
      });
    }
  }

  if (productContext.requiredKeywords.length > 0 && !includesAny(text, productContext.requiredKeywords)) {
    conflicts.push({
      id: "required-keywords-missing",
      severity: "warning",
      title: "缺少产品关键约束词",
      detail: `未检测到关键词: ${productContext.requiredKeywords.join("、")}`,
      suggestion: "建议在需求中补充与产品目标一致的关键表达。"
    });
  }

  const principleHits = productContext.principles.filter((principle) => {
    const keyword = principle.trim().toLowerCase();
    if (!keyword) {
      return false;
    }
    return text.includes(`不${keyword}`) || text.includes(`忽略${keyword}`) || text.includes(`跳过${keyword}`);
  });
  if (principleHits.length > 0) {
    conflicts.push({
      id: "principle-conflict",
      severity: "critical",
      title: "可能与产品原则冲突",
      detail: `检测到疑似违反原则的表达: ${principleHits.join("、")}`,
      suggestion: "建议重新确认该需求是否应纳入当前产品路线。"
    });
  }

  // 场景命中校验：电商行业默认要求命中跨境选品/跟品关键词，否则不允许通过确认。
  if (selectedIndustryCode === "ecommerce" && !profile.isCrossBorderEcomSelection) {
    conflicts.push({
      id: "crossborder-scene-not-hit",
      severity: "critical",
      title: "场景命中校验未通过",
      detail: "当前行业为电商零售，但需求未命中跨境选品/跟品关键词（如：跨境、选品、跟品、爆品、TikTok、亚马逊）。",
      suggestion: "请补充跨境业务场景与目标平台后重新分析，否则不可进入确认创建。"
    });
  }

  return conflicts;
}

export function buildClarificationQuestions(rawInput: string): IssueQuestion[] {
  const text = normalizeText(rawInput);
  const profile = detectScenarioProfile(rawInput);
  const hasTimelineHint = /(天|周|月|截止|排期|里程碑|deadline)/i.test(text);
  const hasAcceptanceHint = /(验收|指标|成功标准|kpi|sla|性能)/i.test(text);

  if (profile.isCrossBorderEcomSelection) {
    return [
      {
        id: "goal",
        question: "这次选品跟品机器人最核心的业务目标是什么？",
        required: true,
        placeholder: "例如：30 天内把潜力款命中率提升到 25%，并把选品周期缩短到 24 小时内。"
      },
      {
        id: "scope",
        question: "本次必须覆盖哪些平台/类目，以及明确不做哪些自动化动作？",
        required: true,
        placeholder: "例如：覆盖 TikTok 美妆 + 亚马逊家居；不做自动下单与自动投放。"
      },
      {
        id: "acceptance",
        question: "请给出可验证的验收口径（抓取频率、TopN 质量、告警时效）",
        required: true,
        placeholder: "例如：每 6 小时更新一次榜单；每日输出 Top20；关键指标变化 10 分钟内告警。"
      }
    ];
  }

  // V1 收敛：固定 3 个必答细化问题，避免流程发散。
  return [
    {
      id: "goal",
      question: "这次需求最核心的业务目标是什么？",
      required: true,
      placeholder: "例如：客服平均响应时长从 5 分钟降到 2 分钟。"
    },
    {
      id: "scope",
      question: "本次必须交付的范围与明确不做的范围分别是什么？",
      required: true,
      placeholder: "例如：做工单分配与优先级，不做客服排班系统。"
    },
    {
      id: "acceptance",
      question: hasAcceptanceHint
        ? "请明确本次需求最终验收口径（指标/样例）"
        : "请补充可验证的验收标准（至少 1 条）",
      required: true,
      placeholder: hasTimelineHint
        ? "例如：两周内上线 MVP，核心流程成功率 >= 95%。"
        : "例如：核心路径可演示，关键接口 P95 < 300ms。"
    }
  ];
}

function extractFirstSentence(rawInput: string) {
  return rawInput
    .split(/[。！？.!?\n]/)
    .map((line) => line.trim())
    .find(Boolean) ?? rawInput.trim();
}

type IssueScenarioProfile = {
  isCrossBorderEcomSelection: boolean;
  isMeetingLike: boolean;
  isCompetitorLike: boolean;
};

function detectScenarioProfile(rawInput: string): IssueScenarioProfile {
  const text = normalizeText(rawInput);
  const isCrossBorderEcomSelection = /(跨境|跨境电商|选品|跟品|爆品|tiktok|亚马逊|amazon|temu|ebay|shopify|榜单|热卖|爆单)/i.test(text);
  const isMeetingLike = /(会议|纪要|meeting)/i.test(text);
  const isCompetitorLike = /(竞品|对标|competitor)/i.test(text);
  return {
    isCrossBorderEcomSelection,
    isMeetingLike,
    isCompetitorLike
  };
}

export function buildRequirementRefinement(rawInput: string): RequirementRefinement {
  const summary = extractFirstSentence(rawInput);
  const profile = detectScenarioProfile(rawInput);

  if (profile.isCrossBorderEcomSelection) {
    return {
      problemStatement: "当前缺少一套可持续发现 TikTok/亚马逊/Temu 潜力爆品并自动跟踪变化的机制，导致选品滞后、上新命中率不稳定。",
      expectedOutcome: "交付可演示的跨境电商选品跟品机器人 MVP，支持爆品发现、评分排序、异常告警与人工确认闭环。",
      inScopeDraft: [
        "接入至少 2 个平台（如 TikTok + 亚马逊/Temu）的榜单或商品信号数据",
        "建立候选商品池与评分规则（热度、增速、竞争度、利润空间）",
        "实现跟品监控（价格/排名/销量趋势）并输出变化告警",
        "提供每日 Top N 候选清单与推荐理由（可追溯证据）",
        "提供人工确认/忽略机制，避免全自动误判直接执行"
      ],
      outOfScopeDraft: [
        "不包含自动下单、自动改价、自动投放广告等强执行动作",
        "不建设完整 BI 数据仓库与多组织权限体系",
        "不覆盖二期扩展（如供应链履约、客服自动化）"
      ],
      acceptanceDraft: [
        "每日可自动生成不少于 20 条候选商品清单并给出评分与证据来源",
        "支持对重点商品进行持续跟踪，关键指标变化可在约定时效内触发告警",
        "至少完成 2 条从“发现→评估→确认”的真实样例闭环",
        "输出可验收的交付物：选品策略说明、监控规则、Demo 演示与排期计划"
      ]
    };
  }

  const text = normalizeText(rawInput);

  const inScopeDraft = [
    "围绕需求核心场景交付可演示 MVP",
    "补齐执行所需最小数据流与权限路径"
  ];
  const outOfScopeDraft = [
    "不做与本次核心目标无关的系统重构",
    "不扩展到二期及以后需求"
  ];

  if (profile.isMeetingLike || /(会议|纪要|meeting)/i.test(text)) {
    inScopeDraft.unshift("将会议纪要中的关键决议转成可执行需求条目");
  }
  if (profile.isCompetitorLike || /(竞品|对标|competitor)/i.test(text)) {
    inScopeDraft.push("输出与竞品差异点对应的功能落地方案");
  }

  return {
    problemStatement: summary || "问题定义待确认",
    expectedOutcome: "形成可执行需求卡、明确团队分工并进入研发流程",
    inScopeDraft,
    outOfScopeDraft,
    acceptanceDraft: [
      "关键需求点被结构化确认",
      "设计阶段必须提交并通过设计审查卡",
      "团队已分配且含灵魂角色",
      "项目创建后可直接下发执行"
    ]
  };
}

function asUniqueRoleList(roleIds: RoleType[], soulRoleId: RoleType) {
  const ordered: RoleType[] = [];
  const push = (roleId: RoleType) => {
    if (!ordered.includes(roleId)) {
      ordered.push(roleId);
    }
  };

  push(soulRoleId);
  for (const roleId of roleIds) {
    push(roleId);
  }
  return ordered;
}

function firstSentence(rawInput: string) {
  return (
    rawInput
      .split(/[。！？.!?\n]/)
      .map((line) => line.trim())
      .find(Boolean) ?? rawInput.trim()
  );
}

type DiscussionSignals = {
  platformsText: string;
  trigger: string;
  needsMonitoring: boolean;
  needsRanking: boolean;
  needsLinkTracking: boolean;
  needsRealtime: boolean;
};

function inferDiscussionSignals(rawInput: string): DiscussionSignals {
  const normalized = normalizeText(rawInput);
  const platforms = extractCrossBorderPlatformLabels(rawInput);
  return {
    platformsText: platforms.length > 0 ? platforms.join("、") : "TikTok/亚马逊等跨境平台",
    trigger: inferTrafficTrigger(rawInput),
    needsMonitoring: /(监控|跟踪|追踪|watch|monitor)/i.test(normalized),
    needsRanking: /(排名|榜单|top|排行|排序)/i.test(normalized),
    needsLinkTracking: /(链接|link|跟品|同款|详情页)/i.test(normalized),
    needsRealtime: /(实时|分钟|秒|及时|告警|预警)/i.test(normalized)
  };
}

function buildCrossBorderDiscussion(
  roleId: RoleType,
  roleLabel: string,
  index: number,
  issue: string,
  signals: DiscussionSignals
): IssueDiscussionItem {
  const outputUnits = [
    signals.needsMonitoring ? "监控" : "",
    signals.needsRanking ? "排名" : "",
    signals.needsLinkTracking ? "跟品链接" : ""
  ].filter(Boolean);
  const outputText = outputUnits.length > 0 ? outputUnits.join(" + ") : "监控 + 排名 + 跟品链接";
  const realtimeExpectation = signals.needsRealtime ? "实时/准实时告警" : "周期性告警";
  const keyOpenQuestions = [
    "抓取频率",
    "TopN 阈值",
    "告警触发阈值",
    "人工确认规则"
  ].join("、");

  if (roleId === "ROLE_ANALYST") {
    return {
      id: `discussion-${roleId}-${index}`,
      roleId,
      roleLabel,
      focus: "需求理解与业务信号拆解",
      concern: `讨论识别到核心链路为“${signals.trigger} → ${outputText} → 决策跟进”，但${keyOpenQuestions}尚未明确。`,
      proposal: `结论：先围绕 ${signals.platformsText} 建立最小闭环；待确认：${keyOpenQuestions}。`
    };
  }

  if (roleId === "ROLE_PM") {
    return {
      id: `discussion-${roleId}-${index}`,
      roleId,
      roleLabel,
      focus: "里程碑与推进节奏",
      concern: `若首期同时扩展过多平台，交付会失去可控性，影响 ${realtimeExpectation} 达成。`,
      proposal: `结论：MVP 首期聚焦 ${signals.platformsText} 与核心 TopN；二期再扩平台与策略。`
    };
  }

  if (roleId === "ROLE_PRODUCT") {
    return {
      id: `discussion-${roleId}-${index}`,
      roleId,
      roleLabel,
      focus: "价值定义与决策口径",
      concern: `如果只给“热度”不附证据链，运营很难采信排名结果，导致“可用但不可决策”。`,
      proposal: `结论：每条候选需附来源、增速、竞争度与利润空间解释，并支持一键跳转商品链接。`
    };
  }

  if (roleId === "ROLE_DESIGN") {
    return {
      id: `discussion-${roleId}-${index}`,
      roleId,
      roleLabel,
      focus: "决策界面与信息可读性",
      concern: "若榜单、趋势、告警挤在一个视图里，会增加认知负担，降低跟品响应速度。",
      proposal: "结论：拆分“发现榜单 / 商品详情 / 告警流”三层视图，保证 30 秒内可完成一次跟品判断。"
    };
  }

  if (roleId === "ROLE_ARCH" || roleId === "ROLE_DEV") {
    return {
      id: `discussion-${roleId}-${index}`,
      roleId,
      roleLabel,
      focus: "数据链路与实现可行性",
      concern: `当前输入强调 ${realtimeExpectation}，需先确认数据来源稳定性、限频策略与异常重试机制。`,
      proposal: "结论：先实现可追溯采集与规则引擎，再接告警与链接跳转，避免先做前端展示后补数据。"
    };
  }

  if (roleId === "ROLE_QA") {
    return {
      id: `discussion-${roleId}-${index}`,
      roleId,
      roleLabel,
      focus: "验收标准与质量门禁",
      concern: "若缺少可量化标准，会出现“看起来有结果，但无法证明有效”的验收争议。",
      proposal: "结论：按“命中率、时效、可追溯性”三维验收，并要求至少 2 条真实样例闭环。"
    };
  }

  if (roleId === "ROLE_ASSISTANT") {
    return {
      id: `discussion-${roleId}-${index}`,
      roleId,
      roleLabel,
      focus: "协同编排与待办收敛",
      concern: `当前讨论已形成方向，但“${issue}”仍存在待确认项，直接执行会放大返工风险。`,
      proposal: "结论：先锁定澄清项，再按角色下发任务并持续同步阶段结论。"
    };
  }

  return {
    id: `discussion-${roleId}-${index}`,
    roleId,
    roleLabel,
    focus: "协同推进与风险控制",
    concern: `围绕“${issue}”已形成初步方向，但仍需明确上下游依赖与阶段切换条件。`,
    proposal: "结论：按 SOP 推进并在关键节点触发人工确认。"
  };
}

function buildGenericDiscussion(
  roleId: RoleType,
  roleLabel: string,
  index: number,
  issue: string
): IssueDiscussionItem {
  if (roleId === "ROLE_PM") {
    return {
      id: `discussion-${roleId}-${index}`,
      roleId,
      roleLabel,
      focus: "排期与依赖管理",
      concern: `“${issue}”当前仍缺关键参数，若直接排期会造成阶段反复与返工。`,
      proposal: "结论：先锁定必答澄清，再按里程碑拆分任务与负责人。"
    };
  }
  if (roleId === "ROLE_PRODUCT") {
    return {
      id: `discussion-${roleId}-${index}`,
      roleId,
      roleLabel,
      focus: "产品方案与价值定义",
      concern: `对“${issue}”的业务目标与用户价值仍需进一步量化，否则产出容易偏离。`,
      proposal: "结论：先锁定目标用户、核心场景与验收指标，再进入方案输出。"
    };
  }
  if (roleId === "ROLE_DEV" || roleId === "ROLE_ARCH") {
    return {
      id: `discussion-${roleId}-${index}`,
      roleId,
      roleLabel,
      focus: "实现路径与依赖评估",
      concern: `当前需求存在边界不清风险，直接开发会造成返工。`,
      proposal: "结论：先完成范围冻结与接口草案，再拆解研发任务。"
    };
  }
  if (roleId === "ROLE_QA") {
    return {
      id: `discussion-${roleId}-${index}`,
      roleId,
      roleLabel,
      focus: "验收一致性校验",
      concern: "验收标准未量化时，无法判断结果是否满足预期。",
      proposal: "结论：将验收条目写入任务卡，并与需求目标逐条对照。"
    };
  }
  return {
    id: `discussion-${roleId}-${index}`,
    roleId,
    roleLabel,
    focus: roleId === "ROLE_ANALYST" ? "需求理解与边界识别" : "协同推进与风险控制",
    concern: `需要确认“${issue}”的目标、范围边界和验收口径是否一致。`,
    proposal: "结论：先完成关键澄清，再进入方案与研发分工。"
  };
}

export function buildIssueDiscussion(
  rawInput: string,
  roleIds: RoleType[],
  soulRoleId: RoleType
): IssueDiscussionItem[] {
  const issue = firstSentence(rawInput) || "当前需求";
  const profile = detectScenarioProfile(rawInput);
  const signals = inferDiscussionSignals(rawInput);
  const focusedRoles = asUniqueRoleList(roleIds, soulRoleId)
    .filter((roleId) => ROLE_LABELS[roleId])
    .slice(0, 6);

  return focusedRoles.map((roleId, index) => {
    const label = ROLE_LABELS[roleId];
    return profile.isCrossBorderEcomSelection
      ? buildCrossBorderDiscussion(roleId, label, index, issue, signals)
      : buildGenericDiscussion(roleId, label, index, issue);
  });
}

export function buildExpectedArtifacts(): IssueExpectedArtifact[] {
  return [
    {
      id: "artifact-analysis-doc",
      name: "需求分析文档",
      description: "面向设计与研发的结构化需求、边界、约束、风险与验收标准。",
      stageType: "ANALYSIS",
      ownerRoleId: "ROLE_ANALYST"
    },
    {
      id: "artifact-schedule",
      name: "项目排期",
      description: "里程碑、负责人、依赖与风险缓冲的执行排期。",
      stageType: "ANALYSIS",
      ownerRoleId: "ROLE_PM"
    },
    {
      id: "artifact-design-review",
      name: "设计审查卡",
      description: "视觉方向、品牌语气、UX 原则、可访问性清单与审查结论。",
      stageType: "DESIGN",
      ownerRoleId: "ROLE_DESIGN"
    },
    {
      id: "artifact-visual-preview",
      name: "视觉定稿单页",
      description: "可供业务确认和研发实现的静态图或 HTML 单页设计预览。",
      stageType: "DESIGN",
      ownerRoleId: "ROLE_DESIGN"
    },
    {
      id: "artifact-tech-plan",
      name: "技术方案与选型",
      description: "研发实现前的系统边界、接口契约、数据链路与技术取舍。",
      stageType: "DEV",
      ownerRoleId: "ROLE_ARCH"
    },
    {
      id: "artifact-impl-result",
      name: "实现结果说明",
      description: "真实页面、接口、代码改动与验证证据说明。",
      stageType: "DEV",
      ownerRoleId: "ROLE_DEV"
    },
    {
      id: "artifact-runtime-delivery",
      name: "运行地址与部署说明",
      description: "运行入口、启动方式、环境变量与联调验证步骤。",
      stageType: "DEV",
      ownerRoleId: "ROLE_DEV"
    },
    {
      id: "artifact-test-report",
      name: "测试报告",
      description: "面向验收阶段的测试范围、结果、阻断项与回归结论。",
      stageType: "ACCEPT",
      ownerRoleId: "ROLE_QA"
    }
  ];
}

export function buildContextAlignment(
  rawInput: string,
  productContext: ProductContext,
  options?: { industryCode?: string }
): IssueContextAlignment {
  const normalized = normalizeText(rawInput);
  const profile = detectScenarioProfile(rawInput);
  const matchedGoals = (productContext.goals ?? [])
    .filter((goal) => {
      const key = goal.trim().toLowerCase();
      if (!key) {
        return false;
      }
      return normalized.includes(key) || key.split(/\s+/).some((part) => part.length > 1 && normalized.includes(part));
    })
    .slice(0, 3);

  const matchedPrinciples = (productContext.principles ?? [])
    .filter((principle) => {
      const key = principle.trim().toLowerCase();
      if (!key) {
        return false;
      }
      return normalized.includes(key) || key.split(/\s+/).some((part) => part.length > 1 && normalized.includes(part));
    })
    .slice(0, 3);
  const missingContextGoals = (productContext.goals ?? []).filter((item) => item.trim()).length === 0;
  const missingContextPrinciples = (productContext.principles ?? []).filter((item) => item.trim()).length === 0;
  const fallbackAlignment = buildFallbackAlignmentSuggestions(rawInput);
  const effectiveMatchedGoals = matchedGoals.length > 0 || !missingContextGoals
    ? matchedGoals
    : fallbackAlignment.goals;
  const effectiveMatchedPrinciples = matchedPrinciples.length > 0 || !missingContextPrinciples
    ? matchedPrinciples
    : fallbackAlignment.principles;

  const selectedIndustryCode = String(options?.industryCode ?? "").trim().toLowerCase();
  const inputIndustry = detectIndustry(rawInput) || detectIndustry(selectedIndustryCode);
  const contextIndustry = detectIndustry(
    [
      productContext.background,
      productContext.mission,
      ...(productContext.goals ?? []),
      ...(productContext.principles ?? [])
    ].join(" ")
  );
  const hasIndustryMismatch = Boolean(inputIndustry && contextIndustry && inputIndustry !== contextIndustry);
  const requiresCrossBorderScene = selectedIndustryCode === "ecommerce";
  const sceneHitPassed = !requiresCrossBorderScene || profile.isCrossBorderEcomSelection;
  const missionIndustry = detectIndustry(String(productContext.mission ?? ""));
  const missionRelevant = Boolean(
    String(productContext.mission ?? "").trim()
    && (
      hasContextTokenOverlap(rawInput, String(productContext.mission ?? ""))
      || (inputIndustry && missionIndustry && missionIndustry === inputIndustry)
    )
  );
  const shouldIncludeBackground = Boolean(
    productContext.background
    && !hasIndustryMismatch
    && (
      matchedGoals.length > 0
      || matchedPrinciples.length > 0
      || hasContextTokenOverlap(rawInput, productContext.background)
    )
  );
  const shouldPreferIssueMission = Boolean(
    !String(productContext.mission ?? "").trim()
    || hasIndustryMismatch
    || !sceneHitPassed
    || (profile.isCrossBorderEcomSelection && !missionRelevant)
    || (matchedGoals.length === 0 && matchedPrinciples.length === 0 && !missionRelevant)
  );

  const contextNotes = [
    shouldIncludeBackground ? `背景: ${productContext.background}` : "",
    productContext.constraints.length > 0 ? `约束: ${productContext.constraints.slice(0, 3).join("、")}` : ""
  ].filter(Boolean);
  if (hasIndustryMismatch) {
    const requestedLabel = INDUSTRY_LABELS[inputIndustry] ?? inputIndustry;
    const contextLabel = INDUSTRY_LABELS[contextIndustry] ?? contextIndustry;
    contextNotes.push(`检测到需求更偏向「${requestedLabel}」，当前产品说明文档背景更偏向「${contextLabel}」，建议先修正文档背景或确认本次跨行业策略。`);
  }
  if (shouldPreferIssueMission) {
    contextNotes.push("本次草案已优先按当前需求语义生成，未直接复用历史使命表述。");
  }
  if (missingContextGoals || missingContextPrinciples) {
    contextNotes.push("当前产品说明文档尚未维护完整目标/原则，已基于本次需求自动生成初始对齐建议。");
  }
  if (requiresCrossBorderScene) {
    contextNotes.push(
      sceneHitPassed
        ? "场景命中校验: 通过（已命中跨境选品/跟品关键词）。"
        : "场景命中校验: 未通过（缺少跨境选品/跟品关键词，当前需求不可直接通过）。"
    );
  }

  return {
    productName: productContext.productName || "未配置产品名称",
    missionAnchor: shouldPreferIssueMission
      ? inferIssueMissionAnchor(rawInput)
      : (productContext.mission || inferIssueMissionAnchor(rawInput)),
    matchedGoals: sceneHitPassed ? effectiveMatchedGoals : [],
    matchedPrinciples: sceneHitPassed ? effectiveMatchedPrinciples : [],
    contextNotes
  };
}

export function buildDesignBlueprint(input: {
  rawInput: string;
  refinement: RequirementRefinement;
  alignment: IssueContextAlignment;
}): IssueDesignBlueprint {
  const normalized = normalizeText(input.rawInput);
  const profile = detectScenarioProfile(input.rawInput);
  if (profile.isCrossBorderEcomSelection) {
    const platforms = extractCrossBorderPlatformLabels(input.rawInput);
    const platformText = platforms.length > 0 ? platforms.join("、") : "TikTok、亚马逊等跨境平台";
    return {
      designTheme: `跨境爆品选品与跟品机器人（${platformText}）`,
      valueNarrative: `围绕“${input.alignment.missionAnchor}”构建爆品发现 → 评分排序 → 跟品监控闭环，帮助团队更快决策并降低错判成本。`,
      targetUsers: [
        "跨境选品运营",
        "商品分析/数据运营",
        "品类负责人"
      ],
      coreScenarios: [
        `多平台信号采集与爆发检测（${platformText}）`,
        "候选商品评分排行与证据链展示",
        "实时跟品监控（价格/排名/销量）与告警推送",
        "一键查看商品链接并进入人工确认决策"
      ],
      proposedMilestones: [
        "定义数据源与爆发判定规则（流量、增速、竞争度）",
        "完成候选池、评分模型与 TopN 排行机制",
        "上线跟品监控与告警链路，打通商品跳转链接",
        "完成真实样例复盘并固化策略模板"
      ]
    };
  }

  const targetUsers: string[] = [];
  if (/(客户|client|用户|user)/i.test(normalized)) {
    targetUsers.push("客户/终端用户");
  }
  if (/(运营|ops|运营团队|support)/i.test(normalized)) {
    targetUsers.push("运营/支持团队");
  }
  if (/(研发|开发|engineer|dev)/i.test(normalized)) {
    targetUsers.push("研发团队");
  }
  if (targetUsers.length === 0) {
    targetUsers.push("核心业务使用者");
  }

  const designTheme = input.refinement.problemStatement || inferIssueTitle(input.rawInput);
  const valueNarrative = input.alignment.missionAnchor
    ? `围绕“${input.alignment.missionAnchor}”落地本次需求，确保与产品长期方向一致。`
    : "围绕产品长期目标落地本次需求，确保产出可验证、可执行。";

  return {
    designTheme,
    valueNarrative,
    targetUsers: Array.from(new Set(targetUsers)).slice(0, 3),
    coreScenarios: input.refinement.inScopeDraft.slice(0, 3),
    proposedMilestones: [
      "需求澄清与边界确认",
      "方案设计与研发输入确认",
      "研发实现与运行验证",
      "验收回填与产品说明文档更新"
    ]
  };
}

export function buildSuggestedAnswers(input: {
  rawInput: string;
  questions: IssueQuestion[];
  refinement: RequirementRefinement;
  alignment: IssueContextAlignment;
  industryCode?: string;
  discussion?: IssueDiscussionItem[];
}): IssueSuggestedAnswer[] {
  const profile = detectScenarioProfile(input.rawInput);
  const platforms = extractCrossBorderPlatformLabels(input.rawInput);
  const platformText = platforms.length > 0 ? platforms.join("、") : "TikTok/亚马逊等平台";

  if (profile.isCrossBorderEcomSelection) {
    const byId: Record<string, IssueSuggestedAnswer> = {
      goal: {
        questionId: "goal",
        answer: "在保证人工可控的前提下，提升爆品发现命中率与跟品效率，缩短从发现到决策的响应时间。",
        reason: "根据跨境选品场景目标（速度+准确率+可追溯）自动提炼。"
      },
      scope: {
        questionId: "scope",
        answer: `必须交付：覆盖${platformText}的信号监控、TopN 排名、商品链接追踪与告警；不做：自动下单、自动改价、自动投放。`,
        reason: "根据风险可控原则与MVP收敛策略生成。"
      },
      acceptance: {
        questionId: "acceptance",
        answer: "验收标准：每日稳定输出候选商品清单并附证据链；关键指标异常可在约定时效内告警；至少完成2条真实样例闭环复盘。",
        reason: "根据可验证交付标准自动生成。"
      }
    };

    return input.questions
      .filter((question) => Boolean(byId[question.id]))
      .map((question) => byId[question.id]);
  }

  const normalizeIndustryCode = (value: string) => String(value ?? "").trim().toLowerCase();
  const resolvedIndustry = normalizeIndustryCode(input.industryCode || detectIndustry(input.rawInput));
  const missionAnchor = String(input.alignment.missionAnchor ?? "").trim();
  const conciseMissionAnchor = missionAnchor.length > 36 ? "" : missionAnchor;
  const discussionHints = (input.discussion ?? [])
    .slice(0, 2)
    .map((item) => `${item.roleLabel}:${item.proposal.replace(/^结论[:：]\s*/i, "")}`)
    .join("；");

  const industryDrafts: Record<string, { goal: string; scope: string; acceptance: string }> = {
    ecommerce: {
      goal: "围绕商品增长机会识别与转化效率，提升业务响应速度与选品决策质量。",
      scope: "必须交付：核心业务链路的数据采集、候选评估与执行闭环；不做：与当前增长目标无关的外围系统扩展。",
      acceptance: "验收标准：核心指标可量化（时效、命中率、转化贡献）；关键流程可演示并可追溯。"
    },
    fintech: {
      goal: "在保障合规与风险可控前提下，提升业务处理效率与决策准确性。",
      scope: "必须交付：核心业务流程、风险控制点与审计追踪；不做：未经审批的高风险自动化动作。",
      acceptance: "验收标准：满足合规检查与审计追踪要求，关键风险场景有可验证测试结果。"
    },
    saas: {
      goal: "提升需求落地效率与用户价值交付速度，减少跨角色协作返工。",
      scope: "必须交付：面向核心用户场景的可执行闭环；不做：超出当前版本目标的横向能力扩张。",
      acceptance: "验收标准：核心流程可演示、关键指标可验证、交付物可复用并可持续迭代。"
    }
  };
  const industryDraft = industryDrafts[resolvedIndustry];

  const goalSuggestion =
    industryDraft?.goal
      ? `${industryDraft.goal}${conciseMissionAnchor ? ` 并保持与“${conciseMissionAnchor}”一致。` : " 并保持与产品使命一致。"}`
      : input.alignment.matchedGoals[0]
      ? `围绕“${input.alignment.matchedGoals[0]}”提升核心业务指标，并保持与产品使命一致。`
      : "明确核心业务目标并确保与产品使命、阶段目标保持一致。";
  const scopeSuggestion = industryDraft?.scope
    ? `${industryDraft.scope} 建议优先：${input.refinement.inScopeDraft.slice(0, 2).join("；")}。`
    : `必须交付：${input.refinement.inScopeDraft.slice(0, 2).join("；")}。不做：${input.refinement.outOfScopeDraft.slice(0, 2).join("；")}。`;
  const acceptanceSuggestion = industryDraft?.acceptance
    ? `${industryDraft.acceptance} 建议补充：${input.refinement.acceptanceDraft.slice(0, 2).join("；")}。`
    : `验收标准：${input.refinement.acceptanceDraft.join("；")}；并完成需求分析、项目排期、设计审查、研发实现说明、运行说明与测试报告。`;

  const byId: Record<string, IssueSuggestedAnswer> = {
    goal: {
      questionId: "goal",
      answer: goalSuggestion,
      reason: discussionHints
        ? `结合多角色讨论共识生成（${discussionHints}）。`
        : "根据行业习惯与产品目标自动生成的建议口径。"
    },
    scope: {
      questionId: "scope",
      answer: scopeSuggestion,
      reason: "根据行业默认边界与需求细化草案自动提炼。"
    },
    acceptance: {
      questionId: "acceptance",
      answer: acceptanceSuggestion,
      reason: "根据行业验收口径与标准交付物自动生成。"
    }
  };

  return input.questions
    .filter((question) => Boolean(byId[question.id]))
    .map((question) => byId[question.id]);
}

export function buildRequirementContract(input: {
  suggestedAnswers: IssueSuggestedAnswer[];
  refinement: RequirementRefinement;
  designBlueprint: IssueDesignBlueprint;
  expectedArtifacts: IssueExpectedArtifact[];
}): RequirementContract {
  const answerById = new Map(input.suggestedAnswers.map((item) => [item.questionId, item.answer]));
  const objective = answerById.get("goal") || input.refinement.expectedOutcome;
  const scopeAnswer = answerById.get("scope") || "";
  const acceptanceAnswer = answerById.get("acceptance") || "";
  const splitByPunctuation = (value: string) =>
    value
      .split(/[；;。,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  const scopeMatch = scopeAnswer.match(/^(?:必须交付[:：])?\s*(.*?)(?:[；;。]?\s*不做[:：]\s*(.*))?$/);
  const inScopeFromAnswer = scopeMatch?.[1] ? splitByPunctuation(scopeMatch[1]) : (scopeAnswer ? splitByPunctuation(scopeAnswer) : []);
  const outScopeFromAnswer = scopeMatch?.[2] ? splitByPunctuation(scopeMatch[2]) : [];
  const inScope = [...inScopeFromAnswer, ...input.refinement.inScopeDraft];
  const outOfScope = [...outScopeFromAnswer, ...input.refinement.outOfScopeDraft];
  const cleanedAcceptance = acceptanceAnswer.replace(/^验收标准[:：]\s*/i, "");
  const acceptanceCriteria = acceptanceAnswer
    ? [...splitByPunctuation(cleanedAcceptance), ...input.refinement.acceptanceDraft]
    : input.refinement.acceptanceDraft;

  return {
    objective,
    inScope: Array.from(new Set(inScope)).slice(0, 5),
    outOfScope: Array.from(new Set(outOfScope)).slice(0, 5),
    acceptanceCriteria: Array.from(new Set(acceptanceCriteria)).slice(0, 5),
    artifacts: input.expectedArtifacts.map((artifact) => artifact.name),
    designTheme: input.designBlueprint.designTheme,
    valueNarrative: input.designBlueprint.valueNarrative
  };
}

export function buildRelatedHistory(rawInput: string, history: RequirementBackfillItem[]): IssueHistoryReference[] {
  const tokens = tokenize(rawInput);
  if (tokens.length === 0 || history.length === 0) {
    return [];
  }

  return history
    .map((item) => {
      const base = `${item.title} ${item.refinedRequirement}`.toLowerCase();
      let hit = 0;
      for (const token of tokens) {
        if (base.includes(token)) {
          hit += 1;
        }
      }
      const relevance = Math.round((hit / tokens.length) * 100);
      const hint =
        item.validationStatus === "matched"
          ? "可复用历史方案"
          : item.validationStatus === "mismatch"
            ? "历史存在偏差，需谨慎复用"
            : "可参考执行中的经验";

      return {
        id: item.id,
        issueId: item.issueId,
        projectId: item.projectId,
        title: item.title,
        status: item.status,
        validationStatus: item.validationStatus,
        relevance,
        hint
      } as IssueHistoryReference;
    })
    .filter((item) => item.relevance > 0)
    .sort((left, right) => right.relevance - left.relevance)
    .slice(0, 5);
}
