import type { ParsedIntent, RoleType, StageType } from "@occ/shared";
import { runOpenAICompatibleAgent } from "./providers/openai-compatible-provider.js";
import { runAnthropicCompatibleAgent } from "./providers/anthropic-compatible-provider.js";
import { runScriptedAgent, type AgentRunResult } from "./providers/scripted-provider.js";
import {
  DESIGN_MODEL_POLICY_CHAIN,
  DESIGN_MODEL_PRIMARY
} from "./design-model-policy.js";
import { prisma } from "../db.js";
import { readFile } from "node:fs/promises";
import {
  getResolvedRuntimeExecutionConfig,
  getRuntimeStatus as readRuntimeStatus
} from "../system/runtime-config.js";
import { OPENCLAW_CONFIG_PATH } from "../openclaw/paths.js";
import { normalizeOpenClawProviderApis } from "../openclaw/workspace.js";
import { buildOpenAiCompatibleHeaders } from "../utils/openai-compatible-headers.js";

const STAGE_AGENT_MAX_MODELS = Math.max(1, Number(process.env.STAGE_AGENT_MAX_MODELS ?? 3));
const STAGE_AGENT_MAX_MODELS_DESIGN = Math.max(
  STAGE_AGENT_MAX_MODELS,
  Number(process.env.STAGE_AGENT_MAX_MODELS_DESIGN ?? 8)
);
const STAGE_AGENT_TOTAL_TIMEOUT_MS = Math.max(12000, Number(process.env.STAGE_AGENT_TOTAL_TIMEOUT_MS ?? 90000));
const MIN_ATTEMPT_BUDGET_MS = 8000;
const MAX_SINGLE_ATTEMPT_TIMEOUT_MS = Math.max(
  MIN_ATTEMPT_BUDGET_MS,
  Number(process.env.STAGE_AGENT_SINGLE_ATTEMPT_TIMEOUT_MS ?? 45000)
);
const STAGE_TIMEOUT_BASELINE_MS: Record<StageType, number> = {
  INIT: 30000,
  ANALYSIS: 40000,
  DESIGN: 45000,
  DEV: 40000,
  ACCEPT: 30000
};
const ROUTE_TIMEOUT_COOLDOWN_MS = Math.max(15000, Number(process.env.MODEL_ROUTE_TIMEOUT_COOLDOWN_MS ?? 30000));
const ROUTE_AUTH_COOLDOWN_MS = Math.max(60000, Number(process.env.MODEL_ROUTE_AUTH_COOLDOWN_MS ?? 900000));
const ROUTE_NETWORK_COOLDOWN_MS = Math.max(5000, Number(process.env.MODEL_ROUTE_NETWORK_COOLDOWN_MS ?? 15000));
const MODEL_ROUTE_PREWARM_ENABLED = String(process.env.MODEL_ROUTE_PREWARM_ENABLED ?? "true").trim().toLowerCase() !== "false";
const MODEL_ROUTE_PREWARM_TIMEOUT_MS = Math.max(1200, Number(process.env.MODEL_ROUTE_PREWARM_TIMEOUT_MS ?? 4500));
const MODEL_ROUTE_PREWARM_HEALTHY_TTL_MS = Math.max(10000, Number(process.env.MODEL_ROUTE_PREWARM_HEALTHY_TTL_MS ?? 90000));
const MODEL_ROUTE_PREWARM_FAIL_TTL_MS = Math.max(15000, Number(process.env.MODEL_ROUTE_PREWARM_FAIL_TTL_MS ?? 180000));
const REAL_RUNTIME_FAIL_FAST_WINDOW_MS = Math.max(
  60000,
  Number(process.env.REAL_RUNTIME_FAIL_FAST_WINDOW_MS ?? 600000)
);
const modelRouteCooldown = new Map<string, number>();
const routePrewarmCache = new Map<string, { reason: string | null; expiresAt: number }>();

const ROLE_STAGE_TIMEOUT_BASELINE_MS: Partial<Record<RoleType, number>> = {
  ROLE_PM: 180000,
  ROLE_ANALYST: 180000,
  ROLE_PRODUCT: 150000,
  ROLE_DESIGN: 180000, // 设计任务内容相对更重，保留更高预算
  ROLE_ARCH: 120000,
  ROLE_DEV: 120000,
  ROLE_QA: 120000
};

const ROLE_ATTEMPT_TIMEOUT_BASELINE_MS: Partial<Record<RoleType, number>> = {
  ROLE_PM: 90000,
  ROLE_ANALYST: 90000,
  ROLE_PRODUCT: 90000,
  ROLE_DESIGN: 90000,
  ROLE_ARCH: 60000,
  ROLE_DEV: 60000,
  ROLE_QA: 60000
};

const STAGE_MODEL_PREFERENCES: Record<StageType, string[]> = {
  INIT: ["openai/gpt-5.4", "openai/gpt-5.3-codex", "qwen3-max-2026-01-23", "qwen3.5-plus", "qwen3-coder-plus"],
  ANALYSIS: ["openai/gpt-5.4", "openai/gpt-5.3-codex", "qwen3-max-2026-01-23", "qwen3.5-plus", "qwen3-coder-plus", "glm-5"],
  DESIGN: [
    "openai/gpt-5.4",
    "openai/gpt-5.3-codex",
    "qwen3-max-2026-01-23",
    "qwen3.5-plus",
    "qwen3-coder-plus",
    "kimi-k2.5",
    "minima/MiniMax-M2.7-highspeed",
    "glm-5"
  ],
  DEV: ["openai/gpt-5.3-codex", "openai/gpt-5.4", "qwen3-coder-plus", "qwen3-coder-next", "qwen3-max-2026-01-23"],
  ACCEPT: ["openai/gpt-5.4", "openai/gpt-5.3-codex", "qwen3-max-2026-01-23", "qwen3.5-plus", "glm-5"]
};

// Issue 讨论优先走当前网关已实测可用的模型链，避免把不可用模型写成首选。
const ISSUE_DEBATE_MODEL_PREFERENCES = [
  "openai/gpt-5.4",
  "openai/gpt-5.3-codex",
  "gpt-5.4",
  "hermes-v2.1"
] as const;

