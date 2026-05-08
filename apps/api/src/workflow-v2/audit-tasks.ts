import { prisma } from "../db.js";
import { writeAuditLog } from "../system/audit-log.js";

type GitLabMergeRequest = {
  iid: number;
  title?: string;
  description?: string;
  source_branch?: string;
  created_at?: string;
  web_url?: string;
};

const BRANCH_RULE = /^(feature|fix|hotfix)\/issue-\d+-[a-z0-9-]+$/;

function getGitLabConfig() {
  const token = String(process.env.GITLAB_TOKEN ?? "").trim();
  const base = String(process.env.GITLAB_BASE_URL || "https://gitlab.com").trim().replace(/\/$/, "");
  const project = String(
    process.env.GITLAB_DEFAULT_PROJECT
    || process.env.GITLAB_DEFAULT_PROJECT_ID
    || ""
  ).trim();
  return { token, base, project };
}

async function gitlabRequest(pathname: string, init: RequestInit = {}) {
  const { token, base } = getGitLabConfig();
  return fetch(`${base}/api/v4${pathname}`, {
    ...init,
    headers: {
      "PRIVATE-TOKEN": token,
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
}

async function listOpenedMergeRequests(projectPath: string): Promise<GitLabMergeRequest[]> {
  const encoded = encodeURIComponent(projectPath);
  const res = await gitlabRequest(`/projects/${encoded}/merge_requests?state=opened&per_page=100`);
  if (!res.ok) {
    throw new Error(`GitLab MR list failed: ${res.status}`);
  }
  const payload = await res.json();
  return Array.isArray(payload) ? payload as GitLabMergeRequest[] : [];
}

async function addMrLabel(projectPath: string, iid: number, labels: string[]) {
  const encoded = encodeURIComponent(projectPath);
  const res = await gitlabRequest(`/projects/${encoded}/merge_requests/${iid}`, {
    method: "PUT",
    body: JSON.stringify({ add_labels: labels.join(",") })
  });
  return res.ok;
}

async function addIssueComment(projectPath: string, issueIid: number, body: string) {
  const encoded = encodeURIComponent(projectPath);
  const res = await gitlabRequest(`/projects/${encoded}/issues/${issueIid}/notes`, {
    method: "POST",
    body: JSON.stringify({ body })
  });
  return res.ok;
}

function extractIssueIid(description: string) {
  const matched = description.match(/#(\d+)/);
  if (!matched) {
    return null;
  }
  const iid = Number(matched[1]);
  return Number.isInteger(iid) && iid > 0 ? iid : null;
}

export async function runAuditInspectionNow() {
  const { token, project } = getGitLabConfig();
  if (!token || !project) {
    return {
      ok: false,
      message: "gitlab not configured",
      scanned: 0,
      actions: []
    };
  }

  const now = Date.now();
  let mrs: GitLabMergeRequest[] = [];
  try {
    mrs = await listOpenedMergeRequests(project);
  } catch (error) {
    const message = error instanceof Error ? error.message : "audit inspection failed";
    await writeAuditLog({
      actorType: "system",
      actorLabel: "auditor-agent",
      action: "audit.inspection.failed",
      resourceType: "system",
      summary: `GitLab 巡检失败（${message}）`,
      detail: JSON.stringify({ message, project, base: getGitLabConfig().base }).slice(0, 2000)
    });
    return {
      ok: false,
      message,
      scanned: 0,
      actions: []
    };
  }
  const actions: Array<Record<string, unknown>> = [];

  for (const mr of mrs) {
    const desc = String(mr.description ?? "");
    const sourceBranch = String(mr.source_branch ?? "");
    const createdAt = Date.parse(String(mr.created_at ?? ""));
    const ageHours = Number.isFinite(createdAt) ? (now - createdAt) / (1000 * 60 * 60) : 0;
    const issueIid = extractIssueIid(desc);

    if (!issueIid) {
      const applied = await addMrLabel(project, mr.iid, ["missing-issue-link"]);
      actions.push({ type: "label_missing_issue_link", mrIid: mr.iid, applied });
    }
    if (sourceBranch && !BRANCH_RULE.test(sourceBranch)) {
      const applied = await addMrLabel(project, mr.iid, ["bad-branch-name"]);
      actions.push({ type: "label_bad_branch_name", mrIid: mr.iid, branch: sourceBranch, applied });
    }
    if (issueIid && ageHours > 72) {
      const applied = await addIssueComment(project, issueIid, "提醒：本 MR 已存活超过 3 天，请及时处理。");
      actions.push({ type: "comment_stale_mr", mrIid: mr.iid, issueIid, ageHours: Math.round(ageHours), applied });
    }
  }

  const systemProject = await prisma.project.findFirst({
    where: { id: "SYSTEM" },
    select: { id: true }
  }).catch(() => null);
  if (systemProject?.id) {
    await prisma.timelineEvent.create({
      data: {
        projectId: systemProject.id,
        timestamp: new Date(),
        agentId: "auditor-agent",
        type: "audit_inspection",
        title: "GitLab 巡检完成",
        content: `扫描 MR ${mrs.length} 个，动作 ${actions.length} 个`,
        priority: "info"
      }
    }).catch(() => null);
  }

  await writeAuditLog({
    actorType: "system",
    actorLabel: "auditor-agent",
    action: "audit.inspection.run",
    resourceType: "system",
    summary: `GitLab 巡检完成（mrs=${mrs.length}, actions=${actions.length}）`,
    detail: JSON.stringify(actions).slice(0, 4000)
  });

  return {
    ok: true,
    scanned: mrs.length,
    actions,
    message: mrs.length === 0
      ? "未发现 opened MR，巡检已完成但当前无可扫描对象"
      : `巡检完成：扫描 ${mrs.length} 个 MR，执行 ${actions.length} 个动作`
  };
}

export async function getLatestAuditInspectionSummary() {
  const row = await prisma.auditLog.findFirst({
    where: {
      action: {
        in: ["audit.inspection.run", "audit.inspection.failed"]
      }
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      summary: true,
      detail: true,
      createdAt: true
    }
  });
  if (!row) {
    return {
      available: false,
      message: "暂无巡检记录"
    };
  }
  let actionCount = 0;
  try {
    const parsed = JSON.parse(String(row.detail ?? "[]"));
    if (Array.isArray(parsed)) {
      actionCount = parsed.length;
    }
  } catch {
    actionCount = 0;
  }
  return {
    available: true,
    id: row.id,
    action: row.summary.includes("失败") ? "audit.inspection.failed" : "audit.inspection.run",
    summary: row.summary,
    actionCount,
    createdAt: row.createdAt.toISOString()
  };
}
