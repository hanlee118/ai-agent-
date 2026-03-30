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
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

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
              content: buildSystemPrompt(context)
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
                ...buildOutputGuidance(context)
              ].join("\n")
            }
          ]
        })
      });

      if (!response.ok) {
        if (attempt < 2 && isTransientStatus(response.status)) {
          await waitBeforeRetry(attempt);
          continue;
        }
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
        model: config.model,
        title: `${ROLE_LABELS[context.role]}正在推进${STAGE_LABELS[context.stageType]}阶段`,
        body: content,
        thinkingSummary: deriveThinkingSummary(content)
      };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const transientError = /aborted|timeout|timed out|fetch failed|network/i.test(message);
      if (attempt < 2 && transientError) {
        await waitBeforeRetry(attempt);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "model request failed"));
}

function isTransientStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function waitBeforeRetry(attempt: number) {
  const delayMs = Math.min(2500, attempt * 600);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
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

function buildSystemPrompt(context: AgentRunContext) {
  const base = [
    "你是 AI 协作工作台里的专业 Agent。",
    "你必须输出清晰、结构化、可执行的中文内容。",
    "不要自我介绍，不要写多余寒暄。",
    "请严格使用 Markdown。"
  ];

  if (context.role === "ROLE_DESIGN" || context.stageType === "DESIGN") {
    base.push("你是视觉设计总监，避免模板化页面，优先保证品牌辨识度、信息层级和可访问性。");
    base.push("输出必须包含视觉方向、版式策略、组件规范、CTA策略和无障碍检查项。");
  }

  return base.join("\n");
}

function buildOutputGuidance(context: AgentRunContext) {
  if (context.role === "ROLE_DESIGN" || context.stageType === "DESIGN") {
    return [
      "请输出以下结构：",
      "## 视觉策略",
      "- 视觉主题、品牌语气、主色与字体策略",
      "## 页面信息架构",
      "- 首屏/能力/流程/案例/CTA 的层级说明",
      "## 组件规范",
      "- 关键组件、状态与交互反馈",
      "## 设计审查卡",
      "- UX 原则（3条）",
      "- 可访问性检查清单（至少3条）",
      "- 审查结论（通过/不通过）",
      "## 下一步",
      "- 2 到 3 条可执行动作"
    ];
  }

  return [
    "请输出以下结构：",
    `## ${STAGE_LABELS[context.stageType]}阶段执行纪要`,
    "- 4 到 6 条执行要点",
    "### 项目摘要",
    "- 一段简短总结",
    "### 下一步",
    "- 2 到 3 条具体动作"
  ];
}
