import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { 
  LayoutDashboard, 
  Briefcase, 
  Users, 
  Terminal, 
  Settings, 
  ShieldCheck, 
  Activity,
  Search,
  Bell,
  ChevronRight,
  ChevronLeft,
  Command,
  Cpu,
  Zap,
  MessageSquare,
  FileText,
  History,
  BrainCircuit,
  Database,
  Lock,
  Globe,
  Plus,
  LogOut,
  AlertCircle,
  CheckCircle2,
  Clock,
  Layers,
  BarChart3,
  ExternalLink,
  ChevronDown,
  Filter,
  MoreVertical,
  Edit3,
  Trash2,
  Play,
  Pause,
  RotateCcw,
  Eye,
  EyeOff,
  Languages,
  UserPlus,
  HelpCircle,
  Code2,
  Workflow,
  Info,
  DollarSign,
  Upload,
  FileUp,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
  AreaChart, Area, ReferenceLine
} from 'recharts';
import { cn } from './lib/utils';
import { Agent, Project, Task, Session, AgentStatus, ProjectStatus, Model } from './types';
import { useRealData } from './useRealData';
import {
  agentsApi,
  auditApi,
  authApi,
  modelsApi,
  notificationsApi,
  projectsApi,
  systemApi,
  type Model as ApiModel,
  type NotificationInboxItem,
  type SystemAuditLog,
} from './lib/api';
import { fetchOpenClawAgentDetail, sendBatchAgentMessage } from './lib/adapters';

let models: Model[] = [];
let agents: Agent[] = [];
let sessions: Session[] = [];
let projects: Project[] = [];
let tasks: Task[] = [];

const syncRuntimeCollections = (payload: {
  models: Model[];
  agents: Agent[];
  projects: Project[];
  tasks: Task[];
  sessions: Session[];
}) => {
  models = payload.models;
  agents = payload.agents;
  projects = payload.projects;
  tasks = payload.tasks;
  sessions = payload.sessions;
};

function buildRuntimeModels(
  runtime: unknown,
  agents: Agent[],
  projects: Project[],
  tasks: Task[],
  sessions: Session[],
): Model[] {
  const runtimeInfo = (runtime ?? {}) as {
    provider?: string;
    model?: string;
    modelName?: string;
    mode?: string;
  };

  const provider = runtimeInfo.provider || 'OpenClaw Runtime';
  const modelName = runtimeInfo.modelName || runtimeInfo.model || `${provider} Core`;
  const runtimeMode = runtimeInfo.mode || 'normal';

  const totalTokens = Math.max(
    agents.reduce((sum, agent) => sum + (agent.tokensUsed || 0), 0) + sessions.reduce((sum, session) => sum + (session.tokens || 0), 0),
    1,
  );
  const dailyTokens = Math.max(agents.reduce((sum, agent) => sum + (agent.tokensUsed || 0), 0), 1);
  const activeSessions = sessions.filter((session) => session.status === 'active').length;
  const throughputBase = Math.max(agents.length * 3 + activeSessions * 5 + tasks.length, 8);
  const latencyBase = runtimeMode === 'production' ? 120 : 180;

  const status: Model['status'] = runtimeMode === 'degraded'
    ? 'Degraded'
    : runtimeMode === 'offline'
      ? 'Offline'
      : 'Healthy';

  return [
    {
      id: 'runtime',
      name: modelName,
      provider,
      status,
      totalTokens,
      dailyTokens,
      currentTask: projects[0]?.name ? `推进项目: ${projects[0].name}` : '等待任务分配',
      latency: `${latencyBase + Math.min(activeSessions * 8, 220)}ms`,
      throughput: `${throughputBase.toFixed(1)} t/s`,
      logs: [],
    },
  ];
}

function toUiModel(model: ApiModel): Model {
  const normalizedStatus: Model['status'] =
    model.status === 'Offline'
      ? 'Offline'
      : model.status === 'Degraded'
        ? 'Degraded'
        : 'Healthy';

  const currentTask = model.currentTask?.trim()
    || '待分配任务';

  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    status: normalizedStatus,
    totalTokens: Number(model.totalTokens || 0),
    dailyTokens: Number(model.dailyTokens || 0),
    currentTask,
    latency: model.latency || 'N/A',
    throughput: model.throughput || 'N/A',
    logs: [],
  };
}

// --- Components ---

const NavItem = ({ icon: Icon, label, active, onClick, collapsed, badge }: any) => (
  <button
    onClick={onClick}
    className={cn(
      "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group relative",
      active 
        ? "bg-primary text-surface shadow-lg shadow-primary/20" 
        : "text-slate-400 hover:bg-white/5 hover:text-white",
      collapsed && "justify-center px-0"
    )}
  >
    <Icon size={20} className={cn("shrink-0", active ? "text-surface" : "group-hover:scale-110 transition-transform")} />
    {!collapsed && (
      <motion.span 
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        className="text-xs font-bold whitespace-nowrap overflow-hidden"
      >
        {label}
      </motion.span>
    )}
    {badge && !collapsed && (
      <span className="ml-auto px-1.5 py-0.5 bg-danger text-[8px] font-bold text-white rounded-full">
        {badge}
      </span>
    )}
    {collapsed && (
      <div className="absolute left-14 bg-surface-muted border border-border-subtle px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
        {label}
      </div>
    )}
  </button>
);

const Badge = ({ children, variant = 'default' }: any) => {
  const variants: any = {
    default: 'bg-white/5 text-slate-400 border-border-subtle',
    primary: 'bg-primary/20 text-primary border-primary/20',
    accent: 'bg-accent/20 text-accent border-accent/20',
    warning: 'bg-warning/20 text-warning border-warning/20',
    danger: 'bg-danger/20 text-danger border-danger/20',
  };
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border", variants[variant])}>
      {children}
    </span>
  );
};

// --- Pages ---

const ToastContainer = ({ toasts }: { toasts: any[] }) => (
  <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 pointer-events-none">
    <AnimatePresence>
      {toasts.map((toast) => (
        <motion.div
          key={toast.id}
          initial={{ opacity: 0, x: 50, scale: 0.9 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 20, scale: 0.95 }}
          className={cn(
            "px-4 py-3 rounded-xl shadow-2xl border flex items-center gap-3 min-w-[240px] pointer-events-auto",
            toast.type === 'success' ? "bg-primary/10 border-primary/20 text-primary" :
            toast.type === 'error' ? "bg-danger/10 border-danger/20 text-danger" :
            "bg-surface-muted border-border-subtle text-white"
          )}
        >
          {toast.type === 'success' && <CheckCircle2 size={18} />}
          {toast.type === 'error' && <AlertCircle size={18} />}
          {toast.type === 'info' && <Info size={18} />}
          <span className="text-sm font-medium">{toast.message}</span>
        </motion.div>
      ))}
    </AnimatePresence>
  </div>
);

