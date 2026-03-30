import { readFile } from "node:fs/promises";
import { prisma } from "../db.js";
import { OPENCLAW_CONFIG_PATH } from "../openclaw/paths.js";
import { getResolvedRuntimeExecutionConfig } from "./runtime-config.js";
import {
  DESIGN_MODEL_FALLBACKS,
  DESIGN_MODEL_PRIMARY
} from "../agents/design-model-policy.js";

type ModelRole = "primary" | "fallback";
type CheckStatus = "healthy" | "failed";

type ProbeChannel = {
  id: string;
  label: string;
  source: "runtime" | "openclaw";
  apiBaseUrl: string;
  apiKey: string;
  available: boolean;
  reason?: string;
};

type ProbeAttempt = {
  channelId: string;
  channelLabel: string;
  ok: boolean;
  statusCode: number;
  latencyMs: number;
  error?: string;
};

type ModelProbeResult = {
  model: string;
  role: ModelRole;
  status: CheckStatus;
  channel?: string;
  latencyMs?: number;
  error?: string;
  attempts: ProbeAttempt[];
};

type OpenClawConfigFile = {
  models?: {
    providers?: Record<string, { baseUrl?: string; apiKey?: string }>;
  };
};

export async function getDesignModelPolicyHealth() {
  const checkedAt = new Date().toISOString();
  const runtime = await getResolvedRuntimeExecutionConfig();
  const openclawProviders = await readOpenClawProviders();

  const runtimeChannel: ProbeChannel = {
    id: "runtime-selected",
    label: "Runtime Selected Provider",
    source: "runtime",
    apiBaseUrl: String(runtime.apiBaseUrl ?? "").trim(),
    apiKey: String(runtime.apiKey ?? "").trim(),
    available: runtime.status.requestedMode === "openai-compatible" && runtime.status.configured
      && Boolean(String(runtime.apiBaseUrl ?? "").trim())
      && Boolean(String(runtime.apiKey ?? "").trim()),
    reason: runtime.status.requestedMode !== "openai-compatible"
      ? "运行模式非 openai-compatible"
      : runtime.status.configured
        ? undefined
        : "运行时配置不完整"
  };

  const minimaProvider = openclawProviders.minima;
  const kimiProvider = openclawProviders.kimi;

  const minimaChannel: ProbeChannel = {
    id: "openclaw-minima",
    label: "OpenClaw Provider: minima",
    source: "openclaw",
    apiBaseUrl: String(minimaProvider?.baseUrl ?? "").trim(),
    apiKey: String(minimaProvider?.apiKey ?? "").trim(),
    available: Boolean(String(minimaProvider?.baseUrl ?? "").trim() && String(minimaProvider?.apiKey ?? "").trim()),
    reason: !minimaProvider ? "openclaw.json 未配置 minima provider" : undefined
  };

  const kimiChannel: ProbeChannel = {
    id: "openclaw-kimi",
    label: "OpenClaw Provider: kimi",
    source: "openclaw",
    apiBaseUrl: String(kimiProvider?.baseUrl ?? "").trim(),
    apiKey: String(kimiProvider?.apiKey ?? "").trim(),
    available: Boolean(String(kimiProvider?.baseUrl ?? "").trim() && String(kimiProvider?.apiKey ?? "").trim()),
    reason: !kimiProvider ? "openclaw.json 未配置 kimi provider" : undefined
  };

  const primaryCandidates = dedupeChannels([runtimeChannel, minimaChannel]);
  const fallbackOneCandidates = dedupeChannels([runtimeChannel, minimaChannel]);
  const fallbackTwoCandidates = dedupeChannels([kimiChannel, runtimeChannel, minimaChannel]);

  const probes: ModelProbeResult[] = [
    await probeModelAvailability(DESIGN_MODEL_PRIMARY, "primary", primaryCandidates),
    await probeModelAvailability(DESIGN_MODEL_FALLBACKS[0], "fallback", fallbackOneCandidates),
    await probeModelAvailability(DESIGN_MODEL_FALLBACKS[1], "fallback", fallbackTwoCandidates)
  ];

  const designConfig = await prisma.managedAgentConfig.findUnique({
    where: { agentId: "ROLE_DESIGN" },
    select: {
      selectedModel: true,
      fallbackModel: true,
      updatedAt: true
    }
  });

  const selectedAligned = matchesModel(designConfig?.selectedModel, DESIGN_MODEL_PRIMARY);
  const fallbackAligned = matchesAnyModel(designConfig?.fallbackModel, [...DESIGN_MODEL_FALLBACKS]);

  const primaryHealthy = probes[0]?.status === "healthy";
  const healthyFallbacks = probes.filter((item) => item.role === "fallback" && item.status === "healthy");
  const fallbackReady = healthyFallbacks.length > 0;

  const issues: string[] = [];
  if (!runtimeChannel.available) {
    issues.push(`运行时通道不可用：${runtimeChannel.reason || "请检查 /api/system/runtime/config"}`);
  }
  if (!primaryHealthy) {
    issues.push("主模型 gpt-5.4 当前不可用。");
  }
  if (!fallbackReady) {
    issues.push("备选模型链全部不可用，降级策略无法执行。");
  }
  if (!selectedAligned || !fallbackAligned) {
    issues.push("ROLE_DESIGN 配置与策略不一致（selected/fallback 未对齐标准）。");
  }

  const recommendations: string[] = [];
  if (!primaryHealthy) {
    recommendations.push("优先修复 gpt-5.4 通道；若网关要求 stream 模式，确认网关已放行。");
  }
  if (!fallbackReady) {
    recommendations.push("至少保证 gpt-5.3-codex 或 kimi-k2.5 可用，以满足故障自动降级。");
  }
  if (!selectedAligned || !fallbackAligned) {
    recommendations.push("将 ROLE_DESIGN 设置为 selected=gpt-5.4，fallback=gpt-5.3-codex。");
  }

  const overallStatus =
    issues.length === 0 ? "healthy" :
      primaryHealthy && fallbackReady ? "warning" : "failed";

  const ok = overallStatus !== "failed";

  return {
    ok,
    status: overallStatus,
    checkedAt,
    policy: {
      primary: DESIGN_MODEL_PRIMARY,
      fallbacks: [...DESIGN_MODEL_FALLBACKS]
    },
    runtime: {
      requestedMode: runtime.status.requestedMode,
      mode: runtime.status.mode,
      configured: runtime.status.configured,
      modelName: runtime.modelName,
      apiBaseUrl: runtime.apiBaseUrl
    },
    channels: [
      sanitizeChannel(runtimeChannel),
      sanitizeChannel(minimaChannel),
      sanitizeChannel(kimiChannel)
    ],
    probes,
    fallback: {
      primaryHealthy,
      healthyFallbackCount: healthyFallbacks.length,
      fallbackReady,
      nextAvailableFallback: healthyFallbacks[0]?.model || null
    },
    designAgentConfig: {
      exists: Boolean(designConfig),
      selectedModel: designConfig?.selectedModel ?? "",
      fallbackModel: designConfig?.fallbackModel ?? "",
      selectedAligned,
      fallbackAligned,
      policyAligned: selectedAligned && fallbackAligned,
      updatedAt: designConfig?.updatedAt?.toISOString()
    },
    issues,
    recommendations
  };
}

