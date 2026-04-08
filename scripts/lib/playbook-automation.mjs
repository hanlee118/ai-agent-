import fs from "node:fs";
import path from "node:path";

export function loadPlaybookFromFile(inputPath) {
  const resolved = path.resolve(process.cwd(), inputPath);
  const raw = fs.readFileSync(resolved, "utf8");
  return {
    path: resolved,
    playbook: JSON.parse(raw)
  };
}

export function validatePlaybook(playbook) {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(playbook)) {
    return {
      ok: false,
      errors: ["playbook must be an object"],
      warnings,
      meta: {}
    };
  }

  const requiredTopLevelFields = [
    "playbook_name",
    "playbook_version",
    "global_rules",
    "recommended_order",
    "issues"
  ];
  for (const field of requiredTopLevelFields) {
    if (!(field in playbook)) {
      errors.push(`missing top-level field: ${field}`);
    }
  }

  if (!Array.isArray(playbook.issues) || playbook.issues.length === 0) {
    errors.push("issues must be a non-empty array");
  }

  const issues = Array.isArray(playbook.issues) ? playbook.issues : [];
  const issueIds = new Set();
  const issueMap = new Map();

  for (const issue of issues) {
    if (!isPlainObject(issue)) {
      errors.push("each issue must be an object");
      continue;
    }

    const id = String(issue.id || "").trim();
    if (!id) {
      errors.push("issue.id is required");
      continue;
    }
    if (issueIds.has(id)) {
      errors.push(`duplicate issue id: ${id}`);
      continue;
    }
    issueIds.add(id);
    issueMap.set(id, issue);

    validateIssueShape(issue, errors, warnings);
  }

  const recommendedOrder = Array.isArray(playbook.recommended_order) ? playbook.recommended_order : [];
  for (const issueId of recommendedOrder) {
    if (!issueIds.has(issueId)) {
      errors.push(`recommended_order references unknown issue id: ${issueId}`);
    }
  }

  for (const issue of issues) {
    const dependsOn = Array.isArray(issue.depends_on) ? issue.depends_on : [];
    for (const dep of dependsOn) {
      if (!issueIds.has(dep)) {
        errors.push(`issue ${issue.id} depends_on unknown issue id: ${dep}`);
      }
    }
  }

  const cycle = detectDependencyCycle(issues);
  if (cycle.length > 0) {
    errors.push(`dependency cycle detected: ${cycle.join(" -> ")}`);
  }

  for (const issue of issues) {
    if (issue.auto_run_if_previous_passed === true) {
      const dependsOn = Array.isArray(issue.depends_on) ? issue.depends_on : [];
      if (dependsOn.length === 0) {
        warnings.push(`issue ${issue.id} enables auto_run_if_previous_passed but has no depends_on`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    meta: {
      issueCount: issues.length,
      recommendedOrderCount: recommendedOrder.length
    }
  };
}

export function materializePlaybookIssue(playbook, issueId) {
  const issues = Array.isArray(playbook.issues) ? playbook.issues : [];
  const issue = issues.find((item) => String(item.id || "").trim() === String(issueId || "").trim());
  if (!issue) {
    throw new Error(`Issue not found in playbook: ${issueId}`);
  }

  return {
    issue_id: issue.id,
    playbook_name: playbook.playbook_name,
    playbook_version: playbook.playbook_version,
    issue_title: issue.issue_title,
    issue_labels: Array.isArray(issue.issue_labels) ? issue.issue_labels : [],
    source_of_truth: issue.source_of_truth || {},
    validation_commands: Array.isArray(issue.validation_commands) ? issue.validation_commands : [],
    stop_conditions: issue.stop_conditions || { hard_stop: [], soft_stop: [] },
    compatibility_policy: issue.compatibility_policy || {
      allow_compat_layer: false,
      rule: ""
    },
    issue_body: issue.issue_body,
    codex_prompt_text: issue.codex_prompt,
    codex_prompt_sections: {
      task_type: inferTaskTypeFromLabels(issue.issue_labels),
      issue_id: issue.id,
      depends_on: Array.isArray(issue.depends_on) ? issue.depends_on : [],
      auto_run_if_previous_passed: issue.auto_run_if_previous_passed === true,
      artifact_requirements: issue.artifact_requirements || {},
      result_schema: issue.result_schema || {},
      blocking_policy: issue.blocking_policy || {},
      source_of_truth: flattenSourceOfTruth(issue.source_of_truth),
      validation_commands: Array.isArray(issue.validation_commands) ? issue.validation_commands : [],
      stop_conditions: issue.stop_conditions || { hard_stop: [], soft_stop: [] }
    },
    depends_on: Array.isArray(issue.depends_on) ? issue.depends_on : [],
    auto_run_if_previous_passed: issue.auto_run_if_previous_passed === true,
    blocking_policy: issue.blocking_policy || {},
    artifact_requirements: issue.artifact_requirements || {},
    result_schema: issue.result_schema || {}
  };
}

function validateIssueShape(issue, errors, warnings) {
  const requiredFields = [
    "id",
    "depends_on",
    "artifact_requirements",
    "result_schema",
    "issue_title",
    "issue_labels",
    "source_of_truth",
    "validation_commands",
    "stop_conditions",
    "compatibility_policy",
    "issue_body",
    "codex_prompt"
  ];

  for (const field of requiredFields) {
    if (!(field in issue)) {
      errors.push(`issue ${issue.id || "<unknown>"} missing field: ${field}`);
    }
  }

  if (!Array.isArray(issue.depends_on)) {
    errors.push(`issue ${issue.id} depends_on must be an array`);
  }

  if (!Array.isArray(issue.issue_labels) || issue.issue_labels.length === 0) {
    errors.push(`issue ${issue.id} issue_labels must be a non-empty array`);
  }

  if (!isPlainObject(issue.source_of_truth) || Object.keys(issue.source_of_truth).length === 0) {
    errors.push(`issue ${issue.id} source_of_truth must be a non-empty object`);
  }

  if (!Array.isArray(issue.validation_commands) || issue.validation_commands.length === 0) {
    errors.push(`issue ${issue.id} validation_commands must be a non-empty array`);
  } else {
    for (const command of issue.validation_commands) {
      if (!isPlainObject(command) || typeof command.command !== "string" || typeof command.required !== "boolean") {
        errors.push(`issue ${issue.id} has invalid validation_commands item`);
      }
    }
  }

  if (
    !isPlainObject(issue.stop_conditions)
    || !Array.isArray(issue.stop_conditions.hard_stop)
    || !Array.isArray(issue.stop_conditions.soft_stop)
  ) {
    errors.push(`issue ${issue.id} stop_conditions must include hard_stop and soft_stop arrays`);
  }

  if (
    !isPlainObject(issue.compatibility_policy)
    || typeof issue.compatibility_policy.allow_compat_layer !== "boolean"
    || typeof issue.compatibility_policy.rule !== "string"
  ) {
    errors.push(`issue ${issue.id} compatibility_policy is invalid`);
  }

  if (
    !isPlainObject(issue.artifact_requirements)
    || !Array.isArray(issue.artifact_requirements.must_produce)
  ) {
    errors.push(`issue ${issue.id} artifact_requirements.must_produce must be an array`);
  }

  if (!isPlainObject(issue.result_schema)) {
    errors.push(`issue ${issue.id} result_schema must be an object`);
  } else {
    if (issue.result_schema.type !== "object") {
      errors.push(`issue ${issue.id} result_schema.type must be "object"`);
    }
    if (!Array.isArray(issue.result_schema.required)) {
      errors.push(`issue ${issue.id} result_schema.required must be an array`);
    }
  }

  if (typeof issue.issue_title !== "string" || issue.issue_title.trim().length < 5) {
    errors.push(`issue ${issue.id} issue_title is invalid`);
  }
  if (typeof issue.issue_body !== "string" || issue.issue_body.trim().length < 50) {
    errors.push(`issue ${issue.id} issue_body is too short`);
  }
  if (typeof issue.codex_prompt !== "string" || issue.codex_prompt.trim().length < 50) {
    errors.push(`issue ${issue.id} codex_prompt is too short`);
  }

  if (!isPlainObject(issue.blocking_policy)) {
    warnings.push(`issue ${issue.id} missing or invalid blocking_policy`);
  }
}

function detectDependencyCycle(issues) {
  const graph = new Map();
  for (const issue of issues) {
    graph.set(issue.id, Array.isArray(issue.depends_on) ? issue.depends_on : []);
  }

  const visiting = new Set();
  const visited = new Set();
  const path = [];

  function dfs(node) {
    if (visiting.has(node)) {
      const cycleStart = path.indexOf(node);
      return cycleStart >= 0 ? [...path.slice(cycleStart), node] : [node];
    }
    if (visited.has(node)) {
      return [];
    }

    visiting.add(node);
    path.push(node);

    for (const next of graph.get(node) || []) {
      const found = dfs(next);
      if (found.length > 0) {
        return found;
      }
    }

    path.pop();
    visiting.delete(node);
    visited.add(node);
    return [];
  }

  for (const node of graph.keys()) {
    const cycle = dfs(node);
    if (cycle.length > 0) {
      return cycle;
    }
  }
  return [];
}

function flattenSourceOfTruth(sourceOfTruth) {
  if (!isPlainObject(sourceOfTruth)) {
    return [];
  }
  return Object.values(sourceOfTruth)
    .flatMap((value) => Array.isArray(value) ? value : [])
    .filter((value) => typeof value === "string" && value.trim());
}

function inferTaskTypeFromLabels(labels) {
  const joined = Array.isArray(labels) ? labels.join(",").toLowerCase() : "";
  if (joined.includes("stabilization") || joined.includes("hardening")) {
    return "stabilization";
  }
  if (joined.includes("integration")) {
    return "integration";
  }
  return "feature";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
