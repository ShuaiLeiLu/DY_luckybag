import { describe, it, expect, vi } from 'vitest'
const { EventEmitter } = require('events')
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
        headers: { ...ctx.headers, 'x-ladon': 'test_ladon_header' }
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
      pathname: '/webcast/lottery/melon/'
    }))
  })
})
