import { useMemo, useState, type ReactNode } from 'react';
import {
  BookText,
  BrainCircuit,
  Cpu,
  Database,
  Languages,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useSettings } from './useSettings';
import RuntimeConfigPanel from '../runtime-config/RuntimeConfigPanel';
import { useRuntimeConfig } from '../runtime-config/useRuntimeConfig';
import ProductContextPanel from './ProductContextPanel';
import ExecutionProtocolPanel from './ExecutionProtocolPanel';
import { useExecutionProtocol } from './useExecutionProtocol';

type SettingsPanelProps = {
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onRuntimeUpdated?: () => Promise<void> | void;
};

type NativeSectionProps = {
  id: string;
  icon: typeof Languages;
  title: string;
  description: string;
  children: ReactNode;
};

function ToggleControl(props: { checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onToggle}
      className={cn(
        'relative h-7 w-14 rounded-full border transition-colors',
        props.checked ? 'border-cyan-300/40 bg-cyan-400' : 'border-white/10 bg-white/10',
      )}
    >
      <span
        className={cn(
          'absolute top-1 h-5 w-5 rounded-full bg-slate-950 shadow-[0_6px_18px_rgba(15,23,42,0.35)] transition-all',
          props.checked ? 'left-8' : 'left-1',
        )}
      />
    </button>
  );
}

function NativeSection({ id, icon: Icon, title, description, children }: NativeSectionProps) {
  return (
    <section
      id={id}
      className="overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(15,23,42,0.88))] shadow-[0_20px_60px_rgba(2,6,23,0.28)]"
    >
      <div className="border-b border-white/10 bg-white/[0.04] px-6 py-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-2xl border border-white/10 bg-white/[0.06] p-2 text-slate-100">
            <Icon size={18} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-slate-400">{description}</p>
          </div>
        </div>
      </div>
      <div className="p-6">{children}</div>
    </section>
  );
}

function SettingRow(props: {
  title: string;
  description: string;
  control: ReactNode;
  divider?: boolean;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-6', props.divider && 'border-t border-white/10 pt-5')}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-white">{props.title}</p>
        <p className="mt-1 text-xs leading-5 text-slate-400">{props.description}</p>
      </div>
      <div className="shrink-0">{props.control}</div>
    </div>
  );
}

