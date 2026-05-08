import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isProjectModeTemplateCompatible,
  isWorkflowTemplateKeyNone,
  normalizeGovernedProjectType,
  projectModeTemplateCompatibilityError
} from "./project-governance.js";

test("normalizeGovernedProjectType should default to complete", () => {
  assert.equal(normalizeGovernedProjectType(undefined), "complete");
  assert.equal(normalizeGovernedProjectType(""), "complete");
  assert.equal(normalizeGovernedProjectType("invalid"), "complete");
  assert.equal(normalizeGovernedProjectType("standalone"), "standalone");
  assert.equal(normalizeGovernedProjectType("relay"), "relay");
});

test("isWorkflowTemplateKeyNone should detect forbidden key", () => {
  assert.equal(isWorkflowTemplateKeyNone("none"), true);
  assert.equal(isWorkflowTemplateKeyNone(" NONE "), true);
  assert.equal(isWorkflowTemplateKeyNone("standard_software_development"), false);
  assert.equal(isWorkflowTemplateKeyNone(undefined), false);
});

test("isProjectModeTemplateCompatible should enforce template set by project type", () => {
  assert.equal(
    isProjectModeTemplateCompatible({
      projectType: "complete",
      workflowTemplateKey: "standard_software_development"
    }),
    true
  );
  assert.equal(
    isProjectModeTemplateCompatible({
      projectType: "complete",
      workflowTemplateKey: "requirements_design"
    }),
    false
  );
  assert.equal(
    isProjectModeTemplateCompatible({
      projectType: "standalone",
      workflowTemplateKey: "requirements_design"
    }),
    true
  );
  assert.equal(
    isProjectModeTemplateCompatible({
      projectType: "relay",
      workflowTemplateKey: "none"
    }),
    false
  );
});

test("projectModeTemplateCompatibilityError should return stable messages", () => {
  assert.match(
    projectModeTemplateCompatibilityError("complete"),
    /standard_software_development\/full\/lean\/maintenance/
  );
  assert.match(
    projectModeTemplateCompatibilityError("standalone"),
    /requirements_design\/visual_design\/tech_design\/code_dev\/qa_acceptance/
  );
});
