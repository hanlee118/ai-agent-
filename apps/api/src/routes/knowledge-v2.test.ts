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

const tempDir = mkdtempSync(path.join(os.tmpdir(), "occ-api-knowledge-v2-"));
const dbPath = path.join(tempDir, "test.db");

process.env.NODE_ENV = "test";
process.env.MODEL_PROVIDER = "scripted";
process.env.DATABASE_URL = `file:${dbPath}`;
process.env.PROJECT_AUTO_ADVANCE = "false";
process.env.PROJECT_WARMUP = "false";
process.env.ENFORCE_REAL_MODEL_GATE = "false";
process.env.HERMES_API_KEY = "test-hermes-key";

let prismaClient: any;
let app: express.Express;

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

  const [dbMod, knowledgeMod] = await Promise.all([
    import("../db.js"),
    import("./knowledge-v2.js")
  ]);
  prismaClient = dbMod.prisma;

  await prismaClient.project.upsert({
    where: { id: "KBV2-PROJECT-001" },
    create: {
      id: "KBV2-PROJECT-001",
      name: "Knowledge V2 Test",
      description: "knowledge v2 test",
      parsedKeywords: ["knowledge", "test"],
      parsedConstraints: ["local"],
      parsedRisks: ["none"],
      parsedSuggestedTeam: ["ROLE_PM"],
      parsedSummary: "summary",
      status: "active",
      currentStage: "INIT",
      progress: 0,
      pendingApproval: false,
      currentRole: "ROLE_PM",
      team: ["ROLE_PM"],
      summary: "summary",
      liveTitle: "live",
      liveBody: "body",
      liveStartedAt: new Date(),
      liveProvider: "scripted"
    },
    update: {}
  });

  app = express();
  app.use(express.json());
  app.use("/api/v1/knowledge", knowledgeMod.createKnowledgeV2Router());
});

after(async () => {
  if (prismaClient) {
    await prismaClient.$disconnect();
  }
  rmSync(tempDir, { recursive: true, force: true });
});

test("knowledge-v2 ingests text and can search/context/summary", async () => {
  const createRes = await request(app)
    .post("/api/v1/knowledge/text")
    .send({
      title: "系统设计原则",
      content: "采用 TypeScript 与 Prisma，强调质量门禁、可观测性与可回滚。",
      scope: "project",
      projectId: "KBV2-PROJECT-001",
      tags: ["typescript", "prisma", "quality-gate"]
    });
  assert.equal(createRes.status, 201);
  assert.equal(createRes.body.success, true);

  const searchRes = await request(app)
    .post("/api/v1/knowledge/search")
    .send({
      query: "质量门禁 prisma",
      projectId: "KBV2-PROJECT-001",
      limit: 3
    });
  assert.equal(searchRes.status, 200);
  assert.equal(searchRes.body.success, true);
  assert.equal(Array.isArray(searchRes.body.data.results), true);
  assert.equal(searchRes.body.data.results.length > 0, true);

  const listRes = await request(app)
    .get("/api/v1/knowledge")
    .query({ projectId: "KBV2-PROJECT-001", limit: 10 });
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.success, true);
  const listItems = Array.isArray(listRes.body.data.items)
    ? listRes.body.data.items as Array<{ sourceEngine?: string }>
    : [];
  assert.equal(listItems.length > 0, true);
  assert.equal(typeof listItems[0]?.sourceEngine, "string");

  const contextRes = await request(app)
    .post("/api/v1/knowledge/context")
    .send({
      projectId: "KBV2-PROJECT-001",
      currentStage: "requirements_design",
      userQuery: "请给我本阶段的质量与技术背景"
    });
  assert.equal(contextRes.status, 200);
  assert.equal(contextRes.body.success, true);
  assert.match(String(contextRes.body.data.context), /相关背景知识/);

  // Inject episodic memory to validate summary endpoint.
  await prismaClient.knowledgeItem.create({
    data: {
      scope: "project",
      projectId: "KBV2-PROJECT-001",
      type: "text",
      title: "阶段复盘",
      content: "上一轮在 DEV 阶段发现发布脚本缺失，已补齐。",
      metadata: {},
      tags: [],
      stageContext: [],
      techStack: [],
      memoryType: "episodic"
    }
  });

  const summaryRes = await request(app).get("/api/v1/knowledge/project/KBV2-PROJECT-001/summary");
  assert.equal(summaryRes.status, 200);
  assert.equal(summaryRes.body.success, true);
  assert.match(String(summaryRes.body.data.summary), /阶段复盘/);
});

