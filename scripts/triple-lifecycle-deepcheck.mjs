import http from "node:http";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { prisma } from "../apps/api/dist/db.js";
import { generateSessionToken, hashSessionToken } from "../apps/api/dist/security/secret-store.js";

const BASE = String(process.env.API_BASE || "http://127.0.0.1:8787").replace(/\/$/, "");
const REQUEST_TIMEOUT_MS = Math.max(15000, Number(process.env.REQUEST_TIMEOUT_MS || 240000));
const MAX_ROUNDS = Math.max(36, Number(process.env.MAX_ROUNDS || 220));
const RUN_TIMEOUT_MS = Math.max(180000, Number(process.env.RUN_TIMEOUT_MS || 18 * 60 * 1000));
const SESSION_TTL_MS = Math.max(30 * 60 * 1000, Number(process.env.SESSION_TTL_MS || 4 * 60 * 60 * 1000));
const MAX_IN_PROGRESS_WAIT_MS = Math.max(60 * 1000, Number(process.env.MAX_IN_PROGRESS_WAIT_MS || 12 * 60 * 1000));
const CLEANUP_PROJECTS = String(process.env.CLEANUP_PROJECTS || "true").toLowerCase() !== "false";
const OUT_DIR = path.resolve(process.cwd(), "docs/reports");

const STAGES = ["INIT", "ANALYSIS", "DESIGN", "DEV", "ACCEPT"];
const SCAFFOLD_PATTERN =
  /模板章节骨架（自动补齐）|模板章节骨架（请按模板补全）|请结合(?:本阶段)?(?:\s*任务证据(?:与|和)?\s*(?:Agent\s*(?:输出正文|正文))?|(?:\s*Agent\s*(?:输出正文|正文))?\s*与任务证据)(?:补全|完善)本节|请结合(?:\s*Agent\s*输出正文)?与任务证据(?:补全|完善)本节/i;
const CODE_PATH_PATTERN = /(?:^|\s)((?:apps?|src|packages|server|client|web|api)\/[a-zA-Z0-9_./-]+\.(?:ts|tsx|js|jsx|json|sql|prisma|yml|yaml|sh))/g;
const VALIDATION_SIGNAL_PATTERN =
  /(curl\s+https?:\/\/|\/health|http\s*200|响应\s*200|e2e|端到端|联调通过|回归通过|测试通过|验证结果)/i;

const REQUIREMENTS = [
  "帮我做跨境电商爆品跟品平台：监控 TikTok/Amazon 爆量商品，展示榜单、爆发指标、商品链接，并支持手动加入持续跟踪。",
  "我要做跨境选品中台：支持 Temu/TikTok 双平台流量突增预警、商品详情分析、跟品池管理和告警回溯。",
  "请做跨境爆品雷达系统：实时采集 Amazon 与 TikTok 热门商品，输出排名变化、证据链、跟品决策和验收报告。"
];

const report = {
  ok: true,
  startedAt: new Date().toISOString(),
  base: BASE,
  maxRounds: MAX_ROUNDS,
  cleanupProjects: CLEANUP_PROJECTS,
  runs: [],
  failures: [],
  warnings: []
};

let SESSION_COOKIE = "";
let API_STARTED_BY_SCRIPT = false;

