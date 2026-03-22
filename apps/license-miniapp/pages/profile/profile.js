const app = getApp()
const { request, wxLogin } = require('../../utils/request')

function getRemainingParts(expireAt) {
  const diff = Number(expireAt || 0) - Date.now()
  if (diff <= 0) {
    return {
      value: '0',
      unit: '小时'
    }
  }
  const hours = Math.ceil(diff / 3600000)
  if (hours >= 24) {
    const days = Math.ceil(hours / 24)
    return {
      value: String(days),
      unit: '天'
    }
  }
  return {
    value: String(hours),
    unit: '小时'
  }
}

function formatExpire(expireAt) {
  if (!expireAt) return '暂无有效授权'
  const date = new Date(expireAt)
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  const hh = `${date.getHours()}`.padStart(2, '0')
  const mm = `${date.getMinutes()}`.padStart(2, '0')
  return `${y}-${m}-${d} ${hh}:${mm}`
}

function formatDeviceLabel(label) {
  const raw = String(label || '').trim()
  if (!raw) return '未绑定'
  if (raw.length <= 10) return raw
  return `${raw.slice(0, 4)}...${raw.slice(-4)}`
}

function parseQueryParams(queryString) {
  const params = {}
  if (!queryString) return params
  queryString
    .replace(/^\?/, '')
    .split('&')
    .forEach((pair) => {
      if (!pair) return
      const [rawKey, rawValue] = pair.split('=')
      const key = decodeURIComponent(String(rawKey || '').trim())
      if (!key) return
      const value = decodeURIComponent(String(rawValue || '').trim())
      params[key] = value
    })
  return params
}

function extractSceneFromScan(scanResult) {
  if (!scanResult) return ''
  const path = String(scanResult.path || '').trim()
  if (path) {
    const [, queryString] = path.split('?')
    const params = parseQueryParams(queryString)
    return params.scene || params.sceneCode || params.bindToken || ''
  }
  const result = String(scanResult.result || '').trim()
  if (!result) return ''
  const queryIndex = result.indexOf('?')
  if (queryIndex >= 0) {
    const params = parseQueryParams(result.slice(queryIndex + 1))
    return params.scene || params.sceneCode || params.bindToken || ''
  }
  const match = result.match(/(?:scene|sceneCode|bindToken)=([^&]+)/i)
  if (match && match[1]) return decodeURIComponent(match[1])
  return result
}

