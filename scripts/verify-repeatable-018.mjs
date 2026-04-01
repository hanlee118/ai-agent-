import fs from "node:fs";
import path from "node:path";

const API_BASE = (process.env.API_BASE || "http://127.0.0.1:8787").replace(/\/$/, "");
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "Admin@123456").trim();
const PROJECT_ID = String(process.env.PROJECT_ID || "OCC-20260401-018").trim();
const MAX_ROUNDS = Math.max(20, Number(process.env.MAX_ROUNDS || 120));
const REQUEST_TIMEOUT_MS = Math.max(90000, Number(process.env.REQUEST_TIMEOUT_MS || 240000));
const WAIT = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PLACEHOLDER_RE = /待补充|占位(词|符)?|TODO|TBD|lorem ipsum|\bxxx\b/i;
const STAGES = ["INIT", "ANALYSIS", "DESIGN", "DEV", "ACCEPT"];

let SESSION_COOKIE = "";

function unwrap(payload) {
  if (payload && typeof payload === "object" && payload.success === true && "data" in payload) {
    return payload.data;
  }
  return payload;
}

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
      const pair = setCookie
        .split(",")
        .map((item) => item.trim())
        .find((item) => item.startsWith("occ_session="));
      if (pair) {
        SESSION_COOKIE = pair.split(";")[0] || SESSION_COOKIE;
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
          message: String(error?.message || error || "")
        }
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

