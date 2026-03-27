import React, { useMemo, useState } from 'react';
import { AlertCircle, BarChart3, Briefcase, ChevronDown, Filter, MoreVertical, Plus } from 'lucide-react';
import { cn } from '../lib/utils';
import { agents, projects } from '../lib/runtimeCollections';
import { Badge } from './impl/GovernanceShared';

type Props = {
  onSelectProject: (id: string) => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onOpenNewProject: () => void;
};

export default function ProjectsPage({ onSelectProject, addToast, onOpenNewProject }: Props) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'development' | 'planning' | 'blocked'>('all');
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
                    <button className="p-2 text-slate-500 hover:text-white transition-colors">
                      <MoreVertical size={16} />
                    </button>
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
