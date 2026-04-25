import { z } from "zod";

export const MutationPassthroughSchema = z.object({}).passthrough();
export const MutationOptionalSchema = z.object({}).passthrough().optional().transform((value) => value ?? {});

export const ProjectCreateSchema = z.object({
  name: z.string().trim().min(1, "项目名称不能为空").max(200).optional(),
  description: z.string({ error: "description is required" }).trim().min(1, "description is required").max(5000),
  projectType: z.enum(["complete", "relay"]).default("complete"),
  parentProjectId: z.string().trim().min(1).optional(),
  relaySourceStageId: z.string().trim().min(1).optional(),
  projectInputs: z.array(z.unknown()).optional(),
  workflowTemplateKey: z.string().trim().min(1).optional(),
  autoStartWorkflow: z.boolean().optional()
});

export const KnowledgeCreateSchema = z.object({
  title: z.string().trim().min(1, "标题不能为空").max(500),
  content: z.string().trim().min(1, "内容不能为空").max(50000),
  scope: z.enum(["global", "project", "agent"]).default("project"),
  projectId: z.string().trim().optional(),
  agentId: z.string().trim().optional(),
  tags: z.array(z.string().trim()).default([]),
  importanceScore: z.coerce.number().min(0).max(1).optional(),
  triggeredBy: z.string().trim().optional()
});

export const ProjectParseRequestSchema = z.object({
  input: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional()
});

export const ProjectPreviewRequestSchema = z.object({
  description: z.string().trim().min(1, "description is required")
});

export const ProjectCleanupRequestSchema = z.object({
  ids: z.array(z.string().trim().min(1)).optional(),
  mode: z.enum(["recommended", "all_candidates"]).default("recommended"),
  dryRun: z.boolean().optional()
});

export const ProjectAutomationUpdateSchema = z.object({
  enabled: z.boolean(),
  autoApproveWhenReady: z.boolean().optional(),
  intervalMs: z.coerce.number().int().positive().optional()
});

export const ProjectPostCreatePrepSchema = z.object({
  discussion: z.string().optional(),
  analysis: z.string().optional(),
  rawRequirements: z.string().optional(),
  prd: z.string().optional(),
  debateSummary: z.string().optional(),
  discussionTrace: z.string().optional()
});

export const ProjectPostCreatePrepConfirmSchema = ProjectPostCreatePrepSchema.extend({
  confirmedBy: z.string().optional(),
  notes: z.string().optional()
});

export const ProjectRejectSchema = z.object({
  reason: z.string({ error: "reason is required" }).trim().min(1, "reason is required")
});

export const ProjectInterveneSchema = z.object({
  command: z.string({ error: "command is required" }).trim().min(1, "command is required")
});

export const ProjectStageSubmitSchema = z.object({
  title: z.string().optional(),
  content: z.string().trim().min(1, "content is required"),
  designReview: z.unknown().optional(),
  finalizeApproval: z.boolean().optional()
});

export const ProjectMessageSchema = z.object({
  message: z.string().trim().min(1, "message is required")
});

export const TaskStatusUpdateSchema = z.object({
  status: z.string().trim().min(1, "status is required")
});

export const TaskAssignSchema = z.object({
  ownerAgentId: z.string().trim().min(1, "ownerAgentId is required")
});

export const TaskReviewerSchema = z.object({
  reviewAgentId: z.string().optional().default("")
});

export const TaskCoordinationModeSchema = z.object({
  coordinationMode: z.string().trim().min(1, "coordinationMode is required"),
  delegationPolicy: z.string().optional(),
  syncPolicy: z.string().optional(),
  contextScope: z.string().optional()
});

export const TaskDelegationCreateSchema = z.object({
  requestedByAgentId: z.string().trim().min(1, "requestedByAgentId is required"),
  goal: z.string().trim().min(1, "goal is required"),
  title: z.string().optional(),
  targetAgentId: z.string().optional(),
  mode: z.string().optional(),
  inputContextRef: z.string().optional(),
  inputSummary: z.string().optional(),
  resultSchema: z.string().optional(),
  budgetTokens: z.coerce.number().int().positive().optional(),
  timeoutSec: z.coerce.number().int().positive().optional(),
  spawnDepth: z.coerce.number().int().min(0).optional(),
  maxRetries: z.coerce.number().int().min(0).optional()
});

export const DelegationCompleteSchema = z.object({
  outputSummary: z.string().trim().min(1, "outputSummary is required"),
  outputPayloadJson: z.unknown().optional(),
  outputArtifactsJson: z.unknown().optional()
});

export const DelegationReasonSchema = z.object({
  reason: z.string().trim().min(1, "reason is required")
});

export const DelegationExpireSchema = z.object({
  reason: z.string().optional()
});

export const RuntimeConfigUpdateSchema = z.object({
  provider: z.enum(["scripted", "openai-compatible"]),
  apiBaseUrl: z.string().optional(),
  modelName: z.string().optional(),
  apiKey: z.string().optional(),
  clearApiKey: z.boolean().optional()
});

export const ExecutionProtocolUpdateSchema = z.object({
  requireSkillEvidence: z.boolean().optional(),
  requireCollaborationHandoff: z.boolean().optional(),
  blockDegradedWrites: z.boolean().optional()
});

export const UiPreferencesUpdateSchema = z.object({
  language: z.enum(["zh", "en"]).optional(),
  workspacePath: z.string().optional(),
  autoSync: z.boolean().optional(),
  apiProtection: z.boolean().optional(),
  autonomousMode: z.boolean().optional(),
  usageAlert: z.boolean().optional(),
  usageAlertThresholdPercent: z.coerce.number().min(1).max(100).optional()
});

export const UiAutonomousModeApplySchema = z.object({
  autonomousMode: z.boolean().optional(),
  scope: z.enum(["all", "core", "design"]).optional()
});

export const ModelRoutingSelfHealSchema = z.object({
  apply: z.boolean().optional()
});

export const ContextHygieneCleanupSchema = z.object({
  apply: z.boolean().optional(),
  maxDelete: z.coerce.number().int().positive().optional()
});
