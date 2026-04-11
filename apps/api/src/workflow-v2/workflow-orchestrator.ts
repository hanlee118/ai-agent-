import type { RoleType, StageType } from "@occ/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { runStageAgent } from "../agents/runtime.js";
import { runScriptedAgent } from "../agents/providers/scripted-provider.js";
import { previewRequirement } from "../utils/project-parser.js";
import { assignAgentToStage } from "./agent-assignment.js";
import { evaluateWorkflowStageGate } from "./quality-gate.js";
import { maybeGenerateStitchArtifacts } from "./stitch-chain.js";
import {
  autoOrganizeKnowledge,
  buildAgentContext,
  ingestKnowledgeFromStageOutput,
  retrieveKnowledgeForContext
} from "./knowledge-service.js";
import {
  asRecord,
  asRecordArray,
  asStringArray,
  normalizeText,
  type AcceptanceCriterion,
  type ExecutorConfig,
  type IntegrationConfig,
  type StageGraph
} from "./types.js";

type TransitionAction = "proceed" | "iterate" | "rollback" | "skip";

export type WorkflowTransitionResult = {
  success: boolean;
  blocked?: boolean;
  violations?: string[];
  nextStageIds?: string[];
};

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function parseStageGraph(value: unknown): StageGraph {
  const graph = asRecord(value);
  const nodes = asRecordArray(graph?.nodes).map((node, index) => ({
    id: normalizeText(node.id) || `node_${index + 1}`,
    templateKey: normalizeText(node.templateKey) || "default",
    config: asRecord(node.config) ?? {}
  }));
  const edges = asRecordArray(graph?.edges).map((edge) => ({
    from: normalizeText(edge.from),
    to: normalizeText(edge.to),
    condition: normalizeText(edge.condition) || undefined
  })).filter((edge) => edge.from && edge.to);

  return {
    nodes,
    edges
  };
}

function parseExecutorConfig(value: unknown): ExecutorConfig {
  const config = asRecord(value) ?? {};
  const typeValue = normalizeText(config.type);
  return {
    type: typeValue === "human" || typeValue === "hybrid" ? typeValue : "agent",
    agentRole: normalizeText(config.agentRole) || undefined,
    requiredCapabilities: asStringArray(config.requiredCapabilities),
    modelPreference: normalizeText(config.modelPreference) || undefined
  };
}

function parseAcceptanceCriteria(value: unknown): AcceptanceCriterion[] {
  return asRecordArray(value).map((item) => ({
    type: normalizeText(item.type) as AcceptanceCriterion["type"],
    config: asRecord(item.config) ?? {}
  })).filter((item) => Boolean(item.type));
}

function parseIntegrationConfig(value: unknown): IntegrationConfig {
  const config = asRecord(value) ?? {};
  return {
    useStitch: Boolean(config.useStitch),
    requiredTools: asStringArray(config.requiredTools),
    webhookUrls: asStringArray(config.webhookUrls)
  };
}

function defaultGraphForTemplate(templateKey: string): StageGraph {
  if (templateKey === "standard_software_development") {
    return {
      nodes: [
        { id: "req", templateKey: "requirements_design" },
        { id: "visual", templateKey: "visual_design" },
        { id: "tech", templateKey: "tech_design" },
        { id: "dev", templateKey: "code_dev" },
        { id: "qa", templateKey: "qa_acceptance" }
      ],
      edges: [
        { from: "req", to: "visual" },
        { from: "req", to: "tech" },
        { from: "visual", to: "dev" },
        { from: "tech", to: "dev" },
        { from: "dev", to: "qa" }
      ]
    };
  }
  return {
    nodes: [{ id: "default", templateKey }],
    edges: []
  };
}

function findEntryNodeIds(graph: StageGraph) {
  const targets = new Set(graph.edges.map((edge) => edge.to));
  return graph.nodes.map((node) => node.id).filter((nodeId) => !targets.has(nodeId));
}

