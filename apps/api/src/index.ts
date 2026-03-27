import express from "express";
import cors from "cors";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type {
  AuthLoginInput,
  OpenClawBatchAgentMessageInput,
  OpenClawAgentMessageInput,
  OpenClawBatchTaskUpdateInput,
  OpenClawCreateAgentInput,
  OpenClawAgentSettingsInput,
  OpenClawInstructionPreviewInput,
  OpenClawMemoryEntryInput,
  AuthSetupInput,
  InterventionInput,
  OpenClawDocumentUpdateInput,
  OpenClawTaskUpdateInput,
  NotificationInboxUpdateInput,
  PromptTemplateChannel,
  PromptTemplateUpsertInput,
  ProjectMessageInput,
  RuntimeSettingsInput,
  StageRejectInput,
  StageSubmissionInput,
  TaskUpdateInput,
  RoleType
} from "@occ/shared";
import {
  ensureSeedData,
  approveProject,
  createProject,
  findProject,
  getSystemHealth,
  interveneProject,
  listProjectTasks,
  listTasks,
  listProjects,
  postProjectMessage,
  rejectProjectStage,
  resumeProject,
  submitCurrentStage,
  updateTaskStatus
} from "./data/repository.js";
import { getRuntimeStatus } from "./agents/runtime.js";
import {
  getRuntimeSettings,
  validateRuntimeSettings,
  updateRuntimeSettings
} from "./system/runtime-config.js";
import { listAuditLogs, writeAuditLog } from "./system/audit-log.js";
import { listNotificationInbox, updateNotificationInboxState } from "./system/notifications.js";
import { createPromptTemplate, listPromptTemplates, markPromptTemplateUsed } from "./system/prompt-templates.js";
import { getSystemReadiness } from "./system/readiness.js";
import {
  getCachedLocalAgentMonitorOverview,
  subscribeLocalAgentMonitor,
  ensureLocalAgentMonitorLive
} from "./system/local-agent-monitor.js";
import {
  clearSessionCookie,
  createSessionCookie,
  getAuthStatus,
  loginAdmin,
  logoutAdmin,
  parseSessionToken,
  setupAdmin,
  validateSession
} from "./security/auth.js";
import { previewRequirement } from "./utils/project-parser.js";
import {
  buildOpenClawProjectReport,
  createOpenClawAgent,
  findOpenClawAgent,
  findOpenClawProject,
  getOpenClawStatusSummary,
  getOpenClawWorkspace,
  listOpenClawAgentSla,
  listOpenClawAgents,
  listOpenClawProjects,
  addOpenClawAgentMemory,
  previewOpenClawAgentInstruction,
  sendOpenClawBatchAgentMessage,
  sendOpenClawAgentMessage,
  updateOpenClawAgentSettings,
  updateOpenClawProjectTasks,
  updateOpenClawProjectTask,
  updateOpenClawAgentDocument
} from "./openclaw/workspace.js";
import { createModelsRouter } from "./routes/models.js";
import { createAgentsRouter } from "./routes/agents.js";
import { createTeamRouter } from "./routes/team.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);
const host = String(process.env.HOST ?? "127.0.0.1").trim() || "127.0.0.1";
const webDistPath = fileURLToPath(new URL("../../web/dist", import.meta.url));

// CORS 配置 - 生产环境禁止通配符
const corsOrigin = process.env.NODE_ENV === "production"
  ? (process.env.ALLOWED_ORIGINS?.split(",").map(origin => origin.trim()).filter(Boolean) || [])
  : true; // 开发环境允许任意源

if (process.env.NODE_ENV === "production" && !process.env.ALLOWED_ORIGINS) {
  throw new Error("生产环境必须设置 ALLOWED_ORIGINS 环境变量，不允许使用通配符");
}

app.use(cors({
  origin: corsOrigin,
  credentials: true
}));

// 安全 Headers
app.use(helmet({
  strictTransportSecurity: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  xFrameOptions: { action: "deny" },
  xContentTypeOptions: true,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  xDownloadOptions: false,
  xPermittedCrossDomainPolicies: false
}));
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  const requestId = randomUUID();
  const startedAt = Date.now();

  res.locals.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  res.on("finish", () => {
    console.log(
      JSON.stringify({
        requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt
      })
    );
  });

  next();
});

