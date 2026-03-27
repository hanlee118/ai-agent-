import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { sendBatchAgentMessage } from '../../lib/adapters';
import { agents, tasks } from '../../lib/runtimeCollections';
import type { Task } from '../../types';
import { cn } from '../../lib/utils';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
};

type Decision = {
  id: string;
  title: string;
  desc: string;
  impact: string;
  type: 'warning' | 'danger' | 'info';
  judgment: string;
  events: Array<{ time: string; content: string }>;
  plan: string[];
};

function Modal({
  isOpen,
  onClose,
  title,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-surface/80 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-2xl bg-surface-soft border border-border-subtle rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <header className="px-8 py-6 border-b border-border-subtle flex justify-between items-center bg-white/5">
          <h2 className="text-xl font-bold text-white">{title}</h2>
          <button onClick={onClose} className="p-2 text-slate-500 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-8">{children}</div>
      </motion.div>
    </div>
  );
}

export default function DecisionCenterModal({ isOpen, onClose, addToast }: Props) {
  const [selectedDecision, setSelectedDecision] = useState<Decision | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'details' | 'plan'>('list');
  const [isApproving, setIsApproving] = useState(false);

  const formatDecisionTime = (date: string | Date | null | undefined) => {
    if (!date) {
      return new Date().toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    }

    const normalized = new Date(date);
    if (Number.isNaN(normalized.getTime())) {
      return new Date().toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    }

    return normalized.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getTaskDate = (task: Task) => {
    const taskRecord = task as Task & { createdAt?: string; updatedAt?: string };
    return taskRecord.updatedAt || taskRecord.createdAt || new Date().toISOString();
  };

  const decisions = useMemo(() => {
    const items: Decision[] = [];

    tasks
      .filter((task) => task.status === 'Blocked')
      .slice(0, 2)
      .forEach((task) => {
        const createdAt = getTaskDate(task);
        const updatedAt = getTaskDate(task);
        items.push({
          id: `blocked-${task.id}`,
          title: `任务阻塞: ${task.title}`,
          desc: `任务 "${task.title}" 已被阻塞，等待 ${task.agent || '负责人'} 处理`,
          impact: '进度延迟',
          type: 'warning',
          judgment: `任务在 ${task.agent || '未知Agent'} 执行期间被阻塞，需人工介入或等待资源释放。`,
          events: [
            { time: formatDecisionTime(createdAt), content: '任务创建' },
            { time: formatDecisionTime(updatedAt), content: '任务被阻塞' },
          ],
          plan: ['1. 检查 Agent 资源状态', '2. 确认阻塞依赖', '3. 重新分配或继续等待'],
        });
      });

    agents
      .filter((agent) => agent.load >= 80)
      .slice(0, 2)
      .forEach((agent) => {
        const now = new Date().toISOString();
        items.push({
          id: `overload-${agent.id}`,
          title: `Agent 负载过高: ${agent.name}`,
          desc: `${agent.name} 当前负载 ${agent.load}%，建议分流任务`,
          impact: `负载: ${agent.load}%`,
          type: 'warning',
          judgment: `${agent.name} (${agent.role || '未知角色'}) 负载持续过高，可能影响任务处理效率。`,
          events: [
            { time: formatDecisionTime(now), content: `当前负载: ${agent.load}%` },
            { time: formatDecisionTime(now), content: `任务数: ${agent.tasks}` },
          ],
          plan: ['1. 检查任务队列', '2. 分流到空闲Agent', '3. 监控负载变化'],
        });
      });

    return items.slice(0, 5);
  }, [tasks, agents]);

  const handleClose = () => {
    setSelectedDecision(null);
    setViewMode('list');
    onClose();
  };

  const handleApprovePlan = async () => {
    if (!selectedDecision) {
      return;
    }

    const agentIdByName = new Map(agents.map((agent) => [agent.name, agent.id]));
    let targetAgentIds: string[] = [];

    if (String(selectedDecision.id).startsWith('blocked-')) {
      const taskId = String(selectedDecision.id).replace('blocked-', '');
      const task = tasks.find((item) => String(item.id) === taskId);
      const relatedAgentId = task?.agent ? agentIdByName.get(task.agent) : undefined;
      if (relatedAgentId) {
        targetAgentIds.push(relatedAgentId);
      }
    } else if (String(selectedDecision.id).startsWith('overload-')) {
      const overloadAgentId = String(selectedDecision.id).replace('overload-', '');
      if (agents.some((agent) => agent.id === overloadAgentId)) {
        targetAgentIds.push(overloadAgentId);
      }
    }

    if (targetAgentIds.length === 0) {
      targetAgentIds = agents.slice(0, 2).map((agent) => agent.id);
    }

    if (targetAgentIds.length === 0) {
      addToast('未找到可执行决策的 Agent', 'error');
      return;
    }

    setIsApproving(true);
    try {
      const plan = Array.isArray(selectedDecision.plan) ? selectedDecision.plan.join('；') : '';
      const command = `系统决策已批准：${selectedDecision.title}。请按计划执行：${plan || '请立即处理并回传结果。'}`;
      await sendBatchAgentMessage(targetAgentIds, command);
      addToast('计划已批准并下发执行', 'success');
      handleClose();
    } catch (error) {
      addToast(`执行下发失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsApproving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={
        viewMode === 'details'
          ? `Agent 判定: ${selectedDecision?.title}`
          : viewMode === 'plan'
            ? `执行计划: ${selectedDecision?.title}`
            : '关键决策中心'
      }
    >
      {viewMode === 'details' && selectedDecision ? (
        <div className="space-y-6">
          <div className="p-5 bg-primary/5 border border-primary/20 rounded-2xl">
            <h4 className="text-xs font-bold text-primary uppercase tracking-widest mb-3">Agent 核心判定</h4>
            <p className="text-sm text-slate-200 leading-relaxed italic">“{selectedDecision.judgment}”</p>
          </div>

          <div className="space-y-4">
            <h4 className="text-xs font-bold text-white uppercase tracking-widest">相关事件流</h4>
            <div className="space-y-3">
              {selectedDecision.events.map((event, i) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-white/5 border border-border-subtle rounded-xl">
                  <div className="text-[10px] font-mono text-slate-500 pt-0.5">{event.time}</div>
                  <p className="text-xs text-slate-300">{event.content}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-4 pt-4">
            <button
              onClick={() => setViewMode('list')}
              className="flex-1 py-3 bg-white/5 border border-border-subtle rounded-xl text-sm font-bold hover:bg-white/10 transition-all"
            >
              返回列表
            </button>
            <button
              onClick={() => setViewMode('plan')}
              className="flex-1 py-3 bg-primary text-surface rounded-xl text-sm font-bold hover:bg-primary/90 transition-all"
            >
              查看执行计划
            </button>
          </div>
        </div>
      ) : viewMode === 'plan' && selectedDecision ? (
        <div className="space-y-6">
          <div className="p-4 bg-white/5 border border-border-subtle rounded-2xl">
            <p className="text-xs text-slate-400 leading-relaxed">{selectedDecision.desc}</p>
          </div>
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-white uppercase tracking-widest">详细执行步骤</h4>
            <div className="space-y-3">
              {selectedDecision.plan.map((step, i) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-white/5 border border-border-subtle rounded-xl">
                  <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                    {i + 1}
                  </div>
                  <p className="text-xs text-slate-300">{step}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-4 pt-4">
            <button
              onClick={() => setViewMode('details')}
              className="flex-1 py-3 bg-white/5 border border-border-subtle rounded-xl text-sm font-bold hover:bg-white/10 transition-all"
            >
              查看判定详情
            </button>
            <button
              onClick={() => void handleApprovePlan()}
              disabled={isApproving}
              className="flex-1 py-3 bg-primary text-surface rounded-xl text-sm font-bold hover:bg-primary/90 transition-all disabled:opacity-60"
            >
              {isApproving ? '下发中...' : '批准并执行'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {decisions.length === 0 && (
            <div className="p-5 bg-white/5 border border-border-subtle rounded-2xl">
              <p className="text-xs text-slate-400">暂无待处理决策</p>
            </div>
          )}
          {decisions.map((d) => (
            <div key={d.id} className="p-5 bg-white/5 border border-border-subtle rounded-2xl space-y-4 hover:border-white/20 transition-all">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      'w-2 h-2 rounded-full',
                      d.type === 'danger' ? 'bg-danger' : d.type === 'warning' ? 'bg-warning' : 'bg-primary',
                    )}
                  />
                  <h4 className="font-bold text-white">{d.title}</h4>
                </div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  {d.events[d.events.length - 1]?.time || '刚刚'}
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">{d.desc}</p>
              <div className="flex justify-between items-center pt-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">影响: {d.impact}</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setSelectedDecision(d);
                      setViewMode('details');
                    }}
                    className="px-3 py-1.5 bg-white/5 border border-border-subtle rounded-lg text-[10px] font-bold text-slate-400 hover:bg-white/10 hover:text-white transition-all"
                  >
                    查看详情
                  </button>
                  <button
                    onClick={() => {
                      setSelectedDecision(d);
                      setViewMode('plan');
                    }}
                    className="px-3 py-1.5 bg-primary/10 border border-primary/20 text-primary rounded-lg text-[10px] font-bold hover:bg-primary/20 transition-all"
                  >
                    查看计划
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
