import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db.js";

type WorkflowTemplateSeed = {
  key: string;
  name: string;
  category: string;
  description?: string;
  isStandalone: boolean;
  standaloneCategory: string | null;
  executorConfig: Prisma.InputJsonValue;
  inputSchema: Prisma.InputJsonValue;
  outputSchema: Prisma.InputJsonValue;
  inputContract: Prisma.InputJsonValue;
  outputContract: Prisma.InputJsonValue;
  acceptanceCriteria: Prisma.InputJsonValue;
  integrationConfig?: Prisma.InputJsonValue;
  defaultTimeout: number | null;
  allowParallel: boolean;
};

export const WORKFLOW_V2_DEFAULT_TEMPLATES: WorkflowTemplateSeed[] = [
  {
    key: "requirements_design",
    name: "需求设计",
    category: "pm",
    isStandalone: true,
    standaloneCategory: "requirements",
    executorConfig: {
      type: "agent",
      agentRole: "Product_Manager",
      requiredCapabilities: ["prd_writing", "user_story"],
      modelPreference: "openai/gpt-5.4"
    },
    inputSchema: {
      type: "object",
      properties: { rawRequirements: { type: "string" }, businessContext: { type: "string" } },
      required: ["rawRequirements"]
    },
    outputSchema: {
      type: "object",
      properties: { prd: { type: "string" }, userStories: { type: "array" }, acceptanceCriteria: { type: "array" } },
      required: ["prd", "userStories"]
    },
    inputContract: {
      requiresExternalInput: true,
      allowedInputTypes: ["document", "text", "rawrequirements", "prd"],
      inputValidationRules: [{ field: "rawRequirements", minLength: 40 }]
    },
    outputContract: {
      deliverables: ["prd", "userStories", "acceptanceCriteria"],
      handoffFormat: "markdown_bundle",
      archiveLocation: "project_deliverables"
    },
    acceptanceCriteria: [{ type: "artifact_exists", config: { artifact: "prd", minLength: 800 } }],
    defaultTimeout: 120,
    allowParallel: false
  },
  {
    key: "visual_design",
    name: "视觉设计",
    category: "design",
    isStandalone: true,
    standaloneCategory: "visual",
    executorConfig: {
      type: "agent",
      agentRole: "UI_Designer",
      requiredCapabilities: ["figma", "design_system", "ui_ux"],
      modelPreference: "openai/gpt-5.4"
    },
    inputSchema: {
      type: "object",
      properties: { prd: { type: "string" }, brandGuidelines: { type: "string" } },
      required: ["prd"]
    },
    outputSchema: {
      type: "object",
      properties: { mockups: { type: "array" }, designTokens: { type: "object" } },
      required: ["mockups"]
    },
    inputContract: {
      requiresExternalInput: true,
      allowedInputTypes: ["prd", "document", "text", "mockup"],
      inputValidationRules: [{ field: "prd", minLength: 80 }]
    },
    outputContract: {
      deliverables: ["mockups", "designTokens"],
      handoffFormat: "figma_bundle",
      archiveLocation: "design_assets"
    },
    acceptanceCriteria: [
      { type: "artifact_exists", config: { artifact: "mockups", minCount: 1 } },
      { type: "auto_check", config: { validator: "stitch_artifact", artifact: "stitch_design_artifact.md" } }
    ],
    integrationConfig: { useStitch: true, requiredTools: ["figma", "stitch"] },
    defaultTimeout: 180,
    allowParallel: false
  },
  {
    key: "tech_design",
    name: "技术设计",
    category: "dev",
    isStandalone: true,
    standaloneCategory: "tech",
    executorConfig: {
      type: "agent",
      agentRole: "Architect",
      requiredCapabilities: ["system_design", "api_design"],
      modelPreference: "openai/gpt-5.3-codex"
    },
    inputSchema: {
      type: "object",
      properties: { prd: { type: "string" }, existingArchitecture: { type: "string" } },
      required: ["prd"]
    },
    outputSchema: {
      type: "object",
      properties: { techSpec: { type: "string" }, apiContract: { type: "object" } },
      required: ["techSpec", "apiContract"]
    },
    inputContract: {
      requiresExternalInput: true,
      allowedInputTypes: ["document", "text", "prd"],
      inputValidationRules: [{ field: "prd", minLength: 40 }]
    },
    outputContract: {
      deliverables: ["techSpec", "apiContract"],
      handoffFormat: "markdown_json",
      archiveLocation: "tech_specs"
    },
    acceptanceCriteria: [{ type: "artifact_exists", config: { artifact: "techSpec" } }],
    defaultTimeout: 150,
    allowParallel: false
  },
  {
    key: "code_dev",
    name: "代码研发",
    category: "dev",
    isStandalone: true,
    standaloneCategory: "code",
    executorConfig: {
      type: "agent",
      agentRole: "Developer",
      requiredCapabilities: ["coding", "testing", "git"],
      modelPreference: "openai/gpt-5.3-codex"
    },
    inputSchema: {
      type: "object",
      properties: { techSpec: { type: "string" }, mockups: { type: "array" } },
      required: ["techSpec"]
    },
    outputSchema: {
      type: "object",
      properties: { sourceCode: { type: "string" }, testCases: { type: "array" } },
      required: ["sourceCode"]
    },
    inputContract: {
      requiresExternalInput: true,
      allowedInputTypes: ["mockup", "document", "text", "techspec", "code_repo"],
      inputValidationRules: [{ field: "mockups", minCount: 1 }]
    },
    outputContract: {
      deliverables: ["sourceCode", "testCases"],
      handoffFormat: "repo_bundle",
      archiveLocation: "code_delivery"
    },
    acceptanceCriteria: [
      { type: "artifact_exists", config: { artifact: "sourceCode" } },
      { type: "auto_check", config: { validator: "no_placeholder", artifact: "sourceCode" } }
    ],
    defaultTimeout: 300,
    allowParallel: true
  },
  {
    key: "qa_acceptance",
    name: "QA验收",
    category: "qa",
    isStandalone: true,
    standaloneCategory: "qa",
    executorConfig: {
      type: "hybrid",
      agentRole: "QA_Engineer",
      requiredCapabilities: ["testing", "automation"],
      modelPreference: "openai/gpt-5.4"
    },
    inputSchema: {
      type: "object",
      properties: { sourceCode: { type: "string" }, acceptanceCriteria: { type: "array" } },
      required: ["sourceCode", "acceptanceCriteria"]
    },
    outputSchema: {
      type: "object",
      properties: { testReport: { type: "string" }, bugList: { type: "array" }, approvalStatus: { type: "string" } },
      required: ["testReport", "approvalStatus"]
    },
    inputContract: {
      requiresExternalInput: true,
      allowedInputTypes: ["code_repo", "document", "text"],
      inputValidationRules: [{ field: "sourceCode", minLength: 20 }]
    },
    outputContract: {
      deliverables: ["testReport", "bugList", "approvalStatus"],
      handoffFormat: "report_bundle",
      archiveLocation: "qa_reports"
    },
    acceptanceCriteria: [
      { type: "artifact_exists", config: { artifact: "testReport" } },
      { type: "manual_approval", config: { role: "qa_lead" } }
    ],
    defaultTimeout: 240,
    allowParallel: false
  },
  {
    key: "standard_software_development",
    name: "标准软件开发流程",
    category: "pm",
    description: "默认完整项目流程模板（需求->视觉/技术->开发->QA）",
    isStandalone: false,
    standaloneCategory: null,
    executorConfig: { type: "agent", agentRole: "Project_Manager", requiredCapabilities: [] },
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object", properties: {} },
    inputContract: {
      requiresExternalInput: false,
      allowedInputTypes: [],
      inputValidationRules: []
    },
    outputContract: {
      deliverables: [],
      handoffFormat: "json",
      archiveLocation: "project_deliverables"
    },
    acceptanceCriteria: [],
    defaultTimeout: null,
    allowParallel: false
  }
];

export async function ensureWorkflowV2DefaultTemplates(input?: {
  client?: PrismaClient;
  keys?: string[];
}) {
  const client = input?.client ?? prisma;
  const keyFilter = new Set(
    Array.isArray(input?.keys)
      ? input?.keys.map((key) => String(key || "").trim()).filter(Boolean)
      : []
  );
  const templates = keyFilter.size > 0
    ? WORKFLOW_V2_DEFAULT_TEMPLATES.filter((template) => keyFilter.has(template.key))
    : WORKFLOW_V2_DEFAULT_TEMPLATES;

  for (const template of templates) {
    await client.workflowTemplate.upsert({
      where: { key: template.key },
      create: template,
      update: template
    });
  }

  return {
    count: templates.length,
    keys: templates.map((item) => item.key)
  };
}
