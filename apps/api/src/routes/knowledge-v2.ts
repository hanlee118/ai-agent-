import express from "express";
import { MutationPassthroughSchema } from "../validation/schemas.js";
import { extname } from "node:path";
import multer from "multer";
import { Prisma } from "@prisma/client";
import {
  applyKnowledgeCuration,
  autoOrganizeKnowledge,
  buildAgentContext,
  bulkDeleteKnowledgeItems,
  countKnowledgeItems,
  deleteKnowledgeItemById,
  getKnowledgeItemById,
  getProjectMemorySummary,
  ingestDocumentText,
  ingestKnowledgeItem,
  ingestTextAsKnowledge,
  listKnowledgeItems,
  listKnowledgeOperationLogs,
  previewKnowledgeCuration,
  retrieveKnowledgeForContext,
  rollbackKnowledgeOperation,
  updateKnowledgeItemById
} from "../workflow-v2/knowledge-service.js";
import { getKnowledgeV2SchemaStatus } from "../workflow-v2/schema-ready.js";
import { prisma } from "../db.js";
import { asyncRoute, sendError, sendSuccess } from "./utils.js";
import { asStringArray, normalizeText, type KnowledgeScope } from "../workflow-v2/types.js";
import { validateHermesApiKey } from "./hermes-auth.js";
import { validateBody } from "../validation/middleware.js";
import { KnowledgeCreateSchema } from "../validation/schemas.js";

type UploadKnowledgeBody = {
  scope?: unknown;
  projectId?: unknown;
  agentId?: unknown;
  tags?: unknown;
  fileName?: unknown;
  fileContent?: unknown;
  triggeredBy?: unknown;
};

type CreateTextKnowledgeBody = {
  title?: unknown;
  content?: unknown;
  scope?: unknown;
  projectId?: unknown;
  agentId?: unknown;
  tags?: unknown;
  importanceScore?: unknown;
  triggeredBy?: unknown;
};

type SearchKnowledgeBody = {
  query?: unknown;
  projectId?: unknown;
  stage?: unknown;
  agentId?: unknown;
  techStack?: unknown;
  limit?: unknown;
};

type UpdateKnowledgeBody = {
  scope?: unknown;
  projectId?: unknown;
  agentId?: unknown;
  type?: unknown;
  title?: unknown;
  content?: unknown;
  metadata?: unknown;
  tags?: unknown;
  stageContext?: unknown;
  techStack?: unknown;
  memoryType?: unknown;
  importanceScore?: unknown;
  sourceUrl?: unknown;
  filePath?: unknown;
  fileType?: unknown;
  triggeredBy?: unknown;
};

type BulkDeleteBody = {
  ids?: unknown;
  triggeredBy?: unknown;
};

type CurationBody = {
  scope?: unknown;
  projectId?: unknown;
  agentId?: unknown;
  limit?: unknown;
  normalizeFields?: unknown;
  mergeDuplicates?: unknown;
  maxDuplicateGroups?: unknown;
  targetCanonicalIds?: unknown;
  triggeredBy?: unknown;
};

type HermesMemorySyncBody = {
  projectId?: unknown;
  scope?: unknown;
  memoryType?: unknown;
  title?: unknown;
  content?: unknown;
  importanceScore?: unknown;
  tags?: unknown;
  stageContext?: unknown;
  techStack?: unknown;
  agentId?: unknown;
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Math.max(1_024 * 1_024, Number(process.env.KNOWLEDGE_UPLOAD_MAX_BYTES ?? 12 * 1_024 * 1_024))
  }
});

const KNOWLEDGE_AUTO_ORGANIZE_ON_INGEST =
  String(process.env.KNOWLEDGE_AUTO_ORGANIZE_ON_INGEST ?? "true").trim().toLowerCase() !== "false"
  && String(process.env.NODE_ENV ?? "").trim().toLowerCase() !== "test";

const TEXT_FILE_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".java",
  ".go",
  ".sql",
  ".yaml",
  ".yml",
  ".csv"
]);

function parseFlexibleStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => String(item ?? "").split(","))
      .map((item) => item.trim())
      .filter(Boolean);
  }
  const raw = String(value ?? "").trim();
  if (!raw) {
    return [] as string[];
  }
  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item ?? "").trim()).filter(Boolean);
      }
    } catch {
      // fallback to csv parser
    }
  }
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

