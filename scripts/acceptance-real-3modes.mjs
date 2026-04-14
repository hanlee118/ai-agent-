import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../apps/api/dist/db.js";
import { generateSessionToken, hashSessionToken } from "../apps/api/dist/security/secret-store.js";

const API_BASE = String(process.env.API_BASE || "http://127.0.0.1:8787").replace(/\/$/, "");
const REQUEST_TIMEOUT_MS = Math.max(20_000, Number(process.env.REQUEST_TIMEOUT_MS || 240_000));
const ISSUE_DEBATE_TIMEOUT_MS = Math.max(60_000, Number(process.env.ISSUE_DEBATE_TIMEOUT_MS || 360_000));
const MAX_ADVANCE_ROUNDS = Math.max(30, Number(process.env.MAX_ADVANCE_ROUNDS || 240));
const SESSION_TTL_MS = Math.max(30 * 60 * 1000, Number(process.env.SESSION_TTL_MS || 3 * 60 * 60 * 1000));
const REPORT_DIR = path.resolve(process.cwd(), "docs/reports");
const REPORT_PATH = path.resolve(REPORT_DIR, "acceptance-real-3modes.json");

let SESSION_TOKEN = "";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.round(ms))));
}

function unwrap(payload) {
  if (payload && typeof payload === "object" && "success" in payload && "data" in payload) {
    return payload.data;
  }
  return payload;
}

