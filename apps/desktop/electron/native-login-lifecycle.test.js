import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

const https = require('node:https')
const { NativeLoginProvider, REGISTER_PATH, QR_PATH, CHECK_PATH, AUTH_ORIGIN, REGISTER_ORIGIN } = require('./native-login-provider')
const { ANDROID_DEVICE, REGISTRATION_PROFILE_VERSION } = require('./android-client-profile')

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM6sAAAAASUVORK5CYII='
const ids = { device_id: '1234567890123456789', iid: '9876543210987654321' }
const registered = { registrationProfileVersion: REGISTRATION_PROFILE_VERSION, userAgent: 'fixture',
  deviceInfo: { ...ANDROID_DEVICE, ...ids, device_platform: 'android', openudid: '0123456789abcdef',
    cdid: '12345678-1234-4321-9876-123456789abc', clientudid: 'abcdefab-abcd-4321-9876-123456789abc' } }
const providers = []
afterEach(() => { for (const provider of providers.splice(0)) provider.dispose(); vi.restoreAllMocks() })
function create(options) { const provider = new NativeLoginProvider(options); providers.push(provider); return provider }
function response(json, headers = {}) { return { json, headers, statusCode: 200 } }
function qr(token = 'fixture-qr', expire = 60) { return { message: 'success', data: { qrcode: png, token, expire_time: expire } } }

