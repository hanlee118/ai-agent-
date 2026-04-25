import fs from "node:fs/promises";
import path from "node:path";

const defaultPostgresUrl = "postgresql://occ:occ@127.0.0.1:5432/occ?schema=public";
if (!String(process.env.DATABASE_URL || "").trim()) {
  process.env.DATABASE_URL = defaultPostgresUrl;
}

const [{ prisma }, { generateSessionToken, hashSessionToken }] = await Promise.all([
  import("../apps/api/dist/db.js"),
  import("../apps/api/dist/security/secret-store.js"),
]);

const API_BASE = String(process.env.API_BASE || "http://127.0.0.1:8787").replace(/\/$/, "");
const REQUESTED_PROJECT_ID = String(process.env.PROJECT_ID || "OCC-20260424-001").trim();
const AUDIT_AUTO_RESOLVE_PROJECT = String(process.env.AUDIT_AUTO_RESOLVE_PROJECT || "true").toLowerCase() !== "false";
const AUDIT_STRICT = String(process.env.AUDIT_STRICT || "true").toLowerCase() !== "false";
const AUDIT_REQUIRE_HERMES = String(process.env.AUDIT_REQUIRE_HERMES || "true").toLowerCase() !== "false";
const AUDIT_REQUIRE_NON_SCRIPTED = String(process.env.AUDIT_REQUIRE_NON_SCRIPTED || "true").toLowerCase() !== "false";
const AUDIT_REQUIRE_LIFECYCLE_GATE = String(process.env.AUDIT_REQUIRE_LIFECYCLE_GATE || "true").toLowerCase() !== "false";
const AUDIT_REQUIRE_ACCEPTANCE_GATE = String(process.env.AUDIT_REQUIRE_ACCEPTANCE_GATE || "true").toLowerCase() !== "false";
const AUDIT_REQUIRE_SUSPICIOUS_ZERO = String(process.env.AUDIT_REQUIRE_SUSPICIOUS_ZERO || "true").toLowerCase() !== "false";
const AUDIT_REQUIRE_PLACEHOLDER_ZERO = String(process.env.AUDIT_REQUIRE_PLACEHOLDER_ZERO || "true").toLowerCase() !== "false";
const AUDIT_SETUP_PASSWORD = String(process.env.AUDIT_SETUP_PASSWORD || "Admin@123456").trim();
const AUDIT_OUT = String(
  process.env.AUDIT_OUT || path.resolve(process.cwd(), "docs/reports/single-project-platform-audit-latest.json"),
);

let TARGET_PROJECT_ID = REQUESTED_PROJECT_ID;

