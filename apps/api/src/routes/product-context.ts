/**
 * Agent 治理规范接口
 * 此模块为平台级单例，定义所有 Agent 的底层执行规则。
 * 项目差异化需求请勿通过此接口修改。
 * 详见 docs/AGENT-GOVERNANCE.md
 */
import { MutationPassthroughSchema } from "../validation/schemas.js";
import { validateBody } from "../validation/middleware.js";
import express from "express";
import { asyncRoute, sendError, sendSuccess } from "./utils.js";
import { getProductContext, removeRequirementBackfill, removeRequirementBackfills, updateProductContext } from "../system/v1-method-store.js";

interface UpdateContextBody {
  productName?: unknown;
  background?: unknown;
  mission?: unknown;
  executionEngines?: unknown;
  executionPriority?: unknown;
  gitlabGovernance?: unknown;
  hermesUpgradeLoop?: unknown;
  goals?: unknown;
  principles?: unknown;
  constraints?: unknown;
  forbiddenKeywords?: unknown;
  requiredKeywords?: unknown;
}

interface DeleteHistoryBatchBody {
  historyIds?: unknown;
}

function normalizeStringArray(input: unknown) {
  if (!Array.isArray(input)) {
    return [] as string[];
  }
  return input
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function normalizeOptionalStringArray(input: unknown) {
  if (input === undefined) {
    return undefined;
  }
  return normalizeStringArray(input);
}

export function createProductContextRouter() {
  const router = express.Router();

  const truncateText = (value: string, limit = 200) => {
    const normalized = String(value ?? "");
    if (normalized.length <= limit) {
      return normalized;
    }
    return `${normalized.slice(0, Math.max(0, limit))}...`;
  };

  const parsePage = (value: unknown, fallback: number) => {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return fallback;
    }
    return Math.max(1, Math.floor(num));
  };

  const parsePageSize = (value: unknown, fallback: number) => {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return fallback;
    }
    return Math.max(1, Math.min(100, Math.floor(num)));
  };

  router.get("/", asyncRoute(async (req, res) => {
    const context = await getProductContext();
    const summary = String(req.query.summary ?? "true").trim().toLowerCase() !== "false";
    const includeHistory = String(req.query.includeHistory ?? "false").trim().toLowerCase() !== "false";
    const page = parsePage(req.query.page, 1);
    const pageSize = parsePageSize(req.query.pageSize ?? req.query.limit, 20);
    const history = Array.isArray(context.requirementHistory) ? context.requirementHistory : [];
    const total = history.length;
    const offset = (page - 1) * pageSize;
    const pagedHistory = includeHistory ? history.slice(offset, offset + pageSize) : [];
    const normalizedHistory = summary
      ? pagedHistory.map((item) => ({
          ...item,
          title: truncateText(item.title, 200),
          refinedRequirement: truncateText(item.refinedRequirement, 200),
          validationNote: truncateText(item.validationNote ?? "", 200),
          implementationSummary: truncateText(item.implementationSummary ?? "", 200)
        }))
      : pagedHistory;

    sendSuccess(res, {
      ...context,
      background: summary ? truncateText(context.background, 200) : context.background,
      mission: summary ? truncateText(context.mission, 200) : context.mission,
      requirementHistory: normalizedHistory,
      requirementHistoryTotal: total,
      historyPage: page,
      historyPageSize: pageSize
    });
  }));

  router.get("/history", asyncRoute(async (req, res) => {
    const context = await getProductContext();
    const summary = String(req.query.summary ?? "true").trim().toLowerCase() !== "false";
    const page = parsePage(req.query.page, 1);
    const pageSize = parsePageSize(req.query.pageSize ?? req.query.limit, 20);
    const history = Array.isArray(context.requirementHistory) ? context.requirementHistory : [];
    const total = history.length;
    const offset = (page - 1) * pageSize;
    const items = history.slice(offset, offset + pageSize).map((item) => (
      summary
        ? {
            ...item,
            title: truncateText(item.title, 200),
            refinedRequirement: truncateText(item.refinedRequirement, 200),
            validationNote: truncateText(item.validationNote ?? "", 200),
            implementationSummary: truncateText(item.implementationSummary ?? "", 200)
          }
        : item
    ));

    sendSuccess(res, {
      total,
      page,
      pageSize,
      items
    });
  }));

  router.put("/", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    const payload = (req.body ?? {}) as UpdateContextBody;
    const productName = String(payload.productName ?? "").trim();

    if (!productName) {
      sendError(res, 400, "VALIDATION_ERROR", "productName is required");
      return;
    }

    const updated = await updateProductContext({
      productName,
      background: String(payload.background ?? "").trim(),
      mission: String(payload.mission ?? "").trim(),
      executionEngines: normalizeOptionalStringArray(payload.executionEngines),
      executionPriority: normalizeOptionalStringArray(payload.executionPriority),
      gitlabGovernance: normalizeOptionalStringArray(payload.gitlabGovernance),
      hermesUpgradeLoop: normalizeOptionalStringArray(payload.hermesUpgradeLoop),
      goals: normalizeOptionalStringArray(payload.goals),
      principles: normalizeOptionalStringArray(payload.principles),
      constraints: normalizeOptionalStringArray(payload.constraints),
      forbiddenKeywords: normalizeOptionalStringArray(payload.forbiddenKeywords),
      requiredKeywords: normalizeOptionalStringArray(payload.requiredKeywords)
    });

    sendSuccess(res, updated);
  }));

  router.delete("/history/:historyId", asyncRoute(async (req, res) => {
    const historyId = String(req.params.historyId ?? "").trim();
    if (!historyId) {
      sendError(res, 400, "VALIDATION_ERROR", "historyId is required");
      return;
    }

    const result = await removeRequirementBackfill(historyId);
    if (!result.removed) {
      sendError(res, 404, "NOT_FOUND", `History not found: ${historyId}`);
      return;
    }

    sendSuccess(res, { removed: true, historyId: result.historyId ?? historyId });
  }));

  router.delete("/history", asyncRoute(async (req, res) => {
    const payload = (req.body ?? {}) as DeleteHistoryBatchBody;
    const historyIds = Array.isArray(payload.historyIds)
      ? payload.historyIds.map((item) => String(item ?? "").trim()).filter(Boolean)
      : [];

    if (historyIds.length === 0) {
      sendError(res, 400, "VALIDATION_ERROR", "historyIds is required");
      return;
    }

    const result = await removeRequirementBackfills(historyIds);
    sendSuccess(res, result);
  }));

  return router;
}
