import { useCallback, useEffect, useMemo, useState } from 'react';

const SETTINGS_STORAGE_KEY = 'aegis.settings.v1';

export type SettingsLanguage = 'zh' | 'en';

export interface SettingsSnapshot {
  language: SettingsLanguage;
  workspacePath: string;
  autoSync: boolean;
  apiProtection: boolean;
  autonomousMode: boolean;
  usageAlert: boolean;
}

const defaultSettings: SettingsSnapshot = {
  language: 'zh',
  workspacePath: '~/.openclaw',
  autoSync: true,
  apiProtection: true,
  autonomousMode: false,
  usageAlert: true,
};

export function useSettings() {
  const [language, setLanguage] = useState<SettingsLanguage>(defaultSettings.language);
  const [workspacePath, setWorkspacePath] = useState(defaultSettings.workspacePath);
  const [autoSync, setAutoSync] = useState(defaultSettings.autoSync);
  const [apiProtection, setApiProtection] = useState(defaultSettings.apiProtection);
  const [autonomousMode, setAutonomousMode] = useState(defaultSettings.autonomousMode);
  const [usageAlert, setUsageAlert] = useState(defaultSettings.usageAlert);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as Partial<SettingsSnapshot>;
      setLanguage(parsed.language === 'en' ? 'en' : 'zh');
      setWorkspacePath(parsed.workspacePath?.trim() || defaultSettings.workspacePath);
      setAutoSync(parsed.autoSync !== false);
      setApiProtection(parsed.apiProtection !== false);
      setAutonomousMode(Boolean(parsed.autonomousMode));
      setUsageAlert(parsed.usageAlert !== false);
    } catch {
      // ignore invalid local settings payload
    }
  }, []);

  const snapshot = useMemo<SettingsSnapshot>(() => ({
    language,
    workspacePath: workspacePath.trim() || defaultSettings.workspacePath,
    autoSync,
    apiProtection,
    autonomousMode,
    usageAlert,
  }), [language, workspacePath, autoSync, apiProtection, autonomousMode, usageAlert]);

  const saveToStorage = useCallback(() => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(snapshot));
  }, [snapshot]);

  const resetToDefaults = useCallback(() => {
    setLanguage(defaultSettings.language);
    setWorkspacePath(defaultSettings.workspacePath);
    setAutoSync(defaultSettings.autoSync);
    setApiProtection(defaultSettings.apiProtection);
    setAutonomousMode(defaultSettings.autonomousMode);
    setUsageAlert(defaultSettings.usageAlert);
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
    snapshot,
    saveToStorage,
    resetToDefaults,
  };
}