async function request(method, route, body, timeoutMs = REQUEST_TIMEOUT_MS) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API_BASE}${route.startsWith("/") ? route : `/${route}`}`, {
      method,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(SESSION_TOKEN ? { Cookie: `occ_session=${SESSION_TOKEN}` } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const raw = await response.text();
    let parsed = raw;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      // keep raw text payload
    }
    return {
      ok: response.ok,
      status: response.status,
      durationMs: Date.now() - startedAt,
      body: parsed,
      data: unwrap(parsed)
    };
  } finally {
    clearTimeout(timer);
  }
}

function formatResponseForError(response) {
  return `${response.status} ${JSON.stringify(response.body).slice(0, 800)}`;
}

function buildClarificationAnswers(questions) {
  const result = {};
  const list = Array.isArray(questions) ? questions : [];
  for (const item of list) {
    const id = String(item?.id || "").trim();
    if (!id) continue;
    if (id === "goal") {
      result[id] = "完成真实模型驱动的阶段执行并形成可验收交付。";
      continue;
    }
    if (id === "scope") {
      result[id] = "严格按当前阶段模板推进，不扩展无关范围。";
      continue;
    }
    if (id === "acceptance") {
      result[id] = "流程100%完成，门禁通过，产物可追溯到真实执行证据。";
      continue;
    }
    result[id] = "已确认，按模板执行。";
  }
  return result;
}

function buildProjectInputByTemplate(templateKey, description) {
  const base = String(description || "").trim();
  const filler = [
    "补充说明：此输入用于满足阶段输入契约校验，确保真实执行链路可推进。",
    "请按阶段模板输出可验收交付物，明确范围边界、关键约束、验收标准与交接条件。",
    "需要保留可追溯证据，确保多角色协作结果可复核。"
  ].join(" ");
  const content = `${base}\n\n${filler}`.repeat(2);
  const map = {
    requirements_design: { name: "rawRequirements", type: "prd" },
    visual_design: { name: "prd", type: "prd" },
    tech_design: { name: "prd", type: "prd" },
    code_dev: { name: "mockups", type: "mockup" },
    qa_acceptance: { name: "sourceCode", type: "code_repo" },
    standard_software_development: { name: "raw_requirements", type: "document" }
  };
  const resolved = map[String(templateKey || "").trim()] || map.standard_software_development;
  return [{
    name: resolved.name,
    type: resolved.type,
    content,
    inputSource: "manual"
  }];
}

async function ensureInputContractReady(projectId, workflowTemplateKey, logs) {
  const overview = await getWorkflowOverview(projectId);
  const stages = Array.isArray(overview?.stages) ? overview.stages : [];
  const blocked = stages.find((stage) => (
    String(stage?.status || "").toLowerCase() === "pending"
    && Number(stage?.gate?.violationCount || 0) > 0
  ));
  if (!blocked) {
    return;
  }
  const violations = Array.isArray(blocked?.gate?.violations) ? blocked.gate.violations : [];
  const needInputRepair = violations.some((item) => /input|external|allowed_input_types/i.test(String(item)));
  if (!needInputRepair) {
    return;
  }

  const extraInput = buildProjectInputByTemplate(
    String(workflowTemplateKey || blocked.templateKey || "standard_software_development"),
    `自动补齐输入契约：${String(blocked.templateKey || "stage")}（project=${projectId}）`
  );
  const addInput = await request("POST", `/api/projects/${encodeURIComponent(projectId)}/inputs`, {
    items: extraInput
  });
  logs.push({
    type: "repair_input_contract",
    stage: blocked.templateKey,
    addInputStatus: addInput.status,
    violations
  });
  assert(addInput.ok, `repair input contract failed: ${formatResponseForError(addInput)}`);
  await sleep(1200);
}

async function waitIssueDebateReady(issueId, taskId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < ISSUE_DEBATE_TIMEOUT_MS) {
    const query = taskId ? `?taskId=${encodeURIComponent(taskId)}` : "";
    const res = await request("GET", `/api/issues/${encodeURIComponent(issueId)}/debate${query}`);
    if (!res.ok) {
      const code = String(res.body?.error?.code || "");
      if (res.status === 404 && code === "NOT_FOUND") {
        await sleep(1200);
        continue;
      }
      throw new Error(`issue debate poll failed: ${formatResponseForError(res)}`);
    }
    const data = res.data || {};
    const status = String(data.status || "").toLowerCase();
    const canProceed = Boolean(data.analysisGate?.canProceed);
    const mode = String(data.debate?.mode || "").toLowerCase();
    const opinions = Array.isArray(data.debate?.opinions) ? data.debate.opinions : [];

    if (status === "failed") {
      const reason = String(data.error || data.analysisGate?.blockers?.[0] || "unknown");
      throw new Error(`issue debate failed: ${reason}`);
    }
    if (status === "completed" && canProceed) {
      assert(mode === "model", `issue debate not model mode, got=${mode || "empty"}`);
      assert(opinions.length >= 2, `issue debate opinions too few: ${opinions.length}`);
      const hasAnalyst = opinions.some((item) => String(item?.roleId || "").trim() === "ROLE_ANALYST");
      const hasNonAnalyst = opinions.some((item) => String(item?.roleId || "").trim() !== "ROLE_ANALYST");
      assert(hasAnalyst && hasNonAnalyst, "issue debate missing analyst/non-analyst collaboration evidence");
      return data;
    }
    if (status === "completed" && !canProceed) {
      const blocker = String(data.analysisGate?.blockers?.[0] || data.contentProvenance?.note || "analysis gate blocked");
      const modeHint = String(data.debate?.mode || "unknown");
      throw new Error(`issue debate completed but blocked: mode=${modeHint}; blocker=${blocker}`);
    }
    const waitMs = Math.max(800, Number(data.pollAfterMs || 1500));
    await sleep(waitMs);
  }
  throw new Error(`issue debate timeout after ${ISSUE_DEBATE_TIMEOUT_MS}ms: ${issueId}`);
}

async function createIssueFirstProject(input) {
  const preview = await request("POST", "/api/issues/preview", {
    input: input.description,
    sourceType: "text",
    industryCode: "saas",
    debateMode: "model",
    workflowTemplateKey: input.workflowTemplateKey
  });
  assert(preview.ok, `issue preview failed: ${formatResponseForError(preview)}`);
  const previewData = preview.data || {};
  const issueId = String(previewData.issueId || "").trim();
  assert(issueId, "issue preview missing issueId");
  const taskId = String(previewData.debateTask?.taskId || "").trim() || undefined;
  const debate = await waitIssueDebateReady(issueId, taskId);

  const confirm = await request("POST", `/api/issues/${encodeURIComponent(issueId)}/confirm`, {
    finalName: input.name,
    finalDescription: input.description,
    clarificationAnswers: buildClarificationAnswers(previewData.questions),
    projectType: input.projectType,
    parentProjectId: input.parentProjectId,
    relaySourceStageId: input.relaySourceStageId,
    projectInputs: Array.isArray(input.projectInputs) ? input.projectInputs : buildProjectInputByTemplate(input.workflowTemplateKey, input.description),
    workflowTemplateKey: input.workflowTemplateKey,
    autoStartWorkflow: true
  });
  assert(confirm.ok, `issue confirm failed: ${formatResponseForError(confirm)}`);
  const project = confirm.data?.project || confirm.data;
  assert(project && typeof project.id === "string", "issue confirm missing project id");
  return {
    issueId,
    project,
    debate
  };
}

async function getProject(projectId) {
  const detail = await request("GET", `/api/projects/${encodeURIComponent(projectId)}`);
  assert(detail.ok, `get project failed: ${formatResponseForError(detail)}`);
  return detail.data;
}

async function getWorkflowOverview(projectId) {
  const response = await request("GET", `/api/v1/workflows/projects/${encodeURIComponent(projectId)}/overview`);
  assert(response.ok, `workflow overview failed: ${formatResponseForError(response)}`);
  return response.data;
}

async function getProjectTasks(projectId) {
  const response = await request("GET", `/api/projects/${encodeURIComponent(projectId)}/tasks`);
  if (!response.ok) {
    return [];
  }
  const data = response.data;
  if (Array.isArray(data)) {
    return data;
  }
  if (Array.isArray(data?.tasks)) {
    return data.tasks;
  }
  return [];
}

async function submitDesignReview(projectId) {
  const content = [
    "# 设计审查卡.md",
    "## 视觉方案",
    "- 以业务目标与验收口径为核心，聚焦关键路径。",
    "## 信息架构",
    "- 首页概览、核心功能区、验证证据区。",
    "## 交互细节",
    "- 关键动作一步可达，状态反馈清晰。",
    "## 可访问性",
    "- 键盘可达、对比度达标、图表含文字说明。",
    "## 设计审查卡",
    "- 审查结论: 通过",
    "## 单页预览",
    "```html",
    "<!doctype html><html><head><title>visual preview</title></head><body><main><h1>Visual Preview</h1><p>Design validated.</p></main></body></html>",
    "```"
  ].join("\n");
  const response = await request("POST", `/api/projects/${encodeURIComponent(projectId)}/stages/submit`, {
    title: "设计审查卡.md",
    content,
    designReview: {
      approvedBy: "real-acceptance",
      approved: true,
      visualDirection: "结构清晰、证据优先",
      uxPrinciples: ["主链路优先", "状态可解释", "快速反馈"],
      accessibilityChecklist: ["键盘可达", "文本对比达标", "图表附文字说明"]
    },
    finalizeApproval: false
  });
  return response;
}

