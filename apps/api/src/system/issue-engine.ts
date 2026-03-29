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

export function inferIssueSummary(rawInput: string) {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return "暂无描述";
  }

  const normalized = trimmed.replace(/\s+/g, " ");
  if (normalized.length <= 180) {
    return normalized;
  }
  return `${normalized.slice(0, 180)}...`;
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

export function detectConflicts(rawInput: string, productContext: ProductContext): IssueConflict[] {
  const text = normalizeText(rawInput);
  const conflicts: IssueConflict[] = [];

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

  return conflicts;
}

export function buildClarificationQuestions(rawInput: string): IssueQuestion[] {
  const text = normalizeText(rawInput);
  const hasTimelineHint = /(天|周|月|截止|排期|里程碑|deadline)/i.test(text);
  const hasAcceptanceHint = /(验收|指标|成功标准|kpi|sla|性能)/i.test(text);

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

export function buildRequirementRefinement(rawInput: string): RequirementRefinement {
  const summary = extractFirstSentence(rawInput);
  const text = normalizeText(rawInput);

  const inScopeDraft = [
    "围绕需求核心场景交付可演示 MVP",
    "补齐执行所需最小数据流与权限路径"
  ];
  const outOfScopeDraft = [
    "不做与本次核心目标无关的系统重构",
    "不扩展到二期及以后需求"
  ];

  if (/(会议|纪要|meeting)/i.test(text)) {
    inScopeDraft.unshift("将会议纪要中的关键决议转成可执行需求条目");
  }
  if (/(竞品|对标|competitor)/i.test(text)) {
    inScopeDraft.push("输出与竞品差异点对应的功能落地方案");
  }

  return {
    problemStatement: summary || "待补充问题定义",
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

export function buildIssueDiscussion(
  rawInput: string,
  roleIds: RoleType[],
  soulRoleId: RoleType
): IssueDiscussionItem[] {
  const issue = firstSentence(rawInput) || "当前需求";
  const focusedRoles = asUniqueRoleList(roleIds, soulRoleId)
    .filter((roleId) => ROLE_LABELS[roleId])
    .slice(0, 5);

  return focusedRoles.map((roleId, index) => {
    if (roleId === soulRoleId) {
      return {
        id: `discussion-${roleId}-${index}`,
        roleId,
        roleLabel: ROLE_LABELS[roleId],
        focus: "需求理解与边界识别",
        concern: `需要确认 "${issue}" 的目标、范围边界和验收口径是否一致。`,
        proposal: "先完成 3 个必答澄清，再进入方案与研发分工。"
      };
    }

    if (roleId === "ROLE_PRODUCT") {
      return {
        id: `discussion-${roleId}-${index}`,
        roleId,
        roleLabel: ROLE_LABELS[roleId],
        focus: "产品方案与对外沟通产出",
        concern: "若缺少业务目标与受众信息，PPT/Word 方案容易偏离预期。",
        proposal: "在确认卡锁定目标后，输出客户汇报版方案与产品说明。"
      };
    }

    if (roleId === "ROLE_DESIGN") {
      return {
        id: `discussion-${roleId}-${index}`,
        roleId,
        roleLabel: ROLE_LABELS[roleId],
        focus: "视觉系统与交互审查",
        concern: "若缺失视觉方向、品牌语气与可访问性清单，交付会退化成模板化页面。",
        proposal: "在进入开发前完成设计审查卡，固化视觉规范、组件清单与无障碍要求。"
      };
    }

    if (roleId === "ROLE_DEV" || roleId === "ROLE_ARCH") {
      return {
        id: `discussion-${roleId}-${index}`,
        roleId,
        roleLabel: ROLE_LABELS[roleId],
        focus: "研发可执行性与原型实现",
        concern: "若依赖与接口边界不清晰，Demo 原型与排期会失真。",
        proposal: "按确认范围拆解任务，优先完成可演示闭环。"
      };
    }

    if (roleId === "ROLE_QA") {
      return {
        id: `discussion-${roleId}-${index}`,
        roleId,
        roleLabel: ROLE_LABELS[roleId],
        focus: "验收与一致性校验",
        concern: "没有可验证标准时，无法判断结果是否符合需求目标。",
        proposal: "将验收标准写入任务卡，并在回填前做一致性校验。"
      };
    }

    return {
      id: `discussion-${roleId}-${index}`,
      roleId,
      roleLabel: ROLE_LABELS[roleId],
      focus: "协同推进与风险控制",
      concern: "需要明确上下游依赖和阶段切换条件。",
      proposal: "按 SOP 推进并在关键节点触发人工确认。"
    };
  });
}

export function buildExpectedArtifacts(): IssueExpectedArtifact[] {
  return [
    {
      id: "artifact-ppt",
      name: "客户汇报方案（PPT）",
      description: "面向客户的价值说明、范围边界、阶段成果与下一步计划。",
      stageType: "DESIGN",
      ownerRoleId: "ROLE_PRODUCT"
    },
    {
      id: "artifact-word",
      name: "实施方案（Word）",
      description: "结构化需求、约束、验收标准、风险与执行策略。",
      stageType: "DESIGN",
      ownerRoleId: "ROLE_PRODUCT"
    },
    {
      id: "artifact-design-review",
      name: "设计审查卡",
      description: "视觉方向、品牌语气、UX 原则、可访问性清单与审查结论。",
      stageType: "DESIGN",
      ownerRoleId: "ROLE_DESIGN"
    },
    {
      id: "artifact-demo",
      name: "Demo 原型",
      description: "覆盖核心用户路径的可演示原型或可运行最小实现。",
      stageType: "DEV",
      ownerRoleId: "ROLE_DEV"
    },
    {
      id: "artifact-schedule",
      name: "项目排期",
      description: "里程碑、负责人、依赖与风险缓冲的执行排期。",
      stageType: "ANALYSIS",
      ownerRoleId: "ROLE_PM"
    }
  ];
}

export function buildContextAlignment(rawInput: string, productContext: ProductContext): IssueContextAlignment {
  const normalized = normalizeText(rawInput);
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

  const contextNotes = [
    productContext.background ? `背景: ${productContext.background}` : "",
    productContext.mission ? `使命: ${productContext.mission}` : "",
    productContext.constraints.length > 0 ? `约束: ${productContext.constraints.slice(0, 3).join("、")}` : ""
  ].filter(Boolean);

  return {
    productName: productContext.productName || "未配置产品名称",
    missionAnchor: productContext.mission || "请先完善产品使命，以便自动对齐设计策略。",
    matchedGoals: matchedGoals.length > 0 ? matchedGoals : (productContext.goals ?? []).slice(0, 2),
    matchedPrinciples: matchedPrinciples.length > 0 ? matchedPrinciples : (productContext.principles ?? []).slice(0, 2),
    contextNotes
  };
}

export function buildDesignBlueprint(input: {
  rawInput: string;
  refinement: RequirementRefinement;
  alignment: IssueContextAlignment;
}): IssueDesignBlueprint {
  const normalized = normalizeText(input.rawInput);
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
      "方案设计与对外汇报材料输出",
      "研发实现与 Demo 原型交付",
      "验收回填与产品说明文档更新"
    ]
  };
}

export function buildSuggestedAnswers(input: {
  rawInput: string;
  questions: IssueQuestion[];
  refinement: RequirementRefinement;
  alignment: IssueContextAlignment;
}): IssueSuggestedAnswer[] {
  const goalSuggestion =
    input.alignment.matchedGoals[0]
      ? `围绕“${input.alignment.matchedGoals[0]}”提升核心业务指标，并保持与产品使命一致。`
      : "明确核心业务目标并确保与产品使命、阶段目标保持一致。";
  const scopeSuggestion = `必须交付：${input.refinement.inScopeDraft.slice(0, 2).join("；")}。不做：${input.refinement.outOfScopeDraft.slice(0, 2).join("；")}。`;
  const acceptanceSuggestion = `验收标准：${input.refinement.acceptanceDraft.join("；")}；并完成客户汇报方案、实施方案、Demo 与排期。`;

  const byId: Record<string, IssueSuggestedAnswer> = {
    goal: {
      questionId: "goal",
      answer: goalSuggestion,
      reason: "根据产品目标/使命自动生成的建议口径。"
    },
    scope: {
      questionId: "scope",
      answer: scopeSuggestion,
      reason: "根据需求细化草案自动提炼的范围边界。"
    },
    acceptance: {
      questionId: "acceptance",
      answer: acceptanceSuggestion,
      reason: "根据标准交付物与验收口径自动生成。"
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
