import { useEffect, useEffectEvent, useState } from 'react'
import {
  activateLicense,
  fetchDesktopNotice,
  fetchLicenseStatus,
  startLicenseTrial
} from '../../services/poolClient'
import { normalizeLicenseSnapshot } from '../lib/runtime'
import {
  emptyHotUpdate,
  emptyLicense,
  emptyUpdate,
  HotUpdateSnapshot
} from '../lib/defaultSnapshots'
import type { UiLogEntry } from '../features/dashboard/useTimelineLogs'
import type { LicenseSnapshot, UpdateSnapshot } from '@shared/models'

type UseLicenseNoticeOptions = {
  poolServerUrl: string
  poolClientId: string
  poolFingerprint: string
  appVersion: string
  onLog: (message: string, type?: UiLogEntry['type']) => void
  getCurrentAccounts?: () => number
}

export type UseLicenseNoticeResult = {
  license: LicenseSnapshot
  licenseKey: string
  licenseBusy: boolean
  announcementMarkdown: string
  updateState: UpdateSnapshot
  hotUpdateState: HotUpdateSnapshot
  refreshLicense: () => Promise<void>
  refreshDesktopNotice: () => Promise<void>
  handleStartTrial: () => Promise<void>
  handleActivate: () => Promise<void>
  setLicenseKey: (value: string) => void
  setUpdateState: (next: UpdateSnapshot) => void
  setHotUpdateState: (next: HotUpdateSnapshot) => void
  resetHotUpdateState: () => void
}

export function useLicenseNotice({
  poolServerUrl,
  poolClientId,
  poolFingerprint,
  appVersion,
  onLog,
  getCurrentAccounts
}: UseLicenseNoticeOptions): UseLicenseNoticeResult {
  const [license, setLicense] = useState<LicenseSnapshot>(emptyLicense)
  const [licenseKey, setLicenseKey] = useState('')
  const [licenseBusy, setLicenseBusy] = useState(false)
  const [announcementMarkdown, setAnnouncementMarkdown] = useState('')
  const [updateState, setUpdateState] = useState<UpdateSnapshot>(emptyUpdate)
  const [hotUpdateState, setHotUpdateState] = useState<HotUpdateSnapshot>(emptyHotUpdate)

  const refreshLicense = useEffectEvent(async () => {
    const requestStatus = async (timeoutMs: number) => (await fetchLicenseStatus(poolServerUrl, {
      clientId: poolClientId,
      fingerprint: poolFingerprint,
      timeoutMs
    })) as { ok?: boolean; data?: { license?: Record<string, any> }; error?: unknown }

    let result = await requestStatus(3000)
    const firstError = String(result?.error || '')
    if (!result?.ok && /timeout/i.test(firstError)) {
      result = await requestStatus(9000)
    }

    if (!result?.ok) {
      const errorText = String(result?.error || '未知错误')
      const keepCurrent = license.authorized
        || license.unrestricted
        || license.accessMode === 'unrestricted'
        || license.accessMode === 'licensed'
        || license.accessMode === 'trial'
      if (keepCurrent) {
        setLicense((current) => ({
          ...current,
          message: `授权服务请求超时：${errorText}（保持当前授权状态）`,
          checkedAt: Date.now()
        }))
        return
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
      })
      return
    }
    setLicense(normalizeLicenseSnapshot(result.data?.license || {}))
  })

  const refreshDesktopNotice = useEffectEvent(async () => {
    try {
      const result = await fetchDesktopNotice(poolServerUrl, { timeoutMs: 2600 }) as { ok?: boolean; data?: Record<string, unknown> }
      if (!result?.ok) {
        setAnnouncementMarkdown('')
        return
      }
      const payload = result.data || {}
      const text = String(payload.markdown ?? payload.noticeMarkdown ?? payload.notice ?? '').trim()
      setAnnouncementMarkdown(text)
    } catch {
      setAnnouncementMarkdown('')
    }
  })

  const handleStartTrial = useEffectEvent(async () => {
    setLicenseBusy(true)
    try {
      const result = await startLicenseTrial(poolServerUrl, {
        clientId: poolClientId,
        fingerprint: poolFingerprint,
        appVersion,
        timeoutMs: 3000
      }) as { ok?: boolean; data?: { license?: Record<string, any> }; error?: unknown }
      if (!result?.ok) {
        const errorText = String(result?.data?.license?.message || result?.error || '未知错误')
        const message = `试用开启失败：${errorText}`
        setLicense((current) => ({
          ...current,
          message,
          checkedAt: Date.now()
        }))
        onLog(message, 'error')
        await refreshLicense()
        return
      }
      const nextLicense = normalizeLicenseSnapshot(result.data?.license || {})
      setLicense(nextLicense)
      onLog(nextLicense.authorized ? '试用已开启' : nextLicense.message, nextLicense.authorized ? 'success' : 'warning')
    } catch (error) {
      const errorText = String((error as Error)?.message || error || '未知错误')
      const message = `试用开启失败：${errorText}`
      setLicense((current) => ({
        ...current,
        message,
        checkedAt: Date.now()
      }))
      onLog(message, 'error')
    } finally {
      setLicenseBusy(false)
    }
  })

  const handleActivate = useEffectEvent(async () => {
    if (!licenseKey.trim()) {
      onLog('请输入授权码', 'warning')
      return
    }
    setLicenseBusy(true)
    try {
      const result = await activateLicense(poolServerUrl, {
        licenseKey,
        clientId: poolClientId,
        fingerprint: poolFingerprint,
        appVersion,
      currentAccounts: getCurrentAccounts ? getCurrentAccounts() : 0,
        timeoutMs: 3000
      }) as { ok?: boolean; data?: { license?: Record<string, any> }; error?: unknown }
      if (!result?.ok) {
        const errorText = String(result?.data?.license?.message || result?.error || '未知错误')
        const message = `授权激活失败：${errorText}`
        setLicense((current) => ({
          ...current,
          message,
          checkedAt: Date.now()
        }))
        onLog(message, 'error')
        await refreshLicense()
        return
      }
      const nextLicense = normalizeLicenseSnapshot(result.data?.license || {})
      setLicense(nextLicense)
      setLicenseKey('')
      onLog(nextLicense.authorized ? '授权激活成功' : nextLicense.message, nextLicense.authorized ? 'success' : 'warning')
    } catch (error) {
      const errorText = String((error as Error)?.message || error || '未知错误')
      const message = `授权激活失败：${errorText}`
      setLicense((current) => ({
        ...current,
        message,
        checkedAt: Date.now()
      }))
      onLog(message, 'error')
    } finally {
      setLicenseBusy(false)
    }
  })

  useEffect(() => {
    void refreshDesktopNotice()
  }, [poolServerUrl, refreshDesktopNotice])

  useEffect(() => {
    const offHotUpdate = window.electronAPI.desktop.onHotUpdateState((snapshot) => {
      setHotUpdateState((current) => ({
        ...current,
        ...snapshot
      }))
    })
    const offUpdate = window.electronAPI.desktop.onUpdateState((snapshot) => {
      setUpdateState((current) => ({
        ...current,
        ...snapshot
      }))
    })
    return () => {
      offHotUpdate()
      offUpdate()
    }
  }, [])

  const resetHotUpdateState = () => setHotUpdateState(emptyHotUpdate)

  return {
    license,
    licenseKey,
    licenseBusy,
    announcementMarkdown,
    updateState,
    hotUpdateState,
    refreshLicense,
    refreshDesktopNotice,
    handleStartTrial,
    handleActivate,
    setLicenseKey,
    setUpdateState,
    setHotUpdateState,
    resetHotUpdateState
  }
}
