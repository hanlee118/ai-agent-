import http from "node:http";

const BASE = String(process.env.API_BASE || "http://127.0.0.1:8787").replace(/\/$/, "");
const REQUEST_TIMEOUT_MS = Math.max(15000, Number(process.env.REQUEST_TIMEOUT_MS || 240000));
const STAGE_ORDER = ["INIT", "ANALYSIS", "DESIGN", "DEV", "ACCEPT"];
// Real-model mode is slower than scripted mode; keep enough polling rounds to avoid false negatives.
const MAX_ROUNDS = Math.max(24, Number(process.env.MAX_ROUNDS || 180));

const EXPECTED_STAGE_TASK_HINTS = {
  ANALYSIS: ["提炼目标与边界", "输出项目排期", "形成审批版分析稿"],
  DESIGN: ["定义页面与结构", "完成设计审查卡", "输出客户汇报PPT", "输出实施方案Word"],
  DEV: ["输出技术方案与选型", "打通主链路", "实现 Demo 原型", "补全仓储与接口"],
  ACCEPT: ["执行验收检查", "回填产品说明文档", "整理复盘结论"],
};

const stageReached = new Set();
const report = {
  ok: true,
  base: BASE,
  startedAt: new Date().toISOString(),
  projectId: "",
  steps: [],
  checks: [],
  warnings: [],
};

function addStep(step, payload) {
  report.steps.push({
    step,
    timestamp: new Date().toISOString(),
    ...payload,
  });
}

function addCheck(name, passed, detail = "") {
  report.checks.push({
    name,
    passed,
    detail,
  });
  if (!passed) {
    throw new Error(`CHECK_FAILED: ${name}${detail ? ` | ${detail}` : ""}`);
  }
}

function addWarning(message) {
  report.warnings.push(message);
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

function req(method, path, body, options = {}) {
  const timeoutMs = Math.max(5000, Number(options.timeoutMs || REQUEST_TIMEOUT_MS));
  const startedAt = Date.now();
  const url = new URL(`${BASE}${toPath(path)}`);
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
            }
          : undefined,
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
            // keep raw payload
          }
          resolve({
            status: res.statusCode || 0,
            durationMs: Date.now() - startedAt,
            body: parsed,
            unwrapped: unwrap(parsed),
          });
        });
      },
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`REQUEST_TIMEOUT: ${method} ${path} > ${timeoutMs}ms`));
    });

    request.on("error", reject);

    if (payload) {
      request.write(payload);
    }
    request.end();
  });
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Math.round(ms)));
  });
}

function stageIndex(stageType) {
  const index = STAGE_ORDER.indexOf(String(stageType || ""));
  return index >= 0 ? index : -1;
}

function summarizeProject(project) {
  if (!project || typeof project !== "object") {
    return null;
  }
  return {
    id: project.id,
    status: project.status,
    currentStage: project.currentStage,
    currentRole: project.currentRole,
    progress: project.progress,
    pendingApproval: project.pendingApproval,
    taskCount: Array.isArray(project.tasks) ? project.tasks.length : 0,
    deliverableCount: Array.isArray(project.deliverables) ? project.deliverables.length : 0,
  };
}

function assertNoFutureStageDeliverables(project, label) {
  const currentIndex = stageIndex(project.currentStage);
  if (currentIndex < 0) {
    return;
  }
  const deliverables = Array.isArray(project.deliverables) ? project.deliverables : [];
  const future = deliverables
    .filter((item) => stageIndex(item.stageType) > currentIndex)
    .map((item) => `${item.stageType}:${item.name}`);
  addCheck(
    `${label} 不提前暴露未来阶段交付物`,
    future.length === 0,
    future.length > 0 ? future.join(" | ") : "",
  );
}

function assertStageTaskHints(project, stageType, label) {
  const tasks = Array.isArray(project.tasks) ? project.tasks.filter((item) => item.stageType === stageType) : [];
  const titles = tasks.map((item) => String(item.title || ""));
  const expected = EXPECTED_STAGE_TASK_HINTS[stageType] || [];
  const missing = expected.filter((hint) => !titles.some((title) => title.includes(hint)));
  addCheck(
    `${label} 任务拆解完整(${stageType})`,
    missing.length === 0,
    missing.length > 0 ? `missing=${missing.join(",")}` : "",
  );
}

