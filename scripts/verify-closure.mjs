import { readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { prisma } from "../apps/api/dist/db.js";
import { generateSessionToken, hashSessionToken } from "../apps/api/dist/security/secret-store.js";
import {
  OPENCLAW_CONFIG_PATH,
  OPENCLAW_WORKSPACE_ROOT
} from "../apps/api/dist/openclaw/paths.js";
import { ensureHermesReachableViaApi, toBool } from "./lib/hermes-self-heal.mjs";
import { runPreflight } from "./lib/preflight-runner.mjs";

let API_BASE_URL = process.env.OCC_BASE_URL || "";
let OPENCLAW_BIN = process.env.OPENCLAW_BIN || "";
const OPENCLAW_DEFAULT_BIN = "/Users/dalongxia/.nvm/versions/node/v24.14.0/bin/openclaw";
const REQUEST_TIMEOUT_MS = Math.max(30_000, Number(process.env.REQUEST_TIMEOUT_MS || 120_000));
const ISSUE_DEBATE_WAIT_TIMEOUT_MS = Math.max(30_000, Number(process.env.ISSUE_DEBATE_WAIT_TIMEOUT_MS || 180_000));
const WAIT = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const LOG_PREFIX = "[verify:closure]";
const OPTIONAL_OPENCLAW_REQUEST_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.OPTIONAL_OPENCLAW_REQUEST_TIMEOUT_MS || 15_000)
);
const OPTIONAL_PROJECT_REQUEST_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.OPTIONAL_PROJECT_REQUEST_TIMEOUT_MS || 12_000)
);
const ENABLE_OPTIONAL_HEAVY_CHECKS = (() => {
  const raw = String(process.env.CLOSURE_ENABLE_OPTIONAL_HEAVY_CHECKS || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
})();
const ENABLE_FAST_PROJECT_FLOW_SCRIPTED = (() => {
  const raw = String(process.env.CLOSURE_FAST_PROJECT_FLOW_SCRIPTED || "true").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
})();

function logStep(message) {
  const now = new Date().toISOString();
  console.log(`${LOG_PREFIX} ${now} ${message}`);
}

const PERF = {
  requests: [],
  steps: []
};

function nowMs() {
  return Date.now();
}

function pushStepPerf(name, startedAtMs) {
  PERF.steps.push({
    name,
    durationMs: Math.max(0, nowMs() - startedAtMs)
  });
}

function summarizePerf() {
  const topRequests = [...PERF.requests]
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 12);
  const topSteps = [...PERF.steps]
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 12);
  return {
    topRequests,
    topSteps
  };
}

const state = {
  sessionToken: "",
  apiDaemonStartedByScript: false,
  createdProjectId: null,
  createdIssueId: null,
  createdAgentId: null,
  createdMemoryIds: [],
  originalRuntimeSettings: null,
  originalAgentSettings: null,
  originalSoulContent: null,
  originalSopContent: null,
  patchedOpenClawProjectId: null,
  patchedOpenClawTaskId: null,
  patchedOpenClawTaskOriginal: null,
  hermesDaemonStartedByScript: false
};

async function ensureHermesReachableIfLocal() {
  const enabled = toBool(process.env.WORKFLOW_V2_HERMES_ENABLED, false);
  const endpoint = String(
    process.env.WORKFLOW_V2_HERMES_ENDPOINT
    || process.env.HERMES_MCP_ENDPOINT
    || process.env.HERMES_MCP
    || ""
  ).trim();
  const result = await ensureHermesReachableViaApi({
    apiBase: API_BASE_URL,
    enabled,
    endpoint,
    cwd: path.resolve(process.cwd()),
    headers: state.sessionToken ? { Cookie: `occ_session=${state.sessionToken}` } : undefined,
    autoStartLocal: true,
    logger: (message) => logStep(`hermes-self-heal: ${message}`)
  });
  if (result.daemonStarted) {
    state.hermesDaemonStartedByScript = true;
  }
  return {
    enabled: result.enabled,
    attemptedStart: result.attemptedStart,
    reachable: result.reachable,
    detail: result.detail
  };
}

