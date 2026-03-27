import { useCallback, useEffect, useState } from 'react';
import { systemApi } from '../../lib/api';

export type RuntimeProvider = 'scripted' | 'openai-compatible';

const DEFAULT_PROVIDER: RuntimeProvider = 'scripted';

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

  const loadRuntimeConfig = useCallback(async () => {
    setIsRuntimeLoading(true);
    try {
      const config = await systemApi.getRuntimeConfig();
      setRuntimeProvider(config.provider);
      setRuntimeApiBaseUrl(config.apiBaseUrl || '');
      setRuntimeModelName(config.modelName || '');
      setRuntimeApiKey('');
      setClearRuntimeApiKey(false);
      setRuntimeApiKeyConfigured(Boolean(config.apiKeyConfigured));
      setRuntimeApiKeyPreview(config.apiKeyPreview || '');
      setRuntimeValidationHint(
        config.lastValidationStatus === 'failed'
          ? (config.lastValidationError || '最近一次校验失败')
          : config.lastValidationStatus === 'healthy'
            ? '最近一次校验通过'
            : '尚未进行运行配置校验',
      );
      return config;
    } catch (error) {
      setRuntimeValidationHint(`运行配置加载失败: ${error instanceof Error ? error.message : '未知错误'}`);
      throw error;
    } finally {
      setIsRuntimeLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRuntimeConfig();
  }, [loadRuntimeConfig]);

  const saveRuntimeConfig = useCallback(async () => {
    const runtimeResult = await systemApi.updateRuntimeConfig({
      provider: runtimeProvider,
      apiBaseUrl: runtimeApiBaseUrl.trim(),
      modelName: runtimeModelName.trim(),
      apiKey: runtimeApiKey.trim() || undefined,
      clearApiKey: clearRuntimeApiKey,
    });

    setRuntimeApiKey('');
    setClearRuntimeApiKey(false);
    setRuntimeApiKeyConfigured(Boolean(runtimeResult.apiKeyConfigured));
    setRuntimeApiKeyPreview(runtimeResult.apiKeyPreview || '');
    setRuntimeValidationHint(
      runtimeResult.lastValidationStatus === 'failed'
        ? (runtimeResult.lastValidationError || '最近一次校验失败')
        : runtimeResult.lastValidationStatus === 'healthy'
          ? '最近一次校验通过'
          : '运行配置已更新，建议执行校验',
    );

    return runtimeResult;
  }, [runtimeProvider, runtimeApiBaseUrl, runtimeModelName, runtimeApiKey, clearRuntimeApiKey]);

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
    setRuntimeApiKey('');
    setClearRuntimeApiKey(false);
    setRuntimeValidationHint('运行配置已重置为默认值，保存后生效。');
  }, []);

  return {
    isRuntimeLoading,
    isRuntimeValidating,
    runtimeProvider,
    setRuntimeProvider,
    runtimeApiBaseUrl,
    setRuntimeApiBaseUrl,
    runtimeModelName,
    setRuntimeModelName,
    runtimeApiKey,
    setRuntimeApiKey,
    clearRuntimeApiKey,
    setClearRuntimeApiKey,
    runtimeApiKeyPreview,
    runtimeApiKeyConfigured,
    runtimeValidationHint,
    setRuntimeValidationHint,
    loadRuntimeConfig,
    saveRuntimeConfig,
    validateRuntimeConfig,
    resetRuntimeConfig,
  };
}
