import type { ManagedAgentConfig, AgentProfile } from "@prisma/client";
import type { RoleType } from "@occ/shared";
import { prisma } from "../db.js";
import { asRecord, asStringArray, normalizeText } from "./types.js";
import type { AgentSelectionResult, ExecutorConfig } from "./types.js";

const STAGE_ROLE_ALIAS_MAP: Record<string, Array<RoleType | string>> = {
  Project_Manager: ["ROLE_PM", "project_manager"],
  Product_Manager: ["ROLE_PRODUCT", "product_director"],
  Requirements_Analyst: ["ROLE_ANALYST", "requirements_analyst"],
  UI_Designer: ["ROLE_DESIGN", "jeremy"],
  Designer: ["ROLE_DESIGN", "jeremy"],
  Architect: ["ROLE_ARCH", "rd_director"],
  Developer: ["ROLE_DEV", "rd_manager"],
  QA_Engineer: ["ROLE_QA", "qa_engineer"],
  QA: ["ROLE_QA", "qa_engineer"]
};

type Candidate = {
  profile: AgentProfile | null;
  config: ManagedAgentConfig | null;
  capabilities: string[];
  agentId: string;
};

export function resolveRoleCandidates(agentRole: string | undefined): string[] {
  const normalized = normalizeText(agentRole);
  if (!normalized) {
    return [];
  }
  const mapped = STAGE_ROLE_ALIAS_MAP[normalized];
  if (mapped) {
    return mapped.map((item) => String(item));
  }
  return [normalized];
}

export function extractCapabilities(profile: AgentProfile | null): string[] {
  if (!profile) {
    return [];
  }
  const payload = profile.skills;
  if (Array.isArray(payload)) {
    return asStringArray(payload).map((item) => item.toLowerCase());
  }
  const record = asRecord(payload);
  if (!record) {
    return [];
  }
  const direct = asStringArray(record.skills).map((item) => item.toLowerCase());
  if (direct.length > 0) {
    return direct;
  }
  const merged: string[] = [];
  for (const value of Object.values(record)) {
    merged.push(...asStringArray(value));
  }
  return merged.map((item) => item.toLowerCase());
}

export function scoreAgentCandidate(input: {
  candidate: Candidate;
  requiredCapabilities: string[];
  modelPreference?: string;
}): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const required = input.requiredCapabilities.map((item) => normalizeText(item).toLowerCase()).filter(Boolean);
  const capabilitySet = new Set(input.candidate.capabilities.map((item) => normalizeText(item).toLowerCase()));
  const matched = required.filter((item) => capabilitySet.has(item));
  const capabilityRatio = required.length === 0 ? 1 : matched.length / required.length;
  const capabilityScore = capabilityRatio * 60;
  reasons.push(`capability_match=${matched.length}/${required.length || 1}`);

  const profileWorkload = Number(input.candidate.profile?.workload ?? 0);
  const workloadPenalty = Math.max(0, profileWorkload) * 1.8;
  reasons.push(`workload=${profileWorkload}`);

  const preferred = normalizeText(input.modelPreference);
  const selectedModel = normalizeText(input.candidate.config?.selectedModel);
  const defaultModel = normalizeText(input.candidate.config?.defaultModel);
  const fallbackModel = normalizeText(input.candidate.config?.fallbackModel);
  const modelMatched = Boolean(
    preferred
    && [selectedModel, defaultModel, fallbackModel].some((model) => model && model === preferred)
  );
  const modelScore = modelMatched ? 25 : preferred ? -8 : 0;
  if (preferred) {
    reasons.push(modelMatched ? `model_match=${preferred}` : `model_miss=${preferred}`);
  }

  const onlineBonus = normalizeText(input.candidate.profile?.status).toLowerCase() === "online" ? 10 : 0;
  if (onlineBonus > 0) {
    reasons.push("status=online");
  }

  const score = capabilityScore + modelScore + onlineBonus - workloadPenalty;
  return { score, reasons };
}

function buildCandidates(input: {
  profiles: AgentProfile[];
  configs: ManagedAgentConfig[];
  roleCandidates: string[];
}): Candidate[] {
  const profileMap = new Map(input.profiles.map((item) => [item.roleId, item]));
  const configMap = new Map(input.configs.map((item) => [item.agentId, item]));

  const candidates: Candidate[] = [];
  for (const key of input.roleCandidates) {
    const profile = profileMap.get(key) ?? null;
    const config = configMap.get(key) ?? null;
    if (!profile && !config) {
      continue;
    }
    candidates.push({
      profile,
      config,
      capabilities: extractCapabilities(profile),
      agentId: key
    });
  }

  if (candidates.length > 0) {
    return candidates;
  }

  // Fallback to all managed agents to avoid workflow deadlock.
  return input.configs.map((config) => ({
    profile: profileMap.get(config.agentId) ?? null,
    config,
    capabilities: extractCapabilities(profileMap.get(config.agentId) ?? null),
    agentId: config.agentId
  }));
}

export async function assignAgentToStage(executorConfig: ExecutorConfig): Promise<AgentSelectionResult> {
  const roleCandidates = resolveRoleCandidates(executorConfig.agentRole);
  const [profiles, configs] = await Promise.all([
    prisma.agentProfile.findMany(),
    prisma.managedAgentConfig.findMany()
  ]);

  const candidates = buildCandidates({
    profiles,
    configs,
    roleCandidates
  });

  if (candidates.length === 0) {
    return {
      agentId: "project_manager",
      role: "CUSTOM",
      model: null,
      confidence: 0.1,
      reasons: ["fallback=no_agent_candidates"]
    };
  }

  const ranked = candidates
    .map((candidate) => {
      const scored = scoreAgentCandidate({
        candidate,
        requiredCapabilities: executorConfig.requiredCapabilities ?? [],
        modelPreference: executorConfig.modelPreference
      });
      return {
        candidate,
        score: scored.score,
        reasons: scored.reasons
      };
    })
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const resolvedRole = resolveRoleCandidates(executorConfig.agentRole).find((item) => item.startsWith("ROLE_")) as
    | RoleType
    | undefined;

  return {
    agentId: best.candidate.agentId,
    role: resolvedRole ?? "CUSTOM",
    model: best.candidate.config?.selectedModel ?? best.candidate.config?.defaultModel ?? null,
    confidence: Math.max(0.05, Math.min(0.99, (best.score + 60) / 120)),
    reasons: best.reasons
  };
}
