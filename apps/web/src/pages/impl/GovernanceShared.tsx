import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Cpu, X } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { cn } from '../../lib/utils';
import { modelsApi } from '../../lib/api';
import { models } from '../../lib/runtimeCollections';
import type { Model } from '../../types';

export function Badge({ children, variant = 'default' }: any) {
  const variants: any = {
    default: 'bg-white/5 text-slate-400 border-border-subtle',
    primary: 'bg-primary/20 text-primary border-primary/20',
    accent: 'bg-accent/20 text-accent border-accent/20',
    warning: 'bg-warning/20 text-warning border-warning/20',
    danger: 'bg-danger/20 text-danger border-danger/20',
  };

  return (
    <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border', variants[variant])}>
      {children}
    </span>
  );
}

export function ModelUsageChart() {
  const data = useMemo(() => {
    const palette = ['#00f2ff', '#f2ff00', '#ff00f2', '#10b981', '#f97316', '#60a5fa'];
    return models.map((model, index) => ({
      name: model.name,
      value: model.dailyTokens,
      color: palette[index % palette.length],
    }));
  }, []);

  return (
    <div className="h-[280px] w-full flex flex-col items-center justify-center">
      <div className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={55} outerRadius={75} paddingAngle={8} dataKey="value" stroke="none">
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ backgroundColor: '#1a1b1e', border: '1px solid #2d2e32', borderRadius: '12px', fontSize: '12px' }}
              itemStyle={{ color: '#fff' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-4">
        {data.map((entry, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
            <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest truncate max-w-[80px]">{entry.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ModelTerminal({ model }: { model: Model }) {
  const [logs, setLogs] = useState<Array<{ timestamp: string; type: 'bash' | 'assistant' | 'json' | 'system'; content: string; label?: string }>>(model.logs || []);
  const [isConnected, setIsConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLogs(model.logs || []);
  }, [model.id, model.logs]);

  useEffect(() => {
    if (!model.id) {
      setLogs([]);
      setIsConnected(false);
      return;
    }

    let active = true;

    const fetchLogs = async () => {
      try {
        const data = await modelsApi.getLogs(model.id, undefined, 50);
        if (!active) return;

        const normalized = (data || [])
          .map((item) => ({ timestamp: item.timestamp, type: item.type, content: item.content, label: item.label }))
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        setLogs(normalized);
        setIsConnected(true);
      } catch {
        if (!active) return;
        setIsConnected(false);
      }
    };

    void fetchLogs();
    const interval = window.setInterval(() => void fetchLogs(), 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [model.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="bg-surface-muted border border-border-subtle rounded-2xl overflow-hidden flex flex-col h-[500px] shadow-inner font-mono">
      <div className="px-4 py-2 bg-black/40 border-b border-border-subtle flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className={cn('w-2 h-2 rounded-full', isConnected ? 'bg-primary animate-pulse' : 'bg-slate-500')} />
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{model.name} @ aegis-os</span>
        </div>
        <div className="flex gap-1.5">
          <div className="w-2 h-2 rounded-full bg-red-500/20 border border-red-500/40" />
          <div className="w-2 h-2 rounded-full bg-amber-500/20 border border-amber-500/40" />
          <div className="w-2 h-2 rounded-full bg-green-500/20 border border-green-500/40" />
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 p-4 overflow-y-auto text-[11px] space-y-4 scrollbar-hide bg-black/20">
        {logs.map((log, i) => (
          <div key={i} className="space-y-1">
            <div className="flex items-center gap-2 opacity-40 text-[9px]">
              <span className="text-primary font-bold">[{log.timestamp}]</span>
              <span className="uppercase tracking-tighter">{log.type}</span>
            </div>
            <div className={cn(
              'p-3 rounded-lg border',
              log.type === 'bash' ? 'bg-white/5 border-white/10 text-slate-300' :
              log.type === 'json' ? 'bg-blue-500/5 border-blue-500/20 text-blue-300' :
              log.type === 'assistant' ? 'bg-primary/5 border-primary/20 text-white' :
              'bg-amber-500/5 border-amber-500/20 text-amber-300',
            )}>
              {log.label && <p className="text-slate-500 font-bold mb-1">{log.label}:</p>}
              <pre className="whitespace-pre-wrap break-all leading-relaxed">
                {log.type === 'bash' && <span className="text-primary mr-2">$</span>}
                {log.content}
              </pre>
            </div>
          </div>
        ))}
        <div className="flex items-center gap-2 text-primary">
          <span className="animate-pulse font-bold">▋</span>
        </div>
      </div>
    </div>
  );
}

export function Dialog({
  isOpen,
  onClose,
  title,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 md:p-8">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-4xl bg-surface-soft border border-border-subtle rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="px-6 py-4 border-b border-border-subtle flex justify-between items-center bg-white/5">
              <h3 className="text-lg font-bold text-white">{title}</h3>
              <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl text-slate-400 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export { Cpu };
