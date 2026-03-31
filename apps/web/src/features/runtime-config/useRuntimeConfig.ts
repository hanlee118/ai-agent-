import { useCallback, useEffect, useState } from 'react';
import { modelsApi, systemApi } from '../../lib/api';

export type RuntimeProvider = 'scripted' | 'openai-compatible';

const DEFAULT_PROVIDER: RuntimeProvider = 'scripted';
type RuntimeRegisteredModel = {
  id: string;
  name: string;
  provider: string;
  apiBaseUrl?: string;
  isRuntimeDefault?: boolean;
};

const normalizeProviderToRuntime = (provider: string): RuntimeProvider => {
  const normalized = String(provider || '').trim().toLowerCase();
  if (normalized === 'scripted' || normalized.includes('script')) {
    return 'scripted';
  }
  return 'openai-compatible';
};

const normalizeBaseUrl = (value: string | undefined) => String(value || '').trim().replace(/\/$/, '');

const matchRegisteredModelId = (
  config: { provider: RuntimeProvider; modelName: string; apiBaseUrl: string },
  registeredModels: RuntimeRegisteredModel[],
) => {
  const modelName = String(config.modelName || '').trim().toLowerCase();
  if (!modelName) {
    return '';
  }
  const provider = String(config.provider || '').trim().toLowerCase();
  const apiBaseUrl = normalizeBaseUrl(config.apiBaseUrl).toLowerCase();

  const exact = registeredModels.find((item) => {
    if (String(item.name || '').trim().toLowerCase() !== modelName) {
      return false;
    }
    if (normalizeProviderToRuntime(item.provider) !== provider) {
      return false;
    }
    const itemBase = normalizeBaseUrl(item.apiBaseUrl).toLowerCase();
    return !apiBaseUrl || !itemBase || itemBase === apiBaseUrl;
  });
  if (exact) {
    return exact.id;
  }
  const fallback = registeredModels.find((item) => String(item.name || '').trim().toLowerCase() === modelName);
  return fallback?.id || '';
};

