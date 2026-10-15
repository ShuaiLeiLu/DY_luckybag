const { app, BrowserWindow, ipcMain, safeStorage, powerSaveBlocker } = require('electron')
const path = require('path')
const fs = require('fs')
const { createLogger } = require('./logger')
const { createHotUpdateService } = require('./hot-update-service')
const { createStateStore, DEFAULT_SETTINGS } = require('./state-store')
const { createUpdateService } = require('./update-service')
const { AndroidBridgeClient } = require('./android-bridge-client')
const { AndroidProtocolClient } = require('./android-protocol-client')
const { AndroidDouyinBackend } = require('./android-douyin-backend')
const { DouyinBackendManager } = require('./douyin-backend-manager')
const { FIXED_CATEGORY_DEFAULT } = require('./douyin-response-parser')
const { requestJson } = require('./request-json')
const {
  revealAccountWindow,
  concealAccountWindow
} = require('./account-window-manager')
const {
  configureTokenStore,
  readTokenStore,
  writeTokenStore,
  buildCookieStringFromTokenRecord
} = require('./token-store')
const {
  normalizeCookieHeaderString,
  buildCookieStringForHost,
  normalizeCookieSnapshotItem,
  resolveCookieUrlFromSnapshot,
  parseCookieString,
  normalizeCookieValue
} = require('./cookie-utils')
const { createDesktopWindow } = require('./desktop-window')

function resolvePackagedProjectRootDir() {
  const execPath = path.resolve(String(process.execPath || ''))
  if (!execPath) return process.cwd()
  const execDir = path.dirname(execPath)
  if (process.platform === 'darwin') {
    const appBundleDir = path.resolve(execDir, '..', '..')
    return path.dirname(appBundleDir)
  }
  return execDir
}

function resolveProjectRootDir() {
  const fromEnv = String(process.env.DY_PROJECT_ROOT || '').trim()
  if (fromEnv) return path.resolve(fromEnv)

  if (app.isPackaged) {
    return resolvePackagedProjectRootDir()
  }

  const candidates = [
    path.resolve(__dirname, '..', '..', '..'),
    process.cwd()
  ]

  for (const start of candidates) {
    let current = path.resolve(start)
    for (let i = 0; i < 8; i += 1) {
      const pkgPath = path.join(current, 'package.json')
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
          if (String(pkg?.name || '').trim() === 'dy-fudai-desktop') {
            return current
          }
        } catch (_) {}
      }
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
  }
  return path.resolve(__dirname, '..', '..', '..')
}

function migrateLegacyUserDataDir(legacyUserDataDir, projectUserDataDir) {
  const sourceDir = path.resolve(String(legacyUserDataDir || ''))
  const targetDir = path.resolve(String(projectUserDataDir || ''))
  if (!sourceDir || !targetDir) return
  if (sourceDir === targetDir) return
  if (!fs.existsSync(sourceDir)) return
  try {
    fs.mkdirSync(targetDir, { recursive: true })
    const entries = fs.readdirSync(sourceDir)
    let copiedCount = 0
    for (const entry of entries) {
      const sourcePath = path.join(sourceDir, entry)
      const targetPath = path.join(targetDir, entry)
      if (fs.existsSync(targetPath)) continue
      fs.cpSync(sourcePath, targetPath, { recursive: true })
      copiedCount += 1
    }
    if (copiedCount > 0) {
      console.log(`[desktop-storage] migrated legacy userData: ${sourceDir} -> ${targetDir} (entries=${copiedCount})`)
    }
  } catch (error) {
    console.warn(`[desktop-storage] migrate legacy userData failed: ${String(error?.message || error)}`)
  }
}

function configureProjectUserDataDir() {
  const legacyUserDataDir = app.getPath('userData')
  const projectRootDir = resolveProjectRootDir()
  const projectUserDataDir = path.join(projectRootDir, 'dy-fudai-desktop')
  if (/\.asar([\\/]|$)/i.test(projectUserDataDir)) {
    console.warn(`[desktop-storage] skip project userData inside asar: ${projectUserDataDir}`)
    return
  }
  try {
    fs.mkdirSync(projectUserDataDir, { recursive: true })
    migrateLegacyUserDataDir(legacyUserDataDir, projectUserDataDir)
    app.setPath('userData', projectUserDataDir)
    console.log(`[desktop-storage] userData => ${projectUserDataDir}`)
  } catch (error) {
    console.warn(`[desktop-storage] set userData failed, fallback to default: ${String(error?.message || error)}`)
  }
}

