import express from "express";
import type {
  InterventionInput,
  ProjectMessageInput,
  RoleType,
  StageRejectInput,
  StageSubmissionInput,
  TaskUpdateInput
} from "@occ/shared";
import {
  approveProject,
  archiveProjectAcceptanceReport,
  closeProject,
  createProject,
  deleteProject,
  findProject,
  getDesignInterventionSignal,
  getProjectExecutionProtocolPrecheck,
  getProjectLifecycleQualityAudit,
  interveneProject,
  listProjectExecutions,
  listProjectTasks,
  listProjects,
  listTasks,
  postProjectMessage,
  getProjectTemplateGatePrecheck,
  reconcileProjectDeliverablesNow,
  rejectProjectStage,
  resumeProject,
  submitCurrentStage,
  startProjectWarmupAfterCreate,
  updateTaskStatus
} from "../data/repository.js";
import { getRuntimeStatus } from "../agents/runtime.js";
import { syncTaskStatus } from "../services/gitlab-sync-policy.js";
import {
  buildProjectIssueFirstMessage,
  ensureProjectIssueFirst
} from "../services/project-issue-first.js";
import { previewRequirement } from "../utils/project-parser.js";
import { generateOfficialSiteArtifact } from "../utils/official-site.js";
import {
  publishTaskIssueNote,
  syncProjectGitLabHarness,
  upsertQualityGateRepairIssue
} from "./gitlab.js";

const PROJECT_DIRECT_CREATE_ENABLED = process.env.PROJECT_DIRECT_CREATE_ENABLED === "true";
const PROJECT_PARSE_LEGACY_ENABLED = process.env.PROJECT_PARSE_LEGACY_ENABLED === "true";
const QUALITY_GATE_REPAIR_DEFAULT_LIMIT = 80;
const QUALITY_GATE_REPAIR_STAGE_LABELS: Record<string, string> = {
  INIT: "立项",
  ANALYSIS: "分析",
  DESIGN: "设计",
  DEV: "开发",
  ACCEPT: "验收"
};
const QUALITY_GATE_REPAIR_DEFAULT_VALIDATIONS = [
  "pnpm --filter @occ/api typecheck",
  "pnpm --filter @occ/web typecheck",
  "pnpm --filter @occ/web build"
];

