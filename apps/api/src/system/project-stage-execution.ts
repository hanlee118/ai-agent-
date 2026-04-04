import {
  ROLE_LABELS,
  STAGE_LABELS,
  type ParsedIntent,
  type RoleType,
  type StageType
} from "@occ/shared";

export type ProjectStageExecutionMode = "direct_model" | "terminal_agent";
export type TerminalSkillEvidenceField =
  | "skillsUsed"
  | "reasoningBasis"
  | "artifactsProduced"
  | "verification";
export type TerminalCollaborationField =
  | "factsConfirmed"
  | "assumptions"
  | "decisions"
  | "handoff"
  | "openQuestions";

export type TerminalSkillEvidence = {
  skillsUsed: string[];
  reasoningBasis: string;
  artifactsProduced: string;
  verification: string;
};

export type TerminalCollaborationEvidence = {
  factsConfirmed: string;
  assumptions: string;
  decisions: string;
  handoff: string;
  openQuestions: string;
};

export type TerminalSkillEvidenceValidation = {
  ok: boolean;
  missingSkills: string[];
  missingFields: TerminalSkillEvidenceField[];
  hasEvidenceSection: boolean;
  parsedEvidence: TerminalSkillEvidence | null;
};

export type TerminalCollaborationValidation = {
  ok: boolean;
  missingFields: TerminalCollaborationField[];
  hasSection: boolean;
  parsedEvidence: TerminalCollaborationEvidence | null;
};

export type ProjectStageExecutionStrategy = {
  mode: ProjectStageExecutionMode;
  reason: string;
  openClawAgentId?: string;
  preferredModels: string[];
  allowDirectModelFallback: boolean;
  requiredSkills: string[];
  skillProtocol: string[];
  collaborationProtocol: string[];
  requiredCollaborationFields: TerminalCollaborationField[];
  memoryEnabled: boolean;
  memoryPolicy: "current_project_or_high_relevance_only";
  executionMode: "confirm_first" | "autonomous";
  requireConfirmation: boolean;
};

const STAGE_COMPANION_ROLE_MAP: Partial<Record<StageType, RoleType[]>> = {
  ANALYSIS: ["ROLE_PRODUCT"],
  DESIGN: ["ROLE_PRODUCT"],
  DEV: ["ROLE_ARCH"]
};

const STAGE_REAL_MODEL_GATE_ROLE_MAP: Partial<Record<StageType, RoleType[]>> = {
  ANALYSIS: ["ROLE_ANALYST", "ROLE_PRODUCT"],
  DESIGN: ["ROLE_PRODUCT", "ROLE_DESIGN"],
  DEV: ["ROLE_ARCH", "ROLE_DEV"],
  ACCEPT: ["ROLE_QA"]
};

const ROLE_OPENCLAW_AGENT_MAP: Partial<Record<RoleType, string>> = {
  ROLE_PM: "project_manager",
  ROLE_ANALYST: "requirements_analyst",
  ROLE_PRODUCT: "product_director",
  ROLE_DESIGN: "jeremy",
  ROLE_ARCH: "rd_director",
  ROLE_DEV: "rd_manager",
  ROLE_QA: "qa_engineer",
  ROLE_HR: "hr_director"
};

const TERMINAL_EVIDENCE_FIELDS: TerminalSkillEvidenceField[] = [
  "skillsUsed",
  "reasoningBasis",
  "artifactsProduced",
  "verification"
];
const TERMINAL_COLLABORATION_FIELDS: TerminalCollaborationField[] = [
  "factsConfirmed",
  "assumptions",
  "decisions",
  "handoff",
  "openQuestions"
];

const TERMINAL_STAGE_ROLE_SET = new Set<string>([
  "INIT:ROLE_PM",
  "ANALYSIS:ROLE_ANALYST",
  "ANALYSIS:ROLE_PRODUCT",
  "DESIGN:ROLE_PRODUCT",
  "DESIGN:ROLE_DESIGN",
  "DEV:ROLE_ARCH",
  "DEV:ROLE_DEV"
]);

