import { useMemo } from 'react';
import type { AuditLogRow } from './useAuditLogs';

export function useAuditSearch(logs: AuditLogRow[], searchTerm: string) {
  return useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    if (!keyword) {
      return logs;
    }

    return logs.filter((log) => {
      return `${log.time} ${log.actor} ${log.action} ${log.resource} ${log.status}`
        .toLowerCase()
        .includes(keyword);
    });
  }, [logs, searchTerm]);
}
