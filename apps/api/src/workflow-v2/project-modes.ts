import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { asRecord, asRecordArray, asStringArray, normalizeText } from "./types.js";

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export type ProjectInputCreatePayload = {
  name: string;
  type: string;
  description?: string;
  content?: string;
  filePath?: string;
  referenceDeliverableId?: string;
  inputSource?: "manual" | "imported_from_project" | "template_generated";
};

export type StageInputContractValidation = {
  passed: boolean;
  violations?: string[];
  checks: Array<{ type: string; passed: boolean; details: string }>;
  artifacts: Array<Record<string, unknown>>;
};

type NormalizedInputContract = {
  requiresExternalInput: boolean;
  allowedInputTypes: string[];
  inputValidationRules: Array<Record<string, unknown>>;
};

type ProjectInputArtifact = Record<string, unknown>;

function normalizeInputContract(value: unknown): NormalizedInputContract {
  const record = asRecord(value) ?? {};
  return {
    requiresExternalInput: Boolean(record.requiresExternalInput),
    allowedInputTypes: asStringArray(record.allowedInputTypes).map((item) => normalizeText(item).toLowerCase()),
    inputValidationRules: asRecordArray(record.inputValidationRules)
  };
}

function normalizeArtifactKey(value: string) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

const INPUT_FIELD_ALIASES: Record<string, string[]> = {
  rawrequirements: ["raw_requirements", "prd_requirements", "requirements", "requirement"],
  prd: ["prd_requirements", "design_brief", "technical_spec"],
  mockups: ["mockup", "design_brief", "implementation_scope", "visualmockups"],
  sourcecode: ["source_code", "qa_test_scope", "implementation_scope", "code_repo"]
};

function findMatchingArtifacts(artifacts: ProjectInputArtifact[], field: string) {
  const normalized = normalizeArtifactKey(field);
  if (!normalized) {
    return [] as ProjectInputArtifact[];
  }
  const aliasTokens = INPUT_FIELD_ALIASES[normalized]
    ? INPUT_FIELD_ALIASES[normalized].map((item) => normalizeArtifactKey(item))
    : [];
  const acceptedTokens = new Set([normalized, ...aliasTokens]);
  return artifacts.filter((item) => {
    const name = normalizeArtifactKey(String(item.name ?? ""));
    const type = normalizeArtifactKey(String(item.type ?? ""));
    return acceptedTokens.has(name) || acceptedTokens.has(type);
  });
}

function artifactContent(item: ProjectInputArtifact) {
  return String(item.content ?? "");
}

function toProjectInputArtifact(item: {
  id: string;
  name: string;
  type: string;
  description: string | null;
  content: string | null;
  filePath: string | null;
  referenceDeliverableId: string | null;
  inputSource: string;
  validationStatus: string;
  validationErrors: Prisma.JsonValue;
  referenceDeliverable: {
    id: string;
    name: string;
    type: string;
    content: string;
    stageType: string;
    projectId: string;
    version: number;
    status: string;
  } | null;
}) {
  const fallbackContent = item.referenceDeliverable?.content ?? "";
  const content = String(item.content ?? "").trim() || fallbackContent;
  const artifactType = normalizeText(item.type) || normalizeText(item.referenceDeliverable?.type) || "document";
  const artifactName = normalizeText(item.name) || normalizeText(item.referenceDeliverable?.name) || `input_${item.id}`;

  return {
    name: artifactName,
    type: artifactType,
    content,
    metadata: {
      projectInputId: item.id,
      inputSource: item.inputSource,
      description: item.description ?? undefined,
      filePath: item.filePath ?? undefined,
      referenceDeliverableId: item.referenceDeliverableId ?? undefined,
      referenceProjectId: item.referenceDeliverable?.projectId,
      referenceStageType: item.referenceDeliverable?.stageType,
      referenceVersion: item.referenceDeliverable?.version,
      validationStatus: item.validationStatus,
      validationErrors: asStringArray(item.validationErrors)
    }
  } satisfies ProjectInputArtifact;
}

export async function createProjectInputs(projectId: string, inputs: ProjectInputCreatePayload[]) {
  const normalizedInputs = inputs
    .map((item) => ({
      name: normalizeText(item.name),
      type: normalizeText(item.type) || "document",
      description: normalizeText(item.description) || null,
      content: String(item.content ?? "").trim() || null,
      filePath: normalizeText(item.filePath) || null,
      referenceDeliverableId: normalizeText(item.referenceDeliverableId) || null,
      inputSource: normalizeText(item.inputSource) || "manual"
    }))
    .filter((item) => item.name);

  if (normalizedInputs.length === 0) {
    return [] as Awaited<ReturnType<typeof listProjectInputs>>;
  }

  for (const item of normalizedInputs) {
    await prisma.projectInput.create({
      data: {
        projectId,
        name: item.name,
        type: item.type,
        description: item.description,
        content: item.content,
        filePath: item.filePath,
        referenceDeliverableId: item.referenceDeliverableId,
        validationStatus: "pending",
        validationErrors: toJson([]),
        inputSource: item.inputSource
      }
    });
  }

  return listProjectInputs(projectId);
}

