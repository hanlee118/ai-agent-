import React from 'react';
import { 
  ChevronLeft, 
  Badge, 
  Bell, 
  ShieldAlert, 
  Pause, 
  Clock, 
  Check, 
  FileText, 
  ShieldCheck, 
  BrainCircuit, 
  AlertTriangle, 
  RotateCcw, 
  Terminal, 
  Send, 
  History 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { useTranslation } from '../../contexts/LanguageContext';
import { Project, TimelineEvent } from '../../types';
import { cn } from '../../lib/utils';

interface ProjectRoomProps {
  project: Project;
  onBack: () => void;
  onSimulateRequest: () => void;
  onIntervene: () => void;
  isIntervening: boolean;
  setIsIntervening: (val: boolean) => void;
  currentThinking: string;
  liveStreamText: string[];
}

export const ProjectRoom: React.FC<ProjectRoomProps> = ({
  project,
  onBack,
  onSimulateRequest,
  onIntervene,
  isIntervening,
  setIsIntervening,
  currentThinking,
  liveStreamText
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500 pb-20">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="p-2.5 bg-slate-800/50 hover:bg-slate-700 rounded-xl text-slate-400 hover:text-white transition-all border border-slate-800 active:scale-95">
          <ChevronLeft size={20} />
        </button>
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-3xl font-bold text-white tracking-tight">{project.name}</h2>
            <div className="flex gap-2">
              <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500 text-[10px] font-bold uppercase tracking-wider border border-emerald-500/20">{t('common.live')}</span>
              <span className={cn(
                "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border",
                project.riskLevel === 'low' ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : 
                project.riskLevel === 'medium' ? "bg-amber-500/10 text-amber-500 border-amber-500/20" : 
                "bg-rose-500/10 text-rose-500 border-rose-500/20"
              )}>
                {project.riskLevel.toUpperCase()} RISK
              </span>
            </div>
          </div>
          <p className="text-slate-500 text-sm font-mono mt-1.5 flex items-center gap-2">
            <span className="bg-slate-800 px-2 py-0.5 rounded text-slate-400">{project.id}</span>
          </p>
        </div>
        <div className="ml-auto flex gap-3">
          <button 
            onClick={onSimulateRequest}
            className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all"
          >
            <Bell size={18} />
            {t('common.simulateRequest')}
          </button>
          <button 
            onClick={onIntervene}
            className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all"
          >
            <ShieldAlert size={18} />
            {t('common.intervene')}
          </button>
          <button className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all border border-slate-700">
            <Pause size={18} />
            {t('common.pause')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-8">
        {/* Left Column: Stages & Deliverables */}
        <div className="col-span-3 space-y-8">
          <Card className="bg-[#1A202C]/50 border-slate-800">
            <CardHeader className="p-4 border-b border-slate-800"><h3 className="font-bold text-white flex items-center gap-2"><Clock size={18} className="text-sky-400" /> {t('common.stages.title')}</h3></CardHeader>
            <CardContent className="p-0">
              {['INIT', 'ANALYSIS', 'DESIGN', 'DEV', 'ACCEPT'].map((stage, idx) => {
                const isCurrent = project.currentStage === stage;
                const isPast = idx < ['INIT', 'ANALYSIS', 'DESIGN', 'DEV', 'ACCEPT'].indexOf(project.currentStage);
                return (
                  <div key={stage} className={cn(
                    "flex items-center gap-4 px-6 py-4 border-b border-slate-800 last:border-0",
                    isCurrent ? "bg-sky-500/5 border-l-4 border-l-sky-500" : ""
                  )}>
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold",
                      isPast ? "bg-emerald-500 text-white" : isCurrent ? "bg-sky-500 text-white" : "bg-slate-800 text-slate-500"
                    )}>
                      {isPast ? <Check size={12} /> : idx + 1}
                    </div>
                    <span className={cn("text-sm font-medium", isCurrent ? "text-sky-400" : isPast ? "text-slate-300" : "text-slate-600")}>{t(`common.stages.${stage}`)}</span>
                    {isCurrent && <div className="ml-auto w-2 h-2 bg-sky-500 rounded-full animate-pulse" />}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card className="bg-[#1A202C]/50 border-slate-800">
            <CardHeader className="p-4 border-b border-slate-800"><h3 className="font-bold text-white flex items-center gap-2"><FileText size={18} className="text-sky-400" /> {t('common.deliverables')}</h3></CardHeader>
            <CardContent className="p-4 space-y-4">
              {project.deliverables.map(d => (
                <div key={d.id} className="p-4 bg-[#0B1015] border border-slate-800 rounded-xl group hover:border-sky-500/30 transition-all">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-sky-400 uppercase tracking-widest">{d.type}</span>
                    <span className="text-[10px] text-slate-500 font-mono">{new Date(d.createdAt).toLocaleTimeString()}</span>
                  </div>
                  <h5 className="text-sm font-bold text-slate-200">{d.name}</h5>
                  <div className="mt-3 flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-400 border border-slate-700">{d.createdBy[0]}</div>
                    <button className="text-[10px] font-bold text-sky-500 hover:text-sky-400 ml-auto uppercase tracking-wider">{t('common.viewContent')}</button>
                  </div>
                </div>
              ))}
              {project.deliverables.length === 0 && <p className="text-center text-slate-600 py-8 text-sm italic">{t('common.noDeliverables')}</p>}
            </CardContent>
          </Card>
        </div>

        {/* Middle Column: Live Monitoring & Confirmations */}
        <div className="col-span-6 space-y-8">
          {/* Confirmations Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <ShieldCheck size={20} className="text-amber-400" />
                {t('common.confirmations')}
              </h3>
              <div className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-500 text-[10px] font-bold animate-pulse border border-amber-500/20">{project.confirmations.length} {t('common.pending')}</div>
            </div>
            {project.confirmations.map(conf => (
              <Card key={conf.id} className="bg-amber-500/5 border-amber-500/20 overflow-hidden">
                <CardHeader className="bg-amber-500/10 border-b border-amber-500/10 py-3 px-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-amber-400">
                      <BrainCircuit size={16} />
                      <span className="text-xs font-bold uppercase tracking-wider">{t('common.understandingCard.title')}</span>
                    </div>
                    <span className="text-[10px] text-amber-500/60 font-mono">{conf.agentId}</span>
                  </div>
                </CardHeader>
                <CardContent className="p-6 space-y-6">
                  <div>
                    <h4 className="text-[10px] font-bold text-amber-500/70 uppercase tracking-widest mb-2">{t('common.understandingCard.goal')}</h4>
                    <p className="text-white font-medium text-sm">{conf.goal}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <h4 className="text-[10px] font-bold text-amber-500/70 uppercase tracking-widest mb-2">{t('common.understandingCard.steps')}</h4>
                      <ul className="space-y-1.5">
                        {conf.steps.map((step, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                            <span className="w-4 h-4 bg-amber-500/20 rounded flex items-center justify-center text-[8px] font-bold text-amber-400 mt-0.5 shrink-0">{i+1}</span>
                            {step}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4 className="text-[10px] font-bold text-rose-500/70 uppercase tracking-widest mb-2">{t('common.understandingCard.risks')}</h4>
                      <ul className="space-y-1.5">
                        {conf.risks.map((risk, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                            <AlertTriangle size={12} className="text-rose-400 mt-0.5 shrink-0" />
                            {risk}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 pt-4 border-t border-amber-500/10">
                    <button className="flex-1 bg-amber-500 hover:bg-amber-400 text-white py-2 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2">
                      <Check size={14} />
                      {t('common.understandingCard.confirm')}
                    </button>
                    <button className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-2 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 border border-slate-700">
                      <RotateCcw size={14} />
                      {t('common.understandingCard.modify')}
                    </button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="min-h-[500px] flex flex-col bg-[#1A202C]/50 border-slate-800">
            <CardHeader className="flex flex-row items-center justify-between border-b border-slate-800 p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center text-sky-400 border border-sky-500/20">
                  <Terminal size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-white">{t('common.liveStream')}</h3>
                  <p className="text-xs text-slate-500">{t('common.monitoring')}: <span className="text-sky-400 font-bold">OCC-PRODUCT</span></p>
                </div>
              </div>
              <div className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500 text-[10px] font-bold animate-pulse border border-emerald-500/20">{t('common.streaming')}</div>
            </CardHeader>
            <CardContent className="flex-1 bg-[#0B1015] m-4 rounded-2xl border border-slate-800 p-6 font-mono text-sm overflow-y-auto custom-scrollbar">
              <div className="space-y-4">
                <div className="text-slate-500 flex items-center gap-2">
                  <span className="text-sky-500 font-bold">[THINK]</span>
                  <span className="italic">{currentThinking || t('common.analyzing')}</span>
                </div>
                <div className="text-slate-200 leading-relaxed space-y-2">
                  {liveStreamText.map((line, i) => (
                    <p key={i} className="opacity-80 flex gap-2">
                      <span className="text-slate-600 shrink-0">{i+1}</span>
                      {line}
                    </p>
                  ))}
                  <p className="text-sky-400 animate-pulse inline-block w-2 h-4 bg-sky-400 ml-1" />
                </div>
              </div>
            </CardContent>
            <div className="p-4 border-t border-slate-800 flex gap-3">
              <input 
                type="text" 
                placeholder={t('common.instructionPlaceholder')}
                className="flex-1 bg-[#0B1015] border border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-sky-500 transition-all"
              />
              <button className="bg-sky-500 hover:bg-sky-400 text-white px-6 py-3 rounded-xl text-sm font-bold transition-all shadow-lg shadow-sky-500/20">
                <Send size={18} />
              </button>
            </div>
          </Card>
        </div>

        {/* Right Column: Timeline / War Room */}
        <div className="col-span-3 space-y-8">
          <Card className="h-full flex flex-col bg-[#1A202C]/50 border-slate-800">
            <CardHeader className="border-b border-slate-800 p-4">
              <h3 className="font-bold text-white flex items-center gap-2">
                <History size={18} className="text-sky-400" /> 
                {t('common.warRoom')}
              </h3>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto space-y-8 relative p-6 custom-scrollbar">
              <div className="absolute left-8 top-8 bottom-8 w-px bg-slate-800" />
              {project.timeline.map((event, idx) => (
                <div key={event.id} className="relative pl-10 group">
                  <div className={cn(
                    "absolute left-[-5px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-[#151921] transition-all group-hover:scale-125",
                    event.type === 'approval_request' ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" : "bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.5)]"
                  )} />
                  <div className="text-[10px] text-slate-500 font-mono mb-1 uppercase tracking-widest">{new Date(event.timestamp).toLocaleTimeString()}</div>
                  <h5 className="text-sm font-bold text-slate-200 group-hover:text-sky-400 transition-colors">{event.title}</h5>
                  <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{event.content}</p>
                  {event.type === 'approval_request' && (
                    <div className="mt-4 flex gap-2">
                      <button className="bg-emerald-500 hover:bg-emerald-400 text-white text-[10px] font-bold px-4 py-1.5 rounded-lg transition-all shadow-lg shadow-emerald-500/10">{t('common.approve')}</button>
                      <button className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold px-4 py-1.5 rounded-lg transition-all border border-slate-700">{t('common.reject')}</button>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Emergency Intervention Modal */}
      <AnimatePresence>
        {isIntervening && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/90 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#1A202C] border-2 border-rose-500/50 rounded-3xl w-full max-w-lg p-10 shadow-2xl shadow-rose-500/20"
            >
              <div className="flex items-center gap-4 text-rose-500 mb-8">
                <div className="w-16 h-16 bg-rose-500/10 rounded-2xl flex items-center justify-center border border-rose-500/20">
                  <ShieldAlert size={32} />
                </div>
                <div>
                  <h3 className="text-3xl font-black uppercase tracking-tighter">{t('common.intervene')}</h3>
                  <p className="text-rose-500/60 text-xs font-bold tracking-widest uppercase">Emergency Override Active</p>
                </div>
              </div>
              <p className="text-slate-300 mb-8 leading-relaxed">{t('common.interventionDesc')}</p>
              <div className="space-y-4">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">{t('common.interventionCmd')}</label>
                <textarea 
                  placeholder={t('common.interventionPlaceholder')}
                  className="w-full bg-[#0B1015] border border-rose-500/20 rounded-2xl p-6 text-slate-200 focus:ring-2 focus:ring-rose-500 outline-none min-h-[120px] resize-none transition-all"
                />
              </div>
              <div className="flex justify-end gap-4 mt-10">
                <button onClick={() => setIsIntervening(false)} className="px-6 py-3 text-slate-400 hover:text-slate-200 font-bold text-sm transition-all">{t('common.cancel')}</button>
                <button className="bg-rose-500 hover:bg-rose-400 text-white px-10 py-3 rounded-2xl font-bold text-sm transition-all shadow-xl shadow-rose-500/20">
                  {t('common.executeOverride')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
