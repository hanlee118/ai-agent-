import { ChevronRight, FileText } from 'lucide-react';

type DeliverableStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

type SideDeliverableRef = {
  id: string;
  name: string;
  type: string;
  status: DeliverableStatus;
  stageType: string;
  content?: string;
  version?: number;
  createdBy?: string;
  updatedAt: string;
};

export type ProjectRoomSideDeliverableItem = {
  id: string;
  name: string;
  type: string;
  size: string;
  deliverable?: SideDeliverableRef;
};

type Props = {
  items: ProjectRoomSideDeliverableItem[];
  onPreviewDeliverable: (deliverable: SideDeliverableRef) => void;
};

export default function SideDeliverablesPanel({ items, onPreviewDeliverable }: Props) {
  return (
    <section className="space-y-4">
      <h3 className="text-[10px] uppercase tracking-widest font-bold text-slate-500 flex items-center gap-2">
        <FileText size={12} />
        交付物
      </h3>
      <div className="space-y-2">
        {items.map((file) => (
          <button
            key={file.id}
            type="button"
            onClick={() => {
              if (file.deliverable) {
                onPreviewDeliverable(file.deliverable);
              }
            }}
            className="w-full flex items-center justify-between p-3 bg-white/5 rounded-xl border border-border-subtle hover:bg-white/10 transition-colors cursor-pointer group text-left"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-slate-500 group-hover:text-primary transition-colors">
                <FileText size={14} />
              </div>
              <div className="min-w-0">
                <span className="text-xs text-slate-300 font-medium block truncate">{file.name}</span>
                <span className="text-[10px] text-slate-500">
                  {file.type} • {file.size}
                </span>
              </div>
            </div>
            <ChevronRight size={14} className="text-slate-600 group-hover:text-white transition-colors" />
          </button>
        ))}
      </div>
    </section>
  );
}
