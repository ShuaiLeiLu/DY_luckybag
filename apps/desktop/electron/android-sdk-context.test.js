import { describe, expect, it, vi } from 'vitest'

const { AndroidSdkContext } = require('./android-sdk-context')
const { AndroidSignatureProvider } = require('./android-signature-provider')

const profile = { userAgent: 'aweme-test', deviceInfo: { aid: '1128', device_id: '1', iid: '2' } }

describe('AndroidSdkContext', () => {
  it('initializes once and retains request/response state across profile updates', async () => {
    const calls = []
    const adapter = {
      initialize: vi.fn(),
      setProfile: vi.fn(),
      signRequest: vi.fn(async request => {
        calls.push(request)
        return { headers: { 'x-argus': `sdk-${request.sdkContext.sequence}` } }
      }),
      consumeResponse: vi.fn(() => ({ cache: { ticket: 'cached' } }))
    }
    const context = new AndroidSdkContext({ adapter, now: () => 1700000000000, requestId: () => 'attempt-1' })
    context.setProfile(profile)
    await context.signRequest({ pathname: '/passport/mobile/get_qrcode/', params: { aid: '1128' }, headers: {} })
    context.setProfile({ ...profile, deviceInfo: { ...profile.deviceInfo, device_id: '3' } })
    await context.signRequest({ pathname: '/passport/mobile/check_qrconnect/', params: { aid: '1128' }, headers: {} })
    await context.consumeResponse({ statusCode: 200, headers: { 'x-bd-lanusk': 'ticket' }, body: { ok: true } })

    expect(adapter.initialize).toHaveBeenCalledOnce()
    expect(adapter.setProfile).toHaveBeenCalledTimes(2)
    expect(calls.map(item => item.sdkContext.sequence)).toEqual([1, 2])
    expect(calls[1].deviceInfo.device_id).toBe('3')
    expect(adapter.consumeResponse).toHaveBeenCalledOnce()
    expect(context.snapshot()).toMatchObject({ requestId: 'attempt-1', initialized: true, sequence: 2, responses: 1, cacheKeys: ['ticket'] })
  })

  it('fails closed when an adapter returns no security header', async () => {
    const context = new AndroidSdkContext({ adapter: { signRequest: async () => ({ headers: {} }) } })
    context.setProfile(profile)
    await expect(context.signRequest({ pathname: '/webcast/feed/', headers: {} })).rejects.toMatchObject({
      code: 'ANDROID_TICKET_GUARD_UNAVAILABLE'
    })
  })

  it('requires an actual sample verifier in the production mode', async () => {
    const context = new AndroidSdkContext({
      requireVerified: true,
      adapter: { verified: true, initialize: vi.fn(), signRequest: async () => ({ headers: { 'x-argus': 'native' } }) }
    })
    context.setProfile(profile)
    await expect(context.signRequest({ pathname: '/webcast/feed/', headers: {} })).rejects.toMatchObject({ code: 'ANDROID_SDK_UNAVAILABLE' })
  })
})

describe('AndroidSignatureProvider SDK adapter', () => {
  it('uses the same SDK context for signing and response consumption', async () => {
    const adapter = { signRequest: vi.fn(async () => ({ headers: { 'x-argus': 'native' } })), consumeResponse: vi.fn() }
    const provider = new AndroidSignatureProvider({ sdkAdapter: adapter })
    provider.setProfile(profile)
    await provider.signRequest({ pathname: '/passport/mobile/check_qrconnect/', headers: {} })
    await provider.consumeResponse({ statusCode: 200, headers: {}, body: {} })
    expect(adapter.signRequest).toHaveBeenCalledOnce()
    expect(adapter.consumeResponse).toHaveBeenCalledOnce()
    expect(provider.getStatus()).toMatchObject({ implementation: 'android-sdk-adapter', sequence: 1, responses: 1 })
  })
})
