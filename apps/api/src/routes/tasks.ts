import express from "express";
import type { CoordinationMode } from "@occ/shared";
import { asyncRoute, sendError, sendSuccess } from "./utils.js";
import {
  assignOwner,
  getTaskById,
  listTaskParticipants,
  markReadyForReview,
  setCoordinationMode,
  setReviewer,
  updateTaskPolicies
} from "../services/task-coordination.js";
import { buildTaskExecutionContext } from "../services/context-packing.js";
import {
  cancelDelegation,
  completeDelegation,
  createDelegation,
  dispatchDelegation,
  expireDelegation,
  failDelegation,
  listTaskDelegations,
  retryDelegation
} from "../services/task-delegation.js";
import { ensureTaskIssue } from "../services/gitlab-sync-policy.js";

interface CreateTasksRouterOptions {
  safeAudit: (
    req: express.Request,
    res: express.Response,
    input: {
      actorType: "admin" | "system";
      actorLabel: string;
      action: string;
      resourceType: string;
      resourceId?: string;
      summary: string;
      detail?: string;
    }
  ) => Promise<void>;
}

export function createTasksRouter(options: CreateTasksRouterOptions) {
  const { safeAudit } = options;
  const router = express.Router();

  function sendDependencyBlocked(res: express.Response, message: string) {
    res.status(409).json({
      success: false,
      error: {
        code: "TASK_BLOCKED_BY_DEPENDENCIES",
        message: "当前任务仍受 blocks 依赖限制，需先完成依赖任务后再推进。",
        dependsOnTaskId: message.replace("TASK_BLOCKED_BY_DEPENDENCIES:", "").trim() || undefined
      }
    });
  }

  router.post("/api/tasks/:taskId/assign", asyncRoute(async (req, res) => {
    const taskId = String(req.params.taskId || "").trim();
    const ownerAgentId = String((req.body as Record<string, unknown>)?.ownerAgentId ?? "").trim();
    if (!taskId || !ownerAgentId) {
      sendError(res, 400, "VALIDATION_ERROR", "taskId and ownerAgentId are required");
      return;
    }

    const task = await assignOwner(taskId, ownerAgentId);
    await safeAudit(req, res, {
      actorType: "admin",
      actorLabel: "管理员",
      action: "task.owner_assigned",
      resourceType: "task",
      resourceId: task.id,
      summary: `任务 ${task.id} owner 已指派为 ${ownerAgentId}`
    });
    sendSuccess(res, task);
  }));

  router.post("/api/tasks/:taskId/reviewer", asyncRoute(async (req, res) => {
    const taskId = String(req.params.taskId || "").trim();
    const reviewerAgentIdRaw = (req.body as Record<string, unknown>)?.reviewAgentId;
    const reviewerAgentId = typeof reviewerAgentIdRaw === "string" ? reviewerAgentIdRaw.trim() : "";
    if (!taskId) {
      sendError(res, 400, "VALIDATION_ERROR", "taskId is required");
      return;
    }

    const task = await setReviewer(taskId, reviewerAgentId);
    await safeAudit(req, res, {
      actorType: "admin",
      actorLabel: "管理员",
      action: "task.reviewer_assigned",
      resourceType: "task",
      resourceId: task.id,
      summary: reviewerAgentId
        ? `任务 ${task.id} reviewer 已设置为 ${reviewerAgentId}`
        : `任务 ${task.id} reviewer 已清空`
    });
    sendSuccess(res, task);
  }));

  router.post("/api/tasks/:taskId/coordination-mode", asyncRoute(async (req, res) => {
    const taskId = String(req.params.taskId || "").trim();
    const coordinationMode = String((req.body as Record<string, unknown>)?.coordinationMode ?? "").trim() as CoordinationMode;
    if (!taskId || !coordinationMode) {
      sendError(res, 400, "VALIDATION_ERROR", "taskId and coordinationMode are required");
      return;
    }

    const task = await setCoordinationMode(taskId, coordinationMode);
    const taskPolicies = await updateTaskPolicies(taskId, {
      delegationPolicy: typeof (req.body as Record<string, unknown>)?.delegationPolicy === "string"
        ? String((req.body as Record<string, unknown>).delegationPolicy) as any
        : undefined,
      syncPolicy: typeof (req.body as Record<string, unknown>)?.syncPolicy === "string"
        ? String((req.body as Record<string, unknown>).syncPolicy) as any
        : undefined,
      contextScope: typeof (req.body as Record<string, unknown>)?.contextScope === "string"
        ? String((req.body as Record<string, unknown>).contextScope) as any
        : undefined
    }).catch(() => task);
    await safeAudit(req, res, {
      actorType: "admin",
      actorLabel: "管理员",
      action: "task.coordination_mode_updated",
      resourceType: "task",
      resourceId: task.id,
      summary: `任务 ${task.id} coordination mode 已更新为 ${coordinationMode}`
    });
    sendSuccess(res, taskPolicies);
  }));

  router.get("/api/tasks/:taskId/context", asyncRoute(async (req, res) => {
    const taskId = String(req.params.taskId || "").trim();
    if (!taskId) {
      sendError(res, 400, "VALIDATION_ERROR", "taskId is required");
      return;
    }
    const context = await buildTaskExecutionContext(taskId);
    sendSuccess(res, context);
  }));

  router.get("/api/tasks/:taskId/delegations", asyncRoute(async (req, res) => {
    const taskId = String(req.params.taskId || "").trim();
    if (!taskId) {
      sendError(res, 400, "VALIDATION_ERROR", "taskId is required");
      return;
    }
    const [task, delegations, participants] = await Promise.all([
      getTaskById(taskId),
      listTaskDelegations(taskId),
      listTaskParticipants(taskId)
    ]);
    if (!task) {
      sendError(res, 404, "NOT_FOUND", "Task not found");
      return;
    }
    sendSuccess(res, {
      task,
      participants,
      delegations
    });
  }));

  router.post("/api/tasks/:taskId/delegations", asyncRoute(async (req, res) => {
    const taskId = String(req.params.taskId || "").trim();
    const body = (req.body || {}) as Record<string, unknown>;
    const requestedByAgentId = String(body.requestedByAgentId ?? "").trim();
    const goal = String(body.goal ?? "").trim();
    if (!taskId || !requestedByAgentId || !goal) {
      sendError(res, 400, "VALIDATION_ERROR", "taskId, requestedByAgentId and goal are required");
      return;
    }

    let delegation;
    try {
      delegation = await createDelegation(taskId, requestedByAgentId, {
        title: typeof body.title === "string" ? body.title : undefined,
        goal,
        targetAgentId: typeof body.targetAgentId === "string" ? body.targetAgentId : undefined,
        mode: typeof body.mode === "string" ? body.mode as any : undefined,
        inputContextRef: typeof body.inputContextRef === "string" ? body.inputContextRef : undefined,
        inputSummary: typeof body.inputSummary === "string" ? body.inputSummary : undefined,
        resultSchema: typeof body.resultSchema === "string" ? body.resultSchema : undefined,
        budgetTokens: typeof body.budgetTokens === "number" ? body.budgetTokens : undefined,
        timeoutSec: typeof body.timeoutSec === "number" ? body.timeoutSec : undefined,
        spawnDepth: typeof body.spawnDepth === "number" ? body.spawnDepth : undefined,
        maxRetries: typeof body.maxRetries === "number" ? body.maxRetries : undefined
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "delegation create failed";
      if (message.startsWith("TASK_BLOCKED_BY_DEPENDENCIES:")) {
        sendDependencyBlocked(res, message);
        return;
      }
      throw error;
    }
    await safeAudit(req, res, {
      actorType: "admin",
      actorLabel: "管理员",
      action: "task.delegation_created",
      resourceType: "task_delegation",
      resourceId: delegation.id,
      summary: `任务 ${taskId} 已创建 delegation ${delegation.id}`
    });
    sendSuccess(res, delegation, 201);
  }));

  router.post("/api/delegations/:delegationId/dispatch", asyncRoute(async (req, res) => {
    const delegationId = String(req.params.delegationId || "").trim();
    if (!delegationId) {
      sendError(res, 400, "VALIDATION_ERROR", "delegationId is required");
      return;
    }
    let delegation;
    try {
      delegation = await dispatchDelegation(delegationId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "delegation dispatch failed";
      if (message.startsWith("TASK_BLOCKED_BY_DEPENDENCIES:")) {
        sendDependencyBlocked(res, message);
        return;
      }
      throw error;
    }
    await safeAudit(req, res, {
      actorType: "admin",
      actorLabel: "管理员",
      action: "task.delegation_dispatched",
      resourceType: "task_delegation",
      resourceId: delegation.id,
      summary: `delegation ${delegation.id} 已 dispatch`
    });
    sendSuccess(res, delegation);
  }));

  router.post("/api/delegations/:delegationId/complete", asyncRoute(async (req, res) => {
    const delegationId = String(req.params.delegationId || "").trim();
    const outputSummary = String((req.body as Record<string, unknown>)?.outputSummary ?? "").trim();
    if (!delegationId || !outputSummary) {
      sendError(res, 400, "VALIDATION_ERROR", "delegationId and outputSummary are required");
      return;
    }
    const delegation = await completeDelegation(delegationId, {
      outputSummary,
      outputPayloadJson: (req.body as Record<string, unknown>)?.outputPayloadJson as any,
      outputArtifactsJson: (req.body as Record<string, unknown>)?.outputArtifactsJson as any
    });
    await safeAudit(req, res, {
      actorType: "admin",
      actorLabel: "管理员",
      action: "task.delegation_completed",
      resourceType: "task_delegation",
      resourceId: delegation.id,
      summary: `delegation ${delegation.id} 已完成`
    });
    sendSuccess(res, delegation);
  }));

  router.post("/api/delegations/:delegationId/fail", asyncRoute(async (req, res) => {
    const delegationId = String(req.params.delegationId || "").trim();
    const reason = String((req.body as Record<string, unknown>)?.reason ?? "").trim();
    if (!delegationId || !reason) {
      sendError(res, 400, "VALIDATION_ERROR", "delegationId and reason are required");
      return;
    }
    const delegation = await failDelegation(delegationId, reason);
    await safeAudit(req, res, {
      actorType: "admin",
      actorLabel: "管理员",
      action: "task.delegation_failed",
      resourceType: "task_delegation",
      resourceId: delegation.id,
      summary: `delegation ${delegation.id} 已失败`,
      detail: reason
    });
    sendSuccess(res, delegation);
  }));

  router.post("/api/delegations/:delegationId/expire", asyncRoute(async (req, res) => {
    const delegationId = String(req.params.delegationId || "").trim();
    if (!delegationId) {
      sendError(res, 400, "VALIDATION_ERROR", "delegationId is required");
      return;
    }
    const reason = typeof (req.body as Record<string, unknown>)?.reason === "string"
      ? String((req.body as Record<string, unknown>).reason).trim()
      : "";
    const delegation = await expireDelegation(delegationId, reason || "delegation expired");
    await safeAudit(req, res, {
      actorType: "admin",
      actorLabel: "管理员",
      action: "task.delegation_expired",
      resourceType: "task_delegation",
      resourceId: delegation.id,
      summary: `delegation ${delegation.id} 已超时`,
      detail: reason || "delegation expired"
    });
    sendSuccess(res, delegation);
  }));

  router.post("/api/delegations/:delegationId/cancel", asyncRoute(async (req, res) => {
    const delegationId = String(req.params.delegationId || "").trim();
    const reason = String((req.body as Record<string, unknown>)?.reason ?? "").trim();
    if (!delegationId || !reason) {
      sendError(res, 400, "VALIDATION_ERROR", "delegationId and reason are required");
      return;
    }
    const delegation = await cancelDelegation(delegationId, reason);
    await safeAudit(req, res, {
      actorType: "admin",
      actorLabel: "管理员",
      action: "task.delegation_cancelled",
      resourceType: "task_delegation",
      resourceId: delegation.id,
      summary: `delegation ${delegation.id} 已取消`,
      detail: reason
    });
    sendSuccess(res, delegation);
  }));

  router.post("/api/delegations/:delegationId/retry", asyncRoute(async (req, res) => {
    const delegationId = String(req.params.delegationId || "").trim();
    if (!delegationId) {
      sendError(res, 400, "VALIDATION_ERROR", "delegationId is required");
      return;
    }
    const delegation = await retryDelegation(delegationId);
    await safeAudit(req, res, {
      actorType: "admin",
      actorLabel: "管理员",
      action: "task.delegation_retried",
      resourceType: "task_delegation",
      resourceId: delegation.id,
      summary: `delegation ${delegation.id} 已重新排队`
    });
    sendSuccess(res, delegation);
  }));

  router.post("/api/tasks/:taskId/sync/gitlab", asyncRoute(async (req, res) => {
    const taskId = String(req.params.taskId || "").trim();
    if (!taskId) {
      sendError(res, 400, "VALIDATION_ERROR", "taskId is required");
      return;
    }
    const result = await ensureTaskIssue(taskId);
    sendSuccess(res, result);
  }));

  router.post("/api/tasks/:taskId/ready-for-review", asyncRoute(async (req, res) => {
    const taskId = String(req.params.taskId || "").trim();
    if (!taskId) {
      sendError(res, 400, "VALIDATION_ERROR", "taskId is required");
      return;
    }
    let task;
    try {
      task = await markReadyForReview(taskId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "mark ready for review failed";
      if (message.startsWith("TASK_BLOCKED_BY_DEPENDENCIES:")) {
        sendDependencyBlocked(res, message);
        return;
      }
      throw error;
    }
    await safeAudit(req, res, {
      actorType: "admin",
      actorLabel: "管理员",
      action: "task.ready_for_review",
      resourceType: "task",
      resourceId: task.id,
      summary: `任务 ${task.id} 已进入待审阅`
    });
    sendSuccess(res, task);
  }));

  return router;
}
