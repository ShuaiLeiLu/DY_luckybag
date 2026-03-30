import {
  startTransition,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState
} from 'react'
import LotteryManager from '../services/LotteryManager-lite'
import {
  FIXED_POOL_SERVER_URL,
  activateLicense,
  fetchLicenseStatus,
  resolveLicenseFingerprint,
  resolvePoolClientId,
  startLicenseTrial
} from '../services/poolClient'
import {
  deriveRuntimeState,
  formatRelative,
  mergeAccountModel,
  normalizeLicenseSnapshot,
  sortAccounts
} from './lib/runtime'
import { StatCard, ClusterBadge } from './components/ui/StatusWidgets'
import { AccountCard } from './features/accounts/AccountCard'
import { buildLegacyConfig } from './features/accounts/legacyConfig'
import { DOUYIN_LOGIN_PROMPT_SCRIPT } from './features/accounts/loginPrompt'
import { LicenseDrawer } from './features/license/LicenseDrawer'
import { LicenseGate } from './features/license/LicenseGate'
import { formatAccessModeText, formatLicensePlanText, formatUpdateStatusText } from './features/license/presentation'
import { useLicenseBinding } from './features/license/useLicenseBinding'
import { SettingsDrawer } from './features/settings/SettingsDrawer'
import { TaskDetailPanel } from './features/dashboard/TaskDetailPanel'
import { TimelinePanel } from './features/dashboard/TimelinePanel'
import { type UiLogEntry, useTimelineLogs } from './features/dashboard/useTimelineLogs'
import type {
  AccountSession,
  BootstrapSnapshot,
  DesktopSettings,
  DispatchSummary,
  LicenseSnapshot,
  RecoveryEvent,
  UpdateSnapshot
} from '@shared/models'

type AnyRecord = Record<string, any>
type ServiceResult<T = AnyRecord> = {
  ok?: boolean
  data?: T
  error?: unknown
}


const defaultSettings: DesktopSettings = {
  poolServerUrl: FIXED_POOL_SERVER_URL,
  updateFeedUrl: 'https://updates.example.com/dy-fudai/windows',
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
}

const emptyDispatchSummary: DispatchSummary = {
  enabled: false,
  connected: false,
  activeCandidates: 0,
  validCandidates: 0,
  availableCandidates: 0,
  updatedAt: 0
}

const emptyLicense: LicenseSnapshot = {
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
}

const emptyUpdate: UpdateSnapshot = {
  status: 'disabled',
  currentVersion: '0.0.0',
  latestVersion: '',
  progress: 0,
  message: '未配置更新源',
  feedUrl: '',
  checkedAt: 0
}



function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}


