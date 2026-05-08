import test from "node:test";
import assert from "node:assert/strict";
import { evaluateEngineeringPolicyGate, evaluateWorkflowStageGate, runAutoCheck } from "./quality-gate.js";

function mockStage(outputArtifacts: unknown[]) {
  return {
    id: "stage_1",
    workflowId: "wf_1",
    nodeId: "design",
    templateKey: "visual_design",
    status: "running",
    assignedAgents: [],
    inputArtifacts: [],
    outputArtifacts,
    startedAt: null,
    completedAt: null,
    deadline: null,
    gateResults: null,
    contextMemoryIds: [],
    createdAt: new Date(),
    updatedAt: new Date()
  } as any;
}

test("auto_check required_sections blocks missing markdown sections", () => {
  const result = runAutoCheck({
    stage: mockStage([
      {
        name: "design_review.md",
        content: "## 页面结构\n- hero\n## 响应式规则\n- mobile"
      }
    ]),
    config: {
      validator: "required_sections",
      artifact: "design_review.md",
      sections: ["页面结构", "关键状态", "响应式规则"]
    }
  });
  assert.equal(result.passed, false);
  assert.match(result.details, /Missing required sections/i);
});

test("evaluateWorkflowStageGate supports artifact_exists + auto_check", async () => {
  const stage = mockStage([
    {
      name: "stitch_design_artifact.md",
      content: "## Stitch 设计产物\n- htmlUrl: https://stitch.example.com/a\n- imageUrl: https://stitch.example.com/a.png"
    }
  ]);
  const gate = await evaluateWorkflowStageGate({
    stage,
    acceptanceCriteria: [
      { type: "artifact_exists", config: { artifact: "stitch_design_artifact.md", minLength: 20 } },
      { type: "auto_check", config: { validator: "stitch_artifact", artifact: "stitch_design_artifact.md" } }
    ]
  });
  assert.equal(gate.passed, true);
  assert.equal(gate.violations, undefined);
});

test("engineering policy gate blocks invalid branch/commit/mr", () => {
  const result = evaluateEngineeringPolicyGate({
    branchName: "my-random-branch",
    commitMessage: "update something",
    mergeRequestDescription: "no issue ref"
  });
  assert.equal(result.passed, false);
  assert.ok((result.violations ?? []).some((item) => item.includes("engineering_branch_name")));
  assert.ok((result.violations ?? []).some((item) => item.includes("engineering_commit_message")));
  assert.ok((result.violations ?? []).some((item) => item.includes("engineering_mr_issue_link")));
});

test("engineering policy gate passes compliant inputs", () => {
  const result = evaluateEngineeringPolicyGate({
    branchName: "feature/issue-101-rag-pipeline",
    commitMessage: "feat: add rag adapter (#101)",
    mergeRequestDescription: "Related to #101"
  });
  assert.equal(result.passed, true);
  assert.equal(result.violations, undefined);
});
