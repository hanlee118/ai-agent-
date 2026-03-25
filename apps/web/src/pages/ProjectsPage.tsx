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
        empty: "No projects match the current filters."
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
        empty: "当前筛选条件下没有项目。"
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

      <section className="card projects-toolbar">
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
      </section>

      <section className="projects-table-card">
        <div className="projects-table-header">
          <span>{copy.projects}</span>
          <span>{copy.status}</span>
          <span>{copy.stage}</span>
          <span>{copy.progress}</span>
          <span>{copy.updated}</span>
          <span>{copy.tasks}</span>
          <span>{copy.blocked}</span>
          <span>{copy.deliverables}</span>
          <span>{isEnglish ? "Action" : "操作"}</span>
        </div>

        <div className="projects-table-body">
          {rows.map((row) => (
            <div className="projects-table-row" key={row.key}>
              <div className="projects-table-project">
                <strong>{row.name}</strong>
                <p>{row.description}</p>
                <div className="pill-row">
                  <span className={row.source === "app" ? "pill" : "pill pill-primary"}>
                    {row.source === "app" ? copy.app : copy.openclaw}
                  </span>
                </div>
              </div>
              <span className={`status-badge status-${projectStatusTone(row.status)}`}>{projectStatusLabel(row.status, isEnglish)}</span>
              <span className="muted-text">{row.stage}</span>
              <strong>{row.progress}%</strong>
              <span className="muted-text">{formatTime(row.updatedAt, locale)}</span>
              <strong>{row.tasks}</strong>
              <strong>{row.blocked}</strong>
              <strong>{row.docs}</strong>
              <Link className="button button-primary inline-button" to={row.to}>
                {row.cta}
              </Link>
            </div>
          ))}

          {rows.length === 0 ? <div className="card muted-text">{copy.empty}</div> : null}
        </div>
      </section>
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
