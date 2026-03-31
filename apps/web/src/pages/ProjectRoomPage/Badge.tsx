import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

type BadgeVariant = 'default' | 'primary' | 'accent' | 'warning' | 'danger';

export function Badge({
  children,
  variant = 'default',
}: {
  children: ReactNode;
  variant?: BadgeVariant;
}) {
  const variants: Record<BadgeVariant, string> = {
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
