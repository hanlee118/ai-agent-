import { motion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Database,
  Briefcase,
  ChevronLeft,
  Globe,
  History,
  Layers,
  LayoutDashboard,
  LogOut,
  Settings,
  Terminal,
  Users,
  Zap,
} from 'lucide-react';
import { cn } from '../../lib/utils';

type NavItemProps = {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
  collapsed: boolean;
  badge?: string;
};

type SidebarProps = {
  activeTab: string;
  sidebarOpen: boolean;
  onTabChange: (tab: string) => void;
  onCollapse: () => void;
  onLogout: () => void;
};

const NavItem = ({ icon: Icon, label, active, onClick, collapsed, badge }: NavItemProps) => (
  <button
    onClick={onClick}
    className={cn(
      'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group relative',
      active
        ? 'bg-primary text-surface shadow-lg shadow-primary/20'
        : 'text-slate-400 hover:bg-white/5 hover:text-white',
      collapsed && 'justify-center px-0',
    )}
  >
    <Icon size={20} className={cn('shrink-0', active ? 'text-surface' : 'group-hover:scale-110 transition-transform')} />
    {!collapsed && (
      <motion.span
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        className="text-xs font-bold whitespace-nowrap overflow-hidden"
      >
        {label}
      </motion.span>
    )}
    {badge && !collapsed && (
      <span className="ml-auto px-1.5 py-0.5 bg-danger text-[8px] font-bold text-white rounded-full">
        {badge}
      </span>
    )}
    {collapsed && (
      <div className="absolute left-14 bg-surface-muted border border-border-subtle px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
        {label}
      </div>
    )}
  </button>
);

export default function Sidebar({
  activeTab,
  sidebarOpen,
  onTabChange,
  onCollapse,
  onLogout,
}: SidebarProps) {
  return (
    <motion.aside
      initial={false}
      animate={{ width: sidebarOpen ? 240 : 64 }}
      className="border-r border-border-subtle flex flex-col shrink-0 bg-surface z-30 relative"
    >
      <div className="p-4 flex items-center gap-4 h-16 border-b border-border-subtle/50">
        <div
          className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center text-primary cursor-pointer hover:scale-105 transition-transform shrink-0"
          onClick={() => onTabChange('dashboard')}
        >
          <Zap size={24} fill="currentColor" />
        </div>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col"
          >
            <h2 className="text-xs font-bold text-white uppercase tracking-widest leading-none">Aegis OS</h2>
            <span className="text-[8px] text-slate-500 font-bold uppercase tracking-tighter mt-1">Command Center</span>
          </motion.div>
        )}
      </div>

      <nav className="flex-1 px-3 py-6 space-y-2 overflow-y-auto scrollbar-hide">
        <NavItem
          icon={LayoutDashboard}
          label="概览"
          active={activeTab === 'dashboard'}
          onClick={() => onTabChange('dashboard')}
          collapsed={!sidebarOpen}
        />
        <NavItem
          icon={Briefcase}
          label="项目组合"
          active={activeTab === 'projects' || activeTab === 'project-room'}
          onClick={() => onTabChange('projects')}
          collapsed={!sidebarOpen}
        />
        <NavItem
          icon={Users}
          label="Agent 名册"
          active={activeTab === 'agents' || activeTab === 'agent-commander'}
          onClick={() => onTabChange('agents')}
          collapsed={!sidebarOpen}
        />
        <NavItem
          icon={Layers}
          label="模型中心"
          active={activeTab === 'model-nexus'}
          onClick={() => onTabChange('model-nexus')}
          collapsed={!sidebarOpen}
        />
        <NavItem
          icon={Terminal}
          label="实时监控"
          active={activeTab === 'monitoring'}
          onClick={() => onTabChange('monitoring')}
          collapsed={!sidebarOpen}
        />
        <NavItem
          icon={Globe}
          label="工作区"
          active={activeTab === 'workspace'}
          onClick={() => onTabChange('workspace')}
          collapsed={!sidebarOpen}
        />
        <NavItem
          icon={Database}
          label="知识治理"
          active={activeTab === 'knowledge-hub'}
          onClick={() => onTabChange('knowledge-hub')}
          collapsed={!sidebarOpen}
        />

        <div className="py-4">
          <div className={cn('h-px bg-border-subtle/50 mx-2', !sidebarOpen && 'mx-1')} />
        </div>

        <NavItem
          icon={Activity}
          label="系统运行"
          active={activeTab === 'system-health'}
          onClick={() => onTabChange('system-health')}
          collapsed={!sidebarOpen}
        />
        <NavItem
          icon={History}
          label="审计追踪"
          active={activeTab === 'audit'}
          onClick={() => onTabChange('audit')}
          collapsed={!sidebarOpen}
        />
        <NavItem
          icon={Settings}
          label="设置"
          active={activeTab === 'settings'}
          onClick={() => onTabChange('settings')}
          collapsed={!sidebarOpen}
        />
      </nav>

      <div className="p-4 border-t border-border-subtle bg-white/5">
        <div className={cn('flex items-center gap-3', !sidebarOpen && 'justify-center')}>
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-accent to-primary p-0.5 cursor-pointer group relative shrink-0">
            <div className="w-full h-full rounded-full bg-surface flex items-center justify-center text-[10px] font-bold">ME</div>
            {!sidebarOpen && (
              <div className="absolute left-12 top-0 bg-surface-muted border border-border-subtle px-2 py-1 rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                merypto2025@gmail.com
              </div>
            )}
          </div>
          {sidebarOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex-1 min-w-0"
            >
              <p className="text-[10px] font-bold text-white truncate">merypto2025</p>
              <p className="text-[8px] text-slate-500 truncate">系统管理员</p>
            </motion.div>
          )}
          {sidebarOpen && (
            <button onClick={onLogout} className="text-slate-500 hover:text-danger transition-colors ml-auto" title="退出登录">
              <LogOut size={16} />
            </button>
          )}
          {sidebarOpen && (
            <button onClick={onCollapse} className="text-slate-500 hover:text-white transition-colors ml-2">
              <ChevronLeft size={16} />
            </button>
          )}
        </div>
      </div>
    </motion.aside>
  );
}
