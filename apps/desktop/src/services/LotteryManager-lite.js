import { calcAdaptiveScanProfile, createScanRiskState, updateScanRiskState } from './scanRiskPolicy'
import {
  getRedPacketAveragePerWinner as getLotteryAveragePerWinner,
  isPhysicalPrizeLottery
} from '../utils/lotteryRules'
import { createLogger } from '../utils/logger'
import {
  getLotteryInfo as fetchLotteryInfoWithProfile,
  searchLiveByAll as collectLiveByAll,
  searchLiveRoomCategory as collectLiveRoomCategory,
  startCollectLive as collectLiveByCategory
} from './scanCollector'
import {
  attendLotteryWithRetry as executeAttendWithRetry,
  autoJoinRedPacketLoop as executeAutoJoinRedPacketLoop,
  closeLiveStreamRendering as executeCloseLiveStreamRendering,
  ensureCloseLiveStreamRendering as executeEnsureCloseLiveStreamRendering,
  isAttendSuccessLike as detectAttendSuccessLike,
  joinLotteryByUI as executeJoinLotteryByUI,
  joinRedPacketByUI as executeJoinRedPacketByUI,
  openLiveStreamRendering as executeOpenLiveStreamRendering,
  waitForLiveRoomReady as executeWaitForLiveRoomReady
} from './joinExecutor'
import {
  claimPoolAllScanCursor,
  claimPoolTask,
  fetchPoolLearningDebug,
  fetchPoolScanAssignment,
  fetchPoolTop,
  fetchPoolTaskDebug,
  finishPoolTask,
  normalizePoolServerUrl,
  persistPoolServerUrl,
  reportPoolAllScanCursor,
  releasePoolTask,
  requestPoolScanPermit,
  reportPoolTaskFeedback,
  renewPoolTask,
  resolvePoolClientId,
  resolvePoolServerUrl,
  upsertPoolCandidates
} from './poolClient'

// 使用 require 导入 electron (在 Electron 渲染进程中)
let ipcRenderer
function getIpcRenderer() {
  if (typeof window !== 'undefined' && window.electronAPI) {
    try {
      ipcRenderer = window.electronAPI
      return ipcRenderer
    } catch (e) {
      const fallbackLogger = createLogger('lottery-manager')
      fallbackLogger.warn('无法加载 electron ipcRenderer:', e)
    }
  }
  if (typeof window !== 'undefined' && typeof window.require === 'function') {
    try {
      const electron = window.require('electron')
      const rawIpc = electron?.ipcRenderer
      if (rawIpc && typeof rawIpc.invoke === 'function') {
        ipcRenderer = {
          invoke: rawIpc.invoke.bind(rawIpc),
          on(channel, handler) {
            const wrapped = (_event, ...args) => handler(...args)
            rawIpc.on(channel, wrapped)
            return () => rawIpc.removeListener(channel, wrapped)
          }
        }
        return ipcRenderer
      }
    } catch (e) {
      const fallbackLogger = createLogger('lottery-manager')
      fallbackLogger.warn('无法通过 require 加载 electron ipcRenderer:', e)
    }
  }
  return null
}
ipcRenderer = getIpcRenderer()

// 抖音直播分类列表（参考原项目，使用中文名称）
const DEFAULT_CATEGORIES = [
  { id: '0', name: '热门' },
  { id: '1', name: '游戏' },
  { id: '2', name: '娱乐' },
  { id: '4', name: '知识' },
  { id: '3', name: '才艺' },
  { id: '5', name: '二次元' }
]

const MIN_JOIN_WINDOW_SEC = 25
const MAX_JOIN_WINDOW_SEC = 420
const WAIT_SCAN_STAY_THRESHOLD_SEC = 0
const CLAIM_TARGET_MAX_SEC = 150
const EXECUTION_MIN_JOIN_SEC = 8
const SCAN_POOL_REFILL_RESERVE_THRESHOLD = 8
const SCAN_POOL_REFILL_STRONG_THRESHOLD = 3
const POOL_TASK_LEASE_SEC = 35
const POOL_TASK_RENEW_SEC = 12
const WAIT_CHAT_FIRST_MIN_MS = 8000
const WAIT_CHAT_FIRST_MAX_MS = 20000
const WAIT_CHAT_MIN_INTERVAL_MS = 18000
const WAIT_CHAT_MAX_INTERVAL_MS = 42000
const WAIT_RANDOM_CHAT_MESSAGES = [
  '主播加油，蹲福袋~',
  '来了来了，祝大家好运',
  '感谢直播间福利',
  '蹲一手福袋，冲冲冲',
  '祝主播人气越来越高',
  '大家都中福袋',
  '这场直播氛围真不错',
  '祝我也能欧气爆发'
]
const managerLogger = createLogger('lottery-manager')

/**
 * LotteryManager 类：负责账号扫描、福袋池管理、参与调度与统计更新的核心控制器。
 */
class LotteryManager {
  /**
   * constructor 方法：初始化实例状态、缓存映射和默认配置。
   */
  constructor() {
    this.logger = managerLogger
    this.accounts = new Map()
    this.ipc = ipcRenderer
    this.lotteryPoolByAccount = new Map() // accountId -> 福袋列表
    this.collectLoadingByAccount = new Map() // accountId -> 是否正在收集
    this.pauseCollectByAccount = new Map() // accountId -> 是否暂停收集
    this.attendFailureStreak = new Map() // accountId -> consecutive failure count
    this.cycleTimerByAccount = new Map() // accountId -> timer id
    this.scanCycleTimerByAccount = new Map() // accountId -> 后台扫描循环 timer id
    this.minPoolEndTimeByAccount = new Map() // accountId -> 扫描入池最小开奖时间(秒)
    this.scanRiskByAccount = new Map() // accountId -> 风控降速状态
    this.startingAccounts = new Set() // 正在启动中的账号，避免重复启动
    this.blockList = new Set() // 屏蔽的直播间列表 (roomId)
    this.poolServerUrl = resolvePoolServerUrl()
    this.poolTopLimit = 2500
    this.poolClientId = resolvePoolClientId()
    this.lastPoolWarnAt = new Map() // `${accountId}:${type}` -> timestamp(ms)
    this.scanAssignmentCache = null // 服务端下发的客户端扫描分片
    this.scannerAccountId = null // 当前主扫描账号（兼容旧界面字段，真实扫描职责由 scanPlanByAccount 决定）
    this.scanPlanByAccount = new Map() // accountId -> 本地常规扫描分片计划
    this.scanRoleByAccount = new Map() // accountId -> scanner|worker
    this.scanDispatchCursor = 0 // 多账号扫描轮转游标
    this.waitScanDispatchLockUntil = 0 // 等待开奖扫描节流锁
    this.activeScanAccountId = '' // 当前客户端内唯一允许处于扫描态的账号
    this.clientFirstRoundScanDone = false // 本客户端首轮全站快速扫描是否已完成
    this.localScanRoomLeaseById = new Map() // roomId -> expireMs，本客户端内短期去重，避免多个账号重复打详情
    this.allScanSeenRooms = new Map() // roomId -> expireMs，全站扫描跨轮次去重，减少重复拉详情
    this.skipLotteryUntilByAccount = new Map() // accountId -> Map(`${roomId}:${lotteryId}`, expireMs)
    this.waitRandomChatStateByAccount = new Map() // accountId -> { roomId, nextAt, lastContent, sentCount }
    this.claimedTaskByAccount = new Map() // accountId -> 当前服务端租约任务
    this.claimRenewTimerByAccount = new Map() // accountId -> 租约续租 timer
    this.taskStageByAccount = new Map() // accountId -> claimed|joining|waiting_draw|post_draw_stay
    this.poolNoTaskStreakByAccount = new Map() // accountId -> 服务端无任务连续次数
    this.poolUploadQueueByAccount = new Map() // accountId -> 服务端候选上传串行队列
    this.executionTurnsByAccount = new Map() // accountId -> 已获得执行机会次数
    this.lastJoinAtByAccount = new Map() // accountId -> 最近一次成功参与时间戳(ms)
    
    // 默认启用全分类扫描，仍可通过 setCategoryList() 覆盖
    this.categoryList = [...DEFAULT_CATEGORIES]
    
    // 扫描配置（参考原项目）
    this.scanConfig = {
      countPerPage: 15,  // 每页15个（原项目默认值）
      pagesPerCategory: 12,  // 常规扫描每分类页数（等待期可切深扫自动翻页）
      allCount: 24 // 全站接口每次拉取数量（深度扫描）
    }
  }

  /**
   * isPoolServerEnabled 方法：判断是否已配置可用的福袋池服务端地址。
   */
  isPoolServerEnabled() {
    return Boolean(this.poolServerUrl)
  }

  /**
   * getPoolServerConfig 方法：获取福袋池服务端配置。
   */
  getPoolServerConfig() {
    return {
      url: this.poolServerUrl || ''
    }
  }

  /**
   * getPoolClientId 方法：返回当前客户端在共享池中的稳定实例ID。
   */
  getPoolClientId() {
    return String(this.poolClientId || '')
  }

  /**
   * setPoolServerConfig 方法：设置福袋池服务端地址。
   */
  setPoolServerConfig(config = {}, options = {}) {
    const silent = options?.silent === true
    if (config && Object.prototype.hasOwnProperty.call(config, 'url')) {
      const normalized = persistPoolServerUrl(config.url)
      this.poolServerUrl = normalized
    }
    if (!this.poolServerUrl) {
      this.scanAssignmentCache = null
    }
    if (!silent) {
      this.logger.info(`服务端筛选池地址已更新: url=${this.poolServerUrl || '(empty)'}`)
    }
    return this.getPoolServerConfig()
  }

  /**
   * fetchPoolTaskDebugSnapshot 方法：拉取服务端任务调度摘要和租约快照，供界面层展示。
   */
  async fetchPoolTaskDebugSnapshot(config = {}, options = {}) {
    if (!this.isPoolServerEnabled()) {
      return {
        ok: false,
        disabled: true,
        data: null,
        error: 'pool_server_disabled'
      }
    }
    const accountId = String(options.accountId || '').trim()
    return fetchPoolTaskDebug(this.poolServerUrl, {
      limit: Math.max(1, Math.min(200, Number(options.limit || 50))),
      filters: this.buildServerTopFilters(config),
      clientId: this.getPoolClientId(),
      accountId
    })
  }

  /**
   * fetchPoolLearningDebugSnapshot 方法：拉取服务端学习桶调试快照。
   */
  async fetchPoolLearningDebugSnapshot(options = {}) {
    if (!this.isPoolServerEnabled()) {
      return {
        ok: false,
        disabled: true,
        data: null,
        error: 'pool_server_disabled'
      }
    }
    return fetchPoolLearningDebug(this.poolServerUrl, {
      limit: Math.max(1, Math.min(200, Number(options.limit || 60)))
    })
  }

  /**
   * requestPoolScanPermit 方法：请求服务端扫描许可证，控制全站/分类/详情的集群级硬限流。
   */
  async requestPoolScanPermit(accountId, kind, options = {}) {
    if (!this.isPoolServerEnabled()) {
      return { ok: true, data: { ok: true, permit: { allowed: true, kind, retryAfterMs: 0 } } }
    }
    return requestPoolScanPermit(this.poolServerUrl, {
      clientId: this.getPoolClientId(),
      accountId,
      kind,
      cost: Math.max(1, Number(options.cost || 1)),
      timeoutMs: Number(options.timeoutMs || 1600)
    })
  }

  /**
   * claimPoolAllScanCursor 方法：领取共享全站扫描游标，避免多个客户端从头重复拉同一段 maxTime。
   */
  async claimPoolAllScanCursor(accountId, options = {}) {
    if (!this.isPoolServerEnabled()) {
      return { ok: false, error: 'pool_server_disabled' }
    }
    return claimPoolAllScanCursor(this.poolServerUrl, {
      clientId: this.getPoolClientId(),
      accountId,
      leaseTtlMs: Math.max(10000, Number(options.leaseTtlMs || 18000)),
      timeoutMs: Number(options.timeoutMs || 1800)
    })
  }

  /**
   * reportPoolAllScanCursor 方法：回传共享全站扫描游标推进结果。
   */
  async reportPoolAllScanCursor(accountId, options = {}) {
    if (!this.isPoolServerEnabled()) {
      return { ok: false, error: 'pool_server_disabled' }
    }
    return reportPoolAllScanCursor(this.poolServerUrl, {
      clientId: this.getPoolClientId(),
      accountId,
      slotId: String(options.slotId || '').trim(),
      usedCursorMaxTime: Math.max(0, Number(options.usedCursorMaxTime || 0)),
      nextCursorMaxTime: Math.max(0, Number(options.nextCursorMaxTime || 0)),
      hasMore: options.hasMore === true,
      rawRooms: Math.max(0, Number(options.rawRooms || 0)),
      hintedRooms: Math.max(0, Number(options.hintedRooms || 0)),
      qualifiedRooms: Math.max(0, Number(options.qualifiedRooms || 0)),
      error: String(options.error || '').trim(),
      timeoutMs: Number(options.timeoutMs || 1800)
    })
  }

  /**
   * buildPoolScanTelemetry 方法：汇总当前客户端的扫描/风控状态，供服务端下发集群级预算。
   */
  buildPoolScanTelemetry() {
    const activeAccounts = this.getActiveMonitorAccounts()
    let riskLevel = 0
    let cooldownRemainMs = 0
    let hardRiskCount = 0

    activeAccounts.forEach((account) => {
      const profile = this.getAdaptiveScanProfile(account.id)
      riskLevel = Math.max(riskLevel, Number(profile?.level || 0))
      cooldownRemainMs = Math.max(cooldownRemainMs, Number(profile?.cooldownRemainMs || 0))
      if (Number(profile?.level || 0) >= 2) {
        hardRiskCount += 1
      }
    })

    return {
      riskLevel,
      cooldownRemainMs,
      hardRiskCount,
      busyAccounts: activeAccounts.filter(account => this.isBusyForNormalScan(account.id)).length,
      idleAccounts: activeAccounts.filter(account => !this.isBusyForNormalScan(account.id)).length,
      activeScanners: Array.from(this.scanPlanByAccount.keys()).filter(accountId => this.accounts.has(accountId) && !this.isPaused(accountId)).length
    }
  }

  /**
   * getScanCategoryIds 方法：返回当前客户端支持参与分片的分类ID列表。
   */
  getScanCategoryIds() {
    return (Array.isArray(this.categoryList) ? this.categoryList : [])
      .map(item => String(item?.id || '').trim())
      .filter(Boolean)
  }

  /**
   * refreshPoolScanAssignment 方法：从服务端刷新当前客户端的扫描分片配置。
   */
  async refreshPoolScanAssignment(force = false) {
    if (!this.isPoolServerEnabled()) return null
    const now = Date.now()
    const cached = this.scanAssignmentCache
    if (!force && cached?.expiresAt > now + 3000) {
      return cached
    }

    const res = await fetchPoolScanAssignment(this.poolServerUrl, {
      clientId: this.getPoolClientId(),
      categories: this.getScanCategoryIds(),
      telemetry: this.buildPoolScanTelemetry()
    })
    if (!res.ok || !res.data?.assignment) {
      return cached || null
    }

    const assignment = {
      clientId: String(res.data.assignment?.clientId || this.getPoolClientId()),
      mode: String(res.data.assignment?.mode || 'solo'),
      rank: Number(res.data.assignment?.rank || 0),
      activeClients: Math.max(1, Number(res.data.assignment?.activeClients || 1)),
      allScanEnabled: res.data.assignment?.allScanEnabled !== false,
      categoryIds: Array.isArray(res.data.assignment?.categoryIds)
        ? res.data.assignment.categoryIds.map(item => String(item || '').trim()).filter(Boolean)
        : [],
      categoryPlans: Array.isArray(res.data.assignment?.categoryPlans)
        ? res.data.assignment.categoryPlans.map((item) => ({
          categoryId: String(item?.categoryId || '').trim(),
          startOffset: Math.max(0, Number(item?.startOffset || 0)),
          offsetStride: Math.max(0, Number(item?.offsetStride || 0)),
          count: Math.max(0, Number(item?.count || 0)),
          maxPages: Math.max(0, Number(item?.maxPages || 0))
        })).filter(item => item.categoryId)
        : [],
      budget: {
        maxConcurrentScanners: Math.max(1, Number(res.data.assignment?.budget?.maxConcurrentScanners || 1)),
        countPerPage: Math.max(1, Number(res.data.assignment?.budget?.countPerPage || this.scanConfig.countPerPage || 15)),
        detailConcurrency: Math.max(1, Number(res.data.assignment?.budget?.detailConcurrency || 1)),
        detailRoomCap: Math.max(1, Number(res.data.assignment?.budget?.detailRoomCap || 6)),
        allTimes: Math.max(1, Number(res.data.assignment?.budget?.allTimes || 3)),
        maxAllRounds: Math.max(1, Number(res.data.assignment?.budget?.maxAllRounds || 10)),
        pagesPerCategory: Math.max(1, Number(res.data.assignment?.budget?.pagesPerCategory || this.scanConfig.pagesPerCategory || 12)),
        maxCategoryPages: Math.max(1, Number(res.data.assignment?.budget?.maxCategoryPages || 120)),
        categoryNoGrowthBreakPages: Math.max(1, Number(res.data.assignment?.budget?.categoryNoGrowthBreakPages || 8)),
        itemGapMs: Math.max(0, Number(res.data.assignment?.budget?.itemGapMs || 0)),
        cycleDelayMinMs: Math.max(0, Number(res.data.assignment?.budget?.cycleDelayMinMs || 0)),
        cycleDelayMaxMs: Math.max(0, Number(res.data.assignment?.budget?.cycleDelayMaxMs || 0)),
        categoryOffsetStride: Math.max(0, Number(res.data.assignment?.budget?.categoryOffsetStride || 0))
      },
      clusterRiskLevel: Math.max(0, Number(res.data.assignment?.clusterRiskLevel || 0)),
      clusterRiskScore: Number(res.data.assignment?.clusterRiskScore || 0),
      deepPagingEnabled: res.data.assignment?.deepPagingEnabled !== false,
      assignedAt: Number(res.data.assignment?.assignedAt || now),
      expiresAt: Number(res.data.assignment?.expiresAt || (now + 15000)),
      heartbeatTtl: Number(res.data.assignment?.heartbeatTtl || 15000)
    }

    const prev = this.scanAssignmentCache
    const changed = !prev ||
      prev.mode !== assignment.mode ||
      prev.rank !== assignment.rank ||
      prev.activeClients !== assignment.activeClients ||
      prev.allScanEnabled !== assignment.allScanEnabled ||
      JSON.stringify(prev.categoryIds || []) !== JSON.stringify(assignment.categoryIds || []) ||
      JSON.stringify(prev.categoryPlans || []) !== JSON.stringify(assignment.categoryPlans || []) ||
      JSON.stringify(prev.budget || {}) !== JSON.stringify(assignment.budget || {})
    this.scanAssignmentCache = assignment
    this.syncLocalScanPlans()

    if (changed) {
      this.logger.debug(
        `[scan-assignment] client=${assignment.clientId} mode=${assignment.mode} rank=${assignment.rank}/${assignment.activeClients} all=${assignment.allScanEnabled ? 'on' : 'off'} categories=${assignment.categoryIds.join(',') || '(none)'} scanners=${assignment.budget?.maxConcurrentScanners || 1} pages=${assignment.budget?.maxCategoryPages || 0} risk=${assignment.clusterRiskLevel || 0}`
      )
    }
    return assignment
  }

  /**
   * resolveAssignedCategoryList 方法：把服务端分片中的分类ID映射成本地分类对象。
   */
  resolveAssignedCategoryList(assignment = null) {
    const source = Array.isArray(this.categoryList) ? this.categoryList : []
    if (!assignment || !Array.isArray(assignment.categoryIds) || assignment.categoryIds.length === 0) {
      return assignment ? [] : [...source]
    }
    const assignedIds = new Set(assignment.categoryIds.map(item => String(item || '').trim()).filter(Boolean))
    return source.filter(item => assignedIds.has(String(item?.id || '').trim()))
  }

  /**
   * randomBetween 方法：返回给定区间内的随机整数。
   */
  randomBetween(min, max) {
    const low = Math.floor(Math.min(min, max))
    const high = Math.floor(Math.max(min, max))
    return low + Math.floor(Math.random() * (high - low + 1))
  }

  /**
   * calcNextWaitChatTime 方法：计算下次等待阶段随机弹幕触发时间。
   */
  calcNextWaitChatTime(isFirst = false) {
    const delay = isFirst
      ? this.randomBetween(WAIT_CHAT_FIRST_MIN_MS, WAIT_CHAT_FIRST_MAX_MS)
      : this.randomBetween(WAIT_CHAT_MIN_INTERVAL_MS, WAIT_CHAT_MAX_INTERVAL_MS)
    return Date.now() + delay
  }

  /**
   * pickRandomWaitChatContent 方法：随机选择一条等待阶段弹幕文案。
   */
  pickRandomWaitChatContent(lastContent = '') {
    if (WAIT_RANDOM_CHAT_MESSAGES.length <= 1) {
      return WAIT_RANDOM_CHAT_MESSAGES[0] || '祝大家好运'
    }
    const candidates = WAIT_RANDOM_CHAT_MESSAGES.filter(item => item !== lastContent)
    const pool = candidates.length > 0 ? candidates : WAIT_RANDOM_CHAT_MESSAGES
    return pool[Math.floor(Math.random() * pool.length)]
  }

  /**
   * resetWaitRandomChatState 方法：初始化等待阶段随机互动状态。
   */
  resetWaitRandomChatState(accountId, roomId = '') {
    const safeRoomId = String(roomId || '')
    if (!accountId || !safeRoomId) {
      this.waitRandomChatStateByAccount.delete(accountId)
      return
    }
    this.waitRandomChatStateByAccount.set(accountId, {
      roomId: safeRoomId,
      nextAt: this.calcNextWaitChatTime(true),
      lastContent: '',
      sentCount: 0
    })
  }

  /**
   * clearWaitRandomChatState 方法：清理等待阶段随机互动状态。
   */
  clearWaitRandomChatState(accountId) {
    this.waitRandomChatStateByAccount.delete(accountId)
  }

