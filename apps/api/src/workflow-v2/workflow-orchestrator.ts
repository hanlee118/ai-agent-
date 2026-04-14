import type { RoleType, StageType } from "@occ/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { runStageAgent } from "../agents/runtime.js";
import { runScriptedAgent } from "../agents/providers/scripted-provider.js";
import { previewRequirement } from "../utils/project-parser.js";
import { assignAgentToStage } from "./agent-assignment.js";
import { evaluateWorkflowStageGate } from "./quality-gate.js";
import { maybeGenerateStitchArtifacts } from "./stitch-chain.js";
import { tryRunStageWithHermes } from "./hermes-mcp.js";
import {
  bindProjectInputsToWorkflowEntryStages,
  validateStageInputContract
} from "./project-modes.js";
import {
  autoOrganizeKnowledge,
  buildAgentContext,
  ingestKnowledgeFromStageOutput,
  retrieveKnowledgeForContext
} from "./knowledge-service.js";
import { getStageCompanionRoles } from "../system/project-stage-execution.js";
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

function parseFlag(value: string | undefined, defaultValue: boolean) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function shouldForceScriptedWorkflowAgent() {
  const fallback = process.env.NODE_ENV === "test" ? "true" : "false";
  return String(process.env.WORKFLOW_V2_FORCE_SCRIPTED_AGENT ?? fallback).trim().toLowerCase() === "true";
}

