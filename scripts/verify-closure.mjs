import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../apps/api/dist/db.js";
import { generateSessionToken, hashSessionToken } from "../apps/api/dist/security/secret-store.js";
import {
  OPENCLAW_CONFIG_PATH,
  OPENCLAW_WORKSPACE_ROOT
} from "../apps/api/dist/openclaw/paths.js";

const API_BASE_URL = process.env.OCC_BASE_URL || "http://localhost:8787";

const state = {
  sessionToken: "",
  createdProjectId: null,
  createdAgentId: null,
  createdMemoryIds: [],
  originalAgentSettings: null,
  originalSoulContent: null,
  originalSopContent: null,
  patchedOpenClawProjectId: null,
  patchedOpenClawTaskId: null,
  patchedOpenClawTaskOriginal: null
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function request(pathname, init = {}) {
  const response = await fetch(`${API_BASE_URL}${pathname}`, {
    ...init,
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
}

async function createSession() {
  state.sessionToken = generateSessionToken();
  await prisma.authSession.create({
    data: {
      tokenHash: hashSessionToken(state.sessionToken),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000)
    }
  });
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
      title: "阶段交付物",
      content: "# 阶段提交\n\n- 已完成当前分析\n- 请求进入审批"
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
      title: "阶段交付物 v2",
      content: "# 阶段提交 v2\n\n- 已补充边界\n- 已补充验收标准\n- 请求再次审批"
    })
  });
  assert(resubmit.ok && resubmit.json?.pendingApproval === true, "stage resubmit failed");
  results.projectResubmit = "ok";

  const approve = await request(`/api/projects/${state.createdProjectId}/approve`, {
    method: "POST"
  });
  assert(approve.ok && approve.json?.currentStage !== "ANALYSIS", "stage approve did not advance");
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
}

async function verifyOpenClawFlow(results) {
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

  const preview = await request(`/api/openclaw/agents/${targetAgentId}/preview`, {
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
    method: "PUT",
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
  const soulSave = await request(`/api/openclaw/agents/${targetAgentId}/soul`, {
    method: "PUT",
    body: JSON.stringify({ content: updatedSoul, createIfMissing: true })
  });
  assert(soulSave.ok, "openclaw soul save failed");
  results.openclawSoul = "ok";

  const updatedSop = `${state.originalSopContent.trimEnd()}\n\n<!-- closure-check -->\n`;
  const sopSave = await request(`/api/openclaw/agents/${targetAgentId}/sop`, {
    method: "PUT",
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
  assert(message.ok, "openclaw agent message failed");
  assert(typeof message.json?.summary === "string", "openclaw agent message missing summary");
  results.openclawMessage = message.json.summary;

  const batch = await request("/api/openclaw/agents/batch-message", {
    method: "POST",
    body: JSON.stringify({
      agentIds: [targetAgentId],
      message: "请同步一条当前状态。"
    })
  });
  assert(batch.ok, "openclaw batch message failed");
  assert(batch.json?.completedCount >= 1, "openclaw batch message returned no completed calls");
  results.openclawBatchMessage = batch.json.completedCount;

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

  const sla = await request("/api/openclaw/sla");
  assert(sla.ok && Array.isArray(sla.json), "openclaw sla failed");
  results.openclawSla = sla.json.length;
}

async function cleanup() {
  try {
    if (state.originalAgentSettings && state.createdAgentId === null) {
      const agentId = state.originalAgentSettings.agentId;
      if (agentId) {
        await request(`/api/openclaw/agents/${agentId}/settings`, {
          method: "PUT",
          body: JSON.stringify(state.originalAgentSettings)
        });
      }
    }
  } catch {}

  try {
    if (state.originalSoulContent !== null && state.originalAgentSettings?.agentId) {
      await request(`/api/openclaw/agents/${state.originalAgentSettings.agentId}/soul`, {
        method: "PUT",
        body: JSON.stringify({ content: state.originalSoulContent, createIfMissing: true })
      });
    }
  } catch {}

  try {
    if (state.originalSopContent !== null && state.originalAgentSettings?.agentId) {
      await request(`/api/openclaw/agents/${state.originalAgentSettings.agentId}/sop`, {
        method: "PUT",
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
        where: { tokenHash: hashSessionToken(state.sessionToken) }
      });
    } catch {}
  }

  await prisma.$disconnect();
}

async function main() {
  const results = {};
  await createSession();

  try {
    const auth = await request("/api/auth/status");
    assert(auth.ok && auth.json?.setupComplete, "auth status failed");
    results.auth = "ok";

    await verifyProjectFlow(results);
    await verifyRuntimeFlow(results);
    await verifyOpenClawFlow(results);

    console.log(JSON.stringify({ ok: true, results }, null, 2));
  } finally {
    await cleanup();
  }
}

await main();
