import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { prisma } from "../apps/api/dist/db.js";
import { generateSessionToken, hashSessionToken } from "../apps/api/dist/security/secret-store.js";

const API_BASE = (process.env.API_BASE || "http://127.0.0.1:8787").replace(/\/$/, "");
const MAX_ROUNDS = Math.max(60, Number(process.env.MAX_ROUNDS || 220));
const MAX_IN_PROGRESS_BONUS_ROUNDS = Math.max(30, Number(process.env.MAX_IN_PROGRESS_BONUS_ROUNDS || 240));
const REQUEST_TIMEOUT_MS = Math.max(180000, Number(process.env.REQUEST_TIMEOUT_MS || 360000));
const ADVANCE_TIMEOUT_MS = Math.max(240000, Number(process.env.ADVANCE_TIMEOUT_MS || 540000));
const SKIP_RUNTIME_PREFLIGHT = String(process.env.SKIP_RUNTIME_PREFLIGHT || "").trim().toLowerCase() === "true";
const WAIT = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let SESSION_COOKIE = "";
let API_STARTED_BY_SCRIPT = false;

const requirement = "帮我搭建一个跨境电商的爆品选品跟品机器人。当某个跨境品在tiktok或者亚马逊等上的流量突然大爆时，帮我做好监控和排名，并且提供链接供我实时跟品。";
const stageOrder = ["INIT", "ANALYSIS", "DESIGN", "DEV", "ACCEPT"];
const stageMustHaveExecutions = ["ANALYSIS", "DESIGN", "DEV", "ACCEPT"];
const requiredRoles = ["ROLE_PM", "ROLE_ANALYST", "ROLE_PRODUCT", "ROLE_DESIGN", "ROLE_ARCH", "ROLE_DEV", "ROLE_QA"];

function isTransportRetryable(resp) {
  return Boolean(resp && [502, 503, 504, 598, 599].includes(Number(resp.status)));
}