async function probeModelAvailability(
  model: string,
  role: ModelRole,
  channels: ProbeChannel[]
): Promise<ModelProbeResult> {
  const attempts: ProbeAttempt[] = [];

  for (const channel of channels) {
    if (!channel.available) {
      attempts.push({
        channelId: channel.id,
        channelLabel: channel.label,
        ok: false,
        statusCode: 0,
        latencyMs: 0,
        error: channel.reason || "channel unavailable"
      });
      continue;
    }

    const start = Date.now();
    const result = await probeOpenAICompatibleModel({
      apiBaseUrl: channel.apiBaseUrl,
      apiKey: channel.apiKey,
      model
    });
    const latencyMs = Date.now() - start;

    attempts.push({
      channelId: channel.id,
      channelLabel: channel.label,
      ok: result.ok,
      statusCode: result.statusCode,
      latencyMs,
      error: result.error
    });

    if (result.ok) {
      return {
        model,
        role,
        status: "healthy",
        channel: channel.id,
        latencyMs,
        attempts
      };
    }
  }

  const last = attempts[attempts.length - 1];
  return {
    model,
    role,
    status: "failed",
    error: last?.error || "all channels failed",
    attempts
  };
}

async function probeOpenAICompatibleModel(input: {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
}): Promise<{ ok: boolean; statusCode: number; error?: string }> {
  const preferStream = requiresStreamMode(input.model);
  const first = await sendProbeRequest({
    ...input,
    stream: preferStream
  });

  if (first.ok) {
    return first;
  }

  const message = String(first.error ?? "").toLowerCase();
  if (!preferStream && message.includes("stream must be set to true")) {
    return sendProbeRequest({
      ...input,
      stream: true
    });
  }

  if (preferStream && message.includes("stream")) {
    return sendProbeRequest({
      ...input,
      stream: false
    });
  }

  return first;
}

