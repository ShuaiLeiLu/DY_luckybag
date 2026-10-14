/**
 * Android Companion Service Bridge Client
 * 负责桌面 Electron 与 Android 原生服务之间的受限 HTTP 通信
 */

const http = require('http')
const https = require('https')
const { URL } = require('url')
const { ERROR_CODES, DouyinBackendError } = require('./douyin-request-models')

class AndroidBridgeClient {
  constructor({
    serverUrl = 'http://127.0.0.1:8765',
    token = '',
    timeoutMs = 10000,
    transport = null,
    logger
  } = {}) {
    this.serverUrl = this._validateAndNormalizeUrl(serverUrl)
    this.token = String(token || '').trim()
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || 10000)
    this.transport = transport
    this.logger = logger || console
  }

  _validateAndNormalizeUrl(rawUrl) {
    const trimmed = String(rawUrl || '').trim()
    if (!trimmed) {
      return 'http://127.0.0.1:8765'
    }
    let parsed
    try {
      parsed = new URL(trimmed)
    } catch (_) {
      throw new DouyinBackendError(`非法的 Android 服务地址: ${trimmed}`, {
        code: ERROR_CODES.INVALID_PARAMS
      })
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new DouyinBackendError(`Android 服务地址仅支持 http/https 协议: ${trimmed}`, {
        code: ERROR_CODES.INVALID_PARAMS
      })
    }
    return parsed.origin
  }

  updateConfig({ serverUrl, token, timeoutMs } = {}) {
    if (serverUrl !== undefined) {
      this.serverUrl = this._validateAndNormalizeUrl(serverUrl)
    }
    if (token !== undefined) {
      this.token = String(token || '').trim()
    }
    if (timeoutMs !== undefined) {
      this.timeoutMs = Math.max(1000, Number(timeoutMs) || 10000)
    }
  }

  /**
   * 安全 HTTP 请求核心方法
   */
  async _request(pathname, { method = 'GET', body = null } = {}) {
    const targetUrl = new URL(pathname, this.serverUrl)
    const isHttps = targetUrl.protocol === 'https:'
    const transport = this.transport || (isHttps ? https : http)

    const headers = {
      'Accept': 'application/json'
    }

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }

    let payloadString = null
    if (body && (method === 'POST' || method === 'PUT')) {
      payloadString = JSON.stringify(body)
      headers['Content-Type'] = 'application/json; charset=utf-8'
      headers['Content-Length'] = Buffer.byteLength(payloadString)
    }

    return new Promise((resolve, reject) => {
      const req = transport.request(targetUrl, {
        method,
        headers,
        timeout: this.timeoutMs
      }, (res) => {
        let rawData = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          rawData += chunk
        })
        res.on('end', () => {
          let json = null
          try {
            json = rawData ? JSON.parse(rawData) : {}
          } catch (_) {
            return reject(new DouyinBackendError(`Android 服务响应非 JSON 内容 (${res.statusCode})`, {
              code: ERROR_CODES.NETWORK_ERROR,
              statusCode: res.statusCode
            }))
          }

          if (res.statusCode === 401 || res.statusCode === 403) {
            return reject(new DouyinBackendError(json?.error || 'Android 服务鉴权失败', {
              code: ERROR_CODES.AUTHENTICATION_REQUIRED,
              statusCode: res.statusCode
            }))
          }

          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            return reject(new DouyinBackendError(json?.error || `Android 服务请求错误 (${res.statusCode})`, {
              code: ERROR_CODES.SERVICE_UNAVAILABLE,
              statusCode: res.statusCode,
              details: json
            }))
          }

          resolve(json)
        })
      })

      req.on('timeout', () => {
        req.destroy()
        reject(new DouyinBackendError(`请求 Android 服务超时 (${this.timeoutMs}ms)`, {
          code: ERROR_CODES.NETWORK_ERROR,
          retryable: true
        }))
      })

      req.on('error', (err) => {
        const isConnRefused = err.code === 'ECONNREFUSED' || err.code === 'EPERM'
        const msg = isConnRefused
          ? `无法连接到 Android 服务 (${targetUrl.host})`
          : `Android 服务网络错误: ${err.message}`
        reject(new DouyinBackendError(msg, {
          code: isConnRefused ? ERROR_CODES.SERVICE_UNAVAILABLE : ERROR_CODES.NETWORK_ERROR,
          retryable: true
        }))
      })

      if (payloadString) {
        req.write(payloadString)
      }
      req.end()
    })
  }

  async getHealth() {
    return this._request('/health', { method: 'GET' })
  }

  async getCapabilities() {
    return this._request('/capabilities', { method: 'GET' })
  }

  async getLotteryInfo({ roomId, liveId = 1, enterFrom = 'link_share', queryFrom = 1 }) {
    if (!roomId) {
      throw new DouyinBackendError('roomId 不能为空', { code: ERROR_CODES.INVALID_PARAMS })
    }
    return this._request('/douyin/lottery-info', {
      method: 'POST',
      body: { roomId, liveId, enterFrom, queryFrom }
    })
  }

  async attendLottery({ roomId, lotteryId }) {
    if (!roomId || !lotteryId) {
      throw new DouyinBackendError('roomId 和 lotteryId 不能为空', { code: ERROR_CODES.INVALID_PARAMS })
    }
    return this._request('/douyin/lottery-attend', {
      method: 'POST',
      body: { roomId, lotteryId }
    })
  }
}

module.exports = {
  AndroidBridgeClient
}
