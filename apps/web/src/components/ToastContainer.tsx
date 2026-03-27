import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '../lib/utils';

type Toast = {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
};

export default function ToastContainer({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, x: 50, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, scale: 0.95 }}
            className={cn(
              'px-4 py-3 rounded-xl shadow-2xl border flex items-center gap-3 min-w-[240px] pointer-events-auto',
              toast.type === 'success' ? 'bg-primary/10 border-primary/20 text-primary' :
              toast.type === 'error' ? 'bg-danger/10 border-danger/20 text-danger' :
              'bg-surface-muted border-border-subtle text-white',
            )}
          >
            {toast.type === 'success' && <CheckCircle2 size={18} />}
            {toast.type === 'error' && <AlertCircle size={18} />}
            {toast.type === 'info' && <Info size={18} />}
            <span className="text-sm font-medium">{toast.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
