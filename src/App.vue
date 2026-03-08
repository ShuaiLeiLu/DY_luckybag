<template>
  <n-config-provider :theme-overrides="themeOverrides" class="app-root">
    <div class="desktop-shell">
      <div class="window-frame">
        <div class="app-container">
          <aside class="sidebar">
            <header class="header-base sidebar-header">
              <n-icon size="20" color="#18a058"><settings-outline /></n-icon>
              <h2 class="title-text">参数配置</h2>
            </header>
            <ConfigPanel :config="config" />
          </aside>

          <main class="main-content">
            <HeaderStats
              :total-diamonds="totalDiamonds"
              :total-participation="totalParticipation"
              :total-winning="totalWinning"
              :success-rate="headerSuccessRate"
              :dispatch-summary="poolDispatchSummary"
              :license-status="poolLicenseStatus"
              @open-license="openLicenseModal"
            />

            <div class="content-body">
              <div class="column-left">
                <AccountList
                  :accounts="accounts"
                  :running-count="runningCount"
                  :columns="responsiveColumns"
                  :scroll-x="accountTableScrollX"
                  :summary="accountSummary"
                  :dispatch="poolDispatchSummary"
                  @add="addAccount"
                />
                <LotteryDetail
                  :lotteries="mergedLotteries"
                  :history-records="lotteryHistory"
                  @block="handleBlockRoom"
                />
              </div>

              <div class="column-right">
                <LogPanel
                  :logs="logs"
                  :learning="poolLearningDebug"
                  :learning-loading="poolLearningLoading"
                  @clear="logs = []"
                />
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>

    <n-modal v-model:show="licenseModalVisible" class="license-modal" :mask-closable="false">
      <div class="license-dialog">
        <div class="license-dialog__header">
          <div class="license-dialog__title">授权设置</div>
          <button
            class="license-dialog__close"
            type="button"
            :disabled="licenseSubmitting"
            @click="licenseModalVisible = false"
          >
            ×
          </button>
        </div>

        <div class="license-dialog__body">
          <div class="license-dialog__status-row">
            <span class="license-dialog__status-label">当前状态</span>
            <span class="license-dialog__status-value" :class="licenseStatusToneClass">
              {{ licenseSummaryText }}
            </span>
          </div>

          <div class="license-dialog__meta" v-if="licenseMetaText">
            {{ licenseMetaText }}
          </div>

          <div class="license-dialog__bind-card">
            <div class="license-dialog__qr-wrap">
              <n-qr-code
                v-if="licenseBindQrValue"
                class="license-dialog__qr"
                :value="licenseBindQrValue"
                :size="176"
                error-correction-level="M"
              />
              <div v-else class="license-dialog__qr-placeholder">
                {{ licenseBindLoading ? '二维码生成中...' : '当前客户端已授权' }}
              </div>
            </div>

            <div class="license-dialog__bind-content">
              <div class="license-dialog__bind-title">微信扫码解锁完整授权</div>
              <div class="license-dialog__bind-desc">{{ licenseBindSummaryText }}</div>

              <div class="license-dialog__bind-meta">
                <span>一次性 bind_token</span>
                <span>60 秒有效</span>
                <span>绑定当前机器指纹</span>
              </div>

              <div class="license-dialog__bind-token" v-if="licenseBindSession.bindToken">
                {{ licenseBindSession.bindToken }}
              </div>

              <div class="license-dialog__bind-extra" v-if="licenseBindSession.wechatNickname">
                已扫码用户：{{ licenseBindSession.wechatNickname }}
              </div>

              <div class="license-dialog__bind-countdown" :class="licenseBindCountdownToneClass">
                {{ licenseBindCountdownText }}
              </div>

              <div class="license-dialog__bind-actions">
                <n-button
                  class="license-dialog__bind-button"
                  secondary
                  type="primary"
                  @click="refreshLicenseBindSession"
                  :loading="licenseBindLoading"
                  :disabled="licenseSubmitting"
                >
                  刷新二维码
                </n-button>
              </div>
            </div>
          </div>

          <div class="license-dialog__manual-title">手动输入授权码（备用）</div>

          <n-input
            v-model:value="licenseFormKey"
            size="large"
            clearable
            class="license-dialog__input"
            placeholder="请输入授权码"
            :disabled="licenseSubmitting"
          />

          <div
            class="license-dialog__hint"
            :class="licenseFormMessageToneClass"
            v-if="licenseFormMessage"
          >
            {{ licenseFormMessage }}
          </div>
        </div>

        <div class="license-dialog__footer">
          <n-button class="license-dialog__button license-dialog__button--ghost" @click="licenseModalVisible = false" :disabled="licenseSubmitting">
            关闭
          </n-button>
          <n-button class="license-dialog__button license-dialog__button--primary" type="primary" @click="submitLicenseActivation" :loading="licenseSubmitting">
            激活授权
          </n-button>
        </div>
      </div>
    </n-modal>
  </n-config-provider>
</template>

<script setup>
import { ref, h, computed, watch, onMounted, onUnmounted } from 'vue'
import { 
  NButton, NTag, NConfigProvider, NIcon, NModal, NInput, NQrCode
} from 'naive-ui'
import SettingsOutline from '@vicons/ionicons5/es/SettingsOutline'

// 导入提取的组件
import ConfigPanel from './components/ConfigPanel.vue'
import HeaderStats from './components/HeaderStats.vue'
import AccountList from './components/AccountList.vue'
import LotteryDetail from './components/LotteryDetail.vue'
import LogPanel from './components/LogPanel.vue'

import LotteryManager from './services/LotteryManager-lite'
import { activateLicense, createLicenseBindSession, fetchLicenseBindSessionStatus, fetchLicenseStatus, normalizePoolServerUrl, reportPoolTaskFeedback, resolveLicenseFingerprint, resolvePoolClientId } from './services/poolClient'

const themeOverrides = {
  common: {
    primaryColor: '#18a058',
    primaryColorHover: '#36ad6a',
    borderRadius: '12px',
    fontFamily: "'SF Pro Display', 'PingFang SC', 'MiSans', 'Helvetica Neue', sans-serif"
  },
  Card: {
    titleFontSizeMedium: '14px'
  },
  Input: {
    heightSmall: '32px'
  },
  DataTable: {
    thPaddingSmall: '10px 12px',
    tdPaddingSmall: '10px 12px'
  }
}

// 响应式状态
const windowWidth = ref(window.innerWidth)
// 响应式计算
const isMobile = computed(() => windowWidth.value < 768)

// 统计数据
const runningCount = computed(() => accounts.value.filter(a => a.state === 'running').length)
const totalParticipation = computed(() => accounts.value.reduce((sum, a) => sum + a.participationCount, 0))
const totalWinning = computed(() => accounts.value.reduce((sum, a) => sum + Number(a.todayLotteryWinCount || 0), 0))
const totalDiamonds = computed(() => accounts.value.reduce((sum, a) => {
  return sum + Number(a.todayLotteryWonDiamonds || 0) + Number(a.todayRedPacketWonDiamonds || 0)
}, 0))
const headerSuccessRate = computed(() => {
  const joined = Number(totalParticipation.value || 0)
  if (joined <= 0) return 0
  return Number(((totalWinning.value / joined) * 100).toFixed(1))
})
const totalLotteryWonDiamonds = computed(() => accounts.value.reduce((sum, a) => sum + Number(a.todayLotteryWonDiamonds || 0), 0))
const totalRedPacketWinning = computed(() => accounts.value.reduce((sum, a) => sum + Number(a.todayRedPacketWinCount || 0), 0))
const accountSummary = computed(() => ({
  totalParticipation: Number(totalParticipation.value || 0),
  totalLotteryWinCount: Number(totalWinning.value || 0),
  totalLotteryWonDiamonds: Number(totalLotteryWonDiamonds.value || 0),
  totalRedPacketWinning: Number(totalRedPacketWinning.value || 0)
}))

const mergedLotteries = computed(() => {
  const map = new Map()
  const allLists = Object.values(lotteriesByAccount.value || {})
  const all = allLists
    .flatMap(list => (Array.isArray(list) ? list : []))

  for (const item of all) {
    const roomId = item?.roomId ?? ''
    const lotteryId = item?.lottery_id ?? ''
    const key = `${roomId}_${lotteryId}`
    if (!key) continue

    const prev = map.get(key)
    if (!prev) {
      map.set(key, item)
      continue
    }

    const prevP = Number(prev?.predictedProbability || 0)
    const curP = Number(item?.predictedProbability || 0)
    if (curP > prevP) {
      map.set(key, item)
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    const ta = a?.end_time || 0
    const tb = b?.end_time || 0
    return ta - tb
  })
})

const lotteryManager = new LotteryManager()
const initialPoolServerConfig = lotteryManager.getPoolServerConfig()
const stablePoolClientId = resolvePoolClientId()
const stableLicenseFingerprint = resolveLicenseFingerprint()
const POOL_CURRENT_ACCOUNTS_KEY = 'DY_CURRENT_ACCOUNTS'

const config = ref({
  minProbability: 0.01,
  stayDuration: 20,
  enableRedPacket: true,
  hitRate: { enabled: true, value: 0.1 },
  filterFanClub: { enabled: true },
  onlyPhysicalPrize: { enabled: false },
  preferBigRedPacket: { enabled: true, threshold: 40 },
  participationCount: { enabled: false, value: 80 },
  singleAccountDuration: { enabled: false, value: 3 },
  filterOnline: { enabled: false, value: 1000 },
  randomInteraction: { enabled: true },
  closeLiveStream: { enabled: true },
  poolServer: {
    enabled: initialPoolServerConfig.enabled !== false,
    url: initialPoolServerConfig.url || ''
  }
})

const accounts = ref([])
const logs = ref([])
const lotteriesByAccount = ref({})
const lotteryHistory = ref([])
const pendingCreateAccountIds = new Set()
let poolDispatchTimer = null
let poolLearningTimer = null
let poolLicenseTimer = null
let poolDispatchInflight = false
let poolLearningInflight = false
let poolLicenseInflight = false
const poolLearningLoading = ref(false)
const poolLearningDebug = ref({
  connected: false,
  summary: null,
  items: [],
  error: ''
})