configureProjectUserDataDir()

let mainWindow
let browserViews = new Map() // 存储多个BrowserView实例
let keepAwakeBlockerId = null
let browserInstanceSeq = 0
let stateStore = null
let updateService = null
let hotUpdateService = null

const logger = createLogger('main-browserview', { defaultLevel: 'warn' })
const secureStateDir = path.join(app.getPath('userData'), 'state')
const tokenStorePath = path.join(secureStateDir, 'credentials.json')
configureTokenStore({ path: tokenStorePath, safeStorage, logger })
const protocolGuardPartitions = new Set()
const DESKTOP_DEV_SERVER_URL = 'http://localhost:5173'
const lotteryRightCacheByAccount = new Map() // accountId -> Map(roomIdOrLotteryId, { data, updatedAt, roomId, lotteryId })

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

function normalizeLiveLotteryPayload(raw) {
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
  return {
    data: raw,
    roomId,
    lotteryId,
    updatedAt: Date.now()
  }
}

function cacheLotteryRightPayload(accountId, raw) {
  const normalized = normalizeLiveLotteryPayload(raw)
  if (!accountId || !normalized) return
  const keyAccountId = String(accountId || '').trim()
  if (!keyAccountId) return
  let cache = lotteryRightCacheByAccount.get(keyAccountId)
  if (!cache) {
    cache = new Map()
    lotteryRightCacheByAccount.set(keyAccountId, cache)
  }
  if (normalized.roomId) cache.set(`room:${normalized.roomId}`, normalized)
  if (normalized.lotteryId) cache.set(`lottery:${normalized.lotteryId}`, normalized)

  const now = Date.now()
  for (const [key, value] of cache.entries()) {
    if (now - Number(value?.updatedAt || 0) > 120000) {
      cache.delete(key)
    }
  }
}

function readCachedLotteryRightPayload(accountId, { roomId = '', lotteryId = '', maxAgeMs = 20000 } = {}) {
  const keyAccountId = String(accountId || '').trim()
  if (!keyAccountId) return null
  const cache = lotteryRightCacheByAccount.get(keyAccountId)
  if (!cache || cache.size === 0) return null

  const keys = [
    String(lotteryId || '').trim() ? `lottery:${String(lotteryId || '').trim()}` : '',
    String(roomId || '').trim() ? `room:${String(roomId || '').trim()}` : ''
  ].filter(Boolean)
  const now = Date.now()
  for (const key of keys) {
    const hit = cache.get(key)
    if (!hit) continue
    if (now - Number(hit.updatedAt || 0) > Math.max(0, Number(maxAgeMs || 0))) continue
    return hit.data || null
  }
  return null
}

