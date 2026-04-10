import test from "node:test";
import assert from "node:assert/strict";
import {
  __testOnlyInstallStitchTransportConsoleFilter,
  buildGenerateScreenArguments,
  clearStitchTransportCooldown,
  generateStitchDesignArtifact,
  isRetryableTransportError,
  isStitchTransportCooldownError,
  isStitchTransportCooldownActive,
  noteStitchTransportFailure,
  resolveStitchProxyPlan,
  recoverStitchDesignArtifact,
  startStitchDesignGeneration,
} from "./stitch-runtime.js";

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

test("stitch async start fails fast when STITCH_API_KEY is missing", async () => {
  const previousApiKey = process.env.STITCH_API_KEY;
  delete process.env.STITCH_API_KEY;

  await assert.rejects(
    () =>
      startStitchDesignGeneration({
        projectId: "OCC-TEST-ASYNC-001",
        projectName: "Stitch Async Test",
        projectDescription: "验证 stitch 异步启动在缺失 key 时快速失败",
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

test("stitch async recover fails fast when STITCH_API_KEY is missing", async () => {
  const previousApiKey = process.env.STITCH_API_KEY;
  delete process.env.STITCH_API_KEY;

  await assert.rejects(
    () =>
      recoverStitchDesignArtifact({
        stitchProjectId: "stitch-project-123",
        prompt: "设计协作平台重构界面"
      }),
    /STITCH_API_KEY is required/
  );

  if (typeof previousApiKey === "undefined") {
    delete process.env.STITCH_API_KEY;
  } else {
    process.env.STITCH_API_KEY = previousApiKey;
  }
});

test("stitch proxy plan prefers HTTPS proxy and avoids socks fallback when HTTP proxy exists", () => {
  const plan = resolveStitchProxyPlan({
    HTTP_PROXY: "http://127.0.0.1:1087",
    HTTPS_PROXY: "http://127.0.0.1:1087",
    ALL_PROXY: "socks5://127.0.0.1:1086",
    NO_PROXY: "127.0.0.1,localhost"
  });

  assert.deepEqual(plan, {
    mode: "http",
    proxyUrl: "http://127.0.0.1:1087",
    env: {
      HTTP_PROXY: "http://127.0.0.1:1087",
      HTTPS_PROXY: "http://127.0.0.1:1087",
      ALL_PROXY: "socks5://127.0.0.1:1086",
      NO_PROXY: "127.0.0.1,localhost"
    }
  });
});

test("stitch proxy plan falls back to socks only when http proxy is unavailable", () => {
  const plan = resolveStitchProxyPlan({
    ALL_PROXY: "socks5://127.0.0.1:1086"
  });

  assert.deepEqual(plan, {
    mode: "socks5",
    proxyUrl: "socks5://127.0.0.1:1086",
    env: {
      ALL_PROXY: "socks5://127.0.0.1:1086"
    }
  });
});

test("stitch generation args default to desktop and omit model id", () => {
  const previousModelId = process.env.STITCH_MODEL_ID;
  const previousDeviceType = process.env.STITCH_DEVICE_TYPE;
  delete process.env.STITCH_MODEL_ID;
  delete process.env.STITCH_DEVICE_TYPE;

  try {
    assert.deepEqual(
      buildGenerateScreenArguments({
        projectId: "123",
        prompt: "design a dashboard"
      }),
      {
        projectId: "123",
        prompt: "design a dashboard",
        deviceType: "DESKTOP"
      }
    );
  } finally {
    if (typeof previousModelId === "undefined") {
      delete process.env.STITCH_MODEL_ID;
    } else {
      process.env.STITCH_MODEL_ID = previousModelId;
    }
    if (typeof previousDeviceType === "undefined") {
      delete process.env.STITCH_DEVICE_TYPE;
    } else {
      process.env.STITCH_DEVICE_TYPE = previousDeviceType;
    }
  }
});

test("stitch generation args respect explicit env overrides", () => {
  const previousModelId = process.env.STITCH_MODEL_ID;
  const previousDeviceType = process.env.STITCH_DEVICE_TYPE;
  process.env.STITCH_MODEL_ID = "GEMINI_3_1_PRO";
  process.env.STITCH_DEVICE_TYPE = "MOBILE";

  try {
    assert.deepEqual(
      buildGenerateScreenArguments({
        projectId: "456",
        prompt: "design a mobile app"
      }),
      {
        projectId: "456",
        prompt: "design a mobile app",
        deviceType: "MOBILE",
        modelId: "GEMINI_3_1_PRO"
      }
    );
  } finally {
    if (typeof previousModelId === "undefined") {
      delete process.env.STITCH_MODEL_ID;
    } else {
      process.env.STITCH_MODEL_ID = previousModelId;
    }
    if (typeof previousDeviceType === "undefined") {
      delete process.env.STITCH_DEVICE_TYPE;
    } else {
      process.env.STITCH_DEVICE_TYPE = previousDeviceType;
    }
  }
});

test("stitch timeout errors are treated as recoverable transport failures", () => {
  assert.equal(isRetryableTransportError(new Error("TimeoutError: The operation was aborted due to timeout")), true);
  assert.equal(isRetryableTransportError(new Error("request aborted")), true);
  assert.equal(isRetryableTransportError(new Error("UND_ERR_DESTROYED: ClientDestroyedError")), true);
  assert.equal(isRetryableTransportError(new Error("MCP error -32001: Request timed out")), true);
});

test("stitch transport cooldown opens and auto-expires", () => {
  clearStitchTransportCooldown();
  assert.equal(isStitchTransportCooldownActive(1_000), false);
  const until = noteStitchTransportFailure(1_000, 5_000);
  assert.equal(until, 6_000);
  assert.equal(isStitchTransportCooldownActive(3_000), true);
  assert.equal(isStitchTransportCooldownActive(6_001), false);
  assert.equal(isStitchTransportCooldownError(new Error("STITCH_TRANSPORT_COOLDOWN_ACTIVE")), true);
  assert.equal(isStitchTransportCooldownError(new Error("other error")), false);
});

test("stitch transport console filter suppresses only stitch transport noise", () => {
  const previousMute = process.env.STITCH_MUTE_TRANSPORT_ERROR_LOG;
  process.env.STITCH_MUTE_TRANSPORT_ERROR_LOG = "true";

  const originalConsoleError = console.error;
  const captured: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    captured.push(args);
  };

  try {
    __testOnlyInstallStitchTransportConsoleFilter();
    console.error("Stitch Transport Error:", new Error("AbortError"));
    console.error("normal runtime error", new Error("Expected"));
  } finally {
    console.error = originalConsoleError;
    if (typeof previousMute === "undefined") {
      delete process.env.STITCH_MUTE_TRANSPORT_ERROR_LOG;
    } else {
      process.env.STITCH_MUTE_TRANSPORT_ERROR_LOG = previousMute;
    }
  }

  assert.equal(captured.length, 1);
  assert.equal(String(captured[0]?.[0] ?? ""), "normal runtime error");
});