  /**
   * maybeSendRandomWaitChat 方法：在等待开奖阶段按随机间隔发送弹幕互动。
   */
  async maybeSendRandomWaitChat(accountId, roomId, accountData, drawUntilMs = 0) {
    if (!this.ipc || !accountData) return
    const config = accountData.config || {}
    if (config.randomInteraction?.enabled !== true) return

    const safeRoomId = String(roomId || '')
    if (!safeRoomId) return

    let state = this.waitRandomChatStateByAccount.get(accountId)
    if (!state || state.roomId !== safeRoomId) {
      this.resetWaitRandomChatState(accountId, safeRoomId)
      state = this.waitRandomChatStateByAccount.get(accountId)
    }
    if (!state) return

    const now = Date.now()
    if (now < Number(state.nextAt || 0)) return
    if (drawUntilMs > 0 && now >= drawUntilMs - 1200) return

    const content = this.pickRandomWaitChatContent(state.lastContent)
    try {
      const result = await this.ipc.invoke('room-chat', {
        roomId: safeRoomId,
        content,
        accountId
      })
      if (result?.success) {
        state.lastContent = content
        state.sentCount = Number(state.sentCount || 0) + 1
        accountData.callbacks.onLog(`💬 等待开奖随机弹幕: ${content}`)

        if (Math.random() < 0.28) {
          this.ipc.invoke('room-like', {
            roomId: safeRoomId,
            accountId,
            count: this.randomBetween(1, 2)
          }).catch(() => {})
        }
      }
    } catch (_) {
      // 互动发送失败时静默处理，避免日志噪音
    } finally {
      state.nextAt = this.calcNextWaitChatTime(false)
      this.waitRandomChatStateByAccount.set(accountId, state)
    }
  }

  /**
   * getActiveMonitorAccounts 方法：获取当前处于监控中的活跃账号列表。
   */
  getActiveMonitorAccounts() {
    return Array.from(this.accounts.values())
      .filter(acc => acc?.id && acc.monitoringStarted && !this.isPaused(acc.id))
  }

  /**
   * isBusyForNormalScan 方法：判断账号当前是否处于参与主流程中。
   */
  isBusyForNormalScan(accountId) {
    const stage = this.getTaskStage(accountId)
    return ['claimed', 'joining', 'waiting_draw', 'post_draw_stay'].includes(stage)
  }

  /**
   * canRunAssignedScan 方法：判断账号是否可承担正式扫描计划；正式扫描只交给当前未执行任务的账号。
   */
  canRunAssignedScan(accountId) {
    const stage = this.getTaskStage(accountId)
    return !['claimed', 'joining', 'waiting_draw', 'post_draw_stay'].includes(stage)
  }

  /**
   * canRunWaitScan 方法：判断账号当前是否允许承担等待期开奖阶段的低频补扫任务。
   */
  canRunWaitScan(accountId) {
    const stage = this.getTaskStage(accountId)
    return !['joining'].includes(stage)
  }

  /**
   * getEligibleScannerAccounts 方法：获取可参与常规扫描的空闲账号列表。
   */
  getEligibleScannerAccounts() {
    return this.getActiveMonitorAccounts()
      .filter(acc => this.canRunAssignedScan(acc.id))
      .map(acc => acc.id)
  }

  /**
   * getEligibleWaitScanAccounts 方法：获取可参与等待期开奖补扫的账号列表。
   */
  getEligibleWaitScanAccounts() {
    return this.getActiveMonitorAccounts()
      .filter(acc => this.canRunWaitScan(acc.id))
      .map(acc => acc.id)
  }

  /**
   * getGlobalLotteryCandidateCount 方法：统计当前客户端内所有账号可见福袋的去重数量，用于判断候选池是否偏空。
   */
  getGlobalLotteryCandidateCount() {
    const unique = new Set()
    for (const [accountId, list] of this.lotteryPoolByAccount.entries()) {
      if (!this.accounts.has(accountId) || this.isPaused(accountId)) continue
      const source = Array.isArray(list) ? list : []
      for (const item of source) {
        const key = this.getLotteryUniqueKey(item) || `${String(item?.roomId || '')}:${String(item?.lottery_id || item?.lotteryId || '')}`
        if (key && key !== ':') unique.add(key)
      }
    }
    return unique.size
  }

  /**
   * getRequiredScannerReserveCount 方法：根据当前候选池健康度，返回需要保留的常规扫描名额数量。
   */
  getRequiredScannerReserveCount() {
    const activeAccounts = this.getActiveMonitorAccounts()
    const activeCount = activeAccounts.length
    if (activeCount <= 1) return 0

    const candidateCount = this.getGlobalLotteryCandidateCount()
    if (candidateCount <= SCAN_POOL_REFILL_STRONG_THRESHOLD && activeCount >= 4) {
      return 2
    }
    if (candidateCount <= SCAN_POOL_REFILL_RESERVE_THRESHOLD) {
      return 1
    }
    return 0
  }

  /**
   * shouldReserveScannerForPoolRefill 方法：判断当前账号是否必须保留为扫描补池账号，避免所有账号都进入执行链导致池子见底。
   */
  shouldReserveScannerForPoolRefill(accountId) {
    if (!accountId || !this.isScannerAccount(accountId) || !this.canRunAssignedScan(accountId)) {
      return false
    }
    const reserveCount = this.getRequiredScannerReserveCount()
    if (reserveCount <= 0) return false

    const scannerIds = this.sortScannerCandidateIds(
      Array.from(this.scanPlanByAccount.keys()).filter(id =>
        this.accounts.has(id) &&
        !this.isPaused(id) &&
        this.canRunAssignedScan(id)
      )
    )
    if (scannerIds.length === 0) return false

    const reservedIds = scannerIds.slice(0, reserveCount)
    return reservedIds.includes(String(accountId || '').trim())
  }