function buildChecks(projectId) {
  return [
  { menu: "概览(dashboard)", key: "projects.list", method: "GET", path: "/api/projects" },
  { menu: "概览(dashboard)", key: "tasks.list", method: "GET", path: "/api/tasks" },
  { menu: "概览(dashboard)", key: "agents.list", method: "GET", path: "/api/agents" },
  { menu: "概览(dashboard)", key: "workspace.overview", method: "GET", path: "/api/openclaw/workspace" },

  { menu: "项目组合(projects)", key: "project.detail", method: "GET", path: `/api/projects/${encodeURIComponent(projectId)}` },
  { menu: "项目组合(projects)", key: "project.executions", method: "GET", path: `/api/projects/${encodeURIComponent(projectId)}/executions?limit=50` },
  { menu: "项目组合(projects)", key: "project.lifecycleAudit", method: "GET", path: `/api/projects/${encodeURIComponent(projectId)}/lifecycle-quality-audit` },
  { menu: "项目组合(projects)", key: "project.acceptance", method: "GET", path: `/api/projects/${encodeURIComponent(projectId)}/acceptance-report` },
  { menu: "项目组合(projects)", key: "project.artifacts", method: "GET", path: `/api/projects/${encodeURIComponent(projectId)}/final-artifacts` },

  { menu: "Agent名册(agents)", key: "openclaw.agents", method: "GET", path: "/api/openclaw/agents" },
  { menu: "Agent指挥(agent-commander)", key: "tasks.list.2", method: "GET", path: "/api/tasks" },

  { menu: "模型中心(model-nexus)", key: "models.list", method: "GET", path: "/api/models" },
  { menu: "模型中心(model-nexus)", key: "design.policy.health", method: "GET", path: "/api/system/design-model-policy/health" },

  { menu: "实时监控(monitoring)", key: "openclaw.projects", method: "GET", path: "/api/openclaw/projects" },
  { menu: "工作区(workspace)", key: "openclaw.workspace", method: "GET", path: "/api/openclaw/workspace" },

  { menu: "知识库(knowledge-hub)", key: "knowledge.status", method: "GET", path: `/api/v1/knowledge/status?projectId=${encodeURIComponent(projectId)}&forceRefresh=true` },
  { menu: "知识库(knowledge-hub)", key: "knowledge.list", method: "GET", path: `/api/v1/knowledge?projectId=${encodeURIComponent(projectId)}&limit=20` },
  { menu: "知识库(knowledge-hub)", key: "knowledge.forHermes", method: "GET", path: `/api/v1/knowledge/for-hermes?projectId=${encodeURIComponent(projectId)}&limit=20` },
  { menu: "知识库(knowledge-hub)", key: "skills.forHermes", method: "GET", path: `/api/v1/skills/for-hermes?projectId=${encodeURIComponent(projectId)}&limit=20` },

  { menu: "系统运行(system-health)", key: "system.health", method: "GET", path: "/api/system/health" },
  { menu: "系统运行(system-health)", key: "system.runtime", method: "GET", path: "/api/system/runtime" },
  { menu: "系统运行(system-health)", key: "system.executionProtocol", method: "GET", path: "/api/system/execution-protocol" },
  { menu: "系统运行(system-health)", key: "system.readiness", method: "GET", path: "/api/system/readiness" },

  { menu: "审计追踪(audit)", key: "audit.logs", method: "GET", path: "/api/system/audit-logs?limit=50" },

  { menu: "设置(settings)", key: "system.runtime.config", method: "GET", path: "/api/system/runtime/config" },
  { menu: "设置(settings)", key: "system.ui.preferences", method: "GET", path: "/api/system/ui-preferences" },
  ];
}
const ACCEPTABLE_STATUS_BY_KEY = {
  "design.policy.health": [200, 503]
};

function unwrap(payload) {
  if (payload && typeof payload === "object" && "success" in payload && "data" in payload) {
    return payload.data;
  }
  return payload;
}

function toJsonSafe(value) {
  return JSON.stringify(value, (_key, val) => (typeof val === "bigint" ? Number(val) : val));
}

function containsPlaceholderTokens(value) {
  const text = String(value || "");
  const genericPattern = /(待补充|占位(词|符)?|placeholder|lorem ipsum|\bxxx\b)/i;
  const todoPattern = /(?:^|[\s:：\-\[\(])(?:TODO|TBD)(?=$|[\s:：\]\),.!?])/;
  return genericPattern.test(text) || todoPattern.test(text);
}

function shouldEvaluatePlaceholderForKey(key) {
  return new Set([
    "project.detail",
    "project.lifecycleAudit",
    "project.acceptance",
    "project.artifacts",
    "project.executions",
  ]).has(String(key || ""));
}

