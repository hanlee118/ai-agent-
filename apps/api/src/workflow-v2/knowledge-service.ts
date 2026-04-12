import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { extractKnowledgeFromStageOutput } from "./knowledge-llm.js";
import {
  asRecord,
  asStringArray,
  normalizeText,
  tokenizeText,
  type KnowledgeScope,
  type KnowledgeType,
  type RetrievalContext,
  type RetrievalResult
} from "./types.js";

export type IngestKnowledgeInput = {
  scope: KnowledgeScope;
  projectId?: string;
  agentId?: string;
  type: KnowledgeType;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  stageContext?: string[];
  techStack?: string[];
  memoryType?: "episodic" | "semantic" | "procedural";
  importanceScore?: number;
  sourceUrl?: string;
  filePath?: string;
  fileType?: string;
};

export type KnowledgeListFilters = {
  scope?: KnowledgeScope;
  projectId?: string;
  agentId?: string;
  type?: KnowledgeType;
  memoryType?: "episodic" | "semantic" | "procedural";
  stageContext?: string;
  query?: string;
  limit?: number;
  offset?: number;
};

export type KnowledgeUpdateInput = {
  scope?: KnowledgeScope;
  projectId?: string | null;
  agentId?: string | null;
  type?: KnowledgeType;
  title?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  stageContext?: string[];
  techStack?: string[];
  memoryType?: "episodic" | "semantic" | "procedural";
  importanceScore?: number;
  sourceUrl?: string | null;
  filePath?: string | null;
  fileType?: string | null;
};

export type KnowledgeNormalizationSuggestion = {
  itemId: string;
  before: {
    title: string;
    tags: string[];
    stageContext: string[];
    techStack: string[];
  };
  after: {
    title: string;
    tags: string[];
    stageContext: string[];
    techStack: string[];
  };
  reasons: string[];
};

export type KnowledgeDuplicateGroup = {
  canonicalId: string;
  duplicateIds: string[];
  similarity: number;
  reason: string;
};

export type KnowledgeCurationPreview = {
  totalItems: number;
  normalizationSuggestions: KnowledgeNormalizationSuggestion[];
  duplicateGroups: KnowledgeDuplicateGroup[];
};

export type KnowledgeCurationApplyResult = KnowledgeCurationPreview & {
  normalizedCount: number;
  mergedCount: number;
  deletedCount: number;
  operationId?: string;
};

type KnowledgeRow = Awaited<ReturnType<typeof prisma.knowledgeItem.findMany>>[number];
type KnowledgeOperationRow = Awaited<ReturnType<typeof prisma.knowledgeOperationLog.findMany>>[number];

type KnowledgeItemSnapshot = {
  id: string;
  scope: string;
  projectId: string | null;
  agentId: string | null;
  type: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  tags: string[];
  stageContext: string[];
  techStack: string[];
  memoryType: string | null;
  importanceScore: number | null;
  sourceUrl: string | null;
  filePath: string | null;
  fileType: string | null;
  accessCount: number;
  lastAccessedAt: string | null;
  createdAt: string;
};

export type KnowledgeOperationLogView = {
  id: string;
  operationType: string;
  scope: string | null;
  projectId: string | null;
  agentId: string | null;
  triggeredBy: string | null;
  summary: string;
  canRollback: boolean;
  rolledBackAt: Date | null;
  createdAt: Date;
};

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isMissingTableError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}

function snapshotKnowledgeItem(row: KnowledgeRow): KnowledgeItemSnapshot {
  return {
    id: row.id,
    scope: row.scope,
    projectId: row.projectId ?? null,
    agentId: row.agentId ?? null,
    type: row.type,
    title: row.title,
    content: row.content,
    metadata: asRecord(row.metadata) ?? {},
    tags: asStringArray(row.tags),
    stageContext: asStringArray(row.stageContext),
    techStack: asStringArray(row.techStack),
    memoryType: row.memoryType ?? null,
    importanceScore: row.importanceScore ?? null,
    sourceUrl: row.sourceUrl ?? null,
    filePath: row.filePath ?? null,
    fileType: row.fileType ?? null,
    accessCount: row.accessCount,
    lastAccessedAt: row.lastAccessedAt ? row.lastAccessedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString()
  };
}

async function recreateKnowledgeItems(items: KnowledgeItemSnapshot[]) {
  if (items.length === 0) {
    return 0;
  }
  let restored = 0;
  for (const item of items) {
    const exists = await prisma.knowledgeItem.findUnique({
      where: { id: item.id },
      select: { id: true }
    });
    if (exists) {
      continue;
    }
    await prisma.knowledgeItem.create({
      data: {
        id: item.id,
        scope: item.scope,
        projectId: item.projectId,
        agentId: item.agentId,
        type: item.type,
        title: item.title,
        content: item.content,
        metadata: toJson(item.metadata),
        tags: toJson(item.tags),
        stageContext: toJson(item.stageContext),
        techStack: toJson(item.techStack),
        memoryType: item.memoryType,
        importanceScore: item.importanceScore,
        sourceUrl: item.sourceUrl,
        filePath: item.filePath,
        fileType: item.fileType,
        accessCount: item.accessCount,
        lastAccessedAt: item.lastAccessedAt ? new Date(item.lastAccessedAt) : null,
        createdAt: new Date(item.createdAt)
      }
    });
    restored += 1;
  }
  return restored;
}

async function createKnowledgeOperationLog(input: {
  operationType: string;
  summary: string;
  scope?: string | null;
  projectId?: string | null;
  agentId?: string | null;
  triggeredBy?: string | null;
  canRollback?: boolean;
  payload?: Record<string, unknown>;
}) {
  try {
    const created = await prisma.knowledgeOperationLog.create({
      data: {
        operationType: input.operationType,
        scope: input.scope ?? null,
        projectId: input.projectId ?? null,
        agentId: input.agentId ?? null,
        triggeredBy: input.triggeredBy ?? null,
        summary: input.summary,
        canRollback: Boolean(input.canRollback),
        payload: toJson(input.payload ?? {})
      }
    });
    return created.id;
  } catch (error) {
    if (isMissingTableError(error)) {
      return null;
    }
    throw error;
  }
}

function splitIntoChunks(text: string, chunkSize = 1200, chunkOverlap = 120): string[] {
  const normalized = String(text ?? "").trim();
  if (!normalized) {
    return [];
  }

  const paragraphs = normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  if (paragraphs.length <= 1 && normalized.length <= chunkSize) {
    return [normalized];
  }

  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const tentative = current ? `${current}\n\n${paragraph}` : paragraph;
    if (tentative.length > chunkSize && current) {
      chunks.push(current.trim());
      const overlapText = current.slice(Math.max(0, current.length - chunkOverlap));
      current = `${overlapText}\n${paragraph}`.trim();
      continue;
    }
    current = tentative;
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }

  if (chunks.length === 0) {
    return [normalized];
  }
  return chunks;
}

