import { useEffect, useMemo, useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import type { AuthStatus } from "@occ/shared";
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
    <div className="app-shell">
      <aside className="sidebar">
        <div className="stack">
          <div className="sidebar-brand">
            <p className="eyebrow">{copy.shellEyebrow}</p>
            <h1>{copy.title}</h1>
            <p className="sidebar-copy">{copy.subtitle}</p>
          </div>

          <div className="nav-group">
            <p className="group-title">{copy.navigation}</p>
            <nav className="nav-list">
              <NavItem to="/" label={copy.dashboard} description={isEnglish ? "Overview, modules, guided entry." : "概览、模块入口、快速开始。"} />
              <NavItem to="/projects" label={copy.projects} description={isEnglish ? "Portfolio, status, and project rooms." : "项目组合、状态和作战室。"} />
              <NavItem to="/openclaw" label={copy.openclaw} description={isEnglish ? "Projects, deliverables, workload." : "项目、交付物、团队承载。"} />
              <NavItem to="/agents" label={copy.agents} description={isEnglish ? "Identity, tasks, sessions, SOUL." : "画像、任务、会话、SOUL。"} />
              <NavItem to="/system" label={copy.system} description={isEnglish ? "Runtime, release, audit." : "运行态、发布、审计。"} />
              <NavItem to="/audit" label={copy.audit} description={isEnglish ? "Critical actions and command trail." : "关键动作与指令轨迹。"} />
              <NavItem to="/settings" label={copy.settings} description={isEnglish ? "Language and workspace defaults." : "语言和工作区默认设置。"} />
            </nav>
          </div>
        </div>

        <section className="sidebar-card sidebar-status-card">
          <span className="status-dot status-live" />
          <div>
            <strong>{copy.statusTitle}</strong>
            <p>{copy.statusCopy}</p>
          </div>
        </section>
      </aside>

      <div className="workspace-shell">
        <header className="workspace-header">
          <div>
            <div className="pill-row">
              <span className="pill pill-primary">{copy.topbarBadge}</span>
              <span className="pill">{copy.workspaceTitle}</span>
            </div>
            <h2 className="workspace-title">{topbarCopy.title}</h2>
            <p className="workspace-subtitle">{topbarCopy.description}</p>
          </div>

          <div className="workspace-actions">
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

            <button className="button button-ghost" onClick={() => void handleLogout()}>
              {copy.logout}
            </button>
          </div>
        </header>

        <main className="main-content">
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

function NavItem({ to, label, description }: { to: string; label: string; description: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => (isActive ? "nav-link nav-link-active" : "nav-link")}
    >
      <span className="nav-label">{label}</span>
      <span className="nav-description">{description}</span>
    </NavLink>
  );
}
