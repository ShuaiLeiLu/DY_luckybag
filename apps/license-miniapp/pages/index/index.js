const app = getApp()
const { SIGNIN_REWARD_DAYS, AD_UNLOCK_DAYS, REWARDED_VIDEO_AD_UNIT_ID } = require('../../config')
const { request, wxLogin } = require('../../utils/request')
const { parseSceneCode } = require('../../utils/scene')

function buildRewardCopy(unlockDays) {
  const safeDays = Math.max(1, Number(unlockDays || SIGNIN_REWARD_DAYS || AD_UNLOCK_DAYS || 1))
  return {
    unlockDays: safeDays,
    gainText: `+${safeDays}天`,
    subtitleText: `每日签到一次，可免费续签 ${safeDays} 天授权`,
    buttonText: `观看广告后签到（${safeDays}天）`,
    grantMaskText: `系统正在同步 ${safeDays} 天授权时长，请稍候`
  }
}

function formatDateTime(ms) {
  if (!ms) return ''
  const date = new Date(ms)
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  const hours = `${date.getHours()}`.padStart(2, '0')
  const minutes = `${date.getMinutes()}`.padStart(2, '0')
  return `${m}-${d} ${hours}:${minutes}`
}

function isSameDay(ts) {
  if (!ts) return false
  const date = new Date(ts)
  const now = new Date()
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  )
}

function getStoredSigninAt() {
  try {
    const cached = wx.getStorageSync('miniappLastSigninAt')
    return Number(cached || 0)
  } catch (_) {
    return 0
  }
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
    date: String(item.date || item.timeLabel || formatDateTime(Date.now()))
  }
}

function mergeHistory(list, nextItem) {
  const normalized = normalizeHistoryItem(nextItem)
  const existing = Array.isArray(list) ? list.slice(0) : []
  const deduped = existing.filter((item) => item.action !== normalized.action)
  deduped.unshift(normalized)
  return deduped.slice(0, 6)
}

function hasRewardedVideoSupport() {
  return typeof wx !== 'undefined' && typeof wx.createRewardedVideoAd === 'function'
}