app.get("/api/auth/status", asyncRoute(async (req, res) => {
  res.json(await getAuthStatus(parseSessionToken(req.headers.cookie)));
}));

app.post("/api/auth/setup", asyncRoute(async (req, res) => {
  const payload = req.body as AuthSetupInput;
  const password = String(payload?.password ?? "").trim();

  if (password.length < 8) {
    res.status(400).json({ message: "password must be at least 8 characters" });
    return;
  }

  try {
    const session = await setupAdmin(password);
    res.setHeader("Set-Cookie", createSessionCookie(session.token));
    await safeAudit(req, res, {
      actorType: "admin",
      actorLabel: "管理员",
      action: "auth.setup",
      resourceType: "system",
      summary: "已完成管理员初始化"
    });
    res.status(201).json(await getAuthStatus(session.token));
  } catch (error) {
    const message = error instanceof Error ? error.message : "初始化失败";
    const statusCode = message.includes("已配置") ? 409 : 400;
    res.status(statusCode).json({ message });
  }
}));

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const payload = req.body as AuthLoginInput;
  const password = String(payload?.password ?? "").trim();

  if (!password) {
    res.status(400).json({ message: "password is required" });
    return;
  }

  try {
    const session = await loginAdmin(password);
    res.setHeader("Set-Cookie", createSessionCookie(session.token));
    await safeAudit(req, res, {
      actorType: "admin",
      actorLabel: "管理员",
      action: "auth.login",
      resourceType: "system",
      summary: "管理员已登录"
    });
    res.json(await getAuthStatus(session.token));
  } catch (error) {
    const message = error instanceof Error ? error.message : "登录失败";
    const statusCode = message.includes("尚未完成初始化") ? 428 : 401;
    res.status(statusCode).json({ message });
  }
}));

app.post("/api/auth/logout", asyncRoute(async (req, res) => {
  const sessionToken = parseSessionToken(req.headers.cookie);
  await logoutAdmin(sessionToken);
  res.setHeader("Set-Cookie", clearSessionCookie());
  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "auth.logout",
    resourceType: "system",
    summary: "管理员已退出登录"
  });
  res.json({ ok: true });
}));

app.get("/health", asyncRoute(async (_req, res) => {
  res.json({
    ok: true,
    service: "occ-api",
    runtime: await getRuntimeStatus(),
    timestamp: new Date().toISOString()
  });
}));

app.get("/ready", asyncRoute(async (_req, res) => {
  const health = await getSystemHealth();
  const databaseHealthy = health.services.find((service) => service.name === "database")?.status === "healthy";
  const statusCode = databaseHealthy ? 200 : 503;

  res.status(statusCode).json({
    ok: databaseHealthy,
    timestamp: new Date().toISOString(),
    services: health.services
  });
}));

app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/auth/")) {
    next();
    return;
  }

  // 临时策略：开发环境放开 /api/openclaw/*，便于前端联调与 SSE 调试
  if (process.env.NODE_ENV !== "production" && req.path.startsWith("/openclaw/")) {
    next();
    return;
  }

  void (async () => {
    const sessionToken = parseSessionToken(req.headers.cookie);
    const authStatus = await getAuthStatus(sessionToken);

    if (!authStatus.setupComplete) {
      res.status(428).json({
        message: "system setup required"
      });
      return;
    }

    const isValid = await validateSession(sessionToken);
    if (!isValid) {
      res.status(401).json({
        message: "authentication required"
      });
      return;
    }

    next();
  })().catch(next);
});

app.use("/api/models", createModelsRouter());
app.use("/api/agents", createAgentsRouter());
app.use("/api/team", createTeamRouter());

app.get("/api/system/runtime", asyncRoute(async (_req, res) => {
  res.json(await getRuntimeStatus());
}));

app.get("/api/system/runtime/config", asyncRoute(async (_req, res) => {
  res.json(await getRuntimeSettings());
}));

