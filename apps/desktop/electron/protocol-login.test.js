import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
const { NativeLoginProvider, passportData, REGISTER_PATH, QR_PATH, CHECK_PATH, SEND_CODE_PATH, VALIDATE_CODE_PATH } = require('./native-login-provider')
const { ProtocolLoginService } = require('./protocol-login-service')
const { createProtocolSessionStore } = require('./protocol-session-store')
const { createProtocolDeviceStore } = require('./protocol-device-store')
const { parseProtocolJSON, DEFAULT_ANDROID_USER_AGENT } = require('./android-protocol-client')
const { ANDROID_DEVICE, REGISTRATION_PROFILE_VERSION } = require('./android-client-profile')

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM6sAAAAASUVORK5CYII='
const profile = { deviceInfo: { device_id: '1234567890123456789', iid: '9876543210987654321', device_platform: 'android' }, userAgent: 'native-fixture' }
const registeredProfile = { ...profile, registrationProfileVersion: REGISTRATION_PROFILE_VERSION,
  deviceInfo: { ...profile.deviceInfo, ...ANDROID_DEVICE, openudid: '0123456789abcdef',
    cdid: '12345678-1234-4321-9876-123456789abc', clientudid: 'abcdefab-abcd-4321-9876-123456789abc' } }
const secretSession = { ...profile, userId: '123', nickname: '测试账号', cookie: 'sessionid=private-session', authHeaders: { 'x-tt-token': 'private-native-token' } }
const dirs = []
afterEach(() => { vi.useRealTimers(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })
function store() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dy-login-test-')); dirs.push(dir)
  // Reversible test codec only; production always uses Electron safeStorage.
  const safeStorage = { isEncryptionAvailable: () => true,
    encryptString: text => Buffer.from(text).map(byte => byte ^ 0x55),
    decryptString: buffer => Buffer.from(buffer).map(byte => byte ^ 0x55).toString() }
  const filePath = path.join(dir, 'sessions.json')
  return { filePath, safeStorage, dir, sessions: createProtocolSessionStore({ filePath, safeStorage }) }
}
function service(options = {}) {
  const storage = store()
  const provider = { prepare: vi.fn(async () => {}), createQR: vi.fn(async () => ({ qrImage: `data:image/png;base64,${png}`, expiresAt: Date.now() + 60000 })),
    poll: vi.fn(async () => ({ state: 'confirmed', userId: '123' })), verify: vi.fn(async () => secretSession), dispose: vi.fn(),
    sendCode: vi.fn(async () => ({ sent: true })), verifyCode: vi.fn(async () => ({ state: 'confirmed', userId: '123' })) }
  const onSaved = vi.fn()
  const login = new ProtocolLoginService({ sessions: storage.sessions, providerFactory: () => provider, onSaved, ...options })
  return { ...storage, provider, onSaved, login }
}
function qrService(options = {}) {
  const context = service(options)
  const start = context.login.start.bind(context.login)
  context.login.start = input => start({ ...(input || {}), mode: 'qr' })
  return context
}
async function advance(ms = 2500) { await vi.advanceTimersByTimeAsync(ms) }

