const app = getApp()
const { AD_UNIT_ID, AD_UNLOCK_DAYS } = require('../../config')
const { request, wxLogin } = require('../../utils/request')

function buildRewardCopy(unlockDays) {
  const safeDays = Number(unlockDays || 0) > 0 ? Number(unlockDays) : Number(AD_UNLOCK_DAYS || 30)
  return {
    unlockDays: safeDays,
    gainText: `+${safeDays}天`,
    subtitleText: `点击下方按钮，即可免费获得 ${safeDays} 天授权`
  }
}

function formatDateTime(ms) {
  if (!ms) return ''
  const date = new Date(ms)
  const hours = `${date.getHours()}`.padStart(2, '0')
  const minutes = `${date.getMinutes()}`.padStart(2, '0')
  return `今天 ${hours}:${minutes}`
}

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

function normalizeHistoryItem(item) {
  return {
    id: item.id || Date.now(),
    action: String(item.action || item.title || '状态更新'),
    time: String(item.time || item.gainLabel || ''),
    date: String(item.date || item.timeLabel || '刚刚')
  }
}

function mergeHistory(list, nextItem) {
  const normalized = normalizeHistoryItem(nextItem)
  const existing = Array.isArray(list) ? list.slice(0) : []
  const deduped = existing.filter((item) => item.action !== normalized.action)
  deduped.unshift(normalized)
  return deduped.slice(0, 6)
}