async function withTimeout(task, timeoutMs, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`RUN_TIMEOUT(${label}): exceeded ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function toPath(pathname) {
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function unwrap(payload) {
  if (payload && typeof payload === "object" && "success" in payload) {
    if (payload.success === true) {
      return payload.data;
    }
  }
  return payload;
}

function normalizeText(input) {
  return String(input || "").replace(/\s+/g, " ").trim();
}

function req(method, route, body, options = {}) {
  const timeoutMs = Math.max(5000, Number(options.timeoutMs || REQUEST_TIMEOUT_MS));
  const startedAt = Date.now();
  const url = new URL(`${BASE}${toPath(route)}`);
  const payload = body ? JSON.stringify(body) : "";

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        method,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        headers: payload
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(payload),
              ...(SESSION_COOKIE ? { Cookie: SESSION_COOKIE } : {})
            }
          : (SESSION_COOKIE ? { Cookie: SESSION_COOKIE } : undefined)
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          const setCookie = res.headers["set-cookie"];
          if (Array.isArray(setCookie)) {
            const cookie = setCookie
              .map((item) => String(item).trim())
              .find((item) => item.startsWith("occ_session="));
            if (cookie) {
              SESSION_COOKIE = cookie.split(";")[0] || SESSION_COOKIE;
            }
          }
          let parsed = raw;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            // keep raw text
          }
          resolve({
            status: res.statusCode || 0,
            durationMs: Date.now() - startedAt,
            body: parsed,
            unwrapped: unwrap(parsed)
          });
        });
      }
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`REQUEST_TIMEOUT: ${method} ${route} > ${timeoutMs}ms`));
    });
    request.on("error", reject);

    if (payload) {
      request.write(payload);
    }
    request.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.round(ms))));
}

async function ensureApiReady() {
  const health = await req("GET", "/health", null, { timeoutMs: 15000 });
  if (health.status === 200) {
    return;
  }

  execFileSync("pnpm", ["daemon:start"], {
    cwd: process.cwd(),
    stdio: "inherit"
  });
  API_STARTED_BY_SCRIPT = true;

  for (let i = 0; i < 25; i += 1) {
    const retry = await req("GET", "/health", null, { timeoutMs: 15000 });
    if (retry.status === 200) {
      return;
    }
    await sleep(1000);
  }

  throw new Error("API_NOT_READY_AFTER_DAEMON_START");
}

async function ensureAuth() {
  const status = await req("GET", "/api/auth/status");
  if (status.status !== 200) {
    throw new Error(`AUTH_STATUS_FAILED: ${status.status}`);
  }
  if (!status.unwrapped?.setupComplete) {
    throw new Error("AUTH_SETUP_INCOMPLETE");
  }

  const sessionToken = generateSessionToken();
  await prisma.authSession.create({
    data: {
      tokenHash: await hashSessionToken(sessionToken),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS)
    }
  });
  SESSION_COOKIE = `occ_session=${sessionToken}`;
}

async function cleanupAuth() {
  const token = SESSION_COOKIE.replace(/^occ_session=/, "").trim();
  if (!token) {
    return;
  }
  await prisma.authSession.deleteMany({
    where: {
      tokenHash: await hashSessionToken(token)
    }
  });
}

function stopStartedApi() {
  if (!API_STARTED_BY_SCRIPT) {
    return;
  }
  try {
    execFileSync("pnpm", ["daemon:stop"], {
      cwd: process.cwd(),
      stdio: "inherit"
    });
  } catch (error) {
    report.warnings.push(`自动停止 API 失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function getProject(projectId) {
  const detail = await req("GET", `/api/projects/${encodeURIComponent(projectId)}`);
  if (detail.status !== 200) {
    throw new Error(`GET_PROJECT_FAILED(${projectId}): ${detail.status}`);
  }
  return detail.unwrapped;
}

async function listExecutions(projectId) {
  const response = await req("GET", `/api/projects/${encodeURIComponent(projectId)}/executions?limit=500`);
  if (response.status !== 200) {
    throw new Error(`GET_EXECUTIONS_FAILED(${projectId}): ${response.status}`);
  }
  return response.unwrapped?.executions || [];
}

async function getFinalArtifacts(projectId) {
  const response = await req("GET", `/api/projects/${encodeURIComponent(projectId)}/final-artifacts`);
  if (response.status !== 200) {
    throw new Error(`GET_FINAL_ARTIFACTS_FAILED(${projectId}): ${response.status}`);
  }
  return response.unwrapped;
}

async function getOfficialSite(projectId) {
  const response = await req("GET", `/api/projects/${encodeURIComponent(projectId)}/official-site`);
  if (response.status !== 200) {
    throw new Error(`GET_OFFICIAL_SITE_FAILED(${projectId}): ${response.status}`);
  }
  return response.unwrapped;
}

async function fetchOfficialSiteHtml(url) {
  const absolute = new URL(url, BASE).toString();
  const target = new URL(absolute);

  return new Promise((resolve, reject) => {
    const reqObj = http.request(
      {
        method: "GET",
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        headers: SESSION_COOKIE ? { Cookie: SESSION_COOKIE } : undefined
      },
      (res) => {
        let html = "";
        res.on("data", (chunk) => {
          html += chunk;
        });
        res.on("end", () => {
          if ((res.statusCode || 0) >= 400) {
            reject(new Error(`OFFICIAL_SITE_HTML_FAILED: ${res.statusCode}`));
            return;
          }
          resolve(html);
        });
      }
    );
    reqObj.setTimeout(15000, () => {
      reqObj.destroy(new Error("OFFICIAL_SITE_HTML_TIMEOUT"));
    });
    reqObj.on("error", reject);
    reqObj.end();
  });
}

function buildDesignReviewPayload() {
  return {
    visualDirection: "跨境爆品监控控制台（榜单+详情+告警）",
    brandTone: "专业、直接、证据优先",
    uxPrinciples: ["主链路优先", "关键动作可达", "状态反馈即时"],
    accessibilityChecklist: ["键盘可达", "文本对比达标", "图表附带文字摘要"],
    approvedBy: "系统深检审查",
    approved: true,
    notes: "triple deepcheck auto submit"
  };
}

function buildDesignReviewContent(requirement) {
  return [
    "# 设计审查卡.md",
    "## 视觉方案",
    `- 视觉中心围绕真实业务对象：${normalizeText(requirement).slice(0, 80)}。`,
    "## 版式策略",
    "- 采用爆品榜单、商品详情、告警流三栏结构。",
    "## 组件清单",
    "- 榜单卡片、平台标签、趋势图、证据链、跟踪动作按钮。",
    "## 品牌语气",
    "- 专业、可执行、证据导向。",
    "## UX 原则",
    "- 主链路优先。",
    "- 状态可解释。",
    "- 操作反馈即时。",
    "## 可访问性检查",
    "- 键盘可达。",
    "- 文本对比度达标。",
    "- 图表有文字摘要。",
    "## 设计审查卡",
    "- 审查结论: 通过",
    "## 验收检查清单",
    "- 设计说明可支撑开发实施，不依赖口头解释。",
    "- 无障碍检查项至少 3 条并可验证。",
    "- 审查结论明确（通过/驳回）且有理由。"
  ].join("\n");
}

async function submitDesignReview(project, run) {
  const response = await req(
    "POST",
    `/api/projects/${encodeURIComponent(project.id)}/stages/submit`,
    {
      title: "设计审查卡.md",
      content: buildDesignReviewContent(run.requirement),
      designReview: buildDesignReviewPayload(),
      finalizeApproval: false
    },
    { timeoutMs: 120000 }
  );
  run.steps.push({
    step: "submit_design_review",
    status: response.status,
    durationMs: response.durationMs
  });
  if (response.status !== 200) {
    throw new Error(`SUBMIT_DESIGN_REVIEW_FAILED: ${response.status} ${JSON.stringify(response.body).slice(0, 400)}`);
  }
  return response.unwrapped;
}

async function resolveBlockedTasks(project, run) {
  const blocked = (project.tasks || []).filter((task) => task.status === "blocked");
  for (const task of blocked) {
    const response = await req("PATCH", `/api/tasks/${encodeURIComponent(task.id)}`, { status: "done" });
    run.steps.push({
      step: `resolve_blocked_${task.id}`,
      status: response.status,
      durationMs: response.durationMs
    });
    if (response.status !== 200) {
      throw new Error(`RESOLVE_BLOCKED_FAILED(${task.id}): ${response.status}`);
    }
  }
}

async function reconcileDeliverables(projectId, run, reason) {
  const response = await req("POST", `/api/projects/${encodeURIComponent(projectId)}/reconcile-deliverables`, {});
  run.steps.push({
    step: `reconcile_${reason}`,
    status: response.status,
    durationMs: response.durationMs
  });
  if (response.status !== 200) {
    throw new Error(`RECONCILE_FAILED: ${response.status}`);
  }
  return response.unwrapped;
}

async function approve(projectId, run, reason) {
  const response = await req("POST", `/api/projects/${encodeURIComponent(projectId)}/approve`, {}, { timeoutMs: REQUEST_TIMEOUT_MS });
  run.steps.push({
    step: `approve_${reason}`,
    status: response.status,
    durationMs: response.durationMs,
    code: response.body?.error?.code
  });
  if (response.status !== 200) {
    throw new Error(`APPROVE_FAILED(${reason}): ${response.status} ${JSON.stringify(response.body).slice(0, 500)}`);
  }
  return response.unwrapped;
}

function hasCodeEvidence(text) {
  const matches = Array.from(String(text || "").matchAll(CODE_PATH_PATTERN)).map((m) => String(m[1] || "").trim().toLowerCase());
  return new Set(matches.filter(Boolean)).size >= 2;
}

function hasValidationEvidence(text) {
  return VALIDATION_SIGNAL_PATTERN.test(String(text || ""));
}

function collectRequirementSignals(requirement) {
  const source = String(requirement || "").toLowerCase();
  const tokens = [];
  if (source.includes("tiktok")) tokens.push("tiktok");
  if (source.includes("amazon")) tokens.push("amazon");
  if (source.includes("temu")) tokens.push("temu");
  if (source.includes("跨境")) tokens.push("跨境");
  if (source.includes("爆品")) tokens.push("爆品");
  if (source.includes("跟品")) tokens.push("跟品");
  return tokens;
}

function stageIndex(stageType) {
  return STAGES.indexOf(String(stageType || ""));
}

function summarizeProject(project) {
  return {
    id: project.id,
    status: project.status,
    currentStage: project.currentStage,
    progress: project.progress,
    pendingApproval: project.pendingApproval
  };
}

async function handleRequiredActions(project, requiredActions, run) {
  const actions = Array.isArray(requiredActions) ? requiredActions : [];
  run.steps.push({
    step: "required_actions",
    actions: actions.map((a) => `${a.action}:${a.id}`).join(", ")
  });

  if (actions.some((item) => item.action === "reconcile_deliverables")) {
    return reconcileDeliverables(project.id, run, "required_action");
  }
  if (actions.some((item) => item.action === "open_design_review")) {
    return submitDesignReview(project, run);
  }
  if (actions.some((item) => item.action === "resolve_blocked_tasks")) {
    await resolveBlockedTasks(project, run);
    return getProject(project.id);
  }
  if (actions.some((item) => item.action === "review_pending_stage")) {
    return approve(project.id, run, "required_action");
  }
  if (actions.some((item) => item.action === "submit_stage_deliverable")) {
    return reconcileDeliverables(project.id, run, "submit_stage_deliverable");
  }
  if (actions.some((item) => item.action === "refresh_runtime")) {
    throw new Error("RUNTIME_NOT_READY: required action refresh_runtime");
  }

  throw new Error(`UNHANDLED_REQUIRED_ACTIONS: ${actions.map((a) => a.action).join(", ")}`);
}

async function runSingleLifecycle(requirement, index) {
  const run = {
    index,
    requirement,
    startedAt: new Date().toISOString(),
    projectId: "",
    ok: true,
    steps: [],
    checks: [],
    warnings: []
  };

  try {
    const create = await req("POST", "/api/projects", {
      name: `triple-check-${index}-${Date.now()}`,
      description: requirement,
      team: ["ROLE_PM", "ROLE_ANALYST", "ROLE_PRODUCT", "ROLE_DESIGN", "ROLE_ARCH", "ROLE_DEV", "ROLE_QA"]
    });
    run.steps.push({ step: "project_create", status: create.status, durationMs: create.durationMs });
    if (create.status !== 201 || !create.unwrapped?.id) {
      throw new Error(`PROJECT_CREATE_FAILED(run=${index}): ${create.status} ${JSON.stringify(create.body).slice(0, 500)}`);
    }
    run.projectId = String(create.unwrapped.id);

    let project = await getProject(run.projectId);
    run.steps.push({ step: "detail_after_create", project: summarizeProject(project) });
    const stageSeen = new Set([project.currentStage]);
    let inProgressRetries = 0;
    let inProgressStartedAt = 0;
    let lastObservedStage = project.currentStage;

  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    project = await getProject(run.projectId);
    run.steps.push({ step: `detail_round_${round}`, project: summarizeProject(project) });
    stageSeen.add(project.currentStage);
    if (project.currentStage !== lastObservedStage) {
      inProgressRetries = 0;
      inProgressStartedAt = 0;
      lastObservedStage = project.currentStage;
    }
    if (round % 8 === 0) {
      console.log(`[triple-check][run=${index}] round=${round} stage=${project.currentStage} pending=${project.pendingApproval} status=${project.status}`);
    }

    if (project.status === "completed") {
      break;
    }

    if (project.pendingApproval) {
      inProgressRetries = 0;
      inProgressStartedAt = 0;
      project = await approve(run.projectId, run, `pending_${round}`);
      continue;
    }

    const advance = await req("POST", `/api/projects/${encodeURIComponent(run.projectId)}/advance`, {}, {
      timeoutMs: REQUEST_TIMEOUT_MS
    });
    run.steps.push({
      step: `advance_${round}`,
      status: advance.status,
      durationMs: advance.durationMs,
      code: advance.body?.error?.code
    });

    if (advance.status === 200) {
      inProgressRetries = 0;
      inProgressStartedAt = 0;
      project = advance.unwrapped;
      continue;
    }

    if (advance.status === 409 && advance.body?.error?.code === "PROJECT_ADVANCE_IN_PROGRESS") {
      if (!inProgressStartedAt) {
        inProgressStartedAt = Date.now();
      }
      inProgressRetries += 1;
      const waitedMs = Date.now() - inProgressStartedAt;
      if (waitedMs > MAX_IN_PROGRESS_WAIT_MS) {
        throw new Error(`ADVANCE_STUCK_IN_PROGRESS(run=${index}): retries=${inProgressRetries}, waitedMs=${waitedMs}`);
      }
      const pollAfterMs = Math.max(800, Number(advance.body?.error?.pollAfterMs || 1400));
      await sleep(pollAfterMs);
      continue;
    }

    if (advance.status === 409 && advance.body?.error?.code === "REQUIRES_USER_INTERVENTION") {
      inProgressRetries = 0;
      inProgressStartedAt = 0;
      project = await handleRequiredActions(project, advance.body?.error?.requiredActions, run);
      continue;
    }

    if (advance.status === 409 && advance.body?.error?.code === "PROJECT_ADVANCE_FAILED") {
      const message = String(advance.body?.error?.message || "");
      if (/STAGE_TEMPLATE_VALIDATION_FAILED/i.test(message)) {
        project = await reconcileDeliverables(run.projectId, run, "advance_template_failed");
        continue;
      }
    }

    throw new Error(`ADVANCE_FAILED(run=${index}): ${advance.status} ${JSON.stringify(advance.body).slice(0, 500)}`);
  }

    project = await getProject(run.projectId);
    run.steps.push({ step: "detail_final", project: summarizeProject(project) });

    const checks = [];
    const failures = [];
    const warnings = [];

    const assertCheck = (name, pass, detail = "") => {
      const item = { name, pass, detail };
      checks.push(item);
      if (!pass) {
        failures.push(item);
      }
    };

    assertCheck("项目到达 completed", project.status === "completed", `status=${project.status}, stage=${project.currentStage}`);
    assertCheck("阶段推进至少覆盖到 ACCEPT", stageSeen.has("ACCEPT"), `stageSeen=${Array.from(stageSeen).join(",")}`);

    const executions = await listExecutions(run.projectId);
    const successExecutions = executions.filter((item) => item.status === "success");
    for (const stage of ["ANALYSIS", "DESIGN", "DEV", "ACCEPT"]) {
      const stageSuccess = successExecutions.filter((item) => item.stageType === stage);
      assertCheck(`${stage} 有成功模型执行记录`, stageSuccess.length > 0, `count=${stageSuccess.length}`);
      const realSuccess = stageSuccess.filter((item) => item.provider === "openai-compatible");
      assertCheck(`${stage} 使用真实模型通道`, realSuccess.length > 0, `realCount=${realSuccess.length}`);
    }

    const projectDeliverables = Array.isArray(project.deliverables) ? project.deliverables : [];
    const scaffoldDeliverables = projectDeliverables.filter((item) =>
      SCAFFOLD_PATTERN.test(String(item.content || ""))
    );
    assertCheck("交付物不含模板骨架占位语句", scaffoldDeliverables.length === 0, scaffoldDeliverables.map((d) => d.name).join(", "));

    const devDeliverables = projectDeliverables.filter((item) => item.stageType === "DEV");
    const weakDev = devDeliverables.filter((item) => {
      const text = String(item.content || "");
      return !hasCodeEvidence(text) || !hasValidationEvidence(text);
    });
    assertCheck("DEV 交付具备代码与验证证据", weakDev.length === 0, weakDev.map((d) => d.name).join(", "));

    const finalArtifacts = await getFinalArtifacts(run.projectId);
    assertCheck("最终交付 readyForAcceptance=true", finalArtifacts.readyForAcceptance === true, JSON.stringify(finalArtifacts.coverage || {}));

    const officialSite = await getOfficialSite(run.projectId);
    assertCheck("官方页链接可访问", Boolean(officialSite.url), String(officialSite.url || ""));
    const officialHtml = officialSite.url ? await fetchOfficialSiteHtml(officialSite.url) : "";
    assertCheck("官方页明确是静态交付物预览", /静态交付物预览页/.test(officialHtml), "missing preview notice");

    const requirementSignals = collectRequirementSignals(requirement);
    if (requirementSignals.length > 0 && officialHtml) {
      const htmlLower = officialHtml.toLowerCase();
      const matched = requirementSignals.filter((token) => htmlLower.includes(token));
      assertCheck("官方页命中需求语义关键词", matched.length > 0, `signals=${requirementSignals.join(",")}, matched=${matched.join(",")}`);
    }

    const futureStageLeak = projectDeliverables.filter((item) => stageIndex(item.stageType) > stageIndex(project.currentStage));
    if (futureStageLeak.length > 0) {
      warnings.push(`发现未来阶段交付物泄漏: ${futureStageLeak.map((item) => `${item.stageType}:${item.name}`).join(" | ")}`);
    }

    run.checks = checks;
    run.warnings.push(...warnings);
    run.ok = failures.length === 0;
    run.finishedAt = new Date().toISOString();
    run.summary = {
      executionCount: executions.length,
      successExecutionCount: successExecutions.length,
      deliverableCount: projectDeliverables.length
    };

    return run;
  } catch (error) {
    run.ok = false;
    run.error = error instanceof Error ? error.message : String(error);
    run.finishedAt = new Date().toISOString();
    return run;
  }
}