function buildAnalysisSubmissionContent(versionLabel = "v1") {
  return [
    `# 需求分析交付 ${versionLabel}`,
    "",
    "## 业务背景与问题定义",
    "- 当前项目用于验证 AI 协作平台从创建、介入、恢复、提交、审批到验收闭环是否可靠。",
    "- 核心问题是用户需要看到真实可执行的阶段结论，而不是停留在空白结果或无法推进的状态。",
    "- 本轮先聚焦单用户 MVP，优先验证项目流、审批门禁、交付物模板和观测能力。",
    "",
    "## 用户场景与关键旅程",
    "- 场景一：管理员创建项目后，希望快速看到分析阶段是否真正开始推进。",
    "- 场景二：若阶段结论不清晰，管理员需要介入、暂停、恢复并继续推进。",
    "- 场景三：在提交审批稿时，审批人需要看到边界、验收标准和任务优先级，避免口头补充。",
    "",
    "## PRD 功能清单（MVP / 增强）",
    "- MVP：项目创建、阶段推进、消息指导、人工介入、阶段提交、驳回重提、审批通过。",
    "- MVP：项目房间实时查看任务、时间轴、交付物和必需行动提示。",
    "- 增强：自动恢复卡死推进任务、自动补齐交付模板、输出验收报告和回填文档。",
    "- 非目标（Out of Scope）：本轮不做生产级集群部署、不做跨区域容灾切流。", 
    "",
    "## 验收标准与衡量指标",
    "- 创建项目后 1 分钟内可看到当前阶段负责人、任务列表和时间轴。",
    "- 阶段提交时，审批稿必须包含完整章节、边界说明和可验证验收标准。",
    "- 驳回后允许补充内容再次提交，通过后阶段应向下一阶段推进。",
    "- KPI：闭环脚本单轮通过率 >= 95%，核心接口成功率 >= 99%。",
    "- SLA：关键 API（/health、/api/projects、/api/openclaw/agents）P95 响应 < 2s。",
    "",
    "## 风险、依赖与假设",
    "- 风险：模型调用失败会导致阶段结论延迟生成，需要恢复机制和可见提示。",
    "- 依赖：API 健康、鉴权会话、项目仓储与交付物模板校验需保持可用。",
    "- 假设：当前验收以本地环境为主，外部通道异常时允许脚本化回退验证。",
    "- 非目标边界：不做新增业务领域扩展，不做旧项目数据回溯修复。", 
    "",
    "## 任务拆解与优先级",
    "- P0：打通创建项目、阶段推进、阶段审批三条核心路径。",
    "- P0：保证阶段提交文档符合模板且可以被审批和回溯。",
    "- P1：补齐自动恢复、验收报告、产品说明回填和异常提示。",
    "",
    "## 事实依据与来源（Source of Truth）",
    "- 代码来源：`apps/api/src/routes/projects.ts`、`apps/api/src/workflow-v2/project-modes.ts`、`apps/api/src/index.ts`。",
    "- 接口来源：`/api/projects`、`/api/projects/:id/stages/submit`、`/api/v1/workflows/projects/:id/overview`。",
    "- 运行验证来源：`pnpm verify:local`、`pnpm verify:smoke`、`pnpm verify:closure`。",
    "",
    "## 需求追踪矩阵（目标-功能-验收）",
    "| 目标 | 功能 | 验收方式 | 指标/SLA |",
    "| --- | --- | --- | --- |",
    "| 项目可创建并进入阶段 | 创建项目与预备阶段初始化 | 调用 POST /api/projects 返回 201 | 成功率 >= 99% |",
    "| 阶段可提交并进入审批 | POST /api/projects/:id/stages/submit | 返回 pendingApproval=true | 关键流程 < 2s(P95) |",
    "| 驳回后可重提并可推进 | reject + resubmit + approve | 流程状态正确迁移 | 闭环通过率 >= 95% |",
    "| 讨论与执行可观测 | 工作流概览与执行列表查询 | overview/executions 可读 | 核心 API 可用率 >= 99% |",
    "",
    "## 决策记录（Decision Log）",
    "- 决策 D1：保留强门禁，防止低质量交付误入下阶段；理由是质量稳定性优先于速度。",
    "- 决策 D2：在门禁失败时允许草稿落盘并提示补齐；理由是保留上下文，避免重复劳动。",
    "- 决策 D3：对闭环脚本使用标准化模板章节；理由是降低因格式漂移导致的假失败。",
    "- 决策 D4：对关键路径保持最小改动策略；理由是减少回归面，确保本轮可验证性。",
    "",
    "## 验收检查清单",
    "- 需求目标、用户场景、功能清单可形成闭环。",
    "- 验收标准可量化且可验证。",
    "- 风险与依赖项包含处理策略与责任人。",
    "- 已明确非目标边界（Out of Scope）并在评审中可追溯。",
    "- 已给出 Source of Truth 引用与矩阵表格映射。",
  ].join("\n");
}

function buildInitSubmissionContent(versionLabel = "v1") {
  return [
    `# 项目章程交付 ${versionLabel}`,
    "",
    "## 项目背景与目标",
    "- 项目背景：当前用于验证项目协作平台在真实流程中的创建、提交、驳回、重提、审批与推进闭环。",
    "- 项目目标：确保立项阶段产物可审、可追溯、可作为分析阶段直接输入。",
    "- 阶段目标：在单用户 MVP 范围内固化目标边界、责任人和推进规则。",
    "",
    "## 范围定义（In Scope / Out of Scope）",
    "- In Scope：项目创建、阶段提交、驳回重提、审批推进、任务状态变更可追踪。",
    "- In Scope：围绕审批主链路的消息指导、人工介入与恢复动作。",
    "- Out of Scope：多租户权限体系重构、跨区域灾备、复杂组织级并发流程。",
    "- 范围边界：仅覆盖本地协作平台闭环验证，不扩展到生产环境改造。",
    "",
    "## 角色分工与责任",
    "- 阶段负责人（Owner）：ROLE_PM，负责立项基线、边界与风险收敛。",
    "- 协作角色：ROLE_ANALYST / ROLE_PRODUCT 提供分析输入与约束确认。",
    "- 审批角色：由项目审批人确认是否进入下一阶段并记录决策。",
    "",
    "## 治理机制与决策规则",
    "- 规则一：所有阶段结论必须先有可审阅文档再进入审批。",
    "- 规则二：门禁未通过时仅允许补齐，不允许跳过审批推进。",
    "- 规则三：变更范围必须回填到当前阶段文档并重新审批。",
    "",
    "## 风险与应急预案",
    "- 风险：模型调用波动导致阶段内容延迟或质量波动。",
    "- 应急：保留草稿、提示缺失项、允许重提并记录时间线证据。",
    "- 风险：需求语义模糊导致范围蔓延。",
    "- 应急：以单用户 MVP 为硬边界，新增项进入待确认项并延后决策。",
    "",
    "## 验收检查清单",
    "- 目标、范围、角色、风险四类信息完整且无冲突。",
    "- 关键决策规则清晰，出现阻塞时可直接执行。",
    "- 章程可作为分析阶段输入，不依赖口头补充。",
    "",
    "## 待确认项",
    "- 待确认：介入与恢复动作的最终触发边界是否需要额外审批。",
    "- 待确认：后续阶段是否需要额外接入外部通知通道。",
    "",
    "## 协作交接卡",
    "factsConfirmed: 已确认立项阶段目标、范围与责任人，当前提交物可作为分析阶段输入基线。",
    "assumptions: 默认按单用户 MVP 推进，若发生范围变更需重新触发立项审批。",
    "decisions: 先保证立项门禁可通过，再推进后续分析与设计阶段执行。",
    "handoff: 交由分析阶段基于本章程产出需求分析文档与排期方案。",
    "openQuestions: 介入与恢复的细粒度触发边界是否需要额外审批策略。",
  ].join("\n");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function formatResponseForError(response) {
  return `${response.status} ${JSON.stringify(response.json)}`;
}

function unwrapEnvelope(payload) {
  if (payload && typeof payload === "object" && "success" in payload && "data" in payload) {
    return payload.data;
  }
  return payload;
}

function buildClarificationAnswersFromQuestions(questions) {
  const answers = {};
  const list = Array.isArray(questions) ? questions : [];
  for (const item of list) {
    const id = String(item?.id ?? "").trim();
    if (!id) {
      continue;
    }
    if (id === "goal") {
      answers[id] = "先完成项目协作平台端到端闭环验收，并固化可复现流程。";
      continue;
    }
    if (id === "scope") {
      answers[id] = "包含项目创建、阶段提交、审批、知识沉淀与混合协作验证；不含生产部署改造。";
      continue;
    }
    if (id === "acceptance") {
      answers[id] = "关键 API 与测试链路全部通过，三轮自检报告为绿色。";
      continue;
    }
    answers[id] = "已确认，按当前闭环验收标准执行。";
  }
  return answers;
}

async function createProjectWithFallback(input) {
  const created = await request("/api/projects", {
    method: "POST",
    body: JSON.stringify(input)
  });

  if (created.ok && typeof created.json?.id === "string") {
    return {
      project: created.json,
      mode: "direct"
    };
  }

  const errorCode = String(created.json?.error?.code ?? "");
  if (!(created.status === 409 && errorCode === "PROJECT_ISSUE_FIRST_REQUIRED")) {
    throw new Error(`project create failed: ${formatResponseForError(created)}`);
  }

  const preview = await request("/api/issues/preview", {
    method: "POST",
    body: JSON.stringify({
      input: String(input.description || ""),
      sourceType: "text",
      debateMode: "model",
      workflowTemplateKey: "standard_software_development"
    })
  });
  assert(preview.ok, `issue preview failed: ${formatResponseForError(preview)}`);
  const previewData = unwrapEnvelope(preview.json) || {};
  const issueId = String(previewData.issueId ?? "").trim();
  assert(issueId, "issue preview missing issueId");
  state.createdIssueId = issueId;
  const debateTaskId = String(previewData?.debateTask?.taskId ?? "").trim();
  await waitForIssueDebateReady(issueId, debateTaskId);

  const confirm = await request(`/api/issues/${issueId}/confirm`, {
    method: "POST",
    body: JSON.stringify({
      finalName: String(input.name || "").trim() || "Closure Acceptance Project",
      finalDescription: String(input.description || ""),
      clarificationAnswers: buildClarificationAnswersFromQuestions(previewData.questions),
      workflowTemplateKey: "standard_software_development",
      autoStartWorkflow: true
    })
  });
  assert(confirm.ok, `issue confirm failed: ${formatResponseForError(confirm)}`);
  const confirmData = unwrapEnvelope(confirm.json) || {};
  const project = confirmData.project;
  assert(project && typeof project.id === "string", "issue confirm missing project");
  return {
    project,
    mode: "issue-first",
    issueId
  };
}

async function waitForIssueDebateReady(issueId, taskId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < ISSUE_DEBATE_WAIT_TIMEOUT_MS) {
    const query = taskId ? `?taskId=${encodeURIComponent(taskId)}` : "";
    const debate = await request(`/api/issues/${issueId}/debate${query}`);
    if (!debate.ok) {
      const code = String(debate.json?.error?.code ?? "");
      if (debate.status === 404 && code === "NOT_FOUND") {
        await WAIT(800);
        continue;
      }
      throw new Error(`issue debate poll failed: ${formatResponseForError(debate)}`);
    }
    const debateData = unwrapEnvelope(debate.json) || {};
    const status = String(debateData.status || "").toLowerCase();
    const canProceed = Boolean(debateData.analysisGate?.canProceed);
    if ((status === "completed" || status === "failed") && canProceed) {
      return;
    }
    if (status === "failed") {
      const reason = String(debateData.error || debateData.analysisGate?.blockers?.[0] || "unknown debate failure");
      throw new Error(`issue debate failed: ${reason}`);
    }
    const waitMs = Math.max(800, Number(debateData.pollAfterMs || 1500));
    await WAIT(waitMs);
  }
  throw new Error(`issue debate timeout after ${ISSUE_DEBATE_WAIT_TIMEOUT_MS}ms`);
}

