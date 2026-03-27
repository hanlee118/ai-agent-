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
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
  AreaChart, Area, ReferenceLine,
} from 'recharts';
import { cn } from '../lib/utils';
import { Agent, Project, Task, Session, AgentStatus, ProjectStatus, Model } from '../types';
import AuditTable from '../features/audit/AuditTable';
import { useAuditLogs } from '../features/audit/useAuditLogs';
import { useAuditSearch } from '../features/audit/useAuditSearch';
import SettingsPanel from '../features/settings/SettingsPanel';
import AgentConfigModalPanel from '../features/agent-config/AgentConfigModal';
import DeployAgentModalPanel from '../features/deploy-agent/DeployAgentModal';
import {
  agentsApi,
  auditApi,
  modelsApi,
  projectsApi,
  systemApi,
  type Model as ApiModel,
} from '../lib/api';
import { fetchOpenClawAgentDetail, sendBatchAgentMessage } from '../lib/adapters';
import { agents, models, projects, sessions, tasks } from '../lib/runtimeCollections';

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


export default Dashboard;
