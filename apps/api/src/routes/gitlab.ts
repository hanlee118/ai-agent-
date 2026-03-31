import express from "express";
import { prisma } from "../db.js";
import { asyncRoute, sendError, sendSuccess, type ApiErrorCode } from "./utils.js";

const GITLAB_BASE_URL = String(process.env.GITLAB_BASE_URL || "https://gitlab.com").trim().replace(/\/$/, "");
const GITLAB_TOKEN = String(process.env.GITLAB_TOKEN || "").trim();
const GITLAB_WEBHOOK_SECRET = String(process.env.GITLAB_WEBHOOK_SECRET || "").trim();
const GITLAB_DEFAULT_PROJECT = String(
  process.env.GITLAB_DEFAULT_PROJECT
  || process.env.GITLAB_DEFAULT_PROJECT_ID
  || ""
).trim();

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

export function createGitLabRouter() {
  const router = express.Router();

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

      if (projectPath && Number.isInteger(iid) && iid > 0) {
        await safeUpdateGitLabSyncByProjectPath({
          projectPath,
          issueIid: iid,
          status: state || "synced"
        });
      }

      console.log(`[GitLab Webhook] Issue ${iid} (${state}): ${String(issue.title || "")}`);
    }

    sendSuccess(res, { ok: true });
  }));

  return router;
}
