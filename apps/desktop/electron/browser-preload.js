(() => {
  const defineValue = (target, key, value) => {
    try {
      Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        get: () => value
      })
      return true
    } catch (_) {
      return false
    }
  }

  const patchNavigator = () => {
    try {
      const nav = window.navigator
      if (!nav) return

      defineValue(nav, 'platform', 'Win32')
      defineValue(nav, 'vendor', 'Google Inc.')
      defineValue(nav, 'language', 'zh-CN')
      defineValue(nav, 'languages', ['zh-CN', 'zh', 'en-US', 'en'])
      defineValue(nav, 'hardwareConcurrency', 24)
      defineValue(nav, 'deviceMemory', 8)
      defineValue(nav, 'maxTouchPoints', 0)
      defineValue(nav, 'webdriver', false)

      if (!nav.userAgentData) {
        defineValue(nav, 'userAgentData', {
          brands: [
            { brand: 'Not/A)Brand', version: '8' },
            { brand: 'Chromium', version: '126' },
            { brand: 'Google Chrome', version: '126' }
          ],
          mobile: false,
          platform: 'Windows',
          toJSON() {
            return {
              brands: this.brands,
              mobile: this.mobile,
              platform: this.platform
            }
          },
          getHighEntropyValues(hints = []) {
            const result = {}
            const normalized = Array.isArray(hints) ? hints : []
            normalized.forEach((hint) => {
              if (hint === 'platform') result.platform = 'Windows'
              if (hint === 'platformVersion') result.platformVersion = '10.0.0'
              if (hint === 'architecture') result.architecture = 'x86'
              if (hint === 'model') result.model = ''
              if (hint === 'uaFullVersion') result.uaFullVersion = '126.0.0.0'
              if (hint === 'fullVersionList') {
                result.fullVersionList = [
                  { brand: 'Not/A)Brand', version: '8.0.0.0' },
                  { brand: 'Chromium', version: '126.0.0.0' },
                  { brand: 'Google Chrome', version: '126.0.0.0' }
                ]
              }
              if (hint === 'bitness') result.bitness = '64'
              if (hint === 'wow64') result.wow64 = false
            })
            return Promise.resolve(result)
          }
        })
      }
    } catch (_) {
      // ignore
    }
  }

  const patchScreen = () => {
    try {
      const screenObj = window.screen
      if (!screenObj) return
      defineValue(screenObj, 'width', 2560)
      defineValue(screenObj, 'height', 1440)
      defineValue(screenObj, 'availWidth', 2560)
      defineValue(screenObj, 'availHeight', 1400)
      defineValue(screenObj, 'colorDepth', 24)
      defineValue(screenObj, 'pixelDepth', 24)
      defineValue(window, 'devicePixelRatio', 1)
    } catch (_) {
      // ignore
    }
  }

  const patchWindowChrome = () => {
    try {
      if (!window.chrome || typeof window.chrome !== 'object') {
        defineValue(window, 'chrome', {})
      }
      if (!window.chrome.runtime) {
        window.chrome.runtime = {}
      }
      if (!window.chrome.app) {
        window.chrome.app = {}
      }
    } catch (_) {
      // ignore
    }
  }

  const patchPermissions = () => {
    try {
      if (!navigator.permissions || typeof navigator.permissions.query !== 'function') return
      const rawQuery = navigator.permissions.query.bind(navigator.permissions)
      navigator.permissions.query = (parameters) => {
        if (parameters && parameters.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission })
        }
        return rawQuery(parameters)
      }
    } catch (_) {
      // ignore
    }
  }

  patchNavigator()
  patchScreen()
  patchWindowChrome()
  patchPermissions()
})()
