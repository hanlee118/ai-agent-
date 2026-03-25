import React from 'react';
import { 
  Hash, 
  MessageSquare, 
  Users, 
  FolderKanban, 
  LayoutDashboard, 
  Activity, 
  History, 
  Settings,
  Search,
  Bell,
  ChevronDown,
  Plus,
  Circle,
  Terminal,
  Cpu,
  Database
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../contexts/LanguageContext';

interface WorkspaceShellProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: any) => void;
  onNewProject: () => void;
  projects: any[];
  agents: any[];
  onSelectProject: (project: any) => void;
  onSelectAgent: (agent: any) => void;
}

export const WorkspaceShell: React.FC<WorkspaceShellProps> = ({
  children,
  activeTab,
  setActiveTab,
  onNewProject,
  projects,
  agents,
  onSelectProject,
  onSelectAgent
}) => {
  const { t } = useTranslation();

  const workspaces = [
    { id: 'oc', name: 'OpenClaw', icon: Terminal, color: 'bg-sky-500' },
    { id: 'lab', name: 'AI Lab', icon: Cpu, color: 'bg-indigo-500' },
    { id: 'data', name: 'Data Hub', icon: Database, color: 'bg-emerald-500' },
  ];

  const mainNav = [
    { id: 'dashboard', icon: LayoutDashboard, label: t('common.dashboard') },
    { id: 'projects', icon: FolderKanban, label: t('common.projects') },
    { id: 'agents', icon: Users, label: t('common.agents') },
    { id: 'system', icon: Activity, label: t('common.system') },
    { id: 'audit', icon: History, label: t('common.audit') },
  ];

  return (
    <div className="flex h-screen bg-[#080B10] text-slate-300 overflow-hidden font-sans">
      {/* Workspace Switcher (Narrowest Bar) */}
      <div className="w-[70px] bg-[#0B1015] border-r border-slate-800 flex flex-col items-center py-4 gap-4 shrink-0">
        {workspaces.map((ws) => (
          <button
            key={ws.id}
            className={cn(
              "w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-200 group relative",
              ws.color,
              ws.id === 'oc' ? "ring-2 ring-sky-500 ring-offset-2 ring-offset-[#0B1015]" : "opacity-50 hover:opacity-100"
            )}
          >
            <ws.icon className="text-white" size={24} />
            <div className="absolute left-full ml-2 px-2 py-1 bg-slate-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50">
              {ws.name}
            </div>
          </button>
        ))}
        <div className="flex-1" />
        <button className="w-12 h-12 rounded-xl border-2 border-dashed border-slate-700 flex items-center justify-center text-slate-500 hover:text-slate-300 hover:border-slate-500 transition-all">
          <Plus size={24} />
        </button>
      </div>

      {/* Sidebar (Navigation & Lists) */}
      <div className="w-64 bg-[#0B1015] border-r border-slate-800 flex flex-col shrink-0">
        {/* Workspace Header */}
        <div className="h-14 px-4 flex items-center justify-between border-b border-slate-800 hover:bg-slate-800/30 cursor-pointer group">
          <h2 className="font-bold text-white truncate">OpenClaw Workspace</h2>
          <ChevronDown size={16} className="text-slate-500 group-hover:text-slate-300" />
        </div>

        <div className="flex-1 overflow-y-auto py-4 custom-scrollbar">
          {/* Main Navigation */}
          <div className="px-2 space-y-0.5 mb-8">
            {mainNav.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-sm transition-all group",
                  activeTab === item.id 
                    ? "bg-sky-500/10 text-sky-400 font-semibold" 
                    : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                )}
              >
                <item.icon size={18} className={cn(
                  activeTab === item.id ? "text-sky-400" : "text-slate-500 group-hover:text-slate-300"
                )} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>

          {/* Projects Section */}
          <div className="mb-8">
            <div className="px-4 py-2 flex items-center justify-between group">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Projects</span>
              <button onClick={onNewProject} className="p-1 hover:bg-slate-800 rounded text-slate-500 hover:text-slate-300 opacity-0 group-hover:opacity-100 transition-all">
                <Plus size={14} />
              </button>
            </div>
            <div className="px-2 space-y-0.5">
              {projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => onSelectProject(project)}
                  className="w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-sm text-slate-400 hover:bg-slate-800/50 hover:text-slate-200 transition-all group"
                >
                  <Hash size={16} className="text-slate-500 group-hover:text-slate-400" />
                  <span className="truncate">{project.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Agents Section */}
          <div className="mb-8">
            <div className="px-4 py-2 flex items-center justify-between group">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Agents</span>
              <button className="p-1 hover:bg-slate-800 rounded text-slate-500 hover:text-slate-300 opacity-0 group-hover:opacity-100 transition-all">
                <Plus size={14} />
              </button>
            </div>
            <div className="px-2 space-y-0.5">
              {agents.map((agent) => (
                <button
                  key={agent.roleId}
                  onClick={() => onSelectAgent(agent)}
                  className="w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-sm text-slate-400 hover:bg-slate-800/50 hover:text-slate-200 transition-all group"
                >
                  <div className="relative">
                    <div className="w-4 h-4 rounded bg-sky-500/20 flex items-center justify-center text-[10px] font-bold text-sky-400">
                      {agent.name[0]}
                    </div>
                    <div className={cn(
                      "absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full border border-[#0B1015]",
                      agent.status === 'idle' ? "bg-emerald-500" : "bg-amber-500"
                    )} />
                  </div>
                  <span className="truncate">{agent.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* User Profile / Settings */}
        <div className="p-4 border-t border-slate-800 flex items-center gap-3 hover:bg-slate-800/30 cursor-pointer transition-all">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-white font-bold">
            C
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white truncate">Commander</p>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest">Level 4 Access</p>
          </div>
          <Settings size={16} className="text-slate-500" />
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <div className="h-14 px-6 flex items-center justify-between border-b border-slate-800 bg-[#0B1015]/50 backdrop-blur-sm shrink-0">
          <div className="flex-1 max-w-2xl">
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-sky-400 transition-colors" size={16} />
              <input
                type="text"
                placeholder={t('common.searchPlaceholder')}
                className="w-full bg-slate-900/50 border border-slate-800 rounded-lg pl-10 pr-4 py-1.5 text-sm text-slate-200 outline-none focus:ring-1 focus:ring-sky-500/50 focus:border-sky-500/50 transition-all"
              />
            </div>
          </div>
          <div className="flex items-center gap-4 ml-4">
            <button className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all relative">
              <Bell size={20} />
              <div className="absolute top-2 right-2 w-2 h-2 bg-rose-500 rounded-full border-2 border-[#0B1015]" />
            </button>
            <div className="h-6 w-px bg-slate-800" />
            <button 
              onClick={() => setActiveTab('settings')}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
            >
              <Settings size={20} />
            </button>
          </div>
        </div>

        {/* Content Viewport */}
        <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#080B10]">
          <div className="p-8 max-w-[1600px] mx-auto">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};
