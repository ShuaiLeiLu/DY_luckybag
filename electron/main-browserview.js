const { app, BrowserWindow, BrowserView, ipcMain, session } = require('electron')
const path = require('path')
const https = require('https')
const fs = require('fs')
const os = require('os')
const { douyinLiveRemote } = require('./douyinLiveRemote')

let mainWindow
let browserViews = new Map() // 存储多个BrowserView实例

// 修改token存储路径到项目根目录
// 开发环境：项目根目录
// 生产环境：可执行文件所在目录
const isDev = !app.isPackaged
const tokenStorePath = isDev 
  ? path.join(__dirname, '..', 'tokens.json')  // 开发环境：项目根目录
  : path.join(path.dirname(app.getPath('exe')), 'tokens.json')  // 生产环境：exe所在目录

console.log(`Token存储路径: ${tokenStorePath}`)

// ==================== 工具函数 ====================

/**
 * 生成随机msToken
 * @param {number} length - token长度，默认120
 * @returns {string} 随机token
 */
function generateMsToken(length = 120) {
  const chars = 'ABCDEFGHIGKLMNOPQRSTUVWXYZabcdefghigklmnopqrstuvwxyz0123456789='
  let token = ''
  for (let i = 0; i < length; i++) {
    token += chars[Math.floor(Math.random() * chars.length)]
  }
  return token
}

/**
 * 从cookie字符串中提取参数
 * @param {string} cookieString - cookie字符串
 * @returns {object} 提取的参数对象
 */
function extractParamsFromCookie(cookieString) {
  const cookies = {}
  if (cookieString) {
    cookieString.split(';').forEach(cookie => {
      const [key, value] = cookie.trim().split('=')
      if (key && value) {
        cookies[key] = value
      }
    })
  }
  
  return {
    msToken: generateMsToken(),
    verifyFp: cookies.s_v_web_id || null,
    fp: cookies.s_v_web_id || null,
    screen_width: cookies.dy_swidth || '2560',
    screen_height: cookies.dy_sheight || '1440',
    cpu_core_num: cookies.device_web_cpu_core || '24',
    device_memory: cookies.device_web_memory_size || '8'
  }
}

/**
 * 将cookie对象转换为字符串
 * @param {object} cookieObj - cookie对象
 * @returns {string} cookie字符串
 */
function cookieObjToString(cookieObj) {
  const parts = []
  for (const [key, value] of Object.entries(cookieObj)) {
    if (value) {
      parts.push(`${key}=${value}`)
    }
  }
  return parts.join('; ')
}

/**
 * 使用 session 获取账号 cookie，并拼接为 header 字符串
 * @param {string} accountId
 * @returns {Promise<{ cookies: Array, cookieString: string }>}
 */
async function getAccountCookiesAndString(accountId) {
  const browserData = browserViews.get(accountId)
  if (!browserData) {
    throw new Error('浏览器实例不存在')
  }
  const cookies = await browserData.session.cookies.get({ domain: '.douyin.com' })
  const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ')
  return { cookies, cookieString }
}

/**
 * 主进程直连接口，避免页面脚本跨域限制
 * @param {string} url
 * @param {object} headers
 * @param {number} timeout
 * @returns {Promise<object>}
 */
function requestJson(url, headers = {}, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers,
      timeout
    }, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        const statusCode = res.statusCode || 0
        if (statusCode < 200 || statusCode >= 300) {
          return reject(new Error(`HTTP ${statusCode}`))
        }
        const trimmed = (body || '').trim()
        if (!trimmed) return reject(new Error('空响应'))
        if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
          return reject(new Error('响应不是JSON(HTML)'))
        }
        try {
          resolve(JSON.parse(trimmed))
        } catch (e) {
          reject(new Error(`JSON解析失败: ${e.message}`))
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('请求超时')))
    req.end()
  })
}

function normalizeUserInfo(raw, method) {
  if (!raw) return null
  const nickname = raw.nickname || raw.nickName || raw.nick_name || ''
  const userId = raw.sec_uid || raw.secUid || raw.uid || raw.userId || ''
  if (!nickname) return null
  return {
    method,
    nickname,
    userId: userId || null
  }
}

