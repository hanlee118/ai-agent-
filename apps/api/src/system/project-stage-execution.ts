import {
  ROLE_LABELS,
  STAGE_LABELS,
  type ParsedIntent,
  type RoleType,
  type StageType
} from "@occ/shared";

export type ProjectStageExecutionMode = "direct_model" | "terminal_agent";

export type ProjectStageExecutionStrategy = {
  mode: ProjectStageExecutionMode;
  reason: string;
  openClawAgentId?: string;
  preferredModels: string[];
  allowDirectModelFallback: boolean;
  memoryEnabled: boolean;
  memoryPolicy: "all_allowed" | "current_project_or_high_relevance_only";
  executionMode: "confirm_first" | "autonomous";
  requireConfirmation: boolean;
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

const TERMINAL_STAGE_ROLE_SET = new Set<string>([
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
    "anthropic/claude-sonnet-4-20250514",
    "openai/gpt-5.3-codex",
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

export function getProjectStageExecutionStrategy(stageType: StageType, role: RoleType): ProjectStageExecutionStrategy {
  const preferredModels = getPreferredStageModels(stageType, role);
  const useTerminalAgent = TERMINAL_STAGE_ROLE_SET.has(`${stageType}:${role}`);
  const openClawAgentId = ROLE_OPENCLAW_AGENT_MAP[role];

  if (useTerminalAgent && openClawAgentId) {
    return {
      mode: "terminal_agent",
      reason: "设计与研发阶段优先走终端 Agent，并保留长期记忆能力，但只允许使用当前项目或高关联历史经验，降低模板复用与旧上下文污染。",
      openClawAgentId,
      preferredModels,
      allowDirectModelFallback: false,
      memoryEnabled: true,
      memoryPolicy: "current_project_or_high_relevance_only",
      executionMode: "autonomous",
      requireConfirmation: false
    };
  }

  return {
    mode: "direct_model",
    reason: "当前阶段保持直接模型执行，仍按最强候选模型顺序尝试。",
    preferredModels,
    allowDirectModelFallback: true,
    memoryEnabled: true,
    memoryPolicy: "all_allowed",
    executionMode: "confirm_first",
    requireConfirmation: true
  };
}

export function isTerminalStageExecution(stageType: StageType, role: RoleType) {
  return getProjectStageExecutionStrategy(stageType, role).mode === "terminal_agent";
}

function buildTerminalSkillDirective(stageType: StageType, role: RoleType) {
  if (stageType === "DESIGN" || role === "ROLE_DESIGN") {
    return [
      "技能要求 先加载并使用 design-to-code、frontend-design、frontend-design-pro 相关技能再开始设计输出",
      "执行方式 优先通过终端技能工作流完成分析、风格探索、结构设计与可落地界面方案，不要直接裸写模板化答案",
      "设计原则 如果最强模型不可用，优先切换到仍可用的终端强模型继续，并继续沿用技能工作流，不要退化为普通模型直出"
    ];
  }

  if (stageType === "DEV" || role === "ROLE_ARCH" || role === "ROLE_DEV") {
    return [
      "技能要求 先使用终端编码工作流与可用工程技能，再进入实现、修复、验证与交付",
      "执行方式 优先通过终端工具链完成代码分析、修改、测试与回归核验，不要直接输出未经验证的实现建议",
      "研发原则 如果首选模型不可用，优先切换到仍可用的终端强模型继续执行，并保持工具驱动、验证先行"
    ];
  }

  return [];
}

export function buildTerminalStageExecutionMessage(input: {
  projectName: string;
  projectDescription: string;
  parsedIntent: ParsedIntent;
  stageType: StageType;
  role: RoleType;
  summary?: string;
}) {
  const objective = sanitizeTerminalSegment(
    input.summary || `${STAGE_LABELS[input.stageType]}阶段任务执行`,
    220
  );
  const description = sanitizeTerminalSegment(input.projectDescription, 360);
  const keywords = sanitizeTerminalSegment(input.parsedIntent.keywords.join("、") || "未提供", 180);
  const constraints = sanitizeTerminalSegment(input.parsedIntent.constraints.join("、") || "未提供", 180);
  const risks = sanitizeTerminalSegment(input.parsedIntent.risks.join("、") || "未提供", 180);
  const skillDirectives = buildTerminalSkillDirective(input.stageType, input.role).map((item) =>
    sanitizeTerminalSegment(item, 220)
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
    ...skillDirectives,
    "要求 先独立思考再输出，给出真实判断依据、方案取舍、可交付结果与下一步，不允许复用旧项目风格或套用模板腔调"
  ].join("。");
}
