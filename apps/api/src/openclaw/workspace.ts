import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  open,
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  readdir,
  readFile,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  OpenClawAgentDetail,
  OpenClawAgentAttemptTrace,
  OpenClawBatchAgentCommandResult,
  OpenClawAgentCommandResult,
  OpenClawAgentCommanderSettings,
  OpenClawCreateAgentInput,
  OpenClawMemoryEntryInput,
  OpenClawAgentModelOption,
  OpenClawAgentSlaItem,
  OpenClawBatchAgentMessageInput,
  OpenClawBatchTaskUpdateInput,
  OpenClawAgentMessageInput,
  OpenClawAgentPresence,
  OpenClawAgentSettingsInput,
  OpenClawAgentSummary,
  OpenClawDocumentUpdateInput,
  OpenClawEditableDocument,
  OpenClawEditableDocumentType,
  OpenClawExecutionMode,
  OpenClawFindingSeverity,
  OpenClawAgentMemoryEntry,
  OpenClawAgentUsageLogEntry,
  OpenClawAgentUsageSummary,
  OpenClawInstructionPreview,
  OpenClawInstructionPreviewInput,
  OpenClawProjectDetail,
  OpenClawProjectDocument,
  OpenClawProjectReport,
  OpenClawProjectState,
  OpenClawSlaState,
  OpenClawSessionMessage,
  OpenClawSessionSummary,
  OpenClawStatusFinding,
  OpenClawStatusSummary,
  OpenClawTaskItem,
  OpenClawTaskState,
  OpenClawTaskUpdateInput,
  OpenClawWorkspaceOverview
} from "@occ/shared";
import { promisify } from "node:util";
import { prisma } from "../db.js";
import {
  DESIGN_MODEL_FALLBACKS,
  DESIGN_MODEL_PRIMARY,
  isDesignModelPreferred
} from "../agents/design-model-policy.js";
import {
  OPENCLAW_CONFIG_PATH,
  OPENCLAW_ROOT,
  OPENCLAW_WORKSPACE_ROOT
} from "./paths.js";

function resolveOpenClawBin(): string {
  const envPath = String(process.env.OPENCLAW_BIN ?? "").trim();
  if (envPath) {
    if (!path.isAbsolute(envPath)) {
      throw new Error("OPENCLAW_BIN must be an absolute path");
    }
    if (!existsSync(envPath)) {
      throw new Error(`OPENCLAW_BIN not found: ${envPath}`);
    }
    return envPath;
  }

  const candidates = [
    path.resolve(OPENCLAW_ROOT, "node_modules/.bin/openclaw"),
    path.resolve(process.cwd(), "node_modules/.bin/openclaw"),
    path.resolve(path.dirname(process.execPath), "openclaw"),
    "/Users/dalongxia/.nvm/versions/node/v24.14.0/bin/openclaw",
    "/opt/homebrew/bin/openclaw",
    "/usr/local/bin/openclaw",
    "/usr/bin/openclaw"
  ];

  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && existsSync(candidate)) {
      return candidate;
    }
  }

  return "openclaw";
}

const OPENCLAW_BIN = resolveOpenClawBin();

type TeamMember = {
  name: string;
  title: string;
  agentId: string;
  openId?: string;
  responsibility: string;
};

type OpenClawConfig = {
  env?: Record<string, string>;
  models?: {
    providers?: Record<string, {
      baseUrl?: string;
      api?: string;
      apiKey?: string;
      models?: Array<Record<string, unknown>>;
    }>;
  };
  agents?: {
    defaults?: {
      workspace?: string;
      heartbeat?: {
        every?: string;
      };
    };
    list?: Array<{
      id: string;
      name?: string;
      workspace?: string;
      agentDir?: string;
      model?: string | {
        primary?: string;
        fallbacks?: string[];
      };
      subagents?: {
        allowAgents?: string[];
      };
      tools?: {
        allow?: string[];
      };
    }>;
  };
};

type AgentConfig = NonNullable<NonNullable<OpenClawConfig["agents"]>["list"]>[number];

type SessionRecord = {
  updatedAt?: number;
  displayName?: string;
  channel?: string;
  chatType?: string;
  subject?: string;
  systemSent?: boolean;
  abortedLastRun?: boolean;
  sessionId?: string;
  sessionFile?: string;
  model?: string;
  modelProvider?: string;
  modelOverride?: string;
  providerOverride?: string;
  fallbackNoticeSelectedModel?: string;
  fallbackNoticeActiveModel?: string;
  fallbackNoticeReason?: string;
};

type ProjectBuild = {
  detail: OpenClawProjectDetail;
  tasks: OpenClawTaskItem[];
};

type RawProjectTask = {
  id?: string | number;
  agent?: string;
  role?: string;
  owner?: string;
  task?: string;
  title?: string;
  progress?: number;
  status?: string;
  deadline?: string;
  blockers?: string[];
  deliverable?: string;
  depends_on?: string[];
};

type RawProjectTasksPayload = {
  project?: string | {
    name?: string;
    directory?: string;
    type?: string;
    note?: string;
  };
  created?: string;
  last_updated?: string;
  tasks?: RawProjectTask[];
  blockers_summary?: Record<string, string[]>;
};

export type OccProjectWorkspaceContext = {
  workspacePath: string;
  relativePath: string;
  contextFilePath: string;
  stageNotePath: string;
  taskTitles: string[];
  expectedDeliverables: string[];
  evidenceFiles: string[];
};

const execFileAsync = promisify(execFile);

const TEAM_FILE_PATH = path.join(OPENCLAW_WORKSPACE_ROOT, "TEAM.md");
const PROJECT_DOC_FILES = [
  "README.md",
  "requirements.md",
  "prototype.md",
  "architecture.md",
  "SPRINT.md",
  "TEST-REPORT.md",
  "TEAM.md",
  "AGENTS.md"
];
const PROJECT_DOC_EXTENSIONS = new Set([".md", ".html", ".txt", ".pdf"]);
const TEXT_EXCERPT_EXTENSIONS = new Set([".md", ".html", ".txt"]);
const RESERVED_WORKSPACE_DIRS = new Set([
  ".git",
  ".openclaw",
  "agents",
  "memory",
  "skills",
  "scripts",
  "occ-backend",
  "occ-frontend"
]);
const SOP_FILE_CANDIDATES = ["sop-document.md", "SOP.md"];
const NON_DELETABLE_AGENT_IDS = new Set(["main"]);
const MODEL_ROUTING_PLACEHOLDERS = new Set(["runtime", "unknown", "default", "auto"]);
const HARD_FALLBACK_MODELS = [
  "openai/gpt-5.4",
  "openai/gpt-5.3-codex",
  "anthropic/claude-sonnet-4-6",
  "minima/MiniMax-M2.7-highspeed"
];
let statusCache: { expiresAt: number; value: OpenClawStatusSummary } | null = null;

export async function getOpenClawWorkspace(): Promise<OpenClawWorkspaceOverview> {
  const { agents, projects } = await buildWorkspaceSnapshot();

  return {
    syncedAt: new Date().toISOString(),
    rootPath: OPENCLAW_WORKSPACE_ROOT,
    projects: projects.map((project) => project.detail),
    agents: agents.map(toAgentSummary),
    totalSessions: agents.reduce((sum, agent) => sum + agent.sessions.length, 0)
  };
}

export async function listOpenClawProjects(): Promise<OpenClawProjectDetail[]> {
  const { projects } = await buildWorkspaceSnapshot();
  return projects.map((project) => project.detail);
}

export async function findOpenClawProject(projectId: string): Promise<OpenClawProjectDetail | undefined> {
  const { projects } = await buildWorkspaceSnapshot();
  return projects.find((project) => project.detail.id === projectId)?.detail;
}

export async function listOpenClawAgents(): Promise<OpenClawAgentSummary[]> {
  const { agents } = await buildWorkspaceSnapshot();
  return agents.map(toAgentSummary);
}

export async function findOpenClawAgent(agentId: string): Promise<OpenClawAgentDetail | undefined> {
  const { agents } = await buildWorkspaceSnapshot();
  return agents.find((agent) => agent.agentId === agentId);
}

export function isDesignAgentProfile(profile: string) {
  const normalized = String(profile || "").replace(/[_-]+/g, " ").toLowerCase();
  return /\b(design|ui|ux|jeremy)\b|设计/i.test(normalized);
}

function shouldUseIsolatedAgentSession(agent: Pick<OpenClawAgentDetail, "agentId" | "name" | "title" | "responsibility">, message: string) {
  const profile = `${agent.agentId} ${agent.name} ${agent.title} ${agent.responsibility}`;
  if (isDesignAgentProfile(profile)) {
    return true;
  }

  const normalizedMessage = String(message || "");
  return normalizedMessage.includes("项目 ")
    && normalizedMessage.includes("阶段 ")
    && normalizedMessage.includes("角色 ");
}

function shouldPreferLocalAgentExecution(input: {
  isDesignAgent: boolean;
  shouldIsolateSession: boolean;
}) {
  return input.isDesignAgent || input.shouldIsolateSession;
}

type OpenClawAttemptFailureFlags = {
  kind: "lock" | "token" | "model_unavailable" | "transport" | "unexpected_model" | "gateway_repairable" | "other";
  isLockError: boolean;
  isTokenError: boolean;
  isModelUnavailableError: boolean;
  isTransportError: boolean;
  isUnexpectedModelError: boolean;
  isGatewayRepairableError: boolean;
};

export function classifyOpenClawAttemptFailure(errorText: string): OpenClawAttemptFailureFlags {
  const normalized = String(errorText || "").trim();
  const isLockError = /session file locked|locked \(timeout|gateway closed/i.test(normalized);
  const isTokenError = /401|invalid token|无效的令牌|令牌无效/i.test(normalized);
  const isModelUnavailableError = /no available channel|model\s+.*not supported|unsupported model|model not found|unknown model/i.test(normalized);
  const isTransportError = /timeout|timed out|gateway|network|econnreset|socket hang up|aborted|relay service error|bad_response_status_code|5\d{2}/i.test(normalized);
  const isUnexpectedModelError = /unexpected execution model/i.test(normalized);
  const isGatewayRepairableError = /gateway closed|gateway connect failed|connect challenge timeout/i.test(normalized);
  const kind = isLockError
    ? "lock"
    : isTokenError
      ? "token"
      : isModelUnavailableError
        ? "model_unavailable"
        : isUnexpectedModelError
          ? "unexpected_model"
          : isGatewayRepairableError
            ? "gateway_repairable"
            : isTransportError
              ? "transport"
              : "other";

  return {
    kind,
    isLockError,
    isTokenError,
    isModelUnavailableError,
    isTransportError,
    isUnexpectedModelError,
    isGatewayRepairableError
  };
}

export function selectOpenClawFallbackModel(input: {
  activeModel: string;
  fallbackQueue: string[];
  fallbackCursor: number;
  errorText: string;
}) {
  const remainingFallbacks = input.fallbackQueue
    .slice(input.fallbackCursor)
    .filter((modelId) => modelId !== input.activeModel);
  let nextFallbackModel = remainingFallbacks[0];

  if (/claude_code|no available channel/i.test(input.errorText) && input.activeModel.startsWith("anthropic/")) {
    nextFallbackModel = remainingFallbacks.find((modelId) => !modelId.startsWith("anthropic/")) ?? nextFallbackModel;
  }

  return nextFallbackModel;
}

function buildAgentMainSessionKey(agentId: string) {
  return `agent:${agentId}:main`;
}

function isProcessAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function extractSessionLockPath(errorText: string) {
  const match = String(errorText || "").match(/(\/[^\s"'`]+\.jsonl\.lock)/);
  return match?.[1] ? String(match[1]).trim() : "";
}

type SessionLockRecord = {
  pid?: number;
  createdAt?: string;
};

async function readSessionLockRecord(lockPath: string) {
  const normalizedPath = String(lockPath || "").trim();
  if (!normalizedPath) {
    return null;
  }

  try {
    const raw = await readFile(normalizedPath, "utf8");
    return JSON.parse(raw) as SessionLockRecord;
  } catch {
    return null;
  }
}

async function cleanupStaleSessionLock(lockPath: string) {
  const normalizedPath = String(lockPath || "").trim();
  if (!normalizedPath) {
    return false;
  }

  try {
    const parsed = await readSessionLockRecord(normalizedPath);
    const pid = Number(parsed?.pid);
    if (Number.isInteger(pid) && pid > 0 && isProcessAlive(pid)) {
      return false;
    }
  } catch {
    // If the lock file cannot be parsed or no longer exists, treat it as removable.
  }

  try {
    await rm(normalizedPath, { force: true });
    return true;
  } catch {
    return false;
  }
}

async function readProcessCommand(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return "";
  }
  try {
    const result = await execFileAsync("ps", ["-p", String(pid), "-o", "command="], {
      maxBuffer: 1024 * 64
    });
    return String(result.stdout || "").trim();
  } catch {
    return "";
  }
}

function isOpenClawOwnedProcess(command: string) {
  const normalized = String(command || "").trim().toLowerCase();
  return /(^|\s|\/)openclaw(-agent|-gateway)?(\s|$)/i.test(normalized);
}

async function terminateProcessGracefully(pid: number, timeoutMs: number) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  if (!isProcessAlive(pid)) {
    return true;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return !isProcessAlive(pid);
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await sleep(150);
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return !isProcessAlive(pid);
  }

  await sleep(200);
  return !isProcessAlive(pid);
}

async function releaseActiveSessionLock(lockPath: string, input: {
  agentId: string;
  minAgeMs: number;
  terminateTimeoutMs: number;
}) {
  const normalizedPath = String(lockPath || "").trim();
  if (!normalizedPath) {
    return false;
  }

  const expectedFragment = `${path.sep}agents${path.sep}${input.agentId}${path.sep}sessions${path.sep}`;
  if (!normalizedPath.includes(expectedFragment)) {
    return false;
  }

  const record = await readSessionLockRecord(normalizedPath);
  const pid = Number(record?.pid);
  if (!Number.isInteger(pid) || pid <= 0 || !isProcessAlive(pid)) {
    return false;
  }

  const createdAtMs = record?.createdAt ? new Date(record.createdAt).getTime() : NaN;
  if (!Number.isFinite(createdAtMs) || Date.now() - createdAtMs < input.minAgeMs) {
    return false;
  }

  const command = await readProcessCommand(pid);
  if (!isOpenClawOwnedProcess(command)) {
    return false;
  }

  const terminated = await terminateProcessGracefully(pid, input.terminateTimeoutMs);
  if (!terminated) {
    return false;
  }

  try {
    await rm(normalizedPath, { force: true });
    return true;
  } catch {
    return false;
  }
}

async function cleanupOpenClawAgentStaleSessionLocks(agentId: string) {
  const sessionDir = path.join(OPENCLAW_ROOT, "agents", agentId, "sessions");
  try {
    const entries = await readdir(sessionDir);
    let removedCount = 0;
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl.lock")) {
        continue;
      }
      const removed = await cleanupStaleSessionLock(path.join(sessionDir, entry));
      if (removed) {
        removedCount += 1;
      }
    }
    return removedCount;
  } catch {
    return 0;
  }
}

async function resetOpenClawAgentMainSession(agentId: string, input?: {
  lockedSessionFile?: string;
}) {
  const sessionStorePath = path.join(OPENCLAW_ROOT, "agents", agentId, "sessions", "sessions.json");
  const sessionStore = await readJsonFile<Record<string, SessionRecord>>(sessionStorePath);
  if (!sessionStore) {
    return false;
  }

  const sessionKey = buildAgentMainSessionKey(agentId);
  const sessionEntry = sessionStore[sessionKey];
  if (!sessionEntry) {
    return false;
  }

  const mainSessionFile = String(sessionEntry.sessionFile || "").trim();
  const lockedSessionFile = String(input?.lockedSessionFile || "").trim();
  if (lockedSessionFile && mainSessionFile && lockedSessionFile !== mainSessionFile) {
    return false;
  }

  const nextStore = { ...sessionStore };
  delete nextStore[sessionKey];

  if (Object.keys(nextStore).length === 0) {
    await rm(sessionStorePath, { force: true });
  } else {
    await writeJsonFile(sessionStorePath, nextStore);
  }

  if (mainSessionFile) {
    await rm(`${mainSessionFile}.lock`, { force: true }).catch(() => {
      // ignore lock cleanup failure during session reset
    });
  }

  return true;
}

function resolveAgentConfiguredPrimaryModel(
  value?: string | { primary?: string; fallbacks?: string[] }
) {
  if (!value) {
    return undefined;
  }

  if (typeof value === "string") {
    return normalizeModelForRouting(value);
  }

  return normalizeModelForRouting(value.primary);
}

function resolveAgentConfiguredFallbackModels(
  value?: string | { primary?: string; fallbacks?: string[] }
) {
  if (!value || typeof value === "string") {
    return [];
  }

  return dedupeStrings(
    (value.fallbacks ?? [])
      .map((item) => normalizeModelForRouting(item))
      .filter((item): item is string => Boolean(item))
  );
}

function buildOpenClawAgentModelConfig(
  primaryModel: string,
  fallbackModels: string[],
  options?: { forceObject?: boolean }
) {
  const primary = normalizeModelForRouting(primaryModel);
  if (!primary) {
    return undefined;
  }

  const fallbacks = dedupeStrings(
    fallbackModels
      .map((item) => normalizeModelForRouting(item))
      .filter((item): item is string => Boolean(item) && item !== primary)
  );

  if (fallbacks.length === 0 && !options?.forceObject) {
    return primary;
  }

  return {
    primary,
    fallbacks
  };
}

export function applyScopedAgentModelConfig(
  config: OpenClawConfig | null | undefined,
  input: {
    agentId: string;
    model: string;
    fallbackModels?: string[];
  }
) {
  if (!config?.agents?.list?.length) {
    throw new Error("OpenClaw config missing agents.list");
  }

  const normalizedModel = normalizeModelForRouting(input.model);
  if (!normalizedModel) {
    throw new Error(`Invalid model override for ${input.agentId}`);
  }

  const nextConfig = JSON.parse(JSON.stringify(config)) as OpenClawConfig;
  const target = nextConfig.agents?.list?.find((item) => item.id === input.agentId);
  if (!target) {
    throw new Error(`Agent ${input.agentId} not found in OpenClaw config`);
  }

  const fallbackModels = dedupeStrings(
    (input.fallbackModels ?? [])
      .map((item) => normalizeModelForRouting(item))
      .filter((item): item is string => Boolean(item) && item !== normalizedModel)
  );
  target.model = buildOpenClawAgentModelConfig(normalizedModel, fallbackModels, { forceObject: true });
  return nextConfig;
}

async function createScopedOpenClawCommandEnv(input: {
  agentId: string;
  model: string;
  fallbackModels?: string[];
}) {
  const config = await readJsonFile<OpenClawConfig>(OPENCLAW_CONFIG_PATH);
  const scopedConfig = applyScopedAgentModelConfig(config, input);
  const tempDir = await mkdtemp(path.join(tmpdir(), "openclaw-agent-config-"));
  const configPath = path.join(tempDir, "openclaw.json");
  await writeJsonFile(configPath, scopedConfig);

  return {
    env: {
      ...process.env,
      OPENCLAW_CONFIG_PATH: configPath
    },
    async cleanup() {
      await rm(tempDir, { recursive: true, force: true });
    }
  };
}

