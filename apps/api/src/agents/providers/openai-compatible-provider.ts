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
  const resolvedModel = resolveModelName(config.apiBaseUrl, config.model);
  const baseRequestTimeoutMs = Math.max(6000, Number(process.env.MODEL_REQUEST_TIMEOUT_MS ?? 16000));
  const requestTimeoutMs = resolveRequestTimeoutMs(resolvedModel, baseRequestTimeoutMs);
  const maxTokens = resolveMaxTokens(context, resolvedModel);
  const maxAttempts = Math.max(1, Number(process.env.MODEL_REQUEST_MAX_ATTEMPTS ?? 2));
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    const userPrompt = [
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
    ].join("\n");

    try {
      let streamMode = requiresStreamMode(resolvedModel);
      let response = await requestCompletion({
        apiBaseUrl: config.apiBaseUrl,
        apiKey: config.apiKey,
        model: resolvedModel,
        stream: streamMode,
        maxTokens,
        systemPrompt: buildSystemPrompt(context),
        userPrompt,
        signal: controller.signal
      });

      if (!response.ok) {
        const errorMessage = await extractErrorMessage(response);
        if (!streamMode && /stream must be set to true/i.test(errorMessage)) {
          streamMode = true;
          response = await requestCompletion({
            apiBaseUrl: config.apiBaseUrl,
            apiKey: config.apiKey,
            model: resolvedModel,
            stream: streamMode,
            maxTokens,
            systemPrompt: buildSystemPrompt(context),
            userPrompt,
            signal: controller.signal
          });
        } else if (streamMode && /stream/i.test(errorMessage)) {
          streamMode = false;
          response = await requestCompletion({
            apiBaseUrl: config.apiBaseUrl,
            apiKey: config.apiKey,
            model: resolvedModel,
            stream: streamMode,
            maxTokens,
            systemPrompt: buildSystemPrompt(context),
            userPrompt,
            signal: controller.signal
          });
        } else if (isAuthStatus(response.status)) {
          throw new Error(`AUTH_${response.status}: ${errorMessage || "Model authentication failed"}`);
        } else if (attempt < maxAttempts && isTransientStatus(response.status)) {
          await waitBeforeRetry(attempt, response.headers.get("retry-after"));
          continue;
        } else {
          throw new Error(`HTTP_${response.status}: ${errorMessage || `Model request failed with status ${response.status}`}`);
        }
      }

      if (!response.ok) {
        const errorMessage = await extractErrorMessage(response);
        if (isAuthStatus(response.status)) {
          throw new Error(`AUTH_${response.status}: ${errorMessage || "Model authentication failed"}`);
        }
        if (attempt < maxAttempts && isTransientStatus(response.status)) {
          await waitBeforeRetry(attempt, response.headers.get("retry-after"));
          continue;
        }
        throw new Error(`HTTP_${response.status}: ${errorMessage || `Model request failed with status ${response.status}`}`);
      }

      let content = "";
      if (!streamMode) {
        const payload = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        content = String(payload.choices?.[0]?.message?.content ?? "").trim();
      } else {
        const raw = await response.text();
        content = parseSseContent(raw).trim();
        if (!content) {
          content = parseNonStreamContent(raw).trim();
        }
      }

      if (!content) {
        if (attempt < maxAttempts) {
          await waitBeforeRetry(attempt);
          continue;
        }
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
      if (/^AUTH_\d+:/.test(message)) {
        throw error;
      }
      const transientError = /aborted|timeout|timed out|fetch failed|network|gateway|reset|econnreset|socket hang up/i.test(message);
      if (attempt < maxAttempts && transientError) {
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

async function requestCompletion(input: {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  stream: boolean;
  maxTokens: number;
  systemPrompt: string;
  userPrompt: string;
  signal: AbortSignal;
}) {
  return fetch(`${input.apiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    signal: input.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`
    },
    body: JSON.stringify({
      model: input.model,
      temperature: 0.3,
      stream: input.stream,
      max_tokens: input.maxTokens,
      messages: [
        {
          role: "system",
          content: input.systemPrompt
        },
        {
          role: "user",
          content: input.userPrompt
        }
      ]
    })
  });
}

function resolveModelName(apiBaseUrl: string, model: string) {
  const normalizedModel = String(model ?? "").trim();
  if (!normalizedModel) {
    return normalizedModel;
  }
  if (normalizedModel.startsWith("openai/")) {
    return normalizedModel.slice("openai/".length);
  }
  return normalizedModel;
}

async function extractErrorMessage(response: Response) {
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
      // ignore malformed chunks
    }
  }

  return content;
}

