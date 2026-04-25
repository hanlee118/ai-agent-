import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, BarChart3, Briefcase, ChevronDown, Filter, Pause, Play, Plus, SkipForward, Trash2, XCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { agents, projects } from '../lib/runtimeCollections';
import { ApiRequestError, projectsApi, type ProjectCleanupCandidate, type ProjectRequiredAction } from '../lib/api';
import { Badge } from './impl/GovernanceShared';
import SurfaceModal from './impl/SurfaceModal';

type Props = {
  recentProjectId?: string | null;
  onSelectProject: (id: string) => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onOpenNewProject: () => void;
  onRefreshData: () => Promise<void>;
};

type AutomationState = {
  enabled: boolean;
  autoApproveWhenReady: boolean;
  intervalMs: number;
  running: boolean;
  lastRunAt: string | null;
  lastError: string | null;
  lastSummary: string;
};

export default function ProjectsPage({ recentProjectId = null, onSelectProject, addToast, onOpenNewProject, onRefreshData }: Props) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'Planning' | 'Development' | 'Testing' | 'Completed' | 'Blocked' | 'At Risk'>('all');
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [automation, setAutomation] = useState<AutomationState | null>(null);
  const [automationLoading, setAutomationLoading] = useState(false);
  const [isCleanupCenterOpen, setIsCleanupCenterOpen] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [repairIssueRunning, setRepairIssueRunning] = useState(false);
  const [cleanupCandidates, setCleanupCandidates] = useState<ProjectCleanupCandidate[]>([]);
  const [selectedCleanupIds, setSelectedCleanupIds] = useState<string[]>([]);
  const [cleanupMode, setCleanupMode] = useState<'candidates' | 'all'>('candidates');

  const formatRequiredActionsHint = (actions: ProjectRequiredAction[]) => {
    if (actions.length === 0) {
      return '请先打开项目详情完成待补充事项。';
    }
    const head = actions.slice(0, 2).map((item) => item.title).join('；');
    return actions.length > 2 ? `${head} 等 ${actions.length} 项` : head;
  };

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
        addToast('正在推进项目阶段，可能需要 1-3 分钟，请稍候...', 'info');
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
      if (error instanceof ApiRequestError && error.code === 'REQUIRES_USER_INTERVENTION') {
        const requiredActions = Array.isArray(error.details?.requiredActions)
          ? (error.details?.requiredActions as ProjectRequiredAction[])
          : [];
        addToast(error.message || '需要你先补充关键信息后才能继续推进', 'info');
        addToast(`待处理事项: ${formatRequiredActionsHint(requiredActions)}`, 'info');
        onSelectProject(projectId);
      } else if (error instanceof ApiRequestError && error.code === 'PROJECT_ADVANCE_IN_PROGRESS') {
        const pollAfterMs = Number((error.details as { pollAfterMs?: unknown } | undefined)?.pollAfterMs ?? 0);
        const pollAfterSeconds = pollAfterMs > 0 ? Math.max(1, Math.ceil(pollAfterMs / 1000)) : 2;
        addToast(error.message || '项目正在后台推进中，请稍后刷新。', 'info');
        addToast(`建议约 ${pollAfterSeconds} 秒后刷新项目状态`, 'info');
        window.setTimeout(() => {
          void onRefreshData();
        }, Math.max(800, pollAfterMs || 2000));
      } else if (
        error instanceof ApiRequestError
        && (error.code === 'PROJECT_ISSUE_FIRST_REQUIRED' || error.code === 'LOCAL_ISSUE_REQUIRED')
      ) {
        addToast(error.message || '该项目尚未绑定需求 Issue，请先完成 Issue 确认后再推进。', 'info');
        onSelectProject(projectId);
      } else if (error instanceof ApiRequestError && error.code === 'NO_PENDING_APPROVAL') {
        addToast(error.message || '当前没有待确认事项', 'info');
        await onRefreshData();
      } else {
        const message = error instanceof Error ? error.message : '操作失败';
        addToast(message, 'error');
      }
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
      const nextEnabled = !automation.enabled;
      const updated = await projectsApi.setAutomation({
        enabled: nextEnabled,
        // 自动推进开启时默认同步开启自动审批，避免停在 pendingApproval。
        autoApproveWhenReady: nextEnabled ? true : automation.autoApproveWhenReady,
      });
      setAutomation(updated);
      addToast(
        updated.enabled
          ? `已开启自动推进${updated.autoApproveWhenReady ? '（含自动审批）' : ''}`
          : '已关闭自动推进',
        'info',
      );
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
      addToast(
        updated.message
          || (updated.accepted === false ? '当前已有自动推进在运行，本次未重复触发' : '已触发一轮自动推进，请稍后查看结果'),
        'info',
      );
      // 后端为异步触发，延迟刷新两次，避免前端看到“尚未执行”的瞬时旧态。
      void onRefreshData();
      window.setTimeout(() => { void onRefreshData(); }, 2000);
      window.setTimeout(() => { void onRefreshData(); }, 12000);
    } catch (error) {
      addToast(error instanceof Error ? error.message : '手动推进执行失败', 'error');
    } finally {
      setAutomationLoading(false);
    }
  };

  const cleanupReasonLabel: Record<string, string> = {
    paused: '已暂停',
    test_like: '测试/验证项目',
    duplicate_name: '重复项目旧版本',
  };

  const recommendedCleanupIds = useMemo(
    () => cleanupCandidates.filter((item) => item.recommended).map((item) => item.id),
    [cleanupCandidates],
  );

  const loadCleanupCandidates = async () => {
    setCleanupLoading(true);
    try {
      const candidates = await projectsApi.getCleanupCandidates();
      setCleanupCandidates(candidates);
      setSelectedCleanupIds(candidates.filter((item) => item.recommended).map((item) => item.id));
    } catch (error) {
      addToast(error instanceof Error ? error.message : '加载清理候选失败', 'error');
    } finally {
      setCleanupLoading(false);
    }
  };

  const openCleanupCenter = async () => {
    setIsCleanupCenterOpen(true);
    setCleanupMode('candidates');
    await loadCleanupCandidates();
  };

  const toggleCleanupSelection = (id: string) => {
    setSelectedCleanupIds((prev) => (
      prev.includes(id)
        ? prev.filter((item) => item !== id)
        : [...prev, id]
    ));
  };

  const runCleanup = async () => {
    if (selectedCleanupIds.length === 0) {
      addToast('请先选择要清理的项目', 'info');
      return;
    }

    const confirmed = window.confirm(`确认删除选中的 ${selectedCleanupIds.length} 个项目？删除后不可恢复。`);
    if (!confirmed) {
      return;
    }

    setCleanupRunning(true);
    try {
      if (cleanupMode === 'candidates') {
        const result = await projectsApi.cleanupProjects({
          ids: selectedCleanupIds,
        });
        if (result.deleted.length > 0) {
          addToast(`清理完成：已删除 ${result.deleted.length} 个项目`, 'success');
        } else {
          addToast('未删除任何项目', 'info');
        }
        if (result.failed.length > 0) {
          addToast(`有 ${result.failed.length} 个项目删除失败`, 'error');
        }
      } else {
        const settled = await Promise.allSettled(
          selectedCleanupIds.map((id) => projectsApi.remove(id)),
        );
        const successCount = settled.filter((item) => item.status === 'fulfilled').length;
        const failedCount = settled.length - successCount;
        if (successCount > 0) {
          addToast(`批量删除完成：已删除 ${successCount} 个项目`, 'success');
        } else {
          addToast('未删除任何项目', 'info');
        }
        if (failedCount > 0) {
          addToast(`有 ${failedCount} 个项目删除失败`, 'error');
        }
      }
      await onRefreshData();
      await loadCleanupCandidates();
    } catch (error) {
      addToast(error instanceof Error ? error.message : '执行项目清理失败', 'error');
    } finally {
      setCleanupRunning(false);
    }
  };

  const runQualityGateRepairIssueGeneration = async (dryRun: boolean) => {
    if (selectedCleanupIds.length === 0) {
      addToast('请先选择要处理的项目', 'info');
      return;
    }

    const confirmed = dryRun || window.confirm(
      `将为选中的 ${selectedCleanupIds.length} 个项目按阻断阶段生成修复 issue，是否继续？`,
    );
    if (!confirmed) {
      return;
    }

    setRepairIssueRunning(true);
    try {
      const result = await projectsApi.generateBatchQualityGateRepairIssues({
        projectIds: selectedCleanupIds,
        includeHistorical: true,
        dryRun,
        limit: selectedCleanupIds.length,
      });
      const { totals } = result;
      if (dryRun) {
        addToast(
          `预览完成：${totals.withBlocking} 个项目存在阻断，合计 ${totals.blockingStages} 个阻断阶段`,
          'info',
        );
      } else {
        addToast(
          `修复 issue 生成完成：创建 ${totals.created}，复用 ${totals.reused}，失败 ${totals.failed}`,
          totals.failed > 0 ? 'error' : 'success',
        );
      }
      if (totals.failed > 0) {
        const failedProjects = result.projects
          .filter((item) => item.failed.length > 0)
          .slice(0, 2)
          .map((item) => `${item.projectName || item.projectId} 失败 ${item.failed.length} 项`)
          .join('；');
        if (failedProjects) {
          addToast(`失败项目：${failedProjects}`, 'error');
        }
      }
    } catch (error) {
      addToast(error instanceof Error ? error.message : '生成质量门禁修复 issue 失败', 'error');
    } finally {
      setRepairIssueRunning(false);
    }
  };

  const avgProgress = projects.length > 0
    ? Math.round(projects.reduce((sum, project) => sum + (project.progress || 0), 0) / projects.length)
    : 0;
  const activeRisks = projects.filter((project) => project.status === 'At Risk' || project.status === 'Blocked').length;
  const statusOptionLabels: Record<Exclude<typeof statusFilter, 'all'>, string> = {
    Planning: '规划中',
    Development: '开发中',
    Testing: '测试中',
    Completed: '已完成',
    Blocked: '阻塞',
    'At Risk': '风险中',
  };
  const filteredProjects = useMemo(() => {
    const sorted = [...projects].sort((left, right) => {
      const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime();
      const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime();
      return rightTime - leftTime;
    });
    if (statusFilter === 'all') {
      return sorted;
    }
    return sorted.filter((project) => project.status === statusFilter);
  }, [statusFilter, projects]);

  const getActionState = (project: (typeof projects)[number]) => {
    const isBlocked = project.status === 'Blocked';
    const isCompleted = project.status === 'Completed';
    const permissions = (project as { permissions?: { canApprove?: boolean; canDelete?: boolean } }).permissions;
    const canApprove = typeof permissions?.canApprove === 'boolean' ? permissions.canApprove : true;
    const canDelete = typeof permissions?.canDelete === 'boolean' ? permissions.canDelete : true;
    return {
      canPause: !isBlocked && !isCompleted,
      canResume: isBlocked,
      canAdvance: !isBlocked && !isCompleted && canApprove,
      canClose: !isCompleted,
      canDelete,
    };
  };

  const cleanupRows = useMemo(() => {
    if (cleanupMode === 'candidates') {
      return cleanupCandidates.map((item) => ({
        id: item.id,
        name: item.name,
        status: item.status,
        stage: item.currentStage,
        updatedAt: item.updatedAt,
        reasons: item.reasons,
        recommended: item.recommended,
      }));
    }
    return projects.map((project) => ({
      id: project.id,
      name: project.name,
      status: project.status,
      stage: project.phase || '-',
      updatedAt: project.updatedAt || new Date().toISOString(),
      reasons: [] as string[],
      recommended: false,
    }));
  }, [cleanupCandidates, cleanupMode, projects]);

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
                const next = event.target.value as typeof statusFilter;
                setStatusFilter(next);
                addToast('过滤条件已更新', 'info');
              }}
              className="bg-white/5 border border-border-subtle rounded-lg pl-9 pr-8 py-2 text-xs font-bold text-slate-300 appearance-none focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              <option value="all">所有状态</option>
              {Object.entries(statusOptionLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          </div>
          <button
            type="button"
            onClick={() => void openCleanupCenter()}
            className="px-4 py-2 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 border border-rose-500/30 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
          >
            <Trash2 size={14} />
            清理中心
          </button>
          <button onClick={onOpenNewProject} className="px-4 py-2 bg-primary text-surface hover:bg-primary/90 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2">
            <Plus size={16} />
            创建项目
          </button>
        </div>
      </header>

      {automation ? (
        <div className="bg-surface-soft border border-border-subtle rounded-2xl p-4 space-y-3 text-xs">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="text-slate-400">最近执行: {automation.lastRunAt ? new Date(automation.lastRunAt).toLocaleString('zh-CN') : '暂无'}</span>
            <span className="text-slate-400">执行摘要: {automation.lastSummary || '暂无'}</span>
            <span className={cn('font-medium', automation.lastError ? 'text-danger' : 'text-emerald-300')}>
              {automation.lastError ? `最近错误: ${automation.lastError}` : '最近执行无错误'}
            </span>
            <span className="text-slate-400">
              自动审批: {automation.autoApproveWhenReady ? '开启' : '关闭'}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-slate-500">
              “全局自动推进一轮”会对所有可推进项目执行一次自动提交+审批，不等于强制恢复已暂停项目。
            </p>
            <button
              type="button"
              onClick={() => void runAutomationOnce()}
              disabled={automationLoading}
              className={cn(
                'px-4 py-2 rounded-lg text-xs font-semibold border transition-colors',
                'bg-primary/15 text-primary border-primary/30 hover:bg-primary/20',
                automationLoading && 'opacity-60 cursor-not-allowed',
              )}
              title="全局自动推进一轮"
            >
              全局自动推进一轮
            </button>
          </div>
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
                <tr
                  key={project.id}
                  className={cn(
                    'transition-colors group cursor-pointer',
                    recentProjectId === project.id ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-white/5',
                  )}
                  onClick={() => onSelectProject(project.id)}
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-slate-500 group-hover:text-primary transition-colors">
                        <Briefcase size={16} />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">{project.name}</span>
                        {recentProjectId === project.id ? <Badge variant="accent">刚创建</Badge> : null}
                      </div>
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
                      {(() => {
                        const actionState = getActionState(project);
                        return (
                          <>
                      <button
                        type="button"
                        className="px-2 py-1 text-[11px] rounded-md bg-white/5 text-slate-300 hover:bg-white/10"
                        onClick={() => void runProjectAction(project.id, 'pause')}
                        disabled={actionKey === `${project.id}:pause` || !actionState.canPause}
                        title="暂停项目"
                      >
                        <Pause size={12} />
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 text-[11px] rounded-md bg-white/5 text-slate-300 hover:bg-white/10"
                        onClick={() => void runProjectAction(project.id, 'resume')}
                        disabled={actionKey === `${project.id}:resume` || !actionState.canResume}
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
                          || !actionState.canAdvance
                        }
                        title="推进一步"
                      >
                        <SkipForward size={12} />
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 text-[11px] rounded-md bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                        onClick={() => void runProjectAction(project.id, 'close')}
                        disabled={actionKey === `${project.id}:close` || !actionState.canClose}
                        title="关闭项目"
                      >
                        <XCircle size={12} />
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 text-[11px] rounded-md bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                        onClick={() => void runProjectAction(project.id, 'delete')}
                        disabled={actionKey === `${project.id}:delete` || !actionState.canDelete}
                        title="删除项目"
                      >
                        <Trash2 size={12} />
                      </button>
                          </>
                        );
                      })()}
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

      <SurfaceModal
        isOpen={isCleanupCenterOpen}
        onClose={() => setIsCleanupCenterOpen(false)}
        title="项目清理与批量删除"
        panelClassName="max-w-5xl"
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-border-subtle bg-white/5 p-4 text-xs text-slate-300 space-y-1">
            <p>模式A：候选清理（系统推荐：已暂停 / 测试验证命名 / 重复旧版本）。</p>
            <p>模式B：全部项目（你可任意多选并删除）。删除后不可恢复。</p>
            <p>批量修复入口：可对选中项目按 qualityGate 阻断阶段一键拆单生成修复 issue（含历史项目）。</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setCleanupMode('candidates');
                setSelectedCleanupIds(recommendedCleanupIds);
              }}
              className={cn(
                'px-3 py-1.5 rounded-md border text-xs',
                cleanupMode === 'candidates'
                  ? 'bg-primary/15 border-primary/30 text-primary'
                  : 'bg-white/5 border-border-subtle text-slate-300 hover:bg-white/10',
              )}
            >
              候选清理
            </button>
            <button
              type="button"
              onClick={() => {
                setCleanupMode('all');
                setSelectedCleanupIds([]);
              }}
              className={cn(
                'px-3 py-1.5 rounded-md border text-xs',
                cleanupMode === 'all'
                  ? 'bg-primary/15 border-primary/30 text-primary'
                  : 'bg-white/5 border-border-subtle text-slate-300 hover:bg-white/10',
              )}
            >
              全部项目
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default">{cleanupMode === 'candidates' ? `候选 ${cleanupCandidates.length}` : `项目 ${projects.length}`}</Badge>
            <Badge variant="accent">推荐 {recommendedCleanupIds.length}</Badge>
            <Badge variant="warning">已选 {selectedCleanupIds.length}</Badge>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedCleanupIds(recommendedCleanupIds)}
              className="px-3 py-1.5 rounded-md bg-white/5 border border-border-subtle text-xs text-slate-300 hover:bg-white/10"
            >
              选择推荐项
            </button>
            <button
              type="button"
              onClick={() => setSelectedCleanupIds(cleanupRows.map((item) => item.id))}
              className="px-3 py-1.5 rounded-md bg-white/5 border border-border-subtle text-xs text-slate-300 hover:bg-white/10"
            >
              全选当前列表
            </button>
            <button
              type="button"
              onClick={() => setSelectedCleanupIds([])}
              className="px-3 py-1.5 rounded-md bg-white/5 border border-border-subtle text-xs text-slate-300 hover:bg-white/10"
            >
              清空选择
            </button>
            <button
              type="button"
              onClick={() => void loadCleanupCandidates()}
              disabled={cleanupLoading}
              className="px-3 py-1.5 rounded-md bg-primary/15 border border-primary/30 text-xs text-primary hover:bg-primary/25 disabled:opacity-60"
            >
              {cleanupLoading ? '刷新中...' : '刷新候选'}
            </button>
          </div>

          <div className="max-h-[52vh] overflow-y-auto rounded-xl border border-border-subtle">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white/5 border-b border-border-subtle">
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">选择</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">项目</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">状态</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">原因</th>
                  <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">更新时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {cleanupRows.map((item) => {
                  const checked = selectedCleanupIds.includes(item.id);
                  return (
                    <tr key={item.id} className="hover:bg-white/5">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleCleanupSelection(item.id)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm text-white font-medium">{item.name}</p>
                        <p className="text-[11px] text-slate-500 mt-1">{item.id} · {item.stage}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-300">{item.status}</td>
                      <td className="px-4 py-3">
                        {item.reasons.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {item.reasons.map((reason) => (
                              <Badge key={`${item.id}-${reason}`} variant={reason === 'duplicate_name' ? 'warning' : 'default'}>
                                {cleanupReasonLabel[reason] || reason}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">{new Date(item.updatedAt).toLocaleString('zh-CN')}</td>
                    </tr>
                  );
                })}
                {!cleanupLoading && cleanupRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                      {cleanupMode === 'candidates' ? '当前没有可清理候选项目' : '当前没有项目可删除'}
                    </td>
                  </tr>
                ) : null}
                {cleanupLoading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">候选加载中...</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsCleanupCenterOpen(false)}
              className="px-4 py-2 rounded-lg border border-border-subtle bg-white/5 text-slate-300 hover:bg-white/10 text-sm"
            >
              关闭
            </button>
            <button
              type="button"
              onClick={() => void runQualityGateRepairIssueGeneration(true)}
              disabled={repairIssueRunning || selectedCleanupIds.length === 0}
              className="px-4 py-2 rounded-lg border border-amber-500/30 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 text-sm font-semibold disabled:opacity-60"
            >
              {repairIssueRunning ? '处理中...' : '预览修复 Issue'}
            </button>
            <button
              type="button"
              onClick={() => void runQualityGateRepairIssueGeneration(false)}
              disabled={repairIssueRunning || selectedCleanupIds.length === 0}
              className="px-4 py-2 rounded-lg border border-primary/30 bg-primary/15 text-primary hover:bg-primary/25 text-sm font-semibold disabled:opacity-60"
            >
              {repairIssueRunning ? '处理中...' : `生成修复 Issue (${selectedCleanupIds.length})`}
            </button>
            <button
              type="button"
              onClick={() => void runCleanup()}
              disabled={cleanupRunning || repairIssueRunning || selectedCleanupIds.length === 0}
              className="px-4 py-2 rounded-lg border border-rose-500/30 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 text-sm font-semibold disabled:opacity-60"
            >
              {cleanupRunning ? '清理中...' : `删除所选 (${selectedCleanupIds.length})`}
            </button>
          </div>
        </div>
      </SurfaceModal>
    </div>
  );
}