const STAGE_MODEL_PREFERENCES: Record<StageType, string[]> = {
  INIT: [
    "openai/gpt-5.4",
    "anthropic/claude-sonnet-4-20250514",
    "openai/gpt-5.3-codex"
  ],
  ANALYSIS: [
    "openai/gpt-5.4",
    "openai/gpt-5.3-codex",
    "anthropic/claude-sonnet-4-20250514",
    "kimi-k2.5"
  ],
  DESIGN: [
    "anthropic/claude-opus-4-20250514",
    "anthropic/claude-sonnet-4-20250514",
    "openai/gpt-5.4",
    "openai/gpt-5.3-codex"
  ],
  DEV: [
    "openai/gpt-5.4",
    "openai/gpt-5.3-codex",
    "anthropic/claude-sonnet-4-20250514",
    "qwen3-coder-plus"
  ],
  ACCEPT: [
    "openai/gpt-5.4",
    "anthropic/claude-sonnet-4-20250514",
    "openai/gpt-5.3-codex"
  ]
};

const ROLE_MODEL_OVERRIDES: Partial<Record<RoleType, string[]>> = {
  ROLE_ANALYST: [
    "openai/gpt-5.4",
    "openai/gpt-5.3-codex",
    "anthropic/claude-sonnet-4-20250514"
  ],
  ROLE_PRODUCT: [
    "openai/gpt-5.4",
    "openai/gpt-5.3-codex",
    "anthropic/claude-sonnet-4-20250514"
  ],
  ROLE_DESIGN: [
    "anthropic/claude-opus-4-20250514",
    "anthropic/claude-sonnet-4-20250514",
    "openai/gpt-5.4"
  ],
  ROLE_ARCH: [
    "openai/gpt-5.4",
    "openai/gpt-5.3-codex",
    "anthropic/claude-sonnet-4-20250514"
  ],
  ROLE_DEV: [
    "openai/gpt-5.4",
    "openai/gpt-5.3-codex",
    "anthropic/claude-sonnet-4-20250514"
  ]
};

