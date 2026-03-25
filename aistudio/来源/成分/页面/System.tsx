import React from 'react';
import { 
  Activity, 
  ShieldCheck, 
  Lock, 
  Cpu, 
  Database, 
  RefreshCw 
} from 'lucide-react';
import { Card, CardHeader, CardContent, Badge } from '../ui/Card';
import { useTranslation } from '../../contexts/LanguageContext';

export const System: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold text-white tracking-tight">{t('common.system')}</h2>
        <div className="px-3 py-1 rounded bg-emerald-500/10 text-emerald-500 text-xs font-bold border border-emerald-500/20">{t('common.systemStatus.running')}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-[#1A202C]/50 border-slate-800">
          <CardHeader className="flex flex-row items-center gap-2 p-4 border-b border-slate-800">
            <ShieldCheck size={18} className="text-emerald-400" />
            <h3 className="text-lg font-bold text-white">{t('common.systemStatus.api')}</h3>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Gemini Pro API</span>
              <Badge variant="success">ONLINE</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">OpenClaw Core API</span>
              <Badge variant="success">ONLINE</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Storage API</span>
              <Badge variant="success">ONLINE</Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[#1A202C]/50 border-slate-800">
          <CardHeader className="flex flex-row items-center gap-2 p-4 border-b border-slate-800">
            <Lock size={18} className="text-sky-400" />
            <h3 className="text-lg font-bold text-white">{t('common.systemStatus.security')}</h3>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Firewall</span>
              <span className="text-emerald-400 text-sm font-bold">ACTIVE</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">SSL Certificate</span>
              <span className="text-emerald-400 text-sm font-bold">VALID</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Intrusion Detection</span>
              <span className="text-emerald-400 text-sm font-bold">MONITORING</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[#1A202C]/50 border-slate-800">
          <CardHeader className="flex flex-row items-center gap-2 p-4 border-b border-slate-800">
            <Activity size={18} className="text-indigo-400" />
            <h3 className="text-lg font-bold text-white">Performance</h3>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Avg Response Time</span>
              <span className="text-white text-sm font-bold">124ms</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Uptime (30d)</span>
              <span className="text-white text-sm font-bold">99.98%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Error Rate</span>
              <span className="text-white text-sm font-bold">0.02%</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-[#1A202C]/50 border-slate-800">
          <CardHeader className="p-4 border-b border-slate-800">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Database size={18} className="text-sky-400" />
              OpenClaw Core Workspace
            </h3>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">SLA Heartbeat</span>
              <span className="text-emerald-400 font-bold">HEALTHY</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">CPU Load</span>
              <span className="text-white font-bold">12%</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Memory Usage</span>
              <span className="text-white font-bold">456 MB</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[#1A202C]/50 border-slate-800">
          <CardHeader className="p-4 border-b border-slate-800">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Cpu size={18} className="text-indigo-400" />
              Runtime Diagnosis
            </h3>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Node.js Version</span>
              <span className="text-white font-bold">v20.x</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Docker Status</span>
              <span className="text-emerald-400 font-bold">RUNNING</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Last Check</span>
              <span className="text-slate-500 font-mono">2026-03-25 15:50:00</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