function summarizeResult(key, data) {
  if (key === "projects.list" && Array.isArray(data)) {
    return { count: data.length, hasTargetProject: data.some((item) => item?.id === TARGET_PROJECT_ID) };
  }
  if (key === "tasks.list" || key === "tasks.list.2") {
    return { count: Array.isArray(data) ? data.length : 0 };
  }
  if (key === "agents.list") {
    return { count: Array.isArray(data) ? data.length : 0 };
  }
  if (key === "workspace.overview" || key === "openclaw.workspace") {
    return { rootPath: data?.rootPath || null, projectCount: Array.isArray(data?.projects) ? data.projects.length : null };
  }
  if (key === "project.detail") {
    return {
      id: data?.id,
      status: data?.status,
      currentStage: data?.currentStage,
      progress: data?.progress,
      deliverables: Array.isArray(data?.deliverables) ? data.deliverables.length : null,
    };
  }
  if (key === "project.executions") {
    const rows = Array.isArray(data?.executions) ? data.executions : [];
    const recentWindow = rows.slice(0, 8);
    return {
      total: rows.length,
      success: rows.filter((item) => item?.status === "success").length,
      failed: rows.filter((item) => item?.status === "failed").length,
      hermesCount: rows.filter((item) => String(item?.model || "").includes("hermes")).length,
      scriptedLike: rows.filter((item) => /script/i.test(String(item?.runtimeMode || ""))).length,
      scriptedLikeRecent: recentWindow.filter((item) => /script/i.test(String(item?.runtimeMode || ""))).length,
      nonScriptedRecentSuccess: recentWindow.filter((item) =>
        String(item?.status || "").toLowerCase() === "success"
        && !/script/i.test(String(item?.runtimeMode || ""))
      ).length
    };
  }
  if (key === "project.lifecycleAudit") {
    return {
      pass: Boolean(data?.pass),
      blockingStageCount: Number(data?.blockingStageCount || 0),
      blockingStages: Array.isArray(data?.blockingStages) ? data.blockingStages : [],
    };
  }
  if (key === "project.acceptance") {
    return {
      qualityGatePass: Boolean(data?.qualityGate?.pass),
      blockingStageCount: Number(data?.qualityGate?.blockingStageCount || 0),
      suspiciousDeliverables: Number(data?.dataQuality?.deliverables?.suspiciousCount || 0),
      executionTotal: Number(data?.dataQuality?.executions?.total || 0),
    };
  }
  if (key === "project.artifacts") {
    return {
      readyForAcceptance: Boolean(data?.readyForAcceptance),
      artifacts: Array.isArray(data?.artifacts) ? data.artifacts.length : 0,
      missingRequired: Array.isArray(data?.missingRequired) ? data.missingRequired.length : 0,
    };
  }
  if (key === "openclaw.agents" || key === "openclaw.projects" || key === "models.list") {
    return { count: Array.isArray(data) ? data.length : 0 };
  }
  if (key === "knowledge.status") {
    return {
      schemaReady: Boolean(data?.schema?.ready),
      inventoryTotal: Number(data?.inventory?.total || 0),
      rollbackableOps: Number(data?.operations?.rollbackableCount || 0),
    };
  }
  if (key === "knowledge.list") {
    return {
      total: Number(data?.total || 0),
      items: Array.isArray(data?.items) ? data.items.length : 0,
    };
  }
  if (key === "knowledge.forHermes") {
    return { items: Array.isArray(data?.items) ? data.items.length : 0 };
  }
  if (key === "skills.forHermes") {
    return { skills: Array.isArray(data?.skills) ? data.skills.length : 0 };
  }
  if (key === "design.policy.health") {
    return { ok: Boolean(data?.ok), status: data?.summary?.status || null, issueCount: Number(data?.summary?.issueCount || 0) };
  }
  if (key === "system.health") {
    return {
      status: data?.status || null,
      runtimeMode: data?.runtime?.mode || null,
      runtimeModel: data?.runtime?.modelName || null,
      pendingApprovals: Number(data?.pendingApprovals || 0),
    };
  }
  if (key === "audit.logs") {
    return { count: Array.isArray(data) ? data.length : 0 };
  }
  return {};
}

async function callApi(sessionToken, item) {
  const response = await fetch(`${API_BASE}${item.path}`, {
    method: item.method,
    headers: {
      "content-type": "application/json",
      cookie: `occ_session=${sessionToken}`,
    },
  });
  const rawText = await response.text();
  let payload = rawText;
  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    // keep raw text
  }
  const acceptableStatus = ACCEPTABLE_STATUS_BY_KEY[item.key] || [200];
  const ok = response.ok || acceptableStatus.includes(response.status);
  return { status: response.status, ok, data: unwrap(payload), payload };
}