const UI_STATUS_FLUSH_MS = 120
const UI_LOTTERY_FLUSH_MS = 160
const UI_LOG_FLUSH_MS = 120
const POOL_SUMMARY_POLL_MS = 6000
const POOL_LEARNING_POLL_MS = 20000
const POOL_LICENSE_POLL_MS = 60000
const LICENSE_BIND_POLL_MS = 2000
const LOG_MAX_COUNT = 300
const LOG_MERGE_WINDOW_MS = 2000
const LOG_WIN_RE = /(中奖|恭喜|🎉|🧧.*成功|领取红包成功|中得)/i
const LOG_FAIL_RE = /(失败|错误|异常|超时|未中奖|放弃)/i
const LOG_WARN_RE = /(风控|告警|警告|降速|冷却)/i
const FRONTEND_LOG_SUPPRESS_PATTERNS = [
  /^⏳ 已锁定当前直播间，约\d+秒后复核当前福袋，并持续补扫候选\.\.\.$/,
  /^🧠 服务端T(?:30|20)复评分：当前目标继续保留$/,
  /^🧠 服务端T(?:30|20)复评分：已锁定当前房间，忽略跨房切换建议$/
]

const pendingAccountUpdates = new Map()
const pendingLotteryListUpdates = new Map()
const pendingLogs = []
let accountUpdateFlushTimer = null
let lotteryListFlushTimer = null
let logFlushTimer = null
let logSeq = 0

/**
 * createEmptyPoolDispatchSummary 方法：创建服务端调度摘要默认值。
 */
function createEmptyPoolDispatchSummary(overrides = {}) {
  return {
    enabled: false,
    connected: false,
    activeCandidates: 0,
    validCandidates: 0,
    availableCandidates: 0,
    leaseCount: 0,
    clientLeaseCount: 0,
    accountLeaseCount: 0,
    updatedAt: 0,
    error: '',
    ...overrides
  }
}

const poolDispatchSummary = ref(createEmptyPoolDispatchSummary({
  enabled: config.value.poolServer?.enabled !== false
}))

/**
 * createEmptyLicenseStatus 方法：创建授权状态默认值。
 */
function createEmptyLicenseStatus(overrides = {}) {
  return {
    enabled: false,
    available: false,
    authorized: false,
    state: 'disabled',
    message: '未启用授权',
    customerName: '',
    plan: '',
    expireAt: 0,
    maxClients: 0,
    maxAccounts: 0,
    features: {},
    checkedAt: 0,
    ...overrides
  }
}

/**
 * createEmptyLicenseBindSession 方法：创建扫码绑定会话默认值。
 */
function createEmptyLicenseBindSession(overrides = {}) {
  return {
    bindToken: '',
    qrText: '',
    status: 'idle',
    message: '',
    clientId: '',
    fingerprint: '',
    appVersion: '',
    wechatNickname: '',
    licenseId: 0,
    adUnlockDays: 30,
    expireAt: 0,
    remainingSec: 0,
    scannedAt: 0,
    grantedAt: 0,
    authorized: false,
    license: null,
    ...overrides
  }
}

/**
 * applyPoolLicenseStatus 方法：将服务端返回的授权状态统一写入前端状态树。
 */
function applyPoolLicenseStatus(license) {
  poolLicenseStatus.value = createEmptyLicenseStatus({
    enabled: license?.enabled === true,
    available: license?.available !== false,
    authorized: license?.authorized === true,
    state: String(license?.state || 'unknown'),
    message: String(license?.message || ''),
    customerName: String(license?.customerName || ''),
    plan: String(license?.plan || ''),
    expireAt: Number(license?.expireAt || 0),
    maxClients: Number(license?.maxClients || 0),
    maxAccounts: Number(license?.maxAccounts || 0),
    features: (license?.features && typeof license.features === 'object') ? license.features : {},
    checkedAt: Number(license?.checkedAt || Date.now())
  })
}

/**
 * formatLicenseErrorMessage 方法：将常见授权网络/接口错误文案转换为中文。
 */
function formatLicenseErrorMessage(rawMessage, fallback = '请求失败') {
  const text = String(rawMessage || '').trim()
  if (!text) return fallback
  const lower = text.toLowerCase()

  if (lower.includes('failed to fetch') || lower.includes('networkerror when attempting to fetch resource')) {
    return '授权服务失败'
  }
  if (lower.includes('timeout') || lower.includes('aborted')) {
    return '请求超时，请稍后重试'
  }

  const messageMap = {
    license_backend_unavailable: '授权服务暂不可用',
    license_service_unavailable: '授权服务暂不可用',
    license_status_failed: '获取授权状态失败',
    license_activate_failed: '激活授权失败',
    license_bind_create_failed: '创建扫码授权失败',
    license_bind_status_failed: '获取扫码授权状态失败',
    license_not_authorized: '授权未生效',
    bind_session_expired: '二维码已过期，请刷新后重试',
    bind_session_not_scanned: '尚未完成微信扫码',
    license_client_id_required: '缺少客户端标识，请重启软件后重试',
    license_fingerprint_required: '缺少设备指纹，请重启软件后重试'
  }
  if (messageMap[text]) return messageMap[text]

  const httpMatch = text.match(/^http_(\d{3})$/i)
  if (httpMatch) return `请求失败（HTTP ${httpMatch[1]}）`

  return text
}

const poolLicenseStatus = ref(createEmptyLicenseStatus())
const licenseModalVisible = ref(false)
const licenseSubmitting = ref(false)
const licenseBindLoading = ref(false)
const licenseFormKey = ref('')
const licenseFormMessage = ref('')
const licenseBindSession = ref(createEmptyLicenseBindSession())
const APP_VERSION = 'v2.0'
let licenseBindPollTimer = null
let licenseBindStatusInflight = false

const licenseSummaryText = computed(() => {
  const info = poolLicenseStatus.value || {}
  if (info.enabled !== true) return '未启用授权'
  if (info.available === false) return info.message || '授权服务不可用'
  if (info.authorized !== true) return info.message || '未授权'
  const expireAt = Number(info.expireAt || 0)
  if (expireAt > 0) {
    const d = new Date(expireAt)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `授权有效，截止 ${y}-${m}-${day}`
  }
  return '授权有效'
})

const licenseMetaText = computed(() => {
  const parts = []
  const info = poolLicenseStatus.value || {}
  if (info.customerName) parts.push(`客户：${info.customerName}`)
  if (info.plan) parts.push(`版本：${info.plan}`)
  if (info.authorized !== true) {
    parts.push('未授权时最多添加 1 个账号')
  }
  return parts.join(' · ')
})

const licenseStatusToneClass = computed(() => {
  const info = poolLicenseStatus.value || {}
  if (info.enabled !== true || info.available === false || info.authorized !== true) {
    return 'license-dialog__status-value--danger'
  }
  const expireAt = Number(info.expireAt || 0)
  if (expireAt > 0) {
    const remain = expireAt - Date.now()
    if (remain <= 7 * 24 * 60 * 60 * 1000) {
      return 'license-dialog__status-value--warning'
    }
  }
  return 'license-dialog__status-value--success'
})

const licenseFormMessageToneClass = computed(() => {
  const text = String(licenseFormMessage.value || '')
  if (!text) return ''
  if (/成功|已激活|授权有效/.test(text)) return 'license-dialog__hint--success'
  return 'license-dialog__hint--danger'
})

const licenseBindQrValue = computed(() => {
  const session = licenseBindSession.value || {}
  return String(session.qrText || session.bindToken || '').trim()
})

const licenseBindSummaryText = computed(() => {
  const session = licenseBindSession.value || {}
  if (session.authorized === true) return '当前客户端已授权，完整功能已解锁'
  if (session.status === 'scanned') return '已完成微信扫码登录，等待激励视频结束后自动授权'
  if (session.status === 'granted') return '授权已发放，客户端正在同步状态'
  if (session.status === 'expired') return '二维码已过期，请点击刷新生成新的 bind_token'
  if (licenseBindLoading.value) return '正在生成二维码，请稍候...'
  return String(session.message || '请用微信小程序扫码，完成激励视频后自动授权')
})

const licenseBindCountdownToneClass = computed(() => {
  const session = licenseBindSession.value || {}
  const remain = Number(session.remainingSec || 0)
  if (!session.bindToken || session.authorized === true) {
    return 'license-dialog__bind-countdown--success'
  }
  if (remain <= 0 || session.status === 'expired') return 'license-dialog__bind-countdown--danger'
  if (remain <= 10) return 'license-dialog__bind-countdown--warning'
  return 'license-dialog__bind-countdown--success'
})

const licenseBindCountdownText = computed(() => {
  const session = licenseBindSession.value || {}
  if (session.authorized === true) return '授权已生效'
  if (!session.bindToken) return '当前无需扫码'
  const remain = Number(session.remainingSec || 0)
  if (remain <= 0 || session.status === 'expired') return '二维码已过期'
  return `${remain} 秒后过期`
})

const licenseAddLimitReached = computed(() => {
  const info = poolLicenseStatus.value || {}
  if (info.enabled !== true) return false
  if (info.authorized === true) return false
  return (accounts.value.length + pendingCreateAccountIds.size) >= 1
})

/**
 * getTodayKey 方法：获取今日键。
 */
function getTodayKey() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * createAccountModel 方法：创建账号模型。
 */
function createAccountModel(base = {}) {
  return {
    id: base.id || '',
    nickname: normalizeNickname(base.nickname || ''),
    userId: base.userId || base.id || '',
    state: base.state || 'waiting',
    currentRoom: base.currentRoom || '',
    token: base.token || null,
    participationCount: Number(base.participationCount || 0),
    lotteryWinCount: Number(base.lotteryWinCount || 0),
    redPacketWinCount: Number(base.redPacketWinCount || 0),
    lotteryWonDiamonds: Number(base.lotteryWonDiamonds || 0),
    redPacketWonDiamonds: Number(base.redPacketWonDiamonds || 0),
    todayLotteryWinCount: Number(base.todayLotteryWinCount || 0),
    todayRedPacketWinCount: Number(base.todayRedPacketWinCount || 0),
    todayLotteryWonDiamonds: Number(base.todayLotteryWonDiamonds || 0),
    todayRedPacketWonDiamonds: Number(base.todayRedPacketWonDiamonds || 0),
    todayEarnedDiamonds: Number(base.todayEarnedDiamonds || 0),
    todayConsumedDiamonds: Number(base.todayConsumedDiamonds || 0),
    totalDiamonds: Number(base.totalDiamonds || 0),
    lastWalletDiamond: base.lastWalletDiamond ?? null,
    statsDateKey: base.statsDateKey || getTodayKey(),
    scanRole: base.scanRole || 'worker',
    currentTaskStage: base.currentTaskStage || '',
    currentTaskKey: base.currentTaskKey || '',
    currentTaskLabel: base.currentTaskLabel || '',
    currentTaskAnchor: base.currentTaskAnchor || '',
    currentTaskLotteryName: base.currentTaskLotteryName || '',
    currentTaskLeaseId: base.currentTaskLeaseId || '',
    currentTaskLeaseExpiresAt: Number(base.currentTaskLeaseExpiresAt || 0),
    currentTaskLeaseRemainingSec: Number(base.currentTaskLeaseRemainingSec || 0),
    currentTaskScore: Number(base.currentTaskScore || 0)
  }
}

