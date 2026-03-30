import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  ROLE_LABELS,
  STAGE_LABELS,
  type AgentProfile,
  type CreateProjectInput,
  type ProjectMessageInput,
  type ParsedIntent,
  type ProjectDetail,
  type ProjectStatus,
  type ProjectSummary,
  type RoleType,
  type RuntimeMode,
  type StageRejectInput,
  type StageSubmissionInput,
  type Stage,
  type StageType,
  type SystemHealth,
  type Task,
  type TaskBoardItem,
  type TaskStatus,
  type TimelineEvent
} from "@occ/shared";
import { prisma } from "../db.js";
import { getRuntimeStatus, runStageAgent } from "../agents/runtime.js";
import {
  finalizeRequirementBackfill,
  getIssueByProjectId,
  type RequirementContract
} from "../system/v1-method-store.js";
import { generateOfficialSiteArtifact } from "../utils/official-site.js";
import {
  buildDeliverables,
  buildStageLiveSession,
  buildStages,
  buildTasks,
  buildTimeline,
  createSeedProject,
  createSeedProjects,
  seedAgents,
  stageAssignees
} from "./seed-data.js";
import { previewRequirement } from "../utils/project-parser.js";

const stageOrder: StageType[] = ["INIT", "ANALYSIS", "DESIGN", "DEV", "ACCEPT"];
const DESIGN_REVIEW_MARKER = "## 设计审查卡";
const MIN_DELIVERABLE_CONTENT_LENGTH = 180;
const STAGE_OBJECTIVES: Record<StageType, string> = {
  INIT: "确认项目目标、边界与团队分工，建立执行基线。",
  ANALYSIS: "把输入需求转成结构化需求合同、约束与风险清单。",
  DESIGN: "输出可执行设计方案，明确信息架构、视觉方向与交互规则。",
  DEV: "把设计与任务拆解落地为可运行实现，并完成联调验证。",
  ACCEPT: "完成验收验证、结果总结与文档回填，形成可持续迭代闭环。"
};

const STAGE_NEXT_INPUT: Record<StageType, string> = {
  INIT: "将项目章程与角色分工交给分析阶段继续细化。",
  ANALYSIS: "把需求合同、排期和风险清单交给设计阶段产出方案。",
  DESIGN: "把设计审查卡、方案文档和组件规范交给开发阶段执行。",
  DEV: "把实现结果、测试证据和发布说明交给验收阶段评审。",
  ACCEPT: "把验收结论和回填结果同步到产品说明文档，作为下轮需求输入。"
};

function normalizeDesignReview(input: StageSubmissionInput["designReview"]) {
  if (!input) {
    return null;
  }

  const visualDirection = String(input.visualDirection ?? "").trim();
  const brandTone = String(input.brandTone ?? "").trim();
  const approvedBy = String(input.approvedBy ?? "").trim();
  const approved = Boolean(input.approved);
  const uxPrinciples = (Array.isArray(input.uxPrinciples) ? input.uxPrinciples : [])
    .map((item) => String(item).trim())
    .filter(Boolean);
  const accessibilityChecklist = (Array.isArray(input.accessibilityChecklist) ? input.accessibilityChecklist : [])
    .map((item) => String(item).trim())
    .filter(Boolean);
  const notes = String(input.notes ?? "").trim();

  if (!visualDirection || !brandTone || !approvedBy) {
    return null;
  }

  if (uxPrinciples.length < 3 || accessibilityChecklist.length < 3) {
    return null;
  }

  return {
    visualDirection,
    brandTone,
    approvedBy,
    approved,
    uxPrinciples,
    accessibilityChecklist,
    notes
  };
}

function validateDesignSubmission(content: string) {
  const normalized = content.trim();
  if (normalized.length < 260) {
    return ["设计交付内容过短（至少 260 字）"];
  }

  const requiredSections = ["## 视觉方案", "## 版式策略", "## 组件清单", "## 品牌语气"];
  const missingSections = requiredSections.filter((section) => !normalized.includes(section));

  const bullets = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));

  const errors: string[] = [];
  if (missingSections.length > 0) {
    errors.push(`缺少关键章节：${missingSections.join("、")}`);
  }
  if (bullets.length < 8) {
    errors.push("设计说明颗粒度不足（至少 8 条要点）");
  }

  return errors;
}

function renderDesignReviewCard(input: {
  visualDirection: string;
  brandTone: string;
  approvedBy: string;
  approved: boolean;
  uxPrinciples: string[];
  accessibilityChecklist: string[];
  notes: string;
}) {
  const lines = [
    DESIGN_REVIEW_MARKER,
    `- 视觉方向: ${input.visualDirection}`,
    `- 品牌语气: ${input.brandTone}`,
    `- UX 原则: ${input.uxPrinciples.join("；")}`,
    `- 可访问性检查: ${input.accessibilityChecklist.join("；")}`,
    `- 审查人: ${input.approvedBy}`,
    `- 审查结论: ${input.approved ? "通过" : "不通过"}`
  ];

  if (input.notes) {
    lines.push(`- 审查备注: ${input.notes}`);
  }

  return lines.join("\n");
}

function hasApprovedDesignReview(content: string) {
  return content.includes(DESIGN_REVIEW_MARKER) && /审查结论:\s*通过/.test(content);
}

function containsAny(input: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(input));
}

function buildImplementationSummary(project: ProjectDetail) {
  const doneTasks = project.tasks.filter((task) => task.status === "done").length;
  const totalTasks = project.tasks.length;
  const deliverableNames = project.deliverables.map((item) => item.name).slice(0, 8).join("、");
  const stageSummary = `${STAGE_LABELS[project.currentStage]}阶段完成，项目进度 ${project.progress}%`;
  return [
    `${stageSummary}，任务完成 ${doneTasks}/${totalTasks}。`,
    `当前交付物: ${deliverableNames || "暂无"}`,
    `项目总结: ${project.summary}`
  ].join("\n");
}

function evaluateRequirementAlignment(
  project: ProjectDetail,
  input: {
    objective: string;
    inScope: string[];
    acceptanceCriteria: string[];
    artifacts: string[];
  }
) {
  const normalizedAcceptance = input.acceptanceCriteria.join(" ").toLowerCase();
  const deliverableNames = project.deliverables.map((item) => item.name);
  const deliverablesJoined = deliverableNames.join(" ").toLowerCase();
  const blockedTasks = project.tasks.filter((task) => task.status === "blocked");

  const expectedArtifacts = (input.artifacts.length > 0 ? input.artifacts : ["项目排期", "客户汇报方案（PPT）", "实施方案（Word）", "Demo 原型"])
    .map((label) => {
      const pattern = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, ""), "i");
      const fallback =
        label.includes("PPT")
          ? /ppt|汇报方案/i
          : label.toLowerCase().includes("word")
            ? /word|实施方案/i
            : label.toLowerCase().includes("demo")
              ? /demo|原型/i
              : /排期|schedule/i;
      return {
        label,
        matched: pattern.test(deliverablesJoined) || fallback.test(deliverablesJoined)
      };
    });

  const needDemo = containsAny(normalizedAcceptance, [/demo|演示|原型/]);
  const demoReady = expectedArtifacts.find((item) => item.label.includes("Demo"))?.matched ?? false;
  const missingArtifacts = expectedArtifacts.filter((item) => !item.matched).map((item) => item.label);
  const unmetChecks: string[] = [];

  if (!input.objective.trim()) {
    unmetChecks.push("需求合同缺少目标定义");
  }
  if (input.inScope.length === 0) {
    unmetChecks.push("需求合同缺少 In Scope");
  }
  if (input.acceptanceCriteria.length === 0) {
    unmetChecks.push("需求合同缺少验收标准");
  }

  if (project.status !== "completed" || project.progress < 100) {
    unmetChecks.push("项目未达到完成状态");
  }
  if (blockedTasks.length > 0) {
    unmetChecks.push(`仍有阻塞任务 ${blockedTasks.length} 个`);
  }
  if (needDemo && !demoReady) {
    unmetChecks.push("验收要求提及 Demo，但未检测到 Demo 产物");
  }
  if (missingArtifacts.length > 0) {
    unmetChecks.push(`缺少关键产出物: ${missingArtifacts.join("、")}`);
  }

  const matched = unmetChecks.length === 0;
  const validationNote = matched
    ? "实施结果与当前需求目标一致，关键产出物齐全，可回填产品说明文档。"
    : `检测到不一致项: ${unmetChecks.join("；")}。请先处理后再继续新需求。`;

  return {
    matched,
    validationNote
  };
}

