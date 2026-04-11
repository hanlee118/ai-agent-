import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
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

const tempDir = mkdtempSync(path.join(os.tmpdir(), "occ-api-skills-v2-"));
const dbPath = path.join(tempDir, "test.db");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = `file:${dbPath}`;
process.env.HERMES_API_KEY = "test-hermes-key";

let prismaClient: any;
let app: express.Express;

before(async () => {
  copyFileSync(seedDbPath, dbPath);
  for (const migrationPath of migrationPaths) {
    execSync(`sqlite3 ${JSON.stringify(dbPath)} < ${JSON.stringify(migrationPath)}`, {
      cwd: apiRoot,
      stdio: "pipe"
    });
  }

  const [dbMod, skillsMod] = await Promise.all([
    import("../db.js"),
    import("./skills-v2.js")
  ]);
  prismaClient = dbMod.prisma;

  app = express();
  app.use(express.json());
  app.use("/api/v1/skills", skillsMod.createSkillsV2Router());
});

after(async () => {
  if (prismaClient) {
    await prismaClient.$disconnect();
  }
  rmSync(tempDir, { recursive: true, force: true });
});

test("skills-v2 exports built-in skills for hermes", async () => {
  const res = await request(app)
    .get("/api/v1/skills/for-hermes")
    .set("x-hermes-api-key", "test-hermes-key")
    .query({ limit: 10, stageType: "DESIGN" });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(Array.isArray(res.body.data.skills), true);
  const keys = (res.body.data.skills as Array<{ skillKey: string }>).map((item) => item.skillKey);
  assert.equal(keys.includes("design-to-code"), true);
});

test("skills-v2 imports hermes skills and serves them back", async () => {
  const importRes = await request(app)
    .post("/api/v1/skills/import/hermes")
    .set("x-hermes-api-key", "test-hermes-key")
    .send({
      hermesSkillId: "hermes-skill-001",
      projectId: "KBV2-PROJECT-001",
      skillData: {
        skillKey: "qa-regression-checklist",
        name: "QA Regression Checklist",
        type: "procedural",
        instruction: "Run regression checklist after each deployment.",
        manifest: { stageTypes: ["ACCEPT"], source: "hermes" }
      }
    });
  assert.equal(importRes.status, 201);
  assert.equal(importRes.body.success, true);
  assert.equal(importRes.body.data.skill.skillKey, "qa-regression-checklist");

  const exportRes = await request(app)
    .get("/api/v1/skills/for-hermes")
    .set("x-hermes-api-key", "test-hermes-key")
    .query({ stageType: "ACCEPT", limit: 20 });
  assert.equal(exportRes.status, 200);
  const keys = (exportRes.body.data.skills as Array<{ skillKey: string }>).map((item) => item.skillKey);
  assert.equal(keys.includes("qa-regression-checklist"), true);

  const unauthorized = await request(app)
    .get("/api/v1/skills/for-hermes")
    .query({ stageType: "ACCEPT", limit: 20 });
  assert.equal(unauthorized.status, 401);
});