export default function App() {
  const manager = useMemo(() => new LotteryManager(), [])
  const runtimeAccountsRef = useRef<Map<string, AnyRecord>>(new Map())
  const loginTimersRef = useRef<Map<string, number>>(new Map())
  const [bootstrap, setBootstrap] = useState<BootstrapSnapshot | null>(null)
  const [settings, setSettings] = useState<DesktopSettings>(defaultSettings)
  const [accounts, setAccounts] = useState<AccountSession[]>([])
  const [lotteriesByAccount, setLotteriesByAccount] = useState<Record<string, AnyRecord[]>>({})
  const [historyRecords, setHistoryRecords] = useState<AnyRecord[]>([])
  const [dispatchSummary, setDispatchSummary] = useState<DispatchSummary>(emptyDispatchSummary)
  const [learningSummary, setLearningSummary] = useState<AnyRecord | null>(null)
  const [learningItems, setLearningItems] = useState<AnyRecord[]>([])
  const [license, setLicense] = useState<LicenseSnapshot>(emptyLicense)
  const [updateState, setUpdateState] = useState<UpdateSnapshot>(emptyUpdate)
  const [licenseKey, setLicenseKey] = useState('')
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [authDrawerOpen, setAuthDrawerOpen] = useState(false)
  const [licenseBusy, setLicenseBusy] = useState(false)
  const {
    filteredLogs,
    logListRef,
    logQuery,
    setLogQuery,
    handleLogListScroll,
    addLog,
    replaceLogs
  } = useTimelineLogs()

  const poolClientId = useMemo(() => resolvePoolClientId(), [])
  const activePoolServerUrl = useMemo(() => settings.poolServerUrl.trim() || FIXED_POOL_SERVER_URL, [settings.poolServerUrl])
  const poolFingerprint = useMemo(() => resolveLicenseFingerprint(), [])

  const selectedAccount = accounts.find((item) => item.id === selectedAccountId) || accounts[0] || null
  const syncRuntimeRef = (account: AccountSession) => {
    runtimeAccountsRef.current.set(account.id, {
      ...(runtimeAccountsRef.current.get(account.id) || {}),
      ...account
    })
  }

  const patchAccount = useEffectEvent((accountId: string, patch: Partial<AccountSession>) => {
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
  })

  const upsertAccount = useEffectEvent((base: Partial<AccountSession> & AnyRecord) => {
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
  })

  const stopLoginPolling = useEffectEvent((accountId: string) => {
    const timer = loginTimersRef.current.get(accountId)
    if (timer) {
      window.clearInterval(timer)
      loginTimersRef.current.delete(accountId)
    }
  })

  const ensureAccountLoginPrompt = useEffectEvent(async (accountId: string, nickname: string) => {
    let prompted = false
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (attempt > 0) {
        await wait(attempt < 3 ? 900 : 1400)
      }
      const result = await window.electronAPI.invoke('execute-script', {
        accountId,
        script: DOUYIN_LOGIN_PROMPT_SCRIPT,
        timeoutMs: 6000
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
  })

  const refreshLicense = useEffectEvent(async () => {
    const baseUrl = settings.poolServerUrl.trim() || FIXED_POOL_SERVER_URL
    const requestStatus = async (timeoutMs: number) => (await fetchLicenseStatus(baseUrl, {
      clientId: poolClientId,
      fingerprint: poolFingerprint,
      timeoutMs
    })) as ServiceResult<{ license?: AnyRecord }>

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

  const refreshDispatch = useEffectEvent(async () => {
    const poolServerUrl = activePoolServerUrl
    manager.setPoolServerConfig({ url: poolServerUrl }, { silent: true })
    const result = (await manager.fetchPoolTaskDebugSnapshot(buildLegacyConfig(settings), { limit: 50 })) as ServiceResult<{
      summary?: AnyRecord
    }>
    if (!result?.ok) {
      setDispatchSummary({
        enabled: true,
        connected: false,
        activeCandidates: 0,
        validCandidates: 0,
        availableCandidates: 0,
        updatedAt: Date.now(),
        error: String(result?.error || 'task_debug_failed')
      })
      return
    }
    const summary = result.data?.summary || {}
    setDispatchSummary({
      enabled: true,
      connected: true,
      activeCandidates: Number(summary.activeCandidates || 0),
      validCandidates: Number(summary.validCandidates || 0),
      availableCandidates: Number(summary.availableCandidates || 0),
      updatedAt: Number(summary.generatedAt || Date.now())
    })
  })

  const refreshLearning = useEffectEvent(async () => {
    const result = (await manager.fetchPoolLearningDebugSnapshot({ limit: 12 })) as ServiceResult<{
      summary?: AnyRecord
      items?: AnyRecord[]
    }>
    if (!result?.ok) return
    setLearningSummary(result.data?.summary || null)
    setLearningItems(Array.isArray(result.data?.items) ? result.data.items : [])
  })

  const bootstrapDesktop = useEffectEvent(async () => {
    try {
      const snapshot = await window.electronAPI.desktop.getBootstrap()
      setBootstrap(snapshot)
      setSettings({
        ...defaultSettings,
        ...(snapshot.settings || {})
      })
      setUpdateState(snapshot.update || emptyUpdate)
      replaceLogs((snapshot.events || []).map((event) => ({
        id: event.id,
        time: new Date(event.createdAt).toLocaleTimeString(),
        type: event.level === 'success' ? 'success' : event.level === 'warning' ? 'warning' : event.level === 'error' ? 'error' : 'info',
        message: event.message
      })))
    } catch (error) {
      addLog(`引导信息加载失败: ${String((error as Error)?.message || error)}`, 'warning')
    }

    try {
      const loaded = await window.electronAPI.invoke('load-all-tokens')
      if (loaded?.success && loaded.tokens) {
        Object.entries(loaded.tokens as Record<string, AnyRecord>).forEach(([accountId, info]) => {
          upsertAccount({
            id: accountId,
            nickname: info.nickname || accountId,
            userId: info.userId || accountId,
            token: info.sessionid || info.sessionid_ss || null,
            state: 'waiting',
            actionActive: false
          })
        })
      }
    } catch (error) {
      addLog(`账号快照加载失败: ${String((error as Error)?.message || error)}`, 'error')
    }
  })

  const startAccountScanning = useEffectEvent(async (accountId: string, options: { reuseLoggedInBrowser?: boolean; tokenInfo?: AnyRecord } = {}) => {
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
        await window.electronAPI.invoke('navigate-to', { accountId, url: 'https://www.douyin.com' })
      }

      await window.electronAPI.desktop.setAccountMonitoring(accountId, true)
      patchAccount(accountId, {
        state: 'running',
        actionActive: true,
        scanRole: runtime.scanRole || 'worker'
      })
      manager.setScanConfig(settings.scanConfig)
      manager.setPoolServerConfig({ url: settings.poolServerUrl }, { silent: true })
      manager.startAccount(runtime, buildLegacyConfig(settings), {
        onStatusUpdate: (update: AnyRecord) => {
          patchAccount(accountId, {
            ...update,
            state: String(update.state || runtime.state || 'running'),
            actionActive: update.actionActive === undefined ? true : update.actionActive === true
          })
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
          startTransition(() => {
            setHistoryRecords((current) => [record, ...current].slice(0, 120))
          })
        },
        onLog: (message: string, type: UiLogEntry['type']) => addLog(message, type),
        onTokenInvalid: ({ id, reason }: { id: string; reason: string }) => {
          addLog(`账号 ${id} 登录态失效: ${reason || '需要重新扫码登录'}`, 'warning')
          patchAccount(id, { state: 'waiting', actionActive: false })
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
  })

  const stopAccount = useEffectEvent(async (accountId: string) => {
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
  })

  const startAccountWithLogin = useEffectEvent(async (accountId: string, autoStart = true) => {
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
  })

  const addAccount = useEffectEvent(() => {
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
  })

  const removeAccount = useEffectEvent(async (accountId: string) => {
    const runtime = runtimeAccountsRef.current.get(accountId)
    if (runtime) {
      manager.stopAccount(accountId)
      runtimeAccountsRef.current.delete(accountId)
    }
    stopLoginPolling(accountId)
    await window.electronAPI.desktop.setAccountMonitoring(accountId, false).catch(() => {})
    await window.electronAPI.invoke('delete-token', accountId).catch(() => {})
    startTransition(() => {
      setAccounts((current) => current.filter((item) => item.id !== accountId))
      setLotteriesByAccount((current) => {
        const next = { ...current }
        delete next[accountId]
        return next
      })
    })
  })

  const persistSettings = useEffectEvent(async (nextSettings: DesktopSettings) => {
    setSettings(nextSettings)
    manager.setScanConfig(nextSettings.scanConfig)
    manager.setPoolServerConfig({ url: nextSettings.poolServerUrl }, { silent: true })
    try {
      await window.electronAPI.desktop.saveSettings({
        ...nextSettings,
        poolServerUrl: nextSettings.poolServerUrl.trim()
      })
    } catch (_) {
      // ignore
    }
  })

  useEffect(() => {
    void bootstrapDesktop()
    manager.setScanConfig(defaultSettings.scanConfig)

    const offUpdate = window.electronAPI.desktop.onUpdateState((snapshot) => {
      setUpdateState(snapshot)
    })
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

    const summaryTimer = window.setInterval(() => {
      void refreshDispatch()
    }, 2600)
    const learningTimer = window.setInterval(() => {
      void refreshLearning()
    }, 5200)
    const licenseTimer = window.setInterval(() => {
      void refreshLicense()
    }, 3200)

    const handleBeforeUnload = () => {
      accounts.forEach((account) => stopLoginPolling(account.id))
      manager.shutdownAllAccounts()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.clearInterval(summaryTimer)
      window.clearInterval(learningTimer)
      window.clearInterval(licenseTimer)
      offUpdate()
      offBrowserClosed()
      offDouyinResponse()
      loginTimersRef.current.forEach((timer) => window.clearInterval(timer))
      loginTimersRef.current.clear()
    }
  }, [])

  useEffect(() => {
    void refreshLicense()
    void refreshDispatch()
    void refreshLearning()
  }, [settings.poolServerUrl])

  useEffect(() => {
    setAccounts((current) => current.map((account) => {
      const next = { ...account, runtimeState: deriveRuntimeState(account, license) }
      syncRuntimeRef(next)
      return next
    }))
  }, [license.accessMode, license.authorized, license.trialState])

  const runningCount = accounts.filter((account) => account.actionActive).length
  const totalWins = accounts.reduce((sum, account) => sum + Number(account.todayLotteryWinCount || 0), 0)
  const totalDiamonds = accounts.reduce((sum, account) => sum + Number(account.todayEarnedDiamonds || 0), 0)
  const totalParticipation = accounts.reduce((sum, account) => sum + Number(account.participationCount || 0), 0)
  const accessModeText = formatAccessModeText(license.accessMode)
  const updateStatusText = formatUpdateStatusText(updateState.status)
  const licensePlanText = formatLicensePlanText(license)

  async function handleStartTrial() {
    const poolServerUrl = activePoolServerUrl
    setLicenseBusy(true)
    try {
      const result = (await startLicenseTrial(poolServerUrl, {
        clientId: poolClientId,
        fingerprint: poolFingerprint,
        appVersion: bootstrap?.appVersion || '3.0.0',
        timeoutMs: 3000
      })) as ServiceResult<{ license?: AnyRecord }>
      if (!result?.ok) {
        const errorText = String(result?.data?.license?.message || result?.error || '未知错误')
        const message = `试用开启失败：${errorText}`
        setLicense((current) => ({
          ...current,
          message,
          checkedAt: Date.now()
        }))
        addLog(message, 'error')
        await refreshLicense()
        return
      }
      const nextLicense = normalizeLicenseSnapshot(result.data?.license || {})
      setLicense(nextLicense)
      addLog(nextLicense.authorized ? '试用已开启' : nextLicense.message, nextLicense.authorized ? 'success' : 'warning')
    } catch (error) {
      const errorText = String((error as Error)?.message || error || '未知错误')
      const message = `试用开启失败：${errorText}`
      setLicense((current) => ({
        ...current,
        message,
        checkedAt: Date.now()
      }))
      addLog(message, 'error')
    } finally {
      setLicenseBusy(false)
    }
  }

  async function handleActivate() {
    const poolServerUrl = activePoolServerUrl
    if (!licenseKey.trim()) {
      addLog('请输入授权码', 'warning')
      return
    }
    setLicenseBusy(true)
    try {
      const result = (await activateLicense(poolServerUrl, {
        licenseKey,
        clientId: poolClientId,
        fingerprint: poolFingerprint,
        appVersion: bootstrap?.appVersion || '3.0.0',
        currentAccounts: accounts.length,
        timeoutMs: 3000
      })) as ServiceResult<{ license?: AnyRecord }>
      if (!result?.ok) {
        const errorText = String(result?.data?.license?.message || result?.error || '未知错误')
        const message = `授权激活失败：${errorText}`
        setLicense((current) => ({
          ...current,
          message,
          checkedAt: Date.now()
        }))
        addLog(message, 'error')
        await refreshLicense()
        return
      }
      const nextLicense = normalizeLicenseSnapshot(result.data?.license || {})
      setLicense(nextLicense)
      setLicenseKey('')
      addLog(nextLicense.authorized ? '授权激活成功' : nextLicense.message, nextLicense.authorized ? 'success' : 'warning')
    } catch (error) {
      const errorText = String((error as Error)?.message || error || '未知错误')
      const message = `授权激活失败：${errorText}`
      setLicense((current) => ({
        ...current,
        message,
        checkedAt: Date.now()
      }))
      addLog(message, 'error')
    } finally {
      setLicenseBusy(false)
    }
  }

  const handleAccountWindowVisibility = useEffectEvent(async (account: AccountSession, visible: boolean) => {
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
  })

  const {
    bindBusy,
    bindSession,
    bindMiniAppCodeUrl,
    refreshBindSessionStatus
  } = useLicenseBinding({
    poolServerUrl: activePoolServerUrl,
    poolClientId,
    poolFingerprint,
    appVersion: bootstrap?.appVersion || '3.0.0',
    autoCreateEnabled: authDrawerOpen,
    onOpenAuthDrawer: () => setAuthDrawerOpen(true),
    onLicenseRefresh: refreshLicense,
    onLog: addLog
  })

  const gateLocked = license.accessMode === 'locked' && license.requiresActivation

  return (
    <div className="h-full w-full overflow-auto p-3 sm:p-4 md:p-5">
      {gateLocked ? (
        <LicenseGate
          license={license}
          licenseKey={licenseKey}
          accessModeText={accessModeText}
          serverUrl={FIXED_POOL_SERVER_URL}
          onLicenseKeyChange={setLicenseKey}
          onStartTrial={handleStartTrial}
          onActivate={handleActivate}
          busy={licenseBusy}
          clientId={poolClientId}
          fingerprint={poolFingerprint}
        />
      ) : (
        <main className="flex min-h-full flex-col gap-4 2xl:h-full 2xl:min-h-0">
          <section className="glass rounded-[26px] p-3 sm:p-4">
            <div className="flex flex-col gap-2 2xl:flex-row 2xl:items-end 2xl:justify-between">
              <div className="flex flex-col gap-1.5 2xl:pr-4">
                <h1 className="relative -top-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">抖娃福袋工作台</h1>
                <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
                  <button className="w-full rounded-full bg-emerald-400 px-4 py-2 font-semibold text-slate-950 transition hover:bg-emerald-300 sm:w-auto" onClick={addAccount}>
                    添加账号
                  </button>
                  <button className="w-full rounded-full border border-slate-600/70 px-4 py-2 transition hover:border-slate-400 hover:bg-slate-800/60 sm:w-auto" onClick={() => setSettingsOpen(true)}>
                    设置中心
                  </button>
                  <button className="w-full rounded-full border border-cyan-500/50 bg-cyan-500/10 px-4 py-2 text-cyan-100 transition hover:border-cyan-300 hover:bg-cyan-500/20 sm:w-auto" onClick={() => setAuthDrawerOpen(true)}>
                    授权中心
                  </button>
                  <button className="w-full rounded-full border border-slate-600/70 px-4 py-2 transition hover:border-slate-400 hover:bg-slate-800/60 sm:w-auto" onClick={() => void window.electronAPI.desktop.checkForUpdates()}>
                    检查更新
                  </button>
                  <span className="w-full rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 text-cyan-100 sm:w-auto">
                    {license.accessMode === 'trial' ? `试用剩余 ${formatRelative(license.trialRemainingSec)}` : license.message}
                  </span>
                  <span className="w-full rounded-full border border-slate-700 px-3 py-2 text-slate-300 sm:w-auto">
                    版本 {bootstrap?.appVersion || updateState.currentVersion}
                  </span>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">
                <StatCard label="在线账号" value={String(runningCount)} tone="emerald" helper={`${accounts.length} 个账号已接入`} />
                <StatCard label="候选可领" value={String(dispatchSummary.availableCandidates)} tone="cyan" helper={dispatchSummary.connected ? '共享池已连接' : dispatchSummary.error || '等待连接'} />
                <StatCard label="今日参与" value={String(totalParticipation)} tone="amber" helper={licensePlanText} />
                <StatCard label="今日收益" value={`${totalDiamonds}`} tone="violet" helper={`中奖 ${totalWins} 次`} />
              </div>
            </div>
          </section>

          <section className="grid gap-4 2xl:min-h-0 2xl:flex-1 2xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,420px)]">
            <div className="grid gap-4 2xl:min-h-0">
              <div className="glass rounded-[26px] p-4">
                <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
                  <ClusterBadge label="授权模式" value={accessModeText} />
                  <ClusterBadge label="更新状态" value={updateStatusText} />
                  <ClusterBadge label="候选活跃" value={String(dispatchSummary.activeCandidates)} />
                  <ClusterBadge label="候选有效" value={String(dispatchSummary.validCandidates)} />
                  <ClusterBadge label="学习桶" value={String(learningItems.length)} />
                </div>
              </div>

              <div className="glass flex flex-col rounded-[26px] p-4 2xl:min-h-0 2xl:flex-1">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">账号矩阵</h2>
                    <p className="text-sm text-slate-400">扫描账号与执行账号共用同一调度面板，默认隐藏运行。</p>
                  </div>
                  <div className="text-sm text-slate-400">{accounts.length} 个账号</div>
                </div>
                <div className="scrollbar-thin grid gap-4 overflow-auto pr-1 sm:grid-cols-2 2xl:min-h-0 2xl:flex-1 2xl:grid-cols-2">
                  {accounts.map((account) => (
                    <AccountCard
                      key={account.id}
                      account={account}
                      selected={selectedAccount?.id === account.id}
                      onSelect={() => setSelectedAccountId(account.id)}
                      onToggle={() => {
                        if (account.actionActive) {
                          void stopAccount(account.id)
                        } else {
                          void startAccountScanning(account.id)
                        }
                      }}
                      onRelogin={() => void startAccountWithLogin(account.id, true)}
                      onInspect={() => void handleAccountWindowVisibility(account, true)}
                      onHide={() => void handleAccountWindowVisibility(account, false)}
                      onDelete={() => void removeAccount(account.id)}
                    />
                  ))}
                  {accounts.length === 0 ? (
                    <div className="col-span-full flex h-56 items-center justify-center rounded-[24px] border border-dashed border-slate-700/80 bg-slate-900/40 text-center text-sm text-slate-400">
                      暂无账号。点击“添加账号”后扫码登录，桌面端会在隐藏执行池中接管账号。
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2 2xl:min-h-0 2xl:grid-cols-1">
              <TaskDetailPanel
                selectedAccount={selectedAccount}
              />
              <TimelinePanel
                logQuery={logQuery}
                logs={filteredLogs}
                logListRef={logListRef}
                onLogQueryChange={setLogQuery}
                onLogListScroll={handleLogListScroll}
              />
            </div>
          </section>
        </main>
      )}

      <SettingsDrawer
        open={settingsOpen}
        settings={settings}
        updateState={updateState}
        updateStatusText={updateStatusText}
        learningSummary={learningSummary}
        onClose={() => setSettingsOpen(false)}
        onChange={(patch) => void persistSettings({ ...settings, ...patch })}
        onNestedChange={(updater) => void persistSettings(updater(settings))}
        onInstallUpdate={() => void window.electronAPI.desktop.installUpdate()}
        onDownloadUpdate={() => void window.electronAPI.desktop.downloadUpdate()}
      />

      <LicenseDrawer
        open={authDrawerOpen}
        license={license}
        accessModeText={accessModeText}
        licenseKey={licenseKey}
        licenseBusy={licenseBusy}
        bindBusy={bindBusy}
        bindSession={bindSession}
        miniAppCodeUrl={bindMiniAppCodeUrl}
        onLicenseKeyChange={setLicenseKey}
        onStartTrial={() => void handleStartTrial()}
        onActivate={() => void handleActivate()}
        onRefreshBindStatus={() => void refreshBindSessionStatus(true)}
        onClose={() => setAuthDrawerOpen(false)}
      />
    </div>
  )
}

