import type { StatusVariant, Task, TaskView } from '../../types';

const statusMeta: Record<Task['status'], { label: string; variant: StatusVariant }> = {
  Pending: { label: '待处理', variant: 'default' },
  'In Progress': { label: '进行中', variant: 'warning' },
  Completed: { label: '已完成', variant: 'primary' },
  Blocked: { label: '阻塞', variant: 'danger' },
};

export function toTaskView(task: Task): TaskView {
  const meta = statusMeta[task.status] ?? statusMeta.Pending;

  return {
    ...task,
    statusLabel: meta.label,
    statusVariant: meta.variant,
    progressLabel: `${Math.round(task.progress || 0)}%`,
  };
}

export function toTaskViews(tasks: Task[]): TaskView[] {
  return tasks.map(toTaskView);
}