function computeSimilarity(query: string, title: string, content: string) {
  const queryTokens = tokenizeText(query);
  if (queryTokens.length === 0) {
    return 0;
  }
  const bag = new Set([...tokenizeText(title), ...tokenizeText(content)]);
  if (bag.size === 0) {
    return 0;
  }
  let hit = 0;
  for (const token of queryTokens) {
    if (bag.has(token)) {
      hit += 1;
    }
  }
  return hit / queryTokens.length;
}

function recencyScore(date: Date) {
  const days = Math.max(0, (Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
  return Math.max(0, 1 - days / 90);
}

function clampPositiveInt(value: number, fallback: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.floor(value);
  if (rounded <= 0) {
    return fallback;
  }
  return Math.min(rounded, max);
}

function normalizeKnowledgeTitle(title: string) {
  return normalizeText(title);
}

function uniqueNormalized(values: string[], formatter?: (value: string) => string) {
  const map = new Map<string, string>();
  for (const item of values) {
    const text = normalizeText(item);
    if (!text) {
      continue;
    }
    const normalized = formatter ? formatter(text) : text;
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (!map.has(key)) {
      map.set(key, normalized);
    }
  }
  return Array.from(map.values());
}

const STAGE_ALIAS: Record<string, string> = {
  requirements: "requirements_design",
  requirement: "requirements_design",
  prd: "requirements_design",
  "需求": "requirements_design",
  "需求设计": "requirements_design",
  visual: "visual_design",
  "ui": "visual_design",
  "ux": "visual_design",
  "视觉": "visual_design",
  "视觉设计": "visual_design",
  design: "visual_design",
  tech: "tech_design",
  "技术": "tech_design",
  architecture: "tech_design",
  dev: "code_dev",
  development: "code_dev",
  code: "code_dev",
  coding: "code_dev",
  "研发": "code_dev",
  qa: "qa_acceptance",
  test: "qa_acceptance",
  testing: "qa_acceptance",
  "验收": "qa_acceptance"
};

const TECH_ALIAS: Record<string, string> = {
  ts: "typescript",
  typescript: "typescript",
  js: "javascript",
  javascript: "javascript",
  nodejs: "node.js",
  node: "node.js",
  reactjs: "react",
  react: "react",
  vuejs: "vue",
  vue: "vue",
  angular: "angular",
  nest: "nestjs",
  nestjs: "nestjs",
  express: "express",
  prisma: "prisma",
  postgres: "postgresql",
  postgresql: "postgresql",
  mysql: "mysql",
  redis: "redis",
  docker: "docker",
  kubernetes: "kubernetes",
  k8s: "kubernetes",
  python: "python",
  java: "java",
  golang: "go",
  go: "go",
  openai: "openai",
  stitch: "stitch"
};

const TAG_KEYWORDS: Array<{ token: string; tag: string }> = [
  { token: "prd", tag: "prd" },
  { token: "用户故事", tag: "user-story" },
  { token: "api", tag: "api" },
  { token: "ux", tag: "ux" },
  { token: "ui", tag: "ui" },
  { token: "数据库", tag: "database" },
  { token: "database", tag: "database" },
  { token: "质量门禁", tag: "quality-gate" },
  { token: "quality", tag: "quality" },
  { token: "stitch", tag: "stitch" },
  { token: "部署", tag: "deployment" },
  { token: "monitor", tag: "observability" },
  { token: "测试", tag: "testing" },
  { token: "test", tag: "testing" }
];

const STAGE_HINTS: Array<{ stage: string; terms: string[] }> = [
  {
    stage: "requirements_design",
    terms: ["需求", "需求分析", "需求设计", "prd", "user story", "user-story", "acceptance criteria", "验收标准"]
  },
  {
    stage: "visual_design",
    terms: ["视觉", "视觉设计", "ui", "ux", "figma", "mockup", "design system", "设计稿"]
  },
  {
    stage: "tech_design",
    terms: ["技术方案", "架构", "architecture", "api contract", "api设计", "technical design"]
  },
  {
    stage: "code_dev",
    terms: ["开发", "研发", "代码", "coding", "implementation", "实现", "code review"]
  },
  {
    stage: "qa_acceptance",
    terms: ["测试", "qa", "验收", "test report", "bug", "缺陷", "回归测试"]
  }
];

const MEMORY_HINT_TERMS = {
  episodic: ["复盘", "回顾", "事故", "故障", "postmortem", "incident", "lessons learned", "经验教训"],
  procedural: ["sop", "runbook", "playbook", "步骤", "流程", "操作指南", "checklist", "手册"]
} as const;

function normalizeStageKey(value: string) {
  const normalized = value.toLowerCase().replace(/\s+/g, "_");
  return STAGE_ALIAS[normalized] ?? normalized;
}

function normalizeStageContextList(values: string[]) {
  return uniqueNormalized(values, (value) => {
    return normalizeStageKey(value);
  });
}

function normalizeTechStackList(values: string[]) {
  return uniqueNormalized(values, (value) => {
    const normalized = value.toLowerCase().replace(/\s+/g, "");
    return TECH_ALIAS[normalized] ?? normalized;
  });
}

function normalizeTagList(values: string[], contextText?: string) {
  const tags = uniqueNormalized(values, (value) => value.toLowerCase().replace(/\s+/g, "-"));
  if (!contextText) {
    return tags;
  }
  const text = contextText.toLowerCase();
  const inferred = TAG_KEYWORDS
    .filter((item) => text.includes(item.token.toLowerCase()))
    .map((item) => item.tag);
  return uniqueNormalized([...tags, ...inferred], (value) => value.toLowerCase().replace(/\s+/g, "-"));
}

function inferTechStackFromText(content: string) {
  const lowered = normalizeText(content).toLowerCase();
  if (!lowered) {
    return [];
  }
  const matched = Object.keys(TECH_ALIAS).filter((key) => lowered.includes(key));
  return normalizeTechStackList(matched.map((key) => TECH_ALIAS[key] ?? key));
}

function inferStageContextFromText(input: {
  title?: string;
  content: string;
  tags?: string[];
  stageContext?: string[];
}) {
  const text = `${normalizeText(input.title)}\n${normalizeText(input.content)}`.toLowerCase();
  const tagText = (input.tags ?? []).map((item) => normalizeText(item).toLowerCase()).filter(Boolean);
  const inferred: string[] = [...(input.stageContext ?? [])];

  for (const hint of STAGE_HINTS) {
    const byText = hint.terms.some((term) => text.includes(term.toLowerCase()));
    const byTag = hint.terms.some((term) => tagText.some((tag) => tag.includes(term.toLowerCase())));
    if (byText || byTag) {
      inferred.push(hint.stage);
    }
  }

  return normalizeStageContextList(inferred);
}

function inferMemoryTypeFromText(input: {
  type: KnowledgeType;
  title?: string;
  content: string;
  stageContext?: string[];
}) {
  const text = `${normalizeText(input.title)}\n${normalizeText(input.content)}`.toLowerCase();
  if (input.type === "sop") {
    return "procedural" as const;
  }
  if ((input.stageContext ?? []).includes("qa_acceptance")) {
    return "episodic" as const;
  }
  if (MEMORY_HINT_TERMS.episodic.some((term) => text.includes(term))) {
    return "episodic" as const;
  }
  if (MEMORY_HINT_TERMS.procedural.some((term) => text.includes(term))) {
    return "procedural" as const;
  }
  return "semantic" as const;
}

function normalizeMemoryTypeValue(value: unknown) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "episodic" || normalized === "semantic" || normalized === "procedural") {
    return normalized as "episodic" | "semantic" | "procedural";
  }
  return null;
}

