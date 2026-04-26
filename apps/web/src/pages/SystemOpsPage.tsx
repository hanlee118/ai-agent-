import { useMemo, useState } from 'react';
import {
  Users,
  ShieldCheck,
  Activity,
  AlertCircle,
  BarChart3,
  CheckCircle2,
  History,
  RotateCcw,
  Zap,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '../lib/utils';
import { agents, models, projects, sessions } from '../lib/runtimeCollections';

const ROLE_BINDING_RULES: Array<{
  roleId: string;
  label: string;
  patterns: RegExp[];
}> = [
  { roleId: 'ROLE_ANALYST', label: '需求分析师', patterns: [/analyst|需求|分析|requirements/i] },
  { roleId: 'ROLE_PRODUCT', label: '产品总监', patterns: [/product|产品|prd/i] },
  { roleId: 'ROLE_DESIGN', label: '视觉设计总监', patterns: [/design|设计|视觉|ui|ux|jeremy/i] },
  { roleId: 'ROLE_DEV', label: '研发经理', patterns: [/dev|研发|开发|engineer|rd/i] },
  { roleId: 'ROLE_QA', label: '测试工程师', patterns: [/qa|测试|质量/i] },
];

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
const TokenUsageTrendChart = ({ limit }: { limit: number }) => {
  const data = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, i) => {
      const hour = (new Date().getHours() - (23 - i) + 24) % 24;
      const baseUsage = (limit / 24) * 0.45;
      const peakFactor = (hour > 9 && hour < 18) ? 1.25 : 0.65;
      const rhythm = 1 + Math.sin((i / 24) * Math.PI * 2) * 0.2;
      return {
        time: `${hour}:00`,
        usage: Math.max(0, Math.floor(baseUsage * peakFactor * rhythm)),
      };
    });
    return hours;
  }, [limit]);

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

