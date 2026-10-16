import { startTransition, useEffect, useEffectEvent, useState } from 'react'
import type LotteryManager from '../../../services/LotteryManager-lite'
import { mergeAccountModel, sortAccounts } from '../../lib/runtime'
import { buildLegacyConfig } from './legacyConfig'
import type { UiLogEntry } from '../dashboard/useTimelineLogs'
import type { AccountSession, DesktopSettings, DispatchSummary, LotteryHistoryRecord } from '@shared/models'

type AnyRecord = Record<string, any>
export type UseAccountLifecycleProps = {
  accounts: AccountSession[]; settings: DesktopSettings; manager: LotteryManager; activePoolServerUrl: string
  addLog: (message: string, type?: UiLogEntry['type']) => void
  onRuntimeLog: (accountId: string, message: string, type: UiLogEntry['type']) => boolean
  appendAccountLog: (accountId: string, message: string, type?: UiLogEntry['type']) => Promise<void>
  persistHistoryRecord: (record: Partial<LotteryHistoryRecord> & AnyRecord) => Promise<void>
  setAccounts: React.Dispatch<React.SetStateAction<AccountSession[]>>
  setLotteriesByAccount: React.Dispatch<React.SetStateAction<Record<string, AnyRecord[]>>>
  setHistoryRecords: React.Dispatch<React.SetStateAction<LotteryHistoryRecord[]>>
  setDispatchSummary: React.Dispatch<React.SetStateAction<DispatchSummary>>
  runtimeAccountsRef: React.MutableRefObject<Map<string, AnyRecord>>
}
export function useAccountLifecycle(props: UseAccountLifecycleProps) {
  const { settings, manager, activePoolServerUrl, addLog, onRuntimeLog, appendAccountLog,
    persistHistoryRecord, setAccounts, setLotteriesByAccount, setHistoryRecords, setDispatchSummary, runtimeAccountsRef } = props
  const [protocolAccountId, setProtocolAccountId] = useState('')
  const [loginTarget, setLoginTarget] = useState<{ accountId?: string } | null>(null)
  const upsertAccount = useEffectEvent((base: Partial<AccountSession> & AnyRecord) => {
    const model = mergeAccountModel(runtimeAccountsRef.current.get(String(base.id || '')) || {}, base)
    runtimeAccountsRef.current.set(model.id, model)
    startTransition(() => setAccounts(current => sortAccounts([...current.filter(item => item.id !== model.id), model])))
    return model
  })
  const patchAccount = useEffectEvent((accountId: string, patch: Partial<AccountSession>) => {
    const current = runtimeAccountsRef.current.get(accountId)
    if (current) upsertAccount({ ...current, ...patch, id: accountId })
  })
  const stopAccount = useEffectEvent(async (accountId: string) => {
    await manager.stopAccount(accountId)
    patchAccount(accountId, { state: 'paused', actionActive: false, currentTaskStage: '', currentTaskLeaseId: '', currentTaskLeaseRemainingSec: 0 })
  })
  const importSession = useEffectEvent(async (accountId?: string) => {
    if (accountId && runtimeAccountsRef.current.get(accountId)?.actionActive) await stopAccount(accountId)
    const result = await window.electronAPI.invoke('protocol:import-session', { accountId }).catch(() => ({ success: false, error: '会话导入失败' }))
    if (result.canceled) return
    if (!result.success) { addLog(result.error || '会话导入失败', 'error'); return }
    upsertAccount({ ...result.account, token: 'session-present', state: 'waiting', actionActive: false })
    addLog(`账号 ${result.account.nickname} 会话已导入，请验证登录态及福袋详情`, 'info')
    setProtocolAccountId(result.account.id)
  })
  const openProtocolValidation = useEffectEvent((accountId: string) => setProtocolAccountId(accountId))
  const openLogin = useEffectEvent(async (accountId?: string) => {
    if (accountId && runtimeAccountsRef.current.get(accountId)?.actionActive) await stopAccount(accountId)
    setProtocolAccountId('')
    setLoginTarget({ accountId })
  })
  const onSessionSaved = useEffectEvent((account: AnyRecord) => {
    upsertAccount({ ...account, token: 'session-present', state: 'waiting', actionActive: false })
    addLog(`账号 ${account.nickname} 已扫码登录，会话及设备参数已自动保存`, 'info')
  })
  useEffect(() => window.electronAPI.on('protocol:session-saved', onSessionSaved), [])
  const startAccountScanning = useEffectEvent(async (accountId: string) => {
    const account = runtimeAccountsRef.current.get(accountId)
    if (!account || account._starting || account.actionActive) return
    account._starting = true
    try {
      const status = await window.electronAPI.invoke('protocol:session-status', { accountId })
      if (!status?.ready) {
        patchAccount(accountId, { state: 'login_required', actionActive: false })
        setProtocolAccountId(accountId)
        addLog('请先完成登录态和真实福袋详情验证', 'warning')
        return
      }
      manager.setScanConfig(settings.scanConfig)
      manager.setPoolServerConfig({ url: activePoolServerUrl, token: settings.poolServerToken }, { silent: true })
      await manager.startAccount(account, buildLegacyConfig(settings), {
        onStatusUpdate: (update: AnyRecord) => {
          patchAccount(accountId, update)
          if ('poolActiveCandidates' in update) setDispatchSummary(current => ({ ...current, enabled: true, connected: true,
            activeCandidates: Number(update.poolActiveCandidates || 0), validCandidates: Number(update.poolValidCandidates || 0),
            availableCandidates: Number(update.poolAvailableCandidates || 0), updatedAt: Date.now() }))
        },
        onLotteryListUpdate: ({ accountId: id, list }: { accountId: string; list: AnyRecord[] }) => {
          startTransition(() => setLotteriesByAccount(current => ({ ...current, [id]: list || [] })))
        },
        onHistoryRecord: (record: AnyRecord) => void persistHistoryRecord(record),
        onLog: (message: string, type: UiLogEntry['type'] = 'info') => {
          if (onRuntimeLog(accountId, message, type)) void appendAccountLog(accountId, message, type)
        },
        onTokenInvalid: async () => { await stopAccount(accountId); setProtocolAccountId(accountId) }
      })
    } catch { addLog('协议账号启动失败，请重新验证会话', 'error') }
    finally { const current = runtimeAccountsRef.current.get(accountId); if (current) current._starting = false }
  })
  const removeAccount = useEffectEvent(async (accountId: string) => {
    await stopAccount(accountId)
    const removed = await window.electronAPI.invoke('protocol:remove-session', { accountId })
    if (!removed?.success) { addLog(removed?.error || '移除会话失败', 'error'); return }
    await window.electronAPI.desktop.purgeAccountData(accountId)
    runtimeAccountsRef.current.delete(accountId)
    startTransition(() => {
      setAccounts(current => current.filter(item => item.id !== accountId))
      setLotteriesByAccount(current => { const next = { ...current }; delete next[accountId]; return next })
      setHistoryRecords(current => current.filter(item => item.accountId !== accountId))
    })
    if (protocolAccountId === accountId) setProtocolAccountId('')
    addLog(`账号 ${accountId} 已删除`, 'info')
  })
  return { patchAccount, upsertAccount, startAccountScanning, stopAccount, openProtocolValidation,
    addAccount: () => void openLogin(), openLogin, loginTarget, closeLogin: () => setLoginTarget(null),
    importSession, removeAccount, protocolAccountId,
    closeProtocolValidation: () => setProtocolAccountId('') }
}
