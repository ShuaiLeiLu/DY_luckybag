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

// 奖品类型映射
const prizeType = {
  1: "钻石",
  2: "抖币",
  3: "实物",
  4: "优惠券"
}

class LotteryManager {
  constructor() {
    this.accounts = new Map()
    this.lotteryInfoList = [] // 全局福袋列表
    this.collectLoading = false // 是否正在收集福袋
    
    // 监听网络响应
    if (ipcRenderer) {
      ipcRenderer.on('network-response', (event, { accountId, url, data }) => {
        this.handleNetworkResponse(accountId, url, data)
      })
    }
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
      lotteryTimer: null,
      browserLaunched: false,
      pauseJoinLottery: false,
      retryCount: 0,
      maxRetries: 3,
      retryDelay: 200,
      lastWinLotteryId: null,
      tokenInfo: null
    }
    
    this.accounts.set(account.id, accountData)
    
    // 启动浏览器
    const result = await ipcRenderer.invoke('launch-browser', account.id)
    if (!result.success) {
      callbacks.onLog(`启动浏览器失败: ${result.error}`, 'error')
      return
    }
    
    accountData.browserLaunched = true
    accountData.state = 'opened'
    accountData.startTime = Date.now()
    callbacks.onLog(`浏览器已启动`)
    
    // 设置请求监听
    await ipcRenderer.invoke('setup-request-listener', account.id)
    
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
          state: 'opened',
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
    
    // 没有本地Token或加载失败，需要手动登录
    callbacks.onLog(`未找到本地Token，请手动登录`)
    
    // 导航到抖音
    await ipcRenderer.invoke('navigate-to', {
      accountId: account.id,
      url: 'https://www.douyin.com'
    })
    
    callbacks.onLog(`请在浏览器中登录抖音账号`)
    callbacks.onStatusUpdate({ id: account.id, state: 'opened' })
    
