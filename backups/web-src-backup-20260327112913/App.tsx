import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type { AuthStatus, OpenClawAgentSummary, ProjectSummary } from "@occ/shared";
import {
  Activity,
  Bell,
  Bot,
  ChevronDown,
  Circle,
  Database,
  FolderKanban,
  Hash,
  History,
  LayoutDashboard,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  TerminalSquare
} from "lucide-react";
import { DashboardPage } from "./pages/DashboardPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectRoomPage } from "./pages/ProjectRoomPage";
import { AgentsPage } from "./pages/AgentsPage";
import { AgentCommanderPage } from "./pages/AgentCommanderPage";
import { SystemPage } from "./pages/SystemPage";
import { AuditPage } from "./pages/AuditPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AuthPage } from "./pages/AuthPage";
import { OpenClawPage } from "./pages/OpenClawPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { api } from "./lib/api";
import { useLocale } from "./lib/locale";

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { locale, setLocale, isEnglish } = useLocale();
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [allProjects, setAllProjects] = useState<ProjectSummary[]>([]);
  const [allAgents, setAllAgents] = useState<OpenClawAgentSummary[]>([]);
  const [sidebarProjects, setSidebarProjects] = useState<ProjectSummary[]>([]);
  const [sidebarAgents, setSidebarAgents] = useState<OpenClawAgentSummary[]>([]);
  const [globalSearch, setGlobalSearch] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const shellSearchRef = useRef<HTMLDivElement | null>(null);
  const shortcutPopoverRef = useRef<HTMLDivElement | null>(null);

  const copy = isEnglish
    ? {
        checking: "Checking authentication...",
        authUnavailable: "Authentication state is unavailable",
        shellEyebrow: "AI Team OS",
        title: "OpenClaw Control Center",
        subtitle: "A SaaS-style workspace for projects, agents, runtime operations, and delivery monitoring.",
        navigation: "Navigation",
        dashboard: "Executive Hub",
        projects: "Project Portfolio",
        openclaw: "Team Workspace",
        agents: "Agent Studio",
        notifications: "Notification Center",
        system: "Operations",
        audit: "Audit Trail",
        settings: "Settings",
        workspaceTitle: "Workspace",
        workspaceCopy: "Manage a live AI team through portfolio, delivery, and runtime modules.",
        shellSearch: "Search projects, agents, memory, or logs",
        workspaceSearchHint: "Search",
        quickActions: "Quick actions",
        openAudit: "Open audit trail",
        openSystem: "Open operations",
        recentAlerts: "Workbench shortcuts",
        noSearchResults: "No matching pages, projects, or agents.",
        recentProjects: "Live Projects",
        recentAgents: "Agent Roster",
        workspaceMenu: "OpenClaw Workspace",
        newProject: "New project",
        addAgent: "Add agent",
        commanderName: "Commander",
        commanderLevel: "Level 4 Access",
        workspaces: "Workspaces",
        workspacePrimary: "OpenClaw",
        workspaceSecondary: "Strategy",
        workspaceData: "Memory Grid",
        topbarBadge: "v1.0.0",
        topbarTitle: "Agent Collaboration Workbench",
        languageLabel: "Language",
        logout: "Sign out",
        statusTitle: "Live Runtime",
        statusCopy: "OpenClaw workspace sync, task writeback, and agent command relay are enabled.",
        pageTitles: {
          "/": "Executive Hub",
          "/projects": "Project Portfolio",
          "/projects/:projectId": "Project Room",
          "/openclaw": "Team Workspace",
          "/agents": "Agent Studio",
          "/agents/:agentId": "Agent Commander",
          "/notifications": "Notification Center",
          "/system": "Operations",
          "/audit": "Audit Trail",
          "/settings": "Settings"
        } as Record<string, string>,
        pageDescriptions: {
          "/": "Start from modules, spotlight projects, and guided entry points.",
          "/projects": "Browse product projects and real OpenClaw workspaces in one portfolio view.",
          "/projects/:projectId": "Inspect delivery stages, approvals, tasks, and live project execution.",
          "/openclaw": "Inspect project delivery, team load, and real OpenClaw artifacts.",
          "/agents": "Review active agents, load, capability, and current task context.",
          "/agents/:agentId": "Switch models, preview instructions, confirm execution, and edit SOUL or SOP for one agent.",
          "/notifications": "See runtime, approval, agent-load, and governance alerts in one operator inbox.",
          "/system": "Manage runtime health, release readiness, and model connectivity.",
          "/audit": "Review critical operations, configuration changes, and agent command traces.",
          "/settings": "Adjust language, workspace defaults, and operator-level preferences."
        } as Record<string, string>,
        pageFallback: "Project Room",
        pageFallbackCopy: "Live room for approvals, intervention, and stage tracking."
      }
    : {
        checking: "正在检查登录状态...",
        authUnavailable: "认证状态不可用",
        shellEyebrow: "AI Team OS",
        title: "OpenClaw 控制中心",
        subtitle: "把项目、Agent、交付物、运行态与操作控制都放进一个更像 SaaS 的管理工作台里。",
        navigation: "导航",
        dashboard: "总控首页",
        projects: "项目组合",
        openclaw: "团队工作区",
        agents: "Agent 工作台",
        notifications: "通知中心",
        system: "系统运营",
        audit: "审计轨迹",
        settings: "设置",
        workspaceTitle: "工作区",
        workspaceCopy: "面向真实协作团队的项目组合、交付跟踪和运行管理入口。",
        shellSearch: "搜索项目、Agent、记忆或日志",
        workspaceSearchHint: "搜索",
        quickActions: "快捷动作",
        openAudit: "进入审计轨迹",
        openSystem: "进入系统运营",
        recentAlerts: "工作台快捷入口",
        noSearchResults: "没有匹配的页面、项目或 Agent。",
        recentProjects: "在线项目",
        recentAgents: "Agent 名册",
        workspaceMenu: "OpenClaw 工作区",
        newProject: "新建项目",
        addAgent: "新增 Agent",
        commanderName: "Commander",
        commanderLevel: "四级指挥权限",
        workspaces: "工作域",
        workspacePrimary: "OpenClaw",
        workspaceSecondary: "策略台",
        workspaceData: "记忆仓",
        topbarBadge: "v1.0.0",
        topbarTitle: "Agent 协作工作台",
        languageLabel: "语言",
        logout: "退出登录",
        statusTitle: "实时运行态",
        statusCopy: "已启用 OpenClaw 工作区同步、任务回写、Agent 指令转发。",
        pageTitles: {
          "/": "总控首页",
          "/projects": "项目组合",
          "/projects/:projectId": "项目作战室",
          "/openclaw": "团队工作区",
          "/agents": "Agent 工作台",
          "/agents/:agentId": "Agent 指挥页",
          "/notifications": "通知中心",
          "/system": "系统运营",
          "/audit": "审计轨迹",
          "/settings": "设置"
        } as Record<string, string>,
        pageDescriptions: {
          "/": "从模块入口、演示项目和重点任务开始进入系统。",
          "/projects": "统一查看应用项目与真实 OpenClaw 工作区项目。",
          "/projects/:projectId": "查看阶段推进、审批、任务与交付物的真实作战状态。",
          "/openclaw": "查看真实项目、交付物、团队承载和 OpenClaw 协作状态。",
          "/agents": "查看 Agent 画像、负载、当前任务与会话轨迹。",
          "/agents/:agentId": "单独切换模型、预览理解确认、下发任务，并编辑该 Agent 的 SOUL 与 SOP。",
          "/notifications": "在统一运营收件箱里查看运行风险、审批积压、Agent 负载和治理事件。",
          "/system": "管理运行配置、健康状态与发布前检查。",
          "/audit": "追踪关键动作、配置变更和 Agent 指令下发记录。",
          "/settings": "管理语言、工作区默认设置与指挥官偏好。"
        } as Record<string, string>,
        pageFallback: "项目作战室",
        pageFallbackCopy: "用于审批、介入、阶段推进与实时观测。"
      };

  useEffect(() => {
    void api
      .getAuthStatus()
      .then((status) => {
        setAuthStatus(status);
        setAuthError(null);
      })
      .catch((error) => {
        setAuthError(error instanceof Error ? error.message : "无法连接到认证服务");
      })
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    if (!authStatus?.authenticated) {
      return;
    }

    void Promise.all([api.getProjects(), api.getOpenClawAgents()])
      .then(([projects, agents]) => {
        setAllProjects(projects);
        setAllAgents(agents);
        setSidebarProjects(projects.slice(0, 6));
        setSidebarAgents(agents.slice(0, 8));
      })
      .catch(() => {
        setAllProjects([]);
        setAllAgents([]);
        setSidebarProjects([]);
        setSidebarAgents([]);
      });
  }, [authStatus?.authenticated]);

  useEffect(() => {
    setNotificationsOpen(false);
    setGlobalSearch("");
  }, [location.pathname]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;

      if (shellSearchRef.current && !shellSearchRef.current.contains(target)) {
        setGlobalSearch("");
      }

      if (shortcutPopoverRef.current && !shortcutPopoverRef.current.contains(target)) {
        setNotificationsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setGlobalSearch("");
        setNotificationsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  async function handleLogout() {
    await api.logoutAuth();
    setAuthStatus(await api.getAuthStatus());
  }

  const topbarCopy = useMemo(() => {
    const normalizedPath = location.pathname.startsWith("/agents/")
      ? "/agents/:agentId"
      : location.pathname.startsWith("/projects/")
        ? "/projects/:projectId"
      : location.pathname;
    const title = copy.pageTitles[normalizedPath] ?? copy.pageFallback;
    const description = copy.pageDescriptions[normalizedPath] ?? copy.pageFallbackCopy;
    return { title, description };
  }, [copy.pageDescriptions, copy.pageFallback, copy.pageFallbackCopy, copy.pageTitles, location.pathname]);

  const navItems = useMemo(() => [
    { to: "/", label: copy.dashboard, description: isEnglish ? "Overview and active command loops." : "总览与活跃指挥回路。", icon: LayoutDashboard },
    { to: "/projects", label: copy.projects, description: isEnglish ? "Portfolio, delivery and mission flow." : "项目组合、交付和任务流。", icon: FolderKanban },
    { to: "/openclaw", label: copy.openclaw, description: isEnglish ? "Workspace sync and field execution." : "工作区同步与现场执行。", icon: TerminalSquare },
    { to: "/agents", label: copy.agents, description: isEnglish ? "Models, roles and command settings." : "模型、角色和指挥配置。", icon: Bot },
    { to: "/notifications", label: copy.notifications, description: isEnglish ? "Alerts, approvals and operator signals." : "告警、审批与运营信号。", icon: Bell },
    { to: "/system", label: copy.system, description: isEnglish ? "Runtime, health, costs and release." : "运行、健康、成本与发布。", icon: Activity },
    { to: "/audit", label: copy.audit, description: isEnglish ? "Critical actions and governance trail." : "关键动作与治理轨迹。", icon: History },
    { to: "/settings", label: copy.settings, description: isEnglish ? "Preferences and workspace defaults." : "偏好与工作区默认配置。", icon: Settings }
  ], [copy.agents, copy.audit, copy.dashboard, copy.notifications, copy.openclaw, copy.projects, copy.settings, copy.system, isEnglish]);

  const workspaceSwitchers = useMemo(() => [
    { id: "openclaw", label: copy.workspacePrimary, icon: TerminalSquare, tone: "workspace-switcher-active", to: "/openclaw" },
    { id: "strategy", label: copy.workspaceSecondary, icon: ShieldCheck, tone: "workspace-switcher-strategy", to: "/system" },
    { id: "memory", label: copy.workspaceData, icon: Database, tone: "workspace-switcher-data", to: "/agents" }
  ], [copy.workspaceData, copy.workspacePrimary, copy.workspaceSecondary]);

  const activeWorkspaceId = useMemo(() => {
    if (location.pathname.startsWith("/system") || location.pathname.startsWith("/audit") || location.pathname.startsWith("/settings")) {
      return "strategy";
    }

    if (location.pathname.startsWith("/agents")) {
      return "memory";
    }

    return "openclaw";
  }, [location.pathname]);

  const searchResults = useMemo(() => {
    const query = globalSearch.trim().toLowerCase();
    if (!query) {
      return [];
    }

    const moduleMatches = navItems
      .filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(query))
      .map((item) => ({
        key: `module:${item.to}`,
        title: item.label,
        detail: item.description,
        to: item.to,
        badge: isEnglish ? "Module" : "模块"
      }));

    const projectMatches = allProjects
      .filter((project) => `${project.name} ${project.summary} ${project.id}`.toLowerCase().includes(query))
      .map((project) => ({
        key: `project:${project.id}`,
        title: project.name,
        detail: project.summary,
        to: `/projects/${project.id}`,
        badge: isEnglish ? "Project" : "项目"
      }));

    const agentMatches = allAgents
      .filter((agent) => `${agent.name} ${agent.title} ${agent.agentId} ${agent.responsibility}`.toLowerCase().includes(query))
      .map((agent) => ({
        key: `agent:${agent.agentId}`,
        title: agent.name,
        detail: agent.title,
        to: `/agents/${agent.agentId}`,
        badge: isEnglish ? "Agent" : "Agent"
      }));

    return [...moduleMatches, ...projectMatches, ...agentMatches].slice(0, 8);
  }, [allAgents, allProjects, globalSearch, isEnglish, navItems]);

  const shortcutItems = useMemo(
    () => [
      {
        key: "notifications",
        title: copy.notifications,
        detail: isEnglish ? "Operator inbox for approvals, risks, and governance." : "统一查看审批、风险与治理事件。",
        to: "/notifications",
        badge: isEnglish ? "Inbox" : "收件箱"
      },
      {
        key: "audit",
        title: copy.openAudit,
        detail: topbarCopy.description,
        to: "/audit",
        badge: isEnglish ? "Governance" : "治理"
      },
      {
        key: "system",
        title: copy.openSystem,
        detail: copy.statusCopy,
        to: "/system",
        badge: isEnglish ? "Runtime" : "运行态"
      },
      {
        key: "projects",
        title: copy.projects,
        detail: `${allProjects.length} ${isEnglish ? "projects in portfolio" : "个项目已接入组合"}`,
        to: "/projects",
        badge: isEnglish ? "Portfolio" : "组合"
      },
      {
        key: "agents",
        title: copy.agents,
        detail: `${allAgents.length} ${isEnglish ? "managed agents" : "个受管 Agent"}`,
        to: "/agents",
        badge: isEnglish ? "Roster" : "团队"
      }
    ],
    [allAgents.length, allProjects.length, copy.agents, copy.notifications, copy.openAudit, copy.openSystem, copy.projects, copy.statusCopy, isEnglish, topbarCopy.description]
  );

  function handleSearchSelect(to: string) {
    navigate(to);
    setGlobalSearch("");
  }

  if (authLoading) {
    return <div className="card">{copy.checking}</div>;
  }

  if (authError) {
    return <div className="card error-text">{authError}</div>;
  }

  if (!authStatus) {
    return <div className="card error-text">{copy.authUnavailable}</div>;
  }

  if (!authStatus.authenticated) {
    return <AuthPage authStatus={authStatus} onAuthenticated={setAuthStatus} />;
  }

  return (
    <div className="shell-v2 studio-shell-root">
      <aside className="workspace-switcher studio-workspace-rail rounded-2xl">
        <div className="workspace-switcher-stack">
          {workspaceSwitchers.map((item) => (
            <button
              key={item.id}
              className={`workspace-switcher-item ${item.id === activeWorkspaceId ? `workspace-switcher-item ${item.tone}` : "workspace-switcher-item workspace-switcher-item-muted"} rounded-xl hover:rounded-2xl transition-all duration-200`}
              type="button"
              aria-label={item.label}
              title={item.label}
              onClick={() => navigate(item.to)}
            >
              <item.icon size={22} />
              <span className="workspace-switcher-tooltip">{item.label}</span>
            </button>
          ))}
        </div>
        <button className="workspace-switcher-add" type="button" aria-label={copy.workspaceTitle} title={copy.newProject} onClick={() => navigate("/?compose=project")}>
          <Plus size={22} />
          <span className="workspace-switcher-tooltip">{copy.newProject}</span>
        </button>
      </aside>

      <aside className="shell-sidebar-v2 studio-shell-sidebar bg-[#16191E]/90 backdrop-blur-xl">
        <div className="shell-sidebar-header studio-shell-sidebar-header">
          <div className="shell-sidebar-brand">
            <span className="eyebrow">{copy.shellEyebrow}</span>
            <strong>{copy.workspaceMenu}</strong>
          </div>
          <ChevronDown size={16} />
        </div>

        <div className="shell-sidebar-intro">
          <p>{copy.workspaceCopy}</p>
        </div>

        <div className="shell-sidebar-scroll studio-shell-sidebar-scroll">
          <section className="shell-nav-block">
            <nav className="shell-nav-list-v2">
              {navItems.map((item) => (
                <NavItem
                  key={item.to}
                  to={item.to}
                  label={item.label}
                  description={item.description}
                  icon={item.icon}
                  compact
                />
              ))}
            </nav>
          </section>

          <section className="shell-entity-block">
            <div className="shell-block-header">
              <span>{copy.recentProjects}</span>
              <button type="button" onClick={() => navigate("/?compose=project")}>
                <Plus size={14} />
              </button>
            </div>
            <div className="shell-entity-list">
              {sidebarProjects.map((project) => (
                <NavLink
                  key={project.id}
                  to={`/projects/${project.id}`}
                  className={({ isActive }) => isActive ? "shell-entity-row active" : "shell-entity-row"}
                >
                  <Hash size={15} className="shell-entity-icon" />
                  <span className="shell-entity-name">{project.name}</span>
                </NavLink>
              ))}
              {sidebarProjects.length === 0 ? (
                <button type="button" className="shell-entity-empty" onClick={() => navigate("/projects")}>
                  {isEnglish ? "Open portfolio" : "进入项目组合"}
                </button>
              ) : null}
            </div>
          </section>

          <section className="shell-entity-block">
            <div className="shell-block-header">
              <span>{copy.recentAgents}</span>
              <button type="button" onClick={() => navigate("/agents")}>
                <Plus size={14} />
              </button>
            </div>
            <div className="shell-entity-list">
              {sidebarAgents.map((agent) => (
                <NavLink
                  key={agent.agentId}
                  to={`/agents/${agent.agentId}`}
                  className={({ isActive }) => isActive ? "shell-entity-row active" : "shell-entity-row"}
                >
                  <span className="shell-agent-avatar">{agent.emoji || agent.name.slice(0, 1).toUpperCase()}</span>
                  <span className="shell-entity-name">{agent.name}</span>
                  <Circle
                    size={10}
                    fill="currentColor"
                    className={agent.status === "active" ? "shell-agent-dot shell-agent-dot-active" : "shell-agent-dot"}
                  />
                </NavLink>
              ))}
              {sidebarAgents.length === 0 ? (
                <button type="button" className="shell-entity-empty" onClick={() => navigate("/agents")}>
                  {isEnglish ? "Open roster" : "进入 Agent 名册"}
                </button>
              ) : null}
            </div>
          </section>
        </div>

        <button className="shell-commander-v2" type="button" onClick={() => navigate("/settings")}>
          <span className="shell-commander-avatar">{copy.commanderName.slice(0, 1)}</span>
          <span className="shell-commander-copy">
            <strong>{copy.commanderName}</strong>
            <small>{copy.commanderLevel}</small>
          </span>
          <Settings size={16} />
        </button>
      </aside>

      <div className="shell-main-v2 studio-shell-main">
        <header className="shell-topbar-v2 studio-topbar bg-[#0F1115]/80 backdrop-blur-xl border-b border-white/[0.06]">
          <div className="shell-topbar-search studio-topbar-search bg-[#1C2128]/80 backdrop-blur-md rounded-xl border border-white/[0.08] hover:border-emerald-500/30" ref={shellSearchRef}>
            <Search size={16} />
            <input
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && searchResults[0]) {
                  handleSearchSelect(searchResults[0].to);
                }
              }}
              placeholder={copy.shellSearch}
              aria-label={copy.workspaceSearchHint}
            />
            {globalSearch.trim() ? (
              <div className="shell-search-results">
                {searchResults.length > 0 ? searchResults.map((item) => (
                  <button key={item.key} className="shell-search-result" type="button" onClick={() => handleSearchSelect(item.to)}>
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.detail}</p>
                    </div>
                    <span className="pill">{item.badge}</span>
                  </button>
                )) : (
                  <div className="shell-search-empty">{copy.noSearchResults}</div>
                )}
              </div>
            ) : null}
          </div>

          <div className="shell-topbar-meta studio-topbar-actions">
            <div className="studio-topbar-presence">
              <span className="pill pill-primary">{copy.topbarBadge}</span>
              <div className="shell-topbar-context-copy">
                <strong>{topbarCopy.title}</strong>
                <small>{copy.statusCopy}</small>
              </div>
            </div>
            <div className="shell-topbar-popover" ref={shortcutPopoverRef}>
              <button
                className="workspace-icon-button rounded-xl hover:bg-white/10 transition-colors"
                type="button"
                aria-label={copy.notifications}
                onClick={() => setNotificationsOpen((current) => !current)}
              >
              <Bell size={18} />
              <span className="workspace-icon-dot" />
              </button>
              {notificationsOpen ? (
                <div className="shell-shortcut-panel rounded-2xl">
                  <div className="section-header">
                    <div>
                      <p className="eyebrow">{copy.quickActions}</p>
                      <h3>{copy.recentAlerts}</h3>
                    </div>
                  </div>
                  <div className="stack tight">
                    {shortcutItems.map((item) => (
                      <button key={item.key} className="shell-search-result" type="button" onClick={() => handleSearchSelect(item.to)}>
                        <div>
                          <strong>{item.title}</strong>
                          <p>{item.detail}</p>
                        </div>
                        <span className="pill pill-primary">{item.badge}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="studio-topbar-divider" />

            <button className="button button-primary inline-button studio-topbar-create" type="button" onClick={() => navigate("/?compose=project")}>
              <Plus size={16} />
              {copy.newProject}
            </button>

            <div className="locale-switcher" aria-label={copy.languageLabel}>
              <button
                className={locale === "zh-CN" ? "locale-pill locale-pill-active" : "locale-pill"}
                onClick={() => setLocale("zh-CN")}
              >
                中文
              </button>
              <button
                className={locale === "en-US" ? "locale-pill locale-pill-active" : "locale-pill"}
                onClick={() => setLocale("en-US")}
              >
                EN
              </button>
            </div>

            <button className="workspace-icon-button rounded-xl hover:bg-white/10 transition-colors" type="button" aria-label={copy.settings} onClick={() => navigate("/settings")}>
              <Settings size={18} />
            </button>

            <button className="button button-ghost button-shell studio-topbar-logout" onClick={() => void handleLogout()}>
              {copy.logout}
            </button>
          </div>
        </header>

        <main className="shell-content-v2 studio-content-viewport">
          <div className="studio-content-frame">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/openclaw" element={<OpenClawPage />} />
              <Route path="/projects/:projectId" element={<ProjectRoomPage />} />
              <Route path="/agents" element={<AgentsPage />} />
              <Route path="/agents/:agentId" element={<AgentCommanderPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/system" element={<SystemPage />} />
              <Route path="/audit" element={<AuditPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}

function NavItem({
  to,
  label,
  description,
  icon: Icon,
  compact = false
}: {
  to: string;
  label: string;
  description: string;
  icon: typeof LayoutDashboard;
  compact?: boolean;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => compact
        ? (isActive ? "shell-nav-item-v2 shell-nav-item-v2-active" : "shell-nav-item-v2")
        : (isActive ? "nav-link nav-link-active" : "nav-link")}
    >
      <span className={compact ? "shell-nav-icon-v2" : "nav-icon"}><Icon size={18} /></span>
      <span className={compact ? "shell-nav-copy-v2" : "nav-copy"}>
        <span className={compact ? "shell-nav-label-v2" : "nav-label"}>{label}</span>
        {compact ? null : <span className="nav-description">{description}</span>}
      </span>
    </NavLink>
  );
}