  /**
   * sortAccountIds 方法：对账号ID做稳定排序，保证本地扫描分片分配稳定。
   */
  sortAccountIds(accountIds = []) {
    return [...new Set((Array.isArray(accountIds) ? accountIds : [])
      .map(id => String(id || '').trim())
      .filter(id => id && this.accounts.has(id)))]
      .sort((a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }))
  }

  /**
   * getExecutionTurns 方法：读取账号已获得的执行机会次数，用于长期均衡扫描负担。
   */
  getExecutionTurns(accountId) {
    return Math.max(0, Number(this.executionTurnsByAccount.get(accountId) || 0))
  }

  /**
   * markExecutionTurn 方法：在账号拿到本轮执行目标时累计一次执行机会。
   */
  markExecutionTurn(accountId) {
    const next = this.getExecutionTurns(accountId) + 1
    this.executionTurnsByAccount.set(accountId, next)
    return next
  }

  /**
   * getScannerPriority 方法：计算账号承担扫描职责的优先级，优先让领先账号多扫、落后账号多执行。
   */
  getScannerPriority(accountId) {
    const account = this.accounts.get(accountId)
    if (!account) {
      return {
        executionTurns: 0,
        participationCount: 0,
        totalWin: 0,
        lastJoinAt: 0
      }
    }
    return {
      executionTurns: this.getExecutionTurns(accountId),
      participationCount: Math.max(0, Number(account.participationCount || 0)),
      totalWin: Math.max(
        0,
        Number(account.todayLotteryWonDiamonds || 0) + Number(account.todayRedPacketWonDiamonds || 0)
      ),
      lastJoinAt: Math.max(0, Number(this.lastJoinAtByAccount.get(accountId) || 0))
    }
  }

  /**
   * sortScannerCandidateIds 方法：按执行机会、参与次数和收益高低排序扫描候选，把扫描优先交给领先账号。
   */
  sortScannerCandidateIds(accountIds = []) {
    return this.sortAccountIds(accountIds).sort((a, b) => {
      const pa = this.getScannerPriority(a)
      const pb = this.getScannerPriority(b)
      if (pb.executionTurns !== pa.executionTurns) return pb.executionTurns - pa.executionTurns
      if (pb.participationCount !== pa.participationCount) return pb.participationCount - pa.participationCount
      if (pb.totalWin !== pa.totalWin) return pb.totalWin - pa.totalWin
      if (pb.lastJoinAt !== pa.lastJoinAt) return pb.lastJoinAt - pa.lastJoinAt
      return String(a).localeCompare(String(b), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
    })
  }

  /**
   * getEffectiveLocalScanAssignment 方法：获取当前客户端有效的扫描职责。
   */
  getEffectiveLocalScanAssignment(assignment = null) {
    const effective = assignment || this.scanAssignmentCache || null
    return {
      mode: String(effective?.mode || (effective ? 'assigned' : 'local')),
      allScanEnabled: effective ? effective.allScanEnabled !== false : true,
      categories: this.resolveAssignedCategoryList(effective),
      categoryPlans: this.resolveAssignedCategoryPlans(effective),
      budget: effective?.budget || null
    }
  }

  /**
   * resolveAssignedCategoryPlans 方法：把服务端分片中的分类深分页计划映射到本地分类对象。
   */
  resolveAssignedCategoryPlans(assignment = null) {
    const source = Array.isArray(this.categoryList) ? this.categoryList : []
    const categoryMap = new Map(source.map(item => [String(item?.id || '').trim(), item]))
    const rawPlans = Array.isArray(assignment?.categoryPlans) ? assignment.categoryPlans : []
    if (rawPlans.length === 0) {
      return this.resolveAssignedCategoryList(assignment).map((item) => ({
        ...item,
        categoryId: String(item?.id || '').trim(),
        startOffset: 0,
        offsetStride: Number(assignment?.budget?.countPerPage || this.scanConfig.countPerPage || 15),
        count: Number(assignment?.budget?.countPerPage || this.scanConfig.countPerPage || 15),
        maxPages: Number(assignment?.budget?.maxCategoryPages || this.scanConfig.pagesPerCategory || 12)
      }))
    }

    return rawPlans.map((plan) => {
      const categoryId = String(plan?.categoryId || '').trim()
      const meta = categoryMap.get(categoryId) || { id: categoryId, name: categoryId }
      return {
        ...meta,
        categoryId,
        startOffset: Math.max(0, Number(plan?.startOffset || 0)),
        offsetStride: Math.max(1, Number(plan?.offsetStride || assignment?.budget?.countPerPage || this.scanConfig.countPerPage || 15)),
        count: Math.max(1, Number(plan?.count || assignment?.budget?.countPerPage || this.scanConfig.countPerPage || 15)),
        maxPages: Math.max(1, Number(plan?.maxPages || assignment?.budget?.maxCategoryPages || this.scanConfig.pagesPerCategory || 12))
      }
    }).filter(item => item.categoryId)
  }

  /**
   * getReservedExecutionSlotCount 方法：为本地执行保留固定账号名额，避免所有账号长期陷入扫描角色。
   */
  getReservedExecutionSlotCount(totalCount = 0) {
    const count = Math.max(0, Number(totalCount || 0))
    if (count >= 4) return 2
    if (count >= 2) return 1
    return 0
  }

  /**
   * getLocalScannerCap 方法：限制本客户端正式扫描位上限，默认只保留 1 个主扫描位；候选池明显偏空时才放宽到 2 个。
   */
  getLocalScannerCap(totalCount = 0, maxConcurrentScanners = null) {
    const count = Math.max(0, Number(totalCount || 0))
    if (count <= 1) return count
    const budgetCap = Number.isFinite(Number(maxConcurrentScanners))
      ? Math.max(1, Number(maxConcurrentScanners))
      : 1
    return Math.max(1, Math.min(count, 1, budgetCap))
  }

  /**
   * selectPlannedScannerIds 方法：从可扫描账号中轮转挑选正式扫描位，其余账号保留为执行位。
   */
  selectPlannedScannerIds(accountIds = [], maxConcurrentScanners = null) {
    const ids = this.sortAccountIds(accountIds)
    if (ids.length <= 1) return ids

    const reserveExecutionCount = Math.min(ids.length - 1, this.getReservedExecutionSlotCount(ids.length))
    const localScannerCap = this.getLocalScannerCap(ids.length, maxConcurrentScanners)
    const desiredScannerCount = Math.max(
      1,
      Math.min(
        ids.length - reserveExecutionCount,
        localScannerCap
      )
    )
    if (desiredScannerCount >= ids.length) {
      return ids
    }

    const prioritized = this.sortScannerCandidateIds(ids)
    return prioritized.slice(0, desiredScannerCount)
  }

  /**
   * buildLocalScanPlans 方法：为一组账号生成本客户端内的常规扫描分片计划。
   */
  buildLocalScanPlans(accountIds = [], assignment = null) {
    const ids = this.sortAccountIds(accountIds)
    const plans = new Map()
    if (ids.length === 0) return plans

    const effective = this.getEffectiveLocalScanAssignment(assignment)
    const budget = effective.budget || {}
    const maxConcurrentScanners = Math.max(1, Math.min(ids.length, Number(budget?.maxConcurrentScanners || ids.length)))
    const plannedIds = this.selectPlannedScannerIds(ids, maxConcurrentScanners)
    if (plannedIds.length === 0) return plans
    const categoryPlans = Array.isArray(effective.categoryPlans) ? effective.categoryPlans.filter(Boolean) : []
    let categoryStartIndex = 0

    if (effective.allScanEnabled) {
      const allOwnerId = plannedIds[0]
      const attachCategories = plannedIds.length <= 1 ? categoryPlans : []
      plans.set(allOwnerId, {
        kind: 'all',
        mode: effective.mode,
        allScanEnabled: true,
        assignedCategories: attachCategories,
        assignedCategoryPlans: attachCategories,
        budget,
        shardKey: `all:${effective.mode}:0`,
        workerIndex: 0,
        workerCount: plannedIds.length,
        scanTier: 0 < maxConcurrentScanners ? 'active' : 'standby'
      })
      categoryStartIndex = 1
    }

    const categoryWorkers = plannedIds.slice(categoryStartIndex)
    if (categoryPlans.length > 0 && categoryWorkers.length > 0) {
      const workerBuckets = Array.from({ length: categoryWorkers.length }, () => [])

      if (categoryWorkers.length <= categoryPlans.length) {
        categoryPlans.forEach((categoryPlan, index) => {
          workerBuckets[index % categoryWorkers.length].push({
            ...categoryPlan,
            localSlotIndex: 0,
            localSlotCount: 1
          })
        })
      } else {
        const baseShare = Math.floor(categoryWorkers.length / categoryPlans.length)
        let extraShare = categoryWorkers.length % categoryPlans.length
        let bucketIndex = 0
        categoryPlans.forEach((categoryPlan) => {
          const slotCount = Math.max(1, baseShare + (extraShare > 0 ? 1 : 0))
          if (extraShare > 0) extraShare -= 1
          for (let slotIndex = 0; slotIndex < slotCount; slotIndex++) {
            workerBuckets[bucketIndex].push({
              ...categoryPlan,
              startOffset: Number(categoryPlan.startOffset || 0) + slotIndex * Number(categoryPlan.offsetStride || categoryPlan.count || 15),
              offsetStride: Math.max(1, Number(categoryPlan.offsetStride || categoryPlan.count || 15) * slotCount),
              localSlotIndex: slotIndex,
              localSlotCount: slotCount
            })
            bucketIndex += 1
          }
        })
      }

      for (let index = 0; index < workerBuckets.length; index++) {
        const ownerId = categoryWorkers[index]
        const bucketPlans = workerBuckets[index]
        if (!ownerId || bucketPlans.length === 0) continue
        plans.set(ownerId, {
          kind: 'category',
          mode: effective.mode,
          allScanEnabled: false,
          assignedCategories: bucketPlans,
          assignedCategoryPlans: bucketPlans,
          budget,
          shardKey: `category:${effective.mode}:${index}:${bucketPlans.map(item => item?.categoryId || item?.id).join(',')}`,
          workerIndex: categoryStartIndex + index,
          workerCount: plannedIds.length,
          scanTier: (categoryStartIndex + index) < maxConcurrentScanners ? 'active' : 'standby'
        })
      }
    }

    return plans
  }

  /**
   * isSameScanPlan 方法：比较两个本地扫描计划是否等价。
   */
  isSameScanPlan(prevPlan = null, nextPlan = null) {
    if (!prevPlan && !nextPlan) return true
    if (!prevPlan || !nextPlan) return false
    const prevCategoryIds = Array.isArray(prevPlan.assignedCategoryPlans)
      ? prevPlan.assignedCategoryPlans.map(item => `${String(item?.categoryId || item?.id || '')}:${Number(item?.startOffset || 0)}:${Number(item?.offsetStride || 0)}`).filter(Boolean)
      : []
    const nextCategoryIds = Array.isArray(nextPlan.assignedCategoryPlans)
      ? nextPlan.assignedCategoryPlans.map(item => `${String(item?.categoryId || item?.id || '')}:${Number(item?.startOffset || 0)}:${Number(item?.offsetStride || 0)}`).filter(Boolean)
      : []
    return prevPlan.kind === nextPlan.kind &&
      prevPlan.mode === nextPlan.mode &&
      prevPlan.allScanEnabled === nextPlan.allScanEnabled &&
      String(prevPlan.scanTier || '') === String(nextPlan.scanTier || '') &&
      prevPlan.shardKey === nextPlan.shardKey &&
      Number(prevPlan.workerIndex || 0) === Number(nextPlan.workerIndex || 0) &&
      Number(prevPlan.workerCount || 0) === Number(nextPlan.workerCount || 0) &&
      JSON.stringify(prevPlan.budget || {}) === JSON.stringify(nextPlan.budget || {}) &&
      JSON.stringify(prevCategoryIds) === JSON.stringify(nextCategoryIds)
  }

  /**
   * getScanPlanLabel 方法：格式化扫描计划文案，便于日志和调试输出。
   */
  getScanPlanLabel(plan = null) {
    if (!plan) return '执行'
    if (plan.kind === 'all') {
      const categoryCount = Array.isArray(plan.assignedCategories) ? plan.assignedCategories.length : 0
      return categoryCount > 0 ? `全站+${categoryCount}分类` : '全站'
    }
    const names = Array.isArray(plan.assignedCategories)
      ? plan.assignedCategories.map(item => String(item?.name || '').trim()).filter(Boolean)
      : []
    return names.length > 0 ? `分类:${names.join('/')}` : '分类'
  }

  /**
   * syncLocalScanPlans 方法：按当前空闲账号刷新本客户端的常规扫描计划表。
   */
  syncLocalScanPlans(accountIds = null, assignment = null) {
    const eligible = new Set(this.getEligibleScannerAccounts())
    const targetIds = Array.isArray(accountIds)
      ? accountIds.filter(id => eligible.has(String(id || '').trim()))
      : Array.from(eligible)
    const nextPlans = this.buildLocalScanPlans(targetIds, assignment)
    const prevPlans = this.scanPlanByAccount
    const prevIds = this.sortAccountIds(Array.from(prevPlans.keys()))
    const nextIds = this.sortAccountIds(Array.from(nextPlans.keys()))

    let changed = prevIds.length !== nextIds.length
    if (!changed) {
      for (let index = 0; index < nextIds.length; index++) {
        if (prevIds[index] !== nextIds[index]) {
          changed = true
          break
        }
        if (!this.isSameScanPlan(prevPlans.get(nextIds[index]), nextPlans.get(nextIds[index]))) {
          changed = true
          break
        }
      }
    }

    this.scanPlanByAccount = nextPlans
    const primaryScannerId = nextIds[0] || null
    if (this.scannerAccountId !== primaryScannerId) {
      this.scannerAccountId = primaryScannerId
      changed = true
    }

    if (changed) {
      this.emitDispatchUpdateForAllAccounts()
      this.kickoffAssignedScanPlans(prevPlans, nextPlans)
    }
    return nextPlans
  }

  /**
   * kickoffAssignedScanPlans 方法：当本地扫描计划发生变化时，立即唤起新接手扫描的空闲账号。
   */
  kickoffAssignedScanPlans(prevPlans = new Map(), nextPlans = new Map()) {
    for (const accountId of prevPlans.keys()) {
      if (!nextPlans.has(accountId)) {
        this.clearScanCycleTimer(accountId)
      }
    }
    for (const [accountId, plan] of nextPlans.entries()) {
      const prevPlan = prevPlans.get(accountId)
      if (this.isSameScanPlan(prevPlan, plan)) continue
      if (!this.accounts.has(accountId) || this.isPaused(accountId)) continue
      if (!this.canRunAssignedScan(accountId)) continue
      const delayMs = 180 + Math.min(520, Number(plan?.workerIndex || 0) * 140) + Math.floor(Math.random() * 120)
      this.scheduleAssignedScanCycle(accountId, delayMs)
    }
  }

  /**
   * getNormalScanPlan 方法：读取账号当前常规扫描计划。
   */
  getNormalScanPlan(accountId, assignment = null) {
    return this.syncLocalScanPlans(null, assignment).get(accountId) || null
  }

  /**
   * ensureScannerAccount 方法：兼容旧流程，返回当前主扫描账号。
   */
  ensureScannerAccount(preferredId = '') {
    this.syncLocalScanPlans(preferredId ? [preferredId, ...this.getEligibleScannerAccounts()] : null)
    return this.scannerAccountId
  }

  /**
   * isScannerAccount 方法：判断当前账号是否被分配为本轮扫描账号。
   */
  isScannerAccount(accountId) {
    return !!this.getNormalScanPlan(accountId)
  }

  /**
   * releaseScannerAccount 方法：释放账号相关的扫描角色缓存，并重新计算本地扫描计划。
   */
  releaseScannerAccount(accountId) {
    if (this.activeScanAccountId === String(accountId || '').trim()) {
      this.activeScanAccountId = ''
    }
    this.scanRoleByAccount.delete(accountId)
    this.syncLocalScanPlans()
  }

  /**
   * handoverScannerAccount 方法：兼容旧调用，触发本地扫描计划重排。
   */
  handoverScannerAccount(accountId, reason = '') {
    this.syncLocalScanPlans(accountId ? [accountId, ...this.getEligibleScannerAccounts()] : null)
    if (accountId && this.scanPlanByAccount.has(accountId)) {
      const suffix = reason ? ` (${reason})` : ''
      this.logger.debug(`[${accountId}] local scan plan => ${this.getScanPlanLabel(this.scanPlanByAccount.get(accountId))}${suffix}`)
    }
  }

  /**
   * logScanRoleIfChanged 方法：记录扫描角色变化。
   */
  logScanRoleIfChanged(accountId, role, plan = null) {
    const normalizedRole = role === 'scanner' ? 'scanner' : 'worker'
    if (normalizedRole === 'scanner') {
      this.activeScanAccountId = String(accountId || '').trim()
      for (const [id, prevRole] of this.scanRoleByAccount.entries()) {
        if (id !== accountId && prevRole === 'scanner') {
          this.scanRoleByAccount.set(id, 'worker')
          this.emitAccountDispatchUpdate(id)
        }
      }
    } else if (this.activeScanAccountId === String(accountId || '').trim()) {
      this.activeScanAccountId = ''
    }
    const prev = this.scanRoleByAccount.get(accountId)
    if (prev === normalizedRole) return
    this.scanRoleByAccount.set(accountId, normalizedRole)
    const label = normalizedRole === 'scanner' ? this.getScanPlanLabel(plan || this.scanPlanByAccount.get(accountId)) : '执行'
    this.logger.debug(`[${accountId}] scan role => ${normalizedRole} (${label})`)
    this.emitAccountDispatchUpdate(accountId)
  }

  /**
   * getBalancedScanCandidates 方法：获取均衡策略扫描候选项列表。
   */
  getBalancedScanCandidates() {
    const eligible = this.getEligibleScannerAccounts()
    if (eligible.length === 0) return []

    const idle = eligible.filter(id => !this.isCollectLoading(id))
    const source = idle.length > 0 ? idle : eligible
    return [...source].sort((a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }))
  }

  /**
   * getBalancedWaitScanCandidates 方法：获取等待期开奖阶段的补扫候选账号列表。
   */
  getBalancedWaitScanCandidates() {
    const eligible = this.getEligibleWaitScanAccounts()
    if (eligible.length === 0) return []

    const idle = eligible.filter(id => !this.isCollectLoading(id))
    const source = idle.length > 0 ? idle : eligible
    return [...source].sort((a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }))
  }

  /**
   * hasPriorityWaitScan 方法：判断当前是否存在等待开奖/停留阶段账号，应优先占用全局扫描通道。
   */
  hasPriorityWaitScan() {
    return this.getActiveMonitorAccounts().some(acc => {
      const stage = this.getTaskStage(acc.id)
      return stage === 'waiting_draw' || stage === 'post_draw_stay'
    })
  }

  /**
   * pickBalancedScannerAccount 方法：选择均衡策略扫描账号。
   */
  pickBalancedScannerAccount(preferredId = '', options = {}) {
    const candidates = options?.waitScan === true
      ? this.getBalancedWaitScanCandidates()
      : this.getBalancedScanCandidates()
    if (candidates.length === 0) return null
    if (options?.waitScan === true && preferredId && candidates.includes(preferredId)) {
      this.scanDispatchCursor = 0
      return preferredId
    }
    if (candidates.length === 1) {
      this.scanDispatchCursor = 0
      return candidates[0]
    }

    let cursor = Number(this.scanDispatchCursor || 0)
    if (!Number.isFinite(cursor) || cursor < 0) cursor = 0
    let idx = cursor % candidates.length
    let selected = candidates[idx]
    this.scanDispatchCursor = (idx + 1) % candidates.length

    // 常规扫描阶段尽量避免总是使用触发账号，做压力均摊
    if (!options?.waitScan && preferredId && selected === preferredId) {
      idx = this.scanDispatchCursor % candidates.length
      selected = candidates[idx]
      this.scanDispatchCursor = (idx + 1) % candidates.length
    }

    return selected
  }

  /**
   * dispatchBalancedWaitScan 方法：分发均衡策略等待阶段扫描。
   */
  async dispatchBalancedWaitScan(triggerAccountId, deadlineMs, reason = 'wait-draw-scan') {
    const now = Date.now()
    if (deadlineMs > 0 && now >= deadlineMs) return false
    if (Number(this.waitScanDispatchLockUntil || 0) > now) return false

    const waitCandidates = this.getBalancedWaitScanCandidates()
    const targetId = this.pickBalancedScannerAccount(triggerAccountId, { waitScan: true })
    if (!targetId) return false
    const waitPlans = this.buildLocalScanPlans(waitCandidates, this.scanAssignmentCache)
    const waitPlan = waitPlans.get(targetId) || {
      kind: 'all',
      mode: 'wait-scan',
      allScanEnabled: this.getEffectiveLocalScanAssignment(this.scanAssignmentCache).allScanEnabled,
      assignedCategories: this.getEffectiveLocalScanAssignment(this.scanAssignmentCache).categories,
      assignedCategoryPlans: this.getEffectiveLocalScanAssignment(this.scanAssignmentCache).categoryPlans,
      budget: this.getEffectiveLocalScanAssignment(this.scanAssignmentCache).budget,
      shardKey: `wait:${targetId}`,
      workerIndex: 0,
      workerCount: Math.max(1, waitCandidates.length)
    }

    this.waitScanDispatchLockUntil = now + 900 + Math.floor(Math.random() * 600)
    await this.searchLiveRoom(targetId, { scanOnly: true, deadlineMs, forceScanner: true, scanPlan: waitPlan })
    return true
  }

  /**
   * shouldLogPoolWarn 方法：根据冷却时间判断是否允许再次输出池服务告警日志。
   */
  shouldLogPoolWarn(accountId, type, cooldownMs = 60000) {
    const key = `${accountId}:${type}`
    const now = Date.now()
    const prev = Number(this.lastPoolWarnAt.get(key) || 0)
    if (now - prev < cooldownMs) return false
    this.lastPoolWarnAt.set(key, now)
    return true
  }

  /**
   * formatPoolErrorMessage 方法：将服务端错误码和网络异常转换为中文可读文案。
   */
  formatPoolErrorMessage(rawMessage, fallback = '请求失败') {
    const text = String(rawMessage || '').trim()
    if (!text) return fallback
    const lower = text.toLowerCase()
    if (lower.includes('failed to fetch') || lower.includes('networkerror when attempting to fetch resource')) {
      return '连接服务端失败，请检查服务地址与网络'
    }
    if (lower.includes('timeout') || lower.includes('aborted')) {
      return '请求超时，请稍后重试'
    }

    const codeMap = {
      license_backend_unavailable: '授权服务暂不可用',
      license_not_authorized: '授权未生效',
      license_client_id_required: '缺少客户端标识',
      license_fingerprint_required: '缺少设备指纹'
    }
    if (codeMap[text]) return codeMap[text]

    const httpMatch = text.match(/^http_(\d{3})$/i)
    if (httpMatch) return `请求失败（HTTP ${httpMatch[1]}）`
    return text
  }

  /**
   * toPoolCandidate 方法：将输入转换为福袋池候选项。
   */
  toPoolCandidate(lottery, sourceId = '') {
    if (!lottery) return null
    const endTime = Number(lottery.end_time || 0)
    const lotteryId = String(lottery.lottery_id || lottery.lotteryId || '')
    const roomId = String(lottery.roomId || '')
    if (!roomId || !lotteryId || !endTime) return null
    return {
      roomId,
      webRid: String(lottery.webRid || roomId),
      lotteryId,
      conditions: Array.isArray(lottery.conditions) ? lottery.conditions : [],
      joinTotal: Number(lottery.joinTotal || 0),
      luckyCount: Number(lottery.winningTotal || 0),
      lotteryTotal: Number(lottery.lotteryTotal || 0),
      onlineTotal: Number(lottery.onlineTotal || 0),
      lotteryName: lottery.lotteryName || lottery.prize_name || '',
      prizeInfo: lottery.prizeInfo || lottery.prize_info || {},
      prizeType: lottery.prizeType,
      total_amount: Number(lottery.total_amount || lottery.totalAmount || 0),
      endTime,
      startTime: Number(lottery.start_time || 0),
      fetchedAt: Number(lottery.fetchedAt || Date.now()),
      sourceId: sourceId || '',
      authorNickname: lottery.authorNickname || '',
      roomTitle: lottery.roomTitle || ''
    }
  }

  /**
   * fromPoolTopItem 方法：处理福袋池优选结果。
   */
  fromPoolTopItem(item, rank = null) {
    if (!item) return null
    const roomId = String(item.roomId || '')
    const lotteryId = String(item.lotteryId || item.lottery_id || '')
    const endTimeMS = Number(item.endTime || 0)
    if (!roomId || !lotteryId || !endTimeMS) return null

    const endSec = endTimeMS > 1e12 ? Math.floor(endTimeMS / 1000) : Math.floor(endTimeMS)
    const fetchedMS = Number(item.fetchedAt || Date.now())
    const simpleProb = Math.max(0, Number(item.probability || 0)) / 100
    const startSec = Math.max(0, Number(item.startTime || 0) > 0
      ? (Number(item.startTime || 0) > 1e12 ? Math.floor(Number(item.startTime || 0) / 1000) : Math.floor(Number(item.startTime || 0)))
      : (endSec - 300))

    return {
      roomId,
      webRid: String(item.webRid || roomId),
      lottery_id: lotteryId,
      joinTotal: Number(item.joinTotal || 0),
      winningTotal: Number(item.luckyCount || 0),
      lotteryTotal: Number(item.lotteryTotal || 0),
      lotteryName: item.lotteryName || item.prizeInfo?.name || '',
      prize_name: item.lotteryName || item.prizeInfo?.name || '',
      prizeType: item.prizeType,
      prizeInfo: item.prizeInfo || {},
      total_amount: Number(item.totalAmount || 0),
      start_time: startSec,
      end_time: endSec,
      onlineTotal: Number(item.onlineTotal || 0),
      conditions: Array.isArray(item.conditions) ? item.conditions : [],
      authorNickname: item.authorNickname || '',
      roomTitle: item.roomTitle || '',
      fetchedAt: fetchedMS > 1e12 ? fetchedMS : fetchedMS * 1000,
      predictedProbability: Number(item.predictedProbability || simpleProb),
      simpleProbability: Number(item.currentProbability || item.probability || 0) / 100,
      predictedFinalPeople: Number(item.predictedJoinTotal || 0),
      _serverRank: Number.isFinite(Number(rank)) ? Number(rank) : null,
      _serverScore: Number(item.score || item.evScore || 0),
      _serverReviewScore: Number(item.reviewScore || item.score || item.evScore || 0),
      _serverLearningBoost: Number(item.learningBoost || 1),
      _leaseCount: Number(item.leaseCount || 0),
      _maxLeaseSlots: Number(item.maxLeaseSlots || 1),
      _availableSlots: Number(item.availableSlots || 0),
      _claimed: item.claimed === true,
      _lease: item.lease || null
    }
  }

  /**
   * syncServerPoolCandidates 方法：同步服务端福袋池候选项列表。
   */
  async syncServerPoolCandidates(accountId, lotteryList) {
    if (!this.isPoolServerEnabled()) {
      return { ok: true, accepted: 0, total: 0, skipped: 'pool_server_disabled' }
    }
    if (!Array.isArray(lotteryList) || lotteryList.length === 0) {
      return { ok: true, accepted: 0, total: 0, skipped: 'empty_candidates' }
    }

    const candidates = lotteryList
      .map(item => this.toPoolCandidate(item, accountId))
      .filter(Boolean)
    if (candidates.length === 0) {
      return { ok: true, accepted: 0, total: 0, skipped: 'invalid_candidates' }
    }

    const res = await upsertPoolCandidates(this.poolServerUrl, accountId, candidates)
    if (!res.ok) {
      if (this.shouldLogPoolWarn(accountId, 'upsert')) {
        const accountData = this.accounts.get(accountId)
        const statusSuffix = res?.status ? `（HTTP ${res.status}）` : ''
        accountData?.callbacks?.onLog?.(`⚠️ 服务端候选上报失败${statusSuffix}: ${this.formatPoolErrorMessage(res.error, '上报失败')}`, 'warning')
      }
      this.logger.warn(
        `[${accountId}] pool upsert failed status=${res?.status || 0} error=${res?.error || 'unknown'} candidates=${candidates.length}`
      )
      return {
        ok: false,
        accepted: 0,
        total: candidates.length,
        status: Number(res?.status || 0),
        error: String(res?.error || 'upsert_failed')
      }
    }
    return {
      ok: true,
      accepted: Math.max(0, Number(res?.data?.accepted || candidates.length)),
      total: candidates.length,
      status: Number(res?.status || 200)
    }
  }

  /**
   * enqueuePoolCandidatesUpload 方法：将候选上报任务按账号串行入队，保证“每页立即上传”且不阻塞扫描主流程。
   */
  enqueuePoolCandidatesUpload(accountId, lotteryList) {
    const list = Array.isArray(lotteryList) ? lotteryList : []
    if (list.length === 0) {
      return Promise.resolve({ ok: true, accepted: 0, total: 0, skipped: 'empty_candidates' })
    }

    const prev = this.poolUploadQueueByAccount.get(accountId) || Promise.resolve()
    let wrapped = null
    const task = prev
      .catch(() => null)
      .then(() => this.syncServerPoolCandidates(accountId, list))
    wrapped = task.finally(() => {
      if (this.poolUploadQueueByAccount.get(accountId) === wrapped) {
        this.poolUploadQueueByAccount.delete(accountId)
      }
    })
    this.poolUploadQueueByAccount.set(accountId, wrapped)
    return wrapped
  }

  /**
   * waitPoolUploadIdle 方法：等待当前账号的页级上传队列完成，用于首轮收尾确认。
   */
  async waitPoolUploadIdle(accountId, timeoutMs = 4000) {
    const pending = this.poolUploadQueueByAccount.get(accountId)
    if (!pending) return true
    const safeTimeout = Math.max(300, Number(timeoutMs) || 4000)
    await Promise.race([
      pending.catch(() => null),
      this.sleep(safeTimeout)
    ])
    return !this.poolUploadQueueByAccount.has(accountId)
  }

  /**
   * refreshPoolFromServer 方法：刷新福袋池服务端。
   */
  async refreshPoolFromServer(accountId, options = {}) {
    if (!this.isPoolServerEnabled()) return false
    const accountData = this.accounts.get(accountId)
    const serverFilters = this.buildServerTopFilters(accountData?.config || {})
    const owner = this.getTaskOwner(accountId)
    const res = await fetchPoolTop(this.poolServerUrl, {
      limit: this.poolTopLimit,
      filters: serverFilters,
      clientId: owner.clientId,
      accountId: owner.accountId,
      includeClaimedSelf: true
    })
    if (!res.ok) {
      if (this.shouldLogPoolWarn(accountId, 'top')) {
        accountData?.callbacks?.onLog?.(`⚠️ 服务端拉取最优福袋失败: ${this.formatPoolErrorMessage(res.error, '拉取失败')}`, 'warning')
      }
      return false
    }
    const items = Array.isArray(res.data?.items) ? res.data.items : []
    const list = items.map((item, idx) => this.fromPoolTopItem(item, idx + 1)).filter(Boolean)
    this.setAccountLotteryList(accountId, list)
    if (list.length > 0) {
      this.printServerPoolSnapshot(accountId, list, res.data)
      return true
    }
    this.logger.debug(`[${accountId}] pool snapshot empty`)
    return false
  }

  /**
   * claimTaskFromServer 方法：从共享池领取一个执行任务，并同步到当前账号上下文。
   */
  async claimTaskFromServer(accountId, config = {}, options = {}) {
    if (!this.isPoolServerEnabled()) return null
    const owner = this.getTaskOwner(accountId)
    const excludeKeySet = new Set([
      ...this.getActiveSkipLotteryKeys(accountId),
      ...(Array.isArray(options?.excludeKeys) ? options.excludeKeys : [])
    ].filter(Boolean))

    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await claimPoolTask(this.poolServerUrl, {
        ...owner,
        leaseSec: POOL_TASK_LEASE_SEC,
        filters: this.buildServerTopFilters(config, {
          maxRemainingSec: Number.isFinite(Number(options?.maxRemainingSec))
            ? Number(options.maxRemainingSec)
            : CLAIM_TARGET_MAX_SEC
        }),
        preferKeys: Array.isArray(options?.preferKeys) ? options.preferKeys : [],
        excludeKeys: Array.from(excludeKeySet)
      })
      if (!res.ok) {
        if (this.shouldLogPoolWarn(accountId, 'claim', 60000)) {
          this.accounts.get(accountId)?.callbacks?.onLog?.(`⚠️ 服务端任务领取失败: ${this.formatPoolErrorMessage(res.error, '领取失败')}`, 'warning')
        }
        return null
      }
      if (res.data?.claimed !== true || !res.data?.item || !res.data?.lease) {
        return { claimed: false, reason: res.data?.reason || 'no_available_task' }
      }

      const lottery = this.fromPoolTopItem(res.data.item, 1)
      if (!lottery) {
        await this.releaseSpecificPoolTaskLease(accountId, res.data?.lease?.leaseId, 'claim_item_invalid')
        continue
      }

      const claimedKey = this.getLotteryUniqueKey(lottery)
      if (claimedKey && excludeKeySet.has(claimedKey)) {
        await this.releaseSpecificPoolTaskLease(accountId, res.data?.lease?.leaseId, 'claim_item_excluded')
        continue
      }

      const task = {
        lottery,
        lease: res.data.lease,
        claimedAt: Number(res.data.lease?.claimedAt || Date.now()),
        serverScore: Number(res.data.item?.score || res.data.item?.evScore || 0)
      }
      this.setClaimedTask(accountId, task)
      this.setTaskStage(accountId, 'claimed')
      return { claimed: true, task }
    }

    return { claimed: false, reason: 'no_available_task' }
  }

  /**
   * buildPoolTaskFeedbackPayload 方法：将本地福袋信息转换为服务端学习反馈所需结构。
   */
  buildPoolTaskFeedbackPayload(accountId, event, lotteryInfo, extra = {}) {
    if (!accountId || !lotteryInfo || !event) return null
    const roomId = String(lotteryInfo.roomId || '')
    const lotteryId = String(lotteryInfo.lottery_id || lotteryInfo.lotteryId || '')
    if (!roomId || !lotteryId) return null

    const endTimeRaw = Number(lotteryInfo.end_time || lotteryInfo.endTime || 0)
    const startTimeRaw = Number(lotteryInfo.start_time || lotteryInfo.startTime || 0)
    const endTime = endTimeRaw > 1e12 ? endTimeRaw : endTimeRaw * 1000
    const startTime = startTimeRaw > 1e12 ? startTimeRaw : startTimeRaw * 1000
    let predictedProbability = Number(
      extra.predictedProbability ??
      lotteryInfo.predictedProbability ??
      lotteryInfo.simpleProbability ??
      0
    )
    if (predictedProbability > 1) {
      predictedProbability /= 100
    }
    const predictedJoinTotal = Number(
      extra.predictedJoinTotal ??
      lotteryInfo.predictedFinalPeople ??
      lotteryInfo.predictedJoinTotal ??
      0
    )
    const remainingSec = Math.max(
      0,
      Number(extra.remainingSec ?? (
        endTime > 0
          ? ((endTime / 1000) - (Date.now() / 1000))
          : 0
      ))
    )

    return {
      ...this.getTaskOwner(accountId),
      event: String(event || '').trim(),
      candidateKey: `${roomId}:${lotteryId}`,
      roomId,
      lotteryId,
      lotteryName: lotteryInfo.lotteryName || lotteryInfo.prize_name || '',
      authorNickname: lotteryInfo.authorNickname || '',
      conditions: Array.isArray(lotteryInfo.conditions) ? lotteryInfo.conditions : [],
      joinTotal: Number(lotteryInfo.joinTotal || 0),
      luckyCount: Number(lotteryInfo.winningTotal || lotteryInfo.luckyCount || 0),
      onlineTotal: Number(lotteryInfo.onlineTotal || 0),
      totalAmount: Number(lotteryInfo.total_amount || lotteryInfo.totalAmount || 0),
      prizeType: lotteryInfo.prizeType ?? null,
      prizeInfo: (lotteryInfo.prizeInfo && typeof lotteryInfo.prizeInfo === 'object') ? lotteryInfo.prizeInfo : {},
      predictedProbability,
      predictedJoinTotal,
      remainingSec,
      endTime,
      startTime,
      joinedAt: Number(extra.joinedAt || 0),
      rewardAmount: Number(extra.rewardAmount || 0),
      joinMode: String(extra.joinMode || '').trim(),
      reason: String(extra.reason || '').trim(),
      extra: (extra.extra && typeof extra.extra === 'object') ? extra.extra : {}
    }
  }

  /**
   * reportPoolTaskFeedback 方法：向服务端回传执行反馈，驱动学习闭环。
   */
  async reportPoolTaskFeedback(accountId, event, lotteryInfo, extra = {}) {
    if (!this.isPoolServerEnabled()) return false
    const payload = this.buildPoolTaskFeedbackPayload(accountId, event, lotteryInfo, extra)
    if (!payload) return false
    const res = await reportPoolTaskFeedback(this.poolServerUrl, payload)
    if (!res.ok) {
      this.logger.debug(`[${accountId}] pool feedback failed: ${res.error || 'unknown'}`)
      return false
    }
    return true
  }

  /**
   * buildServerTopFilters 方法：构建服务端优选结果过滤配置。
   */
  buildServerTopFilters(config = {}, options = {}) {
    const filters = {
      requireType3And6: true,
      filterFanClub: config?.filterFanClub?.enabled !== false,
      onlyPhysicalPrize: config?.onlyPhysicalPrize?.enabled === true,
      preferBigRedPacket: config?.preferBigRedPacket?.enabled === true,
      bigRedPacketThreshold: Number(config?.preferBigRedPacket?.threshold || 40),
      minRemainingSec: MIN_JOIN_WINDOW_SEC,
      maxRemainingSec: MAX_JOIN_WINDOW_SEC
    }
    const minRemainingOverride = Number(options?.minRemainingSec)
    const maxRemainingOverride = Number(options?.maxRemainingSec)
    if (Number.isFinite(minRemainingOverride) && minRemainingOverride > 0) {
      filters.minRemainingSec = Math.max(MIN_JOIN_WINDOW_SEC, minRemainingOverride)
    }
    if (Number.isFinite(maxRemainingOverride) && maxRemainingOverride > 0) {
      filters.maxRemainingSec = Math.min(MAX_JOIN_WINDOW_SEC, maxRemainingOverride)
    }

    if (config?.hitRate?.enabled) {
      const minProbability = Number(config?.hitRate?.value || 0)
      if (Number.isFinite(minProbability) && minProbability > 0) {
        filters.minProbability = minProbability
      }
    }
    if (config?.filterOnline?.enabled) {
      const maxOnline = Number(config?.filterOnline?.value || 0)
      if (Number.isFinite(maxOnline) && maxOnline > 0) {
        filters.maxOnlineTotal = maxOnline
      }
    }

    return filters
  }

  /**
   * printServerPoolSnapshot 方法：输出服务端福袋池快照。
   */
  printServerPoolSnapshot(accountId, list, payload = {}) {
    const active = Number(payload?.activeCandidates || 0)
    const valid = Number(payload?.validCandidates || list.length || 0)

    this.logger.debug(`[${accountId}] pool snapshot valid=${valid}, active=${active}, fetched=${list.length}`)
    // 只打印前 3 条，避免长列表刷屏
    const sample = list.slice(0, 3)
    const nowSec = Math.floor(Date.now() / 1000)
    sample.forEach((item, index) => {
      const prob = Number(item.simpleProbability || 0) * 100
      const remain = Math.max(0, Number(item.end_time || 0) - nowSec)
      const join = Number(item.joinTotal || 0)
      const lucky = Number(item.winningTotal || 0)
      const rank = Number(item._serverRank || index + 1)
      this.logger.debug(
        `[${accountId}] pool #${rank}: ${item.authorNickname || '未知主播'} | ${item.lotteryName || item.prize_name || '未知福袋'} | p=${prob.toFixed(2)}% | remain=${remain}s | ${lucky}/${join}`
      )
    })
    if (list.length > 3) {
      this.logger.debug(`[${accountId}] pool ...and ${list.length - 3} more`)
    }
  }

  /**
   * getAccountLotteryList 方法：获取账号福袋列表。
   */
  getAccountLotteryList(accountId) {
    if (!accountId) return []
    return this.lotteryPoolByAccount.get(accountId) || []
  }

  /**
   * setAccountLotteryList 方法：设置账号福袋列表。
   */
  setAccountLotteryList(accountId, list) {
    if (!accountId) return
    this.lotteryPoolByAccount.set(accountId, Array.isArray(list) ? list : [])
  }

  /**
   * getLotteryUniqueKey 方法：生成福袋唯一键（roomId:lotteryId）。
   */
  getLotteryUniqueKey(lottery) {
    if (!lottery) return ''
    const roomId = String(lottery.roomId || '')
    const lotteryId = String(lottery.lottery_id || lottery.lotteryId || '')
    if (!roomId || !lotteryId) return ''
    return `${roomId}:${lotteryId}`
  }

  /**
   * pruneLotterySkipCache 方法：裁剪福袋跳过标记缓存。
   */
  pruneLotterySkipCache(accountId) {
    const cache = this.skipLotteryUntilByAccount.get(accountId)
    if (!cache) return
    const now = Date.now()
    for (const [key, expireAt] of cache.entries()) {
      if (!Number.isFinite(expireAt) || expireAt <= now) {
        cache.delete(key)
      }
    }
    if (cache.size === 0) {
      this.skipLotteryUntilByAccount.delete(accountId)
    }
  }

  /**
   * markLotteryTemporarySkip 方法：将指定福袋标记为短期跳过，避免重复尝试。
   */
  markLotteryTemporarySkip(accountId, lottery, ttlSec = 90) {
    const key = this.getLotteryUniqueKey(lottery)
    if (!key) return
    const now = Date.now()
    let cache = this.skipLotteryUntilByAccount.get(accountId)
    if (!cache) {
      cache = new Map()
      this.skipLotteryUntilByAccount.set(accountId, cache)
    }
    cache.set(key, now + Math.max(10, Number(ttlSec || 90)) * 1000)
  }

  /**
   * shouldSkipLottery 方法：判断指定福袋是否处于临时跳过窗口。
   */
  shouldSkipLottery(accountId, lottery) {
    const key = this.getLotteryUniqueKey(lottery)
    if (!key) return false
    this.pruneLotterySkipCache(accountId)
    const cache = this.skipLotteryUntilByAccount.get(accountId)
    if (!cache) return false
    const expireAt = Number(cache.get(key) || 0)
    if (!expireAt || expireAt <= Date.now()) {
      cache.delete(key)
      if (cache.size === 0) this.skipLotteryUntilByAccount.delete(accountId)
      return false
    }
    return true
  }

  /**
   * getActiveSkipLotteryKeys 方法：返回当前账号仍处于临时跳过窗口的候选 key 列表。
   */
  getActiveSkipLotteryKeys(accountId) {
    this.pruneLotterySkipCache(accountId)
    const cache = this.skipLotteryUntilByAccount.get(accountId)
    if (!cache || cache.size === 0) return []
    return Array.from(cache.keys()).filter(Boolean)
  }

  /**
   * removeLotteryFromPool 方法：将指定福袋从账号本地候选池中移除。
   */
  removeLotteryFromPool(accountId, lottery) {
    const key = this.getLotteryUniqueKey(lottery)
    if (!key) return
    const next = this.getAccountLotteryList(accountId).filter(item => this.getLotteryUniqueKey(item) !== key)
    this.setAccountLotteryList(accountId, next)
  }

  /**
   * getTaskOwner 方法：生成服务端任务分配所需的客户端/账号标识。
   */
  getTaskOwner(accountId) {
    return {
      clientId: String(this.poolClientId || ''),
      accountId: String(accountId || '')
    }
  }

  /**
   * getClaimedTask 方法：读取账号当前持有的服务端任务租约。
   */
  getClaimedTask(accountId) {
    return this.claimedTaskByAccount.get(accountId) || null
  }

  /**
   * matchLotteryTarget 方法：判断给定福袋是否匹配指定房间/福袋ID。
   */
  matchLotteryTarget(lottery, roomId = '', lotteryId = '') {
    if (!lottery) return false
    const targetRoomId = String(roomId || '').trim()
    const targetLotteryId = String(lotteryId || '').trim()
    const currentRoomId = String(lottery.roomId || '').trim()
    const currentLotteryId = String(lottery.lottery_id || lottery.lotteryId || '').trim()
    if (targetLotteryId) {
      return currentLotteryId === targetLotteryId && (!targetRoomId || currentRoomId === targetRoomId)
    }
    if (targetRoomId) {
      return currentRoomId === targetRoomId
    }
    return false
  }

  /**
   * normalizeLiveLotteryUpdate 方法：归一化直播间内 check_user_right 响应。
   */
  normalizeLiveLotteryUpdate(raw) {
    if (!raw || typeof raw !== 'object') return null
    const lotteryInfo = raw.lottery_info || raw.lotteryInfo || null
    if (!lotteryInfo || typeof lotteryInfo !== 'object') return null

    const roomId = String(
      raw.room_id_str ||
      raw.room_id ||
      raw.roomId ||
      lotteryInfo.room_id_str ||
      lotteryInfo.room_id ||
      lotteryInfo.roomId ||
      lotteryInfo.anchor_room_id ||
      ''
    ).trim()
    const lotteryId = String(
      lotteryInfo.lottery_id_str ||
      lotteryInfo.lottery_id ||
      lotteryInfo.lotteryId ||
      raw.lottery_id_str ||
      raw.lottery_id ||
      raw.lotteryId ||
      ''
    ).trim()
    if (!roomId && !lotteryId) return null

    const status = Number(lotteryInfo.status ?? raw.status ?? 0)
    const joinTotal = Number(
      lotteryInfo.candidate_user_num ??
      lotteryInfo.candidate_num ??
      raw.candidate_user_num ??
      raw.candidate_num ??
      0
    )
    const winningTotal = Number(
      lotteryInfo.lucky_count ??
      raw.lucky_count ??
      0
    )

    return {
      raw,
      roomId,
      lotteryId,
      status,
      joinTotal: Number.isFinite(joinTotal) ? Math.max(0, joinTotal) : 0,
      winningTotal: Number.isFinite(winningTotal) ? Math.max(0, winningTotal) : 0,
      updatedAt: Date.now()
    }
  }

  /**
   * getLiveLotterySnapshot 方法：读取当前任务或本地候选池里的最新福袋快照。
   */
  getLiveLotterySnapshot(accountId, lotteryInfo) {
    if (!accountId || !lotteryInfo) return null
    const roomId = String(lotteryInfo.roomId || '').trim()
    const lotteryId = String(lotteryInfo.lottery_id || lotteryInfo.lotteryId || '').trim()

    const task = this.getClaimedTask(accountId)
    if (task?.lottery && this.matchLotteryTarget(task.lottery, roomId, lotteryId)) {
      return task.lottery
    }

    return this.getAccountLotteryList(accountId).find(item => this.matchLotteryTarget(item, roomId, lotteryId)) || null
  }

  /**
   * applyLiveLotteryUpdate 方法：把直播间内实时福袋人数更新回灌到当前任务和候选池。
   */
  applyLiveLotteryUpdate(accountId, raw) {
    const accountData = this.accounts.get(accountId)
    const update = this.normalizeLiveLotteryUpdate(raw)
    if (!accountData || !update) return null
    if (update.status !== 1 && update.status !== 2) {
      return update
    }

    const applyUpdateToLottery = (lottery) => {
      if (!this.matchLotteryTarget(lottery, update.roomId, update.lotteryId)) return lottery
      const next = {
        ...lottery,
        joinTotal: update.joinTotal,
        winningTotal: update.winningTotal,
        _liveUpdateAt: update.updatedAt
      }
      return this.decorateLotteryForScoring(next, Date.now() / 1000) || next
    }

    let dispatchChanged = false
    let taskMatched = false
    const task = this.getClaimedTask(accountId)
    if (task?.lottery && this.matchLotteryTarget(task.lottery, update.roomId, update.lotteryId)) {
      taskMatched = true
      const nextLottery = applyUpdateToLottery(task.lottery)
      if (
        Number(nextLottery?.joinTotal || 0) !== Number(task.lottery?.joinTotal || 0) ||
        Number(nextLottery?.winningTotal || 0) !== Number(task.lottery?.winningTotal || 0)
      ) {
        dispatchChanged = true
      }
      this.claimedTaskByAccount.set(accountId, {
        ...task,
        lottery: nextLottery
      })
    }

    const currentList = this.getAccountLotteryList(accountId)
    let listChanged = false
    let listMatched = false
    const nextList = currentList.map((item) => {
      if (!this.matchLotteryTarget(item, update.roomId, update.lotteryId)) {
        return item
      }
      listMatched = true
      const nextItem = applyUpdateToLottery(item)
      if (
        Number(nextItem?.joinTotal || 0) !== Number(item?.joinTotal || 0) ||
        Number(nextItem?.winningTotal || 0) !== Number(item?.winningTotal || 0)
      ) {
        listChanged = true
      }
      return nextItem
    })

    if (listMatched) {
      this.setAccountLotteryList(accountId, nextList)
    }
    if (listChanged) {
      this.emitLotteryListUpdate(accountData)
    }
    if (taskMatched && dispatchChanged) {
      this.emitAccountDispatchUpdate(accountId)
    }
    return update
  }

  /**
   * getPoolNoTaskStreak 方法：读取账号连续“服务端无任务”次数。
   */
  getPoolNoTaskStreak(accountId) {
    return Math.max(0, Number(this.poolNoTaskStreakByAccount.get(accountId) || 0))
  }

  /**
   * resetPoolNoTaskStreak 方法：清空账号连续无任务计数。
   */
  resetPoolNoTaskStreak(accountId) {
    this.poolNoTaskStreakByAccount.delete(accountId)
  }

  /**
   * bumpPoolNoTaskStreak 方法：累加账号连续无任务计数。
   */
  bumpPoolNoTaskStreak(accountId) {
    const next = this.getPoolNoTaskStreak(accountId) + 1
    this.poolNoTaskStreakByAccount.set(accountId, next)
    return next
  }

  /**
   * getTaskStage 方法：获取账号当前共享任务所处阶段。
   */
  getTaskStage(accountId) {
    return String(this.taskStageByAccount.get(accountId) || '')
  }

  /**
   * setTaskStage 方法：更新账号当前共享任务阶段并同步到前端。
   */
  setTaskStage(accountId, stage = '') {
    if (!accountId) return
    const normalized = String(stage || '').trim()
    if (normalized) {
      this.taskStageByAccount.set(accountId, normalized)
    } else {
      this.taskStageByAccount.delete(accountId)
    }
    if (this.isBusyForNormalScan(accountId)) {
      this.clearScanCycleTimer(accountId)
    }
    if (this.scannerAccountId === accountId && this.isBusyForNormalScan(accountId)) {
      this.scannerAccountId = null
    }
    this.ensureScannerAccount('')
    if (normalized !== 'joining' && this.getNormalScanPlan(accountId) && !this.isPaused(accountId)) {
      this.scheduleAssignedScanCycle(accountId, 900)
    }
    this.emitAccountDispatchUpdate(accountId)
  }

  /**
   * getAccountScanRole 方法：返回账号当前在界面层展示的扫描角色。
   */
  getAccountScanRole(accountId) {
    const override = this.scanRoleByAccount.get(accountId)
    if (override === 'scanner' || override === 'worker') {
      return override
    }
    return this.scanPlanByAccount.has(accountId) ? 'scanner' : 'worker'
  }

  /**
   * applyLocalScanPlanToProfile 方法：把本地扫描计划映射成请求错峰和分片配置。
   */
  applyLocalScanPlanToProfile(baseProfile = {}, scanPlan = null, options = {}) {
    if (!scanPlan) return { ...baseProfile }
    const workerIndex = Math.max(0, Number(scanPlan.workerIndex || 0))
    const shardJitterMs = Math.min(480, workerIndex * 120)
    const budget = scanPlan?.budget || {}
    const isStandby = String(scanPlan?.scanTier || '') === 'standby'
    const profile = {
      ...baseProfile,
      allScanEnabled: scanPlan.allScanEnabled !== false,
      assignedCategories: Array.isArray(scanPlan.assignedCategories) ? scanPlan.assignedCategories : [],
      assignedCategoryPlans: Array.isArray(scanPlan.assignedCategoryPlans) ? scanPlan.assignedCategoryPlans : [],
      localScanPlan: {
        kind: scanPlan.kind,
        shardKey: scanPlan.shardKey,
        workerIndex,
        workerCount: Math.max(1, Number(scanPlan.workerCount || 1))
      }
    }

    if (Number(budget.countPerPage || 0) > 0) profile.countPerPage = Number(budget.countPerPage)
    if (Number(budget.detailConcurrency || 0) > 0) profile.detailConcurrency = Number(budget.detailConcurrency)
    if (Number(budget.detailRoomCap || 0) > 0) profile.detailRoomCap = Number(budget.detailRoomCap)
    if (Number(budget.allTimes || 0) > 0) profile.allTimes = Number(budget.allTimes)
    if (Number(budget.maxAllRounds || 0) > 0) profile.maxAllRounds = Number(budget.maxAllRounds)
    if (Number(budget.pagesPerCategory || 0) > 0) profile.pagesPerCategory = Number(budget.pagesPerCategory)
    if (Number(budget.maxCategoryPages || 0) > 0) profile.maxCategoryPages = Number(budget.maxCategoryPages)
    if (Number(budget.categoryNoGrowthBreakPages || 0) > 0) {
      profile.categoryNoGrowthBreakPages = Number(budget.categoryNoGrowthBreakPages)
    }
    if (Number(budget.itemGapMs || 0) > 0) profile.itemGapMs = Number(budget.itemGapMs)
    if (Number(budget.cycleDelayMinMs || 0) > 0) profile.cycleDelayMinMs = Number(budget.cycleDelayMinMs)
    if (Number(budget.cycleDelayMaxMs || 0) > 0) profile.cycleDelayMaxMs = Number(budget.cycleDelayMaxMs)

    if (workerIndex <= 0) return profile

    const baseItemGap = Math.max(0, Number(profile.itemGapMs || 0))
    const baseMinDelay = Math.max(0, Number(profile.cycleDelayMinMs || 0))
    const baseMaxDelay = Math.max(baseMinDelay, Number(profile.cycleDelayMaxMs || baseMinDelay))
    const tierFactor = isStandby ? 2.6 : 1

    profile.itemGapMs = Math.floor((baseItemGap + shardJitterMs) * tierFactor)
    if (options?.scanOnly === true) {
      profile.cycleDelayMinMs = Math.floor(baseMinDelay * tierFactor)
      profile.cycleDelayMaxMs = Math.floor(baseMaxDelay * tierFactor)
    } else {
      profile.cycleDelayMinMs = Math.floor((baseMinDelay + Math.floor(shardJitterMs * 0.65)) * tierFactor)
      profile.cycleDelayMaxMs = Math.floor((baseMaxDelay + shardJitterMs) * tierFactor)
    }

    if (isStandby) {
      profile.allTimes = Math.max(1, Math.floor(Number(profile.allTimes || 1)))
      profile.maxAllRounds = Math.max(2, Math.floor(Number(profile.maxAllRounds || profile.allTimes || 2) * 0.5))
      profile.pagesPerCategory = Math.max(1, Math.floor(Number(profile.pagesPerCategory || 1) * 0.6))
      profile.maxCategoryPages = Math.max(6, Math.floor(Number(profile.maxCategoryPages || profile.pagesPerCategory || 6) * 0.55))
    }
    return profile
  }

  /**
   * pruneLocalScanRoomLeases 方法：清理本客户端内已过期的房间扫描去重标记。
   */
  pruneLocalScanRoomLeases(nowMs = Date.now()) {
    for (const [roomId, expireAt] of this.localScanRoomLeaseById.entries()) {
      if (!roomId || Number(expireAt || 0) <= nowMs) {
        this.localScanRoomLeaseById.delete(roomId)
      }
    }
  }

  /**
   * isAllScanRoomSeen 方法：判断全站扫描房间是否在 TTL 内已见过，跨轮次减少重复拉详情。
   */
  isAllScanRoomSeen(roomId) {
    const expireAt = this.allScanSeenRooms.get(roomId)
    if (!expireAt) return false
    if (expireAt <= Date.now()) {
      this.allScanSeenRooms.delete(roomId)
      return false
    }
    return true
  }

  /**
   * markAllScanRoomSeen 方法：标记全站扫描已见房间，带 TTL。
   */
  markAllScanRoomSeen(roomId, ttlMs = 30000) {
    this.allScanSeenRooms.set(roomId, Date.now() + ttlMs)
  }

  /**
   * pruneAllScanSeenRooms 方法：清理全站扫描已过期的已见房间。
   */
  pruneAllScanSeenRooms(nowMs = Date.now()) {
    for (const [roomId, expireAt] of this.allScanSeenRooms.entries()) {
      if (Number(expireAt || 0) <= nowMs) {
        this.allScanSeenRooms.delete(roomId)
      }
    }
  }

  /**
   * claimLocalScanRooms 方法：为当前客户端短期占用一批房间，避免多个账号重复请求相同详情。
   */
  claimLocalScanRooms(accountId, roomInfoList, options = {}) {
    const source = Array.isArray(roomInfoList) ? roomInfoList : []
    if (source.length === 0) {
      return { list: [], skipped: 0 }
    }

    const nowMs = Date.now()
    this.pruneLocalScanRoomLeases(nowMs)
    const ttlMs = Math.max(15000, Number(options?.ttlMs || 45000))
    const list = []
    let skipped = 0

    for (const roomInfo of source) {
      const roomId = String(roomInfo?.roomId || '').trim()
      if (!roomId) continue
      const expireAt = Number(this.localScanRoomLeaseById.get(roomId) || 0)
      if (expireAt > nowMs) {
        skipped += 1
        continue
      }
      this.localScanRoomLeaseById.set(roomId, nowMs + ttlMs)
      list.push(roomInfo)
    }

    if (skipped > 0) {
      this.logger.debug(`[${accountId}] local room dedup skipped=${skipped}, kept=${list.length}`)
    }
    return { list, skipped }
  }

  /**
   * releaseLocalScanRooms 方法：在详情批次完成后释放本地房间去重占用，避免长时间吞掉同房后续新福袋。
   */
  releaseLocalScanRooms(roomInfoList) {
    const source = Array.isArray(roomInfoList) ? roomInfoList : []
    if (source.length === 0) return
    for (const roomInfo of source) {
      const roomId = String(roomInfo?.roomId || '').trim()
      if (!roomId) continue
      this.localScanRoomLeaseById.delete(roomId)
    }
  }

  /**
   * buildAccountDispatchUpdate 方法：构建账号当前的扫描角色与共享任务状态快照。
   */
  buildAccountDispatchUpdate(accountId) {
    const task = this.getClaimedTask(accountId)
    const lottery = task?.lottery || null
    const lease = task?.lease || null
    const now = Date.now()
    const leaseExpiresAt = Number(lease?.expiresAt || 0)
    const leaseRemainingSec = leaseExpiresAt > 0 ? Math.max(0, Math.ceil((leaseExpiresAt - now) / 1000)) : 0
    const scanRole = this.getAccountScanRole(accountId)
    const taskLabel = lottery
      ? `${lottery.authorNickname || '未知主播'} · ${lottery.lotteryName || lottery.prize_name || '未知福袋'}`
      : ''

    return {
      id: accountId,
      scanRole,
      currentTaskStage: this.getTaskStage(accountId),
      currentTaskKey: lottery ? this.getLotteryUniqueKey(lottery) : '',
      currentTaskLabel: taskLabel,
      currentTaskAnchor: lottery?.authorNickname || '',
      currentTaskLotteryName: lottery?.lotteryName || lottery?.prize_name || '',
      currentTaskLeaseId: String(lease?.leaseId || ''),
      currentTaskLeaseExpiresAt: leaseExpiresAt || 0,
      currentTaskLeaseRemainingSec: leaseRemainingSec,
      currentTaskScore: Number(task?.serverScore || lottery?._serverScore || 0)
    }
  }

  /**
   * emitAccountDispatchUpdate 方法：把账号当前共享任务状态同步给界面。
   */
  emitAccountDispatchUpdate(accountId) {
    const accountData = this.accounts.get(accountId)
    if (!accountData?.callbacks?.onStatusUpdate) return
    accountData.callbacks.onStatusUpdate(this.buildAccountDispatchUpdate(accountId))
  }

  /**
   * emitDispatchUpdateForAllAccounts 方法：批量同步所有账号当前共享任务状态。
   */
  emitDispatchUpdateForAllAccounts() {
    Array.from(this.accounts.keys()).forEach(accountId => this.emitAccountDispatchUpdate(accountId))
  }

  /**
   * setClaimedTask 方法：写入账号当前持有的服务端任务租约。
   */
  setClaimedTask(accountId, task) {
    if (!accountId) return
    if (task && typeof task === 'object') {
      this.claimedTaskByAccount.set(accountId, task)
      this.resetPoolNoTaskStreak(accountId)
      this.scheduleClaimRenew(accountId)
    } else {
      this.claimedTaskByAccount.delete(accountId)
      this.clearClaimRenewTimer(accountId)
    }
    this.emitAccountDispatchUpdate(accountId)
  }

  /**
   * clearClaimRenewTimer 方法：清理任务租约续租定时器。
   */
  clearClaimRenewTimer(accountId) {
    const timer = this.claimRenewTimerByAccount.get(accountId)
    if (timer) {
      clearTimeout(timer)
      this.claimRenewTimerByAccount.delete(accountId)
    }
  }

  /**
   * scheduleClaimRenew 方法：按固定节奏续租当前任务，保证执行链期间租约不丢。
   */
  scheduleClaimRenew(accountId) {
    this.clearClaimRenewTimer(accountId)
    const task = this.getClaimedTask(accountId)
    if (!task?.lease?.leaseId) return
    const delayMs = Math.max(3000, POOL_TASK_RENEW_SEC * 1000)
    const timer = setTimeout(async () => {
      this.claimRenewTimerByAccount.delete(accountId)
      if (!this.accounts.has(accountId) || this.isPaused(accountId)) return
      await this.renewClaimedPoolTask(accountId)
      if (this.getClaimedTask(accountId)?.lease?.leaseId) {
        this.scheduleClaimRenew(accountId)
      }
    }, delayMs)
    this.claimRenewTimerByAccount.set(accountId, timer)
  }

  /**
   * renewClaimedPoolTask 方法：续租已领取的服务端任务。
   */
  async renewClaimedPoolTask(accountId) {
    if (!this.isPoolServerEnabled()) return false
    const task = this.getClaimedTask(accountId)
    if (!task?.lease?.leaseId) return false
    const owner = this.getTaskOwner(accountId)
    const res = await renewPoolTask(this.poolServerUrl, {
      ...owner,
      leaseId: task.lease.leaseId,
      leaseSec: POOL_TASK_LEASE_SEC
    })
    if (!res.ok || res.data?.renewed !== true) {
      if (this.shouldLogPoolWarn(accountId, 'renew', 60000)) {
        this.accounts.get(accountId)?.callbacks?.onLog?.('⚠️ 服务端任务续租失败，当前福袋可能会被其他客户端接管', 'warning')
      }
      return false
    }
    const nextTask = {
      ...task,
      lease: res.data?.lease || task.lease
    }
    this.claimedTaskByAccount.set(accountId, nextTask)
    this.emitAccountDispatchUpdate(accountId)
    return true
  }

  /**
   * releaseClaimedPoolTask 方法：释放当前服务端任务租约，使候选重新回池。
   */
  async releaseClaimedPoolTask(accountId, reason = '') {
    const task = this.getClaimedTask(accountId)
    this.setTaskStage(accountId, '')
    this.setClaimedTask(accountId, null)
    if (!this.isPoolServerEnabled() || !task?.lease?.leaseId) return false
    const owner = this.getTaskOwner(accountId)
    const res = await releasePoolTask(this.poolServerUrl, {
      ...owner,
      leaseId: task.lease.leaseId,
      reason
    })
    return res.ok && res.data?.released === true
  }

  /**
   * releaseSpecificPoolTaskLease 方法：释放指定 leaseId，对切换任务时回收旧租约使用。
   */
  async releaseSpecificPoolTaskLease(accountId, leaseId, reason = '') {
    if (!this.isPoolServerEnabled() || !leaseId) return false
    const owner = this.getTaskOwner(accountId)
    const res = await releasePoolTask(this.poolServerUrl, {
      ...owner,
      leaseId,
      reason
    })
    return res.ok && res.data?.released === true
  }

  /**
   * finishClaimedPoolTask 方法：结束当前服务端任务，并默认从候选池移除避免重复分配。
   */
  async finishClaimedPoolTask(accountId, result = 'done', removeCandidate = true) {
    const task = this.getClaimedTask(accountId)
    this.setTaskStage(accountId, '')
    this.setClaimedTask(accountId, null)
    if (!this.isPoolServerEnabled() || !task?.lease?.leaseId) return false
    const owner = this.getTaskOwner(accountId)
    const res = await finishPoolTask(this.poolServerUrl, {
      ...owner,
      leaseId: task.lease.leaseId,
      result,
      removeCandidate
    })
    return res.ok && res.data?.finished === true
  }

  /**
   * scheduleNextLotteryImmediately 方法：调度下一项福袋即时流程。
   */
  scheduleNextLotteryImmediately(accountId, reason = '', options = {}) {
    const accountData = this.accounts.get(accountId)
    if (!accountData || this.isPaused(accountId)) return

    if (reason) {
      accountData.callbacks.onLog(`↪️ ${reason}，立即重选下一个目标...`)
    } else {
      accountData.callbacks.onLog('↪️ 立即重选下一个目标...')
    }
    this.emitLotteryListUpdate(accountData)
    this.scheduleAccountTask(accountId, 120, () => this.start(accountId, {
      preferQuickScan: true,
      trigger: 'immediate-next',
      from: options?.from || ''
    }))
  }

  /**
   * getPoolNoTaskRetryPlan 方法：为当前账号生成“服务端无任务”后的下一步策略，避免全部账号高频空轮询。
   */
  getPoolNoTaskRetryPlan(accountId, preferQuickScan = false) {
    const streak = this.getPoolNoTaskStreak(accountId)
    const scanner = this.isScannerAccount(accountId)
    const showMessage = streak <= 1
    const accountData = this.accounts.get(accountId)
    const firstRoundPending = accountData?.firstRoundScanDone !== true

    if (firstRoundPending) {
      const retryDelay = preferQuickScan
        ? this.randomBetween(1200, 1900)
        : this.randomBetween(1500, 2300)
      return {
        retryDelay,
        forceScan: true,
        message: `No server task yet, run first-round local scan in ${Math.ceil(retryDelay / 1000)}s...`,
        silent: !showMessage
      }
    }

    const retryDelay = scanner
      ? (preferQuickScan ? this.randomBetween(1800, 2600) : this.randomBetween(2200, 3400))
      : (preferQuickScan ? this.randomBetween(1400, 2200) : this.randomBetween(1800, 2800))
    return {
      retryDelay,
      forceScan: true,
      message: `No server task available, local scan fallback starts in ${Math.ceil(retryDelay / 1000)}s...`,
      silent: !showMessage
    }
  }

  /**
   * isCollectLoading 方法：判断账号当前是否处于扫描执行中。
   */
  isCollectLoading(accountId) {
    return this.collectLoadingByAccount.get(accountId) === true
  }

  /**
   * setCollectLoading 方法：设置加载状态。
   */
  setCollectLoading(accountId, loading) {
    this.collectLoadingByAccount.set(accountId, loading === true)
  }

  /**
   * isPaused 方法：判断账号是否处于暂停状态。
   */
  isPaused(accountId) {
    return this.pauseCollectByAccount.get(accountId) === true
  }

  /**
   * setPaused 方法：更新账号暂停状态并同步扫描调度标记。
   */
  setPaused(accountId, paused) {
    this.pauseCollectByAccount.set(accountId, paused === true)
  }

  /**
   * clearAccountTimer 方法：清理账号定时器。
   */
  clearAccountTimer(accountId) {
    const timer = this.cycleTimerByAccount.get(accountId)
    if (timer) {
      clearTimeout(timer)
      this.cycleTimerByAccount.delete(accountId)
    }
  }

  /**
   * clearScanCycleTimer 方法：清理账号后台扫描循环定时器。
   */
  clearScanCycleTimer(accountId) {
    const timer = this.scanCycleTimerByAccount.get(accountId)
    if (timer) {
      clearTimeout(timer)
      this.scanCycleTimerByAccount.delete(accountId)
    }
  }

  /**
   * getAssignedScanCycleDelayMs 方法：根据扫描计划返回下一次后台扫描延迟。
   */
  getAssignedScanCycleDelayMs(plan = null) {
    const budget = plan?.budget || {}
    const workerIndex = Math.max(0, Number(plan?.workerIndex || 0))
    const isStandby = String(plan?.scanTier || '') === 'standby'
    const baseMin = Math.max(1600, Number(budget?.cycleDelayMinMs || 1800))
    const baseMax = Math.max(baseMin + 300, Number(budget?.cycleDelayMaxMs || 3200))
    const tierFactor = isStandby ? 3 : 1
    const minDelay = Math.floor(baseMin * tierFactor) + workerIndex * 120
    const maxDelay = Math.floor(baseMax * tierFactor) + workerIndex * 220
    return this.randomBetween(minDelay, Math.max(minDelay + 120, maxDelay))
  }

  /**
   * scheduleAssignedScanCycle 方法：为正式扫描计划调度独立后台扫描循环，不占用参与流程的主定时器。
   */
  scheduleAssignedScanCycle(accountId, delayMs = 0) {
    this.clearScanCycleTimer(accountId)
    if (!accountId || !this.accounts.has(accountId) || this.isPaused(accountId)) return

    const timer = setTimeout(async () => {
      this.scanCycleTimerByAccount.delete(accountId)
      if (!this.accounts.has(accountId) || this.isPaused(accountId)) return

      // 每轮扫描前清理过期的本地去重缓存，防止内存缓慢膨胀
      this.pruneLocalScanRoomLeases()
      this.pruneAllScanSeenRooms()

      const plan = this.getNormalScanPlan(accountId)
      if (!plan) return

      if (this.hasPriorityWaitScan()) {
        this.scheduleAssignedScanCycle(accountId, 1600)
        return
      }

      if (!this.canRunAssignedScan(accountId) || this.isCollectLoading(accountId)) {
        this.scheduleAssignedScanCycle(accountId, 1200)
        return
      }

      try {
        await this.searchLiveRoom(accountId, {
          scanOnly: true,
          deepScan: false
        })
      } finally {
        if (this.accounts.has(accountId) && !this.isPaused(accountId) && this.getNormalScanPlan(accountId)) {
          this.scheduleAssignedScanCycle(accountId, this.getAssignedScanCycleDelayMs(this.getNormalScanPlan(accountId)))
        }
      }
    }, Math.max(0, Number(delayMs) || 0))

    this.scanCycleTimerByAccount.set(accountId, timer)
  }

  /**
   * getMinPoolEndTime 方法：读取当前账号的最小入池开奖时间阈值。
   */
  getMinPoolEndTime(accountId) {
    return Number(this.minPoolEndTimeByAccount.get(accountId) || 0)
  }

  /**
   * setMinPoolEndTime 方法：设置当前账号的最小入池开奖时间阈值。
   */
  setMinPoolEndTime(accountId, endTimeSec) {
    const t = Number(endTimeSec || 0)
    if (t > 0) {
      this.minPoolEndTimeByAccount.set(accountId, t)
    } else {
      this.minPoolEndTimeByAccount.delete(accountId)
    }
  }

  /**
   * scheduleAccountTask 方法：调度账号任务。
   */
  scheduleAccountTask(accountId, delayMs, task) {
    this.clearAccountTimer(accountId)
    const timer = setTimeout(async () => {
      this.cycleTimerByAccount.delete(accountId)
      if (!this.accounts.has(accountId) || this.isPaused(accountId)) return
      try {
        await task()
      } catch (e) {
        this.logger.debug(`[${accountId}] scheduleAccountTask 执行失败`, e)
      }
    }, Math.max(0, Number(delayMs) || 0))
    this.cycleTimerByAccount.set(accountId, timer)
  }

  /**
   * shouldPreferSelectionRetry 方法：判断当前账号后续重试时，应直接回到选任务流程还是重新触发扫描。
   */
  shouldPreferSelectionRetry(accountId) {
    if (!accountId || !this.accounts.has(accountId) || this.isPaused(accountId)) return false
    return true
  }

  /**
   * scheduleSelectionOrScanRetry 方法：统一调度后续重试，避免主流程和后台扫描循环同时重复驱动同一账号。
   */
  scheduleSelectionOrScanRetry(accountId, delayMs, options = {}) {
    const quickCycle = options?.quickCycle === true || options?.preferQuickScan === true
    const forceScan = options?.forceScan === true
    const trigger = String(options?.trigger || '')
    if (!forceScan && this.shouldPreferSelectionRetry(accountId)) {
      this.scheduleAccountTask(accountId, delayMs, () => this.start(accountId, {
        preferQuickScan: quickCycle,
        trigger: trigger || 'selection-retry'
      }))
      return
    }
    this.scheduleAccountTask(accountId, delayMs, () => this.searchLiveRoom(accountId, {
      quickCycle,
      forceScanner: forceScan
    }))
  }

  /**
   * emitLotteryListUpdate 方法：触发福袋列表。
   */
  emitLotteryListUpdate(accountData) {
    if (!accountData || !accountData.callbacks) return
    if (typeof accountData.callbacks.onLotteryListUpdate !== 'function') return
    try {
      accountData.callbacks.onLotteryListUpdate({
        accountId: accountData.id,
        list: [...this.getAccountLotteryList(accountData.id)]
      })
    } catch (e) {
      this.logger.debug('onLotteryListUpdate 回调执行失败', e)
    }
  }
  
  /**
   * 设置扫描配置
   * @param {Object} config - 配置对象
   * @param {number} config.countPerPage - 每页返回数量
   * @param {number} config.pagesPerCategory - 每个分类扫描页数
   */
  setScanConfig(config) {
    if (config && Object.prototype.hasOwnProperty.call(config, 'countPerPage')) {
      this.scanConfig.countPerPage = config.countPerPage
    }
    if (config && Object.prototype.hasOwnProperty.call(config, 'pagesPerCategory')) {
      this.scanConfig.pagesPerCategory = config.pagesPerCategory
    }
    if (config && Object.prototype.hasOwnProperty.call(config, 'allCount')) {
      this.scanConfig.allCount = config.allCount
    }
    this.logger.info(`扫描配置已更新: 全站${this.scanConfig.allCount}个/次, 分类每页${this.scanConfig.countPerPage}个, 每分类${this.scanConfig.pagesPerCategory}页`)
  }
  
  /**
   * 设置要扫描的分类列表
   * @param {Array} categories - 分类数组 [{id, name}, ...]
   */
  setCategoryList(categories) {
    if (Array.isArray(categories) && categories.length > 0) {
      this.categoryList = categories
      this.logger.info(`已设置分类列表，共${categories.length}个分类`)
    }
  }
  
  /**
   * 获取当前使用的分类列表
   * @returns {Array} 分类数组
   */
  getCategoryList() {
    return this.categoryList
  }
  
  /**
   * 获取所有可用的分类
   * @returns {Array} 所有分类
   */
  getAllCategories() {
    return DEFAULT_CATEGORIES
  }

  /**
   * getScanRiskState 方法：获取扫描风控状态。
   */
  getScanRiskState(accountId) {
    if (!this.scanRiskByAccount.has(accountId)) {
      this.scanRiskByAccount.set(accountId, createScanRiskState())
    }
    return this.scanRiskByAccount.get(accountId)
  }

  /**
   * getAdaptiveScanProfile 方法：获取自适应扫描策略。
   */
  getAdaptiveScanProfile(accountId) {
    return calcAdaptiveScanProfile(this.getScanRiskState(accountId), this.scanConfig)
  }

  /**
   * getDeepScanProfile 方法：获取深度扫描策略。
   */
  getDeepScanProfile(baseProfile = null, options = {}) {
    const profile = baseProfile || {}
    const deadlineMs = Number(options?.deadlineMs || 0)
    return {
      ...profile,
      // 等待开奖阶段：全站与分类都进入深扫，分类启用自动翻页（page<=0）
      deepScan: true,
      allTimes: Math.max(40, Number(profile?.allTimes || 0)),
      maxAllRounds: Math.max(240, Number(profile?.maxAllRounds || 0)),
      noGrowthBreakRounds: Math.max(36, Number(profile?.noGrowthBreakRounds || 0)),
      pagesPerCategory: 0,
      maxCategoryPages: Math.max(500, Number(profile?.maxCategoryPages || 0)),
      categoryNoGrowthBreakPages: Math.max(32, Number(profile?.categoryNoGrowthBreakPages || 0)),
      deadlineMs: deadlineMs > 0 ? deadlineMs : undefined
    }
  }

  /**
   * applyScanRiskFeedback 方法：应用扫描风控反馈。
   */
  applyScanRiskFeedback(accountId, stats, onLog) {
    const current = this.getScanRiskState(accountId)
    const result = updateScanRiskState(current, stats)
    this.scanRiskByAccount.set(accountId, result.state)

    if (typeof onLog === 'function' && result.raised) {
      onLog(`🛡️ 检测到风控风险，扫描降速等级提升到${result.state.level}，冷却${Math.ceil(result.cooldownMs / 1000)}秒`, 'warning')
    }
    if (typeof onLog === 'function' && result.lowered) {
      onLog(`✅ 风控压力下降，扫描降速等级恢复到${result.state.level}`, 'success')
    }
  }

  /**
   * getStartupStaggerMs 方法：获取启动阶段错峰。
   */
  getStartupStaggerMs(accountId) {
    const text = String(accountId || '')
    let hash = 0
    for (let i = 0; i < text.length; i++) {
      hash = (hash + text.charCodeAt(i) * (i + 3)) % 997
    }
    const slot = hash % 7
    return 1200 + slot * 650 + Math.floor(Math.random() * 500)
  }

  /**
   * startAccount 方法：启动账号。
   */
  async startAccount(account, config, callbacks, bootOptions = {}) {
    ipcRenderer = getIpcRenderer()
    if (!ipcRenderer) {
      callbacks.onLog('Electron IPC 不可用', 'error')
      return
    }

    if (this.startingAccounts.has(account.id)) {
      callbacks.onLog(`⚠️ [${account.id}] 正在启动中，忽略重复启动请求`, 'warning')
      return
    }
    const existing = this.accounts.get(account.id)
    if (existing && !this.isPaused(account.id)) {
      existing.config = config
      existing.callbacks = callbacks
      callbacks.onLog(`⚠️ [${account.id}] 已在运行，忽略重复启动请求`, 'warning')
      return
    }

    this.startingAccounts.add(account.id)

    try {
      const initialParticipationCount = Math.max(
        0,
        Number(existing?.participationCount ?? account?.participationCount ?? 0)
      )
      const accountData = {
        ...account,
        config,
        callbacks,
        tokenInfo: null,
        participationCount: initialParticipationCount,
        startedAt: Date.now(),
        monitoringStarted: false,
        firstRoundScanDone: false
      }
      
      this.accounts.set(account.id, accountData)
      this.setAccountLotteryList(account.id, [])
      this.setCollectLoading(account.id, false)
      this.setPaused(account.id, false)
      this.emitDispatchUpdateForAllAccounts()
      
      // 检查是否已有浏览器窗口
      let browserExists = false
      try {
        const checkResult = await ipcRenderer.invoke('check-browser-exists', account.id)
        browserExists = checkResult.exists
      } catch (e) {
        this.logger.debug(`[${account.id}] 检查浏览器实例失败，按未打开处理`, e)
      }
      
      // 如果没有浏览器窗口，先启动
      if (!browserExists) {
        const result = await ipcRenderer.invoke('launch-browser', account.id)
        if (!result.success) {
          callbacks.onLog(`启动浏览器失败: ${result.error}`, 'error')
          return
        }
        callbacks.onLog(`浏览器已启动`)
      }

      try {
        await ipcRenderer.invoke('set-live-stream-blocking', {
          accountId: account.id,
          enabled: false
        })
      } catch (e) {
        this.logger.debug(`[${account.id}] 同步直播流拦截开关失败`, e)
      }
      
      accountData.state = 'opened'
      
      const reuseLoggedInBrowser = bootOptions?.reuseLoggedInBrowser === true
      const tokenResult = bootOptions?.tokenInfo
        ? { success: true, tokenInfo: bootOptions.tokenInfo }
        : await ipcRenderer.invoke('load-token', account.id)
      
      if (tokenResult.success && tokenResult.tokenInfo) {
        if (reuseLoggedInBrowser) {
          accountData.tokenInfo = tokenResult.tokenInfo
          callbacks.onLog(`✅ 扫码登录成功，直接接管当前窗口继续运行`)
          callbacks.onStatusUpdate({ 
            id: account.id, 
            state: 'running',
            token: tokenResult.tokenInfo.sessionid || tokenResult.tokenInfo.sessionid_ss
          })

          await ipcRenderer.invoke('navigate-to', {
            accountId: account.id,
            url: 'https://live.douyin.com/'
          })

          setTimeout(() => {
            this.startMonitoring(account.id)
          }, 400)
          return
        }

        callbacks.onLog(`发现本地Token，尝试自动登录...`)
        
        // 设置cookies
        const setCookieResult = await ipcRenderer.invoke('set-cookies', {
          accountId: account.id,
          tokenInfo: tokenResult.tokenInfo
        })
        
        if (setCookieResult.success && setCookieResult.isLoginCookieReady !== false) {
          callbacks.onLog(`🔐 Token已加载，正在验证登录状态...`)

          await ipcRenderer.invoke('navigate-to', {
            accountId: account.id,
            url: 'https://live.douyin.com/'
          })

          const verifyResult = await ipcRenderer.invoke('get-user-info', account.id)
          if (!verifyResult?.success || !verifyResult?.userInfo?.nickname) {
            callbacks.onLog(`⚠️ 本地Token校验失败，账号登录态可能已过期`, 'warning')
            callbacks.onStatusUpdate({
              id: account.id,
              state: 'waiting'
            })
            if (typeof callbacks.onTokenInvalid === 'function') {
              await callbacks.onTokenInvalid({
                id: account.id,
                reason: '本地 Token 已过期，请重新扫码登录'
              })
            }
            return
          }

          accountData.tokenInfo = tokenResult.tokenInfo
          callbacks.onLog(`✅ Token已加载，自动登录成功`)
          callbacks.onStatusUpdate({
            id: account.id,
            state: 'running',
            token: tokenResult.tokenInfo.sessionid || tokenResult.tokenInfo.sessionid_ss,
            nickname: verifyResult.userInfo.nickname,
            userId: verifyResult.userInfo.userId || account.id
          })

          // 直接开始监控
          setTimeout(() => {
            this.startMonitoring(account.id)
          }, 2000)
          return
        } else {
          callbacks.onLog(`⚠️ Token写入失败: ${setCookieResult?.error || '关键登录cookie未写入成功'}`, 'warning')
        }
      }
      
      // 没有本地Token或加载失败
      callbacks.onLog(`未找到有效Token，无法启动`, 'error')
      accountData.state = 'waiting'
      callbacks.onStatusUpdate({ id: account.id, state: 'waiting' })
    } finally {
      this.startingAccounts.delete(account.id)
    }
  }
  
  /**
   * checkLoginStatus 方法：检查登录状态。
   */
  async checkLoginStatus(accountId) {
    const accountData = this.accounts.get(accountId)
    if (!accountData) return
    
    const checkInterval = setInterval(async () => {
      const result = await ipcRenderer.invoke('get-login-token', accountId)
      
      if (result.success && result.isLoggedIn) {
        clearInterval(checkInterval)
        
        accountData.tokenInfo = result.tokenInfo
        accountData.callbacks.onLog(`✅ 登录成功！Token已获取`)
        
        // 显示用户信息
        if (result.userInfo && result.userInfo.nickname) {
          accountData.callbacks.onLog(`👤 用户: ${result.userInfo.nickname}`)
        }
        
        accountData.callbacks.onLog(`SessionID: ${result.tokenInfo.sessionid || result.tokenInfo.sessionid_ss}`)
        
        // 保存Token到本地（包含用户信息）
        const saveResult = await ipcRenderer.invoke('save-token', {
          accountId,
          tokenInfo: result.tokenInfo,
          userInfo: result.userInfo
        })
        
        if (saveResult.success) {
          accountData.callbacks.onLog(`💾 Token已保存到本地`)
          
          // 更新账号昵称为真实昵称
          if (saveResult.savedInfo && saveResult.savedInfo.nickname) {
            accountData.callbacks.onStatusUpdate({ 
              id: accountId, 
              nickname: saveResult.savedInfo.nickname
            })
          }
        }
        
        // 更新账号状态
        accountData.callbacks.onStatusUpdate({ 
          id: accountId, 
          state: 'opened',
          token: result.tokenInfo.sessionid || result.tokenInfo.sessionid_ss
        })
        
        // 开始监控
        setTimeout(() => {
          this.startMonitoring(accountId)
        }, 2000)
        return
      }
    }, 3000)
    
    // 60秒后停止检查
    setTimeout(() => {
      clearInterval(checkInterval)
    }, 60000)
  }

  /**
   * startMonitoring 方法：启动监控。
   */
  async startMonitoring(accountId) {
    const accountData = this.accounts.get(accountId)
    if (!accountData) return
    if (accountData.monitoringStarted) return
    accountData.monitoringStarted = true

    const activeCount = this.getActiveMonitorAccounts().length
    const isFirstActiveAccount = activeCount <= 1
    const staggerMs = isFirstActiveAccount
      ? (120 + Math.floor(Math.random() * 220))
      : this.getStartupStaggerMs(accountId)
    if (staggerMs > 0) {
      this.logger.debug(`[${accountId}] 启动错峰: ${Math.ceil(staggerMs / 1000)}s`)
      await this.sleep(staggerMs)
      if (!this.accounts.has(accountId) || this.isPaused(accountId)) return
    }

    this.ensureScannerAccount(accountId)
    this.emitAccountDispatchUpdate(accountId)
    
    // 首轮先走快速扫描，缩短首次出候选耗时
    this.searchLiveRoom(accountId, { quickCycle: true })
  }

  /**
   * stopAccount 方法：停止账号。
   */
  async stopAccount(accountId) {
    this.setPaused(accountId, true)
    this.clearAccountTimer(accountId)
    this.clearScanCycleTimer(accountId)
    await this.releaseClaimedPoolTask(accountId, 'stop_account')
    await ipcRenderer.invoke('close-browser', accountId)
    this.setAccountLotteryList(accountId, [])
    this.setCollectLoading(accountId, false)
    this.attendFailureStreak.delete(accountId)
    this.cycleTimerByAccount.delete(accountId)
    this.minPoolEndTimeByAccount.delete(accountId)
    this.poolUploadQueueByAccount.delete(accountId)
    this.scanRoleByAccount.delete(accountId)
    this.releaseScannerAccount(accountId)
    this.scanRiskByAccount.delete(accountId)
    this.skipLotteryUntilByAccount.delete(accountId)
    this.clearWaitRandomChatState(accountId)
    this.accounts.delete(accountId)
    if (this.activeScanAccountId === accountId) {
      this.activeScanAccountId = ''
    }
    this.syncLocalScanPlans()
    if (this.accounts.size === 0) {
      this.clientFirstRoundScanDone = false
      this.localScanRoomLeaseById.clear()
    this.allScanSeenRooms.clear()
      this.poolUploadQueueByAccount.clear()
    }
    this.emitDispatchUpdateForAllAccounts()
  }

  /**
   * shutdownAllAccounts 方法：应用退出前同步关闭所有扫描与等待任务，避免卸载阶段继续执行轮询。
   */
  shutdownAllAccounts() {
    const accountIds = Array.from(this.accounts.keys())
    for (const accountId of accountIds) {
      this.setPaused(accountId, true)
      this.clearAccountTimer(accountId)
      this.clearScanCycleTimer(accountId)
      this.setCollectLoading(accountId, false)
      this.attendFailureStreak.delete(accountId)
      this.minPoolEndTimeByAccount.delete(accountId)
      this.scanRoleByAccount.delete(accountId)
      this.scanRiskByAccount.delete(accountId)
      this.skipLotteryUntilByAccount.delete(accountId)
      this.clearWaitRandomChatState(accountId)
      this.releaseClaimedPoolTask(accountId, 'shutdown').catch(() => {})
    }
    for (const timer of this.scanCycleTimerByAccount.values()) {
      clearTimeout(timer)
    }
    this.scanCycleTimerByAccount.clear()
    this.scannerAccountId = null
    this.activeScanAccountId = ''
    this.waitScanDispatchLockUntil = 0
    this.accounts.clear()
    this.taskStageByAccount.clear()
    this.scanAssignmentCache = null
    this.scanPlanByAccount.clear()
    this.localScanRoomLeaseById.clear()
    this.allScanSeenRooms.clear()
    this.clientFirstRoundScanDone = false
  }

  /**
   * 检查浏览器是否仍在运行
   */
  async isBrowserAlive(accountId) {
    try {
      const result = await ipcRenderer.invoke('check-browser-exists', accountId)
      return result.exists
    } catch (e) {
      this.logger.debug(`[${accountId}] 检查浏览器存活失败`, e)
      return false
    }
  }

  /**
   * 统一搜索直播间（参考原项目）
   */
  async searchLiveRoom(accountId, options = {}) {
    const scanOnly = options?.scanOnly === true
    const deepScan = scanOnly ? options?.deepScan !== false : false
    const deadlineMs = Number(options?.deadlineMs || 0)
    const quickCycle = options?.quickCycle === true
    const forceScanner = options?.forceScanner === true
    const forcedScanPlan = options?.scanPlan || null
    if (this.isCollectLoading(accountId)) {
      return
    }
    
    if (!this.accounts.has(accountId)) return

    try {
      this.setCollectLoading(accountId, true)
      const accountData = this.accounts.get(accountId)
      if (!accountData) return
      const scanAssignment = await this.refreshPoolScanAssignment(scanOnly || quickCycle)
      const scanPlan = forceScanner ? forcedScanPlan : this.getNormalScanPlan(accountId, scanAssignment)
      const isScanner = forceScanner || !!scanPlan
      if (isScanner && this.activeScanAccountId && this.activeScanAccountId !== accountId) {
        this.logScanRoleIfChanged(accountId, 'worker')
        if (!scanOnly) {
          this.scheduleSelectionOrScanRetry(accountId, 1800, { quickCycle, trigger: 'scan-slot-busy' })
        }
        return
      }
      this.logScanRoleIfChanged(accountId, isScanner ? 'scanner' : 'worker', scanPlan || forcedScanPlan)

      if (!isScanner) {
        if (scanOnly) {
          return
        }
        await this.refreshPoolFromServer(accountId)
        this.removeExpiredLotteries(accountId)
        this.calculatePredictedProbabilities(accountId)
        this.sortLotteriesByProbability(accountId)
        this.emitLotteryListUpdate(accountData)
        this.scheduleAccountTask(accountId, 1200, () => this.start(accountId, {
          preferQuickScan: quickCycle,
          trigger: 'worker-pool-claim'
        }))
        return
      }

      const baseScanProfile = this.getAdaptiveScanProfile(accountId)
      const fallbackCategories = this.resolveAssignedCategoryList(null)
      const forcedCategories = this.resolveAssignedCategoryList(scanAssignment)
      const forcedCategoryPlans = this.resolveAssignedCategoryPlans(scanAssignment)
      const forcedHasCategories = (Array.isArray(forcedCategories) && forcedCategories.length > 0) ||
        (Array.isArray(forcedCategoryPlans) && forcedCategoryPlans.length > 0)
      const forcedAllScanEnabled = scanAssignment ? (scanAssignment.allScanEnabled !== false) : true
      const activeScanPlan = forceScanner ? (forcedScanPlan || {
        kind: forcedAllScanEnabled ? 'all' : 'category',
        mode: 'forced',
        allScanEnabled: forcedAllScanEnabled || !forcedHasCategories,
        assignedCategories: forcedHasCategories ? forcedCategories : fallbackCategories,
        assignedCategoryPlans: forcedCategoryPlans.length > 0
          ? forcedCategoryPlans
          : (forcedHasCategories ? forcedCategories : fallbackCategories),
        budget: scanAssignment?.budget || null,
        shardKey: `forced:${accountId}`,
        workerIndex: 0,
        workerCount: 1
      }) : scanPlan
      const assignedCategoryList = Array.isArray(activeScanPlan?.assignedCategories) ? activeScanPlan.assignedCategories : []
      const allScanEnabled = activeScanPlan ? (activeScanPlan.allScanEnabled !== false) : (scanAssignment ? (scanAssignment.allScanEnabled !== false) : true)
      const clientAllowsAllScan = scanAssignment ? (scanAssignment.allScanEnabled !== false) : true
      let scanProfile = scanOnly && deepScan
        ? this.getDeepScanProfile(baseScanProfile, { deadlineMs })
        : { ...baseScanProfile }
      const useSupermanFirstRound = !scanOnly && quickCycle && accountData.firstRoundScanDone !== true
      if (useSupermanFirstRound) {
        const FIRST_ROUND_BUDGET_MS = 45000
        const firstRoundDeadlineMs = deadlineMs > 0
          ? Math.min(deadlineMs, Date.now() + FIRST_ROUND_BUDGET_MS)
          : (Date.now() + FIRST_ROUND_BUDGET_MS)
        scanProfile = {
          ...scanProfile,
          supermanFirstRound: true,
          // 首轮优先覆盖，不做 hint 强约束，避免漏掉“无提示但有福袋”的房间。
          forceLotteryHintOnly: false,
          firstRoundUseCursorPaging: true,
          allTimes: Math.max(80, Number(scanProfile.allTimes || 80)),
          maxAllRounds: Math.max(160, Number(scanProfile.maxAllRounds || 160)),
          noGrowthBreakRounds: Math.max(60, Number(scanProfile.noGrowthBreakRounds || 60)),
          allCount: 20,
          pagesPerCategory: 0,
          maxCategoryPages: 0,
          categoryNoGrowthBreakPages: 0,
          detailConcurrency: 2,
          itemGapMs: Math.max(320, Number(scanProfile.itemGapMs || 0)),
          detailRoomCap: 20,
          cycleDelayMinMs: 260,
          cycleDelayMaxMs: 520,
          deadlineMs: firstRoundDeadlineMs
        }
        accountData.callbacks.onLog('🔧 首轮扫描使用模式')
      } else if (!scanOnly && quickCycle) {
        scanProfile = {
          ...scanProfile,
          allTimes: Math.max(2, Math.min(4, Number(scanProfile.allTimes || 4))),
          maxAllRounds: Math.max(6, Math.min(12, Number(scanProfile.maxAllRounds || 12))),
          noGrowthBreakRounds: Math.max(3, Math.min(4, Number(scanProfile.noGrowthBreakRounds || 4))),
          pagesPerCategory: Math.max(2, Math.min(3, Number(scanProfile.pagesPerCategory || 3))),
          maxCategoryPages: Math.max(8, Math.min(18, Number(scanProfile.maxCategoryPages || 18))),
          categoryNoGrowthBreakPages: Math.max(3, Math.min(4, Number(scanProfile.categoryNoGrowthBreakPages || 4))),
          cycleDelayMinMs: Math.min(700, Number(scanProfile.cycleDelayMinMs || 700)),
          cycleDelayMaxMs: Math.min(1300, Math.max(Number(scanProfile.cycleDelayMaxMs || 1300), 900))
        }
      }
      scanProfile = this.applyLocalScanPlanToProfile({
        ...scanProfile,
        assignedCategories: assignedCategoryList,
        allScanEnabled
      }, activeScanPlan, { scanOnly, quickCycle })
      if (scanProfile.level > 0) {
        accountData.callbacks.onLog(
          `🛡️ 当前扫描降速等级${scanProfile.level}（并发${scanProfile.detailConcurrency}，分类页数${scanProfile.pagesPerCategory}）`
        )
      }

      this.emitLotteryListUpdate(accountData)
      
      // 检查浏览器是否存活
      if (!(await this.isBrowserAlive(accountId))) {
        accountData.callbacks.onLog('⚠️ 浏览器窗口已关闭，停止扫描任务')
        return
      }

      this.setPaused(accountId, false)

      if (deadlineMs > 0 && Date.now() >= deadlineMs) {
        return
      }

      if (!useSupermanFirstRound && scanProfile.cooldownRemainMs > 0) {
        const waitMs = Math.min(scanProfile.cooldownRemainMs + 600, 60000)
        if (!scanOnly) {
          accountData.callbacks.onLog(`🛡️ 风控冷却中，${Math.ceil(waitMs / 1000)}秒后继续扫描...`, 'warning')
          this.scheduleSelectionOrScanRetry(accountId, waitMs, { quickCycle, trigger: 'scan-cooldown' })
        }
        return
      }

      // 1) 先清理过期项，保留仍可用池子（参考：不每轮清空）
      this.removeExpiredLotteries(accountId)
      this.calculatePredictedProbabilities(accountId)
      this.sortLotteriesByProbability(accountId)
      this.emitLotteryListUpdate(accountData)

      // 2. 按逻辑：先全站，再按分类采集补充池子
      const runAllScanThisRound = allScanEnabled || useSupermanFirstRound
      if (runAllScanThisRound) {
        await this.searchLiveByAll(accountId, scanProfile.allTimes, scanProfile)
      }
      if (this.isPaused(accountId) || !(await this.isBrowserAlive(accountId))) return
      const afterAllProfile = this.getAdaptiveScanProfile(accountId)
      if (runAllScanThisRound && !useSupermanFirstRound && afterAllProfile.level >= 2 && afterAllProfile.cooldownRemainMs > 0) {
        const waitMs = Math.min(afterAllProfile.cooldownRemainMs + 800, 60000)
        if (!scanOnly) {
          accountData.callbacks.onLog(`🛡️ 全站扫描后命中风控冷却，${Math.ceil(waitMs / 1000)}秒后继续`, 'warning')
          this.scheduleSelectionOrScanRetry(accountId, waitMs, { quickCycle, trigger: 'all-scan-cooldown' })
        }
        return
      }

      // 首轮只跑全站扫描，后续轮次再用分类补充池子
      // 全站扫描结果充足时跳过分类，减少不必要的请求压力
      const SKIP_CATEGORY_THRESHOLD = 15
      const afterAllCandidateCount = this.getAccountLotteryList(accountId).length
      const shouldRunCategoryScan = !useSupermanFirstRound &&
        Array.isArray(assignedCategoryList) && assignedCategoryList.length > 0 &&
        afterAllCandidateCount < SKIP_CATEGORY_THRESHOLD
      if (shouldRunCategoryScan) {
        await this.startCollectLive(accountId, scanProfile)
      }
      if (this.isPaused(accountId) || !(await this.isBrowserAlive(accountId))) return
      const afterCategoryProfile = shouldRunCategoryScan ? this.getAdaptiveScanProfile(accountId) : null
      if (shouldRunCategoryScan && afterCategoryProfile.level >= 2 && afterCategoryProfile.cooldownRemainMs > 0) {
        const waitMs = Math.min(afterCategoryProfile.cooldownRemainMs + 800, 60000)
        if (!scanOnly) {
          accountData.callbacks.onLog(`🛡️ 分类扫描后命中风控冷却，${Math.ceil(waitMs / 1000)}秒后继续`, 'warning')
          this.scheduleSelectionOrScanRetry(accountId, waitMs, { quickCycle, trigger: 'category-scan-cooldown' })
        }
        return
      }

      // 3. 清理 + 概率 + 排序
      this.removeExpiredLotteries(accountId)
      this.calculatePredictedProbabilities(accountId)
      this.sortLotteriesByProbability(accountId)
      this.emitLotteryListUpdate(accountData)

      if (useSupermanFirstRound && accountData.firstRoundScanDone !== true) {
        const queueDrained = await this.waitPoolUploadIdle(accountId, 4200)
        if (queueDrained) {
          accountData.callbacks.onLog('First-round page upload completed')
        }
        accountData.firstRoundScanDone = true
        if (this.clientFirstRoundScanDone !== true) {
          this.clientFirstRoundScanDone = true
        }
        accountData.callbacks.onLog('First-round scan completed, switch to normal scan')
      }

      if (scanOnly) {
        return
      }

      await this.waitPoolUploadIdle(accountId, quickCycle ? 2500 : 4000)
      await this.refreshPoolFromServer(accountId)
      this.removeExpiredLotteries(accountId)
      this.calculatePredictedProbabilities(accountId)
      this.sortLotteriesByProbability(accountId)
      this.emitLotteryListUpdate(accountData)

      const startDelay = quickCycle ? 400 : 800
      this.scheduleAccountTask(accountId, startDelay, () => this.start(accountId, {
        preferQuickScan: quickCycle,
        trigger: 'scan-finished'
      }))
      
    } catch (error) {
      const accountData = this.accounts.get(accountId)
      if (accountData) {
        if (!scanOnly) {
          const retryDelay = quickCycle ? 3000 : 10000
          accountData.callbacks.onLog(`搜索失败: ${error.message}，${Math.ceil(retryDelay / 1000)}秒后重试...`, 'error')
          if (!this.isPaused(accountId)) {
            this.scheduleSelectionOrScanRetry(accountId, retryDelay, { quickCycle, trigger: 'search-failed' })
          }
        } else {
          this.logger.debug(`[${accountId}] 后台预扫描失败`, error)
        }
      }
    } finally {
      this.setCollectLoading(accountId, false)
    }
  }
  
  /**
   * 打印所有福袋详情和参与要求
   */
  printLotteryDetails(accountData) {
    const list = this.getAccountLotteryList(accountData?.id)
    if (list.length === 0) {
      return
    }
    
    accountData.callbacks.onLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    accountData.callbacks.onLog(`📋 福袋列表 (共${list.length}个，按开奖时间排序)`)
    accountData.callbacks.onLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    
    list.forEach((lottery, index) => {
      const simpleProbability = (lottery.simpleProbability * 100).toFixed(2)
      const predictedProbability = (lottery.predictedProbability * 100).toFixed(2)
      const remainingTime = Math.floor(lottery.end_time - Date.now() / 1000)
      const remainingMinutes = Math.floor(remainingTime / 60)
      const remainingSeconds = remainingTime % 60
      
      accountData.callbacks.onLog(`\n${index + 1}. ${lottery.authorNickname} (${lottery.webRid})`)
      accountData.callbacks.onLog(`   福袋: ${lottery.lotteryName || lottery.prize_name || '未知'}`)
      accountData.callbacks.onLog(`   当前概率: ${simpleProbability}% (${lottery.winningTotal}/${lottery.joinTotal})`)
      accountData.callbacks.onLog(`   预测概率: ${predictedProbability}% (预计${lottery.predictedFinalPeople}人)`)
      accountData.callbacks.onLog(`   剩余时间: ${remainingMinutes}分${remainingSeconds}秒`)
      accountData.callbacks.onLog(`   在线人数: ${lottery.onlineTotal || '未知'}`)
      
      // 打印参与条件
      if (lottery.conditions && lottery.conditions.length > 0) {
        const conditionsText = this.formatConditions(lottery.conditions)
        const hasFollowOrFan = lottery.conditions.some(c => c.type === 1 || c.type === 2)
        if (hasFollowOrFan) {
          accountData.callbacks.onLog(`   条件: ${conditionsText} ⚠️`)
        } else {
          accountData.callbacks.onLog(`   条件: ${conditionsText}`)
        }
      } else {
        accountData.callbacks.onLog(`   条件: 无`)
      }
    })
    
    accountData.callbacks.onLog('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    accountData.callbacks.onLog('📊 排序说明:')
    accountData.callbacks.onLog('  • 按开奖时间升序（最快开奖的在前）')
    accountData.callbacks.onLog('  • 当前概率 = 中奖数/参与数')
    accountData.callbacks.onLog('  • 预测概率 = 考虑剩余时间和在线人数的预测值')
    accountData.callbacks.onLog('  • ⚠️ = 需要关注或加入粉丝团')
    accountData.callbacks.onLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  }
  
  /**
   * 格式化福袋参与条件
   */
  formatConditions(conditions) {
    const conditionTypes = {
      1: '关注主播',
      2: '加入粉丝团',
      3: '发送口令',
      4: '分享直播间',
      5: '观看时长',
      6: '手动参与',
      7: '点赞直播间',
      8: '评论直播间'
    }
    
    return conditions.map(c => {
      const typeName = conditionTypes[c.type] || `类型${c.type}`
      if (c.content) {
        return `${typeName}(${c.content})`
      }
      return typeName
    }).join(' + ')
  }
  
  /**
   * 计算福袋中奖概率
   */
  calculateProbability(lottery) {
    if (!lottery.joinTotal || lottery.joinTotal === 0) {
      return 0
    }
    return ((lottery.winningTotal / lottery.joinTotal) * 100).toFixed(2)
  }
  
  /**
   * 剔除过期和失效的福袋
   */
  removeExpiredLotteries(accountId) {
    const source = this.getAccountLotteryList(accountId)
    const now = Date.now() / 1000 // 当前时间戳（秒）
    const beforeCount = source.length
    
    const filtered = source.filter(lottery => {
      // 检查是否有结束时间
      if (!lottery.end_time) {
        return false
      }
      
      // 检查是否已过期（结束时间 < 当前时间）
      if (lottery.end_time < now) {
        return false
      }
      
      // 检查是否即将过期（剩余时间 < 最小参与窗口）
      const remainingTime = lottery.end_time - now
      if (remainingTime < MIN_JOIN_WINDOW_SEC) {
        return false
      }

      return true
    })
    this.setAccountLotteryList(accountId, filtered)
    
    const removedCount = beforeCount - filtered.length
    if (removedCount > 0) {
      this.logger.debug(`🗑️ 已剔除 ${removedCount} 个过期/失效的福袋`)
    }
  }
  
  /**
   * 按中奖概率排序（从高到低）
   * 完全照搬原项目：按开奖时间升序排序（最快开奖的在前）
   */
  sortLotteriesByProbability(accountId) {
    const list = [...this.getAccountLotteryList(accountId)]
    list.sort((a, b) => {
      const timeA = a.end_time || 0
      const timeB = b.end_time || 0
      return timeA - timeB  // 升序：最快开奖的在前
    })
    this.setAccountLotteryList(accountId, list)
  }
  
  /**
   * 计算预测的中奖概率（参考原项目）
   * 考虑剩余时间、在线人数、当前参与人数等因素
   */
  calculateLuckyProbability(currentPeople, bagCount, totalDuration, remainingTime, onlinePeople) {
    // 参数验证
    if (totalDuration < 60 || remainingTime < 0 || remainingTime > totalDuration || 
        currentPeople < 0 || bagCount <= 0 || onlinePeople < 0) {
      return { finalPeople: 0, probability: 0 }
    }
    
    // 是否接近结束（剩余时间 <= 20%）
    const isNearEnd = remainingTime / totalDuration <= 0.2
    
    let baseFinalPeople
    if (isNearEnd) {
      // 接近结束，使用当前人数
      baseFinalPeople = currentPeople
    } else {
      // 预测最终人数
      const elapsedTime = totalDuration - remainingTime
      const elapsedRatio = elapsedTime / totalDuration
      const growth = 1 - Math.pow(1 - elapsedRatio, 2)
      const baseRatio = elapsedRatio === 0 ? 0.2 : growth
      baseFinalPeople = Math.ceil(currentPeople / baseRatio)
    }
    
    // 饱和度限制（最多85%的在线人数）
    const saturationRate = 0.85
    const saturationCap = Math.ceil(onlinePeople * saturationRate)
    baseFinalPeople = Math.min(baseFinalPeople, saturationCap)
    
    // 计算潜在新增人数
    let potentialNewPeople = 0
    if (!isNearEnd) {
      const remainingMinutes = remainingTime / 60
      const timeDecayRatio = remainingTime / totalDuration
      
      // 转化率计算
      const totalMinutes = totalDuration / 60
      let convertRatio = 0.4 - totalMinutes * 0.01
      convertRatio = Math.max(0.1, Math.min(convertRatio, 0.35))
      
      // 阶段衰减
      const elapsedTime = totalDuration - remainingTime
      let stageDecayFactor = 1
      if (elapsedTime > 3 * 60 && elapsedTime <= 6 * 60) {
        stageDecayFactor = 0.2
      } else if (elapsedTime > 6 * 60) {
        stageDecayFactor = 0.05
      }
      convertRatio = convertRatio * stageDecayFactor
      
      const maxPotential = currentPeople * 0.5
      potentialNewPeople = Math.min(
        Math.ceil(onlinePeople * convertRatio * remainingMinutes * timeDecayRatio),
        maxPotential
      )
    }
    
    // 最终预测人数
    let finalPeople = Math.min(
      Math.max(baseFinalPeople + potentialNewPeople, currentPeople),
      saturationCap
    )

    // 小样本阶段不能把“当前几乎没人参与”直接视为高命中。
    // 对这类候选补一个尾盘涌入下限，避免出现 0人参与却预测100% 的畸形结果。
    if (bagCount > 0 && remainingTime > 20) {
      const tailFactor = Math.max(0, Math.min((remainingTime - 20) / 120, 1))
      if (currentPeople <= 0) {
        const bootstrapFloor = Math.max(
          bagCount * 10,
          Math.min(Math.max(onlinePeople * 0.08, 12), 60)
        )
        finalPeople = Math.max(finalPeople, bootstrapFloor)
      } else if (currentPeople < 15) {
        const bootstrapFloor = currentPeople + Math.max(
          bagCount * 6,
          Math.min(Math.max(onlinePeople * 0.05, 8), 40)
        ) * tailFactor
        finalPeople = Math.max(finalPeople, bootstrapFloor)
      } else if (currentPeople < 40) {
        const bootstrapFloor = currentPeople + Math.max(
          bagCount * 3,
          Math.min(Math.max(onlinePeople * 0.03, 4), 20)
        ) * tailFactor
        finalPeople = Math.max(finalPeople, bootstrapFloor)
      }
    }
    
    // 计算概率
    const probability = Math.min(bagCount / finalPeople, 1)
    
    return {
      finalPeople,
      probability: Number(probability.toFixed(4))
    }
  }
  
  /**
   * 计算并添加预测概率信息
   */
  calculatePredictedProbabilities(accountId) {
    const now = Date.now() / 1000
    
    const mapped = this.getAccountLotteryList(accountId).map(item => {
      const totalDuration = item.end_time - item.start_time
      const remainingTime = item.end_time - now
      
      const { finalPeople, probability } = this.calculateLuckyProbability(
        item.joinTotal || 0,        // 当前参与人数
        item.winningTotal || 0,     // 福袋中奖个数
        totalDuration,              // 福袋总时长（秒）
        remainingTime,              // 福袋剩余时长（秒）
        item.onlineTotal || 0       // 当前在线人数
      )
      
      return {
        ...item,
        predictedProbability: probability,
        predictedFinalPeople: finalPeople,
        simpleProbability: item.joinTotal > 0 ? (item.winningTotal / item.joinTotal) : 0
      }
    })
    this.setAccountLotteryList(accountId, mapped)
  }

  /**
   * decorateLotteryForScoring 方法：为单个福袋补齐预测人数与预测概率，供本地评分复用。
   */
  decorateLotteryForScoring(lottery, nowSec = Date.now() / 1000) {
    if (!lottery) return null
    const totalDuration = Number(lottery.end_time || 0) - Number(lottery.start_time || 0)
    const remainingTime = Number(lottery.end_time || 0) - Number(nowSec || 0)
    const { finalPeople, probability } = this.calculateLuckyProbability(
      lottery.joinTotal || 0,
      lottery.winningTotal || 0,
      totalDuration,
      remainingTime,
      lottery.onlineTotal || 0
    )
    return {
      ...lottery,
      predictedProbability: probability,
      predictedFinalPeople: finalPeople,
      simpleProbability: lottery.joinTotal > 0 ? (lottery.winningTotal / lottery.joinTotal) : 0
    }
  }

  /**
   * 搜索直播间-【全部】（参考原项目）
   */
  async searchLiveByAll(accountId, times = 10, scanProfile = null) {
    return collectLiveByAll(this, accountId, times, scanProfile)
  }

  /**
   * 搜索直播间-【分类】（参考原项目）
   */
  async startCollectLive(accountId, scanProfile = null) {
    return collectLiveByCategory(this, accountId, scanProfile)
  }

  /**
   * 采集直播间-【每个分类】（参考原项目）
   */
  async searchLiveRoomCategory(accountId, {
    category_id,
    category_name,
    page = null,
    startOffset = 0,
    offsetStride = 0,
    count = null
  }, onBatch = null, scanProfile = null) {
    return collectLiveRoomCategory(this, accountId, {
      category_id,
      category_name,
      page,
      startOffset,
      offsetStride,
      count
    }, onBatch, scanProfile)
  }

  /**
   * 根据直播间信息获取福袋信息（并发，参考原项目）
   */
  async getLotteryInfo(roomInfoList, accountId, scanProfile = null) {
    return fetchLotteryInfoWithProfile(this, roomInfoList, accountId, scanProfile)
  }

  /**
   * 添加直播间到屏蔽列表
   * @param {string} roomId - 直播间ID
   */
  addBlockList(roomId) {
    if (roomId) {
      this.blockList.add(roomId)
      // 从所有账号的福袋列表中移除已屏蔽直播间
      for (const [accountId, list] of this.lotteryPoolByAccount.entries()) {
        this.setAccountLotteryList(accountId, list.filter(item => item.roomId !== roomId))
      }
    }
  }

  /**
   * 从屏蔽列表移除直播间
   * @param {string} roomId - 直播间ID
   */
  removeBlockList(roomId) {
    if (roomId) {
      this.blockList.delete(roomId)
    }
  }

  /**
   * 清空屏蔽列表
   */
  clearBlockList() {
    this.blockList.clear()
  }

  /**
   * 检查直播间是否在屏蔽列表中
   * @param {string} roomId - 直播间ID
   * @returns {boolean} 是否被屏蔽
   */
  isBlocked(roomId) {
    return this.blockList.has(roomId)
  }

  /**
   * 添加福袋信息，避免重复（参考原项目）
   */
  addLotteryInfoWithoutDuplicates(accountId, newLotteryList) {
    if (!Array.isArray(newLotteryList) || newLotteryList.length === 0) return
    // 每次添加新福袋前，先清理内存中已过期的福袋
    this.removeExpiredLotteries(accountId)
    const current = [...this.getAccountLotteryList(accountId)]
    const minPoolEndTime = this.getMinPoolEndTime(accountId)

    const existingRoomIds = new Set(current.map((item) => item.roomId))
    let addedCount = 0
    
    for (const lottery of newLotteryList) {
      const lotteryEndTime = Number(lottery?.end_time || 0)
      if (minPoolEndTime > 0 && lotteryEndTime > 0 && lotteryEndTime <= minPoolEndTime) {
        continue
      }
      // 对齐超人：入池仅做去重和屏蔽检查
      if (
        lottery &&
        !this.isBlocked(lottery.roomId) &&
        !existingRoomIds.has(lottery.roomId)
      ) {
        current.push(lottery)
        existingRoomIds.add(lottery.roomId)
        addedCount++
      }
    }
    this.setAccountLotteryList(accountId, current)
    
    if (addedCount > 0) {
      this.logger.debug(`➕ 新增 ${addedCount} 个福袋`)
    }
  }

  /**
   * calculateLotteryScore 方法：计算福袋评分。
   */
  calculateLotteryScore(item, nowSec, config = {}, lotteryAverageInfo = null) {
    const joinTotal = Number(item.joinTotal || 0)
    const winningTotal = Number(item.winningTotal || 0)
    const onlineTotal = Number(item.onlineTotal || 0)
    const remainingSec = Math.max(0, Number(item.end_time || 0) - nowSec)

    const simpleProb = joinTotal > 0 ? (winningTotal / joinTotal) : 0
    const predictedProb = Number(item.predictedProbability || simpleProb || 0)
    const useProb = Math.max(0, Math.min(1, Math.max(predictedProb, simpleProb)))

    // 剩余时间最佳区间：35~120秒，过短会来不及，过长会涌入更多参与者
    let timeFactor = 0
    if (remainingSec >= 35 && remainingSec <= 120) timeFactor = 1
    else if (remainingSec > 120 && remainingSec <= 220) timeFactor = 0.6
    else if (remainingSec >= 25 && remainingSec < 35) timeFactor = 0.45
    else timeFactor = 0.2

    // 人数越少越好，避免极度拥挤福袋
    const crowdPenalty = Math.min(Math.log10(Math.max(joinTotal, 1)) / 4, 1)
    const onlinePenalty = Math.min(Math.log10(Math.max(onlineTotal, 1)) / 5, 1)

    // 奖池数量适度加分（避免只有1个名额的低价值局）
    const rewardBonus = Math.min(winningTotal / 80, 1)
    const threshold = Number(config?.preferBigRedPacket?.threshold || 40)
    const redInfo = lotteryAverageInfo || getLotteryAveragePerWinner(item, threshold)
    let bigRedPacketBonus = 0
    if (config?.preferBigRedPacket?.enabled) {
      if (redInfo?.isBig) bigRedPacketBonus = 18
      else if (redInfo?.isRedPacket && redInfo?.known) bigRedPacketBonus = -4
    }

    let sampleReliability = 1
    if (joinTotal <= 0) sampleReliability = 0.55
    else if (joinTotal < 5) sampleReliability = 0.68
    else if (joinTotal < 15) sampleReliability = 0.82
    else if (joinTotal < 30) sampleReliability = 0.92

    const score =
      useProb * 100 * 0.62 +
      timeFactor * 100 * 0.2 +
      rewardBonus * 100 * 0.12 -
      crowdPenalty * 100 * 0.04 -
      onlinePenalty * 100 * 0.02 +
      bigRedPacketBonus
    
    return Number((score * sampleReliability).toFixed(4))
  }

  /**
   * getWaitScanDelayMs 方法：获取等待阶段扫描延迟。
   */
  getWaitScanDelayMs(remainingMs) {
    if (remainingMs > 60000) return 9000
    if (remainingMs > 25000) return 7000
    return 3500
  }

  /**
   * finishSingleRoundAndRestart 方法：结束当前轮次并触发下一轮扫描/参与流程。
   */
  finishSingleRoundAndRestart(accountId, options = {}) {
    const directStart = options?.directStart === true
    const accountData = this.accounts.get(accountId)
    if (!accountData || this.isPaused(accountId)) return

    this.clearWaitRandomChatState(accountId)
    this.setMinPoolEndTime(accountId, 0)
    this.setTaskStage(accountId, '')
    accountData.callbacks.onLog('🔄 单轮结束，开始下一轮正常扫描...')
    this.removeExpiredLotteries(accountId)
    this.calculatePredictedProbabilities(accountId)
    this.sortLotteriesByProbability(accountId)
    this.emitLotteryListUpdate(accountData)

    if (directStart) {
      accountData.callbacks.onLog('📡 停留结束，直接请求服务端候选池并参与...')
      this.scheduleAccountTask(accountId, 180, () => this.start(accountId))
      return
    }

    this.scheduleSelectionOrScanRetry(accountId, 300, { quickCycle: true, trigger: 'finish-round' })
  }

  /**
   * schedulePostDrawStay 方法：调度后置开奖停留阶段。
   */
  schedulePostDrawStay(accountId, stayDurationSec = 0) {
    const safeStaySec = Math.max(0, Number(stayDurationSec || 0))
    const enableScanDuringStay = safeStaySec > WAIT_SCAN_STAY_THRESHOLD_SEC
    const stayUntilMs = Date.now() + Math.max(0, safeStaySec * 1000)
    this.setTaskStage(accountId, safeStaySec > 0 ? 'post_draw_stay' : '')

    /**
     * runTick 方法：执行一次定时轮询，并按剩余时间决定下一步调度。
     */
    const runTick = async () => {
      const accountData = this.accounts.get(accountId)
      if (!accountData || this.isPaused(accountId)) return

      const remainMs = stayUntilMs - Date.now()
      if (remainMs <= 0) {
        this.finishSingleRoundAndRestart(accountId, { directStart: !enableScanDuringStay })
        return
      }

      await this.dispatchBalancedWaitScan(accountId, stayUntilMs - 1200, 'post-draw-stay-scan')
      if (!this.accounts.has(accountId) || this.isPaused(accountId)) return
      const nextDelay = this.getWaitScanDelayMs(stayUntilMs - Date.now())
      this.scheduleAccountTask(accountId, nextDelay, runTick)
    }

    if (safeStaySec <= 0) {
      this.finishSingleRoundAndRestart(accountId, { directStart: true })
      return
    }

    this.scheduleAccountTask(accountId, 1000, runTick)
  }

  /**
   * scheduleScanDuringWait 方法：调度扫描等待阶段。
   */
  scheduleScanDuringWait(accountId, drawUntilMs, options = {}) {
    const stayDurationSec = Math.max(0, Number(options?.stayDurationSec || 0))
    const waitRoomId = String(options?.waitRoomId || '')
    this.setTaskStage(accountId, 'waiting_draw')
    /**
     * runTick 方法：执行一次定时轮询，并按剩余时间决定下一步调度。
     */
    const runTick = async () => {
      const accountData = this.accounts.get(accountId)
      if (!accountData || this.isPaused(accountId)) return

      const remainMs = drawUntilMs - Date.now()
      if (remainMs <= 0) {
        this.clearWaitRandomChatState(accountId)
        accountData.callbacks.onLog('✅ 福袋已开奖')
        this.schedulePostDrawStay(accountId, stayDurationSec)
        return
      }

      await this.maybeSendRandomWaitChat(accountId, waitRoomId, accountData, drawUntilMs)
      if (!this.accounts.has(accountId) || this.isPaused(accountId)) return
      await this.dispatchBalancedWaitScan(accountId, drawUntilMs - 1200, 'wait-draw-scan')
      if (!this.accounts.has(accountId) || this.isPaused(accountId)) return
      const nextDelay = this.getWaitScanDelayMs(drawUntilMs - Date.now())
      this.scheduleAccountTask(accountId, nextDelay, runTick)
    }

    this.scheduleAccountTask(accountId, 1000, runTick)
  }

  /**
   * checkAccountRunGuards 方法：统一检查账号参与上限和运行时长约束。
   */
  checkAccountRunGuards(accountId, accountData, config = {}) {
    if (!accountData) return false

    if (config.participationCount?.enabled && accountData.participationCount >= config.participationCount.value) {
      accountData.callbacks.onLog(`⛔ 已达到参与上限(${config.participationCount.value})，自动暂停`, 'warning')
      accountData.callbacks.onStatusUpdate({ id: accountId, state: 'paused' })
      this.setPaused(accountId, true)
      this.clearAccountTimer(accountId)
      return false
    }

    if (config.singleAccountDuration?.enabled) {
      const elapsedHours = (Date.now() - (accountData.startedAt || Date.now())) / 3600000
      if (elapsedHours >= config.singleAccountDuration.value) {
        accountData.callbacks.onLog(`⛔ 已达到运行时长上限(${config.singleAccountDuration.value}小时)，自动暂停`, 'warning')
        accountData.callbacks.onStatusUpdate({ id: accountId, state: 'paused' })
        this.setPaused(accountId, true)
        this.clearAccountTimer(accountId)
        return false
      }
    }

    return true
  }

  /**
   * updateAccountCurrentRoom 方法：同步更新账号当前所在直播间与运行状态。
   */
  updateAccountCurrentRoom(accountId, accountData, lotteryInfo, state = 'running') {
    if (!accountData || !lotteryInfo) return
    accountData.currentRoom = `${lotteryInfo.authorNickname || '未知主播'}(${lotteryInfo.webRid || lotteryInfo.roomId || ''})`
    accountData.state = state
    accountData.callbacks.onStatusUpdate({
      id: accountId,
      state,
      currentRoom: accountData.currentRoom
    })
  }

  /**
   * logLotteryDecision 方法：输出当前目标福袋的核心信息，便于观察进入房间与参与决策。
   */
  logLotteryDecision(accountData, lotteryInfo, config = {}, options = {}) {
    if (!accountData || !lotteryInfo) return

    const now = Number(options?.now || Date.now() / 1000)
    const currentProb = Number(this.calculateProbability(lotteryInfo))
    const predictedProb = Number(lotteryInfo.predictedProbability || 0) * 100
    const remainingTime = Math.max(0, Number(lotteryInfo.end_time || 0) - now)
    const threshold = Number(config?.preferBigRedPacket?.threshold || 40)
    const lotteryAverageInfo = getLotteryAveragePerWinner(lotteryInfo, threshold)
    const score = Number.isFinite(Number(options?.score))
      ? Number(options.score)
      : this.calculateLotteryScore(lotteryInfo, now, config, lotteryAverageInfo)
    const title = String(options?.title || '🎯 选择最优福袋')
    const modeText = String(options?.modeText || '')

    accountData.callbacks.onLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    accountData.callbacks.onLog(`${title}: ${lotteryInfo.authorNickname || '未知主播'}`)
    accountData.callbacks.onLog(`   福袋: ${lotteryInfo.lotteryName || lotteryInfo.prize_name || '未知奖品'}`)
    accountData.callbacks.onLog(`   当前概率: ${currentProb}%`)
    accountData.callbacks.onLog(`   预测概率: ${predictedProb.toFixed(2)}%`)
    accountData.callbacks.onLog(`   筛选评分: ${Number(score).toFixed(2)}`)
    if (modeText) {
      accountData.callbacks.onLog(`   执行策略: ${modeText}`)
    }
    if (config.onlyPhysicalPrize?.enabled) {
      accountData.callbacks.onLog('   实物筛选: 已开启')
    }
    if (config.preferBigRedPacket?.enabled) {
      if (isPhysicalPrizeLottery(lotteryInfo)) {
        const physicalName = String(
          lotteryInfo?.lotteryName ||
          lotteryInfo?.prize_name ||
          lotteryInfo?.prizeInfo?.name ||
          lotteryInfo?.prize_info?.name ||
          '实物奖品'
        ).trim()
        accountData.callbacks.onLog(`   福袋均值: ${physicalName}（实物）`)
      } else if (lotteryAverageInfo?.known) {
        accountData.callbacks.onLog(`   福袋均值: ${lotteryAverageInfo.avgPerWinner.toFixed(2)} (阈值${threshold})`)
      } else {
        accountData.callbacks.onLog(`   福袋均值: 未知 (阈值${threshold})`)
      }
    }
    accountData.callbacks.onLog(`   剩余时间: ${remainingTime.toFixed(0)}秒`)
    accountData.callbacks.onLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  }

  /**
   * handoverScannerForExecution 方法：当前账号进入执行链时，将扫描职责切给其他可用账号。
   */
  handoverScannerForExecution(accountId, reason = 'execution') {
    this.syncLocalScanPlans()
    const nextScannerIds = this.sortAccountIds(Array.from(this.scanPlanByAccount.keys()))
    if (nextScannerIds.length > 0) {
      this.logger.debug(`[${accountId}] handover scan load -> ${nextScannerIds.join(',')} (${reason})`)
    }
  }

  /**
   * prepareLotteryRoom 方法：负责进入直播间并等待页面稳定，供后续立即参与链路复用。
   */
  async prepareLotteryRoom(accountId, accountData, lotteryInfo, config = {}, options = {}) {
    if (!accountData || !lotteryInfo) return false

    const reuseCurrentRoom = options?.reuseCurrentRoom === true

    this.updateAccountCurrentRoom(accountId, accountData, lotteryInfo, 'running')

    if (!reuseCurrentRoom) {
      accountData.callbacks.onLog('🚪 正在进入直播间，等待福袋入口...')
      await ipcRenderer.invoke('navigate-to', {
        accountId,
        url: `https://live.douyin.com/${lotteryInfo.webRid}`
      })
    }

    const ready = await this.waitForLiveRoomReady(accountId)
    if (!ready) {
      return false
    }

    return this.accounts.has(accountId) && !this.isPaused(accountId)
  }

  /**
   * executeLotteryParticipation 方法：执行超人模式参与动作，直接进入直播间并立即尝试参与。
   */
  async executeLotteryParticipation(accountId, accountData, lotteryInfo, config = {}, options = {}) {
    if (!accountData || !lotteryInfo) return

    if (!this.checkAccountRunGuards(accountId, accountData, config)) {
      return
    }

    const now = Date.now() / 1000
    const decoratedLottery = this.decorateLotteryForScoring(lotteryInfo, now) || lotteryInfo
    const remainingTime = Math.max(0, Number(decoratedLottery.end_time || 0) - now)
    if (remainingTime <= EXECUTION_MIN_JOIN_SEC) {
      accountData.callbacks.onLog('⚠️ 目标福袋剩余时间过短，放弃本轮并重新选择...', 'warning')
      await this.releaseClaimedPoolTask(accountId, 'late_window')
      this.markLotteryTemporarySkip(accountId, decoratedLottery, 90)
      this.removeLotteryFromPool(accountId, decoratedLottery)
      this.scheduleNextLotteryImmediately(accountId, '剩余时间不足', { from: 'late-window' })
      return
    }

    this.setTaskStage(accountId, 'joining')
    this.handoverScannerForExecution(accountId, options?.reuseCurrentRoom ? 'reuse-room-join' : 'direct-join')
    this.logLotteryDecision(accountData, decoratedLottery, config, {
      now,
      title: options?.title || '🎯 选择目标福袋',
      modeText: options?.modeText || '进入直播间等待福袋入口并立即参与',
      score: options?.score
    })

    const prepared = await this.prepareLotteryRoom(accountId, accountData, decoratedLottery, config, {
      reuseCurrentRoom: options?.reuseCurrentRoom === true
    })
    if (!prepared) {
      await this.releaseClaimedPoolTask(accountId, 'room_not_ready')
      if (this.accounts.has(accountId) && !this.isPaused(accountId)) {
        accountData.callbacks.onLog('⚠️ 直播间未就绪，2秒后重新扫描...', 'warning')
        this.scheduleSelectionOrScanRetry(accountId, 2000, { quickCycle: true, trigger: 'room-not-ready' })
      }
      return
    }

    const buildHistoryLotteryInfo = (lotteryId = '') => {
      const latestLottery = this.getLiveLotterySnapshot(accountId, decoratedLottery) || decoratedLottery
      return {
        ...latestLottery,
        lottery_id: String(lotteryId || latestLottery?.lottery_id || decoratedLottery?.lottery_id || '')
      }
    }

    if (config.randomInteraction?.enabled && Math.random() < 0.35) {
      ipcRenderer.invoke('room-like', {
        roomId: decoratedLottery.roomId,
        accountId,
        count: Math.floor(Math.random() * 3) + 1
      }).catch(() => {})
    }

    accountData.callbacks.onLog('✅ 已进入直播间，等待福袋入口并立即执行参与...')

    const latestRemainingTime = Math.max(0, Number(decoratedLottery.end_time || 0) - (Date.now() / 1000))
    if (latestRemainingTime <= EXECUTION_MIN_JOIN_SEC) {
      accountData.callbacks.onLog('⚠️ 进入直播间后福袋剩余时间过短，放弃本轮并重新选择...', 'warning')
      const expiredLottery = buildHistoryLotteryInfo()
      await this.releaseClaimedPoolTask(accountId, 'late_window_after_navigation')
      this.markLotteryTemporarySkip(accountId, expiredLottery, 90)
      this.removeLotteryFromPool(accountId, expiredLottery)
      this.scheduleNextLotteryImmediately(accountId, '剩余时间不足', { from: 'late-window-after-navigation' })
      return
    }

    const uiJoinResult = await this.joinLotteryByUI(accountId, latestRemainingTime, {
      lotteryInfo: decoratedLottery,
      accountData,
      config
    })
    if (uiJoinResult.success) {
      const uiSuccessText = uiJoinResult.confirmed ? '🎁 UI参与成功（已确认）' : '🎁 UI参与成功'
      await this.onJoinSuccess(
        accountId,
        accountData,
        latestRemainingTime,
        config,
        uiSuccessText,
        buildHistoryLotteryInfo(uiJoinResult?.lotteryId || '')
      )
      return
    }

    const uiFailureCode = String(uiJoinResult?.code || '')
    if (['LOTTERY_ENTRY_NOT_FOUND', 'LOTTERY_ENTRY_CLICK_FAILED'].includes(uiFailureCode)) {
      const missingEntryLottery = buildHistoryLotteryInfo()
      const missingEntryReason = uiJoinResult.error || '未找到福袋入口'
      this.reportPoolTaskFeedback(accountId, 'lottery_entry_missing', missingEntryLottery, {
        joinMode: 'UI',
        remainingSec: latestRemainingTime,
        reason: missingEntryReason
      }).catch(() => {})
      await this.releaseClaimedPoolTask(accountId, 'lottery_entry_missing')
      this.markLotteryTemporarySkip(accountId, missingEntryLottery, 180)
      this.removeLotteryFromPool(accountId, missingEntryLottery)
      this.scheduleNextLotteryImmediately(accountId, missingEntryReason, { from: 'lottery-entry-missing' })
      return
    }

    if (uiJoinResult?.code === 'SECOND_INSPECT_REJECT') {
      const rejectedLottery = buildHistoryLotteryInfo()
      const rejectReason = uiJoinResult.error || '二次检查未通过'
      this.reportPoolTaskFeedback(accountId, 'second_inspect_reject', rejectedLottery, {
        joinMode: 'UI',
        remainingSec: latestRemainingTime,
        reason: rejectReason,
        extra: {
          threshold: String(config?.secondInspect?.value ?? '')
        }
      }).catch(() => {})
      await this.releaseClaimedPoolTask(accountId, 'second_inspect_reject')
      this.markLotteryTemporarySkip(accountId, rejectedLottery, 90)
      this.removeLotteryFromPool(accountId, rejectedLottery)
      this.scheduleNextLotteryImmediately(accountId, rejectReason, { from: 'second-inspect-reject' })
      return
    }

    if (uiJoinResult?.code === 'ACCOUNT_STOPPED' || uiJoinResult?.code === 'BROWSER_NOT_FOUND') {
      await this.releaseClaimedPoolTask(accountId, uiJoinResult.code === 'BROWSER_NOT_FOUND' ? 'browser_not_found' : 'account_stopped')
      return
    }

    accountData.callbacks.onLog(`⚠️ UI参与失败，回退接口参与: ${uiJoinResult.error || '未知原因'}`)

    const finalAttendResult = await this.attendLotteryWithRetry(
      accountId,
      accountData,
      decoratedLottery,
      decoratedLottery?.lottery_id || ''
    )
    if (finalAttendResult?.success) {
      await this.onJoinSuccess(
        accountId,
        accountData,
        latestRemainingTime,
        config,
        finalAttendResult.message || '🎁 接口参与成功',
        buildHistoryLotteryInfo(finalAttendResult?.lotteryId || '')
      )
      return
    }

    const prev = this.attendFailureStreak.get(accountId) || 0
    const streak = prev + 1
    this.attendFailureStreak.set(accountId, streak)

    const status = finalAttendResult?.status
    const statusCode = finalAttendResult?.statusCode
    const errorText = finalAttendResult?.error || finalAttendResult?.extra?.error_msg || '未知错误'
    const toast = finalAttendResult?.data?.toast || finalAttendResult?.data?.prompt || ''
    const detail = [
      status !== undefined ? `status=${status}` : null,
      statusCode !== undefined ? `status_code=${statusCode}` : null,
      finalAttendResult?.code ? `code=${finalAttendResult.code}` : null,
      toast ? `toast=${toast}` : null
    ].filter(Boolean).join(', ')

    accountData.callbacks.onLog(
      `❌ 参与失败: ${errorText}${detail ? ` (${detail})` : ''}，连续失败${streak}次`,
      'error'
    )

    const failedHistoryLotteryInfo = buildHistoryLotteryInfo(finalAttendResult?.lotteryId || '')

    this.reportPoolTaskFeedback(accountId, 'join_failed', failedHistoryLotteryInfo, {
      joinMode: 'API',
      remainingSec: latestRemainingTime,
      reason: errorText || 'unknown',
      extra: {
        status: status !== undefined ? String(status) : '',
        statusCode: statusCode !== undefined ? String(statusCode) : '',
        code: String(finalAttendResult?.code || ''),
        toast: String(toast || '')
      }
    }).catch(() => {})
    await this.releaseClaimedPoolTask(accountId, `attend_failed:${errorText || 'unknown'}`)
    this.markLotteryTemporarySkip(accountId, failedHistoryLotteryInfo, 180)
    this.removeLotteryFromPool(accountId, failedHistoryLotteryInfo)
    this.scheduleNextLotteryImmediately(accountId, `参与失败(${errorText || '未知错误'})`, { from: 'attend-failed' })
  }

  /**
   * start 方法：启动账号单轮流程：拉池、选袋、参与与下一轮调度。
   */
  async start(accountId, options = {}) {
    const accountData = this.accounts.get(accountId)
    if (!accountData) return
    const config = accountData.config || {}
    const preferQuickScan = options?.preferQuickScan === true

    this.clearAccountTimer(accountId)
    try {
      if (!this.checkAccountRunGuards(accountId, accountData, config)) {
        return
      }

      let selectedOption = null
      let noTaskFromServer = false

      const claimRes = await this.claimTaskFromServer(accountId, config)
      if (claimRes?.claimed === true) {
        this.resetPoolNoTaskStreak(accountId)
        await this.refreshPoolFromServer(accountId)
        const claimedLottery = claimRes.task.lottery
        const now = Date.now() / 1000
        selectedOption = {
          key: this.getLotteryUniqueKey(claimedLottery),
          item: claimedLottery,
          remainingSec: Math.max(0, Number(claimedLottery.end_time || 0) - now),
          adjustedScore: Number(claimRes.task.serverScore || claimedLottery._serverScore || 0)
        }
      } else if (claimRes?.claimed === false) {
        this.bumpPoolNoTaskStreak(accountId)
        noTaskFromServer = true
        await this.refreshPoolFromServer(accountId)
      } else {
        await this.refreshPoolFromServer(accountId)
      }

      this.removeExpiredLotteries(accountId)
      this.calculatePredictedProbabilities(accountId)
      this.sortLotteriesByProbability(accountId)
      this.emitLotteryListUpdate(accountData)

      if (selectedOption?.item) {
        this.resetPoolNoTaskStreak(accountId)
      }

      if (!selectedOption?.item) {
        accountData.state = 'waiting'
        const retryPlan = noTaskFromServer
          ? this.getPoolNoTaskRetryPlan(accountId, preferQuickScan)
          : {
              retryDelay: preferQuickScan ? 1500 : 10000,
              forceScan: false,
              silent: false,
              message: `📋 当前没有可参与福袋，${Math.ceil((preferQuickScan ? 1500 : 10000) / 1000)}秒后继续请求共享池...`
            }
        const retryDelay = Number(retryPlan.retryDelay || (preferQuickScan ? 1500 : 10000))
        if (retryPlan.silent !== true) {
          accountData.callbacks.onLog(retryPlan.message)
        }
        accountData.callbacks.onStatusUpdate({ id: accountId, state: 'waiting' })
        this.emitLotteryListUpdate(accountData)
        this.scheduleSelectionOrScanRetry(accountId, retryDelay, {
          quickCycle: preferQuickScan,
          forceScan: retryPlan.forceScan === true,
          trigger: noTaskFromServer ? 'pool-no-task' : 'pool-empty'
        })
        return
      }

      this.markExecutionTurn(accountId)

      await this.executeLotteryParticipation(accountId, accountData, selectedOption.item, config, {
        reuseCurrentRoom: false,
        title: '🎯 选择目标福袋',
        modeText: '进入直播间等待福袋入口并立即参与',
        score: selectedOption.adjustedScore
      })
    } catch (error) {
      const latest = this.accounts.get(accountId)
      if (!latest || this.isPaused(accountId)) return
      latest.callbacks.onLog(`⚠️ 参与前流程异常: ${error?.message || '未知异常'}，3秒后重试...`, 'warning')
      this.logger.debug(`[${accountId}] start() 异常`, error)
      this.scheduleSelectionOrScanRetry(accountId, 3000, { quickCycle: true, trigger: 'start-exception' })
    }
  }

  /**
   * onJoinSuccess 方法：处理成功事件。
   */
  async onJoinSuccess(accountId, accountData, remainingTime, config, successMessage, lotteryInfo = null) {
    this.attendFailureStreak.set(accountId, 0)
    if (lotteryInfo) {
      this.reportPoolTaskFeedback(accountId, 'join_success', lotteryInfo, {
        joinMode: /UI/.test(successMessage) ? 'UI' : 'API',
        remainingSec: Number(remainingTime || 0),
        joinedAt: Date.now()
      }).catch(() => {})
    }
    await this.finishClaimedPoolTask(accountId, 'join_success', true)
    accountData.callbacks.onLog(successMessage)

    accountData.participationCount++
    this.lastJoinAtByAccount.set(accountId, Date.now())
    accountData.callbacks.onStatusUpdate({
      id: accountId,
      participationCount: accountData.participationCount
    })

    if (lotteryInfo && typeof accountData.callbacks.onHistoryRecord === 'function') {
      try {
        const historyStartTime = Number(lotteryInfo.start_time || 0)
        accountData.callbacks.onHistoryRecord({
          accountId,
          accountNickname: accountData.nickname || accountId,
          roomId: lotteryInfo.roomId || '',
          webRid: lotteryInfo.webRid || '',
          lotteryId: lotteryInfo.lottery_id || '',
          authorNickname: lotteryInfo.authorNickname || '',
          lotteryName: lotteryInfo.lotteryName || '',
          predictedProbability: Number(lotteryInfo.predictedProbability || 0),
          predictedJoinTotal: Number(lotteryInfo.predictedFinalPeople || lotteryInfo.predictedJoinTotal || 0),
          joinTotal: Number(lotteryInfo.joinTotal || 0),
          luckyCount: Number(lotteryInfo.winningTotal || lotteryInfo.luckyCount || 0),
          onlineTotal: Number(lotteryInfo.onlineTotal || 0),
          totalAmount: Number(lotteryInfo.total_amount || lotteryInfo.totalAmount || 0),
          prizeType: lotteryInfo.prizeType ?? null,
          prizeInfo: (lotteryInfo.prizeInfo && typeof lotteryInfo.prizeInfo === 'object') ? lotteryInfo.prizeInfo : {},
          conditions: Array.isArray(lotteryInfo.conditions) ? lotteryInfo.conditions : [],
          remainingSec: Number(remainingTime || 0),
          serverScore: Number(lotteryInfo._serverScore || 0),
          startTime: historyStartTime > 1e12 ? historyStartTime : historyStartTime * 1000,
          joinMode: /UI/.test(successMessage) ? 'UI' : 'API',
          joinStatus: 'success',
          resultStatus: 'pending',
          resultReason: '待开奖',
          joinedAt: Date.now(),
          endTime: Number(lotteryInfo.end_time || 0) * 1000
        })
      } catch (e) {
        this.logger.debug(`[${accountId}] onHistoryRecord 回调失败`, e)
      }
    }

    if (config.enableRedPacket) {
      accountData.callbacks.onLog('🧧 尝试自动抢红包...')
      this.autoJoinRedPacketLoop(accountId, accountData).catch(() => {})
    }

    const stayDuration = Number(config.stayDuration || 5)
    const safeRemaining = Math.max(0, Number(remainingTime || 0))
    const nowMs = Date.now()
    const drawWaitMs = Math.max(safeRemaining * 1000, 0)
    const stayWaitMs = Math.max(stayDuration * 1000, 0)
    const drawUntilMs = nowMs + drawWaitMs
    const waitUntilMs = nowMs + drawWaitMs + stayWaitMs
    const minPoolEndTime = Math.floor(waitUntilMs / 1000)
    this.setMinPoolEndTime(accountId, minPoolEndTime)
    accountData.callbacks.onLog(`⏱️ 等待福袋结束（剩余${safeRemaining.toFixed(0)}秒）...`)
    if (stayDuration > 0) {
      accountData.callbacks.onLog(`⏳ 福袋开奖后停留 ${stayDuration} 秒...`)
    }
    accountData.callbacks.onLog(`🔎 抢后停留期间优先扫描后续福袋（客户端任意时刻仅保留1个扫描账号）`)
    const waitRoomId = String(lotteryInfo?.roomId || '')
    if (config.randomInteraction?.enabled && waitRoomId) {
      this.resetWaitRandomChatState(accountId, waitRoomId)
      accountData.callbacks.onLog('🎲 等待开奖阶段已启用随机弹幕互动')
    } else {
      this.clearWaitRandomChatState(accountId)
    }
    this.scheduleScanDuringWait(accountId, drawUntilMs, {
      stayDurationSec: stayDuration,
      waitRoomId
    })
  }

  /**
   * waitForLiveRoomReady 方法：等待直播间页面就绪后再执行参与动作。
   */
  async waitForLiveRoomReady(accountId, timeoutMs = 10000) {
    return executeWaitForLiveRoomReady(this, accountId, timeoutMs)
  }

  /**
   * closeLiveStreamRendering 方法：关闭直播推流画面渲染状态。
   */
  async closeLiveStreamRendering(accountId) {
    return executeCloseLiveStreamRendering(this, accountId)
  }

  /**
   * openLiveStreamRendering 方法：恢复直播推流画面渲染状态。
   */
  async openLiveStreamRendering(accountId) {
    return executeOpenLiveStreamRendering(this, accountId)
  }

  /**
   * ensureCloseLiveStreamRendering 方法：确保直播推流画面渲染状态满足预期。
   */
  async ensureCloseLiveStreamRendering(accountId) {
    return executeEnsureCloseLiveStreamRendering(this, accountId)
  }

  /**
   * joinLotteryByUI 方法：执行参与福袋。
   */
  async joinLotteryByUI(accountId, remainingTime = 30, options = {}) {
    return executeJoinLotteryByUI(this, accountId, remainingTime, options)
  }

  /**
   * isAttendSuccessLike 方法：判断参与接口返回是否属于成功或可视作成功。
   */
  isAttendSuccessLike(result) {
    return detectAttendSuccessLike(result)
  }

  /**
   * attendLotteryWithRetry 方法：执行参与福袋重试。
   */
  async attendLotteryWithRetry(accountId, accountData, lotteryInfo, initialLotteryId) {
    return executeAttendWithRetry(this, accountId, accountData, lotteryInfo, initialLotteryId)
  }

  /**
   * autoJoinRedPacketLoop 方法：执行红包多轮检测与领取流程。
   */
  async autoJoinRedPacketLoop(accountId, accountData, rounds = 4) {
    return executeAutoJoinRedPacketLoop(this, accountId, accountData, rounds)
  }

  /**
   * joinRedPacketByUI 方法：通过页面元素执行红包领取操作。
   */
  async joinRedPacketByUI(accountId) {
    return executeJoinRedPacketByUI(this, accountId)
  }

  /**
   * pauseAccount 方法：暂停账号。
   */
  pauseAccount(accountId) {
    const accountData = this.accounts.get(accountId)
    if (accountData) {
      this.setPaused(accountId, true)
      this.clearAccountTimer(accountId)
      this.setTaskStage(accountId, '')
      this.releaseClaimedPoolTask(accountId, 'pause_account').catch(() => {})
      this.setMinPoolEndTime(accountId, 0)
      this.clearWaitRandomChatState(accountId)
      this.releaseScannerAccount(accountId)
      accountData.state = 'paused'
      accountData.callbacks.onStatusUpdate({ id: accountId, state: 'paused' })
      this.emitAccountDispatchUpdate(accountId)
    }
  }

  /**
   * resumeAccount 方法：恢复账号。
   */
  resumeAccount(accountId) {
    const accountData = this.accounts.get(accountId)
    if (accountData) {
      this.setPaused(accountId, false)
      this.setTaskStage(accountId, '')
      this.releaseClaimedPoolTask(accountId, 'resume_reset').catch(() => {})
      this.setMinPoolEndTime(accountId, 0)
      this.clearWaitRandomChatState(accountId)
      this.ensureScannerAccount(accountId)
      accountData.state = 'running'
      accountData.callbacks.onStatusUpdate({ id: accountId, state: 'running' })
      this.emitAccountDispatchUpdate(accountId)
      this.scheduleAccountTask(accountId, 200, () => this.searchLiveRoom(accountId))
    }
  }

  /**
   * sleep 方法：处理延时。
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

export default LotteryManager
