const fs = require('fs')
const path = require('path')
const { app } = require('electron')
const { normalizeCookieHeaderString } = require('./cookie-utils')

let tokenStorePath = ''
let safeStorageInstance = null
let loggerInstance = console
let tokenStoreCache = null
let tokenStoreDirty = true
const unreadableLegacyTokenPaths = new Set()

function configureTokenStore({ path: storePath, safeStorage, logger }) {
  tokenStorePath = String(storePath || '').trim()
  safeStorageInstance = safeStorage || null
  loggerInstance = logger || console
}

function canUseSafeStorage() {
  try {
    return safeStorageInstance &&
      typeof safeStorageInstance.isEncryptionAvailable === 'function' &&
      safeStorageInstance.isEncryptionAvailable()
  } catch (error) {
    loggerInstance?.debug?.('safeStorage 检测失败，降级普通存储', error)
    return false
  }
}

function getLegacyTokenStorePaths() {
  const candidates = [
    path.resolve(process.cwd(), 'tokens.json'),
    path.resolve(__dirname, '../../../tokens.json'),
    path.resolve((typeof app.getAppPath === 'function' ? app.getAppPath() : process.cwd()), 'tokens.json')
  ]
  const primary = path.resolve(tokenStorePath || '')
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
  const normalizedPath = path.resolve(String(filePath || tokenStorePath || ''))
  if (!normalizedPath || !fs.existsSync(normalizedPath)) return {}

  const raw = fs.readFileSync(normalizedPath, 'utf8')
  if (!raw || !raw.trim()) return {}

  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object') return {}

  if (parsed.__encrypted === true && typeof parsed.payload === 'string') {
    if (!canUseSafeStorage()) {
      throw new Error('当前系统不支持解密本地Token，请在原系统环境使用')
    }
    const decrypted = safeStorageInstance.decryptString(Buffer.from(parsed.payload, 'base64'))
    const tokens = JSON.parse(decrypted)
    return (tokens && typeof tokens === 'object') ? tokens : {}
  }

  return parsed
}

function writeTokenStoreFile(filePath, tokens) {
  const normalizedPath = path.resolve(String(filePath || tokenStorePath || ''))
  if (!normalizedPath) throw new Error('tokenStorePath 未配置')
  fs.mkdirSync(path.dirname(normalizedPath), { recursive: true })
  const payloadObj = tokens && typeof tokens === 'object' ? tokens : {}
  const jsonText = JSON.stringify(payloadObj)

  if (canUseSafeStorage()) {
    const encrypted = safeStorageInstance.encryptString(jsonText).toString('base64')
    fs.writeFileSync(
      normalizedPath,
      JSON.stringify({ __encrypted: true, payload: encrypted }, null, 2)
    )
    return { encrypted: true }
  }

  fs.writeFileSync(normalizedPath, JSON.stringify(payloadObj, null, 2))
  return { encrypted: false }
}

function invalidateTokenStoreCache() {
  tokenStoreDirty = true
}

function readTokenStore() {
  if (tokenStoreCache && !tokenStoreDirty) {
    return { ...tokenStoreCache }
  }

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
      if (path.resolve(filePath) !== path.resolve(tokenStorePath || '')) {
        if (!unreadableLegacyTokenPaths.has(filePath)) {
          unreadableLegacyTokenPaths.add(filePath)
          loggerInstance?.warn?.(`跳过旧Token存储: ${filePath} ${error?.message || error}`)
        }
        return
      }
      loggerInstance?.warn?.(`读取Token失败: ${filePath} ${error?.message || error}`)
    }
  })

  if (legacyPaths.length > 0) {
    try {
      writeTokenStoreFile(tokenStorePath, merged)
    } catch (error) {
      loggerInstance?.warn?.(`同步旧Token到新存储失败: ${error?.message || error}`)
    }
  }

  tokenStoreCache = { ...merged }
  tokenStoreDirty = false
  return merged
}

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
      loggerInstance?.warn?.(`同步Token到兼容存储失败: ${filePath} ${error?.message || error}`)
    }
  })

  if (primaryError) {
    throw primaryError
  }

  tokenStoreCache = tokens && typeof tokens === 'object' ? { ...tokens } : {}
  tokenStoreDirty = false
  return { encrypted }
}

function buildCookieStringFromTokenRecord(accountId, host = 'live.douyin.com') {
  const tokens = readTokenStore()
  const tokenInfo = tokens?.[accountId] || {}
  if (!tokenInfo || typeof tokenInfo !== 'object') return ''
  const snapshot = Array.isArray(tokenInfo.cookieSnapshot) ? tokenInfo.cookieSnapshot : []
  if (snapshot.length > 0) {
    const fromSnapshot = buildCookieStringForHost(snapshot, host)
    if (fromSnapshot) return fromSnapshot
  }
  const pairs = []
  const pushPair = (name) => {
    const value = String(tokenInfo?.[name] || '').trim()
    if (!value) return
    pairs.push(`${name}=${value}`)
  }
  pushPair('sessionid')
  pushPair('sessionid_ss')
  pushPair('ttwid')
  pushPair('passport_csrf_token')
  return normalizeCookieHeaderString(pairs.join('; '))
}

module.exports = {
  configureTokenStore,
  invalidateTokenStoreCache,
  readTokenStore,
  writeTokenStore,
  buildCookieStringFromTokenRecord
}
