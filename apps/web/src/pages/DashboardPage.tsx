import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  type LocalAgentMonitorOverview,
  type OpenClawProjectSummary,
  type OpenClawAgentSummary,
  type OpenClawWorkspaceOverview,
  type ParsedIntent,
  type ProjectSummary,
  type RuntimeStatus,
  type SystemHealth,
  type TaskBoardItem,
  type TaskStatus
} from "@occ/shared";
import { api } from "../lib/api";
import { useLocale } from "../lib/locale";
import { getOpenClawProjectStateLabel, getRoleLabel, getStageLabel, getTaskPriorityLabel, getTaskStatusLabel } from "../lib/uiLabels";

type TaskFilter = "all" | TaskStatus;
const DASHBOARD_DESCRIPTION_DEFAULTS = {
  "zh-CN": "请根据我已有的想法，设计并研发一个 AI 协作工作台 MVP，先把项目创建、实时观测、审批和紧急介入做出来。",
  "en-US": "Design and build an AI collaboration workspace MVP based on my current ideas. Start with project creation, live observation, approvals, and emergency intervention."
} as const;

export function DashboardPage() {
  const { isEnglish, locale } = useLocale();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [agents, setAgents] = useState<OpenClawAgentSummary[]>([]);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [localMonitor, setLocalMonitor] = useState<LocalAgentMonitorOverview | null>(null);
  const [tasks, setTasks] = useState<TaskBoardItem[]>([]);
  const [workspace, setWorkspace] = useState<OpenClawWorkspaceOverview | null>(null);
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("all");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [description, setDescription] = useState<string>(DASHBOARD_DESCRIPTION_DEFAULTS[locale]);
  const [preview, setPreview] = useState<ParsedIntent | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = isEnglish
    ? {
        title: "State what you want. Your agent team keeps moving while you stay in control.",
        hero: "The platform can already create projects, monitor work, approve stages, and intervene when needed.",
        refresh: "Refresh",
        activeProjects: "Active projects",
        approvals: "Waiting approval",
        activeTasks: "Active tasks",
        onlineAgents: "Online agents",
        modulesTitle: "Workspace Modules",
        modulesCopy: "Use the system like a SaaS operating platform: jump by module instead of hunting through raw pages.",
        localMonitorTitle: "Local Agent Pulse",
        localMonitorCopy: "A unified live summary for recent Codex, Claude Code, and OpenClaw sessions on this machine.",
        openMonitor: "Open Operations",
        demoTitle: "Live Demo Project",
        demoEmpty: "The test demo project is still being prepared.",
        openDemo: "Open Team Workspace",
        openSystem: "Open Operations",
        openAgents: "Open Agent Studio",
        openProjects: "Open Portfolio",
        newProject: "New Project",
        projectComposer: "Turn one prompt into a formal project",
        preview: "Analyze Request",
        create: "Create Project",
        createBusy: "Creating..."
      }
    : {
        title: "你说需求，Agent 自动推进，你全程看得见、随时停得下。",
        hero: "这版已经具备项目创建、实时观测、任务落库、阶段审批、返工恢复和系统健康监控的主链路。",
        refresh: "立即刷新",
        activeProjects: "活跃项目",
        approvals: "待审批",
        activeTasks: "活动任务",
        onlineAgents: "在线 Agent",
        modulesTitle: "工作区模块",
        modulesCopy: "按 SaaS 平台的方式进入系统，而不是自己在页面里找入口。",
        localMonitorTitle: "本地 Agent 脉冲",
        localMonitorCopy: "把这台机器上的 Codex、Claude Code、OpenClaw 最近会话和活跃状态统一压缩成一个首页摘要。",
        openMonitor: "进入系统运营",
        demoTitle: "演示项目",
        demoEmpty: "test 演示项目正在准备中。",
        openDemo: "进入团队工作区",
        openSystem: "进入系统运营",
        openAgents: "进入 Agent 工作台",
        openProjects: "进入项目组合",
        newProject: "New Project",
        projectComposer: "把一句想法变成正式项目",
        preview: "解析需求",
        create: "确认并创建项目",
        createBusy: "创建中..."
      };

  useEffect(() => {
    setDescription((current) =>
      Object.values(DASHBOARD_DESCRIPTION_DEFAULTS).includes(current as (typeof DASHBOARD_DESCRIPTION_DEFAULTS)[keyof typeof DASHBOARD_DESCRIPTION_DEFAULTS])
        ? DASHBOARD_DESCRIPTION_DEFAULTS[locale]
        : current
    );
  }, [locale]);

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const source = new EventSource(api.localAgentMonitorLiveUrl(), { withCredentials: true });

    source.addEventListener("snapshot", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as LocalAgentMonitorOverview;
        setLocalMonitor(payload);
      } catch {
        // keep the last good snapshot until the next event arrives
      }
    });

    return () => {
      source.close();
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh({ silent: true });
    }, 12000);

    return () => window.clearInterval(timer);
  }, []);

  async function refresh(options?: { silent?: boolean }) {
    try {
      if (!options?.silent) {
        setError(null);
      }

      const [projectList, agentList, runtimeInfo, healthInfo, taskList, workspaceInfo] = await Promise.all([
        api.getProjects(),
        api.getOpenClawAgents(),
        api.getRuntime(),
        api.getSystemHealth(),
        api.getTasks(),
        api.getOpenClawWorkspace()
      ]);

      setProjects(projectList);
      setAgents(agentList);
      setRuntime(runtimeInfo);
      setHealth(healthInfo);
      setTasks(taskList);
      setWorkspace(workspaceInfo);
      setLastSyncedAt(new Date().toISOString());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : (isEnglish ? "Failed to load dashboard data" : "加载失败"));
    }
  }

  async function handlePreview() {
    setLoadingPreview(true);
    setError(null);
    try {
      setPreview(await api.previewProject(description));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : (isEnglish ? "Failed to analyze request" : "解析失败"));
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const project = await api.createProject({
        description,
        name: preview?.keywords[0] ? `${preview.keywords[0]} ${isEnglish ? "Project" : "项目"}` : undefined,
        team: preview?.suggestedTeam
      });
      await refresh();
      navigate(`/projects/${project.id}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : (isEnglish ? "Failed to create project" : "创建失败"));
    } finally {
      setCreating(false);
    }
  }

  const activeProjects = useMemo(
    () => projects.filter((project) => project.status === "active" && !project.pendingApproval),
    [projects]
  );
  const waitingProjects = useMemo(
    () => projects.filter((project) => project.pendingApproval),
    [projects]
  );
  const archivedProjects = useMemo(
    () => projects.filter((project) => project.status === "completed"),
    [projects]
  );
  const spotlightProject = activeProjects[0];
  const visibleTasks = useMemo(() => {
    const filtered = taskFilter === "all" ? tasks : tasks.filter((task) => task.status === taskFilter);
    return filtered.slice(0, 8);
  }, [taskFilter, tasks]);
  const demoWorkspaceProject = useMemo(
    () =>
      workspace?.projects.find((project) =>
        project.relativePath.includes("test-saas-demo-20260325") || project.name.toLowerCase().includes("test")
      ) ?? null,
    [workspace]
  );
  const workspaceModuleCards = useMemo(
    () => [
      {
        title: isEnglish ? "Portfolio" : "项目组合",
        description: isEnglish ? "See structured projects, delivery artifacts, and demo workspaces." : "查看结构化项目、交付物和演示项目。",
        cta: copy.openProjects,
        to: "/projects",
        metric: `${workspace?.projects.length ?? 0}`
      },
      {
        title: isEnglish ? "Agent Studio" : "Agent 工作台",
        description: isEnglish ? "Inspect SOUL, SOP, sessions, messages, and real task ownership." : "查看 SOUL、SOP、会话、消息和真实任务归属。",
        cta: copy.openAgents,
        to: "/agents",
        metric: `${workspace?.agents.length ?? 0}`
      },
      {
        title: isEnglish ? "Operations" : "系统运营",
        description: isEnglish ? "Track release readiness, runtime health, and audit trails." : "查看发布状态、运行健康和操作审计。",
        cta: copy.openSystem,
        to: "/system",
        metric: `${health?.services.length ?? 0}`
      },
      {
        title: copy.localMonitorTitle,
        description: copy.localMonitorCopy,
        cta: copy.openMonitor,
        to: "/system",
        metric: `${localMonitor?.sessions.length ?? 0}`
      }
    ],
    [
      copy.localMonitorCopy,
      copy.localMonitorTitle,
      copy.openAgents,
      copy.openMonitor,
      copy.openProjects,
      copy.openSystem,
      health?.services.length,
      isEnglish,
      localMonitor?.sessions.length,
      workspace?.agents.length,
      workspace?.projects.length
    ]
  );
  const attentionItems = useMemo(() => {
    const items: Array<{
      title: string;
      detail: string;
      tone: "warning" | "danger" | "default";
    }> = [];

    if (runtime && runtime.mode === "scripted") {
      items.push({
        title: isEnglish ? "Runtime is still using scripted fallback mode" : "模型运行仍在脚本回退模式",
        detail: isEnglish
          ? "The core workflow is usable, but real model orchestration has not been connected to the production runtime yet."
          : "当前主流程可用，但真实模型编排能力尚未接入生产配置。",
        tone: "warning"
      });
    }

    if ((health?.blockedTasks ?? 0) > 0) {
      items.push({
        title: isEnglish ? `${health?.blockedTasks ?? 0} tasks are blocked` : `${health?.blockedTasks ?? 0} 个任务已阻塞`,
        detail: isEnglish
          ? "Open the project room first so you can intervene or reassign the stage tasks."
          : "建议优先进入项目观测室，手动介入或改派阶段任务。",
        tone: "danger"
      });
    }

    if (waitingProjects.length > 0) {
      items.push({
        title: isEnglish ? `${waitingProjects.length} projects are waiting for approval` : `${waitingProjects.length} 个项目等待审批`,
        detail: isEnglish
          ? "The approval queue has become a gate. Clearing it quickly prevents downstream idle time."
          : "审批队列已形成闸口，尽快决策可避免后续阶段空转。",
        tone: "warning"
      });
    }

    if ((localMonitor?.tools.find((tool) => tool.tool === "codex")?.activeCount ?? 0) > 0) {
      items.push({
        title: isEnglish ? "Codex sessions are currently active" : "Codex 当前存在活跃会话",
        detail: isEnglish
          ? "The workstation is actively running Codex sessions, so operator coordination should stay tight."
          : "这台工作站当前有 Codex 会话正在运行，建议把指挥与监控保持在同一节奏。",
        tone: "default"
      });
    }

    if (items.length === 0) {
      items.push({
        title: isEnglish ? "The workspace is running smoothly" : "当前工作台运行平稳",
        detail: isEnglish
          ? "No new blockers or approval backlogs were detected, so active projects can keep moving."
          : "没有发现新的阻塞或审批堆积，可以继续推进活跃项目。",
        tone: "default"
      });
    }

    return items;
  }, [health?.blockedTasks, isEnglish, localMonitor?.tools, runtime, waitingProjects.length]);

  return (
    <div className="page">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Observation-first AI workspace</p>
          <h2>{copy.title}</h2>
          <p className="hero-copy">{copy.hero}</p>
          {runtime ? (
            <div className="runtime-banner">
              <span className="pill pill-primary">{runtime.mode}</span>
              <span className="muted-text">
                {isEnglish ? "Current runtime:" : "当前执行模式："}
                {runtime.configured ? runtime.modelName : (isEnglish ? "Model not configured, falling back to scripted agent" : "未配置模型，自动回退脚本 Agent")}
              </span>
            </div>
          ) : null}
          <div className="hero-inline-meta">
            <span className="muted-text">
              {isEnglish ? "Last sync:" : "最近同步："}{lastSyncedAt ? formatTime(lastSyncedAt, locale) : (isEnglish ? "Not yet" : "尚未同步")}
            </span>
            <button className="button button-ghost inline-button" onClick={() => void refresh()}>
              {copy.refresh}
            </button>
          </div>
        </div>
        <div className="hero-stats">
          <MetricCard label={copy.activeProjects} value={String(activeProjects.length)} />
          <MetricCard label={copy.approvals} value={String(waitingProjects.length)} tone="warning" />
          <MetricCard label={copy.activeTasks} value={String(health?.activeTasks ?? 0)} />
          <MetricCard label={copy.onlineAgents} value={String(agents.filter((item) => item.status !== "offline").length)} />
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="card composer-card">
          <div className="section-header">
            <div>
              <p className="eyebrow">{copy.newProject}</p>
              <h3>{copy.projectComposer}</h3>
            </div>
            <button className="button button-ghost" onClick={handlePreview} disabled={loadingPreview}>
              {loadingPreview ? (isEnglish ? "Analyzing..." : "解析中...") : copy.preview}
            </button>
          </div>

          <textarea
            className="composer-textarea"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={isEnglish ? "Describe what you want to build, the outcome you expect, and any constraints." : "描述你想做什么、希望达到什么结果、有哪些约束"}
          />

          {preview ? (
            <div className="intent-card">
              <div>
                <span className="pill pill-primary">{isEnglish ? "Understanding" : "理解摘要"}</span>
                <p>{preview.summary}</p>
              </div>
              <IntentGroup title={isEnglish ? "Keywords" : "关键词"} items={preview.keywords} />
              <IntentGroup title={isEnglish ? "Constraints" : "约束"} items={preview.constraints} />
              <IntentGroup title={isEnglish ? "Risks" : "风险"} items={preview.risks} danger />
              <IntentGroup
                title={isEnglish ? "Suggested Team" : "建议团队"}
                items={preview.suggestedTeam.map((role) => getRoleLabel(role, locale))}
              />

              <div className="action-row">
                <button className="button button-primary" onClick={handleCreate} disabled={creating}>
                  {creating ? copy.createBusy : copy.create}
                </button>
                <span className="muted-text">{isEnglish ? "The project starts as a single-user MVP and enters the analysis stage immediately." : "默认按单用户 MVP 立项，并从分析阶段自动启动。"}</span>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <span className="status-dot status-warning" />
              {isEnglish ? 'Click "Analyze Request" to generate an understanding card here.' : '点击“解析需求”后，这里会出现理解确认卡。'}
            </div>
          )}

          {error ? <p className="error-text">{error}</p> : null}
        </div>

        <div className="stack">
          <div className="card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Modules</p>
                <h3>{copy.modulesTitle}</h3>
              </div>
            </div>
            <p className="muted-text">{copy.modulesCopy}</p>
            <div className="module-grid">
              {workspaceModuleCards.map((item) => (
                <Link key={item.title} to={item.to} className="module-card">
                  <div className="module-card-head">
                    <strong>{item.title}</strong>
                    <span className="pill">{item.metric}</span>
                  </div>
                  <p>{item.description}</p>
                  <span className="module-link">{item.cta}</span>
                </Link>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Demo</p>
                <h3>{copy.demoTitle}</h3>
              </div>
            </div>
            {demoWorkspaceProject ? (
              <DemoProjectCard project={demoWorkspaceProject} cta={copy.openDemo} isEnglish={isEnglish} locale={locale} />
            ) : (
              <p className="muted-text">{copy.demoEmpty}</p>
            )}
          </div>

          {spotlightProject ? (
            <div className="card spotlight-card">
              <div className="section-header">
                <div>
                <p className="eyebrow">Spotlight</p>
                  <h3>{isEnglish ? "Project To Watch" : "当前最值得盯住的项目"}</h3>
                </div>
                <span className="pill pill-primary">{getStageLabel(spotlightProject.currentStage, locale)}</span>
              </div>
              <h4>{spotlightProject.name}</h4>
              <p className="project-summary">{spotlightProject.summary}</p>
              <div className="project-meta">
                <span>{getRoleLabel(spotlightProject.currentRole, locale)}</span>
                <span>{spotlightProject.progress}%</span>
              </div>
              <Link className="button button-primary inline-button" to={`/projects/${spotlightProject.id}`}>
                {isEnglish ? "Open room" : "进入观测室"}
              </Link>
            </div>
          ) : null}

          <div className="card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Local Agent Pulse</p>
                <h3>{copy.localMonitorTitle}</h3>
              </div>
              <Link className="button button-ghost inline-button" to="/system">
                {copy.openMonitor}
              </Link>
            </div>
            <p className="muted-text">{copy.localMonitorCopy}</p>
            <div className="metric-inline-grid">
              {(localMonitor?.tools ?? []).map((tool) => (
                <MetricInline
                  key={tool.tool}
                  label={tool.label}
                  value={`${tool.sessionCount} · ${tool.activeCount}/${tool.idleCount}/${tool.staleCount}`}
                />
              ))}
            </div>
            <div className="timeline-list">
              {(localMonitor?.sessions ?? []).slice(0, 4).map((session) => (
                <article key={session.id} className="timeline-item">
                  <div className="timeline-time">{formatTime(session.updatedAt, locale)}</div>
                  <div>
                    <div className="timeline-head">
                      <strong>{session.title}</strong>
                      <span className="pill">{session.tool} · {session.status}</span>
                    </div>
                    <p>{session.projectLabel || session.path}</p>
                  </div>
                </article>
              ))}
              {(localMonitor?.sessions.length ?? 0) === 0 ? (
                <p className="muted-text">{isEnglish ? "No recent local sessions were detected." : "当前还没有检测到最近的本地会话。"}</p>
              ) : null}
            </div>
          </div>

          <div className="card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Approval Queue</p>
                <h3>{isEnglish ? "Waiting For Decision" : "等待你确认"}</h3>
              </div>
            </div>
            <div className="card-list">
              {waitingProjects.map((project) => (
                <ProjectSummaryCard key={project.id} project={project} isEnglish={isEnglish} locale={locale} />
              ))}
              {waitingProjects.length === 0 ? <p className="muted-text">{isEnglish ? "No projects are waiting for approval." : "当前没有待审批项目。"}</p> : null}
            </div>
          </div>

          <div className="card">
            <div className="section-header">
              <div>
                <p className="eyebrow">System Health</p>
                <h3>{isEnglish ? "Health Snapshot" : "系统健康快照"}</h3>
              </div>
            </div>
            {health ? (
              <div className="stack tight">
                <div className="metric-inline-grid">
                  <MetricInline label={isEnglish ? "Blocked Tasks" : "阻塞任务"} value={String(health.blockedTasks)} />
                  <MetricInline label={isEnglish ? "Rejected Stages" : "返工阶段"} value={String(health.rejectedStages)} />
                  <MetricInline label={isEnglish ? "Avg Workload" : "平均负载"} value={`${health.averageAgentWorkload}%`} />
                </div>
                <div className="agent-mini-list">
                  {health.services.map((service) => (
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
              </div>
            ) : (
              <p className="muted-text">{isEnglish ? "Loading system health..." : "系统健康数据加载中。"}</p>
            )}
          </div>
        </div>
      </section>

      <section className="card ops-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Operations Desk</p>
            <h3>{isEnglish ? "Tasks And Risks" : "任务与风险总览"}</h3>
          </div>
          <div className="filter-row">
            <FilterButton
              active={taskFilter === "all"}
              label={isEnglish ? `All ${tasks.length}` : `全部 ${tasks.length}`}
              onClick={() => setTaskFilter("all")}
            />
            <FilterButton
              active={taskFilter === "blocked"}
              label={isEnglish ? `Blocked ${tasks.filter((task) => task.status === "blocked").length}` : `阻塞 ${tasks.filter((task) => task.status === "blocked").length}`}
              onClick={() => setTaskFilter("blocked")}
            />
            <FilterButton
              active={taskFilter === "in_progress"}
              label={isEnglish ? `In Progress ${tasks.filter((task) => task.status === "in_progress").length}` : `进行中 ${tasks.filter((task) => task.status === "in_progress").length}`}
              onClick={() => setTaskFilter("in_progress")}
            />
            <FilterButton
              active={taskFilter === "todo"}
              label={isEnglish ? `Todo ${tasks.filter((task) => task.status === "todo").length}` : `待开始 ${tasks.filter((task) => task.status === "todo").length}`}
              onClick={() => setTaskFilter("todo")}
            />
          </div>
        </div>

        <div className="ops-grid">
          <div className="attention-list">
            {attentionItems.map((item) => (
              <AttentionCard key={item.title} title={item.title} detail={item.detail} tone={item.tone} />
            ))}
          </div>

          <div className="task-monitor-grid">
            {visibleTasks.map((task) => (
              <TaskBoardCard key={task.id} task={task} locale={locale} isEnglish={isEnglish} />
            ))}
            {visibleTasks.length === 0 ? (
              <div className="empty-state">
                <span className="status-dot status-live" />
                {isEnglish ? "No tasks match the current filter." : "当前筛选条件下没有任务。"}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Active Projects</p>
            <h3>{isEnglish ? "Active Projects" : "实时推进中的项目"}</h3>
          </div>
        </div>

        <div className="project-grid">
          {activeProjects.map((project) => (
            <ProjectSummaryCard key={project.id} project={project} isEnglish={isEnglish} locale={locale} />
          ))}
          {activeProjects.length === 0 ? <p className="muted-text">{isEnglish ? "There are no active projects." : "当前没有活跃项目。"}</p> : null}
        </div>
      </section>

      <section className="card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Archive</p>
            <h3>{isEnglish ? "Recent Archive" : "最近归档"}</h3>
          </div>
        </div>
        <div className="project-grid">
          {archivedProjects.map((project) => (
            <ProjectSummaryCard key={project.id} project={project} isEnglish={isEnglish} locale={locale} />
          ))}
          {archivedProjects.length === 0 ? <p className="muted-text">{isEnglish ? "No archived projects yet." : "还没有归档项目。"}</p> : null}
        </div>
      </section>
    </div>
  );
}

function MetricCard({
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

function IntentGroup({
  title,
  items,
  danger = false
}: {
  title: string;
  items: string[];
  danger?: boolean;
}) {
  return (
    <div>
      <p className="group-title">{title}</p>
      <div className="pill-row">
        {items.map((item) => (
          <span key={item} className={danger ? "pill pill-danger" : "pill"}>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function ProjectSummaryCard({ project, isEnglish, locale }: { project: ProjectSummary; isEnglish: boolean; locale: "zh-CN" | "en-US" }) {
  return (
    <Link to={`/projects/${project.id}`} className="project-card">
      <div className="project-card-head">
        <div>
          <span className="project-id">{project.id}</span>
          <h4>{project.name}</h4>
        </div>
        <span className={project.pendingApproval ? "pill pill-warning" : "pill pill-primary"}>
          {project.pendingApproval ? (isEnglish ? "Waiting Approval" : "待审批") : (isEnglish ? "Running" : "执行中")}
        </span>
      </div>
      <p className="project-summary">{project.summary}</p>
      <div className="progress-row">
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${project.progress}%` }} />
        </div>
        <span>{project.progress}%</span>
      </div>
      <div className="project-meta">
        <span>{getStageLabel(project.currentStage, locale)}</span>
        <span>{getRoleLabel(project.currentRole, locale)}</span>
        <span>{isEnglish ? `${project.openTaskCount} tasks` : `${project.openTaskCount} 个任务`}</span>
      </div>
    </Link>
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

