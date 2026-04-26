import express from "express";
import { MutationPassthroughSchema } from "../validation/schemas.js";
import { validateBody } from "../validation/middleware.js";
import { createHash } from "node:crypto";
import { prisma } from "../db.js";
import type { StageType } from "@occ/shared";
import { asyncRoute, sendError, sendSuccess, type ApiErrorCode } from "./utils.js";
import { findProject } from "../data/repository.js";
import { buildTaskCollaboration } from "../services/task-collaboration.js";

const GITLAB_BASE_URL = String(process.env.GITLAB_BASE_URL || "https://gitlab.com").trim().replace(/\/$/, "");
const GITLAB_TOKEN = String(process.env.GITLAB_TOKEN || "").trim();
const GITLAB_WEBHOOK_SECRET = String(process.env.GITLAB_WEBHOOK_SECRET || "").trim();
const GITLAB_DEFAULT_PROJECT = String(
  process.env.GITLAB_DEFAULT_PROJECT
  || process.env.GITLAB_DEFAULT_PROJECT_ID
  || ""
).trim();
const HARNESS_PROJECT_MARKER = "OCC_PROJECT_ID";
const HARNESS_TASK_MARKER = "OCC_TASK_ID";
const HARNESS_PROJECT_MAIN_MARKER = "OCC_PROJECT_MAIN";
const HARNESS_QG_REPAIR_MARKER = "OCC_QG_REPAIR";
const HARNESS_LABEL = "occ-harness";
const HARNESS_QUALITY_GATE_REPAIR_LABEL = "occ-quality-gate-repair";
const STAGE_LABELS: Record<string, string> = {
  INIT: "项目立项",
  ANALYSIS: "需求分析",
  DESIGN: "需求设计/视觉设计",
  DEV: "代码开发",
  ACCEPT: "测试验收"
};

function parseOptionalString(input: unknown) {
  const value = String(input ?? "").trim();
  return value || undefined;
}

function parseIssueLabels(input: unknown) {
  if (Array.isArray(input)) {
    return input
      .map((item) => String(item ?? "").trim())
      .filter(Boolean)
      .join(",");
  }
  const value = parseOptionalString(input);
  return value;
}

function parseAssigneeIds(input: unknown) {
  if (!Array.isArray(input)) {
    return undefined;
  }
  const values = input
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);
  return values.length > 0 ? values : undefined;
}

function resolveProjectPath(input: unknown) {
  const raw = parseOptionalString(input);
  return raw ? decodeURIComponent(raw) : GITLAB_DEFAULT_PROJECT;
}

function resolveGitLabErrorCode(status: number): ApiErrorCode {
  if (status === 401 || status === 403) {
    return "FORBIDDEN";
  }
  if (status === 404) {
    return "NOT_FOUND";
  }
  if (status >= 400 && status < 500) {
    return "VALIDATION_ERROR";
  }
  return "SERVICE_UNAVAILABLE";
}

function ensureGitLabConfig(res: express.Response) {
  if (!GITLAB_TOKEN) {
    sendError(res, 503, "SERVICE_UNAVAILABLE", "GITLAB_TOKEN 未配置，无法调用 GitLab API");
    return false;
  }
  return true;
}

function isMissingGitLabSyncTableError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === "P2021";
}

async function safeUpsertGitLabSync(input: {
  projectId: string;
  issueIid: number;
  projectPath: string;
  status: string;
}) {
  try {
    await prisma.gitLabSync.upsert({
      where: {
        projectId_issueIid: {
          projectId: input.projectId,
          issueIid: input.issueIid
        }
      },
      create: {
        projectId: input.projectId,
        issueIid: input.issueIid,
        projectPath: input.projectPath,
        status: input.status
      },
      update: {
        projectPath: input.projectPath,
        status: input.status
      }
    });
  } catch (error) {
    if (isMissingGitLabSyncTableError(error)) {
      console.warn("[GitLabSync] table missing, skip sync write. Run Prisma schema sync to enable persistence.");
      return;
    }
    throw error;
  }
}

async function safeUpdateGitLabSyncByProjectPath(input: {
  projectPath: string;
  issueIid: number;
  status: string;
}) {
  try {
    await prisma.gitLabSync.updateMany({
      where: {
        projectPath: input.projectPath,
        issueIid: input.issueIid
      },
      data: {
        status: input.status
      }
    });
  } catch (error) {
    if (isMissingGitLabSyncTableError(error)) {
      console.warn("[GitLabSync] table missing, skip sync update. Run Prisma schema sync to enable persistence.");
      return;
    }
    throw error;
  }
}

async function safeFindGitLabTaskBinding(taskId: string) {
  try {
    return await prisma.gitLabSyncBinding.findUnique({
      where: {
        taskId_bindingType: {
          taskId,
          bindingType: "task"
        }
      }
    });
  } catch (error) {
    if (isMissingGitLabSyncTableError(error)) {
      return null;
    }
    throw error;
  }
}

async function safeFindGitLabProjectBinding(projectId: string) {
  try {
    return await prisma.gitLabSyncBinding.findFirst({
      where: {
        projectId,
        bindingType: "project"
      },
      orderBy: { updatedAt: "desc" }
    });
  } catch (error) {
    if (isMissingGitLabSyncTableError(error)) {
      return null;
    }
    throw error;
  }
}

async function safeUpsertGitLabTaskBinding(input: {
  projectId: string;
  taskId: string;
  projectPath: string;
  issueIid: number;
  syncPolicy: string;
  statusHash: string;
}) {
  try {
    await prisma.gitLabSyncBinding.upsert({
      where: {
        taskId_bindingType: {
          taskId: input.taskId,
          bindingType: "task"
        }
      },
      create: {
        projectId: input.projectId,
        taskId: input.taskId,
        gitlabProjectId: input.projectPath,
        issueId: String(input.issueIid),
        issueIid: input.issueIid,
        bindingType: "task",
        syncPolicy: input.syncPolicy,
        lastSyncedAt: new Date(),
        lastSyncHash: input.statusHash
      },
      update: {
        projectId: input.projectId,
        gitlabProjectId: input.projectPath,
        issueId: String(input.issueIid),
        issueIid: input.issueIid,
        syncPolicy: input.syncPolicy,
        lastSyncedAt: new Date(),
        lastSyncHash: input.statusHash
      }
    });
  } catch (error) {
    if (isMissingGitLabSyncTableError(error)) {
      console.warn("[GitLabSyncBinding] table missing, skip task binding write. Run Prisma schema sync to enable persistence.");
      return;
    }
    throw error;
  }
}

