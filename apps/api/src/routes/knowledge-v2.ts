import express from "express";
import {
  applyKnowledgeCuration,
  buildAgentContext,
  bulkDeleteKnowledgeItems,
  deleteKnowledgeItemById,
  getKnowledgeItemById,
  getProjectMemorySummary,
  ingestDocumentText,
  ingestTextAsKnowledge,
  listKnowledgeItems,
  listKnowledgeOperationLogs,
  previewKnowledgeCuration,
  retrieveKnowledgeForContext,
  rollbackKnowledgeOperation,
  updateKnowledgeItemById
} from "../workflow-v2/knowledge-service.js";
import { getWorkflowV2SchemaStatus } from "../workflow-v2/schema-ready.js";
import { asyncRoute, sendError, sendSuccess } from "./utils.js";
import { asStringArray, normalizeText, type KnowledgeScope } from "../workflow-v2/types.js";

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

export function createKnowledgeV2Router() {
  const router = express.Router();

  async function ensureSchemaReady(res: express.Response) {
    const status = await getWorkflowV2SchemaStatus();
    if (status.ready) {
      return true;
    }
    sendError(res, 503, "SERVICE_UNAVAILABLE", `knowledge schema not ready: ${status.reason || "unknown"}`);
    return false;
  }

  router.post("/upload", asyncRoute(async (req, res) => {
    if (!(await ensureSchemaReady(res))) {
      return;
    }
    const payload = (req.body ?? {}) as UploadKnowledgeBody;
    const fileName = normalizeText(payload.fileName) || "uploaded-document.txt";
    const fileContent = String(payload.fileContent ?? "");
    if (!fileContent.trim()) {
      sendError(res, 400, "VALIDATION_ERROR", "fileContent is required");
      return;
    }

    const items = await ingestDocumentText({
      fileName,
      fileContent,
      scope: normalizeScope(payload.scope),
      projectId: normalizeText(payload.projectId) || undefined,
      agentId: normalizeText(payload.agentId) || undefined,
      tags: asStringArray(payload.tags),
      triggeredBy: normalizeText(payload.triggeredBy) || undefined
    });
    sendSuccess(res, {
      count: items.length,
      items: items.map((item) => ({ id: item.id, title: item.title }))
    });
  }));

  router.post("/text", asyncRoute(async (req, res) => {
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
    const item = await ingestTextAsKnowledge({
      title,
      content,
      scope: normalizeScope(payload.scope),
      projectId: normalizeText(payload.projectId) || undefined,
      agentId: normalizeText(payload.agentId) || undefined,
      tags: asStringArray(payload.tags),
      importanceScore: Number(payload.importanceScore ?? 0.5)
    });
    sendSuccess(res, { id: item.id }, 201);
  }));

  router.post("/search", asyncRoute(async (req, res) => {
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

  router.post("/context", asyncRoute(async (req, res) => {
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

  router.get("/", asyncRoute(async (req, res) => {
    if (!(await ensureSchemaReady(res))) {
      return;
    }
    const limit = parsePositiveInt(req.query.limit, 20, 200);
    const offset = Math.max(0, Math.floor(Number(req.query.offset ?? 0) || 0));
    const type = normalizeKnowledgeType(req.query.type);
    const memoryType = normalizeMemoryType(req.query.memoryType);
    const stageContext = normalizeText(req.query.stageContext) || normalizeText(req.query.stage) || undefined;
    const items = await listKnowledgeItems({
      scope: normalizeOptionalScope(req.query.scope),
      projectId: normalizeText(req.query.projectId) || undefined,
      agentId: normalizeText(req.query.agentId) || undefined,
      type,
      memoryType,
      stageContext,
      query: normalizeText(req.query.query) || undefined,
      limit,
      offset
    });
    sendSuccess(res, {
      total: items.length,
      items: items.map((item) => ({
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

  router.post("/bulk-delete", asyncRoute(async (req, res) => {
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

  router.post("/curation/preview", asyncRoute(async (req, res) => {
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

  router.post("/curation/apply", asyncRoute(async (req, res) => {
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

  router.post("/history/:operationId/rollback", asyncRoute(async (req, res) => {
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

  router.patch("/:knowledgeId", asyncRoute(async (req, res) => {
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
    const updated = await updateKnowledgeItemById(knowledgeId, {
      scope: normalizeOptionalScope(payload.scope),
      projectId: payload.projectId === undefined ? undefined : (normalizeText(payload.projectId) || null),
      agentId: payload.agentId === undefined ? undefined : (normalizeText(payload.agentId) || null),
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
    });
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
