import type { ParsedIntent, RoleType, StageType } from "@occ/shared";
import { runOpenAICompatibleAgent } from "./providers/openai-compatible-provider.js";
import { runScriptedAgent } from "./providers/scripted-provider.js";
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
    try {
      return await runOpenAICompatibleAgent(
        {
          apiBaseUrl: runtime.apiBaseUrl,
          apiKey: runtime.apiKey,
          model: runtime.modelName
        },
        input
      );
    } catch (error) {
      console.warn("Falling back to scripted runtime:", error);
    }
  }

  return runScriptedAgent(input);
}

export async function getRuntimeStatus() {
  return readRuntimeStatus();
}
