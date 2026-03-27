import React from 'react';
import SettingsPanel from '../features/settings/SettingsPanel';

export default function SettingsPage({
  addToast,
  onRuntimeUpdated,
}: {
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onRuntimeUpdated?: () => Promise<void> | void;
}) {
  return <SettingsPanel addToast={addToast} onRuntimeUpdated={onRuntimeUpdated} />;
}