Page({
  data: {
    sceneCode: '',
    bootstrapReady: false,
    adUnlockDays: Number(SIGNIN_REWARD_DAYS || AD_UNLOCK_DAYS || 1),
    rewardAdUnitId: String(REWARDED_VIDEO_AD_UNIT_ID || '').trim(),
    sessionLoading: false,
    bindLoading: false,
    rewardLoading: false,
    grantSubmitting: false,
    bindReady: false,
    rewardDisabled: false,
    deviceStatusText: '等待设备连接',
    remainingValue: '0',
    remainingUnit: '小时',
    rewardGainText: buildRewardCopy(SIGNIN_REWARD_DAYS || AD_UNLOCK_DAYS || 1).gainText,
    rewardSubtitleText: buildRewardCopy(SIGNIN_REWARD_DAYS || AD_UNLOCK_DAYS || 1).subtitleText,
    rewardButtonText: buildRewardCopy(SIGNIN_REWARD_DAYS || AD_UNLOCK_DAYS || 1).buttonText,
    grantMaskText: buildRewardCopy(SIGNIN_REWARD_DAYS || AD_UNLOCK_DAYS || 1).grantMaskText,

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
      adUnlockDays: Number(SIGNIN_REWARD_DAYS || AD_UNLOCK_DAYS || 1)
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
      ? app.globalData.recentMiniAppActivities
          .map(normalizeHistoryItem)
          .filter((item) => item.action !== '等待连接桌面端')
      : []
    this.setData({
      sceneCode,

      history: cachedHistory.length ? cachedHistory : []
    })
    if (sceneCode) {
      app.globalData.lastSceneCode = sceneCode
      try {
        wx.setStorageSync('lastSceneCode', sceneCode)
      } catch (_) {}
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
    return parseSceneCode(options.scene || options.sceneCode || options.bindToken || app.globalData.lastSceneCode || '')
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
          deviceStatusText: '等待设备扫码',
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
      rewardButtonText: rewardCopy.buttonText,
      grantMaskText: rewardCopy.grantMaskText,
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
      console.log('[miniapp-status] index status response', result)
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

  handleDailySignin() {
    if (this.data.rewardLoading) {
      return
    }
    if (!this.data.bindReady) {
      wx.showToast({ title: '请先在“我的”页扫一扫绑定桌面端', icon: 'none' })
      return
    }
    if (this.data.rewardDisabled) {
      wx.showToast({ title: '今日已签到', icon: 'none' })
      return
    }
    this.setData({ rewardLoading: true })
    this.performSigninFlow()
  },

  async performSigninFlow() {
    try {
      if (!this.data.rewardAdUnitId) {
        wx.showToast({ title: '未配置广告位，直接签到', icon: 'none' })
        await this.grantAuthorization()
        return
      }
      if (!hasRewardedVideoSupport()) {
        wx.showToast({ title: '当前设备不支持激励视频广告', icon: 'none' })
        return
      }
      const watched = await this.playRewardedVideoAd(this.data.rewardAdUnitId)
      if (!watched) {
        wx.showToast({ title: '需完整观看广告后才能签到', icon: 'none' })
        return
      }
      await this.grantAuthorization()
    } catch (error) {
      const message = this.normalizeError(error)
      wx.showToast({ title: message || '签到失败', icon: 'none' })
    } finally {
      this.setData({ rewardLoading: false })
    }
  },

  playRewardedVideoAd(adUnitId) {
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (value, shouldReject = false) => {
        if (settled) return
        settled = true
        if (shouldReject) {
          reject(value)
        } else {
          resolve(value)
        }
      }

      let ad
      try {
        ad = wx.createRewardedVideoAd({ adUnitId })
      } catch (error) {
        finish(error, true)
        return
      }
      if (!ad || typeof ad.load !== 'function' || typeof ad.show !== 'function') {
        finish(new Error('rewarded_video_not_supported'), true)
        return
      }

      const onClose = (res) => {
        if (res && res.isEnded === false) {
          wx.showToast({ title: '广告未完整观看', icon: 'none' })
          finish(false)
          return
        }
        finish(true)
      }

      const onError = (error) => {
        finish(error || new Error('rewarded_video_failed'), true)
      }

      if (typeof ad.offClose === 'function') {
        ad.offClose(onClose)
      }
      if (typeof ad.offError === 'function') {
        ad.offError(onError)
      }
      ad.onClose(onClose)
      if (typeof ad.onError === 'function') {
        ad.onError(onError)
      }

      Promise.resolve()
        .then(() => ad.load())
        .then(() => ad.show())
        .catch((error) => {
          onError(error)
        })
    })
  },

  async grantAuthorization() {
    this.setData({ grantSubmitting: true })
    try {
      if (!String(app.globalData.sessionToken || '').trim()) {
        await this.loginMiniAppSession()
      }
      const grantDays = Math.max(1, Number(this.data.adUnlockDays || SIGNIN_REWARD_DAYS || AD_UNLOCK_DAYS || 1))
      const result = await request('/miniapp/bind-session/grant', {
        method: 'POST',
        data: {
          scene: String(this.data.sceneCode || '').trim(),
          sessionToken: String(app.globalData.sessionToken || '').trim(),
          days: grantDays
        }
      })
      const now = Date.now()
      app.globalData.lastSigninAt = now
      try {
        wx.setStorageSync('miniappLastSigninAt', now)
      } catch (_) {}
      this.applySessionView(result.session || {}, 'grant')
      wx.showToast({
        title: '签到成功',
        icon: 'success'
      })
    } catch (error) {
      const message = this.normalizeError(error)
      if (message === '今日已签到，请明天再来') {
        this.setData({
          rewardDisabled: true,
          rewardButtonText: '今日已签到',
          rewardSubtitleText: '今日已完成签到，明天可再次领取'
        })
        wx.showToast({ title: '今日已签到', icon: 'none' })
        return
      }
      this.setData({
        deviceStatusText: `授权失败：${message}`
      })
      throw error
    } finally {
      this.setData({ grantSubmitting: false })
    }
  },

  applySessionView(session, source) {
    const authorized = session.authorized === true
    const bindStatus = String(session.status || '')
    const grantedAt = Number(session.grantedAt || session.grantedAtMS || 0)
    const rewardDays = Math.max(1, Number(session.adUnlockDays || this.data.adUnlockDays || SIGNIN_REWARD_DAYS || AD_UNLOCK_DAYS || 1))
    const rewardCopy = buildRewardCopy(rewardDays)
    const cachedSigninAt = Number(app.globalData.lastSigninAt || getStoredSigninAt() || 0)
    const signedToday =
      session.signedToday === true ||
      isSameDay(grantedAt) ||
      isSameDay(cachedSigninAt)
    if (signedToday && grantedAt > 0) {
      app.globalData.lastSigninAt = grantedAt
      try {
        wx.setStorageSync('miniappLastSigninAt', grantedAt)
      } catch (_) {}
    }
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
      rewardDisabled: signedToday,
      rewardSubtitleText: signedToday
        ? '今日已完成签到，明天可再次领取'
        : rewardCopy.subtitleText,
      rewardButtonText: signedToday
        ? '今日已签到'
        : rewardCopy.buttonText,
      grantMaskText: rewardCopy.grantMaskText,
      session: {
        status: bindStatus,
        clientLabel: String(session.clientLabel || ''),
        appVersion: String(session.appVersion || ''),
        wechatNickname: String(session.wechatNickname || ''),
        authorized,
        licenseExpireAt: Number(session.licenseExpireAt || 0),
        signedToday,
        adUnlockDays: rewardDays
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
        action: '每日签到',
        time: `+${rewardDays}天`,
        date: formatDateTime(Date.now())
      })
    }
  },

  pushHistory(item) {
    const nextList = mergeHistory(this.data.history, item)
    const filteredList = nextList.filter((entry) => entry.action !== '等待连接桌面端')
    this.setData({
      history: filteredList
    })
    app.globalData.recentMiniAppActivities = filteredList
    try {
      wx.setStorageSync('recentMiniAppActivities', filteredList)
    } catch (_) {}
  },

  normalizeError(error) {
    const raw = String((error && (error.message || error.errMsg || error.errCode)) || error || '').trim()
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
      miniapp_signin_already_claimed: '今日已签到，请明天再来',
      rewarded_video_not_supported: '当前设备不支持激励视频广告',
      rewarded_video_failed: '激励视频广告加载失败，请稍后重试',
      bind_ref_required: '缺少绑定参数，请从桌面端扫码进入',
      bind_scene_invalid: '二维码无效，请回到桌面端刷新',
      bind_session_expired: '二维码已过期，请回到桌面刷新',
      bind_session_not_scanned: '客户端绑定尚未完成，请稍后重试',
      bind_session_claimed_by_other_user: '该二维码已被其他微信账号占用'
    }
    return mapping[raw] || raw || '请求失败'
  }
})





