import { Terminal } from 'lucide-react';

type LogItem = {
  timestamp: number;
  time: string;
  actor: string;
  type: 'danger' | 'accent' | 'primary';
  message: string;
};

type Props = {
  logs: LogItem[];
};

export default function LiveSessionPanel({ logs }: Props) {
  return (
    <section className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
          <Terminal size={14} />
          实时输出流
        </h3>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-[10px] text-primary font-bold uppercase">直播</span>
        </div>
      </div>
      <div className="bg-surface-muted border border-border-subtle rounded-2xl p-6 font-mono text-xs space-y-2 max-h-96 overflow-y-auto scrollbar-hide">
        {logs.map((log, i) => (
          <p key={`${log.timestamp}-${i}`} className="text-slate-500">
            <span className="text-slate-600">[{log.time}]</span>{' '}
            <span className={log.type === 'danger' ? 'text-danger' : log.type === 'accent' ? 'text-accent' : 'text-primary'}>{log.actor}:</span>{' '}
            {log.message}
          </p>
        ))}
        {logs.length === 0 ? <p className="text-slate-600">暂无实时日志</p> : null}
        <div className="w-1 h-4 bg-primary animate-pulse inline-block align-middle ml-1" />
      </div>
    </section>
  );
}
