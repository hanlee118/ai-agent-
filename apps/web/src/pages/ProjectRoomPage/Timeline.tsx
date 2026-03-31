import { History } from 'lucide-react';
import type { ProjectExecutionRecord } from '../../lib/api';
import { Badge } from './Badge';

type ExecutionSummary = {
  total: number;
  success: number;
  failed: number;
  realModelRuns: number;
};

type TimelineEvent = {
  id: string;
  title: string;
  timestamp: string;
  agentId?: string;
  type: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  content: string;
};

type Props = {
  executionSummary: ExecutionSummary;
  isLoadingExecutions: boolean;
  executionRecords: ProjectExecutionRecord[];
  timelineEvents: TimelineEvent[];
  roleLabel: (roleId?: string) => string;
  stageLabelMap: Record<string, string>;
};

export default function Timeline({
  executionSummary,
  isLoadingExecutions,
  executionRecords,
  timelineEvents,
  roleLabel,
  stageLabelMap,
}: Props) {
  return (
    <section className="space-y-4">
      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
        <History size={14} />
        项目时间线
      </h3>

      <div className="bg-surface-soft border border-border-subtle rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Agent 执行证据</p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default">总计 {executionSummary.total}</Badge>
            <Badge variant="primary">成功 {executionSummary.success}</Badge>
            <Badge variant={executionSummary.failed > 0 ? 'danger' : 'default'}>失败 {executionSummary.failed}</Badge>
            <Badge variant={executionSummary.realModelRuns > 0 ? 'accent' : 'warning'}>
              真实模型 {executionSummary.realModelRuns}
            </Badge>
          </div>
        </div>
        {isLoadingExecutions ? (
          <p className="text-xs text-slate-500">执行证据同步中...</p>
        ) : executionRecords.length > 0 ? (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {executionRecords.slice(0, 12).map((record) => (
              <div key={record.id} className="rounded-xl border border-border-subtle bg-white/5 p-3 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-slate-300">
                    {new Date(record.createdAt).toLocaleString('zh-CN')} · {stageLabelMap[record.stageType] || record.stageType} · {roleLabel(record.role)}
                  </p>
                  <div className="flex items-center gap-2">
                    <Badge variant={record.status === 'failed' ? 'danger' : 'primary'}>{record.status}</Badge>
                    <Badge variant="accent">{record.provider || record.runtimeMode || 'unknown'}</Badge>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500">
                  action: {record.action} · model: {record.model || 'n/a'} · latency: {record.latencyMs ?? '-'}ms
                </p>
                {record.promptSummary ? (
                  <p className="text-[11px] text-slate-400 whitespace-pre-wrap">{record.promptSummary}</p>
                ) : null}
                {record.outputPreview ? (
                  <p className="text-[11px] text-slate-300 whitespace-pre-wrap">{record.outputPreview}</p>
                ) : null}
                {record.errorMessage ? (
                  <p className="text-[11px] text-danger whitespace-pre-wrap">{record.errorMessage}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500">暂无执行证据（尚未触发阶段 Agent 调用）</p>
        )}
      </div>

      <div className="space-y-3">
        {timelineEvents.length > 0 ? timelineEvents.map((item) => (
          <div key={item.id} className="bg-surface-soft border border-border-subtle rounded-2xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">{item.title}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {new Date(item.timestamp).toLocaleString('zh-CN')} · {roleLabel(item.agentId)} · {item.type}
                </p>
              </div>
              <Badge variant={item.priority === 'urgent' || item.priority === 'high' ? 'danger' : item.priority === 'normal' ? 'accent' : 'default'}>
                {item.priority}
              </Badge>
            </div>
            <p className="text-xs text-slate-300 mt-2 whitespace-pre-wrap">{item.content}</p>
          </div>
        )) : (
          <div className="bg-surface-soft border border-border-subtle rounded-2xl p-6 text-center text-sm text-slate-500">
            暂无时间线事件
          </div>
        )}
      </div>
    </section>
  );
}