export default function SettingsPanel({ addToast, onRuntimeUpdated }: SettingsPanelProps) {
  const [isSaving, setIsSaving] = useState(false);
  const settings = useSettings();
  const runtime = useRuntimeConfig();
  const executionProtocol = useExecutionProtocol();

  const handleSave = async () => {
    setIsSaving(true);
    try {
      settings.saveToStorage();
      await runtime.saveRuntimeConfig();
      await executionProtocol.saveExecutionProtocol();
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
    executionProtocol.resetExecutionProtocol();
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

  const handleJumpToModelNexus = () => {
    if (typeof window === 'undefined') {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('app_tab', 'model-nexus');
    const nextPath = `${url.pathname}${url.search}${url.hash}`;
    window.history.pushState(window.history.state, '', nextPath);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const textClassName =
    'w-full rounded-2xl border border-white/10 bg-slate-950/55 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-400/40';

  const sectionNav = useMemo(
    () => [
      {
        id: 'settings-context',
        label: '产品上下文',
        description: '长期记忆与需求边界',
        icon: BookText,
      },
      {
        id: 'settings-protocol',
        label: '执行协议',
        description: '阶段门禁与治理基线',
        icon: Workflow,
      },
      {
        id: 'settings-runtime',
        label: '运行模型',
        description: '模型与运行时校验',
        icon: Cpu,
      },
      {
        id: 'settings-localization',
        label: '本地化',
        description: '语言与界面偏好',
        icon: Languages,
      },
      {
        id: 'settings-workspace',
        label: '工作区',
        description: '本地目录与同步方式',
        icon: Database,
      },
      {
        id: 'settings-security',
        label: '安全访问',
        description: '密钥保护与密码策略',
        icon: LockKeyhole,
      },
      {
        id: 'settings-agent-governance',
        label: 'Agent 治理',
        description: '自治与告警阈值',
        icon: BrainCircuit,
      },
    ],
    [],
  );

  const summaryCards = useMemo(
    () => [
      {
        label: '运行模式',
        value: runtime.runtimeProvider === 'openai-compatible' ? 'OpenAI Compatible' : 'Scripted',
        tone: 'text-cyan-100',
      },
      {
        label: '语言',
        value: settings.language === 'zh' ? '中文界面' : 'English UI',
        tone: 'text-emerald-100',
      },
      {
        label: '执行协议',
        value: executionProtocol.executionProtocolSource === 'database' ? '数据库治理' : '系统默认',
        tone: 'text-amber-100',
      },
      {
        label: '工作区同步',
        value: settings.autoSync ? '已开启' : '手动同步',
        tone: 'text-fuchsia-100',
      },
    ],
    [
      executionProtocol.executionProtocolSource,
      runtime.runtimeProvider,
      settings.autoSync,
      settings.language,
    ],
  );

  return (
    <div className="mx-auto max-w-[1480px] px-6 py-8 text-slate-100 xl:px-10">
      <section className="overflow-hidden rounded-[36px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.22),transparent_32%),radial-gradient(circle_at_top_right,rgba(251,191,36,0.14),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.06),rgba(15,23,42,0.92))] shadow-[0_30px_100px_rgba(2,6,23,0.34)]">
        <div className="grid gap-8 px-8 py-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:px-10">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100">
              <Sparkles size={13} />
              Control Surface
            </div>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-white">设置中心</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
              把产品上下文、执行协议、运行模型和工作区治理收敛到同一张控制台里。现在的布局更偏向“配置系统”
              而不是“堆叠表单”，这样后续继续扩项时不会越长越乱。
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {summaryCards.map((item) => (
                <div key={item.label} className="rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
                  <p className={cn('mt-2 text-sm font-semibold', item.tone)}>{item.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col justify-between gap-6 rounded-[28px] border border-white/10 bg-slate-950/35 p-5">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Save Rail</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                当前页的改动涉及本地设置、运行时配置和执行协议。保存时会统一写回，减少局部配置不同步。
              </p>
            </div>
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={isSaving}
                className="w-full rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-200 disabled:opacity-50"
              >
                {isSaving ? '保存中...' : '保存全部更改'}
              </button>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleReset}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08]"
                >
                  重置默认值
                </button>
                <button
                  type="button"
                  onClick={() => void handleValidateRuntime()}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/[0.08]"
                >
                  校验运行时
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="mt-8 grid gap-8 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="xl:sticky xl:top-6 xl:self-start">
          <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(15,23,42,0.92))] p-4 shadow-[0_20px_60px_rgba(2,6,23,0.24)]">
            <p className="px-2 text-[11px] uppercase tracking-[0.22em] text-slate-500">Navigation</p>
            <div className="mt-3 space-y-2">
              {sectionNav.map((item) => {
                const Icon = item.icon;
                return (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    className="group flex items-start gap-3 rounded-2xl border border-transparent bg-white/[0.03] px-3 py-3 transition hover:border-white/10 hover:bg-white/[0.06]"
                  >
                    <div className="mt-0.5 rounded-xl border border-white/10 bg-white/[0.04] p-2 text-slate-200 group-hover:text-white">
                      <Icon size={15} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{item.label}</p>
                      <p className="mt-1 text-[11px] leading-5 text-slate-400">{item.description}</p>
                    </div>
                  </a>
                );
              })}
            </div>
          </div>
        </aside>

        <main className="space-y-8">
          <div id="settings-context">
            <ProductContextPanel addToast={addToast} />
          </div>

          <div id="settings-protocol">
            <ExecutionProtocolPanel
              isLoading={executionProtocol.isExecutionProtocolLoading}
              source={executionProtocol.executionProtocolSource}
              updatedAt={executionProtocol.executionProtocolUpdatedAt}
              locks={executionProtocol.executionProtocolLocks}
              stageMatrix={executionProtocol.executionProtocolStageMatrix}
              requireSkillEvidence={executionProtocol.requireSkillEvidence}
              requireCollaborationHandoff={executionProtocol.requireCollaborationHandoff}
              blockDegradedWrites={executionProtocol.blockDegradedWrites}
              onRequireSkillEvidenceChange={executionProtocol.setRequireSkillEvidence}
              onRequireCollaborationHandoffChange={executionProtocol.setRequireCollaborationHandoff}
              onBlockDegradedWritesChange={executionProtocol.setBlockDegradedWrites}
              onReload={() => void executionProtocol.loadExecutionProtocol()}
            />
          </div>

          <div id="settings-runtime">
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
              runtimeConfigUpdatedAt={runtime.runtimeConfigUpdatedAt}
              runtimeConfigSource={runtime.runtimeConfigSource}
              registeredRuntimeModels={runtime.registeredRuntimeModels}
              selectedRegisteredModelId={runtime.selectedRegisteredModelId}
              onProviderChange={runtime.setRuntimeProvider}
              onApiBaseUrlChange={runtime.setRuntimeApiBaseUrl}
              onModelNameChange={runtime.setRuntimeModelName}
              onRegisteredModelChange={runtime.setSelectedRegisteredModelId}
              onJumpToModelNexus={handleJumpToModelNexus}
              onApiKeyChange={runtime.setRuntimeApiKey}
              onClearApiKeyChange={runtime.setClearRuntimeApiKey}
              onReload={() => void runtime.loadRuntimeConfig()}
              onValidate={() => void handleValidateRuntime()}
            />
          </div>

          <NativeSection
            id="settings-localization"
            icon={Languages}
            title="本地化与界面偏好"
            description="把当前语言和基础界面偏好集中到同一块，避免这类全局设置散落在多个区域。"
          >
            <SettingRow
              title="系统语言"
              description="选择设置页和工作台的主要展示语言。"
              control={
                <div className="flex gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-1">
                  <button
                    type="button"
                    onClick={() => settings.setLanguage('en')}
                    className={cn(
                      'rounded-xl px-4 py-2 text-xs font-semibold transition-all',
                      settings.language === 'en'
                        ? 'bg-white text-slate-950'
                        : 'text-slate-400 hover:text-slate-100',
                    )}
                  >
                    English
                  </button>
                  <button
                    type="button"
                    onClick={() => settings.setLanguage('zh')}
                    className={cn(
                      'rounded-xl px-4 py-2 text-xs font-semibold transition-all',
                      settings.language === 'zh'
                        ? 'bg-cyan-300 text-slate-950'
                        : 'text-slate-400 hover:text-slate-100',
                    )}
                  >
                    中文
                  </button>
                </div>
              }
            />
          </NativeSection>

          <NativeSection
            id="settings-workspace"
            icon={Database}
            title="工作区配置"
            description="这里负责本地 OpenClaw 根路径与同步方式，后续如果增加更多本地目录治理项，也能继续扩在这个分区。"
          >
            <div className="space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">OpenClaw 根路径</label>
                <div className="flex flex-col gap-3 md:flex-row">
                  <input
                    type="text"
                    value={settings.workspacePath}
                    onChange={(e) => settings.setWorkspacePath(e.target.value)}
                    className={cn(textClassName, 'flex-1')}
                    placeholder="/Users/you/.openclaw"
                  />
                  <button
                    type="button"
                    onClick={() => void handleBrowseWorkspace()}
                    className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/[0.08]"
                  >
                    浏览目录
                  </button>
                </div>
                <p className="text-xs leading-5 text-slate-400">
                  推荐填写真实工作区根路径，后续执行链、工作区读取与本地同步都会以这里为准。
                </p>
              </div>

              <SettingRow
                title="自动同步工作区"
                description="自动同步来自本地文件系统的更改。关闭后，适合只在关键节点手动刷新。"
                control={<ToggleControl checked={settings.autoSync} onToggle={() => settings.setAutoSync(!settings.autoSync)} />}
                divider
              />
            </div>
          </NativeSection>

          <NativeSection
            id="settings-security"
            icon={ShieldCheck}
            title="安全与访问"
            description="把密码、密钥展示和基础访问保护放在同一层，后续扩展审计、RBAC 或脱敏规则时不会打散。"
          >
            <div className="space-y-5">
              <SettingRow
                title="管理员密码"
                description="当前版本暂不支持在线改密，后续会收敛到独立的管理员访问策略流程。"
                control={
                  <button
                    type="button"
                    onClick={handlePasswordChange}
                    className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/[0.08]"
                  >
                    更改密码
                  </button>
                }
              />

              <SettingRow
                title="API 密钥保护"
                description="在系统运行页和配置页中默认隐藏敏感密钥内容，适合演示与协作场景。"
                control={
                  <ToggleControl
                    checked={settings.apiProtection}
                    onToggle={() => settings.setApiProtection(!settings.apiProtection)}
                  />
                }
                divider
              />
            </div>
          </NativeSection>

          <NativeSection
            id="settings-agent-governance"
            icon={BrainCircuit}
            title="Agent 治理"
            description="自治能力和资源告警是后续扩展的重要入口，这里先整理成明确的治理区块。"
          >
            <div className="space-y-5">
              <SettingRow
                title="自主模式"
                description="允许 Agent 在没有明确人工确认的情况下执行任务。建议只在高确定性链路中开启。"
                control={
                  <ToggleControl
                    checked={settings.autonomousMode}
                    onToggle={() => settings.setAutonomousMode(!settings.autonomousMode)}
                  />
                }
              />

              <SettingRow
                title="Token 使用警报"
                description="当 Agent 超过每日配额阈值时给出提示，便于及早发现成本或异常使用。"
                control={
                  <ToggleControl
                    checked={settings.usageAlert}
                    onToggle={() => settings.setUsageAlert(!settings.usageAlert)}
                  />
                }
                divider
              />
            </div>
          </NativeSection>
        </main>
      </div>
    </div>
  );
}