/**
 * clearAccountDispatchState 方法：清理账号界面上的共享任务状态，避免暂停后残留旧租约信息。
 */
function clearAccountDispatchState(account) {
  if (!account || typeof account !== 'object') return
  account.scanRole = 'worker'
  account.currentTaskStage = ''
  account.currentTaskKey = ''
  account.currentTaskLabel = ''
  account.currentTaskAnchor = ''
  account.currentTaskLotteryName = ''
  account.currentTaskLeaseId = ''
  account.currentTaskLeaseExpiresAt = 0
  account.currentTaskLeaseRemainingSec = 0
  account.currentTaskScore = 0
}

function resolveLogBadgeMeta(message, type = 'info') {
  const text = String(message || '')
  const normalizedType = String(type || 'info')
  if (LOG_WIN_RE.test(text)) return { label: '中奖', className: 'badge-win' }
  if (normalizedType === 'error' || LOG_FAIL_RE.test(text)) return { label: '失败', className: 'badge-fail' }
  if (normalizedType === 'warning' || LOG_WARN_RE.test(text)) return { label: '告警', className: 'badge-warning' }
  return { label: '运行', className: 'badge-info' }
}

function buildLogEntry(message, type = 'info') {
  const text = String(message || '')
  const now = Date.now()
  return {
    id: ++logSeq,
    time: new Date(now).toLocaleTimeString(),
    message: text,
    type,
    _ts: now,
    _sig: `${type}:${text}`,
    _baseMessage: text,
    _repeat: 1,
    _badge: resolveLogBadgeMeta(text, type)
  }
}

function tryMergeLogEntry(targetList, entry) {
  if (!Array.isArray(targetList) || targetList.length === 0) return false
  const last = targetList[targetList.length - 1]
  if (!last || last._sig !== entry._sig) return false
  if ((entry._ts - Number(last._ts || 0)) > LOG_MERGE_WINDOW_MS) return false
  const repeat = Number(last._repeat || 1) + 1
  last._repeat = repeat
  last._ts = entry._ts
  last.time = entry.time
  last.message = `${last._baseMessage} ×${repeat}`
  return true
}

function flushPendingAccountUpdates() {
  if (pendingAccountUpdates.size === 0) return
  pendingAccountUpdates.forEach((patch, accountId) => {
    const account = accounts.value.find(item => item.id === accountId)
    if (!account || !patch) return
    Object.assign(account, patch)
  })
  pendingAccountUpdates.clear()
}

function scheduleAccountUpdateFlush() {
  if (accountUpdateFlushTimer) return
  accountUpdateFlushTimer = setTimeout(() => {
    accountUpdateFlushTimer = null
    flushPendingAccountUpdates()
  }, UI_STATUS_FLUSH_MS)
}

function queueAccountUpdate(patch = {}) {
  const accountId = String(patch?.id || '').trim()
  if (!accountId) return
  const prev = pendingAccountUpdates.get(accountId) || {}
  pendingAccountUpdates.set(accountId, {
    ...prev,
    ...patch
  })
  scheduleAccountUpdateFlush()
}

function upsertLoggedInAccount(account, nextState = {}, options = {}) {
  const accountId = String(account?.id || nextState?.id || '').trim()
  if (!accountId) return null
  const immediateState = options.autoStartAfterLogin === true ? 'running' : (nextState.state || 'waiting')
  pendingAccountUpdates.delete(accountId)
  const index = accounts.value.findIndex(a => a.id === accountId)
  if (index >= 0) {
    Object.assign(accounts.value[index], {
      ...nextState,
      state: immediateState
    })
    ensureDailyStats(accounts.value[index])
    return accounts.value[index]
  }
  const created = createAccountModel({
    ...account,
    ...nextState,
    state: immediateState
  })
  accounts.value.push(created)
  return created
}

/**
 * persistCurrentAccountCount 方法：将当前账号数量同步到本地存储，供服务端授权硬校验放行单账号使用。
 */
function persistCurrentAccountCount() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const count = Math.max(0, Number(accounts.value.length || 0))
      window.localStorage.setItem(POOL_CURRENT_ACCOUNTS_KEY, String(count))
    }
  } catch (_) {
    // ignore
  }
}

async function resolveStableLoginSnapshot(accountId, initialResult = null) {
  let latest = initialResult && initialResult.success && initialResult.isLoggedIn ? initialResult : null
  if (!ipcRenderer) return latest
  for (let i = 0; i < 3; i++) {
    try {
      const result = await ipcRenderer.invoke('get-login-token', accountId)
      if (result?.success && result?.isLoggedIn && (result?.tokenInfo?.sessionid || result?.tokenInfo?.sessionid_ss)) {
        latest = result
      }
    } catch (_) {
      // ignore
    }
    if (i < 2) {
      await sleep(700)
    }
  }
  return latest
}

function flushPendingLotteryListUpdates() {
  if (pendingLotteryListUpdates.size === 0) return
  pendingLotteryListUpdates.forEach((payload, accountId) => {
    const account = accounts.value.find(acc => acc.id === accountId)
    const nickname = normalizeNickname(account?.nickname || accountId)
    lotteriesByAccount.value[accountId] = (payload.list || []).map(item => ({
      ...item,
      _scanAccountId: accountId,
      _scanAccountNickname: nickname
    }))
  })
  pendingLotteryListUpdates.clear()
}

function scheduleLotteryListFlush() {
  if (lotteryListFlushTimer) return
  lotteryListFlushTimer = setTimeout(() => {
    lotteryListFlushTimer = null
    flushPendingLotteryListUpdates()
  }, UI_LOTTERY_FLUSH_MS)
}

function queueLotteryListUpdate(accountId, list = []) {
  if (!accountId) return
  pendingLotteryListUpdates.set(accountId, {
    list: Array.isArray(list) ? list : []
  })
  scheduleLotteryListFlush()
}

function flushPendingLogs() {
  if (pendingLogs.length === 0) return
  const next = logs.value.slice()
  while (pendingLogs.length > 0) {
    const entry = pendingLogs.shift()
    if (tryMergeLogEntry(next, entry)) continue
    next.push(entry)
  }
  logs.value = next.slice(-LOG_MAX_COUNT)
}

function scheduleLogFlush() {
  if (logFlushTimer) return
  logFlushTimer = setTimeout(() => {
    logFlushTimer = null
    flushPendingLogs()
  }, UI_LOG_FLUSH_MS)
}

/**
 * ensureDailyStats 方法：确保每日统计满足预期。
 */
function ensureDailyStats(account) {
  const todayKey = getTodayKey()
  if (account.statsDateKey !== todayKey) {
    account.todayLotteryWinCount = 0
    account.todayRedPacketWinCount = 0
    account.todayLotteryWonDiamonds = 0
    account.todayRedPacketWonDiamonds = 0
    account.todayEarnedDiamonds = 0
    account.todayConsumedDiamonds = 0
    account.statsDateKey = todayKey
  }
}

let ipcRenderer = null
try {
  if (window.electronAPI) {
    ipcRenderer = window.electronAPI
  }
} catch (e) {
  console.error('无法加载 electron:', e)
}

const ipcUnsubscribers = []
const resolvedLotteryResultKeys = new Set()
const countedLotteryWinKeys = new Set()
const countedWalletFallbackKeys = new Set()

// 监听串口大小
const handleResize = () => {
  windowWidth.value = window.innerWidth
}

/**
 * handleBeforeUnload 方法：应用退出前立即停止本地扫描与轮询任务，避免窗口关闭后仍继续执行脚本。
 */
function handleBeforeUnload() {
  try {
    lotteryManager.shutdownAllAccounts()
  } catch (_) {
    // ignore
  }
}

