import express from "express";
import { asyncRoute, sendError, sendSuccess } from "./utils.js";

export type RoleId =
  | "ROLE_ASSISTANT"
  | "ROLE_PM"
  | "ROLE_ANALYST"
  | "ROLE_PRODUCT"
  | "ROLE_DESIGN"
  | "ROLE_ARCH"
  | "ROLE_DEV"
  | "ROLE_QA"
  | "ROLE_HR";

type RoleSetStatus = "active" | "inactive";
type FallbackStrategy = "template_first" | "role_pool_auto";

export interface IndustryRoleSet {
  id: string;
  industryCode: string;
  industryName: string;
  roleIds: RoleId[];
  defaultSoulRoleId: RoleId;
  status: RoleSetStatus;
  version: string;
  updatedAt: string;
}

export interface SopStep {
  order: number;
  roleId: RoleId;
  title: string;
  input: string;
  output: string;
}

export interface TeamSopWorkflow {
  id: string;
  industryRoleSetId: string;
  name: string;
  steps: SopStep[];
  requiredRoleIds: RoleId[];
  isDefault: boolean;
  version: string;
  updatedAt: string;
}

export interface TeamAssemblyRule {
  id: string;
  industryCode: string;
  mustHaveSoulRole: boolean;
  soulRoleId: RoleId;
  minRoles: number;
  maxRoles: number | null;
  fallbackStrategy: FallbackStrategy;
  updatedAt: string;
}

export interface IndustryTeamConfig {
  roleSet: IndustryRoleSet;
  workflows: TeamSopWorkflow[];
  assemblyRule: TeamAssemblyRule;
}

function nowIso() {
  return new Date().toISOString();
}

