/**
 * ⚠️ V1 维护模式
 * 此文件仅接受 bug 修复，不接受新功能。
 * 新功能请在 workflows-v2.ts 或 workflow-v2/ 目录下实现。
 * 详见 docs/ARCHITECTURE-EVOLUTION.md
 */
import { MutationPassthroughSchema } from "../validation/schemas.js";
import { validateBody } from "../validation/middleware.js";
import type { ParsedIntent, RoleType } from "@occ/shared";
import { randomUUID } from "node:crypto";
import express from "express";
import { getRuntimeStatus } from "../agents/runtime.js";
import { createProject } from "../data/repository.js";
import { getIndustryConfig, listIndustryConfigs } from "./role-sets.js";
import { asyncRoute, sendError, sendSuccess } from "./utils.js";
import {
  buildContextAlignment,
  buildDesignBlueprint,
  buildExpectedArtifacts,
  buildIssueWorkflowSop,
  buildClarificationQuestions,
  buildIssueDiscussion,
  buildRelatedHistory,
  buildRequirementContract,
  buildRequirementRefinement,
  getTemplateRequiredRoles,
  buildSuggestedAnswers,
  detectIndustry,
  detectConflicts,
  inferIssueSummary,
  inferIssueTitle,
  recommendRoles,
  resolveIssueWorkflowTemplateKey,
  synthesizeIssueArtifactsFromDebate
} from "../system/issue-engine.js";
import { buildIssueRoleDebate, type IssueDebateResult as RuntimeIssueDebateResult } from "../system/issue-debate.js";
import {
  appendRequirementBackfill,
  createIssueDraft,
  getIssue,
  getProductContext,
  listIssues,
  resolveRequirementMismatches,
  updateIssue,
  type IssueAnalysisGate,
  type IssueAnalysisGateCheck,
  type IssueDebateTaskStatus,
  type IssueDiscussionItem,
  type IssueSourceType
} from "../system/v1-method-store.js";
import { runProjectPostCreatePrep } from "../system/post-create-prep.js";

interface PreviewIssueBody {
  input?: unknown;
  industryCode?: unknown;
  sourceType?: unknown;
  debateMode?: unknown;
  workflowTemplateKey?: unknown;
}

interface ConfirmIssueBody {
  clarificationAnswers?: unknown;
  finalName?: unknown;
  finalDescription?: unknown;
  teamRoleIds?: unknown;
  conflictResolution?: unknown;
  projectType?: unknown;
  parentProjectId?: unknown;
  relaySourceStageId?: unknown;
  projectInputs?: unknown;
  workflowTemplateKey?: unknown;
  autoStartWorkflow?: unknown;
}

const ROLE_IDS: RoleType[] = [
  "ROLE_ASSISTANT",
  "ROLE_PM",
  "ROLE_ANALYST",
  "ROLE_PRODUCT",
  "ROLE_DESIGN",
  "ROLE_ARCH",
  "ROLE_DEV",
  "ROLE_QA",
  "ROLE_HR"
];

function normalizeSourceType(input: unknown): IssueSourceType {
  const value = String(input ?? "").trim().toLowerCase();
  if (
    value === "meeting_notes"
    || value === "journey"
    || value === "competitor"
    || value === "file_import"
    || value === "prd"
  ) {
    return value;
  }
  return "text";
}

function normalizeDebateMode(input: unknown) {
  const value = String(input ?? "").trim().toLowerCase();
  if (value === "off") {
    return "off" as const;
  }
  if (value === "model") {
    return "model" as const;
  }
  return "auto" as const;
}

function normalizeRoleList(input: unknown) {
  if (!Array.isArray(input)) {
    return [] as RoleType[];
  }
  return input
    .map((item) => String(item ?? "").trim().toUpperCase())
    .filter((item): item is RoleType => ROLE_IDS.includes(item as RoleType));
}

function normalizeOptionalBoolean(input: unknown) {
  if (typeof input === "boolean") {
    return input;
  }
  if (input === null || input === undefined) {
    return undefined;
  }
  const text = String(input).trim().toLowerCase();
  if (text === "true" || text === "1" || text === "yes" || text === "on") {
    return true;
  }
  if (text === "false" || text === "0" || text === "no" || text === "off") {
    return false;
  }
  return undefined;
}

function normalizeProjectType(input: unknown) {
  const text = String(input ?? "").trim().toLowerCase();
  if (text === "standalone" || text === "relay") {
    return text as "standalone" | "relay";
  }
  return "complete" as const;
}

function isProjectModeTemplateCompatible(input: {
  projectType: "complete" | "standalone" | "relay";
  workflowTemplateKey: unknown;
}) {
  const normalizedTemplateKey = String(input.workflowTemplateKey ?? "").trim().toLowerCase();
  const templateKey = normalizedTemplateKey || "standard_software_development";
  if (input.projectType === "complete") {
    return templateKey === "standard_software_development" || templateKey === "none";
  }
  return templateKey === "none"
    || templateKey === "requirements_design"
    || templateKey === "visual_design"
    || templateKey === "tech_design"
    || templateKey === "code_dev"
    || templateKey === "qa_acceptance";
}

function applyTemplateRolePlan(input: {
  recommendedRoleIds: RoleType[];
  workflowTemplateKey: unknown;
  mustHaveSoulRole: boolean;
  soulRoleId: RoleType;
  enforceIndustryAssemblyRule?: boolean;
}) {
  if (input.enforceIndustryAssemblyRule) {
    const planned = [...input.recommendedRoleIds];
    if (input.mustHaveSoulRole && input.soulRoleId && !planned.includes(input.soulRoleId)) {
      planned.unshift(input.soulRoleId);
    }
    return planned.length > 0 ? Array.from(new Set(planned)) : input.recommendedRoleIds;
  }
  const resolvedTemplateKey = resolveIssueWorkflowTemplateKey(input.workflowTemplateKey);
  const requiredRoles = getTemplateRequiredRoles(resolvedTemplateKey);
  const planned = resolvedTemplateKey === "standard_software_development"
    ? Array.from(new Set([...requiredRoles, ...input.recommendedRoleIds]))
    : [...requiredRoles];
  return planned.length > 0 ? Array.from(new Set(planned)) : input.recommendedRoleIds;
}