async function safeUpsertGitLabProjectBinding(input: {
  projectId: string;
  projectPath: string;
  issueIid: number;
  syncPolicy?: string;
  statusHash: string;
}) {
  try {
    const existing = await prisma.gitLabSyncBinding.findFirst({
      where: {
        projectId: input.projectId,
        bindingType: "project"
      },
      orderBy: { updatedAt: "desc" }
    });
    if (existing) {
      await prisma.gitLabSyncBinding.update({
        where: { id: existing.id },
        data: {
          gitlabProjectId: input.projectPath,
          issueId: String(input.issueIid),
          issueIid: input.issueIid,
          syncPolicy: input.syncPolicy || "db_plus_gitlab",
          lastSyncedAt: new Date(),
          lastSyncHash: input.statusHash
        }
      });
      return;
    }
    await prisma.gitLabSyncBinding.create({
      data: {
        projectId: input.projectId,
        gitlabProjectId: input.projectPath,
        issueId: String(input.issueIid),
        issueIid: input.issueIid,
        bindingType: "project",
        syncPolicy: input.syncPolicy || "db_plus_gitlab",
        lastSyncedAt: new Date(),
        lastSyncHash: input.statusHash
      }
    });
  } catch (error) {
    if (isMissingGitLabSyncTableError(error)) {
      console.warn("[GitLabSyncBinding] table missing, skip project binding write. Run Prisma schema sync to enable persistence.");
      return;
    }
    throw error;
  }
}

async function requestGitLab(path: string, init?: RequestInit) {
  const response = await fetch(`${GITLAB_BASE_URL}/api/v4${path}`, {
    ...init,
    headers: {
      "PRIVATE-TOKEN": GITLAB_TOKEN,
      "Content-Type": "application/json",
      ...(init?.headers || {})
    }
  });

  const text = await response.text();
  const payload = text ? (() => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  })() : null;

  return {
    ok: response.ok,
    status: response.status,
    payload,
    errorText: typeof payload === "string"
      ? payload
      : JSON.stringify(payload || {})
  };
}

