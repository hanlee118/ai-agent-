import http from "node:http";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { prisma } from "../apps/api/dist/db.js";
import { generateSessionToken, hashSessionToken } from "../apps/api/dist/security/secret-store.js";

const BASE = String(process.env.API_BASE || "http://127.0.0.1:8787").replace(/\/$/, "");
const OUT_DIR = path.resolve(process.cwd(), "docs/reports");
const REQUEST_TIMEOUT_MS = Math.max(10000, Number(process.env.REQUEST_TIMEOUT_MS || 120000));
const MAX_ADVANCE_ROUNDS = Math.max(20, Number(process.env.MAX_ADVANCE_ROUNDS || 90));

const REQUIREMENTS = [
  "跨境爆品雷达：监控 TikTok/Amazon 爆量商品，支持跟品与告警。",
  "跨境选品中台：聚合 Temu/TikTok 热点，输出榜单、风险和跟踪策略。",
  "跨境跟品机器人：围绕商品链接、爆发指标和人工决策形成闭环。"
];

const report = {
  ok: true,
  startedAt: new Date().toISOString(),
  base: BASE,
  rounds: [],
  anomalies: []
};

let SESSION_TOKEN = "";
let SESSION_COOKIE = "";

function toPath(input) {
  return input.startsWith("/") ? input : `/${input}`;
}

function unwrap(payload) {
  if (payload && typeof payload === "object" && "success" in payload) {
    if (payload.success === true) {
      return payload.data;
    }
    return payload;
  }
  return payload;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.round(ms))));
}

function safeStringify(value, limit = 2000) {
  try {
    const text = JSON.stringify(value);
    if (text.length <= limit) {
      return text;
    }
    return `${text.slice(0, limit)}...(truncated)`;
  } catch {
    const raw = String(value ?? "");
    return raw.length <= limit ? raw : `${raw.slice(0, limit)}...(truncated)`;
  }
}

function compactForReport(value, limit = 2000) {
  try {
    const text = JSON.stringify(value);
    if (text.length <= limit) {
      return value;
    }
    return {
      __truncated: true,
      preview: `${text.slice(0, limit)}...(truncated)`
    };
  } catch {
    const raw = String(value ?? "");
    return raw.length <= limit
      ? raw
      : `${raw.slice(0, limit)}...(truncated)`;
  }
}

function summarizeResponse(route, value) {
  const data = unwrap(value);
  if (!data || typeof data !== "object") {
    return value;
  }

  const pathName = String(route || "");
  if (/\/api\/projects\/[^/]+$/.test(pathName)) {
    return {
      id: data.id,
      status: data.status,
      currentStage: data.currentStage,
      progress: data.progress,
      pendingApproval: data.pendingApproval,
      team: Array.isArray(data.team) ? data.team : []
    };
  }

  if (/\/executions/.test(pathName)) {
    const executions = Array.isArray(data.executions) ? data.executions : [];
    return {
      count: executions.length,
      sample: executions.slice(0, 3).map((item) => ({
        id: item.id,
        stageType: item.stageType,
        role: item.role,
        status: item.status,
        provider: item.provider,
        model: item.model
      }))
    };
  }

  if (/\/api\/agents$/.test(pathName)) {
    return {
      count: Array.isArray(data) ? data.length : 0,
      sample: Array.isArray(data)
        ? data.slice(0, 5).map((item) => ({ id: item.id, currentModelId: item.currentModelId, tasks: item.tasks }))
        : []
    };
  }

  if (/\/api\/models$/.test(pathName)) {
    return {
      count: Array.isArray(data) ? data.length : 0,
      sample: Array.isArray(data)
        ? data.slice(0, 5).map((item) => ({ id: item.id, name: item.name, status: item.status }))
        : []
    };
  }

  return data;
}

