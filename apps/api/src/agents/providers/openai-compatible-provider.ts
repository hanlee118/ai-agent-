import type { RuntimeMode } from "@occ/shared";
import { ROLE_LABELS, STAGE_LABELS } from "@occ/shared";
import type { AgentRunContext, AgentRunResult } from "./scripted-provider.js";

export interface OpenAICompatibleConfig {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
}

export async function runOpenAICompatibleAgent(
  config: OpenAICompatibleConfig,
  context: AgentRunContext
): Promise<AgentRunResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(`${config.apiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: [
              "你是 AI 协作工作台里的专业 Agent。",
              "你必须输出清晰、结构化、可执行的中文内容。",
              "不要自我介绍，不要写多余寒暄。",
              "请严格使用 Markdown。"
            ].join("\n")
          },
          {
            role: "user",
            content: [
              `项目名称：${context.projectName}`,
              `项目描述：${context.projectDescription}`,
              `当前阶段：${STAGE_LABELS[context.stageType]}`,
              `当前角色：${ROLE_LABELS[context.role]}`,
              `关键词：${context.parsedIntent.keywords.join(" / ") || "无"}`,
              `约束：${context.parsedIntent.constraints.join("；") || "无"}`,
              `风险：${context.parsedIntent.risks.join("；") || "无"}`,
              `补充摘要：${context.summary ?? "无"}`,
              "",
              "请输出以下结构：",
              `## ${STAGE_LABELS[context.stageType]}阶段执行纪要`,
              "- 4 到 6 条执行要点",
              "### 项目摘要",
              "- 一段简短总结",
              "### 下一步",
              "- 2 到 3 条具体动作"
            ].join("\n")
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Model request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("Model response did not include content");
    }

    return {
      provider: "openai-compatible" satisfies RuntimeMode,
      title: `${ROLE_LABELS[context.role]}正在推进${STAGE_LABELS[context.stageType]}阶段`,
      body: content,
      thinkingSummary: deriveThinkingSummary(content)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function deriveThinkingSummary(content: string) {
  const line = content
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.startsWith("- ") || item.startsWith("### "));

  if (!line) {
    return "模型已完成当前阶段草拟，建议结合交付物继续复核。";
  }

  return `模型已完成当前阶段草拟：${line.replace(/^- /, "").slice(0, 60)}`;
}