function dedupe(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of values) {
    const normalized = String(item ?? "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function truncate(input: string, maxLength: number) {
  const normalized = String(input ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function sanitizeTerminalSegment(input: string, maxLength: number) {
  const normalized = truncate(input, maxLength)
    .replace(/[;\n\r]/g, "；")
    .replace(/[&|]/g, "、")
    .replace(/[$`]/g, "")
    .replace(/[<>]/g, "");
  return normalized.trim();
}

export function getPreferredStageModels(stageType: StageType, role: RoleType) {
  return dedupe([
    ...(ROLE_MODEL_OVERRIDES[role] ?? []),
    ...(STAGE_MODEL_PREFERENCES[stageType] ?? [])
  ]);
}

export function getStageCompanionRoles(stageType: StageType, primaryRole: RoleType) {
  return (STAGE_COMPANION_ROLE_MAP[stageType] ?? []).filter((role) => role !== primaryRole);
}

export function getStageRealModelGateRoles(stageType: StageType) {
  return [...(STAGE_REAL_MODEL_GATE_ROLE_MAP[stageType] ?? [])];
}

function getStageRequiredSkills(stageType: StageType, role: RoleType) {
  if (stageType === "DESIGN" || role === "ROLE_DESIGN") {
    return ["design-to-code", "frontend-design", "frontend-design-pro"];
  }

  if (stageType === "DEV" || role === "ROLE_ARCH" || role === "ROLE_DEV") {
    return ["coding-agent"];
  }

  return [] as string[];
}

function getStageSkillProtocol(stageType: StageType, role: RoleType) {
  if (stageType === "ANALYSIS" || role === "ROLE_ANALYST" || role === "ROLE_PRODUCT") {
    return [
      "先基于当前项目做需求澄清、边界判断与价值取舍，再输出阶段结论",
      "必须显式区分已确认事实、推断假设与待确认项，避免把幻觉写成既定需求",
      "输出末尾必须追加结构化证据区块，说明判断依据、产出物与校验结论"
    ];
  }

  if (stageType === "DESIGN" || role === "ROLE_DESIGN") {
    return [
      "先读取全部 requiredSkills，再开始设计分析与输出",
      "先用技能完成风格探索、结构拆解与可落地界面方案，再产出最终结论",
      "如果任一 requiredSkills 缺失，必须显式报告缺失项，不允许退化为普通模型模板直答"
    ];
  }

  if (stageType === "DEV" || role === "ROLE_ARCH" || role === "ROLE_DEV") {
    return [
      "先读取全部 requiredSkills，再开始研发分析与实现",
      "必须通过终端工具链完成代码修改、验证与回归检查，再输出结论",
      "如果 requiredSkills 或终端工具不可用，必须显式报告阻塞，不允许直接给出未经验证的实现答案"
    ];
  }

  return [] as string[];
}

function getStageCollaborationProtocol(stageType: StageType, role: RoleType) {
  if (stageType === "INIT" || role === "ROLE_PM") {
    return [
      "先沉淀项目目标、边界、参与角色与阶段推进规则，再把 kickoff 结论交给分析角色",
      "必须明确哪些输入已确认、哪些仍是假设，不能把含糊描述直接写成正式项目章程",
      "handoff 必须写清分析阶段的关键问题、优先级和需要继续验证的事项"
    ];
  }

  if (stageType === "ANALYSIS" || role === "ROLE_ANALYST" || role === "ROLE_PRODUCT") {
    return [
      "分析角色先产出事实、边界、约束与风险，产品角色再补充方案、优先级与验收标准",
      "每一条关键判断都要能区分事实、假设和决策，避免旧模板口径覆盖当前项目实际",
      "handoff 必须能直接交给设计或下一位协作 Agent 使用，而不是停留在泛泛建议"
    ];
  }

  if (stageType === "DESIGN" || role === "ROLE_DESIGN") {
    return [
      "产品角色先给出体验目标、页面范围和内容优先级，设计角色再给出视觉与交互方案",
      "必须显式说明哪些设计决策来自本项目事实，哪些是合理假设，禁止套用旧项目风格模板",
      "handoff 必须写清设计约束、关键状态、响应式/交互规则和交给研发的实现边界"
    ];
  }

  if (stageType === "DEV" || role === "ROLE_ARCH" || role === "ROLE_DEV") {
    return [
      "架构角色先沉淀技术方案、接口和风险，研发角色再基于该契约完成实现与验证",
      "必须留下真实实现证据，包括改动范围、验证结果和未解决风险，不能只输出口头方案",
      "handoff 必须能交给下游 QA 或协作者继续执行，包括已完成项、待补项和回归关注点"
    ];
  }

  return [] as string[];
}

export function getProjectStageExecutionStrategy(stageType: StageType, role: RoleType): ProjectStageExecutionStrategy {
  const preferredModels = getPreferredStageModels(stageType, role);
  const requiredSkills = getStageRequiredSkills(stageType, role);
  const skillProtocol = getStageSkillProtocol(stageType, role);
  const collaborationProtocol = getStageCollaborationProtocol(stageType, role);
  const useTerminalAgent = TERMINAL_STAGE_ROLE_SET.has(`${stageType}:${role}`);
  const openClawAgentId = ROLE_OPENCLAW_AGENT_MAP[role];

  if (useTerminalAgent && openClawAgentId) {
    return {
      mode: "terminal_agent",
      reason: "关键阶段优先走终端 Agent，并保留长期记忆能力，但只允许使用当前项目或高关联历史经验，降低模板复用与旧上下文污染。",
      openClawAgentId,
      preferredModels,
      allowDirectModelFallback: false,
      requiredSkills,
      skillProtocol,
      collaborationProtocol,
      requiredCollaborationFields: TERMINAL_COLLABORATION_FIELDS,
      memoryEnabled: true,
      memoryPolicy: "current_project_or_high_relevance_only",
      executionMode: "autonomous",
      requireConfirmation: false
    };
  }

  return {
    mode: "direct_model",
    reason: "当前阶段保持直接模型执行，仍按最强候选模型顺序尝试，并继续保留长期记忆，但只允许当前项目或高关联经验参与。",
    preferredModels,
    allowDirectModelFallback: true,
    requiredSkills,
    skillProtocol,
    collaborationProtocol,
    requiredCollaborationFields: [],
    memoryEnabled: true,
    memoryPolicy: "current_project_or_high_relevance_only",
    executionMode: "confirm_first",
    requireConfirmation: true
  };
}

export function isTerminalStageExecution(stageType: StageType, role: RoleType) {
  return getProjectStageExecutionStrategy(stageType, role).mode === "terminal_agent";
}

export function buildTerminalStageExecutionMessage(input: {
  projectName: string;
  projectDescription: string;
  parsedIntent: ParsedIntent;
  stageType: StageType;
  role: RoleType;
  summary?: string;
}) {
  const strategy = getProjectStageExecutionStrategy(input.stageType, input.role);
  const objective = sanitizeTerminalSegment(
    input.summary || `${STAGE_LABELS[input.stageType]}阶段任务执行`,
    220
  );
  const description = sanitizeTerminalSegment(input.projectDescription, 360);
  const keywords = sanitizeTerminalSegment(input.parsedIntent.keywords.join("、") || "未提供", 180);
  const constraints = sanitizeTerminalSegment(input.parsedIntent.constraints.join("、") || "未提供", 180);
  const risks = sanitizeTerminalSegment(input.parsedIntent.risks.join("、") || "未提供", 180);
  const requiredSkills = sanitizeTerminalSegment(strategy.requiredSkills.join("、") || "无", 220);
  const skillDirectives = strategy.skillProtocol.map((item) =>
    sanitizeTerminalSegment(item, 220)
  );
  const collaborationDirectives = strategy.collaborationProtocol.map((item) =>
    sanitizeTerminalSegment(item, 220)
  );
  const collaborationFields = sanitizeTerminalSegment(
    strategy.requiredCollaborationFields.join("、") || "无",
    220
  );

  return [
    "请只基于当前项目执行阶段任务，允许参考长期记忆用于学习与复用经验",
    "但仅可使用当前项目记忆或与当前任务高度相关的历史经验",
    "低关联项目记忆、旧模板、默认视觉风格与无关上下文一律不要混入本次结论",
    `项目 ${sanitizeTerminalSegment(input.projectName, 120)}`,
    `阶段 ${STAGE_LABELS[input.stageType]}`,
    `角色 ${ROLE_LABELS[input.role]}`,
    `目标 ${objective}`,
    `需求 ${description}`,
    `关键词 ${keywords}`,
    `约束 ${constraints}`,
    `风险 ${risks}`,
    `requiredSkills ${requiredSkills}`,
    `requiredCollaborationFields ${collaborationFields}`,
    ...skillDirectives,
    ...collaborationDirectives,
    "正文中必须给出可供下游 Agent 继续执行的协作交接卡，字段名必须保持原样",
    "协作交接卡格式为 协作交接卡；factsConfirmed: 已确认事实；assumptions: 当前假设；decisions: 已做决策与取舍；handoff: 交给下游 Agent 的明确输入与动作；openQuestions: 待确认问题或风险空白",
    "输出末尾必须追加结构化技能证据区块，字段名必须保持原样",
    "证据区块格式为 技能执行记录；skillsUsed: 实际使用的技能列表；reasoningBasis: 本次判断依据；artifactsProduced: 已产出的页面、代码、文档或命令结果；verification: 已完成的检查、测试或人工校验",
    "要求 先独立思考再输出，给出真实判断依据、方案取舍、可交付结果与下一步，不允许复用旧项目风格或套用模板腔调"
  ].join("。");
}

function extractStructuredEvidenceField(output: string, field: TerminalSkillEvidenceField) {
  const pattern = new RegExp(
    `(?:^|\\n)\\s*(?:[-*]\\s*)?${field}\\s*[：:]\\s*([\\s\\S]*?)(?=\\n\\s*(?:[-*]\\s*)?(?:${TERMINAL_EVIDENCE_FIELDS.join("|")})\\s*[：:]|\\n##\\s|$)`,
    "i"
  );
  const matched = pattern.exec(String(output ?? ""));
  return String(matched?.[1] ?? "").replace(/\s+/g, " ").trim();
}

function splitSkillNames(input: string) {
  return dedupe(
    String(input ?? "")
      .split(/[,\n\r;；、，]/g)
      .map((item) => item.trim())
  );
}

function extractStructuredCollaborationField(output: string, field: TerminalCollaborationField) {
  const pattern = new RegExp(
    `(?:^|\\n)\\s*(?:[-*]\\s*)?${field}\\s*[：:]\\s*([\\s\\S]*?)(?=\\n\\s*(?:[-*]\\s*)?(?:${TERMINAL_COLLABORATION_FIELDS.join("|")})\\s*[：:]|\\n##\\s|$)`,
    "i"
  );
  const matched = pattern.exec(String(output ?? ""));
  return String(matched?.[1] ?? "").replace(/\s+/g, " ").trim();
}

export function validateTerminalSkillEvidence(output: string, requiredSkills: string[]): TerminalSkillEvidenceValidation {
  const source = String(output ?? "");
  const normalizedOutput = source.trim().toLowerCase();
  const normalizedSkills = requiredSkills
    .map((item) => String(item ?? "").trim().toLowerCase())
    .filter(Boolean);

  const hasEvidenceSection =
    normalizedOutput.includes("skillsused")
    || normalizedOutput.includes("reasoningbasis")
    || normalizedOutput.includes("artifactsproduced")
    || normalizedOutput.includes("verification")
    || normalizedOutput.includes("技能执行记录")
    || normalizedOutput.includes("skill evidence");
  const fieldValues = {
    skillsUsed: extractStructuredEvidenceField(source, "skillsUsed"),
    reasoningBasis: extractStructuredEvidenceField(source, "reasoningBasis"),
    artifactsProduced: extractStructuredEvidenceField(source, "artifactsProduced"),
    verification: extractStructuredEvidenceField(source, "verification")
  };
  const missingFields = TERMINAL_EVIDENCE_FIELDS.filter((field) => !fieldValues[field]);
  const parsedSkills = splitSkillNames(fieldValues.skillsUsed).map((item) => item.toLowerCase());
  const missingSkills = normalizedSkills.length > 0
    ? normalizedSkills.filter((skill) => !parsedSkills.includes(skill))
    : [];
  const parsedEvidence = missingFields.length === 0
    ? {
        skillsUsed: splitSkillNames(fieldValues.skillsUsed),
        reasoningBasis: fieldValues.reasoningBasis,
        artifactsProduced: fieldValues.artifactsProduced,
        verification: fieldValues.verification
      }
    : null;

  return {
    ok: hasEvidenceSection && missingFields.length === 0 && missingSkills.length === 0,
    missingSkills,
    missingFields,
    hasEvidenceSection,
    parsedEvidence
  };
}

export function validateTerminalCollaborationEvidence(output: string): TerminalCollaborationValidation {
  const source = String(output ?? "");
  const normalizedOutput = source.trim().toLowerCase();
  const hasSection =
    normalizedOutput.includes("factsconfirmed")
    || normalizedOutput.includes("assumptions")
    || normalizedOutput.includes("decisions")
    || normalizedOutput.includes("handoff")
    || normalizedOutput.includes("openquestions")
    || normalizedOutput.includes("协作交接卡");
  const fieldValues = {
    factsConfirmed: extractStructuredCollaborationField(source, "factsConfirmed"),
    assumptions: extractStructuredCollaborationField(source, "assumptions"),
    decisions: extractStructuredCollaborationField(source, "decisions"),
    handoff: extractStructuredCollaborationField(source, "handoff"),
    openQuestions: extractStructuredCollaborationField(source, "openQuestions")
  };
  const missingFields = TERMINAL_COLLABORATION_FIELDS.filter((field) => !fieldValues[field]);
  const parsedEvidence = missingFields.length === 0
    ? fieldValues
    : null;

  return {
    ok: hasSection && missingFields.length === 0,
    missingFields,
    hasSection,
    parsedEvidence
  };
}