function sanitizeLabelFragment(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function buildHarnessProjectLabel(projectId: string) {
  return `occ-project-${sanitizeLabelFragment(projectId)}`;
}

function buildHarnessStageLabel(stageType: string) {
  return `occ-stage-${sanitizeLabelFragment(stageType)}`;
}

function buildHarnessTaskLabel(taskId: string) {
  return `occ-task-${sanitizeLabelFragment(taskId).slice(0, 24)}`;
}

function buildQualityGateRepairMarker(projectId: string, stageType: string) {
  return `${HARNESS_QG_REPAIR_MARKER}:${projectId}:${stageType}`;
}

function buildHarnessIssueTitle(input: {
  projectId: string;
  taskTitle: string;
  stageType: string;
}) {
  return `[OCC][${input.stageType}] ${input.taskTitle} (${input.projectId})`;
}

function buildHarnessIssueDescription(input: {
  projectId: string;
  projectName: string;
  stageType: string;
  taskId: string;
  taskTitle: string;
  taskDescription: string;
  taskAssignee: string;
  taskPriority: string;
  taskStatus: string;
}) {
  return [
    `## Harness Task Dispatch`,
    `- OCC 项目: ${input.projectName} (${input.projectId})`,
    `- 阶段: ${input.stageType}`,
    `- 任务: ${input.taskTitle}`,
    `- 负责人: ${input.taskAssignee}`,
    `- 优先级: ${input.taskPriority}`,
    `- 当前状态: ${input.taskStatus}`,
    "",
    "## 任务描述",
    input.taskDescription || "暂无补充描述",
    "",
    "## 协作规则（Harness Engineering）",
    "- 先交付最小可验收结果，再持续迭代。",
    "- 每次变更必须有可追溯证据（提交、评论、产物链接）。",
    "- 阻塞/风险需在 issue 中显式同步。",
    "",
    "## 机器可读标记",
    `<!-- ${HARNESS_PROJECT_MARKER}:${input.projectId} -->`,
    `<!-- ${HARNESS_TASK_MARKER}:${input.taskId} -->`,
    `<!-- OCC_STAGE:${input.stageType} -->`
  ].join("\n");
}

function formatHumanTaskStatus(status: string) {
  switch (status) {
    case "done":
    case "completed":
      return "已完成";
    case "in_progress":
      return "进行中";
    case "blocked":
      return "阻塞";
    case "assigned":
      return "已指派";
    case "pending_review":
      return "待审阅";
    case "pending_approval":
      return "待审批";
    case "ready":
      return "就绪";
    case "draft":
      return "草稿";
    case "rejected":
      return "已驳回";
    case "cancelled":
      return "已取消";
    default:
      return "待处理";
  }
}

function excerptHumanText(input: string, limit = 220) {
  const normalized = String(input || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "暂无";
  }
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}...` : normalized;
}

function buildTaskNextAction(status: string) {
  if (status === "blocked") return "先解除阻塞，再继续推进 task。";
  if (status === "pending_review") return "请 reviewer 给出审阅结论与修复意见。";
  if (status === "pending_approval") return "等待人工审批/验收。";
  if (status === "done" || status === "completed") return "确认验收后关闭 issue。";
  return "继续推进当前 task，并在关键节点回写进展。";
}

function buildProjectMainIssueTitle(input: {
  projectId: string;
  projectName: string;
}) {
  return `[OCC][PROJECT] ${input.projectName} (${input.projectId})`;
}

function buildProjectMainIssueDescription(input: {
  projectId: string;
  projectName: string;
  projectStatus: string;
  currentStage: string;
  progress: number;
  pendingApproval: boolean;
  summary: string;
  team: string[];
  blockedTaskCount: number;
  reviewTaskCount: number;
  approvalTaskCount: number;
  openTaskCount: number;
  latestProgress: string[];
  nextStep: string;
}) {
  return [
    "## Project Collaboration Summary",
    `- OCC 项目: ${input.projectName} (${input.projectId})`,
    `- 当前状态: ${input.projectStatus}`,
    `- 当前阶段: ${input.currentStage}`,
    `- 进度: ${input.progress}%`,
    `- 待审批: ${input.pendingApproval ? "是" : "否"}`,
    `- 团队角色: ${input.team.join("、") || "暂无"}`,
    "",
    "## 当前概览",
    input.summary || "暂无项目摘要",
    "",
    "## 任务态势",
    `- Open Tasks: ${input.openTaskCount}`,
    `- Blocked Tasks: ${input.blockedTaskCount}`,
    `- Pending Review: ${input.reviewTaskCount}`,
    `- Pending Approval: ${input.approvalTaskCount}`,
    "",
    "## 最新进展",
    ...(input.latestProgress.length > 0 ? input.latestProgress.map((item) => `- ${item}`) : ["- 暂无额外进展"]),
    "",
    "## 下一步动作",
    `- ${input.nextStep}`,
    "",
    "## 机器可读标记",
    `<!-- ${HARNESS_PROJECT_MARKER}:${input.projectId} -->`,
    `<!-- ${HARNESS_PROJECT_MAIN_MARKER}:true -->`
  ].join("\n");
}

function buildTaskCollaborationIssueDescription(input: {
  projectId: string;
  projectName: string;
  stageType: string;
  taskId: string;
  taskTitle: string;
  taskDescription: string;
  taskStatus: string;
  taskPriority: string;
  legacyAssignee: string;
  ownerAgentId?: string | null;
  reviewAgentId?: string | null;
  coordinationMode?: string;
  blockedBy: string[];
  blockedReasonLabel?: string;
  blockedReasonDetail?: string;
  nextAction?: string;
  latestProgress: string[];
  delegationHighlights: string[];
  gitlabBindingLabel?: string;
}) {
  return [
    "## Task Collaboration Summary",
    `- OCC 项目: ${input.projectName} (${input.projectId})`,
    `- 阶段: ${input.stageType}`,
    `- 任务: ${input.taskTitle}`,
    `- 当前状态: ${formatHumanTaskStatus(input.taskStatus)}`,
    `- 优先级: ${input.taskPriority}`,
    `- Owner: ${input.ownerAgentId || input.legacyAssignee}`,
    `- Reviewer: ${input.reviewAgentId || "未设置"}`,
    `- Coordination: ${input.coordinationMode || "single_owner"}`,
    `- GitLab 绑定: ${input.gitlabBindingLabel || "尚未建立"}`,
    "",
    "## 任务描述",
    input.taskDescription || "暂无补充描述",
    "",
    "## 最新进展",
    ...(input.latestProgress.length > 0 ? input.latestProgress.map((item) => `- ${item}`) : ["- 暂无额外进展，按当前任务描述推进"]),
    "",
    "## 阻塞项",
    ...(input.blockedReasonLabel
      ? [`- ${input.blockedReasonLabel}: ${input.blockedReasonDetail || "暂无补充说明"}`]
      : input.blockedBy.length > 0
        ? input.blockedBy.map((item) => `- ${item}`)
        : ["- 当前无显式阻塞项"]),
    "",
    "## Delegation 摘要",
    ...(input.delegationHighlights.length > 0 ? input.delegationHighlights.map((item) => `- ${item}`) : ["- 当前暂无关键 delegation 摘要"]),
    "",
    "## 下一步动作",
    `- ${input.nextAction || buildTaskNextAction(input.taskStatus)}`,
    "",
    "## 机器可读标记",
    `<!-- ${HARNESS_PROJECT_MARKER}:${input.projectId} -->`,
    `<!-- ${HARNESS_TASK_MARKER}:${input.taskId} -->`,
    `<!-- OCC_STAGE:${input.stageType} -->`
  ].join("\n");
}

function extractHarnessMarker(source: string, marker: string) {
  const regex = new RegExp(`${marker}\\s*:\\s*([^\\s>]+)`, "i");
  const matched = source.match(regex);
  return matched ? String(matched[1] || "").trim() : "";
}

async function findIssueByMarker(projectPath: string, marker: string) {
  const query = new URLSearchParams({
    state: "all",
    per_page: "40",
    search: marker
  });
  const response = await requestGitLab(
    `/projects/${encodeURIComponent(projectPath)}/issues?${query.toString()}`
  );
  if (!response.ok || !Array.isArray(response.payload)) {
    return null;
  }

  for (const item of response.payload as Array<Record<string, unknown>>) {
    const iid = Number(item.iid);
    if (!Number.isInteger(iid) || iid <= 0) {
      continue;
    }
    const title = String(item.title || "");
    const description = String(item.description || "");
    const markerSource = `${title}\n${description}`;
    if (markerSource.includes(marker)) {
      return {
        iid,
        state: String(item.state || "opened")
      };
    }
  }

  return null;
}

function buildQualityGateRepairIssueTitle(input: {
  projectId: string;
  projectName: string;
  stageType: string;
  stageLabel: string;
}) {
  return `[OCC][QG-REPAIR][${input.stageType}] 修复 ${input.projectName} 的${input.stageLabel}阶段质量门禁阻断 (${input.projectId})`;
}

function buildQualityGateRepairIssueDescription(input: {
  projectId: string;
  projectName: string;
  stageType: string;
  stageLabel: string;
  stageStatus?: string;
  currentStage?: string;
  stageIssues: string[];
  validationCommands: string[];
  marker: string;
}) {
  const issueLines = input.stageIssues.length > 0
    ? input.stageIssues.map((item) => `- ${item}`)
    : ["- 该阶段被 lifecycle quality gate 标记为阻断，请核查交付物模板、执行记录与门禁状态。"];
  const validations = input.validationCommands.length > 0
    ? input.validationCommands.map((item) => `- ${item}`)
    : [
      "- pnpm --filter @occ/api typecheck",
      "- pnpm --filter @occ/web typecheck",
      "- pnpm --filter @occ/web build"
    ];

  return [
    "# 背景",
    `- 项目: ${input.projectName} (${input.projectId})`,
    `- 当前阶段: ${input.currentStage || "unknown"}`,
    `- 阻断阶段: ${input.stageType} (${input.stageLabel})`,
    `- 阶段状态: ${input.stageStatus || "unknown"}`,
    "- 来源: /api/projects/:id/lifecycle-quality-audit 的 stageAudits 阻断结果",
    "",
    "# 阻断项",
    ...issueLines,
    "",
    "# 本次目标",
    `- 修复 ${input.stageLabel} 阶段质量门禁阻断，恢复可验收状态`,
    "- 保持 issue-first 与单一事实语义，不新增平行状态系统",
    "",
    "# 验证命令",
    ...validations,
    "",
    "# Stop Conditions",
    "- 不要扩展为无关重构",
    "- 不要改动无关 API 契约",
    "- 不要新增平行状态语义或并行流程",
    "",
    "# 交付要求",
    "1. 明确修改文件与原因",
    "2. 明确修复了哪些阻断项",
    "3. 给出验证结果（命令+通过/失败）",
    "4. 给出残留风险与 follow-up",
    "",
    "## 机器可读标记",
    `<!-- ${HARNESS_PROJECT_MARKER}:${input.projectId} -->`,
    `<!-- OCC_STAGE:${input.stageType} -->`,
    `<!-- ${input.marker} -->`
  ].join("\n");
}

export async function upsertQualityGateRepairIssue(input: {
  projectId: string;
  projectName: string;
  stageType: string;
  stageLabel?: string;
  stageStatus?: string;
  currentStage?: string;
  stageIssues: string[];
  validationCommands?: string[];
  projectPath?: string;
}) {
  const stageType = String(input.stageType || "").trim().toUpperCase();
  if (!stageType) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "stageType is required"
    } as const;
  }
  const marker = buildQualityGateRepairMarker(input.projectId, stageType);
  const projectPath = resolveProjectPath(input.projectPath);

  const fallbackToLocal = !GITLAB_TOKEN || !projectPath;
  if (fallbackToLocal) {
    const digest = createHash("sha1").update(`${input.projectId}:${stageType}:${marker}`).digest("hex").slice(0, 8);
    const issueIid = Number.parseInt(digest, 16);
    return {
      ok: true,
      data: {
        action: "reused",
        issueIid,
        projectPath: projectPath || "local/quality-gate-repair",
        issueUrl: `${GITLAB_BASE_URL}/-/issues/local-qg-${stageType.toLowerCase()}-${digest}`,
        marker
      }
    } as const;
  }

  const stageLabel = String(input.stageLabel || STAGE_LABELS[stageType] || stageType).trim();
  const title = buildQualityGateRepairIssueTitle({
    projectId: input.projectId,
    projectName: input.projectName,
    stageType,
    stageLabel
  });
  const description = buildQualityGateRepairIssueDescription({
    projectId: input.projectId,
    projectName: input.projectName,
    stageType,
    stageLabel,
    stageStatus: input.stageStatus,
    currentStage: input.currentStage,
    stageIssues: input.stageIssues,
    validationCommands: input.validationCommands || [],
    marker
  });
  const labels = [
    HARNESS_LABEL,
    HARNESS_QUALITY_GATE_REPAIR_LABEL,
    buildHarnessProjectLabel(input.projectId),
    buildHarnessStageLabel(stageType)
  ].join(",");

  const existing = await findIssueByMarker(projectPath, marker);
  let issueIid: number;
  let state = "opened";
  let action: "created" | "reused" = "created";

  if (!existing) {
    const createResponse = await requestGitLab(
      `/projects/${encodeURIComponent(projectPath)}/issues`,
      {
        method: "POST",
        body: JSON.stringify({
          title,
          description,
          labels
        })
      }
    );
    if (!createResponse.ok) {
      return {
        ok: false,
        code: resolveGitLabErrorCode(createResponse.status),
        message: createResponse.errorText
      } as const;
    }
    issueIid = Number((createResponse.payload as { iid?: unknown })?.iid);
    state = String((createResponse.payload as { state?: unknown })?.state || "opened");
  } else {
    action = "reused";
    issueIid = existing.iid;
    const updateResponse = await requestGitLab(
      `/projects/${encodeURIComponent(projectPath)}/issues/${encodeURIComponent(String(issueIid))}`,
      {
        method: "PUT",
        body: JSON.stringify({
          title,
          description,
          labels,
          state_event: "reopen"
        })
      }
    );
    if (!updateResponse.ok) {
      return {
        ok: false,
        code: resolveGitLabErrorCode(updateResponse.status),
        message: updateResponse.errorText
      } as const;
    }
    state = String((updateResponse.payload as { state?: unknown })?.state || "opened");
  }

  if (!Number.isInteger(issueIid) || issueIid <= 0) {
    return {
      ok: false,
      code: "SERVICE_UNAVAILABLE",
      message: "GitLab issue iid is invalid"
    } as const;
  }

  await safeUpsertGitLabSync({
    projectId: input.projectId,
    issueIid,
    projectPath,
    status: state
  });

  return {
    ok: true,
    data: {
      action,
      issueIid,
      projectPath,
      issueUrl: `${GITLAB_BASE_URL}/${projectPath}/-/issues/${issueIid}`,
      marker
    }
  } as const;
}

function desiredIssueStateEvent(taskStatus: string) {
  return ["done", "completed"].includes(taskStatus) ? "close" : "reopen";
}

function desiredTaskStatusFromIssueState(issueState: string) {
  return issueState === "closed" ? "done" : "in_progress";
}

async function findIssueByTaskMarker(projectPath: string, taskId: string) {
  const query = new URLSearchParams({
    state: "all",
    per_page: "30",
    search: `${HARNESS_TASK_MARKER}:${taskId}`
  });
  const response = await requestGitLab(
    `/projects/${encodeURIComponent(projectPath)}/issues?${query.toString()}`
  );
  if (!response.ok || !Array.isArray(response.payload)) {
    return null;
  }
  for (const item of response.payload as Array<Record<string, unknown>>) {
    const iid = Number(item.iid);
    if (!Number.isInteger(iid) || iid <= 0) {
      continue;
    }
    const title = String(item.title || "");
    const description = String(item.description || "");
    const markerSource = `${title}\n${description}`;
    if (extractHarnessMarker(markerSource, HARNESS_TASK_MARKER) === taskId) {
      return {
        iid,
        state: String(item.state || "opened")
      };
    }
  }
  return null;
}

async function findProjectMainIssueByMarker(projectPath: string, projectId: string) {
  const query = new URLSearchParams({
    state: "all",
    per_page: "30",
    search: `${HARNESS_PROJECT_MARKER}:${projectId}`
  });
  const response = await requestGitLab(
    `/projects/${encodeURIComponent(projectPath)}/issues?${query.toString()}`
  );
  if (!response.ok || !Array.isArray(response.payload)) {
    return null;
  }
  for (const item of response.payload as Array<Record<string, unknown>>) {
    const iid = Number(item.iid);
    if (!Number.isInteger(iid) || iid <= 0) {
      continue;
    }
    const title = String(item.title || "");
    const description = String(item.description || "");
    const markerSource = `${title}\n${description}`;
    if (
      extractHarnessMarker(markerSource, HARNESS_PROJECT_MARKER) === projectId
      && /OCC_PROJECT_MAIN:true/i.test(markerSource)
    ) {
      return {
        iid,
        state: String(item.state || "opened")
      };
    }
  }
  return null;
}

async function ensureProjectMainIssue(input: {
  projectId: string;
  projectPath?: string;
}) {
  const project = await findProject(input.projectId);
  if (!project) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: `Project not found: ${input.projectId}`
    } as const;
  }

  const projectPath = resolveProjectPath(input.projectPath);
  if (!projectPath) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "GitLab projectPath 未配置（GITLAB_DEFAULT_PROJECT 或请求参数 projectPath）"
    } as const;
  }

  const binding = await safeFindGitLabProjectBinding(project.id);
  const existing = binding?.issueIid
    ? {
      iid: binding.issueIid,
      state: project.status
    }
    : await findProjectMainIssueByMarker(projectPath, project.id);

  const blockedTaskCount = project.tasks.filter((item) => item.status === "blocked").length;
  const reviewTaskCount = project.tasks.filter((item) => item.status === "pending_review").length;
  const approvalTaskCount = project.tasks.filter((item) => item.status === "pending_approval").length;
  const latestProgress = project.timeline.slice(0, 4).map((item) => `${item.title}: ${excerptHumanText(item.content)}`);
  const nextStep = project.pendingApproval
    ? "等待人工审批/验收结论，并根据结论决定继续推进或回退修复。"
    : blockedTaskCount > 0
      ? "优先解除阻塞任务，再推进当前阶段。"
      : `继续推进 ${project.currentStage} 阶段，并同步关键任务进展。`;

  const description = buildProjectMainIssueDescription({
    projectId: project.id,
    projectName: project.name,
    projectStatus: project.status,
    currentStage: project.currentStage,
    progress: project.progress,
    pendingApproval: project.pendingApproval,
    summary: project.summary,
    team: project.team,
    blockedTaskCount,
    reviewTaskCount,
    approvalTaskCount,
    openTaskCount: project.openTaskCount,
    latestProgress,
    nextStep
  });
  const labels = [HARNESS_LABEL, buildHarnessProjectLabel(project.id), "occ-project-main"].join(",");
  const statusHash = createHash("sha1").update(`${project.status}|${project.currentStage}|${description}`).digest("hex");

  let issueIid = existing?.iid;
  if (!issueIid) {
    const createResponse = await requestGitLab(
      `/projects/${encodeURIComponent(projectPath)}/issues`,
      {
        method: "POST",
        body: JSON.stringify({
          title: buildProjectMainIssueTitle({
            projectId: project.id,
            projectName: project.name
          }),
          description,
          labels
        })
      }
    );
    if (!createResponse.ok) {
      return {
        ok: false,
        code: resolveGitLabErrorCode(createResponse.status),
        message: createResponse.errorText
      } as const;
    }
    issueIid = Number((createResponse.payload as { iid?: unknown })?.iid);
  } else {
    const updateResponse = await requestGitLab(
      `/projects/${encodeURIComponent(projectPath)}/issues/${encodeURIComponent(String(issueIid))}`,
      {
        method: "PUT",
        body: JSON.stringify({
          description,
          labels,
          state_event: project.status === "completed" ? "close" : "reopen"
        })
      }
    );
    if (!updateResponse.ok) {
      return {
        ok: false,
        code: resolveGitLabErrorCode(updateResponse.status),
        message: updateResponse.errorText
      } as const;
    }
  }

  if (!Number.isInteger(issueIid) || issueIid <= 0) {
    return {
      ok: false,
      code: "SERVICE_UNAVAILABLE",
      message: "GitLab issue iid is invalid"
    } as const;
  }

  await safeUpsertGitLabProjectBinding({
    projectId: project.id,
    projectPath,
    issueIid,
    statusHash
  });

  return {
    ok: true,
    data: {
      projectId: project.id,
      projectPath,
      issueIid
    }
  } as const;
}

export async function ensureProjectMainIssueSync(input: {
  projectId: string;
  projectPath?: string;
}) {
  return ensureProjectMainIssue(input);
}

export async function publishProjectMainIssueNote(input: {
  projectId: string;
  body: string;
  projectPath?: string;
  issueIid?: number;
}) {
  const body = parseOptionalString(input.body);
  if (!body) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "body is required"
    } as const;
  }

  if (!GITLAB_TOKEN) {
    return {
      ok: false,
      code: "SERVICE_UNAVAILABLE",
      message: "GITLAB_TOKEN 未配置，无法发布项目主 Issue 讨论"
    } as const;
  }

  let targetProjectPath = parseOptionalString(input.projectPath);
  let targetIssueIid = Number(input.issueIid);

  if (!targetProjectPath || !Number.isInteger(targetIssueIid) || targetIssueIid <= 0) {
    const ensured = await ensureProjectMainIssue({
      projectId: input.projectId,
      projectPath: targetProjectPath || undefined
    });
    if (!ensured.ok) {
      return ensured;
    }
    targetProjectPath = ensured.data.projectPath;
    targetIssueIid = ensured.data.issueIid;
  }

  const response = await requestGitLab(
    `/projects/${encodeURIComponent(targetProjectPath)}/issues/${encodeURIComponent(String(targetIssueIid))}/notes`,
    {
      method: "POST",
      body: JSON.stringify({ body })
    }
  );
  if (!response.ok) {
    return {
      ok: false,
      code: resolveGitLabErrorCode(response.status),
      message: response.errorText
    } as const;
  }

  const noteId = Number((response.payload as { id?: unknown } | null)?.id);
  const noteUrl = Number.isFinite(noteId) && noteId > 0
    ? `${GITLAB_BASE_URL}/${targetProjectPath}/-/issues/${targetIssueIid}#note_${Math.round(noteId)}`
    : `${GITLAB_BASE_URL}/${targetProjectPath}/-/issues/${targetIssueIid}`;

  return {
    ok: true,
    data: {
      projectId: input.projectId,
      projectPath: targetProjectPath,
      issueIid: targetIssueIid,
      noteUrl
    }
  } as const;
}