app.put("/api/system/runtime/config", asyncRoute(async (req, res) => {
  const payload = req.body as RuntimeSettingsInput;

  if (!payload?.provider) {
    res.status(400).json({ message: "provider is required" });
    return;
  }

  const result = await updateRuntimeSettings(payload);
  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "runtime.config.updated",
    resourceType: "runtime",
    summary: `运行配置已更新为 ${result.provider}`,
    detail: `model=${result.modelName || "未设置"} apiBaseUrl=${result.apiBaseUrl || "未设置"}`
  });
  res.json(result);
}));

app.post("/api/system/runtime/validate", asyncRoute(async (_req, res) => {
  const result = await validateRuntimeSettings();
  await safeAudit(_req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "runtime.config.validated",
    resourceType: "runtime",
    summary: result.ok ? "运行配置校验通过" : "运行配置校验失败",
    detail: result.message
  });
  res.status(result.ok ? 200 : 422).json(result);
}));

app.get("/api/system/health", asyncRoute(async (_req, res) => {
  res.json(await getSystemHealth());
}));

app.get("/api/system/readiness", asyncRoute(async (_req, res) => {
  res.json(await getSystemReadiness());
}));

app.get("/api/system/local-agent-monitor", asyncRoute(async (_req, res) => {
  res.json(await getCachedLocalAgentMonitorOverview());
}));

app.get("/api/system/local-agent-monitor/live", asyncRoute(async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const initial = await getCachedLocalAgentMonitorOverview();
  sendEvent(res, "snapshot", initial);

  const unsubscribe = subscribeLocalAgentMonitor((overview) => {
    sendEvent(res, "snapshot", overview);
  });

  const heartbeat = setInterval(() => {
    sendEvent(res, "heartbeat", { timestamp: new Date().toISOString() });
  }, 20000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
}));

app.get("/api/system/audit-logs", asyncRoute(async (req, res) => {
  const limit = Number(req.query.limit ?? 50);
  res.json(await listAuditLogs(Number.isFinite(limit) ? limit : 50));
}));

app.get("/api/notifications", asyncRoute(async (req, res) => {
  const locale = req.query.locale === "en-US" ? "en-US" : "zh-CN";
  res.json(await listNotificationInbox(locale));
}));

app.patch("/api/notifications/:sourceKey", asyncRoute(async (req, res) => {
  const payload = req.body as NotificationInboxUpdateInput;
  const sourceKey = decodeURIComponent(String(req.params.sourceKey ?? "").trim());

  if (!sourceKey) {
    res.status(400).json({ message: "sourceKey is required" });
    return;
  }

  const updated = await updateNotificationInboxState(sourceKey, payload);
  if (!updated) {
    res.status(404).json({ message: "notification not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "notification.updated",
    resourceType: "notification",
    resourceId: sourceKey,
    summary: `通知状态已更新：${updated.title}`,
    detail: `read=${updated.read} assignedTo=${updated.assignedTo ?? ""} confirmedBy=${updated.confirmedBy ?? ""} workflowStatus=${updated.workflowStatus}`
  });

  res.json(updated);
}));

app.get("/api/prompt-templates", asyncRoute(async (req, res) => {
  const channel = String(req.query.channel ?? "").trim() as PromptTemplateChannel;
  const locale = req.query.locale === "en-US" ? "en-US" : "zh-CN";
  const projectId = String(req.query.projectId ?? "").trim() || undefined;

  if (!channel) {
    res.status(400).json({ message: "channel is required" });
    return;
  }

  res.json(await listPromptTemplates({ channel, locale, projectId }));
}));

app.post("/api/prompt-templates", asyncRoute(async (req, res) => {
  const payload = req.body as PromptTemplateUpsertInput;
  if (!payload?.title || !payload?.content || !payload?.channel) {
    res.status(400).json({ message: "title, content, and channel are required" });
    return;
  }

  const created = await createPromptTemplate(payload);
  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: payload.ownerLabel || "管理员",
    action: "prompt_template.created",
    resourceType: "prompt_template",
    resourceId: created.id,
    summary: `已创建模板：${created.title}`,
    detail: `${created.channel} / ${created.scope}`
  });
  res.status(201).json(created);
}));