function request(method, route, body, options = {}) {
  const timeoutMs = Math.max(5000, Number(options.timeoutMs || REQUEST_TIMEOUT_MS));
  const startedAt = Date.now();
  const url = new URL(`${BASE}${toPath(route)}`);
  const payload = body === undefined ? "" : JSON.stringify(body);
  const headers = {
    ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
    ...(SESSION_COOKIE ? { Cookie: SESSION_COOKIE } : {})
  };

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        headers
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          let parsed = raw;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            // keep raw
          }
          resolve({
            method,
            route,
            status: res.statusCode || 0,
            durationMs: Date.now() - startedAt,
            body: parsed,
            unwrapped: unwrap(parsed)
          });
        });
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`REQUEST_TIMEOUT ${method} ${route} > ${timeoutMs}`)));
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function addStep(round, response, requestBody) {
  round.steps.push({
    at: new Date().toISOString(),
    method: response.method,
    route: response.route,
    requestBody: requestBody === undefined ? undefined : compactForReport(requestBody, 1200),
    status: response.status,
    durationMs: response.durationMs,
    response: compactForReport(summarizeResponse(response.route, response.body), 1600)
  });
}

function pickAgent(agents) {
  const preferred = ["ROLE_DEV", "ROLE_ARCH", "ROLE_DESIGN", "ROLE_PM", "ROLE_ANALYST"];
  for (const roleId of preferred) {
    const matched = agents.find((item) => item.id === roleId);
    if (matched) {
      return matched;
    }
  }
  return agents[0] || null;
}

function pickModel(models) {
  const healthy = models.filter((item) => String(item.status || "").toLowerCase() !== "offline");
  const preferredNames = ["openai/gpt-5.4", "openai/gpt-5.3-codex", "qwen3-coder-plus"];
  for (const name of preferredNames) {
    const matched = healthy.find((item) => String(item.name || "").trim() === name);
    if (matched) {
      return matched;
    }
  }
  return healthy[0] || models[0] || null;
}

function buildDesignReviewSubmission(round, requirement) {
  const content = [
    "# 设计审查卡.md",
    "## 视觉方案",
    `- 方向：围绕需求“${requirement}”建立真实业务界面，不使用协作流程模板。`,
    "## 版式策略",
    "- 首屏包含榜单、关键指标和人工动作入口。",
    "## 组件清单",
    "- 榜单卡片、详情抽屉、告警流、跟品按钮。",
    "## 品牌语气",
    "- 专业、克制、证据优先。",
    "## UX 原则",
    "- 主链路优先",
    "- 关键动作可达",
    "- 状态反馈即时",
    "## 可访问性检查",
    "- 键盘可达",
    "- 对比度达标",
    "- 图表附文字摘要",
    "## 设计审查卡",
    "- 审查结论: 通过",
    "## 验收检查清单",
    "- 视觉方向可支持开发落地",
    "- 可访问性检查项完整",
    "- 审查结论明确且可追溯"
  ].join("\n");

  return {
    title: "设计审查卡.md",
    content,
    designReview: {
      visualDirection: "跨境爆品监控控制台",
      brandTone: "专业、克制、证据优先",
      uxPrinciples: ["主链路优先", "关键动作可达", "状态反馈即时"],
      accessibilityChecklist: ["键盘可达", "文本对比达标", "图表附带文字摘要"],
      approvedBy: `roster-e2e-round-${round}`,
      approved: true,
      notes: "auto submitted by agents roster e2e script"
    },
    finalizeApproval: false
  };
}

