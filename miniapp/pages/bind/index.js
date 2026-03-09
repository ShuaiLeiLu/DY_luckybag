const app = getApp()
const { AD_UNIT_ID, AD_UNLOCK_DAYS } = require('../../config')
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

function formatDateTime(ms) {
  if (!ms) return ''
  const date = new Date(ms)
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  const hh = `${date.getHours()}`.padStart(2, '0')
  const mm = `${date.getMinutes()}`.padStart(2, '0')
  return `${y}-${m}-${d} ${hh}:${mm}`
}

function formatClock(ms) {
  if (!ms) return '刚刚'
  const date = new Date(ms)
  const hh = `${date.getHours()}`.padStart(2, '0')
  const mm = `${date.getMinutes()}`.padStart(2, '0')
  return `${hh}:${mm}`
}

function getRemainingParts(expireAt) {
  const diff = Number(expireAt || 0) - Date.now()
  if (diff <= 0) {
    return {
      value: '0',
      unit: '小时',
      friendly: '0小时'
    }
  }
  const hours = Math.ceil(diff / 3600000)
  if (hours >= 24) {
    const days = Math.ceil(hours / 24)
    return {
      value: String(days),
      unit: '天',
      friendly: `${days}天`
    }
  }
  return {
    value: String(hours),
    unit: '小时',
    friendly: `${hours}小时`
  }
}

function mergeActivity(list, nextItem) {
  const existing = Array.isArray(list) ? list.slice(0) : []
  const deduped = existing.filter((item) => item.type !== nextItem.type)
  deduped.unshift(nextItem)
  return deduped.slice(0, 4)
}

