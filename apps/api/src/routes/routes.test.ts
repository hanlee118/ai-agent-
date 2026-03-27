import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import express from "express";
import request from "supertest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRoot = path.resolve(__dirname, "../../");
const seedDbPath = path.join(apiRoot, "prisma/dev.db");

const tempDir = mkdtempSync(path.join(os.tmpdir(), "occ-api-routes-"));
const dbPath = path.join(tempDir, "test.db");

process.env.NODE_ENV = "test";
process.env.MODEL_PROVIDER = "scripted";
process.env.DATABASE_URL = `file:${dbPath}`;

let app: express.Express;
let prismaClient: { $disconnect: () => Promise<void> } | undefined;

after(async () => {
  if (prismaClient) {
    await prismaClient.$disconnect();
  }

  rmSync(tempDir, { recursive: true, force: true });
});

before(async () => {
  copyFileSync(seedDbPath, dbPath);

  execSync(
    [
      `sqlite3 ${JSON.stringify(dbPath)} <<'SQL'`,
      "PRAGMA foreign_keys = ON;",
      "CREATE TABLE IF NOT EXISTS \"Model\" (",
      "  \"id\" TEXT NOT NULL PRIMARY KEY,",
      "  \"name\" TEXT NOT NULL,",
      "  \"provider\" TEXT NOT NULL,",
      "  \"apiKey\" TEXT,",
      "  \"apiBaseUrl\" TEXT,",
      "  \"status\" TEXT NOT NULL DEFAULT 'Offline',",
      "  \"totalTokens\" INTEGER NOT NULL DEFAULT 0,",
      "  \"dailyTokens\" INTEGER NOT NULL DEFAULT 0,",
      "  \"tokenLimit\" INTEGER NOT NULL DEFAULT 1000000,",
      "  \"createdAt\" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,",
      "  \"updatedAt\" DATETIME NOT NULL",
      ");",
      "CREATE TABLE IF NOT EXISTS \"ModelLog\" (",
      "  \"id\" TEXT NOT NULL PRIMARY KEY,",
      "  \"modelId\" TEXT NOT NULL,",
      "  \"timestamp\" DATETIME NOT NULL,",
      "  \"type\" TEXT NOT NULL,",
      "  \"content\" TEXT NOT NULL,",
      "  \"label\" TEXT,",
      "  CONSTRAINT \"ModelLog_modelId_fkey\" FOREIGN KEY (\"modelId\") REFERENCES \"Model\" (\"id\") ON DELETE CASCADE ON UPDATE CASCADE",
      ");",
      "CREATE TABLE IF NOT EXISTS \"AgentSoul\" (",
      "  \"agentId\" TEXT NOT NULL PRIMARY KEY,",
      "  \"content\" TEXT NOT NULL,",
      "  \"updatedAt\" DATETIME NOT NULL",
      ");",
      "CREATE TABLE IF NOT EXISTS \"AgentSop\" (",
      "  \"agentId\" TEXT NOT NULL PRIMARY KEY,",
      "  \"steps\" TEXT NOT NULL,",
      "  \"updatedAt\" DATETIME NOT NULL",
      ");",
      "SQL"
    ].join("\n"),
    {
      cwd: apiRoot,
      stdio: "pipe"
    }
  );

  const [modelsMod, agentsMod, teamMod, dbMod] = await Promise.all([
    import("./models.js"),
    import("./agents.js"),
    import("./team.js"),
    import("../db.js")
  ]);

  prismaClient = dbMod.prisma;

  app = express();
  app.use(express.json());
  app.use("/api/models", modelsMod.createModelsRouter());
  app.use("/api/agents", agentsMod.createAgentsRouter());
  app.use("/api/team", teamMod.createTeamRouter());
});