function formatRequiredActions(actions) {
  if (!Array.isArray(actions)) {
    return "[]";
  }
  return actions.map((item) => `${item.action}:${item.id}`).join(", ");
}

async function getProjectDetail(projectId, step) {
  const response = await req("GET", `/api/projects/${encodeURIComponent(projectId)}`);
  addStep(step, { status: response.status, durationMs: response.durationMs, project: summarizeProject(response.unwrapped) });
  addCheck(`${step} 接口可用`, response.status === 200, JSON.stringify(response.body).slice(0, 300));
  return response.unwrapped;
}

async function approveProject(projectId, reason) {
  const response = await req("POST", `/api/projects/${encodeURIComponent(projectId)}/approve`);
  addStep(`approve(${reason})`, { status: response.status, durationMs: response.durationMs, project: summarizeProject(response.unwrapped) });
  addCheck(`审批通过(${reason})`, response.status === 200, JSON.stringify(response.body).slice(0, 300));
  return response.unwrapped;
}

async function reconcileDeliverables(projectId, reason) {
  const response = await req("POST", `/api/projects/${encodeURIComponent(projectId)}/reconcile-deliverables`, {});
  addStep(`reconcile(${reason})`, { status: response.status, durationMs: response.durationMs, project: summarizeProject(response.unwrapped) });
  addCheck(`重建交付物(${reason})`, response.status === 200, JSON.stringify(response.body).slice(0, 300));
  return response.unwrapped;
}

async function submitDesignReview(project) {
  const content = [
    "# 设计审查卡.md",
    "## 视觉方案",
    "- 以业务目标为核心组织页面结构与主路径反馈。",
    "## 版式策略",
    "- 首屏突出价值主张与关键行动入口，后续分层展开能力细节。",
    "## 组件清单",
    "- Hero、流程时间线、证据卡片、验收面板、演示预约模块。",
    "## 品牌语气",
    "- 专业、直接、可执行，减少空泛表达。",
    "## UX 原则",
    "- 主链路优先",
    "- 状态反馈可解释",
    "- 降低认知切换",
    "## 可访问性检查",
    "- 对比度达标",
    "- 键盘可达",
    "- 语义结构完整",
    "## 设计审查卡",
    "- 审查结论: 通过",
    "## 验收检查清单",
    "- 设计说明可支撑开发实施，不依赖口头解释。",
    "- 无障碍检查项至少 3 条并可验证。",
    "- 审查结论明确（通过/驳回）且有理由。",
  ].join("\n");

  const payload = {
    title: "设计审查卡.md",
    content,
    designReview: {
      visualDirection: "高可读业务流程导向",
      brandTone: "专业、直接、可执行",
      uxPrinciples: ["主链路优先", "状态反馈可解释", "减少认知切换"],
      accessibilityChecklist: ["对比度达标", "键盘可达", "语义结构完整"],
      approvedBy: "系统自动审查",
      approved: true,
      notes: "自动补提交流程测试",
    },
  };

  const response = await req("POST", `/api/projects/${encodeURIComponent(project.id)}/stages/submit`, payload, {
    timeoutMs: 120000,
  });
  addStep("submit_design_review", { status: response.status, durationMs: response.durationMs, project: summarizeProject(response.unwrapped) });
  addCheck("设计审查卡提交成功", response.status === 200, JSON.stringify(response.body).slice(0, 400));
  return response.unwrapped;
}

async function resolveBlockedTasks(project) {
  const blockedTasks = (project.tasks || []).filter((item) => item.status === "blocked");
  for (const task of blockedTasks) {
    const response = await req("PATCH", `/api/tasks/${encodeURIComponent(task.id)}`, { status: "done" });
    addStep(`resolve_blocked_task(${task.id})`, { status: response.status, durationMs: response.durationMs });
    addCheck("阻塞任务处理成功", response.status === 200, JSON.stringify(response.body).slice(0, 300));
  }
}

