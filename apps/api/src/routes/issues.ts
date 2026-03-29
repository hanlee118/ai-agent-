import type { RoleType } from "@occ/shared";
import express from "express";
import { getRuntimeStatus } from "../agents/runtime.js";
import { createProject } from "../data/repository.js";
import { getIndustryConfig, listIndustryConfigs } from "./role-sets.js";
import { asyncRoute, sendError, sendSuccess } from "./utils.js";
import {
  buildContextAlignment,
  buildDesignBlueprint,
  buildExpectedArtifacts,
  buildClarificationQuestions,
  buildIssueDiscussion,
  buildRelatedHistory,
  buildRequirementContract,
  buildRequirementRefinement,
  buildSuggestedAnswers,
  detectConflicts,
  inferIssueSummary,
  inferIssueTitle,
  recommendRoles
} from "../system/issue-engine.js";
import {
  appendRequirementBackfill,
  createIssueDraft,
  getIssue,
  getProductContext,
  listIssues,
  resolveRequirementMismatches,
  updateIssue,
  type IssueSourceType
} from "../system/v1-method-store.js";

interface PreviewIssueBody {
  input?: unknown;
  industryCode?: unknown;
  sourceType?: unknown;
}

interface ConfirmIssueBody {
  clarificationAnswers?: unknown;
  finalName?: unknown;
  finalDescription?: unknown;
  teamRoleIds?: unknown;
  conflictResolution?: unknown;
}

const ROLE_IDS: RoleType[] = [
  "ROLE_ASSISTANT",
  "ROLE_PM",
  "ROLE_ANALYST",
  "ROLE_PRODUCT",
  "ROLE_DESIGN",
  "ROLE_ARCH",
  "ROLE_DEV",
  "ROLE_QA",
  "ROLE_HR"
];

function normalizeSourceType(input: unknown): IssueSourceType {
  const value = String(input ?? "").trim().toLowerCase();
  if (value === "meeting_notes" || value === "journey" || value === "competitor") {
    return value;
  }
  return "text";
}

function normalizeRoleList(input: unknown) {
  if (!Array.isArray(input)) {
    return [] as RoleType[];
  }
  return input
    .map((item) => String(item ?? "").trim().toUpperCase())
    .filter((item): item is RoleType => ROLE_IDS.includes(item as RoleType));
}

function normalizeStringMap(input: unknown) {
  if (!input || typeof input !== "object") {
    return {} as Record<string, string>;
  }

  return Object.entries(input as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, value]) => {
    const k = String(key ?? "").trim();
    const v = String(value ?? "").trim();
    if (k && v) {
      acc[k] = v;
    }
    return acc;
  }, {});
}

interface CreateIssuesRouterOptions {
  onProjectCreated?: (projectId: string) => void;
}