function splitSessionRuntimeModel(model: string) {
  const normalized = normalizeModelForRouting(model);
  if (!normalized) {
    return {
      model: undefined,
      provider: undefined
    };
  }

  const slashIndex = normalized.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= normalized.length - 1) {
    return {
      model: normalized,
      provider: undefined
    };
  }

  return {
    provider: normalized.slice(0, slashIndex),
    model: normalized.slice(slashIndex + 1)
  };
}

export function applyOpenClawAgentMainSessionModelSync(
  sessionStore: Record<string, SessionRecord> | null | undefined,
  input: { agentId: string; model: string }
) {
  const existingStore = sessionStore ?? {};
  const sessionKey = buildAgentMainSessionKey(input.agentId);
  const sessionEntry = existingStore[sessionKey];
  const runtimeModel = splitSessionRuntimeModel(input.model);

  if (!sessionEntry || !runtimeModel.model) {
    return {
      changed: false,
      sessionStore: existingStore
    };
  }

  let nextEntry = sessionEntry;

  if (sessionEntry.model !== runtimeModel.model) {
    nextEntry = {
      ...nextEntry,
      model: runtimeModel.model
    };
  }

  if (nextEntry.modelOverride !== runtimeModel.model) {
    nextEntry = {
      ...nextEntry,
      modelOverride: runtimeModel.model
    };
  }

  if (runtimeModel.provider) {
    if (nextEntry.modelProvider !== runtimeModel.provider) {
      nextEntry = {
        ...nextEntry,
        modelProvider: runtimeModel.provider
      };
    }
    if (nextEntry.providerOverride !== runtimeModel.provider) {
      nextEntry = {
        ...nextEntry,
        providerOverride: runtimeModel.provider
      };
    }
  } else if (nextEntry.modelProvider !== undefined) {
    nextEntry = { ...nextEntry };
    delete nextEntry.modelProvider;
    if (nextEntry.providerOverride !== undefined) {
      delete nextEntry.providerOverride;
    }
  }

  if (
    nextEntry.fallbackNoticeSelectedModel !== undefined
    || nextEntry.fallbackNoticeActiveModel !== undefined
    || nextEntry.fallbackNoticeReason !== undefined
  ) {
    if (nextEntry === sessionEntry) {
      nextEntry = { ...nextEntry };
    }
    delete nextEntry.fallbackNoticeSelectedModel;
    delete nextEntry.fallbackNoticeActiveModel;
    delete nextEntry.fallbackNoticeReason;
  }

  if (nextEntry === sessionEntry) {
    return {
      changed: false,
      sessionStore: existingStore
    };
  }

  nextEntry.updatedAt = Date.now();
  return {
    changed: true,
    sessionStore: {
      ...existingStore,
      [sessionKey]: nextEntry
    }
  };
}

export async function inspectOpenClawModelRouting(input?: {
  repair?: boolean;
}) {
  const repair = Boolean(input?.repair);
  const checkedAt = new Date().toISOString();
  const fallbackModel = listGlobalFallbackModels()[0] || "minima/MiniMax-M2.7-highspeed";
  const items: Array<{
    source: "openclaw_config" | "managed_agent_config";
    agentId: string;
    field: "model" | "selectedModel" | "defaultModel" | "fallbackModel";
    from: string | null;
    to: string;
    reason: string;
    repaired: boolean;
  }> = [];

  let scannedOpenClawAgents = 0;
  let scannedManagedConfigs = 0;
  let fixed = 0;
  let pending = 0;

  const config = await readJsonFile<OpenClawConfig>(OPENCLAW_CONFIG_PATH);
  const agentConfigs = config?.agents?.list ?? [];
  let configChanged = false;

  for (const item of agentConfigs) {
    scannedOpenClawAgents += 1;
    const before = resolveAgentConfiguredPrimaryModel(item.model) ?? null;
    const next = pickPreferredModel([before ?? undefined], fallbackModel);
    if (before === next) {
      continue;
    }

    const reason = !before
      ? "empty model id"
      : isRoutingPlaceholderModel(before)
        ? "placeholder/alias model id"
        : "normalized fallback";
    const repaired = repair;
    items.push({
      source: "openclaw_config",
      agentId: item.id,
      field: "model",
      from: before,
      to: next,
      reason,
      repaired
    });

    if (repair) {
      item.model = buildOpenClawAgentModelConfig(next, resolveAgentConfiguredFallbackModels(item.model));
      configChanged = true;
      fixed += 1;
    } else {
      pending += 1;
    }
  }

  if (repair && configChanged && config?.agents?.list) {
    await writeJsonFile(OPENCLAW_CONFIG_PATH, config);
  }

  const managedConfigs = await prisma.managedAgentConfig.findMany({
    select: {
      agentId: true,
      selectedModel: true,
      defaultModel: true,
      fallbackModel: true
    }
  });
  scannedManagedConfigs = managedConfigs.length;

  for (const row of managedConfigs) {
    const nextSelectedModel = pickPreferredModel(
      [row.selectedModel, row.defaultModel, row.fallbackModel ?? undefined],
      fallbackModel
    );
    const nextDefaultModel = pickPreferredModel(
      [row.defaultModel, nextSelectedModel, row.fallbackModel ?? undefined],
      nextSelectedModel
    );
    const nextFallbackModel = pickPreferredModel(
      [row.fallbackModel ?? undefined, nextDefaultModel],
      nextDefaultModel
    );

    const updateData: {
      selectedModel?: string;
      defaultModel?: string;
      fallbackModel?: string;
    } = {};

    const track = (
      field: "selectedModel" | "defaultModel" | "fallbackModel",
      from: string | null,
      to: string
    ) => {
      if (from === to) {
        return;
      }

      const reason = !from
        ? "empty model id"
        : isRoutingPlaceholderModel(from)
          ? "placeholder/alias model id"
          : "normalized fallback";
      const repaired = repair;
      items.push({
        source: "managed_agent_config",
        agentId: row.agentId,
        field,
        from,
        to,
        reason,
        repaired
      });
      if (repair) {
        fixed += 1;
      } else {
        pending += 1;
      }
    };

    if ((row.selectedModel ?? null) !== nextSelectedModel) {
      track("selectedModel", row.selectedModel ?? null, nextSelectedModel);
      updateData.selectedModel = nextSelectedModel;
    }
    if ((row.defaultModel ?? null) !== nextDefaultModel) {
      track("defaultModel", row.defaultModel ?? null, nextDefaultModel);
      updateData.defaultModel = nextDefaultModel;
    }
    const hasInvalidFallbackModel = Boolean(row.fallbackModel) && isRoutingPlaceholderModel(row.fallbackModel ?? undefined);
    if ((row.fallbackModel ?? null) !== nextFallbackModel && hasInvalidFallbackModel) {
      track("fallbackModel", row.fallbackModel ?? null, nextFallbackModel);
      updateData.fallbackModel = nextFallbackModel;
    }

    if (repair && Object.keys(updateData).length > 0) {
      await prisma.managedAgentConfig.update({
        where: { agentId: row.agentId },
        data: updateData
      });
    }
  }

  return {
    checkedAt,
    repair,
    fallbackModel,
    scanned: {
      openclawAgents: scannedOpenClawAgents,
      managedAgentConfigs: scannedManagedConfigs
    },
    issues: items.length,
    fixed,
    pending,
    items
  };
}

export async function updateOpenClawAgentSettings(
  agentId: string,
  input: OpenClawAgentSettingsInput
): Promise<OpenClawAgentDetail | undefined> {
  const config = await readJsonFile<OpenClawConfig>(OPENCLAW_CONFIG_PATH);
  const agentConfigs = config?.agents?.list ?? [];
  const agentConfig = agentConfigs.find((item) => item.id === agentId);

  if (!agentConfig) {
    return undefined;
  }

  const currentModel = resolveAgentConfiguredPrimaryModel(agentConfig.model) || "unknown";
  const existingRecord = await prisma.managedAgentConfig.findUnique({ where: { agentId } });
  const existingSettings = normalizeCommanderSettings(currentModel, existingRecord ?? undefined);
  const globalFallbacks = listGlobalFallbackModels();
  const nextSelectedModel = pickPreferredModel([
    input.selectedModel,
    existingSettings.selectedModel,
    existingSettings.defaultModel,
    existingSettings.fallbackModel ?? undefined,
    ...globalFallbacks
  ]);
  const nextDisplayName = String(input.displayName ?? existingRecord?.displayName ?? agentConfig.name ?? "").trim() || undefined;
  const nextTitle = String(input.title ?? existingRecord?.title ?? "").trim() || undefined;
  const nextIntro = String(input.intro ?? existingRecord?.intro ?? "").trim() || undefined;
  const nextResponsibility = String(input.responsibility ?? existingRecord?.responsibility ?? "").trim() || undefined;
  const nextAllowedAgentIds = normalizeStringArray(
    input.allowedAgentIds
      ?? jsonArrayToStringArray(existingRecord?.allowedAgentIds)
      ?? agentConfig.subagents?.allowAgents
  );
  const nextTools = normalizeStringArray(
    input.tools
      ?? jsonArrayToStringArray(existingRecord?.toolAllowlist)
      ?? agentConfig.tools?.allow
  );

  const nextDefaultModel = pickPreferredModel([
    input.defaultModel,
    existingSettings.defaultModel,
    nextSelectedModel,
    existingSettings.fallbackModel ?? undefined,
    ...globalFallbacks
  ], nextSelectedModel);
  const nextFallbackModel = pickPreferredModel([
    input.fallbackModel,
    existingSettings.fallbackModel ?? undefined,
    ...globalFallbacks
  ], nextDefaultModel);
  const agentFallbackStack = dedupeStrings([
    nextFallbackModel,
    ...globalFallbacks
  ].filter((item): item is string => Boolean(item) && item !== nextSelectedModel));

  agentConfig.model = buildOpenClawAgentModelConfig(nextSelectedModel, agentFallbackStack);
  if (nextDisplayName) {
    agentConfig.name = nextDisplayName;
  }
  agentConfig.subagents = {
    allowAgents: nextAllowedAgentIds
  };
  agentConfig.tools = {
    allow: nextTools
  };
  await writeJsonFile(OPENCLAW_CONFIG_PATH, config);

  const nextSettings: OpenClawAgentCommanderSettings = {
    selectedModel: nextSelectedModel,
    defaultModel: nextDefaultModel,
    fallbackModel: nextFallbackModel === nextSelectedModel ? undefined : nextFallbackModel,
    executionMode: input.executionMode ?? existingSettings.executionMode,
    requireConfirmation: input.requireConfirmation ?? existingSettings.requireConfirmation,
    autoApproveMinorSteps: input.autoApproveMinorSteps ?? existingSettings.autoApproveMinorSteps,
    maxPromptTokens: normalizeNumericLimit(input.maxPromptTokens, existingSettings.maxPromptTokens),
    maxCompletionTokens: normalizeNumericLimit(input.maxCompletionTokens, existingSettings.maxCompletionTokens),
    maxDailyTokens: normalizeNumericLimit(input.maxDailyTokens, existingSettings.maxDailyTokens),
    memoryEnabled: input.memoryEnabled ?? existingSettings.memoryEnabled,
    updatedAt: new Date().toISOString()
  };

  if (nextSettings.executionMode === "autonomous" && input.requireConfirmation === undefined) {
    nextSettings.requireConfirmation = false;
  }

  await prisma.managedAgentConfig.upsert({
    where: { agentId },
    create: {
      agentId,
      displayName: nextDisplayName,
      title: nextTitle,
      intro: nextIntro,
      responsibility: nextResponsibility,
      selectedModel: nextSettings.selectedModel,
      defaultModel: nextSettings.defaultModel,
      fallbackModel: nextSettings.fallbackModel,
      executionMode: nextSettings.executionMode,
      requireConfirmation: nextSettings.requireConfirmation,
      autoApproveMinorSteps: nextSettings.autoApproveMinorSteps,
      maxPromptTokens: nextSettings.maxPromptTokens,
      maxCompletionTokens: nextSettings.maxCompletionTokens,
      maxDailyTokens: nextSettings.maxDailyTokens,
      memoryEnabled: nextSettings.memoryEnabled,
      allowedAgentIds: nextAllowedAgentIds,
      toolAllowlist: nextTools
    },
    update: {
      displayName: nextDisplayName,
      title: nextTitle,
      intro: nextIntro,
      responsibility: nextResponsibility,
      selectedModel: nextSettings.selectedModel,
      defaultModel: nextSettings.defaultModel,
      fallbackModel: nextSettings.fallbackModel,
      executionMode: nextSettings.executionMode,
      requireConfirmation: nextSettings.requireConfirmation,
      autoApproveMinorSteps: nextSettings.autoApproveMinorSteps,
      maxPromptTokens: nextSettings.maxPromptTokens,
      maxCompletionTokens: nextSettings.maxCompletionTokens,
      maxDailyTokens: nextSettings.maxDailyTokens,
      memoryEnabled: nextSettings.memoryEnabled,
      allowedAgentIds: nextAllowedAgentIds,
      toolAllowlist: nextTools
    }
  });

  await syncAgentIdentityFile(
    resolveWorkspaceForAgent(agentId) || agentConfig.workspace || path.join(OPENCLAW_WORKSPACE_ROOT, "agents", agentId),
    {
      name: nextDisplayName || agentConfig.name || humanizeAgentId(agentId),
      title: nextTitle,
      intro: nextIntro
    }
  );

  await syncOpenClawAgentMainSessionRuntimeModel(agentId, nextSelectedModel);

  return findOpenClawAgent(agentId);
}

export async function createOpenClawAgent(
  input: OpenClawCreateAgentInput
): Promise<OpenClawAgentDetail | undefined> {
  const agentId = sanitizeAgentId(input.agentId);
  const name = String(input.name ?? "").trim();
  const title = String(input.title ?? "").trim();
  const intro = String(input.intro ?? "").trim() || undefined;
  const responsibility = String(input.responsibility ?? "").trim() || undefined;
  const allowedAgentIds = normalizeStringArray(input.allowedAgentIds);
  const tools = normalizeStringArray(input.tools);
  const model = normalizeModelId(input.model) || "gpt-5.2";

  if (!agentId || !name || !title) {
    throw new Error("agentId, name, and title are required");
  }

  const config = (await readJsonFile<OpenClawConfig>(OPENCLAW_CONFIG_PATH)) ?? { agents: { list: [] } };
  config.agents ||= { list: [] };
  config.agents.list ||= [];

  if (config.agents.list.some((item) => item.id === agentId)) {
    throw new Error(`Agent ${agentId} already exists`);
  }

  const workspacePath = path.join(OPENCLAW_WORKSPACE_ROOT, "agents", agentId);
  await mkdir(workspacePath, { recursive: true });

  config.agents.list.push({
    id: agentId,
    name,
    workspace: workspacePath,
    model,
    subagents: {
      allowAgents: allowedAgentIds
    },
    tools: {
      allow: tools
    }
  });
  await writeJsonFile(OPENCLAW_CONFIG_PATH, config);

  const identity = [
    `# ${name}`,
    "",
    `- title: ${title}`,
    ...(intro ? [`- intro: ${intro}`] : []),
    `- vibe: Professional, calm, and execution-oriented`,
    `- agent_id: ${agentId}`
  ].join("\n");
  const soul = input.soul?.trim() || `# ${name} SOUL\n\n你是 ${title}，职责是：${responsibility || "稳定推进分配给你的工作，并清晰同步结果。"}\n`;
  const sop = input.sop?.trim() || `# ${name} SOP\n\n1. 先理解需求\n2. 给出执行计划\n3. 在关键风险节点请求确认\n4. 完成后同步结果\n`;

  await writeFile(path.join(workspacePath, "IDENTITY.md"), `${identity}\n`, "utf8");
  await writeFile(path.join(workspacePath, "SOUL.md"), soul.endsWith("\n") ? soul : `${soul}\n`, "utf8");
  await writeFile(path.join(workspacePath, "sop-document.md"), sop.endsWith("\n") ? sop : `${sop}\n`, "utf8");

  await prisma.managedAgentConfig.upsert({
    where: { agentId },
    create: {
      agentId,
      displayName: name,
      title,
      intro,
      responsibility,
      selectedModel: model,
      defaultModel: model,
      executionMode: "confirm_first",
      requireConfirmation: true,
      autoApproveMinorSteps: false,
      maxPromptTokens: DEFAULT_OPENCLAW_AGENT_TOKEN_LIMIT,
      maxCompletionTokens: null,
      maxDailyTokens: DEFAULT_OPENCLAW_AGENT_TOKEN_LIMIT,
      memoryEnabled: true,
      allowedAgentIds,
      toolAllowlist: tools
    },
    update: {
      displayName: name,
      title,
      intro,
      responsibility,
      selectedModel: model,
      defaultModel: model,
      allowedAgentIds,
      toolAllowlist: tools
    }
  });

  return findOpenClawAgent(agentId);
}

export async function deleteOpenClawAgent(
  agentIdRaw: string
): Promise<{ status: "deleted" | "not_found" | "protected"; removedWorkspace: boolean }> {
  const agentId = String(agentIdRaw ?? "").trim();
  if (!agentId) {
    return { status: "not_found", removedWorkspace: false };
  }

  if (NON_DELETABLE_AGENT_IDS.has(agentId)) {
    return { status: "protected", removedWorkspace: false };
  }

  const config = (await readJsonFile<OpenClawConfig>(OPENCLAW_CONFIG_PATH)) ?? { agents: { list: [] } };
  config.agents ||= { list: [] };
  config.agents.list ||= [];

  const existing = config.agents.list.find((item) => item.id === agentId);
  if (!existing) {
    return { status: "not_found", removedWorkspace: false };
  }

  const workspacePath = existing.workspace || resolveWorkspaceForAgent(agentId);
  config.agents.list = config.agents.list.filter((item) => item.id !== agentId);
  await writeJsonFile(OPENCLAW_CONFIG_PATH, config);

  await prisma.$transaction([
    prisma.agentSoul.deleteMany({ where: { agentId } }),
    prisma.agentSop.deleteMany({ where: { agentId } }),
    prisma.agentMemoryEntry.deleteMany({ where: { agentId } }),
    prisma.agentUsageLog.deleteMany({ where: { agentId } }),
    prisma.managedAgentConfig.deleteMany({ where: { agentId } }),
    prisma.agentProfile.deleteMany({ where: { roleId: agentId } }),
    prisma.task.deleteMany({ where: { assignee: agentId } })
  ]);

  let removedWorkspace = false;
  if (isRemovableAgentWorkspacePath(workspacePath, agentId)) {
    try {
      await rm(workspacePath, { recursive: true, force: true });
      removedWorkspace = true;
    } catch {
      removedWorkspace = false;
    }
  }

  statusCache = null;
  return { status: "deleted", removedWorkspace };
}

export async function addOpenClawAgentMemory(
  agentId: string,
  input: OpenClawMemoryEntryInput
): Promise<OpenClawAgentDetail | undefined> {
  const agent = await findOpenClawAgent(agentId);
  if (!agent) {
    return undefined;
  }

  const summary = String(input.summary ?? "").trim();
  const content = String(input.content ?? "").trim();
  if (!summary || !content) {
    throw new Error("summary and content are required");
  }

  await ensureManagedAgentConfigExists(agentId, agent.name, agent.title, agent.commander.selectedModel);
  await prisma.agentMemoryEntry.create({
    data: {
      agentId,
      projectId: input.projectId,
      type: input.type,
      summary,
      content,
      importance: clampImportance(input.importance),
      tags: input.tags ?? [],
      source: input.source
    }
  });

  return findOpenClawAgent(agentId);
}

