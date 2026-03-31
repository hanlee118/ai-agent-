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

const STAGE_AGENT_MAX_MODELS = Math.max(1, Number(process.env.STAGE_AGENT_MAX_MODELS ?? 3));
const STAGE_AGENT_TOTAL_TIMEOUT_MS = Math.max(12000, Number(process.env.STAGE_AGENT_TOTAL_TIMEOUT_MS ?? 35000));
const MIN_ATTEMPT_BUDGET_MS = 8000;
const MAX_SINGLE_ATTEMPT_TIMEOUT_MS = Math.max(
  MIN_ATTEMPT_BUDGET_MS,
  Number(process.env.STAGE_AGENT_SINGLE_ATTEMPT_TIMEOUT_MS ?? 12000)
);
const STAGE_TIMEOUT_BASELINE_MS: Record<StageType, number> = {
  INIT: 30000,
  ANALYSIS: 40000,
  DESIGN: 45000,
  DEV: 40000,
  ACCEPT: 30000
};
const ROUTE_TIMEOUT_COOLDOWN_MS = Math.max(30000, Number(process.env.MODEL_ROUTE_TIMEOUT_COOLDOWN_MS ?? 180000));
const ROUTE_AUTH_COOLDOWN_MS = Math.max(60000, Number(process.env.MODEL_ROUTE_AUTH_COOLDOWN_MS ?? 900000));
const ROUTE_NETWORK_COOLDOWN_MS = Math.max(30000, Number(process.env.MODEL_ROUTE_NETWORK_COOLDOWN_MS ?? 300000));
const REAL_RUNTIME_FAIL_FAST_WINDOW_MS = Math.max(
  60000,
  Number(process.env.REAL_RUNTIME_FAIL_FAST_WINDOW_MS ?? 600000)
);
const modelRouteCooldown = new Map<string, number>();

const STAGE_MODEL_PREFERENCES: Record<StageType, string[]> = {
  INIT: ["openai/gpt-5.4", "openai/gpt-5.3-codex", "minima/MiniMax-M2.7-highspeed"],
  ANALYSIS: ["openai/gpt-5.4", "openai/gpt-5.3-codex", "kimi-k2.5", "minima/MiniMax-M2.7-highspeed"],
  DESIGN: ["openai/gpt-5.4", "openai/gpt-5.3-codex", "kimi-k2.5", "qwen3-coder-plus"],
  DEV: ["openai/gpt-5.3-codex", "qwen3-coder-plus", "openai/gpt-5.4", "minima/MiniMax-M2.7-highspeed"],
  ACCEPT: ["openai/gpt-5.4", "openai/gpt-5.3-codex", "minima/MiniMax-M2.7-highspeed", "kimi-k2.5"]
};

const STAGE_MODEL_RATIONALE: Record<StageType, { objective: string; bestFit: string }> = {
  INIT: {
    objective: "快速理解需求与项目初始化。",
    bestFit: "openai/gpt-5.4（高质量理解） -> openai/gpt-5.3-codex（稳定补位）"
  },
  ANALYSIS: {
    objective: "抽取约束/风险/验收标准，形成可执行分析。",
    bestFit: "openai/gpt-5.4（复杂分析） -> openai/gpt-5.3-codex/kimi-k2.5（补位）"
  },
  DESIGN: {
    objective: "输出高质量视觉与交互策略，避免模板化设计。",
    bestFit: "openai/gpt-5.4（首选设计质量） -> openai/gpt-5.3-codex -> kimi-k2.5"
  },
  DEV: {
    objective: "面向实现落地，强调代码可执行性和稳定性。",
    bestFit: "openai/gpt-5.3-codex（代码导向） -> qwen3-coder-plus -> openai/gpt-5.4"
  },
  ACCEPT: {
    objective: "验收复盘与质量关口确认。",
    bestFit: "openai/gpt-5.4（总结评审） -> openai/gpt-5.3-codex（补位）"
  }
};

type StageModelAttemptStatus = "success" | "failed" | "skipped";

export type StageModelAttemptTrace = {
  stageType: StageType;
  role: RoleType;
  model: string;
  route: string;
  status: StageModelAttemptStatus;
  elapsedMs: number;
  startedAt: string;
  error?: string;
};

export type StageAgentRunResult = AgentRunResult & {
  attempts: StageModelAttemptTrace[];
  degraded?: boolean;
};