async function req(method, pathname, body, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {};
    if (body) {
      headers["content-type"] = "application/json";
    }
    if (SESSION_COOKIE) {
      headers.cookie = SESSION_COOKIE;
    }
    const res = await fetch(`${API_BASE}${pathname}`, {
      method,
      signal: controller.signal,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const occSessionPair = setCookie
        .split(",")
        .map((item) => item.trim())
        .find((item) => item.startsWith("occ_session="));
      if (occSessionPair) {
        SESSION_COOKIE = occSessionPair.split(";")[0] || SESSION_COOKIE;
      }
    }
    const text = await res.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    return { status: res.status, body: payload };
  } catch (error) {
    const aborted = error?.name === "AbortError";
    return {
      status: aborted ? 598 : 599,
      body: {
        error: {
          code: aborted ? "REQUEST_TIMEOUT" : "REQUEST_FAILED",
          name: String(error?.name || "Error"),
          message: String(error?.message || error || "")
        }
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

function unwrap(payload) {
  if (payload && typeof payload === "object" && "success" in payload && payload.success === true && "data" in payload) {
    return payload.data;
  }
  return payload;
}

function summarizeProject(project) {
  return {
    id: project?.id,
    status: project?.status,
    currentStage: project?.currentStage,
    currentRole: project?.currentRole,
    progress: project?.progress,
    pendingApproval: project?.pendingApproval
  };
}

function isDegraded(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }
  return Boolean(metadata.degraded);
}

function writeReport(report) {
  const outDir = path.resolve("/private/tmp/ai-agent-check/docs/reports");
  fs.mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(outDir, `real-data-round2-${ts}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  return outPath;
}

async function ensureApiReady(logs) {
  const health = await req("GET", "/health", null, 15000);
  if (health.status === 200) {
    return;
  }

  logs.push({
    at: new Date().toISOString(),
    type: "api_autostart",
    status: health.status
  });

  execFileSync("pnpm", ["daemon:start"], {
    cwd: process.cwd(),
    stdio: "inherit"
  });
  API_STARTED_BY_SCRIPT = true;

  for (let i = 0; i < 20; i += 1) {
    const retry = await req("GET", "/health", null, 15000);
    if (retry.status === 200) {
      logs.push({
        at: new Date().toISOString(),
        type: "api_ready_after_autostart",
        round: i + 1
      });
      return;
    }
    await WAIT(1000);
  }

  throw new Error("health check failed after daemon:start");
}

function stopStartedApi(logs) {
  if (!API_STARTED_BY_SCRIPT) {
    return;
  }
  try {
    execFileSync("pnpm", ["daemon:stop"], {
      cwd: process.cwd(),
      stdio: "inherit"
    });
    logs.push({
      at: new Date().toISOString(),
      type: "api_stopped_after_verification"
    });
  } catch (error) {
    logs.push({
      at: new Date().toISOString(),
      type: "api_stop_failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

async function createTemporarySession(logs) {
  const sessionToken = generateSessionToken();
  await prisma.authSession.create({
    data: {
      tokenHash: await hashSessionToken(sessionToken),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000)
    }
  });
  SESSION_COOKIE = `occ_session=${sessionToken}`;
  logs.push({
    at: new Date().toISOString(),
    type: "auth_session_created"
  });
}

async function cleanupTemporarySession(logs) {
  const rawToken = SESSION_COOKIE.replace(/^occ_session=/, "").trim();
  if (!rawToken) {
    return;
  }
  await prisma.authSession.deleteMany({
    where: {
      tokenHash: await hashSessionToken(rawToken)
    }
  });
  logs.push({
    at: new Date().toISOString(),
    type: "auth_session_cleaned"
  });
}

async function ensureAuthAndRuntime(logs) {
  const authStatusResp = await req("GET", "/api/auth/status");
  if (authStatusResp.status !== 200) {
    logs.push({
      at: new Date().toISOString(),
      type: "auth_status_unavailable",
      status: authStatusResp.status
    });
    return {
      authenticated: false,
      runtime: null,
      runtimeStatus: null
    };
  }

  const authStatus = unwrap(authStatusResp.body) || authStatusResp.body || {};
  logs.push({
    at: new Date().toISOString(),
    type: "auth_status",
    setupComplete: Boolean(authStatus.setupComplete),
    authenticated: Boolean(authStatus.authenticated)
  });

  const runtimeResp = await req("GET", "/api/system/runtime");
  if (runtimeResp.status !== 200) {
    logs.push({
      at: new Date().toISOString(),
      type: "runtime_status_unavailable",
      status: runtimeResp.status
    });
    return {
      authenticated: false,
      runtime: null,
      runtimeStatus: runtimeResp.status
    };
  }

  const runtime = unwrap(runtimeResp.body) || runtimeResp.body;
  logs.push({
    at: new Date().toISOString(),
    type: "runtime_status",
    mode: runtime?.mode,
    requestedMode: runtime?.requestedMode,
    configured: runtime?.configured
  });

  return {
    authenticated: true,
    runtime,
    runtimeStatus: runtimeResp.status
  };
}

async function handleRequiredActions(project, actions, logs) {
  const list = Array.isArray(actions) ? actions : [];
  const has = (action) => list.some((item) => item?.action === action);
  logs.push({ at: new Date().toISOString(), type: "required_actions", list });

  const needRuntimeRefresh = has("refresh_runtime");
  if (needRuntimeRefresh) {
    const validate = await req("POST", "/api/system/runtime/validate", {}, 180000);
    logs.push({
      at: new Date().toISOString(),
      type: "runtime_validate",
      status: validate.status,
      code: validate.body?.error?.code || validate.body?.code || null
    });
    // refresh_runtime can coexist with actionable items (e.g. review_pending_stage),
    // so only return early when it is the sole required action.
    if (list.length === 1) {
      const detail = await req("GET", `/api/projects/${encodeURIComponent(project.id)}`, null, REQUEST_TIMEOUT_MS);
      if (detail.status === 200) {
        return unwrap(detail.body);
      }
      return project;
    }
  }

  if (has("review_pending_stage")) {
    const approve = await req("POST", `/api/projects/${encodeURIComponent(project.id)}/approve`, {});
    if (isTransportRetryable(approve)) {
      logs.push({
        at: new Date().toISOString(),
        type: "required_action_retryable_transport",
        action: "review_pending_stage",
        status: approve.status,
        code: approve.body?.error?.code
      });
      return project;
    }
    if (approve.status !== 200) {
      throw new Error(`approve failed: ${approve.status} ${JSON.stringify(approve.body).slice(0, 500)}`);
    }
    return unwrap(approve.body);
  }

  if (has("open_design_review")) {
    const reviewContent = [
      "# 设计审查卡.md",
      "## 视觉方案",
      "- 优先呈现爆品监控、排名变化、跟品链接三大核心视图。",
      "## 版式策略",
      "- 首屏突出实时告警和重点指标，三秒内可定位爆品变化。",
      "## 组件清单",
      "- 榜单卡片、趋势图、跟品链接操作卡、风险提示条。",
      "## 品牌语气",
      "- 专业、直接、可执行，避免空泛描述。",
      "## UX 原则",
      "- 主链路优先；低延迟反馈；减少认知切换。",
      "## 可访问性检查",
      "- 语义化结构；键盘可达；对比度达标。",
      "## 验收检查清单",
      "- [x] 设计说明可支撑开发实施，不依赖口头解释。",
      "- [x] 无障碍检查项至少 3 条并可验证。",
      "- [x] 审查结论明确（通过/驳回）且有理由。",
      "## 设计审查卡",
      "- 审查结论: 通过"
    ].join("\n");
    const submit = await req("POST", `/api/projects/${encodeURIComponent(project.id)}/stages/submit`, {
      title: "设计审查卡.md",
      content: reviewContent,
      designReview: {
        visualDirection: "实时决策控制台",
        brandTone: "专业、可执行、清晰",
        uxPrinciples: ["主链路优先", "反馈可解释", "低延迟可感知"],
        accessibilityChecklist: ["语义结构完整", "键盘可达", "对比度达标"],
        approvedBy: "系统自动审查",
        approved: true,
        notes: "第2轮真实数据门禁验证自动提交"
      }
    }, 180000);
    if (isTransportRetryable(submit)) {
      logs.push({
        at: new Date().toISOString(),
        type: "required_action_retryable_transport",
        action: "open_design_review",
        status: submit.status,
        code: submit.body?.error?.code
      });
      return project;
    }
    if (submit.status !== 200) {
      throw new Error(`submit design review failed: ${submit.status} ${JSON.stringify(submit.body).slice(0, 500)}`);
    }
    return unwrap(submit.body);
  }

  if (has("reconcile_deliverables")) {
    const reconcile = await req("POST", `/api/projects/${encodeURIComponent(project.id)}/reconcile-deliverables`, {});
    if (isTransportRetryable(reconcile)) {
      logs.push({
        at: new Date().toISOString(),
        type: "required_action_retryable_transport",
        action: "reconcile_deliverables",
        status: reconcile.status,
        code: reconcile.body?.error?.code
      });
      return project;
    }
    if (reconcile.status !== 200) {
      throw new Error(`reconcile failed: ${reconcile.status} ${JSON.stringify(reconcile.body).slice(0, 500)}`);
    }
    return unwrap(reconcile.body);
  }

  if (has("resolve_blocked_tasks")) {
    const tasksResp = await req("GET", `/api/projects/${encodeURIComponent(project.id)}/tasks`);
    if (isTransportRetryable(tasksResp)) {
      logs.push({
        at: new Date().toISOString(),
        type: "required_action_retryable_transport",
        action: "resolve_blocked_tasks_list",
        status: tasksResp.status,
        code: tasksResp.body?.error?.code
      });
      return project;
    }
    if (tasksResp.status !== 200) {
      throw new Error(`list tasks failed: ${tasksResp.status}`);
    }
    const tasks = unwrap(tasksResp.body) || [];
    for (const task of tasks) {
      if (task?.status === "blocked") {
        const patch = await req("PATCH", `/api/tasks/${encodeURIComponent(task.id)}`, { status: "done" });
        if (isTransportRetryable(patch)) {
          logs.push({
            at: new Date().toISOString(),
            type: "required_action_retryable_transport",
            action: "resolve_blocked_tasks_patch",
            taskId: task?.id,
            status: patch.status,
            code: patch.body?.error?.code
          });
          return project;
        }
        if (patch.status !== 200) {
          throw new Error(`patch task failed: ${patch.status}`);
        }
      }
    }
    const detail = await req("GET", `/api/projects/${encodeURIComponent(project.id)}`);
    if (isTransportRetryable(detail)) {
      logs.push({
        at: new Date().toISOString(),
        type: "required_action_retryable_transport",
        action: "resolve_blocked_tasks_detail",
        status: detail.status,
        code: detail.body?.error?.code
      });
      return project;
    }
    if (detail.status !== 200) {
      throw new Error(`detail after resolving blocked tasks failed: ${detail.status}`);
    }
    return unwrap(detail.body);
  }

  throw new Error(`unhandled required actions: ${JSON.stringify(list).slice(0, 300)}`);
}

async function main() {
  const logs = [];
  const startedAt = new Date().toISOString();
  try {
    await ensureApiReady(logs);
    await createTemporarySession(logs);

    const authAndRuntime = await ensureAuthAndRuntime(logs);
    if (!SKIP_RUNTIME_PREFLIGHT) {
      const runtime = authAndRuntime.runtime;
      const runtimeReady = Boolean(
        runtime
      && runtime.mode === "openai-compatible"
      && runtime.requestedMode === "openai-compatible"
      && runtime.configured
    );
    if (!runtimeReady) {
      const report = {
        ok: false,
        startedAt,
        finishedAt: new Date().toISOString(),
        apiBase: API_BASE,
        projectId: null,
        requirement,
        blockedBy: "RUNTIME_NOT_READY",
        runtime,
        quality: {
          projectCompleted: false,
          readyForAcceptance: false,
          allSuccessExecutionsAreReal: false,
          allSuccessExecutionsNonDegraded: false,
          stageCoverageMissing: stageMustHaveExecutions,
          roleCoverageMissing: requiredRoles,
          noPlaceholder: false
        },
        stageTransitions: [],
        stageSummary: [],
        roleSummary: [],
        scriptedExecutions: [],
        degradedExecutions: [],
        executionCount: 0,
        successExecutionCount: 0,
        logs
      };
      const outPath = writeReport(report);
      console.log(JSON.stringify({
        ok: report.ok,
        blockedBy: report.blockedBy,
        runtime: report.runtime,
        outPath
      }, null, 2));
      process.stderr.write(`verify-real-data-round2 blocked by runtime preflight, report: ${outPath}\n`);
        process.exitCode = 1;
        return;
      }
    }

    const createResp = await req("POST", "/api/projects", {
      name: `real-data-round2-${Date.now()}`,
      description: requirement,
      team: ["ROLE_PM", "ROLE_ANALYST", "ROLE_PRODUCT", "ROLE_DESIGN", "ROLE_ARCH", "ROLE_DEV", "ROLE_QA"]
    }, 240000);
    if (createResp.status !== 201) {
      throw new Error(`create project failed: ${createResp.status} ${JSON.stringify(createResp.body).slice(0, 500)}`);
    }

  let project = unwrap(createResp.body);
  const projectId = String(project?.id || "");
  if (!projectId) {
    throw new Error("missing project id");
  }
  logs.push({ at: new Date().toISOString(), type: "project_created", project: summarizeProject(project) });

  const stageTransitions = [];
  let previousStage = project.currentStage;
  let inProgressBonusRounds = 0;
  let lastProgressFingerprint = `${project.status}|${project.currentStage}|${project.currentRole}|${project.pendingApproval ? 1 : 0}|${project.progress}`;

  for (let i = 1; i <= MAX_ROUNDS; i += 1) {
    const detail = await req("GET", `/api/projects/${encodeURIComponent(projectId)}`, null, REQUEST_TIMEOUT_MS);
    if (isTransportRetryable(detail)) {
      logs.push({
        at: new Date().toISOString(),
        type: "detail_retryable_transport",
        round: i,
        status: detail.status,
        code: detail.body?.error?.code
      });
      await WAIT(2000);
      i -= 1;
      continue;
    }
    if (detail.status !== 200) {
      throw new Error(`project detail failed: round=${i} status=${detail.status}`);
    }
    project = unwrap(detail.body);
    const currentProgressFingerprint = `${project.status}|${project.currentStage}|${project.currentRole}|${project.pendingApproval ? 1 : 0}|${project.progress}`;
    if (currentProgressFingerprint !== lastProgressFingerprint) {
      inProgressBonusRounds = 0;
      lastProgressFingerprint = currentProgressFingerprint;
    }

    if (project.currentStage !== previousStage) {
      stageTransitions.push({
        at: new Date().toISOString(),
        from: previousStage,
        to: project.currentStage,
        progress: project.progress
      });
      previousStage = project.currentStage;
    }

    if (project.status === "completed") {
      logs.push({ at: new Date().toISOString(), type: "completed", round: i, project: summarizeProject(project) });
      break;
    }

    if (project.pendingApproval) {
      const pendingRequiredActions = Array.isArray(project?.requiredActions) ? project.requiredActions : [];
      if (pendingRequiredActions.length > 0) {
        project = await handleRequiredActions(project, pendingRequiredActions, logs);
        inProgressBonusRounds = 0;
        continue;
      }
      const approve = await req("POST", `/api/projects/${encodeURIComponent(projectId)}/approve`, {});
      if (isTransportRetryable(approve)) {
        logs.push({
          at: new Date().toISOString(),
          type: "approve_retryable_transport",
          round: i,
          status: approve.status,
          code: approve.body?.error?.code
        });
        await WAIT(2500);
        i -= 1;
        continue;
      }
      if (approve.status === 422 && approve.body?.error?.code === "STAGE_TEMPLATE_VALIDATION_FAILED") {
        logs.push({
          at: new Date().toISOString(),
          type: "approve_template_gate_retry",
          round: i,
          project: summarizeProject(project),
          message: String(approve.body?.error?.message || "")
        });
        const reconcile = await req("POST", `/api/projects/${encodeURIComponent(projectId)}/reconcile-deliverables`, {});
        if (reconcile.status === 200) {
          project = unwrap(reconcile.body);
        } else if (isTransportRetryable(reconcile)) {
          logs.push({
            at: new Date().toISOString(),
            type: "reconcile_retryable_transport",
            round: i,
            status: reconcile.status,
            code: reconcile.body?.error?.code
          });
        }
        await WAIT(2000);
        continue;
      }
      if (approve.status === 422 && approve.body?.error?.code === "REAL_MODEL_GATE_FAILED") {
        const actions = approve.body?.error?.requiredActions;
        if (Array.isArray(actions) && actions.length > 0) {
          project = await handleRequiredActions(project, actions, logs);
          await WAIT(2000);
          continue;
        }
      }
      if (approve.status !== 200) {
        throw new Error(`approve failed: round=${i} status=${approve.status} body=${JSON.stringify(approve.body).slice(0, 800)}`);
      }
      inProgressBonusRounds = 0;
      project = unwrap(approve.body);
      continue;
    }

    // Prefer consuming actionable requiredActions from project detail directly.
    const detailRequiredActions = Array.isArray(project?.requiredActions) ? project.requiredActions : [];
    if (detailRequiredActions.length > 0) {
      project = await handleRequiredActions(project, detailRequiredActions, logs);
      inProgressBonusRounds = 0;
      continue;
    }

    const advance = await req("POST", `/api/projects/${encodeURIComponent(projectId)}/advance`, {}, ADVANCE_TIMEOUT_MS);
    const code = advance.body?.error?.code;
    logs.push({ at: new Date().toISOString(), type: "advance", round: i, status: advance.status, code });

    if (advance.status === 200) {
      project = unwrap(advance.body);
      continue;
    }

    if (advance.status === 409 && code === "PROJECT_ADVANCE_IN_PROGRESS") {
      inProgressBonusRounds += 1;
      if (inProgressBonusRounds > MAX_IN_PROGRESS_BONUS_ROUNDS) {
        throw new Error(`advance still in progress after ${inProgressBonusRounds} bonus rounds`);
      }
      const pollAfter = Number(advance.body?.error?.pollAfterMs || 1500);
      await WAIT(Math.max(1000, Math.min(7000, pollAfter)));
      i -= 1;
      continue;
    }

    if (isTransportRetryable(advance)) {
      inProgressBonusRounds += 1;
      if (inProgressBonusRounds > MAX_IN_PROGRESS_BONUS_ROUNDS) {
        throw new Error(`advance retryable transport status persists after ${inProgressBonusRounds} bonus rounds`);
      }
      await WAIT(2500);
      i -= 1;
      continue;
    }

    if (advance.status === 409 && code === "REQUIRES_USER_INTERVENTION") {
      project = await handleRequiredActions(project, advance.body?.error?.requiredActions, logs);
      continue;
    }

    if (advance.status === 409 && code === "PROJECT_ADVANCE_FAILED") {
      const failedMessage = String(advance.body?.error?.message || "");
      if (failedMessage.includes("REAL_MODEL_GATE_FAILED")) {
        logs.push({
          at: new Date().toISOString(),
          type: "advance_real_model_gate_retry",
          round: i,
          message: failedMessage.slice(0, 600)
        });
        const actions = Array.isArray(advance.body?.error?.requiredActions)
          ? advance.body.error.requiredActions
          : [{ action: "refresh_runtime" }];
        project = await handleRequiredActions(project, actions, logs);
        await WAIT(2500);
        continue;
      }
      if (failedMessage.includes("STAGE_TEMPLATE_VALIDATION_FAILED")) {
        logs.push({
          at: new Date().toISOString(),
          type: "advance_template_gate_retry",
          round: i,
          message: failedMessage.slice(0, 600)
        });
        const reconcile = await req("POST", `/api/projects/${encodeURIComponent(projectId)}/reconcile-deliverables`, {});
        if (reconcile.status === 200) {
          project = unwrap(reconcile.body);
          await WAIT(2000);
          continue;
        }
        if (isTransportRetryable(reconcile)) {
          await WAIT(2500);
          i -= 1;
          continue;
        }
      }
      throw new Error(`advance failed: ${JSON.stringify(advance.body).slice(0, 800)}`);
    }

    throw new Error(`unexpected advance response: status=${advance.status} code=${code} body=${JSON.stringify(advance.body).slice(0, 800)}`);
  }

  let finalDetail = await req("GET", `/api/projects/${encodeURIComponent(projectId)}`, null, REQUEST_TIMEOUT_MS);
  for (let retry = 0; retry < 2 && isTransportRetryable(finalDetail); retry += 1) {
    await WAIT(2000);
    finalDetail = await req("GET", `/api/projects/${encodeURIComponent(projectId)}`, null, REQUEST_TIMEOUT_MS);
  }
  if (finalDetail.status !== 200) {
    throw new Error(`final detail failed: ${finalDetail.status}`);
  }
  const finalProject = unwrap(finalDetail.body);

  let executionsResp = await req("GET", `/api/projects/${encodeURIComponent(projectId)}/executions?limit=800`, null, REQUEST_TIMEOUT_MS);
  for (let retry = 0; retry < 2 && isTransportRetryable(executionsResp); retry += 1) {
    await WAIT(2000);
    executionsResp = await req("GET", `/api/projects/${encodeURIComponent(projectId)}/executions?limit=800`, null, REQUEST_TIMEOUT_MS);
  }
  if (executionsResp.status !== 200) {
    throw new Error(`list executions failed: ${executionsResp.status}`);
  }
  const executions = (unwrap(executionsResp.body)?.executions) || [];
  const successExecutions = executions.filter((row) => row.status === "success");
  const scriptedExecutions = successExecutions.filter((row) => String(row.provider || "").toLowerCase() === "scripted");
  const degradedExecutions = successExecutions.filter((row) => isDegraded(row.metadata));

  const stageSummary = stageOrder.map((stage) => {
    const rows = successExecutions.filter((row) => row.stageType === stage);
    return {
      stage,
      successCount: rows.length,
      providers: [...new Set(rows.map((row) => row.provider).filter(Boolean))],
      models: [...new Set(rows.map((row) => row.model).filter(Boolean))],
      roles: [...new Set(rows.map((row) => row.role).filter(Boolean))]
    };
  });

  const roleSummary = requiredRoles.map((role) => {
    const rows = successExecutions.filter((row) => row.role === role);
    return {
      role,
      successCount: rows.length,
      scriptedCount: rows.filter((row) => String(row.provider || "").toLowerCase() === "scripted").length,
      degradedCount: rows.filter((row) => isDegraded(row.metadata)).length,
      providers: [...new Set(rows.map((row) => row.provider).filter(Boolean))],
      models: [...new Set(rows.map((row) => row.model).filter(Boolean))]
    };
  });

  const stageCoverageMissing = stageMustHaveExecutions.filter((stage) =>
    stageSummary.find((item) => item.stage === stage)?.successCount === 0
  );
  const roleCoverageMissing = roleSummary.filter((item) => item.successCount === 0).map((item) => item.role);

  const finalArtifactsResp = await req("GET", `/api/projects/${encodeURIComponent(projectId)}/final-artifacts`);
  const finalArtifacts = finalArtifactsResp.status === 200 ? unwrap(finalArtifactsResp.body) : null;
  const deliverables = Array.isArray(finalProject?.deliverables) ? finalProject.deliverables : [];
  const placeholderHits = deliverables.filter((d) => /待补充|占位(词|符)?|TODO|TBD|lorem ipsum|\bxxx\b/i.test(String(d?.content || ""))).map((d) => d.name);

  const quality = {
    projectCompleted: finalProject?.status === "completed",
    readyForAcceptance: Boolean(finalArtifacts?.readyForAcceptance),
    allSuccessExecutionsAreReal: scriptedExecutions.length === 0,
    allSuccessExecutionsNonDegraded: degradedExecutions.length === 0,
    stageCoverageMissing,
    roleCoverageMissing,
    noPlaceholder: placeholderHits.length === 0
  };

  const pass = quality.projectCompleted
    && quality.readyForAcceptance
    && quality.allSuccessExecutionsAreReal
    && quality.allSuccessExecutionsNonDegraded
    && quality.stageCoverageMissing.length === 0
    && quality.roleCoverageMissing.length === 0
    && quality.noPlaceholder;

  const report = {
    ok: pass,
    startedAt,
    finishedAt: new Date().toISOString(),
    apiBase: API_BASE,
    projectId,
    requirement,
    finalProject: summarizeProject(finalProject),
    quality,
    stageTransitions,
    stageSummary,
    roleSummary,
    scriptedExecutions: scriptedExecutions.map((row) => ({
      stageType: row.stageType,
      role: row.role,
      provider: row.provider,
      model: row.model,
      createdAt: row.createdAt
    })),
    degradedExecutions: degradedExecutions.map((row) => ({
      stageType: row.stageType,
      role: row.role,
      provider: row.provider,
      model: row.model,
      createdAt: row.createdAt
    })),
    executionCount: executions.length,
    successExecutionCount: successExecutions.length,
    logs
  };

  const outPath = writeReport(report);

  console.log(JSON.stringify({
    ok: report.ok,
    outPath,
    projectId: report.projectId,
    quality: report.quality
  }, null, 2));

    if (!report.ok) {
      process.stderr.write(`verify-real-data-round2 failed, report: ${outPath}\n`);
      process.exitCode = 1;
    }
  } finally {
    await cleanupTemporarySession(logs);
    await prisma.$disconnect();
    stopStartedApi(logs);
  }
}

main().catch((error) => {
  console.error(String(error?.stack || error));
  process.exit(1);
});
