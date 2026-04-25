import express from "express";
import { MutationPassthroughSchema } from "../validation/schemas.js";
import { validateBody } from "../validation/middleware.js";
import { prisma } from "../db.js";
import {
  asyncRoute,
  isoDateOnly,
  maskApiKey,
  parsePositiveInt,
  sendError,
  sendSuccess
} from "./utils.js";
import { ensureSystemConfig, getRuntimeSettings, updateRuntimeSettings } from "../system/runtime-config.js";
import { decryptSecret } from "../security/secret-store.js";
import { buildOpenAiCompatibleHeaders } from "../utils/openai-compatible-headers.js";

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

interface DiscoverModelsBody {
  provider?: unknown;
  apiBaseUrl?: unknown;
  apiKey?: unknown;
}

type MetricsSource = "usage_logs" | "model_counter" | "unknown";
type MetricsQuality = "measured" | "estimated" | "unknown";

function buildUsageLogMatcher(modelId: string, modelName: string) {
  return {
    OR: [
      { model: modelId },
      { model: modelName }
    ]
  };
}

function formatLatency(avgLatencyMs: number | null) {
  if (avgLatencyMs === null || !Number.isFinite(avgLatencyMs)) {
    return "unknown";
  }
  return `${Math.round(avgLatencyMs)}ms`;
}

function formatThroughput(tokensPerSecond: number | null) {
  if (tokensPerSecond === null || !Number.isFinite(tokensPerSecond) || tokensPerSecond <= 0) {
    return "unknown";
  }
  return `${tokensPerSecond.toFixed(2)} t/s`;
}

function inferMetricsQuality(input: {
  usageLogCount: number;
  executionCount: number;
  tokenSource: MetricsSource;
}): MetricsQuality {
  if (input.tokenSource === "unknown" && input.executionCount === 0) {
    return "unknown";
  }
  return "estimated";
}

function normalizeApiBaseUrl(value: string) {
  return String(value || "").trim().replace(/\/$/, "");
}

function normalizeProbeModelName(name: string) {
  const normalized = String(name ?? "").trim();
  if (normalized.startsWith("openai/")) {
    return normalized.slice("openai/".length);
  }
  return normalized;
}

function requiresStreamProbe(model: string) {
  const normalized = String(model ?? "").trim().toLowerCase();
  return normalized.startsWith("openai/gpt-5.4")
    || normalized.startsWith("gpt-5.4")
    || normalized.startsWith("openai/gpt-5.3-codex")
    || normalized.startsWith("gpt-5.3-codex");
}

async function readProbeError(response: Response) {
  const raw = await response.text();
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string };
      message?: string;
    };
    return String(parsed.error?.message ?? parsed.message ?? raw).trim();
  } catch {
    return String(raw).trim();
  }
}

