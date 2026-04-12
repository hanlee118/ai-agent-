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
const migrationPaths = [
  path.join(apiRoot, "prisma/migrations/20260411103000_add_knowledge_workflow_v2/migration.sql"),
  path.join(apiRoot, "prisma/migrations/20260411124500_add_knowledge_operation_logs/migration.sql"),
  path.join(apiRoot, "prisma/migrations/20260411193000_add_hermes_skill_sync/migration.sql"),
  path.join(apiRoot, "prisma/migrations/20260411205000_add_mixed_project_mode/migration.sql"),
  path.join(apiRoot, "prisma/migrations/20260413091000_add_agent_integration_engine/migration.sql")
];

const tempDir = mkdtempSync(path.join(os.tmpdir(), "occ-api-routes-"));
const dbPath = path.join(tempDir, "test.db");

process.env.NODE_ENV = "test";
process.env.MODEL_PROVIDER = "scripted";
process.env.DATABASE_URL = `file:${dbPath}`;
process.env.PROJECT_AUTO_ADVANCE = "false";
process.env.PROJECT_WARMUP = "false";
process.env.PROJECT_MANUAL_ADVANCE_ENABLED = "false";
process.env.ENABLE_API_DOCS = "false";
process.env.PROJECT_ISSUE_FIRST_LOCAL_ENFORCED = "false";
process.env.PROJECT_DIRECT_CREATE_ENABLED = "true";
process.env.GITLAB_TOKEN = "";
process.env.GITLAB_DEFAULT_PROJECT = "";
process.env.GITLAB_DEFAULT_PROJECT_ID = "";

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

  for (const migrationPath of migrationPaths) {
    try {
      execSync(
        `sqlite3 ${JSON.stringify(dbPath)} < ${JSON.stringify(migrationPath)}`,
        {
          cwd: apiRoot,
          stdio: "pipe"
        }
      );
    } catch {
      // Ignore idempotent migration replay errors in newer seed databases.
    }
  }

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

    const switchEngineRes = await request(app)
      .patch("/api/agents/ROLE_DEV_2/engine")
      .send({ integrationEngine: "hermes" });

    assert.equal(switchEngineRes.status, 200);
    assert.equal(switchEngineRes.body.success, true);
    assert.equal(switchEngineRes.body.data.integrationEngine, "hermes");

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
    assert.equal(typeof detailRes.body.postCreatePrep?.issueGateEnabled, "boolean");
    assert.equal(typeof detailRes.body.postCreatePrep?.doneCount, "number");
    assert.ok(Array.isArray(detailRes.body.postCreatePrep?.checks));

    const invalidPatchRes = await request(fullApp)
      .patch(`/api/projects/${projectId}`)
      .send({});
    assert.equal(invalidPatchRes.status, 400);

    const patchedDescription = [
      String(detailRes.body.description || ""),
      "",
      "## 多Agent需求讨论结论",
      "- 已完成需求讨论与共识",
      "",
      "## 项目详情理解确认草案",
      "- 已写回并准备进入阶段执行",
    ].join("\n");
    const patchRes = await request(fullApp)
      .patch(`/api/projects/${projectId}`)
      .send({
        description: patchedDescription,
        team: ["ROLE_PM", "ROLE_ANALYST", "ROLE_DESIGN"],
      });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.body.id, projectId);
    assert.match(String(patchRes.body.description || ""), /多Agent需求讨论结论/);

    const detailAfterPatchRes = await request(fullApp).get(`/api/projects/${projectId}`);
    assert.equal(detailAfterPatchRes.status, 200);
    assert.equal(detailAfterPatchRes.body.postCreatePrep?.checks?.find((item: { key: string }) => item.key === "debate")?.done, true);
    assert.equal(detailAfterPatchRes.body.postCreatePrep?.checks?.find((item: { key: string }) => item.key === "analysis")?.done, true);

    const deleteRes = await request(fullApp).delete(`/api/projects/${projectId}`);
    assert.equal(deleteRes.status, 200);
    assert.equal(deleteRes.body.success, true);
    assert.equal(deleteRes.body.id, projectId);

    const notFoundRes = await request(fullApp).get(`/api/projects/${projectId}`);
    assert.equal(notFoundRes.status, 404);
    });

    it("[200][PROJECTS] postCreatePrep should auto-complete when execution already started", async () => {
    const createRes = await request(fullApp)
      .post("/api/projects")
      .send({
        name: "测试项目-执行已启动不应卡 Step1",
        description: "用于验证进入执行阶段后，postCreatePrep 不再阻塞。",
        team: ["ROLE_PM", "ROLE_ANALYST", "ROLE_DESIGN", "ROLE_DEV"]
      });

    assert.equal(createRes.status, 201);
    const projectId = String(createRes.body.id);

    await prismaClient.task.updateMany({
      where: { projectId, stageType: "ANALYSIS" },
      data: { status: "in_progress" },
    });

    const detailRes = await request(fullApp).get(`/api/projects/${projectId}`);
    assert.equal(detailRes.status, 200);
    assert.equal(detailRes.body.postCreatePrep?.executionStarted, true);
    assert.equal(detailRes.body.postCreatePrep?.shouldEnforce, false);
    assert.equal(detailRes.body.postCreatePrep?.completed, true);
    assert.equal(
      Array.isArray(detailRes.body.postCreatePrep?.checks)
      && detailRes.body.postCreatePrep.checks.every((item: { done: boolean }) => item.done),
      true,
    );

    const deleteRes = await request(fullApp).delete(`/api/projects/${projectId}`);
    assert.equal(deleteRes.status, 200);
    assert.equal(deleteRes.body.success, true);
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
    assert.ok(
      ["REQUIRES_USER_INTERVENTION", "PROJECT_ADVANCE_IN_PROGRESS"].includes(String(advancePendingApproval.body.error.code))
    );

    await prismaClient.project.update({
      where: { id: projectId },
      data: { pendingApproval: false, status: "paused" }
    });

    const advancePaused = await request(fullApp)
      .post(`/api/projects/${projectId}/advance`);
    assert.equal(advancePaused.status, 409);
    const advancePausedMessage = String(
      advancePaused.body?.error?.message
      || advancePaused.body?.message
      || ""
    );
    const advancePausedCode = String(advancePaused.body?.error?.code || "");
    if (advancePausedMessage.length > 0) {
      assert.match(advancePausedMessage, /not active|in progress|待完成当前推进任务|正在推进中/i);
    } else {
      assert.ok(
        ["PROJECT_ADVANCE_IN_PROGRESS", "REQUIRES_USER_INTERVENTION", "INVALID_PROJECT_STATE"].includes(advancePausedCode)
      );
    }
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

  describe("200 PROJECT_STAGE_SUBMIT", () => {
    it("[422][PROJECT_STAGE_SUBMIT] DESIGN 设计审查卡在严格模板门禁下不会自动放行", async () => {
      const createRes = await request(fullApp)
        .post("/api/projects")
        .send({
          name: "测试项目-设计审查卡默认不自动完结",
          description: "验证未显式传 finalizeApproval 时，设计审查卡提交不会自动进入待审批。",
          team: ["ROLE_PM", "ROLE_ANALYST", "ROLE_PRODUCT", "ROLE_DESIGN", "ROLE_DEV", "ROLE_QA"]
        });
      assert.equal(createRes.status, 201);
      const projectId = String(createRes.body.id);

      await prismaClient.$transaction([
        prismaClient.project.update({
          where: { id: projectId },
          data: {
            currentStage: "DESIGN",
            currentRole: "ROLE_DESIGN",
            pendingApproval: false,
            progress: 36
          }
        }),
        prismaClient.stage.update({
          where: { projectId_type: { projectId, type: "DESIGN" } },
          data: { status: "active", progress: 36 }
        }),
        prismaClient.task.updateMany({
          where: { projectId, stageType: "DESIGN" },
          data: { status: "todo" }
        })
      ]);

      const submitRes = await request(fullApp)
        .post(`/api/projects/${projectId}/stages/submit`)
        .send({
          title: "设计审查卡.md",
          content: [
            "# 设计审查卡.md",
            "## 视觉方案",
            "- 首屏突出爆品榜单、平台来源与跟品动作。",
            "## 版式策略",
            "- 总览 + 榜单 + 详情抽屉布局。",
            "## 组件清单",
            "- 榜单卡片、趋势图、来源标签、跟踪按钮。",
            "## 品牌语气",
            "- 专业、直接、证据导向。",
            "## UX 原则",
            "- 主链路优先、反馈即时、状态可解释。",
            "## 可访问性检查",
            "- 键盘可达、文本对比达标、图表文字摘要。",
            "## 验收检查清单",
            "- 设计说明可支撑开发实施，不依赖口头解释。",
            "- 无障碍检查项至少 3 条并可验证。",
            "- 审查结论明确（通过/驳回）且有理由。",
            "## 设计审查卡",
            "- 审查结论: 通过"
          ].join("\n"),
          designReview: {
            visualDirection: "跨境爆品监控控制台",
            brandTone: "专业、可执行、证据优先",
            uxPrinciples: ["主链路优先", "关键动作可达", "反馈即时"],
            accessibilityChecklist: ["键盘可达", "文本对比达标", "图表文字摘要"],
            approvedBy: "test-reviewer",
            approved: true,
            notes: "regression test for default finalizeApproval on design review"
          }
        });
      assert.equal(submitRes.status, 422);
      const submitMessage = String(submitRes.body?.message || submitRes.body?.error?.message || "");
      assert.match(submitMessage, /未通过模板校验|缺少可渲染视觉设计稿|缺少关键章节/);

      const detailRes = await request(fullApp).get(`/api/projects/${projectId}`);
      assert.equal(detailRes.status, 200);
      assert.equal(detailRes.body.currentStage, "DESIGN");
      assert.equal(detailRes.body.pendingApproval, false);
    });

    it("[422][PROJECT_STAGE_SUBMIT] finalizeApproval=false under strict gate should keep DESIGN tasks unchanged", async () => {
      const createRes = await request(fullApp)
        .post("/api/projects")
        .send({
          name: "测试项目-设计审查卡提交不自动完结",
          description: "覆盖设计阶段提交审查卡后不应自动完成全部设计任务的行为。",
          team: ["ROLE_PM", "ROLE_ANALYST", "ROLE_PRODUCT", "ROLE_DESIGN", "ROLE_DEV", "ROLE_QA"]
        });
      assert.equal(createRes.status, 201);
      const projectId = String(createRes.body.id);

      await prismaClient.$transaction([
        prismaClient.project.update({
          where: { id: projectId },
          data: {
            currentStage: "DESIGN",
            currentRole: "ROLE_DESIGN",
            pendingApproval: false,
            progress: 34
          }
        }),
        prismaClient.stage.update({
          where: { projectId_type: { projectId, type: "DESIGN" } },
          data: { status: "active", progress: 34 }
        }),
        prismaClient.task.updateMany({
          where: { projectId, stageType: "DESIGN" },
          data: { status: "todo" }
        })
      ]);

      const submitRes = await request(fullApp)
        .post(`/api/projects/${projectId}/stages/submit`)
        .send({
          title: "设计审查卡.md",
          finalizeApproval: false,
          content: [
            "# 设计审查卡.md",
            "## 视觉方案",
            "- 面向跨境电商爆品监控，首屏展示爆量告警与跟品主入口。",
            "## 版式策略",
            "- 采用摘要区 + 榜单区 + 详情区三段布局，减少认知切换。",
            "## 组件清单",
            "- 爆品榜单卡片、趋势图、平台来源标签、跟品按钮、风险提示。",
            "## 品牌语气",
            "- 快速、专业、行动导向。",
            "## UX 原则",
            "- 主链路优先、状态可解释、反馈即时可感知。",
            "## 可访问性检查",
            "- 键盘可达、对比度达标、图表附加文字摘要。",
            "## 验收检查清单",
            "- 设计说明可支撑开发实施，不依赖口头解释。",
            "- 无障碍检查项至少 3 条并可验证。",
            "- 审查结论明确（通过/驳回）且有理由。",
            "## 设计审查卡",
            "- 审查结论: 通过",
            "- 改进建议: 下一版补充多平台筛选交互动效。"
          ].join("\n"),
          designReview: {
            visualDirection: "TikTok 风格的数据运营看板",
            brandTone: "快速、可执行、专业",
            uxPrinciples: ["主链路优先", "关键指标高可读", "操作反馈即时"],
            accessibilityChecklist: ["键盘可达", "文本对比度达标", "图表文字摘要"],
            approvedBy: "test-reviewer",
            approved: true,
            notes: "regression test for finalizeApproval=false"
          }
        });
      assert.equal(submitRes.status, 422);
      const submitMessage = String(submitRes.body?.message || submitRes.body?.error?.message || "");
      assert.match(submitMessage, /未通过模板校验|缺少可渲染视觉设计稿|缺少关键章节/);

      const detailRes = await request(fullApp).get(`/api/projects/${projectId}`);
      assert.equal(detailRes.status, 200);
      assert.equal(detailRes.body.currentStage, "DESIGN");
      assert.equal(detailRes.body.pendingApproval, false);

      const designStage = (detailRes.body.stages as Array<{ type: string; progress: number }>).find((stage) => stage.type === "DESIGN");
      assert.ok(designStage);
      assert.equal(Number(designStage?.progress ?? 0), 34);

      const designTasks = (detailRes.body.tasks as Array<{ stageType: string; status: string }>).filter((task) => task.stageType === "DESIGN");
      assert.ok(designTasks.length > 0);
      assert.equal(designTasks.every((task) => task.status === "done"), false);
    });

    it("[422][PROJECT_STAGE_SUBMIT] finalizeApproval=true still blocked when DESIGN core deliverables are incomplete", async () => {
      const createRes = await request(fullApp)
        .post("/api/projects")
        .send({
          name: "测试项目-设计单项提交不触发审批",
          description: "验证只提交设计审查卡时，不应直接进入待审批。",
          team: ["ROLE_PM", "ROLE_ANALYST", "ROLE_PRODUCT", "ROLE_DESIGN", "ROLE_DEV", "ROLE_QA"]
        });
      assert.equal(createRes.status, 201);
      const projectId = String(createRes.body.id);

      await prismaClient.$transaction([
        prismaClient.project.update({
          where: { id: projectId },
          data: {
            currentStage: "DESIGN",
            currentRole: "ROLE_DESIGN",
            pendingApproval: false,
            progress: 40
          }
        }),
        prismaClient.stage.update({
          where: { projectId_type: { projectId, type: "DESIGN" } },
          data: { status: "active", progress: 40 }
        }),
        prismaClient.task.updateMany({
          where: { projectId, stageType: "DESIGN" },
          data: { status: "todo" }
        })
      ]);

      const submitRes = await request(fullApp)
        .post(`/api/projects/${projectId}/stages/submit`)
        .send({
          title: "设计审查卡.md",
          content: [
            "# 设计审查卡.md",
            "## 视觉方案",
            "- 首屏优先呈现爆品流量突增与跟品入口，支持平台来源筛选。",
            "## 版式策略",
            "- 采用流量总览 + 爆品榜单 + 商品详情抽屉结构。",
            "## 组件清单",
            "- 榜单卡片、趋势图、来源标签、跟踪按钮、告警条。",
            "## 品牌语气",
            "- 快节奏、偏实战、强调执行。",
            "## UX 原则",
            "- 关键动作显性、状态可解释、异常可追踪。",
            "## 可访问性检查",
            "- 键盘导航、语义标签、图表文字备份。",
            "## 验收检查清单",
            "- 设计说明可支撑开发实施，不依赖口头解释。",
            "- 无障碍检查项至少 3 条并可验证。",
            "- 审查结论明确（通过/驳回）且有理由。",
            "## 设计审查卡",
            "- 审查结论: 通过",
            "- 改进建议: 下一轮补充详情页交互动效。"
          ].join("\n"),
          designReview: {
            visualDirection: "TikTok 风格的数据运营控制台",
            brandTone: "直接、快速、数据导向",
            uxPrinciples: ["主链路可达", "信息层级清晰", "反馈即时"],
            accessibilityChecklist: ["键盘可达", "文本对比可读", "图表有文字说明"],
            approvedBy: "test-reviewer",
            approved: true,
            notes: "regression test for finalizeApproval=true with incomplete design deliverables"
          }
        });
      assert.equal(submitRes.status, 422);
      const submitMessage = String(submitRes.body?.message || submitRes.body?.error?.message || "");
      assert.match(submitMessage, /未通过模板校验|缺少可渲染视觉设计稿|缺少关键章节/);

      const detailRes = await request(fullApp).get(`/api/projects/${projectId}`);
      assert.equal(detailRes.status, 200);
      assert.equal(detailRes.body.currentStage, "DESIGN");
      assert.equal(detailRes.body.pendingApproval, false);

      const designStage = (detailRes.body.stages as Array<{ type: string; progress: number }>).find((stage) => stage.type === "DESIGN");
      assert.ok(designStage);
      assert.equal(Number(designStage?.progress ?? 0), 40);

      const designTasks = (detailRes.body.tasks as Array<{ stageType: string; status: string }>).filter((task) => task.stageType === "DESIGN");
      assert.ok(designTasks.length > 0);
      assert.equal(designTasks.every((task) => task.status === "done"), false);
    });

    it("[422][PROJECT_STAGE_SUBMIT] should reject DESIGN review card with auto-template-level sparse content", async () => {
      const createRes = await request(fullApp)
        .post("/api/projects")
        .send({
          name: "测试项目-禁止空设计审查卡通过",
          description: "验证设计审查卡提交不能依赖系统自动补齐章节和视觉稿。",
          team: ["ROLE_PM", "ROLE_ANALYST", "ROLE_PRODUCT", "ROLE_DESIGN", "ROLE_DEV", "ROLE_QA"]
        });
      assert.equal(createRes.status, 201);
      const projectId = String(createRes.body.id);

      await prismaClient.$transaction([
        prismaClient.project.update({
          where: { id: projectId },
          data: {
            currentStage: "DESIGN",
            currentRole: "ROLE_DESIGN",
            pendingApproval: false,
            progress: 42
          }
        }),
        prismaClient.stage.update({
          where: { projectId_type: { projectId, type: "DESIGN" } },
          data: { status: "active", progress: 42 }
        }),
        prismaClient.task.updateMany({
          where: { projectId, stageType: "DESIGN" },
          data: { status: "todo" }
        })
      ]);

      const submitRes = await request(fullApp)
        .post(`/api/projects/${projectId}/stages/submit`)
        .send({
          title: "设计审查卡.md",
          content: [
            "# 设计审查卡.md",
            "## 设计审查卡",
            "- 审查结论: 通过"
          ].join("\n"),
          designReview: {
            visualDirection: "跨境爆品监控台",
            brandTone: "直接、可执行",
            uxPrinciples: ["主链路优先", "关键动作可达", "反馈即时"],
            accessibilityChecklist: ["键盘可达", "文本对比达标", "图表文字摘要"],
            approvedBy: "test-reviewer",
            approved: true,
            notes: "regression: sparse content should be rejected"
          }
        });

      assert.equal(submitRes.status, 422);
      const message = String(submitRes.body?.error?.message || submitRes.body?.message || "");
      assert.match(message, /未通过模板校验|缺少模板章节/);
    });

    it("[200][PROJECT_RECONCILE] should not auto-create missing core deliverables for current active stage", async () => {
      const createRes = await request(fullApp)
        .post("/api/projects")
        .send({
          name: "测试项目-禁止当前阶段自动造交付物",
          description: "验证 reconcile 不会为当前进行中的 DESIGN 阶段自动补齐核心交付物。",
          team: ["ROLE_PM", "ROLE_ANALYST", "ROLE_PRODUCT", "ROLE_DESIGN", "ROLE_DEV", "ROLE_QA"]
        });
      assert.equal(createRes.status, 201);
      const projectId = String(createRes.body.id);

      await prismaClient.project.update({
        where: { id: projectId },
        data: {
          currentStage: "DESIGN",
          currentRole: "ROLE_DESIGN",
          pendingApproval: false,
          progress: 44
        }
      });
      await prismaClient.stage.update({
        where: { projectId_type: { projectId, type: "DESIGN" } },
        data: { status: "active", progress: 44 }
      });
      await prismaClient.deliverable.deleteMany({
        where: { projectId, stageType: "DESIGN" }
      });
      await prismaClient.deliverable.create({
        data: {
          projectId,
          stageType: "DESIGN",
          name: "设计审查卡.md",
          type: "markdown",
          content: [
            "# 设计审查卡.md",
            "## 视觉方案",
            "- 首屏聚焦跨境爆品榜单与平台来源。",
            "## 版式策略",
            "- 总览 + 榜单 + 详情抽屉。",
            "## 组件清单",
            "- 榜单卡片、趋势图、告警条、跟品按钮。",
            "## 品牌语气",
            "- 数据导向、快速决策。",
            "## UX 原则",
            "- 主链路优先、动作低摩擦、反馈即时。",
            "## 可访问性检查",
            "- 键盘可达、对比达标、图表文字摘要。",
            "## 设计审查卡",
            "- 审查结论: 通过",
            "## 验收检查清单",
            "- 设计说明可支撑开发实施，不依赖口头解释。",
            "- 无障碍检查项至少 3 条并可验证。",
            "- 审查结论明确（通过/驳回）且有理由。"
          ].join("\n"),
          version: 1,
          status: "submitted",
          createdBy: "ROLE_DESIGN",
          updatedAt: new Date()
        }
      });

      const reconcileRes = await request(fullApp)
        .post(`/api/projects/${projectId}/reconcile-deliverables`)
        .send({});
      assert.equal(reconcileRes.status, 200);

      const detailRes = await request(fullApp).get(`/api/projects/${projectId}`);
      assert.equal(detailRes.status, 200);

      const designDeliverables = (detailRes.body.deliverables as Array<{ stageType: string; name: string }>)
        .filter((item) => item.stageType === "DESIGN");
      assert.equal(designDeliverables.length, 1);
      assert.equal(designDeliverables[0]?.name, "设计审查卡.md");
    });

    it("[422][PROJECT_STAGE_SUBMIT] should reject template scaffold placeholder content", async () => {
      const createRes = await request(fullApp)
        .post("/api/projects")
        .send({
          name: "测试项目-禁止模板骨架占位通过",
          description: "覆盖提交内容包含模板骨架占位语句时的拦截逻辑。",
          team: ["ROLE_PM", "ROLE_ANALYST", "ROLE_PRODUCT", "ROLE_DESIGN", "ROLE_DEV", "ROLE_QA"]
        });
      assert.equal(createRes.status, 201);
      const projectId = String(createRes.body.id);

      await prismaClient.$transaction([
        prismaClient.project.update({
          where: { id: projectId },
          data: {
            currentStage: "DESIGN",
            currentRole: "ROLE_DESIGN",
            pendingApproval: false,
            progress: 38
          }
        }),
        prismaClient.stage.update({
          where: { projectId_type: { projectId, type: "DESIGN" } },
          data: { status: "active", progress: 38 }
        }),
        prismaClient.task.updateMany({
          where: { projectId, stageType: "DESIGN" },
          data: { status: "todo" }
        })
      ]);

      const submitRes = await request(fullApp)
        .post(`/api/projects/${projectId}/stages/submit`)
        .send({
          title: "设计审查卡.md",
          finalizeApproval: false,
          content: [
            "# 设计审查卡.md",
            "## 视觉方案",
            "- 以跨境爆品榜单作为首屏主对象。",
            "## 版式策略",
            "- 榜单、详情、告警三列布局。",
            "## 组件清单",
            "- 榜单卡片、趋势图、来源标签、跟踪按钮。",
            "## 品牌语气",
            "- 专业、直接、证据导向。",
            "## UX 原则",
            "- 主链路优先、反馈即时、决策可追溯。",
            "## 可访问性检查",
            "- 键盘可达、对比达标、图表文字摘要。",
            "## 设计审查卡",
            "- 审查结论: 通过",
            "## 模板章节骨架（请按模板补全）",
            "## 视觉方案",
            "- 请结合 Agent 输出正文与任务证据补全本节。"
          ].join("\n"),
          designReview: {
            visualDirection: "跨境爆品监控控制台",
            brandTone: "专业、可执行、证据优先",
            uxPrinciples: ["主链路优先", "证据可追溯", "反馈即时"],
            accessibilityChecklist: ["键盘可达", "文本对比达标", "图表文字摘要"],
            approvedBy: "test-reviewer",
            approved: true,
            notes: "regression test for scaffold placeholders"
          }
        });

      assert.equal(submitRes.status, 422);
      const message = String(submitRes.body?.error?.message || submitRes.body?.message || "");
      assert.match(message, /模板骨架占位语句|未通过模板校验/);
    });

    it("[422][PROJECT_STAGE_SUBMIT] should reject DEV deliverable without code evidence", async () => {
      const createRes = await request(fullApp)
        .post("/api/projects")
        .send({
          name: "测试项目-DEV 必须有代码证据",
          description: "跨境电商爆品监控与跟品平台，要求真实研发与可运行数据链路。",
          team: ["ROLE_PM", "ROLE_ANALYST", "ROLE_PRODUCT", "ROLE_DESIGN", "ROLE_DEV", "ROLE_QA"]
        });
      assert.equal(createRes.status, 201);
      const projectId = String(createRes.body.id);

      await prismaClient.$transaction([
        prismaClient.project.update({
          where: { id: projectId },
          data: {
            currentStage: "DEV",
            currentRole: "ROLE_DEV",
            pendingApproval: false,
            progress: 55
          }
        }),
        prismaClient.stage.update({
          where: { projectId_type: { projectId, type: "DEV" } },
          data: { status: "active", progress: 55 }
        }),
        prismaClient.task.updateMany({
          where: { projectId, stageType: "DEV" },
          data: { status: "in_progress" }
        })
      ]);

      const submitRes = await request(fullApp)
        .post(`/api/projects/${projectId}/stages/submit`)
        .send({
          title: "Demo原型说明.md",
          finalizeApproval: false,
          content: [
            "# Demo原型说明.md",
            "## Demo 访问入口与环境",
            "- 入口地址: http://127.0.0.1:5173",
            "- API: http://127.0.0.1:8787",
            "## 页面清单与关键交互",
            "- 爆品榜单页、商品详情页、告警管理页。",
            "## 页面路由与核心流程（至少 3 页）",
            "- /products -> /products/:id -> /alerts",
            "## 真实数据链路（接口 / 数据源 / 存储）",
            "- GET /api/products/top、GET /api/products/:id、POST /api/products/:id/follow",
            "- 使用 TikTok 与 Amazon 数据源，存储在 PostgreSQL。",
            "## 运行与联调说明（启动命令 / 环境变量）",
            "- pnpm dev",
            "## 演示脚本（逐步）",
            "- 进入榜单查看实时增长商品，打开详情并点击跟踪。",
            "## 已实现能力与已知限制",
            "- 已有榜单展示与详情交互。",
            "## 下一轮迭代建议",
            "- 增加多语言与多时区。",
            "## 验收检查清单",
            "- 第三方可按文档独立复测主流程。",
            "- 至少提供 2 个可执行 API 接口与对应数据来源说明。",
            "- 至少提供 1 套持久化存储方案（表结构/Schema/迁移策略）。",
            "- 桌面/移动基础体验与关键 CTA 可达。",
            "- 限制与下一步计划清晰。"
          ].join("\n")
        });

      assert.equal(submitRes.status, 422);
      const message = String(submitRes.body?.error?.message || submitRes.body?.message || "");
      assert.match(message, /缺少代码实现证据|缺少联调\/验证结果证据|未通过模板校验/);
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
    it("[200][OK] issue preview + confirm create-first with deferred debate", async () => {
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
    const matchedGoals = previewRes.body.data.contextAlignment?.matchedGoals || [];
    const matchedPrinciples = previewRes.body.data.contextAlignment?.matchedPrinciples || [];
    assert.ok(Array.isArray(matchedGoals));
    assert.ok(Array.isArray(matchedPrinciples));
    const missionAnchor = String(previewRes.body.data.contextAlignment?.missionAnchor || "").trim();
    assert.ok(missionAnchor.length > 0 || matchedGoals.length + matchedPrinciples.length > 0);
    assert.equal(previewRes.body.data.analysisGate?.canProceed, false);
    assert.equal(previewRes.body.data.analysisGate?.canCreateProject, true);

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
    assert.ok(String(confirmRes.body.data?.project?.id || "").trim().length > 0);
    assert.equal(confirmRes.body.data?.issue?.status, "confirmed");
    assert.equal(confirmRes.body.data?.analysisGate?.canProceed, false);
    assert.equal(confirmRes.body.data?.analysisGate?.canCreateProject, true);
    if (confirmRes.body.data?.deferredDebateTask) {
      assert.equal(confirmRes.body.data.deferredDebateTask.status, "queued");
      assert.ok(String(confirmRes.body.data.deferredDebateTask.taskId || "").trim().length > 0);
    }
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
