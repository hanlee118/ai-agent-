import React from 'react';
import { 
  History, 
  Search, 
  Filter, 
  Download, 
  Shield, 
  User, 
  Terminal, 
  CheckCircle2, 
  XCircle, 
  AlertCircle 
} from 'lucide-react';
import { useTranslation } from '../../contexts/LanguageContext';

export const Audit: React.FC = () => {
  const { t } = useTranslation();

  const auditLogs = [
    { id: 1, event: 'PROJECT_CREATE', operator: 'Admin', action: 'Created project "Alpha"', details: 'New project initialized', status: 'success', time: '2026-03-25 14:20:12' },
    { id: 2, event: 'AGENT_COMMAND', operator: 'System', action: 'Sent SOP update to Agent 01', details: 'SOP version 2.1 applied', status: 'success', time: '2026-03-25 14:15:05' },
    { id: 3, event: 'SECURITY_ALERT', operator: 'Firewall', action: 'Blocked IP 192.168.1.100', details: 'Multiple failed login attempts', status: 'warning', time: '2026-03-25 13:50:22' },
    { id: 4, event: 'USER_LOGIN', operator: 'Admin', action: 'User logged in', details: 'Session started from 127.0.0.1', status: 'success', time: '2026-03-25 13:45:00' },
    { id: 5, event: 'DATA_EXPORT', operator: 'Manager', action: 'Exported project reports', details: 'Format: PDF, Range: Last 7 days', status: 'success', time: '2026-03-25 12:30:15' },
    { id: 6, event: 'SYSTEM_ERROR', operator: 'Kernel', action: 'Memory overflow warning', details: 'Process 4521 exceeded threshold', status: 'error', time: '2026-03-25 11:10:45' },
  ];

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle2 size={16} className="text-emerald-400" />;
      case 'warning': return <AlertCircle size={16} className="text-amber-400" />;
      case 'error': return <XCircle size={16} className="text-rose-400" />;
      default: return null;
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold text-white tracking-tight">{t('common.audit')}</h2>
        <div className="flex gap-3">
          <button className="flex items-center gap-2 px-4 py-2 bg-[#1A202C] border border-slate-800 rounded-lg text-slate-400 hover:text-white hover:border-slate-700 transition-all text-sm font-medium">
            <Download size={16} />
            Export CSV
          </button>
          <button className="flex items-center gap-2 px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-all text-sm font-bold shadow-lg shadow-sky-500/20">
            <RefreshCw size={16} />
            Refresh Logs
          </button>
        </div>
      </div>

      <div className="bg-[#151921] border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-slate-800 bg-[#1A202C]/50 flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input 
              type="text" 
              placeholder="Search audit logs..." 
              className="w-full bg-[#0B1015] border border-slate-700 rounded-xl pl-10 pr-4 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-sky-500/50 transition-all"
            />
          </div>
          <div className="flex gap-2">
            <button className="p-2 bg-[#0B1015] border border-slate-700 rounded-lg text-slate-400 hover:text-white transition-all">
              <Filter size={18} />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-[#0B1015] border-b border-slate-800">
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">Event</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">Operator</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">Action</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">Details</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">Status</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {auditLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-800/20 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <Shield size={14} className="text-sky-400 opacity-50" />
                      <span className="text-sm font-mono text-sky-400 font-bold">{log.event}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <User size={14} className="text-slate-500" />
                      <span className="text-sm text-slate-300">{log.operator}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-white font-medium">{log.action}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-xs text-slate-500 italic">{log.details}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(log.status)}
                      <span className={`text-xs font-bold uppercase ${
                        log.status === 'success' ? 'text-emerald-400' : 
                        log.status === 'warning' ? 'text-amber-400' : 'text-rose-400'
                      }`}>
                        {log.status}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-xs text-slate-500 font-mono">{log.time}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        <div className="p-4 border-t border-slate-800 bg-[#0B1015] flex items-center justify-between">
          <span className="text-xs text-slate-500">Showing 6 of 1,245 entries</span>
          <div className="flex gap-2">
            <button className="px-3 py-1 bg-[#1A202C] border border-slate-800 rounded text-xs text-slate-400 hover:text-white disabled:opacity-50" disabled>Previous</button>
            <button className="px-3 py-1 bg-[#1A202C] border border-slate-800 rounded text-xs text-slate-400 hover:text-white">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
};

import { RefreshCw } from 'lucide-react';
