import type { RoleType, StageType } from "@occ/shared";
import {
  getProjectStageExecutionStrategy,
  validateTerminalCollaborationEvidence,
  validateTerminalSkillEvidence
} from "./project-stage-execution.js";

type StageProtocolGateDeliverable = {
  name: string;
  content: string;
  status?: string;
  createdBy?: string | null;
};

type StageProtocolGateExecution = {
  role: string;
  status: string;
  metadata?: unknown;
};

type StageProtocolCheck = {
  key: string;
  label: string;
  passed: boolean;
  category: "collaboration" | "skill" | "content";
  detail?: string;
};

export type StageExecutionProtocolGateResult = {
  stageType: StageType;
  passed: boolean;
  issues: string[];
  protocolChecks: StageProtocolCheck[];
  requiredSkills: string[];
  collaborationRequired: boolean;
  skillEvidenceRequired: boolean;
  collaborationSatisfiedBy: "metadata" | "content" | "not_required" | "missing";
  skillEvidenceSatisfiedBy: "metadata" | "content" | "not_required" | "missing";
  deliverableCount: number;
  executionCount: number;
  contentChecks: StageProtocolCheck[];
};

const STAGE_PROTOCOL_ROLE_MAP: Record<StageType, RoleType[]> = {
  INIT: ["ROLE_PM"],
  ANALYSIS: ["ROLE_ANALYST", "ROLE_PRODUCT"],
  DESIGN: ["ROLE_PRODUCT", "ROLE_DESIGN"],
  DEV: ["ROLE_ARCH", "ROLE_DEV"],
  ACCEPT: ["ROLE_QA"]
};

const DELIVERY_PHASES = new Set<StageType>(["DESIGN", "DEV", "ACCEPT"]);

const STAGE_CONTENT_RULES: Record<StageType, Array<{ key: string; label: string; patterns: RegExp[] }>> = {
  INIT: [
    { key: "goal", label: "项目目标", patterns: [/项目目标|阶段目标|目标[:：]/i] },
    { key: "scope", label: "范围边界", patterns: [/范围\s*\/\s*非范围|非范围|范围边界|范围说明|边界[:：]/i] },
    { key: "owner", label: "阶段负责人", patterns: [/阶段负责人|负责人|角色分工|owner|assignee/i] },
    { key: "open_questions", label: "待确认项", patterns: [/待确认|待澄清|待补充|openQuestions/i] }
  ],
  ANALYSIS: [
    { key: "boundary", label: "范围与边界", patterns: [/范围与边界|边界说明|边界[:：]/i] },
    { key: "constraints", label: "约束条件", patterns: [/约束条件|约束清单|关键约束|约束[:：]/i] },
    { key: "risks", label: "风险清单", patterns: [/风险清单|关键风险|风险[:：]/i] },
    { key: "acceptance", label: "验收标准", patterns: [/验收标准|成功标准|acceptance/i] }
  ],
  DESIGN: [
    { key: "structure", label: "页面/模块结构方案", patterns: [/页面结构|模块结构|页面\/模块结构|信息结构/i] },
    { key: "interaction", label: "视觉与交互说明", patterns: [/视觉说明|视觉方向|交互说明|交互规则/i] },
    { key: "states", label: "关键状态说明", patterns: [/关键状态|异常状态|边界状态|empty|loading|error/i] },
    { key: "responsive_handoff", label: "响应式与研发交付边界", patterns: [/响应式|断点|适配|研发交付边界|实现边界|handoff/i] }
  ],
  DEV: [
    { key: "tech_plan", label: "技术方案", patterns: [/技术方案|架构方案|接口|选型/i] },
    { key: "verification", label: "验证结果", patterns: [/验证结果|测试结果|联调|回归|verification/i] },
    { key: "risk_backlog", label: "风险与遗留问题", patterns: [/风险|遗留问题|待补项|openQuestions/i] },
    { key: "handoff_boundary", label: "完成边界与交接", patterns: [/已完成|未完成|handoff|回归关注点/i] }
  ],
  ACCEPT: [
    { key: "decision", label: "验收结论", patterns: [/验收结论|验收结果|通过|不通过/i] },
    { key: "report", label: "测试报告", patterns: [/测试报告|测试范围|测试用例|缺陷/i] },
    { key: "backfill", label: "文档/记忆回填", patterns: [/回填记录|产品说明文档回填|文档回填|长期记忆/i] },
    { key: "retro", label: "复盘或下一轮建议", patterns: [/复盘|下一轮|归档|迭代建议/i] }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeProtocolContent(value: unknown) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

function normalizeStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return dedupe(value.map((item) => normalizeText(item)));
  }
  return dedupe(String(value ?? "").split(/[,\n\r;；、，]/g).map((item) => normalizeText(item)));
}

