import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOpenAiCompatibleHeaders,
  resolveOpenAiCompatibleGatewayGroup
} from "./openai-compatible-headers.js";

test("defaults unboundtech gateway group to codex", () => {
  const previous = process.env.OPENAI_COMPAT_GROUP;
  delete process.env.OPENAI_COMPAT_GROUP;

  const group = resolveOpenAiCompatibleGatewayGroup("https://ai.unboundtech.cn/v1");
  assert.equal(group, "codex");

  if (previous !== undefined) {
    process.env.OPENAI_COMPAT_GROUP = previous;
  }
});

test("allows explicit group override via env", () => {
  const previous = process.env.OPENAI_COMPAT_GROUP;
  process.env.OPENAI_COMPAT_GROUP = "internal";

  const headers = buildOpenAiCompatibleHeaders({
    apiBaseUrl: "https://ai.unboundtech.cn/v1",
    apiKey: "sk-test",
    json: true
  }) as Record<string, string>;
  assert.equal(headers["X-Group"], "internal");
  assert.equal(headers.Authorization, "Bearer sk-test");
  assert.equal(headers["Content-Type"], "application/json");

  if (previous === undefined) {
    delete process.env.OPENAI_COMPAT_GROUP;
  } else {
    process.env.OPENAI_COMPAT_GROUP = previous;
  }
});