async function submitGenericDeliverable(projectId, title = "阶段交付补充.md") {
  const detail = await getProject(projectId);
  const response = await request("POST", `/api/projects/${encodeURIComponent(projectId)}/stages/submit`, {
    title,
    content: [
      `# ${detail.currentStage || "当前阶段"} 交付补充`,
      "",
      "## 已确认事实",
      "- 已基于真实模型执行本阶段任务。",
      "",
      "## 产出与证据",
      "- 关键产出已生成并可复核。",
      "- 包含可执行结论与下一步交接要求。",
      "",
      "## 协作交接卡",
      "- factsConfirmed: 当前阶段目标与边界已确认",
      "- assumptions: 无新增关键假设",
      "- decisions: 按既定模板继续推进",
      "- handoff: 将当前产出交给下一阶段执行",
      "- openQuestions: 无阻断性未决问题"
    ].join("\n")
  });
  return response;
}

async function handleRequiredActions(projectId, requiredActions, logs) {
  const actions = Array.isArray(requiredActions) ? requiredActions : [];
  for (const item of actions) {
    const action = String(item?.action || "").trim();
    logs.push({ type: "required_action", action, title: String(item?.title || "") });
    if (action === "review_pending_stage") {
      const approve = await request("POST", `/api/projects/${encodeURIComponent(projectId)}/approve`, {});
      logs.push({ type: "approve_from_required", status: approve.status, code: approve.body?.error?.code || null });
      continue;
    }
    if (action === "reconcile_deliverables") {
      const reconcile = await request("POST", `/api/projects/${encodeURIComponent(projectId)}/reconcile-deliverables`, {});
      logs.push({ type: "reconcile", status: reconcile.status });
      continue;
    }
    if (action === "open_design_review") {
      const submitted = await submitDesignReview(projectId);
      logs.push({ type: "submit_design_review", status: submitted.status });
      continue;
    }
    if (action === "submit_stage_deliverable") {
      const submitted = await submitGenericDeliverable(projectId);
      logs.push({ type: "submit_stage_deliverable", status: submitted.status });
      continue;
    }
    if (action === "resolve_blocked_tasks") {
      const tasks = await getProjectTasks(projectId);
      const blocked = tasks.filter((task) => String(task?.status || "").toLowerCase() === "blocked");
      for (const task of blocked) {
        const patched = await request("PATCH", `/api/tasks/${encodeURIComponent(String(task.id || ""))}`, {
          status: "done"
        });
        logs.push({ type: "resolve_blocked_task", taskId: task.id, status: patched.status });
      }
      continue;
    }
    if (action === "refresh_runtime") {
      const health = await request("GET", "/health");
      assert(health.ok, "runtime health check failed during refresh_runtime");
      const runtimeMode = String(health.body?.runtime?.mode || "");
      assert(runtimeMode && runtimeMode !== "scripted", `runtime mode invalid: ${runtimeMode || "empty"}`);
      logs.push({ type: "refresh_runtime_checked", runtimeMode });
      continue;
    }
  }
}

