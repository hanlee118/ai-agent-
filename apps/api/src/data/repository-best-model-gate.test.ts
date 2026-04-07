import test from "node:test";
import assert from "node:assert/strict";
import { evaluateStageBestModelGate } from "./repository.js";

test("best-model gate accepts when latest successful executions use the top preferred model", () => {
  const result = evaluateStageBestModelGate({
    stageType: "ANALYSIS",
    currentRole: "ROLE_ANALYST",
    stageExecutions: [
      { role: "ROLE_PM", model: "openai/gpt-5.4" },
      { role: "ROLE_PRODUCT", model: "gpt-5.4" },
      { role: "ROLE_ANALYST", model: "openai/gpt-5.4" }
    ]
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.issues, []);
});

test("best-model gate blocks when the latest successful execution falls back to a non-best model", () => {
  const result = evaluateStageBestModelGate({
    stageType: "ACCEPT",
    currentRole: "ROLE_QA",
    stageExecutions: [
      { role: "ROLE_QA", model: "openai/gpt-5.2" },
      { role: "ROLE_PM", model: "openai/gpt-5.4" }
    ]
  });

  assert.equal(result.passed, false);
  assert.equal(
    result.issues.some((item) => item.includes("测试工程师") && item.includes("openai/gpt-5.4") && item.includes("openai/gpt-5.2")),
    true
  );
});

test("best-model gate uses role-specific top model for design roles", () => {
  const result = evaluateStageBestModelGate({
    stageType: "DESIGN",
    currentRole: "ROLE_DESIGN",
    stageExecutions: [
      { role: "ROLE_PM", model: "anthropic/claude-opus-4-20250514" },
      { role: "ROLE_PRODUCT", model: "openai/gpt-5.4" },
      { role: "ROLE_DESIGN", model: "anthropic/claude-opus-4-20250514" }
    ]
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.issues, []);
});
