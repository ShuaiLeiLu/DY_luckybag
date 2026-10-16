/**
 * 抖音请求模型与错误定义
 */

const ERROR_CODES = Object.freeze({
  ANDROID_TICKET_GUARD_UNAVAILABLE: 'ANDROID_TICKET_GUARD_UNAVAILABLE',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  RATE_LIMITED_OR_RISK: 'RATE_LIMITED_OR_RISK',
  NETWORK_ERROR: 'NETWORK_ERROR',
  NON_JSON_RESPONSE: 'NON_JSON_RESPONSE',
  BUSINESS_ERROR: 'BUSINESS_ERROR',
  INVALID_PARAMS: 'INVALID_PARAMS',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  UNKNOWN: 'UNKNOWN'
})

class DouyinBackendError extends Error {
  constructor(message, options = {}) {
    super(message || 'Douyin backend request failed')
    this.name = 'DouyinBackendError'
    this.code = options.code || ERROR_CODES.UNKNOWN
    this.statusCode = Number(options.statusCode || 0)
    this.retryable = options.retryable ?? false
    this.details = options.details || null
  }
}

function sanitizeRoomId(roomId) {
  const value = String(roomId || '').trim()
  return /^[0-9]{1,32}$/.test(value) ? value : ''
}

function sanitizeLotteryId(lotteryId) {
  const value = String(lotteryId || '').trim()
  return /^[0-9]{1,40}$/.test(value) ? value : ''
}

module.exports = {
  ERROR_CODES,
  DouyinBackendError,
  sanitizeRoomId,
  sanitizeLotteryId
}
