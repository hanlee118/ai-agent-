import test from "node:test";
import assert from "node:assert/strict";
import { generateStitchDesignArtifact } from "./stitch-runtime.js";

test("stitch runtime fails fast when STITCH_API_KEY is missing", async () => {
  const previousApiKey = process.env.STITCH_API_KEY;
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
});