onMounted(async () => {
  window.addEventListener('resize', handleResize)
  window.addEventListener('beforeunload', handleBeforeUnload)
  lotteryManager.setScanConfig({ countPerPage: 15, pagesPerCategory: 12, allCount: 24 })
  lotteryManager.setPoolServerConfig(config.value.poolServer, { silent: true })
  await loadAllAccounts()
  persistCurrentAccountCount()
  restartPoolDispatchPolling()
  if (ipcRenderer) {
    // 监听浏览器窗口关闭事件
    const offBrowserClosed = ipcRenderer.on('browser-closed', ({ accountId }) => {
      const account = accounts.value.find(a => a.id === accountId)
      if (account) {
        const wasPendingRelogin = pendingCreateAccountIds.has(accountId)
        if (wasPendingRelogin) {
          pendingCreateAccountIds.delete(accountId)
        }
        lotteryManager.stopAccount(accountId)
        account.state = 'paused'
        clearAccountDispatchState(account)
        if (wasPendingRelogin) {
          addLog(`⚠️ [${account.nickname}] 重新登录窗口已关闭，当前账号未更新`, 'warning')
        } else {
          addLog(`⚠️ [${account.nickname}] 浏览器窗口已手动关闭，活动已停止`, 'warning')
        }
        return
      }
      if (pendingCreateAccountIds.has(accountId)) {
        pendingCreateAccountIds.delete(accountId)
        addLog(`⚠️ [${accountId}] 登录窗口已关闭，未加入账号列表`, 'warning')
      }
    })
    ipcUnsubscribers.push(offBrowserClosed)

    const offDouyinResponse = ipcRenderer.on('douyin-response', ({ accountId, type, data }) => {
      const account = accounts.value.find(a => a.id === accountId)
      if (!account) return
      ensureDailyStats(account)
      if (type === 'lottery') {
        const outcome = parseLotteryOutcome(data)
        if (outcome) {
          const outcomeKey = makeLotteryOutcomeKey(accountId, outcome.lotteryId)
          let historyUpdated = false
          let updatedHistoryRecord = null
          if (outcome.drawFinished) {
            if (outcomeKey) {
              if (!resolvedLotteryResultKeys.has(outcomeKey)) {
                resolvedLotteryResultKeys.add(outcomeKey)
                const updateResult = updateLotteryHistoryOutcome(accountId, outcome)
                historyUpdated = updateResult.updated
                updatedHistoryRecord = updateResult.record
              }
            } else {
              const updateResult = updateLotteryHistoryOutcome(accountId, outcome)
              historyUpdated = updateResult.updated
              updatedHistoryRecord = updateResult.record
            }
          }

          if (historyUpdated && updatedHistoryRecord) {
            reportLotteryOutcomeFeedback(accountId, updatedHistoryRecord, outcome).catch(() => {})
          }

          if (outcome.isWin) {
            const shouldCount = outcomeKey
              ? incrementLotteryWinStats(account, accountId, outcome.lotteryId, Number(outcome.winDiamonds || 0))
              : (historyUpdated
                ? incrementLotteryWinStats(account, accountId, updatedHistoryRecord?.lotteryId || '', Number(outcome.winDiamonds || 0))
                : false)
            if (shouldCount) {
              addLog(`🎉 [${account.nickname}] 恭喜！福袋中奖了！`, 'success')
            }
          }
        }
      } else if (type === 'redpacket') {
        const outcome = parseRedPacketOutcome(data)
        if (!outcome?.isWin) return
        const reward = Number(outcome.reward || 0)
        account.redPacketWinCount++
        account.todayRedPacketWinCount++
        account.redPacketWonDiamonds += reward
        account.todayRedPacketWonDiamonds += reward
        addLog(`🧧 [${account.nickname}] 领取红包成功：${reward} 钻石`, 'success')
      } else if (type === 'wallet' && data?.diamond !== undefined) {
        const currentWallet = Number(data.diamond || 0)
        let rewardDelta = 0
        if (account.lastWalletDiamond !== null && currentWallet > account.lastWalletDiamond) {
          rewardDelta = currentWallet - account.lastWalletDiamond
          account.todayEarnedDiamonds += rewardDelta
        } else if (account.lastWalletDiamond !== null && currentWallet < account.lastWalletDiamond) {
          account.todayConsumedDiamonds += (account.lastWalletDiamond - currentWallet)
        }
        account.lastWalletDiamond = currentWallet
        account.totalDiamonds = currentWallet
        if (rewardDelta > 0) {
          applyWalletWinFallback(accountId, account, rewardDelta)
        }
      }
    })
    ipcUnsubscribers.push(offDouyinResponse)
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('beforeunload', handleBeforeUnload)
  stopPoolDispatchPolling()
  stopLicenseBindPolling()
  if (accountUpdateFlushTimer) clearTimeout(accountUpdateFlushTimer)
  if (lotteryListFlushTimer) clearTimeout(lotteryListFlushTimer)
  if (logFlushTimer) clearTimeout(logFlushTimer)
  flushPendingAccountUpdates()
  flushPendingLotteryListUpdates()
  flushPendingLogs()
  handleBeforeUnload()
  ipcUnsubscribers.forEach(off => {
    try { off && off() } catch (_) {}
  })
  ipcUnsubscribers.length = 0
})

watch(
  () => [config.value.poolServer?.enabled, config.value.poolServer?.url],
  ([enabled, url]) => {
    lotteryManager.setPoolServerConfig({
      enabled: enabled !== false,
      url: url || ''
    }, { silent: true })
    restartPoolDispatchPolling()
  }
)

watch(
  () => licenseModalVisible.value,
  visible => {
    licenseFormMessage.value = ''
    if (!visible) {
      stopLicenseBindPolling()
      return
    }
    refreshLicenseBindSession()
  }
)

watch(
  () => accounts.value.length,
  () => {
    persistCurrentAccountCount()
  },
  { immediate: true }
)

watch(
  () => [
    config.value.filterFanClub?.enabled,
    config.value.onlyPhysicalPrize?.enabled,
    config.value.preferBigRedPacket?.enabled,
    config.value.preferBigRedPacket?.threshold,
    config.value.filterOnline?.enabled,
    config.value.filterOnline?.value,
    config.value.hitRate?.enabled,
    config.value.hitRate?.value
  ],
  () => {
    refreshPoolDispatchSummary()
  }
)

/**
 * stopPoolDispatchPolling 方法：停止服务端调度摘要轮询。
 */
function stopPoolDispatchPolling() {
  if (poolDispatchTimer) {
    clearInterval(poolDispatchTimer)
    poolDispatchTimer = null
  }
  if (poolLearningTimer) {
    clearInterval(poolLearningTimer)
    poolLearningTimer = null
  }
  if (poolLicenseTimer) {
    clearInterval(poolLicenseTimer)
    poolLicenseTimer = null
  }
}

/**
 * refreshPoolDispatchSummary 方法：刷新服务端调度摘要。
 */
async function refreshPoolDispatchSummary() {
  if (poolDispatchInflight) return
  const enabled = config.value.poolServer?.enabled !== false && Boolean(config.value.poolServer?.url)
  if (!enabled) {
    poolDispatchSummary.value = createEmptyPoolDispatchSummary({ enabled: false })
    return
  }

  poolDispatchInflight = true
  try {
    const res = await lotteryManager.fetchPoolTaskDebugSnapshot(config.value, { limit: 50 })
    if (!res?.ok) {
      poolDispatchSummary.value = createEmptyPoolDispatchSummary({
        enabled: true,
        connected: false,
        error: res?.error || 'task_debug_failed'
      })
      return
    }

    const summary = res.data?.summary || {}
    poolDispatchSummary.value = createEmptyPoolDispatchSummary({
      enabled: true,
      connected: true,
      activeCandidates: Number(summary.activeCandidates || 0),
      validCandidates: Number(summary.validCandidates || 0),
      availableCandidates: Number(summary.availableCandidates || 0),
      leaseCount: Number(summary.leaseCount || 0),
      clientLeaseCount: Number(summary.clientLeaseCount || 0),
      accountLeaseCount: Number(summary.accountLeaseCount || 0),
      updatedAt: Number(summary.generatedAt || Date.now())
    })
  } finally {
    poolDispatchInflight = false
  }
}

/**
 * refreshPoolLicenseStatus 方法：刷新授权状态。
 */
async function refreshPoolLicenseStatus() {
  if (poolLicenseInflight) return
  const enabled = config.value.poolServer?.enabled !== false && Boolean(config.value.poolServer?.url)
  if (!enabled) {
    poolLicenseStatus.value = createEmptyLicenseStatus({ enabled: false, message: '未启用授权' })
    return
  }

  poolLicenseInflight = true
  try {
    const res = await fetchLicenseStatus(config.value.poolServer.url, {
      clientId: stablePoolClientId,
      fingerprint: stableLicenseFingerprint,
      timeoutMs: 3000
    })
    if (!res?.ok) {
      poolLicenseStatus.value = createEmptyLicenseStatus({
        enabled: true,
        available: false,
        state: 'backend_unavailable',
        message: formatLicenseErrorMessage(res?.error, '授权服务不可用'),
        checkedAt: Date.now()
      })
      return
    }
    applyPoolLicenseStatus(res.data?.license || {})
  } finally {
    poolLicenseInflight = false
  }
}

/**
 * normalizeLicenseBindSession 方法：统一整理扫码绑定会话返回结构。
 */
function normalizeLicenseBindSession(payload = {}) {
  const raw = (payload.session && typeof payload.session === 'object') ? payload.session : {}
  return createEmptyLicenseBindSession({
    bindToken: String(raw.bindToken || ''),
    qrText: String(payload.qrText || raw.bindToken || ''),
    status: String(raw.status || 'idle'),
    message: String(raw.message || ''),
    clientId: String(raw.clientId || ''),
    fingerprint: String(raw.fingerprint || ''),
    appVersion: String(raw.appVersion || ''),
    wechatNickname: String(raw.wechatNickname || ''),
    licenseId: Number(raw.licenseId || 0),
    adUnlockDays: Number(raw.adUnlockDays || 30),
    expireAt: Number(raw.expireAt || 0),
    remainingSec: Number(raw.remainingSec || 0),
    scannedAt: Number(raw.scannedAt || 0),
    grantedAt: Number(raw.grantedAt || 0),
    authorized: raw.authorized === true,
    license: (raw.license && typeof raw.license === 'object') ? raw.license : null
  })
}

/**
 * stopLicenseBindPolling 方法：停止扫码授权轮询。
 */
function stopLicenseBindPolling() {
  if (licenseBindPollTimer) {
    clearTimeout(licenseBindPollTimer)
    licenseBindPollTimer = null
  }
}

/**
 * scheduleLicenseBindPolling 方法：按当前 bind_token 状态继续轮询。
 */
function scheduleLicenseBindPolling(delay = LICENSE_BIND_POLL_MS) {
  stopLicenseBindPolling()
  const session = licenseBindSession.value || {}
  if (!licenseModalVisible.value) return
  if (!session.bindToken || session.authorized === true) return
  if (session.status === 'expired' || Number(session.remainingSec || 0) <= 0) return
  licenseBindPollTimer = setTimeout(() => {
    pollLicenseBindSessionStatus()
  }, Math.max(800, Number(delay || LICENSE_BIND_POLL_MS)))
}

/**
 * refreshLicenseBindSession 方法：创建或刷新当前客户端的扫码绑定二维码。
 */
async function refreshLicenseBindSession() {
  const baseUrl = String(config.value.poolServer?.url || '').trim()
  if (!licenseModalVisible.value) return
  if (!baseUrl) {
    licenseBindSession.value = createEmptyLicenseBindSession({
      status: 'error',
      message: '请先配置筛选服务地址'
    })
    return
  }

  licenseBindLoading.value = true
  licenseBindSession.value = createEmptyLicenseBindSession({
    status: 'loading',
    message: '正在生成二维码...'
  })
  stopLicenseBindPolling()
  try {
    const res = await createLicenseBindSession(baseUrl, {
      clientId: stablePoolClientId,
      fingerprint: stableLicenseFingerprint,
      appVersion: APP_VERSION,
      timeoutMs: 4000
    })
    if (!res?.ok) {
      licenseBindSession.value = createEmptyLicenseBindSession({
        status: 'error',
        message: formatLicenseErrorMessage(res?.error, '创建扫码授权失败')
      })
      return
    }
    const nextSession = normalizeLicenseBindSession(res.data || {})
    licenseBindSession.value = nextSession
    if (nextSession.authorized === true) {
      if (nextSession.license) {
        applyPoolLicenseStatus(nextSession.license)
      } else {
        await refreshPoolLicenseStatus()
      }
      return
    }
    scheduleLicenseBindPolling()
  } finally {
    licenseBindLoading.value = false
  }
}

/**
 * pollLicenseBindSessionStatus 方法：轮询扫码授权状态并在授权成功后解锁完整功能。
 */
async function pollLicenseBindSessionStatus() {
  if (licenseBindStatusInflight) return
  const baseUrl = String(config.value.poolServer?.url || '').trim()
  const bindToken = String(licenseBindSession.value?.bindToken || '').trim()
  if (!licenseModalVisible.value || !baseUrl || !bindToken) return
  licenseBindStatusInflight = true
  try {
    const res = await fetchLicenseBindSessionStatus(baseUrl, {
      bindToken,
      timeoutMs: 3500
    })
    if (!res?.ok) {
      licenseBindSession.value = createEmptyLicenseBindSession({
        bindToken,
        qrText: bindToken,
        status: 'error',
        message: formatLicenseErrorMessage(res?.error, '获取扫码授权状态失败')
      })
      scheduleLicenseBindPolling(3000)
      return
    }
    const previousAuthorized = licenseBindSession.value?.authorized === true
    const nextSession = normalizeLicenseBindSession(res.data || {})
    licenseBindSession.value = nextSession
    if (nextSession.authorized === true) {
      if (nextSession.license) {
        applyPoolLicenseStatus(nextSession.license)
      } else {
        await refreshPoolLicenseStatus()
      }
      stopLicenseBindPolling()
      if (!previousAuthorized) {
        licenseFormMessage.value = '微信扫码授权成功，完整功能已解锁'
        addLog('✅ 微信扫码授权成功，完整功能已解锁', 'success')
      }
      return
    }
    scheduleLicenseBindPolling()
  } finally {
    licenseBindStatusInflight = false
  }
}

/**
 * refreshPoolLearningDebug 方法：刷新服务端学习桶调试快照。
 */
async function refreshPoolLearningDebug() {
  if (poolLearningInflight) return
  const enabled = config.value.poolServer?.enabled !== false && Boolean(config.value.poolServer?.url)
  if (!enabled) {
    poolLearningDebug.value = {
      connected: false,
      summary: null,
      items: [],
      error: ''
    }
    return
  }

  poolLearningInflight = true
  poolLearningLoading.value = true
  try {
    const res = await lotteryManager.fetchPoolLearningDebugSnapshot({ limit: 60 })
    if (!res?.ok) {
      poolLearningDebug.value = {
        connected: false,
        summary: null,
        items: [],
        error: String(res?.error || 'learning_debug_failed')
      }
      return
    }
    poolLearningDebug.value = {
      connected: true,
      summary: res.data?.summary || null,
      items: Array.isArray(res.data?.items) ? res.data.items : [],
      error: ''
    }
  } finally {
    poolLearningLoading.value = false
    poolLearningInflight = false
  }
}

/**
 * restartPoolDispatchPolling 方法：按当前服务端配置重启调度摘要轮询。
 */
function restartPoolDispatchPolling() {
  stopPoolDispatchPolling()
  refreshPoolDispatchSummary()
  refreshPoolLearningDebug()
  refreshPoolLicenseStatus()
  if (config.value.poolServer?.enabled === false || !config.value.poolServer?.url) {
    return
  }
  poolDispatchTimer = setInterval(() => {
    refreshPoolDispatchSummary()
  }, POOL_SUMMARY_POLL_MS)
  poolLearningTimer = setInterval(() => {
    refreshPoolLearningDebug()
  }, POOL_LEARNING_POLL_MS)
  poolLicenseTimer = setInterval(() => {
    refreshPoolLicenseStatus()
  }, POOL_LICENSE_POLL_MS)
}

/**
 * openLicenseModal 方法：打开授权设置弹窗。
 */
function openLicenseModal() {
  licenseFormMessage.value = ''
  licenseModalVisible.value = true
}

/**
 * submitLicenseActivation 方法：提交授权码到服务端激活。
 */
async function submitLicenseActivation() {
  const baseUrl = String(config.value.poolServer?.url || '').trim()
  const licenseKey = String(licenseFormKey.value || '').trim()
  if (!baseUrl) {
    licenseFormMessage.value = '请先配置筛选服务地址'
    return
  }
  if (!licenseKey) {
    licenseFormMessage.value = '请输入授权码'
    return
  }

  licenseSubmitting.value = true
  licenseFormMessage.value = ''
  try {
    const res = await activateLicense(baseUrl, {
      licenseKey,
      clientId: stablePoolClientId,
      fingerprint: stableLicenseFingerprint,
      appVersion: APP_VERSION,
      currentAccounts: accounts.value.length,
      timeoutMs: 4000
    })
    if (!res?.ok) {
      licenseFormMessage.value = formatLicenseErrorMessage(
        res?.data?.license?.message || res?.error,
        '授权激活失败'
      )
      addLog(`⚠️ 授权激活失败：${licenseFormMessage.value}`, 'warning')
      await refreshPoolLicenseStatus()
      return
    }
    const license = res.data?.license || {}
    applyPoolLicenseStatus(license)
    licenseFormMessage.value = license.authorized === true ? '授权激活成功' : String(license.message || '授权未生效')
    addLog(license.authorized === true ? '✅ 授权激活成功' : `⚠️ 授权状态异常：${licenseFormMessage.value}`, license.authorized === true ? 'success' : 'warning')
    if (license.authorized === true) {
      licenseModalVisible.value = false
      licenseFormKey.value = ''
    }
  } finally {
    licenseSubmitting.value = false
  }
}

/**
 * loadAllAccounts 方法：加载账号列表。
 */
async function loadAllAccounts() {
  if (!ipcRenderer) return
  try {
    const result = await ipcRenderer.invoke('load-all-tokens')
    if (result.success && result.tokens) {
      Object.entries(result.tokens).forEach(([id, info]) => {
        const match = id.match(/account_(\d+)/)
        const fallbackNickname = match ? `账号${match[1]}` : `账号_${id}`
        accounts.value.push(createAccountModel({
          id,
          nickname: normalizeNickname(info.nickname || fallbackNickname),
          userId: info.userId || id,
          state: 'waiting',
          token: info.sessionid || info.sessionid_ss
        }))
      })
    }
  } catch (error) { addLog(`❌ 加载账号失败: ${error.message}`, 'error') }
}

/**
 * sleep 方法：处理延时。
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * normalizeNickname 方法：归一化昵称。
 */
function normalizeNickname(name) {
  const text = String(name || '').trim()
  if (!text) return ''
  if (text.length >= 2 && text[0] === text[1]) return text.slice(1)
  return text
}

/**
 * makeLotteryOutcomeKey 方法：生成福袋开奖结果键。
 */
function makeLotteryOutcomeKey(accountId, lotteryId) {
  const id = String(lotteryId || '').trim()
  if (!id) return ''
  return `${accountId}:${id}`
}

/**
 * clearLotteryOutcomeCacheByAccount 方法：清理福袋开奖结果缓存账号。
 */
function clearLotteryOutcomeCacheByAccount(accountId) {
  const prefix = `${accountId}:`
  for (const key of Array.from(resolvedLotteryResultKeys)) {
    if (key.startsWith(prefix)) resolvedLotteryResultKeys.delete(key)
  }
  for (const key of Array.from(countedLotteryWinKeys)) {
    if (key.startsWith(prefix)) countedLotteryWinKeys.delete(key)
  }
  for (const key of Array.from(countedWalletFallbackKeys)) {
    if (key.startsWith(prefix)) countedWalletFallbackKeys.delete(key)
  }
}

/**
 * isTruthyWinFlag 方法：兼容布尔值/数字/字符串形式的中奖标记。
 */
function isTruthyWinFlag(value) {
  if (value === true) return true
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

/**
 * parseLotteryOutcome 方法：解析福袋开奖结果。
 */
function parseLotteryOutcome(raw) {
  if (!raw || typeof raw !== 'object') return null
  const lotteryInfo = raw.lottery_info || raw.lotteryInfo || null
  if (!lotteryInfo || typeof lotteryInfo !== 'object') return null

  const lotteryId = String(
    lotteryInfo.lottery_id_str ||
    lotteryInfo.lottery_id ||
    lotteryInfo.lotteryId ||
    raw.lottery_id_str ||
    raw.lottery_id ||
    ''
  ).trim()

  const status = Number(lotteryInfo.status)
  const winStatus = Number(lotteryInfo.win_status)
  const luckyInfo = raw.user_lucky_info || raw.userLuckyInfo || null
  const isWin = winStatus === 1 || Boolean(luckyInfo)
  const drawFinished = status === 2 || winStatus === 1 || winStatus === 2
  const winDiamonds = Number(
    luckyInfo?.grant_count ??
    luckyInfo?.diamond_count ??
    luckyInfo?.amount ??
    0
  ) || 0

  return {
    lotteryId,
    isWin,
    drawFinished,
    winDiamonds
  }
}

/**
 * parseRedPacketOutcome 方法：解析红包领取结果，兼容多种返回字段。
 */
function parseRedPacketOutcome(raw) {
  if (!raw || typeof raw !== 'object') return null
  const receiveInfo = raw.receive_info || raw.receiveInfo || raw.data?.receive_info || null
  if (!receiveInfo || typeof receiveInfo !== 'object') return null
  const isWin = isTruthyWinFlag(receiveInfo.is_win) ||
    Number(receiveInfo.win_status || 0) === 1 ||
    Number(receiveInfo.status || 0) === 2
  if (!isWin) return null
  const reward = Number(
    receiveInfo.amount ??
    receiveInfo.diamond_count ??
    receiveInfo.diamond ??
    receiveInfo.reward_amount ??
    0
  ) || 0
  return { isWin: true, reward }
}

/**
 * updateLotteryHistoryOutcome 方法：更新福袋历史记录开奖结果。
 */
function updateLotteryHistoryOutcome(accountId, outcome) {
  if (!outcome?.drawFinished) return { updated: false, record: null }
  const targetStatus = outcome.isWin ? 'won' : 'lost'
  const targetReason = outcome.isWin ? '中奖' : '未中奖'
  const targetLotteryId = String(outcome.lotteryId || '').trim()

  let index = -1
  if (targetLotteryId) {
    index = lotteryHistory.value.findIndex(item =>
      item.accountId === accountId &&
      String(item.lotteryId || '').trim() === targetLotteryId
    )
  }
  if (index < 0) {
    index = lotteryHistory.value.findIndex(item =>
      item.accountId === accountId &&
      String(item.resultStatus || 'pending') === 'pending'
    )
  }
  if (index < 0) return { updated: false, record: null }

  const current = lotteryHistory.value[index]
  if (current.resultStatus === 'won' || current.resultStatus === 'lost') {
    return { updated: false, record: current }
  }

  const nextRecord = {
    ...current,
    lotteryId: current.lotteryId || targetLotteryId,
    resultStatus: targetStatus,
    resultReason: targetReason,
    rewardAmount: Number(outcome.winDiamonds || current.rewardAmount || 0)
  }
  lotteryHistory.value[index] = nextRecord
  return { updated: true, record: nextRecord }
}

/**
 * incrementLotteryWinStats 方法：累计账号福袋中奖统计，并做去重保护。
 */
function incrementLotteryWinStats(account, accountId, lotteryId, rewardAmount = 0) {
  if (!account) return false
  const key = makeLotteryOutcomeKey(accountId, lotteryId) || `${accountId}:wallet-fallback:${String(lotteryId || '').trim() || Date.now()}`
  if (countedLotteryWinKeys.has(key)) return false
  countedLotteryWinKeys.add(key)
  account.lotteryWinCount++
  account.todayLotteryWinCount++
  account.lotteryWonDiamonds += Number(rewardAmount || 0)
  account.todayLotteryWonDiamonds += Number(rewardAmount || 0)
  return true
}

/**
 * findPendingLotteryHistoryRecord 方法：查找当前账号最可能对应本次到账的待开奖记录。
 */
function findPendingLotteryHistoryRecord(accountId) {
  const now = Date.now()
  let bestIndex = -1
  let bestDistance = Number.POSITIVE_INFINITY

  lotteryHistory.value.forEach((item, index) => {
    if (item.accountId !== accountId) return
    if (String(item.resultStatus || 'pending') !== 'pending') return
    const endTime = Number(item.endTime || 0)
    const joinedAt = Number(item.joinedAt || 0)
    const anchorTime = endTime > 0 ? endTime : joinedAt
    if (!anchorTime) return
    const distance = Math.abs(now - anchorTime)
    if (distance > 10 * 60 * 1000) return
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  })

  if (bestIndex < 0) return null
  return {
    index: bestIndex,
    record: lotteryHistory.value[bestIndex]
  }
}

/**
 * applyWalletWinFallback 方法：当钱包已到账但开奖结果事件未到时，用待开奖记录兜底回填中奖统计。
 */
function applyWalletWinFallback(accountId, account, rewardDelta) {
  const reward = Number(rewardDelta || 0)
  if (!account || reward <= 0) return false

  const matched = findPendingLotteryHistoryRecord(accountId)
  if (!matched?.record) return false

  const record = matched.record
  const lotteryId = String(record.lotteryId || '').trim()
  const fallbackKey = lotteryId
    ? makeLotteryOutcomeKey(accountId, lotteryId)
    : `${accountId}:wallet-fallback:${matched.index}:${Number(record.joinedAt || 0)}`
  if (!fallbackKey || countedWalletFallbackKeys.has(fallbackKey)) return false

  countedWalletFallbackKeys.add(fallbackKey)

  const nextRecord = {
    ...record,
    resultStatus: 'won',
    resultReason: '中奖',
    rewardAmount: reward
  }
  lotteryHistory.value[matched.index] = nextRecord
  incrementLotteryWinStats(account, accountId, lotteryId || fallbackKey, reward)
  addLog(`🎉 [${account.nickname}] 已按到账结果回填福袋中奖：${reward} 钻石`, 'success')
  reportLotteryOutcomeFeedback(accountId, nextRecord, {
    lotteryId,
    isWin: true,
    drawFinished: true,
    winDiamonds: reward
  }).catch(() => {})
  return true
}

/**
 * getPoolFeedbackServerUrl 方法：获取当前可用的服务端反馈地址。
 */
function getPoolFeedbackServerUrl() {
  if (config.value.poolServer?.enabled === false) return ''
  return normalizePoolServerUrl(config.value.poolServer?.url || '')
}

/**
 * reportLotteryOutcomeFeedback 方法：将开奖结果回流到服务端学习桶。
 */
async function reportLotteryOutcomeFeedback(accountId, record, outcome) {
  const baseUrl = getPoolFeedbackServerUrl()
  if (!baseUrl || !record || !outcome?.drawFinished) return false

  const roomId = String(record.roomId || '').trim()
  const lotteryId = String(record.lotteryId || '').trim()
  if (!roomId || !lotteryId) return false

  let predictedProbability = Number(record.predictedProbability || 0)
  if (predictedProbability > 1) predictedProbability /= 100

  const result = await reportPoolTaskFeedback(baseUrl, {
    clientId: resolvePoolClientId(),
    accountId,
    event: outcome.isWin ? 'draw_won' : 'draw_lost',
    candidateKey: `${roomId}:${lotteryId}`,
    roomId,
    lotteryId,
    lotteryName: record.lotteryName || '',
    authorNickname: record.authorNickname || '',
    conditions: Array.isArray(record.conditions) ? record.conditions : [],
    joinTotal: Number(record.joinTotal || 0),
    luckyCount: Number(record.luckyCount || 0),
    onlineTotal: Number(record.onlineTotal || 0),
    totalAmount: Number(record.totalAmount || 0),
    prizeType: record.prizeType ?? null,
    prizeInfo: (record.prizeInfo && typeof record.prizeInfo === 'object') ? record.prizeInfo : {},
    predictedProbability,
    predictedJoinTotal: Number(record.predictedJoinTotal || 0),
    remainingSec: Math.max(0, Number(record.remainingSec || 0)),
    endTime: Number(record.endTime || 0),
    startTime: Number(record.startTime || 0),
    joinedAt: Number(record.joinedAt || 0),
    rewardAmount: Number(outcome.winDiamonds || 0),
    joinMode: record.joinMode || '',
    reason: outcome.isWin ? 'won' : 'lost'
  })
  return result.ok
}

/**
 * resolveUserInfoWithRetry 方法：解析并返回用户信息重试。
 */
async function resolveUserInfoWithRetry(accountId, fromLoginToken = null) {
  if (!ipcRenderer) return fromLoginToken || null
  if (fromLoginToken?.nickname) return fromLoginToken

  for (let i = 0; i < 4; i++) {
    try {
      const ur = await ipcRenderer.invoke('get-user-info', accountId)
      if (ur.success && ur.userInfo?.nickname) return ur.userInfo
    } catch (_) {}
    await sleep(1200)
  }
  return fromLoginToken || null
}

const responsiveColumns = computed(() => {
  const actionFixed = undefined
  const compact = windowWidth.value < 1480
  /**
   * formatMetric 方法：将数值格式化为中文千分位字符串，用于界面展示。
   */
  const formatMetric = (value) => Number(value || 0).toLocaleString('zh-CN')
  /**
   * getTaskStageText 方法：格式化当前任务阶段文案。
   */
  const getTaskStageText = (stage) => ({
    claimed: '待参与',
    preheating: '预热中',
    joining: '参与中',
    waiting_draw: '等开奖',
    post_draw_stay: '停留中'
  }[String(stage || '')] || '')

  const base = [
    {
      title: '昵称',
      key: 'nickname',
      width: isMobile.value ? 92 : 110,
      ellipsis: { tooltip: true },
      render: (row) => {
        const displayName = normalizeNickname(row.nickname || '')
        return h('div', { class: 'account-name-cell' }, [
          h('span', { class: 'account-name-text', title: displayName || '' }, displayName || '未命名账号')
        ])
      }
    },
    {
      title: '状态', key: 'state', width: isMobile.value ? 108 : 138,
      render: (row) => {
        const text = { waiting: '等待', opened: '已打开', running: '运行', paused: '暂停', error: '错误' }
        const stageText = getTaskStageText(row.currentTaskStage)
        const leaseText = Number(row.currentTaskLeaseRemainingSec || 0) > 0 ? `${Number(row.currentTaskLeaseRemainingSec || 0)}s` : ''
        const chips = [
          h('span', { class: `status-chip status-chip--${row.state || 'waiting'}` }, text[row.state] || '等待')
        ]
        if (stageText) {
          chips.push(h('span', { class: 'status-chip status-chip--stage' }, stageText))
        } else if (row.scanRole === 'scanner' && row.state === 'running') {
          chips.push(h('span', { class: 'status-chip status-chip--scan' }, '采集'))
        }
        if (stageText && leaseText) {
          chips.push(h('span', { class: 'status-chip status-chip--time' }, leaseText))
        }
        return h('div', { class: 'account-state-cell' }, chips)
      }
    },
    {
      title: '实时总数',
      key: 'totalDiamonds',
      width: compact ? 82 : 94,
      align: 'right',
      render: (row) => {
        return h('span', { class: 'metric-cell' }, formatMetric(row.totalDiamonds))
      }
    },
    {
      title: '中奖钻石',
      key: 'winDiamonds',
      width: compact ? 82 : 94,
      align: 'right',
      render: (row) => {
        const totalWin = Number(row.todayLotteryWonDiamonds || 0) + Number(row.todayRedPacketWonDiamonds || 0)
        return h('span', { class: 'metric-cell metric-win' }, formatMetric(totalWin))
      }
    },
    {
      title: '消耗钻石',
      key: 'costDiamonds',
      width: compact ? 82 : 94,
      align: 'right',
      render: (row) => h('span', { class: 'metric-cell metric-cost' }, formatMetric(row.todayConsumedDiamonds))
    },
    {
      title: '参与次数',
      key: 'participationCount',
      width: compact ? 76 : 88,
      align: 'right',
      render: (row) => h('span', { class: 'metric-cell' }, formatMetric(row.participationCount))
    }
  ]

  base.push({
    title: '操作',
    key: 'actions',
    width: compact ? 100 : 116,
    fixed: actionFixed,
    render: (row) => h('div', { class: 'account-actions-cell' }, [
      h(NButton, {
        size: compact ? 'tiny' : 'small',
        type: row.state === 'running' ? 'warning' : 'primary',
        secondary: true,
        strong: true,
        onClick: () => toggleAccount(row)
      }, { default: () => row.state === 'running' ? '暂停' : '启动' }),
      h(NButton, {
        size: compact ? 'tiny' : 'small',
        quaternary: true,
        type: 'error',
        onClick: () => removeAccount(row.id)
      }, { default: () => '删除' })
    ])
  })

  return base
})

const accountTableScrollX = computed(() => {
  if (!isMobile.value) return undefined
  return responsiveColumns.value.reduce((sum, col) => sum + Number(col.width || 120), 0) + 24
})

/**
 * appendLotteryHistory 方法：追加福袋历史记录。
 */
function appendLotteryHistory(record) {
  if (!record || typeof record !== 'object') return
  if (String(record.joinStatus || 'success') === 'failed') return
  const status = String(record.resultStatus || 'pending')
  const normalizedStatus = (status === 'won' || status === 'lost') ? status : 'pending'
  const normalized = {
    accountId: record.accountId || '',
    accountNickname: record.accountNickname || record.accountId || '未知账号',
    roomId: record.roomId || '',
    webRid: record.webRid || '',
    lotteryId: record.lotteryId || record.lottery_id || '',
    authorNickname: record.authorNickname || '',
    lotteryName: record.lotteryName || '',
    predictedProbability: Number(record.predictedProbability || 0),
    predictedJoinTotal: Number(record.predictedJoinTotal || 0),
    joinTotal: Number(record.joinTotal || 0),
    luckyCount: Number(record.luckyCount || 0),
    onlineTotal: Number(record.onlineTotal || 0),
    totalAmount: Number(record.totalAmount || 0),
    prizeType: record.prizeType ?? null,
    prizeInfo: (record.prizeInfo && typeof record.prizeInfo === 'object') ? record.prizeInfo : {},
    conditions: Array.isArray(record.conditions) ? record.conditions : [],
    remainingSec: Math.max(0, Number(record.remainingSec || 0)),
    serverScore: Number(record.serverScore || 0),
    joinMode: record.joinMode || 'API',
    joinStatus: 'success',
    resultStatus: normalizedStatus,
    resultReason: record.resultReason || (normalizedStatus === 'won' ? '中奖' : (normalizedStatus === 'lost' ? '未中奖' : '待开奖')),
    joinedAt: Number(record.joinedAt || Date.now()),
    endTime: Number(record.endTime || 0),
    rewardAmount: Number(record.rewardAmount || 0),
    startTime: Number(record.startTime || 0)
  }
  lotteryHistory.value = [normalized, ...lotteryHistory.value].slice(0, 300)
}

/**
 * parseAccountSeq 方法：解析账号序号。
 */
function parseAccountSeq(accountId) {
  const m = String(accountId || '').match(/account_(\d+)/)
  return m ? Number(m[1]) : 0
}

/**
 * getNextAccountSeq 方法：获取下一项账号序号。
 */
function getNextAccountSeq() {
  let max = 0
  accounts.value.forEach((a) => {
    max = Math.max(max, parseAccountSeq(a.id))
  })
  pendingCreateAccountIds.forEach((id) => {
    max = Math.max(max, parseAccountSeq(id))
  })
  return max + 1
}

/**
 * addAccount 方法：添加账号。
 */
function addAccount() {
  if (licenseAddLimitReached.value) {
    addLog('⚠️ 未授权状态下最多只能添加 1 个账号，请先激活授权', 'warning')
    return
  }
  const next = getNextAccountSeq()
  const accountId = `account_${next}`
  if (pendingCreateAccountIds.has(accountId)) return
  pendingCreateAccountIds.add(accountId)

  const acc = createAccountModel({
    id: accountId,
    nickname: `账号${next}`,
    state: 'waiting',
    token: null
  })
  addLog(`请为 ${acc.nickname} 扫码登录，登录成功后才会加入账号列表`)
  startAccountWithLogin(acc, {
    autoStartAfterLogin: true
  })
}

/**
 * restartAccountWithLogin 方法：当现有账号 token 失效时，复用原账号重新扫码登录并在成功后自动恢复启动。
 */
function restartAccountWithLogin(account, reason = '') {
  if (!account?.id) return
  lotteryManager.stopAccount(account.id)
  clearAccountDispatchState(account)
  pendingCreateAccountIds.add(account.id)
  account.state = 'opened'
  if (reason) {
    addLog(`⚠️ 账号 ${account.nickname} ${reason}，请重新扫码登录，登录成功后将更新当前账号并自动继续`, 'warning')
  } else {
    addLog(`⚠️ 账号 ${account.nickname} 需要重新扫码登录，登录成功后将更新当前账号并自动继续`, 'warning')
  }
  startAccountWithLogin(account, {
    autoStartAfterLogin: true,
    keepExistingAccount: true
  })
}

/**
 * startAccountWithLogin 方法：启动账号登录。
 */
async function startAccountWithLogin(account, options = {}) {
  if (!ipcRenderer) {
    pendingCreateAccountIds.delete(account.id)
    return
  }

  let timer = null
  /**
   * clearLoginWatchers 方法：清理登录轮询定时器，避免重复触发。
   */
  const clearLoginWatchers = () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  try {
    const res = await ipcRenderer.invoke('launch-browser', account.id)
    if (!res.success) {
      pendingCreateAccountIds.delete(account.id)
      return addLog(`启动失败: ${res.error}`, 'error')
    }
    account.state = 'opened'
    await ipcRenderer.invoke('navigate-to', { accountId: account.id, url: 'https://www.douyin.com' })
    timer = setInterval(async () => {
      if (!pendingCreateAccountIds.has(account.id)) {
        clearLoginWatchers()
        return
      }
      const tr = await ipcRenderer.invoke('get-login-token', account.id)
      if (tr.success && tr.isLoggedIn) {
        clearLoginWatchers()
        const stableSnapshot = await resolveStableLoginSnapshot(account.id, tr)
        const stableTokenInfo = stableSnapshot?.tokenInfo || tr.tokenInfo
        const stableUserInfo = stableSnapshot?.userInfo || tr.userInfo
        const info = await resolveUserInfoWithRetry(account.id, stableUserInfo)
        const fallbackInfo = {
          nickname: account.nickname,
          userId: account.userId || account.id
        }
        let saveResult = await ipcRenderer.invoke('save-token', { accountId: account.id, tokenInfo: stableTokenInfo, userInfo: info })
        if (!saveResult.success) {
          saveResult = await ipcRenderer.invoke('save-token', { accountId: account.id, tokenInfo: stableTokenInfo, userInfo: fallbackInfo })
        }
        const persistedTokenResult = await ipcRenderer.invoke('load-token', account.id).catch(() => ({ success: false }))
        const persistedTokenInfo = persistedTokenResult?.success && persistedTokenResult?.tokenInfo
          ? persistedTokenResult.tokenInfo
          : stableTokenInfo

        const finalNickname = normalizeNickname(info?.nickname || saveResult.savedInfo?.nickname || account.nickname)
        const finalUserId = info?.userId || saveResult.savedInfo?.userId || account.userId || account.id
        const nextState = {
          nickname: finalNickname,
          userId: finalUserId,
          token: persistedTokenInfo.sessionid || persistedTokenInfo.sessionid_ss,
          state: 'waiting'
        }
        const updatedAccount = upsertLoggedInAccount(account, nextState, options)
        pendingCreateAccountIds.delete(account.id)

        if (saveResult.success) {
          addLog(`✅ [${finalNickname}] 登录成功，账号列表已更新`, 'success')
        } else {
          addLog(`⚠️ [${finalNickname}] 登录成功，账号列表已更新，但本地保存信息不完整`, 'warning')
        }

        if (options.autoStartAfterLogin === true) {
          const latestAccount = updatedAccount || accounts.value.find(a => a.id === account.id)
          if (latestAccount) {
            setTimeout(() => {
              startAccountScanning(latestAccount, {
                reuseLoggedInBrowser: true,
                tokenInfo: persistedTokenInfo
              })
            }, 300)
          }
        }
      }
    }, 3000)
  } catch (e) {
    pendingCreateAccountIds.delete(account.id)
    clearLoginWatchers()
    addLog(`错误: ${e.message}`, 'error')
  }
  finally {
    if (!pendingCreateAccountIds.has(account.id)) {
      clearLoginWatchers()
    }
  }
}

/**
 * toggleAccount 方法：处理切换账号。
 */
function toggleAccount(account) {
  if (account.state === 'running') {
    lotteryManager.stopAccount(account.id)
    account.state = 'paused'
    clearAccountDispatchState(account)
    addLog(`账号 ${account.nickname} 已暂停`)
  } else {
    startAccountScanning(account)
  }
}

/**
 * startAccountScanning 方法：启动账号扫描。
 */
async function startAccountScanning(account, options = {}) {
  const providedTokenInfo = options?.tokenInfo || null
  const reuseLoggedInBrowser = options?.reuseLoggedInBrowser === true
  if ((!account.token && !providedTokenInfo) || !ipcRenderer) return
  if (account._starting) return
  account._starting = true
  try {
    if (!reuseLoggedInBrowser) {
      const lr = await ipcRenderer.invoke('launch-browser', account.id)
      if (!lr.success) return
      const tr = await ipcRenderer.invoke('load-token', account.id)
      if (!tr.success || !tr.tokenInfo) {
        account.state = 'waiting'
        restartAccountWithLogin(account, '本地 Token 已失效或不存在')
        return
      }
      const setRes = await ipcRenderer.invoke('set-cookies', { accountId: account.id, tokenInfo: tr.tokenInfo })
      if (!setRes?.success || setRes?.isLoginCookieReady === false) {
        account.state = 'waiting'
        restartAccountWithLogin(account, `Token 写入失败: ${setRes?.error || '关键登录 cookie 未写入成功'}`)
        return
      }
      await ipcRenderer.invoke('navigate-to', { accountId: account.id, url: 'https://www.douyin.com' })
    }
    account.state = 'running'
    lotteryManager.startAccount(account, config.value, {
      onStatusUpdate: (upd) => queueAccountUpdate(upd),
      onLotteryListUpdate: ({ accountId, list }) => queueLotteryListUpdate(accountId, list),
      onHistoryRecord: (record) => appendLotteryHistory(record),
      onLog: (m, t) => addLog(m, t),
      onTokenInvalid: async ({ id, reason }) => {
        const latestAccount = accounts.value.find(item => item.id === id)
        if (!latestAccount) return
        latestAccount.state = 'waiting'
        restartAccountWithLogin(latestAccount, reason || '本地 Token 已过期')
      }
    }, {
      reuseLoggedInBrowser,
      tokenInfo: providedTokenInfo
    })
  } catch (e) { addLog(`启动失败: ${e.message}`, 'error') }
  finally { account._starting = false }
}

/**
 * removeAccount 方法：移除账号。
 */
async function removeAccount(id) {
  if (!ipcRenderer) return
  const account = accounts.value.find(a => a.id === id)
  const nickname = String(account?.nickname || id || '该账号').trim()
  const confirmed = typeof window !== 'undefined'
    ? window.confirm(`确认删除账号“${nickname}”？删除后需要重新扫码登录才能恢复。`)
    : true
  if (!confirmed) return
  lotteryManager.stopAccount(id)
  await ipcRenderer.invoke('delete-token', id)
  clearLotteryOutcomeCacheByAccount(id)
  pendingAccountUpdates.delete(id)
  pendingLotteryListUpdates.delete(id)
  accounts.value = accounts.value.filter(a => a.id !== id)
  if (lotteriesByAccount.value?.[id]) {
    delete lotteriesByAccount.value[id]
  }
}

/**
 * handleBlockRoom 方法：处理屏蔽直播间。
 */
function handleBlockRoom(roomId) {
  lotteryManager.addBlockList(roomId)
  // 同时也需要从当前 App 的 lotteriesByAccount 缓存中移除该直播间的福袋，保证 UI 立即更新
  Object.keys(lotteriesByAccount.value).forEach(accId => {
    lotteriesByAccount.value[accId] = lotteriesByAccount.value[accId].filter(l => l.roomId !== roomId)
  })
  addLog(`🚫 已屏蔽直播间: ${roomId}`)
}

/**
 * addLog 方法：追加一条运行日志并驱动日志区域滚动更新。
 */
function addLog(message, type = 'info') {
  const text = String(message || '')
  if (FRONTEND_LOG_SUPPRESS_PATTERNS.some(pattern => pattern.test(text))) {
    return
  }
  const entry = buildLogEntry(message, type)
  if (tryMergeLogEntry(pendingLogs, entry)) return
  if (tryMergeLogEntry(logs.value, entry)) return
  pendingLogs.push(entry)
  scheduleLogFlush()
}
</script>

<style>
html,
body,
#app {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
}

body {
  overflow: hidden;
  background: #e8edf4;
}
</style>

<style scoped>
.app-root {
  width: 100%;
  height: 100%;
}

.desktop-shell {
  --shell-bg-start: #f1f4f8;
  --shell-bg-end: #e5ebf3;
  --card-border: #e2e9f2;
  --card-shadow: rgba(15, 23, 42, 0.08);
  --card-shadow-strong: rgba(15, 23, 42, 0.12);
  width: 100%;
  height: 100vh;
  min-height: 100vh;
  padding: 0;
  box-sizing: border-box;
  background:
    radial-gradient(900px 500px at -12% -14%, rgba(24, 160, 88, 0.16), transparent 70%),
    radial-gradient(1040px 620px at 112% -8%, rgba(77, 144, 255, 0.13), transparent 66%),
    linear-gradient(180deg, var(--shell-bg-start) 0%, var(--shell-bg-end) 100%);
}

.window-frame {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 0;
  border: 0;
  box-shadow: none;
  overflow: hidden;
  background: #eef3f7;
  font-family: 'SF Pro Display', 'PingFang SC', 'MiSans', 'Helvetica Neue', sans-serif;
}

.app-container {
  display: flex;
  flex: 1;
  min-height: 0;
  background:
    radial-gradient(1200px 560px at -8% -18%, rgba(24, 160, 88, 0.14), transparent 67%),
    radial-gradient(980px 640px at 112% -4%, rgba(68, 132, 255, 0.12), transparent 64%),
    linear-gradient(180deg, #f9fbfe 0%, #eef3f8 100%);
  overflow: hidden;
}

.header-base {
  height: 66px;
  background-color: rgba(255, 255, 255, 0.9);
  border-bottom: 1px solid #e3e9f1;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  box-sizing: border-box;
}

/* 侧边栏样式 */
.sidebar {
  width: 278px;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.93) 0%, rgba(250, 252, 255, 0.91) 100%);
  border-right: 1px solid #d8e1ed;
  box-shadow: 8px 0 18px rgba(31, 41, 55, 0.045);
  backdrop-filter: blur(10px);
  z-index: 10;
}
.sidebar-header {
  padding: 0 16px;
  gap: 10px;
}
.title-text {
  margin: 0;
  font-size: 29px;
  font-weight: 700;
  color: #203247;
  letter-spacing: 0.3px;
}