function DemoProjectCard({
  project,
  cta,
  isEnglish,
  locale
}: {
  project: OpenClawProjectSummary;
  cta: string;
  isEnglish: boolean;
  locale: "zh-CN" | "en-US";
}) {
  return (
    <Link to={`/openclaw?projectId=${encodeURIComponent(project.id)}`} className="demo-project-card">
      <div className="project-card-head">
        <div>
          <span className="project-id">{project.relativePath}</span>
          <h4>{project.name}</h4>
        </div>
        <span className={project.status === "blocked" ? "pill pill-danger" : project.status === "completed" ? "pill pill-success" : "pill pill-primary"}>
          {getOpenClawProjectStateLabel(project.status, locale)}
        </span>
      </div>
      <p className="project-summary">{project.description}</p>
      <div className="meta-strip meta-strip-compact">
        <MetricInline label={isEnglish ? "Progress" : "进度"} value={`${project.progress}%`} />
        <MetricInline label={isEnglish ? "Tasks" : "任务"} value={String(project.taskCount)} />
        <MetricInline label={isEnglish ? "Agents" : "Agent"} value={String(project.agentCount)} />
        <MetricInline label={isEnglish ? "Blockers" : "阻塞"} value={String(project.blockerCount)} />
      </div>
      {project.currentFocus ? <p className="highlight-text">{isEnglish ? `Current focus: ${project.currentFocus}` : `当前焦点：${project.currentFocus}`}</p> : null}
      <span className="module-link">{cta}</span>
    </Link>
  );
}

