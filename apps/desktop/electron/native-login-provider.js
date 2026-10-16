const crypto = require('node:crypto')
const { CookieJar } = require('tough-cookie')
const { AndroidProtocolClient, DEFAULT_ANDROID_DEVICE, DEFAULT_ANDROID_USER_AGENT } = require('./android-protocol-client')
const { AndroidSignatureProvider } = require('./android-signature-provider')
const { PROFILE_PATH } = require('./protocol-runtime')
const { ANDROID_APP, ANDROID_DEVICE, ANDROID_PACKAGE, REGISTRATION_PROFILE_VERSION } = require('./android-client-profile')

// Request paths/fields recovered from the official Android packages; current
// version tuple and SDK version verified against the 40.7.0 download (2026-10-15).
// Static evidence does not prove that the current service accepts this client.
const AUTH_ORIGIN = 'https://aweme.snssdk.com'
const REGISTER_ORIGIN = 'https://log.snssdk.com'
const REGISTER_PATH = '/service/2/device_register/'
const QR_PATH = '/passport/mobile/get_qrcode/'
const CHECK_PATH = '/passport/mobile/check_qrconnect/'
const APP = ANDROID_APP
const APP_PACKAGE = ANDROID_PACKAGE
// Use the same UA as subsequent protocol requests; a local override previously
// prevented updates to the shared Android UA from reaching Passport requests.
const USER_AGENT = DEFAULT_ANDROID_USER_AGENT
const ACCOUNT_PARAMS = Object.freeze({ service: 'aweme.snssdk.com', scene: '0',
  account_sdk_source: 'app', 'passport-sdk-version': '60759', request_from_account_sdk: '1', is_from_ttaccountsdk: '1' })
function fail(code, extra = {}) { return Object.assign(new Error(code), { code, ...extra }) }
function decimalID(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return ''
  const id = String(value ?? '')
  return /^[1-9][0-9]{0,31}$/.test(id) ? id : ''
}
function passportData(json) {
  const data = json?.data
  const code = data?.error_code
  const details = { businessCode: Number.isSafeInteger(code) ? code : null }
  // The official client opens a force-update dialog, but the live response also
  // names unofficial client sources. This code alone cannot identify the cause.
  if (code === 1049) throw fail('LOGIN_CLIENT_REJECTED', details)
  if (data?.captcha || data?.verify_center_decision_conf || [1105, 1107, 2046].includes(code)) throw fail('LOGIN_CHALLENGE_REQUIRED', details)
  if (json?.message !== 'success' || !data || typeof data !== 'object' || Array.isArray(data) || (code !== undefined && code !== 0)) {
    throw fail(code === 11 ? 'LOGIN_APP_UNSUPPORTED' : 'LOGIN_PASSPORT_REJECTED', details)
  }
  return data
}
function validProfile(profile) {
  return profile && decimalID(profile.deviceInfo?.device_id) && decimalID(profile.deviceInfo?.iid) &&
    profile.deviceInfo?.device_platform === 'android' && typeof profile.userAgent === 'string' && profile.userAgent.length > 0
}
function reusableProfile(profile) {
  return validProfile(profile) && profile.registrationProfileVersion === REGISTRATION_PROFILE_VERSION &&
    Object.entries(ANDROID_DEVICE).every(([key, value]) => profile.deviceInfo[key] === value) &&
    /^[a-f0-9]{16}$/.test(profile.deviceInfo.openudid || '') &&
    [profile.deviceInfo.cdid, profile.deviceInfo.clientudid].every(value => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value || ''))
}

