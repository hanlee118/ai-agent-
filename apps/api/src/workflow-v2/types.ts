import type { RoleType } from "@occ/shared";

export type KnowledgeScope = "global" | "project" | "agent" | "template";
export type KnowledgeType = "document" | "text" | "url" | "code" | "sop";
export type MemoryType = "episodic" | "semantic" | "procedural";

export type ExecutorConfig = {
  type: "agent" | "human" | "hybrid";
  agentRole?: string;
  requiredCapabilities: string[];
  modelPreference?: string;
};

export type AcceptanceCriterion = {
  type: "artifact_exists" | "quality_gate" | "manual_approval" | "auto_check";
  config: Record<string, unknown>;
};

export type IntegrationConfig = {
  useStitch?: boolean;
  requiredTools?: string[];
  webhookUrls?: string[];
};

export type WorkflowNode = {
  id: string;
  templateKey: string;
  config?: Record<string, unknown>;
};

export type WorkflowEdge = {
  from: string;
  to: string;
  condition?: string;
};

export type StageGraph = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

export type AgentSelectionResult = {
  agentId: string;
  role: RoleType | "CUSTOM";
  model: string | null;
  confidence: number;
  reasons: string[];
};

export type RetrievalContext = {
  projectId?: string;
  currentStage?: string;
  agentId?: string;
  techStack?: string[];
};

export type RetrievalResult = {
  id: string;
  title: string;
  content: string;
  similarity: number;
  finalScore: number;
  memoryType: string | null;
  createdAt: Date;
  accessCount: number;
};

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

export function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function tokenizeText(value: unknown): string[] {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return [];
  }
  return normalized
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}
