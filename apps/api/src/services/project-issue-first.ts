import { prisma } from "../db.js";
import { ensureProjectMainIssueSync } from "../routes/gitlab.js";

const ISSUE_FIRST_GITLAB_PROJECT = String(
  process.env.GITLAB_DEFAULT_PROJECT
  || process.env.GITLAB_DEFAULT_PROJECT_ID
  || ""
).trim();
const ISSUE_FIRST_GITLAB_TOKEN = String(process.env.GITLAB_TOKEN || "").trim();

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
  return Boolean(ISSUE_FIRST_GITLAB_TOKEN && ISSUE_FIRST_GITLAB_PROJECT);
}

export async function ensureProjectIssueFirst(input: {
  projectId: string;
  projectPath?: string;
}) {
  if (!isProjectIssueFirstEnforced()) {
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
  return result.message || "当前项目尚未建立 GitLab 项目主 issue，需先创建 issue 再推进项目事项。";
}
