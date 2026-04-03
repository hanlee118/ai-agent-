import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const BUILTIN_INDUSTRY_TEAM_CONFIGS: Record<string, IndustryTeamConfig> = {
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
            output: "需求确认单草案、验收标准"
          },
          {
            order: 3,
            roleId: "ROLE_DESIGN",
            title: "视觉与交互方案审查",
            input: "需求确认单草案",
            output: "视觉方向、组件规范、可访问性检查项"
          },
          {
            order: 4,
            roleId: "ROLE_DEV",
            title: "任务拆解与开发执行",
            input: "已确认需求确认单 + 设计审查卡",
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

interface RoleSetStoreSchema {
  version: number;
  updatedAt: string;
  configs: Record<string, IndustryTeamConfig>;
}

interface RoleSetMutationBody {
  industryCode?: unknown;
  industryName?: unknown;
  roleIds?: unknown;
  defaultSoulRoleId?: unknown;
  status?: unknown;
  workflows?: unknown;
  assemblyRule?: unknown;
}

const ROLE_SET_STORE_VERSION = 1;
const ROLE_ID_SET = new Set<RoleId>([
  "ROLE_ASSISTANT",
  "ROLE_PM",
  "ROLE_ANALYST",
  "ROLE_PRODUCT",
  "ROLE_DESIGN",
  "ROLE_ARCH",
  "ROLE_DEV",
  "ROLE_QA",
  "ROLE_HR"
]);
const ROLE_SET_STATUS_SET = new Set<RoleSetStatus>(["active", "inactive"]);
const FALLBACK_STRATEGY_SET = new Set<FallbackStrategy>(["template_first", "role_pool_auto"]);
const BUILTIN_INDUSTRY_CODES = new Set(Object.keys(BUILTIN_INDUSTRY_TEAM_CONFIGS));

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function findWorkspaceRoot(startDir: string) {
  let current = startDir;
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return path.resolve(startDir, "../../../../");
}

const workspaceRoot = process.env.OCC_WORKSPACE_ROOT?.trim() || findWorkspaceRoot(moduleDir);
const ROLE_SET_STORE_PATH = process.env.OCC_ROLE_SET_STORE_PATH?.trim()
  || path.join(workspaceRoot, ".runtime", "industry-role-sets.json");

let roleSetStore: Record<string, IndustryTeamConfig> | null = null;

function deepClone<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}

function normalizeIndustryCode(input: unknown) {
  return String(input ?? "").trim().toLowerCase();
}

function normalizeString(input: unknown) {
  return String(input ?? "").trim();
}

function normalizeRoleId(input: unknown) {
  const value = String(input ?? "").trim().toUpperCase();
  if (ROLE_ID_SET.has(value as RoleId)) {
    return value as RoleId;
  }
  return null;
}

function parseRoleIds(input: unknown) {
  if (!Array.isArray(input)) {
    return null;
  }
  const deduped = new Set<RoleId>();
  for (const item of input) {
    const roleId = normalizeRoleId(item);
    if (!roleId) {
      return null;
    }
    deduped.add(roleId);
  }
  if (deduped.size === 0) {
    return null;
  }
  return Array.from(deduped);
}

function ensureRoleSetStoreLoaded() {
  if (roleSetStore) {
    return roleSetStore;
  }

  const base = deepClone(BUILTIN_INDUSTRY_TEAM_CONFIGS);
  const loaded = readRoleSetStoreFile();
  if (loaded) {
    for (const [rawCode, config] of Object.entries(loaded.configs || {})) {
      const key = normalizeIndustryCode(rawCode || config?.roleSet?.industryCode);
      if (!key || !config || typeof config !== "object") {
        continue;
      }
      base[key] = config;
    }
  }

  roleSetStore = base;
  return roleSetStore;
}