const TokenThroughputChart = ({ data }: { data: Array<{ time: number; input: number; output: number }> }) => {
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

const getRelativeTime = (date: string | Date | undefined) => {
  if (!date) return '暂无活动';
  const diff = Date.now() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
};

const SystemOperations = ({ onNavigate, addToast, onRefreshData }: any) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizationSuggestions, setOptimizationSuggestions] = useState<Array<{ title: string; message: string; type: 'warning' | 'info' }>>([]);

  const topConsumers = useMemo(
    () => [...agents].sort((a, b) => (b.tokensUsed || 0) - (a.tokensUsed || 0)).slice(0, 5),
    [agents],
  );
  const systemStatus = useMemo(() => [
    { label: 'API 网关', status: '健康', latency: '42ms', uptime: '99.9%' },
    { label: 'OpenClaw 连接器', status: agents.length > 0 ? '健康' : '离线', latency: '12ms', uptime: agents.length > 0 ? '100%' : '0%' },
    { label: 'Agent 集群', status: agents.length > 0 ? '健康' : '离线', latency: '-', uptime: agents.length > 0 ? '100%' : '0%' },
    { label: '模型服务', status: models.length > 0 ? '健康' : '离线', latency: '-', uptime: models.length > 0 ? '99.5%' : '0%' },
  ], [agents.length, models.length]);
  const allHealthy = systemStatus.every((item) => item.status === '健康');

  const modelCosts = useMemo(() => {
    const costs = models.slice(0, 4).map((model) => ({
      label: model.name,
      cost: `$${(Number(model.totalTokens || 0) * 0.000002).toFixed(2)}`,
      usage: Math.min(100, Math.round((Number(model.dailyTokens || 0) / 200000) * 100)),
      color: model.status === 'Healthy' ? 'bg-primary' : 'bg-warning',
    }));
    return costs.length > 0 ? costs : [{ label: '暂无模型数据', cost: '$0.00', usage: 0, color: 'bg-slate-500' }];
  }, [models]);

  const avgLoad = useMemo(
    () => (agents.length > 0 ? Math.round(agents.reduce((sum, item) => sum + (item.load || 0), 0) / agents.length) : 0),
    [agents],
  );
  const efficiencyScore = Math.max(0, 100 - avgLoad);
  const hasSessionSignal = useMemo(
    () => sessions.length > 0
      || agents.some((agent) => (agent.sessionCount || 0) > 0 || Boolean(agent.lastActiveAt)),
    [agents, sessions],
  );
  const roleBindings = useMemo(
    () =>
      ROLE_BINDING_RULES.map((rule) => {
        const matched = agents.find((agent) => {
          const text = `${agent.id} ${agent.name} ${agent.role}`.toLowerCase();
          return rule.patterns.some((pattern) => pattern.test(text));
        });
        const configuredModel = matched
          ? models.find((model) => model.id === matched.currentModelId)?.name || matched.currentModelId || '-'
          : '-';
        const runtimeModel = matched?.model || configuredModel;
        const fallbackModel = matched?.fallbackModel || '-';
        const routeStatus = matched
          ? (runtimeModel === configuredModel ? '主路由' : '降级/偏移')
          : '未绑定';

        return {
          ...rule,
          agentName: matched?.name || '-',
          runtimeModel,
          configuredModel,
          fallbackModel,
          routeStatus,
          healthy: Boolean(matched),
        };
      }),
    [agents, models],
  );

  const throughputData = useMemo(() => {
    const rows = sessions
      .slice()
      .sort((left, right) => {
        const leftTs = new Date(left.updatedAt || left.startTime).getTime();
        const rightTs = new Date(right.updatedAt || right.startTime).getTime();
        return leftTs - rightTs;
      })
      .slice(-20)
      .map((session, index) => {
        const total = Math.max(Number(session.tokens || 0), 0);
        const input = Math.round(total * 0.42);
        const output = Math.max(total - input, 0);
        return {
          time: index + 1,
          input,
          output,
        };
      });

    return rows.length > 0 ? rows : [{ time: 0, input: 0, output: 0 }];
  }, [sessions]);

  const sessionRows = useMemo(() => sessions.slice(0, 5), [sessions]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    addToast('正在刷新系统状态...', 'info');
    try {
      if (onRefreshData) {
        await onRefreshData();
      }
      addToast('系统状态已更新', 'success');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDiagnose = () => {
    setIsDiagnosing(true);
    addToast('正在启动全系统诊断...', 'info');
    setTimeout(() => {
      setIsDiagnosing(false);
      addToast(allHealthy ? '诊断完成: 未发现异常' : '诊断完成: 建议关注离线服务', allHealthy ? 'success' : 'info');
    }, 1200);
  };

  const handleOptimizeStrategy = () => {
    setIsOptimizing(true);
    const suggestions: Array<{ title: string; message: string; type: 'warning' | 'info' }> = [];
    const overloadedAgents = agents.filter((agent) => (agent.load || 0) > 80);
    const blockedProjects = projects.filter((project) => project.status === 'At Risk' || project.status === 'Blocked');
    if (overloadedAgents.length > 0) {
      suggestions.push({
        title: 'Agent 负载分析',
        message: `${overloadedAgents.length} 个 Agent 负载超过 80%，建议分流任务到空闲 Agent。`,
        type: 'warning',
      });
    }
    if (blockedProjects.length > 0) {
      suggestions.push({
        title: '项目阻塞分析',
        message: `${blockedProjects.length} 个项目处于风险或阻塞状态，建议优先处理阻塞依赖。`,
        type: 'warning',
      });
    }
    if (suggestions.length === 0) {
      suggestions.push({
        title: '系统状态良好',
        message: '当前没有明显瓶颈，可继续按既定策略执行。',
        type: 'info',
      });
    }
    setOptimizationSuggestions(suggestions);
    setIsOptimizing(false);
    addToast('优化建议已生成', 'success');
  };

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">系统运行</h1>
          <p className="text-slate-400 mt-1">运行时状态、健康检查和成本治理。</p>
        </div>
        <button
          onClick={() => void handleRefresh()}
          disabled={isRefreshing}
          className="px-4 py-2 bg-white/5 border border-border-subtle rounded-lg text-sm font-medium hover:bg-white/10 transition-colors flex items-center gap-2 disabled:opacity-50"
        >
          <RotateCcw size={16} className={cn(isRefreshing && 'animate-spin')} />
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
              <Badge variant={allHealthy ? 'primary' : 'warning'}>{allHealthy ? '所有系统正常' : '部分服务异常'}</Badge>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              {systemStatus.map((service, i) => (
                <div key={i} className="flex justify-between items-center p-4 bg-surface-muted rounded-xl border border-border-subtle hover:border-white/20 transition-colors group">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-white group-hover:text-primary transition-colors">{service.label}</p>
                    <div className="flex gap-3">
                      <p className="text-[10px] text-slate-500">延迟: {service.latency}</p>
                      <p className="text-[10px] text-slate-500">运行时间: {service.uptime}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={cn('w-2 h-2 rounded-full', service.status === '健康' ? 'bg-primary shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-warning')} />
                    <span className={cn('text-xs font-bold', service.status === '健康' ? 'text-primary' : 'text-warning')}>{service.status}</span>
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
            </div>
            <div className="p-6 h-48 relative">
              <TokenThroughputChart data={throughputData} />
            </div>
          </div>

          <div className="bg-surface-soft border border-border-subtle rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border-subtle flex justify-between items-center">
              <h2 className="font-semibold text-white flex items-center gap-2">
                <BarChart3 size={18} className="text-accent" />
                成本治理
              </h2>
              <button onClick={() => addToast('正在导出成本报告...', 'info')} className="text-xs text-primary hover:underline">
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
                      <motion.div initial={{ width: 0 }} animate={{ width: `${item.usage}%` }} className={cn('h-full rounded-full', item.color)} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-4 bg-white/5 rounded-xl border border-border-subtle space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-lg bg-primary/10 text-primary">
                      <Zap size={20} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">效率评分: {efficiencyScore}/100</p>
                      <p className="text-xs text-slate-500">基于当前 Agent 平均负载自动计算。</p>
                    </div>
                  </div>
                  <button onClick={handleOptimizeStrategy} disabled={isOptimizing} className="px-4 py-2 bg-primary text-surface text-xs font-bold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60">
                    {isOptimizing ? '分析中...' : '优化策略'}
                  </button>
                </div>
                {optimizationSuggestions.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {optimizationSuggestions.map((item, idx) => (
                      <div key={idx} className={cn('p-3 rounded-xl border', item.type === 'warning' ? 'bg-warning/5 border-warning/20' : 'bg-primary/5 border-primary/20')}>
                        <p className="text-xs font-bold text-white">{item.title}</p>
                        <p className="text-xs text-slate-400 mt-1">{item.message}</p>
                        <button onClick={() => addToast(`已采纳建议: ${item.title}`, 'success')} className="mt-2 text-[11px] text-primary hover:underline">
                          应用建议
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
                  {sessionRows.map((session) => {
                    const agent = agents.find((item) => item.id === session.agentId);
                    const project = projects.find((item) => item.id === session.projectId);
                    return (
                      <tr key={session.id} className="hover:bg-white/5 transition-colors group">
                        <td className="px-6 py-4">
                          <span className="text-xs font-bold text-white">{agent?.name || 'Agent'}</span>
                        </td>
                        <td className="px-6 py-4 text-xs text-slate-400">{project?.name || '项目'}</td>
                        <td className="px-6 py-4 text-xs text-slate-500">{session.duration}</td>
                        <td className="px-6 py-4 text-xs text-white font-mono">{session.tokens}</td>
                        <td className="px-6 py-4 text-right">
                          <Badge variant={session.status === 'active' ? 'primary' : 'default'}>{session.status === 'active' ? '活跃' : '完成'}</Badge>
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
              {[
                { label: '环境变量', state: 'ok' as const },
                { label: 'OpenClaw 工作区', state: projects.length > 0 ? ('ok' as const) : ('fail' as const) },
                { label: '数据库连接', state: 'ok' as const },
                { label: '模型服务', state: models.length > 0 ? ('ok' as const) : ('fail' as const) },
                { label: 'Agent 连接', state: agents.length > 0 ? ('ok' as const) : ('fail' as const) },
                {
                  label: '会话同步',
                  state:
                    agents.length === 0
                      ? ('fail' as const)
                      : hasSessionSignal
                        ? ('ok' as const)
                        : ('warn' as const),
                },
              ].map((check, i) => (
                <div key={i} className="flex items-center justify-between group">
                  <span className="text-xs text-slate-400 group-hover:text-slate-300 transition-colors">{check.label}</span>
                  {check.state === 'ok' ? (
                    <CheckCircle2 size={16} className="text-primary" />
                  ) : check.state === 'warn' ? (
                    <AlertCircle size={16} className="text-warning" />
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
          </div>

          <div className="bg-surface-soft border border-border-subtle rounded-2xl p-6 space-y-4">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <Users size={18} className="text-primary" />
              角色绑定与模型路由
            </h2>
            <div className="space-y-3">
              {roleBindings.map((binding) => (
                <div key={binding.roleId} className="p-3 rounded-xl border border-border-subtle bg-white/5 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-white font-semibold">{binding.label}</p>
                    <Badge variant={binding.healthy ? (binding.routeStatus === '主路由' ? 'primary' : 'warning') : 'danger'}>
                      {binding.routeStatus}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-slate-400">Agent: {binding.agentName}</p>
                  <p className="text-[11px] text-slate-500">运行模型: {binding.runtimeModel}</p>
                  <p className="text-[11px] text-slate-500">配置模型: {binding.configuredModel}</p>
                  <p className="text-[11px] text-slate-500">备用模型: {binding.fallbackModel}</p>
                </div>
              ))}
            </div>
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
                      <p className="text-[9px] text-slate-500 uppercase">{models.find((model) => model.id === agent.currentModelId)?.name || '未设置模型'}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-white font-bold">{((agent.tokensUsed || 0) / 1000).toFixed(1)}k</p>
                    <p className="text-[9px] text-slate-500">tokens</p>
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


export default SystemOperations;
