import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SystemReadiness } from "@occ/shared";
import { prisma } from "../db.js";
import { getRuntimeStatus } from "../agents/runtime.js";
import { getOpenClawWorkspace } from "../openclaw/workspace.js";

const OPENCLAW_ROOT = path.join(os.homedir(), ".openclaw");
const OPENCLAW_CONFIG_PATH = path.join(OPENCLAW_ROOT, "openclaw.json");
const OPENCLAW_WORKSPACE_ROOT = path.join(OPENCLAW_ROOT, "workspace");

export async function getSystemReadiness(): Promise<SystemReadiness> {
  const runtime = await getRuntimeStatus();
  const workspace = await getOpenClawWorkspace();
  const databaseUrl = String(process.env.DATABASE_URL ?? "");
  const databasePath = resolveSqlitePath(databaseUrl);

  const [managedAgentCount, memoryEntryCount, usageLogCount] = await Promise.all([
    prisma.managedAgentConfig.count(),
    prisma.agentMemoryEntry.count(),
    prisma.agentUsageLog.count()
  ]);
  const configuredAgentCount = await readConfiguredAgentCount();
  const warnings: string[] = [];

  if (!databasePath || !existsSync(databasePath)) {
    warnings.push("SQLite database file is missing or DATABASE_URL is not pointing to a local file.");
  }

  if (!existsSync(OPENCLAW_CONFIG_PATH)) {
    warnings.push("OpenClaw config file was not found at ~/.openclaw/openclaw.json.");
  }

  if (!existsSync(OPENCLAW_WORKSPACE_ROOT)) {
    warnings.push("OpenClaw workspace root was not found at ~/.openclaw/workspace.");
  }

  if (runtime.requestedMode === "openai-compatible" && !runtime.configured) {
    warnings.push("Real model mode is selected but API base URL, model, or API key is still incomplete.");
  }

  if (workspace.agents.length === 0) {
    warnings.push("No live OpenClaw agents were discovered in the workspace snapshot.");
  }

  return {
    checkedAt: new Date().toISOString(),
    database: {
      url: databaseUrl,
      path: databasePath || undefined,
      exists: databasePath ? existsSync(databasePath) : false,
      managedAgentCount,
      memoryEntryCount,
      usageLogCount
    },
    openclaw: {
      configPath: OPENCLAW_CONFIG_PATH,
      configExists: existsSync(OPENCLAW_CONFIG_PATH),
      workspaceRoot: OPENCLAW_WORKSPACE_ROOT,
      workspaceExists: existsSync(OPENCLAW_WORKSPACE_ROOT),
      configuredAgentCount,
      liveWorkspaceAgentCount: workspace.agents.length,
      liveWorkspaceProjectCount: workspace.projects.length
    },
    runtime,
    warnings
  };
}

function resolveSqlitePath(databaseUrl: string) {
  if (!databaseUrl.startsWith("file:")) {
    return "";
  }

  return databaseUrl.slice("file:".length);
}

async function readConfiguredAgentCount() {
  try {
    const raw = await readFile(OPENCLAW_CONFIG_PATH, "utf8");
    const payload = JSON.parse(raw) as {
      agents?: {
        list?: unknown[];
      };
    };
    return Array.isArray(payload.agents?.list) ? payload.agents.list.length : 0;
  } catch {
    return 0;
  }
}
