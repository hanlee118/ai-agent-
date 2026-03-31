import { Briefcase, CheckCircle2, FileText, Scale, ShieldCheck, Zap } from 'lucide-react';
import { Badge } from './Badge';

type Props = {
  project: { name: string; phase: string };
  currentStageLabel: string;
  projectBlockedCount: number;
  loadingDetail: boolean;
  projectActionHint: string | null;
  isIntervening: boolean;
  isDesignPhase: boolean;
  isWritingDebateCompareAudit: boolean;
  onOpenAcceptanceReport: () => void;
  onIntervene: () => void;
  onOpenDesignReview: () => void;
  onWriteDebateCompareAudit: () => void;
};

export default function ProjectHeader({
  project,
  currentStageLabel,
  projectBlockedCount,
  loadingDetail,
  projectActionHint,
  isIntervening,
  isDesignPhase,
  isWritingDebateCompareAudit,
  onOpenAcceptanceReport,
  onIntervene,
  onOpenDesignReview,
  onWriteDebateCompareAudit,
}: Props) {
  return (
    <header className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6 border-b border-border-subtle flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between bg-surface/50 backdrop-blur-md">
      <div className="w-full min-w-0 flex items-start sm:items-center gap-3 sm:gap-4">
        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary border border-primary/20 shrink-0">
          <Briefcase size={24} />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-white break-words">{project.name}</h1>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-1">
            <Badge variant="primary">阶段: {currentStageLabel || project.phase}</Badge>
            <span className="flex items-center gap-1.5 text-[10px] text-warning font-bold">
              <Zap size={10} />
              风险: {projectBlockedCount > 0 ? `${projectBlockedCount} 个任务阻塞` : '无阻塞风险'}
            </span>
            {loadingDetail ? <Badge variant="default">同步中</Badge> : null}
            {projectActionHint ? <Badge variant="accent">执行中</Badge> : null}
          </div>
          {projectActionHint ? <p className="mt-1 text-xs text-accent break-words">{projectActionHint}</p> : null}
        </div>
      </div>
      <div className="w-full xl:w-auto flex flex-wrap items-center justify-start xl:justify-end gap-2 sm:gap-3">
        <button
          onClick={onOpenAcceptanceReport}
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap px-3 sm:px-4 py-2 bg-white/5 text-slate-200 hover:bg-white/10 rounded-lg text-xs sm:text-sm font-semibold transition-colors"
        >
          <CheckCircle2 size={16} />
          验收报告
        </button>
        <button
          onClick={onWriteDebateCompareAudit}
          disabled={isWritingDebateCompareAudit}
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap px-3 sm:px-4 py-2 bg-white/5 text-slate-200 hover:bg-white/10 rounded-lg text-xs sm:text-sm font-semibold transition-colors disabled:opacity-60"
        >
          <Scale size={16} />
          {isWritingDebateCompareAudit ? '写入中...' : '写入辩论对比审计'}
        </button>
        <button
          onClick={onIntervene}
          disabled={isIntervening}
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap px-3 sm:px-4 py-2 bg-danger text-white hover:bg-danger/90 rounded-lg text-xs sm:text-sm font-semibold transition-colors disabled:opacity-60"
        >
          <ShieldCheck size={16} />
          {isIntervening ? '干预中...' : '紧急干预'}
        </button>
        {isDesignPhase ? (
          <button
            onClick={onOpenDesignReview}
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap px-3 sm:px-4 py-2 bg-primary text-slate-950 hover:bg-primary/90 rounded-lg text-xs sm:text-sm font-semibold transition-colors"
          >
            <FileText size={16} />
            提交设计审查卡
          </button>
        ) : null}
      </div>
    </header>
  );
}