function shouldEnforceWorkflowV2RoleCollaboration() {
  return parseFlag(process.env.WORKFLOW_V2_REQUIRE_ANALYST_COLLAB, true);
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

function roleToExecutorAgentRole(role: RoleType): string {
  if (role === "ROLE_PM") {
    return "Project_Manager";
  }
  if (role === "ROLE_PRODUCT") {
    return "Product_Manager";
  }
  if (role === "ROLE_ANALYST") {
    return "Requirements_Analyst";
  }
  if (role === "ROLE_DESIGN") {
    return "UI_Designer";
  }
  if (role === "ROLE_ARCH") {
    return "Architect";
  }
  if (role === "ROLE_DEV") {
    return "Developer";
  }
  if (role === "ROLE_QA") {
    return "QA_Engineer";
  }
  return "Project_Manager";
}

function dedupeStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of values) {
    const normalized = normalizeText(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function resolveLegacyCurrentRoleByStageType(stageType: StageType): RoleType {
  if (stageType === "ANALYSIS") {
    return "ROLE_ANALYST";
  }
  if (stageType === "DESIGN") {
    return "ROLE_DESIGN";
  }
  if (stageType === "DEV") {
    return "ROLE_DEV";
  }
  if (stageType === "ACCEPT") {
    return "ROLE_QA";
  }
  return "ROLE_PM";
}

const WORKFLOW_STAGE_TERMINAL_STATUS = new Set(["completed", "skipped", "failed"]);
const WORKFLOW_STAGE_COMPLETED_STATUS = new Set(["completed", "skipped"]);
const TASK_TERMINAL_STATUS = new Set(["done", "completed", "cancelled", "rejected"]);
const WORKFLOW_V2_AGENT_TIMEOUT_MS = Math.max(
  60_000,
  Number(process.env.WORKFLOW_V2_AGENT_TIMEOUT_MS ?? 180_000)
);

async function withWorkflowAgentTimeout<T>(promise: Promise<T>, context: string, timeoutMs = WORKFLOW_V2_AGENT_TIMEOUT_MS) {
  const effectiveTimeoutMs = Math.max(1_000, Math.round(timeoutMs));
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`WORKFLOW_V2_AGENT_TIMEOUT: ${context} exceeded ${effectiveTimeoutMs}ms`));
    }, effectiveTimeoutMs);

    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }).catch((error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function syncLegacyProjectStateFromWorkflow(workflowId: string) {
  console.warn(`[workflow-v2][sync] start workflow=${workflowId}`);
  const workflow = await prisma.workflow.findUnique({
    where: { id: workflowId },
    include: {
      stages: true
    }
  });
  if (!workflow) {
    console.warn(`[workflow-v2][sync] workflow not found ${workflowId}`);
    return;
  }

  const currentStageIds = asStringArray(workflow.currentStageIds);
  const stageById = new Map(workflow.stages.map((item) => [item.id, item]));
  const currentStages = currentStageIds
    .map((id) => stageById.get(id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const primaryCurrentStage = currentStages[0];
  const inferredCurrentStageType = primaryCurrentStage
    ? resolveStageType(primaryCurrentStage.templateKey)
    : "INIT";
  const completedStageCount = workflow.stages.filter((item) => (
    WORKFLOW_STAGE_COMPLETED_STATUS.has(normalizeText(item.status).toLowerCase())
  )).length;
  const totalStages = Math.max(1, workflow.stages.length);
  const inferredProgress = workflow.status === "completed"
    ? 100
    : Math.max(4, Math.min(96, Math.round((completedStageCount / totalStages) * 100)));
  console.warn(
    `[workflow-v2][sync] workflow=${workflowId} status=${workflow.status} inferredStage=${inferredCurrentStageType} currentStageIds=${currentStageIds.join(",")}`
  );

  if (normalizeText(workflow.status).toLowerCase() === "completed") {
    await prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: workflow.projectId },
        data: {
          status: "completed",
          currentStage: "ACCEPT",
          currentRole: "ROLE_QA",
          pendingApproval: false,
          progress: 100
        }
      });
      await tx.stage.updateMany({
        where: { projectId: workflow.projectId },
        data: {
          status: "completed",
          progress: 100,
          endedAt: new Date()
        }
      });
      await tx.task.updateMany({
        where: {
          projectId: workflow.projectId,
          status: {
            notIn: Array.from(TASK_TERMINAL_STATUS)
          }
        },
        data: {
          status: "completed"
        }
      });
    });
    return;
  }

  const hasActiveWorkflowStage = currentStages.some((item) => (
    !WORKFLOW_STAGE_TERMINAL_STATUS.has(normalizeText(item.status).toLowerCase())
  ));
  const legacyCurrentStage = hasActiveWorkflowStage ? inferredCurrentStageType : "INIT";
  await prisma.$transaction(async (tx) => {
    await tx.project.update({
      where: { id: workflow.projectId },
      data: {
        status: "active",
        currentStage: legacyCurrentStage,
        currentRole: resolveLegacyCurrentRoleByStageType(legacyCurrentStage),
        pendingApproval: false,
        progress: inferredProgress
      }
    });

    const legacyStages = await tx.stage.findMany({
      where: { projectId: workflow.projectId },
      orderBy: { sortOrder: "asc" }
    });
    const legacyStageOrder: StageType[] = ["INIT", "ANALYSIS", "DESIGN", "DEV", "ACCEPT"];
    const currentOrder = legacyStageOrder.indexOf(legacyCurrentStage);
    for (const stage of legacyStages) {
      const stageOrder = legacyStageOrder.indexOf(stage.type as StageType);
      const isCurrent = stage.type === legacyCurrentStage;
      const nextStatus: "pending" | "active" | "completed" =
        isCurrent
          ? "active"
          : (stageOrder >= 0 && currentOrder >= 0 && stageOrder < currentOrder ? "completed" : "pending");
      const nextProgress = nextStatus === "completed" ? 100 : (isCurrent ? Math.max(stage.progress ?? 0, 18) : 0);
      await tx.stage.update({
        where: { id: stage.id },
        data: {
          status: nextStatus,
          progress: nextProgress,
          startedAt: isCurrent ? (stage.startedAt ?? new Date()) : stage.startedAt,
          endedAt: nextStatus === "completed" ? (stage.endedAt ?? new Date()) : null
        }
      });
    }
  });
  console.warn(`[workflow-v2][sync] done workflow=${workflowId}`);
}

