import express from "express";
import { asyncRoute, sendError, sendSuccess } from "./utils.js";
import { getProductContext, removeRequirementBackfill, removeRequirementBackfills, updateProductContext } from "../system/v1-method-store.js";

interface UpdateContextBody {
  productName?: unknown;
  background?: unknown;
  mission?: unknown;
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

export function createProductContextRouter() {
  const router = express.Router();

  router.get("/", asyncRoute(async (_req, res) => {
    sendSuccess(res, await getProductContext());
  }));

  router.put("/", asyncRoute(async (req, res) => {
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
      goals: normalizeStringArray(payload.goals),
      principles: normalizeStringArray(payload.principles),
      constraints: normalizeStringArray(payload.constraints),
      forbiddenKeywords: normalizeStringArray(payload.forbiddenKeywords),
      requiredKeywords: normalizeStringArray(payload.requiredKeywords)
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