async function syncRequirementBackfillOnProjectCompleted(project: ProjectDetail) {
  if (project.status !== "completed") {
    return;
  }

  const issue = await getIssueByProjectId(project.id);
  if (!issue) {
    return;
  }

  const contract = issue.requirementContract;
  const objective = contract?.objective || String(issue.clarificationAnswers.goal ?? "");
  const inScope = contract?.inScope ?? (issue.clarificationAnswers.scope ? [issue.clarificationAnswers.scope] : []);
  const acceptanceCriteria = contract?.acceptanceCriteria ?? (issue.clarificationAnswers.acceptance ? [issue.clarificationAnswers.acceptance] : []);
  const artifacts = contract?.artifacts ?? [];
  const implementationSummary = buildImplementationSummary(project);
  const alignment = evaluateRequirementAlignment(project, {
    objective,
    inScope,
    acceptanceCriteria,
    artifacts
  });

  await finalizeRequirementBackfill({
    issueId: issue.id,
    projectId: project.id,
    title: issue.title || project.name,
    refinedRequirement: issue.rawInput || project.description,
    implementationSummary,
    validationStatus: alignment.matched ? "matched" : "mismatch",
    validationNote: alignment.validationNote,
    requirementContract: contract
  });

  try {
    const artifact = await generateOfficialSiteArtifact(project);
    const currentAcceptMaxVersion = project.deliverables
      .filter((item) => item.stageType === "ACCEPT")
      .reduce((max, item) => Math.max(max, item.version), 0);

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existing = await tx.deliverable.findFirst({
        where: {
          projectId: project.id,
          stageType: "ACCEPT",
          name: "官网演示页.html"
        },
        orderBy: { version: "desc" }
      });

      const content = [
        "# 官网演示页",
        "",
        "此页面由设计/开发/验收交付物自动汇总生成。",
        `访问地址: ${artifact.publicPath}`,
        `本地文件: ${artifact.filePaths[0]}`
      ].join("\n");

      if (existing) {
        await tx.deliverable.update({
          where: { id: existing.id },
          data: {
            status: "approved",
            content,
            updatedAt: new Date()
          }
        });
      } else {
        await tx.deliverable.create({
          data: {
            projectId: project.id,
            stageType: "ACCEPT",
            name: "官网演示页.html",
            type: "code",
            content,
            version: currentAcceptMaxVersion + 1,
            status: "approved",
            createdBy: "ROLE_DESIGN",
            updatedAt: new Date()
          }
        });
      }

      await tx.timelineEvent.create({
        data: {
          projectId: project.id,
          timestamp: new Date(),
          agentId: "ROLE_DESIGN",
          type: "system",
          title: "官网演示页已生成",
          content: `已生成高保真官网产物，路径：${artifact.publicPath}`,
          priority: "normal"
        }
      });
    });
  } catch {
    // 生成官网产物失败时不阻断主流程，避免影响项目收敛与回填。
  }
}

