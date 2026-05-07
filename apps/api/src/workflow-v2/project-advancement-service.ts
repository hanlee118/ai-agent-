import { prisma } from "../db.js";
import { getActiveWorkflow, transitionWorkflowStage, type WorkflowTransitionResult } from "./workflow-orchestrator.js";

function normalizeReason(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function resolveCurrentStageId(projectId: string) {
  const workflow = await getActiveWorkflow(projectId);
  const currentStageIds = Array.isArray(workflow.currentStageIds) ? workflow.currentStageIds : [];
  const currentStageId = String(currentStageIds[0] || "").trim();
  if (!currentStageId) {
    throw new Error("WORKFLOW_V2_ACTIVE_WITHOUT_CURRENT_STAGE");
  }
  return { workflowId: workflow.id, currentStageId };
}

export async function advanceProjectStageViaWorkflowV2(input: {
  projectId: string;
  triggeredBy: string;
  reason?: string;
}): Promise<WorkflowTransitionResult> {
  const resolved = await resolveCurrentStageId(input.projectId);
  return transitionWorkflowStage({
    workflowId: resolved.workflowId,
    stageId: resolved.currentStageId,
    action: "proceed",
    triggeredBy: input.triggeredBy,
    reason: normalizeReason(input.reason) || "advance_via_workflow_v2"
  });
}

export async function skipProjectStageViaWorkflowV2(input: {
  projectId: string;
  triggeredBy: string;
  reason?: string;
}) {
  const resolved = await resolveCurrentStageId(input.projectId);
  const reason = normalizeReason(input.reason) || "manual_external_service_degrade_skip";
  const transition = await transitionWorkflowStage({
    workflowId: resolved.workflowId,
    stageId: resolved.currentStageId,
    action: "skip",
    triggeredBy: input.triggeredBy,
    reason
  });

  await prisma.timelineEvent.create({
    data: {
      projectId: input.projectId,
      timestamp: new Date(),
      agentId: input.triggeredBy || "ROLE_PM",
      type: "STAGE_SKIPPED_MANUALLY",
      title: "阶段已手动跳过",
      content: `管理员执行手动降级跳过，原因：${reason}`,
      priority: "high"
    }
  });

  return transition;
}

