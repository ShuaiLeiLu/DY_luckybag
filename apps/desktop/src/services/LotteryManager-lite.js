import { classifyBackendFailure } from './backendErrors'
﻿import { calcAdaptiveScanProfile, createScanRiskState, updateScanRiskState } from './scanRiskPolicy'
import { getRedPacketAveragePerWinner as getLotteryAveragePerWinner } from '../utils/lotteryRules'
import { createLogger } from '../utils/logger'
import { createAccountRuntimeManager } from './accountRuntime'
import { searchLiveByAll as collectLiveByAll } from './scanCollector'
import { joinLotteryByProtocol } from './joinExecutor'
import {
  claimPoolAllScanCursor,
  claimPoolTask,
  fetchPoolLearningDebug,
  fetchPoolTaskDebug,
  finishPoolTask,
  persistPoolServerUrl,
  persistPoolServerToken,
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

const MIN_JOIN_WINDOW_SEC = 25
const MAX_JOIN_WINDOW_SEC = 420
const WAIT_SCAN_STAY_THRESHOLD_SEC = 0
const CLAIM_TARGET_MAX_SEC = 150
const POOL_TASK_LEASE_SEC = 35
const POOL_TASK_RENEW_SEC = 12
const POOL_UPSERT_TIMEOUT_MS = 12000
const POOL_UPSERT_CLAIM_TIMEOUT_MS = 15000
const POOL_UPSERT_BATCH_SIZE = 120
const POOL_CONDITION_MAX_COUNT = 8
const POOL_TEXT_MAX_LEN = 96
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
    this.lastScannerAccountId = '' // 最近一次承担扫描位的账号，用于随机轮换扫描账号
    this.scanPlanByAccount = new Map() // accountId -> 本地常规扫描分片计划
    this.accountRuntime = createAccountRuntimeManager()
    this.scanDispatchCursor = 0 // 多账号扫描轮转游标
    this.recoveryStates = Object.create(null)
    this.backendCooldownByAccount = new Map()
    this.participationBudgets = new Map()
    this.pendingDrawByAccount = new Map()
    this.waitScanDispatchLockUntil = 0 // 等待开奖扫描节流锁
    this.activeScanAccountId = '' // 当前客户端内唯一允许处于扫描态的账号
    this.clientFirstRoundScanDone = false // 首轮全站快速扫描是否已完成
    this.localScanRoomLeaseById = new Map() // `${accountId}:${roomId}` -> expireMs，账号级短期去重，避免账号间互相干扰
    this.allScanSeenRooms = new Map() // roomId -> expireMs，全站扫描跨轮次去重，减少重复拉详情
    this.skipLotteryUntilByAccount = new Map() // accountId -> Map(`${roomId}:${lotteryId}`, expireMs)
    this.waitRandomChatStateByAccount = new Map() // accountId -> { roomId, nextAt, lastContent, sentCount }
    this.claimRenewTimerByAccount = new Map() // accountId -> 租约续租 timer
    this.liveRoomRecoverAtByAccount = new Map() // accountId -> 最近一次直播页自动恢复时间(ms)
    
    // 默认启用全分类扫描，仍可通过 setCategoryList() 覆盖
    this.categoryList = [] // Native category endpoints are not yet verified.
    
    // 扫描配置（参考原项目）
    this.scanConfig = {
      countPerPage: 15,  // 每页15个（原项目默认值）
      pagesPerCategory: 5,  // 常规扫描每分类页数
      allCount: 24 // 全站接口每次拉取数量（深度扫描）
    }
  }

  async handleBackendFailure(accountId, result) {
    const account = this.accounts.get(accountId)
    if (!account) return
    const kind = classifyBackendFailure(result)
    if (kind === 'risk') {
      this.backendCooldownByAccount.set(accountId, Date.now() + 60000)
      account.callbacks.onLog('请求触发风险或频率限制，停止当前动作并冷却 60 秒', 'warning')
    } else if (kind === 'authentication' || kind === 'configuration') {
      this.pauseAccount(accountId)
      account.callbacks.onStatusUpdate({ id:accountId, state:'error', actionActive:false })
      account.callbacks.onLog(kind === 'authentication' ? '登录状态已失效，请重新导入安卓会话' : '协议尚未通过验证，请检查账号验证报告', 'error')
    }
  }

  persistRuntime(accountId, patch = {}) {
    const account = this.accounts.get(accountId)
    if (!account) return
    void this.ipc?.invoke('desktop:save-runtime', { accountId, intent: this.isPaused(accountId) ? 'paused' : 'running',
      pendingDraw: this.pendingDrawByAccount.get(accountId) || null, ...patch }).catch(() => {})
  }

  async reconcileDrawResult(accountId, pending, maxWaitMs = 90000) {
    const account = this.accounts.get(accountId)
    if (!account || !pending) return
    const lottery = pending.lottery
    let outcome = { resultStatus:'unknown', reason:'result_not_confirmed', rewardAmount:0 }
    const stopAt = Date.now() + maxWaitMs
    do {
      if (!this.accounts.has(accountId) || this.isPaused(accountId)) return
      const result = await this.ipc.invoke('get-lottery-result', { accountId, roomId:lottery.roomId, lotteryId:lottery.lottery_id, userId:account.userId }).catch(() => null)
      if (result?.success && ['won','lost'].includes(result.resultStatus) && String(result.lotteryId)===String(lottery.lottery_id)) { outcome=result; break }
      if (Date.now() >= stopAt) break
      await this.sleep(Math.min(3000, stopAt - Date.now()))
    } while (Date.now() <= stopAt)
    const status=outcome.resultStatus
    account.callbacks.onHistoryRecord?.({ ...pending.record, resultStatus:status, resultReason:outcome.reason, rewardAmount:Number(outcome.rewardAmount || 0), recordType:status==='won'?'win':'join' })
    if (status==='won') {
      account.todayLotteryWinCount = Number(account.todayLotteryWinCount || 0)+1
      account.todayEarnedDiamonds = Number(account.todayEarnedDiamonds || 0)+Number(outcome.rewardAmount || 0)
      account.callbacks.onStatusUpdate({ id:accountId, todayLotteryWinCount:account.todayLotteryWinCount, todayEarnedDiamonds:account.todayEarnedDiamonds })
    }
    if (status==='won'||status==='lost') await this.reportPoolTaskFeedback(accountId, status==='won'?'draw_won':'draw_lost',lottery,{rewardAmount:Number(outcome.rewardAmount || 0), joinedAt:pending.record.joinedAt}).catch(() => {})
    account.callbacks.onLog(status==='won'?'已确认中奖':status==='lost'?'已确认未中奖':'本轮开奖结果未能确认，已记录为未知',status==='won'?'success':'info')
    this.pendingDrawByAccount.delete(accountId)
    this.persistRuntime(accountId)
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
    if (config && Object.prototype.hasOwnProperty.call(config, 'token')) persistPoolServerToken(config.token || '')
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
        accountData.callbacks.onLog(`等待开奖随机弹幕: ${content}`)

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
   * getEligibleScannerAccounts 方法：获取可参与常规扫描的空闲账号列表。
   */
  getEligibleScannerAccounts() {
    return this.getActiveMonitorAccounts()
      .filter(acc => this.canRunAssignedScan(acc.id))
      .map(acc => acc.id)
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
    return this.accountRuntime.getExecutionTurns(accountId)
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
      lastJoinAt: this.accountRuntime.getLastJoinAt(accountId)
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
        maxPages: Number(assignment?.budget?.maxCategoryPages || this.scanConfig.pagesPerCategory || 5)
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
        maxPages: Math.max(1, Number(plan?.maxPages || assignment?.budget?.maxCategoryPages || this.scanConfig.pagesPerCategory || 5))
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
    if (desiredScannerCount === 1) {
      const currentScannerId = String(this.scannerAccountId || '').trim()
      if (currentScannerId && prioritized.includes(currentScannerId) && this.canRunAssignedScan(currentScannerId)) {
        return [currentScannerId]
      }
      const pool = prioritized.filter(id => id !== this.lastScannerAccountId)
      const source = pool.length > 0 ? pool : prioritized
      const picked = source[Math.floor(Math.random() * source.length)] || prioritized[0]
      this.lastScannerAccountId = String(picked || '')
      return picked ? [picked] : []
    }
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
    if (!this.accounts.has(accountId) || this.isPaused(accountId)) return false
    return this.scanPlanByAccount.has(String(accountId || '').trim())
  }

  /**
   * releaseScannerAccount 方法：释放账号相关的扫描角色缓存，并重新计算本地扫描计划。
   */
  releaseScannerAccount(accountId) {
    if (this.activeScanAccountId === String(accountId || '').trim()) {
      this.activeScanAccountId = ''
    }
    this.accountRuntime.setScanRole(accountId, '')
    this.syncLocalScanPlans()
  }

  /**
   * logScanRoleIfChanged 方法：记录扫描角色变化。
   */
  logScanRoleIfChanged(accountId, role, plan = null) {
    const normalizedRole = role === 'scanner' ? 'scanner' : 'worker'
    if (normalizedRole === 'scanner') {
      this.activeScanAccountId = String(accountId || '').trim()
    } else if (this.activeScanAccountId === String(accountId || '').trim()) {
      this.activeScanAccountId = ''
    }
    const prev = this.accountRuntime.getScanRole(accountId)
    if (prev === normalizedRole) return
    this.accountRuntime.setScanRole(accountId, normalizedRole)
    const label = normalizedRole === 'scanner' ? this.getScanPlanLabel(plan || this.scanPlanByAccount.get(accountId)) : '执行'
    this.logger.debug(`[${accountId}] scan role => ${normalizedRole} (${label})`)
    this.emitAccountDispatchUpdate(accountId)
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
   * dispatchBalancedWaitScan 方法：分发均衡策略等待阶段扫描。
   */
  async dispatchBalancedWaitScan(triggerAccountId, deadlineMs) {
    const now = Date.now()
    if (deadlineMs > 0 && now >= deadlineMs) return false
    const targetId = String(triggerAccountId || '').trim()
    if (!targetId || !this.accounts.has(targetId) || this.isPaused(targetId)) return false
    await this.searchLiveRoom(targetId, {
      scanOnly: true,
      deadlineMs,
      forceScanner: true,
      scanPlan: null,
      claimAfterScan: false,
      executeAfterScan: false,
      uploadAfterScan: false,
      collectWaitCandidates: true
    })
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

    const httpMatch = text.match(/^http_(\d{3})$/i)
    if (httpMatch) return `请求失败（HTTP ${httpMatch[1]}）`
    return text
  }

  /**
   * toPoolCandidate 方法：将输入转换为福袋池候选项。
   */
  sanitizePoolText(value, maxLen = POOL_TEXT_MAX_LEN) {
    const text = String(value || '').trim()
    if (!text) return ''
    return text.slice(0, Math.max(12, Number(maxLen) || POOL_TEXT_MAX_LEN))
  }

  normalizePoolConditions(conditions = []) {
    const source = Array.isArray(conditions) ? conditions : []
    const out = []
    for (const item of source) {
      if (!item || typeof item !== 'object') continue
      const type = Number(item.type || 0)
      const desc = this.sanitizePoolText(
        item.desc || item.description || item.title || item.text || item.name || item.content || '',
        POOL_TEXT_MAX_LEN
      )
      const content = this.sanitizePoolText(item.content || '', POOL_TEXT_MAX_LEN)
      const normalized = {}
      if (Number.isFinite(type) && type > 0) normalized.type = Math.floor(type)
      if (desc) normalized.desc = desc
      if (content && content !== desc) normalized.content = content
      if (Object.keys(normalized).length === 0) continue
      out.push(normalized)
      if (out.length >= POOL_CONDITION_MAX_COUNT) break
    }
    return out
  }

  pickPoolPrizeInfo(prizeInfo = {}) {
    if (!prizeInfo || typeof prizeInfo !== 'object' || Array.isArray(prizeInfo)) return {}
    const source = prizeInfo
    const out = {}
    const textKeys = ['name', 'type', 'prize_type']
    const numberKeys = [
      'total_amount',
      'totalAmount',
      'total_diamond_count',
      'total_coin_count',
      'diamond_count_total',
      'diamond_count',
      'coin_count',
      'amount',
      'value'
    ]
    textKeys.forEach((key) => {
      const text = this.sanitizePoolText(source[key], POOL_TEXT_MAX_LEN)
      if (text) out[key] = text
    })
    numberKeys.forEach((key) => {
      const n = Number(source[key])
      if (!Number.isFinite(n)) return
      if (n === 0) return
      out[key] = n
    })
    return out
  }

  splitPoolCandidates(candidates = [], batchSize = POOL_UPSERT_BATCH_SIZE) {
    const list = Array.isArray(candidates) ? candidates : []
    const safeBatch = Math.max(20, Math.min(300, Number(batchSize) || POOL_UPSERT_BATCH_SIZE))
    if (list.length <= safeBatch) return [list]
    const chunks = []
    for (let i = 0; i < list.length; i += safeBatch) {
      chunks.push(list.slice(i, i + safeBatch))
    }
    return chunks
  }

  toPoolCandidate(lottery, sourceId = '') {
    if (!lottery) return null
    const endTime = Number(lottery.end_time || 0)
    const lotteryId = String(lottery.lottery_id || lottery.lotteryId || '')
    const roomId = String(lottery.roomId || '')
    if (!roomId || !lotteryId || !endTime) return null
    const prizeInfo = this.pickPoolPrizeInfo(lottery.prizeInfo || lottery.prize_info || {})
    return {
      roomId,
      webRid: String(lottery.webRid || roomId),
      lotteryId,
      conditions: this.normalizePoolConditions(lottery.conditions),
      joinTotal: Number(lottery.joinTotal || 0),
      luckyCount: Number(lottery.winningTotal || 0),
      lotteryTotal: Number(lottery.lotteryTotal || 0),
      onlineTotal: Number(lottery.onlineTotal || 0),
      lotteryName: this.sanitizePoolText(lottery.lotteryName || lottery.prize_name || prizeInfo?.name || '', 80),
      prizeInfo,
      prizeType: lottery.prizeType,
      total_amount: Number(lottery.total_amount || lottery.totalAmount || 0),
      endTime,
      startTime: Number(lottery.start_time || 0),
      fetchedAt: Number(lottery.fetchedAt || Date.now()),
      sourceId: sourceId || '',
      authorNickname: this.sanitizePoolText(lottery.authorNickname || '', 48),
      roomTitle: this.sanitizePoolText(lottery.roomTitle || '', 120)
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
  async syncServerPoolCandidates(accountId, lotteryList, options = {}) {
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

    const accountData = this.accounts.get(accountId)
    const filters = this.buildServerTopFilters(accountData?.config || {}, {
      maxRemainingSec: CLAIM_TARGET_MAX_SEC
    })
    const owner = this.getTaskOwner(accountId)
    const claimTaskRequested = options?.claimTask === true
    const topLimit = Math.max(1, Math.min(20, Number(options?.topLimit || 5)))
    const preferKeys = Array.isArray(options?.preferKeys) ? options.preferKeys : []
    const excludeKeys = Array.isArray(options?.excludeKeys) ? options.excludeKeys : []
    const chunks = this.splitPoolCandidates(candidates, options?.batchSize)

    let totalAccepted = 0
    let totalReceived = 0
    let totalInserted = 0
    let totalUpdated = 0
    let totalInvalid = 0
    let statusCode = 200
    let summaryAt = Date.now()
    let activeCandidates = 0
    let validCandidates = 0
    let availableCandidates = 0
    let claim = null
    let eligibleLotteries = []
    let claimedTask = null

    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i]
      const isClaimBatch = claimTaskRequested && i === 0
      const res = await upsertPoolCandidates(this.poolServerUrl, accountId, chunk, {
        timeoutMs: isClaimBatch ? POOL_UPSERT_CLAIM_TIMEOUT_MS : POOL_UPSERT_TIMEOUT_MS,
        filters,
        claimTask: isClaimBatch,
        clientId: owner.clientId,
        accountId: owner.accountId,
        leaseSec: POOL_TASK_LEASE_SEC,
        topLimit,
        preferKeys: isClaimBatch ? preferKeys : [],
        excludeKeys: isClaimBatch ? excludeKeys : []
      })
      if (!res.ok) {
        if (this.shouldLogPoolWarn(accountId, 'upsert')) {
          const statusSuffix = res?.status ? `（HTTP ${res.status}）` : ''
          accountData?.callbacks?.onLog?.(`服务端候选上报失败${statusSuffix}: ${this.formatPoolErrorMessage(res.error, '上报失败')}`, 'warning')
        }
        this.logger.warn(
          `[${accountId}] pool upsert failed batch=${i + 1}/${chunks.length} status=${res?.status || 0} error=${res?.error || 'unknown'} candidates=${chunk.length}`
        )
        return {
          ok: false,
          accepted: Math.max(0, totalAccepted),
          total: candidates.length,
          status: Number(res?.status || 0),
          error: String(res?.error || 'upsert_failed')
        }
      }

      const payload = (res?.data && typeof res.data === 'object') ? res.data : {}
      statusCode = Number(res?.status || statusCode || 200)
      const acceptedValue = Number(payload?.accepted)
      const receivedValue = Number(payload?.received)
      totalAccepted += Math.max(0, Number.isFinite(acceptedValue) ? acceptedValue : chunk.length)
      totalReceived += Math.max(0, Number.isFinite(receivedValue) ? receivedValue : chunk.length)
      totalInserted += Math.max(0, Number(payload?.inserted || 0))
      totalUpdated += Math.max(0, Number(payload?.updated || 0))
      totalInvalid += Math.max(0, Number(payload?.invalid || 0))
      summaryAt = Math.max(summaryAt, Number(payload?.generatedAt || Date.now()))
      activeCandidates = Math.max(activeCandidates, Number(payload?.activeCandidates || 0))
      validCandidates = Math.max(validCandidates, Number(payload?.validCandidates || 0))
      availableCandidates = Math.max(availableCandidates, Number(payload?.availableCandidates || 0))

      const claimPayload = (payload?.claim && typeof payload.claim === 'object') ? payload.claim : null
      if (!claim && claimPayload) {
        claim = claimPayload
      }

      if (claimPayload?.claimed === true && claimPayload?.item && claimPayload?.lease && !claimedTask) {
        const claimedLottery = this.fromPoolTopItem(claimPayload.item, 1)
        if (claimedLottery) {
          claimedTask = {
            lottery: claimedLottery,
            lease: claimPayload.lease,
            claimedAt: Number(claimPayload?.lease?.claimedAt || Date.now()),
            serverScore: Number(claimPayload?.item?.score || claimPayload?.item?.evScore || 0)
          }
        }
      }

      const eligibleItems = Array.isArray(payload?.eligibleItems) ? payload.eligibleItems : []
      if (eligibleItems.length > 0) {
        eligibleLotteries = eligibleItems
          .map((item, idx) => this.fromPoolTopItem(item, idx + 1))
          .filter(Boolean)
      }
    }

    return {
      ok: true,
      accepted: Math.max(0, totalAccepted),
      total: candidates.length,
      status: Math.max(200, Number(statusCode || 200)),
      received: Math.max(0, totalReceived),
      inserted: Math.max(0, totalInserted),
      updated: Math.max(0, totalUpdated),
      invalid: Math.max(0, totalInvalid),
      activeCandidates: Math.max(0, Number(activeCandidates || 0)),
      validCandidates: Math.max(0, Number(validCandidates || 0)),
      availableCandidates: Math.max(0, Number(availableCandidates || 0)),
      summaryAt: Math.max(0, Number(summaryAt || Date.now())),
      eligibleCount: eligibleLotteries.length,
      eligibleLotteries,
      claimClaimed: claim?.claimed === true,
      claimReason: String(claim?.reason || ''),
      claimedTask
    }
  }

  /**
   * enqueuePoolCandidatesUpload 方法：将候选上报任务按账号串行入队，保证“每页立即上传”且不阻塞扫描主流程。
   */
  enqueuePoolCandidatesUpload(accountId, lotteryList, options = {}) {
    const list = Array.isArray(lotteryList) ? lotteryList : []
    if (list.length === 0) {
      return Promise.resolve({ ok: true, accepted: 0, total: 0, skipped: 'empty_candidates' })
    }

    const prev = this.accountRuntime.getPoolUploadQueue(accountId) || Promise.resolve()
    let wrapped = null
    const task = prev
      .catch(() => null)
      .then(() => this.syncServerPoolCandidates(accountId, list, options))
    wrapped = task.finally(() => {
      this.accountRuntime.clearPoolUploadQueue(accountId, wrapped)
    })
    this.accountRuntime.setPoolUploadQueue(accountId, wrapped)
    return wrapped
  }

  /**
   * waitPoolUploadIdle 方法：等待当前账号的页级上传队列完成，用于首轮收尾确认。
   */
  async waitPoolUploadIdle(accountId, timeoutMs = 4000) {
    const pending = this.accountRuntime.getPoolUploadQueue(accountId)
    if (!pending) return true
    const safeTimeout = Math.max(300, Number(timeoutMs) || 4000)
    await Promise.race([
      pending.catch(() => null),
      this.sleep(safeTimeout)
    ])
    return !this.accountRuntime.getPoolUploadQueue(accountId)
  }

  /**
   * mergeDeferredWaitUpload 方法：将等待阶段扫描到的福袋暂存，阶段结束后统一上传服务端。
   */
  mergeDeferredWaitUpload(accountId, lotteryList = []) {
    if (!accountId) return 0
    const source = Array.isArray(lotteryList) ? lotteryList : []
    if (source.length === 0) return 0
    const bucket = this.accountRuntime.getDeferredWaitUploadBucket(accountId)
    if (!bucket) return 0
    let added = 0
    source.forEach((item) => {
      const roomId = String(item?.roomId || '').trim()
      const lotteryId = String(item?.lottery_id || item?.lotteryId || '').trim()
      const fallback = `${String(item?.webRid || '').trim()}:${String(item?.end_time || 0)}`
      const key = roomId && lotteryId ? `${roomId}:${lotteryId}` : fallback
      if (!key || bucket.has(key)) return
      bucket.set(key, item)
      added += 1
    })
    return added
  }

  /**
   * flushDeferredWaitUpload 方法：将等待阶段缓存福袋统一上传服务端（仅补池，不领取任务）。
   */
  async flushDeferredWaitUpload(accountId) {
    if (!accountId) return { uploaded: 0, accepted: 0, skipped: 'empty' }
    const bucket = this.accountRuntime.getDeferredWaitUpload(accountId)
    if (!bucket || bucket.size === 0) {
      return { uploaded: 0, accepted: 0, skipped: 'empty' }
    }
    const accountData = this.accounts.get(accountId)
    const list = Array.from(bucket.values())
    this.accountRuntime.clearDeferredWaitUpload(accountId)
    const res = await this.enqueuePoolCandidatesUpload(accountId, list, {
      claimTask: false,
      topLimit: 5
    }).catch((error) => ({ ok: false, accepted: 0, error: error?.message || String(error || 'unknown') }))
    const accepted = Math.max(0, Number(res?.accepted || 0))
    if (res?.ok) {
      accountData?.callbacks?.onLog?.(`等待阶段补扫结果已上传：提交${list.length}，服务端接收${accepted}`)
    } else {
      accountData?.callbacks?.onLog?.(`等待阶段补扫上传失败：${res?.error || 'unknown'}`, 'warning')
    }
    return {
      uploaded: list.length,
      accepted,
      ok: res?.ok === true,
      error: String(res?.error || '')
    }
  }

  /**
   * selectLocalFallbackCandidate 方法：服务端暂无任务时，从本地候选池挑选一个可直接执行的福袋兜底。
   */
  getClientOccupiedRoomKeys(excludeAccountId = '') {
    const occupied = new Set()
    const excluded = String(excludeAccountId || '').trim()
    for (const [accountId] of this.accountRuntime.entries()) {
      if (String(accountId || '').trim() === excluded) continue
      if (!this.accounts.has(accountId) || this.isPaused(accountId)) continue
      const stage = this.getTaskStage(accountId)
      if (!['claimed', 'joining', 'waiting_draw', 'post_draw_stay'].includes(stage)) continue
      const roomKey = this.accountRuntime.getExecutionRoomId(accountId)
      if (roomKey) occupied.add(roomKey)
    }
    for (const [accountId] of this.accountRuntime.entries()) {
      if (String(accountId || '').trim() === excluded) continue
      if (!this.accounts.has(accountId) || this.isPaused(accountId)) continue
      const stage = this.getTaskStage(accountId)
      if (!['claimed', 'joining', 'waiting_draw', 'post_draw_stay'].includes(stage)) continue
      const task = this.accountRuntime.getClaimedTask(accountId)
      if (!task) continue
      const taskRoomKey = String(
        this.accountRuntime.getExecutionRoomId(accountId)
        || task?.lottery?.webRid
        || task?.lottery?.roomId
        || ''
      ).trim()
      if (taskRoomKey) occupied.add(taskRoomKey)
    }
    return occupied
  }

  isRoomOccupiedByOtherAccount(lotteryInfo, excludeAccountId = '') {
    if (!lotteryInfo) return false
    const occupied = this.getClientOccupiedRoomKeys(excludeAccountId)
    if (occupied.size === 0) return false
    const roomKeys = this.normalizeExpectedRoomIds([lotteryInfo?.webRid, lotteryInfo?.roomId])
    return roomKeys.some(roomKey => occupied.has(roomKey))
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
          this.accounts.get(accountId)?.callbacks?.onLog?.(`服务端任务领取失败: ${this.formatPoolErrorMessage(res.error, '领取失败')}`, 'warning')
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
      if (this.isRoomOccupiedByOtherAccount(lottery, accountId)) {
        await this.releaseSpecificPoolTaskLease(accountId, res.data?.lease?.leaseId, 'claim_room_occupied_by_local_client')
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
    if (this.ipc?.invoke) {
      const queued = await this.ipc.invoke('desktop:enqueue-feedback', payload)
      return queued?.success === true
    }
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
      requireType3And6: false,
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
    return this.accountRuntime.getClaimedTask(accountId)
  }

  /**
   * getPoolNoTaskStreak 方法：读取账号连续“服务端无任务”次数。
   */
  getPoolNoTaskStreak(accountId) {
    return this.accountRuntime.getPoolNoTaskStreak(accountId)
  }

  /**
   * resetPoolNoTaskStreak 方法：清空账号连续无任务计数。
   */
  resetPoolNoTaskStreak(accountId) {
    this.accountRuntime.resetPoolNoTaskStreak(accountId)
  }

  /**
   * bumpPoolNoTaskStreak 方法：累加账号连续无任务计数。
   */
  bumpPoolNoTaskStreak(accountId) {
    return this.accountRuntime.bumpPoolNoTaskStreak(accountId)
  }

  /**
   * getTaskStage 方法：获取账号当前共享任务所处阶段。
   */
  getTaskStage(accountId) {
    return this.accountRuntime.getTaskStage(accountId)
  }

  /**
   * setTaskStage 方法：更新账号当前共享任务阶段并同步到前端。
   */
  setTaskStage(accountId, stage = '') {
    if (!accountId) return
    this.accountRuntime.setTaskStage(accountId, stage)
    if (this.isBusyForNormalScan(accountId)) {
      this.clearScanCycleTimer(accountId)
    }
    if (this.scannerAccountId === accountId && this.isBusyForNormalScan(accountId)) {
      this.scannerAccountId = null
    }
    this.ensureScannerAccount('')
    if (!this.isBusyForNormalScan(accountId) && this.getNormalScanPlan(accountId) && !this.isPaused(accountId)) {
      this.scheduleAssignedScanCycle(accountId, 900)
    }
    this.emitAccountDispatchUpdate(accountId)
  }

  /**
   * getAccountScanRole 方法：返回账号当前在界面层展示的扫描角色。
   */
  getAccountScanRole(accountId) {
    const override = this.accountRuntime.getScanRole(accountId)
    if (override === 'scanner' || override === 'worker') {
      return override
    }
    return this.isScannerAccount(accountId) ? 'scanner' : 'worker'
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
    for (const [leaseKey, expireAt] of this.localScanRoomLeaseById.entries()) {
      if (!leaseKey || Number(expireAt || 0) <= nowMs) {
        this.localScanRoomLeaseById.delete(leaseKey)
      }
    }
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
    const nextTask = this.accountRuntime.setClaimedTask(accountId, task)
    if (nextTask) {
      this.resetPoolNoTaskStreak(accountId)
      this.scheduleClaimRenew(accountId)
    } else {
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
        this.accounts.get(accountId)?.callbacks?.onLog?.('服务端任务续租失败，当前福袋可能会被其他客户端接管', 'warning')
      }
      if ((res.status === 0 || res.status >= 500) && Number(task.lease.expiresAt || 0) > Date.now()) return false
      this.setPaused(accountId, true)
      this.clearAccountTimer(accountId)
      this.clearScanCycleTimer(accountId)
      this.participationBudgets.delete(accountId)
      this.setClaimedTask(accountId,null)
      this.accounts.get(accountId)?.callbacks?.onStatusUpdate?.({id:accountId,state:'paused',actionActive:false})
      this.persistRuntime(accountId)
      return false
    }
    const nextTask = {
      ...task,
      lease: res.data?.lease || task.lease
    }
    this.accountRuntime.setClaimedTask(accountId, nextTask)
    this.emitAccountDispatchUpdate(accountId)
    return true
  }

  /**
   * releaseClaimedPoolTask 方法：释放当前服务端任务租约，使候选重新回池。
   */
  async releaseClaimedPoolTask(accountId, reason = '') {
    const task = this.getClaimedTask(accountId)
    this.participationBudgets.delete(accountId)
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
  async finishClaimedPoolTask(accountId, result = 'done', removeCandidate = true, options = {}) {
    const task = this.getClaimedTask(accountId)
    const clearStage = options?.clearStage !== false
    if (clearStage) {
      this.setTaskStage(accountId, '')
    }
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
          deepScan: false,
          managedByCycle: true
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
   * scheduleSelectionOrScanRetry 方法：统一调度后续重试，避免主流程和后台扫描循环同时重复驱动同一账号。
   */
  scheduleSelectionOrScanRetry(accountId, delayMs, options = {}) {

    const quickCycle = options?.quickCycle === true || options?.preferQuickScan === true
    const forceScan = options?.forceScan === true
    this.scheduleAccountTask(accountId, delayMs, () => this.searchLiveRoom(accountId, {
      scanOnly: true,
      deepScan: false,
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
      onLog(`风控压力下降，扫描降速等级恢复到${result.state.level}`, 'success')
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

  async startAccount(account, config, callbacks) {
    ipcRenderer = getIpcRenderer()
    this.ipc = ipcRenderer
    if (!this.ipc || this.startingAccounts.has(account.id)) return
    this.startingAccounts.add(account.id)
    try {
      const status = await this.ipc.invoke('protocol:session-status', { accountId: account.id })
      if (!status?.ready) {
        callbacks.onStatusUpdate({ id: account.id, state: 'login_required', actionActive: false })
        callbacks.onLog('请先导入安卓会话并完成登录态、签名和真实福袋详情验证', 'warning')
        return
      }
      const existing = this.accounts.get(account.id)
      if (existing && !this.isPaused(account.id)) return
      this.accounts.set(account.id, { ...account, config, callbacks, participationCount: Number(existing?.participationCount || account.participationCount || 0), startedAt: Date.now(), monitoringStarted: false })
      this.participationBudgets.delete(account.id)
      this.setAccountLotteryList(account.id, [])
      this.setCollectLoading(account.id, false)
      this.setPaused(account.id, false)
      callbacks.onStatusUpdate({ id: account.id, state: 'running', actionActive: true, requestBackend: 'android' })
      await this.startMonitoring(account.id)
    } catch {
      callbacks.onStatusUpdate({ id: account.id, state: 'error', actionActive: false })
      callbacks.onLog('安卓协议账号启动失败，请重新验证会话', 'error')
    } finally { this.startingAccounts.delete(account.id) }
  }

  /**
   * startMonitoring 方法：启动监控。
   */
  async startMonitoring(accountId) {
    const accountData = this.accounts.get(accountId)
    if (!accountData) return
    if (accountData.monitoringStarted) return
    accountData.monitoringStarted = true
    const recovery = this.recoveryStates?.[accountId]
    if (recovery) delete this.recoveryStates[accountId]
    if (recovery?.pendingDraw) {
      this.pendingDrawByAccount.set(accountId,recovery.pendingDraw)
      this.persistRuntime(accountId)
      const lottery = recovery.pendingDraw.lottery
      const until = Number(lottery.end_time || 0)*1000
      if (until > Date.now()) this.scheduleScanDuringWait(accountId,until,{stayDurationSec:accountData.config.stayDuration,waitRoomId:lottery.roomId})
      else { await this.reconcileDrawResult(accountId,recovery.pendingDraw,15000); this.finishSingleRoundAndRestart(accountId,{directStart:true}) }
      return
    }
    this.persistRuntime(accountId)

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

    this.emitAccountDispatchUpdate(accountId)
    
    // 启动后固定进入扫描循环，不再触发参与链路。
    this.scheduleAssignedScanCycle(accountId, 120)
  }

  /**
   * stopAccount 方法：停止账号。
   */
  async stopAccount(accountId) {
    this.persistRuntime(accountId,{intent:'paused'})
    this.participationBudgets.delete(accountId)
    this.setPaused(accountId, true)
    this.clearAccountTimer(accountId)
    this.clearScanCycleTimer(accountId)
    await this.releaseClaimedPoolTask(accountId, 'stop_account')
    this.setAccountLotteryList(accountId, [])
    this.setCollectLoading(accountId, false)
    this.attendFailureStreak.delete(accountId)
    this.cycleTimerByAccount.delete(accountId)
    this.minPoolEndTimeByAccount.delete(accountId)
    this.releaseScannerAccount(accountId)
    this.scanRiskByAccount.delete(accountId)
    this.liveRoomRecoverAtByAccount.delete(accountId)
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
      this.accountRuntime.clear()
    }
    this.accountRuntime.reset(accountId)
    this.accountRuntime.delete(accountId)
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
      this.accountRuntime.reset(accountId)
      this.scanRiskByAccount.delete(accountId)
      this.liveRoomRecoverAtByAccount.delete(accountId)
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
    this.scanAssignmentCache = null
    this.scanPlanByAccount.clear()
    this.localScanRoomLeaseById.clear()
    this.allScanSeenRooms.clear()
    this.liveRoomRecoverAtByAccount.clear()
    this.accountRuntime.clear()
    this.clientFirstRoundScanDone = false
  }

  async isSessionReady(accountId) {
    const result = await this.ipc.invoke('protocol:session-status', { accountId }).catch(() => null)
    if (!result?.ready) {
      this.pauseAccount(accountId)
      this.accounts.get(accountId)?.callbacks?.onStatusUpdate({ id: accountId, state: 'login_required', actionActive: false })
      return false
    }
    return true
  }

  /**
   * 统一搜索直播间（参考原项目）
   */
  async searchLiveRoom(accountId, options = {}) {
    const scanOnly = options?.scanOnly === true
    const deepScan = scanOnly ? options?.deepScan !== false : false
    const deadlineMs = Number(options?.deadlineMs || 0)
    const cooldown = Number(this.backendCooldownByAccount.get(accountId) || 0) - Date.now()
    if (cooldown > 0) { this.scheduleAccountTask(accountId, cooldown, () => this.searchLiveRoom(accountId, options)); return }
    const quickCycle = options?.quickCycle === true
    const forceScanner = options?.forceScanner === true
    const managedByCycle = options?.managedByCycle === true
    const forcedScanPlan = options?.scanPlan || null
    const claimAfterScan = options?.claimAfterScan !== false
    const executeAfterScan = options?.executeAfterScan !== false
    const uploadAfterScan = options?.uploadAfterScan !== false
    const collectWaitCandidates = options?.collectWaitCandidates === true
    if (this.isCollectLoading(accountId)) {
      return
    }
    
    if (!this.accounts.has(accountId)) return

    try {
      this.setCollectLoading(accountId, true)
      const accountData = this.accounts.get(accountId)
      if (!accountData) return
      const onlyRedPacketMode = this.isRedPacketOnlyModeEnabled(accountData.config || {})
      const scanAssignment = this.scanAssignmentCache
      const scanPlan = forcedScanPlan || this.getNormalScanPlan(accountId, scanAssignment)
      if (!scanPlan && scanOnly) {
        this.logScanRoleIfChanged(accountId, 'worker')
        return
      }
      this.logScanRoleIfChanged(accountId, scanPlan ? 'scanner' : 'worker', scanPlan || forcedScanPlan)

      const baseScanProfile = this.getAdaptiveScanProfile(accountId)
      const fallbackCategories = this.resolveAssignedCategoryList(scanAssignment)
      const forcedCategories = this.resolveAssignedCategoryList(scanAssignment)
      const forcedCategoryPlans = this.resolveAssignedCategoryPlans(scanAssignment)
      const forcedHasCategories = (Array.isArray(forcedCategories) && forcedCategories.length > 0) ||
        (Array.isArray(forcedCategoryPlans) && forcedCategoryPlans.length > 0)
      const forcedAllScanEnabled = scanPlan ? (scanPlan.allScanEnabled !== false) : true
      const activeScanPlan = scanPlan || forcedScanPlan || {
        kind: forcedAllScanEnabled ? 'all' : 'category',
        mode: forceScanner ? 'forced' : 'local-single-scanner',
        allScanEnabled: forcedAllScanEnabled || !forcedHasCategories,
        assignedCategories: forcedHasCategories ? forcedCategories : fallbackCategories,
        assignedCategoryPlans: forcedCategoryPlans.length > 0
          ? forcedCategoryPlans
          : (forcedHasCategories ? forcedCategories : fallbackCategories),
        budget: null,
        shardKey: `${forceScanner ? 'forced' : 'local'}:${accountId}`,
        workerIndex: 0,
        workerCount: 1
      }
      const assignedCategoryList = Array.isArray(activeScanPlan?.assignedCategories) ? activeScanPlan.assignedCategories : []
      const allScanEnabled = activeScanPlan ? (activeScanPlan.allScanEnabled !== false) : true
      let scanProfile = scanOnly && deepScan
        ? this.getDeepScanProfile(baseScanProfile, { deadlineMs })
        : { ...baseScanProfile }
      const useFirstRoundProfile = !scanOnly && quickCycle && accountData.firstRoundScanDone !== true
      if (useFirstRoundProfile) {
        const FIRST_ROUND_BUDGET_MS = 30000
        const firstRoundDeadlineMs = deadlineMs > 0
          ? Math.min(deadlineMs, Date.now() + FIRST_ROUND_BUDGET_MS)
          : (Date.now() + FIRST_ROUND_BUDGET_MS)
        scanProfile = {
          ...scanProfile,
          forceLotteryHintOnly: true,
          firstRoundUseCursorPaging: false,
          allTimes: 10,
          maxAllRounds: 10,
          noGrowthBreakRounds: 10,
          allCount: 8,
          pagesPerCategory: 5,
          maxCategoryPages: 5,
          categoryNoGrowthBreakPages: 5,
          detailConcurrency: 1,
          itemGapMs: Math.max(600, Number(scanProfile.itemGapMs || 0)),
          detailRoomCap: 15,
          cycleDelayMinMs: 500,
          cycleDelayMaxMs: 1500,
          deadlineMs: firstRoundDeadlineMs
        }
        accountData.callbacks.onLog('🔧 首轮扫描使用模式')
      } else if (!scanOnly && quickCycle) {
        scanProfile = {
          ...scanProfile,
          forceLotteryHintOnly: true,
          firstRoundUseCursorPaging: false,
          allTimes: Math.max(2, Math.min(3, Number(scanProfile.allTimes || 3))),
          maxAllRounds: Math.max(2, Math.min(3, Number(scanProfile.maxAllRounds || 3))),
          noGrowthBreakRounds: Math.max(2, Math.min(3, Number(scanProfile.noGrowthBreakRounds || 3))),
          allCount: 8,
          pagesPerCategory: Math.max(3, Math.min(5, Number(scanProfile.pagesPerCategory || 5))),
          maxCategoryPages: Math.max(5, Math.min(10, Number(scanProfile.maxCategoryPages || 10))),
          categoryNoGrowthBreakPages: Math.max(5, Math.min(10, Number(scanProfile.categoryNoGrowthBreakPages || 10))),
          detailConcurrency: 1,
          detailRoomCap: 15,
          itemGapMs: Math.max(500, Number(scanProfile.itemGapMs || 0)),
          cycleDelayMinMs: Math.max(500, Math.min(900, Number(scanProfile.cycleDelayMinMs || 700))),
          cycleDelayMaxMs: Math.max(1200, Math.min(1800, Math.max(Number(scanProfile.cycleDelayMaxMs || 1300), 1200)))
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
      
      // 检查协议会话是否仍可用
      if (!(await this.isSessionReady(accountId))) {
        accountData.callbacks.onLog('协议会话未就绪，停止扫描任务')
        return
      }

      this.setPaused(accountId, false)

      if (deadlineMs > 0 && Date.now() >= deadlineMs) {
        return
      }

      if (!useFirstRoundProfile && scanProfile.cooldownRemainMs > 0) {
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

      // 2. 仅执行全站扫描链路（对齐超人全站模式）
      const runAllScanThisRound = allScanEnabled || useFirstRoundProfile
      let allScanResult = null
      if (runAllScanThisRound) {
        allScanResult = await this.searchLiveByAll(accountId, scanProfile.allTimes, scanProfile, {
          claimAfterScan: onlyRedPacketMode ? false : claimAfterScan,
          uploadAfterScan: onlyRedPacketMode ? false : uploadAfterScan,
          deadlineMs
        })
      }
      if (this.isPaused(accountId) || !(await this.isSessionReady(accountId))) return
      const afterAllProfile = this.getAdaptiveScanProfile(accountId)
      if (runAllScanThisRound && !useFirstRoundProfile && afterAllProfile.level >= 2 && afterAllProfile.cooldownRemainMs > 0) {
        const waitMs = Math.min(afterAllProfile.cooldownRemainMs + 800, 60000)
        if (!scanOnly) {
          accountData.callbacks.onLog(`🛡️ 全站扫描后命中风控冷却，${Math.ceil(waitMs / 1000)}秒后继续`, 'warning')
          this.scheduleSelectionOrScanRetry(accountId, waitMs, { quickCycle, trigger: 'all-scan-cooldown' })
        }
        return
      }

      // 当前客户端默认只保留一个扫描位，分类分片仅在服务端明确分配时生效。
      if (!useFirstRoundProfile && !scanOnly) {
        accountData.callbacks.onLog('当前客户端仅使用单扫描位执行全站扫描')
      }

      // 3. 清理 + 概率 + 排序
      this.removeExpiredLotteries(accountId)
      this.calculatePredictedProbabilities(accountId)
      this.sortLotteriesByProbability(accountId)
      this.emitLotteryListUpdate(accountData)

      if (useFirstRoundProfile && accountData.firstRoundScanDone !== true) {
        const queueDrained = await this.waitPoolUploadIdle(accountId, 4200)
        if (queueDrained) {
          accountData.callbacks.onLog('首轮扫描结果已同步到共享池')
        }
        accountData.firstRoundScanDone = true
        if (this.clientFirstRoundScanDone !== true) {
          this.clientFirstRoundScanDone = true
        }
        accountData.callbacks.onLog('首轮全量扫描完成，已切换常规调度')
      }

      if (scanOnly) {
        if (onlyRedPacketMode) {
          const redPacketCandidate = this.selectLocalRedPacketCandidate(accountId, accountData.config || {})
          if (redPacketCandidate?.item && this.accounts.has(accountId) && !this.isPaused(accountId)) {
            await this.executeRedPacketOnlyParticipation(accountId, accountData, redPacketCandidate.item, accountData.config || {}, {
              title: '红包模式目标',
              modeText: '进入直播间后只执行红包领取'
            })
            return
          }
          accountData.callbacks.onLog('本轮未发现可抢红包直播间，继续下一轮扫描')
          if (!managedByCycle) {
            this.scheduleSelectionOrScanRetry(accountId, quickCycle ? 900 : 1800, {
              quickCycle: true,
              trigger: 'no-redpacket-target'
            })
          }
          return
        }

        if (collectWaitCandidates) {
          const deferred = Array.isArray(allScanResult?.deferredUploadCandidates) ? allScanResult.deferredUploadCandidates : []
          const merged = this.mergeDeferredWaitUpload(accountId, deferred)
          if (merged > 0) {
            accountData.callbacks.onLog(`等待阶段补扫缓存 +${merged}（待阶段结束后统一上传）`)
          }
        }
        const currentStage = this.getTaskStage(accountId)
        const waitingStage = currentStage === 'waiting_draw' || currentStage === 'post_draw_stay'
        let claimedTask = allScanResult?.claimedTask || null
        const fallbackServerLottery = null // Execution always requires an owned task lease.
        const canExecuteAfterScan = executeAfterScan && !waitingStage
        if (!claimedTask?.lottery && !fallbackServerLottery && canExecuteAfterScan && this.accounts.has(accountId) && !this.isPaused(accountId)) {
          const claimRes = await this.claimTaskFromServer(accountId, accountData.config || {}, {
            maxRemainingSec: CLAIM_TARGET_MAX_SEC
          }).catch(() => null)
          if (claimRes?.claimed && claimRes?.task?.lottery) {
            claimedTask = claimRes.task
            accountData.callbacks.onLog('扫描上报后已领取到目标，准备进入直播间')
          }
        }
        if ((claimedTask?.lottery || fallbackServerLottery) && canExecuteAfterScan && this.accounts.has(accountId) && !this.isPaused(accountId)) {
          if (claimedTask?.lottery) {
            this.setClaimedTask(accountId, claimedTask)
            this.setTaskStage(accountId, 'claimed')
          } else {
            this.setTaskStage(accountId, 'joining')
          }
          const targetLottery = claimedTask?.lottery || fallbackServerLottery
          accountData.callbacks.onLog(`服务端已筛选到可参与福袋，准备进入直播间 ${targetLottery?.webRid || targetLottery?.roomId || ''}`)
          await this.executeLotteryParticipation(accountId, accountData, targetLottery, accountData.config || {}, {
            title: '服务端已筛选目标',
            modeText: '按服务端返回直播间ID直连进房并参与'
          })
          return
        }
        if (waitingStage && (claimedTask?.lottery || fallbackServerLottery)) {
          accountData.callbacks.onLog('当前仍在等待/停留阶段：本轮仅扫描不上车，结束后再领取下一轮目标')
        }

        const noClaimedTarget = !claimedTask?.lottery && !fallbackServerLottery
        if (canExecuteAfterScan && noClaimedTarget) {
          accountData.callbacks.onLog('本轮未领取到可参与目标，继续下一轮扫描')
          if (!managedByCycle) {
            this.scheduleSelectionOrScanRetry(accountId, quickCycle ? 1200 : 2200, {
              quickCycle: true,
              trigger: 'no-target-continue'
            })
          }
          return
        }


        return
      }

      await this.waitPoolUploadIdle(accountId, quickCycle ? 2500 : 4000)
      const startDelay = quickCycle ? 400 : 800
      this.scheduleAccountTask(accountId, startDelay, () => this.searchLiveRoom(accountId, {
        scanOnly: true,
        deepScan: false,
        quickCycle,
        forceScanner: false
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
   * 搜索直播间-【全部】（参考原项目）
   */
  async searchLiveByAll(accountId, times = 10, scanProfile = null, runtimeOptions = {}) {
    return collectLiveByAll(this, accountId, times, scanProfile, runtimeOptions)
  }

  isRedPacketOnlyModeEnabled(config = {}) {
    return config?.onlyRedPacketMode?.enabled === true
  }

  isRedPacketCandidate(lotteryInfo, config = {}) {
    if (!lotteryInfo) return false
    const threshold = Number(config?.preferBigRedPacket?.threshold || 40)
    const redInfo = getLotteryAveragePerWinner(lotteryInfo, threshold)
    return redInfo?.isRedPacket === true || lotteryInfo?.hasRoomRedPacketHint === true
  }

  selectLocalRedPacketCandidate(accountId, config = {}) {
    const list = this.getAccountLotteryList(accountId)
    if (!Array.isArray(list) || list.length === 0) return null
    const nowSec = Date.now() / 1000
    const threshold = Number(config?.preferBigRedPacket?.threshold || 40)
    let fallbackCandidate = null

    for (const item of list) {
      if (!item || this.shouldSkipLottery(accountId, item)) continue
      if (this.isRoomOccupiedByOtherAccount(item, accountId)) continue
      const remainingSec = Math.max(0, Number(item.end_time || 0) - nowSec)
      if (remainingSec <= 8) continue
      const redInfo = getLotteryAveragePerWinner(item, threshold)
      const isRedPacketCandidate = redInfo?.isRedPacket === true || item?.hasRoomRedPacketHint === true
      if (!isRedPacketCandidate) continue
      const candidate = {
        key: this.getLotteryUniqueKey(item),
        item,
        remainingSec,
        adjustedScore: Number(item._serverScore || 0),
        isBig: redInfo?.isBig === true
      }
      if (candidate.isBig) return candidate
      if (!fallbackCandidate) fallbackCandidate = candidate
    }

    return fallbackCandidate
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
   * getWaitScanDelayMs 方法：获取等待阶段扫描延迟。
   */
  getWaitScanDelayMs(remainingMs) {
    if (remainingMs > 60000) return 9000
    if (remainingMs > 25000) return 7000
    return 3500
  }

  /**
   * normalizeExpectedRoomIds 方法：规范化预期直播间标识，兼容 roomId / webRid 双标识。
   */
  normalizeExpectedRoomIds(input) {
    const source = Array.isArray(input) ? input : [input]
    return Array.from(new Set(
      source
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    ))
  }

  async ensureProtocolSessionReady(accountId) { return this.isSessionReady(accountId) }

  /**
   * finishSingleRoundAndRestart 方法：结束当前轮次并触发下一轮扫描/参与流程。
   */
  finishSingleRoundAndRestart(accountId, options = {}) {
    const directStart = options?.directStart === true
    const accountData = this.accounts.get(accountId)
    if (!accountData || this.isPaused(accountId)) return

    // 停留阶段结束时优先终止遗留扫描循环，避免抢占下一轮“领取目标->切房参与”流程
    this.clearScanCycleTimer(accountId)
    this.clearWaitRandomChatState(accountId)
    this.setMinPoolEndTime(accountId, 0)
    this.setTaskStage(accountId, '')
    this.clearScanCycleTimer(accountId)
    accountData.callbacks.onLog('单轮结束，开始下一轮正常扫描...')
    this.removeExpiredLotteries(accountId)
    this.calculatePredictedProbabilities(accountId)
    this.sortLotteriesByProbability(accountId)
    this.emitLotteryListUpdate(accountData)

    const scheduleNextTarget = (delayMs = 260) => {
      this.scheduleAccountTask(accountId, delayMs, async () => {
        const latest = this.accounts.get(accountId)
        if (!latest || this.isPaused(accountId)) return

        await this.flushDeferredWaitUpload(accountId).catch(() => {})

        const claimRes = await this.claimTaskFromServer(accountId, latest.config || {}, {
          maxRemainingSec: CLAIM_TARGET_MAX_SEC
        }).catch(() => null)
        if (claimRes?.claimed && claimRes?.task?.lottery) {
          latest.callbacks.onLog('停留结束，已领取下一轮目标，准备进入直播间')
          await this.executeLotteryParticipation(accountId, latest, claimRes.task.lottery, latest.config || {}, {
            title: '停留结束后下一轮目标',
            modeText: '优先直连服务端分配目标并参与'
          })
          return
        }

        latest.callbacks.onLog('停留结束暂未领取到目标，回退到扫描模式')
        await this.searchLiveRoom(accountId, {
          scanOnly: true,
          deepScan: false,
          quickCycle: true,
          forceScanner: true
        })
      })
    }

    if (directStart) {
      accountData.callbacks.onLog('停留结束，继续执行扫描模式...')
      scheduleNextTarget(180)
      return
    }

    scheduleNextTarget(300)
  }

  /**
   * schedulePostDrawStay 方法：调度后置开奖停留阶段。
   */
  schedulePostDrawStay(accountId, stayDurationSec = 0, expectedRoomIds = []) {
    const safeStaySec = Math.max(0, Number(stayDurationSec || 0))
    const enableScanDuringStay = safeStaySec > WAIT_SCAN_STAY_THRESHOLD_SEC
    const stayUntilMs = Date.now() + Math.max(0, safeStaySec * 1000)
    const normalizedExpected = this.normalizeExpectedRoomIds(expectedRoomIds)
    this.setTaskStage(accountId, safeStaySec > 0 ? 'post_draw_stay' : '')

    /**
     * runTick 方法：执行一次定时轮询，并按剩余时间决定下一步调度。
     */
    const runTick = async () => {
      const accountData = this.accounts.get(accountId)
      if (!accountData || this.isPaused(accountId)) return

      await this.ensureProtocolSessionReady(accountId, normalizedExpected, { stageLabel: '开奖后停留阶段' })
      if (!this.accounts.has(accountId) || this.isPaused(accountId)) return

      const remainMs = stayUntilMs - Date.now()
      if (remainMs <= 0) {
        this.finishSingleRoundAndRestart(accountId, { directStart: !enableScanDuringStay })
        return
      }

      await this.dispatchBalancedWaitScan(accountId, stayUntilMs - 1200)
      if (!this.accounts.has(accountId) || this.isPaused(accountId)) return
      const remainAfterScanMs = stayUntilMs - Date.now()
      if (remainAfterScanMs <= 0) {
        this.finishSingleRoundAndRestart(accountId, { directStart: !enableScanDuringStay })
        return
      }
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
    const waitRoomIds = this.normalizeExpectedRoomIds(options?.waitRoomIds || [waitRoomId])
    this.setTaskStage(accountId, 'waiting_draw')
    /**
     * runTick 方法：执行一次定时轮询，并按剩余时间决定下一步调度。
     */
    const runTick = async () => {
      const accountData = this.accounts.get(accountId)
      if (!accountData || this.isPaused(accountId)) return

      await this.ensureProtocolSessionReady(accountId, waitRoomIds, { stageLabel: '开奖等待阶段' })
      if (!this.accounts.has(accountId) || this.isPaused(accountId)) return

      const remainMs = drawUntilMs - Date.now()
      if (remainMs <= 0) {
        this.clearWaitRandomChatState(accountId)
        accountData.callbacks.onLog('已到开奖时间，开始核验结果')
        await this.reconcileDrawResult(accountId,this.pendingDrawByAccount.get(accountId))
        if (!this.accounts.has(accountId) || this.isPaused(accountId)) return
        await this.flushDeferredWaitUpload(accountId)
        this.schedulePostDrawStay(accountId, stayDurationSec, waitRoomIds)
        return
      }

      await this.maybeSendRandomWaitChat(accountId, waitRoomId, accountData, drawUntilMs)
      if (!this.accounts.has(accountId) || this.isPaused(accountId)) return
      await this.dispatchBalancedWaitScan(accountId, drawUntilMs - 1200)
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
  updateAccountCurrentRoom(accountId, accountData, lotteryInfo, state = 'running', options = {}) {
    if (!accountData || !lotteryInfo) return
    const actualRoomKey = String(options?.actualRoomKey || '').trim()
    const displayRoomKey = actualRoomKey || String(lotteryInfo.webRid || lotteryInfo.roomId || '').trim()
    if (displayRoomKey) {
      this.accountRuntime.setExecutionRoomId(accountId, displayRoomKey)
    }
    accountData.currentRoom = `${lotteryInfo.authorNickname || '未知主播'}(${displayRoomKey})`
    accountData.state = state
    accountData.callbacks.onStatusUpdate({
      id: accountId,
      state,
      currentRoom: accountData.currentRoom
    })
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

  async executeLotteryParticipation(accountId, accountData, lotteryInfo, config = {}) {
    if (!accountData || !lotteryInfo || !this.checkAccountRunGuards(accountId, accountData, config)) return
    const task = this.getClaimedTask(accountId)
    if (!task?.lease?.leaseId || Number(task.lease.expiresAt || 0) <= Date.now()) {
      accountData.callbacks.onLog('任务租约不可用，停止参与', 'warning')
      return
    }
    this.participationBudgets.delete(accountId)
    this.setTaskStage(accountId, 'joining')
    this.handoverScannerForExecution(accountId, 'protocol-join')
    const remaining = Number(lotteryInfo.end_time || 0) - Date.now()/1000
    let result
    try {
      result = await joinLotteryByProtocol(this, accountId, { lotteryInfo, accountData, config })
    } catch {
      result = { success: false, code: 'PROTOCOL_EXECUTION_FAILED', error: '协议参与未完成' }
    } finally {
      this.participationBudgets.delete(accountId)
    }
    if (result.success) {
      this.updateAccountCurrentRoom(accountId, accountData, lotteryInfo, 'running')
      await this.onJoinSuccess(accountId, accountData, remaining, config, '福袋协议参与已确认', lotteryInfo)
      return
    }
    accountData.callbacks.onLog(result.error || '协议参与失败', 'warning')
    await this.reportPoolTaskFeedback(accountId, 'join_failed', lotteryInfo, { joinMode: 'API', remainingSec: remaining, reason: result.code || 'unknown' }).catch(() => {})
    await this.releaseClaimedPoolTask(accountId, result.code || 'protocol_join_failed')
    this.markLotteryTemporarySkip(accountId, lotteryInfo, 90)
    this.removeLotteryFromPool(accountId, lotteryInfo)
    if (!this.isPaused(accountId)) this.scheduleSelectionOrScanRetry(accountId, 3000, { quickCycle: true, trigger: 'protocol-join-failed' })
  }

  async executeRedPacketOnlyParticipation(accountId, accountData, lotteryInfo) {
    accountData.callbacks.onLog('红包领取协议尚未验收，跳过目标', 'warning')
    await this.releaseClaimedPoolTask(accountId, 'REDPACKET_PROTOCOL_UNVERIFIED')
    this.removeLotteryFromPool(accountId, lotteryInfo)
    this.scheduleSelectionOrScanRetry(accountId, 3000, { quickCycle: true })
  }

  /**
   * start 方法：兼容旧入口，固定为“仅扫描模式”。
   */
  async start(accountId, options = {}) {
    const accountData = this.accounts.get(accountId)
    if (!accountData || this.isPaused(accountId)) return
    const quickCycle = options?.preferQuickScan === true || options?.quickCycle === true

    this.clearAccountTimer(accountId)
    try {
      await this.searchLiveRoom(accountId, {
        scanOnly: true,
        deepScan: false,
        quickCycle,
        forceScanner: options?.forceScan === true
      })
    } catch (error) {
      const latest = this.accounts.get(accountId)
      if (!latest || this.isPaused(accountId)) return
      latest.callbacks.onLog(`扫描流程异常: ${error?.message || '未知异常'}`, 'warning')
      this.logger.debug(`[${accountId}] start(scan-only) 异常`, error)
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
    await this.finishClaimedPoolTask(accountId, 'join_success', true, { clearStage: false })
    accountData.callbacks.onLog(successMessage)
    this.participationBudgets.delete(accountId)

    accountData.participationCount++
    this.accountRuntime.setLastJoinAt(accountId, Date.now())
    accountData.callbacks.onStatusUpdate({
      id: accountId,
      participationCount: accountData.participationCount
    })

    if (lotteryInfo && typeof accountData.callbacks.onHistoryRecord === 'function') {
      try {
        const historyStartTime = Number(lotteryInfo.start_time || 0)
        const record = {
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
        }
        this.pendingDrawByAccount.set(accountId,{lottery:lotteryInfo,record})
        this.persistRuntime(accountId)
        accountData.callbacks.onHistoryRecord(record)
      } catch (e) {
        this.logger.debug(`[${accountId}] onHistoryRecord 回调失败`, e)
      }
    }



    const stayDuration = Number(config.stayDuration || 5)
    const safeRemaining = Math.max(0, Number(lotteryInfo?.end_time || 0) - Date.now()/1000)
    const nowMs = Date.now()
    const drawWaitMs = Math.max(safeRemaining * 1000, 0)
    const stayWaitMs = Math.max(stayDuration * 1000, 0)
    const drawUntilMs = nowMs + drawWaitMs
    const waitUntilMs = nowMs + drawWaitMs + stayWaitMs
    const minPoolEndTime = Math.floor(waitUntilMs / 1000)
    this.setMinPoolEndTime(accountId, minPoolEndTime)
    accountData.callbacks.onLog(`等待福袋结束（剩余${safeRemaining.toFixed(0)}秒）...`)
    if (stayDuration > 0) {
      accountData.callbacks.onLog(`福袋开奖后停留 ${stayDuration} 秒...`)
    }
    accountData.callbacks.onLog(`抢后停留期间优先扫描后续福袋（客户端任意时刻仅保留1个扫描账号）`)
    const waitRoomId = String(lotteryInfo?.roomId || '')
    const waitRoomIds = this.normalizeExpectedRoomIds([
      lotteryInfo?.webRid,
      lotteryInfo?.roomId
    ])
    if (config.randomInteraction?.enabled && waitRoomId) {
      this.resetWaitRandomChatState(accountId, waitRoomId)
      accountData.callbacks.onLog('等待开奖阶段已启用随机弹幕互动')
    } else {
      this.clearWaitRandomChatState(accountId)
    }
    this.scheduleScanDuringWait(accountId, drawUntilMs, {
      stayDurationSec: stayDuration,
      waitRoomId,
      waitRoomIds
    })
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
    this.accountRuntime.clear()
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