async function fetchUserInfoFromApis(cookieString) {
  if (!cookieString) return null
  const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Cookie': cookieString
  }

  // 参考“超人福袋助手”优先使用 creator 接口
  try {
    const creatorRes = await requestJson('https://creator.douyin.com/web/api/media/user/info/', {
      ...commonHeaders,
      'Referer': 'https://creator.douyin.com/creator-micro/content/manage'
    })
    if (creatorRes?.status_code === 0 && creatorRes?.user) {
      const info = normalizeUserInfo(creatorRes.user, 'creator_api')
      if (info) return info
    }
  } catch (e) {
    console.log(`[user-info] creator 接口失败: ${e.message}`)
  }

  // 回退到 aweme 用户信息接口
  try {
    const awemeRes = await requestJson('https://www.douyin.com/aweme/v1/web/im/user/info/', {
      ...commonHeaders,
      'Referer': 'https://www.douyin.com/user/self'
    })
    const info = normalizeUserInfo(awemeRes?.data?.user_info, 'aweme_api')
    if (info) return info
  } catch (e) {
    console.log(`[user-info] aweme 接口失败: ${e.message}`)
  }

  return null
}

async function fetchUserInfoFromPage(webContents) {
  try {
    const result = await webContents.executeJavaScript(`
      (function() {
        try {
          const fromState = window.__INITIAL_STATE__?.user || window.__INITIAL_STATE__?.userInfo || null;
          if (fromState) {
            const nick = fromState.nickname || fromState.nickName || fromState.nick_name;
            const uid = fromState.sec_uid || fromState.secUid || fromState.uid;
            if (nick) return { nickname: nick, userId: uid || null, method: 'dom_state' };
          }

          const userLinks = document.querySelectorAll('a[href*="/user/"]');
          for (const link of userLinks) {
            const href = link.getAttribute('href') || '';
            const match = href.match(/\\/user\\/([^?/]+)/);
            const text = (link.textContent || '').trim();
            if (match && text && text.length < 50 && !text.includes('登录')) {
              return { nickname: text, userId: match[1], method: 'dom_link' };
            }
          }

          const metaTitle = document.querySelector('meta[property="og:title"]')?.content || '';
          const m = metaTitle.match(/(.+)的抖音/);
          if (m && m[1]) return { nickname: m[1], userId: null, method: 'dom_meta' };
        } catch (_) {}
        return null;
      })()
    `, true)
    if (result?.nickname) {
      return {
        method: result.method || 'dom',
        nickname: result.nickname,
        userId: result.userId || null
      }
    }
  } catch (e) {
    console.log(`[user-info] 页面兜底失败: ${e.message}`)
  }
  return null
}

async function resolveUserInfo(accountId, options = {}) {
  const waitMs = options.waitMs ?? 0
  const browserData = browserViews.get(accountId)
  if (!browserData) throw new Error('浏览器实例不存在')
  if (waitMs > 0) {
    await new Promise(resolve => setTimeout(resolve, waitMs))
  }

  const { cookieString } = await getAccountCookiesAndString(accountId)
  const apiInfo = await fetchUserInfoFromApis(cookieString)
  if (apiInfo?.nickname) return apiInfo

  const pageInfo = await fetchUserInfoFromPage(browserData.window.webContents)
  if (pageInfo?.nickname) return pageInfo

  return null
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 1000,
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
// 全局静音兜底（多账号场景避免偶发出声）
try {
  app.commandLine.appendSwitch('mute-audio')
} catch (_) {}

// 打印所有已注册的 IPC handlers（用于调试）
app.whenReady().then(() => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('✅ Electron 应用已启动')
  console.log('📋 已注册的 IPC Handlers:')
  console.log('  - load-all-tokens')
  console.log('  - check-browser-exists')
  console.log('  - launch-browser')
  console.log('  - navigate-to')
  console.log('  - execute-script')
  console.log('  - close-browser')
  console.log('  - delete-token')
  console.log('  - get-user-info')
  console.log('  - clear-account-cache')
  console.log('  - get-login-token')
  console.log('  - save-token')
  console.log('  - load-token')
  console.log('  - set-cookies')
  console.log('  - search-live-by-all')
  console.log('  - search-live-by-category')
  console.log('  - get-lottery-detail')
  console.log('  - collect-lotteries-by-category')
  console.log('  - attend-lottery')
  console.log('  - room-like')
  console.log('  - room-chat')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
})

