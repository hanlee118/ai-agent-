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
      <div className="flex max-h-[min(78vh,820px)] flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="space-y-5 pb-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-xs text-slate-400">视觉方向</span>
                <input
                  value={form.visualDirection}
                  onChange={(e) => setForm((prev) => ({ ...prev, visualDirection: e.target.value }))}
                  className="w-full rounded-lg border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-white"
                  placeholder="例如：可信赖科技蓝 + 高信息密度"
                />
              </label>
              <label className="space-y-2">
                <span className="text-xs text-slate-400">品牌语气</span>
                <input
                  value={form.brandTone}
                  onChange={(e) => setForm((prev) => ({ ...prev, brandTone: e.target.value }))}
                  className="w-full rounded-lg border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-white"
                  placeholder="例如：专业、直接、可执行"
                />
              </label>
            </div>

            <label className="block space-y-2">
              <span className="text-xs text-slate-400">版式策略</span>
              <textarea
                value={form.layoutStrategy}
                onChange={(e) => setForm((prev) => ({ ...prev, layoutStrategy: e.target.value }))}
                rows={3}
                className="w-full rounded-lg border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-white"
                placeholder="例如：首屏价值说明 -> 能力矩阵 -> 流程闭环 -> 案例 -> CTA"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-xs text-slate-400">组件规范</span>
              <textarea
                value={form.componentSpecs}
                onChange={(e) => setForm((prev) => ({ ...prev, componentSpecs: e.target.value }))}
                rows={3}
                className="w-full rounded-lg border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-white"
                placeholder="例如：Hero、能力卡、流程步骤、案例引用、联系 CTA"
              />
            </label>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="block space-y-2">
                <span className="text-xs text-slate-400">UX 原则（至少 3 条，换行分隔）</span>
                <textarea
                  value={form.uxPrinciples}
                  onChange={(e) => setForm((prev) => ({ ...prev, uxPrinciples: e.target.value }))}
                  rows={4}
                  className="w-full rounded-lg border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-white"
                  placeholder={'主路径优先\n强反馈\n低认知负担'}
                />
              </label>
              <label className="block space-y-2">
                <span className="text-xs text-slate-400">可访问性清单（至少 3 条，换行分隔）</span>
                <textarea
                  value={form.accessibilityChecklist}
                  onChange={(e) => setForm((prev) => ({ ...prev, accessibilityChecklist: e.target.value }))}
                  rows={4}
                  className="w-full rounded-lg border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-white"
                  placeholder={'对比度 >= 4.5\n键盘可达\n语义化标题结构'}
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-xs text-slate-400">审查人</span>
                <input
                  value={form.approvedBy}
                  onChange={(e) => setForm((prev) => ({ ...prev, approvedBy: e.target.value }))}
                  className="w-full rounded-lg border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-white"
                />
              </label>
              <label className="block space-y-2">
                <span className="text-xs text-slate-400">审查备注</span>
                <input
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  className="w-full rounded-lg border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-white"
                  placeholder="可选"
                />
              </label>
            </div>

            <div className="space-y-1 rounded-xl border border-border-subtle bg-white/5 p-3">
              {tips.map((tip) => (
                <p key={tip} className="text-xs text-slate-400">- {tip}</p>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 border-t border-white/10 bg-surface/95 pt-4 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-start gap-2 text-xs text-slate-300 sm:items-center">
              <input
                type="checkbox"
                checked={form.approved}
                onChange={(e) => setForm((prev) => ({ ...prev, approved: e.target.checked }))}
                className="mt-0.5 sm:mt-0"
              />
              <span>审查通过（不勾选将无法提交）</span>
            </label>
            <button
              onClick={onSubmit}
              disabled={isSubmitting || !form.approved}
              className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60 sm:w-auto"
            >
              {isSubmitting ? '提交中...' : '提交审查卡'}
            </button>
          </div>
        </div>
      </div>
    </SurfaceModal>
  );
}
