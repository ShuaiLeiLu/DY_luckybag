const crypto = require('node:crypto')
const { AndroidProtocolClient } = require('./android-protocol-client')
const { AndroidDouyinBackend } = require('./android-douyin-backend')
const { normalizeLotteryOutcome } = require('./lottery-outcome')

const PROFILE_PATH = '/aweme/v1/user/profile/self/'
const DETAILS_PATH = '/webcast/lottery/melon/lottery_info/'
const BUSINESS_METHODS = new Set(['getLotteryDetail', 'getRedpacketDetail', 'searchLiveByAll', 'searchLiveByCategory',
  'attendLottery', 'roomLike', 'roomChat', 'getLotteryResult'])
const WRITES = new Set(['attendLottery', 'roomLike', 'roomChat'])

function failure(error) {
  // Upstream text may contain account material; only return controlled messages and numeric codes.
  return { success: false, code: error?.code || 'NETWORK_ERROR', statusCode: Number(error?.statusCode || 0),
    retryable: error?.retryable === true, transportCode: error?.transportCode, error: error?.publicMessage || '协议请求未通过，请查看错误码和验证报告', source: 'android' }
}

function requireBusinessOK(json) {
  if (json?.status_code === 0) return json
  const code = Number(json?.status_code)
  const auth = [8, 9, 1001, 1003, 1004].includes(code)
  throw Object.assign(new Error('Upstream business failure'), { code: auth ? 'AUTHENTICATION_REQUIRED' : 'BUSINESS_ERROR',
    statusCode: 200, businessCode: Number.isFinite(code) ? code : null, retryable: false })
}

