import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { after, before, test } from "node:test";
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

const tempDir = mkdtempSync(path.join(os.tmpdir(), "occ-repo-workflow-link-"));
const dbPath = path.join(tempDir, "test.db");

process.env.NODE_ENV = "test";
process.env.MODEL_PROVIDER = "scripted";
process.env.DATABASE_URL = `file:${dbPath}`;
process.env.PROJECT_WORKFLOW_V2_AUTO_INIT = "true";
process.env.PROJECT_WORKFLOW_V2_AUTO_START = "true";
process.env.PROJECT_WORKFLOW_V2_TEMPLATE_KEY = "standard_software_development";
process.env.PROJECT_WARMUP = "false";
process.env.ENFORCE_REAL_MODEL_GATE = "false";
process.env.WORKFLOW_V2_AGENT_AUTO_EXECUTE = "false";
process.env.WORKFLOW_V2_STAGE_AUTO_PROCEED = "false";

let prismaClient: any;
let createProjectFn: any;
let findProjectFn: any;
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

  const [dbMod, repoMod, workflowMod] = await Promise.all([
    import("../db.js"),
    import("./repository.js"),
    import("../workflow-v2/workflow-orchestrator.js")
  ]);
  prismaClient = dbMod.prisma;
  createProjectFn = repoMod.createProject;
  findProjectFn = repoMod.findProject;
  upsertTemplateFn = workflowMod.upsertWorkflowTemplate;

  await upsertTemplateFn({
    key: "standard_software_development",
    name: "标准软件开发流程",
    category: "pm",
    executorConfig: {
      type: "agent",
      agentRole: "Project_Manager",
      requiredCapabilities: []
    },
    inputSchema: {},
    outputSchema: {},
    acceptanceCriteria: [],
    integrationConfig: {},
    defaultTimeout: null,
    allowParallel: false
  });

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
    inputContract: {
      requiresExternalInput: true,
      allowedInputTypes: ["document"],
      inputValidationRules: [
        { field: "rawRequirements", required: true, minLength: 10 }
      ]
    },
    defaultTimeout: 120,
    allowParallel: false,
    isStandalone: true,
    standaloneCategory: "requirements"
  });
});

after(async () => {
  if (prismaClient) {
    await prismaClient.$disconnect();
  }
  rmSync(tempDir, { recursive: true, force: true });
});

test("createProject auto-recovers workflow-v2 templates when template registry is empty", async () => {
  // Seed DB may already contain workflows referencing templates; clear dependents first.
  await prismaClient.workflowTransition.deleteMany({});
  await prismaClient.workflowStage.deleteMany({});
  await prismaClient.workflow.deleteMany({});
  await prismaClient.workflowTemplate.deleteMany({});

  const project = await createProjectFn(
    {
      name: "Workflow Template Auto-Recover Test",
      description: "验证 workflow-v2 模板缺失时能够自动补种并继续初始化",
      workflowTemplateKey: "standard_software_development",
      autoStartWorkflow: true
    },
    "scripted"
  );

  const requiredTemplateKeys = [
    "standard_software_development",
    "requirements_design",
    "visual_design",
    "tech_design",
    "code_dev",
    "qa_acceptance"
  ];
  const templates = await prismaClient.workflowTemplate.findMany({
    where: {
      key: {
        in: requiredTemplateKeys
      }
    },
    select: { key: true }
  });
  const templateKeys = new Set(templates.map((item: { key: string }) => item.key));
  for (const key of requiredTemplateKeys) {
    assert.equal(templateKeys.has(key), true, `missing template ${key}`);
  }

  const workflow = await prismaClient.workflow.findFirst({
    where: { projectId: project.id },
    orderBy: { createdAt: "desc" }
  });
  assert.ok(workflow);
  assert.equal(workflow.status, "active");
});

