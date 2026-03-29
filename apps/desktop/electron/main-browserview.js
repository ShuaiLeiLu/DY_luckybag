const { app, BrowserWindow, ipcMain, safeStorage, powerSaveBlocker } = require('electron')
const path = require('path')
const https = require('https')
const fs = require('fs')
const os = require('os')
const { douyinLiveRemote } = require('./douyinLiveRemote')
const { createLogger } = require('./logger')
const { createStateStore, DEFAULT_SETTINGS } = require('./state-store')
const { createUpdateService } = require('./update-service')

let mainWindow
let browserViews = new Map() // 存储多个BrowserView实例
let keepAwakeBlockerId = null
let browserInstanceSeq = 0
let stateStore = null
let updateService = null

const logger = createLogger('main-browserview', { defaultLevel: 'warn' })
const secureStateDir = path.join(app.getPath('userData'), 'state')
const tokenStorePath = path.join(secureStateDir, 'credentials.json')
const protocolGuardPartitions = new Set()
const MAX_VISIBLE_ACCOUNT_WINDOWS = 4
const DESKTOP_DEV_SERVER_URL = 'http://127.0.0.1:5173'

/**
 * 判断扫描追踪日志是否启用（环境变量 DY_SCAN_TRACE，默认关闭）。
 */
function isScanTraceEnabled() {
  const raw = String(process.env.DY_SCAN_TRACE ?? '0').trim().toLowerCase()
  return !['0', 'false', 'off', 'no'].includes(raw)
}

/**
 * 输出扫描追踪日志（直接打印到 IDE 终端）。
 */
function traceScan(tag, payload = null) {
  if (!isScanTraceEnabled()) return
  if (payload === null || payload === undefined) {
    console.log(`[scan-trace] ${tag}`)
    return
  }
  try {
    console.log(`[scan-trace] ${tag}`, JSON.stringify(payload))
  } catch (_) {
    console.log(`[scan-trace] ${tag}`, payload)
  }
}

/**
 * isBlockedExternalProtocol 方法：判断 URL 是否为需要拦截的外部协议。
 */
function isBlockedExternalProtocol(url = '') {
  return /^(bytedance|snssdk|douyinopensdk):\/\//i.test(String(url || '').trim())
}

/**
 * isHttpLikeUrl 方法：判断 URL 是否为可导航的 HTTP/HTTPS 地址。
 */
function isHttpLikeUrl(url = '') {
  return /^https?:\/\//i.test(String(url || '').trim())
}

const MEDIA_EXT_REGEX = /\.(m3u8|ts|mp4|flv|f4v|webm|m4s|mpd)(\?|$)/i

function isBlockedMediaRequest(details = {}) {
  const url = String(details?.url || '').trim()
  const type = String(details?.resourceType || '').trim().toLowerCase()
  if (!url) return false
  if (MEDIA_EXT_REGEX.test(url)) return true
  if (type === 'media') return true
  return false
}

function shouldBlockMediaForAccount(accountId) {
  const browserData = browserViews.get(accountId)
  return browserData?.blockMediaRequests === true
}

function rememberBrowserUrl(accountId, url = '') {
  const browserData = browserViews.get(accountId)
  const normalized = String(url || '').trim()
  if (!browserData || !normalized || !isHttpLikeUrl(normalized)) return
  browserData.lastUrl = normalized
}

function scheduleBrowserRecovery(accountId, reason = '', fallbackUrl = 'https://live.douyin.com') {
  const browserData = browserViews.get(accountId)
  if (!browserData || !browserData.window || browserData.window.isDestroyed()) return
  const now = Date.now()
  const lastRecoverAt = Number(browserData.lastRecoverAt || 0)
  if (now - lastRecoverAt < 8000) return
  browserData.lastRecoverAt = now
  if (browserData.recoveryTimer) {
    clearTimeout(browserData.recoveryTimer)
    browserData.recoveryTimer = null
  }
  const targetUrl = isHttpLikeUrl(browserData.lastUrl) ? browserData.lastUrl : fallbackUrl
  logger.warn(`[${accountId}] 页面异常，准备恢复: ${reason || 'unknown'} -> ${targetUrl}`)
  browserData.recoveryTimer = setTimeout(() => {
    const latest = browserViews.get(accountId)
    if (!latest || !latest.window || latest.window.isDestroyed()) return
    latest.window.loadURL(targetUrl).catch((error) => {
      logger.error(`[${accountId}] 页面恢复失败: ${targetUrl}`, error)
    })
  }, 1200)
}

function ensureStateStore() {
  if (!stateStore) {
    stateStore = createStateStore(app.getPath('userData'))
  }
  return stateStore
}

function ensureUpdateService() {
  if (!updateService) {
    const settings = ensureStateStore().getSettings()
    updateService = createUpdateService({
      feedUrl: settings?.updateFeedUrl || DEFAULT_SETTINGS.updateFeedUrl,
      onChange(snapshot) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('desktop:update-state', snapshot)
        }
      }
    })
  }
  return updateService
}

function appendRuntimeEvent(level = 'info', message = '', scope = 'desktop') {
  try {
    return ensureStateStore().appendEvent({ level, message, scope })
  } catch (_) {
    return null
  }
}

function listVisibleAccountWindows(excludeAccountId = '') {
  return Array.from(browserViews.entries())
    .filter(([accountId, browserData]) => {
      if (excludeAccountId && accountId === excludeAccountId) return false
      if (!browserData?.window || browserData.window.isDestroyed()) return false
      return browserData.window.isVisible()
    })
    .sort((a, b) => Number(a[1]?.lastShownAt || 0) - Number(b[1]?.lastShownAt || 0))
}

function enforceVisibleWindowLimit(excludeAccountId = '') {
  const visibleEntries = listVisibleAccountWindows(excludeAccountId)
  while (visibleEntries.length >= MAX_VISIBLE_ACCOUNT_WINDOWS) {
    const [accountId, browserData] = visibleEntries.shift() || []
    if (!browserData?.window || browserData.window.isDestroyed()) continue
    browserData.window.hide()
    browserData.lastHiddenAt = Date.now()
    browserData.requestedVisible = false
    appendRuntimeEvent('info', `预览位已满，自动隐藏账号 ${accountId}`, 'preview')
  }
}

function revealAccountWindow(accountId, focus = true) {
  const browserData = browserViews.get(accountId)
  if (!browserData || !browserData.window || browserData.window.isDestroyed()) {
    return { success: false, error: 'browser_window_not_found' }
  }
  enforceVisibleWindowLimit(accountId)
  if (browserData.window.isMinimized()) {
    browserData.window.restore()
  }
  browserData.window.setSkipTaskbar(false)
  browserData.requestedVisible = true
  browserData.lastShownAt = Date.now()
  browserData.window.show()
  if (typeof browserData.window.moveTop === 'function') {
    browserData.window.moveTop()
  }
  if (focus) {
    browserData.window.focus()
    if (typeof browserData.window.moveTop === 'function') {
      browserData.window.moveTop()
    }
  }
  return {
    success: true,
    visible: browserData.window.isVisible(),
    focused: browserData.window.isFocused()
  }
}

function concealAccountWindow(accountId) {
  const browserData = browserViews.get(accountId)
  if (!browserData || !browserData.window || browserData.window.isDestroyed()) {
    return { success: false, error: 'browser_window_not_found' }
  }
  browserData.requestedVisible = false
  browserData.lastHiddenAt = Date.now()
  browserData.window.hide()
  return {
    success: true,
    visible: browserData.window.isVisible()
  }
}

