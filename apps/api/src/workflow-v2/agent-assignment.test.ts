import test from "node:test";
import assert from "node:assert/strict";
import { resolveRoleCandidates, scoreAgentCandidate } from "./agent-assignment.js";

test("resolveRoleCandidates maps known stage role aliases", () => {
  assert.deepEqual(resolveRoleCandidates("UI_Designer"), ["ROLE_DESIGN", "jeremy"]);
  assert.deepEqual(resolveRoleCandidates("Architect"), ["ROLE_ARCH", "rd_director"]);
  assert.deepEqual(resolveRoleCandidates("custom_role"), ["custom_role"]);
});

test("scoreAgentCandidate prefers higher capability match and lower workload", () => {
  const strong = scoreAgentCandidate({
    candidate: {
      agentId: "jeremy",
      capabilities: ["figma", "design_system", "ui_ux"],
      profile: { workload: 12, status: "online" } as any,
      config: { selectedModel: "openai/gpt-5.4", defaultModel: "openai/gpt-5.4" } as any
    },
    requiredCapabilities: ["figma", "design_system"],
    modelPreference: "openai/gpt-5.4"
  });

  const weak = scoreAgentCandidate({
    candidate: {
      agentId: "legacy_designer",
      capabilities: ["ui"],
      profile: { workload: 88, status: "busy" } as any,
      config: { selectedModel: "qwen3.5-plus", defaultModel: "qwen3.5-plus" } as any
    },
    requiredCapabilities: ["figma", "design_system"],
    modelPreference: "openai/gpt-5.4"
  });

  assert.equal(strong.score > weak.score, true);
  assert.equal(strong.reasons.some((item) => item.includes("capability_match=2/2")), true);
});