function isAgentAutoExecuteEnabled() {
  return String(process.env.WORKFLOW_V2_AGENT_AUTO_EXECUTE ?? "true").trim().toLowerCase() !== "false";
}

function stageAutoProceedEnabled() {
  return String(process.env.WORKFLOW_V2_STAGE_AUTO_PROCEED ?? "false").trim().toLowerCase() === "true";
}

function shouldForceScriptedWorkflowAgent() {
  const fallback = process.env.NODE_ENV === "test" ? "true" : "false";
  return String(process.env.WORKFLOW_V2_FORCE_SCRIPTED_AGENT ?? fallback).trim().toLowerCase() === "true";
}

function resolveStageType(templateKey: string): StageType {
  const normalized = normalizeText(templateKey).toLowerCase();
  if (normalized.includes("qa") || normalized.includes("accept")) {
    return "ACCEPT";
  }
  if (normalized.includes("dev") || normalized.includes("code") || normalized.includes("研发")) {
    return "DEV";
  }
  if (normalized.includes("tech") || normalized.includes("architecture")) {
    return "DEV";
  }
  if (normalized.includes("visual") || normalized.includes("design") || normalized.includes("视觉")) {
    return "DESIGN";
  }
  if (normalized.includes("requirement") || normalized.includes("analysis") || normalized.includes("需求")) {
    return "ANALYSIS";
  }
  return "INIT";
}

function resolveRole(executorConfig: ExecutorConfig, stageType: StageType): RoleType {
  const role = normalizeText(executorConfig.agentRole);
  if (role === "Project_Manager") {
    return "ROLE_PM";
  }
  if (role === "Product_Manager") {
    return "ROLE_PRODUCT";
  }
  if (role === "Requirements_Analyst") {
    return "ROLE_ANALYST";
  }
  if (role === "UI_Designer" || role === "Designer") {
    return "ROLE_DESIGN";
  }
  if (role === "Architect") {
    return "ROLE_ARCH";
  }
  if (role === "Developer") {
    return "ROLE_DEV";
  }
  if (role === "QA_Engineer" || role === "QA") {
    return "ROLE_QA";
  }
  if (stageType === "DESIGN") {
    return "ROLE_DESIGN";
  }
  if (stageType === "ANALYSIS") {
    return "ROLE_ANALYST";
  }
  if (stageType === "DEV") {
    return "ROLE_DEV";
  }
  if (stageType === "ACCEPT") {
    return "ROLE_QA";
  }
  return "ROLE_PM";
}

function expectedArtifactNames(template: { acceptanceCriteria: unknown; outputSchema: unknown }, stageKey: string) {
  const names = new Set<string>();
  const criteria = parseAcceptanceCriteria(template.acceptanceCriteria);
  for (const criterion of criteria) {
    if (criterion.type !== "artifact_exists") {
      continue;
    }
    const name = normalizeText(asRecord(criterion.config)?.artifact);
    if (name) {
      names.add(name);
    }
  }
  const schema = asRecord(template.outputSchema) ?? {};
  for (const item of asStringArray(schema.required)) {
    const normalized = normalizeText(item);
    if (normalized) {
      names.add(normalized);
    }
  }
  if (names.size === 0) {
    names.add(`${stageKey}_output`);
  }
  return Array.from(names);
}

function requiredArtifactCount(template: { acceptanceCriteria: unknown }) {
  const criteria = parseAcceptanceCriteria(template.acceptanceCriteria);
  let minCount = 1;
  for (const criterion of criteria) {
    if (criterion.type !== "artifact_exists") {
      continue;
    }
    const count = Number(asRecord(criterion.config)?.minCount ?? 0);
    if (Number.isFinite(count) && count > minCount) {
      minCount = Math.floor(count);
    }
  }
  return Math.max(1, minCount);
}

function toArtifactMarkdown(input: {
  stageKey: string;
  artifactName: string;
  body: string;
  thinkingSummary: string;
  model: string;
  provider: string;
}) {
  return [
    `## ${input.stageKey} 自动执行产物`,
    `- artifact: ${input.artifactName}`,
    `- provider: ${input.provider}`,
    `- model: ${input.model}`,
    "",
    input.body,
    "",
    "## 执行摘要",
    input.thinkingSummary
  ].join("\n");
}

