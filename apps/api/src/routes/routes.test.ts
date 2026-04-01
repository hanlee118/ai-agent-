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
process.env.PROJECT_AUTO_ADVANCE = "false";
process.env.PROJECT_WARMUP = "false";
process.env.ENABLE_API_DOCS = "false";

let app: express.Express;
let fullApp: express.Express;
let prismaClient: any;

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
      "PRAGMA foreign_keys = OFF;",
      "DELETE FROM \"AuthSession\";",
      "DELETE FROM \"ProjectExecution\";",
      "DELETE FROM \"TimelineEvent\";",
      "DELETE FROM \"Deliverable\";",
      "DELETE FROM \"Stage\";",
      "DELETE FROM \"Task\";",
      "DELETE FROM \"Project\";",
      "DELETE FROM \"AuditLog\";",
      "UPDATE \"SystemConfig\"",
      "SET \"adminPasswordHash\" = '',",
      "    \"adminPasswordSalt\" = '',",
      "    \"adminPasswordUpdatedAt\" = NULL,",
      "    \"provider\" = 'scripted',",
      "    \"apiBaseUrl\" = '',",
      "    \"modelName\" = '',",
      "    \"configSource\" = 'default',",
      "    \"lastValidatedAt\" = NULL,",
      "    \"lastValidationStatus\" = 'unknown',",
      "    \"lastValidationError\" = NULL,",
      "    \"updatedAt\" = CURRENT_TIMESTAMP;",
      "PRAGMA foreign_keys = ON;",
      "SQL"
    ].join("\n"),
    {
      cwd: apiRoot,
      stdio: "pipe"
    }
  );

  const [modelsMod, agentsMod, teamMod, roleSetsMod, issuesMod, dbMod, indexMod] = await Promise.all([
    import("./models.js"),
    import("./agents.js"),
    import("./team.js"),
    import("./role-sets.js"),
    import("./issues.js"),
    import("../db.js"),
    import("../index.js")
  ]);

  prismaClient = dbMod.prisma;
  fullApp = indexMod.app;

  app = express();
  app.use(express.json());
  app.use("/api/models", modelsMod.createModelsRouter());
  app.use("/api/agents", agentsMod.createAgentsRouter());
  app.use("/api/team", teamMod.createTeamRouter());
  app.use("/api/role-sets", roleSetsMod.createRoleSetsRouter());
  app.use("/api/issues", issuesMod.createIssuesRouter());
});

