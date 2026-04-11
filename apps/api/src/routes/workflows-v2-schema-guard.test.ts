import assert from "node:assert/strict";
import { closeSync, mkdtempSync, openSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import express from "express";
import request from "supertest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tempDir = mkdtempSync(path.join(os.tmpdir(), "occ-api-workflow-v2-guard-"));
const dbPath = path.join(tempDir, "test.db");

process.env.NODE_ENV = "test";
process.env.MODEL_PROVIDER = "scripted";
process.env.DATABASE_URL = `file:${dbPath}`;

let prismaClient: any;
let app: express.Express;

before(async () => {
  closeSync(openSync(dbPath, "w"));
  const [dbMod, routesMod] = await Promise.all([
    import("../db.js"),
    import("./workflows-v2.js")
  ]);
  prismaClient = dbMod.prisma;

  app = express();
  app.use(express.json());
  app.use("/api/v1/workflows", routesMod.createWorkflowsV2Router());
});

after(async () => {
  if (prismaClient) {
    await prismaClient.$disconnect();
  }
  rmSync(tempDir, { recursive: true, force: true });
});

test("workflow-v2 endpoints return 503 when schema is not migrated", async () => {
  const healthRes = await request(app).get("/api/v1/workflows/health");
  assert.equal(healthRes.status, 503);
  assert.equal(healthRes.body.success, false);
  assert.equal(healthRes.body.error.code, "SERVICE_UNAVAILABLE");

  const templatesRes = await request(app).get("/api/v1/workflows/templates");
  assert.equal(templatesRes.status, 503);
  assert.equal(templatesRes.body.success, false);
  assert.equal(templatesRes.body.error.code, "SERVICE_UNAVAILABLE");
});
