import express from "express";
import type {
  PromptTemplateChannel,
  PromptTemplateUpsertInput,
  RoleType,
  RuntimeSettingsInput,
  StageType
} from "@occ/shared";
import { getSystemHealth } from "../data/repository.js";
import {
  getStageModelPolicy,
  getStageModelUsage,
  previewStageModelPlan
} from "../agents/runtime.js";
import {
  createPromptTemplate,
  listPromptTemplates,
  markPromptTemplateUsed
} from "../system/prompt-templates.js";
import {
  getRuntimeSettings,
  getRuntimeStatus,
  updateRuntimeSettings,
  validateRuntimeSettings
} from "../system/runtime-config.js";
import { getSystemReadiness } from "../system/readiness.js";
import { listAuditLogs } from "../system/audit-log.js";
import { getDesignModelPolicyHealth, repairDesignModelPolicy } from "../system/design-model-policy-health.js";
import { getIssue } from "../system/v1-method-store.js";
import { getCachedLocalAgentMonitorOverview, subscribeLocalAgentMonitor } from "../system/local-agent-monitor.js";
import { inspectOpenClawModelRouting } from "../openclaw/workspace.js";

interface CreateSystemRouterOptions {
  asyncRoute: (
    handler: (req: express.Request, res: express.Response) => Promise<void>
  ) => express.RequestHandler;
  safeAudit: (
    req: express.Request,
    res: express.Response,
    input: {
      actorType: "admin" | "system";
      actorLabel: string;
      action: string;
      resourceType: string;
      resourceId?: string;
      summary: string;
      detail?: string;
    }
  ) => Promise<void>;
  sendEvent: (res: express.Response, event: string, data: unknown) => void;
}

const PROMPT_CHANNELS: PromptTemplateChannel[] = [
  "project_room_guidance",
  "project_room_emergency",
  "project_room_deliverable",
  "openclaw_agent",
  "openclaw_batch"
];
const STAGE_TYPES: StageType[] = ["INIT", "ANALYSIS", "DESIGN", "DEV", "ACCEPT"];
const ROLE_TYPES: RoleType[] = [
  "ROLE_ASSISTANT",
  "ROLE_PM",
  "ROLE_ANALYST",
  "ROLE_PRODUCT",
  "ROLE_DESIGN",
  "ROLE_ARCH",
  "ROLE_DEV",
  "ROLE_QA",
  "ROLE_HR"
];

function parseStageType(input: unknown): StageType | undefined {
  const normalized = String(input ?? "").trim().toUpperCase();
  return STAGE_TYPES.includes(normalized as StageType) ? (normalized as StageType) : undefined;
}

function parseRoleType(input: unknown): RoleType | undefined {
  const normalized = String(input ?? "").trim().toUpperCase();
  return ROLE_TYPES.includes(normalized as RoleType) ? (normalized as RoleType) : undefined;
}