async function handleRequiredActions(project, actions) {
  const current = project;
  const requiredActions = Array.isArray(actions) ? actions : [];
  addStep("required_actions", {
    status: 409,
    actions: formatRequiredActions(requiredActions),
    project: summarizeProject(current),
  });

  if (requiredActions.some((item) => item.action === "reconcile_deliverables")) {
    return reconcileDeliverables(project.id, "required_action");
  }
  if (requiredActions.some((item) => item.action === "open_design_review")) {
    return submitDesignReview(project);
  }
  if (requiredActions.some((item) => item.action === "resolve_blocked_tasks")) {
    await resolveBlockedTasks(project);
    return getProjectDetail(project.id, "detail_after_resolve_blocked");
  }
  if (requiredActions.some((item) => item.action === "review_pending_stage")) {
    return approveProject(project.id, "required_action");
  }
  if (requiredActions.some((item) => item.action === "submit_stage_deliverable")) {
    throw new Error("REQUIRES_MANUAL_SUBMISSION: 当前自动流程不应停在 submit_stage_deliverable。");
  }
  if (requiredActions.some((item) => item.action === "refresh_runtime")) {
    throw new Error("RUNTIME_NOT_READY: 模型运行时配置缺失。");
  }

  throw new Error(`UNHANDLED_REQUIRED_ACTIONS: ${formatRequiredActions(requiredActions)}`);
}

