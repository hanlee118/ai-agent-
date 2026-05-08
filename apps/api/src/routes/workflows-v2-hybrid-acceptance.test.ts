import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { createServer } from "node:http";
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

const tempDir = mkdtempSync(path.join(os.tmpdir(), "occ-api-workflow-v2-hybrid-"));
const dbPath = path.join(tempDir, "test.db");

process.env.NODE_ENV = "test";
process.env.MODEL_PROVIDER = "scripted";
process.env.DATABASE_URL = `file:${dbPath}`;
process.env.ENFORCE_REAL_MODEL_GATE = "false";
process.env.PROJECT_AUTO_ADVANCE = "false";
process.env.PROJECT_WARMUP = "false";
process.env.STITCH_API_KEY = "";
process.env.WORKFLOW_V2_FORCE_SCRIPTED_AGENT = "true";
process.env.WORKFLOW_V2_AGENT_AUTO_EXECUTE = "true";
process.env.WORKFLOW_V2_STAGE_AUTO_PROCEED = "true";
process.env.WORKFLOW_V2_HERMES_ENABLED = "true";
process.env.WORKFLOW_V2_HERMES_STAGE_MATCH = "design";
process.env.WORKFLOW_V2_KNOWLEDGE_LLM_ENABLED = "false";

const projectId = "WFV2-HYBRID-001";
const hermesAgentId = "hermes-agent-1";
const openclawAgentId = "openclaw_dev_agent";

let prismaClient: any;
let app: express.Express;
let hermesServer: ReturnType<typeof createServer>;

function asArtifacts(value: unknown) {
  return Array.isArray(value)
    ? (value as Array<{ name?: string; metadata?: Record<string, unknown> }> )
    : [];
}