export async function syncProjectGitLabHarness(input: {
  projectId: string;
  stageType?: StageType | string;
  projectPath?: string;
  closeOnComplete?: boolean;
}) {
  const project = await findProject(input.projectId);
  if (!project) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: `Project not found: ${input.projectId}`
    } as const;
  }

  if (!GITLAB_TOKEN) {
    return {
      ok: false,
      code: "SERVICE_UNAVAILABLE",
      message: "GITLAB_TOKEN 未配置，无法执行 Harness 同步"
    } as const;
  }

  const projectPath = resolveProjectPath(input.projectPath);
  if (!projectPath) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "GitLab projectPath 未配置（GITLAB_DEFAULT_PROJECT 或请求参数 projectPath）"
    } as const;
  }

  const targetStage = String(input.stageType || project.currentStage || "DEV").trim().toUpperCase();
  const tasks = project.tasks.filter((task) => task.stageType === targetStage);
  const projectMainIssue = await ensureProjectMainIssue({
    projectId: project.id,
    projectPath
  });

  const created: number[] = [];
  const updated: number[] = [];
  const reused: number[] = [];
  const failed: Array<{ taskId: string; taskTitle: string; reason: string }> = [];

  for (const task of tasks) {
    try {
      const existing = await findIssueByTaskMarker(projectPath, task.id);
      const labels = [
        HARNESS_LABEL,
        buildHarnessProjectLabel(project.id),
        buildHarnessStageLabel(task.stageType),
        buildHarnessTaskLabel(task.id)
      ].join(",");

      if (!existing) {
        const createResponse = await requestGitLab(
          `/projects/${encodeURIComponent(projectPath)}/issues`,
          {
            method: "POST",
            body: JSON.stringify({
              title: buildHarnessIssueTitle({
                projectId: project.id,
                taskTitle: task.title,
                stageType: task.stageType
              }),
              description: buildHarnessIssueDescription({
                projectId: project.id,
                projectName: project.name,
                stageType: task.stageType,
                taskId: task.id,
                taskTitle: task.title,
                taskDescription: task.description,
                taskAssignee: task.assignee,
                taskPriority: task.priority,
                taskStatus: task.status
              }),
              labels
            })
          }
        );

        if (!createResponse.ok) {
          throw new Error(createResponse.errorText);
        }

        const createdIssue = createResponse.payload as { iid?: unknown; state?: unknown };
        const iid = Number(createdIssue?.iid);
        if (!Number.isInteger(iid) || iid <= 0) {
          throw new Error("GitLab issue iid is invalid");
        }

        created.push(iid);
        await safeUpsertGitLabSync({
          projectId: project.id,
          issueIid: iid,
          projectPath,
          status: String(createdIssue?.state || "opened")
        });
      } else {
        reused.push(existing.iid);
        const desiredEvent = desiredIssueStateEvent(task.status);
        const shouldClose = desiredEvent === "close";
        const issueClosed = existing.state === "closed";
        if ((shouldClose && !issueClosed) || (!shouldClose && issueClosed)) {
          const updateResponse = await requestGitLab(
            `/projects/${encodeURIComponent(projectPath)}/issues/${encodeURIComponent(String(existing.iid))}`,
            {
              method: "PUT",
              body: JSON.stringify({
                state_event: desiredEvent,
                labels
              })
            }
          );
          if (!updateResponse.ok) {
            throw new Error(updateResponse.errorText);
          }
          updated.push(existing.iid);
          const issue = updateResponse.payload as { state?: unknown };
          await safeUpsertGitLabSync({
            projectId: project.id,
            issueIid: existing.iid,
            projectPath,
            status: String(issue?.state || (shouldClose ? "closed" : "opened"))
          });
        }
      }
    } catch (error) {
      failed.push({
        taskId: task.id,
        taskTitle: task.title,
        reason: error instanceof Error ? error.message : "unknown error"
      });
    }
  }

  if (input.closeOnComplete || project.status === "completed") {
    const labels = [HARNESS_LABEL, buildHarnessProjectLabel(project.id)].join(",");
    const openedIssues = await requestGitLab(
      `/projects/${encodeURIComponent(projectPath)}/issues?state=opened&per_page=100&labels=${encodeURIComponent(labels)}`
    );
    if (openedIssues.ok && Array.isArray(openedIssues.payload)) {
      for (const issue of openedIssues.payload as Array<Record<string, unknown>>) {
        const iid = Number(issue.iid);
        if (!Number.isInteger(iid) || iid <= 0) {
          continue;
        }
        const closeIssue = await requestGitLab(
          `/projects/${encodeURIComponent(projectPath)}/issues/${encodeURIComponent(String(iid))}`,
          {
            method: "PUT",
            body: JSON.stringify({ state_event: "close" })
          }
        );
        if (closeIssue.ok) {
          await safeUpsertGitLabSync({
            projectId: project.id,
            issueIid: iid,
            projectPath,
            status: "closed"
          });
        }
      }
    }
  }

  return {
    ok: true,
    data: {
      projectId: project.id,
      projectName: project.name,
      projectPath,
      projectIssueIid: projectMainIssue.ok ? projectMainIssue.data.issueIid : undefined,
      stageType: targetStage,
      closeOnComplete: Boolean(input.closeOnComplete || project.status === "completed"),
      taskTotal: tasks.length,
      created,
      updated,
      reused,
      failed
    }
  } as const;
}