app.post("/api/prompt-templates/:templateId/use", asyncRoute(async (req, res) => {
  const templateId = String(req.params.templateId ?? "").trim();
  if (!templateId) {
    res.status(400).json({ message: "templateId is required" });
    return;
  }

  res.json(await markPromptTemplateUsed(templateId));
}));


type ProjectParsePriority = "High" | "Medium" | "Low";

const PROJECT_PARSE_ROLE_LABELS: Record<RoleType, string> = {
  ROLE_ASSISTANT: "总助理",
  ROLE_PM: "项目经理",
  ROLE_ANALYST: "需求分析师",
  ROLE_PRODUCT: "产品总监",
  ROLE_ARCH: "研发总监",
  ROLE_DEV: "研发经理",
  ROLE_QA: "测试工程师",
  ROLE_HR: "HR总监"
};

const PROJECT_PARSE_ROLE_HINTS: Array<{ role: RoleType; patterns: RegExp[] }> = [
  { role: "ROLE_PM", patterns: [/项目经理/, /pm/, /排期/, /里程碑/] },
  { role: "ROLE_ANALYST", patterns: [/需求/, /分析/, /调研/] },
  { role: "ROLE_PRODUCT", patterns: [/产品/, /原型/, /交互/, /体验/] },
  { role: "ROLE_ARCH", patterns: [/架构/, /基础设施/, /infra/, /系统设计/] },
  { role: "ROLE_DEV", patterns: [/研发/, /开发/, /编码/, /后端/, /前端/, /联调/] },
  { role: "ROLE_QA", patterns: [/测试/, /验收/, /qa/, /质量/] },
  { role: "ROLE_HR", patterns: [/招聘/, /人力/, /hr/] }
];

function inferProjectPriority(input: string): ProjectParsePriority {
  if (/紧急|马上|立即|asap|今天|本周|高优先|关键/.test(input)) {
    return "High";
  }
  if (/低优先|不着急|后续|有空|慢慢/.test(input)) {
    return "Low";
  }
  return "Medium";
}

function inferProjectPhase(input: string): string {
  if (/验收|测试|上线|发布|交付/.test(input)) {
    return "验收";
  }
  if (/开发|编码|实现|联调|后端|前端/.test(input)) {
    return "开发";
  }
  if (/设计|原型|界面|交互|架构/.test(input)) {
    return "设计";
  }
  return "分析";
}

function inferProjectName(input: string, keywords: string[]): string {
  const quoted = input.match(/["“](.{2,40})["”]/);
  if (quoted?.[1]) {
    return quoted[1].trim();
  }

  const candidate = input
    .replace(/(请|帮我|我们|需要|想要|希望|做一个|做个|创建|搭建|开发|实现|一个|项目|系统)/g, " ")
    .replace(/[，。,.!?]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join("");

  if (candidate) {
    return candidate.slice(0, 16) + "项目";
  }

  if (keywords[0]) {
    return keywords[0] + "项目";
  }

  return "新项目";
}

function inferProjectTeam(input: string, suggestedTeam: RoleType[]): RoleType[] {
  const matched = PROJECT_PARSE_ROLE_HINTS
    .filter((entry) => entry.patterns.some((pattern) => pattern.test(input)))
    .map((entry) => entry.role);

  if (matched.length > 0) {
    return Array.from(new Set(matched));
  }

  return suggestedTeam.length > 0 ? suggestedTeam.slice(0, 5) : ["ROLE_PM", "ROLE_ANALYST", "ROLE_DEV", "ROLE_QA"];
}

app.post("/api/projects/parse", asyncRoute(async (req, res) => {
  const input = String(req.body?.input ?? req.body?.description ?? "").trim();

  if (!input) {
    res.status(400).json({ message: "input is required" });
    return;
  }

  const parsedIntent = previewRequirement(input);
  const team = inferProjectTeam(input, parsedIntent.suggestedTeam);

  res.json({
    name: inferProjectName(input, parsedIntent.keywords),
    description: parsedIntent.summary || input,
    phase: inferProjectPhase(input),
    agents: team.map((role) => PROJECT_PARSE_ROLE_LABELS[role]),
    team,
    priority: inferProjectPriority(input)
  });
}));

app.post("/api/projects/preview", asyncRoute(async (req, res) => {
  const description = String(req.body?.description ?? "").trim();

  if (!description) {
    res.status(400).json({ message: "description is required" });
    return;
  }

  res.json(previewRequirement(description));
}));

app.get("/api/projects", asyncRoute(async (_req, res) => {
  res.json(await listProjects());
}));

app.post("/api/projects", asyncRoute(async (req, res) => {
  const description = String(req.body?.description ?? "").trim();

  if (!description) {
    res.status(400).json({ message: "description is required" });
    return;
  }

  const project = await createProject(
    {
      name: req.body?.name,
      description,
      team: req.body?.team
    },
    (await getRuntimeStatus()).mode
  );

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.created",
    resourceType: "project",
    resourceId: project.id,
    summary: `创建项目 ${project.name}`
  });
  res.status(201).json(project);
}));

