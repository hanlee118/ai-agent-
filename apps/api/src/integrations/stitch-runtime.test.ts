import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { generateStitchDesignArtifact } from "./stitch-runtime.js";

test("stitch runtime fails fast when STITCH_API_KEY is missing", async () => {
  const previousApiKey = process.env.STITCH_API_KEY;
  const previousExecutor = process.env.STITCH_EXECUTOR;
  process.env.STITCH_EXECUTOR = "direct";
  delete process.env.STITCH_API_KEY;

  await assert.rejects(
    () =>
      generateStitchDesignArtifact({
        projectId: "OCC-TEST-001",
        projectName: "Stitch Test",
        projectDescription: "验证 stitch 运行时缺失 key 的阻断行为",
        parsedIntent: {
          keywords: ["ui", "design"],
          constraints: ["真实产物"],
          risks: ["配置缺失"],
          suggestedTeam: ["ROLE_DESIGN"],
          summary: "设计阶段测试"
        },
        stageType: "DESIGN",
        role: "ROLE_DESIGN",
        summary: "生成测试界面"
      }),
    /STITCH_API_KEY is required/
  );

  if (typeof previousApiKey === "undefined") {
    delete process.env.STITCH_API_KEY;
  } else {
    process.env.STITCH_API_KEY = previousApiKey;
  }
  if (typeof previousExecutor === "undefined") {
    delete process.env.STITCH_EXECUTOR;
  } else {
    process.env.STITCH_EXECUTOR = previousExecutor;
  }
});

async function withFakeClaudeCli(stdout: string, fn: (bin: string) => Promise<void>) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "stitch-claude-cli-"));
  const scriptPath = path.join(tempDir, "claude-mock.sh");
  await writeFile(
    scriptPath,
    [
      "#!/bin/sh",
      `printf '%s\\n' '${stdout.replace(/'/g, "'\\''")}'`
    ].join("\n"),
    "utf8"
  );
  await chmod(scriptPath, 0o755);
  try {
    await fn(scriptPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("stitch runtime supports claude_cli executor output parsing", async () => {
  const previous = {
    STITCH_EXECUTOR: process.env.STITCH_EXECUTOR,
    STITCH_CLAUDE_CLI_BIN: process.env.STITCH_CLAUDE_CLI_BIN,
    STITCH_CLAUDE_MODEL: process.env.STITCH_CLAUDE_MODEL,
    STITCH_CLAUDE_MCP_CONFIG: process.env.STITCH_CLAUDE_MCP_CONFIG
  };

  const stdout = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: JSON.stringify({
      projectId: "p-123",
      screenId: "s-456",
      htmlUrl: "https://stitch.example.com/html/1",
      imageUrl: "https://stitch.example.com/image/1"
    })
  });

  await withFakeClaudeCli(stdout, async (bin) => {
    process.env.STITCH_EXECUTOR = "claude_cli";
    process.env.STITCH_CLAUDE_CLI_BIN = bin;
    delete process.env.STITCH_CLAUDE_MODEL;
    delete process.env.STITCH_CLAUDE_MCP_CONFIG;

    const artifact = await generateStitchDesignArtifact({
      projectId: "OCC-TEST-002",
      projectName: "Stitch Claude CLI Test",
      projectDescription: "通过 fake claude cli 验证 stitch 产物解析",
      parsedIntent: {
        keywords: ["ui", "design"],
        constraints: ["真实产物"],
        risks: ["解析失败"],
        suggestedTeam: ["ROLE_DESIGN"],
        summary: "设计阶段测试"
      },
      stageType: "DESIGN",
      role: "ROLE_DESIGN",
      summary: "生成测试界面"
    });

    assert.equal(artifact.provider, "claude-cli-stitch-mcp");
    assert.equal(artifact.projectId, "p-123");
    assert.equal(artifact.screenId, "s-456");
    assert.equal(artifact.htmlUrl, "https://stitch.example.com/html/1");
    assert.equal(artifact.imageUrl, "https://stitch.example.com/image/1");
  });

  for (const [key, value] of Object.entries(previous)) {
    if (typeof value === "undefined") {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test("stitch runtime auto mode falls back to claude_cli when direct sdk is unavailable", async () => {
  const previous = {
    STITCH_EXECUTOR: process.env.STITCH_EXECUTOR,
    STITCH_API_KEY: process.env.STITCH_API_KEY,
    STITCH_CLAUDE_CLI_BIN: process.env.STITCH_CLAUDE_CLI_BIN,
    STITCH_CLAUDE_MODEL: process.env.STITCH_CLAUDE_MODEL,
    STITCH_CLAUDE_MCP_CONFIG: process.env.STITCH_CLAUDE_MCP_CONFIG
  };

  const stdout = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: JSON.stringify({
      projectId: "p-auto",
      screenId: "s-auto",
      htmlUrl: "https://stitch.example.com/html/auto",
      imageUrl: "https://stitch.example.com/image/auto"
    })
  });

  await withFakeClaudeCli(stdout, async (bin) => {
    process.env.STITCH_EXECUTOR = "auto";
    delete process.env.STITCH_API_KEY;
    process.env.STITCH_CLAUDE_CLI_BIN = bin;
    delete process.env.STITCH_CLAUDE_MODEL;
    delete process.env.STITCH_CLAUDE_MCP_CONFIG;

    const artifact = await generateStitchDesignArtifact({
      projectId: "OCC-TEST-003",
      projectName: "Stitch Auto Fallback Test",
      projectDescription: "验证 auto 模式会回退到 claude_cli",
      parsedIntent: {
        keywords: ["ui", "design"],
        constraints: ["真实产物"],
        risks: ["sdk不可用"],
        suggestedTeam: ["ROLE_DESIGN"],
        summary: "设计阶段测试"
      },
      stageType: "DESIGN",
      role: "ROLE_DESIGN",
      summary: "生成测试界面"
    });

    assert.equal(artifact.provider, "claude-cli-stitch-mcp");
    assert.equal(artifact.projectId, "p-auto");
    assert.equal(artifact.screenId, "s-auto");
  });

  for (const [key, value] of Object.entries(previous)) {
    if (typeof value === "undefined") {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});