async function extractTextFromUploadedFile(file: Express.Multer.File) {
  const extension = extname(file.originalname || "").toLowerCase();

  if (extension === ".pdf") {
    const module = await import("pdf-parse");
    const pdfParse = (module.default as unknown as (buffer: Buffer) => Promise<{ text?: string }>);
    const parsed = await pdfParse(file.buffer);
    return String(parsed?.text || "");
  }

  if (extension === ".docx") {
    const module = await import("mammoth");
    const mammoth = module as unknown as {
      extractRawText: (input: { buffer: Buffer }) => Promise<{ value?: string }>;
    };
    const parsed = await mammoth.extractRawText({ buffer: file.buffer });
    return String(parsed?.value || "");
  }

  if (TEXT_FILE_EXTENSIONS.has(extension)) {
    return file.buffer.toString("utf-8");
  }

  throw new Error(`unsupported file type: ${extension || "unknown"}`);
}

function normalizeScope(value: unknown): KnowledgeScope {
  const text = normalizeText(value).toLowerCase();
  if (text === "project" || text === "agent" || text === "template") {
    return text as KnowledgeScope;
  }
  return "global";
}

function normalizeOptionalScope(value: unknown): KnowledgeScope | undefined {
  const text = normalizeText(value).toLowerCase();
  if (text === "global" || text === "project" || text === "agent" || text === "template") {
    return text as KnowledgeScope;
  }
  return undefined;
}

function parsePositiveInt(value: unknown, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const rounded = Math.floor(parsed);
  if (rounded <= 0) {
    return fallback;
  }
  return Math.min(rounded, max);
}

function parseBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") {
    return value;
  }
  const text = normalizeText(value).toLowerCase();
  if (text === "true" || text === "1" || text === "yes") {
    return true;
  }
  if (text === "false" || text === "0" || text === "no") {
    return false;
  }
  return fallback;
}

function normalizeKnowledgeType(value: unknown) {
  const text = normalizeText(value).toLowerCase();
  if (text === "document" || text === "text" || text === "url" || text === "code" || text === "sop") {
    return text as "document" | "text" | "url" | "code" | "sop";
  }
  return undefined;
}

function normalizeMemoryType(value: unknown) {
  const text = normalizeText(value).toLowerCase();
  if (text === "episodic" || text === "semantic" || text === "procedural") {
    return text as "episodic" | "semantic" | "procedural";
  }
  return undefined;
}

function validateScopeBinding(input: {
  scope: KnowledgeScope;
  projectId?: string | null | undefined;
  agentId?: string | null | undefined;
}) {
  const projectId = normalizeText(input.projectId);
  const agentId = normalizeText(input.agentId);
  if (input.scope === "project" && !projectId) {
    return "project scope requires projectId";
  }
  if (input.scope === "agent" && !agentId) {
    return "agent scope requires agentId";
  }
  return null;
}

function normalizeMetadataRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

function resolveKnowledgeSourceMeta(metadata: unknown) {
  const record = normalizeMetadataRecord(metadata);
  const source = normalizeText(
    record.source
    ?? record.integrationEngine
    ?? record.provider
    ?? ""
  ).toLowerCase();
  const hasSourceFile = Boolean(normalizeText(record.sourceFile));

  if (source.includes("hermes")) {
    return { sourceEngine: "hermes", sourceTag: source || "hermes" };
  }
  if (source.includes("stitch")) {
    return { sourceEngine: "stitch", sourceTag: source || "stitch" };
  }
  if (
    source.includes("openclaw")
    || source.startsWith("workflow_v2_agent")
    || source.startsWith("workflow_v2_companion")
  ) {
    return { sourceEngine: "openclaw", sourceTag: source || "openclaw" };
  }
  if (hasSourceFile) {
    return { sourceEngine: "manual", sourceTag: "upload_document" };
  }
  if (source) {
    return { sourceEngine: "system", sourceTag: source };
  }
  return { sourceEngine: "manual", sourceTag: "manual" };
}

type KnowledgeRouteMetric = {
  route: string;
  requests: number;
  success: number;
  failed: number;
  avgLatencyMs: number;
  lastLatencyMs: number;
  lastStatus: number | null;
  lastFailureAt: string | null;
  lastFailureMessage: string | null;
};

const KNOWLEDGE_ROUTE_METRICS = new Map<string, KnowledgeRouteMetric>();