function formatRequirementContract(contract: RequirementContract) {
  return [
    `目标: ${contract.objective || "待补充"}`,
    `In Scope: ${(contract.inScope || []).join("；") || "待补充"}`,
    `Out of Scope: ${(contract.outOfScope || []).join("；") || "待补充"}`,
    `验收标准: ${(contract.acceptanceCriteria || []).join("；") || "待补充"}`,
    `目标产出: ${(contract.artifacts || []).join("、") || "待补充"}`,
    contract.designTheme ? `设计主题: ${contract.designTheme}` : "",
    contract.valueNarrative ? `价值叙事: ${contract.valueNarrative}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function enrichProjectWithRequirementContract(project: ProjectDetail, contract?: RequirementContract) {
  if (!contract) {
    return project;
  }

  const contractBlock = `\n\n## 需求合同\n${formatRequirementContract(contract)}`;
  project.deliverables = project.deliverables.map((deliverable) => {
    if (deliverable.name.includes("需求分析文档")) {
      return {
        ...deliverable,
        content: `${deliverable.content}${contractBlock}`
      };
    }
    if (deliverable.name.includes("项目排期方案")) {
      return {
        ...deliverable,
        content: `${deliverable.content}\n\n## 需求合同约束\n- ${contract.objective}`
      };
    }
    if (deliverable.name.includes("产品方案草案") || deliverable.name.toLowerCase().includes("word")) {
      return {
        ...deliverable,
        content: `${deliverable.content}${contractBlock}`
      };
    }
    return deliverable;
  });

  project.summary = `${project.summary} 已绑定需求合同并同步到交付物。`;
  project.timeline.unshift({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    agentId: "ROLE_ANALYST",
    type: "message",
    title: "需求合同已绑定项目",
    content: `需求合同已注入交付物，目标: ${contract.objective || "待补充"}`,
    priority: "normal"
  });
  return project;
}

export async function ensureSeedData(runtimeMode: RuntimeMode) {
  await ensureProjectExecutionStorage();

  const existingAgents = await prisma.agentProfile.count();
  if (existingAgents === 0) {
    await prisma.agentProfile.createMany({
      data: seedAgents.map((agent) => ({
        ...agent,
        styles: agent.styles,
        skills: agent.skills,
        recentHighlights: agent.recentHighlights
      }))
    });
  }

  const existingProjects = await prisma.project.count();
  if (existingProjects === 0) {
    const seeds = createSeedProjects(runtimeMode);
    for (const project of seeds) {
      await persistProject(project);
    }
  } else {
    await backfillProjectTasks();
  }

  await reconcileLegacyStageDeliverables();

  const allowRealtimeBackfillOnBoot =
    runtimeMode === "scripted" || process.env.REAL_MODEL_BOOT_RECONCILE === "true";

  if (allowRealtimeBackfillOnBoot) {
    await reconcileAllProjectsDeliverables();
  }
}

async function ensureProjectExecutionStorage() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ProjectExecution" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "projectId" TEXT NOT NULL,
      "stageType" TEXT NOT NULL,
      "role" TEXT NOT NULL,
      "action" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "provider" TEXT,
      "model" TEXT,
      "requestedMode" TEXT,
      "runtimeMode" TEXT,
      "promptSummary" TEXT,
      "outputPreview" TEXT,
      "errorMessage" TEXT,
      "latencyMs" INTEGER,
      "metadata" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "ProjectExecution_projectId_fkey"
        FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ProjectExecution_projectId_createdAt_idx"
    ON "ProjectExecution"("projectId", "createdAt")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ProjectExecution_projectId_stageType_createdAt_idx"
    ON "ProjectExecution"("projectId", "stageType", "createdAt")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ProjectExecution_status_createdAt_idx"
    ON "ProjectExecution"("status", "createdAt")
  `);
}

async function reconcileLegacyStageDeliverables() {
  const completedStages = await prisma.stage.findMany({
    where: { status: "completed" },
    select: {
      projectId: true,
      type: true
    }
  });

  if (completedStages.length === 0) {
    return;
  }

  await prisma.$transaction(
    completedStages.map((stage) =>
      prisma.deliverable.updateMany({
        where: {
          projectId: stage.projectId,
          stageType: stage.type,
          status: "submitted"
        },
        data: {
          status: "approved"
        }
      })
    )
  );
}

async function reconcileAllProjectsDeliverables() {
  const projects = await prisma.project.findMany({
    select: { id: true }
  });

  for (const project of projects) {
    const record = await loadProjectRecord(project.id);
    if (!record) {
      continue;
    }
    await reconcileProjectDeliverables(record);
  }
}

async function loadProjectRecord(id: string) {
  return prisma.project.findUnique({
    where: { id },
    include: {
      stages: { orderBy: { sortOrder: "asc" } },
      tasks: { orderBy: [{ stageType: "asc" }, { sortOrder: "asc" }] },
      deliverables: { orderBy: [{ updatedAt: "desc" }] },
      timeline: { orderBy: { timestamp: "desc" } }
    }
  });
}

type ProjectRecord = NonNullable<Awaited<ReturnType<typeof loadProjectRecord>>>;

function formatTaskStatusLabel(status: string) {
  if (status === "done") return "已完成";
  if (status === "in_progress") return "进行中";
  if (status === "blocked") return "阻塞";
  return "待处理";
}

function extractMarkdownSection(content: string, title: string) {
  const regex = new RegExp(`${title}\\n([\\s\\S]*?)(\\n##\\s|$)`);
  const matched = String(content || "").match(regex);
  return matched?.[1]?.trim() || "";
}

function buildExecutionOutputPreview(content: string, limit = 260) {
  const source = [
    extractMarkdownSection(content, "## Agent 输出正文"),
    extractMarkdownSection(content, "## 项目摘要"),
    extractMarkdownSection(content, "## 阶段目标"),
    String(content || "")
  ].find((item) => item && item.trim().length > 0) || "";

  const normalized = source.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

type StageAgentExecutionInput = {
  projectId: string;
  action: string;
  metadata?: Prisma.InputJsonValue;
  projectName: string;
  projectDescription: string;
  parsedIntent: ParsedIntent;
  stageType: StageType;
  role: RoleType;
  summary?: string;
};

type StageAgentExecutionRecord = {
  id: string;
  projectId: string;
  stageType: string;
  role: string;
  action: string;
  status: string;
  provider?: string | null;
  model?: string | null;
  requestedMode?: string | null;
  runtimeMode?: string | null;
  promptSummary?: string | null;
  outputPreview?: string | null;
  errorMessage?: string | null;
  latencyMs?: number | null;
  metadata?: Prisma.JsonValue;
  createdAt: string;
  updatedAt: string;
};

async function persistProjectExecutionSafe(data: Prisma.ProjectExecutionUncheckedCreateInput) {
  try {
    const projectExists = await prisma.project.count({
      where: { id: data.projectId }
    });

    if (!projectExists) {
      return;
    }

    await prisma.projectExecution.create({ data });
  } catch (error) {
    console.warn(
      `[projectExecution] failed to persist execution record for project=${data.projectId}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

export async function runProjectStageAgent(input: StageAgentExecutionInput) {
  const startedAt = Date.now();
  const runtime = await getRuntimeStatus();

  try {
    const run = await runStageAgent({
      projectName: input.projectName,
      projectDescription: input.projectDescription,
      parsedIntent: input.parsedIntent,
      stageType: input.stageType,
      role: input.role,
      summary: input.summary
    });

    await persistProjectExecutionSafe({
      projectId: input.projectId,
      stageType: input.stageType,
      role: input.role,
      action: input.action,
      status: "success",
      provider: run.provider,
      model: run.model,
      requestedMode: runtime.requestedMode,
      runtimeMode: runtime.mode,
      promptSummary: input.summary || null,
      outputPreview: buildExecutionOutputPreview(run.body),
      latencyMs: Math.max(0, Date.now() - startedAt),
      metadata: input.metadata
    });

    return run;
  } catch (error) {
    await persistProjectExecutionSafe({
      projectId: input.projectId,
      stageType: input.stageType,
      role: input.role,
      action: input.action,
      status: "failed",
      provider: runtime.mode,
      model: runtime.modelName,
      requestedMode: runtime.requestedMode,
      runtimeMode: runtime.mode,
      promptSummary: input.summary || null,
      errorMessage: error instanceof Error ? error.message : String(error),
      latencyMs: Math.max(0, Date.now() - startedAt),
      metadata: input.metadata
    });

    throw error;
  }
}

function needsDeliverableBackfill(content: string) {
  const normalized = String(content ?? "").trim();
  if (!normalized) {
    return true;
  }
  if (normalized.length < MIN_DELIVERABLE_CONTENT_LENGTH) {
    return true;
  }
  return !normalized.includes("## ");
}

function needsDeliverableAgentUpgrade(content: string, deliverableName: string) {
  const normalized = String(content ?? "");
  const trimmed = normalized.trim();
  const name = String(deliverableName || "");
  if (!trimmed) {
    return true;
  }

  // Legacy auto templates: metadata exists but no runtime/model evidence.
  if (trimmed.includes("## 交付物元信息") && !trimmed.includes("执行引擎:")) {
    return true;
  }

  // Early automation payloads.
  if (/^#\s*(设计阶段自动交付|自动提交-)/m.test(trimmed)) {
    return true;
  }

  if (
    /(项目排期|客户汇报|实施方案|需求分析|Demo|原型|官网演示|测试报告|回填)/i.test(name)
    && !trimmed.includes("执行引擎:")
  ) {
    return true;
  }

  return false;
}

function buildDeliverableBackfillContent(project: ProjectRecord, deliverable: ProjectRecord["deliverables"][number]) {
  const stageType = (deliverable.stageType as StageType);
  const stageLabel = STAGE_LABELS[stageType] || deliverable.stageType;
  const stageTasks = project.tasks.filter((task) => task.stageType === deliverable.stageType).slice(0, 6);
  const constraints = readStringArray(project.parsedConstraints).slice(0, 4);
  const risks = readStringArray(project.parsedRisks).slice(0, 4);
  const keywords = readStringArray(project.parsedKeywords).slice(0, 6);
  const createdBy = String(deliverable.createdBy || "");

  const taskLines = stageTasks.length > 0
    ? stageTasks.map((task, index) => (
      `${index + 1}. ${task.title}（${formatTaskStatusLabel(task.status)} / 优先级 ${task.priority}）\n   - ${task.description || "待补充"}`
    ))
    : ["1. 当前阶段任务暂未编排，建议补充任务后重新提交审批版交付物。"];

  const objective = STAGE_OBJECTIVES[stageType] || "围绕当前阶段目标沉淀可审阅产物。";
  const nextInput = STAGE_NEXT_INPUT[stageType] || "将本阶段产物同步给下一阶段执行角色。";

  return [
    `# ${deliverable.name}`,
    "",
    "## 交付物元信息",
    `- 项目: ${project.name} (${project.id})`,
    `- 阶段: ${stageLabel} (${deliverable.stageType})`,
    `- 当前状态: ${deliverable.status} · 版本 v${deliverable.version}`,
    `- 产出角色: ${ROLE_LABELS[createdBy as RoleType] || createdBy || "系统"}`,
    `- 更新时间: ${deliverable.updatedAt.toISOString()}`,
    "",
    "## 阶段目标",
    `- ${objective}`,
    "",
    "## 当前任务清单",
    ...taskLines,
    "",
    "## 关键约束",
    ...(constraints.length > 0 ? constraints.map((item) => `- ${item}`) : ["- 暂无明确约束，建议补充业务边界和非功能要求。"]),
    "",
    "## 主要风险",
    ...(risks.length > 0 ? risks.map((item) => `- ${item}`) : ["- 暂无显式风险，建议补充依赖、资源和时间风险。"]),
    "",
    "## 关键词上下文",
    ...(keywords.length > 0 ? keywords.map((item) => `- ${item}`) : ["- 暂无关键词，可从需求原文中提取业务术语。"]),
    "",
    "## 下一阶段输入",
    `- ${nextInput}`,
    "- 如需变更目标或范围，请先在需求合同中更新后再推进。",
    "",
    "## 审阅与验收建议",
    "- 审阅是否覆盖目标、范围、风险、任务与交付证据。",
    "- 若信息不足，请在当前文档补全后再次提交阶段审批。"
  ].join("\n");
}

function resolveStageType(value: string): StageType | null {
  const normalized = String(value || "").toUpperCase();
  return stageOrder.includes(normalized as StageType) ? (normalized as StageType) : null;
}

function buildDeliverableChecklist(deliverableName: string, stageType: StageType) {
  const lowerName = String(deliverableName || "").toLowerCase();

  if (/ppt|汇报|路演/.test(lowerName)) {
    return [
      "包含背景、目标、范围、里程碑、风险与下一步。",
      "每页信息层级清晰，可直接用于客户汇报。",
      "包含预约演示入口与可执行行动项。"
    ];
  }

  if (/word|实施方案|执行方案|落地方案/.test(lowerName)) {
    return [
      "明确阶段拆解、负责人、输入输出与依赖关系。",
      "补充交付标准、验收方式、风险与缓冲策略。",
      "可直接作为研发执行基线，不依赖口头补充。"
    ];
  }

  if (/demo|原型|演示|官网/.test(lowerName)) {
    return [
      "主流程可操作、可演示，关键交互有明确反馈。",
      "支持桌面与移动端基础适配，保留核心 CTA。",
      "能体现“需求到研发闭环、角色协作、实时监控”三条价值线。"
    ];
  }

  if (/回填|验收|测试/.test(lowerName) || stageType === "ACCEPT") {
    return [
      "验收结论可追溯到需求目标与验收标准。",
      "总结新增能力、影响范围与已知限制。",
      "回填到产品说明文档并记录版本与时间戳。"
    ];
  }

  if (stageType === "ANALYSIS") {
    return [
      "明确目标、范围、约束、风险与验收标准。",
      "输出可执行排期与阶段交接条件。",
      "让设计与研发角色可直接接力。"
    ];
  }

  if (stageType === "DESIGN") {
    return [
      "输出视觉方向、版式策略、组件规范与 CTA 逻辑。",
      "包含可访问性检查与审查结论。",
      "支持直接进入开发实现。"
    ];
  }

  if (stageType === "DEV") {
    return [
      "描述实现范围、核心模块与联调状态。",
      "记录验证结果与遗留风险。",
      "提供进入验收阶段的证据清单。"
    ];
  }

  return [
    "覆盖当前阶段目标与关键任务。",
    "包含可执行下一步与责任归属。",
    "提供可审阅证据，支持阶段决策。"
  ];
}

async function buildDeliverableBackfillContentWithAgent(
  project: ProjectRecord,
  deliverable: ProjectRecord["deliverables"][number],
  stageRunCache: Map<string, Awaited<ReturnType<typeof runStageAgent>>>
) {
  const stageType = resolveStageType(deliverable.stageType);
  if (!stageType) {
    return buildDeliverableBackfillContent(project, deliverable);
  }

  const stageLabel = STAGE_LABELS[stageType] || deliverable.stageType;
  const stageTasks = project.tasks.filter((task) => task.stageType === deliverable.stageType).slice(0, 6);
  const constraints = readStringArray(project.parsedConstraints).slice(0, 4);
  const risks = readStringArray(project.parsedRisks).slice(0, 4);
  const keywords = readStringArray(project.parsedKeywords).slice(0, 6);
  const createdBy = String(deliverable.createdBy || "");
  const stageRole = stageAssignees[stageType] || (createdBy as RoleType) || "ROLE_PM";
  const parsedIntent = {
    keywords: readStringArray(project.parsedKeywords),
    constraints: readStringArray(project.parsedConstraints),
    risks: readStringArray(project.parsedRisks),
    suggestedTeam: readRoleArray(project.parsedSuggestedTeam),
    summary: project.parsedSummary
  };
  const stageObjective = STAGE_OBJECTIVES[stageType] || "围绕当前阶段目标沉淀可审阅产物。";
  const nextInput = STAGE_NEXT_INPUT[stageType] || "将本阶段产物同步给下一阶段执行角色。";
  const taskLines = stageTasks.length > 0
    ? stageTasks.map((task, index) => (
      `${index + 1}. ${task.title}（${formatTaskStatusLabel(task.status)} / 优先级 ${task.priority}）\n   - ${task.description || "待补充"}`
    ))
    : ["1. 当前阶段任务暂未编排，建议补充任务后重新提交审批版交付物。"];
  const checklist = buildDeliverableChecklist(deliverable.name, stageType);

  const runCacheKey = `${stageType}:${deliverable.name}`;
  let run = stageRunCache.get(runCacheKey);
  if (!run) {
    run = await runProjectStageAgent({
      projectId: project.id,
      action: "deliverable.backfill",
      metadata: {
        deliverableId: deliverable.id,
        deliverableName: deliverable.name
      },
      projectName: project.name,
      projectDescription: project.description,
      parsedIntent,
      stageType,
      role: stageRole,
      summary: `请输出“${deliverable.name}”的正式交付内容，必须可被下一阶段直接执行，并提供可验收要点。`
    });
    stageRunCache.set(runCacheKey, run);
  }

  return [
    `# ${deliverable.name}`,
    "",
    "## 交付物元信息",
    `- 项目: ${project.name} (${project.id})`,
    `- 阶段: ${stageLabel} (${deliverable.stageType})`,
    `- 当前状态: ${deliverable.status} · 版本 v${deliverable.version}`,
    `- 产出角色: ${ROLE_LABELS[stageRole] || stageRole}`,
    `- 执行引擎: ${run.provider} · 模型 ${run.model}`,
    `- 更新时间: ${deliverable.updatedAt.toISOString()}`,
    "",
    "## 阶段目标",
    `- ${stageObjective}`,
    "",
    "## 当前任务清单",
    ...taskLines,
    "",
    "## Agent 输出正文",
    run.body,
    "",
    "## 关键约束",
    ...(constraints.length > 0 ? constraints.map((item) => `- ${item}`) : ["- 暂无明确约束，建议补充业务边界和非功能要求。"]),
    "",
    "## 主要风险",
    ...(risks.length > 0 ? risks.map((item) => `- ${item}`) : ["- 暂无显式风险，建议补充依赖、资源和时间风险。"]),
    "",
    "## 关键词上下文",
    ...(keywords.length > 0 ? keywords.map((item) => `- ${item}`) : ["- 暂无关键词，可从需求原文中提取业务术语。"]),
    "",
    "## 验收检查清单",
    ...checklist.map((item) => `- ${item}`),
    "",
    "## 下一阶段输入",
    `- ${nextInput}`,
    "- 如需变更目标或范围，请先在需求合同中更新后再推进。"
  ].join("\n");
}

async function reconcileProjectDeliverables(project: ProjectRecord) {
  const stageStatusByType = new Map(project.stages.map((stage) => [stage.type, stage.status]));
  const stageRunCache = new Map<string, Awaited<ReturnType<typeof runStageAgent>>>();
  const updates: Array<{ id: string; content: string; status?: string }> = [];
  const creates: Array<{
    projectId: string;
    stageType: string;
    name: string;
    type: string;
    content: string;
    version: number;
    status: string;
    createdBy: string;
    updatedAt: Date;
  }> = [];
  const now = new Date();

  for (const deliverable of project.deliverables) {
    const stageStatus = stageStatusByType.get(deliverable.stageType);
    const shouldPromoteStatus =
      project.status === "completed"
      && stageStatus === "completed"
      && (deliverable.status === "draft" || deliverable.status === "submitted");

    const needBackfill = needsDeliverableBackfill(deliverable.content)
      || needsDeliverableAgentUpgrade(deliverable.content, deliverable.name);
    if (!needBackfill && !shouldPromoteStatus) {
      continue;
    }

    const backfilledContent = needBackfill
      ? await buildDeliverableBackfillContentWithAgent(project, deliverable, stageRunCache)
      : deliverable.content;

    updates.push({
      id: deliverable.id,
      content: backfilledContent,
      status: shouldPromoteStatus ? "approved" : undefined
    });
  }

  for (const stage of project.stages) {
    const hasStageDeliverable = project.deliverables.some((item) => item.stageType === stage.type);
    if (hasStageDeliverable) {
      continue;
    }
    const maxVersion = project.deliverables
      .filter((item) => item.stageType === stage.type)
      .reduce((max, item) => Math.max(max, item.version), 0);
    const stageStatus = stage.status === "completed" ? "approved" : "draft";
    const stageDraft = {
      id: randomUUID(),
      projectId: project.id,
      stageType: stage.type,
      name: `${STAGE_LABELS[stage.type as StageType] || stage.type}阶段交付物补全.md`,
      type: "markdown",
      content: buildDeliverableBackfillContent(project, {
        id: randomUUID(),
        projectId: project.id,
        stageType: stage.type,
        name: `${STAGE_LABELS[stage.type as StageType] || stage.type}阶段交付物补全.md`,
        type: "markdown",
        content: "",
        version: maxVersion + 1,
        status: stageStatus,
        createdBy: stage.assignee,
        createdAt: now,
        updatedAt: now
      }),
      version: maxVersion + 1,
      status: stageStatus,
      createdBy: stage.assignee,
      updatedAt: now
    };
    creates.push(stageDraft);
  }

  if (updates.length === 0 && creates.length === 0) {
    return false;
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    for (const update of updates) {
      await tx.deliverable.update({
        where: { id: update.id },
        data: {
          content: update.content,
          ...(update.status ? { status: update.status } : {}),
          updatedAt: now
        }
      });
    }

    for (const create of creates) {
      await tx.deliverable.create({ data: create });
    }

    await tx.timelineEvent.create({
      data: {
        projectId: project.id,
        timestamp: now,
        agentId: "ROLE_ASSISTANT",
        type: "system",
        title: "交付物内容已自动补全",
        content: `系统已修复 ${updates.length} 份交付物内容/状态，并补齐 ${creates.length} 个阶段交付物占位文档。阶段执行调用 ${stageRunCache.size} 次。`,
        priority: "normal"
      }
    });
  });

  return true;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const projects = await prisma.project.findMany({
    include: {
      tasks: {
        select: {
          status: true
        }
      }
    },
    orderBy: { updatedAt: "desc" }
  });

  return projects.map(toProjectSummary);
}

export async function listAgents(): Promise<AgentProfile[]> {
  const agents = await prisma.agentProfile.findMany({
    orderBy: { roleId: "asc" }
  });
  const taskGroups = await prisma.task.groupBy({
    by: ["assignee"],
    _count: true,
    where: {
      status: {
        in: ["todo", "in_progress", "blocked"]
      }
    }
  });
  const taskCountByAssignee = new Map(taskGroups.map((group) => [group.assignee, group._count]));

  return agents.map((agent) => toAgentProfile(agent, taskCountByAssignee.get(agent.roleId) ?? 0));
}

export async function findAgent(roleId: RoleType): Promise<AgentProfile | undefined> {
  const agent = await prisma.agentProfile.findUnique({ where: { roleId } });
  if (!agent) {
    return undefined;
  }

  const activeTaskCount = await prisma.task.count({
    where: {
      assignee: roleId,
      status: {
        in: ["todo", "in_progress", "blocked"]
      }
    }
  });

  return toAgentProfile(agent, activeTaskCount);
}

export async function findProject(id: string): Promise<ProjectDetail | undefined> {
  const project = await loadProjectRecord(id);
  return project ? toProjectDetail(project) : undefined;
}

export async function archiveProjectAcceptanceReport(
  id: string,
  markdown: string,
  title?: string
): Promise<ProjectDetail | undefined> {
  const project = await findProject(id);
  if (!project) {
    return undefined;
  }

  const now = new Date();
  const dateTag = now.toISOString().slice(0, 10);
  const reportTitle = title?.trim() || `阶段验收报告-${dateTag}.md`;
  const nextVersion = project.deliverables
    .filter((item) => item.stageType === "ACCEPT" && item.name.startsWith("阶段验收报告"))
    .reduce((max, item) => Math.max(max, item.version), 0) + 1;

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.deliverable.create({
      data: {
        projectId: id,
        stageType: "ACCEPT",
        name: reportTitle,
        type: "markdown",
        content: markdown,
        version: nextVersion,
        status: "approved",
        createdBy: "ROLE_PM",
        updatedAt: now
      }
    });

    await tx.timelineEvent.create({
      data: {
        projectId: id,
        timestamp: now,
        agentId: "ROLE_PM",
        type: "system",
        title: "阶段验收报告已归档",
        content: `${reportTitle} 已写入交付物（v${nextVersion}）。`,
        priority: "normal"
      }
    });
  });

  return findProject(id);
}

