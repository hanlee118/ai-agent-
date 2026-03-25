import { EventEmitter } from "node:events";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  LocalAgentMonitorOverview,
  LocalAgentPricingMode,
  LocalAgentSessionItem,
  LocalAgentSessionState,
  LocalAgentTool,
  LocalAgentToolSummary,
  LocalAgentUsageSummary
} from "@occ/shared";
import { OPENCLAW_ROOT } from "../openclaw/paths.js";

const CODEX_ROOT = resolveRoot(process.env.CODEX_SESSIONS_ROOT, path.join(os.homedir(), ".codex", "sessions"));
const CLAUDE_ROOT = resolveRoot(process.env.CLAUDE_PROJECTS_ROOT, path.join(os.homedir(), ".claude", "projects"));
const OPENCLAW_AGENT_ROOT = resolveRoot(process.env.OPENCLAW_AGENT_ROOT, path.join(OPENCLAW_ROOT, "agents"));
const MONITOR_ROOTS: Record<LocalAgentTool, string> = {
  codex: CODEX_ROOT,
  claude: CLAUDE_ROOT,
  openclaw: OPENCLAW_AGENT_ROOT
};

const RECENT_WINDOW_MS = 1000 * 60 * 60 * 72;
const ACTIVE_WINDOW_MS = 1000 * 60 * 2;
const IDLE_WINDOW_MS = 1000 * 60 * 30;
const SESSION_LIMIT_PER_TOOL = 8;
const GLOBAL_SESSION_LIMIT = 18;
const TAIL_READ_BYTES = 32 * 1024;
const MONITOR_RECONCILE_MS = 15000;

type SessionCandidate = {
  tool: LocalAgentTool;
  path: string;
  updatedAt: number;
  title: string;
  agentId?: string;
  projectLabel?: string;
  activeSignal?: string;
};

type ParsedUsage = {
  model?: string;
  usage: LocalAgentUsageSummary;
};

const EMPTY_USAGE: LocalAgentUsageSummary = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  totalTokens: 0,
  knownCostUsd: 0,
  estimatedCostUsd: 0,
  pricingMode: "unavailable"
};

const monitorEvents = new EventEmitter();
let cachedOverview: LocalAgentMonitorOverview | null = null;
let initialized = false;
let refreshInFlight: Promise<LocalAgentMonitorOverview> | null = null;
let reconcileTimer: NodeJS.Timeout | null = null;
let debounceTimer: NodeJS.Timeout | null = null;
const watchers: FSWatcher[] = [];

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
    .slice(0, GLOBAL_SESSION_LIMIT);

  const tools = [
    buildToolSummary("codex", "Codex", CODEX_ROOT, sessions.filter((item) => item.tool === "codex")),
    buildToolSummary("claude", "Claude Code", CLAUDE_ROOT, sessions.filter((item) => item.tool === "claude")),
    buildToolSummary("openclaw", "OpenClaw", OPENCLAW_AGENT_ROOT, sessions.filter((item) => item.tool === "openclaw"))
  ];

  return {
    scannedAt: new Date().toISOString(),
    tools,
    sessions: sortedSessions,
    totals: mergeUsage(...tools.map((tool) => tool.usage))
  };
}

export async function getCachedLocalAgentMonitorOverview() {
  ensureLocalAgentMonitorLive();
  return cachedOverview ?? refreshLocalAgentMonitor("initial");
}

export function subscribeLocalAgentMonitor(listener: (overview: LocalAgentMonitorOverview) => void) {
  ensureLocalAgentMonitorLive();
  monitorEvents.on("snapshot", listener);

  if (cachedOverview) {
    listener(cachedOverview);
  } else {
    void refreshLocalAgentMonitor("subscriber");
  }

  return () => {
    monitorEvents.off("snapshot", listener);
  };
}

export function ensureLocalAgentMonitorLive() {
  if (initialized) {
    return;
  }

  initialized = true;
  for (const rootPath of Object.values(MONITOR_ROOTS)) {
    attachWatcher(rootPath);
  }

  reconcileTimer = setInterval(() => {
    void refreshLocalAgentMonitor("interval");
  }, MONITOR_RECONCILE_MS);
  reconcileTimer.unref?.();

  void refreshLocalAgentMonitor("bootstrap");
}