Page({
  data: {
    profileName: '微信用户',
    profileLevel: '普通用户',
    remainValue: '0',
    remainUnit: '小时',
    deviceCount: 0,
    menuItems: []
  },

  onLoad() {
    this.syncTabBar()
    this.bootstrap()
  },

  onShow() {
    this.syncTabBar()
    this.bootstrap()
  },

  syncTabBar() {
    if (typeof this.getTabBar !== 'function') return
    const tabBar = this.getTabBar()
    if (!tabBar || typeof tabBar.setData !== 'function') return
    tabBar.setData({ selected: 1 })
  },

  async bootstrap() {
    const cached = app.globalData.lastBindSession
    if (cached) {
      this.applySessionView(cached)
    }
    const sceneCode = String(app.globalData.lastSceneCode || '').trim()
    const bootstrap = await this.refreshBootstrap()
    if (!bootstrap.ready || bootstrap.unrestricted) {
      this.setEmptyState()
      return
    }
    if (!sceneCode) {
      this.setEmptyState()
      return
    }
    try {
      await this.ensureSession()
      const result = await request(`/miniapp/bind-session/status?scene=${encodeURIComponent(sceneCode)}`)
      this.applySessionView(result.session || {})
    } catch (_) {
      this.setEmptyState()
    }
  },

  async refreshBootstrap() {
    try {
      const result = await request('/miniapp/bootstrap')
      const bootstrap = result.bootstrap || {}
      app.globalData.bootstrapConfig = bootstrap
      return bootstrap
    } catch (_) {
      return {
        ready: false,
        unrestricted: false
      }
    }
  },

  async ensureSession() {
    const now = Date.now()
    if (app.globalData.sessionToken && Number(app.globalData.sessionExpireAt || 0) > now + 30000) {
      return
    }
    const code = await wxLogin()
    const result = await request('/miniapp/auth/login', {
      method: 'POST',
      data: { code }
    })
    const session = result.session || {}
    app.globalData.sessionToken = String(session.sessionToken || '')
    app.globalData.openId = String(session.openId || '')
    app.globalData.unionId = String(session.unionId || '')
    app.globalData.sessionExpireAt = Number(session.expireAt || 0)
  },

  applySessionView(session) {
    const authorized = session.authorized === true
    const remain = getRemainingParts(Number(session.licenseExpireAt || 0))
    const deviceCount = session.clientLabel ? 1 : 0
    const deviceLabel = formatDeviceLabel(session.clientLabel)
    const menuItems = [
      {
        key: 'scan',
        icon: '/assets/key.svg',
        label: '扫一扫绑定',
        value: '',
        desc: '扫码桌面端二维码，绑定当前设备'
      },
      {
        key: 'admin',
        icon: '/assets/shield-check.svg',
        label: '抖娃控制台',
        value: '',
        desc: '系统级监控与配置'
      },
      {
        key: 'device',
        icon: '/assets/smartphone.svg',
        label: '我的设备',
        value: deviceLabel,
        desc: deviceLabel
      },
      {
        key: 'detail',
        icon: '/assets/history.svg',
        label: '授权明细',
        value: '',
        desc: authorized ? `授权截止 ${formatExpire(Number(session.licenseExpireAt || 0))}` : '当前未激活完整授权'
      },
      {
        key: 'privacy',
        icon: '/assets/privacy.svg',
        label: '隐私政策',
        value: '',
        desc: '仅用于微信登录与设备授权绑定'
      }
    ]
    this.setData({
      profileName: String(session.wechatNickname || '微信用户'),
      profileLevel: authorized ? '旗舰授权用户' : '普通用户',
      remainValue: remain.value,
      remainUnit: remain.unit === '小时' ? 'h' : remain.unit,
      deviceCount,
      menuItems
    })
  },

  setEmptyState() {
    this.setData({
      profileName: '微信用户',
      profileLevel: '普通用户',
      remainValue: '0',
      remainUnit: 'h',
      deviceCount: 0,
      menuItems: [
        {
          key: 'scan',
          icon: '/assets/key.svg',
          label: '扫一扫绑定',
          value: '',
          desc: '扫码桌面端二维码，绑定当前设备'
        },
        {
          key: 'admin',
          icon: '/assets/shield-check.svg',
          label: '抖娃控制台',
          value: '',
          desc: '系统级监控与配置'
        },
        {
          key: 'device',
          icon: '/assets/smartphone.svg',
          label: '我的设备',
          value: '未绑定',
          desc: '请先从桌面端扫码进入授权页'
        },
        {
          key: 'detail',
          icon: '/assets/history.svg',
          label: '授权明细',
          value: '',
          desc: '当前暂无授权记录'
        },
        {
          key: 'privacy',
          icon: '/assets/privacy.svg',
          label: '隐私政策',
          value: '',
          desc: '仅用于微信登录与设备授权绑定'
        }
      ]
    })
  },

  handleMenuTap(event) {
    const key = String(event.currentTarget.dataset.key || '')
    const item = (this.data.menuItems || []).find((entry) => entry.key === key)
    if (!item) return
    if (key === 'scan') {
      this.handleScanBind()
      return
    }
    if (key === 'admin') {
      wx.navigateTo({ url: '/pages/admin/index' })
      return
    }
    if (key === 'device') {
      return
    }
    if (key === 'privacy') {
      wx.navigateTo({ url: '/pages/privacy/index' })
      return
    }
    wx.showModal({
      title: item.label,
      content: item.desc,
      showCancel: false
    })
  },

  async handleScanBind() {
    try {
      const scanResult = await new Promise((resolve, reject) => {
        wx.scanCode({
          scanType: ['qrCode'],
          success: resolve,
          fail: reject
        })
      })
      const sceneCode = extractSceneFromScan(scanResult)
      if (!sceneCode) {
        wx.showToast({ title: '未识别绑定二维码', icon: 'none' })
        return
      }
      app.globalData.lastSceneCode = sceneCode
      try {
        wx.setStorageSync('lastSceneCode', sceneCode)
      } catch (_) {}
      wx.navigateTo({
        url: `/pages/bind/index?scene=${encodeURIComponent(sceneCode)}`
      })
    } catch (error) {
      const message = String(error && error.errMsg ? error.errMsg : '')
      if (message.includes('cancel')) return
      wx.showToast({ title: '扫码失败，请重试', icon: 'none' })
    }
  }
})
