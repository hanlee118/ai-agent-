import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { cn } from '../../lib/utils';
import { modelsApi } from '../../lib/api';
import SurfaceModal from '../impl/SurfaceModal';

const NewModelModal = ({
  isOpen,
  onClose,
  addToast,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onCreated?: () => Promise<void> | void;
}) => {
  const [step, setStep] = useState(1);
  const [provider, setProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [modelName, setModelName] = useState('');
  const [tokenLimit, setTokenLimit] = useState('1000000');
  const [submitting, setSubmitting] = useState(false);

  const resetForm = () => {
    setStep(1);
    setProvider('');
    setApiKey('');
    setApiBaseUrl('');
    setModelName('');
    setTokenLimit('1000000');
    setSubmitting(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleCreateModel = async () => {
    const normalizedProvider = provider.trim();
    const normalizedName = modelName.trim();
    const normalizedLimit = Number(tokenLimit);

    if (!normalizedProvider) {
      addToast('请先选择模型提供商', 'error');
      setStep(1);
      return;
    }
    if (!normalizedName) {
      addToast('请输入模型名称', 'error');
      return;
    }
    if (!Number.isFinite(normalizedLimit) || normalizedLimit <= 0) {
      addToast('请输入有效的每日 Token 限额', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const created = await modelsApi.create({
        name: normalizedName,
        provider: normalizedProvider,
        apiKey: apiKey.trim() || undefined,
        apiBaseUrl: apiBaseUrl.trim() || undefined,
        tokenLimit: Math.floor(normalizedLimit),
      });

      try {
        await modelsApi.healthCheck(created.id);
      } catch {
        // Health check is optional for initial creation; ignore transient failures.
      }

      if (onCreated) {
        await onCreated();
      }
      addToast('模型接入成功！', 'success');
      handleClose();
    } catch (error) {
      addToast(`模型接入失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SurfaceModal isOpen={isOpen} onClose={handleClose} title="接入新计算模型">
      <div className="space-y-8">
        <div className="flex items-center gap-4 mb-8">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors",
                step >= s ? "bg-primary text-surface" : "bg-white/5 text-slate-500 border border-border-subtle"
              )}>
                {s}
              </div>
              <div className={cn("h-px w-8 bg-border-subtle", step > s && "bg-primary")} />
            </div>
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-6">
            <h3 className="text-lg font-bold text-white">选择模型提供商</h3>
            <div className="grid grid-cols-2 gap-4">
              {['OpenAI', 'Anthropic', 'Google Gemini', 'Meta Llama', 'Mistral AI', '本地部署'].map((providerOption) => (
                <button 
                  key={providerOption}
                  onClick={() => {
                    setProvider(providerOption);
                    setStep(2);
                  }}
                  className={cn(
                    "p-4 border rounded-2xl text-left transition-all group",
                    provider === providerOption
                      ? "bg-primary/10 border-primary/40"
                      : "bg-white/5 border-border-subtle hover:border-primary/50 hover:bg-primary/5",
                  )}
                >
                  <p className="font-bold text-white group-hover:text-primary transition-colors">{providerOption}</p>
                  <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-widest">点击选择并继续</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <h3 className="text-lg font-bold text-white">配置 API 凭据</h3>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">API 密钥</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">自定义端点 (可选)</label>
                <input
                  type="text"
                  value={apiBaseUrl}
                  onChange={(e) => setApiBaseUrl(e.target.value)}
                  placeholder="https://api.example.com/v1"
                  className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>
            <div className="flex gap-4 pt-4">
              <button onClick={() => setStep(1)} className="flex-1 py-3 bg-white/5 border border-border-subtle rounded-xl text-sm font-bold hover:bg-white/10 transition-all">返回</button>
              <button onClick={() => setStep(3)} className="flex-1 py-3 bg-primary text-surface rounded-xl text-sm font-bold hover:bg-primary/90 transition-all">下一步</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <h3 className="text-lg font-bold text-white">模型参数与限额</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">模型名称</label>
                  <input
                    type="text"
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    placeholder="gpt-4o"
                    className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">每日 Token 限额</label>
                  <input
                    type="number"
                    value={tokenLimit}
                    onChange={(e) => setTokenLimit(e.target.value)}
                    placeholder="1000000"
                    className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>
              <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl flex items-center gap-3">
                <ShieldCheck size={20} className="text-primary" />
                <p className="text-xs text-slate-300">系统将自动验证连接并测试延迟。</p>
              </div>
            </div>
            <div className="flex gap-4 pt-4">
              <button onClick={() => setStep(2)} className="flex-1 py-3 bg-white/5 border border-border-subtle rounded-xl text-sm font-bold hover:bg-white/10 transition-all">返回</button>
              <button 
                onClick={() => void handleCreateModel()}
                disabled={submitting}
                className="flex-1 py-3 bg-primary text-surface rounded-xl text-sm font-bold hover:bg-primary/90 transition-all disabled:opacity-60"
              >
                {submitting ? '接入中...' : '完成接入'}
              </button>
            </div>
          </div>
        )}
      </div>
    </SurfaceModal>
  );
};


export default NewModelModal;
