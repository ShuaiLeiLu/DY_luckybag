const app = getApp()
const { request, wxLogin } = require('../../utils/request')

function getTopInset() {
  try {
    if (typeof wx.getWindowInfo === 'function') {
      const info = wx.getWindowInfo()
      return Number(info.statusBarHeight || 20)
    }
    const info = wx.getSystemInfoSync()
    return Number(info.statusBarHeight || 20)
  } catch (_) {
    return 20
  }
}

function getRemainingHours(expireAt) {
  const diff = Number(expireAt || 0) - Date.now()
  if (diff <= 0) return 0
  return Math.ceil(diff / 3600000)
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

Page({
  data: {
    topInset: 20,
    statusText: '正在读取授权信息...',
    profileName: '微信用户',
    profileLevel: '普通用户',
    remainValue: '0',
    remainUnit: 'h',
    deviceCount: 0,
    menuItems: []
  },

  onLoad() {
    this.setData({ topInset: getTopInset() })
    this.bootstrap()
  },

  onShow() {
    this.bootstrap()
  },

  async bootstrap() {
    const cached = app.globalData.lastBindSession
    if (cached) {
      this.applySessionView(cached)
    }
    const sceneCode = String(app.globalData.lastSceneCode || '').trim()
    if (!sceneCode) {
      this.setEmptyState()
      return
    }
    try {
      await this.ensureSession()
      const result = await request(`/miniapp/bind-session/status?scene=${encodeURIComponent(sceneCode)}`)
      this.applySessionView(result.session || {})
    } catch (error) {
      this.setData({ statusText: '授权状态读取失败' })
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
    const remainHours = getRemainingHours(Number(session.licenseExpireAt || 0))
    const deviceCount = session.clientLabel ? 1 : 0
    const deviceLabel = formatDeviceLabel(session.clientLabel)
    const menuItems = [
      {
        key: 'device',
        icon: '设',
        title: '我的设备',
        trailing: deviceLabel,
        desc: deviceLabel
      },
      {
        key: 'license',
        icon: '时',
        title: '授权明细',
        trailing: '',
        desc: authorized ? `授权截止 ${formatExpire(Number(session.licenseExpireAt || 0))}` : '当前未激活完整授权'
      },
      {
        key: 'privacy',
        icon: '隐',
        title: '隐私政策',
        trailing: '',
        desc: '仅用于微信登录与设备授权绑定'
      }
    ]
    this.setData({
      statusText: authorized ? '授权状态正常' : '未激活完整授权',
      profileName: String(session.wechatNickname || '微信用户'),
      profileLevel: authorized ? '旗舰授权用户' : '普通用户',
      remainValue: String(remainHours),
      remainUnit: 'h',
      deviceCount,
      menuItems
    })
  },

  setEmptyState() {
    this.setData({
      statusText: '当前未绑定设备',
      profileName: '微信用户',
      profileLevel: '普通用户',
      remainValue: '0',
      remainUnit: 'h',
      deviceCount: 0,
      menuItems: [
        {
          key: 'device',
          icon: '设',
          title: '我的设备',
          trailing: '未绑定',
          desc: '请先从桌面端扫码进入授权页'
        },
        {
          key: 'license',
          icon: '时',
          title: '授权明细',
          trailing: '',
          desc: '当前暂无授权记录'
        },
        {
          key: 'privacy',
          icon: '隐',
          title: '隐私政策',
          trailing: '',
          desc: '仅用于微信登录与设备授权绑定'
        }
      ]
    })
  },

  openMenu(event) {
    const key = String(event.currentTarget.dataset.key || '')
    const item = (this.data.menuItems || []).find((entry) => entry.key === key)
    if (!item) return
    if (key === 'device') {
      return
    }
    if (key === 'privacy') {
      wx.navigateTo({ url: '/pages/privacy/index' })
      return
    }
    wx.showModal({
      title: item.title,
      content: item.desc,
      showCancel: false
    })
  },

  goWorkbench() {
    wx.redirectTo({
      url: '/pages/bind/index'
    })
  }
})
