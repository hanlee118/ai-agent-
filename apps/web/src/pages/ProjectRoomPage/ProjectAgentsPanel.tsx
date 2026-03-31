import { Plus, Users } from 'lucide-react';
import type { Agent } from '../../types';

type Props = {
  projectAgents: Array<Pick<Agent, 'id' | 'name' | 'role'>>;
};

export default function ProjectAgentsPanel({ projectAgents }: Props) {
  return (
    <section className="space-y-4">
      <h3 className="text-[10px] uppercase tracking-widest font-bold text-slate-500 flex items-center gap-2">
        <Users size={12} />
        项目 Agent
      </h3>
      <div className="space-y-3">
        {projectAgents.slice(0, 4).map((agent) => (
          <div key={agent.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors cursor-pointer">
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
        {projectAgents.length === 0 ? <p className="text-[11px] text-slate-500 text-center py-2">暂无项目成员数据</p> : null}
        <button
          type="button"
          className="w-full py-2 bg-white/5 border border-dashed border-border-subtle rounded-xl text-[10px] font-bold text-slate-500 hover:text-white hover:border-white/20 transition-all flex items-center justify-center gap-2"
        >
          <Plus size={12} />
          指派 Agent
        </button>
      </div>
    </section>
  );
}
