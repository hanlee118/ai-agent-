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
const DIRECT_PROJECT_CREATE_ENABLED = String(process.env.PROJECT_DIRECT_CREATE_ENABLED ?? "false").trim().toLowerCase() === "true";

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
  const gitlabIssueFirstEnabled = Boolean(ISSUE_FIRST_GITLAB_TOKEN && ISSUE_FIRST_GITLAB_PROJECT);
  const localIssue = ISSUE_FIRST_LOCAL_ENFORCED
    ? await getIssueByProjectId(input.projectId)
    : null;
  const localIssueReady = Boolean(localIssue?.id && localIssue?.status === "confirmed");

  if (ISSUE_FIRST_LOCAL_ENFORCED && !localIssueReady) {
    if (DIRECT_PROJECT_CREATE_ENABLED) {
      return {
        ok: true,
        enforced: false,
        reason: "direct_project_creation_enabled_without_local_issue"
      } as const;
    }
    return {
      ok: false,
      enforced: true,
      code: "LOCAL_ISSUE_REQUIRED",
      message:
        "当前项目未绑定需求 Issue，无法直接创建。\n\n"
        + "解决方案：\n"
        + "1. 先通过「New Project Issue」流程提交并确认需求\n"
        + "2. 或使用已有 Issue ID 关联当前项目\n\n"
        + "如需关闭此检查，管理员可设置 PROJECT_ISSUE_FIRST_LOCAL_ENFORCED=false"
    } as const;
  }

  if (!gitlabIssueFirstEnabled) {
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
        issueId: localIssue?.id,
        source: "binding"
      }
    } as const;
  }

  const ensured = await ensureProjectMainIssueSync({
    projectId: input.projectId,
    projectPath: input.projectPath || ISSUE_FIRST_GITLAB_PROJECT
  });
  if (!ensured.ok) {
    // GitLab 同步异常时，若本地 issue-first 已满足，则降级为本地门禁通过，
    // 避免外部 GitLab 波动导致项目推进长期阻塞。
    if (localIssueReady) {
      return {
        ok: true,
        enforced: true,
        data: {
          projectId: input.projectId,
          issueId: localIssue?.id,
          source: "local_issue_store_fallback"
        },
        warning: {
          code: ensured.code,
          message: ensured.message
        }
      } as const;
    }
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
      issueId: localIssue?.id,
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