export async function previewOpenClawAgentInstruction(
  agentId: string,
  input: OpenClawInstructionPreviewInput
): Promise<OpenClawInstructionPreview | undefined> {
  const message = String(input.message ?? "").trim();
  if (!message) {
    throw new Error("message is required");
  }

  const agent = await findOpenClawAgent(agentId);
  if (!agent) {
    return undefined;
  }

  const instructionType = classifyInstruction(message);
  const projectHint = agent.currentTask ? `${agent.currentTask.projectName} / ${agent.currentTask.title}` : "";
  const needsConfirmation = input.preferAutonomous
    ? false
    : agent.commander.executionMode === "confirm_first" || agent.commander.requireConfirmation;
  const risks = buildInstructionRisks(message, projectHint, instructionType, agent.commander.executionMode);

  return {
    agentId,
    message,
    goal: message,
    plan: buildInstructionPlan(agent.name, instructionType, projectHint),
    steps: buildInstructionSteps(agent.name, instructionType, projectHint),
    risks,
    suggestion: needsConfirmation
      ? "建议先确认目标、交付边界与优先级，再开始执行。"
      : "当前已处于自主执行模式，建议直接开始推进，并在关键风险节点再请求确认。",
    needsConfirmation,
    recommendedAction: needsConfirmation ? "confirm_execute" : "execute_now",
    options: [
      { id: "confirm_execute", label: "确认并执行", tone: "primary", recommended: needsConfirmation },
      { id: "revise_instruction", label: "修改后再理解", tone: "secondary" },
      { id: "analysis_only", label: "仅分析不执行", tone: "secondary" },
      { id: "switch_model", label: "更换模型后重试", tone: "warning" }
    ]
  };
}

export async function updateOpenClawAgentDocument(
  agentId: string,
  type: OpenClawEditableDocumentType,
  input: OpenClawDocumentUpdateInput
): Promise<OpenClawAgentDetail | undefined> {
  const nextContent = String(input.content ?? "").trim();

  if (!nextContent) {
    throw new Error("content is required");
  }

  const agent = await findOpenClawAgent(agentId);
  if (!agent) {
    return undefined;
  }

  const target = type === "soul" ? agent.soul : agent.sop;
  if (!target.exists && !input.createIfMissing) {
    throw new Error(`${type.toUpperCase()} document does not exist`);
  }

  await mkdir(path.dirname(target.path), { recursive: true });

  const normalizedContent = input.content.endsWith("\n") ? input.content : `${input.content}\n`;
  if (target.exists && target.content !== normalizedContent) {
    const backupPath = `${target.path}.bak.${Date.now()}`;
    await copyFile(target.path, backupPath);
  }

  await writeFile(target.path, normalizedContent, "utf8");
  return findOpenClawAgent(agentId);
}

export async function updateOpenClawProjectTask(
  projectId: string,
  taskId: string,
  input: OpenClawTaskUpdateInput
): Promise<OpenClawProjectDetail | undefined> {
  const projectDir = resolveProjectDir(projectId);
  const tasksPath = path.join(projectDir, "tasks.json");
  const payload = await readJsonFile<RawProjectTasksPayload>(tasksPath);

  if (!payload?.tasks) {
    return undefined;
  }

  const sourceTaskId = decodeTaskId(taskId);
  const target = payload.tasks.find((task, index) => String(task.id ?? index + 1) === sourceTaskId);
  if (!target) {
    return undefined;
  }

  applyTaskPatch(target, input);
  await persistProjectTasksPayload(tasksPath, payload);

  return findOpenClawProject(projectId);
}

export async function updateOpenClawProjectTasks(
  projectId: string,
  input: OpenClawBatchTaskUpdateInput
): Promise<OpenClawProjectDetail | undefined> {
  const projectDir = resolveProjectDir(projectId);
  const tasksPath = path.join(projectDir, "tasks.json");
  const payload = await readJsonFile<RawProjectTasksPayload>(tasksPath);

  if (!payload?.tasks) {
    return undefined;
  }

  const updates = Array.isArray(input.updates) ? input.updates : [];
  if (updates.length === 0) {
    throw new Error("updates is required");
  }

  let appliedCount = 0;
  for (const update of updates) {
    const sourceTaskId = decodeTaskId(String(update.taskId ?? ""));
    const target = payload.tasks.find((task, index) => String(task.id ?? index + 1) === sourceTaskId);
    if (!target) {
      continue;
    }

    applyTaskPatch(target, update.patch);
    appliedCount += 1;
  }

  if (appliedCount === 0) {
    return undefined;
  }

  await persistProjectTasksPayload(tasksPath, payload);

  return findOpenClawProject(projectId);
}

export async function listOpenClawAgentSla(): Promise<OpenClawAgentSlaItem[]> {
  const { agents } = await buildWorkspaceSnapshot();

  return agents
    .map((agent) => {
      const minutesSinceActive = getMinutesSinceActive(agent.lastActiveAt);

      return {
        agentId: agent.agentId,
        name: agent.name,
        status: agent.status,
        lastActiveAt: agent.lastActiveAt,
        minutesSinceActive,
        activeSessionCount: agent.activeSessionCount,
        taskCount: agent.taskCount,
        currentTaskTitle: agent.currentTask?.title,
        slaState: deriveSlaState(agent.taskCount, minutesSinceActive)
      };
    })
    .sort(compareSlaItems);
}

export async function buildOpenClawProjectReport(projectId: string): Promise<OpenClawProjectReport | undefined> {
  const { agents, projects } = await buildWorkspaceSnapshot();
  const project = projects.find((item) => item.detail.id === projectId)?.detail;
  if (!project) {
    return undefined;
  }

  const relatedAgents = agents
    .filter((agent) => project.agentIds.includes(agent.agentId))
    .map((agent) => ({
      agentId: agent.agentId,
      name: agent.name,
      status: agent.status,
      lastActiveAt: agent.lastActiveAt,
      currentTaskTitle: agent.currentTask?.title
    }));
  const doneCount = project.tasks.filter((task) => task.status === "done").length;
  const blockedTasks = project.tasks.filter((task) => task.status === "blocked");
  const todoTasks = project.tasks.filter((task) => task.status === "todo");
  const inProgressTasks = project.tasks.filter((task) => task.status === "in_progress");
  const staleAgents = relatedAgents.filter((agent) => {
    const minutesSinceActive = getMinutesSinceActive(agent.lastActiveAt);
    return deriveSlaState(project.tasks.filter((task) => task.agentId === agent.agentId).length, minutesSinceActive) === "stale";
  });
  const summary =
    `${project.name} 当前处于${projectStatusText(project.status)}，整体进度 ${project.progress}%，` +
    `共 ${project.taskCount} 项任务，已完成 ${doneCount} 项，阻塞 ${project.blockedTaskCount} 项。`;
  const highlights = uniqueItems([
    project.currentFocus ? `当前焦点：${project.currentFocus}` : "",
    inProgressTasks[0] ? `推进中任务：${inProgressTasks[0].agentName} 正在处理《${inProgressTasks[0].title}》` : "",
    relatedAgents.length > 0 ? `已联动 ${relatedAgents.length} 个 Agent 参与该项目` : "",
    project.docs.length > 0 ? `项目工作区已沉淀 ${project.docs.length} 份文档` : ""
  ]).slice(0, 4);
  const blockers = uniqueItems([
    ...project.blockers,
    ...blockedTasks.map((task) => `${task.agentName}：${task.title}`)
  ]).slice(0, 8);
  const nextActions = uniqueItems([
    blockedTasks[0] ? `优先清理阻塞任务：${blockedTasks[0].agentName} / ${blockedTasks[0].title}` : "",
    todoTasks[0] ? `尽快启动待办任务：${todoTasks[0].agentName} / ${todoTasks[0].title}` : "",
    staleAgents[0] ? `催办长时间未活跃成员：${staleAgents[0].name}` : "",
    project.requirementsExcerpt ? "对照 requirements.md 复核当前交付是否覆盖核心需求" : ""
  ]).slice(0, 4);
  const markdown = [
    `# ${project.name} 项目态势报告`,
    "",
    `生成时间：${new Date().toLocaleString("zh-CN")}`,
    "",
    "## 摘要",
    summary,
    "",
    "## 亮点",
    ...(highlights.length > 0 ? highlights.map((item) => `- ${item}`) : ["- 暂无明显亮点，建议继续推进。"]),
    "",
    "## 阻塞项",
    ...(blockers.length > 0 ? blockers.map((item) => `- ${item}`) : ["- 当前未识别到阻塞项。"]),
    "",
    "## 下一步动作",
    ...(nextActions.length > 0 ? nextActions.map((item) => `- ${item}`) : ["- 持续跟进在途任务并同步状态。"]),
    "",
    "## Agent 摘要",
    ...(relatedAgents.length > 0
      ? relatedAgents.map((agent) =>
          `- ${agent.name}（${agent.agentId}）/${agentStatusText(agent.status)}`
          + `${agent.currentTaskTitle ? `，当前任务：${agent.currentTaskTitle}` : ""}`
          + `${agent.lastActiveAt ? `，最近活跃：${agent.lastActiveAt}` : ""}`
        )
      : ["- 当前项目尚未绑定 Agent。"])
  ].join("\n");

  return {
    projectId: project.id,
    projectName: project.name,
    generatedAt: new Date().toISOString(),
    summary,
    highlights,
    blockers,
    nextActions,
    agentSummaries: relatedAgents,
    markdown
  };
}

