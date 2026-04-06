import React, { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from 'react';
import { Activity, Lock, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Model } from './types';
import { useRealData } from './useRealData';
import MainLayout from './components/Layout/MainLayout';
import Sidebar from './components/Layout/Sidebar';
import AppTopbar from './components/Layout/AppTopbar';
import ErrorBoundary from './components/ErrorBoundary';
import ToastContainer from './components/ToastContainer';
import { useNotifications, type NotificationItem } from './features/notifications/useNotifications';
import {
  authApi,
  modelsApi,
} from './lib/api';
import { buildRuntimeModels, toUiModel } from './lib/modelAdapters';
import { syncRuntimeCollections } from './lib/runtimeCollections';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const AgentCommanderPage = lazy(() => import('./pages/AgentCommanderPage'));
const ProjectRoomPage = lazy(() => import('./pages/ProjectRoomPage'));
const SystemOpsPage = lazy(() => import('./pages/SystemOpsPage'));
const ModelNexusPage = lazy(() => import('./pages/ModelNexusPage'));
const MonitoringPage = lazy(() => import('./pages/MonitoringPage'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const AgentsPage = lazy(() => import('./pages/AgentsPage'));
const WorkspacePage = lazy(() => import('./pages/WorkspacePage'));
const AuditPage = lazy(() => import('./pages/AuditPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const NewModelModal = lazy(() => import('./pages/modals/NewModelModal'));
const AgentConfigModal = lazy(() => import('./pages/modals/AgentConfigModal'));
const TeamTopologyModal = lazy(() => import('./pages/modals/TeamTopologyModal'));
const DeployAgentModal = lazy(() => import('./pages/modals/DeployAgentModal'));
const NewProjectModal = lazy(() => import('./pages/modals/NewProjectModal'));
const DecisionCenterModal = lazy(() => import('./pages/modals/DecisionCenterModal'));
const IndustryRoleSetsModal = lazy(() => import('./pages/modals/IndustryRoleSetsModal'));

const APP_TABS = [
  'dashboard',
  'agent-commander',
  'project-room',
  'system-health',
  'model-nexus',
  'monitoring',
  'projects',
  'agents',
  'workspace',
  'audit',
  'settings',
] as const;

const isAppTab = (value: string | null): value is (typeof APP_TABS)[number] =>
  Boolean(value) && APP_TABS.includes(value as (typeof APP_TABS)[number]);

const AUTH_CACHE_KEY = 'occ-auth-bootstrap';
const AUTH_BYPASS_IN_DEV = import.meta.env.DEV && import.meta.env.VITE_ENABLE_AUTH !== 'true';

const readCachedAuthState = (): { setupComplete: boolean; authenticated: boolean } | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(AUTH_CACHE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { setupComplete?: unknown; authenticated?: unknown };
    if (typeof parsed?.setupComplete === 'boolean' && typeof parsed?.authenticated === 'boolean') {
      return {
        setupComplete: parsed.setupComplete,
        authenticated: parsed.authenticated,
      };
    }
  } catch {
    // ignore invalid cache
  }
  return null;
};

const persistAuthState = (setupComplete: boolean, authenticated: boolean) => {
  if (typeof window === 'undefined') {
    return;
  }
  window.sessionStorage.setItem(
    AUTH_CACHE_KEY,
    JSON.stringify({ setupComplete, authenticated }),
  );
};

const clearAuthStateCache = () => {
  if (typeof window === 'undefined') {
    return;
  }
  window.sessionStorage.removeItem(AUTH_CACHE_KEY);
};

export default function App() {
  const cachedAuthStateRef = useRef<{ setupComplete: boolean; authenticated: boolean } | null>(readCachedAuthState());
  const cachedAuthState = cachedAuthStateRef.current;
  const [toasts, setToasts] = useState<any[]>([]);
  const toastCounterRef = useRef(0);

  const addToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${++toastCounterRef.current}`;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isInitialized, setIsInitialized] = useState<boolean>(
    AUTH_BYPASS_IN_DEV ? true : (cachedAuthState?.setupComplete ?? true),
  );
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(
    AUTH_BYPASS_IN_DEV ? true : (cachedAuthState?.authenticated ?? false),
  );
  const [authLoading, setAuthLoading] = useState(
    AUTH_BYPASS_IN_DEV ? false : cachedAuthState === null,
  );
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (AUTH_BYPASS_IN_DEV) {
      setIsInitialized(true);
      setIsLoggedIn(true);
      setAuthLoading(false);
      persistAuthState(true, true);
      return;
    }

    let cancelled = false;
    const hasCachedSnapshot = cachedAuthState !== null;

    const bootstrapAuth = async () => {
      if (!hasCachedSnapshot) {
        setAuthLoading(true);
      }
      try {
        const status = await authApi.getStatus();
        if (cancelled) {
          return;
        }
        const setupComplete = Boolean(status.setupComplete);
        const authenticated = Boolean(status.authenticated);
        setIsInitialized(setupComplete);
        setIsLoggedIn(authenticated);
        persistAuthState(setupComplete, authenticated);
        setError('');
      } catch (err) {
        if (cancelled) {
          return;
        }
        // Keep a valid cached snapshot to avoid full-screen auth flicker on transient failures.
        if (!hasCachedSnapshot) {
          setIsInitialized(true);
          setIsLoggedIn(false);
          persistAuthState(true, false);
        }
        setError(err instanceof Error ? err.message : '认证服务暂不可用');
      } finally {
        if (!cancelled) {
          setAuthLoading(false);
        }
      }
    };

    void bootstrapAuth();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogin = async () => {
    if (!password.trim()) {
      setError('请输入密码');
      return;
    }

    try {
      const status = await authApi.login(password.trim());
      const setupComplete = Boolean(status.setupComplete);
      const authenticated = Boolean(status.authenticated);
      setIsInitialized(setupComplete);
      setIsLoggedIn(authenticated);
      persistAuthState(setupComplete, authenticated);
      setError('');
      setPassword('');
      addToast("登录成功，欢迎指挥官", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请重试');
      addToast("身份验证失败", "error");
    }
  };

  const handleInitialize = async () => {
    if (!password.trim()) {
      setError('请输入管理员密码');
      return;
    }

    try {
      const status = await authApi.setup(password.trim());
      const setupComplete = Boolean(status.setupComplete);
      const authenticated = Boolean(status.authenticated);
      setIsInitialized(setupComplete);
      setIsLoggedIn(authenticated);
      persistAuthState(setupComplete, authenticated);
      setPassword('');
      setError('');
      addToast("系统初始化完成", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : '初始化失败，请重试');
      addToast("初始化失败", "error");
    }
  };

  const handleLogout = async () => {
    if (AUTH_BYPASS_IN_DEV) {
      addToast("开发模式已启用免登录", "info");
      return;
    }

    try {
      await authApi.logout();
    } catch {
      // ignore logout API failures and clear local state anyway
    } finally {
      setIsLoggedIn(false);
      setPassword('');
      clearAuthStateCache();
      addToast("已安全退出系统", "info");
    }
  };

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [urlSearch, setUrlSearch] = useState<string>(() => (typeof window !== 'undefined' ? window.location.search : ''));
  const deepLinkRouteHandledRef = useRef<string | null>(null);

  // Modal States
  const [isNewModelOpen, setIsNewModelOpen] = useState(false);
  const [isAgentConfigOpen, setIsAgentConfigOpen] = useState(false);
  const [isTopologyOpen, setIsTopologyOpen] = useState(false);
  const [isDeployOpen, setIsDeployOpen] = useState(false);
  const [isRoleSetsOpen, setIsRoleSetsOpen] = useState(false);
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [isDecisionCenterOpen, setIsDecisionCenterOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [managedModels, setManagedModels] = useState<Model[]>([]);

  const { agents, projects, tasks, sessions, workspace, runtime, refresh, sendAgentMessage } = useRealData();

  useEffect(() => {
    if (activeTab !== 'project-room') {
      return;
    }

    if (projects.length === 0) {
      if (selectedProjectId !== null) {
        setSelectedProjectId(null);
      }
      setActiveTab('projects');
      return;
    }

    if (!selectedProjectId) {
      setSelectedProjectId(projects[0].id);
      return;
    }

    const exists = projects.some((project) => project.id === selectedProjectId);
    if (!exists) {
      setSelectedProjectId(projects[0].id);
    }
  }, [activeTab, projects, selectedProjectId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleLocationChange = () => {
      setUrlSearch(window.location.search);
    };

    window.addEventListener('popstate', handleLocationChange);
    window.addEventListener('hashchange', handleLocationChange);

    return () => {
      window.removeEventListener('popstate', handleLocationChange);
      window.removeEventListener('hashchange', handleLocationChange);
    };
  }, []);

  useEffect(() => {
    if (!isLoggedIn || !urlSearch) {
      return;
    }

    const params = new URLSearchParams(urlSearch);
    const appTabParam = params.get('app_tab');
    const targetProjectId = params.get('signoff_project_id') || params.get('project_id');
    const targetAgentId = params.get('agent_id');
    const nextTab = isAppTab(appTabParam) ? appTabParam : null;

    if (!nextTab && !targetProjectId && !targetAgentId) {
      return;
    }

    const routeKey = urlSearch;
    if (deepLinkRouteHandledRef.current === routeKey) {
      return;
    }

    let applied = false;

    if (nextTab) {
      setActiveTab(nextTab);
      applied = true;
    }

    if (targetProjectId) {
      setSelectedProjectId(targetProjectId);
      if (!nextTab || nextTab === 'project-room' || params.has('signoff_project_id')) {
        setActiveTab('project-room');
      }
      applied = true;
    }

    if (targetAgentId) {
      setSelectedAgentId(targetAgentId);
      if (!nextTab || nextTab === 'agent-commander') {
        setActiveTab('agent-commander');
      }
      applied = true;
    }

    if (applied) {
      deepLinkRouteHandledRef.current = routeKey;
    }
  }, [isLoggedIn, urlSearch]);

  const loadManagedModels = useCallback(async () => {
    try {
      const list = await modelsApi.list();
      setManagedModels((list || []).map(toUiModel));
    } catch {
      setManagedModels([]);
    }
  }, []);

  useEffect(() => {
    if (!isLoggedIn) {
      setManagedModels([]);
      return;
    }
    void loadManagedModels();
  }, [isLoggedIn, loadManagedModels]);

  useEffect(() => {
    if (!isLoggedIn) {
      return;
    }
    void refresh();
  }, [isLoggedIn, refresh]);

  const runtimeModels = useMemo(
    () => buildRuntimeModels(runtime, agents, projects, tasks, sessions),
    [runtime, agents, projects, tasks, sessions],
  );
  const activeModels = useMemo(() => {
    const baseModels = managedModels.length > 0 ? managedModels : runtimeModels;
    const usageByKey = new Map<string, { dailyTokens: number; activeAgents: number }>();

    const normalizeKey = (value: string) => value.trim().toLowerCase();
    const addUsage = (key: string | undefined, tokens: number, activeAgent = false) => {
      const normalized = String(key ?? '').trim();
      if (!normalized) {
        return;
      }
      const mapKey = normalizeKey(normalized);
      const prev = usageByKey.get(mapKey) ?? { dailyTokens: 0, activeAgents: 0 };
      usageByKey.set(mapKey, {
        dailyTokens: prev.dailyTokens + Math.max(0, Number(tokens || 0)),
        activeAgents: prev.activeAgents + (activeAgent ? 1 : 0),
      });
    };

    agents.forEach((agent) => {
      const isActive = agent.status === 'Executing' || agent.status === 'Thinking';
      const runtimeModelKey = String(agent.model || '').trim();
      const configuredModelKey = String(agent.currentModelId || '').trim();
      // Prefer runtime model label to reflect real invoking model; fallback to configured model id.
      addUsage(runtimeModelKey || configuredModelKey, agent.tokensUsed || 0, isActive);
    });

    const matchesModelKey = (model: Model, usageKey: string) => {
      const modelId = normalizeKey(model.id);
      const modelName = normalizeKey(model.name);
      const key = normalizeKey(usageKey);
      return key === modelId
        || key === modelName
        || key.includes(modelName)
        || modelName.includes(key);
    };

    const consumedKeys = new Set<string>();
    const hydrated = baseModels.map((model) => {
      let dynamicDailyTokens = 0;
      let activeAgents = 0;

      for (const [usageKey, usage] of usageByKey.entries()) {
        if (matchesModelKey(model, usageKey)) {
          consumedKeys.add(usageKey);
          dynamicDailyTokens += usage.dailyTokens;
          activeAgents += usage.activeAgents;
        }
      }

      return {
        ...model,
        dailyTokens: Math.max(model.dailyTokens || 0, dynamicDailyTokens),
        totalTokens: Math.max(model.totalTokens || 0, dynamicDailyTokens),
        status: activeAgents > 0 ? 'Healthy' : model.status,
        tokenSource: dynamicDailyTokens > 0 ? 'usage_logs' : (model.tokenSource || 'unknown'),
        telemetryQuality: dynamicDailyTokens > 0 ? 'estimated' : (model.telemetryQuality || 'unknown'),
        costMode: dynamicDailyTokens > 0 ? 'estimated' : (model.costMode || 'unknown'),
      } as Model;
    });

    const inferredModels: Model[] = [];
    for (const [usageKey, usage] of usageByKey.entries()) {
      if (consumedKeys.has(usageKey)) {
        continue;
      }
      const id = `runtime-${usageKey.replace(/[^a-z0-9]+/gi, '-')}`;
      const name = usageKey;
      const provider = usageKey.includes('/') ? usageKey.split('/')[0] : 'Runtime';
      inferredModels.push({
        id,
        name,
        provider,
        status: usage.activeAgents > 0 ? 'Healthy' : 'Degraded',
        totalTokens: usage.dailyTokens,
        dailyTokens: usage.dailyTokens,
        currentTask: projects[0]?.name ? `推进项目: ${projects[0].name}` : '待分配任务',
        latency: 'unknown',
        throughput: 'unknown',
        tokenSource: 'runtime_inferred',
        telemetryQuality: 'estimated',
        costMode: 'estimated',
        logs: [],
      });
    }

    const combined = [...hydrated, ...inferredModels];
    if (combined.length === 0) {
      return runtimeModels;
    }

    return combined.sort((left, right) => (right.dailyTokens || 0) - (left.dailyTokens || 0));
  }, [managedModels, runtimeModels, agents, projects]);

  const {
    notifications,
    unreadNotificationCount,
    notificationsLoading,
    markingAllRead,
    refreshNotifications,
    markAllNotificationsRead,
    markNotificationRead,
  } = useNotifications({
    isLoggedIn: Boolean(isLoggedIn),
    agents,
    projects,
    tasks,
    sessions,
    addToast,
  });

  const refreshAllData = useCallback(async () => {
    await Promise.all([refresh(), loadManagedModels(), refreshNotifications()]);
  }, [refresh, loadManagedModels, refreshNotifications]);

  syncRuntimeCollections({
    models: activeModels,
    agents,
    projects,
    tasks,
    sessions,
  });

  const handleNotificationClick = async (notification: NotificationItem) => {
    setShowNotifications(false);

    const target = notification.to || '/dashboard';
    if (target.startsWith('/projects/')) {
      const projectId = target.split('/')[2];
      if (projectId) {
        setSelectedProjectId(projectId);
        setActiveTab('project-room');
      } else {
        setActiveTab('projects');
      }
    } else if (target.startsWith('/agents/')) {
      const targetAgentId = target.split('/')[2];
      if (targetAgentId) {
        setSelectedAgentId(targetAgentId);
        setActiveTab('agent-commander');
      } else {
        setActiveTab('agents');
      }
    } else if (target.startsWith('/audit')) {
      setActiveTab('audit');
    } else if (target.startsWith('/workspace')) {
      setActiveTab('workspace');
    } else if (target.startsWith('/monitoring')) {
      setActiveTab('monitoring');
    } else if (target.startsWith('/system')) {
      setActiveTab('system-health');
    } else if (target.startsWith('/notifications')) {
      setActiveTab('audit');
    } else {
      setActiveTab('dashboard');
    }

    await markNotificationRead(notification);
  };

  // Navigation handlers for consistency
  const handleNavigate = (tab: string, id?: string) => {
    if ((tab === 'project-room' || tab === 'projects') && id) {
      setSelectedProjectId(id);
      setActiveTab('project-room');
      return;
    }

    if ((tab === 'agent-commander' || tab === 'agents') && id) {
      setSelectedAgentId(id);
      setActiveTab('agent-commander');
      return;
    }

    setActiveTab(tab);
  };

  const handleSelectProject = (id: string) => {
    setSelectedProjectId(id);
    setActiveTab('project-room');
  };

  const handleSelectAgent = (id: string) => {
    setSelectedAgentId(id);
    setActiveTab('agent-commander');
  };

  if (authLoading) {
    return (
      <ErrorBoundary>
        <div className="h-screen w-full bg-surface flex items-center justify-center p-6 bg-[radial-gradient(circle_at_50%_50%,rgba(0,242,255,0.05),transparent_70%)]">
          <div className="max-w-md w-full bg-surface-soft border border-border-subtle rounded-3xl p-8 space-y-6 shadow-2xl text-center">
            <div className="w-14 h-14 mx-auto bg-primary/10 rounded-2xl flex items-center justify-center text-primary">
              <Activity size={28} />
            </div>
            <h1 className="text-xl font-bold text-white">正在验证系统状态</h1>
            <p className="text-sm text-slate-400">请稍候，正在连接认证服务...</p>
          </div>
        </div>
      </ErrorBoundary>
    );
  }

  if (!isInitialized) {
    return (
      <ErrorBoundary>
        <div className="h-screen w-full bg-surface flex items-center justify-center p-6 bg-[radial-gradient(circle_at_50%_50%,rgba(0,242,255,0.05),transparent_70%)]">
          <div className="max-w-md w-full bg-surface-soft border border-border-subtle rounded-3xl p-8 space-y-8 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent" />
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center text-primary shadow-lg shadow-primary/10">
                <Zap size={32} fill="currentColor" />
              </div>
              <h1 className="text-2xl font-bold text-white tracking-tight">初始化 Aegis OS</h1>
              <p className="text-slate-400 text-sm">设置您的管理员账户以开始管理您的 Agent 团队。</p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">管理员密码</label>
                <input 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••" 
                  className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all" 
                />
                {error && <p className="text-[10px] text-danger font-bold uppercase">{error}</p>}
              </div>
              <button onClick={() => void handleInitialize()} className="w-full py-3 bg-primary text-surface font-bold rounded-xl shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all active:scale-[0.98]">
                初始化系统
              </button>
            </div>
          </div>
        </div>
      </ErrorBoundary>
    );
  }

  if (!isLoggedIn) {
    return (
      <ErrorBoundary>
        <div className="h-screen w-full bg-surface flex items-center justify-center p-6 bg-[radial-gradient(circle_at_50%_50%,rgba(139,92,246,0.05),transparent_70%)]">
          <div className="max-w-md w-full bg-surface-soft border border-border-subtle rounded-3xl p-8 space-y-8 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-accent to-transparent" />
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="w-16 h-16 bg-accent/10 rounded-2xl flex items-center justify-center text-accent shadow-lg shadow-accent/10">
                <Lock size={32} />
              </div>
              <h1 className="text-2xl font-bold text-white tracking-tight">欢迎回来</h1>
              <p className="text-slate-400 text-sm">输入您的凭据以访问 Aegis 指挥中心。</p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">密码</label>
                <input 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void handleLogin()}
                  placeholder="••••••••" 
                  className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all" 
                />
                {error && <p className="text-[10px] text-danger font-bold uppercase">{error}</p>}
              </div>
              <button onClick={() => void handleLogin()} className="w-full py-3 bg-accent text-white font-bold rounded-xl shadow-lg shadow-accent/20 hover:bg-accent/90 transition-all active:scale-[0.98]">
                登录 Aegis
              </button>
              <p className="text-center text-[10px] text-slate-600 uppercase tracking-widest font-bold">
                安全等级: 绝密 (Top Secret)
              </p>
            </div>
          </div>
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <MainLayout
        sidebar={(
          <Sidebar
            activeTab={activeTab}
            sidebarOpen={sidebarOpen}
            onTabChange={setActiveTab}
            onCollapse={() => setSidebarOpen(false)}
            onLogout={() => void handleLogout()}
          />
        )}
        topbar={(
          <AppTopbar
            activeTab={activeTab}
            sidebarOpen={sidebarOpen}
            onOpenSidebar={() => setSidebarOpen(true)}
            showNotifications={showNotifications}
            onToggleNotifications={() => setShowNotifications((prev) => !prev)}
            onCloseNotifications={() => setShowNotifications(false)}
            notifications={notifications}
            unreadCount={unreadNotificationCount}
            notificationsLoading={notificationsLoading}
            markingAllRead={markingAllRead}
            onMarkAllRead={() => void markAllNotificationsRead()}
            onNotificationClick={(notification) => void handleNotificationClick(notification)}
            onViewHistory={() => {
              setShowNotifications(false);
              setActiveTab('audit');
            }}
            onLogout={() => void handleLogout()}
          />
        )}
        overlays={<ToastContainer toasts={toasts} />}
      >
          <Suspense fallback={<div className="h-full flex items-center justify-center text-sm text-slate-400">页面加载中...</div>}>
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="h-full"
              >
                {activeTab === 'dashboard' && <DashboardPage onNavigate={handleNavigate} onSelectProject={handleSelectProject} onSelectAgent={handleSelectAgent} addToast={addToast} onOpenNewProject={() => setIsNewProjectOpen(true)} onOpenDecisionCenter={() => setIsDecisionCenterOpen(true)} />}
                {activeTab === 'agent-commander' && <AgentCommanderPage agentId={selectedAgentId} addToast={addToast} sendCommand={sendAgentMessage} />}
                {activeTab === 'project-room' && (
                  <ProjectRoomPage
                    projectId={selectedProjectId}
                    addToast={addToast}
                    onRefreshData={refreshAllData}
                    onProjectMissing={(missingProjectId) => {
                      if (selectedProjectId === missingProjectId) {
                        setSelectedProjectId(null);
                      }
                      setActiveTab('projects');
                      addToast('项目不存在或已删除，已返回项目列表', 'info');
                    }}
                  />
                )}
                {activeTab === 'system-health' && <SystemOpsPage onNavigate={handleNavigate} addToast={addToast} onRefreshData={refreshAllData} />}
                {activeTab === 'model-nexus' && <ModelNexusPage addToast={addToast} onOpenNewModel={() => setIsNewModelOpen(true)} onRefreshData={refreshAllData} />}
                {activeTab === 'monitoring' && <MonitoringPage addToast={addToast} onNavigate={handleNavigate} />}
                {activeTab === 'projects' && <ProjectsPage onSelectProject={handleSelectProject} addToast={addToast} onOpenNewProject={() => setIsNewProjectOpen(true)} onRefreshData={refreshAllData} />}
                {activeTab === 'agents' && (
                  <AgentsPage
                    onSelectAgent={handleSelectAgent}
                    addToast={addToast}
                    onOpenTopology={() => setIsTopologyOpen(true)}
                    onOpenDeploy={() => setIsDeployOpen(true)}
                    onOpenRoleSets={() => setIsRoleSetsOpen(true)}
                    onOpenConfig={(id: string) => {
                      setSelectedAgentId(id);
                      setIsAgentConfigOpen(true);
                    }}
                  />
                )}
                {activeTab === 'workspace' && <WorkspacePage addToast={addToast} workspace={workspace} onRefreshData={refreshAllData} onNavigate={handleNavigate} />}
                {activeTab === 'audit' && <AuditPage />}
                {activeTab === 'settings' && <SettingsPage addToast={addToast} onRuntimeUpdated={refreshAllData} />}
              </motion.div>
            </AnimatePresence>
          </Suspense>

          <Suspense fallback={null}>
            <AnimatePresence>
              {isNewModelOpen && (
                <NewModelModal
                  isOpen={isNewModelOpen}
                  onClose={() => setIsNewModelOpen(false)}
                  addToast={addToast}
                  onCreated={refreshAllData}
                />
              )}
              {isAgentConfigOpen && <AgentConfigModal isOpen={isAgentConfigOpen} onClose={() => setIsAgentConfigOpen(false)} agentId={selectedAgentId} addToast={addToast} onUpdated={refreshAllData} />}
              {isTopologyOpen && <TeamTopologyModal isOpen={isTopologyOpen} onClose={() => setIsTopologyOpen(false)} />}
              {isDeployOpen && <DeployAgentModal isOpen={isDeployOpen} onClose={() => setIsDeployOpen(false)} addToast={addToast} onDeployed={refreshAllData} />}
              {isRoleSetsOpen && <IndustryRoleSetsModal isOpen={isRoleSetsOpen} onClose={() => setIsRoleSetsOpen(false)} addToast={addToast} onUpdated={refreshAllData} />}
              {isNewProjectOpen && <NewProjectModal isOpen={isNewProjectOpen} onClose={() => setIsNewProjectOpen(false)} addToast={addToast} onProjectCreated={() => { void refreshAllData(); }} />}
              {isDecisionCenterOpen && <DecisionCenterModal isOpen={isDecisionCenterOpen} onClose={() => setIsDecisionCenterOpen(false)} addToast={addToast} />}
            </AnimatePresence>
          </Suspense>
      </MainLayout>
    </ErrorBoundary>
  );
}
