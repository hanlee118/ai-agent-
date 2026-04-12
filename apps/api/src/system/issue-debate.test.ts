import assert from "node:assert/strict";
import { test } from "node:test";
import { type RoleType } from "@occ/shared";
import {
  evaluateDebateModelSufficiency,
  selectIssueDebateRoles,
  type IssueDebateOpinion
} from "./issue-debate.js";

function mockOpinion(input: { roleId: RoleType; mode: IssueDebateOpinion["mode"] }): IssueDebateOpinion {
  return {
    id: `opinion-${input.roleId}`,
    roleId: input.roleId,
    roleLabel: input.roleId,
    focus: "focus",
    concern: "concern",
    proposal: "proposal",
    openQuestions: [],
    handoff: "handoff",
    provider: "openai-compatible",
    model: "openai/gpt-5.4",
    elapsedMs: 10,
    mode: input.mode,
    rawPreview: "raw"
  };
}

test("selectIssueDebateRoles should always include analyst and preserve recommended stage role in top slots", () => {
  const roles = selectIssueDebateRoles({
    soulRoleId: "ROLE_PM",
    recommendedRoleIds: ["ROLE_PM", "ROLE_DESIGN"],
    maxRoles: 3
  });

  assert.deepEqual(roles, ["ROLE_PM", "ROLE_ANALYST", "ROLE_DESIGN"]);
});

test("evaluateDebateModelSufficiency passes when analyst + non-analyst both have model outputs", () => {
  const result = evaluateDebateModelSufficiency({
    selectedRoles: ["ROLE_PM", "ROLE_ANALYST", "ROLE_DESIGN"],
    opinions: [
      mockOpinion({ roleId: "ROLE_ANALYST", mode: "model" }),
      mockOpinion({ roleId: "ROLE_DESIGN", mode: "model" }),
      mockOpinion({ roleId: "ROLE_PM", mode: "fallback" })
    ],
    minRealModelRoles: 2,
    requireAnalyst: true
  });

  assert.equal(result.passed, true);
  assert.equal(result.analystReady, true);
  assert.equal(result.nonAnalystReady, true);
});

test("evaluateDebateModelSufficiency fails when only analyst succeeded", () => {
  const result = evaluateDebateModelSufficiency({
    selectedRoles: ["ROLE_PM", "ROLE_ANALYST", "ROLE_DESIGN"],
    opinions: [
      mockOpinion({ roleId: "ROLE_ANALYST", mode: "model" }),
      mockOpinion({ roleId: "ROLE_DESIGN", mode: "fallback" }),
      mockOpinion({ roleId: "ROLE_PM", mode: "fallback" })
    ],
    minRealModelRoles: 2,
    requireAnalyst: true
  });

  assert.equal(result.passed, false);
  assert.equal(result.analystReady, true);
  assert.equal(result.nonAnalystReady, false);
});

test("evaluateDebateModelSufficiency fails when analyst is missing even if two other roles succeeded", () => {
  const result = evaluateDebateModelSufficiency({
    selectedRoles: ["ROLE_PM", "ROLE_ANALYST", "ROLE_DESIGN"],
    opinions: [
      mockOpinion({ roleId: "ROLE_PM", mode: "model" }),
      mockOpinion({ roleId: "ROLE_DESIGN", mode: "model" }),
      mockOpinion({ roleId: "ROLE_ANALYST", mode: "fallback" })
    ],
    minRealModelRoles: 2,
    requireAnalyst: true
  });

  assert.equal(result.passed, false);
  assert.equal(result.analystReady, false);
  assert.equal(result.nonAnalystReady, true);
});