export async function syncTaskGitLabHarness(input: {
  taskId: string;
  projectPath?: string;
}) {
  const task = await prisma.task.findUnique({
    where: { id: input.taskId },
    include: {
      project: true,
      dependencies: {
        where: { type: "blocks" },
        include: {
          dependsOnTask: true
        }
      },
      delegations: {
        where: {
          status: { in: ["completed", "failed", "expired"] }
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 3
      }
    }
  });
  if (!task) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: `Task not found: ${input.taskId}`
    } as const;
  }

  if (!GITLAB_TOKEN) {
    return {
      ok: false,
      code: "SERVICE_UNAVAILABLE",
      message: "GITLAB_TOKEN 未配置，无法执行 task GitLab 同步"
    } as const;
  }

  const projectPath = resolveProjectPath(input.projectPath);
  if (!projectPath) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "GitLab projectPath 未配置（GITLAB_DEFAULT_PROJECT 或请求参数 projectPath）"
    } as const;
  }

  const taskBinding = await safeFindGitLabTaskBinding(task.id);
  const existing = taskBinding?.issueIid
    ? {
      iid: taskBinding.issueIid,
      state: task.status
    }
    : await findIssueByTaskMarker(projectPath, task.id);
  const latestProgress = await prisma.timelineEvent.findMany({
    where: {
      projectId: task.projectId
    },
    orderBy: [{ timestamp: "desc" }],
    take: 4
  });
  const blockedBy = task.dependencies.map((item) => `${item.dependsOnTask.title}（${formatHumanTaskStatus(item.dependsOnTask.status)}）`);
  const delegationHighlights = task.delegations.map((item) => {
    const suffix = item.status === "completed"
      ? excerptHumanText(item.outputSummary || "")
      : `${item.status}: ${excerptHumanText(item.failureReason || "")}`;
    return `${item.title} -> ${suffix || "暂无摘要"}`;
  });
  const collaboration = buildTaskCollaboration({
    status: task.status,
    description: task.description,
    syncPolicy: task.syncPolicy,
    ownerAgentId: task.ownerAgentId,
    reviewAgentId: task.reviewAgentId,
    projectPendingApproval: task.project.pendingApproval,
    dependencies: task.dependencies,
    delegations: task.delegations,
    gitlabBinding: taskBinding
      ? {
        gitlabProjectId: taskBinding.gitlabProjectId,
        issueIid: taskBinding.issueIid,
        bindingType: taskBinding.bindingType,
        lastSyncedAt: taskBinding.lastSyncedAt,
        lastSyncHash: taskBinding.lastSyncHash
      }
      : null
  });
  const description = buildTaskCollaborationIssueDescription({
    projectId: task.project.id,
    projectName: task.project.name,
    stageType: task.stageType,
    taskId: task.id,
    taskTitle: task.title,
    taskDescription: task.description,
    taskStatus: task.status,
    taskPriority: task.priority,
    legacyAssignee: task.assignee,
    ownerAgentId: task.ownerAgentId,
    reviewAgentId: task.reviewAgentId,
    coordinationMode: task.coordinationMode,
    blockedBy,
    blockedReasonLabel: collaboration.blockedReason?.label,
    blockedReasonDetail: collaboration.blockedReason?.detail,
    nextAction: collaboration.nextAction?.detail,
    latestProgress: latestProgress.map((item) => `${item.title}: ${excerptHumanText(item.content)}`),
    delegationHighlights,
    gitlabBindingLabel: collaboration.gitlab?.issueIid
      ? `#${collaboration.gitlab.issueIid} (${collaboration.gitlab.status})`
      : collaboration.gitlab?.status === "sync_required"
        ? "要求同步但尚未建立 issue"
        : "尚未建立"
  });
  const labels = [
    HARNESS_LABEL,
    buildHarnessProjectLabel(task.project.id),
    buildHarnessStageLabel(task.stageType),
    buildHarnessTaskLabel(task.id)
  ].join(",");
  const statusHash = createHash("sha1").update(`${task.status}|${description}`).digest("hex");

  let issueIid = existing?.iid;
  if (!issueIid) {
    const createResponse = await requestGitLab(
      `/projects/${encodeURIComponent(projectPath)}/issues`,
      {
        method: "POST",
        body: JSON.stringify({
          title: buildHarnessIssueTitle({
            projectId: task.project.id,
            taskTitle: task.title,
            stageType: task.stageType
          }),
          description,
          labels
        })
      }
    );

    if (!createResponse.ok) {
      return {
        ok: false,
        code: resolveGitLabErrorCode(createResponse.status),
        message: createResponse.errorText
      } as const;
    }
    issueIid = Number((createResponse.payload as { iid?: unknown })?.iid);
  } else {
    const updateResponse = await requestGitLab(
      `/projects/${encodeURIComponent(projectPath)}/issues/${encodeURIComponent(String(issueIid))}`,
      {
        method: "PUT",
        body: JSON.stringify({
          description,
          labels,
          state_event: desiredIssueStateEvent(task.status)
        })
      }
    );
    if (!updateResponse.ok) {
      return {
        ok: false,
        code: resolveGitLabErrorCode(updateResponse.status),
        message: updateResponse.errorText
      } as const;
    }
  }

  if (!Number.isInteger(issueIid) || issueIid <= 0) {
    return {
      ok: false,
      code: "SERVICE_UNAVAILABLE",
      message: "GitLab issue iid is invalid"
    } as const;
  }

  await safeUpsertGitLabTaskBinding({
    projectId: task.project.id,
    taskId: task.id,
    projectPath,
    issueIid,
    syncPolicy: task.syncPolicy,
    statusHash
  });

  return {
    ok: true,
    data: {
      taskId: task.id,
      projectId: task.project.id,
      projectPath,
      issueIid,
      syncedAt: new Date().toISOString()
    }
  } as const;
}