async function getPreviousStageOutputs(workflowId: string, nodeId: string) {
  const workflow = await prisma.workflow.findUnique({
    where: { id: workflowId },
    select: { stageGraph: true }
  });
  if (!workflow) {
    return [] as Array<Record<string, unknown>>;
  }
  const graph = parseStageGraph(workflow.stageGraph);
  const sourceNodeIds = graph.edges.filter((edge) => edge.to === nodeId).map((edge) => edge.from);
  if (sourceNodeIds.length === 0) {
    return [] as Array<Record<string, unknown>>;
  }
  const stages = await prisma.workflowStage.findMany({
    where: {
      workflowId,
      nodeId: {
        in: sourceNodeIds
      }
    }
  });
  const outputs: Array<Record<string, unknown>> = [];
  for (const stage of stages) {
    const artifacts = Array.isArray(stage.outputArtifacts)
      ? (stage.outputArtifacts as Array<Record<string, unknown>>)
      : [];
    outputs.push(...artifacts);
  }
  return outputs;
}

async function appendStageKnowledge(projectId: string, stageKey: string, outputArtifacts: unknown[], agentId?: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId }
  });
  const projectName = project?.name ?? projectId;
  const projectDescription = project?.description ?? "workflow project";
  const artifacts = Array.isArray(outputArtifacts) ? (outputArtifacts as Array<Record<string, unknown>>) : [];
  for (const artifact of artifacts) {
    const content = String(artifact.content ?? "").trim();
    if (!content) {
      continue;
    }
    const title = normalizeText(artifact.name) || `${stageKey} artifact`;
    await ingestKnowledgeFromStageOutput({
      projectId,
      projectName,
      projectDescription,
      stageKey,
      outputText: content,
      title: `${stageKey} - ${title}`,
      agentId
    });
  }
  await autoOrganizeKnowledge({
    projectId,
    agentId,
    limit: 120
  });
}

export async function createWorkflowFromTemplate(input: {
  projectId: string;
  templateKey: string;
  name?: string;
  customGraph?: StageGraph;
}) {
  let template = await prisma.workflowTemplate.findUnique({
    where: { key: input.templateKey }
  });
  if (!template) {
    template = await prisma.workflowTemplate.findUnique({
      where: { key: "standard_software_development" }
    });
  }
  if (!template) {
    throw new Error(`Template not found: ${input.templateKey}`);
  }

  const graph = input.customGraph ?? defaultGraphForTemplate(template.key);
  const workflow = await prisma.workflow.create({
    data: {
      projectId: input.projectId,
      templateId: template.id,
      name: normalizeText(input.name) || template.name,
      stageGraph: toJson(graph),
      currentStageIds: toJson([])
    }
  });

  await prisma.workflowStage.createMany({
    data: graph.nodes.map((node) => ({
      workflowId: workflow.id,
      nodeId: node.id,
      templateKey: node.templateKey,
      status: "pending",
      assignedAgents: [],
      inputArtifacts: [],
      outputArtifacts: [],
      contextMemoryIds: []
    }))
  });

  return prisma.workflow.findUniqueOrThrow({
    where: { id: workflow.id },
    include: { stages: true, template: true }
  });
}

async function getWorkflowById(workflowId: string) {
  const workflow = await prisma.workflow.findUnique({
    where: { id: workflowId },
    include: {
      stages: true,
      template: true,
      project: true
    }
  });
  if (!workflow) {
    throw new Error("Workflow not found");
  }
  return workflow;
}

