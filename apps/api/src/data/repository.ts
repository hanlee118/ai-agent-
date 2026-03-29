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
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      stages: { orderBy: { sortOrder: "asc" } },
      tasks: { orderBy: [{ stageType: "asc" }, { sortOrder: "asc" }] },
      deliverables: { orderBy: [{ updatedAt: "desc" }] },
      timeline: { orderBy: { timestamp: "desc" } }
    }
  });

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

  const run = await runStageAgent({
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
    content: run.thinkingSummary,
    priority: "normal"
  });
  enrichProjectWithRequirementContract(project, input.requirementContract);

  await persistProject(project);
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

    if (currentIndex === stageOrder.length - 1) {
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

    const nextStage = stageOrder[currentIndex + 1];
    const nextRole = stageAssignees[nextStage];
    const run = await runStageAgent({
      projectName: project.name,
      projectDescription: project.description,
      parsedIntent: project.parsedIntent,
      stageType: nextStage,
      role: nextRole,
      summary: `${ROLE_LABELS[nextRole]} 已开始 ${STAGE_LABELS[nextStage]} 阶段。`
    });

    await tx.stage.update({
      where: { projectId_type: { projectId: id, type: nextStage } },
      data: {
        status: "active",
        progress: 18,
        startedAt: new Date()
      }
    });
    await tx.task.updateMany({
      where: { projectId: id, stageType: nextStage, sortOrder: 0 },
      data: { status: "in_progress" }
    });
    await tx.task.updateMany({
      where: { projectId: id, stageType: nextStage, sortOrder: { gt: 0 } },
      data: { status: "todo" }
    });

    await tx.project.update({
      where: { id },
      data: {
        currentStage: nextStage,
        currentRole: nextRole,
        pendingApproval: false,
        progress: Math.min(100, project.progress + 20),
        summary: `${ROLE_LABELS[nextRole]} 已开始 ${STAGE_LABELS[nextStage]} 阶段。`,
        liveTitle: run.title,
        liveBody: run.body,
        liveProvider: run.provider,
        liveStartedAt: new Date()
      }
    });

    await ensureDraftDeliverable(tx, {
      projectId: id,
      stageType: nextStage,
      createdBy: nextRole
    });

    await tx.timelineEvent.createMany({
      data: [
        {
          projectId: id,
          timestamp: new Date(),
          agentId: nextRole,
          type: "stage_started",
          title: `${STAGE_LABELS[nextStage]}阶段开始`,
          content: `${ROLE_LABELS[nextRole]} 已自动接手下一阶段。`,
          priority: "normal"
        },
        {
          projectId: id,
          timestamp: new Date(),
          agentId: nextRole,
          type: "thinking",
          title: "阶段推演已启动",
          content: run.thinkingSummary,
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
  const run = await runStageAgent({
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
          content: run.thinkingSummary,
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

  const run = await runStageAgent({
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
          content: run.thinkingSummary,
          priority: "normal"
        }
      ]
    })
  ]);

  return findProject(id);
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
