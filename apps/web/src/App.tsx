import { useEffect, useMemo, useState } from "react";
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
import { api } from "./lib/api";
import { useLocale } from "./lib/locale";

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { locale, setLocale, isEnglish } = useLocale();
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [sidebarProjects, setSidebarProjects] = useState<ProjectSummary[]>([]);
  const [sidebarAgents, setSidebarAgents] = useState<OpenClawAgentSummary[]>([]);

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
        system: "Operations",
        audit: "Audit Trail",
        settings: "Settings",
        workspaceTitle: "Workspace",
        workspaceCopy: "Manage a live AI team through portfolio, delivery, and runtime modules.",
        shellSearch: "Search projects, agents, memory, or logs",
        workspaceSearchHint: "Search",
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
        system: "系统运营",
        audit: "审计轨迹",
        settings: "设置",
        workspaceTitle: "工作区",
        workspaceCopy: "面向真实协作团队的项目组合、交付跟踪和运行管理入口。",
        shellSearch: "搜索项目、Agent、记忆或日志",
        workspaceSearchHint: "搜索",
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
        setSidebarProjects(projects.slice(0, 6));
        setSidebarAgents(agents.slice(0, 8));
      })
      .catch(() => {
        setSidebarProjects([]);
        setSidebarAgents([]);
      });
  }, [authStatus?.authenticated]);

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
    { to: "/system", label: copy.system, description: isEnglish ? "Runtime, health, costs and release." : "运行、健康、成本与发布。", icon: Activity },
    { to: "/audit", label: copy.audit, description: isEnglish ? "Critical actions and governance trail." : "关键动作与治理轨迹。", icon: History },
    { to: "/settings", label: copy.settings, description: isEnglish ? "Preferences and workspace defaults." : "偏好与工作区默认配置。", icon: Settings }
  ], [copy.agents, copy.audit, copy.dashboard, copy.openclaw, copy.projects, copy.settings, copy.system, isEnglish]);

  const workspaceSwitchers = useMemo(() => [
    { id: "openclaw", label: copy.workspacePrimary, icon: TerminalSquare, tone: "workspace-switcher-active" },
    { id: "strategy", label: copy.workspaceSecondary, icon: ShieldCheck, tone: "workspace-switcher-strategy" },
    { id: "memory", label: copy.workspaceData, icon: Database, tone: "workspace-switcher-data" }
  ], [copy.workspaceData, copy.workspacePrimary, copy.workspaceSecondary]);

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
    <div className="shell-v2">
      <aside className="workspace-switcher">
        <div className="workspace-switcher-stack">
          {workspaceSwitchers.map((item) => (
            <button key={item.id} className={`workspace-switcher-item ${item.tone}`} type="button" aria-label={item.label}>
              <item.icon size={22} />
            </button>
          ))}
        </div>
        <button className="workspace-switcher-add" type="button" aria-label={copy.workspaceTitle}>
          <Plus size={22} />
        </button>
      </aside>

      <aside className="shell-sidebar-v2">
        <div className="shell-sidebar-header">
          <strong>{copy.workspaceMenu}</strong>
          <ChevronDown size={16} />
        </div>

        <div className="shell-sidebar-scroll">
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
              <button type="button" onClick={() => navigate("/")}>
                <Plus size={14} />
              </button>
            </div>
            <div className="shell-entity-list">
              {sidebarProjects.map((project) => (
                <NavLink key={project.id} to={`/projects/${project.id}`} className="shell-entity-row">
                  <Hash size={15} className="shell-entity-icon" />
                  <span className="shell-entity-name">{project.name}</span>
                </NavLink>
              ))}
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
                <NavLink key={agent.agentId} to={`/agents/${agent.agentId}`} className="shell-entity-row">
                  <span className="shell-agent-avatar">{agent.emoji || agent.name.slice(0, 1).toUpperCase()}</span>
                  <span className="shell-entity-name">{agent.name}</span>
                  <Circle
                    size={10}
                    fill="currentColor"
                    className={agent.status === "active" ? "shell-agent-dot shell-agent-dot-active" : "shell-agent-dot"}
                  />
                </NavLink>
              ))}
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

      <div className="shell-main-v2">
        <header className="shell-topbar-v2">
          <div className="shell-topbar-search">
            <Search size={16} />
            <input placeholder={copy.shellSearch} aria-label={copy.workspaceSearchHint} />
          </div>

          <div className="shell-topbar-meta">
            <div className="shell-page-summary">
              <span className="pill pill-primary">{copy.topbarBadge}</span>
              <span className="shell-page-title">{topbarCopy.title}</span>
            </div>

            <button className="workspace-icon-button" type="button" aria-label="notifications">
              <Bell size={18} />
              <span className="workspace-icon-dot" />
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

            <button className="button button-ghost button-shell" onClick={() => void handleLogout()}>
              {copy.logout}
            </button>
          </div>
        </header>

        <main className="shell-content-v2">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/openclaw" element={<OpenClawPage />} />
            <Route path="/projects/:projectId" element={<ProjectRoomPage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/agents/:agentId" element={<AgentCommanderPage />} />
            <Route path="/system" element={<SystemPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
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
        <span className={compact ? "shell-nav-description-v2" : "nav-description"}>{description}</span>
      </span>
    </NavLink>
  );
}
