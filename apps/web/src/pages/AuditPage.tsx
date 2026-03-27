import React, { useState } from 'react';
import { BarChart3, Search } from 'lucide-react';
import AuditTable from '../features/audit/AuditTable';
import { useAuditLogs } from '../features/audit/useAuditLogs';
import { useAuditSearch } from '../features/audit/useAuditSearch';
import { agents, projects, sessions, tasks } from '../lib/runtimeCollections';
import { Dialog } from './impl/GovernanceShared';

export default function AuditPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLogJson, setSelectedLogJson] = useState<string | null>(null);
  const { auditLogs, isLoadingRemoteLogs, refreshAuditLogs } = useAuditLogs({
    agents,
    projects,
    tasks,
    sessions,
  });
  const filteredAuditLogs = useAuditSearch(auditLogs, searchTerm);

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">审计追踪</h1>
          <p className="text-slate-400 mt-1">所有系统操作和 Agent 活动的全面日志。</p>
        </div>
        <div className="flex gap-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="搜索日志..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="bg-white/5 border border-border-subtle rounded-lg pl-9 pr-4 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 w-64"
            />
          </div>
          <button
            onClick={() => void refreshAuditLogs()}
            disabled={isLoadingRemoteLogs}
            className="px-4 py-2 bg-white/5 border border-border-subtle rounded-lg text-sm font-medium hover:bg-white/10 transition-colors flex items-center gap-2 disabled:opacity-60"
          >
            <BarChart3 size={16} />
            {isLoadingRemoteLogs ? '刷新中...' : '分析'}
          </button>
        </div>
      </header>

      <AuditTable
        logs={filteredAuditLogs}
        emptyText={searchTerm.trim() ? '未匹配到审计日志' : '暂无审计日志'}
        onViewJson={(raw) => setSelectedLogJson(JSON.stringify(raw ?? {}, null, 2))}
      />

      <Dialog isOpen={Boolean(selectedLogJson)} onClose={() => setSelectedLogJson(null)} title="审计日志详情">
        <pre className="text-xs text-slate-300 bg-surface-muted border border-border-subtle rounded-2xl p-4 whitespace-pre-wrap break-all">
          {selectedLogJson}
        </pre>
      </Dialog>
    </div>
  );
}
