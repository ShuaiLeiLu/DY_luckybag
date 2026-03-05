// 使用 require 导入 electron (在 Electron 渲染进程中)
let ipcRenderer
if (typeof window !== 'undefined' && window.require) {
  try {
    const electron = window.require('electron')
    ipcRenderer = electron.ipcRenderer
  } catch (e) {
    console.warn('无法加载 electron ipcRenderer:', e)
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

class LotteryManager {
  constructor() {
    this.accounts = new Map()
    this.lotteryPoolByAccount = new Map() // accountId -> 福袋列表
    this.collectLoadingByAccount = new Map() // accountId -> 是否正在收集
    this.pauseCollectByAccount = new Map() // accountId -> 是否暂停收集
    this.attendFailureStreak = new Map() // accountId -> consecutive failure count
    this.cycleTimerByAccount = new Map() // accountId -> timer id
    this.blockList = new Set() // 屏蔽的直播间列表 (roomId)
    
    // 默认为空数组（完全照搬原项目）
    // 用户可以通过 setCategoryList() 方法手动设置要扫描的分类
    this.categoryList = []
    
    // 扫描配置（参考原项目）
    this.scanConfig = {
      countPerPage: 15,  // 每页15个（原项目默认值）
      pagesPerCategory: 10  // 每个分类扫描10页（原项目默认值）
    }
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

  scheduleAccountTask(accountId, delayMs, task) {
    this.clearAccountTimer(accountId)
    const timer = setTimeout(async () => {
      this.cycleTimerByAccount.delete(accountId)
      if (!this.accounts.has(accountId) || this.isPaused(accountId)) return
      try {
        await task()
      } catch (_) {
        // ignore
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
      // ignore
    }
  }
  
  /**
   * 设置扫描配置
   * @param {Object} config - 配置对象
   * @param {number} config.countPerPage - 每页返回数量
   * @param {number} config.pagesPerCategory - 每个分类扫描页数
   */
  setScanConfig(config) {
    if (config.countPerPage) {
      this.scanConfig.countPerPage = config.countPerPage
    }
    if (config.pagesPerCategory) {
      this.scanConfig.pagesPerCategory = config.pagesPerCategory
    }
    console.log(`扫描配置已更新: 每页${this.scanConfig.countPerPage}个, 每分类${this.scanConfig.pagesPerCategory}页`)
  }
  
  /**
   * 设置要扫描的分类列表
   * @param {Array} categories - 分类数组 [{id, name}, ...]
   */
  setCategoryList(categories) {
    if (Array.isArray(categories) && categories.length > 0) {
      this.categoryList = categories
      console.log(`已设置分类列表，共${categories.length}个分类`)
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

  async startAccount(account, config, callbacks) {
    if (!ipcRenderer) {
      callbacks.onLog('Electron IPC 不可用', 'error')
      return
    }

    const accountData = {
      ...account,
      config,
      callbacks,
      tokenInfo: null,
      participationCount: 0,
      startedAt: Date.now()
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
      // 忽略错误
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
    
    accountData.callbacks.onLog(`开始监控福袋信息`)
    
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
      return false
    }
  }

  /**
   * 统一搜索直播间（参考原项目）
   */
  async searchLiveRoom(accountId) {
    if (this.isCollectLoading(accountId)) {
      return
    }
    
    if (!this.accounts.has(accountId)) return

    try {
      this.setCollectLoading(accountId, true)
      const accountData = this.accounts.get(accountId)
      if (!accountData) return

      this.emitLotteryListUpdate(accountData)
      
      // 检查浏览器是否存活
      if (!(await this.isBrowserAlive(accountId))) {
        accountData.callbacks.onLog('⚠️ 浏览器窗口已关闭，停止扫描任务')
        return
      }

      this.setPaused(accountId, false)

      // 1) 先清理过期项，保留仍可用池子（参考超人：不每轮清空）
      this.removeExpiredLotteries(accountId)
      this.calculatePredictedProbabilities(accountId)
      this.sortLotteriesByProbability(accountId)
      this.emitLotteryListUpdate(accountData)

      // 2. 按超人逻辑：先全站，再按分类采集补充池子
      await this.searchLiveByAll(accountId)
      if (this.isPaused(accountId) || !(await this.isBrowserAlive(accountId))) return

      if (this.categoryList.length > 0) {
        await this.startCollectLive(accountId)
      }
      if (this.isPaused(accountId) || !(await this.isBrowserAlive(accountId))) return

      // 3. 清理 + 概率 + 排序
      this.removeExpiredLotteries(accountId)
      this.calculatePredictedProbabilities(accountId)
      this.sortLotteriesByProbability(accountId)
      this.emitLotteryListUpdate(accountData)

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
        accountData.callbacks.onLog(`搜索失败: ${error.message}，10秒后重试...`, 'error')
        if (!this.isPaused(accountId)) {
          this.scheduleAccountTask(accountId, 10000, () => this.searchLiveRoom(accountId))
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
      console.log(`🗑️ 已剔除 ${removedCount} 个过期/失效的福袋`)
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
  async searchLiveByAll(accountId, times = 10) {
    const accountData = this.accounts.get(accountId)
    if (!accountData) return
    
    try {
      for (let i = 0; i < times; i++) {
        if (this.isPaused(accountId)) break
        
        try {
          // 调用API获取直播间列表
          const result = await ipcRenderer.invoke('search-live-by-all', { accountId })
          
          if (!result.success) {
            accountData.callbacks.onLog(`第${i + 1}次搜索失败: ${result.error || '未知错误'}`)
            
            // 如果是API错误，打印详细信息
            if (result.detail) {
              console.error(`[搜索失败详情]`, result.detail)
            }
            
            // 继续下一次搜索，不要中断
            continue
          }
          
          if (!result.roomInfoList) {
            accountData.callbacks.onLog(`第${i + 1}次搜索: 返回数据为空`)
            continue
          }
          
          const roomInfoList = result.roomInfoList
          
          if (roomInfoList.length === 0) {
            // 没有福袋，继续下一次
            continue
          }
          
          // 获取福袋详情（并发）
          const resList = await this.getLotteryInfo(roomInfoList, accountId)
          const validLotteryInfoList = resList.filter(item => item.status === 'fulfilled' && item.value).map(item => item.value)
          
          // 按超人逻辑：先按条件过滤，再入池去重
          const filteredList = this.filterLotteryByConditions(validLotteryInfoList)
          this.addLotteryInfoWithoutDuplicates(accountId, filteredList)
          this.calculatePredictedProbabilities(accountId)
          this.sortLotteriesByProbability(accountId)
          this.emitLotteryListUpdate(accountData)
          
          // 随机延迟
          const randomDelay = Math.floor(Math.random() * 1000) + 500
          await this.sleep(randomDelay)
          
        } catch (error) {
          accountData.callbacks.onLog(`第${i + 1}次搜索出错: ${error.message}`)
          console.error(`[搜索异常]`, error)
          // 继续下一次搜索
        }
      }
    } catch (error) {
      accountData.callbacks.onLog(`全部搜索异常: ${error.message}`)
      console.error(`[全部搜索异常]`, error)
    }
  }

  /**
   * 搜索直播间-【分类】（参考原项目）
   */
  async startCollectLive(accountId) {
    const accountData = this.accounts.get(accountId)
    if (!accountData) return
    
    // 使用配置的分类列表
    const categories = this.categoryList
    
    try {
      for (let i = 0; i < categories.length; i++) {
        if (this.isPaused(accountId)) break
        
        const category = categories[i]
        
        try {
          await this.searchLiveRoomCategory(accountId, {
            category_id: category.id,
            category_name: category.name,
            page: 10
          }, (batchList) => {
            const filteredList = this.filterLotteryByConditions(batchList)
            this.addLotteryInfoWithoutDuplicates(accountId, filteredList)
            this.calculatePredictedProbabilities(accountId)
            this.sortLotteriesByProbability(accountId)
            this.emitLotteryListUpdate(accountData)
          })
          
          const randomDelay = Math.floor(Math.random() * 1000) + 500
          await this.sleep(randomDelay)
          
        } catch (error) {
          accountData.callbacks.onLog(`【${category.name}】分类采集出错: ${error.message}`)
        }
      }
    } catch (error) {
      accountData.callbacks.onLog(`分类搜索异常: ${error.message}`)
    }
  }

  /**
   * 采集直播间-【每个分类】（参考原项目）
   */
  async searchLiveRoomCategory(accountId, { category_id, category_name, page = null }, onBatch = null) {
    const accountData = this.accounts.get(accountId)
    if (!accountData) return []
    
    // 使用配置的页数
    const totalPages = page || this.scanConfig.pagesPerCategory
    const countPerPage = this.scanConfig.countPerPage
    
    const lotteryInfoList = []
    
    try {
      for (let i = 0; i < totalPages; i++) {
        if (this.isPaused(accountId)) break
        
        try {
          // offset 从 0 开始分页，避免遗漏第一页
          const result = await ipcRenderer.invoke('search-live-by-category', {
            accountId,
            categoryId: category_id,
            offset: i * countPerPage,
            count: countPerPage
          })
          
          if (!result.success || !result.roomInfoList) {
            continue
          }
          
          const roomInfoList = result.roomInfoList
          
          // 延迟200ms
          await this.sleep(200)
          
          // 获取福袋详情（并发）
          const resList = await this.getLotteryInfo(roomInfoList, accountId)
          const validLotteryInfoList = resList.filter(item => item.status === 'fulfilled' && item.value).map(item => item.value)
          
          lotteryInfoList.push(...validLotteryInfoList)
          if (typeof onBatch === 'function' && validLotteryInfoList.length > 0) {
            onBatch(validLotteryInfoList)
          }
          
        } catch (error) {
          // 跳过错误
        }
      }
    } catch (error) {
      accountData.callbacks.onLog(`分类搜索异常: ${error.message}`)
    }
    
    return lotteryInfoList
  }

  /**
   * 根据直播间信息获取福袋信息（并发，参考原项目）
   */
  async getLotteryInfo(roomInfoList, accountId) {
    if (!Array.isArray(roomInfoList) || roomInfoList.length === 0) {
      return []
    }

    const fetchOne = async (roomInfo) => {
      const result = await ipcRenderer.invoke('get-lottery-detail', {
        roomId: roomInfo.roomId,
        webRid: roomInfo.webRid,
        accountId
      })

      if (!result.success || !result.lotteryDetail) {
        // 对风控/网关返回 HTML 的场景做一次重试
        if (result.code === 'NON_JSON_RESPONSE') {
          await this.sleep(300)
          const retry = await ipcRenderer.invoke('get-lottery-detail', {
            roomId: roomInfo.roomId,
            webRid: roomInfo.webRid,
            accountId
          })
          if (retry.success && retry.lotteryDetail) {
            return {
              ...roomInfo,
              ...retry.lotteryDetail,
              fetchedAt: Date.now()
            }
          }
        }
        throw new Error(result.error || '福袋信息获取失败')
      }

      return {
        ...roomInfo,
        ...result.lotteryDetail,
        fetchedAt: Date.now()
      }
    }

    // 全并发容易触发 444 风控，改为限并发队列
    const concurrency = Math.min(4, roomInfoList.length)
    const settled = new Array(roomInfoList.length)
    let cursor = 0

    const worker = async () => {
      while (true) {
        const index = cursor
        cursor += 1
        if (index >= roomInfoList.length) break
        try {
          const value = await fetchOne(roomInfoList[index])
          settled[index] = { status: 'fulfilled', value }
        } catch (reason) {
          settled[index] = { status: 'rejected', reason }
        }
        await this.sleep(80 + Math.floor(Math.random() * 120))
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()))
    return settled
  }

  /**
   * 根据条件过滤福袋（优化版：只要包含类型3和6即可）
   */
  filterLotteryByConditions(lotteryList) {
    return lotteryList.filter((item) => {
      if (!item || !item.conditions || item.conditions.length === 0) {
        return false
      }

      // 扫描阶段直接过滤会员/粉丝团限制福袋，不进入池子
      if (this.hasRestrictedJoinRequirement(item)) {
        return false
      }

      // 完全对齐超人：条件必须恰好2条，且顺序为 [3, 6]
      return (
        item.conditions.length === 2 &&
        Number(item.conditions[0]?.type) === 3 &&
        Number(item.conditions[1]?.type) === 6
      )
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

  hasRestrictedJoinRequirement(lottery) {
    const conditions = Array.isArray(lottery?.conditions) ? lottery.conditions : []
    const restrictedRe = /(粉丝团|粉丝专属|仅粉丝|仅限粉丝|团员|加团|主播会员|会员可参与|仅会员|会员专属)/
    return conditions.some(c => {
      const typeNum = Number(c?.type)
      const text = [
        c?.content,
        c?.desc,
        c?.description,
        c?.name,
        c?.title,
        c?.text,
        JSON.stringify(c || {})
      ].filter(Boolean).join(' ')
      return typeNum === 2 || restrictedRe.test(String(text))
    })
  }

  hasFanClubRequirement(lottery) {
    return this.hasRestrictedJoinRequirement(lottery)
  }

  /**
   * 添加福袋信息，避免重复（参考原项目）
   */
  addLotteryInfoWithoutDuplicates(accountId, newLotteryList) {
    if (!Array.isArray(newLotteryList) || newLotteryList.length === 0) return
    // 每次添加新福袋前，先清理内存中已过期的福袋
    this.removeExpiredLotteries(accountId)
    const current = [...this.getAccountLotteryList(accountId)]
    const accountConfig = this.accounts.get(accountId)?.config || {}

    const existingRoomIds = new Set(current.map((item) => item.roomId))
    let addedCount = 0
    
    for (const lottery of newLotteryList) {
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
      console.log(`➕ 新增 ${addedCount} 个福袋`)
    }
  }

  pickNextLottery(accountId, config, now) {
    const source = [...this.getAccountLotteryList(accountId)]
    const retained = []
    const candidates = []

    for (const item of source) {
      if (!item?.end_time) continue
      const remaining = item.end_time - now
      if (remaining <= MIN_JOIN_WINDOW_SEC || remaining >= MAX_JOIN_WINDOW_SEC) continue

      if (this.hasRestrictedJoinRequirement(item)) continue

      if (config.filterOnline?.enabled && Number(item.onlineTotal || 0) > Number(config.filterOnline.value || 0)) continue

      // 只保留手动可参与类型，避免不可自动参与的福袋进入候选
      const conditions = Array.isArray(item.conditions) ? item.conditions : []
      if (!conditions.some(c => Number(c?.type) === 6)) continue

      const predictedPercent = Number(item.predictedProbability || 0) * 100
      if (config.hitRate?.enabled && predictedPercent < Number(config.hitRate.value || 0) * 100) continue

      const currentProb = Number(this.calculateProbability(item))
      if (config.secondInspect?.enabled && currentProb < (Number(config.secondInspect.value || 0) * 100)) continue

      retained.push(item)
      candidates.push({
        item,
        score: this.calculateLotteryScore(item, now)
      })
    }

    // 清理池子，只保留仍可参与项
    this.setAccountLotteryList(accountId, retained)

    if (candidates.length === 0) {
      return null
    }

    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return (a.item.end_time || 0) - (b.item.end_time || 0)
    })
    return candidates[0].item
  }

  calculateLotteryScore(item, nowSec) {
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

    const score =
      useProb * 100 * 0.62 +
      timeFactor * 100 * 0.2 +
      rewardBonus * 100 * 0.12 -
      crowdPenalty * 100 * 0.04 -
      onlinePenalty * 100 * 0.02

    return Number(score.toFixed(4))
  }

  async start(accountId) {
    const accountData = this.accounts.get(accountId)
    if (!accountData) return
    const config = accountData.config || {}

    this.clearAccountTimer(accountId)

    // 再次剔除过期福袋，并从当前扫描池中选出一个可参与福袋
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
    const selectedScore = this.calculateLotteryScore(lotteryInfo, now)
    const predictedProb = Number(lotteryInfo.predictedProbability || 0) * 100
    
    accountData.state = 'running'
    accountData.callbacks.onLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    accountData.callbacks.onLog(`🎯 选择最优福袋: ${lotteryInfo.authorNickname}`)
    accountData.callbacks.onLog(`   福袋: ${lotteryInfo.lotteryName}`)
    accountData.callbacks.onLog(`   当前概率: ${currentProb}%`)
    accountData.callbacks.onLog(`   预测概率: ${predictedProb.toFixed(2)}%`)
    accountData.callbacks.onLog(`   筛选评分: ${selectedScore}`)
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
      await this.onJoinSuccess(accountId, accountData, remainingTime, config, uiSuccessText)
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
      await this.onJoinSuccess(accountId, accountData, remainingTime, config, finalAttendResult.message || '🎁 接口参与成功')
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

      // 参与失败也按单轮处理：清池并重扫，避免在旧池里连续抢多个
      const waitMs = Math.min(2000 * Math.pow(2, Math.min(streak - 1, 5)), 60000)
      this.setAccountLotteryList(accountId, [])
      this.emitLotteryListUpdate(accountData)
      this.scheduleAccountTask(accountId, waitMs, () => this.searchLiveRoom(accountId))
  }

  async onJoinSuccess(accountId, accountData, remainingTime, config, successMessage) {
    this.attendFailureStreak.set(accountId, 0)
    accountData.callbacks.onLog(successMessage)

    accountData.participationCount++
    accountData.callbacks.onStatusUpdate({
      id: accountId,
      participationCount: accountData.participationCount
    })

    if (config.enableRedPacket) {
      accountData.callbacks.onLog('🧧 尝试自动抢红包...')
      this.autoJoinRedPacketLoop(accountId, accountData).catch(() => {})
    }

    const stayDuration = Number(config.stayDuration || 5)
    const waitTime = Math.max((remainingTime + stayDuration + 25) * 1000, 8000)
    accountData.callbacks.onLog(`⏱️ 等待福袋结束（${(waitTime / 1000).toFixed(0)}秒）...`)

    this.scheduleAccountTask(accountId, waitTime, () => {
      accountData.callbacks.onLog('✅ 福袋已开奖')
      accountData.callbacks.onLog('🔄 单轮结束，清空福袋池并重新扫描...')
      this.setAccountLotteryList(accountId, [])
      this.emitLotteryListUpdate(accountData)
      return this.searchLiveRoom(accountId)
    })
  }

  async waitForLiveRoomReady(accountId, timeoutMs = 10000) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const result = await ipcRenderer.invoke('execute-script', {
        accountId,
        script: `
          (() => {
            const hrefOk = location.href.includes('live.douyin.com');
            const stateOk = document.readyState === 'interactive' || document.readyState === 'complete';
            const hasMain = !!document.querySelector('body');
            return hrefOk && stateOk && hasMain;
          })()
        `
      })
      if (result?.success && result?.result === true) {
        return true
      }
      await this.sleep(350)
    }
    return false
  }

  async warmupLotteryEntry(accountId) {
    try {
      await ipcRenderer.invoke('execute-script', {
        accountId,
        script: `
          (() => {
            const selectors = [
              '#lottery_close_cotainer div[role="button"]',
              '[data-e2e*="lottery"]',
              '[class*="lottery"] [role="button"]',
              '[class*="benefit"] [role="button"]'
            ];
            for (const s of selectors) {
              const el = document.querySelector(s);
              if (el && typeof el.click === 'function') {
                el.click();
                return { clicked: true, selector: s };
              }
            }
            return { clicked: false };
          })()
        `
      })
    } catch (_) {
      // ignore
    }
  }

  async closeLiveStreamRendering(accountId) {
    try {
      const res = await ipcRenderer.invoke('execute-script', {
        accountId,
        script: `
          (() => {
            try {
              // 静音并暂停媒体
              const medias = document.querySelectorAll('video, audio');
              medias.forEach(m => {
                try {
                  m.muted = true;
                  m.volume = 0;
                  if (typeof m.pause === 'function') m.pause();
                } catch (_) {}
              });

              // 尝试点击“关闭画面/仅听声音”类按钮（文案因版本变化可能不一致）
              const btns = Array.from(document.querySelectorAll('button, div[role="button"], span'));
              const hit = btns.find(el => {
                const t = (el?.innerText || el?.textContent || '').trim();
                return /(关闭画面|仅听声音|关闭直播流|省流模式)/.test(t);
              });
              if (hit && typeof hit.click === 'function') {
                hit.click();
              }

              // 注入样式：隐藏播放器画面层，但不影响页面其它交互元素
              const styleId = '__dy_hide_live_stream_style__';
              if (!document.getElementById(styleId)) {
                const style = document.createElement('style');
                style.id = styleId;
                style.textContent = [
                  'video { opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; }',
                  '[class*="player"] video, [class*="live-player"] video, [id*="player"] video { opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; }',
                  'canvas[class*="video"], [class*="video-canvas"], canvas[id*="video"] { opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; }',
                  '[class*="player"][class*="container"], [class*="live-player"][class*="container"] { background: #111 !important; }'
                ].join('\\n');
                document.head.appendChild(style);
              }

              const anyVideo = !!document.querySelector('video, canvas[class*="video"], canvas[id*="video"]');
              return { ok: true, anyVideo };
            } catch (e) {
              return { ok: false, error: e.message };
            }
          })()
        `
      })
      return res?.success ? res.result : { ok: false }
    } catch (_) {
      return { ok: false }
    }
  }

  async ensureCloseLiveStreamRendering(accountId) {
    // 抖音播放器是异步挂载，需多次尝试
    for (let i = 0; i < 8; i++) {
      const r = await this.closeLiveStreamRendering(accountId)
      if (r?.ok && !r?.anyVideo) {
        return true
      }
      await this.sleep(450)
    }
    return false
  }

  async joinLotteryByUI(accountId, remainingTime = 30) {
    // 留出开奖前缓冲，避免在最后几秒等待入口导致错过
    const maxEntryWaitMs = Math.max(4000, Math.min(20000, (Number(remainingTime) - 6) * 1000))
    const waitEntryStart = Date.now()
    while (Date.now() - waitEntryStart < maxEntryWaitMs) {
      const res = await ipcRenderer.invoke('execute-script', {
        accountId,
        script: `
          (() => {
            const selectors = [
              '.dVxrjT_h',
              '[data-e2e*="lottery"]',
              '#lottery_close_cotainer',
              '[class*="lottery"]'
            ];
            let entry = null;
            let selector = '';
            for (const s of selectors) {
              const el = document.querySelector(s);
              if (el) {
                entry = el;
                selector = s;
                break;
              }
            }
            if (!entry) return { ok: false, step: 'wait-entry' };
            if (typeof entry.click === 'function') entry.click();
            return { ok: true, step: 'entry-ready', selector };
          })()
        `
      })
      if (res?.success && res?.result?.ok) {
        break
      }
      await this.sleep(500)
    }

    // 参考超人福袋：打开福袋入口后等待弹层稳定
    await this.sleep(1600)

    // 等待弹层按钮可点击（超人福袋核心 selector）
    const waitJoinStart = Date.now()
    while (Date.now() - waitJoinStart < 10000) {
      const joinRes = await ipcRenderer.invoke('execute-script', {
        accountId,
        script: `
          (() => {
            const btn = document.querySelector('#lottery_close_cotainer div[role="button"]');
            if (!btn) return { ok: false, step: 'wait-join-btn', text: '' };
            const text = (btn.innerText || btn.textContent || '').trim();
            if (typeof btn.click === 'function') {
              btn.click();
              return { ok: true, step: 'clicked-join-btn', text };
            }
            return { ok: false, step: 'join-btn-not-clickable', text };
          })()
        `
      })
      if (joinRes?.success && joinRes?.result?.ok) {
        // 二次确认：按钮文案或弹层状态是否变成“已参与/等待开奖”
        await this.sleep(800)
        const confirmRes = await ipcRenderer.invoke('execute-script', {
          accountId,
          script: `
            (() => {
              const panel = document.querySelector('#lottery_close_cotainer') || document.body;
              const txt = (panel?.innerText || '').replace(/\\s+/g, ' ');
              const joined = /已参与|等待开奖|参与成功|已成功参与/.test(txt);
              return { joined, sample: txt.slice(0, 160) };
            })()
          `
        })
        if (confirmRes?.success && confirmRes?.result?.joined) {
          return { success: true, confirmed: true }
        }
        return { success: false, error: '已点击参与按钮但未检测到已参与状态' }
      }
      await this.sleep(400)
    }
    return { success: false, error: '未找到或无法点击参与按钮' }
  }

  isAttendSuccessLike(result) {
    if (!result) return false
    if (result.success === true) return true
    const text = [
      result?.error,
      result?.extra?.error_msg,
      result?.data?.toast,
      result?.data?.prompt
    ].filter(Boolean).join(' ')
    // 部分场景接口会提示重复参与，这本质上已在参与名单里
    return /已参与|已经参与|重复参与|请勿重复/.test(text)
  }

  async attendLotteryWithRetry(accountId, accountData, lotteryInfo, initialLotteryId) {
    let currentLotteryId = initialLotteryId
    let lastResult = null
    const delays = [0, 1200, 2200]

    for (let i = 0; i < delays.length; i++) {
      if (this.isPaused(accountId)) break
      if (delays[i] > 0) {
        accountData.callbacks.onLog(`🔁 接口参与重试(${i + 1}/${delays.length})，等待${delays[i]}ms...`)
        await this.sleep(delays[i])
      }

      // 每次重试前刷新 lottery_id，避免房间内福袋刷新导致旧ID失效
      if (i > 0) {
        const retryDetail = await ipcRenderer.invoke('get-lottery-detail', {
          roomId: lotteryInfo.roomId,
          webRid: lotteryInfo.webRid,
          accountId
        })
        if (retryDetail?.success && retryDetail?.lotteryDetail?.lottery_id) {
          currentLotteryId = retryDetail.lotteryDetail.lottery_id
        }
      }

      const result = await ipcRenderer.invoke('attend-lottery', {
        roomId: lotteryInfo.roomId,
        lotteryId: currentLotteryId,
        webRid: lotteryInfo.webRid,
        accountId
      })
      lastResult = result

      if (this.isAttendSuccessLike(result)) {
        const msg = i === 0 ? '🎁 接口参与成功' : `🎁 接口重试后参与成功(第${i + 1}次)`
        return { success: true, message: msg, raw: result }
      }

      const code = Number(result?.statusCode)
      // 10001 为典型时序问题，继续重试；其他错误也给到下一次机会
      if (code === 10001) {
        accountData.callbacks.onLog('⚠️ 接口返回10001（上下文或ID未就绪），继续重试...')
      }
    }

    return lastResult || { success: false, error: '参与失败' }
  }

  async autoJoinRedPacketLoop(accountId, accountData, rounds = 3) {
    for (let i = 0; i < rounds; i++) {
      if (!this.accounts.has(accountId) || this.isPaused(accountId)) return
      const result = await this.joinRedPacketByUI(accountId)
      if (result?.clickedCount > 0) {
        accountData.callbacks.onLog(`🧧 检测到红包入口并尝试领取 ${result.clickedCount} 次`)
      } else if (result?.skippedRestrictedCount > 0) {
        accountData.callbacks.onLog(`🚫 跳过 ${result.skippedRestrictedCount} 个仅会员/粉丝团可参与红包`)
      } else if (i === 0) {
        accountData.callbacks.onLog('🧧 当前直播间未检测到可抢红包入口')
      }
      await this.sleep(5000)
    }
  }

  async joinRedPacketByUI(accountId) {
    try {
      const res = await ipcRenderer.invoke('execute-script', {
        accountId,
        script: `
          (() => {
            let clickedCount = 0;
            let skippedRestrictedCount = 0;
            const restrictedRe = /(粉丝团|粉丝专属|仅粉丝|仅限粉丝|会员|主播会员|团员|加入粉丝团后可参与|会员可参与)/;

            const safeClick = (el) => {
              if (el && typeof el.click === 'function') {
                el.click();
                clickedCount++;
                return true;
              }
              return false;
            };

            const isRestricted = (el) => {
              try {
                const text = (
                  el?.innerText ||
                  el?.textContent ||
                  el?.closest?.('[class*="redpacket"],[class*="packet"],[class*="popup"],[class*="dialog"]')?.innerText ||
                  ''
                ).replace(/\\s+/g, ' ');
                return restrictedRe.test(text);
              } catch (_) {
                return false;
              }
            };

            // 方案1：直接点击短触红包入口
            const shortTouch = document.querySelector('.redpacket-short-touch');
            if (shortTouch) {
              if (isRestricted(shortTouch)) {
                skippedRestrictedCount++;
              } else if (safeClick(shortTouch)) {
                return { clickedCount, skippedRestrictedCount, mode: 'short-touch' };
              }
            }

            // 方案2：按超人福袋逻辑点击 iframe 内红包入口
            try {
              const iframeDoc = document.querySelector('.redpacket iframe')?.contentWindow?.document;
              const entry = iframeDoc?.querySelector('lynx-view')?.shadowRoot?.querySelector('.re-leftPart');
              if (entry) {
                if (isRestricted(entry)) skippedRestrictedCount++;
                else safeClick(entry);
              }
            } catch (_) {}

            // 方案3：批量扫描可抢红包按钮
            try {
              const iframeDoc2 = document.querySelector('#short_touch_land_redpacket_land iframe')?.contentWindow?.document;
              const list = iframeDoc2?.querySelector('lynx-view')?.shadowRoot?.querySelectorAll('lynx-wrapper > x-view') || [];
              list.forEach(item => {
                const canJoin = item
                  ?.querySelector('raw-text[text="0"]')
                  ?.closest('.scale_container')
                  ?.querySelector('.snatch_button_icon_container_exp');
                if (canJoin) {
                  if (isRestricted(item) || isRestricted(canJoin)) skippedRestrictedCount++;
                  else safeClick(canJoin);
                }
              });
            } catch (_) {}

            return {
              clickedCount,
              skippedRestrictedCount,
              mode: clickedCount > 0 ? 'iframe-scan' : (skippedRestrictedCount > 0 ? 'restricted-skip' : 'none')
            };
          })()
        `
      })
      if (res?.success && res?.result) return res.result
      return { clickedCount: 0, skippedRestrictedCount: 0, mode: 'script-failed' }
    } catch (_) {
      return { clickedCount: 0, skippedRestrictedCount: 0, mode: 'exception' }
    }
  }

  pauseAccount(accountId) {
    const accountData = this.accounts.get(accountId)
    if (accountData) {
      this.setPaused(accountId, true)
      this.clearAccountTimer(accountId)
      accountData.state = 'paused'
      accountData.callbacks.onStatusUpdate({ id: accountId, state: 'paused' })
    }
  }

  resumeAccount(accountId) {
    const accountData = this.accounts.get(accountId)
    if (accountData) {
      this.setPaused(accountId, false)
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
