import express from "express";
import {
  addOpenClawAgentMemory,
  buildOpenClawProjectReport,
  createOpenClawAgent,
  deleteOpenClawAgent,
  findOpenClawAgent,
  findOpenClawProject,
  getOpenClawStatusSummary,
  getOpenClawWorkspace,
  listOpenClawAgentSla,
  listOpenClawAgents,
  listOpenClawProjects,
  previewOpenClawAgentInstruction,
  sendOpenClawAgentMessage,
  sendOpenClawBatchAgentMessage,
  updateOpenClawAgentDocument,
  updateOpenClawAgentSettings,
  updateOpenClawProjectTask,
  updateOpenClawProjectTasks
} from "../openclaw/workspace.js";
import { getCachedLocalAgentMonitorOverview, subscribeLocalAgentMonitor } from "../system/local-agent-monitor.js";

interface CreateOpenClawRouterOptions {
  asyncRoute: (
    handler: (req: express.Request, res: express.Response) => Promise<void>
  ) => express.RequestHandler;
  safeAudit: (
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
  ) => Promise<void>;
}

export function createOpenClawRouter(options: CreateOpenClawRouterOptions) {
  const router = express.Router();
  const { asyncRoute, safeAudit } = options;

  router.get("/status", asyncRoute(async (_req, res) => {
    res.json(await getOpenClawStatusSummary());
  }));

  router.get("/workspace", asyncRoute(async (_req, res) => {
    res.json(await getOpenClawWorkspace());
  }));

  router.get("/projects", asyncRoute(async (_req, res) => {
    res.json(await listOpenClawProjects());
  }));

  router.get("/projects/:projectId", asyncRoute(async (req, res) => {
    const projectId = String(req.params.projectId ?? "").trim();
    const project = await findOpenClawProject(projectId);
    if (!project) {
      res.status(404).json({ message: "Project not found" });
      return;
    }
    res.json(project);
  }));

  router.get("/projects/:projectId/report", asyncRoute(async (req, res) => {
    const projectId = String(req.params.projectId ?? "").trim();
    const report = await buildOpenClawProjectReport(projectId);
    if (!report) {
      res.status(404).json({ message: "Project not found" });
      return;
    }
    res.json(report);
  }));

  router.patch("/projects/:projectId/tasks", asyncRoute(async (req, res) => {
    const projectId = String(req.params.projectId ?? "").trim();
    const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];
    const updated = await updateOpenClawProjectTasks(projectId, updates);
    res.json(updated);
  }));

  router.patch("/projects/:projectId/tasks/:taskId", asyncRoute(async (req, res) => {
    const projectId = String(req.params.projectId ?? "").trim();
    const taskId = String(req.params.taskId ?? "").trim();
    const updated = await updateOpenClawProjectTask(projectId, taskId, req.body ?? {});
    if (!updated) {
      res.status(404).json({ message: "Task not found" });
      return;
    }
    res.json(updated);
  }));

  router.get("/agents", asyncRoute(async (_req, res) => {
    res.json(await listOpenClawAgents());
  }));

  router.get("/agents/sla", asyncRoute(async (_req, res) => {
    res.json(await listOpenClawAgentSla());
  }));

  router.get("/agents/:agentId", asyncRoute(async (req, res) => {
    const agentId = String(req.params.agentId ?? "").trim();
    const agent = await findOpenClawAgent(agentId);
    if (!agent) {
      res.status(404).json({ message: "Agent not found" });
      return;
    }
    res.json(agent);
  }));

  router.post("/agents", asyncRoute(async (req, res) => {
    const created = await createOpenClawAgent(req.body ?? {});
    if (!created) {
      res.status(500).json({ message: "Agent creation failed" });
      return;
    }
    await safeAudit(req, res, {
      actorType: "admin",
      actorLabel: "管理员",
      action: "openclaw.agent_created",
      resourceType: "agent",
      resourceId: created.agentId,
      summary: `已创建 Agent ${created.agentId}`
    });
    res.status(201).json(created);
  }));

  router.delete("/agents/:agentId", asyncRoute(async (req, res) => {
    const agentId = String(req.params.agentId ?? "").trim();
    const result = await deleteOpenClawAgent(agentId);
    if (result.status === "not_found") {
      res.status(404).json({ message: "Agent not found" });
      return;
    }
    if (result.status === "protected") {
      res.status(400).json({ message: "Core agent cannot be deleted" });
      return;
    }

    await safeAudit(req, res, {
      actorType: "admin",
      actorLabel: "管理员",
      action: "openclaw.agent_deleted",
      resourceType: "agent",
      resourceId: agentId,
      summary: `已删除 Agent ${agentId}`,
      detail: result.removedWorkspace ? "Agent workspace removed." : "Agent workspace retained."
    });

    res.json({
      success: true,
      agentId,
      removedWorkspace: result.removedWorkspace
    });
  }));

  router.patch("/agents/:agentId/settings", asyncRoute(async (req, res) => {
    const agentId = String(req.params.agentId ?? "").trim();
    const updated = await updateOpenClawAgentSettings(agentId, req.body ?? {});
    if (!updated) {
      res.status(404).json({ message: "Agent not found" });
      return;
    }
    res.json(updated);
  }));

  const patchAgentDocument: express.RequestHandler = asyncRoute(async (req, res) => {
    const agentId = String(req.params.agentId ?? "").trim();
    const documentKeyRaw = String(req.params.documentKey ?? req.body?.type ?? "").trim().toLowerCase();
    const documentKey = documentKeyRaw === "soul" || documentKeyRaw === "sop" ? documentKeyRaw : null;
    if (!documentKey) {
      res.status(400).json({ message: "documentKey must be soul or sop" });
      return;
    }
    const updated = await updateOpenClawAgentDocument(agentId, documentKey, req.body ?? {});
    if (!updated) {
      res.status(404).json({ message: "Agent not found" });
      return;
    }
    res.json(updated);
  });
  router.patch("/agents/:agentId/document", patchAgentDocument);
  router.patch("/agents/:agentId/document/:documentKey", patchAgentDocument);

  router.get("/agents/:agentId/memory", asyncRoute(async (req, res) => {
    const agentId = String(req.params.agentId ?? "").trim();
    const detail = await findOpenClawAgent(agentId);
    if (!detail) {
      res.status(404).json({ message: "Agent not found" });
      return;
    }
    res.json(detail.memoryEntries || []);
  }));

  router.post("/agents/:agentId/memory", asyncRoute(async (req, res) => {
    const agentId = String(req.params.agentId ?? "").trim();
    const saved = await addOpenClawAgentMemory(agentId, req.body ?? {});
    if (!saved) {
      res.status(404).json({ message: "Agent not found" });
      return;
    }
    res.status(201).json(saved);
  }));

  router.post("/agents/:agentId/preview-instruction", asyncRoute(async (req, res) => {
    const agentId = String(req.params.agentId ?? "").trim();
    const preview = await previewOpenClawAgentInstruction(agentId, req.body ?? {});
    if (!preview) {
      res.status(404).json({ message: "Agent not found" });
      return;
    }
    res.json(preview);
  }));

  router.post("/agents/:agentId/message", asyncRoute(async (req, res) => {
    const agentId = String(req.params.agentId ?? "").trim();
    const message = String(req.body?.message ?? "").trim();
    if (!message) {
      res.status(400).json({ message: "message is required" });
      return;
    }
    res.json(await sendOpenClawAgentMessage(agentId, { message }));
  }));

  router.post("/agents/batch-message", asyncRoute(async (req, res) => {
    const message = String(req.body?.message ?? "").trim();
    const agentIds = Array.isArray(req.body?.agentIds)
      ? req.body.agentIds.map((item: unknown) => String(item).trim()).filter(Boolean)
      : [];
    if (!message || agentIds.length === 0) {
      res.status(400).json({ message: "message and agentIds are required" });
      return;
    }
    res.json(await sendOpenClawBatchAgentMessage({ agentIds, message }));
  }));

  router.get("/events", asyncRoute(async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const push = (payload: unknown) => {
      res.write(`event: snapshot\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    push(await getCachedLocalAgentMonitorOverview());
    const unsubscribe = subscribeLocalAgentMonitor(push);
    const heartbeat = setInterval(() => {
      res.write(": ping\n\n");
    }, 15000);
    heartbeat.unref?.();

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  }));

  return router;
}
