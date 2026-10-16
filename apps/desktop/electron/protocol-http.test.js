import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
const { AndroidProtocolClient } = require('./android-protocol-client')
function fake({ status = 200, raw = '{"status_code":0}', aborted = false, hang = false } = {}) {
  return { request: vi.fn((_url, _options, callback) => {
    const req = new EventEmitter()
    req.destroy = vi.fn()
    req.write = vi.fn()
    req.end = () => { if (hang) return; queueMicrotask(() => {
      const res = new EventEmitter(); res.statusCode = status; callback(res)
      if (aborted) res.emit('aborted')
      else { res.emit('data', raw); res.emit('end') }
    }) }
    return req
  }) }
}
describe('native transport failure boundaries', () => {
  it.each([403, 429, 444])('classifies HTTP %i even when the response body is not JSON', async status => {
    const client = new AndroidProtocolClient({ transport: fake({ status, raw: '<html>verify</html>' }) })
    await expect(client.get('/webcast/feed/')).rejects.toMatchObject({ code: 'RATE_LIMITED_OR_RISK', statusCode: status, retryable: false })
  })
  it('preserves authentication business codes without exposing upstream text', async () => {
    const client = new AndroidProtocolClient({ transport: fake({ raw: '{"status_code":8,"status_msg":"sensitive-upstream"}' }) })
    await expect(client.get('/webcast/feed/')).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED', businessCode: 8 })
    try { await client.get('/webcast/feed/') } catch (error) { expect(JSON.stringify(error)).not.toContain('sensitive-upstream') }
  })
  it('rejects invalid JSON and oversized responses', async () => {
    await expect(new AndroidProtocolClient({ transport: fake({ raw: '<html/>' }) }).get('/webcast/feed/')).rejects.toMatchObject({ code: 'NON_JSON_RESPONSE' })
    await expect(new AndroidProtocolClient({ transport: fake(), maxResponseBytes: 1 }).get('/webcast/feed/')).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
  })
  it('ends aborted responses and enforces a total request deadline', async () => {
    await expect(new AndroidProtocolClient({ transport: fake({ aborted: true }) }).get('/webcast/feed/')).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    await expect(new AndroidProtocolClient({ transport: fake({ hang: true }), timeoutMs: 100 }).get('/webcast/feed/')).rejects.toMatchObject({ code: 'NETWORK_ERROR', retryable: true })
  })
  it('does not send an incomplete signature or a signer-mutated query', async () => {
    const transport = fake()
    await expect(new AndroidProtocolClient({ transport, signer: { signRequest: async () => ({ headers: {} }) } }).get('/webcast/feed/')).rejects.toMatchObject({ code: 'ANDROID_TICKET_GUARD_UNAVAILABLE' })
    await expect(new AndroidProtocolClient({ transport, signer: { signRequest: async () => ({ params: { injected: 1 } }) } }).get('/webcast/feed/')).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    expect(transport.request).not.toHaveBeenCalled()
  })
  it('cancels in-flight login HTTP and aborts before signing if already canceled', async () => {
    const transport = fake({ hang: true })
    const client = new AndroidProtocolClient({ transport })
    const controller = new AbortController()
    const request = client.execute('/passport/mobile/check_qrconnect/', { responseMode: 'passport', signal: controller.signal })
    await Promise.resolve(); controller.abort()
    await expect(request).rejects.toMatchObject({ code: 'LOGIN_CANCELED' })
    expect(transport.request.mock.results[0].value.destroy).toHaveBeenCalledOnce()
    const signer = { signRequest: vi.fn() }
    await expect(new AndroidProtocolClient({ signer }).execute('/passport/mobile/get_qrcode/', { signal: controller.signal })).rejects.toThrow()
    expect(signer.signRequest).not.toHaveBeenCalled()
  })
  it('does not weaken the business success gate when adding Passport response support', async () => {
    const client = new AndroidProtocolClient({ transport: fake({ raw: '{"message":"success","data":{"status":"confirmed"}}' }) })
    await expect(client.get('/webcast/feed/')).rejects.toThrow()
    await expect(client.execute('/webcast/feed/', { responseMode: 'passport' })).rejects.toThrow()
    expect((await client.execute('/passport/mobile/check_qrconnect/', { responseMode: 'passport', includeResponse: true })).json.message).toBe('success')
  })
})
