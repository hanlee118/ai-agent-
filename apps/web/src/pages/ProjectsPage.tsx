import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, BarChart3, Briefcase, ChevronDown, Filter, Pause, Play, Plus, SkipForward, Trash2, XCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { agents, projects } from '../lib/runtimeCollections';
import { projectsApi } from '../lib/api';
import { Badge } from './impl/GovernanceShared';

type Props = {
  onSelectProject: (id: string) => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onOpenNewProject: () => void;
  onRefreshData: () => Promise<void>;
};

type AutomationState = {
  enabled: boolean;
  intervalMs: number;
  running: boolean;
  lastRunAt: string | null;
  lastError: string | null;
  lastSummary: string;
};

export default function ProjectsPage({ onSelectProject, addToast, onOpenNewProject, onRefreshData }: Props) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'development' | 'planning' | 'blocked'>('all');
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [automation, setAutomation] = useState<AutomationState | null>(null);
  const [automationLoading, setAutomationLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadAutomation = async () => {
      try {
        const state = await projectsApi.getAutomation();
        if (!cancelled) {
          setAutomation(state);
        }
      } catch {
        if (!cancelled) {
          setAutomation(null);
        }
      }
    };
    void loadAutomation();
    return () => {
      cancelled = true;
    };
  }, []);

  const runProjectAction = async (projectId: string, action: 'pause' | 'resume' | 'advance' | 'close' | 'delete') => {
    const key = `${projectId}:${action}`;
    setActionKey(key);
    try {
      if (action === 'pause') {
        await projectsApi.intervene(projectId, '用户手动暂停项目');
        addToast('项目已暂停', 'info');
      } else if (action === 'resume') {
        await projectsApi.resume(projectId);
        addToast('项目已恢复执行', 'success');
      } else if (action === 'advance') {
        await projectsApi.advance(projectId);
        addToast('项目已手动推进一步', 'success');
      } else if (action === 'close') {
        await projectsApi.close(projectId);
        addToast('项目已关闭', 'success');
      } else {
        const confirmed = window.confirm('确认删除该项目？删除后不可恢复。');
        if (!confirmed) {
          return;
        }
        await projectsApi.remove(projectId);
        addToast('项目已删除', 'success');
      }
      await onRefreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败';
      addToast(message, 'error');
    } finally {
      setActionKey(null);
    }
  };

  const toggleAutomation = async () => {
    if (!automation) {
      return;
    }
    setAutomationLoading(true);
    try {
      const updated = await projectsApi.setAutomation({ enabled: !automation.enabled });
      setAutomation(updated);
      addToast(updated.enabled ? '已开启自动推进' : '已关闭自动推进', 'info');
      await onRefreshData();
    } catch (error) {
      addToast(error instanceof Error ? error.message : '自动推进设置失败', 'error');
    } finally {
      setAutomationLoading(false);
    }
  };

  const runAutomationOnce = async () => {
    setAutomationLoading(true);
    try {
      const updated = await projectsApi.runAutomationOnce();
      setAutomation(updated);
      addToast(`已执行一轮自动推进: ${updated.lastSummary || '完成'}`, 'info');
      await onRefreshData();
    } catch (error) {
      addToast(error instanceof Error ? error.message : '手动推进执行失败', 'error');
    } finally {
      setAutomationLoading(false);
    }
  };

  const avgProgress = projects.length > 0
    ? Math.round(projects.reduce((sum, project) => sum + (project.progress || 0), 0) / projects.length)
    : 0;
  const activeRisks = projects.filter((project) => project.status === 'At Risk' || project.status === 'Blocked').length;
  const filteredProjects = useMemo(() => {
    if (statusFilter === 'all') {
      return projects;
    }

    if (statusFilter === 'development') {
      return projects.filter((project) => project.status === 'Development' || /开发|执行|进行/.test(project.phase || ''));
    }

    if (statusFilter === 'planning') {
      return projects.filter((project) => project.status === 'Planning' || /规划|分析|准备/.test(project.phase || ''));
    }

    return projects.filter((project) =>
      project.status === 'Blocked'
      || project.status === 'At Risk'
      || /风险|阻塞/.test(project.phase || ''),
    );
  }, [statusFilter, projects]);

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
          <button
            type="button"
            onClick={() => void runAutomationOnce()}
            disabled={automationLoading}
            className={cn(
              'px-4 py-2 rounded-lg text-xs font-semibold border transition-colors',
              'bg-primary/15 text-primary border-primary/30 hover:bg-primary/20',
              automationLoading && 'opacity-60 cursor-not-allowed',
            )}
            title="立即执行一轮自动推进"
          >
            立即执行一轮
          </button>
          <button
            type="button"
            onClick={() => void toggleAutomation()}
            disabled={automationLoading}
            className={cn(
              'px-4 py-2 rounded-lg text-xs font-semibold border transition-colors',
              automation?.enabled
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'
                : 'bg-white/5 text-slate-300 border-border-subtle hover:bg-white/10',
              automationLoading && 'opacity-60 cursor-not-allowed',
            )}
            title={automation?.lastSummary || '自动推进'}
          >
            自动推进: {automation?.enabled ? '开启' : '关闭'}
          </button>
          <div className="relative">
            <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <select
              value={statusFilter}
              onChange={(event) => {
                const next = event.target.value as 'all' | 'development' | 'planning' | 'blocked';
                setStatusFilter(next);
                addToast('过滤条件已更新', 'info');
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
          <button onClick={onOpenNewProject} className="px-4 py-2 bg-primary text-surface hover:bg-primary/90 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2">
            <Plus size={16} />
            创建项目
          </button>
        </div>
      </header>

      {automation ? (
        <div className="bg-surface-soft border border-border-subtle rounded-2xl p-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
          <span className="text-slate-400">最近执行: {automation.lastRunAt ? new Date(automation.lastRunAt).toLocaleString('zh-CN') : '暂无'}</span>
          <span className="text-slate-400">执行摘要: {automation.lastSummary || '暂无'}</span>
          <span className={cn('font-medium', automation.lastError ? 'text-danger' : 'text-emerald-300')}>
            {automation.lastError ? `最近错误: ${automation.lastError}` : '最近执行无错误'}
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {stats.map((stat, i) => (
          <div key={i} className="bg-surface-soft border border-border-subtle p-6 rounded-2xl flex items-center gap-4">
            <div className={cn('p-3 rounded-xl bg-white/5', stat.color)}>
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
              {filteredProjects.map((project) => (
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
                    <Badge variant={project.status === 'Blocked' ? 'danger' : project.status === 'At Risk' ? 'warning' : project.status === 'Planning' ? 'accent' : 'primary'}>
                      {project.status}
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
                    <div className="flex -space-x-2">
                      {(project.agents || []).slice(0, 3).map((agentId: string, i: number) => (
                        <div key={`${project.id}-${agentId}-${i}`} className="w-6 h-6 rounded-full border-2 border-surface-soft bg-surface-muted flex items-center justify-center text-[8px] font-bold">
                          {agents.find((agent) => agent.id === agentId)?.name?.charAt(0) || `A${i + 1}`}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2" onClick={(event) => event.stopPropagation()}>
                      <button
                        type="button"
                        className="px-2 py-1 text-[11px] rounded-md bg-white/5 text-slate-300 hover:bg-white/10"
                        onClick={() => void runProjectAction(project.id, 'pause')}
                        disabled={actionKey === `${project.id}:pause`}
                        title="暂停项目"
                      >
                        <Pause size={12} />
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 text-[11px] rounded-md bg-white/5 text-slate-300 hover:bg-white/10"
                        onClick={() => void runProjectAction(project.id, 'resume')}
                        disabled={actionKey === `${project.id}:resume`}
                        title="恢复项目"
                      >
                        <Play size={12} />
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 text-[11px] rounded-md bg-primary/15 text-primary hover:bg-primary/25"
                        onClick={() => void runProjectAction(project.id, 'advance')}
                        disabled={
                          actionKey === `${project.id}:advance`
                          || project.status === 'Completed'
                          || project.status === 'Blocked'
                        }
                        title="推进一步"
                      >
                        <SkipForward size={12} />
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 text-[11px] rounded-md bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                        onClick={() => void runProjectAction(project.id, 'close')}
                        disabled={actionKey === `${project.id}:close`}
                        title="关闭项目"
                      >
                        <XCircle size={12} />
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 text-[11px] rounded-md bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                        onClick={() => void runProjectAction(project.id, 'delete')}
                        disabled={actionKey === `${project.id}:delete`}
                        title="删除项目"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredProjects.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-slate-500 text-sm">当前筛选条件下暂无项目数据</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
