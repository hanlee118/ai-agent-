import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import {
  Activity,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Command,
  Database,
  FileText,
  Globe,
  History,
  Lock,
  ShieldCheck,
  UserPlus,
  Workflow,
  Zap,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import type { Agent, Task } from '../types';
import { fetchOpenClawAgentDetail } from '../lib/adapters';
import { agents, models, projects, sessions, tasks } from '../lib/runtimeCollections';
import { TokenUsageTrendChart } from './impl/GovernanceShared';

type CommandUnderstandingCard = {
  raw: string;
  summary: string;
  goal: string;
  project: string;
  involvedAgent: string;
  eta: string;
  warning?: string;
};

const parseSopSteps = (content: string) =>
  content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s*/, '').replace(/^\d+[.)]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 8);

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

const DEFAULT_AGENT_TOKEN_LIMIT = 100000000;

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
    fallbackModel: '',
    tasks: 0,
    memoryCount: 0,
    tokensUsed: 0,
    tokenLimit: DEFAULT_AGENT_TOKEN_LIMIT,
    sessionCount: 0,
  };
  const activeAgent = agents.find((agent) => agent.id === agentId) || agents[0] || fallbackAgent;

  const [tokenLimit, setTokenLimit] = useState(activeAgent.tokenLimit || DEFAULT_AGENT_TOKEN_LIMIT);
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
    setTokenLimit(activeAgent.tokenLimit || DEFAULT_AGENT_TOKEN_LIMIT);
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

  const handleTokenLimitChange = (e: ChangeEvent<HTMLInputElement>) => {
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
  const configuredModelName = models.find((m) => m.id === currentModelId)?.name || currentModelId || '未配置';
  const runtimeModelName = activeAgent.model || configuredModelName;
  const fallbackModelName = activeAgent.fallbackModel || '未配置';
  const modelRouteStatus = runtimeModelName === configuredModelName ? '主路由' : '路由偏移';

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
            <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500">
              <span>路由: 运行 {runtimeModelName}</span>
              <span>·</span>
              <span>配置 {configuredModelName}</span>
              <span>·</span>
              <span>备用 {fallbackModelName}</span>
              <Badge variant={modelRouteStatus === '主路由' ? 'primary' : 'warning'}>{modelRouteStatus}</Badge>
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
              {configuredModelName}
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



export default AgentCommander;