describe('native QR login lifecycle', () => {
  it('saves only after mobile confirmation plus self-profile verification, encrypted and recoverable', async () => {
    vi.useFakeTimers()
    const { login, sessions, filePath, safeStorage, onSaved, provider } = qrService()
    const first = login.start(); await advance(0)
    expect(login.snapshot(first.attemptId).state).toBe('waiting')
    expect(sessions.list()).toEqual([])
    await advance()
    const final = login.snapshot(first.attemptId)
    expect(final.state).toBe('completed'); expect(final.account.id).toBe('dy_123')
    expect(final.qrImage).toBe(''); expect(provider.verify).toHaveBeenCalledOnce()
    expect(onSaved).toHaveBeenCalledOnce()
    expect(JSON.stringify(final)).not.toMatch(/private-session|private-native-token|device_id/)
    expect(fs.readFileSync(filePath, 'utf8')).not.toContain('private-session')
    expect(createProtocolSessionStore({ filePath, safeStorage }).get('dy_123').deviceInfo).toEqual(profile.deviceInfo)
    expect(sessions.get('dy_123').authHeaders['x-tt-token']).toBe('private-native-token')
  })
  it('keeps scanned state monotonic, polls sequentially and honors expiry', async () => {
    vi.useFakeTimers()
    const { login, provider, sessions } = qrService()
    provider.poll.mockResolvedValueOnce({ state: 'scanned' }).mockResolvedValue({ state: 'new' })
    login.start(); await advance(5000)
    expect(login.snapshot().state).toBe('scanned'); expect(provider.poll).toHaveBeenCalledTimes(2)
    await advance(55000)
    expect(login.snapshot().state).toBe('expired'); const count = provider.poll.mock.calls.length
    await advance(60000)
    expect(provider.poll).toHaveBeenCalledTimes(count); expect(sessions.list()).toEqual([])
  })
  it('cancels a pending request and never commits its late confirmation', async () => {
    vi.useFakeTimers()
    const { login, provider, sessions } = qrService()
    let resolve
    provider.verify.mockImplementation(() => new Promise(done => { resolve = done }))
    const attempt = login.start(); await advance()
    expect(login.snapshot().state).toBe('verifying')
    login.cancel(attempt.attemptId); resolve(secretSession); await advance(0)
    expect(login.snapshot().state).toBe('canceled'); expect(sessions.list()).toEqual([])
    expect(provider.dispose).toHaveBeenCalledOnce()
  })
  it('a stale cancel cannot cancel the replacement attempt', async () => {
    vi.useFakeTimers()
    const { login } = qrService()
    const old = login.start(); await advance(0)
    const current = login.start(); login.cancel(old.attemptId); await advance(0)
    expect(login.snapshot(current.attemptId).state).toBe('waiting')
    expect(login.snapshot(old.attemptId).success).toBe(false)
    login.dispose()
  })
  it('rejects a different account without overwriting the old credentials', async () => {
    vi.useFakeTimers()
    const { login, sessions, provider } = qrService()
    sessions.save({ ...secretSession, accountId: 'existing', userId: '456' })
    login.start({ accountId: 'existing' }); await advance()
    expect(login.snapshot().error.code).toBe('LOGIN_ACCOUNT_MISMATCH')
    expect(sessions.get('existing').userId).toBe('456'); expect(provider.verify).not.toHaveBeenCalled()
  })
  it('renews a duplicate UID under its existing account id', async () => {
    vi.useFakeTimers()
    const { login, sessions } = qrService()
    sessions.save({ ...secretSession, accountId: 'existing' })
    login.start(); await advance()
    expect(sessions.list().map(account => account.id)).toEqual(['existing'])
  })
  it('stops on unknown states, risk, and refused confirmation without retry or credential leakage', async () => {
    vi.useFakeTimers()
    for (const outcome of ['unknown', 'risk', 'refused']) {
      const { login, provider, sessions } = qrService()
      if (outcome === 'risk') provider.poll.mockRejectedValue(Object.assign(new Error('private-token'), { code: 'RATE_LIMITED_OR_RISK' }))
      else provider.poll.mockResolvedValue({ state: outcome })
      login.start(); await advance(10000)
      expect(['failed', 'canceled']).toContain(login.snapshot().state)
      expect(provider.poll).toHaveBeenCalledOnce(); expect(sessions.list()).toEqual([])
      expect(JSON.stringify(login.snapshot())).not.toContain('private-token')
    }
  })
  it('does not report success if encryption/persistence fails', async () => {
    vi.useFakeTimers()
    const { login, sessions, onSaved } = qrService()
    vi.spyOn(sessions, 'save').mockImplementation(() => { throw new Error('private local path') })
    login.start(); await advance()
    expect(login.snapshot().error.code).toBe('LOGIN_STORAGE_FAILED'); expect(onSaved).not.toHaveBeenCalled()
    expect(sessions.list()).toEqual([])
  })
  it('stops after client rejection following a scan, with no save or automatic QR retry', async () => {
    vi.useFakeTimers()
    const { login, provider, sessions, onSaved } = qrService()
    provider.poll.mockResolvedValueOnce({ state: 'scanned' }).mockRejectedValue(Object.assign(new Error('private upstream'), {
      code: 'LOGIN_CLIENT_REJECTED', businessCode: 1049
    }))
    login.start(); await advance(2500)
    expect(login.snapshot().state).toBe('scanned')
    await advance(60000)
    expect(login.snapshot()).toMatchObject({ state: 'failed', qrImage: '', error: { code: 'LOGIN_CLIENT_REJECTED', businessCode: 1049 } })
    expect(provider.poll).toHaveBeenCalledTimes(2); expect(provider.createQR).toHaveBeenCalledOnce()
    expect(provider.verify).not.toHaveBeenCalled(); expect(provider.dispose).toHaveBeenCalledOnce()
    expect(sessions.list()).toEqual([]); expect(onSaved).not.toHaveBeenCalled()
    expect(JSON.stringify(login.snapshot())).not.toContain('private upstream')
  })
  it('does not register a device when OS credential encryption is unavailable', () => {
    const { login, provider } = service({ deviceStore: { assertAvailable() { throw Object.assign(new Error(), { code: 'LOGIN_STORAGE_UNAVAILABLE' }) } } })
    expect(login.start().success).toBe(false); expect(provider.prepare).not.toHaveBeenCalled()
  })
})