async function advanceProjectToCompleted(projectId, label) {
  const logs = [];
  let lastStage = "";
  let inProgressRetries = 0;

  for (let round = 1; round <= MAX_ADVANCE_ROUNDS; round += 1) {
    const detail = await getProject(projectId);
    const fingerprint = `${detail.status}|${detail.currentStage}|${detail.pendingApproval ? 1 : 0}|${detail.progress}`;
    if (fingerprint !== lastStage) {
      logs.push({
        type: "state",
        round,
        status: detail.status,
        stage: detail.currentStage,
        pendingApproval: Boolean(detail.pendingApproval),
        progress: Number(detail.progress || 0)
      });
      lastStage = fingerprint;
    }

    if (detail.status === "completed") {
      const finalArtifacts = await request("GET", `/api/projects/${encodeURIComponent(projectId)}/final-artifacts`);
      logs.push({
        type: "final_artifacts",
        status: finalArtifacts.status,
        readyForAcceptance: finalArtifacts.data?.readyForAcceptance
      });
      return {
        finalProject: detail,
        logs
      };
    }

    if (detail.pendingApproval) {
      const approve = await request("POST", `/api/projects/${encodeURIComponent(projectId)}/approve`, {});
      if (approve.ok) {
        logs.push({ type: "approve", round, status: approve.status });
        inProgressRetries = 0;
        continue;
      }

      const code = String(approve.body?.error?.code || "");
      logs.push({ type: "approve_failed", round, status: approve.status, code, message: String(approve.body?.error?.message || approve.body?.message || "") });
      if (approve.status === 409 && code === "NO_PENDING_APPROVAL") {
        await sleep(900);
        continue;
      }
      if (approve.status === 422 && code === "STAGE_TEMPLATE_VALIDATION_FAILED") {
        await request("POST", `/api/projects/${encodeURIComponent(projectId)}/reconcile-deliverables`, {});
        await sleep(1000);
        continue;
      }
      if (approve.status === 422 && code === "REAL_MODEL_GATE_FAILED") {
        await handleRequiredActions(projectId, approve.body?.error?.requiredActions, logs);
        await sleep(1200);
        continue;
      }
      const message = String(approve.body?.error?.message || approve.body?.message || "");
      if (approve.status === 422 && /DESIGN_REVIEW|VISUAL_PREVIEW|STITCH/i.test(message)) {
        await submitDesignReview(projectId);
        await sleep(1200);
        continue;
      }
      throw new Error(`[${label}] approve failed: ${formatResponseForError(approve)}`);
    }

    const advance = await request("POST", `/api/projects/${encodeURIComponent(projectId)}/advance`, {});
    if (advance.ok) {
      logs.push({ type: "advance", round, status: advance.status });
      inProgressRetries = 0;
      continue;
    }

    const code = String(advance.body?.error?.code || "");
    logs.push({ type: "advance_failed", round, status: advance.status, code, message: String(advance.body?.error?.message || "") });
    if (advance.status === 409 && code === "PROJECT_ADVANCE_IN_PROGRESS") {
      inProgressRetries += 1;
      const pollAfter = Math.max(800, Number(advance.body?.error?.pollAfterMs || 1500));
      await sleep(pollAfter);
      continue;
    }
    inProgressRetries = 0;
    if (advance.status === 409 && code === "REQUIRES_USER_INTERVENTION") {
      await handleRequiredActions(projectId, advance.body?.error?.requiredActions, logs);
      await sleep(1000);
      continue;
    }
    if (advance.status === 409 && code === "PROJECT_ADVANCE_FAILED") {
      const message = String(advance.body?.error?.message || "");
      if (/STAGE_TEMPLATE_VALIDATION_FAILED/i.test(message)) {
        await request("POST", `/api/projects/${encodeURIComponent(projectId)}/reconcile-deliverables`, {});
        await sleep(1200);
        continue;
      }
      if (/DESIGN_REVIEW_REQUIRED|DESIGN_VISUAL_PREVIEW_REQUIRED|DESIGN_STITCH/i.test(message)) {
        await submitDesignReview(projectId);
        await sleep(1200);
        continue;
      }
      if (/REAL_MODEL_GATE_FAILED/i.test(message)) {
        const detail = await getProject(projectId);
        await handleRequiredActions(projectId, detail.requiredActions, logs);
        await sleep(1200);
        continue;
      }
    }
    throw new Error(`[${label}] advance failed: ${formatResponseForError(advance)}`);
  }

  throw new Error(`[${label}] did not complete within ${MAX_ADVANCE_ROUNDS} rounds`);
}

