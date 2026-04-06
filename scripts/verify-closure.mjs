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

let API_BASE_URL = process.env.OCC_BASE_URL || "";
let OPENCLAW_BIN = process.env.OPENCLAW_BIN || "";
const OPENCLAW_DEFAULT_BIN = "/Users/dalongxia/.nvm/versions/node/v24.14.0/bin/openclaw";
const REQUEST_TIMEOUT_MS = Math.max(30_000, Number(process.env.REQUEST_TIMEOUT_MS || 120_000));
const WAIT = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const state = {
  sessionToken: "",
  createdProjectId: null,
  createdAgentId: null,
  createdMemoryIds: [],
  originalRuntimeSettings: null,
  originalAgentSettings: null,
  originalSoulContent: null,
  originalSopContent: null,
  patchedOpenClawProjectId: null,
  patchedOpenClawTaskId: null,
  patchedOpenClawTaskOriginal: null
};

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
    "",
    "## 验收标准与衡量指标",
    "- 创建项目后 1 分钟内可看到当前阶段负责人、任务列表和时间轴。",
    "- 阶段提交时，审批稿必须包含完整章节、边界说明和可验证验收标准。",
    "- 驳回后允许补充内容再次提交，通过后阶段应向下一阶段推进。",
    "",
    "## 风险、依赖与假设",
    "- 风险：模型调用失败会导致阶段结论延迟生成，需要恢复机制和可见提示。",
    "- 依赖：API 健康、鉴权会话、项目仓储与交付物模板校验需保持可用。",
    "- 假设：当前验收以本地环境为主，外部通道异常时允许脚本化回退验证。",
    "",
    "## 任务拆解与优先级",
    "- P0：打通创建项目、阶段推进、阶段审批三条核心路径。",
    "- P0：保证阶段提交文档符合模板且可以被审批和回溯。",
    "- P1：补齐自动恢复、验收报告、产品说明回填和异常提示。",
    "",
    "## 验收检查清单",
    "- 需求目标、用户场景、功能清单可形成闭环。",
    "- 验收标准可量化且可验证。",
    "- 风险与依赖项包含处理策略与责任人。",
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

async function approveProjectWithRecovery(projectId) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const approve = await request(`/api/projects/${projectId}/approve`, {
      method: "POST"
    });

    if (approve.ok && approve.json?.currentStage !== "ANALYSIS") {
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

    if (approve.status === 409 && code === "NO_PENDING_APPROVAL") {
      const detail = await request(`/api/projects/${projectId}`);
      if (detail.ok && detail.json?.currentStage !== "ANALYSIS") {
        return {
          ...approve,
          ok: true,
          json: detail.json
        };
      }
    }

    throw new Error(`stage approve failed: ${formatResponseForError(approve)}`);
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

async function resolveApiBaseUrl() {
  if (API_BASE_URL) {
    return API_BASE_URL;
  }

  const candidates = [
    "http://127.0.0.1:8787",
    "http://127.0.0.1:8794",
    "http://localhost:8787",
    "http://localhost:8794"
  ];

  for (const candidate of candidates) {
    try {
      const response = await fetch(
        state.sessionToken ? `${candidate}/api/system/runtime` : `${candidate}/health`,
        state.sessionToken
          ? {
              headers: {
                Cookie: `occ_session=${state.sessionToken}`
              }
            }
          : undefined
      );
      if (response.ok) {
        return candidate;
      }
    } catch {
      // try the next candidate
    }
  }

  return "http://localhost:8787";
}

async function request(pathname, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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

    return {
      status: response.status,
      ok: response.ok,
      json
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`request failed: ${pathname} (${reason})`);
  } finally {
    clearTimeout(timer);
  }
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

  const created = await request("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      description: "闭环验收项目：验证创建、消息、介入、恢复、提交、驳回、再提交、审批与任务状态变更。",
      name: "Closure Acceptance Project"
    })
  });
  assert(created.ok, "project create failed");
  assert(typeof created.json?.id === "string", "project create missing id");
  state.createdProjectId = created.json.id;
  results.projectCreate = created.json.id;

  const detail = await request(`/api/projects/${state.createdProjectId}`);
  assert(detail.ok, "project detail failed");
  assert(detail.json?.name === "Closure Acceptance Project", "project detail returned unexpected name");
  results.projectDetail = "ok";

  const tasks = await request(`/api/projects/${state.createdProjectId}/tasks`);
  assert(tasks.ok, "project tasks failed");
  assert(Array.isArray(tasks.json) && tasks.json.length > 0, "project tasks empty");
  const firstTaskId = tasks.json[0].id;
  results.projectTasks = tasks.json.length;

  const guidance = await request(`/api/projects/${state.createdProjectId}/messages`, {
    method: "POST",
    body: JSON.stringify({ message: "请继续推进，并写清楚当前阶段边界。" })
  });
  assert(guidance.ok, "project guidance failed");
  results.projectMessage = "ok";

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

  const submit = await request(`/api/projects/${state.createdProjectId}/stages/submit`, {
    method: "POST",
    body: JSON.stringify({
      title: "需求分析 / PRD",
      content: buildAnalysisSubmissionContent("v1")
    })
  });
  assert(submit.ok && submit.json?.pendingApproval === true, "stage submit failed");
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
      title: "需求分析 / PRD v2",
      content: `${buildAnalysisSubmissionContent("v2")}\n\n## 补充说明\n- 已根据驳回意见补充边界、验收标准与优先级说明。`
    })
  });
  assert(resubmit.ok && resubmit.json?.pendingApproval === true, "stage resubmit failed");
  results.projectResubmit = "ok";

  const approve = await approveProjectWithRecovery(state.createdProjectId);
  results.projectApprove = approve.json.currentStage;

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

  const message = await request(`/api/openclaw/agents/${targetAgentId}/message`, {
    method: "POST",
    body: JSON.stringify({ message: "请简要汇报你当前任务与下一步。" })
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

  const batch = await request("/api/openclaw/agents/batch-message", {
    method: "POST",
    body: JSON.stringify({
      agentIds: [targetAgentId],
      message: "请同步一条当前状态。"
    })
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

  await prisma.$disconnect();
}

async function main() {
  const results = {};
  const startedAt = Date.now();
  OPENCLAW_BIN = resolveOpenClawBinary();
  process.env.OPENCLAW_BIN = OPENCLAW_BIN;
  results.openclawBin = OPENCLAW_BIN;

  await createSession();
  API_BASE_URL = await resolveApiBaseUrl();
  results.apiBaseUrl = API_BASE_URL;

  try {
    const auth = await request("/api/auth/status");
    assert(auth.ok && auth.json?.setupComplete, "auth status failed");
    results.auth = "ok";

    await verifyOpenClawEndpoints(results);
    await verifyProjectFlow(results);
    await verifyRuntimeFlow(results);
    await verifyOpenClawFlow(results);

    const finishedAt = Date.now();
    console.log(JSON.stringify({
      ok: true,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs: finishedAt - startedAt,
      results
    }, null, 2));
  } finally {
    await cleanup();
  }
}

await main();
