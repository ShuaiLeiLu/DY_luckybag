import { describe, it, expect } from 'vitest'
const { EventEmitter } = require('events')
const { Readable, Writable } = require('stream')
const { AndroidBridgeClient } = require('./android-bridge-client')
const { ERROR_CODES } = require('./douyin-request-models')

function createMockTransport(handler) {
  return {
    request(targetUrl, options, callback) {
      const req = new Writable({
        write(chunk, encoding, next) {
          req.body = (req.body || '') + chunk.toString()
          next()
        }
      })
      req.headers = options.headers
      req.method = options.method
      req.url = targetUrl.pathname

      // simulate async response when req.end() is called
      const originalEnd = req.end.bind(req)
      req.end = (chunk) => {
        if (chunk) {
          req.body = (req.body || '') + chunk.toString()
        }
        originalEnd()
        process.nextTick(() => {
          handler(req, (resOptions, resBody) => {
            if (resOptions instanceof Error) {
              req.emit('error', resOptions)
              return
            }
            const res = new Readable({
              read() {
                this.push(resBody)
                this.push(null)
              }
            })
            res.statusCode = resOptions.statusCode || 200
            res.headers = resOptions.headers || {}
            callback(res)
          })
        })
      }
      return req
    }
  }
}

describe('AndroidBridgeClient', () => {
  it('validates URL correctly', () => {
    expect(() => new AndroidBridgeClient({ serverUrl: 'ftp://bad' })).toThrow()
    const client = new AndroidBridgeClient({ serverUrl: 'http://127.0.0.1:8765' })
    expect(client.serverUrl).toBe('http://127.0.0.1:8765')
  })

  it('queries health and capabilities successfully', async () => {
    const mockTransport = createMockTransport((req, respond) => {
      if (req.url === '/health') {
        respond({ statusCode: 200 }, JSON.stringify({ status: 'ok', uptime: 100 }))
      } else if (req.url === '/capabilities') {
        respond({ statusCode: 200 }, JSON.stringify({
          available: true,
          authenticated: true,
          ticketGuardReady: true,
          accountId: 'android-acc-1',
          capabilities: ['lottery-info', 'lottery-attend']
        }))
      }
    })

    const client = new AndroidBridgeClient({
      serverUrl: 'http://127.0.0.1:8765',
      transport: mockTransport
    })

    const health = await client.getHealth()
    expect(health.status).toBe('ok')

    const caps = await client.getCapabilities()
    expect(caps.available).toBe(true)
    expect(caps.ticketGuardReady).toBe(true)
  })

  it('fetches lottery info from android companion service', async () => {
    const mockTransport = createMockTransport((req, respond) => {
      if (req.url === '/douyin/lottery-info') {
        const payload = JSON.parse(req.body)
        respond({ statusCode: 200 }, JSON.stringify({
          success: true,
          lotteryId: 'android_lottery_123',
          roomId: payload.roomId,
          anchorId: 'anchor_456',
          candidateCount: 88,
          luckyCount: 2,
          prizeCount: 5,
          prizeName: 'Android奖品',
          drawTime: 1720000000
        }))
      }
    })

    const client = new AndroidBridgeClient({
      serverUrl: 'http://127.0.0.1:8765',
      transport: mockTransport
    })

    const info = await client.getLotteryInfo({ roomId: 'test_room' })
    expect(info.success).toBe(true)
    expect(info.lotteryId).toBe('android_lottery_123')
    expect(info.prizeName).toBe('Android奖品')
  })

  it('submits lottery attend to android companion service', async () => {
    const mockTransport = createMockTransport((req, respond) => {
      if (req.url === '/douyin/lottery-attend') {
        respond({ statusCode: 200 }, JSON.stringify({
          data: { status: 0 },
          status_code: 0
        }))
      }
    })

    const client = new AndroidBridgeClient({
      serverUrl: 'http://127.0.0.1:8765',
      transport: mockTransport
    })

    const res = await client.attendLottery({ roomId: 'test_room', lotteryId: 'android_lottery_123' })
    expect(res.status_code).toBe(0)
    expect(res.data.status).toBe(0)
  })

  it('handles connection refused cleanly', async () => {
    const mockTransport = createMockTransport((req, respond) => {
      const err = new Error('connect ECONNREFUSED 127.0.0.1:8765')
      err.code = 'ECONNREFUSED'
      respond(err)
    })

    const client = new AndroidBridgeClient({
      serverUrl: 'http://127.0.0.1:8765',
      transport: mockTransport
    })

    await expect(client.getHealth()).rejects.toThrow('无法连接到 Android 服务')
  })
})
