import { useState, useCallback, useMemo } from 'react';
import {
  fetchLicenseStatus,
  activateLicense,
  startLicenseTrial,
  FIXED_POOL_SERVER_URL,
  resolvePoolClientId,
  resolveLicenseFingerprint
} from '../../services/poolClient';
import { normalizeLicenseSnapshot } from '../lib/runtime';
import type { LicenseSnapshot } from '@shared/models';

export const emptyLicense: LicenseSnapshot = {
  enabled: false,
  available: false,
  authorized: false,
  unrestricted: false,
  state: 'disabled',
  message: '未连接授权服务',
  accessMode: 'disabled',
  trialState: 'none',
  trialExpireAt: 0,
  trialRemainingSec: 0,
  requiresActivation: false,
  licensePlan: '',
  features: {},
  featureFlags: {},
  checkedAt: 0
};

export function useLicenseManager() {
  const [license, setLicense] = useState<LicenseSnapshot>(emptyLicense);
  const [licenseBusy, setLicenseBusy] = useState(false);
  
  const poolClientId = useMemo(() => resolvePoolClientId(), []);
  const poolFingerprint = useMemo(() => resolveLicenseFingerprint(), []);

  const refreshLicense = useCallback(async () => {
    const baseUrl = FIXED_POOL_SERVER_URL;
    const requestStatus = async (timeoutMs: number) => {
      try {
        return await fetchLicenseStatus(baseUrl, {
          clientId: poolClientId,
          fingerprint: poolFingerprint,
          timeoutMs
        });
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    };

    let result = await requestStatus(3000) as { ok?: boolean; error?: unknown; data?: any };
    if (!result?.ok && /timeout/i.test(String(result?.error || ''))) {
      result = await requestStatus(9000) as { ok?: boolean; error?: unknown; data?: any };
    }

    if (!result?.ok) {
      const errorText = String(result?.error || '未知错误');
      const keepCurrent = license.authorized || 
                          license.unrestricted || 
                          license.accessMode === 'unrestricted' || 
                          license.accessMode === 'licensed' || 
                          license.accessMode === 'trial';
      
      if (keepCurrent) {
        setLicense(prev => ({
          ...prev,
          message: `授权服务请求超时：${errorText}（保持当前授权状态）`,
          checkedAt: Date.now()
        }));
        return;
      }

      setLicense({
        ...emptyLicense,
        enabled: true,
        available: false,
        accessMode: 'locked',
        requiresActivation: true,
        state: 'backend_unavailable',
        message: `授权服务不可用：${errorText}`,
        checkedAt: Date.now()
      });
      return;
    }

    // @ts-ignore - result.data.license is expected from service
    setLicense(normalizeLicenseSnapshot(result.data?.license || {}));
  }, [license.authorized, license.unrestricted, license.accessMode, poolClientId, poolFingerprint]);

  const handleActivate = useCallback(async (key: string) => {
    if (!key.trim() || licenseBusy) return;
    setLicenseBusy(true);
    try {
      const result = await activateLicense(FIXED_POOL_SERVER_URL, {
        clientId: poolClientId,
        fingerprint: poolFingerprint,
        licenseKey: key.trim()
      }) as { ok?: boolean; error?: unknown };
      if (result.ok) {
        await refreshLicense();
      } else {
        alert(`激活失败：${String(result.error || '未知错误')}`);
      }
    } finally {
      setLicenseBusy(false);
    }
  }, [licenseBusy, poolClientId, poolFingerprint, refreshLicense]);

  const handleStartTrial = useCallback(async () => {
    if (licenseBusy) return;
    setLicenseBusy(true);
    try {
      const result = await startLicenseTrial(FIXED_POOL_SERVER_URL, {
        clientId: poolClientId,
        fingerprint: poolFingerprint
      }) as { ok?: boolean; error?: unknown };
      if (result.ok) {
        await refreshLicense();
      } else {
        alert(`领取试用失败：${String(result.error || '未知错误')}`);
      }
    } finally {
      setLicenseBusy(false);
    }
  }, [licenseBusy, poolClientId, poolFingerprint, refreshLicense]);

  return {
    license,
    licenseBusy,
    refreshLicense,
    handleActivate,
    handleStartTrial
  };
}
