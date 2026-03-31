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
import {
  buildDeliverableTemplatePromptBlock,
  resolveDeliverableTemplate
} from "../system/deliverable-templates.js";

const stageOrder: StageType[] = ["INIT", "ANALYSIS", "DESIGN", "DEV", "ACCEPT"];
const DESIGN_REVIEW_MARKER = "## 设计审查卡";
const MIN_DELIVERABLE_CONTENT_LENGTH = 180;
const STAGE_OBJECTIVES: Record<StageType, string> = {
  INIT: "确认项目目标、边界与团队分工，建立执行基线。",
  ANALYSIS: "把输入需求转成结构化需求合同、约束与风险清单。",
  DESIGN: "输出可执行设计方案，明确信息架构、视觉方向与交互规则。",
  DEV: "先产出研发技术方案与关键选型，再把设计与任务拆解落地为可运行实现，并完成联调验证。",
  ACCEPT: "完成验收验证、结果总结与文档回填，形成可持续迭代闭环。"
};

const STAGE_NEXT_INPUT: Record<StageType, string> = {
  INIT: "将项目章程与角色分工交给分析阶段继续细化。",
  ANALYSIS: "把需求合同、排期和风险清单交给设计阶段产出方案。",
  DESIGN: "把设计审查卡、实施方案与组件规范交给开发阶段，先完成技术方案与选型再进入实现。",
  DEV: "把实现结果、测试证据和发布说明交给验收阶段评审。",
  ACCEPT: "把验收结论和回填结果同步到产品说明文档，作为下轮需求输入。"
};
const STAGE_COMPANION_ROLES: Partial<Record<StageType, RoleType[]>> = {
  DESIGN: ["ROLE_PRODUCT"],
  DEV: ["ROLE_ARCH"]
};

const STAGE_EXPECTED_DELIVERABLE_NAMES: Record<StageType, string[]> = {
  INIT: ["项目章程.md"],
  ANALYSIS: ["需求分析文档.md", "项目排期方案.md"],
  DESIGN: ["客户汇报方案.ppt.md", "实施方案说明.word.md", "设计审查卡.md"],
  DEV: ["技术方案与选型.md", "Demo原型说明.md"],
  ACCEPT: ["测试报告.md", "产品说明文档回填.md"]
};

function isRealModelGateEnabled() {
  const raw = String(process.env.ENFORCE_REAL_MODEL_GATE ?? "").trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "on") {
    return true;
  }
  if (raw === "false" || raw === "0" || raw === "off") {
    return false;
  }
  return process.env.NODE_ENV === "production";
}

function isExecutionDegraded(metadata: Prisma.JsonValue | null) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }
  return Boolean((metadata as Record<string, unknown>).degraded);
}

async function assertCurrentStageRealModelGate(project: ProjectDetail) {
  if (!isRealModelGateEnabled()) {
    return;
  }

  const runtime = await getRuntimeStatus();
  if (runtime.requestedMode !== "openai-compatible") {
    throw new Error("REAL_MODEL_GATE_FAILED: 当前运行模式不是 openai-compatible，禁止通过阶段验收。");
  }
  if (!runtime.configured) {
    throw new Error("REAL_MODEL_GATE_FAILED: 真实模型配置不完整（API Base URL / API Key / Model）。");
  }

  const stageExecutions = await prisma.projectExecution.findMany({
    where: {
      projectId: project.id,
      stageType: project.currentStage,
      status: "success"
    },
    orderBy: { createdAt: "desc" },
    take: 40
  });

  if (stageExecutions.length === 0) {
    throw new Error(`REAL_MODEL_GATE_FAILED: ${project.currentStage} 阶段缺少可验证执行记录。`);
  }

  if (!stageExecutions.some((row) => row.role === project.currentRole)) {
    throw new Error(`REAL_MODEL_GATE_FAILED: ${project.currentStage} 阶段缺少当前角色 ${project.currentRole} 的执行证据。`);
  }

  const scriptedRows = stageExecutions.filter((row) => String(row.provider || "").trim().toLowerCase() === "scripted");
  if (scriptedRows.length > 0) {
    throw new Error(`REAL_MODEL_GATE_FAILED: ${project.currentStage} 阶段存在 scripted 输出，禁止通过验收。`);
  }

  const degradedRows = stageExecutions.filter((row) => isExecutionDegraded(row.metadata));
  if (degradedRows.length > 0) {
    throw new Error(`REAL_MODEL_GATE_FAILED: ${project.currentStage} 阶段存在 degraded 降级输出，禁止通过验收。`);
  }
}

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

