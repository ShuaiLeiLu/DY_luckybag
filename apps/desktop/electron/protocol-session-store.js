const fs = require('node:fs')
const path = require('node:path')

function normalizeProtocolSession(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('会话文件必须是 JSON 对象')
  const accountId = String(input.accountId || '').trim()
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(accountId)) throw new Error('accountId 必须为 1–128 位字母、数字、下划线或横线')
  const cookie = String(input.cookie || '').trim()
  if (!cookie || cookie.length > 32768 || /[\r\n\x00]/.test(cookie)) throw new Error('cookie 为空、过长或包含非法字符')
  const cookies = Object.fromEntries(cookie.split(';').map(pair => {
    const index = pair.indexOf('=')
    return [pair.slice(0, index).trim(), index < 0 ? '' : pair.slice(index + 1).trim()]
  }))
  if (!cookies.sessionid && !cookies.sessionid_ss) throw new Error('会话缺少 sessionid 或 sessionid_ss')
  const deviceInfo = {}
  for (const [key, value] of Object.entries(input.deviceInfo || {})) {
    if (!/^[a-zA-Z0-9_]{1,64}$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key) || !['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isSafeInteger(value)) || String(value).length > 2048) throw new Error('deviceInfo 包含非法参数；长设备 ID 请使用字符串')
    deviceInfo[key] = String(value)
  }
  for (const key of ['device_id', 'iid']) {
    if (!/^[0-9]{1,32}$/.test(deviceInfo[key] || '')) throw new Error(`请提供真实安卓会话的 deviceInfo.${key}，不能自动生成`)
  }
  const userAgent = String(input.userAgent || '').trim()
  if (!userAgent || userAgent.length > 2048 || /[\r\n\x00]/.test(userAgent)) throw new Error('请提供会话对应的 Android userAgent')
  const userId = String(input.userId || '').trim()
  if (userId && !/^[0-9]{1,32}$/.test(userId)) throw new Error('userId 应为账号的数字 UID 字符串')
  if (deviceInfo.device_platform && deviceInfo.device_platform !== 'android') throw new Error('需要安卓会话的设备参数')
  const authHeaders = {}
  if (input.authHeaders?.['x-tt-token']) {
    const token = input.authHeaders['x-tt-token']
    if (typeof token !== 'string' || token.length > 8192 || /[\r\n\x00]/.test(token)) throw new Error('安卓会话令牌格式无效')
    authHeaders['x-tt-token'] = token
  }
  return { accountId, nickname: String(input.nickname || accountId).slice(0, 100),
    userId, cookie, authHeaders, deviceInfo, userAgent, savedAt: Date.now() }
}

function publicSession(session) {
  return { id: session.accountId, accountId: session.accountId, nickname: session.nickname,
    userId: session.userId, hasSession: true, savedAt: session.savedAt, requestBackend: 'android' }
}

function createProtocolSessionStore({ filePath, safeStorage }) {
  let sessions = null
  const load = () => {
    if (sessions) return sessions
    if (!fs.existsSync(filePath)) return (sessions = {})
    const envelope = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (envelope.version !== 1 || envelope.encrypted !== true) throw new Error('无法识别本机协议会话格式')
    if (!safeStorage?.isEncryptionAvailable()) throw new Error('系统凭据加密服务不可用，无法读取协议会话')
    return (sessions = JSON.parse(safeStorage.decryptString(Buffer.from(envelope.payload, 'base64'))))
  }
  const persist = next => {
    if (!safeStorage?.isEncryptionAvailable()) throw new Error('系统凭据加密服务不可用，无法保存协议会话')
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const temp = `${filePath}.tmp`
    fs.writeFileSync(temp, JSON.stringify({ version: 1, encrypted: true,
      payload: safeStorage.encryptString(JSON.stringify(next)).toString('base64') }), { mode: 0o600 })
    fs.renameSync(temp, filePath)
    sessions = next
  }
  return {
    get: accountId => Object.hasOwn(load(), accountId) ? load()[accountId] : null,
    list: () => Object.values(load()).map(publicSession),
    save(input) { const session = normalizeProtocolSession(input); persist({ ...load(), [session.accountId]: session }); return publicSession(session) },
    remove(accountId) { const next = { ...load() }; delete next[accountId]; persist(next) }
  }
}
module.exports = { normalizeProtocolSession, publicSession, createProtocolSessionStore }