/* 主体内容样式 */
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

/* 内容体布局 */
.content-body {
  flex: 1;
  padding: 14px 16px 16px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(250px, 22vw, 300px);
  gap: 14px;
  overflow: hidden;
  box-sizing: border-box;
  min-height: 0;
}
.column-left {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  min-width: 0;
  min-height: 0;
}
.column-right {
  display: flex;
  width: 100%;
  max-width: 300px;
  min-width: 0;
  height: 100%;
  min-height: 0;
}

@media (max-width: 1200px) {
  .content-body {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(320px, auto) minmax(280px, 40vh);
  }
}

@media (max-width: 900px) {
  .desktop-shell {
    padding: 0;
  }

  .window-frame {
    border-radius: 0;
    border: 0;
    box-shadow: none;
  }

  .app-container {
    flex-direction: column;
    height: auto;
    min-height: 100vh;
    overflow: auto;
  }

  .sidebar {
    width: 100%;
    border-right: 0;
    border-bottom: 1px solid #e7ece8;
  }

  .main-content {
    min-height: 0;
  }

  .content-body {
    padding: 12px;
    gap: 12px;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto;
    overflow: visible;
  }

  .column-left,
  .column-right {
    height: auto;
    min-height: 320px;
  }
}

.account-name-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  color: #2b3a4c;
}

