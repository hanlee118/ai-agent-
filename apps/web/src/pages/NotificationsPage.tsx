import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import type { AuditLogItem, NotificationInboxItem, SystemHealth } from "@occ/shared";
import { api } from "../lib/api";
import { useLocale } from "../lib/locale";

type SeverityFilter = "all" | "critical" | "warning" | "info";

export function NotificationsPage() {
  const { isEnglish, locale } = useLocale();
  const [items, setItems] = useState<NotificationInboxItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [filter, setFilter] = useState<SeverityFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const copy = isEnglish
    ? {
        title: "Notification center",
        hero: "One operator inbox for runtime risk, approval backlog, blocked work, overloaded agents, and notable governance events.",
        refresh: "Refresh",
        search: "Search alerts, audit events, projects, or agents",
        all: "All",
        critical: "Critical",
        warning: "Warning",
        info: "Info",
        feedTitle: "Operator inbox",
        feedCopy: "This page turns platform status into actionable notifications instead of making you infer urgency from raw data.",
        empty: "No notifications match the current filters.",
        summaryTitle: "Signal summary",
        summaryCopy: "Use this rail to understand where the platform needs action first.",
        criticalCount: "Critical",
        warningCount: "Warnings",
        infoCount: "Info",
        approvals: "Approvals",
        action: "Open",
        markRead: "Mark read",
        assignMe: "Assign me",
        confirmMe: "Confirm by me",
        unread: "Unread",
        read: "Read",
        assigned: "Assigned",
        confirmed: "Confirmed",
        resolved: "Resolved",
        latestAudit: "Recent governance",
        noAudit: "No recent audit events."
      }
    : {
        title: "通知中心",
        hero: "把运行风险、审批积压、阻塞任务、Agent 负载和关键治理事件统一收敛成一个运营收件箱。",
        refresh: "刷新",
        search: "搜索告警、审计事件、项目或 Agent",
        all: "全部",
        critical: "严重",
        warning: "提醒",
        info: "信息",
        feedTitle: "运营收件箱",
        feedCopy: "这里不再让你从原始数据中自己推断优先级，而是直接把平台状态整理成可行动的通知。",
        empty: "当前筛选条件下没有通知。",
        summaryTitle: "信号摘要",
        summaryCopy: "通过右侧栏快速判断平台最需要处理的事项。",
        criticalCount: "严重",
        warningCount: "提醒",
        infoCount: "信息",
        approvals: "待审批",
        action: "打开",
        markRead: "标记已读",
        assignMe: "指派给我",
        confirmMe: "由我确认",
        unread: "未读",
        read: "已读",
        assigned: "已指派",
        confirmed: "已确认",
        resolved: "已解决",
        latestAudit: "最近治理记录",
        noAudit: "最近没有新的审计事件。"
      };

  useEffect(() => {
    void refresh();
  }, [locale]);

  async function refresh() {
    try {
      setLoading(true);
      setError(null);
      const [notificationList, auditList, healthInfo] = await Promise.all([
        api.getNotifications(locale),
        api.getAuditLogs(12),
        api.getSystemHealth()
      ]);
      setItems(notificationList);
      setAuditLogs(auditList);
      setHealth(healthInfo);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : (isEnglish ? "Failed to load notifications" : "加载通知失败"));
    } finally {
      setLoading(false);
    }
  }

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      if (filter !== "all" && item.severity !== filter) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return `${item.title} ${item.detail} ${item.category}`.toLowerCase().includes(normalizedQuery);
    });
  }, [filter, items, query]);

  const counts = useMemo(
    () => ({
      critical: items.filter((item) => item.severity === "critical").length,
      warning: items.filter((item) => item.severity === "warning").length,
      info: items.filter((item) => item.severity === "info").length,
      approvals: items.filter((item) => item.category === (isEnglish ? "Approval" : "审批")).length
    }),
    [isEnglish, items]
  );

  async function patchItem(sourceKey: string, patch: { read?: boolean; assignedTo?: string | null; confirmedBy?: string | null; workflowStatus?: "open" | "acknowledged" | "resolved" }) {
    const updated = await api.updateNotification(sourceKey, patch);
    setItems((current) => current.map((item) => (item.sourceKey === sourceKey ? updated : item)));
  }

  if (loading) {
    return <div className="card">{isEnglish ? "Loading notifications..." : "正在加载通知..."}</div>;
  }

  if (error) {
    return <div className="card error-text">{error}</div>;
  }

  return (
    <div className="page">
      <header className="page-header studio-page-header">
        <div>
          <p className="eyebrow">Notification Center</p>
          <h2>{copy.title}</h2>
          <p className="hero-copy">{copy.hero}</p>
        </div>
        <div className="studio-header-actions">
          <label className="studio-search-field" aria-label={copy.search}>
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} />
          </label>
          <button className="button button-ghost inline-button" onClick={() => void refresh()}>
            {copy.refresh}
          </button>
        </div>
      </header>

      <section className="studio-kpi-grid">
        <MetricInline label={copy.criticalCount} value={String(counts.critical)} />
        <MetricInline label={copy.warningCount} value={String(counts.warning)} />
        <MetricInline label={copy.infoCount} value={String(counts.info)} />
        <MetricInline label={copy.approvals} value={String(counts.approvals)} />
      </section>

      <section className="portfolio-command-grid">
        <div className="portfolio-command-main">
          <article className="card studio-command-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.feedTitle}</p>
                <h3>{copy.feedTitle}</h3>
                <p className="hero-copy">{copy.feedCopy}</p>
              </div>
              <span className="pill pill-primary">{filteredItems.length}</span>
            </div>
            <div className="pill-row">
              {(["all", "critical", "warning", "info"] as SeverityFilter[]).map((item) => (
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

          <div className="notification-feed">
            {filteredItems.map((item) => (
              <article key={item.id} className={`notification-card notification-${item.severity}`}>
                <div className="notification-main">
                  <div className="timeline-head">
                    <div className="pill-row">
                      <span className={`pill ${item.severity === "critical" ? "pill-danger" : item.severity === "warning" ? "pill-warning" : "pill-primary"}`}>
                        {item.category}
                      </span>
                      <span className="status-badge status-working">{copy[item.severity]}</span>
                      <span className={item.read ? "pill pill-success" : "pill"}>{item.read ? copy.read : copy.unread}</span>
                      {item.assignedTo ? <span className="pill">{copy.assigned}: {item.assignedTo}</span> : null}
                      {item.confirmedBy ? <span className="pill pill-primary">{copy.confirmed}: {item.confirmedBy}</span> : null}
                      {item.workflowStatus === "resolved" ? <span className="pill pill-success">{copy.resolved}</span> : null}
                    </div>
                    {item.timestamp ? <span className="timeline-time">{formatTime(item.timestamp, locale)}</span> : null}
                  </div>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                  <div className="pill-row">
                    <button className="button button-ghost inline-button" onClick={() => void patchItem(item.sourceKey, { read: true })}>
                      {copy.markRead}
                    </button>
                    <button className="button button-ghost inline-button" onClick={() => void patchItem(item.sourceKey, { assignedTo: "Commander", workflowStatus: "acknowledged" })}>
                      {copy.assignMe}
                    </button>
                    <button className="button button-ghost inline-button" onClick={() => void patchItem(item.sourceKey, { confirmedBy: "Commander", read: true, workflowStatus: "resolved" })}>
                      {copy.confirmMe}
                    </button>
                  </div>
                </div>
                <Link className="button button-primary inline-button" to={item.to}>
                  {item.actionLabel}
                </Link>
              </article>
            ))}
            {filteredItems.length === 0 ? <div className="empty-state">{copy.empty}</div> : null}
          </div>
        </div>

        <aside className="portfolio-command-rail">
          <article className="card studio-side-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.summaryTitle}</p>
                <h3>{copy.summaryTitle}</h3>
              </div>
            </div>
            <p className="hero-copy">{copy.summaryCopy}</p>
            <div className="attention-list">
              <article className={counts.critical > 0 ? "attention-card attention-danger" : "attention-card"}>
                <strong>{copy.criticalCount}</strong>
                <p>{counts.critical}</p>
              </article>
              <article className={counts.warning > 0 ? "attention-card attention-warning" : "attention-card"}>
                <strong>{copy.warningCount}</strong>
                <p>{counts.warning}</p>
              </article>
              <article className="attention-card">
                <strong>{copy.infoCount}</strong>
                <p>{counts.info}</p>
              </article>
              <article className="attention-card">
                <strong>{copy.approvals}</strong>
                <p>{counts.approvals}</p>
              </article>
            </div>
          </article>

          <article className="card studio-side-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.latestAudit}</p>
                <h3>{copy.latestAudit}</h3>
              </div>
            </div>
            <div className="timeline-list">
              {auditLogs.slice(0, 6).map((item) => (
                <article key={item.id} className="timeline-item">
                  <div className="timeline-time">{formatTime(item.createdAt, locale)}</div>
                  <div>
                    <div className="timeline-head">
                      <strong>{item.summary}</strong>
                      <span className="pill">{item.action}</span>
                    </div>
                    <p>{item.actorLabel}</p>
                  </div>
                </article>
              ))}
              {auditLogs.length === 0 ? <p className="muted-text">{copy.noAudit}</p> : null}
            </div>
          </article>

          {health ? (
            <article className="card studio-side-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">{isEnglish ? "Platform" : "平台"}</p>
                  <h3>{isEnglish ? "Live platform snapshot" : "实时平台快照"}</h3>
                </div>
              </div>
              <div className="metric-inline-grid">
                <MetricInline label={isEnglish ? "Active tasks" : "活动任务"} value={String(health.activeTasks)} />
                <MetricInline label={isEnglish ? "Blocked tasks" : "阻塞任务"} value={String(health.blockedTasks)} />
                <MetricInline label={isEnglish ? "Pending approvals" : "待审批"} value={String(health.pendingApprovals)} />
              </div>
            </article>
          ) : null}
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

function formatTime(timestamp: string, locale = "zh-CN") {
  return new Date(timestamp).toLocaleString(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
