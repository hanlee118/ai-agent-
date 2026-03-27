import { AnimatePresence, motion } from 'motion/react';
import { Bell } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { NotificationItem } from './useNotifications';

type NotificationCenterProps = {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  notifications: NotificationItem[];
  unreadCount: number;
  loading: boolean;
  markingAllRead: boolean;
  onMarkAllRead: () => void;
  onNotificationClick: (notification: NotificationItem) => void;
  onViewHistory: () => void;
};

export default function NotificationCenter({
  open,
  onToggle,
  onClose,
  notifications,
  unreadCount,
  loading,
  markingAllRead,
  onMarkAllRead,
  onNotificationClick,
  onViewHistory,
}: NotificationCenterProps) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className={cn('p-2 text-slate-500 hover:text-white relative transition-colors', open && 'text-white')}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <div className="absolute top-2 right-2 w-2 h-2 bg-danger rounded-full border-2 border-surface" />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={onClose} />
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute right-0 mt-2 w-80 bg-surface-soft border border-border-subtle rounded-2xl shadow-2xl z-50 overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-border-subtle bg-white/5 flex justify-between items-center">
                <h3 className="text-xs font-bold text-white uppercase tracking-widest">通知中心</h3>
                <button
                  className="text-[10px] text-primary hover:underline disabled:opacity-60"
                  onClick={onMarkAllRead}
                  disabled={markingAllRead || loading}
                >
                  {markingAllRead ? '处理中...' : '全部已读'}
                </button>
              </div>
              <div className="max-h-96 overflow-y-auto divide-y divide-border-subtle">
                {loading && (
                  <div className="p-4 text-[10px] text-slate-500">正在加载通知...</div>
                )}
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    onClick={() => onNotificationClick(notification)}
                    className={cn(
                      'p-4 hover:bg-white/5 transition-colors cursor-pointer',
                      notification.read ? 'opacity-75' : 'opacity-100',
                    )}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <div className="flex items-center gap-2">
                        {!notification.read && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
                        <h4 className="text-xs font-bold text-white">{notification.title}</h4>
                      </div>
                      <span className="text-[8px] text-slate-500 uppercase tracking-widest">{notification.time}</span>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-relaxed">{notification.content}</p>
                  </div>
                ))}
              </div>
              <div className="px-4 py-2 border-t border-border-subtle bg-white/5 text-center">
                <button
                  className="text-[10px] font-bold text-slate-500 hover:text-white transition-colors uppercase tracking-widest"
                  onClick={onViewHistory}
                >
                  查看历史通知
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
