import type { RoleType } from "@occ/shared";
import { prisma } from "../db.js";
import {
  buildClarificationQuestions,
  buildContextAlignment,
  buildDesignBlueprint,
  buildExpectedArtifacts,
  buildIssueDiscussion,
  buildRequirementContract,
  buildRequirementRefinement,
  buildSuggestedAnswers,
  inferIssueSummary
} from "./issue-engine.js";
import {
  getIssueByProjectId,
  getProductContext,
  type IssueRecord
} from "./v1-method-store.js";

const DISCUSSION_SECTION_TITLE = "## 多Agent需求讨论结论";
const ANALYSIS_SECTION_TITLE = "## 项目详情理解确认草案";
const PREP_CONFIRM_SECTION_TITLE = "## 预备阶段用户确认";
const REQUIRED_INPUT_NAMES = ["rawRequirements", "prd", "debateSummary"] as const;
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

function getInputContentByName(projectInputs: ProjectInputLike[], inputName: string) {
  const key = normalizeKey(inputName);
  const target = projectInputs.find((item) => normalizeKey(item.name) === key);
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
    ...confirmation
  };
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
  const rawRequirements = stripPrepGeneratedSections(getInputContentByName(input.projectInputs, "rawRequirements"));
  const description = stripPrepGeneratedSections(input.projectDescription);
  const prd = stripPrepGeneratedSections(getInputContentByName(input.projectInputs, "prd"));
  const debateSummary = stripPrepGeneratedSections(getInputContentByName(input.projectInputs, "debateSummary"));
  const candidates = [rawRequirements, description, prd, debateSummary]
    .map((item) => sanitizeLine(item, ""))
    .filter(Boolean);
  return candidates[0] || "待补充原始需求";
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
  const refinement = buildRequirementRefinement(normalizedRawInput);
  const discussion = buildIssueDiscussion(
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
    discussion
  });
  const requirementContract = buildRequirementContract({
    suggestedAnswers,
    refinement,
    designBlueprint,
    expectedArtifacts: buildExpectedArtifacts("standard_software_development")
  });

  return {
    rawInput: normalizedRawInput,
    summary,
    refinement,
    designBlueprint,
    requirementContract,
    discussion,
    discussionDraft: discussion,
    debate: buildFallbackDebate({
      rawInput: normalizedRawInput,
      summary,
      discussion
    })
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

  const discussion = Array.isArray(input.issue.discussion) && input.issue.discussion.length > 0
    ? input.issue.discussion
    : (Array.isArray(input.issue.discussionDraft) && input.issue.discussionDraft.length > 0
      ? input.issue.discussionDraft
      : synthesized.discussion);
  const hasIssueDebate = Boolean(
    input.issue.debate
    && (
      input.issue.debate.consensus.length > 0
      || input.issue.debate.divergences.length > 0
      || input.issue.debate.opinions.length > 0
    )
  );

  return {
    ...synthesized,
    rawInput: sanitizeLine(input.issue.rawInput || inferredRawInput, inferredRawInput),
    summary: sanitizeLine(input.issue.summary || synthesized.summary, synthesized.summary),
    requirementContract: hasMeaningfulRequirementContract(input.issue.requirementContract)
      ? input.issue.requirementContract
      : synthesized.requirementContract,
    refinement: hasMeaningfulRefinement(input.issue.refinement)
      ? input.issue.refinement
      : synthesized.refinement,
    designBlueprint: hasMeaningfulDesignBlueprint(input.issue.designBlueprint)
      ? input.issue.designBlueprint
      : synthesized.designBlueprint,
    discussion,
    discussionDraft: Array.isArray(input.issue.discussionDraft) && input.issue.discussionDraft.length > 0
      ? input.issue.discussionDraft
      : discussion,
    debate: hasIssueDebate ? input.issue.debate : synthesized.debate
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
  const roleDecisions = roleDecisionsFromDiscussion.length > 0
    ? roleDecisionsFromDiscussion
    : roleDecisionsFromOpinions;

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

function buildSeededInputs(issue: PrepIssueLike, blocks: {
  debate: string;
  analysis: string;
  requirement: string;
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
  };
}) {
  const rawRequirementsContent = [
    "# rawRequirements",
    "",
    sanitizeLine(input.rawInput, "待补充原始需求"),
    "",
    input.blocks.debate,
    "",
    input.blocks.analysis,
    "",
    input.blocks.requirement
  ].join("\n");
  const prdContent = [
    "# prd",
    "",
    input.blocks.analysis,
    "",
    input.blocks.requirement
  ].join("\n");
  const debateSummaryContent = [
    "# debateSummary",
    "",
    input.blocks.debate
  ].join("\n");
  return [
    {
      name: "rawRequirements",
      type: "document",
      description: "项目创建后自动生成：原始需求 + 多Agent讨论结论 + 需求分析草案",
      content: rawRequirementsContent
    },
    {
      name: "prd",
      type: "document",
      description: "项目创建后自动生成：需求分析草案与需求确认单",
      content: prdContent
    },
    {
      name: "debateSummary",
      type: "document",
      description: "项目创建后自动生成：多Agent讨论结论摘要",
      content: debateSummaryContent
    }
  ] as const;
}

function ensureSection(description: string, sectionContent: string, sectionTitle: string) {
  const source = String(description || "").trim();
  if (source.includes(sectionTitle)) {
    return source;
  }
  if (!source) {
    return sectionContent;
  }
  return `${source}\n\n${sectionContent}`;
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
  const missingItems: string[] = [];
  if (!draft.discussion) {
    missingItems.push("多Agent讨论结论");
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
    projectInputs
  });
  const requirementBlock = buildRequirementContractBlock(prepIssueLike);
  const debateBlock = buildDebateConclusionSection(prepIssueLike);
  const analysisBlock = buildAnalysisDraftSection(prepIssueLike);
  let nextDescription = ensureSection(String(project.description || ""), debateBlock, DISCUSSION_SECTION_TITLE);
  nextDescription = ensureSection(nextDescription, analysisBlock, ANALYSIS_SECTION_TITLE);

  const seededInputs = buildSeededInputs(prepIssueLike, {
    debate: debateBlock,
    analysis: analysisBlock,
    requirement: requirementBlock
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
            inputSource: "template_generated"
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
            inputSource: "template_generated"
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
  if (!hasDiscussion && !hasAnalysis && !hasRawRequirements && !hasPrd && !hasDebateSummary) {
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

    const upsertInputContent = async (name: "rawRequirements" | "prd" | "debateSummary", content: string | undefined) => {
      if (typeof content !== "string") {
        return;
      }
      const key = normalizeKey(name);
      const existing = byKey.get(key);
      const normalizedContent = String(content).trim();
      if (existing) {
        await tx.projectInput.update({
          where: { id: existing.id },
          data: {
            type: "document",
            content: normalizedContent,
            description: existing.description || `预备阶段草案编辑：${name}`,
            validationStatus: normalizedContent ? "valid" : "warning",
            validationErrors: normalizedContent ? [] : ["内容为空"],
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
          content: normalizedContent || undefined,
          validationStatus: normalizedContent ? "valid" : "warning",
          validationErrors: normalizedContent ? [] : ["内容为空"],
          inputSource: "manual"
        }
      });
    };

    await upsertInputContent("rawRequirements", draftInput.rawRequirements);
    await upsertInputContent("prd", draftInput.prd);
    await upsertInputContent("debateSummary", draftInput.debateSummary);
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
  });

  return evaluateProjectPostCreatePrepStatus({
    projectId: project.id,
    description: nextDescription,
    projectType: project.projectType
  });
}
