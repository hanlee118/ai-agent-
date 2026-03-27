import React, { useMemo } from 'react';
import { Activity, Briefcase, Cpu, Plus, Users, Zap } from 'lucide-react';
import type { Agent, Model, Project, Task } from '../types';

export interface DashboardLazyProps {
  onNavigate: (tab: string, id?: string) => void;
  onSelectProject: (id: string) => void;
  onSelectAgent: (id: string) => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onOpenNewProject: () => void;
  onOpenDecisionCenter: () => void;
  projects: Project[];
  agents: Agent[];
  tasks: Task[];
  models: Model[];
}

function Card({ title, value, hint, onClick }: { title: string; value: string; hint: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-left bg-surface-soft border border-border-subtle rounded-2xl p-5 hover:border-white/20 transition-colors"
    >
      <p className="text-xs text-slate-400">{title}</p>
      <p className="text-2xl font-bold text-white mt-1">{value}</p>
      <p className="text-[11px] text-slate-500 mt-2">{hint}</p>
    </button>
  );
}

export default function DashboardLazy({
  onNavigate,
  onSelectProject,
  onSelectAgent,
  addToast,
  onOpenNewProject,
  onOpenDecisionCenter,
  projects,
  agents,
  tasks,
  models,
}: DashboardLazyProps) {
  const activeProjects = useMemo(() => projects.filter((item) => item.status !== 'Completed').length, [projects]);
  const workingAgents = useMemo(() => agents.filter((item) => item.status !== 'Idle' && item.status !== 'Offline').length, [agents]);
  const pendingDecisions = useMemo(() => tasks.filter((item) => item.status === 'Blocked' || item.status === 'Pending').length, [tasks]);
  const dailyCost = useMemo(() => models.reduce((sum, item) => sum + item.dailyTokens * 0.00001, 0), [models]);

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-white">控制面板</h1>
          <p className="text-sm text-slate-400 mt-1">实时查看项目进度、Agent 状态和关键决策。</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onOpenDecisionCenter}
            className="px-4 py-2 rounded-xl bg-white/5 border border-border-subtle text-sm text-slate-200 hover:bg-white/10 transition-colors"
          >
            打开决策中心
          </button>
          <button
            onClick={onOpenNewProject}
            className="px-4 py-2 rounded-xl bg-primary text-surface text-sm font-semibold hover:bg-primary/90 transition-colors inline-flex items-center gap-2"
          >
            <Plus size={14} />
            新建项目
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card title="活跃项目" value={String(activeProjects)} hint="点击进入项目组合" onClick={() => onNavigate('projects')} />
        <Card title="Agent 负载" value={`${workingAgents}/${agents.length}`} hint="点击查看 Agent 名册" onClick={() => onNavigate('agents')} />
        <Card title="待处理决策" value={String(pendingDecisions)} hint="点击进入决策中心" onClick={onOpenDecisionCenter} />
        <Card title="每日成本" value={`$${dailyCost.toFixed(2)}`} hint="点击查看模型中心" onClick={() => onNavigate('model-nexus')} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 bg-surface-soft border border-border-subtle rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2 text-white font-semibold">
            <Briefcase size={16} className="text-primary" />
            项目进展
          </div>
          <div className="space-y-3">
            {projects.slice(0, 6).map((project) => (
              <button
                key={project.id}
                onClick={() => onSelectProject(project.id)}
                className="w-full text-left px-4 py-3 rounded-xl bg-white/5 border border-border-subtle hover:border-primary/30 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-white">{project.name}</p>
                  <span className="text-xs text-slate-400">{project.progress}%</span>
                </div>
                <div className="mt-2 h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, project.progress))}%` }} />
                </div>
              </button>
            ))}
            {projects.length === 0 && <p className="text-sm text-slate-500">暂无项目数据</p>}
          </div>
        </section>

        <section className="bg-surface-soft border border-border-subtle rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2 text-white font-semibold">
            <Users size={16} className="text-accent" />
            Agent 状态
          </div>
          <div className="space-y-2">
            {agents.slice(0, 8).map((agent) => (
              <button
                key={agent.id}
                onClick={() => onSelectAgent(agent.id)}
                className="w-full text-left px-3 py-2.5 rounded-lg bg-white/5 border border-border-subtle hover:border-white/20 transition-colors"
              >
                <div className="flex justify-between items-center gap-2">
                  <span className="text-sm text-white">{agent.name}</span>
                  <span className="text-[11px] text-slate-400">{agent.status}</span>
                </div>
              </button>
            ))}
            {agents.length === 0 && <p className="text-sm text-slate-500">暂无 Agent 数据</p>}
          </div>
        </section>
      </div>

      <section className="bg-surface-soft border border-border-subtle rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="text-sm font-semibold text-white inline-flex items-center gap-2">
            <Activity size={15} className="text-warning" />
            任务看板
          </h2>
          <button
            onClick={() => addToast('看板已刷新', 'success')}
            className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-border-subtle text-slate-300 hover:bg-white/10 transition-colors"
          >
            刷新
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="rounded-xl bg-white/5 border border-border-subtle p-3">
            <p className="text-slate-500 inline-flex items-center gap-1"><Zap size={12} /> 待处理</p>
            <p className="text-xl font-bold text-white mt-1">{tasks.filter((task) => task.status === 'Pending').length}</p>
          </div>
          <div className="rounded-xl bg-white/5 border border-border-subtle p-3">
            <p className="text-slate-500 inline-flex items-center gap-1"><Cpu size={12} /> 进行中</p>
            <p className="text-xl font-bold text-white mt-1">{tasks.filter((task) => task.status === 'In Progress').length}</p>
          </div>
          <div className="rounded-xl bg-white/5 border border-border-subtle p-3">
            <p className="text-slate-500 inline-flex items-center gap-1"><Activity size={12} /> 已完成</p>
            <p className="text-xl font-bold text-white mt-1">{tasks.filter((task) => task.status === 'Completed').length}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
