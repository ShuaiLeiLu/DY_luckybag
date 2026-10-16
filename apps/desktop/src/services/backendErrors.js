export function classifyBackendFailure(result = {}) {
  const code = String(result.code || '')
  const status = Number(result.statusCode || result.status || 0)
  const text = String(result.error || result.message || '').toLowerCase()
  if (code === 'AUTHENTICATION_REQUIRED' || status === 401) return 'authentication'
  if (code === 'RATE_LIMITED_OR_RISK' || [403, 429, 444].includes(status)) return 'risk'
  if (['ANDROID_TICKET_GUARD_UNAVAILABLE', 'PROTOCOL_NOT_VERIFIED', 'NOT_IMPLEMENTED'].includes(code)) return 'configuration'
  if (code === 'NON_JSON_RESPONSE' || /captcha|verify|验证码|风控/.test(text)) return 'risk'
  return 'transient'
}