function getBootstrapSnapshot() {
  const store = ensureStateStore()
  const update = ensureUpdateService().getSnapshot()
  return {
    appVersion: app.getVersion(),
    machineFingerprint: '',
    settings: store.getSettings(),
    update,
    events: store.listEvents(180)
  }
}

logger.debug(`Token存储路径: ${tokenStorePath}`)

// 关闭后台节流，避免窗口最小化/被全屏窗口遮挡时脚本冻结
try {
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.commandLine.appendSwitch('disable-background-timer-throttling')
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
} catch (e) {
  logger.debug('追加后台节流禁用参数失败', e)
}

// ==================== 工具函数 ====================

function canUseSafeStorage() {
  try {
    return safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()
  } catch (e) {
    logger.debug('safeStorage 检测失败，降级普通存储', e)
    return false
  }
}

function getLegacyTokenStorePaths() {
  const candidates = [
    path.resolve(process.cwd(), 'tokens.json'),
    path.resolve(__dirname, '../../../tokens.json'),
    path.resolve((typeof app.getAppPath === 'function' ? app.getAppPath() : process.cwd()), 'tokens.json')
  ]
  const primary = path.resolve(tokenStorePath)
  return Array.from(new Set(candidates.map((item) => path.resolve(String(item || '')))))
    .filter((item) => item && item !== primary && fs.existsSync(item))
}

function mergeTokenRecords(current = {}, incoming = {}) {
  const currentScore = Math.max(Number(current?.savedAt || 0), Number(current?.cookieUpdatedAt || 0))
  const incomingScore = Math.max(Number(incoming?.savedAt || 0), Number(incoming?.cookieUpdatedAt || 0))
  const newer = incomingScore >= currentScore ? incoming : current
  const older = incomingScore >= currentScore ? current : incoming
  return {
    ...older,
    ...newer
  }
}

function readTokenStoreFile(filePath) {
  const normalizedPath = path.resolve(String(filePath || tokenStorePath))
  if (!fs.existsSync(normalizedPath)) return {}

  const raw = fs.readFileSync(normalizedPath, 'utf8')
  if (!raw || !raw.trim()) return {}

  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object') return {}

  if (parsed.__encrypted === true && typeof parsed.payload === 'string') {
    if (!canUseSafeStorage()) {
      throw new Error('当前系统不支持解密本地Token，请在原系统环境使用')
    }
    const decrypted = safeStorage.decryptString(Buffer.from(parsed.payload, 'base64'))
    const tokens = JSON.parse(decrypted)
    return (tokens && typeof tokens === 'object') ? tokens : {}
  }

  return parsed
}

function writeTokenStoreFile(filePath, tokens) {
  const normalizedPath = path.resolve(String(filePath || tokenStorePath))
  fs.mkdirSync(path.dirname(normalizedPath), { recursive: true })
  const payloadObj = tokens && typeof tokens === 'object' ? tokens : {}
  const jsonText = JSON.stringify(payloadObj)

  if (canUseSafeStorage()) {
    const encrypted = safeStorage.encryptString(jsonText).toString('base64')
    fs.writeFileSync(
      normalizedPath,
      JSON.stringify({ __encrypted: true, payload: encrypted }, null, 2)
    )
    return { encrypted: true }
  }

  fs.writeFileSync(normalizedPath, JSON.stringify(payloadObj, null, 2))
  return { encrypted: false }
}

/**
 * readTokenStore 方法：读取Token存储。
 */
function readTokenStore() {
  const legacyPaths = getLegacyTokenStorePaths()
  const merged = {}
  const sourcePaths = [tokenStorePath, ...legacyPaths]

  sourcePaths.forEach((filePath) => {
    try {
      const tokens = readTokenStoreFile(filePath)
      Object.entries(tokens || {}).forEach(([accountId, tokenInfo]) => {
        merged[accountId] = mergeTokenRecords(merged[accountId], tokenInfo)
      })
    } catch (error) {
      logger.warn(`读取Token失败: ${filePath} ${error?.message || error}`)
    }
  })

  if (legacyPaths.length > 0) {
    try {
      writeTokenStoreFile(tokenStorePath, merged)
    } catch (error) {
      logger.warn(`同步旧Token到新存储失败: ${error?.message || error}`)
    }
  }

  return merged
}

/**
 * writeTokenStore 方法：写入Token存储。
 */
function writeTokenStore(tokens) {
  const targets = Array.from(new Set([tokenStorePath, ...getLegacyTokenStorePaths()].map((item) => path.resolve(item))))
  let encrypted = false
  let primaryError = null

  targets.forEach((filePath, index) => {
    try {
      const result = writeTokenStoreFile(filePath, tokens)
      encrypted = encrypted || result.encrypted === true
    } catch (error) {
      if (index === 0) {
        primaryError = error
        return
      }
      logger.warn(`同步Token到兼容存储失败: ${filePath} ${error?.message || error}`)
    }
  })

  if (primaryError) {
    throw primaryError
  }

  return { encrypted }
}

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
 * normalizeCookieValue 方法：清洗 cookie 值（兼容“name=value; path=...”格式）。
 */
function normalizeCookieValue(name, rawValue) {
  let value = String(rawValue ?? '').trim().replace(/[\r\n]/g, '')
  if (!value) return ''
  const kvPrefix = `${name}=`
  if (value.startsWith(kvPrefix)) {
    value = value.slice(kvPrefix.length).trim()
  }
  const semiIdx = value.indexOf(';')
  if (semiIdx >= 0) {
    value = value.slice(0, semiIdx).trim()
  }
  return value
}

/**
 * setCookieWithFallback 方法：按多组参数回退写入 cookie，提升兼容性。
 */
async function setCookieWithFallback(accountSession, name, value, currentTime) {
  const isSessionCookie = name === 'sessionid' || name === 'sessionid_ss'
  const tryList = [
    { label: 'www-dot-lax', payload: { url: 'https://www.douyin.com/', name, value, domain: '.douyin.com', path: '/', secure: true, httpOnly: isSessionCookie, sameSite: 'lax', expirationDate: currentTime + 86400 * 30 } },
    { label: 'live-dot-lax', payload: { url: 'https://live.douyin.com/', name, value, domain: '.douyin.com', path: '/', secure: true, httpOnly: isSessionCookie, sameSite: 'lax', expirationDate: currentTime + 86400 * 30 } },
    { label: 'www-root-unspecified', payload: { url: 'https://www.douyin.com/', name, value, domain: 'douyin.com', path: '/', secure: true, httpOnly: isSessionCookie, sameSite: 'unspecified', expirationDate: currentTime + 86400 * 30 } },
    { label: 'live-host-session', payload: { url: 'https://live.douyin.com/', name, value, path: '/', secure: true, httpOnly: isSessionCookie, sameSite: 'unspecified' } },
    { label: 'www-host-session', payload: { url: 'https://www.douyin.com/', name, value, path: '/', secure: true, httpOnly: isSessionCookie, sameSite: 'unspecified' } }
  ]

  let lastError = null
  for (const item of tryList) {
    try {
      await accountSession.cookies.set(item.payload)
      return { ok: true, via: item.label }
    } catch (e) {
      lastError = e
    }
  }
  return { ok: false, error: lastError || new Error('Setting cookie failed') }
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

  const [cDomain, cWww, cLive] = await Promise.all([
    browserData.session.cookies.get({ domain: '.douyin.com' }).catch(() => []),
    browserData.session.cookies.get({ url: 'https://www.douyin.com/' }).catch(() => []),
    browserData.session.cookies.get({ url: 'https://live.douyin.com/' }).catch(() => [])
  ])
  const map = new Map()
  for (const c of [...cDomain, ...cWww, ...cLive]) {
    if (!c?.name) continue
    const key = `${c.name}|${c.domain || ''}|${c.path || ''}`
    map.set(key, c)
  }
  const cookies = Array.from(map.values())
  const cookieString = cookies
    .filter(c => c?.name && c?.value)
    .map(c => `${c.name}=${c.value}`)
    .join('; ')
  return { cookies, cookieString }
}

