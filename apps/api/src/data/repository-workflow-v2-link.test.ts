import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { after, before, test } from "node:test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRoot = path.resolve(__dirname, "../../");
const seedDbPath = path.join(apiRoot, "prisma/dev.db");
const migrationPaths = [
  path.join(apiRoot, "prisma/migrations/20260411103000_add_knowledge_workflow_v2/migration.sql"),
  path.join(apiRoot, "prisma/migrations/20260411124500_add_knowledge_operation_logs/migration.sql")
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

let prismaClient: any;
let createProjectFn: any;
let upsertTemplateFn: any;

before(async () => {
  copyFileSync(seedDbPath, dbPath);
  for (const migrationPath of migrationPaths) {
    execSync(`sqlite3 ${JSON.stringify(dbPath)} < ${JSON.stringify(migrationPath)}`, {
      cwd: apiRoot,
      stdio: "pipe"
    });
  }

  const [dbMod, repoMod, workflowMod] = await Promise.all([
    import("../db.js"),
    import("./repository.js"),
    import("../workflow-v2/workflow-orchestrator.js")
  ]);
  prismaClient = dbMod.prisma;
  createProjectFn = repoMod.createProject;
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
});

after(async () => {
  if (prismaClient) {
    await prismaClient.$disconnect();
  }
  rmSync(tempDir, { recursive: true, force: true });
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