async function refreshLocalAgentMonitor(reason: string) {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = getLocalAgentMonitorOverview()
    .then((nextOverview) => {
      const hasChanged = !cachedOverview || serializeComparable(nextOverview) !== serializeComparable(cachedOverview);
      cachedOverview = nextOverview;
      if (hasChanged) {
        monitorEvents.emit("snapshot", nextOverview);
      }
      return nextOverview;
    })
    .finally(() => {
      refreshInFlight = null;
    });

  if (reason === "fs") {
    debounceTimer = null;
  }

  return refreshInFlight;
}

function attachWatcher(rootPath: string) {
  if (!existsSync(rootPath)) {
    return;
  }

  try {
    const watcher = watch(rootPath, { recursive: true }, () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        void refreshLocalAgentMonitor("fs");
      }, 250);
      debounceTimer.unref?.();
    });
    watchers.push(watcher);
  } catch {
    // Recursive watch is not supported in all environments. Periodic reconcile remains active.
  }
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
  return recentFiles.slice(0, SESSION_LIMIT_PER_TOOL).map((entry) => ({
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
    const [lastMessage, parsedUsage] = await Promise.all([
      readLastMessage(candidate.path),
      readUsage(candidate.tool, candidate.path)
    ]);

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
      activeSignal: candidate.activeSignal,
      model: parsedUsage.model,
      usage: parsedUsage.usage
    };
  }));
}

async function readUsage(tool: LocalAgentTool, filePath: string): Promise<ParsedUsage> {
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
        const payload = JSON.parse(line) as Record<string, unknown>;
        const parsed = parseUsagePayload(tool, payload);
        if (parsed) {
          return parsed;
        }
      } catch {
        // ignore malformed tail lines
      }
    }
  } catch {
    return { usage: EMPTY_USAGE };
  }

  return { usage: EMPTY_USAGE };
}

function parseUsagePayload(tool: LocalAgentTool, payload: Record<string, unknown>): ParsedUsage | null {
  if (tool === "codex") {
    const eventType = String(payload.type ?? "");
    const eventPayload = asRecord(payload.payload);
    if (eventType !== "event_msg" || String(eventPayload?.type ?? "") !== "token_count") {
      return null;
    }

    const info = asRecord(eventPayload?.info);
    const totalUsage = asRecord(info?.total_token_usage);
    const model = findString(payload, ["model", "model_name", "payload.model", "payload.model_name"]);

    const inputTokens = toInt(totalUsage?.input_tokens);
    const cachedInputTokens = toInt(totalUsage?.cached_input_tokens);
    const outputTokens = toInt(totalUsage?.output_tokens);
    const totalTokens = toInt(totalUsage?.total_tokens) || inputTokens + cachedInputTokens + outputTokens;

    return {
      model,
      usage: buildUsageSummary({
        tool,
        model,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        totalTokens
      })
    };
  }

  if (tool === "claude") {
    const message = asRecord(payload.message);
    const usage = asRecord(message?.usage);
    if (!usage) {
      return null;
    }

    const model = typeof message?.model === "string" ? message.model : undefined;
    const inputTokens = toInt(usage.input_tokens);
    const cachedInputTokens = toInt(usage.cache_read_input_tokens) + toInt(usage.cache_creation_input_tokens);
    const outputTokens = toInt(usage.output_tokens);
    const totalTokens = inputTokens + cachedInputTokens + outputTokens;

    return {
      model,
      usage: buildUsageSummary({
        tool,
        model,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        totalTokens
      })
    };
  }

  const message = asRecord(payload.message);
  const usage = extractOpenClawUsage(message);
  if (!usage) {
    return null;
  }

  const model = typeof message?.model === "string" ? message.model : undefined;
  const inputTokens = toInt(usage.input);
  const cachedInputTokens = toInt(usage.cacheRead) + toInt(usage.cacheWrite);
  const outputTokens = toInt(usage.output);
  const totalTokens = toInt(usage.totalTokens) || inputTokens + cachedInputTokens + outputTokens;
  const knownCostUsd = toNumber(asRecord(usage.cost)?.total);

  return {
    model,
    usage: buildUsageSummary({
      tool,
      model,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      totalTokens,
      knownCostUsd
    })
  };
}

function extractOpenClawUsage(message: Record<string, unknown> | null) {
  if (!message) {
    return null;
  }

  const directUsage = asRecord(message.usage);
  if (directUsage) {
    return directUsage;
  }

  const content = Array.isArray(message.content) ? message.content : [];
  for (const item of content) {
    const usage = asRecord(asRecord(item)?.usage);
    if (usage) {
      return usage;
    }
  }

  return null;
}

