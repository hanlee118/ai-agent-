import type { RuntimeMode } from "@occ/shared";
import { ROLE_LABELS, STAGE_LABELS } from "@occ/shared";
import type { AgentRunContext, AgentRunResult } from "./scripted-provider.js";

export interface AnthropicCompatibleConfig {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
}

export async function runAnthropicCompatibleAgent(
  config: AnthropicCompatibleConfig,
  context: AgentRunContext
): Promise<AgentRunResult> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const endpoint = buildAnthropicMessagesUrl(config.apiBaseUrl);
      const response = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: normalizeAnthropicModelId(config.model),
          max_tokens: resolveMaxTokens(context, attempt),
          temperature: 0.3,
          system: buildSystemPrompt(context),
          messages: [
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
        throw new Error(`Anthropic request failed with status ${response.status}`);
      }

      const payload = (await response.json()) as {
        stop_reason?: string;
        content?: Array<{ type?: string; text?: string }>;
      };
      const content = payload.content
        ?.filter((item) => item?.type === "text")
        .map((item) => String(item?.text ?? "").trim())
        .filter(Boolean)
        .join("\n\n")
        .trim();

      const incomplete = isLikelyTruncatedHtml(content, payload.stop_reason);
      if ((!content || incomplete) && attempt < 2) {
        continue;
      }

      if (!content) {
        throw new Error("Anthropic response did not include content");
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
      if (attempt < 2) {
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Anthropic request failed"));
}

function buildAnthropicMessagesUrl(apiBaseUrl: string) {
  const base = String(apiBaseUrl || "").trim().replace(/\/$/, "");
  if (!base) {
    throw new Error("Anthropic API Base URL is empty");
  }
  if (base.endsWith("/v1")) {
    return `${base}/messages`;
  }
  return `${base}/v1/messages`;
}

function normalizeAnthropicModelId(model: string) {
  const normalized = String(model ?? "").trim();
  if (normalized.startsWith("anthropic/")) {
    return normalized.slice("anthropic/".length);
  }
  return normalized;
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

function resolveMaxTokens(context: AgentRunContext, attempt: number) {
  const designMode = context.role === "ROLE_DESIGN" || context.stageType === "DESIGN";
  if (designMode) {
    return attempt > 1 ? 7000 : 5000;
  }
  return attempt > 1 ? 4200 : 3200;
}

function isLikelyTruncatedHtml(content: string | undefined, stopReason?: string) {
  if (!content) {
    return false;
  }
  const normalized = content.toLowerCase();
  const hasHtmlShell = normalized.includes("<html") || normalized.includes("<!doctype html");
  if (!hasHtmlShell) {
    return false;
  }
  const hasBody = normalized.includes("<body");
  const hasHtmlEnd = normalized.includes("</html>");
  const maxTokenStopped = String(stopReason ?? "").toLowerCase().includes("max_tokens");
  return !hasBody || !hasHtmlEnd || maxTokenStopped;
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
