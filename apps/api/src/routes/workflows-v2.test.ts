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

const tempDir = mkdtempSync(path.join(os.tmpdir(), "occ-api-workflow-v2-"));
const dbPath = path.join(tempDir, "test.db");

process.env.NODE_ENV = "test";
process.env.MODEL_PROVIDER = "scripted";
process.env.DATABASE_URL = `file:${dbPath}`;
process.env.ENFORCE_REAL_MODEL_GATE = "false";
process.env.PROJECT_AUTO_ADVANCE = "false";
process.env.PROJECT_WARMUP = "false";
process.env.STITCH_API_KEY = "";
process.env.WORKFLOW_V2_AGENT_AUTO_EXECUTE = "false";
process.env.WORKFLOW_V2_STAGE_AUTO_PROCEED = "false";

let prismaClient: any;
let app: express.Express;

async function createProject(projectId: string) {
  await prismaClient.project.create({
    data: {
      id: projectId,
      name: "Workflow V2 Test Project",
      description: "用于验证 workflow-v2 主流程",
      parsedKeywords: ["workflow", "test"],
      parsedConstraints: ["test-only"],
      parsedRisks: ["none"],
      parsedSuggestedTeam: ["ROLE_PM", "ROLE_ANALYST"],
      parsedSummary: "test summary",
      status: "active",
      currentStage: "INIT",
      progress: 0,
      pendingApproval: false,
      currentRole: "ROLE_PM",
      team: ["ROLE_PM", "ROLE_ANALYST"],
      summary: "summary",
      liveTitle: "live",
      liveBody: "live body",
      liveStartedAt: new Date(),
      liveProvider: "scripted"
    }
  });
}

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

  const [dbMod, workflowsMod] = await Promise.all([
    import("../db.js"),
    import("./workflows-v2.js")
  ]);
  prismaClient = dbMod.prisma;

  await createProject("WFV2-PROJECT-001");

  app = express();
  app.use(express.json());
  app.use("/api/v1/workflows", workflowsMod.createWorkflowsV2Router());
});

after(async () => {
  if (prismaClient) {
    await prismaClient.$disconnect();
  }
  rmSync(tempDir, { recursive: true, force: true });
});

test("workflow-v2 blocks proceed when required artifact is missing", async () => {
  process.env.WORKFLOW_V2_AGENT_AUTO_EXECUTE = "false";
  const healthRes = await request(app).get("/api/v1/workflows/health");
  assert.equal(healthRes.status, 200);
  assert.equal(healthRes.body.success, true);

  const templateRes = await request(app)
    .post("/api/v1/workflows/templates")
    .send({
      key: "requirements_design",
      name: "需求设计",
      category: "pm",
      executorConfig: {
        type: "agent",
        agentRole: "Product_Manager",
        requiredCapabilities: ["prd_writing"],
        modelPreference: "openai/gpt-5.4"
      },
      inputSchema: {},
      outputSchema: {},
      acceptanceCriteria: [
        { type: "artifact_exists", config: { artifact: "prd", minLength: 30 } },
        { type: "auto_check", config: { validator: "no_placeholder", artifact: "prd" } }
      ]
    });
  assert.equal(templateRes.status, 201);

  const initRes = await request(app)
    .post("/api/v1/workflows/projects/WFV2-PROJECT-001/init")
    .send({
      templateKey: "requirements_design",
      name: "需求流程"
    });
  assert.equal(initRes.status, 201);
  const workflowId = String(initRes.body.data.workflowId);
  assert.ok(workflowId);

  const startRes = await request(app)
    .post(`/api/v1/workflows/${workflowId}/start`)
    .send({});
  assert.equal(startRes.status, 200);

  const stage = await prismaClient.workflowStage.findFirst({
    where: { workflowId }
  });
  assert.ok(stage);

  const transitionRes = await request(app)
    .post(`/api/v1/workflows/stages/${stage.id}/transition`)
    .send({
      workflowId,
      action: "proceed",
      triggeredBy: "ROLE_PM"
    });

  assert.equal(transitionRes.status, 200);
  assert.equal(transitionRes.body.data.success, false);
  assert.equal(transitionRes.body.data.blocked, true);
  assert.equal(Array.isArray(transitionRes.body.data.violations), true);

  const invalidActionRes = await request(app)
    .post(`/api/v1/workflows/stages/${stage.id}/transition`)
    .send({
      workflowId,
      action: "invalid_action",
      triggeredBy: "ROLE_PM"
    });
  assert.equal(invalidActionRes.status, 400);
  assert.equal(invalidActionRes.body.error.code, "VALIDATION_ERROR");
});

