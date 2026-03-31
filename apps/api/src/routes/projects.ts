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
  updateTaskStatus
} from "../data/repository.js";
import { getRuntimeStatus } from "../agents/runtime.js";
import { previewRequirement } from "../utils/project-parser.js";
import { generateOfficialSiteArtifact } from "../utils/official-site.js";

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
};

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
  kickProjectAutomationTick: () => void;
  projectAdvanceLocks: Set<string>;
  projectAdvanceJobs: Map<string, Promise<void>>;
  projectAdvanceJobErrors: Map<string, { message: string; at: string }>;
  ensureManualAdvanceJob: (projectId: string) => void;
  buildProjectRequiredActions: (project: any, runtime: any) => ProjectRequiredAction[];
  formatRequiredActionsMessage: (actions: ProjectRequiredAction[]) => string;
  buildProjectAcceptanceReport: (project: any) => any;
  renderAcceptanceReportMarkdown: (report: any) => string;
  getLatestFinalArtifactsJob: (projectId: string) => any;
  startFinalArtifactsGenerationJob: (projectId: string, options?: { force?: boolean }) => any;
  buildProjectFinalArtifactsReport: (project: any, officialSite?: any) => any;
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

  await safeAudit(req, res, {
    actorType: "admin",
    actorLabel: "管理员",
    action: "project.created",
    resourceType: "project",
    resourceId: project.id,
    summary: `创建项目 ${project.name}`
  });
  kickProjectAutomationTick();
  res.status(201).json(project);
}));

router.post("/api/projects/:id/advance", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);

  if (projectAdvanceLocks.has(projectId) || projectAdvanceJobs.has(projectId)) {
    res.status(409).json({
      success: false,
      error: {
        code: "PROJECT_ADVANCE_IN_PROGRESS",
        message: "该项目正在推进中，请稍后刷新。",
        pollAfterMs: 2000
      }
    });
    return;
  }

  const project = await findProject(projectId);

  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return;
  }

  if (project.status !== "active") {
    res.status(409).json({ message: "Project is not active" });
    return;
  }

  const runtime = await getRuntimeStatus();
  const requiredActions = buildProjectRequiredActions(project, runtime);
  const blockedByUserIntervention = project.pendingApproval;

  if (blockedByUserIntervention) {
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
      res.status(409).json({
        success: false,
        error: {
          code: "PROJECT_ADVANCE_IN_PROGRESS",
          message: "该项目正在推进中，请稍后刷新。",
          pollAfterMs: 2000
        }
      });
      return;
    }
    const latestProject = await findProject(projectId);
    const latestRuntime = await getRuntimeStatus();
    const latestRequiredActions = latestProject
      ? buildProjectRequiredActions(latestProject, latestRuntime)
      : [];

    if (lastJobError.message.startsWith("DESIGN_REVIEW_REQUIRED:")) {
      const actions = latestRequiredActions.length > 0
        ? latestRequiredActions
        : [{
          id: "design-review-required",
          severity: "critical" as const,
          title: "设计阶段缺少设计审查卡",
          detail: "请补充设计审查卡后再推进。",
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
  res.status(409).json({
    success: false,
    error: {
      code: "PROJECT_ADVANCE_IN_PROGRESS",
      message: "已开始推进当前阶段，正在后台生成交付物，请稍后刷新。",
      pollAfterMs: 2000
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

  const report = buildProjectAcceptanceReport(project);
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

  const report = buildProjectAcceptanceReport(project);
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

  const report = buildProjectAcceptanceReport(project);
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
    : buildProjectFinalArtifactsReport(project, activeJob?.officialSite);

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
  res.json({
    success: true,
    data: {
      projectId,
      url: artifact.publicPath,
      files: artifact.filePaths
    }
  });
}));

router.get("/api/projects/:id/tasks", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  res.json(await listProjectTasks(projectId));
}));

router.get("/api/tasks", asyncRoute(async (_req, res) => {
  res.json(await listTasks());
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
      const runtimeRepairAction = {
        id: "real-model-gate-repair",
        severity: "critical" as const,
        title: "当前阶段未通过真实模型门禁",
        detail: "请修复模型通道（API Key / Base URL / 可用模型）并重新执行本阶段，再进行验收。",
        action: "refresh_runtime" as const,
        ctaLabel: "修复模型通道"
      };
      const hasRuntimeRepairAction = requiredActions.some((item) => item.action === "refresh_runtime");
      const normalizedRequiredActions = hasRuntimeRepairAction
        ? requiredActions
        : [runtimeRepairAction, ...requiredActions];
      res.status(422).json({
        success: false,
        error: {
          code: "REAL_MODEL_GATE_FAILED",
          message: message.replace("REAL_MODEL_GATE_FAILED:", "").trim(),
          requiredActions: normalizedRequiredActions
        }
      });
      return;
    }
    if (message.startsWith("DESIGN_REVIEW_NOT_APPROVED:")) {
      res.status(422).json({ message: message.replace("DESIGN_REVIEW_NOT_APPROVED:", "").trim() });
      return;
    }
    if (message.startsWith("STAGE_TEMPLATE_VALIDATION_FAILED:")) {
      const templateGatePrecheck = await getProjectTemplateGatePrecheck(projectId);
      // 自动触发一次交付物补齐，避免用户反复手动点击验收。
      void reconcileProjectDeliverablesNow(projectId).catch((reconcileError) => {
        console.warn("Auto reconcile after template validation failed:", reconcileError);
      });
      res.status(422).json({
        success: false,
        error: {
          code: "STAGE_TEMPLATE_VALIDATION_FAILED",
          message: `${message.replace("STAGE_TEMPLATE_VALIDATION_FAILED:", "").trim()}（已自动触发交付物补齐，请稍后重试验收）`,
          templateGatePrecheck
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
  kickProjectAutomationTick();
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
  res.json(project);
}));

router.delete("/api/projects/:id", asyncRoute(async (req, res) => {
  const projectId = String(req.params.id);
  const deleted = await deleteProject(projectId);

  if (!deleted) {
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

  const task = await updateTaskStatus(taskId, status);

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
