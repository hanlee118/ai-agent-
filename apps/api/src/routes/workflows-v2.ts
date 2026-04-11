import express from "express";
import { prisma } from "../db.js";
import {
  addStageOutputArtifact,
  createWorkflowFromTemplate,
  getActiveWorkflow,
  listWorkflowTemplates,
  startWorkflow,
  transitionWorkflowStage,
  upsertWorkflowTemplate
} from "../workflow-v2/workflow-orchestrator.js";
import { getWorkflowV2SchemaStatus } from "../workflow-v2/schema-ready.js";
import { asRecord, asRecordArray, normalizeText } from "../workflow-v2/types.js";
import { asyncRoute, sendError, sendSuccess } from "./utils.js";

type CreateTemplateBody = {
  name?: unknown;
  key?: unknown;
  description?: unknown;
  category?: unknown;
  executorConfig?: unknown;
  inputSchema?: unknown;
  outputSchema?: unknown;
  acceptanceCriteria?: unknown;
  integrationConfig?: unknown;
  defaultTimeout?: unknown;
  allowParallel?: unknown;
};

type InitializeWorkflowBody = {
  templateKey?: unknown;
  name?: unknown;
  customStages?: unknown;
};

type StageTransitionBody = {
  workflowId?: unknown;
  action?: unknown;
  triggeredBy?: unknown;
  reason?: unknown;
};

function asStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return value
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function buildWorkflowOverview(workflow: Awaited<ReturnType<typeof getActiveWorkflow>>) {
  const graphRecord = asRecord(workflow.stageGraph) ?? {};
  const nodes = asRecordArray(graphRecord.nodes).map((node) => ({
    id: normalizeText(node.id),
    templateKey: normalizeText(node.templateKey),
    config: asRecord(node.config) ?? {}
  }));
  const edges = asRecordArray(graphRecord.edges).map((edge) => ({
    from: normalizeText(edge.from),
    to: normalizeText(edge.to),
    condition: normalizeText(edge.condition) || null
  })).filter((edge) => edge.from && edge.to);
  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const currentStageIds = asStringList(workflow.currentStageIds);
  const currentSet = new Set(currentStageIds);

  const stages = [...workflow.stages]
    .sort((a, b) => {
      const indexA = nodeOrder.get(a.nodeId) ?? Number.MAX_SAFE_INTEGER;
      const indexB = nodeOrder.get(b.nodeId) ?? Number.MAX_SAFE_INTEGER;
      if (indexA !== indexB) {
        return indexA - indexB;
      }
      return a.createdAt.getTime() - b.createdAt.getTime();
    })
    .map((stage) => {
      const outputArtifacts = Array.isArray(stage.outputArtifacts) ? stage.outputArtifacts : [];
      const contextMemoryIds = Array.isArray(stage.contextMemoryIds) ? stage.contextMemoryIds : [];
      const gateResults = asRecord(stage.gateResults ?? {});
      const gateViolations = asStringList(gateResults?.violations);
      return {
        id: stage.id,
        nodeId: stage.nodeId,
        templateKey: stage.templateKey,
        status: stage.status,
        assignedAgents: asStringList(stage.assignedAgents),
        outputArtifactCount: outputArtifacts.length,
        contextMemoryCount: contextMemoryIds.length,
        gate: {
          passed: Boolean(gateResults?.passed),
          violationCount: gateViolations.length,
          violations: gateViolations
        },
        isCurrent: currentSet.has(stage.id),
        startedAt: stage.startedAt ? stage.startedAt.toISOString() : null,
        completedAt: stage.completedAt ? stage.completedAt.toISOString() : null,
        updatedAt: stage.updatedAt.toISOString()
      };
    });

  return {
    workflowId: workflow.id,
    projectId: workflow.projectId,
    name: workflow.name,
    status: workflow.status,
    template: {
      id: workflow.template.id,
      key: workflow.template.key,
      name: workflow.template.name
    },
    currentStageIds,
    nodes,
    edges,
    stages,
    updatedAt: workflow.updatedAt.toISOString()
  };
}

