import express from "express";
import { prisma } from "../db.js";
import type { StageType } from "@occ/shared";
import { asyncRoute, sendError, sendSuccess, type ApiErrorCode } from "./utils.js";
import { findProject } from "../data/repository.js";

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
const HARNESS_LABEL = "occ-harness";

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

function extractHarnessMarker(source: string, marker: string) {
  const regex = new RegExp(`${marker}\\s*:\\s*([^\\s>]+)`, "i");
  const matched = source.match(regex);
  return matched ? String(matched[1] || "").trim() : "";
}

function desiredIssueStateEvent(taskStatus: string) {
  return taskStatus === "done" ? "close" : "reopen";
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

export function createGitLabRouter() {
  const router = express.Router();

  router.post("/harness/projects/:occProjectId/sync", asyncRoute(async (req, res) => {
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

  router.post("/projects/:projectId/issues", asyncRoute(async (req, res) => {
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

  router.put("/projects/:projectId/issues/:iid", asyncRoute(async (req, res) => {
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

  router.post("/projects/:projectId/issues/:iid/notes", asyncRoute(async (req, res) => {
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

  router.post("/webhook", asyncRoute(async (req, res) => {
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
