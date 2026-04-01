import { cn } from '../../../lib/utils';
import type { NewProjectModalController } from '../hooks/useNewProjectModalController';

type Props = {
  controller: NewProjectModalController;
};

export default function ClarificationForm({ controller }: Props) {
  const { clarification, setClarification } = controller;

  return (
    <>
      <div className="space-y-3">
        <p className="text-xs text-slate-400">可选扩展信息（非必填）</p>
        <div className="space-y-3">
          <div className="space-y-2">
            <p className="text-xs text-slate-300">交付深度</p>
            <div className="flex flex-wrap gap-2">
              {(['MVP闭环', '核心流程+管理后台', '完整一期'] as const).map((item) => (
                <button
                  key={item}
                  onClick={() =>
                    setClarification((prev) => ({
                      ...prev,
                      deliveryDepth: prev.deliveryDepth === item ? '' : item,
                    }))
                  }
                  className={cn(
                    'px-3 py-2 rounded-lg text-xs border transition-colors',
                    clarification.deliveryDepth === item
                      ? 'bg-primary/20 text-primary border-primary/30'
                      : 'bg-white/5 text-slate-300 border-border-subtle hover:bg-white/10',
                  )}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-slate-300">期望周期</p>
            <div className="flex flex-wrap gap-2">
              {(['1小时内', '24小时内', '1周内', '2周内', '1个月内', '排期待定', '自定义'] as const).map((item) => (
                <button
                  key={item}
                  onClick={() =>
                    setClarification((prev) => ({
                      ...prev,
                      timeline: prev.timeline === item ? '' : item,
                      customTimeline: prev.timeline === item ? '' : item === '自定义' ? prev.customTimeline : '',
                    }))
                  }
                  className={cn(
                    'px-3 py-2 rounded-lg text-xs border transition-colors',
                    clarification.timeline === item
                      ? 'bg-primary/20 text-primary border-primary/30'
                      : 'bg-white/5 text-slate-300 border-border-subtle hover:bg-white/10',
                  )}
                >
                  {item}
                </button>
              ))}
            </div>
            {clarification.timeline === '自定义' && (
              <input
                type="text"
                value={clarification.customTimeline}
                onChange={(event) =>
                  setClarification((prev) => ({ ...prev, customTimeline: event.target.value }))
                }
                placeholder="请输入自定义周期，例如：45分钟内 / 3个工作日"
                className="w-full bg-surface-muted border border-border-subtle rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            )}
          </div>

          <div className="space-y-2">
            <p className="text-xs text-slate-300">协作方式</p>
            <div className="flex flex-wrap gap-2">
              {(['并行推进', '串行推进', '先分析后研发'] as const).map((item) => (
                <button
                  key={item}
                  onClick={() =>
                    setClarification((prev) => ({
                      ...prev,
                      collaboration: prev.collaboration === item ? '' : item,
                    }))
                  }
                  className={cn(
                    'px-3 py-2 rounded-lg text-xs border transition-colors',
                    clarification.collaboration === item
                      ? 'bg-primary/20 text-primary border-primary/30'
                      : 'bg-white/5 text-slate-300 border-border-subtle hover:bg-white/10',
                  )}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs text-slate-400">执行确认（可选）</p>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            className="accent-primary"
            checked={clarification.confirmScope}
            onChange={(event) =>
              setClarification((prev) => ({ ...prev, confirmScope: event.target.checked }))
            }
          />
          我确认当前项目目标与范围可进入执行拆解
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            className="accent-primary"
            checked={clarification.confirmExecution}
            onChange={(event) =>
              setClarification((prev) => ({ ...prev, confirmExecution: event.target.checked }))
            }
          />
          我确认允许系统按上述策略自动推动研发执行
        </label>
      </div>

      <div className="space-y-3">
        <p className="text-xs text-slate-400">补充信息（可选）</p>
        <textarea
          rows={2}
          value={clarification.successCriteria}
          onChange={(event) => setClarification((prev) => ({ ...prev, successCriteria: event.target.value }))}
          placeholder="补充成功标准（例如：上线可演示版本、核心流程可闭环、关键接口响应时间）"
          className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
        />
        <textarea
          rows={2}
          value={clarification.extraConstraints}
          onChange={(event) => setClarification((prev) => ({ ...prev, extraConstraints: event.target.value }))}
          placeholder="补充约束（例如：必须本地部署、预算限制、兼容既有系统）"
          className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
        />
      </div>
    </>
  );
}