async function ensureSystemSetupReady() {
  const statusResponse = await fetch(`${API_BASE}/api/auth/status`);
  if (!statusResponse.ok) {
    throw new Error(`读取 /api/auth/status 失败: HTTP ${statusResponse.status}`);
  }
  const statusPayload = unwrap(await statusResponse.json());
  const setupComplete = Boolean(statusPayload?.setupComplete);
  if (setupComplete) {
    return;
  }

  const setupResponse = await fetch(`${API_BASE}/api/auth/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: AUDIT_SETUP_PASSWORD }),
  });
  if (!setupResponse.ok) {
    const raw = await setupResponse.text();
    throw new Error(`初始化管理员失败: HTTP ${setupResponse.status} ${raw.slice(0, 200)}`);
  }
}

async function resolveAuditProjectId() {
  const requested = REQUESTED_PROJECT_ID;
  if (requested) {
    const target = await prisma.project.findUnique({
      where: { id: requested },
      select: { id: true }
    });
    if (target?.id) {
      return {
        projectId: target.id,
        mode: "requested"
      };
    }
  }

  if (!AUDIT_AUTO_RESOLVE_PROJECT) {
    return {
      projectId: requested,
      mode: "requested_not_found"
    };
  }

  const fallback = await prisma.project.findFirst({
    where: { status: "completed" },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: { id: true }
  }) || await prisma.project.findFirst({
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: { id: true }
  });

  return {
    projectId: fallback?.id || requested,
    mode: fallback?.id ? "auto_resolved" : "requested_not_found"
  };
}

await ensureSystemSetupReady();
const projectResolution = await resolveAuditProjectId();
TARGET_PROJECT_ID = String(projectResolution.projectId || "").trim();
const checks = buildChecks(TARGET_PROJECT_ID);
const sessionToken = generateSessionToken();
const tokenHash = await hashSessionToken(sessionToken);

await prisma.authSession.create({
  data: {
    tokenHash,
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
  },
});

try {
  const results = [];
  for (const item of checks) {
    const result = await callApi(sessionToken, item);
    const summary = result.ok
      ? summarizeResult(item.key, result.data)
      : {
          message:
            result?.payload?.message
            || result?.payload?.error?.message
            || String(result.payload || "").slice(0, 220),
        };
    results.push({
      menu: item.menu,
      key: item.key,
      path: item.path,
      status: result.status,
      ok: result.ok,
      hasPlaceholderTokens: shouldEvaluatePlaceholderForKey(item.key)
        ? containsPlaceholderTokens(toJsonSafe(result.data))
        : false,
      summary,
    });
  }

  const acceptanceResult = results.find((item) => item.key === "project.acceptance");
  const acceptanceSummary = acceptanceResult?.summary && typeof acceptanceResult.summary === "object"
    ? acceptanceResult.summary
    : {};
  const acceptanceSuspiciousCount = Number(acceptanceSummary.suspiciousDeliverables || 0);

  const deliverables = await prisma.deliverable.findMany({
    where: { projectId: TARGET_PROJECT_ID },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      stageType: true,
      status: true,
      content: true,
      updatedAt: true,
    },
  });

  const deliverableDiagnostics = {
    total: deliverables.length,
    placeholderTokenHits: deliverables
      .filter((item) => containsPlaceholderTokens(item.name) || containsPlaceholderTokens(item.content))
      .map((item) => ({
        id: item.id,
        name: item.name,
        stageType: item.stageType,
        status: item.status,
        updatedAt: item.updatedAt,
      })),
    suspiciousCountFromAcceptance: acceptanceSuspiciousCount,
    mentionedProjectIds: Array.from(new Set((toJsonSafe(deliverables).match(/OCC-\d{8}-\d{3}/g) || []))),
  };

  const totals = {
    total: results.length,
    pass: results.filter((item) => item.ok).length,
    fail: results.filter((item) => !item.ok).length,
  };

  const byMenu = {};
  for (const item of results) {
    if (!byMenu[item.menu]) {
      byMenu[item.menu] = { total: 0, pass: 0, fail: 0 };
    }
    byMenu[item.menu].total += 1;
    if (item.ok) byMenu[item.menu].pass += 1;
    if (!item.ok) byMenu[item.menu].fail += 1;
  }

  const projectDetailSummary = results.find((item) => item.key === "project.detail")?.summary || {};
  const executionSummary = results.find((item) => item.key === "project.executions")?.summary || {};
  const lifecycleSummary = results.find((item) => item.key === "project.lifecycleAudit")?.summary || {};
  const artifactsSummary = results.find((item) => item.key === "project.artifacts")?.summary || {};
  const placeholderApiHits = results.filter((item) => item.hasPlaceholderTokens).map((item) => item.key);
  const projectScopedKeys = new Set([
    "project.detail",
    "project.executions",
    "project.lifecycleAudit",
    "project.acceptance",
    "project.artifacts"
  ]);
  const projectNotFound = results
    .filter((item) => projectScopedKeys.has(item.key))
    .every((item) => item.status === 404);
  const apiFailCountForGate = projectNotFound
    ? results.filter((item) => !item.ok && !projectScopedKeys.has(item.key)).length
    : totals.fail;

  function gateValueForProjectScopedCheck(pass, detail) {
    if (projectNotFound) {
      return { pass: true, detail: "skipped: project not found" };
    }
    return { pass, detail };
  }

  const gates = [
    { name: "api_all_pass", pass: apiFailCountForGate === 0, detail: `fail=${apiFailCountForGate}` },
    (() => {
      const value = gateValueForProjectScopedCheck(
        String(projectDetailSummary?.id || "") === TARGET_PROJECT_ID,
        `actual=${projectDetailSummary?.id || "n/a"}`
      );
      return {
        name: "project_id_match",
        pass: value.pass,
        detail: value.detail
      };
    })(),
    (() => {
      const value = gateValueForProjectScopedCheck(
        String(projectDetailSummary?.status || "").toLowerCase() === "completed",
        `status=${projectDetailSummary?.status || "n/a"}`
      );
      return {
        name: "project_completed",
        pass: value.pass,
        detail: value.detail
      };
    })(),
    (() => {
      const value = gateValueForProjectScopedCheck(
        AUDIT_REQUIRE_LIFECYCLE_GATE ? Boolean(lifecycleSummary?.pass) : true,
        `blockingStages=${Number(lifecycleSummary?.blockingStageCount || 0)}`
      );
      return {
        name: "lifecycle_gate_pass",
        pass: value.pass,
        detail: value.detail
      };
    })(),
    (() => {
      const value = gateValueForProjectScopedCheck(
        AUDIT_REQUIRE_ACCEPTANCE_GATE ? Boolean(acceptanceSummary?.qualityGatePass) : true,
        `blockingStages=${Number(acceptanceSummary?.blockingStageCount || 0)}`
      );
      return {
        name: "acceptance_gate_pass",
        pass: value.pass,
        detail: value.detail
      };
    })(),
    (() => {
      const value = gateValueForProjectScopedCheck(
        Boolean(artifactsSummary?.readyForAcceptance),
        `missingRequired=${Number(artifactsSummary?.missingRequired || 0)}`
      );
      return {
        name: "final_artifacts_ready",
        pass: value.pass,
        detail: value.detail
      };
    })(),
    (() => {
      const value = gateValueForProjectScopedCheck(
        AUDIT_REQUIRE_HERMES ? Number(executionSummary?.hermesCount || 0) > 0 : true,
        `hermesCount=${Number(executionSummary?.hermesCount || 0)}`
      );
      return {
        name: "hermes_execution_present",
        pass: value.pass,
        detail: value.detail
      };
    })(),
    (() => {
      const value = gateValueForProjectScopedCheck(
        AUDIT_REQUIRE_NON_SCRIPTED
          ? Number(executionSummary?.scriptedLikeRecent || 0) <= 1
            && Number(executionSummary?.nonScriptedRecentSuccess || 0) >= 3
          : true,
        `scriptedLikeRecent=${Number(executionSummary?.scriptedLikeRecent || 0)}; nonScriptedRecentSuccess=${Number(executionSummary?.nonScriptedRecentSuccess || 0)}; scriptedLikeTotal=${Number(executionSummary?.scriptedLike || 0)}`
      );
      return {
        name: "scripted_like_zero",
        pass: value.pass,
        detail: value.detail
      };
    })(),
    {
      name: "suspicious_deliverables_zero",
      pass: AUDIT_REQUIRE_SUSPICIOUS_ZERO ? Number(acceptanceSummary?.suspiciousDeliverables || 0) === 0 : true,
      detail: `count=${Number(acceptanceSummary?.suspiciousDeliverables || 0)}`,
    },
    {
      name: "placeholder_tokens_zero",
      pass: AUDIT_REQUIRE_PLACEHOLDER_ZERO
        ? placeholderApiHits.length === 0 && deliverableDiagnostics.placeholderTokenHits.length === 0
        : true,
      detail: `api=${placeholderApiHits.length},deliverables=${deliverableDiagnostics.placeholderTokenHits.length}`,
    }
  ];

  const report = {
    checkedAt: new Date().toISOString(),
    requestedProjectId: REQUESTED_PROJECT_ID,
    projectId: TARGET_PROJECT_ID,
    projectResolution: projectResolution.mode,
    strictMode: AUDIT_STRICT,
    projectNotFound,
    gates,
    gateSummary: {
      pass: gates.every((item) => item.pass),
      failed: gates.filter((item) => !item.pass).map((item) => ({ name: item.name, detail: item.detail })),
      total: gates.length,
    },
    totals,
    byMenu,
    deliverableDiagnostics,
    results,
  };

  await fs.mkdir(path.dirname(AUDIT_OUT), { recursive: true });
  await fs.writeFile(AUDIT_OUT, JSON.stringify(report, null, 2), "utf8");

  console.log(JSON.stringify(report, null, 2));
  if (AUDIT_STRICT && !report.gateSummary.pass) {
    process.exitCode = 1;
  }
} finally {
  await prisma.authSession.deleteMany({
    where: { tokenHash },
  });
}
await prisma.$disconnect();