function normalizeCookieSnapshotItem(cookie = {}) {
  const name = String(cookie?.name || '').trim()
  const value = String(cookie?.value || '').trim()
  if (!name || !value) return null
  const domain = String(cookie?.domain || '').trim()
  const pathValue = String(cookie?.path || '/').trim() || '/'
  const sameSiteRaw = String(cookie?.sameSite || 'unspecified').trim().toLowerCase()
  const sameSite = ['no_restriction', 'lax', 'strict', 'unspecified'].includes(sameSiteRaw)
    ? sameSiteRaw
    : 'unspecified'
  return {
    name,
    value,
    domain,
    path: pathValue,
    secure: cookie?.secure !== false,
    httpOnly: !!cookie?.httpOnly,
    session: !!cookie?.session,
    expirationDate: Number(cookie?.expirationDate || 0),
    sameSite
  }
}

function buildCookieSnapshot(cookies = []) {
  return (Array.isArray(cookies) ? cookies : [])
    .map(normalizeCookieSnapshotItem)
    .filter(Boolean)
}

async function refreshTokenSnapshotFromSession(accountId, reason = 'sync') {
  const browserData = browserViews.get(accountId)
  if (!browserData) {
    return { success: false, error: 'browser_not_ready' }
  }
  try {
    const { cookies } = await getAccountCookiesAndString(accountId)
    if (!Array.isArray(cookies) || cookies.length === 0) {
      return { success: false, error: 'empty_cookies' }
    }
    const snapshot = buildCookieSnapshot(cookies)
    if (snapshot.length === 0) {
      return { success: false, error: 'snapshot_empty' }
    }
    const tokens = readTokenStore()
    const prev = tokens[accountId] || {}
    tokens[accountId] = {
      ...prev,
      cookieSnapshot: snapshot,
      cookieCount: cookies.length,
      cookieUpdatedAt: Date.now()
    }
    const writeResult = writeTokenStore(tokens)
    logger.debug(`[${accountId}] cookie 快照已更新(${reason}) size=${snapshot.length}`)
    return { success: true, count: snapshot.length, encrypted: writeResult.encrypted }
  } catch (error) {
    logger.debug(`[${accountId}] cookie 快照更新失败(${reason})`, error?.message || error)
    return { success: false, error: error?.message || 'snapshot_failed' }
  }
}

function parseCookieString(cookieString = '') {
  const result = {}
  String(cookieString || '')
    .split(';')
    .forEach((item) => {
      const index = item.indexOf('=')
      if (index <= 0) return
      const key = item.slice(0, index).trim()
      const value = item.slice(index + 1).trim()
      if (key) result[key] = value
    })
  return result
}

function resolveCookieUrlFromSnapshot(cookie = {}) {
  const domain = String(cookie?.domain || '').replace(/^\./, '').trim().toLowerCase()
  if (domain.includes('live.douyin.com')) return 'https://live.douyin.com/'
  return 'https://www.douyin.com/'
}

async function restoreCookieSnapshot(accountSession, snapshot = [], currentTime) {
  let setCount = 0
  const status = {}
  for (const item of Array.isArray(snapshot) ? snapshot : []) {
    const normalized = normalizeCookieSnapshotItem(item)
    if (!normalized) continue
    const payload = {
      url: resolveCookieUrlFromSnapshot(normalized),
      name: normalized.name,
      value: normalized.value,
      path: normalized.path || '/',
      secure: normalized.secure !== false,
      httpOnly: !!normalized.httpOnly,
      sameSite: normalized.sameSite || 'unspecified'
    }
    if (normalized.domain) {
      payload.domain = normalized.domain
    }
    if (!normalized.session) {
      const expiry = Number(normalized.expirationDate || 0)
      payload.expirationDate = expiry > currentTime ? expiry : (currentTime + 86400 * 30)
    }
    try {
      await accountSession.cookies.set(payload)
      setCount += 1
      status[normalized.name] = 'ok'
    } catch (error) {
      status[normalized.name] = 'failed'
      logger.debug(`restoreCookieSnapshot failed (${normalized.name})`, error)
    }
  }
  return { setCount, status }
}

/**
 * safeGetAccountCookieString 方法：获取账号 cookie header 字符串（失败时返回空串）。
 */
async function safeGetAccountCookieString(accountId) {
  if (!accountId) return ''
  try {
    const { cookieString } = await getAccountCookiesAndString(accountId)
    return cookieString
  } catch (e) {
    logger.warn('⚠️ 获取Cookie失败:', e.message)
    return ''
  }
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

/**
 * normalizeUserInfo 方法：归一化用户信息。
 */
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

/**
 * fetchUserInfoFromApis 方法：请求并获取用户信息接口结果。
 */
async function fetchUserInfoFromApis(cookieString) {
  if (!cookieString) return null
  const cookieMap = parseCookieString(cookieString)
  const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Cookie': cookieString
  }
  if (cookieMap.passport_csrf_token) {
    commonHeaders['x-tt-passport-csrf-token'] = cookieMap.passport_csrf_token
    commonHeaders['x-secsdk-csrf-token'] = cookieMap.passport_csrf_token
  }

  // 参考旧实现，优先使用 creator 接口
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
    logger.info(`[user-info] creator 接口失败: ${e.message}`)
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
    logger.info(`[user-info] aweme 接口失败: ${e.message}`)
  }

  return null
}

/**
 * inspectPageAuthState 方法：检测当前页面是否处于显式未登录态，并尝试从页面状态中提取用户信息。
 */
async function inspectPageAuthState(webContents) {
  try {
    const result = await webContents.executeJavaScript(`
      (function() {
        try {
          const fromState = window.__INITIAL_STATE__?.user || window.__INITIAL_STATE__?.userInfo || null;
          if (fromState) {
            const nick = fromState.nickname || fromState.nickName || fromState.nick_name;
            const uid = fromState.sec_uid || fromState.secUid || fromState.uid;
            return {
              authenticated: !!nick,
              nickname: nick || '',
              userId: uid || null,
              method: 'dom_state'
            };
          }

          const candidates = Array.from(document.querySelectorAll('a[href*="/user/"]'));
          for (const anchor of candidates) {
            const rect = anchor.getBoundingClientRect();
            if (!rect || rect.width < 20 || rect.height < 20) continue;
            if (rect.top < -8 || rect.top > 180) continue;
            if (rect.left < (window.innerWidth - 340)) continue;
            const href = anchor.getAttribute('href') || '';
            const match = href.match(/\\/user\\/([^/?#]+)/);
            const img = anchor.querySelector('img');
            const nick = (anchor.getAttribute('title')
              || anchor.getAttribute('aria-label')
              || img?.getAttribute('alt')
              || '').trim();
            return {
              authenticated: true,
              nickname: nick,
              userId: match ? match[1] : null,
              method: 'dom_avatar'
            };
          }
        } catch (_) {}
        return {
          authenticated: false,
          nickname: '',
          userId: null,
          method: 'dom_state'
        };
      })()
    `, true)
    return {
      authenticated: !!result?.authenticated,
      nickname: result?.nickname || '',
      userId: result?.userId || null,
      method: result?.method || 'dom_state'
    }
  } catch (e) {
    logger.info(`[user-info] 页面登录态检测失败: ${e.message}`)
  }
  return {
    authenticated: false,
    nickname: '',
    userId: null,
    method: 'dom_state'
  }
}