function clampImportanceScore(value: number | null | undefined, fallback = 0.5) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, Number(value)));
}

function inferImportanceScoreFromText(input: {
  title?: string;
  content: string;
  memoryType: "episodic" | "semantic" | "procedural";
}) {
  const baselineByMemory = {
    episodic: 0.65,
    procedural: 0.7,
    semantic: 0.5
  } as const;
  const text = `${normalizeText(input.title)}\n${normalizeText(input.content)}`.toLowerCase();
  const criticalTerms = ["p0", "p1", "critical", "blocker", "紧急", "必须", "上线", "生产事故"];
  const boost = criticalTerms.some((term) => text.includes(term)) ? 0.1 : 0;
  return clampImportanceScore(baselineByMemory[input.memoryType] + boost, baselineByMemory[input.memoryType]);
}

function similarityFromTokens(a: string, b: string) {
  const tokenA = new Set(tokenizeText(a));
  const tokenB = new Set(tokenizeText(b));
  if (tokenA.size === 0 || tokenB.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of tokenA) {
    if (tokenB.has(token)) {
      intersection += 1;
    }
  }
  const union = new Set([...tokenA, ...tokenB]).size;
  if (union === 0) {
    return 0;
  }
  return intersection / union;
}

function isLikelyDuplicate(a: KnowledgeRow, b: KnowledgeRow) {
  if (a.scope !== b.scope) {
    return false;
  }
  if ((a.projectId ?? "") !== (b.projectId ?? "")) {
    return false;
  }
  if ((a.agentId ?? "") !== (b.agentId ?? "")) {
    return false;
  }
  const titleA = normalizeText(a.title).toLowerCase();
  const titleB = normalizeText(b.title).toLowerCase();
  const contentA = normalizeText(a.content).toLowerCase();
  const contentB = normalizeText(b.content).toLowerCase();
  if (!titleA || !titleB || !contentA || !contentB) {
    return false;
  }
  if (titleA === titleB && contentA === contentB) {
    return true;
  }
  const titleScore = similarityFromTokens(titleA, titleB);
  const contentScore = similarityFromTokens(contentA, contentB);
  return titleScore >= 0.8 && contentScore >= 0.9;
}

function chooseCanonical(items: KnowledgeRow[]) {
  return [...items].sort((a, b) => {
    const importanceA = Number(a.importanceScore ?? 0);
    const importanceB = Number(b.importanceScore ?? 0);
    if (importanceA !== importanceB) {
      return importanceB - importanceA;
    }
    if (a.accessCount !== b.accessCount) {
      return b.accessCount - a.accessCount;
    }
    return b.createdAt.getTime() - a.createdAt.getTime();
  })[0];
}

function mergeUniqueValues(values: string[][], mode: "tag" | "stage" | "tech") {
  const merged = values.flatMap((item) => item);
  if (mode === "tag") {
    return normalizeTagList(merged);
  }
  if (mode === "stage") {
    return normalizeStageContextList(merged);
  }
  return normalizeTechStackList(merged);
}

function buildNormalizationSuggestion(item: KnowledgeRow): KnowledgeNormalizationSuggestion | null {
  const before = {
    title: item.title,
    tags: asStringArray(item.tags),
    stageContext: asStringArray(item.stageContext),
    techStack: asStringArray(item.techStack)
  };
  const combinedText = `${item.title}\n${item.content}`;
  const next = {
    title: normalizeKnowledgeTitle(item.title) || "Untitled knowledge",
    tags: normalizeTagList(before.tags, combinedText),
    stageContext: inferStageContextFromText({
      title: item.title,
      content: item.content,
      tags: before.tags,
      stageContext: before.stageContext
    }),
    techStack: normalizeTechStackList([...before.techStack, ...inferTechStackFromText(combinedText)])
  };
  const reasons: string[] = [];
  if (before.title !== next.title) {
    reasons.push("title_normalized");
  }
  if (JSON.stringify(before.tags) !== JSON.stringify(next.tags)) {
    reasons.push("tags_normalized");
  }
  if (JSON.stringify(before.stageContext) !== JSON.stringify(next.stageContext)) {
    reasons.push("stage_context_normalized");
  }
  if (JSON.stringify(before.techStack) !== JSON.stringify(next.techStack)) {
    reasons.push("tech_stack_normalized");
  }
  if (reasons.length === 0) {
    return null;
  }
  return {
    itemId: item.id,
    before,
    after: next,
    reasons
  };
}

async function moveAgentPreferencesToCanonical(input: { canonicalId: string; duplicateId: string }) {
  const preferences = await prisma.agentKnowledgePreference.findMany({
    where: { knowledgeId: input.duplicateId }
  });
  for (const pref of preferences) {
    const existing = await prisma.agentKnowledgePreference.findFirst({
      where: {
        agentId: pref.agentId,
        knowledgeId: input.canonicalId,
        context: pref.context
      }
    });
    if (!existing) {
      await prisma.agentKnowledgePreference.create({
        data: {
          agentId: pref.agentId,
          knowledgeId: input.canonicalId,
          context: pref.context,
          preferenceScore: pref.preferenceScore
        }
      });
    } else if (pref.preferenceScore > existing.preferenceScore) {
      await prisma.agentKnowledgePreference.update({
        where: { id: existing.id },
        data: { preferenceScore: pref.preferenceScore }
      });
    }
  }
}

