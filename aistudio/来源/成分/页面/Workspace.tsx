import React from 'react';
import { 
  Database, 
  Activity, 
  ShieldCheck, 
  Cpu, 
  RefreshCw, 
  PlusCircle, 
  Search, 
  Filter, 
  ChevronRight, 
  Terminal, 
  Zap, 
  FolderKanban, 
  Users 
} from 'lucide-react';
import { Card, CardHeader, CardContent, Badge } from '../ui/Card';
import { useTranslation } from '../../contexts/LanguageContext';

export const Workspace: React.FC = () => {
  const { t } = useTranslation();

  const workspaces = [
    { id: 'ws1', name: 'OpenClaw Core', status: 'healthy', projects: 12, agents: 8, sla: '100%', load: 12, memory: '456 MB' },
    { id: 'ws2', name: 'AI Lab', status: 'healthy', projects: 5, agents: 4, sla: '99.9%', load: 45, memory: '1.2 GB' },
    { id: 'ws3', name: 'Data Hub', status: 'warning', projects: 8, agents: 6, sla: '98.5%', load: 88, memory: '4.8 GB' },
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight">{t('common.workspace')}</h2>
          <p className="text-slate-400 mt-1">Manage and monitor your autonomous agent clusters.</p>
        </div>
        <div className="flex gap-3">
          <button className="bg-[#1A202C] hover:bg-slate-800 text-white px-6 py-2.5 rounded-xl font-semibold flex items-center gap-2 transition-all border border-slate-800">
            <RefreshCw size={20} />
            {t('common.sync')}
          </button>
          <button className="bg-sky-500 hover:bg-sky-600 text-white px-6 py-2.5 rounded-xl font-semibold flex items-center gap-2 transition-all shadow-lg shadow-sky-500/20 active:scale-95">
            <PlusCircle size={20} />
            New Cluster
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {workspaces.map((ws) => (
          <Card key={ws.id} className="bg-[#1A202C]/50 border-slate-800 group hover:border-sky-500/30 transition-all">
            <CardHeader className="flex flex-row items-center justify-between p-6 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center border",
                  ws.status === 'healthy' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                )}>
                  <Database size={20} />
                </div>
                <h3 className="font-bold text-white">{ws.name}</h3>
              </div>
              <Badge variant={ws.status === 'healthy' ? 'success' : 'warning'}>{ws.status.toUpperCase()}</Badge>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('common.workspaceDetails.activeProjects')}</p>
                  <p className="text-xl font-black text-white">{ws.projects}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('common.agents')}</p>
                  <p className="text-xl font-black text-white">{ws.agents}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('common.workspaceDetails.sla')}</p>
                  <p className="text-xl font-black text-emerald-400">{ws.sla}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Load</p>
                  <p className={cn(
                    "text-xl font-black",
                    ws.load > 80 ? "text-rose-400" : ws.load > 50 ? "text-amber-400" : "text-white"
                  )}>{ws.load}%</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Memory Usage</span>
                  <span className="text-slate-300 font-mono">{ws.memory}</span>
                </div>
                <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <div 
                    className={cn(
                      "h-full transition-all duration-500",
                      ws.load > 80 ? "bg-rose-500" : ws.load > 50 ? "bg-amber-500" : "bg-sky-500"
                    )} 
                    style={{ width: `${ws.load}%` }} 
                  />
                </div>
              </div>

              <button className="w-full py-2.5 bg-[#0B1015] hover:bg-slate-800 border border-slate-800 rounded-xl text-xs font-bold text-slate-400 hover:text-white transition-all flex items-center justify-center gap-2">
                Manage Cluster
                <ChevronRight size={14} />
              </button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-[#1A202C]/50 border-slate-800">
        <CardHeader className="p-6 border-b border-slate-800 flex flex-row items-center justify-between">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <Activity size={20} className="text-sky-400" />
            Global Resource Monitor
          </h3>
          <div className="flex gap-2">
            <Badge variant="info">CPU: 24%</Badge>
            <Badge variant="info">MEM: 6.4 GB</Badge>
            <Badge variant="info">NET: 1.2 GB/s</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <div className="h-48 flex items-end gap-1">
            {Array.from({ length: 48 }).map((_, i) => {
              const height = 20 + Math.random() * 80;
              return (
                <div 
                  key={i} 
                  className="flex-1 bg-sky-500/20 hover:bg-sky-500/40 rounded-t-sm transition-all cursor-help relative group"
                  style={{ height: `${height}%` }}
                >
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-900 border border-slate-800 rounded text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                    {Math.round(height)}% Load
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-4 text-[10px] text-slate-600 font-mono uppercase tracking-widest">
            <span>24h ago</span>
            <span>12h ago</span>
            <span>Now</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

import { cn } from '../../lib/utils';