class NativeLoginProvider {
  constructor({ deviceStore, clientFactory, signer, signerFactory, now = Date.now } = {}) {
    this.deviceStore = deviceStore
    this.now = now
    // The native metasec object keeps per-instance state (round counter, cached
    // context). One SDK/signature instance must live for the whole login flow, so
    // memoize clients per origin and share one signer across those origins. Device
    // registration and Passport are part of the same installation/login context.
    this.clientCache = new Map()
    this.signer = signer || null
    this.signerFactory = signerFactory || (() => new AndroidSignatureProvider())
    this.controller = new AbortController()
    this.disposed = false
    this.clientFactory = (profile, baseUrl) => {
      this.assertActive()
      let client = this.clientCache.get(baseUrl)
      if (!client) {
        this.signer ||= this.signerFactory(profile)
        client = clientFactory ? clientFactory(profile, baseUrl, { signer: this.signer })
          : new AndroidProtocolClient({ baseUrl, deviceInfo: profile.deviceInfo,
            userAgent: profile.userAgent, signer: this.signer })
        client.setSigner?.(this.signer)
        this.clientCache.set(baseUrl, client)
      }
      this.updateClientProfile(client, profile)
      return client
    }
    this.jar = new CookieJar()
    this.profile = null
    this.token = ''
    this.authHeaders = {}
  }
  assertActive(signal) {
    if (this.disposed || this.controller.signal.aborted || signal?.aborted) throw fail('LOGIN_CANCELED')
  }
  updateClientProfile(client, profile) {
    if (profile) {
      client.deviceInfo = { ...DEFAULT_ANDROID_DEVICE, ...profile.deviceInfo }
      client.userAgent = profile.userAgent
    }
  }
  setProfile(profile) {
    this.profile = profile
    // AndroidProtocolClient copies its deviceInfo at construction. Registration
    // replaces the seed profile, so cached clients must receive the issued IDs.
    for (const client of this.clientCache.values()) this.updateClientProfile(client, profile)
  }
  async request(origin, pathname, options = {}) {
    this.assertActive(options.signal)
    const signal = options.signal ? AbortSignal.any([options.signal, this.controller.signal]) : this.controller.signal
    const requestURL = origin + pathname
    const cookie = this.jar.getCookieStringSync(requestURL)
    const headers = { ...options.headers, ...this.authHeaders, ...(cookie ? { Cookie: cookie } : {}) }
    if (origin === AUTH_ORIGIN && pathname.startsWith('/passport/mobile/')) {
      // The SDK mirrors the scoped Passport CSRF cookie into this header.
      const cookies = this.jar.getCookiesSync(requestURL)
      const csrf = cookies.find(item => item.key === 'passport_csrf_token')?.value ||
        cookies.find(item => item.key === 'passport_csrf_token_default')?.value
      if (csrf && csrf.length <= 4096 && !/[\r\n\x00]/.test(csrf)) headers['x-tt-passport-csrf-token'] = csrf
    }
    const response = await this.clientFactory(this.profile, origin).execute(pathname, {
      ...options, includeResponse: true, headers, signal
    })
    // A transport or injected adapter can resolve after cancellation. It must
    // never refill cookies/tokens after dispose or commit a registered device.
    this.assertActive(signal)
    for (const value of response.headers['set-cookie'] || []) {
      try { this.jar.setCookieSync(value, requestURL) } catch { /* Invalid cookie scope is not accepted. */ }
    }
    const token = response.headers['x-tt-token']
    if (typeof token === 'string' && token.length <= 8192 && !/[\r\n\x00]/.test(token) && token) this.authHeaders['x-tt-token'] = token
    return response.json
  }
  async prepare(signal) {
    this.assertActive(signal)
    const existing = this.deviceStore?.get()
    if (existing && !validProfile(existing)) throw fail('LOGIN_DEVICE_INVALID')
    if (reusableProfile(existing)) {
      // App request metadata can change without registering another installation.
      // The full version tuple comes from AndroidManifest.xml and X.5yQ, not
      // a guessed newer version. Keep the registered IDs and installation nonces.
      this.setProfile({ ...existing, deviceInfo: { ...existing.deviceInfo, ...APP }, userAgent: USER_AGENT })
      if (JSON.stringify(this.profile) !== JSON.stringify(existing)) this.deviceStore.save(this.profile)
      return
    }
    // A legacy registration used DesktopProtocol/generic and omitted clientudid
    // from storage. Register a coherent replacement once; never relabel its IDs.
    // The old encrypted record remains intact if registration fails or is canceled.
    const seed = { ...APP, ...ANDROID_DEVICE, openudid: crypto.randomBytes(8).toString('hex'),
      cdid: crypto.randomUUID(), clientudid: crypto.randomUUID() }
    this.setProfile({ deviceInfo: seed, userAgent: USER_AGENT })
    const header = { ...seed, app_version: APP.version_name, package: APP_PACKAGE,
      os: 'Android', device_model: seed.device_type,
      aid: Number(APP.aid), version_code: Number(APP.version_code),
      manifest_version_code: Number(APP.manifest_version_code), update_version_code: Number(APP.update_version_code),
      os_api: Number(seed.os_api),
      timezone: 8, tz_name: 'Asia/Shanghai', tz_offset: 28800, access: 'wifi',
      device_id: '0', install_id: '0' }
    // The APK contains a JSON registration branch. No silent encoding/host retries.
    const json = await this.request(REGISTER_ORIGIN, REGISTER_PATH, { method: 'POST', signal,
      responseMode: 'registration', isForm: false, headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: Buffer.from(JSON.stringify({ magic_tag: 'ss_app_log', header, _gen_time: this.now() })) })
    const deviceId = decimalID(json.device_id_str || json.device_id)
    const iid = decimalID(json.install_id_str || json.install_id)
    if (!deviceId || !iid || (json.status_code !== undefined && json.status_code !== 0) ||
      (json.error_code !== undefined && json.error_code !== 0) || json.message === 'error') throw fail('LOGIN_DEVICE_REGISTRATION_REJECTED')
    this.assertActive(signal)
    this.setProfile({ deviceInfo: { ...seed, device_id: deviceId, iid }, userAgent: USER_AGENT,
      registeredAt: this.now(), registrationProfileVersion: REGISTRATION_PROFILE_VERSION })
    this.deviceStore?.save(this.profile)
  }
  async createQR(signal) {
    this.assertActive(signal)
    if (!validProfile(this.profile)) throw fail('LOGIN_DEVICE_INVALID')
    this.token = ''
    // GetScanCodeTransformer supplies an absolute service URL when issuing the QR;
    // check_qrconnect's SDK builder uses the bare host.
    // The server QR opens the official phone confirmation page, whose title can
    // default to "抖音网页版" when carrier_platform_info.device_login_display_name
    // is absent. This is not a desktop Web fallback: only mobile APIs run here.
    const data = passportData(await this.request(AUTH_ORIGIN, QR_PATH, {
      // The APK's large-screen QR flow selects source=pad and need_logo=1.
      params: { ...ACCOUNT_PARAMS, service: AUTH_ORIGIN, source: 'pad', need_logo: '1' }, responseMode: 'passport', signal
    }))
    if (typeof data.token !== 'string' || !data.token || data.token.length > 4096) throw fail('LOGIN_QR_SCHEMA_UNCONFIRMED')
    // Only server-supplied PNG bytes are displayed. Never fetch an arbitrary image URL.
    const qr = String(data.qrcode || '').replace(/^data:image\/png;base64,/, '')
    if (qr.length > 512000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(qr) ||
      !Buffer.from(qr, 'base64').subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw fail('LOGIN_QR_SCHEMA_UNCONFIRMED')
    const expire = Number(data.expire_time)
    const expiresAt = expire > 1e12 ? expire : expire > 1e9 ? expire * 1000 : this.now() + expire * 1000
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now()) throw fail('LOGIN_QR_EXPIRED')
    this.token = data.token
    return { qrImage: 'data:image/png;base64,' + qr, expiresAt: Math.min(expiresAt, this.now() + 180000) }
  }
  async poll(signal) {
    this.assertActive(signal)
    if (!this.token) throw fail('LOGIN_QR_EXPIRED')
    const data = passportData(await this.request(AUTH_ORIGIN, CHECK_PATH, {
      params: { ...ACCOUNT_PARAMS, token: this.token }, responseMode: 'passport', signal
    }))
    if (['new', 'scanned', 'expired', 'refused'].includes(data.status)) return { state: data.status }
    if (data.status !== 'confirmed') throw fail('LOGIN_STATUS_UNCONFIRMED')
    // Mobile check_qrconnect returns user_data. Web redirect URLs are not followed.
    const user = data.user_data
    if (!user || typeof user !== 'object') throw fail('LOGIN_SESSION_MISSING')
    const id = decimalID(user.user_id_str || user.user_id || user.uid_str || user.uid)
    if (!id) throw fail('LOGIN_IDENTITY_UNCONFIRMED')
    const sessionId = user.session_key
    if (sessionId !== undefined) {
      if (typeof sessionId !== 'string' || !/^[A-Za-z0-9._~-]{1,4096}$/.test(sessionId)) throw fail('LOGIN_SESSION_MISSING')
      this.jar.setCookieSync(`sessionid=${sessionId}; Path=/; Secure; HttpOnly`, AUTH_ORIGIN)
    }
    return { state: 'confirmed', userId: id }
  }
  async verify(userId, signal) {
    this.assertActive(signal)
    const cookie = this.jar.getCookieStringSync(AUTH_ORIGIN + PROFILE_PATH)
    if (!/(?:^|;\s*)sessionid(?:_ss)?=\S+/.test(cookie)) throw fail('LOGIN_SESSION_MISSING')
    const json = await this.request(AUTH_ORIGIN, PROFILE_PATH, { signal })
    const user = json.user || json.data?.user
    const uid = decimalID(user?.uid_str || user?.uid)
    if (!uid || uid !== userId) throw fail('LOGIN_ACCOUNT_MISMATCH')
    return { userId: uid, nickname: String(user.nickname || `抖音账号 ${uid}`).slice(0, 100),
      cookie: this.jar.getCookieStringSync(AUTH_ORIGIN + PROFILE_PATH), authHeaders: { ...this.authHeaders },
      deviceInfo: { ...this.profile.deviceInfo }, userAgent: this.profile.userAgent }
  }
  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.controller.abort()
    this.token = ''; this.jar.removeAllCookiesSync(); this.authHeaders = {}; this.profile = null
    const resources = new Set([...this.clientCache.values(), this.signer])
    this.clientCache.clear(); this.signer = null
    for (const resource of resources) {
      try { resource?.dispose?.()?.catch?.(() => {}) } catch { /* Cleanup must not prevent canceling the login. */ }
    }
  }
}
module.exports = { NativeLoginProvider, passportData, decimalID, validProfile, reusableProfile, APP, ACCOUNT_PARAMS,
  AUTH_ORIGIN, REGISTER_ORIGIN, REGISTER_PATH, QR_PATH, CHECK_PATH }
