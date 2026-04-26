import { Prisma } from "@prisma/client";
import { AGENT_ROLE_TEMPLATES, type AgentRoleTemplate, type RoleType } from "@occ/shared";
import { MutationPassthroughSchema } from "../validation/schemas.js";
import { validateBody } from "../validation/middleware.js";
import express from "express";
import { prisma } from "../db.js";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  asyncRoute,
  normalizeStringArray,
  parseStoredSteps,
  sendError,
  sendSuccess
} from "./utils.js";

const DEFAULT_AGENT_TOKEN_LIMIT = 100_000_000;
const HERMES_AGENT_DEFAULT_ID = String(process.env.HERMES_AGENT_ID ?? "hermes-agent-1").trim() || "hermes-agent-1";
const HERMES_DESIGN_ROLE_ID = "ROLE_DESIGN";
const ROLE_SET = new Set<RoleType>([
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
const TEMPLATE_STORE_VERSION = 1;

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
const TEMPLATE_STORE_PATH = process.env.OCC_AGENT_TEMPLATE_STORE_PATH?.trim()
  || path.join(workspaceRoot, ".runtime", "agent-role-templates.json");

type TemplateStoreSchema = {
  version: number;
  updatedAt: string;
  templates: AgentRoleTemplate[];
};

type TemplateMutationBody = Partial<AgentRoleTemplate> & {
  id?: unknown;
  roleId?: unknown;
  name?: unknown;
  desc?: unknown;
  suggestedAgentName?: unknown;
  soul?: unknown;
  sop?: unknown;
  modelId?: unknown;
};
type TemplateNormalizeResult =
  | { ok: true; template: AgentRoleTemplate }
  | { ok: false; error: string };

let templateStoreCache: AgentRoleTemplate[] | null = null;

interface CreateAgentBody {
  name?: unknown;
  role?: unknown;
  modelId?: unknown;
  soul?: unknown;
  sop?: unknown;
}

interface UpdateSoulBody {
  content?: unknown;
}

interface UpdateSopBody {
  steps?: unknown;
}

interface SwitchModelBody {
  modelId?: unknown;
}

function toStringArrayFromJson(input: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(input)) {
    return [] as string[];
  }

  return input
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function deepClone<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeRoleId(input: unknown): RoleType | null {
  const value = String(input ?? "").trim().toUpperCase();
  return ROLE_SET.has(value as RoleType) ? (value as RoleType) : null;
}

function normalizeTemplateInput(input: TemplateMutationBody, fallbackId = ""): TemplateNormalizeResult {
  const roleId = normalizeRoleId(input.roleId);
  if (!roleId) {
    return { ok: false, error: "roleId is required and must be a valid RoleType" };
  }

  const name = String(input.name ?? "").trim();
  const desc = String(input.desc ?? "").trim();
  const suggestedAgentName = String(input.suggestedAgentName ?? "").trim();
  const soul = String(input.soul ?? "").trim();
  const modelId = String(input.modelId ?? "").trim();
  const sop = Array.isArray(input.sop) ? input.sop.map((item) => String(item ?? "").trim()).filter(Boolean) : null;

  if (!name) {
    return { ok: false, error: "name is required" };
  }
  if (!desc) {
    return { ok: false, error: "desc is required" };
  }
  if (!suggestedAgentName) {
    return { ok: false, error: "suggestedAgentName is required" };
  }
  if (!soul) {
    return { ok: false, error: "soul is required" };
  }
  if (!sop || sop.length === 0) {
    return { ok: false, error: "sop is required and must be a non-empty string array" };
  }

  const id = String(input.id ?? fallbackId ?? "").trim() || `role:custom:${randomUUID().slice(0, 8)}`;
  const template: AgentRoleTemplate = {
    id,
    roleId,
    name,
    desc,
    suggestedAgentName,
    soul,
    sop
  };
  if (modelId) {
    template.modelId = modelId;
  }
  return { ok: true, template };
}

function readTemplateStoreFile(): TemplateStoreSchema | null {
  try {
    if (!existsSync(TEMPLATE_STORE_PATH)) {
      return null;
    }
    const raw = readFileSync(TEMPLATE_STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<TemplateStoreSchema>;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.templates)) {
      return null;
    }
    const templates = parsed.templates
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        const cast = item as TemplateMutationBody;
        const normalized = normalizeTemplateInput(cast, String(cast.id ?? ""));
        return normalized.ok ? normalized.template : null;
      })
      .filter((item): item is AgentRoleTemplate => Boolean(item));
    return {
      version: Number(parsed.version ?? TEMPLATE_STORE_VERSION),
      updatedAt: String(parsed.updatedAt || nowIso()),
      templates
    };
  } catch (error) {
    console.warn("[agents.templates] Failed to load template store:", error);
    return null;
  }
}