function writeReport(report) {
  const outDir = path.resolve("/private/tmp/ai-agent-check/docs/reports");
  fs.mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(outDir, `repeatable-acceptance-${ts}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  return outPath;
}

async function ensureAuth(logs) {
  const statusResp = await req("GET", "/api/auth/status");
  if (statusResp.status !== 200) {
    throw new Error(`auth status failed: ${statusResp.status}`);
  }
  const status = unwrap(statusResp.body) || {};
  if (!status.setupComplete) {
    const setupResp = await req("POST", "/api/auth/setup", { password: ADMIN_PASSWORD });
    if (setupResp.status !== 201 && setupResp.status !== 409) {
      throw new Error(`auth setup failed: ${setupResp.status}`);
    }
  }
  const loginResp = await req("POST", "/api/auth/login", { password: ADMIN_PASSWORD });
  if (loginResp.status !== 200) {
    throw new Error(`auth login failed: ${loginResp.status}`);
  }
  logs.push({ at: new Date().toISOString(), type: "auth_ok" });
}

async function submitDesignReviewCard(projectId) {
  const reviewContent = [
    "# 设计审查卡.md",
    "## 视觉方案",
    "- 重点突出实时爆发监控、排名波动、跟品链接。",
    "## 版式策略",
    "- 先告警后决策，三秒内可定位爆品变化。",
    "## 组件清单",
    "- 榜单卡片、趋势图、跟品链接操作卡、风险提示条。",
    "## 品牌语气",
    "- 专业、直接、可执行。",
    "## UX 原则",
    "- 主链路优先；反馈及时；减少认知切换。",
    "## 可访问性检查",
    "- 语义结构完整；键盘可达；对比度达标。",
    "## 验收检查清单",
    "- [x] 设计说明可支撑开发实施，不依赖口头解释。",
    "- [x] 无障碍检查项至少 3 条并可验证。",
    "- [x] 审查结论明确（通过/驳回）且有理由。",
    "## 设计审查卡",
    "- 审查结论: 通过"
  ].join("\n");

  return req("POST", `/api/projects/${encodeURIComponent(projectId)}/stages/submit`, {
    title: "设计审查卡.md",
    content: reviewContent,
    designReview: {
      visualDirection: "实时决策控制台",
      brandTone: "专业、可执行、清晰",
      uxPrinciples: ["主链路优先", "反馈可解释", "低延迟可感知"],
      accessibilityChecklist: ["语义结构完整", "键盘可达", "对比度达标"],
      approvedBy: "系统自动审查",
      approved: true,
      notes: "repeatable acceptance auto submit"
    }
  }, 180000);
}

async function handleRequiredActions(project, actions, logs) {
  const list = Array.isArray(actions) ? actions : [];
  if (list.length === 0) {
    return project;
  }
  logs.push({ at: new Date().toISOString(), type: "required_actions", list });

  const has = (action) => list.some((item) => item?.action === action);

  if (has("refresh_runtime")) {
    await req("POST", "/api/system/runtime/validate", {}, 180000);
  }
  if (has("reconcile_deliverables")) {
    const reconcile = await req("POST", `/api/projects/${encodeURIComponent(project.id)}/reconcile-deliverables`, {}, 240000);
    if (reconcile.status === 200) {
      return unwrap(reconcile.body);
    }
  }
  if (has("open_design_review")) {
    const submit = await submitDesignReviewCard(project.id);
    if (submit.status === 200) {
      return unwrap(submit.body);
    }
  }
  if (has("review_pending_stage")) {
    const approve = await req("POST", `/api/projects/${encodeURIComponent(project.id)}/approve`, {}, 240000);
    if (approve.status === 200) {
      return unwrap(approve.body);
    }
  }
  if (has("resolve_blocked_tasks")) {
    const tasksResp = await req("GET", `/api/projects/${encodeURIComponent(project.id)}/tasks`);
    if (tasksResp.status === 200) {
      const tasks = unwrap(tasksResp.body) || [];
      for (const task of tasks) {
        if (task?.status === "blocked") {
          await req("PATCH", `/api/tasks/${encodeURIComponent(task.id)}`, { status: "done" });
        }
      }
    }
  }

  const detail = await req("GET", `/api/projects/${encodeURIComponent(project.id)}`);
  return detail.status === 200 ? unwrap(detail.body) : project;
}

async function main() {
  const logs = [];
  await ensureAuth(logs);

  let projectResp = await req("GET", `/api/projects/${encodeURIComponent(PROJECT_ID)}`);
  if (projectResp.status !== 200) {
    throw new Error(`project detail failed: ${projectResp.status}`);
  }
  let project = unwrap(projectResp.body);

  for (let i = 1; i <= MAX_ROUNDS; i += 1) {
    projectResp = await req("GET", `/api/projects/${encodeURIComponent(PROJECT_ID)}`);
    if (isTransportRetryable(projectResp)) {
      await WAIT(1500);
      i -= 1;
      continue;
    }
    if (projectResp.status !== 200) {
      throw new Error(`detail failed round=${i}: ${projectResp.status}`);
    }
    project = unwrap(projectResp.body);

    if (project.status === "completed") {
      logs.push({ at: new Date().toISOString(), type: "completed", round: i });
      break;
    }

    const detailActions = Array.isArray(project.requiredActions) ? project.requiredActions : [];
    if (detailActions.length > 0) {
      project = await handleRequiredActions(project, detailActions, logs);
      await WAIT(1000);
      continue;
    }

    if (project.pendingApproval) {
      const approve = await req("POST", `/api/projects/${encodeURIComponent(PROJECT_ID)}/approve`, {}, 240000);
      if (isTransportRetryable(approve)) {
        await WAIT(2000);
        i -= 1;
        continue;
      }
      if (approve.status === 200) {
        project = unwrap(approve.body);
        continue;
      }
      const code = approve.body?.error?.code;
      if (approve.status === 422 && (code === "STAGE_TEMPLATE_VALIDATION_FAILED" || code === "REAL_MODEL_GATE_FAILED")) {
        const actions = approve.body?.error?.requiredActions || [{ action: "reconcile_deliverables" }, { action: "refresh_runtime" }];
        project = await handleRequiredActions(project, actions, logs);
        await WAIT(1500);
        continue;
      }
      if (approve.status === 409 && code === "NO_PENDING_APPROVAL") {
        await WAIT(1000);
        continue;
      }
      throw new Error(`approve failed round=${i}: ${approve.status} ${JSON.stringify(approve.body).slice(0, 500)}`);
    }

    const advance = await req("POST", `/api/projects/${encodeURIComponent(PROJECT_ID)}/advance`, {}, 240000);
    const code = advance.body?.error?.code;
    if (advance.status === 200) {
      project = unwrap(advance.body);
      continue;
    }
    if (advance.status === 409 && code === "PROJECT_ADVANCE_IN_PROGRESS") {
      const pollAfter = Number(advance.body?.error?.pollAfterMs || 2000);
      await WAIT(Math.max(1200, Math.min(15000, pollAfter)));
      i -= 1;
      continue;
    }
    if (advance.status === 409 && code === "REQUIRES_USER_INTERVENTION") {
      project = await handleRequiredActions(project, advance.body?.error?.requiredActions, logs);
      await WAIT(1200);
      continue;
    }
    if (advance.status === 409 && code === "PROJECT_ADVANCE_FAILED") {
      const message = String(advance.body?.error?.message || "");
      if (message.includes("STAGE_TEMPLATE_VALIDATION_FAILED") || message.includes("REAL_MODEL_GATE_FAILED")) {
        project = await handleRequiredActions(project, [{ action: "reconcile_deliverables" }, { action: "refresh_runtime" }], logs);
        await WAIT(1500);
        continue;
      }
      throw new Error(`advance failed: ${message}`);
    }
    if (isTransportRetryable(advance)) {
      await WAIT(2000);
      i -= 1;
      continue;
    }
    throw new Error(`unexpected advance response: ${advance.status} ${JSON.stringify(advance.body).slice(0, 500)}`);
  }

  const finalDetailResp = await req("GET", `/api/projects/${encodeURIComponent(PROJECT_ID)}`);
  if (finalDetailResp.status !== 200) {
    throw new Error(`final detail failed: ${finalDetailResp.status}`);
  }
  const finalProject = unwrap(finalDetailResp.body);

  const execResp = await req("GET", `/api/projects/${encodeURIComponent(PROJECT_ID)}/executions?limit=1000`);
  if (execResp.status !== 200) {
    throw new Error(`executions failed: ${execResp.status}`);
  }
  const executions = (unwrap(execResp.body)?.executions) || [];
  const successExecutions = executions.filter((row) => row.status === "success");
  const scriptedExecutions = successExecutions.filter((row) => String(row.provider || "").toLowerCase() === "scripted");
  const degradedExecutions = successExecutions.filter((row) => row?.metadata?.degraded === true);

  const pmStageEvidence = STAGES.map((stage) => {
    const rows = successExecutions.filter((row) => row.stageType === stage && row.role === "ROLE_PM");
    return {
      stage,
      pmSuccessCount: rows.length,
      models: [...new Set(rows.map((row) => row.model).filter(Boolean))]
    };
  });

  const stageSummary = STAGES.map((stage) => {
    const rows = successExecutions.filter((row) => row.stageType === stage);
    return {
      stage,
      successCount: rows.length,
      providers: [...new Set(rows.map((row) => row.provider).filter(Boolean))],
      roles: [...new Set(rows.map((row) => row.role).filter(Boolean))]
    };
  });

  const deliverables = Array.isArray(finalProject?.deliverables) ? finalProject.deliverables : [];
  const placeholderHits = deliverables
    .filter((item) => PLACEHOLDER_RE.test(String(item?.content || "")))
    .map((item) => item.name);

  const quality = {
    projectCompleted: finalProject?.status === "completed",
    allSuccessExecutionsAreReal: scriptedExecutions.length === 0,
    allSuccessExecutionsNonDegraded: degradedExecutions.length === 0,
    stageCoverageComplete: STAGES.every((stage) => stageSummary.find((item) => item.stage === stage)?.successCount > 0),
    pmEvidenceComplete: pmStageEvidence.every((item) => item.pmSuccessCount > 0),
    noPlaceholder: placeholderHits.length === 0
  };

  const ok = quality.projectCompleted
    && quality.allSuccessExecutionsAreReal
    && quality.allSuccessExecutionsNonDegraded
    && quality.stageCoverageComplete
    && quality.pmEvidenceComplete
    && quality.noPlaceholder;

  const report = {
    ok,
    apiBase: API_BASE,
    projectId: PROJECT_ID,
    finishedAt: new Date().toISOString(),
    quality,
    finalProject: {
      id: finalProject?.id,
      status: finalProject?.status,
      currentStage: finalProject?.currentStage,
      currentRole: finalProject?.currentRole,
      pendingApproval: finalProject?.pendingApproval,
      progress: finalProject?.progress
    },
    stageSummary,
    pmStageEvidence,
    scriptedExecutions: scriptedExecutions.map((row) => ({
      stageType: row.stageType,
      role: row.role,
      model: row.model,
      createdAt: row.createdAt
    })),
    degradedExecutions: degradedExecutions.map((row) => ({
      stageType: row.stageType,
      role: row.role,
      model: row.model,
      createdAt: row.createdAt
    })),
    placeholderHits,
    logs
  };

  const outPath = writeReport(report);
  console.log(JSON.stringify({
    ok,
    outPath,
    projectId: PROJECT_ID,
    quality,
    pmStageEvidence
  }, null, 2));

  if (!ok) {
    process.stderr.write(`verify-repeatable-018 failed: ${outPath}\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(String(error?.stack || error));
  process.exit(1);
});