describe('phone SMS login lifecycle', () => {
  it('is the default mode and completes via mobile, code, then self-profile verification', async () => {
    vi.useFakeTimers()
    const { login, sessions, onSaved, provider } = service()
    const first = login.start(); await advance(0)
    expect(first.mode).toBe('sms')
    expect(login.snapshot(first.attemptId).state).toBe('waiting_mobile')
    expect(login.submit({ attemptId: first.attemptId, mobile: '13800138000' })); await advance(0)
    expect(provider.sendCode).toHaveBeenCalledWith('13800138000', expect.anything())
    expect(login.snapshot(first.attemptId).state).toBe('waiting_code')
    login.submit({ attemptId: first.attemptId, code: '123456' }); await advance(0)
    expect(provider.verifyCode).toHaveBeenCalledWith('123456', expect.anything())
    expect(provider.verify).toHaveBeenCalledWith('123', expect.anything())
    const final = login.snapshot(first.attemptId)
    expect(final.state).toBe('completed'); expect(final.account.id).toBe('dy_123')
    expect(onSaved).toHaveBeenCalledOnce(); expect(sessions.get('dy_123').userId).toBe('123')
    expect(JSON.stringify(final)).not.toMatch(/private-session|private-native-token|device_id/)
  })
  it('rejects malformed mobile or code input without calling the provider', async () => {
    vi.useFakeTimers()
    const { login, provider } = service()
    login.start(); await advance(0)
    expect(login.snapshot().state).toBe('waiting_mobile')
    login.submit({ mobile: '' })
    expect(login.snapshot().error.code).toBe('LOGIN_MOBILE_INVALID')
    expect(provider.sendCode).not.toHaveBeenCalled()
  })
  it('stops on a send-code failure and honors expiry while waiting for the code', async () => {
    vi.useFakeTimers()
    const { login, provider, sessions } = service()
    provider.sendCode.mockRejectedValueOnce(Object.assign(new Error('private upstream'), {
      code: 'LOGIN_CLIENT_REJECTED', businessCode: 1049
    }))
    const attempt = login.start(); await advance(0)
    login.submit({ attemptId: attempt.attemptId, mobile: '13800138000' }); await advance(0)
    expect(login.snapshot(attempt.attemptId)).toMatchObject({ state: 'failed',
      error: { code: 'LOGIN_CLIENT_REJECTED', businessCode: 1049 } })
    expect(provider.verifyCode).not.toHaveBeenCalled(); expect(sessions.list()).toEqual([])
    const next = login.start(); await advance(0)
    await advance(180000)
    expect(login.snapshot(next.attemptId).state).toBe('expired')
    expect(provider.dispose).toHaveBeenCalledTimes(2)
  })
  it('a late code submission for a replaced attempt does not touch the current one', async () => {
    vi.useFakeTimers()
    const { login, provider } = service()
    const old = login.start(); await advance(0)
    const current = login.start(); await advance(0)
    expect(login.submit({ attemptId: old.attemptId, code: '123456' })).toMatchObject({ success: false })
    expect(login.snapshot(current.attemptId).state).toBe('waiting_mobile')
    expect(provider.verifyCode).not.toHaveBeenCalled()
    login.dispose()
  })
})

