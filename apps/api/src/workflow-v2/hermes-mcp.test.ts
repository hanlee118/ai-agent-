import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { afterEach, test } from "node:test";
import { tryRunStageWithHermes } from "./hermes-mcp.js";

const ENV_KEYS = [
  "WORKFLOW_V2_HERMES_ENABLED",
  "WORKFLOW_V2_HERMES_ENDPOINT",
  "HERMES_MCP_ENDPOINT",
  "WORKFLOW_V2_HERMES_STAGE_MATCH",
  "WORKFLOW_V2_HERMES_TIMEOUT_MS",
  "HERMES_MCP_API_KEY"
] as const;

const originalEnv = new Map<string, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]])
);

afterEach(() => {
  for (const [key, value] of originalEnv.entries()) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
});

test("tryRunStageWithHermes returns null when disabled", async () => {
  process.env.WORKFLOW_V2_HERMES_ENABLED = "false";
  const result = await tryRunStageWithHermes({
    stageId: "stage-1",
    stageKey: "visual_design",
    projectId: "project-1",
    summary: "design task",
    context: "ctx",
    previousOutputs: []
  });
  assert.equal(result, null);
});

test("tryRunStageWithHermes sends request and parses artifacts", async () => {
  const server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/mcp/execute") {
      res.statusCode = 404;
      res.end();
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf-8");
      const parsed = JSON.parse(body) as { stageId: string; templateKey: string };
      assert.equal(parsed.stageId, "stage-2");
      assert.equal(parsed.templateKey, "visual_design");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        success: true,
        resolution: "Hermes generated design artifacts",
        artifacts: [
          { name: "mockups", type: "design", format: "json", content: "[{\"screen\":\"home\"}]" }
        ]
      }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to start test server");
  }

  process.env.WORKFLOW_V2_HERMES_ENABLED = "true";
  process.env.WORKFLOW_V2_HERMES_ENDPOINT = `http://127.0.0.1:${address.port}`;
  process.env.WORKFLOW_V2_HERMES_STAGE_MATCH = "all";
  process.env.WORKFLOW_V2_HERMES_TIMEOUT_MS = "3000";

  try {
    const result = await tryRunStageWithHermes({
      stageId: "stage-2",
      stageKey: "visual_design",
      projectId: "project-2",
      summary: "Generate visual direction",
      context: "## context",
      previousOutputs: [{ name: "prd", content: "prd content" }],
      expectedSkills: ["design-to-code"]
    });

    assert.ok(result);
    assert.equal(result?.provider, "hermes-mcp");
    assert.equal(result?.artifacts.length, 1);
    assert.match(String(result?.body), /Hermes 执行摘要/);
    assert.match(String(result?.thinkingSummary), /Hermes generated design artifacts/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