test("knowledge-v2 enforces scope binding for create/upload/update", async () => {
  const createMissingProject = await request(app)
    .post("/api/v1/knowledge/text")
    .send({
      title: "缺少 projectId 的项目知识",
      content: "这条应该被拒绝",
      scope: "project"
    });
  assert.equal(createMissingProject.status, 400);
  assert.equal(createMissingProject.body.success, false);
  assert.match(String(createMissingProject.body.error?.message || ""), /project scope requires projectId/);

  const uploadMissingAgent = await request(app)
    .post("/api/v1/knowledge/upload")
    .send({
      scope: "agent",
      fileName: "agent-note.txt",
      fileContent: "agent scope without agentId",
      tags: ["scope-check"]
    });
  assert.equal(uploadMissingAgent.status, 400);
  assert.equal(uploadMissingAgent.body.success, false);
  assert.match(String(uploadMissingAgent.body.error?.message || ""), /agent scope requires agentId/);

  const createGlobal = await request(app)
    .post("/api/v1/knowledge/text")
    .send({
      title: "可更新条目",
      content: "用于 scope 更新校验",
      scope: "global"
    });
  assert.equal(createGlobal.status, 201);
  const id = String(createGlobal.body.data.id || "");
  assert.ok(id);

  const patchInvalidScope = await request(app)
    .patch(`/api/v1/knowledge/${id}`)
    .send({
      scope: "agent"
    });
  assert.equal(patchInvalidScope.status, 400);
  assert.equal(patchInvalidScope.body.success, false);
  assert.match(String(patchInvalidScope.body.error?.message || ""), /agent scope requires agentId/);
});

test("knowledge-v2 supports multipart file upload for document ingestion", async () => {
  const uploadRes = await request(app)
    .post("/api/v1/knowledge/upload")
    .field("scope", "project")
    .field("projectId", "KBV2-PROJECT-001")
    .field("agentId", "ROLE_PM")
    .field("tags", JSON.stringify(["upload", "guide"]))
    .attach("file", Buffer.from("这是上传的知识文档。\n\n包含阶段目标、风险与验收要点。", "utf-8"), "kb-guide.md");

  assert.equal(uploadRes.status, 200);
  assert.equal(uploadRes.body.success, true);
  assert.equal(Number(uploadRes.body.data.count) >= 1, true);
  assert.equal(Array.isArray(uploadRes.body.data.items), true);
  assert.equal(uploadRes.body.data.items.length >= 1, true);

  const listRes = await request(app)
    .get("/api/v1/knowledge")
    .query({ projectId: "KBV2-PROJECT-001", query: "验收要点", limit: 20 });
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.success, true);
  assert.equal(
    (listRes.body.data.items as Array<{ title: string }>).some((item) => item.title.includes("kb-guide.md")),
    true
  );
});

test("knowledge-v2 infers stage context and memory type from content", async () => {
  const createRes = await request(app)
    .post("/api/v1/knowledge/text")
    .send({
      title: "QA 验收复盘记录",
      content: "本次 QA 验收后复盘：发现发布阻塞问题并形成经验教训与回归测试清单。",
      scope: "project",
      projectId: "KBV2-PROJECT-001",
      tags: ["qa", "复盘"]
    });

  assert.equal(createRes.status, 201);
  assert.equal(createRes.body.success, true);
  const id = String(createRes.body.data.id || "");
  assert.ok(id);

  const detailRes = await request(app).get(`/api/v1/knowledge/${id}`);
  assert.equal(detailRes.status, 200);
  assert.equal(detailRes.body.success, true);
  const detail = detailRes.body.data as {
    stageContext?: string[];
    memoryType?: string;
    importanceScore?: number;
  };
  assert.equal(Array.isArray(detail.stageContext), true);
  assert.equal((detail.stageContext || []).includes("qa_acceptance"), true);
  assert.equal(detail.memoryType, "episodic");
  assert.equal(typeof detail.importanceScore, "number");
  assert.equal(Number(detail.importanceScore) >= 0.6, true);
});