export function createSystemRouter(options: CreateSystemRouterOptions) {
  const router = express.Router();
  const { asyncRoute, safeAudit, sendEvent } = options;

  router.get("/health", asyncRoute(async (_req, res) => {
    res.json(await getSystemHealth());
  }));

  router.get("/runtime", asyncRoute(async (_req, res) => {
    res.json(await getRuntimeStatus());
  }));

  router.get("/runtime/config", asyncRoute(async (_req, res) => {
    res.json(await getRuntimeSettings());
  }));

  router.put("/runtime/config", asyncRoute(async (req, res) => {
    const payload = (req.body ?? {}) as Partial<RuntimeSettingsInput>;
    const provider = String(payload.provider ?? "").trim();
    if (provider !== "scripted" && provider !== "openai-compatible") {
      res.status(400).json({ message: "provider must be scripted or openai-compatible" });
      return;
    }

    const updated = await updateRuntimeSettings({
      provider,
      apiBaseUrl: payload.apiBaseUrl,
      modelName: payload.modelName,
      apiKey: payload.apiKey,
      clearApiKey: Boolean(payload.clearApiKey)
    });

    await safeAudit(req, res, {
      actorType: "admin",
      actorLabel: "管理员",
      action: "system.runtime_config_updated",
      resourceType: "system",
      summary: `已更新运行时配置（provider=${updated.provider}）`
    });

    res.json(updated);
  }));

  router.post("/runtime/validate", asyncRoute(async (_req, res) => {
    const result = await validateRuntimeSettings();
    res.status(result.ok ? 200 : 422).json(result);
  }));

  router.get("/model-routing/self-check", asyncRoute(async (_req, res) => {
    res.json(await inspectOpenClawModelRouting({ repair: false }));
  }));

  router.post("/model-routing/self-heal", asyncRoute(async (req, res) => {
    const payload = (req.body ?? {}) as { apply?: unknown };
    const apply = payload.apply === undefined ? true : Boolean(payload.apply);
    const result = await inspectOpenClawModelRouting({ repair: apply });

    if (apply) {
      await safeAudit(req, res, {
        actorType: "admin",
        actorLabel: "管理员",
        action: "system.model_routing_self_heal",
        resourceType: "system",
        summary: `模型路由占位值修复完成（fixed=${result.fixed}, pending=${result.pending}）`,
        detail: JSON.stringify({
          fixed: result.fixed,
          pending: result.pending,
          issues: result.issues
        })
      });
    }

    res.json(result);
  }));

  router.get("/readiness", asyncRoute(async (_req, res) => {
    res.json(await getSystemReadiness());
  }));

  router.get("/audit-logs", asyncRoute(async (req, res) => {
    const limitRaw = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.round(limitRaw))) : 50;
    res.json(await listAuditLogs(limit));
  }));

  router.get("/prompt-templates", asyncRoute(async (req, res) => {
    const channel = String(req.query.channel ?? "").trim() as PromptTemplateChannel;
    const locale = String(req.query.locale ?? "zh-CN").trim() === "en-US" ? "en-US" : "zh-CN";
    const projectId = String(req.query.projectId ?? "").trim() || undefined;

    if (!PROMPT_CHANNELS.includes(channel)) {
      res.status(400).json({ message: "channel is required" });
      return;
    }

    res.json(await listPromptTemplates({ channel, locale, projectId }));
  }));

  router.post("/prompt-templates", asyncRoute(async (req, res) => {
    const payload = (req.body ?? {}) as Partial<PromptTemplateUpsertInput>;
    const channel = String(payload.channel ?? "").trim() as PromptTemplateChannel;
    const scope = String(payload.scope ?? "").trim();
    const locale = String(payload.locale ?? "zh-CN").trim() === "en-US" ? "en-US" : "zh-CN";
    const title = String(payload.title ?? "").trim();
    const content = String(payload.content ?? "").trim();
    const ownerLabel = String(payload.ownerLabel ?? "").trim() || undefined;
    const projectId = String(payload.projectId ?? "").trim() || undefined;

    if (!title || !content || !PROMPT_CHANNELS.includes(channel)) {
      res.status(400).json({ message: "title/content/channel are required" });
      return;
    }
    if (scope !== "global" && scope !== "project" && scope !== "personal") {
      res.status(400).json({ message: "scope must be global/project/personal" });
      return;
    }
    if (scope === "project" && !projectId) {
      res.status(400).json({ message: "project scope requires projectId" });
      return;
    }

    const created = await createPromptTemplate({
      title,
      content,
      scope,
      channel,
      locale,
      projectId,
      ownerLabel
    });
    res.status(201).json(created);
  }));

  router.post("/prompt-templates/:templateId/use", asyncRoute(async (req, res) => {
    const templateId = String(req.params.templateId ?? "").trim();
    if (!templateId) {
      res.status(400).json({ message: "templateId is required" });
      return;
    }
    res.json(await markPromptTemplateUsed(templateId));
  }));

  router.get("/design-model-policy/health", asyncRoute(async (_req, res) => {
    const result = await getDesignModelPolicyHealth();
    res.status(result.ok ? 200 : 503).json(result);
  }));

  router.post("/design-model-policy/repair", asyncRoute(async (req, res) => {
    const result = await repairDesignModelPolicy();
    await safeAudit(req, res, {
      actorType: "admin",
      actorLabel: "管理员",
      action: "system.design_model_policy_repair",
      resourceType: "system",
      summary: "已执行设计模型策略修复"
    });
    res.json(result);
  }));

  router.get("/stage-model-policy", asyncRoute(async (_req, res) => {
    res.json(getStageModelPolicy());
  }));

  router.post("/stage-model-policy/preview", asyncRoute(async (req, res) => {
    const payload = req.body as { stageType?: unknown; role?: unknown };
    const result = await previewStageModelPlan({
      stageType: parseStageType(payload?.stageType),
      role: parseRoleType(payload?.role)
    });
    res.json(result);
  }));

  router.get("/stage-model-policy/usage", asyncRoute(async (req, res) => {
    const lookbackHoursRaw = Number(req.query.lookbackHours ?? 24);
    const lookbackHours = Number.isFinite(lookbackHoursRaw)
      ? Math.max(1, Math.min(720, Math.round(lookbackHoursRaw)))
      : 24;
    res.json(await getStageModelUsage({ lookbackHours }));
  }));

  router.post("/stage-model-policy/debate/compare-log", asyncRoute(async (req, res) => {
    const payload = req.body as {
      baselineIssueId?: unknown;
      compareIssueId?: unknown;
      label?: unknown;
    };
    const baselineIssueId = String(payload?.baselineIssueId ?? "").trim();
    const compareIssueId = String(payload?.compareIssueId ?? "").trim();
    const label = String(payload?.label ?? "").trim() || "辩论对比审计";

    if (!baselineIssueId || !compareIssueId) {
      res.status(400).json({ message: "baselineIssueId and compareIssueId are required" });
      return;
    }

    const [baseline, compare] = await Promise.all([getIssue(baselineIssueId), getIssue(compareIssueId)]);
    if (!baseline || !compare) {
      res.status(404).json({ message: "Issue not found" });
      return;
    }

    const baseOpinions = baseline.debate?.opinions ?? [];
    const compareOpinions = compare.debate?.opinions ?? [];
    const roleIds = Array.from(new Set([
      ...baseOpinions.map((item) => item.roleId),
      ...compareOpinions.map((item) => item.roleId)
    ]));
    const roleComparison = roleIds.map((roleId) => {
      const left = baseOpinions.find((item) => item.roleId === roleId);
      const right = compareOpinions.find((item) => item.roleId === roleId);
      return {
        roleId,
        roleLabel: right?.roleLabel || left?.roleLabel || roleId,
        modelChanged: String(left?.model ?? "") !== String(right?.model ?? ""),
        focusChanged: String(left?.focus ?? "") !== String(right?.focus ?? ""),
        proposalChanged: String(left?.proposal ?? "") !== String(right?.proposal ?? "")
      };
    });
    const changedRoleCount = roleComparison.filter((item) => item.modelChanged || item.focusChanged || item.proposalChanged).length;

    const result = {
      label,
      baselineIssueId,
      compareIssueId,
      roleComparison,
      changedRoleCount,
      roleCount: roleComparison.length,
      baseline: {
        debateStatus: baseline.debateStatus ?? null,
        debateMode: baseline.debate?.mode ?? null
      },
      compare: {
        debateStatus: compare.debateStatus ?? null,
        debateMode: compare.debate?.mode ?? null
      }
    };

    await safeAudit(req, res, {
      actorType: "admin",
      actorLabel: "管理员",
      action: "system.debate_compare_logged",
      resourceType: "issue",
      resourceId: compareIssueId,
      summary: `已写入辩论对比审计（${baselineIssueId} vs ${compareIssueId}）`,
      detail: JSON.stringify({
        baselineIssueId,
        compareIssueId,
        changedRoleCount,
        roleCount: roleComparison.length
      })
    });

    res.json(result);
  }));

  router.get("/local-agent-monitor", asyncRoute(async (_req, res) => {
    res.json(await getCachedLocalAgentMonitorOverview());
  }));

  router.get("/local-agent-monitor/live", asyncRoute(async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const unsubscribe = subscribeLocalAgentMonitor((snapshot) => {
      sendEvent(res, "snapshot", snapshot);
    });

    const heartbeat = setInterval(() => {
      res.write(": ping\n\n");
    }, 15000);
    heartbeat.unref?.();

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  }));

  return router;
}
