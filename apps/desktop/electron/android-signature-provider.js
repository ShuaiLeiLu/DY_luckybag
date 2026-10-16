/**
 * Android 协议签名提供者接口与基础实现
 *
 * 【签名代码扩展入口】
 * 可通过 signerHook 接入经过真实请求验证的纯协议签名实现。
 * 默认 experimental-aes-v2 只供诊断，不代表已实现官方签名或设备证明。
 */

const { DouyinBackendError, ERROR_CODES } = require('./douyin-request-models')
const { signNativeAndroidHeaders } = require('./android-sign-algorithms')
const { AndroidSdkContext } = require('./android-sdk-context')

class AndroidSignatureProvider {
  constructor(options = {}) {
    this.options = options
    // 支持动态注入自定义签名 hook 函数
    this.customSignerHook = typeof options.signerHook === 'function' ? options.signerHook : null
    this.requireSdk = options.requireSdk === true
    this.sdkContext = options.sdkContext || null
    this.sdkAdapter = options.sdkAdapter || null
    this.sdkFactory = typeof options.sdkFactory === 'function' ? options.sdkFactory : null
    if (this.sdkAdapter && !this.sdkContext) this.sdkContext = new AndroidSdkContext({ adapter: this.sdkAdapter,
      now: options.now, requireVerified: options.requireVerified === true, trustedSamples: options.trustedSamples })
    this.profile = null
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

  /** Configure the SDK once and update it when device registration returns IDs. */
  setProfile(profile) {
    this.profile = profile ? { ...profile, deviceInfo: { ...(profile.deviceInfo || {}) } } : null
    if (!this.sdkContext && this.sdkFactory && this.profile) {
      this.sdkAdapter = this.sdkFactory(this.profile)
      this.sdkContext = new AndroidSdkContext({ adapter: this.sdkAdapter, now: this.options.now,
        requireVerified: this.options.requireVerified === true, trustedSamples: this.options.trustedSamples })
    }
    this.sdkContext?.setProfile(this.profile)
  }

  getStatus() {
    if (this.sdkContext) return { implementation: 'android-sdk-adapter', ...this.sdkContext.snapshot() }
    return { implementation: 'experimental-aes-v2', verified: false, initialized: false, requiredSdk: this.requireSdk }
  }

  async consumeResponse(input) {
    if (!this.sdkContext) return
    try { await this.sdkContext.consumeResponse(input) }
    catch (error) {
      if (error?.code === ERROR_CODES.ANDROID_TICKET_GUARD_UNAVAILABLE || error?.code === ERROR_CODES.ANDROID_SDK_UNAVAILABLE) throw error
      throw new DouyinBackendError('Android SDK failed to consume security response', {
        code: ERROR_CODES.ANDROID_TICKET_GUARD_UNAVAILABLE
      })
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
   * A hook may add security headers. Echoed params/body must match the signed
   * input; encoding/encryption must finish before this boundary.
   */
  async signRequest(context) {
    // 1. 如果通过 options 或外部注册了自定义 hook，优先调用该 hook
    if (this.customSignerHook) {
      const hookResult = await this.customSignerHook(context)
      if (hookResult && typeof hookResult === 'object' && !Array.isArray(hookResult) &&
        hookResult.headers && typeof hookResult.headers === 'object' && !Array.isArray(hookResult.headers) &&
        Object.keys(hookResult.headers).some(key => key.toLowerCase() === 'x-argus' && hookResult.headers[key])) {
        return hookResult
      }
      // A failed adapter must not silently switch back to the experimental AES
      // candidate: that would conceal which implementation was actually used.
      throw new DouyinBackendError('Signature adapter returned no signature', { code: ERROR_CODES.ANDROID_TICKET_GUARD_UNAVAILABLE })
    }

    if (this.sdkContext) {
      try { return await this.sdkContext.signRequest(context) }
      catch (error) {
        if (error?.code) throw error
        throw new DouyinBackendError('Android SDK failed to produce security headers', {
          code: ERROR_CODES.ANDROID_TICKET_GUARD_UNAVAILABLE, details: { cause: error?.message || 'unknown' }
        })
      }
    }

    if (this.requireSdk) {
      throw new DouyinBackendError('No verified Android SDK signer is configured', {
        code: ERROR_CODES.ANDROID_SDK_UNAVAILABLE
      })
    }

    // Experimental local implementation: fixed vectors test reproducibility,
    // not platform acceptance or device-bound TicketGuard readiness.
    const nativeHeaders = signNativeAndroidHeaders({
      query: context.query || '',
      params: context.params || null,
      body: context.body || '',
      requestTicketMs: context.timestampMs,
      passport: context.responseMode === 'passport'
    })

    return {
      headers: { ...(context.headers || {}), ...nativeHeaders },
      params: context.params,
      body: context.body
    }
  }
}

module.exports = {
  AndroidSignatureProvider
}
