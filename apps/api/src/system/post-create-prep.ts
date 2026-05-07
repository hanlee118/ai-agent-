import type { RoleType } from "@occ/shared";
import { prisma } from "../db.js";
import { getRuntimeStatus } from "../agents/runtime.js";
import {
  buildClarificationQuestions,
  buildContextAlignment,
  buildDesignBlueprint,
  buildExpectedArtifacts,
  buildIssueDiscussion,
  buildRequirementContract,
  buildRequirementRefinement,
  buildSuggestedAnswers,
  detectIndustry,
  inferIssueTitle,
  inferIssueSummary,
  synthesizeIssueArtifactsFromDebate
} from "./issue-engine.js";
import { buildIssueRoleDebate } from "./issue-debate.js";
import {
  getIssueByProjectId,
  getProductContext,
  type IssueRecord
} from "./v1-method-store.js";

const DISCUSSION_SECTION_TITLE = "## 多Agent需求讨论结论";
const ANALYSIS_SECTION_TITLE = "## 项目详情理解确认草案";
const PREP_CONFIRM_SECTION_TITLE = "## 预备阶段用户确认";
const REQUIRED_INPUT_NAMES = ["rawRequirements", "prd", "debateSummary"] as const;
const PREP_DISCUSSION_TRACE_INPUT_NAME = "prepDiscussionTrace";
const PREP_FEEDBACK_INPUT_NAME = "prepUserFeedback";
const PREP_DISCUSSION_ROLE_IDS: RoleType[] = [
  "ROLE_PM",
  "ROLE_ANALYST",
  "ROLE_PRODUCT",
  "ROLE_DESIGN",
  "ROLE_ARCH",
  "ROLE_DEV",
  "ROLE_QA"
];
const PREP_SOUL_ROLE_ID: RoleType = "ROLE_ANALYST";

type ProjectInputLike = {
  id?: string;
  name: string;
  content?: string | null;
  description?: string | null;
  inputSource?: string | null;
  updatedAt?: Date | string | null;
};

type ProjectPostCreatePrepSource = {
  projectId: string;
  projectDescription: string;
  projectType: string;
  issue: IssueRecord | null;
};

type PrepIssueLike = Pick<
IssueRecord,
| "rawInput"
| "summary"
| "requirementContract"
| "discussion"
| "discussionDraft"
| "debate"
| "refinement"
| "designBlueprint"
>;

export type ProjectPostCreatePrepStatus = {
  required: boolean;
  completed: boolean;
  missingItems: string[];
  draft?: {
    discussion: string;
    analysis: string;
    rawRequirements: string;
    prd: string;
    debateSummary: string;
    discussionTrace: string;
    feedback: string;
    confirmed: boolean;
    confirmedBy?: string;
    confirmedAt?: string;
    confirmationNotes?: string;
  };
};

function sanitizeLine(value: string, fallback = "待补充") {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function normalizeKey(value: string) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function escapeRegExp(value: string) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractMarkdownSection(body: string, sectionTitle: string) {
  const source = String(body || "");
  if (!source.trim()) {
    return "";
  }
  const pattern = new RegExp(`${escapeRegExp(sectionTitle)}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "i");
  const matched = source.match(pattern);
  return String(matched?.[1] || "").trim();
}

function upsertMarkdownSection(body: string, sectionTitle: string, sectionContent: string) {
  const source = String(body || "").trim();
  const content = String(sectionContent || "").trim();
  const nextSection = `${sectionTitle}\n\n${content}`;
  if (!source) {
    return nextSection;
  }
  const pattern = new RegExp(`${escapeRegExp(sectionTitle)}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "i");
  if (pattern.test(source)) {
    return source.replace(pattern, `${nextSection}\n`);
  }
  return `${source}\n\n${nextSection}`;
}

function dedupeLines(values: string[], fallback: string) {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const value of values) {
    const normalized = sanitizeLine(value, "");
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    items.push(normalized);
  }
  return items.length > 0 ? items : [fallback];
}

function parsePrepConfirmation(sectionBody: string) {
  const source = String(sectionBody || "");
  const confirmed = /状态\s*[:：]\s*(已确认|通过|confirmed|pass)/i.test(source);
  const confirmedBy = source.match(/确认人\s*[:：]\s*(.+)/i)?.[1]?.trim() || undefined;
  const confirmedAt = source.match(/确认时间\s*[:：]\s*(.+)/i)?.[1]?.trim() || undefined;
  const confirmationNotes = source.match(/备注\s*[:：]\s*(.+)/i)?.[1]?.trim() || undefined;
  return {
    confirmed,
    confirmedBy,
    confirmedAt,
    confirmationNotes
  };
}

function buildPrepConfirmationSection(input: {
  confirmedBy?: string;
  notes?: string;
  timestamp?: Date;
}) {
  const confirmedBy = sanitizeLine(input.confirmedBy || "项目负责人");
  const confirmedAt = (input.timestamp || new Date()).toISOString();
  const notes = sanitizeLine(input.notes || "已审阅多Agent讨论结论与回填输入，确认可进入正式执行。");
  return [
    PREP_CONFIRM_SECTION_TITLE,
    "",
    "- 状态: 已确认",
    `- 确认人: ${confirmedBy}`,
    `- 确认时间: ${confirmedAt}`,
    `- 备注: ${notes}`
  ].join("\n");
}

function getInputSourcePriority(source: string | null | undefined) {
  const normalized = String(source || "").trim().toLowerCase();
  if (normalized === "manual") {
    return 3;
  }
  if (normalized === "imported_from_project") {
    return 2;
  }
  if (normalized === "template_generated") {
    return 1;
  }
  return 0;
}