test("workflow-v2 proceeds after artifact upload and completes linear workflow", async () => {
  process.env.WORKFLOW_V2_AGENT_AUTO_EXECUTE = "false";
  const initRes = await request(app)
    .post("/api/v1/workflows/projects/WFV2-PROJECT-001/init")
    .send({
      templateKey: "requirements_design",
      name: "需求流程2"
    });
  assert.equal(initRes.status, 201);
  const workflowId = String(initRes.body.data.workflowId);

  await request(app).post(`/api/v1/workflows/${workflowId}/start`).send({});
  const stage = await prismaClient.workflowStage.findFirst({
    where: { workflowId }
  });
  assert.ok(stage);

  const outputRes = await request(app)
    .post(`/api/v1/workflows/stages/${stage.id}/output`)
    .send({
      name: "prd",
      type: "markdown",
      content: "# PRD\n\n这是完整 PRD 内容，字段齐全且长度足够通过门禁。"
    });
  assert.equal(outputRes.status, 200);

  const transitionRes = await request(app)
    .post(`/api/v1/workflows/stages/${stage.id}/transition`)
    .send({
      workflowId,
      action: "proceed",
      triggeredBy: "ROLE_PM"
    });
  assert.equal(transitionRes.status, 200);
  assert.equal(transitionRes.body.data.success, true);
  assert.deepEqual(transitionRes.body.data.nextStageIds, []);

  const workflow = await prismaClient.workflow.findUnique({
    where: { id: workflowId }
  });
  assert.equal(workflow?.status, "completed");
});

test("workflow-v2 can autonomously execute stage with agent and produce artifacts", async () => {
  process.env.WORKFLOW_V2_AGENT_AUTO_EXECUTE = "true";

  const initRes = await request(app)
    .post("/api/v1/workflows/projects/WFV2-PROJECT-001/init")
    .send({
      templateKey: "requirements_design",
      name: "需求流程3-自动执行"
    });
  assert.equal(initRes.status, 201);
  const workflowId = String(initRes.body.data.workflowId);

  const startRes = await request(app)
    .post(`/api/v1/workflows/${workflowId}/start`)
    .send({});
  assert.equal(startRes.status, 200);

  const stage = await prismaClient.workflowStage.findFirst({
    where: { workflowId }
  });
  assert.ok(stage);
  assert.equal(stage.status, "reviewing");
  assert.equal(Array.isArray(stage.outputArtifacts), true);
  assert.equal((stage.outputArtifacts as unknown[]).length > 0, true);
  const artifacts = Array.isArray(stage.outputArtifacts)
    ? (stage.outputArtifacts as Array<{ metadata?: Record<string, unknown> }>)
    : [];
  assert.equal(
    artifacts.some((item) =>
      String(item.metadata?.source || "") === "workflow_v2_companion"
      && String(item.metadata?.role || "") === "ROLE_ANALYST"
    ),
    true
  );
  const gateChecks = Array.isArray((stage.gateResults as { checks?: unknown[] } | null)?.checks)
    ? (((stage.gateResults as { checks?: Array<{ type?: string; passed?: boolean }> }).checks) ?? [])
    : [];
  assert.equal(
    gateChecks.some((item) => String(item.type || "") === "role_collaboration" && Boolean(item.passed)),
    true
  );

  const overviewRes = await request(app)
    .get("/api/v1/workflows/projects/WFV2-PROJECT-001/overview");
  assert.equal(overviewRes.status, 200);
  assert.equal(overviewRes.body.success, true);
  assert.equal(String(overviewRes.body.data.workflowId || "").length > 0, true);
  assert.equal(Array.isArray(overviewRes.body.data.stages), true);
  assert.equal(overviewRes.body.data.stages.length >= 1, true);
  assert.equal(overviewRes.body.data.stages.some((item: { isCurrent?: boolean }) => Boolean(item.isCurrent)), true);
  const overviewStage = (overviewRes.body.data.stages as Array<Record<string, unknown>>)[0] || {};
  const overviewCollaboration = (overviewStage.collaboration || {}) as Record<string, unknown>;
  const overviewSources = (overviewStage.artifactSources || {}) as Record<string, unknown>;
  const overviewCollaborationArtifacts = Array.isArray(overviewStage.collaborationArtifacts)
    ? (overviewStage.collaborationArtifacts as Array<Record<string, unknown>>)
    : [];
  assert.equal(Array.isArray(overviewStage.assignedAgentProfiles), true);
  assert.equal(String(overviewStage.executionEngine || "").length > 0, true);
  assert.equal(Boolean(overviewCollaboration.analystInvolved), true);
  assert.equal(Number(overviewSources.companion || 0) >= 1, true);
  assert.equal(overviewCollaborationArtifacts.length >= 1, true);
  assert.equal(
    overviewCollaborationArtifacts.some((item) => String(item.role || "") === "ROLE_ANALYST"),
    true
  );

  const transitionRes = await request(app)
    .post(`/api/v1/workflows/stages/${stage.id}/transition`)
    .send({
      workflowId,
      action: "proceed",
      triggeredBy: "ROLE_PM"
    });
  assert.equal(transitionRes.status, 200);
  assert.equal(transitionRes.body.data.success, true);
  assert.deepEqual(transitionRes.body.data.nextStageIds, []);

  const stageAfterProceed = await prismaClient.workflowStage.findUnique({
    where: { id: stage.id }
  });
  assert.ok(stageAfterProceed);
  const proceededArtifacts = Array.isArray(stageAfterProceed.outputArtifacts)
    ? (stageAfterProceed.outputArtifacts as Array<{ metadata?: Record<string, unknown> }>)
    : [];
  assert.equal(
    proceededArtifacts.some((item) =>
      String(item.metadata?.source || "") === "workflow_v2_companion"
      && String(item.metadata?.knowledgeId || "").length > 0
    ),
    true
  );
});

