import { cn } from '../../lib/utils';
import type { AuditLogRow } from './useAuditLogs';

type AuditTableProps = {
  logs: AuditLogRow[];
  emptyText: string;
  onViewJson: (raw: unknown) => void;
};

export default function AuditTable({ logs, emptyText, onViewJson }: AuditTableProps) {
  return (
    <div className="bg-surface-soft border border-border-subtle rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-white/5 border-b border-border-subtle">
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">时间戳</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">执行者</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">操作</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">资源</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">状态</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">详情</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {logs.length > 0 ? logs.map((log, index) => (
              <tr key={`${log.time}-${log.actor}-${index}`} className="hover:bg-white/5 transition-colors group">
                <td className="px-6 py-4 text-xs text-slate-500 font-mono">{log.time}</td>
                <td className="px-6 py-4">
                  <span className="text-xs font-bold text-white">{log.actor}</span>
                </td>
                <td className="px-6 py-4">
                  <span className="text-xs text-slate-300">{log.action}</span>
                </td>
                <td className="px-6 py-4">
                  <span className="text-xs text-slate-400 font-mono">{log.resource}</span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-1.5">
                    <div className={cn(
                      'w-1.5 h-1.5 rounded-full',
                      log.status === '成功' ? 'bg-primary' : log.status === '进行中' ? 'bg-accent' : 'bg-warning',
                    )}
                    />
                    <span
                      className={cn(
                        'text-[10px] font-bold uppercase',
                        log.status === '成功' ? 'text-primary' : log.status === '进行中' ? 'text-accent' : 'text-warning',
                      )}
                    >
                      {log.status}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 text-right">
                  <button
                    className="text-[10px] text-primary hover:underline"
                    onClick={() => onViewJson(log.raw ?? log)}
                  >
                    查看 JSON
                  </button>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                  {emptyText}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