function toTimestamp(value: Date | string | null | undefined) {
  if (value instanceof Date) {
    return value.getTime();
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickBestProjectInputByName(projectInputs: ProjectInputLike[], inputName: string) {
  const key = normalizeKey(inputName);
  const candidates = projectInputs.filter((item) => normalizeKey(item.name) === key);
  if (candidates.length <= 0) {
    return undefined;
  }
  return [...candidates].sort((left, right) => {
    const sourceDelta = getInputSourcePriority(right.inputSource) - getInputSourcePriority(left.inputSource);
    if (sourceDelta !== 0) {
      return sourceDelta;
    }
    const contentDelta = Number(Boolean(String(right.content || "").trim())) - Number(Boolean(String(left.content || "").trim()));
    if (contentDelta !== 0) {
      return contentDelta;
    }
    return toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt);
  })[0];
}

function getInputContentByName(projectInputs: ProjectInputLike[], inputName: string) {
  const target = pickBestProjectInputByName(projectInputs, inputName);
  return String(target?.content || "").trim();
}

function buildPrepDraftSnapshot(input: {
  description: string;
  projectInputs: ProjectInputLike[];
}) {
  const discussion = extractMarkdownSection(input.description, DISCUSSION_SECTION_TITLE);
  const analysis = extractMarkdownSection(input.description, ANALYSIS_SECTION_TITLE);
  const confirmation = parsePrepConfirmation(extractMarkdownSection(input.description, PREP_CONFIRM_SECTION_TITLE));
  return {
    discussion,
    analysis,
    rawRequirements: getInputContentByName(input.projectInputs, "rawRequirements"),
    prd: getInputContentByName(input.projectInputs, "prd"),
    debateSummary: getInputContentByName(input.projectInputs, "debateSummary"),
    discussionTrace: getInputContentByName(input.projectInputs, PREP_DISCUSSION_TRACE_INPUT_NAME),
    feedback: getInputContentByName(input.projectInputs, PREP_FEEDBACK_INPUT_NAME),
    ...confirmation
  };
}

function hasStructuredPrepDiscussion(source: string) {
  const text = String(source || "").trim();
  if (!text) {
    return false;
  }
  return /###\s*共识/i.test(text)
    && /###\s*分歧与处理/i.test(text)
    && /###\s*角色决策建议/i.test(text)
    && /###\s*决策锚点/i.test(text);
}

function inspectPrepDiscussionTrace(source: string) {
  const text = String(source || "").replace(/\r\n/g, "\n").trim();
  if (!text) {
    return {
      hasTrace: false,
      roleCount: 0,
      hasModelRound: false
    };
  }
  const roleMatches = Array.from(
    text.matchAll(/###\s*\d+\.\s*.*\((ROLE_[A-Z_]+)\)/g)
  );
  const roleSet = new Set(
    roleMatches.map((item) => String(item[1] || "").trim()).filter(Boolean)
  );
  const hasModelRound = /-\s*模式[:：]\s*model\b/i.test(text)
    || /-\s*debateMode:\s*model\b/i.test(text);
  return {
    hasTrace: true,
    roleCount: roleSet.size,
    hasModelRound
  };
}

function parseBooleanEnvFlag(value: string | undefined, defaultValue: boolean) {
  if (typeof value !== "string") {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function shouldEnforcePrepModelRound() {
  const envOverride = process.env.PREP_DISCUSSION_ENFORCE_MODEL_ROUND;
  if (typeof envOverride === "string" && envOverride.trim()) {
    return parseBooleanEnvFlag(envOverride, false);
  }
  const runtimeMode = String(process.env.RUNTIME_MODE || "").trim().toLowerCase();
  const nodeEnv = String(process.env.NODE_ENV || "").trim().toLowerCase();
  if (runtimeMode === "scripted" || nodeEnv === "test") {
    return false;
  }
  return true;
}

function normalizePrepDocumentByName(
  name: string,
  content: string | undefined,
  fallback?: {
    discussion?: string;
    analysis?: string;
    requirement?: string;
    trace?: string;
  }
) {
  const normalizedName = normalizeKey(name);
  const text = String(content || "").replace(/\r\n/g, "\n").trim();
  if (normalizedName === normalizeKey("rawRequirements")) {
    const body = text || "待补充用户原始诉求。";
    if (/^#\s*rawrequirements\b/i.test(body) && /##\s*原始需求输入/i.test(body)) {
      return body;
    }
    return [
      "# rawRequirements",
      "",
      "## 原始需求输入",
      body,
      "",
      "## 用户诉求提炼",
      "- 待补充",
      "",
      "## 输入边界说明",
      "- 本输入由预备阶段维护，供后续讨论与回填复用。"
    ].join("\n");
  }
  if (normalizedName === normalizeKey("prd")) {
    const analysis = String(fallback?.analysis || "").trim() || "待补充结构化需求草案。";
    const requirement = String(fallback?.requirement || "").trim() || "需求确认单:\n- 目标: 待补充\n- In Scope: 待补充\n- Out of Scope: 待补充\n- 验收: 待补充\n- 产出: 待补充";
    if (/^#\s*prd\b/i.test(text) && /##\s*结构化需求草案/i.test(text) && /##\s*需求确认单/i.test(text)) {
      return text;
    }
    return [
      "# prd",
      "",
      "## 结构化需求草案",
      text || analysis,
      "",
      "## 需求确认单",
      requirement
    ].join("\n");
  }
  if (normalizedName === normalizeKey("debateSummary")) {
    const body = text || String(fallback?.discussion || "").trim() || "待补充多Agent讨论结论。";
    if (/^#\s*debatesummary\b/i.test(body) && /###\s*共识/i.test(body)) {
      return body;
    }
    return [
      "# debateSummary",
      "",
      hasStructuredPrepDiscussion(body)
        ? body
        : [
          DISCUSSION_SECTION_TITLE,
          "",
          "### 共识",
          "- 待补充",
          "",
          "### 分歧与处理",
          "- 待补充",
          "",
          "### 角色决策建议",
          "- 待补充",
          "",
          "### 决策锚点",
          "- 待补充"
        ].join("\n")
    ].join("\n");
  }
  if (normalizedName === normalizeKey(PREP_DISCUSSION_TRACE_INPUT_NAME)) {
    const body = text || String(fallback?.trace || "").trim();
    if (body && /^#\s*prepdiscussiontrace\b/i.test(body) && /##\s*讨论回合记录/i.test(body)) {
      return body;
    }
    return [
      `# ${PREP_DISCUSSION_TRACE_INPUT_NAME}`,
      "",
      "- generatedAt: 未记录",
      "- triggeredBy: manual_feedback",
      "- phase: pre_stage_multi_agent_debate",
      "- debateMode: fallback",
      "- debateNote: 待补充",
      "- backfillTargets: rawRequirements, prd, debateSummary",
      "- sourceRawInput: 待补充原始需求",
      "- sourceObjective: 待补充目标",
      "",
      "## 讨论回合记录",
      "### 1. 需求分析师 (ROLE_ANALYST)",
      "- 关注: 待补充",
      "- 风险: 待补充",
      "- 建议: 待补充",
      "- 模式: fallback",
      "- 模型: heuristic",
      "- Provider: issue_engine",
      "- 耗时(ms): 0"
    ].join("\n");
  }
  if (normalizedName === normalizeKey(PREP_FEEDBACK_INPUT_NAME)) {
    const body = text || "待补充用户反馈。";
    if (/^#\s*prepuserfeedback\b/i.test(body)) {
      return body;
    }
    return [
      `# ${PREP_FEEDBACK_INPUT_NAME}`,
      "",
      "## 最新用户反馈",
      body,
      "",
      "## 期望修订点",
      "- 待补充"
    ].join("\n");
  }
  return text;
}

function normalizeProjectType(value: string) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "standalone" || normalized === "relay") {
    return normalized;
  }
  return "complete";
}

function shouldRequirePostCreatePrep(input: {
  issue: IssueRecord | null;
  projectType: string;
}) {
  if (input.issue?.status === "confirmed") {
    return true;
  }
  return normalizeProjectType(input.projectType) === "complete";
}

function removeMarkdownSection(body: string, sectionTitle: string) {
  const source = String(body || "");
  if (!source.trim()) {
    return "";
  }
  const pattern = new RegExp(`${escapeRegExp(sectionTitle)}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "i");
  return source.replace(pattern, "").trim();
}

function stripMarkdownDecorators(source: string) {
  return String(source || "")
    .replace(/\r\n/g, "\n")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripPrepGeneratedSections(source: string) {
  let next = String(source || "");
  next = removeMarkdownSection(next, DISCUSSION_SECTION_TITLE);
  next = removeMarkdownSection(next, ANALYSIS_SECTION_TITLE);
  next = removeMarkdownSection(next, PREP_CONFIRM_SECTION_TITLE);
  return stripMarkdownDecorators(next);
}

function normalizeRawInputSeed(source: string) {
  return String(source || "")
    .replace(/\r\n/g, "\n")
    .replace(/^\s*((rawrequirements|prd|debatesummary|prepdiscussiontrace)\s*[:：]?\s*)+/i, "")
    .trim();
}

function extractMarkdownSubSection(source: string, heading: string) {
  const text = String(source || "");
  if (!text.trim()) {
    return "";
  }
  const pattern = new RegExp(`##\\s*${escapeRegExp(heading)}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "i");
  const matched = text.match(pattern);
  return String(matched?.[1] || "").trim();
}

function normalizeRawRequirementsSeed(source: string) {
  const text = String(source || "");
  const explicitRawInput = extractMarkdownSubSection(text, "原始需求输入");
  return normalizeRawInputSeed(stripPrepGeneratedSections(explicitRawInput || text));
}

function hasMeaningfulPrepFeedback(source: string) {
  const text = String(source || "").replace(/\r\n/g, "\n").trim();
  if (!text) {
    return false;
  }
  const normalized = text
    .replace(/^#\s*prepuserfeedback\s*$/gim, "")
    .replace(/^##\s*最新用户反馈\s*$/gim, "")
    .replace(/^##\s*期望修订点\s*$/gim, "")
    .replace(/^\s*-\s*待补充\s*$/gim, "")
    .replace(/待补充用户反馈。?/g, "")
    .trim();
  return normalized.length > 0;
}

function extractStructuredLines(description: string, fallback: string) {
  const raw = stripMarkdownDecorators(description).replace(/\r/g, "\n");
  const chunks = raw
    .split(/\n+/)
    .flatMap((line) => line.split(/[。！？!?；;]+/))
    .map((line) => sanitizeLine(line, ""))
    .filter(Boolean);
  return dedupeLines(chunks.slice(0, 8), fallback);
}

function inferRawInputFromProject(input: {
  projectDescription: string;
  projectInputs: ProjectInputLike[];
}) {
  const rawRequirements = normalizeRawRequirementsSeed(getInputContentByName(input.projectInputs, "rawRequirements"));
  const description = normalizeRawInputSeed(stripPrepGeneratedSections(input.projectDescription));
  const prd = normalizeRawInputSeed(stripPrepGeneratedSections(getInputContentByName(input.projectInputs, "prd")));
  const debateSummary = normalizeRawInputSeed(stripPrepGeneratedSections(getInputContentByName(input.projectInputs, "debateSummary")));
  const feedback = normalizeRawInputSeed(stripPrepGeneratedSections(getInputContentByName(input.projectInputs, PREP_FEEDBACK_INPUT_NAME)));
  const candidates = [rawRequirements, description, prd, debateSummary, feedback]
    .map((item) => sanitizeLine(item, ""))
    .filter(Boolean);
  return candidates[0] || "待补充原始需求";
}

function normalizeIntentSeed(source: string) {
  return String(source || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}\p{Script=Han}]+/gu, "")
    .trim();
}

function intentBigrams(source: string) {
  const normalized = normalizeIntentSeed(source);
  if (normalized.length <= 1) {
    return normalized ? [normalized] : [];
  }
  const grams: string[] = [];
  for (let index = 0; index < normalized.length - 1; index += 1) {
    grams.push(normalized.slice(index, index + 2));
  }
  return Array.from(new Set(grams));
}

function isLikelySameIntent(left: string, right: string) {
  const a = normalizeIntentSeed(left);
  const b = normalizeIntentSeed(right);
  if (!a || !b) {
    return false;
  }
  if (Math.min(a.length, b.length) >= 16 && (a.includes(b) || b.includes(a))) {
    return true;
  }
  const aGrams = intentBigrams(a);
  const bGrams = intentBigrams(b);
  if (aGrams.length <= 0 || bGrams.length <= 0) {
    return false;
  }
  const bSet = new Set(bGrams);
  let intersection = 0;
  for (const gram of aGrams) {
    if (bSet.has(gram)) {
      intersection += 1;
    }
  }
  const union = new Set([...aGrams, ...bGrams]).size;
  return union > 0 ? (intersection / union) >= 0.35 : false;
}

function buildFallbackDebate(input: {
  rawInput: string;
  summary: string;
  discussion: NonNullable<PrepIssueLike["discussion"]>;
}): NonNullable<PrepIssueLike["debate"]> {
  const lines = extractStructuredLines(input.rawInput, "待补充需求上下文");
  const consensusFromDiscussion = (input.discussion || [])
    .map((item) => sanitizeLine(item.proposal || "", ""))
    .filter(Boolean);
  const divergencesFromDiscussion = (input.discussion || [])
    .map((item) => sanitizeLine(item.concern || "", ""))
    .filter(Boolean);
  const consensus = dedupeLines([
    ...consensusFromDiscussion,
    `围绕“${lines[0] || input.summary || "当前项目目标"}”收敛 MVP，先保证主链路闭环。`
  ], "当前无结构化共识条目，需在后续阶段补充。");
  const divergences = dedupeLines([
    ...divergencesFromDiscussion,
    "若边界未冻结，后续设计与研发会出现返工风险。"
  ], "当前无显式分歧项。");
  const opinions = (input.discussion || []).map((item, index) => ({
    id: item.id || `prep-opinion-${index + 1}`,
    roleId: item.roleId,
    roleLabel: item.roleLabel,
    focus: item.focus,
    concern: item.concern,
    proposal: item.proposal,
    provider: "issue_engine",
    model: "heuristic",
    elapsedMs: 0,
    mode: "fallback" as const,
    rawPreview: `${item.focus}\n${item.concern}\n${item.proposal}`
  }));
  return {
    mode: "fallback",
    generatedAt: new Date().toISOString(),
    consensus,
    divergences,
    opinions,
    note: "当前结论来自创建后预备阶段结构化推导。若存在已确认 Issue，将优先采用其正式讨论结果。"
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const taskResult = promise.then(
    (value) => ({ type: "task" as const, ok: true as const, value }),
    (error) => ({ type: "task" as const, ok: false as const, error })
  );
  try {
    const timeout = new Promise<{ type: "timeout" }>((resolve) => {
      timer = setTimeout(() => {
        resolve({ type: "timeout" });
      }, timeoutMs);
    });
    const winner = await Promise.race([taskResult, timeout] as const);
    if (winner.type === "timeout") {
      void taskResult.then((late) => {
        if (!late.ok) {
          const lateMessage = late.error instanceof Error ? late.error.message : String(late.error);
          console.warn(`[post-create-prep.withTimeout] late rejection after timeout ignored: ${lateMessage}`);
        }
      });
      throw new Error(`PREP_DISCUSSION_TIMEOUT:${label}:${timeoutMs}ms`);
    }
    if (!winner.ok) {
      throw winner.error;
    }
    return winner.value;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function toDiscussionFromDebate(
  debate: PrepIssueLike["debate"] | null | undefined,
  fallback: NonNullable<PrepIssueLike["discussion"]>
) {
  if (!debate || !Array.isArray(debate.opinions) || debate.opinions.length <= 0) {
    return fallback;
  }
  return debate.opinions.map((item, index) => ({
    id: sanitizeLine(item.id || `prep-debate-opinion-${index + 1}`, `prep-debate-opinion-${index + 1}`),
    roleId: item.roleId as RoleType,
    roleLabel: sanitizeLine(item.roleLabel || item.roleId || "未知角色", "未知角色"),
    focus: sanitizeLine(item.focus || "", "待补充"),
    concern: sanitizeLine(item.concern || "", "待补充"),
    proposal: sanitizeLine(item.proposal || "", "待补充")
  }));
}

function hasMeaningfulRequirementContract(contract: PrepIssueLike["requirementContract"]) {
  if (!contract) {
    return false;
  }
  return Boolean(
    sanitizeLine(contract.objective || "", "")
    || (Array.isArray(contract.inScope) && contract.inScope.some((item) => sanitizeLine(item, "")))
    || (Array.isArray(contract.acceptanceCriteria) && contract.acceptanceCriteria.some((item) => sanitizeLine(item, "")))
  );
}

function hasMeaningfulRefinement(refinement: PrepIssueLike["refinement"]) {
  if (!refinement) {
    return false;
  }
  return Boolean(
    sanitizeLine(refinement.problemStatement || "", "")
    || sanitizeLine(refinement.expectedOutcome || "", "")
    || (Array.isArray(refinement.inScopeDraft) && refinement.inScopeDraft.some((item) => sanitizeLine(item, "")))
  );
}

function hasMeaningfulDesignBlueprint(designBlueprint: PrepIssueLike["designBlueprint"]) {
  if (!designBlueprint) {
    return false;
  }
  return Boolean(
    sanitizeLine(designBlueprint.designTheme || "", "")
    || sanitizeLine(designBlueprint.valueNarrative || "", "")
    || (Array.isArray(designBlueprint.coreScenarios) && designBlueprint.coreScenarios.some((item) => sanitizeLine(item, "")))
  );
}

async function buildSynthesizedPrepIssueLike(rawInput: string): Promise<PrepIssueLike> {
  const normalizedRawInput = sanitizeLine(rawInput, "待补充原始需求");
  const summary = sanitizeLine(inferIssueSummary(normalizedRawInput), normalizedRawInput.slice(0, 80));
  const productContext = await getProductContext();
  const industryCode = sanitizeLine(detectIndustry(normalizedRawInput), "") || "saas";
  const refinement = buildRequirementRefinement(normalizedRawInput);
  const fallbackDiscussion = buildIssueDiscussion(
    normalizedRawInput,
    PREP_DISCUSSION_ROLE_IDS,
    PREP_SOUL_ROLE_ID,
    { includeSoulRole: true }
  );
  const alignment = buildContextAlignment(normalizedRawInput, productContext);
  const designBlueprint = buildDesignBlueprint({
    rawInput: normalizedRawInput,
    refinement,
    alignment
  });
  const questions = buildClarificationQuestions(normalizedRawInput);
  const suggestedAnswers = buildSuggestedAnswers({
    rawInput: normalizedRawInput,
    questions,
    refinement,
    alignment,
    industryCode,
    discussion: fallbackDiscussion
  });
  const requirementContract = buildRequirementContract({
    suggestedAnswers,
    refinement,
    designBlueprint,
    expectedArtifacts: buildExpectedArtifacts("standard_software_development")
  });
  const fallbackDebate = buildFallbackDebate({
    rawInput: normalizedRawInput,
    summary,
    discussion: fallbackDiscussion
  });

  let debate = fallbackDebate;
  let discussion: NonNullable<PrepIssueLike["discussion"]> = fallbackDiscussion;
  let synthesizedSummary = summary;
  let synthesizedRefinement = refinement;
  let synthesizedDesignBlueprint = designBlueprint;
  let synthesizedRequirementContract = requirementContract;
  const runtime = await getRuntimeStatus();
  const shouldRunModelDebate = String(runtime.mode || "").trim().toLowerCase() !== "scripted"
    && String(process.env.NODE_ENV || "").trim().toLowerCase() !== "test";
  const debateTimeoutMs = Math.max(8_000, Number(process.env.PREP_DISCUSSION_DEBATE_TIMEOUT_MS ?? 95_000));

  if (shouldRunModelDebate) {
    try {
      const debateResult = await withTimeout(
        buildIssueRoleDebate({
          input: normalizedRawInput,
          title: inferIssueTitle(normalizedRawInput),
          summary,
          recommendedRoleIds: PREP_DISCUSSION_ROLE_IDS,
          soulRoleId: PREP_SOUL_ROLE_ID,
          industryCode
        }),
        debateTimeoutMs,
        "pre_stage_model_debate"
      );
      debate = debateResult;
      discussion = toDiscussionFromDebate(debateResult, fallbackDiscussion);
      if (debateResult.mode === "model") {
        const synthesized = synthesizeIssueArtifactsFromDebate({
          rawInput: normalizedRawInput,
          productContext,
          industryCode,
          questions,
          expectedArtifacts: buildExpectedArtifacts("standard_software_development"),
          draft: {
            summary,
            refinement,
            contextAlignment: alignment,
            designBlueprint,
            suggestedAnswers,
            requirementContract
          },
          debate: debateResult
        });
        synthesizedSummary = sanitizeLine(synthesized.summary || summary, summary);
        synthesizedRefinement = synthesized.refinement || refinement;
        synthesizedDesignBlueprint = synthesized.designBlueprint || designBlueprint;
        synthesizedRequirementContract = synthesized.requirementContract || requirementContract;
      }
    } catch (error) {
      const reason = sanitizeLine(error instanceof Error ? error.message : String(error || "unknown_error"), "");
      debate = {
        ...fallbackDebate,
        note: reason
          ? `${fallbackDebate.note || ""} 模型讨论调用失败，已自动降级。原因: ${reason}`.trim()
          : fallbackDebate.note
      };
      discussion = fallbackDiscussion;
    }
  } else {
    debate = {
      ...fallbackDebate,
      note: `${fallbackDebate.note || ""} 当前运行模式为 ${sanitizeLine(String(runtime.mode || "unknown"), "unknown")}，未触发真实模型讨论。`.trim()
    };
  }

  return {
    rawInput: normalizedRawInput,
    summary: synthesizedSummary,
    refinement: synthesizedRefinement,
    designBlueprint: synthesizedDesignBlueprint,
    requirementContract: synthesizedRequirementContract,
    discussion,
    discussionDraft: fallbackDiscussion,
    debate
  };
}

async function resolvePrepIssueLike(input: {
  issue: IssueRecord | null;
  projectDescription: string;
  projectInputs: ProjectInputLike[];
}) {
  const inferredRawInput = inferRawInputFromProject({
    projectDescription: input.projectDescription,
    projectInputs: input.projectInputs
  });
  const synthesized = await buildSynthesizedPrepIssueLike(inferredRawInput);
  if (!input.issue) {
    return synthesized;
  }

  const issueConfirmed = String(input.issue.status || "").trim().toLowerCase() === "confirmed";
  const hasIssueDebate = Boolean(
    issueConfirmed
    && input.issue.debate
    && (
      input.issue.debate.consensus.length > 0
      || input.issue.debate.divergences.length > 0
      || input.issue.debate.opinions.length > 0
    )
  );
  const hasIssueModelDebate = Boolean(
    hasIssueDebate
    && String(input.issue.debate?.mode || "").trim().toLowerCase() === "model"
  );
  const normalizedIssueRawInput = normalizeRawInputSeed(
    stripPrepGeneratedSections(String(input.issue.rawInput || ""))
  );
  const issueVsCurrentAligned = isLikelySameIntent(
    normalizedIssueRawInput || String(input.issue.summary || ""),
    inferredRawInput
  );
  const shouldReuseIssueArtifacts = issueConfirmed && hasIssueModelDebate && issueVsCurrentAligned;
  const synthesizedDiscussion = (Array.isArray(synthesized.discussion) ? synthesized.discussion : []) as NonNullable<PrepIssueLike["discussion"]>;
  const issueDiscussionFallback: NonNullable<PrepIssueLike["discussion"]> = Array.isArray(input.issue.discussion) && input.issue.discussion.length > 0
    ? input.issue.discussion
    : (Array.isArray(input.issue.discussionDraft) && input.issue.discussionDraft.length > 0
      ? input.issue.discussionDraft
      : synthesizedDiscussion);
  const effectiveDebate = shouldReuseIssueArtifacts ? input.issue.debate : synthesized.debate;
  const discussion = shouldReuseIssueArtifacts
    ? toDiscussionFromDebate(effectiveDebate, issueDiscussionFallback)
    : synthesizedDiscussion;
  const effectiveIssueRawInput = sanitizeLine(normalizedIssueRawInput || inferredRawInput, inferredRawInput);
  const hasIssueDebateDiscussionDraft = shouldReuseIssueArtifacts && Array.isArray(input.issue.discussionDraft) && input.issue.discussionDraft.length > 0;

  return {
    ...synthesized,
    rawInput: shouldReuseIssueArtifacts ? effectiveIssueRawInput : synthesized.rawInput,
    summary: shouldReuseIssueArtifacts
      ? sanitizeLine(input.issue.summary || synthesized.summary, synthesized.summary)
      : synthesized.summary,
    requirementContract: shouldReuseIssueArtifacts && hasMeaningfulRequirementContract(input.issue.requirementContract)
      ? input.issue.requirementContract
      : synthesized.requirementContract,
    refinement: shouldReuseIssueArtifacts && hasMeaningfulRefinement(input.issue.refinement)
      ? input.issue.refinement
      : synthesized.refinement,
    designBlueprint: shouldReuseIssueArtifacts && hasMeaningfulDesignBlueprint(input.issue.designBlueprint)
      ? input.issue.designBlueprint
      : synthesized.designBlueprint,
    discussion,
    discussionDraft: hasIssueDebateDiscussionDraft
      ? input.issue.discussionDraft
      : discussion,
    debate: effectiveDebate
  } satisfies PrepIssueLike;
}

function buildRequirementContractBlock(issue: PrepIssueLike) {
  const contract = issue.requirementContract;
  return [
    "需求确认单:",
    `- 目标: ${sanitizeLine(contract?.objective || issue.summary || issue.rawInput, "信息未提供")}`,
    `- In Scope: ${(contract?.inScope || []).slice(0, 3).map((item) => sanitizeLine(item, "")).filter(Boolean).join("；") || "信息未提供"}`,
    `- Out of Scope: ${(contract?.outOfScope || []).slice(0, 3).map((item) => sanitizeLine(item, "")).filter(Boolean).join("；") || "信息未提供"}`,
    `- 验收: ${(contract?.acceptanceCriteria || []).slice(0, 3).map((item) => sanitizeLine(item, "")).filter(Boolean).join("；") || "信息未提供"}`,
    `- 产出: ${(contract?.artifacts || []).slice(0, 6).map((item) => sanitizeLine(item, "")).filter(Boolean).join("、") || "信息未提供"}`
  ].join("\n");
}

function buildDebateConclusionSection(issue: PrepIssueLike) {
  const discussion = Array.isArray(issue.discussion) ? issue.discussion : [];
  const opinions = Array.isArray(issue.debate?.opinions) ? issue.debate.opinions : [];
  const consensus = dedupeLines(issue.debate?.consensus || [], "当前无结构化共识条目，需在后续阶段补充。");
  const divergences = dedupeLines(issue.debate?.divergences || [], "当前无显式分歧项。");
  const roleDecisionsFromDiscussion = discussion
    .map((item) => `- ${sanitizeLine(item.roleLabel || item.roleId || "未知角色")}: ${sanitizeLine(item.proposal || item.concern || item.focus || "", "待补充")}`)
    .filter(Boolean);
  const roleDecisionsFromOpinions = opinions
    .map((item) => `- ${sanitizeLine(item.roleLabel || item.roleId || "未知角色")}: ${sanitizeLine(item.proposal || item.concern || "", "待补充")}`)
    .filter(Boolean);
  const preferOpinionDecisions = String(issue.debate?.mode || "").trim().toLowerCase() === "model";
  const roleDecisions = preferOpinionDecisions
    ? (roleDecisionsFromOpinions.length > 0 ? roleDecisionsFromOpinions : roleDecisionsFromDiscussion)
    : (roleDecisionsFromDiscussion.length > 0 ? roleDecisionsFromDiscussion : roleDecisionsFromOpinions);

  return [
    DISCUSSION_SECTION_TITLE,
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
    `- ${sanitizeLine(issue.requirementContract?.objective || issue.summary || issue.rawInput, "围绕已确认业务目标推进 MVP。")}`
  ].join("\n");
}

function buildAnalysisDraftSection(issue: PrepIssueLike) {
  const refinement = issue.refinement;
  const designBlueprint = issue.designBlueprint;
  const objective = sanitizeLine(issue.requirementContract?.objective || issue.summary || issue.rawInput, "待补充项目目标");
  const inScope = dedupeLines([...(issue.requirementContract?.inScope || []), ...(refinement?.inScopeDraft || [])], "待补充首期范围");
  const outOfScope = dedupeLines([...(issue.requirementContract?.outOfScope || []), ...(refinement?.outOfScopeDraft || [])], "待补充非目标范围");
  const acceptance = dedupeLines([...(issue.requirementContract?.acceptanceCriteria || []), ...(refinement?.acceptanceDraft || [])], "待补充验收标准");
  const scenarios = dedupeLines(designBlueprint?.coreScenarios || [], "待补充核心场景");
  const risks = dedupeLines(issue.debate?.divergences || [], "暂无新增高风险，按阶段门禁继续验证。");

  return [
    ANALYSIS_SECTION_TITLE,
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

function buildDiscussionTraceInput(input: {
  issue: PrepIssueLike;
  triggeredBy?: string;
  generatedAt?: Date;
}) {
  const generatedAt = (input.generatedAt || new Date()).toISOString();
  const triggeredBy = sanitizeLine(input.triggeredBy || "projects_route_manual_trigger", "projects_route_manual_trigger");
  const discussion = Array.isArray(input.issue.discussion) ? input.issue.discussion : [];
  const opinions = Array.isArray(input.issue.debate?.opinions) ? input.issue.debate.opinions : [];
  const opinionByRole = new Map<string, typeof opinions[number]>();
  for (const opinion of opinions) {
    const key = String(opinion.roleId || "").trim();
    if (!key || opinionByRole.has(key)) {
      continue;
    }
    opinionByRole.set(key, opinion);
  }

  const discussionBlocks = discussion.map((item, index) => {
    const roleId = sanitizeLine(item.roleId || "ROLE_ANALYST", "ROLE_ANALYST");
    const roleLabel = sanitizeLine(item.roleLabel || roleId, roleId);
    const opinion = opinionByRole.get(roleId);
    const mode = sanitizeLine(String((opinion as { mode?: string } | undefined)?.mode || "fallback"), "fallback");
    const model = sanitizeLine(String((opinion as { model?: string } | undefined)?.model || "heuristic"), "heuristic");
    const provider = sanitizeLine(String((opinion as { provider?: string } | undefined)?.provider || "issue_engine"), "issue_engine");
    const elapsedMsRaw = Number((opinion as { elapsedMs?: number } | undefined)?.elapsedMs);
    const elapsedMs = Number.isFinite(elapsedMsRaw) ? `${Math.max(0, Math.round(elapsedMsRaw))}` : "0";
    return [
      `### ${index + 1}. ${roleLabel} (${roleId})`,
      `- 关注: ${sanitizeLine(item.focus || "", "待补充")}`,
      `- 风险: ${sanitizeLine(item.concern || "", "待补充")}`,
      `- 建议: ${sanitizeLine(item.proposal || "", "待补充")}`,
      `- 模式: ${mode}`,
      `- 模型: ${model}`,
      `- Provider: ${provider}`,
      `- 耗时(ms): ${elapsedMs}`
    ].join("\n");
  });

  return [
    `# ${PREP_DISCUSSION_TRACE_INPUT_NAME}`,
    "",
    `- generatedAt: ${generatedAt}`,
    `- triggeredBy: ${triggeredBy}`,
    "- phase: pre_stage_multi_agent_debate",
    `- debateMode: ${sanitizeLine(String(input.issue.debate?.mode || "fallback"), "fallback")}`,
    `- debateNote: ${sanitizeLine(String(input.issue.debate?.note || "无"), "无")}`,
    "- backfillTargets: rawRequirements, prd, debateSummary",
    `- sourceRawInput: ${sanitizeLine(input.issue.rawInput || "", "待补充原始需求")}`,
    `- sourceObjective: ${sanitizeLine(input.issue.requirementContract?.objective || input.issue.summary || "", "待补充目标")}`,
    "",
    "## 讨论回合记录",
    ...(discussionBlocks.length > 0
      ? discussionBlocks
      : ["### 1. 系统 (ROLE_ANALYST)\n- 关注: 待补充\n- 风险: 待补充\n- 建议: 待补充\n- 模式: fallback\n- 模型: heuristic\n- Provider: issue_engine\n- 耗时(ms): 0"]),
  ].join("\n");
}

function buildSeededInputs(issue: PrepIssueLike, blocks: {
  debate: string;
  analysis: string;
  requirement: string;
  trace: string;
  feedback?: string;
}) {
  return buildSeededInputsFromRawInput({
    rawInput: sanitizeLine(issue.rawInput, "待补充原始需求"),
    blocks
  });
}

function buildSeededInputsFromRawInput(input: {
  rawInput: string;
  blocks: {
    debate: string;
    analysis: string;
    requirement: string;
    trace: string;
    feedback?: string;
  };
}) {
  const normalizedRawInput = sanitizeLine(input.rawInput, "待补充原始需求");
  const rawIntentLines = dedupeLines(
    extractStructuredLines(normalizedRawInput, "待补充用户原始诉求").slice(0, 6),
    "待补充用户原始诉求"
  );
  const rawRequirementsContent = [
    "# rawRequirements",
    "",
    "## 原始需求输入",
    normalizedRawInput,
    "",
    "## 用户诉求提炼",
    ...rawIntentLines.map((item) => `- ${item}`),
    "",
    "## 输入边界说明",
    "- 本文档保留用户原始意图与上下文素材，供多Agent讨论复用。",
    "- 结构化目标、范围、验收条款请以 `prd` 文档为准。",
    "",
    "## 关联讨论摘要",
    "- 讨论详情见 debateSummary 与 prepDiscussionTrace。"
  ].join("\n");
  const prdContent = [
    "# prd",
    "",
    "## 结构化需求草案",
    input.blocks.analysis,
    "",
    "## 需求确认单",
    input.blocks.requirement
  ].join("\n");
  const debateSummaryContent = [
    "# debateSummary",
    "",
    input.blocks.debate
  ].join("\n");
  const discussionTraceContent = String(input.blocks.trace || "").trim();
  const feedbackSeed = String(input.blocks.feedback || "").trim();
  const feedbackContent = hasMeaningfulPrepFeedback(feedbackSeed)
    ? normalizePrepDocumentByName(PREP_FEEDBACK_INPUT_NAME, feedbackSeed)
    : [
      `# ${PREP_FEEDBACK_INPUT_NAME}`,
      "",
      "## 最新用户反馈",
      "待补充用户反馈。",
      "",
      "## 期望修订点",
      "- 待补充",
    ].join("\n");
  return [
    {
      name: "rawRequirements",
      type: "document",
      description: "项目创建后自动生成：原始需求输入与用户诉求提炼",
      content: rawRequirementsContent
    },
    {
      name: "prd",
      type: "document",
      description: "项目创建后自动生成：结构化需求草案与需求确认单",
      content: prdContent
    },
    {
      name: "debateSummary",
      type: "document",
      description: "项目创建后自动生成：多Agent讨论结论摘要",
      content: debateSummaryContent
    },
    {
      name: PREP_DISCUSSION_TRACE_INPUT_NAME,
      type: "document",
      description: "项目创建后自动生成：多Agent讨论回合日志（用于预备阶段展示与审阅）",
      content: discussionTraceContent
    },
    {
      name: PREP_FEEDBACK_INPUT_NAME,
      type: "document",
      description: "预备阶段用户反馈与修订诉求（用于再次触发讨论时引导Agent修改）",
      content: feedbackContent
    }
  ] as const;
}

export async function evaluateProjectPostCreatePrepStatus(input: {
  projectId: string;
  description?: string;
  projectInputs?: ProjectInputLike[];
  projectType?: string;
}) {
  const [issue, projectMeta] = await Promise.all([
    getIssueByProjectId(input.projectId),
    prisma.project.findUnique({
      where: { id: input.projectId },
      select: { description: true, projectType: true }
    })
  ]);
  const required = shouldRequirePostCreatePrep({
    issue,
    projectType: String(input.projectType || projectMeta?.projectType || "complete")
  });
  if (!required) {
    return {
      required: false,
      completed: true,
      missingItems: []
    } satisfies ProjectPostCreatePrepStatus;
  }

  const description = String(input.description || projectMeta?.description || "");
  const projectInputs = Array.isArray(input.projectInputs)
    ? input.projectInputs
    : await prisma.projectInput.findMany({
      where: { projectId: input.projectId },
      select: { id: true, name: true, content: true, description: true, inputSource: true }
    });
  const existingNameKeys = new Set(projectInputs.map((item) => normalizeKey(item.name)));
  const draft = buildPrepDraftSnapshot({ description, projectInputs });
  const enforceModelRound = shouldEnforcePrepModelRound();
  const missingItems: string[] = [];
  if (!draft.discussion) {
    missingItems.push("多Agent讨论结论");
  } else if (!hasStructuredPrepDiscussion(draft.discussion)) {
    missingItems.push("多Agent讨论结论(结构不完整)");
  }
  if (!draft.analysis) {
    missingItems.push("项目详情理解确认草案");
  }
  for (const name of REQUIRED_INPUT_NAMES) {
    if (!existingNameKeys.has(normalizeKey(name))) {
      missingItems.push(`项目输入:${name}`);
      continue;
    }
    if (!getInputContentByName(projectInputs, name)) {
      missingItems.push(`项目输入:${name}(内容为空)`);
    }
  }
  const traceQuality = inspectPrepDiscussionTrace(draft.discussionTrace);
  if (!traceQuality.hasTrace) {
    missingItems.push("多Agent讨论日志");
  } else {
    if (traceQuality.roleCount < 3) {
      missingItems.push("多Agent讨论日志(角色回合不足)");
    }
    if (enforceModelRound && !traceQuality.hasModelRound) {
      missingItems.push("多Agent讨论日志(未检测到真实模型回合)");
    }
  }
  if (!hasMeaningfulPrepFeedback(draft.feedback)) {
    missingItems.push("用户反馈与修订记录");
  }
  if (!draft.confirmed) {
    missingItems.push("用户确认预备内容");
  }

  return {
    required: true,
    completed: missingItems.length === 0,
    missingItems,
    draft
  } satisfies ProjectPostCreatePrepStatus;
}

export async function runProjectPostCreatePrep(input: {
  projectId: string;
  issue?: IssueRecord | null;
  triggeredBy?: string;
  feedback?: string;
}) {
  const [project, projectInputs] = await Promise.all([
    prisma.project.findUnique({
      where: { id: input.projectId },
      select: { id: true, description: true, projectType: true }
    }),
    prisma.projectInput.findMany({
      where: { projectId: input.projectId },
      select: { id: true, name: true, content: true, description: true, inputSource: true }
    })
  ]);
  if (!project) {
    throw new Error(`PROJECT_NOT_FOUND:${input.projectId}`);
  }
  const normalizedFeedbackOverride = typeof input.feedback === "string"
    ? normalizePrepDocumentByName(PREP_FEEDBACK_INPUT_NAME, input.feedback)
    : "";
  const projectInputsForPrep = normalizedFeedbackOverride
    ? (() => {
      const clone = projectInputs.map((item) => ({ ...item }));
      const feedbackIndex = clone.findIndex((item) => normalizeKey(item.name) === normalizeKey(PREP_FEEDBACK_INPUT_NAME));
      if (feedbackIndex >= 0) {
        clone[feedbackIndex] = {
          ...clone[feedbackIndex],
          content: normalizedFeedbackOverride,
          inputSource: "manual"
        };
      } else {
        clone.push({
          id: "prep-feedback-override",
          name: PREP_FEEDBACK_INPUT_NAME,
          content: normalizedFeedbackOverride,
          description: "预备阶段用户反馈与修订诉求（用于再次触发讨论时引导Agent修改）",
          inputSource: "manual"
        });
      }
      return clone;
    })()
    : projectInputs;
  const issue = input.issue ?? await getIssueByProjectId(input.projectId);
  const source: ProjectPostCreatePrepSource = {
    projectId: project.id,
    projectDescription: String(project.description || ""),
    projectType: String(project.projectType || "complete"),
    issue
  };
  if (!shouldRequirePostCreatePrep({
    issue: source.issue,
    projectType: source.projectType
  })) {
    return {
      required: false,
      completed: true,
      missingItems: []
    } satisfies ProjectPostCreatePrepStatus;
  }

  const prepIssueLike = await resolvePrepIssueLike({
    issue: source.issue,
    projectDescription: source.projectDescription,
    projectInputs: projectInputsForPrep
  });
  const requirementBlock = buildRequirementContractBlock(prepIssueLike);
  const debateBlock = buildDebateConclusionSection(prepIssueLike);
  const analysisBlock = buildAnalysisDraftSection(prepIssueLike);
  const discussionTraceBlock = buildDiscussionTraceInput({
    issue: prepIssueLike,
    triggeredBy: input.triggeredBy,
    generatedAt: new Date()
  });
  let nextDescription = upsertMarkdownSection(
    String(project.description || ""),
    DISCUSSION_SECTION_TITLE,
    extractMarkdownSection(debateBlock, DISCUSSION_SECTION_TITLE)
  );
  nextDescription = upsertMarkdownSection(
    nextDescription,
    ANALYSIS_SECTION_TITLE,
    extractMarkdownSection(analysisBlock, ANALYSIS_SECTION_TITLE)
  );

  const seededInputs = buildSeededInputs(prepIssueLike, {
    debate: debateBlock,
    analysis: analysisBlock,
    requirement: requirementBlock,
    trace: discussionTraceBlock,
    feedback: normalizedFeedbackOverride || getInputContentByName(projectInputsForPrep, PREP_FEEDBACK_INPUT_NAME)
  });

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    if (nextDescription !== String(project.description || "")) {
      await tx.project.update({
        where: { id: project.id },
        data: {
          description: nextDescription,
          updatedAt: now
        }
      });
    }

    const existingInputs = await tx.projectInput.findMany({
      where: { projectId: project.id },
      select: { id: true, name: true }
    });
    const existingByKey = new Map(existingInputs.map((item) => [normalizeKey(item.name), item]));
    for (const item of seededInputs) {
      const key = normalizeKey(item.name);
      const existing = existingByKey.get(key);
      if (existing) {
        await tx.projectInput.update({
          where: { id: existing.id },
          data: {
            type: item.type,
            description: item.description,
            content: item.content,
            validationStatus: "valid",
            validationErrors: [],
            inputSource: item.name === PREP_FEEDBACK_INPUT_NAME && hasMeaningfulPrepFeedback(String(item.content || ""))
              ? "manual"
              : "template_generated"
          }
        });
      } else {
        await tx.projectInput.create({
          data: {
            projectId: project.id,
            name: item.name,
            type: item.type,
            description: item.description,
            content: item.content,
              validationStatus: "valid",
              validationErrors: [],
              inputSource: item.name === PREP_FEEDBACK_INPUT_NAME && hasMeaningfulPrepFeedback(String(item.content || ""))
                ? "manual"
                : "template_generated"
            }
          });
      }
    }

    await tx.timelineEvent.create({
      data: {
        projectId: project.id,
        timestamp: now,
        agentId: "ROLE_PM",
        type: "system",
        title: "项目创建后需求预备草案已生成",
        content: [
          "已自动写入多Agent讨论结论与项目详情理解确认草案。",
          "并补齐 rawRequirements / prd / debateSummary 三类项目输入。",
          "请在预备阶段页面审阅并确认通过后，再进入正式项目执行页面。"
        ].join("\n"),
        priority: "normal"
      }
    });
  }, {
    maxWait: 30_000,
    timeout: 120_000
  });

  return evaluateProjectPostCreatePrepStatus({
    projectId: project.id,
    description: nextDescription,
    projectType: source.projectType
  });
}

export async function saveProjectPostCreatePrepDraft(input: {
  projectId: string;
  draft?: {
    discussion?: string;
    analysis?: string;
    rawRequirements?: string;
    prd?: string;
    debateSummary?: string;
    discussionTrace?: string;
    feedback?: string;
  };
  triggeredBy?: string;
}) {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true, description: true, projectType: true }
  });
  if (!project) {
    throw new Error(`PROJECT_NOT_FOUND:${input.projectId}`);
  }
  const issue = await getIssueByProjectId(project.id);
  if (!shouldRequirePostCreatePrep({
    issue,
    projectType: String(project.projectType || "complete")
  })) {
    return evaluateProjectPostCreatePrepStatus({
      projectId: project.id,
      description: project.description,
      projectType: project.projectType
    });
  }

  const draftInput = input.draft || {};
  const hasDiscussion = typeof draftInput.discussion === "string";
  const hasAnalysis = typeof draftInput.analysis === "string";
  const hasRawRequirements = typeof draftInput.rawRequirements === "string";
  const hasPrd = typeof draftInput.prd === "string";
  const hasDebateSummary = typeof draftInput.debateSummary === "string";
  const hasDiscussionTrace = typeof draftInput.discussionTrace === "string";
  const hasFeedback = typeof draftInput.feedback === "string";
  if (!hasDiscussion && !hasAnalysis && !hasRawRequirements && !hasPrd && !hasDebateSummary && !hasDiscussionTrace && !hasFeedback) {
    return evaluateProjectPostCreatePrepStatus({
      projectId: project.id,
      description: project.description,
      projectType: project.projectType
    });
  }

  const existingInputs = await prisma.projectInput.findMany({
    where: { projectId: project.id },
    select: { id: true, name: true, content: true, description: true, inputSource: true }
  });
  const byKey = new Map(existingInputs.map((item) => [normalizeKey(item.name), item]));

  let nextDescription = String(project.description || "");
  if (hasDiscussion) {
    nextDescription = upsertMarkdownSection(
      nextDescription,
      DISCUSSION_SECTION_TITLE,
      String(draftInput.discussion || "").trim() || "待补充多Agent讨论结论"
    );
  }
  if (hasAnalysis) {
    nextDescription = upsertMarkdownSection(
      nextDescription,
      ANALYSIS_SECTION_TITLE,
      String(draftInput.analysis || "").trim() || "待补充项目详情理解确认草案"
    );
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    if (nextDescription !== String(project.description || "")) {
      await tx.project.update({
        where: { id: project.id },
        data: {
          description: nextDescription,
          updatedAt: now
        }
      });
    }

    const upsertInputContent = async (
      name:
        | "rawRequirements"
        | "prd"
        | "debateSummary"
        | typeof PREP_DISCUSSION_TRACE_INPUT_NAME
        | typeof PREP_FEEDBACK_INPUT_NAME,
      content: string | undefined
    ) => {
      if (typeof content !== "string") {
        return;
      }
      const key = normalizeKey(name);
      const existing = byKey.get(key);
      const normalizedContent = String(content).trim();
      const normalizedStructuredContent = normalizePrepDocumentByName(name, normalizedContent);
      if (existing) {
        await tx.projectInput.update({
          where: { id: existing.id },
          data: {
            type: "document",
            content: normalizedStructuredContent,
            description: existing.description || `预备阶段草案编辑：${name}`,
            validationStatus: normalizedStructuredContent ? "valid" : "warning",
            validationErrors: normalizedStructuredContent ? [] : ["内容为空"],
            inputSource: "manual"
          }
        });
        return;
      }
      await tx.projectInput.create({
        data: {
          projectId: project.id,
          name,
          type: "document",
          description: `预备阶段草案编辑：${name}`,
          content: normalizedStructuredContent || undefined,
          validationStatus: normalizedStructuredContent ? "valid" : "warning",
          validationErrors: normalizedStructuredContent ? [] : ["内容为空"],
          inputSource: "manual"
        }
      });
    };

    await upsertInputContent("rawRequirements", draftInput.rawRequirements);
    await upsertInputContent("prd", draftInput.prd);
    await upsertInputContent("debateSummary", draftInput.debateSummary);
    await upsertInputContent(PREP_DISCUSSION_TRACE_INPUT_NAME, draftInput.discussionTrace);
    await upsertInputContent(PREP_FEEDBACK_INPUT_NAME, draftInput.feedback);
  }, {
    maxWait: 30_000,
    timeout: 120_000
  });

  return evaluateProjectPostCreatePrepStatus({
    projectId: project.id,
    description: nextDescription,
    projectType: project.projectType
  });
}

export async function confirmProjectPostCreatePrep(input: {
  projectId: string;
  confirmedBy?: string;
  notes?: string;
  draft?: {
    discussion?: string;
    analysis?: string;
    rawRequirements?: string;
    prd?: string;
    debateSummary?: string;
    discussionTrace?: string;
    feedback?: string;
  };
}) {
  if (input.draft) {
    await saveProjectPostCreatePrepDraft({
      projectId: input.projectId,
      draft: input.draft,
      triggeredBy: "post_create_prep_confirm_save"
    });
  }
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true, description: true, projectType: true }
  });
  if (!project) {
    throw new Error(`PROJECT_NOT_FOUND:${input.projectId}`);
  }
  const issue = await getIssueByProjectId(project.id);
  if (!shouldRequirePostCreatePrep({
    issue,
    projectType: String(project.projectType || "complete")
  })) {
    return evaluateProjectPostCreatePrepStatus({
      projectId: project.id,
      description: project.description,
      projectType: project.projectType
    });
  }

  const currentStatus = await evaluateProjectPostCreatePrepStatus({
    projectId: project.id,
    description: project.description,
    projectType: project.projectType
  });
  const blockedMissing = currentStatus.missingItems.filter((item) => item !== "用户确认预备内容");
  if (blockedMissing.length > 0) {
    return currentStatus;
  }

  const confirmSection = buildPrepConfirmationSection({
    confirmedBy: input.confirmedBy,
    notes: input.notes,
    timestamp: new Date()
  });
  const nextDescription = upsertMarkdownSection(
    String(project.description || ""),
    PREP_CONFIRM_SECTION_TITLE,
    extractMarkdownSection(confirmSection, PREP_CONFIRM_SECTION_TITLE)
  );
  await prisma.$transaction(async (tx) => {
    await tx.project.update({
      where: { id: project.id },
      data: {
        description: nextDescription
      }
    });
    await tx.timelineEvent.create({
      data: {
        projectId: project.id,
        timestamp: new Date(),
        agentId: "ROLE_PM",
        type: "system",
        title: "预备阶段用户确认通过",
        content: `确认人: ${sanitizeLine(input.confirmedBy || "项目负责人")}。已允许进入正式项目执行页面。`,
        priority: "normal"
      }
    });
  }, {
    maxWait: 30_000,
    timeout: 120_000
  });

  return evaluateProjectPostCreatePrepStatus({
    projectId: project.id,
    description: nextDescription,
    projectType: project.projectType
  });
}
