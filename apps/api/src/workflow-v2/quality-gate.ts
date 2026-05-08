import type { WorkflowStage } from "@prisma/client";
import { asRecord, asStringArray, normalizeText } from "./types.js";
import type { AcceptanceCriterion } from "./types.js";

export type GateEvaluationResult = {
  passed: boolean;
  violations?: string[];
  checks?: Array<{ type: string; passed: boolean; details: string }>;
};

export type EngineeringPolicyGateInput = {
  branchName?: string;
  commitMessage?: string;
  mergeRequestDescription?: string;
};

const BRANCH_RULE = /^(feature|fix|hotfix)\/issue-\d+-[a-z0-9-]+$/;
const COMMIT_RULE = /^(feat:|fix:|refactor:|docs:|test:|chore:)/i;
const MR_ISSUE_RULE = /(Related to #\d+|Closes #\d+)/i;

type CheckResult = { passed: boolean; details: string };

type AutoCheckValidator = (input: {
  stage: WorkflowStage;
  config: Record<string, unknown>;
  artifacts: Array<Record<string, unknown>>;
}) => CheckResult;

const PLACEHOLDER_PATTERN = /(TODO|TBD|待补充|占位|lorem ipsum|\bxxx\b)/i;
const STITCH_LINK_PATTERN = /(stitch|stitch\.withgoogle|https?:\/\/[^\s)]+)/i;

function getDesignStitchModeForWorkflowGate() {
  const raw = String(process.env.DESIGN_STITCH_MODE ?? "").trim().toLowerCase();
  if (raw === "required" || raw === "strict" || raw === "hard") {
    return "required";
  }
  if (raw === "preferred" || raw === "on" || raw === "true" || raw === "1") {
    return "preferred";
  }
  return "off";
}

function findArtifactByName(artifacts: Array<Record<string, unknown>>, name: string) {
  const normalized = normalizeText(name);
  if (!normalized) {
    return null;
  }
  return artifacts.find((item) => normalizeText(item.name) === normalized) ?? null;
}

function artifactContent(artifact: Record<string, unknown> | null): string {
  if (!artifact) {
    return "";
  }
  return String(artifact.content ?? "");
}

const autoCheckValidators: Record<string, AutoCheckValidator> = {
  required_sections: ({ config, artifacts }) => {
    const required = asStringArray(config.sections);
    const artifact = findArtifactByName(artifacts, normalizeText(config.artifact));
    const content = artifactContent(artifact);
    const missing = required.filter((section) => !new RegExp(`^##\\s*${section}\\b`, "im").test(content));
    if (missing.length > 0) {
      return {
        passed: false,
        details: `Missing required sections: ${missing.join(", ")}`
      };
    }
    return { passed: true, details: "sections ok" };
  },
  json_required_fields: ({ config, artifacts }) => {
    const required = asStringArray(config.fields);
    const artifact = findArtifactByName(artifacts, normalizeText(config.artifact));
    const content = artifactContent(artifact);
    if (!content.trim()) {
      return { passed: false, details: "artifact content is empty" };
    }
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const missing = required.filter((field) => !(field in parsed));
      if (missing.length > 0) {
        return { passed: false, details: `missing json fields: ${missing.join(", ")}` };
      }
      return { passed: true, details: "json fields ok" };
    } catch {
      return { passed: false, details: "artifact is not valid json" };
    }
  },
  stitch_artifact: ({ config, artifacts }) => {
    const stitchMode = getDesignStitchModeForWorkflowGate();
    const stitchHardRequired = stitchMode === "required";
    const artifact = findArtifactByName(artifacts, normalizeText(config.artifact))
      ?? artifacts.find((item) => /stitch/i.test(String(item.name ?? "")))
      ?? null;
    const content = artifactContent(artifact);
    if (!content.trim()) {
      if (!stitchHardRequired) {
        return { passed: true, details: `stitch artifact optional in ${stitchMode} mode` };
      }
      return { passed: false, details: "stitch artifact missing" };
    }
    if (!STITCH_LINK_PATTERN.test(content)) {
      if (!stitchHardRequired) {
        return { passed: true, details: `stitch evidence weak but allowed in ${stitchMode} mode` };
      }
      return { passed: false, details: "stitch link/evidence missing" };
    }
    return { passed: true, details: "stitch evidence ok" };
  },
  no_placeholder: ({ config, artifacts }) => {
    const artifact = findArtifactByName(artifacts, normalizeText(config.artifact));
    const content = artifactContent(artifact);
    if (!content.trim()) {
      return { passed: false, details: "artifact content is empty" };
    }
    if (PLACEHOLDER_PATTERN.test(content)) {
      return { passed: false, details: "placeholder content detected" };
    }
    return { passed: true, details: "content quality baseline passed" };
  }
};

export function runAutoCheck(input: {
  stage: WorkflowStage;
  config: Record<string, unknown>;
}): CheckResult {
  const validatorName = normalizeText(input.config.validator).toLowerCase();
  const validator = autoCheckValidators[validatorName];
  if (!validator) {
    return {
      passed: false,
      details: `auto_check validator not found: ${validatorName || "unknown"}`
    };
  }
  const artifacts = Array.isArray(input.stage.outputArtifacts)
    ? (input.stage.outputArtifacts as Array<Record<string, unknown>>)
    : [];
  return validator({
    stage: input.stage,
    config: input.config,
    artifacts
  });
}

