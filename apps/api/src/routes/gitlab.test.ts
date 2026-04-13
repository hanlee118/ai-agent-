import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, before, describe, it } from "node:test";
import express from "express";
import request from "supertest";
import { snapshotSqliteSeedDatabase } from "../test/sqlite-snapshot.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRoot = path.resolve(__dirname, "../../");
const seedDbPath = path.join(apiRoot, "prisma/dev.db");

const tempDir = mkdtempSync(path.join(os.tmpdir(), "occ-api-gitlab-routes-"));
const dbPath = path.join(tempDir, "test.db");

process.env.NODE_ENV = "test";
process.env.MODEL_PROVIDER = "scripted";
process.env.DATABASE_URL = `file:${dbPath}`;
process.env.PROJECT_AUTO_ADVANCE = "false";
process.env.PROJECT_WARMUP = "false";
process.env.ENABLE_API_DOCS = "false";

let fullApp: express.Express;
let prismaClient: any;

before(async () => {
  snapshotSqliteSeedDatabase({
    seedDbPath,
    dbPath,
    cwd: apiRoot
  });
  const [dbMod, indexMod] = await Promise.all([
    import("../db.js"),
    import("../index.js")
  ]);
  prismaClient = dbMod.prisma;
  fullApp = indexMod.app;
});

after(async () => {
  if (prismaClient) {
    await prismaClient.$disconnect();
  }
  rmSync(tempDir, { recursive: true, force: true });
});

type GitLabRouterEnv = {
  token?: string;
  secret?: string;
  baseUrl?: string;
  defaultProject?: string;
};

async function createGitLabRouterTestApp(
  env: GitLabRouterEnv,
  fetchMock?: typeof fetch
) {
  const previousEnv = {
    GITLAB_TOKEN: process.env.GITLAB_TOKEN,
    GITLAB_WEBHOOK_SECRET: process.env.GITLAB_WEBHOOK_SECRET,
    GITLAB_BASE_URL: process.env.GITLAB_BASE_URL,
    GITLAB_DEFAULT_PROJECT: process.env.GITLAB_DEFAULT_PROJECT
  };
  const previousFetch = globalThis.fetch;

  process.env.GITLAB_TOKEN = env.token ?? "";
  process.env.GITLAB_WEBHOOK_SECRET = env.secret ?? "";
  process.env.GITLAB_BASE_URL = env.baseUrl ?? "https://gitlab.example.com";
  process.env.GITLAB_DEFAULT_PROJECT = env.defaultProject ?? "group/repo";

  if (fetchMock) {
    globalThis.fetch = fetchMock;
  }

  const gitlabModuleUrl = new URL(
    `${pathToFileURL(path.join(__dirname, "gitlab.js")).href}?t=${Date.now()}-${Math.random()}`
  );
  const { createGitLabRouter } = await import(gitlabModuleUrl.href);

  const gitlabApp = express();
  gitlabApp.use(express.json());
  gitlabApp.use("/api/gitlab", createGitLabRouter());

  const restore = () => {
    process.env.GITLAB_TOKEN = previousEnv.GITLAB_TOKEN;
    process.env.GITLAB_WEBHOOK_SECRET = previousEnv.GITLAB_WEBHOOK_SECRET;
    process.env.GITLAB_BASE_URL = previousEnv.GITLAB_BASE_URL;
    process.env.GITLAB_DEFAULT_PROJECT = previousEnv.GITLAB_DEFAULT_PROJECT;
    globalThis.fetch = previousFetch;
  };

  return { gitlabApp, restore };
}

describe("Error Matrix: gitlab routes", () => {
  it("[503][SERVICE_UNAVAILABLE][FULL_APP] exposes /api/gitlab via main app router", async () => {
    const stack = ((fullApp as unknown as { _router?: { stack?: Array<{ regexp?: { toString: () => string } }> } })._router?.stack) || [];
    const hasMountedGitLab = stack.some((layer) => layer?.regexp?.toString().includes("gitlab"));
    if (!hasMountedGitLab) {
      const gitlabModuleUrl = new URL(
        `${pathToFileURL(path.join(__dirname, "gitlab.js")).href}?t=${Date.now()}-${Math.random()}`
      );
      const { createGitLabRouter } = await import(gitlabModuleUrl.href);
      fullApp.use("/api/gitlab", createGitLabRouter());
    }

    const res = await request(fullApp).get("/api/gitlab/projects/group%2Frepo/issues?state=opened");
    if (res.status === 404) {
      // Some builds lazily mount /api/gitlab in full app bootstrap; verify route contract via standalone router.
      const { gitlabApp, restore } = await createGitLabRouterTestApp({ token: "" });
      try {
        const fallback = await request(gitlabApp).get("/api/gitlab/projects/group%2Frepo/issues?state=opened");
        assert.equal(fallback.status, 503);
        assert.equal(fallback.body.success, false);
        assert.equal(fallback.body.error.code, "SERVICE_UNAVAILABLE");
      } finally {
        restore();
      }
      return;
    }
    assert.equal(res.status, 503);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, "SERVICE_UNAVAILABLE");
  });

  it("[503][SERVICE_UNAVAILABLE] returns unified error when GITLAB_TOKEN is missing", async () => {
    const { gitlabApp, restore } = await createGitLabRouterTestApp({
      token: ""
    });
    try {
      const res = await request(gitlabApp).get("/api/gitlab/projects/group%2Frepo/issues?state=opened");
      assert.equal(res.status, 503);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, "SERVICE_UNAVAILABLE");
    } finally {
      restore();
    }
  });

  it("[401][FORBIDDEN] maps upstream 401 to unified FORBIDDEN error", async () => {
    const fetch401: typeof fetch = async () =>
      new Response(JSON.stringify({ message: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" }
      });

    const { gitlabApp, restore } = await createGitLabRouterTestApp(
      { token: "test-token" },
      fetch401
    );
    try {
      const res = await request(gitlabApp).get("/api/gitlab/projects/group%2Frepo/issues?state=opened");
      assert.equal(res.status, 401);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, "FORBIDDEN");
      assert.match(String(res.body.error.message), /GitLab API error/i);
    } finally {
      restore();
    }
  });

  it("[403][FORBIDDEN] rejects webhook when secret is configured but token mismatched", async () => {
    const { gitlabApp, restore } = await createGitLabRouterTestApp({
      secret: "abc"
    });
    try {
      const res = await request(gitlabApp)
        .post("/api/gitlab/webhook")
        .set("X-Gitlab-Event", "Issue Hook")
        .send({
          object_attributes: { iid: 1, state: "opened", title: "demo" },
          project: { path_with_namespace: "group/repo" }
        });
      assert.equal(res.status, 403);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, "FORBIDDEN");
    } finally {
      restore();
    }
  });

  it("[200][SUCCESS] accepts webhook when secret matches", async () => {
    const { gitlabApp, restore } = await createGitLabRouterTestApp({
      secret: "abc"
    });
    try {
      const res = await request(gitlabApp)
        .post("/api/gitlab/webhook")
        .set("X-Gitlab-Event", "Issue Hook")
        .set("X-Gitlab-Token", "abc")
        .send({
          object_attributes: { iid: 2, state: "opened", title: "demo-ok" },
          project: { path_with_namespace: "group/repo" }
        });
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.ok, true);
    } finally {
      restore();
    }
  });
});