class ProtocolRuntime {
  constructor({ getSession, clientFactory, now = Date.now } = {}) {
    this.getSession = getSession || (() => null)
    this.clientFactory = clientFactory || ((session, host) => new AndroidProtocolClient({
      baseUrl: host || 'https://webcast.amemv.com', deviceInfo: session.deviceInfo, userAgent: session.userAgent, authHeaders: session.authHeaders
    }))
    this.now = now
    this.reports = new Map()
  }
  invalidate(accountId) { this.reports.delete(accountId) }
  session(accountId) {
    const session = this.getSession(accountId)
    if (!session) throw Object.assign(new Error('Missing session'), { code: 'AUTHENTICATION_REQUIRED' })
    return session
  }
  fingerprint(session) { return crypto.createHash('sha256').update(JSON.stringify(session)).digest('hex') }
  client(session, host) { return this.clientFactory(session, host) }
  headers(session) { return { ...session.authHeaders, Cookie: session.cookie } }
  accountReady(accountId) {
    const session = this.getSession(accountId)
    const cached = this.reports.get(accountId)
    return Boolean(session && cached && cached.fingerprint === this.fingerprint(session) &&
      this.now() - cached.checkedAt < 10 * 60 * 1000 && cached.authentication.status === 'verified' && cached.details.status === 'verified')
  }
  status(accountId) { return { success: true, hasSession: Boolean(this.getSession(accountId)), ready: this.accountReady(accountId) } }
  async verify({ accountId, roomId } = {}) {
    const report = { accountId: String(accountId || ''), checkedAt: this.now(), source: 'android',
      authentication: { status: 'not_tested', code: 'SESSION_MISSING' },
      signature: { status: 'unverified', implementation: 'experimental-aes-v2', note: '本地可生成签名不代表平台接受' },
      details: { status: 'not_tested', code: 'ROOM_ID_REQUIRED' } }
    let session
    try { session = this.session(accountId) } catch { return report }
    report.authentication = { status: 'local_only', code: 'SESSION_PRESENT' }
    try {
      const json = requireBusinessOK(await this.client(session, 'https://aweme.snssdk.com').get(PROFILE_PATH, {}, this.headers(session)))
      const user = json.user || json.data?.user
      const rawUID = user?.uid_str || user?.uid || ''
      const uid = String(rawUID)
      if ((typeof rawUID === 'number' && !Number.isSafeInteger(rawUID)) || !/^[0-9]+$/.test(uid) || uid === '0') report.authentication = { status: 'inconclusive', code: 'PROFILE_SCHEMA_UNCONFIRMED' }
      else if (session.userId && uid !== session.userId) report.authentication = { status: 'failed', code: 'ACCOUNT_MISMATCH' }
      else report.authentication = { status: 'verified', code: 'SELF_PROFILE_CONFIRMED', userId: uid }
    } catch (error) {
      report.authentication = { status: 'failed', code: error.code || 'NETWORK_ERROR', statusCode: error.statusCode || 0, businessCode: error.businessCode ?? null, transportCode: error.transportCode }
    }
    // Stop after authentication/risk errors. Never fan out or retry diagnostics automatically.
    if (report.authentication.status !== 'verified') report.details = { status: 'not_tested', code: 'AUTHENTICATION_NOT_VERIFIED' }
    else if (!/^[0-9]{1,32}$/.test(String(roomId || ''))) report.details = { status: 'not_tested', code: 'ROOM_ID_REQUIRED' }
    else {
      try {
        const json = requireBusinessOK(await this.client(session).get(DETAILS_PATH, { room_id: String(roomId), live_id: 1, enter_from: 'link_share', query_from: 1 }, this.headers(session)))
        const info = json.data?.lottery_info || json.data
        const rawID = info?.lottery_id_str || info?.lottery_id || ''
        const id = String(rawID)
        if ((typeof rawID === 'number' && !Number.isSafeInteger(rawID)) || !/^[0-9]+$/.test(id) || id === '0') report.details = { status: 'inconclusive', code: 'NO_LOTTERY_OR_SCHEMA_UNCONFIRMED' }
        else {
          const { normalizeLotteryInfo } = require('./douyin-response-parser')
          report.details = { status: 'verified', code: 'LOTTERY_DETAIL_CONFIRMED', roomId: String(roomId), lotteryId: id,
            lotteryDetail: normalizeLotteryInfo(info) }
          report.signature.status = 'accepted_for_read_requests'
          report.signature.note = '自我资料及目标详情请求成功；不代表参与接口或后续请求已验证'
        }
      } catch (error) {
        report.details = { status: 'failed', code: error.code || 'NETWORK_ERROR', statusCode: error.statusCode || 0, businessCode: error.businessCode ?? null, transportCode: error.transportCode }
      }
    }
    this.reports.set(accountId, { ...report, fingerprint: this.fingerprint(session) })
    return report
  }
  async call(method, input = {}) {
    if (!BUSINESS_METHODS.has(method)) return { success: false, code: 'INVALID_PARAMS', error: '不支持的协议操作' }
    try {
      const session = this.session(input.accountId)
      if (!this.accountReady(input.accountId)) return { success: false, code: 'PROTOCOL_NOT_VERIFIED', error: '请先通过登录态和真实福袋详情验证', retryable: false }
      const client = this.client(session)
      if (method === 'getLotteryResult') {
        const raw = requireBusinessOK(await client.get(DETAILS_PATH, { room_id: input.roomId, lottery_id: input.lotteryId, live_id: 1 }, this.headers(session)))
        return { ...normalizeLotteryOutcome(raw, { ...input, userId: this.reports.get(input.accountId).authentication.userId }), source: 'android' }
      }
      if (WRITES.has(method) && method !== 'attendLottery' && (!input.roomId || !/^[0-9]{1,32}$/.test(String(input.roomId)))) return { success: false, code: 'INVALID_PARAMS' }
      const backend = new AndroidDouyinBackend({ protocolClient: client,
        safeGetAccountCookieString: async () => session.cookie, logger: { debug() {} } })
      const response = await backend[method](input)
      if (['AUTHENTICATION_REQUIRED', 'RATE_LIMITED_OR_RISK', 'NON_JSON_RESPONSE'].includes(response.code)) this.invalidate(input.accountId)
      return response.success ? response : { success: false, code: response.code || 'BUSINESS_ERROR', statusCode: response.statusCode || 0,
        retryable: response.retryable === true, error: '安卓协议操作未成功', source: 'android' }
    } catch (error) {
      if (['AUTHENTICATION_REQUIRED', 'RATE_LIMITED_OR_RISK', 'NON_JSON_RESPONSE'].includes(error.code)) this.invalidate(input.accountId)
      return failure(error)
    }
  }
}
module.exports = { ProtocolRuntime, PROFILE_PATH, DETAILS_PATH, requireBusinessOK, failure }
