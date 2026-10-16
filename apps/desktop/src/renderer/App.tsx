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
  normalizePoolServerUrl
} from '../services/poolClient'
import { buildLegacyConfig } from './features/accounts/legacyConfig'
import { formatHotUpdateStatusText, formatUpdateStatusText } from './lib/updatePresentation'
import { useAdaptivePolling } from './hooks/useAdaptivePolling'
import { useAccountSelection } from './hooks/useAccountSelection'
import { SettingsDrawer } from './features/settings/SettingsDrawer'
import { TaskDetailPanel } from './features/dashboard/TaskDetailPanel'
import { TimelinePanel } from './features/dashboard/TimelinePanel'
import { LotteryListPanel } from './features/dashboard/LotteryListPanel'
import { AccountListPanel } from './features/accounts/AccountListPanel'
import { HistoryPanel } from './features/history/HistoryPanel'
import { type UiLogEntry, useTimelineLogs } from './features/dashboard/useTimelineLogs'
import { useAccountLifecycle } from './features/accounts/useAccountLifecycle'
import { ProtocolValidationDialog } from './features/accounts/ProtocolValidationDialog'
import { ProtocolLoginDialog } from './features/accounts/ProtocolLoginDialog'
import { AppLayout } from './components/layout/AppLayout'
import { AppSider, type MainView } from './components/layout/AppSider'
import { AppHeader } from './components/layout/AppHeader'
import type {
  AccountSession,
  BootstrapSnapshot,
  DesktopSettings,
  DispatchSummary,
  LotteryHistoryRecord,
  UpdateSnapshot
} from '@shared/models'
import { DEFAULT_DESKTOP_SETTINGS } from '@shared/defaultSettings'
import { useDesktopUpdates } from './hooks/useDesktopUpdates'
import { emptyHotUpdate, emptyUpdate } from './lib/defaultSnapshots'

type AnyRecord = Record<string, any>
type ServiceResult<T = AnyRecord> = {
  ok?: boolean
  data?: T
  error?: unknown
}

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

