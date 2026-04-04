import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLicenseBindSession, fetchLicenseBindSessionStatus } from '../../../services/poolClient'
import type { LicenseBindSession, UiLogLevel } from './types'

type AnyRecord = Record<string, any>

type ServiceResult<T = AnyRecord> = {
  ok?: boolean
  data?: T
  error?: unknown
}

export type UseLicenseBindingOptions = {
  poolServerUrl: string
  poolClientId: string
  poolFingerprint: string
  appVersion: string
  autoCreateEnabled?: boolean
  onLicenseRefresh: () => Promise<void>
  onLog: (message: string, type?: UiLogLevel) => void
}

export type UseLicenseBindingResult = {
  bindBusy: boolean
  bindSession: LicenseBindSession | null
  bindMiniAppCodeUrl: string
  createBindSession: () => Promise<void>
  refreshBindSessionStatus: (manual?: boolean) => Promise<void>
}

const BIND_POLL_INTERVAL_MS = 2200

function normalizeBindSession(raw: AnyRecord | null | undefined): LicenseBindSession | null {
  if (!raw || typeof raw !== 'object') return null
  return {
    bindToken: String(raw.bindToken || ''),
    sceneCode: String(raw.sceneCode || ''),
    status: String(raw.status || ''),
    message: String(raw.message || ''),
    remainingSec: Number(raw.remainingSec || 0),
    adUnlockDays: Number(raw.adUnlockDays || 0),
    authorized: raw.authorized === true,
    wechatNickname: String(raw.wechatNickname || ''),
    expireAt: Number(raw.expireAt || 0)
  }
}

function getBindStatus(session: LicenseBindSession | null): string {
  return String(session?.status || '').trim().toLowerCase()
}

function hasBindReference(session: LicenseBindSession | null): boolean {
  const bindToken = String(session?.bindToken || '').trim()
  const sceneCode = String(session?.sceneCode || '').trim()
  return Boolean(bindToken || sceneCode)
}

function isBindSessionFinished(session: LicenseBindSession | null) {
  if (!session) return true
  const bindToken = String(session.bindToken || '').trim()
  if (!bindToken) return true
  const status = getBindStatus(session)
  if (status === 'granted' || status === 'expired') return true
  if (Number(session.remainingSec || 0) <= 0) return true
  return false
}

/**
 * 授权绑定逻辑集中在这个 Hook：
 * - 创建小程序绑定会话
 * - 轮询绑定状态
 * - 成功后刷新授权状态
 */