function ensureTemplateStoreLoaded() {
  if (templateStoreCache) {
    return templateStoreCache;
  }
  const loaded = readTemplateStoreFile();
  templateStoreCache = loaded?.templates?.length ? loaded.templates : deepClone(AGENT_ROLE_TEMPLATES);
  return templateStoreCache;
}

function saveTemplateStore() {
  const templates = ensureTemplateStoreLoaded();
  const payload: TemplateStoreSchema = {
    version: TEMPLATE_STORE_VERSION,
    updatedAt: nowIso(),
    templates: deepClone(templates)
  };
  mkdirSync(path.dirname(TEMPLATE_STORE_PATH), { recursive: true });
  writeFileSync(TEMPLATE_STORE_PATH, JSON.stringify(payload, null, 2), "utf8");
}

function listTemplateStore() {
  return deepClone(ensureTemplateStoreLoaded());
}

function normalizeAgentStatus(status: string | null | undefined) {
  const value = String(status ?? "").trim().toLowerCase();
  if (value === "working") {
    return "Executing";
  }

  if (value === "idle") {
    return "Idle";
  }

  if (!value) {
    return "Idle";
  }

  return status ?? "Idle";
}

function inferIntegrationEngine(parts: Array<string | null | undefined>) {
  const joined = parts
    .map((item) => String(item ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
  if (joined.includes("hermes")) {
    return "hermes" as const;
  }
  if (joined.includes("openclaw") || joined.includes("codex")) {
    return "openclaw" as const;
  }
  return "managed" as const;
}

function isHermesIntegrationEnabled() {
  const enabled = String(process.env.HERMES_ENABLED ?? "").trim().toLowerCase();
  if (enabled) {
    return enabled !== "false" && enabled !== "0" && enabled !== "off";
  }
  return Boolean(String(process.env.HERMES_MCP_ENDPOINT ?? process.env.HERMES_MCP ?? "").trim());
}

function isDesignRoleLabel(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === HERMES_DESIGN_ROLE_ID) {
    return true;
  }
  const text = String(value ?? "").trim().toLowerCase();
  return /视觉|设计|design|ui|ux/.test(text);
}

function normalizeHermesDefaultRole(agentId: string, role: string, integrationEngine: string) {
  if (agentId === HERMES_AGENT_DEFAULT_ID && integrationEngine === "hermes") {
    return HERMES_DESIGN_ROLE_ID;
  }
  return role;
}

function buildBuiltinHermesAgentRow() {
  const nowIso = new Date().toISOString();
  return {
    id: HERMES_AGENT_DEFAULT_ID,
    name: "Hermes 视觉设计总监",
    role: HERMES_DESIGN_ROLE_ID,
    status: "Idle" as const,
    load: 0,
    currentModelId: "hermes-v2.1",
    fallbackModel: undefined,
    tasks: 0,
    memoryCount: 0,
    tokensUsed: 0,
    tokenLimit: DEFAULT_AGENT_TOKEN_LIMIT,
    sessionCount: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    integrationEngine: "hermes" as const,
    allowedAgentIds: [] as string[],
    builtin: true
  };
}

function resolveTokenLimit(
  maxDailyTokens: number | null,
  currentModelId: string,
  modelLimitById: Map<string, number>,
  modelLimitByName: Map<string, number>
) {
  if (typeof maxDailyTokens === "number" && maxDailyTokens > 0) {
    return maxDailyTokens;
  }

  if (currentModelId && modelLimitById.has(currentModelId)) {
    return modelLimitById.get(currentModelId) ?? DEFAULT_AGENT_TOKEN_LIMIT;
  }

  if (currentModelId && modelLimitByName.has(currentModelId)) {
    return modelLimitByName.get(currentModelId) ?? DEFAULT_AGENT_TOKEN_LIMIT;
  }

  return DEFAULT_AGENT_TOKEN_LIMIT;
}

async function agentExists(agentId: string) {
  const [profile, config] = await prisma.$transaction([
    prisma.agentProfile.findUnique({ where: { roleId: agentId }, select: { roleId: true } }),
    prisma.managedAgentConfig.findUnique({ where: { agentId }, select: { agentId: true } })
  ]);

  return Boolean(profile || config);
}

async function getAgentDetail(agentId: string) {
  const [profile, config, soul, sop, taskCount, memoryCount, usageLogs, models] = await prisma.$transaction([
    prisma.agentProfile.findUnique({ where: { roleId: agentId } }),
    prisma.managedAgentConfig.findUnique({ where: { agentId } }),
    prisma.agentSoul.findUnique({ where: { agentId } }),
    prisma.agentSop.findUnique({ where: { agentId } }),
    prisma.task.count({ where: { assignee: agentId, status: { not: "done" } } }),
    prisma.agentMemoryEntry.count({ where: { agentId } }),
    prisma.agentUsageLog.findMany({
      where: { agentId },
      select: { totalTokens: true }
    }),
    prisma.model.findMany({
      select: {
        id: true,
        name: true,
        tokenLimit: true
      }
    })
  ]);

  if (!profile && !config) {
    return null;
  }

  const modelLimitById = new Map(models.map((item) => [item.id, item.tokenLimit]));
  const modelLimitByName = new Map(models.map((item) => [item.name, item.tokenLimit]));

  const currentModelId = config?.selectedModel ?? "";
  const tokenLimit = resolveTokenLimit(
    config?.maxDailyTokens ?? null,
    currentModelId,
    modelLimitById,
    modelLimitByName
  );
  const tokensUsed = usageLogs.reduce((sum, item) => sum + item.totalTokens, 0);

  const integrationEngine = inferIntegrationEngine([
    agentId,
    profile?.roleId,
    profile?.name,
    config?.title,
    config?.displayName
  ]);
  const rawRole = profile?.roleId || config?.title || agentId;

  return {
    id: agentId,
    name: config?.displayName?.trim() || profile?.name || agentId,
    role: normalizeHermesDefaultRole(agentId, rawRole, integrationEngine),
    status: normalizeAgentStatus(profile?.status),
    load: profile?.workload ?? 0,
    currentModelId,
    fallbackModel: config?.fallbackModel ?? undefined,
    tasks: taskCount,
    memoryCount,
    tokensUsed,
    tokenLimit,
    sessionCount: usageLogs.length,
    soul: soul?.content ?? "",
    sop: parseStoredSteps(sop?.steps ?? null),
    createdAt: (config?.createdAt ?? profile?.createdAt ?? new Date()).toISOString(),
    updatedAt: (config?.updatedAt ?? profile?.updatedAt ?? new Date()).toISOString(),
    allowedAgentIds: toStringArrayFromJson(config?.allowedAgentIds),
    integrationEngine
  };
}

export function createAgentsRouter() {
  const router = express.Router();

  router.get("/", asyncRoute(async (_req, res) => {
    const [profiles, configs, tasks, memoryEntries, usageLogs, models] = await prisma.$transaction([
      prisma.agentProfile.findMany(),
      prisma.managedAgentConfig.findMany(),
      prisma.task.findMany({
        where: { status: { not: "done" } },
        select: { assignee: true }
      }),
      prisma.agentMemoryEntry.findMany({
        select: { agentId: true }
      }),
      prisma.agentUsageLog.findMany({
        select: {
          agentId: true,
          totalTokens: true
        }
      }),
      prisma.model.findMany({
        select: {
          id: true,
          name: true,
          tokenLimit: true
        }
      })
    ]);

    const profileMap = new Map(profiles.map((profile) => [profile.roleId, profile]));
    const configMap = new Map(configs.map((config) => [config.agentId, config]));
    const taskCountMap = new Map<string, number>();
    const memoryCountMap = new Map<string, number>();
    const usageMap = new Map<string, { tokensUsed: number; sessionCount: number }>();

    for (const task of tasks) {
      taskCountMap.set(task.assignee, (taskCountMap.get(task.assignee) ?? 0) + 1);
    }

    for (const entry of memoryEntries) {
      memoryCountMap.set(entry.agentId, (memoryCountMap.get(entry.agentId) ?? 0) + 1);
    }

    for (const log of usageLogs) {
      const current = usageMap.get(log.agentId) ?? {
        tokensUsed: 0,
        sessionCount: 0
      };
      usageMap.set(log.agentId, {
        tokensUsed: current.tokensUsed + log.totalTokens,
        sessionCount: current.sessionCount + 1
      });
    }
    const modelLimitById = new Map(models.map((item) => [item.id, item.tokenLimit]));
    const modelLimitByName = new Map(models.map((item) => [item.name, item.tokenLimit]));

    const agentIds = new Set<string>([
      ...profileMap.keys(),
      ...configMap.keys()
    ]);

    const list = Array.from(agentIds)
      .map((agentId) => {
        const profile = profileMap.get(agentId);
        const config = configMap.get(agentId);
        const usage = usageMap.get(agentId);
        const currentModelId = config?.selectedModel ?? "";

        const integrationEngine = inferIntegrationEngine([
          agentId,
          profile?.roleId,
          profile?.name,
          config?.title,
          config?.displayName
        ]);
        const rawRole = profile?.roleId || config?.title || agentId;

        return {
          id: agentId,
          name: config?.displayName?.trim() || profile?.name || agentId,
          role: normalizeHermesDefaultRole(agentId, rawRole, integrationEngine),
          status: normalizeAgentStatus(profile?.status),
          load: profile?.workload ?? 0,
          currentModelId,
          fallbackModel: config?.fallbackModel ?? undefined,
          tasks: taskCountMap.get(agentId) ?? 0,
          memoryCount: memoryCountMap.get(agentId) ?? 0,
          tokensUsed: usage?.tokensUsed ?? 0,
          tokenLimit: resolveTokenLimit(
            config?.maxDailyTokens ?? null,
            currentModelId,
            modelLimitById,
            modelLimitByName
          ),
          sessionCount: usage?.sessionCount ?? 0,
          integrationEngine
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    if (isHermesIntegrationEnabled()) {
      const hasHermesDesign = list.some((item) => item.integrationEngine === "hermes" && (
        isDesignRoleLabel(item.role) || isDesignRoleLabel(item.name)
      ));
      if (!hasHermesDesign) {
        const defaultIndex = list.findIndex((item) => item.id === HERMES_AGENT_DEFAULT_ID);
        if (defaultIndex >= 0) {
          list[defaultIndex] = {
            ...list[defaultIndex],
            ...buildBuiltinHermesAgentRow()
          };
        } else {
          list.unshift(buildBuiltinHermesAgentRow());
        }
      }
    }

    sendSuccess(res, list);
  }));

  router.get("/templates", asyncRoute(async (_req, res) => {
    sendSuccess(res, listTemplateStore());
  }));

  router.post("/templates", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    const payload = (req.body ?? {}) as TemplateMutationBody;
    const parsed = normalizeTemplateInput(payload);
    if (!parsed.ok) {
      sendError(res, 400, "VALIDATION_ERROR", parsed.error);
      return;
    }
    const store = ensureTemplateStoreLoaded();
    if (store.some((item) => item.id === parsed.template.id)) {
      sendError(res, 400, "VALIDATION_ERROR", `Template already exists: ${parsed.template.id}`);
      return;
    }
    store.push(parsed.template);
    saveTemplateStore();
    sendSuccess(res, parsed.template, 201);
  }));

  router.put("/templates/:templateId", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    const templateId = String(req.params.templateId ?? "").trim();
    if (!templateId) {
      sendError(res, 400, "VALIDATION_ERROR", "templateId is required");
      return;
    }
    const payload = (req.body ?? {}) as TemplateMutationBody;
    const parsed = normalizeTemplateInput(payload, templateId);
    if (!parsed.ok) {
      sendError(res, 400, "VALIDATION_ERROR", parsed.error);
      return;
    }
    if (parsed.template.id !== templateId) {
      sendError(res, 400, "VALIDATION_ERROR", "templateId in body must match path parameter");
      return;
    }
    const store = ensureTemplateStoreLoaded();
    const index = store.findIndex((item) => item.id === templateId);
    if (index < 0) {
      sendError(res, 404, "NOT_FOUND", `Template not found: ${templateId}`);
      return;
    }
    store[index] = parsed.template;
    saveTemplateStore();
    sendSuccess(res, parsed.template);
  }));

  router.delete("/templates/:templateId", asyncRoute(async (req, res) => {
    const templateId = String(req.params.templateId ?? "").trim();
    if (!templateId) {
      sendError(res, 400, "VALIDATION_ERROR", "templateId is required");
      return;
    }
    const store = ensureTemplateStoreLoaded();
    const next = store.filter((item) => item.id !== templateId);
    if (next.length === store.length) {
      sendError(res, 404, "NOT_FOUND", `Template not found: ${templateId}`);
      return;
    }
    if (next.length === 0) {
      sendError(res, 400, "VALIDATION_ERROR", "At least one template must remain");
      return;
    }
    templateStoreCache = next;
    saveTemplateStore();
    sendSuccess(res, { deleted: templateId, remaining: next.length });
  }));

  router.post("/templates/reset", validateBody(MutationPassthroughSchema), asyncRoute(async (_req, res) => {
    templateStoreCache = deepClone(AGENT_ROLE_TEMPLATES);
    saveTemplateStore();
    sendSuccess(res, { templates: listTemplateStore() });
  }));

  router.post("/", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    const payload = (req.body ?? {}) as CreateAgentBody;
    const name = String(payload.name ?? "").trim();
    const role = String(payload.role ?? "").trim();
    const requestedModelId = String(payload.modelId ?? "").trim();
    const soul = String(payload.soul ?? "").trim();

    if (!name || !role) {
      sendError(res, 400, "VALIDATION_ERROR", "name and role are required");
      return;
    }

    const sop = payload.sop === undefined
      ? []
      : normalizeStringArray(payload.sop);

    if (payload.sop !== undefined && !Array.isArray(payload.sop)) {
      sendError(res, 400, "VALIDATION_ERROR", "sop must be an array of strings");
      return;
    }

    const alreadyExists = await agentExists(role);
    if (alreadyExists) {
      sendError(res, 400, "VALIDATION_ERROR", `Agent ${role} already exists`);
      return;
    }

    let modelId = requestedModelId;
    if (modelId) {
      const model = await prisma.model.findUnique({ where: { id: modelId } });
      if (!model) {
        sendError(res, 404, "NOT_FOUND", "Model not found");
        return;
      }
    } else {
      const firstModel = await prisma.model.findFirst({
        orderBy: { createdAt: "asc" },
        select: { id: true }
      });
      modelId = firstModel?.id ?? "default-model";
    }

    const nowIso = new Date().toISOString();
    const intro = soul || `${name} (${role})`;

    await prisma.$transaction(async (tx) => {
      await tx.agentProfile.create({
        data: {
          roleId: role,
          name,
          tagline: `${role} Agent`,
          description: intro,
          status: "idle",
          workload: 0,
          styles: [],
          skills: {
            professional: 80,
            collaboration: 80,
            learning: 80,
            stability: 80,
            innovation: 80
          },
          recentHighlights: []
        }
      });

      await tx.managedAgentConfig.create({
        data: {
          agentId: role,
          displayName: name,
          title: role,
          intro,
          responsibility: role,
          selectedModel: modelId,
          defaultModel: modelId,
          fallbackModel: null,
          executionMode: "confirm_first",
          requireConfirmation: true,
          autoApproveMinorSteps: false,
          maxPromptTokens: DEFAULT_AGENT_TOKEN_LIMIT,
          maxCompletionTokens: null,
          maxDailyTokens: DEFAULT_AGENT_TOKEN_LIMIT,
          memoryEnabled: true,
          allowedAgentIds: [],
          toolAllowlist: []
        }
      });

      if (soul) {
        await tx.agentSoul.upsert({
          where: { agentId: role },
          create: {
            agentId: role,
            content: soul,
            updatedAt: nowIso
          },
          update: {
            content: soul,
            updatedAt: nowIso
          }
        });
      }

      if (sop.length > 0) {
        await tx.agentSop.upsert({
          where: { agentId: role },
          create: {
            agentId: role,
            steps: JSON.stringify(sop),
            updatedAt: nowIso
          },
          update: {
            steps: JSON.stringify(sop),
            updatedAt: nowIso
          }
        });
      }
    });

    const detail = await getAgentDetail(role);
    sendSuccess(res, detail, 201);
  }));

  router.get("/:id/soul", asyncRoute(async (req, res) => {
    const agentId = String(req.params.id ?? "").trim();
    const soul = await prisma.agentSoul.findUnique({ where: { agentId } });

    sendSuccess(res, {
      agentId,
      content: soul?.content ?? "",
      updatedAt: soul?.updatedAt?.toISOString() ?? ""
    });
  }));

  router.patch("/:id/soul", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    const agentId = String(req.params.id ?? "").trim();
    const payload = (req.body ?? {}) as UpdateSoulBody;
    const content = String(payload.content ?? "").trim();

    if (!content) {
      sendError(res, 400, "VALIDATION_ERROR", "content is required");
      return;
    }

    if (!(await agentExists(agentId))) {
      sendError(res, 404, "NOT_FOUND", "Agent not found");
      return;
    }

    const updated = await prisma.agentSoul.upsert({
      where: { agentId },
      create: {
        agentId,
        content
      },
      update: {
        content
      }
    });

    sendSuccess(res, {
      agentId,
      content: updated.content,
      updatedAt: updated.updatedAt.toISOString()
    });
  }));

  router.get("/:id/sop", asyncRoute(async (req, res) => {
    const agentId = String(req.params.id ?? "").trim();
    const sop = await prisma.agentSop.findUnique({ where: { agentId } });

    sendSuccess(res, {
      agentId,
      steps: parseStoredSteps(sop?.steps ?? null),
      updatedAt: sop?.updatedAt?.toISOString() ?? ""
    });
  }));

  router.patch("/:id/sop", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    const agentId = String(req.params.id ?? "").trim();
    const payload = (req.body ?? {}) as UpdateSopBody;

    if (!Array.isArray(payload.steps)) {
      sendError(res, 400, "VALIDATION_ERROR", "steps must be an array of strings");
      return;
    }

    const steps = normalizeStringArray(payload.steps);

    if (!(await agentExists(agentId))) {
      sendError(res, 404, "NOT_FOUND", "Agent not found");
      return;
    }

    const updated = await prisma.agentSop.upsert({
      where: { agentId },
      create: {
        agentId,
        steps: JSON.stringify(steps)
      },
      update: {
        steps: JSON.stringify(steps)
      }
    });

    sendSuccess(res, {
      agentId,
      steps: parseStoredSteps(updated.steps),
      updatedAt: updated.updatedAt.toISOString()
    });
  }));

  router.patch("/:id/model", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    const agentId = String(req.params.id ?? "").trim();
    const payload = (req.body ?? {}) as SwitchModelBody;
    const modelId = String(payload.modelId ?? "").trim();

    if (!modelId) {
      sendError(res, 400, "VALIDATION_ERROR", "modelId is required");
      return;
    }

    const model = await prisma.model.findUnique({
      where: { id: modelId },
      select: { id: true }
    });

    if (!model) {
      sendError(res, 404, "NOT_FOUND", "Model not found");
      return;
    }

    const profile = await prisma.agentProfile.findUnique({
      where: { roleId: agentId }
    });

    const existingConfig = await prisma.managedAgentConfig.findUnique({
      where: { agentId }
    });

    if (!profile && !existingConfig) {
      sendError(res, 404, "NOT_FOUND", "Agent not found");
      return;
    }

    const updatedConfig = await prisma.managedAgentConfig.upsert({
      where: { agentId },
      create: {
        agentId,
        displayName: profile?.name ?? agentId,
        title: profile?.roleId ?? agentId,
        intro: profile?.description ?? null,
        responsibility: profile?.tagline ?? null,
        selectedModel: modelId,
        defaultModel: modelId,
        fallbackModel: null,
        executionMode: "confirm_first",
        requireConfirmation: true,
        autoApproveMinorSteps: false,
        maxPromptTokens: DEFAULT_AGENT_TOKEN_LIMIT,
        maxCompletionTokens: null,
        maxDailyTokens: DEFAULT_AGENT_TOKEN_LIMIT,
        memoryEnabled: true,
        allowedAgentIds: [],
        toolAllowlist: []
      },
      update: {
        selectedModel: modelId,
        defaultModel: existingConfig?.defaultModel || modelId
      }
    });

    sendSuccess(res, {
      agentId,
      modelId: updatedConfig.selectedModel,
      updatedAt: updatedConfig.updatedAt.toISOString()
    });
  }));

  router.delete("/:id", asyncRoute(async (req, res) => {
    const agentId = String(req.params.id ?? "").trim();

    if (!(await agentExists(agentId))) {
      sendError(res, 404, "NOT_FOUND", "Agent not found");
      return;
    }

    await prisma.$transaction([
      prisma.agentSoul.deleteMany({ where: { agentId } }),
      prisma.agentSop.deleteMany({ where: { agentId } }),
      prisma.managedAgentConfig.deleteMany({ where: { agentId } }),
      prisma.agentProfile.deleteMany({ where: { roleId: agentId } })
    ]);

    sendSuccess(res, null);
  }));

  router.get("/:id", asyncRoute(async (req, res) => {
    const agentId = String(req.params.id ?? "").trim();
    const detail = await getAgentDetail(agentId);

    if (!detail) {
      if (isHermesIntegrationEnabled() && agentId === HERMES_AGENT_DEFAULT_ID) {
        sendSuccess(res, buildBuiltinHermesAgentRow());
        return;
      }
      sendError(res, 404, "NOT_FOUND", "Agent not found");
      return;
    }

    sendSuccess(res, detail);
  }));

  return router;
}