.account-name-cell {
  display: flex;
  align-items: center;
  min-width: 0;
  min-height: 28px;
}

.account-state-cell {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
  min-height: 28px;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1;
  font-weight: 700;
  white-space: nowrap;
  border: 1px solid transparent;
  box-sizing: border-box;
}

.status-chip--waiting {
  color: #6a7788;
  background: #f4f7fb;
  border-color: #dde6f0;
}

.status-chip--opened {
  color: #2d6cdf;
  background: #edf4ff;
  border-color: #d7e5ff;
}

.status-chip--running {
  color: #0f9d63;
  background: #e9f8f0;
  border-color: #caebda;
}

.status-chip--paused {
  color: #d98824;
  background: #fff5e7;
  border-color: #f5ddba;
}

.status-chip--error {
  color: #d84c4c;
  background: #fff0f0;
  border-color: #f4caca;
}

.status-chip--stage {
  color: #40546d;
  background: #f4f7fb;
  border-color: #dfe6ef;
}

.status-chip--scan {
  color: #0f7a86;
  background: #eaf8fb;
  border-color: #c9e9ef;
}

.status-chip--time {
  color: #64748b;
  background: #eef2f7;
  border-color: #d7dee8;
  font-family: 'JetBrains Mono', 'SF Pro Display', monospace;
}