function ensureDesignSubmissionContent(
  content: string,
  designReview: NonNullable<ReturnType<typeof normalizeDesignReview>>
) {
  let normalized = String(content || "").trim();
  const hasSection = (title: string) => normalized.includes(title);
  const appendSection = (title: string, lines: string[]) => {
    const block = [title, ...lines].join("\n");
    normalized = normalized ? `${normalized}\n\n${block}` : block;
  };

  if (!hasSection("## 视觉方案")) {
    appendSection("## 视觉方案", [
      `- 视觉方向: ${designReview.visualDirection}`,
      `- 目标语气: ${designReview.brandTone}`
    ]);
  }

  if (!hasSection("## 版式策略")) {
    appendSection("## 版式策略", [
      "- 首屏先展示价值主张，再展开能力与流程。",
      "- 关键路径优先，减少用户在主流程中的跳转。"
    ]);
  }

  if (!hasSection("## 组件清单")) {
    appendSection("## 组件清单", [
      "- Hero 区块（标题 + 副标题 + CTA）",
      "- 能力卡片区块（3-4 项核心能力）",
      "- 流程区块（需求到研发闭环）",
      "- 预约演示 CTA 区块"
    ]);
  }

  if (!hasSection("## 品牌语气")) {
    appendSection("## 品牌语气", [
      `- 文案语气: ${designReview.brandTone}`,
      "- 表达方式: 专业、直接、可执行，避免空泛口号。"
    ]);
  }

  if (!hasSection("## UX 原则")) {
    appendSection("## UX 原则", designReview.uxPrinciples.map((item) => `- ${item}`));
  }

  if (!hasSection("## 可访问性检查")) {
    appendSection("## 可访问性检查", designReview.accessibilityChecklist.map((item) => `- ${item}`));
  }

  const bulletCount = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .length;

  if (bulletCount < 8) {
    appendSection("## 补充要点", [
      "- 方案需可直接衔接开发实施与验收回填。",
      "- 阶段交付需包含可追溯证据与验收口径。"
    ]);
  }

  if (normalized.length < 260) {
    appendSection("## 设计说明补充", [
      `- 当前阶段目标: ${STAGE_OBJECTIVES.DESIGN}`,
      `- 下一阶段输入: ${STAGE_NEXT_INPUT.DESIGN}`,
      "- 本设计交付物用于驱动研发执行并减少返工风险。"
    ]);
  }

  return normalized;
}

function hasApprovedDesignReview(content: string) {
  return content.includes(DESIGN_REVIEW_MARKER) && /审查结论:\s*通过/.test(content);
}

function normalizeDeliverableToken(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s._\-()（）【】\[\]{}]/g, "");
}

function isSameCoreDeliverable(
  deliverableName: string,
  expectedName: string,
  stageType: StageType
) {
  const expectedTemplate = resolveDeliverableTemplate(expectedName, stageType);
  const candidateTemplate = resolveDeliverableTemplate(deliverableName, stageType);
  if (expectedTemplate.kind !== "generic" && candidateTemplate.kind === expectedTemplate.kind) {
    return true;
  }

  const expectedToken = normalizeDeliverableToken(expectedName);
  const candidateToken = normalizeDeliverableToken(deliverableName);
  return candidateToken.includes(expectedToken) || expectedToken.includes(candidateToken);
}

function validateDeliverableTemplateGate(input: {
  stageType: StageType;
  deliverableName: string;
  content: string;
}) {
  const normalized = String(input.content || "").trim();
  const template = resolveDeliverableTemplate(input.deliverableName, input.stageType);
  const issues: string[] = [];

  if (normalized.length < MIN_DELIVERABLE_CONTENT_LENGTH) {
    issues.push(`正文长度不足（至少 ${MIN_DELIVERABLE_CONTENT_LENGTH} 字）`);
  }

  const missingSections = template.requiredSections.filter((section) => !normalized.includes(section));
  if (missingSections.length > 0) {
    issues.push(`缺少模板章节: ${missingSections.slice(0, 6).join("、")}${missingSections.length > 6 ? "..." : ""}`);
  }

  if (!normalized.includes("## 验收检查清单")) {
    issues.push("缺少“## 验收检查清单”章节");
  } else {
    const missingChecklist = template.acceptanceChecklist.filter((item) => !normalized.includes(item));
    if (missingChecklist.length > 0) {
      issues.push(`验收检查清单未命中: ${missingChecklist.slice(0, 4).join("、")}${missingChecklist.length > 4 ? "..." : ""}`);
    }
  }

  return {
    template,
    passed: issues.length === 0,
    issues
  };
}

