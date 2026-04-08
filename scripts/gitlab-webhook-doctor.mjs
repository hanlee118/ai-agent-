import { execFile as execFileCallback } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const envPath = path.join(repoRoot, "apps", "api", ".env");
const envExamplePath = path.join(repoRoot, "apps", "api", ".env.example");
const args = new Set(process.argv.slice(2));

const shouldFix = args.has("--fix");
const requestedProject = readArgValue("--project");
const requestedApiBase = readArgValue("--api-base");
const requestedHookUrl = readArgValue("--hook-url");
const requestedHookId = readArgValue("--hook-id");
const requestedContainer = readArgValue("--gitlab-container") || "gitlab";

const env = {
  ...loadEnvFile(existsSync(envExamplePath) ? envExamplePath : ""),
  ...loadEnvFile(existsSync(envPath) ? envPath : "")
};

const gitlabBaseUrl = normalizeBaseUrl(env.GITLAB_BASE_URL || "https://gitlab.com");
const gitlabToken = String(env.GITLAB_TOKEN || "").trim();
const gitlabProject = String(requestedProject || env.GITLAB_DEFAULT_PROJECT || env.GITLAB_DEFAULT_PROJECT_ID || "").trim();
const webhookSecret = String(env.GITLAB_WEBHOOK_SECRET || "").trim();
const apiBase = normalizeBaseUrl(requestedApiBase || process.env.OCC_API_BASE || "http://127.0.0.1:8787");
const desiredWebhookUrl = requestedHookUrl || buildDesiredWebhookUrl({ gitlabBaseUrl, apiBase });
const containerReachableApiBase = buildContainerReachableApiBase({ gitlabBaseUrl, apiBase });

await main();

async function main() {
  const problems = [];

  if (!gitlabToken) {
    problems.push("缺少 GITLAB_TOKEN");
  }
  if (!gitlabProject) {
    problems.push("缺少 GITLAB_DEFAULT_PROJECT");
  }
  if (!webhookSecret) {
    problems.push("缺少 GITLAB_WEBHOOK_SECRET");
  }

  if (problems.length > 0) {
    fail(`配置不完整: ${problems.join(" | ")}`);
  }

  const project = await gitlabRequest(`/projects/${encodeURIComponent(gitlabProject)}`);
  if (!project.ok) {
    fail(`无法读取 GitLab 项目 ${gitlabProject}: HTTP ${project.status} ${project.errorText}`);
  }

  const hooksResponse = await gitlabRequest(`/projects/${project.payload.id}/hooks`);
  if (!hooksResponse.ok || !Array.isArray(hooksResponse.payload)) {
    fail(`无法读取 GitLab webhook 列表: HTTP ${hooksResponse.status} ${hooksResponse.errorText}`);
  }

  const hooks = hooksResponse.payload;
  const existingHook = selectHook(hooks, requestedHookId, desiredWebhookUrl);
  const hostHealth = await probeHostHealth(apiBase);
  const containerProbe = await probeFromGitLabContainer({
    gitlabContainer: requestedContainer,
    gitlabBaseUrl,
    apiBase: containerReachableApiBase,
    desiredWebhookUrl,
    webhookSecret
  });

  const issues = [];
  if (!existingHook) {
    issues.push("未发现 GitLab project webhook");
  } else {
    if (normalizeUrl(existingHook.url) !== normalizeUrl(desiredWebhookUrl)) {
      issues.push(`webhook URL 不匹配: current=${existingHook.url} expected=${desiredWebhookUrl}`);
    }
    if (existingHook.issues_events !== true) {
      issues.push("issues_events 未开启");
    }
  }
  if (!hostHealth.ok) {
    issues.push(`宿主机 OCC API 不可达: ${hostHealth.detail}`);
  }
  if (containerProbe.supported && !containerProbe.ok) {
    issues.push(`GitLab 容器无法访问 OCC: ${containerProbe.detail}`);
  }

  printSummary({
    projectPath: gitlabProject,
    projectId: project.payload.id,
    desiredWebhookUrl,
    existingHook,
    hostHealth,
    containerProbe,
    issues
  });

  if (issues.length === 0 && !shouldFix) {
    console.log("gitlab-webhook-doctor: ok");
    return;
  }

  if (!shouldFix) {
    process.exitCode = 1;
    return;
  }

  const fixed = await reconcileHook({
    projectId: project.payload.id,
    existingHook,
    desiredWebhookUrl,
    webhookSecret
  });

  const finalHooksResponse = await gitlabRequest(`/projects/${project.payload.id}/hooks`);
  if (!finalHooksResponse.ok || !Array.isArray(finalHooksResponse.payload)) {
    fail(`修复后无法重新读取 webhook 列表: HTTP ${finalHooksResponse.status} ${finalHooksResponse.errorText}`);
  }

  const finalHook = selectHook(finalHooksResponse.payload, String(fixed.id), desiredWebhookUrl);
  const finalContainerProbe = await probeFromGitLabContainer({
    gitlabContainer: requestedContainer,
    gitlabBaseUrl,
    apiBase: containerReachableApiBase,
    desiredWebhookUrl,
    webhookSecret
  });

  const finalIssues = [];
  if (!finalHook) {
    finalIssues.push("修复后仍未发现 webhook");
  } else {
    if (normalizeUrl(finalHook.url) !== normalizeUrl(desiredWebhookUrl)) {
      finalIssues.push(`修复后 webhook URL 仍不一致: ${finalHook.url}`);
    }
    if (finalHook.issues_events !== true) {
      finalIssues.push("修复后 issues_events 仍未开启");
    }
  }
  if (finalContainerProbe.supported && !finalContainerProbe.ok) {
    finalIssues.push(`修复后 GitLab 容器仍无法访问 OCC: ${finalContainerProbe.detail}`);
  }

  console.log("");
  console.log("After Fix");
  console.log(`- action: ${fixed.action}`);
  console.log(`- hookId: ${fixed.id}`);
  console.log(`- hookUrl: ${finalHook?.url || desiredWebhookUrl}`);
  console.log(`- containerProbe: ${finalContainerProbe.supported ? (finalContainerProbe.ok ? "ok" : "failed") : "skipped"}`);

  if (finalIssues.length > 0) {
    fail(`修复未完成: ${finalIssues.join(" | ")}`);
  }

  console.log("gitlab-webhook-doctor: fixed");
}