.metric-cell {
  display: inline-block;
  min-width: 100%;
  text-align: right;
  font-size: 12px;
  font-weight: 700;
  color: #2f3d52;
  font-family: 'JetBrains Mono', 'SF Pro Display', monospace;
}

.metric-win {
  color: #0f9d63;
}

.metric-cost {
  color: #e56f33;
}

.account-actions-cell {
  display: flex;
  align-items: center;
  gap: 4px;
}

.license-modal {
  width: min(560px, calc(100vw - 40px));
}

.license-dialog {
  overflow: hidden;
  border: 1px solid rgba(224, 231, 239, 0.96);
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 28px 72px rgba(15, 23, 42, 0.18);
  backdrop-filter: blur(22px);
}

.license-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 26px 30px 24px;
  border-bottom: 1px solid #e8edf4;
}

.license-dialog__title {
  font-size: 21px;
  font-weight: 800;
  color: #1f2d3d;
  letter-spacing: 0.2px;
}

.license-dialog__close {
  width: 38px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: #94a3b8;
  font-size: 32px;
  line-height: 1;
  cursor: pointer;
  transition: background-color 0.18s ease, color 0.18s ease;
}

.license-dialog__close:hover:not(:disabled) {
  background: #f4f7fb;
  color: #64748b;
}