function normalizeStringArrayInput(input: unknown) {
  if (!Array.isArray(input)) {
    return [] as string[];
  }
  return input
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function normalizeStatusFilter(input: unknown) {
  const allowed = new Set(["active", "paused", "blocked", "completed"]);
  const values = normalizeStringArrayInput(input).map((item) => item.toLowerCase());
  return new Set(values.filter((item) => allowed.has(item)));
}

function parseRepairLimit(input: unknown) {
  const value = Number(input);
  if (!Number.isFinite(value)) {
    return QUALITY_GATE_REPAIR_DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(300, Math.floor(value)));
}

async function buildProjectQualityGateRepairResult(input: {
  projectId: string;
  dryRun: boolean;
  projectPath?: string;
  validationCommands: string[];
}) {
  const project = await findProject(input.projectId);
  if (!project) {
    return {
      projectId: input.projectId,
      status: "not_found" as const,
      blockingStageCount: 0,
      created: [] as Array<{ stageType: string; stageLabel: string; issueIid: number; issueUrl: string; marker: string }>,
      reused: [] as Array<{ stageType: string; stageLabel: string; issueIid: number; issueUrl: string; marker: string }>,
      failed: [] as Array<{ stageType: string; stageLabel: string; reason: string }>
    };
  }

  const lifecycleAudit = await getProjectLifecycleQualityAudit(project.id);
  if (!lifecycleAudit) {
    return {
      projectId: project.id,
      projectName: project.name,
      status: "audit_unavailable" as const,
      blockingStageCount: 0,
      created: [] as Array<{ stageType: string; stageLabel: string; issueIid: number; issueUrl: string; marker: string }>,
      reused: [] as Array<{ stageType: string; stageLabel: string; issueIid: number; issueUrl: string; marker: string }>,
      failed: [] as Array<{ stageType: string; stageLabel: string; reason: string }>
    };
  }

  const blockingStages = lifecycleAudit.stageAudits.filter((stage) => !stage.pass);
  const stagePlans = blockingStages.map((stage) => ({
    stageType: stage.stageType,
    stageLabel: QUALITY_GATE_REPAIR_STAGE_LABELS[stage.stageType] || stage.stageLabel || stage.stageType,
    stageStatus: stage.stageStatus,
    stageIssues: stage.issues || []
  }));

  const created: Array<{ stageType: string; stageLabel: string; issueIid: number; issueUrl: string; marker: string }> = [];
  const reused: Array<{ stageType: string; stageLabel: string; issueIid: number; issueUrl: string; marker: string }> = [];
  const failed: Array<{ stageType: string; stageLabel: string; reason: string }> = [];

  if (!input.dryRun) {
    for (const stage of stagePlans) {
      const result = await upsertQualityGateRepairIssue({
        projectId: project.id,
        projectName: project.name,
        stageType: stage.stageType,
        stageLabel: stage.stageLabel,
        stageStatus: stage.stageStatus,
        currentStage: lifecycleAudit.currentStage,
        stageIssues: stage.stageIssues,
        validationCommands: input.validationCommands,
        projectPath: input.projectPath
      });
      if (!result.ok) {
        failed.push({
          stageType: stage.stageType,
          stageLabel: stage.stageLabel,
          reason: result.message
        });
        continue;
      }
      const record = {
        stageType: stage.stageType,
        stageLabel: stage.stageLabel,
        issueIid: result.data.issueIid,
        issueUrl: result.data.issueUrl,
        marker: result.data.marker
      };
      if (result.data.action === "created") {
        created.push(record);
      } else {
        reused.push(record);
      }
    }
  }

  return {
    projectId: project.id,
    projectName: project.name,
    status: "ok" as const,
    pass: lifecycleAudit.pass,
    blockingStageCount: blockingStages.length,
    blockingStages: stagePlans,
    dryRun: input.dryRun,
    created,
    reused,
    failed
  };
}

function formatTerminalCollaborationViolation(message: string) {
  const normalized = String(message || "").trim();
  const match = normalized.match(/TERMINAL_COLLAB_PROTOCOL_VIOLATION:\s*missing_fields=([^;]+);\s*section=([a-z]+)/i);
  if (!match) {
    return "";
  }

  const rawFields = String(match[1] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const labelMap: Record<string, string> = {
    factsConfirmed: "factsConfirmed（已确认事实）",
    assumptions: "assumptions（当前假设）",
    decisions: "decisions（已做决策）",
    handoff: "handoff（交给下游 Agent 的明确输入与动作）",
    openQuestions: "openQuestions（待确认问题或风险空白）"
  };
  const formattedFields = rawFields.map((field) => labelMap[field] || field).join("、");
  const sectionState = String(match[2] || "").toLowerCase() === "present"
    ? "已检测到协作交接卡区块，但字段未填写完整"
    : "未检测到完整协作交接卡区块";
  return `最新执行未通过协作交接卡协议：${sectionState}，缺少字段 ${formattedFields || "unknown"}。请补齐 factsConfirmed / assumptions / decisions / handoff / openQuestions 后重试。`;
}

/**
 * @openapi
 * /api/projects/parse:
 *   post:
 *     tags: [Projects]
 *     summary: 解析自然语言需求并生成项目草案
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProjectParsePayload'
 *     responses:
 *       200:
 *         description: 解析成功
 *       400:
 *         $ref: '#/components/responses/Validation400'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *
 * /api/projects/preview:
 *   post:
 *     tags: [Projects]
 *     summary: 预览需求解析意图
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [description]
 *             properties:
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: 预览成功
 *       400:
 *         $ref: '#/components/responses/Validation400'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *
 * /api/projects:
 *   get:
 *     tags: [Projects]
 *     summary: 查询项目列表
 *     responses:
 *       200:
 *         description: 项目列表
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *   post:
 *     tags: [Projects]
 *     summary: 创建项目
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProjectCreatePayload'
 *     responses:
 *       201:
 *         description: 创建成功
 *       400:
 *         $ref: '#/components/responses/Validation400'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *
 * /api/projects/cleanup/candidates:
 *   get:
 *     tags: [Projects]
 *     summary: 查询可清理项目候选
 *     responses:
 *       200:
 *         description: 候选列表
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *
 * /api/projects/cleanup:
 *   post:
 *     tags: [Projects]
 *     summary: 执行项目清理
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProjectCleanupPayload'
 *     responses:
 *       200:
 *         description: 清理结果
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       409:
 *         $ref: '#/components/responses/Conflict409'
 *
 * /api/projects/automation:
 *   get:
 *     tags: [Projects]
 *     summary: 查询自动推进配置状态
 *     responses:
 *       200:
 *         description: 自动推进状态
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *   put:
 *     tags: [Projects]
 *     summary: 更新自动推进配置
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProjectAutomationPayload'
 *     responses:
 *       200:
 *         description: 更新成功
 *       400:
 *         $ref: '#/components/responses/Validation400'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *
 * /api/projects/automation/run:
 *   post:
 *     tags: [Projects]
 *     summary: 手动触发自动推进执行一轮
 *     responses:
 *       200:
 *         description: 触发成功
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       409:
 *         $ref: '#/components/responses/Conflict409'
 *
 * /api/projects/{id}:
 *   get:
 *     tags: [Projects]
 *     summary: 查询项目详情
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 项目详情
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *   delete:
 *     tags: [Projects]
 *     summary: 删除项目
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 删除成功
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/projects/{id}/advance:
 *   post:
 *     tags: [Projects]
 *     summary: 推进项目执行一轮
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       409:
 *         $ref: '#/components/responses/Conflict409'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/projects/{id}/reconcile-deliverables:
 *   post:
 *     tags: [Projects]
 *     summary: 重新对齐项目交付物
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 对齐完成
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/projects/{id}/executions:
 *   get:
 *     tags: [Projects]
 *     summary: 查询项目执行记录
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: 执行记录列表
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/projects/{id}/acceptance-report:
 *   get:
 *     tags: [Projects]
 *     summary: 查询验收报告
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 验收报告
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/projects/{id}/acceptance-report.md:
 *   get:
 *     tags: [Projects]
 *     summary: 下载验收报告 Markdown
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Markdown 内容
 *         content:
 *           text/markdown:
 *             schema:
 *               type: string
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         description: 项目不存在
 *
 * /api/projects/{id}/acceptance-report/archive:
 *   post:
 *     tags: [Projects]
 *     summary: 归档验收报告
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *     responses:
 *       200:
 *         description: 归档成功
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/projects/{id}/final-artifacts:
 *   get:
 *     tags: [Projects]
 *     summary: 查询最终交付物报告
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: generate
 *         schema:
 *           type: string
 *           enum: [auto, false]
 *     responses:
 *       200:
 *         description: 最终交付物状态
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/projects/{id}/final-artifacts/generate:
 *   post:
 *     tags: [Projects]
 *     summary: 触发最终交付物异步生成
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               force:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: 已排队
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/projects/{id}/final-artifacts/job:
 *   get:
 *     tags: [Projects]
 *     summary: 查询最终交付物最新任务进度
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 任务进度
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/projects/{id}/final-artifacts/jobs/{jobId}:
 *   get:
 *     tags: [Projects]
 *     summary: 查询指定最终交付物任务
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 任务详情
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/projects/{id}/official-site:
 *   get:
 *     tags: [Projects]
 *     summary: 获取官网产物链接
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 官网产物
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessEnvelope'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *       409:
 *         $ref: '#/components/responses/Conflict409'
 *
 * /api/projects/{id}/tasks:
 *   get:
 *     tags: [Projects]
 *     summary: 查询项目任务列表
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 任务列表
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *
 * /api/tasks:
 *   get:
 *     tags: [Projects]
 *     summary: 查询全部任务列表
 *     responses:
 *       200:
 *         description: 任务列表
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *
 * /api/projects/{id}/approve:
 *   post:
 *     tags: [Projects]
 *     summary: 审批通过当前阶段
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 审批通过
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *       409:
 *         $ref: '#/components/responses/Conflict409'
 *       422:
 *         $ref: '#/components/responses/Unprocessable422'
 *
 * /api/projects/{id}/reject:
 *   post:
 *     tags: [Projects]
 *     summary: 驳回当前阶段
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/StageRejectPayload'
 *     responses:
 *       200:
 *         description: 驳回成功
 *       400:
 *         $ref: '#/components/responses/Validation400'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *       409:
 *         $ref: '#/components/responses/Conflict409'
 *
 * /api/projects/{id}/intervene:
 *   post:
 *     tags: [Projects]
 *     summary: 人工强制介入
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InterventionPayload'
 *     responses:
 *       200:
 *         description: 介入成功
 *       400:
 *         $ref: '#/components/responses/Validation400'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/projects/{id}/resume:
 *   post:
 *     tags: [Projects]
 *     summary: 恢复项目执行
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 恢复成功
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/projects/{id}/close:
 *   post:
 *     tags: [Projects]
 *     summary: 关闭项目
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 关闭成功
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/projects/{id}/stages/submit:
 *   post:
 *     tags: [Projects]
 *     summary: 提交阶段交付物
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/StageSubmitPayload'
 *     responses:
 *       200:
 *         description: 提交成功
 *       400:
 *         $ref: '#/components/responses/Validation400'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *       422:
 *         $ref: '#/components/responses/Unprocessable422'
 *
 * /api/projects/{id}/messages:
 *   post:
 *     tags: [Projects]
 *     summary: 向项目发送消息
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProjectMessagePayload'
 *     responses:
 *       200:
 *         description: 发送成功
 *       400:
 *         $ref: '#/components/responses/Validation400'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/tasks/{taskId}:
 *   patch:
 *     tags: [Projects]
 *     summary: 更新任务状态
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TaskPatchPayload'
 *     responses:
 *       200:
 *         description: 更新成功
 *       400:
 *         $ref: '#/components/responses/Validation400'
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         $ref: '#/components/responses/NotFound404'
 *
 * /api/projects/{id}/live:
 *   get:
 *     tags: [Projects]
 *     summary: 订阅项目实时输出流（SSE）
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: SSE event-stream
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *       401:
 *         $ref: '#/components/responses/Unauthorized401'
 *       404:
 *         description: 项目不存在
 */
type ProjectRequiredAction = {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  action:
    | "submit_stage_deliverable"
    | "open_design_review"
    | "review_pending_stage"
    | "resolve_blocked_tasks"
    | "reconcile_deliverables"
    | "refresh_runtime";
  ctaLabel: string;
  reasonCode?: "design_ambiguity";
  prefillContent?: string;
};

type ProjectRecord = NonNullable<Awaited<ReturnType<typeof findProject>>>;

type ProjectAutomationState = {
  enabled: boolean;
  intervalMs: number;
  running: boolean;
  lastRunAt: string | null;
  lastError: string | null;
  lastSummary: string;
};

type FinalArtifactsJobState = {
  jobId: string;
  projectId: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  step: string;
  message?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  report?: unknown;
  officialSite?: {
    url: string;
    filePath?: string;
  };
};

interface CreateProjectsRouterOptions {
  asyncRoute: (
    handler: (req: express.Request, res: express.Response) => Promise<void>
  ) => express.RequestHandler;
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
  sendEvent: (res: express.Response, event: string, data: unknown) => void;
  splitScript: (input: string, size: number) => string[];
  projectAutomationState: ProjectAutomationState;
  restartProjectAutomationTicker: () => void;
  runProjectAutomationTick: (options?: { force?: boolean }) => Promise<void>;
  kickProjectAutomationTick: (options?: { force?: boolean }) => void;
  projectAdvanceLocks: Set<string>;
  projectAdvanceJobs: Map<string, Promise<void>>;
  projectAdvanceJobErrors: Map<string, { message: string; at: string }>;
  markProjectAdvanceCancelled: (projectId: string) => void;
  clearProjectAdvanceCancelled: (projectId: string) => void;
  ensureManualAdvanceJob: (projectId: string) => void;
  buildProjectRequiredActions: (project: any, runtime: any) => ProjectRequiredAction[];
  formatRequiredActionsMessage: (actions: ProjectRequiredAction[]) => string;
  buildProjectAcceptanceReport: (
    project: any,
    options?: {
      executions?: Array<{
        role: string;
        status: string;
        model?: string | null;
        provider?: string | null;
        createdAt: string;
        updatedAt: string;
      }>;
      lifecycleAudit?: {
        pass: boolean;
        blockingStageCount: number;
        blockingStages: string[];
        stageAudits?: Array<{
          stageType: string;
          stageLabel: string;
          pass: boolean;
          issues: string[];
        }>;
      };
    }
  ) => any;
  renderAcceptanceReportMarkdown: (report: any) => string;
  getLatestFinalArtifactsJob: (projectId: string) => any;
  startFinalArtifactsGenerationJob: (projectId: string, options?: { force?: boolean }) => any;
  buildProjectFinalArtifactsReport: (project: any, officialSite?: any, executions?: any) => any;
  attachFinalArtifactsGeneration: (report: any, job?: any) => any;
  toFinalArtifactsJobProgress: (job?: any) => any;
  finalArtifactsJobsById: Map<string, any>;
}

type ProjectParsePriority = "High" | "Medium" | "Low";

const PROJECT_PARSE_ROLE_LABELS: Record<RoleType, string> = {
  ROLE_ASSISTANT: "总助理",
  ROLE_PM: "项目经理",
  ROLE_ANALYST: "需求分析师",
  ROLE_PRODUCT: "产品总监",
  ROLE_DESIGN: "视觉设计总监",
  ROLE_ARCH: "研发总监",
  ROLE_DEV: "研发经理",
  ROLE_QA: "测试工程师",
  ROLE_HR: "HR总监"
};

const PROJECT_PARSE_ROLE_HINTS: Array<{ role: RoleType; patterns: RegExp[] }> = [
  { role: "ROLE_PM", patterns: [/项目经理/, /pm/, /排期/, /里程碑/] },
  { role: "ROLE_ANALYST", patterns: [/需求/, /分析/, /调研/] },
  { role: "ROLE_PRODUCT", patterns: [/产品/, /原型/, /交互/, /体验/] },
  { role: "ROLE_DESIGN", patterns: [/视觉/, /设计/, /品牌/, /ui/, /ux/, /页面/, /官网/] },
  { role: "ROLE_ARCH", patterns: [/架构/, /基础设施/, /infra/, /系统设计/] },
  { role: "ROLE_DEV", patterns: [/研发/, /开发/, /编码/, /后端/, /前端/, /联调/] },
  { role: "ROLE_QA", patterns: [/测试/, /验收/, /qa/, /质量/] },
  { role: "ROLE_HR", patterns: [/招聘/, /人力/, /hr/] }
];

function inferProjectPriority(input: string): ProjectParsePriority {
  if (/紧急|马上|立即|asap|今天|本周|高优先|关键/.test(input)) {
    return "High";
  }
  if (/低优先|不着急|后续|有空|慢慢/.test(input)) {
    return "Low";
  }
  return "Medium";
}

function inferProjectPhase(input: string): string {
  if (/验收|测试|上线|发布|交付/.test(input)) {
    return "验收";
  }
  if (/开发|编码|实现|联调|后端|前端/.test(input)) {
    return "开发";
  }
  if (/设计|原型|界面|交互|架构/.test(input)) {
    return "设计";
  }
  return "分析";
}

function inferProjectName(input: string, keywords: string[]): string {
  const quoted = input.match(/["“](.{2,40})["”]/);
  if (quoted?.[1]) {
    return quoted[1].trim();
  }

  const candidate = input
    .replace(/(请|帮我|我们|需要|想要|希望|做一个|做个|创建|搭建|开发|实现|一个|项目|系统)/g, " ")
    .replace(/[，。,.!?]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join("");

  if (candidate) {
    return candidate.slice(0, 16) + "项目";
  }

  if (keywords[0]) {
    return keywords[0] + "项目";
  }

  return "新项目";
}

function inferProjectTeam(input: string, suggestedTeam: RoleType[]): RoleType[] {
  const matched = PROJECT_PARSE_ROLE_HINTS
    .filter((entry) => entry.patterns.some((pattern) => pattern.test(input)))
    .map((entry) => entry.role);

  if (matched.length > 0) {
    return Array.from(new Set(matched));
  }

  return suggestedTeam.length > 0 ? suggestedTeam.slice(0, 6) : ["ROLE_PM", "ROLE_ANALYST", "ROLE_PRODUCT", "ROLE_DESIGN", "ROLE_DEV", "ROLE_QA"];
}

const GITLAB_HARNESS_SYNC_STAGES = new Set(["DEV", "ACCEPT"]);
const PROJECT_ADVANCE_POLL_MIN_MS = 2000;
const PROJECT_ADVANCE_POLL_MAX_MS = 20000;
const PROJECT_ADVANCE_STORM_THRESHOLD = Math.max(
  4,
  Number(process.env.PROJECT_ADVANCE_STORM_THRESHOLD ?? 6)
);
const PROJECT_ADVANCE_STALE_JOB_MS = Math.max(
  30_000,
  Number(process.env.PROJECT_ADVANCE_STALE_JOB_MS ?? 45_000)
);
const PROJECT_ADVANCE_RECOVERY_COOLDOWN_MS = Math.max(
  20_000,
  Number(process.env.PROJECT_ADVANCE_RECOVERY_COOLDOWN_MS ?? 45_000)
);
const projectAdvancePollHints = new Map<string, {
  pollAfterMs: number;
  lastAt: number;
  inProgressCount: number;
  lastRecoveryAt?: number;
}>();

function resetProjectAdvancePollHint(projectId: string) {
  projectAdvancePollHints.delete(projectId);
}

function nextProjectAdvancePollAfterMs(projectId: string, recovering = false) {
  const now = Date.now();
  const existing = projectAdvancePollHints.get(projectId);
  const stale = !existing || now - existing.lastAt > 60_000;
  const base = stale
    ? (recovering ? 3500 : PROJECT_ADVANCE_POLL_MIN_MS)
    : existing.pollAfterMs;
  const next = Math.min(
    PROJECT_ADVANCE_POLL_MAX_MS,
    Math.max(
      PROJECT_ADVANCE_POLL_MIN_MS,
      Math.round(base * (recovering ? 1.45 : 1.3) + (recovering ? 350 : 120))
    )
  );
  const inProgressCount = stale ? 1 : existing.inProgressCount + 1;
  projectAdvancePollHints.set(projectId, {
    pollAfterMs: next,
    lastAt: now,
    inProgressCount,
    lastRecoveryAt: existing?.lastRecoveryAt
  });
  return next;
}

function markProjectAdvanceRecovery(projectId: string) {
  const existing = projectAdvancePollHints.get(projectId);
  if (!existing) {
    projectAdvancePollHints.set(projectId, {
      pollAfterMs: PROJECT_ADVANCE_POLL_MIN_MS,
      lastAt: Date.now(),
      inProgressCount: 1,
      lastRecoveryAt: Date.now()
    });
    return;
  }
  projectAdvancePollHints.set(projectId, {
    ...existing,
    lastRecoveryAt: Date.now()
  });
}

function tryRecoverStalledAdvanceJob(input: {
  projectId: string;
  hasLock: boolean;
  hasJob: boolean;
  ensureManualAdvanceJob: (projectId: string) => void;
  projectAdvanceJobs: Map<string, Promise<void>>;
}) {
  if (!input.hasJob || input.hasLock) {
    return false;
  }

  const hint = projectAdvancePollHints.get(input.projectId);
  if (!hint) {
    return false;
  }

  const now = Date.now();
  const storming = hint.inProgressCount >= PROJECT_ADVANCE_STORM_THRESHOLD;
  const stale = now - hint.lastAt >= PROJECT_ADVANCE_STALE_JOB_MS;
  const cooldownReady = !hint.lastRecoveryAt
    || now - hint.lastRecoveryAt >= PROJECT_ADVANCE_RECOVERY_COOLDOWN_MS;
  if (!cooldownReady || (!storming && !stale)) {
    return false;
  }

  input.projectAdvanceJobs.delete(input.projectId);
  input.ensureManualAdvanceJob(input.projectId);
  markProjectAdvanceRecovery(input.projectId);
  return true;
}

function isRecoverableAdvanceFailure(message: string) {
  const normalized = String(message || "").toUpperCase();
  if (normalized.includes("REAL_MODEL_GATE_FAILED")) {
    // 门禁失败通常需要人工修复运行时配置或链路，不应进入无限自动重试。
    return false;
  }
  return normalized.includes("MODEL_ATTEMPT_TIMEOUT")
    || normalized.includes("REQUEST_TIMEOUT")
    || normalized.includes("ETIMEDOUT")
    || normalized.includes("ECONNRESET")
    || normalized.includes("EAI_AGAIN")
    || normalized.includes("STAGE_TEMPLATE_VALIDATION_FAILED");
}

const REAL_MODEL_GATE_ACTION_ORDER: ProjectRequiredAction["action"][] = [
  "refresh_runtime",
  "submit_stage_deliverable",
  "reconcile_deliverables",
  "open_design_review",
  "resolve_blocked_tasks",
  "review_pending_stage"
];

function hasApprovedDesignReview(content: string) {
  const source = String(content || "");
  return source.includes("## 设计审查卡") && /审查结论:\s*通过/.test(source);
}

function hasVisualDesignPreview(content: string) {
  const source = String(content || "");
  return /```html[\s\S]*?```/i.test(source)
    || /<!doctype html/i.test(source)
    || /<html[\s>]/i.test(source)
    || /!\[[^\]]*\]\((https?:\/\/|data:image\/)/i.test(source);
}

function createFallbackRequiredAction(
  action: ProjectRequiredAction["action"],
  project: ProjectRecord
): ProjectRequiredAction {
  const stageLabel = String(project.currentStage || "当前阶段");
  switch (action) {
    case "refresh_runtime":
      return {
        id: "real-model-gate-repair",
        severity: "critical",
        title: "当前阶段未通过真实模型门禁",
        detail: "请修复模型通道（API Key / Base URL / 可用模型）并重新执行本阶段，再进行验收。",
        action: "refresh_runtime",
        ctaLabel: "修复模型通道"
      };
    case "submit_stage_deliverable":
      return {
        id: "missing-stage-deliverable",
        severity: "critical",
        title: "当前阶段缺少交付物",
        detail: `请先补齐 ${stageLabel} 的交付物后，再重新执行阶段验收。`,
        action: "submit_stage_deliverable",
        ctaLabel: "前往提交交付物"
      };
    case "reconcile_deliverables":
      return {
        id: "reconcile-stage-deliverables",
        severity: "warning",
        title: "请重建当前阶段交付物",
        detail: "建议先执行一次交付物重建，补齐模板章节与执行证据，再重新验收。",
        action: "reconcile_deliverables",
        ctaLabel: "重建交付物内容"
      };
    case "open_design_review":
      return {
        id: "design-review-required",
        severity: "critical",
        title: "设计阶段缺少可确认设计审查产物",
        detail: "请补充并通过设计审查卡，同时提供静态图或单页 HTML 视觉稿后再验收。",
        action: "open_design_review",
        ctaLabel: "提交设计审查卡"
      };
    case "resolve_blocked_tasks":
      return {
        id: "blocked-tasks",
        severity: "warning",
        title: "当前阶段存在阻塞任务",
        detail: "请先解除阻塞任务，再继续验收流程。",
        action: "resolve_blocked_tasks",
        ctaLabel: "前往处理阻塞任务"
      };
    case "review_pending_stage":
    default:
      return {
        id: "review-pending-stage",
        severity: "info",
        title: "完成修复后请重新执行阶段验收",
        detail: "以上修复动作完成后，请重新点击通过/驳回，完成当前阶段确认。",
        action: "review_pending_stage",
        ctaLabel: "执行阶段验收"
      };
  }
}

function buildRealModelGateRecoveryActions(input: {
  project: ProjectRecord;
  requiredActions: ProjectRequiredAction[];
}) {
  const requiredByAction = new Map<ProjectRequiredAction["action"], ProjectRequiredAction>();
  for (const action of input.requiredActions) {
    if (!requiredByAction.has(action.action)) {
      requiredByAction.set(action.action, action);
    }
  }

  const currentStageDeliverables = input.project.deliverables
    .filter((item) => item.stageType === input.project.currentStage)
    .sort((left, right) => right.version - left.version);
  const missingStageDeliverables = currentStageDeliverables.length === 0;
  const hasDesignReview = input.project.currentStage === "DESIGN"
    && currentStageDeliverables.some((item) => hasApprovedDesignReview(String(item.content || "")));
  const hasVisualPreview = input.project.currentStage === "DESIGN"
    && currentStageDeliverables.some((item) =>
      /视觉定稿|视觉设计稿|单页预览|mockup|wireframe|preview\.html/i.test(String(item.name || ""))
      && hasVisualDesignPreview(String(item.content || ""))
    );
  const designInterventionRequired = getDesignInterventionSignal(input.project).required;
  const hasBlockedTasks = input.project.tasks.some(
    (task) => task.stageType === input.project.currentStage && task.status === "blocked"
  );

  const needAction = (action: ProjectRequiredAction["action"]) => {
    if (action === "refresh_runtime") {
      return true;
    }
    if (action === "submit_stage_deliverable") {
      return missingStageDeliverables || requiredByAction.has(action);
    }
    if (action === "reconcile_deliverables") {
      return requiredByAction.has(action);
    }
    if (action === "open_design_review") {
      return requiredByAction.has(action)
        || (input.project.currentStage === "DESIGN" && designInterventionRequired && (!hasDesignReview || !hasVisualPreview));
    }
    if (action === "resolve_blocked_tasks") {
      return hasBlockedTasks || requiredByAction.has(action);
    }
    if (action === "review_pending_stage") {
      return input.project.pendingApproval || requiredByAction.has(action);
    }
    return requiredByAction.has(action);
  };

  const orderedActions: ProjectRequiredAction[] = [];
  for (const action of REAL_MODEL_GATE_ACTION_ORDER) {
    if (!needAction(action)) {
      continue;
    }
    orderedActions.push(requiredByAction.get(action) || createFallbackRequiredAction(action, input.project));
  }

  for (const action of input.requiredActions) {
    if (orderedActions.some((item) => item.action === action.action)) {
      continue;
    }
    orderedActions.push(action);
  }

  const recoveryPlan = orderedActions.map((action, index) => ({
    step: index + 1,
    action: action.action,
    title: action.title
  }));

  return {
    requiredActions: orderedActions,
    recoveryPlan
  };
}

async function trySyncGitLabHarness(input: {
  projectId: string;
  stageType?: string;
  closeOnComplete?: boolean;
  reason: string;
}) {
  const normalizedStage = String(input.stageType || "").trim().toUpperCase();
  const closeOnComplete = Boolean(input.closeOnComplete);
  const shouldSync = GITLAB_HARNESS_SYNC_STAGES.has(normalizedStage) || closeOnComplete;
  if (!shouldSync) {
    return;
  }

  try {
    const result = await syncProjectGitLabHarness({
      projectId: input.projectId,
      stageType: normalizedStage || undefined,
      closeOnComplete
    });
    if (!result.ok) {
      console.warn(`[GitLab Harness] sync skipped (${input.reason}): ${result.code} ${result.message}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.warn(`[GitLab Harness] sync failed (${input.reason}): ${message}`);
  }
}

export function createProjectsRouter(options: CreateProjectsRouterOptions) {
  const {
    asyncRoute,
    safeAudit,
    sendEvent,
    splitScript,
    projectAutomationState,
    restartProjectAutomationTicker,
    runProjectAutomationTick,
    kickProjectAutomationTick,
    projectAdvanceLocks,
    projectAdvanceJobs,
    projectAdvanceJobErrors,
    markProjectAdvanceCancelled,
    clearProjectAdvanceCancelled,
    ensureManualAdvanceJob,
    buildProjectRequiredActions,
    formatRequiredActionsMessage,
    buildProjectAcceptanceReport,
    renderAcceptanceReportMarkdown,
    getLatestFinalArtifactsJob,
    startFinalArtifactsGenerationJob,
    buildProjectFinalArtifactsReport,
    attachFinalArtifactsGeneration,
    toFinalArtifactsJobProgress,
    finalArtifactsJobsById
  } = options;

  const router = express.Router();
router.post("/api/projects/parse", asyncRoute(async (req, res) => {
  if (!PROJECT_PARSE_LEGACY_ENABLED) {
    res.status(410).json({
      success: false,
      error: {
        code: "PROJECT_PARSE_LEGACY_DISABLED",
        message: "自然语言规则解析已停用。请通过 /api/issues/preview 获取真实模型讨论后的正式结论。"
      }
    });
    return;
  }

  const input = String(req.body?.input ?? req.body?.description ?? "").trim();

  if (!input) {
    res.status(400).json({ message: "input is required" });
    return;
  }

  const parsedIntent = previewRequirement(input);
  const team = inferProjectTeam(input, parsedIntent.suggestedTeam);

  res.json({
    name: inferProjectName(input, parsedIntent.keywords),
    description: parsedIntent.summary || input,
    phase: inferProjectPhase(input),
    agents: team.map((role) => PROJECT_PARSE_ROLE_LABELS[role]),
    team,
    priority: inferProjectPriority(input)
  });
}));

router.post("/api/projects/preview", asyncRoute(async (req, res) => {
  const description = String(req.body?.description ?? "").trim();

  if (!description) {
    res.status(400).json({ message: "description is required" });
    return;
  }

  res.json(previewRequirement(description));
}));

router.get("/api/projects", asyncRoute(async (_req, res) => {
  res.json(await listProjects());
}));

type ProjectCleanupCandidate = {
  id: string;
  name: string;
  status: string;
  currentStage: string;
  updatedAt: string;
  reasons: string[];
  recommended: boolean;
};

const CLEANUP_TEST_NAME_PATTERN = /(复测|冒烟|测试|验证|巡检|高保真|闭环能力版|HTTP真实流转版|设计增强版|重新启用创建|创建即推进|阶段B-|验收版|\bV1\b)/i;

function normalizeProjectNameForCleanup(input: string) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()（）\[\]【】]/g, "");
}

function buildProjectCleanupCandidates(
  projects: Awaited<ReturnType<typeof listProjects>>,
): ProjectCleanupCandidate[] {
  const reasonMap = new Map<string, Set<string>>();
  const addReason = (id: string, reason: string) => {
    const current = reasonMap.get(id) || new Set<string>();
    current.add(reason);
    reasonMap.set(id, current);
  };

  for (const project of projects) {
    if (project.status === "paused") {
      addReason(project.id, "paused");
    }
    if (CLEANUP_TEST_NAME_PATTERN.test(project.name)) {
      addReason(project.id, "test_like");
    }
  }

  const grouped = new Map<string, typeof projects>();
  for (const project of projects) {
    const key = normalizeProjectNameForCleanup(project.name);
    const list = grouped.get(key) || [];
    list.push(project);
    grouped.set(key, list);
  }

  for (const [, group] of grouped) {
    if (group.length <= 1) {
      continue;
    }
    const sorted = [...group].sort(
      (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    );
    for (const duplicate of sorted.slice(1)) {
      addReason(duplicate.id, "duplicate_name");
    }
  }

  return projects
    .filter((project) => reasonMap.has(project.id))
    .map((project) => {
      const reasons = Array.from(reasonMap.get(project.id) || []);
      const recommended = reasons.includes("paused") || reasons.includes("test_like") || reasons.includes("duplicate_name");
      return {
        id: project.id,
        name: project.name,
        status: project.status,
        currentStage: project.currentStage,
        updatedAt: project.updatedAt,
        reasons,
        recommended,
      };
    })
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

router.get("/api/projects/cleanup/candidates", asyncRoute(async (_req, res) => {
  const projects = await listProjects();
  const candidates = buildProjectCleanupCandidates(projects);
  res.json({
    success: true,
    data: candidates,
  });
}));

router.post("/api/projects/cleanup", asyncRoute(async (req, res) => {
  const idsInput = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]) : [];
  const mode = String(req.body?.mode || "recommended");
  const dryRun = Boolean(req.body?.dryRun);
  const projects = await listProjects();
  const candidates = buildProjectCleanupCandidates(projects);
  const candidateIds = new Set(candidates.map((item) => item.id));
  const projectNameById = new Map(projects.map((project) => [project.id, project.name]));

  const idsFromBody: string[] = idsInput
    .map((item: unknown) => String(item || "").trim())
    .filter((item): item is string => Boolean(item));
  const dedupedIds = Array.from(new Set<string>(idsFromBody));

  const targetIds: string[] = idsFromBody.length > 0
    ? dedupedIds.filter((id) => candidateIds.has(id))
    : mode === "all_candidates"
      ? candidates.map((item) => item.id)
      : candidates.filter((item) => item.recommended).map((item) => item.id);

  const deleted: Array<{ id: string; name: string }> = [];
  const failed: Array<{ id: string; error: string }> = [];

  if (!dryRun) {
    for (const id of targetIds) {
      try {
        markProjectAdvanceCancelled(id);
        const removed = await deleteProject(id);
        if (!removed) {
          failed.push({ id, error: "not found" });
          continue;
        }
        deleted.push({
          id,
          name: projectNameById.get(id) || id,
        });
      } catch (error) {
        failed.push({
          id,
          error: error instanceof Error ? error.message : "delete failed",
        });
      }
    }
  }

  const remaining = dryRun ? projects.length : (await listProjects()).length;

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.cleanup",
    resourceType: "project",
    summary: dryRun
      ? `项目清理预览：候选 ${targetIds.length} 个`
      : `项目清理执行：删除 ${deleted.length} 个，失败 ${failed.length} 个`,
    detail: `mode=${mode}; dryRun=${dryRun}; requested=${targetIds.length}`,
  });

  res.json({
    success: true,
    data: {
      requested: targetIds.length,
      deleted,
      failed,
      remaining,
    },
  });
}));

router.get("/api/projects/automation", asyncRoute(async (_req, res) => {
  res.json({
    enabled: projectAutomationState.enabled,
    intervalMs: projectAutomationState.intervalMs,
    running: projectAutomationState.running,
    lastRunAt: projectAutomationState.lastRunAt,
    lastError: projectAutomationState.lastError,
    lastSummary: projectAutomationState.lastSummary
  });
}));

router.put("/api/projects/automation", asyncRoute(async (req, res) => {
  const enabled = req.body?.enabled;
  const intervalMsInput = Number(req.body?.intervalMs ?? projectAutomationState.intervalMs);

  if (typeof enabled !== "boolean") {
    res.status(400).json({ message: "enabled must be boolean" });
    return;
  }

  projectAutomationState.enabled = enabled;
  projectAutomationState.intervalMs = Number.isFinite(intervalMsInput)
    ? Math.max(5000, Math.round(intervalMsInput))
    : projectAutomationState.intervalMs;
  restartProjectAutomationTicker();

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.automation.updated",
    resourceType: "project",
    summary: `自动推进已${enabled ? "开启" : "关闭"}`,
    detail: `intervalMs=${projectAutomationState.intervalMs}`
  });

  res.json({
    enabled: projectAutomationState.enabled,
    intervalMs: projectAutomationState.intervalMs,
    running: projectAutomationState.running,
    lastRunAt: projectAutomationState.lastRunAt,
    lastError: projectAutomationState.lastError,
    lastSummary: projectAutomationState.lastSummary
  });
}));

router.post("/api/projects/automation/run", asyncRoute(async (req, res) => {
  await runProjectAutomationTick({ force: true });

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.automation.run_once",
    resourceType: "project",
    summary: "手动触发自动推进执行一轮"
  });

  res.json({
    enabled: projectAutomationState.enabled,
    intervalMs: projectAutomationState.intervalMs,
    running: projectAutomationState.running,
    lastRunAt: projectAutomationState.lastRunAt,
    lastError: projectAutomationState.lastError,
    lastSummary: projectAutomationState.lastSummary
  });
}));

router.post("/api/projects", asyncRoute(async (req, res) => {
  if (!PROJECT_DIRECT_CREATE_ENABLED) {
    res.status(409).json({
      success: false,
      error: {
        code: "PROJECT_ISSUE_FIRST_REQUIRED",
        message: "当前环境已启用 issue-first 门禁，不允许直接创建项目。请先通过 New Project Issue 流程完成需求确认后再创建。"
      }
    });
    return;
  }

  const description = String(req.body?.description ?? "").trim();

  if (!description) {
    res.status(400).json({ message: "description is required" });
    return;
  }

  const project = await createProject(
    {
      name: req.body?.name,
      description,
      team: req.body?.team
    },
    (await getRuntimeStatus()).mode
  );
  clearProjectAdvanceCancelled(project.id);

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.created",
    resourceType: "project",
    resourceId: project.id,
    summary: `创建项目 ${project.name}`
  });

  const issueFirst = await ensureProjectIssueFirst({ projectId: project.id });
  if (issueFirst.ok) {
    void startProjectWarmupAfterCreate(project).catch((error) => {
      console.warn(
        `[project] async warmup after create failed for ${project.id}:`,
        error instanceof Error ? error.message : String(error)
      );
    });
    kickProjectAutomationTick({ force: true });
  } else {
    console.warn(`[ProjectIssueFirst] project create gated for ${project.id}: ${issueFirst.code} ${issueFirst.message}`);
  }

  res.status(201).json(project);
}));

router.post("/api/projects/:id/advance", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);

  const hasAdvanceLock = projectAdvanceLocks.has(projectId);
  const hasAdvanceJob = projectAdvanceJobs.has(projectId);
  if (hasAdvanceLock || hasAdvanceJob) {
    const recovered = tryRecoverStalledAdvanceJob({
      projectId,
      hasLock: hasAdvanceLock,
      hasJob: hasAdvanceJob,
      ensureManualAdvanceJob,
      projectAdvanceJobs
    });
    const pollAfterMs = nextProjectAdvancePollAfterMs(projectId, recovered);
    res.status(409).json({
      success: false,
      error: {
        code: "PROJECT_ADVANCE_IN_PROGRESS",
        message: recovered
          ? "检测到推进状态长时间未收敛，已自动执行恢复重试，请稍后刷新。"
          : "该项目正在推进中，请稍后刷新。",
        pollAfterMs,
        recoveryAttempted: recovered
      }
    });
    return;
  }

  const project = await findProject(projectId);

  if (!project) {
    resetProjectAdvancePollHint(projectId);
    res.status(404).json({ message: "Project not found" });
    return;
  }

  if (project.status !== "active") {
    resetProjectAdvancePollHint(projectId);
    res.status(409).json({ message: "Project is not active" });
    return;
  }

  const issueFirst = await ensureProjectIssueFirst({ projectId });
  if (!issueFirst.ok) {
    resetProjectAdvancePollHint(projectId);
    res.status(409).json({
      success: false,
      error: {
        code: "PROJECT_ISSUE_FIRST_REQUIRED",
        message: buildProjectIssueFirstMessage(issueFirst)
      }
    });
    return;
  }

  const runtime = await getRuntimeStatus();
  const requiredActions = buildProjectRequiredActions(project, runtime);
  const blockedByUserIntervention = project.pendingApproval;

  if (blockedByUserIntervention) {
    resetProjectAdvancePollHint(projectId);
    const actions = requiredActions.length > 0
      ? requiredActions
      : [{
        id: "review-pending-stage",
        severity: "info" as const,
        title: "当前阶段待你确认",
        detail: "请先执行阶段验收（通过或驳回）后再继续推进。",
        action: "review_pending_stage" as const,
        ctaLabel: "执行阶段验收"
      }];
    res.status(409).json({
      success: false,
      error: {
        code: "REQUIRES_USER_INTERVENTION",
        message: formatRequiredActionsMessage(actions),
        requiredActions: actions
      }
    });
    return;
  }

  const lastJobError = projectAdvanceJobErrors.get(projectId);
  if (lastJobError) {
    projectAdvanceJobErrors.delete(projectId);
    if (lastJobError.message === "PROJECT_ADVANCE_IN_PROGRESS") {
      const recovered = tryRecoverStalledAdvanceJob({
        projectId,
        hasLock: projectAdvanceLocks.has(projectId),
        hasJob: projectAdvanceJobs.has(projectId),
        ensureManualAdvanceJob,
        projectAdvanceJobs
      });
      const pollAfterMs = nextProjectAdvancePollAfterMs(projectId, recovered);
      res.status(409).json({
        success: false,
        error: {
          code: "PROJECT_ADVANCE_IN_PROGRESS",
          message: recovered
            ? "检测到推进状态未收敛，系统已自动执行恢复重试，请稍后刷新。"
            : "该项目正在推进中，请稍后刷新。",
          pollAfterMs,
          recoveryAttempted: recovered
        }
      });
      return;
    }
    const latestProject = await findProject(projectId);
    const latestRuntime = await getRuntimeStatus();
    const latestRequiredActions = latestProject
      ? buildProjectRequiredActions(latestProject, latestRuntime)
      : [];

    if (lastJobError.message.startsWith("DESIGN_REVIEW_REQUIRED:") || lastJobError.message.startsWith("DESIGN_VISUAL_PREVIEW_REQUIRED:")) {
      resetProjectAdvancePollHint(projectId);
      const actions = latestRequiredActions.length > 0
        ? latestRequiredActions
        : [{
          id: "design-review-required",
          severity: "critical" as const,
          title: "设计阶段缺少可确认设计产物",
          detail: "请补充设计审查卡并提供静态图或单页 HTML 视觉稿后再推进。",
          action: "open_design_review" as const,
          ctaLabel: "提交设计审查卡"
        }];
      res.status(409).json({
        success: false,
        error: {
          code: "REQUIRES_USER_INTERVENTION",
          message: formatRequiredActionsMessage(actions),
          requiredActions: actions
        }
      });
      return;
    }

    if (isRecoverableAdvanceFailure(lastJobError.message)) {
      ensureManualAdvanceJob(projectId);
      const pollAfterMs = nextProjectAdvancePollAfterMs(projectId, true);
      res.status(409).json({
        success: false,
        error: {
          code: "PROJECT_ADVANCE_IN_PROGRESS",
          message: `上一轮推进遇到可恢复错误，系统已自动重试：${lastJobError.message}`,
          pollAfterMs
        }
      });
      return;
    }

    resetProjectAdvancePollHint(projectId);
    res.status(409).json({
      success: false,
      error: {
        code: "PROJECT_ADVANCE_FAILED",
        message: `上一轮推进失败：${lastJobError.message}`
      }
    });
    return;
  }

  ensureManualAdvanceJob(projectId);
  const pollAfterMs = nextProjectAdvancePollAfterMs(projectId);
  res.status(409).json({
    success: false,
    error: {
      code: "PROJECT_ADVANCE_IN_PROGRESS",
      message: "已开始推进当前阶段，正在后台生成交付物，请稍后刷新。",
      pollAfterMs
    }
  });
}));

router.post("/api/projects/:id/reconcile-deliverables", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await reconcileProjectDeliverablesNow(projectId);
  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.deliverables_reconciled",
    resourceType: "project",
    resourceId: project.id,
    summary: `重建项目 ${project.id} 交付物内容`
  });
  const runtime = await getRuntimeStatus();
  const requiredActions = buildProjectRequiredActions(project, runtime);
  res.json({
    ...project,
    requiredActions
  });
}));

router.get("/api/projects/:id/template-gate-precheck", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const precheck = await getProjectTemplateGatePrecheck(projectId);
  if (!precheck) {
    res.status(404).json({ message: "Project not found" });
    return;
  }
  res.json(precheck);
}));

router.get("/api/projects/:id/execution-protocol-precheck", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const precheck = await getProjectExecutionProtocolPrecheck(projectId);
  if (!precheck) {
    res.status(404).json({ message: "Project not found" });
    return;
  }
  res.json(precheck);
}));

router.get("/api/projects/:id/lifecycle-quality-audit", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const audit = await getProjectLifecycleQualityAudit(projectId);
  if (!audit) {
    res.status(404).json({ message: "Project not found" });
    return;
  }
  res.json(audit);
}));

router.post("/api/projects/:id/quality-gate/repair-issues", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id || "").trim();
  if (!projectId) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "project id is required"
      }
    });
    return;
  }

  const dryRun = Boolean(req.body?.dryRun);
  const projectPath = String(req.body?.projectPath || "").trim() || undefined;
  const validationCommands = normalizeStringArrayInput(req.body?.validationCommands);
  const result = await buildProjectQualityGateRepairResult({
    projectId,
    dryRun,
    projectPath,
    validationCommands: validationCommands.length > 0
      ? validationCommands
      : QUALITY_GATE_REPAIR_DEFAULT_VALIDATIONS
  });

  if (result.status === "not_found") {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: `Project not found: ${projectId}`
      }
    });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.quality_gate_repair_issues.generated",
    resourceType: "project",
    resourceId: projectId,
    summary: dryRun
      ? `质量门禁修复 issue 预览：${result.blockingStageCount} 个阻断阶段`
      : `质量门禁修复 issue 执行：创建 ${result.created.length} / 复用 ${result.reused.length} / 失败 ${result.failed.length}`,
    detail: `dryRun=${dryRun}; blockingStages=${result.blockingStageCount}`
  });

  res.json({
    success: true,
    data: result
  });
}));

router.post("/api/projects/quality-gate/repair-issues", asyncRoute(async (req, res) => {
  const dryRun = Boolean(req.body?.dryRun);
  const projectPath = String(req.body?.projectPath || "").trim() || undefined;
  const includeHistorical = req.body?.includeHistorical !== false;
  const limit = parseRepairLimit(req.body?.limit);
  const validationCommands = normalizeStringArrayInput(req.body?.validationCommands);
  const selectedProjectIds = Array.from(new Set(normalizeStringArrayInput(req.body?.projectIds)));
  const statusFilter = normalizeStatusFilter(req.body?.statuses);

  const projects = await listProjects();
  const summaryById = new Map(projects.map((item) => [item.id, item]));

  let targetProjectIds: string[];
  if (selectedProjectIds.length > 0) {
    targetProjectIds = selectedProjectIds.filter((id) => summaryById.has(id));
  } else {
    const statusSet = statusFilter.size > 0
      ? statusFilter
      : includeHistorical
        ? null
        : new Set(["active", "blocked"]);
    targetProjectIds = projects
      .filter((item) => !statusSet || statusSet.has(item.status))
      .map((item) => item.id);
  }

  if (targetProjectIds.length > limit) {
    targetProjectIds = targetProjectIds.slice(0, limit);
  }

  const results: Array<Awaited<ReturnType<typeof buildProjectQualityGateRepairResult>>> = [];
  for (const projectId of targetProjectIds) {
    const item = await buildProjectQualityGateRepairResult({
      projectId,
      dryRun,
      projectPath,
      validationCommands: validationCommands.length > 0
        ? validationCommands
        : QUALITY_GATE_REPAIR_DEFAULT_VALIDATIONS
    });
    results.push(item);
  }

  const totals = results.reduce((acc, item) => {
    acc.processed += 1;
    acc.blockingStages += item.blockingStageCount;
    acc.created += item.created.length;
    acc.reused += item.reused.length;
    acc.failed += item.failed.length;
    if (item.status === "not_found" || item.status === "audit_unavailable") {
      acc.skipped += 1;
    } else if (item.blockingStageCount === 0) {
      acc.noBlocking += 1;
    } else {
      acc.withBlocking += 1;
    }
    return acc;
  }, {
    processed: 0,
    withBlocking: 0,
    noBlocking: 0,
    skipped: 0,
    blockingStages: 0,
    created: 0,
    reused: 0,
    failed: 0
  });

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.quality_gate_repair_issues.batch_generated",
    resourceType: "project",
    summary: dryRun
      ? `批量质量门禁修复 issue 预览：项目 ${totals.processed} 个，阻断阶段 ${totals.blockingStages} 个`
      : `批量质量门禁修复 issue 执行：创建 ${totals.created} / 复用 ${totals.reused} / 失败 ${totals.failed}`,
    detail: `dryRun=${dryRun}; includeHistorical=${includeHistorical}; requested=${targetProjectIds.length}; limit=${limit}`
  });

  res.json({
    success: true,
    data: {
      dryRun,
      includeHistorical,
      limit,
      requestedProjects: targetProjectIds.length,
      processedProjects: totals.processed,
      totals,
      projects: results
    }
  });
}));

router.get("/api/projects/:id", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId);

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  const runtime = await getRuntimeStatus();
  const requiredActions = buildProjectRequiredActions(project, runtime);
  res.json({
    ...project,
    requiredActions
  });
}));

router.get("/api/projects/:id/executions", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId);
  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  const limitInput = Number(req.query.limit ?? 120);
  const limit = Number.isFinite(limitInput) ? Math.max(1, Math.min(500, Math.round(limitInput))) : 120;
  const executions = await listProjectExecutions(projectId, limit);

  res.json({
    success: true,
    data: {
      projectId,
      total: executions.length,
      executions
    }
  });
}));

router.get("/api/projects/:id/acceptance-report", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId);

  if (!project) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Project not found"
      }
    });
    return;
  }

  const executions = await listProjectExecutions(projectId, 200);
  const lifecycleAudit = await getProjectLifecycleQualityAudit(projectId);
  const report = buildProjectAcceptanceReport(project, { executions, lifecycleAudit });
  res.json({
    success: true,
    data: report
  });
}));

router.get("/api/projects/:id/acceptance-report.md", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId);

  if (!project) {
    res.status(404).type("text/plain; charset=utf-8").send("Project not found");
    return;
  }

  const executions = await listProjectExecutions(projectId, 200);
  const lifecycleAudit = await getProjectLifecycleQualityAudit(projectId);
  const report = buildProjectAcceptanceReport(project, { executions, lifecycleAudit });
  const markdown = renderAcceptanceReportMarkdown(report);

  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=\"acceptance-report-${project.id}.md\"`
  );
  res.send(markdown);
}));

router.post("/api/projects/:id/acceptance-report/archive", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId);

  if (!project) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Project not found"
      }
    });
    return;
  }

  const executions = await listProjectExecutions(projectId, 200);
  const lifecycleAudit = await getProjectLifecycleQualityAudit(projectId);
  const report = buildProjectAcceptanceReport(project, { executions, lifecycleAudit });
  const force = Boolean(req.body?.force);
  if (!force && report.qualityGate && !report.qualityGate.pass) {
    res.status(422).json({
      success: false,
      error: {
        code: "ACCEPTANCE_QUALITY_GATE_BLOCKED",
        message: `验收报告质量门禁未通过（阻断阶段 ${report.qualityGate.blockingStageCount} 项），禁止归档。`,
        qualityGate: report.qualityGate
      }
    });
    return;
  }
  const markdown = renderAcceptanceReportMarkdown(report);
  const title = String(req.body?.title ?? "").trim() || undefined;
  const updated = await archiveProjectAcceptanceReport(projectId, markdown, title);

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.acceptance_report.archived",
    resourceType: "project",
    resourceId: projectId,
    summary: `项目 ${projectId} 验收报告已归档`
  });

  res.json({
    success: true,
    data: {
      projectId,
      archived: true,
      deliverableName: title || `阶段验收报告-${new Date().toISOString().slice(0, 10)}.md`,
      updated
    }
  });
}));