export async function createProject(
  input: CreateProjectInput & { requirementContract?: RequirementContract },
  runtimeMode: RuntimeMode
): Promise<ProjectDetail> {
  const parsedIntent = previewRequirement(input.description);
  const id = await nextProjectId();
  const currentStage: StageType = "ANALYSIS";
  const currentRole = stageAssignees[currentStage];

  const run = await runProjectStageAgent({
    projectId: id,
    action: "project.create.bootstrap",
    projectName: input.name?.trim() || parsedIntent.keywords[0] || "未命名项目",
    projectDescription: input.description,
    parsedIntent,
    stageType: currentStage,
    role: currentRole,
    summary: "需求分析师已开始工作，你可以直接进入观测室查看实时输出。"
  });

  const project = createSeedProject(
    {
      id,
      name: input.name?.trim() || parsedIntent.keywords[0] || "未命名项目",
      description: input.description,
      parsedIntent,
      currentStage,
      progress: 12,
      pendingApproval: false,
      currentRole,
      updatedAt: new Date().toISOString(),
      summary: "需求分析师已开始工作，你可以直接进入观测室查看实时输出。"
    },
    runtimeMode
  );

  project.liveSession = {
    activeRole: currentRole,
    title: run.title,
    body: run.body,
    provider: run.provider,
    startedAt: new Date().toISOString()
  };
  project.timeline.unshift({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    agentId: currentRole,
    type: "thinking",
    title: "Agent 已接管阶段",
    content: `${run.thinkingSummary}\n执行引擎: ${run.provider} · 模型 ${run.model}`,
    priority: "normal"
  });
  enrichProjectWithRequirementContract(project, input.requirementContract);

  await persistProject(project);
  await persistProjectExecutionSafe({
    projectId: id,
    stageType: currentStage,
    role: currentRole,
    action: "project.create.bootstrap",
    status: "success",
    provider: run.provider,
    model: run.model,
    requestedMode: runtimeMode,
    runtimeMode,
    promptSummary: "需求分析师已开始工作，你可以直接进入观测室查看实时输出。",
    outputPreview: buildExecutionOutputPreview(run.body),
    metadata: {
      deferredWrite: true,
      source: "createProject"
    }
  });
  return findProject(id).then((value) => value as ProjectDetail);
}