async function activateStage(stageId: string) {
  const stage = await prisma.workflowStage.findUnique({
    where: { id: stageId },
    include: {
      workflow: {
        include: {
          template: true,
          project: true
        }
      }
    }
  });
  if (!stage) {
    return null;
  }

  const template = await prisma.workflowTemplate.findUnique({
    where: { key: stage.templateKey }
  });
  if (!template) {
    return null;
  }

  const executorConfig = parseExecutorConfig(template.executorConfig);
  const assigned = await assignAgentToStage(executorConfig);
  const stageType = resolveStageType(stage.templateKey);
  const role = resolveRole(executorConfig, stageType);
  const contextQuery = `Stage ${stage.templateKey} execution for project ${stage.workflow.projectId}`;
  const context = await buildAgentContext({
    projectId: stage.workflow.projectId,
    currentStage: stage.templateKey,
    agentId: assigned.agentId,
    userQuery: contextQuery
  });
  const relevantKnowledge = await retrieveKnowledgeForContext({
    query: contextQuery,
    context: {
      projectId: stage.workflow.projectId,
      currentStage: stage.templateKey,
      agentId: assigned.agentId
    },
    topK: 5
  });

  const existingArtifacts = Array.isArray(stage.outputArtifacts)
    ? (stage.outputArtifacts as Array<Record<string, unknown>>)
    : [];
  const runningStage = await prisma.workflowStage.update({
    where: { id: stage.id },
    data: {
      assignedAgents: [assigned.agentId],
      status: "running",
      startedAt: new Date(),
      contextMemoryIds: toJson(relevantKnowledge.map((item) => item.id))
    }
  });

  const integrationConfig = parseIntegrationConfig(template.integrationConfig);
  const projectName = normalizeText(stage.workflow.project.name) || stage.workflow.projectId;
  const projectDescription = normalizeText(stage.workflow.project.description) || "workflow project";

  if (!isAgentAutoExecuteEnabled()) {
    const stitchArtifacts = await maybeGenerateStitchArtifacts({
      enabled: Boolean(integrationConfig.useStitch),
      projectId: stage.workflow.projectId,
      projectName,
      projectDescription,
      stageKey: stage.templateKey,
      summary: `activate stage ${stage.templateKey}`
    });
    const updated = await prisma.workflowStage.update({
      where: { id: stage.id },
      data: {
        outputArtifacts: toJson([...existingArtifacts, ...stitchArtifacts])
      }
    });
    return {
      stage: updated,
      assigned,
      context
    };
  }

  try {
    const previousOutputs = await getPreviousStageOutputs(stage.workflowId, stage.nodeId);
    const artifactNames = expectedArtifactNames(template, stage.templateKey);
    const parsedIntent = previewRequirement([
      projectDescription,
      contextQuery,
      context.slice(0, 4000)
    ].join("\n\n"));
    const summary = [
      `你正在执行工作流阶段：${stage.templateKey}`,
      `目标交付物：${artifactNames.join(", ")}`,
      previousOutputs.length > 0
        ? `上游阶段已有产物 ${previousOutputs.length} 份，请在输出中明确复用关系。`
        : "暂无上游阶段产物，请先给出本阶段最小可执行方案。",
      "要求：输出必须可直接落地，避免任何未完成标记。",
      `知识上下文：\n${context.slice(0, 4000)}`
    ].join("\n\n");
    const run = shouldForceScriptedWorkflowAgent()
      ? await runScriptedAgent({
        projectName,
        projectDescription,
        parsedIntent,
        stageType,
        role,
        summary
      })
      : await runStageAgent({
        projectName,
        projectDescription,
        parsedIntent,
        stageType,
        role,
        summary
      });

    const generatedAt = new Date().toISOString();
    const generatedArtifacts = artifactNames.map((name, index) => ({
      name,
      type: "markdown",
      content: toArtifactMarkdown({
        stageKey: stage.templateKey,
        artifactName: name,
        body: String(run.body || "").trim(),
        thinkingSummary: String(run.thinkingSummary || "").trim(),
        model: String(run.model || "unknown"),
        provider: String(run.provider || "unknown")
      }),
      metadata: {
        autoGenerated: true,
        source: "workflow_v2_agent",
        role,
        stageType,
        agentId: assigned.agentId,
        model: run.model,
        provider: run.provider,
        generatedAt,
        artifactIndex: index
      }
    }));

    const requiredCount = requiredArtifactCount(template);
    while (generatedArtifacts.length < requiredCount) {
      const extraIndex = generatedArtifacts.length + 1;
      generatedArtifacts.push({
        name: `${artifactNames[0]}_${extraIndex}`,
        type: "markdown",
        content: toArtifactMarkdown({
          stageKey: stage.templateKey,
          artifactName: `${artifactNames[0]}_${extraIndex}`,
          body: String(run.body || "").trim(),
          thinkingSummary: `补足 artifact_count(${requiredCount}) 的辅助产物`,
          model: String(run.model || "unknown"),
          provider: String(run.provider || "unknown")
        }),
        metadata: {
          autoGenerated: true,
          source: "workflow_v2_agent",
          role,
          stageType,
          agentId: assigned.agentId,
          model: run.model,
          provider: run.provider,
          generatedAt,
          artifactIndex: extraIndex
        }
      });
    }

    const stitchArtifacts = await maybeGenerateStitchArtifacts({
      enabled: Boolean(integrationConfig.useStitch),
      projectId: stage.workflow.projectId,
      projectName,
      projectDescription,
      stageKey: stage.templateKey,
      summary: String(run.thinkingSummary || run.title || "").trim() || `stage ${stage.templateKey} execution`
    });

    const finalArtifacts = [
      ...existingArtifacts,
      ...generatedArtifacts,
      ...stitchArtifacts
    ];
    const gateResults = await evaluateWorkflowStageGate({
      stage: {
        ...runningStage,
        outputArtifacts: finalArtifacts as Prisma.JsonValue
      },
      acceptanceCriteria: parseAcceptanceCriteria(template.acceptanceCriteria)
    });
    const updated = await prisma.workflowStage.update({
      where: { id: stage.id },
      data: {
        status: "reviewing",
        completedAt: new Date(),
        outputArtifacts: toJson(finalArtifacts),
        gateResults: toJson(gateResults)
      }
    });

    return {
      stage: updated,
      assigned,
      context
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const failedArtifacts = [
      ...existingArtifacts,
      {
        name: "execution_error.md",
        type: "markdown",
        content: [
          "## Workflow 阶段自动执行失败",
          `- stage: ${stage.templateKey}`,
          `- agent: ${assigned.agentId}`,
          `- reason: ${reason}`
        ].join("\n"),
        metadata: {
          autoGenerated: true,
          source: "workflow_v2_agent",
          role,
          stageType,
          failedAt: new Date().toISOString()
        }
      }
    ];
    const failed = await prisma.workflowStage.update({
      where: { id: stage.id },
      data: {
        status: "failed",
        outputArtifacts: toJson(failedArtifacts),
        gateResults: toJson({
          passed: false,
          violations: [`execution_failed: ${reason}`],
          checks: [{ type: "agent_run", passed: false, details: reason }]
        })
      }
    });
    return {
      stage: failed,
      assigned,
      context
    };
  }
}

async function maybeAutoProceedStage(input: {
  workflowId: string;
  stageId: string;
  triggeredBy: string;
}) {
  if (!stageAutoProceedEnabled()) {
    return;
  }
  await transitionWorkflowStage({
    workflowId: input.workflowId,
    stageId: input.stageId,
    action: "proceed",
    triggeredBy: input.triggeredBy,
    reason: "auto proceed after autonomous stage execution"
  });
}

function isActivatedStageResult(
  value: Awaited<ReturnType<typeof activateStage>>
): value is NonNullable<Awaited<ReturnType<typeof activateStage>>> {
  return Boolean(value);
}

export async function startWorkflow(workflowId: string) {
  const workflow = await getWorkflowById(workflowId);
  const graph = parseStageGraph(workflow.stageGraph);
  const entryNodeIds = findEntryNodeIds(graph);
  const stageMap = new Map(workflow.stages.map((stage) => [stage.nodeId, stage.id]));
  const stageIds = entryNodeIds.map((nodeId) => stageMap.get(nodeId)).filter((id): id is string => Boolean(id));

  const activationResults = await Promise.all(stageIds.map((id) => activateStage(id)));
  await prisma.workflow.update({
    where: { id: workflowId },
    data: {
      status: "active",
      currentStageIds: stageIds
    }
  });
  const activatedStages = activationResults.filter(isActivatedStageResult);
  await Promise.all(
    activatedStages
      .filter((item) => item.stage.status === "reviewing")
      .map((item) => maybeAutoProceedStage({
        workflowId: item.stage.workflowId,
        stageId: item.stage.id,
        triggeredBy: item.assigned.agentId
      }))
  );
}

function resolveNextNodeIds(graph: StageGraph, nodeId: string) {
  return graph.edges.filter((edge) => edge.from === nodeId).map((edge) => edge.to);
}

function resolveRollbackNodeIds(graph: StageGraph, nodeId: string) {
  return graph.edges.filter((edge) => edge.to === nodeId).map((edge) => edge.from);
}

async function resolveStageIdsByNode(workflowId: string, nodeIds: string[]) {
  if (nodeIds.length === 0) {
    return [] as string[];
  }
  const stages = await prisma.workflowStage.findMany({
    where: {
      workflowId,
      nodeId: { in: nodeIds }
    }
  });
  const map = new Map(stages.map((stage) => [stage.nodeId, stage.id]));
  return nodeIds.map((nodeId) => map.get(nodeId)).filter((id): id is string => Boolean(id));
}

async function updateStageStatus(stageId: string, action: TransitionAction) {
  if (action === "proceed") {
    return prisma.workflowStage.update({
      where: { id: stageId },
      data: { status: "completed", completedAt: new Date() }
    });
  }
  if (action === "iterate") {
    return prisma.workflowStage.update({
      where: { id: stageId },
      data: { status: "running", startedAt: new Date() }
    });
  }
  if (action === "skip") {
    return prisma.workflowStage.update({
      where: { id: stageId },
      data: { status: "skipped", completedAt: new Date() }
    });
  }
  return prisma.workflowStage.update({
    where: { id: stageId },
    data: { status: "pending" }
  });
}

export async function transitionWorkflowStage(input: {
  workflowId: string;
  stageId: string;
  action: TransitionAction;
  triggeredBy: string;
  reason?: string;
}): Promise<WorkflowTransitionResult> {
  const workflow = await getWorkflowById(input.workflowId);
  const stage = workflow.stages.find((item) => item.id === input.stageId);
  if (!stage) {
    throw new Error("Stage not found");
  }

  const template = await prisma.workflowTemplate.findUnique({
    where: { key: stage.templateKey }
  });
  if (!template) {
    throw new Error(`Template not found for stage: ${stage.templateKey}`);
  }

  const acceptanceCriteria = parseAcceptanceCriteria(template.acceptanceCriteria);
  if (input.action === "proceed" && acceptanceCriteria.length > 0) {
    const gate = await evaluateWorkflowStageGate({
      stage,
      acceptanceCriteria
    });
    if (!gate.passed) {
      await prisma.workflowStage.update({
        where: { id: stage.id },
        data: {
          gateResults: gate
        }
      });
      return {
        success: false,
        blocked: true,
        violations: gate.violations
      };
    }
    await prisma.workflowStage.update({
      where: { id: stage.id },
      data: {
        gateResults: gate
      }
    });
  }

  const updatedStage = await updateStageStatus(stage.id, input.action);
  if (input.action === "proceed" || input.action === "iterate") {
    const agentId = asStringArray(updatedStage.assignedAgents)[0];
    await appendStageKnowledge(
      workflow.projectId,
      updatedStage.templateKey,
      Array.isArray(updatedStage.outputArtifacts) ? updatedStage.outputArtifacts : [],
      agentId
    );
  }

  const graph = parseStageGraph(workflow.stageGraph);
  const nextNodeIds = input.action === "proceed"
    ? resolveNextNodeIds(graph, stage.nodeId)
    : input.action === "rollback"
      ? resolveRollbackNodeIds(graph, stage.nodeId)
      : [];
  const nextStageIds = await resolveStageIdsByNode(workflow.id, nextNodeIds);
  if (nextStageIds.length > 0) {
    const activationResults = await Promise.all(nextStageIds.map((id) => activateStage(id)));
    const activatedStages = activationResults.filter(isActivatedStageResult);
    await Promise.all(
      activatedStages
        .filter((item) => item.stage.status === "reviewing")
        .map((item) => maybeAutoProceedStage({
          workflowId: item.stage.workflowId,
          stageId: item.stage.id,
          triggeredBy: item.assigned.agentId
        }))
    );
  }

  await prisma.workflowTransition.create({
    data: {
      workflowId: workflow.id,
      fromStageId: stage.id,
      toStageId: nextStageIds[0] ?? null,
      action: input.action,
      triggeredBy: input.triggeredBy,
      reason: input.reason ?? null
    }
  });

  await prisma.workflow.update({
    where: { id: workflow.id },
    data: {
      currentStageIds: nextStageIds,
      status: nextStageIds.length > 0 ? "active" : "completed"
    }
  });

  return {
    success: true,
    nextStageIds
  };
}

export async function getActiveWorkflow(projectId: string) {
  const workflow = await prisma.workflow.findFirst({
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
  if (!workflow) {
    throw new Error(`No active workflow for project ${projectId}`);
  }
  return workflow;
}

export async function upsertWorkflowTemplate(input: {
  key: string;
  name: string;
  description?: string;
  category: string;
  executorConfig: ExecutorConfig;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  acceptanceCriteria?: AcceptanceCriterion[];
  integrationConfig?: IntegrationConfig;
  defaultTimeout?: number | null;
  allowParallel?: boolean;
}) {
  const key = normalizeText(input.key);
  if (!key) {
    throw new Error("template key is required");
  }

  return prisma.workflowTemplate.upsert({
    where: { key },
    create: {
      key,
      name: normalizeText(input.name) || key,
      description: normalizeText(input.description) || null,
      category: normalizeText(input.category) || "custom",
      executorConfig: input.executorConfig,
      inputSchema: toJson(input.inputSchema ?? {}),
      outputSchema: toJson(input.outputSchema ?? {}),
      acceptanceCriteria: toJson(input.acceptanceCriteria ?? []),
      integrationConfig: toJson(input.integrationConfig ?? {}),
      defaultTimeout: input.defaultTimeout ?? null,
      allowParallel: Boolean(input.allowParallel)
    },
    update: {
      name: normalizeText(input.name) || key,
      description: normalizeText(input.description) || null,
      category: normalizeText(input.category) || "custom",
      executorConfig: input.executorConfig,
      inputSchema: toJson(input.inputSchema ?? {}),
      outputSchema: toJson(input.outputSchema ?? {}),
      acceptanceCriteria: toJson(input.acceptanceCriteria ?? []),
      integrationConfig: toJson(input.integrationConfig ?? {}),
      defaultTimeout: input.defaultTimeout ?? null,
      allowParallel: Boolean(input.allowParallel)
    }
  });
}

export async function listWorkflowTemplates(category?: string) {
  const normalized = normalizeText(category);
  return prisma.workflowTemplate.findMany({
    where: normalized ? { category: normalized } : undefined,
    orderBy: {
      createdAt: "desc"
    }
  });
}

export async function addStageOutputArtifact(input: {
  stageId: string;
  artifact: Record<string, unknown>;
}) {
  const stage = await prisma.workflowStage.findUnique({
    where: { id: input.stageId }
  });
  if (!stage) {
    throw new Error("Stage not found");
  }
  const artifacts = Array.isArray(stage.outputArtifacts)
    ? (stage.outputArtifacts as Array<Record<string, unknown>>)
    : [];
  artifacts.push(input.artifact);
  return prisma.workflowStage.update({
    where: { id: stage.id },
    data: {
      outputArtifacts: toJson(artifacts)
    }
  });
}
