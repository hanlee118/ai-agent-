import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  LocalAgentMonitorOverview,
  LocalAgentSessionItem,
  LocalAgentSessionState,
  LocalAgentTool,
  LocalAgentToolSummary
} from "@occ/shared";
import { OPENCLAW_ROOT } from "../openclaw/paths.js";

const CODEX_ROOT = resolveRoot(process.env.CODEX_SESSIONS_ROOT, path.join(os.homedir(), ".codex", "sessions"));
const CLAUDE_ROOT = resolveRoot(process.env.CLAUDE_PROJECTS_ROOT, path.join(os.homedir(), ".claude", "projects"));
const OPENCLAW_AGENT_ROOT = resolveRoot(process.env.OPENCLAW_AGENT_ROOT, path.join(OPENCLAW_ROOT, "agents"));
const RECENT_WINDOW_MS = 1000 * 60 * 60 * 72;
const ACTIVE_WINDOW_MS = 1000 * 60 * 2;
const IDLE_WINDOW_MS = 1000 * 60 * 30;
const SESSION_LIMIT_PER_TOOL = 8;
const TAIL_READ_BYTES = 24 * 1024;

type SessionCandidate = {
  tool: LocalAgentTool;
  path: string;
  updatedAt: number;
  title: string;
  agentId?: string;
  projectLabel?: string;
  activeSignal?: string;
};

export async function getLocalAgentMonitorOverview(): Promise<LocalAgentMonitorOverview> {
  const [codexSessions, claudeSessions, openClawSessions] = await Promise.all([
    scanCodexSessions(),
    scanClaudeSessions(),
    scanOpenClawSessions()
  ]);

  const sessions = await hydrateSessions([
    ...codexSessions,
    ...claudeSessions,
    ...openClawSessions
  ]);

  const sortedSessions = sessions
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .slice(0, 18);

  return {
    scannedAt: new Date().toISOString(),
    tools: [
      buildToolSummary("codex", "Codex", CODEX_ROOT, codexSessions),
      buildToolSummary("claude", "Claude Code", CLAUDE_ROOT, claudeSessions),
      buildToolSummary("openclaw", "OpenClaw", OPENCLAW_AGENT_ROOT, openClawSessions)
    ],
    sessions: sortedSessions
  };
}

async function scanCodexSessions() {
  return scanJsonlFiles("codex", CODEX_ROOT, (filePath) => ({
    title: path.basename(filePath, ".jsonl"),
    projectLabel: normalizeRelativeLabel(CODEX_ROOT, path.dirname(filePath))
  }));
}

async function scanClaudeSessions() {
  return scanJsonlFiles("claude", CLAUDE_ROOT, (filePath) => ({
    title: path.basename(filePath, ".jsonl"),
    projectLabel: normalizeRelativeLabel(CLAUDE_ROOT, path.dirname(filePath))
  }));
}

async function scanOpenClawSessions() {
  return scanJsonlFiles("openclaw", OPENCLAW_AGENT_ROOT, (filePath) => {
    const relative = normalizeRelativeLabel(OPENCLAW_AGENT_ROOT, filePath).split("/");
    const agentId = relative[0];
    const sessionTitle = path.basename(filePath, ".jsonl");
    const lockPath = `${filePath}.lock`;

    return {
      title: `${agentId || "agent"} · ${sessionTitle}`,
      projectLabel: agentId ? `agents/${agentId}` : "agents",
      agentId,
      activeSignal: existsSync(lockPath) ? "lock-file" : undefined
    };
  });
}

async function scanJsonlFiles(
  tool: LocalAgentTool,
  rootPath: string,
  metaBuilder: (filePath: string) => Omit<SessionCandidate, "tool" | "path" | "updatedAt">
): Promise<SessionCandidate[]> {
  if (!existsSync(rootPath)) {
    return [];
  }

  const recentFiles = await collectRecentJsonlFiles(rootPath);

  return recentFiles
    .slice(0, SESSION_LIMIT_PER_TOOL)
    .map((entry) => ({
      tool,
      path: entry.path,
      updatedAt: entry.updatedAt,
      ...metaBuilder(entry.path)
    }));
}

