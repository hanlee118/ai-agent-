import { readFile } from "node:fs/promises";
import { prisma } from "../db.js";
import { OPENCLAW_CONFIG_PATH } from "../openclaw/paths.js";
import { getResolvedRuntimeExecutionConfig } from "./runtime-config.js";
import { getProjectStageExecutionStrategy } from "./project-stage-execution.js";
import {
  DESIGN_MODEL_FALLBACKS,
  DESIGN_MODEL_PRIMARY
} from "../agents/design-model-policy.js";
import { buildOpenAiCompatibleHeaders } from "../utils/openai-compatible-headers.js";

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
  env?: Record<string, string>;
  models?: {
    providers?: Record<string, { baseUrl?: string; apiKey?: string }>;
  };
};

const DESIGN_EXECUTION_STRATEGY = getProjectStageExecutionStrategy("DESIGN", "ROLE_DESIGN");
const DESIGN_AGENT_ID = DESIGN_EXECUTION_STRATEGY.openClawAgentId ?? "ROLE_DESIGN";
const DESIGN_SELECTED_TARGET = DESIGN_EXECUTION_STRATEGY.preferredModels[0] ?? DESIGN_MODEL_PRIMARY;
const DESIGN_FALLBACK_TARGET = DESIGN_EXECUTION_STRATEGY.preferredModels[1] ?? DESIGN_MODEL_FALLBACKS[0];
const DESIGN_POLICY_AGENT_IDS = Array.from(new Set([DESIGN_AGENT_ID, "ROLE_DESIGN"]));

export async function getDesignModelPolicyHealth() {
  const checkedAt = new Date().toISOString();
  const runtime = await getResolvedRuntimeExecutionConfig();
  const openclawProviders = await readOpenClawProviders();
  const openclawEnv = await readOpenClawEnv();

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
  const openaiProvider = openclawProviders.openai;

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

  const openaiChannel: ProbeChannel = {
    id: "openclaw-openai",
    label: "OpenClaw Provider: openai",
    source: "openclaw",
    apiBaseUrl: String(openaiProvider?.baseUrl ?? "").trim(),
    apiKey: String(openaiProvider?.apiKey ?? "").trim() || String(openclawEnv.OPENAI_API_KEY ?? "").trim(),
    available: Boolean(String(openaiProvider?.baseUrl ?? "").trim())
      && Boolean(String(openaiProvider?.apiKey ?? "").trim() || String(openclawEnv.OPENAI_API_KEY ?? "").trim()),
    reason: !openaiProvider ? "openclaw.json 未配置 openai provider" : undefined
  };

  const primaryCandidates = dedupeChannels([openaiChannel, runtimeChannel, minimaChannel]);
  const fallbackOneCandidates = dedupeChannels([openaiChannel, runtimeChannel, minimaChannel]);
  const fallbackTwoCandidates = dedupeChannels([kimiChannel, openaiChannel, runtimeChannel, minimaChannel]);

  const probes: ModelProbeResult[] = [
    await probeModelAvailability(DESIGN_MODEL_PRIMARY, "primary", primaryCandidates),
    await probeModelAvailability(DESIGN_MODEL_FALLBACKS[0], "fallback", fallbackOneCandidates),
    await probeModelAvailability(DESIGN_MODEL_FALLBACKS[1], "fallback", fallbackTwoCandidates)
  ];

  const designConfig = await prisma.managedAgentConfig.findUnique({
    where: { agentId: DESIGN_AGENT_ID },
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
    issues.push(`主模型 ${DESIGN_MODEL_PRIMARY} 当前不可用。`);
  }
  if (!fallbackReady) {
    issues.push("备选模型链全部不可用，降级策略无法执行。");
  }
  if (!selectedAligned || !fallbackAligned) {
    issues.push(`${DESIGN_AGENT_ID} 配置与设计策略不一致（selected/fallback 未对齐标准）。`);
  }

  const recommendations: string[] = [];
  if (!primaryHealthy) {
    recommendations.push(`优先修复主模型 ${DESIGN_MODEL_PRIMARY} 通道；若网关要求 stream 模式，确认网关已放行。`);
  }
  if (!fallbackReady) {
    recommendations.push(`至少保证 ${DESIGN_MODEL_FALLBACKS[0] ?? "第一备选模型"} 可用，并准备第二备选模型以满足故障自动降级。`);
  }
  if (!selectedAligned || !fallbackAligned) {
    recommendations.push(`将 ${DESIGN_AGENT_ID} 设置为 selected=${DESIGN_SELECTED_TARGET}，fallback=${DESIGN_FALLBACK_TARGET}。`);
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
      sanitizeChannel(openaiChannel),
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

export async function repairDesignModelPolicy() {
  const before = await getDesignModelPolicyHealth();
  const beforeSelected = before.designAgentConfig.selectedModel;
  const beforeFallback = before.designAgentConfig.fallbackModel;

  const targetSelected = DESIGN_SELECTED_TARGET;
  const targetFallback = DESIGN_FALLBACK_TARGET;

  await Promise.all(DESIGN_POLICY_AGENT_IDS.map(async (agentId) => {
    await prisma.managedAgentConfig.upsert({
      where: { agentId },
      create: {
        agentId,
        displayName: agentId === DESIGN_AGENT_ID ? "视觉设计总监" : agentId,
        title: agentId === DESIGN_AGENT_ID ? "视觉设计总监" : agentId,
        selectedModel: targetSelected,
        defaultModel: targetSelected,
        fallbackModel: targetFallback,
        executionMode: "confirm_first",
        requireConfirmation: true,
        autoApproveMinorSteps: false,
        memoryEnabled: true,
        allowedAgentIds: [],
        toolAllowlist: []
      },
      update: {
        selectedModel: targetSelected,
        defaultModel: targetSelected,
        fallbackModel: targetFallback
      }
    });
  }));

  const after = await getDesignModelPolicyHealth();
  const afterSelected = after.designAgentConfig.selectedModel;
  const afterFallback = after.designAgentConfig.fallbackModel;

  return {
    ok: after.designAgentConfig.policyAligned,
    repaired: true,
    policyTarget: {
      selectedModel: targetSelected,
      fallbackModel: targetFallback
    },
    changed: {
      selectedModel: beforeSelected !== afterSelected,
      fallbackModel: beforeFallback !== afterFallback
    },
    before,
    after
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
      headers: buildOpenAiCompatibleHeaders({
        apiBaseUrl: input.apiBaseUrl,
        apiKey: input.apiKey,
        json: true
      }),
      body: JSON.stringify({
        model: normalizeProbeModel(input.model),
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

function normalizeProbeModel(model: string) {
  const normalized = String(model ?? "").trim();
  if (normalized.includes("/")) {
    return normalized.slice(normalized.indexOf("/") + 1);
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

async function readOpenClawEnv() {
  try {
    const content = await readFile(OPENCLAW_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(content) as OpenClawConfigFile;
    return parsed.env ?? {};
  } catch {
    return {};
  }
}