test("workflow-v2 input endpoint can unblock inputContract-gated stage", async () => {
  process.env.WORKFLOW_V2_AGENT_AUTO_EXECUTE = "false";

  const templateRes = await request(app)
    .post("/api/v1/workflows/templates")
    .send({
      key: "requirements_input_gate",
      name: "需求输入门禁流程",
      category: "pm",
      executorConfig: {
        type: "agent",
        agentRole: "Product_Manager",
        requiredCapabilities: ["prd_writing"],
        modelPreference: "openai/gpt-5.4"
      },
      inputSchema: {},
      outputSchema: {},
      inputContract: {
        requiresExternalInput: true,
        allowedInputTypes: ["document"],
        inputValidationRules: [
          { field: "rawRequirements", required: true, minLength: 10 }
        ]
      },
      acceptanceCriteria: []
    });
  assert.equal(templateRes.status, 201);

  const initRes = await request(app)
    .post("/api/v1/workflows/projects/WFV2-PROJECT-001/init")
    .send({
      templateKey: "requirements_input_gate",
      name: "输入门禁流程"
    });
  assert.equal(initRes.status, 201);
  const workflowId = String(initRes.body.data.workflowId);

  const startRes = await request(app)
    .post(`/api/v1/workflows/${workflowId}/start`)
    .send({});
  assert.equal(startRes.status, 200);

  let stage = await prismaClient.workflowStage.findFirst({
    where: { workflowId }
  });
  assert.ok(stage);
  assert.equal(["pending", "running", "reviewing"].includes(String(stage.status)), true);

  const addInputRes = await request(app)
    .post(`/api/v1/workflows/stages/${stage.id}/input`)
    .send({
      name: "rawRequirements",
      type: "document",
      content: "这是补充的输入需求文档，满足门禁长度要求。"
    });
  assert.equal(addInputRes.status, 200);
  assert.equal(addInputRes.body.success, true);
  assert.equal(Number(addInputRes.body.data.artifactCount) >= 1, true);

  const restartRes = await request(app)
    .post(`/api/v1/workflows/${workflowId}/start`)
    .send({});
  assert.equal(restartRes.status, 200);

  stage = await prismaClient.workflowStage.findUnique({
    where: { id: stage.id }
  });
  assert.ok(stage);
  assert.equal(stage.status === "running" || stage.status === "reviewing", true);
});