async function collectRecentJsonlFiles(rootPath: string) {
  const queue = [rootPath];
  const files: Array<{ path: string; updatedAt: number }> = [];
  const now = Date.now();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    let entries: Array<{
      name: string;
      isDirectory: () => boolean;
      isFile: () => boolean;
    }>;
    try {
      entries = await readdir(current, { withFileTypes: true, encoding: "utf8" }) as typeof entries;
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
        continue;
      }

      try {
        const fileStat = await stat(fullPath);
        if (now - fileStat.mtimeMs <= RECENT_WINDOW_MS) {
          files.push({
            path: fullPath,
            updatedAt: fileStat.mtimeMs
          });
        }
      } catch {
        // ignore transient file system race
      }
    }
  }

  return files.sort((left, right) => right.updatedAt - left.updatedAt);
}

async function hydrateSessions(candidates: SessionCandidate[]): Promise<LocalAgentSessionItem[]> {
  return Promise.all(candidates.map(async (candidate) => {
    const lastMessage = await readLastMessage(candidate.path);

    return {
      id: `${candidate.tool}:${candidate.path}`,
      tool: candidate.tool,
      title: candidate.title,
      status: resolveStatus(candidate.updatedAt, candidate.activeSignal),
      path: candidate.path,
      updatedAt: new Date(candidate.updatedAt).toISOString(),
      lastMessage,
      agentId: candidate.agentId,
      projectLabel: candidate.projectLabel,
      activeSignal: candidate.activeSignal
    };
  }));
}

function buildToolSummary(
  tool: LocalAgentTool,
  label: string,
  rootPath: string,
  sessions: SessionCandidate[]
): LocalAgentToolSummary {
  const sessionStates = sessions.map((session) => resolveStatus(session.updatedAt, session.activeSignal));
  const updatedAt = sessions.length ? new Date(Math.max(...sessions.map((item) => item.updatedAt))).toISOString() : undefined;

  return {
    tool,
    label,
    rootPath,
    available: existsSync(rootPath),
    sessionCount: sessions.length,
    activeCount: sessionStates.filter((state) => state === "active").length,
    idleCount: sessionStates.filter((state) => state === "idle").length,
    staleCount: sessionStates.filter((state) => state === "stale").length,
    lastUpdatedAt: updatedAt
  };
}

function resolveStatus(updatedAt: number, activeSignal?: string): LocalAgentSessionState {
  if (activeSignal) {
    return "active";
  }

  const age = Date.now() - updatedAt;
  if (age <= ACTIVE_WINDOW_MS) {
    return "active";
  }
  if (age <= IDLE_WINDOW_MS) {
    return "idle";
  }
  return "stale";
}

async function readLastMessage(filePath: string) {
  try {
    const fileBuffer = await readFile(filePath);
    const tail = fileBuffer.subarray(Math.max(0, fileBuffer.length - TAIL_READ_BYTES)).toString("utf8");
    const lines = tail
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .reverse();

    for (const line of lines) {
      try {
        const payload = JSON.parse(line) as unknown;
        const text = extractText(payload);
        if (text) {
          return text.length > 180 ? `${text.slice(0, 177)}...` : text;
        }
      } catch {
        // ignore malformed tail lines
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function extractText(value: unknown, depth = 0): string {
  if (depth > 4 || value == null) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const text = extractText(item, depth + 1);
      if (text) {
        return text;
      }
    }
    return "";
  }

  if (typeof value !== "object") {
    return "";
  }

  const objectValue = value as Record<string, unknown>;
  const preferredKeys = [
    "text",
    "message",
    "content",
    "output",
    "summary",
    "body",
    "delta",
    "response",
    "prompt"
  ];

  for (const key of preferredKeys) {
    const text = extractText(objectValue[key], depth + 1);
    if (text) {
      return text;
    }
  }

  for (const nestedValue of Object.values(objectValue)) {
    const text = extractText(nestedValue, depth + 1);
    if (text) {
      return text;
    }
  }

  return "";
}

function normalizeRelativeLabel(rootPath: string, targetPath: string) {
  const relative = path.relative(rootPath, targetPath).trim();
  return relative || ".";
}

function resolveRoot(value: string | undefined, fallback: string) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return fallback;
  }
  return path.isAbsolute(raw) ? raw : path.resolve(raw);
}
