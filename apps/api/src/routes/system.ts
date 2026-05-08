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
import {
  getExecutionProtocolSnapshot,
  updateExecutionProtocolSettings
} from "../system/execution-protocol.js";
import { getUiPreferences, updateUiPreferences } from "../system/ui-preferences.js";
import { getSystemReadiness } from "../system/readiness.js";
import { listAuditLogs, summarizeAuditLogs } from "../system/audit-log.js";
import { getDesignModelPolicyHealth, repairDesignModelPolicy } from "../system/design-model-policy-health.js";
import { getIssue } from "../system/v1-method-store.js";
import { getCachedLocalAgentMonitorOverview, subscribeLocalAgentMonitor } from "../system/local-agent-monitor.js";
import {
  applyHermesUpgradeSuggestion,
  dismissHermesUpgradeSuggestion,
  evaluateHermesUpgradeNow,
  getHermesUpgradeState,
  updateHermesUpgradeConfig
} from "../system/hermes-upgrade.js";
import { probeStitchRuntimeConnection } from "../integrations/stitch-runtime.js";
import {
  applyOpenClawAutonomousModePreference,
  inspectOpenClawModelRouting,
  getOpenClawStatusSummary
} from "../openclaw/workspace.js";
import { getHermesMcpRuntimeStatus, probeHermesMcpEndpoint } from "../workflow-v2/hermes-mcp.js";
import { cleanupContextHygiene, getContextHygieneReport } from "../system/context-hygiene.js";
import { getLatestAuditInspectionSummary, runAuditInspectionNow } from "../workflow-v2/audit-tasks.js";
import { prisma, withPrismaReadRetry } from "../db.js";
import { validateBody } from "../validation/middleware.js";
import {
  ContextHygieneCleanupSchema,
  ExecutionProtocolUpdateSchema,
  ModelRoutingSelfHealSchema,
  MutationOptionalSchema,
  MutationPassthroughSchema,
  RuntimeConfigUpdateSchema,
  UiAutonomousModeApplySchema,
  UiPreferencesUpdateSchema
} from "../validation/schemas.js";

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
const AUDIT_LOG_TOTAL_CACHE_TTL_MS = Math.max(
  3_000,
  Number(process.env.AUDIT_LOG_TOTAL_CACHE_TTL_MS ?? 20_000)
);
let auditLogTotalCache: { value: number; expiresAt: number } | null = null;

function parseStageType(input: unknown): StageType | undefined {
  const normalized = String(input ?? "").trim().toUpperCase();
  return STAGE_TYPES.includes(normalized as StageType) ? (normalized as StageType) : undefined;
}

function parseRoleType(input: unknown): RoleType | undefined {
  const normalized = String(input ?? "").trim().toUpperCase();
  return ROLE_TYPES.includes(normalized as RoleType) ? (normalized as RoleType) : undefined;
}

function buildLocalMonitorFallback(): Awaited<ReturnType<typeof getCachedLocalAgentMonitorOverview>> {
  const nowIso = new Date().toISOString();
  return {
    scannedAt: nowIso,
    tools: [],
    sessions: [],
    totals: {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      totalTokens: 0,
      knownCostUsd: 0,
      estimatedCostUsd: 0,
      pricingMode: "unavailable"
    }
  };
}

type IntegrationReadinessState = "code_available" | "configured" | "reachable" | "validated" | "unavailable";

type IntegrationReadinessItem = {
  key: "openclaw" | "hermes" | "gitlab" | "stitch";
  label: string;
  state: IntegrationReadinessState;
  configured: boolean;
  reachable: boolean;
  validated: boolean;
  message: string;
  checkedAt: string;
  details?: Record<string, unknown>;
};

