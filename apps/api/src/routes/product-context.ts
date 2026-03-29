import express from "express";
import { asyncRoute, sendError, sendSuccess } from "./utils.js";
import { getProductContext, updateProductContext } from "../system/v1-method-store.js";

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

  return router;
}
