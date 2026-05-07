import type { RoleType, StageType } from "@occ/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { getProjectStageExecutionStrategy } from "../system/project-stage-execution.js";
import { asRecord, normalizeText } from "./types.js";

const STAGE_ROLE_COMBOS: Array<{ stageType: StageType; role: RoleType }> = [
  { stageType: "ANALYSIS", role: "ROLE_ANALYST" },
  { stageType: "DESIGN", role: "ROLE_DESIGN" },
  { stageType: "DEV", role: "ROLE_DEV" },
  { stageType: "ACCEPT", role: "ROLE_QA" }
];

const SKILL_FALLBACK_DESCRIPTOR: Record<string, { name: string; type: string; instruction: string }> = {
  "design-to-code": {
    name: "Design To Code",
    type: "procedural",
    instruction: "Convert approved design artifacts into implementation-ready UI code with responsive behavior and verification notes."
  },
  "frontend-design": {
    name: "Frontend Design",
    type: "cognitive",
    instruction: "Refine layout hierarchy, color, spacing, and accessibility to keep UI quality consistent with product goals."
  },
  "frontend-design-pro": {
    name: "Frontend Design Pro",
    type: "meta",
    instruction: "Audit and polish frontend output with higher visual quality, stronger consistency, and explicit design tradeoffs."
  },
  stitch: {
    name: "Stitch MCP",
    type: "procedural",
    instruction: "Use Stitch tooling to generate/validate visual artifacts and provide verifiable links or exported outputs."
  },
  "coding-agent": {
    name: "Coding Agent",
    type: "procedural",
    instruction: "Execute implementation, test, and regression tasks with concrete file-level outputs and validation evidence."
  }
};

export type HermesSkillView = {
  id: string;
  hermesSkillId: string | null;
  skillKey: string;
  name: string;
  instruction: string;
  type: string;
  manifest: Record<string, unknown>;
  sourceProjectId: string | null;
  source: string;
  isCertified: boolean;
  updatedAt: string;
};

function clampPositiveInt(input: unknown, fallback: number, max: number) {
  const value = Number(input);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.floor(value);
  if (rounded <= 0) {
    return fallback;
  }
  return Math.min(rounded, max);
}

function normalizeSkillKey(value: unknown) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function toSkillView(row: {
  id: string;
  hermesSkillId: string | null;
  skillKey: string;
  name: string;
  instruction: string;
  type: string;
  manifest: unknown;
  sourceProjectId: string | null;
  source: string;
  isCertified: boolean;
  updatedAt: Date;
}): HermesSkillView {
  return {
    id: row.id,
    hermesSkillId: row.hermesSkillId,
    skillKey: row.skillKey,
    name: row.name,
    instruction: row.instruction,
    type: row.type,
    manifest: asRecord(row.manifest) ?? {},
    sourceProjectId: row.sourceProjectId,
    source: row.source,
    isCertified: row.isCertified,
    updatedAt: row.updatedAt.toISOString()
  };
}