async function detectDuplicateGroups(rows: KnowledgeRow[]) {
  const groups: KnowledgeDuplicateGroup[] = [];
  const consumed = new Set<string>();
  for (let i = 0; i < rows.length; i += 1) {
    const base = rows[i];
    if (consumed.has(base.id)) {
      continue;
    }
    const cluster: KnowledgeRow[] = [base];
    for (let j = i + 1; j < rows.length; j += 1) {
      const current = rows[j];
      if (consumed.has(current.id)) {
        continue;
      }
      if (isLikelyDuplicate(base, current)) {
        cluster.push(current);
      }
    }
    if (cluster.length <= 1) {
      continue;
    }
    const canonical = chooseCanonical(cluster);
    const duplicateItems = cluster.filter((item) => item.id !== canonical.id);
    duplicateItems.forEach((item) => consumed.add(item.id));
    consumed.add(canonical.id);
    const avgSimilarity = duplicateItems.reduce((sum, item) => {
      return sum + similarityFromTokens(`${canonical.title}\n${canonical.content}`, `${item.title}\n${item.content}`);
    }, 0) / duplicateItems.length;
    groups.push({
      canonicalId: canonical.id,
      duplicateIds: duplicateItems.map((item) => item.id),
      similarity: Number(avgSimilarity.toFixed(3)),
      reason: "high textual overlap"
    });
  }
  return groups;
}

export async function ingestKnowledgeItem(input: IngestKnowledgeInput) {
  const normalizedTitle = normalizeKnowledgeTitle(input.title) || "Untitled knowledge";
  const content = String(input.content ?? "");
  const combinedText = `${normalizedTitle}\n${content}`;
  const normalizedTags = normalizeTagList(input.tags ?? [], combinedText);
  const normalizedStages = inferStageContextFromText({
    title: normalizedTitle,
    content,
    tags: normalizedTags,
    stageContext: input.stageContext ?? []
  });
  const normalizedTechStack = normalizeTechStackList([
    ...(input.techStack ?? []),
    ...inferTechStackFromText(combinedText)
  ]);
  const resolvedMemoryType = input.memoryType ?? inferMemoryTypeFromText({
    type: input.type,
    title: normalizedTitle,
    content,
    stageContext: normalizedStages
  });
  const resolvedImportanceScore = input.importanceScore === undefined
    ? inferImportanceScoreFromText({
      title: normalizedTitle,
      content,
      memoryType: resolvedMemoryType
    })
    : clampImportanceScore(input.importanceScore, 0.5);
  return prisma.knowledgeItem.create({
    data: {
      scope: input.scope,
      projectId: input.projectId ?? null,
      agentId: input.agentId ?? null,
      type: input.type,
      title: normalizedTitle,
      content,
      metadata: toJson(input.metadata ?? {}),
      tags: toJson(normalizedTags),
      stageContext: toJson(normalizedStages),
      techStack: toJson(normalizedTechStack),
      memoryType: resolvedMemoryType,
      importanceScore: resolvedImportanceScore,
      sourceUrl: input.sourceUrl ?? null,
      filePath: input.filePath ?? null,
      fileType: input.fileType ?? null
    }
  });
}

export async function ingestTextAsKnowledge(input: {
  title: string;
  content: string;
  scope: KnowledgeScope;
  projectId?: string;
  agentId?: string;
  tags?: string[];
  importanceScore?: number;
}) {
  return ingestKnowledgeItem({
    scope: input.scope,
    projectId: input.projectId,
    agentId: input.agentId,
    type: "text",
    title: input.title,
    content: input.content,
    tags: input.tags ?? [],
    stageContext: [],
    techStack: [],
    importanceScore: input.importanceScore
  });
}

export async function ingestDocumentText(input: {
  fileName: string;
  fileContent: string;
  scope: KnowledgeScope;
  projectId?: string;
  agentId?: string;
  tags?: string[];
  triggeredBy?: string;
}) {
  const chunks = splitIntoChunks(input.fileContent);
  const created = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const item = await ingestKnowledgeItem({
      scope: input.scope,
      projectId: input.projectId,
      agentId: input.agentId,
      type: "document",
      title: `${input.fileName} - Part ${i + 1}`,
      content: chunks[i],
      tags: input.tags ?? [],
      metadata: {
        sourceFile: input.fileName,
        chunkIndex: i,
        totalChunks: chunks.length
      },
      stageContext: [],
      techStack: []
    });
    created.push(item);
    if (i > 0) {
      await prisma.knowledgeRelation.create({
        data: {
          sourceId: created[i - 1].id,
          targetId: item.id,
          relationType: "relates_to",
          strength: 0.8
        }
      });
    }
  }
  await createKnowledgeOperationLog({
    operationType: "upload_document",
    summary: `uploaded document: ${input.fileName} (${created.length} chunks)`,
    scope: input.scope,
    projectId: input.projectId ?? null,
    agentId: input.agentId ?? null,
    triggeredBy: input.triggeredBy ?? null,
    canRollback: created.length > 0,
    payload: {
      fileName: input.fileName,
      createdIds: created.map((item) => item.id),
      createdItems: created.map((item) => snapshotKnowledgeItem(item))
    }
  });
  return created;
}

export async function ingestKnowledgeFromStageOutput(input: {
  projectId: string;
  projectName: string;
  projectDescription: string;
  stageKey: string;
  outputText: string;
  title?: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
}) {
  const extraction = await extractKnowledgeFromStageOutput({
    projectName: input.projectName,
    projectDescription: input.projectDescription,
    stageKey: input.stageKey,
    outputText: input.outputText
  });

  return ingestKnowledgeItem({
    scope: "project",
    projectId: input.projectId,
    agentId: input.agentId,
    type: "sop",
    title: input.title || `${input.stageKey} stage knowledge`,
    content: input.outputText,
    tags: extraction.tags,
    stageContext: extraction.stageContext,
    techStack: extraction.techStack,
    memoryType: extraction.memoryType,
    importanceScore: extraction.importanceScore,
    metadata: {
      extractedSummary: extraction.summary,
      ...(input.metadata || {})
    }
  });
}