describe("Routes: unified response", () => {
  it("returns validation error with unified format", async () => {
    const res = await request(app)
      .post("/api/models")
      .send({ provider: "OpenAI" });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, "VALIDATION_ERROR");
    assert.match(String(res.body.error.message), /name and provider are required/i);
  });

  it("supports model CRUD basic flow", async () => {
    const createRes = await request(app)
      .post("/api/models")
      .send({
        name: "GPT-4 Turbo",
        provider: "OpenAI",
        apiKey: "sk-test-12345678",
        apiBaseUrl: "https://api.openai.com/v1",
        tokenLimit: 2_000_000
      });

    assert.equal(createRes.status, 201);
    assert.equal(createRes.body.success, true);
    assert.ok(createRes.body.data.id);
    const modelId = String(createRes.body.data.id);

    const getRes = await request(app).get(`/api/models/${modelId}`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.success, true);
    assert.equal(getRes.body.data.id, modelId);
    assert.equal(getRes.body.data.name, "GPT-4 Turbo");

    const listRes = await request(app).get("/api/models");
    assert.equal(listRes.status, 200);
    assert.equal(listRes.body.success, true);
    assert.ok(Array.isArray(listRes.body.data));
    assert.ok(listRes.body.data.some((item: { id: string }) => item.id === modelId));

    const metricsRes = await request(app).get(`/api/models/${modelId}/metrics`);
    assert.equal(metricsRes.status, 200);
    assert.equal(metricsRes.body.success, true);
    assert.ok(Array.isArray(metricsRes.body.data.weeklyTokens));

    const healthRes = await request(app).post(`/api/models/${modelId}/health-check`);
    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.body.success, true);
    assert.equal(typeof healthRes.body.data.reachable, "boolean");

    const logsRes = await request(app).get(`/api/models/${modelId}/logs?type=system&limit=10`);
    assert.equal(logsRes.status, 200);
    assert.equal(logsRes.body.success, true);
    assert.ok(Array.isArray(logsRes.body.data));
  });

  it("supports agent config and team topology", async () => {
    const modelRes = await request(app)
      .post("/api/models")
      .send({
        name: "Claude 3.5",
        provider: "Anthropic",
        tokenLimit: 3_000_000
      });

    assert.equal(modelRes.status, 201);
    const modelId = String(modelRes.body.data.id);

    const createAgentRes = await request(app)
      .post("/api/agents")
      .send({
        name: "研发 Agent",
        role: "ROLE_DEV_2",
        modelId,
        soul: "你是研发 Agent",
        sop: ["分析需求", "编写代码", "提交 Review"]
      });

    assert.equal(createAgentRes.status, 201);
    assert.equal(createAgentRes.body.success, true);
    assert.equal(createAgentRes.body.data.id, "ROLE_DEV_2");

    const switchModelRes = await request(app)
      .patch("/api/agents/ROLE_DEV_2/model")
      .send({ modelId });

    assert.equal(switchModelRes.status, 200);
    assert.equal(switchModelRes.body.success, true);

    const soulRes = await request(app)
      .patch("/api/agents/ROLE_DEV_2/soul")
      .send({ content: "新的 SOUL" });

    assert.equal(soulRes.status, 200);
    assert.equal(soulRes.body.success, true);
    assert.equal(soulRes.body.data.content, "新的 SOUL");

    const sopRes = await request(app)
      .patch("/api/agents/ROLE_DEV_2/sop")
      .send({ steps: ["步骤1", "步骤2"] });

    assert.equal(sopRes.status, 200);
    assert.equal(sopRes.body.success, true);
    assert.deepEqual(sopRes.body.data.steps, ["步骤1", "步骤2"]);

    const detailRes = await request(app).get("/api/agents/ROLE_DEV_2");
    assert.equal(detailRes.status, 200);
    assert.equal(detailRes.body.success, true);
    assert.equal(detailRes.body.data.currentModelId, modelId);

    const topologyRes = await request(app).get("/api/team/topology");
    assert.equal(topologyRes.status, 200);
    assert.equal(topologyRes.body.success, true);
    assert.ok(Array.isArray(topologyRes.body.data.nodes));
    assert.ok(Array.isArray(topologyRes.body.data.edges));
  });
});