export async function approveProject(id: string): Promise<ProjectDetail | undefined> {
  const project = await findProject(id);

  if (!project || !project.pendingApproval) {
    return project;
  }

  if (project.currentStage === "DESIGN") {
    const designDeliverables = project.deliverables
      .filter((item) => item.stageType === "DESIGN")
      .sort((a, b) => b.version - a.version);
    const latestDesignDeliverable = designDeliverables[0];

    if (!latestDesignDeliverable || !hasApprovedDesignReview(latestDesignDeliverable.content)) {
      throw new Error("DESIGN_REVIEW_NOT_APPROVED: 设计阶段缺少已通过的设计审查卡，禁止进入开发阶段。");
    }
  }

  const currentIndex = stageOrder.indexOf(project.currentStage);
  const currentStage = project.stages[currentIndex];
  const isFinalStage = currentIndex === stageOrder.length - 1;
  const nextStage = isFinalStage ? null : stageOrder[currentIndex + 1];
  const nextRole = nextStage ? stageAssignees[nextStage] : null;
  const nextStageRun = nextStage && nextRole
    ? await runProjectStageAgent({
      projectId: id,
      action: "project.approve.next-stage",
      projectName: project.name,
      projectDescription: project.description,
      parsedIntent: project.parsedIntent,
      stageType: nextStage,
      role: nextRole,
      summary: `${ROLE_LABELS[nextRole]} 已开始 ${STAGE_LABELS[nextStage]} 阶段。`
    })
    : null;

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.stage.update({
      where: { projectId_type: { projectId: id, type: currentStage.type } },
      data: {
        status: "completed",
        progress: 100,
        endedAt: new Date()
      }
    });
    await tx.deliverable.updateMany({
      where: {
        projectId: id,
        stageType: currentStage.type,
        status: "submitted"
      },
      data: {
        status: "approved",
        updatedAt: new Date()
      }
    });
    await tx.task.updateMany({
      where: { projectId: id, stageType: currentStage.type },
      data: { status: "done" }
    });

    await tx.timelineEvent.create({
      data: {
        projectId: id,
        timestamp: new Date(),
        agentId: "ROLE_PM",
        type: "approval_done",
        title: `${currentStage.label}阶段审批通过`,
        content: `你已批准 ${currentStage.label} 阶段，系统继续推进。签核人：项目经理。`,
        priority: "normal"
      }
    });

    if (isFinalStage) {
      await tx.project.update({
        where: { id },
        data: {
          status: "completed",
          progress: 100,
          pendingApproval: false,
          currentRole: "ROLE_HR",
          summary: "项目已完成并进入归档复盘。",
          liveTitle: "HR 总监正在生成项目复盘",
          liveBody:
            "## 项目复盘\n\n- 主流程已完整打通\n- 关键风险暴露在实时协议与阶段边界\n- 推荐将下一阶段重点放在持久化与真实 Agent 编排",
          liveProvider: "scripted",
          liveStartedAt: new Date()
        }
      });
      return;
    }

    await tx.stage.update({
      where: { projectId_type: { projectId: id, type: nextStage as StageType } },
      data: {
        status: "active",
        progress: 18,
        startedAt: new Date()
      }
    });
    await tx.task.updateMany({
      where: { projectId: id, stageType: nextStage as StageType, sortOrder: 0 },
      data: { status: "in_progress" }
    });
    await tx.task.updateMany({
      where: { projectId: id, stageType: nextStage as StageType, sortOrder: { gt: 0 } },
      data: { status: "todo" }
    });

    await tx.project.update({
      where: { id },
      data: {
        currentStage: nextStage as StageType,
        currentRole: nextRole as RoleType,
        pendingApproval: false,
        progress: Math.min(100, project.progress + 20),
        summary: `${ROLE_LABELS[nextRole as RoleType]} 已开始 ${STAGE_LABELS[nextStage as StageType]} 阶段。`,
        liveTitle: nextStageRun?.title || `${STAGE_LABELS[nextStage as StageType]} 阶段已启动`,
        liveBody: nextStageRun?.body || "",
        liveProvider: nextStageRun?.provider || "scripted",
        liveStartedAt: new Date()
      }
    });

    await ensureDraftDeliverable(tx, {
      projectId: id,
      stageType: nextStage as StageType,
      createdBy: nextRole as RoleType
    });

    await tx.timelineEvent.createMany({
      data: [
        {
          projectId: id,
          timestamp: new Date(),
          agentId: nextRole as RoleType,
          type: "stage_started",
          title: `${STAGE_LABELS[nextStage as StageType]}阶段开始`,
          content: `${ROLE_LABELS[nextRole as RoleType]} 已自动接手下一阶段。`,
          priority: "normal"
        },
        {
          projectId: id,
          timestamp: new Date(),
          agentId: nextRole as RoleType,
          type: "thinking",
          title: "阶段推演已启动",
          content: `${nextStageRun?.thinkingSummary || "阶段输出已生成"}\n执行引擎: ${nextStageRun?.provider || "scripted"} · 模型 ${nextStageRun?.model || "scripted-agent"}`,
          priority: "normal"
        }
      ]
    });
  });

  const updated = await findProject(id);
  if (updated) {
    await syncRequirementBackfillOnProjectCompleted(updated);
  }
  return updated;
}

