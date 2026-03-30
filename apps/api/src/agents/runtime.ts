import type { ParsedIntent, RoleType, StageType } from "@occ/shared";
import { runOpenAICompatibleAgent } from "./providers/openai-compatible-provider.js";
import { runAnthropicCompatibleAgent } from "./providers/anthropic-compatible-provider.js";
import { runScriptedAgent } from "./providers/scripted-provider.js";
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

export async function runStageAgent(input: {
  projectName: string;
  projectDescription: string;
  parsedIntent: ParsedIntent;
  stageType: StageType;
  role: RoleType;
  summary?: string;
}) {
  const runtime = await getResolvedRuntimeExecutionConfig();
  const requestedRealMode = runtime.status.requestedMode === "openai-compatible";

  if (requestedRealMode) {
    if (!runtime.status.configured) {
      throw new Error("REAL_MODEL_NOT_CONFIGURED: 已启用真实模型模式，但配置不完整（缺少 API Base URL / API Key / Model）。");
    }

    const modelPlan = await resolveRoleModelPlan(input.role, runtime.modelName);
    let lastError: unknown;

    for (const model of modelPlan) {
      try {
        if (isAnthropicModel(model)) {
          const anthropic = await resolveAnthropicExecutionConfig({
            runtimeApiBaseUrl: runtime.apiBaseUrl,
            runtimeApiKey: runtime.apiKey
          });
          return await runAnthropicCompatibleAgent(
            {
              apiBaseUrl: anthropic.apiBaseUrl,
              apiKey: anthropic.apiKey,
              model
            },
            input
          );
        }

        return await runOpenAICompatibleAgent(
          {
            apiBaseUrl: runtime.apiBaseUrl,
            apiKey: runtime.apiKey,
            model
          },
          input
        );
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(
      `REAL_MODEL_EXECUTION_FAILED: 真实模型调用失败（role=${input.role}, stage=${input.stageType}）。` +
      ` ${lastError instanceof Error ? lastError.message : String(lastError ?? "unknown error")}`
    );
  }

  return runScriptedAgent(input);
}

export async function getRuntimeStatus() {
  return readRuntimeStatus();
}

async function resolveRoleModelPlan(role: RoleType, runtimeModel: string) {
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
  const pushWithOpenAICompatibleAlias = (value?: string | null) => {
    const normalized = String(value ?? "").trim();
    if (!normalized) {
      return;
    }

    push(normalized);
    const slashIndex = normalized.indexOf("/");
    if (slashIndex > 0 && slashIndex < normalized.length - 1) {
      push(normalized.slice(slashIndex + 1));
    }
  };

  // 1) 优先读取角色专属模型配置（Agent Config）
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

  // 2) 设计角色可使用独立模型路由
  if (role === "ROLE_DESIGN") {
    // 固化设计模型标准：主模型 + 备选模型按顺序执行
    pushWithOpenAICompatibleAlias(process.env.DESIGN_MODEL || DESIGN_MODEL_PRIMARY);
    for (const model of DESIGN_MODEL_POLICY_CHAIN) {
      pushWithOpenAICompatibleAlias(model);
    }
    pushWithOpenAICompatibleAlias(process.env.DESIGN_FALLBACK_MODEL);
    pushWithOpenAICompatibleAlias(managedSelectedModel);
    pushWithOpenAICompatibleAlias(managedFallbackModel);
  } else {
    pushWithOpenAICompatibleAlias(managedSelectedModel);
    pushWithOpenAICompatibleAlias(managedFallbackModel);
  }

  // 3) 全局运行时模型 + 通用兜底
  pushWithOpenAICompatibleAlias(runtimeModel);
  pushWithOpenAICompatibleAlias("qwen3-coder-plus");
  pushWithOpenAICompatibleAlias(process.env.OPENAI_RUNTIME_FALLBACK_MODEL);
  pushWithOpenAICompatibleAlias("minima/MiniMax-M2.7-highspeed");

  return models;
}

function isAnthropicModel(model: string) {
  const normalized = String(model ?? "").trim().toLowerCase();
  return normalized.startsWith("anthropic/") || normalized.startsWith("claude-");
}

type AnthropicExecutionConfigInput = {
  runtimeApiBaseUrl: string;
  runtimeApiKey: string;
};

async function resolveAnthropicExecutionConfig(input: AnthropicExecutionConfigInput) {
  if (input.runtimeApiBaseUrl && input.runtimeApiKey) {
    try {
      const configRaw = await readFile(OPENCLAW_CONFIG_PATH, "utf8");
      const parsed = JSON.parse(configRaw) as {
        models?: {
          providers?: {
            anthropic?: {
              baseUrl?: string;
              apiKey?: string;
            };
          };
        };
      };

      const anthropicBaseUrl = String(parsed?.models?.providers?.anthropic?.baseUrl ?? "").trim();
      const anthropicApiKey = String(parsed?.models?.providers?.anthropic?.apiKey ?? "").trim();
      if (anthropicBaseUrl && anthropicApiKey) {
        return {
          apiBaseUrl: anthropicBaseUrl,
          apiKey: anthropicApiKey
        };
      }
    } catch {
      // ignore and fall back to runtime credentials
    }
  }

  return {
    apiBaseUrl: input.runtimeApiBaseUrl,
    apiKey: input.runtimeApiKey
  };
}
