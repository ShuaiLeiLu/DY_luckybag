const { log } = require('console')
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { chromium } = require('playwright')
const { douyinLiveRemote } = require('./douyinLiveRemote')

let mainWindow
let browsers = new Map() // 存储多个浏览器实例

/**
 * getCookieStringByAccountId 方法：获取Cookie字符串账号标识。
 */
async function getCookieStringByAccountId(accountId) {
  if (!accountId) return ''
  const browserData = browsers.get(accountId)
  if (!browserData) return ''

  try {
    const cookies = await browserData.context.cookies()
    return cookies.map(c => `${c.name}=${c.value}`).join('; ')
  } catch (e) {
    return ''
  }
}

/**
 * createWindow 方法：创建窗口配置。
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  // 开发环境加载 Vite 服务器
  const isDev = !app.isPackaged
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    // mainWindow.webContents.openDevTools() // 已禁用：不需要自动打开控制台
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// IPC 通信处理
ipcMain.handle('launch-browser', async (event, accountId) => {
  try {
    const browser = await chromium.launch({
      headless: false,
      args: ['--start-maximized']
    })
    const context = await browser.newContext({
      viewport: null,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    })
    const page = await context.newPage()
    
    browsers.set(accountId, { browser, context, page })
    
    return { success: true, accountId }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 获取登录token
ipcMain.handle('get-login-token', async (event, accountId) => {
  try {
    const browserData = browsers.get(accountId)
    if (!browserData) {
      throw new Error('浏览器实例不存在')
    }
    
    // 获取所有cookies
    const cookies = await browserData.context.cookies()
    
    // 提取关键token信息
    const tokenInfo = {
      sessionid: '',
      sessionid_ss: '',
      ttwid: '',
      passport_csrf_token: '',
      odin_tt: '',
      __ac_nonce: '',
      __ac_signature: ''
    }
    
    cookies.forEach(cookie => {
      if (tokenInfo.hasOwnProperty(cookie.name)) {
        tokenInfo[cookie.name] = cookie.value
      }
    })
    
    // 检查是否已登录（sessionid存在表示已登录）
    const isLoggedIn = !!tokenInfo.sessionid || !!tokenInfo.sessionid_ss
    
    return { 
      success: true, 
      isLoggedIn,
      tokenInfo,
      cookieCount: cookies.length
    }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('navigate-to', async (event, { accountId, url }) => {
  try {
    const browserData = browsers.get(accountId)
    if (!browserData) {
      throw new Error('浏览器实例不存在')
    }
    
    // 使用更宽松的等待策略，避免超时
    await browserData.page.goto(url, { 
      waitUntil: 'domcontentloaded',  // 改为domcontentloaded，更快
      timeout: 15000  // 15秒超时
    })
    return { success: true }
  } catch (error) {
    console.error('导航失败:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('click-element', async (event, { accountId, selector }) => {
  try {
    const browserData = browsers.get(accountId)
    if (!browserData) {
      throw new Error('浏览器实例不存在')
    }
    
    await browserData.page.click(selector)
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('wait-for-element', async (event, { accountId, selector, timeout = 30000 }) => {
  try {
    const browserData = browsers.get(accountId)
    if (!browserData) {
      throw new Error('浏览器实例不存在')
    }
    
    await browserData.page.waitForSelector(selector, { timeout })
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('evaluate-script', async (event, { accountId, script }) => {
  try {
    const browserData = browsers.get(accountId)
    if (!browserData) {
      throw new Error('浏览器实例不存在')
    }
    
    const result = await browserData.page.evaluate(script)
    return { success: true, result }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('close-browser', async (event, accountId) => {
  try {
    const browserData = browsers.get(accountId)
    if (browserData) {
      await browserData.browser.close()
      browsers.delete(accountId)
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 收集福袋信息的 IPC 处理
ipcMain.handle('collect-lotteries', async (event, { accountId } = {}) => {
  try {
    const cookieString = await getCookieStringByAccountId(accountId)

    // 借鉴原项目：/webcast/feed/ 扫热门推荐直播间
    const params = {
      live_id: '1',
      enter_from: 'page_refresh',
      request_tag_from: 'web',
      need_map: '1',
      liveid: '1',
      is_draw: '1',
      inner_from_drawer: '0',
      custom_count: '8',
      action: 'load_more',
      action_type: 'loadmore',
      enter_source: 'web_homepage_hot_web_live_card',
      source_key: 'web_homepage_hot_web_live_card'
    }

    const json = await douyinLiveRemote('/webcast/feed/', params, {
      cookie: cookieString
    })

    const lotteries = []
    if (json?.data && Array.isArray(json.data)) {
      // 借鉴扩展：更宽松筛选（benefit_point_data 存在即可，或 has_ongoing_lottery 为 true）
      const roomsWithLottery = json.data.filter(item => {
        const benefitData = item?.data?.others?.web_enter_benefit_point_data
        return benefitData && (benefitData.has_ongoing_lottery === true || benefitData.has_ongoing_lottery === undefined)
      })

      for (const room of roomsWithLottery) {
        const roomData = room.data
        if (roomData?.id_str) {
          lotteries.push({
            roomId: roomData.id_str,
            webRid: room.web_rid,
            roomTitle: roomData.title || '未知标题',
            authorNickname: roomData.owner?.nickname || '未知主播',
            authorSecUid: roomData.owner?.sec_uid || '',
            onlineUserCount: parseInt(roomData.user_count_str) || parseInt(roomData.user_count) || 0
          })
        }
      }
    }

    return { success: true, lotteries, total: lotteries.length }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 收集福袋信息 - 方法2：按分类扫描（借鉴原项目）
ipcMain.handle('collect-lotteries-by-category', async (event, { categoryId = '0', offset = 0, accountId } = {}) => {
  try {
    const cookieString = await getCookieStringByAccountId(accountId)
    const params = {
      live_id: '1',
      enter_from: 'page_refresh',
      count: '15',
      offset: String(offset),
      partition: String(categoryId),
      partition_type: '4',
      req_from: '2'
    }

    const json = await douyinLiveRemote('/webcast/web/partition/detail/room/v2/', params, {
      cookie: cookieString,
      // 覆盖 referer，让请求更贴近 live 站点
      referer: 'https://live.douyin.com/'
    })

    const lotteries = []
    const list = json?.data?.data
    if (Array.isArray(list)) {
      const roomsWithLottery = list.filter(item => item?.room?.others?.web_enter_benefit_point_data?.has_ongoing_lottery)
      for (const item of roomsWithLottery) {
        const room = item.room
        if (room?.id_str) {
          lotteries.push({
            roomId: room.id_str,
            webRid: item.web_rid,
            roomTitle: room.title || '未知标题',
            authorNickname: room.owner?.nickname || '未知主播',
            authorSecUid: room.owner?.sec_uid || '',
            onlineUserCount: parseInt(room.user_count) || 0
          })
        }
      }
    }

    return { success: true, lotteries, total: lotteries.length }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 获取单个直播间的福袋详情
ipcMain.handle('get-lottery-detail', async (event, { roomId, accountId } = {}) => {
  try {
    if (!roomId) {
      return { success: false, error: 'roomId 不能为空' }
    }

    const cookieString = await getCookieStringByAccountId(accountId)

    const params = {
      live_id: '1',
      enter_from: 'link_share',
      room_id: roomId,
      query_from: '1'
    }

    const json = await douyinLiveRemote('/webcast/lottery/melon/lottery_info/', params, {
      cookie: cookieString,
      referer: `https://live.douyin.com/${roomId}`
    })

    if (!json?.data?.lottery_info) {
      return { success: false, error: '福袋信息不存在' }
    }

    const lottery_info = json.data.lottery_info
    const conditions = lottery_info.conditions || []

    // 借鉴原扩展：只保留“口令 + 手动参与”的福袋（避免关注/团任务等导致无法自动参与）
    const hasValidConditions =
      conditions.length === 2 &&
      conditions[0]?.type === 3 && // 发口令
      conditions[1]?.type === 6 // 手动参与

    if (!hasValidConditions) {
      return { success: false, error: `福袋条件不符合(${conditions.map(c => c.type).join(',')})` }
    }

    const lotteryDetail = {
      lottery_id: lottery_info.lottery_id_str,
      anchorId: lottery_info.anchor_id,
      joinTotal: lottery_info.candidate_num || 0,
      winningTotal: lottery_info.lucky_count || 0,
      lotteryTotal: lottery_info.prize_count || 0,
      prize_name: lottery_info.prize_info?.name || '未知奖品',
      start_time: lottery_info.start_time,
      end_time: lottery_info.draw_time,
      conditions
    }

    return { success: true, lotteryDetail }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 设置网络请求监听
ipcMain.handle('setup-request-listener', async (event, accountId) => {
  try {
    const browserData = browsers.get(accountId)
    if (!browserData) {
      throw new Error('浏览器实例不存在')
    }
    
    browserData.page.on('response', async (response) => {
      const url = response.url()
      
      // 监听福袋相关接口
      if (url.includes('webcast/lottery/melon/check_user_right') ||
          url.includes('webcast/wallet/info') ||
          url.includes('webcast/luckybox/receive')) {
        try {
          const json = await response.json()
          mainWindow.webContents.send('network-response', {
            accountId,
            url,
            data: json
          })
        } catch (e) {
          // 忽略非 JSON 响应
        }
      }
    })
    
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 获取页面中的福袋信息
ipcMain.handle('get-lottery-info', async (event, accountId) => {
  try {
    const browserData = browsers.get(accountId)
    if (!browserData) {
      throw new Error('浏览器实例不存在')
    }
    
    // 在页面中执行脚本获取福袋信息
    const lotteryInfo = await browserData.page.evaluate(() => {
      try {
        // 尝试从页面中获取福袋信息
        const lotteryElement = document.querySelector('.dVxrjT_h')
        if (!lotteryElement) {
          return null
        }
        
        // 这里需要根据实际页面结构提取信息
        // 暂时返回基本信息
        return {
          found: true
        }
      } catch (e) {
        return null
      }
    })
    
    return { success: true, lotteryInfo }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// Token本地存储
const fs = require('fs')
const os = require('os')
const tokenStorePath = path.join(os.homedir(), '.douyin-lottery-tokens.json')

// 保存Token到本地
ipcMain.handle('save-token', async (event, { accountId, tokenInfo }) => {
  try {
    let tokens = {}
    
    // 读取现有tokens
    if (fs.existsSync(tokenStorePath)) {
      const data = fs.readFileSync(tokenStorePath, 'utf8')
      tokens = JSON.parse(data)
    }
    
    // 保存新token
    tokens[accountId] = {
      ...tokenInfo,
      savedAt: Date.now()
    }
    
    fs.writeFileSync(tokenStorePath, JSON.stringify(tokens, null, 2))
    console.log(`Token已保存: ${accountId}`)
    
    return { success: true }
  } catch (error) {
    console.error('保存Token失败:', error)
    return { success: false, error: error.message }
  }
})

// 从本地加载Token
ipcMain.handle('load-token', async (event, accountId) => {
  try {
    if (!fs.existsSync(tokenStorePath)) {
      return { success: false, error: 'Token文件不存在' }
    }
    
    const data = fs.readFileSync(tokenStorePath, 'utf8')
    const tokens = JSON.parse(data)
    
    if (!tokens[accountId]) {
      return { success: false, error: '该账号Token不存在' }
    }
    
    return { success: true, tokenInfo: tokens[accountId] }
  } catch (error) {
    console.error('加载Token失败:', error)
    return { success: false, error: error.message }
  }
})

// 使用Token设置浏览器Cookie
ipcMain.handle('set-cookies', async (event, { accountId, tokenInfo }) => {
  try {
    const browserData = browsers.get(accountId)
    if (!browserData) {
      throw new Error('浏览器实例不存在')
    }
    
    const cookies = []
    const domain = '.douyin.com'
    const currentTime = Math.floor(Date.now() / 1000)
    
    // 设置关键cookies
    for (const [name, value] of Object.entries(tokenInfo)) {
      if (value && name !== 'savedAt') {
        cookies.push({
          name,
          value,
          domain,
          path: '/',
          expires: currentTime + 86400 * 30, // 30天后过期
          httpOnly: false,
          secure: true,
          sameSite: 'Lax'
        })
      }
    }
    
    await browserData.context.addCookies(cookies)
    console.log(`已设置 ${cookies.length} 个cookies`)
    
    return { success: true }
  } catch (error) {
    console.error('设置Cookie失败:', error)
    return { success: false, error: error.message }
  }
})