const STAGE_MODEL_RATIONALE: Record<StageType, { objective: string; bestFit: string }> = {
  INIT: {
    objective: "快速理解需求与项目初始化。",
    bestFit: "gpt-5.4（首选） -> gpt-5.3-codex（补位） -> qwen3-max / qwen3.5-plus（兜底）"
  },
  ANALYSIS: {
    objective: "抽取约束/风险/验收标准，形成可执行分析。",
    bestFit: "gpt-5.4（首选） -> gpt-5.3-codex（次选） -> qwen3-max / glm-5（补位）"
  },
  DESIGN: {
    objective: "输出高质量视觉与交互策略，避免模板化设计。",
    bestFit: "gpt-5.4（设计首选） -> gpt-5.3-codex -> qwen3-max / qwen3.5-plus -> kimi/minimax/glm（扩展）"
  },
  DEV: {
    objective: "面向实现落地，强调代码可执行性和稳定性。",
    bestFit: "gpt-5.3-codex（实现首选） -> gpt-5.4（补位） -> qwen3-coder-plus / qwen3-coder-next（兜底）"
  },
  ACCEPT: {
    objective: "验收复盘与质量关口确认。",
    bestFit: "gpt-5.4（质量复核） -> gpt-5.3-codex（总结评审） -> qwen3-max / glm-5（兜底）"
  }
};

const RUNTIME_DISABLED_MODELS = String(process.env.RUNTIME_DISABLED_MODELS ?? "qwen3-*,glm-5")
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

function isRuntimeDisabledModel(model: string) {
  const normalized = String(model || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  const variants = normalized.includes("/")
    ? [normalized, normalized.split("/").slice(-1)[0]]
    : [normalized];
  for (const rule of RUNTIME_DISABLED_MODELS) {
    const isPrefixRule = rule.endsWith("*");
    const token = isPrefixRule ? rule.slice(0, -1) : rule;
    if (!token) continue;
    if (variants.some((item) => (isPrefixRule ? item.startsWith(token) : item === token))) {
      return true;
    }
  }
  return false;
}

type StageModelAttemptStatus = "success" | "failed" | "skipped";

export type StageModelAttemptTrace = {
  stageType: StageType;
  role: RoleType;
  model: string;
  route: string;
  status: StageModelAttemptStatus;
  elapsedMs: number;
  startedAt: string;
  attempt?: number;
  requestedModel?: string;
  selectedModel?: string;
  executedModel?: string;
  provider?: string;
  isolatedSession?: boolean;
  sessionId?: string;
  localExecution?: boolean;
  failureKind?: string;
  recoveryAction?: string;
  recoveryTargetModel?: string;
  error?: string;
};

export type StageAgentRunResult = AgentRunResult & {
  attempts: StageModelAttemptTrace[];
  degraded?: boolean;
  skillEvidence?: Record<string, unknown> | null;
  collaborationEvidence?: Record<string, unknown> | null;
  workspaceEvidence?: {
    workspacePath: string;
    relativePath?: string;
    evidenceFiles: string[];
  } | null;
};

type ExecutionRoute = {
  source: string;
  apiBaseUrl: string;
  apiKey: string;
};

const ROLE_MANAGED_AGENT_ALIASES: Partial<Record<RoleType, string>> = {
  ROLE_PM: "project_manager",
  ROLE_ANALYST: "requirements_analyst",
  ROLE_PRODUCT: "product_director",
  ROLE_DESIGN: "jeremy",
  ROLE_ARCH: "rd_director",
  ROLE_DEV: "rd_manager",
  ROLE_QA: "qa_engineer",
  ROLE_HR: "hr_director"
};

function isRealModelGateEnabled() {
  const raw = String(process.env.ENFORCE_REAL_MODEL_GATE ?? "").trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "on") {
    return true;
  }
  if (raw === "false" || raw === "0" || raw === "off") {
    return false;
  }
  return process.env.NODE_ENV === "production";
}

function getModelRouteKey(model: string, route: string) {
  return `${String(model || "").trim().toLowerCase()}::${String(route || "").trim().toLowerCase()}`;
}

function getModelRouteCooldownError(model: string, route: string) {
  const key = getModelRouteKey(model, route);
  const blockedUntil = modelRouteCooldown.get(key);
  if (!blockedUntil) {
    return null;
  }
  if (blockedUntil <= Date.now()) {
    modelRouteCooldown.delete(key);
    return null;
  }
  return `ROUTE_COOLDOWN_ACTIVE: retryAfterMs=${blockedUntil - Date.now()}`;
}

function markModelRouteCooldown(model: string, route: string, error: unknown) {
  const message = normalizeErrorMessage(error).toUpperCase();
  let ttlMs = 0;

  if (message.includes("AUTH_401") || message.includes("UNAUTHORIZED") || message.includes("INVALID API KEY")) {
    ttlMs = ROUTE_AUTH_COOLDOWN_MS;
  } else if (message.includes("MODEL_ATTEMPT_TIMEOUT") || message.includes("ETIMEOUT") || message.includes("TIMED OUT")) {
    ttlMs = ROUTE_TIMEOUT_COOLDOWN_MS;
  } else if (
    message.includes("ENOTFOUND")
    || message.includes("ECONNREFUSED")
    || message.includes("ECONNRESET")
    || message.includes("FETCH FAILED")
    || message.includes("SOCKET")
  ) {
    ttlMs = ROUTE_NETWORK_COOLDOWN_MS;
  } else if (
    message.includes("HTTP_503")
    || message.includes("NO AVAILABLE CHANNEL")
    || message.includes("UNSUPPORTED MODEL")
    || message.includes("MODEL NOT FOUND")
  ) {
    // Treat model/channel unavailability as route-level cooldown to avoid repeated hot-loop failures.
    ttlMs = ROUTE_NETWORK_COOLDOWN_MS;
  }

  if (ttlMs <= 0) {
    return;
  }

  const blockedUntil = Date.now() + ttlMs;
  modelRouteCooldown.set(getModelRouteKey(model, route), blockedUntil);
}

