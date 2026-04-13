import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import express from "express";
import request from "supertest";
import { snapshotSqliteSeedDatabase } from "../test/sqlite-snapshot.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRoot = path.resolve(__dirname, "../../");
const seedDbPath = path.join(apiRoot, "prisma/dev.db");
const migrationPaths = [
  path.join(apiRoot, "prisma/migrations/20260411103000_add_knowledge_workflow_v2/migration.sql"),
  path.join(apiRoot, "prisma/migrations/20260411124500_add_knowledge_operation_logs/migration.sql"),
  path.join(apiRoot, "prisma/migrations/20260411193000_add_hermes_skill_sync/migration.sql"),
  path.join(apiRoot, "prisma/migrations/20260411205000_add_mixed_project_mode/migration.sql")
];

const tempDir = mkdtempSync(path.join(os.tmpdir(), "occ-api-issues-workflow-link-"));
const dbPath = path.join(tempDir, "test.db");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = `file:${dbPath}`;
process.env.MODEL_PROVIDER = "openai-compatible";
process.env.MODEL_API_BASE_URL = "https://example.com/v1";
process.env.MODEL_API_KEY = "test-key";
process.env.MODEL_NAME = "gpt-4o-mini";
process.env.PROJECT_AUTO_ADVANCE = "false";
process.env.PROJECT_WARMUP = "false";
process.env.ENFORCE_REAL_MODEL_GATE = "false";
process.env.PROJECT_WORKFLOW_V2_AUTO_INIT = "true";
process.env.PROJECT_WORKFLOW_V2_AUTO_START = "true";
process.env.WORKFLOW_V2_AGENT_AUTO_EXECUTE = "false";
process.env.WORKFLOW_V2_STAGE_AUTO_PROCEED = "false";

let prismaClient: any;
let app: express.Express;
let updateIssueFn: any;
let upsertTemplateFn: any;

before(async () => {
  snapshotSqliteSeedDatabase({
    seedDbPath,
    dbPath,
    cwd: apiRoot
  });
  for (const migrationPath of migrationPaths) {
    try {
      execSync(`sqlite3 ${JSON.stringify(dbPath)} < ${JSON.stringify(migrationPath)}`, {
        cwd: apiRoot,
        stdio: "pipe"
      });
    } catch {
      // Ignore idempotent replay errors when seed DB already contains newer schema columns.
    }
  }

  const [dbMod, issuesMod, storeMod, workflowMod] = await Promise.all([
    import("../db.js"),
    import("./issues.js"),
    import("../system/v1-method-store.js"),
    import("../workflow-v2/workflow-orchestrator.js")
  ]);
  prismaClient = dbMod.prisma;
  updateIssueFn = storeMod.updateIssue;
  upsertTemplateFn = workflowMod.upsertWorkflowTemplate;

  await upsertTemplateFn({
    key: "requirements_design",
    name: "需求设计",
    category: "pm",
    executorConfig: {
      type: "agent",
      agentRole: "Product_Manager",
      requiredCapabilities: ["prd_writing"]
    },
    inputSchema: {},
    outputSchema: {},
    acceptanceCriteria: [],
    integrationConfig: {},
    defaultTimeout: 120,
    allowParallel: false
  });

  app = express();
  app.use(express.json());
  app.use("/api/issues", issuesMod.createIssuesRouter());
});

after(async () => {
  if (prismaClient) {
    await prismaClient.$disconnect();
  }
  rmSync(tempDir, { recursive: true, force: true });
});