    // 定期检查登录状态
    this.checkLoginStatus(account.id)
  }

  /**
   * 检查登录状态并获取token
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
        accountData.callbacks.onLog(`SessionID: ${result.tokenInfo.sessionid || result.tokenInfo.sessionid_ss}`)
        
        // 保存Token到本地
        await ipcRenderer.invoke('save-token', {
          accountId,
          tokenInfo: result.tokenInfo
        })
        accountData.callbacks.onLog(`💾 Token已保存到本地`)
        
        // 更新账号状态，显示token信息
        accountData.callbacks.onStatusUpdate({ 
          id: accountId, 
          state: 'opened',
          token: result.tokenInfo.sessionid || result.tokenInfo.sessionid_ss
        })
        
        // 等待2秒后开始监控
        setTimeout(() => {
          this.startMonitoring(accountId)
        }, 2000)
      }
    }, 3000) // 每3秒检查一次
    
    // 60秒后停止检查
    setTimeout(() => {
      clearInterval(checkInterval)
    }, 60000)
  }

  async startMonitoring(accountId) {
    const accountData = this.accounts.get(accountId)
    if (!accountData) return
    
    accountData.callbacks.onLog(`开始监控福袋信息`)
    
    // 开始福袋参与流程
    this.start(accountId)
  }

  /**
   * 核心方法：启动福袋参与流程
   * 参考原项目的 start 方法
   */
  async start(accountId) {
    const accountData = this.accounts.get(accountId)
    if (!accountData) return
    
    try {
      accountData.state = 'running'
      
      // 清除之前的定时器
      if (accountData.lotteryTimer) {
        clearTimeout(accountData.lotteryTimer)
        accountData.lotteryTimer = null
      }
      
      // 检查是否暂停
      if (accountData.pauseJoinLottery) {
        accountData.state = 'paused'
        return
      }
      
      accountData.retryCount = 0
      
      // 选择合适的福袋（已经按概率排序，直接取第一个）
      const lotteryInfo = this.lotteryInfoList[0]
      
      if (!lotteryInfo) {
        accountData.state = 'waiting'
        accountData.callbacks.onLog(`暂无合适的福袋，开始收集...`)
        accountData.callbacks.onStatusUpdate({ id: accountId, state: 'waiting' })
        
        // 开始收集福袋
        if (!this.collectLoading) {
          await this.startCollect(accountId)
        }
        return
      }
      
      // 检查福袋是否已结束
      if (lotteryInfo.end_time && lotteryInfo.end_time < Date.now() / 1000) {
        accountData.callbacks.onLog(`福袋已结束，寻找下一个...`)
        this.lotteryInfoList.shift() // 移除第一个
        setTimeout(() => this.start(accountId), 1000)
        return
      }
      
      accountData.state = 'running'
      const probability = ((lotteryInfo.winningTotal / lotteryInfo.joinTotal) * 100).toFixed(2)
      accountData.callbacks.onLog(`准备前往 ${lotteryInfo.authorNickname} 直播间 (概率${probability}%)`)
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
        accountData.callbacks.onLog(`导航失败: ${gotoResult.error}，跳过此直播间`, 'error')
        // 从列表中移除失败的
        this.lotteryInfoList.shift()
        // 继续下一个
        setTimeout(() => this.start(accountId), 2000)
        return
      }
      
      accountData.callbacks.onLog('等待福袋出现...')
      
      // 等待并点击福袋
      await this.waitAndClickLottery(accountId, lotteryInfo)
      
      // 参与成功
      const remainingTime = lotteryInfo.end_time - Date.now() / 1000
      accountData.participationCount++
      accountData.callbacks.onLog(`✅ 福袋参与成功，等待开奖`, 'success')
      accountData.callbacks.onStatusUpdate({ 
        id: accountId, 
        participationCount: accountData.participationCount 
      })
      
      // 抢红包
      if (accountData.config.enableRedPacket) {
        await this.joinRedPacket(accountId)
      }
      
      // 优化直播体验
      await this.optimizeLiveExperience(accountId)
      
      // 等待开奖时间 + 30秒
      const totalWaitTime = Math.max(1000, (remainingTime + 30) * 1000)
      accountData.callbacks.onLog(`等待 ${Math.floor(totalWaitTime / 1000)} 秒后继续...`)
      
      accountData.lotteryTimer = setTimeout(() => {
        this.start(accountId)
      }, totalWaitTime)
      
    } catch (error) {
      accountData.callbacks.onLog(`错误: ${error.message}`, 'error')
      
      if (accountData.lotteryTimer) {
        clearTimeout(accountData.lotteryTimer)
        accountData.lotteryTimer = null
      }
      
      // 3秒后重试
      setTimeout(() => this.start(accountId), 3000)
    }
  }

  /**
   * 等待并点击福袋
   */
  async waitAndClickLottery(accountId, lotteryInfo) {
    const accountData = this.accounts.get(accountId)
    if (!accountData) return
    
    // 等待福袋元素出现（20秒超时）
    const waitResult = await ipcRenderer.invoke('wait-for-element', {
      accountId,
      selector: '.dVxrjT_h',
      timeout: 20000
    })
    
    if (!waitResult.success) {
      throw new Error('福袋元素未找到')
    }
    
    // 点击福袋
    await ipcRenderer.invoke('click-element', {
      accountId,
      selector: '.dVxrjT_h'
    })
    
    await this.sleep(2000)
    
    // 二次检查概率（如果启用）
    if (accountData.config.minProbability && accountData.config.minProbability > 0) {
      const probability = lotteryInfo.winningTotal / lotteryInfo.joinTotal
      if (probability < accountData.config.minProbability) {
        throw new Error('二次检查概率不满足')
      }
    }
    
    // 点击参与按钮
    await ipcRenderer.invoke('click-element', {
      accountId,
      selector: '#lottery_close_cotainer div[role="button"]'
    })
  }

  /**
   * 选择合适的福袋
   * 参考原项目的 selectLotteryInfo 方法
   */
  selectLotteryInfo(config) {
    if (this.lotteryInfoList.length === 0) {
      return null
    }
    
    // 筛选符合条件的福袋
    const validLotteries = this.lotteryInfoList.filter(lottery => {
      // 跳过需要获取详情的福袋
      if (lottery.needFetchDetail || !lottery.lottery_id) {
        return false
      }
      
      // 检查是否已结束
      if (lottery.end_time && lottery.end_time < Date.now() / 1000) {
        return false
      }
      
      // 检查在线人数
      if (config.minOnline && lottery.onlineUserCount < config.minOnline) {
        return false
      }
      
      // 检查中奖概率
      if (config.minProbability && lottery.joinTotal && lottery.winningTotal) {
        const probability = lottery.winningTotal / lottery.joinTotal
        if (probability < config.minProbability) {
          return false
        }
      }
      
      return true
    })
    
    if (validLotteries.length === 0) {
      return null
    }
    
    // 按中奖概率排序，选择概率最高的
    validLotteries.sort((a, b) => {
      const probA = a.winningTotal / a.joinTotal
      const probB = b.winningTotal / b.joinTotal
      return probB - probA
    })
    
    return validLotteries[0]
  }

  /**
   * 开始收集福袋
   * 参考原项目的 startCollect 方法
   */
  async startCollect(accountId) {
    if (this.collectLoading) return
    
    const accountData = this.accounts.get(accountId)
    if (!accountData) return
    
    this.collectLoading = true
    accountData.callbacks.onLog('🔍 开始收集全网福袋...', 'info')
    
    try {
      const allLotteryDetails = []
      const seenRoomIds = new Set()

      // 借鉴原扩展：两种方法扫描，提升覆盖率与多样性
      const scanTimes = 10
      const categories = [
        { id: '0', name: '热门' },
        { id: '1', name: '游戏' },
        { id: '2', name: '娱乐' }
      ]

      accountData.callbacks.onLog(`将使用两种方法扫描福袋（方法1×${scanTimes}次 + 方法2×${categories.length}类）`)

      // 方法1：反复调用 /webcast/feed/，利用“推荐流多样性”拿更多直播间
      for (let i = 0; i < scanTimes; i++) {
        accountData.callbacks.onLog(`[方法1] 第 ${i + 1}/${scanTimes} 次扫描中...`)

        const result = await ipcRenderer.invoke('collect-lotteries', { accountId })
        if (!result?.success) {
          accountData.callbacks.onLog(`[方法1] 扫描失败: ${result?.error || '未知错误'}`)
          continue
        }

        const roomsWithLottery = result.lotteries || []
        accountData.callbacks.onLog(`[方法1] 发现 ${roomsWithLottery.length} 个可能有福袋的直播间`)

        for (const room of roomsWithLottery) {
          if (!room?.roomId || seenRoomIds.has(room.roomId)) continue
          seenRoomIds.add(room.roomId)

          try {
            const detailResult = await ipcRenderer.invoke('get-lottery-detail', {
              roomId: room.roomId,
              accountId
            })

            if (detailResult?.success && detailResult.lotteryDetail) {
              const fullLotteryInfo = { ...room, ...detailResult.lotteryDetail }
              allLotteryDetails.push(fullLotteryInfo)

              const probability = fullLotteryInfo.joinTotal > 0
                ? ((fullLotteryInfo.winningTotal / fullLotteryInfo.joinTotal) * 100).toFixed(2)
                : '0.00'
              accountData.callbacks.onLog(
                `  ✅ ${room.authorNickname} - ${fullLotteryInfo.prize_name} - 概率${probability}% (${fullLotteryInfo.winningTotal}/${fullLotteryInfo.joinTotal})`
              )
            } else {
              const reason = detailResult?.error || '不符合条件/无福袋详情'
              accountData.callbacks.onLog(`  ⚠️ ${room.authorNickname} - ${reason}`)
            }
          } catch (e) {
            // 忽略单个直播间失败
          }

          await this.sleep(200) // 避免过快
        }

        // 随机延迟，避免每次请求结果高度相同
        if (i < scanTimes - 1) {
          const delay = Math.floor(Math.random() * 1000) + 500
          await this.sleep(delay)
        }
      }

      // 方法2：按分类分页扫（/partition/detail/room/v2），补齐方法1扫不到的直播间
      for (const category of categories) {
        accountData.callbacks.onLog(`[方法2] 扫描【${category.name}】分类...`)

        for (let page = 0; page < 10; page++) {
          const result = await ipcRenderer.invoke('collect-lotteries-by-category', {
            categoryId: category.id,
            offset: page * 15,
            accountId
          })

          if (!result?.success) continue

          const roomsWithLottery = result.lotteries || []
          accountData.callbacks.onLog(`  【${category.name}】第${page + 1}页: ${roomsWithLottery.length} 个可能有福袋的直播间`)

          for (const room of roomsWithLottery) {
            if (!room?.roomId || seenRoomIds.has(room.roomId)) continue
            seenRoomIds.add(room.roomId)

            try {
              const detailResult = await ipcRenderer.invoke('get-lottery-detail', {
                roomId: room.roomId,
                accountId
              })

              if (detailResult?.success && detailResult.lotteryDetail) {
                const fullLotteryInfo = { ...room, ...detailResult.lotteryDetail }
                allLotteryDetails.push(fullLotteryInfo)

                const probability = fullLotteryInfo.joinTotal > 0
                  ? ((fullLotteryInfo.winningTotal / fullLotteryInfo.joinTotal) * 100).toFixed(2)
                  : '0.00'
                accountData.callbacks.onLog(
                  `    ✅ ${room.authorNickname} - ${fullLotteryInfo.prize_name} - 概率${probability}%`
                )
              }
            } catch (e) {
              // 跳过
            }

            await this.sleep(200)
          }

          await this.sleep(500)
        }

        await this.sleep(1000)
      }

      accountData.callbacks.onLog(`扫描完成，共收集到 ${allLotteryDetails.length} 个福袋详情`)

      if (allLotteryDetails.length === 0) {
        accountData.callbacks.onLog('⚠️ 未获取到有效福袋详情，10秒后重试...')
        setTimeout(() => this.startCollect(accountId), 10000)
        return
      }

      const nowSec = Date.now() / 1000

      // 筛选：未结束 + 在线人数 + 概率阈值 + joinTotal 合法
      const validLotteries = allLotteryDetails.filter(lottery => {
        if (!lottery) return false
        if (typeof lottery.end_time !== 'number') return false
        // 给 15 秒缓冲，避免“刚进房就开奖”
        if (lottery.end_time - 15 < nowSec) return false

        // 在线人数下限
        if (accountData.config.minOnline && (lottery.onlineUserCount || 0) < accountData.config.minOnline) {
          return false
        }

        // 概率下限（避免 0/0 / NaN）
        const joinTotal = Number(lottery.joinTotal || 0)
        const winningTotal = Number(lottery.winningTotal || 0)
        if (joinTotal <= 0 || winningTotal <= 0) return false

        if (accountData.config.minProbability) {
          const probability = winningTotal / joinTotal
          if (probability < accountData.config.minProbability) return false
        }

        return true
      })

      validLotteries.sort((a, b) => {
        const probA = (a.winningTotal || 0) / (a.joinTotal || 1)
        const probB = (b.winningTotal || 0) / (b.joinTotal || 1)
        return probB - probA
      })

      this.lotteryInfoList = validLotteries

      accountData.callbacks.onLog(`✅ 筛选出 ${validLotteries.length} 个符合条件的福袋`, 'success')

      if (validLotteries.length > 0) {
        validLotteries.slice(0, 5).forEach((lottery, index) => {
          const probability = ((lottery.winningTotal / lottery.joinTotal) * 100).toFixed(2)
          accountData.callbacks.onLog(`${index + 1}. ${lottery.authorNickname} - ${lottery.prize_name} - 概率${probability}%`)
        })

        setTimeout(() => this.start(accountId), 1000)
      } else {
        accountData.callbacks.onLog('⚠️ 没有符合条件的福袋，10秒后重新扫描...')
        setTimeout(() => this.startCollect(accountId), 10000)
      }
      
    } catch (error) {
      accountData.callbacks.onLog(`收集失败: ${error.message}，10秒后重试...`, 'error')
      setTimeout(() => this.startCollect(accountId), 10000)
    } finally {
      this.collectLoading = false
    }
  }

  /**
   * 抢红包
   */
  async joinRedPacket(accountId) {
    try {
      const result = await ipcRenderer.invoke('wait-for-element', {
        accountId,
        selector: '.redpacket-short-touch',
        timeout: 5000
      })
      
      if (!result.success) return
      
      await ipcRenderer.invoke('evaluate-script', {
        accountId,
        script: `
          (() => {
            try {
              document.querySelector('.redpacket iframe').contentWindow.document.querySelector('lynx-view').shadowRoot.querySelector('.re-leftPart').click()
            } catch (e) {}
          })()
        `
      })
      
      await this.sleep(2000)
      
      await ipcRenderer.invoke('evaluate-script', {
        accountId,
        script: `
          (() => {
            try {
              const redPacketDomList = document.querySelector('#short_touch_land_redpacket_land iframe').contentWindow.document.querySelector('lynx-view').shadowRoot.querySelectorAll('lynx-wrapper > x-view')
              redPacketDomList.forEach(item => {
                const canJoin = item.querySelector('raw-text[text="0"]')?.closest('.scale_container')?.querySelector('.snatch_button_icon_container_exp')
                canJoin && canJoin.click()
              })
            } catch (e) {}
          })()
        `
      })
    } catch (error) {
      // 红包失败不影响主流程
    }
  }

  /**
   * 优化直播体验
   */
  async optimizeLiveExperience(accountId) {
    try {
      await ipcRenderer.invoke('evaluate-script', {
        accountId,
        script: `
          (() => {
            try {
              // 设置清晰度为最低
              const qualitySelectorDom = document.querySelector('div[data-e2e="quality-selector"]')
              if (qualitySelectorDom && qualitySelectorDom.lastChild && qualitySelectorDom.lastChild.firstChild) {
                if (!qualitySelectorDom.lastChild.firstChild.style.background) {
                  qualitySelectorDom.lastChild.click()
                }
              }
              
              // 屏蔽礼物特效
              const effectSwitchDom = document.querySelector('div[data-e2e="effect-switch"]')
              if (effectSwitchDom && effectSwitchDom.previousElementSibling) {
                if (effectSwitchDom.previousElementSibling.textContent === '屏蔽礼物特效') {
                  effectSwitchDom.click()
                }
              }
            } catch (error) {}
          })()
        `
      })
      
      // 按B键隐藏聊天
      await ipcRenderer.invoke('evaluate-script', {
        accountId,
        script: `
          (() => {
            const event = new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', keyCode: 66 })
            document.dispatchEvent(event)
          })()
        `
      })
      
      await this.sleep(1000)
    } catch (error) {
      // 优化失败不影响主流程
    }
  }

  /**
   * 处理网络响应
   */
  handleNetworkResponse(accountId, url, data) {
    const accountData = this.accounts.get(accountId)
    if (!accountData) return
    
    try {
      // 处理福袋检查响应
      if (url.includes('webcast/lottery/melon/check_user_right')) {
        this.handleLotteryResponse(accountData, data)
      }
      
      // 处理钱包信息
      if (url.includes('/webcast/wallet/info/')) {
        if (data?.data?.diamond !== undefined) {
          accountData.walletDiamonds = data.data.diamond
          accountData.callbacks.onStatusUpdate({
            id: accountId,
            walletDiamonds: data.data.diamond
          })
        }
      }
      
      // 处理红包中奖
      if (url.includes('webcast/luckybox/receive')) {
        this.handleRedPacketResponse(accountData, data)
      }
    } catch (error) {
      console.error('处理网络响应失败:', error)
    }
  }

  /**
   * 处理福袋响应
   */
  handleLotteryResponse(accountData, data) {
    if (!data?.data?.lottery_info) return
    
    const lotteryInfo = data.data.lottery_info
    
    // 状态1：未开奖
    if (lotteryInfo.status === 1) {
      // 更新参与人数
      if (data.data.candidate_user_num !== undefined) {
        const lottery = this.lotteryInfoList.find(item => item.roomId == lotteryInfo.room_id_str)
        if (lottery) {
          lottery.joinTotal = data.data.candidate_user_num
        }
      }
    }
    // 状态2：已开奖
    else if (lotteryInfo.status === 2) {
      if (data.data.user_lucky_info) {
        this.handleWinningResult(accountData, data)
      }
    }
  }

  /**
   * 处理中奖结果
   */
  handleWinningResult(accountData, data) {
    try {
      const user_lucky_info = data.data.user_lucky_info
      const lotteryId = data.data.lottery_info.lottery_id_str
      const prizeName = prizeType[user_lucky_info.prize_type] || "未知奖品"
      
      // 防止重复处理
      if (accountData.lastWinLotteryId === lotteryId) {
        return
      }
      
      accountData.lastWinLotteryId = lotteryId
      accountData.winningCount++
      accountData.totalDiamonds += user_lucky_info.grant_count
      
      accountData.callbacks.onLog(
        `🎉 中奖啦！获得【${prizeName}】x ${user_lucky_info.grant_count}`,
        'success'
      )
      
      accountData.callbacks.onStatusUpdate({
        id: accountData.id,
        winningCount: accountData.winningCount,
        totalDiamonds: accountData.totalDiamonds
      })
    } catch (error) {
      console.error('处理中奖结果失败:', error)
    }
  }

  /**
   * 处理红包中奖
   */
  handleRedPacketResponse(accountData, data) {
    if (!data?.data?.receive_info) return
    
    data.data.receive_info.forEach(item => {
      if (item.succeed) {
        accountData.redPacketWinningCount = (accountData.redPacketWinningCount || 0) + 1
        accountData.totalDiamonds += item.diamond_count
        
        const giftName = item.gift_name || '钻石'
        accountData.callbacks.onLog(
          `🧧 红包中奖！获得【${giftName}】x ${item.diamond_count}`,
          'success'
        )
        
        accountData.callbacks.onStatusUpdate({
          id: accountData.id,
          totalDiamonds: accountData.totalDiamonds
        })
      }
    })
  }

  pauseAccount(accountId) {
    const accountData = this.accounts.get(accountId)
    if (!accountData) return
    
    if (accountData.lotteryTimer) {
      clearTimeout(accountData.lotteryTimer)
      accountData.lotteryTimer = null
    }
    
    accountData.pauseJoinLottery = true
    accountData.state = 'paused'
    accountData.callbacks.onStatusUpdate({ id: accountId, state: 'paused' })
  }

  resumeAccount(accountId) {
    const accountData = this.accounts.get(accountId)
    if (!accountData) return
    
    accountData.pauseJoinLottery = false
    accountData.state = 'running'
    this.start(accountId)
  }

  async stopAccount(accountId) {
    const accountData = this.accounts.get(accountId)
    if (!accountData) return
    
    if (accountData.lotteryTimer) {
      clearTimeout(accountData.lotteryTimer)
    }
    
    if (accountData.browserLaunched) {
      await ipcRenderer.invoke('close-browser', accountId)
    }
    
    this.accounts.delete(accountId)
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

export default LotteryManager
