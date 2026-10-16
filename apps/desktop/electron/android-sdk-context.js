const crypto = require('node:crypto')

const SECURITY_HEADERS = Object.freeze([
  'x-argus', 'x-security-argus', 'x-gorgon', 'x-ladon',
  'x-helios', 'x-medusa', 'x-perseus', 'x-bd-client-key', 'x-bd-kmsv',
  'x-ss-req-ticket', 'x-tt-dt', 'x-tt-env', 'x-tt-trace-id'
])

function clone(value) {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object') return value
  if (Buffer.isBuffer(value)) return Buffer.from(value)
  if (Array.isArray(value)) return value.map(clone)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]))
}

function headerValue(headers, name) {
  const key = Object.keys(headers || {}).find(item => item.toLowerCase() === name.toLowerCase())
  return key ? headers[key] : undefined
}

function hasSecurityHeader(headers) {
  return SECURITY_HEADERS.some(name => {
    const value = headerValue(headers, name)
    return value !== undefined && value !== null && String(value).length > 0
  })
}

function hasRequiredHeaders(headers, requiredHeaders) {
  return requiredHeaders.every(name => {
    const value = headerValue(headers, name)
    return value !== undefined && value !== null && String(value).length > 0
  })
}

function validateAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter)) {
    throw Object.assign(new Error('Android SDK adapter is required'), { code: 'ANDROID_SDK_UNAVAILABLE' })
  }
  if (typeof adapter.signRequest !== 'function' && typeof adapter.sign !== 'function') {
    throw Object.assign(new Error('Android SDK adapter has no request signer'), { code: 'ANDROID_SDK_UNAVAILABLE' })
  }
}

/**
 * Stateful boundary around the Android security SDK.
 *
 * The native implementation keeps a handle, request counter, ticket cache and
 * server response state. This object deliberately owns those values and never
 * recreates them per origin or per request. It does not implement a guessed
 * signature; an adapter must provide the actual SDK implementation.
 */
class AndroidSdkContext {
  constructor({ adapter, now = Date.now, requestId = crypto.randomUUID, requireVerified = false, trustedSamples = [] } = {}) {
    validateAdapter(adapter)
    this.adapter = adapter
    this.hasDeclaredHeaderSet = Array.isArray(adapter.requiredHeaders) && adapter.requiredHeaders.length > 0
    this.requiredHeaders = Object.freeze(this.hasDeclaredHeaderSet ? adapter.requiredHeaders.map(String) : ['x-argus'])
    this.requireVerified = requireVerified === true
    this.trustedSamples = clone(trustedSamples)
    this.sampleVerified = false
    this.verified = adapter.verified === true
    this.now = now
    this.requestId = typeof requestId === 'function' ? requestId() : String(requestId)
    this.profile = null
    this.initialized = false
    this.disposed = false
    this.sequence = 0
    this.responses = 0
    this.cache = new Map()
    this.lastRequest = null
    this.lastResponse = null
    this.initPromise = null
  }

  _assertActive() {
    if (this.disposed) throw Object.assign(new Error('Android SDK context disposed'), { code: 'ANDROID_SDK_UNAVAILABLE' })
  }

  setProfile(profile) {
    this._assertActive()
    if (!profile || typeof profile !== 'object' || !profile.deviceInfo || typeof profile.userAgent !== 'string') {
      throw Object.assign(new Error('Android SDK profile is incomplete'), { code: 'ANDROID_SDK_UNAVAILABLE' })
    }
    this.profile = clone(profile)
    if (typeof this.adapter.setProfile === 'function') this.adapter.setProfile(clone(this.profile))
    else if (typeof this.adapter.updateProfile === 'function') this.adapter.updateProfile(clone(this.profile))
    return this.profile
  }