export async function evaluateWorkflowStageGate(input: {
  stage: WorkflowStage;
  acceptanceCriteria: AcceptanceCriterion[];
}): Promise<GateEvaluationResult> {
  const violations: string[] = [];
  const checks: Array<{ type: string; passed: boolean; details: string }> = [];
  const artifacts = Array.isArray(input.stage.outputArtifacts)
    ? (input.stage.outputArtifacts as Array<Record<string, unknown>>)
    : [];
  const existingGate = asRecord(input.stage.gateResults ?? {});

  for (const criterion of input.acceptanceCriteria) {
    const config = asRecord(criterion.config) ?? {};
    let result: CheckResult = { passed: true, details: "OK" };
    if (criterion.type === "artifact_exists") {
      const name = normalizeText(config.artifact);
      if (!name) {
        result = { passed: false, details: "artifact config missing" };
      } else {
        const artifact = findArtifactByName(artifacts, name);
        if (!artifact) {
          result = { passed: false, details: `Missing artifact: ${name}` };
        } else {
          const minLength = Number(config.minLength ?? 0);
          if (Number.isFinite(minLength) && minLength > 0 && artifactContent(artifact).length < minLength) {
            result = { passed: false, details: `${name} too short` };
          }
          const minCount = Number(config.minCount ?? 0);
          if (result.passed && Number.isFinite(minCount) && minCount > 0 && artifacts.length < minCount) {
            result = { passed: false, details: `Need at least ${minCount} artifacts` };
          }
        }
      }
    } else if (criterion.type === "manual_approval") {
      const role = normalizeText(config.role);
      const approvals = asRecord(existingGate?.manualApprovals ?? {});
      const approved = Boolean(role && approvals?.[role]);
      result = approved
        ? { passed: true, details: "Approved" }
        : { passed: false, details: `Pending manual approval${role ? ` (${role})` : ""}` };
    } else if (criterion.type === "quality_gate") {
      const minScore = Number(config.minScore ?? 0);
      const score = Number(existingGate?.qualityScore ?? 0);
      if (Number.isFinite(minScore) && minScore > 0 && score < minScore) {
        result = { passed: false, details: `quality score ${score} < ${minScore}` };
      } else {
        result = { passed: true, details: "quality gate passed" };
      }
    } else if (criterion.type === "auto_check") {
      result = runAutoCheck({
        stage: input.stage,
        config
      });
    }

    checks.push({
      type: criterion.type,
      passed: result.passed,
      details: result.details
    });
    if (!result.passed) {
      violations.push(`${criterion.type}: ${result.details}`);
    }
  }

  return {
    passed: violations.length === 0,
    violations: violations.length > 0 ? violations : undefined,
    checks
  };
}

export function evaluateEngineeringPolicyGate(input: EngineeringPolicyGateInput): GateEvaluationResult {
  const violations: string[] = [];
  const checks: Array<{ type: string; passed: boolean; details: string }> = [];

  const branch = String(input.branchName ?? "").trim();
  const commit = String(input.commitMessage ?? "").trim();
  const mrDesc = String(input.mergeRequestDescription ?? "").trim();
  const hasGitContext = Boolean(branch || commit || mrDesc);

  if (!hasGitContext) {
    checks.push({
      type: "engineering_policy_context",
      passed: true,
      details: "缺少 Git 上下文，跳过工程规范门禁（仅记录）"
    });
    return {
      passed: true,
      checks
    };
  }

  const branchPassed = BRANCH_RULE.test(branch);
  checks.push({
    type: "engineering_branch_name",
    passed: branchPassed,
    details: branchPassed
      ? "branch name ok"
      : "分支名不符合规范，请使用 feature/issue-<ID>-<描述> 格式"
  });
  if (!branchPassed) {
    violations.push("engineering_branch_name: 分支名不符合规范，请使用 feature/issue-<ID>-<描述> 格式");
  }

  const commitPassed = COMMIT_RULE.test(commit);
  checks.push({
    type: "engineering_commit_message",
    passed: commitPassed,
    details: commitPassed
      ? "commit message ok"
      : "Commit message 不符合规范，需以 feat:/fix:/refactor:/docs:/test:/chore: 开头"
  });
  if (!commitPassed) {
    violations.push("engineering_commit_message: Commit message 不符合规范");
  }

  const mrPassed = MR_ISSUE_RULE.test(mrDesc);
  checks.push({
    type: "engineering_mr_issue_link",
    passed: mrPassed,
    details: mrPassed
      ? "mr issue link ok"
      : "MR 描述缺少 Issue 关联，请包含 Related to #<ID> 或 Closes #<ID>"
  });
  if (!mrPassed) {
    violations.push("engineering_mr_issue_link: MR 描述缺少 Issue 关联");
  }

  return {
    passed: violations.length === 0,
    violations: violations.length > 0 ? violations : undefined,
    checks
  };
}