function FilterButton({
  active,
  label,
  onClick
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={active ? "filter-pill filter-pill-active" : "filter-pill"} onClick={onClick}>
      {label}
    </button>
  );
}

function AttentionCard({
  title,
  detail,
  tone
}: {
  title: string;
  detail: string;
  tone: "warning" | "danger" | "default";
}) {
  return (
    <article className={`attention-card attention-${tone}`}>
      <strong>{title}</strong>
      <p>{detail}</p>
    </article>
  );
}

function TaskBoardCard({
  task,
  locale,
  isEnglish
}: {
  task: TaskBoardItem;
  locale: "zh-CN" | "en-US";
  isEnglish: boolean;
}) {
  return (
    <Link to={`/projects/${task.projectId}`} className="task-board-card">
      <div className="deliverable-head">
        <div>
          <span className="project-id">{task.projectId}</span>
          <strong>{task.title}</strong>
        </div>
        <span className={`pill pill-task-${task.status}`}>{getTaskStatusLabel(task.status, locale)}</span>
      </div>
      <p className="project-summary">{task.description}</p>
      <div className="task-card-meta">
        <span className="pill">{task.projectName}</span>
        <span className="pill">{getStageLabel(task.stageType, locale)}</span>
        <span className="pill">{getRoleLabel(task.assignee, locale)}</span>
      </div>
      <div className="task-card-meta">
        <span className={task.priority === "high" ? "pill pill-warning" : "pill"}>
          {getTaskPriorityLabel(task.priority, locale)}
        </span>
        {task.projectPendingApproval ? <span className="pill pill-warning">{isEnglish ? "Project waiting approval" : "项目待审批"}</span> : null}
        <span className="muted-text">{isEnglish ? "Updated" : "更新于"} {formatTime(task.updatedAt, locale)}</span>
      </div>
    </Link>
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
