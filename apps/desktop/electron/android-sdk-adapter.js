const path = require('node:path')

/**
 * Load an explicitly supplied native Android security adapter. The desktop
 * repository does not ship the vendor metasec/TicketGuard runtime; silently
 * substituting the old AES candidate would make a login appear to work while
 * the platform rejects the session. The module is therefore opt-in and must
 * expose a stateful signRequest/sign adapter, a declared requiredHeaders list,
 * and verifyTrustedSample() for production use.
 */
function loadAndroidSdkAdapter({ modulePath = process.env.DY_ANDROID_SDK_MODULE } = {}) {
  if (!modulePath) return null
  const filename = path.resolve(modulePath)
  let loaded
  try { loaded = require(filename) } catch (error) {
    throw Object.assign(new Error('无法加载已配置的 Android SDK 适配器'), {
      code: 'ANDROID_SDK_UNAVAILABLE', cause: error
    })
  }
  const factory = loaded?.createAndroidSdkAdapter || loaded?.create || loaded?.default
  let adapter = typeof factory === 'function' ? factory() : loaded
  if (adapter && typeof adapter.then === 'function') {
    throw Object.assign(new Error('Android SDK 适配器工厂必须同步返回实例'), { code: 'ANDROID_SDK_UNAVAILABLE' })
  }
  if (!adapter || typeof adapter !== 'object' ||
    (typeof adapter.signRequest !== 'function' && typeof adapter.sign !== 'function')) {
    throw Object.assign(new Error('Android SDK 适配器未提供完整请求签名接口'), { code: 'ANDROID_SDK_UNAVAILABLE' })
  }
  return adapter
}

function createProductionSignerFactory({ allowExperimental = false } = {}) {
  return () => {
    const { AndroidSignatureProvider } = require('./android-signature-provider')
    const adapter = loadAndroidSdkAdapter()
    return new AndroidSignatureProvider({
      sdkAdapter: adapter,
      // Offline fixture runs may exercise transport wiring, but production
      // must stop before QR creation when the verified SDK is absent.
      requireSdk: !allowExperimental && !adapter,
      requireVerified: !allowExperimental
    })
  }
}

module.exports = { loadAndroidSdkAdapter, createProductionSignerFactory }