async function upsertTemplate(payload: Record<string, unknown>) {
  const res = await request(app)
    .post("/api/v1/workflows/templates")
    .send(payload);
  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
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
      const payload = JSON.parse(raw) as { templateKey?: string };
      if (String(payload.templateKey || "") !== "visual_design") {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ success: false, message: "unexpected template" }));
        return;
      }

      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        success: true,
        model: "hermes-v2.1",
        resolution: "Hermes finished visual stage with reusable design artifacts",
        artifacts: [
          {
            name: "mockups",
            type: "design",
            format: "json",
            content: "[{\"screen\":\"dashboard\",\"palette\":\"teal\"}]"
          },
          {
            name: "designTokens",
            type: "tokens",
            format: "json",
            content: "{\"color\":{\"brand\":\"#0f766e\"},\"space\":{\"md\":16}}"
          }
        ]
      }));
    });
  });

  hermesServer.listen(0, "127.0.0.1");
  await once(hermesServer, "listening");
  const address = hermesServer.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to start hermes mock server");
  }
  process.env.WORKFLOW_V2_HERMES_ENDPOINT = `http://127.0.0.1:${address.port}`;

  const [dbMod, workflowsMod, knowledgeMod] = await Promise.all([
    import("../db.js"),
    import("./workflows-v2.js"),
    import("./knowledge-v2.js")
  ]);
  prismaClient = dbMod.prisma;

  await prismaClient.$transaction([
    prismaClient.agentMemoryEntry.deleteMany(),
    prismaClient.agentUsageLog.deleteMany(),
    prismaClient.managedAgentConfig.deleteMany(),
    prismaClient.agentProfile.deleteMany()
  ]);

  await prismaClient.project.upsert({
    where: { id: projectId },
    create: {
      id: projectId,
      name: "Workflow V2 Hybrid Acceptance",
      description: "验证 Hermes + OpenClaw 联合执行与知识沉淀",
      parsedKeywords: ["workflow-v2", "hybrid", "knowledge"],
      parsedConstraints: ["test-only"],
      parsedRisks: ["none"],
      parsedSuggestedTeam: ["ROLE_DESIGN", "ROLE_DEV"],
      parsedSummary: "hybrid acceptance",
      status: "active",
      currentStage: "INIT",
      progress: 0,
      pendingApproval: false,
      currentRole: "ROLE_PM",
      team: ["ROLE_PM", "ROLE_DESIGN", "ROLE_DEV"],
      summary: "summary",
      liveTitle: "live",
      liveBody: "live body",
      liveStartedAt: new Date(),
      liveProvider: "scripted"
    },
    update: {}
  });

  await prismaClient.agentProfile.upsert({
    where: { roleId: hermesAgentId },
    create: {
      roleId: hermesAgentId,
      name: "Hermes Design Agent",
      tagline: "Hermes visual executor",
      description: "Hermes powered design specialist",
      status: "online",
      workload: 8,
      styles: [],
      skills: ["figma", "ui_ux", "design_system"],
      recentHighlights: []
    },
    update: {
      status: "online",
      workload: 8,
      skills: ["figma", "ui_ux", "design_system"]
    }
  });

  await prismaClient.agentProfile.upsert({
    where: { roleId: openclawAgentId },
    create: {
      roleId: openclawAgentId,
      name: "OpenClaw Dev Agent",
      tagline: "OpenClaw coding executor",
      description: "OpenClaw powered software engineer",
      status: "online",
      workload: 6,
      styles: [],
      skills: ["coding", "testing", "git", "typescript"],
      recentHighlights: []
    },
    update: {
      status: "online",
      workload: 6,
      skills: ["coding", "testing", "git", "typescript"]
    }
  });

  await prismaClient.managedAgentConfig.upsert({
    where: { agentId: hermesAgentId },
    create: {
      agentId: hermesAgentId,
      displayName: "Hermes Agent",
      title: "Hermes Visual Agent",
      intro: "Hermes",
      responsibility: "design",
      selectedModel: "hermes-v2.1",
      defaultModel: "hermes-v2.1",
      fallbackModel: null,
      executionMode: "confirm_first",
      requireConfirmation: true,
      autoApproveMinorSteps: false,
      maxPromptTokens: 500000,
      maxCompletionTokens: null,
      maxDailyTokens: 1000000,
      memoryEnabled: true,
      allowedAgentIds: [],
      toolAllowlist: []
    },
    update: {
      selectedModel: "hermes-v2.1",
      defaultModel: "hermes-v2.1"
    }
  });

  await prismaClient.managedAgentConfig.upsert({
    where: { agentId: openclawAgentId },
    create: {
      agentId: openclawAgentId,
      displayName: "OpenClaw Dev",
      title: "OpenClaw Developer",
      intro: "OpenClaw",
      responsibility: "development",
      selectedModel: "openclaw-coder",
      defaultModel: "openclaw-coder",
      fallbackModel: null,
      executionMode: "confirm_first",
      requireConfirmation: true,
      autoApproveMinorSteps: false,
      maxPromptTokens: 500000,
      maxCompletionTokens: null,
      maxDailyTokens: 1000000,
      memoryEnabled: true,
      allowedAgentIds: [],
      toolAllowlist: []
    },
    update: {
      selectedModel: "openclaw-coder",
      defaultModel: "openclaw-coder"
    }
  });

  app = express();
  app.use(express.json());
  app.use("/api/v1/workflows", workflowsMod.createWorkflowsV2Router());
  app.use("/api/v1/knowledge", knowledgeMod.createKnowledgeV2Router());
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

