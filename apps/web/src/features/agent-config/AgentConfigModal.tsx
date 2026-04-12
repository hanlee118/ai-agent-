import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Trash2, X } from 'lucide-react';
import type { Agent, Model } from '../../types';
import { useAgentConfig } from './useAgentConfig';

type ToastFn = (message: string, type?: 'success' | 'error' | 'info') => void;

type AgentConfigModalProps = {
  isOpen: boolean;
  onClose: () => void;
  agentId?: string | null;
  agents: Agent[];
  models: Model[];
  addToast: ToastFn;
  onUpdated?: () => Promise<void> | void;
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

export default function AgentConfigModal({
  isOpen,
  onClose,
  agentId,
  agents,
  models,
  addToast,
  onUpdated,
}: AgentConfigModalProps) {
  const {
    fallbackAgent,
    configSource,
    canDelete,
    agentName,
    setAgentName,
    agentRole,
    setAgentRole,
    selectedModelId,
    setSelectedModelId,
    selectedIntegrationEngine,
    setSelectedIntegrationEngine,
    soulInput,
    setSoulInput,
    sopInput,
    setSopInput,
    isLoadingDetail,
    isSaving,
    saveConfig,
    deleteAgent,
  } = useAgentConfig({
    isOpen,
    agentId,
    agents,
    models,
    addToast,
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`配置 Agent: ${agentName || fallbackAgent.name}`}>
      <div className="space-y-6">
        {isLoadingDetail && (
          <div className="p-3 bg-white/5 border border-border-subtle rounded-xl text-xs text-slate-400">
            正在加载 Agent 配置...
          </div>
        )}
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Agent 名称</label>
            <input
              type="text"
              value={agentName}
              onChange={(event) => setAgentName(event.target.value)}
              readOnly
              className="w-full bg-surface-muted/70 border border-border-subtle rounded-xl px-4 py-3 text-sm text-slate-300 focus:outline-none cursor-not-allowed"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">核心角色</label>
            <input
              type="text"
              value={agentRole}
              onChange={(event) => setAgentRole(event.target.value)}
              readOnly
              className="w-full bg-surface-muted/70 border border-border-subtle rounded-xl px-4 py-3 text-sm text-slate-300 focus:outline-none cursor-not-allowed"
            />
          </div>
        </div>
        <p className="text-[10px] text-slate-500 -mt-3">名称与角色当前为只读，支持在线修改 SOUL、SOP 和模型。</p>
        <p className="text-[10px] text-slate-500 -mt-3">配置源：{configSource === 'openclaw' ? 'OpenClaw 工作区 Agent' : '本地管理 Agent'}</p>
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">执行主体</label>
          <select
            value={selectedIntegrationEngine}
            onChange={(event) => setSelectedIntegrationEngine(event.target.value as 'openclaw' | 'hermes' | 'managed')}
            className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none"
          >
            <option value="managed">Managed</option>
            <option value="openclaw">OpenClaw</option>
            <option value="hermes">Hermes</option>
          </select>
          <p className="text-[11px] text-slate-500">切换主体不会删除 Agent 资产；会更新后续编排和展示中的引擎归属。</p>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">运行模型</label>
          <select
            value={selectedModelId}
            onChange={(event) => setSelectedModelId(event.target.value)}
            className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none"
          >
            <option value="">未选择模型</option>
            {models.map((model) => (
              <option key={model.id} value={model.id}>{model.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">核心身份 (SOUL)</label>
          <textarea
            rows={4}
            className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            value={soulInput}
            onChange={(event) => setSoulInput(event.target.value)}
            placeholder="输入 Agent 的核心身份描述..."
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">标准操作程序 (SOP)</label>
          <textarea
            rows={5}
            className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            value={sopInput}
            onChange={(event) => setSopInput(event.target.value)}
            placeholder={'每行一步，例如：\n1. 分析需求\n2. 识别模糊点\n3. 输出确认卡'}
          />
        </div>
        <button
          onClick={() => void saveConfig(onUpdated, onClose)}
          disabled={isSaving || isLoadingDetail}
          className="w-full py-3 bg-primary text-surface rounded-xl text-sm font-bold hover:bg-primary/90 transition-all mt-4 disabled:opacity-60"
        >
          {isSaving ? '保存中...' : '保存配置'}
        </button>
        {canDelete && (
          <button
            onClick={() => {
              const confirmed = window.confirm(`确认删除 Agent「${agentName || fallbackAgent.name}」？此操作不可撤销。`);
              if (!confirmed) {
                return;
              }
              void deleteAgent(onUpdated, onClose);
            }}
            disabled={isSaving || isLoadingDetail}
            className="w-full py-3 bg-danger/10 border border-danger/40 text-danger rounded-xl text-sm font-bold hover:bg-danger/20 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
          >
            <Trash2 size={16} />
            删除 Agent
          </button>
        )}
      </div>
    </Modal>
  );
}