test("createProject auto-initializes and starts workflow-v2", async () => {
  const project = await createProjectFn(
    {
      name: "Workflow Link Test",
      description: "验证项目创建时自动初始化并启动 workflow-v2",
      workflowTemplateKey: "standard_software_development",
      autoStartWorkflow: true
    },
    "scripted"
  );

  const workflow = await prismaClient.workflow.findFirst({
    where: { projectId: project.id },
    orderBy: { createdAt: "desc" }
  });
  assert.ok(workflow);
  assert.equal(workflow.status, "active");
  assert.equal(Array.isArray(workflow.currentStageIds), true);
  assert.equal((workflow.currentStageIds as unknown[]).length > 0, true);
});

test("complete project auto-seeds rawRequirements when projectInputs are missing", async () => {
  const project = await createProjectFn(
    {
      name: "Complete Auto Input Seed Test",
      description: "验证完整流程项目未显式传 projectInputs 时，系统会自动补齐 rawRequirements 入口输入并解除输入门禁。",
      projectType: "complete",
      workflowTemplateKey: "standard_software_development",
      autoStartWorkflow: true
    },
    "scripted"
  );

  const inputs = await prismaClient.projectInput.findMany({
    where: { projectId: project.id }
  });
  assert.equal(inputs.some((item: { name: string }) => String(item.name || "") === "rawRequirements"), true);

  const workflow = await prismaClient.workflow.findFirst({
    where: { projectId: project.id },
    orderBy: { createdAt: "desc" },
    include: { stages: true }
  });
  assert.ok(workflow);

  const requirementStage = workflow.stages.find((item: { templateKey: string }) => item.templateKey === "requirements_design");
  assert.ok(requirementStage);
  assert.notEqual(requirementStage.status, "pending");

  const inputArtifacts = Array.isArray(requirementStage.inputArtifacts)
    ? (requirementStage.inputArtifacts as Array<Record<string, unknown>>)
    : [];
  assert.equal(inputArtifacts.some((item) => String(item.name || "") === "rawRequirements"), true);
});

test("createProject binds workflow-v2 even when workflowTemplateKey is omitted", async () => {
  const project = await createProjectFn(
    {
      name: "Workflow Mandatory Binding Test",
      description: "验证默认创建项目也会强制绑定并启动 workflow-v2",
      projectType: "complete",
      autoStartWorkflow: true
    },
    "scripted"
  );

  const workflow = await prismaClient.workflow.findFirst({
    where: { projectId: project.id },
    orderBy: { createdAt: "desc" }
  });
  assert.ok(workflow);
  assert.equal(workflow.status, "active");
});

test("standalone project binds projectInputs into entry stage and uses standalone template", async () => {
  const project = await createProjectFn(
    {
      name: "Standalone Input Binding Test",
      description: "验证 standalone 项目输入是否绑定到入口阶段",
      projectType: "standalone",
      projectInputs: [
        {
          name: "rawRequirements",
          type: "document",
          content: "这是 standalone 模式下的输入需求文档，长度足够用于门禁校验。"
        }
      ],
      autoStartWorkflow: true
    },
    "scripted"
  );

  assert.equal(project.projectType, "standalone");

  const workflow = await prismaClient.workflow.findFirst({
    where: { projectId: project.id },
    orderBy: { createdAt: "desc" },
    include: { template: true, stages: true }
  });
  assert.ok(workflow);
  assert.equal(workflow.template?.key, "requirements_design");
  const entryStageId = Array.isArray(workflow.currentStageIds) ? workflow.currentStageIds[0] : null;
  assert.ok(entryStageId);

  const entryStage = await prismaClient.workflowStage.findUnique({
    where: { id: String(entryStageId) }
  });
  assert.ok(entryStage);
  const inputArtifacts = Array.isArray(entryStage?.inputArtifacts)
    ? (entryStage?.inputArtifacts as Array<Record<string, unknown>>)
    : [];
  assert.equal(inputArtifacts.length > 0, true);
  assert.equal(inputArtifacts.some((item) => String(item.name || "") === "rawRequirements"), true);

  const inputs = await prismaClient.projectInput.findMany({
    where: { projectId: project.id }
  });
  assert.equal(inputs.length >= 1, true);
});

