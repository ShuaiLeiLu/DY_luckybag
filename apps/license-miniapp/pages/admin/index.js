const { BASE_URL } = require('../../config')

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

function trimText(value) {
  return String(value || '').trim()
}

function formatDateTime(ms) {
  const ts = Number(ms || 0)
  if (!ts) return '-'
  const date = new Date(ts)
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  const hh = `${date.getHours()}`.padStart(2, '0')
  const mm = `${date.getMinutes()}`.padStart(2, '0')
  return `${y}-${m}-${d} ${hh}:${mm}`
}

function buildUrl(path, query) {
  const base = trimText(BASE_URL).replace(/\/+$/, '')
  const url = `${base}${path}`
  const params = []
  Object.keys(query || {}).forEach((key) => {
    const value = query[key]
    if (value === undefined || value === null || value === '') return
    params.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  })
  return params.length ? `${url}?${params.join('&')}` : url
}

function toInt(value, fallback) {
  const num = Number(value)
  return Number.isFinite(num) ? Math.floor(num) : fallback
}

function getTokenFromStorage() {
  try {
    return trimText(wx.getStorageSync('licenseAdminToken'))
  } catch (_) {
    return ''
  }
}

function normalizeStatus(status) {
  const value = trimText(status)
  return value || ''
}

function getStatusLabel(status) {
  switch (normalizeStatus(status)) {
    case 'active':
      return '启用'
    case 'disabled':
      return '停用'
    case 'expired':
      return '过期'
    default:
      return '未知'
  }
}

function getStatusTone(status) {
  switch (normalizeStatus(status)) {
    case 'active':
      return 'ok'
    case 'disabled':
    case 'expired':
      return 'off'
    default:
      return 'info'
  }
}

function formatFeatureCount(features) {
  if (!features || typeof features !== 'object') return '0'
  return String(Object.keys(features).length)
}

function calculateMetrics(items) {
  const list = Array.isArray(items) ? items : []
  return {
    total: list.length,
    active: list.filter((item) => normalizeStatus(item.status) === 'active').length,
    bound: list.filter((item) => trimText(item.bindClientId)).length,
    wechat: list.filter((item) => trimText(item.wechatOpenId)).length
  }
}

function normalizeLicenseItem(item) {
  const id = Number(item && item.id ? item.id : 0)
  const status = normalizeStatus(item && item.status)
  return {
    id: id,
    licenseKey: trimText(item && item.licenseKey),
    customerName: trimText(item && item.customerName) || '未命名客户',
    planName: trimText(item && item.planName) || '默认方案',
    status: status,
    statusLabel: getStatusLabel(status),
    statusTone: getStatusTone(status),
    expireAt: Number(item && item.expireAt ? item.expireAt : 0),
    expireAtText: formatDateTime(item && item.expireAt),
    maxClients: toInt(item && item.maxClients, 0),
    maxAccounts: toInt(item && item.maxAccounts, 0),
    featureCount: formatFeatureCount(item && item.features),
    bindClientId: trimText(item && item.bindClientId),
    bindClientIdText: trimText(item && item.bindClientId) || '-',
    bindFingerprint: trimText(item && item.bindFingerprint),
    bindFingerprintText: trimText(item && item.bindFingerprint) || '-',
    wechatOpenId: trimText(item && item.wechatOpenId),
    wechatOpenIdText: trimText(item && item.wechatOpenId) || '-',
    wechatNickname: trimText(item && item.wechatNickname),
    wechatNicknameText: trimText(item && item.wechatNickname) || '-',
    activationCount: toInt(item && item.activationCount, 0),
    lastSeenAt: Number(item && item.lastSeenAt ? item.lastSeenAt : 0),
    lastSeenAtText: formatDateTime(item && item.lastSeenAt),
    createdAt: Number(item && item.createdAt ? item.createdAt : 0),
    createdAtText: formatDateTime(item && item.createdAt),
    updatedAt: Number(item && item.updatedAt ? item.updatedAt : 0),
    updatedAtText: formatDateTime(item && item.updatedAt),
    enableActionKey: `status:${id}:active`,
    disableActionKey: `status:${id}:disabled`,
    extendActionKey: `extend:${id}`,
    unbindActionKey: `unbind:${id}`,
    deleteActionKey: `delete:${id}`
  }
}

function cloneServiceStatus(serviceStatus) {
  return {
    license: Boolean(serviceStatus && serviceStatus.license),
    unrestricted: Boolean(serviceStatus && serviceStatus.unrestricted),
    loading: Boolean(serviceStatus && serviceStatus.loading)
  }
}

