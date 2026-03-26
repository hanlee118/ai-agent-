import { useEffect, useMemo, useState } from "react";
import type {
  AuditLogItem,
  LocalAgentMonitorOverview,
  LocalAgentSessionItem,
  LocalAgentToolSummary,
  LocalAgentUsageSummary,
  RuntimeMode,
  RuntimeSettings,
  RuntimeStatus,
  RuntimeValidationResult,
  SystemHealth,
  SystemReadiness
} from "@occ/shared";
import { api } from "../lib/api";
import { useLocale } from "../lib/locale";

type FlashState = { tone: "success" | "error"; message: string } | null;
type StreamState = "connecting" | "live" | "reconnecting";

const EMPTY_USAGE: LocalAgentUsageSummary = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  totalTokens: 0,
  knownCostUsd: 0,
  estimatedCostUsd: 0,
  pricingMode: "unavailable"
};

export function SystemPage() {
  const { isEnglish, locale } = useLocale();
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [localAgentMonitor, setLocalAgentMonitor] = useState<LocalAgentMonitorOverview | null>(null);
  const [monitorStreamState, setMonitorStreamState] = useState<StreamState>("connecting");
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [readiness, setReadiness] = useState<SystemReadiness | null>(null);
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [provider, setProvider] = useState<RuntimeMode>("scripted");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [modelName, setModelName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<FlashState>(null);
  const copy = isEnglish
    ? {
        title: "Runtime config, health status, and release checks",
        hero: "This page is meant for actual operations work: runtime mode, model connection, service health, and audit trails in one place.",
        refresh: "Refresh",
        mode: "Current mode",
        targetMode: "Target mode",
        source: "Config source",
        validation: "Validation status",
        runtimeConfig: "Runtime Config",
        save: "Save",
        validate: "Validate Connectivity",
        serviceHealth: "Service Health",
        readiness: "Platform Readiness",
        localMonitor: "Local Agent Monitor",
        localMonitorCopy: "A Nexus-style observability layer for recent Codex, Claude Code, and OpenClaw sessions on this machine.",
        localMonitorLive: "Realtime stream",
        localMonitorPending: "Waiting for the next live snapshot...",
        localMonitorReconnect: "Reconnecting",
        localMonitorScannedAt: "Last snapshot",
        monitorRoots: "Monitor Roots",
        governanceTitle: "Cost Governance",
        governanceCopy: "Aggregate token usage and cost by tool so operators can catch spend spikes before they turn into surprises.",
        recentSessions: "Recent Sessions",
        totalSessions: "Sessions",
        activeSessions: "Active now",
        totalTokens: "Total tokens",
        knownCost: "Known cost",
        estimatedCost: "Estimated cost",
        inputTokens: "Input",
        cachedTokens: "Cache",
        outputTokens: "Output",
        toolBreakdown: "Tool breakdown",
        dbPath: "Database path",
        openclawConfig: "OpenClaw config",
        workspaceRoot: "Workspace root",
        warnings: "Warnings",
        runModeLabel: "Runtime mode",
        apiBaseLabel: "API Base URL",
        modelNameLabel: "Model name",
        apiKeyLabel: "API Key",
        clearApiKeyLabel: "Clear current API key",
        configSummary: "Current configuration snapshot",
        apiKeyConfigured: "API Key configured",
        updatedAt: "Last updated",
        validatedAt: "Last validated",
        validationResult: "Latest validation result",
        notValidated: "Not validated yet",
        releaseChecklist: "Release Checklist",
        releaseChecklistCopy: "Use this rail like an operator cockpit before publishing or switching the runtime.",
        databaseHealth: "Database health",
        runtimeReady: "Runtime ready",
        openclawReady: "OpenClaw connected",
        taskObservability: "Task observability",
        recentAudit: "Recent audit",
        configuredPlaceholderPrefix: "Configured",
        enterNewApiKey: "Enter a new API key",
        pendingCheck: "Pending check",
        connectedModel: "Connected model",
        scriptedModeDetail: "The workspace is still using scripted fallback mode. Demo-safe, but not ideal for final production.",
        noAudit: "No audit entries yet.",
        loadFailed: "Failed to load system operations data",
        saveSuccess: "Runtime configuration saved.",
        saveFailed: "Failed to save runtime configuration",
        validateFailed: "Runtime validation failed",
        loading: "Loading system operations...",
        readinessOk: "Ready",
        noValue: "n/a",
        observabilityDetail: (activeTasks: number, blockedTasks: number, projectCount: number) =>
          `${activeTasks} active tasks, ${blockedTasks} blocked tasks, ${projectCount} OpenClaw projects in scope.`,
        sessionStatus: {
          active: "Active",
          idle: "Idle",
          stale: "Stale"
        } as Record<LocalAgentSessionItem["status"], string>,
        noCost: "No cost",
        unknownModel: "Unknown model"
      }
    : {
        title: "运行配置、健康状态与发布前检查",
        hero: "这一页面向真正运营使用，不再依赖手工改环境变量，可以直接管理运行模式与模型接入状态。",
        refresh: "刷新状态",
        mode: "当前执行模式",
        targetMode: "目标运行模式",
        source: "配置来源",
        validation: "模型校验状态",
        runtimeConfig: "运行配置",
        save: "保存配置",
        validate: "校验模型连通性",
        serviceHealth: "服务状态",
        readiness: "平台就绪度",
        localMonitor: "本地 Agent 会话监控",
        localMonitorCopy: "借鉴 Nexus 的理念，把 Codex、Claude Code 与 OpenClaw 的最近会话、活跃状态和目录源头统一放到系统页里观测。",
        localMonitorLive: "实时推送",
        localMonitorPending: "正在等待新的实时快照...",
        localMonitorReconnect: "重连中",
        localMonitorScannedAt: "最近快照",
        monitorRoots: "监控根目录",
        governanceTitle: "成本治理",
        governanceCopy: "按工具聚合 token 与成本，让运营侧能提前发现异常消耗，而不是事后回看日志。",
        recentSessions: "最近会话",
        totalSessions: "会话总数",
        activeSessions: "当前活跃",
        totalTokens: "总 Token",
        knownCost: "已知成本",
        estimatedCost: "估算成本",
        inputTokens: "输入",
        cachedTokens: "缓存",
        outputTokens: "输出",
        toolBreakdown: "工具分布",
        dbPath: "数据库路径",
        openclawConfig: "OpenClaw 配置",
        workspaceRoot: "工作区根目录",
        warnings: "风险提示",
        runModeLabel: "运行模式",
        apiBaseLabel: "API Base URL",
        modelNameLabel: "模型名称",
        apiKeyLabel: "API Key",
        clearApiKeyLabel: "清除当前 API Key",
        configSummary: "当前配置摘要",
        apiKeyConfigured: "已配置 API Key",
        updatedAt: "最近更新时间",
        validatedAt: "最近校验时间",
        validationResult: "最近校验结果",
        notValidated: "尚未校验",
        releaseChecklist: "发布前检查",
        releaseChecklistCopy: "把右侧栏当成运营驾驶舱，在发布或切换运行模式前快速确认关键依赖。",
        databaseHealth: "数据库健康",
        runtimeReady: "运行模式可用",
        openclawReady: "OpenClaw 已接通",
        taskObservability: "任务体系可观测",
        recentAudit: "最近操作记录",
        configuredPlaceholderPrefix: "已配置",
        enterNewApiKey: "输入新的 API Key",
        pendingCheck: "待检查",
        connectedModel: "当前已连接真实模型",
        scriptedModeDetail: "当前仍在脚本模式，可继续演示但不建议作为最终生产配置。",
        noAudit: "当前还没有审计记录。",
        loadFailed: "系统配置加载失败",
        saveSuccess: "运行配置已保存。",
        saveFailed: "保存配置失败",
        validateFailed: "运行配置校验失败",
        loading: "正在加载系统运营页...",
        readinessOk: "就绪",
        noValue: "暂无",
        observabilityDetail: (activeTasks: number, blockedTasks: number, projectCount: number) =>
          `当前共有 ${activeTasks} 个活动任务，${blockedTasks} 个阻塞任务，OpenClaw 项目 ${projectCount} 个。`,
        sessionStatus: {
          active: "活跃",
          idle: "空闲",
          stale: "静默"
        } as Record<LocalAgentSessionItem["status"], string>,
        noCost: "暂无成本",
        unknownModel: "未知模型"
      };

  const totalUsage = localAgentMonitor?.totals ?? EMPTY_USAGE;
  const monitorSessions = localAgentMonitor?.sessions ?? [];
  const activeSessionCount = useMemo(
    () => monitorSessions.filter((session) => session.status === "active").length,
    [monitorSessions]
  );

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const source = new EventSource(api.localAgentMonitorLiveUrl(), { withCredentials: true });

    source.onopen = () => {
      setMonitorStreamState("live");
    };

    source.onerror = () => {
      setMonitorStreamState((current) => (current === "live" ? "reconnecting" : "connecting"));
    };

    source.addEventListener("snapshot", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as LocalAgentMonitorOverview;
        setLocalAgentMonitor(payload);
        setMonitorStreamState("live");
      } catch {
        setMonitorStreamState("reconnecting");
      }
    });

    return () => {
      source.close();
    };
  }, []);

  async function refresh(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const [healthInfo, runtimeInfo, settingsInfo, auditInfo, readinessInfo] = await Promise.all([
        api.getSystemHealth(),
        api.getRuntime(),
        api.getRuntimeSettings(),
        api.getAuditLogs(20),
        api.getSystemReadiness()
      ]);

      setHealth(healthInfo);
      setRuntime(runtimeInfo);
      setSettings(settingsInfo);
      setAuditLogs(auditInfo);
      setReadiness(readinessInfo);
      syncForm(settingsInfo);
      setFlash(null);
    } catch (requestError) {
      setFlash({
        tone: "error",
        message: requestError instanceof Error ? requestError.message : copy.loadFailed
      });
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }

  function syncForm(next: RuntimeSettings) {
    setProvider(next.provider);
    setApiBaseUrl(next.apiBaseUrl);
    setModelName(next.modelName);
    setApiKey("");
    setClearApiKey(false);
  }

  async function handleSave() {
    setSaving(true);
    setFlash(null);
    try {
      const updated = await api.updateRuntimeSettings({
        provider,
        apiBaseUrl,
        modelName,
        apiKey: apiKey || undefined,
        clearApiKey
      });

      setSettings(updated);
      setRuntime(await api.getRuntime());
      syncForm(updated);
      setFlash({ tone: "success", message: copy.saveSuccess });
    } catch (requestError) {
      setFlash({
        tone: "error",
        message: requestError instanceof Error ? requestError.message : copy.saveFailed
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleValidate() {
    setValidating(true);
    setFlash(null);
    try {
      const result = await api.validateRuntimeSettings();
      await applyValidationResult(result);
    } catch (requestError) {
      setFlash({
        tone: "error",
        message: requestError instanceof Error ? requestError.message : copy.validateFailed
      });
      await refresh();
    } finally {
      setValidating(false);
    }
  }

  async function applyValidationResult(result: RuntimeValidationResult) {
    setRuntime(result.runtime);
    const nextSettings = await api.getRuntimeSettings();
    setSettings(nextSettings);
    syncForm(nextSettings);
    setFlash({
      tone: result.ok ? "success" : "error",
      message: result.message
    });
  }

  if (loading) {
    return <div className="card">{copy.loading}</div>;
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">System Operations</p>
          <h2>{copy.title}</h2>
          <p className="hero-copy">{copy.hero}</p>
        </div>
        <button className="button button-ghost" onClick={() => void refresh()}>
          {copy.refresh}
        </button>
      </header>

      {flash ? (
        <section className={flash.tone === "success" ? "flash-banner flash-success" : "flash-banner flash-error"}>
          {flash.message}
        </section>
      ) : null}

      <section className="agent-summary-grid">
        <MetricTile label={copy.mode} value={runtime?.mode ?? "unknown"} />
        <MetricTile label={copy.targetMode} value={runtime?.requestedMode ?? "unknown"} tone="warning" />
        <MetricTile label={copy.source} value={runtime?.configSource ?? "unknown"} />
        <MetricTile label={copy.validation} value={runtime?.lastValidationStatus ?? "unknown"} />
      </section>

      <section className="operations-layout">
        <div className="operations-main">
          <article className="card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Runtime Config</p>
                <h3>{copy.runtimeConfig}</h3>
              </div>
            </div>

            <div className="form-grid">
              <label className="form-field">
                <span>{copy.runModeLabel}</span>
                <select value={provider} onChange={(event) => setProvider(event.target.value as RuntimeMode)}>
                  <option value="scripted">scripted</option>
                  <option value="openai-compatible">openai-compatible</option>
                </select>
              </label>

              <label className="form-field">
                <span>{copy.apiBaseLabel}</span>
                <input
                  value={apiBaseUrl}
                  onChange={(event) => setApiBaseUrl(event.target.value)}
                  placeholder="https://api.example.com/v1"
                />
              </label>

              <label className="form-field">
                <span>{copy.modelNameLabel}</span>
                <input
                  value={modelName}
                  onChange={(event) => setModelName(event.target.value)}
                  placeholder="gpt-4.1 / qwen-max / deepseek-chat"
                />
              </label>

              <label className="form-field">
                <span>{copy.apiKeyLabel}</span>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => {
                    setApiKey(event.target.value);
                    if (event.target.value) {
                      setClearApiKey(false);
                    }
                  }}
                  placeholder={settings?.apiKeyConfigured ? `${copy.configuredPlaceholderPrefix}: ${settings.apiKeyPreview}` : copy.enterNewApiKey}
                />
              </label>
            </div>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={clearApiKey}
                onChange={(event) => setClearApiKey(event.target.checked)}
              />
              <span>{copy.clearApiKeyLabel}</span>
            </label>

            <div className="action-row action-row-wrap">
              <button className="button button-primary" onClick={() => void handleSave()} disabled={saving}>
                {saving ? (isEnglish ? "Saving..." : "保存中...") : copy.save}
              </button>
              <button className="button button-ghost" onClick={() => void handleValidate()} disabled={validating}>
                {validating ? (isEnglish ? "Validating..." : "校验中...") : copy.validate}
              </button>
            </div>

            <div className="sub-card">
              <p className="group-title">{copy.configSummary}</p>
              <p>{copy.apiKeyConfigured}: {settings?.apiKeyConfigured ? settings.apiKeyPreview : (isEnglish ? "No" : "否")}</p>
              <p>{copy.updatedAt}: {settings?.updatedAt ? formatTime(settings.updatedAt, locale) : copy.noValue}</p>
              <p>{copy.validatedAt}: {settings?.lastValidatedAt ? formatTime(settings.lastValidatedAt, locale) : copy.notValidated}</p>
              <p>{copy.validationResult}: {settings?.lastValidationError ?? settings?.lastValidationStatus ?? "unknown"}</p>
            </div>
          </article>

          <article className="card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Local Monitor</p>
                <h3>{copy.localMonitor}</h3>
                <p className="hero-copy">{copy.localMonitorCopy}</p>
              </div>
              <div className="stack tight">
                <span className={`pill ${monitorStreamState === "live" ? "pill-primary" : ""}`}>
                  {monitorStreamState === "live" ? copy.localMonitorLive : monitorStreamState === "reconnecting" ? copy.localMonitorReconnect : copy.localMonitorPending}
                </span>
                <p className="muted-text">
                  {localAgentMonitor?.scannedAt
                    ? `${copy.localMonitorScannedAt} · ${formatTime(localAgentMonitor.scannedAt, locale)}`
                    : copy.localMonitorPending}
                </p>
              </div>
            </div>

            <div className="metric-inline-grid">
              <MetricInline label={copy.totalSessions} value={formatNumber(monitorSessions.length)} />
              <MetricInline label={copy.activeSessions} value={formatNumber(activeSessionCount)} />
              <MetricInline label={copy.totalTokens} value={formatNumber(totalUsage.totalTokens)} />
              <MetricInline label={copy.knownCost} value={formatUsd(totalUsage.knownCostUsd)} />
              <MetricInline label={copy.estimatedCost} value={formatUsd(totalUsage.estimatedCostUsd)} />
            </div>

            <div className="system-monitor-grid">
              <div className="sub-card">
                <p className="group-title">{copy.governanceTitle}</p>
                <p className="muted-text">{copy.governanceCopy}</p>
                <div className="usage-kpi-grid">
                  <UsageStat label={copy.inputTokens} value={formatNumber(totalUsage.inputTokens)} />
                  <UsageStat label={copy.cachedTokens} value={formatNumber(totalUsage.cachedInputTokens)} />
                  <UsageStat label={copy.outputTokens} value={formatNumber(totalUsage.outputTokens)} />
                </div>
                <div className="stack tight">
                  <div className="meta-chip">
                    <span>{copy.knownCost}</span>
                    <strong>{formatUsd(totalUsage.knownCostUsd)}</strong>
                  </div>
                  <div className="meta-chip">
                    <span>{copy.estimatedCost}</span>
                    <strong>{formatUsd(totalUsage.estimatedCostUsd)}</strong>
                  </div>
                </div>
              </div>

              <div className="sub-card">
                <p className="group-title">{copy.monitorRoots}</p>
                <div className="stack tight">
                  {(localAgentMonitor?.tools ?? []).map((tool) => (
                    <div key={tool.tool} className="meta-chip">
                      <span>{tool.label}</span>
                      <strong>{tool.rootPath}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="stack tight">
              <p className="group-title">{copy.toolBreakdown}</p>
              <div className="usage-tool-grid">
                {(localAgentMonitor?.tools ?? []).map((tool) => (
                  <ToolUsageCard key={tool.tool} tool={tool} isEnglish={isEnglish} />
                ))}
              </div>
            </div>

            <div className="stack tight">
              <p className="group-title">{copy.recentSessions}</p>
            </div>

            <div className="timeline-list">
              {(localAgentMonitor?.sessions ?? []).slice(0, 8).map((session) => (
                <LocalSessionCard key={session.id} session={session} isEnglish={isEnglish} copy={copy} />
              ))}
              {(localAgentMonitor?.sessions.length ?? 0) === 0 ? (
                <p className="muted-text">
                  {isEnglish ? "No recent local AI sessions were detected under the configured roots." : "当前在监控根目录下还没有发现新的本地 AI 会话。"}
                </p>
              ) : null}
            </div>
          </article>

          <article className="card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Audit Trail</p>
                <h3>{copy.recentAudit}</h3>
              </div>
            </div>

            <div className="timeline-list">
              {auditLogs.map((item) => (
                <article key={item.id} className="timeline-item">
                  <div className="timeline-time">{formatTime(item.createdAt, locale)}</div>
                  <div>
                    <div className="timeline-head">
                      <strong>{item.summary}</strong>
                      <span className="pill">{item.action}</span>
                    </div>
                    <p>
                      {item.actorLabel} · {item.resourceType}
                      {item.resourceId ? ` · ${item.resourceId}` : ""}
                    </p>
                    {item.detail ? <p>{item.detail}</p> : null}
                  </div>
                </article>
              ))}
              {auditLogs.length === 0 ? <p className="muted-text">{copy.noAudit}</p> : null}
            </div>
          </article>
        </div>

        <aside className="operations-side">
          <article className="card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Readiness</p>
                <h3>{copy.readiness}</h3>
              </div>
              <span className="pill">{readiness?.warnings.length ?? 0}</span>
            </div>

            <div className="stack tight">
              <div className="meta-chip">
                <span>{copy.dbPath}</span>
                <strong>{readiness?.database.path || readiness?.database.url || "-"}</strong>
              </div>
              <div className="meta-chip">
                <span>{copy.openclawConfig}</span>
                <strong>{readiness?.openclaw.configPath ?? "-"}</strong>
              </div>
              <div className="meta-chip">
                <span>{copy.workspaceRoot}</span>
                <strong>{readiness?.openclaw.workspaceRoot ?? "-"}</strong>
              </div>
            </div>

            <div className="metric-inline-grid">
              <MetricInline label={isEnglish ? "Managed agents" : "受管 Agent"} value={String(readiness?.database.managedAgentCount ?? 0)} />
              <MetricInline label={isEnglish ? "Memory rows" : "记忆条目"} value={String(readiness?.database.memoryEntryCount ?? 0)} />
              <MetricInline label={isEnglish ? "Usage logs" : "调用日志"} value={String(readiness?.database.usageLogCount ?? 0)} />
            </div>

            <div className="attention-list">
              {(readiness?.warnings.length ? readiness.warnings : [isEnglish ? "No readiness warnings were detected." : "当前没有发现新的平台就绪度风险。"]).map((item) => (
                <ChecklistItem
                  key={item}
                  title={readiness?.warnings.length ? copy.warnings : copy.readinessOk}
                  detail={item}
                  ok={!readiness?.warnings.length}
                />
              ))}
            </div>
          </article>

          <article className="card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Service Health</p>
                <h3>{copy.serviceHealth}</h3>
              </div>
            </div>

            <div className="agent-mini-list">
              {health?.services.map((service) => (
                <div key={service.name} className="agent-mini-card">
                  <div>
                    <strong>{service.name}</strong>
                    <p>{service.detail}</p>
                  </div>
                  <span className={`status-badge status-${service.status === "healthy" ? "completed" : "paused"}`}>
                    {service.status}
                  </span>
                </div>
              ))}
            </div>
          </article>

          <article className="card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Release Checklist</p>
                <h3>{copy.releaseChecklist}</h3>
              </div>
            </div>
            <p className="hero-copy">{copy.releaseChecklistCopy}</p>

            <div className="attention-list">
              <ChecklistItem
                title={copy.databaseHealth}
                detail={`${health?.services.find((item) => item.name === "database")?.detail ?? copy.pendingCheck}${readiness?.database.path ? ` · ${readiness.database.path}` : ""}`}
                ok={health?.services.find((item) => item.name === "database")?.status === "healthy" && Boolean(readiness?.database.exists)}
              />
              <ChecklistItem
                title={copy.runtimeReady}
                detail={
                  runtime?.mode === "openai-compatible"
                    ? `${copy.connectedModel}: ${runtime.modelName}`
                    : copy.scriptedModeDetail
                }
                ok={runtime?.mode === "openai-compatible"}
              />
              <ChecklistItem
                title={copy.openclawReady}
                detail={`config=${readiness?.openclaw.configExists ? "ok" : "missing"} · workspace=${readiness?.openclaw.workspaceExists ? "ok" : "missing"} · agents=${readiness?.openclaw.liveWorkspaceAgentCount ?? 0}`}
                ok={Boolean(readiness?.openclaw.configExists && readiness?.openclaw.workspaceExists && (readiness?.openclaw.liveWorkspaceAgentCount ?? 0) > 0)}
              />
              <ChecklistItem
                title={copy.taskObservability}
                detail={copy.observabilityDetail(
                  health?.activeTasks ?? 0,
                  health?.blockedTasks ?? 0,
                  readiness?.openclaw.liveWorkspaceProjectCount ?? 0
                )}
                ok={(health?.blockedTasks ?? 0) === 0 && (readiness?.openclaw.liveWorkspaceProjectCount ?? 0) > 0}
              />
            </div>
          </article>
        </aside>
      </section>
    </div>
  );
}

function MetricTile({
  label,
  value,
  tone = "default"
}: {
  label: string;
  value: string;
  tone?: "default" | "warning";
}) {
  return (
    <div className={`metric-card metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MetricInline({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-inline-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ChecklistItem({ title, detail, ok }: { title: string; detail: string; ok: boolean }) {
  return (
    <article className={ok ? "attention-card" : "attention-card attention-warning"}>
      <strong>{title}</strong>
      <p>{detail}</p>
    </article>
  );
}

function UsageStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="attention-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ToolUsageCard({
  tool,
  isEnglish
}: {
  tool: LocalAgentToolSummary;
  isEnglish: boolean;
}) {
  return (
    <article className="attention-card">
      <div className="timeline-head">
        <strong>{tool.label}</strong>
        <span className={`pill ${tool.activeCount > 0 ? "pill-primary" : ""}`}>
          {tool.sessionCount} · {tool.activeCount}/{tool.idleCount}/{tool.staleCount}
        </span>
      </div>
      <div className="usage-kpi-grid">
        <UsageStat label={isEnglish ? "Tokens" : "Token"} value={formatNumber(tool.usage.totalTokens)} />
        <UsageStat label={isEnglish ? "Known" : "已知"} value={formatUsd(tool.usage.knownCostUsd)} />
        <UsageStat label={isEnglish ? "Estimate" : "估算"} value={formatUsd(tool.usage.estimatedCostUsd)} />
      </div>
      <p className="muted-text">{tool.rootPath}</p>
      <p className="muted-text">
        {isEnglish ? "Last updated" : "最近更新"}: {tool.lastUpdatedAt ? formatTime(tool.lastUpdatedAt, isEnglish ? "en-US" : "zh-CN") : "-"}
      </p>
    </article>
  );
}

function LocalSessionCard({
  session,
  isEnglish,
  copy
}: {
  session: LocalAgentSessionItem;
  isEnglish: boolean;
  copy: {
    sessionStatus: Record<LocalAgentSessionItem["status"], string>;
    noCost: string;
    unknownModel: string;
  };
}) {
  const toolLabel = session.tool === "claude"
    ? "Claude"
    : session.tool === "codex"
      ? "Codex"
      : "OpenClaw";
  const statusLabel = copy.sessionStatus[session.status];
  const costLabel = session.usage.knownCostUsd > 0
    ? formatUsd(session.usage.knownCostUsd)
    : session.usage.estimatedCostUsd > 0
      ? `~${formatUsd(session.usage.estimatedCostUsd)}`
      : copy.noCost;

  return (
    <article className="timeline-item">
      <div className="timeline-time">{formatTime(session.updatedAt, isEnglish ? "en-US" : "zh-CN")}</div>
      <div>
        <div className="timeline-head">
          <strong>{session.title}</strong>
          <span className={`pill ${session.status === "active" ? "pill-primary" : ""}`}>{toolLabel} · {statusLabel}</span>
        </div>
        <p>{session.projectLabel || session.path}</p>
        <p>
          {session.model || copy.unknownModel} · {formatNumber(session.usage.totalTokens)} {isEnglish ? "tokens" : "token"} · {costLabel}
        </p>
        {session.lastMessage ? <p>{session.lastMessage}</p> : null}
      </div>
    </article>
  );
}

function formatTime(timestamp: string, locale = "zh-CN") {
  return new Date(timestamp).toLocaleString(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value > 0 && value < 1 ? 4 : 2,
    maximumFractionDigits: value > 0 && value < 1 ? 4 : 2
  }).format(value);
}