export async function rejectProjectStage(
  id: string,
  input: StageRejectInput
): Promise<ProjectDetail | undefined> {
  const project = await findProject(id);

  if (!project || !project.pendingApproval) {
    return project;
  }

  const currentStage = project.currentStage;
  const currentRole = project.currentRole;
  const reason = input.reason.trim();
  const run = await runProjectStageAgent({
    projectId: id,
    action: "project.reject.rework",
    projectName: project.name,
    projectDescription: project.description,
    parsedIntent: project.parsedIntent,
    stageType: currentStage,
    role: currentRole,
    summary: `审批被驳回，返工原因：${reason}`
  });

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.stage.update({
      where: { projectId_type: { projectId: id, type: currentStage } },
      data: {
        status: "rejected",
        progress: 72
      }
    });

    await tx.deliverable.updateMany({
      where: {
        projectId: id,
        stageType: currentStage,
        status: "submitted"
      },
      data: {
        status: "rejected"
      }
    });
    await tx.task.updateMany({
      where: { projectId: id, stageType: currentStage, sortOrder: 0 },
      data: { status: "in_progress" }
    });
    await tx.task.updateMany({
      where: { projectId: id, stageType: currentStage, sortOrder: { gt: 0 } },
      data: { status: "blocked" }
    });

    await tx.project.update({
      where: { id },
      data: {
        pendingApproval: false,
        summary: `${STAGE_LABELS[currentStage]}阶段已退回返工：${reason}`,
        liveTitle: `${ROLE_LABELS[currentRole]}正在根据驳回意见返工`,
        liveBody: `${run.body}\n\n### 驳回原因\n${reason}`,
        liveProvider: run.provider,
        liveStartedAt: new Date()
      }
    });

    await tx.timelineEvent.createMany({
      data: [
        {
          projectId: id,
          timestamp: new Date(),
          agentId: "ROLE_PM",
          type: "approval_rejected",
          title: `${STAGE_LABELS[currentStage]}阶段审批未通过`,
          content: `${STAGE_LABELS[currentStage]}阶段驳回原因：${reason}`,
          priority: "high"
        },
        {
          projectId: id,
          timestamp: new Date(),
          agentId: currentRole,
          type: "thinking",
          title: "Agent 已接收返工意见",
          content: `${run.thinkingSummary}\n执行引擎: ${run.provider} · 模型 ${run.model}`,
          priority: "normal"
        }
      ]
    });
  });

  return findProject(id);
}

export async function interveneProject(id: string, command: string): Promise<ProjectDetail | undefined> {
  const project = await findProject(id);
  if (!project) {
    return undefined;
  }

  await prisma.$transaction([
    prisma.project.update({
      where: { id },
      data: {
        status: "paused",
        summary: `项目已暂停，待执行指令：${command}`
      }
    }),
    prisma.timelineEvent.create({
      data: {
        projectId: id,
        timestamp: new Date(),
        agentId: "ROLE_PM",
        type: "intervention",
        title: "用户发起紧急介入",
        content: command,
        priority: "urgent"
      }
    })
  ]);

  return findProject(id);
}

export async function resumeProject(id: string): Promise<ProjectDetail | undefined> {
  const project = await findProject(id);
  if (!project) {
    return undefined;
  }

  await prisma.$transaction([
    prisma.project.update({
      where: { id },
      data: {
        status: project.progress >= 100 ? "completed" : "active",
        summary: "项目已恢复，当前阶段继续执行。"
      }
    }),
    prisma.timelineEvent.create({
      data: {
        projectId: id,
        timestamp: new Date(),
        agentId: "ROLE_PM",
        type: "resume",
        title: "项目已恢复执行",
        content: "系统已根据最新指令恢复推进。",
        priority: "normal"
      }
    })
  ]);

  return findProject(id);
}

export async function closeProject(id: string): Promise<ProjectDetail | undefined> {
  const project = await findProject(id);
  if (!project) {
    return undefined;
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.task.updateMany({
      where: {
        projectId: id,
        status: { in: ["todo", "in_progress", "blocked"] }
      },
      data: {
        status: "done"
      }
    });

    await tx.stage.updateMany({
      where: {
        projectId: id,
        status: { in: ["pending", "active", "blocked", "rejected"] }
      },
      data: {
        status: "completed",
        progress: 100,
        endedAt: new Date()
      }
    });

    await tx.project.update({
      where: { id },
      data: {
        status: "completed",
        currentStage: "ACCEPT",
        currentRole: "ROLE_PM",
        progress: 100,
        pendingApproval: false,
        summary: "项目已手动关闭，不再继续推进。",
        liveTitle: "项目已关闭",
        liveBody: "## 项目状态\n\n该项目已被手动关闭，不再自动推进。",
        liveProvider: "scripted",
        liveStartedAt: new Date()
      }
    });

    await tx.timelineEvent.create({
      data: {
        projectId: id,
        timestamp: new Date(),
        agentId: "ROLE_PM",
        type: "system",
        title: "项目已手动关闭",
        content: "当前项目已被关闭，后续不会继续执行阶段任务。",
        priority: "normal"
      }
    });
  });

  return findProject(id);
}

export async function deleteProject(id: string): Promise<boolean> {
  const existing = await prisma.project.findUnique({
    where: { id },
    select: { id: true }
  });

  if (!existing) {
    return false;
  }

  await prisma.project.delete({ where: { id } });
  return true;
}

export async function submitCurrentStage(
  id: string,
  input: StageSubmissionInput
): Promise<ProjectDetail | undefined> {
  const project = await findProject(id);
  if (!project) {
    return undefined;
  }

  const currentStageType = project.currentStage;
  const currentRole = project.currentRole;
  const stageLabel = STAGE_LABELS[currentStageType];
  const versions = project.deliverables
    .filter((item) => item.stageType === currentStageType)
    .map((item) => item.version);
  const nextVersion = (versions.length ? Math.max(...versions) : 0) + 1;
  const deliverableName = input.title?.trim() || `${stageLabel}交付物 v${nextVersion}.md`;
  const normalizedDesignReview = currentStageType === "DESIGN" ? normalizeDesignReview(input.designReview) : null;
  if (currentStageType === "DESIGN") {
    if (!normalizedDesignReview) {
      throw new Error("DESIGN_REVIEW_REQUIRED: 设计阶段提交必须包含完整设计审查卡。");
    }
    if (!normalizedDesignReview.approved) {
      throw new Error("DESIGN_REVIEW_NOT_APPROVED: 设计审查卡未通过，禁止提交阶段交付。");
    }
    const designErrors = validateDesignSubmission(input.content);
    if (designErrors.length > 0) {
      throw new Error(`DESIGN_REVIEW_REQUIRED: ${designErrors.join("；")}`);
    }
  }
  const submittedContent = normalizedDesignReview
    ? `${input.content}\n\n${renderDesignReviewCard(normalizedDesignReview)}`
    : input.content;

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.deliverable.create({
      data: {
        projectId: id,
        stageType: currentStageType,
        name: deliverableName,
        type: "markdown",
        content: submittedContent,
        version: nextVersion,
        status: "submitted",
        createdBy: currentRole,
        updatedAt: new Date()
      }
    });

    await tx.stage.update({
      where: { projectId_type: { projectId: id, type: currentStageType } },
      data: {
        status: "active",
        progress: 100
      }
    });
    await tx.task.updateMany({
      where: { projectId: id, stageType: currentStageType },
      data: { status: "done" }
    });

    await tx.project.update({
      where: { id },
      data: {
        pendingApproval: true,
        summary: `${stageLabel}阶段交付物已提交，等待你的审批。`,
        liveTitle: `${ROLE_LABELS[currentRole]}已提交${stageLabel}阶段交付物`,
        liveBody: submittedContent,
        liveProvider: project.liveSession.provider,
        liveStartedAt: new Date()
      }
    });

    await tx.timelineEvent.createMany({
      data: [
        {
          projectId: id,
          timestamp: new Date(),
          agentId: currentRole,
          type: "deliverable_submitted",
          title: "阶段交付物已提交",
          content: `${deliverableName} 已提交，版本 v${nextVersion}。`,
          priority: "high"
        },
        {
          projectId: id,
          timestamp: new Date(),
          agentId: "ROLE_PM",
          type: "approval_required",
          title: `${stageLabel}阶段等待审批`,
          content: `${stageLabel}阶段已完成输出，请决定是否进入下一阶段。`,
          priority: "high"
        }
      ]
    });
  });

  return findProject(id);
}