async function handleRequiredActions(round, projectId, actions) {
  const list = Array.isArray(actions) ? actions : [];
  if (list.length === 0) {
    round.anomalies.push("REQUIRES_USER_INTERVENTION returned without requiredActions");
    return;
  }

  const names = list.map((item) => item.action).join(", ");
  round.requiredActions.push({ at: new Date().toISOString(), actions: names });

  if (list.some((item) => item.action === "open_design_review")) {
    const body = buildDesignReviewSubmission(round.index, round.requirement);
    const submit = await request("POST", `/api/projects/${encodeURIComponent(projectId)}/stages/submit`, body);
    addStep(round, submit, body);
    if (submit.status !== 200) {
      round.anomalies.push(`open_design_review submit failed: status=${submit.status}`);
    }
    return;
  }

  if (list.some((item) => item.action === "review_pending_stage")) {
    const approve = await request("POST", `/api/projects/${encodeURIComponent(projectId)}/approve`, {});
    addStep(round, approve, {});
    if (approve.status !== 200) {
      round.anomalies.push(`review_pending_stage approve failed: status=${approve.status}`);
    }
    return;
  }

  if (list.some((item) => item.action === "submit_stage_deliverable") || list.some((item) => item.action === "reconcile_deliverables")) {
    const reconcile = await request("POST", `/api/projects/${encodeURIComponent(projectId)}/reconcile-deliverables`, {});
    addStep(round, reconcile, {});
    if (reconcile.status !== 200) {
      round.anomalies.push(`reconcile failed: status=${reconcile.status}`);
    }
    return;
  }

  if (list.some((item) => item.action === "resolve_blocked_tasks")) {
    const tasksRes = await request("GET", `/api/projects/${encodeURIComponent(projectId)}/tasks`);
    addStep(round, tasksRes);
    const tasks = Array.isArray(tasksRes.unwrapped?.tasks)
      ? tasksRes.unwrapped.tasks
      : Array.isArray(tasksRes.unwrapped) ? tasksRes.unwrapped : [];
    for (const task of tasks.filter((item) => item.status === "blocked")) {
      const payload = { status: "done" };
      const patch = await request("PATCH", `/api/tasks/${encodeURIComponent(task.id)}`, payload);
      addStep(round, patch, payload);
    }
    return;
  }

  if (list.some((item) => item.action === "refresh_runtime")) {
    round.anomalies.push("requiredAction refresh_runtime encountered");
    return;
  }

  round.anomalies.push(`Unhandled requiredActions: ${names}`);
}

