import type { Dispatch, SetStateAction } from 'react';
import SurfaceModal from '../impl/SurfaceModal';

export type ProjectRoomDesignReviewForm = {
  visualDirection: string;
  brandTone: string;
  layoutStrategy: string;
  componentSpecs: string;
  uxPrinciples: string;
  accessibilityChecklist: string;
  approvedBy: string;
  notes: string;
  approved: boolean;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  form: ProjectRoomDesignReviewForm;
  setForm: Dispatch<SetStateAction<ProjectRoomDesignReviewForm>>;
  tips: string[];
  isSubmitting: boolean;
  onSubmit: () => void;
};

export default function DesignReviewModal({
  isOpen,
  onClose,
  form,
  setForm,
  tips,
  isSubmitting,
  onSubmit,
}: Props) {
  return (
    <SurfaceModal
      isOpen={isOpen}
      onClose={onClose}
      title="设计审查卡（开发前必填）"
      panelClassName="max-w-3xl"
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="space-y-2">
            <span className="text-xs text-slate-400">视觉方向</span>
            <input
              value={form.visualDirection}
              onChange={(e) => setForm((prev) => ({ ...prev, visualDirection: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg bg-surface-muted border border-border-subtle text-sm text-white"
              placeholder="例如：可信赖科技蓝 + 高信息密度"
            />
          </label>
          <label className="space-y-2">
            <span className="text-xs text-slate-400">品牌语气</span>
            <input
              value={form.brandTone}
              onChange={(e) => setForm((prev) => ({ ...prev, brandTone: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg bg-surface-muted border border-border-subtle text-sm text-white"
              placeholder="例如：专业、直接、可执行"
            />
          </label>
        </div>

        <label className="space-y-2 block">
          <span className="text-xs text-slate-400">版式策略</span>
          <textarea
            value={form.layoutStrategy}
            onChange={(e) => setForm((prev) => ({ ...prev, layoutStrategy: e.target.value }))}
            rows={3}
            className="w-full px-3 py-2 rounded-lg bg-surface-muted border border-border-subtle text-sm text-white"
            placeholder="例如：首屏价值说明 -> 能力矩阵 -> 流程闭环 -> 案例 -> CTA"
          />
        </label>

        <label className="space-y-2 block">
          <span className="text-xs text-slate-400">组件规范</span>
          <textarea
            value={form.componentSpecs}
            onChange={(e) => setForm((prev) => ({ ...prev, componentSpecs: e.target.value }))}
            rows={3}
            className="w-full px-3 py-2 rounded-lg bg-surface-muted border border-border-subtle text-sm text-white"
            placeholder="例如：Hero、能力卡、流程步骤、案例引用、联系 CTA"
          />
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="space-y-2 block">
            <span className="text-xs text-slate-400">UX 原则（至少 3 条，换行分隔）</span>
            <textarea
              value={form.uxPrinciples}
              onChange={(e) => setForm((prev) => ({ ...prev, uxPrinciples: e.target.value }))}
              rows={4}
              className="w-full px-3 py-2 rounded-lg bg-surface-muted border border-border-subtle text-sm text-white"
              placeholder={'主路径优先\n强反馈\n低认知负担'}
            />
          </label>
          <label className="space-y-2 block">
            <span className="text-xs text-slate-400">可访问性清单（至少 3 条，换行分隔）</span>
            <textarea
              value={form.accessibilityChecklist}
              onChange={(e) => setForm((prev) => ({ ...prev, accessibilityChecklist: e.target.value }))}
              rows={4}
              className="w-full px-3 py-2 rounded-lg bg-surface-muted border border-border-subtle text-sm text-white"
              placeholder={'对比度 >= 4.5\n键盘可达\n语义化标题结构'}
            />
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="space-y-2">
            <span className="text-xs text-slate-400">审查人</span>
            <input
              value={form.approvedBy}
              onChange={(e) => setForm((prev) => ({ ...prev, approvedBy: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg bg-surface-muted border border-border-subtle text-sm text-white"
            />
          </label>
          <label className="space-y-2 block">
            <span className="text-xs text-slate-400">审查备注</span>
            <input
              value={form.notes}
              onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg bg-surface-muted border border-border-subtle text-sm text-white"
              placeholder="可选"
            />
          </label>
        </div>

        <div className="p-3 rounded-xl border border-border-subtle bg-white/5 space-y-1">
          {tips.map((tip) => (
            <p key={tip} className="text-xs text-slate-400">- {tip}</p>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={form.approved}
              onChange={(e) => setForm((prev) => ({ ...prev, approved: e.target.checked }))}
            />
            审查通过（不勾选将无法提交）
          </label>
          <button
            onClick={onSubmit}
            disabled={isSubmitting || !form.approved}
            className="px-4 py-2 bg-primary text-slate-950 rounded-lg text-sm font-semibold disabled:opacity-60"
          >
            {isSubmitting ? '提交中...' : '提交审查卡'}
          </button>
        </div>
      </div>
    </SurfaceModal>
  );
}
