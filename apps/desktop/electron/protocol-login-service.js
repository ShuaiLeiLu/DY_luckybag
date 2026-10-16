const crypto = require('node:crypto')
const { NativeLoginProvider } = require('./native-login-provider')

const TERMINAL = new Set(['completed', 'failed', 'expired', 'canceled'])
const MESSAGES = Object.freeze({
  LOGIN_DEVICE_REGISTRATION_REJECTED: '服务端没有分配有效的安卓设备参数，尚不能申请二维码。',
  LOGIN_DEVICE_INVALID: '本机保存的设备参数无效。',
  LOGIN_APP_UNSUPPORTED: '原生扫码接口拒绝当前应用参数（业务码 11），未获取到二维码。',
  LOGIN_CLIENT_REJECTED: '平台返回版本或客户端来源校验失败（1049）。账号未保存，需要继续适配协议客户端。',
  LOGIN_PASSPORT_REJECTED: '原生登录接口拒绝了本次请求。',
  LOGIN_QR_SCHEMA_UNCONFIRMED: '二维码响应格式未确认，无法展示。',
  LOGIN_QR_EXPIRED: '二维码已过期，请重新获取。',
  LOGIN_CHALLENGE_REQUIRED: '平台要求额外身份验证，本次协议登录已停止。',
  LOGIN_STATUS_UNCONFIRMED: '服务端返回了尚未识别的扫码状态，本次登录已停止。',
  LOGIN_SESSION_MISSING: '扫码响应缺少完整的安卓会话，账号未保存。',
  LOGIN_IDENTITY_UNCONFIRMED: '扫码响应无法确认账号身份，账号未保存。',
  LOGIN_ACCOUNT_MISMATCH: '确认的账号与当前账号不一致，原会话未覆盖。',
  LOGIN_STORAGE_UNAVAILABLE: '系统加密存储不可用，无法安全保存登录会话。',
  LOGIN_STORAGE_FAILED: '会话保存失败，请检查本机数据目录。',
  RATE_LIMITED_OR_RISK: '平台限制了本次请求，登录已停止。',
  AUTHENTICATION_REQUIRED: '平台未接受扫码会话，账号未保存。',
  NON_JSON_RESPONSE: '平台响应不是预期的协议数据，登录已停止。',
  NETWORK_ERROR: '连接登录服务失败，请稍后手动重试。'
})
function safeError(error) {
  const code = Object.hasOwn(MESSAGES, error?.code) ? error.code : 'LOGIN_PASSPORT_REJECTED'
  return { code, message: MESSAGES[code], ...(Number.isSafeInteger(error?.businessCode) ? { businessCode: error.businessCode } : {}),
    ...(Number.isSafeInteger(error?.statusCode) ? { statusCode: error.statusCode } : {}) }
}
class ProtocolLoginService {
  constructor({ sessions, deviceStore, providerFactory, onSaved = () => {}, now = Date.now,
    schedule = setTimeout, unschedule = clearTimeout, pollMs = 2500 } = {}) {
    this.sessions = sessions; this.deviceStore = deviceStore; this.onSaved = onSaved; this.now = now
    this.schedule = schedule; this.unschedule = unschedule; this.pollMs = Math.max(2000, pollMs)
    this.providerFactory = providerFactory || (() => new NativeLoginProvider({ deviceStore }))
    this.current = null
  }
  snapshot(attemptId) {
    const item = this.current
    if (!item || (attemptId && item.id !== attemptId)) return { success: false, code: 'LOGIN_ATTEMPT_NOT_FOUND' }
    if (!TERMINAL.has(item.state) && this.now() >= item.expiresAt) this.finish(item, 'expired', { code: 'LOGIN_QR_EXPIRED', message: MESSAGES.LOGIN_QR_EXPIRED })
    return { success: true, attemptId: item.id, state: item.state, expiresAt: item.expiresAt,
      qrImage: ['waiting', 'scanned'].includes(item.state) ? item.qrImage : '',
      ...(item.error ? { error: item.error } : {}), ...(item.account ? { account: item.account } : {}) }
  }
  start({ accountId } = {}) {
    const existing = accountId ? this.sessions.get(accountId) : null
    if (accountId && !existing) return { success: false, code: 'LOGIN_ACCOUNT_NOT_FOUND' }
    // Same-account renewal must have a known identity to prevent accidental replacement.
    if (existing && !existing.userId) return { success: false, code: 'LOGIN_IDENTITY_UNCONFIRMED',
      error: '该旧会话尚无已确认的 UID，请使用添加账号扫码登录，避免覆盖其他账号。' }
    this.cancel()
    try { this.deviceStore?.assertAvailable() } catch (error) { return { success: false, error: safeError(error).message, code: 'LOGIN_STORAGE_UNAVAILABLE' } }
    const item = { id: crypto.randomUUID(), accountId, expectedUserId: existing?.userId,
      state: 'registering', expiresAt: this.now() + 180000, controller: new AbortController(), provider: this.providerFactory() }
    this.current = item
    void this.begin(item)
    return this.snapshot(item.id)
  }
  active(item) { return this.current === item && !TERMINAL.has(item.state) && !item.controller.signal.aborted }
  assertActive(item) {
    if (!this.active(item)) throw Object.assign(new Error('Canceled'), { code: 'LOGIN_CANCELED' })
    if (this.now() >= item.expiresAt) throw Object.assign(new Error('Expired'), { code: 'LOGIN_QR_EXPIRED' })
  }
  finish(item, state, error) {
    item.state = state; item.error = error; item.qrImage = ''; item.controller.abort()
    this.unschedule(item.timer); this.unschedule(item.expiryTimer)
    item.provider.dispose?.()
  }
  fail(item, error) {
    if (!this.active(item)) return
    this.finish(item, error.code === 'LOGIN_QR_EXPIRED' ? 'expired' : 'failed', safeError(error))
  }
  async begin(item) {
    try {
      const signal = item.controller.signal
      await item.provider.prepare(signal); this.assertActive(item)
      item.state = 'requesting_qr'
      const qr = await item.provider.createQR(signal); this.assertActive(item)
      item.qrImage = qr.qrImage; item.expiresAt = Math.min(item.expiresAt, qr.expiresAt)
      this.assertActive(item); item.state = 'waiting'
      item.expiryTimer = this.schedule(() => {
        if (this.active(item)) this.finish(item, 'expired', { code: 'LOGIN_QR_EXPIRED', message: MESSAGES.LOGIN_QR_EXPIRED })
      }, Math.max(0, item.expiresAt - this.now()))
      item.expiryTimer?.unref?.()
      this.next(item)
    } catch (error) { this.fail(item, error) }
  }
  next(item) {
    item.timer = this.schedule(() => void this.poll(item), this.pollMs)
    item.timer?.unref?.()
  }
  async poll(item) {
    try {
      this.assertActive(item)
      const result = await item.provider.poll(item.controller.signal); this.assertActive(item)
      if (result.state === 'expired' || result.state === 'refused') {
        this.finish(item, result.state === 'expired' ? 'expired' : 'canceled', {
          code: result.state === 'expired' ? 'LOGIN_QR_EXPIRED' : 'LOGIN_REFUSED',
          message: result.state === 'expired' ? MESSAGES.LOGIN_QR_EXPIRED : '已在手机端取消登录。'
        }); return
      }
      if (result.state === 'new' || result.state === 'scanned') {
        if (result.state === 'scanned') item.state = 'scanned'
        this.next(item); return
      }
      if (result.state !== 'confirmed') throw Object.assign(new Error(), { code: 'LOGIN_STATUS_UNCONFIRMED' })
      if (item.expectedUserId && result.userId !== item.expectedUserId) throw Object.assign(new Error(), { code: 'LOGIN_ACCOUNT_MISMATCH' })
      item.state = 'verifying'; item.qrImage = ''
      const session = await item.provider.verify(result.userId, item.controller.signal); this.assertActive(item)
      if (session.userId !== result.userId) throw Object.assign(new Error(), { code: 'LOGIN_ACCOUNT_MISMATCH' })
      const duplicate = this.sessions.list().find(account => account.userId === session.userId)
      const accountId = item.accountId || duplicate?.id || `dy_${session.userId}`
      item.state = 'saving'
      // Synchronous atomic persistence: cancellation cannot race between this check and commit.
      try { item.account = this.sessions.save({ ...session, accountId }) }
      catch { throw Object.assign(new Error(), { code: 'LOGIN_STORAGE_FAILED' }) }
      this.finish(item, 'completed')
      this.onSaved(item.account)
    } catch (error) { this.fail(item, error) }
  }
  cancel(attemptId) {
    const item = this.current
    if (item && (!attemptId || item.id === attemptId) && !TERMINAL.has(item.state)) this.finish(item, 'canceled')
    return { success: true }
  }
  dispose() { this.cancel(); this.current = null }
}
module.exports = { ProtocolLoginService, safeError, MESSAGES }