test("workflow-v2 hybrid acceptance: hermes + openclaw stage execution and knowledge lifecycle", async () => {
  await upsertTemplate({
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
    acceptanceCriteria: []
  });

  await upsertTemplate({
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
    outputSchema: {
      required: ["mockups", "designTokens"]
    },
    acceptanceCriteria: [
      { type: "artifact_exists", config: { artifact: "mockups" } },
      { type: "auto_check", config: { validator: "no_placeholder", artifact: "mockups" } }
    ]
  });

  await upsertTemplate({
    key: "code_dev",
    name: "代码研发",
    category: "dev",
    executorConfig: {
      type: "agent",
      agentRole: "Developer",
      requiredCapabilities: ["coding", "testing", "git"],
      modelPreference: "openclaw-coder"
    },
    inputSchema: {},
    outputSchema: {
      required: ["sourceCode"]
    },
    acceptanceCriteria: [
      { type: "artifact_exists", config: { artifact: "sourceCode" } }
    ]
  });

  const initRes = await request(app)
    .post(`/api/v1/workflows/projects/${projectId}/init`)
    .send({
      templateKey: "standard_software_development",
      name: "Hybrid Visual->Dev",
      customStages: {
        nodes: [
          { id: "visual", templateKey: "visual_design" },
          { id: "dev", templateKey: "code_dev" }
        ],
        edges: [
          { from: "visual", to: "dev" }
        ]
      }
    });
  assert.equal(initRes.status, 201);
  assert.equal(initRes.body.success, true);

  const workflowId = String(initRes.body.data.workflowId || "");
  assert.ok(workflowId);

  const startRes = await request(app)
    .post(`/api/v1/workflows/${workflowId}/start`)
    .send({});
  assert.equal(startRes.status, 200);
  assert.equal(startRes.body.success, true);

  const workflow = await prismaClient.workflow.findUnique({ where: { id: workflowId } });
  assert.ok(workflow);
  assert.equal(workflow.status, "completed");

  const stages = await prismaClient.workflowStage.findMany({
    where: { workflowId },
    orderBy: { createdAt: "asc" }
  });
  assert.equal(stages.length, 2);

  const visualStage = stages.find((item: { nodeId: string }) => item.nodeId === "visual");
  const devStage = stages.find((item: { nodeId: string }) => item.nodeId === "dev");
  assert.ok(visualStage);
  assert.ok(devStage);
  assert.equal(visualStage.status, "completed");
  assert.equal(devStage.status, "completed");

  const visualAssigned = Array.isArray(visualStage.assignedAgents)
    ? (visualStage.assignedAgents as string[])
    : [];
  const devAssigned = Array.isArray(devStage.assignedAgents)
    ? (devStage.assignedAgents as string[])
    : [];
  assert.equal(visualAssigned.includes(hermesAgentId), true);
  assert.equal(devAssigned.includes(openclawAgentId), true);

  const visualArtifacts = asArtifacts(visualStage.outputArtifacts);
  const devArtifacts = asArtifacts(devStage.outputArtifacts);

  assert.equal(visualArtifacts.some((item) => String(item.name) === "hermes_execution_trace.json"), true);
  assert.equal(
    visualArtifacts.some((item) => String(item.metadata?.source || "") === "workflow_v2_hermes"),
    true
  );
  assert.equal(
    visualArtifacts.some((item) =>
      String(item.metadata?.source || "") === "workflow_v2_companion"
      && String(item.metadata?.role || "") === "ROLE_ANALYST"
      && String(item.metadata?.knowledgeId || "").length > 0
    ),
    true
  );
  assert.equal(
    devArtifacts.some((item) => String(item.metadata?.source || "") === "workflow_v2_agent"),
    true
  );
  assert.equal(
    devArtifacts.some((item) =>
      String(item.metadata?.source || "") === "workflow_v2_companion"
      && String(item.metadata?.role || "") === "ROLE_ANALYST"
      && String(item.metadata?.knowledgeId || "").length > 0
    ),
    true
  );

  const allKnowledgeRes = await request(app)
    .get("/api/v1/knowledge")
    .query({ projectId, limit: 200 });
  assert.equal(allKnowledgeRes.status, 200);
  assert.equal(allKnowledgeRes.body.success, true);
  const knowledgeItems = Array.isArray(allKnowledgeRes.body.data.items)
    ? (allKnowledgeRes.body.data.items as Array<{ id: string; title: string }>)
    : [];
  assert.equal(knowledgeItems.length > 0, true);

  const visualKnowledgeRes = await request(app)
    .get("/api/v1/knowledge")
    .query({ projectId, stageContext: "visual_design", limit: 200 });
  assert.equal(visualKnowledgeRes.status, 200);
  assert.equal(visualKnowledgeRes.body.success, true);
  assert.equal((visualKnowledgeRes.body.data.items as unknown[]).length > 0, true);

  const devKnowledgeRes = await request(app)
    .get("/api/v1/knowledge")
    .query({ projectId, stageContext: "code_dev", limit: 200 });
  assert.equal(devKnowledgeRes.status, 200);
  assert.equal(devKnowledgeRes.body.success, true);
  assert.equal((devKnowledgeRes.body.data.items as unknown[]).length > 0, true);

  const targetKnowledgeId = knowledgeItems[0]?.id;
  assert.ok(targetKnowledgeId);

  const patchRes = await request(app)
    .patch(`/api/v1/knowledge/${targetKnowledgeId}`)
    .send({
      title: " Hybrid Knowledge Updated ",
      tags: ["hybrid", "workflow-v2", "hybrid"],
      stageContext: ["visual", "visual_design"],
      techStack: ["React", "TypeScript", "react"]
    });
  assert.equal(patchRes.status, 200);
  assert.equal(patchRes.body.success, true);

  const detailAfterPatchRes = await request(app).get(`/api/v1/knowledge/${targetKnowledgeId}`);
  assert.equal(detailAfterPatchRes.status, 200);
  assert.equal(detailAfterPatchRes.body.success, true);
  assert.match(String(detailAfterPatchRes.body.data.title), /Hybrid Knowledge Updated/);

  const deleteRes = await request(app)
    .delete(`/api/v1/knowledge/${targetKnowledgeId}?triggeredBy=hybrid-test`);
  assert.equal(deleteRes.status, 200);
  assert.equal(deleteRes.body.success, true);

  const historyDeleteSingleRes = await request(app)
    .get("/api/v1/knowledge/history")
    .query({ projectId, operationType: "delete_single", limit: 20 });
  assert.equal(historyDeleteSingleRes.status, 200);
  assert.equal(historyDeleteSingleRes.body.success, true);
  const deleteLogs = Array.isArray(historyDeleteSingleRes.body.data.logs)
    ? (historyDeleteSingleRes.body.data.logs as Array<{ id: string; canRollback: boolean }>)
    : [];
  assert.equal(deleteLogs.length > 0, true);
  assert.equal(Boolean(deleteLogs[0]?.canRollback), true);

  const rollbackSingleRes = await request(app)
    .post(`/api/v1/knowledge/history/${deleteLogs[0].id}/rollback`)
    .send({ triggeredBy: "hybrid-test" });
  assert.equal(rollbackSingleRes.status, 200);
  assert.equal(rollbackSingleRes.body.success, true);
  assert.equal(rollbackSingleRes.body.data.success, true);
  assert.equal(Number(rollbackSingleRes.body.data.restoredCount) >= 1, true);

  const restoredDetailRes = await request(app).get(`/api/v1/knowledge/${targetKnowledgeId}`);
  assert.equal(restoredDetailRes.status, 200);
  assert.equal(restoredDetailRes.body.success, true);

  const refreshListRes = await request(app)
    .get("/api/v1/knowledge")
    .query({ projectId, limit: 200 });
  assert.equal(refreshListRes.status, 200);
  assert.equal(refreshListRes.body.success, true);
  const refreshedItems = Array.isArray(refreshListRes.body.data.items)
    ? (refreshListRes.body.data.items as Array<{ id: string }>)
    : [];

  const bulkDeleteTarget = refreshedItems.find((item) => item.id !== targetKnowledgeId)?.id;
  assert.ok(bulkDeleteTarget);

  const bulkDeleteRes = await request(app)
    .post("/api/v1/knowledge/bulk-delete")
    .send({
      ids: [bulkDeleteTarget],
      triggeredBy: "hybrid-test"
    });
  assert.equal(bulkDeleteRes.status, 200);
  assert.equal(bulkDeleteRes.body.success, true);
  assert.equal(Number(bulkDeleteRes.body.data.count) >= 1, true);

  const historyBulkDeleteRes = await request(app)
    .get("/api/v1/knowledge/history")
    .query({ projectId, operationType: "delete_bulk", limit: 20 });
  assert.equal(historyBulkDeleteRes.status, 200);
  assert.equal(historyBulkDeleteRes.body.success, true);
  const bulkLogs = Array.isArray(historyBulkDeleteRes.body.data.logs)
    ? (historyBulkDeleteRes.body.data.logs as Array<{ id: string; canRollback: boolean }>)
    : [];
  assert.equal(bulkLogs.length > 0, true);

  const rollbackBulkRes = await request(app)
    .post(`/api/v1/knowledge/history/${bulkLogs[0].id}/rollback`)
    .send({ triggeredBy: "hybrid-test" });
  assert.equal(rollbackBulkRes.status, 200);
  assert.equal(rollbackBulkRes.body.success, true);
  assert.equal(rollbackBulkRes.body.data.success, true);

  const bulkRestoredDetailRes = await request(app).get(`/api/v1/knowledge/${bulkDeleteTarget}`);
  assert.equal(bulkRestoredDetailRes.status, 200);
  assert.equal(bulkRestoredDetailRes.body.success, true);
});
