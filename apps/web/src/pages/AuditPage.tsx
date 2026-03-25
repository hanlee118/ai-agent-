import { useEffect, useMemo, useState } from "react";
import type { AuditLogItem } from "@occ/shared";
import { api } from "../lib/api";
import { useLocale } from "../lib/locale";

export function AuditPage() {
  const { isEnglish, locale } = useLocale();
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
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
        empty: "No audit logs match the current search."
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
        empty: "当前搜索条件下没有审计日志。"
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
      return logs;
    }

    return logs.filter((log) => {
      const text = `${log.action} ${log.summary} ${log.actorLabel} ${log.resourceType} ${log.detail || ""}`.toLowerCase();
      return text.includes(normalizedQuery);
    });
  }, [logs, query]);

  if (loading) {
    return <div className="card">{isEnglish ? "Loading audit logs..." : "正在加载审计日志..."}</div>;
  }

  if (error) {
    return <div className="card error-text">{error}</div>;
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Audit Trail</p>
          <h2>{copy.title}</h2>
          <p className="hero-copy">{copy.hero}</p>
        </div>
        <button className="button button-ghost" onClick={() => void refresh()}>
          {copy.refresh}
        </button>
      </header>

      <section className="card">
        <input
          className="composer-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.search}
        />
      </section>

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
                <span className="pill">{log.action}</span>
              </div>
              <div className="audit-cell">
                <p>{log.detail || "-"}</p>
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
  );
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
