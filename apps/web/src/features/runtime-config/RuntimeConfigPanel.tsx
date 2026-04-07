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
  const inputClassName =
    'w-full rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-400/40';
  const cardClassName = 'rounded-[24px] border border-white/10 bg-white/[0.03] p-5';
  const labelClassName = 'text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500';

  return (
    <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(15,23,42,0.9))] shadow-[0_24px_80px_rgba(2,6,23,0.3)]">
      <div className="border-b border-white/10 bg-white/[0.04] px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-2xl border border-white/10 bg-white/[0.06] p-2 text-slate-100">
              <Cpu size={18} />
            </div>
            <div>
              <div className="inline-flex items-center rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-100">
                Runtime Control
              </div>
              <h2 className="mt-3 text-xl font-semibold text-white">运行时模型配置</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                这里收拢模型来源、运行模式、API 路由和运行校验。目标不是“堆字段”，而是让后续扩展更多运行策略时仍然清晰。
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="grid min-w-[260px] grid-cols-2 gap-3 rounded-[22px] border border-white/10 bg-slate-950/30 p-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">同步来源</p>
                <p className="mt-1 text-sm font-semibold text-white">{sourceLabel}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">最后同步</p>
                <p className="mt-1 text-sm font-semibold text-cyan-100">{syncTimeLabel}</p>
              </div>
            </div>
            <button
              onClick={onReload}
              disabled={isRuntimeLoading}
              className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08] disabled:opacity-60"
            >
              {isRuntimeLoading ? '加载中...' : '重新加载'}
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-6 p-6">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className={cardClassName}>
            <div className="mb-4">
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Routing</p>
              <h3 className="mt-1 text-base font-semibold text-white">模型绑定与参数</h3>
            </div>

            <div className="space-y-5">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className={labelClassName}>模型中心已注册模型</label>
                  <button
                    type="button"
                    onClick={onJumpToModelNexus}
                    className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-semibold text-slate-200 transition hover:bg-white/[0.08]"
                  >
                    跳转模型中心
                  </button>
                </div>
                <select
                  value={selectedRegisteredModelId}
                  onChange={(event) => onRegisteredModelChange(event.target.value)}
                  className={inputClassName}
                >
                  <option value="">手动输入（不绑定模型中心）</option>
                  {registeredRuntimeModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name} · {model.provider}{model.isRuntimeDefault ? '（当前默认）' : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs leading-5 text-slate-400">
                  选择后会自动回填运行模型参数，并在保存时与模型中心默认模型双向同步。
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className={labelClassName}>运行模式</label>
                  <select
                    value={runtimeProvider}
                    onChange={(event) => onProviderChange(event.target.value as 'scripted' | 'openai-compatible')}
                    className={inputClassName}
                  >
                    <option value="scripted">Scripted (本地脚本)</option>
                    <option value="openai-compatible">OpenAI Compatible</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className={labelClassName}>模型名称</label>
                  <input
                    type="text"
                    value={runtimeModelName}
                    onChange={(event) => onModelNameChange(event.target.value)}
                    placeholder="例如: gpt-4.1"
                    className={inputClassName}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className={labelClassName}>API Base URL</label>
                <input
                  type="text"
                  value={runtimeApiBaseUrl}
                  onChange={(event) => onApiBaseUrlChange(event.target.value)}
                  placeholder="https://api.openai.com/v1"
                  className={inputClassName}
                />
              </div>

              <div className="space-y-2">
                <label className={labelClassName}>API Key</label>
                <input
                  type={apiProtection ? 'password' : 'text'}
                  value={runtimeApiKey}
                  onChange={(event) => onApiKeyChange(event.target.value)}
                  placeholder={runtimeApiKeyConfigured ? `已配置 (${runtimeApiKeyPreview || '******'})` : '输入新的 API Key'}
                  className={inputClassName}
                />
                <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-slate-400">
                    {runtimeApiKeyConfigured ? `已配置密钥: ${runtimeApiKeyPreview || '******'}` : '当前未配置 API Key'}
                  </p>
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={clearRuntimeApiKey}
                      onChange={(event) => onClearApiKeyChange(event.target.checked)}
                      className="accent-cyan-300"
                    />
                    清除现有密钥
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className={cardClassName}>
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Status</p>
              <h3 className="mt-1 text-base font-semibold text-white">运行时同步状态</h3>
              <div className="mt-4 space-y-3 text-sm">
                <div className="rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">同步来源</p>
                  <p className="mt-1 font-semibold text-white">{sourceLabel}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">最后同步</p>
                  <p className="mt-1 font-semibold text-cyan-100">{syncTimeLabel}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">注册模型数</p>
                  <p className="mt-1 font-semibold text-white">{registeredRuntimeModels.length}</p>
                </div>
              </div>
            </div>

            <div className={cardClassName}>
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Validation</p>
              <h3 className="mt-1 text-base font-semibold text-white">运行校验与提示</h3>
              <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/30 p-4">
                <p className="text-sm leading-6 text-slate-300">{runtimeValidationHint || '尚未进行运行配置校验'}</p>
              </div>
              <button
                onClick={onValidate}
                disabled={isRuntimeValidating || isRuntimeLoading}
                className="mt-4 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08] disabled:opacity-60"
              >
                {isRuntimeValidating ? '校验中...' : '运行校验'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
