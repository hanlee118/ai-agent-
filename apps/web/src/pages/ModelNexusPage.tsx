import { useMemo, useState } from 'react';
import { Info, Plus, RotateCcw, Terminal, Zap } from 'lucide-react';
import { cn } from '../lib/utils';
import { models } from '../lib/runtimeCollections';
import { modelsApi, systemApi } from '../lib/api';
import { Badge, Cpu, Dialog, ModelTerminal } from './impl/GovernanceShared';

type Props = {
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onOpenNewModel: () => void;
  onRefreshData?: () => Promise<void> | void;
};

const TOKEN_SOURCE_LABEL: Record<string, string> = {
  usage_logs: '来源: 使用日志',
  model_counter: '来源: 模型计数器',
  runtime_inferred: '来源: 运行态推断',
  unknown: '来源: 未采集',
};

const QUALITY_LABEL: Record<string, string> = {
  measured: '实测',
  estimated: '估算',
  unknown: '未知',
};

function normalizeMetricValue(value: string | undefined) {
  const text = String(value || '').trim();
  if (!text || text.toLowerCase() === 'n/a' || text.toLowerCase() === 'unknown') {
    return '未采集';
  }
  return text;
}

export default function ModelNexusPage({ addToast, onOpenNewModel, onRefreshData }: Props) {
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncingCatalog, setIsSyncingCatalog] = useState(false);
  const [isRepairingRuntime, setIsRepairingRuntime] = useState(false);

  const stats = useMemo(() => ({
    totalTokens: models.reduce((acc, model) => acc + (model.totalTokens || 0), 0),
    totalCost: models.reduce((acc, model) => acc + (model.totalTokens || 0) * 0.000002, 0),
    activeModels: models.filter((model) => model.status === 'Healthy').length,
  }), [models]);

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId),
    [selectedModelId, models],
  );
  const canPromoteSelectedModel = Boolean(selectedModel && !String(selectedModel.id || '').startsWith('runtime-'));

  const handleSyncCatalog = async () => {
    setIsSyncingCatalog(true);
    addToast('正在从模型服务同步可用模型列表...', 'info');
    try {
      const result = await modelsApi.discover();
      addToast(`模型目录同步完成：发现 ${result.discovered} 个，写入/更新 ${result.synced} 个`, 'success');
      if (onRefreshData) {
        await onRefreshData();
      }
    } catch (error) {
      addToast(`同步失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsSyncingCatalog(false);
    }
  };

  const handleSetDefaultAndValidate = async (modelId: string) => {
    setIsRepairingRuntime(true);
    addToast('正在设置运行默认模型并执行通道校验...', 'info');
    try {
      await modelsApi.setDefault(modelId);
      const validation = await systemApi.validateRuntime();
      addToast(validation.message || '运行时校验完成', validation.ok ? 'success' : 'error');
      if (onRefreshData) {
        await onRefreshData();
      }
    } catch (error) {
      addToast(`修复失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setIsRepairingRuntime(false);
    }
  };

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-bold text-white tracking-tight">模型资源中心</h1>
          <p className="text-slate-400 mt-2 flex items-center gap-2">
            Model Nexus: 观测多模型计算资源分配与消耗（按实测/估算来源标注）
            <span className="group relative inline-block">
              <Info size={14} className="text-slate-500 cursor-help hover:text-primary transition-colors" />
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-surface-muted border border-border-subtle rounded-xl text-[10px] text-slate-300 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 shadow-2xl leading-relaxed">
                <span className="font-bold text-white mb-1 uppercase tracking-widest block">实时吞吐量 (Throughput)</span>
                表示模型每秒处理的 Token 数量，是衡量响应速度和并发能力的关键指标。
              </span>
            </span>
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={async () => {
              if (!onRefreshData) {
                addToast('当前页面未配置刷新能力', 'error');
                return;
              }
              setIsRefreshing(true);
              addToast('正在刷新模型状态...', 'info');
              try {
                await onRefreshData();
                addToast('模型状态已刷新', 'success');
              } catch (error) {
                addToast(`刷新失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
              } finally {
                setIsRefreshing(false);
              }
            }}
            disabled={isRefreshing}
            className="p-2 bg-white/5 border border-border-subtle rounded-xl text-slate-400 hover:text-white transition-colors"
          >
            <RotateCcw size={20} className={cn(isRefreshing && 'animate-spin')} />
          </button>
          <button
            onClick={() => void handleSyncCatalog()}
            disabled={isSyncingCatalog}
            className="px-4 py-2 bg-white/5 border border-border-subtle rounded-xl text-sm font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-60"
          >
            {isSyncingCatalog ? '同步中...' : '同步模型目录'}
          </button>
          <button onClick={onOpenNewModel} className="px-4 py-2 bg-primary text-surface font-bold rounded-xl shadow-lg shadow-primary/20 flex items-center gap-2">
            <Plus size={18} />
            接入新模型
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-surface-soft border border-border-subtle p-8 rounded-3xl flex flex-col justify-center space-y-2 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10"><Cpu size={80} /></div>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">TOTAL TOKENS (ALL MODELS)</p>
          <h2 className="text-5xl font-mono font-bold text-white tracking-tighter">{stats.totalTokens.toLocaleString()}</h2>
        </div>
        <div className="bg-surface-soft border border-border-subtle p-8 rounded-3xl flex flex-col justify-center space-y-2 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10"><Zap size={80} /></div>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">ESTIMATED COST (USD)</p>
          <h2 className="text-5xl font-mono font-bold text-white tracking-tighter">${stats.totalCost.toLocaleString(undefined, { minimumFractionDigits: 4 })}</h2>
        </div>
        <div className="bg-surface-soft border border-border-subtle p-8 rounded-3xl flex flex-col justify-center space-y-2 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10"><Terminal size={80} /></div>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">HEALTHY MODELS</p>
          <h2 className="text-5xl font-mono font-bold text-white tracking-tighter">{stats.activeModels}</h2>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {models.map((model) => (
          <div key={model.id} className="bg-surface-soft border border-border-subtle rounded-3xl p-6 space-y-6 hover:border-primary/30 transition-all group cursor-pointer" onClick={() => setSelectedModelId(model.id)}>
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-3">
                <div className={cn('p-3 rounded-2xl', model.status === 'Healthy' ? 'bg-green-500/10 text-green-500' : 'bg-amber-500/10 text-amber-500')}>
                  <Cpu size={24} />
                </div>
                <div>
                  <h3 className="font-bold text-white text-lg">{model.name}</h3>
                  <p className="text-xs text-slate-500">{model.provider}</p>
                  <p className="text-[10px] text-slate-500 mt-1">
                    {TOKEN_SOURCE_LABEL[model.tokenSource || 'unknown']} · {QUALITY_LABEL[model.telemetryQuality || 'unknown']}
                  </p>
                </div>
              </div>
              <Badge variant={model.status === 'Healthy' ? 'primary' : 'default'}>{model.status === 'Healthy' ? '运行良好' : '延迟波动'}</Badge>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-end">
                <span className="text-xs text-slate-500 uppercase tracking-widest font-bold">今日消耗</span>
                <span className="text-sm font-mono text-white">{model.dailyTokens.toLocaleString()}</span>
              </div>
              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-primary" style={{ width: `${Math.min(100, (model.dailyTokens / 200000) * 100)}%` }} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-4 bg-white/5 rounded-2xl border border-border-subtle/50">
                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">累计消耗</p>
                <p className="text-lg font-mono text-white mt-1">{(model.totalTokens / 1000000).toFixed(1)}M</p>
              </div>
              <div className="p-4 bg-white/5 rounded-2xl border border-border-subtle/50">
                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">吞吐（来源标注）</p>
                <p className={cn('text-lg font-mono mt-1', normalizeMetricValue(model.throughput) === '未采集' ? 'text-slate-400' : 'text-primary')}>
                  {normalizeMetricValue(model.throughput)}
                </p>
              </div>
              <div className="p-4 bg-white/5 rounded-2xl border border-border-subtle/50">
                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">平均延迟</p>
                <p className={cn('text-lg font-mono mt-1', normalizeMetricValue(model.latency) === '未采集' ? 'text-slate-400' : 'text-white')}>
                  {normalizeMetricValue(model.latency)}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Dialog isOpen={Boolean(selectedModelId)} onClose={() => setSelectedModelId(null)} title={selectedModel ? `${selectedModel.name} 实时终端` : '模型终端'}>
        {selectedModel ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white/5 border border-border-subtle">
              <div className="text-xs text-slate-400">
                {canPromoteSelectedModel
                  ? '可将当前模型设置为运行时默认，并立即执行通道校验。'
                  : '该模型来自运行态推断，请先在模型中心注册后再设为默认。'}
              </div>
              <button
                onClick={() => void handleSetDefaultAndValidate(selectedModel.id)}
                disabled={!canPromoteSelectedModel || isRepairingRuntime}
                className="px-3 py-1.5 rounded-lg bg-primary text-surface text-xs font-bold disabled:opacity-50"
              >
                {isRepairingRuntime ? '修复中...' : '设为运行默认并校验'}
              </button>
            </div>
            <ModelTerminal model={selectedModel} />
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