export async function getOpenClawStatusSummary(forceRefresh = false): Promise<OpenClawStatusSummary> {
  if (!forceRefresh && statusCache && statusCache.expiresAt > Date.now()) {
    return statusCache.value;
  }

  let stdout = "";
  let stderr = "";

  try {
    const result = await execFileAsync(OPENCLAW_BIN, ["status", "--all", "--json"], {
      timeout: 60 * 1000,
      maxBuffer: 1024 * 1024 * 8
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const detail =
      error instanceof Error && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr.trim()
        : error instanceof Error
          ? error.message
          : "OpenClaw status command failed";
    throw new Error(detail || "OpenClaw status command failed");
  }

  const payload = parseOpenClawStatusJson(stdout || stderr);
  const findings = (payload.diagnostics?.findings ?? payload.securityAudit?.findings ?? [])
    .map((finding, index) => toStatusFinding(finding, index))
    .slice(0, 20);
  const configuredChannels = dedupeStrings(
    (payload.channelSummary ?? [])
      .filter((line) => !line.startsWith("  -"))
      .map((line) => line.replace(/: configured$/, "").trim())
      .filter(Boolean)
  );
  const heartbeatAgents = (payload.heartbeat?.agents ?? [])
    .filter((agent) => agent.enabled)
    .map((agent) => agent.agentId);

  const value: OpenClawStatusSummary = {
    syncedAt: new Date().toISOString(),
    runtimeVersion: String(payload.runtimeVersion ?? "unknown"),
    defaultAgentId: payload.heartbeat?.defaultAgentId,
    sessionCount: Number(payload.sessions?.count ?? 0),
    queuedSystemEventCount: Array.isArray(payload.queuedSystemEvents) ? payload.queuedSystemEvents.length : 0,
    secretDiagnosticCount: Array.isArray(payload.secretDiagnostics) ? payload.secretDiagnostics.length : 0,
    configuredChannels,
    heartbeatAgents,
    findings
  };

  statusCache = {
    value,
    expiresAt: Date.now() + 30_000
  };
  return value;
}

export async function sendOpenClawAgentMessage(
  agentId: string,
  input: OpenClawAgentMessageInput
): Promise<OpenClawAgentCommandResult> {
  await repairOpenClawProviderApis();

  const message = String(input.message ?? "").trim();
  if (!message) {
    throw new Error("message is required");
  }

  // 安全验证：命令注入防护
  validateCommandInput(message, { allowMultiline: true });
  validateCommandInput(agentId);

  const agent = await findOpenClawAgent(agentId);
  if (!agent) {
    throw new Error(`OpenClaw agent ${agentId} not found`);
  }

  await ensureManagedAgentConfigExists(agentId, agent.name, agent.title, agent.commander.selectedModel);
  const estimatedPromptTokens = estimateTokenCount(message);
  enforceTokenBudgets(agent.commander, agent.usage, estimatedPromptTokens);

  let stdout = "";
  let stderr = "";
  const isDesignAgent = isDesignAgentProfile(
    `${agent.agentId} ${agent.name} ${agent.title} ${agent.responsibility}`
  );
  const preferredModelOverride = normalizeModelForRouting(input.preferredModel);
  const explicitFallbackModels = dedupeStrings(
    (input.fallbackModels ?? [])
      .map((item) => normalizeModelForRouting(item))
      .filter((item): item is string => Boolean(item))
  );
  const externalFallbackControl = explicitFallbackModels.length > 0;
  const designPrimaryModel = normalizeModelForRouting(process.env.DESIGN_MODEL) || DESIGN_MODEL_PRIMARY;
  const globalFallbackCandidates = listGlobalFallbackModels();
  const defaultFallbackCandidates = dedupeStrings([
    ...explicitFallbackModels,
    normalizeModelForRouting(agent.commander.defaultModel),
    normalizeModelForRouting(agent.commander.fallbackModel),
    ...globalFallbackCandidates
  ].filter((item): item is string => Boolean(item)));
  const designFallbackCandidates = dedupeStrings([
    normalizeModelForRouting(process.env.DESIGN_FALLBACK_MODEL),
    ...DESIGN_MODEL_FALLBACKS.map((item) => normalizeModelForRouting(item)),
    ...defaultFallbackCandidates
  ].filter((item): item is string => Boolean(item)));
  const fallbackCandidates = (isDesignAgent ? designFallbackCandidates : defaultFallbackCandidates);
  let activeModel = pickPreferredModel([
    preferredModelOverride,
    agent.commander.selectedModel,
    agent.commander.defaultModel,
    agent.commander.fallbackModel ?? undefined,
    ...(isDesignAgent ? [designPrimaryModel] : []),
    ...fallbackCandidates
  ]);
  const requestedModel = activeModel;
  const fallbackQueue = fallbackCandidates.filter((modelId) => modelId !== activeModel);
  let fallbackCursor = 0;
  const shouldIsolateSession = shouldUseIsolatedAgentSession(agent, message);
  const preferLocalExecution = shouldPreferLocalAgentExecution({
    isDesignAgent,
    shouldIsolateSession
  });
  const isCodingExecution = /\bcoding-agent\b/i.test(message) || agentId === "rd_manager" || agentId === "rd_director";
  let gatewayRepairAttempted = false;
  const maxAttempts = Math.max(1, Number(process.env.OPENCLAW_AGENT_MAX_ATTEMPTS ?? 4));
  const cliTimeoutSeconds = Math.max(
    preferLocalExecution
      ? (isCodingExecution ? 180 : 90)
      : (isCodingExecution ? 120 : 30),
    Number(process.env.OPENCLAW_AGENT_CLI_TIMEOUT_SECONDS ?? 75)
  );
  const commandTimeoutMs = Math.max(
    (cliTimeoutSeconds + 20) * 1000,
    Number(process.env.OPENCLAW_AGENT_COMMAND_TIMEOUT_MS ?? 90_000)
  );
  const liveLockStealAfterMs = Math.max(
    12_000,
    Number(process.env.OPENCLAW_LIVE_LOCK_STEAL_AFTER_MS ?? 15_000)
  );
  const liveLockTerminateTimeoutMs = Math.max(
    600,
    Number(process.env.OPENCLAW_LIVE_LOCK_TERMINATE_TIMEOUT_MS ?? 2_000)
  );
  let finalError: string | null = null;
  const attempts: OpenClawAgentAttemptTrace[] = [];

  const selectedModelRaw = normalizeModelId(agent.commander.selectedModel) || "";
  if (!externalFallbackControl && (selectedModelRaw !== activeModel || externalFallbackControl)) {
    try {
      await switchAgentModelForRetry(agentId, activeModel, {
        explicitFallbacks: externalFallbackControl ? [] : undefined
      });
    } catch (switchError) {
      const reason = switchError instanceof Error ? switchError.message : "initial model sanitize failed";
      finalError = `[model-sanitize] ${reason}`;
      attempts.push({
        attempt: 0,
        route: "openclaw-cli:preflight",
        status: "failed",
        startedAt: new Date().toISOString(),
        elapsedMs: 0,
        requestedModel,
        selectedModel: activeModel,
        isolatedSession: shouldIsolateSession,
        localExecution: preferLocalExecution,
        failureKind: "preflight",
        recoveryAction: "abort",
        error: finalError
      });
    }
  }

  if (isDesignAgent && designPrimaryModel && !isDesignModelPreferred(activeModel)) {
    try {
      await switchAgentModelForRetry(agentId, designPrimaryModel);
      activeModel = designPrimaryModel;
    } catch (switchError) {
      const reason = switchError instanceof Error ? switchError.message : "primary model switch failed";
      finalError = `[model-primary] ${reason}`;
      attempts.push({
        attempt: 0,
        route: "openclaw-cli:preflight",
        status: "failed",
        startedAt: new Date().toISOString(),
        elapsedMs: 0,
        requestedModel,
        selectedModel: designPrimaryModel,
        isolatedSession: shouldIsolateSession,
        localExecution: preferLocalExecution,
        failureKind: "preflight",
        recoveryAction: "abort",
        error: finalError
      });
    }
  }

  await syncOpenClawAgentMainSessionRuntimeModel(agentId, activeModel);
  await cleanupOpenClawAgentStaleSessionLocks(agentId);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      await cleanupOpenClawAgentStaleSessionLocks(agentId);
    }
    const attemptStartedAtMs = Date.now();
    const attemptStartedAt = new Date(attemptStartedAtMs).toISOString();
    const sessionId = shouldIsolateSession
      ? `${agentId}-stage-${Date.now()}-${randomUUID().slice(0, 8)}`
      : undefined;
    let scopedCommandEnv: Awaited<ReturnType<typeof createScopedOpenClawCommandEnv>> | null = null;
    try {
      if (externalFallbackControl) {
        scopedCommandEnv = await createScopedOpenClawCommandEnv({
          agentId,
          model: activeModel,
          fallbackModels: []
        });
      }
      const result = await execFileAsync(OPENCLAW_BIN, [
        "agent",
        "--agent",
        agentId,
        ...(preferLocalExecution ? ["--local"] : []),
        ...(sessionId ? ["--session-id", sessionId] : []),
        "--message",
        message,
        "--json",
        "--timeout",
        String(cliTimeoutSeconds)
      ], {
        env: scopedCommandEnv?.env,
        timeout: commandTimeoutMs,
        maxBuffer: 1024 * 1024 * 8
      });
      const nextStdout = result.stdout;
      const nextStderr = result.stderr;
      const combinedOutput = `${nextStdout || ""}\n${nextStderr || ""}`;
      const payloadError = extractOpenClawGatewayError(combinedOutput);
      if (payloadError) {
        throw new Error(payloadError);
      }
      const successPayload = parseOpenClawJson(nextStdout || nextStderr || "");
      const stopReason = String(
        successPayload.result?.meta?.stopReason ?? extractJsonStringField(combinedOutput, "stopReason") ?? ""
      )
        .trim()
        .toLowerCase();
      const promptErrorDetected = /"customType"\s*:\s*"openclaw:prompt-error"/i.test(combinedOutput);
      const promptErrorMessage =
        extractJsonStringField(combinedOutput, "errorMessage")
        ?? extractJsonStringField(combinedOutput, "error")
        ?? "";
      if (
        stopReason === "aborted"
        || stopReason === "cancelled"
        || stopReason === "error"
        || promptErrorDetected
        || /request was aborted/i.test(promptErrorMessage)
      ) {
        throw new Error(
          promptErrorMessage || `OpenClaw returned interrupted result (stopReason=${stopReason || "unknown"})`
        );
      }
      const actualModel = normalizeModelForRouting(successPayload.result?.meta?.agentMeta?.model);
      if (isDesignAgent && actualModel && !isDesignModelPreferred(actualModel) && !fallbackCandidates.includes(actualModel)) {
        throw new Error(`unexpected execution model: ${actualModel}`);
      }
      stdout = nextStdout;
      stderr = nextStderr;
      finalError = null;
      attempts.push({
        attempt,
        route: "openclaw-cli",
        status: "success",
        startedAt: attemptStartedAt,
        elapsedMs: Math.max(0, Date.now() - attemptStartedAtMs),
        requestedModel,
        selectedModel: activeModel,
        executedModel: actualModel ?? activeModel,
        provider: String(successPayload.result?.meta?.agentMeta?.provider ?? "").trim() || undefined,
        isolatedSession: shouldIsolateSession,
        sessionId,
        localExecution: preferLocalExecution
      });
      break;
    } catch (error) {
      const stderrText =
        error && typeof error === "object" && "stderr" in error && typeof (error as { stderr?: unknown }).stderr === "string"
          ? ((error as { stderr: string }).stderr || "").trim()
          : "";
      const stdoutText =
        error && typeof error === "object" && "stdout" in error && typeof (error as { stdout?: unknown }).stdout === "string"
          ? ((error as { stdout: string }).stdout || "").trim()
          : "";
      const messageText = error instanceof Error ? String(error.message || "").trim() : String(error || "").trim();
      const detail = [stderrText, stdoutText, messageText]
        .filter(Boolean)
        .join("\n")
        .slice(0, 1500);
      finalError = detail || "OpenClaw agent command failed";

      await prisma.agentUsageLog.create({
        data: {
          agentId,
          model: activeModel,
          promptTokens: estimatedPromptTokens,
          completionTokens: 0,
          totalTokens: estimatedPromptTokens,
          status: "failed",
          commandType: classifyInstruction(message)
        }
      });

      const failure = classifyOpenClawAttemptFailure(finalError);
      const {
        isLockError,
        isTokenError,
        isModelUnavailableError,
        isTransportError,
        isUnexpectedModelError,
        isGatewayRepairableError
      } = failure;
      if (isModelUnavailableError) {
        for (const modelId of listGroupFallbackModels(finalError)) {
          if (modelId !== activeModel && !fallbackQueue.includes(modelId)) {
            fallbackQueue.push(modelId);
          }
        }
      }
      let recoveryAction: string | undefined;
      let recoveryTargetModel: string | undefined;

      if (isGatewayRepairableError && !gatewayRepairAttempted) {
        gatewayRepairAttempted = true;
        recoveryAction = "restart_gateway";
        attempts.push({
          attempt,
          route: "openclaw-cli",
          status: "failed",
          startedAt: attemptStartedAt,
          elapsedMs: Math.max(0, Date.now() - attemptStartedAtMs),
          requestedModel,
          selectedModel: activeModel,
          isolatedSession: shouldIsolateSession,
          sessionId,
          localExecution: preferLocalExecution,
          failureKind: failure.kind,
          recoveryAction,
          error: finalError
        });
        await restartOpenClawGateway();
        await sleep(800);
        continue;
      }
      const nextFallbackModel = selectOpenClawFallbackModel({
        activeModel,
        fallbackQueue,
        fallbackCursor,
        errorText: finalError
      });
      const shouldRetryWithFallback =
        (isTokenError || isModelUnavailableError || isUnexpectedModelError)
        && Boolean(nextFallbackModel)
        && nextFallbackModel !== activeModel;

      if (shouldRetryWithFallback) {
        recoveryAction = "switch_model";
        recoveryTargetModel = nextFallbackModel;
        attempts.push({
          attempt,
          route: "openclaw-cli",
          status: "failed",
          startedAt: attemptStartedAt,
          elapsedMs: Math.max(0, Date.now() - attemptStartedAtMs),
          requestedModel,
          selectedModel: activeModel,
          isolatedSession: shouldIsolateSession,
          sessionId,
          localExecution: preferLocalExecution,
          failureKind: failure.kind,
          recoveryAction,
          recoveryTargetModel,
          error: finalError
        });
        try {
          if (externalFallbackControl) {
            await syncOpenClawAgentMainSessionRuntimeModel(agentId, nextFallbackModel);
          } else {
            await switchAgentModelForRetry(agentId, nextFallbackModel, {
              explicitFallbacks: undefined
            });
          }
        } catch (switchError) {
          const reason = switchError instanceof Error ? switchError.message : "fallback switch failed";
          finalError = `${finalError}\n[model-fallback] ${reason}`;
          break;
        }
        activeModel = nextFallbackModel;
        fallbackCursor = Math.max(fallbackCursor + 1, fallbackQueue.indexOf(nextFallbackModel) + 1);
        await sleep(450);
        continue;
      }

      if (isLockError) {
        const lockPath = extractSessionLockPath(finalError);
        const removedStaleLock = await cleanupStaleSessionLock(lockPath);
        if (removedStaleLock && attempt < maxAttempts) {
          const lockedSessionFile = lockPath.endsWith(".lock") ? lockPath.slice(0, -5) : "";
          await resetOpenClawAgentMainSession(agentId, { lockedSessionFile }).catch(() => {
            // ignore best-effort main session reset
          });
          attempts.push({
            attempt,
            route: "openclaw-cli",
            status: "failed",
            startedAt: attemptStartedAt,
            elapsedMs: Math.max(0, Date.now() - attemptStartedAtMs),
            requestedModel,
            selectedModel: activeModel,
            isolatedSession: shouldIsolateSession,
            sessionId,
            localExecution: preferLocalExecution,
            failureKind: failure.kind,
            recoveryAction: "cleanup_stale_lock",
            error: finalError
          });
          await sleep(Math.min(1200, 300 * attempt));
          continue;
        }
        const releasedLiveLock = (shouldIsolateSession || preferLocalExecution)
          ? await releaseActiveSessionLock(lockPath, {
            agentId,
            minAgeMs: liveLockStealAfterMs,
            terminateTimeoutMs: liveLockTerminateTimeoutMs
          })
          : false;
        if (releasedLiveLock && attempt < maxAttempts) {
          const lockedSessionFile = lockPath.endsWith(".lock") ? lockPath.slice(0, -5) : "";
          await resetOpenClawAgentMainSession(agentId, { lockedSessionFile }).catch(() => {
            // ignore best-effort main session reset
          });
          attempts.push({
            attempt,
            route: "openclaw-cli",
            status: "failed",
            startedAt: attemptStartedAt,
            elapsedMs: Math.max(0, Date.now() - attemptStartedAtMs),
            requestedModel,
            selectedModel: activeModel,
            isolatedSession: shouldIsolateSession,
            sessionId,
            localExecution: preferLocalExecution,
            failureKind: failure.kind,
            recoveryAction: "terminate_live_lock_owner",
            error: finalError
          });
          await sleep(Math.min(1500, 350 * attempt));
          continue;
        }
        if (preferLocalExecution && attempt < maxAttempts) {
          attempts.push({
            attempt,
            route: "openclaw-cli",
            status: "failed",
            startedAt: attemptStartedAt,
            elapsedMs: Math.max(0, Date.now() - attemptStartedAtMs),
            requestedModel,
            selectedModel: activeModel,
            isolatedSession: shouldIsolateSession,
            sessionId,
            localExecution: preferLocalExecution,
            failureKind: failure.kind,
            recoveryAction: "retry_same_model",
            error: finalError
          });
          await sleep(Math.min(1800, 400 * attempt));
          continue;
        }
        attempts.push({
          attempt,
          route: "openclaw-cli",
          status: "failed",
          startedAt: attemptStartedAt,
          elapsedMs: Math.max(0, Date.now() - attemptStartedAtMs),
          requestedModel,
          selectedModel: activeModel,
          isolatedSession: shouldIsolateSession,
          sessionId,
          localExecution: preferLocalExecution,
          failureKind: failure.kind,
          recoveryAction: "abort",
          error: finalError
        });
        break;
      }

      if ((isTransportError || isUnexpectedModelError) && attempt < maxAttempts) {
        if (failure.kind === "lock") {
          const lockPath = extractSessionLockPath(finalError);
          if (lockPath) {
            await cleanupStaleSessionLock(lockPath);
          }
          await cleanupOpenClawAgentStaleSessionLocks(agentId);
        }
        attempts.push({
          attempt,
          route: "openclaw-cli",
          status: "failed",
          startedAt: attemptStartedAt,
          elapsedMs: Math.max(0, Date.now() - attemptStartedAtMs),
          requestedModel,
          selectedModel: activeModel,
          isolatedSession: shouldIsolateSession,
          sessionId,
          localExecution: preferLocalExecution,
          failureKind: failure.kind,
          recoveryAction: "retry_same_model",
          error: finalError
        });
        await sleep(Math.min(2200, 450 * attempt));
        continue;
      }

      attempts.push({
        attempt,
        route: "openclaw-cli",
        status: "failed",
        startedAt: attemptStartedAt,
        elapsedMs: Math.max(0, Date.now() - attemptStartedAtMs),
        requestedModel,
        selectedModel: activeModel,
        isolatedSession: shouldIsolateSession,
        sessionId,
        localExecution: preferLocalExecution,
        failureKind: failure.kind,
        recoveryAction: "abort",
        error: finalError
      });
      break;
    } finally {
      await scopedCommandEnv?.cleanup();
    }
  }

  if (finalError) {
    const commandError = new Error(finalError) as Error & { attempts?: OpenClawAgentAttemptTrace[] };
    commandError.attempts = attempts;
    throw commandError;
  }

  const raw = (stdout || stderr).trim();
  const payload = parseOpenClawJson(raw);
  const result = payload?.result;
  const stopReason = String(result?.meta?.stopReason ?? extractJsonStringField(raw, "stopReason") ?? "")
    .trim()
    .toLowerCase();
  const promptErrorDetected = /"customType"\s*:\s*"openclaw:prompt-error"/i.test(raw);
  const promptErrorMessage =
    extractJsonStringField(raw, "errorMessage")
    ?? extractJsonStringField(raw, "error")
    ?? "";
  if (
    stopReason === "aborted"
    || stopReason === "cancelled"
    || stopReason === "error"
    || promptErrorDetected
    || /request was aborted/i.test(promptErrorMessage)
  ) {
    const commandError = new Error(
      promptErrorMessage || `OpenClaw returned interrupted result (stopReason=${stopReason || "unknown"})`
    ) as Error & { attempts?: OpenClawAgentAttemptTrace[] };
    commandError.attempts = attempts;
    throw commandError;
  }
  const replyFromPayload = Array.isArray(result?.payloads)
    ? result.payloads
        .map((item: { text?: string }) => String(item?.text ?? "").trim())
        .filter(Boolean)
        .join("\n\n")
    : "";
  const reply = replyFromPayload || extractAgentReplyFromRaw(raw);
  const summary = String(payload?.summary ?? extractJsonStringField(raw, "summary") ?? "completed");
  const ok =
    payload?.status === "ok"
    || raw.includes('"status": "ok"')
    || (Boolean(reply) && summary !== "failed");
  const estimatedCompletionTokens = estimateTokenCount(reply);
  const providerUsage = extractTokenUsageFromPayload(payload);
  const promptTokens = providerUsage?.promptTokens ?? estimatedPromptTokens;
  const completionTokens = providerUsage?.completionTokens ?? estimatedCompletionTokens;
  const totalTokens = providerUsage?.totalTokens ?? (promptTokens + completionTokens);
  const model = result?.meta?.agentMeta?.model || activeModel;

  await prisma.agentUsageLog.create({
    data: {
      agentId,
      model,
      promptTokens,
      completionTokens,
      totalTokens,
      status: ok ? "success" : "failed",
      commandType: classifyInstruction(message)
    }
  });

  const actualModel = normalizeModelForRouting(model);
  if (requestedModel && actualModel && actualModel !== requestedModel) {
    try {
      await restoreAgentSelectedModel(agentId, requestedModel);
    } catch (error) {
      console.warn(
        `[openclaw] failed to restore preferred model for ${agentId}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  return {
    ok,
    agentId,
    summary,
    sessionId: result?.meta?.agentMeta?.sessionId,
    model,
    provider: result?.meta?.agentMeta?.provider,
    durationMs: Number(result?.meta?.durationMs ?? 0) || undefined,
    reply,
    attempts
  };
}

export async function sendOpenClawBatchAgentMessage(
  input: OpenClawBatchAgentMessageInput
): Promise<OpenClawBatchAgentCommandResult> {
  const agentIds = dedupeStrings(input.agentIds.map((item) => item.trim()).filter(Boolean));
  const results: OpenClawAgentCommandResult[] = [];

  for (const agentId of agentIds) {
    try {
      results.push(await sendOpenClawAgentMessage(agentId, { message: input.message }));
    } catch (error) {
      results.push({
        ok: false,
        agentId,
        summary: "failed",
        reply: error instanceof Error ? error.message : "OpenClaw agent command failed"
      });
    }
  }

  return {
    ok: results.every((item) => item.ok),
    requestedAgentIds: agentIds,
    completedCount: results.filter((item) => item.ok).length,
    failedCount: results.filter((item) => !item.ok).length,
    results
  };
}

async function buildWorkspaceSnapshot(): Promise<{
  agents: OpenClawAgentDetail[];
  projects: ProjectBuild[];
}> {
  const [config, teamMap, projectDirectories] = await Promise.all([
    readJsonFile<OpenClawConfig>(OPENCLAW_CONFIG_PATH),
    loadTeamMap(),
    discoverProjectDirectories()
  ]);

  const projectBuilds = (
    await Promise.all(projectDirectories.map((directoryPath) => buildProject(directoryPath, teamMap)))
  ).filter((project): project is ProjectBuild => project !== null);
  const taskMapByAgent = buildTaskMapByAgent(projectBuilds.flatMap((project) => project.tasks));

  const agentConfigs = (config?.agents?.list ?? []).filter((agent) => Boolean(agent.id));
  const dayStart = startOfToday();
  const managedConfigs = await prisma.managedAgentConfig.findMany({
    where: {
      agentId: {
        in: agentConfigs.map((agent) => agent.id)
      }
    },
    include: {
      memoryEntries: {
        orderBy: [{ importance: "desc" }, { updatedAt: "desc" }],
        take: 50
      },
      usageLogs: {
        where: {
          createdAt: {
            gte: dayStart
          }
        },
        orderBy: { createdAt: "desc" },
        take: 20
      }
    }
  });
  const managedConfigMap = new Map(managedConfigs.map((item) => [item.agentId, item]));

  const agentDetails = (
    await Promise.all(
      agentConfigs.map((agentConfig) =>
        buildAgent(
          agentConfig,
          teamMap,
          taskMapByAgent.get(agentConfig.id) ?? [],
          managedConfigMap.get(agentConfig.id)
        )
      )
    )
  ).filter((agent): agent is OpenClawAgentDetail => agent !== null);

  projectBuilds.sort(compareProjects);
  agentDetails.sort(compareAgents);

  return {
    agents: agentDetails,
    projects: projectBuilds
  };
}

function compareAgents(left: OpenClawAgentDetail, right: OpenClawAgentDetail) {
  const priority = { active: 0, attention: 1, idle: 2, offline: 3 } as const;
  const presenceDelta = priority[left.status] - priority[right.status];
  if (presenceDelta !== 0) {
    return presenceDelta;
  }

  return left.name.localeCompare(right.name, "zh-CN");
}

function compareProjects(left: ProjectBuild, right: ProjectBuild) {
  const priority = { blocked: 0, active: 1, planned: 2, completed: 3 } as const;
  const statusDelta = priority[left.detail.status] - priority[right.detail.status];
  if (statusDelta !== 0) {
    return statusDelta;
  }

  return right.detail.updatedAt.localeCompare(left.detail.updatedAt);
}

async function buildAgent(
  agentConfig: AgentConfig,
  teamMap: Map<string, TeamMember>,
  tasks: OpenClawTaskItem[],
  managedConfig?: {
    agentId: string;
    displayName: string | null;
    title: string | null;
    intro: string | null;
    responsibility: string | null;
    selectedModel: string;
    defaultModel: string;
    fallbackModel: string | null;
    executionMode: string;
    requireConfirmation: boolean;
    autoApproveMinorSteps: boolean;
    maxPromptTokens: number | null;
    maxCompletionTokens: number | null;
    maxDailyTokens: number | null;
    memoryEnabled: boolean;
    allowedAgentIds: unknown;
    toolAllowlist: unknown;
    createdAt: Date;
    updatedAt: Date;
    memoryEntries: Array<{
      id: string;
      agentId: string;
      projectId: string | null;
      type: string;
      summary: string;
      content: string;
      importance: number;
      tags: unknown;
      source: string | null;
      lastAccessedAt: Date;
      createdAt: Date;
      updatedAt: Date;
    }>;
    usageLogs: Array<{
      id: string;
      agentId: string;
      model: string;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      status: string;
      commandType: string;
      createdAt: Date;
    }>;
  }
): Promise<OpenClawAgentDetail | null> {
  const workspacePath = agentConfig.workspace || resolveWorkspaceForAgent(agentConfig.id);
  if (!workspacePath) {
    return null;
  }

  const [identityContent, soul, sop, sessions] = await Promise.all([
    readTextFile(path.join(workspacePath, "IDENTITY.md")),
    readDocument("soul", path.join(workspacePath, "SOUL.md")),
    readSopDocument(workspacePath),
    readSessions(agentConfig.id)
  ]);
  const recentMessages = sessions[0] ? await readRecentSessionMessages(agentConfig.id, sessions[0].sessionId) : [];

  const team = teamMap.get(agentConfig.id);
  const identity = parseIdentity(identityContent);
  const soulDerivedName = deriveNameFromSoul(soul.content);
  const preferredDisplayName = pickPreferredAgentDisplayName(
    [managedConfig?.displayName, identity.name, soulDerivedName, team?.name, agentConfig.name],
    agentConfig.id
  );
  const soulDerivedTitle = deriveTitleFromSoul(soul.content, {
    agentName: preferredDisplayName || managedConfig?.displayName || identity.name || soulDerivedName || team?.name || agentConfig.name || "",
    agentId: agentConfig.id
  });
  const name = normalizeAgentDisplayName(
    preferredDisplayName || managedConfig?.displayName || identity.name || soulDerivedName || team?.name || agentConfig.name || "",
    team?.title || humanizeAgentId(agentConfig.id),
    agentConfig.id
  );
  const title = resolveAgentTitle({
    managedTitle: managedConfig?.title,
    identityTitle: identity.title,
    soulTitle: soulDerivedTitle,
    teamTitle: team?.title,
    agentName: name,
    agentId: agentConfig.id
  });
  const responsibility = managedConfig?.responsibility || team?.responsibility || buildSoulIntro(soul.content);
  const intro = managedConfig?.intro || buildAgentIntro(soul.content, responsibility);
  const lastActiveAt = sessions[0]?.updatedAt;
  const status = deriveAgentPresence(lastActiveAt, tasks);
  const currentModel = resolveAgentConfiguredPrimaryModel(agentConfig.model) || "unknown";
  const commander = normalizeCommanderSettings(currentModel, managedConfig);
  const availableModels = buildModelCatalog(commander.selectedModel);
  const usage = buildUsageSummary(managedConfig?.usageLogs ?? [], commander.maxDailyTokens);
  const memoryEntries = (managedConfig?.memoryEntries ?? []).map(toMemoryEntry);
  const usageLogs = (managedConfig?.usageLogs ?? []).map(toUsageLogEntry);
  const allowedAgentIds = normalizeStringArray(
    jsonArrayToStringArray(managedConfig?.allowedAgentIds) ?? agentConfig.subagents?.allowAgents
  );
  const tools = normalizeStringArray(
    jsonArrayToStringArray(managedConfig?.toolAllowlist) ?? agentConfig.tools?.allow
  );

  const summary: OpenClawAgentSummary = {
    agentId: agentConfig.id,
    name,
    emoji: identity.emoji || "AI",
    title,
    responsibility,
    intro,
    model: commander.selectedModel,
    workspacePath,
    agentDir: agentConfig.agentDir,
    status,
    lastActiveAt,
    heartbeatEnabled: agentConfig.id === "main",
    activeSessionCount: sessions.filter((session) => isRecent(session.updatedAt, 45)).length,
    sessionCount: sessions.length,
    taskCount: tasks.length,
    blockedTaskCount: tasks.filter((task) => task.status === "blocked").length,
    allowedAgentIds,
    tools,
    soulPath: soul.path,
    sopPath: sop.path,
    availableModels,
    commander,
    usage,
    memoryEntryCount: memoryEntries.length,
    currentTask: selectCurrentTask(tasks)
  };

  return {
    ...summary,
    openId: team?.openId,
    vibe: identity.vibe,
    identitySource: identity.name || identity.emoji ? "IDENTITY.md" : undefined,
    soul,
    sop,
    sessions,
    recentMessages,
    tasks: [...tasks].sort(compareTasks),
    memoryEntries,
    usageLogs
  };
}

async function buildProject(
  directoryPath: string,
  teamMap: Map<string, TeamMember>
): Promise<ProjectBuild | null> {
  const relativePath = normalizeRelativePath(path.relative(OPENCLAW_WORKSPACE_ROOT, directoryPath));
  const docPaths = await collectProjectDocPaths(directoryPath);
  const tasksPath = path.join(directoryPath, "tasks.json");

  if (docPaths.length === 0 && !existsSync(tasksPath)) {
    return null;
  }

  const projectId = encodeProjectId(relativePath);
  const docs = await Promise.all(docPaths.map(toProjectDocument));
  const rawTasks = await readJsonFile<RawProjectTasksPayload>(tasksPath);
  const projectName =
    resolveProjectName(rawTasks?.project) ||
    extractProjectName(await readTextFile(path.join(directoryPath, "README.md"))) ||
    relativePath.split("/").at(-1) ||
    "OpenClaw 项目";
  const updatedAt = await resolveProjectUpdatedAt(directoryPath, docs, rawTasks?.last_updated);
  const tasks = (rawTasks?.tasks ?? []).map((task, index) =>
    toProjectTask({
      task,
      index,
      projectId,
      projectName,
      updatedAt,
      teamMap
    })
  );
  const blockers = uniqueItems(tasks.flatMap((task) => task.blockers));
  const progress = tasks.length > 0 ? Math.round(tasks.reduce((sum, task) => sum + task.progress, 0) / tasks.length) : Math.min(docs.length * 20, 95);
  const description =
    extractExcerpt(await readTextFile(path.join(directoryPath, "requirements.md"))) ||
    extractExcerpt(await readTextFile(path.join(directoryPath, "README.md"))) ||
    `${projectName} 的 OpenClaw 工作区项目`;
  const readmeExcerpt = extractExcerpt(await readTextFile(path.join(directoryPath, "README.md")));
  const requirementsExcerpt = extractExcerpt(await readTextFile(path.join(directoryPath, "requirements.md")));
  const status = deriveProjectStatus(tasks, blockers);
  const currentTask = tasks.find((task) => task.status === "in_progress") ?? tasks.find((task) => task.status === "blocked") ?? tasks[0];

  return {
    detail: {
      id: projectId,
      name: projectName,
      relativePath,
      absolutePath: directoryPath,
      status,
      progress,
      updatedAt,
      description,
      taskCount: tasks.length,
      blockedTaskCount: tasks.filter((task) => task.status === "blocked").length,
      agentCount: new Set(tasks.map((task) => task.agentId).filter(Boolean)).size,
      blockerCount: blockers.length,
      currentFocus: currentTask ? `${currentTask.agentName} · ${currentTask.title}` : undefined,
      tasks: [...tasks].sort(compareTasks),
      blockers,
      docs,
      readmeExcerpt,
      requirementsExcerpt,
      agentIds: uniqueItems(tasks.map((task) => task.agentId).filter(Boolean))
    },
    tasks
  };
}

function buildTaskMapByAgent(tasks: OpenClawTaskItem[]) {
  const taskMap = new Map<string, OpenClawTaskItem[]>();

  for (const task of tasks) {
    const bucket = taskMap.get(task.agentId) ?? [];
    bucket.push(task);
    taskMap.set(task.agentId, bucket);
  }

  return taskMap;
}

async function discoverProjectDirectories() {
  const entries = await readDirSafe(OPENCLAW_WORKSPACE_ROOT);
  const directories: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || RESERVED_WORKSPACE_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(OPENCLAW_WORKSPACE_ROOT, entry.name);
    if (entry.name === "ab-experiments") {
      const childEntries = await readDirSafe(fullPath);
      for (const child of childEntries) {
        if (!child.isDirectory()) {
          continue;
        }

        const childPath = path.join(fullPath, child.name);
        if (await looksLikeProjectDirectory(childPath)) {
          directories.push(childPath);
        }
      }

      continue;
    }

    if (await looksLikeProjectDirectory(fullPath)) {
      directories.push(fullPath);
    }
  }

  return directories;
}

async function looksLikeProjectDirectory(directoryPath: string) {
  const entries = await readDirSafe(directoryPath);
  const names = new Set(entries.map((entry) => entry.name));
  return (
    PROJECT_DOC_FILES.some((fileName) => names.has(fileName)) ||
    entries.some((entry) => entry.isFile() && PROJECT_DOC_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) ||
    names.has("tasks.json")
  );
}

async function collectProjectDocPaths(directoryPath: string) {
  const docPaths = new Set<string>();

  for (const fileName of PROJECT_DOC_FILES) {
    const filePath = path.join(directoryPath, fileName);
    if (existsSync(filePath)) {
      docPaths.add(filePath);
    }
  }

  const entries = await readDirSafe(directoryPath);
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!PROJECT_DOC_EXTENSIONS.has(extension) || entry.name === "tasks.json") {
      continue;
    }

    docPaths.add(path.join(directoryPath, entry.name));
  }

  return [...docPaths].sort(compareProjectDocPaths);
}

async function toProjectDocument(filePath: string): Promise<OpenClawProjectDocument> {
  const [stats, content] = await Promise.all([
    stat(filePath),
    shouldExtractTextExcerpt(filePath) ? readTextFile(filePath) : Promise.resolve("")
  ]);
  const extension = path.extname(filePath).replace(/^\./, "").toLowerCase();
  const label = path.basename(filePath);

  return {
    id: normalizeRelativePath(path.relative(OPENCLAW_WORKSPACE_ROOT, filePath)),
    label,
    kind: inferProjectDocKind(label),
    extension,
    path: filePath,
    updatedAt: stats.mtime.toISOString(),
    excerpt: content ? extractExcerpt(content) : ""
  };
}

function compareProjectDocPaths(left: string, right: string) {
  return projectDocRank(path.basename(left)) - projectDocRank(path.basename(right)) || left.localeCompare(right);
}

function projectDocRank(fileName: string) {
  const preferredOrder = [
    "README.md",
    "requirements.md",
    "prototype.md",
    "architecture.md",
    "demo.html",
    "SPRINT.md",
    "TEST-REPORT.md",
    "TEAM.md",
    "AGENTS.md"
  ];
  const index = preferredOrder.indexOf(fileName);
  return index === -1 ? preferredOrder.length + 1 : index;
}

function shouldExtractTextExcerpt(filePath: string) {
  return TEXT_EXCERPT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function inferProjectDocKind(fileName: string) {
  const normalized = fileName.toLowerCase();

  if (normalized === "readme.md") {
    return "overview";
  }

  if (normalized.includes("requirement")) {
    return "requirements";
  }

  if (normalized.includes("prototype")) {
    return "prototype";
  }

  if (normalized.includes("architect")) {
    return "architecture";
  }

  if (normalized.includes("test")) {
    return "qa";
  }

  if (normalized.includes("sprint")) {
    return "planning";
  }

  if (normalized.includes("team") || normalized.includes("agent")) {
    return "team";
  }

  if (normalized.endsWith(".html")) {
    return "demo";
  }

  if (normalized.endsWith(".pdf")) {
    return "document";
  }

  return "artifact";
}

function toProjectTask(input: {
  task: {
    id?: string | number;
    agent?: string;
    role?: string;
    owner?: string;
    task?: string;
    title?: string;
    progress?: number;
    status?: string;
    deadline?: string;
    blockers?: string[];
    deliverable?: string;
    depends_on?: string[];
  };
  index: number;
  projectId: string;
  projectName: string;
  updatedAt: string;
  teamMap: Map<string, TeamMember>;
}): OpenClawTaskItem {
  const agentId = String(input.task.role ?? input.task.owner ?? "").trim();
  const team = input.teamMap.get(agentId);
  const statusLabel = String(input.task.status ?? "未知");
  const title = String(input.task.task ?? input.task.title ?? `任务 ${input.index + 1}`).trim();
  const inferredProgress =
    input.task.progress !== undefined
      ? input.task.progress
      : inferProgressFromStatus(statusLabel);

  return {
    id: `${input.projectId}:task:${input.task.id ?? input.index + 1}`,
    sourceTaskId: String(input.task.id ?? input.index + 1),
    projectId: input.projectId,
    projectName: input.projectName,
    agentId,
    agentName: team?.name || String(input.task.agent ?? "").trim() || humanizeAgentId(agentId || "unknown"),
    title,
    status: normalizeTaskState(statusLabel, input.task.blockers ?? []),
    statusLabel,
    progress: clampProgress(inferredProgress),
    deadline: input.task.deadline,
    blockers: (input.task.blockers ?? []).filter(Boolean),
    updatedAt: input.updatedAt
  };
}

function selectCurrentTask(tasks: OpenClawTaskItem[]) {
  return [...tasks].sort(compareTasks)[0];
}

function compareTasks(left: OpenClawTaskItem, right: OpenClawTaskItem) {
  const priority = { blocked: 0, in_progress: 1, todo: 2, unknown: 3, done: 4 } as const;
  const statusDelta = priority[left.status] - priority[right.status];
  if (statusDelta !== 0) {
    return statusDelta;
  }

  return right.progress - left.progress;
}

function deriveProjectStatus(tasks: OpenClawTaskItem[], blockers: string[]): OpenClawProjectState {
  if (tasks.length === 0) {
    return "planned";
  }

  if (tasks.every((task) => task.status === "done")) {
    return "completed";
  }

  if (tasks.some((task) => task.status === "blocked") || blockers.length > 0) {
    return "blocked";
  }

  return "active";
}

function deriveAgentPresence(lastActiveAt: string | undefined, tasks: OpenClawTaskItem[]): OpenClawAgentPresence {
  if (tasks.some((task) => task.status === "blocked")) {
    return "attention";
  }

  if (lastActiveAt && isRecent(lastActiveAt, 30)) {
    return "active";
  }

  if (lastActiveAt || tasks.length > 0) {
    return "idle";
  }

  return "offline";
}

async function readSessions(agentId: string): Promise<OpenClawSessionSummary[]> {
  const filePath = path.join(OPENCLAW_ROOT, "agents", agentId, "sessions", "sessions.json");
  const payload = await readJsonFile<Record<string, SessionRecord>>(filePath);
  if (!payload) {
    return [];
  }

  return Object.entries(payload)
    .map(([key, record]) => ({
      key,
      sessionId: String((record as { sessionId?: string }).sessionId ?? ""),
      label: record.displayName || record.subject || key,
      kind: key.includes(":group:") ? "group" : "direct",
      channel: record.channel,
      chatType: record.chatType,
      subject: record.subject,
      updatedAt: new Date(record.updatedAt ?? Date.now()).toISOString(),
      systemSent: Boolean(record.systemSent),
      abortedLastRun: Boolean(record.abortedLastRun)
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 12);
}

async function readRecentSessionMessages(
  agentId: string,
  sessionId: string
): Promise<OpenClawSessionMessage[]> {
  const sessionStore = await readJsonFile<Record<string, { sessionId?: string; sessionFile?: string }>>(
    path.join(OPENCLAW_ROOT, "agents", agentId, "sessions", "sessions.json")
  );
  const sessionEntry = Object.values(sessionStore ?? {}).find((item) => item.sessionId === sessionId);
  const sessionFile =
    sessionEntry?.sessionFile || path.join(OPENCLAW_ROOT, "agents", agentId, "sessions", `${sessionId}.jsonl`);

  if (!existsSync(sessionFile)) {
    return [];
  }

  const chunk = await readLastChunk(sessionFile, 256 * 1024);
  const lines = chunk.split("\n").filter(Boolean).slice(-80);
  const messages: OpenClawSessionMessage[] = [];

  for (const line of lines) {
    try {
      const record = JSON.parse(line) as {
        id?: string;
        timestamp?: string;
        type?: string;
        message?: {
          role?: string;
          content?: Array<{ type?: string; text?: string; content?: string }>;
        };
      };

      if (record.type !== "message") {
        continue;
      }

      const role = normalizeMessageRole(record.message?.role);
      const text = extractMessageText(record.message?.content ?? []);
      if (!text) {
        continue;
      }

      messages.push({
        id: String(record.id ?? `${messages.length}`),
        role,
        text,
        timestamp: record.timestamp || new Date().toISOString()
      });
    } catch {
      continue;
    }
  }

  return messages.slice(-12).reverse();
}

async function loadTeamMap() {
  const content = await readTextFile(TEAM_FILE_PATH);
  const map = new Map<string, TeamMember>();

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      continue;
    }

    const columns = trimmed
      .split("|")
      .slice(1, -1)
      .map((column) => column.trim());

    if (columns.length < 5 || columns[0] === "Agent" || columns[0].startsWith("---")) {
      continue;
    }

    const [name, title, agentId, openId, responsibility] = columns;
    if (!agentId) {
      continue;
    }

    map.set(agentId, {
      name,
      title,
      agentId,
      openId,
      responsibility
    });
  }

  return map;
}

function parseIdentity(content: string) {
  return {
    name: sanitizeIdentityValue(matchLooseIdentityValue(content, ["Name", "name", "名称", "昵称"], /^#\s+(.+)$/m)),
    emoji: sanitizeIdentityValue(matchLooseIdentityValue(content, ["Emoji", "emoji"])),
    vibe: sanitizeIdentityValue(matchLooseIdentityValue(content, ["Vibe", "vibe"])),
    title: sanitizeIdentityValue(
      matchLooseIdentityValue(content, ["Title", "title", "职位", "职务", "核心角色", "角色", "Role", "role"])
    ),
    intro: sanitizeIdentityValue(matchLooseIdentityValue(content, ["Intro", "intro", "简介", "定位", "说明"])),
    agentId: sanitizeIdentityValue(matchLooseIdentityValue(content, ["Agent ID", "agent_id", "agentId", "编号"]))
  };
}

function matchMarkdownValue(content: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`- \\*\\*${escapedLabel}:\\*\\*\\s*(.+)$`, "m"));
  return match?.[1]?.trim() || "";
}

function matchLooseIdentityValue(content: string, labels: string[], fallbackPattern?: RegExp) {
  for (const label of labels) {
    const markdownValue = matchMarkdownValue(content, label);
    if (markdownValue) {
      return markdownValue;
    }

    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const plainMatch = content.match(new RegExp(`-\\s*${escapedLabel}:\\s*(.+)$`, "mi"));
    if (plainMatch?.[1]?.trim()) {
      return plainMatch[1].trim();
    }
  }

  if (fallbackPattern) {
    return fallbackPattern.exec(content)?.[1]?.trim() || "";
  }

  return "";
}

function sanitizeIdentityValue(value: string) {
  if (
    !value ||
    value.includes("pick something you like") ||
    value.includes("pick one that feels right") ||
    value.includes("Fill this in") ||
    value.toLowerCase().includes("how do you come across")
  ) {
    return "";
  }

  return value.replace(/^_+\(?/, "").replace(/\)?_+$/, "").trim();
}

function normalizeIdentityLine(value: string) {
  return String(value || "")
    .replace(/[`*_~]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanRoleCandidate(value: string) {
  return normalizeIdentityLine(value)
    .replace(/^(你是|我是|作为)\s*/u, "")
    .replace(/^[：:\-—\s]+/u, "")
    .replace(/[。；;，,：:]+$/u, "")
    .trim();
}

function sameIdentityValue(left?: string, right?: string) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

function isSuspiciousAgentTitle(title: string, context?: { agentName?: string; agentId?: string }) {
  const normalized = normalizeIdentityLine(title);
  if (!normalized) {
    return true;
  }
  if (sameIdentityValue(normalized, context?.agentId) || sameIdentityValue(normalized, context?.agentName)) {
    return true;
  }
  return /^(agent|unknown|未命名|待配置角色)$/iu.test(normalized);
}

function pickFirstNonEmptyLine(content: string) {
  const lines = String(content || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[0] || "";
}

function deriveTitleFromRoleSentence(line: string, context?: { agentName?: string; agentId?: string }) {
  if (!line) {
    return "";
  }

  const normalized = cleanRoleCandidate(line);
  if (!normalized) {
    return "";
  }

  const alt = normalized.match(/(?:一位|一个|一名)\s*([^，,。；;\n]+)/u)?.[1]?.trim() || "";
  const altCandidate = cleanRoleCandidate(alt);
  const firstClause = cleanRoleCandidate(normalized.split(/[，,。；;：:\n]/u)[0] || "");
  if (altCandidate && /(?:一位|一个|一名)/u.test(normalized) && !isSuspiciousAgentTitle(altCandidate, context)) {
    return altCandidate;
  }
  if (firstClause && !isSuspiciousAgentTitle(firstClause, context)) {
    return firstClause;
  }
  if (altCandidate && !isSuspiciousAgentTitle(altCandidate, context)) {
    return altCandidate;
  }

  return "";
}

function pickPreferredAgentDisplayName(candidates: Array<string | null | undefined>, agentId: string) {
  const humanized = humanizeAgentId(agentId);
  for (const item of candidates) {
    const candidate = normalizeIdentityLine(item || "");
    if (!candidate) {
      continue;
    }
    if (sameIdentityValue(candidate, agentId) || sameIdentityValue(candidate, humanized)) {
      continue;
    }
    if (/^(agent|unknown|未命名)$/iu.test(candidate)) {
      continue;
    }
    return candidate;
  }
  return "";
}

function normalizeAgentDisplayName(rawName: string, title: string, agentId: string) {
  const cleaned = rawName.trim();
  if (cleaned && !sameIdentityValue(cleaned, agentId)) {
    return cleaned;
  }

  if (title && !sameIdentityValue(title, humanizeAgentId(agentId))) {
    return title;
  }

  return humanizeAgentId(agentId);
}

function deriveTitleFromSoul(content: string, context?: { agentName?: string; agentId?: string }) {
  const lines = String(content || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const explicit = line.match(
      /^(?:[-*]\s*)?(?:\*\*)?(职位|职务|岗位|头衔|title|Title|核心角色|角色定位|Role|role)(?:\*\*)?\s*[:：]\s*(.+)$/u
    );
    if (!explicit) {
      continue;
    }
    const candidate = cleanRoleCandidate(explicit[2] || "");
    if (candidate && !isSuspiciousAgentTitle(candidate, context)) {
      return candidate;
    }
  }

  const roleSectionMatch = String(content || "").match(
    /^##\s*(?:角色|Role)\s*[\r\n]+([\s\S]*?)(?:\n##\s+|\n---|\n$)/im
  );
  const roleLine = pickFirstNonEmptyLine(roleSectionMatch?.[1] || "");
  const sentenceDerived = deriveTitleFromRoleSentence(roleLine, context);
  if (sentenceDerived) {
    return sentenceDerived;
  }

  const heading = cleanRoleCandidate(String(content || "").match(/^#\s+(.+)$/m)?.[1] || "");
  if (
    heading
    && !/\bSOUL\b|SOUL\.md/iu.test(heading)
    && !isSuspiciousAgentTitle(heading, context)
  ) {
    return heading;
  }

  return "";
}

function deriveNameFromSoul(content: string) {
  const lines = String(content || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const explicit = line.match(/^(?:[-*]\s*)?(?:\*\*)?(名称|Name|name)(?:\*\*)?\s*[:：]\s*(.+)$/u);
    if (!explicit) {
      continue;
    }
    const candidate = cleanRoleCandidate(explicit[2] || "");
    if (candidate && !/^(agent|unknown|未命名)$/iu.test(candidate)) {
      return candidate;
    }
  }

  const roleSectionMatch = String(content || "").match(
    /^##\s*(?:角色|Role)\s*[\r\n]+([\s\S]*?)(?:\n##\s+|\n---|\n$)/im
  );
  const roleLine = pickFirstNonEmptyLine(roleSectionMatch?.[1] || "");
  const alias = cleanRoleCandidate(roleLine.match(/你是\s*([^，,。；;\n]+)/u)?.[1] || "");
  if (alias && !/^(agent|unknown|未命名)$/iu.test(alias)) {
    return alias;
  }

  return "";
}

function resolveAgentTitle(input: {
  managedTitle?: string | null;
  identityTitle?: string;
  soulTitle?: string;
  teamTitle?: string;
  agentName?: string;
  agentId: string;
}) {
  const context = { agentName: input.agentName, agentId: input.agentId };
  const orderedCandidates = [
    String(input.managedTitle || "").trim(),
    String(input.identityTitle || "").trim(),
    String(input.soulTitle || "").trim(),
    String(input.teamTitle || "").trim()
  ];

  for (const candidate of orderedCandidates) {
    if (!isSuspiciousAgentTitle(candidate, context)) {
      return candidate;
    }
  }

  return humanizeAgentId(input.agentId);
}

function buildSoulIntro(content: string) {
  const roleLine = content.match(/^##\s*角色\s*\n(.+)$/m)?.[1]?.trim();
  if (roleLine) {
    return roleLine.replace(/^你是/, "");
  }

  return extractExcerpt(content);
}

function buildAgentIntro(content: string, fallback: string) {
  return extractExcerpt(content) || fallback || "已接入 OpenClaw 工作区";
}

async function readSopDocument(workspacePath: string): Promise<OpenClawEditableDocument> {
  const directoryEntries = await readDirSafe(workspacePath);
  const names = directoryEntries.map((entry) => entry.name);
  const preferredName =
    SOP_FILE_CANDIDATES.find((candidate) => names.includes(candidate)) ||
    names.find((name) => /^sop-.*\.md$/i.test(name)) ||
    "SOP.md";

  return readDocument("sop", path.join(workspacePath, preferredName));
}

async function readDocument(
  type: OpenClawEditableDocumentType,
  filePath: string
): Promise<OpenClawEditableDocument> {
  if (!existsSync(filePath)) {
    return {
      type,
      path: filePath,
      exists: false,
      content: ""
    };
  }

  const [content, stats] = await Promise.all([readTextFile(filePath), stat(filePath)]);
  return {
    type,
    path: filePath,
    exists: true,
    content,
    updatedAt: stats.mtime.toISOString()
  };
}

async function resolveProjectUpdatedAt(
  directoryPath: string,
  docs: OpenClawProjectDocument[],
  rawUpdatedAt?: string
) {
  const candidates = docs.map((doc) => new Date(doc.updatedAt).getTime());

  if (rawUpdatedAt) {
    candidates.push(new Date(rawUpdatedAt).getTime());
  }

  if (candidates.length === 0) {
    const stats = await stat(directoryPath);
    return stats.mtime.toISOString();
  }

  return new Date(Math.max(...candidates)).toISOString();
}

function extractProjectName(content: string) {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || "";
}

function resolveProjectName(project: RawProjectTasksPayload["project"]) {
  if (!project) {
    return "";
  }

  if (typeof project === "string") {
    return project;
  }

  return String(project.name ?? project.directory ?? "").trim();
}

function extractExcerpt(content: string) {
  const text = content
    .replace(/<[^>]+>/g, " ")
    .replace(/^#.*$/gm, "")
    .replace(/[`*_>#-]/g, " ")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    return "";
  }

  return text.slice(0, 180);
}

function extractMessageText(content: Array<{ type?: string; text?: string; content?: string }>) {
  return content
    .map((item) => {
      if (item.type === "text") {
        return String(item.text ?? "");
      }

      if (item.type === "output_text") {
        return String(item.text ?? "");
      }

      return "";
    })
    .join("\n")
    .trim();
}

function normalizeMessageRole(role?: string): OpenClawSessionMessage["role"] {
  if (role === "user" || role === "assistant" || role === "system") {
    return role;
  }

  if (role === "tool" || role === "toolResult") {
    return "tool";
  }

  return "other";
}

function normalizeTaskState(statusLabel: string, blockers: string[]): OpenClawTaskState {
  const normalized = statusLabel.toLowerCase();

  if (blockers.length > 0 || normalized.includes("阻塞") || normalized.includes("blocked")) {
    return "blocked";
  }

  if (normalized.includes("完成") || normalized.includes("done")) {
    return "done";
  }

  if (
    normalized.includes("进行") ||
    normalized.includes("启动") ||
    normalized.includes("processing") ||
    normalized.includes("progress")
  ) {
    return "in_progress";
  }

  if (
    normalized.includes("待") ||
    normalized.includes("确认") ||
    normalized.includes("todo") ||
    normalized.includes("plan")
  ) {
    return "todo";
  }

  return "unknown";
}

function toTaskStatusLabel(status: OpenClawTaskState, progress: number) {
  switch (status) {
    case "blocked":
      return "已阻塞";
    case "done":
      return progress >= 100 ? "已完成" : "已完成";
    case "in_progress":
      return progress > 0 ? "进行中" : "已启动";
    case "todo":
      return "待确认";
    default:
      return "未知";
  }
}

function applyTaskPatch(target: RawProjectTask, input: OpenClawTaskUpdateInput) {
  if (input.agentId !== undefined) {
    if (target.owner !== undefined && target.role === undefined) {
      target.owner = input.agentId || undefined;
    } else {
      target.role = input.agentId || undefined;
    }
  }

  if (input.agentName !== undefined) {
    target.agent = input.agentName || undefined;
  }

  if (input.title !== undefined) {
    if (target.title !== undefined && target.task === undefined) {
      target.title = input.title || target.title;
    } else {
      target.task = input.title || target.task;
    }
  }

  if (input.progress !== undefined) {
    target.progress = clampProgress(input.progress);
  }

  if (input.status) {
    target.status = toTaskStatusLabel(input.status, target.progress ?? 0);
  }

  if (input.blockers) {
    target.blockers = input.blockers.map((item) => item.trim()).filter(Boolean);
  }

  if (input.deadline !== undefined) {
    target.deadline = input.deadline || undefined;
  }
}

async function persistProjectTasksPayload(tasksPath: string, payload: RawProjectTasksPayload) {
  payload.last_updated = new Date().toISOString();
  payload.blockers_summary = buildBlockerSummary(payload.tasks ?? []);
  await writeFile(tasksPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function buildBlockerSummary(tasks: Array<{ agent?: string; role?: string; owner?: string; blockers?: string[] }>) {
  const summary: Record<string, string[]> = {};

  for (const task of tasks) {
    const blockers = (task.blockers ?? []).filter(Boolean);
    if (blockers.length === 0) {
      continue;
    }

    const key = task.agent || task.role || task.owner || "unknown";
    summary[key] = blockers;
  }

  return summary;
}

function toStatusFinding(
  finding: {
    checkId?: string;
    severity?: string;
    title?: string;
    detail?: string;
    remediation?: string;
  },
  index: number
): OpenClawStatusFinding {
  return {
    id: finding.checkId || `finding-${index + 1}`,
    severity: normalizeSeverity(finding.severity),
    title: String(finding.title ?? "系统告警"),
    detail: String(finding.detail ?? ""),
    remediation: finding.remediation ? String(finding.remediation) : undefined
  };
}

function normalizeSeverity(value?: string): OpenClawFindingSeverity {
  if (value === "critical") {
    return "critical";
  }

  if (value === "warn" || value === "warning") {
    return "warn";
  }

  return "info";
}

function clampProgress(value: unknown) {
  const numberValue = Number(value ?? 0);
  if (!Number.isFinite(numberValue)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(numberValue)));
}

function inferProgressFromStatus(statusLabel: string) {
  const normalized = statusLabel.toLowerCase();

  if (normalized.includes("done") || normalized.includes("完成")) {
    return 100;
  }

  if (normalized.includes("progress") || normalized.includes("进行")) {
    return 35;
  }

  if (normalized.includes("blocked") || normalized.includes("阻塞")) {
    return 15;
  }

  return 0;
}

function getMinutesSinceActive(timestamp?: string) {
  if (!timestamp) {
    return undefined;
  }

  const delta = Date.now() - new Date(timestamp).getTime();
  if (!Number.isFinite(delta) || delta < 0) {
    return 0;
  }

  return Math.round(delta / 60_000);
}

function deriveSlaState(taskCount: number, minutesSinceActive?: number): OpenClawSlaState {
  if (minutesSinceActive === undefined) {
    return taskCount > 0 ? "stale" : "healthy";
  }

  if (minutesSinceActive <= 30) {
    return "healthy";
  }

  if (minutesSinceActive <= 120) {
    return "warning";
  }

  return taskCount > 0 ? "stale" : "warning";
}

function compareSlaItems(left: OpenClawAgentSlaItem, right: OpenClawAgentSlaItem) {
  const priority = { stale: 0, warning: 1, healthy: 2 } as const;
  const stateDelta = priority[left.slaState] - priority[right.slaState];
  if (stateDelta !== 0) {
    return stateDelta;
  }

  return (right.minutesSinceActive ?? -1) - (left.minutesSinceActive ?? -1);
}

function projectStatusText(status: OpenClawProjectState) {
  switch (status) {
    case "active":
      return "进行中";
    case "blocked":
      return "阻塞中";
    case "completed":
      return "已完成";
    default:
      return "规划中";
  }
}

function agentStatusText(status: OpenClawAgentPresence) {
  switch (status) {
    case "active":
      return "活跃";
    case "attention":
      return "需关注";
    case "idle":
      return "待命";
    default:
      return "离线";
  }
}

function isRecent(timestamp: string, minutes: number) {
  return Date.now() - new Date(timestamp).getTime() <= minutes * 60 * 1000;
}

function resolveWorkspaceForAgent(agentId: string) {
  if (agentId === "main") {
    return OPENCLAW_WORKSPACE_ROOT;
  }

  const candidate = path.join(OPENCLAW_WORKSPACE_ROOT, "agents", agentId);
  return existsSync(candidate) ? candidate : "";
}

function isRemovableAgentWorkspacePath(workspacePath: string | undefined, agentId: string) {
  const raw = String(workspacePath ?? "").trim();
  if (!raw) {
    return false;
  }

  const resolvedWorkspace = path.resolve(raw);
  const safeBase = path.resolve(path.join(OPENCLAW_WORKSPACE_ROOT, "agents", agentId));
  return resolvedWorkspace === safeBase;
}

function humanizeAgentId(agentId: string) {
  return agentId
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function encodeProjectId(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeProjectId(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sanitizeWorkspaceSegment(value: string) {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return normalized || "project";
}

async function writeTextFileIfChanged(filePath: string, content: string) {
  const normalizedContent = content.endsWith("\n") ? content : `${content}\n`;
  try {
    const current = await readFile(filePath, "utf8");
    if (current === normalizedContent) {
      return;
    }
  } catch {
    // ignore read failures and write the file below
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, normalizedContent, "utf8");
}

async function createFileIfMissing(filePath: string, content: string) {
  try {
    await stat(filePath);
    return;
  } catch {
    await writeTextFileIfChanged(filePath, content);
  }
}

async function collectOccWorkspaceEvidenceFiles(
  workspacePath: string,
  options?: { maxDepth?: number; maxFiles?: number }
) {
  const maxDepth = Math.max(1, Number(options?.maxDepth ?? 3));
  const maxFiles = Math.max(4, Number(options?.maxFiles ?? 18));
  const ignoredDirs = new Set([".git", "node_modules", "dist", "build", ".next", ".turbo", "coverage"]);
  const allowedExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".html", ".css", ".scss", ".prisma", ".yaml", ".yml"]);
  const evidence: string[] = [];

  async function walk(currentPath: string, depth: number): Promise<void> {
    if (evidence.length >= maxFiles || depth > maxDepth) {
      return;
    }

    let entries;
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));

    for (const entry of entries) {
      if (evidence.length >= maxFiles) {
        return;
      }

      const fullPath = path.join(currentPath, entry.name);
      const relativePath = normalizeRelativePath(path.relative(workspacePath, fullPath));
      if (!relativePath) {
        continue;
      }

      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name) && depth < maxDepth) {
          await walk(fullPath, depth + 1);
        }
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (!allowedExtensions.has(extension)) {
        continue;
      }
      if (/^(OCC_PROJECT_CONTEXT|CURRENT_STAGE)\.md$/i.test(entry.name)) {
        continue;
      }
      evidence.push(relativePath);
    }
  }

  await walk(workspacePath, 0);
  return evidence;
}

export async function ensureOccProjectWorkspace(input: {
  projectId: string;
  projectName: string;
  projectDescription: string;
  parsedIntent: {
    keywords: string[];
    constraints: string[];
    risks: string[];
    summary: string;
  };
  stageLabel: string;
  currentRoleLabel: string;
  taskTitles: string[];
  taskSummaries: Array<{ title: string; description?: string; status?: string; assignee?: string }>;
  expectedDeliverables: string[];
}) : Promise<OccProjectWorkspaceContext> {
  const directoryName = `${sanitizeWorkspaceSegment(input.projectId)}-${sanitizeWorkspaceSegment(input.projectName).slice(0, 48)}`;
  const workspacePath = path.join(OPENCLAW_WORKSPACE_ROOT, "occ-projects", directoryName);
  const relativePath = normalizeRelativePath(path.relative(OPENCLAW_WORKSPACE_ROOT, workspacePath));
  const contextFilePath = path.join(workspacePath, "OCC_PROJECT_CONTEXT.md");
  const stageNotePath = path.join(workspacePath, "CURRENT_STAGE.md");
  const tasksPath = path.join(workspacePath, "tasks.json");
  const requirementsPath = path.join(workspacePath, "requirements.md");
  const readmePath = path.join(workspacePath, "README.md");
  const appReadmePath = path.join(workspacePath, "app", "README.md");

  await mkdir(workspacePath, { recursive: true });

  await createFileIfMissing(readmePath, [
    `# ${input.projectName}`,
    "",
    "该目录由 OCC 为当前项目自动创建，供 OpenClaw Agent 在真实项目上下文中执行分析、设计、研发与验收。",
    "",
    "建议工作约定：",
    "- 业务实现代码放在 `app/` 目录或同级明确子目录中。",
    "- 阶段上下文查看 `CURRENT_STAGE.md`。",
    "- 原始需求与约束查看 `requirements.md` 与 `OCC_PROJECT_CONTEXT.md`。"
  ].join("\n"));

  await createFileIfMissing(requirementsPath, [
    `# ${input.projectName} 需求说明`,
    "",
    "## 项目摘要",
    input.parsedIntent.summary || input.projectDescription,
    "",
    "## 原始需求",
    input.projectDescription,
    "",
    "## 关键词",
    ...(input.parsedIntent.keywords.length > 0 ? input.parsedIntent.keywords.map((item) => `- ${item}`) : ["- 暂无"]),
    "",
    "## 约束",
    ...(input.parsedIntent.constraints.length > 0 ? input.parsedIntent.constraints.map((item) => `- ${item}`) : ["- 暂无"]),
    "",
    "## 风险",
    ...(input.parsedIntent.risks.length > 0 ? input.parsedIntent.risks.map((item) => `- ${item}`) : ["- 暂无"])
  ].join("\n"));

  await createFileIfMissing(appReadmePath, [
    "# app",
    "",
    "如果当前项目还没有业务代码，请从此目录开始创建最小可运行实现。",
    "",
    "最低要求：",
    "- 保留真实源码、配置文件与启动命令。",
    "- 能说明页面 / 路由、数据链路、验证方式与已知风险。",
    "- 所有实现与验证结果都要能回写到阶段交付物。"
  ].join("\n"));

  await writeTextFileIfChanged(contextFilePath, [
    `# ${input.projectName} OCC 项目上下文`,
    "",
    `- 项目 ID: ${input.projectId}`,
    `- 当前阶段: ${input.stageLabel}`,
    `- 当前负责人: ${input.currentRoleLabel}`,
    `- 目标交付物: ${input.expectedDeliverables.join("、") || "暂无"}`,
    "",
    "## 原始需求",
    input.projectDescription,
    "",
    "## 关键词",
    ...(input.parsedIntent.keywords.length > 0 ? input.parsedIntent.keywords.map((item) => `- ${item}`) : ["- 暂无"]),
    "",
    "## 约束",
    ...(input.parsedIntent.constraints.length > 0 ? input.parsedIntent.constraints.map((item) => `- ${item}`) : ["- 暂无"]),
    "",
    "## 风险",
    ...(input.parsedIntent.risks.length > 0 ? input.parsedIntent.risks.map((item) => `- ${item}`) : ["- 暂无"])
  ].join("\n"));

  await writeTextFileIfChanged(stageNotePath, [
    `# ${input.stageLabel} 阶段执行卡`,
    "",
    `- 当前负责人: ${input.currentRoleLabel}`,
    `- 阶段任务标题: ${input.taskTitles.join("、") || "暂无"}`,
    `- 本阶段目标交付物: ${input.expectedDeliverables.join("、") || "暂无"}`,
    "",
    "## 当前阶段任务",
    ...(input.taskSummaries.length > 0
      ? input.taskSummaries.map((task, index) => [
          `### ${index + 1}. ${task.title}`,
          `- 状态: ${task.status || "todo"}`,
          `- 负责人: ${task.assignee || "未分配"}`,
          `- 说明: ${task.description || "暂无补充说明"}`
        ].join("\n"))
      : ["- 当前暂无任务，请先补充后再推进。"]),
    "",
    "## 执行约束",
    "- 必须在该工作区内落真实文件、真实命令与真实验证结果。",
    "- 如果当前没有业务代码，可以在 `app/` 中从 0 开始创建最小可运行实现。",
    "- 交付物必须能回溯到本工作区中的真实文件与命令。"
  ].join("\n"));

  await writeTextFileIfChanged(tasksPath, JSON.stringify({
    project: {
      name: input.projectName,
      directory: relativePath,
      type: "occ-project",
      note: `${input.projectId} ${input.stageLabel}`
    },
    created: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    tasks: input.taskSummaries.map((task, index) => ({
      id: String(index + 1),
      title: task.title,
      agent: task.assignee || input.currentRoleLabel,
      task: task.description || task.title,
      progress: task.status === "done" ? 100 : task.status === "in_progress" ? 55 : task.status === "blocked" ? 15 : 0,
      status: task.status || "todo",
      deliverable: input.expectedDeliverables[index] || input.expectedDeliverables[0] || undefined,
      blockers: []
    }))
  }, null, 2));

  const evidenceFiles = await collectOccWorkspaceEvidenceFiles(workspacePath);
  return {
    workspacePath,
    relativePath,
    contextFilePath,
    stageNotePath,
    taskTitles: input.taskTitles,
    expectedDeliverables: input.expectedDeliverables,
    evidenceFiles
  };
}

function resolveProjectDir(projectId: string) {
  const decodedPath = decodeProjectId(projectId);

  // 安全验证：防止路径遍历攻击
  validateProjectPath(decodedPath);

  const resolvedPath = path.resolve(OPENCLAW_WORKSPACE_ROOT, ...decodedPath.split("/"));

  // 确保解析后的路径仍在工作区目录内
  if (!resolvedPath.startsWith(path.resolve(OPENCLAW_WORKSPACE_ROOT))) {
    throw new Error("路径遍历攻击检测：尝试访问工作区外部路径");
  }

  return resolvedPath;
}

function decodeTaskId(taskId: string) {
  const parts = taskId.split(":");
  return parts.at(-1) || taskId;
}

function normalizeRelativePath(value: string) {
  return value.split(path.sep).join("/");
}

function uniqueItems(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function dedupeStrings(values: string[]) {
  return [...new Set(values)];
}

function normalizeOpenClawBaseUrl(value: string | undefined) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

function isOfficialOpenAiBaseUrl(baseUrl: string) {
  return /^https:\/\/api\.openai\.com(?:\/v1)?$/i.test(baseUrl);
}

export function shouldRepairOpenAiProviderApi(provider?: {
  baseUrl?: string;
  api?: string;
} | null) {
  const api = String(provider?.api ?? "").trim().toLowerCase();
  const baseUrl = normalizeOpenClawBaseUrl(provider?.baseUrl);

  if (api !== "openai-responses" || !baseUrl) {
    return false;
  }

  return !isOfficialOpenAiBaseUrl(baseUrl);
}

export function normalizeOpenClawProviderApis(config: OpenClawConfig) {
  const repairs: Array<{
    provider: string;
    from: string;
    to: string;
    reason: string;
  }> = [];

  const openaiProvider = config.models?.providers?.openai;
  if (shouldRepairOpenAiProviderApi(openaiProvider)) {
    repairs.push({
      provider: "openai",
      from: String(openaiProvider?.api ?? "").trim() || "unknown",
      to: "openai-completions",
      reason: "non-official OpenAI compatible gateway does not expose /responses"
    });
    openaiProvider!.api = "openai-completions";
  }

  return {
    config,
    changed: repairs.length > 0,
    repairs
  };
}

async function repairOpenClawProviderApis() {
  const config = await readJsonFile<OpenClawConfig>(OPENCLAW_CONFIG_PATH);
  if (!config) {
    return {
      changed: false,
      repairs: [] as Array<{ provider: string; from: string; to: string; reason: string }>
    };
  }

  const normalized = normalizeOpenClawProviderApis(config);
  if (normalized.changed) {
    await writeJsonFile(OPENCLAW_CONFIG_PATH, normalized.config);
  }

  return normalized;
}

async function restartOpenClawGateway() {
  try {
    await execFileAsync(OPENCLAW_BIN, ["gateway", "restart"], {
      timeout: 20_000,
      maxBuffer: 1024 * 1024 * 4
    });
    return true;
  } catch {
    return false;
  }
}

function toAgentSummary(agent: OpenClawAgentDetail): OpenClawAgentSummary {
  return {
    agentId: agent.agentId,
    name: agent.name,
    emoji: agent.emoji,
    title: agent.title,
    responsibility: agent.responsibility,
    intro: agent.intro,
    model: agent.model,
    workspacePath: agent.workspacePath,
    agentDir: agent.agentDir,
    status: agent.status,
    lastActiveAt: agent.lastActiveAt,
    heartbeatEnabled: agent.heartbeatEnabled,
    activeSessionCount: agent.activeSessionCount,
    sessionCount: agent.sessionCount,
    taskCount: agent.taskCount,
    blockedTaskCount: agent.blockedTaskCount,
    allowedAgentIds: agent.allowedAgentIds,
    tools: agent.tools,
    soulPath: agent.soulPath,
    sopPath: agent.sopPath,
    availableModels: agent.availableModels,
    commander: agent.commander,
    usage: agent.usage,
    memoryEntryCount: agent.memoryEntryCount,
    currentTask: agent.currentTask
  };
}

function normalizeCommanderSettings(
  currentModel: string,
  stored?: {
    selectedModel?: string | null;
    defaultModel?: string | null;
    fallbackModel?: string | null;
    executionMode?: string | null;
    requireConfirmation?: boolean | null;
    autoApproveMinorSteps?: boolean | null;
    maxPromptTokens?: number | null;
    maxCompletionTokens?: number | null;
    maxDailyTokens?: number | null;
    memoryEnabled?: boolean | null;
    updatedAt?: Date | string | null;
  }
): OpenClawAgentCommanderSettings {
  const globalFallbacks = listGlobalFallbackModels();
  const selectedModel = pickPreferredModel([
    stored?.selectedModel ?? undefined,
    currentModel,
    stored?.defaultModel ?? undefined,
    stored?.fallbackModel ?? undefined,
    ...globalFallbacks
  ]);
  const defaultModel = pickPreferredModel([
    stored?.defaultModel ?? undefined,
    selectedModel,
    stored?.fallbackModel ?? undefined,
    ...globalFallbacks
  ], selectedModel);
  const fallbackModel = pickPreferredModel([
    stored?.fallbackModel ?? undefined,
    ...globalFallbacks
  ], selectedModel);
  const executionMode = stored?.executionMode === "autonomous" ? "autonomous" : "confirm_first";

  return {
    selectedModel,
    defaultModel,
    fallbackModel: fallbackModel === selectedModel ? undefined : fallbackModel,
    executionMode,
    requireConfirmation: stored?.requireConfirmation ?? executionMode !== "autonomous",
    autoApproveMinorSteps: stored?.autoApproveMinorSteps ?? executionMode === "autonomous",
    maxPromptTokens: normalizeNumericLimit(stored?.maxPromptTokens),
    maxCompletionTokens: normalizeNumericLimit(stored?.maxCompletionTokens),
    maxDailyTokens: normalizeNumericLimit(stored?.maxDailyTokens),
    memoryEnabled: stored?.memoryEnabled ?? true,
    updatedAt: stored?.updatedAt ? new Date(stored.updatedAt).toISOString() : undefined
  };
}

function buildModelCatalog(currentModel: string): OpenClawAgentModelOption[] {
  const curated = dedupeStrings([
    currentModel,
    ...recommendModelsByFamily(currentModel)
  ]);

  return curated.map((modelId, index) => ({
    id: modelId,
    label: humanizeModelLabel(modelId),
    tags: deriveModelTags(modelId),
    available: true,
    source: modelId === currentModel ? "current" : index < 3 ? "recommended" : "catalog"
  }));
}

function recommendModelsByFamily(currentModel: string) {
  const normalized = currentModel.toLowerCase();

  if (normalized.includes("gemini")) {
    return ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"];
  }

  if (normalized.includes("claude")) {
    return ["claude-sonnet-4-6", "claude-opus-4-6", "claude-3-5-haiku-20241022"];
  }

  if (normalized.includes("gpt") || normalized.includes("o3") || normalized.includes("o4")) {
    return ["gpt-5.4", "gpt-5.3-codex", "kimi-k2.5"];
  }

  if (normalized.includes("qwen")) {
    return ["qwen-max", "qwen-plus", "qwen2.5-coder-32b-instruct"];
  }

  return ["gpt-5.4", "gpt-5.3-codex", "kimi-k2.5"];
}

function humanizeModelLabel(modelId: string) {
  return modelId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => (/^\d/.test(part) ? part : part[0]?.toUpperCase() + part.slice(1)))
    .join(" ");
}

function deriveModelTags(modelId: string) {
  const normalized = modelId.toLowerCase();
  const tags = new Set<string>();

  if (normalized.includes("flash") || normalized.includes("mini") || normalized.includes("haiku")) {
    tags.add("speed");
  }
  if (normalized.includes("pro") || normalized.includes("opus") || normalized.includes("gpt-5") || normalized.includes("o3")) {
    tags.add("reasoning");
  }
  if (normalized.includes("multimodal") || normalized.includes("gemini")) {
    tags.add("multimodal");
  }
  if (normalized.includes("mini") || normalized.includes("flash-lite") || normalized.includes("haiku")) {
    tags.add("cost");
  }

  if (tags.size === 0) {
    tags.add("general");
  }

  return [...tags];
}

function normalizeModelId(value?: string) {
  const model = String(value ?? "").trim();
  return model || undefined;
}

function isRoutingPlaceholderModel(value?: string) {
  const model = normalizeModelId(value);
  if (!model) {
    return true;
  }
  const normalized = model.toLowerCase();
  return MODEL_ROUTING_PLACEHOLDERS.has(normalized) || normalized.startsWith("runtime-");
}

function normalizeModelForRouting(value?: string) {
  const model = normalizeModelId(value);
  if (!model) {
    return undefined;
  }
  if (isRoutingPlaceholderModel(model)) {
    return undefined;
  }
  return model;
}

function parseCsvModels(value?: string) {
  return String(value ?? "")
    .split(",")
    .map((item) => normalizeModelForRouting(item))
    .filter((item): item is string => Boolean(item));
}

export function prioritizeFallbackModels(models: string[], options?: { preferOpenAi?: boolean }) {
  const preferOpenAi = options?.preferOpenAi !== false;
  if (!preferOpenAi) {
    return dedupeStrings(models);
  }

  const rank = (model: string) => {
    const normalized = normalizeModelForRouting(model)?.toLowerCase() ?? "";
    if (normalized.startsWith("openai/gpt-5.4")) {
      return 0;
    }
    if (normalized.startsWith("openai/gpt-5.3-codex")) {
      return 1;
    }
    if (normalized.startsWith("openai/")) {
      return 2;
    }
    if (normalized.startsWith("anthropic/")) {
      return 3;
    }
    if (normalized.startsWith("minima/")) {
      return 4;
    }
    return 5;
  };

  return dedupeStrings(models).slice().sort((left, right) => rank(left) - rank(right));
}

function listGlobalFallbackModels() {
  return prioritizeFallbackModels([
    ...parseCsvModels(process.env.OPENCLAW_CLAUDE_CODE_DEV_MODELS),
    normalizeModelForRouting(process.env.OPENCLAW_AGENT_FALLBACK_MODEL),
    ...HARD_FALLBACK_MODELS.map((item) => normalizeModelForRouting(item)),
  ].filter((item): item is string => Boolean(item)));
}

function listGroupFallbackModels(errorText: string) {
  if (/group\s+claude_code/i.test(errorText)) {
    return dedupeStrings([
      ...parseCsvModels(process.env.OPENCLAW_CLAUDE_CODE_DEV_MODELS),
      "anthropic/claude-sonnet-4-6",
      "claude-sonnet-4-6",
      "claude-3-5-haiku-20241022",
    ].map((item) => normalizeModelForRouting(item)).filter((item): item is string => Boolean(item)));
  }
  return [] as string[];
}

function pickPreferredModel(candidates: Array<string | undefined>, fallback?: string) {
  for (const candidate of candidates) {
    const resolved = normalizeModelForRouting(candidate);
    if (resolved) {
      return resolved;
    }
  }

  const fallbackResolved = normalizeModelForRouting(fallback);
  if (fallbackResolved) {
    return fallbackResolved;
  }

  return listGlobalFallbackModels()[0] || "minima/MiniMax-M2.7-highspeed";
}

function extractOpenClawGatewayError(raw: string) {
  const normalizedRaw = String(raw || "").trim();
  if (!normalizedRaw) {
    return null;
  }

  const knownTextErrorPatterns = [
    /HTTP\s+\d{3}\s+(?:new_api_error|bad_response_status_code):[^\n]+/i,
    /Gateway agent failed; falling back to embedded:[^\n]+/i,
    /FallbackSummaryError:[^\n]+/i,
    /session file locked[^\n]*/i,
    /locked \(timeout[^\n]*/i,
    /no available channel[^\n]*/i,
    /unsupported model[^\n]*/i,
    /model not found[^\n]*/i,
    /auth status failed[^\n]*/i,
    /request timeout[^\n]*/i,
    /relay service error[^\n]*/i
  ] as const;

  for (const pattern of knownTextErrorPatterns) {
    const match = normalizedRaw.match(pattern);
    if (match?.[0]) {
      return match[0].trim();
    }
  }

  const payloadMatch = normalizedRaw.match(/HTTP\s+\d{3}\s+(?:new_api_error|bad_response_status_code):[^\n]+/i);
  if (payloadMatch?.[0]) {
    return payloadMatch[0].trim();
  }

  try {
    const parsed = parseOpenClawJson(normalizedRaw);
    const textPayload = Array.isArray(parsed?.result?.payloads)
      ? parsed.result.payloads
          .map((item) => String(item?.text ?? "").trim())
          .find((text) =>
            /HTTP\s+\d{3}\s+(?:new_api_error|bad_response_status_code)|no available channel|unsupported model|model not found|auth status failed|request timeout|relay service error/i.test(text)
          )
      : "";
    if (textPayload) {
      return textPayload;
    }

    const stopReason = String(parsed?.result?.meta?.stopReason ?? "").trim().toLowerCase();
    if (stopReason === "error") {
      return "OpenClaw returned stopReason=error";
    }
  } catch {
    // ignore parse failures here; caller can still rely on stderr/exit code
  }

  return null;
}

function estimateTokenCount(text: string) {
  const normalized = text.trim();
  if (!normalized) {
    return 0;
  }

  return Math.max(1, Math.ceil(normalized.length / 4));
}

function enforceTokenBudgets(
  settings: OpenClawAgentCommanderSettings,
  usage: OpenClawAgentUsageSummary,
  estimatedPromptTokens: number
) {
  if (settings.maxPromptTokens && estimatedPromptTokens > settings.maxPromptTokens) {
    throw new Error(`Prompt token estimate ${estimatedPromptTokens} exceeds limit ${settings.maxPromptTokens}`);
  }

  if (settings.maxDailyTokens && usage.totalTokensToday + estimatedPromptTokens > settings.maxDailyTokens) {
    throw new Error(`Daily token budget exceeded for agent: ${usage.totalTokensToday + estimatedPromptTokens} / ${settings.maxDailyTokens}`);
  }
}

function normalizeNumericLimit(value?: number | null, fallback?: number) {
  if (value === null) {
    return undefined;
  }

  if (value === undefined) {
    return fallback;
  }

  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return undefined;
  }

  return Math.round(numberValue);
}

const DEFAULT_OPENCLAW_AGENT_TOKEN_LIMIT = 100_000_000;

function buildUsageSummary(
  usageLogs: Array<{ promptTokens: number; completionTokens: number; totalTokens: number; createdAt: Date }>,
  dailyLimit?: number
): OpenClawAgentUsageSummary {
  const promptTokensToday = usageLogs.reduce((sum, item) => sum + item.promptTokens, 0);
  const completionTokensToday = usageLogs.reduce((sum, item) => sum + item.completionTokens, 0);
  const totalTokensToday = usageLogs.reduce((sum, item) => sum + item.totalTokens, 0);
  const lastUsedAt = usageLogs[0]?.createdAt?.toISOString();

  return {
    promptTokensToday,
    completionTokensToday,
    totalTokensToday,
    requestCountToday: usageLogs.length,
    dailyLimit,
    remainingDailyTokens: dailyLimit ? Math.max(0, dailyLimit - totalTokensToday) : undefined,
    lastUsedAt
  };
}

function toUsageLogEntry(entry: {
  id: string;
  agentId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  status: string;
  commandType: string;
  createdAt: Date;
}): OpenClawAgentUsageLogEntry {
  return {
    id: entry.id,
    agentId: entry.agentId,
    model: entry.model,
    promptTokens: entry.promptTokens,
    completionTokens: entry.completionTokens,
    totalTokens: entry.totalTokens,
    status: entry.status,
    commandType: entry.commandType,
    createdAt: entry.createdAt.toISOString()
  };
}

function toMemoryEntry(entry: {
  id: string;
  agentId: string;
  projectId: string | null;
  type: string;
  summary: string;
  content: string;
  importance: number;
  tags: unknown;
  source: string | null;
  lastAccessedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): OpenClawAgentMemoryEntry {
  return {
    id: entry.id,
    agentId: entry.agentId,
    projectId: entry.projectId || undefined,
    type: normalizeMemoryType(entry.type),
    summary: entry.summary,
    content: entry.content,
    importance: entry.importance,
    tags: Array.isArray(entry.tags) ? entry.tags.map((item) => String(item)) : [],
    source: entry.source || undefined,
    lastAccessedAt: entry.lastAccessedAt.toISOString(),
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString()
  };
}

function normalizeMemoryType(value?: string) {
  switch (value) {
    case "fact":
    case "preference":
    case "workflow":
    case "project":
    case "reflection":
      return value;
    default:
      return "fact";
  }
}

function clampImportance(value?: number) {
  const parsed = Number(value ?? 50);
  if (!Number.isFinite(parsed)) {
    return 50;
  }

  return Math.max(1, Math.min(100, Math.round(parsed)));
}

function sanitizeAgentId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function normalizeStringArray(values?: string[] | null) {
  if (!values) {
    return [];
  }

  return dedupeStrings(
    values
      .map((item) => String(item).trim())
      .filter(Boolean)
  );
}

function jsonArrayToStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.map((item) => String(item));
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

async function ensureManagedAgentConfigExists(
  agentId: string,
  displayName: string,
  title: string,
  model: string
) {
  const isDesignAgent = isDesignAgentProfile(`${agentId} ${displayName} ${title}`);
  const designPrimaryModel = normalizeModelForRouting(process.env.DESIGN_MODEL) || DESIGN_MODEL_PRIMARY;
  const designFallbackModel =
    normalizeModelForRouting(process.env.DESIGN_FALLBACK_MODEL)
    || DESIGN_MODEL_FALLBACKS[0];
  const selectedModel = isDesignAgent
    ? pickPreferredModel([
        designPrimaryModel,
        model,
        designFallbackModel,
        ...listGlobalFallbackModels()
      ])
    : pickPreferredModel([
        model,
        ...listGlobalFallbackModels()
      ]);

  await prisma.managedAgentConfig.upsert({
    where: { agentId },
    create: {
      agentId,
      displayName,
      title,
      intro: undefined,
      responsibility: undefined,
      selectedModel,
      defaultModel: selectedModel,
      fallbackModel: isDesignAgent ? designFallbackModel : undefined,
      executionMode: "confirm_first",
      requireConfirmation: true,
      autoApproveMinorSteps: false,
      maxPromptTokens: DEFAULT_OPENCLAW_AGENT_TOKEN_LIMIT,
      maxCompletionTokens: null,
      maxDailyTokens: DEFAULT_OPENCLAW_AGENT_TOKEN_LIMIT,
      memoryEnabled: true,
      allowedAgentIds: [],
      toolAllowlist: []
    },
    update: {
      displayName,
      title,
      selectedModel,
      fallbackModel: isDesignAgent ? designFallbackModel : undefined
    }
  });
}

async function syncAgentIdentityFile(
  workspacePath: string,
  input: {
    name: string;
    title?: string;
    intro?: string;
  }
) {
  const targetPath = path.join(workspacePath, "IDENTITY.md");
  const existing = await readTextFile(targetPath);
  const identity = parseIdentity(existing);
  const lines = [
    `# ${input.name}`,
    "",
    `- title: ${input.title || identity.title || "Agent"}`,
    ...(input.intro ? [`- intro: ${input.intro}`] : []),
    `- vibe: ${identity.vibe || "Professional, calm, and execution-oriented"}`,
    `- agent_id: ${identity.agentId || path.basename(workspacePath)}`
  ];

  await mkdir(workspacePath, { recursive: true });
  await writeFile(targetPath, `${lines.join("\n")}\n`, "utf8");
}

function classifyInstruction(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("design") || message.includes("设计") || message.includes("原型")) {
    return "design";
  }
  if (normalized.includes("fix") || message.includes("修复") || message.includes("排查")) {
    return "fix";
  }
  if (normalized.includes("report") || message.includes("汇报") || message.includes("同步")) {
    return "report";
  }
  if (normalized.includes("analy") || message.includes("分析") || message.includes("拆解")) {
    return "analysis";
  }

  return "execution";
}

function buildInstructionPlan(agentName: string, instructionType: string, projectHint: string) {
  const projectLine = projectHint ? `结合当前上下文 ${projectHint} 校准范围与边界` : "先对需求范围、上下文和目标边界做快速澄清";

  switch (instructionType) {
    case "design":
      return [
        `${agentName} 先梳理页面目标、核心模块与交互重点`,
        projectLine,
        "输出可执行的界面结构与视觉方向"
      ];
    case "fix":
      return [
        `${agentName} 先定位问题影响范围与复现条件`,
        projectLine,
        "提出修复路径并准备验证回归风险"
      ];
    case "report":
      return [
        `${agentName} 汇总当前任务、阻塞点与下一步动作`,
        projectLine,
        "形成一份适合快速审批的同步结果"
      ];
    case "analysis":
      return [
        `${agentName} 对指令进行拆解并识别关键约束`,
        projectLine,
        "给出执行步骤、风险和建议路径"
      ];
    default:
      return [
        `${agentName} 先明确交付目标、优先级和成功标准`,
        projectLine,
        "确认后进入执行并同步结果"
      ];
  }
}

function buildInstructionSteps(agentName: string, instructionType: string, projectHint: string) {
  const shared = [
    "确认目标与边界",
    "识别依赖与风险",
    "执行并回传阶段结果"
  ];

  if (instructionType === "design") {
    return [
      `${agentName} 梳理页面目标与用户路径`,
      projectHint ? `对照 ${projectHint} 校准信息架构` : "校准信息架构与主次关系",
      "输出页面模块、交互和视觉建议"
    ];
  }

  if (instructionType === "report") {
    return [
      "汇总当前进展与阻塞项",
      "归纳下一步动作和待确认点",
      "输出简明同步结果"
    ];
  }

  return shared;
}

function buildInstructionRisks(
  message: string,
  projectHint: string,
  instructionType: string,
  executionMode: OpenClawExecutionMode
) {
  const risks = [
    message.length < 16 ? "指令相对简短，目标边界可能仍有歧义。" : "",
    !projectHint ? "当前没有明确关联的结构化任务，执行前需要再次确认上下文。" : "",
    instructionType === "fix" ? "修复类任务可能引入回归，建议补充验证标准。" : "",
    executionMode === "autonomous" ? "当前 Agent 处于自主执行模式，需要特别留意高风险动作的升级机制。" : ""
  ].filter(Boolean);

  return risks.length > 0 ? risks : ["暂未识别到明显高风险项，但仍建议在关键里程碑同步结果。"];
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function switchAgentModelForRetry(
  agentId: string,
  model: string,
  options?: { explicitFallbacks?: string[] }
) {
  const config = await readJsonFile<OpenClawConfig>(OPENCLAW_CONFIG_PATH);
  if (!config?.agents?.list?.length) {
    throw new Error("OpenClaw config missing agents.list");
  }

  const target = config.agents.list.find((item) => item.id === agentId);
  if (!target) {
    throw new Error(`Agent ${agentId} not found in OpenClaw config`);
  }

  const normalizedModel = normalizeModelForRouting(model);
  const currentPrimaryModel = resolveAgentConfiguredPrimaryModel(target.model);
  if (!normalizedModel || currentPrimaryModel === normalizedModel) {
    return;
  }

  const explicitFallbacks = options?.explicitFallbacks;
  target.model = buildOpenClawAgentModelConfig(
    normalizedModel,
    explicitFallbacks ?? resolveAgentConfiguredFallbackModels(target.model),
    explicitFallbacks ? { forceObject: true } : undefined
  );
  await writeJsonFile(OPENCLAW_CONFIG_PATH, config);

  await prisma.managedAgentConfig.upsert({
    where: { agentId },
    create: {
      agentId,
      selectedModel: normalizedModel,
      defaultModel: normalizedModel,
      fallbackModel: normalizedModel,
      maxPromptTokens: DEFAULT_OPENCLAW_AGENT_TOKEN_LIMIT,
      maxCompletionTokens: null,
      maxDailyTokens: DEFAULT_OPENCLAW_AGENT_TOKEN_LIMIT
    },
    update: {
      selectedModel: normalizedModel
    }
  });

  await syncOpenClawAgentMainSessionRuntimeModel(agentId, normalizedModel);
}

async function restoreAgentSelectedModel(agentId: string, model: string) {
  const config = await readJsonFile<OpenClawConfig>(OPENCLAW_CONFIG_PATH);
  if (!config?.agents?.list?.length) {
    throw new Error("OpenClaw config missing agents.list");
  }

  const target = config.agents.list.find((item) => item.id === agentId);
  if (!target) {
    throw new Error(`Agent ${agentId} not found in OpenClaw config`);
  }

  const normalizedModel = normalizeModelForRouting(model);
  if (!normalizedModel) {
    return;
  }

  if (resolveAgentConfiguredPrimaryModel(target.model) !== normalizedModel) {
    target.model = buildOpenClawAgentModelConfig(
      normalizedModel,
      resolveAgentConfiguredFallbackModels(target.model)
    );
    await writeJsonFile(OPENCLAW_CONFIG_PATH, config);
  }

  await prisma.managedAgentConfig.updateMany({
    where: { agentId },
    data: {
      selectedModel: normalizedModel
    }
  });

  await syncOpenClawAgentMainSessionRuntimeModel(agentId, normalizedModel);
}

async function syncOpenClawAgentMainSessionRuntimeModel(agentId: string, model: string) {
  const normalizedModel = normalizeModelForRouting(model);
  if (!normalizedModel) {
    return false;
  }

  const sessionStorePath = path.join(OPENCLAW_ROOT, "agents", agentId, "sessions", "sessions.json");
  const sessionStore = await readJsonFile<Record<string, SessionRecord>>(sessionStorePath);
  if (!sessionStore) {
    return false;
  }

  const result = applyOpenClawAgentMainSessionModelSync(sessionStore, {
    agentId,
    model: normalizedModel
  });
  if (!result.changed) {
    return false;
  }

  await writeJsonFile(sessionStorePath, result.sessionStore);
  return true;
}

async function readTextFile(filePath: string) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, payload: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function readDirSafe(directoryPath: string) {
  try {
    return await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function readLastChunk(filePath: string, maxBytes: number) {
  const handle = await open(filePath, "r");

  try {
    const stats = await handle.stat();
    const size = Math.min(maxBytes, stats.size);
    const start = Math.max(0, stats.size - size);
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, start);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

function sanitizeOpenClawJsonRaw(raw: string) {
  return String(raw || "")
    .replace(/\u0000/g, "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .trim();
}

function extractJsonObjectCandidates(raw: string) {
  const candidates: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth === 0) {
        continue;
      }
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(raw.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return candidates;
}

function tryParseJsonObjectCandidate(raw: string) {
  const candidate = sanitizeOpenClawJsonRaw(raw);
  if (!candidate) {
    return null;
  }
  if (!isValidJsonStructure(candidate)) {
    return null;
  }

  try {
    const parsed = JSON.parse(candidate);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseOpenClawJson(raw: string) {
  const normalizedRaw = sanitizeOpenClawJsonRaw(raw);

  // 安全验证输入
  if (!normalizedRaw || normalizedRaw.length > 10 * 1024 * 1024) { // 限制最大10MB
    throw new Error("OpenClaw command returned invalid or too large payload");
  }

  const directParsed = tryParseJsonObjectCandidate(normalizedRaw);
  if (directParsed) {
    return directParsed as {
      status?: string;
      summary?: string;
      result?: {
        payloads?: Array<{ text?: string; usage?: unknown; [key: string]: unknown }>;
        meta?: {
          durationMs?: number;
          stopReason?: string;
          usage?: unknown;
          tokenUsage?: unknown;
          agentMeta?: {
            sessionId?: string;
            provider?: string;
            model?: string;
            usage?: unknown;
            [key: string]: unknown;
          };
          [key: string]: unknown;
        };
        usage?: unknown;
        [key: string]: unknown;
      };
      usage?: unknown;
      [key: string]: unknown;
    };
  }

  const candidates = extractJsonObjectCandidates(normalizedRaw);
  if (candidates.length === 0) {
    throw new Error("OpenClaw command returned no JSON payload");
  }

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const jsonStr = candidates[index];
    if (jsonStr.length > 5 * 1024 * 1024) {
      continue;
    }
    const parsed = tryParseJsonObjectCandidate(jsonStr);
    if (!parsed) {
      continue;
    }
    return parsed as {
      status?: string;
      summary?: string;
      result?: {
        payloads?: Array<{ text?: string; usage?: unknown; [key: string]: unknown }>;
        meta?: {
          durationMs?: number;
          stopReason?: string;
          usage?: unknown;
          tokenUsage?: unknown;
          agentMeta?: {
            sessionId?: string;
            provider?: string;
            model?: string;
            usage?: unknown;
            [key: string]: unknown;
          };
          [key: string]: unknown;
        };
        usage?: unknown;
        [key: string]: unknown;
      };
      usage?: unknown;
      [key: string]: unknown;
    };
  }

  throw new Error("Failed to parse OpenClaw JSON: no valid JSON object found in mixed output");
}

function extractTokenUsageFromPayload(payload: ReturnType<typeof parseOpenClawJson>) {
  const asRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  const toInt = (value: unknown) => {
    const numeric = Number(value ?? 0);
    return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
  };

  const result = asRecord(payload?.result);
  const meta = asRecord(result?.meta);
  const agentMeta = asRecord(meta?.agentMeta);
  const firstPayloadUsage = (() => {
    const payloads = Array.isArray(result?.payloads) ? result.payloads : [];
    for (const item of payloads) {
      const usage = asRecord(asRecord(item)?.usage);
      if (usage) {
        return usage;
      }
    }
    return null;
  })();

  const candidates = [
    asRecord(result?.usage),
    asRecord(meta?.usage),
    asRecord(meta?.tokenUsage),
    asRecord(agentMeta?.usage),
    asRecord(payload?.usage),
    firstPayloadUsage
  ].filter((item): item is Record<string, unknown> => item !== null);

  for (const usage of candidates) {
    const promptTokens = toInt(
      usage.promptTokens
      ?? usage.prompt_tokens
      ?? usage.inputTokens
      ?? usage.input_tokens
      ?? usage.input
    );
    const cachedPromptTokens = toInt(
      usage.cachedInputTokens
      ?? usage.cached_input_tokens
      ?? usage.cacheRead
      ?? usage.cache_read_input_tokens
      ?? usage.cache_creation_input_tokens
      ?? usage.cacheWrite
      ?? usage.cache_write_input_tokens
    );
    const completionTokens = toInt(
      usage.completionTokens
      ?? usage.completion_tokens
      ?? usage.outputTokens
      ?? usage.output_tokens
      ?? usage.output
    );
    const totalFromPayload = toInt(
      usage.totalTokens
      ?? usage.total_tokens
      ?? usage.total
    );

    const normalizedPromptTokens = promptTokens + cachedPromptTokens;
    const normalizedTotalTokens = Math.max(
      totalFromPayload,
      normalizedPromptTokens + completionTokens
    );

    if (normalizedTotalTokens <= 0 && normalizedPromptTokens <= 0 && completionTokens <= 0) {
      continue;
    }

    return {
      promptTokens: normalizedPromptTokens,
      completionTokens,
      totalTokens: normalizedTotalTokens
    };
  }

  return null;
}

function extractAgentReplyFromRaw(raw: string) {
  const matches = [...raw.matchAll(/"text"\s*:\s*"((?:\\.|[^"\\])*)"/g)];
  const texts = matches
    .map((match) => decodeJsonString(match[1] ?? ""))
    .map((text) => text.trim())
    .filter(Boolean);

  return texts.join("\n\n");
}

function extractJsonStringField(raw: string, field: string) {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(new RegExp(`"${escapedField}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "m"));
  return match ? decodeJsonString(match[1]) : undefined;
}

function decodeJsonString(value: string) {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

export function parseOpenClawStatusJson(raw: string) {
  const parsed = tryParseJsonObjectCandidate(sanitizeOpenClawJsonRaw(raw))
    ?? extractJsonObjectCandidates(sanitizeOpenClawJsonRaw(raw))
      .map((candidate) => tryParseJsonObjectCandidate(candidate))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .at(-1);

  if (!parsed) {
    throw new Error("OpenClaw status returned no JSON payload");
  }

  return parsed as {
    runtimeVersion?: string;
    heartbeat?: {
      defaultAgentId?: string;
      agents?: Array<{ agentId: string; enabled: boolean }>;
    };
    channelSummary?: string[];
    queuedSystemEvents?: unknown[];
    sessions?: { count?: number };
    diagnostics?: {
      findings?: Array<{
        checkId?: string;
        severity?: string;
        title?: string;
        detail?: string;
        remediation?: string;
      }>;
    };
    securityAudit?: {
      findings?: Array<{
        checkId?: string;
        severity?: string;
        title?: string;
        detail?: string;
        remediation?: string;
      }>;
    };
    secretDiagnostics?: unknown[];
  };
}

/**
 * 验证命令输入参数，防止命令注入攻击
 */
function validateCommandInput(input: string, options?: { allowMultiline?: boolean }) {
  if (!input) {
    throw new Error("输入参数不能为空");
  }

  // 长度限制
  if (input.length > 50000) {
    throw new Error("输入参数长度超过限制 (50000 字符)");
  }

  // 检查危险字符
  const dangerousChars = [';', '&', '|', '$', '`', '<', '>'];
  if (!options?.allowMultiline) {
    dangerousChars.push('\n', '\r');
  }
  for (const char of dangerousChars) {
    if (input.includes(char)) {
      throw new Error(`输入参数不能包含危险字符: ${char}`);
    }
  }

  // 检查危险模式
  const dangerousPatterns = [
    /\$\(/,           // 命令替换 $()
    /`.*`/,           // 反引号命令执行
    /\|\s*\w+/,       // 管道命令
    /;\s*\w+/,        // 分号分隔的命令
    /&&\s*\w+/,       // AND 连接的命令
    /\|\|\s*\w+/,     // OR 连接的命令
    />\s*\/|>\s*\w/,  // 重定向
    /<\s*\/|<\s*\w/   // 输入重定向
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(input)) {
      throw new Error("输入参数包含可疑的命令注入模式");
    }
  }
}

/**
 * 验证项目路径，防止路径遍历攻击
 */
function validateProjectPath(projectPath: string) {
  if (!projectPath) {
    throw new Error("项目路径不能为空");
  }

  // 长度限制
  if (projectPath.length > 500) {
    throw new Error("项目路径长度超过限制 (500 字符)");
  }

  // 检查路径遍历模式
  const dangerousPatterns = [
    /\.\./,           // 相对路径遍历
    /\/\./,           // 当前目录引用
    /^\//,            // 绝对路径
    /^~/,             // 用户目录
    /\0/,             // 空字节
    /[<>"|*?]/,       // 特殊字符
    /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i  // Windows 保留名称
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(projectPath)) {
      throw new Error("项目路径包含不安全的模式");
    }
  }

  // 检查路径组件
  const pathComponents = projectPath.split(/[/\\]/);
  for (const component of pathComponents) {
    if (component === '' || component === '.' || component === '..') {
      throw new Error("项目路径包含不安全的路径组件");
    }
  }
}

/**
 * 验证JSON结构的基本合法性
 */
function isValidJsonStructure(raw: string): boolean {
  // 基本长度检查
  if (raw.length < 2) {
    return false;
  }

  // 检查是否包含基本的JSON结构字符
  const hasOpenBrace = raw.includes("{");
  const hasCloseBrace = raw.includes("}");

  if (!hasOpenBrace || !hasCloseBrace) {
    return false;
  }

  // 验证大括号数量平衡（简单检查）
  let braceCount = 0;
  for (const char of raw) {
    if (char === '{') braceCount++;
    if (char === '}') braceCount--;
    if (braceCount < 0) return false; // 出现多余的结束括号
  }

  // 最终括号数量应该平衡
  if (braceCount !== 0) {
    return false;
  }

  // 检查是否包含可疑的脚本标签或函数调用
  const suspiciousPatterns = [
    /<script/i,
    /javascript:/i,
    /eval\s*\(/i,
    /function\s*\(/i,
    /__proto__/i,
    /constructor/i
  ];

  return !suspiciousPatterns.some(pattern => pattern.test(raw));
}