export async function listProjectInputs(projectId: string) {
  return prisma.projectInput.findMany({
    where: { projectId },
    include: {
      referenceDeliverable: {
        select: {
          id: true,
          name: true,
          type: true,
          stageType: true,
          projectId: true,
          version: true,
          status: true
        }
      }
    },
    orderBy: { createdAt: "asc" }
  });
}

export async function materializeProjectInputArtifacts(projectId: string) {
  const inputs = await prisma.projectInput.findMany({
    where: { projectId },
    include: {
      referenceDeliverable: {
        select: {
          id: true,
          name: true,
          type: true,
          content: true,
          stageType: true,
          projectId: true,
          version: true,
          status: true
        }
      }
    },
    orderBy: { createdAt: "asc" }
  });
  return inputs.map((item) => toProjectInputArtifact(item));
}

export async function bindProjectInputsToWorkflowEntryStages(input: {
  workflowId: string;
  projectId: string;
  entryNodeIds: string[];
}) {
  if (input.entryNodeIds.length === 0) {
    return 0;
  }
  const artifacts = await materializeProjectInputArtifacts(input.projectId);
  if (artifacts.length === 0) {
    return 0;
  }

  const entryStages = await prisma.workflowStage.findMany({
    where: {
      workflowId: input.workflowId,
      nodeId: {
        in: input.entryNodeIds
      }
    }
  });

  for (const stage of entryStages) {
    const existing = Array.isArray(stage.inputArtifacts)
      ? (stage.inputArtifacts as Array<Record<string, unknown>>)
      : [];
    const merged = [...existing, ...artifacts];
    await prisma.workflowStage.update({
      where: { id: stage.id },
      data: {
        inputArtifacts: toJson(merged)
      }
    });
  }

  return entryStages.length;
}

export function validateStageInputContract(input: {
  stageInputArtifacts: unknown;
  templateInputContract: unknown;
}): StageInputContractValidation {
  const contract = normalizeInputContract(input.templateInputContract);
  const artifacts = Array.isArray(input.stageInputArtifacts)
    ? (input.stageInputArtifacts as Array<Record<string, unknown>>)
    : [];

  const checks: Array<{ type: string; passed: boolean; details: string }> = [];
  const violations: string[] = [];

  if (contract.requiresExternalInput) {
    const passed = artifacts.length > 0;
    checks.push({
      type: "requires_external_input",
      passed,
      details: passed ? "external inputs ready" : "external input required"
    });
    if (!passed) {
      violations.push("requires_external_input: external input required");
    }
  }

  if (contract.allowedInputTypes.length > 0 && artifacts.length > 0) {
    const invalidTypes = artifacts
      .map((item) => normalizeText(item.type).toLowerCase())
      .filter((item) => item && !contract.allowedInputTypes.includes(item));
    const passed = invalidTypes.length === 0;
    checks.push({
      type: "allowed_input_types",
      passed,
      details: passed
        ? "input types allowed"
        : `invalid input types: ${Array.from(new Set(invalidTypes)).join(", ")}`
    });
    if (!passed) {
      violations.push(`allowed_input_types: invalid input types ${Array.from(new Set(invalidTypes)).join(", ")}`);
    }
  }

  for (const rule of contract.inputValidationRules) {
    const field = normalizeText(rule.field);
    const matched = findMatchingArtifacts(artifacts, field);
    const label = field || normalizeText(rule.name) || "input_rule";

    if (!field) {
      checks.push({ type: "input_rule", passed: false, details: "field is required in rule" });
      violations.push("input_rule: field is required in rule");
      continue;
    }

    if (matched.length === 0) {
      checks.push({ type: "input_rule", passed: false, details: `${label} missing` });
      violations.push(`input_rule: ${label} missing`);
      continue;
    }

    const minLength = Number(rule.minLength ?? 0);
    if (Number.isFinite(minLength) && minLength > 0) {
      const passed = matched.some((item) => artifactContent(item).length >= minLength);
      checks.push({
        type: "input_rule",
        passed,
        details: passed ? `${label} minLength satisfied` : `${label} minLength=${minLength} not met`
      });
      if (!passed) {
        violations.push(`input_rule: ${label} minLength=${minLength} not met`);
      }
    }

    const minCount = Number(rule.minCount ?? 0);
    if (Number.isFinite(minCount) && minCount > 0) {
      const passed = matched.length >= minCount;
      checks.push({
        type: "input_rule",
        passed,
        details: passed ? `${label} minCount satisfied` : `${label} minCount=${minCount} not met`
      });
      if (!passed) {
        violations.push(`input_rule: ${label} minCount=${minCount} not met`);
      }
    }

    const pattern = normalizeText(rule.pattern);
    if (pattern) {
      let regex: RegExp | null = null;
      try {
        regex = new RegExp(pattern, "i");
      } catch {
        regex = null;
      }
      const passed = Boolean(regex && matched.some((item) => regex?.test(artifactContent(item))));
      checks.push({
        type: "input_rule",
        passed,
        details: passed ? `${label} pattern matched` : `${label} pattern not matched`
      });
      if (!passed) {
        violations.push(`input_rule: ${label} pattern not matched`);
      }
    }
  }

  return {
    passed: violations.length === 0,
    violations: violations.length > 0 ? violations : undefined,
    checks,
    artifacts
  };
}