async function runRound(index, requirement) {
  const round = {
    index,
    requirement,
    startedAt: new Date().toISOString(),
    projectId: "",
    selectedAgentId: "",
    selectedModel: "",
    steps: [],
    requiredActions: [],
    checks: [],
    anomalies: [],
    final: null,
    ok: false
  };

  const agentsRes = await request("GET", "/api/agents");
  addStep(round, agentsRes);
  const modelsRes = await request("GET", "/api/models");
  addStep(round, modelsRes);
  const agents = Array.isArray(agentsRes.unwrapped) ? agentsRes.unwrapped : [];
  const models = Array.isArray(modelsRes.unwrapped) ? modelsRes.unwrapped : [];

  const selectedAgent = pickAgent(agents);
  const selectedModel = pickModel(models);
  if (!selectedAgent || !selectedModel) {
    round.anomalies.push("No selectable agent or model");
    return round;
  }
  round.selectedAgentId = selectedAgent.id;
  round.selectedModel = `${selectedModel.name} (${selectedModel.id})`;

  const switchPayload = { modelId: selectedModel.id };
  const switchRes = await request("PATCH", `/api/agents/${encodeURIComponent(selectedAgent.id)}/model`, switchPayload);
  addStep(round, switchRes, switchPayload);

  const soulPayload = {
    content: `Round ${index} roster e2e soul: focus on ${requirement}`
  };
  const soulRes = await request("PATCH", `/api/agents/${encodeURIComponent(selectedAgent.id)}/soul`, soulPayload);
  addStep(round, soulRes, soulPayload);

  const sopPayload = {
    steps: [
      "读取项目目标并确认业务对象",
      "输出可执行策略并保留证据",
      "遇到阻塞时先暴露异常再请求人工确认"
    ]
  };
  const sopRes = await request("PATCH", `/api/agents/${encodeURIComponent(selectedAgent.id)}/sop`, sopPayload);
  addStep(round, sopRes, sopPayload);

  const team = Array.from(new Set([
    selectedAgent.id,
    "ROLE_PM",
    "ROLE_ANALYST",
    "ROLE_PRODUCT",
    "ROLE_DESIGN",
    "ROLE_ARCH",
    "ROLE_DEV",
    "ROLE_QA"
  ]));

  const createPayload = {
    name: `roster-e2e-r${index}-${Date.now()}`,
    description: requirement,
    team
  };
  const createRes = await request("POST", "/api/projects", createPayload);
  addStep(round, createRes, createPayload);
  if (createRes.status !== 201 || !createRes.unwrapped?.id) {
    round.anomalies.push(`Project create failed: status=${createRes.status}`);
    return round;
  }
  const projectId = String(createRes.unwrapped.id);
  round.projectId = projectId;

  let completed = false;
  for (let i = 1; i <= MAX_ADVANCE_ROUNDS; i += 1) {
    const detailRes = await request("GET", `/api/projects/${encodeURIComponent(projectId)}`);
    addStep(round, detailRes);
    const detail = detailRes.unwrapped || {};
    if (detail.status === "completed") {
      completed = true;
      break;
    }

    if (detail.pendingApproval) {
      const approve = await request("POST", `/api/projects/${encodeURIComponent(projectId)}/approve`, {});
      addStep(round, approve, {});
      if (approve.status !== 200 && approve.body?.error?.code !== "NO_PENDING_APPROVAL") {
        round.anomalies.push(`approve failed: status=${approve.status}`);
      }
      continue;
    }

    const advance = await request("POST", `/api/projects/${encodeURIComponent(projectId)}/advance`, {});
    addStep(round, advance, {});
    if (advance.status === 200) {
      continue;
    }
    const errorCode = advance.body?.error?.code;
    if (advance.status === 409 && errorCode === "PROJECT_ADVANCE_IN_PROGRESS") {
      const pollAfter = Math.max(800, Number(advance.body?.error?.pollAfterMs || 1200));
      await sleep(pollAfter);
      continue;
    }
    if (advance.status === 409 && errorCode === "REQUIRES_USER_INTERVENTION") {
      await handleRequiredActions(round, projectId, advance.body?.error?.requiredActions);
      continue;
    }
    round.anomalies.push(`advance failed: status=${advance.status}, code=${String(errorCode || "")}`);
    break;
  }

  const finalDetail = await request("GET", `/api/projects/${encodeURIComponent(projectId)}`);
  addStep(round, finalDetail);
  const executionsRes = await request("GET", `/api/projects/${encodeURIComponent(projectId)}/executions?limit=200`);
  addStep(round, executionsRes);
  const finalArtifactsRes = await request("GET", `/api/projects/${encodeURIComponent(projectId)}/final-artifacts`);
  addStep(round, finalArtifactsRes);

  const final = finalDetail.unwrapped || {};
  const executionItems = Array.isArray(executionsRes.unwrapped?.executions) ? executionsRes.unwrapped.executions : [];
  const stagesCovered = Array.from(new Set(executionItems.filter((item) => item.status === "success").map((item) => item.stageType)));
  const agentExecutionCount = executionItems.filter((item) => item.role === selectedAgent.id).length;

  round.checks.push(
    { name: "project_created", pass: createRes.status === 201, detail: `status=${createRes.status}` },
    { name: "agent_model_configured", pass: switchRes.status === 200, detail: `status=${switchRes.status}` },
    { name: "agent_in_team", pass: Array.isArray(final.team) && final.team.includes(selectedAgent.id), detail: `team=${safeStringify(final.team, 300)}` },
    { name: "has_success_executions", pass: executionItems.some((item) => item.status === "success"), detail: `count=${executionItems.length}` },
    { name: "stage_coverage_analysis_design_dev_accept", pass: ["ANALYSIS", "DESIGN", "DEV", "ACCEPT"].every((s) => stagesCovered.includes(s)), detail: `stages=${stagesCovered.join(",")}` },
    { name: "agent_has_execution_records", pass: agentExecutionCount > 0, detail: `selectedAgent=${selectedAgent.id}, count=${agentExecutionCount}` },
    { name: "project_completed", pass: final.status === "completed" || completed, detail: `status=${final.status}, stage=${final.currentStage}` },
    { name: "final_artifacts_ready", pass: finalArtifactsRes.status === 200 && finalArtifactsRes.unwrapped?.readyForAcceptance === true, detail: `status=${finalArtifactsRes.status}, ready=${String(finalArtifactsRes.unwrapped?.readyForAcceptance)}` }
  );

  round.ok = round.checks.every((item) => item.pass) && round.anomalies.length === 0;
  round.final = {
    status: final.status,
    currentStage: final.currentStage,
    progress: final.progress,
    pendingApproval: final.pendingApproval,
    executionCount: executionItems.length,
    successExecutions: executionItems.filter((item) => item.status === "success").length
  };
  round.finishedAt = new Date().toISOString();
  return round;
}