const ModelUsageChart = () => {
  const data = useMemo(() => {
    const palette = ['#00f2ff', '#f2ff00', '#ff00f2', '#10b981', '#f97316', '#60a5fa'];
    return models.map((model, index) => ({
      name: model.name,
      value: model.dailyTokens,
      color: palette[index % palette.length],
    }));
  }, [models]);

  return (
    <div className="h-[280px] w-full flex flex-col items-center justify-center">
      <div className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={75}
              paddingAngle={8}
              dataKey="value"
              stroke="none"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip 
              contentStyle={{ backgroundColor: '#1a1b1e', border: '1px solid #2d2e32', borderRadius: '12px', fontSize: '12px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
              itemStyle={{ color: '#fff' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-4">
        {data.map((entry, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
            <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest truncate max-w-[80px]">{entry.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const Modal = ({ isOpen, onClose, title, children }: { isOpen: boolean, onClose: () => void, title: string, children: React.ReactNode }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-surface/80 backdrop-blur-sm"
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-2xl bg-surface-soft border border-border-subtle rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <header className="px-8 py-6 border-b border-border-subtle flex justify-between items-center bg-white/5">
          <h2 className="text-xl font-bold text-white">{title}</h2>
          <button onClick={onClose} className="p-2 text-slate-500 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-8">
          {children}
        </div>
      </motion.div>
    </div>
  );
};

const NewModelModal = ({
  isOpen,
  onClose,
  addToast,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onCreated?: () => Promise<void> | void;
}) => {
  const [step, setStep] = useState(1);
  const [provider, setProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [modelName, setModelName] = useState('');
  const [tokenLimit, setTokenLimit] = useState('1000000');
  const [submitting, setSubmitting] = useState(false);

  const resetForm = () => {
    setStep(1);
    setProvider('');
    setApiKey('');
    setApiBaseUrl('');
    setModelName('');
    setTokenLimit('1000000');
    setSubmitting(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleCreateModel = async () => {
    const normalizedProvider = provider.trim();
    const normalizedName = modelName.trim();
    const normalizedLimit = Number(tokenLimit);

    if (!normalizedProvider) {
      addToast('请先选择模型提供商', 'error');
      setStep(1);
      return;
    }
    if (!normalizedName) {
      addToast('请输入模型名称', 'error');
      return;
    }
    if (!Number.isFinite(normalizedLimit) || normalizedLimit <= 0) {
      addToast('请输入有效的每日 Token 限额', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const created = await modelsApi.create({
        name: normalizedName,
        provider: normalizedProvider,
        apiKey: apiKey.trim() || undefined,
        apiBaseUrl: apiBaseUrl.trim() || undefined,
        tokenLimit: Math.floor(normalizedLimit),
      });

      try {
        await modelsApi.healthCheck(created.id);
      } catch {
        // Health check is optional for initial creation; ignore transient failures.
      }

      if (onCreated) {
        await onCreated();
      }
      addToast('模型接入成功！', 'success');
      handleClose();
    } catch (error) {
      addToast(`模型接入失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="接入新计算模型">
      <div className="space-y-8">
        <div className="flex items-center gap-4 mb-8">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors",
                step >= s ? "bg-primary text-surface" : "bg-white/5 text-slate-500 border border-border-subtle"
              )}>
                {s}
              </div>
              <div className={cn("h-px w-8 bg-border-subtle", step > s && "bg-primary")} />
            </div>
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-6">
            <h3 className="text-lg font-bold text-white">选择模型提供商</h3>
            <div className="grid grid-cols-2 gap-4">
              {['OpenAI', 'Anthropic', 'Google Gemini', 'Meta Llama', 'Mistral AI', '本地部署'].map((providerOption) => (
                <button 
                  key={providerOption}
                  onClick={() => {
                    setProvider(providerOption);
                    setStep(2);
                  }}
                  className={cn(
                    "p-4 border rounded-2xl text-left transition-all group",
                    provider === providerOption
                      ? "bg-primary/10 border-primary/40"
                      : "bg-white/5 border-border-subtle hover:border-primary/50 hover:bg-primary/5",
                  )}
                >
                  <p className="font-bold text-white group-hover:text-primary transition-colors">{providerOption}</p>
                  <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-widest">点击选择并继续</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <h3 className="text-lg font-bold text-white">配置 API 凭据</h3>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">API 密钥</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">自定义端点 (可选)</label>
                <input
                  type="text"
                  value={apiBaseUrl}
                  onChange={(e) => setApiBaseUrl(e.target.value)}
                  placeholder="https://api.example.com/v1"
                  className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>
            <div className="flex gap-4 pt-4">
              <button onClick={() => setStep(1)} className="flex-1 py-3 bg-white/5 border border-border-subtle rounded-xl text-sm font-bold hover:bg-white/10 transition-all">返回</button>
              <button onClick={() => setStep(3)} className="flex-1 py-3 bg-primary text-surface rounded-xl text-sm font-bold hover:bg-primary/90 transition-all">下一步</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <h3 className="text-lg font-bold text-white">模型参数与限额</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">模型名称</label>
                  <input
                    type="text"
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    placeholder="gpt-4o"
                    className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">每日 Token 限额</label>
                  <input
                    type="number"
                    value={tokenLimit}
                    onChange={(e) => setTokenLimit(e.target.value)}
                    placeholder="1000000"
                    className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>
              <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl flex items-center gap-3">
                <ShieldCheck size={20} className="text-primary" />
                <p className="text-xs text-slate-300">系统将自动验证连接并测试延迟。</p>
              </div>
            </div>
            <div className="flex gap-4 pt-4">
              <button onClick={() => setStep(2)} className="flex-1 py-3 bg-white/5 border border-border-subtle rounded-xl text-sm font-bold hover:bg-white/10 transition-all">返回</button>
              <button 
                onClick={() => void handleCreateModel()}
                disabled={submitting}
                className="flex-1 py-3 bg-primary text-surface rounded-xl text-sm font-bold hover:bg-primary/90 transition-all disabled:opacity-60"
              >
                {submitting ? '接入中...' : '完成接入'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

const AgentConfigModal = ({
  isOpen,
  onClose,
  agentId,
  addToast,
  onUpdated,
}: {
  isOpen: boolean;
  onClose: () => void;
  agentId?: string | null;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onUpdated?: () => Promise<void> | void;
}) => {
  const fallbackAgent = agents.find((item) => item.id === agentId) || agents[0] || {
    id: '',
    name: '未选择 Agent',
    role: '待配置角色',
    status: 'Idle' as AgentStatus,
    load: 0,
    currentModelId: '',
    tasks: 0,
    memoryCount: 0,
    tokensUsed: 0,
    tokenLimit: 100000,
    sessionCount: 0,
  };
  const [agentName, setAgentName] = useState(fallbackAgent.name);
  const [agentRole, setAgentRole] = useState(fallbackAgent.role);
  const [selectedModelId, setSelectedModelId] = useState(fallbackAgent.currentModelId || models[0]?.id || '');
  const [loadedModelId, setLoadedModelId] = useState(fallbackAgent.currentModelId || '');
  const [soulInput, setSoulInput] = useState('');
  const [loadedSoul, setLoadedSoul] = useState('');
  const [sopInput, setSopInput] = useState('');
  const [loadedSop, setLoadedSop] = useState<string[]>([]);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setAgentName(fallbackAgent.name);
    setAgentRole(fallbackAgent.role);
    setSelectedModelId(fallbackAgent.currentModelId || models[0]?.id || '');
    setLoadedModelId(fallbackAgent.currentModelId || '');
    setSoulInput('');
    setLoadedSoul('');
    setSopInput('');
    setLoadedSop([]);
  }, [fallbackAgent.id, fallbackAgent.name, fallbackAgent.role, fallbackAgent.currentModelId, isOpen]);

  useEffect(() => {
    if (!isOpen || !fallbackAgent.id) {
      return;
    }

    let active = true;
    const loadDetail = async () => {
      setIsLoadingDetail(true);
      try {
        const detail = await agentsApi.get(fallbackAgent.id);
        if (!active) {
          return;
        }
        const detailSoul = detail.soul?.trim?.() || '';
        const detailSop = Array.isArray(detail.sop) ? detail.sop.map((step) => String(step).trim()).filter(Boolean) : [];
        setAgentName(detail.name || fallbackAgent.name);
        setAgentRole(detail.role || fallbackAgent.role);
        setSelectedModelId(detail.currentModelId || fallbackAgent.currentModelId || models[0]?.id || '');
        setLoadedModelId(detail.currentModelId || fallbackAgent.currentModelId || '');
        setSoulInput(detailSoul);
        setLoadedSoul(detailSoul);
        setSopInput(detailSop.join('\n'));
        setLoadedSop(detailSop);
      } catch (error) {
        addToast(`加载 Agent 配置失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
      } finally {
        if (active) {
          setIsLoadingDetail(false);
        }
      }
    };

    void loadDetail();
    return () => {
      active = false;
    };
  }, [isOpen, fallbackAgent.id, fallbackAgent.name, fallbackAgent.role, fallbackAgent.currentModelId, addToast]);

  const parseSopInput = () =>
    sopInput
      .split('\n')
      .map((line) => line.replace(/^\d+\.\s*/, '').replace(/^[-*]\s*/, '').trim())
      .filter(Boolean);

  const isSameStringArray = (left: string[], right: string[]) => {
    if (left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => item === right[index]);
  };

  const handleSave = async () => {
    if (!fallbackAgent.id) {
      addToast('未选择可配置的 Agent', 'error');
      return;
    }

    const nextSoul = soulInput.trim();
    if (loadedSoul.trim() && !nextSoul) {
      addToast('SOUL 内容不能为空', 'error');
      return;
    }

    const nextSop = parseSopInput();
    const hasModelChange = Boolean(selectedModelId) && selectedModelId !== loadedModelId;
    const hasSoulChange = nextSoul !== loadedSoul.trim();
    const hasSopChange = !isSameStringArray(nextSop, loadedSop);

    if (!hasModelChange && !hasSoulChange && !hasSopChange) {
      addToast('未检测到配置变更', 'info');
      return;
    }

    setIsSaving(true);
    try {
      if (hasModelChange && selectedModelId) {
        await agentsApi.switchModel(fallbackAgent.id, selectedModelId);
      }
      if (hasSoulChange && nextSoul) {
        await agentsApi.updateSoul(fallbackAgent.id, nextSoul);
      }
      if (hasSopChange) {
        await agentsApi.updateSop(fallbackAgent.id, nextSop);
      }

      if (onUpdated) {
        await onUpdated();
      }
      addToast('Agent 配置已更新', 'success');
      onClose();
    } catch (error) {
      addToast(`保存失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`配置 Agent: ${agentName || fallbackAgent.name}`}>
      <div className="space-y-6">
        {isLoadingDetail && (
          <div className="p-3 bg-white/5 border border-border-subtle rounded-xl text-xs text-slate-400">
            正在加载 Agent 配置...
          </div>
        )}
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Agent 名称</label>
            <input
              type="text"
              value={agentName}
              onChange={(event) => setAgentName(event.target.value)}
              readOnly
              className="w-full bg-surface-muted/70 border border-border-subtle rounded-xl px-4 py-3 text-sm text-slate-300 focus:outline-none cursor-not-allowed"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">核心角色</label>
            <input
              type="text"
              value={agentRole}
              onChange={(event) => setAgentRole(event.target.value)}
              readOnly
              className="w-full bg-surface-muted/70 border border-border-subtle rounded-xl px-4 py-3 text-sm text-slate-300 focus:outline-none cursor-not-allowed"
            />
          </div>
        </div>
        <p className="text-[10px] text-slate-500 -mt-3">名称与角色当前为只读，支持在线修改 SOUL、SOP 和模型。</p>
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">运行模型</label>
          <select
            value={selectedModelId}
            onChange={(event) => setSelectedModelId(event.target.value)}
            className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none"
          >
            <option value="">未选择模型</option>
            {models.map((model) => (
              <option key={model.id} value={model.id}>{model.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">核心身份 (SOUL)</label>
          <textarea
            rows={4}
            className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            value={soulInput}
            onChange={(event) => setSoulInput(event.target.value)}
            placeholder="输入 Agent 的核心身份描述..."
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">标准操作程序 (SOP)</label>
          <textarea
            rows={5}
            className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            value={sopInput}
            onChange={(event) => setSopInput(event.target.value)}
            placeholder={'每行一步，例如：\n1. 分析需求\n2. 识别模糊点\n3. 输出确认卡'}
          />
        </div>
        <button
          onClick={() => void handleSave()}
          disabled={isSaving || isLoadingDetail}
          className="w-full py-3 bg-primary text-surface rounded-xl text-sm font-bold hover:bg-primary/90 transition-all mt-4 disabled:opacity-60"
        >
          {isSaving ? '保存中...' : '保存配置'}
        </button>
      </div>
    </Modal>
  );
};

const TeamTopologyModal = ({ isOpen, onClose }: any) => {
  const topLevelAgents = agents.filter((agent) => {
    const role = (agent.role || '').toLowerCase();
    return role.includes('director') || role.includes('lead') || /总监|负责人|架构/.test(agent.role || '');
  });
  const midLevelAgents = agents.filter((agent) => {
    const role = (agent.role || '').toLowerCase();
    return role.includes('manager') || role.includes('analyst') || /经理|分析|产品/.test(agent.role || '');
  });
  const execAgents = agents.filter((agent) => {
    const role = (agent.role || '').toLowerCase();
    return role.includes('engineer') || role.includes('qa') || /工程|研发|测试/.test(agent.role || '');
  });
  const activeConnections = agents.length > 0 ? agents.length * 2 : 0;
  const syncLatency = agents.length > 0 ? '12-20ms' : '-';

  const topologyAgents = agents.slice(0, 5);
  const positionedNodes = topologyAgents.map((agent, index) => {
    const total = Math.max(topologyAgents.length - 1, 1);
    const x = topologyAgents.length === 1 ? 200 : 60 + Math.round((index * 280) / total);
    const isTop = topLevelAgents.some((item) => item.id === agent.id);
    const isMid = midLevelAgents.some((item) => item.id === agent.id);
    const isExec = execAgents.some((item) => item.id === agent.id);
    const level: 'top' | 'mid' | 'exec' = isTop ? 'top' : isMid ? 'mid' : isExec ? 'exec' : 'exec';
    const y = level === 'top' ? 60 : level === 'mid' ? 150 : 240;
    const fill = level === 'top' ? '#10b981' : level === 'mid' ? '#8b5cf6' : '#64748b';
    const label = agent.name.length > 8 ? `${agent.name.slice(0, 8)}...` : agent.name;
    return { ...agent, x, y, fill, level, label };
  });
  const topNodes = positionedNodes.filter((node) => node.level === 'top');
  const fallbackTopNode = positionedNodes[0];
  const nodeLinks = positionedNodes
    .filter((node) => node.level !== 'top')
    .map((node, index) => {
      const from = topNodes[index % Math.max(topNodes.length, 1)] || fallbackTopNode;
      return from ? { from, to: node } : null;
    })
    .filter(Boolean) as Array<{
      from: { x: number; y: number };
      to: { x: number; y: number };
    }>;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="团队拓扑图谱">
      <div className="space-y-6">
        <div className="h-[400px] w-full bg-surface-muted rounded-2xl border border-border-subtle relative overflow-hidden flex items-center justify-center bg-[radial-gradient(circle_at_50%_50%,rgba(16,185,129,0.05),transparent_70%)]">
          <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#10b981 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
          <svg className="w-full h-full relative z-10" viewBox="0 0 400 300">
            <defs>
              <filter id="glow">
                <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <g stroke="rgba(16, 185, 129, 0.3)" strokeWidth="1.5" filter="url(#glow)">
              {nodeLinks.map((link, index) => (
                <line
                  key={`line-${index}`}
                  x1={link.from.x}
                  y1={link.from.y}
                  x2={link.to.x}
                  y2={link.to.y}
                />
              ))}
            </g>

            {positionedNodes.map((node) => (
              <g key={node.id}>
                {node.level === 'top' ? (
                  <motion.circle
                    cx={node.x}
                    cy={node.y}
                    r="22"
                    fill={node.fill}
                    animate={{ r: [22, 24, 22] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                ) : (
                  <circle cx={node.x} cy={node.y} r={node.level === 'mid' ? 18 : 12} fill={node.fill} />
                )}
                <text
                  x={node.x}
                  y={node.y + (node.level === 'exec' ? 24 : 35)}
                  textAnchor="middle"
                  fill={node.level === 'exec' ? '#94a3b8' : 'white'}
                  fontSize={node.level === 'exec' ? '8' : '9'}
                  fontWeight={node.level === 'top' ? 'bold' : 'medium'}
                >
                  {node.label}
                </text>
              </g>
            ))}

            {positionedNodes.length === 0 && (
              <text x="200" y="160" textAnchor="middle" fill="#94a3b8" fontSize="12">
                暂无 Agent 数据
              </text>
            )}
          </svg>

          <div className="absolute bottom-4 left-4 p-3 bg-surface/80 backdrop-blur-md border border-border-subtle rounded-xl space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary" />
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">核心决策层</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-accent" />
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">逻辑处理层</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-slate-500" />
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">任务执行层</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-white/5 border border-border-subtle rounded-xl">
            <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">活跃连接</h4>
            <p className="text-xl font-bold text-white">{activeConnections} <span className="text-xs font-normal text-slate-500">个通道</span></p>
          </div>
          <div className="p-4 bg-white/5 border border-border-subtle rounded-xl">
            <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">同步延迟</h4>
            <p className="text-xl font-bold text-primary">{syncLatency}</p>
          </div>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          {agents.length > 0
            ? `当前拓扑显示了 ${agents.length} 个 Agent 之间的协作关系。`
            : '暂无 Agent 数据'}
        </p>
      </div>
    </Modal>
  );
};

const DeployAgentModal = ({
  isOpen,
  onClose,
  addToast,
  onDeployed,
}: {
  isOpen: boolean;
  onClose: () => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onDeployed?: () => Promise<void> | void;
}) => {
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [isCustom, setIsCustom] = useState(false);
  const [customTemplateRaw, setCustomTemplateRaw] = useState('');
  const [agentName, setAgentName] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);

  const uniqueRoles = useMemo(() => {
    const seen = new Set<string>();
    const roles: Array<{ id: string; name: string; desc: string; role: string; modelId?: string }> = [];
    agents.forEach((agent) => {
      const role = (agent.role || '').trim() || '通用 Agent';
      if (!seen.has(role)) {
        seen.add(role);
        roles.push({
          id: `role:${role}`,
          name: role,
          desc: `参考 ${agent.name} 的配置`,
          role,
          modelId: agent.currentModelId || '',
        });
      }
    });
    return roles.slice(0, 6);
  }, [agents]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setSelectedProjectId(projects[0]?.id || '');
    setAgentName('');
    setSelectedTemplate(null);
    setIsCustom(false);
    setCustomTemplateRaw('');
  }, [isOpen]);

  const selectedTemplateConfig = uniqueRoles.find((item) => item.id === selectedTemplate);

  const parseCustomTemplate = () => {
    const trimmed = customTemplateRaw.trim();
    if (!trimmed) {
      return {
        role: '',
        soul: '',
        sop: [] as string[],
        modelId: '',
      };
    }

    try {
      const parsed = JSON.parse(trimmed) as {
        role?: unknown;
        soul?: unknown;
        sop?: unknown;
        capabilities?: unknown;
        modelId?: unknown;
      };
      const role = String(parsed.role ?? '').trim();
      const soul = String(parsed.soul ?? '').trim();
      const modelId = String(parsed.modelId ?? '').trim();
      const rawSop = Array.isArray(parsed.sop) ? parsed.sop : Array.isArray(parsed.capabilities) ? parsed.capabilities : [];
      const sop = rawSop.map((item) => String(item ?? '').trim()).filter(Boolean);
      return { role, soul, sop, modelId };
    } catch {
      return null;
    }
  };

  const handleDeploy = async () => {
    const safeName = agentName.trim();
    if (!safeName) {
      addToast('请输入 Agent 名称', 'error');
      return;
    }

    const parsedCustom = parseCustomTemplate();
    if (parsedCustom === null) {
      addToast('自定义模板 JSON 解析失败，请检查格式', 'error');
      return;
    }

    const role = selectedTemplateConfig?.role || parsedCustom.role || 'Custom Agent';
    const modelId = selectedTemplateConfig?.modelId || parsedCustom.modelId || models[0]?.id || undefined;
    const soul = parsedCustom.soul || undefined;
    const sop = parsedCustom.sop.length > 0 ? parsedCustom.sop : undefined;

    setIsDeploying(true);
    try {
      await agentsApi.create({
        name: safeName,
        role,
        modelId,
        soul,
        sop,
      });

      if (onDeployed) {
        await onDeployed();
      }

      addToast('Agent 部署成功，已加入团队', 'success');
      if (selectedProjectId) {
        addToast('当前版本请在项目详情中手动关联 Agent', 'info');
      }
      onClose();
    } catch (error) {
      addToast(`部署失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="部署新 Agent">
      <div className="space-y-6">
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-white uppercase tracking-widest">选择角色模板</h3>
            <button
              onClick={() => setIsCustom(!isCustom)}
              className="text-[10px] font-bold text-primary hover:underline uppercase tracking-widest"
            >
              {isCustom ? "选择预设" : "自定义模板"}
            </button>
          </div>

          {!isCustom ? (
            <div className="grid grid-cols-2 gap-3">
              {uniqueRoles.length > 0 ? uniqueRoles.map((template) => (
                <button
                  key={template.id}
                  onClick={() => setSelectedTemplate(template.id)}
                  className={cn(
                    "p-4 border rounded-2xl text-left transition-all",
                    selectedTemplate === template.id ? "bg-primary/10 border-primary" : "bg-white/5 border-border-subtle hover:bg-white/10"
                  )}
                >
                  <p className={cn("font-bold text-sm", selectedTemplate === template.id ? "text-primary" : "text-white")}>{template.name}</p>
                  <p className="text-[10px] text-slate-500 mt-1">{template.desc}</p>
                </button>
              )) : (
                <p className="col-span-2 text-center text-slate-500 py-8">暂无可用 Agent 角色</p>
              )}
            </div>
          ) : (
            <div className="space-y-4 p-4 bg-white/5 border border-dashed border-border-subtle rounded-2xl">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">模板定义 (JSON)</label>
                <textarea
                  rows={5}
                  value={customTemplateRaw}
                  onChange={(event) => setCustomTemplateRaw(event.target.value)}
                  placeholder='{ "role": "Reviewer", "soul": "...", "sop": ["步骤1","步骤2"] }'
                  className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                />
              </div>
              <button
                onClick={() => {
                  setSelectedTemplate('custom');
                  setIsCustom(false);
                }}
                className="w-full py-2 bg-white/10 hover:bg-white/20 rounded-xl text-[10px] font-bold text-white transition-all uppercase tracking-widest"
              >
                应用自定义模板
              </button>
            </div>
          )}
        </div>

        {(selectedTemplate || isCustom) && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 pt-4 border-t border-border-subtle">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Agent 命名</label>
              <input
                type="text"
                value={agentName}
                onChange={(event) => setAgentName(event.target.value)}
                placeholder="例如: Aegis-Alpha"
                className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">分配项目</label>
              <select
                value={selectedProjectId}
                onChange={(event) => setSelectedProjectId(event.target.value)}
                className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none"
              >
                <option value="">暂不分配项目</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </div>
            <button
              onClick={() => void handleDeploy()}
              disabled={isDeploying}
              className="w-full py-3 bg-primary text-surface rounded-xl text-sm font-bold hover:bg-primary/90 transition-all mt-4 disabled:opacity-60"
            >
              {isDeploying ? '部署中...' : '立即部署'}
            </button>
          </motion.div>
        )}
      </div>
    </Modal>
  );
};

type ParsedProjectDraft = {
  name: string;
  description: string;
  phase: string;
  agents: string[];
  priority: 'High' | 'Medium' | 'Low';
  team: string[];
};

const NewProjectModal = ({ isOpen, onClose, addToast, onProjectCreated }: any) => {
  const [isImporting, setIsImporting] = useState(false);
  const [step, setStep] = useState<'input' | 'confirm'>('input');
  const [rawInput, setRawInput] = useState('');
  const [parsedProject, setParsedProject] = useState<ParsedProjectDraft | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    priority: 'Medium',
    dueDate: '',
    agentIds: [] as string[],
  });

  const resetState = () => {
    setIsImporting(false);
    setStep('input');
    setRawInput('');
    setParsedProject(null);
    setIsParsing(false);
    setIsCreating(false);
    setShowManualForm(false);
    setFormData({
      name: '',
      description: '',
      priority: 'Medium',
      dueDate: '',
      agentIds: [],
    });
  };

  const suggestName = (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) {
      return '';
    }

    const candidate = trimmed
      .replace(/(请|帮我|我们|需要|想要|希望|做一个|做个|创建|搭建|开发|实现|一个|项目|系统)/g, ' ')
      .replace(/[，。,.!?]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4)
      .join('');

    return candidate ? candidate.slice(0, 16) + '项目' : '新项目';
  };

  const parseNaturalLanguage = (input: string): ParsedProjectDraft => {
    const trimmed = input.trim();
    const firstSentence = trimmed
      .split(/[。！？.!?\n]/)
      .map((line) => line.trim())
      .find(Boolean) || trimmed;

    const matchedName = trimmed.match(/(?:项目|系统|平台|应用|工作台|MVP)(?:名称|叫|名为)?[:：]?\s*([^\n，。；]{2,24})/);
    let safeName = matchedName?.[1]?.trim() || suggestName(firstSentence) || '新项目';
    if (!/(项目|系统|平台|应用|工作台|MVP)/.test(safeName)) {
      safeName = `${safeName}项目`;
    }
    if (safeName.length > 32) {
      safeName = `${safeName.slice(0, 32)}...`;
    }

    const lower = trimmed.toLowerCase();
    const inferPriority: 'High' | 'Medium' | 'Low' =
      /(紧急|立即|尽快|高优|asap|critical|urgent)/.test(lower) ? 'High'
      : /(低优|可延期|不紧急|nice to have|backlog)/.test(lower) ? 'Low'
      : 'Medium';

    const inferredAgents = agents
      .filter((agent) => {
        const profile = `${agent.name} ${agent.role}`.toLowerCase();
        if (trimmed.includes(agent.name) || trimmed.includes(agent.role)) {
          return true;
        }
        if (/(设计|ui|体验|视觉)/.test(lower) && /(设计|设计)/.test(profile)) {
          return true;
        }
        if (/(研发|开发|编码|工程|技术)/.test(lower) && /(研发|工程|架构)/.test(profile)) {
          return true;
        }
        if (/(测试|质量|qa)/.test(lower) && /(测试|qa)/.test(profile)) {
          return true;
        }
        if (/(需求|规划|产品)/.test(lower) && /(需求|产品|分析)/.test(profile)) {
          return true;
        }
        return false;
      })
      .map((agent) => agent.name);

    const selectedManualAgents = formData.agentIds
      .map((id) => agents.find((agent) => agent.id === id)?.name)
      .filter(Boolean) as string[];

    const safeAgents = selectedManualAgents.length > 0
      ? selectedManualAgents
      : inferredAgents.length > 0
        ? inferredAgents.slice(0, 4)
        : agents.slice(0, 3).map((agent) => agent.name);

    return {
      name: safeName,
      description: trimmed,
      phase: '规划中',
      agents: safeAgents,
      priority: inferPriority,
      team: safeAgents,
    };
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleImportProjectFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const raw = await file.text();
      const normalized = raw.trim();
      if (!normalized) {
        addToast('文件内容为空，请重新选择', 'error');
        return;
      }
      const nextInput = normalized.slice(0, 6000);
      setRawInput(nextInput);
      setIsImporting(false);
      setStep('input');
      addToast(`已导入文件: ${file.name}`, 'success');
    } catch (error) {
      addToast(`文件读取失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      event.target.value = '';
    }
  };

  const handleToggleManualAgent = (agentId: string) => {
    setFormData((prev) => ({
      ...prev,
      agentIds: prev.agentIds.includes(agentId)
        ? prev.agentIds.filter((id) => id !== agentId)
        : [...prev.agentIds, agentId],
    }));
  };

  const handleParseInput = () => {
    const input = rawInput.trim();
    if (!input) {
      addToast('请先输入项目需求', 'error');
      return;
    }

    setIsParsing(true);
    const parsed = parseNaturalLanguage(input);
    setParsedProject(parsed);
    setStep('confirm');
    setIsParsing(false);
    addToast('已生成项目理解确认卡', 'success');
  };

  const handleCreateFromParsed = async () => {
    if (!parsedProject) {
      return;
    }

    setIsCreating(true);
    try {
      await projectsApi.create({
        name: parsedProject.name,
        description: parsedProject.description,
        requirements: rawInput.trim() || parsedProject.description,
      });
      addToast('项目创建成功，正在分配资源...', 'success');
      onProjectCreated?.();
      handleClose();
    } catch (error: any) {
      addToast('创建失败: ' + error.message, 'error');
    } finally {
      setIsCreating(false);
    }
  };

  const handleManualSubmit = () => {
    if (!formData.name.trim()) {
      addToast('请输入项目名称', 'error');
      return;
    }

    if (!formData.description.trim()) {
      addToast('请输入项目描述', 'error');
      return;
    }

    const manualAgents = formData.agentIds
      .map((id) => agents.find((agent) => agent.id === id)?.name)
      .filter(Boolean) as string[];

    setParsedProject({
      name: formData.name.trim(),
      description: formData.description.trim(),
      phase: '规划中',
      agents: manualAgents.length > 0 ? manualAgents : agents.slice(0, 3).map((agent) => agent.name),
      priority: formData.priority as 'High' | 'Medium' | 'Low',
      team: manualAgents,
    });
    setStep('confirm');
    addToast('已生成项目理解确认卡', 'success');
  };

  const handleUseManualFromParsed = () => {
    if (!parsedProject) {
      return;
    }

    const selectedIds = agents
      .filter((agent) => parsedProject.agents.includes(agent.name))
      .map((agent) => agent.id);

    setFormData({
      name: parsedProject.name,
      description: parsedProject.description,
      priority: parsedProject.priority,
      dueDate: '',
      agentIds: selectedIds,
    });
    setShowManualForm(true);
    setStep('input');
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="创建新项目">
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">FR-010 自然语言创建</p>
          <button
            onClick={() => setIsImporting(!isImporting)}
            className="text-[10px] font-bold text-primary hover:underline uppercase tracking-widest flex items-center gap-1"
          >
            <Upload size={12} />
            {isImporting ? '返回创建流程' : '导入项目定义'}
          </button>
        </div>

        {!isImporting ? (
          <>
            {step === 'input' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">项目需求（自然语言）</label>
                  <textarea
                    rows={5}
                    value={rawInput}
                    onChange={(event) => setRawInput(event.target.value)}
                    placeholder="例如：请创建一个电商客服优化项目，2周内完成 MVP，优先由多个 Agent 并行推进。"
                    className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={handleParseInput}
                    disabled={isParsing || !rawInput.trim()}
                    className="py-3 bg-primary text-surface rounded-xl text-sm font-bold hover:bg-primary/90 transition-all disabled:opacity-50"
                  >
                    {isParsing ? 'AI 解析中...' : 'AI 解析并生成确认卡'}
                  </button>
                  <button
                    onClick={() => setShowManualForm((prev) => !prev)}
                    className="py-3 bg-white/5 border border-border-subtle rounded-xl text-sm font-bold hover:bg-white/10 transition-all"
                  >
                    {showManualForm ? '收起手动表单' : '手动填写'}
                  </button>
                </div>

                {showManualForm && (
                  <div className="space-y-4 p-4 bg-white/5 border border-border-subtle rounded-2xl">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">项目名称</label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(event) => setFormData((prev) => ({ ...prev, name: event.target.value }))}
                        placeholder="例如: 智能供应链优化"
                        className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">项目描述</label>
                      <textarea
                        rows={3}
                        value={formData.description}
                        onChange={(event) => setFormData((prev) => ({ ...prev, description: event.target.value }))}
                        placeholder="简述项目目标、范围和关键约束..."
                        className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">优先级</label>
                        <select
                          value={formData.priority}
                          onChange={(event) => setFormData((prev) => ({ ...prev, priority: event.target.value as 'High' | 'Medium' | 'Low' }))}
                          className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none"
                        >
                          <option value="High">高 (High)</option>
                          <option value="Medium">中 (Medium)</option>
                          <option value="Low">低 (Low)</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">截止日期</label>
                        <input
                          type="date"
                          value={formData.dueDate}
                          onChange={(event) => setFormData((prev) => ({ ...prev, dueDate: event.target.value }))}
                          className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">分配团队</label>
                      <div className="flex flex-wrap gap-2">
                        {agents.map((agent) => (
                          <label key={agent.id} className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-border-subtle rounded-xl cursor-pointer hover:bg-white/10 transition-colors">
                            <input
                              type="checkbox"
                              checked={formData.agentIds.includes(agent.id)}
                              onChange={() => handleToggleManualAgent(agent.id)}
                              className="accent-primary"
                            />
                            <span className="text-xs text-slate-300">{agent.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={handleManualSubmit}
                      disabled={isCreating}
                      className="w-full py-3 bg-primary text-surface rounded-xl text-sm font-bold hover:bg-primary/90 transition-all mt-2 disabled:opacity-50"
                    >
                      生成确认卡
                    </button>
                  </div>
                )}
              </div>
            )}

            {step === 'confirm' && parsedProject && (
              <div className="bg-surface-soft border border-warning/20 rounded-2xl p-5 space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-warning">
                    <Zap size={14} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">创建前理解确认卡</span>
                  </div>
                  <Badge variant="warning">待确认</Badge>
                </div>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">名称</label>
                    <input
                      type="text"
                      value={parsedProject.name}
                      onChange={(event) => setParsedProject((prev) => prev ? { ...prev, name: event.target.value } : prev)}
                      className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">描述</label>
                    <textarea
                      rows={3}
                      value={parsedProject.description}
                      onChange={(event) => setParsedProject((prev) => prev ? { ...prev, description: event.target.value } : prev)}
                      className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">阶段</label>
                      <select
                        value={parsedProject.phase}
                        onChange={(event) => setParsedProject((prev) => prev ? { ...prev, phase: event.target.value } : prev)}
                        className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none"
                      >
                        <option value="规划中">规划中</option>
                        <option value="分析">分析</option>
                        <option value="设计">设计</option>
                        <option value="开发">开发</option>
                        <option value="验收">验收</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">优先级</label>
                      <select
                        value={parsedProject.priority}
                        onChange={(event) => setParsedProject((prev) => prev ? { ...prev, priority: event.target.value as 'High' | 'Medium' | 'Low' } : prev)}
                        className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none"
                      >
                        <option value="High">高 (High)</option>
                        <option value="Medium">中 (Medium)</option>
                        <option value="Low">低 (Low)</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">建议团队</label>
                    <div className="flex flex-wrap gap-2">
                      {(parsedProject.agents.length > 0 ? parsedProject.agents : ['未识别，建议手动调整']).map((agentName) => (
                        <span key={agentName} className="px-3 py-1.5 rounded-xl bg-white/5 border border-border-subtle text-xs text-slate-300">
                          {agentName}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setStep('input')}
                    className="flex-1 py-2.5 bg-white/5 border border-border-subtle rounded-xl text-xs font-bold hover:bg-white/10 transition-all"
                  >
                    修改输入
                  </button>
                  <button
                    onClick={handleUseManualFromParsed}
                    className="flex-1 py-2.5 bg-white/5 border border-border-subtle rounded-xl text-xs font-bold hover:bg-white/10 transition-all"
                  >
                    手动微调
                  </button>
                  <button
                    onClick={handleCreateFromParsed}
                    disabled={isCreating}
                    className="flex-1 py-2.5 bg-primary text-surface rounded-xl text-xs font-bold hover:bg-primary/90 transition-all disabled:opacity-50"
                  >
                    {isCreating ? '创建中...' : '确认创建'}
                  </button>
                </div>
                <button
                  onClick={handleClose}
                  className="w-full py-2 bg-transparent border border-border-subtle rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-white/5 transition-all"
                >
                  取消
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="p-8 border-2 border-dashed border-border-subtle rounded-2xl bg-white/5 flex flex-col items-center justify-center space-y-4 group hover:border-primary/50 transition-all cursor-pointer">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
              <FileUp size={24} />
            </div>
            <div className="text-center">
              <p className="text-sm font-bold text-white">点击或拖拽文件到此处</p>
              <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-widest">支持 .json, .yaml, .pdf 项目文档</p>
            </div>
            <input
              type="file"
              className="hidden"
              id="project-file"
              accept=".txt,.md,.json,.yaml,.yml,.csv,.log,.xml"
              onChange={(event) => void handleImportProjectFile(event)}
            />
            <label htmlFor="project-file" className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-[10px] font-bold text-white transition-all cursor-pointer">选择文件</label>
          </div>
        )}
      </div>
    </Modal>
  );
};

const DecisionCenterModal = ({ isOpen, onClose, addToast }: any) => {
  const [selectedDecision, setSelectedDecision] = useState<any>(null);
  const [viewMode, setViewMode] = useState<'list' | 'details' | 'plan'>('list');
  const [isApproving, setIsApproving] = useState(false);
  const formatDecisionTime = (date: string | Date | null | undefined) => {
    if (!date) {
      return new Date().toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    }

    const normalized = new Date(date);
    if (Number.isNaN(normalized.getTime())) {
      return new Date().toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    }

    return normalized.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };
  const getTaskDate = (task: Task) => {
    const taskRecord = task as Task & { createdAt?: string; updatedAt?: string };
    return taskRecord.updatedAt || taskRecord.createdAt || new Date().toISOString();
  };
  const decisions = useMemo(() => {
    const items: Array<{
      id: string;
      title: string;
      desc: string;
      impact: string;
      type: 'warning' | 'danger' | 'info';
      judgment: string;
      events: Array<{ time: string; content: string }>;
      plan: string[];
    }> = [];

    tasks
      .filter((task) => task.status === 'Blocked')
      .slice(0, 2)
      .forEach((task) => {
        const createdAt = getTaskDate(task);
        const updatedAt = getTaskDate(task);
        items.push({
          id: `blocked-${task.id}`,
          title: `任务阻塞: ${task.title}`,
          desc: `任务 "${task.title}" 已被阻塞，等待 ${task.agent || '负责人'} 处理`,
          impact: '进度延迟',
          type: 'warning',
          judgment: `任务在 ${task.agent || '未知Agent'} 执行期间被阻塞，需人工介入或等待资源释放。`,
          events: [
            { time: formatDecisionTime(createdAt), content: '任务创建' },
            { time: formatDecisionTime(updatedAt), content: '任务被阻塞' },
          ],
          plan: ['1. 检查 Agent 资源状态', '2. 确认阻塞依赖', '3. 重新分配或继续等待'],
        });
      });

    agents
      .filter((agent) => agent.load >= 80)
      .slice(0, 2)
      .forEach((agent) => {
        const now = new Date().toISOString();
        items.push({
          id: `overload-${agent.id}`,
          title: `Agent 负载过高: ${agent.name}`,
          desc: `${agent.name} 当前负载 ${agent.load}%，建议分流任务`,
          impact: `负载: ${agent.load}%`,
          type: 'warning',
          judgment: `${agent.name} (${agent.role || '未知角色'}) 负载持续过高，可能影响任务处理效率。`,
          events: [
            { time: formatDecisionTime(now), content: `当前负载: ${agent.load}%` },
            { time: formatDecisionTime(now), content: `任务数: ${agent.tasks}` },
          ],
          plan: ['1. 检查任务队列', '2. 分流到空闲Agent', '3. 监控负载变化'],
        });
      });

    return items.slice(0, 5);
  }, [tasks, agents]);

  const handleClose = () => {
    setSelectedDecision(null);
    setViewMode('list');
    onClose();
  };

  const handleApprovePlan = async () => {
    if (!selectedDecision) {
      return;
    }

    const agentIdByName = new Map(agents.map((agent) => [agent.name, agent.id]));
    let targetAgentIds: string[] = [];

    if (String(selectedDecision.id).startsWith('blocked-')) {
      const taskId = String(selectedDecision.id).replace('blocked-', '');
      const task = tasks.find((item) => String(item.id) === taskId);
      const relatedAgentId = task?.agent ? agentIdByName.get(task.agent) : undefined;
      if (relatedAgentId) {
        targetAgentIds.push(relatedAgentId);
      }
    } else if (String(selectedDecision.id).startsWith('overload-')) {
      const overloadAgentId = String(selectedDecision.id).replace('overload-', '');
      if (agents.some((agent) => agent.id === overloadAgentId)) {
        targetAgentIds.push(overloadAgentId);
      }
    }

    if (targetAgentIds.length === 0) {
      targetAgentIds = agents.slice(0, 2).map((agent) => agent.id);
    }

    if (targetAgentIds.length === 0) {
      addToast('未找到可执行决策的 Agent', 'error');
      return;
    }

    setIsApproving(true);
    try {
      const plan = Array.isArray(selectedDecision.plan) ? selectedDecision.plan.join('；') : '';
      const command = `系统决策已批准：${selectedDecision.title}。请按计划执行：${plan || '请立即处理并回传结果。'}`;
      await sendBatchAgentMessage(targetAgentIds, command);
      addToast('计划已批准并下发执行', 'success');
      handleClose();
    } catch (error) {
      addToast(`执行下发失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsApproving(false);
    }
  };

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={handleClose} 
      title={
        viewMode === 'details' ? `Agent 判定: ${selectedDecision?.title}` : 
        viewMode === 'plan' ? `执行计划: ${selectedDecision?.title}` : 
        "关键决策中心"
      }
    >
      {viewMode === 'details' && selectedDecision ? (
        <div className="space-y-6">
          <div className="p-5 bg-primary/5 border border-primary/20 rounded-2xl">
            <h4 className="text-xs font-bold text-primary uppercase tracking-widest mb-3">Agent 核心判定</h4>
            <p className="text-sm text-slate-200 leading-relaxed italic">“{selectedDecision.judgment}”</p>
          </div>
          
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-white uppercase tracking-widest">相关事件流</h4>
            <div className="space-y-3">
              {selectedDecision.events.map((event: any, i: number) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-white/5 border border-border-subtle rounded-xl">
                  <div className="text-[10px] font-mono text-slate-500 pt-0.5">{event.time}</div>
                  <p className="text-xs text-slate-300">{event.content}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-4 pt-4">
            <button onClick={() => setViewMode('list')} className="flex-1 py-3 bg-white/5 border border-border-subtle rounded-xl text-sm font-bold hover:bg-white/10 transition-all">返回列表</button>
            <button onClick={() => setViewMode('plan')} className="flex-1 py-3 bg-primary text-surface rounded-xl text-sm font-bold hover:bg-primary/90 transition-all">查看执行计划</button>
          </div>
        </div>
      ) : viewMode === 'plan' && selectedDecision ? (
        <div className="space-y-6">
          <div className="p-4 bg-white/5 border border-border-subtle rounded-2xl">
            <p className="text-xs text-slate-400 leading-relaxed">{selectedDecision.desc}</p>
          </div>
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-white uppercase tracking-widest">详细执行步骤</h4>
            <div className="space-y-3">
              {selectedDecision.plan.map((step: string, i: number) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-white/5 border border-border-subtle rounded-xl">
                  <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">{i+1}</div>
                  <p className="text-xs text-slate-300">{step}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-4 pt-4">
            <button onClick={() => setViewMode('details')} className="flex-1 py-3 bg-white/5 border border-border-subtle rounded-xl text-sm font-bold hover:bg-white/10 transition-all">查看判定详情</button>
            <button
              onClick={() => void handleApprovePlan()}
              disabled={isApproving}
              className="flex-1 py-3 bg-primary text-surface rounded-xl text-sm font-bold hover:bg-primary/90 transition-all disabled:opacity-60"
            >
              {isApproving ? '下发中...' : '批准并执行'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {decisions.length === 0 && (
            <div className="p-5 bg-white/5 border border-border-subtle rounded-2xl">
              <p className="text-xs text-slate-400">暂无待处理决策</p>
            </div>
          )}
          {decisions.map((d) => (
            <div key={d.id} className="p-5 bg-white/5 border border-border-subtle rounded-2xl space-y-4 hover:border-white/20 transition-all">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-2 h-2 rounded-full",
                    d.type === 'danger' ? "bg-danger" : d.type === 'warning' ? "bg-warning" : "bg-primary"
                  )} />
                  <h4 className="font-bold text-white">{d.title}</h4>
                </div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">10 分钟前</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">{d.desc}</p>
              <div className="flex justify-between items-center pt-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">影响: {d.impact}</span>
                <div className="flex gap-2">
                  <button 
                    onClick={() => { setSelectedDecision(d); setViewMode('details'); }} 
                    className="px-3 py-1.5 bg-white/5 border border-border-subtle rounded-lg text-[10px] font-bold text-slate-400 hover:bg-white/10 hover:text-white transition-all"
                  >
                    查看详情
                  </button>
                  <button 
                    onClick={() => { setSelectedDecision(d); setViewMode('plan'); }} 
                    className="px-3 py-1.5 bg-primary/10 border border-primary/20 text-primary rounded-lg text-[10px] font-bold hover:bg-primary/20 transition-all"
                  >
                    查看计划
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
};

const Dashboard = ({ onNavigate, onSelectProject, onSelectAgent, addToast, onOpenNewProject, onOpenDecisionCenter }: any) => {
  const averageAgentLoad = agents.length > 0
    ? Math.round(agents.reduce((sum, agent) => sum + (agent.load || 0), 0) / agents.length)
    : 0;
  const highLoadAgents = agents.filter((agent) => (agent.load || 0) > 80);
  const blockedTasks = tasks.filter((task) => task.status === 'Blocked');
  const atRiskProjects = projects.filter(
    (project) => (project.status as string) === 'At Risk' || project.phase === '风险阶段',
  );
  const pendingDecisions = [
    ...blockedTasks,
    ...atRiskProjects,
    ...highLoadAgents,
  ].length;

  const systemAlerts: Array<{
    type: 'warning' | 'danger';
    agent: string;
    project: string;
    title: string;
    message: string;
  }> = [];

  highLoadAgents.forEach((agent) => {
    systemAlerts.push({
      type: 'warning',
      agent: agent.name,
      project: projects.find((project) => project.agents.includes(agent.id))?.name || '未关联项目',
      title: 'Agent负载过高',
      message: '建议分流任务到空闲Agent',
    });
  });

  blockedTasks.forEach((task) => {
    systemAlerts.push({
      type: 'danger',
      agent: task.agent,
      project: atRiskProjects[0]?.name || projects[0]?.name || '当前项目',
      title: '任务已阻塞',
      message: task.title,
    });
  });

  const stats = [
    {
      label: '活跃项目',
      value: projects.length.toString(),
      icon: Briefcase,
      color: 'text-accent',
      trend: projects.length > 0 ? `${projects.length} 个进行中` : undefined,
      tab: 'projects',
    },
    {
      label: 'Agent 负载',
      value: agents.length > 0
        ? `${Math.round(agents.reduce((sum, agent) => sum + (agent.load || 0), 0) / agents.length)}%`
        : '0%',
      icon: Cpu,
      color: 'text-primary',
      trend: averageAgentLoad > 80 ? '高负载' : averageAgentLoad > 40 ? '稳定' : '空闲',
      tab: 'agents',
    },
    {
      label: '待处理决策',
      value: pendingDecisions.toString(),
      icon: Zap,
      color: 'text-warning',
      trend: pendingDecisions > 0 ? '需要关注' : '运行正常',
      tab: 'dashboard',
    },
    {
      label: '每日成本',
      value: `$${models.reduce((acc, model) => acc + model.dailyTokens * 0.00001, 0).toFixed(2)}`,
      icon: Activity,
      color: 'text-danger',
      tab: 'model-nexus',
    },
  ];
  const totalTokenUsed = agents.reduce((sum, agent) => sum + (agent.tokensUsed || 0), 0);
  const totalTokenLimit = Math.max(agents.reduce((sum, agent) => sum + (agent.tokenLimit || 0), 0), 1);
  const systemHealth = [
    { label: 'API 网关', status: '健康', icon: Globe },
    { label: '数据库', status: projects.length > 0 ? '健康' : '离线', icon: Database },
    { label: 'Agent 集群', status: agents.length > 0 ? '健康' : '离线', icon: Workflow },
  ];
  const allHealthy = systemHealth.every((item) => item.status === '健康');

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">控制面板</h1>
          <p className="text-slate-400 mt-1">欢迎回来，指挥官。Aegis OS 已全面运行。</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => onNavigate('audit')}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-border-subtle rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <History size={16} />
            审计日志
          </button>
          <button 
            onClick={() => onOpenNewProject()}
            className="px-4 py-2 bg-primary text-surface hover:bg-primary/90 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 shadow-lg shadow-primary/20 active:scale-95"
          >
            <Plus size={16} />
            新建项目
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, i) => (
          <div 
            key={i} 
            onClick={() => onNavigate(stat.tab)}
            className="bg-surface-soft border border-border-subtle p-6 rounded-2xl space-y-4 hover:border-white/20 transition-colors cursor-pointer group"
          >
            <div className="flex justify-between items-start">
              <div className={cn("p-2 rounded-lg bg-white/5 group-hover:scale-110 transition-transform", stat.color)}>
                <stat.icon size={20} />
              </div>
              {stat.trend && <span className="text-[10px] text-slate-500 font-medium">{stat.trend}</span>}
            </div>
            <div>
              <p className="text-sm text-slate-400 font-medium">{stat.label}</p>
              <h3 className="text-2xl font-bold text-white mt-1">{stat.value}</h3>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-surface-soft border border-border-subtle rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border-subtle flex justify-between items-center bg-white/5">
              <h2 className="font-semibold text-white flex items-center gap-2">
                <Zap size={18} className="text-warning" />
                关键决策
              </h2>
              <button className="text-xs text-primary hover:underline" onClick={() => onOpenDecisionCenter()}>查看全部</button>
            </div>
            <div className="p-6 space-y-4">
              {systemAlerts.length === 0 && (
                <div className="p-5 bg-primary/5 border border-primary/20 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-white text-sm">系统运行正常</h4>
                    <Badge variant="primary">健康</Badge>
                  </div>
                  <p className="text-xs text-slate-400">当前未检测到高负载 Agent 或阻塞任务。</p>
                </div>
              )}

              {systemAlerts.slice(0, 6).map((alert, index) => (
                <div
                  key={`${alert.agent}-${alert.title}-${index}`}
                  className={cn(
                    "p-4 rounded-xl space-y-3",
                    alert.type === 'danger'
                      ? "bg-danger/5 border border-danger/20"
                      : "bg-warning/5 border border-warning/20",
                  )}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-semibold text-white text-sm">{alert.agent}: {alert.title}</h4>
                      <p className="text-xs text-slate-400 mt-1">项目: {alert.project}</p>
                    </div>
                    <Badge variant={alert.type === 'danger' ? 'danger' : 'warning'}>
                      {alert.type === 'danger' ? '阻塞' : '预警'}
                    </Badge>
                  </div>
                  <p className="text-sm text-slate-300">{alert.message}</p>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => onOpenDecisionCenter()}
                      className={cn(
                        "px-3 py-1.5 text-xs font-bold rounded-lg transition-colors",
                        alert.type === 'danger'
                          ? "bg-danger text-white hover:bg-danger/90"
                          : "bg-warning text-surface hover:bg-warning/90",
                      )}
                    >
                      查看详情
                    </button>
                    <button
                      onClick={() => onNavigate('agents')}
                      className="px-3 py-1.5 bg-white/5 border border-border-subtle text-xs font-bold rounded-lg hover:bg-white/10 transition-colors"
                    >
                      查看 Agent
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-surface-soft border border-border-subtle rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border-subtle flex justify-between items-center bg-white/5">
              <h2 className="font-semibold text-white flex items-center gap-2">
                <Activity size={18} className="text-primary" />
                Token 使用情况分析
              </h2>
              <button className="text-xs text-primary hover:underline" onClick={() => onNavigate('agents')}>查看详情</button>
            </div>
            <div className="p-6">
              <div className="flex justify-between items-end mb-4">
                <div>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">24小时消耗趋势</p>
                  <h3 className="text-xl font-bold text-white mt-1">
                    {(totalTokenUsed / 1000).toFixed(1)}k <span className="text-xs text-slate-500 font-normal">/ {(totalTokenLimit / 1000).toFixed(0)}k</span>
                  </h3>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">当前负载</p>
                  <p className="text-xs text-primary font-bold">{averageAgentLoad}%</p>
                </div>
              </div>
              <TokenUsageTrendChart limit={totalTokenLimit} />
            </div>
          </div>

          <div className="bg-surface-soft border border-border-subtle rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border-subtle flex justify-between items-center bg-white/5">
              <h2 className="font-semibold text-white">活跃项目</h2>
              <button className="text-xs text-primary hover:underline" onClick={() => onNavigate('projects')}>管理组合</button>
            </div>
            <div className="divide-y divide-border-subtle">
              {projects.map((project) => (
                <div key={project.id} className="p-6 flex items-center justify-between hover:bg-white/5 transition-colors cursor-pointer group" onClick={() => onNavigate('project-room', project.id)}>
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-slate-400 group-hover:text-primary transition-colors">
                      <Briefcase size={20} />
                    </div>
                    <div>
                      <h4 className="font-semibold text-white text-sm">{project.name}</h4>
                      <p className="text-xs text-slate-500 mt-1">{project.phase} • {project.agents.length} 个 Agent</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right hidden sm:block">
                      <p className="text-xs text-slate-400 font-medium">进度</p>
                      <p className="text-sm text-white font-bold">{project.progress}%</p>
                    </div>
                    <div className="w-24 h-1.5 bg-white/5 rounded-full overflow-hidden hidden sm:block">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${project.progress}%` }} />
                    </div>
                    <ChevronRight size={16} className="text-slate-600 group-hover:text-white transition-colors" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        
        <div className="space-y-6">
          <div className="bg-surface-soft border border-border-subtle rounded-2xl p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="font-semibold text-white">团队动态</h2>
              <button className="p-1 text-slate-500 hover:text-white"><MoreVertical size={16} /></button>
            </div>
            <div className="space-y-6">
              {agents.slice(0, 5).map((agent) => (
                <div key={agent.id} className="space-y-2 cursor-pointer group" onClick={() => onNavigate('agents', agent.id)}>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "w-2 h-2 rounded-full",
                        agent.status === 'Thinking' ? 'bg-accent animate-pulse' : 
                        agent.status === 'Executing' ? 'bg-primary' : 'bg-slate-600'
                      )} />
                      <span className="text-xs text-slate-300 font-medium group-hover:text-primary transition-colors">{agent.name}</span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">{agent.status === 'Thinking' ? '思考中' : agent.status === 'Executing' ? '执行中' : '空闲'}</span>
                  </div>
                  <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${agent.load}%` }}
                      className={cn(
                        "h-full rounded-full",
                        agent.load > 80 ? "bg-danger" : agent.load > 40 ? "bg-accent" : "bg-primary"
                      )}
                    />
                  </div>
                </div>
              ))}
            </div>
            <button className="w-full mt-6 py-2 bg-white/5 border border-border-subtle rounded-lg text-xs font-bold text-slate-400 hover:text-white transition-colors" onClick={() => onNavigate('agents')}>
              查看所有 Agent
            </button>
          </div>

          <div className="bg-surface-soft border border-border-subtle rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-6">模型资源分布</h2>
            <ModelUsageChart />
          </div>

          <div className="bg-surface-soft border border-border-subtle rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-white">系统健康状况</h2>
              <Badge variant={allHealthy ? 'primary' : 'warning'}>
                {allHealthy ? '正常' : '异常'}
              </Badge>
            </div>
            <div className="space-y-4">
              {systemHealth.map((item, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <item.icon size={14} className="text-slate-500" />
                    <span className="text-xs text-slate-400">{item.label}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      item.status === '健康' ? 'bg-primary' : 'bg-warning',
                    )} />
                    <span className={cn(
                      "text-[10px] font-bold uppercase",
                      item.status === '健康' ? 'text-primary' : 'text-warning',
                    )}>{item.status}</span>
                  </div>
                </div>
              ))}
            </div>
            <button className="w-full mt-6 py-2 bg-white/5 border border-border-subtle rounded-lg text-xs font-bold text-slate-400 hover:text-white transition-colors" onClick={() => onNavigate('system-health')}>
              系统诊断
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ProjectRoom = ({
  projectId,
  addToast,
  onNavigate,
  onRefreshData,
}: {
  projectId: string | null;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onNavigate?: (tab: string, id?: string) => void;
  onRefreshData?: () => Promise<void>;
}) => {
  const [isIntervening, setIsIntervening] = useState(false);
  const project = useMemo(() => 
    projects.find(p => p.id === projectId) || projects[0] || {
      id: '',
      name: '暂无项目',
      description: '',
      status: 'Planning' as ProjectStatus,
      phase: '待开始',
      progress: 0,
      owner: '',
      agents: [],
    }, 
  [projectId, projects]);
  const projectTasks = useMemo(
    () =>
      tasks.filter((task) => {
        const taskProjectId = (task as Task & { projectId?: string }).projectId;
        if (project.id && taskProjectId) {
          return taskProjectId === project.id;
        }
        return Boolean(project.id) && String(task.id).startsWith(`${project.id}:`);
      }),
    [project.id, tasks],
  );
  const projectAgents = useMemo(() => {
    if (project.agents.length > 0) {
      return agents.filter((agent) => project.agents.includes(agent.id));
    }

    const linkedAgentNames = new Set(projectTasks.map((task) => task.agent));
    return agents.filter((agent) => linkedAgentNames.has(agent.id) || linkedAgentNames.has(agent.name));
  }, [project.agents, projectTasks, agents]);
  const formatProjectLogTime = (date: string | Date | null | undefined) => {
    if (!date) {
      return new Date().toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    }
    const normalized = new Date(date);
    if (Number.isNaN(normalized.getTime())) {
      return new Date().toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    }
    return normalized.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };
  const getTaskTimestamp = (task: Task) => {
    const taskRecord = task as Task & { updatedAt?: string; createdAt?: string };
    const rawDate = taskRecord.updatedAt || taskRecord.createdAt || new Date().toISOString();
    const date = new Date(rawDate);
    return Number.isNaN(date.getTime()) ? Date.now() : date.getTime();
  };
  const recentLogs = useMemo(() => {
    const logs: Array<{
      time: string;
      actor: string;
      message: string;
      type: 'danger' | 'accent' | 'primary';
      timestamp: number;
    }> = [];

    projectTasks
      .filter((task) => task.status === 'Blocked')
      .slice(0, 2)
      .forEach((task) => {
        const agent = agents.find((candidate) => candidate.name === task.agent);
        const timestamp = getTaskTimestamp(task);
        logs.push({
          time: formatProjectLogTime(new Date(timestamp)),
          actor: agent?.name || task.agent || '系统',
          message: `任务"${task.title}"被阻塞`,
          type: 'danger',
          timestamp,
        });
      });

    projectTasks
      .filter((task) => task.status === 'In Progress')
      .slice(0, 3)
      .forEach((task) => {
        const agent = agents.find((candidate) => candidate.name === task.agent);
        const timestamp = getTaskTimestamp(task);
        logs.push({
          time: formatProjectLogTime(new Date(timestamp)),
          actor: agent?.name || task.agent || '系统',
          message: `正在执行: ${task.title}`,
          type: 'accent',
          timestamp,
        });
      });

    return logs.sort((a, b) => b.timestamp - a.timestamp).slice(0, 6);
  }, [projectTasks, agents]);
  const projectBlockedCount = projectTasks.filter((task) => task.status === 'Blocked').length;
  const projectDeliverables = useMemo(() => {
    const mapped = projectTasks.slice(0, 6).map((task) => {
      const type =
        task.status === 'Completed'
          ? '交付文档'
          : task.status === 'Blocked'
            ? '阻塞项'
            : '进行项';
      const size = `${Math.max(1, Math.round((task.title.length + (task.progress || 0)) / 6))}kb`;
      return {
        name: `${task.title}${task.status === 'Completed' ? '.md' : ''}`,
        type,
        size,
      };
    });
    return mapped.length > 0
      ? mapped
      : [{ name: '暂无交付物', type: '等待任务推进', size: '-' }];
  }, [projectTasks]);

  const handleOpenTimeline = async () => {
    if (!project.id) {
      addToast('当前没有可查看的项目时间线', 'error');
      return;
    }
    try {
      const logs = await auditApi.listSystem(80);
      const relatedCount = logs.filter((log) =>
        log.resourceId === project.id
        || log.summary.includes(project.name)
        || (log.detail || '').includes(project.name),
      ).length;
      addToast(`已同步项目时间线，关联记录 ${relatedCount} 条`, 'success');
    } catch {
      addToast('时间线同步失败，已跳转审计页查看最新记录', 'info');
    } finally {
      onNavigate?.('audit');
    }
  };

  const handleIntervene = async () => {
    if (!project.id) {
      addToast('当前没有可干预的项目', 'error');
      return;
    }
    setIsIntervening(true);
    try {
      const command = projectBlockedCount > 0
        ? `紧急干预：项目 ${project.name} 当前有 ${projectBlockedCount} 个阻塞任务，请优先解除阻塞并同步最新 ETA。`
        : `紧急干预：项目 ${project.name} 请立即执行风险排查并提交状态报告。`;
      await projectsApi.intervene(project.id, command);
      if (onRefreshData) {
        await onRefreshData();
      }
      addToast('紧急干预已触发，系统正在同步项目状态', 'success');
    } catch (error) {
      addToast(`紧急干预失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsIntervening(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <header className="px-8 py-6 border-b border-border-subtle flex justify-between items-center bg-surface/50 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary border border-primary/20">
            <Briefcase size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">{project.name}</h1>
            <div className="flex items-center gap-3 mt-1">
              <Badge variant="primary">阶段: {project.phase}</Badge>
              <span className="flex items-center gap-1.5 text-[10px] text-warning font-bold">
                <Zap size={10} />
                风险: {projectBlockedCount > 0 ? `${projectBlockedCount} 个任务阻塞` : '无阻塞风险'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => void handleOpenTimeline()}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-border-subtle rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <History size={16} />
            时间线
          </button>
          <button 
            onClick={() => void handleIntervene()}
            disabled={isIntervening}
            className="px-4 py-2 bg-danger text-white hover:bg-danger/90 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 disabled:opacity-60"
          >
            <ShieldCheck size={16} />
            {isIntervening ? '干预中...' : '紧急干预'}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden flex">
        <main className="flex-1 overflow-y-auto p-8 space-y-8">
          <div className="flex items-center gap-4 p-1 bg-white/5 rounded-xl border border-border-subtle w-fit">
            {['任务', '阶段', '交付物', '时间线'].map((tab, i) => (
              <button key={i} className={cn(
                "px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
                i === 0 ? "bg-surface-muted text-white shadow-sm" : "text-slate-500 hover:text-slate-300"
              )}>
                {tab}
              </button>
            ))}
          </div>

          <section className="space-y-4">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <Layers size={14} />
              活跃任务
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {projectTasks.map((task, i) => (
                <div key={i} className="bg-surface-soft border border-border-subtle p-5 rounded-2xl space-y-4 hover:border-white/20 transition-all group">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-semibold text-white text-sm group-hover:text-primary transition-colors">{task.title}</h4>
                      <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                        <BrainCircuit size={10} />
                        指派给: {task.agent}
                      </p>
                    </div>
                    <Badge variant={
                      task.status === 'Completed' ? 'primary' :
                      task.status === 'In Progress' ? 'accent' :
                      task.status === 'Blocked' ? 'danger' : 'default'
                    }>{task.status === 'Completed' ? '已完成' : task.status === 'In Progress' ? '进行中' : task.status === 'Blocked' ? '已阻塞' : '待处理'}</Badge>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-[10px] text-slate-500">
                      <span>进度</span>
                      <span>{task.progress}%</span>
                    </div>
                    <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${task.progress}%` }}
                        className={cn(
                          "h-full rounded-full transition-all duration-500",
                          task.status === 'Blocked' ? 'bg-danger' : 'bg-primary'
                        )} 
                      />
                    </div>
                  </div>
                </div>
              ))}
              {projectTasks.length === 0 && (
                <div className="col-span-full bg-surface-soft border border-border-subtle p-6 rounded-2xl text-center text-sm text-slate-500">
                  当前项目暂无任务数据
                </div>
              )}
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <Terminal size={14} />
                实时输出流
              </h3>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="text-[10px] text-primary font-bold uppercase">直播</span>
              </div>
            </div>
            <div className="bg-surface-muted border border-border-subtle rounded-2xl p-6 font-mono text-xs space-y-2 max-h-96 overflow-y-auto scrollbar-hide">
              {recentLogs.map((log, i) => (
                <p key={i} className="text-slate-500">
                  <span className="text-slate-600">[{log.time}]</span>{' '}
                  <span className={log.type === 'danger' ? 'text-danger' : log.type === 'accent' ? 'text-accent' : 'text-primary'}>
                    {log.actor}:
                  </span>{' '}
                  {log.message}
                </p>
              ))}
              {recentLogs.length === 0 && (
                <p className="text-slate-600">暂无实时日志</p>
              )}
              <div className="w-1 h-4 bg-primary animate-pulse inline-block align-middle ml-1" />
            </div>
          </section>
        </main>

        <aside className="w-80 border-l border-border-subtle p-6 space-y-8 hidden lg:block bg-surface-soft/30">
          <section className="space-y-4">
            <h3 className="text-[10px] uppercase tracking-widest font-bold text-slate-500 flex items-center gap-2">
              <FileText size={12} />
              交付物
            </h3>
            <div className="space-y-2">
              {projectDeliverables.map((file, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-border-subtle hover:bg-white/10 transition-colors cursor-pointer group">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-slate-500 group-hover:text-primary transition-colors">
                      <FileText size={14} />
                    </div>
                    <div>
                      <span className="text-xs text-slate-300 font-medium block">{file.name}</span>
                      <span className="text-[10px] text-slate-500">{file.type} • {file.size}</span>
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-slate-600 group-hover:text-white transition-colors" />
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-[10px] uppercase tracking-widest font-bold text-slate-500 flex items-center gap-2">
              <Users size={12} />
              项目 Agent
            </h3>
            <div className="space-y-3">
              {projectAgents.slice(0, 4).map((agent, i) => (
                <div key={i} className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors cursor-pointer">
                  <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent text-[10px] font-bold border border-accent/20">
                    {agent.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white font-medium truncate">{agent.name}</p>
                    <p className="text-[10px] text-slate-500 truncate">{agent.role}</p>
                  </div>
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                </div>
              ))}
              {projectAgents.length === 0 && (
                <p className="text-[11px] text-slate-500 text-center py-2">暂无项目成员数据</p>
              )}
              <button className="w-full py-2 bg-white/5 border border-dashed border-border-subtle rounded-xl text-[10px] font-bold text-slate-500 hover:text-white hover:border-white/20 transition-all flex items-center justify-center gap-2">
                <Plus size={12} />
                指派 Agent
              </button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
};

const TokenUsageTrendChart = ({ limit }: { limit: number }) => {
  const data = useMemo(() => {
    const now = Date.now();
    const buckets = Array.from({ length: 24 }, (_, index) => {
      const hour = (new Date().getHours() - (23 - index) + 24) % 24;
      return {
        time: `${hour}:00`,
        usage: 0,
      };
    });

    sessions.forEach((session) => {
      const startedAt = new Date(session.startTime).getTime();
      if (!Number.isFinite(startedAt)) {
        return;
      }
      const diffHours = Math.floor((now - startedAt) / 3600000);
      if (diffHours < 0 || diffHours > 23) {
        return;
      }
      const bucketIndex = 23 - diffHours;
      buckets[bucketIndex].usage += session.tokens || 0;
    });

    if (buckets.every((bucket) => bucket.usage === 0)) {
      const base = Math.floor(
        Math.max(
          agents.reduce((sum, agent) => sum + (agent.tokensUsed || 0), 0),
          1,
        ) / 24,
      );
      return buckets.map((bucket, index) => ({
        ...bucket,
        usage: Math.min(limit, Math.max(0, Math.floor(base * (index >= 8 && index <= 17 ? 1.4 : 0.7)))),
      }));
    }

    return buckets.map((bucket) => ({
      ...bucket,
      usage: Math.min(limit, bucket.usage),
    }));
  }, [limit, sessions, agents]);

  return (
    <div className="h-[100px] w-full mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorUsage" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#00f2ff" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#00f2ff" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#2d2e32" vertical={false} opacity={0.5} />
          <XAxis 
            dataKey="time" 
            hide 
          />
          <YAxis hide domain={[0, limit / 12]} />
          <Tooltip 
            contentStyle={{ backgroundColor: '#1a1b1e', border: '1px solid #2d2e32', borderRadius: '8px', fontSize: '10px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
            itemStyle={{ color: '#fff', padding: '2px 0' }}
            labelStyle={{ color: '#64748b', marginBottom: '4px', fontWeight: 'bold' }}
            cursor={{ stroke: '#00f2ff', strokeWidth: 1 }}
          />
          <ReferenceLine 
            y={limit / 24} 
            stroke="#ff00f2" 
            strokeDasharray="3 3" 
            label={{ position: 'right', value: 'LIMIT', fill: '#ff00f2', fontSize: 7, fontWeight: 'bold' }} 
          />
          <Area 
            type="monotone" 
            dataKey="usage" 
            stroke="#00f2ff" 
            strokeWidth={2}
            fillOpacity={0.4} 
            fill="url(#colorUsage)" 
            animationDuration={1500}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

const TokenThroughputChart = () => {
  const data = useMemo(() => {
    const source = sessions
      .slice()
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .slice(-20);

    if (source.length === 0) {
      return Array.from({ length: 20 }, (_, i) => ({
        time: i,
        input: 0,
        output: 0,
      }));
    }

    return source.map((session, index) => {
      const total = Math.max(session.tokens || 0, 0);
      return {
        time: index,
        input: Math.floor(total * 0.45),
        output: Math.floor(total * 0.55),
      };
    });
  }, [sessions]);

  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorInput" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
            </linearGradient>
            <linearGradient id="colorOutput" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f27d26" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#f27d26" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#2d2e32" vertical={false} opacity={0.3} />
          <XAxis dataKey="time" hide />
          <YAxis hide />
          <Tooltip 
            contentStyle={{ backgroundColor: '#1a1b1e', border: '1px solid #2d2e32', borderRadius: '8px', fontSize: '10px' }}
            itemStyle={{ padding: '2px 0' }}
          />
          <Area type="monotone" dataKey="input" stroke="#10b981" fillOpacity={1} fill="url(#colorInput)" strokeWidth={2} />
          <Area type="monotone" dataKey="output" stroke="#f27d26" fillOpacity={1} fill="url(#colorOutput)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

type CommandUnderstandingCard = {
  raw: string;
  summary: string;
  goal: string;
  project: string;
  involvedAgent: string;
  eta: string;
  warning?: string;
};

function parseSopSteps(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => Boolean(line))
    .map((line) => line.replace(/^[-*]\s*/, '').replace(/^\d+[\.)]\s*/, '').trim())
    .filter((line) => line.length > 0)
    .slice(0, 8);
}

const AgentCommander = ({
  agentId,
  addToast,
  sendCommand,
}: {
  agentId: string | null;
  addToast: (msg: string, type?: any) => void;
  sendCommand?: (agentId: string, message: string) => Promise<unknown>;
}) => {
  const [mode, setMode] = useState('confirm'); // 'confirm' | 'auto'
  const fallbackAgent: Agent = {
    id: '',
    name: '未选择 Agent',
    role: '待分配',
    status: 'Idle',
    load: 0,
    currentModelId: models[0]?.id || 'runtime',
    tasks: 0,
    memoryCount: 0,
    tokensUsed: 0,
    tokenLimit: 100000,
    sessionCount: 0,
  };
  const activeAgent = agents.find((agent) => agent.id === agentId) || agents[0] || fallbackAgent;

  const [tokenLimit, setTokenLimit] = useState(activeAgent.tokenLimit || 100000);
  const [dailyUsage, setDailyUsage] = useState(12450);
  const [currentModelId, setCurrentModelId] = useState(activeAgent.currentModelId || models[0]?.id || '');
  const [commandInput, setCommandInput] = useState('');
  const [isUnderstanding, setIsUnderstanding] = useState(false);
  const [confirmCard, setConfirmCard] = useState<CommandUnderstandingCard | null>(null);
  const [isSendingCommand, setIsSendingCommand] = useState(false);
  const [agentSoul, setAgentSoul] = useState('');
  const [agentSopSteps, setAgentSopSteps] = useState<string[]>([]);
  const [agentMemoryTags, setAgentMemoryTags] = useState<string[]>([]);
  const [isLoadingAgentProfile, setIsLoadingAgentProfile] = useState(false);
  const agentSessions = sessions.filter((session) => session.agentId === activeAgent.id);

  useEffect(() => {
    setTokenLimit(activeAgent.tokenLimit || 100000);
    setDailyUsage(activeAgent.tokensUsed || 0);
    setCurrentModelId(activeAgent.currentModelId || models[0]?.id || '');
  }, [activeAgent.id]);

  useEffect(() => {
    let active = true;

    const loadAgentProfile = async () => {
      if (!activeAgent.id) {
        setAgentSoul('');
        setAgentSopSteps([]);
        setAgentMemoryTags([]);
        return;
      }

      setIsLoadingAgentProfile(true);
      try {
        const detail = await fetchOpenClawAgentDetail(activeAgent.id);
        if (!active) {
          return;
        }

        const soulContent = detail.soul?.content?.trim() || '';
        const sopContent = detail.sop?.content?.trim() || '';
        const memoryTags = (detail.memoryEntries || [])
          .slice(0, 8)
          .map((entry) => entry.summary?.trim())
          .filter((item): item is string => Boolean(item));

        setAgentSoul(soulContent);
        setAgentSopSteps(parseSopSteps(sopContent));
        setAgentMemoryTags(memoryTags);
      } catch {
        if (!active) {
          return;
        }
        setAgentSoul('');
        setAgentSopSteps([]);
        setAgentMemoryTags([]);
      } finally {
        if (active) {
          setIsLoadingAgentProfile(false);
        }
      }
    };

    void loadAgentProfile();

    return () => {
      active = false;
    };
  }, [activeAgent.id]);

  const buildCommandUnderstanding = (input: string): CommandUnderstandingCard => {
    const normalized = input.trim();
    const linkedProject = projects.find((project) => normalized.includes(project.name));
    const commandAgent = agents.find((agent) => normalized.includes(agent.name)) || activeAgent;
    const concise = normalized.length > 40 ? `${normalized.slice(0, 40)}...` : normalized;
    const warning = normalized.length < 8
      ? '指令较短，建议补充项目名称或交付目标。'
      : !linkedProject
        ? '未识别到项目名称，将按当前上下文执行。'
        : undefined;

    let eta = '2小时内';
    if (/(今天|立即|尽快|asap|urgent)/i.test(normalized)) {
      eta = '30分钟内';
    } else if (/(本周|迭代|阶段)/i.test(normalized)) {
      eta = '1个迭代内';
    }

    return {
      raw: normalized,
      summary: linkedProject
        ? `为“${linkedProject.name}”执行“${concise}”`
        : `执行指令“${concise}”`,
      goal: normalized,
      project: linkedProject?.name || '当前工作上下文',
      involvedAgent: commandAgent?.name || '待分配 Agent',
      eta,
      warning,
    };
  };

  const handleModelChange = (modelId: string) => {
    setCurrentModelId(modelId);
    const model = models.find(m => m.id === modelId);
    addToast(`已将 ${activeAgent.name} 切换至模型: ${model?.name}`, 'success');
  };

  const handleConfirmAction = () => {
    addToast(`已确认 ${activeAgent.name} 的下一步行动`, 'success');
  };

  const handleTokenLimitChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Math.max(parseInt(e.target.value) || 0, 1);
    setTokenLimit(val);
    addToast(`Token 限制已更新为 ${val.toLocaleString()}`, "success");
  };

  const handleTrySend = () => {
    if (!activeAgent.id) {
      addToast('请先选择一个 Agent 再发送指令', 'error');
      return;
    }
    if (!commandInput.trim()) {
      addToast('请输入指令内容', 'error');
      return;
    }
    setIsUnderstanding(true);
    setConfirmCard(buildCommandUnderstanding(commandInput));
    setIsUnderstanding(false);
  };

  const handleConfirmExecute = async () => {
    if (!confirmCard || !activeAgent.id) {
      addToast('未找到可执行的指令', 'error');
      return;
    }

    setIsSendingCommand(true);
    try {
      if (sendCommand) {
        await sendCommand(activeAgent.id, confirmCard.raw);
      }
      addToast(`已向 ${activeAgent.name} 发送任务`, 'success');
      setConfirmCard(null);
      setCommandInput('');
    } catch (error: any) {
      addToast(`发送失败: ${error?.message || '未知错误'}`, 'error');
    } finally {
      setIsSendingCommand(false);
    }
  };
  const toTimestamp = (value?: string) => {
    if (!value) {
      return Date.now();
    }
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : Date.now();
  };
  const linkedTasks = useMemo(
    () =>
      tasks.filter((task) => {
        const taskAgent = String(task.agent || '').trim();
        return taskAgent === activeAgent.id || taskAgent === activeAgent.name;
      }),
    [tasks, activeAgent.id, activeAgent.name],
  );
  const blockedLinkedTasks = linkedTasks.filter((task) => task.status === 'Blocked').slice(0, 3);
  const inProgressLinkedTasks = linkedTasks.filter((task) => task.status === 'In Progress').slice(0, 4);
  const commanderEvents = useMemo(() => {
    const events: Array<{
      type: 'system' | 'assistant';
      title: string;
      content: string;
      timestamp: number;
    }> = [];
    if (agentSoul) {
      events.push({
        type: 'system',
        title: '上下文加载',
        content: 'SOUL 与 SOP 文档已同步完成，可执行最新指令。',
        timestamp: Date.now() - 90 * 1000,
      });
    }

    inProgressLinkedTasks.forEach((task) => {
      const taskRecord = task as Task & { updatedAt?: string; createdAt?: string };
      events.push({
        type: 'assistant',
        title: '执行中',
        content: `正在推进任务：${task.title}`,
        timestamp: toTimestamp(taskRecord.updatedAt || taskRecord.createdAt),
      });
    });

    blockedLinkedTasks.forEach((task) => {
      const taskRecord = task as Task & { updatedAt?: string; createdAt?: string };
      events.push({
        type: 'system',
        title: '阻塞告警',
        content: `任务“${task.title}”处于阻塞状态，等待处理。`,
        timestamp: toTimestamp(taskRecord.updatedAt || taskRecord.createdAt),
      });
    });

    return events
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 6);
  }, [agentSoul, inProgressLinkedTasks, blockedLinkedTasks]);
  const commanderPlan = (
    inProgressLinkedTasks.length > 0
      ? inProgressLinkedTasks.map((task) => `推进任务：${task.title}`)
      : linkedTasks.slice(0, 4).map((task) => `跟进任务：${task.title}`)
  ).slice(0, 4);
  const commanderRisks = blockedLinkedTasks.length > 0
    ? blockedLinkedTasks.map((task) => `任务阻塞：${task.title}`)
    : ['当前未发现阻塞风险'];

  return (
    <div className="h-full flex flex-col">
      <header className="px-8 py-6 border-b border-border-subtle flex justify-between items-center bg-surface/50 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-accent/20 flex items-center justify-center text-accent border border-accent/20 shadow-lg shadow-accent/10">
            <BrainCircuit size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-white">{activeAgent.name}</h1>
              <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] font-bold flex items-center gap-1 border border-primary/20">
                <div className="w-1 h-1 rounded-full bg-primary animate-pulse" />
                在线
              </span>
            </div>
            <div className="flex items-center gap-4 mt-1">
              <p className="text-xs text-slate-400">角色: {activeAgent.role}</p>
              <div className="flex items-center gap-2">
                <div className="w-24 h-1 bg-white/5 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary transition-all duration-500" 
                    style={{ width: `${(dailyUsage / tokenLimit) * 100}%` }}
                  />
                </div>
                <span className="text-[10px] text-slate-500 font-mono">
                  {dailyUsage.toLocaleString()} / {tokenLimit.toLocaleString()} Tokens
                </span>
              </div>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3 bg-white/5 p-1.5 rounded-xl border border-border-subtle shadow-inner">
            <div className="flex items-center gap-2 px-3 border-r border-border-subtle mr-1">
              <Lock size={12} className="text-slate-500" />
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">限额</span>
              <input 
                type="number" 
                value={tokenLimit}
                onChange={handleTokenLimitChange}
                step={5000}
                className="w-20 bg-transparent border-none text-[10px] font-mono font-bold text-white focus:outline-none focus:ring-0 p-0"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <button 
                onClick={() => setMode('confirm')}
                className={cn(
                  "px-4 py-2 rounded-lg text-[10px] font-bold transition-all uppercase tracking-wider",
                  mode === 'confirm' ? "bg-surface-muted text-white shadow-lg border border-white/10" : "text-slate-500 hover:text-slate-300"
                )}
              >
                先确认
              </button>
              <button 
                onClick={() => setMode('auto')}
                className={cn(
                  "px-4 py-2 rounded-lg text-[10px] font-bold transition-all uppercase tracking-wider",
                  mode === 'auto' ? "bg-primary text-surface shadow-lg shadow-primary/20" : "text-slate-500 hover:text-slate-300"
                )}
              >
                自主运行
              </button>
            </div>
          </div>
          
          <div className="h-8 w-px bg-border-subtle" />
          
          <div className="flex items-center gap-2 relative group/model">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">当前模型:</span>
            <button className="px-4 py-2 bg-white/5 border border-border-subtle rounded-xl text-[10px] font-bold text-white flex items-center gap-2 hover:bg-white/10 transition-all hover:border-white/20">
              {models.find(m => m.id === currentModelId)?.name}
              <ChevronDown size={12} className="text-slate-500" />
            </button>
            <div className="absolute top-full right-0 mt-2 w-48 bg-surface-muted border border-border-subtle rounded-xl shadow-2xl opacity-0 invisible group-hover/model:opacity-100 group-hover/model:visible transition-all z-50 p-2">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-2 py-1">选择计算资源</p>
              {models.map(m => (
                <button 
                  key={m.id} 
                  onClick={() => handleModelChange(m.id)}
                  className="w-full text-left px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors flex justify-between items-center"
                >
                  {m.name}
                  {m.id === currentModelId && <CheckCircle2 size={12} className="text-primary" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden flex">
        {/* Left Sidebar: Strategy & Identity */}
        <aside className="w-80 border-r border-border-subtle overflow-y-auto p-6 space-y-8 hidden md:block bg-surface-soft/30">
          <section className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-[10px] uppercase tracking-widest font-bold text-slate-500 flex items-center gap-2">
                <ShieldCheck size={12} />
                核心身份 (SOUL)
              </h3>
              <button className="text-[10px] text-primary hover:underline">编辑</button>
            </div>
            <div className="bg-surface-soft border border-border-subtle rounded-xl p-4 font-mono text-xs text-slate-300 leading-relaxed relative group">
              {isLoadingAgentProfile
                ? '正在加载 SOUL 文档...'
                : agentSoul || '当前 Agent 暂无 SOUL 文档。'}
              <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-[10px] uppercase tracking-widest font-bold text-slate-500 flex items-center gap-2">
                <Workflow size={12} />
                标准操作程序 (SOP)
              </h3>
              <button className="text-[10px] text-primary hover:underline">编辑</button>
            </div>
            <div className="space-y-2">
              {(agentSopSteps.length > 0 ? agentSopSteps : ['当前 Agent 暂无 SOP 步骤']).map((step, i) => (
                <div key={i} className="px-3 py-2 bg-white/5 border border-border-subtle rounded-lg text-[10px] text-slate-400">
                  {i + 1}. {step}
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-[10px] uppercase tracking-widest font-bold text-slate-500 flex items-center gap-2">
              <Database size={12} />
              近期记忆
            </h3>
            <div className="flex flex-wrap gap-2">
              {(agentMemoryTags.length > 0 ? agentMemoryTags : ['暂无长期记忆']).map((tag, i) => (
                <span key={i} className="px-2 py-1 rounded-md bg-white/5 border border-border-subtle text-[10px] text-slate-400 hover:text-white hover:border-white/20 transition-colors cursor-pointer">
                  {tag}
                </span>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-[10px] uppercase tracking-widest font-bold text-slate-500 flex items-center gap-2">
              <Activity size={12} />
              治理与配额
            </h3>
            <div className="space-y-4 bg-white/5 p-4 rounded-xl border border-border-subtle">
              <div className="space-y-3">
                <div className="flex justify-between text-[10px]">
                  <span className="text-slate-400">每日 Token 限制</span>
                  <span className="text-white font-bold">{(dailyUsage / 1000).toFixed(1)}k / {(tokenLimit / 1000).toFixed(0)}k</span>
                </div>
                <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-accent rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (dailyUsage / tokenLimit) * 100)}%` }} />
                </div>
                <div className="pt-2 border-t border-white/5">
                  <p className="text-[9px] text-slate-500 font-bold uppercase mb-2 tracking-widest">24小时消耗趋势</p>
                  <TokenUsageTrendChart limit={tokenLimit} />
                </div>
                <input 
                  type="range" 
                  min="10000" 
                  max="500000" 
                  step="10000"
                  value={tokenLimit}
                  onChange={(e) => setTokenLimit(parseInt(e.target.value))}
                  className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-primary"
                />
                <p className="text-[9px] text-slate-500 text-center italic">拖动滑块调整每日配额</p>
              </div>
              <div className="h-px bg-border-subtle" />
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-slate-400">预计成本 (今日)</span>
                <span className="text-xs text-white font-bold">${(activeAgent.tokensUsed * 0.00001).toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-slate-400">活跃会话</span>
                <span className="text-xs text-white font-bold">{activeAgent.sessionCount}</span>
              </div>
            </div>
          </section>
        </aside>

        {/* Main Content: Logs & Interaction */}
        <main className="flex-1 flex flex-col relative bg-surface-soft/10">
          <div className="flex-1 overflow-y-auto p-8 space-y-8 scrollbar-hide">
            {/* Session Activity Analysis (Nexus inspired) */}
            <section className="space-y-4">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <BarChart3 size={14} />
                会话活动分析
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {agentSessions.map((session) => (
                  <div key={session.id} className="bg-surface-muted border border-border-subtle p-4 rounded-xl space-y-3 hover:border-primary/30 transition-colors">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2">
                        <div className={cn("w-2 h-2 rounded-full", session.status === 'active' ? 'bg-primary animate-pulse' : 'bg-slate-600')} />
                        <span className="text-[10px] font-bold text-white uppercase tracking-wider">会话 {session.id}</span>
                      </div>
                      <Badge variant={session.status === 'active' ? 'primary' : 'default'}>
                        {session.status === 'active' ? '进行中' : '已完成'}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-[9px] text-slate-500 uppercase">时长</p>
                        <p className="text-xs text-slate-200">{session.duration}</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-slate-500 uppercase">消耗</p>
                        <p className="text-xs text-slate-200">{session.tokens} tokens</p>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-border-subtle flex justify-between items-center">
                      <span className="text-[9px] text-slate-500">{new Date(session.startTime).toLocaleTimeString()}</span>
                      <button className="text-[9px] text-primary hover:underline">查看详情</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <div className="h-px bg-border-subtle" />

            {commanderEvents.length === 0 && (
              <div className="p-4 border border-border-subtle rounded-2xl bg-white/5 text-xs text-slate-500">
                暂无近期执行事件，等待新任务指令。
              </div>
            )}
            {commanderEvents.map((event, index) => (
              <div key={`${event.title}-${index}`} className="flex gap-4">
                <div className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border",
                  event.type === 'assistant'
                    ? "bg-accent/20 text-accent border-accent/20"
                    : "bg-white/5 text-slate-500 border-border-subtle",
                )}>
                  {event.type === 'assistant' ? <BrainCircuit size={16} /> : <History size={16} />}
                </div>
                <div className="space-y-1">
                  <p className={cn(
                    "text-[10px] font-bold uppercase tracking-wider",
                    event.type === 'assistant' ? 'text-accent' : 'text-slate-500',
                  )}>
                    {new Date(event.timestamp).toLocaleTimeString('zh-CN')} - {event.title}
                  </p>
                  <p className="text-sm text-slate-400 italic">{event.content}</p>
                </div>
              </div>
            ))}

            <div className="bg-surface-muted border border-border-subtle p-6 rounded-2xl space-y-5 shadow-2xl relative overflow-hidden group max-w-3xl">
              <div className="absolute top-0 left-0 w-1 h-full bg-accent opacity-50" />
              <p className="text-sm leading-relaxed text-slate-200">
                我已同步 <span className="text-primary font-bold">{activeAgent.name}</span> 的最新任务上下文。
                当前执行焦点是 {inProgressLinkedTasks[0]?.title || linkedTasks[0]?.title || '等待新任务分配'}。
              </p>
              <div className="bg-warning/5 border border-warning/20 rounded-2xl p-5 space-y-4 relative">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-warning">
                    <Zap size={14} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">执行建议确认</span>
                  </div>
                  <Badge variant={blockedLinkedTasks.length > 0 ? 'warning' : 'primary'}>
                    {blockedLinkedTasks.length > 0 ? '需要行动' : '可继续推进'}
                  </Badge>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <div>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">提议目标</p>
                      <p className="text-xs text-white mt-1 font-medium">
                        优先推进 {inProgressLinkedTasks[0]?.title || '当前主任务'}，并同步执行状态。
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">执行计划</p>
                      <ul className="mt-2 space-y-2">
                        {(commanderPlan.length > 0 ? commanderPlan : ['梳理任务优先级', '更新进度']).map((step, i) => (
                          <li key={i} className="text-xs text-slate-300 flex items-start gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                            {step}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">识别风险</p>
                      {commanderRisks.map((risk, i) => (
                        <p key={i} className={cn("text-xs mt-1", blockedLinkedTasks.length > 0 ? 'text-danger' : 'text-primary')}>
                          • {risk}
                        </p>
                      ))}
                    </div>
                    <div className="p-3 bg-white/5 rounded-xl border border-border-subtle">
                      <p className="text-[10px] text-slate-500 font-bold uppercase">预计工作量</p>
                      <p className="text-xs text-white mt-1">
                        {inProgressLinkedTasks.length > 0 ? `${inProgressLinkedTasks.length} 个任务并行推进` : '等待任务调度'}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button 
                    onClick={handleConfirmAction}
                    className="flex-1 py-2.5 bg-warning text-surface text-xs font-bold rounded-xl shadow-lg shadow-warning/20 hover:bg-warning/90 transition-all active:scale-95 uppercase tracking-wider"
                  >
                    确认并继续
                  </button>
                  <button 
                    onClick={() => {
                      setCommandInput((prev) => {
                        const prefix = prev.trim();
                        const draft = `${prefix ? `${prefix}\n` : ''}请基于当前风险与执行计划进行调整，重点说明任务优先级与依赖解除顺序。`;
                        return draft;
                      });
                    }}
                    className="px-6 py-2.5 bg-white/5 border border-border-subtle text-xs font-bold rounded-xl hover:bg-white/10 transition-all hover:border-white/20 uppercase tracking-wider text-slate-400"
                  >
                    修改计划
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Composer */}
          <div className="p-6 bg-surface/80 backdrop-blur-xl border-t border-border-subtle">
            <div className="max-w-4xl mx-auto relative group">
              <textarea 
                placeholder="输入命令或提出问题..."
                value={commandInput}
                onChange={(e) => setCommandInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleTrySend();
                  }
                }}
                className="w-full bg-surface-muted border border-border-subtle rounded-2xl px-5 py-4 pr-24 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all resize-none h-28 shadow-inner"
              />
              <div className="absolute right-4 bottom-4 flex items-center gap-3">
                <button className="p-2 text-slate-500 hover:text-white transition-colors">
                  <Globe size={18} />
                </button>
                <button
                  onClick={handleTrySend}
                  disabled={isUnderstanding || isSendingCommand}
                  className="bg-primary text-surface p-3 rounded-xl shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all disabled:opacity-60 disabled:hover:scale-100"
                >
                  <ChevronRight size={20} />
                </button>
              </div>
            </div>
            {isUnderstanding && (
              <div className="max-w-4xl mx-auto mt-3 p-3 bg-warning/10 border border-warning/30 rounded-xl flex items-center gap-2 text-warning text-xs font-medium">
                <Zap size={14} />
                AI 正在理解指令...
              </div>
            )}
            <div className="max-w-4xl mx-auto mt-4 flex justify-between items-center px-2">
              <div className="flex gap-4">
                <button className="px-3 py-1.5 bg-white/5 border border-border-subtle rounded-lg text-[10px] font-bold text-slate-400 hover:text-white hover:bg-white/10 hover:border-white/20 flex items-center gap-2 transition-all shadow-sm">
                  <FileText size={12} className="text-primary" />
                  附加上下文
                </button>
                <button className="px-3 py-1.5 bg-white/5 border border-border-subtle rounded-lg text-[10px] font-bold text-slate-400 hover:text-white hover:bg-white/10 hover:border-white/20 flex items-center gap-2 transition-all shadow-sm">
                  <Command size={12} className="text-accent" />
                  快捷键
                </button>
                <button className="px-3 py-1.5 bg-white/5 border border-border-subtle rounded-lg text-[10px] font-bold text-slate-400 hover:text-white hover:bg-white/10 hover:border-white/20 flex items-center gap-2 transition-all shadow-sm">
                  <UserPlus size={12} className="text-warning" />
                  邀请 Agent
                </button>
              </div>
              <p className="text-[10px] text-slate-600 font-medium flex items-center gap-2">
                按 <kbd className="bg-white/10 px-1.5 py-0.5 rounded border border-border-subtle text-slate-400 font-mono">Enter</kbd> 发送
              </p>
            </div>
          </div>

          <AnimatePresence>
            {confirmCard && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
                  onClick={() => setConfirmCard(null)}
                />
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.98 }}
                  className="fixed inset-0 z-50 flex items-center justify-center p-6"
                >
                  <div className="w-full max-w-2xl bg-surface-soft border border-border-subtle rounded-3xl shadow-2xl overflow-hidden">
                    <div className="px-6 py-4 border-b border-border-subtle bg-white/5 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-warning">
                        <BrainCircuit size={16} />
                        <h3 className="text-sm font-bold text-white">AI理解确认卡</h3>
                      </div>
                      <Badge variant="warning">发送前确认</Badge>
                    </div>
                    <div className="p-6 space-y-5">
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">我理解你要</p>
                        <p className="text-sm text-white mt-2">{confirmCard.summary}</p>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-4 bg-white/5 border border-border-subtle rounded-xl">
                          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">目标</p>
                          <p className="text-xs text-slate-200 mt-1 leading-relaxed">{confirmCard.goal}</p>
                        </div>
                        <div className="p-4 bg-white/5 border border-border-subtle rounded-xl">
                          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">涉及 Agent</p>
                          <p className="text-xs text-slate-200 mt-1">{confirmCard.involvedAgent}</p>
                        </div>
                        <div className="p-4 bg-white/5 border border-border-subtle rounded-xl">
                          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">项目上下文</p>
                          <p className="text-xs text-slate-200 mt-1">{confirmCard.project}</p>
                        </div>
                        <div className="p-4 bg-white/5 border border-border-subtle rounded-xl">
                          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">预计完成</p>
                          <p className="text-xs text-slate-200 mt-1">{confirmCard.eta}</p>
                        </div>
                      </div>
                      {confirmCard.warning && (
                        <div className="p-3 rounded-xl bg-warning/10 border border-warning/30 text-xs text-warning">
                          {confirmCard.warning}
                        </div>
                      )}
                    </div>
                    <div className="px-6 py-4 border-t border-border-subtle bg-white/5 flex flex-wrap gap-3 justify-end">
                      <button
                        onClick={handleConfirmExecute}
                        disabled={isSendingCommand}
                        className="px-4 py-2 bg-primary text-surface text-xs font-bold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60"
                      >
                        {isSendingCommand ? '执行中...' : '确认执行'}
                      </button>
                      <button
                        onClick={() => setConfirmCard(null)}
                        className="px-4 py-2 bg-white/5 border border-border-subtle text-xs font-bold rounded-lg hover:bg-white/10 transition-colors"
                      >
                        修改指令
                      </button>
                      <button
                        onClick={() => {
                          setConfirmCard(null);
                          setCommandInput('');
                        }}
                        className="px-4 py-2 bg-danger/15 border border-danger/30 text-danger text-xs font-bold rounded-lg hover:bg-danger/25 transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
};

const SystemOperations = ({ onNavigate, addToast, onRefreshData }: any) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizationError, setOptimizationError] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [isApplyingSuggestion, setIsApplyingSuggestion] = useState(false);
  const [systemHealthSnapshot, setSystemHealthSnapshot] = useState<any | null>(null);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<any | null>(null);
  const [diagnosisSummary, setDiagnosisSummary] = useState<string | null>(null);
  const [optimizationSuggestion, setOptimizationSuggestion] = useState<{
    loadInsights: string[];
    blockerInsights: string[];
    actions: Array<{ id: string; title: string; desc: string }>;
  } | null>(null);

  const loadSystemState = useCallback(async () => {
    const [health, runtime] = await Promise.all([
      systemApi.getHealth(),
      systemApi.getRuntime(),
    ]);
    setSystemHealthSnapshot(health);
    setRuntimeSnapshot(runtime);
  }, []);

  useEffect(() => {
    void loadSystemState();
  }, [loadSystemState]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    addToast('正在刷新系统状态...', 'info');
    try {
      const tasksToRun: Array<Promise<unknown>> = [loadSystemState()];
      if (onRefreshData) {
        tasksToRun.push(onRefreshData());
      }
      await Promise.all(tasksToRun);
      addToast('系统状态已更新', 'success');
    } catch (error) {
      addToast(`刷新失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDiagnose = async () => {
    setIsDiagnosing(true);
    addToast('正在启动全系统诊断...', 'info');
    try {
      const [validation, readiness] = await Promise.all([
        systemApi.validateRuntime(),
        systemApi.getReadiness(),
      ]);
      await loadSystemState();
      const readinessOk = Boolean((readiness as { ok?: unknown })?.ok ?? true);
      const summary = validation.ok
        ? readinessOk
          ? '运行配置校验通过，系统已就绪'
          : '运行配置已通过，但系统就绪检查存在风险'
        : `运行配置校验失败: ${validation.message}`;
      setDiagnosisSummary(summary);
      addToast(summary, validation.ok && readinessOk ? 'success' : 'error');
    } catch (error) {
      const message = error instanceof Error ? error.message : '诊断失败';
      setDiagnosisSummary(`诊断失败: ${message}`);
      addToast(`诊断失败: ${message}`, 'error');
    } finally {
      setIsDiagnosing(false);
    }
  };

  const topConsumers = useMemo(() => 
    [...agents].sort((a, b) => b.tokensUsed - a.tokensUsed).slice(0, 5),
  [agents]);
  const avgLoad = agents.length > 0
    ? Math.round(agents.reduce((sum, agent) => sum + (agent.load || 0), 0) / agents.length)
    : 0;
  const efficiencyScore = Math.max(0, 100 - avgLoad);
  const healthServices = (systemHealthSnapshot?.services || []) as Array<{
    name?: string;
    status?: string;
    detail?: string;
  }>;
  const serviceByName = new Map(
    healthServices
      .filter((service) => service?.name)
      .map((service) => [String(service.name), service]),
  );
  const normalizeServiceStatus = (status?: string): '健康' | '警告' | '离线' => {
    if (status === 'healthy') return '健康';
    if (status === 'degraded') return '警告';
    return '离线';
  };

  const systemStatus = [
    {
      label: 'API 网关',
      status: normalizeServiceStatus(serviceByName.get('api')?.status),
      detail: serviceByName.get('api')?.detail || 'Express API 已运行',
    },
    {
      label: 'OpenClaw 连接器',
      status: normalizeServiceStatus(serviceByName.get('runtime')?.status),
      detail: serviceByName.get('runtime')?.detail || '运行状态未知',
    },
    {
      label: 'Agent 集群',
      status: agents.length > 0 ? '健康' : '离线',
      detail: `${agents.length} 个 Agent 在线`,
    },
    {
      label: '模型服务',
      status: models.length > 0 ? '健康' : '离线',
      detail: `${models.length} 个模型可用`,
    },
  ];
  const allHealthy = systemStatus.every((service) => service.status === '健康');
  const readinessChecks = [
    {
      label: '环境变量',
      ok: runtimeSnapshot?.configured !== false,
    },
    {
      label: 'OpenClaw 工作区',
      ok: projects.length > 0,
    },
    {
      label: '数据库连接',
      ok: serviceByName.get('database')?.status === 'healthy',
    },
    {
      label: '运行模式校验',
      ok: runtimeSnapshot?.lastValidationStatus !== 'failed',
    },
    {
      label: 'Agent 集群',
      ok: agents.length > 0,
    },
    {
      label: '模型资源',
      ok: models.length > 0,
    },
  ];
  const modelCosts = models.slice(0, 4).map((model) => ({
    label: model.name,
    cost: `$${(model.totalTokens * 0.000002).toFixed(2)}`,
    usage: Math.min(100, Math.max(0, Math.round((model.dailyTokens / 200000) * 100))),
    color: model.status === 'Healthy' ? 'bg-primary' : 'bg-warning',
  }));

  const handleExportCostReport = () => {
    const payload = {
      generatedAt: new Date().toISOString(),
      efficiencyScore,
      averageAgentLoad: avgLoad,
      runtime: runtimeSnapshot ?? null,
      systemStatus,
      readinessChecks,
      modelCosts,
      topConsumers: topConsumers.map((agent) => ({
        id: agent.id,
        name: agent.name,
        model: agent.model,
        tokensUsed: agent.tokensUsed,
        tokenLimit: agent.tokenLimit,
        load: agent.load,
      })),
    };

    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `system-cost-report-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      addToast('成本报告已导出', 'success');
    } catch (error) {
      addToast(`导出失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    }
  };

  const buildOptimizationSuggestion = () => {
    const overloadedAgents = agents.filter((agent) => agent.load >= 80);
    const idleAgents = agents.filter((agent) => agent.load <= 30);
    const blockedTasks = tasks.filter((task) => task.status === 'Blocked');
    const blockedProjects = projects.filter((project) => project.status === 'Blocked' || /阻塞/i.test(project.phase));

    const loadInsights = overloadedAgents.length > 0
      ? overloadedAgents.map((agent) => `• ${agent.name} 负载 ${agent.load}% - 建议分流任务`)
      : ['• 负载均衡，无需调整'];

    const blockerInsights = blockedTasks.length > 0 || blockedProjects.length > 0
      ? [
          ...blockedProjects.map((project) => `• ${project.name} - 阶段状态: ${project.phase}`),
          ...blockedTasks.slice(0, 3).map((task) => `• ${task.title} - 等待 ${task.agent} 处理`),
        ]
      : ['• 所有项目正常'];

    const actions = [
      overloadedAgents.length > 0 && idleAgents.length > 0
        ? { id: 'rebalance', title: '分流任务到空闲Agent', desc: `将高负载 Agent 的任务分配给 ${idleAgents.slice(0, 2).map((agent) => agent.name).join('、') || '空闲 Agent'}` }
        : { id: 'rebalance', title: '保持当前负载策略', desc: '当前负载均衡，建议继续观察波动。' },
      { id: 'priority', title: '调整项目优先级', desc: '先处理阻塞任务所在项目，降低等待链条长度。' },
      { id: 'notify', title: '提醒阻塞节点负责人', desc: '自动通知阻塞任务负责人并附带上下文。' },
    ];

    return { loadInsights, blockerInsights, actions };
  };

  const handleOptimizeStrategy = () => {
    setIsOptimizing(true);
    setOptimizationError(null);
    setOptimizationSuggestion(null);
    setSelectedAction(null);
    addToast('正在分析...', 'info');

    try {
      setOptimizationSuggestion(buildOptimizationSuggestion());
      addToast('优化建议已生成', 'success');
    } catch {
      setOptimizationError('数据加载失败，请重试');
      addToast('数据加载失败，请重试', 'error');
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleApplySuggestion = async () => {
    if (!optimizationSuggestion || !selectedAction) {
      addToast('请先选择建议操作', 'error');
      return;
    }
    const action = optimizationSuggestion.actions.find((item) => item.id === selectedAction);
    const agentIdByName = new Map(agents.map((agent) => [agent.name, agent.id]));
    const resolveAgentId = (value: string) => {
      if (agentIdByName.has(value)) {
        return agentIdByName.get(value) as string;
      }
      return agents.find((agent) => agent.id === value)?.id;
    };

    let targetAgentIds: string[] = [];
    let command = '';
    if (selectedAction === 'rebalance') {
      const overloaded = agents.filter((agent) => (agent.load || 0) >= 80).map((agent) => agent.id);
      const idle = agents.filter((agent) => (agent.load || 0) <= 30).map((agent) => agent.name);
      targetAgentIds = overloaded;
      command = `系统优化建议：请将当前高负载任务分流给空闲 Agent（${idle.join('、') || '暂无空闲 Agent'}），并反馈新的负载分布。`;
    } else if (selectedAction === 'priority') {
      const blockedProjectIds = new Set(projects.filter((project) => project.status === 'Blocked').map((project) => project.id));
      const projectAgents = projects
        .filter((project) => blockedProjectIds.has(project.id))
        .flatMap((project) => project.agents);
      targetAgentIds = Array.from(new Set(projectAgents)).filter((id) => agents.some((agent) => agent.id === id));
      command = '系统优化建议：请优先处理阻塞项目相关任务，更新优先级并同步预计完成时间。';
    } else if (selectedAction === 'notify') {
      targetAgentIds = Array.from(new Set(
        tasks
          .filter((task) => task.status === 'Blocked')
          .map((task) => resolveAgentId(task.agent || ''))
          .filter((item): item is string => Boolean(item)),
      ));
      command = '系统提醒：你负责的任务当前处于阻塞状态，请尽快反馈阻塞原因和解除计划。';
    }

    if (targetAgentIds.length === 0) {
      addToast('未找到可执行该建议的目标 Agent', 'error');
      return;
    }

    setIsApplyingSuggestion(true);
    try {
      await sendBatchAgentMessage(targetAgentIds, command);
      if (onRefreshData) {
        await onRefreshData();
      }
      addToast(`已执行: ${action?.title || '优化策略'}`, 'success');
    } catch (error) {
      addToast(`执行失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsApplyingSuggestion(false);
    }
  };
  const runtimeStartedAt = sessions
    .map((session) => new Date(session.startTime).getTime())
    .filter((timestamp) => Number.isFinite(timestamp))
    .sort((a, b) => a - b)[0];
  const elapsedMs = runtimeStartedAt ? Math.max(Date.now() - runtimeStartedAt, 0) : 0;
  const runtimeDays = Math.floor(elapsedMs / (24 * 3600000));
  const runtimeHours = Math.floor((elapsedMs % (24 * 3600000)) / 3600000);

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">系统运行</h1>
          <p className="text-slate-400 mt-1">运行时状态、健康检查和成本治理。</p>
        </div>
        <button 
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="px-4 py-2 bg-white/5 border border-border-subtle rounded-lg text-sm font-medium hover:bg-white/10 transition-colors flex items-center gap-2 disabled:opacity-50"
        >
          <RotateCcw size={16} className={cn(isRefreshing && "animate-spin")} />
          {isRefreshing ? '刷新中...' : '刷新状态'}
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="bg-surface-soft border border-border-subtle rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border-subtle flex justify-between items-center bg-white/5">
              <h2 className="font-semibold text-white flex items-center gap-2">
                <Activity size={18} className="text-primary" />
                运行时健康状况
              </h2>
              <Badge variant={allHealthy ? 'primary' : 'warning'}>
                {allHealthy ? '所有系统正常' : '部分服务异常'}
              </Badge>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              {systemStatus.map((service, i) => (
                <div key={i} className="flex justify-between items-center p-4 bg-surface-muted rounded-xl border border-border-subtle hover:border-white/20 transition-colors group">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-white group-hover:text-primary transition-colors">{service.label}</p>
                    <p className="text-[10px] text-slate-500">{service.detail}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "w-2 h-2 rounded-full",
                      service.status === '健康'
                        ? "bg-primary shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                        : service.status === '警告'
                          ? "bg-warning shadow-[0_0_8px_rgba(245,158,11,0.45)]"
                          : "bg-danger shadow-[0_0_8px_rgba(239,68,68,0.45)]",
                    )} />
                    <span className={cn(
                      "text-xs font-bold",
                      service.status === '健康'
                        ? "text-primary"
                        : service.status === '警告'
                          ? "text-warning"
                          : "text-danger",
                    )}>{service.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-surface-soft border border-border-subtle rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border-subtle flex justify-between items-center bg-white/5">
              <h2 className="font-semibold text-white flex items-center gap-2">
                <Zap size={18} className="text-warning" />
                实时 Token 吞吐量
              </h2>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                  <span className="text-[10px] text-slate-400 uppercase">输入</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-accent" />
                  <span className="text-[10px] text-slate-400 uppercase">输出</span>
                </div>
              </div>
            </div>
            <div className="p-6 h-48 relative">
              <TokenThroughputChart />
              <div className="absolute bottom-6 left-6 right-6 flex justify-between text-[10px] text-slate-600 font-mono">
                <span>07:00</span>
                <span>07:10</span>
                <span>07:20</span>
                <span>07:30</span>
              </div>
            </div>
          </div>

          <div className="bg-surface-soft border border-border-subtle rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border-subtle flex justify-between items-center">
              <h2 className="font-semibold text-white flex items-center gap-2">
                <BarChart3 size={18} className="text-accent" />
                成本治理
              </h2>
              <button 
                onClick={handleExportCostReport}
                className="text-xs text-primary hover:underline"
              >
                导出报告
              </button>
            </div>
            <div className="p-6 space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {modelCosts.map((item, i) => (
                  <div key={i} className="space-y-3">
                    <div className="flex justify-between items-end">
                      <div>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">{item.label}</p>
                        <p className="text-xl font-bold text-white mt-1">{item.cost}</p>
                      </div>
                      <span className="text-xs text-slate-400">{item.usage}%</span>
                    </div>
                    <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${item.usage}%` }}
                        className={cn("h-full rounded-full", item.color)} 
                      />
                    </div>
                  </div>
                ))}
              </div>
              {modelCosts.length === 0 && (
                <div className="p-4 bg-white/5 border border-border-subtle rounded-xl text-xs text-slate-400">
                  暂无模型成本数据
                </div>
              )}
              
              <div className="p-4 bg-white/5 rounded-xl border border-border-subtle flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary">
                    <Zap size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">效率评分: {efficiencyScore}/100</p>
                    <p className="text-xs text-slate-500">您的 Agent 团队正在最佳成本参数内运行。</p>
                  </div>
                </div>
                <button
                  onClick={handleOptimizeStrategy}
                  disabled={isOptimizing}
                  className="px-4 py-2 bg-primary text-surface text-xs font-bold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60"
                >
                  {isOptimizing ? '正在分析...' : '优化策略'}
                </button>
              </div>

              {isOptimizing && (
                <div className="p-4 bg-white/5 border border-border-subtle rounded-xl text-xs text-slate-300">
                  正在分析 Agent 负载与项目阻塞情况...
                </div>
              )}

              {optimizationError && (
                <div className="p-4 bg-danger/10 border border-danger/30 rounded-xl text-xs text-danger">
                  {optimizationError}
                </div>
              )}

              {optimizationSuggestion && (
                <div className="p-5 bg-surface-muted border border-border-subtle rounded-2xl space-y-5">
                  <div className="flex items-center gap-2">
                    <BarChart3 size={16} className="text-accent" />
                    <h3 className="text-sm font-semibold text-white">优化策略建议</h3>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Agent负载分析</p>
                    {optimizationSuggestion.loadInsights.map((item, idx) => (
                      <p key={`load-${idx}`} className="text-xs text-slate-300">{item}</p>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">项目阻塞分析</p>
                    {optimizationSuggestion.blockerInsights.map((item, idx) => (
                      <p key={`block-${idx}`} className="text-xs text-slate-300">{item}</p>
                    ))}
                  </div>
                  <div className="space-y-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">建议操作</p>
                    <div className="space-y-2">
                      {optimizationSuggestion.actions.map((action) => (
                        <button
                          key={action.id}
                          onClick={() => setSelectedAction(action.id)}
                          className={cn(
                            "w-full text-left p-3 rounded-xl border transition-colors",
                            selectedAction === action.id
                              ? "bg-primary/10 border-primary/40"
                              : "bg-white/5 border-border-subtle hover:border-white/20",
                          )}
                        >
                          <p className="text-xs font-semibold text-white">{action.title}</p>
                          <p className="text-[10px] text-slate-500 mt-1">{action.desc}</p>
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => void handleApplySuggestion()}
                      disabled={isApplyingSuggestion}
                      className="w-full py-2.5 bg-primary text-surface text-xs font-bold rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-60"
                    >
                      {isApplyingSuggestion ? '执行中...' : '执行所选建议'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-surface-soft border border-border-subtle rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border-subtle flex justify-between items-center bg-white/5">
              <h2 className="font-semibold text-white flex items-center gap-2">
                <History size={18} className="text-slate-400" />
                最近会话活动
              </h2>
              <button className="text-xs text-primary hover:underline" onClick={() => onNavigate('monitoring')}>查看全部</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white/5 border-b border-border-subtle">
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Agent</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">项目</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">时长</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">消耗</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {sessions.slice(0, 5).map((session) => {
                    const agent = agents.find(a => a.id === session.agentId);
                    const project = projects.find(p => p.id === session.projectId);
                    return (
                      <tr key={session.id} className="hover:bg-white/5 transition-colors group">
                        <td className="px-6 py-4">
                          <span className="text-xs font-bold text-white">{agent?.name}</span>
                        </td>
                        <td className="px-6 py-4 text-xs text-slate-400">{project?.name}</td>
                        <td className="px-6 py-4 text-xs text-slate-500">{session.duration}</td>
                        <td className="px-6 py-4 text-xs text-white font-mono">{session.tokens}</td>
                        <td className="px-6 py-4 text-right">
                          <Badge variant={session.status === 'active' ? 'primary' : 'default'}>
                            {session.status === 'active' ? '活跃' : '完成'}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-8">
          <div className="bg-surface-soft border border-border-subtle rounded-2xl p-6 space-y-6">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <ShieldCheck size={18} className="text-primary" />
              就绪检查
            </h2>
            <div className="space-y-4">
              {readinessChecks.map((check, i) => (
                <div key={i} className="flex items-center justify-between group">
                  <span className="text-xs text-slate-400 group-hover:text-slate-300 transition-colors">{check.label}</span>
                  {check.ok ? (
                    <CheckCircle2 size={16} className="text-primary" />
                  ) : (
                    <AlertCircle size={16} className="text-danger" />
                  )}
                </div>
              ))}
            </div>
            <button 
              onClick={handleDiagnose}
              disabled={isDiagnosing}
              className="w-full py-2 bg-white/5 border border-border-subtle rounded-lg text-xs font-bold text-white hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              {isDiagnosing ? '诊断中...' : '运行全面诊断'}
            </button>
            {diagnosisSummary && (
              <p className="text-[10px] text-slate-400 leading-relaxed">{diagnosisSummary}</p>
            )}
          </div>

          <div className="bg-surface-soft border border-border-subtle rounded-2xl p-6 space-y-4">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <Users size={18} className="text-accent" />
              Top Token 消耗者
            </h2>
            <div className="space-y-4">
              {topConsumers.map((agent) => (
                <div key={agent.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-xs font-bold text-slate-400">
                      {agent.name.charAt(0)}
                    </div>
                    <div>
                      <p className="text-xs text-white font-medium">{agent.name}</p>
                      <p className="text-[9px] text-slate-500 uppercase">{agent.model}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-white font-bold">{(agent.tokensUsed / 1000).toFixed(1)}k</p>
                    <p className="text-[9px] text-slate-500">tokens</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-surface-soft border border-border-subtle rounded-2xl p-6 space-y-4">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <Clock size={18} className="text-slate-400" />
              运行时间
            </h2>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-bold text-white">{runtimeDays}</span>
              <span className="text-sm text-slate-500 mb-1">天</span>
              <span className="text-3xl font-bold text-white ml-2">{String(runtimeHours).padStart(2, '0')}</span>
              <span className="text-sm text-slate-500 mb-1">小时</span>
            </div>
            <p className="text-[10px] text-slate-600 uppercase tracking-widest font-bold">
              {runtimeSnapshot?.mode ? `当前模式: ${runtimeSnapshot.mode}` : '按会话启动时间估算'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

const ProjectsPortfolio = ({ onSelectProject, addToast, onOpenNewProject }: any) => {
  const [statusFilter, setStatusFilter] = useState<'all' | 'development' | 'planning' | 'blocked'>('all');

  const filteredProjects = useMemo(() => {
    if (statusFilter === 'all') {
      return projects;
    }
    if (statusFilter === 'development') {
      return projects.filter((project) => project.status === 'Development');
    }
    if (statusFilter === 'planning') {
      return projects.filter((project) => project.status === 'Planning');
    }
    return projects.filter((project) => project.status === 'Blocked');
  }, [statusFilter]);

  const avgProgress = filteredProjects.length > 0
    ? Math.round(filteredProjects.reduce((sum, project) => sum + (project.progress || 0), 0) / filteredProjects.length)
    : 0;
  const activeRisks = filteredProjects.filter(
    (project) => (project.status as string) === 'At Risk' || project.status === 'Blocked',
  ).length;
  const stats = [
    { label: '项目总数', value: projects.length.toString(), icon: Briefcase, color: 'text-accent' },
    { label: '平均进度', value: `${avgProgress}%`, icon: BarChart3, color: 'text-primary' },
    { label: '活跃风险', value: activeRisks.toString(), icon: AlertCircle, color: 'text-danger' },
  ];

  return (
  <div className="p-8 space-y-8 max-w-7xl mx-auto">
    <header className="flex justify-between items-end">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">项目组合</h1>
        <p className="text-slate-400 mt-1">管理和跟踪工作区中的所有活跃计划。</p>
      </div>
      <div className="flex gap-3">
        <div className="relative">
          <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <select 
            value={statusFilter}
            onChange={(event) => {
              const value = event.target.value as 'all' | 'development' | 'planning' | 'blocked';
              setStatusFilter(value);
              addToast(`已筛选 ${value === 'all' ? '所有状态' : value === 'development' ? '开发中' : value === 'planning' ? '规划中' : '已阻塞'} 项目`, 'info');
            }}
            className="bg-white/5 border border-border-subtle rounded-lg pl-9 pr-8 py-2 text-xs font-bold text-slate-300 appearance-none focus:outline-none focus:ring-1 focus:ring-primary/50"
          >
            <option value="all">所有状态</option>
            <option value="development">开发中</option>
            <option value="planning">规划中</option>
            <option value="blocked">已阻塞</option>
          </select>
          <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
        </div>
        <button 
          onClick={() => onOpenNewProject()}
          className="px-4 py-2 bg-primary text-surface hover:bg-primary/90 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
        >
          <Plus size={16} />
          创建项目
        </button>
      </div>
    </header>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {stats.map((stat, i) => (
        <div key={i} className="bg-surface-soft border border-border-subtle p-6 rounded-2xl flex items-center gap-4">
          <div className={cn("p-3 rounded-xl bg-white/5", stat.color)}>
            <stat.icon size={24} />
          </div>
          <div>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">{stat.label}</p>
            <h3 className="text-2xl font-bold text-white mt-0.5">{stat.value}</h3>
          </div>
        </div>
      ))}
    </div>

    <div className="bg-surface-soft border border-border-subtle rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-white/5 border-b border-border-subtle">
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">项目名称</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">状态</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">阶段</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">进度</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">团队</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {filteredProjects.map((project) => {
              const projectAgentNames = project.agents
                .map((agentId) => agents.find((agent) => agent.id === agentId)?.name || agentId)
                .filter(Boolean);

              return (
              <tr key={project.id} className="hover:bg-white/5 transition-colors group cursor-pointer" onClick={() => onSelectProject(project.id)}>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-slate-500 group-hover:text-primary transition-colors">
                      <Briefcase size={16} />
                    </div>
                    <span className="text-sm font-semibold text-white">{project.name}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <Badge variant={project.status === 'Blocked' ? 'danger' : project.status === 'Planning' ? 'accent' : 'primary'}>
                    {project.status === 'Development' ? '开发中' : project.status === 'Planning' ? '规划中' : project.status === 'Blocked' ? '已阻塞' : project.status}
                  </Badge>
                </td>
                <td className="px-6 py-4 text-xs text-slate-400">{project.phase}</td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 w-24 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${project.progress}%` }} />
                    </div>
                    <span className="text-xs font-bold text-white">{project.progress}%</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex -space-x-2 items-center">
                    {projectAgentNames.slice(0, 3).map((name, index) => (
                      <div
                        key={`${project.id}-agent-${index}`}
                        title={name}
                        className="w-6 h-6 rounded-full border-2 border-surface-soft bg-surface-muted flex items-center justify-center text-[8px] font-bold"
                      >
                        {name.trim().slice(0, 2).toUpperCase()}
                      </div>
                    ))}
                    {projectAgentNames.length > 3 && (
                      <div className="w-6 h-6 rounded-full border-2 border-surface-soft bg-white/5 flex items-center justify-center text-[8px] font-bold text-slate-500">
                        +{projectAgentNames.length - 3}
                      </div>
                    )}
                    {projectAgentNames.length === 0 && (
                      <span className="text-[10px] text-slate-500">未分配</span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 text-right">
                  <button className="p-2 text-slate-500 hover:text-white transition-colors">
                    <MoreVertical size={16} />
                  </button>
                </td>
              </tr>
              );
            })}
            {filteredProjects.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-slate-500">当前筛选条件下暂无项目</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  </div>
  );
};

const AgentsRoster = ({ onSelectAgent, addToast, onOpenTopology, onOpenDeploy, onOpenConfig }: any) => (
  <div className="p-8 space-y-8 max-w-7xl mx-auto">
    <header className="flex justify-between items-end">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Agent 名册</h1>
        <p className="text-slate-400 mt-1">监控和管理您的数字员工能力。</p>
      </div>
      <div className="flex gap-3">
        <button 
          onClick={() => onOpenTopology()}
          className="px-4 py-2 bg-white/5 border border-border-subtle rounded-lg text-sm font-medium hover:bg-white/10 transition-colors flex items-center gap-2"
        >
          <Workflow size={16} />
          团队图谱
        </button>
        <button 
          onClick={() => onOpenDeploy()}
          className="px-4 py-2 bg-primary text-surface hover:bg-primary/90 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
        >
          <UserPlus size={16} />
          部署 Agent
        </button>
      </div>
    </header>

    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
      {agents.map((agent) => (
        <div 
          key={agent.id} 
          className="bg-surface-soft border border-border-subtle rounded-2xl p-6 space-y-6 hover:border-white/20 transition-all group cursor-pointer"
          onClick={() => onSelectAgent(agent.id)}
        >
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center text-accent border border-accent/20 group-hover:scale-110 transition-transform">
                <BrainCircuit size={24} />
              </div>
              <div>
                <h4 className="font-bold text-white group-hover:text-primary transition-colors">{agent.name}</h4>
                <p className="text-xs text-slate-500">{agent.role}</p>
              </div>
            </div>
            <Badge variant={agent.status === 'Thinking' ? 'accent' : agent.status === 'Executing' ? 'primary' : 'default'}>
              {agent.status === 'Thinking' ? '思考中' : agent.status === 'Executing' ? '执行中' : '空闲'}
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-white/5 rounded-xl border border-border-subtle">
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">模型</p>
              <p className="text-xs text-white mt-1 font-medium">{models.find(m => m.id === agent.currentModelId)?.name}</p>
            </div>
            <div className="p-3 bg-white/5 rounded-xl border border-border-subtle">
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">已用 Token</p>
              <p className="text-xs text-white mt-1 font-medium">{(agent.tokensUsed / 1000).toFixed(1)}k</p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-500 font-bold uppercase tracking-wider">当前负载</span>
              <span className="text-white font-bold">{agent.load}%</span>
            </div>
            <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${agent.load}%` }}
                className={cn(
                  "h-full rounded-full",
                  agent.load > 80 ? "bg-danger" : "bg-primary"
                )}
              />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button 
              onClick={(e) => {
                e.stopPropagation();
                onSelectAgent(agent.id);
                addToast(`正在连接到 ${agent.name} 的控制终端...`, "info");
              }}
              className="flex-1 py-2.5 bg-white/5 border border-border-subtle rounded-xl text-xs font-bold text-slate-300 hover:bg-white/10 hover:text-white transition-all"
            >
              命令
            </button>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                onOpenConfig(agent.id);
              }}
              className="p-2.5 bg-white/5 border border-border-subtle rounded-xl text-slate-500 hover:text-white hover:bg-white/10 transition-all"
            >
              <Settings size={18} />
            </button>
          </div>
        </div>
      ))}
    </div>
  </div>
);

const OpenClawWorkspace = ({
  addToast,
  workspace,
  onRefreshData,
  onNavigate,
}: {
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  workspace?: {
    rootPath?: string;
    projects?: Array<{ id: string; name: string; relativePath?: string }>;
    agents?: Array<{ agentId: string; name: string }>;
  } | null;
  onRefreshData?: () => Promise<void>;
  onNavigate?: (tab: string, id?: string) => void;
}) => {
  const getRelativeTime = (date: string | Date | null | undefined) => {
    if (!date) {
      return '暂无活动';
    }

    const target = new Date(date);
    if (Number.isNaN(target.getTime())) {
      return '暂无活动';
    }

    const diff = Date.now() - target.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    return `${Math.floor(hours / 24)} 天前`;
  };

  const healthChecks = [
    { label: 'Agent 连接', ok: agents.length > 0 },
    { label: '项目活跃', ok: projects.length > 0 },
    { label: 'API 服务', ok: true },
  ];

  const getProjectLastActivity = (projectId: string) => {
    const latestSession = sessions
      .filter((session) => session.projectId === projectId)
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())[0];
    return getRelativeTime(latestSession?.startTime);
  };

  const recentReports = sessions
    .slice()
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
    .slice(0, 4)
    .map((session) => {
      const agentName = agents.find((agent) => agent.id === session.agentId)?.name || 'Agent 会话';
      const projectName = projects.find((project) => project.id === session.projectId)?.name || '未命名项目';
      return {
        title: `${agentName} · ${projectName}`,
        date: getRelativeTime(session.startTime),
        type: '会话',
      };
    });
  const workspaceRootPath = workspace?.rootPath || '~/.openclaw/workspace';
  const workspaceProjects = workspace?.projects || [];
  const workspaceAgents = workspace?.agents || [];
  const fileTreeItems = useMemo(() => {
    const projectItems = (workspaceProjects.length > 0
      ? workspaceProjects.slice(0, 5).map((project) => ({
          name: project.relativePath || project.name || project.id,
          type: 'folder',
          indent: 1,
        }))
      : projects.slice(0, 5).map((project) => ({
          name: project.name,
          type: 'folder',
          indent: 1,
        })));
    const agentItems = (workspaceAgents.length > 0
      ? workspaceAgents.slice(0, 5).map((agent) => ({
          name: agent.name || agent.agentId,
          type: 'file',
          indent: 1,
        }))
      : agents.slice(0, 5).map((agent) => ({
          name: agent.name,
          type: 'file',
          indent: 1,
        })));
    return [
      { name: 'workspace', type: 'folder', open: true, indent: 0 },
      ...projectItems,
      { name: 'agents', type: 'folder', open: true, indent: 0 },
      ...agentItems,
      { name: `tasks-${tasks.length}.json`, type: 'file', indent: 0 },
    ];
  }, [workspaceProjects, workspaceAgents, projects, agents, tasks.length]);

  return (
  <div className="p-8 space-y-8 max-w-7xl mx-auto">
    <header className="flex justify-between items-end">
      <div>
        <div className="flex items-center gap-2 text-primary mb-2">
          <Globe size={16} />
          <span className="text-[10px] font-bold uppercase tracking-widest">本地环境</span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white">OpenClaw 工作区</h1>
        <p className="text-slate-400 mt-1">与本地开发文件系统的直接集成。</p>
      </div>
      <div className="flex gap-3">
        <div className="px-4 py-2 bg-white/5 border border-border-subtle rounded-lg text-xs font-bold text-slate-400 flex items-center gap-2">
          <Database size={14} />
          根目录: {workspaceRootPath}
        </div>
        <button 
          onClick={async () => {
            addToast('正在同步本地文件系统...', 'info');
            try {
              if (onRefreshData) {
                await onRefreshData();
              }
              addToast('工作区同步完成', 'success');
            } catch (error) {
              addToast(`同步失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
            }
          }}
          className="px-4 py-2 bg-primary text-surface hover:bg-primary/90 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
        >
          <RotateCcw size={16} />
          同步工作区
        </button>
      </div>
    </header>

    <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
      <div className="lg:col-span-1 space-y-6">
        <div className="bg-surface-soft border border-border-subtle rounded-2xl p-6 space-y-4">
          <h3 className="text-[10px] uppercase tracking-widest font-bold text-slate-500 flex items-center gap-2">
            <Layers size={12} />
            文件浏览器
          </h3>
          <div className="space-y-1">
            {fileTreeItems.map((item: any, i) => (
              <div key={i} className={cn(
                "flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs cursor-pointer transition-colors",
                item.indent ? "ml-4" : "",
                "hover:bg-white/5 text-slate-400 hover:text-white"
              )}>
                {item.type === 'folder' ? (
                  <ChevronRight size={14} className={cn("text-slate-600", item.open ? "rotate-90" : "")} />
                ) : (
                  <FileText size={14} className="text-slate-600" />
                )}
                <span>{item.name}</span>
              </div>
            ))}
          </div>
        </div>
        
        <div className="bg-surface-soft border border-border-subtle rounded-2xl p-6 space-y-4">
          <h2 className="font-semibold text-white text-sm">工作区健康状况</h2>
          <div className="space-y-4">
            {healthChecks.map((item, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-xs text-slate-400">{item.label}</span>
                {item.ok ? (
                  <CheckCircle2 size={16} className="text-primary" />
                ) : (
                  <AlertCircle size={16} className="text-warning" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="lg:col-span-3 space-y-6">
        <div className="bg-surface-soft border border-border-subtle rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border-subtle flex justify-between items-center bg-white/5">
            <h2 className="font-semibold text-white">工作区项目</h2>
            <Badge variant="primary">{projects.length} 个活跃</Badge>
          </div>
          <div className="p-6 space-y-4">
            {projects.map((p, i) => (
              <div key={i} className="flex items-center justify-between p-4 bg-surface-muted rounded-xl border border-border-subtle hover:border-white/20 transition-all group">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center text-slate-500 group-hover:text-primary transition-colors">
                    <Briefcase size={20} />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">{p.name}</h4>
                    <p className="text-xs text-slate-500 mt-0.5">路径: /projects/{p.id}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-[10px] text-slate-500 font-bold uppercase">最后消息</p>
                    <p className="text-xs text-slate-300">{getProjectLastActivity(p.id)}</p>
                  </div>
                  <ChevronRight size={16} className="text-slate-600 group-hover:text-white transition-colors" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-surface-soft border border-border-subtle rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border-subtle flex justify-between items-center">
            <h2 className="font-semibold text-white">近期报告</h2>
            <button
              className="text-xs text-primary hover:underline"
              onClick={() => {
                onNavigate?.('audit');
                addToast('已跳转到审计页查看完整报告', 'info');
              }}
            >
              查看全部
            </button>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            {recentReports.length === 0 && (
              <div className="md:col-span-2 p-4 bg-white/5 rounded-xl border border-border-subtle">
                <p className="text-sm text-slate-300">暂无报告</p>
              </div>
            )}
            {recentReports.map((report, i) => (
              <div key={i} className="p-4 bg-white/5 rounded-xl border border-border-subtle hover:bg-white/10 transition-colors cursor-pointer flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center text-slate-500">
                  <FileText size={20} />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white">{report.title}</h4>
                  <p className="text-xs text-slate-500">{report.type} • {report.date}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  </div>
  );
};

const RealTimeMonitoring = ({
  addToast,
  onNavigate,
}: {
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onNavigate?: (tab: string, id?: string) => void;
}) => {
  const sessionList = sessions;
  const [activeFilter, setActiveFilter] = useState('all');

  const filteredSessions = useMemo(() => {
    if (activeFilter === 'all') return sessionList;
    return sessionList.filter(s => s.status === activeFilter);
  }, [sessionList, activeFilter]);

  const stats = useMemo(() => {
    const totalTokens = sessionList.reduce((acc, s) => acc + s.tokens, 0);
    const totalCost = sessionList.reduce((acc, s) => acc + s.cost, 0);
    const activeCount = sessionList.filter(s => s.status === 'active').length;
    return { totalTokens, totalCost, activeCount };
  }, [sessionList]);

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">实时监控 (Nexus)</h1>
          <p className="text-slate-400 mt-1">实时追踪 AI Agent 会话、Token 使用量及成本分析。</p>
        </div>
        <div className="flex gap-3">
          <div className="flex bg-white/5 p-1 rounded-xl border border-border-subtle">
            {[
              { id: 'all', label: '全部' },
              { id: 'active', label: '活跃' },
              { id: 'completed', label: '已完成' }
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setActiveFilter(f.id)}
                className={cn(
                  "px-4 py-1.5 text-xs font-bold rounded-lg transition-all",
                  activeFilter === f.id ? "bg-primary text-surface shadow-sm" : "text-slate-500 hover:text-slate-300"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-surface-soft border border-border-subtle p-6 rounded-2xl space-y-2">
          <div className="flex items-center gap-2 text-primary">
            <Zap size={18} />
            <span className="text-[10px] font-bold uppercase tracking-widest">总 Token 消耗</span>
          </div>
          <h3 className="text-3xl font-bold text-white">{(stats.totalTokens / 1000).toFixed(1)}k</h3>
          <p className="text-xs text-slate-500">今日累计使用</p>
        </div>
        <div className="bg-surface-soft border border-border-subtle p-6 rounded-2xl space-y-2">
          <div className="flex items-center gap-2 text-accent">
            <Activity size={18} />
            <span className="text-[10px] font-bold uppercase tracking-widest">预估成本</span>
          </div>
          <h3 className="text-3xl font-bold text-white">${stats.totalCost.toFixed(3)}</h3>
          <p className="text-xs text-slate-500">基于当前模型定价</p>
        </div>
        <div className="bg-surface-soft border border-border-subtle p-6 rounded-2xl space-y-2">
          <div className="flex items-center gap-2 text-warning">
            <Terminal size={18} />
            <span className="text-[10px] font-bold uppercase tracking-widest">活跃会话</span>
          </div>
          <h3 className="text-3xl font-bold text-white">{stats.activeCount}</h3>
          <p className="text-xs text-slate-500">当前正在运行的 Agent</p>
        </div>
      </div>

      <div className="bg-surface-soft border border-border-subtle rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border-subtle flex justify-between items-center bg-white/5">
          <h2 className="font-semibold text-white">会话活动流</h2>
          <button
            className="text-xs text-primary hover:underline"
            onClick={() => {
              onNavigate?.('audit');
              addToast('已跳转到审计追踪查看历史会话记录', 'info');
            }}
          >
            查看历史
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/5 border-b border-border-subtle">
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">会话 ID</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Agent</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">模型</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">项目</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">时长</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Tokens</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {filteredSessions.map((session) => {
                const agent = agents.find(a => a.id === session.agentId);
                const project = projects.find(p => p.id === session.projectId);
                return (
                  <tr key={session.id} className="hover:bg-white/5 transition-colors group">
                    <td className="px-6 py-4 text-xs text-slate-500 font-mono">{session.id}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded bg-white/5 flex items-center justify-center text-[10px] font-bold text-primary">
                          {agent?.name.charAt(0)}
                        </div>
                        <span className="text-xs font-bold text-white">{agent?.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant="default">{models.find(m => m.id === session.modelId)?.name}</Badge>
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-400">{project?.name}</td>
                    <td className="px-6 py-4 text-xs text-slate-500">{session.duration}</td>
                    <td className="px-6 py-4 text-xs text-white font-mono">{session.tokens}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5">
                        <div className={cn(
                          "w-1.5 h-1.5 rounded-full",
                          session.status === 'active' ? 'bg-primary animate-pulse' : 
                          session.status === 'completed' ? 'bg-slate-500' : 'bg-danger'
                        )} />
                        <span className={cn(
                          "text-[10px] font-bold uppercase",
                          session.status === 'active' ? 'text-primary' : 'text-slate-500'
                        )}>
                          {session.status === 'active' ? '活跃' : '已完成'}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const ModelTerminal = ({ model }: { model: Model }) => {
  const [logs, setLogs] = useState<Array<{
    timestamp: string;
    type: 'bash' | 'assistant' | 'json' | 'system';
    content: string;
    label?: string;
  }>>(model.logs || []);
  const [isConnected, setIsConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLogs(model.logs || []);
  }, [model.id, model.logs]);

  useEffect(() => {
    if (!model.id) {
      setLogs([]);
      setIsConnected(false);
      return;
    }

    let active = true;

    const fetchLogs = async () => {
      try {
        const data = await modelsApi.getLogs(model.id, undefined, 50);
        if (!active) {
          return;
        }

        const normalizedLogs = (data || [])
          .map((item) => ({
            timestamp: item.timestamp,
            type: item.type,
            content: item.content,
            label: item.label,
          }))
          .sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
          );

        setLogs(normalizedLogs);
        setIsConnected(true);
      } catch (error) {
        if (!active) {
          return;
        }
        setIsConnected(false);
        console.error('Failed to fetch logs:', error);
      }
    };

    void fetchLogs();
    const interval = window.setInterval(() => {
      void fetchLogs();
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [model.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="bg-surface-muted border border-border-subtle rounded-2xl overflow-hidden flex flex-col h-[500px] shadow-inner font-mono">
      <div className="px-4 py-2 bg-black/40 border-b border-border-subtle flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className={cn(
            "w-2 h-2 rounded-full",
            isConnected ? "bg-primary animate-pulse" : "bg-slate-500",
          )} />
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{model.name} @ aegis-os</span>
        </div>
        <div className="flex gap-1.5">
          <div className="w-2 h-2 rounded-full bg-red-500/20 border border-red-500/40" />
          <div className="w-2 h-2 rounded-full bg-amber-500/20 border border-amber-500/40" />
          <div className="w-2 h-2 rounded-full bg-green-500/20 border border-green-500/40" />
        </div>
      </div>
      <div 
        ref={scrollRef}
        className="flex-1 p-4 overflow-y-auto text-[11px] space-y-4 scrollbar-hide bg-black/20"
      >
        {logs.map((log, i) => (
          <div key={i} className="space-y-1 animate-in fade-in slide-in-from-bottom-1 duration-300">
            <div className="flex items-center gap-2 opacity-40 text-[9px]">
              <span className="text-primary font-bold">[{log.timestamp}]</span>
              <span className="uppercase tracking-tighter">{log.type}</span>
            </div>
            <div className={cn(
              "p-3 rounded-lg border",
              log.type === 'bash' ? "bg-white/5 border-white/10 text-slate-300" :
              log.type === 'json' ? "bg-blue-500/5 border-blue-500/20 text-blue-300" :
              log.type === 'assistant' ? "bg-primary/5 border-primary/20 text-white" :
              "bg-amber-500/5 border-amber-500/20 text-amber-300"
            )}>
              {log.label && <p className="text-slate-500 font-bold mb-1">{log.label}:</p>}
              <pre className="whitespace-pre-wrap break-all leading-relaxed">
                {log.type === 'bash' && <span className="text-primary mr-2">$</span>}
                {log.content}
              </pre>
            </div>
          </div>
        ))}
        <div className="flex items-center gap-2 text-primary">
          <span className="animate-pulse font-bold">▋</span>
        </div>
      </div>
    </div>
  );
};

const Dialog = ({ isOpen, onClose, title, children }: { isOpen: boolean, onClose: () => void, title: string, children: React.ReactNode }) => (
  <AnimatePresence>
    {isOpen && (
      <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 md:p-8">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-4xl bg-surface-soft border border-border-subtle rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        >
          <div className="px-6 py-4 border-b border-border-subtle flex justify-between items-center bg-white/5">
            <h3 className="text-lg font-bold text-white">{title}</h3>
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl text-slate-400 hover:text-white transition-colors">
              <X size={20} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            {children}
          </div>
        </motion.div>
      </div>
    )}
  </AnimatePresence>
);

const ModelNexus = ({ addToast, onOpenNewModel, onRefreshData }: any) => {
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const stats = useMemo(() => ({
    totalTokens: models.reduce((acc, m) => acc + m.totalTokens, 0),
    totalCost: models.reduce((acc, m) => acc + m.totalTokens * 0.000002, 0),
    activeModels: models.filter(m => m.status === 'Healthy').length
  }), [models]);

  const selectedModel = useMemo(() => 
    models.find(m => m.id === selectedModelId),
  [selectedModelId, models]);

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-bold text-white tracking-tight">模型资源中心</h1>
          <p className="text-slate-400 mt-2 flex items-center gap-2">
            Model Nexus: 实时观测多模型计算资源分配与消耗
            <div className="group relative inline-block">
              <Info size={14} className="text-slate-500 cursor-help hover:text-primary transition-colors" />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-surface-muted border border-border-subtle rounded-xl text-[10px] text-slate-300 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 shadow-2xl leading-relaxed">
                <p className="font-bold text-white mb-1 uppercase tracking-widest">实时吞吐量 (Throughput)</p>
                表示模型每秒处理的 Token 数量。它是衡量模型响应速度和并发处理能力的关键指标，高吞吐量意味着更快的交互体验。
              </div>
            </div>
          </p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={async () => {
              if (!onRefreshData) {
                addToast("当前页面未配置刷新能力", "error");
                return;
              }
              setIsRefreshing(true);
              addToast("正在刷新模型状态...", "info");
              try {
                await onRefreshData();
                addToast("模型状态已刷新", "success");
              } catch (error) {
                addToast(`刷新失败: ${error instanceof Error ? error.message : '未知错误'}`, "error");
              } finally {
                setIsRefreshing(false);
              }
            }}
            disabled={isRefreshing}
            className="p-2 bg-white/5 border border-border-subtle rounded-xl text-slate-400 hover:text-white transition-colors"
          >
            <RotateCcw size={20} className={cn(isRefreshing && "animate-spin")} />
          </button>
          <button 
            onClick={() => onOpenNewModel()}
            className="px-4 py-2 bg-primary text-surface font-bold rounded-xl shadow-lg shadow-primary/20 flex items-center gap-2"
          >
            <Plus size={18} />
            接入新模型
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-surface-soft border border-border-subtle p-8 rounded-3xl flex flex-col justify-center space-y-2 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Cpu size={80} />
          </div>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">TOTAL TOKENS (ALL MODELS)</p>
          <h2 className="text-5xl font-mono font-bold text-white tracking-tighter">
            {stats.totalTokens.toLocaleString()}
          </h2>
        </div>
        <div className="bg-surface-soft border border-border-subtle p-8 rounded-3xl flex flex-col justify-center space-y-2 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Zap size={80} />
          </div>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">TOTAL COST (USD)</p>
          <h2 className="text-5xl font-mono font-bold text-white tracking-tighter">
            ${stats.totalCost.toLocaleString(undefined, { minimumFractionDigits: 4 })}
          </h2>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {models.map((model) => (
          <div 
            key={model.id} 
            className="bg-surface-soft border border-border-subtle rounded-3xl p-6 space-y-6 hover:border-primary/30 transition-all group cursor-pointer"
            onClick={() => setSelectedModelId(model.id)}
          >
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "p-3 rounded-2xl",
                  model.status === 'Healthy' ? "bg-green-500/10 text-green-500" : "bg-amber-500/10 text-amber-500"
                )}>
                  <Cpu size={24} />
                </div>
                <div>
                  <h3 className="font-bold text-white text-lg">{model.name}</h3>
                  <p className="text-xs text-slate-500">{model.provider}</p>
                </div>
              </div>
              <Badge variant={model.status === 'Healthy' ? 'primary' : 'default'}>
                {model.status === 'Healthy' ? '运行良好' : '延迟波动'}
              </Badge>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-end">
                <span className="text-xs text-slate-500 uppercase tracking-widest font-bold">今日消耗</span>
                <span className="text-sm font-mono text-white">{model.dailyTokens.toLocaleString()}</span>
              </div>
              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${(model.dailyTokens / 200000) * 100}%` }}
                  className="h-full bg-primary"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-4 bg-white/5 rounded-2xl border border-border-subtle/50">
                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">累计消耗</p>
                <p className="text-lg font-mono text-white mt-1">{(model.totalTokens / 1000000).toFixed(1)}M</p>
              </div>
              <div className="p-4 bg-white/5 rounded-2xl relative overflow-hidden border border-border-subtle/50">
                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">实时吞吐</p>
                <p className="text-lg font-mono text-primary mt-1">{model.throughput}</p>
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary/20">
                  <motion.div 
                    className="h-full bg-primary"
                    animate={{ x: ['-100%', '100%'] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  />
                </div>
              </div>
              <div className="p-4 bg-white/5 rounded-2xl border border-border-subtle/50">
                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">平均延迟</p>
                <p className="text-lg font-mono text-white mt-1">{model.latency}</p>
              </div>
            </div>

            <div className="pt-4 border-t border-border-subtle flex justify-between items-center">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">查看实时终端</span>
              <Terminal size={14} className="text-slate-500 group-hover:text-primary transition-colors" />
            </div>
          </div>
        ))}
      </div>

      <Dialog 
        isOpen={!!selectedModelId} 
        onClose={() => setSelectedModelId(null)}
        title={selectedModel ? `${selectedModel.name} 实时终端` : '模型终端'}
      >
        {selectedModel && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="p-4 bg-white/5 rounded-2xl border border-border-subtle">
                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">当前状态</p>
                <div className="flex items-center gap-2 mt-1">
                  <div className={cn("w-2 h-2 rounded-full", selectedModel.status === 'Healthy' ? 'bg-primary' : 'bg-warning')} />
                  <span className="text-sm font-bold text-white">{selectedModel.status === 'Healthy' ? '运行良好' : '延迟波动'}</span>
                </div>
              </div>
              <div className="p-4 bg-white/5 rounded-2xl border border-border-subtle">
                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">今日 Token</p>
                <p className="text-sm font-mono font-bold text-white mt-1">{selectedModel.dailyTokens.toLocaleString()}</p>
              </div>
              <div className="p-4 bg-white/5 rounded-2xl border border-border-subtle">
                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">平均延迟</p>
                <p className="text-sm font-mono font-bold text-white mt-1">{selectedModel.latency}</p>
              </div>
              <div className="p-4 bg-white/5 rounded-2xl border border-border-subtle">
                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">提供商</p>
                <p className="text-sm font-bold text-white mt-1">{selectedModel.provider}</p>
              </div>
            </div>
            <ModelTerminal model={selectedModel} />
          </div>
        )}
      </Dialog>
    </div>
  );
};

const AuditLogs = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [remoteLogs, setRemoteLogs] = useState<SystemAuditLog[]>([]);
  const [isLoadingRemoteLogs, setIsLoadingRemoteLogs] = useState(false);
  const [selectedLogJson, setSelectedLogJson] = useState<string | null>(null);

  const formatLogTime = (value: string | Date | null | undefined) => {
    if (!value) {
      return '--:--:--';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '--:--:--';
    }
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const extractEntityDate = (entity: unknown): string | null => {
    if (!entity || typeof entity !== 'object') {
      return null;
    }

    const record = entity as Record<string, unknown>;
    const rawDate = record.updatedAt ?? record.createdAt ?? record.startTime ?? null;
    if (!rawDate) {
      return null;
    }

    if (typeof rawDate === 'string') {
      return rawDate;
    }

    if (rawDate instanceof Date) {
      return rawDate.toISOString();
    }

    return null;
  };

  const localAuditLogs = useMemo(() => {
    const logs: Array<{
      time: string;
      actor: string;
      action: string;
      resource: string;
      status: '成功' | '警告' | '进行中';
      sortValue: number;
      raw: unknown;
    }> = [];

    const recentSessions = sessions
      .slice()
      .sort(
        (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
      )
      .slice(0, 5);

    recentSessions.forEach((session) => {
      const agent = agents.find((candidate) => candidate.id === session.agentId);
      const project = projects.find((candidate) => candidate.id === session.projectId);
      if (!agent && !project) {
        return;
      }

      const eventDate = extractEntityDate(session) ?? session.startTime;
      const timestamp = new Date(eventDate).getTime();

      logs.push({
        time: formatLogTime(eventDate),
        actor: agent?.name || 'Agent',
        action: session.status === 'active' ? '进行中任务' : '完成任务',
        resource: project?.name || '项目',
        status: session.status === 'active' ? '进行中' : '成功',
        sortValue: Number.isFinite(timestamp) ? timestamp : 0,
        raw: session,
      });
    });

    projects
      .filter((project) => project.status === 'Blocked')
      .slice(0, 2)
      .forEach((project) => {
        const eventDate = extractEntityDate(project) ?? new Date().toISOString();
        const timestamp = new Date(eventDate).getTime();
        logs.push({
          time: formatLogTime(eventDate),
          actor: '系统',
          action: '项目阻塞',
          resource: project.name,
          status: '警告',
          sortValue: Number.isFinite(timestamp) ? timestamp : 0,
          raw: project,
        });
      });

    tasks
      .filter((task) => task.status === 'Blocked')
      .slice(0, 2)
      .forEach((task) => {
        const eventDate = extractEntityDate(task) ?? new Date().toISOString();
        const timestamp = new Date(eventDate).getTime();
        logs.push({
          time: formatLogTime(eventDate),
          actor: task.agent || '系统',
          action: '任务阻塞',
          resource: task.title,
          status: '警告',
          sortValue: Number.isFinite(timestamp) ? timestamp : 0,
          raw: task,
        });
      });

    return logs.sort((a, b) => b.sortValue - a.sortValue).slice(0, 10);
  }, [sessions, agents, projects, tasks]);

  const loadRemoteLogs = useCallback(async () => {
    setIsLoadingRemoteLogs(true);
    try {
      const list = await auditApi.listSystem(100);
      setRemoteLogs(Array.isArray(list) ? list : []);
    } catch {
      setRemoteLogs([]);
    } finally {
      setIsLoadingRemoteLogs(false);
    }
  }, []);

  useEffect(() => {
    void loadRemoteLogs();
  }, [loadRemoteLogs]);

  const normalizedRemoteLogs = useMemo(() => {
    return remoteLogs
      .map((log) => {
        const createdAtTs = new Date(log.createdAt).getTime();
        const summary = log.summary?.trim() || log.action || '系统事件';
        const resource = log.resourceId
          ? `${log.resourceType}:${log.resourceId}`
          : log.resourceType;
        const content = `${summary} ${log.detail || ''}`.toLowerCase();
        const status: '成功' | '警告' | '进行中' =
          /failed|error|blocked|deny|rejected|失败|阻塞|警告/.test(content)
            ? '警告'
            : /pending|running|processing|进行中|处理中/.test(content)
              ? '进行中'
              : '成功';

        return {
          time: formatLogTime(log.createdAt),
          actor: log.actorLabel || log.actorType || '系统',
          action: summary,
          resource,
          status,
          sortValue: Number.isFinite(createdAtTs) ? createdAtTs : 0,
          raw: log,
        };
      })
      .sort((a, b) => b.sortValue - a.sortValue)
      .slice(0, 50);
  }, [remoteLogs]);

  const mergedAuditLogs = useMemo(() => (
    normalizedRemoteLogs.length > 0 ? normalizedRemoteLogs : localAuditLogs
  ), [normalizedRemoteLogs, localAuditLogs]);

  const filteredAuditLogs = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    if (!keyword) {
      return mergedAuditLogs;
    }
    return mergedAuditLogs.filter((log) => {
      return `${log.time} ${log.actor} ${log.action} ${log.resource} ${log.status}`
        .toLowerCase()
        .includes(keyword);
    });
  }, [mergedAuditLogs, searchTerm]);

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">审计追踪</h1>
          <p className="text-slate-400 mt-1">所有系统操作和 Agent 活动的全面日志。</p>
        </div>
        <div className="flex gap-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input 
              type="text" 
              placeholder="搜索日志..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="bg-white/5 border border-border-subtle rounded-lg pl-9 pr-4 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 w-64"
            />
          </div>
          <button
            onClick={() => void loadRemoteLogs()}
            disabled={isLoadingRemoteLogs}
            className="px-4 py-2 bg-white/5 border border-border-subtle rounded-lg text-sm font-medium hover:bg-white/10 transition-colors flex items-center gap-2 disabled:opacity-60"
          >
            <BarChart3 size={16} />
            {isLoadingRemoteLogs ? '刷新中...' : '分析'}
          </button>
        </div>
      </header>

      <div className="bg-surface-soft border border-border-subtle rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/5 border-b border-border-subtle">
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">时间戳</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">执行者</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">操作</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">资源</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">状态</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">详情</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {filteredAuditLogs.length > 0 ? filteredAuditLogs.map((log, i) => (
                <tr key={i} className="hover:bg-white/5 transition-colors group">
                  <td className="px-6 py-4 text-xs text-slate-500 font-mono">{log.time}</td>
                  <td className="px-6 py-4">
                    <span className="text-xs font-bold text-white">{log.actor}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-xs text-slate-300">{log.action}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-xs text-slate-400 font-mono">{log.resource}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5">
                      <div className={cn(
                        "w-1.5 h-1.5 rounded-full", 
                        log.status === '成功' ? 'bg-primary' :
                        log.status === '进行中' ? 'bg-accent' :
                        'bg-warning'
                      )} />
                      <span className={cn(
                        "text-[10px] font-bold uppercase",
                        log.status === '成功' ? 'text-primary' :
                        log.status === '进行中' ? 'text-accent' :
                        'text-warning'
                      )}>{log.status}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      className="text-[10px] text-primary hover:underline"
                      onClick={() => setSelectedLogJson(JSON.stringify(log.raw ?? log, null, 2))}
                    >
                      查看 JSON
                    </button>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                    {searchTerm.trim() ? '未匹配到审计日志' : '暂无审计日志'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <Dialog
        isOpen={Boolean(selectedLogJson)}
        onClose={() => setSelectedLogJson(null)}
        title="审计日志详情"
      >
        <pre className="text-xs text-slate-300 bg-surface-muted border border-border-subtle rounded-2xl p-4 whitespace-pre-wrap break-all">
          {selectedLogJson}
        </pre>
      </Dialog>
    </div>
  );
};

const SettingsPage = ({
  addToast,
  onRuntimeUpdated,
}: {
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onRuntimeUpdated?: () => Promise<void> | void;
}) => {
  const SETTINGS_STORAGE_KEY = 'aegis.settings.v1';
  const [language, setLanguage] = useState('zh');
  const [workspacePath, setWorkspacePath] = useState('~/.openclaw');
  const [isSaving, setIsSaving] = useState(false);
  const [isRuntimeLoading, setIsRuntimeLoading] = useState(false);
  const [isRuntimeValidating, setIsRuntimeValidating] = useState(false);
  const [autoSync, setAutoSync] = useState(true);
  const [apiProtection, setApiProtection] = useState(true);
  const [autonomousMode, setAutonomousMode] = useState(false);
  const [usageAlert, setUsageAlert] = useState(true);
  const [runtimeProvider, setRuntimeProvider] = useState<'scripted' | 'openai-compatible'>('scripted');
  const [runtimeApiBaseUrl, setRuntimeApiBaseUrl] = useState('');
  const [runtimeModelName, setRuntimeModelName] = useState('');
  const [runtimeApiKey, setRuntimeApiKey] = useState('');
  const [clearRuntimeApiKey, setClearRuntimeApiKey] = useState(false);
  const [runtimeApiKeyPreview, setRuntimeApiKeyPreview] = useState('');
  const [runtimeApiKeyConfigured, setRuntimeApiKeyConfigured] = useState(false);
  const [runtimeValidationHint, setRuntimeValidationHint] = useState('');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as {
        language?: string;
        workspacePath?: string;
        autoSync?: boolean;
        apiProtection?: boolean;
        autonomousMode?: boolean;
        usageAlert?: boolean;
      };
      setLanguage(parsed.language === 'en' ? 'en' : 'zh');
      setWorkspacePath(parsed.workspacePath?.trim() || '~/.openclaw');
      setAutoSync(parsed.autoSync !== false);
      setApiProtection(parsed.apiProtection !== false);
      setAutonomousMode(Boolean(parsed.autonomousMode));
      setUsageAlert(parsed.usageAlert !== false);
    } catch {
      // ignore invalid local settings payload
    }
  }, []);

  const loadRuntimeConfig = useCallback(async () => {
    setIsRuntimeLoading(true);
    try {
      const config = await systemApi.getRuntimeConfig();
      setRuntimeProvider(config.provider);
      setRuntimeApiBaseUrl(config.apiBaseUrl || '');
      setRuntimeModelName(config.modelName || '');
      setRuntimeApiKey('');
      setClearRuntimeApiKey(false);
      setRuntimeApiKeyConfigured(Boolean(config.apiKeyConfigured));
      setRuntimeApiKeyPreview(config.apiKeyPreview || '');
      setRuntimeValidationHint(
        config.lastValidationStatus === 'failed'
          ? (config.lastValidationError || '最近一次校验失败')
          : config.lastValidationStatus === 'healthy'
            ? '最近一次校验通过'
            : '尚未进行运行配置校验',
      );
    } catch (error) {
      setRuntimeValidationHint(`运行配置加载失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsRuntimeLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRuntimeConfig();
  }, [loadRuntimeConfig]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
        language,
        workspacePath: workspacePath.trim() || '~/.openclaw',
        autoSync,
        apiProtection,
        autonomousMode,
        usageAlert,
      }));
      const runtimeResult = await systemApi.updateRuntimeConfig({
        provider: runtimeProvider,
        apiBaseUrl: runtimeApiBaseUrl.trim(),
        modelName: runtimeModelName.trim(),
        apiKey: runtimeApiKey.trim() || undefined,
        clearApiKey: clearRuntimeApiKey,
      });
      setRuntimeApiKey('');
      setClearRuntimeApiKey(false);
      setRuntimeApiKeyConfigured(Boolean(runtimeResult.apiKeyConfigured));
      setRuntimeApiKeyPreview(runtimeResult.apiKeyPreview || '');
      setRuntimeValidationHint(
        runtimeResult.lastValidationStatus === 'failed'
          ? (runtimeResult.lastValidationError || '最近一次校验失败')
          : runtimeResult.lastValidationStatus === 'healthy'
            ? '最近一次校验通过'
            : '运行配置已更新，建议执行校验',
      );
      if (onRuntimeUpdated) {
        await onRuntimeUpdated();
      }
      addToast("设置已保存", "success");
    } catch (error) {
      addToast(`保存失败: ${error instanceof Error ? error.message : '未知错误'}`, "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setLanguage('zh');
    setWorkspacePath('~/.openclaw');
    setAutoSync(true);
    setApiProtection(true);
    setAutonomousMode(false);
    setUsageAlert(true);
    setRuntimeProvider('scripted');
    setRuntimeApiBaseUrl('');
    setRuntimeModelName('');
    setRuntimeApiKey('');
    setClearRuntimeApiKey(false);
    setRuntimeValidationHint('运行配置已重置为默认值，保存后生效。');
    try {
      localStorage.removeItem(SETTINGS_STORAGE_KEY);
    } catch {
      // ignore storage reset errors
    }
    addToast("设置已重置", "info");
  };

  const handleValidateRuntime = async () => {
    setIsRuntimeValidating(true);
    try {
      const result = await systemApi.validateRuntime();
      setRuntimeValidationHint(result.message || (result.ok ? '校验通过' : '校验失败'));
      addToast(result.ok ? '运行配置校验通过' : '运行配置校验失败', result.ok ? 'success' : 'error');
      await loadRuntimeConfig();
      if (onRuntimeUpdated) {
        await onRuntimeUpdated();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '校验失败';
      setRuntimeValidationHint(message);
      addToast(`运行配置校验失败: ${message}`, 'error');
    } finally {
      setIsRuntimeValidating(false);
    }
  };

  const handleBrowseWorkspace = async () => {
    const picker = (window as unknown as { showDirectoryPicker?: () => Promise<{ name?: string }> }).showDirectoryPicker;
    if (typeof picker !== 'function') {
      addToast('当前环境不支持目录浏览，请手动输入路径', 'info');
      return;
    }

    try {
      const directory = await picker();
      const pickedName = directory?.name?.trim();
      if (pickedName) {
        const normalized = pickedName.startsWith('/') ? pickedName : `/${pickedName}`;
        setWorkspacePath(normalized);
        addToast(`已选择目录: ${normalized}`, 'success');
      }
    } catch (error) {
      const name = (error as { name?: string })?.name;
      if (name === 'AbortError') {
        return;
      }
      addToast(`目录选择失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    }
  };

  const handlePasswordChange = () => {
    addToast('当前版本暂不支持在线改密，请通过初始化流程重置管理员密码。', 'info');
  };

  return (
    <div className="p-8 space-y-8 max-w-4xl mx-auto">
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">设置</h1>
          <p className="text-slate-400 mt-1">配置您的 Aegis OS 工作区和偏好设置。</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={handleReset}
            className="px-4 py-2 bg-white/5 border border-border-subtle rounded-lg text-sm font-medium hover:bg-white/10 transition-colors"
          >
            重置为默认值
          </button>
          <button 
            onClick={() => void handleSave()}
            disabled={isSaving}
            className="px-4 py-2 bg-primary text-surface rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isSaving ? '保存中...' : '保存更改'}
          </button>
        </div>
      </header>

      <div className="space-y-8">
        <section className="bg-surface-soft border border-border-subtle rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border-subtle bg-white/5">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <Languages size={18} className="text-accent" />
              本地化
            </h2>
          </div>
          <div className="p-6 space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-medium text-white">系统语言</p>
                <p className="text-xs text-slate-500 mt-1">选择界面的主要语言。</p>
              </div>
              <div className="flex gap-2 bg-white/5 p-1 rounded-xl border border-border-subtle">
                <button 
                  onClick={() => setLanguage('en')}
                  className={cn(
                    "px-4 py-1.5 text-xs font-bold rounded-lg transition-all",
                    language === 'en' ? "bg-surface-muted text-white shadow-sm border border-border-subtle" : "text-slate-500 hover:text-slate-300"
                  )}
                >
                  English
                </button>
                <button 
                  onClick={() => setLanguage('zh')}
                  className={cn(
                    "px-4 py-1.5 text-xs font-bold rounded-lg transition-all",
                    language === 'zh' ? "bg-primary text-surface shadow-sm" : "text-slate-500 hover:text-slate-300"
                  )}
                >
                  中文
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-surface-soft border border-border-subtle rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border-subtle bg-white/5 flex items-center justify-between">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <Cpu size={18} className="text-warning" />
              运行时模型配置
            </h2>
            <button
              onClick={() => void loadRuntimeConfig()}
              disabled={isRuntimeLoading}
              className="text-[10px] font-bold text-primary hover:underline disabled:opacity-60 uppercase tracking-widest"
            >
              {isRuntimeLoading ? '加载中...' : '重新加载'}
            </button>
          </div>
          <div className="p-6 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">运行模式</label>
                <select
                  value={runtimeProvider}
                  onChange={(event) => setRuntimeProvider(event.target.value as 'scripted' | 'openai-compatible')}
                  className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary/50 appearance-none"
                >
                  <option value="scripted">Scripted (本地脚本)</option>
                  <option value="openai-compatible">OpenAI Compatible</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">模型名称</label>
                <input
                  type="text"
                  value={runtimeModelName}
                  onChange={(event) => setRuntimeModelName(event.target.value)}
                  placeholder="例如: gpt-4.1"
                  className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">API Base URL</label>
              <input
                type="text"
                value={runtimeApiBaseUrl}
                onChange={(event) => setRuntimeApiBaseUrl(event.target.value)}
                placeholder="https://api.openai.com/v1"
                className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">API Key</label>
              <input
                type={apiProtection ? "password" : "text"}
                value={runtimeApiKey}
                onChange={(event) => setRuntimeApiKey(event.target.value)}
                placeholder={runtimeApiKeyConfigured ? `已配置 (${runtimeApiKeyPreview || '******'})` : "输入新的 API Key"}
                className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-slate-500">
                  {runtimeApiKeyConfigured ? `已配置密钥: ${runtimeApiKeyPreview || '******'}` : '当前未配置 API Key'}
                </p>
                <label className="flex items-center gap-2 text-[10px] text-slate-400">
                  <input
                    type="checkbox"
                    checked={clearRuntimeApiKey}
                    onChange={(event) => setClearRuntimeApiKey(event.target.checked)}
                    className="accent-primary"
                  />
                  清除现有密钥
                </label>
              </div>
            </div>
            <div className="flex items-center justify-between p-3 bg-white/5 border border-border-subtle rounded-xl">
              <p className="text-xs text-slate-400">{runtimeValidationHint || '尚未进行运行配置校验'}</p>
              <button
                onClick={() => void handleValidateRuntime()}
                disabled={isRuntimeValidating || isRuntimeLoading}
                className="px-3 py-1.5 bg-white/10 border border-border-subtle rounded-lg text-[10px] font-bold text-slate-300 hover:bg-white/20 transition-colors disabled:opacity-60"
              >
                {isRuntimeValidating ? '校验中...' : '运行校验'}
              </button>
            </div>
          </div>
        </section>

        <section className="bg-surface-soft border border-border-subtle rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border-subtle bg-white/5">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <Database size={18} className="text-primary" />
              工作区配置
            </h2>
          </div>
          <div className="p-6 space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">OpenClaw 根路径</label>
              <div className="flex gap-3">
                <input 
                  type="text" 
                  value={workspacePath}
                  onChange={(e) => setWorkspacePath(e.target.value)}
                  className="flex-1 bg-surface-muted border border-border-subtle rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary/50" 
                />
                <button
                  onClick={() => void handleBrowseWorkspace()}
                  className="px-4 py-2 bg-white/5 border border-border-subtle rounded-xl text-xs font-bold text-slate-300 hover:bg-white/10 transition-colors"
                >
                  浏览
                </button>
              </div>
            </div>
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-medium text-white">自动同步工作区</p>
                <p className="text-xs text-slate-500 mt-1">自动同步来自本地文件系统的更改。</p>
              </div>
              <div 
                onClick={() => setAutoSync(!autoSync)}
                className={cn(
                  "w-12 h-6 rounded-full relative cursor-pointer transition-colors",
                  autoSync ? "bg-primary" : "bg-white/10"
                )}
              >
                <div className={cn(
                  "absolute top-1 w-4 h-4 bg-surface rounded-full shadow-sm transition-all",
                  autoSync ? "right-1" : "left-1"
                )} />
              </div>
            </div>
          </div>
        </section>

        <section className="bg-surface-soft border border-border-subtle rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border-subtle bg-white/5">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <ShieldCheck size={18} className="text-danger" />
              安全与访问
            </h2>
          </div>
          <div className="p-6 space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-medium text-white">管理员密码</p>
                <p className="text-xs text-slate-500 mt-1">在线改密将在后续版本支持。</p>
              </div>
              <button
                onClick={handlePasswordChange}
                className="px-4 py-2 bg-white/5 border border-border-subtle rounded-lg text-xs font-bold text-slate-300 hover:bg-white/10 transition-colors"
              >
                更改密码
              </button>
            </div>
            <div className="h-px bg-border-subtle" />
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-medium text-white">API 密钥保护</p>
                <p className="text-xs text-slate-500 mt-1">在系统运行页面中隐藏敏感密钥。</p>
              </div>
              <div 
                onClick={() => setApiProtection(!apiProtection)}
                className={cn(
                  "w-12 h-6 rounded-full relative cursor-pointer transition-colors",
                  apiProtection ? "bg-primary" : "bg-white/10"
                )}
              >
                <div className={cn(
                  "absolute top-1 w-4 h-4 bg-surface rounded-full shadow-sm transition-all",
                  apiProtection ? "right-1" : "left-1"
                )} />
              </div>
            </div>
          </div>
        </section>

        <section className="bg-surface-soft border border-border-subtle rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border-subtle bg-white/5">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <BrainCircuit size={18} className="text-warning" />
              Agent 治理
            </h2>
          </div>
          <div className="p-6 space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-medium text-white">自主模式</p>
                <p className="text-xs text-slate-500 mt-1">允许 Agent 在没有明确确认的情况下执行任务。</p>
              </div>
              <div 
                onClick={() => setAutonomousMode(!autonomousMode)}
                className={cn(
                  "w-12 h-6 rounded-full relative cursor-pointer transition-colors",
                  autonomousMode ? "bg-primary" : "bg-white/10"
                )}
              >
                <div className={cn(
                  "absolute top-1 w-4 h-4 bg-surface rounded-full shadow-sm transition-all",
                  autonomousMode ? "right-1" : "left-1"
                )} />
              </div>
            </div>
            <div className="h-px bg-border-subtle" />
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-medium text-white">Token 使用警报</p>
                <p className="text-xs text-slate-500 mt-1">当 Agent 超过其每日配额的 80% 时通知。</p>
              </div>
              <div 
                onClick={() => setUsageAlert(!usageAlert)}
                className={cn(
                  "w-12 h-6 rounded-full relative cursor-pointer transition-colors",
                  usageAlert ? "bg-primary" : "bg-white/10"
                )}
              >
                <div className={cn(
                  "absolute top-1 w-4 h-4 bg-surface rounded-full shadow-sm transition-all",
                  usageAlert ? "right-1" : "left-1"
                )} />
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

// --- Main App ---

export default function App() {
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
  const [isInitialized, setIsInitialized] = useState<boolean | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const bootstrapAuth = async () => {
      setAuthLoading(true);
      try {
        const status = await authApi.getStatus();
        if (cancelled) {
          return;
        }
        setIsInitialized(Boolean(status.setupComplete));
        setIsLoggedIn(Boolean(status.authenticated));
        setError('');
      } catch (err) {
        if (cancelled) {
          return;
        }
        setIsInitialized(true);
        setIsLoggedIn(false);
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
      setIsInitialized(Boolean(status.setupComplete));
      setIsLoggedIn(Boolean(status.authenticated));
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
      setIsInitialized(Boolean(status.setupComplete));
      setIsLoggedIn(Boolean(status.authenticated));
      setPassword('');
      setError('');
      addToast("系统初始化完成", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : '初始化失败，请重试');
      addToast("初始化失败", "error");
    }
  };

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {
      // ignore logout API failures and clear local state anyway
    } finally {
      setIsLoggedIn(false);
      setPassword('');
      addToast("已安全退出系统", "info");
    }
  };

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  // Modal States
  const [isNewModelOpen, setIsNewModelOpen] = useState(false);
  const [isAgentConfigOpen, setIsAgentConfigOpen] = useState(false);
  const [isTopologyOpen, setIsTopologyOpen] = useState(false);
  const [isDeployOpen, setIsDeployOpen] = useState(false);
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [isDecisionCenterOpen, setIsDecisionCenterOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [managedModels, setManagedModels] = useState<Model[]>([]);
  const [inboxNotifications, setInboxNotifications] = useState<NotificationInboxItem[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [markingAllRead, setMarkingAllRead] = useState(false);

  const { agents, projects, tasks, sessions, workspace, runtime, refresh, sendAgentMessage } = useRealData();

  const loadManagedModels = useCallback(async () => {
    try {
      const list = await modelsApi.list();
      setManagedModels((list || []).map(toUiModel));
    } catch {
      setManagedModels([]);
    }
  }, []);

  const loadInboxNotifications = useCallback(async () => {
    try {
      setNotificationsLoading(true);
      const list = await notificationsApi.listInbox('zh-CN');
      setInboxNotifications(Array.isArray(list) ? list : []);
    } catch {
      setInboxNotifications([]);
    } finally {
      setNotificationsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoggedIn) {
      setManagedModels([]);
      setInboxNotifications([]);
      return;
    }
    void loadManagedModels();
    void loadInboxNotifications();
  }, [isLoggedIn, loadManagedModels, loadInboxNotifications]);

  const runtimeModels = useMemo(
    () => buildRuntimeModels(runtime, agents, projects, tasks, sessions),
    [runtime, agents, projects, tasks, sessions],
  );
  const activeModels = managedModels.length > 0 ? managedModels : runtimeModels;

  const refreshAllData = useCallback(async () => {
    await Promise.all([refresh(), loadManagedModels(), loadInboxNotifications()]);
  }, [refresh, loadManagedModels, loadInboxNotifications]);

  syncRuntimeCollections({
    models: activeModels,
    agents,
    projects,
    tasks,
    sessions,
  });

  const toRelativeLabel = (dateInput: string | Date | null | undefined): string => {
    if (!dateInput) return '刚刚';
    const timestamp = new Date(dateInput).getTime();
    if (!Number.isFinite(timestamp)) return '刚刚';
    const diffMs = Date.now() - timestamp;
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    return `${Math.floor(hours / 24)} 天前`;
  };

  const fallbackNotifications = useMemo(() => {
    const items: Array<{
      id: string;
      title: string;
      content: string;
      time: string;
      type: 'info' | 'success' | 'warning';
      read: boolean;
      sourceKey?: string;
      to?: string;
    }> = [];

    tasks
      .filter((task) => task.status === 'Blocked')
      .slice(0, 2)
      .forEach((task) => {
        items.push({
          id: `task-blocked-${task.id}`,
          sourceKey: `task-blocked-${task.id}`,
          title: '任务阻塞提醒',
          content: `${task.agent || '系统'} 的任务「${task.title}」当前处于阻塞状态，请及时处理。`,
          time: toRelativeLabel(task.updatedAt || task.createdAt),
          type: 'warning',
          read: false,
          to: task.projectId ? `/projects/${task.projectId}` : '/projects',
        });
      });

    projects
      .filter((project) => project.status === 'At Risk' || project.status === 'Blocked')
      .slice(0, 2)
      .forEach((project) => {
        items.push({
          id: `project-risk-${project.id}`,
          sourceKey: `project-risk-${project.id}`,
          title: '项目风险预警',
          content: `项目「${project.name}」状态为 ${project.status}，建议优先复盘关键依赖。`,
          time: toRelativeLabel(project.updatedAt),
          type: 'warning',
          read: false,
          to: `/projects/${project.id}`,
        });
      });

    sessions.slice(0, 2).forEach((session) => {
      const agent = agents.find((item) => item.id === session.agentId);
      const project = projects.find((item) => item.id === session.projectId);
      items.push({
        id: `session-${session.id}`,
        sourceKey: `session-${session.id}`,
        title: session.status === 'active' ? '会话进行中' : '会话状态更新',
        content: `${agent?.name || 'Agent'} 正在处理 ${project?.name || '项目任务'}。`,
        time: toRelativeLabel(session.updatedAt || session.startTime),
        type: session.status === 'active' ? 'info' : 'success',
        read: false,
        to: agent?.id ? `/agents/${agent.id}` : '/monitoring',
      });
    });

    if (items.length === 0) {
      items.push({
        id: 'system-normal',
        title: '系统状态',
        content: '当前未检测到新的风险或阻塞事件。',
        time: '刚刚',
        type: 'info',
        read: false,
        to: '/dashboard',
      });
    }

    return items.slice(0, 6);
  }, [tasks, projects, sessions, agents]);

  const notifications = useMemo(() => {
    if (inboxNotifications.length === 0) {
      return fallbackNotifications;
    }
    return inboxNotifications
      .slice(0, 8)
      .map((item) => ({
        id: item.id || item.sourceKey,
        sourceKey: item.sourceKey,
        title: item.title,
        content: item.detail,
        time: toRelativeLabel(item.timestamp || item.updatedAt),
        read: Boolean(item.read),
        type: (item.severity === 'critical' || item.severity === 'warning' ? 'warning' : 'info') as 'info' | 'success' | 'warning',
        to: item.to,
      }));
  }, [inboxNotifications, fallbackNotifications]);

  const unreadNotificationCount = notifications.filter((item) => !('read' in item) || !item.read).length;

  const handleMarkAllNotificationsRead = async () => {
    if (inboxNotifications.length === 0) {
      addToast('当前没有可标记的通知', 'info');
      return;
    }
    const pending = inboxNotifications.filter((item) => !item.read);
    if (pending.length === 0) {
      addToast('通知已全部为已读状态', 'info');
      return;
    }

    setMarkingAllRead(true);
    try {
      await Promise.all(
        pending.map((item) =>
          notificationsApi.updateInbox(item.sourceKey, { read: true, workflowStatus: 'acknowledged' }),
        ),
      );
      await loadInboxNotifications();
      addToast('已全部标为已读', 'success');
    } catch (error) {
      addToast(`标记失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setMarkingAllRead(false);
    }
  };

  const handleNotificationClick = async (notification: {
    sourceKey?: string;
    to?: string;
    read?: boolean;
  }) => {
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
    } else {
      setActiveTab('dashboard');
    }

    if (notification.sourceKey && !notification.read) {
      try {
        await notificationsApi.updateInbox(notification.sourceKey, {
          read: true,
          workflowStatus: 'acknowledged',
        });
        await loadInboxNotifications();
      } catch {
        // ignore notification state update errors on navigation click
      }
    }
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

  if (authLoading || isInitialized === null || isLoggedIn === null) {
    return (
      <div className="h-screen w-full bg-surface flex items-center justify-center p-6 bg-[radial-gradient(circle_at_50%_50%,rgba(0,242,255,0.05),transparent_70%)]">
        <div className="max-w-md w-full bg-surface-soft border border-border-subtle rounded-3xl p-8 space-y-6 shadow-2xl text-center">
          <div className="w-14 h-14 mx-auto bg-primary/10 rounded-2xl flex items-center justify-center text-primary">
            <Activity size={28} />
          </div>
          <h1 className="text-xl font-bold text-white">正在验证系统状态</h1>
          <p className="text-sm text-slate-400">请稍候，正在连接认证服务...</p>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
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
    );
  }

  if (!isLoggedIn) {
    return (
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
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-surface text-slate-200 font-sans antialiased">
      {/* Sidebar / Rail Consolidated */}
      <motion.aside 
        initial={false}
        animate={{ width: sidebarOpen ? 240 : 64 }}
        className="border-r border-border-subtle flex flex-col shrink-0 bg-surface z-30 relative"
      >
        {/* Logo Area */}
        <div className="p-4 flex items-center gap-4 h-16 border-b border-border-subtle/50">
          <div 
            className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center text-primary cursor-pointer hover:scale-105 transition-transform shrink-0" 
            onClick={() => setActiveTab('dashboard')}
          >
            <Zap size={24} fill="currentColor" />
          </div>
          {sidebarOpen && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col"
            >
              <h2 className="text-xs font-bold text-white uppercase tracking-widest leading-none">Aegis OS</h2>
              <span className="text-[8px] text-slate-500 font-bold uppercase tracking-tighter mt-1">Command Center</span>
            </motion.div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-6 space-y-2 overflow-y-auto scrollbar-hide">
          <NavItem 
            icon={LayoutDashboard} 
            label="概览" 
            active={activeTab === 'dashboard'} 
            onClick={() => setActiveTab('dashboard')} 
            collapsed={!sidebarOpen}
          />
          <NavItem 
            icon={Briefcase} 
            label="项目组合" 
            active={activeTab === 'projects' || activeTab === 'project-room'} 
            onClick={() => setActiveTab('projects')} 
            collapsed={!sidebarOpen}
          />
          <NavItem 
            icon={Users} 
            label="Agent 名册" 
            active={activeTab === 'agents' || activeTab === 'agent-commander'} 
            onClick={() => setActiveTab('agents')} 
            collapsed={!sidebarOpen}
          />
          <NavItem 
            icon={Layers} 
            label="模型中心" 
            active={activeTab === 'model-nexus'} 
            onClick={() => setActiveTab('model-nexus')} 
            collapsed={!sidebarOpen}
          />
          <NavItem 
            icon={Terminal} 
            label="实时监控" 
            active={activeTab === 'monitoring'} 
            onClick={() => setActiveTab('monitoring')} 
            collapsed={!sidebarOpen}
          />
          <NavItem 
            icon={Globe} 
            label="工作区" 
            active={activeTab === 'workspace'} 
            onClick={() => setActiveTab('workspace')} 
            collapsed={!sidebarOpen}
          />
          
          <div className="py-4">
            <div className={cn("h-px bg-border-subtle/50 mx-2", !sidebarOpen && "mx-1")} />
          </div>

          <NavItem 
            icon={Activity} 
            label="系统运行" 
            active={activeTab === 'system-health'} 
            onClick={() => setActiveTab('system-health')} 
            collapsed={!sidebarOpen}
          />
          <NavItem 
            icon={History} 
            label="审计追踪" 
            active={activeTab === 'audit'} 
            onClick={() => setActiveTab('audit')} 
            collapsed={!sidebarOpen}
          />
          <NavItem 
            icon={Settings} 
            label="设置" 
            active={activeTab === 'settings'} 
            onClick={() => setActiveTab('settings')} 
            collapsed={!sidebarOpen}
          />
        </nav>

        {/* Footer / Profile */}
        <div className="p-4 border-t border-border-subtle bg-white/5">
          <div className={cn("flex items-center gap-3", !sidebarOpen && "justify-center")}>
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-accent to-primary p-0.5 cursor-pointer group relative shrink-0">
              <div className="w-full h-full rounded-full bg-surface flex items-center justify-center text-[10px] font-bold">ME</div>
              {!sidebarOpen && (
                <div className="absolute left-12 top-0 bg-surface-muted border border-border-subtle px-2 py-1 rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                  merypto2025@gmail.com
                </div>
              )}
            </div>
            {sidebarOpen && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex-1 min-w-0"
              >
                <p className="text-[10px] font-bold text-white truncate">merypto2025</p>
                <p className="text-[8px] text-slate-500 truncate">系统管理员</p>
              </motion.div>
            )}
            {sidebarOpen && (
              <button onClick={handleLogout} className="text-slate-500 hover:text-danger transition-colors ml-auto" title="退出登录">
                <LogOut size={16} />
              </button>
            )}
            {sidebarOpen && (
              <button onClick={() => setSidebarOpen(false)} className="text-slate-500 hover:text-white transition-colors ml-2">
                <ChevronLeft size={16} />
              </button>
            )}
          </div>
        </div>
      </motion.aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-surface relative">
        {/* Topbar */}
        <header className="h-16 border-b border-border-subtle flex items-center justify-between px-6 shrink-0 bg-surface/50 backdrop-blur-md z-10">
          <div className="flex items-center gap-4">
            {!sidebarOpen && (
              <button onClick={() => setSidebarOpen(true)} className="p-2 bg-white/5 border border-border-subtle rounded-lg text-slate-500 hover:text-white transition-colors">
                <ChevronRight size={16} />
              </button>
            )}
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="hover:text-slate-300 cursor-pointer">工作区</span>
              <ChevronRight size={12} />
              <span className="text-slate-300 font-medium capitalize">{
                activeTab === 'dashboard' ? '仪表盘' :
                activeTab === 'agent-commander' ? 'Agent 指挥官' :
                activeTab === 'project-room' ? '项目室' :
                activeTab === 'system-health' ? '系统运行' :
                activeTab === 'monitoring' ? '实时监控' :
                activeTab === 'projects' ? '项目组合' :
                activeTab === 'agents' ? 'Agent 名册' :
                activeTab === 'workspace' ? 'OpenClaw 工作区' :
                activeTab === 'audit' ? '审计追踪' :
                activeTab === 'settings' ? '设置' : activeTab.replace('-', ' ')
              }</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative hidden md:block">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input 
                type="text" 
                placeholder="搜索任何内容... (⌘K)"
                className="bg-white/5 border border-border-subtle rounded-lg pl-9 pr-4 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 w-64 transition-all focus:w-80"
              />
            </div>
            <div className="relative">
              <button 
                onClick={() => setShowNotifications(!showNotifications)}
                className={cn("p-2 text-slate-500 hover:text-white relative transition-colors", showNotifications && "text-white")}
              >
                <Bell size={18} />
                {unreadNotificationCount > 0 && (
                  <div className="absolute top-2 right-2 w-2 h-2 bg-danger rounded-full border-2 border-surface" />
                )}
              </button>
              
              <AnimatePresence>
                {showNotifications && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowNotifications(false)} />
                    <motion.div 
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute right-0 mt-2 w-80 bg-surface-soft border border-border-subtle rounded-2xl shadow-2xl z-50 overflow-hidden"
                    >
                      <div className="px-4 py-3 border-b border-border-subtle bg-white/5 flex justify-between items-center">
                        <h3 className="text-xs font-bold text-white uppercase tracking-widest">通知中心</h3>
                        <button
                          className="text-[10px] text-primary hover:underline disabled:opacity-60"
                          onClick={() => void handleMarkAllNotificationsRead()}
                          disabled={markingAllRead || notificationsLoading}
                        >
                          {markingAllRead ? '处理中...' : '全部已读'}
                        </button>
                      </div>
                      <div className="max-h-96 overflow-y-auto divide-y divide-border-subtle">
                        {notificationsLoading && (
                          <div className="p-4 text-[10px] text-slate-500">正在加载通知...</div>
                        )}
                        {notifications.map((n) => (
                          <div
                            key={n.id}
                            onClick={() => void handleNotificationClick(n)}
                            className={cn(
                              "p-4 hover:bg-white/5 transition-colors cursor-pointer",
                              n.read ? "opacity-75" : "opacity-100",
                            )}
                          >
                            <div className="flex justify-between items-start mb-1">
                              <div className="flex items-center gap-2">
                                {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
                                <h4 className="text-xs font-bold text-white">{n.title}</h4>
                              </div>
                              <span className="text-[8px] text-slate-500 uppercase tracking-widest">{n.time}</span>
                            </div>
                            <p className="text-[10px] text-slate-400 leading-relaxed">{n.content}</p>
                          </div>
                        ))}
                      </div>
                      <div className="px-4 py-2 border-t border-border-subtle bg-white/5 text-center">
                        <button
                          className="text-[10px] font-bold text-slate-500 hover:text-white transition-colors uppercase tracking-widest"
                          onClick={() => {
                            setShowNotifications(false);
                            setActiveTab('audit');
                          }}
                        >
                          查看历史通知
                        </button>
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
            <div className="h-6 w-px bg-border-subtle" />
            <div className="flex items-center gap-2">
              <button className="px-2 py-1 bg-white/5 border border-border-subtle rounded text-[10px] font-bold text-slate-400 hover:text-white transition-colors">
                CN
              </button>
              <button onClick={() => void handleLogout()} className="p-2 text-slate-500 hover:text-danger transition-colors">
                <LogOut size={18} />
              </button>
            </div>
          </div>
        </header>

        {/* Dynamic Page Content */}
        <div className="flex-1 overflow-auto scrollbar-hide">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="h-full"
            >
              {activeTab === 'dashboard' && <Dashboard onNavigate={handleNavigate} onSelectProject={handleSelectProject} onSelectAgent={handleSelectAgent} addToast={addToast} onOpenNewProject={() => setIsNewProjectOpen(true)} onOpenDecisionCenter={() => setIsDecisionCenterOpen(true)} />}
              {activeTab === 'agent-commander' && <AgentCommander agentId={selectedAgentId} addToast={addToast} sendCommand={sendAgentMessage} />}
              {activeTab === 'project-room' && <ProjectRoom projectId={selectedProjectId} addToast={addToast} onNavigate={handleNavigate} onRefreshData={refreshAllData} />}
              {activeTab === 'system-health' && <SystemOperations onNavigate={handleNavigate} addToast={addToast} onRefreshData={refreshAllData} />}
              {activeTab === 'model-nexus' && <ModelNexus addToast={addToast} onOpenNewModel={() => setIsNewModelOpen(true)} onRefreshData={refreshAllData} />}
              {activeTab === 'monitoring' && <RealTimeMonitoring addToast={addToast} onNavigate={handleNavigate} />}
              {activeTab === 'projects' && <ProjectsPortfolio onSelectProject={handleSelectProject} addToast={addToast} onOpenNewProject={() => setIsNewProjectOpen(true)} />}
              {activeTab === 'agents' && <AgentsRoster onSelectAgent={handleSelectAgent} addToast={addToast} onOpenTopology={() => setIsTopologyOpen(true)} onOpenDeploy={() => setIsDeployOpen(true)} onOpenConfig={(id: string) => { setSelectedAgentId(id); setIsAgentConfigOpen(true); }} />}
              {activeTab === 'workspace' && <OpenClawWorkspace addToast={addToast} workspace={workspace} onRefreshData={refreshAllData} onNavigate={handleNavigate} />}
              {activeTab === 'audit' && <AuditLogs />}
              {activeTab === 'settings' && <SettingsPage addToast={addToast} onRuntimeUpdated={refreshAllData} />}
            </motion.div>
          </AnimatePresence>
        </div>
        <ToastContainer toasts={toasts} />

        {/* Modals */}
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
          {isNewProjectOpen && <NewProjectModal isOpen={isNewProjectOpen} onClose={() => setIsNewProjectOpen(false)} addToast={addToast} onProjectCreated={() => { void refreshAllData(); }} />}
          {isDecisionCenterOpen && <DecisionCenterModal isOpen={isDecisionCenterOpen} onClose={() => setIsDecisionCenterOpen(false)} addToast={addToast} />}
        </AnimatePresence>
      </div>
    </div>
  );
}