/**
 * resolveUserInfo 方法：解析并返回用户信息。
 */
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

  const pageState = await inspectPageAuthState(browserData.window.webContents)
  if (pageState?.nickname) {
    return {
      method: pageState.method || 'dom_state',
      nickname: pageState.nickname,
      userId: pageState.userId || null
    }
  }

  return null
}

/**
 * createWindow 方法：创建窗口配置。
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1720,
    height: 1060,
    minWidth: 1360,
    minHeight: 860,
    backgroundColor: '#081320',
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false
    }
  })

  // 开发环境加载 Vite 服务器
  const isDev = !app.isPackaged
  if (isDev) {
    mainWindow.loadURL(DESKTOP_DEV_SERVER_URL)
    // mainWindow.webContents.openDevTools() // 已禁用：不需要自动打开控制台
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(createWindow)
app.whenReady().then(() => {
  fs.mkdirSync(secureStateDir, { recursive: true })
  stateStore = createStateStore(app.getPath('userData'))
  updateService = createUpdateService({
    feedUrl: stateStore?.getSettings()?.updateFeedUrl || DEFAULT_SETTINGS.updateFeedUrl,
    onChange(snapshot) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('desktop:update-state', snapshot)
      }
    }
  })
})

/**
 * ensureKeepAwake 方法：确保常亮状态满足预期。
 */
function ensureKeepAwake() {
  try {
    if (keepAwakeBlockerId !== null && powerSaveBlocker.isStarted(keepAwakeBlockerId)) return
    keepAwakeBlockerId = powerSaveBlocker.start('prevent-app-suspension')
    logger.info(`已启用防休眠: blocker=${keepAwakeBlockerId}`)
  } catch (e) {
    logger.debug('启用防休眠失败', e)
  }
}

app.whenReady().then(ensureKeepAwake)
app.whenReady().then(() => {
  try {
    app.setAccessibilitySupportEnabled(false)
  } catch (e) {
    logger.debug('关闭无障碍支持失败', e)
  }
})
// 全局静音兜底（多账号场景避免偶发出声）
try {
  app.commandLine.appendSwitch('mute-audio')
} catch (e) {
  logger.debug('追加 mute-audio 启动参数失败', e)
}

app.on('will-quit', () => {
  try {
    if (keepAwakeBlockerId !== null && powerSaveBlocker.isStarted(keepAwakeBlockerId)) {
      powerSaveBlocker.stop(keepAwakeBlockerId)
    }
  } catch (_) {
    // ignore
  }
})