export async function retrieveKnowledgeForContext(input: {
  query: string;
  context: RetrievalContext;
  topK?: number;
  threshold?: number;
}): Promise<RetrievalResult[]> {
  const topK = Math.max(1, Number(input.topK ?? 5));
  const threshold = Math.max(0, Math.min(1, Number(input.threshold ?? 0.18)));
  const context = input.context;
  const normalizedCurrentStage = context.currentStage
    ? normalizeStageContextList([context.currentStage]).at(0)
    : undefined;
  const normalizedTechNeed = context.techStack && context.techStack.length > 0
    ? normalizeTechStackList(context.techStack)
    : [];

  const rows = await prisma.knowledgeItem.findMany({
    where: {
      OR: [
        { scope: "global" },
        context.projectId ? { scope: "project", projectId: context.projectId } : undefined,
        context.agentId ? { scope: "agent", agentId: context.agentId } : undefined
      ].filter(Boolean) as Array<Record<string, unknown>>
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 200
  });

  let preferenceMap = new Map<string, number>();
  if (context.agentId) {
    const prefs = await prisma.agentKnowledgePreference.findMany({
      where: { agentId: context.agentId }
    });
    preferenceMap = new Map(prefs.map((item) => [item.knowledgeId, item.preferenceScore]));
  }

  const scored: RetrievalResult[] = rows
    .map((row) => {
      const stageContext = normalizeStageContextList(asStringArray(row.stageContext));
      const techStack = normalizeTechStackList(asStringArray(row.techStack));
      if (normalizedCurrentStage && stageContext.length > 0 && !stageContext.includes(normalizedCurrentStage)) {
        return null;
      }
      if (normalizedTechNeed.length > 0) {
        const hasHit = normalizedTechNeed.some((item) => techStack.includes(item));
        if (!hasHit && techStack.length > 0) {
          return null;
        }
      }

      const similarity = computeSimilarity(input.query, row.title, row.content);
      const preference = preferenceMap.get(row.id) ?? 0;
      const recency = recencyScore(row.createdAt);
      const popularity = Math.min(1, Number(row.accessCount || 0) / 100);
      const finalScore = similarity * 0.5 + preference * 0.2 + recency * 0.2 + popularity * 0.1;
      return {
        id: row.id,
        title: row.title,
        content: row.content,
        similarity,
        finalScore,
        memoryType: row.memoryType,
        createdAt: row.createdAt,
        accessCount: row.accessCount
      };
    })
    .filter((item): item is RetrievalResult => Boolean(item))
    .filter((item) => item.similarity >= threshold)
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, topK);

  if (scored.length > 0) {
    await prisma.knowledgeItem.updateMany({
      where: { id: { in: scored.map((item) => item.id) } },
      data: {
        lastAccessedAt: new Date(),
        accessCount: {
          increment: 1
        }
      }
    });
  }

  return scored;
}

export async function buildAgentContext(input: {
  projectId: string;
  currentStage: string;
  agentId?: string;
  userQuery: string;
}) {
  const knowledge = await retrieveKnowledgeForContext({
    query: input.userQuery,
    context: {
      projectId: input.projectId,
      currentStage: input.currentStage,
      agentId: input.agentId
    },
    topK: 5
  });
  const summary = await getProjectMemorySummary(input.projectId);
  return [
    "## 相关背景知识",
    ...knowledge.map((item) => `### ${item.title}\n${item.content}`),
    "## 项目历史经验",
    summary,
    "## 当前任务",
    input.userQuery
  ].join("\n\n");
}

export async function getProjectMemorySummary(projectId: string) {
  const memories = await prisma.knowledgeItem.findMany({
    where: {
      scope: "project",
      projectId,
      memoryType: "episodic"
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 5
  });
  if (memories.length === 0) {
    return "暂无历史经验记录。";
  }
  return memories.map((item) => `- ${item.title}: ${item.content.slice(0, 200)}...`).join("\n");
}

export async function listKnowledgeItems(filters: KnowledgeListFilters) {
  const limit = clampPositiveInt(Number(filters.limit ?? 20), 20, 200);
  const offset = Math.max(0, Math.floor(Number(filters.offset ?? 0) || 0));
  const query = normalizeText(filters.query);
  const normalizedStageContext = normalizeStageContextList([normalizeText(filters.stageContext)]).at(0);
  const whereClause: Prisma.KnowledgeItemWhereInput = {
    scope: filters.scope,
    projectId: filters.projectId,
    agentId: filters.agentId,
    type: filters.type,
    memoryType: filters.memoryType,
    OR: query
      ? [
        { title: { contains: query } },
        { content: { contains: query } }
      ]
      : undefined
  };

  // SQLite JSON filter portability is limited; stageContext uses normalized in-memory filtering.
  if (!normalizedStageContext) {
    return prisma.knowledgeItem.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit
    });
  }

  const rows = await prisma.knowledgeItem.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" }
  });
  const filtered = rows.filter((row) => {
    const stageContext = normalizeStageContextList(asStringArray(row.stageContext));
    return stageContext.includes(normalizedStageContext);
  });
  return filtered.slice(offset, offset + limit);
}

export async function getKnowledgeItemById(id: string) {
  return prisma.knowledgeItem.findUnique({
    where: { id: normalizeText(id) }
  });
}

export async function updateKnowledgeItemById(id: string, patch: KnowledgeUpdateInput) {
  const normalizedId = normalizeText(id);
  if (!normalizedId) {
    throw new Error("knowledge id is required");
  }

  const current = await prisma.knowledgeItem.findUnique({
    where: { id: normalizedId }
  });
  if (!current) {
    return null;
  }

  const nextTitle = patch.title === undefined
    ? current.title
    : (normalizeKnowledgeTitle(patch.title) || "Untitled knowledge");
  const nextContent = patch.content === undefined ? current.content : String(patch.content ?? "");
  const combinedText = `${nextTitle}\n${nextContent}`;
  const tags = patch.tags === undefined ? asStringArray(current.tags) : patch.tags;
  const stageContext = patch.stageContext === undefined ? asStringArray(current.stageContext) : patch.stageContext;
  const techStack = patch.techStack === undefined ? asStringArray(current.techStack) : patch.techStack;
  const normalizedTags = normalizeTagList(tags, combinedText);
  const normalizedStages = inferStageContextFromText({
    title: nextTitle,
    content: nextContent,
    tags: normalizedTags,
    stageContext
  });
  const normalizedTechStack = normalizeTechStackList([...techStack, ...inferTechStackFromText(combinedText)]);
  const currentMemoryType = normalizeMemoryTypeValue(current.memoryType);
  const resolvedMemoryType = patch.memoryType === undefined
    ? (currentMemoryType ?? inferMemoryTypeFromText({
      type: (patch.type ?? current.type) as KnowledgeType,
      title: nextTitle,
      content: nextContent,
      stageContext: normalizedStages
    }))
    : patch.memoryType;
  const resolvedImportanceScore = patch.importanceScore === undefined
    ? (current.importanceScore ?? inferImportanceScoreFromText({
      title: nextTitle,
      content: nextContent,
      memoryType: resolvedMemoryType ?? "semantic"
    }))
    : clampImportanceScore(patch.importanceScore, current.importanceScore ?? 0.5);

  return prisma.knowledgeItem.update({
    where: { id: normalizedId },
    data: {
      scope: patch.scope ?? current.scope,
      projectId: patch.projectId === undefined ? current.projectId : patch.projectId,
      agentId: patch.agentId === undefined ? current.agentId : patch.agentId,
      type: patch.type ?? current.type,
      title: nextTitle,
      content: nextContent,
      metadata: patch.metadata === undefined
        ? toJson(asRecord(current.metadata) ?? {})
        : toJson(patch.metadata),
      tags: toJson(normalizedTags),
      stageContext: toJson(normalizedStages),
      techStack: toJson(normalizedTechStack),
      memoryType: resolvedMemoryType,
      importanceScore: resolvedImportanceScore,
      sourceUrl: patch.sourceUrl === undefined ? current.sourceUrl : patch.sourceUrl,
      filePath: patch.filePath === undefined ? current.filePath : patch.filePath,
      fileType: patch.fileType === undefined ? current.fileType : patch.fileType
    }
  });
}

