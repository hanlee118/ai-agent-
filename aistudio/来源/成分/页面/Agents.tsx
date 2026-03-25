import React from 'react';
import { 
  Users, 
  Search, 
  Plus, 
  BrainCircuit, 
  ChevronRight, 
  Activity, 
  Zap, 
  ShieldCheck, 
  Settings2 
} from 'lucide-react';
import { Card, CardContent, Badge } from '../ui/Card';
import { useTranslation } from '../../contexts/LanguageContext';
import { AgentProfile } from '../../types';
import { cn } from '../../lib/utils';

interface AgentsProps {
  agents: AgentProfile[];
  onSelectAgent: (agent: AgentProfile) => void;
}

export const Agents: React.FC<AgentsProps> = ({
  agents,
  onSelectAgent
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight">{t('common.agents')}</h2>
          <p className="text-slate-400 mt-1">{t('common.agentRosterDesc')}</p>
        </div>
        <div className="flex gap-3">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-sky-400 transition-colors" size={18} />
            <input
              type="text"
              placeholder={t('common.searchPlaceholder')}
              className="bg-slate-900/50 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-200 outline-none focus:ring-1 focus:ring-sky-500/50 focus:border-sky-500/50 transition-all w-64"
            />
          </div>
          <button className="bg-sky-500 hover:bg-sky-600 text-white px-6 py-2.5 rounded-xl font-semibold flex items-center gap-2 transition-all shadow-lg shadow-sky-500/20 active:scale-95">
            <Plus size={20} />
            {t('common.newProject')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {agents.map((agent) => (
          <Card 
            key={agent.roleId} 
            className="group cursor-pointer hover:border-sky-500/50 transition-all duration-300 hover:shadow-sky-500/5 bg-[#1A202C]/50 border-slate-800 overflow-hidden"
            onClick={() => onSelectAgent(agent)}
          >
            <div className="h-2 bg-gradient-to-r from-sky-500 to-indigo-600" />
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-6">
                <div className="w-14 h-14 bg-sky-500/10 rounded-2xl flex items-center justify-center text-sky-400 border border-sky-500/20 group-hover:scale-110 transition-transform">
                  <BrainCircuit size={28} />
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge variant={agent.status === 'idle' ? 'success' : 'warning'}>
                    {agent.status.toUpperCase()}
                  </Badge>
                  {agent.isAutonomous && (
                    <div className="px-2 py-0.5 rounded bg-sky-500/10 text-sky-500 text-[8px] font-bold animate-pulse border border-sky-500/20">
                      AUTONOMOUS
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <h4 className="text-xl font-bold text-white group-hover:text-sky-400 transition-colors">{agent.name}</h4>
                <p className="text-xs text-slate-500 font-mono uppercase tracking-widest">{agent.title}</p>
              </div>

              <p className="text-sm text-slate-400 mt-4 line-clamp-2 leading-relaxed h-10">
                {agent.soul}
              </p>

              <div className="mt-6 pt-6 border-t border-slate-800 grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Model</span>
                  <p className="text-xs font-bold text-slate-300 truncate">{agent.model}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Success Rate</span>
                  <p className="text-xs font-bold text-emerald-400">98.4%</p>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-between">
                <div className="flex -space-x-2">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="w-6 h-6 rounded-full bg-slate-800 border-2 border-[#1A202C] flex items-center justify-center text-[8px] font-bold text-slate-500">
                      {i}
                    </div>
                  ))}
                </div>
                <button className="p-2 bg-slate-800 group-hover:bg-sky-500 rounded-lg text-slate-500 group-hover:text-white transition-all">
                  <ChevronRight size={18} />
                </button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};
