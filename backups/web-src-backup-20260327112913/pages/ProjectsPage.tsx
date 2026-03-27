import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, FileText, Filter, FolderKanban, Plus, RefreshCw, Search } from "lucide-react";
import type { OpenClawProjectDetail, ProjectSummary } from "@occ/shared";
import { api } from "../lib/api";
import { useLocale } from "../lib/locale";

type SourceFilter = "all" | "app" | "openclaw";
type StatusFilter = "all" | "active" | "blocked" | "completed" | "paused" | "planned";

type PortfolioRow = {
  key: string;
  source: "app" | "openclaw";
  name: string;
  description: string;
  status: string;
  stage: string;
  progress: number;
  updatedAt: string;
  tasks: number;
  blocked: number;
  docs: number;
  to: string;
  cta: string;
  meta: string;
};

export function ProjectsPage() {
  const { isEnglish, locale } = useLocale();
  const [appProjects, setAppProjects] = useState<ProjectSummary[]>([]);
  const [workspaceProjects, setWorkspaceProjects] = useState<OpenClawProjectDetail[]>([]);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const copy = isEnglish
    ? {
        title: "Project portfolio and live workspaces",
        hero: "Use one portfolio surface to monitor app-native projects and real OpenClaw execution workspaces without losing operational context.",
        refresh: "Refresh",
        create: "New project",
        search: "Search by project, focus, stage, or summary",
        all: "All",
        app: "App projects",
        openclaw: "OpenClaw workspaces",
        active: "Active",
        blocked: "Blocked",
        completed: "Completed",
        paused: "Paused",
        planned: "Planned",
        projects: "Projects",
        overviewTitle: "Portfolio command center",
        overviewCopy: "The new AI Studio direction expects a command-style project page: clear filters, visible delivery health, and cards that open the right room fast.",
        totalCount: "Portfolio",
        activeCount: "Running now",
        blockedCount: "Need help",
        workspaceCount: "Workspace-linked",
        sourceMix: "Source mix",
        statusMix: "Delivery health",
        recentFocus: "Latest focus",
        noFocus: "No fresh portfolio activity yet.",
        alertsTitle: "Attention lane",
        alertsCopy: "Use this rail to catch stalled delivery, approval accumulation, and project clusters that need intervention.",
        openRoom: "Open room",
        openWorkspace: "Open workspace",
        empty: "No projects match the current filters.",
        waitingApproval: "Waiting approval",
        docs: "Docs",
        tasks: "Tasks",
        updated: "Updated",
        stage: "Stage / Focus",
        progress: "Progress"
      }
    : {
        title: "项目组合与真实工作区",
        hero: "把应用内项目和真实 OpenClaw 执行工作区放进同一个组合视图里，才能像真正的 SaaS 管理平台那样运营交付。",
        refresh: "刷新",
        create: "新建项目",
        search: "搜索项目、焦点、阶段或摘要",
        all: "全部",
        app: "应用项目",
        openclaw: "OpenClaw 工作区",
        active: "进行中",
        blocked: "阻塞",
        completed: "已完成",
        paused: "已暂停",
        planned: "规划中",
        projects: "项目",
        overviewTitle: "项目组合指挥中心",
        overviewCopy: "新的 AI Studio 方案强调的是指挥感而不是表格感，所以这里会优先呈现筛选、健康状态和快速进入能力。",
        totalCount: "组合总量",
        activeCount: "正在推进",
        blockedCount: "需要支援",
        workspaceCount: "已连接工作区",
        sourceMix: "来源分布",
        statusMix: "交付健康",
        recentFocus: "最近焦点",
        noFocus: "当前还没有新的项目动态。",
        alertsTitle: "注意事项",
        alertsCopy: "在这里快速发现阻塞、审批堆积，以及需要你优先处理的项目簇。",
        openRoom: "进入项目作战室",
        openWorkspace: "进入工作区视图",
        empty: "当前筛选条件下没有项目。",
        waitingApproval: "待审批",
        docs: "文档",
        tasks: "任务",
        updated: "更新",
        stage: "阶段 / 焦点",
        progress: "进度"
      };

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      setLoading(true);
      setError(null);

      const [projects, workspace] = await Promise.all([api.getProjects(), api.getOpenClawProjects()]);
      setAppProjects(projects);
      setWorkspaceProjects(workspace);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : (isEnglish ? "Failed to load projects" : "加载项目失败"));
    } finally {
      setLoading(false);
    }
  }

  const rows = useMemo<PortfolioRow[]>(() => {
    const appRows = appProjects.map((project) => ({
      key: `app:${project.id}`,
      source: "app" as const,
      name: project.name,
      description: project.summary,
      status: project.pendingApproval ? "paused" : project.status,
      stage: project.currentStage,
      progress: project.progress,
      updatedAt: project.updatedAt,
      tasks: project.openTaskCount,
      blocked: 0,
      docs: 0,
      to: `/projects/${project.id}`,
      cta: copy.openRoom,
      meta: project.pendingApproval ? copy.waitingApproval : project.currentStage
    }));

    const workspaceRows = workspaceProjects.map((project) => ({
      key: `openclaw:${project.id}`,
      source: "openclaw" as const,
      name: project.name,
      description: project.description,
      status: project.blockedTaskCount > 0 ? "blocked" : project.status,
      stage: project.currentFocus || project.relativePath,
      progress: project.progress,
      updatedAt: project.updatedAt,
      tasks: project.taskCount,
      blocked: project.blockedTaskCount,
      docs: project.docs.length,
      to: `/openclaw?projectId=${encodeURIComponent(project.id)}`,
      cta: copy.openWorkspace,
      meta: project.relativePath
    }));

    const normalizedQuery = query.trim().toLowerCase();

    return [...appRows, ...workspaceRows]
      .filter((row) => (sourceFilter === "all" ? true : row.source === sourceFilter))
      .filter((row) => (statusFilter === "all" ? true : row.status === statusFilter))
      .filter((row) => {
        if (!normalizedQuery) {
          return true;
        }

        return `${row.name} ${row.description} ${row.stage} ${row.meta}`.toLowerCase().includes(normalizedQuery);
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [appProjects, workspaceProjects, sourceFilter, statusFilter, query, copy.openRoom, copy.openWorkspace, copy.waitingApproval]);

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

  const alerts = useMemo(() => {
    const nextAlerts: Array<{ title: string; detail: string; tone: "warning" | "danger" | "default" }> = [];
    const pendingApprovals = appProjects.filter((project) => project.pendingApproval).length;
    const blockedWorkspace = workspaceProjects.filter((project) => project.blockedTaskCount > 0).length;

    if (pendingApprovals > 0) {
      nextAlerts.push({
        title: isEnglish ? `${pendingApprovals} app projects need approval` : `${pendingApprovals} 个应用项目等待审批`,
        detail: isEnglish ? "Clearing approvals will reopen downstream stage execution." : "尽快清理审批队列，避免后续阶段空转。",
        tone: "warning"
      });
    }

    if (blockedWorkspace > 0) {
      nextAlerts.push({
        title: isEnglish ? `${blockedWorkspace} workspaces show blockers` : `${blockedWorkspace} 个工作区存在阻塞`,
        detail: isEnglish ? "Open the workspace room to reassign tasks or resolve blockers." : "建议进入工作区视图，优先改派或解除阻塞。",
        tone: "danger"
      });
    }

    if (nextAlerts.length === 0) {
      nextAlerts.push({
        title: isEnglish ? "Portfolio delivery looks stable" : "当前项目组合推进稳定",
        detail: isEnglish ? "No fresh approval backlog or visible workspace blockage was detected." : "暂未发现新的审批堆积或明显工作区阻塞。",
        tone: "default"
      });
    }

    return nextAlerts;
  }, [appProjects, isEnglish, workspaceProjects]);

  if (loading) {
    return <div className="card">{isEnglish ? "Loading projects..." : "正在加载项目..."}</div>;
  }

  if (error) {
    return <div className="card error-text">{error}</div>;
  }

  return (
    <div className="page">
      <header className="page-header studio-page-header bg-[#16191E]/70 backdrop-blur-xl rounded-2xl p-6 border border-white/[0.06]">
        <div>
          <p className="eyebrow">Project Portfolio</p>
          <h2>{copy.title}</h2>
          <p className="hero-copy">{copy.hero}</p>
        </div>
        <div className="studio-header-actions">
          <label className="studio-search-field" aria-label={copy.search}>
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} />
          </label>
          <button className="button button-ghost inline-button" onClick={() => void refresh()}>
            <RefreshCw size={16} />
            {copy.refresh}
          </button>
          <Link className="button button-primary inline-button" to="/?compose=project">
            <Plus size={16} />
            {copy.create}
          </Link>
        </div>
      </header>

      <section className="studio-kpi-grid">
        <MetricInline label={copy.totalCount} value={String(portfolioStats.total)} />
        <MetricInline label={copy.activeCount} value={String(portfolioStats.active)} />
        <MetricInline label={copy.blockedCount} value={String(portfolioStats.blocked)} />
        <MetricInline label={copy.workspaceCount} value={String(portfolioStats.workspace)} />
      </section>

      <section className="portfolio-command-grid">
        <div className="portfolio-command-main">
          <article className="card studio-command-card studio-catalog-toolbar-card rounded-2xl bg-[#16191E]/70 backdrop-blur-xl border border-white/[0.06]">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.overviewTitle}</p>
                <h3>{copy.overviewTitle}</h3>
                <p className="hero-copy">{copy.overviewCopy}</p>
              </div>
              <span className="pill pill-primary">{rows.length}</span>
            </div>

            <div className="studio-filter-stack">
              <div className="segmented segmented-wide">
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

              <div className="pill-row">
                {(["all", "active", "blocked", "paused", "planned", "completed"] as StatusFilter[]).map((filter) => (
                  <button
                    key={filter}
                    className={statusFilter === filter ? "filter-pill filter-pill-active" : "filter-pill"}
                    onClick={() => setStatusFilter(filter)}
                  >
                    {statusLabel(filter, copy)}
                  </button>
                ))}
              </div>
            </div>
          </article>

          <div className="studio-catalog-grid">
            {rows.map((row) => (
              <PortfolioProjectCard key={row.key} row={row} isEnglish={isEnglish} locale={locale} />
            ))}
            {rows.length === 0 ? <div className="empty-state">{copy.empty}</div> : null}
          </div>
        </div>

        <aside className="portfolio-command-rail">
          <article className="card studio-side-card rounded-2xl bg-[#16191E]/70 backdrop-blur-xl border border-white/[0.06]">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.alertsTitle}</p>
                <h3>{copy.alertsTitle}</h3>
              </div>
            </div>
            <p className="hero-copy">{copy.alertsCopy}</p>
            <div className="attention-list">
              {alerts.map((item) => (
                <article className={`attention-card attention-${item.tone}`} key={item.title}>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </article>
              ))}
            </div>
          </article>

          <article className="card studio-side-card rounded-2xl bg-[#16191E]/70 backdrop-blur-xl border border-white/[0.06]">
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

          <article className="card studio-side-card rounded-2xl bg-[#16191E]/70 backdrop-blur-xl border border-white/[0.06]">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.statusMix}</p>
                <h3>{copy.statusMix}</h3>
              </div>
            </div>
            <div className="attention-list">
              {statusMix.map((item) => (
                <article className={`attention-card ${item.tone === "paused" ? "attention-warning" : item.tone === "working" ? "attention-default" : ""}`} key={item.label}>
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

          <article className="card studio-side-card rounded-2xl bg-[#16191E]/70 backdrop-blur-xl border border-white/[0.06]">
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

function PortfolioProjectCard({
  row,
  isEnglish,
  locale
}: {
  row: PortfolioRow;
  isEnglish: boolean;
  locale: "zh-CN" | "en-US";
}) {
  const statusTone = projectStatusTone(row.status);

  return (
    <article className={`studio-catalog-card rounded-2xl bg-[#1C2128]/70 backdrop-blur-md border border-white/[0.06] hover:border-emerald-500/30 hover:shadow-lg hover:shadow-black/20 transition-all duration-200 ${statusTone === "paused" ? "border-amber-500/30 studio-catalog-card-warning" : statusTone === "completed" ? "border-emerald-500/30 studio-catalog-card-success" : ""}`}>
      <div className={`studio-catalog-accent studio-catalog-accent-${statusTone}`} />
      <div className="studio-catalog-card-body">
        <div className="studio-catalog-card-head">
          <div className="studio-catalog-icon">
            <FolderKanban size={24} />
          </div>
          <div className="studio-catalog-badges">
            <span className={row.source === "app" ? "pill" : "pill pill-primary"}>{row.source === "app" ? (isEnglish ? "APP" : "应用") : "OpenClaw"}</span>
            <span className={`status-badge status-${statusTone}`}>{projectStatusLabel(row.status, isEnglish)}</span>
          </div>
        </div>

        <div className="studio-catalog-copy">
          <p className="project-id">{row.meta}</p>
          <h3>{row.name}</h3>
          <p>{row.description}</p>
        </div>

        <div className="studio-catalog-progress">
          <div className="studio-catalog-progress-head">
            <span>{row.stage}</span>
            <strong>{row.progress}%</strong>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${Math.max(4, row.progress)}%` }} />
          </div>
        </div>

        <div className="studio-catalog-inline-metrics">
          <MetricStack label={isEnglish ? "Tasks" : "任务"} value={String(row.tasks)} />
          <MetricStack label={isEnglish ? "Blocked" : "阻塞"} value={String(row.blocked)} tone={row.blocked > 0 ? "warning" : "default"} />
        </div>

        <div className="studio-catalog-footer">
          <div className="studio-catalog-team">
            <div className="studio-mini-chip">
              <FileText size={14} />
              <span>{row.docs}</span>
            </div>
            <div className="studio-mini-chip">
              <span>{formatTime(row.updatedAt, locale)}</span>
            </div>
          </div>
          <Link className="studio-card-arrow" to={row.to}>
            <ChevronRight size={18} />
          </Link>
        </div>
      </div>
    </article>
  );
}

function MetricInline({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-inline-card bg-[#1C2128]/60 backdrop-blur-md rounded-2xl border border-white/[0.06] p-4">
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
    <div className={`showcase-metric ${tone === "warning" ? "showcase-metric-warning" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function statusLabel(filter: StatusFilter, copy: Record<string, string>) {
  if (filter === "all") {
    return copy.all;
  }

  return copy[filter];
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
