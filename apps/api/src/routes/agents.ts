import { Prisma } from "@prisma/client";
import express from "express";
import { prisma } from "../db.js";
import {
  asyncRoute,
  normalizeStringArray,
  parseStoredSteps,
  sendError,
  sendSuccess
} from "./utils.js";

const DEFAULT_AGENT_TOKEN_LIMIT = 100_000_000;
const HERMES_AGENT_DEFAULT_ID = String(process.env.HERMES_AGENT_ID ?? "hermes-agent-1").trim() || "hermes-agent-1";

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

function buildBuiltinHermesAgentRow() {
  const nowIso = new Date().toISOString();
  return {
    id: HERMES_AGENT_DEFAULT_ID,
    name: "Hermes Agent",
    role: "Hermes 协作引擎",
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

  return {
    id: agentId,
    name: config?.displayName?.trim() || profile?.name || agentId,
    role: profile?.roleId || config?.title || agentId,
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
    integrationEngine: inferIntegrationEngine([
      agentId,
      profile?.roleId,
      profile?.name,
      config?.title,
      config?.displayName
    ])
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

        return {
          id: agentId,
          name: config?.displayName?.trim() || profile?.name || agentId,
          role: profile?.roleId || config?.title || agentId,
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
          integrationEngine: inferIntegrationEngine([
            agentId,
            profile?.roleId,
            profile?.name,
            config?.title,
            config?.displayName
          ])
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    if (isHermesIntegrationEnabled()) {
      const hasHermes = list.some((item) => item.id === HERMES_AGENT_DEFAULT_ID || item.integrationEngine === "hermes");
      if (!hasHermes) {
        list.unshift(buildBuiltinHermesAgentRow());
      }
    }

    sendSuccess(res, list);
  }));

  router.post("/", asyncRoute(async (req, res) => {
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

  router.patch("/:id/soul", asyncRoute(async (req, res) => {
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

  router.patch("/:id/sop", asyncRoute(async (req, res) => {
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

  router.patch("/:id/model", asyncRoute(async (req, res) => {
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
