import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function loadGitLabConfig(repoRoot = process.cwd()) {
  const envExamplePath = path.join(repoRoot, "apps", "api", ".env.example");
  const envPath = path.join(repoRoot, "apps", "api", ".env");
  const env = {
    ...loadEnvFile(existsSync(envExamplePath) ? envExamplePath : ""),
    ...loadEnvFile(existsSync(envPath) ? envPath : "")
  };

  return {
    gitlabBaseUrl: normalizeBaseUrl(env.GITLAB_BASE_URL || "https://gitlab.com"),
    gitlabToken: String(env.GITLAB_TOKEN || "").trim(),
    gitlabProject: String(env.GITLAB_DEFAULT_PROJECT || env.GITLAB_DEFAULT_PROJECT_ID || "").trim()
  };
}

export async function gitlabRequest(config, pathname, init = {}) {
  const response = await fetch(`${config.gitlabBaseUrl}/api/v4${pathname}`, {
    ...init,
    headers: {
      "PRIVATE-TOKEN": config.gitlabToken,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = typeof payload === "string" ? payload : JSON.stringify(payload);
    throw new Error(`GitLab API error ${response.status}: ${message}`);
  }

  return payload;
}

export async function findIssueByExactTitle(config, input) {
  const states = dedupeStates([input.state || "opened", "opened", "all"]);
  for (const state of states) {
    const query = new URLSearchParams({
      search: String(input.title || "").trim(),
      in: "title",
      state,
      per_page: "100"
    });

    const issues = await gitlabRequest(
      config,
      `/projects/${encodeURIComponent(input.projectPath)}/issues?${query.toString()}`
    );

    if (!Array.isArray(issues)) {
      continue;
    }

    const matched = issues.find((item) => String(item.title || "").trim() === String(input.title || "").trim()) || null;
    if (matched) {
      return matched;
    }
  }
  return null;
}

export async function upsertIssueByTitle(config, input) {
  const labels = Array.isArray(input.labels)
    ? input.labels.join(",")
    : String(input.labels || "").trim();
  const existing = input.updateIfExists
    ? await findIssueByExactTitle(config, {
        projectPath: input.projectPath,
        title: input.title,
        state: input.searchState || "opened"
      })
    : null;

  if (existing) {
    const updated = await gitlabRequest(
      config,
      `/projects/${encodeURIComponent(input.projectPath)}/issues/${encodeURIComponent(String(existing.iid))}`,
      {
        method: "PUT",
        body: JSON.stringify({
          title: input.title,
          description: input.description,
          labels
        })
      }
    );
    return { action: "updated", issue: updated };
  }

  try {
    const created = await gitlabRequest(
      config,
      `/projects/${encodeURIComponent(input.projectPath)}/issues`,
      {
        method: "POST",
        body: JSON.stringify({
          title: input.title,
          description: input.description,
          labels
        })
      }
    );
    return { action: "created", issue: created };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    if (!/409/.test(message) || !/Duplicated issue/i.test(message)) {
      throw error;
    }

    const duplicated = await findIssueByExactTitle(config, {
      projectPath: input.projectPath,
      title: input.title,
      state: "all"
    });
    if (!duplicated) {
      throw error;
    }
    const updated = await gitlabRequest(
      config,
      `/projects/${encodeURIComponent(input.projectPath)}/issues/${encodeURIComponent(String(duplicated.iid))}`,
      {
        method: "PUT",
        body: JSON.stringify({
          title: input.title,
          description: input.description,
          labels
        })
      }
    );
    return { action: "updated_after_duplicate", issue: updated };
  }
}

function dedupeStates(value) {
  return Array.from(new Set(value.map((item) => String(item || "").trim()).filter(Boolean)));
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
