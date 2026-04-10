import { request } from './core';
import type {
  DebateCompareLogInput,
  DebateCompareLogResult,
  RuntimeRouteHealthSnapshot,
  SystemExecutionProtocolInput,
  SystemExecutionProtocolSnapshot,
  SystemHealth,
  SystemRuntime,
  SystemRuntimeConfig,
  SystemRuntimeConfigInput,
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

  async validateRuntime() {
    return request<{ ok: boolean; message: string }>('/system/runtime/validate', {
      method: 'POST',
    });
  },

  async getRouteHealth() {
    return request<RuntimeRouteHealthSnapshot>('/system/stage-model-policy/routes/health');
  },

  async compareDebateAndLog(payload: DebateCompareLogInput) {
    return request<DebateCompareLogResult>('/system/stage-model-policy/debate/compare-log', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
