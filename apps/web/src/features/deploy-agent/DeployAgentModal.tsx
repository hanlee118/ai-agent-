import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Agent, Model, Project } from '../../types';
import { useDeployAgent } from './useDeployAgent';

type ToastFn = (message: string, type?: 'success' | 'error' | 'info') => void;

type DeployAgentModalProps = {
  isOpen: boolean;
  onClose: () => void;
  agents: Agent[];
  models: Model[];
  projects: Project[];
  addToast: ToastFn;
  onDeployed?: () => Promise<void> | void;
};

const Modal = ({
  isOpen,
  onClose,
  title,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) => (
  <AnimatePresence>
    {isOpen && (
      <>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50"
          onClick={onClose}
        />
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          className="fixed inset-0 flex items-center justify-center z-50 p-4"
        >
          <div className="w-full max-w-3xl bg-surface-soft border border-border-subtle rounded-3xl shadow-2xl overflow-hidden">
            <div className="px-8 py-6 border-b border-border-subtle flex justify-between items-center bg-white/5">
              <h2 className="text-lg font-bold text-white uppercase tracking-wider">{title}</h2>
              <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-8 max-h-[80vh] overflow-y-auto scrollbar-hide">{children}</div>
          </div>
        </motion.div>
      </>
    )}
  </AnimatePresence>
);

export default function DeployAgentModal({
  isOpen,
  onClose,
  agents,
  models,
  projects,
  addToast,
  onDeployed,
}: DeployAgentModalProps) {
  const {
    selectedTemplate,
    setSelectedTemplate,
    isCustom,
    setIsCustom,
    customTemplateRaw,
    setCustomTemplateRaw,
    agentName,
    setAgentName,
    targetEngine,
    setTargetEngine,
    selectedProjectId,
    setSelectedProjectId,
    isDeploying,
    uniqueRoles,
    deployAgent,
  } = useDeployAgent({
    isOpen,
    agents,
    models,
    projects,
    addToast,
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="部署新 Agent">
      <div className="space-y-6">
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-white uppercase tracking-widest">选择角色模板</h3>
            <button
              onClick={() => setIsCustom(!isCustom)}
              className="text-[10px] font-bold text-primary hover:underline uppercase tracking-widest"
            >
              {isCustom ? '选择预设' : '自定义模板'}
            </button>
          </div>

          {!isCustom ? (
            <div className="grid grid-cols-2 gap-3">
              {uniqueRoles.length > 0 ? uniqueRoles.map((template) => (
                <button
                  key={template.id}
                  onClick={() => setSelectedTemplate(template.id)}
                  className={cn(
                    'p-4 border rounded-2xl text-left transition-all',
                    selectedTemplate === template.id ? 'bg-primary/10 border-primary' : 'bg-white/5 border-border-subtle hover:bg-white/10',
                  )}
                >
                  <p className={cn('font-bold text-sm', selectedTemplate === template.id ? 'text-primary' : 'text-white')}>{template.name}</p>
                  <p className="text-[10px] text-slate-500 mt-1">{template.desc}</p>
                </button>
              )) : (
                <p className="col-span-2 text-center text-slate-500 py-8">暂无可用 Agent 角色</p>
              )}
            </div>
          ) : (
            <div className="space-y-4 p-4 bg-white/5 border border-dashed border-border-subtle rounded-2xl">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">模板定义 (JSON)</label>
                <textarea
                  rows={5}
                  value={customTemplateRaw}
                  onChange={(event) => setCustomTemplateRaw(event.target.value)}
                  placeholder='{ "role": "Reviewer", "soul": "...", "sop": ["步骤1","步骤2"] }'
                  className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                />
              </div>
              <button
                onClick={() => {
                  setSelectedTemplate('custom');
                  setIsCustom(false);
                }}
                className="w-full py-2 bg-white/10 hover:bg-white/20 rounded-xl text-[10px] font-bold text-white transition-all uppercase tracking-widest"
              >
                应用自定义模板
              </button>
            </div>
          )}
        </div>

        {(selectedTemplate || isCustom) && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 pt-4 border-t border-border-subtle">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Agent 命名</label>
              <input
                type="text"
                value={agentName}
                onChange={(event) => setAgentName(event.target.value)}
                placeholder="例如: Aegis-Alpha"
                className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">执行主体</label>
              <select
                value={targetEngine}
                onChange={(event) => setTargetEngine(event.target.value as 'openclaw' | 'hermes' | 'managed')}
                className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none"
              >
                <option value="openclaw">OpenClaw</option>
                <option value="hermes">Hermes</option>
                <option value="managed">Managed</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">分配项目</label>
              <select
                value={selectedProjectId}
                onChange={(event) => setSelectedProjectId(event.target.value)}
                className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none"
              >
                <option value="">暂不分配项目</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </div>
            <button
              onClick={() => void deployAgent(onDeployed, onClose)}
              disabled={isDeploying}
              className="w-full py-3 bg-primary text-surface rounded-xl text-sm font-bold hover:bg-primary/90 transition-all mt-4 disabled:opacity-60"
            >
              {isDeploying ? '部署中...' : '立即部署'}
            </button>
          </motion.div>
        )}
      </div>
    </Modal>
  );
}