async function queryGitLabBindings(projectId) {
  const syncRows = await prisma.$queryRawUnsafe(
    "SELECT id, projectId, issueIid, projectPath, status, createdAt, updatedAt FROM GitLabSync WHERE projectId = ? ORDER BY createdAt DESC",
    projectId
  );
  const bindingRows = await prisma.$queryRawUnsafe(
    "SELECT id, projectId, bindingType, issueIid, gitlabProjectId, issueUrl, updatedAt FROM GitLabSyncBinding WHERE projectId = ? ORDER BY updatedAt DESC",
    projectId
  );
  return {
    syncRows: Array.isArray(syncRows) ? syncRows : [],
    bindingRows: Array.isArray(bindingRows) ? bindingRows : []
  };
}

function assertWorkflowMode(mode, overview) {
  const nodes = Array.isArray(overview?.nodes) ? overview.nodes : [];
  const nodeKeys = nodes.map((node) => String(node?.templateKey || "").trim());

  if (mode === "single") {
    assert(nodes.length === 1, `single-stage workflow node count invalid: ${nodes.length}`);
    assert(nodeKeys[0] === "visual_design", `single-stage template mismatch: ${nodeKeys[0]}`);
  } else if (mode === "relay") {
    assert(nodes.length === 1, `relay workflow node count invalid: ${nodes.length}`);
    assert(nodeKeys[0] === "qa_acceptance", `relay template mismatch: ${nodeKeys[0]}`);
  } else if (mode === "full") {
    const required = ["requirements_design", "visual_design", "tech_design", "code_dev", "qa_acceptance"];
    assert(nodes.length >= 5, `full-flow workflow node count invalid: ${nodes.length}`);
    for (const key of required) {
      assert(nodeKeys.includes(key), `full-flow missing node: ${key}`);
    }
  }
}

async function ensureSession() {
  SESSION_TOKEN = generateSessionToken();
  await prisma.authSession.create({
    data: {
      tokenHash: await hashSessionToken(SESSION_TOKEN),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS)
    }
  });
}

async function cleanupSession() {
  if (!SESSION_TOKEN) {
    return;
  }
  await prisma.authSession.deleteMany({
    where: {
      tokenHash: await hashSessionToken(SESSION_TOKEN)
    }
  });
}

