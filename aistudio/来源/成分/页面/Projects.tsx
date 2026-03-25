import React from 'react';
import { 
  FolderKanban, 
  Search, 
  Plus, 
  ChevronRight, 
  Activity, 
  ShieldCheck, 
  Clock, 
  FileText, 
  Filter 
} from 'lucide-react';
import { Card, CardHeader, CardContent, Badge } from '../ui/Card';
import { useTranslation } from '../../contexts/LanguageContext';
import { Project } from '../../types';
import { cn } from '../../lib/utils';
import { motion } from 'motion/react';

interface ProjectsProps {
  projects: Project[];
  onSelectProject: (project: Project) => void;
  onNewProject: () => void;
}

export const Projects: React.FC<ProjectsProps> = ({
  projects,
  onSelectProject,
  onNewProject
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight">{t('common.projects')}</h2>
          <p className="text-slate-400 mt-1">Manage and monitor your AI-driven project team workflows.</p>
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
          <button className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2.5 rounded-xl font-semibold flex items-center gap-2 transition-all border border-slate-700">
            <Filter size={20} />
            Filter
          </button>
          <button 
            onClick={onNewProject}
            className="bg-sky-500 hover:bg-sky-600 text-white px-6 py-2.5 rounded-xl font-semibold flex items-center gap-2 transition-all shadow-lg shadow-sky-500/20 active:scale-95"
          >
            <Plus size={20} />
            {t('common.newProject')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {projects.map((project) => (
          <Card 
            key={project.id} 
            className="group cursor-pointer hover:border-sky-500/50 transition-all duration-300 hover:shadow-sky-500/5 bg-[#1A202C]/50 border-slate-800 overflow-hidden"
            onClick={() => onSelectProject(project)}
          >
            <div className={cn(
              "h-2",
              project.riskLevel === 'low' ? "bg-emerald-500" : 
              project.riskLevel === 'medium' ? "bg-amber-500" : 
              "bg-rose-500"
            )} />
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-6">
                <div className="w-14 h-14 bg-sky-500/10 rounded-2xl flex items-center justify-center text-sky-400 border border-sky-500/20 group-hover:scale-110 transition-transform">
                  <FolderKanban size={28} />
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge variant={project.status === 'active' ? 'success' : 'warning'}>
                    {project.status.toUpperCase()}
                  </Badge>
                  <span className="text-[10px] font-mono text-slate-600">{project.id}</span>
                </div>
              </div>

              <div className="space-y-1">
                <h4 className="text-xl font-bold text-white group-hover:text-sky-400 transition-colors leading-tight">{project.name}</h4>
                <p className="text-xs text-slate-500 font-mono uppercase tracking-widest">{t(`common.stages.${project.currentStage}`)}</p>
              </div>

              <p className="text-sm text-slate-400 mt-4 line-clamp-2 leading-relaxed h-10">
                {project.description}
              </p>

              <div className="mt-6 space-y-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-medium">Progress</span>
                  <span className="text-sky-400 font-bold">{project.progress}%</span>
                </div>
                <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${project.progress}%` }}
                    className="bg-sky-500 h-full" 
                  />
                </div>
              </div>

              <div className="mt-6 pt-6 border-t border-slate-800 flex items-center justify-between">
                <div className="flex -space-x-2">
                  {project.team.map((role, i) => (
                    <div key={i} className="w-8 h-8 rounded-full bg-slate-800 border-2 border-[#1A202C] flex items-center justify-center text-[10px] font-bold text-slate-400">
                      {role[0]}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5 text-slate-500">
                    <FileText size={14} />
                    <span className="text-xs font-bold">{project.deliverables.length}</span>
                  </div>
                  <button className="p-2 bg-slate-800 group-hover:bg-sky-500 rounded-lg text-slate-500 group-hover:text-white transition-all">
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};