// 打印所有已注册的 IPC handlers（用于调试）
app.whenReady().then(() => {
  if (logger.getLevel() !== 'debug') return
  logger.debug('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  logger.debug('✅ Electron 应用已启动')
  logger.debug('📋 已注册的 IPC Handlers:')
  logger.debug('  - load-all-tokens')
  logger.debug('  - check-browser-exists')
  logger.debug('  - launch-browser')
  logger.debug('  - navigate-to')
  logger.debug('  - execute-script')
  logger.debug('  - close-browser')
  logger.debug('  - delete-token')
  logger.debug('  - get-user-info')
  logger.debug('  - clear-account-cache')
  logger.debug('  - get-login-token')
  logger.debug('  - save-token')
  logger.debug('  - load-token')
  logger.debug('  - set-cookies')
  logger.debug('  - search-live-by-all')
  logger.debug('  - search-live-by-category')
  logger.debug('  - get-lottery-detail')
  logger.debug('  - collect-lotteries-by-category')
  logger.debug('  - attend-lottery')
  logger.debug('  - room-like')
  logger.debug('  - room-chat')
  logger.debug('  - scan-debug-log')
  logger.debug('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
})

// ... 前面的代码保持不变 ...

function setAccountMonitoringState(accountId, enabled) {
  const browserData = browserViews.get(accountId)
  if (!browserData || !browserData.window || browserData.window.isDestroyed()) {
    return { success: false, error: '浏览器实例不存在', code: 'BROWSER_NOT_FOUND' }
  }
  browserData.monitoringEnabled = enabled === true
  const wc = browserData.window.webContents
  if (browserData.monitoringEnabled) {
    try {
      if (!wc.debugger.isAttached()) {
        wc.debugger.attach('1.3')
      }
      if (typeof browserData.bindDebuggerHooks === 'function') {
        browserData.bindDebuggerHooks()
      }
      wc.debugger.sendCommand('Network.enable').catch(() => {})
      return { success: true, enabled: true }
    } catch (error) {
      logger.error(`[${accountId}] Debugger attach error:`, error)
      return { success: false, error: error.message || 'monitor_enable_failed' }
    }
  }
  try {
    if (wc.debugger.isAttached()) {
      wc.debugger.sendCommand('Network.disable').catch(() => {})
      wc.debugger.detach()
    }
  } catch (_) {
    // ignore
  }
  return { success: true, enabled: false }
}

/**
 * scan-debug-log 方法：接收渲染进程扫描汇总并输出到主进程控制台，便于 IDE 观察每轮结果。
 */
ipcMain.handle('scan-debug-log', async (_event, payload = {}) => {
  try {
    const accountId = String(payload?.accountId || '')
    const stage = String(payload?.stage || payload?.type || 'scan')
    const request = Number(payload?.requestIndex || 0)
    const summary = payload?.summary && typeof payload.summary === 'object'
      ? payload.summary
      : payload
    const safeJson = JSON.stringify(summary || {})
    const maxLen = 3200
    const compact = safeJson.length > maxLen ? `${safeJson.slice(0, maxLen)}...` : safeJson
    const requestText = request > 0 ? ` request=${request}` : ''
    console.log(`[main-browserview] [scan-summary] [${accountId || 'unknown'}] [${stage}]${requestText} ${compact}`)
    return { success: true }
  } catch (error) {
    console.log('[main-browserview] [scan-summary] print-failed', error?.message || error)
    return { success: false, error: error?.message || String(error) }
  }
})

// ==================== 互动操作 ====================

// 参与福袋
ipcMain.handle('attend-lottery', async (event, { roomId, lotteryId, webRid = null, accountId }) => {
  try {
    const cookieString = await safeGetAccountCookieString(accountId)

    const commonHeaders = {
      cookie: cookieString,
      referer: `https://live.douyin.com/${webRid || roomId}`
    }

    /**
     * attemptAttend 方法：调用参与接口并归一化成功状态与错误信息。
     */
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
    } catch (e) {
      logger.debug(`[${accountId}] 使用 room_id 参与失败，准备回退 roomId 参数`, e)
    }

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
    const cookieString = await safeGetAccountCookieString(accountId)

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
    const cookieString = await safeGetAccountCookieString(accountId)

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
    const tokens = readTokenStore()
    logger.info(`已加载 ${Object.keys(tokens).length} 个账号的Token`)
    return { success: true, tokens }
  } catch (error) {
    logger.error('加载所有Token失败:', error)
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

ipcMain.handle('launch-browser', async (event, payload) => {
  try {
    const accountId = typeof payload === 'string'
      ? String(payload || '').trim()
      : String(payload?.accountId || '').trim()
    const visible = typeof payload === 'object' && payload?.visible === true
    if (!accountId) {
      throw new Error('accountId required')
    }
    const previousBrowserData = browserViews.get(accountId)
    if (previousBrowserData) {
      previousBrowserData.superseded = true
    }

    // 为每个账号创建独立的 session partition
    const partition = `persist:douyin_${accountId}`
    const instanceId = `${accountId}:${++browserInstanceSeq}`
    
    // 创建新窗口用于显示抖音页面
    const browserWindow = new BrowserWindow({
      width: 1280,
      height: 860,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#081320',
      titleBarStyle: 'hiddenInset',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        partition: partition, // 独立的session，每个账号互不干扰
        backgroundThrottling: false
      }
    })
    
    // 获取该账号的独立 session
    const accountSession = browserWindow.webContents.session

    logger.info(`[${accountId}] 已创建独立session: ${partition}`)

    // 参考福袋：默认静音，避免多账号运行时音频干扰
    try {
      browserWindow.webContents.setAudioMuted(true)
    } catch (e) {
      logger.debug(`[${accountId}] 启动后静音失败`, e)
    }
    
    const instanceData = {
      window: browserWindow,
      session: accountSession,
      partition: partition,
      blockMediaRequests: false,
      instanceId,
      lastUrl: 'https://www.douyin.com',
      lastRecoverAt: 0,
      recoveryTimer: null,
      debuggerBound: false,
      superseded: false,
      monitoringEnabled: false,
      bindDebuggerHooks: null,
      requestedVisible: visible,
      lastShownAt: visible ? Date.now() : 0,
      lastHiddenAt: visible ? 0 : Date.now()
    }
    browserViews.set(accountId, instanceData)

    if (previousBrowserData?.window && !previousBrowserData.window.isDestroyed()) {
      try {
        previousBrowserData.window.close()
      } catch (e) {
        logger.debug(`[${accountId}] 关闭旧窗口失败`, e)
      }
    }

    // session 级拦截：拒绝 openExternal，避免触发系统协议弹窗
    if (!protocolGuardPartitions.has(partition)) {
      protocolGuardPartitions.add(partition)
      accountSession.setPermissionCheckHandler((webContents, permission) => {
        if (permission === 'openExternal') {
          return false
        }
        return true
      })
      accountSession.setPermissionRequestHandler((webContents, permission, callback) => {
        if (permission === 'openExternal') {
          callback(false)
          return
        }
        callback(true)
      })
      accountSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
        if (isBlockedExternalProtocol(details?.url)) {
          logger.info(`[${accountId}] session 已拦截外部协议请求: ${details.url}`)
          callback({ cancel: true })
          return
        }
        if (shouldBlockMediaForAccount(accountId) && isBlockedMediaRequest(details)) {
          logger.debug(`[${accountId}] session 已拦截媒体资源: ${details.url}`)
          callback({ cancel: true })
          return
        }
        callback({ cancel: false })
      })
    }

    // webContents 级拦截：窗口打开与跳转都禁止外部协议
    browserWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isBlockedExternalProtocol(url)) {
        logger.info(`[${accountId}] 已拦截外部协议: ${url}`)
        return { action: 'deny' }
      }
      // http/https 正常在当前窗口打开
      if (isHttpLikeUrl(url)) {
        rememberBrowserUrl(accountId, url)
        browserWindow.loadURL(url).catch((e) => {
          logger.debug(`[${accountId}] 外链当前窗打开失败: ${url}`, e)
        })
      } else {
        logger.info(`[${accountId}] 已阻止未知协议打开: ${url}`)
      }
      return { action: 'deny' }
    })
    browserWindow.webContents.on('will-navigate', (e, url) => {
      if (isBlockedExternalProtocol(url)) {
        e.preventDefault()
        logger.info(`[${accountId}] 已阻止页面跳转到外部协议: ${url}`)
      }
    })
    browserWindow.webContents.on('will-frame-navigate', (e, url) => {
      if (isBlockedExternalProtocol(url)) {
        e.preventDefault()
        logger.info(`[${accountId}] 已阻止 frame 外部协议跳转: ${url}`)
      }
    })
    browserWindow.webContents.on('will-redirect', (e, url) => {
      if (isBlockedExternalProtocol(url)) {
        e.preventDefault()
        logger.info(`[${accountId}] 已阻止外部协议重定向: ${url}`)
      }
    })
    
    const bindDebuggerHooks = () => {
      const browserData = browserViews.get(accountId)
      if (!browserData || browserData.debuggerBound === true) return
      browserData.debuggerBound = true
      const wc = browserWindow.webContents
      wc.debugger.on('detach', (event, reason) => {
        logger.info(`[${accountId}] Debugger detached:`, reason)
      })
      wc.debugger.on('message', async (event, method, params) => {
        if (method !== 'Network.responseReceived') return
        const { url } = params.response
        const requestId = params.requestId

        const isLottery = url.includes('webcast/lottery/melon/check_user_right')
        const isRedPacket = url.includes('webcast/luckybox/receive')
        const isWallet = url.includes('webcast/wallet/info')

        if (isLottery || isRedPacket || isWallet) {
          try {
            const { body } = await wc.debugger.sendCommand('Network.getResponseBody', { requestId })
            const json = JSON.parse(body)

            mainWindow.webContents.send('douyin-response', {
              accountId,
              type: isLottery ? 'lottery' : (isRedPacket ? 'redpacket' : 'wallet'),
              data: json.data
            })
          } catch (e) {
            logger.debug(`[${accountId}] 读取网络响应体失败`, e)
          }
        }
      })
    }
    instanceData.bindDebuggerHooks = bindDebuggerHooks

    browserWindow.once('ready-to-show', () => {
      if (!browserWindow.isDestroyed() && instanceData.requestedVisible) {
        revealAccountWindow(accountId)
      }
    })

    // 监听页面加载完成
    browserWindow.webContents.on('did-finish-load', () => {
      logger.debug(`[${accountId}] 页面加载完成`)
      rememberBrowserUrl(accountId, browserWindow.webContents.getURL())
      try {
        browserWindow.webContents.setAudioMuted(true)
      } catch (e) {
        logger.debug(`[${accountId}] did-finish-load 静音失败`, e)
      }
      
      if (instanceData.monitoringEnabled === true) {
        setAccountMonitoringState(accountId, true)
      }
    })
    browserWindow.on('show', () => {
      instanceData.lastShownAt = Date.now()
    })
    browserWindow.on('hide', () => {
      instanceData.lastHiddenAt = Date.now()
    })

    // 页面跳转后再次强制静音，防止站点恢复音量
    browserWindow.webContents.on('did-navigate', () => {
      rememberBrowserUrl(accountId, browserWindow.webContents.getURL())
      try {
        browserWindow.webContents.setAudioMuted(true)
      } catch (e) {
        logger.debug(`[${accountId}] did-navigate 静音失败`, e)
      }
    })
    browserWindow.webContents.on('did-navigate-in-page', () => {
      rememberBrowserUrl(accountId, browserWindow.webContents.getURL())
      try {
        browserWindow.webContents.setAudioMuted(true)
      } catch (e) {
        logger.debug(`[${accountId}] did-navigate-in-page 静音失败`, e)
      }
    })
    browserWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return
      logger.warn(`[${accountId}] 页面加载失败: ${validatedURL} (${errorCode}) ${errorDescription}`)
      rememberBrowserUrl(accountId, validatedURL)
      scheduleBrowserRecovery(accountId, `did-fail-load:${errorCode}`, validatedURL)
    })
    browserWindow.webContents.on('render-process-gone', (event, details) => {
      logger.error(`[${accountId}] 渲染进程异常退出: ${details?.reason || 'unknown'}`)
      scheduleBrowserRecovery(accountId, `render-process-gone:${details?.reason || 'unknown'}`)
    })
    browserWindow.webContents.on('unresponsive', () => {
      logger.warn(`[${accountId}] 页面无响应，尝试恢复`)
      scheduleBrowserRecovery(accountId, 'unresponsive')
    })
    
    // 监听窗口关闭
    browserWindow.on('closed', () => {
      logger.info(`[${accountId}] 窗口已关闭`)
      if (instanceData.recoveryTimer) {
        clearTimeout(instanceData.recoveryTimer)
      }
      const currentBrowserData = browserViews.get(accountId)
      const isCurrentWindow = currentBrowserData
        && currentBrowserData.window === browserWindow
        && currentBrowserData.instanceId === instanceId
      if (!isCurrentWindow) {
        logger.debug(`[${accountId}] 忽略旧窗口关闭事件: ${instanceId}`)
        return
      }
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
    logger.error('启动浏览器失败:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('set-live-stream-blocking', async (event, { accountId, enabled }) => {
  try {
    const browserData = browserViews.get(accountId)
    if (!browserData || !browserData.window || browserData.window.isDestroyed()) {
      return { success: false, error: '浏览器实例不存在', code: 'BROWSER_NOT_FOUND' }
    }
    browserData.blockMediaRequests = false
    logger.info(`[${accountId}] 直播流拦截功能已临时停用，保持关闭状态`)
    return { success: true, enabled: browserData.blockMediaRequests }
  } catch (error) {
    logger.error('设置直播流拦截失败:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('navigate-to', async (event, { accountId, url }) => {
  try {
    const browserData = browserViews.get(accountId)
    if (!browserData) {
      throw new Error('浏览器实例不存在')
    }
    if (isBlockedExternalProtocol(url) || !isHttpLikeUrl(url)) {
      throw new Error(`禁止导航到外部协议: ${url}`)
    }
    rememberBrowserUrl(accountId, url)
    await browserData.window.loadURL(url)
    return { success: true }
  } catch (error) {
    logger.error('导航失败:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('execute-script', async (event, { accountId, script, timeoutMs = 4500 }) => {
  try {
    const browserData = browserViews.get(accountId)
    if (!browserData) {
      throw new Error('浏览器实例不存在')
    }

    const safeTimeoutMs = Math.max(1200, Math.min(30000, Number(timeoutMs || 4500)))
    const result = await Promise.race([
      browserData.window.webContents.executeJavaScript(script),
      new Promise((_, reject) => {
        setTimeout(() => {
          const error = new Error('执行脚本超时')
          error.code = 'EXECUTE_TIMEOUT'
          reject(error)
        }, safeTimeoutMs)
      })
    ])
    return { success: true, result }
  } catch (error) {
    if (String(error?.message || '').includes('执行脚本超时') || error?.code === 'EXECUTE_TIMEOUT') {
      scheduleBrowserRecovery(accountId, 'execute-script-timeout')
      return { success: false, error: '执行脚本超时', code: 'EXECUTE_TIMEOUT' }
    }
    logger.error('执行脚本失败:', error)
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

ipcMain.handle('set-account-monitoring', async (_event, { accountId, enabled }) => {
  return setAccountMonitoringState(String(accountId || '').trim(), enabled === true)
})

ipcMain.handle('desktop:get-bootstrap', async () => {
  return getBootstrapSnapshot()
})

ipcMain.handle('desktop:save-settings', async (_event, payload = {}) => {
  try {
    const settings = ensureStateStore().saveSettings(payload)
    const nextFeedUrl = String(settings?.updateFeedUrl || '').trim()
    if (nextFeedUrl && updateService?.getSnapshot()?.feedUrl !== nextFeedUrl) {
      updateService = createUpdateService({
        feedUrl: nextFeedUrl,
        onChange(snapshot) {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('desktop:update-state', snapshot)
          }
        }
      })
    }
    return { success: true, settings }
  } catch (error) {
    return { success: false, error: error.message, settings: ensureStateStore().getSettings() }
  }
})

ipcMain.handle('desktop:show-account-window', async (_event, { accountId } = {}) => {
  try {
    return revealAccountWindow(String(accountId || '').trim())
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('desktop:hide-account-window', async (_event, { accountId } = {}) => {
  try {
    return concealAccountWindow(String(accountId || '').trim())
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('desktop:get-update-state', async () => ensureUpdateService().getSnapshot())
ipcMain.handle('desktop:check-for-updates', async () => ensureUpdateService().check())
ipcMain.handle('desktop:download-update', async () => ensureUpdateService().download())
ipcMain.handle('desktop:install-update', async () => ({ success: ensureUpdateService().install() }))

ipcMain.handle('desktop:append-event', async (_event, payload = {}) => {
  try {
    const item = appendRuntimeEvent(payload.level, payload.message, payload.scope)
    return { success: true, item }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// ==================== 删除账号Token ====================

ipcMain.handle('delete-token', async (event, accountId) => {
  try {
    const tokens = readTokenStore()
    if (Object.keys(tokens).length === 0) {
      return { success: true, message: 'Token文件不存在' }
    }
    
    if (tokens[accountId]) {
      delete tokens[accountId]
      writeTokenStore(tokens)
      logger.info(`Token已删除: ${accountId}`)
      return { success: true, message: 'Token已删除' }
    } else {
      return { success: true, message: '该账号Token不存在' }
    }
  } catch (error) {
    logger.error('删除Token失败:', error)
    return { success: false, error: error.message }
  }
})

// ==================== 手动获取用户信息 ====================

ipcMain.handle('get-user-info', async (event, accountId) => {
  try {
    logger.info(`[${accountId}] 开始获取用户信息...`)
    const browserData = browserViews.get(accountId)
    if (!browserData) {
      throw new Error('浏览器实例不存在')
    }
    const userInfo = await resolveUserInfo(accountId, { waitMs: 1500 })
    
    if (userInfo && userInfo.nickname) {
      logger.info(`✅ [${accountId}] 获取到用户信息 (${userInfo.method}): ${userInfo.nickname} ${userInfo.userId || ''}`)
      return { success: true, userInfo }
    } else {
      logger.info(`⚠️ [${accountId}] 未能获取到用户信息`)
      return { success: false, error: '未能获取到用户信息' }
    }
  } catch (error) {
    logger.error(`❌ [${accountId}] 获取用户信息异常:`, error)
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
    
    logger.info(`[${accountId}] 开始清除缓存...`)
    
    // 清除所有缓存和存储数据
    await browserData.session.clearStorageData({
      storages: ['cookies', 'localstorage', 'sessionstorage', 'cachestorage', 'indexdb', 'websql']
    })
    
    // 清除缓存
    await browserData.session.clearCache()
    
    logger.info(`✅ [${accountId}] 缓存已清除`)
    
    return { success: true, message: '缓存已清除' }
  } catch (error) {
    logger.error(`❌ [${accountId}] 清除缓存失败:`, error)
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
    tokenInfo.cookieSnapshot = buildCookieSnapshot(cookies)
    
    const hasSessionCookie = !!tokenInfo.sessionid || !!tokenInfo.sessionid_ss
    const browserData = browserViews.get(accountId)
    const pageState = browserData
      ? await inspectPageAuthState(browserData.window.webContents)
      : { authenticated: false }
    let isLoggedIn = hasSessionCookie

    // 尝试获取用户信息
    let userInfo = null
    if (isLoggedIn) {
      try {
        userInfo = await resolveUserInfo(accountId, { waitMs: 1200 })
        if (userInfo && userInfo.nickname) {
          logger.info(`✅ 获取到用户信息: ${userInfo.nickname} ${userInfo.userId ? '(' + userInfo.userId + ')' : ''}`)
        } else {
          logger.info('⚠️ 未能获取到用户信息，将使用默认值')
        }
      } catch (e) {
        logger.info('⚠️ 获取用户信息异常:', e.message)
      }
    }
    isLoggedIn = hasSessionCookie && (!!userInfo?.nickname || !!pageState?.authenticated)
    
    return { 
      success: true, 
      isLoggedIn,
      tokenInfo,
      userInfo,
      cookieCount: cookies.length,
      pageAuthenticated: !!pageState?.authenticated
    }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('save-token', async (event, { accountId, tokenInfo, userInfo = null }) => {
  try {
    const tokens = readTokenStore()

    let normalizedTokenInfo = { ...(tokenInfo || {}) }
    if (!Array.isArray(normalizedTokenInfo.cookieSnapshot) || normalizedTokenInfo.cookieSnapshot.length === 0) {
      try {
        const { cookies } = await getAccountCookiesAndString(accountId)
        const snapshot = buildCookieSnapshot(cookies)
        if (snapshot.length > 0) {
          normalizedTokenInfo.cookieSnapshot = snapshot
          normalizedTokenInfo.cookieCount = cookies.length
          normalizedTokenInfo.cookieUpdatedAt = Date.now()
        }
      } catch (e) {
        logger.debug(`[${accountId}] 保存Token时获取cookie快照失败`, e?.message || e)
      }
    }

    tokens[accountId] = {
      ...normalizedTokenInfo,
      nickname: userInfo?.nickname || tokenInfo.nickname || `账号_${accountId}`,
      userId: userInfo?.userId || tokenInfo.userId || accountId,
      savedAt: Date.now()
    }
    
    const writeResult = writeTokenStore(tokens)
    logger.info(`Token已保存: ${accountId} (${tokens[accountId].nickname})`)
    
    return { success: true, savedInfo: tokens[accountId], encrypted: writeResult.encrypted }
  } catch (error) {
    logger.error('保存Token失败:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('load-token', async (event, accountId) => {
  try {
    const tokens = readTokenStore()
    if (Object.keys(tokens).length === 0) {
      return { success: false, error: 'Token文件不存在' }
    }
    
    if (!tokens[accountId]) {
      return { success: false, error: '该账号Token不存在' }
    }
    
    return { success: true, tokenInfo: tokens[accountId] }
  } catch (error) {
    logger.error('加载Token失败:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('set-cookies', async (event, { accountId, tokenInfo }) => {
  try {
    const browserData = browserViews.get(accountId)
    if (!browserData) {
      throw new Error('浏览器实例不存在')
    }
    
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
    const setStatus = {}

    if (Array.isArray(tokenInfo?.cookieSnapshot) && tokenInfo.cookieSnapshot.length > 0) {
      const snapshotResult = await restoreCookieSnapshot(browserData.session, tokenInfo.cookieSnapshot, currentTime)
      setCookieCount += Number(snapshotResult.setCount || 0)
      Object.assign(setStatus, snapshotResult.status || {})
      logger.info(`✅ [${accountId}] 已恢复 cookie 快照: ${snapshotResult.setCount || 0} 项`)
    }
    
    for (const name of cookieFields) {
      const rawValue = tokenInfo?.[name]
      const value = normalizeCookieValue(name, rawValue)
      if (value && value.length > 0) {
        try {
          const result = await setCookieWithFallback(browserData.session, name, value, currentTime)
          if (!result.ok) {
            throw result.error
          }
          setCookieCount += 1
          setStatus[name] = 'ok'
          logger.info(`✅ [${accountId}] 已设置 cookie: ${name} (${result.via})`)
        } catch (e) {
          setStatus[name] = 'failed'
          logger.error(`❌ [${accountId}] 设置 cookie 失败 (${name}):`, e?.message || e)
        }
      }
    }

    // 校验关键登录cookie是否写入成功
    const verifyLiveCookies = await browserData.session.cookies.get({ url: 'https://live.douyin.com/' })
    const verifyWwwCookies = await browserData.session.cookies.get({ url: 'https://www.douyin.com/' })
    const merged = [...verifyLiveCookies, ...verifyWwwCookies]
    const hasSessionid = merged.some(c => c?.name === 'sessionid' && c?.value)
    const hasSessionidSs = merged.some(c => c?.name === 'sessionid_ss' && c?.value)
    const hasTtwid = merged.some(c => c?.name === 'ttwid' && c?.value)
    const isLoginCookieReady = hasSessionid || hasSessionidSs

    logger.info(`✅ [${accountId}] 共设置 ${setCookieCount} 个 cookies`)
    if (!isLoginCookieReady) {
      logger.warn(`⚠️ [${accountId}] 登录关键cookie未就绪: sessionid=${hasSessionid} sessionid_ss=${hasSessionidSs} ttwid=${hasTtwid}`)
      return {
        success: false,
        count: setCookieCount,
        status: setStatus,
        isLoginCookieReady: false,
        error: '关键登录cookie写入失败'
      }
    }

    // 关键 cookie 写入成功后，立即同步完整快照，避免仅保存部分字段
    refreshTokenSnapshotFromSession(accountId, 'set-cookies').catch(() => {})

    return {
      success: true,
      count: setCookieCount,
      status: setStatus,
      isLoginCookieReady: true
    }
  } catch (error) {
    logger.error(`❌ [${accountId}] 设置Cookie失败:`, error)
    return { success: false, error: error.message }
  }
})

// ==================== 福袋收集 ====================

// 搜索直播间-【全部】
ipcMain.handle('search-live-by-all', async (event, { accountId = null, customCount = 24, maxTime = null } = {}) => {
  try {
    traceScan('request search-live-by-all', {
      accountId: accountId || '',
      customCount: Math.max(8, Number(customCount) || 24),
      maxTime: Number(maxTime) > 0 ? Number(maxTime) : null
    })

    const cookieString = await safeGetAccountCookieString(accountId)
    
    // 完全按照原项目的参数
    const params = {
      live_id: 1,
      enter_from: 'page_refresh',
      cookie_enabled: true,
      request_tag_from: 'web',
      need_map: '1',
      liveid: '1',
      is_draw: '1',
      inner_from_drawer: '0',
      custom_count: String(Math.max(8, Number(customCount) || 24)),
      action: 'load_more',
      action_type: 'loadmore',
      enter_source: 'web_homepage_hot_web_live_card',
      source_key: 'web_homepage_hot_web_live_card'
    }
    if (Number(maxTime) > 0) {
      params.max_time = String(Number(maxTime))
    }

    const json = await douyinLiveRemote('/webcast/feed/', params, {
      cookie: cookieString
    })
    
    // 详细日志
    logger.debug(`[search-live-by-all] 响应状态:`, json ? 'OK' : 'NULL')
    if (json) {
      logger.debug(`[search-live-by-all] 响应结构:`, {
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
      logger.error(`[search-live-by-all] API错误: ${json.status_code} - ${errorMsg}`)
      return { success: false, error: `API错误(${json.status_code}): ${errorMsg}` }
    }
    
    if (!json.data || !Array.isArray(json.data)) {
      logger.error(`[search-live-by-all] 数据格式错误:`, JSON.stringify(json).substring(0, 500))
      return { success: false, error: '响应数据格式错误', detail: json }
    }
    
    // 放宽预筛选：不强依赖 has_ongoing_lottery 标记，避免漏扫真实可参与福袋。
    const mappedRooms = json.data
      .map(room => {
        const roomData = room?.data || {}
        const roomId = String(roomData?.id_str || '')
        if (!roomId) return null
        return {
          webRid: room?.web_rid || roomId,
          roomId,
          roomTitle: roomData?.title || '',
          authorNickname: roomData?.owner?.nickname || '',
          authorSecUid: roomData?.owner?.sec_uid || '',
          onlineTotal: roomData?.user_count || 0,
          hasLotteryHint: Boolean(roomData?.others?.web_enter_benefit_point_data?.has_ongoing_lottery)
        }
      })
      .filter(Boolean)
    const roomInfoList = mappedRooms

    const hasMore = Boolean(json?.extra?.has_more)
    const nextMaxTime = Number(json?.extra?.max_time || 0)
    const hintedCount = roomInfoList.filter(v => v?.hasLotteryHint === true).length

    logger.debug(`[search-live-by-all] 找到 ${roomInfoList.length} 个有福袋的直播间`)
    traceScan('response search-live-by-all', {
      accountId: accountId || '',
      success: true,
      rawCount: Array.isArray(json?.data) ? json.data.length : 0,
      lotteryRooms: roomInfoList.length,
      lotteryHintCount: hintedCount,
      hasMore,
      nextMaxTime: nextMaxTime > 0 ? nextMaxTime : null
    })
    return {
      success: true,
      roomInfoList,
      hasMore,
      nextMaxTime: nextMaxTime > 0 ? nextMaxTime : null,
      rawCount: Array.isArray(json?.data) ? json.data.length : 0
    }
  } catch (error) {
    traceScan('response search-live-by-all', {
      accountId: accountId || '',
      success: false,
      error: error?.message || 'unknown'
    })
    logger.error('搜索全部直播间失败:', error)
    return { success: false, error: error.message }
  }
})

// 搜索直播间-【分类】
ipcMain.handle('search-live-by-category', async (event, { accountId = null, categoryId = '0', offset = 0, count = 15 } = {}) => {
  try {
    traceScan('request search-live-by-category', {
      accountId: accountId || '',
      categoryId: String(categoryId || '0'),
      offset: Math.max(0, Number(offset) || 0),
      count: Math.max(1, Number(count) || 15)
    })

    const cookieString = await safeGetAccountCookieString(accountId)
    
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
    logger.debug(`[search-live-by-category] 分类:${categoryId}, offset:${offset}`)
    if (json) {
      logger.debug(`[search-live-by-category] 响应结构:`, {
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
      logger.error(`[search-live-by-category] API错误: ${json.status_code} - ${errorMsg}`)
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
      const nextOffset = Math.max(0, Number(offset) || 0) + Math.max(0, Number(count) || 15)
      return {
        success: true,
        roomInfoList: [],
        rawCount: 0,
        hasMore: false,
        nextOffset
      }
    }
    
    // 分类接口字段做兼容解析；不强依赖 has_ongoing_lottery，避免漏扫。
    const roomInfoList = rawList
      .map(item => {
        const room = item?.room || item?.data || item
        const roomId = String(room?.id_str || '')
        if (!roomId) return null
        return {
          webRid: item?.web_rid || item?.webRid || room?.web_rid || roomId,
          roomId,
          roomTitle: room.title || '',
          authorNickname: room?.owner?.nickname || '',
          authorSecUid: room?.owner?.sec_uid || '',
          onlineTotal: room?.user_count || 0,
          hasLotteryHint: Boolean(
            room?.others?.web_enter_benefit_point_data?.has_ongoing_lottery ||
            item?.others?.web_enter_benefit_point_data?.has_ongoing_lottery
          )
        }
      })
      .filter(Boolean)
    
    const nextOffset = Math.max(0, Number(offset) || 0) + Math.max(0, Number(count) || 15)
    const hasMore = Boolean(
      json?.data?.has_more ??
      json?.extra?.has_more ??
      (rawList.length >= Math.max(1, Number(count) || 15))
    )

    logger.debug(`[search-live-by-category] 原始${rawList.length}个, 筛出${roomInfoList.length}个有福袋直播间`)
    traceScan('response search-live-by-category', {
      accountId: accountId || '',
      categoryId: String(categoryId || '0'),
      success: true,
      rawCount: rawList.length,
      lotteryRooms: roomInfoList.length,
      lotteryHintCount: roomInfoList.filter(v => v?.hasLotteryHint === true).length,
      hasMore,
      nextOffset
    })
    return {
      success: true,
      roomInfoList,
      rawCount: rawList.length,
      hasMore,
      nextOffset
    }
  } catch (error) {
    traceScan('response search-live-by-category', {
      accountId: accountId || '',
      categoryId: String(categoryId || '0'),
      success: false,
      error: error?.message || 'unknown'
    })
    logger.error('搜索分类直播间失败:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-lottery-detail', async (event, { roomId, webRid = null, accountId }) => {
  try {
    traceScan('request get-lottery-detail', {
      accountId: accountId || '',
      roomId: String(roomId || ''),
      webRid: String(webRid || '')
    })

    const cookieString = await safeGetAccountCookieString(accountId)

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

    // 扫描阶段不做条件过滤，所有福袋详情直接返回给上层，由服务端统一筛选。
    const conditions = Array.isArray(lottery_info.conditions) ? lottery_info.conditions : []

    const lotteryDetail = {
      lottery_id: lottery_info.lottery_id_str,
      anchorId: lottery_info.anchor_id,
      joinTotal: lottery_info.candidate_num || 0,
      winningTotal: lottery_info.lucky_count || 0,
      lotteryTotal: lottery_info.prize_count || 0,
      lotteryName: lottery_info.prize_info?.name || '未知奖品',
      prize_name: lottery_info.prize_info?.name || '未知奖品',
      prizeType: lottery_info.prize_type || lottery_info.prize_info?.type || lottery_info.prize_info?.prize_type || 0,
      prizeInfo: lottery_info.prize_info || {},
      total_amount: lottery_info.total_amount || lottery_info.prize_info?.total_amount || 0,
      start_time: lottery_info.start_time,
      end_time: lottery_info.draw_time,
      conditions
    }

    traceScan('response get-lottery-detail', {
      accountId: accountId || '',
      roomId: String(roomId || ''),
      success: true,
      lotteryId: String(lotteryDetail.lottery_id || ''),
      joinTotal: Number(lotteryDetail.joinTotal || 0),
      luckyCount: Number(lotteryDetail.winningTotal || 0),
      conditions: conditions.map(c => Number(c?.type)).filter(n => Number.isFinite(n))
    })
    return { success: true, lotteryDetail }
  } catch (error) {
    traceScan('response get-lottery-detail', {
      accountId: accountId || '',
      roomId: String(roomId || ''),
      success: false,
      error: error?.message || 'unknown',
      code: error?.code || ''
    })
    logger.error('获取福袋详情失败:', error)
    const message = error?.code === 'NON_JSON_RESPONSE'
      ? `接口返回非JSON内容(${error.statusCode || 'unknown'})`
      : error.message
    return {
      success: false,
      error: message,
      code: error?.code || 'UNKNOWN',
      statusCode: Number(error?.statusCode || 0)
    }
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
        cookieString = await safeGetAccountCookieString(accountId)
        dynamicParams = extractParamsFromCookie(cookieString)
        logger.debug(`[分类扫描] 使用账号 ${accountId} 的Cookie`)
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
