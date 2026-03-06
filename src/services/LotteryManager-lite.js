import { calcAdaptiveScanProfile, createScanRiskState, updateScanRiskState } from './scanRiskPolicy'
import {
  getRedPacketAveragePerWinner,
  hasRestrictedJoinRequirement,
  isPhysicalPrizeLottery,
  isSupermanJoinableLottery,
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
  waitForLiveRoomReady as executeWaitForLiveRoomReady,
  warmupLotteryEntry as executeWarmupLotteryEntry
} from './joinExecutor'
import {
  fetchPoolTop,
  normalizePoolServerUrl,
  persistPoolServerUrl,
  resolvePoolServerUrl,
  upsertPoolCandidates
} from './poolClient'

// 使用 require 导入 electron (在 Electron 渲染进程中)
let ipcRenderer
if (typeof window !== 'undefined' && window.electronAPI) {
  try {
    ipcRenderer = window.electronAPI
  } catch (e) {
    const fallbackLogger = createLogger('lottery-manager')
    fallbackLogger.warn('无法加载 electron ipcRenderer:', e)
  }
}

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
const managerLogger = createLogger('lottery-manager')

class LotteryManager {
  constructor() {
    this.logger = managerLogger
    this.accounts = new Map()
    this.ipc = ipcRenderer
    this.lotteryPoolByAccount = new Map() // accountId -> 福袋列表
    this.collectLoadingByAccount = new Map() // accountId -> 是否正在收集
    this.pauseCollectByAccount = new Map() // accountId -> 是否暂停收集
    this.attendFailureStreak = new Map() // accountId -> consecutive failure count
    this.cycleTimerByAccount = new Map() // accountId -> timer id
    this.minPoolEndTimeByAccount = new Map() // accountId -> 扫描入池最小开奖时间(秒)
    this.scanRiskByAccount = new Map() // accountId -> 风控降速状态
    this.startingAccounts = new Set() // 正在启动中的账号，避免重复启动
    this.blockList = new Set() // 屏蔽的直播间列表 (roomId)
    this.poolServerUrl = resolvePoolServerUrl()
    this.poolServerEnabled = true
    this.poolTopLimit = 2500
    this.lastPoolWarnAt = new Map() // `${accountId}:${type}` -> timestamp(ms)
    this.scannerAccountId = null // 本客户端唯一扫描账号
    this.scanRoleByAccount = new Map() // accountId -> scanner|worker
    
    // 默认启用全分类扫描，仍可通过 setCategoryList() 覆盖
    this.categoryList = [...DEFAULT_CATEGORIES]
    
    // 扫描配置（参考原项目）
    this.scanConfig = {
      countPerPage: 15,  // 每页15个（原项目默认值）
      pagesPerCategory: 12,  // 常规扫描每分类页数（等待期可切深扫自动翻页）
      allCount: 24 // 全站接口每次拉取数量（深度扫描）
    }
  }

  isPoolServerEnabled() {
    return this.poolServerEnabled === true && Boolean(this.poolServerUrl)
  }

  getPoolServerConfig() {
    return {
      enabled: this.poolServerEnabled === true,
      url: this.poolServerUrl || ''
    }
  }

  setPoolServerConfig(config = {}, options = {}) {
    const silent = options?.silent === true
    if (config && Object.prototype.hasOwnProperty.call(config, 'enabled')) {
      this.poolServerEnabled = config.enabled !== false
    }
    if (config && Object.prototype.hasOwnProperty.call(config, 'url')) {
      const normalized = normalizePoolServerUrl(config.url)
      this.poolServerUrl = normalized
      persistPoolServerUrl(normalized)
    }
    if (!silent) {
      this.logger.info(`服务端筛选池配置已更新: enabled=${this.poolServerEnabled}, url=${this.poolServerUrl || '(empty)'}`)
    }
    return this.getPoolServerConfig()
  }

  getEligibleScannerAccounts() {
    return Array.from(this.accounts.values())
      .filter(acc => acc?.id && acc.monitoringStarted && !this.isPaused(acc.id))
      .map(acc => acc.id)
  }

  ensureScannerAccount(preferredId = '') {
    const candidates = this.getEligibleScannerAccounts()
    if (candidates.length === 0) {
      this.scannerAccountId = null
      return null
    }
    if (this.scannerAccountId && candidates.includes(this.scannerAccountId)) {
      return this.scannerAccountId
    }
    if (preferredId && candidates.includes(preferredId)) {
      this.scannerAccountId = preferredId
      return this.scannerAccountId
    }
    this.scannerAccountId = candidates[0]
    return this.scannerAccountId
  }

  isScannerAccount(accountId) {
    const scannerId = this.ensureScannerAccount(accountId)
    return scannerId === accountId
  }