  async initialize() {
    this._assertActive()
    if (!this.profile) throw Object.assign(new Error('Android SDK profile is not configured'), { code: 'ANDROID_SDK_UNAVAILABLE' })
    if (this.initialized) return
    if (!this.initPromise) {
      this.initPromise = Promise.resolve(typeof this.adapter.initialize === 'function'
        ? this.adapter.initialize({ profile: clone(this.profile), context: this.snapshot() })
        : undefined).then(async () => {
          if (this.requireVerified) {
            if (!this.hasDeclaredHeaderSet) {
              throw Object.assign(new Error('Android SDK has no declared complete security header set'), { code: 'ANDROID_SDK_UNAVAILABLE' })
            }
            if (typeof this.adapter.verifyTrustedSample !== 'function') {
              throw Object.assign(new Error('Android SDK has no trusted request sample verifier'), { code: 'ANDROID_SDK_UNAVAILABLE' })
            }
            const checked = await this.adapter.verifyTrustedSample({ profile: clone(this.profile), samples: clone(this.trustedSamples) })
            if (checked !== true && checked?.verified !== true) {
              throw Object.assign(new Error('Android SDK request sample verification failed'), { code: 'ANDROID_SDK_UNAVAILABLE' })
            }
            this.sampleVerified = true
          }
          this.verified = this.adapter.verified === true
          if (this.sampleVerified) this.verified = true
          if (this.requireVerified && !this.verified) {
            throw Object.assign(new Error('Android SDK has no trusted request sample verification'), { code: 'ANDROID_SDK_UNAVAILABLE' })
          }
          this.initialized = true
        })
    }
    await this.initPromise
  }

  async signRequest(input) {
    this._assertActive()
    await this.initialize()
    const request = {
      ...clone(input),
      body: input?.body == null ? input?.body : Buffer.from(input.body),
      deviceInfo: clone(this.profile.deviceInfo),
      sdkContext: Object.freeze({
        requestId: this.requestId,
        sequence: this.sequence + 1,
        initialized: true,
        profile: clone(this.profile)
      })
    }
    const result = await (typeof this.adapter.signRequest === 'function'
      ? this.adapter.signRequest(request)
      : this.adapter.sign(request))
    if (!result || typeof result !== 'object' || Array.isArray(result) ||
      !result.headers || typeof result.headers !== 'object' || Array.isArray(result.headers) ||
      !hasSecurityHeader(result.headers) || !hasRequiredHeaders(result.headers, this.requiredHeaders)) {
      throw Object.assign(new Error('Android SDK returned incomplete security headers'), { code: 'ANDROID_TICKET_GUARD_UNAVAILABLE' })
    }
    this.sequence += 1
    this.lastRequest = { id: this.requestId, sequence: this.sequence, pathname: input.pathname, at: this.now() }
    return result
  }

  async consumeResponse(input) {
    this._assertActive()
    let consumed
    if (typeof this.adapter.consumeResponse === 'function') {
      consumed = await this.adapter.consumeResponse({
        ...clone(input),
        body: input?.body == null ? input?.body : clone(input.body),
        sdkContext: Object.freeze({ requestId: this.requestId, sequence: this.sequence })
      })
    }
    this.responses += 1
    this.lastResponse = { sequence: this.sequence, statusCode: Number(input?.statusCode || 0), at: this.now() }
    const cache = consumed?.cache || input?.cache
    if (cache && typeof cache === 'object') {
      for (const [key, value] of Object.entries(cache)) this.cache.set(String(key), clone(value))
    }
  }

  snapshot() {
    return {
      requestId: this.requestId, initialized: this.initialized, verified: this.verified, sampleVerified: this.sampleVerified,
      requireVerified: this.requireVerified, hasDeclaredHeaderSet: this.hasDeclaredHeaderSet, requiredHeaders: this.requiredHeaders,
      disposed: this.disposed,
      sequence: this.sequence, responses: this.responses, cacheKeys: [...this.cache.keys()],
      profile: this.profile ? { userAgent: this.profile.userAgent, deviceInfo: clone(this.profile.deviceInfo) } : null
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.cache.clear()
    try { this.adapter.dispose?.() } catch { /* cleanup must not mask cancellation */ }
    this.profile = null
    this.lastRequest = null
    this.lastResponse = null
  }
}

module.exports = { AndroidSdkContext, SECURITY_HEADERS, hasSecurityHeader, hasRequiredHeaders, validateAdapter }