export function createIssuesRouter(options: CreateIssuesRouterOptions = {}) {
  const router = express.Router();

  router.get("/", asyncRoute(async (req, res) => {
    const status = String(req.query.status ?? "").trim().toLowerCase();
    const data = await listIssues(
      status === "draft" || status === "confirmed" || status === "cancelled"
        ? status
        : undefined
    );
    sendSuccess(res, data);
  }));

  router.get("/:issueId", asyncRoute(async (req, res) => {
    const issueId = String(req.params.issueId ?? "").trim();
    const issue = await getIssue(issueId);
    if (!issue) {
      sendError(res, 404, "NOT_FOUND", `Issue not found: ${issueId}`);
      return;
    }
    sendSuccess(res, issue);
  }));

  router.post("/preview", asyncRoute(async (req, res) => {
    const payload = (req.body ?? {}) as PreviewIssueBody;
    const input = String(payload.input ?? "").trim();
    const industryCode = String(payload.industryCode ?? "").trim().toLowerCase();
    const sourceType = normalizeSourceType(payload.sourceType);

    if (!input) {
      sendError(res, 400, "VALIDATION_ERROR", "input is required");
      return;
    }

    const config = getIndustryConfig(industryCode) ?? listIndustryConfigs()[0];
    if (!config) {
      sendError(res, 503, "SERVICE_UNAVAILABLE", "No industry role sets configured");
      return;
    }

    const productContext = await getProductContext();
    const title = inferIssueTitle(input);
    const summary = inferIssueSummary(input);
    const conflicts = detectConflicts(input, productContext);
    const questions = buildClarificationQuestions(input);
    const refinement = buildRequirementRefinement(input);
    const contextAlignment = buildContextAlignment(input, productContext);
    const designBlueprint = buildDesignBlueprint({
      rawInput: input,
      refinement,
      alignment: contextAlignment
    });
    const recommendedRoleIds = recommendRoles(input, config);
    const suggestedAnswers = buildSuggestedAnswers({
      rawInput: input,
      questions,
      refinement,
      alignment: contextAlignment
    });
    const discussion = buildIssueDiscussion(
      input,
      recommendedRoleIds as RoleType[],
      config.assemblyRule.soulRoleId
    );
    const relatedHistory = buildRelatedHistory(input, productContext.requirementHistory ?? []);
    const expectedArtifacts = buildExpectedArtifacts();
    const requirementContract = buildRequirementContract({
      suggestedAnswers,
      refinement,
      designBlueprint,
      expectedArtifacts
    });

    const issue = await createIssueDraft({
      title,
      sourceType,
      rawInput: input,
      industryCode: config.roleSet.industryCode,
      summary,
      recommendedRoleIds,
      soulRoleId: config.assemblyRule.soulRoleId,
      conflicts,
      questions,
      contextAlignment,
      designBlueprint,
      suggestedAnswers,
      relatedHistory,
      requirementContract
    });

    sendSuccess(res, {
      issueId: issue.id,
      title: issue.title,
      summary: issue.summary,
      industryCode: issue.industryCode,
      recommendedRoleIds: issue.recommendedRoleIds,
      soulRoleId: issue.soulRoleId,
      conflicts: issue.conflicts,
      questions: issue.questions,
      contextAlignment,
      designBlueprint,
      suggestedAnswers,
      relatedHistory,
      requirementContract,
      refinement,
      discussion,
      expectedArtifacts,
      workflow: config.workflows.find((item) => item.isDefault) ?? config.workflows[0] ?? null
    });
  }));

  router.post("/:issueId/confirm", asyncRoute(async (req, res) => {
    const issueId = String(req.params.issueId ?? "").trim();
    const payload = (req.body ?? {}) as ConfirmIssueBody;
    const issue = await getIssue(issueId);

    if (!issue) {
      sendError(res, 404, "NOT_FOUND", `Issue not found: ${issueId}`);
      return;
    }

    if (issue.status === "confirmed" && issue.createdProjectId) {
      sendSuccess(res, issue);
      return;
    }

    const config = getIndustryConfig(issue.industryCode) ?? listIndustryConfigs()[0];
    if (!config) {
      sendError(res, 503, "SERVICE_UNAVAILABLE", "No industry role sets configured");
      return;
    }

    const clarificationAnswers = normalizeStringMap(payload.clarificationAnswers);
    const conflictResolution = String(payload.conflictResolution ?? "").trim();
    const requiredQuestions = issue.questions.filter((question) => question.required);
    const missingRequired = requiredQuestions.find((question) => !String(clarificationAnswers[question.id] ?? "").trim());
    if (missingRequired) {
      sendError(res, 400, "VALIDATION_ERROR", `missing required clarification: ${missingRequired.id}`);
      return;
    }
    const hasCriticalConflict = issue.conflicts.some((conflict) => conflict.severity === "critical");
    if (hasCriticalConflict && !conflictResolution) {
      sendError(res, 400, "VALIDATION_ERROR", "missing required conflict resolution");
      return;
    }
    const hasMismatchConflict = issue.conflicts.some((conflict) => conflict.id === "unresolved-requirement-mismatch");
    if (hasMismatchConflict && conflictResolution) {
      await resolveRequirementMismatches({
        resolution: conflictResolution,
        limit: 3
      });
    }

    const requestedTeamRoleIds = normalizeRoleList(payload.teamRoleIds);
    const selectedRoleIds = requestedTeamRoleIds.length > 0
      ? requestedTeamRoleIds
      : issue.recommendedRoleIds.filter((roleId): roleId is RoleType => ROLE_IDS.includes(roleId as RoleType));
    const allowedRoleSet = new Set(config.roleSet.roleIds);
    const constrainedRoleIds = selectedRoleIds.filter((roleId) => allowedRoleSet.has(roleId));

    if (config.assemblyRule.mustHaveSoulRole && !constrainedRoleIds.includes(config.assemblyRule.soulRoleId)) {
      constrainedRoleIds.unshift(config.assemblyRule.soulRoleId);
    }

    const finalName = String(payload.finalName ?? issue.title).trim() || issue.title;
    const finalDescription = String(payload.finalDescription ?? issue.rawInput).trim() || issue.rawInput;
    const clarificationBlock = Object.entries(clarificationAnswers)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
    const conflictResolutionBlock = conflictResolution ? `\n冲突解决说明:\n${conflictResolution}` : "";
    const projectDescription = clarificationBlock
      ? `${finalDescription}\n\n澄清补充:\n${clarificationBlock}${conflictResolutionBlock}`
      : finalDescription;
    const confirmedContract = {
      objective: clarificationAnswers.goal || issue.requirementContract?.objective || "",
      inScope: clarificationAnswers.scope
        ? [clarificationAnswers.scope, ...(issue.requirementContract?.inScope ?? [])]
        : issue.requirementContract?.inScope ?? [],
      outOfScope: issue.requirementContract?.outOfScope ?? [],
      acceptanceCriteria: clarificationAnswers.acceptance
        ? [clarificationAnswers.acceptance, ...(issue.requirementContract?.acceptanceCriteria ?? [])]
        : issue.requirementContract?.acceptanceCriteria ?? [],
      artifacts: issue.requirementContract?.artifacts ?? [],
      designTheme: issue.requirementContract?.designTheme,
      valueNarrative: issue.requirementContract?.valueNarrative
    };
    const requirementContractBlock = [
      "需求合同:",
      `- 目标: ${confirmedContract.objective || "待补充"}`,
      `- In Scope: ${(confirmedContract.inScope || []).slice(0, 3).join("；") || "待补充"}`,
      `- Out of Scope: ${(confirmedContract.outOfScope || []).slice(0, 3).join("；") || "待补充"}`,
      `- 验收: ${(confirmedContract.acceptanceCriteria || []).slice(0, 3).join("；") || "待补充"}`,
      `- 产出: ${(confirmedContract.artifacts || []).join("、") || "待补充"}`
    ].join("\n");
    const finalProjectDescription = `${projectDescription}\n\n${requirementContractBlock}`;

    const project = await createProject(
      {
        name: finalName,
        description: finalProjectDescription,
        team: constrainedRoleIds,
        requirementContract: confirmedContract
      },
      (await getRuntimeStatus()).mode
    );

    const updated = await updateIssue(issueId, (current) => ({
      ...current,
      clarificationAnswers,
      conflictResolution,
      requirementContract: confirmedContract,
      status: "confirmed",
      createdProjectId: project.id
    }));

    await appendRequirementBackfill({
      issueId: issue.id,
      projectId: project.id,
      title: finalName,
      refinedRequirement: finalProjectDescription,
      status: "in_progress",
      validationStatus: "pending",
      requirementContract: confirmedContract
    });

    options.onProjectCreated?.(project.id);
    sendSuccess(res, {
      issue: updated,
      project,
      backfill: {
        summary: `需求已落地为项目 ${project.name}，并写入团队角色编排。`,
        teamRoleIds: constrainedRoleIds
      }
    });
  }));

  router.post("/:issueId/cancel", asyncRoute(async (req, res) => {
    const issueId = String(req.params.issueId ?? "").trim();
    const updated = await updateIssue(issueId, (current) => ({
      ...current,
      status: "cancelled"
    }));

    if (!updated) {
      sendError(res, 404, "NOT_FOUND", `Issue not found: ${issueId}`);
      return;
    }

    sendSuccess(res, updated);
  }));

  return router;
}
