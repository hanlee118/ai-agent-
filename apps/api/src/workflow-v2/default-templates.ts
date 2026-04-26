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
  stageTasks?: Prisma.InputJsonValue;
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
    allowParallel: false,
    stageTasks: {
      ANALYSIS: [
        { title: "需求初筛", description: "冲突检测、风险分析与约束确认", assignedRole: "ROLE_ANALYST" },
        { title: "历史经验检索", description: "检索可复用的历史方案与风险模式", assignedRole: "ROLE_ANALYST", dependsOn: ["需求初筛"] },
        { title: "PRD 撰写", description: "形成结构化产品需求文档", assignedRole: "ROLE_PRODUCT", dependsOn: ["历史经验检索"] },
        { title: "项目排期方案", description: "产出里程碑与资源计划", assignedRole: "ROLE_PM", dependsOn: ["PRD 撰写"] }
      ]
    }
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
    allowParallel: false,
    stageTasks: {
      DESIGN: [
        { title: "设计目标与约束提炼", assignedRole: "ROLE_PRODUCT" },
        { title: "视觉设计草稿", assignedRole: "ROLE_DESIGN", dependsOn: ["设计目标与约束提炼"] },
        { title: "设计审查", assignedRole: "ROLE_DESIGN", dependsOn: ["视觉设计草稿"] },
        { title: "设计定稿与标注", assignedRole: "ROLE_DESIGN", dependsOn: ["设计审查"] }
      ]
    }
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
    allowParallel: false,
    stageTasks: {
      DEV: [
        { title: "技术方案选型", assignedRole: "ROLE_ARCH" },
        { title: "技术方案评审", assignedRole: "ROLE_ARCH", dependsOn: ["技术方案选型"] }
      ]
    }
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
    allowParallel: true,
    stageTasks: {
      DEV: [
        { title: "代码实现（分模块）", assignedRole: "ROLE_DEV" },
        { title: "联调与部署", assignedRole: "ROLE_DEV", dependsOn: ["代码实现（分模块）"] },
        { title: "实现结果说明", assignedRole: "ROLE_DEV", dependsOn: ["联调与部署"] }
      ]
    }
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
    allowParallel: false,
    stageTasks: {
      ACCEPT: [
        { title: "测试用例编写", assignedRole: "ROLE_QA" },
        { title: "自动化测试执行", assignedRole: "ROLE_QA", dependsOn: ["测试用例编写"] },
        { title: "性能测试执行", assignedRole: "ROLE_QA", dependsOn: ["自动化测试执行"] },
        { title: "用户验收测试", assignedRole: "ROLE_QA", dependsOn: ["性能测试执行"] },
        { title: "产品文档回填", assignedRole: "ROLE_QA", dependsOn: ["用户验收测试"] },
        { title: "复盘报告", assignedRole: "ROLE_PM", dependsOn: ["产品文档回填"] }
      ]
    }
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
    allowParallel: false,
    stageTasks: {
      INIT: [
        { title: "项目边界定义", assignedRole: "ROLE_PM" },
        { title: "团队角色确认", assignedRole: "ROLE_PM", dependsOn: ["项目边界定义"] },
        { title: "章程撰写", assignedRole: "ROLE_PM", dependsOn: ["团队角色确认"] },
        { title: "章程评审", assignedRole: "ROLE_ARCH", dependsOn: ["章程撰写"] }
      ],
      ANALYSIS: [
        { title: "需求初筛", assignedRole: "ROLE_ANALYST" },
        { title: "历史经验检索", assignedRole: "ROLE_ANALYST", dependsOn: ["需求初筛"] },
        { title: "PRD 撰写", assignedRole: "ROLE_PRODUCT", dependsOn: ["历史经验检索"] },
        { title: "PRD 技术可行性评审", assignedRole: "ROLE_DEV", dependsOn: ["PRD 撰写"] },
        { title: "项目排期方案", assignedRole: "ROLE_PM", dependsOn: ["PRD 技术可行性评审"] },
        { title: "排期评审", assignedRole: "ROLE_PM", dependsOn: ["项目排期方案"] }
      ],
      DESIGN: [
        { title: "设计目标与约束提炼", assignedRole: "ROLE_PRODUCT" },
        { title: "视觉设计草稿", assignedRole: "ROLE_DESIGN", dependsOn: ["设计目标与约束提炼"] },
        { title: "设计审查（内部+外部）", assignedRole: "ROLE_DESIGN", dependsOn: ["视觉设计草稿"] },
        { title: "设计定稿与标注", assignedRole: "ROLE_DESIGN", dependsOn: ["设计审查（内部+外部）"] }
      ],
      DEV: [
        { title: "技术方案选型", assignedRole: "ROLE_ARCH" },
        { title: "技术方案评审", assignedRole: "ROLE_ARCH", dependsOn: ["技术方案选型"] },
        { title: "代码实现（分模块）", assignedRole: "ROLE_DEV", dependsOn: ["技术方案评审"] },
        { title: "联调与部署", assignedRole: "ROLE_DEV", dependsOn: ["代码实现（分模块）"] },
        { title: "实现结果说明", assignedRole: "ROLE_DEV", dependsOn: ["联调与部署"] }
      ],
      ACCEPT: [
        { title: "测试用例编写", assignedRole: "ROLE_QA" },
        { title: "自动化测试执行", assignedRole: "ROLE_QA", dependsOn: ["测试用例编写"] },
        { title: "性能测试执行", assignedRole: "ROLE_QA", dependsOn: ["自动化测试执行"] },
        { title: "用户验收测试", assignedRole: "ROLE_QA", dependsOn: ["性能测试执行"] },
        { title: "产品文档回填", assignedRole: "ROLE_QA", dependsOn: ["用户验收测试"] },
        { title: "复盘报告", assignedRole: "ROLE_PM", dependsOn: ["产品文档回填"] }
      ]
    }
  },
  {
    key: "full",
    name: "完整流程（full）",
    category: "pm",
    description: "标准五阶段完整流程",
    isStandalone: false,
    standaloneCategory: null,
    executorConfig: { type: "agent", agentRole: "Project_Manager", requiredCapabilities: [] },
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object", properties: {} },
    inputContract: { requiresExternalInput: false, allowedInputTypes: [], inputValidationRules: [] },
    outputContract: { deliverables: [], handoffFormat: "json", archiveLocation: "project_deliverables" },
    acceptanceCriteria: [],
    defaultTimeout: null,
    allowParallel: false,
    stageTasks: {
      INIT: [
        { title: "项目边界定义", assignedRole: "ROLE_PM" },
        { title: "团队角色确认", assignedRole: "ROLE_PM", dependsOn: ["项目边界定义"] },
        { title: "章程撰写", assignedRole: "ROLE_PM", dependsOn: ["团队角色确认"] },
        { title: "章程评审", assignedRole: "ROLE_ARCH", dependsOn: ["章程撰写"] }
      ],
      ANALYSIS: [
        { title: "需求初筛", assignedRole: "ROLE_ANALYST" },
        { title: "历史经验检索", assignedRole: "ROLE_ANALYST", dependsOn: ["需求初筛"] },
        { title: "PRD 撰写", assignedRole: "ROLE_PRODUCT", dependsOn: ["历史经验检索"] },
        { title: "PRD 技术可行性评审", assignedRole: "ROLE_DEV", dependsOn: ["PRD 撰写"] },
        { title: "项目排期方案", assignedRole: "ROLE_PM", dependsOn: ["PRD 技术可行性评审"] },
        { title: "排期评审", assignedRole: "ROLE_PM", dependsOn: ["项目排期方案"] }
      ],
      DESIGN: [
        { title: "设计目标与约束提炼", assignedRole: "ROLE_PRODUCT" },
        { title: "视觉设计草稿", assignedRole: "ROLE_DESIGN", dependsOn: ["设计目标与约束提炼"] },
        { title: "设计审查（内部+外部）", assignedRole: "ROLE_DESIGN", dependsOn: ["视觉设计草稿"] },
        { title: "设计定稿与标注", assignedRole: "ROLE_DESIGN", dependsOn: ["设计审查（内部+外部）"] }
      ],
      DEV: [
        { title: "技术方案选型", assignedRole: "ROLE_ARCH" },
        { title: "技术方案评审", assignedRole: "ROLE_ARCH", dependsOn: ["技术方案选型"] },
        { title: "代码实现（分模块）", assignedRole: "ROLE_DEV", dependsOn: ["技术方案评审"] },
        { title: "联调与部署", assignedRole: "ROLE_DEV", dependsOn: ["代码实现（分模块）"] },
        { title: "实现结果说明", assignedRole: "ROLE_DEV", dependsOn: ["联调与部署"] }
      ],
      ACCEPT: [
        { title: "测试用例编写", assignedRole: "ROLE_QA" },
        { title: "自动化测试执行", assignedRole: "ROLE_QA", dependsOn: ["测试用例编写"] },
        { title: "性能测试执行", assignedRole: "ROLE_QA", dependsOn: ["自动化测试执行"] },
        { title: "用户验收测试", assignedRole: "ROLE_QA", dependsOn: ["性能测试执行"] },
        { title: "产品文档回填", assignedRole: "ROLE_QA", dependsOn: ["用户验收测试"] },
        { title: "复盘报告", assignedRole: "ROLE_PM", dependsOn: ["产品文档回填"] }
      ]
    }
  },
  {
    key: "lean",
    name: "精简流程（lean）",
    category: "pm",
    description: "精简流程：INIT→ANALYSIS→DEV→ACCEPT（ANALYSIS 含需求与设计约束）",
    isStandalone: false,
    standaloneCategory: null,
    executorConfig: { type: "agent", agentRole: "Project_Manager", requiredCapabilities: [] },
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object", properties: {} },
    inputContract: { requiresExternalInput: false, allowedInputTypes: [], inputValidationRules: [] },
    outputContract: { deliverables: [], handoffFormat: "json", archiveLocation: "project_deliverables" },
    acceptanceCriteria: [],
    defaultTimeout: null,
    allowParallel: false,
    stageTasks: {
      INIT: [
        { title: "项目边界定义", assignedRole: "ROLE_PM" },
        { title: "团队角色确认", assignedRole: "ROLE_PM", dependsOn: ["项目边界定义"] }
      ],
      ANALYSIS: [
        { title: "需求初筛", assignedRole: "ROLE_ANALYST" },
        { title: "PRD 撰写", assignedRole: "ROLE_PRODUCT", dependsOn: ["需求初筛"] },
        { title: "项目排期方案", assignedRole: "ROLE_PM", dependsOn: ["PRD 撰写"] }
      ],
      DEV: [
        { title: "技术方案选型", assignedRole: "ROLE_ARCH" },
        { title: "代码实现（分模块）", assignedRole: "ROLE_DEV", dependsOn: ["技术方案选型"] },
        { title: "联调与部署", assignedRole: "ROLE_DEV", dependsOn: ["代码实现（分模块）"] }
      ],
      ACCEPT: [
        { title: "自动化测试执行", assignedRole: "ROLE_QA" },
        { title: "用户验收测试", assignedRole: "ROLE_QA", dependsOn: ["自动化测试执行"] },
        { title: "复盘报告", assignedRole: "ROLE_PM", dependsOn: ["用户验收测试"] }
      ]
    }
  },
  {
    key: "maintenance",
    name: "维护流程（maintenance）",
    category: "pm",
    description: "维护场景：DEV→ACCEPT",
    isStandalone: false,
    standaloneCategory: null,
    executorConfig: { type: "agent", agentRole: "Project_Manager", requiredCapabilities: [] },
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object", properties: {} },
    inputContract: { requiresExternalInput: false, allowedInputTypes: [], inputValidationRules: [] },
    outputContract: { deliverables: [], handoffFormat: "json", archiveLocation: "project_deliverables" },
    acceptanceCriteria: [],
    defaultTimeout: null,
    allowParallel: false,
    stageTasks: {
      DEV: [
        { title: "技术方案选型", assignedRole: "ROLE_ARCH" },
        { title: "代码实现（分模块）", assignedRole: "ROLE_DEV", dependsOn: ["技术方案选型"] },
        { title: "联调与部署", assignedRole: "ROLE_DEV", dependsOn: ["代码实现（分模块）"] }
      ],
      ACCEPT: [
        { title: "回归测试执行", assignedRole: "ROLE_QA" },
        { title: "上线验收确认", assignedRole: "ROLE_QA", dependsOn: ["回归测试执行"] },
        { title: "复盘报告", assignedRole: "ROLE_PM", dependsOn: ["上线验收确认"] }
      ]
    }
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
