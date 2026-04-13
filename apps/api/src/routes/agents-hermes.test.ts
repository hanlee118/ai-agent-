import assert from "node:assert/strict";
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

const tempDir = mkdtempSync(path.join(os.tmpdir(), "occ-api-agents-hermes-"));
const dbPath = path.join(tempDir, "test.db");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = `file:${dbPath}`;
process.env.MODEL_PROVIDER = "scripted";
process.env.HERMES_ENABLED = "true";
process.env.HERMES_AGENT_ID = "hermes-agent-1";

let prismaClient: any;
let app: express.Express;

before(async () => {
  snapshotSqliteSeedDatabase({
    seedDbPath,
    dbPath,
    cwd: apiRoot
  });
  const [dbMod, agentsMod] = await Promise.all([
    import("../db.js"),
    import("./agents.js")
  ]);
  prismaClient = dbMod.prisma;

  await prismaClient.$transaction([
    prismaClient.agentMemoryEntry.deleteMany(),
    prismaClient.agentUsageLog.deleteMany(),
    prismaClient.managedAgentConfig.deleteMany({
      where: {
        OR: [
          { agentId: { contains: "hermes" } },
          { agentId: { contains: "openclaw" } }
        ]
      }
    }),
    prismaClient.agentProfile.deleteMany({
      where: {
        OR: [
          { roleId: { contains: "hermes" } },
          { roleId: { contains: "openclaw" } }
        ]
      }
    })
  ]);

  await prismaClient.agentProfile.create({
    data: {
      roleId: "openclaw_dev_agent",
      name: "OpenClaw Dev",
      tagline: "OpenClaw runtime",
      description: "OpenClaw managed dev agent",
      status: "idle",
      workload: 12,
      styles: [],
      skills: { coding: 90 },
      recentHighlights: []
    }
  });

  await prismaClient.managedAgentConfig.create({
    data: {
      agentId: "openclaw_dev_agent",
      displayName: "OpenClaw Dev",
      title: "OpenClaw Developer",
      intro: "runtime worker",
      responsibility: "dev",
      selectedModel: "gpt-4.1",
      defaultModel: "gpt-4.1",
      fallbackModel: null,
      executionMode: "confirm_first",
      requireConfirmation: true,
      autoApproveMinorSteps: false,
      maxPromptTokens: 1000000,
      maxCompletionTokens: null,
      maxDailyTokens: 1000000,
      memoryEnabled: true,
      allowedAgentIds: [],
      toolAllowlist: []
    }
  });

  app = express();
  app.use(express.json());
  app.use("/api/agents", agentsMod.createAgentsRouter());
});

after(async () => {
  if (prismaClient) {
    await prismaClient.$disconnect();
  }
  rmSync(tempDir, { recursive: true, force: true });
});

test("agents route exposes hermes fallback row and integration engine labels", async () => {
  const listRes = await request(app).get("/api/agents");
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.success, true);
  const rows = Array.isArray(listRes.body.data) ? listRes.body.data as Array<Record<string, unknown>> : [];
  assert.equal(rows.length > 0, true);

  const hermes = rows.find((item) => String(item.id) === "hermes-agent-1");
  assert.ok(hermes);
  assert.equal(hermes?.integrationEngine, "hermes");
  assert.equal(hermes?.builtin, true);
  assert.equal(hermes?.role, "ROLE_DESIGN");

  const openclaw = rows.find((item) => String(item.id) === "openclaw_dev_agent");
  assert.ok(openclaw);
  assert.equal(openclaw?.integrationEngine, "openclaw");
});

test("agents detail returns synthetic hermes agent when not persisted", async () => {
  const detailRes = await request(app).get("/api/agents/hermes-agent-1");
  assert.equal(detailRes.status, 200);
  assert.equal(detailRes.body.success, true);
  assert.equal(detailRes.body.data.id, "hermes-agent-1");
  assert.equal(detailRes.body.data.integrationEngine, "hermes");
  assert.equal(detailRes.body.data.builtin, true);
  assert.equal(detailRes.body.data.role, "ROLE_DESIGN");
});