export async function postProjectMessage(
  id: string,
  input: ProjectMessageInput
): Promise<ProjectDetail | undefined> {
  const project = await findProject(id);
  if (!project) {
    return undefined;
  }

  const message = input.message.trim();
  if (!message) {
    return project;
  }

  const run = await runProjectStageAgent({
    projectId: id,
    action: "project.message.followup",
    projectName: project.name,
    projectDescription: project.description,
    parsedIntent: project.parsedIntent,
    stageType: project.currentStage,
    role: project.currentRole,
    summary: `用户最新指导：${message}`
  });

  await prisma.$transaction([
    prisma.project.update({
      where: { id },
      data: {
        summary: `已收到你的指导：${message}`,
        liveTitle: `${ROLE_LABELS[project.currentRole]}正在根据你的指导调整输出`,
        liveBody: `${run.body}\n\n### 最新用户指导\n${message}`,
        liveProvider: run.provider,
        liveStartedAt: new Date()
      }
    }),
    prisma.timelineEvent.createMany({
      data: [
        {
          projectId: id,
          timestamp: new Date(),
          type: "message",
          title: "你向团队发送了指导",
          content: message,
          priority: "normal"
        },
        {
          projectId: id,
          timestamp: new Date(),
          agentId: project.currentRole,
          type: "thinking",
          title: "Agent 正在根据你的消息调整",
          content: `${run.thinkingSummary}\n执行引擎: ${run.provider} · 模型 ${run.model}`,
          priority: "normal"
        }
      ]
    })
  ]);

  return findProject(id);
}

export async function listProjectExecutions(
  projectId: string,
  limit = 100
): Promise<StageAgentExecutionRecord[]> {
  const rows = await prisma.projectExecution.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(limit, 500))
  });

  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    stageType: row.stageType,
    role: row.role,
    action: row.action,
    status: row.status,
    provider: row.provider,
    model: row.model,
    requestedMode: row.requestedMode,
    runtimeMode: row.runtimeMode,
    promptSummary: row.promptSummary,
    outputPreview: row.outputPreview,
    errorMessage: row.errorMessage,
    latencyMs: row.latencyMs,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }));
}

export async function listProjectTasks(projectId?: string): Promise<Task[]> {
  const tasks = await prisma.task.findMany({
    where: projectId ? { projectId } : undefined,
    orderBy: [{ updatedAt: "desc" }]
  });

  return tasks.map(toTask);
}

export async function listTasks(): Promise<TaskBoardItem[]> {
  const tasks = await prisma.task.findMany({
    include: {
      project: {
        select: {
          name: true,
          status: true,
          currentStage: true,
          pendingApproval: true,
          updatedAt: true
        }
      }
    }
  });

  return tasks.map(toTaskBoardItem).sort(compareTaskBoardItems);
}

export async function updateTaskStatus(taskId: string, status: TaskStatus): Promise<Task | undefined> {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) {
    return undefined;
  }

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: { status }
  });

  await prisma.timelineEvent.create({
    data: {
      projectId: updated.projectId,
      timestamp: new Date(),
      agentId: updated.assignee,
      type: "system",
      title: "任务状态已更新",
      content: `${updated.title} 已更新为 ${status}。`,
      priority: "normal"
    }
  });

  return toTask(updated);
}

export async function getSystemHealth(): Promise<SystemHealth> {
  let projects: Array<{ status: string; pendingApproval: boolean }> = [];
  let tasks: Array<{ status: string }> = [];
  let stages: Array<{ status: string }> = [];
  let agents: Array<{ workload: number }> = [];
  let databaseStatus: SystemHealth["services"][number]["status"] = "healthy";
  let databaseDetail = "Prisma 与 SQLite 已连通";

  try {
    [projects, tasks, stages, agents] = await Promise.all([
      prisma.project.findMany({ select: { status: true, pendingApproval: true } }),
      prisma.task.findMany({ select: { status: true } }),
      prisma.stage.findMany({ select: { status: true } }),
      prisma.agentProfile.findMany({ select: { workload: true } })
    ]);
  } catch (error) {
    databaseStatus = "degraded";
    databaseDetail = error instanceof Error ? error.message : "数据库检查失败";
  }

  const activeProjects = projects.filter((project) => project.status === "active").length;
  const pendingApprovals = projects.filter((project) => project.pendingApproval).length;
  const activeTasks = tasks.filter((task) => task.status === "todo" || task.status === "in_progress").length;
  const blockedTasks = tasks.filter((task) => task.status === "blocked").length;
  const rejectedStages = stages.filter((stage) => stage.status === "rejected").length;
  const averageAgentWorkload = agents.length
    ? Math.round(agents.reduce((sum, agent) => sum + agent.workload, 0) / agents.length)
    : 0;
  const runtime = await getRuntimeStatus();

  return {
    totalProjects: projects.length,
    activeProjects,
    pendingApprovals,
    activeTasks,
    blockedTasks,
    rejectedStages,
    averageAgentWorkload,
    runtime,
    services: [
      { name: "api", status: "healthy", detail: "Express API 已运行" },
      { name: "database", status: databaseStatus, detail: databaseDetail },
      {
        name: "runtime",
        status:
          runtime.requestedMode === "openai-compatible" && !runtime.configured
            ? "degraded"
            : runtime.mode === "scripted" && runtime.requestedMode === "scripted"
              ? "healthy"
              : runtime.lastValidationStatus === "failed"
                ? "degraded"
                : "healthy",
        detail:
          runtime.requestedMode === "openai-compatible" && !runtime.configured
            ? "已选择真实模型模式，但当前配置不完整，系统回退为脚本模式。"
            : runtime.mode === "openai-compatible"
              ? `当前模型：${runtime.modelName}`
              : "当前为脚本运行模式"
      }
    ]
  };
}

async function persistProject(project: ProjectDetail) {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.project.create({
      data: {
        id: project.id,
        name: project.name,
        description: project.description,
        parsedKeywords: project.parsedIntent.keywords,
        parsedConstraints: project.parsedIntent.constraints,
        parsedRisks: project.parsedIntent.risks,
        parsedSuggestedTeam: project.parsedIntent.suggestedTeam,
        parsedSummary: project.parsedIntent.summary,
        status: project.status,
        currentStage: project.currentStage,
        progress: project.progress,
        pendingApproval: project.pendingApproval,
        currentRole: project.currentRole,
        team: project.team,
        summary: project.summary,
        liveTitle: project.liveSession.title,
        liveBody: project.liveSession.body,
        liveStartedAt: new Date(project.liveSession.startedAt),
        liveProvider: project.liveSession.provider
      }
    });

    await tx.stage.createMany({
      data: project.stages.map((stage, index) => ({
        projectId: project.id,
        type: stage.type,
        label: stage.label,
        assignee: stage.assignee,
        status: stage.status,
        progress: stage.progress,
        sortOrder: index,
        startedAt: stage.startedAt ? new Date(stage.startedAt) : null,
        endedAt: stage.endedAt ? new Date(stage.endedAt) : null
      }))
    });

    await tx.task.createMany({
      data: project.tasks.map((task, index) => ({
        projectId: project.id,
        stageType: task.stageType,
        title: task.title,
        description: task.description,
        assignee: task.assignee,
        status: task.status,
        priority: task.priority,
        sortOrder: index,
        updatedAt: new Date(task.updatedAt)
      }))
    });

    await tx.deliverable.createMany({
      data: project.deliverables.map((deliverable) => ({
        projectId: project.id,
        stageType: deliverable.stageType,
        name: deliverable.name,
        type: deliverable.type,
        content: deliverable.content,
        version: deliverable.version,
        status: deliverable.status,
        createdBy: deliverable.createdBy,
        updatedAt: new Date(deliverable.updatedAt)
      }))
    });

    await tx.timelineEvent.createMany({
      data: project.timeline.map((event) => ({
        projectId: project.id,
        timestamp: new Date(event.timestamp),
        agentId: event.agentId,
        type: event.type,
        title: event.title,
        content: event.content,
        priority: event.priority
      }))
    });
  });
}

function toProjectSummary(project: {
  id: string;
  name: string;
  status: string;
  currentStage: string;
  progress: number;
  updatedAt: Date;
  pendingApproval: boolean;
  currentRole: string;
  summary: string;
  tasks: Array<{ status: string }>;
}): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    status: project.status as ProjectStatus,
    currentStage: project.currentStage as StageType,
    progress: project.progress,
    updatedAt: project.updatedAt.toISOString(),
    pendingApproval: project.pendingApproval,
    currentRole: project.currentRole as RoleType,
    summary: project.summary,
    openTaskCount: project.tasks.filter((task) => task.status !== "done").length
  };
}