export default function App() {
  const manager = useMemo(() => new LotteryManager(), [])
  const runtimeAccountsRef = useRef<Map<string, AnyRecord>>(new Map())
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

  const activePoolServerUrl = useMemo(() => {
    return normalizePoolServerUrl(settings.poolServerUrl) || FIXED_POOL_SERVER_URL
  }, [settings.poolServerUrl])

  const {
    announcementMarkdown,
    updateState,
    hotUpdateState,
    setUpdateState,
    setHotUpdateState
  } = useDesktopUpdates(activePoolServerUrl)

  const selectedAccount = accounts.find((item) => item.id === selectedAccountId) || accounts[0] || null

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
      startTransition(() => {
        setHistoryRecords((current) => [nextRecord as LotteryHistoryRecord, ...current.filter(item => !(item.accountId === nextRecord.accountId && item.lotteryId === nextRecord.lotteryId))].slice(0, 240))
      })
    } catch (_) {
      startTransition(() => {
        setHistoryRecords((current) => [normalizedRecord as LotteryHistoryRecord, ...current.filter(item => !(item.accountId === normalizedRecord.accountId && item.lotteryId === normalizedRecord.lotteryId))].slice(0, 240))
      })
    }
  })

  const {
    upsertAccount,
    startAccountScanning,
    stopAccount,
    openProtocolValidation,
    addAccount,
    removeAccount,
    openLogin,
    loginTarget,
    closeLogin,
    protocolAccountId,
    closeProtocolValidation
  } = useAccountLifecycle({
    accounts,
    settings,
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
    runtimeAccountsRef
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
    let shouldResume = false
    try {
      const snapshot = await window.electronAPI.desktop.getBootstrap()
      const snapshotPoolServerUrl = normalizePoolServerUrl(snapshot?.settings?.poolServerUrl) || FIXED_POOL_SERVER_URL
      const snapshotSettings = { ...(snapshot?.settings || {}) } as AnyRecord
      manager.recoveryStates = snapshot.runtimeStates || {}
      shouldResume = snapshotSettings.resumeOnStartup !== false
      delete snapshotSettings.noticeMarkdown
      manager.setPoolServerConfig({url:snapshotPoolServerUrl,token:snapshotSettings.poolServerToken || ''},{silent:true})
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
      const loaded = await window.electronAPI.invoke('protocol:list-sessions')
      if (loaded?.success && loaded.accounts) {
        loaded.accounts.forEach((info: AnyRecord) => {
          const accountId = info.id
          upsertAccount({
            id: accountId,
            nickname: info.nickname || accountId,
            userId: info.userId || accountId,
            token: info.hasSession ? 'session-present' : null,
            requestBackend: 'android',
            state: 'waiting',
            actionActive: false
          })
          if (shouldResume && manager.recoveryStates?.[accountId]?.intent === 'running') {
            window.setTimeout(() => void startAccountScanning(accountId), 500)
          }
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
    manager.setPoolServerConfig({ url: normalizedSettings.poolServerUrl, token: normalizedSettings.poolServerToken }, { silent: true })
    try {
      await window.electronAPI.desktop.saveSettings(normalizedSettings)
    } catch (_) {
      // ignore
    }
  })

  useEffect(() => {
    void bootstrapDesktop()
    manager.setScanConfig(defaultSettings.scanConfig)

    const handleBeforeUnload = () => {
      manager.shutdownAllAccounts()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

  useEffect(() => {
    manager.setPoolServerConfig({ url: activePoolServerUrl }, { silent: true })
  }, [activePoolServerUrl, manager])

  useEffect(() => {
    void refreshDispatch()
    void refreshLearning()
  }, [activePoolServerUrl])

  useAccountSelection({
    accounts,
    selectedAccountId,
    onSelectedAccountIdChange: setSelectedAccountId
  })

  useAdaptivePolling({
    hasActiveAccounts: accounts.some((account) => account.actionActive),
    refreshDispatch: () => void refreshDispatch(),
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

  return (
    <>
      <AppLayout
        sider={
          <AppSider
            activeView={activeView}
            onViewChange={setActiveView}
            appVersion={bootstrap?.appVersion || displayUpdateState.currentVersion || '3.0.0'}
            onAddAccount={addAccount}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        }
        header={
          <AppHeader
            totalDiamonds={totalDiamonds}
            totalWins={totalWins}
            totalParticipation={totalParticipation}
            runningCount={runningCount}
            accountCount={accounts.length}
            dispatchSummary={dispatchSummary}
            announcementMarkdown={announcementMarkdown}
            updateState={displayUpdateState}
            useHotUpdateBadge={useHotUpdateBadge}
            onInstallUpdate={() => {
              if (useHotUpdateBadge) {
                void window.electronAPI.desktop.checkHotUpdate()
              } else {
                void window.electronAPI.desktop.installUpdate()
              }
            }}
          />
        }
      >
        <div className="h-full w-full">
          {activeView === 'dashboard' && (
            <div className="grid h-full grid-cols-1 gap-4 xl:grid-cols-12 overflow-hidden">
              {/* 左栏 7 列：账号列表 + 待抢福袋池 */}
              <div className="flex h-full flex-col gap-4 overflow-hidden xl:col-span-7">
                <div className="max-h-[50%] min-h-[220px] flex-1 overflow-hidden">
                  <AccountListPanel
                    accounts={accounts}
                    selectedAccountId={selectedAccountId}
                    onSelectAccount={setSelectedAccountId}
                    onToggleAccount={(account) => {
                      if (account.actionActive) {
                        void stopAccount(account.id)
                      } else {
                        void startAccountScanning(account.id)
                      }
                    }}
                    onReloginAccount={(account) => void openProtocolValidation(account.id)}
                    onDeleteAccount={(account) => void removeAccount(account.id)}
                    onAddAccount={addAccount}
                  />
                </div>
                <div className="h-[48%] min-h-[260px] overflow-hidden">
                  <LotteryListPanel
                    lotteriesByAccount={lotteriesByAccount}
                    accountsMap={accountsMap}
                  />
                </div>
              </div>

              {/* 右栏 5 列：选中账号状态流 + 实时系统日志 */}
              <div className="flex h-full flex-col gap-4 overflow-hidden xl:col-span-5">
                <div className="max-h-[50%] min-h-[260px] flex-1 overflow-hidden">
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
                    onReloginAccount={(account) => void openProtocolValidation(account.id)}
                  />
                </div>
                <div className="h-[48%] min-h-[220px] overflow-hidden">
                  <TimelinePanel
                    logs={logs}
                    logListRef={logListRef}
                    onLogListScroll={handleLogListScroll}
                  />
                </div>
              </div>
            </div>
          )}

          {activeView === 'accounts' && (
            <div className="grid h-full grid-cols-1 gap-4 xl:grid-cols-12 overflow-hidden">
              <div className="h-full overflow-hidden xl:col-span-8">
                <AccountListPanel
                  accounts={accounts}
                  selectedAccountId={selectedAccountId}
                  onSelectAccount={setSelectedAccountId}
                  onToggleAccount={(account) => {
                    if (account.actionActive) {
                      void stopAccount(account.id)
                    } else {
                      void startAccountScanning(account.id)
                    }
                  }}
                  onReloginAccount={(account) => void openProtocolValidation(account.id)}
                  onDeleteAccount={(account) => void removeAccount(account.id)}
                  onAddAccount={addAccount}
                />
              </div>
              <div className="h-full overflow-hidden xl:col-span-4">
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
                  onReloginAccount={(account) => void openProtocolValidation(account.id)}
                />
              </div>
            </div>
          )}

          {activeView === 'history' && (
            <div className="h-full overflow-hidden">
              <HistoryPanel records={sortedHistoryRecords} />
            </div>
          )}

          {activeView === 'logs' && (
            <div className="h-full overflow-hidden">
              <TimelinePanel
                logs={logs}
                logListRef={logListRef}
                onLogListScroll={handleLogListScroll}
              />
            </div>
          )}
        </div>
      </AppLayout>

      <ProtocolValidationDialog accountId={protocolAccountId} onClose={closeProtocolValidation} onLogin={openLogin} />
      {loginTarget && <ProtocolLoginDialog accountId={loginTarget.accountId} onClose={closeLogin} />}
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
    </>
  )
}
