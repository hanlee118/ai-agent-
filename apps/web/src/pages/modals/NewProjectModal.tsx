import React, { useState } from 'react';
import { FileUp, Upload, X, Zap } from 'lucide-react';
import { motion } from 'motion/react';
import { projectsApi } from '../../lib/api';
import { agents } from '../../lib/runtimeCollections';
import { cn } from '../../lib/utils';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onProjectCreated?: () => Promise<void> | void;
};

type ParsedProjectDraft = {
  name: string;
  description: string;
  phase: string;
  agents: string[];
  priority: 'High' | 'Medium' | 'Low';
  team: string[];
};

function Badge({ children, variant = 'default' }: any) {
  const variants: any = {
    default: 'bg-white/5 text-slate-400 border-border-subtle',
    primary: 'bg-primary/20 text-primary border-primary/20',
    accent: 'bg-accent/20 text-accent border-accent/20',
    warning: 'bg-warning/20 text-warning border-warning/20',
    danger: 'bg-danger/20 text-danger border-danger/20',
  };
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border', variants[variant])}>
      {children}
    </span>
  );
}

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

export default function NewProjectModal({ isOpen, onClose, addToast, onProjectCreated }: Props) {
  const [isImporting, setIsImporting] = useState(false);
  const [step, setStep] = useState<'input' | 'confirm'>('input');
  const [rawInput, setRawInput] = useState('');
  const [parsedProject, setParsedProject] = useState<ParsedProjectDraft | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    priority: 'Medium',
    dueDate: '',
    agentIds: [] as string[],
  });

  const resetState = () => {
    setIsImporting(false);
    setStep('input');
    setRawInput('');
    setParsedProject(null);
    setIsParsing(false);
    setIsCreating(false);
    setShowManualForm(false);
    setFormData({
      name: '',
      description: '',
      priority: 'Medium',
      dueDate: '',
      agentIds: [],
    });
  };

  const suggestName = (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) {
      return '';
    }

    const candidate = trimmed
      .replace(/(请|帮我|我们|需要|想要|希望|做一个|做个|创建|搭建|开发|实现|一个|项目|系统)/g, ' ')
      .replace(/[，。,.!?]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4)
      .join('');

    return candidate ? `${candidate.slice(0, 16)}项目` : '新项目';
  };

  const parseNaturalLanguage = (input: string): ParsedProjectDraft => {
    const trimmed = input.trim();
    const firstSentence =
      trimmed
        .split(/[。！？.!?\n]/)
        .map((line) => line.trim())
        .find(Boolean) || trimmed;

    const matchedName = trimmed.match(/(?:项目|系统|平台|应用|工作台|MVP)(?:名称|叫|名为)?[:：]?\s*([^\n，。；]{2,24})/);
    let safeName = matchedName?.[1]?.trim() || suggestName(firstSentence) || '新项目';
    if (!/(项目|系统|平台|应用|工作台|MVP)/.test(safeName)) {
      safeName = `${safeName}项目`;
    }
    if (safeName.length > 32) {
      safeName = `${safeName.slice(0, 32)}...`;
    }

    const lower = trimmed.toLowerCase();
    const inferPriority: 'High' | 'Medium' | 'Low' =
      /(紧急|立即|尽快|高优|asap|critical|urgent)/.test(lower)
        ? 'High'
        : /(低优|可延期|不紧急|nice to have|backlog)/.test(lower)
          ? 'Low'
          : 'Medium';

    const inferredAgents = agents
      .filter((agent) => {
        const profile = `${agent.name} ${agent.role}`.toLowerCase();
        if (trimmed.includes(agent.name) || trimmed.includes(agent.role)) {
          return true;
        }
        if (/(设计|ui|体验|视觉)/.test(lower) && /设计/.test(profile)) {
          return true;
        }
        if (/(研发|开发|编码|工程|技术)/.test(lower) && /(研发|工程|架构)/.test(profile)) {
          return true;
        }
        if (/(测试|质量|qa)/.test(lower) && /(测试|qa)/.test(profile)) {
          return true;
        }
        if (/(需求|规划|产品)/.test(lower) && /(需求|产品|分析)/.test(profile)) {
          return true;
        }
        return false;
      })
      .map((agent) => agent.name);

    const selectedManualAgents = formData.agentIds
      .map((id) => agents.find((agent) => agent.id === id)?.name)
      .filter(Boolean) as string[];

    const safeAgents =
      selectedManualAgents.length > 0
        ? selectedManualAgents
        : inferredAgents.length > 0
          ? inferredAgents.slice(0, 4)
          : agents.slice(0, 3).map((agent) => agent.name);

    return {
      name: safeName,
      description: trimmed,
      phase: '规划中',
      agents: safeAgents,
      priority: inferPriority,
      team: safeAgents,
    };
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleImportProjectFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const raw = await file.text();
      const normalized = raw.trim();
      if (!normalized) {
        addToast('文件内容为空，请重新选择', 'error');
        return;
      }
      const nextInput = normalized.slice(0, 6000);
      setRawInput(nextInput);
      setIsImporting(false);
      setStep('input');
      addToast(`已导入文件: ${file.name}`, 'success');
    } catch (error) {
      addToast(`文件读取失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      event.target.value = '';
    }
  };

  const handleToggleManualAgent = (agentId: string) => {
    setFormData((prev) => ({
      ...prev,
      agentIds: prev.agentIds.includes(agentId)
        ? prev.agentIds.filter((id) => id !== agentId)
        : [...prev.agentIds, agentId],
    }));
  };

  const handleParseInput = () => {
    const input = rawInput.trim();
    if (!input) {
      addToast('请先输入项目需求', 'error');
      return;
    }

    setIsParsing(true);
    const parsed = parseNaturalLanguage(input);
    setParsedProject(parsed);
    setStep('confirm');
    setIsParsing(false);
    addToast('已生成项目理解确认卡', 'success');
  };

  const handleCreateFromParsed = async () => {
    if (!parsedProject) {
      return;
    }

    setIsCreating(true);
    try {
      await projectsApi.create({
        name: parsedProject.name,
        description: parsedProject.description,
        requirements: rawInput.trim() || parsedProject.description,
      });
      addToast('项目创建成功，正在分配资源...', 'success');
      await onProjectCreated?.();
      handleClose();
    } catch (error: any) {
      addToast(`创建失败: ${error.message}`, 'error');
    } finally {
      setIsCreating(false);
    }
  };

  const handleManualSubmit = () => {
    if (!formData.name.trim()) {
      addToast('请输入项目名称', 'error');
      return;
    }

    if (!formData.description.trim()) {
      addToast('请输入项目描述', 'error');
      return;
    }

    const manualAgents = formData.agentIds
      .map((id) => agents.find((agent) => agent.id === id)?.name)
      .filter(Boolean) as string[];

    setParsedProject({
      name: formData.name.trim(),
      description: formData.description.trim(),
      phase: '规划中',
      agents: manualAgents.length > 0 ? manualAgents : agents.slice(0, 3).map((agent) => agent.name),
      priority: formData.priority as 'High' | 'Medium' | 'Low',
      team: manualAgents,
    });
    setStep('confirm');
    addToast('已生成项目理解确认卡', 'success');
  };

  const handleUseManualFromParsed = () => {
    if (!parsedProject) {
      return;
    }

    const selectedIds = agents
      .filter((agent) => parsedProject.agents.includes(agent.name))
      .map((agent) => agent.id);

    setFormData({
      name: parsedProject.name,
      description: parsedProject.description,
      priority: parsedProject.priority,
      dueDate: '',
      agentIds: selectedIds,
    });
    setShowManualForm(true);
    setStep('input');
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="创建新项目">
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">FR-010 自然语言创建</p>
          <button
            onClick={() => setIsImporting(!isImporting)}
            className="text-[10px] font-bold text-primary hover:underline uppercase tracking-widest flex items-center gap-1"
          >
            <Upload size={12} />
            {isImporting ? '返回创建流程' : '导入项目定义'}
          </button>
        </div>

        {!isImporting ? (
          <>
            {step === 'input' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">项目需求（自然语言）</label>
                  <textarea
                    rows={5}
                    value={rawInput}
                    onChange={(event) => setRawInput(event.target.value)}
                    placeholder="例如：请创建一个电商客服优化项目，2周内完成 MVP，优先由多个 Agent 并行推进。"
                    className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={handleParseInput}
                    disabled={isParsing || !rawInput.trim()}
                    className="py-3 bg-primary text-surface rounded-xl text-sm font-bold hover:bg-primary/90 transition-all disabled:opacity-50"
                  >
                    {isParsing ? 'AI 解析中...' : 'AI 解析并生成确认卡'}
                  </button>
                  <button
                    onClick={() => setShowManualForm((prev) => !prev)}
                    className="py-3 bg-white/5 border border-border-subtle rounded-xl text-sm font-bold hover:bg-white/10 transition-all"
                  >
                    {showManualForm ? '收起手动表单' : '手动填写'}
                  </button>
                </div>

                {showManualForm && (
                  <div className="space-y-4 p-4 bg-white/5 border border-border-subtle rounded-2xl">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">项目名称</label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(event) => setFormData((prev) => ({ ...prev, name: event.target.value }))}
                        placeholder="例如: 智能供应链优化"
                        className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">项目描述</label>
                      <textarea
                        rows={3}
                        value={formData.description}
                        onChange={(event) => setFormData((prev) => ({ ...prev, description: event.target.value }))}
                        placeholder="简述项目目标、范围和关键约束..."
                        className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">优先级</label>
                        <select
                          value={formData.priority}
                          onChange={(event) => setFormData((prev) => ({ ...prev, priority: event.target.value as 'High' | 'Medium' | 'Low' }))}
                          className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none"
                        >
                          <option value="High">高 (High)</option>
                          <option value="Medium">中 (Medium)</option>
                          <option value="Low">低 (Low)</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">截止日期</label>
                        <input
                          type="date"
                          value={formData.dueDate}
                          onChange={(event) => setFormData((prev) => ({ ...prev, dueDate: event.target.value }))}
                          className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">分配团队</label>
                      <div className="flex flex-wrap gap-2">
                        {agents.map((agent) => (
                          <label
                            key={agent.id}
                            className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-border-subtle rounded-xl cursor-pointer hover:bg-white/10 transition-colors"
                          >
                            <input
                              type="checkbox"
                              checked={formData.agentIds.includes(agent.id)}
                              onChange={() => handleToggleManualAgent(agent.id)}
                              className="accent-primary"
                            />
                            <span className="text-xs text-slate-300">{agent.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={handleManualSubmit}
                      disabled={isCreating}
                      className="w-full py-3 bg-primary text-surface rounded-xl text-sm font-bold hover:bg-primary/90 transition-all mt-2 disabled:opacity-50"
                    >
                      生成确认卡
                    </button>
                  </div>
                )}
              </div>
            )}

            {step === 'confirm' && parsedProject && (
              <div className="bg-surface-soft border border-warning/20 rounded-2xl p-5 space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-warning">
                    <Zap size={14} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">创建前理解确认卡</span>
                  </div>
                  <Badge variant="warning">待确认</Badge>
                </div>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">名称</label>
                    <input
                      type="text"
                      value={parsedProject.name}
                      onChange={(event) => setParsedProject((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
                      className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">描述</label>
                    <textarea
                      rows={3}
                      value={parsedProject.description}
                      onChange={(event) =>
                        setParsedProject((prev) => (prev ? { ...prev, description: event.target.value } : prev))
                      }
                      className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">阶段</label>
                      <select
                        value={parsedProject.phase}
                        onChange={(event) => setParsedProject((prev) => (prev ? { ...prev, phase: event.target.value } : prev))}
                        className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none"
                      >
                        <option value="规划中">规划中</option>
                        <option value="分析">分析</option>
                        <option value="设计">设计</option>
                        <option value="开发">开发</option>
                        <option value="验收">验收</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">优先级</label>
                      <select
                        value={parsedProject.priority}
                        onChange={(event) =>
                          setParsedProject((prev) =>
                            prev ? { ...prev, priority: event.target.value as 'High' | 'Medium' | 'Low' } : prev,
                          )
                        }
                        className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none"
                      >
                        <option value="High">高 (High)</option>
                        <option value="Medium">中 (Medium)</option>
                        <option value="Low">低 (Low)</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">建议团队</label>
                    <div className="flex flex-wrap gap-2">
                      {(parsedProject.agents.length > 0 ? parsedProject.agents : ['未识别，建议手动调整']).map((agentName) => (
                        <span key={agentName} className="px-3 py-1.5 rounded-xl bg-white/5 border border-border-subtle text-xs text-slate-300">
                          {agentName}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setStep('input')}
                    className="flex-1 py-2.5 bg-white/5 border border-border-subtle rounded-xl text-xs font-bold hover:bg-white/10 transition-all"
                  >
                    修改输入
                  </button>
                  <button
                    onClick={handleUseManualFromParsed}
                    className="flex-1 py-2.5 bg-white/5 border border-border-subtle rounded-xl text-xs font-bold hover:bg-white/10 transition-all"
                  >
                    手动微调
                  </button>
                  <button
                    onClick={() => void handleCreateFromParsed()}
                    disabled={isCreating}
                    className="flex-1 py-2.5 bg-primary text-surface rounded-xl text-xs font-bold hover:bg-primary/90 transition-all disabled:opacity-50"
                  >
                    {isCreating ? '创建中...' : '确认创建'}
                  </button>
                </div>
                <button
                  onClick={handleClose}
                  className="w-full py-2 bg-transparent border border-border-subtle rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-white/5 transition-all"
                >
                  取消
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="p-8 border-2 border-dashed border-border-subtle rounded-2xl bg-white/5 flex flex-col items-center justify-center space-y-4 group hover:border-primary/50 transition-all cursor-pointer">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
              <FileUp size={24} />
            </div>
            <div className="text-center">
              <p className="text-sm font-bold text-white">点击或拖拽文件到此处</p>
              <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-widest">支持 .json, .yaml, .pdf 项目文档</p>
            </div>
            <input
              type="file"
              className="hidden"
              id="project-file"
              accept=".txt,.md,.json,.yaml,.yml,.csv,.log,.xml"
              onChange={(event) => void handleImportProjectFile(event)}
            />
            <label
              htmlFor="project-file"
              className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-[10px] font-bold text-white transition-all cursor-pointer"
            >
              选择文件
            </label>
          </div>
        )}
      </div>
    </Modal>
  );
}