Page({
  data: {
    topInset: 20,
    sceneCode: '',
    sessionLoading: false,
    bindLoading: false,
    rewardLoading: false,
    bindReady: false,
    statusTone: 'pending',
    deviceStatusText: '等待设备连接',
    statusText: '请从桌面端直接扫描小程序码进入本页',
    licenseChipText: '待解锁',
    licenseChipClass: 'is-idle',
    licenseSubtitleText: '完成绑定后即可解锁完整功能',
    deviceHintText: '请从桌面端直接扫描小程序码进入本页',
    adUnlockDays: AD_UNLOCK_DAYS,
    rewardSubtitleText: `观看一段完整视频，即可获得 ${AD_UNLOCK_DAYS} 天完整授权`,
    rewardButtonText: `观看广告（+${AD_UNLOCK_DAYS}天）`,
    remainingValue: '0',
    remainingUnit: '小时',
    remainingFriendly: '0小时',
    recentActivities: [],
    session: {
      status: '',
      clientLabel: '',
      appVersion: '',
      wechatNickname: '',
      authorized: false,
      licenseExpireAt: 0,
      licenseExpireAtText: ''
    }
  },

  onLoad(options) {
    const sceneCode = this.extractSceneCode(options)
    this.setData({
      topInset: getTopInset(),
      sceneCode,
      recentActivities: Array.isArray(app.globalData.recentMiniAppActivities)
        ? app.globalData.recentMiniAppActivities.slice(0, 4)
        : []
    })
    if (sceneCode) {
      app.globalData.lastSceneCode = sceneCode
    }
    this.pushActivity('boot', '等待连接桌面端', '通过微信扫码进入授权流程', '')
    this.ensureSession()
  },

  onShow() {
    if (app.globalData.lastBindSession) {
      this.applySessionView(app.globalData.lastBindSession, 'cache')
    }
  },

  extractSceneCode(options = {}) {
    if (options.scene) return decodeURIComponent(String(options.scene)).trim()
    if (options.sceneCode) return String(options.sceneCode).trim()
    if (options.bindToken) return String(options.bindToken).trim()
    if (app.globalData.lastSceneCode) return String(app.globalData.lastSceneCode).trim()
    return ''
  },

  async ensureSession() {
    this.setData({ sessionLoading: true })
    try {
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
      this.pushActivity('login', '微信登录成功', formatClock(Date.now()), '')

      if (!this.data.sceneCode) {
        this.setData({
          statusTone: 'pending',
          deviceStatusText: '等待设备扫码',
          statusText: '请回到桌面端授权弹窗，用微信扫一扫打开本小程序',
          deviceHintText: '请回到桌面端授权弹窗，用微信扫一扫打开本小程序'
        })
        return
      }

      await this.refreshBindStatus()
      const bindStatus = String(this.data.session.status || '')
      if (!['scanned', 'granted', 'authorized'].includes(bindStatus)) {
        await this.autoBindCurrentClient()
      }
    } catch (error) {
      this.setData({
        statusTone: 'danger',
        deviceStatusText: '连接失败',
        statusText: `微信登录失败：${this.normalizeError(error)}`,
        deviceHintText: `微信登录失败：${this.normalizeError(error)}`
      })
    } finally {
      this.setData({ sessionLoading: false })
    }
  },

  async refreshBindStatus() {
    const sceneCode = String(this.data.sceneCode || '').trim()
    if (!sceneCode) return
    try {
      const result = await request(`/miniapp/bind-session/status?scene=${encodeURIComponent(sceneCode)}`)
      this.applySessionView(result.session || {}, 'status')
    } catch (error) {
      this.setData({
        statusTone: 'danger',
        deviceStatusText: '连接失败',
        statusText: `状态刷新失败：${this.normalizeError(error)}`,
        deviceHintText: `状态刷新失败：${this.normalizeError(error)}`
      })
    }
  },

  async autoBindCurrentClient() {
    const sceneCode = String(this.data.sceneCode || '').trim()
    const sessionToken = String(app.globalData.sessionToken || '').trim()
    if (!sceneCode || !sessionToken) return
    this.setData({
      bindLoading: true,
      statusTone: 'pending',
      deviceStatusText: '正在绑定设备',
      statusText: '正在自动绑定当前客户端...',
      deviceHintText: '正在自动绑定当前客户端...'
    })
    try {
      const result = await request('/miniapp/bind-session/scan', {
        method: 'POST',
        data: {
          scene: sceneCode,
          sessionToken,
          nickname: '微信用户'
        }
      })
      this.applySessionView(result.session || {}, 'scan')
    } catch (error) {
      this.setData({
        statusTone: 'danger',
        deviceStatusText: '绑定失败',
        statusText: `自动绑定失败：${this.normalizeError(error)}`,
        deviceHintText: `自动绑定失败：${this.normalizeError(error)}`
      })
    } finally {
      this.setData({ bindLoading: false })
    }
  },

  watchRewardAd() {
    if (!this.data.bindReady) {
      wx.showToast({ title: '请先完成客户端绑定', icon: 'none' })
      return
    }
    if (!AD_UNIT_ID || AD_UNIT_ID === 'adunit-replace-me') {
      wx.showToast({ title: '请先配置激励视频广告位', icon: 'none' })
      return
    }
    const rewardedVideoAd = wx.createRewardedVideoAd({ adUnitId: AD_UNIT_ID })
    this.setData({ rewardLoading: true })
    rewardedVideoAd.onError(() => {
      this.setData({ rewardLoading: false })
      wx.showToast({ title: '广告加载失败', icon: 'none' })
    })
    rewardedVideoAd.onClose(async (res) => {
      rewardedVideoAd.offClose()
      rewardedVideoAd.offError()
      if (res && res.isEnded === false) {
        this.setData({ rewardLoading: false })
        wx.showToast({ title: '请完整观看广告', icon: 'none' })
        return
      }
      await this.grantAuthorization()
    })
    rewardedVideoAd.show().catch(() => rewardedVideoAd.load().then(() => rewardedVideoAd.show()))
  },

  async grantAuthorization() {
    try {
      const result = await request('/miniapp/bind-session/grant', {
        method: 'POST',
        data: {
          scene: String(this.data.sceneCode || '').trim(),
          sessionToken: String(app.globalData.sessionToken || '').trim(),
          days: AD_UNLOCK_DAYS
        }
      })
      this.applySessionView(result.session || {}, 'grant')
      wx.showToast({ title: '授权已发放', icon: 'success' })
    } catch (error) {
      this.setData({
        statusTone: 'danger',
        deviceStatusText: '授权失败',
        statusText: `授权失败：${this.normalizeError(error)}`,
        deviceHintText: `授权失败：${this.normalizeError(error)}`
      })
    } finally {
      this.setData({ rewardLoading: false })
    }
  },

  applySessionView(session, source) {
    const authorized = session.authorized === true
    const bindStatus = String(session.status || '')
    const remaining = getRemainingParts(Number(session.licenseExpireAt || 0))
    const statusText = authorized
      ? `授权已生效，截止 ${formatDateTime(Number(session.licenseExpireAt || 0)) || '未返回'}`
      : String(session.message || '进入小程序后会自动绑定当前客户端')
    const deviceStatusText = authorized || ['scanned', 'granted'].includes(bindStatus)
      ? '设备连接正常'
      : bindStatus === 'expired'
        ? '二维码已失效'
        : '等待设备连接'
    const statusTone = authorized || ['scanned', 'granted'].includes(bindStatus)
      ? 'success'
      : bindStatus === 'expired'
        ? 'danger'
        : 'pending'
    const licenseChipText = authorized ? '运行中' : '待解锁'
    const licenseChipClass = authorized ? 'is-active' : 'is-idle'
    const licenseSubtitleText = authorized
      ? '旗舰版授权有效'
      : bindStatus === 'expired'
        ? '当前小程序码已失效，请刷新桌面端'
        : '完成绑定后即可解锁完整功能'
    const deviceHintText = session.clientLabel
      ? `已绑定设备：${String(session.clientLabel || '')}`
      : statusText

    this.setData({
      bindReady: ['scanned', 'granted', 'authorized'].includes(bindStatus),
      statusTone,
      deviceStatusText,
      statusText,
      licenseChipText,
      licenseChipClass,
      licenseSubtitleText,
      deviceHintText,
      remainingValue: remaining.value,
      remainingUnit: remaining.unit,
      remainingFriendly: remaining.friendly,
      session: {
        status: bindStatus,
        clientLabel: String(session.clientLabel || ''),
        appVersion: String(session.appVersion || ''),
        wechatNickname: String(session.wechatNickname || ''),
        authorized,
        licenseExpireAt: Number(session.licenseExpireAt || 0),
        licenseExpireAtText: formatDateTime(Number(session.licenseExpireAt || 0))
      }
    })

    app.globalData.lastBindSession = {
      ...session,
      status: bindStatus,
      authorized,
      licenseExpireAt: Number(session.licenseExpireAt || 0)
    }

    if (['scan', 'status'].includes(source) && ['scanned', 'granted', 'authorized'].includes(bindStatus)) {
      this.pushActivity(
        'bind',
        '设备绑定成功',
        formatClock(Date.now()),
        this.data.session.clientLabel || String(session.clientLabel || '')
      )
    }
    if (authorized) {
      this.pushActivity(
        'grant',
        '授权生效',
        formatClock(Date.now()),
        `+${AD_UNLOCK_DAYS}天`
      )
    }
  },

  pushActivity(type, title, timeLabel, gainLabel) {
    const nextList = mergeActivity(this.data.recentActivities, {
      type,
      title,
      timeLabel,
      gainLabel
    })
    this.setData({ recentActivities: nextList })
    app.globalData.recentMiniAppActivities = nextList
  },

  goMe() {
    wx.redirectTo({
      url: '/pages/me/index'
    })
  },

  normalizeError(error) {
    const raw = String((error && error.message) || error || '').trim()
    const mapping = {
      miniapp_disabled: '小程序授权未启用',
      miniapp_config_incomplete: '服务端未配置小程序参数',
      miniapp_session_secret_required: '服务端缺少会话密钥',
      miniapp_wechat_request_failed: '微信登录请求失败',
      miniapp_wechat_code2session_failed: '微信登录失败，请重试',
      miniapp_session_expired: '小程序登录已过期，请重新进入',
      miniapp_session_invalid: '小程序会话无效，请重新进入',
      bind_ref_required: '缺少绑定参数，请从桌面端扫码进入',
      bind_scene_invalid: '二维码无效，请回到桌面端刷新',
      bind_session_expired: '二维码已过期，请回到桌面刷新',
      bind_session_not_scanned: '客户端绑定尚未完成，请稍后重试',
      bind_session_claimed_by_other_user: '该二维码已被其他微信账号占用'
    }
    return mapping[raw] || raw || '请求失败'
  }
})
