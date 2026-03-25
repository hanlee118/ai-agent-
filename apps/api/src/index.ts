import express from "express";
import cors from "cors";
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
  ProjectMessageInput,
  RoleType,
  RuntimeSettingsInput,
  StageRejectInput,
  StageSubmissionInput,
  TaskUpdateInput
} from "@occ/shared";
import {
  ensureSeedData,
  approveProject,
  createProject,
  findAgent,
  findProject,
  getSystemHealth,
  interveneProject,
  listAgents,
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
import { getSystemReadiness } from "./system/readiness.js";
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

const app = express();
const port = Number(process.env.PORT ?? 8787);
const webDistPath = fileURLToPath(new URL("../../web/dist", import.meta.url));

app.use(cors({
  origin: true,
  credentials: true
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
}));

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const payload = req.body as AuthLoginInput;
  const password = String(payload?.password ?? "").trim();

  if (!password) {
    res.status(400).json({ message: "password is required" });
    return;
  }

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

app.get("/api/system/audit-logs", asyncRoute(async (req, res) => {
  const limit = Number(req.query.limit ?? 50);
  res.json(await listAuditLogs(Number.isFinite(limit) ? limit : 50));
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

app.get("/api/agents", asyncRoute(async (_req, res) => {
  res.json(await listAgents());
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

app.get("/api/agents/:roleId", asyncRoute(async (req, res) => {
  const roleId = String(req.params.roleId) as RoleType;
  const agent = await findAgent(roleId);

  if (!agent) {
    res.status(404).json({ message: "Agent not found" });
    return;
  }

  res.json(agent);
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

  app.listen(port, () => {
    console.log(
      `OCC API listening on http://localhost:${port}${existsSync(webDistPath) ? " (serving web dist)" : ""}`
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