test("issues preview should adapt artifacts and SOP by workflow template", async () => {
  const visualRes = await request(app)
    .post("/api/issues/preview")
    .send({
      input: "我需要先完成视觉设计阶段，产出可以评审的页面原型。",
      industryCode: "saas",
      sourceType: "text",
      debateMode: "off",
      workflowTemplateKey: "visual_design"
    });

  assert.equal(visualRes.status, 200);
  assert.equal(visualRes.body.success, true);
  const visualArtifacts = Array.isArray(visualRes.body.data.expectedArtifacts)
    ? visualRes.body.data.expectedArtifacts as Array<{ id: string; ownerRoleId: string }>
    : [];
  assert.equal(visualArtifacts.length >= 2, true);
  assert.equal(visualArtifacts.some((item) => item.id === "artifact-design-review"), true);
  assert.equal(visualArtifacts.some((item) => item.id === "artifact-visual-preview"), true);
  assert.equal(visualArtifacts.every((item) => item.ownerRoleId === "ROLE_DESIGN"), true);
  const visualWorkflowSteps = Array.isArray(visualRes.body.data.workflow?.steps)
    ? visualRes.body.data.workflow.steps as Array<{ roleId: string }>
    : [];
  assert.equal(visualWorkflowSteps.length >= 2, true);
  assert.equal(visualWorkflowSteps.some((step) => step.roleId === "ROLE_ANALYST"), true);
  assert.equal(visualWorkflowSteps.some((step) => step.roleId === "ROLE_DESIGN"), true);
  assert.equal(
    visualWorkflowSteps.every((step) => step.roleId === "ROLE_ANALYST" || step.roleId === "ROLE_DESIGN"),
    true
  );
  const visualRecommendedRoles = Array.isArray(visualRes.body.data.recommendedRoleIds)
    ? visualRes.body.data.recommendedRoleIds as string[]
    : [];
  assert.equal(visualRecommendedRoles.includes("ROLE_ANALYST"), true);
  assert.equal(visualRecommendedRoles.includes("ROLE_DESIGN"), true);
  assert.equal(
    visualRecommendedRoles.every((roleId) => roleId === "ROLE_ANALYST" || roleId === "ROLE_DESIGN"),
    true
  );

  const qaRes = await request(app)
    .post("/api/issues/preview")
    .send({
      input: "当前代码已完成，下一步进入 QA 验收与回归。",
      industryCode: "saas",
      sourceType: "text",
      debateMode: "off",
      workflowTemplateKey: "qa_acceptance"
    });

  assert.equal(qaRes.status, 200);
  assert.equal(qaRes.body.success, true);
  const qaArtifacts = Array.isArray(qaRes.body.data.expectedArtifacts)
    ? qaRes.body.data.expectedArtifacts as Array<{ id: string; ownerRoleId: string }>
    : [];
  assert.equal(qaArtifacts.some((item) => item.id === "artifact-test-plan"), true);
  assert.equal(qaArtifacts.some((item) => item.id === "artifact-test-report"), true);
  assert.equal(qaArtifacts.every((item) => item.ownerRoleId === "ROLE_QA"), true);
  const qaWorkflowSteps = Array.isArray(qaRes.body.data.workflow?.steps)
    ? qaRes.body.data.workflow.steps as Array<{ roleId: string }>
    : [];
  assert.equal(qaWorkflowSteps.length >= 2, true);
  assert.equal(qaWorkflowSteps.some((step) => step.roleId === "ROLE_ANALYST"), true);
  assert.equal(qaWorkflowSteps.some((step) => step.roleId === "ROLE_QA"), true);
  assert.equal(
    qaWorkflowSteps.every((step) => step.roleId === "ROLE_ANALYST" || step.roleId === "ROLE_QA"),
    true
  );

  const noneRes = await request(app)
    .post("/api/issues/preview")
    .send({
      input: "当前仅需创建项目，不自动初始化任何 workflow。",
      industryCode: "saas",
      sourceType: "text",
      debateMode: "off",
      workflowTemplateKey: "none"
    });

  assert.equal(noneRes.status, 200);
  assert.equal(noneRes.body.success, true);
  assert.equal(Array.isArray(noneRes.body.data.expectedArtifacts), true);
  assert.equal((noneRes.body.data.expectedArtifacts as unknown[]).length, 0);
  assert.equal(noneRes.body.data.workflow, null);
});