describe("Error Matrix: models/agents/team", () => {
  describe("400 VALIDATION_ERROR", () => {
    it("[400][VALIDATION_ERROR] returns unified validation format", async () => {
    const res = await request(app)
      .post("/api/models")
      .send({ provider: "OpenAI" });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, "VALIDATION_ERROR");
    assert.match(String(res.body.error.message), /name and provider are required/i);
    });
  });

  describe("200/201 SUCCESS", () => {
    it("[200/201][SUCCESS] supports model CRUD basic flow", async () => {
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

      const setDefaultRes = await request(app).post(`/api/models/${modelId}/set-default`);
      assert.equal(setDefaultRes.status, 200);
      assert.equal(setDefaultRes.body.success, true);
      assert.equal(setDefaultRes.body.data.model.id, modelId);
      assert.equal(setDefaultRes.body.data.runtime.modelName, "GPT-4 Turbo");
    });

    it("[200/201][SUCCESS] supports agent config and team topology", async () => {
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
});

describe("Error Matrix: auth + projects", () => {
  describe("400/401 AUTH", () => {
    it("[400/401][AUTH] setup/login/logout flow with invalid + valid branches", async () => {
    const weakRes = await request(fullApp)
      .post("/api/auth/setup")
      .send({ password: "short" });
    assert.equal(weakRes.status, 400);

    const password = "Aa1!occStrongPwd";
    const setupRes = await request(fullApp)
      .post("/api/auth/setup")
      .send({ password });
    assert.equal(setupRes.status, 201);
    assert.equal(setupRes.body.setupComplete, true);
    assert.equal(setupRes.body.authenticated, true);

    const setupCookie = setupRes.headers["set-cookie"]?.[0];
    assert.ok(setupCookie);

    const statusWithCookie = await request(fullApp)
      .get("/api/auth/status")
      .set("Cookie", setupCookie ?? "");
    assert.equal(statusWithCookie.status, 200);
    assert.equal(statusWithCookie.body.setupComplete, true);
    assert.equal(statusWithCookie.body.authenticated, true);

    const missingPasswordLogin = await request(fullApp)
      .post("/api/auth/login")
      .send({});
    assert.equal(missingPasswordLogin.status, 400);

    const wrongPasswordLogin = await request(fullApp)
      .post("/api/auth/login")
      .send({ password: "wrong-password" });
    assert.equal(wrongPasswordLogin.status, 401);

    const logoutRes = await request(fullApp)
      .post("/api/auth/logout")
      .set("Cookie", setupCookie ?? "");
    assert.equal(logoutRes.status, 200);
    assert.equal(logoutRes.body.ok, true);

    const validLogin = await request(fullApp)
      .post("/api/auth/login")
      .send({ password });
    assert.equal(validLogin.status, 200);
    assert.equal(validLogin.body.setupComplete, true);
    assert.equal(validLogin.body.authenticated, true);
    assert.ok(validLogin.headers["set-cookie"]?.[0]);
    });
  });

  describe("400/404 PROJECTS", () => {
    it("[400/404][PROJECTS] create/list/get/delete flow with validation + not-found", async () => {
    const invalidCreate = await request(fullApp)
      .post("/api/projects")
      .send({ name: "无描述项目" });
    assert.equal(invalidCreate.status, 400);
    assert.match(String(invalidCreate.body.message), /description is required/i);

    const createRes = await request(fullApp)
      .post("/api/projects")
      .send({
        name: "测试项目-跨境监控",
        description: "构建跨境选品监控与跟品系统，覆盖 TikTok 与亚马逊。",
        team: ["ROLE_PM", "ROLE_ANALYST", "ROLE_PRODUCT", "ROLE_DEV", "ROLE_QA"]
      });

    assert.equal(createRes.status, 201);
    assert.ok(createRes.body.id);
    const projectId = String(createRes.body.id);

    const listRes = await request(fullApp).get("/api/projects");
    assert.equal(listRes.status, 200);
    assert.ok(Array.isArray(listRes.body));
    assert.ok(listRes.body.some((item: { id: string }) => item.id === projectId));

    const detailRes = await request(fullApp).get(`/api/projects/${projectId}`);
    assert.equal(detailRes.status, 200);
    assert.equal(detailRes.body.id, projectId);
    assert.equal(typeof detailRes.body.requiredActions?.length, "number");

    const deleteRes = await request(fullApp).delete(`/api/projects/${projectId}`);
    assert.equal(deleteRes.status, 200);
    assert.equal(deleteRes.body.success, true);
    assert.equal(deleteRes.body.id, projectId);

    const notFoundRes = await request(fullApp).get(`/api/projects/${projectId}`);
    assert.equal(notFoundRes.status, 404);
    });
  });

  describe("400/404/409 PROJECT_ACTIONS", () => {
    it("[400/404/409][PROJECT_ACTIONS] approve/reject/intervene/advance error branches", async () => {
    const createRes = await request(fullApp)
      .post("/api/projects")
      .send({
        name: "测试项目-分支异常覆盖",
        description: "用于覆盖项目动作分支异常的测试项目。",
        team: ["ROLE_PM", "ROLE_ANALYST", "ROLE_DEV"]
      });

    assert.equal(createRes.status, 201);
    const projectId = String(createRes.body.id);

    const advanceMissing = await request(fullApp).post("/api/projects/not-found-project/advance");
    assert.equal(advanceMissing.status, 404);

    const approveNoPending = await request(fullApp).post(`/api/projects/${projectId}/approve`);
    assert.equal(approveNoPending.status, 409);
    assert.equal(approveNoPending.body.success, false);
    assert.equal(approveNoPending.body.error.code, "NO_PENDING_APPROVAL");

    const rejectNoPending = await request(fullApp)
      .post(`/api/projects/${projectId}/reject`)
      .send({ reason: "无待审批时应返回冲突" });
    assert.equal(rejectNoPending.status, 409);
    assert.equal(rejectNoPending.body.success, false);
    assert.equal(rejectNoPending.body.error.code, "NO_PENDING_APPROVAL");

    const interveneMissingCommand = await request(fullApp)
      .post(`/api/projects/${projectId}/intervene`)
      .send({});
    assert.equal(interveneMissingCommand.status, 400);
    assert.match(String(interveneMissingCommand.body.message), /command is required/i);

    const interveneMissingProject = await request(fullApp)
      .post("/api/projects/not-found-project/intervene")
      .send({ command: "resume now" });
    assert.equal(interveneMissingProject.status, 404);

    await prismaClient.project.update({
      where: { id: projectId },
      data: { pendingApproval: true }
    });

    const rejectMissingReason = await request(fullApp)
      .post(`/api/projects/${projectId}/reject`)
      .send({});
    assert.equal(rejectMissingReason.status, 400);
    assert.match(String(rejectMissingReason.body.message), /reason is required/i);

    const advancePendingApproval = await request(fullApp)
      .post(`/api/projects/${projectId}/advance`);
    assert.equal(advancePendingApproval.status, 409);
    assert.equal(advancePendingApproval.body.success, false);
    assert.equal(advancePendingApproval.body.error.code, "REQUIRES_USER_INTERVENTION");

    await prismaClient.project.update({
      where: { id: projectId },
      data: { pendingApproval: false, status: "paused" }
    });

    const advancePaused = await request(fullApp)
      .post(`/api/projects/${projectId}/advance`);
    assert.equal(advancePaused.status, 409);
    assert.match(String(advancePaused.body.message), /not active/i);
    });
  });

  describe("404/422 PROJECT_ACTIONS", () => {
    it("[404/422][PROJECT_ACTIONS] deeper branches with real-model gate failure", async () => {
    const createRes = await request(fullApp)
      .post("/api/projects")
      .send({
        name: "测试项目-动作分支深化",
        description: "用于覆盖 approve/reject/intervene 深化分支。",
        team: ["ROLE_PM", "ROLE_ANALYST", "ROLE_DEV"]
      });
    assert.equal(createRes.status, 201);
    const projectId = String(createRes.body.id);

    const approveMissing = await request(fullApp).post("/api/projects/not-exists/approve");
    assert.equal(approveMissing.status, 404);

    const rejectMissing = await request(fullApp)
      .post("/api/projects/not-exists/reject")
      .send({ reason: "missing project" });
    assert.equal(rejectMissing.status, 404);

    await prismaClient.project.update({
      where: { id: projectId },
      data: { pendingApproval: true }
    });

    const oldGateValue = process.env.ENFORCE_REAL_MODEL_GATE;
    process.env.ENFORCE_REAL_MODEL_GATE = "true";
    const approveGateFail = await request(fullApp).post(`/api/projects/${projectId}/approve`);
    assert.equal(approveGateFail.status, 422);
    assert.equal(approveGateFail.body.success, false);
    assert.equal(approveGateFail.body.error.code, "REAL_MODEL_GATE_FAILED");
    assert.ok(Array.isArray(approveGateFail.body.error.requiredActions));
    assert.ok(
      approveGateFail.body.error.requiredActions.some((item: { action?: string }) => item.action === "refresh_runtime"),
      "REAL_MODEL_GATE_FAILED 必须返回 refresh_runtime 修复动作"
    );
    if (oldGateValue === undefined) {
      delete process.env.ENFORCE_REAL_MODEL_GATE;
    } else {
      process.env.ENFORCE_REAL_MODEL_GATE = oldGateValue;
    }

    const rejectSuccess = await request(fullApp)
      .post(`/api/projects/${projectId}/reject`)
      .send({ reason: "人工确认退回补充材料" });
    assert.equal(rejectSuccess.status, 200);
    assert.equal(rejectSuccess.body.pendingApproval, false);

    const interveneSuccess = await request(fullApp)
      .post(`/api/projects/${projectId}/intervene`)
      .send({ command: "暂停执行，等待产品补充输入" });
    assert.equal(interveneSuccess.status, 200);
    assert.equal(interveneSuccess.body.id, projectId);
    });
  });
});

describe("Error Matrix: issues + role-sets", () => {
  describe("200 SUCCESS", () => {
    it("[200][SUCCESS] returns dynamic role sets", async () => {
    const listRes = await request(app).get("/api/role-sets");
    assert.equal(listRes.status, 200);
    assert.equal(listRes.body.success, true);
    assert.ok(Array.isArray(listRes.body.data));
    assert.ok(listRes.body.data.length > 0);

    const detailRes = await request(app).get("/api/role-sets/ecommerce");
    assert.equal(detailRes.status, 200);
    assert.equal(detailRes.body.success, true);
    assert.equal(detailRes.body.data.roleSet.industryCode, "ecommerce");
    });
  });

  describe("400 VALIDATION_ERROR", () => {
    it("[400][VALIDATION_ERROR] issue preview + confirm required-boundary", async () => {
    const missingInput = await request(app)
      .post("/api/issues/preview")
      .send({});
    assert.equal(missingInput.status, 400);
    assert.equal(missingInput.body.success, false);
    assert.equal(missingInput.body.error.code, "VALIDATION_ERROR");

    const previewRes = await request(app)
      .post("/api/issues/preview")
      .send({
        input: "帮我搭建一个跨境电商爆品监控系统，当某个商品在 TikTok 或亚马逊流量暴涨时自动预警并给出跟品链接。",
        industryCode: "ecommerce",
        sourceType: "meeting_notes",
        debateMode: "off"
      });

    assert.equal(previewRes.status, 200);
    assert.equal(previewRes.body.success, true);
    assert.ok(previewRes.body.data.issueId);
    assert.ok(Array.isArray(previewRes.body.data.questions));
    assert.ok((previewRes.body.data.contextAlignment?.matchedGoals || []).length > 0);
    assert.ok((previewRes.body.data.contextAlignment?.matchedPrinciples || []).length > 0);

    const issueId = String(previewRes.body.data.issueId);
    const missingRequiredConfirm = await request(app)
      .post(`/api/issues/${issueId}/confirm`)
      .send({
        clarificationAnswers: {}
      });
    assert.equal(missingRequiredConfirm.status, 400);
    assert.equal(missingRequiredConfirm.body.success, false);
    assert.equal(missingRequiredConfirm.body.error.code, "VALIDATION_ERROR");

    const requiredQuestions = (previewRes.body.data.questions as Array<{ id: string; required?: boolean }>)
      .filter((item) => item.required)
      .map((item) => item.id);
    const clarificationAnswers = requiredQuestions.reduce<Record<string, string>>((acc, id) => {
      acc[id] = `回答-${id}`;
      return acc;
    }, {});

    const confirmRes = await request(app)
      .post(`/api/issues/${issueId}/confirm`)
      .send({
        clarificationAnswers,
        finalName: "跨境电商爆品跟品机器人",
        finalDescription: "基于 TikTok/亚马逊热点波动实现爆品监控与跟品。",
        conflictResolution: "以当前 issue 场景为准，覆盖长期记忆中的冲突项。"
      });

    assert.equal(confirmRes.status, 200);
    assert.equal(confirmRes.body.success, true);
    assert.ok(confirmRes.body.data.issue);
    assert.ok(confirmRes.body.data.project);
    assert.equal(confirmRes.body.data.issue.status, "confirmed");
    });
  });

  describe("400/404 CONFLICT_GUARD", () => {
    it("[400/404][CONFLICT_GUARD] issue conflict and missing issue cases", async () => {
    const previewSceneMiss = await request(app)
      .post("/api/issues/preview")
      .send({
        input: "帮我做公司内部 OA 报销系统，并优化部门审批流。",
        industryCode: "ecommerce",
        sourceType: "text",
        debateMode: "off"
      });

    assert.equal(previewSceneMiss.status, 200);
    const sceneMissIssueId = String(previewSceneMiss.body.data.issueId);
    const conflicts = previewSceneMiss.body.data.conflicts as Array<{ id: string }>;
    assert.ok(conflicts.some((item) => item.id === "crossborder-scene-not-hit"));

    const requiredQuestions = (previewSceneMiss.body.data.questions as Array<{ id: string; required?: boolean }>)
      .filter((item) => item.required)
      .map((item) => item.id);
    const fullAnswers = requiredQuestions.reduce<Record<string, string>>((acc, id) => {
      acc[id] = `回答-${id}`;
      return acc;
    }, {});

    const confirmSceneMiss = await request(app)
      .post(`/api/issues/${sceneMissIssueId}/confirm`)
      .send({
        clarificationAnswers: fullAnswers,
        conflictResolution: "先按输入需求继续"
      });
    assert.equal(confirmSceneMiss.status, 400);
    assert.equal(confirmSceneMiss.body.success, false);
    assert.match(String(confirmSceneMiss.body.error.message), /场景命中校验未通过/);

    const confirmMissingIssue = await request(app)
      .post("/api/issues/not-exists/confirm")
      .send({ clarificationAnswers: {} });
    assert.equal(confirmMissingIssue.status, 404);
    assert.equal(confirmMissingIssue.body.success, false);
    assert.equal(confirmMissingIssue.body.error.code, "NOT_FOUND");
    });
  });
});