router.get("/api/projects/:id/final-artifacts", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId);

  if (!project) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Project not found"
      }
    });
    return;
  }

  const autoGenerate = String(req.query.generate ?? "auto").toLowerCase() !== "false";
  let activeJob = getLatestFinalArtifactsJob(projectId);
  if (project.status === "completed" && autoGenerate && (!activeJob || activeJob.status === "failed")) {
    activeJob = startFinalArtifactsGenerationJob(projectId, {
      force: activeJob?.status === "failed"
    });
  }

  const report = activeJob?.status === "completed" && activeJob.report
    ? activeJob.report
    : buildProjectFinalArtifactsReport(
      project,
      activeJob?.officialSite,
      await listProjectExecutions(projectId, 80)
    );

  res.json({
    success: true,
    data: attachFinalArtifactsGeneration(report, activeJob)
  });
}));

router.post("/api/projects/:id/final-artifacts/generate", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId);
  if (!project) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Project not found"
      }
    });
    return;
  }

  const force = Boolean(req.body?.force);
  const job = startFinalArtifactsGenerationJob(projectId, { force });
  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.final_artifacts.generate",
    resourceType: "project",
    resourceId: projectId,
    summary: `触发项目 ${projectId} 最终产物异步生成任务 ${job.jobId}`
  });

  res.json({
    success: true,
    data: {
      projectId,
      queued: true,
      generation: toFinalArtifactsJobProgress(job)
    }
  });
}));

