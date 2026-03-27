import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  open,
  copyFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import type {
  OpenClawAgentDetail,
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
      model?: string;
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

  const currentModel = String(agentConfig.model ?? "").trim() || "unknown";
  const existingRecord = await prisma.managedAgentConfig.findUnique({ where: { agentId } });
  const existingSettings = normalizeCommanderSettings(currentModel, existingRecord ?? undefined);
  const nextSelectedModel = normalizeModelId(input.selectedModel) || existingSettings.selectedModel;
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

  agentConfig.model = nextSelectedModel;
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
    defaultModel: normalizeModelId(input.defaultModel) || existingSettings.defaultModel || nextSelectedModel,
    fallbackModel: normalizeModelId(input.fallbackModel) || existingSettings.fallbackModel,
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
  const message = String(input.message ?? "").trim();
  if (!message) {
    throw new Error("message is required");
  }

  // 安全验证：命令注入防护
  validateCommandInput(message);
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

  try {
    const result = await execFileAsync(OPENCLAW_BIN, [
      "agent",
      "--agent",
      agentId,
      "--message",
      message,
      "--json"
    ], {
      timeout: 10 * 60 * 1000,
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
          : "OpenClaw agent command failed";
    await prisma.agentUsageLog.create({
      data: {
        agentId,
        model: agent.commander.selectedModel,
        promptTokens: estimatedPromptTokens,
        completionTokens: 0,
        totalTokens: estimatedPromptTokens,
        status: "failed",
        commandType: classifyInstruction(message)
      }
    });
    throw new Error(detail || "OpenClaw agent command failed");
  }

  const raw = (stdout || stderr).trim();
  const payload = parseOpenClawJson(raw);
  const result = payload?.result;
  const replyFromPayload = Array.isArray(result?.payloads)
    ? result.payloads
        .map((item: { text?: string }) => String(item?.text ?? "").trim())
        .filter(Boolean)
        .join("\n\n")
    : "";
  const reply = replyFromPayload || extractAgentReplyFromRaw(raw);
  const ok = payload?.status === "ok" || raw.includes('"status": "ok"');
  const summary = String(payload?.summary ?? extractJsonStringField(raw, "summary") ?? "completed");
  const estimatedCompletionTokens = estimateTokenCount(reply);
  const model = result?.meta?.agentMeta?.model || agent.commander.selectedModel;

  await prisma.agentUsageLog.create({
    data: {
      agentId,
      model,
      promptTokens: estimatedPromptTokens,
      completionTokens: estimatedCompletionTokens,
      totalTokens: estimatedPromptTokens + estimatedCompletionTokens,
      status: ok ? "success" : "failed",
      commandType: classifyInstruction(message)
    }
  });

  return {
    ok,
    agentId,
    summary,
    sessionId: result?.meta?.agentMeta?.sessionId,
    model,
    provider: result?.meta?.agentMeta?.provider,
    durationMs: Number(result?.meta?.durationMs ?? 0) || undefined,
    reply
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
  const title = managedConfig?.title || team?.title || deriveTitleFromSoul(soul.content) || humanizeAgentId(agentConfig.id);
  const name = normalizeAgentDisplayName(
    managedConfig?.displayName || identity.name || team?.name || agentConfig.name || "",
    title,
    agentConfig.id
  );
  const responsibility = managedConfig?.responsibility || team?.responsibility || buildSoulIntro(soul.content);
  const intro = managedConfig?.intro || buildAgentIntro(soul.content, responsibility);
  const lastActiveAt = sessions[0]?.updatedAt;
  const status = deriveAgentPresence(lastActiveAt, tasks);
  const currentModel = String(agentConfig.model ?? "").trim() || "unknown";
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
    name: sanitizeIdentityValue(matchLooseIdentityValue(content, ["Name", "name"], /^#\s+(.+)$/m)),
    emoji: sanitizeIdentityValue(matchLooseIdentityValue(content, ["Emoji", "emoji"])),
    vibe: sanitizeIdentityValue(matchLooseIdentityValue(content, ["Vibe", "vibe"])),
    title: sanitizeIdentityValue(matchLooseIdentityValue(content, ["Title", "title"])),
    intro: sanitizeIdentityValue(matchLooseIdentityValue(content, ["Intro", "intro"])),
    agentId: sanitizeIdentityValue(matchLooseIdentityValue(content, ["Agent ID", "agent_id"]))
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
    value.includes("Fill this in")
  ) {
    return "";
  }

  return value.replace(/^_+\(?/, "").replace(/\)?_+$/, "").trim();
}

function normalizeAgentDisplayName(rawName: string, title: string, agentId: string) {
  const cleaned = rawName.trim();
  if (cleaned && cleaned !== agentId) {
    return cleaned;
  }

  if (title && title !== humanizeAgentId(agentId)) {
    return title;
  }

  return humanizeAgentId(agentId);
}

function deriveTitleFromSoul(content: string) {
  const titleFromHeading = content.match(/^#\s+SOUL\.md\s*-\s*(.+)$/m)?.[1]?.trim();
  if (titleFromHeading) {
    return titleFromHeading;
  }

  return content.match(/^##\s*角色\s*\n(.+)$/m)?.[1]?.trim() || "";
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
  const selectedModel = normalizeModelId(stored?.selectedModel ?? undefined) || normalizeModelId(currentModel) || "unknown";
  const executionMode = stored?.executionMode === "autonomous" ? "autonomous" : "confirm_first";

  return {
    selectedModel,
    defaultModel: normalizeModelId(stored?.defaultModel ?? undefined) || selectedModel,
    fallbackModel: normalizeModelId(stored?.fallbackModel ?? undefined),
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
    return ["claude-sonnet-4.5", "claude-opus-4.1", "claude-haiku-3.5"];
  }

  if (normalized.includes("gpt") || normalized.includes("o3") || normalized.includes("o4")) {
    return ["gpt-5.2", "gpt-5.4", "o4-mini"];
  }

  if (normalized.includes("qwen")) {
    return ["qwen-max", "qwen-plus", "qwen2.5-coder-32b-instruct"];
  }

  return ["gpt-5.2", "gemini-2.5-pro", "claude-sonnet-4.5"];
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
  await prisma.managedAgentConfig.upsert({
    where: { agentId },
    create: {
      agentId,
      displayName,
      title,
      intro: undefined,
      responsibility: undefined,
      selectedModel: model,
      defaultModel: model,
      executionMode: "confirm_first",
      requireConfirmation: true,
      autoApproveMinorSteps: false,
      memoryEnabled: true,
      allowedAgentIds: [],
      toolAllowlist: []
    },
    update: {
      displayName,
      title,
      selectedModel: model
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

function parseOpenClawJson(raw: string) {
  // 安全验证输入
  if (!raw || raw.length > 10 * 1024 * 1024) { // 限制最大10MB
    throw new Error("OpenClaw command returned invalid or too large payload");
  }

  // 验证JSON结构的合法性
  if (!isValidJsonStructure(raw)) {
    throw new Error("OpenClaw command returned malformed JSON structure");
  }

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("OpenClaw command returned no JSON payload");
  }

  const jsonStr = raw.slice(start, end + 1);

  // 验证提取的JSON长度合理性
  if (jsonStr.length > 5 * 1024 * 1024) { // 限制JSON最大5MB
    throw new Error("Extracted JSON payload is too large");
  }

  try {
    const parsed = JSON.parse(jsonStr);

    // 验证解析后的对象结构
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("Invalid JSON object structure");
    }

    return parsed as {
      status?: string;
      summary?: string;
      result?: {
        payloads?: Array<{ text?: string }>;
        meta?: {
          durationMs?: number;
          agentMeta?: {
            sessionId?: string;
            provider?: string;
            model?: string;
          };
        };
      };
    };
  } catch (error) {
    throw new Error(`Failed to parse OpenClaw JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
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

function parseOpenClawStatusJson(raw: string) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("OpenClaw status returned no JSON payload");
  }

  return JSON.parse(raw.slice(start, end + 1)) as {
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
function validateCommandInput(input: string) {
  if (!input) {
    throw new Error("输入参数不能为空");
  }

  // 长度限制
  if (input.length > 50000) {
    throw new Error("输入参数长度超过限制 (50000 字符)");
  }

  // 检查危险字符
  const dangerousChars = [';', '&', '|', '$', '`', '(', ')', '{', '}', '[', ']', '<', '>', '\n', '\r'];
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
