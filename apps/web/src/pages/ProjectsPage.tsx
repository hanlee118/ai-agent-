import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { OpenClawProjectDetail, ProjectSummary } from "@occ/shared";
import { api } from "../lib/api";
import { useLocale } from "../lib/locale";

type SourceFilter = "all" | "app" | "openclaw";

export function ProjectsPage() {
  const { isEnglish, locale } = useLocale();
  const [appProjects, setAppProjects] = useState<ProjectSummary[]>([]);
  const [workspaceProjects, setWorkspaceProjects] = useState<OpenClawProjectDetail[]>([]);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const copy = isEnglish
    ? {
        title: "Project portfolio and live workspaces",
        hero: "Track structured app projects and real OpenClaw workspaces together so the platform behaves like one delivery portfolio.",
        refresh: "Refresh",
        search: "Search project, focus, path, or summary",
        all: "All",
        app: "App projects",
        openclaw: "OpenClaw workspaces",
        projects: "Projects",
        status: "Status",
        stage: "Stage / Focus",
        progress: "Progress",
        updated: "Updated",
        tasks: "Tasks",
        blocked: "Blocked",
        deliverables: "Docs",
        openRoom: "Open room",
        openWorkspace: "Open workspace",
        empty: "No projects match the current filters.",
        overviewTitle: "Portfolio command view",
        overviewCopy: "A Slack-like portfolio lane that keeps structured app initiatives and real workspace delivery in one operating rhythm.",
        totalCount: "Total portfolio",
        activeCount: "Running now",
        blockedCount: "Need support",
        workspaceCount: "Workspace-linked",
        healthTitle: "Delivery radar",
        healthCopy: "Use the right rail to spot where the team is slowing down before approvals and blockers pile up.",
        sourceMix: "Source mix",
        statusMix: "Status mix",
        recentFocus: "Latest focus areas",
        noFocus: "No fresh project activity yet."
      }
    : {
        title: "项目组合与真实工作区",
        hero: "把应用内结构化项目和真实 OpenClaw 工作区放在同一张项目面板里，平台才能真正像一个交付中台。",
        refresh: "刷新",
        search: "搜索项目、焦点、路径或摘要",
        all: "全部",
        app: "应用项目",
        openclaw: "OpenClaw 工作区",
        projects: "项目",
        status: "状态",
        stage: "阶段 / 焦点",
        progress: "进度",
        updated: "更新时间",
        tasks: "任务数",
        blocked: "阻塞数",
        deliverables: "文档数",
        openRoom: "进入项目作战室",
        openWorkspace: "进入工作区视图",
        empty: "当前筛选条件下没有项目。",
        overviewTitle: "项目组合指挥视图",
        overviewCopy: "用更接近 Slack/SaaS 运营台的方式，把应用项目和真实工作区项目放进同一条交付主线里。",
        totalCount: "组合总量",
        activeCount: "正在推进",
        blockedCount: "需要支援",
        workspaceCount: "工作区项目",
        healthTitle: "交付雷达",
        healthCopy: "右侧情报栏帮助你提前发现阻塞、审批堆积和最近的项目焦点。",
        sourceMix: "来源分布",
        statusMix: "状态分布",
        recentFocus: "最近焦点",
        noFocus: "当前还没有新的项目动态。"
      };

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      setLoading(true);
      setError(null);

      const [projects, workspace] = await Promise.all([
        api.getProjects(),
        api.getOpenClawProjects()
      ]);

      setAppProjects(projects);
      setWorkspaceProjects(workspace);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  const rows = useMemo(() => {
    const appRows = appProjects.map((project) => ({
      key: `app:${project.id}`,
      source: "app" as const,
      name: project.name,
      description: project.summary,
      status: project.status,
      stage: project.currentStage,
      progress: project.progress,
      updatedAt: project.updatedAt,
      tasks: project.openTaskCount,
      blocked: 0,
      docs: 0,
      to: `/projects/${project.id}`,
      cta: copy.openRoom
    }));
    const workspaceRows = workspaceProjects.map((project) => ({
      key: `openclaw:${project.id}`,
      source: "openclaw" as const,
      name: project.name,
      description: project.description,
      status: project.status,
      stage: project.currentFocus || project.relativePath,
      progress: project.progress,
      updatedAt: project.updatedAt,
      tasks: project.taskCount,
      blocked: project.blockedTaskCount,
      docs: project.docs.length,
      to: `/openclaw?projectId=${encodeURIComponent(project.id)}`,
      cta: copy.openWorkspace
    }));

    return [...appRows, ...workspaceRows]
      .filter((row) => (sourceFilter === "all" ? true : row.source === sourceFilter))
      .filter((row) => {
        const text = `${row.name} ${row.description} ${row.stage}`.toLowerCase();
        return text.includes(query.trim().toLowerCase());
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [appProjects, workspaceProjects, sourceFilter, query, copy.openRoom, copy.openWorkspace]);

  const portfolioStats = useMemo(() => {
    const total = rows.length;
    const active = rows.filter((row) => row.status === "active").length;
    const blocked = rows.filter((row) => row.status === "blocked" || row.status === "paused").length;
    const workspace = rows.filter((row) => row.source === "openclaw").length;
    return { total, active, blocked, workspace };
  }, [rows]);

  const sourceMix = useMemo(
    () => [
      { label: copy.app, value: appProjects.length },
      { label: copy.openclaw, value: workspaceProjects.length }
    ],
    [appProjects.length, copy.app, copy.openclaw, workspaceProjects.length]
  );

  const statusMix = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const row of rows) {
      grouped.set(row.status, (grouped.get(row.status) ?? 0) + 1);
    }

    return Array.from(grouped.entries())
      .map(([status, count]) => ({
        label: projectStatusLabel(status, isEnglish),
        count,
        tone: projectStatusTone(status)
      }))
      .sort((left, right) => right.count - left.count);
  }, [isEnglish, rows]);

  const recentFocus = useMemo(
    () =>
      rows.slice(0, 5).map((row) => ({
        key: row.key,
        title: row.name,
        detail: row.stage,
        updatedAt: row.updatedAt,
        tone: projectStatusTone(row.status)
      })),
    [rows]
  );

  if (loading) {
    return <div className="card">{isEnglish ? "Loading projects..." : "正在加载项目..."}</div>;
  }

  if (error) {
    return <div className="card error-text">{error}</div>;
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Project Portfolio</p>
          <h2>{copy.title}</h2>
          <p className="hero-copy">{copy.hero}</p>
        </div>
        <button className="button button-ghost" onClick={() => void refresh()}>
          {copy.refresh}
        </button>
      </header>

      <section className="portfolio-shell">
        <div className="portfolio-main stack">
          <article className="card">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.overviewTitle}</p>
                <h3>{copy.overviewTitle}</h3>
                <p className="hero-copy">{copy.overviewCopy}</p>
              </div>
            </div>

            <div className="projects-toolbar-grid">
              <input
                className="composer-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={copy.search}
              />
              <div className="segmented">
                <button className={sourceFilter === "all" ? "segmented-item is-active" : "segmented-item"} onClick={() => setSourceFilter("all")}>
                  {copy.all}
                </button>
                <button className={sourceFilter === "app" ? "segmented-item is-active" : "segmented-item"} onClick={() => setSourceFilter("app")}>
                  {copy.app}
                </button>
                <button className={sourceFilter === "openclaw" ? "segmented-item is-active" : "segmented-item"} onClick={() => setSourceFilter("openclaw")}>
                  {copy.openclaw}
                </button>
              </div>
            </div>

            <div className="metric-inline-grid">
              <MetricInline label={copy.totalCount} value={String(portfolioStats.total)} />
              <MetricInline label={copy.activeCount} value={String(portfolioStats.active)} />
              <MetricInline label={copy.blockedCount} value={String(portfolioStats.blocked)} />
              <MetricInline label={copy.workspaceCount} value={String(portfolioStats.workspace)} />
            </div>
          </article>

          <article className="card portfolio-roster-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.projects}</p>
                <h3>{copy.projects}</h3>
              </div>
              <span className="pill">{rows.length}</span>
            </div>

            <div className="portfolio-list">
              {rows.map((row) => (
                <article className="portfolio-row" key={row.key}>
                  <div className="portfolio-row-main">
                    <div className="portfolio-row-head">
                      <div>
                        <div className="pill-row">
                          <span className={row.source === "app" ? "pill" : "pill pill-primary"}>
                            {row.source === "app" ? copy.app : copy.openclaw}
                          </span>
                          <span className={`status-badge status-${projectStatusTone(row.status)}`}>
                            {projectStatusLabel(row.status, isEnglish)}
                          </span>
                        </div>
                        <h3 className="portfolio-row-title">{row.name}</h3>
                      </div>
                      <Link className="button button-primary inline-button" to={row.to}>
                        {row.cta}
                      </Link>
                    </div>

                    <p className="portfolio-row-summary">{row.description}</p>

                    <div className="portfolio-progress-row">
                      <div>
                        <span className="group-title">{copy.stage}</span>
                        <strong>{row.stage}</strong>
                      </div>
                      <div>
                        <span className="group-title">{copy.progress}</span>
                        <strong>{row.progress}%</strong>
                      </div>
                    </div>

                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${Math.max(4, row.progress)}%` }} />
                    </div>
                  </div>

                  <div className="portfolio-row-metrics">
                    <MetricStack label={copy.updated} value={formatTime(row.updatedAt, locale)} />
                    <MetricStack label={copy.tasks} value={String(row.tasks)} />
                    <MetricStack label={copy.blocked} value={String(row.blocked)} tone={row.blocked > 0 ? "warning" : "default"} />
                    <MetricStack label={copy.deliverables} value={String(row.docs)} />
                  </div>
                </article>
              ))}

              {rows.length === 0 ? <div className="empty-state">{copy.empty}</div> : null}
            </div>
          </article>
        </div>

        <aside className="portfolio-sidebar">
          <article className="card">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.healthTitle}</p>
                <h3>{copy.healthTitle}</h3>
              </div>
            </div>
            <p className="hero-copy">{copy.healthCopy}</p>
            <div className="attention-list">
              {statusMix.map((item) => (
                <article className={`attention-card ${item.tone === "paused" ? "attention-warning" : ""}`} key={item.label}>
                  <div className="timeline-head">
                    <strong>{item.label}</strong>
                    <span className={`pill ${item.tone === "working" ? "pill-primary" : item.tone === "paused" ? "pill-warning" : item.tone === "completed" ? "pill-success" : ""}`}>
                      {item.count}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </article>

          <article className="card">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.sourceMix}</p>
                <h3>{copy.sourceMix}</h3>
              </div>
            </div>
            <div className="stack tight">
              {sourceMix.map((item) => (
                <div className="agent-mini-card" key={item.label}>
                  <strong>{item.label}</strong>
                  <span className="pill">{item.value}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="card">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.recentFocus}</p>
                <h3>{copy.recentFocus}</h3>
              </div>
            </div>
            <div className="timeline-list">
              {recentFocus.map((item) => (
                <article className="timeline-item" key={item.key}>
                  <div className="timeline-time">{formatTime(item.updatedAt, locale)}</div>
                  <div>
                    <div className="timeline-head">
                      <strong>{item.title}</strong>
                      <span className={`pill ${item.tone === "working" ? "pill-primary" : item.tone === "paused" ? "pill-warning" : item.tone === "completed" ? "pill-success" : ""}`}>
                        {item.detail}
                      </span>
                    </div>
                  </div>
                </article>
              ))}
              {recentFocus.length === 0 ? <p className="muted-text">{copy.noFocus}</p> : null}
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

function MetricStack({
  label,
  value,
  tone = "default"
}: {
  label: string;
  value: string;
  tone?: "default" | "warning";
}) {
  return (
    <div className={`portfolio-metric-stack ${tone === "warning" ? "portfolio-metric-stack-warning" : ""}`}>
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

function projectStatusTone(status: string) {
  if (status === "completed") {
    return "completed";
  }
  if (status === "blocked" || status === "paused") {
    return "paused";
  }
  return "working";
}

function projectStatusLabel(status: string, isEnglish: boolean) {
  const labels = isEnglish
    ? { active: "Active", blocked: "Blocked", completed: "Completed", planned: "Planned", paused: "Paused" }
    : { active: "进行中", blocked: "阻塞", completed: "已完成", planned: "规划中", paused: "已暂停" };

  return labels[status as keyof typeof labels] ?? status;
}
