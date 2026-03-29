import { useMemo } from 'react';
import { AlertCircle, Briefcase, CheckCircle2, ChevronRight, Database, FileText, Globe, RotateCcw } from 'lucide-react';
import { agents, projects, sessions } from '../lib/runtimeCollections';
import { Badge } from './impl/GovernanceShared';

type Props = {
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  workspace?: { rootPath?: string };
  onRefreshData?: () => Promise<void> | void;
  onNavigate?: (tab: string, id?: string) => void;
};

const getRelativeTime = (date: string | Date | undefined) => {
  if (!date) return '暂无活动';
  const diff = Date.now() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
};

export default function WorkspacePage({ addToast, workspace, onRefreshData, onNavigate }: Props) {
  const healthChecks = [
    { label: 'Agent 连接', ok: agents.length > 0 },
    { label: '项目活跃', ok: projects.length > 0 },
    { label: 'API 服务', ok: true },
  ];

  const recentReports = useMemo(
    () =>
      sessions.slice(0, 4).map((session) => ({
        title: session.agentName || 'Agent 会话',
        date: getRelativeTime(session.updatedAt || session.createdAt),
        type: '会话',
      })),
    [sessions],
  );

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      <header className="flex justify-between items-end">
        <div>
          <div className="flex items-center gap-2 text-primary mb-2">
            <Globe size={16} />
            <span className="text-[10px] font-bold uppercase tracking-widest">本地环境</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">OpenClaw 工作区</h1>
          <p className="text-slate-400 mt-1">与本地开发文件系统的直接集成。</p>
        </div>
        <div className="flex gap-3">
          <div className="px-4 py-2 bg-white/5 border border-border-subtle rounded-lg text-xs font-bold text-slate-400 flex items-center gap-2">
            <Database size={14} />
            根目录: {workspace?.rootPath || '~/.openclaw'}
          </div>
          <button
            onClick={async () => {
              addToast('正在同步本地文件系统...', 'info');
              if (onRefreshData) {
                await onRefreshData();
              }
            }}
            className="px-4 py-2 bg-primary text-surface hover:bg-primary/90 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
          >
            <RotateCcw size={16} />
            同步工作区
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-surface-soft border border-border-subtle rounded-2xl p-6 space-y-4">
            <h2 className="font-semibold text-white text-sm">工作区健康状况</h2>
            <div className="space-y-4">
              {healthChecks.map((item, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">{item.label}</span>
                  {item.ok ? <CheckCircle2 size={16} className="text-primary" /> : <AlertCircle size={16} className="text-warning" />}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-3 space-y-6">
          <div className="bg-surface-soft border border-border-subtle rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border-subtle flex justify-between items-center bg-white/5">
              <h2 className="font-semibold text-white">工作区项目</h2>
              <Badge variant="primary">{projects.length} 个活跃</Badge>
            </div>
            <div className="p-6 space-y-4">
              {projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => onNavigate?.('project-room', project.id)}
                  className="w-full flex items-center justify-between p-4 bg-surface-muted rounded-xl border border-border-subtle hover:border-white/20 transition-all group text-left"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center text-slate-500 group-hover:text-primary transition-colors">
                      <Briefcase size={20} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">{project.name}</h4>
                      <p className="text-xs text-slate-500 mt-0.5">路径: /projects/{project.id}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-[10px] text-slate-500 font-bold uppercase">最后消息</p>
                      <p className="text-xs text-slate-300">{getRelativeTime(project.updatedAt || project.createdAt)}</p>
                    </div>
                    <ChevronRight size={16} className="text-slate-600 group-hover:text-white transition-colors" />
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-surface-soft border border-border-subtle rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border-subtle flex justify-between items-center">
              <h2 className="font-semibold text-white">近期报告</h2>
              <button className="text-xs text-primary hover:underline">查看全部</button>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              {recentReports.map((report, i) => (
                <div key={i} className="p-4 bg-white/5 rounded-xl border border-border-subtle hover:bg-white/10 transition-colors cursor-pointer flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center text-slate-500">
                    <FileText size={20} />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-white">{report.title}</h4>
                    <p className="text-xs text-slate-500">{report.type} • {report.date}</p>
                  </div>
                </div>
              ))}
              {recentReports.length === 0 && <p className="text-xs text-slate-500">暂无活动</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