router.get("/api/projects/:id/final-artifacts/job", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId);
  if (!project) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Project not found"
      }
    });
    return;
  }

  const latest = getLatestFinalArtifactsJob(projectId);
  if (!latest) {
    res.json({
      success: true,
      data: {
        projectId,
        generation: null
      }
    });
    return;
  }

  res.json({
    success: true,
    data: {
      projectId,
      generation: toFinalArtifactsJobProgress(latest),
      report: latest.status === "completed" ? latest.report : undefined
    }
  });
}));

router.get("/api/projects/:id/final-artifacts/jobs/:jobId", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const jobId = String(req.params.jobId);
  const project = await findProject(projectId);
  if (!project) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Project not found"
      }
    });
    return;
  }

  const job = finalArtifactsJobsById.get(jobId);
  if (!job || job.projectId !== projectId) {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Final artifacts job not found"
      }
    });
    return;
  }

  res.json({
    success: true,
    data: {
      projectId,
      generation: toFinalArtifactsJobProgress(job),
      report: job.status === "completed" ? job.report : undefined
    }
  });
}));

router.get("/api/projects/:id/official-site", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId);

  if (!project) {
    res.status(404).json({ message: "project not found" });
    return;
  }

  if (project.status !== "completed") {
    res.status(409).json({ message: "project is not completed yet" });
    return;
  }

  const artifact = await generateOfficialSiteArtifact(project);
  const publicPath = String(artifact.publicPath || "").trim();
  const absoluteUrl = /^https?:\/\//i.test(publicPath)
    ? publicPath
    : `${req.protocol}://${req.get("host")}${publicPath.startsWith("/") ? publicPath : `/${publicPath}`}`;
  res.json({
    success: true,
    data: {
      projectId,
      kind: artifact.kind,
      url: absoluteUrl,
      publicPath,
      sourceDeliverableName: artifact.sourceDeliverableName,
      files: artifact.filePaths
    }
  });
}));

