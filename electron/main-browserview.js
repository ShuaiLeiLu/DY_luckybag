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
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
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
    
    browserViews.set(accountId, {
      window: browserWindow,
      session: accountSession,
      partition: partition
    })
    
    // 监听页面加载完成
    browserWindow.webContents.on('did-finish-load', () => {
      console.log(`[${accountId}] 页面加载完成`)
    })
    
    // 监听窗口关闭
    browserWindow.on('closed', () => {
      console.log(`[${accountId}] 窗口已关闭`)
      browserViews.delete(accountId)
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
    const browserData = browserViews.get(accountId)
    if (!browserData) {
      throw new Error('浏览器实例不存在')
    }
    
    console.log(`[${accountId}] 开始获取用户信息...`)
    
    // 等待页面完全加载
    await new Promise(resolve => setTimeout(resolve, 3000))
    
    const userInfo = await browserData.window.webContents.executeJavaScript(`
      (async function() {
        console.log('开始执行用户信息获取脚本...');
        
        // 方法1: 通过抖音API获取
        try {
          console.log('尝试方法1: API获取');
          const response = await fetch('https://www.douyin.com/aweme/v1/web/im/user/info/', {
            credentials: 'include'
          });
          const data = await response.json();
          console.log('API返回:', data);
          if (data && data.data && data.data.user_info) {
            return {
              method: 'API',
              nickname: data.data.user_info.nickname,
              userId: data.data.user_info.sec_uid || data.data.user_info.uid
            };
          }
        } catch (e) {
          console.log('方法1失败:', e.message);
        }
        
        // 方法2: 从页面右上角头像区域获取
        try {
          console.log('尝试方法2: 页面元素');
          // 查找头像元素
          const avatarImg = document.querySelector('img[alt*="头像"]') || 
                           document.querySelector('img[class*="avatar"]');
          if (avatarImg) {
            const container = avatarImg.closest('div');
            const textElements = container.querySelectorAll('span, div');
            for (const el of textElements) {
              const text = el.textContent.trim();
              if (text && text.length > 0 && text.length < 30 && !text.includes('登录')) {
                console.log('找到昵称:', text);
                return {
                  method: 'DOM',
                  nickname: text,
                  userId: null
                };
              }
            }
          }
        } catch (e) {
          console.log('方法2失败:', e.message);
        }
        
        // 方法3: 从URL中查找用户页面链接
        try {
          console.log('尝试方法3: 用户链接');
          const userLinks = document.querySelectorAll('a[href*="/user/"]');
          for (const link of userLinks) {
            const href = link.getAttribute('href');
            const match = href.match(/\\/user\\/([^?/]+)/);
            if (match) {
              const text = link.textContent.trim();
              if (text && text.length > 0 && text.length < 30) {
                console.log('找到用户链接:', text, match[1]);
                return {
                  method: 'Link',
                  nickname: text,
                  userId: match[1]
                };
              }
            }
          }
        } catch (e) {
          console.log('方法3失败:', e.message);
        }
        
        // 方法4: 从全局变量获取
        try {
          console.log('尝试方法4: 全局变量');
          if (window.__INITIAL_STATE__ && window.__INITIAL_STATE__.user) {
            const user = window.__INITIAL_STATE__.user;
            return {
              method: 'GlobalVar',
              nickname: user.nickname || user.nickName,
              userId: user.secUid || user.sec_uid || user.uid
            };
          }
        } catch (e) {
          console.log('方法4失败:', e.message);
        }
        
        console.log('所有方法都失败了');
        return null;
      })()
    `, true)
    
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
    const browserData = browserViews.get(accountId)
    if (!browserData) {
      throw new Error('浏览器实例不存在')
    }
    
    const cookies = await browserData.session.cookies.get({ domain: '.douyin.com' })
    
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
        // 等待页面加载完成
        await new Promise(resolve => setTimeout(resolve, 2000))
        
        const result = await browserData.window.webContents.executeJavaScript(`
          (async function() {
            try {
              // 方法1: 通过API获取用户信息
              try {
                const response = await fetch('https://www.douyin.com/aweme/v1/web/im/user/info/', {
                  credentials: 'include'
                });
                const data = await response.json();
                if (data && data.data && data.data.user_info) {
                  return {
                    nickname: data.data.user_info.nickname,
                    userId: data.data.user_info.sec_uid || data.data.user_info.uid
                  };
                }
              } catch (e) {
                console.log('API方法失败:', e);
              }
              
              // 方法2: 从页面右上角用户信息获取
              const avatarElement = document.querySelector('[data-e2e="user-avatar"]');
              if (avatarElement) {
                const parentElement = avatarElement.closest('div[class*="user"]');
                if (parentElement) {
                  const nicknameElement = parentElement.querySelector('[class*="nickname"]');
                  if (nicknameElement) {
                    return {
                      nickname: nicknameElement.textContent.trim(),
                      userId: null
                    };
                  }
                }
              }
              
              // 方法3: 从页面标题或meta标签获取
              const metaTitle = document.querySelector('meta[property="og:title"]');
              if (metaTitle && metaTitle.content) {
                const match = metaTitle.content.match(/(.+)的抖音/);
                if (match) {
                  return {
                    nickname: match[1],
                    userId: null
                  };
                }
              }
              
              // 方法4: 从页面任何包含用户信息的元素
              const userLinks = document.querySelectorAll('a[href*="/user/"]');
              for (const link of userLinks) {
                const href = link.getAttribute('href');
                const match = href.match(/\\/user\\/([^?]+)/);
                if (match) {
                  const nickname = link.textContent.trim();
                  if (nickname && nickname.length > 0 && nickname.length < 50) {
                    return {
                      nickname: nickname,
                      userId: match[1]
                    };
                  }
                }
              }
              
              // 方法5: 从cookie中的用户信息
              const cookieMatch = document.cookie.match(/passport_auth_mix_state=([^;]+)/);
              if (cookieMatch) {
                try {
                  const decoded = decodeURIComponent(cookieMatch[1]);
                  const parsed = JSON.parse(decoded);
                  if (parsed.nickname) {
                    return {
                      nickname: parsed.nickname,
                      userId: parsed.uid || parsed.sec_uid
                    };
                  }
                } catch (e) {}
              }
              
              return null;
            } catch (e) {
              console.error('获取用户信息失败:', e);
              return null;
            }
          })()
        `, true)
        
        if (result && result.nickname) {
          userInfo = result
          console.log(`✅ 获取到用户信息: ${result.nickname} ${result.userId ? '(' + result.userId + ')' : ''}`)
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
    
    if (!json?.data || !Array.isArray(json.data)) {
      return { success: false, error: '响应数据格式错误' }
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
      count: count,  // 支持自定义count
      offset: offset,
      partition: categoryId,
      partition_type: 4,
      req_from: 2
    }, {
      cookie: cookieString,
      referer: 'https://live.douyin.com/'
    })
    
    if (!json?.data?.data || !Array.isArray(json.data.data)) {
      return { success: false, error: '响应数据格式错误' }
    }
    
    // 筛选有福袋的直播间
    const roomInfoList = json.data.data
      .filter(item => item?.room?.others?.web_enter_benefit_point_data?.has_ongoing_lottery)
      .map(item => ({
        webRid: item.web_rid,
        roomId: item.room.id_str,
        roomTitle: item.room.title,
        authorNickname: item.room.owner.nickname,
        authorSecUid: item.room.owner.sec_uid,
        onlineTotal: item.room.user_count
      }))
    
    return { success: true, roomInfoList }
  } catch (error) {
    console.error('搜索分类直播间失败:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-lottery-detail', async (event, { roomId, accountId }) => {
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

    const json = await douyinLiveRemote('/webcast/lottery/melon/lottery_info/', {
      live_id: '1',
      enter_from: 'link_share',
      room_id: roomId,
      query_from: '1'
    }, {
      cookie: cookieString,
      referer: `https://live.douyin.com/${roomId}`
    })

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
    return { success: false, error: error.message }
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