async function getRoutePrewarmError(route: ExecutionRoute, model: string, routeRemainingMs: number) {
  if (!MODEL_ROUTE_PREWARM_ENABLED) {
    return null;
  }

  const routeLabel = toRouteLabel(route);
  const cacheKey = getModelRouteKey(model, routeLabel);
  const cached = routePrewarmCache.get(cacheKey);
  if (cached) {
    if (cached.expiresAt > Date.now()) {
      return cached.reason;
    }
    routePrewarmCache.delete(cacheKey);
  }

  const timeoutMs = Math.max(1200, Math.min(MODEL_ROUTE_PREWARM_TIMEOUT_MS, routeRemainingMs - 300));
  if (timeoutMs < 1200) {
    return null;
  }

  const result = await probeRouteModel(route, model, timeoutMs);
  if (!result.reason) {
    routePrewarmCache.set(cacheKey, {
      reason: null,
      expiresAt: Date.now() + MODEL_ROUTE_PREWARM_HEALTHY_TTL_MS
    });
    return null;
  }

  routePrewarmCache.set(cacheKey, {
    reason: result.reason,
    expiresAt: Date.now() + result.ttlMs
  });
  return result.reason;
}

async function probeRouteModel(route: ExecutionRoute, model: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const baseUrl = String(route.apiBaseUrl ?? "").replace(/\/$/, "");
  const normalizedModel = normalizeRuntimeModelName(model);

  const request = async (stream: boolean) => fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal: controller.signal,
    headers: buildOpenAiCompatibleHeaders({
      apiBaseUrl: route.apiBaseUrl,
      apiKey: route.apiKey,
      json: true
    }),
    body: JSON.stringify({
      model: normalizedModel,
      stream,
      max_tokens: 12,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: "OK"
        }
      ]
    })
  });

  try {
    let stream = requiresStreamMode(model);
    let response = await request(stream);
    if (!response.ok) {
      const message = await readResponseMessage(response);
      if (!stream && /stream must be set to true/i.test(message)) {
        stream = true;
        response = await request(stream);
      } else if (stream && /stream/i.test(message)) {
        stream = false;
        response = await request(stream);
      }
    }

    if (!response.ok) {
      const message = await readResponseMessage(response);
      if (response.status === 401 || response.status === 403) {
        return { reason: `PREWARM_AUTH_${response.status}: ${message || "unauthorized"}`, ttlMs: ROUTE_AUTH_COOLDOWN_MS };
      }
      if (response.status === 503) {
        return { reason: `PREWARM_HTTP_503: ${message || "service unavailable"}`, ttlMs: MODEL_ROUTE_PREWARM_FAIL_TTL_MS };
      }
      return { reason: null, ttlMs: 0 };
    }

    await response.text();
    return { reason: null, ttlMs: 0 };
  } catch (error) {
    const message = normalizeErrorMessage(error).toUpperCase();
    if (message.includes("ABORT") || message.includes("TIMEOUT") || message.includes("TIMED OUT")) {
      return { reason: null, ttlMs: 0 };
    }
    if (
      message.includes("ECONNRESET")
      || message.includes("ECONNREFUSED")
      || message.includes("ENOTFOUND")
      || message.includes("FETCH FAILED")
      || message.includes("SOCKET")
    ) {
      // Prewarm 只是探测，不应因为一次网络抖动直接阻断真实请求。
      return { reason: null, ttlMs: 0 };
    }
    return { reason: null, ttlMs: 0 };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeRuntimeModelName(model: string) {
  const normalized = String(model ?? "").trim();
  if (normalized.startsWith("openai/")) {
    return normalized.slice("openai/".length);
  }
  if (normalized.startsWith("anthropic/")) {
    return normalized.slice("anthropic/".length);
  }
  return normalized;
}

async function readResponseMessage(response: Response) {
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

export async function runStageAgent(input: {
  projectName: string;
  projectDescription: string;
  parsedIntent: ParsedIntent;
  stageType: StageType;
  role: RoleType;
  summary?: string;
  promptMode?: "default" | "issue_debate";
}): Promise<StageAgentRunResult> {
  const runtime = await getResolvedRuntimeExecutionConfig();
  const requestedRealMode = runtime.status.requestedMode === "openai-compatible";
  const enforceRealModelGate = isRealModelGateEnabled();
  const allowInitScriptedBootstrap = enforceRealModelGate && input.stageType === "INIT";
  const attempts: StageModelAttemptTrace[] = [];

  const trackAttempt = (payload: {
    model: string;
    route: string;
    status: StageModelAttemptStatus;
    startedAtMs: number;
    error?: unknown;
  }) => {
    attempts.push({
      stageType: input.stageType,
      role: input.role,
      model: payload.model,
      route: payload.route,
      status: payload.status,
      elapsedMs: Math.max(0, Date.now() - payload.startedAtMs),
      startedAt: new Date(payload.startedAtMs).toISOString(),
      error: payload.error ? normalizeErrorMessage(payload.error) : undefined
    });
  };

  if (requestedRealMode) {
    if (!runtime.status.configured) {
      const gateMessage = "已启用真实模型模式，但配置不完整（缺少 API Base URL / API Key / Model）。";
      throw new Error(enforceRealModelGate ? `REAL_MODEL_GATE_FAILED: ${gateMessage}` : `REAL_MODEL_NOT_CONFIGURED: ${gateMessage}`);
    }

    if (shouldFastFailRealRuntime(
      runtime.status.lastValidationStatus,
      runtime.status.lastValidatedAt,
      runtime.status.lastValidationError
    )) {
      if (enforceRealModelGate) {
        throw new Error(
          `REAL_MODEL_GATE_FAILED: 最近一次模型健康校验失败，已命中快速失败窗口（status=${runtime.status.lastValidationStatus || "unknown"}）。`
        );
      }
      const degraded = await runScriptedAgent({
        ...input,
        summary: `${input.summary ?? "当前阶段改为降级执行"}；最近一次模型健康校验失败，进入快速降级模式。`
      });
      return {
        ...degraded,
        title: `${degraded.title}（降级）`,
        body: [
          "## 降级说明",
          "- 原因: 最近一次模型健康校验失败，已进入快速降级窗口。",
          `- 上次校验时间: ${runtime.status.lastValidatedAt || "unknown"}`,
          `- 校验状态: ${runtime.status.lastValidationStatus || "unknown"}`,
          `- 校验错误: ${runtime.status.lastValidationError || "unknown"}`,
          "",
          degraded.body
        ].join("\n"),
        attempts: [],
        degraded: true
      };
    }

    const modelPlan = (await resolveRoleModelPlan(input.role, input.stageType, runtime.modelName, input.promptMode ?? "default"))
      .slice(0, resolveStageMaxModelsPerRun(input.stageType, input.role));
    const stageTimeoutMs = resolveStageTimeoutMs(input.stageType, input.role);
    const deadline = Date.now() + stageTimeoutMs;
    let lastError: unknown;

    for (const model of modelPlan) {
      const remainingMs = deadline - Date.now();
      if (remainingMs < MIN_ATTEMPT_BUDGET_MS) {
        trackAttempt({
          model,
          route: "stage-budget-guard",
          status: "skipped",
          startedAtMs: Date.now(),
          error: `INSUFFICIENT_STAGE_BUDGET: remaining=${remainingMs}ms`
        });
        break;
      }

      if (isAnthropicModel(model)) {
        const routes = await resolveAnthropicExecutionConfigs({
          runtimeApiBaseUrl: runtime.apiBaseUrl,
          runtimeApiKey: runtime.apiKey
        });
        for (const route of routes) {
          const routeLabel = toRouteLabel(route);
          const routeRemainingMs = deadline - Date.now();
          if (routeRemainingMs < MIN_ATTEMPT_BUDGET_MS) {
            trackAttempt({
              model,
              route: routeLabel,
              status: "skipped",
              startedAtMs: Date.now(),
              error: `INSUFFICIENT_ROUTE_BUDGET: remaining=${routeRemainingMs}ms`
            });
            break;
          }
          const cooldownError = getModelRouteCooldownError(model, routeLabel);
          if (cooldownError) {
            trackAttempt({
              model,
              route: routeLabel,
              status: "skipped",
              startedAtMs: Date.now(),
              error: cooldownError
            });
            continue;
          }
          const prewarmError = await getRoutePrewarmError(route, model, routeRemainingMs);
          if (prewarmError) {
            trackAttempt({
              model,
              route: routeLabel,
              status: "skipped",
              startedAtMs: Date.now(),
              error: prewarmError
            });
            continue;
          }
          const startedAtMs = Date.now();
          try {
            const attemptTimeoutMs = resolveSingleAttemptTimeoutMs(input.role, input.stageType, routeRemainingMs);
            const run = await withTimeout(
              runAnthropicCompatibleAgent(
                {
                  apiBaseUrl: route.apiBaseUrl,
                  apiKey: route.apiKey,
                  model
                },
                {
                  ...input,
                  requestTimeoutMs: attemptTimeoutMs
                }
              ),
              routeRemainingMs,
              `anthropic:${model}@${route.source}`,
              attemptTimeoutMs
            );
            trackAttempt({ model, route: routeLabel, status: "success", startedAtMs });
            return { ...run, attempts };
          } catch (error) {
            lastError = error;
            markModelRouteCooldown(model, routeLabel, error);
            trackAttempt({ model, route: routeLabel, status: "failed", startedAtMs, error });
          }
        }
        continue;
      }

      if (isKimiModel(model)) {
        const routes = await resolveKimiExecutionConfigs({
          runtimeApiBaseUrl: runtime.apiBaseUrl,
          runtimeApiKey: runtime.apiKey
        });
        for (const route of routes) {
          const routeLabel = toRouteLabel(route);
          const routeRemainingMs = deadline - Date.now();
          if (routeRemainingMs < MIN_ATTEMPT_BUDGET_MS) {
            trackAttempt({
              model,
              route: routeLabel,
              status: "skipped",
              startedAtMs: Date.now(),
              error: `INSUFFICIENT_ROUTE_BUDGET: remaining=${routeRemainingMs}ms`
            });
            break;
          }
          const cooldownError = getModelRouteCooldownError(model, routeLabel);
          if (cooldownError) {
            trackAttempt({
              model,
              route: routeLabel,
              status: "skipped",
              startedAtMs: Date.now(),
              error: cooldownError
            });
            continue;
          }
          const prewarmError = await getRoutePrewarmError(route, model, routeRemainingMs);
          if (prewarmError) {
            trackAttempt({
              model,
              route: routeLabel,
              status: "skipped",
              startedAtMs: Date.now(),
              error: prewarmError
            });
            continue;
          }
          const startedAtMs = Date.now();
          try {
            const attemptTimeoutMs = resolveSingleAttemptTimeoutMs(input.role, input.stageType, routeRemainingMs);
            const run = await withTimeout(
              runOpenAICompatibleAgent(
                {
                  apiBaseUrl: route.apiBaseUrl,
                  apiKey: route.apiKey,
                  model
                },
                {
                  ...input,
                  requestTimeoutMs: attemptTimeoutMs
                }
              ),
              routeRemainingMs,
              `openai-compatible:${model}@${route.source}`,
              attemptTimeoutMs
            );
            trackAttempt({ model, route: routeLabel, status: "success", startedAtMs });
            return { ...run, attempts };
          } catch (error) {
            lastError = error;
            markModelRouteCooldown(model, routeLabel, error);
            trackAttempt({ model, route: routeLabel, status: "failed", startedAtMs, error });
          }
        }
        continue;
      }

      if (isOpenAIModel(model)) {
        const routes = await resolveOpenAIExecutionConfigs({
          model,
          runtimeApiBaseUrl: runtime.apiBaseUrl,
          runtimeApiKey: runtime.apiKey
        });
        for (const route of routes) {
          const routeLabel = toRouteLabel(route);
          const routeRemainingMs = deadline - Date.now();
          if (routeRemainingMs < MIN_ATTEMPT_BUDGET_MS) {
            trackAttempt({
              model,
              route: routeLabel,
              status: "skipped",
              startedAtMs: Date.now(),
              error: `INSUFFICIENT_ROUTE_BUDGET: remaining=${routeRemainingMs}ms`
            });
            break;
          }
          const cooldownError = getModelRouteCooldownError(model, routeLabel);
          if (cooldownError) {
            trackAttempt({
              model,
              route: routeLabel,
              status: "skipped",
              startedAtMs: Date.now(),
              error: cooldownError
            });
            continue;
          }
          const prewarmError = await getRoutePrewarmError(route, model, routeRemainingMs);
          if (prewarmError) {
            trackAttempt({
              model,
              route: routeLabel,
              status: "skipped",
              startedAtMs: Date.now(),
              error: prewarmError
            });
            continue;
          }
          const startedAtMs = Date.now();
          try {
            const attemptTimeoutMs = resolveSingleAttemptTimeoutMs(input.role, input.stageType, routeRemainingMs);
            const run = await withTimeout(
              runOpenAICompatibleAgent(
                {
                  apiBaseUrl: route.apiBaseUrl,
                  apiKey: route.apiKey,
                  model
                },
                {
                  ...input,
                  requestTimeoutMs: attemptTimeoutMs
                }
              ),
              routeRemainingMs,
              `openai-compatible:${model}@${route.source}`,
              attemptTimeoutMs
            );
            trackAttempt({ model, route: routeLabel, status: "success", startedAtMs });
            return { ...run, attempts };
          } catch (error) {
            lastError = error;
            markModelRouteCooldown(model, routeLabel, error);
            trackAttempt({ model, route: routeLabel, status: "failed", startedAtMs, error });
          }
        }
        continue;
      }

      const runtimeRouteLabel = "runtime-selected";
      const cooldownError = getModelRouteCooldownError(model, runtimeRouteLabel);
      if (cooldownError) {
        trackAttempt({
          model,
          route: runtimeRouteLabel,
          status: "skipped",
          startedAtMs: Date.now(),
          error: cooldownError
        });
        continue;
      }
      const runtimeRoute: ExecutionRoute = {
        source: "runtime-selected",
        apiBaseUrl: runtime.apiBaseUrl,
        apiKey: runtime.apiKey
      };
      const prewarmError = await getRoutePrewarmError(runtimeRoute, model, remainingMs);
      if (prewarmError) {
        trackAttempt({
          model,
          route: runtimeRouteLabel,
          status: "skipped",
          startedAtMs: Date.now(),
          error: prewarmError
        });
        continue;
      }
      const startedAtMs = Date.now();
      try {
        const attemptTimeoutMs = resolveSingleAttemptTimeoutMs(input.role, input.stageType, remainingMs);
        const run = await withTimeout(
          runOpenAICompatibleAgent(
            {
              apiBaseUrl: runtime.apiBaseUrl,
              apiKey: runtime.apiKey,
              model
            },
            {
              ...input,
              requestTimeoutMs: attemptTimeoutMs
            }
          ),
          remainingMs,
          `openai-compatible:${model}@runtime-selected`,
          attemptTimeoutMs
        );
        trackAttempt({ model, route: runtimeRouteLabel, status: "success", startedAtMs });
        return { ...run, attempts };
      } catch (error) {
        lastError = error;
        markModelRouteCooldown(model, runtimeRouteLabel, error);
        trackAttempt({ model, route: runtimeRouteLabel, status: "failed", startedAtMs, error });
      }
    }

    if (!lastError) {
      const lastAttemptError = [...attempts].reverse().find((attempt) => String(attempt.error || "").trim())?.error;
      if (lastAttemptError) {
        lastError = new Error(String(lastAttemptError));
      }
    }

    // 保底降级：避免阶段推进长时间阻塞，至少保证流程可继续并可审阅。
    if (enforceRealModelGate) {
      const gateError = new Error(
        `REAL_MODEL_GATE_FAILED: 真实模型调用失败（${lastError instanceof Error ? lastError.message : String(lastError ?? "unknown error")}）。`
      ) as Error & { attempts?: StageModelAttemptTrace[] };
      gateError.attempts = attempts;
      throw gateError;
    }

    const degraded = await runScriptedAgent({
      ...input,
      summary: `${input.summary ?? "当前阶段改为降级执行"}；真实模型调用超时或失败。`
    });
    void markRuntimeExecutionFailed(lastError);
    return {
      ...degraded,
      title: `${degraded.title}（降级）`,
      body: [
        "## 降级说明",
        `- 原因: 真实模型调用超时或失败（${lastError instanceof Error ? lastError.message : String(lastError ?? "unknown error")}）`,
        `- 超时预算: ${stageTimeoutMs}ms，候选模型数: ${modelPlan.length}`,
        `- 失败尝试次数: ${attempts.filter((item) => item.status === "failed").length}`,
        "- 处理: 已使用本地降级 Agent 生成可继续执行的交付内容。",
        "",
        degraded.body
      ].join("\n"),
      thinkingSummary: `${degraded.thinkingSummary}（真实模型不可用，已自动降级）`,
      attempts,
      degraded: true
    };
  }

  if (enforceRealModelGate && !allowInitScriptedBootstrap) {
    throw new Error("REAL_MODEL_GATE_FAILED: 当前运行模式为 scripted，未满足真实模型门禁要求。");
  }

  const scripted = await runScriptedAgent(input);
  return {
    ...scripted,
    attempts
  };
}

function shouldFastFailRealRuntime(
  lastValidationStatus: string | null | undefined,
  lastValidatedAt: string | null | undefined,
  lastValidationError: string | null | undefined
) {
  if (String(lastValidationStatus || "").toLowerCase() !== "failed") {
    return false;
  }
  const message = String(lastValidationError || "").trim().toLowerCase();
  const permanentFailure = /auth_|unauthorized|invalid api key|forbidden|配置不完整|not configured|缺少 api|401|403/.test(message);
  if (!permanentFailure) {
    return false;
  }
  const timestamp = Date.parse(String(lastValidatedAt || ""));
  if (!Number.isFinite(timestamp)) {
    return true;
  }
  return Date.now() - timestamp <= REAL_RUNTIME_FAIL_FAST_WINDOW_MS;
}

async function markRuntimeExecutionFailed(error: unknown) {
  if (process.env.NODE_ENV === "test") {
    return;
  }
  if (String(process.env.RUNTIME_SKIP_FAILURE_PERSIST ?? "").trim().toLowerCase() === "true") {
    return;
  }
  const message = normalizeErrorMessage(error || "模型调用失败，已自动降级。");
  try {
    await prisma.systemConfig.update({
      where: { id: "default" },
      data: {
        lastValidatedAt: new Date(),
        lastValidationStatus: "failed",
        lastValidationError: message.slice(0, 500)
      }
    });
  } catch {
    // ignore
  }
}

export async function getRuntimeStatus() {
  return readRuntimeStatus();
}

export function getStageModelPolicy() {
  return {
    limits: {
      maxModelsPerStageRun: STAGE_AGENT_MAX_MODELS,
      designMaxModelsPerStageRun: STAGE_AGENT_MAX_MODELS_DESIGN,
      stageTotalTimeoutMs: STAGE_AGENT_TOTAL_TIMEOUT_MS,
      stageTimeouts: {
        INIT: resolveStageTimeoutMs("INIT"),
        ANALYSIS: resolveStageTimeoutMs("ANALYSIS"),
        DESIGN: resolveStageTimeoutMs("DESIGN"),
        DEV: resolveStageTimeoutMs("DEV"),
        ACCEPT: resolveStageTimeoutMs("ACCEPT")
      }
    },
    stagePreferences: STAGE_MODEL_PREFERENCES,
    stageRationale: STAGE_MODEL_RATIONALE,
    designPolicy: {
      primary: DESIGN_MODEL_PRIMARY,
      chain: [...DESIGN_MODEL_POLICY_CHAIN]
    }
  };
}

export async function previewStageModelPlan(input?: {
  role?: RoleType;
  stageType?: StageType;
}) {
  const runtime = await getResolvedRuntimeExecutionConfig();
  const role = (input?.role ?? "ROLE_DESIGN") as RoleType;
  const stageType = (input?.stageType ?? "DESIGN") as StageType;
  const plan = await resolveRoleModelPlan(role, stageType, runtime.modelName);
  return {
    role,
    stageType,
    runtimeModel: runtime.modelName,
    plan
  };
}

export async function getStageModelUsage(input?: {
  lookbackHours?: number;
  limit?: number;
}) {
  const lookbackHours = Math.max(1, Math.min(24 * 14, Number(input?.lookbackHours ?? 24)));
  const limit = Math.max(20, Math.min(3000, Number(input?.limit ?? 600)));
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
  const rows = await prisma.projectExecution.findMany({
    where: {
      status: "success",
      createdAt: { gte: since }
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      stageType: true,
      model: true,
      createdAt: true
    }
  });

  const stages = (["INIT", "ANALYSIS", "DESIGN", "DEV", "ACCEPT"] as StageType[]).reduce<Record<StageType, {
    total: number;
    recommended: string[];
    preferredHitCount: number;
    preferredHitRate: number;
    models: Array<{ model: string; count: number }>;
  }>>((acc, stage) => {
    acc[stage] = {
      total: 0,
      recommended: [...(STAGE_MODEL_PREFERENCES[stage] || [])],
      preferredHitCount: 0,
      preferredHitRate: 0,
      models: []
    };
    return acc;
  }, {} as Record<StageType, {
    total: number;
    recommended: string[];
    preferredHitCount: number;
    preferredHitRate: number;
    models: Array<{ model: string; count: number }>;
  }>);

  const modelCounters = new Map<StageType, Map<string, number>>();
  for (const stage of Object.keys(stages) as StageType[]) {
    modelCounters.set(stage, new Map());
  }

  for (const row of rows) {
    const stage = normalizeStageType(row.stageType);
    if (!stage) {
      continue;
    }

    const model = String(row.model ?? "").trim() || "unknown";
    const counters = modelCounters.get(stage);
    if (!counters) {
      continue;
    }

    counters.set(model, (counters.get(model) ?? 0) + 1);
    stages[stage].total += 1;
    if ((STAGE_MODEL_PREFERENCES[stage] || []).slice(0, 2).includes(model)) {
      stages[stage].preferredHitCount += 1;
    }
  }

  for (const stage of Object.keys(stages) as StageType[]) {
    const counters = modelCounters.get(stage) ?? new Map<string, number>();
    stages[stage].models = [...counters.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([model, count]) => ({ model, count }));
    stages[stage].preferredHitRate = stages[stage].total > 0
      ? Number((stages[stage].preferredHitCount / stages[stage].total).toFixed(4))
      : 0;
  }

  return {
    lookbackHours,
    since: since.toISOString(),
    sampledExecutions: rows.length,
    stages
  };
}

async function resolveRoleModelPlan(
  role: RoleType,
  stageType: StageType,
  runtimeModel: string,
  promptMode: "default" | "issue_debate" = "default"
) {
  const models: string[] = [];
  let managedSelectedModel = "";
  let managedFallbackModel = "";
  const designPhase = stageType === "DESIGN" || role === "ROLE_DESIGN";
  const isDesignBlockedModel = (model: string) => /(^|[/:])claude-opus-4-6($|[\s@])/i.test(model);
  const push = (value?: string | null) => {
    const normalized = String(value ?? "").trim();
    if (!normalized || models.includes(normalized)) {
      return;
    }
    if (isRuntimeDisabledModel(normalized)) {
      return;
    }
    if (designPhase && isDesignBlockedModel(normalized)) {
      return;
    }
    models.push(normalized);
  };

  // 1) 角色专属配置（Agent Config）
  try {
    const agentIds = Array.from(
      new Set([role, ROLE_MANAGED_AGENT_ALIASES[role]].filter((value): value is string => Boolean(value)))
    );
    const managed = await prisma.managedAgentConfig.findFirst({
      where: { agentId: { in: agentIds } },
      orderBy: { updatedAt: "desc" },
      select: { selectedModel: true, fallbackModel: true }
    });
    managedSelectedModel = await normalizeConfiguredModelRef(managed?.selectedModel);
    managedFallbackModel = await normalizeConfiguredModelRef(managed?.fallbackModel);
  } catch {
    // ignore database read errors and continue with runtime/env fallbacks
  }

  if (designPhase) {
    // 设计阶段优先固定“设计能力最强模型链”，再考虑角色/运行时覆盖，避免落到弱模型。
    push(process.env.DESIGN_MODEL || DESIGN_MODEL_PRIMARY);
    for (const model of DESIGN_MODEL_POLICY_CHAIN) {
      push(model);
    }
    push(process.env.DESIGN_FALLBACK_MODEL);
  }

  // 1) 角色专属配置优先，显式 Agent 模型选择不应被阶段默认策略覆盖。
  push(managedSelectedModel);

  // 2) Issue 真实讨论优先模型能力链（基于当前可用性策略）。
  if (promptMode === "issue_debate") {
    for (const preferredModel of ISSUE_DEBATE_MODEL_PREFERENCES) {
      push(preferredModel);
    }
    push(runtimeModel);
    push(managedFallbackModel);
    push(process.env.OPENAI_RUNTIME_FALLBACK_MODEL);
    const maxIssueDebateModels = Math.max(2, Number(process.env.ISSUE_DEBATE_MAX_MODELS ?? 4));
    return models.slice(0, maxIssueDebateModels);
  }

  // 3) 阶段级策略优先，确保自动推进优先命中稳定可用的真实模型链。
  for (const preferredModel of STAGE_MODEL_PREFERENCES[stageType] || []) {
    push(preferredModel);
  }

  // 4) 运行时显式模型作为补位，避免全局 runtime 配置覆盖阶段策略导致卡在不可用通道。
  push(runtimeModel);

  // 5) 角色兜底模型
  push(managedFallbackModel);

  // 6) 通用兜底
  push(process.env.OPENAI_RUNTIME_FALLBACK_MODEL);
  push("qwen3-coder-plus");
  if (designPhase) {
    // DESIGN 兜底按当前可用能力排序：Kimi（可稳定产出）优先于 MiniMax（当前多次空内容）。
    push("kimi-k2.5");
    push("minima/MiniMax-M2.7-highspeed");
  } else {
    push("minima/MiniMax-M2.7-highspeed");
    push("kimi-k2.5");
  }

  return models;
}

async function normalizeConfiguredModelRef(value?: string | null) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }

  try {
    const model = await prisma.model.findFirst({
      where: {
        OR: [{ id: normalized }, { name: normalized }]
      },
      select: { name: true }
    });
    return String(model?.name ?? normalized).trim();
  } catch {
    return normalized;
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  maxBudgetMs = MAX_SINGLE_ATTEMPT_TIMEOUT_MS
): Promise<T> {
  const budget = Math.max(
    MIN_ATTEMPT_BUDGET_MS,
    Math.min(timeoutMs, maxBudgetMs)
  );
  let timer: ReturnType<typeof setTimeout> | null = null;
  const taskResult = promise.then(
    (value) => ({ type: "task" as const, ok: true as const, value }),
    (error) => ({ type: "task" as const, ok: false as const, error })
  );
  const timeoutPromise = new Promise<{ type: "timeout" }>((resolve) => {
    timer = setTimeout(() => {
      resolve({ type: "timeout" });
    }, budget);
  });

  try {
    const winner = await Promise.race([taskResult, timeoutPromise] as const);
    if (winner.type === "timeout") {
      void taskResult.then((late) => {
        if (!late.ok) {
          const lateMessage = late.error instanceof Error ? late.error.message : String(late.error);
          console.warn(`[runtime.withTimeout] late rejection after timeout ignored: ${lateMessage}`);
        }
      });
      throw new Error(`MODEL_ATTEMPT_TIMEOUT: ${label} exceeded ${budget}ms`);
    }
    if (!winner.ok) {
      throw winner.error;
    }
    return winner.value;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function isAnthropicModel(model: string) {
  const normalized = String(model ?? "").trim().toLowerCase();
  return normalized.startsWith("anthropic/") || normalized.startsWith("claude-");
}

function isKimiModel(model: string) {
  const normalized = String(model ?? "").trim().toLowerCase();
  return normalized.startsWith("kimi-")
    || normalized.includes("/kimi-")
    || normalized.includes("moonshot");
}

function isOpenAIModel(model: string) {
  const normalized = String(model ?? "").trim().toLowerCase();
  return normalized.startsWith("openai/")
    || normalized.startsWith("gpt-");
}

function requiresStreamMode(model: string) {
  const normalized = normalizeRuntimeModelName(model).toLowerCase();
  return normalized.startsWith("gpt-5.4") || normalized.startsWith("gpt-5.3-codex");
}

type OpenClawRuntimeConfig = {
  env?: Record<string, string>;
  models?: {
    providers?: Record<string, { baseUrl?: string; apiKey?: string }>;
  };
};

type AnthropicExecutionConfigInput = {
  runtimeApiBaseUrl: string;
  runtimeApiKey: string;
};

type OpenAIExecutionConfigInput = {
  model: string;
  runtimeApiBaseUrl: string;
  runtimeApiKey: string;
};

async function resolveOpenAIExecutionConfigs(input: OpenAIExecutionConfigInput): Promise<ExecutionRoute[]> {
  const config = await readOpenClawRuntimeConfig();
  const provider = config.models?.providers?.openai;
  const requestedModel = String(input.model ?? "").trim().toLowerCase();
  const prefersDirectOpenAI = requestedModel.startsWith("gpt-") || requestedModel.startsWith("openai/gpt-");
  const envOpenAiKey = String(process.env.OPENAI_API_KEY ?? "").trim()
    || String(config.env?.OPENAI_API_KEY ?? "").trim();
  const envOpenAiBaseUrl = String(process.env.OPENAI_BASE_URL ?? "").trim()
    || String(process.env.OPENAI_API_BASE_URL ?? "").trim()
    || String(config.env?.OPENAI_BASE_URL ?? "").trim()
    || String(config.env?.OPENAI_API_BASE_URL ?? "").trim();
  const officialOpenAiBaseUrl = "https://api.openai.com/v1";
  const effectiveEnvOpenAiBaseUrl = envOpenAiBaseUrl || (envOpenAiKey ? officialOpenAiBaseUrl : "");
  const routePriority = String(process.env.OPENAI_ROUTE_PRIORITY ?? "runtime-first").trim().toLowerCase();

  const runtimeRoute: ExecutionRoute = {
    source: "runtime-selected",
    apiBaseUrl: String(input.runtimeApiBaseUrl ?? "").trim(),
    apiKey: String(input.runtimeApiKey ?? "").trim()
  };
  const openclawRoute: ExecutionRoute = {
    source: "openclaw-openai",
    apiBaseUrl: String(provider?.baseUrl ?? "").trim(),
    apiKey: String(provider?.apiKey ?? "").trim()
      || String(config.env?.OPENAI_API_KEY ?? "").trim()
      || String(process.env.OPENAI_API_KEY ?? "").trim()
  };
  const directRoutes: ExecutionRoute[] = [
    {
      source: "env-openai",
      apiBaseUrl: effectiveEnvOpenAiBaseUrl,
      apiKey: envOpenAiKey
    },
    ...(effectiveEnvOpenAiBaseUrl && effectiveEnvOpenAiBaseUrl !== officialOpenAiBaseUrl ? [{
      source: "official-openai",
      apiBaseUrl: officialOpenAiBaseUrl,
      apiKey: envOpenAiKey
    }] : [])
  ];

  const routes: ExecutionRoute[] = prefersDirectOpenAI
    ? (routePriority === "env-first"
      ? [...directRoutes, runtimeRoute, openclawRoute]
      : [runtimeRoute, ...directRoutes, openclawRoute])
    : [runtimeRoute, ...directRoutes, openclawRoute];

  return dedupeExecutionRoutes(routes);
}

async function resolveAnthropicExecutionConfigs(input: AnthropicExecutionConfigInput): Promise<ExecutionRoute[]> {
  const config = await readOpenClawRuntimeConfig();
  const provider = config.models?.providers?.anthropic;
  const routes: ExecutionRoute[] = [
    {
      source: "openclaw-anthropic",
      apiBaseUrl: String(provider?.baseUrl ?? "").trim(),
      apiKey: String(provider?.apiKey ?? "").trim() || String(process.env.ANTHROPIC_API_KEY ?? "").trim()
    },
    {
      source: "runtime-selected",
      apiBaseUrl: String(input.runtimeApiBaseUrl ?? "").trim(),
      apiKey: String(input.runtimeApiKey ?? "").trim()
    }
  ];
  return dedupeExecutionRoutes(routes);
}

type KimiExecutionConfigInput = {
  runtimeApiBaseUrl: string;
  runtimeApiKey: string;
};

async function resolveKimiExecutionConfigs(input: KimiExecutionConfigInput): Promise<ExecutionRoute[]> {
  const config = await readOpenClawRuntimeConfig();
  const provider = config.models?.providers?.kimi;
  const routes: ExecutionRoute[] = [
    {
      source: "openclaw-kimi",
      apiBaseUrl: String(provider?.baseUrl ?? "").trim(),
      apiKey: String(provider?.apiKey ?? "").trim() || String(process.env.KIMI_API_KEY ?? "").trim()
    },
    {
      source: "runtime-selected",
      apiBaseUrl: String(input.runtimeApiBaseUrl ?? "").trim(),
      apiKey: String(input.runtimeApiKey ?? "").trim()
    }
  ];
  return dedupeExecutionRoutes(routes);
}

async function readOpenClawRuntimeConfig(): Promise<OpenClawRuntimeConfig> {
  try {
    const configRaw = await readFile(OPENCLAW_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(configRaw) as OpenClawRuntimeConfig;
    return normalizeOpenClawProviderApis(parsed).config as OpenClawRuntimeConfig;
  } catch {
    return {};
  }
}

function dedupeExecutionRoutes(routes: ExecutionRoute[]) {
  const seen = new Set<string>();
  const result: ExecutionRoute[] = [];
  for (const route of routes) {
    const apiBaseUrl = String(route.apiBaseUrl ?? "").trim();
    const apiKey = String(route.apiKey ?? "").trim();
    if (!apiBaseUrl || !apiKey) {
      continue;
    }
    const dedupeKey = `${apiBaseUrl}::${apiKey.slice(0, 16)}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    result.push({
      source: route.source,
      apiBaseUrl,
      apiKey
    });
  }
  return result;
}

function toRouteLabel(route: ExecutionRoute) {
  const baseUrl = String(route.apiBaseUrl || "").replace(/\/$/, "");
  const host = baseUrl.replace(/^https?:\/\//i, "");
  return `${route.source}@${host || "unknown-host"}`;
}

function normalizeErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? "unknown error");
  const normalized = raw.replace(/\s+/g, " ").trim();
  return normalized.length > 260 ? `${normalized.slice(0, 260)}...` : normalized;
}

export function resolveStageTimeoutMs(stageType: StageType, role?: RoleType) {
  if (role) {
    const roleStageSpecific = Number(process.env[`STAGE_AGENT_TOTAL_TIMEOUT_${stageType}_${role}_MS`]);
    if (Number.isFinite(roleStageSpecific) && roleStageSpecific > 0) {
      return Math.max(MIN_ATTEMPT_BUDGET_MS, Math.round(roleStageSpecific));
    }
    const roleSpecific = Number(process.env[`STAGE_AGENT_TOTAL_TIMEOUT_${role}_MS`]);
    if (Number.isFinite(roleSpecific) && roleSpecific > 0) {
      return Math.max(MIN_ATTEMPT_BUDGET_MS, Math.round(roleSpecific));
    }
  }
  const stageSpecificEnv = Number(process.env[`STAGE_AGENT_TOTAL_TIMEOUT_${stageType}_MS`]);
  if (Number.isFinite(stageSpecificEnv) && stageSpecificEnv > 0) {
    return Math.max(MIN_ATTEMPT_BUDGET_MS, Math.round(stageSpecificEnv));
  }
  const roleBaseline = role ? (ROLE_STAGE_TIMEOUT_BASELINE_MS[role] ?? 0) : 0;
  return Math.max(STAGE_AGENT_TOTAL_TIMEOUT_MS, STAGE_TIMEOUT_BASELINE_MS[stageType], roleBaseline);
}

function resolveSingleAttemptTimeoutMs(role: RoleType, stageType: StageType, remainingMs: number) {
  const roleStageSpecific = Number(process.env[`STAGE_AGENT_SINGLE_ATTEMPT_TIMEOUT_${stageType}_${role}_MS`]);
  if (Number.isFinite(roleStageSpecific) && roleStageSpecific > 0) {
    return Math.max(MIN_ATTEMPT_BUDGET_MS, Math.min(remainingMs, Math.round(roleStageSpecific)));
  }

  const roleSpecific = Number(process.env[`STAGE_AGENT_SINGLE_ATTEMPT_TIMEOUT_${role}_MS`]);
  if (Number.isFinite(roleSpecific) && roleSpecific > 0) {
    return Math.max(MIN_ATTEMPT_BUDGET_MS, Math.min(remainingMs, Math.round(roleSpecific)));
  }

  const roleBaseline = ROLE_ATTEMPT_TIMEOUT_BASELINE_MS[role] ?? 0;
  return Math.max(
    MIN_ATTEMPT_BUDGET_MS,
    Math.min(remainingMs, Math.max(MAX_SINGLE_ATTEMPT_TIMEOUT_MS, roleBaseline))
  );
}

function normalizeStageType(value: string): StageType | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "INIT" || normalized === "ANALYSIS" || normalized === "DESIGN" || normalized === "DEV" || normalized === "ACCEPT") {
    return normalized;
  }
  return null;
}

function resolveStageMaxModelsPerRun(stageType: StageType, role: RoleType) {
  if (stageType === "DESIGN" || role === "ROLE_DESIGN") {
    return STAGE_AGENT_MAX_MODELS_DESIGN;
  }
  if (stageType === "DEV") {
    return Math.min(STAGE_AGENT_MAX_MODELS, 2);
  }
  return STAGE_AGENT_MAX_MODELS;
}