app.get("/api/projects/:id", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId);

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  res.json(project);
}));

app.get("/api/projects/:id/tasks", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  res.json(await listProjectTasks(projectId));
}));

app.get("/api/tasks", asyncRoute(async (_req, res) => {
  res.json(await listTasks());
}));

app.post("/api/projects/:id/approve", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await approveProject(projectId);

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.approved",
    resourceType: "project",
    resourceId: project.id,
    summary: `批准项目阶段 ${project.currentStage}`
  });
  res.json(project);
}));

app.post("/api/projects/:id/reject", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const payload = req.body as StageRejectInput;
  const reason = String(payload?.reason ?? "").trim();

  if (!reason) {
    res.status(400).json({ message: "reason is required" });
    return;
  }

  const project = await rejectProjectStage(projectId, { reason });

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.rejected",
    resourceType: "project",
    resourceId: project.id,
    summary: `退回项目阶段 ${project.currentStage}`,
    detail: reason
  });
  res.json(project);
}));

app.post("/api/projects/:id/intervene", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const payload = req.body as InterventionInput;
  const command = String(payload?.command ?? "").trim();

  if (!command) {
    res.status(400).json({ message: "command is required" });
    return;
  }

  const project = await interveneProject(projectId, command);

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.intervened",
    resourceType: "project",
    resourceId: project.id,
    summary: `项目 ${project.id} 已被人工介入`,
    detail: command
  });
  res.json(project);
}));

app.post("/api/projects/:id/resume", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await resumeProject(projectId);

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.resumed",
    resourceType: "project",
    resourceId: project.id,
    summary: `项目 ${project.id} 已恢复执行`
  });
  res.json(project);
}));

app.post("/api/projects/:id/stages/submit", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const payload = req.body as StageSubmissionInput;
  const content = String(payload?.content ?? "").trim();

  if (!content) {
    res.status(400).json({ message: "content is required" });
    return;
  }

  const project = await submitCurrentStage(projectId, {
    title: payload?.title,
    content
  });

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.stage_submitted",
    resourceType: "project",
    resourceId: project.id,
    summary: `提交项目 ${project.id} 当前阶段交付物`
  });
  res.json(project);
}));

app.post("/api/projects/:id/messages", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const payload = req.body as ProjectMessageInput;
  const message = String(payload?.message ?? "").trim();

  if (!message) {
    res.status(400).json({ message: "message is required" });
    return;
  }

  const project = await postProjectMessage(projectId, { message });

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.message_sent",
    resourceType: "project",
    resourceId: project.id,
    summary: `向项目 ${project.id} 发送指导`,
    detail: message
  });
  res.json(project);
}));