  releaseScannerAccount(accountId) {
    if (this.scannerAccountId !== accountId) return
    this.scannerAccountId = null
    this.ensureScannerAccount('')
  }

  logScanRoleIfChanged(accountId, role) {
    const prev = this.scanRoleByAccount.get(accountId)
    if (prev === role) return
    this.scanRoleByAccount.set(accountId, role)
    const scannerId = this.ensureScannerAccount('')
    this.logger.info(`[${accountId}] scan role => ${role} (scanner=${scannerId || 'none'})`)
  }

  shouldLogPoolWarn(accountId, type, cooldownMs = 15000) {
    const key = `${accountId}:${type}`
    const now = Date.now()
    const prev = Number(this.lastPoolWarnAt.get(key) || 0)
    if (now - prev < cooldownMs) return false
    this.lastPoolWarnAt.set(key, now)
    return true
  }

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
      predictedProbability: simpleProb,
      simpleProbability: simpleProb,
      _serverRank: Number.isFinite(Number(rank)) ? Number(rank) : null
    }
  }

  async syncServerPoolCandidates(accountId, lotteryList) {
    if (!this.isPoolServerEnabled()) return
    if (!Array.isArray(lotteryList) || lotteryList.length === 0) return

    const candidates = lotteryList
      .map(item => this.toPoolCandidate(item, accountId))
      .filter(Boolean)
    if (candidates.length === 0) return

    const res = await upsertPoolCandidates(this.poolServerUrl, accountId, candidates)
    if (!res.ok && this.shouldLogPoolWarn(accountId, 'upsert')) {
      const accountData = this.accounts.get(accountId)
      accountData?.callbacks?.onLog?.(`⚠️ 服务端候选上报失败: ${res.error}`, 'warning')
    }
  }

  async refreshPoolFromServer(accountId) {
    if (!this.isPoolServerEnabled()) return false
    const res = await fetchPoolTop(this.poolServerUrl, this.poolTopLimit)
    if (!res.ok) {
      if (this.shouldLogPoolWarn(accountId, 'top')) {
        const accountData = this.accounts.get(accountId)
        accountData?.callbacks?.onLog?.(`⚠️ 服务端拉取最优福袋失败: ${res.error}`, 'warning')
      }
      return false
    }
    const items = Array.isArray(res.data?.items) ? res.data.items : []
    const list = items.map((item, idx) => this.fromPoolTopItem(item, idx + 1)).filter(Boolean)
    if (list.length === 0) return false
    this.setAccountLotteryList(accountId, list)
    this.printServerPoolSnapshot(accountId, list, res.data)
    return true
  }

  printServerPoolSnapshot(accountId, list, payload = {}) {
    const active = Number(payload?.activeCandidates || 0)
    const valid = Number(payload?.validCandidates || list.length || 0)

    this.logger.debug(`[${accountId}] pool snapshot valid=${valid}, active=${active}, fetched=${list.length}`)
    list.forEach((item, index) => {
      const prob = Number(item.simpleProbability || 0) * 100
      const nowSec = Math.floor(Date.now() / 1000)
      const remain = Math.max(0, Number(item.end_time || 0) - nowSec)
      const join = Number(item.joinTotal || 0)
      const lucky = Number(item.winningTotal || 0)
      const rank = Number(item._serverRank || index + 1)
      this.logger.debug(
        `[${accountId}] pool #${rank}: ${item.authorNickname || '未知主播'} | ${item.lotteryName || item.prize_name || '未知福袋'} | p=${prob.toFixed(2)}% | remain=${remain}s | ${lucky}/${join}`
      )
    })
  }

  getAccountLotteryList(accountId) {
    if (!accountId) return []
    return this.lotteryPoolByAccount.get(accountId) || []
  }

  setAccountLotteryList(accountId, list) {
    if (!accountId) return
    this.lotteryPoolByAccount.set(accountId, Array.isArray(list) ? list : [])
  }

  isCollectLoading(accountId) {
    return this.collectLoadingByAccount.get(accountId) === true
  }

  setCollectLoading(accountId, loading) {
    this.collectLoadingByAccount.set(accountId, loading === true)
  }

  isPaused(accountId) {
    return this.pauseCollectByAccount.get(accountId) === true
  }

  setPaused(accountId, paused) {
    this.pauseCollectByAccount.set(accountId, paused === true)
  }

  clearAccountTimer(accountId) {
    const timer = this.cycleTimerByAccount.get(accountId)
    if (timer) {
      clearTimeout(timer)
      this.cycleTimerByAccount.delete(accountId)
    }
  }

  getMinPoolEndTime(accountId) {
    return Number(this.minPoolEndTimeByAccount.get(accountId) || 0)
  }

  setMinPoolEndTime(accountId, endTimeSec) {
    const t = Number(endTimeSec || 0)
    if (t > 0) {
      this.minPoolEndTimeByAccount.set(accountId, t)
    } else {
      this.minPoolEndTimeByAccount.delete(accountId)
    }
  }

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

  getScanRiskState(accountId) {
    if (!this.scanRiskByAccount.has(accountId)) {
      this.scanRiskByAccount.set(accountId, createScanRiskState())
    }
    return this.scanRiskByAccount.get(accountId)
  }

  getAdaptiveScanProfile(accountId) {
    return calcAdaptiveScanProfile(this.getScanRiskState(accountId), this.scanConfig)
  }

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
      const accountData = {
        ...account,
        config,
        callbacks,
        tokenInfo: null,
        participationCount: 0,
        startedAt: Date.now(),
        monitoringStarted: false
      }
      
      this.accounts.set(account.id, accountData)
      this.setAccountLotteryList(account.id, [])
      this.setCollectLoading(account.id, false)
      this.setPaused(account.id, false)
      
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
      
      accountData.state = 'opened'
      
      // 尝试加载本地Token
      const tokenResult = await ipcRenderer.invoke('load-token', account.id)
      
      if (tokenResult.success && tokenResult.tokenInfo) {
        callbacks.onLog(`发现本地Token，尝试自动登录...`)
        
        // 设置cookies
        const setCookieResult = await ipcRenderer.invoke('set-cookies', {
          accountId: account.id,
          tokenInfo: tokenResult.tokenInfo
        })
        
        if (setCookieResult.success) {
          accountData.tokenInfo = tokenResult.tokenInfo
          callbacks.onLog(`✅ Token已加载，自动登录成功`)
          callbacks.onStatusUpdate({ 
            id: account.id, 
            state: 'running',
            token: tokenResult.tokenInfo.sessionid || tokenResult.tokenInfo.sessionid_ss
          })
          
          // 导航到抖音
          await ipcRenderer.invoke('navigate-to', {
            accountId: account.id,
            url: 'https://www.douyin.com'
          })
          
          // 直接开始监控
          setTimeout(() => {
            this.startMonitoring(account.id)
          }, 2000)
          return
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

  async startMonitoring(accountId) {
    const accountData = this.accounts.get(accountId)
    if (!accountData) return
    if (accountData.monitoringStarted) return
    accountData.monitoringStarted = true

    const staggerMs = this.getStartupStaggerMs(accountId)
    if (staggerMs > 0) {
      this.logger.debug(`[${accountId}] 启动错峰: ${Math.ceil(staggerMs / 1000)}s`)
      await this.sleep(staggerMs)
      if (!this.accounts.has(accountId) || this.isPaused(accountId)) return
    }

    this.ensureScannerAccount(accountId)
    
    // 开始收集福袋
    this.searchLiveRoom(accountId)
  }

  async stopAccount(accountId) {
    this.setPaused(accountId, true)
    this.clearAccountTimer(accountId)
    await ipcRenderer.invoke('close-browser', accountId)
    this.setAccountLotteryList(accountId, [])
    this.setCollectLoading(accountId, false)
    this.attendFailureStreak.delete(accountId)
    this.cycleTimerByAccount.delete(accountId)
    this.minPoolEndTimeByAccount.delete(accountId)
    this.scanRoleByAccount.delete(accountId)
    this.releaseScannerAccount(accountId)
    this.scanRiskByAccount.delete(accountId)
    this.accounts.delete(accountId)
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
    const deadlineMs = Number(options?.deadlineMs || 0)
    if (this.isCollectLoading(accountId)) {
      return
    }
    
    if (!this.accounts.has(accountId)) return

    try {
      this.setCollectLoading(accountId, true)
      const accountData = this.accounts.get(accountId)
      if (!accountData) return
      const scannerId = this.ensureScannerAccount(accountId)
      const isScanner = scannerId === accountId
      this.logScanRoleIfChanged(accountId, isScanner ? 'scanner' : 'worker')

      if (!isScanner) {
        if (scanOnly) {
          return
        }
        if (this.isPoolServerEnabled()) {
          await this.refreshPoolFromServer(accountId)
        }
        this.removeExpiredLotteries(accountId)
        this.calculatePredictedProbabilities(accountId)
        this.sortLotteriesByProbability(accountId)
        this.emitLotteryListUpdate(accountData)

        if (this.getAccountLotteryList(accountId).length > 0) {
          this.scheduleAccountTask(accountId, 1200, () => this.start(accountId))
        } else {
          this.scheduleAccountTask(accountId, 6000, () => this.searchLiveRoom(accountId))
        }
        return
      }

      const baseScanProfile = this.getAdaptiveScanProfile(accountId)
      const scanProfile = scanOnly
        ? this.getDeepScanProfile(baseScanProfile, { deadlineMs })
        : baseScanProfile
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

      if (scanProfile.cooldownRemainMs > 0) {
        const waitMs = Math.min(scanProfile.cooldownRemainMs + 600, 60000)
        if (!scanOnly) {
          accountData.callbacks.onLog(`🛡️ 风控冷却中，${Math.ceil(waitMs / 1000)}秒后继续扫描...`, 'warning')
          this.scheduleAccountTask(accountId, waitMs, () => this.searchLiveRoom(accountId))
        }
        return
      }

      // 1) 先清理过期项，保留仍可用池子（参考超人：不每轮清空）
      this.removeExpiredLotteries(accountId)
      this.calculatePredictedProbabilities(accountId)
      this.sortLotteriesByProbability(accountId)
      this.emitLotteryListUpdate(accountData)

      // 2. 按超人逻辑：先全站，再按分类采集补充池子
      await this.searchLiveByAll(accountId, scanProfile.allTimes, scanProfile)
      if (this.isPaused(accountId) || !(await this.isBrowserAlive(accountId))) return
      const afterAllProfile = this.getAdaptiveScanProfile(accountId)
      if (afterAllProfile.level >= 2 && afterAllProfile.cooldownRemainMs > 0) {
        const waitMs = Math.min(afterAllProfile.cooldownRemainMs + 800, 60000)
        if (!scanOnly) {
          accountData.callbacks.onLog(`🛡️ 全站扫描后命中风控冷却，${Math.ceil(waitMs / 1000)}秒后继续`, 'warning')
          this.scheduleAccountTask(accountId, waitMs, () => this.searchLiveRoom(accountId))
        }
        return
      }

      // 分类扫描补充池子
      if (Array.isArray(this.categoryList) && this.categoryList.length > 0) {
        await this.startCollectLive(accountId, scanProfile)
      }
      if (this.isPaused(accountId) || !(await this.isBrowserAlive(accountId))) return
      const afterCategoryProfile = this.getAdaptiveScanProfile(accountId)
      if (afterCategoryProfile.level >= 2 && afterCategoryProfile.cooldownRemainMs > 0) {
        const waitMs = Math.min(afterCategoryProfile.cooldownRemainMs + 800, 60000)
        if (!scanOnly) {
          accountData.callbacks.onLog(`🛡️ 分类扫描后命中风控冷却，${Math.ceil(waitMs / 1000)}秒后继续`, 'warning')
          this.scheduleAccountTask(accountId, waitMs, () => this.searchLiveRoom(accountId))
        }
        return
      }

      // 3. 清理 + 概率 + 排序
      this.removeExpiredLotteries(accountId)
      this.calculatePredictedProbabilities(accountId)
      this.sortLotteriesByProbability(accountId)
      this.emitLotteryListUpdate(accountData)

      if (scanOnly) {
        return
      }

      if (this.getAccountLotteryList(accountId).length > 0) {
        this.scheduleAccountTask(accountId, 1000, () => this.start(accountId))
      } else {
        accountData.callbacks.onLog('⚠️ 没有符合条件的福袋，10秒后重新扫描...')
        if (!this.isPaused(accountId)) {
          this.scheduleAccountTask(accountId, 10000, () => this.searchLiveRoom(accountId))
        }
      }
      
    } catch (error) {
      const accountData = this.accounts.get(accountId)
      if (accountData) {
        if (!scanOnly) {
          accountData.callbacks.onLog(`搜索失败: ${error.message}，10秒后重试...`, 'error')
          if (!this.isPaused(accountId)) {
            this.scheduleAccountTask(accountId, 10000, () => this.searchLiveRoom(accountId))
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
      
      // 检查是否有效（有参与人数和中奖人数）
      if (!lottery.joinTotal || !lottery.winningTotal) {
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
    const finalPeople = Math.min(
      Math.max(baseFinalPeople + potentialNewPeople, currentPeople),
      saturationCap
    )
    
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
  async searchLiveRoomCategory(accountId, { category_id, category_name, page = null }, onBatch = null, scanProfile = null) {
    return collectLiveRoomCategory(this, accountId, { category_id, category_name, page }, onBatch, scanProfile)
  }

  /**
   * 根据直播间信息获取福袋信息（并发，参考原项目）
   */
  async getLotteryInfo(roomInfoList, accountId, scanProfile = null) {
    return fetchLotteryInfoWithProfile(this, roomInfoList, accountId, scanProfile)
  }

  /**
   * 根据条件过滤福袋（优化版：只要包含类型3和6即可）
   */
  filterLotteryByConditions(lotteryList, config = {}) {
    return lotteryList.filter((item) => {
      if (!isSupermanJoinableLottery(item)) return false
      if (config.filterFanClub?.enabled !== false && hasRestrictedJoinRequirement(item)) return false
      return true
    })
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
    const accountData = this.accounts.get(accountId)
    const config = accountData?.config || {}
    const minPoolEndTime = this.getMinPoolEndTime(accountId)

    const existingRoomIds = new Set(current.map((item) => item.roomId))
    let addedCount = 0
    
    for (const lottery of newLotteryList) {
      if (config.filterFanClub?.enabled !== false && hasRestrictedJoinRequirement(lottery)) {
        continue
      }
      if (config.onlyPhysicalPrize?.enabled && !isPhysicalPrizeLottery(lottery)) {
        continue
      }
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

  pickNextLottery(accountId, config, now) {
    const source = [...this.getAccountLotteryList(accountId)]
    const retained = []
    const candidates = []
    const bigThreshold = Number(config?.preferBigRedPacket?.threshold || 40)

    for (const item of source) {
      if (!item?.end_time) continue
      const remaining = item.end_time - now
      if (remaining <= MIN_JOIN_WINDOW_SEC || remaining >= MAX_JOIN_WINDOW_SEC) continue

      if (config.filterFanClub?.enabled !== false && hasRestrictedJoinRequirement(item)) continue
      if (config.onlyPhysicalPrize?.enabled && !isPhysicalPrizeLottery(item)) continue

      if (config.filterOnline?.enabled && Number(item.onlineTotal || 0) > Number(config.filterOnline.value || 0)) continue

      // 只保留手动可参与类型，避免不可自动参与的福袋进入候选
      const conditions = Array.isArray(item.conditions) ? item.conditions : []
      const hasType3 = conditions.some(c => Number(c?.type) === 3)
      const hasType6 = conditions.some(c => Number(c?.type) === 6)
      if (!(hasType3 && hasType6)) continue

      const predictedPercent = Number(item.predictedProbability || 0) * 100
      if (config.hitRate?.enabled && predictedPercent < Number(config.hitRate.value || 0) * 100) continue

      const currentProb = Number(this.calculateProbability(item))
      if (config.secondInspect?.enabled && currentProb < (Number(config.secondInspect.value || 0) * 100)) continue

      retained.push(item)
      const redPacketInfo = getRedPacketAveragePerWinner(item, bigThreshold)
      candidates.push({
        item,
        score: this.calculateLotteryScore(item, now, config, redPacketInfo),
        redPacketInfo
      })
    }

    // 清理池子，只保留仍可参与项
    this.setAccountLotteryList(accountId, retained)

    if (candidates.length === 0) {
      return null
    }

    const hasServerRank = candidates.some(c => Number.isFinite(Number(c.item?._serverRank)))
    if (hasServerRank) {
      candidates.sort((a, b) => {
        const rankA = Number.isFinite(Number(a.item?._serverRank)) ? Number(a.item._serverRank) : Number.MAX_SAFE_INTEGER
        const rankB = Number.isFinite(Number(b.item?._serverRank)) ? Number(b.item._serverRank) : Number.MAX_SAFE_INTEGER
        if (rankA !== rankB) return rankA - rankB
        return (a.item.end_time || 0) - (b.item.end_time || 0)
      })
      return candidates[0].item
    }

    const preferBig = config?.preferBigRedPacket?.enabled === true
    const sortable = preferBig && candidates.some(c => c.redPacketInfo?.isBig)
      ? candidates.filter(c => c.redPacketInfo?.isBig)
      : candidates

    sortable.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return (a.item.end_time || 0) - (b.item.end_time || 0)
    })
    return sortable[0].item
  }

  calculateLotteryScore(item, nowSec, config = {}, redPacketInfo = null) {
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
    const redInfo = redPacketInfo || getRedPacketAveragePerWinner(item, threshold)
    let bigRedPacketBonus = 0
    if (config?.preferBigRedPacket?.enabled) {
      if (redInfo?.isBig) bigRedPacketBonus = 18
      else if (redInfo?.isRedPacket && redInfo?.known) bigRedPacketBonus = -4
    }

    const score =
      useProb * 100 * 0.62 +
      timeFactor * 100 * 0.2 +
      rewardBonus * 100 * 0.12 -
      crowdPenalty * 100 * 0.04 -
      onlinePenalty * 100 * 0.02 +
      bigRedPacketBonus

    return Number(score.toFixed(4))
  }

  getWaitScanDelayMs(remainingMs) {
    if (remainingMs > 60000) return 9000
    if (remainingMs > 25000) return 7000
    return 3500
  }

  scheduleScanDuringWait(accountId, waitUntilMs) {
    const runTick = async () => {
      const accountData = this.accounts.get(accountId)
      if (!accountData || this.isPaused(accountId)) return

      const remainMs = waitUntilMs - Date.now()
      if (remainMs <= 0) {
        this.setMinPoolEndTime(accountId, 0)
        accountData.callbacks.onLog('✅ 福袋已开奖')
        accountData.callbacks.onLog('🔄 单轮结束，优先使用等待期预扫描结果...')
        this.removeExpiredLotteries(accountId)
        this.calculatePredictedProbabilities(accountId)
        this.sortLotteriesByProbability(accountId)
        this.emitLotteryListUpdate(accountData)
        this.scheduleAccountTask(accountId, 300, () => this.start(accountId))
        return
      }

      if (this.isScannerAccount(accountId)) {
        await this.searchLiveRoom(accountId, { scanOnly: true, deadlineMs: waitUntilMs - 1200 })
      }
      if (!this.accounts.has(accountId) || this.isPaused(accountId)) return
      const nextDelay = this.getWaitScanDelayMs(waitUntilMs - Date.now())
      this.scheduleAccountTask(accountId, nextDelay, runTick)
    }

    this.scheduleAccountTask(accountId, 1000, runTick)
  }

  async start(accountId) {
    const accountData = this.accounts.get(accountId)
    if (!accountData) return
    const config = accountData.config || {}

    this.clearAccountTimer(accountId)

    // 扫描完成后先从服务端拉取统一筛选结果，再在本地执行账号级过滤与参与
    if (this.isPoolServerEnabled()) {
      const synced = await this.refreshPoolFromServer(accountId)
      if (synced) {
        this.logger.debug(`[${accountId}] 已同步服务端筛选池`)
      }
    }

    // 再次剔除过期福袋，并从当前池中选出一个可参与福袋
    this.removeExpiredLotteries(accountId)
    const now = Date.now() / 1000
    const lotteryInfo = this.pickNextLottery(accountId, config, now)

    if (!lotteryInfo) {
      accountData.state = 'waiting'
      accountData.callbacks.onLog('📋 当前扫描池没有可参与福袋，10秒后重新扫描...')
      accountData.callbacks.onStatusUpdate({ id: accountId, state: 'waiting' })
      this.emitLotteryListUpdate(accountData)
      this.scheduleAccountTask(accountId, 10000, () => this.searchLiveRoom(accountId))
      return
    }

    const remainingTime = lotteryInfo.end_time - now

    if (config.participationCount?.enabled && accountData.participationCount >= config.participationCount.value) {
      accountData.callbacks.onLog(`⛔ 已达到参与上限(${config.participationCount.value})，自动暂停`, 'warning')
      accountData.callbacks.onStatusUpdate({ id: accountId, state: 'paused' })
      this.setPaused(accountId, true)
      this.clearAccountTimer(accountId)
      return
    }

    if (config.singleAccountDuration?.enabled) {
      const elapsedHours = (Date.now() - (accountData.startedAt || Date.now())) / 3600000
      if (elapsedHours >= config.singleAccountDuration.value) {
        accountData.callbacks.onLog(`⛔ 已达到运行时长上限(${config.singleAccountDuration.value}小时)，自动暂停`, 'warning')
        accountData.callbacks.onStatusUpdate({ id: accountId, state: 'paused' })
        this.setPaused(accountId, true)
        this.clearAccountTimer(accountId)
        return
      }
    }

    // 二次概率检查
    const currentProb = Number(this.calculateProbability(lotteryInfo))
    const selectedScore = this.calculateLotteryScore(lotteryInfo, now, config)
    const predictedProb = Number(lotteryInfo.predictedProbability || 0) * 100
    const redPacketInfo = getRedPacketAveragePerWinner(
      lotteryInfo,
      Number(config?.preferBigRedPacket?.threshold || 40)
    )
    
    accountData.state = 'running'
    accountData.callbacks.onLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    accountData.callbacks.onLog(`🎯 选择最优福袋: ${lotteryInfo.authorNickname}`)
    accountData.callbacks.onLog(`   福袋: ${lotteryInfo.lotteryName}`)
    accountData.callbacks.onLog(`   当前概率: ${currentProb}%`)
    accountData.callbacks.onLog(`   预测概率: ${predictedProb.toFixed(2)}%`)
    accountData.callbacks.onLog(`   筛选评分: ${selectedScore}`)
    if (config.onlyPhysicalPrize?.enabled) {
      accountData.callbacks.onLog(`   实物筛选: 已开启`)
    }
    if (config.preferBigRedPacket?.enabled) {
      if (redPacketInfo?.known) {
        accountData.callbacks.onLog(`   红包均值: ${redPacketInfo.avgPerWinner.toFixed(2)} (阈值${Number(config.preferBigRedPacket.threshold || 40)})`)
      } else {
        accountData.callbacks.onLog(`   红包均值: 未知 (阈值${Number(config.preferBigRedPacket.threshold || 40)})`)
      }
    }
    accountData.callbacks.onLog(`   剩余时间: ${remainingTime.toFixed(0)}秒`)
    accountData.callbacks.onLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    
    accountData.currentRoom = `${lotteryInfo.authorNickname}(${lotteryInfo.webRid})`
    accountData.callbacks.onStatusUpdate({ 
      id: accountId, 
      state: 'running',
      currentRoom: accountData.currentRoom 
    })
    
    // 前往直播间 (BrowserView 导航)
    await ipcRenderer.invoke('navigate-to', {
      accountId,
      url: `https://live.douyin.com/${lotteryInfo.webRid}`
    })

    // 参考超人福袋流程：进房后先等待页面稳定并尝试触发福袋入口，再发参与接口
    await this.waitForLiveRoomReady(accountId)
    if (config.closeLiveStream?.enabled !== false) {
      await this.ensureCloseLiveStreamRendering(accountId)
    }
    await this.warmupLotteryEntry(accountId)

    // 进房后重新拉取一次房间内的最新福袋详情，避免用扫描阶段的过期 lottery_id
    const refreshed = await ipcRenderer.invoke('get-lottery-detail', {
      roomId: lotteryInfo.roomId,
      webRid: lotteryInfo.webRid,
      accountId
    })
    const targetLotteryId = refreshed?.success && refreshed?.lotteryDetail?.lottery_id
      ? refreshed.lotteryDetail.lottery_id
      : lotteryInfo.lottery_id

    // 参考超人福袋：进房后做一次二次概率复核（使用房间内最新 candidate/lucky）
    const refreshedJoinTotal = Number(refreshed?.lotteryDetail?.joinTotal || lotteryInfo.joinTotal || 0)
    const refreshedWinningTotal = Number(refreshed?.lotteryDetail?.winningTotal || lotteryInfo.winningTotal || 0)
    const refreshedProb = refreshedJoinTotal > 0
      ? (refreshedWinningTotal / refreshedJoinTotal) * 100
      : currentProb
    if (config.secondInspect?.enabled && refreshedProb < (Number(config.secondInspect.value || 0) * 100)) {
      accountData.callbacks.onLog(
        `⚠️ 二次复核未通过：实时概率${refreshedProb.toFixed(2)}% < 阈值${(Number(config.secondInspect.value || 0) * 100).toFixed(2)}%，放弃本轮`,
        'warning'
      )
      this.setAccountLotteryList(accountId, [])
      this.emitLotteryListUpdate(accountData)
      this.scheduleAccountTask(accountId, 1000, () => this.searchLiveRoom(accountId))
      return
    }
    
    if (config.randomInteraction?.enabled && Math.random() < 0.35) {
      ipcRenderer.invoke('room-like', {
        roomId: lotteryInfo.roomId,
        accountId,
        count: Math.floor(Math.random() * 3) + 1
      }).catch(() => {})
    }

    accountData.callbacks.onLog('✅ 已进入直播间，准备执行参与...')

    // 参考超人福袋：优先走页面可视化参与流程（等待福袋入口 -> 点击参与按钮）
    const uiJoinResult = await this.joinLotteryByUI(accountId, remainingTime)
    if (uiJoinResult.success) {
      const uiSuccessText = uiJoinResult.confirmed ? '🎁 UI参与成功（已确认）' : '🎁 UI参与成功'
      await this.onJoinSuccess(accountId, accountData, remainingTime, config, uiSuccessText, lotteryInfo)
      return
    }
    accountData.callbacks.onLog(`⚠️ UI参与失败，回退接口参与: ${uiJoinResult.error || '未知原因'}`)

    const finalAttendResult = await this.attendLotteryWithRetry(
      accountId,
      accountData,
      lotteryInfo,
      targetLotteryId
    )
    if (finalAttendResult?.success) {
      await this.onJoinSuccess(accountId, accountData, remainingTime, config, finalAttendResult.message || '🎁 接口参与成功', lotteryInfo)
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
      if (lotteryInfo && typeof accountData.callbacks.onHistoryRecord === 'function') {
        try {
          accountData.callbacks.onHistoryRecord({
            accountId,
            accountNickname: accountData.nickname || accountId,
            roomId: lotteryInfo.roomId || '',
            webRid: lotteryInfo.webRid || '',
            authorNickname: lotteryInfo.authorNickname || '',
            lotteryName: lotteryInfo.lotteryName || '',
            predictedProbability: Number(lotteryInfo.predictedProbability || 0),
            joinMode: 'UI+API',
            joinStatus: 'failed',
            resultReason: errorText,
            joinedAt: Date.now(),
            endTime: Number(lotteryInfo.end_time || 0) * 1000
          })
        } catch (e) {
          this.logger.debug(`[${accountId}] onHistoryRecord(失败) 回调失败`, e)
        }
      }

      // 参与失败也按单轮处理：清池并重扫，避免在旧池里连续抢多个
      const waitMs = Math.min(2000 * Math.pow(2, Math.min(streak - 1, 5)), 60000)
      this.setAccountLotteryList(accountId, [])
      this.emitLotteryListUpdate(accountData)
      this.scheduleAccountTask(accountId, waitMs, () => this.searchLiveRoom(accountId))
  }

  async onJoinSuccess(accountId, accountData, remainingTime, config, successMessage, lotteryInfo = null) {
    this.attendFailureStreak.set(accountId, 0)
    accountData.callbacks.onLog(successMessage)

    accountData.participationCount++
    accountData.callbacks.onStatusUpdate({
      id: accountId,
      participationCount: accountData.participationCount
    })

    if (lotteryInfo && typeof accountData.callbacks.onHistoryRecord === 'function') {
      try {
        accountData.callbacks.onHistoryRecord({
          accountId,
          accountNickname: accountData.nickname || accountId,
          roomId: lotteryInfo.roomId || '',
          webRid: lotteryInfo.webRid || '',
          authorNickname: lotteryInfo.authorNickname || '',
          lotteryName: lotteryInfo.lotteryName || '',
          predictedProbability: Number(lotteryInfo.predictedProbability || 0),
          joinMode: /UI/.test(successMessage) ? 'UI' : 'API',
          joinStatus: 'success',
          resultReason: '',
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
    const waitTime = Math.max((safeRemaining + stayDuration) * 1000, 4000)
    const waitUntilMs = Date.now() + waitTime
    const minPoolEndTime = Math.floor(waitUntilMs / 1000)
    this.setMinPoolEndTime(accountId, minPoolEndTime)
    accountData.callbacks.onLog(`⏱️ 等待福袋结束（剩余${safeRemaining.toFixed(0)}秒 + 停留${stayDuration}秒）...`)
    accountData.callbacks.onLog('🔎 等待期间持续扫描后续福袋（仅保留更晚开奖的候选）')

    this.scheduleScanDuringWait(accountId, waitUntilMs)
  }

  async waitForLiveRoomReady(accountId, timeoutMs = 10000) {
    return executeWaitForLiveRoomReady(this, accountId, timeoutMs)
  }

  async warmupLotteryEntry(accountId) {
    return executeWarmupLotteryEntry(this, accountId)
  }

  async closeLiveStreamRendering(accountId) {
    return executeCloseLiveStreamRendering(this, accountId)
  }

  async ensureCloseLiveStreamRendering(accountId) {
    return executeEnsureCloseLiveStreamRendering(this, accountId)
  }

  async joinLotteryByUI(accountId, remainingTime = 30) {
    return executeJoinLotteryByUI(this, accountId, remainingTime)
  }

  isAttendSuccessLike(result) {
    return detectAttendSuccessLike(result)
  }

  async attendLotteryWithRetry(accountId, accountData, lotteryInfo, initialLotteryId) {
    return executeAttendWithRetry(this, accountId, accountData, lotteryInfo, initialLotteryId)
  }

  async autoJoinRedPacketLoop(accountId, accountData, rounds = 3) {
    return executeAutoJoinRedPacketLoop(this, accountId, accountData, rounds)
  }

  async joinRedPacketByUI(accountId) {
    return executeJoinRedPacketByUI(this, accountId)
  }

  pauseAccount(accountId) {
    const accountData = this.accounts.get(accountId)
    if (accountData) {
      this.setPaused(accountId, true)
      this.clearAccountTimer(accountId)
      this.setMinPoolEndTime(accountId, 0)
      this.releaseScannerAccount(accountId)
      accountData.state = 'paused'
      accountData.callbacks.onStatusUpdate({ id: accountId, state: 'paused' })
    }
  }

  resumeAccount(accountId) {
    const accountData = this.accounts.get(accountId)
    if (accountData) {
      this.setPaused(accountId, false)
      this.setMinPoolEndTime(accountId, 0)
      this.ensureScannerAccount(accountId)
      accountData.state = 'running'
      accountData.callbacks.onStatusUpdate({ id: accountId, state: 'running' })
      this.scheduleAccountTask(accountId, 200, () => this.searchLiveRoom(accountId))
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

export default LotteryManager
