import { useCallback, useEffect, useMemo, useState } from 'react';
import { systemApi } from '../../lib/api';

const SETTINGS_STORAGE_KEY = 'aegis.settings.v1';

export type SettingsLanguage = 'zh' | 'en';
export type SettingsSource = 'default' | 'local' | 'server';

export interface SettingsSnapshot {
  language: SettingsLanguage;
  workspacePath: string;
  autoSync: boolean;
  apiProtection: boolean;
  autonomousMode: boolean;
  usageAlert: boolean;
  usageAlertThresholdPercent: number;
}

const defaultSettings: SettingsSnapshot = {
  language: 'zh',
  workspacePath: '~/.openclaw/workspace',
  autoSync: true,
  apiProtection: true,
  autonomousMode: false,
  usageAlert: true,
  usageAlertThresholdPercent: 80,
};

export interface SettingsSaveResult {
  snapshot: SettingsSnapshot;
  localSaved: boolean;
  serverSaved: boolean;
  serverError?: string;
}

function normalizeSnapshot(input: Partial<SettingsSnapshot> | undefined): SettingsSnapshot {
  return {
    language: input?.language === 'en' ? 'en' : 'zh',
    workspacePath: String(input?.workspacePath || '').trim() || defaultSettings.workspacePath,
    autoSync: input?.autoSync !== false,
    apiProtection: input?.apiProtection !== false,
    autonomousMode: Boolean(input?.autonomousMode),
    usageAlert: input?.usageAlert !== false,
    usageAlertThresholdPercent: Number.isFinite(Number(input?.usageAlertThresholdPercent))
      ? Math.max(50, Math.min(95, Math.round(Number(input?.usageAlertThresholdPercent))))
      : defaultSettings.usageAlertThresholdPercent,
  };
}

export function useSettings() {
  const [isSettingsLoading, setIsSettingsLoading] = useState(false);
  const [settingsSource, setSettingsSource] = useState<SettingsSource>('default');
  const [settingsUpdatedAt, setSettingsUpdatedAt] = useState('');
  const [language, setLanguage] = useState<SettingsLanguage>(defaultSettings.language);
  const [workspacePath, setWorkspacePath] = useState(defaultSettings.workspacePath);
  const [autoSync, setAutoSync] = useState(defaultSettings.autoSync);
  const [apiProtection, setApiProtection] = useState(defaultSettings.apiProtection);
  const [autonomousMode, setAutonomousMode] = useState(defaultSettings.autonomousMode);
  const [usageAlert, setUsageAlert] = useState(defaultSettings.usageAlert);
  const [usageAlertThresholdPercent, setUsageAlertThresholdPercent] = useState(defaultSettings.usageAlertThresholdPercent);

  const applySnapshot = useCallback((next: Partial<SettingsSnapshot>) => {
    const normalized = normalizeSnapshot(next);
    setLanguage(normalized.language);
    setWorkspacePath(normalized.workspacePath);
    setAutoSync(normalized.autoSync);
    setApiProtection(normalized.apiProtection);
    setAutonomousMode(normalized.autonomousMode);
    setUsageAlert(normalized.usageAlert);
    setUsageAlertThresholdPercent(normalized.usageAlertThresholdPercent);
  }, []);

  useEffect(() => {
    let hasLocalSnapshot = false;
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SettingsSnapshot>;
        applySnapshot(parsed);
        hasLocalSnapshot = true;
        setSettingsSource('local');
      }
    } catch {
      // ignore invalid local settings payload
    }

    let active = true;
    setIsSettingsLoading(true);
    void systemApi
      .getUiPreferences()
      .then((snapshot) => {
        if (!active) {
          return;
        }
        applySnapshot(snapshot);
        setSettingsSource('server');
        setSettingsUpdatedAt(snapshot.updatedAt || '');
        try {
          localStorage.setItem(
            SETTINGS_STORAGE_KEY,
            JSON.stringify(
              normalizeSnapshot({
                language: snapshot.language,
                workspacePath: snapshot.workspacePath,
                autoSync: snapshot.autoSync,
                apiProtection: snapshot.apiProtection,
                autonomousMode: snapshot.autonomousMode,
                usageAlert: snapshot.usageAlert,
                usageAlertThresholdPercent: snapshot.usageAlertThresholdPercent,
              }),
            ),
          );
        } catch {
          // ignore browser storage write failures
        }
      })
      .catch(() => {
        if (!active) {
          return;
        }
        if (!hasLocalSnapshot) {
          setSettingsSource('default');
        }
      })
      .finally(() => {
        if (active) {
          setIsSettingsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [applySnapshot]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
    document.documentElement.dataset.uiLanguage = language;
  }, [language]);

  const snapshot = useMemo<SettingsSnapshot>(() => ({
    language,
    workspacePath: workspacePath.trim() || defaultSettings.workspacePath,
    autoSync,
    apiProtection,
    autonomousMode,
    usageAlert,
    usageAlertThresholdPercent,
  }), [language, workspacePath, autoSync, apiProtection, autonomousMode, usageAlert, usageAlertThresholdPercent]);

  const saveToStorage = useCallback(() => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(snapshot));
  }, [snapshot]);

  const saveSettings = useCallback(async (): Promise<SettingsSaveResult> => {
    let localSaved = false;
    try {
      saveToStorage();
      localSaved = true;
      setSettingsSource((current) => (current === 'server' ? current : 'local'));
    } catch {
      localSaved = false;
    }

    try {
      const updated = await systemApi.updateUiPreferences({
        language: snapshot.language,
        workspacePath: snapshot.workspacePath,
        autoSync: snapshot.autoSync,
        apiProtection: snapshot.apiProtection,
        autonomousMode: snapshot.autonomousMode,
        usageAlert: snapshot.usageAlert,
        usageAlertThresholdPercent: snapshot.usageAlertThresholdPercent,
      });
      setSettingsSource('server');
      setSettingsUpdatedAt(updated.updatedAt || '');
      return {
        snapshot,
        localSaved,
        serverSaved: true,
      };
    } catch (error) {
      return {
        snapshot,
        localSaved,
        serverSaved: false,
        serverError: error instanceof Error ? error.message : '服务端保存失败',
      };
    }
  }, [saveToStorage, snapshot]);

  const resetToDefaults = useCallback(() => {
    setLanguage(defaultSettings.language);
    setWorkspacePath(defaultSettings.workspacePath);
    setAutoSync(defaultSettings.autoSync);
    setApiProtection(defaultSettings.apiProtection);
    setAutonomousMode(defaultSettings.autonomousMode);
    setUsageAlert(defaultSettings.usageAlert);
    setUsageAlertThresholdPercent(defaultSettings.usageAlertThresholdPercent);
    try {
      localStorage.removeItem(SETTINGS_STORAGE_KEY);
    } catch {
      // ignore storage reset errors
    }
  }, []);

  return {
    language,
    setLanguage,
    workspacePath,
    setWorkspacePath,
    autoSync,
    setAutoSync,
    apiProtection,
    setApiProtection,
    autonomousMode,
    setAutonomousMode,
    usageAlert,
    setUsageAlert,
    usageAlertThresholdPercent,
    setUsageAlertThresholdPercent,
    snapshot,
    saveToStorage,
    saveSettings,
    resetToDefaults,
    isSettingsLoading,
    settingsSource,
    settingsUpdatedAt,
  };
}
