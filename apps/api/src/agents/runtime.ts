import type { ParsedIntent, RoleType, StageType } from "@occ/shared";
import { runOpenAICompatibleAgent } from "./providers/openai-compatible-provider.js";
import { runScriptedAgent } from "./providers/scripted-provider.js";
import { prisma } from "../db.js";
import {
  getResolvedRuntimeExecutionConfig,
  getRuntimeStatus as readRuntimeStatus
} from "../system/runtime-config.js";

export async function runStageAgent(input: {
  projectName: string;
  projectDescription: string;
  parsedIntent: ParsedIntent;
  stageType: StageType;
  role: RoleType;
  summary?: string;
}) {
  const runtime = await getResolvedRuntimeExecutionConfig();

  if (runtime.status.mode === "openai-compatible" && runtime.status.configured) {
    const modelPlan = await resolveRoleModelPlan(input.role, runtime.modelName);
    let lastError: unknown;

    for (const model of modelPlan) {
      try {
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

    if (lastError) {
      console.warn("Falling back to scripted runtime:", lastError);
    }
  }

  return runScriptedAgent(input);
}

export async function getRuntimeStatus() {
  return readRuntimeStatus();
}

async function resolveRoleModelPlan(role: RoleType, runtimeModel: string) {
  const models: string[] = [];
  const push = (value?: string | null) => {
    const normalized = String(value ?? "").trim();
    if (!normalized || models.includes(normalized)) {
      return;
    }
    models.push(normalized);
  };

  // 1) 优先读取角色专属模型配置（Agent Config）
  try {
    const managed = await prisma.managedAgentConfig.findUnique({
      where: { agentId: role },
      select: { selectedModel: true, fallbackModel: true }
    });
    push(managed?.selectedModel);
    push(managed?.fallbackModel);
  } catch {
    // ignore database read errors and continue with runtime/env fallbacks
  }

  // 2) 设计角色可使用独立模型路由
  if (role === "ROLE_DESIGN") {
    push("openai/gpt-5.4");
    push(process.env.DESIGN_MODEL);
    push(process.env.DESIGN_FALLBACK_MODEL);
  }

  // 3) 全局运行时模型 + 通用兜底
  push(runtimeModel);
  push(process.env.OPENAI_RUNTIME_FALLBACK_MODEL);
  push("minima/MiniMax-M2.7-highspeed");

  return models;
}
