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


export default ProjectRoom;