export async function deleteKnowledgeItemById(id: string, input?: { triggeredBy?: string }) {
  const normalized = normalizeText(id);
  if (!normalized) {
    throw new Error("knowledge id is required");
  }
  const existing = await prisma.knowledgeItem.findUnique({
    where: { id: normalized }
  });
  if (!existing) {
    return false;
  }
  await prisma.knowledgeItem.delete({
    where: { id: normalized }
  });
  await createKnowledgeOperationLog({
    operationType: "delete_single",
    summary: `deleted knowledge: ${existing.title}`,
    scope: existing.scope,
    projectId: existing.projectId,
    agentId: existing.agentId,
    triggeredBy: input?.triggeredBy ?? null,
    canRollback: true,
    payload: {
      deletedItems: [snapshotKnowledgeItem(existing)]
    }
  });
  return true;
}

export async function bulkDeleteKnowledgeItems(ids: string[], input?: { triggeredBy?: string }) {
  const uniqueIds = uniqueNormalized(ids);
  if (uniqueIds.length === 0) {
    return { count: 0 };
  }
  const rows = await prisma.knowledgeItem.findMany({
    where: {
      id: {
        in: uniqueIds
      }
    }
  });
  const result = await prisma.knowledgeItem.deleteMany({
    where: {
      id: {
        in: uniqueIds
      }
    }
  });
  if (rows.length > 0) {
    const scoped = rows[0];
    await createKnowledgeOperationLog({
      operationType: "delete_bulk",
      summary: `bulk deleted knowledge items: ${result.count}`,
      scope: scoped?.scope ?? null,
      projectId: scoped?.projectId ?? null,
      agentId: scoped?.agentId ?? null,
      triggeredBy: input?.triggeredBy ?? null,
      canRollback: true,
      payload: {
        deletedItems: rows.map((item) => snapshotKnowledgeItem(item))
      }
    });
  }
  return { count: result.count };
}

async function fetchKnowledgeForCuration(input: {
  scope?: KnowledgeScope;
  projectId?: string;
  agentId?: string;
  limit?: number;
}) {
  const limit = clampPositiveInt(Number(input.limit ?? 200), 200, 500);
  return prisma.knowledgeItem.findMany({
    where: {
      scope: input.scope,
      projectId: input.projectId,
      agentId: input.agentId
    },
    orderBy: { createdAt: "desc" },
    take: limit
  });
}

export async function previewKnowledgeCuration(input: {
  scope?: KnowledgeScope;
  projectId?: string;
  agentId?: string;
  limit?: number;
}): Promise<KnowledgeCurationPreview> {
  const rows = await fetchKnowledgeForCuration(input);
  const suggestions = rows
    .map((item) => buildNormalizationSuggestion(item))
    .filter((item): item is KnowledgeNormalizationSuggestion => Boolean(item));
  const duplicateGroups = await detectDuplicateGroups(rows);
  return {
    totalItems: rows.length,
    normalizationSuggestions: suggestions,
    duplicateGroups
  };
}

