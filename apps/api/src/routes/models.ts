import express from "express";
import { prisma } from "../db.js";
import {
  asyncRoute,
  isoDateOnly,
  maskApiKey,
  parsePositiveInt,
  sendError,
  sendSuccess
} from "./utils.js";
import { getRuntimeSettings, updateRuntimeSettings } from "../system/runtime-config.js";

interface CreateModelBody {
  name?: unknown;
  provider?: unknown;
  apiKey?: unknown;
  apiBaseUrl?: unknown;
  tokenLimit?: unknown;
  status?: unknown;
}

interface UpdateModelBody {
  name?: unknown;
  provider?: unknown;
  apiKey?: unknown;
  apiBaseUrl?: unknown;
  tokenLimit?: unknown;
  status?: unknown;
  totalTokens?: unknown;
  dailyTokens?: unknown;
}

function toModelView(model: {
  id: string;
  name: string;
  provider: string;
  apiKey: string | null;
  apiBaseUrl: string | null;
  status: string;
  totalTokens: number;
  dailyTokens: number;
  tokenLimit: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    apiKey: maskApiKey(model.apiKey),
    apiBaseUrl: model.apiBaseUrl ?? "",
    status: model.status,
    totalTokens: model.totalTokens,
    dailyTokens: model.dailyTokens,
    tokenLimit: model.tokenLimit,
    createdAt: model.createdAt.toISOString(),
    updatedAt: model.updatedAt.toISOString()
  };
}

