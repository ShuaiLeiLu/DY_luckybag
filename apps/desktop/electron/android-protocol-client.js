/**
 * Android 原生协议网络客户端
 * 负责组装 Android 设备参数、请求头，并经由 AndroidSignatureProvider 注入签名后发送原生 HTTP 请求
 */

const http = require('http')
const https = require('https')
const querystring = require('querystring')
const { URL } = require('url')
const { AndroidSignatureProvider } = require('./android-signature-provider')
const { ERROR_CODES, DouyinBackendError } = require('./douyin-request-models')

const DEFAULT_ANDROID_DEVICE = Object.freeze({
  aid: 1128,
  app_name: 'aweme',
  version_code: 300800,
  version_name: '30.8.0',
  device_platform: 'android',
  os_version: '12',
  os_api: 31,
  channel: 'douyin_webcast',
  device_type: 'Pixel 6',
  device_brand: 'Google',
  language: 'zh',
  app_type: 'normal',
  manifest_version_code: 300800,
  update_version_code: 300800
})

const DEFAULT_ANDROID_USER_AGENT =
  'com.ss.android.ugc.aweme/300800 (Linux; U; Android 12; zh_CN; Pixel 6; Build/SQ3A.220705.004; Cronet/TTNetVersion:5f939e60 2024-03-01 QuicVersion:42b109e4 2024-03-01)'

class AndroidProtocolClient {
  constructor({
    baseUrl = 'https://webcast.amemv.com',
    signer = null,
    deviceInfo = {},
    userAgent = DEFAULT_ANDROID_USER_AGENT,
    timeoutMs = 10000,
    transport = null,
    logger
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.signer = signer || new AndroidSignatureProvider()
    this.deviceInfo = { ...DEFAULT_ANDROID_DEVICE, ...(deviceInfo || {}) }
    this.userAgent = userAgent
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || 10000)
    this.transport = transport
    this.logger = logger || console
  }

  getSigner() {
    return this.signer
  }

  setSigner(signer) {
    if (signer) {
      this.signer = signer
    }
  }

  /**
   * 发送 Android 原生请求核心方法
   */
  async execute(pathname, {
    method = 'GET',
    params = {},
    headers = {},
    body = null,
    isForm = true
  } = {}) {
    const cleanPath = pathname.startsWith('/') ? pathname : `/${pathname}`

    // 1. 合并 Android 设备基础参数与业务参数
    const mergedParams = {
      ...this.deviceInfo,
      ...(params || {})
    }

    // 2. 构造基础 URL 与 Query
    let targetUrlString
    let requestBody = null
    const requestHeaders = {
      'User-Agent': this.userAgent,
      'Accept': 'application/json',
      'sdk-version': '2',
      ...(headers || {})
    }

    if (method.toUpperCase() === 'GET') {
      const qs = querystring.stringify(mergedParams)
      targetUrlString = `${this.baseUrl}${cleanPath}${qs ? `?${qs}` : ''}`
    } else {
      // POST 请求：Query 挂设备公共参数，Body 挂业务表单或 payload
      const qs = querystring.stringify(this.deviceInfo)
      targetUrlString = `${this.baseUrl}${cleanPath}${qs ? `?${qs}` : ''}`

      if (body) {
        requestBody = typeof body === 'string' ? body : Buffer.from(body)
      } else if (isForm) {
        const formString = querystring.stringify(params)
        requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'
        requestBody = Buffer.from(formString, 'utf8')
      }
    }

    // 3. 调用 AndroidSignatureProvider 进行请求签名（用户自定义代码处）
    const signContext = {
      method: method.toUpperCase(),
      url: targetUrlString,
      pathname: cleanPath,
      params: mergedParams,
      headers: requestHeaders,
      body: requestBody,
      deviceInfo: this.deviceInfo
    }

    const signed = await this.signer.signRequest(signContext)
    const finalHeaders = { ...requestHeaders, ...(signed?.headers || {}) }

    if (signed?.body) {
      requestBody = typeof signed.body === 'string' ? Buffer.from(signed.body, 'utf8') : signed.body
    }
    if (requestBody && !finalHeaders['Content-Length']) {
      finalHeaders['Content-Length'] = Buffer.byteLength(requestBody)
    }

    // 4. 发送 HTTP 请求
    const targetUrl = new URL(targetUrlString)
    const isHttps = targetUrl.protocol === 'https:'
    const transport = this.transport || (isHttps ? https : http)

    return new Promise((resolve, reject) => {
      const req = transport.request(targetUrl, {
        method: method.toUpperCase(),
        headers: finalHeaders,
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
            return reject(new DouyinBackendError(`Android 接口返回非 JSON 数据 (${res.statusCode})`, {
              code: ERROR_CODES.NETWORK_ERROR,
              statusCode: res.statusCode,
              details: rawData
            }))
          }

          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 400)) {
            const errCode = res.statusCode === 403
              ? ERROR_CODES.RATE_LIMITED_OR_RISK
              : (res.statusCode === 401 ? ERROR_CODES.AUTHENTICATION_REQUIRED : ERROR_CODES.BUSINESS_ERROR)
            return reject(new DouyinBackendError(`Android 接口 HTTP 错误 (${res.statusCode})`, {
              code: errCode,
              statusCode: res.statusCode,
              details: json
            }))
          }

          resolve(json)
        })
      })

      req.on('timeout', () => {
        req.destroy()
        reject(new DouyinBackendError(`Android 接口请求超时 (${this.timeoutMs}ms)`, {
          code: ERROR_CODES.NETWORK_ERROR,
          retryable: true
        }))
      })

      req.on('error', (err) => {
        reject(new DouyinBackendError(`Android 接口网络错误: ${err.message}`, {
          code: ERROR_CODES.NETWORK_ERROR,
          retryable: true
        }))
      })

      if (requestBody) {
        req.write(requestBody)
      }
      req.end()
    })
  }

  async get(pathname, params = {}, headers = {}) {
    return this.execute(pathname, { method: 'GET', params, headers })
  }

  async post(pathname, params = {}, headers = {}) {
    return this.execute(pathname, { method: 'POST', params, headers, isForm: true })
  }
}

module.exports = {
  AndroidProtocolClient,
  DEFAULT_ANDROID_DEVICE,
  DEFAULT_ANDROID_USER_AGENT
}
