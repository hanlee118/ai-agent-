import { Bot, LockKeyhole, ShieldCheck, Workflow } from 'lucide-react';
import type { SystemExecutionProtocolLocks, SystemExecutionProtocolStageRule } from '../../lib/api/types';

type ExecutionProtocolPanelProps = {
  isLoading: boolean;
  source: 'database' | 'default';
  updatedAt: string;
  locks: SystemExecutionProtocolLocks;
  stageMatrix: SystemExecutionProtocolStageRule[];
  requireSkillEvidence: boolean;
  requireCollaborationHandoff: boolean;
  blockDegradedWrites: boolean;
  onRequireSkillEvidenceChange: (value: boolean) => void;
  onRequireCollaborationHandoffChange: (value: boolean) => void;
  onBlockDegradedWritesChange: (value: boolean) => void;
  onReload: () => void;
};

const STAGE_LABELS: Record<string, string> = {
  INIT: '立项',
  ANALYSIS: '分析',
  DESIGN: '设计',
  DEV: '研发',
  ACCEPT: '验收',
};

const ROLE_LABELS: Record<string, string> = {
  ROLE_PM: 'PM',
  ROLE_ANALYST: '分析',
  ROLE_PRODUCT: '产品',
  ROLE_DESIGN: '设计',
  ROLE_ARCH: '架构',
  ROLE_DEV: '研发',
  ROLE_QA: 'QA',
};

function ToggleRow(props: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-border-subtle bg-white/[0.04] px-4 py-3">
      <div>
        <p className="text-sm font-semibold text-white">{props.title}</p>
        <p className="mt-1 text-xs text-slate-400">{props.description}</p>
      </div>
      <button
        type="button"
        onClick={() => props.onChange(!props.checked)}
        className={`relative h-7 w-14 rounded-full border transition-colors ${
          props.checked ? 'border-primary/40 bg-primary' : 'border-border-subtle bg-white/10'
        }`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
            props.checked ? 'left-8' : 'left-1'
          }`}
        />
      </button>
    </div>
  );
}

export default function ExecutionProtocolPanel({
  isLoading,
  source,
  updatedAt,
  locks,
  stageMatrix,
  requireSkillEvidence,
  requireCollaborationHandoff,
  blockDegradedWrites,
  onRequireSkillEvidenceChange,
  onRequireCollaborationHandoffChange,
  onBlockDegradedWritesChange,
  onReload,
}: ExecutionProtocolPanelProps) {
  const grouped = stageMatrix.reduce<Record<string, SystemExecutionProtocolStageRule[]>>((acc, item) => {
    const key = item.stageType;
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(item);
    return acc;
  }, {});

  return (
    <section className="overflow-hidden rounded-[28px] border border-amber-500/20 bg-[linear-gradient(180deg,rgba(245,158,11,0.12),rgba(15,23,42,0.9)_22%,rgba(15,23,42,0.96))] shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-white font-semibold">
            <Workflow size={18} className="text-amber-300" />
            Agent Team 执行协议治理
          </h2>
          <p className="mt-1 text-xs text-slate-300">
            把阶段规则、证据要求和降级写回策略变成系统治理项，而不是只留在文档里。
          </p>
        </div>
        <button
          onClick={onReload}
          disabled={isLoading}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-200 hover:bg-white/10 disabled:opacity-60"
        >
          {isLoading ? '加载中...' : '重新加载'}
        </button>
      </div>

      <div className="space-y-6 p-6">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
            <div className="flex items-center gap-2 text-amber-200">
              <LockKeyhole size={16} />
              <span className="text-xs font-bold uppercase tracking-[0.22em]">锁定基线</span>
            </div>
            <div className="mt-3 space-y-2 text-sm text-white">
              <p>长期记忆: 常开</p>
              <p>记忆策略: 当前项目 / 高关联经验</p>
              <p>关键阶段: Terminal Agent First</p>
              <p>关键阶段直模兜底: 关闭</p>
            </div>
            <p className="mt-3 text-[11px] text-slate-400">
              锁定项来自平台执行协议，避免团队协作时再次回到低相关记忆和模板混杂模式。
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
            <div className="flex items-center gap-2 text-sky-200">
              <Bot size={16} />
              <span className="text-xs font-bold uppercase tracking-[0.22em]">治理来源</span>
            </div>
            <p className="mt-3 text-sm text-white">{source === 'database' ? '数据库配置' : '系统默认协议'}</p>
            <p className="mt-2 text-[11px] text-slate-400">
              最近更新: {updatedAt ? new Date(updatedAt).toLocaleString('zh-CN') : '暂无'}
            </p>
            <p className="mt-2 text-[11px] text-slate-400">
              锁定状态: {Object.values(locks).every(Boolean) ? '关键基线已锁定' : '存在可变更基线'}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
            <div className="flex items-center gap-2 text-emerald-200">
              <ShieldCheck size={16} />
              <span className="text-xs font-bold uppercase tracking-[0.22em]">可治理规则</span>
            </div>
            <p className="mt-3 text-sm text-white">
              你现在可以直接治理终端执行证据要求、协作交接要求，以及 degraded 写回拦截。
            </p>
            <p className="mt-2 text-[11px] text-slate-400">
              保存后，后端执行链会按这里的规则校验关键阶段输出。
            </p>
          </div>
        </div>

        <div className="grid gap-3">
          <ToggleRow
            title="要求技能执行证据"
            description="终端关键阶段必须带 skillsUsed / reasoningBasis / artifactsProduced / verification。"
            checked={requireSkillEvidence}
            onChange={onRequireSkillEvidenceChange}
          />
          <ToggleRow
            title="要求协作交接卡"
            description="终端关键阶段必须带 factsConfirmed / assumptions / decisions / handoff / openQuestions。"
            checked={requireCollaborationHandoff}
            onChange={onRequireCollaborationHandoffChange}
          />
          <ToggleRow
            title="阻止 degraded 写回成功"
            description="真实模型降级后，不允许关键阶段被记为成功执行。"
            checked={blockDegradedWrites}
            onChange={onBlockDegradedWritesChange}
          />
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">阶段执行矩阵</h3>
            <p className="text-[11px] text-slate-400">当前系统会按下列角色矩阵执行阶段协作。</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {Object.entries(grouped).map(([stageType, rows]) => (
              <div key={stageType} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-amber-200">{stageType}</p>
                    <p className="text-lg font-semibold text-white">{STAGE_LABELS[stageType] || stageType}</p>
                  </div>
                  <div className="rounded-full border border-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-300">
                    {rows.some((item) => item.mode === 'terminal_agent') ? 'terminal first' : 'direct model'}
                  </div>
                </div>
                <div className="space-y-3">
                  {rows.map((row) => (
                    <div key={`${row.stageType}-${row.role}`} className="rounded-xl border border-white/10 bg-black/10 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white">{ROLE_LABELS[row.role] || row.role}</p>
                          <p className="text-[11px] text-slate-400">
                            {row.mode === 'terminal_agent'
                              ? `Terminal Agent · ${row.openClawAgentId || '未绑定'}`
                              : 'Direct Model'}
                          </p>
                        </div>
                        <div className="text-right text-[11px] text-slate-300">
                          <p>技能证据: {row.requireSkillEvidence ? '必填' : '关闭'}</p>
                          <p>交接卡: {row.requireCollaborationHandoff ? '必填' : '关闭'}</p>
                        </div>
                      </div>
                      <p className="mt-2 text-[11px] text-slate-400">
                        模型链: {row.preferredModels.slice(0, 3).join(' -> ') || '未配置'}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        requiredSkills: {row.requiredSkills.join(' / ') || '无'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
