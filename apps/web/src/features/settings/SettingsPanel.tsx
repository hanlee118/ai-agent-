import { useState } from 'react';
import { BrainCircuit, Database, Languages, ShieldCheck } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useSettings } from './useSettings';
import RuntimeConfigPanel from '../runtime-config/RuntimeConfigPanel';
import { useRuntimeConfig } from '../runtime-config/useRuntimeConfig';
import ProductContextPanel from './ProductContextPanel';

type SettingsPanelProps = {
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onRuntimeUpdated?: () => Promise<void> | void;
};

export default function SettingsPanel({ addToast, onRuntimeUpdated }: SettingsPanelProps) {
  const [isSaving, setIsSaving] = useState(false);
  const settings = useSettings();
  const runtime = useRuntimeConfig();

  const handleSave = async () => {
    setIsSaving(true);
    try {
      settings.saveToStorage();
      await runtime.saveRuntimeConfig();
      if (onRuntimeUpdated) {
        await onRuntimeUpdated();
      }
      addToast('设置已保存', 'success');
    } catch (error) {
      addToast(`保存失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    settings.resetToDefaults();
    runtime.resetRuntimeConfig();
    addToast('设置已重置', 'info');
  };

  const handleValidateRuntime = async () => {
    try {
      const result = await runtime.validateRuntimeConfig();
      addToast(result.ok ? '运行配置校验通过' : '运行配置校验失败', result.ok ? 'success' : 'error');
      if (onRuntimeUpdated) {
        await onRuntimeUpdated();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '校验失败';
      runtime.setRuntimeValidationHint(message);
      addToast(`运行配置校验失败: ${message}`, 'error');
    }
  };

  const handleBrowseWorkspace = async () => {
    const picker = (window as unknown as { showDirectoryPicker?: () => Promise<{ name?: string }> }).showDirectoryPicker;
    if (typeof picker !== 'function') {
      addToast('当前环境不支持目录浏览，请手动输入路径', 'info');
      return;
    }

    try {
      const directory = await picker();
      const pickedName = directory?.name?.trim();
      if (pickedName) {
        const normalized = pickedName.startsWith('/') ? pickedName : `/${pickedName}`;
        settings.setWorkspacePath(normalized);
        addToast(`已选择目录: ${normalized}`, 'success');
      }
    } catch (error) {
      const name = (error as { name?: string })?.name;
      if (name === 'AbortError') {
        return;
      }
      addToast(`目录选择失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    }
  };

  const handlePasswordChange = () => {
    addToast('当前版本暂不支持在线改密，请通过初始化流程重置管理员密码。', 'info');
  };

  return (
    <div className="p-8 space-y-8 max-w-4xl mx-auto">
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">设置</h1>
          <p className="text-slate-400 mt-1">配置您的 Aegis OS 工作区和偏好设置。</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleReset}
            className="px-4 py-2 bg-white/5 border border-border-subtle rounded-lg text-sm font-medium hover:bg-white/10 transition-colors"
          >
            重置为默认值
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={isSaving}
            className="px-4 py-2 bg-primary text-surface rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isSaving ? '保存中...' : '保存更改'}
          </button>
        </div>
      </header>

      <div className="space-y-8">
        <ProductContextPanel addToast={addToast} />

        <section className="bg-surface-soft border border-border-subtle rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border-subtle bg-white/5">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <Languages size={18} className="text-accent" />
              本地化
            </h2>
          </div>
          <div className="p-6 space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-medium text-white">系统语言</p>
                <p className="text-xs text-slate-500 mt-1">选择界面的主要语言。</p>
              </div>
              <div className="flex gap-2 bg-white/5 p-1 rounded-xl border border-border-subtle">
                <button
                  onClick={() => settings.setLanguage('en')}
                  className={cn(
                    'px-4 py-1.5 text-xs font-bold rounded-lg transition-all',
                    settings.language === 'en' ? 'bg-surface-muted text-white shadow-sm border border-border-subtle' : 'text-slate-500 hover:text-slate-300',
                  )}
                >
                  English
                </button>
                <button
                  onClick={() => settings.setLanguage('zh')}
                  className={cn(
                    'px-4 py-1.5 text-xs font-bold rounded-lg transition-all',
                    settings.language === 'zh' ? 'bg-primary text-surface shadow-sm' : 'text-slate-500 hover:text-slate-300',
                  )}
                >
                  中文
                </button>
              </div>
            </div>
          </div>
        </section>

        <RuntimeConfigPanel
          apiProtection={settings.apiProtection}
          isRuntimeLoading={runtime.isRuntimeLoading}
          isRuntimeValidating={runtime.isRuntimeValidating}
          runtimeProvider={runtime.runtimeProvider}
          runtimeApiBaseUrl={runtime.runtimeApiBaseUrl}
          runtimeModelName={runtime.runtimeModelName}
          runtimeApiKey={runtime.runtimeApiKey}
          clearRuntimeApiKey={runtime.clearRuntimeApiKey}
          runtimeApiKeyPreview={runtime.runtimeApiKeyPreview}
          runtimeApiKeyConfigured={runtime.runtimeApiKeyConfigured}
          runtimeValidationHint={runtime.runtimeValidationHint}
          onProviderChange={runtime.setRuntimeProvider}
          onApiBaseUrlChange={runtime.setRuntimeApiBaseUrl}
          onModelNameChange={runtime.setRuntimeModelName}
          onApiKeyChange={runtime.setRuntimeApiKey}
          onClearApiKeyChange={runtime.setClearRuntimeApiKey}
          onReload={() => void runtime.loadRuntimeConfig()}
          onValidate={() => void handleValidateRuntime()}
        />

        <section className="bg-surface-soft border border-border-subtle rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border-subtle bg-white/5">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <Database size={18} className="text-primary" />
              工作区配置
            </h2>
          </div>
          <div className="p-6 space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">OpenClaw 根路径</label>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={settings.workspacePath}
                  onChange={(e) => settings.setWorkspacePath(e.target.value)}
                  className="flex-1 bg-surface-muted border border-border-subtle rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <button
                  onClick={() => void handleBrowseWorkspace()}
                  className="px-4 py-2 bg-white/5 border border-border-subtle rounded-xl text-xs font-bold text-slate-300 hover:bg-white/10 transition-colors"
                >
                  浏览
                </button>
              </div>
            </div>
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-medium text-white">自动同步工作区</p>
                <p className="text-xs text-slate-500 mt-1">自动同步来自本地文件系统的更改。</p>
              </div>
              <div
                onClick={() => settings.setAutoSync(!settings.autoSync)}
                className={cn('w-12 h-6 rounded-full relative cursor-pointer transition-colors', settings.autoSync ? 'bg-primary' : 'bg-white/10')}
              >
                <div className={cn('absolute top-1 w-4 h-4 bg-surface rounded-full shadow-sm transition-all', settings.autoSync ? 'right-1' : 'left-1')} />
              </div>
            </div>
          </div>
        </section>

        <section className="bg-surface-soft border border-border-subtle rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border-subtle bg-white/5">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <ShieldCheck size={18} className="text-danger" />
              安全与访问
            </h2>
          </div>
          <div className="p-6 space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-medium text-white">管理员密码</p>
                <p className="text-xs text-slate-500 mt-1">在线改密将在后续版本支持。</p>
              </div>
              <button
                onClick={handlePasswordChange}
                className="px-4 py-2 bg-white/5 border border-border-subtle rounded-lg text-xs font-bold text-slate-300 hover:bg-white/10 transition-colors"
              >
                更改密码
              </button>
            </div>
            <div className="h-px bg-border-subtle" />
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-medium text-white">API 密钥保护</p>
                <p className="text-xs text-slate-500 mt-1">在系统运行页面中隐藏敏感密钥。</p>
              </div>
              <div
                onClick={() => settings.setApiProtection(!settings.apiProtection)}
                className={cn('w-12 h-6 rounded-full relative cursor-pointer transition-colors', settings.apiProtection ? 'bg-primary' : 'bg-white/10')}
              >
                <div className={cn('absolute top-1 w-4 h-4 bg-surface rounded-full shadow-sm transition-all', settings.apiProtection ? 'right-1' : 'left-1')} />
              </div>
            </div>
          </div>
        </section>

        <section className="bg-surface-soft border border-border-subtle rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border-subtle bg-white/5">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <BrainCircuit size={18} className="text-warning" />
              Agent 治理
            </h2>
          </div>
          <div className="p-6 space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-medium text-white">自主模式</p>
                <p className="text-xs text-slate-500 mt-1">允许 Agent 在没有明确确认的情况下执行任务。</p>
              </div>
              <div
                onClick={() => settings.setAutonomousMode(!settings.autonomousMode)}
                className={cn('w-12 h-6 rounded-full relative cursor-pointer transition-colors', settings.autonomousMode ? 'bg-primary' : 'bg-white/10')}
              >
                <div className={cn('absolute top-1 w-4 h-4 bg-surface rounded-full shadow-sm transition-all', settings.autonomousMode ? 'right-1' : 'left-1')} />
              </div>
            </div>
            <div className="h-px bg-border-subtle" />
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-medium text-white">Token 使用警报</p>
                <p className="text-xs text-slate-500 mt-1">当 Agent 超过其每日配额的 80% 时通知。</p>
              </div>
              <div
                onClick={() => settings.setUsageAlert(!settings.usageAlert)}
                className={cn('w-12 h-6 rounded-full relative cursor-pointer transition-colors', settings.usageAlert ? 'bg-primary' : 'bg-white/10')}
              >
                <div className={cn('absolute top-1 w-4 h-4 bg-surface rounded-full shadow-sm transition-all', settings.usageAlert ? 'right-1' : 'left-1')} />
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
