import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import express from "express";
import request from "supertest";

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

const tempDir = mkdtempSync(path.join(os.tmpdir(), "occ-api-workflow-v2-hermes-"));
const dbPath = path.join(tempDir, "test.db");

process.env.NODE_ENV = "test";
process.env.MODEL_PROVIDER = "scripted";
process.env.DATABASE_URL = `file:${dbPath}`;
process.env.ENFORCE_REAL_MODEL_GATE = "false";
process.env.PROJECT_AUTO_ADVANCE = "false";
process.env.PROJECT_WARMUP = "false";
process.env.STITCH_API_KEY = "";
process.env.WORKFLOW_V2_AGENT_AUTO_EXECUTE = "true";
process.env.WORKFLOW_V2_STAGE_AUTO_PROCEED = "false";
process.env.WORKFLOW_V2_HERMES_ENABLED = "true";
process.env.WORKFLOW_V2_HERMES_STAGE_MATCH = "all";

let prismaClient: any;
let app: express.Express;
let hermesServer: ReturnType<typeof createServer>;

before(async () => {
  copyFileSync(seedDbPath, dbPath);
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

  hermesServer = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/mcp/execute") {
      res.statusCode = 404;
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      const payload = JSON.parse(raw) as { templateKey: string };
      assert.equal(payload.templateKey, "visual_design");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        success: true,
        resolution: "Hermes completed UI design stage",
        artifacts: [
          {
            name: "mockups",
            type: "design",
            format: "json",
            content: "[{\"screen\":\"dashboard\",\"theme\":\"teal\"}]"
          },
          {
            name: "designTokens",
            type: "tokens",
            format: "json",
            content: "{\"color\":{\"brand\":\"#0f766e\"}}"
          }
        ]
      }));
    });
  });
  hermesServer.listen(0, "127.0.0.1");
  await once(hermesServer, "listening");
  const address = hermesServer.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to start hermes mock");
  }
  process.env.WORKFLOW_V2_HERMES_ENDPOINT = `http://127.0.0.1:${address.port}`;

  const [dbMod, workflowsMod] = await Promise.all([
    import("../db.js"),
    import("./workflows-v2.js")
  ]);
  prismaClient = dbMod.prisma;

  await prismaClient.project.create({
    data: {
      id: "WFV2-HERMES-001",
      name: "Workflow Hermes UI Stage",
      description: "验证 UI 设计阶段由 Hermes 参与执行",
      parsedKeywords: ["workflow", "hermes", "ui"],
      parsedConstraints: ["test-only"],
      parsedRisks: ["none"],
      parsedSuggestedTeam: ["ROLE_PM", "ROLE_DESIGN"],
      parsedSummary: "test summary",
      status: "active",
      currentStage: "INIT",
      progress: 0,
      pendingApproval: false,
      currentRole: "ROLE_PM",
      team: ["ROLE_PM", "ROLE_DESIGN"],
      summary: "summary",
      liveTitle: "live",
      liveBody: "live body",
      liveStartedAt: new Date(),
      liveProvider: "scripted"
    }
  });

  app = express();
  app.use(express.json());
  app.use("/api/v1/workflows", workflowsMod.createWorkflowsV2Router());
});

after(async () => {
  if (prismaClient) {
    await prismaClient.$disconnect();
  }
  if (hermesServer) {
    await new Promise<void>((resolve) => hermesServer.close(() => resolve()));
  }
  rmSync(tempDir, { recursive: true, force: true });
});

test("workflow-v2 design stage runs through hermes mcp and writes hermes artifacts", async () => {
  const templateRes = await request(app)
    .post("/api/v1/workflows/templates")
    .send({
      key: "visual_design",
      name: "视觉设计",
      category: "design",
      executorConfig: {
        type: "agent",
        agentRole: "UI_Designer",
        requiredCapabilities: ["figma", "ui_ux"],
        modelPreference: "hermes-v2.1"
      },
      inputSchema: {},
      outputSchema: { required: ["mockups"] },
      acceptanceCriteria: [
        { type: "artifact_exists", config: { artifact: "mockups" } },
        { type: "auto_check", config: { validator: "no_placeholder", artifact: "mockups" } }
      ],
      integrationConfig: { useStitch: false }
    });
  assert.equal(templateRes.status, 201);

  const initRes = await request(app)
    .post("/api/v1/workflows/projects/WFV2-HERMES-001/init")
    .send({
      templateKey: "visual_design",
      name: "UI 设计流程"
    });
  assert.equal(initRes.status, 201);
  const workflowId = String(initRes.body.data.workflowId);

  const startRes = await request(app)
    .post(`/api/v1/workflows/${workflowId}/start`)
    .send({});
  assert.equal(startRes.status, 200);

  const stage = await prismaClient.workflowStage.findFirst({ where: { workflowId } });
  assert.ok(stage);
  assert.equal(stage.status, "reviewing");

  const artifacts = Array.isArray(stage.outputArtifacts)
    ? (stage.outputArtifacts as Array<{ name?: string; content?: string; metadata?: Record<string, unknown> }> )
    : [];

  assert.equal(artifacts.some((item) => String(item.name) === "hermes_execution_trace.json"), true);
  assert.equal(artifacts.some((item) => String(item.name) === "mockups"), true);
  assert.equal(
    artifacts.some((item) => String(item.metadata?.source) === "workflow_v2_hermes"),
    true
  );
  assert.equal(
    artifacts.some((item) =>
      String(item.metadata?.source) === "workflow_v2_companion"
      && String(item.metadata?.role) === "ROLE_ANALYST"
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
});