router.get("/api/projects/:id/tasks", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  res.json(await listProjectTasks(projectId));
}));

router.get("/api/tasks", asyncRoute(async (req, res) => {
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
  const assignee = typeof req.query.assignee === "string" ? req.query.assignee.trim() : "";

  if (projectId) {
    const scopedTasks = await listProjectTasks(projectId);
    res.json(scopedTasks.filter((task) => {
      if (status && task.status !== status) {
        return false;
      }
      if (assignee && task.assignee !== assignee) {
        return false;
      }
      return true;
    }));
    return;
  }

  const tasks = await listTasks();
  res.json(tasks.filter((task) => {
    if (status && task.status !== status) {
      return false;
    }
    if (assignee && task.assignee !== assignee) {
      return false;
    }
    return true;
  }));
}));

router.post("/api/projects/:id/approve", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const current = await findProject(projectId);
  if (!current) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  if (!current.pendingApproval) {
    const runtime = await getRuntimeStatus();
    const requiredActions = buildProjectRequiredActions(current, runtime);
    res.status(409).json({
      success: false,
      error: {
        code: "NO_PENDING_APPROVAL",
        message: requiredActions.length > 0
          ? formatRequiredActionsMessage(requiredActions)
          : "当前阶段没有待确认事项，无需执行审批。",
        requiredActions
      }
    });
    return;
  }

  let project;
  try {
    project = await approveProject(projectId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "approve failed";
    if (message.startsWith("REAL_MODEL_GATE_FAILED:")) {
      const runtime = await getRuntimeStatus();
      const requiredActions = buildProjectRequiredActions(current, runtime);
      const recovery = buildRealModelGateRecoveryActions({
        project: current,
        requiredActions
      });
      res.status(422).json({
        success: false,
        error: {
          code: "REAL_MODEL_GATE_FAILED",
          message: message.replace("REAL_MODEL_GATE_FAILED:", "").trim(),
          requiredActions: recovery.requiredActions,
          recoveryPlan: recovery.recoveryPlan
        }
      });
      return;
    }
    if (message.startsWith("DESIGN_REVIEW_NOT_APPROVED:")) {
      res.status(422).json({ message: message.replace("DESIGN_REVIEW_NOT_APPROVED:", "").trim() });
      return;
    }
    if (message.startsWith("DESIGN_VISUAL_PREVIEW_REQUIRED:")) {
      res.status(422).json({ message: message.replace("DESIGN_VISUAL_PREVIEW_REQUIRED:", "").trim() });
      return;
    }
    if (message.startsWith("STAGE_TEMPLATE_VALIDATION_FAILED:")) {
      const templateGatePrecheck = await getProjectTemplateGatePrecheck(projectId);
      const autoReconcileEnabled = process.env.NODE_ENV !== "test";
      if (autoReconcileEnabled) {
        // 自动触发一次交付物补齐，避免用户反复手动点击验收。
        void reconcileProjectDeliverablesNow(projectId).catch((reconcileError) => {
          console.warn("Auto reconcile after template validation failed:", reconcileError);
        });
      }
      res.status(422).json({
        success: false,
        error: {
          code: "STAGE_TEMPLATE_VALIDATION_FAILED",
          message: autoReconcileEnabled
            ? `${message.replace("STAGE_TEMPLATE_VALIDATION_FAILED:", "").trim()}（已自动触发交付物补齐，请稍后重试验收）`
            : message.replace("STAGE_TEMPLATE_VALIDATION_FAILED:", "").trim(),
          templateGatePrecheck
        }
      });
      return;
    }
    if (message.startsWith("EXECUTION_PROTOCOL_GATE_FAILED:")) {
      const protocolGatePrecheck = await getProjectExecutionProtocolPrecheck(projectId);
      const rawProtocolMessage = message.replace("EXECUTION_PROTOCOL_GATE_FAILED:", "").trim();
      res.status(422).json({
        success: false,
        error: {
          code: "EXECUTION_PROTOCOL_GATE_FAILED",
          message: formatTerminalCollaborationViolation(rawProtocolMessage) || rawProtocolMessage,
          rawMessage: rawProtocolMessage,
          protocolGatePrecheck
        }
      });
      return;
    }
    throw error;
  }

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.approved",
    resourceType: "project",
    resourceId: project.id,
    summary: `批准项目阶段 ${project.currentStage}`
  });
  void trySyncGitLabHarness({
    projectId: project.id,
    stageType: project.currentStage,
    closeOnComplete: project.status === "completed",
    reason: "project.approve"
  });
  kickProjectAutomationTick({ force: true });
  res.json(project);
}));