function toCompanionArtifactMarkdown(input: {
  stageKey: string;
  role: RoleType;
  body: string;
  thinkingSummary: string;
  model: string;
  provider: string;
}) {
  return [
    `## ${input.stageKey} 阶段协作复核`,
    `- role: ${input.role}`,
    `- provider: ${input.provider}`,
    `- model: ${input.model}`,
    "",
    input.body,
    "",
    "## 复核摘要",
    input.thinkingSummary
  ].join("\n");
}

function evaluateStageRoleCollaborationEvidence(stage: {
  templateKey: string;
  outputArtifacts: unknown;
}) {
  if (!shouldEnforceWorkflowV2RoleCollaboration()) {
    return {
      passed: true,
      checks: [{
        type: "role_collaboration",
        passed: true,
        details: "role collaboration check disabled"
      }],
      violations: [] as string[]
    };
  }

  const artifacts = Array.isArray(stage.outputArtifacts)
    ? (stage.outputArtifacts as Array<Record<string, unknown>>)
    : [];

  const workflowGeneratedArtifacts = artifacts.filter((item) => {
    const metadata = asRecord(item.metadata) ?? {};
    const source = normalizeText(metadata.source).toLowerCase();
    return Boolean(metadata.autoGenerated) && source.startsWith("workflow_v2_");
  });

  // Manual mode (no workflow-generated artifacts) should not be blocked by this gate.
  if (workflowGeneratedArtifacts.length === 0) {
    return {
      passed: true,
      checks: [{
        type: "role_collaboration",
        passed: true,
        details: "manual artifacts detected; collaboration gate skipped"
      }],
      violations: [] as string[]
    };
  }

  const roleSet = new Set<RoleType>();
  for (const artifact of workflowGeneratedArtifacts) {
    const metadata = asRecord(artifact.metadata) ?? {};
    const role = normalizeText(metadata.role) as RoleType;
    if (role.startsWith("ROLE_")) {
      roleSet.add(role);
    }
  }

  const minRoles = Math.max(2, Number(process.env.WORKFLOW_V2_MIN_STAGE_ROLE_EVIDENCE ?? 2));
  const requireAnalyst = parseFlag(process.env.WORKFLOW_V2_STAGE_REQUIRE_ANALYST, true);
  const analystReady = roleSet.has("ROLE_ANALYST");
  const nonAnalystReady = Array.from(roleSet).some((role) => role !== "ROLE_ANALYST");
  const roleCountReady = roleSet.size >= minRoles;
  const violations: string[] = [];

  if (!roleCountReady) {
    violations.push(`role collaboration evidence < ${minRoles} (actual: ${roleSet.size})`);
  }
  if (requireAnalyst && !analystReady) {
    violations.push("missing ROLE_ANALYST collaboration evidence");
  }
  if (requireAnalyst && !nonAnalystReady) {
    violations.push("missing non-ROLE_ANALYST collaboration evidence");
  }

  return {
    passed: violations.length === 0,
    checks: [{
      type: "role_collaboration",
      passed: violations.length === 0,
      details: `roles=${Array.from(roleSet).join(", ") || "none"}; requireAnalyst=${requireAnalyst}; minRoles=${minRoles}`
    }],
    violations
  };
}