async function restoreRuntimeSettings() {
  if (!state.originalRuntimeSettings?.provider) {
    return;
  }

  const restored = await request("/api/system/runtime/config", {
    method: "PUT",
    body: JSON.stringify({
      provider: state.originalRuntimeSettings.provider,
      apiBaseUrl: state.originalRuntimeSettings.apiBaseUrl || "",
      modelName: state.originalRuntimeSettings.modelName || ""
    })
  });
  assert(restored.ok, `runtime restore failed: ${formatResponseForError(restored)}`);
}

async function switchRuntimeProvider(provider) {
  const saved = await request("/api/system/runtime/config", {
    method: "PUT",
    body: JSON.stringify({
      provider,
      apiBaseUrl: "",
      modelName: ""
    })
  });
  assert(saved.ok, `runtime switch failed: ${formatResponseForError(saved)}`);
}

async function ensurePostCreatePrepCompleted(projectId) {
  const prepRun = await request(`/api/projects/${projectId}/post-create-prep`, {
    method: "POST",
    body: JSON.stringify({})
  });
  if (!prepRun.ok) {
    return { ok: false, stage: "run", response: prepRun };
  }

  const prepRunData = unwrapEnvelope(prepRun.json) || {};
  const prepState = prepRunData.postCreatePrep || {};
  if (!prepState.required || prepState.completed) {
    return { ok: true, required: Boolean(prepState.required), completed: Boolean(prepState.completed) };
  }

  const prepConfirm = await request(`/api/projects/${projectId}/post-create-prep/confirm`, {
    method: "POST",
    body: JSON.stringify({
      confirmedBy: "verify-closure",
      notes: "automated closure validation confirmation"
    })
  });
  if (!prepConfirm.ok) {
    return { ok: false, stage: "confirm", response: prepConfirm };
  }
  const prepConfirmData = unwrapEnvelope(prepConfirm.json) || {};
  return {
    ok: Boolean(prepConfirmData.postCreatePrep?.completed),
    required: true,
    completed: Boolean(prepConfirmData.postCreatePrep?.completed),
    response: prepConfirm
  };
}

