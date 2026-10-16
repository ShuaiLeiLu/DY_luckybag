const http = require('node:http')
const https = require('node:https')
const querystring = require('node:querystring')
const { AndroidSignatureProvider } = require('./android-signature-provider')
const { getXSsStub } = require('./android-sign-algorithms')
const { hasSecurityHeader } = require('./android-sdk-context')
const { DouyinBackendError, ERROR_CODES } = require('./douyin-request-models')
const { DEFAULT_ANDROID_USER_AGENT } = require('./android-client-profile')

// Server device IDs come from registration or an existing session.
const DEFAULT_ANDROID_DEVICE = Object.freeze({ aid: 1128, app_name: 'aweme', device_platform: 'android' })
const HOSTS = new Set(['webcast.amemv.com', 'aweme.snssdk.com', 'log.snssdk.com'])
function headerKey(headers, name) { return Object.keys(headers).find(key => key.toLowerCase() === name.toLowerCase()) }
function mergeHeaders(...sources) {
  const result = {}
  for (const source of sources) for (const [name, value] of Object.entries(source || {})) {
    result[headerKey(result, name) || name] = value
  }
  return result
}
function setComputedHeader(headers, name, value) {
  const previous = headerKey(headers, name)
  if (previous) delete headers[previous]
  if (value !== null) headers[name] = value
}
function signingMismatch(message) { return new DouyinBackendError(message, { code: ERROR_CODES.INVALID_PARAMS }) }
function classifyHTTP(status) {
  return status === 401 ? ERROR_CODES.AUTHENTICATION_REQUIRED : [403, 429, 444].includes(status)
    ? ERROR_CODES.RATE_LIMITED_OR_RISK : ERROR_CODES.NETWORK_ERROR
}
function parseProtocolJSON(raw) {
  const ids = new Set(['device_id', 'install_id', 'iid', 'uid', 'user_id', 'room_id', 'lottery_id'])
  return JSON.parse(raw, (key, value, context) => {
    // Node 22+/Electron preserve the original numeric token via reviver context.
    // Never stringify an already rounded identifier.
    return ids.has(key) && typeof value === 'number' && !Number.isSafeInteger(value) &&
      /^[0-9]+$/.test(context?.source || '') ? context.source : value
  })
}
class AndroidProtocolClient {
  constructor({ baseUrl = 'https://webcast.amemv.com', signer, deviceInfo = {},
    userAgent = DEFAULT_ANDROID_USER_AGENT, timeoutMs = 10000, transport, maxResponseBytes = 2097152, authHeaders = {} } = {}) {
    const base = new URL(baseUrl)
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)
    if (!['http:', 'https:'].includes(base.protocol) || (!local && (base.protocol !== 'https:' || !HOSTS.has(base.hostname))) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('Invalid protocol origin')
    this.baseUrl = base.origin
    this.signer = signer || new AndroidSignatureProvider()
    this.deviceInfo = { ...DEFAULT_ANDROID_DEVICE, ...deviceInfo }
    this.userAgent = userAgent
    this.authHeaders = authHeaders
    this.timeoutMs = Math.max(100, Math.min(30000, Number(timeoutMs) || 10000))
    this.maxResponseBytes = maxResponseBytes
    this.transport = transport
    this.passportSeq = 0
  }
  getSigner() { return this.signer }
  setSigner(signer) { if (signer) this.signer = signer }
  async execute(pathname, { method = 'GET', params = {}, headers = {}, body = null, isForm = true,
    responseMode = 'business', includeResponse = false, signal } = {}) {
    if ((!/^\/(webcast|aweme|passport)\/[a-zA-Z0-9_/-]+\/$/.test(pathname) && pathname !== '/service/2/device_register/') || pathname.includes('..')) throw new DouyinBackendError('Invalid protocol path', { code: ERROR_CODES.INVALID_PARAMS })
    if (!['business', 'passport', 'registration'].includes(responseMode) ||
      (responseMode === 'passport' && !pathname.startsWith('/passport/mobile/')) ||
      (responseMode === 'registration' && pathname !== '/service/2/device_register/')) throw new DouyinBackendError('Invalid response mode', { code: ERROR_CODES.INVALID_PARAMS })
    signal?.throwIfAborted()
    method = String(method).toUpperCase()
    if (!['GET', 'POST'].includes(method)) throw new DouyinBackendError('Invalid protocol method', { code: ERROR_CODES.INVALID_PARAMS })
    // The trusted Passport capture shows an exact parameter set in a fixed
    // order; the full deviceInfo expansion only applies to Aweme/webcast calls.
    const queryParams = method === 'GET'
      ? (responseMode === 'passport' ? { ...params } : { ...this.deviceInfo, ...params })
      : { ...this.deviceInfo }
    const query = querystring.stringify(queryParams)
    const url = new URL(`${this.baseUrl}${pathname}${query ? '?' + query : ''}`)
    let requestBody = body === null ? null : Buffer.from(body)
    const requestHeaders = mergeHeaders(responseMode === 'passport'
      // Trusted capture: these endpoints carry only the form Content-Type and
      // sdk-version in the base set (no User-Agent/Accept in the official frames).
      ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'sdk-version': '2' }
      : { 'User-Agent': this.userAgent, Accept: 'application/json', 'sdk-version': '2' }, this.authHeaders, headers)
    if (method === 'POST' && requestBody === null && isForm) {
      requestBody = Buffer.from(querystring.stringify(params), 'utf8')
      setComputedHeader(requestHeaders, 'Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8')
    }
    // Official TypedByteArray.md5Stub and Cronet's request construction add the
    // body digest before the security callback (classes42.dex: 0x3d4ab0,
    // 0x6216ca). This client does not compress/encrypt after this boundary.
    setComputedHeader(requestHeaders, 'x-ss-stub', requestBody === null ? null : getXSsStub(requestBody))
    setComputedHeader(requestHeaders, 'Content-Length', requestBody === null ? null : String(requestBody.byteLength))
    const timestampMs = Date.now()
    setComputedHeader(requestHeaders, 'x-ss-req-ticket', String(timestampMs))
    if (responseMode === 'passport' && pathname === '/passport/mobile/check_qrconnect/') {
      // Trusted capture: the QR-check request adds the fixed api_sdk environment
      // and a trace id built from this request's 13-digit ticket plus a 6-digit
      // poll counter, then the lowercase hex of an ASCII marker and 01.
      this.passportSeq += 1
      const word = String(this.passportSeq).padStart(6, '0')
      const marker = this.passportSeq === 1 ? 'GEDMOCRATION_1' : `DMOCRATION_${this.passportSeq}`
      setComputedHeader(requestHeaders, 'x-tt-env', 'api_sdk')
      setComputedHeader(requestHeaders, 'x-tt-trace-id',
        `01-01${timestampMs}${word}-${Buffer.from(marker, 'utf8').toString('hex')}-01`)
    }
    // Never let a header from a previous request masquerade as fresh SDK
    // output. Stateful adapters may re-add the complete set below.
    for (const name of ['x-argus', 'x-security-argus', 'x-gorgon', 'x-ladon', 'x-khronos',
      'x-helios', 'x-medusa', 'x-perseus', 'x-bd-client-key', 'x-bd-kmsv']) setComputedHeader(requestHeaders, name, null)
    const context = Object.freeze({ method, url: url.href, pathname, query: url.search.slice(1),
      params: Object.freeze({ ...queryParams }), timestampMs, responseMode,
      headers: Object.freeze({ ...requestHeaders }), body: requestBody === null ? null : Buffer.from(requestBody),
      deviceInfo: Object.freeze({ ...this.deviceInfo }) })
    const signed = await this.signer.signRequest(context)
    signal?.throwIfAborted()
    if (signed?.params && querystring.stringify(signed.params) !== query) throw signingMismatch('Signer changed query after signing')
    if (signed?.url !== undefined && signed.url !== url.href) throw signingMismatch('Signer changed URL after signing')
    if (requestBody !== null && !context.body.equals(requestBody)) throw signingMismatch('Signer mutated body while signing')
    if (signed && Object.hasOwn(signed, 'body')) {
      const returnedBody = signed.body == null ? null : Buffer.from(signed.body)
      if (requestBody === null ? returnedBody !== null : returnedBody === null || !requestBody.equals(returnedBody)) {
        throw signingMismatch('Signer changed body after signing')
      }
    }
    for (const [name, value] of Object.entries(signed?.headers || {})) {
      const original = headerKey(requestHeaders, name)
      if (original && String(requestHeaders[original]) !== String(value)) throw signingMismatch('Signer changed input header after signing')
      if (!original && ['x-ss-stub', 'content-length'].includes(name.toLowerCase())) throw signingMismatch('Signer added body metadata without a body')
    }
    const finalHeaders = mergeHeaders(requestHeaders, signed?.headers)
    // The adapter, rather than this transport, decides which native security
    // headers are required for the configured SDK/version branch.
    if (!hasSecurityHeader(signed?.headers)) throw new DouyinBackendError('Signer did not produce required headers', { code: ERROR_CODES.ANDROID_TICKET_GUARD_UNAVAILABLE })
    const transport = this.transport || (url.protocol === 'https:' ? https : http)
    return new Promise((resolve, reject) => {
      let timer
      let settled = false
      let abort
      const finish = (error, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        if (error) reject(error); else resolve(value)
      }
      const req = transport.request(url, { method, headers: finalHeaders }, res => {
        const chunks = []
        let bytes = 0
        res.on('data', chunk => {
          const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          bytes += data.length
          if (bytes > this.maxResponseBytes) {
            finish(new DouyinBackendError('Response too large', { code: ERROR_CODES.INVALID_PARAMS }))
            req.destroy?.()
          } else chunks.push(data)
        })
        res.on('aborted', () => finish(new DouyinBackendError('Response aborted', { code: ERROR_CODES.NETWORK_ERROR, retryable: true })))
        res.on('error', () => finish(new DouyinBackendError('Response interrupted', { code: ERROR_CODES.NETWORK_ERROR, retryable: true })))
        res.on('end', async () => {
          if (settled) return
          const status = Number(res.statusCode || 0)
          if (status < 200 || status >= 300) return finish(new DouyinBackendError('HTTP request rejected', {
            statusCode: status, code: classifyHTTP(status), retryable: status >= 500
          }))
          const responseHeaders = Object.fromEntries(Object.entries(res.headers || {}).map(([name, value]) => [
            name, Array.isArray(value) ? value.slice() : value
          ]))
          try {
            const rawBody = Buffer.concat(chunks)
            const json = parseProtocolJSON(rawBody.toString('utf8'))
            if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('Invalid JSON shape')
            // TicketGuard/Metasec consumes response headers and body to update
            // the same SDK instance used for signing the request. Keep this
            // callback before business validation so an upstream challenge can
            // refresh the SDK state without creating a second client.
            await this.signer.consumeResponse?.({ request: context, signed, statusCode: status,
              headers: responseHeaders, body: json, rawBody })
            // Passport and device registration have different envelopes from Aweme.
            // Their callers validate the envelope before using any returned credentials.
            if (responseMode === 'business' && json.status_code !== 0) {
              const { normalizeAttendResponse } = require('./douyin-response-parser')
              const normalized = normalizeAttendResponse(json)
              const error = new DouyinBackendError('Upstream business request rejected', {
                code: [8, 9, 1001, 1003, 1004].includes(Number(json.status_code)) ? ERROR_CODES.AUTHENTICATION_REQUIRED : normalized.code,
                statusCode: status, retryable: false
              })
              error.businessCode = Number.isFinite(Number(json.status_code)) ? Number(json.status_code) : null
              return finish(error)
            }
            finish(null, includeResponse ? { json, statusCode: status, headers: {
              'set-cookie': res.headers?.['set-cookie'] || [], 'x-tt-token': res.headers?.['x-tt-token'] || ''
            } } : json)
          } catch (error) {
            if (error?.code === ERROR_CODES.ANDROID_TICKET_GUARD_UNAVAILABLE || error?.code === ERROR_CODES.ANDROID_SDK_UNAVAILABLE) {
              return finish(error)
            }
            finish(new DouyinBackendError('Non-JSON or invalid response', { code: ERROR_CODES.NON_JSON_RESPONSE, statusCode: status }))
          }
        })
      })
      timer = setTimeout(() => {
        finish(Object.assign(new DouyinBackendError('Protocol request timed out', { code: ERROR_CODES.NETWORK_ERROR, retryable: true }), { transportCode: 'ETIMEDOUT' }))
        req.destroy?.()
      }, this.timeoutMs)
      req.on('error', original => {
        const allowed = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH',
          'EHOSTUNREACH', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID'])
        const error = new DouyinBackendError('Protocol connection failed', { code: ERROR_CODES.NETWORK_ERROR, retryable: true })
        error.transportCode = allowed.has(original?.code) ? original.code : 'CONNECTION_FAILED'
        finish(error)
      })
      abort = () => { finish(Object.assign(new Error('Request canceled'), { code: 'LOGIN_CANCELED' })); req.destroy?.() }
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) { abort(); return }
      if (requestBody !== null) req.write(requestBody)
      req.end()
    })
  }
  get(pathname, params = {}, headers = {}) { return this.execute(pathname, { method: 'GET', params, headers }) }
  post(pathname, params = {}, headers = {}) { return this.execute(pathname, { method: 'POST', params, headers }) }
}
module.exports = { AndroidProtocolClient, DEFAULT_ANDROID_DEVICE, DEFAULT_ANDROID_USER_AGENT, classifyHTTP, parseProtocolJSON }