function readCollaborationEvidence(metadata: unknown) {
  if (!isRecord(metadata) || !isRecord(metadata.terminalCollaborationEvidence)) {
    return null;
  }

  const source = metadata.terminalCollaborationEvidence as Record<string, unknown>;
  const factsConfirmed = normalizeText(source.factsConfirmed);
  const assumptions = normalizeText(source.assumptions);
  const decisions = normalizeText(source.decisions);
  const handoff = normalizeText(source.handoff);
  const openQuestions = normalizeText(source.openQuestions);

  const missingFields = [
    !factsConfirmed ? "factsConfirmed" : null,
    !assumptions ? "assumptions" : null,
    !decisions ? "decisions" : null,
    !handoff ? "handoff" : null,
    !openQuestions ? "openQuestions" : null
  ].filter((item): item is string => Boolean(item));

  return {
    ok: missingFields.length === 0,
    missingFields
  };
}

function readSkillEvidence(metadata: unknown, requiredSkills: string[]) {
  if (!isRecord(metadata) || !isRecord(metadata.terminalSkillEvidence)) {
    return null;
  }

  const source = metadata.terminalSkillEvidence as Record<string, unknown>;
  const skillsUsed = normalizeStringArray(source.skillsUsed).map((item) => item.toLowerCase());
  const reasoningBasis = normalizeText(source.reasoningBasis);
  const artifactsProduced = normalizeText(source.artifactsProduced);
  const verification = normalizeText(source.verification);

  const missingFields = [
    skillsUsed.length === 0 ? "skillsUsed" : null,
    !reasoningBasis ? "reasoningBasis" : null,
    !artifactsProduced ? "artifactsProduced" : null,
    !verification ? "verification" : null
  ].filter((item): item is string => Boolean(item));

  const normalizedRequiredSkills = requiredSkills.map((item) => item.toLowerCase());
  const missingSkills = normalizedRequiredSkills.filter((skill) => !skillsUsed.includes(skill));

  return {
    ok: missingFields.length === 0 && missingSkills.length === 0,
    missingFields,
    missingSkills
  };
}

function buildStageRequiredSkills(stageType: StageType) {
  const roles = STAGE_PROTOCOL_ROLE_MAP[stageType] ?? [];
  return dedupe(
    roles.flatMap((role) => getProjectStageExecutionStrategy(stageType, role).requiredSkills)
  );
}