type ExecutionRoute = {
  source: string;
  apiBaseUrl: string;
  apiKey: string;
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

function getRouteOnlyKey(route: string) {
  return getModelRouteKey("*", route);
}

function getModelRouteCooldownError(model: string, route: string) {
  const keys = [getModelRouteKey(model, route), getRouteOnlyKey(route)];
  for (const key of keys) {
    const blockedUntil = modelRouteCooldown.get(key);
    if (!blockedUntil) {
      continue;
    }
    if (blockedUntil <= Date.now()) {
      modelRouteCooldown.delete(key);
      continue;
    }
    return `ROUTE_COOLDOWN_ACTIVE: retryAfterMs=${blockedUntil - Date.now()}`;
  }
  return null;
}

function markModelRouteCooldown(model: string, route: string, error: unknown) {
  const message = normalizeErrorMessage(error).toUpperCase();
  let ttlMs = 0;

  if (message.includes("AUTH_401") || message.includes("UNAUTHORIZED") || message.includes("INVALID API KEY")) {
    ttlMs = ROUTE_AUTH_COOLDOWN_MS;
  } else if (message.includes("MODEL_ATTEMPT_TIMEOUT") || message.includes("ETIMEOUT") || message.includes("TIMED OUT")) {
    ttlMs = ROUTE_TIMEOUT_COOLDOWN_MS;
  } else if (message.includes("ENOTFOUND") || message.includes("ECONNREFUSED") || message.includes("ECONNRESET")) {
    ttlMs = ROUTE_NETWORK_COOLDOWN_MS;
  }

  if (ttlMs <= 0) {
    return;
  }

  const blockedUntil = Date.now() + ttlMs;
  modelRouteCooldown.set(getModelRouteKey(model, route), blockedUntil);
  modelRouteCooldown.set(getRouteOnlyKey(route), blockedUntil);
}

export async function runStageAgent(input: {
  projectName: string;
  projectDescription: string;
  parsedIntent: ParsedIntent;
  stageType: StageType;
  role: RoleType;
  summary?: string;
}): Promise<StageAgentRunResult> {
  const runtime = await getResolvedRuntimeExecutionConfig();
  const requestedRealMode = runtime.status.requestedMode === "openai-compatible";
  const enforceRealModelGate = isRealModelGateEnabled();
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

    if (shouldFastFailRealRuntime(runtime.status.lastValidationStatus, runtime.status.lastValidatedAt)) {
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

    const modelPlan = (await resolveRoleModelPlan(input.role, input.stageType, runtime.modelName))
      .slice(0, STAGE_AGENT_MAX_MODELS);
    const stageTimeoutMs = resolveStageTimeoutMs(input.stageType);
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
          const startedAtMs = Date.now();
          try {
            const run = await withTimeout(
              runAnthropicCompatibleAgent(
                {
                  apiBaseUrl: route.apiBaseUrl,
                  apiKey: route.apiKey,
                  model
                },
                input
              ),
              routeRemainingMs,
              `anthropic:${model}@${route.source}`
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
          const startedAtMs = Date.now();
          try {
            const run = await withTimeout(
              runOpenAICompatibleAgent(
                {
                  apiBaseUrl: route.apiBaseUrl,
                  apiKey: route.apiKey,
                  model
                },
                input
              ),
              routeRemainingMs,
              `openai-compatible:${model}@${route.source}`
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
          const startedAtMs = Date.now();
          try {
            const run = await withTimeout(
              runOpenAICompatibleAgent(
                {
                  apiBaseUrl: route.apiBaseUrl,
                  apiKey: route.apiKey,
                  model
                },
                input
              ),
              routeRemainingMs,
              `openai-compatible:${model}@${route.source}`
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
      const startedAtMs = Date.now();
      try {
        const run = await withTimeout(
          runOpenAICompatibleAgent(
            {
              apiBaseUrl: runtime.apiBaseUrl,
              apiKey: runtime.apiKey,
              model
            },
            input
          ),
          remainingMs,
          `openai-compatible:${model}@runtime-selected`
        );
        trackAttempt({ model, route: runtimeRouteLabel, status: "success", startedAtMs });
        return { ...run, attempts };
      } catch (error) {
        lastError = error;
        markModelRouteCooldown(model, runtimeRouteLabel, error);
        trackAttempt({ model, route: runtimeRouteLabel, status: "failed", startedAtMs, error });
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

  if (enforceRealModelGate) {
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
  lastValidatedAt: string | null | undefined
) {
  if (String(lastValidationStatus || "").toLowerCase() !== "failed") {
    return false;
  }
  const timestamp = Date.parse(String(lastValidatedAt || ""));
  if (!Number.isFinite(timestamp)) {
    return true;
  }
  return Date.now() - timestamp <= REAL_RUNTIME_FAIL_FAST_WINDOW_MS;
}

async function markRuntimeExecutionFailed(error: unknown) {
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

async function resolveRoleModelPlan(role: RoleType, stageType: StageType, runtimeModel: string) {
  const models: string[] = [];
  let managedSelectedModel = "";
  let managedFallbackModel = "";
  const push = (value?: string | null) => {
    const normalized = String(value ?? "").trim();
    if (!normalized || models.includes(normalized)) {
      return;
    }
    models.push(normalized);
  };

  // 1) 角色专属配置（Agent Config）
  try {
    const managed = await prisma.managedAgentConfig.findUnique({
      where: { agentId: role },
      select: { selectedModel: true, fallbackModel: true }
    });
    managedSelectedModel = String(managed?.selectedModel ?? "").trim();
    managedFallbackModel = String(managed?.fallbackModel ?? "").trim();
  } catch {
    // ignore database read errors and continue with runtime/env fallbacks
  }

  push(managedSelectedModel);

  // 2) 运行时模型优先，避免在不可用通道上长时间阻塞。
  push(runtimeModel);

  // 3) 阶段级策略：按阶段推荐补充可选模型。
  for (const preferredModel of STAGE_MODEL_PREFERENCES[stageType] || []) {
    push(preferredModel);
  }

  if (role === "ROLE_DESIGN") {
    push(process.env.DESIGN_MODEL || DESIGN_MODEL_PRIMARY);
    for (const model of DESIGN_MODEL_POLICY_CHAIN) {
      push(model);
    }
    push(process.env.DESIGN_FALLBACK_MODEL);
  }

  // 4) 角色兜底模型
  push(managedFallbackModel);

  // 5) 通用兜底
  push(process.env.OPENAI_RUNTIME_FALLBACK_MODEL);
  push("qwen3-coder-plus");
  push("minima/MiniMax-M2.7-highspeed");
  push("kimi-k2.5");

  return models;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const budget = Math.max(
    MIN_ATTEMPT_BUDGET_MS,
    Math.min(timeoutMs, MAX_SINGLE_ATTEMPT_TIMEOUT_MS)
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`MODEL_ATTEMPT_TIMEOUT: ${label} exceeded ${budget}ms`));
    }, budget);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
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
  runtimeApiBaseUrl: string;
  runtimeApiKey: string;
};

async function resolveOpenAIExecutionConfigs(input: OpenAIExecutionConfigInput): Promise<ExecutionRoute[]> {
  const config = await readOpenClawRuntimeConfig();
  const provider = config.models?.providers?.openai;

  const routes: ExecutionRoute[] = [
    {
      source: "openclaw-openai",
      apiBaseUrl: String(provider?.baseUrl ?? "").trim(),
      apiKey: String(provider?.apiKey ?? "").trim()
        || String(config.env?.OPENAI_API_KEY ?? "").trim()
        || String(process.env.OPENAI_API_KEY ?? "").trim()
    },
    {
      source: "env-openai",
      apiBaseUrl: String(process.env.OPENAI_BASE_URL ?? "").trim(),
      apiKey: String(process.env.OPENAI_API_KEY ?? "").trim()
    },
    {
      source: "runtime-selected",
      apiBaseUrl: String(input.runtimeApiBaseUrl ?? "").trim(),
      apiKey: String(input.runtimeApiKey ?? "").trim()
    }
  ];

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
    return JSON.parse(configRaw) as OpenClawRuntimeConfig;
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

function resolveStageTimeoutMs(stageType: StageType) {
  const stageSpecificEnv = Number(process.env[`STAGE_AGENT_TOTAL_TIMEOUT_${stageType}_MS`]);
  if (Number.isFinite(stageSpecificEnv) && stageSpecificEnv > 0) {
    return Math.max(MIN_ATTEMPT_BUDGET_MS, Math.round(stageSpecificEnv));
  }
  return Math.max(STAGE_AGENT_TOTAL_TIMEOUT_MS, STAGE_TIMEOUT_BASELINE_MS[stageType]);
}

function normalizeStageType(value: string): StageType | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "INIT" || normalized === "ANALYSIS" || normalized === "DESIGN" || normalized === "DEV" || normalized === "ACCEPT") {
    return normalized;
  }
  return null;
}
