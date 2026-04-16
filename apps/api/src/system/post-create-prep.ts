import { prisma } from "../db.js";
import {
  getIssueByProjectId,
  type IssueRecord
} from "./v1-method-store.js";

const DISCUSSION_SECTION_TITLE = "## 多Agent需求讨论结论";
const ANALYSIS_SECTION_TITLE = "## 项目详情理解确认草案";
const PREP_CONFIRM_SECTION_TITLE = "## 预备阶段用户确认";
const REQUIRED_INPUT_NAMES = ["rawRequirements", "prd", "debateSummary"] as const;

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

function extractStructuredLines(description: string, fallback: string) {
  const raw = String(description || "").replace(/\r/g, "\n");
  const chunks = raw
    .split(/\n+/)
    .flatMap((line) => line.split(/[。！？!?；;]+/))
    .map((line) => sanitizeLine(line, ""))
    .filter(Boolean);
  return dedupeLines(chunks.slice(0, 8), fallback);
}

function buildFallbackRequirementContractBlock(projectDescription: string) {
  const lines = extractStructuredLines(projectDescription, "待补充业务目标");
  const objective = lines[0] || "待补充业务目标";
  const inScope = lines.slice(0, 3);
  return [
    "需求确认单:",
    `- 目标: ${objective}`,
    `- In Scope: ${inScope.join("；") || "待补充首期范围"}`,
    "- Out of Scope: 非首期扩展场景、复杂运营后台、跨域系统重构。",
    "- 验收: 主链路可运行；核心页面可交互；关键限制与风险有明确结论。",
    "- 产出: 需求分析文档、项目排期方案、设计输入、研发实现与验收报告。"
  ].join("\n");
}

function buildFallbackDebateConclusionSection(projectDescription: string) {
  const lines = extractStructuredLines(projectDescription, "待补充需求上下文");
  const consensus = dedupeLines([
    `围绕“${lines[0] || "当前项目目标"}”收敛 MVP，先保证主链路闭环。`,
    "先完成需求边界、交互主链路和验收标准，再推进设计与研发实施。"
  ], "当前无结构化共识条目，需在后续阶段补充。");
  const divergences = dedupeLines([
    "范围可能过宽，需在分析阶段明确非目标范围并冻结首期边界。",
    "部分业务约束未显式给出，需在项目详情确认草案中补齐假设与风险。"
  ], "当前无显式分歧项。");
  const roleDecisions = [
    "- 需求分析师: 先把目标、范围、约束、风险结构化，形成可执行分析稿。",
    "- 产品经理: 在分析稿基础上明确优先级、验收标准与阶段排期。",
    "- 项目经理: 以门禁驱动推进，未补齐讨论与回填前禁止进入正式执行页。"
  ];
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
    ...roleDecisions,
    "",
    "### 决策锚点",
    `- ${lines[0] || "围绕已确认业务目标推进 MVP。"}`
  ].join("\n");
}

function buildFallbackAnalysisDraftSection(projectDescription: string) {
  const lines = extractStructuredLines(projectDescription, "待补充核心场景");
  const inScope = dedupeLines(lines.slice(0, 3), "待补充首期范围");
  const outOfScope = dedupeLines([
    "非首期复杂扩展功能",
    "与主链路无直接关联的外围能力",
    "超出当前资源窗口的大规模重构"
  ], "待补充非目标范围");
  const acceptance = dedupeLines([
    "关键用户链路可端到端执行",
    "阶段交付物可追溯到需求与决策结论",
    "风险与待确认项可被后续阶段持续跟踪"
  ], "待补充验收标准");
  const risks = dedupeLines([
    "输入需求可能存在歧义，需在分析阶段继续澄清。",
    "若缺少角色级决策证据，后续阶段容易回退。"
  ], "暂无新增高风险，按阶段门禁继续验证。");

  return [
    ANALYSIS_SECTION_TITLE,
    "",
    `- 目标: ${lines[0] || "待补充项目目标"}`,
    "- 设计主题: 以可执行、可验收、可交接为优先",
    "",
    "### 核心场景",
    ...dedupeLines(lines.slice(0, 4), "待补充核心场景").map((item) => `- ${item}`),
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

function buildRequirementContractBlock(issue: IssueRecord) {
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

function buildDebateConclusionSection(issue: IssueRecord) {
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

function buildAnalysisDraftSection(issue: IssueRecord) {
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

function buildSeededInputs(issue: IssueRecord, blocks: {
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
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true, description: true, projectType: true }
  });
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

  const requirementBlock = source.issue && source.issue.status === "confirmed"
    ? buildRequirementContractBlock(source.issue)
    : buildFallbackRequirementContractBlock(source.projectDescription);
  const debateBlock = source.issue && source.issue.status === "confirmed"
    ? buildDebateConclusionSection(source.issue)
    : buildFallbackDebateConclusionSection(source.projectDescription);
  const analysisBlock = source.issue && source.issue.status === "confirmed"
    ? buildAnalysisDraftSection(source.issue)
    : buildFallbackAnalysisDraftSection(source.projectDescription);
  let nextDescription = ensureSection(String(project.description || ""), debateBlock, DISCUSSION_SECTION_TITLE);
  nextDescription = ensureSection(nextDescription, analysisBlock, ANALYSIS_SECTION_TITLE);

  const seededInputs = source.issue && source.issue.status === "confirmed"
    ? buildSeededInputs(source.issue, {
      debate: debateBlock,
      analysis: analysisBlock,
      requirement: requirementBlock
    })
    : buildSeededInputsFromRawInput({
      rawInput: source.projectDescription,
      blocks: {
        debate: debateBlock,
        analysis: analysisBlock,
        requirement: requirementBlock
      }
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
