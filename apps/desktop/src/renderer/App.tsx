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
  normalizePoolServerUrl,
  resolveLicenseFingerprint,
  resolvePoolClientId,
  uploadLotteryHistoryRecord
} from '../services/poolClient'
import {
  deriveRuntimeState,
  formatRelative,
  mergeAccountModel,
  sortAccounts
} from './lib/runtime'
import { AccountCard } from './features/accounts/AccountCard'
import { buildLegacyConfig } from './features/accounts/legacyConfig'
import { DOUYIN_LOGIN_PROMPT_SCRIPT } from './features/accounts/loginPrompt'
import { LicenseGate } from './features/license/LicenseGate'
import { formatHotUpdateStatusText, formatUpdateStatusText } from './features/license/presentation'
import { useLicenseBinding } from './features/license/useLicenseBinding'
import { useAdaptivePolling } from './hooks/useAdaptivePolling'
import { useAccountSelection } from './hooks/useAccountSelection'
import { SettingsDrawer } from './features/settings/SettingsDrawer'
import { TaskDetailPanel } from './features/dashboard/TaskDetailPanel'
import { TimelinePanel } from './features/dashboard/TimelinePanel'
import { LotteryListPanel } from './features/dashboard/LotteryListPanel'
import { HistoryPanel } from './features/history/HistoryPanel'
import { type UiLogEntry, useTimelineLogs } from './features/dashboard/useTimelineLogs'
import { useAccountLifecycle } from './features/accounts/useAccountLifecycle'
import type {
  AccountSession,
  BootstrapSnapshot,
  DesktopSettings,
  DispatchSummary,
  LicenseSnapshot,
  LotteryHistoryRecord,
  UpdateSnapshot
} from '@shared/models'
import { DEFAULT_DESKTOP_SETTINGS } from '@shared/defaultSettings'
import { useLicenseNotice } from './hooks/useLicenseNotice'
import { emptyHotUpdate, emptyUpdate } from './lib/defaultSnapshots'

type AnyRecord = Record<string, any>
type ServiceResult<T = AnyRecord> = {
  ok?: boolean
  data?: T
  error?: unknown
}

type MainView = 'dashboard' | 'accounts' | 'history' | 'logs'


const defaultSettings: DesktopSettings = { ...DEFAULT_DESKTOP_SETTINGS }

const emptyDispatchSummary: DispatchSummary = {
  enabled: false,
  connected: false,
  activeCandidates: 0,
  validCandidates: 0,
  availableCandidates: 0,
  updatedAt: 0
}



function mapHotUpdateToInstallerStatus(status: string): UpdateSnapshot['status'] {
  const key = String(status || '').trim().toLowerCase()
  if (!key || key === 'disabled') return 'disabled'
  if (key.includes('checking')) return 'checking'
  if (key.includes('downloading')) return 'downloading'
  if (key.includes('applied') || key.includes('ready')) return 'downloaded'
  if (key.includes('error') || key.includes('failed')) return 'error'
  return 'idle'
}

function simplifyRuntimeLogMessage(message: string) {
  const raw = String(message || '').trim()
  if (!raw) return { keep: false, message: '' }

  const hiddenPatterns = [
    /^━━━━━━━━/,
    /^排序说明/,
    /^•/,
    /^   /,
    /^等待开奖随机弹幕:/,
    /^等待开奖阶段已启用随机弹幕互动$/,
    /^抢后停留期间优先扫描后续福袋/
  ]
  if (hiddenPatterns.some((pattern) => pattern.test(raw))) {
    return { keep: false, message: '' }
  }

  const replaced = raw
    .replace(/^选择目标福袋:\s*/, '选择目标福袋：')
    .replace(/^选择最优福袋:\s*/, '选择最优福袋：')
    .replace(/^正在进入目标直播间\.\.\.$/, '正在进入目标直播间')
    .replace(/^已进入直播间，等待福袋入口并立即执行参与\.\.\.$/, '已进入直播间，准备参与福袋')

  return { keep: true, message: replaced }
}