export function evaluateStageExecutionProtocolGate(input: {
  stageType: StageType;
  liveBody?: string | null;
  deliverables: StageProtocolGateDeliverable[];
  executions: StageProtocolGateExecution[];
  requireSkillEvidence: boolean;
  requireCollaborationHandoff: boolean;
}): StageExecutionProtocolGateResult {
  const requiredSkills = buildStageRequiredSkills(input.stageType);
  const skillEvidenceRequired = input.requireSkillEvidence && DELIVERY_PHASES.has(input.stageType);
  const collaborationRequired = input.requireCollaborationHandoff;
  const stageDeliverables = input.deliverables.filter((item) =>
    item.status === undefined || item.status === "submitted" || item.status === "approved"
  );
  const contentSource = dedupe([
    normalizeProtocolContent(input.liveBody),
    ...stageDeliverables.map((item) => normalizeProtocolContent(item.content))
  ]).join("\n\n");
  const stageExecutions = input.executions.filter((item) => item.status === "success");
  const issues: string[] = [];

  let collaborationSatisfiedBy: StageExecutionProtocolGateResult["collaborationSatisfiedBy"] = "not_required";
  let skillEvidenceSatisfiedBy: StageExecutionProtocolGateResult["skillEvidenceSatisfiedBy"] = "not_required";
  let collaborationCheck: StageProtocolCheck = {
    key: "collaboration",
    label: "协作交接卡",
    passed: true,
    category: "collaboration",
    detail: "当前阶段不要求"
  };
  let skillCheck: StageProtocolCheck = {
    key: "skill_evidence",
    label: "技能执行记录",
    passed: true,
    category: "skill",
    detail: "当前阶段不要求"
  };

  if (collaborationRequired) {
    const collaborationFromMetadata = stageExecutions
      .map((item) => readCollaborationEvidence(item.metadata))
      .find((item) => item?.ok);
    const collaborationFromContent = validateTerminalCollaborationEvidence(contentSource);

    if (collaborationFromMetadata) {
      collaborationSatisfiedBy = "metadata";
      collaborationCheck = {
        key: "collaboration",
        label: "协作交接卡",
        passed: true,
        category: "collaboration",
        detail: "已由执行元数据覆盖"
      };
    } else if (collaborationFromContent.ok) {
      collaborationSatisfiedBy = "content";
      collaborationCheck = {
        key: "collaboration",
        label: "协作交接卡",
        passed: true,
        category: "collaboration",
        detail: "已由交付正文覆盖"
      };
    } else {
      collaborationSatisfiedBy = "missing";
      collaborationCheck = {
        key: "collaboration",
        label: "协作交接卡",
        passed: false,
        category: "collaboration",
        detail: `缺失字段: ${collaborationFromContent.missingFields.join(", ") || "unknown"}`
      };
      issues.push(
        `缺少协作交接卡（factsConfirmed/assumptions/decisions/handoff/openQuestions），当前缺失字段: ${collaborationFromContent.missingFields.join(", ") || "unknown"}`
      );
    }
  }

  if (skillEvidenceRequired) {
    const skillFromMetadata = stageExecutions
      .map((item) => readSkillEvidence(item.metadata, requiredSkills))
      .find((item) => item?.ok);
    const skillFromContent = validateTerminalSkillEvidence(contentSource, requiredSkills);

    if (skillFromMetadata) {
      skillEvidenceSatisfiedBy = "metadata";
      skillCheck = {
        key: "skill_evidence",
        label: "技能执行记录",
        passed: true,
        category: "skill",
        detail: "已由执行元数据覆盖"
      };
    } else if (skillFromContent.ok) {
      skillEvidenceSatisfiedBy = "content";
      skillCheck = {
        key: "skill_evidence",
        label: "技能执行记录",
        passed: true,
        category: "skill",
        detail: "已由交付正文覆盖"
      };
    } else {
      skillEvidenceSatisfiedBy = "missing";
      const missingParts: string[] = [];
      if (skillFromContent.missingFields.length > 0) {
        missingParts.push(`缺失字段 ${skillFromContent.missingFields.join(", ")}`);
      }
      if (skillFromContent.missingSkills.length > 0) {
        missingParts.push(`缺失技能 ${skillFromContent.missingSkills.join(", ")}`);
      }
      skillCheck = {
        key: "skill_evidence",
        label: "技能执行记录",
        passed: false,
        category: "skill",
        detail: missingParts.join("；") || "未找到可验证证据"
      };
      issues.push(`缺少技能执行记录（skillsUsed/reasoningBasis/artifactsProduced/verification），${missingParts.join("；") || "未找到可验证证据"}`);
    }
  }

  const contentChecks = (STAGE_CONTENT_RULES[input.stageType] ?? []).map((rule) => ({
    key: rule.key,
    label: rule.label,
    passed: rule.patterns.some((pattern) => pattern.test(contentSource)),
    category: "content" as const,
    detail: rule.patterns.some((pattern) => pattern.test(contentSource))
      ? "已覆盖"
      : `缺少协议要求内容: ${rule.label}`
  }));

  for (const check of contentChecks) {
    if (!check.passed) {
      issues.push(`缺少协议要求内容: ${check.label}`);
    }
  }

  return {
    stageType: input.stageType,
    passed: issues.length === 0,
    issues,
    protocolChecks: [collaborationCheck, skillCheck, ...contentChecks],
    requiredSkills,
    collaborationRequired,
    skillEvidenceRequired,
    collaborationSatisfiedBy,
    skillEvidenceSatisfiedBy,
    deliverableCount: stageDeliverables.length,
    executionCount: stageExecutions.length,
    contentChecks
  };
}
