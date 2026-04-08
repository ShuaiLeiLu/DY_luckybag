import { useState, useCallback, useEffect } from 'react';
import type { DesktopSettings, BootstrapSnapshot } from '@shared/models';
import { FIXED_POOL_SERVER_URL } from '../../services/poolClient';

export const defaultSettings: DesktopSettings = {
  poolServerUrl: FIXED_POOL_SERVER_URL,
  updateFeedUrl: '',
  hotUpdateEnabled: true,
  hotUpdateManifestUrl: 'http://fudai.shuai.help:9090/desktop/hot-manifest.json',
  hotUpdateReloadOnApply: false,
  noticeMarkdown: '',
  stayDuration: 18,
  enableRedPacket: true,
  randomInteraction: true,
  hitRate: { enabled: true, value: 0.08 },
  secondInspect: { enabled: true, value: 0.05 },
  filterFanClub: { enabled: true },
  onlyPhysicalPrize: { enabled: false },
  preferBigRedPacket: { enabled: true, threshold: 40 },
  filterOnline: { enabled: false, value: 0 },
  participationCount: { enabled: false, value: 120 },
  singleAccountDuration: { enabled: false, value: 6 },
  scanConfig: { countPerPage: 15, pagesPerCategory: 12, allCount: 24 }
};

export function useSystemSettings(bootstrap: BootstrapSnapshot | null) {
  const [settings, setSettings] = useState<DesktopSettings>(defaultSettings);

  useEffect(() => {
    if (bootstrap?.settings) {
      setSettings({
        ...defaultSettings,
        ...bootstrap.settings,
        poolServerUrl: FIXED_POOL_SERVER_URL // Force fixed URL
      });
    }
  }, [bootstrap]);

  const persistSettings = useCallback(async (patch: Partial<DesktopSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      await window.electronAPI.desktop.saveSettings(patch);
    } catch (err) {
      console.error('Failed to persist settings:', err);
    }
  }, [settings]);

  return {
    settings,
    setSettings,
    persistSettings
  };
}
