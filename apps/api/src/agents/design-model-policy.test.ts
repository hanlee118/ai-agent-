import test from "node:test";
import assert from "node:assert/strict";
import {
  DESIGN_MODEL_FALLBACKS,
  DESIGN_MODEL_POLICY_CHAIN,
  DESIGN_MODEL_PRIMARY,
  isDesignModelPreferred
} from "./design-model-policy.js";

test("design model policy prefers gpt chain first", () => {
  assert.equal(DESIGN_MODEL_PRIMARY, "openai/gpt-5.4");
  assert.equal(DESIGN_MODEL_FALLBACKS[0], "openai/gpt-5.3-codex");
  assert.equal(DESIGN_MODEL_FALLBACKS.includes("qwen3-max-2026-01-23"), true);
  assert.equal(DESIGN_MODEL_FALLBACKS.includes("qwen3.5-plus"), true);
  assert.equal(DESIGN_MODEL_FALLBACKS.includes("qwen3-coder-plus"), true);
  assert.equal(DESIGN_MODEL_FALLBACKS.includes("kimi-k2.5"), true);
  assert.equal(DESIGN_MODEL_FALLBACKS.includes("minima/MiniMax-M2.7-highspeed"), true);
});

test("design model policy chain exposes expanded candidates for design fallback", () => {
  const joined = DESIGN_MODEL_POLICY_CHAIN.join(" ");
  assert.equal(/kimi-k2\.5/i.test(joined), true);
  assert.equal(/minimax|minimax-m2\.7-highspeed/i.test(joined), true);
  assert.equal(/openai\/gpt-5\.4/i.test(joined), true);
  assert.equal(/openai\/gpt-5\.3-codex/i.test(joined), true);
});

test("design preferred helper recognizes primary model", () => {
  assert.equal(isDesignModelPreferred("openai/gpt-5.4"), true);
  assert.equal(isDesignModelPreferred("gpt-5.4"), true);
  assert.equal(isDesignModelPreferred("qwen3-max-2026-01-23"), false);
  assert.equal(isDesignModelPreferred("qwen3-coder-plus"), false);
});