function normalizeProjectInputs(input: unknown) {
  type NormalizedProjectInput = {
    name: string;
    type: string;
    description?: string;
    content?: string;
    filePath?: string;
    referenceDeliverableId?: string;
    inputSource?: "manual" | "imported_from_project" | "template_generated";
  };

  if (!Array.isArray(input)) {
    return [] as NormalizedProjectInput[];
  }

  return input.reduce<NormalizedProjectInput[]>((acc, item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return acc;
      }
      const record = item as Record<string, unknown>;
      const name = String(record.name ?? "").trim();
      const type = String(record.type ?? "").trim() || "document";
      if (!name) {
        return acc;
      }
      const sourceRaw = String(record.inputSource ?? "").trim();
      const inputSource = sourceRaw === "imported_from_project" || sourceRaw === "template_generated"
        ? sourceRaw
        : "manual";
      acc.push({
        name,
        type,
        description: String(record.description ?? "").trim() || undefined,
        content: String(record.content ?? "").trim() || undefined,
        filePath: String(record.filePath ?? "").trim() || undefined,
        referenceDeliverableId: String(record.referenceDeliverableId ?? "").trim() || undefined,
        inputSource: inputSource as "manual" | "imported_from_project" | "template_generated"
      });
      return acc;
    }, []);
}

function normalizeStringMap(input: unknown) {
  if (!input || typeof input !== "object") {
    return {} as Record<string, string>;
  }

  return Object.entries(input as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, value]) => {
    const k = String(key ?? "").trim();
    const v = String(value ?? "").trim();
    if (k && v) {
      acc[k] = v;
    }
    return acc;
  }, {});
}

type NormalizedIssueProjectInput = {
  name: string;
  type: string;
  description?: string;
  content?: string;
  filePath?: string;
  referenceDeliverableId?: string;
  inputSource?: "manual" | "imported_from_project" | "template_generated";
};