export async function importRelayInputs(input: {
  targetProjectId: string;
  sourceProjectId: string;
  sourceStageId?: string;
  sourceStageType?: string;
  sourceDeliverableIds?: string[];
  relayType?: string;
  transformationConfig?: Record<string, unknown>;
}) {
  const targetProjectId = normalizeText(input.targetProjectId);
  const sourceProjectId = normalizeText(input.sourceProjectId);
  if (!targetProjectId || !sourceProjectId) {
    throw new Error("targetProjectId and sourceProjectId are required");
  }

  const stageId = normalizeText(input.sourceStageId);
  const stageType = normalizeText(input.sourceStageType);
  let resolvedStageType: string | null = null;
  let resolvedStageId: string | null = null;
  if (stageId) {
    const stage = await prisma.stage.findFirst({
      where: {
        id: stageId,
        projectId: sourceProjectId
      },
      select: { id: true, type: true }
    });
    resolvedStageId = stage?.id ?? null;
    resolvedStageType = stage?.type ?? null;
  } else if (stageType) {
    const stage = await prisma.stage.findFirst({
      where: {
        projectId: sourceProjectId,
        type: stageType
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true, type: true }
    });
    resolvedStageId = stage?.id ?? null;
    resolvedStageType = stage?.type ?? null;
  }

  const deliverableIds = (input.sourceDeliverableIds ?? []).map((item) => normalizeText(item)).filter(Boolean);
  const sourceDeliverables = await prisma.deliverable.findMany({
    where: {
      projectId: sourceProjectId,
      ...(resolvedStageId || stageType ? {
        stageType: resolvedStageType || stageType || undefined
      } : {}),
      ...(deliverableIds.length > 0 ? {
        id: {
          in: deliverableIds
        }
      } : {})
    },
    orderBy: [{ updatedAt: "desc" }]
  });

  if (sourceDeliverables.length === 0) {
    throw new Error("no deliverables found for relay source");
  }

  const createdInputs = [] as Array<{ id: string }>;
  for (const deliverable of sourceDeliverables) {
    const created = await prisma.projectInput.create({
      data: {
        projectId: targetProjectId,
        name: deliverable.name,
        type: deliverable.type,
        description: `Imported from project ${sourceProjectId}`,
        content: deliverable.content,
        referenceDeliverableId: deliverable.id,
        validationStatus: "valid",
        validationErrors: toJson([]),
        inputSource: "imported_from_project"
      },
      select: { id: true }
    });
    createdInputs.push(created);
  }

  const relayPayload: Prisma.StageRelayRelationUncheckedCreateInput = {
    sourceProjectId,
    sourceStageId: resolvedStageId,
    targetProjectId,
    sourceDeliverableIds: toJson(sourceDeliverables.map((item) => item.id)),
    targetInputId: createdInputs[0]?.id ?? null,
    relayType: normalizeText(input.relayType) || "full",
    transformationConfig: toJson(input.transformationConfig ?? {}),
    syncStatus: "active",
    lastSyncAt: new Date()
  };

  if (resolvedStageId) {
    await prisma.stageRelayRelation.upsert({
      where: {
        sourceProjectId_sourceStageId_targetProjectId: {
          sourceProjectId,
          sourceStageId: resolvedStageId,
          targetProjectId
        }
      },
      create: {
        ...relayPayload
      },
      update: {
        sourceDeliverableIds: relayPayload.sourceDeliverableIds,
        targetInputId: relayPayload.targetInputId,
        relayType: relayPayload.relayType,
        transformationConfig: relayPayload.transformationConfig,
        syncStatus: relayPayload.syncStatus,
        lastSyncAt: relayPayload.lastSyncAt
      }
    });
  } else {
    const existingRelation = await prisma.stageRelayRelation.findFirst({
      where: {
        sourceProjectId,
        targetProjectId,
        sourceStageId: null
      },
      select: { id: true },
      orderBy: [{ createdAt: "desc" }]
    });
    if (existingRelation) {
      await prisma.stageRelayRelation.update({
        where: { id: existingRelation.id },
        data: {
          sourceDeliverableIds: relayPayload.sourceDeliverableIds,
          targetInputId: relayPayload.targetInputId,
          relayType: relayPayload.relayType,
          transformationConfig: relayPayload.transformationConfig,
          syncStatus: relayPayload.syncStatus,
          lastSyncAt: relayPayload.lastSyncAt
        }
      });
    } else {
      await prisma.stageRelayRelation.create({
        data: {
          sourceStageId: null,
          ...relayPayload
        }
      });
    }
  }

  return listProjectInputs(targetProjectId);
}