test("knowledge-v2 search supports stage alias matching", async () => {
  const createRes = await request(app)
    .post("/api/v1/knowledge/text")
    .send({
      title: "QA 阶段回归清单",
      content: "用于 QA 验收阶段的回归测试任务与问题追踪建议。",
      scope: "project",
      projectId: "KBV2-PROJECT-001",
      tags: ["qa", "testing"]
    });
  assert.equal(createRes.status, 201);
  assert.equal(createRes.body.success, true);

  const searchRes = await request(app)
    .post("/api/v1/knowledge/search")
    .send({
      query: "qa",
      projectId: "KBV2-PROJECT-001",
      stage: "qa",
      limit: 10
    });
  assert.equal(searchRes.status, 200);
  assert.equal(searchRes.body.success, true);
  const results = searchRes.body.data.results as Array<{ title: string }>;
  assert.equal(Array.isArray(results), true);
  assert.equal(results.length > 0, true);
});

test("knowledge-v2 supports hermes sync and export endpoints", async () => {
  const syncRes = await request(app)
    .post("/api/v1/knowledge/sync-from-hermes")
    .set("x-hermes-api-key", "test-hermes-key")
    .send({
      projectId: "KBV2-PROJECT-001",
      title: "Hermes 设计复盘",
      content: "本次视觉设计阶段确认主色、栅格与组件命名规范。",
      memoryType: "episodic",
      tags: ["hermes", "design"],
      stageContext: ["visual_design"],
      techStack: ["react", "stitch"],
      importanceScore: 0.82
    });
  assert.equal(syncRes.status, 201);
  assert.equal(syncRes.body.success, true);

  const exportRes = await request(app)
    .get("/api/v1/knowledge/for-hermes")
    .set("x-hermes-api-key", "test-hermes-key")
    .query({ projectId: "KBV2-PROJECT-001", limit: 10 });
  assert.equal(exportRes.status, 200);
  assert.equal(exportRes.body.success, true);
  assert.equal(Array.isArray(exportRes.body.data.items), true);
  assert.equal(exportRes.body.data.items.some((item: { title: string }) => item.title.includes("Hermes")), true);

  const unauthorizedRes = await request(app)
    .get("/api/v1/knowledge/for-hermes")
    .query({ projectId: "KBV2-PROJECT-001", limit: 10 });
  assert.equal(unauthorizedRes.status, 401);
  assert.equal(unauthorizedRes.body.success, false);
});

