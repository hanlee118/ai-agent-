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
  const baseRequestTimeoutMs = Math.max(
    12000,
    Number(process.env.ANTHROPIC_REQUEST_TIMEOUT_MS ?? process.env.MODEL_REQUEST_TIMEOUT_MS ?? 35000)
  );
  const requestTimeoutMs = resolveRequestTimeoutMs(context, config.model, baseRequestTimeoutMs);
  const maxAttempts = Math.max(1, Number(process.env.ANTHROPIC_REQUEST_MAX_ATTEMPTS ?? process.env.MODEL_REQUEST_MAX_ATTEMPTS ?? 2));
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

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
        const errorMessage = await extractErrorMessage(response);
        if (isAuthStatus(response.status)) {
          throw new Error(`AUTH_${response.status}: ${errorMessage || "Anthropic authentication failed"}`);
        }
        if (attempt < maxAttempts && isTransientStatus(response.status)) {
          await waitBeforeRetry(attempt, response.headers.get("retry-after"));
          continue;
        }
        throw new Error(`HTTP_${response.status}: ${errorMessage || `Anthropic request failed with status ${response.status}`}`);
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
      if ((!content || incomplete) && attempt < maxAttempts) {
        await waitBeforeRetry(attempt);
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
      const message = error instanceof Error ? error.message : String(error);
      if (/^AUTH_\d+:/.test(message)) {
        throw error;
      }
      const transientError = /aborted|timeout|timed out|fetch failed|network|gateway|reset|econnreset|socket hang up/i.test(message);
      if (attempt < maxAttempts && transientError) {
        await waitBeforeRetry(attempt);
        continue;
      }
      if (attempt < maxAttempts) {
        await waitBeforeRetry(attempt);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Anthropic request failed"));
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

function isAuthStatus(status: number) {
  return status === 401 || status === 403;
}

function isTransientStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || status === 524;
}

async function waitBeforeRetry(attempt: number, retryAfter?: string | null) {
  const retryAfterSeconds = Number(retryAfter ?? "");
  const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
    ? retryAfterSeconds * 1000
    : undefined;
  const backoffMs = Math.min(5000, 450 * Math.pow(2, attempt - 1));
  const jitterMs = Math.floor(Math.random() * 220);
  const delayMs = Math.max(retryAfterMs ?? 0, backoffMs + jitterMs);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
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
    return attempt > 1 ? 2400 : 1800;
  }
  return attempt > 1 ? 1600 : 1200;
}

function resolveRequestTimeoutMs(context: AgentRunContext, model: string, baseTimeoutMs: number) {
  const normalized = normalizeAnthropicModelId(model).toLowerCase();
  const designMode = context.role === "ROLE_DESIGN" || context.stageType === "DESIGN";
  if (normalized.includes("opus")) {
    return Math.max(baseTimeoutMs, designMode ? 90000 : 65000);
  }
  if (normalized.includes("sonnet")) {
    return Math.max(baseTimeoutMs, designMode ? 70000 : 50000);
  }
  return baseTimeoutMs;
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
  if (context.promptMode === "issue_debate") {
    return [
      "你正在参与多角色需求辩论。",
      "必须只输出当前角色立场，不要写成通用分析文档或完整 PRD。",
      "严格使用指定 Markdown 标题，不得改名，不得省略。",
      "所有结论必须具体、可执行，禁止输出“角色结论 / 建议如下 / 待补充”这类空话。",
      "待确认项必须写真实问题，handoff 必须写给下游角色的明确输入和动作。"
    ].join("\n");
  }

  const base = [
    "你是 AI 协作工作台里的专业 Agent。",
    "你必须输出清晰、结构化、可执行的中文内容。",
    "不要自我介绍，不要写多余寒暄。",
    "请严格使用 Markdown。",
    "仅可使用当前项目事实与高度相关经验，不得混入低相关长期记忆、旧项目默认视觉、官网演示页或历史模板。"
  ];

  if (context.stageType === "ANALYSIS" || context.role === "ROLE_ANALYST") {
    base.push("你是需求分析师，必须先做边界澄清，再做方案拆解。不要把模糊假设直接写成既定事实。");
  }

  if (context.role === "ROLE_PRODUCT") {
    base.push("你是产品负责人，必须明确用户价值、MVP边界、非目标和决策取舍，避免把分析文档写成空泛模板。");
  }

  if (context.role === "ROLE_PM" || context.stageType === "INIT") {
    base.push("你是项目经理，必须输出真实的项目章程、阶段边界、协作方式和风险闸门，不要把立项写成一句话通知。");
    base.push("禁止输出“待补充 / TODO / TBD / xxx / 占位”等占位词。");
  }

  if (context.role === "ROLE_DESIGN" || context.stageType === "DESIGN") {
    base.push("你是视觉设计总监，避免模板化页面，优先保证品牌辨识度、信息层级和可访问性。");
    base.push("输出必须包含视觉方向、版式策略、组件规范、CTA策略和无障碍检查项。");
  }

  if (context.role === "ROLE_ARCH" || context.stageType === "DEV") {
    base.push("你必须给出真实的技术边界、架构取舍、接口约束和验证路径，不能只写原则性建议。");
  }

  return base.join("\n");
}

