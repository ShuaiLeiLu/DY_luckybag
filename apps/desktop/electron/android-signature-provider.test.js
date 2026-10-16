import { describe, it, expect, vi } from 'vitest'
const { AndroidSignatureProvider } = require('./android-signature-provider')

describe('AndroidSignatureProvider', () => {
  it('produces experimental x-argus plus a millisecond transport ticket, without hybrid bridge headers', async () => {
    const provider = new AndroidSignatureProvider()
    const context = {
      method: 'GET',
      url: 'https://webcast.amemv.com/webcast/feed/',
      pathname: '/webcast/feed/',
      params: { aid: 1128 },
      headers: { 'Accept': 'application/json' },
      body: null,
      deviceInfo: { aid: 1128 }
    }

    const signed = await provider.signRequest(context)
    expect(typeof signed.headers['x-argus']).toBe('string')
    expect(signed.headers['x-argus']).toHaveLength(64)
    expect(signed.headers['x-security-argus']).toBeUndefined()
    expect(typeof signed.headers['x-ss-req-ticket']).toBe('string')
    expect(signed.headers['x-ss-req-ticket']).toMatch(/^\d{13}$/)
  })

  it('invokes custom signer hook and uses its returned headers', async () => {
    const customHook = vi.fn().mockImplementation(async (ctx) => {
      return {
        headers: {
          ...ctx.headers,
          'x-argus': 'custom_argus_token_value',
          'x-ladon': 'custom_ladon_token_value',
          'x-gorgon': 'custom_gorgon_value',
          'x-khronos': '1720000000'
        }
      }
    })

    const provider = new AndroidSignatureProvider({ signerHook: customHook })
    const context = {
      method: 'POST',
      url: 'https://webcast.amemv.com/webcast/lottery/melon/',
      pathname: '/webcast/lottery/melon/',
      params: { room_id: '123' },
      headers: { 'User-Agent': 'aweme' }
    }

    const signed = await provider.signRequest(context)
    expect(customHook).toHaveBeenCalledWith(context)
    expect(signed.headers['x-argus']).toBe('custom_argus_token_value')
    expect(signed.headers['x-ladon']).toBe('custom_ladon_token_value')
    expect(signed.headers['x-gorgon']).toBe('custom_gorgon_value')
  })

  it('supports dynamically updating signer hook via setSignerHook', async () => {
    const provider = new AndroidSignatureProvider()
    const hook = vi.fn().mockResolvedValue({
      headers: { 'x-argus': 'dynamic_argus' }
    })

    provider.setSignerHook(hook)
    const signed = await provider.signRequest({ headers: {} })
    expect(hook).toHaveBeenCalled()
    expect(signed.headers['x-argus']).toBe('dynamic_argus')
  })

  it.each([null, undefined, {}, { headers: {} }, { headers: [] }])('does not hide an invalid custom adapter result behind candidate AES', async value => {
    const provider = new AndroidSignatureProvider({ signerHook: async () => value })
    await expect(provider.signRequest({ headers: {} })).rejects.toMatchObject({ code: 'ANDROID_TICKET_GUARD_UNAVAILABLE' })
  })

  it('uses the request ticket that was supplied to signing, without reading a new clock value', async () => {
    const provider = new AndroidSignatureProvider()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1700000010999)
    try {
      const signed = await provider.signRequest({ timestampMs: 1700000000123, params: { aid: 1128 } })
      expect(signed.headers['x-ss-req-ticket']).toBe('1700000000123')
      expect(clock).not.toHaveBeenCalled()
    } finally { clock.mockRestore() }
  })
})