function toProjectDetail(project: {
  id: string;
  name: string;
  description: string;
  parsedKeywords: Prisma.JsonValue;
  parsedConstraints: Prisma.JsonValue;
  parsedRisks: Prisma.JsonValue;
  parsedSuggestedTeam: Prisma.JsonValue;
  parsedSummary: string;
  status: string;
  currentStage: string;
  progress: number;
  updatedAt: Date;
  pendingApproval: boolean;
  currentRole: string;
  summary: string;
  team: Prisma.JsonValue;
  liveTitle: string;
  liveBody: string;
  liveStartedAt: Date;
  liveProvider: string;
  stages: Array<{
    type: string;
    label: string;
    assignee: string;
    status: string;
    progress: number;
    startedAt: Date | null;
    endedAt: Date | null;
  }>;
  tasks: Array<{
    id: string;
    projectId: string;
    stageType: string;
    title: string;
    description: string;
    assignee: string;
    status: string;
    priority: string;
    updatedAt: Date;
  }>;
  deliverables: Array<{
    id: string;
    name: string;
    type: string;
    content: string;
    version: number;
    status: string;
    stageType: string;
    createdBy: string;
    updatedAt: Date;
  }>;
  timeline: Array<{
    id: string;
    timestamp: Date;
    agentId: string | null;
    type: string;
    title: string;
    content: string;
    priority: string;
  }>;
}): ProjectDetail {
  const stages: Stage[] = project.stages.map((stage) => ({
    type: stage.type as StageType,
    label: stage.label,
    assignee: stage.assignee as RoleType,
    status: stage.status as Stage["status"],
    progress: stage.progress,
    startedAt: stage.startedAt?.toISOString(),
    endedAt: stage.endedAt?.toISOString()
  }));

  const timeline: TimelineEvent[] = project.timeline.map((event) => ({
    id: event.id,
    timestamp: event.timestamp.toISOString(),
    agentId: event.agentId ? (event.agentId as RoleType) : undefined,
    type: event.type as TimelineEvent["type"],
    title: event.title,
    content: event.content,
    priority: event.priority as TimelineEvent["priority"]
  }));

  return {
    id: project.id,
    name: project.name,
    description: project.description,
    parsedIntent: {
      keywords: readStringArray(project.parsedKeywords),
      constraints: readStringArray(project.parsedConstraints),
      risks: readStringArray(project.parsedRisks),
      suggestedTeam: readRoleArray(project.parsedSuggestedTeam),
      summary: project.parsedSummary
    },
    team: readRoleArray(project.team),
    currentStage: project.currentStage as StageType,
    currentRole: project.currentRole as RoleType,
    progress: project.progress,
    updatedAt: project.updatedAt.toISOString(),
    status: project.status as ProjectStatus,
    pendingApproval: project.pendingApproval,
    summary: project.summary,
    openTaskCount: project.tasks.filter((task) => task.status !== "done").length,
    stages,
    tasks: project.tasks.map(toTask),
    deliverables: project.deliverables.map((deliverable) => ({
      id: deliverable.id,
      name: deliverable.name,
      type: deliverable.type as "markdown" | "pdf" | "code",
      content: deliverable.content,
      version: deliverable.version,
      status: deliverable.status as ProjectDetail["deliverables"][number]["status"],
      stageType: deliverable.stageType as StageType,
      createdBy: deliverable.createdBy as RoleType,
      updatedAt: deliverable.updatedAt.toISOString()
    })),
    timeline,
    liveSession: {
      activeRole: project.currentRole as RoleType,
      title: project.liveTitle,
      startedAt: project.liveStartedAt.toISOString(),
      body: project.liveBody,
      provider: project.liveProvider as RuntimeMode
    }
  };
}

function toAgentProfile(agent: {
  roleId: string;
  name: string;
  tagline: string;
  description: string;
  status: string;
  workload: number;
  styles: Prisma.JsonValue;
  skills: Prisma.JsonValue;
  recentHighlights: Prisma.JsonValue;
}, activeTaskCount: number): AgentProfile {
  const skills = readSkills(agent.skills);

  return {
    roleId: agent.roleId as RoleType,
    name: agent.name,
    tagline: agent.tagline,
    description: agent.description,
    status: agent.status as AgentProfile["status"],
    workload: agent.workload,
    styles: readStringArray(agent.styles),
    skills,
    recentHighlights: readStringArray(agent.recentHighlights),
    activeTaskCount
  };
}

function toTask(task: {
  id: string;
  projectId: string;
  stageType: string;
  title: string;
  description: string;
  assignee: string;
  status: string;
  priority: string;
  updatedAt: Date;
}): Task {
  return {
    id: task.id,
    projectId: task.projectId,
    stageType: task.stageType as StageType,
    title: task.title,
    description: task.description,
    assignee: task.assignee as RoleType,
    status: task.status as TaskStatus,
    priority: task.priority as Task["priority"],
    updatedAt: task.updatedAt.toISOString()
  };
}

function toTaskBoardItem(task: {
  id: string;
  projectId: string;
  stageType: string;
  title: string;
  description: string;
  assignee: string;
  status: string;
  priority: string;
  updatedAt: Date;
  project: {
    name: string;
    status: string;
    currentStage: string;
    pendingApproval: boolean;
    updatedAt: Date;
  };
}): TaskBoardItem {
  return {
    ...toTask(task),
    projectName: task.project.name,
    projectStatus: task.project.status as ProjectStatus,
    projectCurrentStage: task.project.currentStage as StageType,
    projectPendingApproval: task.project.pendingApproval,
    projectUpdatedAt: task.project.updatedAt.toISOString()
  };
}

function compareTaskBoardItems(left: TaskBoardItem, right: TaskBoardItem) {
  const statusRank: Record<TaskStatus, number> = {
    blocked: 0,
    in_progress: 1,
    todo: 2,
    done: 3
  };
  const priorityRank = { high: 0, normal: 1, low: 2 } as const;
  const statusDelta = statusRank[left.status] - statusRank[right.status];

  if (statusDelta !== 0) {
    return statusDelta;
  }

  const priorityDelta = priorityRank[left.priority] - priorityRank[right.priority];
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
}

function readStringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readRoleArray(value: Prisma.JsonValue): RoleType[] {
  return readStringArray(value) as RoleType[];
}

function readSkills(value: Prisma.JsonValue): AgentProfile["skills"] {
  const object = typeof value === "object" && value ? (value as Record<string, unknown>) : {};

  return {
    professional: Number(object.professional ?? 0),
    collaboration: Number(object.collaboration ?? 0),
    learning: Number(object.learning ?? 0),
    stability: Number(object.stability ?? 0),
    innovation: Number(object.innovation ?? 0)
  };
}

async function nextProjectId() {
  const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const lastProject = await prisma.project.findFirst({
    where: { id: { startsWith: `OCC-${today}-` } },
    orderBy: { id: "desc" }
  });

  const lastSequence = lastProject ? Number(lastProject.id.split("-").at(-1)) : 0;
  return `OCC-${today}-${String(lastSequence + 1).padStart(3, "0")}`;
}

async function backfillProjectTasks() {
  const projects = await prisma.project.findMany({
    include: {
      tasks: true
    }
  });

  for (const project of projects) {
    if (project.tasks.length > 0) {
      continue;
    }

    const generatedTasks = buildTasks(
      project.id,
      project.currentStage as StageType,
      project.pendingApproval
    );

    await prisma.task.createMany({
      data: generatedTasks.map((task, index) => ({
        projectId: task.projectId,
        stageType: task.stageType,
        title: task.title,
        description: task.description,
        assignee: task.assignee,
        status: task.status,
        priority: task.priority,
        sortOrder: index,
        updatedAt: new Date(task.updatedAt)
      }))
    });
  }
}

async function ensureDraftDeliverable(
  tx: Prisma.TransactionClient,
  input: { projectId: string; stageType: StageType; createdBy: RoleType }
) {
  const existing = await tx.deliverable.findFirst({
    where: {
      projectId: input.projectId,
      stageType: input.stageType
    }
  });

  if (existing) {
    return;
  }

  await tx.deliverable.create({
    data: {
      projectId: input.projectId,
      stageType: input.stageType,
      name: `${STAGE_LABELS[input.stageType]}阶段任务草案.md`,
      type: "markdown",
      content: [
        `# ${STAGE_LABELS[input.stageType]}阶段任务草案`,
        "",
        "- 等待当前角色基于上一阶段结论补充正式内容",
        "- 可在观测室继续编辑并提交审批版"
      ].join("\n"),
      version: 1,
      status: "draft",
      createdBy: input.createdBy,
      updatedAt: new Date()
    }
  });
}
