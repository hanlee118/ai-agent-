import { prisma } from "../apps/api/src/db.js";

const DEFAULT_TEMPLATES = [
  {
    key: "requirements_design",
    name: "需求设计",
    category: "pm",
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
    acceptanceCriteria: [{ type: "artifact_exists", config: { artifact: "prd", minLength: 800 } }],
    defaultTimeout: 120,
    allowParallel: false
  },
  {
    key: "visual_design",
    name: "视觉设计",
    category: "design",
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
    acceptanceCriteria: [{ type: "artifact_exists", config: { artifact: "techSpec" } }],
    defaultTimeout: 150,
    allowParallel: false
  },
  {
    key: "code_dev",
    name: "代码研发",
    category: "dev",
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
    executorConfig: { type: "agent", agentRole: "Project_Manager", requiredCapabilities: [] },
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object", properties: {} },
    acceptanceCriteria: [],
    defaultTimeout: null,
    allowParallel: false
  }
];

async function seed() {
  for (const template of DEFAULT_TEMPLATES) {
    await prisma.workflowTemplate.upsert({
      where: {
        key: template.key
      },
      create: template,
      update: template
    });
    // eslint-disable-next-line no-console
    console.log(`Seeded workflow template: ${template.key}`);
  }
}

seed()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
