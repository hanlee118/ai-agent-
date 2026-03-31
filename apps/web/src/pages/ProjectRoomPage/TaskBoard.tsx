import { BrainCircuit, Layers } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';
import { Badge } from './Badge';

type TaskItem = {
  id: string;
  title: string;
  agent: string;
  status: 'Completed' | 'In Progress' | 'Blocked' | 'Pending';
  progress: number;
};

type Props = {
  tasks: TaskItem[];
};

export default function TaskBoard({ tasks }: Props) {
  return (
    <section className="space-y-4">
      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
        <Layers size={14} />
        活跃任务
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {tasks.map((task) => (
          <div key={task.id} className="bg-surface-soft border border-border-subtle p-5 rounded-2xl space-y-4 hover:border-white/20 transition-all group">
            <div className="flex justify-between items-start">
              <div>
                <h4 className="font-semibold text-white text-sm group-hover:text-primary transition-colors">{task.title}</h4>
                <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                  <BrainCircuit size={10} />
                  指派给: {task.agent}
                </p>
              </div>
              <Badge variant={task.status === 'Completed' ? 'primary' : task.status === 'In Progress' ? 'accent' : task.status === 'Blocked' ? 'danger' : 'default'}>
                {task.status === 'Completed' ? '已完成' : task.status === 'In Progress' ? '进行中' : task.status === 'Blocked' ? '已阻塞' : '待处理'}
              </Badge>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-[10px] text-slate-500">
                <span>进度</span>
                <span>{task.progress}%</span>
              </div>
              <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${task.progress}%` }}
                  className={cn('h-full rounded-full transition-all duration-500', task.status === 'Blocked' ? 'bg-danger' : 'bg-primary')}
                />
              </div>
            </div>
          </div>
        ))}
        {tasks.length === 0 ? (
          <div className="col-span-full bg-surface-soft border border-border-subtle p-6 rounded-2xl text-center text-sm text-slate-500">
            当前项目暂无任务数据
          </div>
        ) : null}
      </div>
    </section>
  );
}
