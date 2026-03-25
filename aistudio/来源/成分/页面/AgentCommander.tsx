import React from 'react';
import { 
  ChevronLeft, 
  BrainCircuit, 
  Zap, 
  Terminal, 
  Activity, 
  Send, 
  Check, 
  RotateCcw, 
  AlertTriangle, 
  Cpu, 
  Database, 
  ShieldCheck, 
  History, 
  FileCode, 
  MessageSquare,
  BarChart3,
  Settings2,
  Lock,
  UserCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Card, CardHeader, CardContent, Badge } from '../ui/Card';
import { useTranslation } from '../../contexts/LanguageContext';
import { AgentProfile, RoleType } from '../../types';
import { cn } from '../../lib/utils';

interface AgentCommanderProps {
  agent: AgentProfile;
  onBack: () => void;
  onUpdateAgent: (roleId: RoleType, updates: Partial<AgentProfile>) => void;
  instruction: string;
  setInstruction: (val: string) => void;
  handleSendInstruction: () => void;
  understanding: {
    goal: string;
    plan: string[];
    steps: string[];
    risks: string[];
    suggestion: string;
  } | null;
  setUnderstanding: (val: any) => void;
}

export const AgentCommander: React.FC<AgentCommanderProps> = ({
  agent,
  onBack,
  onUpdateAgent,
  instruction,
  setInstruction,
  handleSendInstruction,
  understanding,
  setUnderstanding
}) => {
  const { t } = useTranslation();

  const models = [
    { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro', tags: ['reasoning', 'multimodal'], status: 'active' },
    { id: 'gemini-3.1-flash', name: 'Gemini 3.1 Flash', tags: ['speed', 'cost'], status: 'active' },
    { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', tags: ['speed', 'cost'], status: 'active' },
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500 pb-20">
      {/* Header Section */}
      <div className="flex items-center justify-between bg-[#0B1015] p-6 rounded-2xl border border-slate-800">
        <div className="flex items-center gap-6">
          <button 
            onClick={onBack}
            className="p-2.5 bg-slate-800/50 hover:bg-slate-700 rounded-xl text-slate-400 hover:text-white transition-all border border-slate-800 active:scale-95"
          >
            <ChevronLeft size={24} />
          </button>
          <div className="w-20 h-20 bg-gradient-to-br from-sky-500 to-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-sky-500/20 border border-white/10">
            <BrainCircuit size={40} />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-3xl font-bold text-white tracking-tight">{agent.name}</h2>
              <div className={cn(
                "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border",
                agent.status === 'idle' ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-amber-500/10 text-amber-500 border-amber-500/20"
              )}>
                {agent.status.toUpperCase()}
              </div>
            </div>
            <p className="text-slate-400 font-mono text-sm mt-1.5 flex items-center gap-2">
              <span className="text-sky-400 font-bold">{agent.title}</span>
              <span className="text-slate-700">|</span>
              <span className="text-slate-500">{agent.model}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-2">{t('common.autonomousMode')}</span>
            <div 
              onClick={() => onUpdateAgent(agent.roleId, { isAutonomous: !agent.isAutonomous })}
              className={cn(
                "w-14 h-7 rounded-full p-1 cursor-pointer transition-all duration-300 relative",
                agent.isAutonomous ? 'bg-sky-500' : 'bg-slate-700'
              )}
            >
              <div className={cn(
                "w-5 h-5 bg-white rounded-full transition-all duration-300 shadow-sm",
                agent.isAutonomous ? 'translate-x-7' : 'translate-x-0'
              )} />
            </div>
          </div>
          <div className="h-12 w-px bg-slate-800" />
          <button className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 px-6 py-3 rounded-xl font-bold text-sm transition-all flex items-center gap-2 border border-rose-500/20 shadow-lg shadow-rose-500/5">
            <Zap size={18} />
            {t('common.emergency')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-8">
        {/* Left Column: Config & Identity */}
        <div className="col-span-3 space-y-8">
          {/* Model Selection */}
          <Card className="bg-[#1A202C]/50 border-slate-800">
            <CardHeader className="p-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-white flex items-center gap-2">
                <Settings2 size={18} className="text-sky-400" />
                {t('common.modelConfig')}
              </h3>
              <Badge variant="info" className="text-[10px]">v3.1</Badge>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">{t('common.currentModel')}</label>
                <div className="p-3 bg-sky-500/10 border border-sky-500/30 rounded-xl flex items-center justify-between">
                  <span className="text-sm font-bold text-sky-400">{agent.model}</span>
                  <Check size={16} className="text-sky-400" />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">{t('common.switchModel')}</label>
                <div className="space-y-2">
                  {models.filter(m => m.id !== agent.model).map(model => (
                    <button 
                      key={model.id}
                      onClick={() => onUpdateAgent(agent.roleId, { model: model.id })}
                      className="w-full p-3 bg-slate-800/50 hover:bg-slate-700 border border-slate-800 rounded-xl flex flex-col gap-1 transition-all group text-left"
                    >
                      <span className="text-sm font-bold text-slate-300 group-hover:text-white">{model.name}</span>
                      <div className="flex gap-1">
                        {model.tags.map(tag => (
                          <span key={tag} className="text-[8px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-500 uppercase font-bold">
                            {t(`common.modelTags.${tag}`)}
                          </span>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* SOUL & SOP */}
          <Card className="bg-[#1A202C]/50 border-slate-800">
            <CardHeader className="p-4 border-b border-slate-800">
              <h3 className="font-bold text-white flex items-center gap-2">
                <UserCheck size={18} className="text-indigo-400" />
                {t('common.agentSoul')}
              </h3>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div className="space-y-2">
                <textarea 
                  value={agent.soul}
                  onChange={(e) => onUpdateAgent(agent.roleId, { soul: e.target.value })}
                  className="w-full bg-[#0B1015] border border-slate-800 rounded-xl p-3 text-xs text-slate-400 focus:ring-1 focus:ring-indigo-500 outline-none min-h-[100px] resize-none"
                />
              </div>
              <div className="pt-2">
                <h3 className="font-bold text-white flex items-center gap-2 mb-4">
                  <FileCode size={18} className="text-emerald-400" />
                  {t('common.agentSOP')}
                </h3>
                <textarea 
                  value={agent.sop}
                  onChange={(e) => onUpdateAgent(agent.roleId, { sop: e.target.value })}
                  className="w-full bg-[#0B1015] border border-slate-800 rounded-xl p-3 text-xs text-slate-400 focus:ring-1 focus:ring-emerald-500 outline-none min-h-[150px] resize-none"
                />
              </div>
              <button className="w-full bg-slate-800 hover:bg-slate-700 text-white py-2.5 rounded-xl font-bold text-xs transition-all border border-slate-700">
                {t('common.save')}
              </button>
            </CardContent>
          </Card>
        </div>

        {/* Middle Column: Interaction & Tasks */}
        <div className="col-span-6 space-y-8">
          {/* Command Composer */}
          <Card className="bg-[#1A202C]/50 border-slate-800 shadow-2xl">
            <CardHeader className="flex items-center justify-between py-4 px-6 border-b border-slate-800">
              <div className="flex items-center gap-2 text-sky-400">
                <Terminal size={18} />
                <span className="text-xs font-bold uppercase tracking-widest">{t('common.agentCommander.directInstruction')}</span>
              </div>
              {agent.isAutonomous && (
                <div className="flex items-center gap-2 px-2 py-0.5 rounded bg-sky-500/10 text-sky-500 text-[10px] font-bold animate-pulse border border-sky-500/20">
                  <Activity size={10} />
                  {t('common.autonomousMode')}
                </div>
              )}
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="relative group">
                <textarea 
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder={t('common.instructionPlaceholder')}
                  className="w-full bg-[#0B1015] border border-slate-800 rounded-2xl p-6 text-slate-200 focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500/50 outline-none min-h-[160px] resize-none transition-all placeholder:text-slate-600"
                />
                <div className="absolute bottom-4 right-4 flex gap-2">
                  <button 
                    onClick={handleSendInstruction}
                    disabled={!instruction.trim()}
                    className="bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white px-8 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 shadow-lg shadow-sky-500/20 active:scale-95"
                  >
                    <Send size={18} />
                    {t('common.send')}
                  </button>
                </div>
              </div>

              {/* Quick Commands */}
              <div className="flex flex-wrap gap-2 pt-2">
                {Object.entries(t('common.quickCommands')).map(([key, label]) => (
                  <button 
                    key={key}
                    onClick={() => setInstruction(label as string)}
                    className="px-4 py-2 bg-slate-800/50 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg text-xs font-bold border border-slate-800 transition-all active:scale-95"
                  >
                    {label as string}
                  </button>
                ))}
              </div>

              {/* Understanding Card */}
              <AnimatePresence>
                {understanding && (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    className="mt-6 bg-amber-500/5 border border-amber-500/20 rounded-2xl overflow-hidden"
                  >
                    <div className="bg-amber-500/10 p-4 border-b border-amber-500/10 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-amber-400">
                        <BrainCircuit size={18} />
                        <span className="text-xs font-bold uppercase tracking-widest">{t('common.understandingCard.title')}</span>
                      </div>
                      <button onClick={() => setUnderstanding(null)} className="text-amber-500/50 hover:text-amber-500 transition-colors">
                        <RotateCcw size={16} />
                      </button>
                    </div>
                    <div className="p-6 space-y-6">
                      <div>
                        <h4 className="text-[10px] font-bold text-amber-500/70 uppercase tracking-widest mb-2">{t('common.understandingCard.goal')}</h4>
                        <p className="text-white font-medium">{understanding.goal}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-8">
                        <div>
                          <h4 className="text-[10px] font-bold text-amber-500/70 uppercase tracking-widest mb-2">{t('common.understandingCard.steps')}</h4>
                          <ul className="space-y-2">
                            {understanding.steps.map((step, i) => (
                              <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                                <span className="w-4 h-4 bg-amber-500/20 rounded flex items-center justify-center text-[8px] font-bold text-amber-400 mt-0.5 shrink-0">{i+1}</span>
                                {step}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <h4 className="text-[10px] font-bold text-rose-500/70 uppercase tracking-widest mb-2">{t('common.understandingCard.risks')}</h4>
                          <ul className="space-y-2">
                            {understanding.risks.map((risk, i) => (
                              <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                                <AlertTriangle size={14} className="text-rose-400 mt-0.5 shrink-0" />
                                {risk}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 pt-4 border-t border-amber-500/10">
                        <button className="flex-1 bg-amber-500 hover:bg-amber-400 text-white py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20">
                          <Check size={18} />
                          {t('common.understandingCard.confirm')}
                        </button>
                        <button className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 border border-slate-700">
                          <RotateCcw size={18} />
                          {t('common.understandingCard.modify')}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>

          {/* Recent Sessions / Chat History */}
          <Card className="bg-[#1A202C]/50 border-slate-800">
            <CardHeader className="p-4 border-b border-slate-800">
              <h3 className="font-bold text-white flex items-center gap-2">
                <MessageSquare size={18} className="text-sky-400" />
                {t('common.agentCommander.recentTasks')}
              </h3>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              {[
                { type: 'user', text: '请分析当前项目的潜在风险点。', time: '10:30 AM' },
                { type: 'agent', text: '正在进行深度扫描... 识别到 2 个中等风险：1. 依赖库版本冲突；2. 资源分配不均。建议优先处理依赖冲突。', time: '10:31 AM' },
                { type: 'user', text: '执行依赖库升级。', time: '10:45 AM' },
                { type: 'agent', text: '理解目标：升级依赖库。计划：1. 备份当前配置；2. 运行版本检测；3. 逐个升级并验证。是否确认执行？', time: '10:46 AM' },
              ].map((msg, i) => (
                <div key={i} className={cn(
                  "flex gap-4",
                  msg.type === 'user' ? "flex-row-reverse" : ""
                )}>
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                    msg.type === 'user' ? "bg-slate-800 text-slate-400" : "bg-sky-500 text-white"
                  )}>
                    {msg.type === 'user' ? <Lock size={14} /> : <BrainCircuit size={14} />}
                  </div>
                  <div className={cn(
                    "p-4 rounded-2xl max-w-[80%] text-sm leading-relaxed",
                    msg.type === 'user' ? "bg-slate-800/50 text-slate-300 rounded-tr-none" : "bg-sky-500/10 text-slate-200 border border-sky-500/20 rounded-tl-none"
                  )}>
                    <p>{msg.text}</p>
                    <span className="text-[10px] text-slate-600 mt-2 block font-mono">{msg.time}</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Performance & Logs */}
        <div className="col-span-3 space-y-8">
          {/* Performance Metrics */}
          <Card className="bg-[#1A202C]/50 border-slate-800">
            <CardHeader className="p-4 border-b border-slate-800">
              <h3 className="font-bold text-white flex items-center gap-2">
                <BarChart3 size={18} className="text-amber-400" />
                {t('common.agentCommander.performanceMetrics')}
              </h3>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-[#0B1015] rounded-xl border border-slate-800">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Success Rate</span>
                  <p className="text-xl font-black text-emerald-400 mt-1">98.4%</p>
                </div>
                <div className="p-4 bg-[#0B1015] rounded-xl border border-slate-800">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Avg Response</span>
                  <p className="text-xl font-black text-sky-400 mt-1">1.2s</p>
                </div>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Reasoning Accuracy</span>
                    <span className="text-slate-200 font-mono">92%</span>
                  </div>
                  <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                    <div className="bg-amber-500 h-full w-[92%]" />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Task Completion</span>
                    <span className="text-slate-200 font-mono">88%</span>
                  </div>
                  <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                    <div className="bg-emerald-500 h-full w-[88%]" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Execution Logs */}
          <Card className="bg-[#1A202C]/50 border-slate-800 h-full flex flex-col">
            <CardHeader className="p-4 border-b border-slate-800">
              <h3 className="font-bold text-white flex items-center gap-2">
                <History size={18} className="text-slate-400" />
                {t('common.audit')}
              </h3>
            </CardHeader>
            <CardContent className="p-4 flex-1 overflow-y-auto custom-scrollbar space-y-4">
              {[
                { time: '10:31:05', action: 'SCAN_RISK', status: 'SUCCESS' },
                { time: '10:30:42', action: 'REASONING_START', status: 'SUCCESS' },
                { time: '10:28:15', action: 'MODEL_SWITCH', status: 'SUCCESS' },
                { time: '10:25:00', action: 'TASK_ASSIGNED', status: 'SUCCESS' },
                { time: '10:20:12', action: 'AGENT_WAKEUP', status: 'SUCCESS' },
                { time: '10:15:30', action: 'SYSTEM_CHECK', status: 'SUCCESS' },
              ].map((log, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-[#0B1015] rounded-lg border border-slate-800 group hover:border-slate-700 transition-all">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-500 font-mono">{log.time}</span>
                    <span className="text-xs font-bold text-slate-300 group-hover:text-sky-400 transition-colors">{log.action}</span>
                  </div>
                  <div className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500 text-[8px] font-bold border border-emerald-500/20">
                    {log.status}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};