router.post("/api/projects/:id/reject", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const current = await findProject(projectId);
  if (!current) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  if (!current.pendingApproval) {
    const runtime = await getRuntimeStatus();
    const requiredActions = buildProjectRequiredActions(current, runtime);
    res.status(409).json({
      success: false,
      error: {
        code: "NO_PENDING_APPROVAL",
        message: requiredActions.length > 0
          ? formatRequiredActionsMessage(requiredActions)
          : "当前阶段没有待确认事项，无需驳回。",
        requiredActions
      }
    });
    return;
  }

  const payload = req.body as StageRejectInput;
  const reason = String(payload?.reason ?? "").trim();

  if (!reason) {
    res.status(400).json({ message: "reason is required" });
    return;
  }

  const project = await rejectProjectStage(projectId, { reason });

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.rejected",
    resourceType: "project",
    resourceId: project.id,
    summary: `退回项目阶段 ${project.currentStage}`,
    detail: reason
  });
  void trySyncGitLabHarness({
    projectId: project.id,
    stageType: project.currentStage,
    reason: "project.reject"
  });
  res.json(project);
}));

router.post("/api/projects/:id/intervene", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const payload = req.body as InterventionInput;
  const command = String(payload?.command ?? "").trim();

  if (!command) {
    res.status(400).json({ message: "command is required" });
    return;
  }

  const project = await interveneProject(projectId, command);

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.intervened",
    resourceType: "project",
    resourceId: project.id,
    summary: `项目 ${project.id} 已被人工介入`,
    detail: command
  });
  void trySyncGitLabHarness({
    projectId: project.id,
    stageType: project.currentStage,
    reason: "project.intervene"
  });
  res.json(project);
}));

