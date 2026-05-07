import { useEffect, useMemo, useState } from 'react';
import { Activity, Terminal, Zap } from 'lucide-react';
import { cn } from '../lib/utils';
import { agents, models, projects, sessions } from '../lib/runtimeCollections';
import { Badge } from './impl/GovernanceShared';
import { systemApi, type SystemObservabilitySummary } from '../lib/api';

type Props = {
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onNavigate?: (tab: string, id?: string) => void;
};

export default function MonitoringPage({ addToast, onNavigate }: Props) {
  const [activeFilter, setActiveFilter] = useState('all');
  const [observability, setObservability] = useState<SystemObservabilitySummary | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isAuditRunning, setIsAuditRunning] = useState(false);

  const loadSummary = async (silent = false) => {
    if (!silent) {
      setIsRefreshing(true);
    }
    try {
      const summary = await systemApi.getObservabilitySummary();
      setObservability(summary);
      if (!silent) {
        addToast('监控快照已刷新', 'success');
      }
    } catch {
      setObservability(null);
      if (!silent) {
        addToast('监控刷新失败，请稍后重试', 'error');
      }
    } finally {
      if (!silent) {
        setIsRefreshing(false);
      }
    }
  };

  const handleTriggerAudit = async () => {
    setIsAuditRunning(true);
    try {
      const result = await systemApi.triggerAudit();
      if (result.ok) {
        addToast(`巡检完成，扫描 ${result.scanned ?? 0} 个 MR`, 'success');
      } else {
        addToast(`巡检失败：${result.message || '未知错误'}`, 'error');
      }
      await loadSummary(true);
    } catch {
      addToast('巡检触发失败，请检查登录态和服务连通性', 'error');
    } finally {
      setIsAuditRunning(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const summary = await systemApi.getObservabilitySummary();
        if (!cancelled) {
          setObservability(summary);
        }
      } catch {
        if (!cancelled) {
          setObservability(null);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredSessions = useMemo(() => {
    if (activeFilter === 'all') return sessions;
    return sessions.filter((session) => session.status === activeFilter);
  }, [activeFilter, sessions]);

  const stats = useMemo(() => {
    const totalTokens = sessions.reduce((acc, session) => acc + (session.tokens || 0), 0);
    const totalCost = totalTokens * 0.000002;
    const activeCount = sessions.filter((session) => session.status === 'active').length;
    return { totalTokens, totalCost, activeCount };
  }, [sessions]);

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
              { id: 'completed', label: '已完成' },
            ].map((filter) => (
              <button
                key={filter.id}
                onClick={() => setActiveFilter(filter.id)}
                className={cn(
                  'px-4 py-1.5 text-xs font-bold rounded-lg transition-all',
                  activeFilter === filter.id ? 'bg-primary text-surface shadow-sm' : 'text-slate-500 hover:text-slate-300',
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => void loadSummary(false)}
            disabled={isRefreshing}
            className="px-3 py-1.5 text-xs bg-white/5 border border-border-subtle rounded-lg hover:bg-white/10 disabled:opacity-60"
          >
            {isRefreshing ? '刷新中...' : '刷新'}
          </button>
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

      <div className="bg-surface-soft border border-border-subtle rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-white">平台可观测性摘要</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void handleTriggerAudit()}
              disabled={isAuditRunning}
              className="px-2.5 py-1 text-[11px] rounded-md border border-border-subtle bg-white/5 hover:bg-white/10 disabled:opacity-60"
            >
              {isAuditRunning ? '巡检中...' : '触发巡检'}
            </button>
            <span className="text-[11px] text-slate-500">
              {observability?.generatedAt ? `更新于 ${new Date(observability.generatedAt).toLocaleString('zh-CN')}` : '暂无数据'}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
          <div className="rounded-xl border border-border-subtle bg-white/5 p-3">
            <p className="text-slate-500">项目数</p>
            <p className="mt-1 text-white font-semibold">{observability?.data.projectCount ?? '-'}</p>
          </div>
          <div className="rounded-xl border border-border-subtle bg-white/5 p-3">
            <p className="text-slate-500">执行记录</p>
            <p className="mt-1 text-white font-semibold">{observability?.data.executionCount ?? '-'}</p>
          </div>
          <div className="rounded-xl border border-border-subtle bg-white/5 p-3">
            <p className="text-slate-500">审计日志</p>
            <p className="mt-1 text-white font-semibold">{observability?.data.auditCount ?? '-'}</p>
          </div>
          <div className="rounded-xl border border-border-subtle bg-white/5 p-3">
            <p className="text-slate-500">可用工具</p>
            <p className="mt-1 text-white font-semibold">
              {observability ? `${observability.localAgentMonitor.totals.availableTools}/${observability.localAgentMonitor.totals.totalTools}` : '-'}
            </p>
          </div>
          <div className="rounded-xl border border-border-subtle bg-white/5 p-3">
            <p className="text-slate-500">就绪告警</p>
            <p className={cn('mt-1 font-semibold', (observability?.readiness.warningCount || 0) > 0 ? 'text-warning' : 'text-emerald-300')}>
              {observability?.readiness.warningCount ?? '-'}
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-border-subtle bg-white/5 p-3 text-xs">
          <p className="text-slate-500">最近巡检</p>
          <p className="mt-1 text-white">
            {observability?.governance?.latestAudit?.available
              ? observability.governance.latestAudit.summary || '巡检已执行'
              : observability?.governance?.latestAudit?.message || '暂无巡检记录'}
          </p>
          {observability?.governance?.latestAudit?.createdAt && (
            <p className="mt-1 text-slate-500">
              {new Date(observability.governance.latestAudit.createdAt).toLocaleString('zh-CN')}
            </p>
          )}
        </div>
      </div>

      <div className="bg-surface-soft border border-border-subtle rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border-subtle flex justify-between items-center bg-white/5">
          <h2 className="font-semibold text-white">会话活动流</h2>
          <button
            className="text-xs text-primary hover:underline"
            onClick={() => {
              if (onNavigate) {
                onNavigate('audit');
                return;
              }
              addToast('已打开历史日志入口', 'info');
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
                const agent = agents.find((item) => item.id === session.agentId);
                const project = projects.find((item) => item.id === session.projectId);
                const model = models.find((item) => item.id === session.modelId || item.id === agent?.currentModelId);
                return (
                  <tr key={session.id} className="hover:bg-white/5 transition-colors group">
                    <td className="px-6 py-4 text-xs text-slate-500 font-mono">{session.id}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded bg-white/5 flex items-center justify-center text-[10px] font-bold text-primary">
                          {agent?.name?.charAt(0) || 'A'}
                        </div>
                        <span className="text-xs font-bold text-white">{agent?.name || 'Agent'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant="default">{model?.name || '未指定模型'}</Badge>
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-400">{project?.name || '项目'}</td>
                    <td className="px-6 py-4 text-xs text-slate-500">{session.duration}</td>
                    <td className="px-6 py-4 text-xs text-white font-mono">{session.tokens}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5">
                        <div className={cn('w-1.5 h-1.5 rounded-full', session.status === 'active' ? 'bg-primary animate-pulse' : session.status === 'completed' ? 'bg-slate-500' : 'bg-danger')} />
                        <span className={cn('text-[10px] font-bold uppercase', session.status === 'active' ? 'text-primary' : 'text-slate-500')}>
                          {session.status === 'active' ? '活跃' : '已完成'}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredSessions.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-slate-500">暂无会话数据</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
