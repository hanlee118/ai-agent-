import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { useId, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

type SurfaceModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  panelClassName?: string;
  bodyClassName?: string;
};

export default function SurfaceModal({
  isOpen,
  onClose,
  title,
  children,
  panelClassName,
  bodyClassName,
}: SurfaceModalProps) {
  const titleId = useId();

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-surface/80 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'relative w-full max-w-2xl bg-surface-soft border border-border-subtle rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]',
          panelClassName,
        )}
      >
        <header className="px-8 py-6 border-b border-border-subtle flex justify-between items-center bg-white/5">
          <h2 id={titleId} className="text-xl font-bold text-white">{title}</h2>
          <button
            onClick={onClose}
            aria-label="关闭弹窗"
            className="p-2 text-slate-500 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </header>
        <div className={cn('flex-1 overflow-y-auto p-8', bodyClassName)}>{children}</div>
      </motion.div>
    </div>
  );
}