async function main() {
  let createdProjectId = "";

  try {
    const list = await req("GET", "/api/projects");
    addStep("project_list", {
      status: list.status,
      durationMs: list.durationMs,
      count: Array.isArray(list.unwrapped) ? list.unwrapped.length : -1,
    });
    addCheck("项目列表接口可用", list.status === 200, JSON.stringify(list.body).slice(0, 300));
    addCheck("项目列表返回数组", Array.isArray(list.unwrapped), `type=${typeof list.unwrapped}`);

    const requirementText = "帮我搭建一个跨境电商爆品选品跟品机器人，支持爆款监测、排名追踪、链接输出和验收回填。";
    const parse = await req("POST", "/api/projects/parse", { input: requirementText });
    addStep("project_parse", { status: parse.status, durationMs: parse.durationMs });
    addCheck("需求解析成功", parse.status === 200, JSON.stringify(parse.body).slice(0, 300));

    const preview = await req("POST", "/api/projects/preview", { description: requirementText });
    addStep("project_preview", { status: preview.status, durationMs: preview.durationMs });
    addCheck("需求预览成功", preview.status === 200, JSON.stringify(preview.body).slice(0, 300));

    const create = await req("POST", "/api/projects", {
      name: `lifecycle-audit-${Date.now()}`,
      description: requirementText,
      team: ["ROLE_PM", "ROLE_ANALYST", "ROLE_DESIGN", "ROLE_DEV", "ROLE_QA"],
    });
    addStep("project_create", { status: create.status, durationMs: create.durationMs, project: summarizeProject(create.unwrapped) });
    addCheck("项目创建成功", create.status === 201, JSON.stringify(create.body).slice(0, 500));
    createdProjectId = String(create.unwrapped?.id || "");
    report.projectId = createdProjectId;
    addCheck("项目ID存在", Boolean(createdProjectId), JSON.stringify(create.body).slice(0, 200));

    let project = await getProjectDetail(createdProjectId, "detail_after_create");
    addCheck("创建后进入分析阶段", project.currentStage === "ANALYSIS", `currentStage=${project.currentStage}`);
    assertNoFutureStageDeliverables(project, "创建后");
    assertStageTaskHints(project, "ANALYSIS", "分析阶段");

    let lastStage = project.currentStage;
    let inProgressRetries = 0;
    for (let round = 1; round <= MAX_ROUNDS; round += 1) {
      project = await getProjectDetail(createdProjectId, `detail_round_${round}_before`);
      assertNoFutureStageDeliverables(project, `round${round}`);

      if (!stageReached.has(project.currentStage)) {
        stageReached.add(project.currentStage);
        if (project.currentStage === "ANALYSIS") {
          assertStageTaskHints(project, "ANALYSIS", "需求分析");
        }
        if (project.currentStage === "DESIGN") {
          assertStageTaskHints(project, "DESIGN", "需求拆解/设计");
        }
        if (project.currentStage === "DEV") {
          assertStageTaskHints(project, "DEV", "研发任务分配");
        }
        if (project.currentStage === "ACCEPT") {
          assertStageTaskHints(project, "ACCEPT", "验收任务");
        }
      }

      if (project.status === "completed") {
        break;
      }

      if (project.pendingApproval) {
        project = await approveProject(createdProjectId, `pending_round_${round}`);
      } else {
        const advance = await req("POST", `/api/projects/${encodeURIComponent(createdProjectId)}/advance`, {}, {
          timeoutMs: REQUEST_TIMEOUT_MS,
        });
        addStep(`advance_round_${round}`, {
          status: advance.status,
          durationMs: advance.durationMs,
          project: summarizeProject(advance.unwrapped),
          code: advance.body?.error?.code,
          pollAfterMs: advance.body?.error?.pollAfterMs
        });

        if (advance.status === 200) {
          inProgressRetries = 0;
          project = advance.unwrapped;
        } else if (advance.status === 409 && advance.body?.error?.code === "REQUIRES_USER_INTERVENTION") {
          inProgressRetries = 0;
          project = await handleRequiredActions(project, advance.body?.error?.requiredActions);
        } else if (advance.status === 409 && advance.body?.error?.code === "PROJECT_ADVANCE_IN_PROGRESS") {
          inProgressRetries += 1;
          if (inProgressRetries % 10 === 0) {
            addWarning(`推进任务仍在执行（已等待 ${inProgressRetries} 轮）。`);
          }
          const pollAfter = Number(advance.body?.error?.pollAfterMs ?? 1200);
          await wait(Math.max(600, Math.min(5000, pollAfter)));
          continue;
        } else {
          throw new Error(`ADVANCE_FAILED: status=${advance.status} body=${JSON.stringify(advance.body).slice(0, 500)}`);
        }
      }

      if (project.currentStage !== lastStage) {
        addStep("stage_transition", {
          from: lastStage,
          to: project.currentStage,
          project: summarizeProject(project),
        });
        lastStage = project.currentStage;
      }
    }

    project = await getProjectDetail(createdProjectId, "detail_final");
    addCheck("项目流程可推进到完成", project.status === "completed", `status=${project.status}, stage=${project.currentStage}`);
    addCheck("最终阶段为验收", project.currentStage === "ACCEPT", `stage=${project.currentStage}`);

    const finalArtifacts = await req("GET", `/api/projects/${encodeURIComponent(createdProjectId)}/final-artifacts`);
    addStep("final_artifacts", {
      status: finalArtifacts.status,
      durationMs: finalArtifacts.durationMs,
      summary: finalArtifacts.unwrapped
        ? {
            readyForAcceptance: finalArtifacts.unwrapped.readyForAcceptance,
            missingRequired: finalArtifacts.unwrapped.missingRequired,
            coverage: finalArtifacts.unwrapped.coverage,
          }
        : null,
    });
    addCheck("最终交付接口可用", finalArtifacts.status === 200, JSON.stringify(finalArtifacts.body).slice(0, 500));
    if (finalArtifacts.unwrapped?.readyForAcceptance !== true) {
      addWarning(`最终交付未完全就绪: ${JSON.stringify(finalArtifacts.unwrapped?.missingRequired || [])}`);
    }

    const officialSite = await req("GET", `/api/projects/${encodeURIComponent(createdProjectId)}/official-site`, {}, {
      timeoutMs: 240000,
    });
    addStep("official_site", {
      status: officialSite.status,
      durationMs: officialSite.durationMs,
      url: officialSite.unwrapped?.url,
    });
    addCheck("官网产物接口可用", officialSite.status === 200, JSON.stringify(officialSite.body).slice(0, 500));
  } finally {
    if (createdProjectId) {
      const deleted = await req("DELETE", `/api/projects/${encodeURIComponent(createdProjectId)}`);
      addStep("cleanup_project", { status: deleted.status, durationMs: deleted.durationMs, projectId: createdProjectId });
    }
  }
}

main()
  .then(() => {
    report.finishedAt = new Date().toISOString();
    report.totalChecks = report.checks.length;
    report.totalWarnings = report.warnings.length;
    console.log(JSON.stringify(report, null, 2));
  })
  .catch((error) => {
    report.ok = false;
    report.finishedAt = new Date().toISOString();
    report.error = error instanceof Error ? error.message : String(error);
    report.totalChecks = report.checks.length;
    report.totalWarnings = report.warnings.length;
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  });