router.post("/api/projects/:id/resume", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await resumeProject(projectId);

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.resumed",
    resourceType: "project",
    resourceId: project.id,
    summary: `项目 ${project.id} 已恢复执行`
  });
  kickProjectAutomationTick({ force: true });
  void trySyncGitLabHarness({
    projectId: project.id,
    stageType: project.currentStage,
    reason: "project.resume"
  });
  res.json(project);
}));

router.post("/api/projects/:id/close", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await closeProject(projectId);

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.closed",
    resourceType: "project",
    resourceId: project.id,
    summary: `项目 ${project.id} 已关闭`
  });
  void trySyncGitLabHarness({
    projectId: project.id,
    stageType: project.currentStage,
    closeOnComplete: true,
    reason: "project.close"
  });
  res.json(project);
}));

router.delete("/api/projects/:id", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  markProjectAdvanceCancelled(projectId);
  const deleted = await deleteProject(projectId);

  if (!deleted) {
    clearProjectAdvanceCancelled(projectId);
    res.status(404).json({ message: "Project not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.deleted",
    resourceType: "project",
    resourceId: projectId,
    summary: `项目 ${projectId} 已删除`
  });

  projectAdvanceJobErrors.delete(projectId);
  projectAdvanceJobs.delete(projectId);
  projectAdvanceLocks.delete(projectId);

  res.json({ success: true, id: projectId });
}));