app.patch("/api/tasks/:taskId", asyncRoute(async (req, res) => {
  const taskId = String(req.params.taskId);
  const payload = req.body as TaskUpdateInput;
  const status = payload?.status;

  if (!status) {
    res.status(400).json({ message: "status is required" });
    return;
  }

  const task = await updateTaskStatus(taskId, status);

  if (!task) {
    res.status(404).json({ message: "Task not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "task.updated",
    resourceType: "task",
    resourceId: task.id,
    summary: `任务 ${task.id} 状态更新为 ${task.status}`
  });
  res.json(task);
}));

app.get("/api/openclaw/workspace", asyncRoute(async (_req, res) => {
  res.json(await getOpenClawWorkspace());
}));

app.get("/api/openclaw/status", asyncRoute(async (req, res) => {
  const forceRefresh = String(req.query.refresh ?? "") === "true";
  res.json(await getOpenClawStatusSummary(forceRefresh));
}));

app.get("/api/openclaw/projects", asyncRoute(async (_req, res) => {
  res.json(await listOpenClawProjects());
}));

app.get("/api/openclaw/projects/:projectId", asyncRoute(async (req, res) => {
  const project = await findOpenClawProject(String(req.params.projectId));

  if (!project) {
    res.status(404).json({ message: "OpenClaw project not found" });
    return;
  }

  res.json(project);
}));

app.patch("/api/openclaw/projects/:projectId/tasks/:taskId", asyncRoute(async (req, res) => {
  const payload = req.body as OpenClawTaskUpdateInput;
  const project = await updateOpenClawProjectTask(
    String(req.params.projectId),
    String(req.params.taskId),
    payload
  );

  if (!project) {
    res.status(404).json({ message: "OpenClaw project task not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "openclaw.project.task.updated",
    resourceType: "openclaw-project",
    resourceId: String(req.params.projectId),
    summary: `更新 OpenClaw 项目任务 ${String(req.params.taskId)}`
  });
  res.json(project);
}));

app.patch("/api/openclaw/projects/:projectId/tasks", asyncRoute(async (req, res) => {
  const payload = req.body as OpenClawBatchTaskUpdateInput;
  const updates = Array.isArray(payload?.updates) ? payload.updates : [];

  if (updates.length === 0) {
    res.status(400).json({ message: "updates is required" });
    return;
  }

  const project = await updateOpenClawProjectTasks(String(req.params.projectId), payload);

  if (!project) {
    res.status(404).json({ message: "OpenClaw project task not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "openclaw.project.tasks.batch_updated",
    resourceType: "openclaw-project",
    resourceId: String(req.params.projectId),
    summary: `批量更新 ${updates.length} 个 OpenClaw 项目任务`
  });
  res.json(project);
}));

app.get("/api/openclaw/projects/:projectId/report", asyncRoute(async (req, res) => {
  const report = await buildOpenClawProjectReport(String(req.params.projectId));

  if (!report) {
    res.status(404).json({ message: "OpenClaw project not found" });
    return;
  }

  res.json(report);
}));

app.get("/api/openclaw/agents", asyncRoute(async (_req, res) => {
  res.json(await listOpenClawAgents());
}));

app.post("/api/openclaw/agents", asyncRoute(async (req, res) => {
  const payload = req.body as OpenClawCreateAgentInput;
  const agent = await createOpenClawAgent(payload);

  if (!agent) {
    res.status(500).json({ message: "failed to create OpenClaw agent" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "openclaw.agent.created",
    resourceType: "openclaw-agent",
    resourceId: agent.agentId,
    summary: `创建 OpenClaw Agent ${agent.name}`,
    detail: `model=${agent.model}`
  });
  res.status(201).json(agent);
}));

app.get("/api/openclaw/agents/:agentId", asyncRoute(async (req, res) => {
  const agent = await findOpenClawAgent(String(req.params.agentId));

  if (!agent) {
    res.status(404).json({ message: "OpenClaw agent not found" });
    return;
  }

  res.json(agent);
}));

app.put("/api/openclaw/agents/:agentId/settings", asyncRoute(async (req, res) => {
  const agentId = String(req.params.agentId);
  const payload = req.body as OpenClawAgentSettingsInput;
  const agent = await updateOpenClawAgentSettings(agentId, payload);

  if (!agent) {
    res.status(404).json({ message: "OpenClaw agent not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "openclaw.agent.settings.updated",
    resourceType: "openclaw-agent",
    resourceId: agentId,
    summary: `更新 OpenClaw Agent ${agent.name} 的指挥设置`,
    detail: JSON.stringify({
      selectedModel: payload.selectedModel,
      defaultModel: payload.defaultModel,
      fallbackModel: payload.fallbackModel,
      executionMode: payload.executionMode
    })
  });
  res.json(agent);
}));

app.post("/api/openclaw/agents/:agentId/preview", asyncRoute(async (req, res) => {
  const agentId = String(req.params.agentId);
  const payload = req.body as OpenClawInstructionPreviewInput;
  const preview = await previewOpenClawAgentInstruction(agentId, payload);

  if (!preview) {
    res.status(404).json({ message: "OpenClaw agent not found" });
    return;
  }

  res.json(preview);
}));

app.put("/api/openclaw/agents/:agentId/soul", asyncRoute(async (req, res) => {
  const agentId = String(req.params.agentId);
  const payload = req.body as OpenClawDocumentUpdateInput;
  const content = String(payload?.content ?? "").trim();

  if (!content) {
    res.status(400).json({ message: "content is required" });
    return;
  }

  const agent = await updateOpenClawAgentDocument(agentId, "soul", payload);
  if (!agent) {
    res.status(404).json({ message: "OpenClaw agent not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "openclaw.agent.soul.updated",
    resourceType: "openclaw-agent",
    resourceId: agentId,
    summary: `更新 OpenClaw Agent ${agent.name} 的 SOUL`
  });
  res.json(agent);
}));

app.put("/api/openclaw/agents/:agentId/sop", asyncRoute(async (req, res) => {
  const agentId = String(req.params.agentId);
  const payload = req.body as OpenClawDocumentUpdateInput;
  const content = String(payload?.content ?? "").trim();

  if (!content) {
    res.status(400).json({ message: "content is required" });
    return;
  }

  const agent = await updateOpenClawAgentDocument(agentId, "sop", payload);
  if (!agent) {
    res.status(404).json({ message: "OpenClaw agent not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "openclaw.agent.sop.updated",
    resourceType: "openclaw-agent",
    resourceId: agentId,
    summary: `更新 OpenClaw Agent ${agent.name} 的 SOP`
  });
  res.json(agent);
}));

app.post("/api/openclaw/agents/:agentId/message", asyncRoute(async (req, res) => {
  const payload = req.body as OpenClawAgentMessageInput;
  const message = String(payload?.message ?? "").trim();

  if (!message) {
    res.status(400).json({ message: "message is required" });
    return;
  }

  const result = await sendOpenClawAgentMessage(String(req.params.agentId), { message });
  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "openclaw.agent.message.sent",
    resourceType: "openclaw-agent",
    resourceId: String(req.params.agentId),
    summary: `向 OpenClaw Agent ${String(req.params.agentId)} 下发指令`,
    detail: message
  });
  res.json(result);
}));

app.post("/api/openclaw/agents/batch-message", asyncRoute(async (req, res) => {
  const payload = req.body as OpenClawBatchAgentMessageInput;
  const message = String(payload?.message ?? "").trim();
  const agentIds = Array.isArray(payload?.agentIds) ? payload.agentIds.map((item) => String(item)) : [];

  if (!message) {
    res.status(400).json({ message: "message is required" });
    return;
  }

  if (agentIds.length === 0) {
    res.status(400).json({ message: "agentIds is required" });
    return;
  }

  const result = await sendOpenClawBatchAgentMessage({ agentIds, message });
  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "openclaw.agent.batch_message.sent",
    resourceType: "openclaw-agent",
    summary: `批量向 ${result.requestedAgentIds.length} 个 OpenClaw Agent 下发指令`,
    detail: message
  });
  res.json(result);
}));

app.post("/api/openclaw/agents/:agentId/memory", asyncRoute(async (req, res) => {
  const agentId = String(req.params.agentId);
  const payload = req.body as OpenClawMemoryEntryInput;
  const agent = await addOpenClawAgentMemory(agentId, payload);

  if (!agent) {
    res.status(404).json({ message: "OpenClaw agent not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "openclaw.agent.memory.created",
    resourceType: "openclaw-agent",
    resourceId: agentId,
    summary: `为 OpenClaw Agent ${agent.name} 新增长期记忆`,
    detail: payload.summary
  });
  res.status(201).json(agent);
}));

app.get("/api/openclaw/sla", asyncRoute(async (_req, res) => {
  res.json(await listOpenClawAgentSla());
}));

// SSE 实时事件端点
app.get("/api/openclaw/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  // 发送连接成功
  res.write('event: connected\ndata: {"status":"ok"}\n\n');

  // 每 30 秒心跳
  const heartbeat = setInterval(() => {
    res.write(`event: heartbeat\ndata: {"time":"${new Date().toISOString()}"}\n\n`);
  }, 30000);

  // 每 5 秒发送模拟事件（开发用）
  const events = setInterval(() => {
    const eventTypes = ["agent_status", "task_update", "project_progress"];
    const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];
    res.write(`event: ${eventType}\ndata: {}\n\n`);
  }, 5000);

  req.on("close", () => {
    clearInterval(heartbeat);
    clearInterval(events);
    res.end();
  });
});

app.get("/api/projects/:id/live", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId);

  if (!project) {
    res.status(404).end();
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const fragments = splitScript(project.liveSession.body, 18);
  let index = 0;

  sendEvent(res, "session", {
    title: project.liveSession.title,
    activeRole: project.liveSession.activeRole,
    startedAt: project.liveSession.startedAt,
    provider: project.liveSession.provider
  });

  const interval = setInterval(async () => {
    const currentProject = await findProject(projectId);

    if (!currentProject) {
      clearInterval(interval);
      res.end();
      return;
    }

    if (currentProject.status === "paused") {
      sendEvent(res, "system", {
        title: "项目已暂停",
        content: "等待你的进一步指令。"
      });
      return;
    }

    if (index >= fragments.length) {
      sendEvent(res, "heartbeat", { done: true, timestamp: new Date().toISOString() });
      clearInterval(interval);
      return;
    }

    const delta = fragments[index];
    sendEvent(res, "agent_typing", {
      delta,
      activeRole: currentProject.liveSession.activeRole,
      timestamp: new Date().toISOString()
    });

    if (index === Math.floor(fragments.length / 2)) {
      sendEvent(res, "thinking_step", {
        content: "Agent 已完成半程推演，正在收敛结构与结论。",
        activeRole: currentProject.liveSession.activeRole
      });
    }

    index += 1;
  }, 600);

  req.on("close", () => {
    clearInterval(interval);
    res.end();
  });
}));

