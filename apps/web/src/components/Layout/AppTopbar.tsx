import React from 'react';
import { ChevronRight, LogOut, Search } from 'lucide-react';
import NotificationCenter from '../../features/notifications/NotificationCenter';
import type { NotificationItem } from '../../features/notifications/useNotifications';

const resolveTabLabel = (activeTab: string) => {
  if (activeTab === 'dashboard') return '仪表盘';
  if (activeTab === 'agent-commander') return 'Agent 指挥官';
  if (activeTab === 'project-room') return '项目室';
  if (activeTab === 'system-health') return '系统运行';
  if (activeTab === 'monitoring') return '实时监控';
  if (activeTab === 'projects') return '项目组合';
  if (activeTab === 'agents') return 'Agent 名册';
  if (activeTab === 'workspace') return 'OpenClaw 工作区';
  if (activeTab === 'knowledge-hub') return '知识库（上传/查阅/编辑）';
  if (activeTab === 'audit') return '审计追踪';
  if (activeTab === 'settings') return '设置';
  return activeTab.replace('-', ' ');
};

type AppTopbarProps = {
  activeTab: string;
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  showNotifications: boolean;
  onToggleNotifications: () => void;
  onCloseNotifications: () => void;
  notifications: NotificationItem[];
  unreadCount: number;
  notificationsLoading: boolean;
  markingAllRead: boolean;
  onMarkAllRead: () => void;
  onNotificationClick: (notification: NotificationItem) => void;
  onViewHistory: () => void;
  onLogout: () => void;
};

export default function AppTopbar({
  activeTab,
  sidebarOpen,
  onOpenSidebar,
  showNotifications,
  onToggleNotifications,
  onCloseNotifications,
  notifications,
  unreadCount,
  notificationsLoading,
  markingAllRead,
  onMarkAllRead,
  onNotificationClick,
  onViewHistory,
  onLogout,
}: AppTopbarProps) {
  return (
    <header className="h-16 border-b border-border-subtle flex items-center justify-between px-6 shrink-0 bg-surface/50 backdrop-blur-md z-10">
      <div className="flex items-center gap-4">
        {!sidebarOpen && (
          <button onClick={onOpenSidebar} className="p-2 bg-white/5 border border-border-subtle rounded-lg text-slate-500 hover:text-white transition-colors">
            <ChevronRight size={16} />
          </button>
        )}
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="hover:text-slate-300 cursor-pointer">工作区</span>
          <ChevronRight size={12} />
          <span className="text-slate-300 font-medium capitalize">{resolveTabLabel(activeTab)}</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative hidden md:block">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="搜索任何内容... (⌘K)"
            className="bg-white/5 border border-border-subtle rounded-lg pl-9 pr-4 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 w-64 transition-all focus:w-80"
          />
        </div>
        <NotificationCenter
          open={showNotifications}
          onToggle={onToggleNotifications}
          onClose={onCloseNotifications}
          notifications={notifications}
          unreadCount={unreadCount}
          loading={notificationsLoading}
          markingAllRead={markingAllRead}
          onMarkAllRead={onMarkAllRead}
          onNotificationClick={onNotificationClick}
          onViewHistory={onViewHistory}
        />
        <div className="h-6 w-px bg-border-subtle" />
        <div className="flex items-center gap-2">
          <button className="px-2 py-1 bg-white/5 border border-border-subtle rounded text-[10px] font-bold text-slate-400 hover:text-white transition-colors">
            CN
          </button>
          <button onClick={onLogout} className="p-2 text-slate-500 hover:text-danger transition-colors">
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}
