import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { OpenClawWorkspaceOverview, RuntimeSettings, RuntimeStatus, SystemReadiness } from "@occ/shared";
import { api } from "../lib/api";
import { useLocale } from "../lib/locale";

export function SettingsPage() {
  const { locale, setLocale, isEnglish } = useLocale();
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [readiness, setReadiness] = useState<SystemReadiness | null>(null);
  const [workspace, setWorkspace] = useState<OpenClawWorkspaceOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const copy = isEnglish
    ? {
        title: "Operator preferences and workspace defaults",
        hero: "This page keeps language, runtime defaults, and production readiness in one operator-friendly surface instead of a dead-end settings page.",
        language: "Language",
        workspaceRoot: "Workspace root",
        defaultProvider: "Default runtime provider",
        defaultModel: "Default runtime model",
        apiKey: "API key status",
        configured: "Configured",
        notConfigured: "Not configured",
        refresh: "Refresh",
        runtimeMode: "Runtime mode",
        validation: "Validation",
        workspaceStats: "Workspace activity",
        quickActions: "Operator shortcuts",
        quickActionsCopy: "Use this rail to jump from preferences directly into the operational module that needs attention.",
        openSystem: "Open operations",
        openWorkspace: "Open workspace",
        openNotifications: "Open notifications",
        readinessTitle: "Readiness snapshot",
        readinessCopy: "A fast read on whether database, runtime, and OpenClaw connectivity are in a production-usable state.",
        warnings: "Warnings",
        noWarnings: "No readiness warnings at the moment.",
        memoryEntries: "Memory entries",
        managedAgents: "Managed agents",
        usageLogs: "Usage logs",
        validationPending: "Not validated",
        projects: "Projects",
        agents: "Agents",
        sessions: "Sessions"
      }
    : {
        title: "操作偏好与工作区默认设置",
        hero: "把语言、运行默认值和生产就绪度放进同一个设置页里，避免它变成一个只能看不能用的死页面。",
        language: "语言",
        workspaceRoot: "工作区根目录",
        defaultProvider: "默认运行提供方",
        defaultModel: "默认运行模型",
        apiKey: "API Key 状态",
        configured: "已配置",
        notConfigured: "未配置",
        refresh: "刷新",
        runtimeMode: "运行模式",
        validation: "校验状态",
        workspaceStats: "工作区活动",
        quickActions: "运营快捷入口",
        quickActionsCopy: "从设置页直接跳到最相关的运营模块，而不是看完之后还要自己找页面。",
        openSystem: "进入系统运营",
        openWorkspace: "进入团队工作区",
        openNotifications: "进入通知中心",
        readinessTitle: "就绪度快照",
        readinessCopy: "快速确认数据库、运行时和 OpenClaw 连接是否已经达到可用状态。",
        warnings: "风险提示",
        noWarnings: "当前没有新的就绪度风险提示。",
        memoryEntries: "记忆条目",
        managedAgents: "受管 Agent",
        usageLogs: "使用日志",
        validationPending: "未校验",
        projects: "项目数",
        agents: "Agent 数",
        sessions: "会话数"
      };

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      setLoading(true);
      setError(null);
      const [runtimeSettings, runtimeStatus, readinessInfo, workspaceOverview] = await Promise.all([
        api.getRuntimeSettings(),
        api.getRuntime(),
        api.getSystemReadiness(),
        api.getOpenClawWorkspace()
      ]);
      setSettings(runtimeSettings);
      setRuntime(runtimeStatus);
      setReadiness(readinessInfo);
      setWorkspace(workspaceOverview);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="card">{isEnglish ? "Loading settings..." : "正在加载设置..."}</div>;
  }

  if (error) {
    return <div className="card error-text">{error}</div>;
  }

  return (
    <div className="page">
      <header className="page-header studio-page-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h2>{copy.title}</h2>
          <p className="hero-copy">{copy.hero}</p>
        </div>
        <div className="studio-header-actions">
          <span className={runtime?.mode === "openai-compatible" ? "pill pill-success" : "pill pill-warning"}>
            {runtime?.mode === "openai-compatible" ? (isEnglish ? "Runtime online" : "运行已在线") : (isEnglish ? "Fallback mode" : "回退模式")}
          </span>
          <Link className="button button-ghost inline-button" to="/system">
            {copy.openSystem}
          </Link>
          <button className="button button-ghost inline-button" onClick={() => void refresh()}>
            {copy.refresh}
          </button>
        </div>
      </header>

      <section className="studio-kpi-grid">
        <MetricInline label={copy.language} value={locale} />
        <MetricInline label={copy.runtimeMode} value={runtime?.mode ?? "-"} />
        <MetricInline label={copy.validation} value={settings?.lastValidationStatus ?? copy.validationPending} />
        <MetricInline label={copy.workspaceStats} value={`${workspace?.projects.length ?? 0} / ${workspace?.agents.length ?? 0}`} />
      </section>

      <section className="portfolio-command-grid">
        <div className="portfolio-command-main">
          <article className="card studio-command-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.language}</p>
                <h3>{locale}</h3>
              </div>
            </div>
            <div className="segmented">
              <button className={locale === "zh-CN" ? "segmented-item is-active" : "segmented-item"} onClick={() => setLocale("zh-CN")}>
                中文
              </button>
              <button className={locale === "en-US" ? "segmented-item is-active" : "segmented-item"} onClick={() => setLocale("en-US")}>
                EN
              </button>
            </div>
          </article>

          <article className="card studio-command-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.workspaceRoot}</p>
                <h3>{workspace?.rootPath}</h3>
              </div>
            </div>
            <div className="meta-strip meta-strip-compact">
              <div className="meta-chip">
                <span>{copy.projects}</span>
                <strong>{workspace?.projects.length ?? 0}</strong>
              </div>
              <div className="meta-chip">
                <span>{copy.agents}</span>
                <strong>{workspace?.agents.length ?? 0}</strong>
              </div>
              <div className="meta-chip">
                <span>{copy.sessions}</span>
                <strong>{workspace?.totalSessions ?? 0}</strong>
              </div>
            </div>
          </article>

          <article className="card studio-command-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.defaultProvider}</p>
                <h3>{settings?.provider}</h3>
              </div>
            </div>
            <div className="stack tight">
              <div className="meta-chip">
                <span>{copy.defaultModel}</span>
                <strong>{settings?.modelName || "-"}</strong>
              </div>
              <div className="meta-chip">
                <span>{copy.apiKey}</span>
                <strong>{settings?.apiKeyConfigured ? copy.configured : copy.notConfigured}</strong>
              </div>
              <div className="meta-chip">
                <span>{copy.validation}</span>
                <strong>{settings?.lastValidationStatus ?? copy.validationPending}</strong>
              </div>
            </div>
          </article>
        </div>

        <aside className="portfolio-command-rail">
          <article className="card studio-side-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.quickActions}</p>
                <h3>{copy.quickActions}</h3>
              </div>
            </div>
            <p className="hero-copy">{copy.quickActionsCopy}</p>
            <div className="stack tight">
              <Link className="button button-ghost inline-button" to="/system">
                {copy.openSystem}
              </Link>
              <Link className="button button-ghost inline-button" to="/openclaw">
                {copy.openWorkspace}
              </Link>
              <Link className="button button-ghost inline-button" to="/notifications">
                {copy.openNotifications}
              </Link>
            </div>
          </article>

          <article className="card studio-side-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.readinessTitle}</p>
                <h3>{copy.readinessTitle}</h3>
              </div>
            </div>
            <p className="hero-copy">{copy.readinessCopy}</p>
            <div className="metric-inline-grid">
              <MetricInline label={copy.managedAgents} value={String(readiness?.database.managedAgentCount ?? 0)} />
              <MetricInline label={copy.memoryEntries} value={String(readiness?.database.memoryEntryCount ?? 0)} />
              <MetricInline label={copy.usageLogs} value={String(readiness?.database.usageLogCount ?? 0)} />
            </div>
            <div className="stack tight">
              <div className="meta-chip">
                <span>{copy.runtimeMode}</span>
                <strong>{runtime?.mode ?? "-"}</strong>
              </div>
              <div className="meta-chip">
                <span>{copy.workspaceRoot}</span>
                <strong>{readiness?.openclaw.workspaceRoot ?? workspace?.rootPath ?? "-"}</strong>
              </div>
            </div>
            <div className="stack tight">
              <p className="group-title">{copy.warnings}</p>
              {readiness && readiness.warnings.length > 0 ? readiness.warnings.map((warning) => (
                <div key={warning} className="attention-card attention-warning">
                  <p>{warning}</p>
                </div>
              )) : <p className="muted-text">{copy.noWarnings}</p>}
            </div>
          </article>
        </aside>
      </section>
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
