export type GovernedProjectType = "complete" | "standalone" | "relay";

const COMPLETE_TEMPLATE_KEYS = new Set([
  "standard_software_development",
  "full",
  "lean",
  "maintenance"
]);

const SINGLE_STAGE_TEMPLATE_KEYS = new Set([
  "requirements_design",
  "visual_design",
  "tech_design",
  "code_dev",
  "qa_acceptance"
]);

export function normalizeGovernedProjectType(input: unknown): GovernedProjectType {
  const normalized = String(input ?? "").trim().toLowerCase();
  if (normalized === "standalone" || normalized === "relay") {
    return normalized;
  }
  return "complete";
}

export function isWorkflowTemplateKeyNone(value: unknown) {
  return String(value ?? "").trim().toLowerCase() === "none";
}

export function isProjectModeTemplateCompatible(input: {
  projectType: GovernedProjectType;
  workflowTemplateKey: unknown;
}) {
  const normalizedTemplateKey = String(input.workflowTemplateKey ?? "").trim().toLowerCase();
  const templateKey = normalizedTemplateKey || "standard_software_development";
  if (input.projectType === "complete") {
    return COMPLETE_TEMPLATE_KEYS.has(templateKey);
  }
  return SINGLE_STAGE_TEMPLATE_KEYS.has(templateKey);
}

export function projectModeTemplateCompatibilityError(projectType: GovernedProjectType) {
  return projectType === "complete"
    ? "workflowTemplateKey must be standard_software_development/full/lean/maintenance when projectType=complete"
    : "workflowTemplateKey must be one of requirements_design/visual_design/tech_design/code_dev/qa_acceptance for standalone or relay projectType";
}