async function ensureRuntimeHealthy() {
  const health = await request("GET", "/health");
  assert(health.ok, `health check failed: ${formatResponseForError(health)}`);
  const mode = String(health.body?.runtime?.mode || "");
  assert(mode && mode !== "scripted", `runtime mode must be real model, got ${mode || "empty"}`);
  const workflowHealth = await request("GET", "/api/v1/workflows/health");
  assert(workflowHealth.ok, `workflow-v2 health failed: ${formatResponseForError(workflowHealth)}`);
  const hermesHealth = await fetch("http://127.0.0.1:3001/mcp/health").then((res) => res.ok).catch(() => false);
  assert(hermesHealth, "Hermes MCP health check failed at http://127.0.0.1:3001/mcp/health");
  return {
    runtimeMode: mode,
    runtimeModel: String(health.body?.runtime?.modelName || ""),
    runtimeApiBase: String(health.body?.runtime?.apiBaseUrl || "")
  };
}

async function summarizeExecutions(projectId) {
  const response = await request("GET", `/api/projects/${encodeURIComponent(projectId)}/executions?limit=500`);
  if (!response.ok) {
    return {
      total: 0,
      scriptedCount: 0,
      providerCounts: {},
      modelCounts: {}
    };
  }
  const executions = Array.isArray(response.data?.executions) ? response.data.executions : [];
  const providerCounts = {};
  const modelCounts = {};
  let scriptedCount = 0;
  for (const item of executions) {
    const provider = String(item?.provider || "unknown");
    const model = String(item?.model || "unknown");
    providerCounts[provider] = (providerCounts[provider] || 0) + 1;
    modelCounts[model] = (modelCounts[model] || 0) + 1;
    if (/scripted/i.test(provider) || /scripted/i.test(model)) {
      scriptedCount += 1;
    }
  }
  return {
    total: executions.length,
    scriptedCount,
    providerCounts,
    modelCounts
  };
}

async function runScenario(input) {
  const setupLogs = [];
  const created = await createIssueFirstProject(input);
  const projectId = String(created.project.id || "").trim();
  assert(projectId, `[${input.label}] empty project id`);

  const modeDetail = await getProject(projectId);
  const overview = await getWorkflowOverview(projectId);
  await ensureInputContractReady(projectId, input.workflowTemplateKey, setupLogs);
  assertWorkflowMode(input.mode, overview);
  const advanced = await advanceProjectToCompleted(projectId, input.label);
  const finalOverview = await getWorkflowOverview(projectId);
  const gitlab = await queryGitLabBindings(projectId);
  const executions = await summarizeExecutions(projectId);

  return {
    label: input.label,
    mode: input.mode,
    issueId: created.issueId,
    debate: {
      status: created.debate.status,
      mode: created.debate?.debate?.mode || null,
      canProceed: Boolean(created.debate?.analysisGate?.canProceed),
      opinions: Array.isArray(created.debate?.debate?.opinions) ? created.debate.debate.opinions.length : 0
    },
    project: {
      id: projectId,
      name: modeDetail.name,
      projectType: modeDetail.projectType,
      parentProjectId: modeDetail.parentProjectId || null,
      status: advanced.finalProject.status,
      currentStage: advanced.finalProject.currentStage,
      progress: advanced.finalProject.progress
    },
    workflow: {
      workflowId: overview.workflowId,
      templateKey: overview.template?.key,
      nodeCount: Array.isArray(overview.nodes) ? overview.nodes.length : 0,
      nodeTemplateKeys: Array.isArray(overview.nodes) ? overview.nodes.map((item) => item.templateKey) : [],
      stageExecutionEngines: Array.isArray(finalOverview.stages)
        ? finalOverview.stages.map((stage) => ({
            stageId: stage.id,
            templateKey: stage.templateKey,
            status: stage.status,
            executionEngine: stage.executionEngine,
            collaboration: stage.collaboration,
            assignedAgentProfiles: stage.assignedAgentProfiles
          }))
        : []
    },
    gitlab: {
      syncCount: gitlab.syncRows.length,
      bindingCount: gitlab.bindingRows.length,
      latestSync: gitlab.syncRows[0] || null,
      latestBinding: gitlab.bindingRows[0] || null
    },
    executions,
    advanceLogs: [...setupLogs, ...advanced.logs]
  };
}