async function approveProjectWithRecovery(projectId, previousStage, options = {}) {
  const allowNoAdvance = options?.allowNoAdvance === true;
  const baselineStage = String(previousStage || "").trim().toUpperCase();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const approve = await request(`/api/projects/${projectId}/approve`, {
      method: "POST"
    });

    if (
      approve.ok
      && (!baselineStage || String(approve.json?.currentStage || "").toUpperCase() !== baselineStage)
    ) {
      return approve;
    }

    const code = approve.json?.error?.code;
    const recoverable422 = approve.status === 422
      && (code === "REAL_MODEL_GATE_FAILED" || code === "STAGE_TEMPLATE_VALIDATION_FAILED");

    if (recoverable422) {
      if (code === "STAGE_TEMPLATE_VALIDATION_FAILED") {
        try {
          const reconcile = await request(`/api/projects/${projectId}/reconcile-deliverables`, {
            method: "POST"
          });
          if (!reconcile.ok) {
            throw new Error(formatResponseForError(reconcile));
          }
        } catch {
          // 对齐补齐本身允许慢路径或后台执行，此处继续走审批重试即可。
        }
      }
      await WAIT(2000 * attempt);
      continue;
    }

    if (approve.status === 409 && code === "REQUIRES_USER_INTERVENTION") {
      const actions = Array.isArray(approve.json?.error?.requiredActions)
        ? approve.json.error.requiredActions
        : [];
      const needsPrep = actions.some((item) => String(item?.action || "").trim() === "run_post_create_prep")
        || Boolean(approve.json?.error?.postCreatePrep?.required);
      if (needsPrep) {
        const prep = await ensurePostCreatePrepCompleted(projectId);
        if (prep.ok) {
          await WAIT(1000);
          continue;
        }
      }
    }

    if (approve.status === 409 && code === "NO_PENDING_APPROVAL") {
      const detail = await request(`/api/projects/${projectId}`);
      if (
        detail.ok
        && (!baselineStage || String(detail.json?.currentStage || "").toUpperCase() !== baselineStage)
      ) {
        return {
          ...approve,
          ok: true,
          json: detail.json
        };
      }
    }

    throw new Error(`stage approve failed: ${formatResponseForError(approve)}`);
  }

  if (allowNoAdvance) {
    const detail = await request(`/api/projects/${projectId}`);
    if (detail.ok && detail.json?.pendingApproval === false) {
      return {
        status: 200,
        ok: true,
        json: detail.json
      };
    }
  }
  throw new Error("stage approve did not advance after retries");
}

