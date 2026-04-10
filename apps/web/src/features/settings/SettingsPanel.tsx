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
import { systemApi } from '../../lib/api';
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

type SettingScope = 'local' | 'platform';

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
  scope?: SettingScope;
  divider?: boolean;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-6', props.divider && 'border-t border-white/10 pt-5')}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-white">{props.title}</p>
          {props.scope ? (
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]',
                props.scope === 'platform'
                  ? 'border-cyan-300/35 bg-cyan-400/10 text-cyan-100'
                  : 'border-amber-300/35 bg-amber-400/10 text-amber-100',
              )}
            >
              {props.scope === 'platform' ? '平台生效' : '本地偏好'}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-400">{props.description}</p>
      </div>
      <div className="shrink-0">{props.control}</div>
    </div>
  );
}

export default function SettingsPanel({ addToast, onRuntimeUpdated }: SettingsPanelProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [isApplyingAutonomousMode, setIsApplyingAutonomousMode] = useState(false);
  const [autonomousApplyScope, setAutonomousApplyScope] = useState<'all' | 'core' | 'design'>('all');
  const settings = useSettings();
  const runtime = useRuntimeConfig();
  const executionProtocol = useExecutionProtocol();

  const toErrorMessage = (reason: unknown) => (reason instanceof Error ? reason.message : '未知错误');

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const [settingsResult, runtimeResult, protocolResult] = await Promise.allSettled([
        settings.saveSettings(),
        runtime.saveRuntimeConfig(),
        executionProtocol.saveExecutionProtocol(),
      ]);

      const hardFailures: string[] = [];
      const softNotices: string[] = [];

      if (settingsResult.status === 'rejected') {
        hardFailures.push(`界面偏好保存失败: ${toErrorMessage(settingsResult.reason)}`);
      } else if (!settingsResult.value.serverSaved) {
        if (settingsResult.value.localSaved) {
          softNotices.push(`界面偏好已保存到本地浏览器（服务端未同步: ${settingsResult.value.serverError || '未知错误'}）`);
        } else {
          hardFailures.push(`界面偏好保存失败: ${settingsResult.value.serverError || '本地与服务端均不可用'}`);
        }
      } else if (!settingsResult.value.localSaved) {
        softNotices.push('界面偏好已同步到服务端，但本地缓存写入失败');
      }

      if (runtimeResult.status === 'rejected') {
        hardFailures.push(`运行模型配置保存失败: ${toErrorMessage(runtimeResult.reason)}`);
      }
      if (protocolResult.status === 'rejected') {
        hardFailures.push(`执行协议保存失败: ${toErrorMessage(protocolResult.reason)}`);
      }

      if ((runtimeResult.status === 'fulfilled' || protocolResult.status === 'fulfilled') && onRuntimeUpdated) {
        try {
          await onRuntimeUpdated();
        } catch (error) {
          softNotices.push(`运行状态刷新失败: ${toErrorMessage(error)}`);
        }
      }

      if (hardFailures.length > 0) {
        const message = [...hardFailures, ...softNotices].join('；');
        addToast(`保存未完成: ${message}`, 'error');
        return;
      }

      if (softNotices.length > 0) {
        addToast(`保存完成（部分降级）: ${softNotices.join('；')}`, 'info');
        return;
      }

      addToast('设置已全部保存并生效', 'success');
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
    addToast('已恢复默认值，请点击“保存全部更改”后生效', 'info');
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
        // 浏览器 Directory Picker 不会返回绝对路径，避免把目录名误写成伪绝对路径。
        addToast(`已选择目录“${pickedName}”，请手动补全绝对路径后保存`, 'info');
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

  const handleApplyAutonomousMode = async () => {
    setIsApplyingAutonomousMode(true);
    try {
      const result = await systemApi.applyUiAutonomousMode(settings.autonomousMode, autonomousApplyScope);
      const modeLabel = result.executionMode === 'autonomous' ? '自主执行' : '确认优先';
      const scopeLabel = result.scope === 'core' ? '核心 Agent' : result.scope === 'design' ? '设计 Agent' : '全部 Agent';
      addToast(
        `已下发到${scopeLabel}：${modeLabel}（更新 ${result.updatedAgents}/${result.totalAgents}，补齐配置 ${result.createdConfigs}）`,
        'success',
      );
    } catch (error) {
      addToast(`下发失败: ${toErrorMessage(error)}`, 'error');
    } finally {
      setIsApplyingAutonomousMode(false);
    }
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
        label: '偏好同步',
        value:
          settings.settingsSource === 'server'
            ? '服务端已同步'
            : settings.settingsSource === 'local'
              ? '仅浏览器本地'
              : '默认值',
        tone: 'text-sky-100',
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
      settings.settingsSource,
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
                当前页改动分为三段：界面偏好、运行时配置、执行协议。保存会并行提交，并明确提示哪一段成功或失败。
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-400">
                界面偏好同步来源: {settings.settingsSource === 'server' ? '服务端文件' : settings.settingsSource === 'local' ? '浏览器本地' : '系统默认'}
                {settings.settingsUpdatedAt ? ` · 最近同步 ${new Date(settings.settingsUpdatedAt).toLocaleString('zh-CN')}` : ''}
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
            description="这一分区是界面偏好层，当前版本会同步到设置服务，但不会直接修改业务数据。"
          >
            <SettingRow
              title="系统语言"
              description="控制界面语言偏好与时间格式标记。当前版本只覆盖基础语言偏好。"
              scope="local"
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
            description="这里管理前端侧的工作区偏好与同步开关，用于默认输入和本地工作习惯。"
          >
            <div className="space-y-5">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">OpenClaw 根路径</label>
                  <span className="rounded-full border border-amber-300/35 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-100">
                    本地偏好
                  </span>
                </div>
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
                  该值用于前端默认路径提示，不会覆盖服务端实际工作区根目录。
                </p>
              </div>

              <SettingRow
                title="自动同步工作区"
                description="控制前端工作区视图的自动刷新策略，关闭后适合关键节点手动刷新。"
                scope="local"
                control={<ToggleControl checked={settings.autoSync} onToggle={() => settings.setAutoSync(!settings.autoSync)} />}
                divider
              />
            </div>
          </NativeSection>

          <NativeSection
            id="settings-security"
            icon={ShieldCheck}
            title="安全与访问"
            description="当前分区负责访问安全入口和前端脱敏偏好。管理员密码仍由初始化流程控制。"
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
                description="控制前端显示时是否默认遮罩密钥，不会改变后端密钥存储方式。"
                scope="local"
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
            description="该分区记录治理偏好，并支持将“自主模式”一键下发到全部 Agent 的执行策略。"
          >
            <div className="space-y-5">
              <SettingRow
                title="自主模式"
                description="记录默认治理倾向。可点击下方按钮同步到全部 Agent 的执行模式。"
                scope="platform"
                control={
                  <ToggleControl
                    checked={settings.autonomousMode}
                    onToggle={() => settings.setAutonomousMode(!settings.autonomousMode)}
                  />
                }
              />

              <SettingRow
                title="Token 使用警报"
                description="开启后会在通知中心按阈值监控 Agent 日 Token 预算。"
                scope="platform"
                control={
                  <ToggleControl
                    checked={settings.usageAlert}
                    onToggle={() => settings.setUsageAlert(!settings.usageAlert)}
                  />
                }
                divider
              />

              <SettingRow
                title="Token 告警阈值"
                description="达到该百分比后触发预算预警，100% 以上将升级为严重告警。"
                scope="platform"
                control={
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={50}
                      max={95}
                      step={5}
                      value={settings.usageAlertThresholdPercent}
                      onChange={(event) => settings.setUsageAlertThresholdPercent(Number(event.target.value))}
                      className="w-20 rounded-xl border border-white/10 bg-slate-950/55 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-400/40"
                    />
                    <span className="text-xs text-slate-400">%</span>
                  </div>
                }
                divider
              />

              <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
                <p className="text-xs leading-5 text-slate-400">
                  将当前“自主模式”偏好下发到选定范围的 Agent：
                  {settings.autonomousMode ? '切换为自主执行（免确认）' : '切换为确认优先（高风险动作需确认）'}。
                </p>
                <div className="mt-3">
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    下发范围
                  </label>
                  <select
                    value={autonomousApplyScope}
                    onChange={(event) => setAutonomousApplyScope(event.target.value as 'all' | 'core' | 'design')}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/55 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-400/40"
                  >
                    <option value="all">全部 Agent</option>
                    <option value="core">核心 Agent（main）</option>
                    <option value="design">设计 Agent（按角色识别）</option>
                  </select>
                </div>
                <button
                  type="button"
                  disabled={isApplyingAutonomousMode}
                  onClick={() => void handleApplyAutonomousMode()}
                  className="mt-3 w-full rounded-2xl border border-cyan-300/30 bg-cyan-400/10 px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20 disabled:opacity-60"
                >
                  {isApplyingAutonomousMode ? '下发中...' : '同步自主模式到全部 Agent'}
                </button>
              </div>
            </div>
          </NativeSection>
        </main>
      </div>
    </div>
  );
}