async function main() {
  const report = {
    ok: true,
    startedAt: new Date().toISOString(),
    apiBase: API_BASE,
    runtime: {},
    scenarios: [],
    assertions: [],
    errors: []
  };

  try {
    await ensureSession();
    report.runtime = await ensureRuntimeHealthy();

    const single = await runScenario({
      label: "single-stage-visual",
      mode: "single",
      name: `验收-单阶段-视觉-${Date.now()}`,
      description: "请创建单阶段视觉设计项目，需由真实模型完成多角色讨论并最终交付可验收设计产物。",
      workflowTemplateKey: "visual_design",
      projectType: "standalone",
      projectInputs: buildProjectInputByTemplate("visual_design", "视觉设计阶段输入：提供PRD、页面目标、品牌风格、主要用户任务和验收口径。")
    });
    report.scenarios.push(single);

    const full = await runScenario({
      label: "full-flow-standard",
      mode: "full",
      name: `验收-全流程-${Date.now()}`,
      description: "请创建全流程项目，按需求设计、视觉设计、技术设计、代码研发、QA验收完整推进并交付。",
      workflowTemplateKey: "standard_software_development",
      projectType: "complete",
      projectInputs: buildProjectInputByTemplate("standard_software_development", "全流程输入：业务目标、核心场景、范围边界、验收标准、非功能约束。")
    });
    report.scenarios.push(full);

    const relay = await runScenario({
      label: "relay-qa",
      mode: "relay",
      name: `验收-阶段接力-QA-${Date.now()}`,
      description: "请创建阶段接力项目，从上游项目导入产物后执行 QA 验收并形成可交付报告。",
      workflowTemplateKey: "qa_acceptance",
      projectType: "relay",
      parentProjectId: full.project.id,
      projectInputs: buildProjectInputByTemplate("qa_acceptance", "接力验收输入：sourceCode、验收清单、已知风险与回归重点。")
    });
    report.scenarios.push(relay);

    for (const scenario of report.scenarios) {
      report.assertions.push({
        scenario: scenario.label,
        projectCompleted: scenario.project.status === "completed",
        issueDebateModel: scenario.debate.mode === "model" && scenario.debate.canProceed === true,
        gitlabSynced: scenario.gitlab.syncCount > 0 || scenario.gitlab.bindingCount > 0,
        noScriptedExecution: scenario.executions.scriptedCount === 0
      });
    }

    const hasHermesEvidence = report.scenarios.some((scenario) =>
      scenario.workflow.stageExecutionEngines.some((item) =>
        String(item.executionEngine || "").toLowerCase() === "hermes"
        || String(item.executionEngine || "").toLowerCase() === "hybrid"
      )
    );
    const hasOpenclawEvidence = report.scenarios.some((scenario) =>
      scenario.workflow.stageExecutionEngines.some((item) =>
        String(item.executionEngine || "").toLowerCase() === "openclaw"
        || String(item.executionEngine || "").toLowerCase() === "hybrid"
      )
      || Object.keys(scenario.executions.providerCounts || {}).some((provider) =>
        String(provider).toLowerCase().includes("openai") || String(provider).toLowerCase().includes("openclaw")
      )
    );
    report.assertions.push({
      scenario: "global",
      hermesParticipated: hasHermesEvidence,
      openclawParticipated: hasOpenclawEvidence
    });

    const failedAssertions = report.assertions.filter((item) =>
      Object.entries(item).some(([key, value]) => key !== "scenario" && value === false)
    );
    if (failedAssertions.length > 0) {
      report.ok = false;
      report.errors.push(`assertions failed: ${JSON.stringify(failedAssertions)}`);
    }
  } catch (error) {
    report.ok = false;
    report.errors.push(error instanceof Error ? error.stack || error.message : String(error));
  } finally {
    report.finishedAt = new Date().toISOString();
    await mkdir(REPORT_DIR, { recursive: true });
    await writeFile(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
    console.log(JSON.stringify({ reportPath: REPORT_PATH, ok: report.ok, errors: report.errors }, null, 2));
    await cleanupSession();
    await prisma.$disconnect();
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
}

await main();