function readRoleSetStoreFile(): RoleSetStoreSchema | null {
  try {
    if (!existsSync(ROLE_SET_STORE_PATH)) {
      return null;
    }
    const raw = readFileSync(ROLE_SET_STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<RoleSetStoreSchema>;
    if (!parsed || typeof parsed !== "object" || !parsed.configs || typeof parsed.configs !== "object") {
      return null;
    }
    return {
      version: Number(parsed.version || ROLE_SET_STORE_VERSION),
      updatedAt: String(parsed.updatedAt || nowIso()),
      configs: parsed.configs as Record<string, IndustryTeamConfig>
    };
  } catch (error) {
    console.warn("[role-sets] Failed to load role set store:", error);
    return null;
  }
}

function saveRoleSetStore() {
  const store = ensureRoleSetStoreLoaded();
  const payload: RoleSetStoreSchema = {
    version: ROLE_SET_STORE_VERSION,
    updatedAt: nowIso(),
    configs: deepClone(store)
  };
  mkdirSync(path.dirname(ROLE_SET_STORE_PATH), { recursive: true });
  writeFileSync(ROLE_SET_STORE_PATH, JSON.stringify(payload, null, 2), "utf8");
}

function summarizeRoleSet(config: IndustryTeamConfig) {
  return {
    id: config.roleSet.id,
    industryCode: config.roleSet.industryCode,
    industryName: config.roleSet.industryName,
    roleIds: config.roleSet.roleIds,
    defaultSoulRoleId: config.roleSet.defaultSoulRoleId,
    status: config.roleSet.status,
    version: config.roleSet.version,
    updatedAt: config.roleSet.updatedAt
  };
}

function nextVersion(version: string) {
  const matched = /^v(\d+)$/i.exec(version.trim());
  if (!matched) {
    return "v2";
  }
  return `v${Number(matched[1]) + 1}`;
}

function buildDefaultWorkflows(roleSet: IndustryRoleSet): TeamSopWorkflow[] {
  const requiredRoleIds = roleSet.roleIds.slice(0, Math.min(5, roleSet.roleIds.length));
  const rolesForSteps = requiredRoleIds.length > 0 ? requiredRoleIds : [roleSet.defaultSoulRoleId];
  const now = nowIso();
  const stepTitles: Record<RoleId, string> = {
    ROLE_ASSISTANT: "项目协同与节奏推进",
    ROLE_PM: "项目拆解与排期",
    ROLE_ANALYST: "需求理解与边界识别",
    ROLE_PRODUCT: "产品方案与验收标准",
    ROLE_DESIGN: "视觉与交互设计",
    ROLE_ARCH: "系统架构与技术方案",
    ROLE_DEV: "研发实现与联调",
    ROLE_QA: "质量验证与回归测试",
    ROLE_HR: "组织协同与资源保障"
  };
  return [
    {
      id: `sop-${roleSet.industryCode}-${randomUUID().slice(0, 8)}`,
      industryRoleSetId: roleSet.id,
      name: `${roleSet.industryName} 标准协作流程`,
      requiredRoleIds: rolesForSteps,
      isDefault: true,
      version: roleSet.version,
      updatedAt: now,
      steps: rolesForSteps.map((roleId, index) => ({
        order: index + 1,
        roleId,
        title: stepTitles[roleId],
        input: "上游产出 + 当前阶段上下文",
        output: "结构化结论与可执行交付物"
      }))
    }
  ];
}

function buildDefaultAssemblyRule(roleSet: IndustryRoleSet): TeamAssemblyRule {
  const minRoles = Math.min(roleSet.roleIds.length, 4) || 1;
  const maxRoles = roleSet.roleIds.length > 0 ? roleSet.roleIds.length : null;
  return {
    id: `assembly-${roleSet.industryCode}-${randomUUID().slice(0, 8)}`,
    industryCode: roleSet.industryCode,
    mustHaveSoulRole: true,
    soulRoleId: roleSet.defaultSoulRoleId,
    minRoles,
    maxRoles,
    fallbackStrategy: "template_first",
    updatedAt: nowIso()
  };
}

function resolveWorkflows(
  input: unknown,
  roleSet: IndustryRoleSet
): { workflows: TeamSopWorkflow[]; error?: string } {
  if (input === undefined || input === null) {
    return { workflows: buildDefaultWorkflows(roleSet) };
  }
  if (!Array.isArray(input) || input.length === 0) {
    return { workflows: [], error: "workflows must be a non-empty array when provided" };
  }

  const parsed: TeamSopWorkflow[] = [];
  const now = nowIso();
  for (const [index, rawWorkflow] of input.entries()) {
    if (!rawWorkflow || typeof rawWorkflow !== "object") {
      return { workflows: [], error: `workflows[${index}] is invalid` };
    }
    const workflow = rawWorkflow as Record<string, unknown>;
    const rawSteps = workflow.steps;
    if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
      return { workflows: [], error: `workflows[${index}].steps must be a non-empty array` };
    }
    const steps: SopStep[] = [];
    for (const [stepIndex, rawStep] of rawSteps.entries()) {
      if (!rawStep || typeof rawStep !== "object") {
        return { workflows: [], error: `workflows[${index}].steps[${stepIndex}] is invalid` };
      }
      const step = rawStep as Record<string, unknown>;
      const roleId = normalizeRoleId(step.roleId);
      if (!roleId || !roleSet.roleIds.includes(roleId)) {
        return { workflows: [], error: `workflows[${index}].steps[${stepIndex}].roleId is invalid` };
      }
      const title = normalizeString(step.title) || `流程步骤 ${stepIndex + 1}`;
      const inputText = normalizeString(step.input) || "上游输入";
      const outputText = normalizeString(step.output) || "本步骤输出";
      steps.push({
        order: stepIndex + 1,
        roleId,
        title,
        input: inputText,
        output: outputText
      });
    }

    const requiredRoleIds = parseRoleIds(workflow.requiredRoleIds)
      ?? Array.from(new Set(steps.map((step) => step.roleId)));
    if (!requiredRoleIds.every((roleId) => roleSet.roleIds.includes(roleId))) {
      return { workflows: [], error: `workflows[${index}].requiredRoleIds contains roles out of roleIds` };
    }

    parsed.push({
      id: normalizeString(workflow.id) || `sop-${roleSet.industryCode}-${index + 1}-${randomUUID().slice(0, 6)}`,
      industryRoleSetId: roleSet.id,
      name: normalizeString(workflow.name) || `${roleSet.industryName} 协作流程 ${index + 1}`,
      steps,
      requiredRoleIds,
      isDefault: Boolean(workflow.isDefault ?? index === 0),
      version: normalizeString(workflow.version) || roleSet.version,
      updatedAt: now
    });
  }

  if (!parsed.some((item) => item.isDefault)) {
    parsed[0].isDefault = true;
  }
  return { workflows: parsed };
}