describe('native login SDK context lifetime', () => {
  it('shares one signer across registration, QR, polling and verification and updates issued device IDs', async () => {
    const contexts = []
    const signer = { signRequest: vi.fn(async context => {
      contexts.push(context)
      return { headers: { 'x-argus': `fixture-round-${contexts.length}` } }
    }), dispose: vi.fn() }
    const signerFactory = vi.fn(() => signer)
    const requests = []
    vi.spyOn(https, 'request').mockImplementation((url, options, callback) => {
      requests.push({ url, options })
      const json = url.pathname === REGISTER_PATH ? { device_id_str: ids.device_id, install_id_str: ids.iid }
        : url.pathname === QR_PATH ? qr()
        : url.pathname === CHECK_PATH ? { message: 'success', data: { status: 'confirmed', user_data: { user_id: '123', session_key: 'fixture-session' } } }
        : { status_code: 0, user: { uid: '123' } }
      const req = new EventEmitter()
      req.write = () => {}; req.destroy = () => {}
      req.end = () => queueMicrotask(() => {
        const res = new EventEmitter(); res.statusCode = 200; res.headers = {}
        callback(res); res.emit('data', JSON.stringify(json)); res.emit('end')
      })
      return req
    })
    const provider = create({ deviceStore: { get: () => null, save: vi.fn() }, signerFactory })
    await provider.prepare(); await provider.createQR()
    const confirmed = await provider.poll(); await provider.verify(confirmed.userId)
    expect(signerFactory).toHaveBeenCalledOnce()
    expect(contexts.map(context => context.pathname)).toEqual([REGISTER_PATH, QR_PATH, CHECK_PATH, '/aweme/v1/user/profile/self/'])
    expect(contexts[0].deviceInfo.device_id).toBeUndefined()
    expect(contexts.slice(1).every(context => context.deviceInfo.device_id === ids.device_id && context.deviceInfo.iid === ids.iid)).toBe(true)
    expect(requests.map(item => item.options.headers['x-argus'])).toEqual(['fixture-round-1', 'fixture-round-2', 'fixture-round-3', 'fixture-round-4'])
    expect(provider.clientCache.get(REGISTER_ORIGIN).getSigner()).toBe(provider.clientCache.get(AUTH_ORIGIN).getSigner())
    expect(provider.clientCache.get(REGISTER_ORIGIN).deviceInfo).toMatchObject(ids)
    provider.dispose(); provider.dispose()
    expect(signer.dispose).toHaveBeenCalledOnce()
  })

  it('memoizes injected clients, passes the same signer and disposes all attempt resources once', () => {
    const signer = { dispose: vi.fn() }
    const clientFactory = vi.fn(() => ({ execute: vi.fn(), setSigner: vi.fn(), dispose: vi.fn() }))
    const provider = create({ signer, clientFactory })
    const first = provider.clientFactory(registered, REGISTER_ORIGIN)
    const again = provider.clientFactory(registered, REGISTER_ORIGIN)
    const other = provider.clientFactory(registered, AUTH_ORIGIN)
    expect(first).toBe(again); expect(other).not.toBe(first)
    expect(clientFactory).toHaveBeenCalledTimes(2)
    expect(clientFactory.mock.calls.every(call => call[2].signer === signer)).toBe(true)
    expect(first.setSigner).toHaveBeenCalledWith(signer); expect(other.setSigner).toHaveBeenCalledWith(signer)
    provider.dispose(); provider.dispose()
    expect(first.dispose).toHaveBeenCalledOnce(); expect(other.dispose).toHaveBeenCalledOnce(); expect(signer.dispose).toHaveBeenCalledOnce()
    expect(provider.clientCache.size).toBe(0)
  })

  it('isolates signer state between separate login attempts', async () => {
    const signerFactory = vi.fn(() => ({ signRequest: vi.fn(), dispose: vi.fn() }))
    const factory = () => ({ execute: async () => response(qr()) })
    const first = create({ deviceStore: { get: () => registered, save: () => {} }, signerFactory, clientFactory: factory })
    const second = create({ deviceStore: { get: () => registered, save: () => {} }, signerFactory, clientFactory: factory })
    await first.prepare(); await second.prepare(); await first.createQR(); await second.createQR()
    expect(signerFactory).toHaveBeenCalledTimes(2)
    expect(first.signer).not.toBe(second.signer)
    first.dispose()
    expect(second.signer.dispose).not.toHaveBeenCalled()
    expect(second.token).toBe('fixture-qr')
  })

  it('aborts pending transport and refuses late QR cookies, tokens and future requests after dispose', async () => {
    let resolve, requestSignal
    const execute = vi.fn((_pathname, options) => {
      requestSignal = options.signal
      return new Promise(done => { resolve = done })
    })
    const provider = create({ deviceStore: { get: () => registered, save: () => {} }, clientFactory: () => ({ execute }) })
    await provider.prepare()
    const pending = provider.createQR()
    provider.dispose()
    expect(requestSignal.aborted).toBe(true)
    resolve(response(qr(), { 'set-cookie': ['passport_csrf_token=late-cookie; Path=/; Secure'], 'x-tt-token': 'late-token' }))
    await expect(pending).rejects.toMatchObject({ code: 'LOGIN_CANCELED' })
    expect(provider.jar.getCookieStringSync(AUTH_ORIGIN)).toBe('')
    expect(provider.authHeaders).toEqual({}); expect(provider.profile).toBe(null); expect(provider.token).toBe('')
    await expect(provider.prepare()).rejects.toMatchObject({ code: 'LOGIN_CANCELED' })
    await expect(provider.createQR()).rejects.toMatchObject({ code: 'LOGIN_CANCELED' })
    await expect(provider.poll()).rejects.toMatchObject({ code: 'LOGIN_CANCELED' })
    expect(execute).toHaveBeenCalledOnce()
  })

  it('does not save server IDs or response credentials after the caller cancels registration', async () => {
    let resolve, requestSignal
    const save = vi.fn()
    const provider = create({ deviceStore: { get: () => null, save }, clientFactory: () => ({ execute: async (_path, options) => {
      requestSignal = options.signal
      return new Promise(done => { resolve = done })
    } }) })
    const controller = new AbortController()
    const pending = provider.prepare(controller.signal)
    controller.abort()
    expect(requestSignal.aborted).toBe(true)
    resolve(response({ device_id_str: ids.device_id, install_id_str: ids.iid }, { 'x-tt-token': 'late-token' }))
    await expect(pending).rejects.toMatchObject({ code: 'LOGIN_CANCELED' })
    expect(save).not.toHaveBeenCalled(); expect(provider.authHeaders).toEqual({})
    expect(provider.profile.deviceInfo.device_id).toBeUndefined()
  })

  it('clears a previous QR token when a replacement response is expired', async () => {
    const execute = vi.fn().mockResolvedValueOnce(response(qr('previous'))).mockResolvedValueOnce(response(qr('expired', -1)))
    const provider = create({ deviceStore: { get: () => registered, save: () => {} }, clientFactory: () => ({ execute }) })
    await provider.prepare(); await provider.createQR()
    expect(provider.token).toBe('previous')
    await expect(provider.createQR()).rejects.toMatchObject({ code: 'LOGIN_QR_EXPIRED' })
    expect(provider.token).toBe('')
    await expect(provider.poll()).rejects.toMatchObject({ code: 'LOGIN_QR_EXPIRED' })
    expect(execute).toHaveBeenCalledTimes(2)
  })
})