export async function applyKnowledgeCuration(input: {
  scope?: KnowledgeScope;
  projectId?: string;
  agentId?: string;
  limit?: number;
  normalizeFields?: boolean;
  mergeDuplicates?: boolean;
  maxDuplicateGroups?: number;
  targetCanonicalIds?: string[];
  triggeredBy?: string;
  recordOperation?: boolean;
}): Promise<KnowledgeCurationApplyResult> {
  const normalizeFields = input.normalizeFields !== false;
  const mergeDuplicates = input.mergeDuplicates !== false;
  const preview = await previewKnowledgeCuration(input);
  let normalizedCount = 0;
  let mergedCount = 0;
  let deletedCount = 0;
  const normalizedBefore: Array<{
    itemId: string;
    title: string;
    tags: string[];
    stageContext: string[];
    techStack: string[];
  }> = [];
  const mergedGroupsSnapshot: Array<{
    group: KnowledgeDuplicateGroup;
    canonicalBefore: KnowledgeItemSnapshot;
    duplicateItems: KnowledgeItemSnapshot[];
    duplicatePreferences: Array<{
      duplicateId: string;
      preferences: Array<{
        agentId: string;
        context: string | null;
        preferenceScore: number;
      }>;
    }>;
  }> = [];

  if (normalizeFields && preview.normalizationSuggestions.length > 0) {
    for (const suggestion of preview.normalizationSuggestions) {
      const current = await prisma.knowledgeItem.findUnique({
        where: { id: suggestion.itemId }
      });
      if (!current) {
        continue;
      }
      normalizedBefore.push({
        itemId: current.id,
        title: current.title,
        tags: asStringArray(current.tags),
        stageContext: asStringArray(current.stageContext),
        techStack: asStringArray(current.techStack)
      });
      await prisma.knowledgeItem.update({
        where: { id: suggestion.itemId },
        data: {
          title: suggestion.after.title,
          tags: toJson(suggestion.after.tags),
          stageContext: toJson(suggestion.after.stageContext),
          techStack: toJson(suggestion.after.techStack)
        }
      });
      normalizedCount += 1;
    }
  }

  if (mergeDuplicates && preview.duplicateGroups.length > 0) {
    const maxDuplicateGroups = clampPositiveInt(
      Number(input.maxDuplicateGroups ?? 20),
      20,
      100
    );
    const targetSet = new Set(uniqueNormalized(input.targetCanonicalIds ?? []));
    const filteredGroups = targetSet.size > 0
      ? preview.duplicateGroups.filter((group) => targetSet.has(group.canonicalId))
      : preview.duplicateGroups;
    const groups = filteredGroups.slice(0, maxDuplicateGroups);
    for (const group of groups) {
      const ids = [group.canonicalId, ...group.duplicateIds];
      const rows = await prisma.knowledgeItem.findMany({
        where: { id: { in: ids } }
      });
      if (rows.length <= 1) {
        continue;
      }
      const canonical = chooseCanonical(rows);
      const duplicates = rows.filter((item) => item.id !== canonical.id);
      if (duplicates.length === 0) {
        continue;
      }

      const mergedTags = mergeUniqueValues(
        [canonical, ...duplicates].map((item) => asStringArray(item.tags)),
        "tag"
      );
      const mergedStages = mergeUniqueValues(
        [canonical, ...duplicates].map((item) => asStringArray(item.stageContext)),
        "stage"
      );
      const mergedTech = mergeUniqueValues(
        [canonical, ...duplicates].map((item) => asStringArray(item.techStack)),
        "tech"
      );

      const duplicateContents = duplicates.map((item) => normalizeText(item.content)).filter(Boolean);
      const bestDuplicateContent = duplicateContents.sort((a, b) => b.length - a.length)[0];
      const canonicalContent = normalizeText(canonical.content);
      const mergedContent = bestDuplicateContent && bestDuplicateContent.length > canonicalContent.length
        ? bestDuplicateContent
        : canonicalContent;

      const metadata = asRecord(canonical.metadata) ?? {};
      const mergedFrom = uniqueNormalized([
        ...asStringArray(metadata.mergedFrom),
        ...duplicates.map((item) => item.id)
      ]);

      const duplicatePreferences: Array<{
        duplicateId: string;
        preferences: Array<{
          agentId: string;
          context: string | null;
          preferenceScore: number;
        }>;
      }> = [];
      for (const item of duplicates) {
        const prefs = await prisma.agentKnowledgePreference.findMany({
          where: { knowledgeId: item.id }
        });
        duplicatePreferences.push({
          duplicateId: item.id,
          preferences: prefs.map((pref) => ({
            agentId: pref.agentId,
            context: pref.context ?? null,
            preferenceScore: pref.preferenceScore
          }))
        });
      }

      mergedGroupsSnapshot.push({
        group,
        canonicalBefore: snapshotKnowledgeItem(canonical),
        duplicateItems: duplicates.map((item) => snapshotKnowledgeItem(item)),
        duplicatePreferences
      });

      await prisma.knowledgeItem.update({
        where: { id: canonical.id },
        data: {
          content: mergedContent || canonical.content,
          tags: toJson(mergedTags),
          stageContext: toJson(mergedStages),
          techStack: toJson(mergedTech),
          metadata: toJson({
            ...metadata,
            mergedFrom,
            mergedAt: new Date().toISOString()
          })
        }
      });

      for (const item of duplicates) {
        await moveAgentPreferencesToCanonical({
          canonicalId: canonical.id,
          duplicateId: item.id
        });
      }

      const deleted = await prisma.knowledgeItem.deleteMany({
        where: { id: { in: duplicates.map((item) => item.id) } }
      });
      mergedCount += duplicates.length;
      deletedCount += deleted.count;
    }
  }

  const operationId = input.recordOperation === false
    ? null
    : await createKnowledgeOperationLog({
      operationType: "curation_apply",
      summary: `knowledge curation applied (normalized=${normalizedCount}, merged=${mergedCount}, deleted=${deletedCount})`,
      scope: input.scope ?? null,
      projectId: input.projectId ?? null,
      agentId: input.agentId ?? null,
      triggeredBy: input.triggeredBy ?? null,
      canRollback: normalizedCount > 0 || mergedCount > 0 || deletedCount > 0,
      payload: {
        normalizedBefore,
        mergedGroupsSnapshot,
        input: {
          scope: input.scope ?? null,
          projectId: input.projectId ?? null,
          agentId: input.agentId ?? null,
          normalizeFields,
          mergeDuplicates
        }
      }
    });

  return {
    ...preview,
    normalizedCount,
    mergedCount,
    deletedCount,
    operationId: operationId ?? undefined
  };
}

export async function autoOrganizeKnowledge(input: {
  projectId?: string;
  agentId?: string;
  limit?: number;
}) {
  const projectId = normalizeText(input.projectId);
  const agentId = normalizeText(input.agentId);
  const hasScope = Boolean(projectId || agentId);
  if (!hasScope) {
    return null;
  }
  try {
    const result = await applyKnowledgeCuration({
      projectId: projectId || undefined,
      agentId: agentId || undefined,
      limit: clampPositiveInt(Number(input.limit ?? 120), 120, 200),
      normalizeFields: true,
      mergeDuplicates: true,
      maxDuplicateGroups: 10,
      recordOperation: false
    });
    return result;
  } catch {
    return null;
  }
}

export async function listKnowledgeOperationLogs(input: {
  operationType?: string;
  projectId?: string;
  agentId?: string;
  limit?: number;
}): Promise<KnowledgeOperationLogView[]> {
  try {
    const logs = await prisma.knowledgeOperationLog.findMany({
      where: {
        operationType: normalizeText(input.operationType) || undefined,
        projectId: normalizeText(input.projectId) || undefined,
        agentId: normalizeText(input.agentId) || undefined
      },
      orderBy: {
        createdAt: "desc"
      },
      take: clampPositiveInt(Number(input.limit ?? 50), 50, 200)
    });
    return logs.map((log) => ({
      id: log.id,
      operationType: log.operationType,
      scope: log.scope ?? null,
      projectId: log.projectId ?? null,
      agentId: log.agentId ?? null,
      triggeredBy: log.triggeredBy ?? null,
      summary: log.summary,
      canRollback: Boolean(log.canRollback),
      rolledBackAt: log.rolledBackAt ?? null,
      createdAt: log.createdAt
    }));
  } catch (error) {
    if (isMissingTableError(error)) {
      return [];
    }
    throw error;
  }
}