function getStatusLabelFromValue(value) {
  const map = {
    '': '全部',
    active: '启用',
    disabled: '停用',
    expired: '过期'
  }
  const key = trimText(value)
  return map.hasOwnProperty(key) ? map[key] : '全部'
}

Page({
  data: {
    topInset: 20,
    adminTab: 'overview',
    adminToken: '',
    savingToken: false,
    loadingSettings: false,
    loadingLicenses: false,
    submitting: false,
    refreshing: false,
    busyActionKey: '',
    metrics: {
      total: 0,
      active: 0,
      bound: 0,
      wechat: 0
    },
    serviceStatus: {
      license: false,
      unrestricted: false,
      loading: false
    },
    query: {
      keyword: '',
      status: ''
    },
    statusLabel: '全部',
    statusOptions: [
      { label: '全部', value: '' },
      { label: '启用', value: 'active' },
      { label: '停用', value: 'disabled' },
      { label: '过期', value: 'expired' }
    ],
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
    licenses: [],
    createdKeys: '',
    createDays: 30,
    createQuantity: 1,
    summaryText: '正在加载管理数据...',
    errorText: '',
    lastUpdatedText: '-'
  },

  onLoad() {
    const savedToken = getTokenFromStorage()
    this.setData({
      topInset: getTopInset(),
      adminToken: savedToken,
      statusLabel: getStatusLabelFromValue(this.data.query.status)
    })
    this.refreshAll()
  },

  onShow() {
    const savedToken = getTokenFromStorage()
    if (savedToken && savedToken !== this.data.adminToken) {
      this.setData({ adminToken: savedToken })
    }
  },

  syncTokenToStorage(token) {
    const nextToken = trimText(token)
    try {
      wx.setStorageSync('licenseAdminToken', nextToken)
    } catch (_) {}
    return nextToken
  },

  async adminRequest(path, options) {
    const config = options || {}
    const token = trimText(this.data.adminToken || getTokenFromStorage())
    const headers = {
      'content-type': 'application/json'
    }
    if (token) {
      headers['x-admin-token'] = token
    }
    return new Promise((resolve, reject) => {
      wx.request({
        url: buildUrl(path, config.query),
        method: config.method || 'GET',
        data: config.data || {},
        timeout: Number(config.timeout || 12000),
        header: headers,
        success(res) {
          const payload = res.data || {}
          if (payload.ok !== true) {
            reject(new Error(String(payload.error || payload.message || 'request_failed')))
            return
          }
          resolve(payload)
        },
        fail(err) {
          reject(err)
        }
      })
    })
  },

  normalizeError(error) {
    const raw = trimText((error && error.message) || error)
    const mapping = {
      admin_not_configured: '后台管理员未配置',
      admin_unauthorized: '管理员令牌无效',
      license_service_unavailable: '授权服务不可用',
      license_settings_failed: '读取系统配置失败',
      license_settings_update_failed: '更新系统配置失败',
      license_not_found: '授权记录不存在',
      method_not_allowed: '请求方法不允许'
    }
    return mapping[raw] || raw || '请求失败'
  },

  showToast(title, icon) {
    wx.showToast({
      title: title || '操作完成',
      icon: icon || 'none'
    })
  },

  switchTab(event) {
    const tab = String(event.currentTarget.dataset.tab || 'overview')
    this.setData({ adminTab: tab })
  },

  onTokenInput(event) {
    this.setData({ adminToken: trimText(event.detail.value) })
  },

  onTokenBlur() {
    const token = this.syncTokenToStorage(this.data.adminToken)
    this.setData({ adminToken: token })
  },

  saveToken() {
    const token = this.syncTokenToStorage(this.data.adminToken)
    this.setData({
      adminToken: token,
      savingToken: false
    })
    if (!token) {
      this.showToast('管理员令牌已清空')
      return
    }
    this.showToast('管理员令牌已保存', 'success')
    this.refreshAll()
  },

  clearToken() {
    this.setData({ adminToken: '' })
    this.syncTokenToStorage('')
    this.showToast('管理员令牌已清空')
  },

  async refreshAll() {
    this.setData({
      refreshing: true,
      errorText: '',
      summaryText: '正在刷新管理数据...'
    })
    try {
      await Promise.all([
        this.loadSettings(true),
        this.loadLicenses(true)
      ])
      this.setData({
        summaryText: '管理数据已更新',
        lastUpdatedText: formatDateTime(Date.now())
      })
    } finally {
      this.setData({ refreshing: false })
    }
  },

  async loadSettings(silent) {
    this.setData({
      loadingSettings: true,
      serviceStatus: cloneServiceStatus({
        license: this.data.serviceStatus.license,
        unrestricted: this.data.serviceStatus.unrestricted,
        loading: true
      })
    })
    try {
      const result = await this.adminRequest('/admin/api/license-settings')
      const data = result.result || {}
      this.setData({
        serviceStatus: cloneServiceStatus({
          license: true,
          unrestricted: data.unrestricted === true,
          loading: false
        })
      })
    } catch (error) {
      const message = this.normalizeError(error)
      this.setData({
        serviceStatus: cloneServiceStatus({
          license: false,
          unrestricted: false,
          loading: false
        }),
        errorText: message,
        summaryText: '系统配置读取失败'
      })
      if (!silent) {
        this.showToast(message)
      }
    } finally {
      this.setData({ loadingSettings: false })
    }
  },

  async loadLicenses(silent) {
    this.setData({ loadingLicenses: true })
    try {
      const query = this.data.query || {}
      const page = Math.max(1, toInt(this.data.page, 1))
      const pageSize = Math.max(1, toInt(this.data.pageSize, 20))
      const result = await this.adminRequest('/admin/api/licenses', {
        query: {
          page: page,
          pageSize: pageSize,
          keyword: trimText(query.keyword),
          status: trimText(query.status)
        }
      })
      const payload = result.result || {}
      const items = Array.isArray(payload.items) ? payload.items.map(normalizeLicenseItem) : []
      const total = toInt(payload.total, items.length)
      const nextPage = toInt(payload.page, page)
      const nextPageSize = toInt(payload.pageSize, pageSize)
      const metrics = calculateMetrics(items)
      const totalPages = Math.max(1, Math.ceil(total / nextPageSize))
      this.setData({
        licenses: items,
        total: total,
        page: nextPage,
        pageSize: nextPageSize,
        totalPages: totalPages,
        metrics: metrics,
        summaryText: `当前已加载 ${items.length} 条授权记录`,
        errorText: ''
      })
    } catch (error) {
      const message = this.normalizeError(error)
      this.setData({
        errorText: message,
        summaryText: '授权池列表加载失败'
      })
      if (!silent) {
        this.showToast(message)
      }
    } finally {
      this.setData({ loadingLicenses: false })
    }
  },

  applyFilter() {
    this.setData({ page: 1 })
    this.loadLicenses(false)
  },

  clearFilter() {
    this.setData({
      query: {
        keyword: '',
        status: ''
      },
      statusLabel: '全部',
      page: 1
    })
    this.loadLicenses(false)
  },

  onKeywordInput(event) {
    this.setData({
      query: {
        ...this.data.query,
        keyword: trimText(event.detail.value)
      }
    })
  },

  onKeywordConfirm() {
    this.applyFilter()
  },

  onStatusPick(event) {
    const index = toInt(event.detail.value, 0)
    const item = this.data.statusOptions[index] || this.data.statusOptions[0]
    this.setData({
      query: {
        ...this.data.query,
        status: trimText(item.value)
      },
      statusLabel: trimText(item.label) || '全部'
    })
    this.applyFilter()
  },

  prevPage() {
    if (this.data.page <= 1) return
    this.setData({ page: this.data.page - 1 })
    this.loadLicenses(false)
  },

  nextPage() {
    if (this.data.page >= this.data.totalPages) return
    this.setData({ page: this.data.page + 1 })
    this.loadLicenses(false)
  },

  async toggleUnrestricted(event) {
    const nextValue = event.detail.value === true
    const previous = Boolean(this.data.serviceStatus.unrestricted)
    this.setData({
      serviceStatus: cloneServiceStatus({
        license: this.data.serviceStatus.license,
        unrestricted: nextValue,
        loading: true
      })
    })
    try {
      const result = await this.adminRequest('/admin/api/license-settings', {
        method: 'POST',
        data: {
          unrestricted: nextValue
        }
      })
      const payload = result.result || {}
      this.setData({
        serviceStatus: cloneServiceStatus({
          license: true,
          unrestricted: payload.unrestricted === true,
          loading: false
        }),
        summaryText: nextValue ? '免授权已开启' : '免授权已关闭',
        lastUpdatedText: formatDateTime(Date.now())
      })
      this.showToast(nextValue ? '已开启免授权' : '已关闭免授权', 'success')
    } catch (error) {
      this.setData({
        serviceStatus: cloneServiceStatus({
          license: this.data.serviceStatus.license,
          unrestricted: previous,
          loading: false
        })
      })
      this.showToast(this.normalizeError(error))
    }
  },

  onCreateDaysInput(event) {
    this.setData({ createDays: toInt(event.detail.value, 30) })
  },

  onCreateQuantityInput(event) {
    this.setData({ createQuantity: toInt(event.detail.value, 1) })
  },

  async createLicenses() {
    const days = Math.max(1, toInt(this.data.createDays, 30))
    const quantity = Math.max(1, toInt(this.data.createQuantity, 1))
    this.setData({ submitting: true })
    try {
      const result = await this.adminRequest('/admin/api/licenses/create', {
        method: 'POST',
        data: {
          days: days,
          quantity: quantity
        }
      })
      const payload = result.result || {}
      const keys = Array.isArray(payload.keys) ? payload.keys : []
      this.setData({
        createdKeys: keys.length ? keys.join('\n') : '未返回授权码',
        summaryText: `已创建 ${toInt(payload.count, keys.length)} 个授权`,
        lastUpdatedText: formatDateTime(Date.now())
      })
      this.showToast(`创建成功：${toInt(payload.count, keys.length)} 个`, 'success')
      await this.loadLicenses(true)
    } catch (error) {
      this.showToast(`创建失败：${this.normalizeError(error)}`)
    } finally {
      this.setData({ submitting: false })
    }
  },

  async setLicenseStatus(item, status) {
    const id = Number(item && item.id)
    if (!id) return
    const actionKey = `status:${id}:${status}`
    this.setData({ busyActionKey: actionKey })
    try {
      await this.adminRequest('/admin/api/licenses/status', {
        method: 'POST',
        data: {
          id: id,
          status: status
        }
      })
      this.showToast(`状态已更新为 ${getStatusLabel(status)}`, 'success')
      await this.loadLicenses(true)
    } catch (error) {
      this.showToast(`状态更新失败：${this.normalizeError(error)}`)
    } finally {
      this.setData({ busyActionKey: '' })
    }
  },

  async extendLicense(item) {
    const id = Number(item && item.id)
    if (!id) return
    const actionKey = `extend:${id}`
    this.setData({ busyActionKey: actionKey })
    try {
      await this.adminRequest('/admin/api/licenses/extend', {
        method: 'POST',
        data: {
          id: id,
          days: 30
        }
      })
      this.showToast('续期成功：+30天', 'success')
      await this.loadLicenses(true)
    } catch (error) {
      this.showToast(`续期失败：${this.normalizeError(error)}`)
    } finally {
      this.setData({ busyActionKey: '' })
    }
  },

  async unbindLicense(item) {
    const id = Number(item && item.id)
    if (!id) return
    const actionKey = `unbind:${id}`
    this.setData({ busyActionKey: actionKey })
    try {
      await this.adminRequest('/admin/api/licenses/unbind', {
        method: 'POST',
        data: {
          id: id
        }
      })
      this.showToast('解绑成功', 'success')
      await this.loadLicenses(true)
    } catch (error) {
      this.showToast(`解绑失败：${this.normalizeError(error)}`)
    } finally {
      this.setData({ busyActionKey: '' })
    }
  },

  async deleteLicense(item) {
    const id = Number(item && item.id)
    if (!id) return
    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: '确认删除',
        content: '删除后将无法恢复，是否继续？',
        confirmColor: '#ef4444',
        success(res) {
          resolve(Boolean(res.confirm))
        },
        fail() {
          resolve(false)
        }
      })
    })
    if (!confirmed) return
    const actionKey = `delete:${id}`
    this.setData({ busyActionKey: actionKey })
    try {
      await this.adminRequest('/admin/api/licenses/delete', {
        method: 'POST',
        data: {
          id: id
        }
      })
      this.showToast('删除成功', 'success')
      await this.loadLicenses(true)
    } catch (error) {
      this.showToast(`删除失败：${this.normalizeError(error)}`)
    } finally {
      this.setData({ busyActionKey: '' })
    }
  },

  openActionMenu(event) {
    const action = String(event.currentTarget.dataset.action || '')
    const id = Number(event.currentTarget.dataset.id || 0)
    const item = (this.data.licenses || []).find((entry) => Number(entry.id) === id)
    if (!item) return
    if (action === 'enable') {
      this.setLicenseStatus(item, 'active')
      return
    }
    if (action === 'disable') {
      this.setLicenseStatus(item, 'disabled')
      return
    }
    if (action === 'extend') {
      this.extendLicense(item)
      return
    }
    if (action === 'unbind') {
      this.unbindLicense(item)
      return
    }
    if (action === 'delete') {
      this.deleteLicense(item)
    }
  }
})

