import React from 'react';
import { 
  FolderKanban, 
  Users, 
  Activity, 
  ShieldCheck, 
  PlusCircle, 
  RefreshCw 
} from 'lucide-react';
import { motion } from 'motion/react';
import { Card, CardHeader, CardContent, Badge } from '../ui/Card';
import { useTranslation } from '../../contexts/LanguageContext';
import { Project, AgentProfile } from '../../types';
import { cn } from '../../lib/utils';

interface DashboardProps {
  projects: Project[];
  agents: AgentProfile[];
  onNewProject: () => void;
  onSync: () => void;
  isSyncing: boolean;
  onSelectProject: (project: Project) => void;
  isCreating: boolean;
  newRequirement: string;
  setNewRequirement: (val: string) => void;
  handleCreateProject: () => void;
  setIsCreating: (val: boolean) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  projects,
  agents,
  onNewProject,
  onSync,
  isSyncing,
  onSelectProject,
  isCreating,
  newRequirement,
  setNewRequirement,
  handleCreateProject,
  setIsCreating
}) => {
  const { t } = useTranslation();

  const stats = [
    { label: t('common.workspaceDetails.activeProjects'), value: projects.length, icon: FolderKanban, color: 'text-sky-400', bg: 'bg-sky-500/10' },
    { label: t('common.agents'), value: agents.length, icon: Users, color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
    { label: t('common.workspaceDetails.sla'), value: '100%', icon: Activity, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: 'System Health', value: 'Healthy', icon: ShieldCheck, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight">{t('common.dashboard')}</h2>
          <p className="text-slate-400 mt-1">{t('common.dashboardDesc')}</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={onSync}
            disabled={isSyncing}
            className="bg-slate-800 hover:bg-slate-700 text-white px-6 py-2.5 rounded-xl font-semibold flex items-center gap-2 transition-all disabled:opacity-50 border border-slate-700"
          >
            <RefreshCw size={20} className={isSyncing ? "animate-spin" : ""} />
            {isSyncing ? t('common.syncing') : t('common.sync')}
          </button>
          <button 
            onClick={onNewProject}
            className="bg-sky-500 hover:bg-sky-600 text-white px-6 py-2.5 rounded-xl font-semibold flex items-center gap-2 transition-all shadow-lg shadow-sky-500/20 active:scale-95"
          >
            <PlusCircle size={20} />
            {t('common.newProject')}
          </button>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {stats.map((stat, i) => (
          <Card key={i} className="bg-[#1A202C]/50 border-slate-800">
            <CardContent className="p-6 flex items-center gap-4">
              <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center", stat.bg, stat.color)}>
                <stat.icon size={24} />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{stat.label}</p>
                <p className="text-2xl font-black text-white mt-1">{stat.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {isCreating && (
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-[#1A202C] border border-sky-500/30 rounded-2xl p-8 shadow-2xl"
        >
          <h3 className="text-xl font-bold text-white mb-4">{t('common.mission')}</h3>
          <textarea 
            value={newRequirement}
            onChange={(e) => setNewRequirement(e.target.value)}
            placeholder={t('common.requirementPlaceholder')}
            className="w-full bg-[#0B1015] border border-slate-700 rounded-xl p-4 text-slate-200 focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-all outline-none min-h-[120px]"
          />
          <div className="flex justify-end gap-3 mt-6">
            <button onClick={() => setIsCreating(false)} className="px-6 py-2 text-slate-400 hover:text-slate-200 font-medium">{t('common.cancel')}</button>
            <button 
              onClick={handleCreateProject}
              className="bg-sky-500 hover:bg-sky-600 text-white px-8 py-2 rounded-xl font-bold transition-all disabled:opacity-50"
              disabled={!newRequirement}
            >
              {t('common.initialize')}
            </button>
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              <FolderKanban size={20} className="text-sky-400" />
              {t('common.activeProjects')}
            </h3>
            <button className="text-xs text-sky-400 hover:text-sky-300 font-bold uppercase tracking-widest">{t('common.viewAll')}</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {projects.map(project => (
              <Card 
                key={project.id} 
                className="group cursor-pointer hover:border-sky-500/50 transition-all duration-300 hover:shadow-sky-500/5 bg-[#1A202C]/50 border-slate-800"
                onClick={() => onSelectProject(project)}
              >
                <CardHeader className="flex flex-row items-center justify-between py-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={project.status === 'active' ? 'success' : 'warning'}>{project.status.toUpperCase()}</Badge>
                    <Badge variant={project.riskLevel === 'low' ? 'success' : project.riskLevel === 'medium' ? 'warning' : 'danger'}>
                      {project.riskLevel.toUpperCase()}
                    </Badge>
                  </div>
                  <span className="text-[10px] font-mono text-slate-600">{project.id}</span>
                </CardHeader>
                <CardContent className="p-6">
                  <h4 className="text-lg font-bold text-white group-hover:text-sky-400 transition-colors leading-tight">{project.name}</h4>
                  <p className="text-slate-500 text-sm mt-2 line-clamp-2 leading-relaxed">{project.description}</p>
                  
                  <div className="mt-6 space-y-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500 font-medium">{t('common.currentStage')}</span>
                      <span className="text-sky-400 font-bold">{t(`common.stages.${project.currentStage}`)}</span>
                    </div>
                    <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${project.progress}%` }}
                        className="bg-sky-500 h-full" 
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              <Activity size={20} className="text-emerald-400" />
              {t('common.recentActivity')}
            </h3>
          </div>
          <Card className="bg-[#1A202C]/50 border-slate-800 h-full">
            <CardContent className="p-6 space-y-6">
              {[
                { type: 'sync', title: 'Project Synced', time: '2m ago', desc: 'OpenClaw Core v2.0 updated from remote.' },
                { type: 'agent', title: 'Agent Active', time: '15m ago', desc: 'Aria (PM) started analysis on Project Alpha.' },
                { type: 'deliverable', title: 'New Deliverable', time: '1h ago', desc: 'PRD v2.0 submitted by Benton.' },
                { type: 'system', title: 'System Healthy', time: '3h ago', desc: 'All API endpoints responding within 200ms.' },
                { type: 'security', title: 'Security Audit', time: '5h ago', desc: 'No intrusion detected in the last 24 hours.' }
              ].map((item, i) => (
                <div key={i} className="flex gap-4 group">
                  <div className="mt-1">
                    <div className="w-2 h-2 rounded-full bg-sky-500 group-hover:scale-125 transition-transform" />
                    <div className="w-0.5 h-full bg-slate-800 mx-auto mt-1" />
                  </div>
                  <div className="space-y-1 pb-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-white group-hover:text-sky-400 transition-colors">{item.title}</p>
                      <span className="text-[10px] text-slate-600 font-mono">{item.time}</span>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};