function assertCoreDeliverablesTemplateGate(project: ProjectDetail, stageType: StageType) {
  const expectedNames = STAGE_EXPECTED_DELIVERABLE_NAMES[stageType] || [];
  if (expectedNames.length === 0) {
    return;
  }

  const stageDeliverables = project.deliverables.filter((item) => item.stageType === stageType);
  const errors: string[] = [];

  for (const expectedName of expectedNames) {
    const matched = stageDeliverables
      .filter((item) => isSameCoreDeliverable(item.name, expectedName, stageType))
      .sort((left, right) => {
        const versionDelta = (right.version || 0) - (left.version || 0);
        if (versionDelta !== 0) {
          return versionDelta;
        }
        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      })[0];

    if (!matched) {
      errors.push(`缺少核心交付物: ${expectedName}`);
      continue;
    }

    if (matched.status !== "submitted" && matched.status !== "approved") {
      errors.push(`${matched.name} 状态为 ${matched.status}，未达到可审批状态`);
      continue;
    }

    const gate = validateDeliverableTemplateGate({
      stageType,
      deliverableName: matched.name,
      content: String(matched.content || "")
    });
    if (!gate.passed) {
      errors.push(`${matched.name} 未通过模板校验: ${gate.issues.join("；")}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`STAGE_TEMPLATE_VALIDATION_FAILED: ${errors.join(" | ")}`);
  }
}

export async function getProjectTemplateGatePrecheck(projectId: string) {
  const project = await findProject(projectId);
  if (!project) {
    return undefined;
  }

  const stageType = project.currentStage as StageType;
  const expectedNames = STAGE_EXPECTED_DELIVERABLE_NAMES[stageType] || [];
  const stageDeliverables = project.deliverables.filter((item) => item.stageType === stageType);

  const checks = expectedNames.map((expectedName) => {
    const matched = stageDeliverables
      .filter((item) => isSameCoreDeliverable(item.name, expectedName, stageType))
      .sort((left, right) => {
        const versionDelta = (right.version || 0) - (left.version || 0);
        if (versionDelta !== 0) {
          return versionDelta;
        }
        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      })[0];

    if (!matched) {
      return {
        expectedName,
        matchedName: null,
        passed: false,
        issues: [`缺少核心交付物: ${expectedName}`]
      };
    }

    const statusIssues =
      matched.status === "submitted" || matched.status === "approved"
        ? []
        : [`交付物状态为 ${matched.status}，未达到可审批状态`];
    const gate = validateDeliverableTemplateGate({
      stageType,
      deliverableName: matched.name,
      content: String(matched.content || "")
    });

    return {
      expectedName,
      matchedName: matched.name,
      passed: statusIssues.length === 0 && gate.passed,
      issues: [...statusIssues, ...gate.issues]
    };
  });

  const missingExpected = expectedNames.filter((expectedName) =>
    !checks.some((item) => item.expectedName === expectedName && item.passed)
  );

  return {
    projectId: project.id,
    stageType,
    expectedCount: expectedNames.length,
    deliverableCount: stageDeliverables.length,
    passed: checks.every((item) => item.passed),
    missingExpected,
    checks
  };
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

  const expectedArtifacts = (
    input.artifacts.length > 0
      ? input.artifacts
      : ["项目排期", "客户汇报方案（PPT）", "实施方案（Word）", "技术方案与选型", "Demo 原型"]
  )
    .map((label) => {
      const pattern = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, ""), "i");
      const fallback =
        label.includes("PPT")
          ? /ppt|汇报方案/i
          : label.toLowerCase().includes("word")
            ? /word|实施方案/i
            : /技术方案|选型|architecture|tech/i.test(label.toLowerCase())
              ? /技术方案|选型|architecture|tech/i
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
    `目标: ${contract.objective || "信息未提供"}`,
    `In Scope: ${(contract.inScope || []).join("；") || "信息未提供"}`,
    `Out of Scope: ${(contract.outOfScope || []).join("；") || "信息未提供"}`,
    `验收标准: ${(contract.acceptanceCriteria || []).join("；") || "信息未提供"}`,
    `目标产出: ${(contract.artifacts || []).join("、") || "信息未提供"}`,
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
    content: `需求合同已注入交付物，目标: ${contract.objective || "信息未提供"}`,
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
  const enableProjectSeedOnEmpty =
    process.env.ENABLE_PROJECT_SEED_ON_EMPTY === "true"
    || process.env.ENABLE_PROJECT_SEED === "true";

  if (existingProjects === 0 && enableProjectSeedOnEmpty) {
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

export async function reconcileProjectDeliverablesNow(id: string): Promise<ProjectDetail | undefined> {
  const record = await loadProjectRecord(id);
  if (!record) {
    return undefined;
  }
  await reconcileProjectDeliverables(record);
  return findProject(id);
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

function normalizeDeliverableName(name: string) {
  return String(name || "").trim().toLowerCase();
}

function deliverableStatusRank(status: string) {
  if (status === "approved") return 4;
  if (status === "submitted") return 3;
  if (status === "rejected") return 2;
  if (status === "draft") return 1;
  return 0;
}

function toDeliverableTimestamp(value: Date | string | null | undefined) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function selectLatestDeliverablesByCoreName<T extends {
  id: string;
  stageType: string;
  name: string;
  version: number;
  status: string;
  updatedAt: Date;
}>(deliverables: T[]) {
  const latestByCore = new Map<string, T>();
  for (const item of deliverables) {
    const key = `${item.stageType}::${normalizeDeliverableName(item.name)}`;
    const existing = latestByCore.get(key);
    if (!existing) {
      latestByCore.set(key, item);
      continue;
    }

    const itemTs = toDeliverableTimestamp(item.updatedAt);
    const existingTs = toDeliverableTimestamp(existing.updatedAt);
    if (itemTs > existingTs) {
      latestByCore.set(key, item);
      continue;
    }
    if (itemTs < existingTs) {
      continue;
    }

    if ((item.version || 0) > (existing.version || 0)) {
      latestByCore.set(key, item);
      continue;
    }
    if ((item.version || 0) < (existing.version || 0)) {
      continue;
    }

    if (deliverableStatusRank(item.status) > deliverableStatusRank(existing.status)) {
      latestByCore.set(key, item);
    }
  }

  return [...latestByCore.values()].sort((left, right) => {
    const ts = toDeliverableTimestamp(right.updatedAt) - toDeliverableTimestamp(left.updatedAt);
    if (ts !== 0) {
      return ts;
    }
    return (right.version || 0) - (left.version || 0);
  });
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

function composeExecutionMetadata(
  baseMetadata: Prisma.InputJsonValue | undefined,
  extension: Record<string, Prisma.InputJsonValue | undefined>
): Prisma.InputJsonValue | undefined {
  const normalizedExtension = Object.entries(extension)
    .filter(([, value]) => value !== undefined)
    .reduce<Record<string, Prisma.InputJsonValue>>((acc, [key, value]) => {
      if (value !== undefined) {
        acc[key] = value;
      }
      return acc;
    }, {});

  if (Object.keys(normalizedExtension).length === 0) {
    return baseMetadata;
  }

  if (baseMetadata && typeof baseMetadata === "object" && !Array.isArray(baseMetadata)) {
    return {
      ...(baseMetadata as Record<string, Prisma.InputJsonValue>),
      ...normalizedExtension
    };
  }

  return {
    ...(baseMetadata !== undefined ? { sourceMetadata: baseMetadata } : {}),
    ...normalizedExtension
  };
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
    const runAttempts = Array.isArray((run as { attempts?: unknown }).attempts)
      ? ((run as { attempts: Prisma.InputJsonValue[] }).attempts)
      : [];

    if (isRealModelGateEnabled()) {
      const provider = String(run.provider || "").trim().toLowerCase();
      const degraded = Boolean((run as { degraded?: boolean }).degraded);
      if (provider === "scripted" || degraded) {
        const gateError = new Error("REAL_MODEL_GATE_FAILED: 当前阶段输出触发 scripted/degraded 降级，不允许写入为成功结果。") as Error & {
          attempts?: Prisma.InputJsonValue[];
        };
        gateError.attempts = runAttempts;
        throw gateError;
      }
    }

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
      metadata: composeExecutionMetadata(input.metadata, {
        modelAttempts: runAttempts,
        degraded: (run as { degraded?: boolean }).degraded ? true : undefined
      })
    });

    return run;
  } catch (error) {
    const errorAttempts = Array.isArray((error as { attempts?: unknown })?.attempts)
      ? ((error as { attempts: Prisma.InputJsonValue[] }).attempts)
      : [];
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
      metadata: composeExecutionMetadata(input.metadata, {
        modelAttempts: errorAttempts.length > 0 ? errorAttempts : undefined
      })
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

function needsDeliverableAgentUpgrade(content: string, deliverableName: string, stageType: StageType) {
  const normalized = String(content ?? "");
  const trimmed = normalized.trim();
  const name = String(deliverableName || "");
  const template = resolveDeliverableTemplate(name, stageType);
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
    /(项目排期|客户汇报|实施方案|技术方案|选型|架构|需求分析|Demo|原型|官网演示|测试报告|回填)/i.test(name)
    && !trimmed.includes("执行引擎:")
  ) {
    return true;
  }

  if (
    /(项目排期|客户汇报|实施方案|技术方案|选型|架构|需求分析|Demo|原型|官网演示|测试报告|回填)/i.test(name)
    && !trimmed.includes("## 本阶段任务证据")
  ) {
    return true;
  }

  if (trimmed.includes("## 自动推进元信息") && !trimmed.includes("## 自动质检")) {
    return true;
  }

  const missingTemplateSections = template.requiredSections.filter((section) => !trimmed.includes(section));
  if (missingTemplateSections.length > 0) {
    return true;
  }

  if (
    /(固定仪表盘、项目观测室、Agent 中心三大页面|让实时输出始终成为视觉中心|把审批与紧急介入做成明确的强动作|避免常规 SaaS 模板感)/.test(trimmed)
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
      `${index + 1}. ${task.title}（${formatTaskStatusLabel(task.status)} / 优先级 ${task.priority}）\n   - ${task.description || "暂无补充说明"}`
    ))
    : ["1. 当前阶段任务暂未编排，建议补充任务后重新提交审批版交付物。"];

  const objective = STAGE_OBJECTIVES[stageType] || "围绕当前阶段目标沉淀可审阅产物。";
  const nextInput = STAGE_NEXT_INPUT[stageType] || "将本阶段产物同步给下一阶段执行角色。";
  const template = resolveDeliverableTemplate(deliverable.name, stageType);
  const templatePromptBlock = buildDeliverableTemplatePromptBlock(deliverable.name, stageType, keywords);

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
    "## 专业模板约束",
    ...templatePromptBlock.map((line) => (line.startsWith("- ") ? line : `- ${line}`)),
    "",
    "## 当前任务清单",
    ...taskLines,
    "",
    "## 模板章节骨架（请按模板补全）",
    ...template.requiredSections.flatMap((section) => ([section, "- 请结合任务证据、约束与风险完善本节。"])),
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
  return resolveDeliverableTemplate(deliverableName, stageType).acceptanceChecklist;
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
      `${index + 1}. ${task.title}（${formatTaskStatusLabel(task.status)} / 优先级 ${task.priority}）\n   - ${task.description || "暂无补充说明"}`
    ))
    : ["1. 当前阶段任务暂未编排，建议补充任务后重新提交审批版交付物。"];
  const checklist = buildDeliverableChecklist(deliverable.name, stageType);
  const template = resolveDeliverableTemplate(deliverable.name, stageType);
  const templatePromptBlock = buildDeliverableTemplatePromptBlock(deliverable.name, stageType, keywords);

  const runCacheKey = `${project.id}:${stageType}:shared`;
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
      summary: [
        `请输出“${deliverable.name}”的正式交付内容，必须可被下一阶段直接执行，并提供可验收要点。`,
        ...templatePromptBlock
      ].join("\n")
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
    "## 专业模板约束",
    ...templatePromptBlock.map((line) => (line.startsWith("- ") ? line : `- ${line}`)),
    "",
    "## 当前任务清单",
    ...taskLines,
    "",
    "## 模板章节骨架（请按模板补全）",
    ...template.requiredSections.flatMap((section) => ([section, "- 请结合 Agent 输出正文与任务证据补全本节。"])),
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
  const currentStageType = resolveStageType(project.currentStage);
  const currentStageIndex = currentStageType ? stageOrder.indexOf(currentStageType) : -1;
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
      || needsDeliverableAgentUpgrade(deliverable.content, deliverable.name, resolveStageType(deliverable.stageType) || "ACCEPT");
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

  // 补齐每个阶段的标准产物，避免出现“阶段已完成但关键交付缺失”。
  for (const stage of project.stages) {
    const stageType = resolveStageType(stage.type);
    if (!stageType) {
      continue;
    }
    const stageIndex = stageOrder.indexOf(stageType);
    if (currentStageIndex >= 0 && stageIndex > currentStageIndex) {
      // 不允许为未来阶段提前生成占位交付物，避免流程错位。
      continue;
    }
    const expectedNames = STAGE_EXPECTED_DELIVERABLE_NAMES[stageType] || [];
    if (expectedNames.length === 0) {
      continue;
    }

    const existingStageDeliverables = project.deliverables.filter((item) => item.stageType === stage.type);
    const existingNames = new Set(existingStageDeliverables.map((item) => normalizeDeliverableName(item.name)));
    const scheduledNames = new Set(
      creates
        .filter((item) => item.stageType === stage.type)
        .map((item) => normalizeDeliverableName(item.name))
    );

    for (const expectedName of expectedNames) {
      const normalizedExpectedName = normalizeDeliverableName(expectedName);
      if (existingNames.has(normalizedExpectedName) || scheduledNames.has(normalizedExpectedName)) {
        continue;
      }

      const maxVersion = existingStageDeliverables.reduce((max, item) => Math.max(max, item.version), 0);
      const stageStatus = stage.status === "completed" ? "approved" : "draft";
      const templateDeliverable = {
        id: randomUUID(),
        projectId: project.id,
        stageType: stage.type,
        name: expectedName,
        type: "markdown",
        content: "",
        version: maxVersion + 1,
        status: stageStatus,
        createdBy: stage.assignee,
        createdAt: now,
        updatedAt: now
      };
      const content = await buildDeliverableBackfillContentWithAgent(project, templateDeliverable, stageRunCache);
      creates.push({
        ...templateDeliverable,
        content
      });
      scheduledNames.add(normalizedExpectedName);
    }
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

  const now = new Date();
  const nowIso = now.toISOString();
  const initDeliverable = project.deliverables.find((item) => item.stageType === "INIT");

  project.stages = project.stages.map((stage) => {
    if (stage.type === "INIT") {
      return {
        ...stage,
        status: "completed",
        progress: 100,
        startedAt: nowIso,
        endedAt: nowIso
      };
    }
    if (stage.type === currentStage) {
      return {
        ...stage,
        status: "active",
        progress: 48,
        startedAt: nowIso,
        endedAt: undefined
      };
    }
    return {
      ...stage,
      status: "pending",
      progress: 0,
      startedAt: undefined,
      endedAt: undefined
    };
  });

  const stageTaskOrder = new Map<string, number>();
  project.tasks = project.tasks.map((task) => {
    const index = stageTaskOrder.get(task.stageType) ?? 0;
    stageTaskOrder.set(task.stageType, index + 1);

    let status = task.status;
    if (task.stageType === "INIT") {
      status = "done";
    } else if (task.stageType === currentStage) {
      status = index === 0 ? "in_progress" : "todo";
    } else {
      status = "todo";
    }

    return {
      ...task,
      status,
      updatedAt: nowIso
    };
  });

  project.deliverables = [
    {
      id: initDeliverable?.id || randomUUID(),
      name: "项目章程.md",
      type: "markdown",
      content: [
        "# 项目章程",
        "",
        `项目 ${id} 已创建。`,
        `项目名称：${project.name}`,
        "",
        "## 原始需求",
        input.description,
        "",
        "## 当前阶段",
        `- ${STAGE_LABELS[currentStage]} (${currentStage})`,
        `- 负责人：${ROLE_LABELS[currentRole] || currentRole}`
      ].join("\n"),
      version: 1,
      status: "approved",
      stageType: "INIT",
      createdBy: "ROLE_PM",
      updatedAt: nowIso
    }
  ];

  project.liveSession = {
    activeRole: currentRole,
    title: `${STAGE_LABELS[currentStage]}阶段已启动`,
    body: [
      `## ${STAGE_LABELS[currentStage]}阶段准备中`,
      "",
      `- 当前负责人: ${ROLE_LABELS[currentRole] || currentRole}`,
      "- 已完成项目初始化与上下文注入。",
      "- 正在后台触发真实模型分析，请稍后查看实时输出流。"
    ].join("\n"),
    provider: runtimeMode,
    startedAt: nowIso
  };
  project.timeline = [
    {
      id: randomUUID(),
      timestamp: new Date(now.getTime() - 90 * 1000).toISOString(),
      agentId: "ROLE_PM",
      type: "project_created",
      title: "项目已创建",
      content: `${id} 已由项目经理立项并开始推进。`,
      priority: "normal"
    },
    {
      id: randomUUID(),
      timestamp: new Date(now.getTime() - 30 * 1000).toISOString(),
      agentId: currentRole,
      type: "stage_started",
      title: `${STAGE_LABELS[currentStage]}阶段启动`,
      content: `${ROLE_LABELS[currentRole]} 已接手当前阶段。`,
      priority: "normal"
    },
    {
      id: randomUUID(),
      timestamp: nowIso,
      agentId: currentRole,
      type: "thinking",
      title: "Agent 已接管阶段",
      content: "分析阶段已启动，正在后台预热模型并生成需求分析内容。",
      priority: "normal"
    }
  ];
  enrichProjectWithRequirementContract(project, input.requirementContract);

  await persistProject(project);
  const created = await findProject(id).then((value) => value as ProjectDetail);
  void warmupProjectAfterCreate(created);
  return created;
}

async function warmupProjectAfterCreate(project: ProjectDetail) {
  const stageType: StageType = "ANALYSIS";
  const role = stageAssignees[stageType];

  try {
    const run = await runProjectStageAgent({
      projectId: project.id,
      action: "project.create.bootstrap.async",
      projectName: project.name,
      projectDescription: project.description,
      parsedIntent: project.parsedIntent,
      stageType,
      role,
      summary: "需求分析师已开始工作，你可以直接进入观测室查看实时输出。"
    });

    const now = new Date();
    const update = await prisma.project.updateMany({
      where: {
        id: project.id,
        status: "active",
        currentStage: stageType,
        currentRole: role,
        pendingApproval: false
      },
      data: {
        liveTitle: run.title,
        liveBody: run.body,
        liveProvider: run.provider,
        liveStartedAt: now,
        updatedAt: now
      }
    });

    if (update.count > 0) {
      await prisma.timelineEvent.create({
        data: {
          projectId: project.id,
          timestamp: now,
          agentId: role,
          type: "thinking",
          title: "需求分析已生成",
          content: `${run.thinkingSummary}\n执行引擎: ${run.provider} · 模型 ${run.model}`,
          priority: "normal"
        }
      });
    }
  } catch (error) {
    console.warn(
      `[project] initial analysis warmup failed for ${project.id}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function runCompanionStageExecutions(input: {
  projectId: string;
  projectName: string;
  projectDescription: string;
  parsedIntent: ParsedIntent;
  stageType: StageType;
  primaryRole: RoleType;
  actionPrefix: string;
}) {
  const companionRoles = (STAGE_COMPANION_ROLES[input.stageType] || [])
    .filter((role) => role !== input.primaryRole);
  if (companionRoles.length === 0) {
    return;
  }

  for (const role of companionRoles) {
    try {
      await runProjectStageAgent({
        projectId: input.projectId,
        action: `${input.actionPrefix}.companion`,
        metadata: {
          companion: true,
          primaryRole: input.primaryRole
        },
        projectName: input.projectName,
        projectDescription: input.projectDescription,
        parsedIntent: input.parsedIntent,
        stageType: input.stageType,
        role,
        summary: `请作为${ROLE_LABELS[role]}对${STAGE_LABELS[input.stageType]}阶段产物进行独立评审，并输出可执行建议。`
      });
    } catch (error) {
      console.warn(
        `[project] companion stage execution failed for ${input.projectId}/${input.stageType}/${role}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
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

  await assertCurrentStageRealModelGate(project);
  assertCoreDeliverablesTemplateGate(project, project.currentStage);

  const currentIndex = stageOrder.indexOf(project.currentStage);
  const currentStage = project.stages[currentIndex];
  const isFinalStage = currentIndex === stageOrder.length - 1;
  const nextStage = isFinalStage ? null : stageOrder[currentIndex + 1];
  const nextRole = nextStage ? stageAssignees[nextStage] : null;

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
        liveTitle: `${STAGE_LABELS[nextStage as StageType]} 阶段已启动`,
        liveBody: [
          `## ${STAGE_LABELS[nextStage as StageType]}阶段准备中`,
          "",
          `- 当前负责人: ${ROLE_LABELS[nextRole as RoleType]}`,
          "- 系统已接收上一阶段审批结果并切换阶段。",
          "- 正在后台触发真实模型预热，稍后将更新实时输出流。"
        ].join("\n"),
        liveProvider: "system",
        liveStartedAt: new Date()
      }
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
          content: "阶段已切换，正在后台预热模型并生成实时推演内容。",
          priority: "normal"
        }
      ]
    });
  });

  const updated = await findProject(id);
  if (updated?.status === "completed") {
    void reconcileProjectDeliverablesNow(updated.id).catch(() => {
      // 验收补齐在后台执行，避免阻塞审批响应。
    });
  }
  if (updated && nextStage && nextRole) {
    void warmupNextStageAfterApprove(updated, nextStage, nextRole);
  }
  if (updated) {
    await syncRequirementBackfillOnProjectCompleted(updated);
  }
  return updated;
}