.license-dialog__close:disabled {
  cursor: not-allowed;
  opacity: 0.56;
}

.license-dialog__body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 28px 30px 34px;
}

.license-dialog__status-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}

.license-dialog__status-label {
  color: #334155;
  font-size: 16px;
  font-weight: 800;
}

.license-dialog__status-value {
  font-size: 17px;
  font-weight: 800;
}

.license-dialog__status-value--success {
  color: #18a058;
}

.license-dialog__status-value--warning {
  color: #dd8b1c;
}

.license-dialog__status-value--danger {
  color: #ef4444;
}

.license-dialog__meta {
  color: #94a3b8;
  font-size: 13px;
  line-height: 1.6;
}

.license-dialog__bind-card {
  display: grid;
  grid-template-columns: 176px minmax(0, 1fr);
  gap: 18px;
  padding: 18px;
  border-radius: 22px;
  background: linear-gradient(180deg, #f8fbff 0%, #f4f8fd 100%);
  border: 1px solid #e3ebf5;
}

.license-dialog__qr-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 176px;
  border-radius: 18px;
  background: #ffffff;
  box-shadow: inset 0 0 0 1px rgba(220, 229, 240, 0.98);
}

.license-dialog__qr {
  border-radius: 14px;
}

.license-dialog__qr-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 16px;
  color: #94a3b8;
  font-size: 14px;
  font-weight: 700;
  text-align: center;
  line-height: 1.6;
}

.license-dialog__bind-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.license-dialog__bind-title,
.license-dialog__manual-title {
  color: #243548;
  font-size: 15px;
  font-weight: 800;
}

.license-dialog__bind-desc {
  color: #516275;
  font-size: 13px;
  line-height: 1.7;
}

.license-dialog__bind-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.license-dialog__bind-meta span {
  display: inline-flex;
  align-items: center;
  padding: 5px 10px;
  border-radius: 999px;
  background: rgba(24, 160, 88, 0.08);
  color: #18a058;
  font-size: 12px;
  font-weight: 700;
}

.license-dialog__bind-token {
  padding: 10px 12px;
  border-radius: 14px;
  background: #ffffff;
  border: 1px dashed #cbd5e1;
  color: #334155;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.6;
  word-break: break-all;
}

.license-dialog__bind-extra {
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
}

.license-dialog__bind-countdown {
  font-size: 13px;
  font-weight: 800;
}

.license-dialog__bind-countdown--success {
  color: #18a058;
}

.license-dialog__bind-countdown--warning {
  color: #dd8b1c;
}

.license-dialog__bind-countdown--danger {
  color: #ef4444;
}

.license-dialog__bind-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 4px;
}

.license-dialog__bind-button {
  min-width: 116px;
}

.license-dialog__input :deep(.n-input) {
  border-radius: 18px;
}

.license-dialog__input :deep(.n-input-wrapper) {
  display: flex;
  align-items: center;
  min-height: 66px;
  padding: 0 18px;
  border-radius: 18px;
  background: #ffffff;
  box-shadow: inset 0 0 0 1px #dce5f0;
}

.license-dialog__input :deep(.n-input__input) {
  display: flex;
  align-items: center;
}

.license-dialog__input :deep(.n-input__input-el) {
  height: 34px;
  line-height: 34px;
  padding: 0;
}

.license-dialog__input :deep(.n-input-wrapper:hover) {
  box-shadow: inset 0 0 0 1px #86d7b3;
}

.license-dialog__input :deep(.n-input-wrapper.n-input-wrapper--focus),
.license-dialog__input :deep(.n-input-wrapper.n-input-wrapper--stateful) {
  box-shadow:
    0 0 0 4px rgba(24, 160, 88, 0.12),
    inset 0 0 0 1.5px #20bb78;
}

.license-dialog__input :deep(input) {
  font-size: 16px;
  line-height: 30px;
}

.license-dialog__hint {
  min-height: 22px;
  font-size: 13px;
  line-height: 1.6;
}

.license-dialog__hint--success {
  color: #18a058;
}

.license-dialog__hint--danger {
  color: #ef4444;
}

.license-dialog__footer {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 22px 30px 24px;
  border-top: 1px solid #e8edf4;
  background: linear-gradient(180deg, #f7f9fc 0%, #f3f6fa 100%);
}

.license-dialog__button {
  min-width: 112px;
  height: 50px;
  border-radius: 16px;
  font-size: 16px;
  font-weight: 800;
}

.license-dialog__button--ghost {
  color: #334155;
  background: #ffffff;
  border-color: #dce4ee;
}

.license-dialog__button--primary {
  min-width: 168px;
}

@media (max-width: 640px) {
  .license-dialog__bind-card {
    grid-template-columns: 1fr;
  }
}

.hide-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
.hide-scrollbar::-webkit-scrollbar { display: none; }
</style>