export function useLicenseBinding(options: UseLicenseBindingOptions): UseLicenseBindingResult {
  const {
    poolServerUrl,
    poolClientId,
    poolFingerprint,
    appVersion,
    autoCreateEnabled = false,
    onLicenseRefresh,
    onLog
  } = options

  const [bindBusy, setBindBusy] = useState(false)
  const [bindSession, setBindSession] = useState<LicenseBindSession | null>(null)
  const [bindCodeVersion, setBindCodeVersion] = useState(0)
  const bindNoticeRef = useRef<'idle' | 'success' | 'expired' | 'scanned' | 'authorized-only'>('idle')
  const autoCreateAtRef = useRef(0)

  const bindToken = useMemo(() => String(bindSession?.bindToken || '').trim(), [bindSession?.bindToken])
  const bindSceneCode = useMemo(() => String(bindSession?.sceneCode || '').trim(), [bindSession?.sceneCode])
  const normalizedPoolServerUrl = useMemo(() => String(poolServerUrl || '').trim(), [poolServerUrl])

  const bindMiniAppCodeUrl = useMemo(() => {
    if (!normalizedPoolServerUrl) return ''
    if (!bindSceneCode && !bindToken) return ''
    const baseUrl = normalizedPoolServerUrl.replace(/\/+$/, '')
    const query = bindSceneCode
      ? `sceneCode=${encodeURIComponent(bindSceneCode)}`
      : `bindToken=${encodeURIComponent(bindToken)}`
    return `${baseUrl}/license/bind-session/miniapp-code?${query}&v=${bindCodeVersion}`
  }, [normalizedPoolServerUrl, bindSceneCode, bindToken, bindCodeVersion])

  const applyBindSession = useCallback(async (nextSession: LicenseBindSession | null) => {
    setBindSession(nextSession)
    if (!nextSession) {
      bindNoticeRef.current = 'idle'
      return
    }

    const status = getBindStatus(nextSession)
    if (status === 'granted') {
      if (bindNoticeRef.current !== 'success') {
        onLog('小程序签到完成，授权状态已刷新', 'success')
      }
      bindNoticeRef.current = 'success'
      await onLicenseRefresh()
      return
    }

    if (status === 'scanned') {
      if (bindNoticeRef.current !== 'scanned') {
        onLog('小程序已扫码绑定，请在小程序端完成签到', 'info')
      }
      bindNoticeRef.current = 'scanned'
      return
    }

    if (status === 'authorized' && !hasBindReference(nextSession)) {
      if (bindNoticeRef.current !== 'authorized-only') {
        onLog('当前仅授权生效，服务端未下发绑定会话，暂时无法展示小程序码', 'warning')
      }
      bindNoticeRef.current = 'authorized-only'
      return
    }

    if ((status === 'expired' || Number(nextSession.remainingSec || 0) <= 0) && bindNoticeRef.current !== 'expired') {
      bindNoticeRef.current = 'expired'
      onLog('小程序码已过期，正在自动刷新', 'warning')
    }
  }, [onLicenseRefresh, onLog])

  const refreshBindSessionStatus = useCallback(async (manual = false) => {
    if (!bindToken) {
      if (manual) onLog('当前没有可查询的绑定会话', 'warning')
      return
    }

    if (manual) setBindBusy(true)
    try {
      const result = (await fetchLicenseBindSessionStatus(normalizedPoolServerUrl, {
        bindToken,
        timeoutMs: 3000
      })) as ServiceResult<{ session?: AnyRecord }>

      if (!result?.ok) {
        const errorText = String((result?.data as AnyRecord)?.error || result?.error || 'unknown_error')
        if (manual) onLog(`查询绑定状态失败：${errorText}`, 'error')
        return
      }

      const nextSession = normalizeBindSession(result.data?.session || null)
      await applyBindSession(nextSession)
      if (manual && nextSession && getBindStatus(nextSession) !== 'granted') {
        onLog(nextSession.message || '已刷新绑定状态', 'info')
      }
    } catch (error) {
      if (manual) onLog(`查询绑定状态异常：${String((error as Error)?.message || error || 'unknown_error')}`, 'error')
    } finally {
      if (manual) setBindBusy(false)
    }
  }, [applyBindSession, bindToken, normalizedPoolServerUrl, onLog])

  const createBindSession = useCallback(async () => {
    setBindBusy(true)
    try {
      const result = (await createLicenseBindSession(normalizedPoolServerUrl, {
        clientId: poolClientId,
        fingerprint: poolFingerprint,
        appVersion,
        timeoutMs: 3000
      })) as ServiceResult<{ session?: AnyRecord }>

      if (!result?.ok) {
        const errorText = String((result?.data as AnyRecord)?.error || result?.error || 'unknown_error')
        onLog(`创建绑定会话失败：${errorText}`, 'error')
        return
      }

      bindNoticeRef.current = 'idle'
      const nextSession = normalizeBindSession(result.data?.session || null)
      await applyBindSession(nextSession)
      setBindCodeVersion((current) => current + 1)

      if (hasBindReference(nextSession)) {
        onLog('小程序码已自动生成，请扫码完成绑定', 'info')
      } else if (getBindStatus(nextSession) === 'authorized') {
        onLog('当前为试用/已授权状态，服务端未返回绑定会话，二维码无法生成', 'warning')
      } else {
        onLog(nextSession?.message || '当前未生成绑定会话，请稍后重试', 'warning')
      }
    } catch (error) {
      onLog(`创建绑定会话异常：${String((error as Error)?.message || error || 'unknown_error')}`, 'error')
    } finally {
      setBindBusy(false)
    }
  }, [appVersion, applyBindSession, normalizedPoolServerUrl, onLog, poolClientId, poolFingerprint])

  useEffect(() => {
    if (isBindSessionFinished(bindSession)) return
    const timer = window.setTimeout(() => {
      void refreshBindSessionStatus(false)
    }, BIND_POLL_INTERVAL_MS)
    return () => window.clearTimeout(timer)
  }, [bindSession, refreshBindSessionStatus])

  useEffect(() => {
    if (!autoCreateEnabled) return
    if (bindBusy) return
    if (!normalizedPoolServerUrl || !poolClientId || !poolFingerprint) return

    const status = getBindStatus(bindSession)
    const hasSessionRef = Boolean(bindToken || bindSceneCode)
    const authorizedWithoutSession = status === 'authorized' && !hasSessionRef
    if (authorizedWithoutSession) return

    const hasActiveSession = hasSessionRef && status !== 'expired' && status !== 'granted' && Number(bindSession?.remainingSec || 0) > 0
    if (hasActiveSession) return

    const now = Date.now()
    if (now - autoCreateAtRef.current < 5000) return
    autoCreateAtRef.current = now
    void createBindSession()
  }, [
    autoCreateEnabled,
    bindBusy,
    bindSceneCode,
    bindSession?.remainingSec,
    bindSession?.status,
    bindToken,
    createBindSession,
    normalizedPoolServerUrl,
    poolClientId,
    poolFingerprint
  ])

  return {
    bindBusy,
    bindSession,
    bindMiniAppCodeUrl,
    createBindSession,
    refreshBindSessionStatus
  }
}
