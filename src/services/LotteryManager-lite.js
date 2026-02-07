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
  { id: '热门', name: '热门' },
  { id: '游戏', name: '游戏' },
  { id: '娱乐', name: '娱乐' },
  { id: '知识', name: '知识' },
  { id: '才艺', name: '才艺' },
  { id: '二次元', name: '二次元' },
  { id: '户外', name: '户外' },
  { id: '美食', name: '美食' }
]

class LotteryManager {
  constructor() {
    this.accounts = new Map()
    this.lotteryInfoList = [] // 全局福袋列表
    this.collectLoading = false // 是否正在收集福袋
    this.pauseCollect = false // 是否暂停收集
    
    // 默认为空数组（完全照搬原项目）
    // 用户可以通过 setCategoryList() 方法手动设置要扫描的分类
    this.categoryList = []
    
    // 扫描配置（参考原项目）
    this.scanConfig = {
      countPerPage: 15,  // 每页15个（原项目默认值）
      pagesPerCategory: 10  // 每个分类扫描10页（原项目默认值）
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
      participationCount: 0
    }
    
    this.accounts.set(account.id, accountData)
    
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

  /**
   * 统一搜索直播间（参考原项目）
   */
  async searchLiveRoom(accountId) {
    if (this.collectLoading) {
      return
    }
    
    const accountData = this.accounts.get(accountId)
    if (!accountData) return
    
    try {
      this.collectLoading = true
      accountData.callbacks.onLog('🔍 开始采集直播间福袋...')
      
      // 清空旧的福袋列表
      this.lotteryInfoList = []
      
      // 1. 先执行全部搜索（方法1）
      accountData.callbacks.onLog('【方法1】搜索全部直播间...')
      await this.searchLiveByAll(accountId)
      
      // 2. 再执行分类搜索（方法2）
      if (this.categoryList.length > 0) {
        accountData.callbacks.onLog('【方法2】按分类搜索直播间...')
        await this.startCollectLive(accountId)
      } else {
        accountData.callbacks.onLog('【方法2】未配置分类，跳过分类搜索')
      }
      
      // 3. 剔除过期和失效的福袋
      this.removeExpiredLotteries()
      
      // 4. 计算预测概率
      this.calculatePredictedProbabilities()
      
      // 5. 按开奖时间排序（最快开奖的在前）
      this.sortLotteriesByProbability()
      
      accountData.callbacks.onLog(`✅ 扫描完成，共收集到 ${this.lotteryInfoList.length} 个有效福袋`)
      
      // 6. 打印所有福袋详情
      this.printLotteryDetails(accountData)
      
      if (this.lotteryInfoList.length > 0) {
        // 开始参与
        setTimeout(() => this.start(accountId), 1000)
      } else {
        accountData.callbacks.onLog('⚠️ 没有符合条件的福袋，10秒后重新扫描...')
        setTimeout(() => this.searchLiveRoom(accountId), 10000)
      }
      
    } catch (error) {
      accountData.callbacks.onLog(`搜索失败: ${error.message}，10秒后重试...`, 'error')
      setTimeout(() => this.searchLiveRoom(accountId), 10000)
    } finally {
      this.collectLoading = false
    }
  }
  
  /**
   * 打印所有福袋详情和参与要求
   */
  printLotteryDetails(accountData) {
    if (this.lotteryInfoList.length === 0) {
      return
    }
    
    accountData.callbacks.onLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    accountData.callbacks.onLog(`📋 福袋列表 (共${this.lotteryInfoList.length}个，按开奖时间排序)`)
    accountData.callbacks.onLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    
    this.lotteryInfoList.forEach((lottery, index) => {
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
  removeExpiredLotteries() {
    const now = Date.now() / 1000 // 当前时间戳（秒）
    const beforeCount = this.lotteryInfoList.length
    
    this.lotteryInfoList = this.lotteryInfoList.filter(lottery => {
      // 检查是否有结束时间
      if (!lottery.end_time) {
        return false
      }
      
      // 检查是否已过期（结束时间 < 当前时间）
      if (lottery.end_time < now) {
        return false
      }
      
      // 检查是否即将过期（剩余时间 < 10秒）
      const remainingTime = lottery.end_time - now
      if (remainingTime < 10) {
        return false
      }
      
      // 检查是否有效（有参与人数和中奖人数）
      if (!lottery.joinTotal || !lottery.winningTotal) {
        return false
      }
      
      return true
    })
    
    const removedCount = beforeCount - this.lotteryInfoList.length
    if (removedCount > 0) {
      console.log(`🗑️ 已剔除 ${removedCount} 个过期/失效的福袋`)
    }
  }
  
  /**
   * 按中奖概率排序（从高到低）
   * 完全照搬原项目：按开奖时间升序排序（最快开奖的在前）
   */
  sortLotteriesByProbability() {
    this.lotteryInfoList.sort((a, b) => {
      const timeA = a.end_time || 0
      const timeB = b.end_time || 0
      return timeA - timeB  // 升序：最快开奖的在前
    })
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
  calculatePredictedProbabilities() {
    const now = Date.now() / 1000
    
    this.lotteryInfoList = this.lotteryInfoList.map(item => {
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
  }

  /**
   * 搜索直播间-【全部】（参考原项目）
   */
  async searchLiveByAll(accountId, times = 10) {
    const accountData = this.accounts.get(accountId)
    if (!accountData) return
    
    try {
      accountData.callbacks.onLog(`开始执行全部直播间搜索，共${times}次`)
      
      for (let i = 0; i < times; i++) {
        if (this.pauseCollect) break
        
        accountData.callbacks.onLog(`正在执行直播间第${i + 1}/${times}次搜索...`)
        
        try {
          // 调用API获取直播间列表
          const result = await ipcRenderer.invoke('search-live-by-all', { accountId })
          
          if (!result.success || !result.roomInfoList) {
            accountData.callbacks.onLog(`第${i + 1}次搜索失败: ${result.error || '未知错误'}`)
            continue
          }
          
          const roomInfoList = result.roomInfoList
          accountData.callbacks.onLog(`第${i + 1}次搜索: 发现${roomInfoList.length}个有福袋的直播间`)
          
          // 获取福袋详情（并发）
          const resList = await this.getLotteryInfo(roomInfoList, accountId)
          const validLotteryInfoList = resList.filter(item => item.status === 'fulfilled' && item.value).map(item => item.value)
          
          // 筛选符合条件的福袋
          const filteredList = this.filterLotteryByConditions(validLotteryInfoList)
          accountData.callbacks.onLog(`  符合条件的福袋数量: ${filteredList.length}`)
          
          // 添加到列表（去重）
          this.addLotteryInfoWithoutDuplicates(filteredList)
          
          // 随机延迟
          const randomDelay = Math.floor(Math.random() * 1000) + 500
          await this.sleep(randomDelay)
          
        } catch (error) {
          accountData.callbacks.onLog(`第${i + 1}次搜索出错: ${error.message}`)
        }
      }
    } catch (error) {
      accountData.callbacks.onLog(`全部搜索异常: ${error.message}`)
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
      accountData.callbacks.onLog(`开始按分类采集直播间，共${categories.length}个分类`)
      
      for (let i = 0; i < categories.length; i++) {
        if (this.pauseCollect) break
        
        const category = categories[i]
        accountData.callbacks.onLog(`正在采集【${category.name}】分类的直播间...`)
        
        try {
          const res = await this.searchLiveRoomCategory(accountId, {
            category_id: category.id,
            category_name: category.name,
            page: 10
          })
          
          const filteredList = this.filterLotteryByConditions(res)
          accountData.callbacks.onLog(
            `【${category.name}】分类: 发现${res.length}个有福袋的直播间, 符合条件: ${filteredList.length}`
          )
          
          this.addLotteryInfoWithoutDuplicates(filteredList)
          
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
  async searchLiveRoomCategory(accountId, { category_id, category_name, page = null }) {
    const accountData = this.accounts.get(accountId)
    if (!accountData) return []
    
    // 使用配置的页数
    const totalPages = page || this.scanConfig.pagesPerCategory
    const countPerPage = this.scanConfig.countPerPage
    
    const lotteryInfoList = []
    
    try {
      accountData.callbacks.onLog(`  正在搜索【${category_name}】分类，每页${countPerPage}个，共${totalPages}页`)
      
      for (let i = 0; i < totalPages; i++) {
        if (this.pauseCollect) break
        
        try {
          // 完全按照原项目的offset计算方式
          const result = await ipcRenderer.invoke('search-live-by-category', {
            accountId,
            categoryId: category_id,
            offset: (i + 1) * countPerPage,  // 原项目：(i + 1) * count
            count: countPerPage
          })
          
          if (!result.success || !result.roomInfoList) {
            continue
          }
          
          const roomInfoList = result.roomInfoList
          accountData.callbacks.onLog(`    第${i + 1}页: 发现${roomInfoList.length}个直播间`)
          
          // 延迟200ms
          await this.sleep(200)
          
          // 获取福袋详情（并发）
          const resList = await this.getLotteryInfo(roomInfoList, accountId)
          const validLotteryInfoList = resList.filter(item => item.status === 'fulfilled' && item.value).map(item => item.value)
          
          lotteryInfoList.push(...validLotteryInfoList)
          
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
    
    const promises = roomInfoList.map(async (roomInfo) => {
      try {
        const result = await ipcRenderer.invoke('get-lottery-detail', {
          roomId: roomInfo.roomId,
          accountId: accountId
        })
        
        if (!result.success || !result.lotteryDetail) {
          throw new Error(result.error || '福袋信息获取失败')
        }
        
        const lotteryInfo = {
          ...roomInfo,
          ...result.lotteryDetail,
          fetchedAt: Date.now()
        }
        
        return lotteryInfo
      } catch (error) {
        throw error
      }
    })
    
    return await Promise.allSettled(promises)
  }

  /**
   * 根据条件过滤福袋（优化版：只要包含类型3和6即可）
   */
  filterLotteryByConditions(lotteryList) {
    return lotteryList.filter((item) => {
      if (!item || !item.conditions || item.conditions.length === 0) {
        return false
      }
      
      // 检查是否包含类型3（发口令）和类型6（手动参与）
      const hasType3 = item.conditions.some(c => c.type === 3)
      const hasType6 = item.conditions.some(c => c.type === 6)
      
      // 只要同时包含这两个条件即可，不限制总条件数
      return hasType3 && hasType6
    })
  }

  /**
   * 添加福袋信息，避免重复（参考原项目）
   */
  addLotteryInfoWithoutDuplicates(newLotteryList) {
    const existingRoomIds = new Set(this.lotteryInfoList.map((item) => item.roomId))
    let addedCount = 0
    
    for (const lottery of newLotteryList) {
      if (lottery && !existingRoomIds.has(lottery.roomId)) {
        this.lotteryInfoList.push(lottery)
        existingRoomIds.add(lottery.roomId)
        addedCount++
      }
    }
    
    if (addedCount > 0) {
      console.log(`➕ 新增 ${addedCount} 个福袋`)
    }
  }

  async start(accountId) {
    const accountData = this.accounts.get(accountId)
    if (!accountData) return
    
    // 再次剔除过期福袋
    this.removeExpiredLotteries()
    
    const lotteryInfo = this.lotteryInfoList[0]
    
    if (!lotteryInfo) {
      accountData.state = 'waiting'
      accountData.callbacks.onLog(`📋 福袋池为空，10秒后重新扫描...`)
      accountData.callbacks.onStatusUpdate({ id: accountId, state: 'waiting' })
      
      // 等待10秒后重新扫描
      setTimeout(async () => {
        if (!this.collectLoading) {
          await this.searchLiveRoom(accountId)
        }
      }, 10000)
      return
    }
    
    // 检查福袋是否已结束
    const now = Date.now() / 1000
    if (lotteryInfo.end_time && lotteryInfo.end_time < now) {
      accountData.callbacks.onLog(`福袋已结束，清空福袋池并重新扫描...`)
      this.lotteryInfoList = [] // 清空福袋池
      setTimeout(() => this.start(accountId), 1000)
      return
    }
    
    // 检查剩余时间
    const remainingTime = lotteryInfo.end_time - now
    if (remainingTime < 10) {
      accountData.callbacks.onLog(`福袋即将结束（剩余${remainingTime.toFixed(0)}秒），清空福袋池并重新扫描...`)
      this.lotteryInfoList = [] // 清空福袋池
      setTimeout(() => this.start(accountId), 1000)
      return
    }
    
    accountData.state = 'running'
    const probability = this.calculateProbability(lotteryInfo)
    accountData.callbacks.onLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    accountData.callbacks.onLog(`🎯 选择最优福袋: ${lotteryInfo.authorNickname}`)
    accountData.callbacks.onLog(`   福袋: ${lotteryInfo.lotteryName}`)
    accountData.callbacks.onLog(`   当前概率: ${probability}%`)
    accountData.callbacks.onLog(`   剩余时间: ${remainingTime.toFixed(0)}秒`)
    accountData.callbacks.onLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    
    accountData.currentRoom = `${lotteryInfo.authorNickname}(${lotteryInfo.webRid})`
    accountData.callbacks.onStatusUpdate({ 
      id: accountId, 
      state: 'running',
      currentRoom: accountData.currentRoom 
    })
    
    // 前往直播间
    const gotoResult = await ipcRenderer.invoke('navigate-to', {
      accountId,
      url: `https://live.douyin.com/${lotteryInfo.webRid}`
    })
    
    if (!gotoResult.success) {
      accountData.callbacks.onLog(`❌ 导航失败: ${gotoResult.error}，清空福袋池并重新扫描`, 'error')
      this.lotteryInfoList = [] // 清空福袋池
      setTimeout(() => this.start(accountId), 2000)
      return
    }
    
    accountData.callbacks.onLog('✅ 已进入直播间，等待福袋出现...')
    
    // 等待并点击福袋
    setTimeout(async () => {
      try {
        // 尝试点击福袋
        await ipcRenderer.invoke('execute-script', {
          accountId,
          script: `
            (function() {
              const lotteryBtn = document.querySelector('.dVxrjT_h');
              if (lotteryBtn) {
                lotteryBtn.click();
                return true;
              }
              return false;
            })()
          `
        })
        
        accountData.callbacks.onLog('🎁 已点击福袋')
        
        // 等待2秒后点击参与按钮
        setTimeout(async () => {
          await ipcRenderer.invoke('execute-script', {
            accountId,
            script: `
              (function() {
                const joinBtn = document.querySelector('#lottery_close_cotainer div[role="button"]');
                if (joinBtn) {
                  joinBtn.click();
                  return true;
                }
                return false;
              })()
            `
          })
          
          accountData.callbacks.onLog('✅ 已参与福袋')
          accountData.participationCount++
          accountData.callbacks.onStatusUpdate({ 
            id: accountId, 
            participationCount: accountData.participationCount 
          })
          
          // 等待福袋结束时间 + 10秒
          const waitTime = (remainingTime + 10) * 1000
          accountData.callbacks.onLog(`⏱️ 等待福袋结束（${(waitTime/1000).toFixed(0)}秒）...`)
          
          setTimeout(() => {
            accountData.callbacks.onLog('✅ 福袋已结束')
            accountData.callbacks.onLog('🔄 清空福袋池，10秒后重新扫描...')
            
            // 清空整个福袋池
            this.lotteryInfoList = []
            
            // 10秒后重新扫描
            setTimeout(() => this.start(accountId), 10000)
          }, waitTime)
          
        }, 2000)
        
      } catch (error) {
        accountData.callbacks.onLog(`❌ 参与失败: ${error.message}`, 'error')
        accountData.callbacks.onLog('🔄 清空福袋池，重新扫描...')
        this.lotteryInfoList = [] // 清空福袋池
        setTimeout(() => this.start(accountId), 2000)
      }
    }, 3000)
  }

  pauseAccount(accountId) {
    const accountData = this.accounts.get(accountId)
    if (accountData) {
      accountData.state = 'paused'
      accountData.callbacks.onStatusUpdate({ id: accountId, state: 'paused' })
    }
  }

  resumeAccount(accountId) {
    const accountData = this.accounts.get(accountId)
    if (accountData) {
      accountData.state = 'running'
      accountData.callbacks.onStatusUpdate({ id: accountId, state: 'running' })
      this.start(accountId)
    }
  }

  async stopAccount(accountId) {
    await ipcRenderer.invoke('close-browser', accountId)
    this.accounts.delete(accountId)
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

export default LotteryManager
