import { startTransition, useRef, useState, useMemo, useEffect } from 'react'
import type { 
  AccountSession, 
  LicenseSnapshot, 
  LotteryHistoryRecord, 
  DesktopSettings
} from '@shared/models'
import LotteryManager from '../../services/LotteryManager-lite'
import { FIXED_POOL_SERVER_URL } from '../../services/poolClient'
import {
  deriveRuntimeState,
  mergeAccountModel,
  sortAccounts
} from '../lib/runtime'
import { DOUYIN_LOGIN_PROMPT_SCRIPT } from '../features/accounts/loginPrompt'

export type UiLogEntry = {
  type: 'info' | 'warning' | 'error' | 'success'
}

type AnyRecord = Record<string, any>

interface UseAccountManagerOptions {
  license: LicenseSnapshot
  settings: DesktopSettings
  addLog: (message: string, type: UiLogEntry['type']) => void
  persistHistoryRecord: (record: AnyRecord) => Promise<void>
  setDispatchSummary: React.Dispatch<React.SetStateAction<any>>
  setLotteriesByAccount: React.Dispatch<React.SetStateAction<Record<string, AnyRecord[]>>>
  appendAccountLog: (accountId: string, message: string, type: UiLogEntry['type']) => Promise<void>
  simplifyRuntimeLogMessage: (message: string) => { keep: boolean; message: string }
  buildRuntimeLogDedupKey: (message: string) => string
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function useAccountManager(options: UseAccountManagerOptions) {
  const {
    license,
    settings,
    addLog,
    persistHistoryRecord,
    setDispatchSummary,
    setLotteriesByAccount,
    appendAccountLog,
    simplifyRuntimeLogMessage,
    buildRuntimeLogDedupKey
  } = options

  const manager = useMemo(() => new LotteryManager(), [])
  const runtimeAccountsRef = useRef<Map<string, AnyRecord>>(new Map())
  const loginTimersRef = useRef<Map<string, number>>(new Map())
  const lastRuntimeLogRef = useRef<Map<string, { key: string; at: number }>>(new Map())
  const [accounts, setAccounts] = useState<AccountSession[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState('')

  const syncRuntimeRef = (account: AccountSession) => {
    runtimeAccountsRef.current.set(account.id, {
      ...(runtimeAccountsRef.current.get(account.id) || {}),
      ...account
    })
  }

  const patchAccount = (accountId: string, patch: Partial<AccountSession>) => {
    const runtime = runtimeAccountsRef.current.get(accountId)
    if (runtime) {
      syncRuntimeRef(mergeAccountModel(runtime, patch, license))
    }
    startTransition(() => {
      setAccounts((current) => sortAccounts(current.map((item) => {
        if (item.id !== accountId) return item
        const next = mergeAccountModel(item, patch, license)
        syncRuntimeRef(next)
        return next
      })))
    })
  }

  const upsertAccount = (base: Partial<AccountSession> & AnyRecord) => {
    const model = mergeAccountModel(runtimeAccountsRef.current.get(String(base.id || '')) || {}, base, license)
    syncRuntimeRef(model)
    startTransition(() => {
      setAccounts((current) => {
        const index = current.findIndex((item) => item.id === model.id)
        if (index >= 0) {
          const next = [...current]
          next[index] = mergeAccountModel(next[index], model, license)
          syncRuntimeRef(next[index])
          return sortAccounts(next)
        }
        syncRuntimeRef(model)
        return sortAccounts([...current, model])
      })
    })
    if (!selectedAccountId) setSelectedAccountId(model.id)
    return model
  }

  const stopLoginPolling = (accountId: string) => {
    const timer = loginTimersRef.current.get(accountId)
    if (timer) {
      window.clearInterval(timer)
      loginTimersRef.current.delete(accountId)
    }
  }

  const ensureAccountLoginPrompt = async (accountId: string, nickname: string) => {
    let prompted = false
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (attempt > 0) {
        await wait(attempt < 3 ? 900 : 1400)
      }
      const result = await window.electronAPI.invoke('execute-script', {
        accountId,
        script: DOUYIN_LOGIN_PROMPT_SCRIPT,
        timeoutMs: 6000,
        label: 'login.ensure_prompt'
      }).catch(() => null)
      if (!result?.success) continue
      const payload = result.result || {}
      const state = String(payload.state || '')
      if (!prompted && (state === 'login_clicked' || state === 'qr_tab_clicked')) {
        prompted = true
        addLog(`账号 ${nickname} 已触发登录面板`, 'info')
      }
      if (state === 'qr_ready') {
        addLog(`账号 ${nickname} 二维码已就绪，请扫码登录`, 'info')
        return
      }
    }
    addLog(`账号 ${nickname} 未自动弹出二维码，请点击窗口右上角“登录”后扫码`, 'warning')
  }

  const buildLegacyConfig = (s: DesktopSettings) => {
    return {
      stayDuration: s.stayDuration,
      enableRedPacket: s.enableRedPacket,
      randomInteraction: s.randomInteraction,
      hitRate: s.hitRate,
      secondInspect: s.secondInspect,
      filterFanClub: s.filterFanClub,
      onlyPhysicalPrize: s.onlyPhysicalPrize,
      preferBigRedPacket: s.preferBigRedPacket,
      filterOnline: s.filterOnline,
      participationCount: s.participationCount,
      singleAccountDuration: s.singleAccountDuration,
    }
  }

  const startAccountScanning = async (accountId: string, options: { reuseLoggedInBrowser?: boolean; tokenInfo?: AnyRecord } = {}) => {
    const runtime = runtimeAccountsRef.current.get(accountId)
    if (!runtime) return
    if (!runtime.token && !options.tokenInfo) return
    if (runtime._starting) return
    runtime._starting = true

    try {
      if (!options.reuseLoggedInBrowser) {
        const launch = await window.electronAPI.invoke('launch-browser', { accountId, visible: false })
        if (!launch?.success) {
          addLog(`启动 ${runtime.nickname} 执行容器失败: ${launch?.error || 'unknown'}`, 'error')
          return
        }
        const tokenResult = await window.electronAPI.invoke('load-token', accountId)
        if (!tokenResult?.success || !tokenResult?.tokenInfo) {
          addLog(`账号 ${runtime.nickname} 缺少有效登录态，请重新扫码`, 'warning')
          patchAccount(accountId, { state: 'waiting', actionActive: false })
          return
        }
        const setResult = await window.electronAPI.invoke('set-cookies', { accountId, tokenInfo: tokenResult.tokenInfo })
        if (!setResult?.success || setResult?.isLoginCookieReady === false) {
          addLog(`账号 ${runtime.nickname} 登录态恢复失败，请重新扫码`, 'warning')
          patchAccount(accountId, { state: 'waiting', actionActive: false })
          return
        }
        void window.electronAPI.invoke('navigate-to', { accountId, url: 'https://www.douyin.com' }).catch(() => {})
      }

      await window.electronAPI.desktop.setAccountMonitoring(accountId, true)
      patchAccount(accountId, {
        state: 'running',
        actionActive: true,
        scanRole: runtime.scanRole || 'worker'
      })
      manager.setScanConfig(settings.scanConfig)
      manager.setPoolServerConfig({ url: FIXED_POOL_SERVER_URL }, { silent: true })
      manager.startAccount(runtime, buildLegacyConfig(settings), {
        onStatusUpdate: (update: AnyRecord) => {
          patchAccount(accountId, {
            ...update,
            state: String(update.state || runtime.state || 'running'),
            actionActive: update.actionActive === undefined ? true : update.actionActive === true
          })

          const hasPoolSummary = update && (
            Object.prototype.hasOwnProperty.call(update, 'poolActiveCandidates') ||
            Object.prototype.hasOwnProperty.call(update, 'poolValidCandidates') ||
            Object.prototype.hasOwnProperty.call(update, 'poolAvailableCandidates')
          )
          if (hasPoolSummary) {
            setDispatchSummary((current: any) => ({
              ...current,
              enabled: true,
              connected: true,
              error: '',
              activeCandidates: Number(
                update.poolActiveCandidates !== undefined
                  ? update.poolActiveCandidates
                  : current.activeCandidates
              ),
              validCandidates: Number(
                update.poolValidCandidates !== undefined
                  ? update.poolValidCandidates
                  : current.validCandidates
              ),
              availableCandidates: Number(
                update.poolAvailableCandidates !== undefined
                  ? update.poolAvailableCandidates
                  : current.availableCandidates
              ),
              updatedAt: Number(update.poolSummaryAt || Date.now())
            }))
          }
        },
        onLotteryListUpdate: ({ accountId: nextId, list }: { accountId: string; list: AnyRecord[] }) => {
          startTransition(() => {
            setLotteriesByAccount((current) => ({
              ...current,
              [nextId]: Array.isArray(list) ? list : []
            }))
          })
        },
        onHistoryRecord: (record: AnyRecord) => {
          void persistHistoryRecord(record)
        },
        onLog: (message: string, type: UiLogEntry['type']) => {
          const simplified = simplifyRuntimeLogMessage(message)
          if (!simplified.keep) return
          const dedupKey = buildRuntimeLogDedupKey(simplified.message)
          const now = Date.now()
          const prev = lastRuntimeLogRef.current.get(accountId)
          if (prev && prev.key === dedupKey && now - prev.at < 2200) {
            return
          }
          lastRuntimeLogRef.current.set(accountId, { key: dedupKey, at: now })
          addLog(simplified.message, type)
          void appendAccountLog(accountId, simplified.message, type)
        },
        onTokenInvalid: async ({ id, reason }: { id: string; reason: string }) => {
          const runtimeSnapshot = runtimeAccountsRef.current.get(id)
          const accountName = runtimeSnapshot?.nickname || id
          addLog(`账号 ${accountName} 登录态失效: ${reason || '需要重新扫码登录'}`, 'warning')
          stopLoginPolling(id)
          patchAccount(id, { state: 'waiting', actionActive: false })

          await window.electronAPI.desktop.setAccountMonitoring(id, false).catch(() => {})
          await window.electronAPI.invoke('clear-account-cache', id).catch(() => {})
          await window.electronAPI.invoke('delete-token', id).catch(() => {})
          await manager.stopAccount(id).catch(() => {})

          addLog(`账号 ${accountName} 正在切换到扫码登录...`, 'info')
          window.setTimeout(() => {
            startAccountWithLogin(id, true)
          }, 180)
        }
      }, {
        reuseLoggedInBrowser: options.reuseLoggedInBrowser === true,
        tokenInfo: options.tokenInfo
      })
    } catch (error) {
      addLog(`启动账号失败: ${String((error as Error)?.message || error)}`, 'error')
      patchAccount(accountId, { state: 'error', actionActive: false })
    } finally {
      runtime._starting = false
    }
  }

  const stopAccount = async (accountId: string) => {
    try {
      manager.stopAccount(accountId)
      await window.electronAPI.desktop.setAccountMonitoring(accountId, false)
      patchAccount(accountId, {
        state: 'paused',
        actionActive: false,
        currentTaskStage: '',
        currentTaskLabel: '',
        currentTaskLotteryName: '',
        currentTaskAnchor: '',
        currentTaskLeaseId: '',
        currentTaskLeaseRemainingSec: 0,
        currentTaskScore: 0
      })
    } catch (error) {
      addLog(`暂停账号失败: ${String((error as Error)?.message || error)}`, 'warning')
    }
  }

  const startAccountWithLogin = async (accountId: string, autoStart = true) => {
    const runtime = runtimeAccountsRef.current.get(accountId)
    if (!runtime) return
    try {
      const launch = await window.electronAPI.invoke('launch-browser', { accountId, visible: true })
      if (!launch?.success) {
        addLog(`打开登录窗口失败: ${launch?.error || 'unknown'}`, 'error')
        return
      }
      patchAccount(accountId, { state: 'opened', actionActive: false })
      await window.electronAPI.desktop.setAccountMonitoring(accountId, false)
      await window.electronAPI.invoke('navigate-to', { accountId, url: 'https://www.douyin.com' })
      await window.electronAPI.desktop.showAccountWindow(accountId).catch(() => {})
      void ensureAccountLoginPrompt(accountId, runtime.nickname || accountId)
      stopLoginPolling(accountId)
      const timer = window.setInterval(async () => {
        const tokenResult = await window.electronAPI.invoke('get-login-token', accountId)
        if (!tokenResult?.success || !tokenResult.isLoggedIn) return
        stopLoginPolling(accountId)
        const userInfoResult = await window.electronAPI.invoke('get-user-info', accountId).catch(() => ({ success: false }))
        const userInfo = userInfoResult?.success ? userInfoResult.userInfo : tokenResult.userInfo
        await window.electronAPI.invoke('save-token', {
          accountId,
          tokenInfo: tokenResult.tokenInfo,
          userInfo
        })
        upsertAccount({
          id: accountId,
          nickname: userInfo?.nickname || runtime.nickname,
          userId: userInfo?.userId || runtime.userId || accountId,
          token: tokenResult.tokenInfo?.sessionid || tokenResult.tokenInfo?.sessionid_ss || 'session',
          state: 'waiting',
          actionActive: false,
          scanRole: runtime.scanRole || 'worker'
        })
        addLog(`账号 ${userInfo?.nickname || runtime.nickname} 登录成功`, 'success')
        if (autoStart) {
          window.setTimeout(() => {
            startAccountScanning(accountId, {
              reuseLoggedInBrowser: true,
              tokenInfo: tokenResult.tokenInfo
            })
          }, 280)
        }
      }, 2800)
      loginTimersRef.current.set(accountId, timer)
    } catch (error) {
      stopLoginPolling(accountId)
      addLog(`登录流程异常: ${String((error as Error)?.message || error)}`, 'error')
    }
  }

  const addAccount = () => {
    const nextIndex = accounts.reduce((max, account) => {
      const parsed = Number(account.id.replace(/[^\d]/g, ''))
      return Number.isFinite(parsed) ? Math.max(max, parsed) : max
    }, 0) + 1
    const accountId = `account_${nextIndex}`
    upsertAccount({
      id: accountId,
      nickname: `账号${nextIndex}`,
      userId: accountId,
      state: 'waiting',
      actionActive: false,
      scanRole: 'worker'
    })
    addLog(`请为账号${nextIndex} 扫码登录`, 'info')
    startAccountWithLogin(accountId, true)
  }

  const removeAccount = async (accountId: string) => {
    const runtime = runtimeAccountsRef.current.get(accountId)
    if (runtime) {
      manager.stopAccount(accountId)
      runtimeAccountsRef.current.delete(accountId)
    }
    stopLoginPolling(accountId)
    await window.electronAPI.desktop.setAccountMonitoring(accountId, false).catch(() => {})
    await window.electronAPI.invoke('delete-token', accountId).catch(() => {})
    const purgeResult: { success: boolean; result?: AnyRecord; error?: string } =
      await window.electronAPI.desktop.purgeAccountData(accountId).catch(() => ({ success: false, error: 'invoke_failed' }))
    startTransition(() => {
      setAccounts((current) => current.filter((item) => item.id !== accountId))
      setLotteriesByAccount((current) => {
        const next = { ...current }
        delete next[accountId]
        return next
      })
    })
    if (purgeResult?.success) {
      addLog(`账号 ${accountId} 已彻底删除（历史${purgeResult?.result?.deletedHistoryRows || 0}条，日志文件${purgeResult?.result?.deletedAccountLogFiles || 0}个）`, 'success')
    } else {
      addLog(`账号 ${accountId} 已删除，但本地记录清理失败: ${String(purgeResult?.error || 'unknown')}`, 'warning')
    }
    return purgeResult
  }

  const handleAccountWindowVisibility = async (account: AccountSession, visible: boolean) => {
    const accountName = account.nickname || account.id
    const actionText = visible ? '显示窗口' : '隐藏窗口'

    try {
      const requestVisibility = async () => {
        return visible
          ? (await window.electronAPI.desktop.showAccountWindow(account.id) as AnyRecord)
          : (await window.electronAPI.desktop.hideAccountWindow(account.id) as AnyRecord)
      }

      let result = await requestVisibility()
      if (!result?.success && visible && String(result?.error || '').includes('browser_window_not_found')) {
        const launch = await window.electronAPI.invoke('launch-browser', { accountId: account.id, visible: true })
        if (!launch?.success) {
          addLog('[' + accountName + '] 窗口不存在且重建失败 - ' + String(launch?.error || 'unknown_error'), 'warning')
          return
        }
        await window.electronAPI.invoke('navigate-to', { accountId: account.id, url: 'https://www.douyin.com' }).catch(() => {})
        result = await requestVisibility()
      }

      if (!result?.success) {
        addLog('[' + accountName + '] ' + actionText + '失败：' + String(result?.error || 'unknown_error'), 'warning')
        return
      }
      addLog('[' + accountName + '] 已' + actionText, 'info')
    } catch (error) {
      addLog('[' + accountName + '] ' + actionText + '失败：' + String((error as Error)?.message || error || 'unknown_error'), 'error')
    }
  }

  useEffect(() => {
    setAccounts((current) => current.map((account) => {
      const next = { ...account, runtimeState: deriveRuntimeState(account, license) }
      syncRuntimeRef(next)
      return next
    }))
  }, [license.accessMode, license.authorized, license.trialState])

  useEffect(() => {
    const offBrowserClosed = window.electronAPI.on('browser-closed', ({ accountId }: { accountId: string }) => {
      stopLoginPolling(accountId)
      patchAccount(accountId, { state: 'paused', actionActive: false })
      addLog(`账号 ${accountId} 的浏览器窗口已关闭`, 'warning')
    })
    const offDouyinResponse = window.electronAPI.on('douyin-response', ({ accountId, type, data }: AnyRecord) => {
      if (type === 'lottery') {
        manager.applyLiveLotteryUpdate(accountId, data)
      }
    })

    return () => {
      offBrowserClosed()
      offDouyinResponse()
      loginTimersRef.current.forEach((timer) => window.clearInterval(timer))
      loginTimersRef.current.clear()
    }
  }, [])

  return {
    accounts,
    setAccounts,
    selectedAccountId,
    setSelectedAccountId,
    runtimeAccountsRef,
    loginTimersRef,
    manager,
    upsertAccount,
    patchAccount,
    startAccountScanning,
    stopAccount,
    startAccountWithLogin,
    addAccount,
    removeAccount,
    stopLoginPolling,
    handleAccountWindowVisibility,
    syncRuntimeRef
  }
}