async function probeGitLabConnection(): Promise<{ ok: boolean; message: string; details?: Record<string, unknown> }> {
  const token = String(process.env.GITLAB_TOKEN ?? "").trim();
  const base = String(process.env.GITLAB_API_BASE_URL ?? "https://gitlab.com/api/v4").trim();
  if (!token) {
    return {
      ok: false,
      message: "GITLAB_TOKEN 未配置"
    };
  }
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/user`, {
      headers: { "PRIVATE-TOKEN": token }
    });
    if (!response.ok) {
      return {
        ok: false,
        message: `GitLab API 探活失败（HTTP ${response.status}）`
      };
    }
    const payload = await response.json().catch(() => null) as { username?: string } | null;
    return {
      ok: true,
      message: "GitLab API 可达",
      details: { username: payload?.username ?? null }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitLab 连接异常";
    return {
      ok: false,
      message
    };
  }
}

async function getIntegrationReadinessSnapshot(): Promise<{
  generatedAt: string;
  integrations: IntegrationReadinessItem[];
}> {
  const checkedAt = new Date().toISOString();
  const [openclaw, stitch, gitlab, hermesProbe] = await Promise.all([
    getOpenClawStatusSummary()
      .then((result) => ({ ok: true as const, result }))
      .catch((error) => ({ ok: false as const, error })),
    probeStitchRuntimeConnection()
      .then((result) => ({ ok: true as const, result }))
      .catch((error) => ({ ok: false as const, error })),
    probeGitLabConnection(),
    (async () => {
      const runtime = getHermesMcpRuntimeStatus();
      if (!runtime.enabled) {
        return { configured: false, reachable: false, validated: false, message: "Hermes MCP 未启用" };
      }
      const probe = await probeHermesMcpEndpoint();
      return {
        configured: true,
        reachable: Boolean(probe.reachable),
        validated: Boolean(probe.reachable),
        message: probe.reachable ? "Hermes MCP 可达" : probe.message || "Hermes MCP 不可达",
        details: { endpoint: runtime.endpoint }
      };
    })()
  ]);

  const integrations: IntegrationReadinessItem[] = [
    openclaw.ok
      ? {
          key: "openclaw",
          label: "OpenClaw",
          state: "validated",
          configured: true,
          reachable: true,
          validated: true,
          message: "OpenClaw 状态探测成功",
          checkedAt,
          details: {
            runtimeVersion: openclaw.result.runtimeVersion,
            sessionCount: openclaw.result.sessionCount
          }
        }
      : {
          key: "openclaw",
          label: "OpenClaw",
          state: "unavailable",
          configured: true,
          reachable: false,
          validated: false,
          message: openclaw.error instanceof Error ? openclaw.error.message : "OpenClaw 探测失败",
          checkedAt
        },
    {
      key: "hermes",
      label: "Hermes MCP",
      state: hermesProbe.validated ? "validated" : hermesProbe.configured ? "configured" : "code_available",
      configured: hermesProbe.configured,
      reachable: hermesProbe.reachable,
      validated: hermesProbe.validated,
      message: hermesProbe.message,
      checkedAt,
      details: hermesProbe.details
    },
    {
      key: "gitlab",
      label: "GitLab",
      state: gitlab.ok ? "validated" : String(process.env.GITLAB_TOKEN ?? "").trim() ? "configured" : "code_available",
      configured: Boolean(String(process.env.GITLAB_TOKEN ?? "").trim()),
      reachable: gitlab.ok,
      validated: gitlab.ok,
      message: gitlab.message,
      checkedAt,
      details: gitlab.details
    },
    {
      key: "stitch",
      label: "Stitch",
      state: stitch.ok
        ? (stitch.result.ok ? "validated" : stitch.result.apiKeyConfigured ? "configured" : "code_available")
        : "unavailable",
      configured: stitch.ok ? Boolean(stitch.result.apiKeyConfigured) : false,
      reachable: stitch.ok ? Boolean(stitch.result.ok) : false,
      validated: stitch.ok ? Boolean(stitch.result.ok) : false,
      message: stitch.ok
        ? (stitch.result.message || (stitch.result.ok ? "Stitch 探测通过" : "Stitch 不可达"))
        : (stitch.error instanceof Error ? stitch.error.message : "Stitch 探测失败"),
      checkedAt,
      details: stitch.ok ? { endpoint: stitch.result.baseUrl ?? null, reason: stitch.result.reason } : undefined
    }
  ];

  return {
    generatedAt: checkedAt,
    integrations
  };
}

async function withTimeoutFallback<T>(task: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    const timeoutPromise = new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), timeoutMs);
      timer.unref?.();
    });
    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

const OBSERVABILITY_SUMMARY_CACHE_TTL_MS = Math.max(
  5_000,
  Number(process.env.OBSERVABILITY_SUMMARY_CACHE_TTL_MS ?? 30_000)
);
const OBSERVABILITY_TOTALS_CACHE_TTL_MS = Math.max(
  10_000,
  Number(process.env.OBSERVABILITY_TOTALS_CACHE_TTL_MS ?? 60_000)
);
let observabilitySummaryCache:
  | { expiresAt: number; value: unknown }
  | null = null;
let observabilitySummaryInflight: Promise<unknown> | null = null;
let observabilityTotalsCache:
  | {
      expiresAt: number;
      value: { projectCount: number; executionCount: number; auditCount: number };
    }
  | null = null;
let observabilityTotalsInflight: Promise<{ projectCount: number; executionCount: number; auditCount: number }> | null = null;

export async function getObservabilitySummarySnapshot() {
  const now = Date.now();
  if (observabilitySummaryCache && observabilitySummaryCache.expiresAt > now) {
    return observabilitySummaryCache.value;
  }
  if (observabilitySummaryInflight) {
    return observabilitySummaryInflight;
  }

  observabilitySummaryInflight = (async () => {
  const [runtime, readiness, monitor] = await Promise.all([
    getRuntimeStatus(),
    getSystemReadiness(),
    withTimeoutFallback(getCachedLocalAgentMonitorOverview(), 1500, buildLocalMonitorFallback())
  ]);
  const nowTotals = Date.now();
  let totals = observabilityTotalsCache && observabilityTotalsCache.expiresAt > nowTotals
    ? observabilityTotalsCache.value
    : null;
  if (!totals) {
    if (!observabilityTotalsInflight) {
      observabilityTotalsInflight = Promise.all([
        withPrismaReadRetry("count", () => prisma.project.count()),
        withPrismaReadRetry("count", () => prisma.projectExecution.count()),
        withPrismaReadRetry("count", () => prisma.auditLog.count())
      ]).then(([projectCount, executionCount, auditCount]) => ({
        projectCount,
        executionCount,
        auditCount
      })).finally(() => {
        observabilityTotalsInflight = null;
      });
    }
    totals = await observabilityTotalsInflight;
    observabilityTotalsCache = {
      value: totals,
      expiresAt: Date.now() + OBSERVABILITY_TOTALS_CACHE_TTL_MS
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    runtime: {
      mode: runtime.mode,
      requestedMode: runtime.requestedMode,
      configured: runtime.configured,
      lastValidationStatus: runtime.lastValidationStatus
    },
    readiness: {
      warningCount: readiness.warnings.length,
      warnings: readiness.warnings
    },
    data: {
      projectCount: totals.projectCount,
      executionCount: totals.executionCount,
      auditCount: totals.auditCount
    },
    localAgentMonitor: {
      scannedAt: monitor.scannedAt,
      tools: monitor.tools.map((tool) => ({
        id: tool.tool,
        name: tool.label,
        available: tool.available,
        activeSessions: tool.activeCount,
        recentSessions: tool.sessionCount
      })),
      totals: monitor.totals
    }
  };
  })();

  try {
    const value = await observabilitySummaryInflight;
    observabilitySummaryCache = {
      value,
      expiresAt: Date.now() + OBSERVABILITY_SUMMARY_CACHE_TTL_MS
    };
    return value;
  } finally {
    observabilitySummaryInflight = null;
  }
}

export function createSystemRouter(options: CreateSystemRouterOptions) {
  const router = express.Router();
  const { asyncRoute, safeAudit, sendEvent } = options;

  router.get("/health", asyncRoute(async (_req, res) => {
    const [health, observabilitySummary] = await Promise.all([
      getSystemHealth(),
      getObservabilitySummarySnapshot()
    ]);
    res.json({
      ...health,
      // Backward-compatible field for dashboard consumers still expecting aggregated observability payload.
      observabilitySummary
    });
  }));

  router.get("/runtime", asyncRoute(async (_req, res) => {
    res.json(await getRuntimeStatus());
  }));

  router.get("/stitch/runtime-check", asyncRoute(async (_req, res) => {
    res.json(await probeStitchRuntimeConnection());
  }));

  router.get("/runtime/config", asyncRoute(async (_req, res) => {
    res.json(await getRuntimeSettings());
  }));

  router.put("/runtime/config", validateBody(RuntimeConfigUpdateSchema), asyncRoute(async (req, res) => {
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

  router.post("/runtime/validate", validateBody(MutationOptionalSchema), asyncRoute(async (_req, res) => {
    const result = await validateRuntimeSettings();
    res.status(result.ok ? 200 : 422).json(result);
  }));

  router.get("/execution-protocol", asyncRoute(async (_req, res) => {
    res.json(await getExecutionProtocolSnapshot());
  }));

  router.put("/execution-protocol", validateBody(ExecutionProtocolUpdateSchema), asyncRoute(async (req, res) => {
    const payload = (req.body ?? {}) as {
      requireSkillEvidence?: unknown;
      requireCollaborationHandoff?: unknown;
      blockDegradedWrites?: unknown;
      blockSecretLeak?: unknown;
      blockLargeFileCommit?: unknown;
      largeFileSizeThreshold?: unknown;
    };

    const updated = await updateExecutionProtocolSettings({
      requireSkillEvidence: payload.requireSkillEvidence === undefined ? undefined : Boolean(payload.requireSkillEvidence),
      requireCollaborationHandoff: payload.requireCollaborationHandoff === undefined ? undefined : Boolean(payload.requireCollaborationHandoff),
      blockDegradedWrites: payload.blockDegradedWrites === undefined ? undefined : Boolean(payload.blockDegradedWrites),
      blockSecretLeak: payload.blockSecretLeak === undefined ? undefined : Boolean(payload.blockSecretLeak),
      blockLargeFileCommit: payload.blockLargeFileCommit === undefined ? undefined : Boolean(payload.blockLargeFileCommit),
      largeFileSizeThreshold: payload.largeFileSizeThreshold === undefined ? undefined : Number(payload.largeFileSizeThreshold)
    });

    await safeAudit(req, res, {
      actorType: "admin",
      actorLabel: "管理员",
      action: "system.execution_protocol_updated",
      resourceType: "system",
      summary: "已更新 Agent Team 执行协议治理规则",
      detail: JSON.stringify(updated.settings)
    });

    res.json(updated);
  }));

  router.get("/ui-preferences", asyncRoute(async (_req, res) => {
    res.json(await getUiPreferences());
  }));

  router.put("/ui-preferences", validateBody(UiPreferencesUpdateSchema), asyncRoute(async (req, res) => {
    const payload = (req.body ?? {}) as {
      language?: unknown;
      workspacePath?: unknown;
      autoSync?: unknown;
      apiProtection?: unknown;
      autonomousMode?: unknown;
      usageAlert?: unknown;
      usageAlertThresholdPercent?: unknown;
    };

    const updated = await updateUiPreferences(payload);
    await safeAudit(req, res, {
      actorType: "admin",
      actorLabel: "管理员",
      action: "system.ui_preferences_updated",
      resourceType: "system",
      summary: "已更新设置中心界面偏好",
      detail: JSON.stringify({
        language: updated.language,
        workspacePath: updated.workspacePath,
        autoSync: updated.autoSync,
        apiProtection: updated.apiProtection,
        autonomousMode: updated.autonomousMode,
        usageAlert: updated.usageAlert,
        usageAlertThresholdPercent: updated.usageAlertThresholdPercent
      })
    });
    res.json(updated);
  }));

  router.post("/ui-preferences/apply-autonomous-mode", validateBody(UiAutonomousModeApplySchema), asyncRoute(async (req, res) => {
    const payload = (req.body ?? {}) as { autonomousMode?: unknown; scope?: unknown };
    const autonomousMode = payload.autonomousMode === undefined
      ? (await getUiPreferences()).autonomousMode
      : Boolean(payload.autonomousMode);
    const scopeRaw = String(payload.scope ?? "").trim().toLowerCase();
    const scope = scopeRaw === "core" || scopeRaw === "design" ? scopeRaw : "all";
    const result = await applyOpenClawAutonomousModePreference({
      autonomousMode,
      scope
    });

    await safeAudit(req, res, {
      actorType: "admin",
      actorLabel: "管理员",
      action: "system.ui_preferences_autonomous_mode_applied",
      resourceType: "system",
      summary: `已将自主模式偏好下发到 Agent 配置（scope=${result.scope}, mode=${result.executionMode}, updated=${result.updatedAgents}）`,
      detail: JSON.stringify({
        scope: result.scope,
        autonomousMode: result.autonomousMode,
        executionMode: result.executionMode,
        updatedAgents: result.updatedAgents,
        createdConfigs: result.createdConfigs,
        totalAgents: result.totalAgents
      })
    });

    res.json(result);
  }));

  router.get("/model-routing/self-check", asyncRoute(async (_req, res) => {
    res.json(await inspectOpenClawModelRouting({ repair: false }));
  }));

  router.post("/model-routing/self-heal", validateBody(ModelRoutingSelfHealSchema), asyncRoute(async (req, res) => {
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

  router.get("/observability/summary", asyncRoute(async (_req, res) => {
    const summary = await getObservabilitySummarySnapshot();
    const latestAudit = await getLatestAuditInspectionSummary();
    const summaryObject = (summary && typeof summary === "object")
      ? summary as Record<string, unknown>
      : {};
    res.json({
      ...summaryObject,
      governance: {
        latestAudit
      }
    });
  }));

  router.get("/integration-readiness", asyncRoute(async (_req, res) => {
    res.json(await getIntegrationReadinessSnapshot());
  }));

  router.post("/diagnostics/run", validateBody(MutationOptionalSchema), asyncRoute(async (_req, res) => {
    const [observability, readiness, integrations] = await Promise.all([
      getObservabilitySummarySnapshot(),
      getSystemReadiness(),
      getIntegrationReadinessSnapshot()
    ]);
    const integrationWarnings = integrations.integrations.filter((item) => !item.validated);
    const checks = [
      {
        key: "system.readiness",
        passed: readiness.warnings.length === 0,
        message: readiness.warnings.length === 0 ? "系统就绪检查通过" : `系统存在 ${readiness.warnings.length} 条告警`,
      },
      ...integrations.integrations.map((item) => ({
        key: `integration.${item.key}`,
        passed: item.validated,
        message: item.message
      }))
    ];
    const suggestions = [
      ...integrationWarnings.map((item) => ({
        key: `integration-fix-${item.key}`,
        title: `${item.label} 连通性修复`,
        message: item.message,
        action: item.key === "openclaw" ? "open-settings"
          : item.key === "hermes" ? "open-workflow-console"
          : item.key === "gitlab" ? "open-settings"
          : "open-settings"
      })),
      ...(readiness.warnings.length > 0 ? [{
        key: "runtime-self-heal",
        title: "执行模型路由自愈",
        message: "检测到系统就绪告警，建议先执行模型路由自检与修复。",
        action: "run-model-routing-self-heal"
      }] : [])
    ];

    res.json({
      generatedAt: new Date().toISOString(),
      observability,
      readiness,
      integrations,
      checks,
      suggestions
    });
  }));

  router.get("/context-hygiene", asyncRoute(async (_req, res) => {
    res.json(await getContextHygieneReport());
  }));

  router.post("/context-hygiene/cleanup", validateBody(ContextHygieneCleanupSchema), asyncRoute(async (req, res) => {
    const payload = (req.body ?? {}) as { apply?: unknown; maxDelete?: unknown };
    const apply = payload.apply === undefined ? true : Boolean(payload.apply);
    const maxDeleteRaw = Number(payload.maxDelete ?? 200);
    const maxDelete = Number.isFinite(maxDeleteRaw) ? maxDeleteRaw : 200;
    const result = await cleanupContextHygiene({ apply, maxDelete });

    if (apply) {
      await safeAudit(req, res, {
        actorType: "admin",
        actorLabel: "管理员",
        action: "system.context_hygiene_cleanup",
        resourceType: "system",
        summary: `已清理上下文垃圾数据（memory=${result.deleted.agentMemoryEntries}, templates=${result.deleted.promptTemplates}）`,
        detail: JSON.stringify({
          scanned: result.scanned,
          deleted: result.deleted,
          counts: result.counts
        })
      });
    }

    res.json(result);
  }));

  router.post("/trigger-audit", validateBody(MutationOptionalSchema), asyncRoute(async (req, res) => {
    const result = await runAuditInspectionNow();
    await safeAudit(req, res, {
      actorType: "admin",
      actorLabel: "管理员",
      action: "system.audit_triggered",
      resourceType: "system",
      summary: `手动触发巡检（ok=${result.ok} scanned=${result.scanned ?? 0}）`,
      detail: JSON.stringify(result).slice(0, 2000)
    });
    res.status(result.ok ? 200 : 422).json(result);
  }));

  router.get("/audit-logs", asyncRoute(async (req, res) => {
    const pageRaw = Number(req.query.page ?? 1);
    const pageSizeRaw = Number(req.query.pageSize ?? req.query.limit ?? 20);
    const page = Number.isFinite(pageRaw) ? Math.max(1, Math.floor(pageRaw)) : 1;
    const pageSize = Number.isFinite(pageSizeRaw) ? Math.max(1, Math.min(100, Math.floor(pageSizeRaw))) : 20;
    const offset = (page - 1) * pageSize;
    const now = Date.now();
    const total = auditLogTotalCache && auditLogTotalCache.expiresAt > now
      ? auditLogTotalCache.value
      : await withPrismaReadRetry("count", () => prisma.auditLog.count());
    if (!auditLogTotalCache || auditLogTotalCache.expiresAt <= now) {
      auditLogTotalCache = {
        value: total,
        expiresAt: now + AUDIT_LOG_TOTAL_CACHE_TTL_MS
      };
    }
    res.setHeader("X-Page", String(page));
    res.setHeader("X-Page-Size", String(pageSize));
    res.setHeader("X-Total-Count", String(total));
    const summary = String(req.query.summary ?? "true").trim().toLowerCase() !== "false";
    const logs = await listAuditLogs(pageSize, offset);
    res.json(summary ? summarizeAuditLogs(logs) : logs);
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

  router.post("/prompt-templates", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
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

  router.post("/prompt-templates/:templateId/use", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
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

  router.post("/design-model-policy/repair", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
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

  router.post("/stage-model-policy/preview", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
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

  router.post("/stage-model-policy/debate/compare-log", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
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

  router.get("/local-agent-monitor/overview", asyncRoute(async (_req, res) => {
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

  router.get("/hermes-upgrade", asyncRoute(async (_req, res) => {
    res.json(await getHermesUpgradeState());
  }));

  router.put("/hermes-upgrade/config", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    const payload = (req.body ?? {}) as {
      enabled?: unknown;
      autoApply?: unknown;
      minKnowledgeSyncForSuggestion?: unknown;
      minSkillImportForSuggestion?: unknown;
    };
    const updated = await updateHermesUpgradeConfig({
      enabled: payload.enabled === undefined ? undefined : Boolean(payload.enabled),
      autoApply: payload.autoApply === undefined ? undefined : Boolean(payload.autoApply),
      minKnowledgeSyncForSuggestion: payload.minKnowledgeSyncForSuggestion === undefined
        ? undefined
        : Number(payload.minKnowledgeSyncForSuggestion),
      minSkillImportForSuggestion: payload.minSkillImportForSuggestion === undefined
        ? undefined
        : Number(payload.minSkillImportForSuggestion)
    });

    await safeAudit(req, res, {
      actorType: "admin",
      actorLabel: "管理员",
      action: "system.hermes_upgrade_config_updated",
      resourceType: "system",
      summary: "已更新 Hermes 自我升级闭环配置",
      detail: JSON.stringify(updated.config)
    });
    res.json(updated);
  }));

  router.post("/hermes-upgrade/evaluate", validateBody(MutationPassthroughSchema), asyncRoute(async (_req, res) => {
    const state = await evaluateHermesUpgradeNow();
    res.json(state);
  }));

  router.post("/hermes-upgrade/suggestions/:id/apply", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    const suggestionId = String(req.params.id ?? "").trim();
    if (!suggestionId) {
      res.status(400).json({ message: "suggestion id is required" });
      return;
    }
    const result = await applyHermesUpgradeSuggestion(suggestionId);
    if (!result.found) {
      res.status(404).json({ message: "suggestion not found" });
      return;
    }
    res.json(result.state);
  }));

  router.post("/hermes-upgrade/suggestions/:id/dismiss", validateBody(MutationPassthroughSchema), asyncRoute(async (req, res) => {
    const suggestionId = String(req.params.id ?? "").trim();
    if (!suggestionId) {
      res.status(400).json({ message: "suggestion id is required" });
      return;
    }
    const result = await dismissHermesUpgradeSuggestion(suggestionId);
    if (!result.found) {
      res.status(404).json({ message: "suggestion not found" });
      return;
    }
    res.json(result.state);
  }));

  return router;
}
