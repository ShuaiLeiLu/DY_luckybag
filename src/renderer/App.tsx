import {
  startTransition,
  type ReactNode,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState
} from 'react'
import LotteryManager from '../services/LotteryManager-lite'
import {
  activateLicense,
  fetchLicenseStatus,
  resolveLicenseFingerprint,
  resolvePoolClientId,
  startLicenseTrial
} from '../services/poolClient'
import {
  createAccountModel,
  deriveRuntimeState,
  formatRelative,
  normalizeLicenseSnapshot,
  sortAccounts,
  statusText,
  statusTone
} from './lib/runtime'
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

type UiLogEntry = {
  id: number
  time: string
  type: 'info' | 'warning' | 'error' | 'success'
  message: string
}

const defaultSettings: DesktopSettings = {
  poolServerUrl: '',
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

let logSeq = 0

function buildLegacyConfig(settings: DesktopSettings) {
  return {
    stayDuration: settings.stayDuration,
    enableRedPacket: settings.enableRedPacket,
    hitRate: settings.hitRate,
    secondInspect: settings.secondInspect,
    filterFanClub: settings.filterFanClub,
    onlyPhysicalPrize: settings.onlyPhysicalPrize,
    preferBigRedPacket: settings.preferBigRedPacket,
    filterOnline: settings.filterOnline,
    randomInteraction: { enabled: settings.randomInteraction },
    closeLiveStream: { enabled: false },
    participationCount: settings.participationCount,
    singleAccountDuration: settings.singleAccountDuration,
    poolServer: { url: settings.poolServerUrl }
  }
}

function buildLogEntry(message: string, type: UiLogEntry['type'] = 'info'): UiLogEntry {
  return {
    id: ++logSeq,
    time: new Date().toLocaleTimeString(),
    type,
    message: String(message || '')
  }
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
  const [logs, setLogs] = useState<UiLogEntry[]>([])
  const [dispatchSummary, setDispatchSummary] = useState<DispatchSummary>(emptyDispatchSummary)
  const [learningSummary, setLearningSummary] = useState<AnyRecord | null>(null)
  const [learningItems, setLearningItems] = useState<AnyRecord[]>([])
  const [license, setLicense] = useState<LicenseSnapshot>(emptyLicense)
  const [updateState, setUpdateState] = useState<UpdateSnapshot>(emptyUpdate)
  const [licenseKey, setLicenseKey] = useState('')
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [logQuery, setLogQuery] = useState('')
  const [licenseBusy, setLicenseBusy] = useState(false)
  const deferredLogQuery = useDeferredValue(logQuery)

  const poolClientId = useMemo(() => resolvePoolClientId(), [])
  const poolFingerprint = useMemo(() => resolveLicenseFingerprint(), [])

  const selectedAccount = accounts.find((item) => item.id === selectedAccountId) || accounts[0] || null
  const selectedLotteries = selectedAccount ? (lotteriesByAccount[selectedAccount.id] || []) : []
  const filteredLogs = logs.filter((entry) => {
    if (!deferredLogQuery.trim()) return true
    return entry.message.toLowerCase().includes(deferredLogQuery.trim().toLowerCase())
  })

  const appendEvent = useEffectEvent(async (level: RecoveryEvent['level'], message: string, scope = 'desktop') => {
    try {
      await window.electronAPI.desktop.appendEvent({ level, message, scope })
    } catch (_) {
      // ignore
    }
  })

  const addLog = useEffectEvent((message: string, type: UiLogEntry['type'] = 'info') => {
    const entry = buildLogEntry(message, type)
    startTransition(() => {
      setLogs((current) => [...current.slice(-359), entry])
    })
    appendEvent(type === 'success' ? 'success' : type === 'warning' ? 'warning' : type === 'error' ? 'error' : 'info', message)
  })

  const syncRuntimeRef = useEffectEvent((account: AccountSession) => {
    runtimeAccountsRef.current.set(account.id, {
      ...(runtimeAccountsRef.current.get(account.id) || {}),
      ...account
    })
  })

  const patchAccount = useEffectEvent((accountId: string, patch: Partial<AccountSession>) => {
    startTransition(() => {
      setAccounts((current) => sortAccounts(current.map((item) => {
        if (item.id !== accountId) return item
        const next = {
          ...item,
          ...patch
        }
        next.runtimeState = deriveRuntimeState(next, license)
        syncRuntimeRef(next)
        return next
      })))
    })
  })

  const upsertAccount = useEffectEvent((base: Partial<AccountSession> & AnyRecord) => {
    const model = createAccountModel(base)
    model.runtimeState = deriveRuntimeState(model, license)
    startTransition(() => {
      setAccounts((current) => {
        const index = current.findIndex((item) => item.id === model.id)
        if (index >= 0) {
          const next = [...current]
          next[index] = {
            ...next[index],
            ...model
          }
          next[index].runtimeState = deriveRuntimeState(next[index], license)
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

  const refreshLicense = useEffectEvent(async () => {
    const baseUrl = settings.poolServerUrl.trim()
    if (!baseUrl) {
      setLicense({
        ...emptyLicense,
        message: '请先配置服务端地址'
      })
      return
    }
    const result = (await fetchLicenseStatus(baseUrl, {
      clientId: poolClientId,
      fingerprint: poolFingerprint,
      timeoutMs: 3000
    })) as ServiceResult<{ license?: AnyRecord }>
    if (!result?.ok) {
      setLicense({
        ...emptyLicense,
        enabled: true,
        available: false,
        accessMode: 'locked',
        requiresActivation: true,
        state: 'backend_unavailable',
        message: `授权服务不可用: ${String(result?.error || 'unknown')}`,
        checkedAt: Date.now()
      })
      return
    }
    setLicense(normalizeLicenseSnapshot(result.data?.license || {}))
  })

  const refreshDispatch = useEffectEvent(async () => {
    if (!settings.poolServerUrl.trim()) {
      setDispatchSummary(emptyDispatchSummary)
      return
    }
    manager.setPoolServerConfig({ url: settings.poolServerUrl }, { silent: true })
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
    if (!settings.poolServerUrl.trim()) {
      setLearningSummary(null)
      setLearningItems([])
      return
    }
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
      startTransition(() => {
        setLogs((snapshot.events || []).map((event) => ({
          id: event.id,
          time: new Date(event.createdAt).toLocaleTimeString(),
          type: event.level === 'success' ? 'success' : event.level === 'warning' ? 'warning' : event.level === 'error' ? 'error' : 'info',
          message: event.message
        })))
      })
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
        await window.electronAPI.invoke('navigate-to', { accountId, url: 'https://live.douyin.com/' })
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
      await window.electronAPI.invoke('navigate-to', { accountId, url: 'https://live.douyin.com/' })
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

  async function handleStartTrial() {
    if (!settings.poolServerUrl.trim()) {
      addLog('请先填写服务端地址后再开始试用', 'warning')
      return
    }
    setLicenseBusy(true)
    try {
      const result = (await startLicenseTrial(settings.poolServerUrl, {
        clientId: poolClientId,
        fingerprint: poolFingerprint,
        appVersion: bootstrap?.appVersion || '3.0.0',
        timeoutMs: 3000
      })) as ServiceResult<{ license?: AnyRecord }>
      if (!result?.ok) {
        addLog(`试用开启失败: ${String(result?.error || 'unknown')}`, 'error')
        return
      }
      const nextLicense = normalizeLicenseSnapshot(result.data?.license || {})
      setLicense(nextLicense)
      addLog(nextLicense.authorized ? '设备试用已开启，完整功能已解锁 3 天' : nextLicense.message, nextLicense.authorized ? 'success' : 'warning')
    } finally {
      setLicenseBusy(false)
    }
  }

  async function handleActivate() {
    if (!settings.poolServerUrl.trim()) {
      addLog('请先填写服务端地址后再激活授权', 'warning')
      return
    }
    if (!licenseKey.trim()) {
      addLog('请输入授权码', 'warning')
      return
    }
    setLicenseBusy(true)
    try {
      const result = (await activateLicense(settings.poolServerUrl, {
        licenseKey,
        clientId: poolClientId,
        fingerprint: poolFingerprint,
        appVersion: bootstrap?.appVersion || '3.0.0',
        currentAccounts: accounts.length,
        timeoutMs: 3000
      })) as ServiceResult<{ license?: AnyRecord }>
      if (!result?.ok) {
        addLog(`授权激活失败: ${String(result?.data?.license?.message || result?.error || 'unknown')}`, 'error')
        return
      }
      const nextLicense = normalizeLicenseSnapshot(result.data?.license || {})
      setLicense(nextLicense)
      setLicenseKey('')
      addLog(nextLicense.authorized ? '授权激活成功，完整功能已解锁' : nextLicense.message, nextLicense.authorized ? 'success' : 'warning')
    } finally {
      setLicenseBusy(false)
    }
  }

  const gateLocked = license.accessMode === 'locked' && license.requiresActivation

  return (
    <div className="h-full w-full overflow-hidden p-4 md:p-5">
      {gateLocked ? (
        <LicenseGate
          poolServerUrl={settings.poolServerUrl}
          onPoolServerUrlChange={(value) => void persistSettings({ ...settings, poolServerUrl: value })}
          license={license}
          licenseKey={licenseKey}
          onLicenseKeyChange={setLicenseKey}
          onStartTrial={handleStartTrial}
          onActivate={handleActivate}
          busy={licenseBusy}
          clientId={poolClientId}
          fingerprint={poolFingerprint}
        />
      ) : (
        <main className="flex h-full min-h-0 flex-col gap-4">
          <section className="glass rounded-[28px] p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-3 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200">
                  Hidden Execution Pool
                </div>
                <div>
                  <h1 className="text-3xl font-semibold tracking-tight text-white">抖娃福袋工作台</h1>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                    服务端统一派单，本地执行账号默认隐藏运行。你现在看到的是新的调度台壳层，适合几十账号同时在线的高密度场景。
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-4">
                <StatCard label="在线账号" value={String(runningCount)} tone="emerald" helper={`${accounts.length} 个账号已接入`} />
                <StatCard label="候选可领" value={String(dispatchSummary.availableCandidates)} tone="cyan" helper={dispatchSummary.connected ? '共享池已连接' : dispatchSummary.error || '等待连接'} />
                <StatCard label="今日参与" value={String(totalParticipation)} tone="amber" helper={license.licensePlan || '未授权'} />
                <StatCard label="今日收益" value={`${totalDiamonds}`} tone="violet" helper={`中奖 ${totalWins} 次`} />
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-slate-300">
              <button className="rounded-full bg-emerald-400 px-4 py-2 font-semibold text-slate-950 transition hover:bg-emerald-300" onClick={addAccount}>
                添加账号
              </button>
              <button className="rounded-full border border-slate-600/70 px-4 py-2 transition hover:border-slate-400 hover:bg-slate-800/60" onClick={() => setSettingsOpen(true)}>
                设置中心
              </button>
              <button className="rounded-full border border-slate-600/70 px-4 py-2 transition hover:border-slate-400 hover:bg-slate-800/60" onClick={() => void window.electronAPI.desktop.checkForUpdates()}>
                检查更新
              </button>
              <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 text-cyan-100">
                {license.accessMode === 'trial' ? `试用剩余 ${formatRelative(license.trialRemainingSec)}` : license.message}
              </span>
              <span className="rounded-full border border-slate-700 px-3 py-2 text-slate-300">
                版本 {bootstrap?.appVersion || updateState.currentVersion}
              </span>
            </div>
          </section>

          <section className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_420px]">
            <div className="grid min-h-0 gap-4">
              <div className="glass rounded-[26px] p-4">
                <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
                  <ClusterBadge label="授权模式" value={license.accessMode} />
                  <ClusterBadge label="更新状态" value={updateState.status} />
                  <ClusterBadge label="候选活跃" value={String(dispatchSummary.activeCandidates)} />
                  <ClusterBadge label="候选有效" value={String(dispatchSummary.validCandidates)} />
                  <ClusterBadge label="学习桶" value={String(learningItems.length)} />
                </div>
              </div>

              <div className="glass flex min-h-0 flex-1 flex-col rounded-[26px] p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">账号矩阵</h2>
                    <p className="text-sm text-slate-400">扫描账号与执行账号共用同一调度面板，默认隐藏运行。</p>
                  </div>
                  <div className="text-sm text-slate-400">{accounts.length} 个账号</div>
                </div>
                <div className="scrollbar-thin grid min-h-0 flex-1 gap-4 overflow-auto pr-1 md:grid-cols-2 2xl:grid-cols-3">
                  {accounts.map((account) => (
                    <AccountCard
                      key={account.id}
                      account={account}
                      topLotteries={(lotteriesByAccount[account.id] || []).slice(0, 3)}
                      selected={selectedAccount?.id === account.id}
                      onSelect={() => setSelectedAccountId(account.id)}
                      onRoleChange={(value) => {
                        patchAccount(account.id, { scanRole: value })
                        const runtime = runtimeAccountsRef.current.get(account.id)
                        if (runtime) runtime.scanRole = value
                      }}
                      onToggle={() => {
                        if (account.actionActive) {
                          void stopAccount(account.id)
                        } else {
                          void startAccountScanning(account.id)
                        }
                      }}
                      onRelogin={() => void startAccountWithLogin(account.id, true)}
                      onInspect={() => void window.electronAPI.desktop.showAccountWindow(account.id)}
                      onHide={() => void window.electronAPI.desktop.hideAccountWindow(account.id)}
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

            <div className="grid min-h-0 gap-4">
              <aside className="glass flex min-h-0 flex-col rounded-[26px] p-4">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-white">任务详情</h2>
                  <p className="text-sm text-slate-400">选中账号后查看当前租约、候选池和派单细节。</p>
                </div>
                <div className="space-y-3">
                  <DetailRow label="账号" value={selectedAccount?.nickname || '未选择'} />
                  <DetailRow label="角色" value={selectedAccount?.scanRole || '-'} />
                  <DetailRow label="状态" value={selectedAccount ? statusText(selectedAccount.runtimeState) : '-'} />
                  <DetailRow label="当前任务" value={selectedAccount?.currentTaskLotteryName || selectedAccount?.currentTaskLabel || '暂无'} />
                  <DetailRow label="主播" value={selectedAccount?.currentTaskAnchor || '-'} />
                  <DetailRow label="租约剩余" value={selectedAccount?.currentTaskLeaseRemainingSec ? formatRelative(selectedAccount.currentTaskLeaseRemainingSec) : '-'} />
                </div>

                <div className="mt-4">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">候选样本</div>
                  <div className="scrollbar-thin max-h-72 space-y-2 overflow-auto pr-1">
                    {selectedLotteries.map((item, index) => (
                      <div key={`${item.roomId || item.webRid || 'room'}-${item.lottery_id || item.lotteryId || index}`} className="rounded-2xl border border-slate-700/70 bg-slate-900/50 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-medium text-white">{item.lotteryName || item.prize_name || '未命名福袋'}</div>
                            <div className="mt-1 text-xs text-slate-400">{item.authorNickname || item.roomTitle || '未知主播'}</div>
                          </div>
                          <div className="text-right text-xs text-cyan-200">
                            <div>{Number(item.simpleProbability || item.predictedProbability || 0).toFixed(2)}%</div>
                            <div className="mt-1 text-slate-500">#{index + 1}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {selectedLotteries.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-700/80 p-4 text-sm text-slate-500">
                        当前账号还没有候选池样本。
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">最近回放</div>
                  <div className="scrollbar-thin max-h-44 space-y-2 overflow-auto pr-1">
                    {historyRecords.slice(0, 8).map((item, index) => (
                      <div key={`${item.accountId || selectedAccount?.id || 'history'}-${index}`} className="rounded-2xl border border-slate-700/70 bg-slate-900/50 p-3 text-sm text-slate-300">
                        <div className="font-medium text-white">{item.lotteryName || '已参与任务'}</div>
                        <div className="mt-1 text-xs text-slate-500">{item.authorNickname || item.nickname || '未知主播'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </aside>

              <aside className="glass flex min-h-0 flex-col rounded-[26px] p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-white">运行时间线</h2>
                    <p className="text-sm text-slate-400">这里保留执行过程、异常恢复和授权更新。</p>
                  </div>
                  <input
                    value={logQuery}
                    onChange={(event) => setLogQuery(event.target.value)}
                    placeholder="筛选日志"
                    className="w-32 rounded-full border border-slate-700/80 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-400/60"
                  />
                </div>
                <div className="scrollbar-thin flex-1 space-y-2 overflow-auto pr-1">
                  {filteredLogs.map((entry) => (
                    <div key={entry.id} className="rounded-2xl border border-slate-700/70 bg-slate-950/55 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className={`rounded-full border px-2 py-1 text-[11px] uppercase tracking-[0.18em] ${
                          entry.type === 'success'
                            ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
                            : entry.type === 'warning'
                              ? 'border-amber-400/20 bg-amber-500/10 text-amber-200'
                              : entry.type === 'error'
                                ? 'border-rose-400/20 bg-rose-500/10 text-rose-200'
                                : 'border-slate-400/20 bg-slate-500/10 text-slate-200'
                        }`}>
                          {entry.type}
                        </span>
                        <span className="text-xs text-slate-500">{entry.time}</span>
                      </div>
                      <div className="mt-2 text-sm leading-6 text-slate-200">{entry.message}</div>
                    </div>
                  ))}
                </div>
              </aside>
            </div>
          </section>
        </main>
      )}

      <SettingsDrawer
        open={settingsOpen}
        settings={settings}
        updateState={updateState}
        learningSummary={learningSummary}
        onClose={() => setSettingsOpen(false)}
        onChange={(patch) => void persistSettings({ ...settings, ...patch })}
        onNestedChange={(updater) => void persistSettings(updater(settings))}
        onInstallUpdate={() => void window.electronAPI.desktop.installUpdate()}
        onDownloadUpdate={() => void window.electronAPI.desktop.downloadUpdate()}
      />
    </div>
  )
}

function StatCard(props: { label: string; value: string; helper: string; tone: 'emerald' | 'cyan' | 'amber' | 'violet' }) {
  const toneMap = {
    emerald: 'from-emerald-400/20 to-emerald-500/5 border-emerald-300/20 text-emerald-100',
    cyan: 'from-cyan-400/20 to-cyan-500/5 border-cyan-300/20 text-cyan-100',
    amber: 'from-amber-300/20 to-amber-500/5 border-amber-300/20 text-amber-100',
    violet: 'from-violet-400/20 to-violet-500/5 border-violet-300/20 text-violet-100'
  }
  return (
    <div className={`min-w-[160px] rounded-[22px] border bg-gradient-to-br px-4 py-3 ${toneMap[props.tone]}`}>
      <div className="text-xs uppercase tracking-[0.24em] text-slate-400">{props.label}</div>
      <div className="mt-2 text-3xl font-semibold text-white">{props.value}</div>
      <div className="mt-1 text-xs text-slate-400">{props.helper}</div>
    </div>
  )
}

function ClusterBadge(props: { label: string; value: string }) {
  return (
    <div className="rounded-full border border-slate-700/80 bg-slate-950/45 px-3 py-2">
      <span className="text-slate-500">{props.label}</span>
      <span className="ml-2 font-medium text-slate-100">{props.value}</span>
    </div>
  )
}

function DetailRow(props: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-700/70 bg-slate-950/45 px-3 py-3 text-sm">
      <span className="text-slate-400">{props.label}</span>
      <span className="max-w-[58%] truncate text-right text-slate-100">{props.value}</span>
    </div>
  )
}

function AccountCard(props: {
  account: AccountSession
  topLotteries: AnyRecord[]
  selected: boolean
  onSelect: () => void
  onRoleChange: (value: AccountSession['scanRole']) => void
  onToggle: () => void
  onRelogin: () => void
  onInspect: () => void
  onHide: () => void
  onDelete: () => void
}) {
  return (
    <div
      className={`rounded-[24px] border p-4 transition ${
        props.selected
          ? 'border-cyan-300/40 bg-cyan-500/10 shadow-[0_0_0_1px_rgba(34,211,238,0.16)]'
          : 'border-slate-700/80 bg-slate-950/50 hover:border-slate-500'
      }`}
    >
      <button className="w-full text-left" onClick={props.onSelect}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-base font-semibold text-white">{props.account.nickname}</div>
            <div className="mt-1 text-xs text-slate-500">{props.account.id}</div>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(props.account.runtimeState)}`}>
            {statusText(props.account.runtimeState)}
          </span>
        </div>
      </button>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <Metric label="今日参与" value={String(props.account.participationCount)} />
        <Metric label="今日收益" value={String(props.account.todayEarnedDiamonds)} />
        <Metric label="任务阶段" value={props.account.currentTaskStage || '空闲'} />
        <Metric label="租约" value={props.account.currentTaskLeaseRemainingSec ? `${props.account.currentTaskLeaseRemainingSec}s` : '-'} />
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-slate-700/80 bg-slate-950/55 px-3 py-3 text-sm">
        <span className="text-slate-400">角色</span>
        <select
          value={props.account.scanRole}
          onChange={(event) => props.onRoleChange(event.target.value as AccountSession['scanRole'])}
          className="rounded-full border border-slate-700/80 bg-slate-900 px-3 py-2 text-slate-100 outline-none"
        >
          <option value="scanner">Scanner</option>
          <option value="worker">Worker</option>
        </select>
      </div>

      <div className="mt-4 space-y-2">
        {props.topLotteries.length > 0 ? props.topLotteries.map((item, index) => (
          <div key={`${props.account.id}-${index}`} className="rounded-2xl border border-slate-700/70 bg-slate-950/45 px-3 py-2 text-sm text-slate-300">
            <div className="truncate text-white">{item.lotteryName || item.prize_name || '候选任务'}</div>
            <div className="mt-1 truncate text-xs text-slate-500">{item.authorNickname || '未知主播'}</div>
          </div>
        )) : (
          <div className="rounded-2xl border border-dashed border-slate-700/80 px-3 py-4 text-sm text-slate-500">
            当前还没有候选样本。
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <button className="rounded-full bg-emerald-400 px-3 py-2 font-semibold text-slate-950 transition hover:bg-emerald-300" onClick={props.onToggle}>
          {props.account.actionActive ? '暂停' : '启动'}
        </button>
        <button className="rounded-full border border-slate-600/80 px-3 py-2 text-slate-100 transition hover:bg-slate-800/60" onClick={props.onRelogin}>
          重新扫码
        </button>
        <button className="rounded-full border border-slate-600/80 px-3 py-2 text-slate-100 transition hover:bg-slate-800/60" onClick={props.onInspect}>
          显示窗口
        </button>
        <button className="rounded-full border border-slate-600/80 px-3 py-2 text-slate-100 transition hover:bg-slate-800/60" onClick={props.onHide}>
          隐藏窗口
        </button>
      </div>
      <button className="mt-2 w-full rounded-full border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200 transition hover:bg-rose-500/20" onClick={props.onDelete}>
        删除账号
      </button>
    </div>
  )
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/45 px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{props.label}</div>
      <div className="mt-2 truncate text-lg font-semibold text-white">{props.value}</div>
    </div>
  )
}

function LicenseGate(props: {
  poolServerUrl: string
  onPoolServerUrlChange: (value: string) => void
  license: LicenseSnapshot
  licenseKey: string
  onLicenseKeyChange: (value: string) => void
  onStartTrial: () => void
  onActivate: () => void
  busy: boolean
  clientId: string
  fingerprint: string
}) {
  return (
    <div className="grid h-full gap-4 xl:grid-cols-[minmax(0,1.2fr)_460px]">
      <section className="glass flex min-h-[320px] flex-col justify-between rounded-[32px] p-8">
        <div>
          <div className="inline-flex items-center gap-3 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100">
            Service Dispatch Edition
          </div>
          <h1 className="mt-6 max-w-xl text-4xl font-semibold leading-tight text-white">
            3 天设备试用 + 正式授权
            <br />
            进入新的桌面调度台
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
            当前版本采用服务端统一派单、客户端隐藏执行池和高密度账号调度面板。试用期内完整开放，多账号、派单、执行和学习视图都可以直接体验。
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <FeaturePanel title="服务端派单" description="候选池统一筛选，客户端只管执行和回传。" />
          <FeaturePanel title="隐藏执行池" description="几十账号默认隐藏运行，人工检查时再拉起窗口。" />
          <FeaturePanel title="授权状态机" description="试用、激活、过期和锁定全部由服务端状态驱动。" />
        </div>
      </section>

      <section className="glass flex flex-col rounded-[32px] p-6">
        <div>
          <h2 className="text-2xl font-semibold text-white">设备接入</h2>
          <p className="mt-2 text-sm text-slate-400">{props.license.message || '请先开始试用或输入授权码。'}</p>
        </div>

        <label className="mt-6 text-xs uppercase tracking-[0.2em] text-slate-500">服务端地址</label>
        <input
          value={props.poolServerUrl}
          onChange={(event) => props.onPoolServerUrlChange(event.target.value)}
          className="mt-2 rounded-2xl border border-slate-700/80 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-400/70"
          placeholder="http://127.0.0.1:9090"
        />

        <div className="mt-4 grid gap-3 text-sm text-slate-300">
          <DeviceField label="Client ID" value={props.clientId} />
          <DeviceField label="Fingerprint" value={props.fingerprint} />
          <DeviceField label="Access Mode" value={props.license.accessMode} />
        </div>

        <div className="mt-6 rounded-[24px] border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          <div className="font-semibold">试用说明</div>
          <div className="mt-1 text-amber-100/80">每台设备首次安装可获得 3 天完整试用。试用结束后需要正式授权才能进入主调度台。</div>
        </div>

        <button
          className="mt-5 rounded-2xl bg-emerald-400 px-4 py-3 font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={props.busy}
          onClick={props.onStartTrial}
        >
          {props.busy ? '处理中...' : '开始 3 天试用'}
        </button>

        <label className="mt-6 text-xs uppercase tracking-[0.2em] text-slate-500">授权码</label>
        <input
          value={props.licenseKey}
          onChange={(event) => props.onLicenseKeyChange(event.target.value)}
          className="mt-2 rounded-2xl border border-slate-700/80 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-400/70"
          placeholder="输入正式授权码"
        />
        <button
          className="mt-4 rounded-2xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-3 font-semibold text-cyan-100 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={props.busy}
          onClick={props.onActivate}
        >
          {props.busy ? '处理中...' : '激活正式授权'}
        </button>
      </section>
    </div>
  )
}

function FeaturePanel(props: { title: string; description: string }) {
  return (
    <div className="rounded-[24px] border border-slate-700/70 bg-slate-950/55 p-4">
      <div className="text-sm font-semibold text-white">{props.title}</div>
      <div className="mt-2 text-sm leading-6 text-slate-400">{props.description}</div>
    </div>
  )
}

function DeviceField(props: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/55 px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{props.label}</div>
      <div className="mt-2 break-all text-sm text-slate-100">{props.value || '-'}</div>
    </div>
  )
}

function SettingsDrawer(props: {
  open: boolean
  settings: DesktopSettings
  updateState: UpdateSnapshot
  learningSummary: AnyRecord | null
  onClose: () => void
  onChange: (patch: Partial<DesktopSettings>) => void
  onNestedChange: (updater: (settings: DesktopSettings) => DesktopSettings) => void
  onInstallUpdate: () => void
  onDownloadUpdate: () => void
}) {
  return (
    <div className={`pointer-events-none fixed inset-y-4 right-4 z-20 w-[380px] transition duration-300 ${props.open ? 'translate-x-0 opacity-100' : 'translate-x-[110%] opacity-0'}`}>
      <div className="glass pointer-events-auto flex h-full flex-col rounded-[30px] p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">设置中心</h2>
            <p className="mt-1 text-sm text-slate-400">修改服务端、筛选阈值和更新通道。</p>
          </div>
          <button className="rounded-full border border-slate-700/80 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800/60" onClick={props.onClose}>
            关闭
          </button>
        </div>

        <div className="scrollbar-thin mt-5 flex-1 space-y-5 overflow-auto pr-1">
          <Panel title="服务端">
            <Input label="Pool Server URL" value={props.settings.poolServerUrl} onChange={(value) => props.onChange({ poolServerUrl: value })} />
            <Input label="Update Feed URL" value={props.settings.updateFeedUrl} onChange={(value) => props.onChange({ updateFeedUrl: value })} />
          </Panel>

          <Panel title="筛选">
            <SwitchRow
              label="过滤粉丝团"
              checked={props.settings.filterFanClub.enabled}
              onChange={(checked) => props.onNestedChange((settings) => ({ ...settings, filterFanClub: { enabled: checked } }))}
            />
            <SwitchRow
              label="只抢实物"
              checked={props.settings.onlyPhysicalPrize.enabled}
              onChange={(checked) => props.onNestedChange((settings) => ({ ...settings, onlyPhysicalPrize: { enabled: checked } }))}
            />
            <SwitchRow
              label="优先大红包"
              checked={props.settings.preferBigRedPacket.enabled}
              onChange={(checked) => props.onNestedChange((settings) => ({
                ...settings,
                preferBigRedPacket: { ...settings.preferBigRedPacket, enabled: checked }
              }))}
            />
            <RangeInput
              label="大红包阈值"
              value={String(props.settings.preferBigRedPacket.threshold)}
              onChange={(value) => props.onNestedChange((settings) => ({
                ...settings,
                preferBigRedPacket: {
                  ...settings.preferBigRedPacket,
                  threshold: Number(value || 40)
                }
              }))}
            />
            <RangeInput
              label="命中率下限"
              value={String(props.settings.hitRate.value)}
              onChange={(value) => props.onNestedChange((settings) => ({
                ...settings,
                hitRate: {
                  ...settings.hitRate,
                  value: Number(value || 0.08)
                }
              }))}
            />
          </Panel>

          <Panel title="执行">
            <SwitchRow
              label="自动抢红包"
              checked={props.settings.enableRedPacket}
              onChange={(checked) => props.onChange({ enableRedPacket: checked })}
            />
            <SwitchRow
              label="随机互动"
              checked={props.settings.randomInteraction}
              onChange={(checked) => props.onChange({ randomInteraction: checked })}
            />
            <RangeInput
              label="抢后停留（秒）"
              value={String(props.settings.stayDuration)}
              onChange={(value) => props.onChange({ stayDuration: Number(value || 18) })}
            />
          </Panel>

          <Panel title="更新与学习">
            <DetailRow label="更新状态" value={props.updateState.status} />
            <DetailRow label="当前版本" value={props.updateState.currentVersion} />
            <DetailRow label="最新版本" value={props.updateState.latestVersion || '-'} />
            <DetailRow label="学习反馈数" value={String(props.learningSummary?.feedbackCount || 0)} />
            <div className="grid grid-cols-2 gap-2">
              <button className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-3 text-sm text-cyan-100 transition hover:bg-cyan-500/20" onClick={props.onDownloadUpdate}>
                下载更新
              </button>
              <button className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-100 transition hover:bg-emerald-500/20" onClick={props.onInstallUpdate}>
                安装更新
              </button>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}

function Panel(props: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[24px] border border-slate-700/70 bg-slate-950/55 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">{props.title}</h3>
      <div className="mt-4 space-y-3">{props.children}</div>
    </section>
  )
}

function Input(props: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <div className="mb-2 text-xs uppercase tracking-[0.16em] text-slate-500">{props.label}</div>
      <input
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className="w-full rounded-2xl border border-slate-700/80 bg-slate-900/80 px-3 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-400/60"
      />
    </label>
  )
}

function RangeInput(props: { label: string; value: string; onChange: (value: string) => void }) {
  return <Input {...props} />
}

function SwitchRow(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      className="flex w-full items-center justify-between rounded-2xl border border-slate-700/80 bg-slate-900/80 px-3 py-3 text-sm text-slate-200 transition hover:border-slate-500"
      onClick={() => props.onChange(!props.checked)}
    >
      <span>{props.label}</span>
      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${props.checked ? 'bg-emerald-400 text-slate-950' : 'bg-slate-700 text-slate-200'}`}>
        {props.checked ? 'ON' : 'OFF'}
      </span>
    </button>
  )
}