if (existsSync(webDistPath)) {
  app.use(express.static(webDistPath));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path === "/health" || req.path === "/ready") {
      next();
      return;
    }

    res.sendFile(path.join(webDistPath, "index.html"));
  });
}

function sendEvent(res: express.Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function splitScript(input: string, size: number) {
  const parts: string[] = [];

  for (let start = 0; start < input.length; start += size) {
    parts.push(input.slice(start, start + size));
  }

  return parts;
}

function asyncRoute(
  handler: (req: express.Request, res: express.Response) => Promise<void>
): express.RequestHandler {
  return (req, res, next) => {
    void handler(req, res).catch(next);
  };
}

async function start() {
  await ensureSeedData((await getRuntimeStatus()).mode);
  ensureLocalAgentMonitorLive();

  app.listen(port, host, () => {
    console.log(
      `OCC API listening on http://${host}:${port}${existsSync(webDistPath) ? " (serving web dist)" : ""}`
    );
  });
}

async function safeAudit(
  req: express.Request,
  res: express.Response,
  input: {
    actorType: "admin" | "system";
    actorLabel: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    summary: string;
    detail?: string;
  }
) {
  try {
    await writeAuditLog({
      ...input,
      requestId: String(res.locals.requestId ?? ""),
      ipAddress: req.ip
    });
  } catch (error) {
    console.warn("Audit log write failed:", error);
  }
}

app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const requestId = String(res.locals.requestId ?? randomUUID());
  const message = error instanceof Error ? error.message : "Internal server error";

  console.error(
    JSON.stringify({
      requestId,
      method: req.method,
      path: req.originalUrl,
      error: message
    })
  );

  if (res.headersSent) {
    return;
  }

  res.status(500).json({
    message,
    requestId
  });
});

void start();