test("issues confirm can pass workflow template fields and auto-link workflow-v2", async () => {
  const previewRes = await request(app)
    .post("/api/issues/preview")
    .send({
      input: "请帮我做一个知识库与项目协作平台，要求支持阶段化执行和质量门禁。",
      industryCode: "saas",
      sourceType: "text",
      debateMode: "off"
    });

  assert.equal(previewRes.status, 200);
  assert.equal(previewRes.body.success, true);
  const issueId = String(previewRes.body.data.issueId);
  assert.ok(issueId);

  await updateIssueFn(issueId, (current: Record<string, any>) => ({
    ...current,
    debateStatus: "completed",
    debateTaskId: current.debateTaskId || `debate-${issueId}`,
    debateError: "",
    debateUpdatedAt: new Date().toISOString(),
    debate: {
      mode: "model",
      generatedAt: new Date().toISOString(),
      consensus: ["需求目标一致"],
      divergences: [],
      opinions: []
    }
  }));

  const requiredQuestions = (previewRes.body.data.questions as Array<{ id: string; required?: boolean }>)
    .filter((item) => item.required)
    .reduce<Record<string, string>>((acc, item) => {
      acc[item.id] = "已确认";
      return acc;
    }, {});

  const confirmRes = await request(app)
    .post(`/api/issues/${issueId}/confirm`)
    .send({
      finalName: "Issue Confirm Workflow Link",
      finalDescription: "确认后应自动初始化 workflow-v2",
      clarificationAnswers: requiredQuestions,
      conflictResolution: "按当前边界推进。",
      workflowTemplateKey: "requirements_design",
      autoStartWorkflow: true
    });

  assert.equal(confirmRes.status, 200);
  assert.equal(confirmRes.body.success, true);
  const projectId = String(confirmRes.body.data.project?.id || "");
  assert.ok(projectId);

  const workflow = await prismaClient.workflow.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: {
      stages: true,
      template: true
    }
  });
  assert.ok(workflow);
  assert.equal(workflow.template?.key, "requirements_design");
  assert.equal(workflow.status, "active");
  assert.equal(Array.isArray(workflow.currentStageIds), true);
  assert.equal((workflow.currentStageIds as unknown[]).length > 0, true);
  assert.equal(Array.isArray(workflow.stages), true);
  assert.equal(workflow.stages.length >= 1, true);
});

test("issues confirm keeps workflowTemplateKey=none and skips workflow-v2 auto-init", async () => {
  const previewRes = await request(app)
    .post("/api/issues/preview")
    .send({
      input: "这个需求暂时只创建项目，不自动编排 workflow。",
      industryCode: "saas",
      sourceType: "text",
      debateMode: "off"
    });

  assert.equal(previewRes.status, 200);
  assert.equal(previewRes.body.success, true);
  const issueId = String(previewRes.body.data.issueId);
  assert.ok(issueId);

  await updateIssueFn(issueId, (current: Record<string, any>) => ({
    ...current,
    debateStatus: "completed",
    debateTaskId: current.debateTaskId || `debate-${issueId}`,
    debateError: "",
    debateUpdatedAt: new Date().toISOString(),
    debate: {
      mode: "model",
      generatedAt: new Date().toISOString(),
      consensus: ["需求目标一致"],
      divergences: [],
      opinions: []
    }
  }));

  const requiredQuestions = (previewRes.body.data.questions as Array<{ id: string; required?: boolean }>)
    .filter((item) => item.required)
    .reduce<Record<string, string>>((acc, item) => {
      acc[item.id] = "已确认";
      return acc;
    }, {});

  const confirmRes = await request(app)
    .post(`/api/issues/${issueId}/confirm`)
    .send({
      finalName: "Issue Confirm None Workflow",
      finalDescription: "确认后只创建项目，不自动初始化 workflow-v2",
      clarificationAnswers: requiredQuestions,
      conflictResolution: "按当前边界推进。",
      workflowTemplateKey: "none",
      autoStartWorkflow: true
    });

  assert.equal(confirmRes.status, 200);
  assert.equal(confirmRes.body.success, true);
  const projectId = String(confirmRes.body.data.project?.id || "");
  assert.ok(projectId);

  const workflow = await prismaClient.workflow.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" }
  });
  assert.equal(workflow, null);
});