function resolveAssemblyRule(
  input: unknown,
  roleSet: IndustryRoleSet,
  existing?: TeamAssemblyRule
): { assemblyRule: TeamAssemblyRule; error?: string } {
  const base = existing ? deepClone(existing) : buildDefaultAssemblyRule(roleSet);
  const now = nowIso();

  if (input === undefined || input === null) {
    return {
      assemblyRule: {
        ...base,
        industryCode: roleSet.industryCode,
        soulRoleId: roleSet.defaultSoulRoleId,
        updatedAt: now
      }
    };
  }
  if (!input || typeof input !== "object") {
    return { assemblyRule: base, error: "assemblyRule must be an object when provided" };
  }

  const raw = input as Record<string, unknown>;
  const soulRoleId = raw.soulRoleId !== undefined
    ? normalizeRoleId(raw.soulRoleId)
    : roleSet.defaultSoulRoleId;
  if (!soulRoleId || !roleSet.roleIds.includes(soulRoleId)) {
    return { assemblyRule: base, error: "assemblyRule.soulRoleId must exist in roleIds" };
  }

  const mustHaveSoulRole = raw.mustHaveSoulRole === undefined
    ? base.mustHaveSoulRole
    : Boolean(raw.mustHaveSoulRole);

  const minRolesRaw = raw.minRoles === undefined ? base.minRoles : Number(raw.minRoles);
  const maxRolesRaw = raw.maxRoles === undefined || raw.maxRoles === null ? base.maxRoles : Number(raw.maxRoles);

  if (!Number.isFinite(minRolesRaw) || minRolesRaw <= 0) {
    return { assemblyRule: base, error: "assemblyRule.minRoles must be a positive number" };
  }
  const minRoles = Math.floor(minRolesRaw);

  let maxRoles: number | null = null;
  if (maxRolesRaw !== null) {
    if (!Number.isFinite(maxRolesRaw) || maxRolesRaw <= 0) {
      return { assemblyRule: base, error: "assemblyRule.maxRoles must be a positive number or null" };
    }
    maxRoles = Math.floor(maxRolesRaw);
    if (maxRoles < minRoles) {
      return { assemblyRule: base, error: "assemblyRule.maxRoles must be greater than or equal to minRoles" };
    }
  }

  const fallbackStrategy = raw.fallbackStrategy === undefined
    ? base.fallbackStrategy
    : String(raw.fallbackStrategy).trim().toLowerCase();
  if (!FALLBACK_STRATEGY_SET.has(fallbackStrategy as FallbackStrategy)) {
    return { assemblyRule: base, error: "assemblyRule.fallbackStrategy is invalid" };
  }

  return {
    assemblyRule: {
      id: normalizeString(raw.id) || base.id,
      industryCode: roleSet.industryCode,
      mustHaveSoulRole,
      soulRoleId,
      minRoles,
      maxRoles,
      fallbackStrategy: fallbackStrategy as FallbackStrategy,
      updatedAt: now
    }
  };
}