const INDUSTRY_TEAM_CONFIGS: Record<string, IndustryTeamConfig> = {
  saas: {
    roleSet: {
      id: "role-set-saas-v1",
      industryCode: "saas",
      industryName: "SaaS 企业服务",
      roleIds: ["ROLE_PM", "ROLE_ANALYST", "ROLE_PRODUCT", "ROLE_DESIGN", "ROLE_ARCH", "ROLE_DEV", "ROLE_QA"],
      defaultSoulRoleId: "ROLE_ANALYST",
      status: "active",
      version: "v1",
      updatedAt: nowIso()
    },
    workflows: [
      {
        id: "sop-saas-requirement-v1",
        industryRoleSetId: "role-set-saas-v1",
        name: "SaaS 需求到交付标准流程",
        requiredRoleIds: ["ROLE_ANALYST", "ROLE_PRODUCT", "ROLE_DESIGN", "ROLE_DEV", "ROLE_QA"],
        isDefault: true,
        version: "v1",
        updatedAt: nowIso(),
        steps: [
          {
            order: 1,
            roleId: "ROLE_ANALYST",
            title: "需求理解与边界识别",
            input: "Issue + Product Spec + 历史变更",
            output: "问题清单、风险点、冲突点"
          },
          {
            order: 2,
            roleId: "ROLE_PRODUCT",
            title: "产品方案与验收标准",
            input: "分析结论",
            output: "需求合同草案、验收标准"
          },
          {
            order: 3,
            roleId: "ROLE_DESIGN",
            title: "视觉与交互方案审查",
            input: "需求合同草案",
            output: "视觉方向、组件规范、可访问性检查项"
          },
          {
            order: 4,
            roleId: "ROLE_DEV",
            title: "任务拆解与开发执行",
            input: "已确认需求合同 + 设计审查卡",
            output: "代码变更与 Demo"
          },
          {
            order: 5,
            roleId: "ROLE_QA",
            title: "回归验证与发布建议",
            input: "执行结果",
            output: "验证报告与回填建议"
          }
        ]
      }
    ],
    assemblyRule: {
      id: "assembly-saas-v1",
      industryCode: "saas",
      mustHaveSoulRole: true,
      soulRoleId: "ROLE_ANALYST",
      minRoles: 4,
      maxRoles: 8,
      fallbackStrategy: "template_first",
      updatedAt: nowIso()
    }
  },
  ecommerce: {
    roleSet: {
      id: "role-set-ecommerce-v1",
      industryCode: "ecommerce",
      industryName: "电商零售",
      roleIds: ["ROLE_PM", "ROLE_ANALYST", "ROLE_PRODUCT", "ROLE_DESIGN", "ROLE_DEV", "ROLE_QA", "ROLE_HR"],
      defaultSoulRoleId: "ROLE_ANALYST",
      status: "active",
      version: "v1",
      updatedAt: nowIso()
    },
    workflows: [
      {
        id: "sop-ecommerce-v1",
        industryRoleSetId: "role-set-ecommerce-v1",
        name: "电商需求协同流程",
        requiredRoleIds: ["ROLE_ANALYST", "ROLE_PRODUCT", "ROLE_DESIGN", "ROLE_DEV", "ROLE_QA"],
        isDefault: true,
        version: "v1",
        updatedAt: nowIso(),
        steps: [
          {
            order: 1,
            roleId: "ROLE_ANALYST",
            title: "业务场景与漏斗分析",
            input: "Issue + 竞品 + 数据假设",
            output: "核心场景、指标目标、风险项"
          },
          {
            order: 2,
            roleId: "ROLE_PRODUCT",
            title: "体验与流程方案设计",
            input: "分析结果",
            output: "页面流程、交互原则、验收标准"
          },
          {
            order: 3,
            roleId: "ROLE_DESIGN",
            title: "视觉方案与品牌一致性审查",
            input: "体验与流程方案",
            output: "视觉规范、组件清单、设计审查卡"
          },
          {
            order: 4,
            roleId: "ROLE_DEV",
            title: "研发实施与联调",
            input: "确认方案 + 设计审查卡",
            output: "可演示原型与实现说明"
          },
          {
            order: 5,
            roleId: "ROLE_QA",
            title: "验收与风险复核",
            input: "实现结果",
            output: "质量结论、上线建议"
          }
        ]
      }
    ],
    assemblyRule: {
      id: "assembly-ecommerce-v1",
      industryCode: "ecommerce",
      mustHaveSoulRole: true,
      soulRoleId: "ROLE_ANALYST",
      minRoles: 4,
      maxRoles: 8,
      fallbackStrategy: "template_first",
      updatedAt: nowIso()
    }
  },
  fintech: {
    roleSet: {
      id: "role-set-fintech-v1",
      industryCode: "fintech",
      industryName: "金融科技",
      roleIds: ["ROLE_PM", "ROLE_ANALYST", "ROLE_PRODUCT", "ROLE_DESIGN", "ROLE_ARCH", "ROLE_DEV", "ROLE_QA", "ROLE_HR"],
      defaultSoulRoleId: "ROLE_ANALYST",
      status: "active",
      version: "v1",
      updatedAt: nowIso()
    },
    workflows: [
      {
        id: "sop-fintech-v1",
        industryRoleSetId: "role-set-fintech-v1",
        name: "金融合规需求流程",
        requiredRoleIds: ["ROLE_ANALYST", "ROLE_PRODUCT", "ROLE_DESIGN", "ROLE_ARCH", "ROLE_DEV", "ROLE_QA"],
        isDefault: true,
        version: "v1",
        updatedAt: nowIso(),
        steps: [
          {
            order: 1,
            roleId: "ROLE_ANALYST",
            title: "需求合规识别",
            input: "Issue + 产品原则 + 合规约束",
            output: "需求边界、冲突条款、补充问题"
          },
          {
            order: 2,
            roleId: "ROLE_PRODUCT",
            title: "产品方案与验收边界",
            input: "需求边界、冲突条款",
            output: "结构化方案与验收条目"
          },
          {
            order: 3,
            roleId: "ROLE_DESIGN",
            title: "高风险场景视觉与交互审查",
            input: "结构化方案",
            output: "视觉风险说明、无障碍清单、设计审查卡"
          },
          {
            order: 4,
            roleId: "ROLE_ARCH",
            title: "架构与安全方案",
            input: "确认需求 + 设计审查卡",
            output: "架构方案与风控措施"
          },
          {
            order: 5,
            roleId: "ROLE_DEV",
            title: "实现与审计留痕",
            input: "架构方案",
            output: "实现成果与审计信息"
          },
          {
            order: 6,
            roleId: "ROLE_QA",
            title: "验证与准入评审",
            input: "实现成果",
            output: "验证报告与上线准入结论"
          }
        ]
      }
    ],
    assemblyRule: {
      id: "assembly-fintech-v1",
      industryCode: "fintech",
      mustHaveSoulRole: true,
      soulRoleId: "ROLE_ANALYST",
      minRoles: 4,
      maxRoles: 9,
      fallbackStrategy: "template_first",
      updatedAt: nowIso()
    }
  }
};

export function getIndustryConfig(industryCode: string) {
  const key = industryCode.trim().toLowerCase();
  return INDUSTRY_TEAM_CONFIGS[key] ?? null;
}

export function listIndustryConfigs() {
  return Object.values(INDUSTRY_TEAM_CONFIGS);
}

export function createRoleSetsRouter() {
  const router = express.Router();

  router.get("/", asyncRoute(async (_req, res) => {
    const list = Object.values(INDUSTRY_TEAM_CONFIGS).map((config) => ({
      id: config.roleSet.id,
      industryCode: config.roleSet.industryCode,
      industryName: config.roleSet.industryName,
      roleIds: config.roleSet.roleIds,
      defaultSoulRoleId: config.roleSet.defaultSoulRoleId,
      status: config.roleSet.status,
      version: config.roleSet.version,
      updatedAt: config.roleSet.updatedAt
    }));
    sendSuccess(res, list);
  }));

  router.get("/:industryCode", asyncRoute(async (req, res) => {
    const industryCode = String(req.params.industryCode ?? "").trim().toLowerCase();
    const config = getIndustryConfig(industryCode);

    if (!config) {
      sendError(res, 404, "NOT_FOUND", `Industry role set not found: ${industryCode}`);
      return;
    }

    sendSuccess(res, config);
  }));

  return router;
}