function readArgValue(name) {
  const prefix = `${name}=`;
  const matched = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return matched ? matched.slice(prefix.length) : "";
}

function loadEnvFile(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return {};
  }
  const output = {};
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    output[key] = value;
  }
  return output;
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

function buildDesiredWebhookUrl(input) {
  const apiUrl = new URL(`${buildContainerReachableApiBase(input)}/api/gitlab/webhook`);
  return apiUrl.toString();
}

function buildContainerReachableApiBase(input) {
  const apiUrl = new URL(normalizeBaseUrl(input.apiBase));
  const gitlabHost = new URL(input.gitlabBaseUrl).hostname;
  const apiHost = apiUrl.hostname;
  const localHosts = new Set(["127.0.0.1", "localhost", "0.0.0.0"]);
  if (localHosts.has(gitlabHost) && localHosts.has(apiHost)) {
    apiUrl.hostname = "host.docker.internal";
  }
  return apiUrl.toString().replace(/\/$/, "");
}

async function gitlabRequest(pathname, init = {}) {
  const response = await fetch(`${gitlabBaseUrl}/api/v4${pathname}`, {
    ...init,
    headers: {
      "PRIVATE-TOKEN": gitlabToken,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    payload,
    errorText: typeof payload === "string" ? payload : JSON.stringify(payload || {})
  };
}

function selectHook(hooks, hookId, desiredUrl) {
  if (hookId) {
    const byId = hooks.find((hook) => String(hook.id) === String(hookId));
    if (byId) {
      return byId;
    }
  }
  const normalizedDesired = normalizeUrl(desiredUrl);
  const exact = hooks.find((hook) => normalizeUrl(hook.url) === normalizedDesired);
  if (exact) {
    return exact;
  }
  return hooks.find((hook) => normalizeUrl(hook.url).endsWith("/api/gitlab/webhook")) || null;
}

async function reconcileHook(input) {
  const body = {
    url: input.desiredWebhookUrl,
    token: input.webhookSecret,
    issues_events: true,
    confidential_issues_events: false,
    push_events: false,
    merge_requests_events: false,
    note_events: false,
    pipeline_events: false,
    wiki_page_events: false,
    job_events: false,
    enable_ssl_verification: false
  };

  if (!input.existingHook) {
    const created = await gitlabRequest(`/projects/${input.projectId}/hooks`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    if (!created.ok) {
      fail(`创建 webhook 失败: HTTP ${created.status} ${created.errorText}`);
    }
    return { action: "created", id: created.payload.id };
  }

  const updated = await gitlabRequest(`/projects/${input.projectId}/hooks/${input.existingHook.id}`, {
    method: "PUT",
    body: JSON.stringify(body)
  });
  if (!updated.ok) {
    fail(`更新 webhook 失败: HTTP ${updated.status} ${updated.errorText}`);
  }
  return { action: "updated", id: input.existingHook.id };
}

async function probeHostHealth(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/health`);
    return {
      ok: response.ok,
      detail: `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

async function probeFromGitLabContainer(input) {
  const gitlabHost = new URL(input.gitlabBaseUrl).hostname;
  const localGitLab = gitlabHost === "127.0.0.1" || gitlabHost === "localhost";
  if (!localGitLab) {
    return {
      supported: false,
      ok: true,
      detail: "skip: remote GitLab"
    };
  }

  try {
    await execFile("docker", ["inspect", input.gitlabContainer], { cwd: repoRoot });
  } catch {
    return {
      supported: false,
      ok: true,
      detail: "skip: gitlab container not found"
    };
  }

  const webhookPayload = JSON.stringify({
    object_attributes: {
      iid: 999999,
      state: "opened",
      title: "webhook-doctor-probe"
    },
    project: {
      path_with_namespace: gitlabProject
    }
  }).replace(/'/g, "'\\''");

  try {
    const healthCommand = `curl -sS -o /dev/null -w '%{http_code}' ${shellQuote(`${input.apiBase}/health`)}`;
    const healthResult = await execFile("docker", ["exec", input.gitlabContainer, "sh", "-lc", healthCommand], {
      cwd: repoRoot
    });
    const healthStatus = String(healthResult.stdout || "").trim();
    if (healthStatus !== "200") {
      return {
        supported: true,
        ok: false,
        detail: `health probe HTTP ${healthStatus || "unknown"}`
      };
    }

    const webhookCommand = [
      "curl -sS -o /dev/null -w '%{http_code}'",
      "-X POST",
      "-H 'Content-Type: application/json'",
      "-H 'X-Gitlab-Event: Issue Hook'",
      `-H 'X-Gitlab-Token: ${input.webhookSecret}'`,
      `--data '${webhookPayload}'`,
      shellQuote(input.desiredWebhookUrl)
    ].join(" ");
    const webhookResult = await execFile("docker", ["exec", input.gitlabContainer, "sh", "-lc", webhookCommand], {
      cwd: repoRoot
    });
    const webhookStatus = String(webhookResult.stdout || "").trim();
    return {
      supported: true,
      ok: webhookStatus === "200",
      detail: `webhook probe HTTP ${webhookStatus || "unknown"}`
    };
  } catch (error) {
    return {
      supported: true,
      ok: false,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function printSummary(input) {
  console.log("GitLab Webhook Doctor");
  console.log(`- project: ${input.projectPath} (#${input.projectId})`);
  console.log(`- desiredWebhookUrl: ${input.desiredWebhookUrl}`);
  console.log(`- existingHook: ${input.existingHook ? `#${input.existingHook.id} ${input.existingHook.url}` : "missing"}`);
  console.log(`- issuesEvents: ${input.existingHook ? String(input.existingHook.issues_events) : "n/a"}`);
  console.log(`- hostHealth: ${input.hostHealth.ok ? "ok" : "failed"} (${input.hostHealth.detail})`);
  console.log(
    `- containerProbe: ${input.containerProbe.supported ? (input.containerProbe.ok ? "ok" : "failed") : "skipped"} (${input.containerProbe.detail})`
  );
  if (input.issues.length > 0) {
    console.log(`- issues: ${input.issues.join(" | ")}`);
  } else {
    console.log("- issues: none");
  }
}

function fail(message) {
  console.error(`gitlab-webhook-doctor: ${message}`);
  process.exit(1);
}