function mergeGateResults(
  base: {
    passed: boolean;
    violations?: string[];
    checks?: Array<{ type: string; passed: boolean; details: string }>;
  },
  extra: {
    passed: boolean;
    violations?: string[];
    checks?: Array<{ type: string; passed: boolean; details: string }>;
  }
) {
  const mergedViolations = [
    ...(Array.isArray(base.violations) ? base.violations : []),
    ...(Array.isArray(extra.violations) ? extra.violations : [])
  ];
  const mergedChecks = [
    ...(Array.isArray(base.checks) ? base.checks : []),
    ...(Array.isArray(extra.checks) ? extra.checks : [])
  ];
  return {
    passed: Boolean(base.passed) && Boolean(extra.passed),
    violations: mergedViolations.length > 0 ? mergedViolations : undefined,
    checks: mergedChecks.length > 0 ? mergedChecks : undefined
  };
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

async function appendStageKnowledge(input: {
  projectId: string;
  stageId: string;
  stageKey: string;
  outputArtifacts: unknown[];
  agentId?: string;
}) {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId }
  });
  const projectName = project?.name ?? input.projectId;
  const projectDescription = project?.description ?? "workflow project";
  const artifacts = Array.isArray(input.outputArtifacts) ? (input.outputArtifacts as Array<Record<string, unknown>>) : [];
  const nextArtifacts = [...artifacts];
  const linkedKnowledgeIds: string[] = [];

  for (let index = 0; index < artifacts.length; index += 1) {
    const artifact = artifacts[index];
    const content = String(artifact.content ?? "").trim();
    if (!content) {
      continue;
    }
    const title = normalizeText(artifact.name) || `${input.stageKey} artifact`;
    const metadata = asRecord(artifact.metadata) ?? {};
    const created = await ingestKnowledgeFromStageOutput({
      projectId: input.projectId,
      projectName,
      projectDescription,
      stageKey: input.stageKey,
      outputText: content,
      title: `${input.stageKey} - ${title}`,
      agentId: input.agentId,
      metadata: {
        workflowStageId: input.stageId,
        sourceArtifactName: title,
        sourceArtifactIndex: index,
        sourceArtifactType: normalizeText(artifact.type) || null,
        source: normalizeText(metadata.source) || null,
        role: normalizeText(metadata.role) || null,
        primaryRole: normalizeText(metadata.primaryRole) || null,
        provider: normalizeText(metadata.provider) || null,
        model: normalizeText(metadata.model) || null,
        generatedAt: normalizeText(metadata.generatedAt) || null
      }
    });
    linkedKnowledgeIds.push(created.id);
    nextArtifacts[index] = {
      ...artifact,
      metadata: {
        ...metadata,
        knowledgeId: created.id,
        knowledgeLinkedAt: new Date().toISOString()
      }
    };
  }

  const existingStage = await prisma.workflowStage.findUnique({
    where: { id: input.stageId },
    select: { contextMemoryIds: true }
  });
  const mergedContextMemoryIds = dedupeStrings([
    ...asStringArray(existingStage?.contextMemoryIds),
    ...linkedKnowledgeIds
  ]);
  await prisma.workflowStage.update({
    where: { id: input.stageId },
    data: {
      outputArtifacts: toJson(nextArtifacts),
      contextMemoryIds: toJson(mergedContextMemoryIds)
    }
  });

  await autoOrganizeKnowledge({
    projectId: input.projectId,
    agentId: input.agentId,
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

  await bindProjectInputsToWorkflowEntryStages({
    workflowId: workflow.id,
    projectId: input.projectId,
    entryNodeIds: findEntryNodeIds(graph)
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

  const inputContractGate = validateStageInputContract({
    stageInputArtifacts: stage.inputArtifacts,
    templateInputContract: template.inputContract
  });
  if (!inputContractGate.passed) {
    const pending = await prisma.workflowStage.update({
      where: { id: stage.id },
      data: {
        status: "pending",
        gateResults: toJson({
          passed: false,
          violations: inputContractGate.violations ?? ["input contract validation failed"],
          checks: inputContractGate.checks
        })
      }
    });
    return {
      stage: pending,
      assigned: {
        agentId: "input_contract_gate",
        role: "CUSTOM" as const,
        model: null,
        confidence: 0.99,
        reasons: ["blocked_by_input_contract"]
      },
      context: "input contract gate blocked stage activation"
    };
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
    const stageInputs = Array.isArray(stage.inputArtifacts)
      ? (stage.inputArtifacts as Array<Record<string, unknown>>)
      : [];
    const executionInputs = [...stageInputs, ...previousOutputs];
    const artifactNames = expectedArtifactNames(template, stage.templateKey);
    const parsedIntent = previewRequirement([
      projectDescription,
      contextQuery,
      context.slice(0, 4000)
    ].join("\n\n"));
    const summary = [
      `你正在执行工作流阶段：${stage.templateKey}`,
      `目标交付物：${artifactNames.join(", ")}`,
      executionInputs.length > 0
        ? `可用输入 ${executionInputs.length} 份（项目输入 + 上游产物），请在输出中明确复用关系。`
        : "暂无项目输入或上游阶段产物，请先给出本阶段最小可执行方案。",
      "要求：输出必须可直接落地，避免任何未完成标记。",
      `知识上下文：\n${context.slice(0, 4000)}`
    ].join("\n\n");
    const hermesRun = await tryRunStageWithHermes({
      stageId: stage.id,
      stageKey: stage.templateKey,
      projectId: stage.workflow.projectId,
      summary,
      context,
      previousOutputs: executionInputs,
      expectedSkills: executorConfig.requiredCapabilities
    });
    const run = hermesRun ?? (
      shouldForceScriptedWorkflowAgent()
        ? await withWorkflowAgentTimeout(
          runScriptedAgent({
            projectName,
            projectDescription,
            parsedIntent,
            stageType,
            role,
            summary
          }),
          `${stage.templateKey}/${role}/scripted-primary`
        )
        : await withWorkflowAgentTimeout(
          runStageAgent({
            projectName,
            projectDescription,
            parsedIntent,
            stageType,
            role,
            summary
          }),
          `${stage.templateKey}/${role}/primary`
        )
    );
    const executionSource = hermesRun ? "workflow_v2_hermes" : "workflow_v2_agent";
    const companionRoles = getStageCompanionRoles(stageType, role);
    const companionArtifacts: Array<Record<string, unknown>> = [];
    const companionAssignedAgentIds: string[] = [];

    for (const companionRole of companionRoles) {
      try {
        const companionAssigned = await assignAgentToStage({
          type: "agent",
          agentRole: roleToExecutorAgentRole(companionRole),
          requiredCapabilities: [],
          modelPreference: undefined
        });
        companionAssignedAgentIds.push(companionAssigned.agentId);
        const companionSummary = [
          `你是 ${companionRole}，请对阶段 ${stage.templateKey} 的主执行输出做独立复核并给出可执行建议。`,
          `主执行角色: ${role}`,
          `目标交付物: ${artifactNames.join(", ")}`,
          `主执行摘要: ${String(run.thinkingSummary || "").slice(0, 800) || "无"}`,
          `上下文: ${context.slice(0, 2000)}`
        ].join("\n");

        const companionRun = shouldForceScriptedWorkflowAgent()
          ? await withWorkflowAgentTimeout(
            runScriptedAgent({
              projectName,
              projectDescription,
              parsedIntent,
              stageType,
              role: companionRole,
              summary: companionSummary
            }),
            `${stage.templateKey}/${companionRole}/scripted-companion`
          )
          : await withWorkflowAgentTimeout(
            runStageAgent({
              projectName,
              projectDescription,
              parsedIntent,
              stageType,
              role: companionRole,
              summary: companionSummary
            }),
            `${stage.templateKey}/${companionRole}/companion`
          );

        companionArtifacts.push({
          name: `companion_review_${String(companionRole).toLowerCase()}.md`,
          type: "markdown",
          content: toCompanionArtifactMarkdown({
            stageKey: stage.templateKey,
            role: companionRole,
            body: String(companionRun.body || "").trim(),
            thinkingSummary: String(companionRun.thinkingSummary || "").trim(),
            model: String(companionRun.model || "unknown"),
            provider: String(companionRun.provider || "unknown")
          }),
          metadata: {
            autoGenerated: true,
            source: "workflow_v2_companion",
            role: companionRole,
            primaryRole: role,
            stageType,
            agentId: companionAssigned.agentId,
            provider: companionRun.provider,
            model: companionRun.model,
            generatedAt: new Date().toISOString()
          }
        });
      } catch (companionError) {
        const reason = companionError instanceof Error ? companionError.message : String(companionError);
        companionArtifacts.push({
          name: `companion_review_${String(companionRole).toLowerCase()}_error.md`,
          type: "markdown",
          content: [
            "## Companion Review Failed",
            `- role: ${companionRole}`,
            `- reason: ${reason}`
          ].join("\n"),
          metadata: {
            autoGenerated: true,
            source: "workflow_v2_companion_error",
            primaryRole: role,
            stageType,
            failedAt: new Date().toISOString()
          }
        });
      }
    }

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
        source: executionSource,
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
          source: executionSource,
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
    const hermesArtifacts = hermesRun
      ? hermesRun.artifacts.map((item, index) => ({
        name: normalizeText(item.name) || `hermes_artifact_${index + 1}`,
        type: normalizeText(item.type) || "text",
        content: String(item.content ?? ""),
        metadata: {
          autoGenerated: true,
          source: "workflow_v2_hermes",
          role,
          stageType,
          agentId: assigned.agentId,
          format: normalizeText(item.format) || "unknown",
          generatedAt,
          artifactIndex: index + 1
        }
      }))
      : [];
    const hermesTraceArtifact = hermesRun
      ? [{
        name: "hermes_execution_trace.json",
        type: "json",
        content: JSON.stringify(hermesRun.raw, null, 2),
        metadata: {
          autoGenerated: true,
          source: "workflow_v2_hermes",
          role,
          stageType,
          agentId: assigned.agentId,
          generatedAt
        }
      }]
      : [];
    const runTitle = "title" in run ? String(run.title ?? "") : "";

    const stitchArtifacts = await maybeGenerateStitchArtifacts({
      enabled: Boolean(integrationConfig.useStitch),
      projectId: stage.workflow.projectId,
      projectName,
      projectDescription,
      stageKey: stage.templateKey,
      summary: String(run.thinkingSummary || runTitle || "").trim() || `stage ${stage.templateKey} execution`
    });

    const finalArtifacts = [
      ...existingArtifacts,
      ...generatedArtifacts,
      ...hermesArtifacts,
      ...hermesTraceArtifact,
      ...companionArtifacts,
      ...stitchArtifacts
    ];
    const gateResults = await evaluateWorkflowStageGate({
      stage: {
        ...runningStage,
        outputArtifacts: finalArtifacts as Prisma.JsonValue
      },
      acceptanceCriteria: parseAcceptanceCriteria(template.acceptanceCriteria)
    });
    const roleCollaboration = evaluateStageRoleCollaborationEvidence({
      templateKey: stage.templateKey,
      outputArtifacts: finalArtifacts
    });
    const mergedGateResults = mergeGateResults(gateResults, {
      passed: roleCollaboration.passed,
      violations: roleCollaboration.violations,
      checks: roleCollaboration.checks
    });
    const stageAssignedAgents = dedupeStrings([assigned.agentId, ...companionAssignedAgentIds]);
    const updated = await prisma.workflowStage.update({
      where: { id: stage.id },
      data: {
        assignedAgents: stageAssignedAgents,
        status: "reviewing",
        completedAt: new Date(),
        outputArtifacts: toJson(finalArtifacts),
        gateResults: toJson(mergedGateResults)
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
  await syncLegacyProjectStateFromWorkflow(workflowId);
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

function sameStageIdList(a: string[], b: string[]) {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
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
  if (input.action === "proceed") {
    const gate = await evaluateWorkflowStageGate({
      stage,
      acceptanceCriteria
    });
    const roleCollaboration = evaluateStageRoleCollaborationEvidence({
      templateKey: stage.templateKey,
      outputArtifacts: stage.outputArtifacts
    });
    const mergedGate = mergeGateResults(gate, {
      passed: roleCollaboration.passed,
      violations: roleCollaboration.violations,
      checks: roleCollaboration.checks
    });
    if (!mergedGate.passed) {
      await prisma.workflowStage.update({
        where: { id: stage.id },
        data: {
          gateResults: mergedGate
        }
      });
      return {
        success: false,
        blocked: true,
        violations: mergedGate.violations
      };
    }
    await prisma.workflowStage.update({
      where: { id: stage.id },
      data: {
        gateResults: mergedGate
      }
    });
  }

  const updatedStage = await updateStageStatus(stage.id, input.action);
  if (input.action === "proceed" || input.action === "iterate") {
    const agentId = asStringArray(updatedStage.assignedAgents)[0];
    await appendStageKnowledge({
      projectId: workflow.projectId,
      stageId: updatedStage.id,
      stageKey: updatedStage.templateKey,
      outputArtifacts: Array.isArray(updatedStage.outputArtifacts) ? updatedStage.outputArtifacts : [],
      agentId
    });
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

  const latestWorkflow = await prisma.workflow.findUnique({
    where: { id: workflow.id },
    select: {
      status: true,
      currentStageIds: true
    }
  });
  const latestStageIds = asStringArray(latestWorkflow?.currentStageIds);
  const candidateStageIds = dedupeStrings([
    ...latestStageIds,
    ...nextStageIds
  ]);
  const candidateStages = candidateStageIds.length > 0
    ? await prisma.workflowStage.findMany({
      where: {
        id: {
          in: candidateStageIds
        }
      },
      select: {
        id: true,
        status: true
      }
    })
    : [];
  const terminalStatus = new Set(["completed", "skipped", "failed"]);
  const mergedCurrentStageIds = candidateStages
    .filter((item) => !terminalStatus.has(normalizeText(item.status).toLowerCase()))
    .map((item) => item.id);
  const nextWorkflowStatus = mergedCurrentStageIds.length > 0 ? "active" : "completed";

  await prisma.workflow.update({
    where: { id: workflow.id },
    data: {
      currentStageIds: mergedCurrentStageIds,
      status: nextWorkflowStatus
    }
  });
  await syncLegacyProjectStateFromWorkflow(workflow.id);

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
  isStandalone?: boolean;
  standaloneCategory?: string;
  executorConfig: ExecutorConfig;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  inputContract?: Record<string, unknown>;
  outputContract?: Record<string, unknown>;
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
      isStandalone: Boolean(input.isStandalone),
      standaloneCategory: normalizeText(input.standaloneCategory) || null,
      executorConfig: input.executorConfig,
      inputSchema: toJson(input.inputSchema ?? {}),
      outputSchema: toJson(input.outputSchema ?? {}),
      inputContract: toJson(input.inputContract ?? {}),
      outputContract: toJson(input.outputContract ?? {}),
      acceptanceCriteria: toJson(input.acceptanceCriteria ?? []),
      integrationConfig: toJson(input.integrationConfig ?? {}),
      defaultTimeout: input.defaultTimeout ?? null,
      allowParallel: Boolean(input.allowParallel)
    },
    update: {
      name: normalizeText(input.name) || key,
      description: normalizeText(input.description) || null,
      category: normalizeText(input.category) || "custom",
      isStandalone: Boolean(input.isStandalone),
      standaloneCategory: normalizeText(input.standaloneCategory) || null,
      executorConfig: input.executorConfig,
      inputSchema: toJson(input.inputSchema ?? {}),
      outputSchema: toJson(input.outputSchema ?? {}),
      inputContract: toJson(input.inputContract ?? {}),
      outputContract: toJson(input.outputContract ?? {}),
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

export async function addStageInputArtifact(input: {
  stageId: string;
  artifact: Record<string, unknown>;
}) {
  const stage = await prisma.workflowStage.findUnique({
    where: { id: input.stageId }
  });
  if (!stage) {
    throw new Error("Stage not found");
  }
  const artifacts = Array.isArray(stage.inputArtifacts)
    ? (stage.inputArtifacts as Array<Record<string, unknown>>)
    : [];
  artifacts.push(input.artifact);
  return prisma.workflowStage.update({
    where: { id: stage.id },
    data: {
      inputArtifacts: toJson(artifacts)
    }
  });
}