async function createSession() {
  SESSION_TOKEN = generateSessionToken();
  const tokenHash = await hashSessionToken(SESSION_TOKEN);
  await prisma.authSession.create({
    data: {
      tokenHash,
      expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
    }
  });
  SESSION_COOKIE = `occ_session=${SESSION_TOKEN}`;
}

async function cleanupSession() {
  if (!SESSION_TOKEN) return;
  const tokenHash = await hashSessionToken(SESSION_TOKEN);
  await prisma.authSession.deleteMany({ where: { tokenHash } });
}

async function writeReports() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonFile = path.join(OUT_DIR, `agents-roster-e2e-round3-${timestamp}.json`);
  const latestFile = path.join(OUT_DIR, "agents-roster-e2e-round3-latest.json");
  const mdFile = path.join(OUT_DIR, `agents-roster-e2e-round3-${timestamp}.md`);
  const mdLatestFile = path.join(OUT_DIR, "agents-roster-e2e-round3-latest.md");

  const lines = [
    `# Agent 名册三轮端到端实测记录 (${new Date().toISOString()})`,
    "",
    `- BASE: ${BASE}`,
    `- 总轮次: ${report.rounds.length}`,
    `- 通过轮次: ${report.rounds.filter((r) => r.ok).length}`,
    `- 异常总数: ${report.anomalies.length}`,
    "",
    "## 每轮结果",
    ...report.rounds.flatMap((round) => {
      const failedChecks = round.checks.filter((item) => !item.pass);
      return [
        `### Round ${round.index}`,
        `- 项目ID: ${round.projectId || "-"}`,
        `- 选中 Agent: ${round.selectedAgentId || "-"}`,
        `- 选中模型: ${round.selectedModel || "-"}`,
        `- 结果: ${round.ok ? "PASS" : "FAIL"}`,
        `- 终态: ${safeStringify(round.final, 500)}`,
        `- 检查通过率: ${round.checks.filter((item) => item.pass).length}/${round.checks.length}`,
        failedChecks.length > 0
          ? `- 失败检查: ${failedChecks.map((item) => `${item.name}(${item.detail})`).join(" | ")}`
          : "- 失败检查: 无",
        round.anomalies.length > 0
          ? `- 异常: ${round.anomalies.join(" | ")}`
          : "- 异常: 无",
        `- 请求步数: ${round.steps.length}`,
        ""
      ];
    }),
    "## 可追溯原始证据",
    "- 同目录 JSON 文件包含每一跳 requestBody/status/response 摘要。"
  ];

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(jsonFile, JSON.stringify(report, null, 2), "utf8");
  await writeFile(latestFile, JSON.stringify(report, null, 2), "utf8");
  await writeFile(mdFile, lines.join("\n"), "utf8");
  await writeFile(mdLatestFile, lines.join("\n"), "utf8");

  return { jsonFile, latestFile, mdFile, mdLatestFile };
}

async function main() {
  try {
    await createSession();

    for (let i = 0; i < REQUIREMENTS.length; i += 1) {
      console.log(`[roster-e2e] round ${i + 1}/${REQUIREMENTS.length} started`);
      const round = await runRound(i + 1, REQUIREMENTS[i]);
      report.rounds.push(round);
      console.log(`[roster-e2e] round ${i + 1}/${REQUIREMENTS.length} finished ok=${round.ok} project=${round.projectId || "-"}`);
      if (!round.ok) {
        report.ok = false;
        report.anomalies.push({
          round: round.index,
          projectId: round.projectId,
          anomalies: round.anomalies,
          failedChecks: round.checks.filter((item) => !item.pass)
        });
      }
    }
  } finally {
    report.finishedAt = new Date().toISOString();
    await cleanupSession().catch(() => {});
    await prisma.$disconnect().catch(() => {});
  }

  const files = await writeReports();
  console.log(JSON.stringify({ ok: report.ok, files, rounds: report.rounds.map((r) => ({ index: r.index, ok: r.ok, projectId: r.projectId })) }, null, 2));
}

main().catch(async (error) => {
  report.ok = false;
  report.finishedAt = new Date().toISOString();
  report.anomalies.push({
    round: "global",
    error: error instanceof Error ? error.message : String(error)
  });
  await writeReports().catch(() => {});
  await cleanupSession().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  console.error(error);
  process.exit(1);
});
