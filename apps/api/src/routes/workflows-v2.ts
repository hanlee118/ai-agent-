import express from "express";
import { MutationPassthroughSchema } from "../validation/schemas.js";
import { validateBody } from "../validation/middleware.js";
import { prisma } from "../db.js";
import {
  addStageInputArtifact,
  addStageOutputArtifact,
  createWorkflowFromTemplate,
  getActiveWorkflow,
  listWorkflowTemplates,
  startWorkflow,
  transitionWorkflowStage,
  upsertWorkflowTemplate
} from "../workflow-v2/workflow-orchestrator.js";
import { getHermesMcpRuntimeStatus, probeHermesMcpEndpoint } from "../workflow-v2/hermes-mcp.js";
import { getWorkflowV2SchemaStatus } from "../workflow-v2/schema-ready.js";
import { asRecord, asRecordArray, normalizeText } from "../workflow-v2/types.js";
import { asyncRoute, sendError, sendSuccess } from "./utils.js";

type CreateTemplateBody = {
  name?: unknown;
  key?: unknown;
  description?: unknown;
  category?: unknown;
  isStandalone?: unknown;
  standaloneCategory?: unknown;
  executorConfig?: unknown;
  inputSchema?: unknown;
  outputSchema?: unknown;
  inputContract?: unknown;
  outputContract?: unknown;
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

type AgentRuntimeProfile = {
  engine: "hermes" | "openclaw" | "unknown";
  model: string | null;
};

function toPreviewText(value: unknown, limit = 220) {
  const normalized = String(value ?? "")
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

function inferAgentEngine(input: { agentId: string; model?: string | null }) {
  const model = normalizeText(input.model).toLowerCase();
  const agentId = normalizeText(input.agentId).toLowerCase();
  if (model.includes("hermes") || agentId.includes("hermes")) {
    return "hermes" as const;
  }
  if (model || agentId.startsWith("role_") || agentId.includes("openclaw")) {
    return "openclaw" as const;
  }
  return "unknown" as const;
}

function parseBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

async function findWorkflowForOverview(projectId: string) {
  const activeWorkflow = await prisma.workflow.findFirst({
    where: {
      projectId,
      status: "active"
    },
    include: {
      stages: true,
      template: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });
  if (activeWorkflow) {
    return activeWorkflow;
  }
  return prisma.workflow.findFirst({
    where: {
      projectId
    },
    include: {
      stages: true,
      template: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });
}

function summarizeStageArtifacts(outputArtifacts: unknown[]) {
  const sourceCounts = {
    hermes: 0,
    hermesFallback: 0,
    openclaw: 0,
    companion: 0,
    companionError: 0,
    stitch: 0,
    manual: 0,
    other: 0
  };
  const roleSet = new Set<string>();
  const agentEngineHints = new Map<string, "hermes" | "openclaw" | "unknown">();

  const applyAgentEngineHint = (agentId: string, next: "hermes" | "openclaw") => {
    const normalized = normalizeText(agentId);
    if (!normalized) {
      return;
    }
    const prev = agentEngineHints.get(normalized);
    if (!prev) {
      agentEngineHints.set(normalized, next);
      return;
    }
    if (prev !== next) {
      agentEngineHints.set(normalized, "unknown");
    }
  };

  for (const artifact of outputArtifacts) {
    const record = asRecord(artifact) ?? {};
    const metadata = asRecord(record.metadata) ?? {};
    const source = normalizeText(metadata.source).toLowerCase();
    const agentId = normalizeText(metadata.agentId);
    const role = normalizeText(metadata.role);
    const primaryRole = normalizeText(metadata.primaryRole);
    if (role.startsWith("ROLE_")) {
      roleSet.add(role);
    }
    if (primaryRole.startsWith("ROLE_")) {
      roleSet.add(primaryRole);
    }

    if (!source) {
      sourceCounts.manual += 1;
      continue;
    }
    if (source === "workflow_v2_hermes") {
      sourceCounts.hermes += 1;
      applyAgentEngineHint(agentId, "hermes");
      continue;
    }
    if (source === "workflow_v2_hermes_fallback") {
      sourceCounts.hermesFallback += 1;
      continue;
    }
    if (source === "workflow_v2_agent") {
      sourceCounts.openclaw += 1;
      applyAgentEngineHint(agentId, "openclaw");
      continue;
    }
    if (source === "workflow_v2_companion") {
      sourceCounts.companion += 1;
      applyAgentEngineHint(agentId, "openclaw");
      continue;
    }
    if (source === "workflow_v2_companion_error") {
      sourceCounts.companionError += 1;
      applyAgentEngineHint(agentId, "openclaw");
      continue;
    }
    if (source.includes("stitch")) {
      sourceCounts.stitch += 1;
      continue;
    }
    if (source.startsWith("workflow_v2_")) {
      sourceCounts.other += 1;
      continue;
    }
    sourceCounts.manual += 1;
  }

  const hasHermes = sourceCounts.hermes > 0;
  const hasOpenclaw = sourceCounts.openclaw > 0 || sourceCounts.companion > 0 || sourceCounts.companionError > 0;
  let executionEngine: "hybrid" | "hermes" | "openclaw" | "manual" | "unknown" = "unknown";
  if (hasHermes && hasOpenclaw) {
    executionEngine = "hybrid";
  } else if (hasHermes) {
    executionEngine = "hermes";
  } else if (hasOpenclaw) {
    executionEngine = "openclaw";
  } else if (sourceCounts.manual > 0) {
    executionEngine = "manual";
  }

  const roles = [...roleSet].sort();
  return {
    executionEngine,
    artifactSources: sourceCounts,
    agentEngineHints: Object.fromEntries(agentEngineHints.entries()),
    collaboration: {
      roleCount: roles.length,
      roles,
      analystInvolved: roles.includes("ROLE_ANALYST"),
      companionEvidenceCount: sourceCounts.companion + sourceCounts.companionError
    }
  };
}

function extractCollaborationArtifacts(outputArtifacts: unknown[]) {
  const artifacts = Array.isArray(outputArtifacts)
    ? (outputArtifacts as Array<Record<string, unknown>>)
    : [];
  const rows = artifacts
    .map((artifact, index) => {
      const metadata = asRecord(artifact.metadata) ?? {};
      const source = normalizeText(metadata.source).toLowerCase();
      if (source !== "workflow_v2_companion" && source !== "workflow_v2_companion_error") {
        return null;
      }
      const name = normalizeText(artifact.name) || `collaboration_${index + 1}`;
      const role = normalizeText(metadata.role);
      const primaryRole = normalizeText(metadata.primaryRole);
      const agentId = normalizeText(metadata.agentId);
      const provider = normalizeText(metadata.provider) || null;
      const model = normalizeText(metadata.model) || null;
      const generatedAt = normalizeText(metadata.generatedAt) || null;
      const knowledgeId = normalizeText(metadata.knowledgeId) || null;
      return {
        id: `${name}-${index + 1}`,
        name,
        source,
        role,
        primaryRole,
        agentId,
        provider,
        model,
        knowledgeId,
        status: source === "workflow_v2_companion_error" ? "failed" : "success",
        generatedAt,
        preview: toPreviewText(artifact.content)
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return rows.sort((left, right) => {
    const leftTime = left.generatedAt ? Date.parse(left.generatedAt) : 0;
    const rightTime = right.generatedAt ? Date.parse(right.generatedAt) : 0;
    return rightTime - leftTime;
  });
}

function buildWorkflowOverview(
  workflow: Awaited<ReturnType<typeof getActiveWorkflow>>,
  agentProfiles: Map<string, AgentRuntimeProfile>
) {
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
      const assignedAgents = asStringList(stage.assignedAgents);
      const stageArtifactSummary = summarizeStageArtifacts(outputArtifacts);
      const collaborationArtifacts = extractCollaborationArtifacts(outputArtifacts);
      return {
        id: stage.id,
        nodeId: stage.nodeId,
        templateKey: stage.templateKey,
        status: stage.status,
        assignedAgents,
        assignedAgentProfiles: assignedAgents.map((agentId) => {
          const profile = agentProfiles.get(agentId);
          const hintedEngine = (stageArtifactSummary.agentEngineHints[agentId] as AgentRuntimeProfile["engine"] | undefined) ?? "unknown";
          const fallbackEngine = inferAgentEngine({ agentId });
          const resolvedEngine = profile?.engine && profile.engine !== "unknown"
            ? profile.engine
            : hintedEngine !== "unknown"
              ? hintedEngine
              : fallbackEngine;
          const resolvedModel = profile?.model ?? null;
          const singleAgentStageFallback = assignedAgents.length === 1
            && (stageArtifactSummary.executionEngine === "hermes" || stageArtifactSummary.executionEngine === "openclaw")
              ? stageArtifactSummary.executionEngine
              : null;
          const finalEngine = resolvedEngine === "unknown" && singleAgentStageFallback
            ? singleAgentStageFallback
            : resolvedEngine;
          return {
            agentId,
            engine: finalEngine,
            model: resolvedModel
          };
        }),
        executionEngine: stageArtifactSummary.executionEngine,
        artifactSources: stageArtifactSummary.artifactSources,
        collaboration: stageArtifactSummary.collaboration,
        collaborationArtifacts,
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

  router.get("/hermes/status", asyncRoute(async (req, res) => {
    const includeProbe = parseBoolean(req.query.probe, true);
    const runtime = getHermesMcpRuntimeStatus();
    const probe = includeProbe
      ? await probeHermesMcpEndpoint()
      : {
        state: "skipped" as const,
        reachable: null,
        statusCode: null,
        latencyMs: 0,
        message: "probe_skipped"
      };
    sendSuccess(res, {
      checkedAt: new Date().toISOString(),
      runtime,
      probe
    });
  }));

  router.post("/templates", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
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
      isStandalone: Boolean(payload.isStandalone),
      standaloneCategory: normalizeText(payload.standaloneCategory) || undefined,
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
      inputContract: asRecord(payload.inputContract) ?? undefined,
      outputContract: asRecord(payload.outputContract) ?? undefined,
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

  router.post("/projects/:projectId/init", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
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

  router.post("/:workflowId/start", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
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

  router.post("/stages/:stageId/output", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
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

  router.post("/stages/:stageId/input", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    const status = await getWorkflowV2SchemaStatus();
    if (!status.ready) {
      sendError(res, 503, "SERVICE_UNAVAILABLE", `workflow-v2 schema not ready: ${status.reason || "unknown"}`);
      return;
    }
    const stageId = normalizeText(req.params.stageId);
    const payload = asRecord(req.body) ?? {};
    const name = normalizeText(payload.name) || "input.md";
    const type = normalizeText(payload.type) || "document";
    const content = String(payload.content ?? "");
    if (!stageId || !content.trim()) {
      sendError(res, 400, "VALIDATION_ERROR", "stageId and content are required");
      return;
    }
    const stage = await addStageInputArtifact({
      stageId,
      artifact: {
        name,
        type,
        content,
        createdAt: new Date().toISOString()
      }
    });
    sendSuccess(res, { stageId: stage.id, artifactCount: Array.isArray(stage.inputArtifacts) ? stage.inputArtifacts.length : 0 });
  }));

  router.post("/stages/:stageId/transition", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
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
    const workflow = await findWorkflowForOverview(projectId);
    if (!workflow) {
      sendError(res, 404, "NOT_FOUND", `No workflow found for project ${projectId}`);
      return;
    }
    const assignedAgentIds = Array.from(new Set(
      workflow.stages.flatMap((stage) => asStringList(stage.assignedAgents))
    ));
    const managedConfigs = assignedAgentIds.length > 0
      ? await prisma.managedAgentConfig.findMany({
        where: { agentId: { in: assignedAgentIds } },
        select: {
          agentId: true,
          selectedModel: true,
          defaultModel: true
        }
      })
      : [];
    const agentProfileMap = new Map<string, AgentRuntimeProfile>();
    for (const config of managedConfigs) {
      const model = normalizeText(config.selectedModel) || normalizeText(config.defaultModel) || null;
      agentProfileMap.set(config.agentId, {
        engine: inferAgentEngine({ agentId: config.agentId, model }),
        model
      });
    }
    sendSuccess(res, buildWorkflowOverview(workflow, agentProfileMap));
  }));

  return router;
}