function sanitizeLine(value: string, fallback = "待补充") {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function asNonEmptyList(items: string[], fallback: string) {
  const cleaned = items.map((item) => sanitizeLine(item, "")).filter(Boolean);
  return cleaned.length > 0 ? cleaned : [fallback];
}

function buildDebateConclusionSection(input: {
  issue: Awaited<ReturnType<typeof getIssue>>;
  clarificationAnswers: Record<string, string>;
  objective: string;
}) {
  const issue = input.issue;
  const discussion = Array.isArray(issue?.discussion) ? issue.discussion : [];
  const debateOpinions = Array.isArray(issue?.debate?.opinions) ? issue.debate.opinions : [];
  const consensus = asNonEmptyList(
    Array.isArray(issue?.debate?.consensus) ? issue.debate.consensus : [],
    "当前无结构化共识条目，需在后续阶段补充。"
  );
  const divergences = asNonEmptyList(
    Array.isArray(issue?.debate?.divergences) ? issue.debate.divergences : [],
    "当前无显式分歧项。"
  );
  const roleDecisionsFromDiscussion = discussion
    .map((item) => {
      const role = sanitizeLine(item.roleLabel || item.roleId || "未知角色");
      const decision = sanitizeLine(item.proposal || item.concern || item.focus || "");
      return decision ? `- ${role}: ${decision}` : "";
    })
    .filter(Boolean);
  const roleDecisionsFromDebate = debateOpinions
    .map((item) => {
      const role = sanitizeLine(String((item as { roleLabel?: string; roleId?: string }).roleLabel
        || (item as { roleId?: string }).roleId
        || "未知角色"));
      const decision = sanitizeLine(String((item as { proposal?: string; concern?: string }).proposal
        || (item as { concern?: string }).concern
        || ""));
      return decision ? `- ${role}: ${decision}` : "";
    })
    .filter(Boolean);
  const roleDecisions = roleDecisionsFromDiscussion.length > 0
    ? roleDecisionsFromDiscussion
    : roleDecisionsFromDebate;
  const decisionAnchor = sanitizeLine(
    input.clarificationAnswers.goal
    || issue?.summary
    || input.objective,
    "围绕已确认业务目标推进 MVP。"
  );

  return [
    "## 多Agent需求讨论结论",
    "",
    "### 共识",
    ...consensus.map((item) => `- ${item}`),
    "",
    "### 分歧与处理",
    ...divergences.map((item) => `- ${item}`),
    "",
    "### 角色决策建议",
    ...(roleDecisions.length > 0 ? roleDecisions : ["- 当前缺少角色级决策建议，需补充后再推进执行。"]),
    "",
    "### 决策锚点",
    `- ${decisionAnchor}`
  ].join("\n");
}

function buildAnalysisDraftSection(input: {
  issue: Awaited<ReturnType<typeof getIssue>>;
  objective: string;
  inScope: string[];
  outOfScope: string[];
  acceptanceCriteria: string[];
}) {
  const refinement = input.issue?.refinement;
  const designBlueprint = input.issue?.designBlueprint;
  const objective = sanitizeLine(input.objective, "待补充项目目标");
  const scenarios = asNonEmptyList(
    Array.isArray(designBlueprint?.coreScenarios) ? designBlueprint.coreScenarios : [],
    "待补充核心场景"
  );
  const inScope = asNonEmptyList(input.inScope, "待补充首期范围");
  const outOfScope = asNonEmptyList(input.outOfScope, "待补充非目标范围");
  const acceptance = asNonEmptyList(input.acceptanceCriteria, "待补充验收标准");
  const risks = asNonEmptyList(
    [
      ...(Array.isArray(refinement?.outOfScopeDraft) ? refinement.outOfScopeDraft : []),
      ...(Array.isArray(input.issue?.debate?.divergences) ? input.issue?.debate?.divergences ?? [] : [])
    ],
    "暂无新增高风险，按阶段门禁继续验证。"
  );

  return [
    "## 项目详情理解确认草案",
    "",
    `- 目标: ${objective}`,
    `- 设计主题: ${sanitizeLine(designBlueprint?.designTheme || "", "待补充设计主题")}`,
    "",
    "### 核心场景",
    ...scenarios.map((item) => `- ${item}`),
    "",
    "### In Scope",
    ...inScope.map((item) => `- ${item}`),
    "",
    "### Out of Scope",
    ...outOfScope.map((item) => `- ${item}`),
    "",
    "### 验收标准",
    ...acceptance.map((item) => `- ${item}`),
    "",
    "### 关键风险与待确认",
    ...risks.map((item) => `- ${item}`)
  ].join("\n");
}

function buildSeedProjectInputsFromIssue(input: {
  rawInput: string;
  requirementBlock: string;
  debateBlock: string;
  analysisBlock: string;
}): NormalizedIssueProjectInput[] {
  const rawRequirementsContent = [
    "# rawRequirements",
    "",
    sanitizeLine(input.rawInput, "待补充原始需求"),
    "",
    input.debateBlock,
    "",
    input.analysisBlock,
    "",
    input.requirementBlock
  ].join("\n");
  const prdContent = [
    "# prd",
    "",
    input.analysisBlock,
    "",
    input.requirementBlock
  ].join("\n");
  const debateContent = [
    "# debateSummary",
    "",
    input.debateBlock
  ].join("\n");

  return [
    {
      name: "rawRequirements",
      type: "document",
      description: "Issue 确认阶段自动注入的原始需求与多Agent讨论结论。",
      content: rawRequirementsContent,
      inputSource: "template_generated"
    },
    {
      name: "prd",
      type: "document",
      description: "Issue 确认阶段自动生成的需求分析草案与需求确认单。",
      content: prdContent,
      inputSource: "template_generated"
    },
    {
      name: "debateSummary",
      type: "document",
      description: "Issue 真实模型多角色讨论结论摘要。",
      content: debateContent,
      inputSource: "template_generated"
    }
  ];
}

function mergeProjectInputsWithSeeded(
  userInputs: NormalizedIssueProjectInput[],
  seededInputs: NormalizedIssueProjectInput[]
) {
  const merged = [...userInputs];
  const keyed = new Set(merged.map((item) => String(item.name || "").trim().toLowerCase()).filter(Boolean));
  for (const item of seededInputs) {
    const key = String(item.name || "").trim().toLowerCase();
    if (!key || keyed.has(key)) {
      continue;
    }
    merged.push(item);
    keyed.add(key);
  }
  return merged;
}

function buildParsedIntentFromIssue(input: {
  issue: Awaited<ReturnType<typeof getIssue>>;
  selectedRoleIds: RoleType[];
  clarificationAnswers: Record<string, string>;
  conflictResolution?: string;
}): ParsedIntent {
  const issue = input.issue;
  const keywords = Array.from(
    new Set(
      [
        issue?.industryCode || "",
        issue?.title || "",
        ...(issue?.refinement?.inScopeDraft || []),
        ...(issue?.designBlueprint?.coreScenarios || [])
      ]
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  ).slice(0, 8);

  const constraints = Array.from(
    new Set(
      [
        ...(issue?.refinement?.outOfScopeDraft || []),
        ...(issue?.contextAlignment?.contextNotes || []),
        ...(input.conflictResolution ? [`冲突解决说明: ${input.conflictResolution}`] : [])
      ]
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  ).slice(0, 6);

  const risks = Array.from(
    new Set(
      [
        ...(issue?.conflicts || []).map((conflict) => `${conflict.severity}: ${conflict.title}`),
        ...(issue?.debate?.divergences || [])
      ]
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  ).slice(0, 6);

  return {
    keywords: keywords.length > 0 ? keywords : [issue?.title || "需求事项"],
    constraints: constraints.length > 0 ? constraints : ["按已确认需求范围推进，不引入平行语义"],
    risks: risks.length > 0 ? risks : ["若需求上下文变更，需重新发起 issue 分析并确认"],
    suggestedTeam: input.selectedRoleIds,
    summary: String(input.clarificationAnswers.goal || issue?.summary || issue?.rawInput || "").trim()
  };
}

interface CreateIssuesRouterOptions {
  onProjectCreated?: (projectId: string) => void | Promise<void>;
}

interface DebateTaskState {
  taskId: string;
  issueId: string;
  status: IssueDebateTaskStatus;
  createdAt: string;
  updatedAt: string;
  debate: RuntimeIssueDebateResult | null;
  discussion: IssueDiscussionItem[];
  discussionDraft: IssueDiscussionItem[];
  error?: string;
}

type IssueContentSource = "model_debate" | "rule_draft" | "fallback";

interface IssueContentProvenance {
  formalReady: boolean;
  note: string;
  summary: IssueContentSource;
  refinement: IssueContentSource;
  contextAlignment: IssueContentSource;
  designBlueprint: IssueContentSource;
  suggestedAnswers: IssueContentSource;
  requirementContract: IssueContentSource;
  discussion: IssueContentSource;
  discussionDraft: IssueContentSource;
}

const ISSUE_DEBATE_POLL_AFTER_MS = Math.max(800, Number(process.env.ISSUE_DEBATE_POLL_MS ?? 1500));
// Keep stale timeout aligned with the async debate execution budget.
// Otherwise long-running real-model debates can be incorrectly marked as failed while still executing.
const ISSUE_DEBATE_ROLE_TIMEOUT_MS = Math.max(60_000, Number(process.env.ISSUE_DEBATE_ROLE_TIMEOUT_MS ?? 130_000));
const ISSUE_DEBATE_MAX_ROLES = Math.max(4, Number(process.env.ISSUE_DEBATE_MAX_ROLES ?? 6));
const ISSUE_DEBATE_CONCURRENCY = Math.max(1, Number(process.env.ISSUE_DEBATE_CONCURRENCY ?? 2));
const ISSUE_DEBATE_EXPECTED_MAX_MS = Math.ceil(ISSUE_DEBATE_MAX_ROLES / ISSUE_DEBATE_CONCURRENCY) * ISSUE_DEBATE_ROLE_TIMEOUT_MS;
const ISSUE_DEBATE_STALE_TIMEOUT_OVERRIDE_MS = Number(process.env.ISSUE_DEBATE_STALE_TIMEOUT_MS ?? 0);
const ISSUE_DEBATE_STALE_TIMEOUT_MS = Number.isFinite(ISSUE_DEBATE_STALE_TIMEOUT_OVERRIDE_MS) && ISSUE_DEBATE_STALE_TIMEOUT_OVERRIDE_MS > 0
  ? Math.max(60_000, ISSUE_DEBATE_STALE_TIMEOUT_OVERRIDE_MS)
  : Math.max(90_000, ISSUE_DEBATE_EXPECTED_MAX_MS + 60_000);
const issueDebateTaskStore = new Map<string, DebateTaskState>();
const issueLatestDebateTask = new Map<string, string>();

function nowIso() {
  return new Date().toISOString();
}

function isDebateTaskStale(task: DebateTaskState) {
  const updatedAtMs = Date.parse(task.updatedAt || task.createdAt);
  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }
  return (Date.now() - updatedAtMs) > ISSUE_DEBATE_STALE_TIMEOUT_MS;
}

function toDiscussionFromDebate(
  debate: RuntimeIssueDebateResult | null | undefined,
  fallback: IssueDiscussionItem[]
) {
  if (!debate || debate.opinions.length === 0) {
    return fallback;
  }

  return debate.opinions.map((item) => ({
    id: item.id,
    roleId: item.roleId,
    roleLabel: item.roleLabel,
    focus: item.focus,
    concern: item.concern,
    proposal: item.proposal
  }));
}

function trimInline(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function buildPendingSummary(rawInput: string, fallback: string) {
  const normalized = trimInline(rawInput);
  if (!normalized) {
    return fallback;
  }
  if (normalized.length <= 120) {
    return normalized;
  }
  return `${normalized.slice(0, 120)}...`;
}

function buildIssueContentProvenance(input: {
  status: IssueDebateTaskStatus;
  debate: { mode?: string | null } | null;
}): IssueContentProvenance {
  const modelReady = input.status === "completed" && input.debate?.mode === "model";
  if (modelReady) {
    return {
      formalReady: true,
      note: "正式分析结论已由真实模型多角色讨论产出。",
      summary: "model_debate",
      refinement: "model_debate",
      contextAlignment: "model_debate",
      designBlueprint: "model_debate",
      suggestedAnswers: "model_debate",
      requirementContract: "model_debate",
      discussion: "model_debate",
      discussionDraft: "rule_draft"
    };
  }

  const fallbackCompleted = input.status === "completed" && input.debate?.mode === "fallback";
  if (fallbackCompleted) {
    return {
      formalReady: false,
      note: "当前仅有降级/fallback 结果，不可作为正式推进依据。",
      summary: "fallback",
      refinement: "fallback",
      contextAlignment: "fallback",
      designBlueprint: "fallback",
      suggestedAnswers: "fallback",
      requirementContract: "fallback",
      discussion: "fallback",
      discussionDraft: "rule_draft"
    };
  }

  return {
    formalReady: false,
    note: "真实模型多角色讨论尚未完成，当前仅提供规则草稿占位。",
    summary: "rule_draft",
    refinement: "rule_draft",
    contextAlignment: "rule_draft",
    designBlueprint: "rule_draft",
    suggestedAnswers: "rule_draft",
    requirementContract: "rule_draft",
    discussion: "rule_draft",
    discussionDraft: "rule_draft"
  };
}

function resolveIssuePublicContent(input: {
  rawInput: string;
  fallbackSummary: string;
  refinement: {
    problemStatement: string;
    expectedOutcome: string;
    inScopeDraft: string[];
    outOfScopeDraft: string[];
    acceptanceDraft: string[];
  } | null | undefined;
  contextAlignment: {
    productName: string;
    missionAnchor: string;
    matchedGoals: string[];
    matchedPrinciples: string[];
    contextNotes: string[];
  } | null | undefined;
  designBlueprint: {
    designTheme: string;
    valueNarrative: string;
    targetUsers: string[];
    coreScenarios: string[];
    proposedMilestones: string[];
  } | null | undefined;
  suggestedAnswers: Array<{
    questionId: string;
    answer: string;
    reason: string;
  }> | null | undefined;
  requirementContract: {
    objective: string;
    inScope: string[];
    outOfScope: string[];
    acceptanceCriteria: string[];
    artifacts: string[];
    designTheme?: string;
    valueNarrative?: string;
  } | null | undefined;
  discussion: IssueDiscussionItem[];
  discussionDraft: IssueDiscussionItem[];
  provenance: IssueContentProvenance;
}) {
  if (input.provenance.formalReady) {
    return {
      summary: input.fallbackSummary,
      refinement: input.refinement ?? {
        problemStatement: "",
        expectedOutcome: "",
        inScopeDraft: [],
        outOfScopeDraft: [],
        acceptanceDraft: []
      },
      contextAlignment: input.contextAlignment ?? {
        productName: "",
        missionAnchor: "",
        matchedGoals: [],
        matchedPrinciples: [],
        contextNotes: []
      },
      designBlueprint: input.designBlueprint ?? {
        designTheme: "",
        valueNarrative: "",
        targetUsers: [],
        coreScenarios: [],
        proposedMilestones: []
      },
      suggestedAnswers: input.suggestedAnswers ?? [],
      requirementContract: input.requirementContract ?? {
        objective: "",
        inScope: [],
        outOfScope: [],
        acceptanceCriteria: [],
        artifacts: []
      },
      discussion: input.discussion,
      discussionDraft: input.discussionDraft
    };
  }

  const pendingMessage = input.provenance.note;
  return {
    summary: buildPendingSummary(input.rawInput, input.fallbackSummary),
    refinement: {
      problemStatement: pendingMessage,
      expectedOutcome: pendingMessage,
      inScopeDraft: [],
      outOfScopeDraft: [],
      acceptanceDraft: []
    },
    contextAlignment: {
      productName: input.contextAlignment?.productName ?? "",
      missionAnchor: pendingMessage,
      matchedGoals: [],
      matchedPrinciples: [],
      contextNotes: [pendingMessage]
    },
    designBlueprint: {
      designTheme: "待模型正式结论",
      valueNarrative: pendingMessage,
      targetUsers: [],
      coreScenarios: [],
      proposedMilestones: []
    },
    suggestedAnswers: [],
    requirementContract: {
      objective: pendingMessage,
      inScope: [],
      outOfScope: [],
      acceptanceCriteria: [],
      artifacts: input.requirementContract?.artifacts ?? []
    },
    discussion: [],
    discussionDraft: []
  };
}

function buildIssueAnalysisGate(input: {
  runtime: Awaited<ReturnType<typeof getRuntimeStatus>>;
  debateStatus?: IssueDebateTaskStatus | null;
  debate?: { mode?: string | null } | null;
  shouldCreateDebateTask: boolean;
}): IssueAnalysisGate {
  const checks: IssueAnalysisGateCheck[] = [];

  const runtimeReady = input.runtime.mode !== "scripted";
  checks.push({
    id: "runtime-real-model",
    label: "运行时必须启用真实模型",
    passed: runtimeReady,
    detail: runtimeReady
      ? `当前运行模式为 ${input.runtime.mode}，可用于真实多角色讨论。`
      : "当前运行模式仍为 scripted，讨论输出可能是模板/降级结果。"
  });

  const debateEnabled = input.shouldCreateDebateTask;
  checks.push({
    id: "debate-enabled",
    label: "必须启用真实多角色讨论",
    passed: debateEnabled,
    detail: debateEnabled
      ? "已创建真实多角色讨论任务。"
      : "当前分析未启用真实多角色讨论，不能以草稿提示替代正式结论。"
  });

  const debateCompleted = input.debate?.mode === "model";
  const debateStatusLabel = input.debateStatus ?? "missing";
  checks.push({
    id: "debate-model-completed",
    label: "正式讨论必须由真实模型完成",
    passed: debateCompleted,
    detail: debateCompleted
      ? "真实模型多角色讨论已完成，可作为正式分析结论。"
      : debateStatusLabel === "queued" || debateStatusLabel === "running"
        ? "真实模型多角色讨论仍在进行中，需等待完成后再推进。"
        : debateStatusLabel === "failed"
          ? "真实模型多角色讨论执行失败，当前阶段已阻断。"
          : input.debate
            ? "当前仅得到降级/scripted 讨论结果，不能作为正式分析结论。"
            : "尚未产生真实模型多角色讨论结果。"
  });

  return {
    canProceed: checks.every((item) => item.passed),
    blockers: checks.filter((item) => !item.passed).map((item) => item.detail),
    checks,
    runtimeMode: input.runtime.mode,
    requestedRuntimeMode: String(input.runtime.requestedMode ?? input.runtime.mode)
  };
}

function createDebateTaskId(issueId: string) {
  return `debate-${issueId}-${randomUUID().slice(0, 8)}`;
}

function startIssueDebateTask(input: {
  taskId: string;
  issueId: string;
  rawInput: string;
  title: string;
  summary: string;
  workflowTemplateKey: string;
  industryCode: string;
  recommendedRoleIds: RoleType[];
  soulRoleId: RoleType;
  fallbackDiscussion: IssueDiscussionItem[];
}) {
  const startedAt = nowIso();
  const queuedState: DebateTaskState = {
    taskId: input.taskId,
    issueId: input.issueId,
    status: "queued",
    createdAt: startedAt,
    updatedAt: startedAt,
    debate: null,
    discussion: [],
    discussionDraft: input.fallbackDiscussion
  };
  issueDebateTaskStore.set(input.taskId, queuedState);
  issueLatestDebateTask.set(input.issueId, input.taskId);

  void (async () => {
    const runningAt = nowIso();
    issueDebateTaskStore.set(input.taskId, {
      ...queuedState,
      status: "running",
      updatedAt: runningAt
    });

    await updateIssue(input.issueId, (current) => ({
      ...current,
      debateStatus: "running",
      debateTaskId: input.taskId,
      debateError: "",
      debateUpdatedAt: runningAt
    }));

    try {
      const debate = await buildIssueRoleDebate({
        input: input.rawInput,
        title: input.title,
        summary: input.summary,
        recommendedRoleIds: input.recommendedRoleIds,
        soulRoleId: input.soulRoleId,
        industryCode: input.industryCode
      });
      const discussion = toDiscussionFromDebate(debate, input.fallbackDiscussion);
      const formalDiscussion = debate.mode === "model" ? discussion : [];
      const draftIssue = await getIssue(input.issueId);
      const synthesized = debate.mode === "model"
        && draftIssue?.refinement
        && draftIssue.contextAlignment
        && draftIssue.designBlueprint
        && draftIssue.suggestedAnswers
        && draftIssue.requirementContract
        ? synthesizeIssueArtifactsFromDebate({
            rawInput: input.rawInput,
            productContext: await getProductContext(),
            industryCode: input.industryCode,
            questions: draftIssue.questions,
            expectedArtifacts: buildExpectedArtifacts(input.workflowTemplateKey),
            draft: {
              summary: draftIssue.summary,
              refinement: draftIssue.refinement,
              contextAlignment: draftIssue.contextAlignment,
              designBlueprint: draftIssue.designBlueprint,
              suggestedAnswers: draftIssue.suggestedAnswers,
              requirementContract: draftIssue.requirementContract
            },
            debate
          })
        : null;
      const completedAt = nowIso();
      issueDebateTaskStore.set(input.taskId, {
        taskId: input.taskId,
        issueId: input.issueId,
        status: "completed",
        createdAt: startedAt,
        updatedAt: completedAt,
        debate,
        discussion: formalDiscussion,
        discussionDraft: input.fallbackDiscussion
      });

      await updateIssue(input.issueId, (current) => ({
        ...current,
        summary: synthesized?.summary ?? current.summary,
        refinement: synthesized?.refinement ?? current.refinement,
        contextAlignment: synthesized?.contextAlignment ?? current.contextAlignment,
        designBlueprint: synthesized?.designBlueprint ?? current.designBlueprint,
        suggestedAnswers: synthesized?.suggestedAnswers ?? current.suggestedAnswers,
        requirementContract: synthesized?.requirementContract ?? current.requirementContract,
        discussion: formalDiscussion,
        discussionDraft: input.fallbackDiscussion,
        debate,
        debateStatus: "completed",
        debateTaskId: input.taskId,
        debateError: "",
        debateUpdatedAt: completedAt
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Issue debate task failed";
      const failedAt = nowIso();
      issueDebateTaskStore.set(input.taskId, {
        taskId: input.taskId,
        issueId: input.issueId,
        status: "failed",
        createdAt: startedAt,
        updatedAt: failedAt,
        debate: null,
        discussion: [],
        discussionDraft: input.fallbackDiscussion,
        error: message
      });

      await updateIssue(input.issueId, (current) => ({
        ...current,
        discussion: [],
        discussionDraft: input.fallbackDiscussion,
        debate: current.debate ?? null,
        debateStatus: "failed",
        debateTaskId: input.taskId,
        debateError: message,
        debateUpdatedAt: failedAt
      }));
    }
  })();
}

export function createIssuesRouter(options: CreateIssuesRouterOptions = {}) {
  const router = express.Router();

  router.get("/", asyncRoute(async (req, res) => {
    const status = String(req.query.status ?? "").trim().toLowerCase();
    const data = await listIssues(
      status === "draft" || status === "confirmed" || status === "cancelled"
        ? status
        : undefined
    );
    sendSuccess(res, data);
  }));

  router.get("/:issueId/debate", asyncRoute(async (req, res) => {
    const issueId = String(req.params.issueId ?? "").trim();
    const issue = await getIssue(issueId);
    if (!issue) {
      sendError(res, 404, "NOT_FOUND", `Issue not found: ${issueId}`);
      return;
    }

    const requestedTaskId = String(req.query.taskId ?? "").trim();
    const taskId = requestedTaskId || issueLatestDebateTask.get(issueId) || issue.debateTaskId || "";
    let task = taskId ? issueDebateTaskStore.get(taskId) : null;
    if (task && task.issueId !== issueId) {
      sendError(res, 400, "VALIDATION_ERROR", "taskId does not belong to the issue");
      return;
    }

    if (task && (task.status === "queued" || task.status === "running") && isDebateTaskStale(task)) {
      const failedAt = nowIso();
      const timeoutMessage = "真实多角色讨论任务长时间未完成，已自动标记超时失败，请重新发起讨论。";
      task = {
        ...task,
        status: "failed",
        updatedAt: failedAt,
        error: timeoutMessage
      };
      issueDebateTaskStore.set(taskId, task);
      await updateIssue(issueId, (current) => ({
        ...current,
        debateStatus: "failed",
        debateTaskId: taskId,
        debateError: timeoutMessage,
        debateUpdatedAt: failedAt
      }));
    }

    const status: IssueDebateTaskStatus = task?.status
      ?? issue.debateStatus
      ?? (issue.debate ? "completed" : "failed");
    const discussion = task?.discussion?.length ? task.discussion : (issue.discussion ?? []);
    const discussionDraft = task?.discussionDraft?.length ? task.discussionDraft : (issue.discussionDraft ?? []);
    const debate = task?.debate ?? issue.debate ?? null;
    const error = task?.error || issue.debateError || "";
    const runtime = await getRuntimeStatus();
    const analysisGate = buildIssueAnalysisGate({
      runtime,
      debateStatus: status,
      debate,
      shouldCreateDebateTask: Boolean(issue.debateTaskId)
    });
    const contentProvenance = buildIssueContentProvenance({
      status,
      debate
    });
    const publicContent = resolveIssuePublicContent({
      rawInput: issue.rawInput,
      fallbackSummary: issue.summary,
      refinement: issue.refinement ?? null,
      contextAlignment: issue.contextAlignment ?? null,
      designBlueprint: issue.designBlueprint ?? null,
      suggestedAnswers: issue.suggestedAnswers ?? [],
      requirementContract: issue.requirementContract ?? null,
      discussion,
      discussionDraft,
      provenance: contentProvenance
    });

    sendSuccess(res, {
      issueId,
      taskId: taskId || null,
      status,
      summary: publicContent.summary,
      refinement: publicContent.refinement,
      contextAlignment: publicContent.contextAlignment,
      designBlueprint: publicContent.designBlueprint,
      suggestedAnswers: publicContent.suggestedAnswers,
      requirementContract: publicContent.requirementContract,
      discussion: publicContent.discussion,
      discussionDraft: publicContent.discussionDraft,
      debate,
      contentProvenance,
      analysisGate,
      error: error || null,
      updatedAt: task?.updatedAt || issue.debateUpdatedAt || issue.updatedAt,
      pollAfterMs: status === "queued" || status === "running" ? ISSUE_DEBATE_POLL_AFTER_MS : 0
    });
  }));

  router.get("/:issueId", asyncRoute(async (req, res) => {
    const issueId = String(req.params.issueId ?? "").trim();
    const issue = await getIssue(issueId);
    if (!issue) {
      sendError(res, 404, "NOT_FOUND", `Issue not found: ${issueId}`);
      return;
    }
    sendSuccess(res, issue);
  }));

  router.post("/preview", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    const payload = (req.body ?? {}) as PreviewIssueBody;
    const input = String(payload.input ?? "").trim();
    const industryCode = String(payload.industryCode ?? "").trim().toLowerCase();
    const sourceType = normalizeSourceType(payload.sourceType);
    const debateMode = normalizeDebateMode(payload.debateMode);
    const workflowTemplateKeyRaw = String(payload.workflowTemplateKey ?? "").trim().toLowerCase();
    const workflowTemplateKey = resolveIssueWorkflowTemplateKey(payload.workflowTemplateKey);
    const enforceIndustryAssemblyRule = workflowTemplateKeyRaw === "none";
    const hasWorkflowTemplate = !enforceIndustryAssemblyRule;

    if (!input) {
      sendError(res, 400, "VALIDATION_ERROR", "input is required");
      return;
    }

    const resolvedIndustryCode = industryCode || detectIndustry(input) || "saas";
    const config = getIndustryConfig(resolvedIndustryCode)
      ?? getIndustryConfig("saas")
      ?? listIndustryConfigs()[0];
    if (!config) {
      sendError(res, 503, "SERVICE_UNAVAILABLE", "No industry role sets configured");
      return;
    }

    const productContext = await getProductContext();
    const title = inferIssueTitle(input);
    const summary = inferIssueSummary(input);
    const conflicts = detectConflicts(input, productContext, {
      industryCode: config.roleSet.industryCode
    });
    const questions = buildClarificationQuestions(input);
    const refinement = buildRequirementRefinement(input);
    const contextAlignment = buildContextAlignment(input, productContext, {
      industryCode: config.roleSet.industryCode
    });
    const designBlueprint = buildDesignBlueprint({
      rawInput: input,
      refinement,
      alignment: contextAlignment
    });
    const recommendedRoleIds = applyTemplateRolePlan({
      recommendedRoleIds: recommendRoles(input, config),
      workflowTemplateKey,
      mustHaveSoulRole: config.assemblyRule.mustHaveSoulRole,
      soulRoleId: config.assemblyRule.soulRoleId,
      enforceIndustryAssemblyRule
    });
    const ruleDiscussion = buildIssueDiscussion(
      input,
      recommendedRoleIds as RoleType[],
      config.assemblyRule.soulRoleId,
      { includeSoulRole: enforceIndustryAssemblyRule }
    );
    const discussion = ruleDiscussion;
    const suggestedAnswers = buildSuggestedAnswers({
      rawInput: input,
      questions,
      refinement,
      alignment: contextAlignment,
      industryCode: config.roleSet.industryCode,
      discussion
    });
    const relatedHistory = buildRelatedHistory(input, productContext.requirementHistory ?? []);
    const expectedArtifacts = hasWorkflowTemplate ? buildExpectedArtifacts(workflowTemplateKey) : [];
    const requirementContract = buildRequirementContract({
      suggestedAnswers,
      refinement,
      designBlueprint,
      expectedArtifacts
    });
    const shouldCreateDebateTask = debateMode !== "off";
    const debateTaskId = shouldCreateDebateTask ? createDebateTaskId(`issue-${Date.now()}`) : undefined;
    const debateStatus: IssueDebateTaskStatus = shouldCreateDebateTask ? "queued" : "completed";
    const runtime = await getRuntimeStatus();
    const analysisGate = buildIssueAnalysisGate({
      runtime,
      debateStatus,
      debate: null,
      shouldCreateDebateTask
    });

    const issue = await createIssueDraft({
      title,
      sourceType,
      rawInput: input,
      industryCode: config.roleSet.industryCode,
      summary,
      recommendedRoleIds,
      soulRoleId: config.assemblyRule.soulRoleId,
      conflicts,
      questions,
      refinement,
      contextAlignment,
      designBlueprint,
      suggestedAnswers,
      relatedHistory,
      requirementContract,
      discussion: [],
      discussionDraft: discussion,
      debate: null,
      debateStatus,
      debateTaskId,
      debateError: "",
      debateUpdatedAt: nowIso()
    });

    const activeDebateTaskId = shouldCreateDebateTask
      ? issue.debateTaskId || createDebateTaskId(issue.id)
      : undefined;
    if (shouldCreateDebateTask && activeDebateTaskId) {
      startIssueDebateTask({
        taskId: activeDebateTaskId,
        issueId: issue.id,
        rawInput: input,
        title,
        summary,
        workflowTemplateKey,
        industryCode: config.roleSet.industryCode,
        recommendedRoleIds: recommendedRoleIds as RoleType[],
        soulRoleId: config.assemblyRule.soulRoleId,
        fallbackDiscussion: ruleDiscussion
      });
    }
    const contentProvenance = buildIssueContentProvenance({
      status: debateStatus,
      debate: null
    });
    const publicContent = resolveIssuePublicContent({
      rawInput: input,
      fallbackSummary: issue.summary,
      refinement: issue.refinement ?? null,
      contextAlignment: issue.contextAlignment ?? null,
      designBlueprint: issue.designBlueprint ?? null,
      suggestedAnswers: issue.suggestedAnswers ?? [],
      requirementContract: issue.requirementContract ?? null,
      discussion: [],
      discussionDraft: discussion,
      provenance: contentProvenance
    });

    sendSuccess(res, {
      issueId: issue.id,
      title: issue.title,
      summary: publicContent.summary,
      industryCode: issue.industryCode,
      recommendedRoleIds: issue.recommendedRoleIds,
      soulRoleId: issue.soulRoleId,
      conflicts: issue.conflicts,
      questions: issue.questions,
      contextAlignment: publicContent.contextAlignment,
      designBlueprint: publicContent.designBlueprint,
      suggestedAnswers: publicContent.suggestedAnswers,
      relatedHistory,
      requirementContract: publicContent.requirementContract,
      refinement: publicContent.refinement,
      discussion: publicContent.discussion,
      discussionDraft: publicContent.discussionDraft,
      debate: null,
      debateTask: activeDebateTaskId
        ? {
            taskId: activeDebateTaskId,
            status: "queued" as const,
            pollAfterMs: ISSUE_DEBATE_POLL_AFTER_MS
          }
        : null,
      contentProvenance,
      analysisGate,
      expectedArtifacts,
      workflow: hasWorkflowTemplate ? buildIssueWorkflowSop(workflowTemplateKey) : null
    });
  }));

  router.post("/:issueId/confirm", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    const issueId = String(req.params.issueId ?? "").trim();
    const payload = (req.body ?? {}) as ConfirmIssueBody;
    const issue = await getIssue(issueId);

    if (!issue) {
      sendError(res, 404, "NOT_FOUND", `Issue not found: ${issueId}`);
      return;
    }

    if (issue.status === "confirmed" && issue.createdProjectId) {
      sendSuccess(res, issue);
      return;
    }

    const config = getIndustryConfig(issue.industryCode) ?? listIndustryConfigs()[0];
    if (!config) {
      sendError(res, 503, "SERVICE_UNAVAILABLE", "No industry role sets configured");
      return;
    }

    const clarificationAnswers = normalizeStringMap(payload.clarificationAnswers);
    const conflictResolution = String(payload.conflictResolution ?? "").trim();
    const projectType = normalizeProjectType(payload.projectType);
    const parentProjectId = String(payload.parentProjectId ?? "").trim() || undefined;
    const relaySourceStageId = String(payload.relaySourceStageId ?? "").trim() || undefined;
    const userProjectInputs = normalizeProjectInputs(payload.projectInputs);
    const workflowTemplateKeyRaw = String(payload.workflowTemplateKey ?? "").trim();
    const workflowTemplateKey = workflowTemplateKeyRaw || undefined;
    const enforceIndustryAssemblyRule = workflowTemplateKeyRaw.toLowerCase() === "none";
    const autoStartWorkflow = normalizeOptionalBoolean(payload.autoStartWorkflow);
    if (projectType === "relay" && !parentProjectId) {
      sendError(res, 400, "VALIDATION_ERROR", "relay mode requires parentProjectId");
      return;
    }
    if (!isProjectModeTemplateCompatible({ projectType, workflowTemplateKey })) {
      const message = projectType === "complete"
        ? "workflowTemplateKey must be standard_software_development or none when projectType=complete"
        : "workflowTemplateKey must be one of requirements_design/visual_design/tech_design/code_dev/qa_acceptance/none for standalone or relay projectType";
      sendError(res, 400, "VALIDATION_ERROR", message);
      return;
    }
    const requiredQuestions = issue.questions.filter((question) => question.required);
    const missingRequired = requiredQuestions.find((question) => !String(clarificationAnswers[question.id] ?? "").trim());
    if (missingRequired) {
      sendError(res, 400, "VALIDATION_ERROR", `missing required clarification: ${missingRequired.id}`);
      return;
    }
    const hasCriticalConflict = issue.conflicts.some((conflict) => conflict.severity === "critical");
    const hasSceneValidationFailure = issue.conflicts.some((conflict) => conflict.id === "crossborder-scene-not-hit");
    if (hasSceneValidationFailure) {
      sendError(res, 400, "VALIDATION_ERROR", "场景命中校验未通过：请补充跨境选品/跟品关键词后重新分析。");
      return;
    }
    if (hasCriticalConflict && !conflictResolution) {
      sendError(res, 400, "VALIDATION_ERROR", "missing required conflict resolution");
      return;
    }
    const hasMismatchConflict = issue.conflicts.some((conflict) => conflict.id === "unresolved-requirement-mismatch");
    if (hasMismatchConflict && conflictResolution) {
      await resolveRequirementMismatches({
        resolution: conflictResolution,
        limit: 3
      });
    }

    const runtime = await getRuntimeStatus();
    const analysisGate = buildIssueAnalysisGate({
      runtime,
      debateStatus: issue.debateStatus ?? null,
      debate: issue.debate ?? null,
      shouldCreateDebateTask: Boolean(issue.debateTaskId)
    });
    if (!analysisGate.canProceed) {
      res.status(409).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: analysisGate.blockers[0] || "分析阶段尚未满足推进条件。",
          analysisGate
        }
      });
      return;
    }
    const requestedTeamRoleIds = normalizeRoleList(payload.teamRoleIds);
    const selectedRoleIds = requestedTeamRoleIds.length > 0
      ? requestedTeamRoleIds
      : issue.recommendedRoleIds.filter((roleId): roleId is RoleType => ROLE_IDS.includes(roleId as RoleType));
    const allowedRoleSet = new Set(config.roleSet.roleIds);
    const constrainedRoleIds = selectedRoleIds.filter((roleId) => allowedRoleSet.has(roleId));

    if (enforceIndustryAssemblyRule && config.assemblyRule.mustHaveSoulRole && !constrainedRoleIds.includes(config.assemblyRule.soulRoleId)) {
      constrainedRoleIds.unshift(config.assemblyRule.soulRoleId);
    }

    const finalName = String(payload.finalName ?? issue.title).trim() || issue.title;
    const finalDescription = String(payload.finalDescription ?? issue.rawInput).trim() || issue.rawInput;
    const clarificationBlock = Object.entries(clarificationAnswers)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
    const conflictResolutionBlock = conflictResolution ? `\n冲突解决说明:\n${conflictResolution}` : "";
    const projectDescription = clarificationBlock
      ? `${finalDescription}\n\n澄清补充:\n${clarificationBlock}${conflictResolutionBlock}`
      : finalDescription;
    const confirmedContract = {
      objective: clarificationAnswers.goal || issue.requirementContract?.objective || "",
      inScope: clarificationAnswers.scope
        ? [clarificationAnswers.scope, ...(issue.requirementContract?.inScope ?? [])]
        : issue.requirementContract?.inScope ?? [],
      outOfScope: issue.requirementContract?.outOfScope ?? [],
      acceptanceCriteria: clarificationAnswers.acceptance
        ? [clarificationAnswers.acceptance, ...(issue.requirementContract?.acceptanceCriteria ?? [])]
        : issue.requirementContract?.acceptanceCriteria ?? [],
      artifacts: issue.requirementContract?.artifacts ?? [],
      designTheme: issue.requirementContract?.designTheme,
      valueNarrative: issue.requirementContract?.valueNarrative
    };
    const requirementContractBlock = [
      "需求确认单:",
      `- 目标: ${confirmedContract.objective || "信息未提供"}`,
      `- In Scope: ${(confirmedContract.inScope || []).slice(0, 3).join("；") || "信息未提供"}`,
      `- Out of Scope: ${(confirmedContract.outOfScope || []).slice(0, 3).join("；") || "信息未提供"}`,
      `- 验收: ${(confirmedContract.acceptanceCriteria || []).slice(0, 3).join("；") || "信息未提供"}`,
      `- 产出: ${(confirmedContract.artifacts || []).join("、") || "信息未提供"}`
    ].join("\n");
    const finalProjectDescription = `${projectDescription}\n\n${requirementContractBlock}`;
    const parsedIntent = buildParsedIntentFromIssue({
      issue,
      selectedRoleIds: constrainedRoleIds,
      clarificationAnswers,
      conflictResolution
    });

    const project = await createProject(
      {
        name: finalName,
        description: finalProjectDescription,
        team: constrainedRoleIds,
        projectType,
        parentProjectId,
        relaySourceStageId,
        projectInputs: userProjectInputs,
        requirementContract: confirmedContract,
        parsedIntent,
        workflowTemplateKey,
        autoStartWorkflow
      },
      runtime.mode
    );

    const updated = await updateIssue(issueId, (current) => ({
      ...current,
      clarificationAnswers,
      conflictResolution,
      requirementContract: confirmedContract,
      status: "confirmed",
      createdProjectId: project.id
    }));

    await appendRequirementBackfill({
      issueId: issue.id,
      projectId: project.id,
      title: finalName,
      refinedRequirement: finalProjectDescription,
      status: "in_progress",
      validationStatus: "pending",
      requirementContract: confirmedContract
    });
    void runProjectPostCreatePrep({
      projectId: project.id,
      issue: updated,
      triggeredBy: "issue_confirm_async"
    }).catch((error) => {
      console.warn(
        `[issue] post-create prep failed for project ${project.id}:`,
        error instanceof Error ? error.message : String(error)
      );
    });

    await options.onProjectCreated?.(project.id);
    sendSuccess(res, {
      issue: updated,
      project,
      backfill: {
        summary: `需求已落地为项目 ${project.name}，并写入团队角色编排。`,
        teamRoleIds: constrainedRoleIds
      }
    });
  }));

  router.post("/:issueId/cancel", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    const issueId = String(req.params.issueId ?? "").trim();
    const updated = await updateIssue(issueId, (current) => ({
      ...current,
      status: "cancelled"
    }));

    if (!updated) {
      sendError(res, 404, "NOT_FOUND", `Issue not found: ${issueId}`);
      return;
    }

    sendSuccess(res, updated);
  }));

  return router;
}
