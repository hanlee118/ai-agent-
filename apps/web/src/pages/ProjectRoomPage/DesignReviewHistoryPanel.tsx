import { ShieldCheck } from 'lucide-react';
import { Badge } from './Badge';

export type ProjectRoomDesignReviewHistoryItem = {
  submittedAt: string;
  reviewer: string;
  approved: boolean;
  visualDirection: string;
};

type Props = {
  items: ProjectRoomDesignReviewHistoryItem[];
};

export default function DesignReviewHistoryPanel({ items }: Props) {
  return (
    <section className="space-y-4">
      <h3 className="text-[10px] uppercase tracking-widest font-bold text-slate-500 flex items-center gap-2">
        <ShieldCheck size={12} />
        设计审查记录
      </h3>
      <div className="space-y-2">
        {items.length > 0 ? items.map((item, index) => (
          <div key={`${item.submittedAt}-${index}`} className="p-3 rounded-xl border border-border-subtle bg-white/5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-white font-semibold">{item.visualDirection}</span>
              <Badge variant={item.approved ? 'primary' : 'warning'}>{item.approved ? '通过' : '未通过'}</Badge>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              审查人: {item.reviewer} · {new Date(item.submittedAt).toLocaleString('zh-CN')}
            </p>
          </div>
        )) : (
          <p className="text-[11px] text-slate-500">暂无设计审查记录</p>
        )}
      </div>
    </section>
  );
}