function parseNonStreamContent(raw: string) {
  try {
    const payload = JSON.parse(raw) as {
      choices?: Array<{
        message?: { content?: string };
        delta?: { content?: string };
      }>;
      output_text?: string;
    };
    if (payload.output_text) {
      return String(payload.output_text);
    }
    return String(payload.choices?.[0]?.message?.content ?? payload.choices?.[0]?.delta?.content ?? "");
  } catch {
    return "";
  }
}

function requiresStreamMode(model: string) {
  const normalized = String(model ?? "").trim().toLowerCase();
  return normalized.startsWith("gpt-5.4") || normalized.startsWith("gpt-5.3-codex");
}

function resolveRequestTimeoutMs(model: string, baseTimeoutMs: number) {
  const normalized = String(model ?? "").trim().toLowerCase();
  if (normalized.startsWith("gpt-5.4")) {
    return Math.max(baseTimeoutMs, 38000);
  }
  if (normalized.startsWith("gpt-5.3-codex")) {
    return Math.max(baseTimeoutMs, 32000);
  }
  return baseTimeoutMs;
}

function resolveMaxTokens(context: AgentRunContext, model: string) {
  const normalized = String(model ?? "").trim().toLowerCase();
  const designMode = context.role === "ROLE_DESIGN" || context.stageType === "DESIGN";
  if (normalized.startsWith("gpt-5.4")) {
    return designMode ? 2200 : 1600;
  }
  if (normalized.startsWith("gpt-5.3-codex")) {
    return designMode ? 2000 : 1500;
  }
  return designMode ? 1800 : 1200;
}

function isTransientStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || status === 524;
}

function isAuthStatus(status: number) {
  return status === 401 || status === 403;
}

async function waitBeforeRetry(attempt: number, retryAfter?: string | null) {
  const retryAfterSeconds = Number(retryAfter ?? "");
  const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
    ? retryAfterSeconds * 1000
    : undefined;
  const backoffMs = Math.min(5000, 400 * Math.pow(2, attempt - 1));
  const jitterMs = Math.floor(Math.random() * 180);
  const delayMs = Math.max(retryAfterMs ?? 0, backoffMs + jitterMs);
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
    base.push("禁止把页面设计成“需求输入 / 多 Agent 协作 / 执行证据回写 / 阶段验收回填”这类平台运转页面。");
    base.push("必须直接呈现用户真实业务对象、关键数据列表、分析信息和主动作。");
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
      "- 首屏/核心业务列表或榜单/分析区/CTA 的层级说明",
      "## 组件规范",
      "- 关键组件、状态与交互反馈",
      "- 必须描述真实业务对象的列表、数据卡、操作按钮和详情区，而不是平台内部流程组件",
      "## 设计审查卡",
      "- UX 原则（3条）",
      "- 可访问性检查清单（至少3条）",
      "- 审查结论（通过/不通过）",
      "## 下一步",
      "- 2 到 3 条可执行动作",
      "额外要求：如果需求涉及商品、电商、榜单、监控、告警、跟踪、TikTok、Amazon、Temu 等场景，页面首屏必须出现爆品榜单、平台筛选、增长指标、商品链接和跟踪动作。"
    ];
  }

  if (context.stageType === "ANALYSIS") {
    return [
      "请输出以下结构：",
      "## 业务背景与问题定义",
      "- 目标用户、核心痛点、业务价值",
      "## 用户场景与关键旅程",
      "- 至少 3 个关键场景",
      "## PRD 功能清单（MVP / 增强）",
      "- 每项包含目标、边界、验收口径",
      "## 验收标准与指标",
      "- 可测试、可量化",
      "## 风险与依赖",
      "- 风险等级 + 缓解策略",
      "## 下一步",
      "- 2 到 3 条可执行动作"
    ];
  }

  if (context.stageType === "DEV") {
    return [
      "请输出以下结构：",
      "## 技术方案概览",
      "- 模块边界、实现范围、关键权衡",
      "## 数据与接口契约",
      "- 关键字段、约束、错误处理",
      "## 开发任务拆解",
      "- 任务、负责人、依赖与里程碑",
      "## 测试用例草案",
      "- 功能、回归、异常三类用例",
      "## 发布与回滚策略",
      "- 灰度、监控、回滚触发条件",
      "## 下一步",
      "- 2 到 3 条可执行动作"
    ];
  }

  if (context.stageType === "ACCEPT") {
    return [
      "请输出以下结构：",
      "## 测试范围与执行环境",
      "- 环境、版本、依赖",
      "## 测试用例矩阵",
      "- 功能/回归/异常三类覆盖",
      "## 执行结果与缺陷摘要",
      "- 通过、失败、阻塞统计",
      "## 需求一致性验证",
      "- 对照需求目标标注一致/部分一致/不一致",
      "## 产品文档回填建议",
      "- 回填条目、版本号、时间戳",
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
