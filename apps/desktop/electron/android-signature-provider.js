/**
 * Android 协议签名提供者接口与基础实现
 *
 * 【签名代码扩展入口】
 * 用户可在此处实现自己的 Android 签名算法（如 x-argus、x-ladon、x-gorgon、x-khronos、x-ss-stub、TicketGuard 等），
 * 或者在此调用本地/远程的 Android 签名服务（RPC / Unidbg / Frida / 签名服务器）。
 */

const { signAndroidHeaders } = require('./android-sign-algorithms')

class AndroidSignatureProvider {
  constructor(options = {}) {
    this.options = options
    // 支持动态注入自定义签名 hook 函数
    this.customSignerHook = typeof options.signerHook === 'function' ? options.signerHook : null
  }

  /**
   * 注册/更新自定义签名处理函数
   * @param {Function} hook
   */
  setSignerHook(hook) {
    if (typeof hook === 'function') {
      this.customSignerHook = hook
    }
  }

  /**
   * 对即将发送的 Android 原生请求执行签名计算并注入请求头
   *
   * @param {object} context
   * @param {string} context.method - HTTP 方法 ('GET' | 'POST')
   * @param {string} context.url - 请求完整 URL（包含 query 参数）
   * @param {string} context.pathname - 接口路径（如 '/webcast/lottery/melon/lottery_info/'）
   * @param {object} context.params - 请求参数字典（Query 或 Form 表单）
   * @param {object} context.headers - 现有请求头
   * @param {string|Buffer|null} context.body - POST 请求体（如有）
   * @param {object} context.deviceInfo - Android 设备与应用版本信息
   * @returns {Promise<{ headers: Record<string, string>, params?: Record<string, string>, body?: any }>}
   */
  async signRequest(context) {
    // 1. 如果通过 options 或外部注册了自定义 hook，优先调用该 hook
    if (this.customSignerHook) {
      const hookResult = await this.customSignerHook(context)
      if (hookResult && typeof hookResult === 'object') {
        return hookResult
      }
    }

    // 2. 默认实现：Android 原生四件套签名（x-argus / x-ladon / x-gorgon / x-khronos，POST 附带 x-ss-stub）
    const urlText = String(context.url || '')
    const qIdx = urlText.indexOf('?')
    const queryString = qIdx === -1 ? '' : urlText.slice(qIdx + 1)

    const signedHeaders = signAndroidHeaders({
      query: queryString,
      body: context.body,
      params: context.params
    })

    const defaultHeaders = {
      ...(context.headers || {}),
      ...signedHeaders,
      'x-ss-req-ticket': String(Date.now())
    }

    return {
      headers: defaultHeaders,
      params: context.params,
      body: context.body
    }
  }
}

module.exports = {
  AndroidSignatureProvider
}
