import { BrainCircuit, Settings, UserPlus, Workflow } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { agents, models } from '../lib/runtimeCollections';
import { Badge } from './impl/GovernanceShared';

type Props = {
  onSelectAgent: (id: string) => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onOpenTopology: () => void;
  onOpenDeploy: () => void;
  onOpenConfig: (id: string) => void;
};

export default function AgentsPage({ onSelectAgent, addToast, onOpenTopology, onOpenDeploy, onOpenConfig }: Props) {
  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Agent 名册</h1>
          <p className="text-slate-400 mt-1">监控和管理您的数字员工能力。</p>
        </div>
        <div className="flex gap-3">
          <button onClick={onOpenTopology} className="px-4 py-2 bg-white/5 border border-border-subtle rounded-lg text-sm font-medium hover:bg-white/10 transition-colors flex items-center gap-2">
            <Workflow size={16} />
            团队图谱
          </button>
          <button onClick={onOpenDeploy} className="px-4 py-2 bg-primary text-surface hover:bg-primary/90 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2">
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
              <Badge variant={agent.status === 'Thinking' ? 'accent' : agent.status === 'Executing' ? 'primary' : 'default'}>{agent.status}</Badge>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-white/5 rounded-xl border border-border-subtle">
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">模型</p>
                <p className="text-xs text-white mt-1 font-medium">{models.find((model) => model.id === agent.currentModelId)?.name || '未设置模型'}</p>
              </div>
              <div className="p-3 bg-white/5 rounded-xl border border-border-subtle">
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">已用 Token</p>
                <p className="text-xs text-white mt-1 font-medium">{((agent.tokensUsed || 0) / 1000).toFixed(1)}k</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-[10px]">
                <span className="text-slate-500 font-bold uppercase tracking-wider">当前负载</span>
                <span className="text-white font-bold">{agent.load}%</span>
              </div>
              <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: `${agent.load}%` }} className={cn('h-full rounded-full', (agent.load || 0) > 80 ? 'bg-danger' : 'bg-primary')} />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectAgent(agent.id);
                  addToast(`正在连接到 ${agent.name} 的控制终端...`, 'info');
                }}
                className="flex-1 py-2.5 bg-white/5 border border-border-subtle rounded-xl text-xs font-bold text-slate-300 hover:bg-white/10 hover:text-white transition-all"
              >
                命令
              </button>
              <button
                onClick={(event) => {
                  event.stopPropagation();
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
}
