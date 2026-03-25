import { useEffect, useMemo, useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import type { AuthStatus, OpenClawAgentSummary, ProjectSummary } from "@occ/shared";
import {
  Activity,
  Bell,
  Bot,
  ChevronRight,
  FolderKanban,
  Globe,
  History,
  LayoutDashboard,
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
        recentProjects: "Live Projects",
        recentAgents: "Agent Roster",
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
        recentProjects: "在线项目",
        recentAgents: "Agent 名册",
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
    <div className="app-shell app-shell-modern">
      <aside className="workspace-rail">
        <div className="workspace-rail-group">
          <button className="workspace-rail-item workspace-rail-item-active" type="button" aria-label={copy.workspacePrimary}>
            <TerminalSquare size={22} />
          </button>
          <button className="workspace-rail-item" type="button" aria-label={copy.workspaceSecondary}>
            <ShieldCheck size={22} />
          </button>
          <button className="workspace-rail-item" type="button" aria-label={copy.workspaceData}>
            <Globe size={22} />
          </button>
        </div>
        <div className="workspace-rail-footer">
          <button className="workspace-rail-item workspace-rail-item-muted" type="button" aria-label={copy.settings}>
            <Settings size={20} />
          </button>
        </div>
      </aside>

      <aside className="sidebar sidebar-modern">
        <div className="stack shell-stack">
          <div className="sidebar-brand sidebar-brand-modern">
            <p className="eyebrow">{copy.shellEyebrow}</p>
            <h1>{copy.title}</h1>
            <p className="sidebar-copy">{copy.subtitle}</p>
          </div>

          <div className="nav-group nav-group-modern">
            <p className="group-title">{copy.navigation}</p>
            <nav className="nav-list">
              {navItems.map((item) => (
                <NavItem
                  key={item.to}
                  to={item.to}
                  label={item.label}
                  description={item.description}
                  icon={item.icon}
                />
              ))}
            </nav>
          </div>

          <div className="nav-group nav-group-modern">
            <div className="section-title-row">
              <p className="group-title">{copy.recentProjects}</p>
            </div>
            <div className="sidebar-mini-list">
              {sidebarProjects.map((project) => (
                <NavLink key={project.id} to={`/projects/${project.id}`} className="sidebar-mini-link">
                  <div className="sidebar-mini-icon">{project.name.slice(0, 1).toUpperCase()}</div>
                  <div className="sidebar-mini-copy">
                    <span className="sidebar-mini-title">{project.name}</span>
                    <span className="sidebar-mini-subtitle">{project.currentStage} · {project.progress}%</span>
                  </div>
                  <ChevronRight size={16} />
                </NavLink>
              ))}
            </div>
          </div>

          <div className="nav-group nav-group-modern">
            <div className="section-title-row">
              <p className="group-title">{copy.recentAgents}</p>
            </div>
            <div className="sidebar-mini-list">
              {sidebarAgents.map((agent) => (
                <NavLink key={agent.agentId} to={`/agents/${agent.agentId}`} className="sidebar-mini-link">
                  <div className="sidebar-mini-icon">{agent.emoji || agent.name.slice(0, 1).toUpperCase()}</div>
                  <div className="sidebar-mini-copy">
                    <span className="sidebar-mini-title">{agent.name}</span>
                    <span className="sidebar-mini-subtitle">{agent.model} · {agent.status}</span>
                  </div>
                  <span className={agent.status === "active" ? "shell-presence shell-presence-active" : "shell-presence"} />
                </NavLink>
              ))}
            </div>
          </div>
        </div>

        <section className="sidebar-card sidebar-status-card commander-card">
          <div className="commander-avatar-shell">{copy.commanderName.slice(0, 1)}</div>
          <div className="commander-copy">
            <strong>{copy.commanderName}</strong>
            <p>{copy.commanderLevel}</p>
            <span className="status-inline">
              <span className="status-live" />
              {copy.statusTitle}
            </span>
          </div>
        </section>
      </aside>

      <div className="workspace-shell workspace-shell-modern">
        <header className="workspace-header workspace-header-modern">
          <div className="workspace-header-main">
            <div className="pill-row pill-row-modern">
              <span className="pill pill-primary">{copy.workspacePrimary}</span>
              <span className="pill">{copy.topbarBadge}</span>
              <span className="pill">{copy.workspaceTitle}</span>
            </div>
            <h2 className="workspace-title">{topbarCopy.title}</h2>
            <p className="workspace-subtitle">{topbarCopy.description}</p>
          </div>

          <div className="workspace-actions workspace-actions-modern">
            <label className="shell-search">
              <Search size={17} />
              <input placeholder={copy.shellSearch} />
            </label>

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

        <main className="main-content main-content-modern">
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
  icon: Icon
}: {
  to: string;
  label: string;
  description: string;
  icon: typeof LayoutDashboard;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => (isActive ? "nav-link nav-link-active" : "nav-link")}
    >
      <span className="nav-icon"><Icon size={18} /></span>
      <span className="nav-copy">
        <span className="nav-label">{label}</span>
        <span className="nav-description">{description}</span>
      </span>
    </NavLink>
  );
}