function buildRuntimeLogDedupKey(message: string) {
  const secMatch = message.match(/剩余(\d+)秒/)
  if (secMatch) {
    const sec = Number(secMatch[1] || 0)
    if (sec > 10 && sec % 10 !== 0) {
      return `countdown:${Math.floor(sec / 10) * 10}`
    }
  }
  return message
}

function buildAnnouncementPreview(markdown: string) {
  return String(markdown || '')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
    .replace(/[*_`#>-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}


export default function App() {
  const manager = useMemo(() => new LotteryManager(), [])
  const runtimeAccountsRef = useRef<Map<string, AnyRecord>>(new Map())
  const loginTimersRef = useRef<Map<string, number>>(new Map())
  const [bootstrap, setBootstrap] = useState<BootstrapSnapshot | null>(null)
  const [settings, setSettings] = useState<DesktopSettings>(defaultSettings)
  const [accounts, setAccounts] = useState<AccountSession[]>([])
  const [lotteriesByAccount, setLotteriesByAccount] = useState<Record<string, AnyRecord[]>>({})
  const [historyRecords, setHistoryRecords] = useState<LotteryHistoryRecord[]>([])
  const [dispatchSummary, setDispatchSummary] = useState<DispatchSummary>(emptyDispatchSummary)
  const [learningSummary, setLearningSummary] = useState<AnyRecord | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [activeView, setActiveView] = useState<MainView>('dashboard')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [forceShowMainWhenLocked, setForceShowMainWhenLocked] = useState(false)
  const [manualShowLicenseGate, setManualShowLicenseGate] = useState(false)
  const lastRuntimeLogRef = useRef<Map<string, { key: string; at: number }>>(new Map())
  const {
    logs,
    logListRef,
    handleLogListScroll,
    addLog
  } = useTimelineLogs()

  const appendAccountLog = useEffectEvent(async (
    accountId: string,
    message: string,
    type: UiLogEntry['type'] = 'info'
  ) => {
    const normalizedId = String(accountId || '').trim()
    const normalizedMessage = String(message || '').trim()
    if (!normalizedId || !normalizedMessage) return
    const level = type === 'success'
      ? 'success'
      : type === 'warning'
        ? 'warning'
        : type === 'error'
          ? 'error'
          : 'info'
    try {
      await window.electronAPI.desktop.appendAccountLog({
        accountId: normalizedId,
        level,
        message: normalizedMessage,
        scope: 'desktop'
      })
    } catch (_) {
      // Ignore account log persistence failures to avoid blocking runtime flow.
    }
  })

  const handleRuntimeLog = (accountId: string, message: string, type: UiLogEntry['type']) => {
    const simplified = simplifyRuntimeLogMessage(message)
    if (!simplified.keep) return false
    const dedupKey = buildRuntimeLogDedupKey(simplified.message)
    const now = Date.now()
    const prev = lastRuntimeLogRef.current.get(accountId)
    if (prev && prev.key === dedupKey && now - prev.at < 2200) {
      return false
    }
    lastRuntimeLogRef.current.set(accountId, { key: dedupKey, at: now })
    addLog(simplified.message, type)
    return true
  }

  const poolClientId = useMemo(() => resolvePoolClientId(), [])
  const activePoolServerUrl = useMemo(() => {
    return normalizePoolServerUrl(settings.poolServerUrl) || FIXED_POOL_SERVER_URL
  }, [settings.poolServerUrl])
  const poolFingerprint = useMemo(() => resolveLicenseFingerprint(), [])

  const {
    license,
    licenseKey,
    licenseBusy,
    announcementMarkdown,
    updateState,
    hotUpdateState,
    refreshLicense,
    handleStartTrial,
    handleActivate,
    setLicenseKey,
    setUpdateState,
    setHotUpdateState
  } = useLicenseNotice({
    poolServerUrl: activePoolServerUrl,
    poolClientId,
    poolFingerprint,
    appVersion: bootstrap?.appVersion || '3.0.0',
    onLog: addLog,
    getCurrentAccounts: () => accounts.length
  })

  const selectedAccount = accounts.find((item) => item.id === selectedAccountId) || accounts[0] || null
  const syncRuntimeRef = (account: AccountSession) => {
    runtimeAccountsRef.current.set(account.id, {
      ...(runtimeAccountsRef.current.get(account.id) || {}),
      ...account
    })
  }
  const persistHistoryRecord = useEffectEvent(async (record: Partial<LotteryHistoryRecord> & AnyRecord) => {
    const rewardAmount = Number(record.rewardAmount || 0)
    const recordType: LotteryHistoryRecord['recordType'] = record.recordType === 'win' || String(record.resultStatus || '').trim().toLowerCase() === 'won' || rewardAmount > 0
      ? 'win'
      : 'join'
    const createdAt = Number(record.createdAt || record.joinedAt || Date.now())
    const normalizedRecord: Partial<LotteryHistoryRecord> = {
      ...record,
      recordType,
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now()
    }

    try {
      const saved = await window.electronAPI.desktop.appendHistoryRecord(normalizedRecord)
      const nextRecord = saved?.item || normalizedRecord
      void uploadLotteryHistoryRecord(activePoolServerUrl, {
        localHistoryId: Number(nextRecord?.id || normalizedRecord.id || 0),
        recordType: String(nextRecord?.recordType || normalizedRecord.recordType || ''),
        clientId: poolClientId,
        fingerprint: poolFingerprint,
        appVersion: String(bootstrap?.appVersion || ''),
        accountId: String(nextRecord?.accountId || normalizedRecord.accountId || ''),
        accountNickname: String(nextRecord?.accountNickname || normalizedRecord.accountNickname || ''),
        roomId: String(nextRecord?.roomId || normalizedRecord.roomId || ''),
        webRid: String(nextRecord?.webRid || normalizedRecord.webRid || ''),
        lotteryId: String(nextRecord?.lotteryId || normalizedRecord.lotteryId || ''),
        authorNickname: String(nextRecord?.authorNickname || normalizedRecord.authorNickname || ''),
        lotteryName: String(nextRecord?.lotteryName || normalizedRecord.lotteryName || ''),
        predictedProbability: Number(nextRecord?.predictedProbability || normalizedRecord.predictedProbability || 0),
        predictedJoinTotal: Number(nextRecord?.predictedJoinTotal || normalizedRecord.predictedJoinTotal || 0),
        joinTotal: Number(nextRecord?.joinTotal || normalizedRecord.joinTotal || 0),
        luckyCount: Number(nextRecord?.luckyCount || normalizedRecord.luckyCount || 0),
        onlineTotal: Number(nextRecord?.onlineTotal || normalizedRecord.onlineTotal || 0),
        totalAmount: Number(nextRecord?.totalAmount || normalizedRecord.totalAmount || 0),
        prizeType: nextRecord?.prizeType ?? normalizedRecord.prizeType ?? null,
        prizeInfo: (nextRecord?.prizeInfo || normalizedRecord.prizeInfo || {}) as Record<string, unknown>,
        conditions: Array.isArray(nextRecord?.conditions) ? nextRecord.conditions : (Array.isArray(normalizedRecord.conditions) ? normalizedRecord.conditions : []),
        remainingSec: Number(nextRecord?.remainingSec || normalizedRecord.remainingSec || 0),
        serverScore: Number(nextRecord?.serverScore || normalizedRecord.serverScore || 0),
        startTime: Number(nextRecord?.startTime || normalizedRecord.startTime || 0),
        joinMode: String(nextRecord?.joinMode || normalizedRecord.joinMode || ''),
        joinStatus: String(nextRecord?.joinStatus || normalizedRecord.joinStatus || ''),
        resultStatus: String(nextRecord?.resultStatus || normalizedRecord.resultStatus || ''),
        resultReason: String(nextRecord?.resultReason || normalizedRecord.resultReason || ''),
        joinedAt: Number(nextRecord?.joinedAt || normalizedRecord.joinedAt || 0),
        endTime: Number(nextRecord?.endTime || normalizedRecord.endTime || 0),
        rewardAmount: Number(nextRecord?.rewardAmount || normalizedRecord.rewardAmount || 0),
        createdAt: Number(nextRecord?.createdAt || normalizedRecord.createdAt || 0)
      }).catch(() => {})
      startTransition(() => {
        setHistoryRecords((current) => [nextRecord as LotteryHistoryRecord, ...current].slice(0, 240))
      })
    } catch (_) {
      startTransition(() => {
        setHistoryRecords((current) => [normalizedRecord as LotteryHistoryRecord, ...current].slice(0, 240))
      })
    }
  })

  const {
    patchAccount,
    upsertAccount,
    startAccountScanning,
    stopAccount,
    startAccountWithLogin,
    addAccount,
    removeAccount,
    stopLoginPolling
  } = useAccountLifecycle({
    accounts,
    settings,
    license,
    manager,
    activePoolServerUrl,
    addLog,
    onRuntimeLog: handleRuntimeLog,
    appendAccountLog,
    persistHistoryRecord,
    setAccounts,
    setLotteriesByAccount,
    setHistoryRecords,
    setDispatchSummary,
    runtimeAccountsRef,
    loginTimersRef
  })

  const refreshDispatch = useEffectEvent(async () => {
    manager.setPoolServerConfig({ url: activePoolServerUrl }, { silent: true })
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
    }>
    if (!result?.ok) return
    setLearningSummary(result.data?.summary || null)
  })

  const bootstrapDesktop = useEffectEvent(async () => {
    try {
      const snapshot = await window.electronAPI.desktop.getBootstrap()
      const snapshotPoolServerUrl = normalizePoolServerUrl(snapshot?.settings?.poolServerUrl) || FIXED_POOL_SERVER_URL
      const snapshotSettings = { ...(snapshot?.settings || {}) } as AnyRecord
      delete snapshotSettings.noticeMarkdown
      setBootstrap(snapshot)
      setSettings({
        ...defaultSettings,
        ...snapshotSettings,
        poolServerUrl: snapshotPoolServerUrl
      })
      setUpdateState(snapshot.update || emptyUpdate)
      const hotSnapshot = await window.electronAPI.desktop.getHotUpdateState().catch(() => null)
      if (hotSnapshot && typeof hotSnapshot === 'object') {
        setHotUpdateState({
          ...emptyHotUpdate,
          ...hotSnapshot
        })
      }
      setHistoryRecords(Array.isArray(snapshot.historyRecords) ? snapshot.historyRecords : [])
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

  const persistSettings = useEffectEvent(async (nextSettings: DesktopSettings) => {
    const normalizedSettings: DesktopSettings = {
      ...nextSettings,
      poolServerUrl: normalizePoolServerUrl(nextSettings.poolServerUrl) || FIXED_POOL_SERVER_URL
    }
    setSettings(normalizedSettings)
    manager.setScanConfig(normalizedSettings.scanConfig)
    manager.setPoolServerConfig({ url: normalizedSettings.poolServerUrl }, { silent: true })
    try {
      await window.electronAPI.desktop.saveSettings(normalizedSettings)
    } catch (_) {
      // ignore
    }
  })

  useEffect(() => {
    void bootstrapDesktop()
    manager.setScanConfig(defaultSettings.scanConfig)

    const offBrowserClosed = window.electronAPI.on('browser-closed', ({ accountId }: { accountId: string }) => {
      stopLoginPolling(accountId)
      void (async () => {
        await stopAccount(accountId).catch(() => {})
        patchAccount(accountId, { state: 'paused', actionActive: false })
        addLog(`账号 ${accountId} 的浏览器窗口已关闭，已停止该账号所有活动`, 'warning')
      })()
    })
    const offDouyinResponse = window.electronAPI.on('douyin-response', ({ accountId, type, data }: AnyRecord) => {
      if (type === 'lottery') {
        manager.applyLiveLotteryUpdate(accountId, data)
      }
    })

    const handleBeforeUnload = () => {
      accounts.forEach((account) => stopLoginPolling(account.id))
      manager.shutdownAllAccounts()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      offBrowserClosed()
      offDouyinResponse()
      loginTimersRef.current.forEach((timer) => window.clearTimeout(timer))
      loginTimersRef.current.clear()
    }
  }, [])

  useEffect(() => {
    manager.setPoolServerConfig({ url: activePoolServerUrl }, { silent: true })
  }, [activePoolServerUrl, manager])

  useEffect(() => {
    void refreshLicense()
    void refreshDispatch()
    void refreshLearning()
  }, [activePoolServerUrl])

  useEffect(() => {
    setAccounts((current) => current.map((account) => {
      const next = { ...account, runtimeState: deriveRuntimeState(account, license) }
      syncRuntimeRef(next)
      return next
    }))
  }, [license.accessMode, license.authorized, license.trialState])

  useAccountSelection({
    accounts,
    selectedAccountId,
    onSelectedAccountIdChange: setSelectedAccountId
  })

  useAdaptivePolling({
    hasActiveAccounts: accounts.some((account) => account.actionActive),
    refreshDispatch: () => void refreshDispatch(),
    refreshLicense: () => void refreshLicense(),
    refreshLearning: () => void refreshLearning()
  })

  const runningCount = accounts.filter((account) => account.actionActive).length
  const totalWins = accounts.reduce((sum, account) => sum + Number(account.todayLotteryWinCount || 0), 0)
  const totalDiamonds = accounts.reduce((sum, account) => sum + Number(account.todayEarnedDiamonds || 0), 0)
  const totalParticipation = accounts.reduce((sum, account) => sum + Number(account.participationCount || 0), 0)
  const settingsAny = settings as AnyRecord
  const hotUpdateConfigured = settingsAny?.hotUpdateEnabled === true && String(settingsAny?.hotUpdateManifestUrl || '').trim() !== ''
  const useHotUpdateBadge = hotUpdateConfigured || hotUpdateState.enabled === true
  const updateStatusText = useHotUpdateBadge
    ? formatHotUpdateStatusText(hotUpdateState.status)
    : formatUpdateStatusText(updateState.status)
  const displayUpdateState: UpdateSnapshot = useHotUpdateBadge
    ? {
      status: mapHotUpdateToInstallerStatus(hotUpdateState.status),
      currentVersion: String(hotUpdateState.currentVersion || bootstrap?.appVersion || updateState.currentVersion || ''),
      latestVersion: String(hotUpdateState.latestVersion || ''),
      progress: updateState.progress,
      message: String(hotUpdateState.message || ''),
      feedUrl: String(hotUpdateState.manifestUrl || ''),
      checkedAt: Number(hotUpdateState.checkedAt || 0)
    }
    : updateState
  const accountsMap = useMemo(() => {
    return accounts.reduce((acc, account) => {
      acc[account.id] = account.nickname || account.id
      return acc
    }, {} as Record<string, string>)
  }, [accounts])
  const sortedHistoryRecords = useMemo(() => {
    return [...historyRecords].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
  }, [historyRecords])

  const gateLocked = license.accessMode === 'locked' && license.requiresActivation

  const {
    bindBusy,
    bindSession,
    bindMiniAppCodeUrl,
    bindMiniAppScanCodeUrl,
    createBindSession,
    refreshBindSessionStatus
  } = useLicenseBinding({
    poolServerUrl: activePoolServerUrl,
    poolClientId,
    poolFingerprint,
    appVersion: bootstrap?.appVersion || '3.0.0',
    autoCreateEnabled: gateLocked,
    onLicenseRefresh: refreshLicense,
    onLog: addLog
  })

  const showGate = (gateLocked && !forceShowMainWhenLocked) || manualShowLicenseGate
  const mainViewTabs: Array<{ id: MainView; label: string; icon?: string }> = [
    { id: 'dashboard', label: '工作总览' },
    { id: 'accounts', label: '账号管理' },
    { id: 'history', label: '历史记录' },
    { id: 'logs', label: '系统日志' }
  ]

  const accountListPanel = (
    <div className="flex flex-col rounded-xl border border-slate-800 bg-slate-900 p-4 shadow-sm 2xl:min-h-[250px] 2xl:flex-1">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-100">账号列表</h2>
          <p className="text-xs text-slate-400 mt-1">统一管理已接入账号，并支持启动、暂停和重新登录。</p>
        </div>
        <div className="text-xs text-slate-400 bg-slate-800 px-2.5 py-1 rounded-md">{accounts.length} 个账号</div>
      </div>
      <div className="scrollbar-thin grid gap-4 overflow-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
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
            onDelete={() => void removeAccount(account.id)}
          />
        ))}
        {accounts.length === 0 ? (
          <div className="col-span-full flex h-40 items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-800/30 text-center text-sm text-slate-500">
            暂无账号。请点击左下角“添加账号”后扫码登录。
          </div>
        ) : null}
      </div>
    </div>
  )
  const lotteryListPanel = (
    <div className="h-full w-full flex-1">
      <LotteryListPanel lotteriesByAccount={lotteriesByAccount} accountsMap={accountsMap} />
    </div>
  )

  return (
    <div className="flex h-full w-full bg-slate-950 overflow-hidden text-slate-300">
      {/* 侧边导航栏 */}
      <aside className="flex w-[220px] flex-col border-r border-slate-800 bg-slate-900 shrink-0">
        <div className="flex items-center px-6 py-5 border-b border-slate-800/50">
          <div className="h-3 w-3 rounded-full bg-emerald-500 mr-3 shadow-[0_0_8px_rgba(16,185,129,0.4)]"></div>
          <h1 className="text-lg font-bold tracking-wide text-slate-100">抖音福袋</h1>
          <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">v{bootstrap?.appVersion || displayUpdateState.currentVersion}</span>
        </div>
        
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            主要功能
          </div>
          {mainViewTabs.map((tab) => (
            <button
              key={tab.id}
              className={`flex w-full items-center rounded-lg px-3 py-2.5 text-sm transition-colors ${
                activeView === tab.id
                  ? 'bg-blue-500/10 text-blue-400 font-medium'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
              onClick={() => {
                setActiveView(tab.id)
                setManualShowLicenseGate(false)
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="border-t border-slate-800/50 p-4 space-y-2">
          <button 
            className="flex w-full items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-400 transition hover:bg-emerald-500/20"
            onClick={addAccount}
          >
            添加账号
          </button>
          <div className="flex gap-2">
            <button
              className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-700"
              onClick={() => setSettingsOpen(true)}
            >
              设置
            </button>
            <button
              className="flex-1 right-0 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-700"
              onClick={() => {
                setManualShowLicenseGate(true)
                setForceShowMainWhenLocked(false)
              }}
            >
              授权
            </button>
          </div>
          <div className="text-center pt-2">
            {!license.authorized && license.accessMode !== 'trial' ? (
               <span className="text-[10px] text-red-400">未授权</span>
            ) : (
               <span className="text-[10px] text-slate-500">已授权</span>
            )}
          </div>
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="flex flex-1 flex-col overflow-hidden bg-[#0B1120]">
        {showGate ? (
          <div className="h-full w-full overflow-auto p-6">
            <LicenseGate
              license={license}
              licenseKey={licenseKey}
              announcementMarkdown={announcementMarkdown}
              bindBusy={bindBusy}
              bindSession={bindSession}
              miniAppCodeUrl={bindMiniAppCodeUrl}
              miniAppScanCodeUrl={bindMiniAppScanCodeUrl}
              onLicenseKeyChange={setLicenseKey}
              onStartTrial={handleStartTrial}
              onActivate={handleActivate}
              onCreateBindSession={() => void createBindSession()}
              onRefreshBindStatus={() => void refreshBindSessionStatus(true)}
              onBackToMain={() => {
                setManualShowLicenseGate(false)
                if (gateLocked) {
                  setForceShowMainWhenLocked(true)
                }
              }}
              busy={licenseBusy}
            />
          </div>
        ) : (
          <>
            {/* 顶部统计栏 */}
            <header className="flex shrink-0 items-center justify-between border-b border-slate-800/80 bg-slate-900/50 px-6 py-4">
              <div className="flex items-center gap-6">
                 <div>
                    <div className="text-xs text-slate-500 mb-1">今日收益</div>
                    <div className="text-xl font-bold text-violet-400 flex items-baseline gap-1">
                      {totalDiamonds} <span className="text-xs font-normal text-slate-500">钻石</span>
                    </div>
                 </div>
                 <div className="h-8 w-px bg-slate-800"></div>
                 <div>
                    <div className="text-xs text-slate-500 mb-1">总计中奖</div>
                    <div className="text-lg font-bold text-emerald-400 flex items-baseline gap-1">
                      {totalWins} <span className="text-xs font-normal text-slate-500">次</span>
                    </div>
                 </div>
                 <div className="h-8 w-px bg-slate-800"></div>
                 <div>
                    <div className="text-xs text-slate-500 mb-1">参与人次</div>
                    <div className="text-lg font-bold text-amber-400 flex items-baseline gap-1">
                      {totalParticipation} <span className="text-xs font-normal text-slate-500">次</span>
                    </div>
                 </div>
                 <div className="h-8 w-px bg-slate-800"></div>
                 <div>
                    <div className="text-xs text-slate-500 mb-1">在线账号</div>
                    <div className="text-lg font-bold text-blue-400 flex items-baseline gap-1">
                      {runningCount} <span className="text-xs font-normal text-slate-500">/ {accounts.length}</span>
                    </div>
                 </div>
                 <div className="h-8 w-px bg-slate-800"></div>
                 <div>
                    <div className="text-xs text-slate-500 mb-1">服务端福袋池</div>
                    <div className="text-lg font-bold text-cyan-400 flex items-baseline gap-1">
                      {dispatchSummary.validCandidates} <span className="text-xs font-normal text-slate-500">个</span>
                    </div>
                 </div>
                 <div className="h-8 w-px bg-slate-800"></div>
                 <div>
                    <div className="text-xs text-slate-500 mb-1">客户端可抢数</div>
                    <div className="text-lg font-bold text-teal-400 flex items-baseline gap-1">
                      {dispatchSummary.availableCandidates} <span className="text-xs font-normal text-slate-500">个</span>
                    </div>
                 </div>
              </div>
              <div className="flex items-center gap-3">
                 <div className="rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-2 text-right">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">授权状态</div>
                    <div className="mt-1 text-xs text-slate-200">
                      {license.authorized
                        ? (license.accessMode === 'trial'
                          ? `试用中，剩余 ${formatRelative(license.trialRemainingSec)}`
                          : '已授权')
                        : license.message || '未授权'}
                    </div>
                 </div>
                 {announcementMarkdown ? (
                    <div className="flex h-10 items-center rounded-lg bg-teal-500/10 px-3 text-xs text-teal-400 border border-teal-500/20 max-w-[320px]">
                      <span className="mr-2 shrink-0">公告</span>
                      <span className="truncate">{buildAnnouncementPreview(announcementMarkdown)}</span>
                    </div>
                 ) : null}
                 {!useHotUpdateBadge && updateState.status === 'downloaded' && (
                    <button
                      className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 transition"
                      onClick={() => void window.electronAPI.desktop.installUpdate()}
                    >
                      系统更新就绪
                    </button>
                 )}
              </div>
            </header>

            {/* 动态页面内容 */}
            <div className="flex-1 overflow-auto p-4 sm:p-6">
              {activeView === 'dashboard' ? (
                <div className="flex h-full flex-col gap-6 xl:flex-row">
                  <div className="flex flex-1 flex-col gap-6 xl:w-2/3">
                    {accountListPanel}
                    <div className="h-[320px] shrink-0 border border-slate-800 rounded-xl overflow-hidden">
                      {lotteryListPanel}
                    </div>
                  </div>
                  <div className="flex xl:w-1/3 flex-col gap-6">
                    <div className="h-1/2 min-h-[300px]">
                      <TaskDetailPanel
                        selectedAccount={selectedAccount}
                        accounts={accounts}
                        onToggleAccount={(account) => {
                          if (account.actionActive) {
                            void stopAccount(account.id)
                          } else {
                            void startAccountScanning(account.id)
                          }
                        }}
                        onReloginAccount={(account) => void startAccountWithLogin(account.id, true)}
                      />
                    </div>
                    <div className="h-1/2 min-h-[300px] border border-slate-800 rounded-xl overflow-hidden bg-slate-900">
                      <TimelinePanel logs={logs} logListRef={logListRef} onLogListScroll={handleLogListScroll} />
                    </div>
                  </div>
                </div>
              ) : null}

              {activeView === 'accounts' ? (
                <div className="flex h-full flex-col gap-6 xl:flex-row">
                  <div className="flex flex-1 flex-col gap-6 xl:w-2/3">
                    {accountListPanel}
                  </div>
                  <div className="xl:w-1/3 h-full">
                    <TaskDetailPanel
                      selectedAccount={selectedAccount}
                      accounts={accounts}
                      onToggleAccount={(account) => {
                        if (account.actionActive) {
                          void stopAccount(account.id)
                        } else {
                          void startAccountScanning(account.id)
                        }
                      }}
                      onReloginAccount={(account) => void startAccountWithLogin(account.id, true)}
                    />
                  </div>
                </div>
              ) : null}

              {activeView === 'history' ? (
                <div className="h-full">
                  <HistoryPanel records={sortedHistoryRecords} />
                </div>
              ) : null}

              {activeView === 'logs' ? (
                <div className="h-full border border-slate-800 rounded-xl overflow-hidden bg-slate-900">
                  <TimelinePanel logs={logs} logListRef={logListRef} onLogListScroll={handleLogListScroll} />
                </div>
              ) : null}
            </div>
          </>
        )}
      </main>

      <SettingsDrawer
        open={settingsOpen}
        settings={settings}
        updateState={displayUpdateState}
        updateStatusText={updateStatusText}
        learningSummary={learningSummary}
        onClose={() => setSettingsOpen(false)}
        onChange={(patch) => void persistSettings({ ...settings, ...patch })}
        onNestedChange={(updater) => void persistSettings(updater(settings))}
        onInstallUpdate={() => {
          if (useHotUpdateBadge) {
            void window.electronAPI.desktop.checkHotUpdate()
          } else {
            void window.electronAPI.desktop.installUpdate()
          }
        }}
        onDownloadUpdate={() => {
          if (useHotUpdateBadge) {
            void window.electronAPI.desktop.checkHotUpdate()
          } else {
            void window.electronAPI.desktop.downloadUpdate()
          }
        }}
      />

    </div>
  )
}