describe('Android Passport adapter', () => {
  it.each([false, true])('sends the shared UA through the production client and saves it (existing installation: %s)', async existing => {
    const https = require('node:https')
    const requests = []
    const deviceStore = { get: () => existing ? { ...registeredProfile, userAgent: 'old-DesktopProtocol' } : null, save: vi.fn() }
    const request = vi.spyOn(https, 'request').mockImplementation((url, options, callback) => {
      requests.push({ pathname: url.pathname, headers: options.headers, query: url.searchParams })
      const json = url.pathname === REGISTER_PATH ? { device_id_str: profile.deviceInfo.device_id, install_id_str: profile.deviceInfo.iid }
        : url.pathname === QR_PATH ? { message: 'success', data: { qrcode: png, token: 'fixture-token', expire_time: 60, ds: 'fixture-ds' } }
        : url.pathname === CHECK_PATH ? { message: 'success', data: { status: 'confirmed', user_data: { user_id: '123', session_key: 'fixture-session' } } }
        : { status_code: 0, user: { uid: '123', nickname: 'fixture' } }
      const req = new EventEmitter()
      req.destroy = () => {}; req.write = () => {}
      req.end = () => queueMicrotask(() => {
        const res = new EventEmitter(); res.statusCode = 200; res.headers = {}
        callback(res); res.emit('data', JSON.stringify(json)); res.emit('end')
      })
      return req
    })
    const provider = new NativeLoginProvider({ deviceStore })
    try {
      await provider.prepare(); await provider.createQR()
      const confirmed = await provider.poll()
      const session = await provider.verify(confirmed.userId)
      expect(requests.map(item => item.pathname)).toEqual([
        ...(existing ? [] : [REGISTER_PATH]), QR_PATH, CHECK_PATH, '/aweme/v1/user/profile/self/'
      ])
      // The trusted capture omits User-Agent/Accept on the Passport frames only.
      const nonPassport = requests.filter(item => item.pathname === REGISTER_PATH || item.pathname === '/aweme/v1/user/profile/self/')
      expect(nonPassport.every(item => item.headers['User-Agent'] === DEFAULT_ANDROID_USER_AGENT)).toBe(true)
      expect(nonPassport.every(item => !item.headers['User-Agent'].includes('DesktopProtocol'))).toBe(true)
      expect(requests.every(item => /^\d{13}$/.test(item.headers['x-ss-req-ticket']))).toBe(true)
      expect(requests.every(item => item.headers['x-security-argus'] === undefined)).toBe(true)
      expect(nonPassport.every(item => item.query.get('device_type') === 'Pixel 6' && item.query.get('os_api') === '32')).toBe(true)
      // Passport frames carry the exact trusted-capture parameter sets and order.
      const qrRequest = requests.find(item => item.pathname === QR_PATH)
      const checkRequest = requests.find(item => item.pathname === CHECK_PATH)
      // The trusted capture's nine parameters plus the live-probe addition:
      // device_platform=android is what flips get_qrcode from error_code 11 to 0.
      expect([...qrRequest.query.keys()]).toEqual([
        'service', 'account_sdk_source', 'aid', 'version_code', 'passport-sdk-version',
        'request_from_account_sdk', 'is_from_ttaccountsdk', 'device_platform', 'need_logo', 'source'
      ])
      expect(qrRequest.query.get('version_code')).toBe('40.7.0')
      expect(qrRequest.query.get('device_platform')).toBe('android')
      expect([...checkRequest.query.keys()]).toEqual([
        'service', 'scene', 'account_sdk_source', 'aid', 'version_code', 'passport-sdk-version',
        'request_from_account_sdk', 'is_from_ttaccountsdk', 'token'
      ])
      expect(checkRequest.query.get('token')).toBe('fixture-token')
      // Only the request ticket appears as security-style output on these frames.
      expect(qrRequest.headers['x-argus']).toBeUndefined()
      expect(checkRequest.headers['x-argus']).toBeUndefined()
      // The QR-check frame echoes the issued ds and adds the two derived headers.
      expect(checkRequest.headers['x-tt-dt']).toBe('fixture-ds')
      expect(checkRequest.headers['x-tt-env']).toBe('api_sdk')
      expect(checkRequest.headers['x-tt-trace-id']).toMatch(/^01-01\d{13}000001-4745444d4f43524154494f4e5f31-01$/)
      expect(deviceStore.save).toHaveBeenCalledWith(expect.objectContaining({ userAgent: DEFAULT_ANDROID_USER_AGENT }))
      expect(session.userAgent).toBe(DEFAULT_ANDROID_USER_AGENT)
      expect(session.deviceInfo.device_id).toBe(profile.deviceInfo.device_id)
    } finally { provider.dispose(); request.mockRestore() }
  })
  function setup(overrides = {}) {
    const calls = []
    const deviceStore = { get: vi.fn(() => null), save: vi.fn() }
    const clientFactory = (device, origin) => ({ execute: async (pathname, options) => {
      calls.push({ device, origin, pathname, options })
      const json = overrides[pathname] || (pathname === REGISTER_PATH ? { device_id_str: '1234567890123456789', install_id_str: '9876543210987654321' }
        : pathname === QR_PATH ? { message: 'success', data: { qrcode: `data:image/png;base64,${png}`, token: 'private-qr-token', expire_time: Math.floor(Date.now()/1000)+120 } }
        : pathname === CHECK_PATH ? { message: 'success', data: { status: 'confirmed', user_data: { user_id: '123', session_key: 'private-session' } } }
        : { status_code: 0, user: { uid: '123', nickname: '测试账号' } })
      return { json, headers: { 'set-cookie': pathname === QR_PATH ? ['passport_csrf_token=private-csrf; Path=/; Secure', 'foreign=bad; Domain=example.com; Path=/'] : [] }, statusCode: 200 }
    } })
    return { provider: new NativeLoginProvider({ deviceStore, clientFactory }), deviceStore, calls }
  }
  it('uses native endpoints, server-issued device IDs, server QR bytes, and the same device through verification', async () => {
    const { provider, deviceStore, calls } = setup()
    await provider.prepare(); const qr = await provider.createQR(); const confirmed = await provider.poll(); const session = await provider.verify(confirmed.userId)
    expect(qr.qrImage).toBe(`data:image/png;base64,${png}`)
    expect(deviceStore.save).toHaveBeenCalledOnce(); expect(session.cookie).toContain('sessionid=private-session')
    expect(session.cookie).not.toContain('foreign')
    expect(calls.map(call => call.pathname)).toEqual([REGISTER_PATH, QR_PATH, CHECK_PATH, '/aweme/v1/user/profile/self/'])
    expect(calls[1].options.params).toMatchObject({ service: 'https://aweme.snssdk.com', source: 'pad', need_logo: '1' })
    expect(calls[2].options.params).toMatchObject({ service: 'aweme.snssdk.com', token: 'private-qr-token' })
    expect(calls.slice(1).every(call => call.device.deviceInfo.device_id === session.deviceInfo.device_id)).toBe(true)
    expect(calls.every(call => call.device.deviceInfo.manifest_version_code === '400701' &&
      call.device.deviceInfo.update_version_code === '40709900')).toBe(true)
    expect(calls[2].options.params).toMatchObject({ 'passport-sdk-version': '60759', is_from_ttaccountsdk: '1' })
    expect(calls[2].options.headers.Cookie).toContain('passport_csrf_token=private-csrf')
    expect(calls[2].options.headers['x-tt-passport-csrf-token']).toBe('private-csrf')
    expect(calls[3].options.headers['x-tt-passport-csrf-token']).toBeUndefined()
    const registration = JSON.parse(calls[0].options.body).header
    expect(registration).toMatchObject({ device_model: 'Pixel 6', device_brand: 'google', device_manufacturer: 'Google',
      os_api: 32, version_code: 400700, manifest_version_code: 400701, update_version_code: 40709900 })
    expect(session.deviceInfo.clientudid).toBe(registration.clientudid)
    expect(session.deviceInfo.cdid).toBe(registration.cdid)
    expect(session.deviceInfo.openudid).toBe(registration.openudid)
    expect(session.deviceInfo.device_type).toBe(registration.device_model)
    provider.dispose(); expect(provider.token).toBe(''); expect(provider.profile).toBe(null)
  })
  it('memoizes one protocol client per origin so the SDK instance persists across the login flow', () => {
    const provider = new NativeLoginProvider({ deviceStore: { get: () => null, save: () => {} } })
    const device = { deviceInfo: { device_id: '1', iid: '2', device_platform: 'android' }, userAgent: 'ua' }
    const first = provider.clientFactory(device, 'https://aweme.snssdk.com')
    const again = provider.clientFactory(device, 'https://aweme.snssdk.com')
    const other = provider.clientFactory(device, 'https://log.snssdk.com')
    expect(first).toBe(again)
    expect(other).not.toBe(first)
  })
  it('does not invent server IDs or continue after unsuccessful registration', async () => {
    const { provider, deviceStore, calls } = setup({ [REGISTER_PATH]: { device_id: 0, install_id: 0 } })
    await expect(provider.prepare()).rejects.toMatchObject({ code: 'LOGIN_DEVICE_REGISTRATION_REJECTED' })
    expect(calls).toHaveLength(1); expect(deviceStore.save).not.toHaveBeenCalled()
  })
  it('reuses an encrypted registered installation without registering again', async () => {
    const { provider, deviceStore, calls } = setup()
    deviceStore.get.mockReturnValue(registeredProfile)
    await provider.prepare(); await provider.createQR()
    expect(calls).toHaveLength(1); expect(calls[0].pathname).toBe(QR_PATH)
    expect(deviceStore.save).toHaveBeenCalledOnce()
    expect(provider.profile.deviceInfo).toMatchObject({ ...registeredProfile.deviceInfo,
      version_code: '400700', manifest_version_code: '400701', update_version_code: '40709900' })
    deviceStore.get.mockReturnValue(provider.profile)
    await provider.prepare()
    expect(deviceStore.save).toHaveBeenCalledOnce()
  })
  it('replaces an incompatible legacy registration once and recovers the complete profile encrypted', async () => {
    const { provider, deviceStore, calls } = setup({ [REGISTER_PATH]: { device_id_str: '2222222222222222222', install_id_str: '3333333333333333333' } })
    deviceStore.get.mockReturnValue(profile)
    await provider.prepare()
    expect(calls.map(call => call.pathname)).toEqual([REGISTER_PATH])
    const saved = deviceStore.save.mock.calls[0][0]
    expect(saved.deviceInfo.device_id).not.toBe(profile.deviceInfo.device_id)
    expect(saved).toMatchObject({ registrationProfileVersion: REGISTRATION_PROFILE_VERSION, deviceInfo: ANDROID_DEVICE })
    const { dir, safeStorage } = store()
    const filePath = path.join(dir, 'registered-device.json')
    createProtocolDeviceStore({ filePath, safeStorage }).save(saved)
    deviceStore.get.mockReturnValue(createProtocolDeviceStore({ filePath, safeStorage }).get())
    await provider.prepare()
    expect(calls).toHaveLength(1); expect(deviceStore.save).toHaveBeenCalledOnce()
    expect(provider.profile).toEqual(saved)
  })
  it('preserves the legacy encrypted profile if replacement registration fails', async () => {
    const { provider, deviceStore } = setup({ [REGISTER_PATH]: { device_id: 0, install_id: 0 } })
    deviceStore.get.mockReturnValue(profile)
    await expect(provider.prepare()).rejects.toMatchObject({ code: 'LOGIN_DEVICE_REGISTRATION_REJECTED' })
    expect(deviceStore.save).not.toHaveBeenCalled(); expect(deviceStore.get()).toEqual(profile)
  })
  it('classifies 1049 as client rejection without claiming a unique cause or exposing upstream data', () => {
    let error
    try { passportData({ message: 'error', data: { error_code: 1049, description: 'private upstream data' } }) } catch (value) { error = value }
    expect(error).toMatchObject({ code: 'LOGIN_CLIENT_REJECTED', businessCode: 1049 })
    expect(require('./protocol-login-service').safeError(error)).toMatchObject({ code: 'LOGIN_CLIENT_REJECTED', businessCode: 1049 })
    expect(JSON.stringify(error)).not.toContain('private upstream data')
  })
  it.each([11, 2046, 1105])('fails closed on Passport error %i', code => {
    expect(() => passportData({ message: 'error', data: { error_code: code, description: 'private upstream data' } })).toThrow()
  })
  it('rejects redirects as a substitute for a native confirmed session', async () => {
    const { provider } = setup({ [CHECK_PATH]: { message: 'success', data: { status: 'confirmed', redirect_url: 'https://example.com/session-secret' } } })
    await provider.prepare(); await provider.createQR()
    await expect(provider.poll()).rejects.toMatchObject({ code: 'LOGIN_SESSION_MISSING' })
  })
  it('rejects unsafe QR images, unknown statuses and missing sessions', async () => {
    const { provider } = setup({ [QR_PATH]: { message: 'success', data: { token: 'private', qrcode: 'data:image/svg+xml;base64,PHN2Zz4=', expire_time: 60 } } })
    await provider.prepare(); await expect(provider.createQR()).rejects.toMatchObject({ code: 'LOGIN_QR_SCHEMA_UNCONFIRMED' })
  })
  it('retains native long numeric identifiers without rounding', () => {
    const parsed = parseProtocolJSON('{"user_id":1234567890123456789,"device_id":9876543210987654321,"error_code":0}')
    expect(parsed.user_id).toBe('1234567890123456789'); expect(parsed.device_id).toBe('9876543210987654321')
    expect(parsed.error_code).toBe(0)
  })
  it('persists the installation encrypted and refuses plaintext fallback', () => {
    const { dir, safeStorage } = store()
    const filePath = path.join(dir, 'device.json')
    const devices = createProtocolDeviceStore({ filePath, safeStorage })
    devices.save(profile)
    expect(fs.readFileSync(filePath, 'utf8')).not.toContain(profile.deviceInfo.device_id)
    expect(createProtocolDeviceStore({ filePath, safeStorage }).get()).toEqual(profile)
    safeStorage.isEncryptionAvailable = () => false
    expect(() => devices.get()).toThrow(); expect(() => devices.save(profile)).toThrow()
  })
})