test("relay project imports source deliverables into project inputs", async () => {
  const source = await createProjectFn(
    {
      name: "Relay Source Project",
      description: "用于 relay 导入测试的来源项目",
      projectType: "complete",
      autoStartWorkflow: false
    },
    "scripted"
  );

  const sourceDeliverable = await prismaClient.deliverable.create({
    data: {
      projectId: source.id,
      stageType: "DESIGN",
      name: "UI 设计稿说明",
      type: "markdown",
      content: "这是来源项目的设计交付，供 relay 模式导入。",
      version: 1,
      status: "approved",
      createdBy: "ROLE_DESIGN",
      updatedAt: new Date()
    }
  });

  const relay = await createProjectFn(
    {
      name: "Relay Target Project",
      description: "relay 模式导入验证",
      projectType: "relay",
      parentProjectId: source.id,
      autoStartWorkflow: false
    },
    "scripted"
  );

  assert.equal(relay.projectType, "relay");
  assert.equal(relay.parentProjectId, source.id);

  const importedInputs = await prismaClient.projectInput.findMany({
    where: { projectId: relay.id },
    orderBy: { createdAt: "asc" }
  });
  assert.equal(importedInputs.length > 0, true);
  assert.equal(importedInputs.some((item: { referenceDeliverableId: string | null }) => item.referenceDeliverableId === sourceDeliverable.id), true);

  const relayLinks = await prismaClient.stageRelayRelation.findMany({
    where: {
      sourceProjectId: source.id,
      targetProjectId: relay.id
    }
  });
  assert.equal(relayLinks.length > 0, true);
});

test("findProject reconciles false-completed state when workflow-v2 is still active", async () => {
  const project = await createProjectFn(
    {
      name: "Workflow Legacy Reconcile Test",
      description: "验证 workflow-v2 活跃时不会被错误标记 completed",
      projectType: "standalone",
      workflowTemplateKey: "requirements_design",
      autoStartWorkflow: true
    },
    "scripted"
  );

  const workflow = await prismaClient.workflow.findFirst({
    where: { projectId: project.id },
    orderBy: { createdAt: "desc" },
    include: { stages: true }
  });
  assert.ok(workflow);
  assert.equal(workflow.status, "active");

  const currentStageId = Array.isArray(workflow.currentStageIds) ? String(workflow.currentStageIds[0] || "") : "";
  assert.equal(Boolean(currentStageId), true);

  await prismaClient.workflowStage.update({
    where: { id: currentStageId },
    data: {
      gateResults: {
        passed: false,
        violations: ["input_rule: rawRequirements missing"],
        checks: [{ type: "input_rule", passed: false, details: "rawRequirements missing" }]
      }
    }
  });

  await prismaClient.project.update({
    where: { id: project.id },
    data: {
      status: "completed",
      currentStage: "ACCEPT",
      currentRole: "ROLE_HR",
      progress: 100,
      pendingApproval: false
    }
  });
  await prismaClient.stage.updateMany({
    where: { projectId: project.id },
    data: {
      status: "completed",
      progress: 100
    }
  });

  const repaired = await findProjectFn(project.id);
  assert.ok(repaired);
  assert.equal(repaired.status, "active");
  assert.equal(repaired.currentStage, "ANALYSIS");
  assert.equal(repaired.currentRole, "ROLE_ANALYST");
  assert.equal(repaired.progress < 100, true);

  const persisted = await prismaClient.project.findUnique({
    where: { id: project.id }
  });
  assert.ok(persisted);
  assert.equal(persisted.status, "active");
  assert.equal(persisted.currentStage, "ANALYSIS");
  assert.equal(Number(persisted.progress) < 100, true);
});
