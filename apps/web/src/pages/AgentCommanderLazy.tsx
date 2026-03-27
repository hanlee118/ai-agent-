import React, { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BrainCircuit, ChevronRight, Globe, History, Info, ShieldCheck } from 'lucide-react';
import type { Agent, Model, Session } from '../types';
import { cn } from '../lib/utils';

export interface AgentCommanderLazyProps {
  agentId: string | null;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onSendTask?: (agentId: string, message: string) => Promise<void>;
  agents: Agent[];
  models: Model[];
  sessions: Session[];
}

function StatusBadge({ label }: { label: string }) {
  return (
    <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] font-bold border border-primary/20">
      {label}
    </span>
  );
}

export default function AgentCommanderLazy({
  agentId,
  addToast,
  onSendTask,
  agents,
  models,
  sessions,
}: AgentCommanderLazyProps) {
  const activeAgent = useMemo(() => agents.find((item) => item.id === agentId) || agents[0], [agents, agentId]);
  const agentSessions = useMemo(() => sessions.filter((item) => item.agentId === activeAgent?.id), [sessions, activeAgent?.id]);

  const [instructionDraft, setInstructionDraft] = useState('');
  const [pendingInstruction, setPendingInstruction] = useState('');
  const [isConfirmationOpen, setIsConfirmationOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const understanding = useMemo(() => {
    const content = pendingInstruction.trim();
    if (!content) {
      return {
        objective: '等待输入任务指令',
        plan: ['解析任务目标', '拆解执行步骤', '分阶段回传结果'],
        risks: ['目标或交付物不清晰时可能产生偏差']
      };
    }

    return {
      objective: content.length > 140 ? `${content.slice(0, 140)}...` : content,
      plan: [
        '复述任务范围与输出格式',
        `基于 ${models.find((item) => item.id === activeAgent?.currentModelId)?.name || activeAgent?.currentModelId || '当前模型'} 执行`,
        '完成后给出结果与下一步建议'
      ],
      risks: [
        '若缺少验收标准，结果可能需要返工',
        '若上下文不足，建议先补充参考资料'
      ]
    };
  }, [activeAgent?.currentModelId, models, pendingInstruction]);

  if (!activeAgent) {
    return (
      <div className="p-8 text-slate-400">暂无可用 Agent</div>
    );
  }

  const prepareSend = () => {
    const content = instructionDraft.trim();
    if (!content) {
      addToast('请输入任务指令后再发送', 'error');
      return;
    }

    setPendingInstruction(content);
    setIsConfirmationOpen(true);
  };

  const confirmSend = async () => {
    if (!pendingInstruction.trim()) {
      return;
    }

    setIsSending(true);
    try {
      if (onSendTask) {
        await onSendTask(activeAgent.id, pendingInstruction.trim());
      }
      setInstructionDraft('');
      setPendingInstruction('');
      setIsConfirmationOpen(false);
      addToast(`任务已发送给 ${activeAgent.name}`, 'success');
    } catch (error: any) {
      addToast(error?.message || '发送失败，请稍后重试', 'error');
    } finally {
      setIsSending(false);
    }
  };

  const editSend = () => {
    setIsConfirmationOpen(false);
    setTimeout(() => composerRef.current?.focus(), 50);
  };

  const cancelSend = () => {
    setIsConfirmationOpen(false);
    setPendingInstruction('');
    addToast('已取消发送', 'info');
  };

  return (
    <div className="h-full flex flex-col">
      <header className="px-8 py-6 border-b border-border-subtle flex justify-between items-center bg-surface/50">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-accent/20 flex items-center justify-center text-accent border border-accent/20">
            <BrainCircuit size={22} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">{activeAgent.name}</h1>
            <p className="text-xs text-slate-400 mt-1">角色: {activeAgent.role}</p>
          </div>
        </div>
        <StatusBadge label={activeAgent.status} />
      </header>

      <div className="flex-1 overflow-y-auto p-8 space-y-6">
        <section className="bg-surface-soft border border-border-subtle rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-white font-semibold">
            <ShieldCheck size={16} className="text-primary" />
            Agent 指挥摘要
          </div>
          <p className="text-sm text-slate-300 leading-relaxed">
            当前模型：{models.find((item) => item.id === activeAgent.currentModelId)?.name || activeAgent.currentModelId || '未设置'}，
            今日 Token：{activeAgent.tokensUsed.toLocaleString()} / {activeAgent.tokenLimit.toLocaleString()}。
          </p>
        </section>

        <section className="bg-surface-soft border border-border-subtle rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-white font-semibold">
            <History size={16} className="text-accent" />
            最近会话
          </div>
          <div className="space-y-2">
            {agentSessions.slice(0, 6).map((session) => (
              <div key={session.id} className="px-3 py-2 rounded-lg bg-white/5 border border-border-subtle">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white">会话 {session.id}</span>
                  <span className={cn('text-xs', session.status === 'active' ? 'text-primary' : 'text-slate-400')}>
                    {session.status}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">{session.duration} · {session.tokens} tokens</p>
              </div>
            ))}
            {agentSessions.length === 0 && <p className="text-sm text-slate-500">暂无会话数据</p>}
          </div>
        </section>
      </div>

      <div className="p-6 bg-surface/80 backdrop-blur-xl border-t border-border-subtle">
        <div className="max-w-4xl mx-auto relative">
          <textarea
            ref={composerRef}
            value={instructionDraft}
            onChange={(e) => setInstructionDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                prepareSend();
              }
            }}
            placeholder="输入命令或提出问题..."
            className="w-full bg-surface-muted border border-border-subtle rounded-2xl px-5 py-4 pr-32 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none h-28"
          />
          <div className="absolute right-4 bottom-4 flex items-center gap-3">
            <button className="p-2 text-slate-500 hover:text-white transition-colors">
              <Globe size={18} />
            </button>
            <button
              onClick={prepareSend}
              disabled={isSending}
              className="bg-primary text-surface px-3 py-2.5 rounded-xl shadow-lg shadow-primary/20 hover:scale-105 transition-all disabled:opacity-60 inline-flex items-center gap-1.5"
            >
              <ChevronRight size={16} />
              <span className="text-xs font-semibold">发送</span>
            </button>
          </div>
        </div>
        <p className="max-w-4xl mx-auto mt-3 text-[10px] text-slate-600">按 Enter 发送，Shift + Enter 换行</p>
      </div>

      <AnimatePresence>
        {isConfirmationOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[130] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              className="w-full max-w-2xl bg-surface-soft border border-border-subtle rounded-2xl shadow-2xl"
            >
              <div className="p-6 border-b border-border-subtle bg-white/5">
                <h3 className="text-lg font-bold text-white">理解确认卡</h3>
                <p className="text-xs text-slate-400 mt-2">你确认后，任务才会真正发送给 Agent。</p>
              </div>

              <div className="p-6 space-y-4">
                <div className="rounded-xl bg-white/5 border border-border-subtle p-4">
                  <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">提议目标</p>
                  <p className="text-sm text-slate-100 mt-2">{understanding.objective}</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-xl bg-white/5 border border-border-subtle p-4">
                    <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">执行计划</p>
                    <div className="mt-2 space-y-1.5">
                      {understanding.plan.map((step, index) => (
                        <p key={index} className="text-xs text-slate-300">{index + 1}. {step}</p>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-xl bg-warning/5 border border-warning/20 p-4">
                    <p className="text-[10px] uppercase tracking-widest text-warning font-bold inline-flex items-center gap-1">
                      <Info size={11} /> 风险提示
                    </p>
                    <div className="mt-2 space-y-1.5">
                      {understanding.risks.map((risk, index) => (
                        <p key={index} className="text-xs text-slate-300">- {risk}</p>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-6 border-t border-border-subtle bg-white/5 flex flex-col md:flex-row gap-3">
                <button
                  onClick={confirmSend}
                  disabled={isSending}
                  className="flex-1 py-2.5 rounded-xl bg-primary text-surface text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-60"
                >
                  {isSending ? '执行中...' : '✅ 确认执行'}
                </button>
                <button
                  onClick={editSend}
                  disabled={isSending}
                  className="flex-1 py-2.5 rounded-xl bg-white/5 border border-border-subtle text-sm font-bold text-slate-300 hover:bg-white/10 transition-colors"
                >
                  ✏️ 修改指令
                </button>
                <button
                  onClick={cancelSend}
                  disabled={isSending}
                  className="flex-1 py-2.5 rounded-xl bg-danger/10 border border-danger/20 text-sm font-bold text-danger hover:bg-danger/20 transition-colors"
                >
                  ❌ 取消
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