test("knowledge-v2 supports CRUD and curation workflow", async () => {
  const seedA = await prismaClient.knowledgeItem.create({
    data: {
      scope: "project",
      projectId: "KBV2-PROJECT-001",
      type: "text",
      title: "UI 规范 v1",
      content: "React + Stitch 设计稿，包含按钮与表单规范。",
      metadata: {},
      tags: [" UI ", "react"],
      stageContext: ["visual", "视觉设计"],
      techStack: ["React", "stitch"],
      memoryType: "semantic"
    }
  });
  await prismaClient.knowledgeItem.create({
    data: {
      scope: "project",
      projectId: "KBV2-PROJECT-001",
      type: "text",
      title: "UI 规范 v1",
      content: "React + Stitch 设计稿，包含按钮与表单规范。",
      metadata: {},
      tags: ["ui", "react"],
      stageContext: ["visual_design"],
      techStack: ["react", "stitch"],
      memoryType: "semantic"
    }
  });

  const listRes = await request(app)
    .get("/api/v1/knowledge")
    .query({ projectId: "KBV2-PROJECT-001", limit: 50 });
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.success, true);
  assert.equal(Array.isArray(listRes.body.data.items), true);
  assert.equal(listRes.body.data.items.length >= 2, true);

  const stageFilteredListRes = await request(app)
    .get("/api/v1/knowledge")
    .query({ projectId: "KBV2-PROJECT-001", stageContext: "visual_design", limit: 50 });
  assert.equal(stageFilteredListRes.status, 200);
  assert.equal(stageFilteredListRes.body.success, true);
  assert.equal(Array.isArray(stageFilteredListRes.body.data.items), true);
  assert.equal(stageFilteredListRes.body.data.items.length >= 2, true);

  const patchRes = await request(app)
    .patch(`/api/v1/knowledge/${seedA.id}`)
    .send({
      tags: ["UI", "Design System", "ui"],
      stageContext: ["visual", "design"],
      techStack: ["React", "TypeScript", "react"],
      title: " UI   规范 v1 "
    });
  assert.equal(patchRes.status, 200);
  assert.equal(patchRes.body.success, true);

  const detailRes = await request(app).get(`/api/v1/knowledge/${seedA.id}`);
  assert.equal(detailRes.status, 200);
  assert.equal(detailRes.body.success, true);
  assert.match(String(detailRes.body.data.title), /UI 规范 v1/);
  assert.equal(Array.isArray(detailRes.body.data.tags), true);

  const previewRes = await request(app)
    .post("/api/v1/knowledge/curation/preview")
    .send({ projectId: "KBV2-PROJECT-001", limit: 200 });
  assert.equal(previewRes.status, 200);
  assert.equal(previewRes.body.success, true);
  assert.equal(Array.isArray(previewRes.body.data.duplicateGroups), true);
  assert.equal(previewRes.body.data.duplicateGroups.length > 0, true);

  const applyRes = await request(app)
    .post("/api/v1/knowledge/curation/apply")
    .send({ projectId: "KBV2-PROJECT-001", limit: 200, mergeDuplicates: true, normalizeFields: true });
  assert.equal(applyRes.status, 200);
  assert.equal(applyRes.body.success, true);
  assert.equal(Number(applyRes.body.data.mergedCount) >= 1, true);

  const postListRes = await request(app)
    .get("/api/v1/knowledge")
    .query({ projectId: "KBV2-PROJECT-001", query: "UI 规范 v1", limit: 50 });
  assert.equal(postListRes.status, 200);
  const items = postListRes.body.data.items as Array<{ id: string }>;
  assert.equal(items.length >= 1, true);

  const deleteTarget = items[0]?.id;
  assert.equal(Boolean(deleteTarget), true);
  const deleteRes = await request(app).delete(`/api/v1/knowledge/${deleteTarget}`);
  assert.equal(deleteRes.status, 200);
  assert.equal(deleteRes.body.success, true);

  const remainIds = items.slice(1).map((item) => item.id);
  if (remainIds.length > 0) {
    const bulkDeleteRes = await request(app)
      .post("/api/v1/knowledge/bulk-delete")
      .send({ ids: remainIds });
    assert.equal(bulkDeleteRes.status, 200);
    assert.equal(bulkDeleteRes.body.success, true);
  }
});

test("knowledge-v2 operation history supports rollback", async () => {
  const createRes = await request(app)
    .post("/api/v1/knowledge/text")
    .send({
      title: "可回滚知识",
      content: "这是一条用于回滚验证的知识记录。",
      scope: "project",
      projectId: "KBV2-PROJECT-001",
      tags: ["rollback", "history"]
    });
  assert.equal(createRes.status, 201);
  const knowledgeId = String(createRes.body.data.id);
  assert.ok(knowledgeId);

  const deleteRes = await request(app)
    .delete(`/api/v1/knowledge/${knowledgeId}?triggeredBy=tester`);
  assert.equal(deleteRes.status, 200);
  assert.equal(deleteRes.body.success, true);

  const historyRes = await request(app)
    .get("/api/v1/knowledge/history")
    .query({
      projectId: "KBV2-PROJECT-001",
      operationType: "delete_single",
      limit: 20
    });
  assert.equal(historyRes.status, 200);
  assert.equal(historyRes.body.success, true);
  const logs = historyRes.body.data.logs as Array<{ id: string; canRollback: boolean }>;
  assert.equal(Array.isArray(logs), true);
  assert.equal(logs.length > 0, true);
  assert.equal(Boolean(logs[0]?.canRollback), true);

  const rollbackRes = await request(app)
    .post(`/api/v1/knowledge/history/${logs[0].id}/rollback`)
    .send({ triggeredBy: "tester" });
  assert.equal(rollbackRes.status, 200);
  assert.equal(rollbackRes.body.success, true);
  assert.equal(rollbackRes.body.data.success, true);
  assert.equal(Number(rollbackRes.body.data.restoredCount) >= 1, true);

  const detailRes = await request(app).get(`/api/v1/knowledge/${knowledgeId}`);
  assert.equal(detailRes.status, 200);
  assert.equal(detailRes.body.success, true);
});
