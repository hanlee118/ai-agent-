import test from "node:test";
import assert from "node:assert/strict";
import {
  DESIGN_MODEL_FALLBACKS,
  DESIGN_MODEL_POLICY_CHAIN,
  DESIGN_MODEL_PRIMARY,
  isDesignModelPreferred
} from "./design-model-policy.js";

test("design model policy prefers claude opus first", () => {
  assert.equal(DESIGN_MODEL_PRIMARY, "anthropic/claude-opus-4-20250514");
  assert.equal(DESIGN_MODEL_FALLBACKS[0], "anthropic/claude-sonnet-4-20250514");
  assert.equal(DESIGN_MODEL_FALLBACKS.includes("openai/gpt-5.4"), true);
});

test("design model policy chain excludes weak legacy design fallbacks", () => {
  const joined = DESIGN_MODEL_POLICY_CHAIN.join(" ");
  assert.equal(/kimi-k2\.5/i.test(joined), false);
  assert.equal(/minimax|minimax-m2\.7-highspeed/i.test(joined), false);
});

test("design preferred helper recognizes primary model", () => {
  assert.equal(isDesignModelPreferred("anthropic/claude-opus-4-20250514"), true);
  assert.equal(isDesignModelPreferred("claude-opus-4-20250514"), true);
  assert.equal(isDesignModelPreferred("openai/gpt-5.4"), false);
});