export async function publishTaskIssueNote(input: {
  taskId: string;
  body: string;
  projectPath?: string;
}) {
  const body = parseOptionalString(input.body);
  if (!body) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "body is required"
    } as const;
  }

  const synced = await syncTaskGitLabHarness({
    taskId: input.taskId,
    projectPath: input.projectPath
  });
  if (!synced.ok) {
    return synced;
  }

  const response = await requestGitLab(
    `/projects/${encodeURIComponent(synced.data.projectPath)}/issues/${encodeURIComponent(String(synced.data.issueIid))}/notes`,
    {
      method: "POST",
      body: JSON.stringify({ body })
    }
  );
  if (!response.ok) {
    return {
      ok: false,
      code: resolveGitLabErrorCode(response.status),
      message: response.errorText
    } as const;
  }

  return {
    ok: true,
    data: {
      taskId: input.taskId,
      issueIid: synced.data.issueIid
    }
  } as const;
}

export function createGitLabRouter() {
  const router = express.Router();

  router.post("/harness/projects/:occProjectId/sync", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    if (!ensureGitLabConfig(res)) {
      return;
    }

    const occProjectId = parseOptionalString(req.params.occProjectId);
    if (!occProjectId) {
      sendError(res, 400, "VALIDATION_ERROR", "occProjectId is required");
      return;
    }

    const result = await syncProjectGitLabHarness({
      projectId: occProjectId,
      projectPath: parseOptionalString((req.body as Record<string, unknown>)?.projectPath),
      stageType: parseOptionalString((req.body as Record<string, unknown>)?.stageType),
      closeOnComplete: Boolean((req.body as Record<string, unknown>)?.closeOnComplete)
    });

    if (!result.ok) {
      sendError(res, result.code === "NOT_FOUND" ? 404 : 422, result.code, result.message);
      return;
    }

    sendSuccess(res, result.data);
  }));

  router.get("/projects/:projectId/issues", asyncRoute(async (req, res) => {
    if (!ensureGitLabConfig(res)) {
      return;
    }

    const projectPath = resolveProjectPath(req.params.projectId);
    if (!projectPath) {
      sendError(res, 400, "VALIDATION_ERROR", "projectId is required");
      return;
    }

    const state = parseOptionalString(req.query.state) || "opened";
    const labels = parseIssueLabels(req.query.labels);
    const page = String(req.query.page ?? "1");
    const perPage = String(req.query.per_page ?? "20");

    const query = new URLSearchParams({
      state,
      page,
      per_page: perPage
    });
    if (labels) {
      query.set("labels", labels);
    }

    const gitlab = await requestGitLab(
      `/projects/${encodeURIComponent(projectPath)}/issues?${query.toString()}`
    );

    if (!gitlab.ok) {
      sendError(res, gitlab.status, resolveGitLabErrorCode(gitlab.status), `GitLab API error: ${gitlab.errorText}`);
      return;
    }

    sendSuccess(res, gitlab.payload);
  }));

  router.post("/projects/:projectId/issues", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    if (!ensureGitLabConfig(res)) {
      return;
    }

    const projectPath = resolveProjectPath(req.params.projectId);
    if (!projectPath) {
      sendError(res, 400, "VALIDATION_ERROR", "projectId is required");
      return;
    }

    const title = parseOptionalString((req.body as Record<string, unknown>)?.title);
    if (!title) {
      sendError(res, 400, "VALIDATION_ERROR", "title is required");
      return;
    }

    const body: Record<string, unknown> = { title };
    const description = parseOptionalString((req.body as Record<string, unknown>)?.description);
    const dueDate = parseOptionalString((req.body as Record<string, unknown>)?.due_date);
    const labels = parseIssueLabels((req.body as Record<string, unknown>)?.labels);
    const assigneeIds = parseAssigneeIds((req.body as Record<string, unknown>)?.assignee_ids);

    if (description) {
      body.description = description;
    }
    if (dueDate) {
      body.due_date = dueDate;
    }
    if (labels) {
      body.labels = labels;
    }
    if (assigneeIds) {
      body.assignee_ids = assigneeIds;
    }

    const gitlab = await requestGitLab(
      `/projects/${encodeURIComponent(projectPath)}/issues`,
      {
        method: "POST",
        body: JSON.stringify(body)
      }
    );

    if (!gitlab.ok) {
      sendError(res, gitlab.status, resolveGitLabErrorCode(gitlab.status), `GitLab API error: ${gitlab.errorText}`);
      return;
    }

    const issue = gitlab.payload as { iid?: unknown; state?: unknown };
    const syncProjectId = parseOptionalString((req.body as Record<string, unknown>)?.projectId);
    const iid = Number(issue?.iid);
    if (syncProjectId && Number.isInteger(iid) && iid > 0) {
      await safeUpsertGitLabSync({
        projectId: syncProjectId,
        issueIid: iid,
        projectPath,
        status: String(issue?.state || "open")
      });
    }

    sendSuccess(res, gitlab.payload);
  }));

  router.get("/projects/:projectId/issues/:iid", asyncRoute(async (req, res) => {
    if (!ensureGitLabConfig(res)) {
      return;
    }

    const projectPath = resolveProjectPath(req.params.projectId);
    const iid = parseOptionalString(req.params.iid);
    if (!projectPath || !iid) {
      sendError(res, 400, "VALIDATION_ERROR", "projectId and iid are required");
      return;
    }

    const gitlab = await requestGitLab(
      `/projects/${encodeURIComponent(projectPath)}/issues/${encodeURIComponent(iid)}`
    );

    if (!gitlab.ok) {
      sendError(res, gitlab.status, resolveGitLabErrorCode(gitlab.status), `GitLab API error: ${gitlab.errorText}`);
      return;
    }

    sendSuccess(res, gitlab.payload);
  }));

  router.put("/projects/:projectId/issues/:iid", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    if (!ensureGitLabConfig(res)) {
      return;
    }

    const projectPath = resolveProjectPath(req.params.projectId);
    const iid = parseOptionalString(req.params.iid);
    if (!projectPath || !iid) {
      sendError(res, 400, "VALIDATION_ERROR", "projectId and iid are required");
      return;
    }

    const stateEvent = parseOptionalString((req.body as Record<string, unknown>)?.state_event);
    const labels = parseIssueLabels((req.body as Record<string, unknown>)?.labels);
    const assigneeIds = parseAssigneeIds((req.body as Record<string, unknown>)?.assignee_ids);

    const body: Record<string, unknown> = {};
    if (stateEvent) {
      body.state_event = stateEvent;
    }
    if (labels) {
      body.labels = labels;
    }
    if (assigneeIds) {
      body.assignee_ids = assigneeIds;
    }

    if (Object.keys(body).length === 0) {
      sendError(res, 400, "VALIDATION_ERROR", "at least one updatable field is required");
      return;
    }

    const gitlab = await requestGitLab(
      `/projects/${encodeURIComponent(projectPath)}/issues/${encodeURIComponent(iid)}`,
      {
        method: "PUT",
        body: JSON.stringify(body)
      }
    );

    if (!gitlab.ok) {
      sendError(res, gitlab.status, resolveGitLabErrorCode(gitlab.status), `GitLab API error: ${gitlab.errorText}`);
      return;
    }

    const issue = gitlab.payload as { state?: unknown };
    const syncProjectId = parseOptionalString((req.body as Record<string, unknown>)?.projectId);
    const iidInt = Number(iid);
    if (syncProjectId && Number.isInteger(iidInt) && iidInt > 0) {
      await safeUpsertGitLabSync({
        projectId: syncProjectId,
        issueIid: iidInt,
        projectPath,
        status: String(issue?.state || "synced")
      });
    }

    sendSuccess(res, gitlab.payload);
  }));

  router.post("/projects/:projectId/issues/:iid/notes", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    if (!ensureGitLabConfig(res)) {
      return;
    }

    const projectPath = resolveProjectPath(req.params.projectId);
    const iid = parseOptionalString(req.params.iid);
    const body = parseOptionalString((req.body as Record<string, unknown>)?.body);
    if (!projectPath || !iid) {
      sendError(res, 400, "VALIDATION_ERROR", "projectId and iid are required");
      return;
    }
    if (!body) {
      sendError(res, 400, "VALIDATION_ERROR", "body is required");
      return;
    }

    const gitlab = await requestGitLab(
      `/projects/${encodeURIComponent(projectPath)}/issues/${encodeURIComponent(iid)}/notes`,
      {
        method: "POST",
        body: JSON.stringify({ body })
      }
    );

    if (!gitlab.ok) {
      sendError(res, gitlab.status, resolveGitLabErrorCode(gitlab.status), `GitLab API error: ${gitlab.errorText}`);
      return;
    }

    sendSuccess(res, gitlab.payload);
  }));

  router.post("/webhook", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    if (GITLAB_WEBHOOK_SECRET) {
      const token = String(req.headers["x-gitlab-token"] || "").trim();
      if (!token || token !== GITLAB_WEBHOOK_SECRET) {
        sendError(res, 403, "FORBIDDEN", "invalid gitlab webhook token");
        return;
      }
    }

    const event = String(req.headers["x-gitlab-event"] || "");
    const payload = (req.body || {}) as Record<string, unknown>;

    console.log("[GitLab Webhook] Event:", event, JSON.stringify(payload).slice(0, 200));

    if (event === "Issue Hook" && payload.object_attributes && typeof payload.object_attributes === "object") {
      const issue = payload.object_attributes as Record<string, unknown>;
      const projectPath = String((payload.project as Record<string, unknown> | undefined)?.path_with_namespace || "").trim();
      const iid = Number(issue.iid);
      const state = String(issue.state || "").trim();
      const markerSource = `${String(issue.title || "")}\n${String(issue.description || "")}`;
      const projectIdMarker = extractHarnessMarker(markerSource, HARNESS_PROJECT_MARKER);
      const taskIdMarker = extractHarnessMarker(markerSource, HARNESS_TASK_MARKER);

      if (projectPath && Number.isInteger(iid) && iid > 0) {
        await safeUpdateGitLabSyncByProjectPath({
          projectPath,
          issueIid: iid,
          status: state || "synced"
        });
      }

      if (projectIdMarker && taskIdMarker) {
        const nextTaskStatus = desiredTaskStatusFromIssueState(state);
        await prisma.task.updateMany({
          where: {
            id: taskIdMarker,
            projectId: projectIdMarker
          },
          data: {
            status: nextTaskStatus
          }
        });
      }

      console.log(`[GitLab Webhook] Issue ${iid} (${state}): ${String(issue.title || "")}`);
    }

    sendSuccess(res, { ok: true });
  }));

  return router;
}