function buildLotteryDetailFromRaw(raw) {
  const payload = normalizeLiveLotteryPayload(raw)
  if (!payload?.data) return null
  const lotteryInfo = payload.data.lottery_info || payload.data.lotteryInfo || null
  if (!lotteryInfo) return null
  const conditions = Array.isArray(lotteryInfo.conditions) ? lotteryInfo.conditions : []
  return {
    lottery_id: lotteryInfo.lottery_id_str || lotteryInfo.lottery_id || lotteryInfo.lotteryId || '',
    anchorId: lotteryInfo.anchor_id || '',
    joinTotal: lotteryInfo.candidate_num || lotteryInfo.candidate_user_num || 0,
    winningTotal: lotteryInfo.lucky_count || 0,
    lotteryTotal: lotteryInfo.prize_count || 0,
    lotteryName: lotteryInfo.prize_info?.name || '未知奖品',
    prize_name: lotteryInfo.prize_info?.name || '未知奖品',
    prizeType: lotteryInfo.prize_type || lotteryInfo.prize_info?.type || lotteryInfo.prize_info?.prize_type || 0,
    prizeInfo: lotteryInfo.prize_info || {},
    total_amount: lotteryInfo.total_amount || lotteryInfo.prize_info?.total_amount || 0,
    start_time: lotteryInfo.start_time || 0,
    end_time: lotteryInfo.draw_time || lotteryInfo.end_time || 0,
    conditions
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

function isLiveRoomUrl(url = '') {
  return /https?:\/\/live\.douyin\.com\//i.test(String(url || '').trim())
}

function setAccountMediaBlockingState(accountId, enabled) {
  const browserData = browserViews.get(accountId)
  if (!browserData || !browserData.window || browserData.window.isDestroyed()) {
    return { success: false, error: 'browser_window_not_found' }
  }
  browserData.blockMediaRequests = enabled === true
  return {
    success: true,
    enabled: browserData.blockMediaRequests,
    url: String(browserData.lastUrl || browserData.window.webContents.getURL?.() || '')
  }
}

function waitForNavigationResult(loadPromise, timeoutMs = 15000) {
  const safeTimeout = Math.max(1500, Math.min(30000, Number(timeoutMs || 15000)))
  return Promise.race([
    loadPromise.then(() => ({ ok: true, timedOut: false })).catch((error) => ({ ok: false, error, timedOut: false })),
    new Promise((resolve) => {
      setTimeout(() => resolve({ ok: false, error: new Error('navigation_timeout'), timedOut: true }), safeTimeout)
    })
  ])
}

function isSoftNavigationFailure(error, currentUrl = '', targetUrl = '') {
  const msg = String(error?.message || '').toLowerCase()
  const code = String(error?.code || '').toLowerCase()
  const errno = Number(error?.errno || 0)
  const aborted = msg.includes('err_aborted') || msg.includes('(-3)') || code.includes('err_aborted') || errno === -3
  const timeout = msg.includes('navigation_timeout')
  const currentLive = isLiveRoomUrl(currentUrl)
  const targetLive = isLiveRoomUrl(targetUrl)
  if (aborted && targetLive) return true
  if (timeout && currentLive && targetLive) return true
  return false
}

function shouldAutoRecoverOnScriptTimeout(label = '') {
  const normalized = String(label || '').trim()
  if (!normalized) return true
  if (normalized.startsWith('join.wait_live_room_ready')) return false
  if (normalized.startsWith('join.wait_selector:')) return false
  if (normalized.startsWith('join.click_lottery_entry_fallback')) return false
  return true
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

function resolveHotUpdateSettings(settings = {}) {
  return {
    enabled: settings?.hotUpdateEnabled === true,
    manifestUrl: String(settings?.hotUpdateManifestUrl || '').trim(),
    reloadOnApply: settings?.hotUpdateReloadOnApply === true
  }
}

function createBoundHotUpdateService(settings = {}) {
  const hotSettings = resolveHotUpdateSettings(settings)
  const service = createHotUpdateService({
    enabled: hotSettings.enabled,
    manifestUrl: hotSettings.manifestUrl,
    reloadOnApply: hotSettings.reloadOnApply,
    userDataDir: app.getPath('userData'),
    appVersion: app.getVersion(),
    onChange(snapshot) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('desktop:hot-update-state', snapshot)
      }
    }
  })
  return service
}

function ensureHotUpdateService() {
  if (!hotUpdateService) {
    const settings = ensureStateStore().getSettings()
    hotUpdateService = createBoundHotUpdateService(settings)
    hotUpdateService.init().catch((error) => {
      logger.warn(`[hot-update] init failed: ${error?.message || error}`)
    })
  }
  return hotUpdateService
}

function appendRuntimeEvent(level = 'info', message = '', scope = 'desktop') {
  try {
    return ensureStateStore().appendEvent({ level, message, scope })
  } catch (_) {
    return null
  }
}

function appendRuntimeAccountLog(accountId = '', level = 'info', message = '', scope = 'desktop') {
  try {
    return ensureStateStore().appendAccountLog({ accountId, level, message, scope })
  } catch (_) {
    return { success: false, error: 'append_account_log_failed' }
  }
}

function getBootstrapSnapshot() {
  const store = ensureStateStore()
  const update = ensureUpdateService().getSnapshot()
  return {
    appVersion: app.getVersion(),
    settings: store.getSettings(),
    update,
    events: store.listEvents(180),
    historyRecords: store.listHistoryRecords(240)
  }
}

logger.debug(`Token存储路径: ${tokenStorePath}`)

// macOS 开发机上抖音直播页容易触发 Chromium GPU overlay/mailbox 崩溃，
// 自动化运行不依赖硬件视频渲染，这里优先保证稳定性。
try {
  if (process.platform === 'darwin') {
    app.disableHardwareAcceleration()
  }
} catch (e) {
  logger.debug('关闭硬件加速失败', e)
}

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

/**
 * readTokenStore 方法：读取Token存储。
 */
/**
 * writeTokenStore 方法：写入Token存储。
 */
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

function pushCookieCandidate(pool = [], seen = new Set(), rawCookie = '', source = '') {
  const cookie = normalizeCookieHeaderString(rawCookie)
  if (!cookie) return
  if (cookie.length < 16) return
  if (seen.has(cookie)) return
  seen.add(cookie)
  pool.push({ cookie, source: String(source || '') })
}

function shuffleList(list = []) {
  const arr = Array.isArray(list) ? [...list] : []
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}

async function buildDetailCookiePool(primaryAccountId, host = 'live.douyin.com', limit = 8) {
  const pool = []
  const seen = new Set()
  const safeLimit = Math.max(1, Math.min(16, Number(limit || 8)))
  const normalizedHost = String(host || 'live.douyin.com').trim() || 'live.douyin.com'

  const addFromSession = async (accountId, source) => {
    if (!accountId) return
    try {
      const { cookies, cookieString } = await getAccountCookiesAndString(accountId)
      const preferred = buildCookieStringForHost(cookies, normalizedHost)
      pushCookieCandidate(pool, seen, preferred, `${source}:session-host`)
      pushCookieCandidate(pool, seen, cookieString, `${source}:session-raw`)
    } catch (_) {
      // ignore
    }
    pushCookieCandidate(pool, seen, buildCookieStringFromTokenRecord(accountId, normalizedHost), `${source}:token`)
  }

  await addFromSession(primaryAccountId, `account:${primaryAccountId}`)

  const activeAccounts = shuffleList(Array.from(browserViews.keys()).filter(id => id && id !== primaryAccountId))
  for (const accountId of activeAccounts) {
    if (pool.length >= safeLimit) break
    await addFromSession(accountId, `account:${accountId}`)
  }

  if (pool.length < safeLimit) {
    const tokens = readTokenStore()
    const tokenAccountIds = shuffleList(
      Object.keys(tokens || {}).filter((id) => id && id !== primaryAccountId && typeof tokens[id] === 'object')
    )
    for (const accountId of tokenAccountIds) {
      if (pool.length >= safeLimit) break
      pushCookieCandidate(pool, seen, buildCookieStringFromTokenRecord(accountId, normalizedHost), `token:${accountId}`)
    }
  }

  return pool.slice(0, safeLimit)
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
async function safeGetAccountCookieString(accountId, options = {}) {
  if (!accountId) return ''
  const host = String(options?.host || 'live.douyin.com').trim() || 'live.douyin.com'
  try {
    const { cookies, cookieString } = await getAccountCookiesAndString(accountId)
    const preferred = buildCookieStringForHost(cookies, host)
    if (preferred) return preferred
    const normalizedRaw = normalizeCookieHeaderString(cookieString)
    if (normalizedRaw) return normalizedRaw
    const tokenFallback = buildCookieStringFromTokenRecord(accountId, host)
    if (tokenFallback) return tokenFallback
    return ''
  } catch (e) {
    logger.warn('⚠️ 获取Cookie失败:', e.message)
    return buildCookieStringFromTokenRecord(accountId, host)
  }
}

let androidBridgeClient = null
let androidProtocolClient = null
let androidDouyinBackend = null
let backendManager = null

function ensureDouyinBackendManager() {
  if (!backendManager) {
    const store = ensureStateStore()
    const currentSettings = store.getSettings()

    androidBridgeClient = new AndroidBridgeClient({
      serverUrl: currentSettings?.androidBridge?.serverUrl,
      token: currentSettings?.androidBridge?.token,
      logger
    })

    androidProtocolClient = new AndroidProtocolClient({
      logger
    })

    androidDouyinBackend = new AndroidDouyinBackend({
      protocolClient: androidProtocolClient,
      safeGetAccountCookieString,
      traceScan,
      logger
    })

    backendManager = new DouyinBackendManager({
      androidBackend: androidDouyinBackend,
      logger
    })
  }
  return backendManager
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

function createWindow() {
  mainWindow = createDesktopWindow({
    BrowserWindow,
    app,
    logger,
    DESKTOP_DEV_SERVER_URL,
    getHotUpdateEntry: () => ensureHotUpdateService().getAppliedEntryFile(),
    preloadPath: path.join(__dirname, 'preload.js')
  })
}
app.whenReady().then(createWindow)
app.whenReady().then(() => {
  fs.mkdirSync(secureStateDir, { recursive: true })
  ensureStateStore()
  ensureUpdateService()
  ensureHotUpdateService()
})
app.whenReady().then(async () => {
  const service = ensureHotUpdateService()
  const hotSnapshot = await service.check().catch((error) => ({
    status: 'error',
    message: String(error?.message || error || 'unknown_error')
  }))
  if (!hotSnapshot || hotSnapshot.status !== 'applied') return
  if (hotSnapshot.reloadOnApply !== true) return
  if (!mainWindow || mainWindow.isDestroyed()) return
  const nextEntry = String(hotSnapshot.appliedEntryFile || '').trim()
  if (!nextEntry) return
  if (!fs.existsSync(nextEntry)) return
  mainWindow.loadFile(nextEntry).catch((error) => {
    logger.warn(`[hot-update] reload after apply failed: ${error?.message || error}`)
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
    if (stage === 'metric:all-request') {
      const requestText = request > 0 ? ` request=${request}` : ''
      const scannedRooms = Number(summary?.rawRooms || 0)
      const lotteryRooms = Number(summary?.hintedRooms || 0)
      console.log(`[main-browserview] [scan-summary] [${accountId || 'unknown'}]${requestText} 扫描直播间=${scannedRooms} 福袋直播间=${lotteryRooms}`)
      return { success: true }
    }
    if (stage === 'metric:all-start') {
      const requestText = request > 0 ? ` request=${request}` : ''
      const scannedRooms = Number(summary?.rawRooms || 0)
      console.log(`[main-browserview] [scan-lottery] [${accountId || 'unknown'}]${requestText} 开始扫描福袋（本轮直播间=${scannedRooms}）`)
      return { success: true }
    }
    if (stage === 'metric:all-detail-start') {
      const requestText = request > 0 ? ` request=${request}` : ''
      const detailRequested = Number(summary?.detailRequested || summary?.hintedRooms || 0)
      console.log(`[main-browserview] [scan-lottery] [${accountId || 'unknown'}]${requestText} 开始扫描福袋详情=${detailRequested}`)
      return { success: true }
    }
    if (stage === 'metric:all-batch-add') {
      const requestText = request > 0 ? ` request=${request}` : ''
      const detailRequested = Number(summary?.detailRequested || summary?.batchTotal || 0)
      const detailSucceeded = Number(summary?.detailSucceeded || summary?.validLotteries || 0)
      const detailError = Number(summary?.detailError || 0)
      const detailHardRisk = Number(summary?.detailHardRisk || 0)
      const detailErrorSamples = Array.isArray(summary?.detailErrorSamples) ? summary.detailErrorSamples : []
      const sampleText = detailErrorSamples.length > 0
        ? ` 样例=${detailErrorSamples.slice(0, 2).map((item) => {
          const code = String(item?.code || 'UNKNOWN')
          const status = Number(item?.statusCode || 0)
          const msg = String(item?.message || '').replace(/\s+/g, ' ').slice(0, 80)
          return `${code}${status > 0 ? `/${status}` : ''}:${msg}`
        }).join(' | ')}`
        : ''
      const poolDelta = Number(summary?.poolDelta || 0)
      console.log(`[main-browserview] [scan-lottery] [${accountId || 'unknown'}]${requestText} 详情请求=${detailRequested} 详情成功=${detailSucceeded} 详情失败=${detailError} 风控=${detailHardRisk} 池变化=${poolDelta}${sampleText}`)
      return { success: true }
    }
    if (stage === 'metric:all-round-upload') {
      const requestText = request > 0 ? ` request=${request}` : ''
      const uploaded = Number(summary?.uploaded || 0)
      const accepted = Number(summary?.accepted || 0)
      const eligibleCount = Number(summary?.eligibleCount || 0)
      const claimClaimed = summary?.claimClaimed === true
      const claimReason = String(summary?.claimReason || '')
      const ok = summary?.ok === true
      const skipped = String(summary?.skipped || '')
      const status = Number(summary?.status || 0)
      const error = String(summary?.error || '')
      const eligibleText = ` 可参与=${eligibleCount}`
      const claimText = ` 已分配=${claimClaimed ? 'yes' : 'no'}`
      const claimReasonText = claimReason ? ` reason=${claimReason}` : ''
      const statusText = status > 0 ? ` status=${status}` : ''
      const skippedText = skipped ? ` skipped=${skipped}` : ''
      const errorText = error ? ` error=${error}` : ''
      console.log(`[main-browserview] [scan-upload] [${accountId || 'unknown'}]${requestText} ok=${ok} 提交=${uploaded} 接收=${accepted}${eligibleText}${claimText}${claimReasonText}${statusText}${skippedText}${errorText}`)
      return { success: true }
    }
    if (stage.startsWith('metric:category:')) {
      const requestText = request > 0 ? ` request=${request}` : ''
      const categoryName = String(summary?.categoryName || stage.replace('metric:category:', '') || 'unknown')
      const rawRooms = Number(summary?.rawRooms || 0)
      const dedupRooms = Number(summary?.dedupRooms || 0)
      const detailRequested = Number(summary?.detailRequested || 0)
      const validLotteries = Number(summary?.validLotteries || 0)
      console.log(`[main-browserview] [scan-category] [${accountId || 'unknown'}] [${categoryName}]${requestText} 直播间=${rawRooms} 候选=${dedupRooms} 详情=${detailRequested} 福袋=${validLotteries}`)
      return { success: true }
    }
    if (stage.startsWith('metric:category-detail-start:')) {
      const requestText = request > 0 ? ` request=${request}` : ''
      const categoryName = String(summary?.categoryName || stage.replace('metric:category-detail-start:', '') || 'unknown')
      const detailRequested = Number(summary?.detailRequested || summary?.dedupRooms || 0)
      console.log(`[main-browserview] [scan-category] [${accountId || 'unknown'}] [${categoryName}]${requestText} 开始扫描福袋详情=${detailRequested}`)
      return { success: true }
    }
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
  const manager = ensureDouyinBackendManager()
  return manager.attendLottery({ roomId, lotteryId, webRid, accountId })
})

// 直播间点赞
ipcMain.handle('room-like', async (event, { roomId, accountId, count = 1 }) => {
  const manager = ensureDouyinBackendManager()
  return manager.roomLike({ roomId, accountId, count })
})

// 发送弹幕
ipcMain.handle('room-chat', async (event, { roomId, content, accountId }) => {
  const manager = ensureDouyinBackendManager()
  return manager.roomChat({ roomId, content, accountId })
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
            if (isLottery) {
              cacheLotteryRightPayload(accountId, json?.data || null)
            }

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
        revealAccountWindow(browserViews, accountId, {
          appendRuntimeEvent
        })
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
      lotteryRightCacheByAccount.delete(accountId)
      
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
    const result = setAccountMediaBlockingState(accountId, enabled === true)
    if (!result.success) {
      return { success: false, error: '浏览器实例不存在', code: 'BROWSER_NOT_FOUND' }
    }
    logger.info(`[${accountId}] 直播流拦截已${result.enabled ? '开启' : '关闭'}`)
    return { success: true, enabled: result.enabled }
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
    if (isLiveRoomUrl(url)) {
      console.log(`[main-browserview] [${accountId}] 进入直播间 -> ${url}`)
    }
    rememberBrowserUrl(accountId, url)
    await browserData.window.loadURL(url)
    return { success: true }
  } catch (error) {
    logger.error('导航失败:', error.message)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('execute-script', async (event, { accountId, script, timeoutMs = 4500, label = '' }) => {
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
    const errorMessage = String(error?.message || error || '')
    const isContextSwitchError = /Script failed to execute|Cannot find context with specified id|Execution context was destroyed|Object has been destroyed|Inspected target navigated or closed/i.test(errorMessage)
    if (isContextSwitchError) {
      return { success: false, error: '页面上下文切换中', code: 'EXECUTE_CONTEXT_LOST' }
    }
    if (String(error?.message || '').includes('执行脚本超时') || error?.code === 'EXECUTE_TIMEOUT') {
      if (shouldAutoRecoverOnScriptTimeout(label)) {
        scheduleBrowserRecovery(accountId, `execute-script-timeout:${String(label || 'unknown')}`)
      }
      return { success: false, error: '执行脚本超时', code: 'EXECUTE_TIMEOUT' }
    }
    logger.error(`执行脚本失败${label ? ` [${label}]` : ''}:`, error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('close-browser', async (event, accountId) => {
  try {
    const browserData = browserViews.get(accountId)
    if (browserData) {
      browserData.window.close()
      browserViews.delete(accountId)
      lotteryRightCacheByAccount.delete(accountId)
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
    const hotConfig = resolveHotUpdateSettings(settings)
    const prevHotSnapshot = ensureHotUpdateService().getSnapshot()
    const hotChanged = prevHotSnapshot.enabled !== hotConfig.enabled
      || prevHotSnapshot.manifestUrl !== hotConfig.manifestUrl
      || prevHotSnapshot.reloadOnApply !== hotConfig.reloadOnApply
    if (hotChanged) {
      hotUpdateService = createBoundHotUpdateService(settings)
      await hotUpdateService.init().catch((error) => {
        logger.warn(`[hot-update] reinit failed: ${error?.message || error}`)
      })
      if (hotConfig.enabled && hotConfig.manifestUrl) {
        hotUpdateService.check().catch((error) => {
          logger.warn(`[hot-update] recheck failed: ${error?.message || error}`)
        })
      }
    }
    if (androidBridgeClient && settings?.androidBridge) {
      androidBridgeClient.updateConfig({
        serverUrl: settings.androidBridge.serverUrl,
        token: settings.androidBridge.token
      })
    }
    return { success: true, settings }
  } catch (error) {
    return { success: false, error: error.message, settings: ensureStateStore().getSettings() }
  }
})

ipcMain.handle('check-android-bridge-status', async (_event, customConfig = {}) => {
  try {
    ensureDouyinBackendManager()
    let client = androidBridgeClient
    if (customConfig?.serverUrl || customConfig?.token !== undefined) {
      client = new AndroidBridgeClient({
        serverUrl: customConfig.serverUrl || androidBridgeClient.serverUrl,
        token: customConfig.token !== undefined ? customConfig.token : androidBridgeClient.token,
        timeoutMs: 5000,
        logger
      })
    }
    const caps = await client.getCapabilities()
    return {
      connected: true,
      available: Boolean(caps?.available),
      ticketGuardReady: Boolean(caps?.ticketGuardReady),
      authenticated: Boolean(caps?.authenticated),
      accountId: caps?.accountId || '',
      capabilities: Array.isArray(caps?.capabilities) ? caps.capabilities : [],
      lastCheckedAt: Date.now()
    }
  } catch (error) {
    return {
      connected: false,
      available: false,
      ticketGuardReady: false,
      authenticated: false,
      error: error?.message || '无法连接到 Android 伴生服务',
      lastCheckedAt: Date.now()
    }
  }
})

ipcMain.handle('desktop:show-account-window', async (_event, { accountId } = {}) => {
  try {
    return revealAccountWindow(browserViews, String(accountId || '').trim(), {
      appendRuntimeEvent
    })
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('desktop:hide-account-window', async (_event, { accountId } = {}) => {
  try {
    return concealAccountWindow(browserViews, String(accountId || '').trim())
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('desktop:get-update-state', async () => ensureUpdateService().getSnapshot())
ipcMain.handle('desktop:check-for-updates', async () => ensureUpdateService().check())
ipcMain.handle('desktop:download-update', async () => ensureUpdateService().download())
ipcMain.handle('desktop:install-update', async () => ({ success: ensureUpdateService().install() }))
ipcMain.handle('desktop:get-hot-update-state', async () => ensureHotUpdateService().getSnapshot())
ipcMain.handle('desktop:check-hot-update', async () => ensureHotUpdateService().check())

ipcMain.handle('desktop:append-event', async (_event, payload = {}) => {
  try {
    const item = appendRuntimeEvent(payload.level, payload.message, payload.scope)
    return { success: true, item }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('desktop:append-account-log', async (_event, payload = {}) => {
  try {
    const item = appendRuntimeAccountLog(
      payload.accountId,
      payload.level,
      payload.message,
      payload.scope
    )
    return item && item.success === false
      ? { success: false, error: item.error || 'append_account_log_failed' }
      : { success: true, item }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('desktop:append-history-record', async (_event, payload = {}) => {
  try {
    const item = ensureStateStore().appendHistoryRecord(payload)
    return { success: true, item }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('desktop:purge-account-data', async (_event, payload = {}) => {
  try {
    const accountId = String(payload?.accountId || '').trim()
    const result = ensureStateStore().purgeAccountData(accountId)
    if (result?.success !== true) {
      return { success: false, error: result?.error || 'purge_failed' }
    }
    return { success: true, result }
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

    const manager = ensureDouyinBackendManager()
    const result = await manager.searchLiveByAll({
      accountId,
      customCount,
      maxTime
    })

    traceScan('response search-live-by-all', {
      accountId: accountId || '',
      success: Boolean(result?.success),
      rawCount: result?.rawCount || 0,
      lotteryRooms: result?.roomInfoList ? result.roomInfoList.length : 0,
      hasMore: Boolean(result?.hasMore),
      nextMaxTime: result?.nextMaxTime || null
    })

    return result
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
ipcMain.handle('search-live-by-category', async (event, { accountId = null, categoryId = FIXED_CATEGORY_DEFAULT.categoryId, offset = 0, count = 15 } = {}) => {
  try {
    traceScan('request search-live-by-category', {
      accountId: accountId || '',
      categoryId: String(categoryId || FIXED_CATEGORY_DEFAULT.categoryId),
      offset: Math.max(0, Number(offset) || 0),
      count: Math.max(1, Number(count) || 15)
    })

    const manager = ensureDouyinBackendManager()
    const result = await manager.searchLiveByCategory({
      accountId,
      categoryId,
      offset,
      count
    })

    traceScan('response search-live-by-category', {
      accountId: accountId || '',
      categoryId: String(categoryId || FIXED_CATEGORY_DEFAULT.categoryId),
      success: Boolean(result?.success),
      rawCount: result?.rawCount || 0,
      lotteryRooms: result?.roomInfoList ? result.roomInfoList.length : 0,
      hasMore: Boolean(result?.hasMore),
      nextOffset: result?.nextOffset || 0
    })

    return result
  } catch (error) {
    traceScan('response search-live-by-category', {
      accountId: accountId || '',
      categoryId: String(categoryId || FIXED_CATEGORY_DEFAULT.categoryId),
      success: false,
      error: error?.message || 'unknown'
    })
    logger.error('搜索分类直播间失败:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-lottery-detail', async (event, { roomId, webRid = null, accountId }) => {
  const manager = ensureDouyinBackendManager()
  return manager.getLotteryDetail({ roomId, webRid, accountId, isRedPacket: false })
})

ipcMain.handle('get-redpacket-detail', async (event, { roomId, webRid = null, accountId }) => {
  const manager = ensureDouyinBackendManager()
  return manager.getRedpacketDetail({ roomId, webRid, accountId })
})


// 收集福袋信息 - 方法2：按分类扫描（可获取更多结果）
// 固定分类ID（新版）：4_101~4_108（聊天/音乐/游戏/二次元/舞蹈/文化/生活/运动）
ipcMain.handle('collect-lotteries-by-category', async (event, { categoryId = FIXED_CATEGORY_DEFAULT.categoryId, offset = 0, accountId = null }) => {
  try {
    const manager = ensureDouyinBackendManager()
    const result = await manager.searchLiveByCategory({
      categoryId,
      offset,
      count: 15,
      accountId
    })

    if (!result || !result.success) {
      return { success: false, error: result?.error || '分类扫描失败' }
    }

    const lotteries = (result.roomInfoList || []).map((room) => ({
      roomId: room.roomId,
      webRid: room.webRid,
      roomTitle: room.roomTitle || '未知标题',
      authorNickname: room.authorNickname || '未知主播',
      authorSecUid: room.authorSecUid || '',
      onlineUserCount: Number(room.onlineTotal) || 0
    }))

    return { success: true, lotteries, total: lotteries.length }
  } catch (error) {
    return { success: false, error: error.message }
  }
})