Page({
  data: {
    sceneCode: '',
    bootstrapReady: false,
    adUnlockDays: Number(AD_UNLOCK_DAYS || 30),
    sessionLoading: false,
    bindLoading: false,
    rewardLoading: false,
    grantSubmitting: false,
    bindReady: false,
    deviceStatusText: '等待设备连接',
    remainingValue: '0',
    remainingUnit: '小时',
    rewardGainText: buildRewardCopy(AD_UNLOCK_DAYS).gainText,
    rewardSubtitleText: buildRewardCopy(AD_UNLOCK_DAYS).subtitleText,
    licenseSubtitleText: '完成绑定后即可解锁完整功能',
    licenseChipText: '待解锁',
    history: [],
    bootstrap: {
      licenseEnabled: false,
      unrestricted: false,
      miniAppEnabled: false,
      ready: false,
      reason: '',
      message: '',
      adUnlockDays: Number(AD_UNLOCK_DAYS || 30)
    },
    session: {
      status: '',
      clientLabel: '',
      appVersion: '',
      wechatNickname: '',
      authorized: false,
      licenseExpireAt: 0
    }
  },

  onLoad(options) {
    this.syncTabBar()
    const sceneCode = this.extractSceneCode(options)
    const cachedHistory = Array.isArray(app.globalData.recentMiniAppActivities)
      ? app.globalData.recentMiniAppActivities.map(normalizeHistoryItem)
      : []
    this.setData({
      sceneCode,
      history: cachedHistory.length
        ? cachedHistory
        : [{ id: 1, action: '等待绑定设备', time: '', date: '刚刚' }]
    })
    if (sceneCode) {
      app.globalData.lastSceneCode = sceneCode
    }
    this.ensureSession()
  },

  onShow() {
    this.syncTabBar()
    if (app.globalData.lastBindSession) {
      this.applySessionView(app.globalData.lastBindSession, 'cache')
    }
  },

  syncTabBar() {
    if (typeof this.getTabBar !== 'function') return
    const tabBar = this.getTabBar()
    if (!tabBar || typeof tabBar.setData !== 'function') return
    tabBar.setData({ selected: 0 })
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
      const bootstrap = await this.refreshBootstrap()
      if (!bootstrap.ready || bootstrap.unrestricted) {
        return
      }
      if (!this.data.sceneCode) {
        this.setData({
          deviceStatusText: '等待设备扫码'
        })
        return
      }

      await this.refreshBindStatus()
      const bindStatus = String(this.data.session.status || '')
      if (bindStatus === 'authorized' || bindStatus === 'expired') {
        return
      }
      const result = await this.loginMiniAppSession()
      if (!result) return
      if (!['scanned', 'granted', 'authorized'].includes(bindStatus)) {
        await this.autoBindCurrentClient()
      }
    } catch (error) {
      this.setData({
        deviceStatusText: `连接失败：${this.normalizeError(error)}`
      })
    } finally {
      this.setData({ sessionLoading: false })
    }
  },

  async refreshBootstrap() {
    const result = await request('/miniapp/bootstrap')
    const bootstrap = result.bootstrap || {}
    this.applyBootstrapView(bootstrap)
    return bootstrap
  },

  applyBootstrapView(bootstrap) {
    const rewardCopy = buildRewardCopy(bootstrap.adUnlockDays)
    const unrestricted = bootstrap.unrestricted === true
    const ready = bootstrap.ready === true
    let deviceStatusText = this.data.deviceStatusText
    let licenseSubtitleText = this.data.licenseSubtitleText
    let licenseChipText = this.data.licenseChipText

    if (unrestricted) {
      deviceStatusText = '服务端免授权已开启'
      licenseSubtitleText = '当前服务端已跳过授权限制'
      licenseChipText = '运行中'
    } else if (!ready) {
      deviceStatusText = `连接失败：${this.normalizeError(bootstrap.reason || bootstrap.message)}`
      licenseSubtitleText = '请先完成服务端小程序配置'
      licenseChipText = '待配置'
    } else if (!this.data.sceneCode) {
      deviceStatusText = '等待设备扫码'
      licenseSubtitleText = '完成绑定后即可解锁完整功能'
      licenseChipText = '待解锁'
    }

    const nextBootstrap = {
      licenseEnabled: bootstrap.licenseEnabled === true,
      unrestricted,
      miniAppEnabled: bootstrap.miniAppEnabled === true,
      ready,
      reason: String(bootstrap.reason || ''),
      message: String(bootstrap.message || ''),
      adUnlockDays: rewardCopy.unlockDays
    }

    app.globalData.bootstrapConfig = nextBootstrap
    this.setData({
      bootstrapReady: ready,
      adUnlockDays: rewardCopy.unlockDays,
      rewardGainText: rewardCopy.gainText,
      rewardSubtitleText: rewardCopy.subtitleText,
      deviceStatusText,
      licenseSubtitleText,
      licenseChipText,
      bootstrap: nextBootstrap
    })
  },

  async loginMiniAppSession() {
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
    return session
  },

  async refreshBindStatus() {
    const sceneCode = String(this.data.sceneCode || '').trim()
    if (!sceneCode) return
    try {
      const result = await request(`/miniapp/bind-session/status?scene=${encodeURIComponent(sceneCode)}`)
      this.applySessionView(result.session || {}, 'status')
    } catch (error) {
      this.setData({
        deviceStatusText: `状态刷新失败：${this.normalizeError(error)}`
      })
    }
  },

  async autoBindCurrentClient() {
    const sceneCode = String(this.data.sceneCode || '').trim()
    const sessionToken = String(app.globalData.sessionToken || '').trim()
    if (!sceneCode || !sessionToken) return
    this.setData({
      bindLoading: true,
      deviceStatusText: '正在绑定当前设备'
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
        deviceStatusText: `绑定失败：${this.normalizeError(error)}`
      })
    } finally {
      this.setData({ bindLoading: false })
    }
  },

  handleWatchAd() {
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
      this.setData({ rewardLoading: false })
      await this.grantAuthorization()
    })
    rewardedVideoAd.show().catch(() => rewardedVideoAd.load().then(() => rewardedVideoAd.show()))
  },

  async grantAuthorization() {
    this.setData({ grantSubmitting: true })
    try {
      if (!String(app.globalData.sessionToken || '').trim()) {
        await this.loginMiniAppSession()
      }
      const grantDays = Number(this.data.adUnlockDays || AD_UNLOCK_DAYS || 30)
      const result = await request('/miniapp/bind-session/grant', {
        method: 'POST',
        data: {
          scene: String(this.data.sceneCode || '').trim(),
          sessionToken: String(app.globalData.sessionToken || '').trim(),
          days: grantDays
        }
      })
      this.applySessionView(result.session || {}, 'grant')
      wx.showToast({
        title: '授权已延长',
        icon: 'success'
      })
    } catch (error) {
      this.setData({
        deviceStatusText: `授权失败：${this.normalizeError(error)}`
      })
    } finally {
      this.setData({ rewardLoading: false })
      this.setData({ grantSubmitting: false })
    }
  },

  applySessionView(session, source) {
    const authorized = session.authorized === true
    const bindStatus = String(session.status || '')
    const remaining = getRemainingParts(Number(session.licenseExpireAt || 0))
    const deviceStatusText = authorized || ['scanned', 'granted'].includes(bindStatus)
      ? '设备连接正常'
      : bindStatus === 'expired'
        ? '二维码已过期'
        : '等待设备连接'
    const licenseSubtitleText = authorized
      ? '旗舰版授权有效'
      : bindStatus === 'expired'
        ? '请回到桌面端刷新授权码'
        : '完成绑定后即可解锁完整功能'
    const licenseChipText = authorized ? '运行中' : '待解锁'

    this.setData({
      bindReady: ['scanned', 'granted', 'authorized'].includes(bindStatus),
      deviceStatusText,
      licenseSubtitleText,
      licenseChipText,
      remainingValue: remaining.value,
      remainingUnit: remaining.unit,
      session: {
        status: bindStatus,
        clientLabel: String(session.clientLabel || ''),
        appVersion: String(session.appVersion || ''),
        wechatNickname: String(session.wechatNickname || ''),
        authorized,
        licenseExpireAt: Number(session.licenseExpireAt || 0)
      }
    })

    app.globalData.lastBindSession = {
      ...session,
      status: bindStatus,
      authorized,
      licenseExpireAt: Number(session.licenseExpireAt || 0)
    }

    if (source === 'scan' && ['scanned', 'granted', 'authorized'].includes(bindStatus)) {
      this.pushHistory({
        action: '设备绑定成功',
        time: String(session.clientLabel || ''),
        date: formatDateTime(Date.now())
      })
    }
    if (source === 'grant' && authorized) {
      this.pushHistory({
        action: '免费获取授权',
        time: `+${Number(this.data.adUnlockDays || AD_UNLOCK_DAYS || 30)}天`,
        date: formatDateTime(Date.now())
      })
    }
  },

  pushHistory(item) {
    const nextList = mergeHistory(this.data.history, item)
    this.setData({ history: nextList })
    app.globalData.recentMiniAppActivities = nextList
  },

  normalizeError(error) {
    const raw = String((error && error.message) || error || '').trim()
    const mapping = {
      miniapp_disabled: '小程序授权未启用',
      miniapp_config_incomplete: '服务端未配置小程序参数',
      miniapp_session_secret_required: '服务端缺少会话密钥',
      license_disabled: '授权服务未启用',
      license_service_init_failed: '授权服务初始化失败',
      license_unrestricted: '服务端免授权已开启',
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