function buildFallbackSkillCatalog() {
  const aggregate = new Map<string, HermesSkillView>();
  const allStageTypes = ["INIT", "ANALYSIS", "DESIGN", "DEV", "ACCEPT"];

  // Ensure baseline built-in skills are always exported even when a stage strategy
  // currently does not hard-require them (for example design-to-code in DESIGN).
  for (const [skillKey, descriptor] of Object.entries(SKILL_FALLBACK_DESCRIPTOR)) {
    aggregate.set(skillKey, {
      id: `builtin-${skillKey}`,
      hermesSkillId: null,
      skillKey,
      name: descriptor.name,
      instruction: descriptor.instruction,
      type: descriptor.type,
      manifest: {
        stageTypes: [...allStageTypes],
        source: "builtin"
      },
      sourceProjectId: null,
      source: "builtin",
      isCertified: true,
      updatedAt: new Date(0).toISOString()
    });
  }

  for (const combo of STAGE_ROLE_COMBOS) {
    const strategy = getProjectStageExecutionStrategy(combo.stageType, combo.role);
    for (const key of strategy.requiredSkills) {
      const skillKey = normalizeSkillKey(key);
      if (!skillKey) {
        continue;
      }
      const existing = aggregate.get(skillKey);
      const descriptor = SKILL_FALLBACK_DESCRIPTOR[skillKey] ?? {
        name: skillKey,
        type: "procedural",
        instruction: "Imported fallback execution skill for workflow stages."
      };
      if (!existing) {
        aggregate.set(skillKey, {
          id: `builtin-${skillKey}`,
          hermesSkillId: null,
          skillKey,
          name: descriptor.name,
          instruction: descriptor.instruction,
          type: descriptor.type,
          manifest: {
            stageTypes: [combo.stageType],
            roles: [combo.role],
            source: "builtin"
          },
          sourceProjectId: null,
          source: "builtin",
          isCertified: true,
          updatedAt: new Date(0).toISOString()
        });
        continue;
      }
      const manifest = asRecord(existing.manifest) ?? {};
      const stageTypes = Array.isArray(manifest.stageTypes)
        ? manifest.stageTypes.map((item) => String(item))
        : [];
      const roles = Array.isArray(manifest.roles)
        ? manifest.roles.map((item) => String(item))
        : [];
      if (!stageTypes.includes(combo.stageType)) {
        stageTypes.push(combo.stageType);
      }
      if (!roles.includes(combo.role)) {
        roles.push(combo.role);
      }
      existing.manifest = {
        ...manifest,
        stageTypes,
        roles,
        source: "builtin"
      };
    }
  }
  return Array.from(aggregate.values());
}

function stageMatches(skill: HermesSkillView, stageType?: string) {
  const normalized = normalizeText(stageType).toUpperCase();
  if (!normalized) {
    return true;
  }
  const manifest = asRecord(skill.manifest) ?? {};
  const stageTypes = Array.isArray(manifest.stageTypes)
    ? manifest.stageTypes.map((item) => String(item).toUpperCase())
    : [];
  if (stageTypes.length === 0) {
    return true;
  }
  return stageTypes.includes(normalized);
}

export async function listSkillsForHermes(input: {
  projectId?: string;
  stageType?: string;
  limit?: number;
}): Promise<HermesSkillView[]> {
  const limit = clampPositiveInt(input.limit, 10, 200);
  const projectId = normalizeText(input.projectId) || undefined;
  const rows = await prisma.hermesSkill.findMany({
    where: {
      isActive: true,
      OR: projectId
        ? [{ sourceProjectId: null }, { sourceProjectId: projectId }]
        : undefined
    },
    orderBy: [{ isCertified: "desc" }, { updatedAt: "desc" }],
    take: limit * 2
  });

  const catalog = new Map<string, HermesSkillView>();
  for (const skill of buildFallbackSkillCatalog()) {
    catalog.set(skill.skillKey, skill);
  }
  for (const row of rows) {
    const view = toSkillView(row);
    catalog.set(view.skillKey, view);
  }

  return Array.from(catalog.values())
    .filter((item) => stageMatches(item, input.stageType))
    .slice(0, limit);
}

export async function importHermesSkill(input: {
  hermesSkillId?: string;
  projectId?: string;
  skillData: Record<string, unknown>;
}) {
  const data = asRecord(input.skillData) ?? {};
  const skillKey = normalizeSkillKey(data.skillKey ?? data.name);
  if (!skillKey) {
    throw new Error("skillData.skillKey or skillData.name is required");
  }

  const name = normalizeText(data.name) || skillKey;
  const instruction = normalizeText(data.instruction) || "Imported from Hermes";
  const type = normalizeText(data.type).toLowerCase() || "procedural";
  const manifest = asRecord(data.manifest) ?? {};
  const hermesSkillId = normalizeText(input.hermesSkillId) || null;
  const projectId = normalizeText(input.projectId) || null;

  const row = await prisma.hermesSkill.upsert({
    where: { skillKey },
    create: {
      hermesSkillId,
      skillKey,
      name,
      instruction,
      type,
      manifest: manifest as Prisma.InputJsonValue,
      sourceProjectId: projectId,
      source: "hermes",
      isCertified: true,
      isActive: true,
      lastSyncedAt: new Date()
    },
    update: {
      hermesSkillId,
      name,
      instruction,
      type,
      manifest: manifest as Prisma.InputJsonValue,
      sourceProjectId: projectId,
      source: "hermes",
      isCertified: true,
      isActive: true,
      lastSyncedAt: new Date()
    }
  });

  return toSkillView(row);
}