function ensureRouteMetric(route: string) {
  const existing = KNOWLEDGE_ROUTE_METRICS.get(route);
  if (existing) {
    return existing;
  }
  const created: KnowledgeRouteMetric = {
    route,
    requests: 0,
    success: 0,
    failed: 0,
    avgLatencyMs: 0,
    lastLatencyMs: 0,
    lastStatus: null,
    lastFailureAt: null,
    lastFailureMessage: null
  };
  KNOWLEDGE_ROUTE_METRICS.set(route, created);
  return created;
}

function isMissingTableError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}

export function createKnowledgeV2Router() {
  const router = express.Router();

  router.use((req, res, next) => {
    const startedAt = Date.now();
    let failureMessage: string | null = null;
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (res.statusCode >= 400) {
        const errorBody = body as { error?: { message?: unknown }; message?: unknown };
        const message = errorBody?.error?.message ?? errorBody?.message ?? "";
        failureMessage = normalizeText(message) || null;
      }
      return originalJson(body);
    }) as express.Response["json"];

    res.on("finish", () => {
      const routePath = normalizeText(req.route?.path) || req.path || "unknown";
      const metric = ensureRouteMetric(`${req.method} ${routePath}`);
      const latency = Math.max(0, Date.now() - startedAt);
      metric.requests += 1;
      metric.lastStatus = res.statusCode;
      metric.lastLatencyMs = latency;
      metric.avgLatencyMs = Number(
        ((metric.avgLatencyMs * (metric.requests - 1)) + latency) / Math.max(1, metric.requests)
      );
      if (res.statusCode >= 400) {
        metric.failed += 1;
        metric.lastFailureAt = new Date().toISOString();
        metric.lastFailureMessage = failureMessage;
      } else {
        metric.success += 1;
      }
    });

    next();
  });

  async function ensureSchemaReady(res: express.Response) {
    const status = await getKnowledgeV2SchemaStatus();
    if (status.ready) {
      return true;
    }
    sendError(res, 503, "SERVICE_UNAVAILABLE", `knowledge schema not ready: ${status.reason || "unknown"}`);
    return false;
  }

  router.get("/status", asyncRoute(async (req, res) => {
    const forceRefresh = parseBoolean(req.query.forceRefresh ?? req.query.refresh, false);
    const scope = normalizeOptionalScope(req.query.scope);
    const projectId = normalizeText(req.query.projectId) || undefined;
    const agentId = normalizeText(req.query.agentId) || undefined;
    const stageContext = normalizeText(req.query.stageContext) || normalizeText(req.query.stage) || undefined;
    const query = normalizeText(req.query.query) || undefined;
    const schema = await getKnowledgeV2SchemaStatus(forceRefresh);

    const baseFilters = {
      scope,
      projectId,
      agentId,
      stageContext,
      query
    } as const;

    let total = 0;
    let byScope: Record<KnowledgeScope, number> = {
      global: 0,
      project: 0,
      agent: 0,
      template: 0
    };
    let byType: Record<"document" | "text" | "url" | "code" | "sop", number> = {
      document: 0,
      text: 0,
      url: 0,
      code: 0,
      sop: 0
    };
    let byMemoryType: Record<"episodic" | "semantic" | "procedural", number> = {
      episodic: 0,
      semantic: 0,
      procedural: 0
    };

    if (schema.ready) {
      const [totalCount, typeCounts, memoryTypeCounts] = await Promise.all([
        countKnowledgeItems(baseFilters),
        Promise.all([
          countKnowledgeItems({ ...baseFilters, type: "document" }),
          countKnowledgeItems({ ...baseFilters, type: "text" }),
          countKnowledgeItems({ ...baseFilters, type: "url" }),
          countKnowledgeItems({ ...baseFilters, type: "code" }),
          countKnowledgeItems({ ...baseFilters, type: "sop" })
        ]),
        Promise.all([
          countKnowledgeItems({ ...baseFilters, memoryType: "episodic" }),
          countKnowledgeItems({ ...baseFilters, memoryType: "semantic" }),
          countKnowledgeItems({ ...baseFilters, memoryType: "procedural" })
        ])
      ]);
      total = totalCount;
      byType = {
        document: typeCounts[0],
        text: typeCounts[1],
        url: typeCounts[2],
        code: typeCounts[3],
        sop: typeCounts[4]
      };
      byMemoryType = {
        episodic: memoryTypeCounts[0],
        semantic: memoryTypeCounts[1],
        procedural: memoryTypeCounts[2]
      };
      if (scope) {
        byScope[scope] = totalCount;
      } else {
        const scopeCounts = await Promise.all([
          countKnowledgeItems({ ...baseFilters, scope: "global" }),
          countKnowledgeItems({ ...baseFilters, scope: "project" }),
          countKnowledgeItems({ ...baseFilters, scope: "agent" }),
          countKnowledgeItems({ ...baseFilters, scope: "template" })
        ]);
        byScope = {
          global: scopeCounts[0],
          project: scopeCounts[1],
          agent: scopeCounts[2],
          template: scopeCounts[3]
        };
      }
    }

    let recentOperations: Array<{
      id: string;
      operationType: string;
      summary: string;
      canRollback: boolean;
      rolledBackAt: string | null;
      triggeredBy: string | null;
      createdAt: string;
    }> = [];
    let rollbackableCount = 0;
    let operationLogReady = !(schema.missingOptionalTables ?? []).includes("KnowledgeOperationLog");
    let operationLogReason: string | null = null;
    if (operationLogReady) {
      try {
        const [recentLogs, rollbackable] = await Promise.all([
          prisma.knowledgeOperationLog.findMany({
            where: {
              projectId,
              agentId
            },
            orderBy: { createdAt: "desc" },
            take: 6
          }),
          prisma.knowledgeOperationLog.count({
            where: {
              projectId,
              agentId,
              canRollback: true,
              rolledBackAt: null
            }
          })
        ]);
        recentOperations = recentLogs.map((log) => ({
          id: log.id,
          operationType: log.operationType,
          summary: log.summary,
          canRollback: log.canRollback,
          rolledBackAt: log.rolledBackAt ? log.rolledBackAt.toISOString() : null,
          triggeredBy: log.triggeredBy ?? null,
          createdAt: log.createdAt.toISOString()
        }));
        rollbackableCount = rollbackable;
      } catch (error) {
        if (isMissingTableError(error)) {
          operationLogReady = false;
          operationLogReason = "KnowledgeOperationLog table missing";
        } else {
          throw error;
        }
      }
    } else {
      operationLogReason = "KnowledgeOperationLog is optional and currently missing";
    }

    const routeMetrics = [...KNOWLEDGE_ROUTE_METRICS.values()]
      .map((metric) => ({
        ...metric,
        errorRate: metric.requests > 0 ? Number((metric.failed / metric.requests).toFixed(4)) : 0
      }))
      .sort((a, b) => {
        if (b.failed !== a.failed) {
          return b.failed - a.failed;
        }
        return b.requests - a.requests;
      });

    sendSuccess(res, {
      checkedAt: new Date().toISOString(),
      schema,
      filters: {
        scope: scope ?? null,
        projectId: projectId ?? null,
        agentId: agentId ?? null,
        stageContext: stageContext ?? null,
        query: query ?? null
      },
      inventory: {
        total,
        byScope,
        byType,
        byMemoryType
      },
      operations: {
        ready: operationLogReady,
        reason: operationLogReason,
        rollbackableCount,
        recent: recentOperations
      },
      routes: {
        totalTracked: routeMetrics.length,
        topFailing: routeMetrics.slice(0, 10)
      }
    });
  }));

  router.post("/upload", upload.single("file"), validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    if (!(await ensureSchemaReady(res))) {
      return;
    }
    const payload = (req.body ?? {}) as UploadKnowledgeBody;

    let fileName = normalizeText(payload.fileName) || "uploaded-document.txt";
    let fileContent = String(payload.fileContent ?? "");
    const uploadedFile = req.file;
    if (uploadedFile) {
      fileName = normalizeText(uploadedFile.originalname) || fileName;
      try {
        fileContent = await extractTextFromUploadedFile(uploadedFile);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendError(res, 400, "VALIDATION_ERROR", `file parse failed: ${message}`);
        return;
      }
    }

    if (!fileContent.trim()) {
      sendError(res, 400, "VALIDATION_ERROR", "fileContent is required");
      return;
    }

    const scope = normalizeScope(payload.scope);
    const projectId = normalizeText(payload.projectId) || undefined;
    const agentId = normalizeText(payload.agentId) || undefined;
    const scopeError = validateScopeBinding({ scope, projectId, agentId });
    if (scopeError) {
      sendError(res, 400, "VALIDATION_ERROR", scopeError);
      return;
    }

    const items = await ingestDocumentText({
      fileName,
      fileContent,
      scope,
      projectId,
      agentId,
      tags: parseFlexibleStringArray(payload.tags),
      triggeredBy: normalizeText(payload.triggeredBy) || undefined
    });
    if (KNOWLEDGE_AUTO_ORGANIZE_ON_INGEST) {
      void autoOrganizeKnowledge({
        projectId: normalizeText(payload.projectId) || undefined,
        agentId: normalizeText(payload.agentId) || undefined,
        limit: 200
      });
    }
    sendSuccess(res, {
      count: items.length,
      items: items.map((item) => ({ id: item.id, title: item.title }))
    });
  }));

  router.post("/text", validateBody(KnowledgeCreateSchema), asyncRoute(async (req, res) => {
    if (!(await ensureSchemaReady(res))) {
      return;
    }
    const payload = (req.body ?? {}) as CreateTextKnowledgeBody;
    const title = normalizeText(payload.title);
    const content = String(payload.content ?? "");
    if (!title || !content.trim()) {
      sendError(res, 400, "VALIDATION_ERROR", "title and content are required");
      return;
    }
    const scope = normalizeScope(payload.scope);
    const projectId = normalizeText(payload.projectId) || undefined;
    const agentId = normalizeText(payload.agentId) || undefined;
    const scopeError = validateScopeBinding({ scope, projectId, agentId });
    if (scopeError) {
      sendError(res, 400, "VALIDATION_ERROR", scopeError);
      return;
    }

    const item = await ingestTextAsKnowledge({
      title,
      content,
      scope,
      projectId,
      agentId,
      tags: asStringArray(payload.tags),
      importanceScore: payload.importanceScore === undefined
        ? undefined
        : Number(payload.importanceScore),
      triggeredBy: normalizeText(payload.triggeredBy) || undefined
    });
    if (KNOWLEDGE_AUTO_ORGANIZE_ON_INGEST) {
      void autoOrganizeKnowledge({
        projectId: normalizeText(payload.projectId) || undefined,
        agentId: normalizeText(payload.agentId) || undefined,
        limit: 120
      });
    }
    sendSuccess(res, { id: item.id }, 201);
  }));

  router.post("/sync-from-hermes", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    if (!(await ensureSchemaReady(res))) {
      return;
    }
    if (!validateHermesApiKey(req, res)) {
      return;
    }
    const payload = (req.body ?? {}) as HermesMemorySyncBody;
    const title = normalizeText(payload.title);
    const content = String(payload.content ?? "");
    if (!title || !content.trim()) {
      sendError(res, 400, "VALIDATION_ERROR", "title and content are required");
      return;
    }

    const projectId = normalizeText(payload.projectId) || undefined;
    const scope = projectId ? "project" : normalizeScope(payload.scope);
    const agentId = normalizeText(payload.agentId) || undefined;
    const scopeError = validateScopeBinding({ scope, projectId, agentId });
    if (scopeError) {
      sendError(res, 400, "VALIDATION_ERROR", scopeError);
      return;
    }
    const memoryType = normalizeMemoryType(payload.memoryType) || "semantic";
    const importanceScore = Number(payload.importanceScore ?? 0.5);
    const clampedImportance = Number.isFinite(importanceScore)
      ? Math.max(0, Math.min(1, importanceScore))
      : 0.5;

    const item = await ingestKnowledgeItem({
      scope,
      projectId,
      agentId,
      type: "text",
      title,
      content,
      tags: asStringArray(payload.tags),
      stageContext: asStringArray(payload.stageContext),
      techStack: asStringArray(payload.techStack),
      memoryType,
      importanceScore: clampedImportance,
      metadata: {
        source: "hermes",
        syncedAt: new Date().toISOString()
      }
    });
    if (KNOWLEDGE_AUTO_ORGANIZE_ON_INGEST) {
      void autoOrganizeKnowledge({
        projectId,
        agentId: normalizeText(payload.agentId) || undefined,
        limit: 120
      });
    }
    sendSuccess(res, { id: item.id }, 201);
  }));

  router.post("/search", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    if (!(await ensureSchemaReady(res))) {
      return;
    }
    const payload = (req.body ?? {}) as SearchKnowledgeBody;
    const query = normalizeText(payload.query);
    if (!query) {
      sendError(res, 400, "VALIDATION_ERROR", "query is required");
      return;
    }
    const results = await retrieveKnowledgeForContext({
      query,
      context: {
        projectId: normalizeText(payload.projectId) || undefined,
        currentStage: normalizeText(payload.stage) || undefined,
        agentId: normalizeText(payload.agentId) || undefined,
        techStack: asStringArray(payload.techStack)
      },
      topK: Number(payload.limit ?? 5)
    });
    sendSuccess(res, {
      results: results.map((item) => ({
        id: item.id,
        title: item.title,
        content: item.content.slice(0, 500),
        similarity: item.similarity,
        type: item.memoryType
      }))
    });
  }));

  router.post("/context", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    if (!(await ensureSchemaReady(res))) {
      return;
    }
    const payload = (req.body ?? {}) as {
      projectId?: unknown;
      currentStage?: unknown;
      agentId?: unknown;
      userQuery?: unknown;
    };
    const projectId = normalizeText(payload.projectId);
    const currentStage = normalizeText(payload.currentStage);
    const userQuery = normalizeText(payload.userQuery);
    if (!projectId || !currentStage || !userQuery) {
      sendError(res, 400, "VALIDATION_ERROR", "projectId, currentStage and userQuery are required");
      return;
    }
    const context = await buildAgentContext({
      projectId,
      currentStage,
      agentId: normalizeText(payload.agentId) || undefined,
      userQuery
    });
    sendSuccess(res, { context });
  }));

  router.get("/project/:projectId/summary", asyncRoute(async (req, res) => {
    if (!(await ensureSchemaReady(res))) {
      return;
    }
    const projectId = normalizeText(req.params.projectId);
    if (!projectId) {
      sendError(res, 400, "VALIDATION_ERROR", "projectId is required");
      return;
    }
    const summary = await getProjectMemorySummary(projectId);
    sendSuccess(res, { summary });
  }));

  router.get("/for-hermes", asyncRoute(async (req, res) => {
    if (!(await ensureSchemaReady(res))) {
      return;
    }
    if (!validateHermesApiKey(req, res)) {
      return;
    }
    const projectId = normalizeText(req.query.projectId);

    const limit = parsePositiveInt(req.query.limit, 20, 200);
    const episodicLimit = Math.max(1, Math.floor(limit / 2));
    const semanticLimit = Math.max(1, limit - episodicLimit);
    const [episodic, semantic] = await Promise.all([
      listKnowledgeItems({
        scope: projectId ? "project" : undefined,
        projectId: projectId || undefined,
        memoryType: "episodic",
        limit: episodicLimit
      }),
      listKnowledgeItems({
        scope: projectId ? "project" : undefined,
        projectId: projectId || undefined,
        memoryType: "semantic",
        limit: semanticLimit
      })
    ]);
    const merged = [...episodic, ...semantic]
      .sort((a, b) => {
        const scoreA = Number(a.importanceScore ?? 0);
        const scoreB = Number(b.importanceScore ?? 0);
        if (scoreA !== scoreB) {
          return scoreB - scoreA;
        }
        return b.createdAt.getTime() - a.createdAt.getTime();
      })
      .slice(0, limit);

    sendSuccess(res, {
      items: merged.map((item) => ({
        id: item.id,
        projectId: item.projectId,
        title: item.title,
        content: item.content,
        memoryType: item.memoryType,
        importanceScore: item.importanceScore,
        tags: asStringArray(item.tags),
        stageContext: asStringArray(item.stageContext),
        techStack: asStringArray(item.techStack)
      }))
    });
  }));

  router.get("/", asyncRoute(async (req, res) => {
    if (!(await ensureSchemaReady(res))) {
      return;
    }
    const limit = parsePositiveInt(req.query.limit, 20, 200);
    const offset = Math.max(0, Math.floor(Number(req.query.offset ?? 0) || 0));
    const type = normalizeKnowledgeType(req.query.type);
    const memoryType = normalizeMemoryType(req.query.memoryType);
    const stageContext = normalizeText(req.query.stageContext) || normalizeText(req.query.stage) || undefined;
    const scope = normalizeOptionalScope(req.query.scope);
    const projectId = normalizeText(req.query.projectId) || undefined;
    const agentId = normalizeText(req.query.agentId) || undefined;
    const searchQuery = normalizeText(req.query.search) || normalizeText(req.query.query) || undefined;
    const [items, total] = await Promise.all([
      listKnowledgeItems({
        scope,
        projectId,
        agentId,
        type,
        memoryType,
        stageContext,
        query: searchQuery,
        limit,
        offset
      }),
      countKnowledgeItems({
        scope,
        projectId,
        agentId,
        type,
        memoryType,
        stageContext,
        query: searchQuery
      })
    ]);
    sendSuccess(res, {
      total,
      items: items.map((item) => ({
        ...resolveKnowledgeSourceMeta(item.metadata),
        id: item.id,
        scope: item.scope,
        projectId: item.projectId,
        agentId: item.agentId,
        type: item.type,
        title: item.title,
        tags: asStringArray(item.tags),
        stageContext: asStringArray(item.stageContext),
        techStack: asStringArray(item.techStack),
        memoryType: item.memoryType,
        importanceScore: item.importanceScore,
        accessCount: item.accessCount,
        createdAt: item.createdAt
      }))
    });
  }));

  router.post("/bulk-delete", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    if (!(await ensureSchemaReady(res))) {
      return;
    }
    const payload = (req.body ?? {}) as BulkDeleteBody;
    const ids = asStringArray(payload.ids);
    if (ids.length === 0) {
      sendError(res, 400, "VALIDATION_ERROR", "ids is required");
      return;
    }
    const result = await bulkDeleteKnowledgeItems(ids, {
      triggeredBy: normalizeText(payload.triggeredBy) || undefined
    });
    sendSuccess(res, result);
  }));

  router.post("/curation/preview", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    if (!(await ensureSchemaReady(res))) {
      return;
    }
    const payload = (req.body ?? {}) as CurationBody;
    const preview = await previewKnowledgeCuration({
      scope: normalizeOptionalScope(payload.scope),
      projectId: normalizeText(payload.projectId) || undefined,
      agentId: normalizeText(payload.agentId) || undefined,
      limit: parsePositiveInt(payload.limit, 200, 500)
    });
    sendSuccess(res, preview);
  }));

  router.post("/curation/apply", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    if (!(await ensureSchemaReady(res))) {
      return;
    }
    const payload = (req.body ?? {}) as CurationBody;
    const result = await applyKnowledgeCuration({
      scope: normalizeOptionalScope(payload.scope),
      projectId: normalizeText(payload.projectId) || undefined,
      agentId: normalizeText(payload.agentId) || undefined,
      limit: parsePositiveInt(payload.limit, 200, 500),
      normalizeFields: parseBoolean(payload.normalizeFields, true),
      mergeDuplicates: parseBoolean(payload.mergeDuplicates, true),
      maxDuplicateGroups: parsePositiveInt(payload.maxDuplicateGroups, 20, 100),
      targetCanonicalIds: asStringArray(payload.targetCanonicalIds),
      triggeredBy: normalizeText(payload.triggeredBy) || undefined
    });
    sendSuccess(res, result);
  }));

  router.get("/history", asyncRoute(async (req, res) => {
    if (!(await ensureSchemaReady(res))) {
      return;
    }
    const logs = await listKnowledgeOperationLogs({
      operationType: normalizeText(req.query.operationType) || undefined,
      projectId: normalizeText(req.query.projectId) || undefined,
      agentId: normalizeText(req.query.agentId) || undefined,
      limit: parsePositiveInt(req.query.limit, 50, 200)
    });
    sendSuccess(res, { logs });
  }));

  router.post("/history/:operationId/rollback", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    if (!(await ensureSchemaReady(res))) {
      return;
    }
    const operationId = normalizeText(req.params.operationId);
    if (!operationId) {
      sendError(res, 400, "VALIDATION_ERROR", "operationId is required");
      return;
    }
    const payload = (req.body ?? {}) as { triggeredBy?: unknown };
    try {
      const result = await rollbackKnowledgeOperation({
        operationId,
        triggeredBy: normalizeText(payload.triggeredBy) || undefined
      });
      sendSuccess(res, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("history is not ready")) {
        sendError(res, 503, "SERVICE_UNAVAILABLE", message);
        return;
      }
      throw error;
    }
  }));

  router.get("/:knowledgeId", asyncRoute(async (req, res) => {
    if (!(await ensureSchemaReady(res))) {
      return;
    }
    const knowledgeId = normalizeText(req.params.knowledgeId);
    if (!knowledgeId) {
      sendError(res, 400, "VALIDATION_ERROR", "knowledgeId is required");
      return;
    }
    const item = await getKnowledgeItemById(knowledgeId);
    if (!item) {
      sendError(res, 404, "NOT_FOUND", `knowledge not found: ${knowledgeId}`);
      return;
    }
    sendSuccess(res, item);
  }));

  router.patch("/:knowledgeId", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    if (!(await ensureSchemaReady(res))) {
      return;
    }
    const knowledgeId = normalizeText(req.params.knowledgeId);
    if (!knowledgeId) {
      sendError(res, 400, "VALIDATION_ERROR", "knowledgeId is required");
      return;
    }
    const payload = (req.body ?? {}) as UpdateKnowledgeBody;
    const nextType = payload.type === undefined ? undefined : normalizeKnowledgeType(payload.type);
    if (payload.type !== undefined && !nextType) {
      sendError(res, 400, "VALIDATION_ERROR", "type must be document|text|url|code|sop");
      return;
    }
    const nextMemoryType = payload.memoryType === undefined ? undefined : normalizeMemoryType(payload.memoryType);
    if (payload.memoryType !== undefined && !nextMemoryType) {
      sendError(res, 400, "VALIDATION_ERROR", "memoryType must be episodic|semantic|procedural");
      return;
    }
    const existing = await getKnowledgeItemById(knowledgeId);
    if (!existing) {
      sendError(res, 404, "NOT_FOUND", `knowledge not found: ${knowledgeId}`);
      return;
    }

    const existingScope = normalizeOptionalScope(existing.scope) ?? "global";
    const nextScope: KnowledgeScope = normalizeOptionalScope(payload.scope) ?? existingScope;
    const nextProjectId = payload.projectId === undefined
      ? existing.projectId
      : (normalizeText(payload.projectId) || null);
    const nextAgentId = payload.agentId === undefined
      ? existing.agentId
      : (normalizeText(payload.agentId) || null);
    const scopeError = validateScopeBinding({
      scope: nextScope,
      projectId: nextProjectId,
      agentId: nextAgentId
    });
    if (scopeError) {
      sendError(res, 400, "VALIDATION_ERROR", scopeError);
      return;
    }

    const updated = await updateKnowledgeItemById(
      knowledgeId,
      {
        scope: nextScope,
        projectId: nextProjectId,
        agentId: nextAgentId,
        type: nextType,
        title: payload.title === undefined ? undefined : normalizeText(payload.title),
        content: payload.content === undefined ? undefined : String(payload.content ?? ""),
        metadata: payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
          ? payload.metadata as Record<string, unknown>
          : undefined,
        tags: payload.tags === undefined ? undefined : asStringArray(payload.tags),
        stageContext: payload.stageContext === undefined ? undefined : asStringArray(payload.stageContext),
        techStack: payload.techStack === undefined ? undefined : asStringArray(payload.techStack),
        memoryType: nextMemoryType,
        importanceScore: payload.importanceScore === undefined ? undefined : Number(payload.importanceScore),
        sourceUrl: payload.sourceUrl === undefined ? undefined : (normalizeText(payload.sourceUrl) || null),
        filePath: payload.filePath === undefined ? undefined : (normalizeText(payload.filePath) || null),
        fileType: payload.fileType === undefined ? undefined : (normalizeText(payload.fileType) || null)
      },
      {
        triggeredBy: normalizeText(payload.triggeredBy) || undefined
      }
    );
    if (!updated) {
      sendError(res, 404, "NOT_FOUND", `knowledge not found: ${knowledgeId}`);
      return;
    }
    sendSuccess(res, { id: updated.id, updatedAt: updated.updatedAt });
  }));

  router.delete("/:knowledgeId", asyncRoute(async (req, res) => {
    if (!(await ensureSchemaReady(res))) {
      return;
    }
    const knowledgeId = normalizeText(req.params.knowledgeId);
    if (!knowledgeId) {
      sendError(res, 400, "VALIDATION_ERROR", "knowledgeId is required");
      return;
    }
    const deleted = await deleteKnowledgeItemById(knowledgeId, {
      triggeredBy: normalizeText(req.query.triggeredBy) || undefined
    });
    if (!deleted) {
      sendError(res, 404, "NOT_FOUND", `knowledge not found: ${knowledgeId}`);
      return;
    }
    sendSuccess(res, { id: knowledgeId, deleted: true });
  }));

  return router;
}