router.post("/api/projects/:id/stages/submit", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const payload = req.body as StageSubmissionInput;
  const content = String(payload?.content ?? "").trim();
  const finalizeApproval =
    typeof req.body?.finalizeApproval === "boolean"
      ? req.body.finalizeApproval
      : !/设计审查卡/i.test(String(payload?.title || ""));

  if (!content) {
    res.status(400).json({ message: "content is required" });
    return;
  }

  let project;
  try {
    project = await submitCurrentStage(projectId, {
      title: payload?.title,
      content,
      designReview: payload?.designReview
    }, {
      finalizeApproval
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "submit failed";
    if (message.startsWith("DESIGN_REVIEW_REQUIRED:")) {
      res.status(422).json({ message: message.replace("DESIGN_REVIEW_REQUIRED:", "").trim() });
      return;
    }
    if (message.startsWith("DESIGN_REVIEW_NOT_APPROVED:")) {
      res.status(422).json({ message: message.replace("DESIGN_REVIEW_NOT_APPROVED:", "").trim() });
      return;
    }
    if (message.startsWith("DESIGN_VISUAL_PREVIEW_REQUIRED:")) {
      res.status(422).json({ message: message.replace("DESIGN_VISUAL_PREVIEW_REQUIRED:", "").trim() });
      return;
    }
    if (message.startsWith("STAGE_TEMPLATE_VALIDATION_FAILED:")) {
      res.status(422).json({
        success: false,
        error: {
          code: "STAGE_TEMPLATE_VALIDATION_FAILED",
          message: message.replace("STAGE_TEMPLATE_VALIDATION_FAILED:", "").trim()
        }
      });
      return;
    }
    throw error;
  }

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.stage_submitted",
    resourceType: "project",
    resourceId: project.id,
    summary: `提交项目 ${project.id} 当前阶段交付物`
  });
  void trySyncGitLabHarness({
    projectId: project.id,
    stageType: project.currentStage,
    reason: "project.stage_submit"
  });
  res.json(project);
}));

router.post("/api/projects/:id/messages", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const payload = req.body as ProjectMessageInput;
  const message = String(payload?.message ?? "").trim();

  if (!message) {
    res.status(400).json({ message: "message is required" });
    return;
  }

  const project = await postProjectMessage(projectId, { message });

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.message_sent",
    resourceType: "project",
    resourceId: project.id,
    summary: `向项目 ${project.id} 发送指导`,
    detail: message
  });
  res.json(project);
}));

router.patch("/api/tasks/:taskId", asyncRoute(async (req, res) => {
  const taskId = String(req.params.taskId);
  const payload = req.body as TaskUpdateInput;
  const status = payload?.status;

  if (!status) {
    res.status(400).json({ message: "status is required" });
    return;
  }

  let task;
  try {
    task = await updateTaskStatus(taskId, status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "task update failed";
    if (message === "TASK_PENDING_DELEGATIONS") {
      res.status(409).json({
        success: false,
        error: {
          code: "TASK_PENDING_DELEGATIONS",
          message: "当前任务仍有未完成 delegation，不能直接标记为完成。"
        }
      });
      return;
    }
    if (message.startsWith("TASK_BLOCKED_BY_DEPENDENCIES:")) {
      res.status(409).json({
        success: false,
        error: {
          code: "TASK_BLOCKED_BY_DEPENDENCIES",
          message: "当前任务仍受 blocks 依赖限制，需先完成依赖任务后再推进。",
          dependsOnTaskId: message.replace("TASK_BLOCKED_BY_DEPENDENCIES:", "").trim() || undefined
        }
      });
      return;
    }
    throw error;
  }

  if (!task) {
    res.status(404).json({ message: "Task not found" });
    return;
  }

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "task.updated",
    resourceType: "task",
    resourceId: task.id,
    summary: `任务 ${task.id} 状态更新为 ${task.status}`
  });
  void trySyncGitLabHarness({
    projectId: task.projectId,
    stageType: task.stageType,
    reason: "task.update"
  });
  if (task.status === "pending_approval") {
    void publishTaskIssueNote({
      taskId: task.id,
      body: "任务已进入待审批状态，等待人工审批/验收结果。"
    }).catch(() => undefined);
  }
  if (task.status === "blocked" && task.blockedReason?.detail) {
    void publishTaskIssueNote({
      taskId: task.id,
      body: `任务进入阻塞状态：${task.blockedReason.detail}`
    }).catch(() => undefined);
  }
  void syncTaskStatus(task.id).catch(() => undefined);
  res.json(task);
}));
router.get("/api/projects/:id/live", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const project = await findProject(projectId);

  if (!project) {
    res.status(404).end();
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const fragments = splitScript(project.liveSession.body, 18);
  let index = 0;

  sendEvent(res, "session", {
    title: project.liveSession.title,
    activeRole: project.liveSession.activeRole,
    startedAt: project.liveSession.startedAt,
    provider: project.liveSession.provider
  });

  const interval = setInterval(async () => {
    const currentProject = await findProject(projectId);

    if (!currentProject) {
      clearInterval(interval);
      res.end();
      return;
    }

    if (currentProject.status === "paused") {
      sendEvent(res, "system", {
        title: "项目已暂停",
        content: "等待你的进一步指令。"
      });
      return;
    }

    if (index >= fragments.length) {
      sendEvent(res, "heartbeat", { done: true, timestamp: new Date().toISOString() });
      clearInterval(interval);
      return;
    }

    const delta = fragments[index];
    sendEvent(res, "agent_typing", {
      delta,
      activeRole: currentProject.liveSession.activeRole,
      timestamp: new Date().toISOString()
    });

    if (index === Math.floor(fragments.length / 2)) {
      sendEvent(res, "thinking_step", {
        content: "Agent 已完成半程推演，正在收敛结构与结论。",
        activeRole: currentProject.liveSession.activeRole
      });
    }

    index += 1;
  }, 600);

  req.on("close", () => {
    clearInterval(interval);
    res.end();
  });
}));

  return router;
}
