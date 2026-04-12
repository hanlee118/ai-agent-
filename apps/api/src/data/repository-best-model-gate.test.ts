import test from "node:test";
import assert from "node:assert/strict";
import { evaluateStageBestModelGate, evaluateStageRoleCollaborationGate } from "./repository.js";
import { getPreferredStageModels } from "../system/project-stage-execution.js";

test("best-model gate accepts when latest successful executions use the top preferred model", () => {
  const analystTopModel = getPreferredStageModels("ANALYSIS", "ROLE_ANALYST")[0] ?? "qwen3-max-2026-01-23";
  const productTopModel = getPreferredStageModels("ANALYSIS", "ROLE_PRODUCT")[0] ?? analystTopModel;
  const pmTopModel = getPreferredStageModels("ANALYSIS", "ROLE_PM")[0] ?? analystTopModel;
  const result = evaluateStageBestModelGate({
    stageType: "ANALYSIS",
    currentRole: "ROLE_ANALYST",
    stageExecutions: [
      { role: "ROLE_PM", model: pmTopModel },
      { role: "ROLE_PRODUCT", model: productTopModel },
      { role: "ROLE_ANALYST", model: analystTopModel }
    ]
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.issues, []);
});

test("best-model gate accepts when latest successful executions use a non-top preferred model", () => {
  const pmTopModel = getPreferredStageModels("DESIGN", "ROLE_PM")[0] ?? "qwen3-max-2026-01-23";
  const productTopModel = getPreferredStageModels("DESIGN", "ROLE_PRODUCT")[0] ?? pmTopModel;
  const designPreferred = getPreferredStageModels("DESIGN", "ROLE_DESIGN");
  const designNonTopModel = designPreferred[1] ?? designPreferred[0] ?? pmTopModel;
  const result = evaluateStageBestModelGate({
    stageType: "DESIGN",
    currentRole: "ROLE_DESIGN",
    stageExecutions: [
      { role: "ROLE_PM", model: pmTopModel },
      { role: "ROLE_PRODUCT", model: productTopModel },
      { role: "ROLE_DESIGN", model: designNonTopModel }
    ]
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.issues, []);
});

test("best-model gate blocks when latest successful execution is outside preferred pool", () => {
  const pmTopModel = getPreferredStageModels("ACCEPT", "ROLE_PM")[0] ?? "qwen3-max-2026-01-23";
  const qaTopModel = getPreferredStageModels("ACCEPT", "ROLE_QA")[0] ?? pmTopModel;
  const qaOutsideModel = "openai/gpt-5.2";
  const result = evaluateStageBestModelGate({
    stageType: "ACCEPT",
    currentRole: "ROLE_QA",
    stageExecutions: [
      { role: "ROLE_QA", model: qaOutsideModel },
      { role: "ROLE_PM", model: pmTopModel }
    ]
  });

  assert.equal(result.passed, false);
  assert.equal(
    result.issues.some((item) => item.includes("测试工程师") && item.includes(qaTopModel) && item.includes(qaOutsideModel)),
    true
  );
});

test("best-model gate prefers latest non-scripted success for role evaluation", () => {
  const qaTopModel = getPreferredStageModels("ACCEPT", "ROLE_QA")[0] ?? "qwen3-max-2026-01-23";
  const pmTopModel = getPreferredStageModels("ACCEPT", "ROLE_PM")[0] ?? qaTopModel;
  const result = evaluateStageBestModelGate({
    stageType: "ACCEPT",
    currentRole: "ROLE_QA",
    stageExecutions: [
      { role: "ROLE_QA", model: "scripted-agent", provider: "scripted" },
      { role: "ROLE_QA", model: qaTopModel, provider: "openai-compatible" },
      { role: "ROLE_PM", model: pmTopModel, provider: "openai-compatible" }
    ]
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.issues, []);
});

test("best-model gate uses role-specific top model for design roles", () => {
  const pmTopModel = getPreferredStageModels("DESIGN", "ROLE_PM")[0] ?? "qwen3-max-2026-01-23";
  const productTopModel = getPreferredStageModels("DESIGN", "ROLE_PRODUCT")[0] ?? pmTopModel;
  const designTopModel = getPreferredStageModels("DESIGN", "ROLE_DESIGN")[0] ?? pmTopModel;
  const result = evaluateStageBestModelGate({
    stageType: "DESIGN",
    currentRole: "ROLE_DESIGN",
    stageExecutions: [
      { role: "ROLE_PM", model: pmTopModel },
      { role: "ROLE_PRODUCT", model: productTopModel },
      { role: "ROLE_DESIGN", model: designTopModel }
    ]
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.issues, []);
});

test("stage collaboration gate passes with analyst + non-analyst real-model outputs", () => {
  const result = evaluateStageRoleCollaborationGate({
    stageType: "DESIGN",
    stageExecutions: [
      { role: "ROLE_ANALYST", status: "success", provider: "openai-compatible" },
      { role: "ROLE_DESIGN", status: "success", provider: "openai-compatible" },
      { role: "ROLE_PM", status: "success", provider: "scripted" }
    ],
    minRealModelRoles: 2,
    requireAnalyst: true
  });

  assert.equal(result.passed, true);
  assert.equal(result.analystReady, true);
  assert.equal(result.nonAnalystReady, true);
});

test("stage collaboration gate fails when only analyst has real-model output", () => {
  const result = evaluateStageRoleCollaborationGate({
    stageType: "DEV",
    stageExecutions: [
      { role: "ROLE_ANALYST", status: "success", provider: "openai-compatible" },
      { role: "ROLE_DEV", status: "success", provider: "scripted" }
    ],
    minRealModelRoles: 2,
    requireAnalyst: true
  });

  assert.equal(result.passed, false);
  assert.equal(result.analystReady, true);
  assert.equal(result.nonAnalystReady, false);
  assert.equal(result.issues.some((item) => item.includes("非需求分析师")), true);
});

test("stage collaboration gate fails when analyst is missing", () => {
  const result = evaluateStageRoleCollaborationGate({
    stageType: "ACCEPT",
    stageExecutions: [
      { role: "ROLE_QA", status: "success", provider: "openai-compatible" },
      { role: "ROLE_PM", status: "success", provider: "openai-compatible" }
    ],
    minRealModelRoles: 2,
    requireAnalyst: true
  });

  assert.equal(result.passed, false);
  assert.equal(result.analystReady, false);
  assert.equal(result.nonAnalystReady, true);
  assert.equal(result.issues.some((item) => item.includes("需求分析师")), true);
});