export function useRuntimeConfig() {
  const [isRuntimeLoading, setIsRuntimeLoading] = useState(false);
  const [isRuntimeValidating, setIsRuntimeValidating] = useState(false);
  const [runtimeProvider, setRuntimeProvider] = useState<RuntimeProvider>(DEFAULT_PROVIDER);
  const [runtimeApiBaseUrl, setRuntimeApiBaseUrl] = useState('');
  const [runtimeModelName, setRuntimeModelName] = useState('');
  const [runtimeApiKey, setRuntimeApiKey] = useState('');
  const [clearRuntimeApiKey, setClearRuntimeApiKey] = useState(false);
  const [runtimeApiKeyPreview, setRuntimeApiKeyPreview] = useState('');
  const [runtimeApiKeyConfigured, setRuntimeApiKeyConfigured] = useState(false);
  const [runtimeValidationHint, setRuntimeValidationHint] = useState('');
  const [runtimeConfigUpdatedAt, setRuntimeConfigUpdatedAt] = useState('');
  const [runtimeConfigSource, setRuntimeConfigSource] = useState<'database' | 'environment' | 'default' | 'unknown'>('unknown');
  const [registeredRuntimeModels, setRegisteredRuntimeModels] = useState<RuntimeRegisteredModel[]>([]);
  const [selectedRegisteredModelId, setSelectedRegisteredModelId] = useState('');

  const loadRegisteredRuntimeModels = useCallback(async () => {
    const list = await modelsApi.list();
    const registered = (list || [])
      .filter((item) => item.source !== 'runtime')
      .map((item) => ({
        id: item.id,
        name: item.name,
        provider: item.provider,
        apiBaseUrl: item.apiBaseUrl,
        isRuntimeDefault: item.isRuntimeDefault,
      }));
    setRegisteredRuntimeModels(registered);
    return registered;
  }, []);

  const loadRuntimeConfig = useCallback(async () => {
    setIsRuntimeLoading(true);
    try {
      const [config, runtimeStatus] = await Promise.all([
        systemApi.getRuntimeConfig(),
        systemApi.getRuntime().catch(() => null),
      ]);
      let registered: RuntimeRegisteredModel[] = [];
      try {
        registered = await loadRegisteredRuntimeModels();
      } catch {
        registered = [];
        setRegisteredRuntimeModels([]);
      }
      setRuntimeProvider(config.provider);
      setRuntimeApiBaseUrl(config.apiBaseUrl || '');
      setRuntimeModelName(config.modelName || '');
      setRuntimeApiKey('');
      setClearRuntimeApiKey(false);
      setRuntimeApiKeyConfigured(Boolean(config.apiKeyConfigured));
      setRuntimeApiKeyPreview(config.apiKeyPreview || '');
      setRuntimeConfigUpdatedAt(config.updatedAt || '');
      setRuntimeConfigSource(
        runtimeStatus?.configSource === 'database' || runtimeStatus?.configSource === 'environment' || runtimeStatus?.configSource === 'default'
          ? runtimeStatus.configSource
          : 'unknown',
      );
      setRuntimeValidationHint(
        config.lastValidationStatus === 'failed'
          ? (config.lastValidationError || '最近一次校验失败')
          : config.lastValidationStatus === 'healthy'
          ? '最近一次校验通过'
          : '尚未进行运行配置校验',
      );
      setSelectedRegisteredModelId(matchRegisteredModelId({
        provider: config.provider,
        modelName: config.modelName || '',
        apiBaseUrl: config.apiBaseUrl || '',
      }, registered));
      return config;
    } catch (error) {
      setRuntimeValidationHint(`运行配置加载失败: ${error instanceof Error ? error.message : '未知错误'}`);
      throw error;
    } finally {
      setIsRuntimeLoading(false);
    }
  }, [loadRegisteredRuntimeModels]);

  useEffect(() => {
    void loadRuntimeConfig();
  }, [loadRuntimeConfig]);

  const saveRuntimeConfig = useCallback(async () => {
    const hasApiKeyMutation = Boolean(runtimeApiKey.trim()) || clearRuntimeApiKey;
    let runtimeResult;

    if (selectedRegisteredModelId) {
      const setDefaultResult = await modelsApi.setDefault(selectedRegisteredModelId);
      runtimeResult = await systemApi.getRuntimeConfig();
      const runtimeStatus = await systemApi.getRuntime().catch(() => null);
      setRuntimeProvider(runtimeResult.provider);
      setRuntimeApiBaseUrl(runtimeResult.apiBaseUrl || '');
      setRuntimeModelName(runtimeResult.modelName || '');
      setRuntimeApiKeyConfigured(Boolean(setDefaultResult.runtime?.apiKeyConfigured));
      setRuntimeApiKeyPreview(setDefaultResult.runtime?.apiKeyPreview || '');
      setRuntimeConfigUpdatedAt(runtimeResult.updatedAt || '');
      setRuntimeConfigSource(
        runtimeStatus?.configSource === 'database' || runtimeStatus?.configSource === 'environment' || runtimeStatus?.configSource === 'default'
          ? runtimeStatus.configSource
          : 'unknown',
      );

      if (hasApiKeyMutation) {
        runtimeResult = await systemApi.updateRuntimeConfig({
          provider: runtimeResult.provider,
          apiBaseUrl: runtimeResult.apiBaseUrl || '',
          modelName: runtimeResult.modelName || '',
          apiKey: runtimeApiKey.trim() || undefined,
          clearApiKey: clearRuntimeApiKey,
        });
      }
    } else {
      runtimeResult = await systemApi.updateRuntimeConfig({
        provider: runtimeProvider,
        apiBaseUrl: runtimeApiBaseUrl.trim(),
        modelName: runtimeModelName.trim(),
        apiKey: runtimeApiKey.trim() || undefined,
        clearApiKey: clearRuntimeApiKey,
      });
    }

    setRuntimeApiKey('');
    setClearRuntimeApiKey(false);
    setRuntimeApiKeyConfigured(Boolean(runtimeResult.apiKeyConfigured));
    setRuntimeApiKeyPreview(runtimeResult.apiKeyPreview || '');
    setRuntimeConfigUpdatedAt(runtimeResult.updatedAt || '');
    setRuntimeValidationHint(
      runtimeResult.lastValidationStatus === 'failed'
        ? (runtimeResult.lastValidationError || '最近一次校验失败')
        : runtimeResult.lastValidationStatus === 'healthy'
          ? '最近一次校验通过'
          : '运行配置已更新，建议执行校验',
    );

    return runtimeResult;
  }, [
    selectedRegisteredModelId,
    runtimeProvider,
    runtimeApiBaseUrl,
    runtimeModelName,
    runtimeApiKey,
    clearRuntimeApiKey,
  ]);

  const validateRuntimeConfig = useCallback(async () => {
    setIsRuntimeValidating(true);
    try {
      const result = await systemApi.validateRuntime();
      setRuntimeValidationHint(result.message || (result.ok ? '校验通过' : '校验失败'));
      await loadRuntimeConfig();
      return result;
    } finally {
      setIsRuntimeValidating(false);
    }
  }, [loadRuntimeConfig]);

  const resetRuntimeConfig = useCallback(() => {
    setRuntimeProvider(DEFAULT_PROVIDER);
    setRuntimeApiBaseUrl('');
    setRuntimeModelName('');
    setSelectedRegisteredModelId('');
    setRuntimeApiKey('');
    setClearRuntimeApiKey(false);
    setRuntimeValidationHint('运行配置已重置为默认值，保存后生效。');
  }, []);

  const handleSelectRegisteredModel = useCallback((modelId: string) => {
    const normalizedId = String(modelId || '').trim();
    setSelectedRegisteredModelId(normalizedId);
    if (!normalizedId) {
      return;
    }
    const selected = registeredRuntimeModels.find((item) => item.id === normalizedId);
    if (!selected) {
      return;
    }
    setRuntimeProvider(normalizeProviderToRuntime(selected.provider));
    setRuntimeModelName(selected.name || '');
    if (selected.apiBaseUrl) {
      setRuntimeApiBaseUrl(selected.apiBaseUrl);
    }
    setRuntimeValidationHint(`已选择模型中心模型: ${selected.name}（保存后同步为运行时默认）`);
  }, [registeredRuntimeModels]);

  const handleProviderChange = useCallback((value: RuntimeProvider) => {
    setRuntimeProvider(value);
    if (!selectedRegisteredModelId) {
      return;
    }
    const selected = registeredRuntimeModels.find((item) => item.id === selectedRegisteredModelId);
    if (!selected || normalizeProviderToRuntime(selected.provider) !== value) {
      setSelectedRegisteredModelId('');
    }
  }, [registeredRuntimeModels, selectedRegisteredModelId]);

  const handleApiBaseUrlChange = useCallback((value: string) => {
    setRuntimeApiBaseUrl(value);
    if (!selectedRegisteredModelId) {
      return;
    }
    const selected = registeredRuntimeModels.find((item) => item.id === selectedRegisteredModelId);
    if (!selected) {
      setSelectedRegisteredModelId('');
      return;
    }
    const next = normalizeBaseUrl(value);
    const current = normalizeBaseUrl(selected.apiBaseUrl);
    if (next && current && next !== current) {
      setSelectedRegisteredModelId('');
    }
  }, [registeredRuntimeModels, selectedRegisteredModelId]);

  const handleModelNameChange = useCallback((value: string) => {
    setRuntimeModelName(value);
    if (!selectedRegisteredModelId) {
      return;
    }
    const selected = registeredRuntimeModels.find((item) => item.id === selectedRegisteredModelId);
    if (!selected || String(selected.name || '').trim() !== String(value || '').trim()) {
      setSelectedRegisteredModelId('');
    }
  }, [registeredRuntimeModels, selectedRegisteredModelId]);

  return {
    isRuntimeLoading,
    isRuntimeValidating,
    runtimeProvider,
    setRuntimeProvider: handleProviderChange,
    runtimeApiBaseUrl,
    setRuntimeApiBaseUrl: handleApiBaseUrlChange,
    runtimeModelName,
    setRuntimeModelName: handleModelNameChange,
    runtimeApiKey,
    setRuntimeApiKey,
    clearRuntimeApiKey,
    setClearRuntimeApiKey,
    runtimeApiKeyPreview,
    runtimeApiKeyConfigured,
    runtimeValidationHint,
    setRuntimeValidationHint,
    runtimeConfigUpdatedAt,
    runtimeConfigSource,
    registeredRuntimeModels,
    selectedRegisteredModelId,
    setSelectedRegisteredModelId: handleSelectRegisteredModel,
    loadRuntimeConfig,
    saveRuntimeConfig,
    validateRuntimeConfig,
    resetRuntimeConfig,
  };
}
