App({
  onLaunch() {
    try {
      const lastSceneCode = wx.getStorageSync('lastSceneCode')
      if (lastSceneCode) {
        this.globalData.lastSceneCode = String(lastSceneCode)
      }
      const recentActivities = wx.getStorageSync('recentMiniAppActivities')
      if (Array.isArray(recentActivities)) {
        this.globalData.recentMiniAppActivities = recentActivities
      }
    } catch (_) {}
  },
  globalData: {
    bootstrapConfig: null,
    sessionToken: '',
    openId: '',
    unionId: '',
    sessionExpireAt: 0,
    lastSceneCode: '',
    lastBindSession: null,
    recentMiniAppActivities: []
  }
})