// ... 前面的代码保持不变 ...

// ==================== 互动操作 ====================

// 参与福袋
ipcMain.handle('attend-lottery', async (event, { roomId, lotteryId, webRid = null, accountId }) => {
  try {
    let cookieString = ''
    if (accountId) {
      const browserData = browserViews.get(accountId)
      if (browserData) {
        const cookies = await browserData.session.cookies.get({ domain: '.douyin.com' })
        cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ')
      }
    }

    const commonHeaders = {
      cookie: cookieString,
      referer: `https://live.douyin.com/${webRid || roomId}`
    }

    const attemptAttend = async (payload) => {
      const json = await douyinLiveRemote('/webcast/lottery/melon/attend/', payload, commonHeaders, 'POST')
      const status = json?.data?.status
      const statusCode = json?.status_code
      const errorMsg = json?.extra?.error_msg ||
        json?.extra?.description ||
        json?.data?.prompt ||
        json?.data?.toast ||
        json?.status_msg ||
        json?.message ||
        ''
      const success = status === 0 || (status === undefined && statusCode === 0)
      return { json, status, statusCode, errorMsg, success }
    }

    // 先使用标准字段 room_id，失败后回退 roomId
    let result = null
    try {
      result = await attemptAttend({
        room_id: roomId,
        lottery_id: lotteryId
      })
    } catch (_) {}

    if (!result || !result.success) {
      result = await attemptAttend({
        roomId,
        lottery_id: lotteryId
      })
    }

    return {
      success: result.success,
      data: result.json?.data,
      extra: result.json?.extra,
      status: result.status,
      statusCode: result.statusCode,
      error: result.errorMsg
    }
  } catch (error) {
    return { success: false, error: error.message, code: error?.code || 'UNKNOWN' }
  }
})

