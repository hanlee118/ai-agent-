import type {
  ExecutionProtocolLocks,
  ExecutionProtocolSettings,
  ExecutionProtocolSettingsInput,
  ExecutionProtocolSnapshot,
  ExecutionProtocolStageRule,
  RoleType,
  StageType
} from "@occ/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { ensureSystemConfig } from "./runtime-config.js";
import { getProjectStageExecutionStrategy } from "./project-stage-execution.js";

const DEFAULT_EXECUTION_PROTOCOL_SETTINGS: ExecutionProtocolSettings = {
  memoryEnabled: true,
  memoryPolicy: "current_project_or_high_relevance_only",
  criticalStageMode: "terminal_agent_first",
  allowDirectModelFallbackForCriticalStages: false,
  requireSkillEvidence: true,
  requireCollaborationHandoff: true,
  blockDegradedWrites: true,
  blockSecretLeak: true,
  blockLargeFileCommit: true,
  largeFileSizeThreshold: 10 * 1024 * 1024
};

const EXECUTION_PROTOCOL_LOCKS: ExecutionProtocolLocks = {
  memoryEnabled: true,
  memoryPolicy: true,
  criticalStageMode: true,
  allowDirectModelFallbackForCriticalStages: true
};

const EXECUTION_PROTOCOL_MATRIX: Array<{ stageType: StageType; roles: RoleType[] }> = [
  { stageType: "INIT", roles: ["ROLE_PM"] },
  { stageType: "ANALYSIS", roles: ["ROLE_PM", "ROLE_ANALYST", "ROLE_PRODUCT"] },
  { stageType: "DESIGN", roles: ["ROLE_PRODUCT", "ROLE_DESIGN"] },
  { stageType: "DEV", roles: ["ROLE_ARCH", "ROLE_DEV"] },
  { stageType: "ACCEPT", roles: ["ROLE_QA"] }
];

function normalizeExecutionProtocolSettings(input: unknown): ExecutionProtocolSettings {
  const source = input && typeof input === "object" && !Array.isArray(input)
    ? (input as Partial<ExecutionProtocolSettings>)
    : {};

  return {
    memoryEnabled: true,
    memoryPolicy: "current_project_or_high_relevance_only",
    criticalStageMode: "terminal_agent_first",
    allowDirectModelFallbackForCriticalStages: false,
    requireSkillEvidence: source.requireSkillEvidence !== false,
    requireCollaborationHandoff: source.requireCollaborationHandoff !== false,
    blockDegradedWrites: source.blockDegradedWrites !== false,
    blockSecretLeak: source.blockSecretLeak !== false,
    blockLargeFileCommit: source.blockLargeFileCommit !== false,
    largeFileSizeThreshold: Number.isFinite(Number(source.largeFileSizeThreshold))
      ? Math.max(1024 * 1024, Math.floor(Number(source.largeFileSizeThreshold)))
      : 10 * 1024 * 1024
  };
}

function buildExecutionProtocolStageMatrix(settings: ExecutionProtocolSettings): ExecutionProtocolStageRule[] {
  return EXECUTION_PROTOCOL_MATRIX.flatMap(({ stageType, roles }) =>
    roles.map((role) => {
      const strategy = getProjectStageExecutionStrategy(stageType, role);
      return {
        stageType,
        role,
        mode: strategy.mode,
        openClawAgentId: strategy.openClawAgentId,
        preferredModels: [...strategy.preferredModels],
        requiredSkills: [...strategy.requiredSkills],
        requiredCollaborationFields: [...strategy.requiredCollaborationFields],
        memoryEnabled: strategy.memoryEnabled,
        memoryPolicy: strategy.memoryPolicy,
        allowDirectModelFallback: strategy.allowDirectModelFallback,
        requireSkillEvidence: strategy.mode === "terminal_agent" ? settings.requireSkillEvidence : false,
        requireCollaborationHandoff: strategy.mode === "terminal_agent" ? settings.requireCollaborationHandoff : false,
        blockDegradedWrites: settings.blockDegradedWrites
      };
    })
  );
}

export async function getExecutionProtocolSettings(): Promise<ExecutionProtocolSettings> {
  const config = await ensureSystemConfig();
  return normalizeExecutionProtocolSettings(config.executionProtocol);
}

export async function getExecutionProtocolSnapshot(): Promise<ExecutionProtocolSnapshot> {
  const config = await ensureSystemConfig();
  const settings = normalizeExecutionProtocolSettings(config.executionProtocol);
  const hasDatabaseConfig = Boolean(config.executionProtocol);

  return {
    source: hasDatabaseConfig ? "database" : "default",
    updatedAt: config.updatedAt.toISOString(),
    settings,
    locks: EXECUTION_PROTOCOL_LOCKS,
    stageMatrix: buildExecutionProtocolStageMatrix(settings)
  };
}

export async function updateExecutionProtocolSettings(
  input: ExecutionProtocolSettingsInput
): Promise<ExecutionProtocolSnapshot> {
  const current = await ensureSystemConfig();
  const currentSettings = normalizeExecutionProtocolSettings(current.executionProtocol);
  const nextSettings = normalizeExecutionProtocolSettings({
    ...currentSettings,
    requireSkillEvidence: input.requireSkillEvidence ?? currentSettings.requireSkillEvidence,
    requireCollaborationHandoff: input.requireCollaborationHandoff ?? currentSettings.requireCollaborationHandoff,
    blockDegradedWrites: input.blockDegradedWrites ?? currentSettings.blockDegradedWrites,
    blockSecretLeak: input.blockSecretLeak ?? currentSettings.blockSecretLeak,
    blockLargeFileCommit: input.blockLargeFileCommit ?? currentSettings.blockLargeFileCommit,
    largeFileSizeThreshold: input.largeFileSizeThreshold ?? currentSettings.largeFileSizeThreshold
  });

  const updated = await prisma.systemConfig.update({
    where: { id: current.id },
    data: {
      executionProtocol: nextSettings as unknown as Prisma.InputJsonValue
    }
  });

  return {
    source: "database",
    updatedAt: updated.updatedAt.toISOString(),
    settings: nextSettings,
    locks: EXECUTION_PROTOCOL_LOCKS,
    stageMatrix: buildExecutionProtocolStageMatrix(nextSettings)
  };
}