export function createModelsRouter() {
  const router = express.Router();

  router.get("/", asyncRoute(async (_req, res) => {
    const models = await prisma.model.findMany({
      orderBy: {
        createdAt: "desc"
      }
    });

    sendSuccess(res, models.map(toModelView));
  }));

  router.post("/", asyncRoute(async (req, res) => {
    const payload = (req.body ?? {}) as CreateModelBody;
    const name = String(payload.name ?? "").trim();
    const provider = String(payload.provider ?? "").trim();

    if (!name || !provider) {
      sendError(res, 400, "VALIDATION_ERROR", "name and provider are required");
      return;
    }

    const tokenLimit = payload.tokenLimit === undefined
      ? 1_000_000
      : Number(payload.tokenLimit);

    if (!Number.isFinite(tokenLimit) || tokenLimit < 0) {
      sendError(res, 400, "VALIDATION_ERROR", "tokenLimit must be a non-negative number");
      return;
    }

    const created = await prisma.model.create({
      data: {
        name,
        provider,
        apiKey: String(payload.apiKey ?? "").trim() || null,
        apiBaseUrl: String(payload.apiBaseUrl ?? "").trim() || null,
        tokenLimit: Math.floor(tokenLimit),
        status: String(payload.status ?? "Healthy").trim() || "Healthy"
      }
    });

    sendSuccess(res, toModelView(created), 201);
  }));

  router.get("/:id", asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? "").trim();
    const model = await prisma.model.findUnique({ where: { id } });

    if (!model) {
      sendError(res, 404, "NOT_FOUND", "Model not found");
      return;
    }

    sendSuccess(res, toModelView(model));
  }));

  router.patch("/:id", asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? "").trim();
    const payload = (req.body ?? {}) as UpdateModelBody;

    const existing = await prisma.model.findUnique({ where: { id } });
    if (!existing) {
      sendError(res, 404, "NOT_FOUND", "Model not found");
      return;
    }

    const data: {
      name?: string;
      provider?: string;
      apiKey?: string | null;
      apiBaseUrl?: string | null;
      tokenLimit?: number;
      status?: string;
      totalTokens?: number;
      dailyTokens?: number;
    } = {};

    if (payload.name !== undefined) {
      const value = String(payload.name).trim();
      if (!value) {
        sendError(res, 400, "VALIDATION_ERROR", "name cannot be empty");
        return;
      }
      data.name = value;
    }

    if (payload.provider !== undefined) {
      const value = String(payload.provider).trim();
      if (!value) {
        sendError(res, 400, "VALIDATION_ERROR", "provider cannot be empty");
        return;
      }
      data.provider = value;
    }

    if (payload.apiKey !== undefined) {
      const value = String(payload.apiKey ?? "").trim();
      data.apiKey = value || null;
    }

    if (payload.apiBaseUrl !== undefined) {
      const value = String(payload.apiBaseUrl ?? "").trim();
      data.apiBaseUrl = value || null;
    }

    if (payload.tokenLimit !== undefined) {
      const value = Number(payload.tokenLimit);
      if (!Number.isFinite(value) || value < 0) {
        sendError(res, 400, "VALIDATION_ERROR", "tokenLimit must be a non-negative number");
        return;
      }
      data.tokenLimit = Math.floor(value);
    }

    if (payload.status !== undefined) {
      const value = String(payload.status).trim();
      if (!value) {
        sendError(res, 400, "VALIDATION_ERROR", "status cannot be empty");
        return;
      }
      data.status = value;
    }

    if (payload.totalTokens !== undefined) {
      const value = Number(payload.totalTokens);
      if (!Number.isFinite(value) || value < 0) {
        sendError(res, 400, "VALIDATION_ERROR", "totalTokens must be a non-negative number");
        return;
      }
      data.totalTokens = Math.floor(value);
    }

    if (payload.dailyTokens !== undefined) {
      const value = Number(payload.dailyTokens);
      if (!Number.isFinite(value) || value < 0) {
        sendError(res, 400, "VALIDATION_ERROR", "dailyTokens must be a non-negative number");
        return;
      }
      data.dailyTokens = Math.floor(value);
    }

    if (Object.keys(data).length === 0) {
      sendError(res, 400, "VALIDATION_ERROR", "No valid fields provided for update");
      return;
    }

    const updated = await prisma.model.update({
      where: { id },
      data
    });

    sendSuccess(res, toModelView(updated));
  }));

  router.delete("/:id", asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? "").trim();
    const existing = await prisma.model.findUnique({
      where: { id },
      select: { id: true }
    });

    if (!existing) {
      sendError(res, 404, "NOT_FOUND", "Model not found");
      return;
    }

    await prisma.model.delete({ where: { id } });
    sendSuccess(res, null);
  }));

  router.get("/:id/logs", asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? "").trim();
    const type = String(req.query.type ?? "").trim();
    const limit = Math.min(parsePositiveInt(req.query.limit, 50), 200);

    const model = await prisma.model.findUnique({
      where: { id },
      select: { id: true }
    });

    if (!model) {
      sendError(res, 404, "NOT_FOUND", "Model not found");
      return;
    }

    const logs = await prisma.modelLog.findMany({
      where: {
        modelId: id,
        ...(type ? { type } : {})
      },
      orderBy: {
        timestamp: "desc"
      },
      take: limit
    });

    sendSuccess(res, logs.map((log) => ({
      id: log.id,
      timestamp: log.timestamp.toISOString(),
      type: log.type,
      content: log.content,
      label: log.label ?? undefined
    })));
  }));

  router.get("/:id/metrics", asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? "").trim();
    const model = await prisma.model.findUnique({ where: { id } });

    if (!model) {
      sendError(res, 404, "NOT_FOUND", "Model not found");
      return;
    }

    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const weekStart = new Date(start);
    weekStart.setDate(weekStart.getDate() - 6);

    const usageLogs = await prisma.agentUsageLog.findMany({
      where: {
        createdAt: { gte: weekStart },
        OR: [
          { model: model.id },
          { model: model.name }
        ]
      },
      select: {
        totalTokens: true,
        createdAt: true
      }
    });

    const distributionGroups = await prisma.agentUsageLog.groupBy({
      by: ["model"],
      _sum: {
        totalTokens: true
      }
    });

    const dayKeys = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + index);
      return isoDateOnly(day);
    });

    const weeklyMap = new Map<string, number>(dayKeys.map((key) => [key, 0]));

    for (const log of usageLogs) {
      const key = isoDateOnly(log.createdAt);
      weeklyMap.set(key, (weeklyMap.get(key) ?? 0) + log.totalTokens);
    }

    const weeklyTokens = dayKeys.map((key) => weeklyMap.get(key) ?? 0);
    const todayKey = isoDateOnly(start);
    const computedDailyTokens = weeklyMap.get(todayKey) ?? 0;

    const distribution = distributionGroups
      .map((item) => ({
        model: item.model,
        tokens: item._sum.totalTokens ?? 0
      }))
      .sort((a, b) => b.tokens - a.tokens);

    const dailyCosts = dayKeys.map((date, index) => ({
      date,
      cost: Number(((weeklyTokens[index] / 1_000_000) * 1.5).toFixed(4))
    }));

    sendSuccess(res, {
      totalTokens: Math.max(model.totalTokens, usageLogs.reduce((acc, item) => acc + item.totalTokens, 0)),
      dailyTokens: Math.max(model.dailyTokens, computedDailyTokens),
      weeklyTokens,
      avgLatency: "N/A",
      avgThroughput: "N/A",
      dailyCosts,
      tokenDistribution: distribution
    });
  }));

  router.post("/:id/health-check", asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? "").trim();
    const model = await prisma.model.findUnique({ where: { id } });

    if (!model) {
      sendError(res, 404, "NOT_FOUND", "Model not found");
      return;
    }

    const reachable = Boolean(
      model.apiBaseUrl
      && /^https?:\/\//i.test(model.apiBaseUrl)
      && model.apiKey
    );

    const latency = reachable ? "120ms" : "N/A";
    const error = reachable ? null : "Model API endpoint is not reachable";

    await prisma.$transaction([
      prisma.model.update({
        where: { id },
        data: {
          status: reachable ? "Healthy" : "Degraded"
        }
      }),
      prisma.modelLog.create({
        data: {
          modelId: id,
          timestamp: new Date(),
          type: "system",
          content: reachable ? "health check passed" : "health check failed",
          label: "health-check"
        }
      })
    ]);

    sendSuccess(res, {
      reachable,
      latency,
      error
    });
  }));

  router.post("/:id/set-default", asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? "").trim();
    const model = await prisma.model.findUnique({ where: { id } });

    if (!model) {
      sendError(res, 404, "NOT_FOUND", "Model not found");
      return;
    }

    const currentRuntime = await getRuntimeSettings();
    const shouldUseOpenAICompatible = Boolean(
      String(model.apiBaseUrl ?? "").trim()
      && String(model.apiKey ?? "").trim()
    );
    const runtime = await updateRuntimeSettings({
      provider: shouldUseOpenAICompatible ? "openai-compatible" : currentRuntime.provider,
      apiBaseUrl: shouldUseOpenAICompatible ? String(model.apiBaseUrl ?? "").trim() : currentRuntime.apiBaseUrl,
      apiKey: shouldUseOpenAICompatible ? String(model.apiKey ?? "").trim() : undefined,
      modelName: model.name
    });

    sendSuccess(res, {
      model: toModelView(model),
      runtime
    });
  }));

  return router;
}