async function sendProbeRequest(input: {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  stream: boolean;
}): Promise<{ ok: boolean; statusCode: number; error?: string }> {
  const endpoint = `${input.apiBaseUrl.replace(/\/$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`
      },
      body: JSON.stringify({
        model: input.model,
        temperature: 0,
        max_tokens: 16,
        stream: input.stream,
        messages: [{ role: "user", content: "Reply with OK only." }]
      })
    });

    if (!response.ok) {
      const errorMessage = await extractErrorMessage(response);
      return {
        ok: false,
        statusCode: response.status,
        error: errorMessage || `HTTP ${response.status}`
      };
    }

    if (!input.stream) {
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = String(payload.choices?.[0]?.message?.content ?? "").trim();
      return {
        ok: Boolean(content),
        statusCode: response.status,
        error: content ? undefined : "empty response content"
      };
    }

    const raw = await response.text();
    const content = parseSseContent(raw).trim();
    return {
      ok: Boolean(content),
      statusCode: response.status,
      error: content ? undefined : "empty stream content"
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function extractErrorMessage(response: Response) {
  const raw = await response.text();
  try {
    const parsed = JSON.parse(raw) as {
      error?: {
        message?: string;
      };
      message?: string;
    };
    return String(parsed.error?.message ?? parsed.message ?? raw).trim();
  } catch {
    return String(raw).trim();
  }
}

function parseSseContent(raw: string) {
  let content = "";
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith("data:")) {
      continue;
    }
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") {
      continue;
    }

    try {
      const parsed = JSON.parse(payload) as {
        choices?: Array<{
          delta?: {
            content?: string;
          };
        }>;
      };
      const chunk = String(parsed.choices?.[0]?.delta?.content ?? "");
      if (chunk) {
        content += chunk;
      }
    } catch {
      // ignore malformed chunk
    }
  }

  return content;
}

function requiresStreamMode(model: string) {
  const normalized = normalizeModel(model);
  return normalized.startsWith("gpt-5.4") || normalized.startsWith("gpt-5.3-codex");
}

function dedupeChannels(channels: ProbeChannel[]) {
  const seen = new Set<string>();
  const output: ProbeChannel[] = [];
  for (const item of channels) {
    if (!item.id || seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    output.push(item);
  }
  return output;
}

function sanitizeChannel(channel: ProbeChannel) {
  return {
    id: channel.id,
    label: channel.label,
    source: channel.source,
    available: channel.available,
    apiBaseUrl: channel.apiBaseUrl,
    apiKeyConfigured: Boolean(channel.apiKey),
    reason: channel.reason
  };
}

function matchesAnyModel(value: string | null | undefined, targets: readonly string[]) {
  return targets.some((target) => matchesModel(value, target));
}

function matchesModel(value: string | null | undefined, target: string) {
  return normalizeModel(value) === normalizeModel(target);
}

function normalizeModel(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  const slash = normalized.indexOf("/");
  if (slash >= 0) {
    return normalized.slice(slash + 1);
  }
  return normalized;
}

async function readOpenClawProviders() {
  try {
    const content = await readFile(OPENCLAW_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(content) as OpenClawConfigFile;
    return parsed.models?.providers ?? {};
  } catch {
    return {};
  }
}

