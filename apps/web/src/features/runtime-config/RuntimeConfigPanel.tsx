import { Cpu } from 'lucide-react';

type RuntimeConfigPanelProps = {
  apiProtection: boolean;
  isRuntimeLoading: boolean;
  isRuntimeValidating: boolean;
  runtimeProvider: 'scripted' | 'openai-compatible';
  runtimeApiBaseUrl: string;
  runtimeModelName: string;
  runtimeApiKey: string;
  clearRuntimeApiKey: boolean;
  runtimeApiKeyPreview: string;
  runtimeApiKeyConfigured: boolean;
  runtimeValidationHint: string;
  runtimeConfigUpdatedAt: string;
  runtimeConfigSource: 'database' | 'environment' | 'default' | 'unknown';
  registeredRuntimeModels: Array<{
    id: string;
    name: string;
    provider: string;
    isRuntimeDefault?: boolean;
  }>;
  selectedRegisteredModelId: string;
  onProviderChange: (value: 'scripted' | 'openai-compatible') => void;
  onApiBaseUrlChange: (value: string) => void;
  onModelNameChange: (value: string) => void;
  onRegisteredModelChange: (modelId: string) => void;
  onJumpToModelNexus: () => void;
  onApiKeyChange: (value: string) => void;
  onClearApiKeyChange: (value: boolean) => void;
  onReload: () => void;
  onValidate: () => void;
};

export default function RuntimeConfigPanel({
  apiProtection,
  isRuntimeLoading,
  isRuntimeValidating,
  runtimeProvider,
  runtimeApiBaseUrl,
  runtimeModelName,
  runtimeApiKey,
  clearRuntimeApiKey,
  runtimeApiKeyPreview,
  runtimeApiKeyConfigured,
  runtimeValidationHint,
  runtimeConfigUpdatedAt,
  runtimeConfigSource,
  registeredRuntimeModels,
  selectedRegisteredModelId,
  onProviderChange,
  onApiBaseUrlChange,
  onModelNameChange,
  onRegisteredModelChange,
  onJumpToModelNexus,
  onApiKeyChange,
  onClearApiKeyChange,
  onReload,
  onValidate,
}: RuntimeConfigPanelProps) {
  const sourceLabel =
    runtimeConfigSource === 'database'
      ? '模型中心 / 后台配置'
      : runtimeConfigSource === 'environment'
        ? '环境变量'
        : runtimeConfigSource === 'default'
          ? '系统默认值'
          : '未知';
  const syncTimeLabel = runtimeConfigUpdatedAt
    ? new Date(runtimeConfigUpdatedAt).toLocaleString('zh-CN')
    : '暂无';

  return (
    <section className="bg-surface-soft border border-border-subtle rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-border-subtle bg-white/5 flex items-center justify-between">
        <h2 className="font-semibold text-white flex items-center gap-2">
          <Cpu size={18} className="text-warning" />
          运行时模型配置
        </h2>
        <button
          onClick={onReload}
          disabled={isRuntimeLoading}
          className="text-[10px] font-bold text-primary hover:underline disabled:opacity-60 uppercase tracking-widest"
        >
          {isRuntimeLoading ? '加载中...' : '重新加载'}
        </button>
      </div>
      <div className="p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2 md:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">模型中心已注册模型</label>
              <button
                type="button"
                onClick={onJumpToModelNexus}
                className="px-2.5 py-1 rounded-md bg-white/5 border border-border-subtle text-[10px] font-semibold text-slate-200 hover:bg-white/10"
              >
                跳转模型中心
              </button>
            </div>
            <select
              value={selectedRegisteredModelId}
              onChange={(event) => onRegisteredModelChange(event.target.value)}
              className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary/50 appearance-none"
            >
              <option value="">手动输入（不绑定模型中心）</option>
              {registeredRuntimeModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} · {model.provider}{model.isRuntimeDefault ? '（当前默认）' : ''}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-500">
              选择后会自动回填运行模型参数，并在保存时与“模型中心默认模型”双向同步。
            </p>
            <p className="text-[10px] text-slate-500">
              最后同步: {syncTimeLabel} · 同步来源: {sourceLabel}
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">运行模式</label>
            <select
              value={runtimeProvider}
              onChange={(event) => onProviderChange(event.target.value as 'scripted' | 'openai-compatible')}
              className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary/50 appearance-none"
            >
              <option value="scripted">Scripted (本地脚本)</option>
              <option value="openai-compatible">OpenAI Compatible</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">模型名称</label>
            <input
              type="text"
              value={runtimeModelName}
              onChange={(event) => onModelNameChange(event.target.value)}
              placeholder="例如: gpt-4.1"
              className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">API Base URL</label>
          <input
            type="text"
            value={runtimeApiBaseUrl}
            onChange={(event) => onApiBaseUrlChange(event.target.value)}
            placeholder="https://api.openai.com/v1"
            className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">API Key</label>
          <input
            type={apiProtection ? 'password' : 'text'}
            value={runtimeApiKey}
            onChange={(event) => onApiKeyChange(event.target.value)}
            placeholder={runtimeApiKeyConfigured ? `已配置 (${runtimeApiKeyPreview || '******'})` : '输入新的 API Key'}
            className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-slate-500">
              {runtimeApiKeyConfigured ? `已配置密钥: ${runtimeApiKeyPreview || '******'}` : '当前未配置 API Key'}
            </p>
            <label className="flex items-center gap-2 text-[10px] text-slate-400">
              <input
                type="checkbox"
                checked={clearRuntimeApiKey}
                onChange={(event) => onClearApiKeyChange(event.target.checked)}
                className="accent-primary"
              />
              清除现有密钥
            </label>
          </div>
        </div>
        <div className="flex items-center justify-between p-3 bg-white/5 border border-border-subtle rounded-xl">
          <p className="text-xs text-slate-400">{runtimeValidationHint || '尚未进行运行配置校验'}</p>
          <button
            onClick={onValidate}
            disabled={isRuntimeValidating || isRuntimeLoading}
            className="px-3 py-1.5 bg-white/10 border border-border-subtle rounded-lg text-[10px] font-bold text-slate-300 hover:bg-white/20 transition-colors disabled:opacity-60"
          >
            {isRuntimeValidating ? '校验中...' : '运行校验'}
          </button>
        </div>
      </div>
    </section>
  );
}