export async function rollbackKnowledgeOperation(input: {
  operationId: string;
  triggeredBy?: string;
}) {
  const operationId = normalizeText(input.operationId);
  if (!operationId) {
    throw new Error("operationId is required");
  }

  let operation: KnowledgeOperationRow;
  try {
    const found = await prisma.knowledgeOperationLog.findUnique({
      where: { id: operationId }
    });
    if (!found) {
      throw new Error(`operation not found: ${operationId}`);
    }
    operation = found;
  } catch (error) {
    if (isMissingTableError(error)) {
      throw new Error("knowledge operation history is not ready");
    }
    throw error;
  }

  if (!operation.canRollback) {
    return {
      success: false,
      message: "operation is not rollbackable",
      restoredCount: 0
    };
  }
  if (operation.rolledBackAt) {
    return {
      success: false,
      message: "operation already rolled back",
      restoredCount: 0
    };
  }

  const payload = asRecord(operation.payload) ?? {};
  let restoredCount = 0;

  if (operation.operationType === "delete_single" || operation.operationType === "delete_bulk") {
    const deletedItems = (Array.isArray(payload.deletedItems) ? payload.deletedItems : [])
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((item) => ({
        id: String(item.id ?? ""),
        scope: String(item.scope ?? "project"),
        projectId: item.projectId ? String(item.projectId) : null,
        agentId: item.agentId ? String(item.agentId) : null,
        type: String(item.type ?? "text"),
        title: String(item.title ?? "Untitled knowledge"),
        content: String(item.content ?? ""),
        metadata: asRecord(item.metadata) ?? {},
        tags: asStringArray(item.tags),
        stageContext: asStringArray(item.stageContext),
        techStack: asStringArray(item.techStack),
        memoryType: item.memoryType ? String(item.memoryType) : null,
        importanceScore: typeof item.importanceScore === "number" ? item.importanceScore : null,
        sourceUrl: item.sourceUrl ? String(item.sourceUrl) : null,
        filePath: item.filePath ? String(item.filePath) : null,
        fileType: item.fileType ? String(item.fileType) : null,
        accessCount: Number(item.accessCount ?? 0),
        lastAccessedAt: item.lastAccessedAt ? String(item.lastAccessedAt) : null,
        createdAt: item.createdAt ? String(item.createdAt) : new Date().toISOString()
      }));
    restoredCount += await recreateKnowledgeItems(deletedItems);
  } else if (operation.operationType === "upload_document") {
    const createdIds = asStringArray(payload.createdIds);
    if (createdIds.length > 0) {
      const deleted = await prisma.knowledgeItem.deleteMany({
        where: {
          id: {
            in: createdIds
          }
        }
      });
      restoredCount += deleted.count;
    }
  } else if (operation.operationType === "curation_apply") {
    const normalizedBefore = (Array.isArray(payload.normalizedBefore) ? payload.normalizedBefore : [])
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item));
    for (const before of normalizedBefore) {
      const itemId = normalizeText(before.itemId);
      if (!itemId) {
        continue;
      }
      const exists = await prisma.knowledgeItem.findUnique({
        where: { id: itemId },
        select: { id: true }
      });
      if (!exists) {
        continue;
      }
      await prisma.knowledgeItem.update({
        where: { id: itemId },
        data: {
          title: normalizeText(before.title) || "Untitled knowledge",
          tags: toJson(asStringArray(before.tags)),
          stageContext: toJson(asStringArray(before.stageContext)),
          techStack: toJson(asStringArray(before.techStack))
        }
      });
      restoredCount += 1;
    }

    const mergedGroups = (Array.isArray(payload.mergedGroupsSnapshot) ? payload.mergedGroupsSnapshot : [])
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item));
    for (const group of mergedGroups) {
      const canonicalBefore = asRecord(group.canonicalBefore);
      if (canonicalBefore) {
        const canonicalId = normalizeText(canonicalBefore.id);
        if (canonicalId) {
          const canonicalExists = await prisma.knowledgeItem.findUnique({
            where: { id: canonicalId },
            select: { id: true }
          });
          if (canonicalExists) {
            await prisma.knowledgeItem.update({
              where: { id: canonicalId },
              data: {
                title: normalizeText(canonicalBefore.title) || "Untitled knowledge",
                content: String(canonicalBefore.content ?? ""),
                metadata: toJson(asRecord(canonicalBefore.metadata) ?? {}),
                tags: toJson(asStringArray(canonicalBefore.tags)),
                stageContext: toJson(asStringArray(canonicalBefore.stageContext)),
                techStack: toJson(asStringArray(canonicalBefore.techStack)),
                memoryType: canonicalBefore.memoryType ? String(canonicalBefore.memoryType) : null,
                importanceScore: typeof canonicalBefore.importanceScore === "number" ? canonicalBefore.importanceScore : null
              }
            });
            restoredCount += 1;
          }
        }
      }

      const duplicateItems = (Array.isArray(group.duplicateItems) ? group.duplicateItems : [])
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item) => ({
          id: String(item.id ?? ""),
          scope: String(item.scope ?? "project"),
          projectId: item.projectId ? String(item.projectId) : null,
          agentId: item.agentId ? String(item.agentId) : null,
          type: String(item.type ?? "text"),
          title: String(item.title ?? "Untitled knowledge"),
          content: String(item.content ?? ""),
          metadata: asRecord(item.metadata) ?? {},
          tags: asStringArray(item.tags),
          stageContext: asStringArray(item.stageContext),
          techStack: asStringArray(item.techStack),
          memoryType: item.memoryType ? String(item.memoryType) : null,
          importanceScore: typeof item.importanceScore === "number" ? item.importanceScore : null,
          sourceUrl: item.sourceUrl ? String(item.sourceUrl) : null,
          filePath: item.filePath ? String(item.filePath) : null,
          fileType: item.fileType ? String(item.fileType) : null,
          accessCount: Number(item.accessCount ?? 0),
          lastAccessedAt: item.lastAccessedAt ? String(item.lastAccessedAt) : null,
          createdAt: item.createdAt ? String(item.createdAt) : new Date().toISOString()
        }));
      restoredCount += await recreateKnowledgeItems(duplicateItems);

      const duplicatePreferences = (Array.isArray(group.duplicatePreferences) ? group.duplicatePreferences : [])
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item));
      for (const prefGroup of duplicatePreferences) {
        const duplicateId = normalizeText(prefGroup.duplicateId);
        if (!duplicateId) {
          continue;
        }
        const prefs = (Array.isArray(prefGroup.preferences) ? prefGroup.preferences : [])
          .map((pref) => asRecord(pref))
          .filter((pref): pref is Record<string, unknown> => Boolean(pref));
        for (const pref of prefs) {
          const agentId = normalizeText(pref.agentId);
          if (!agentId) {
            continue;
          }
          const context = pref.context ? normalizeText(pref.context) : null;
          const existing = await prisma.agentKnowledgePreference.findFirst({
            where: {
              agentId,
              knowledgeId: duplicateId,
              context
            }
          });
          if (!existing) {
            await prisma.agentKnowledgePreference.create({
              data: {
                agentId,
                knowledgeId: duplicateId,
                context,
                preferenceScore: Number(pref.preferenceScore ?? 0)
              }
            });
          }
        }
      }
    }
  } else {
    return {
      success: false,
      message: `rollback not supported for ${operation.operationType}`,
      restoredCount: 0
    };
  }

  await prisma.knowledgeOperationLog.update({
    where: { id: operation.id },
    data: {
      rolledBackAt: new Date()
    }
  });

  await createKnowledgeOperationLog({
    operationType: "rollback",
    summary: `rollback applied for ${operation.operationType} (${operation.id})`,
    scope: operation.scope ?? null,
    projectId: operation.projectId ?? null,
    agentId: operation.agentId ?? null,
    triggeredBy: normalizeText(input.triggeredBy) || null,
    canRollback: false,
    payload: {
      rolledBackOperationId: operation.id,
      restoredCount
    }
  });

  return {
    success: true,
    message: "rollback applied",
    restoredCount
  };
}