function buildUsageSummary(input: {
  tool: LocalAgentTool;
  model?: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  knownCostUsd?: number;
}) {
  const estimate = estimateCostUsd(input.tool, input.model, input.inputTokens, input.cachedInputTokens, input.outputTokens);
  const knownCostUsd = input.knownCostUsd ?? 0;
  const pricingMode: LocalAgentPricingMode =
    knownCostUsd > 0 ? "known" : estimate > 0 ? "estimated" : "unavailable";

  return {
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cachedInputTokens: input.cachedInputTokens,
    totalTokens: input.totalTokens,
    knownCostUsd,
    estimatedCostUsd: estimate,
    pricingMode
  } satisfies LocalAgentUsageSummary;
}

function buildToolSummary(
  tool: LocalAgentTool,
  label: string,
  rootPath: string,
  sessions: LocalAgentSessionItem[]
): LocalAgentToolSummary {
  const sessionStates = sessions.map((session) => session.status);
  const updatedAt = sessions.length ? new Date(Math.max(...sessions.map((item) => new Date(item.updatedAt).getTime()))).toISOString() : undefined;

  return {
    tool,
    label,
    rootPath,
    available: existsSync(rootPath),
    sessionCount: sessions.length,
    activeCount: sessionStates.filter((state) => state === "active").length,
    idleCount: sessionStates.filter((state) => state === "idle").length,
    staleCount: sessionStates.filter((state) => state === "stale").length,
    lastUpdatedAt: updatedAt,
    usage: mergeUsage(...sessions.map((session) => session.usage))
  };
}

function mergeUsage(...usages: LocalAgentUsageSummary[]): LocalAgentUsageSummary {
  const merged = usages.reduce<LocalAgentUsageSummary>((acc, usage) => ({
    inputTokens: acc.inputTokens + usage.inputTokens,
    outputTokens: acc.outputTokens + usage.outputTokens,
    cachedInputTokens: acc.cachedInputTokens + usage.cachedInputTokens,
    totalTokens: acc.totalTokens + usage.totalTokens,
    knownCostUsd: roundCurrency(acc.knownCostUsd + usage.knownCostUsd),
    estimatedCostUsd: roundCurrency(acc.estimatedCostUsd + usage.estimatedCostUsd),
    pricingMode:
      acc.pricingMode === "known" || usage.pricingMode === "known"
        ? "known"
        : acc.pricingMode === "estimated" || usage.pricingMode === "estimated"
          ? "estimated"
          : "unavailable"
  }), { ...EMPTY_USAGE });

  return merged;
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

function estimateCostUsd(
  tool: LocalAgentTool,
  model: string | undefined,
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number
) {
  const pricing = resolvePricing(tool, model);
  if (!pricing) {
    return 0;
  }

  return roundCurrency(
    (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (cachedInputTokens / 1_000_000) * pricing.cachedInputPerMillion +
    (outputTokens / 1_000_000) * pricing.outputPerMillion
  );
}

function resolvePricing(tool: LocalAgentTool, model?: string) {
  const normalized = String(model ?? "").toLowerCase();

  if (tool === "claude" && normalized.includes("claude-sonnet-4")) {
    return {
      inputPerMillion: 3,
      cachedInputPerMillion: 0.3,
      outputPerMillion: 15
    };
  }

  if ((tool === "openclaw" || tool === "codex") && (normalized.includes("gpt-5.4") || normalized.includes("gpt-5"))) {
    return {
      inputPerMillion: 2.5,
      cachedInputPerMillion: 0.5,
      outputPerMillion: 10
    };
  }

  if (tool === "openclaw" && normalized.includes("gpt-4.1")) {
    return {
      inputPerMillion: 2,
      cachedInputPerMillion: 0.5,
      outputPerMillion: 8
    };
  }

  return null;
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

function serializeComparable(overview: LocalAgentMonitorOverview) {
  return JSON.stringify({
    tools: overview.tools,
    sessions: overview.sessions.map((session) => ({
      id: session.id,
      status: session.status,
      updatedAt: session.updatedAt,
      lastMessage: session.lastMessage,
      usage: session.usage
    })),
    totals: overview.totals
  });
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function toInt(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
}

function toNumber(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function roundCurrency(value: number) {
  return Math.round(value * 10000) / 10000;
}

function findString(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const parts = key.split(".");
    let current: unknown = payload;
    for (const part of parts) {
      current = asRecord(current)?.[part];
    }
    if (typeof current === "string" && current.trim()) {
      return current.trim();
    }
  }
  return undefined;
}