// 直播间点赞
ipcMain.handle('room-like', async (event, { roomId, accountId, count = 1 }) => {
  try {
    let cookieString = ''
    if (accountId) {
      const browserData = browserViews.get(accountId)
      if (browserData) {
        const cookies = await browserData.session.cookies.get({ domain: '.douyin.com' })
        cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ')
      }
    }

    const json = await douyinLiveRemote('/webcast/room/digg/', {
      room_id: roomId,
      count: count,
    }, {
      cookie: cookieString,
      referer: `https://live.douyin.com/${roomId}`
    }, 'POST')

    return { success: json?.data?.status === 0, data: json?.data }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 发送弹幕
ipcMain.handle('room-chat', async (event, { roomId, content, accountId }) => {
  try {
    let cookieString = ''
    if (accountId) {
      const browserData = browserViews.get(accountId)
      if (browserData) {
        const cookies = await browserData.session.cookies.get({ domain: '.douyin.com' })
        cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ')
      }
    }

    const json = await douyinLiveRemote('/webcast/room/chat/', {
      room_id: roomId,
      content: content,
    }, {
      cookie: cookieString,
      referer: `https://live.douyin.com/${roomId}`
    }, 'POST')

    return { success: json?.data?.status === 0, data: json?.data }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

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

// ==================== 启动时加载所有token ====================

ipcMain.handle('load-all-tokens', async () => {
  try {
    if (!fs.existsSync(tokenStorePath)) {
      return { success: true, tokens: {} }
    }
    
    const data = fs.readFileSync(tokenStorePath, 'utf8')
    const tokens = JSON.parse(data)
    
    console.log(`已加载 ${Object.keys(tokens).length} 个账号的Token`)
    return { success: true, tokens }
  } catch (error) {
    console.error('加载所有Token失败:', error)
    return { success: false, error: error.message, tokens: {} }
  }
})

// ==================== BrowserView 管理 ====================

ipcMain.handle('check-browser-exists', async (event, accountId) => {
  try {
    const browserData = browserViews.get(accountId)
    return { success: true, exists: !!browserData }
  } catch (error) {
    return { success: false, exists: false }
  }
})

ipcMain.handle('launch-browser', async (event, accountId) => {
  try {
    // 为每个账号创建独立的 session partition
    const partition = `persist:douyin_${accountId}`
    
    // 创建新窗口用于显示抖音页面
    const browserWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: partition // 独立的session，每个账号互不干扰
      }
    })
    
    // 获取该账号的独立 session
    const accountSession = browserWindow.webContents.session
    
    // 清除该账号的所有缓存和数据（确保是全新的）
    await accountSession.clearStorageData({
      storages: ['cookies', 'localstorage', 'sessionstorage', 'cachestorage', 'indexdb']
    })
    
    console.log(`[${accountId}] 已创建独立session: ${partition}`)

    // 参考超人福袋：默认静音，避免多账号运行时音频干扰
    try {
      browserWindow.webContents.setAudioMuted(true)
    } catch (_) {}
    
    browserViews.set(accountId, {
      window: browserWindow,
      session: accountSession,
      partition: partition
    })
    
    // 监听页面加载完成
    browserWindow.webContents.on('did-finish-load', () => {
      console.log(`[${accountId}] 页面加载完成`)
      try { browserWindow.webContents.setAudioMuted(true) } catch (_) {}
      
      // 开启调试模式以监听网络响应体
      try {
        const wc = browserWindow.webContents
        if (!wc.debugger.isAttached()) {
          wc.debugger.attach('1.3')
        }
        wc.debugger.on('detach', (event, reason) => {
          console.log(`[${accountId}] Debugger detached:`, reason)
        })
        wc.debugger.sendCommand('Network.enable')
        wc.debugger.on('message', async (event, method, params) => {
          if (method === 'Network.responseReceived') {
            const { url } = params.response
            const requestId = params.requestId
            
            // 监听关键接口
            const isLottery = url.includes('webcast/lottery/melon/check_user_right')
            const isRedPacket = url.includes('webcast/luckybox/receive')
            const isWallet = url.includes('webcast/wallet/info')
            
            if (isLottery || isRedPacket || isWallet) {
              try {
                const { body } = await wc.debugger.sendCommand('Network.getResponseBody', { requestId })
                const json = JSON.parse(body)
                
                // 发送到渲染进程
                mainWindow.webContents.send('douyin-response', {
                  accountId,
                  type: isLottery ? 'lottery' : (isRedPacket ? 'redpacket' : 'wallet'),
                  data: json.data
                })
              } catch (e) {
                // 忽略获取响应体失败的情况
              }
            }
          }
        })
      } catch (err) {
        console.error(`[${accountId}] Debugger attach error:`, err)
      }
    })

    // 页面跳转后再次强制静音，防止站点恢复音量
    browserWindow.webContents.on('did-navigate', () => {
      try { browserWindow.webContents.setAudioMuted(true) } catch (_) {}
    })
    browserWindow.webContents.on('did-navigate-in-page', () => {
      try { browserWindow.webContents.setAudioMuted(true) } catch (_) {}
    })
    
    // 监听窗口关闭
    browserWindow.on('closed', () => {
      console.log(`[${accountId}] 窗口已关闭`)
      browserViews.delete(accountId)
      
      // 通知渲染进程窗口已关闭，停止该账号的所有活动
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('browser-closed', { accountId })
      }
    })
    
    // 监听网络请求
    accountSession.webRequest.onCompleted(
      { urls: ['https://live.douyin.com/*'] },
      (details) => {
        const url = details.url
        
        // 监听福袋相关接口
        if (url.includes('webcast/lottery/melon/check_user_right') ||
            url.includes('webcast/wallet/info') ||
            url.includes('webcast/luckybox/receive')) {
          // 注意：webRequest无法直接获取响应体，需要在页面中注入脚本监听
        }
      }
    )
    
    return { success: true, accountId, partition }
  } catch (error) {
    console.error('启动浏览器失败:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('navigate-to', async (event, { accountId, url }) => {
  try {
    const browserData = browserViews.get(accountId)
    if (!browserData) {
      throw new Error('浏览器实例不存在')
    }
    
    await browserData.window.loadURL(url)
    return { success: true }
  } catch (error) {
    console.error('导航失败:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('execute-script', async (event, { accountId, script }) => {
  try {
    const browserData = browserViews.get(accountId)
    if (!browserData) {
      throw new Error('浏览器实例不存在')
    }
    
    const result = await browserData.window.webContents.executeJavaScript(script)
    return { success: true, result }
  } catch (error) {
    console.error('执行脚本失败:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('close-browser', async (event, accountId) => {
  try {
    const browserData = browserViews.get(accountId)
    if (browserData) {
      browserData.window.close()
      browserViews.delete(accountId)
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// ==================== 删除账号Token ====================

ipcMain.handle('delete-token', async (event, accountId) => {
  try {
    if (!fs.existsSync(tokenStorePath)) {
      return { success: true, message: 'Token文件不存在' }
    }
    
    const data = fs.readFileSync(tokenStorePath, 'utf8')
    const tokens = JSON.parse(data)
    
    if (tokens[accountId]) {
      delete tokens[accountId]
      fs.writeFileSync(tokenStorePath, JSON.stringify(tokens, null, 2))
      console.log(`Token已删除: ${accountId}`)
      return { success: true, message: 'Token已删除' }
    } else {
      return { success: true, message: '该账号Token不存在' }
    }
  } catch (error) {
    console.error('删除Token失败:', error)
    return { success: false, error: error.message }
  }
})

// ==================== 手动获取用户信息 ====================

ipcMain.handle('get-user-info', async (event, accountId) => {
  try {
    console.log(`[${accountId}] 开始获取用户信息...`)
    const userInfo = await resolveUserInfo(accountId, { waitMs: 1500 })
    
    if (userInfo && userInfo.nickname) {
      console.log(`✅ [${accountId}] 获取到用户信息 (${userInfo.method}): ${userInfo.nickname} ${userInfo.userId || ''}`)
      return { success: true, userInfo }
    } else {
      console.log(`⚠️ [${accountId}] 未能获取到用户信息`)
      return { success: false, error: '未能获取到用户信息' }
    }
  } catch (error) {
    console.error(`❌ [${accountId}] 获取用户信息异常:`, error)
    return { success: false, error: error.message }
  }
})

// ==================== 清除账号缓存 ====================

ipcMain.handle('clear-account-cache', async (event, accountId) => {
  try {
    const browserData = browserViews.get(accountId)
    if (!browserData) {
      throw new Error('浏览器实例不存在')
    }
    
    console.log(`[${accountId}] 开始清除缓存...`)
    
    // 清除所有缓存和存储数据
    await browserData.session.clearStorageData({
      storages: ['cookies', 'localstorage', 'sessionstorage', 'cachestorage', 'indexdb', 'websql']
    })
    
    // 清除缓存
    await browserData.session.clearCache()
    
    console.log(`✅ [${accountId}] 缓存已清除`)
    
    return { success: true, message: '缓存已清除' }
  } catch (error) {
    console.error(`❌ [${accountId}] 清除缓存失败:`, error)
    return { success: false, error: error.message }
  }
})

// ==================== Token 管理 ====================

ipcMain.handle('get-login-token', async (event, accountId) => {
  try {
    const { cookies } = await getAccountCookiesAndString(accountId)
    
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
    
    const isLoggedIn = !!tokenInfo.sessionid || !!tokenInfo.sessionid_ss
    
    // 尝试获取用户信息
    let userInfo = null
    if (isLoggedIn) {
      try {
        userInfo = await resolveUserInfo(accountId, { waitMs: 1200 })
        if (userInfo && userInfo.nickname) {
          console.log(`✅ 获取到用户信息: ${userInfo.nickname} ${userInfo.userId ? '(' + userInfo.userId + ')' : ''}`)
        } else {
          console.log('⚠️ 未能获取到用户信息，将使用默认值')
        }
      } catch (e) {
        console.log('⚠️ 获取用户信息异常:', e.message)
      }
    }
    
    return { 
      success: true, 
      isLoggedIn,
      tokenInfo,
      userInfo,
      cookieCount: cookies.length
    }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('save-token', async (event, { accountId, tokenInfo, userInfo = null }) => {
  try {
    let tokens = {}
    
    if (fs.existsSync(tokenStorePath)) {
      const data = fs.readFileSync(tokenStorePath, 'utf8')
      tokens = JSON.parse(data)
    }
    
    tokens[accountId] = {
      ...tokenInfo,
      nickname: userInfo?.nickname || tokenInfo.nickname || `账号_${accountId}`,
      userId: userInfo?.userId || tokenInfo.userId || accountId,
      savedAt: Date.now()
    }
    
    fs.writeFileSync(tokenStorePath, JSON.stringify(tokens, null, 2))
    console.log(`Token已保存: ${accountId} (${tokens[accountId].nickname})`)
    
    return { success: true, savedInfo: tokens[accountId] }
  } catch (error) {
    console.error('保存Token失败:', error)
    return { success: false, error: error.message }
  }
})

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

ipcMain.handle('set-cookies', async (event, { accountId, tokenInfo }) => {
  try {
    const browserData = browserViews.get(accountId)
    if (!browserData) {
      throw new Error('浏览器实例不存在')
    }
    
    const domain = '.douyin.com'
    const currentTime = Math.floor(Date.now() / 1000)
    
    // 只设置真正的 cookie 字段，排除其他字段
    const cookieFields = [
      'sessionid',
      'sessionid_ss',
      'ttwid',
      'passport_csrf_token',
      'odin_tt',
      '__ac_nonce',
      '__ac_signature'
    ]
    
    let setCookieCount = 0
    
    for (const name of cookieFields) {
      const value = tokenInfo[name]
      if (value && typeof value === 'string' && value.length > 0) {
        try {
          await browserData.session.cookies.set({
            url: 'https://www.douyin.com',
            name,
            value,
            domain,
            path: '/',
            expirationDate: currentTime + 86400 * 30,
            httpOnly: false,
            secure: true,
            sameSite: 'lax'
          })
          setCookieCount++
          console.log(`✅ [${accountId}] 已设置 cookie: ${name}`)
        } catch (e) {
          console.error(`❌ [${accountId}] 设置 cookie 失败 (${name}):`, e.message)
        }
      }
    }
    
    console.log(`✅ [${accountId}] 共设置 ${setCookieCount} 个 cookies`)
    return { success: true, count: setCookieCount }
  } catch (error) {
    console.error(`❌ [${accountId}] 设置Cookie失败:`, error)
    return { success: false, error: error.message }
  }
})

// ==================== 福袋收集 ====================

// 搜索直播间-【全部】
ipcMain.handle('search-live-by-all', async (event, { accountId = null } = {}) => {
  try {
    // 获取cookie
    let cookieString = ''
    if (accountId) {
      const browserData = browserViews.get(accountId)
      if (browserData) {
        try {
          const cookies = await browserData.session.cookies.get({ domain: '.douyin.com' })
          cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ')
        } catch (e) {
          console.warn('⚠️ 获取Cookie失败:', e.message)
        }
      }
    }
    
    // 完全按照原项目的参数
    const json = await douyinLiveRemote('/webcast/feed/', {
      live_id: 1,
      enter_from: 'page_refresh',
      cookie_enabled: true,
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
    }, {
      cookie: cookieString
    })
    
    // 详细日志
    console.log(`[search-live-by-all] 响应状态:`, json ? 'OK' : 'NULL')
    if (json) {
      console.log(`[search-live-by-all] 响应结构:`, {
        hasData: !!json.data,
        dataType: Array.isArray(json.data) ? 'array' : typeof json.data,
        dataLength: Array.isArray(json.data) ? json.data.length : 'N/A',
        statusCode: json.status_code,
        extra: json.extra
      })
    }
    
    if (!json) {
      return { success: false, error: '响应为空' }
    }
    
    // 检查错误码
    if (json.status_code !== undefined && json.status_code !== 0) {
      const errorMsg = json.extra?.error_msg || json.extra?.description || '未知错误'
      console.error(`[search-live-by-all] API错误: ${json.status_code} - ${errorMsg}`)
      return { success: false, error: `API错误(${json.status_code}): ${errorMsg}` }
    }
    
    if (!json.data || !Array.isArray(json.data)) {
      console.error(`[search-live-by-all] 数据格式错误:`, JSON.stringify(json).substring(0, 500))
      return { success: false, error: '响应数据格式错误', detail: json }
    }
    
    // 筛选有福袋的直播间
    const roomInfoList = json.data
      .filter(item => item?.data?.others?.web_enter_benefit_point_data?.has_ongoing_lottery)
      .map(room => ({
        webRid: room.web_rid,
        roomId: room.data.id_str,
        roomTitle: room.data.title,
        authorNickname: room.data.owner.nickname,
        authorSecUid: room.data.owner.sec_uid,
        onlineTotal: room.data.user_count
      }))
    
    console.log(`[search-live-by-all] 找到 ${roomInfoList.length} 个有福袋的直播间`)
    return { success: true, roomInfoList }
  } catch (error) {
    console.error('搜索全部直播间失败:', error)
    return { success: false, error: error.message }
  }
})

// 搜索直播间-【分类】
ipcMain.handle('search-live-by-category', async (event, { accountId = null, categoryId = '0', offset = 0, count = 15 } = {}) => {
  try {
    // 获取cookie
    let cookieString = ''
    if (accountId) {
      const browserData = browserViews.get(accountId)
      if (browserData) {
        try {
          const cookies = await browserData.session.cookies.get({ domain: '.douyin.com' })
          cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ')
        } catch (e) {
          console.warn('⚠️ 获取Cookie失败:', e.message)
        }
      }
    }
    
    // 完全按照原项目的参数
    const json = await douyinLiveRemote('/webcast/web/partition/detail/room/v2/', {
      live_id: 1,
      enter_from: 'page_refresh',
      cookie_enabled: true,
      count: count,
      offset: offset,
      partition: categoryId,
      partition_type: 4,
      req_from: 2
    }, {
      cookie: cookieString,
      referer: 'https://live.douyin.com/'
    })
    
    // 详细日志
    console.log(`[search-live-by-category] 分类:${categoryId}, offset:${offset}`)
    if (json) {
      console.log(`[search-live-by-category] 响应结构:`, {
        hasData: !!json.data,
        hasDataData: !!json.data?.data,
        dataType: Array.isArray(json.data?.data) ? 'array' : typeof json.data?.data,
        dataLength: Array.isArray(json.data?.data) ? json.data.data.length : 'N/A',
        statusCode: json.status_code,
        extra: json.extra
      })
    }
    
    if (!json) {
      return { success: false, error: '响应为空' }
    }
    
    // 检查错误码
    if (json.status_code !== undefined && json.status_code !== 0) {
      const errorMsg = json.extra?.error_msg || json.extra?.description || '未知错误'
      console.error(`[search-live-by-category] API错误: ${json.status_code} - ${errorMsg}`)
      return { success: false, error: `API错误(${json.status_code}): ${errorMsg}` }
    }
    
    const rawList = Array.isArray(json.data?.data)
      ? json.data.data
      : Array.isArray(json.data?.room_list)
        ? json.data.room_list
        : Array.isArray(json.data?.list)
          ? json.data.list
          : []

    if (rawList.length === 0) {
      console.error(`[search-live-by-category] 数据格式错误:`, JSON.stringify(json).substring(0, 500))
      return { success: false, error: '响应数据格式错误', detail: json }
    }
    
    // 分类接口在不同账号/版本下字段有差异，这里做兼容解析
    const roomInfoList = rawList
      .map(item => {
        const room = item?.room || item?.data || item
        const benefit = room?.others?.web_enter_benefit_point_data || item?.others?.web_enter_benefit_point_data
        const hasLottery = !!benefit && (
          benefit.has_ongoing_lottery === true ||
          benefit.has_ongoing_lottery === 1 ||
          benefit.has_ongoing_lottery === '1' ||
          benefit.has_ongoing_lottery === undefined
        )

        if (!hasLottery || !room?.id_str) return null
        return {
          webRid: item?.web_rid || item?.webRid || room?.web_rid || room?.id_str,
          roomId: room.id_str,
          roomTitle: room.title || '',
          authorNickname: room?.owner?.nickname || '',
          authorSecUid: room?.owner?.sec_uid || '',
          onlineTotal: room?.user_count || 0
        }
      })
      .filter(Boolean)
    
    console.log(`[search-live-by-category] 原始${rawList.length}个, 筛出${roomInfoList.length}个有福袋直播间`)
    return { success: true, roomInfoList }
  } catch (error) {
    console.error('搜索分类直播间失败:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-lottery-detail', async (event, { roomId, webRid = null, accountId }) => {
  try {
    // 获取cookie
    let cookieString = ''
    if (accountId) {
      const browserData = browserViews.get(accountId)
      if (browserData) {
        try {
          const cookies = await browserData.session.cookies.get({ domain: '.douyin.com' })
          cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ')
        } catch (e) {
          console.warn('⚠️ 获取Cookie失败:', e.message)
        }
      }
    }

    const referers = [webRid, roomId]
      .filter(Boolean)
      .map(v => `https://live.douyin.com/${v}`)
    referers.push('https://live.douyin.com/')

    let json = null
    let lastError = null

    for (const referer of referers) {
      try {
        json = await douyinLiveRemote('/webcast/lottery/melon/lottery_info/', {
          live_id: '1',
          enter_from: 'link_share',
          room_id: roomId,
          query_from: '1'
        }, {
          cookie: cookieString,
          referer
        })
        if (json?.data?.lottery_info) break
      } catch (error) {
        lastError = error
        // 短暂等待后重试，降低偶发风控页面导致的失败率
        await new Promise(resolve => setTimeout(resolve, 250))
      }
    }

    if (!json && lastError) {
      throw lastError
    }

    if (!json?.data?.lottery_info) {
      return { success: false, error: '福袋信息不存在' }
    }

    const lottery_info = json.data.lottery_info

    // 检查福袋条件（优化版：只要包含类型3和6即可）
    const conditions = lottery_info.conditions || []
    const hasType3 = conditions.some(c => c.type === 3) // 发口令
    const hasType6 = conditions.some(c => c.type === 6) // 手动参与
    const hasValidConditions = hasType3 && hasType6

    if (!hasValidConditions) {
      return { success: false, error: `福袋条件不符合(${conditions.map(c => c.type).join(',')})` }
    }

    const lotteryDetail = {
      lottery_id: lottery_info.lottery_id_str,
      anchorId: lottery_info.anchor_id,
      joinTotal: lottery_info.candidate_num || 0,
      winningTotal: lottery_info.lucky_count || 0,
      lotteryTotal: lottery_info.prize_count || 0,
      lotteryName: lottery_info.prize_info?.name || '未知奖品',
      prize_name: lottery_info.prize_info?.name || '未知奖品',
      start_time: lottery_info.start_time,
      end_time: lottery_info.draw_time,
      conditions
    }

    return { success: true, lotteryDetail }
  } catch (error) {
    console.error('获取福袋详情失败:', error)
    const message = error?.code === 'NON_JSON_RESPONSE'
      ? `接口返回非JSON内容(${error.statusCode || 'unknown'})`
      : error.message
    return { success: false, error: message, code: error?.code || 'UNKNOWN' }
  }
})


// 收集福袋信息 - 方法2：按分类扫描（可获取更多结果）
// 常用分类ID: 
// - 热门: 0
// - 游戏: 1
// - 娱乐: 2
// - 才艺: 3
// - 知识: 4
// - 二次元: 5
ipcMain.handle('collect-lotteries-by-category', async (event, { categoryId = '0', offset = 0, accountId = null }) => {
  try {
    return new Promise(async (resolve) => {
      // 获取cookie并提取参数
      let cookieString = ''
      let dynamicParams = {}
      
      if (accountId) {
        const browserData = browserViews.get(accountId)
        if (browserData) {
          try {
            const cookies = await browserData.session.cookies.get({ domain: '.douyin.com' })
            cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ')
            dynamicParams = extractParamsFromCookie(cookieString)
            console.log(`[分类扫描] 使用账号 ${accountId} 的Cookie`)
          } catch (e) {
            console.warn('⚠️ 获取Cookie失败:', e.message)
          }
        }
      }
      
      try {
        const json = await douyinLiveRemote('/webcast/web/partition/detail/room/v2/', {
          live_id: '1',
          enter_from: 'page_refresh',
          count: '15',
          offset: offset.toString(),
          partition: categoryId,
          partition_type: '4',
          req_from: '2'
        }, {
          cookie: cookieString,
          referer: 'https://live.douyin.com/'
        })

        const lotteries = []
        if (json?.data?.data && Array.isArray(json.data.data)) {
          const roomsWithLottery = json.data.data.filter(item => item?.room?.others?.web_enter_benefit_point_data?.has_ongoing_lottery)
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

        resolve({ success: true, lotteries, total: lotteries.length })
      } catch (error) {
        resolve({ success: false, error: error.message })
      }
    })
  } catch (error) {
    return { success: false, error: error.message }
  }
})
