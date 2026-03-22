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

Page({
  data: {
    topInset: 20,
    adminTab: 'overview',
    metrics: {
      total: 1284,
      active: 856,
      bound: 902,
      wechat: 744
    },
    serviceStatus: {
      license: true,
      unrestricted: false
    },
    riskItems: [
      { label: '同一用户绑定多设备异常', count: 12 },
      { label: '短时间反复解绑/重绑', count: 5 },
      { label: '频繁授权失败尝试', count: 89 }
    ],
    rewardDays: 1,
    minVersion: 'v2.1.0',
    noticeText: '端午节签到时长翻倍！',
    createDays: 30,
    createCount: 1,
    createdKeys: '',
    devices: [
      { id: 'DEV-A8F92C', user: '飞奔的蜗牛', expire: '2026-04-08', status: 'online' },
      { id: 'DEV-B38E11', user: 'Lucky_星', expire: '2026-04-01', status: 'online' },
      { id: 'DEV-F922XX', user: '匿名用户', expire: '已过期', status: 'offline' }
    ],
    logs: [
      { id: 1, action: '每日签到', target: 'DEV-A8F9...', time: '刚刚', type: 'signin', typeLabel: '签到' },
      { id: 2, action: '新设备绑定', target: 'DEV-X199...', time: '3分钟前', type: 'bind', typeLabel: '绑定' },
      { id: 3, action: '授权校验', target: 'DEV-B38E...', time: '10分钟前', type: 'verify', typeLabel: '校验' }
    ]
  },

  onLoad() {
    this.setData({ topInset: getTopInset() })
  },

  switchTab(event) {
    const tab = String(event.currentTarget.dataset.tab || 'overview')
    this.setData({ adminTab: tab })
  },

  toggleUnrestricted(event) {
    this.setData({
      serviceStatus: {
        ...this.data.serviceStatus,
        unrestricted: event.detail.value
      }
    })
  },

  onRewardInput(event) {
    this.setData({ rewardDays: Number(event.detail.value || 1) })
  },

  onMinVersionInput(event) {
    this.setData({ minVersion: String(event.detail.value || '') })
  },

  onNoticeInput(event) {
    this.setData({ noticeText: String(event.detail.value || '') })
  },

  onDaysInput(event) {
    this.setData({ createDays: Number(event.detail.value || 0) })
  },

  onCountInput(event) {
    this.setData({ createCount: Number(event.detail.value || 0) })
  },

  mockCreate() {
    const days = this.data.createDays || 30
    const count = this.data.createCount || 1
    const keys = Array.from({ length: count }).map(() => `DY-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`)
    this.setData({
      createdKeys: keys.join('\n') || `DY-DEMO-${Date.now()}`,
      metrics: {
        ...this.data.metrics,
        total: this.data.metrics.total + keys.length
      }
    })
  }
})
