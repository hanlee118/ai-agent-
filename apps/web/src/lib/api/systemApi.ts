import { request } from './core';
import type {
  DebateCompareLogInput,
  DebateCompareLogResult,
  DesignModelPolicyHealthSnapshot,
  SystemExecutionProtocolInput,
  SystemExecutionProtocolSnapshot,
  HermesUpgradeState,
  IntegrationReadinessSnapshot,
  SystemDiagnosticsReport,
  SystemHealth,
  SystemRuntime,
  SystemRuntimeConfig,
  SystemRuntimeConfigInput,
  SystemObservabilitySummary,
  SystemPerformanceSummary,
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

  async getIntegrationReadiness() {
    return request<IntegrationReadinessSnapshot>('/system/integration-readiness');
  },

  async runDiagnostics() {
    return request<SystemDiagnosticsReport>('/system/diagnostics/run', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  async triggerAudit() {
    return request<{ ok: boolean; message?: string; scanned?: number; actions?: Array<Record<string, unknown>> }>('/system/trigger-audit', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  async getPerformanceSummary() {
    return request<SystemPerformanceSummary>('/system/performance/summary');
  },

  async selfHealModelRouting(apply = true) {
    return request<{ fixed: number; pending: number; issues: Array<{ reason: string }> }>('/system/model-routing/self-heal', {
      method: 'POST',
      body: JSON.stringify({ apply }),
    });
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
