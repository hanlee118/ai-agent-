import { request } from './core';
import type {
  DebateCompareLogInput,
  DebateCompareLogResult,
  DesignModelPolicyHealthSnapshot,
  SystemExecutionProtocolInput,
  SystemExecutionProtocolSnapshot,
  HermesUpgradeState,
  SystemHealth,
  SystemRuntime,
  SystemRuntimeConfig,
  SystemRuntimeConfigInput,
  SystemObservabilitySummary,
  SystemUiAutonomousModeApplyResult,
  SystemUiPreferences,
  SystemUiPreferencesInput,
} from './types';

export const systemApi = {
  async getHealth() {
    return request<SystemHealth>('/system/health');
  },

  async getRuntime() {
    return request<SystemRuntime>('/system/runtime');
  },

  async getRuntimeConfig() {
    return request<SystemRuntimeConfig>('/system/runtime/config');
  },

  async updateRuntimeConfig(data: SystemRuntimeConfigInput) {
    return request<SystemRuntimeConfig>('/system/runtime/config', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async getExecutionProtocol() {
    return request<SystemExecutionProtocolSnapshot>('/system/execution-protocol');
  },

  async updateExecutionProtocol(data: SystemExecutionProtocolInput) {
    return request<SystemExecutionProtocolSnapshot>('/system/execution-protocol', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async getUiPreferences() {
    return request<SystemUiPreferences>('/system/ui-preferences');
  },

  async updateUiPreferences(data: SystemUiPreferencesInput) {
    return request<SystemUiPreferences>('/system/ui-preferences', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async applyUiAutonomousMode(autonomousMode?: boolean, scope: 'all' | 'core' | 'design' = 'all') {
    return request<SystemUiAutonomousModeApplyResult>('/system/ui-preferences/apply-autonomous-mode', {
      method: 'POST',
      body: JSON.stringify({ autonomousMode, scope }),
    });
  },

  async getReadiness() {
    return request<Record<string, unknown>>('/system/readiness');
  },

  async getObservabilitySummary() {
    return request<SystemObservabilitySummary>('/observability/summary');
  },

  async validateRuntime() {
    return request<{ ok: boolean; message: string }>('/system/runtime/validate', {
      method: 'POST',
    });
  },

  async getRouteHealth() {
    // Keep the method name for compatibility with existing callers.
    // Backend exposes design policy health at /system/design-model-policy/health.
    return request<DesignModelPolicyHealthSnapshot>('/system/design-model-policy/health');
  },

  async compareDebateAndLog(payload: DebateCompareLogInput) {
    return request<DebateCompareLogResult>('/system/stage-model-policy/debate/compare-log', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async getHermesUpgradeState() {
    return request<HermesUpgradeState>('/system/hermes-upgrade');
  },

  async updateHermesUpgradeConfig(data: {
    enabled?: boolean;
    autoApply?: boolean;
    minKnowledgeSyncForSuggestion?: number;
    minSkillImportForSuggestion?: number;
  }) {
    return request<HermesUpgradeState>('/system/hermes-upgrade/config', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async evaluateHermesUpgradeNow() {
    return request<HermesUpgradeState>('/system/hermes-upgrade/evaluate', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  async applyHermesSuggestion(id: string) {
    return request<HermesUpgradeState>(`/system/hermes-upgrade/suggestions/${encodeURIComponent(id)}/apply`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  async dismissHermesSuggestion(id: string) {
    return request<HermesUpgradeState>(`/system/hermes-upgrade/suggestions/${encodeURIComponent(id)}/dismiss`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },
};
