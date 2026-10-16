import { describe, it, expect, vi } from 'vitest'
const { EventEmitter } = require('events')
const { createHash } = require('node:crypto')
const { AndroidProtocolClient } = require('./android-protocol-client')

describe('AndroidProtocolClient', () => {
  const createMockTransport = (responseBody, statusCode = 200) => {
    return {
      request: vi.fn((url, options, callback) => {
        const req = new EventEmitter()
        req.write = vi.fn()
        req.end = vi.fn(() => {
          process.nextTick(() => {
            const res = new EventEmitter()
            res.statusCode = statusCode
            res.setEncoding = vi.fn()
            callback(res)
            res.emit('data', JSON.stringify(responseBody))
            res.emit('end')
          })
        })
        return req
      })
    }
  }

  it('performs GET request with Android device parameters merged and signs the request', async () => {
    const mockTransport = createMockTransport({ status_code: 0, data: { test: true } })
    const mockSigner = {
      signRequest: vi.fn().mockImplementation(async (ctx) => ({
        headers: { ...ctx.headers, 'x-argus': 'test_argus_header' }
      }))
    }

    const client = new AndroidProtocolClient({
      transport: mockTransport,
      signer: mockSigner,
      deviceInfo: { aid: 1128, custom_device: 'test' }
    })

    const res = await client.get('/webcast/feed/', { channel_id: 21 })
    expect(res).toEqual({ status_code: 0, data: { test: true } })

    expect(mockSigner.signRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: 'GET',
      pathname: '/webcast/feed/',
      params: expect.objectContaining({ aid: 1128, channel_id: 21 })
    }))

    expect(mockTransport.request).toHaveBeenCalled()
    const callArgs = mockTransport.request.mock.calls[0]
    const targetUrl = callArgs[0]
    const reqOptions = callArgs[1]

    expect(targetUrl.pathname).toBe('/webcast/feed/')
    expect(targetUrl.searchParams.get('aid')).toBe('1128')
    expect(targetUrl.searchParams.get('channel_id')).toBe('21')
    expect(reqOptions.headers['x-argus']).toBe('test_argus_header')
    expect(reqOptions.headers['User-Agent']).toContain('aweme')
  })

  it('performs POST request with form-encoded body and signs the request', async () => {
    const mockTransport = createMockTransport({ status_code: 0, data: { success: true } })
    const mockSigner = {
      signRequest: vi.fn().mockImplementation(async (ctx) => ({
        headers: { ...ctx.headers, 'x-argus': 'test-argus' }
      }))
    }

    const client = new AndroidProtocolClient({
      transport: mockTransport,
      signer: mockSigner
    })

    const res = await client.post('/webcast/lottery/melon/', { room_id: '12345', lottery_id: '67890' })
    expect(res).toEqual({ status_code: 0, data: { success: true } })

    expect(mockSigner.signRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      pathname: '/webcast/lottery/melon/',
      query: expect.any(String),
      body: expect.any(Buffer)
    }))
    const context = mockSigner.signRequest.mock.calls[0][0]
    const actual = mockTransport.request.mock.calls[0][0]
    expect(context.params.room_id).toBeUndefined()
    expect(context.query).toBe(actual.search.slice(1))
    expect(context.body.toString()).toBe('room_id=12345&lottery_id=67890')
  })

  it('signs the exact URL and binary body digest before transmission, using the same ticket and content length', async () => {
    const transport = createMockTransport({ status_code: 0 })
    const signer = { signRequest: vi.fn(async ctx => ({ headers: { 'X-Argus': 'fixture-only' }, body: ctx.body })) }
    const body = Buffer.from([0xff, 0x80, 0x00, 0xc3, 0x28])
    const client = new AndroidProtocolClient({ transport, signer, deviceInfo: { label: '空 格&+', repeated: ['b', 'a'] } })
    await client.execute('/service/2/device_register/', { method: 'POST', body, isForm: false,
      headers: { 'Content-Type': 'application/octet-stream', 'X-SS-STUB': 'stale', 'content-length': '999', 'X-Argus': 'stale' } })
    const context = signer.signRequest.mock.calls[0][0]
    const [url, { headers }] = transport.request.mock.calls[0]
    const wireBody = transport.request.mock.results[0].value.write.mock.calls[0][0]
    expect(context.url).toBe(url.href)
    expect(context.query).toBe(url.search.slice(1))
    expect(context.query).toContain('label=%E7%A9%BA%20%E6%A0%BC%26%2B&repeated=b&repeated=a')
    expect(context.headers['x-ss-stub']).toBe(createHash('md5').update(body).digest('hex').toUpperCase())
    expect(context.headers['Content-Length']).toBe('5')
    expect(context.headers['x-ss-req-ticket']).toBe(String(context.timestampMs))
    expect(context.headers['X-Argus']).toBeUndefined()
    expect(wireBody).toEqual(body)
    for (const name of ['x-ss-stub', 'Content-Length', 'x-ss-req-ticket']) expect(headers[name]).toBe(context.headers[name])
    expect(Object.keys(headers).filter(k => k.toLowerCase() === 'x-ss-stub')).toEqual(['x-ss-stub'])
  })

  it.each([
    ['returned body', ctx => ({ body: Buffer.from('different') })],
    ['mutated buffer', ctx => { ctx.body[0] ^= 1; return {} }],
    ['changed URL', () => ({ url: 'https://aweme.snssdk.com/another/' })],
    ['changed digest', () => ({ headers: { 'X-SS-STUB': 'different' } })],
    ['changed ticket', () => ({ headers: { 'X-SS-REQ-TICKET': '1' } })],
    ['changed cookie', () => ({ headers: { cookie: 'different' } })]
  ])('does not transmit when a signer changes the %s', async (_name, change) => {
    const transport = createMockTransport({ status_code: 0 })
    const signer = { signRequest: async ctx => ({ headers: { 'x-argus': 'fixture-only' }, ...change(ctx) }) }
    const client = new AndroidProtocolClient({ transport, signer })
    await expect(client.execute('/aweme/v1/user/profile/self/', { method: 'POST', body: 'original',
      headers: { Cookie: 'fixture-cookie' } })).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    expect(transport.request).not.toHaveBeenCalled()
  })

  it('distinguishes an absent body from an explicitly empty byte body', async () => {
    const transport = createMockTransport({ status_code: 0 })
    const signer = { signRequest: vi.fn(async () => ({ headers: { 'x-argus': 'fixture-only' } })) }
    const client = new AndroidProtocolClient({ transport, signer })
    await client.get('/webcast/feed/', {}, { 'X-SS-STUB': 'stale' })
    expect(signer.signRequest.mock.calls[0][0].headers['x-ss-stub']).toBeUndefined()
    await client.execute('/service/2/device_register/', { method: 'POST', body: Buffer.alloc(0) })
    expect(signer.signRequest.mock.calls[1][0].headers['x-ss-stub']).toBe('D41D8CD98F00B204E9800998ECF8427E')
  })

  it('does not accept stale body metadata returned by a signer for a bodyless request', async () => {
    const transport = createMockTransport({ status_code: 0 })
    const signer = { signRequest: async () => ({ headers: { 'x-argus': 'fixture-only', 'X-SS-STUB': 'stale' } }) }
    await expect(new AndroidProtocolClient({ transport, signer }).get('/webcast/feed/')).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    expect(transport.request).not.toHaveBeenCalled()
  })

  it('feeds the exact response back to the stateful signer before business validation', async () => {
    const transport = createMockTransport({ status_code: 1049, data: { error: true } })
    const signer = {
      signRequest: vi.fn(async () => ({ headers: { 'x-argus': 'fixture-only' } })),
      consumeResponse: vi.fn(async () => {})
    }
    await expect(new AndroidProtocolClient({ transport, signer }).get('/webcast/feed/')).rejects.toThrow()
    expect(signer.consumeResponse).toHaveBeenCalledOnce()
    expect(signer.consumeResponse.mock.calls[0][0]).toMatchObject({ statusCode: 200, body: { status_code: 1049 } })
  })
})
