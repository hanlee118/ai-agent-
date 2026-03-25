import { useEffect, useState } from "react";
import type {
  AuditLogItem,
  LocalAgentMonitorOverview,
  LocalAgentSessionItem,
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

export function SystemPage() {
  const { isEnglish } = useLocale();
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [localAgentMonitor, setLocalAgentMonitor] = useState<LocalAgentMonitorOverview | null>(null);
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
        monitorRoots: "Monitor Roots",
        recentSessions: "Recent Sessions",
        dbPath: "Database path",
        openclawConfig: "OpenClaw config",
        workspaceRoot: "Workspace root",
        warnings: "Warnings"
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
        monitorRoots: "监控根目录",
        recentSessions: "最近会话",
        dbPath: "数据库路径",
        openclawConfig: "OpenClaw 配置",
        workspaceRoot: "工作区根目录",
        warnings: "风险提示"
      };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh({ silent: true });
    }, 15000);

    return () => window.clearInterval(timer);
  }, []);

  async function refresh(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const [healthInfo, runtimeInfo, settingsInfo, auditInfo, readinessInfo, monitorInfo] = await Promise.all([
        api.getSystemHealth(),
        api.getRuntime(),
        api.getRuntimeSettings(),
        api.getAuditLogs(20),
        api.getSystemReadiness(),
        api.getLocalAgentMonitor()
      ]);

      setHealth(healthInfo);
      setRuntime(runtimeInfo);
      setSettings(settingsInfo);
      setAuditLogs(auditInfo);
      setReadiness(readinessInfo);
      setLocalAgentMonitor(monitorInfo);
      syncForm(settingsInfo);
      setFlash(null);
    } catch (requestError) {
      setFlash({
        tone: "error",
        message: requestError instanceof Error ? requestError.message : "系统配置加载失败"
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
      setFlash({ tone: "success", message: "运行配置已保存。" });
    } catch (requestError) {
      setFlash({
        tone: "error",
        message: requestError instanceof Error ? requestError.message : "保存配置失败"
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
        message: requestError instanceof Error ? requestError.message : "运行配置校验失败"
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
    return <div className="card">正在加载系统运营页...</div>;
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

      <section className="system-grid">
        <article className="card">
          <div className="section-header">
              <div>
                <p className="eyebrow">Runtime Config</p>
                <h3>{copy.runtimeConfig}</h3>
              </div>
            </div>

          <div className="form-grid">
            <label className="form-field">
              <span>运行模式</span>
              <select value={provider} onChange={(event) => setProvider(event.target.value as RuntimeMode)}>
                <option value="scripted">scripted</option>
                <option value="openai-compatible">openai-compatible</option>
              </select>
            </label>

            <label className="form-field">
              <span>API Base URL</span>
              <input
                value={apiBaseUrl}
                onChange={(event) => setApiBaseUrl(event.target.value)}
                placeholder="https://api.example.com/v1"
              />
            </label>

            <label className="form-field">
              <span>模型名称</span>
              <input
                value={modelName}
                onChange={(event) => setModelName(event.target.value)}
                placeholder="gpt-4.1 / qwen-max / deepseek-chat"
              />
            </label>

            <label className="form-field">
              <span>API Key</span>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  if (event.target.value) {
                    setClearApiKey(false);
                  }
                }}
                placeholder={settings?.apiKeyConfigured ? `已配置：${settings.apiKeyPreview}` : "输入新的 API Key"}
              />
            </label>
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={clearApiKey}
              onChange={(event) => setClearApiKey(event.target.checked)}
            />
            <span>清除当前 API Key</span>
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
            <p className="group-title">当前配置摘要</p>
            <p>已配置 API Key：{settings?.apiKeyConfigured ? settings.apiKeyPreview : "否"}</p>
            <p>最近更新时间：{settings?.updatedAt ? formatTime(settings.updatedAt) : "暂无"}</p>
            <p>最近校验时间：{settings?.lastValidatedAt ? formatTime(settings.lastValidatedAt) : "尚未校验"}</p>
            <p>最近校验结果：{settings?.lastValidationError ?? settings?.lastValidationStatus ?? "unknown"}</p>
          </div>
        </article>

        <div className="stack">
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
                  title={readiness?.warnings.length ? copy.warnings : (isEnglish ? "Ready" : "就绪")}
                  detail={item}
                  ok={!readiness?.warnings.length}
                />
              ))}
            </div>
          </article>

          <article className="card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Local Monitor</p>
                <h3>{copy.localMonitor}</h3>
                <p className="hero-copy">{copy.localMonitorCopy}</p>
              </div>
            </div>

            <div className="metric-inline-grid">
              {(localAgentMonitor?.tools ?? []).map((tool) => (
                <MetricInline
                  key={tool.tool}
                  label={tool.label}
                  value={`${tool.sessionCount} · ${tool.activeCount}/${tool.idleCount}/${tool.staleCount}`}
                />
              ))}
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

            <div className="timeline-list">
              {(localAgentMonitor?.sessions ?? []).slice(0, 8).map((session) => (
                <LocalSessionCard key={session.id} session={session} isEnglish={isEnglish} />
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
                <h3>发布前检查</h3>
              </div>
            </div>

            <div className="attention-list">
              <ChecklistItem
                title="数据库健康"
                detail={`${health?.services.find((item) => item.name === "database")?.detail ?? "待检查"}${readiness?.database.path ? ` · ${readiness.database.path}` : ""}`}
                ok={health?.services.find((item) => item.name === "database")?.status === "healthy" && Boolean(readiness?.database.exists)}
              />
              <ChecklistItem
                title="运行模式可用"
                detail={
                  runtime?.mode === "openai-compatible"
                    ? `当前已连接真实模型：${runtime.modelName}`
                    : "当前仍在脚本模式，可继续演示但不建议作为最终生产配置。"
                }
                ok={runtime?.mode === "openai-compatible"}
              />
              <ChecklistItem
                title="OpenClaw 已接通"
                detail={`config=${readiness?.openclaw.configExists ? "ok" : "missing"} · workspace=${readiness?.openclaw.workspaceExists ? "ok" : "missing"} · agents=${readiness?.openclaw.liveWorkspaceAgentCount ?? 0}`}
                ok={Boolean(readiness?.openclaw.configExists && readiness?.openclaw.workspaceExists && (readiness?.openclaw.liveWorkspaceAgentCount ?? 0) > 0)}
              />
              <ChecklistItem
                title="任务体系可观测"
                detail={`当前共有 ${health?.activeTasks ?? 0} 个活动任务，${health?.blockedTasks ?? 0} 个阻塞任务，OpenClaw 项目 ${readiness?.openclaw.liveWorkspaceProjectCount ?? 0} 个。`}
                ok={(health?.blockedTasks ?? 0) === 0 && (readiness?.openclaw.liveWorkspaceProjectCount ?? 0) > 0}
              />
            </div>
          </article>

          <article className="card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Audit Trail</p>
                <h3>最近操作记录</h3>
              </div>
            </div>

            <div className="timeline-list">
              {auditLogs.map((item) => (
                <article key={item.id} className="timeline-item">
                  <div className="timeline-time">{formatTime(item.createdAt)}</div>
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
              {auditLogs.length === 0 ? <p className="muted-text">当前还没有审计记录。</p> : null}
            </div>
          </article>
        </div>
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

function LocalSessionCard({
  session,
  isEnglish
}: {
  session: LocalAgentSessionItem;
  isEnglish: boolean;
}) {
  const toolLabel = session.tool === "claude"
    ? "Claude"
    : session.tool === "codex"
      ? "Codex"
      : "OpenClaw";
  const statusLabel = isEnglish
    ? session.status
    : session.status === "active"
      ? "活跃"
      : session.status === "idle"
        ? "空闲"
        : "静默";

  return (
    <article className="timeline-item">
      <div className="timeline-time">{formatTime(session.updatedAt)}</div>
      <div>
        <div className="timeline-head">
          <strong>{session.title}</strong>
          <span className={`pill ${session.status === "active" ? "pill-primary" : ""}`}>{toolLabel} · {statusLabel}</span>
        </div>
        <p>{session.projectLabel || session.path}</p>
        {session.lastMessage ? <p>{session.lastMessage}</p> : null}
      </div>
    </article>
  );
}

function formatTime(timestamp: string) {
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