function buildOutputGuidance(context: AgentRunContext) {
  const designStitchMode = String(process.env.DESIGN_STITCH_MODE ?? "").trim().toLowerCase();
  const stitchEnabled = ["preferred", "required", "strict", "hard", "on", "true", "1"].includes(designStitchMode);
  const stitchHardRequired = ["required", "strict", "hard"].includes(designStitchMode);

  if (context.promptMode === "issue_debate") {
    return [
      "请严格使用以下结构：",
      "## 角色目标",
      "- 1 条，写当前角色最关心的判断目标",
      "## 核心风险",
      "- 1 到 2 条，写真实风险或依赖",
      "## 反对点",
      "- 1 条，写你明确反对什么推进方式",
      "## 角色结论",
      "- 1 到 2 条，必须是可执行结论，不能是标题、空话或复述原需求",
      "## 待确认项",
      "- 至少 1 条，写仍未闭合的关键问题",
      "## Handoff",
      "- 1 条，写交给哪个角色、交什么、下一步做什么"
    ];
  }

  if (context.stageType === "INIT") {
    return [
      "请输出以下结构：",
      "## 项目背景与目标",
      "- 原始需求、业务目标、成功判断口径",
      "## 范围定义（In Scope / Out of Scope）",
      "- 首期必须做 / 暂不纳入 / 明确边界",
      "## 角色分工与责任",
      "- 各角色 owner、输入、输出、升级路径",
      "## 治理机制与决策规则",
      "- 何时需要确认、何时可自动推进、关键门禁是什么",
      "## 风险与应急预案",
      "- 至少 3 条风险与对应处理策略",
      "## 验收检查清单",
      "- 目标、范围、角色、风险四类信息完整且无冲突。",
      "- 关键决策规则清晰，出现阻塞时可直接执行。",
      "- 章程可作为分析阶段输入，不依赖口头补充。",
      "- 上述三条验收检查清单必须逐字保留，不可改写。",
      "## 下一步",
      "- 2 到 3 条可执行动作"
    ];
  }

  if (context.stageType === "ANALYSIS" && context.role === "ROLE_PRODUCT") {
    return [
      "请输出以下结构：",
      "## 产品目标与成功指标",
      "- 目标用户、核心价值、成功判断口径",
      "## MVP 边界与非目标",
      "- 首期必须做 / 明确不做 / 延后观察项",
      "## 关键用户决策路径",
      "- 至少 3 条关键链路，说明每一步的输入、动作、反馈",
      "## 功能优先级与取舍理由",
      "- P0 / P1 / P2，并说明为什么",
      "## 需要确认的关键假设",
      "- 至少 3 条，避免后续研发建立在幻觉前提上",
      "## 下一步",
      "- 2 到 3 条可执行动作"
    ];
  }

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
      ...(stitchEnabled
        ? [
            "## Stitch 设计产物",
            "- 至少提供 1 条 Stitch 相关链接或导出物路径（并说明对应页面范围）",
            ...(stitchHardRequired
              ? ["- Stitch 证据为硬门禁，禁止只给文字描述而没有真实产物引用"]
              : [])
          ]
        : []),
      "## 下一步",
      "- 2 到 3 条可执行动作"
    ];
  }

  if (context.stageType === "DEV" && context.role === "ROLE_ARCH") {
    return [
      "请输出以下结构：",
      "## 架构目标与约束",
      "- 系统边界、性能目标、稳定性与安全要求",
      "## 模块划分与依赖关系",
      "- 上下游、接口边界、失败处理",
      "## 数据模型与存储策略",
      "- 核心实体、索引、缓存、持久化约束",
      "## 技术选型与取舍",
      "- 方案A/B比较、为什么选、为什么不选",
      "## 实施顺序与风险闸门",
      "- 阶段拆解、依赖、回滚点、验收前置条件",
      "## 下一步",
      "- 2 到 3 条可执行动作"
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