async function deleteProject(projectId) {
  if (!projectId || !CLEANUP_PROJECTS) {
    return;
  }
  await req("DELETE", `/api/projects/${encodeURIComponent(projectId)}`);
}

async function main() {
  try {
    await ensureApiReady();
    await ensureAuth();

    for (let i = 0; i < REQUIREMENTS.length; i += 1) {
      const requirement = REQUIREMENTS[i];
      let run;
      try {
        console.log(`[triple-check] run ${i + 1}/${REQUIREMENTS.length} started`);
        run = await withTimeout(
          runSingleLifecycle(requirement, i + 1),
          RUN_TIMEOUT_MS,
          `run-${i + 1}`
        );
        console.log(`[triple-check] run ${i + 1}/${REQUIREMENTS.length} finished ok=${run.ok}`);
      } catch (error) {
        run = {
          index: i + 1,
          requirement,
          ok: false,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          projectId: "",
          steps: [],
          checks: [],
          warnings: [],
          error: error instanceof Error ? error.message : String(error)
        };
        console.log(`[triple-check] run ${i + 1}/${REQUIREMENTS.length} failed: ${run.error}`);
      }
      report.runs.push(run);
      if (!run.ok) {
        report.ok = false;
        report.failures.push({
          run: run.index,
          projectId: run.projectId,
          error: run.error || "run checks failed"
        });
      }
      if (Array.isArray(run.warnings) && run.warnings.length > 0) {
        report.warnings.push(...run.warnings.map((item) => `run${run.index}: ${item}`));
      }

      if (run.projectId) {
        await deleteProject(run.projectId);
      }

      // Persist incremental progress for long-running checks.
      await mkdir(OUT_DIR, { recursive: true });
      await writeFile(
        path.join(OUT_DIR, "triple-lifecycle-deepcheck-latest.json"),
        JSON.stringify(report, null, 2),
        "utf8"
      );
    }
  } finally {
    await cleanupAuth();
    await prisma.$disconnect();
    stopStartedApi();
  }
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = path.join(OUT_DIR, `triple-lifecycle-deepcheck-${timestamp}.json`);
const latestFile = path.join(OUT_DIR, "triple-lifecycle-deepcheck-latest.json");

main()
  .then(async () => {
    report.finishedAt = new Date().toISOString();
    await mkdir(OUT_DIR, { recursive: true });
    const content = JSON.stringify(report, null, 2);
    await writeFile(outFile, content, "utf8");
    await writeFile(latestFile, content, "utf8");
    console.log(content);
  })
  .catch(async (error) => {
    report.ok = false;
    report.finishedAt = new Date().toISOString();
    report.failures.push({
      run: "global",
      error: error instanceof Error ? error.message : String(error)
    });
    await mkdir(OUT_DIR, { recursive: true });
    const content = JSON.stringify(report, null, 2);
    await writeFile(outFile, content, "utf8");
    await writeFile(latestFile, content, "utf8");
    console.log(content);
    process.exit(1);
  });
