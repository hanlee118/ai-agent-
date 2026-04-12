import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import express from "express";
import request from "supertest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRoot = path.resolve(__dirname, "../../");
const migrationPath = path.join(apiRoot, "prisma/migrations/20260411103000_add_knowledge_workflow_v2/migration.sql");

const tempDir = mkdtempSync(path.join(os.tmpdir(), "occ-api-knowledge-v2-schema-scope-"));
const dbPath = path.join(tempDir, "test.db");

process.env.NODE_ENV = "test";
process.env.MODEL_PROVIDER = "scripted";
process.env.DATABASE_URL = `file:${dbPath}`;
process.env.HERMES_API_KEY = "test-hermes-key";

let prismaClient: any;
let app: express.Express;

before(async () => {
  execSync(`sqlite3 ${JSON.stringify(dbPath)} < ${JSON.stringify(migrationPath)}`, {
    cwd: apiRoot,
    stdio: "pipe"
  });

  const [dbMod, knowledgeMod, skillsMod, schemaMod] = await Promise.all([
    import("../db.js"),
    import("./knowledge-v2.js"),
    import("./skills-v2.js"),
    import("../workflow-v2/schema-ready.js")
  ]);
  prismaClient = dbMod.prisma;
  schemaMod.clearWorkflowV2SchemaCache();

  app = express();
  app.use(express.json());
  app.use("/api/v1/knowledge", knowledgeMod.createKnowledgeV2Router());
  app.use("/api/v1/skills", skillsMod.createSkillsV2Router());
});

after(async () => {
  if (prismaClient) {
    await prismaClient.$disconnect();
  }
  rmSync(tempDir, { recursive: true, force: true });
});

test("knowledge-v2 remains available when HermesSkill table is missing", async () => {
  const createRes = await request(app)
    .post("/api/v1/knowledge/text")
    .send({
      title: "Schema Scope Test",
      content: "Knowledge schema should be independent from HermesSkill table.",
      scope: "global"
    });
  assert.equal(createRes.status, 201);
  assert.equal(createRes.body.success, true);

  const listRes = await request(app)
    .get("/api/v1/knowledge")
    .query({ query: "independent", limit: 20 });
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.success, true);
  assert.equal(Array.isArray(listRes.body.data.items), true);
  assert.equal(listRes.body.data.items.length >= 1, true);
});

test("skills-v2 still blocks when HermesSkill table is missing", async () => {
  const res = await request(app)
    .get("/api/v1/skills/for-hermes")
    .set("x-hermes-api-key", "test-hermes-key")
    .query({ limit: 10 });

  assert.equal(res.status, 503);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, "SERVICE_UNAVAILABLE");
});

