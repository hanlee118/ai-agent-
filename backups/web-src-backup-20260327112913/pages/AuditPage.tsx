import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Search } from "lucide-react";
import type { AuditLogItem } from "@occ/shared";
import { api } from "../lib/api";
import { useLocale } from "../lib/locale";

type AuditFilter = "all" | "openclaw" | "projects" | "system" | "auth";

export function AuditPage() {
  const { isEnglish, locale } = useLocale();
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [filter, setFilter] = useState<AuditFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const copy = isEnglish
    ? {
        title: "Audit trail and operator activity",
        hero: "Every critical action should be visible here: auth, runtime changes, project approvals, document updates, and agent commands.",
        refresh: "Refresh logs",
        search: "Search by action, summary, actor, or resource",
        event: "Event",
        operator: "Operator",
        action: "Action",
        details: "Details",
        resource: "Resource",
        time: "Time",
        empty: "No audit logs match the current search.",
        all: "All",
        openclaw: "OpenClaw",
        projects: "Projects",
        system: "System",
        auth: "Auth",
        totalLogs: "Events",
        openclawLogs: "Workspace",
        projectLogs: "Project flow",
        systemLogs: "System",
        railTitle: "Audit operators",
        railCopy: "Use this rail to jump straight from governance review to the module most likely to need action.",
        quickNotifications: "Open notifications",
        quickSystem: "Open operations",
        quickWorkspace: "Open workspace",
        noDetails: "No extra detail captured.",
        exportCsv: "Export CSV"
      }
    : {
        title: "审计轨迹与操作活动",
        hero: "这里应当能看到所有关键动作，包括登录、运行配置、项目审批、文档更新和 Agent 指令下发。",
        refresh: "刷新日志",
        search: "按动作、摘要、操作者或资源搜索",
        event: "事件",
        operator: "操作者",
        action: "动作",
        details: "详情",
        resource: "资源",
        time: "时间",
        empty: "当前搜索条件下没有审计日志。",
        all: "全部",
        openclaw: "OpenClaw",
        projects: "项目流",
        system: "系统",
        auth: "认证",
        totalLogs: "事件总数",
        openclawLogs: "工作区",
        projectLogs: "项目主链路",
        systemLogs: "系统配置",
        railTitle: "治理联动入口",
        railCopy: "右侧栏直接给出最可能需要处理的模块入口，避免看完审计还要自己找页面。",
        quickNotifications: "进入通知中心",
        quickSystem: "进入系统运营",
        quickWorkspace: "进入团队工作区",
        noDetails: "没有记录额外详情。",
        exportCsv: "导出 CSV"
      };

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      setLoading(true);
      setError(null);
      setLogs(await api.getAuditLogs(80));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  const visibleLogs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return logs.filter((log) => matchesAuditFilter(log, filter));
    }

    return logs.filter((log) => {
      if (!matchesAuditFilter(log, filter)) {
        return false;
      }
      const text = `${log.action} ${log.summary} ${log.actorLabel} ${log.resourceType} ${log.detail || ""}`.toLowerCase();
      return text.includes(normalizedQuery);
    });
  }, [filter, logs, query]);

  const summary = useMemo(
    () => ({
      total: logs.length,
      openclaw: logs.filter((log) => log.action.startsWith("openclaw.")).length,
      projects: logs.filter((log) => log.action.startsWith("project.")).length,
      system: logs.filter((log) => log.action.startsWith("system.")).length
    }),
    [logs]
  );

  function handleExportCsv() {
    const rows = [
      ["id", "action", "summary", "actorLabel", "actorType", "resourceType", "resourceId", "detail", "createdAt"],
      ...visibleLogs.map((log) => [
        log.id,
        log.action,
        log.summary,
        log.actorLabel,
        log.actorType,
        log.resourceType,
        log.resourceId ?? "",
        log.detail ?? "",
        log.createdAt
      ])
    ];

    const csv = rows
      .map((row) =>
        row
          .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
          .join(",")
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `audit-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return <div className="card">{isEnglish ? "Loading audit logs..." : "正在加载审计日志..."}</div>;
  }

  if (error) {
    return <div className="card error-text">{error}</div>;
  }

  return (
    <div className="page">
      <header className="page-header studio-page-header">
        <div>
          <p className="eyebrow">Audit Trail</p>
          <h2>{copy.title}</h2>
          <p className="hero-copy">{copy.hero}</p>
        </div>
        <div className="studio-header-actions">
          <button className="button button-ghost inline-button" onClick={handleExportCsv}>
            <Download size={16} />
            {copy.exportCsv}
          </button>
          <Link className="button button-ghost inline-button" to="/notifications">
            {copy.quickNotifications}
          </Link>
          <button className="button button-ghost" onClick={() => void refresh()}>
            {copy.refresh}
          </button>
        </div>
      </header>

      <section className="studio-kpi-grid">
        <MetricInline label={copy.totalLogs} value={String(summary.total)} />
        <MetricInline label={copy.openclawLogs} value={String(summary.openclaw)} />
        <MetricInline label={copy.projectLogs} value={String(summary.projects)} />
        <MetricInline label={copy.systemLogs} value={String(summary.system)} />
      </section>

      <section className="portfolio-command-grid">
        <div className="portfolio-command-main">
          <article className="card studio-command-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.event}</p>
                <h3>{copy.title}</h3>
              </div>
            </div>
            <div className="dashboard-hero-context audit-context-grid">
              <div className="dashboard-hero-context-card">
                <span>{copy.totalLogs}</span>
                <strong>{summary.total}</strong>
                <p>{isEnglish ? "A single governance stream for auth, runtime, project, and workspace operations." : "把认证、运行配置、项目流和工作区操作汇总成一条统一治理轨迹。"} </p>
              </div>
              <div className="dashboard-hero-context-card">
                <span>{copy.openclawLogs}</span>
                <strong>{summary.openclaw}</strong>
                <p>{isEnglish ? "Workspace events help explain what actually happened inside live OpenClaw operations." : "工作区事件用于解释真实 OpenClaw 运行过程里到底发生了什么。"} </p>
              </div>
              <div className="dashboard-hero-context-card">
                <span>{copy.systemLogs}</span>
                <strong>{summary.system}</strong>
                <p>{isEnglish ? "System actions show runtime, settings, and infrastructure-facing changes." : "系统类动作用于呈现运行模式、配置和基础设施相关变更。"} </p>
              </div>
            </div>
            <label className="studio-search-field" aria-label={copy.search}>
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={copy.search}
              />
            </label>
            <div className="pill-row">
              {(["all", "openclaw", "projects", "system", "auth"] as AuditFilter[]).map((item) => (
                <button
                  key={item}
                  className={filter === item ? "filter-pill filter-pill-active" : "filter-pill"}
                  onClick={() => setFilter(item)}
                >
                  {copy[item]}
                </button>
              ))}
            </div>
          </article>

          <section className="audit-table-card">
            <div className="audit-table-header">
              <span>{copy.event}</span>
              <span>{copy.operator}</span>
              <span>{copy.action}</span>
              <span>{copy.details}</span>
              <span>{copy.resource}</span>
              <span>{copy.time}</span>
            </div>

            <div className="audit-table-body">
              {visibleLogs.map((log) => (
                <div className="audit-table-row" key={log.id}>
                  <div className="audit-cell audit-event">
                    <strong>{log.action}</strong>
                    <p>{log.summary}</p>
                  </div>
                  <div className="audit-cell">
                    <strong>{log.actorLabel}</strong>
                    <p>{log.actorType}</p>
                  </div>
                  <div className="audit-cell">
                    <span className="pill">{getAuditFamilyLabel(log.action, copy)}</span>
                  </div>
                  <div className="audit-cell">
                    <p>{log.detail || copy.noDetails}</p>
                  </div>
                  <div className="audit-cell">
                    <strong>{log.resourceType}</strong>
                    <p>{log.resourceId || "-"}</p>
                  </div>
                  <div className="audit-cell">
                    <span className="muted-text">{formatTime(log.createdAt, locale)}</span>
                  </div>
                </div>
              ))}

              {visibleLogs.length === 0 ? <div className="card muted-text">{copy.empty}</div> : null}
            </div>
          </section>
        </div>

        <aside className="portfolio-command-rail">
          <article className="card studio-side-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.railTitle}</p>
                <h3>{copy.railTitle}</h3>
              </div>
              <span className="pill">{visibleLogs.length}</span>
            </div>
            <p className="dashboard-rail-copy">{copy.railCopy}</p>
            <div className="stack tight">
              <Link className="button button-ghost inline-button" to="/notifications">
                {copy.quickNotifications}
              </Link>
              <Link className="button button-ghost inline-button" to="/system">
                {copy.quickSystem}
              </Link>
              <Link className="button button-ghost inline-button" to="/openclaw">
                {copy.quickWorkspace}
              </Link>
            </div>
          </article>

          <article className="card studio-side-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.action}</p>
                <h3>{isEnglish ? "Latest critical flow" : "最近关键链路"}</h3>
              </div>
              <span className="pill">{logs.slice(0, 6).length}</span>
            </div>
            <p className="dashboard-rail-copy">
              {isEnglish
                ? "This right rail keeps the most recent governance chain visible, so you can inspect flow before jumping into another module."
                : "右侧栏保留最近关键治理链路，让你在跳转其他模块前先读清楚上下文。"}
            </p>
            <div className="timeline-list">
              {logs.slice(0, 6).map((item) => (
                <article key={item.id} className="timeline-item">
                  <div className="timeline-time">{formatTime(item.createdAt, locale)}</div>
                  <div>
                    <div className="timeline-head">
                      <strong>{item.summary}</strong>
                      <span className="pill">{getAuditFamilyLabel(item.action, copy)}</span>
                    </div>
                    <p>
                      {item.actorLabel} · {item.resourceType}
                      {item.resourceId ? ` · ${item.resourceId}` : ""}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </article>
        </aside>
      </section>
    </div>
  );
}

function matchesAuditFilter(log: AuditLogItem, filter: AuditFilter) {
  if (filter === "all") {
    return true;
  }

  if (filter === "auth") {
    return log.action.startsWith("auth.");
  }

  if (filter === "projects") {
    return log.action.startsWith("project.");
  }

  if (filter === "system") {
    return log.action.startsWith("system.");
  }

  return log.action.startsWith("openclaw.");
}

function getAuditFamilyLabel(logAction: string, copy: Record<AuditFilter, string>) {
  if (logAction.startsWith("auth.")) {
    return copy.auth;
  }
  if (logAction.startsWith("project.")) {
    return copy.projects;
  }
  if (logAction.startsWith("system.")) {
    return copy.system;
  }
  if (logAction.startsWith("openclaw.")) {
    return copy.openclaw;
  }
  return copy.all;
}

function formatTime(timestamp: string, locale = "zh-CN") {
  return new Date(timestamp).toLocaleString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function MetricInline({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-inline-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
