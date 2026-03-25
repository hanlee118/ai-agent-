import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { getSystemReadiness } from "../apps/api/dist/system/readiness.js";
import { findOpenClawAgent } from "../apps/api/dist/openclaw/workspace.js";
import { getSystemHealth } from "../apps/api/dist/data/repository.js";
import { getRuntimeStatus } from "../apps/api/dist/agents/runtime.js";

await verifyBuildArtifacts();
await verifyRuntime();

console.log("verify-local: ok");

async function verifyBuildArtifacts() {
  assert.equal(existsSync("apps/web/dist/index.html"), true, "web dist html should exist");
  assert.equal(existsSync("apps/api/dist/index.js"), true, "api dist entry should exist");

  const html = readFileSync("apps/web/dist/index.html", "utf8");
  assert.ok(html.includes("<div id=\"root\"></div>") || html.includes("<div id=\"root\">"), "web dist html should contain root app container");

  const apiEntry = readFileSync("apps/api/dist/index.js", "utf8");
  assert.ok(apiEntry.includes('"/health"'), "api dist should expose /health");
  assert.ok(apiEntry.includes('"/ready"'), "api dist should expose /ready");
  assert.ok(apiEntry.includes("express.static"), "api dist should serve built web assets when present");
}

async function verifyRuntime() {
  const runtime = await getRuntimeStatus();
  const health = await getSystemHealth();
  const readiness = await getSystemReadiness();

  assert.equal(typeof runtime.mode, "string", "runtime mode should be readable");
  assert.equal(Array.isArray(health.services), true, "system health should expose services");
  assert.equal(readiness.database.exists, true, "database file should exist");
  assert.ok(readiness.database.path, "database path should be present");
  assert.equal(existsSync(readiness.database.path), true, "database path should resolve on disk");
  assert.equal(readiness.openclaw.configExists, true, "openclaw config should exist");
  assert.equal(readiness.openclaw.workspaceExists, true, "openclaw workspace should exist");
  assert.ok(readiness.openclaw.liveWorkspaceAgentCount > 0, "should detect at least one live openclaw agent");
  assert.ok(readiness.openclaw.liveWorkspaceProjectCount > 0, "should detect at least one live openclaw project");

  const jeremy = await findOpenClawAgent("jeremy");
  assert.ok(jeremy, "jeremy agent should be discoverable");
  assert.ok(jeremy?.model, "jeremy should expose a model");
}