function resolveOpenClawBinary() {
  if (OPENCLAW_BIN && path.isAbsolute(OPENCLAW_BIN) && existsSync(OPENCLAW_BIN)) {
    return OPENCLAW_BIN;
  }

  const root = process.cwd();
  const candidates = [
    OPENCLAW_DEFAULT_BIN,
    path.resolve(root, "apps/api/node_modules/.bin/openclaw"),
    path.resolve(root, "node_modules/.bin/openclaw"),
    "/opt/homebrew/bin/openclaw",
    "/usr/local/bin/openclaw",
    "/usr/bin/openclaw"
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  try {
    const fromPath = execFileSync("which", ["openclaw"], { encoding: "utf8" }).trim();
    if (fromPath && path.isAbsolute(fromPath) && existsSync(fromPath)) {
      return fromPath;
    }
  } catch {
    // ignore which failures
  }

  throw new Error(
    `无法定位 openclaw CLI。请设置 OPENCLAW_BIN 为绝对路径，例如 ${OPENCLAW_DEFAULT_BIN}`
  );
}

async function request(pathname, init = {}, options = {}) {
  const reqStartedAt = nowMs();
  const method = String(init?.method || "GET").toUpperCase();
  const timeoutMs = Math.max(
    1_000,
    Number.isFinite(Number(options?.timeoutMs))
      ? Number(options.timeoutMs)
      : REQUEST_TIMEOUT_MS
  );
  const retryNetwork = options?.retryNetwork === true || (options?.retryNetwork !== false && method === "GET");
  const maxAttempts = retryNetwork ? 2 : 1;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${API_BASE_URL}${pathname}`, {
        ...init,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Cookie: `occ_session=${state.sessionToken}`,
          ...(init.headers || {})
        }
      });
      const text = await response.text();
      let json = null;

      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = text;
      }

      const payload = {
        status: response.status,
        ok: response.ok,
        json
      };
      PERF.requests.push({
        method,
        pathname,
        durationMs: Math.max(0, nowMs() - reqStartedAt),
        ok: response.ok
      });
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await WAIT(300);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  PERF.requests.push({
    method,
    pathname,
    durationMs: Math.max(0, nowMs() - reqStartedAt),
    ok: false
  });
  throw new Error(`request failed: ${pathname} (${reason})`);
}

async function createSession() {
  state.sessionToken = generateSessionToken();
  await prisma.authSession.create({
    data: {
      tokenHash: await hashSessionToken(state.sessionToken),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000)
    }
  });
}

async function verifyOpenClawEndpoints(results) {
  const [agents, projects] = await Promise.all([
    request('/api/openclaw/agents'),
    request('/api/openclaw/projects')
  ]);

  assert(agents.ok, 'openclaw agents endpoint failed');
  assert(Array.isArray(agents.json), 'openclaw agents endpoint did not return array');
  assert(projects.ok, 'openclaw projects endpoint failed');
  assert(Array.isArray(projects.json), 'openclaw projects endpoint did not return array');

  results.openclawAgentsEndpoint = agents.json.length;
  results.openclawProjectsEndpoint = projects.json.length;
}

async function verifyProjectFlow(results) {
  const preview = await request("/api/projects/preview", {
    method: "POST",
    body: JSON.stringify({
      description: "闭环验收项目：验证创建、消息、介入、恢复、提交、驳回、再提交、审批与任务状态变更。"
    })
  });
  assert(preview.ok, "project preview failed");
  assert(Array.isArray(preview.json?.keywords), "project preview missing keywords");
  results.projectPreview = "ok";

  let created;
  try {
    created = await createProjectWithFallback({
      description: "闭环验收项目：验证创建、消息、介入、恢复、提交、驳回、再提交、审批与任务状态变更。",
      name: "Closure Acceptance Project"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      /issue debate failed|issue debate timeout|issue confirm failed: 409/i.test(message)
      || /analysisGate|真实多角色讨论/.test(message)
    ) {
      results.projectFlow = {
        status: "skipped",
        reason: message
      };
      return;
    }
    throw error;
  }
  state.createdProjectId = created.project.id;
  results.projectCreate = created.project.id;
  results.projectCreateMode = created.mode;
  if (created.issueId) {
    results.projectCreateIssueId = created.issueId;
  }

  const detail = await request(`/api/projects/${state.createdProjectId}`);
  assert(detail.ok, "project detail failed");
  assert(detail.json?.name === "Closure Acceptance Project", "project detail returned unexpected name");
  results.projectDetail = "ok";
  const stageBeforeSubmit = String(detail.json?.currentStage || "").trim().toUpperCase();

  let prepTimedOut = false;
  if (ENABLE_OPTIONAL_HEAVY_CHECKS) {
    try {
      const prepRun = await request(`/api/projects/${state.createdProjectId}/post-create-prep`, {
        method: "POST",
        body: JSON.stringify({})
      }, {
        timeoutMs: OPTIONAL_PROJECT_REQUEST_TIMEOUT_MS,
        retryNetwork: false
      });
      if (!prepRun.ok) {
        const code = String(prepRun.json?.error?.code || "");
        if (prepRun.status === 409 && code === "PROJECT_ISSUE_FIRST_REQUIRED") {
          results.projectFlow = {
            status: "skipped",
            reason: `post-create prep blocked by issue-first gate: ${formatResponseForError(prepRun)}`
          };
          return;
        }
        throw new Error(`post-create prep run failed: ${formatResponseForError(prepRun)}`);
      }
      const prepRunData = unwrapEnvelope(prepRun.json) || {};
      const prepRunState = prepRunData.postCreatePrep || {};
      if (prepRunState.required && !prepRunState.completed) {
        const prepConfirm = await request(`/api/projects/${state.createdProjectId}/post-create-prep/confirm`, {
          method: "POST",
          body: JSON.stringify({
            confirmedBy: "verify-closure",
            notes: "automated closure validation confirmation"
          })
        });
        assert(prepConfirm.ok, `post-create prep confirm failed: ${formatResponseForError(prepConfirm)}`);
        const prepConfirmData = unwrapEnvelope(prepConfirm.json) || {};
        assert(
          Boolean(prepConfirmData.postCreatePrep?.completed),
          `post-create prep not completed after confirm: ${formatResponseForError(prepConfirm)}`
        );
      }
      results.projectPostCreatePrep = "ok";
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      prepTimedOut = /This operation was aborted|AbortError/i.test(detail);
      if (!prepTimedOut) {
        throw error;
      }
      results.projectPostCreatePrep = {
        warning: "post-create prep timeout",
        detail
      };
      try {
        const prepConfirmDirect = await request(`/api/projects/${state.createdProjectId}/post-create-prep/confirm`, {
          method: "POST",
          body: JSON.stringify({
            confirmedBy: "verify-closure-timeout-fallback",
            notes: "fallback confirm after prep timeout"
          })
        }, {
          timeoutMs: 6_000,
          retryNetwork: false
        });
        if (prepConfirmDirect.ok) {
          const prepConfirmData = unwrapEnvelope(prepConfirmDirect.json) || {};
          if (Boolean(prepConfirmData.postCreatePrep?.completed)) {
            results.projectPostCreatePrep = "ok-via-fallback-confirm";
          }
        }
      } catch {
        // keep warning and let approve phase recovery handle it
      }
    }
  } else {
    results.projectPostCreatePrep = "deferred-fast-mode";
  }

  const tasks = await request(`/api/projects/${state.createdProjectId}/tasks`);
  assert(tasks.ok, "project tasks failed");
  assert(Array.isArray(tasks.json) && tasks.json.length > 0, "project tasks empty");
  const firstTaskId = tasks.json[0].id;
  results.projectTasks = tasks.json.length;

  if (ENABLE_OPTIONAL_HEAVY_CHECKS) {
    try {
      const guidance = await request(`/api/projects/${state.createdProjectId}/messages`, {
        method: "POST",
        body: JSON.stringify({ message: "请继续推进，并写清楚当前阶段边界。" })
      }, {
        timeoutMs: OPTIONAL_PROJECT_REQUEST_TIMEOUT_MS,
        retryNetwork: false
      });
      assert(guidance.ok, "project guidance failed");
      results.projectMessage = "ok";
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (prepTimedOut || /This operation was aborted|AbortError/i.test(detail)) {
        results.projectMessage = {
          warning: "project guidance timeout",
          detail
        };
      } else {
        throw error;
      }
    }
  } else {
    results.projectMessage = "skipped-fast-mode";
  }

  const intervene = await request(`/api/projects/${state.createdProjectId}/intervene`, {
    method: "POST",
    body: JSON.stringify({ command: "暂停并重新聚焦单用户 MVP 范围。" })
  });
  assert(intervene.ok && intervene.json?.status === "paused", "project intervene failed");
  results.projectIntervene = intervene.json.status;

  const resume = await request(`/api/projects/${state.createdProjectId}/resume`, {
    method: "POST"
  });
  assert(resume.ok && resume.json?.status === "active", "project resume failed");
  results.projectResume = resume.json.status;

  const submitTitle = stageBeforeSubmit === "INIT" ? "项目章程.md" : "需求分析 / PRD";
  const submitContent = stageBeforeSubmit === "INIT"
    ? buildInitSubmissionContent("v1")
    : buildAnalysisSubmissionContent("v1");
  const submit = await request(`/api/projects/${state.createdProjectId}/stages/submit`, {
    method: "POST",
    body: JSON.stringify({
      title: submitTitle,
      content: submitContent
    })
  });
  assert(
    submit.ok && submit.json?.pendingApproval === true,
    `stage submit failed: ${formatResponseForError(submit)}`
  );
  results.projectSubmit = "ok";

  const reject = await request(`/api/projects/${state.createdProjectId}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason: "请补充更清晰的边界与验收标准。" })
  });
  assert(reject.ok && reject.json?.pendingApproval === false, "stage reject failed");
  results.projectReject = "ok";

  const resubmit = await request(`/api/projects/${state.createdProjectId}/stages/submit`, {
    method: "POST",
    body: JSON.stringify({
      title: submitTitle,
      content: `${stageBeforeSubmit === "INIT" ? buildInitSubmissionContent("v2") : buildAnalysisSubmissionContent("v2")}\n\n## 补充说明\n- 已根据驳回意见补充边界、验收标准与优先级说明。`
    })
  });
  assert(
    resubmit.ok && resubmit.json?.pendingApproval === true,
    `stage resubmit failed: ${formatResponseForError(resubmit)}`
  );
  results.projectResubmit = "ok";

  if (ENABLE_FAST_PROJECT_FLOW_SCRIPTED) {
    results.projectApprove = {
      warning: "skipped-fast-mode",
      detail: "approval progression validation is skipped in fast scripted mode"
    };
  } else {
    const approve = await approveProjectWithRecovery(state.createdProjectId, stageBeforeSubmit, {
      allowNoAdvance: false
    });
    results.projectApprove = approve.json.currentStage;
  }

  const updateTask = await request(`/api/tasks/${firstTaskId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "done" })
  });
  assert(updateTask.ok, "task status update failed");
  results.projectTaskPatch = "ok";
}

async function verifyRuntimeFlow(results) {
  const current = await request("/api/system/runtime/config");
  assert(current.ok, "runtime config get failed");
  state.originalRuntimeSettings ||= current.json;
  results.runtimeOriginalProvider = current.json?.provider;

  const saved = await request("/api/system/runtime/config", {
    method: "PUT",
    body: JSON.stringify({
      provider: "scripted",
      apiBaseUrl: "",
      modelName: ""
    })
  });
  assert(saved.ok, "runtime config put failed");
  assert(saved.json?.provider === "scripted", "runtime config put did not persist scripted mode");
  results.runtimeSave = "ok";

  const validated = await request("/api/system/runtime/validate", {
    method: "POST"
  });
  assert(validated.ok, "runtime validation failed");
  assert(typeof validated.json?.ok === "boolean", "runtime validation missing ok");
  results.runtimeValidate = validated.json.ok ? "ok" : "warning";

  await restoreRuntimeSettings();
  results.runtimeRestore = "ok";
}

async function verifyOpenClawFlow(results) {
  const projectList = await request("/api/openclaw/projects");
  assert(projectList.ok, "openclaw projects failed");
  assert(Array.isArray(projectList.json) && projectList.json.length > 0, "openclaw projects empty");
  results.openclawProjects = projectList.json.length;

  const workspace = await request("/api/openclaw/workspace");
  assert(workspace.ok, "openclaw workspace failed");
  assert(Array.isArray(workspace.json?.agents) && workspace.json.agents.length > 0, "openclaw workspace missing agents");
  assert(Array.isArray(workspace.json?.projects) && workspace.json.projects.length > 0, "openclaw workspace missing projects");
  results.openclawWorkspace = `${workspace.json.projects.length} projects / ${workspace.json.agents.length} agents`;

  const agents = await request("/api/openclaw/agents");
  assert(agents.ok, "openclaw agents failed");
  const tempAgentId = `closure_acceptance_${Date.now()}`;
  const createdAgent = await request("/api/openclaw/agents", {
    method: "POST",
    body: JSON.stringify({
      agentId: tempAgentId,
      name: "Closure Acceptance Bot",
      title: "Acceptance Verifier",
      model: "gpt-5.2",
      intro: "Used for automated closure verification.",
      responsibility: "Verify that end-to-end flows remain operational.",
      tools: ["openclaw", "rg"],
      allowedAgentIds: ["jeremy"]
    })
  });
  assert(createdAgent.ok, "openclaw agent create failed");
  state.createdAgentId = tempAgentId;
  results.openclawCreateAgent = tempAgentId;

  const targetAgentId = agents.json.find((item) => item.agentId === "jeremy")?.agentId || agents.json[0]?.agentId;
  assert(targetAgentId, "no openclaw agent available for closure test");
  results.openclawAgent = targetAgentId;

  const agentDetail = await request(`/api/openclaw/agents/${targetAgentId}`);
  assert(agentDetail.ok, "openclaw agent detail failed");
  state.originalAgentSettings = {
    agentId: targetAgentId,
    displayName: agentDetail.json?.name,
    title: agentDetail.json?.title,
    intro: agentDetail.json?.intro,
    responsibility: agentDetail.json?.responsibility,
    selectedModel: agentDetail.json?.commander?.selectedModel,
    defaultModel: agentDetail.json?.commander?.defaultModel,
    fallbackModel: agentDetail.json?.commander?.fallbackModel,
    executionMode: agentDetail.json?.commander?.executionMode,
    requireConfirmation: agentDetail.json?.commander?.requireConfirmation,
    autoApproveMinorSteps: agentDetail.json?.commander?.autoApproveMinorSteps,
    maxPromptTokens: agentDetail.json?.commander?.maxPromptTokens,
    maxCompletionTokens: agentDetail.json?.commander?.maxCompletionTokens,
    maxDailyTokens: agentDetail.json?.commander?.maxDailyTokens,
    memoryEnabled: agentDetail.json?.commander?.memoryEnabled,
    allowedAgentIds: agentDetail.json?.allowedAgentIds || [],
    tools: agentDetail.json?.tools || []
  };
  state.originalSoulContent = agentDetail.json?.soul?.content ?? "";
  state.originalSopContent = agentDetail.json?.sop?.content ?? "";
  results.openclawAgentDetail = "ok";

  const preview = await request(`/api/openclaw/agents/${targetAgentId}/preview-instruction`, {
    method: "POST",
    body: JSON.stringify({
      message: "请先理解这个需求，再等待我的确认。",
      preferAutonomous: false
    })
  });
  assert(preview.ok, "openclaw agent preview failed");
  assert(preview.json?.recommendedAction, "openclaw agent preview missing recommended action");
  results.openclawPreview = preview.json.recommendedAction;

  const settings = await request(`/api/openclaw/agents/${targetAgentId}/settings`, {
    method: "PATCH",
    body: JSON.stringify({
      ...state.originalAgentSettings,
      selectedModel: state.originalAgentSettings.selectedModel || "gpt-5.2",
      executionMode: "confirm_first",
      requireConfirmation: true,
      maxDailyTokens: 200000
    })
  });
  assert(settings.ok, "openclaw agent settings failed");
  assert(settings.json?.commander?.maxDailyTokens === 200000, "openclaw settings did not persist");
  results.openclawSettings = "ok";

  const updatedSoul = `${state.originalSoulContent.trimEnd()}\n\n<!-- closure-check -->\n`;
  const soulSave = await request(`/api/openclaw/agents/${targetAgentId}/document/soul`, {
    method: "PATCH",
    body: JSON.stringify({ content: updatedSoul, createIfMissing: true })
  });
  assert(soulSave.ok, "openclaw soul save failed");
  results.openclawSoul = "ok";

  const updatedSop = `${state.originalSopContent.trimEnd()}\n\n<!-- closure-check -->\n`;
  const sopSave = await request(`/api/openclaw/agents/${targetAgentId}/document/sop`, {
    method: "PATCH",
    body: JSON.stringify({ content: updatedSop, createIfMissing: true })
  });
  assert(sopSave.ok, "openclaw sop save failed");
  results.openclawSop = "ok";

  const memory = await request(`/api/openclaw/agents/${targetAgentId}/memory`, {
    method: "POST",
    body: JSON.stringify({
      type: "workflow",
      summary: "闭环验收记忆",
      content: "这是一条用于闭环验收的测试记忆。",
      importance: 60,
      tags: ["acceptance", "closure"],
      source: "verify-closure"
    })
  });
  assert(memory.ok, "openclaw memory write failed");
  const memoryEntry = memory.json?.memoryEntries?.find?.((item) => item.summary === "闭环验收记忆");
  if (memoryEntry?.id) {
    state.createdMemoryIds.push(memoryEntry.id);
  }
  results.openclawMemory = "ok";

  if (ENABLE_FAST_PROJECT_FLOW_SCRIPTED) {
    results.openclawMessage = {
      warning: "skipped-fast-mode",
      detail: "single-agent live message check skipped in fast scripted mode"
    };
    results.openclawBatchMessage = {
      warning: "skipped-fast-mode",
      detail: "batch live message check skipped in fast scripted mode"
    };
  } else {
    let shouldSkipBatchMessage = false;
    try {
      const message = await request(`/api/openclaw/agents/${targetAgentId}/message`, {
        method: "POST",
        body: JSON.stringify({ message: "请简要汇报你当前任务与下一步。" })
      }, {
        timeoutMs: OPTIONAL_OPENCLAW_REQUEST_TIMEOUT_MS,
        retryNetwork: false
      });
      if (message.ok && typeof message.json?.summary === "string") {
        results.openclawMessage = message.json.summary;
      } else {
        results.openclawMessage = {
          warning: "openclaw agent message failed",
          status: message.status,
          detail: message.json
        };
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (/This operation was aborted|AbortError/i.test(detail)) {
        shouldSkipBatchMessage = true;
      }
      results.openclawMessage = {
        warning: "openclaw agent message timeout",
        detail
      };
    }

    if (shouldSkipBatchMessage) {
      results.openclawBatchMessage = {
        warning: "openclaw batch message skipped",
        detail: "skipped because single-agent message request timed out"
      };
    } else try {
      const batch = await request("/api/openclaw/agents/batch-message", {
        method: "POST",
        body: JSON.stringify({
          agentIds: [targetAgentId],
          message: "请同步一条当前状态。"
        })
      }, {
        timeoutMs: OPTIONAL_OPENCLAW_REQUEST_TIMEOUT_MS,
        retryNetwork: false
      });
      if (batch.ok && batch.json?.completedCount >= 1) {
        results.openclawBatchMessage = batch.json.completedCount;
      } else {
        results.openclawBatchMessage = {
          warning: "openclaw batch message failed",
          status: batch.status,
          detail: batch.json
        };
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      results.openclawBatchMessage = {
        warning: "openclaw batch message timeout",
        detail
      };
    }
  }

  const projectId = workspace.json.projects[0].id;
  const project = await request(`/api/openclaw/projects/${projectId}`);
  assert(project.ok, "openclaw project detail failed");
  assert(Array.isArray(project.json?.tasks), "openclaw project detail missing tasks");
  results.openclawProject = projectId;

  const report = await request(`/api/openclaw/projects/${projectId}/report`);
  assert(report.ok, "openclaw project report failed");
  assert(typeof report.json?.markdown === "string" && report.json.markdown.length > 0, "openclaw project report missing markdown");
  results.openclawProjectReport = "ok";

  const tasks = project.json.tasks;
  assert(tasks.length > 0, "openclaw project has no tasks to patch");
  const patchTarget = tasks[0];
  state.patchedOpenClawProjectId = projectId;
  state.patchedOpenClawTaskId = patchTarget.id;
  state.patchedOpenClawTaskOriginal = {
    progress: patchTarget.progress,
    status: patchTarget.status
  };

  const taskPatch = await request(`/api/openclaw/projects/${projectId}/tasks/${patchTarget.id}`, {
    method: "PATCH",
    body: JSON.stringify({ progress: Math.min(99, (patchTarget.progress ?? 0) + 1) })
  });
  assert(taskPatch.ok, "openclaw task patch failed");
  results.openclawTaskPatch = "ok";

  if (tasks.length > 1) {
    const firstTwo = tasks.slice(0, 2);
    const originalBatch = firstTwo.map((item) => ({
      taskId: item.id,
      progress: item.progress,
      status: item.status
    }));
    const batchPatch = await request(`/api/openclaw/projects/${projectId}/tasks`, {
      method: "PATCH",
      body: JSON.stringify({
        updates: firstTwo.map((item) => ({
          taskId: item.id,
          patch: { progress: Math.min(99, (item.progress ?? 0) + 2) }
        }))
      })
    });
    assert(batchPatch.ok, "openclaw batch task patch failed");
    results.openclawBatchTaskPatch = "ok";

    await request(`/api/openclaw/projects/${projectId}/tasks`, {
      method: "PATCH",
      body: JSON.stringify({
        updates: originalBatch.map((item) => ({
          taskId: item.taskId,
          patch: { progress: item.progress, status: item.status }
        }))
      })
    });
  }

  const sla = await request("/api/openclaw/agents/sla");
  assert(sla.ok && Array.isArray(sla.json), "openclaw sla failed");
  results.openclawSla = sla.json.length;
}

async function cleanup() {
  try {
    await restoreRuntimeSettings();
  } catch {}

  try {
    if (state.originalAgentSettings && state.createdAgentId === null) {
      const agentId = state.originalAgentSettings.agentId;
      if (agentId) {
        await request(`/api/openclaw/agents/${agentId}/settings`, {
          method: "PATCH",
          body: JSON.stringify(state.originalAgentSettings)
        });
      }
    }
  } catch {}

  try {
    if (state.originalSoulContent !== null && state.originalAgentSettings?.agentId) {
      await request(`/api/openclaw/agents/${state.originalAgentSettings.agentId}/document/soul`, {
        method: "PATCH",
        body: JSON.stringify({ content: state.originalSoulContent, createIfMissing: true })
      });
    }
  } catch {}

  try {
    if (state.originalSopContent !== null && state.originalAgentSettings?.agentId) {
      await request(`/api/openclaw/agents/${state.originalAgentSettings.agentId}/document/sop`, {
        method: "PATCH",
        body: JSON.stringify({ content: state.originalSopContent, createIfMissing: true })
      });
    }
  } catch {}

  if (state.patchedOpenClawProjectId && state.patchedOpenClawTaskId && state.patchedOpenClawTaskOriginal) {
    try {
      await request(`/api/openclaw/projects/${state.patchedOpenClawProjectId}/tasks/${state.patchedOpenClawTaskId}`, {
        method: "PATCH",
        body: JSON.stringify(state.patchedOpenClawTaskOriginal)
      });
    } catch {}
  }

  if (state.createdMemoryIds.length > 0) {
    try {
      await prisma.agentMemoryEntry.deleteMany({
        where: { id: { in: state.createdMemoryIds } }
      });
    } catch {}
  }

  if (state.createdProjectId) {
    try {
      await prisma.project.delete({ where: { id: state.createdProjectId } });
    } catch {}
  }

  if (state.createdIssueId) {
    try {
      await prisma.methodIssue.delete({ where: { id: state.createdIssueId } });
    } catch {}
  }

  if (state.createdAgentId) {
    try {
      const raw = await readFile(OPENCLAW_CONFIG_PATH, "utf8");
      const config = JSON.parse(raw);
      config.agents ||= {};
      config.agents.list ||= [];
      config.agents.list = config.agents.list.filter((item) => item.id !== state.createdAgentId);
      await writeFile(OPENCLAW_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    } catch {}

    try {
      await rm(path.join(OPENCLAW_WORKSPACE_ROOT, "agents", state.createdAgentId), { recursive: true, force: true });
    } catch {}

    try {
      await prisma.managedAgentConfig.deleteMany({ where: { agentId: state.createdAgentId } });
    } catch {}
  }

  if (state.sessionToken) {
    try {
      await prisma.authSession.deleteMany({
        where: { tokenHash: await hashSessionToken(state.sessionToken) }
      });
    } catch {}
  }

  if (state.apiDaemonStartedByScript) {
    try {
      execFileSync("pnpm", ["daemon:stop"], {
        cwd: path.resolve(process.cwd()),
        stdio: "ignore"
      });
    } catch {}
  }

  if (state.hermesDaemonStartedByScript) {
    try {
      execFileSync("pnpm", ["hermes:daemon:stop"], {
        cwd: path.resolve(process.cwd()),
        stdio: "ignore"
      });
    } catch {}
  }

  await prisma.$disconnect();
}

async function main() {
  const results = {};
  const startedAt = Date.now();
  logStep("starting closure verification");
  OPENCLAW_BIN = resolveOpenClawBinary();
  process.env.OPENCLAW_BIN = OPENCLAW_BIN;
  results.openclawBin = OPENCLAW_BIN;
  results.closureMode = {
    fastProjectFlowScripted: ENABLE_FAST_PROJECT_FLOW_SCRIPTED,
    optionalHeavyChecks: ENABLE_OPTIONAL_HEAVY_CHECKS
  };
  logStep(`resolved openclaw binary: ${OPENCLAW_BIN}`);

  logStep("ensuring database connectivity");
  const preflight = await runPreflight({
    needDb: true,
    db: {
      databaseUrl: process.env.DATABASE_URL || "",
      cwd: path.resolve(process.cwd()),
      maxAttempts: 12,
      intervalMs: 2_000,
      eagerStartDocker: true,
      logger: (message) => logStep(`db-self-heal: ${message}`),
      probe: async () => {
        await prisma.$queryRawUnsafe("SELECT 1");
      }
    },
    needApi: true,
    api: {
      requestedBaseUrl: API_BASE_URL,
      checkPathname: "/health",
      autoStartDaemon: true,
      startCommand: ["pnpm", "daemon:start"],
      cwd: path.resolve(process.cwd()),
      logger: (message) => logStep(`api-self-heal: ${message}`)
    }
  });
  logStep("creating temporary auth session");
  await createSession();
  logStep("resolving reachable api base url");
  const apiReady = preflight.api || { ok: false, detail: "missing_preflight_api_result", apiBaseUrl: "" };
  if (!apiReady.ok || !apiReady.apiBaseUrl) {
    throw new Error(`api base url not reachable (${apiReady.detail})`);
  }
  API_BASE_URL = apiReady.apiBaseUrl;
  state.apiDaemonStartedByScript = apiReady.startedByScript;
  results.apiBaseUrl = API_BASE_URL;
  logStep(`api base url ready: ${API_BASE_URL}`);

  try {
    logStep("checking auth status");
    const auth = await request("/api/auth/status");
    assert(auth.ok && auth.json?.setupComplete, "auth status failed");
    results.auth = "ok";

    logStep("checking hermes runtime reachability");
    results.hermesReachability = await ensureHermesReachableIfLocal();

    logStep("verifying openclaw public endpoints");
    let stepStart = nowMs();
    await verifyOpenClawEndpoints(results);
    pushStepPerf("verifyOpenClawEndpoints", stepStart);
    if (ENABLE_FAST_PROJECT_FLOW_SCRIPTED) {
      const currentRuntime = await request("/api/system/runtime/config");
      assert(currentRuntime.ok, "runtime config get failed before project flow");
      state.originalRuntimeSettings ||= currentRuntime.json;
      results.projectFlowRuntimeOriginalProvider = currentRuntime.json?.provider;
      if (currentRuntime.json?.provider !== "scripted") {
        logStep("switching runtime to scripted for faster project-flow verification");
        await switchRuntimeProvider("scripted");
        results.projectFlowRuntimeSwitched = true;
      } else {
        results.projectFlowRuntimeSwitched = false;
      }
    }

    try {
      logStep("verifying end-to-end project flow");
      stepStart = nowMs();
      await verifyProjectFlow(results);
      pushStepPerf("verifyProjectFlow", stepStart);
    } finally {
      if (ENABLE_FAST_PROJECT_FLOW_SCRIPTED && state.originalRuntimeSettings?.provider) {
        logStep("restoring runtime provider after project-flow verification");
        await restoreRuntimeSettings();
      }
    }
    logStep("verifying runtime config and validation flow");
    stepStart = nowMs();
    await verifyRuntimeFlow(results);
    pushStepPerf("verifyRuntimeFlow", stepStart);
    logStep("verifying openclaw integration flow");
    stepStart = nowMs();
    await verifyOpenClawFlow(results);
    pushStepPerf("verifyOpenClawFlow", stepStart);
    logStep("all verification steps completed");

    const finishedAt = Date.now();
    console.log(JSON.stringify({
      ok: true,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs: finishedAt - startedAt,
      results,
      perf: summarizePerf()
    }, null, 2));
  } finally {
    logStep("running cleanup");
    await cleanup();
    logStep("cleanup complete");
  }
}

await main();
