import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Activity, ChevronRight, FolderKanban, Sparkles, Workflow } from "lucide-react";
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
  const [searchParams, setSearchParams] = useSearchParams();
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
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
        demoTitle: "Workspace Spotlight",
        demoEmpty: "No OpenClaw workspace is connected yet. Create or import one to populate this panel.",
        openDemo: "Open Team Workspace",
        openSystem: "Open Operations",
        openAgents: "Open Agent Studio",
        openProjects: "Open Portfolio",
        openNotifications: "Open Notification Center",
        newProject: "New Project",
        projectComposer: "Turn one prompt into a formal project",
        preview: "Analyze Request",
        create: "Create Project",
        createBusy: "Creating...",
        orchestrationTitle: "Team orchestration",
        orchestrationCopy: "See how real OpenClaw projects, assigned agents, and current focus areas are moving together right now.",
        openNotificationsShort: "Notifications"
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
        demoTitle: "工作区焦点",
        demoEmpty: "当前还没有接入 OpenClaw 工作区项目，创建或导入后这里会自动展示。",
        openDemo: "进入团队工作区",
        openSystem: "进入系统运营",
        openAgents: "进入 Agent 工作台",
        openProjects: "进入项目组合",
        openNotifications: "进入通知中心",
        newProject: "New Project",
        projectComposer: "把一句想法变成正式项目",
        preview: "解析需求",
        create: "确认并创建项目",
        createBusy: "创建中...",
        orchestrationTitle: "团队协作编排",
        orchestrationCopy: "用一张总览看到真实 OpenClaw 项目、负责 Agent 和当前焦点如何同时推进。",
        openNotificationsShort: "通知中心"
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
    if (searchParams.get("compose") !== "project") {
      return;
    }

    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("compose");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

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
    () => pickFeaturedWorkspaceProject(workspace?.projects ?? []),
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
  const orchestrationProjects = useMemo(
    () =>
      (workspace?.projects ?? []).slice(0, 4).map((project) => ({
        ...project,
        matchedAgents: agents.filter(
          (agent) =>
            project.agentIds.includes(agent.agentId) ||
            agent.currentTask?.projectName === project.name
        )
      })),
    [agents, workspace?.projects]
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

  const activityFeed = [
    demoWorkspaceProject ? {
      key: `workspace:${demoWorkspaceProject.id}`,
      title: isEnglish ? "Workspace focus updated" : "工作区焦点已更新",
      detail: demoWorkspaceProject.currentFocus || demoWorkspaceProject.description,
      stamp: formatTime(demoWorkspaceProject.updatedAt, locale),
      tone: demoWorkspaceProject.blockerCount > 0 ? "warning" as const : "default" as const
    } : null,
    (localMonitor?.sessions?.[0]) ? {
      key: `local:${localMonitor.sessions[0].id}`,
      title: isEnglish ? "Local session active" : "本地会话仍在活跃",
      detail: localMonitor.sessions[0].projectLabel || localMonitor.sessions[0].path,
      stamp: formatTime(localMonitor.sessions[0].updatedAt, locale),
      tone: localMonitor.sessions[0].status === "active" ? "default" as const : "warning" as const
    } : null,
    waitingProjects[0] ? {
      key: `approval:${waitingProjects[0].id}`,
      title: isEnglish ? "Approval is waiting" : "存在待确认项目",
      detail: `${waitingProjects[0].name} · ${getStageLabel(waitingProjects[0].currentStage, locale)}`,
      stamp: formatTime(waitingProjects[0].updatedAt, locale),
      tone: "warning" as const
    } : null,
    (health?.services?.[0]) ? {
      key: `service:${health.services[0].name}`,
      title: isEnglish ? "Runtime service check" : "运行服务检查",
      detail: `${health.services[0].name} · ${health.services[0].detail}`,
      stamp: lastSyncedAt ? formatTime(lastSyncedAt, locale) : (isEnglish ? "just now" : "刚刚"),
      tone: health.services[0].status === "healthy" ? "default" as const : "danger" as const
    } : null
  ].filter(Boolean) as Array<{ key: string; title: string; detail: string; stamp: string; tone: "default" | "warning" | "danger" }>;

  return (
    <div className="page dashboard-studio-page">
      <header className="page-header studio-page-header">
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
        </div>
        <div className="studio-header-actions">
          <span className="muted-text">
            {isEnglish ? "Last sync:" : "最近同步："}{lastSyncedAt ? formatTime(lastSyncedAt, locale) : (isEnglish ? "Not yet" : "尚未同步")}
          </span>
          <Link className="button button-ghost inline-button" to="/notifications">
            {copy.openNotificationsShort}
          </Link>
          <button className="button button-ghost inline-button" onClick={() => void refresh()}>
            {copy.refresh}
          </button>
        </div>
      </header>

      <section className="studio-kpi-grid">
        <MetricCard label={copy.activeProjects} value={String(activeProjects.length)} />
        <MetricCard label={copy.approvals} value={String(waitingProjects.length)} tone="warning" />
        <MetricCard label={copy.activeTasks} value={String(health?.activeTasks ?? 0)} />
        <MetricCard label={copy.onlineAgents} value={String(agents.filter((item) => item.status !== "offline").length)} />
      </section>

      <section className="dashboard-studio-layout">
        <div className="dashboard-studio-main">
          <section className="card studio-command-card dashboard-hero-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.newProject}</p>
                <h3>{copy.projectComposer}</h3>
                <p className="hero-copy">
                  {isEnglish
                    ? "Start from one sentence, generate an understanding card, and turn it into a structured project without leaving the dashboard."
                    : "从一句需求开始，先生成理解卡，再在首页直接转成结构化项目。"}
                </p>
              </div>
              <button className="button button-ghost" onClick={handlePreview} disabled={loadingPreview}>
                {loadingPreview ? (isEnglish ? "Analyzing..." : "解析中...") : copy.preview}
              </button>
            </div>

            <div className="dashboard-hero-context">
              <div className="dashboard-hero-context-card">
                <span>{isEnglish ? "Runtime mode" : "运行模式"}</span>
                <strong>{runtime?.mode ?? (isEnglish ? "Unknown" : "未知")}</strong>
                <p>{runtime?.configured ? (runtime.modelName || (isEnglish ? "Model configured" : "模型已配置")) : (isEnglish ? "Fallback agent is currently active." : "当前由回退 Agent 承接执行。")}</p>
              </div>
              <div className="dashboard-hero-context-card">
                <span>{isEnglish ? "Workspace connected" : "工作区接入"}</span>
                <strong>{workspace?.projects.length ?? 0} / {workspace?.agents.length ?? 0}</strong>
                <p>{isEnglish ? "Live OpenClaw projects and managed agents are already synchronized." : "真实 OpenClaw 项目与受管 Agent 已处于同步状态。"}</p>
              </div>
              <div className="dashboard-hero-context-card">
                <span>{isEnglish ? "Approval pressure" : "审批压力"}</span>
                <strong>{waitingProjects.length}</strong>
                <p>{waitingProjects.length > 0
                  ? (isEnglish ? "There are pending decisions blocking downstream execution." : "当前存在会阻断后续推进的待决策项目。")
                  : (isEnglish ? "No approvals are currently blocking progress." : "当前没有审批闸口阻塞推进。")}</p>
              </div>
            </div>

            <div className="dashboard-hero-grid">
              <div className="dashboard-compose-stack">
                <textarea
                  ref={composerRef}
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
                  <div className="dashboard-zero-card">
                    <span className="status-dot status-warning" />
                    <div>
                      <strong>{isEnglish ? "No understanding card yet" : "尚未生成理解卡"}</strong>
                      <p>{isEnglish ? 'Click "Analyze Request" to generate a structured understanding card here.' : '点击“解析需求”后，这里会出现结构化理解确认卡。'}</p>
                    </div>
                  </div>
                )}

                {error ? <p className="error-text">{error}</p> : null}
              </div>

              <div className="dashboard-hero-side">
                {demoWorkspaceProject ? (
                  <WorkspaceShowcaseCard project={demoWorkspaceProject} cta={copy.openDemo} isEnglish={isEnglish} locale={locale} />
                ) : (
                  <div className="dashboard-zero-card">
                    <span className="status-dot status-live" />
                    <div>
                      <strong>{copy.demoTitle}</strong>
                      <p>{copy.demoEmpty}</p>
                    </div>
                  </div>
                )}

                <div className="dashboard-signal-stack">
                  <div className="dashboard-hero-side-card">
                    <div className="section-header">
                      <div>
                        <p className="eyebrow">{isEnglish ? "Operator lane" : "指挥官情报"}</p>
                        <h3>{isEnglish ? "What needs attention first" : "当前先处理什么"}</h3>
                      </div>
                      <span className="pill pill-warning">{attentionItems.length}</span>
                    </div>
                    <div className="attention-list">
                      {attentionItems.slice(0, 2).map((item) => (
                        <AttentionCard key={item.title} title={item.title} detail={item.detail} tone={item.tone} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="card studio-command-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Active Projects</p>
                <h3>{isEnglish ? "Active Projects" : "实时推进中的项目"}</h3>
              </div>
              <Link className="button button-ghost inline-button" to="/projects">
                {copy.openProjects}
              </Link>
            </div>

            <div className="showcase-grid">
              {activeProjects.map((project) => (
                <DashboardProjectCard key={project.id} project={project} isEnglish={isEnglish} locale={locale} />
              ))}
              {activeProjects.length === 0 ? <p className="muted-text">{isEnglish ? "There are no active projects." : "当前没有活跃项目。"}</p> : null}
            </div>
          </section>

          <section className="card studio-command-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">{copy.orchestrationTitle}</p>
                <h3>{copy.orchestrationTitle}</h3>
                <p className="hero-copy">{copy.orchestrationCopy}</p>
              </div>
              <Link className="button button-ghost inline-button" to="/agents">
                {copy.openAgents}
              </Link>
            </div>
            <div className="orchestration-grid">
              {orchestrationProjects.map((project) => (
                <article key={project.id} className="orchestration-card">
                  <div className="timeline-head">
                    <div>
                      <span className="project-id">{project.relativePath}</span>
                      <strong>{project.name}</strong>
                    </div>
                    <span className={project.blockerCount > 0 ? "pill pill-warning" : "pill pill-primary"}>
                      {getOpenClawProjectStateLabel(project.status, locale)}
                    </span>
                  </div>
                  <p className="project-summary">{project.currentFocus || project.description}</p>
                  <div className="progress-row">
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${Math.max(4, project.progress)}%` }} />
                    </div>
                    <span>{project.progress}%</span>
                  </div>
                  <div className="pill-row">
                    {project.matchedAgents.slice(0, 4).map((agent) => (
                      <Link key={agent.agentId} to={`/agents/${agent.agentId}`} className="pill">
                        {agent.emoji} {agent.name}
                      </Link>
                    ))}
                    {project.matchedAgents.length === 0 ? <span className="pill">{isEnglish ? "No mapped agent yet" : "尚无映射 Agent"}</span> : null}
                  </div>
                  <div className="project-meta">
                    <span>{isEnglish ? `${project.taskCount} tasks` : `${project.taskCount} 个任务`}</span>
                    <span>{isEnglish ? `${project.blockerCount} blockers` : `${project.blockerCount} 个阻塞`}</span>
                  </div>
                </article>
              ))}
              {orchestrationProjects.length === 0 ? (
                <div className="empty-state">{isEnglish ? "No OpenClaw projects are available for orchestration yet." : "当前还没有可编排展示的 OpenClaw 项目。"}</div>
              ) : null}
            </div>
          </section>

          <section className="card ops-card studio-command-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Operations Desk</p>
                <h3>{isEnglish ? "Tasks And Risks" : "任务与风险总览"}</h3>
              </div>
              <div className="filter-row">
                <FilterButton active={taskFilter === "all"} label={isEnglish ? `All ${tasks.length}` : `全部 ${tasks.length}`} onClick={() => setTaskFilter("all")} />
                <FilterButton active={taskFilter === "blocked"} label={isEnglish ? `Blocked ${tasks.filter((task) => task.status === "blocked").length}` : `阻塞 ${tasks.filter((task) => task.status === "blocked").length}`} onClick={() => setTaskFilter("blocked")} />
                <FilterButton active={taskFilter === "in_progress"} label={isEnglish ? `In Progress ${tasks.filter((task) => task.status === "in_progress").length}` : `进行中 ${tasks.filter((task) => task.status === "in_progress").length}`} onClick={() => setTaskFilter("in_progress")} />
                <FilterButton active={taskFilter === "todo"} label={isEnglish ? `Todo ${tasks.filter((task) => task.status === "todo").length}` : `待开始 ${tasks.filter((task) => task.status === "todo").length}`} onClick={() => setTaskFilter("todo")} />
              </div>
            </div>

            <div className="dashboard-ops-grid">
              <div className="attention-list">
                {attentionItems.map((item) => (
                  <AttentionCard key={item.title} title={item.title} detail={item.detail} tone={item.tone} />
                ))}
              </div>

              <div className="showcase-grid showcase-grid-compact">
                {visibleTasks.map((task) => (
                  <DashboardTaskCard key={task.id} task={task} locale={locale} isEnglish={isEnglish} />
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
        </div>

        <aside className="dashboard-studio-rail">
          <div className="card studio-side-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Recent Activity</p>
                <h3>{isEnglish ? "Operational timeline" : "运行时间线"}</h3>
              </div>
              <span className="pill">{activityFeed.length}</span>
            </div>
            <p className="dashboard-rail-copy">{isEnglish ? "Read this like an operator log so you can see project, workspace, and runtime changes in one stream." : "把这里当成运营时间线来看，就能在一条流里读到项目、工作区与运行态变化。"}</p>
            <div className="dashboard-activity-feed">
              {activityFeed.map((item) => (
                <DashboardActivityItem key={item.key} title={item.title} detail={item.detail} stamp={item.stamp} tone={item.tone} />
              ))}
              {activityFeed.length === 0 ? <p className="muted-text">{isEnglish ? "No live activity detected yet." : "暂未检测到实时动态。"}</p> : null}
            </div>
          </div>

          <div className="card studio-side-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Modules</p>
                <h3>{copy.modulesTitle}</h3>
              </div>
              <span className="pill">{workspaceModuleCards.length}</span>
            </div>
            <p className="dashboard-rail-copy">{copy.modulesCopy}</p>
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

          <div className="card studio-side-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Local Agent Pulse</p>
                <h3>{copy.localMonitorTitle}</h3>
              </div>
              <Link className="button button-ghost inline-button" to="/system">
                {copy.openMonitor}
              </Link>
            </div>
            <p className="dashboard-rail-copy">{copy.localMonitorCopy}</p>
            <div className="dashboard-mini-grid">
              {(localMonitor?.tools ?? []).map((tool) => (
                <MetricInline key={tool.tool} label={tool.label} value={`${tool.sessionCount} · ${tool.activeCount}/${tool.idleCount}/${tool.staleCount}`} />
              ))}
            </div>
            <div className="dashboard-session-list">
              {(localMonitor?.sessions ?? []).slice(0, 4).map((session) => (
                <DashboardSessionCard key={session.id} title={session.title} detail={session.projectLabel || session.path} stamp={formatTime(session.updatedAt, locale)} pill={`${session.tool} · ${session.status}`} />
              ))}
              {(localMonitor?.sessions.length ?? 0) === 0 ? (
                <p className="muted-text">{isEnglish ? "No recent local sessions were detected." : "当前还没有检测到最近的本地会话。"}</p>
              ) : null}
            </div>
          </div>

          <div className="card studio-side-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Approval Queue</p>
                <h3>{isEnglish ? "Waiting For Decision" : "等待你确认"}</h3>
              </div>
              <span className="pill pill-warning">{waitingProjects.length}</span>
            </div>
            <p className="dashboard-rail-copy">{isEnglish ? "Projects landing here are paused on approval or rejection, so this queue acts like a real execution gate." : "进入这里的项目都卡在审批或驳回节点，所以这条队列本质上就是执行闸口。"}</p>
            <div className="dashboard-queue-list">
              {waitingProjects.map((project) => (
                <DashboardQueueCard key={project.id} project={project} isEnglish={isEnglish} locale={locale} />
              ))}
              {waitingProjects.length === 0 ? <p className="muted-text">{isEnglish ? "No projects are waiting for approval." : "当前没有待审批项目。"}</p> : null}
            </div>
          </div>

          <div className="card studio-side-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">System Health</p>
                <h3>{isEnglish ? "Health Snapshot" : "系统健康快照"}</h3>
              </div>
              <span className={health && health.blockedTasks > 0 ? "pill pill-warning" : "pill pill-success"}>
                {health && health.blockedTasks > 0 ? (isEnglish ? "Attention" : "需关注") : (isEnglish ? "Healthy" : "健康")}
              </span>
            </div>
            {health ? (
              <div className="stack tight">
                <p className="dashboard-rail-copy">{isEnglish ? "This card compresses runtime health, stage rejection signals, and average team load into one fast operator view." : "这张卡把运行健康、阶段返工信号与团队平均负载压缩成一个快速运营视图。"}</p>
                <div className="dashboard-mini-grid">
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

          {spotlightProject ? (
            <div className="card spotlight-card studio-side-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Spotlight</p>
                  <h3>{isEnglish ? "Project To Watch" : "当前最值得盯住的项目"}</h3>
                </div>
                <span className="pill pill-primary">{getStageLabel(spotlightProject.currentStage, locale)}</span>
              </div>
              <p className="dashboard-rail-copy">{isEnglish ? "This spotlight keeps one high-value project visible so the dashboard always has a current command focal point." : "这里固定突出一个高价值项目，让首页始终保留一个当前指挥焦点。"}</p>
              <DashboardProjectCard project={spotlightProject} isEnglish={isEnglish} locale={locale} spotlight />
            </div>
          ) : null}

          <div className="card studio-side-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">Archive</p>
                <h3>{isEnglish ? "Recent Archive" : "最近归档"}</h3>
              </div>
              <span className="pill">{archivedProjects.length}</span>
            </div>
            <p className="dashboard-rail-copy">{isEnglish ? "Keep recent closed work visible so teams can review what shipped and what patterns are becoming reusable." : "保留最近归档内容，方便团队回看已交付成果与可复用模式。"}</p>
            <div className="showcase-grid showcase-grid-compact">
              {archivedProjects.map((project) => (
                <DashboardProjectCard key={project.id} project={project} isEnglish={isEnglish} locale={locale} archived />
              ))}
              {archivedProjects.length === 0 ? <p className="muted-text">{isEnglish ? "No archived projects yet." : "还没有归档项目。"}</p> : null}
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}

function pickFeaturedWorkspaceProject(projects: OpenClawProjectSummary[]) {
  if (projects.length === 0) {
    return null;
  }

  const explicitDemo = projects.find((project) =>
    project.relativePath.includes("test-saas-demo-20260325") ||
    project.name.toLowerCase().includes("test")
  );

  if (explicitDemo) {
    return explicitDemo;
  }

  return [...projects].sort((left, right) => {
    const leftScore = (left.blockerCount > 0 ? 20 : 0) + left.progress;
    const rightScore = (right.blockerCount > 0 ? 20 : 0) + right.progress;

    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    return right.updatedAt.localeCompare(left.updatedAt);
  })[0] ?? null;
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

function DashboardProjectCard({
  project,
  isEnglish,
  locale,
  archived = false,
  spotlight = false
}: {
  project: ProjectSummary;
  isEnglish: boolean;
  locale: "zh-CN" | "en-US";
  archived?: boolean;
  spotlight?: boolean;
}) {
  const Icon = archived ? Workflow : spotlight ? Sparkles : FolderKanban;

  return (
    <Link to={`/projects/${project.id}`} className={`showcase-card ${archived ? "showcase-card-success" : ""} ${spotlight ? "dashboard-spotlight-card" : ""}`}>
      <div className={`showcase-accent ${archived ? "showcase-accent-completed" : "showcase-accent-working"}`} />
      <div className="showcase-header">
        <div className="showcase-icon">
          <Icon size={22} />
        </div>
        <div className="showcase-header-side">
          <span className={project.pendingApproval ? "pill pill-warning" : archived ? "pill pill-success" : "pill pill-primary"}>
            {project.pendingApproval ? (isEnglish ? "Waiting Approval" : "待审批") : archived ? (isEnglish ? "Archived" : "已归档") : (isEnglish ? "Running" : "执行中")}
          </span>
        </div>
      </div>

      <div className="showcase-body">
        <div className="showcase-title-block">
          <span className="project-id">{project.id}</span>
          <h3>{project.name}</h3>
          <p>{project.summary}</p>
        </div>

        <div className="showcase-focus-block">
          <span>{isEnglish ? "Current ownership" : "当前责任角色"}</span>
          <strong>{getRoleLabel(project.currentRole, locale)}</strong>
          <span className="muted-text">{getStageLabel(project.currentStage, locale)}</span>
        </div>

        <div className="showcase-progress">
          <div className="progress-row">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${project.progress}%` }} />
            </div>
            <span>{project.progress}%</span>
          </div>
        </div>

        <div className="showcase-metrics-grid">
          <MiniPanelMetric label={isEnglish ? "Stage" : "阶段"} value={getStageLabel(project.currentStage, locale)} />
          <MiniPanelMetric label={isEnglish ? "Role" : "角色"} value={getRoleLabel(project.currentRole, locale)} />
          <MiniPanelMetric label={isEnglish ? "Tasks" : "任务"} value={String(project.openTaskCount)} />
          <MiniPanelMetric label={isEnglish ? "Updated" : "更新"} value={formatTime(project.updatedAt, locale)} />
        </div>
      </div>

      <div className="showcase-link">
        <span>{isEnglish ? "Open room" : "进入观测室"}</span>
        <ChevronRight size={18} />
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

function WorkspaceShowcaseCard({
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
    <Link to={`/openclaw?projectId=${encodeURIComponent(project.id)}`} className={`showcase-card ${project.blockerCount > 0 ? "showcase-card-warning" : ""}`}>
      <div className={`showcase-accent ${project.status === "completed" ? "showcase-accent-completed" : project.blockerCount > 0 ? "showcase-accent-paused" : "showcase-accent-working"}`} />
      <div className="showcase-header">
        <div className="showcase-icon">
          <Sparkles size={22} />
        </div>
        <div className="showcase-header-side">
          <span className={project.status === "blocked" ? "pill pill-danger" : project.status === "completed" ? "pill pill-success" : "pill pill-primary"}>
            {getOpenClawProjectStateLabel(project.status, locale)}
          </span>
        </div>
      </div>

      <div className="showcase-body">
        <div className="showcase-title-block">
          <span className="project-id">{project.relativePath}</span>
          <h3>{project.name}</h3>
          <p>{project.description}</p>
        </div>

        <div className="showcase-focus-block">
          <span>{isEnglish ? "Current focus" : "当前焦点"}</span>
          <strong>{project.currentFocus || project.relativePath}</strong>
          <span className="muted-text">{formatTime(project.updatedAt, locale)}</span>
        </div>

        <div className="showcase-metrics-grid">
          <MiniPanelMetric label={isEnglish ? "Progress" : "进度"} value={`${project.progress}%`} />
          <MiniPanelMetric label={isEnglish ? "Tasks" : "任务"} value={String(project.taskCount)} />
          <MiniPanelMetric label={isEnglish ? "Agents" : "Agent"} value={String(project.agentCount)} />
          <MiniPanelMetric label={isEnglish ? "Blockers" : "阻塞"} value={String(project.blockerCount)} />
        </div>
      </div>

      <div className="showcase-link">
        <span>{cta}</span>
        <ChevronRight size={18} />
      </div>
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

function DashboardTaskCard({
  task,
  locale,
  isEnglish
}: {
  task: TaskBoardItem;
  locale: "zh-CN" | "en-US";
  isEnglish: boolean;
}) {
  return (
    <Link to={`/projects/${task.projectId}`} className={`showcase-card dashboard-task-card ${task.status === "blocked" ? "showcase-card-warning" : ""}`}>
      <div className={`showcase-accent ${task.status === "done" ? "showcase-accent-completed" : task.status === "blocked" ? "showcase-accent-paused" : "showcase-accent-working"}`} />
      <div className="showcase-header">
        <div className="showcase-icon">
          <Activity size={22} />
        </div>
        <div className="showcase-header-side">
          <span className={`pill pill-task-${task.status}`}>{getTaskStatusLabel(task.status, locale)}</span>
        </div>
      </div>

      <div className="showcase-body">
        <div className="showcase-title-block">
          <span className="project-id">{task.projectId}</span>
          <h3>{task.title}</h3>
          <p>{task.description}</p>
        </div>

        <div className="showcase-focus-block">
          <span>{task.projectName}</span>
          <strong>{getStageLabel(task.stageType, locale)}</strong>
          <span className="muted-text">{getRoleLabel(task.assignee, locale)}</span>
        </div>

        <div className="pill-row">
          <span className={task.priority === "high" ? "pill pill-warning" : "pill"}>
            {getTaskPriorityLabel(task.priority, locale)}
          </span>
          {task.projectPendingApproval ? <span className="pill pill-warning">{isEnglish ? "Project waiting approval" : "项目待审批"}</span> : null}
        </div>

        <div className="showcase-footer">
          <div className="showcase-footer-copy">
            <span>{isEnglish ? "Updated" : "更新于"}</span>
            <strong>{formatTime(task.updatedAt, locale)}</strong>
          </div>
          <ChevronRight size={18} />
        </div>
      </div>
    </Link>
  );
}

function DashboardQueueCard({
  project,
  isEnglish,
  locale
}: {
  project: ProjectSummary;
  isEnglish: boolean;
  locale: "zh-CN" | "en-US";
}) {
  return (
    <Link to={`/projects/${project.id}`} className="dashboard-queue-card">
      <div className="dashboard-queue-card-main">
        <span className="project-id">{project.id}</span>
        <strong>{project.name}</strong>
        <p>{project.summary}</p>
      </div>
      <div className="dashboard-queue-card-side">
        <span className="pill pill-warning">{getStageLabel(project.currentStage, locale)}</span>
        <span className="muted-text">{isEnglish ? `${project.openTaskCount} tasks` : `${project.openTaskCount} 个任务`}</span>
      </div>
    </Link>
  );
}

function DashboardSessionCard({
  title,
  detail,
  stamp,
  pill
}: {
  title: string;
  detail: string;
  stamp: string;
  pill: string;
}) {
  return (
    <article className="dashboard-session-card">
      <div className="dashboard-session-main">
        <div className="timeline-head">
          <strong>{title}</strong>
          <span className="pill">{pill}</span>
        </div>
        <p>{detail}</p>
      </div>
      <span className="timeline-time">{stamp}</span>
    </article>
  );
}

function DashboardActivityItem({
  title,
  detail,
  stamp,
  tone
}: {
  title: string;
  detail: string;
  stamp: string;
  tone: "default" | "warning" | "danger";
}) {
  return (
    <article className={`dashboard-activity-item dashboard-activity-${tone}`}>
      <div className="dashboard-activity-dot" />
      <div className="dashboard-activity-copy">
        <div className="timeline-head">
          <strong>{title}</strong>
          <span className="timeline-time">{stamp}</span>
        </div>
        <p>{detail}</p>
      </div>
    </article>
  );
}

function MiniPanelMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="showcase-metric">
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