function parseRoleSetStatus(input: unknown): RoleSetStatus | null {
  const normalized = String(input ?? "").trim().toLowerCase();
  if (ROLE_SET_STATUS_SET.has(normalized as RoleSetStatus)) {
    return normalized as RoleSetStatus;
  }
  return null;
}

export function getIndustryConfig(industryCode: string) {
  const key = normalizeIndustryCode(industryCode);
  const store = ensureRoleSetStoreLoaded();
  const config = store[key];
  return config ? deepClone(config) : null;
}

export function listIndustryConfigs() {
  const store = ensureRoleSetStoreLoaded();
  return Object.values(store)
    .map((config) => deepClone(config))
    .sort((left, right) => left.roleSet.industryCode.localeCompare(right.roleSet.industryCode));
}

export function createRoleSetsRouter() {
  const router = express.Router();

  router.get("/", asyncRoute(async (_req, res) => {
    const list = listIndustryConfigs().map(summarizeRoleSet);
    sendSuccess(res, list);
  }));

  router.get("/:industryCode", asyncRoute(async (req, res) => {
    const industryCode = normalizeIndustryCode(req.params.industryCode);
    const config = getIndustryConfig(industryCode);

    if (!config) {
      sendError(res, 404, "NOT_FOUND", `Industry role set not found: ${industryCode}`);
      return;
    }

    sendSuccess(res, config);
  }));

  router.post("/", asyncRoute(async (req, res) => {
    const payload = (req.body ?? {}) as RoleSetMutationBody;
    const industryCode = normalizeIndustryCode(payload.industryCode);
    const industryName = normalizeString(payload.industryName);
    const roleIds = parseRoleIds(payload.roleIds);
    const defaultSoulRoleId = normalizeRoleId(payload.defaultSoulRoleId);
    const status = parseRoleSetStatus(payload.status);

    if (!industryCode || !/^[a-z0-9][a-z0-9_-]{1,31}$/.test(industryCode)) {
      sendError(res, 400, "VALIDATION_ERROR", "industryCode is required and must match ^[a-z0-9][a-z0-9_-]{1,31}$");
      return;
    }
    if (!industryName) {
      sendError(res, 400, "VALIDATION_ERROR", "industryName is required");
      return;
    }
    if (!roleIds) {
      sendError(res, 400, "VALIDATION_ERROR", "roleIds is required and must be a non-empty RoleId array");
      return;
    }
    if (!defaultSoulRoleId || !roleIds.includes(defaultSoulRoleId)) {
      sendError(res, 400, "VALIDATION_ERROR", "defaultSoulRoleId is required and must exist in roleIds");
      return;
    }
    if (!status) {
      sendError(res, 400, "VALIDATION_ERROR", "status must be active or inactive");
      return;
    }

    const store = ensureRoleSetStoreLoaded();
    if (store[industryCode]) {
      sendError(res, 400, "VALIDATION_ERROR", `Industry role set already exists: ${industryCode}`);
      return;
    }

    const now = nowIso();
    const roleSet: IndustryRoleSet = {
      id: `role-set-${industryCode}-${randomUUID().slice(0, 8)}`,
      industryCode,
      industryName,
      roleIds,
      defaultSoulRoleId,
      status,
      version: "v1",
      updatedAt: now
    };

    const workflowsResult = resolveWorkflows(payload.workflows, roleSet);
    if (workflowsResult.error) {
      sendError(res, 400, "VALIDATION_ERROR", workflowsResult.error);
      return;
    }
    const assemblyResult = resolveAssemblyRule(payload.assemblyRule, roleSet);
    if (assemblyResult.error) {
      sendError(res, 400, "VALIDATION_ERROR", assemblyResult.error);
      return;
    }

    const config: IndustryTeamConfig = {
      roleSet,
      workflows: workflowsResult.workflows,
      assemblyRule: assemblyResult.assemblyRule
    };
    store[industryCode] = config;
    saveRoleSetStore();

    sendSuccess(res, config, 201);
  }));

  router.patch("/:industryCode", asyncRoute(async (req, res) => {
    const industryCode = normalizeIndustryCode(req.params.industryCode);
    if (!industryCode) {
      sendError(res, 400, "VALIDATION_ERROR", "industryCode is required");
      return;
    }

    const store = ensureRoleSetStoreLoaded();
    const existing = store[industryCode];
    if (!existing) {
      sendError(res, 404, "NOT_FOUND", `Industry role set not found: ${industryCode}`);
      return;
    }

    const payload = (req.body ?? {}) as RoleSetMutationBody;
    if (payload.industryCode !== undefined) {
      const bodyIndustryCode = normalizeIndustryCode(payload.industryCode);
      if (!bodyIndustryCode || bodyIndustryCode !== industryCode) {
        sendError(res, 400, "VALIDATION_ERROR", "industryCode in body must match path parameter");
        return;
      }
    }

    const nextIndustryName = payload.industryName === undefined
      ? existing.roleSet.industryName
      : normalizeString(payload.industryName);
    if (!nextIndustryName) {
      sendError(res, 400, "VALIDATION_ERROR", "industryName cannot be empty");
      return;
    }

    const nextRoleIds = payload.roleIds === undefined
      ? existing.roleSet.roleIds
      : parseRoleIds(payload.roleIds);
    if (!nextRoleIds) {
      sendError(res, 400, "VALIDATION_ERROR", "roleIds must be a non-empty RoleId array");
      return;
    }

    const requestedSoulRoleId = payload.defaultSoulRoleId === undefined
      ? existing.roleSet.defaultSoulRoleId
      : normalizeRoleId(payload.defaultSoulRoleId);
    const nextSoulRoleId = requestedSoulRoleId && nextRoleIds.includes(requestedSoulRoleId)
      ? requestedSoulRoleId
      : nextRoleIds[0];

    if (!nextSoulRoleId) {
      sendError(res, 400, "VALIDATION_ERROR", "defaultSoulRoleId must exist in roleIds");
      return;
    }

    const nextStatus = payload.status === undefined
      ? existing.roleSet.status
      : parseRoleSetStatus(payload.status);
    if (!nextStatus) {
      sendError(res, 400, "VALIDATION_ERROR", "status must be active or inactive");
      return;
    }

    const now = nowIso();
    const roleIdsChanged = JSON.stringify(nextRoleIds) !== JSON.stringify(existing.roleSet.roleIds);
    const roleSet: IndustryRoleSet = {
      ...existing.roleSet,
      industryCode,
      industryName: nextIndustryName,
      roleIds: nextRoleIds,
      defaultSoulRoleId: nextSoulRoleId,
      status: nextStatus,
      version: nextVersion(existing.roleSet.version),
      updatedAt: now
    };

    const workflowsResult = resolveWorkflows(
      payload.workflows === undefined ? (roleIdsChanged ? null : existing.workflows) : payload.workflows,
      roleSet
    );
    if (workflowsResult.error) {
      sendError(res, 400, "VALIDATION_ERROR", workflowsResult.error);
      return;
    }

    const assemblyResult = resolveAssemblyRule(payload.assemblyRule, roleSet, existing.assemblyRule);
    if (assemblyResult.error) {
      sendError(res, 400, "VALIDATION_ERROR", assemblyResult.error);
      return;
    }

    const updated: IndustryTeamConfig = {
      roleSet,
      workflows: workflowsResult.workflows,
      assemblyRule: assemblyResult.assemblyRule
    };

    store[industryCode] = updated;
    saveRoleSetStore();
    sendSuccess(res, updated);
  }));

  router.delete("/:industryCode", asyncRoute(async (req, res) => {
    const industryCode = normalizeIndustryCode(req.params.industryCode);
    if (!industryCode) {
      sendError(res, 400, "VALIDATION_ERROR", "industryCode is required");
      return;
    }

    const store = ensureRoleSetStoreLoaded();
    if (!store[industryCode]) {
      sendError(res, 404, "NOT_FOUND", `Industry role set not found: ${industryCode}`);
      return;
    }
    if (BUILTIN_INDUSTRY_CODES.has(industryCode)) {
      sendError(res, 400, "VALIDATION_ERROR", "Built-in industry role sets cannot be deleted");
      return;
    }

    delete store[industryCode];
    saveRoleSetStore();
    sendSuccess(res, { deleted: true, industryCode });
  }));

  return router;
}
