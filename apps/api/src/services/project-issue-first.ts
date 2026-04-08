import { prisma } from "../db.js";
import { ensureProjectMainIssueSync } from "../routes/gitlab.js";
import { getIssueByProjectId } from "../system/v1-method-store.js";

const ISSUE_FIRST_GITLAB_PROJECT = String(
  process.env.GITLAB_DEFAULT_PROJECT
  || process.env.GITLAB_DEFAULT_PROJECT_ID
  || ""
).trim();
const ISSUE_FIRST_GITLAB_TOKEN = String(process.env.GITLAB_TOKEN || "").trim();
const ISSUE_FIRST_LOCAL_ENFORCED = process.env.PROJECT_ISSUE_FIRST_LOCAL_ENFORCED !== "false";

function isMissingGitLabSyncBindingTableError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  return (error as { code?: unknown }).code === "P2021";
}

async function findProjectMainIssueBinding(projectId: string) {
  try {
    return await prisma.gitLabSyncBinding.findFirst({
      where: {
        projectId,
        bindingType: "project"
      },
      orderBy: { updatedAt: "desc" }
    });
  } catch (error) {
    if (isMissingGitLabSyncBindingTableError(error)) {
      return null;
    }
    throw error;
  }
}

export function isProjectIssueFirstEnforced() {
  return ISSUE_FIRST_LOCAL_ENFORCED || Boolean(ISSUE_FIRST_GITLAB_TOKEN && ISSUE_FIRST_GITLAB_PROJECT);
}

export async function ensureProjectIssueFirst(input: {
  projectId: string;
  projectPath?: string;
}) {
  const localIssue = ISSUE_FIRST_LOCAL_ENFORCED
    ? await getIssueByProjectId(input.projectId)
    : null;
  const localIssueReady = Boolean(localIssue?.id && localIssue?.status === "confirmed");

  if (localIssueReady) {
    return {
      ok: true,
      enforced: true,
      data: {
        projectId: input.projectId,
        issueId: localIssue?.id,
        source: "local_issue_store"
      }
    } as const;
  }

  const gitlabIssueFirstEnabled = Boolean(ISSUE_FIRST_GITLAB_TOKEN && ISSUE_FIRST_GITLAB_PROJECT);
  if (!gitlabIssueFirstEnabled) {
    if (ISSUE_FIRST_LOCAL_ENFORCED) {
      return {
        ok: false,
        enforced: true,
        code: "LOCAL_ISSUE_REQUIRED",
        message: "当前项目未绑定需求 Issue。请先通过 New Project Issue 流程确认需求后再推进。"
      } as const;
    }
    return {
      ok: true,
      enforced: false,
      reason: "gitlab_not_configured"
    } as const;
  }

  const binding = await findProjectMainIssueBinding(input.projectId);
  if (binding?.issueIid && binding.gitlabProjectId) {
    return {
      ok: true,
      enforced: true,
      data: {
        projectId: input.projectId,
        projectPath: binding.gitlabProjectId,
        issueIid: binding.issueIid,
        source: "binding"
      }
    } as const;
  }

  const ensured = await ensureProjectMainIssueSync({
    projectId: input.projectId,
    projectPath: input.projectPath || ISSUE_FIRST_GITLAB_PROJECT
  });
  if (!ensured.ok) {
    return {
      ok: false,
      enforced: true,
      code: ensured.code,
      message: ensured.message
    } as const;
  }

  return {
    ok: true,
    enforced: true,
    data: {
      ...ensured.data,
      source: "gitlab_sync"
    }
  } as const;
}

export function buildProjectIssueFirstMessage(result: {
  enforced: boolean;
  message?: string;
}) {
  if (!result.enforced) {
    return "当前环境未启用 GitLab project issue-first 门禁。";
  }
  return result.message || "当前项目尚未绑定需求 issue，需先创建并确认 issue 再推进项目事项。";
}