async function probeOpenAICompatibleHealth(input: {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
}) {
  const endpoint = `${normalizeApiBaseUrl(input.apiBaseUrl)}/chat/completions`;
  const request = async (stream: boolean) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const startedAt = Date.now();
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: buildOpenAiCompatibleHeaders({
          apiBaseUrl: input.apiBaseUrl,
          apiKey: input.apiKey,
          json: true
        }),
        body: JSON.stringify({
          model: normalizeProbeModelName(input.model),
          temperature: 0,
          max_tokens: 16,
          stream,
          messages: [{ role: "user", content: "Reply with OK only." }]
        })
      });
      return {
        ok: response.ok,
        response,
        latencyMs: Date.now() - startedAt
      };
    } finally {
      clearTimeout(timeout);
    }
  };

  try {
    let stream = requiresStreamProbe(input.model);
    let result = await request(stream);
    if (!result.ok) {
      const message = await readProbeError(result.response);
      if (!stream && /stream must be set to true/i.test(message)) {
        stream = true;
        result = await request(stream);
      } else if (stream && /stream/i.test(message)) {
        stream = false;
        result = await request(stream);
      } else {
        return {
          reachable: false,
          latencyMs: result.latencyMs,
          error: message || `upstream status ${result.response.status}`
        };
      }
    }

    if (!result.ok) {
      return {
        reachable: false,
        latencyMs: result.latencyMs,
        error: await readProbeError(result.response)
      };
    }

    return {
      reachable: true,
      latencyMs: result.latencyMs,
      error: null as string | null
    };
  } catch (error) {
    return {
      reachable: false,
      latencyMs: null as number | null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function buildModelsUrl(apiBaseUrl: string) {
  return `${normalizeApiBaseUrl(apiBaseUrl)}/models`;
}

function parseDiscoveredModelNames(payload: unknown): string[] {
  const candidates: unknown[] = [];
  if (Array.isArray(payload)) {
    candidates.push(...payload);
  } else if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.data)) {
      candidates.push(...record.data);
    }
    if (Array.isArray(record.models)) {
      candidates.push(...record.models);
    }
    if (record.result && typeof record.result === "object") {
      const nested = record.result as Record<string, unknown>;
      if (Array.isArray(nested.data)) {
        candidates.push(...nested.data);
      }
      if (Array.isArray(nested.models)) {
        candidates.push(...nested.models);
      }
    }
  }

  const names = candidates.map((item) => {
    if (typeof item === "string") {
      return item.trim();
    }
    if (item && typeof item === "object") {
      const entry = item as Record<string, unknown>;
      return String(entry.id ?? entry.name ?? "").trim();
    }
    return "";
  }).filter(Boolean);

  return [...new Set(names)];
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
  const hasTokenCounter = model.totalTokens > 0 || model.dailyTokens > 0;
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
    tokenSource: hasTokenCounter ? "model_counter" : "unknown",
    telemetryQuality: hasTokenCounter ? "estimated" : "unknown",
    costMode: hasTokenCounter ? "estimated" : "unknown",
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

  router.post("/", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
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

  router.post("/discover", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    const payload = (req.body ?? {}) as DiscoverModelsBody;
    const systemConfig = await ensureSystemConfig();
    const runtimeApiKey = await decryptSecret(systemConfig.apiKey);

    const provider = String(payload.provider ?? systemConfig.provider ?? "").trim() || "openai-compatible";
    const apiBaseUrl = normalizeApiBaseUrl(String(payload.apiBaseUrl ?? systemConfig.apiBaseUrl ?? ""));
    const apiKey = String(payload.apiKey ?? runtimeApiKey ?? "").trim();

    if (provider !== "openai-compatible") {
      sendError(res, 400, "VALIDATION_ERROR", "discover currently supports openai-compatible provider only");
      return;
    }
    if (!/^https?:\/\//i.test(apiBaseUrl)) {
      sendError(res, 400, "VALIDATION_ERROR", "apiBaseUrl is required and must start with http(s)://");
      return;
    }
    if (!apiKey) {
      sendError(res, 400, "VALIDATION_ERROR", "apiKey is required (or configure runtime api key first)");
      return;
    }

    const response = await fetch(buildModelsUrl(apiBaseUrl), {
      method: "GET",
      headers: buildOpenAiCompatibleHeaders({
        apiBaseUrl,
        apiKey
      })
    });

    if (!response.ok) {
      sendError(res, 502, "SERVICE_UNAVAILABLE", `discover failed: upstream status ${response.status}`);
      return;
    }

    const discoveredPayload = await response.json().catch(() => null);
    const discoveredNames = parseDiscoveredModelNames(discoveredPayload);
    if (discoveredNames.length === 0) {
      sendSuccess(res, {
        provider,
        apiBaseUrl,
        discovered: 0,
        synced: 0,
        models: []
      });
      return;
    }

    let synced = 0;
    const syncedModels = [];
    for (const name of discoveredNames) {
      const existing = await prisma.model.findFirst({
        where: {
          name,
          provider,
          apiBaseUrl
        }
      });

      if (existing) {
        const updated = await prisma.model.update({
          where: { id: existing.id },
          data: {
            apiKey,
            status: existing.status === "Offline" ? "Degraded" : existing.status
          }
        });
        synced += 1;
        syncedModels.push(toModelView(updated));
        continue;
      }

      const created = await prisma.model.create({
        data: {
          name,
          provider,
          apiBaseUrl,
          apiKey,
          status: "Healthy",
          tokenLimit: 1_000_000
        }
      });
      synced += 1;
      syncedModels.push(toModelView(created));
    }

    sendSuccess(res, {
      provider,
      apiBaseUrl,
      discovered: discoveredNames.length,
      synced,
      models: syncedModels
    });
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

  router.patch("/:id", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
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

    const usageLogMatcher = buildUsageLogMatcher(model.id, model.name);

    const [usageLogs, usageAggregate, distributionGroups, executionRows] = await Promise.all([
      prisma.agentUsageLog.findMany({
        where: {
          createdAt: { gte: weekStart },
          ...usageLogMatcher
        },
        select: {
          totalTokens: true,
          createdAt: true
        }
      }),
      prisma.agentUsageLog.aggregate({
        where: usageLogMatcher,
        _sum: {
          totalTokens: true
        }
      }),
      prisma.agentUsageLog.groupBy({
        by: ["model"],
        _sum: {
          totalTokens: true
        }
      }),
      prisma.projectExecution.findMany({
        where: {
          createdAt: { gte: weekStart },
          status: "success",
          latencyMs: { not: null },
          OR: [
            { model: model.id },
            { model: model.name }
          ]
        },
        select: {
          latencyMs: true
        }
      })
    ]);

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
    const usageTotalTokens = usageAggregate._sum.totalTokens ?? 0;

    const distribution = distributionGroups
      .map((item) => ({
        model: item.model,
        tokens: item._sum.totalTokens ?? 0
      }))
      .sort((a, b) => b.tokens - a.tokens);

    const latencyValues = executionRows
      .map((row) => row.latencyMs)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
    const avgLatencyMs = latencyValues.length > 0
      ? latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length
      : null;

    const sortedUsageLogs = [...usageLogs].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    const throughputTokensPerSecond = (() => {
      if (sortedUsageLogs.length < 2) {
        return null;
      }
      const durationMs = sortedUsageLogs.at(-1)!.createdAt.getTime() - sortedUsageLogs[0]!.createdAt.getTime();
      if (durationMs < 30_000) {
        return null;
      }
      const totalTokens = sortedUsageLogs.reduce((sum, item) => sum + item.totalTokens, 0);
      if (totalTokens <= 0) {
        return null;
      }
      return totalTokens / (durationMs / 1000);
    })();

    const dailyCosts = dayKeys.map((date, index) => ({
      date,
      cost: Number(((weeklyTokens[index] / 1_000_000) * 1.5).toFixed(4))
    }));

    const tokenSource: MetricsSource = usageTotalTokens > 0 || usageLogs.length > 0
      ? "usage_logs"
      : (model.totalTokens > 0 || model.dailyTokens > 0) ? "model_counter" : "unknown";
    const totalTokens = tokenSource === "usage_logs" ? usageTotalTokens : model.totalTokens;
    const dailyTokens = tokenSource === "usage_logs"
      ? computedDailyTokens
      : model.dailyTokens;
    const quality = inferMetricsQuality({
      usageLogCount: usageLogs.length,
      executionCount: executionRows.length,
      tokenSource
    });

    sendSuccess(res, {
      totalTokens,
      dailyTokens,
      weeklyTokens,
      avgLatency: formatLatency(avgLatencyMs),
      avgThroughput: formatThroughput(throughputTokensPerSecond),
      dailyCosts,
      tokenDistribution: distribution,
      dataSources: {
        tokens: tokenSource,
        latency: avgLatencyMs === null ? "unknown" : "project_execution",
        throughput: throughputTokensPerSecond === null ? "unknown" : "usage_logs",
        cost: weeklyTokens.some((item) => item > 0) ? "estimated_by_tokens" : "unknown"
      },
      quality,
      samples: {
        usageLogs: usageLogs.length,
        projectExecutions: executionRows.length
      },
      notes: [
        "token/cost metrics are computed from AgentUsageLog; current cost is estimated by token volume."
      ]
    });
  }));

  router.post("/:id/health-check", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    const id = String(req.params.id ?? "").trim();
    const model = await prisma.model.findUnique({ where: { id } });

    if (!model) {
      sendError(res, 404, "NOT_FOUND", "Model not found");
      return;
    }

    const canProbe = Boolean(
      model.provider === "openai-compatible"
      && model.apiBaseUrl
      && /^https?:\/\//i.test(model.apiBaseUrl)
      && model.apiKey
    );
    const probe = canProbe
      ? await probeOpenAICompatibleHealth({
        apiBaseUrl: String(model.apiBaseUrl ?? ""),
        apiKey: String(model.apiKey ?? ""),
        model: model.name
      })
      : {
        reachable: false,
        latencyMs: null as number | null,
        error: "Model API endpoint is not reachable"
      };

    const reachable = probe.reachable;
    const latency = Number.isFinite(probe.latencyMs) ? `${Math.round(Number(probe.latencyMs))}ms` : "N/A";
    const error = reachable ? null : probe.error || "Model API endpoint is not reachable";

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
          content: reachable ? `health check passed (${latency})` : `health check failed: ${error}`,
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

  router.post("/:id/set-default", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
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