export function createWorkflowsV2Router() {
  const router = express.Router();

  router.get("/health", asyncRoute(async (_req, res) => {
    const status = await getWorkflowV2SchemaStatus();
    if (!status.ready) {
      sendError(res, 503, "SERVICE_UNAVAILABLE", `workflow-v2 schema not ready: ${status.reason || "unknown"}`);
      return;
    }
    sendSuccess(res, {
      ready: true,
      checkedAt: new Date(status.checkedAt).toISOString()
    });
  }));

  router.post("/templates", asyncRoute(async (req, res) => {
    const status = await getWorkflowV2SchemaStatus();
    if (!status.ready) {
      sendError(res, 503, "SERVICE_UNAVAILABLE", `workflow-v2 schema not ready: ${status.reason || "unknown"}`);
      return;
    }
    const payload = (req.body ?? {}) as CreateTemplateBody;
    const key = normalizeText(payload.key);
    const name = normalizeText(payload.name);
    const category = normalizeText(payload.category) || "custom";
    if (!key || !name) {
      sendError(res, 400, "VALIDATION_ERROR", "name and key are required");
      return;
    }
    const saved = await upsertWorkflowTemplate({
      key,
      name,
      description: normalizeText(payload.description) || undefined,
      category,
      executorConfig: (asRecord(payload.executorConfig) ?? {
        type: "agent",
        requiredCapabilities: []
      }) as {
        type: "agent" | "human" | "hybrid";
        agentRole?: string;
        requiredCapabilities: string[];
        modelPreference?: string;
      },
      inputSchema: asRecord(payload.inputSchema) ?? {},
      outputSchema: asRecord(payload.outputSchema) ?? {},
      acceptanceCriteria: asRecordArray(payload.acceptanceCriteria).map((item) => ({
        type: normalizeText(item.type) as "artifact_exists" | "quality_gate" | "manual_approval" | "auto_check",
        config: asRecord(item.config) ?? {}
      })),
      integrationConfig: asRecord(payload.integrationConfig) as Record<string, unknown> | undefined,
      defaultTimeout: payload.defaultTimeout === undefined ? null : Number(payload.defaultTimeout),
      allowParallel: Boolean(payload.allowParallel)
    });
    sendSuccess(res, { id: saved.id }, 201);
  }));

  router.get("/templates", asyncRoute(async (req, res) => {
    const status = await getWorkflowV2SchemaStatus();
    if (!status.ready) {
      sendError(res, 503, "SERVICE_UNAVAILABLE", `workflow-v2 schema not ready: ${status.reason || "unknown"}`);
      return;
    }
    const category = normalizeText(req.query.category);
    const templates = await listWorkflowTemplates(category || undefined);
    sendSuccess(res, { templates });
  }));

  router.post("/projects/:projectId/init", asyncRoute(async (req, res) => {
    const status = await getWorkflowV2SchemaStatus();
    if (!status.ready) {
      sendError(res, 503, "SERVICE_UNAVAILABLE", `workflow-v2 schema not ready: ${status.reason || "unknown"}`);
      return;
    }
    const projectId = normalizeText(req.params.projectId);
    if (!projectId) {
      sendError(res, 400, "VALIDATION_ERROR", "projectId is required");
      return;
    }

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      sendError(res, 404, "NOT_FOUND", `project not found: ${projectId}`);
      return;
    }

    const payload = (req.body ?? {}) as InitializeWorkflowBody;
    const templateKey = normalizeText(payload.templateKey);
    if (!templateKey) {
      sendError(res, 400, "VALIDATION_ERROR", "templateKey is required");
      return;
    }
    const customGraph = asRecord(payload.customStages);
    const workflow = await createWorkflowFromTemplate({
      projectId,
      templateKey,
      name: normalizeText(payload.name) || undefined,
      customGraph: customGraph ? {
        nodes: asRecordArray(customGraph.nodes).map((node, index) => ({
          id: normalizeText(node.id) || `node_${index + 1}`,
          templateKey: normalizeText(node.templateKey) || "default",
          config: asRecord(node.config) ?? {}
        })),
        edges: asRecordArray(customGraph.edges).map((edge) => ({
          from: normalizeText(edge.from),
          to: normalizeText(edge.to),
          condition: normalizeText(edge.condition) || undefined
        })).filter((edge) => edge.from && edge.to)
      } : undefined
    });

    sendSuccess(res, {
      workflowId: workflow.id,
      stages: (Array.isArray(workflow.stageGraph)
        ? []
        : asRecordArray(asRecord(workflow.stageGraph)?.nodes)).map((node) => ({
        id: normalizeText(node.id),
        templateKey: normalizeText(node.templateKey)
      }))
    }, 201);
  }));

  router.post("/:workflowId/start", asyncRoute(async (req, res) => {
    const status = await getWorkflowV2SchemaStatus();
    if (!status.ready) {
      sendError(res, 503, "SERVICE_UNAVAILABLE", `workflow-v2 schema not ready: ${status.reason || "unknown"}`);
      return;
    }
    const workflowId = normalizeText(req.params.workflowId);
    if (!workflowId) {
      sendError(res, 400, "VALIDATION_ERROR", "workflowId is required");
      return;
    }
    await startWorkflow(workflowId);
    sendSuccess(res, { message: "Workflow started" });
  }));

  router.post("/stages/:stageId/output", asyncRoute(async (req, res) => {
    const status = await getWorkflowV2SchemaStatus();
    if (!status.ready) {
      sendError(res, 503, "SERVICE_UNAVAILABLE", `workflow-v2 schema not ready: ${status.reason || "unknown"}`);
      return;
    }
    const stageId = normalizeText(req.params.stageId);
    const payload = asRecord(req.body) ?? {};
    const name = normalizeText(payload.name) || "artifact.md";
    const type = normalizeText(payload.type) || "markdown";
    const content = String(payload.content ?? "");
    if (!stageId || !content.trim()) {
      sendError(res, 400, "VALIDATION_ERROR", "stageId and content are required");
      return;
    }
    const stage = await addStageOutputArtifact({
      stageId,
      artifact: {
        name,
        type,
        content,
        createdAt: new Date().toISOString()
      }
    });
    sendSuccess(res, { stageId: stage.id, artifactCount: Array.isArray(stage.outputArtifacts) ? stage.outputArtifacts.length : 0 });
  }));

  router.post("/stages/:stageId/transition", asyncRoute(async (req, res) => {
    const status = await getWorkflowV2SchemaStatus();
    if (!status.ready) {
      sendError(res, 503, "SERVICE_UNAVAILABLE", `workflow-v2 schema not ready: ${status.reason || "unknown"}`);
      return;
    }
    const stageId = normalizeText(req.params.stageId);
    const payload = (req.body ?? {}) as StageTransitionBody;
    const workflowId = normalizeText(payload.workflowId);
    const action = normalizeText(payload.action) as "proceed" | "iterate" | "rollback" | "skip";
    const triggeredBy = normalizeText(payload.triggeredBy);
    if (!["proceed", "iterate", "rollback", "skip"].includes(action)) {
      sendError(res, 400, "VALIDATION_ERROR", "action must be proceed|iterate|rollback|skip");
      return;
    }
    if (!stageId || !workflowId || !action || !triggeredBy) {
      sendError(res, 400, "VALIDATION_ERROR", "stageId/workflowId/action/triggeredBy are required");
      return;
    }
    const result = await transitionWorkflowStage({
      workflowId,
      stageId,
      action,
      triggeredBy,
      reason: normalizeText(payload.reason) || undefined
    });
    sendSuccess(res, result);
  }));

  router.get("/projects/:projectId/status", asyncRoute(async (req, res) => {
    const status = await getWorkflowV2SchemaStatus();
    if (!status.ready) {
      sendError(res, 503, "SERVICE_UNAVAILABLE", `workflow-v2 schema not ready: ${status.reason || "unknown"}`);
      return;
    }
    const projectId = normalizeText(req.params.projectId);
    if (!projectId) {
      sendError(res, 400, "VALIDATION_ERROR", "projectId is required");
      return;
    }
    let workflow: Awaited<ReturnType<typeof getActiveWorkflow>>;
    try {
      workflow = await getActiveWorkflow(projectId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/no active workflow/i.test(message)) {
        sendError(res, 404, "NOT_FOUND", message);
        return;
      }
      throw error;
    }
    sendSuccess(res, {
      workflowId: workflow.id,
      status: workflow.status,
      currentStages: Array.isArray(workflow.currentStageIds) ? workflow.currentStageIds : []
    });
  }));

  router.get("/projects/:projectId/overview", asyncRoute(async (req, res) => {
    const status = await getWorkflowV2SchemaStatus();
    if (!status.ready) {
      sendError(res, 503, "SERVICE_UNAVAILABLE", `workflow-v2 schema not ready: ${status.reason || "unknown"}`);
      return;
    }
    const projectId = normalizeText(req.params.projectId);
    if (!projectId) {
      sendError(res, 400, "VALIDATION_ERROR", "projectId is required");
      return;
    }
    let workflow: Awaited<ReturnType<typeof getActiveWorkflow>>;
    try {
      workflow = await getActiveWorkflow(projectId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/no active workflow/i.test(message)) {
        sendError(res, 404, "NOT_FOUND", message);
        return;
      }
      throw error;
    }
    sendSuccess(res, buildWorkflowOverview(workflow));
  }));

  return router;
}