async function warmupNextStageAfterApprove(
  project: ProjectDetail,
  nextStage: StageType,
  nextRole: RoleType
) {
  try {
    const run = await runProjectStageAgent({
      projectId: project.id,
      action: "project.approve.next-stage.warmup",
      projectName: project.name,
      projectDescription: project.description,
      parsedIntent: project.parsedIntent,
      stageType: nextStage,
      role: nextRole,
      summary: `${ROLE_LABELS[nextRole]} 已开始 ${STAGE_LABELS[nextStage]} 阶段（后台预热）。`
    });

    const now = new Date();
    const update = await prisma.project.updateMany({
      where: {
        id: project.id,
        status: "active",
        currentStage: nextStage,
        currentRole: nextRole,
        pendingApproval: false
      },
      data: {
        liveTitle: run.title,
        liveBody: run.body,
        liveProvider: run.provider,
        liveStartedAt: now
      }
    });

    if (update.count > 0) {
      await prisma.timelineEvent.create({
        data: {
          projectId: project.id,
          timestamp: now,
          agentId: nextRole,
          type: "thinking",
          title: `${STAGE_LABELS[nextStage]}阶段预热完成`,
          content: `${run.thinkingSummary}\n执行引擎: ${run.provider} · 模型 ${run.model}`,
          priority: "normal"
        }
      });
    }

    await runCompanionStageExecutions({
      projectId: project.id,
      projectName: project.name,
      projectDescription: project.description,
      parsedIntent: project.parsedIntent,
      stageType: nextStage,
      primaryRole: nextRole,
      actionPrefix: "project.approve.next-stage.warmup"
    });
  } catch (error) {
    console.warn(
      `[project] next-stage warmup failed for ${project.id}/${nextStage}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
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
  input: StageSubmissionInput,
  options?: {
    finalizeApproval?: boolean;
  }
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
  const normalizedDesignContent = currentStageType === "DESIGN" && normalizedDesignReview
    ? ensureDesignSubmissionContent(input.content, normalizedDesignReview)
    : input.content;
  if (currentStageType === "DESIGN") {
    if (!normalizedDesignReview) {
      throw new Error("DESIGN_REVIEW_REQUIRED: 设计阶段提交必须包含完整设计审查卡。");
    }
    if (!normalizedDesignReview.approved) {
      throw new Error("DESIGN_REVIEW_NOT_APPROVED: 设计审查卡未通过，禁止提交阶段交付。");
    }
    const designErrors = validateDesignSubmission(normalizedDesignContent);
    if (designErrors.length > 0) {
      throw new Error(`DESIGN_REVIEW_REQUIRED: ${designErrors.join("；")}`);
    }
  }
  const submittedContent = normalizedDesignReview
    ? `${normalizedDesignContent}\n\n${renderDesignReviewCard(normalizedDesignReview)}`
    : normalizedDesignContent;
  const templateGate = validateDeliverableTemplateGate({
    stageType: currentStageType,
    deliverableName,
    content: submittedContent
  });
  if (!templateGate.passed) {
    throw new Error(`STAGE_TEMPLATE_VALIDATION_FAILED: ${deliverableName} 未通过模板校验（${templateGate.issues.join("；")}）`);
  }
  const finalizeApproval = options?.finalizeApproval !== false;

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
        pendingApproval: finalizeApproval,
        summary: finalizeApproval
          ? `${stageLabel}阶段交付物已提交，等待你的审批。`
          : `${stageLabel}阶段交付物持续补充中，正在整合验收材料。`,
        liveTitle: `${ROLE_LABELS[currentRole]}已提交${stageLabel}阶段交付物`,
        liveBody: submittedContent,
        liveProvider: project.liveSession.provider,
        liveStartedAt: new Date()
      }
    });

    const timelineData: Prisma.TimelineEventCreateManyInput[] = [
      {
        projectId: id,
        timestamp: new Date(),
        agentId: currentRole,
        type: "deliverable_submitted",
        title: "阶段交付物已提交",
        content: `${deliverableName} 已提交，版本 v${nextVersion}。`,
        priority: "high"
      }
    ];
    if (finalizeApproval) {
      timelineData.push({
        projectId: id,
        timestamp: new Date(),
        agentId: "ROLE_PM",
        type: "approval_required",
        title: `${stageLabel}阶段等待审批`,
        content: `${stageLabel}阶段已完成输出，请决定是否进入下一阶段。`,
        priority: "high"
      });
    }

    await tx.timelineEvent.createMany({
      data: timelineData
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
  const latestDeliverables = selectLatestDeliverablesByCoreName(project.deliverables);

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
    deliverables: latestDeliverables.map((deliverable) => ({
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
