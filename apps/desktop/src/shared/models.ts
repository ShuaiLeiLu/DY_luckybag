export type AccessMode = 'disabled' | 'unrestricted' | 'licensed' | 'trial' | 'locked'

export interface LicenseSnapshot {
  enabled: boolean
  available: boolean
  authorized: boolean
  unrestricted: boolean
  state: string
  message: string
  accessMode: AccessMode
  trialState: string
  trialExpireAt: number
  trialRemainingSec: number
  requiresActivation: boolean
  licensePlan: string
  features: Record<string, unknown>
  featureFlags: Record<string, boolean>
  checkedAt: number
}

export interface TrialSnapshot {
  state: string
  expireAt: number
  remainingSec: number
}

export type AccountRole = 'scanner' | 'worker'

export type RuntimeState =
  | 'locked'
  | 'trial_active'
  | 'ready'
  | 'scanning'
  | 'claiming'
  | 'preheating'
  | 'joining'
  | 'waiting_result'
  | 'cooldown'
  | 'error'
  | 'paused'
  | 'login_required'

export interface AccountSession {
  id: string
  nickname: string
  userId: string
  state: string
  runtimeState: RuntimeState
  actionActive: boolean
  currentRoom: string
  token?: string | null
  scanRole: AccountRole
  currentTaskStage: string
  currentTaskLabel: string
  currentTaskAnchor: string
  currentTaskLotteryName: string
  currentTaskLeaseId: string
  currentTaskLeaseExpiresAt: number
  currentTaskLeaseRemainingSec: number
  currentTaskScore: number
  participationCount: number
  todayEarnedDiamonds: number
  todayLotteryWinCount: number
  todayRedPacketWinCount: number
  todayLotteryWonDiamonds: number
  todayRedPacketWonDiamonds: number
  scanUploadSubmitted: number
  scanUploadAccepted: number
  scanUploadOk: boolean
  scanUploadSkipped: string
  scanUploadError: string
  scanUploadAt: number
  poolActiveCandidates: number
  poolValidCandidates: number
  poolAvailableCandidates: number
  poolSummaryAt: number
  requestBackend?: RequestBackendType
}

export interface PoolLease {
  leaseId: string
  candidateKey: string
  roomId: string
  lotteryId: string
  clientId: string
  accountId: string
  claimedAt: number
  expiresAt: number
}

export interface DispatchSummary {
  enabled: boolean
  connected: boolean
  activeCandidates: number
  validCandidates: number
  availableCandidates: number
  updatedAt: number
  error?: string
}

export interface UpdateSnapshot {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'disabled'
  currentVersion: string
  latestVersion: string
  progress: number
  message: string
  feedUrl: string
  checkedAt: number
}

export interface RecoveryEvent {
  id: number
  scope: string
  level: 'info' | 'warning' | 'error' | 'success'
  message: string
  createdAt: number
}

export type LotteryHistoryRecordType = 'join' | 'win'

export interface LotteryHistoryRecord {
  id: number
  recordType: LotteryHistoryRecordType
  accountId: string
  accountNickname: string
  roomId: string
  webRid: string
  lotteryId: string
  authorNickname: string
  lotteryName: string
  predictedProbability: number
  predictedJoinTotal: number
  joinTotal: number
  luckyCount: number
  onlineTotal: number
  totalAmount: number
  prizeType: unknown
  prizeInfo: Record<string, unknown>
  conditions: unknown[]
  remainingSec: number
  serverScore: number
  startTime: number
  joinMode: string
  joinStatus: string
  resultStatus: string
  resultReason: string
  joinedAt: number
  endTime: number
  rewardAmount: number
  createdAt: number
}

export type RequestBackendType = 'web' | 'android' | 'auto'

export interface AndroidBridgeConfig {
  enabled: boolean
  serverUrl: string
  token: string
}

export interface AndroidBridgeStatus {
  available: boolean
  connected: boolean
  ticketGuardReady: boolean
  authenticated: boolean
  accountId?: string
  capabilities?: string[]
  error?: string
  lastCheckedAt?: number
}

export interface DesktopSettings {
  poolServerUrl: string
  updateFeedUrl: string
  hotUpdateEnabled: boolean
  hotUpdateManifestUrl: string
  hotUpdateReloadOnApply: boolean
  stayDuration: number
  enableRedPacket: boolean
  onlyRedPacketMode: { enabled: boolean }
  randomInteraction: boolean
  hitRate: { enabled: boolean; value: number }
  secondInspect: { enabled: boolean; value: number }
  filterFanClub: { enabled: boolean }
  onlyPhysicalPrize: { enabled: boolean }
  preferBigRedPacket: { enabled: boolean; threshold: number }
  filterOnline: { enabled: boolean; value: number }
  participationCount: { enabled: boolean; value: number }
  singleAccountDuration: { enabled: boolean; value: number }
  scanConfig: { countPerPage: number; pagesPerCategory: number; allCount: number }
  requestBackend: RequestBackendType
  androidBridge: AndroidBridgeConfig
}

export interface BootstrapSnapshot {
  appVersion: string
  machineFingerprint: string
  settings: DesktopSettings
  update: UpdateSnapshot
  events: RecoveryEvent[]
  historyRecords: LotteryHistoryRecord[]
}
