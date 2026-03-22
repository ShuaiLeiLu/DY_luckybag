const DEFAULT_POOL_SERVER_URL_FALLBACK = 'http://110.40.169.26:9090'
const DEFAULT_TIMEOUT_MS = 3200
const CLIENT_ID_STORAGE_KEY = 'DY_POOL_CLIENT_ID'
const LICENSE_FP_STORAGE_KEY = 'DY_LICENSE_FINGERPRINT'
const CURRENT_ACCOUNTS_STORAGE_KEY = 'DY_CURRENT_ACCOUNTS'

/**
 * 规范化筛选服务地址（补协议、去结尾斜杠）。
 * @param {string} text 原始地址
 * @returns {string}
 */
export function normalizePoolServerUrl(text) {
  let url = String(text || '').trim().replace(/\/+$/, '')
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`
  }
  return url
}

/**
 * 判断值是否为普通对象。
 * @param {*} v 任意值
 * @returns {boolean}
 */
function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * 统一 JSON 请求封装（超时、错误格式归一）。
 * @param {string} baseUrl 服务地址
 * @param {string} path 接口路径
 * @param {{method?:string, body?:object|null, timeoutMs?:number}} options 请求选项
 * @returns {Promise<{ok:boolean,status:number,data:any,error?:string}>}
 */
async function requestJSON(baseUrl, path, { method = 'GET', body = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), Math.max(300, Number(timeoutMs) || DEFAULT_TIMEOUT_MS))
  try {
    const headers = { 'content-type': 'application/json' }
    const stableClientId = String(resolvePoolClientId() || '').trim()
    const stableFingerprint = String(resolveLicenseFingerprint() || '').trim()
    let currentAccounts = ''
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        currentAccounts = String(window.localStorage.getItem(CURRENT_ACCOUNTS_STORAGE_KEY) || '').trim()
      }
    } catch (_) {
      // ignore
    }
    if (stableClientId) headers['x-pool-client-id'] = stableClientId
    if (stableFingerprint) headers['x-license-fingerprint'] = stableFingerprint
    if (currentAccounts && Number.isFinite(Number(currentAccounts)) && Number(currentAccounts) >= 0) {
      headers['x-current-accounts'] = String(Math.floor(Number(currentAccounts)))
    }

    const res = await fetch(`${normalizePoolServerUrl(baseUrl)}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, status: res.status, data, error: data?.error || `http_${res.status}` }
    }
    return { ok: true, status: res.status, data }
  } catch (error) {
    return { ok: false, status: 0, data: null, error: error?.message || 'request_failed' }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 解析当前客户端应使用的筛选服务地址（localStorage > env > 默认值）。
 * @returns {string}
 */
export function resolvePoolServerUrl() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = normalizePoolServerUrl(window.localStorage.getItem('DY_POOL_SERVER_URL'))
      if (saved) return saved
    }
  } catch (_) {}

  const envUrl = normalizePoolServerUrl(import.meta?.env?.VITE_POOL_SERVER_URL)
  if (envUrl) return envUrl
  return DEFAULT_POOL_SERVER_URL_FALLBACK
}

/**
 * 持久化筛选服务地址到 localStorage。
 * @param {string} url 服务地址
 * @returns {string} 规范化后的地址
 */
export function persistPoolServerUrl(url) {
  const normalized = normalizePoolServerUrl(url)
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (normalized) {
        window.localStorage.setItem('DY_POOL_SERVER_URL', normalized)
      } else {
        window.localStorage.removeItem('DY_POOL_SERVER_URL')
      }
    }
  } catch (_) {}
  return normalized
}

/**
 * 获取当前客户端稳定实例ID，用于服务端任务租约隔离。
 * @returns {string}
 */
export function resolvePoolClientId() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const existing = String(window.localStorage.getItem(CLIENT_ID_STORAGE_KEY) || '').trim()
      if (existing) return existing
      const next = `client_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
      window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, next)
      return next
    }
  } catch (_) {}
  return `client_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 获取当前客户端稳定授权指纹。
 * 第一版先使用本地持久化随机指纹，避免每次重启变化。
 * @returns {string}
 */
export function resolveLicenseFingerprint() {
  try {
    const electronFingerprint = typeof window !== 'undefined'
      ? String(window.electronAPI?.machineFingerprint || '').trim()
      : ''
    if (electronFingerprint) {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(LICENSE_FP_STORAGE_KEY, electronFingerprint)
        }
      } catch (_) {}
      return electronFingerprint
    }
  } catch (_) {}

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const existing = String(window.localStorage.getItem(LICENSE_FP_STORAGE_KEY) || '').trim()
      if (existing) return existing
      const next = `fp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
      window.localStorage.setItem(LICENSE_FP_STORAGE_KEY, next)
      return next
    }
  } catch (_) {}
  return `fp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
}

/**
 * 批量上报候选福袋到服务端。
 * @param {string} baseUrl 服务地址
 * @param {string} sourceId 来源ID
 * @param {Array} candidates 候选列表
 * @param {number} timeoutMs 超时毫秒
 * @returns {Promise<object>}
 */
export async function upsertPoolCandidates(baseUrl, sourceId, candidates, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const list = Array.isArray(candidates) ? candidates : []
  if (list.length === 0) return { ok: true, data: { ok: true, accepted: 0 } }
  return requestJSON(baseUrl, '/candidate/batch-upsert', {
    method: 'POST',
    body: {
      sourceId: sourceId || 'client',
      candidates: list
    },
    timeoutMs
  })
}

/**
 * 获取服务端最优福袋池（支持 limit/filters）。
 * @param {string} baseUrl 服务地址
 * @param {number|object} limit 拉取数量或参数对象
 * @param {number} timeoutMs 超时毫秒
 * @returns {Promise<object>}
 */
export async function fetchPoolTop(baseUrl, limit = 80, timeoutMs = DEFAULT_TIMEOUT_MS) {
  let safeLimit = 80
  let safeTimeout = timeoutMs
  let filters = null
  let clientId = ''
  let accountId = ''
  let includeClaimedSelf = false

  if (typeof limit === 'object' && limit !== null) {
    safeLimit = Math.max(1, Math.min(5000, Number(limit.limit) || 80))
    safeTimeout = Number(limit.timeoutMs || DEFAULT_TIMEOUT_MS)
    filters = (limit.filters && typeof limit.filters === 'object') ? limit.filters : null
    clientId = String(limit.clientId || '').trim()
    accountId = String(limit.accountId || '').trim()
    includeClaimedSelf = limit.includeClaimedSelf === true
  } else {
    safeLimit = Math.max(1, Math.min(5000, Number(limit) || 80))
  }

  const params = new URLSearchParams()
  params.set('limit', String(safeLimit))
  if (filters) {
    Object.entries(filters).forEach(([key, rawValue]) => {
      if (rawValue === undefined || rawValue === null || rawValue === '') return
      if (typeof rawValue === 'boolean') {
        params.set(key, rawValue ? '1' : '0')
        return
      }
      const numeric = Number(rawValue)
      if (Number.isFinite(numeric)) {
        params.set(key, String(numeric))
        return
      }
      params.set(key, String(rawValue))
    })
  }
  if (clientId) params.set('clientId', clientId)
  if (accountId) params.set('accountId', accountId)
  if (includeClaimedSelf) params.set('includeClaimedSelf', '1')

  const res = await requestJSON(baseUrl, `/pool/top?${params.toString()}`, { timeoutMs: safeTimeout })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    return { ok: false, status: res.status, data: payload, error: payload?.error || 'pool_top_failed' }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 从服务端共享池领取一个执行任务。
 * @param {string} baseUrl 服务地址
 * @param {{clientId:string,accountId:string,leaseSec?:number,filters?:object,preferKeys?:string[],excludeKeys?:string[],timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function claimPoolTask(baseUrl, options = {}) {
  const body = {
    clientId: String(options.clientId || '').trim(),
    accountId: String(options.accountId || '').trim(),
    leaseSec: Math.max(10, Number(options.leaseSec || 35)),
    filters: (options.filters && typeof options.filters === 'object') ? options.filters : {},
    preferKeys: Array.isArray(options.preferKeys) ? options.preferKeys : [],
    excludeKeys: Array.isArray(options.excludeKeys) ? options.excludeKeys : []
  }
  const res = await requestJSON(baseUrl, '/task/claim', {
    method: 'POST',
    body,
    timeoutMs: Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    return { ok: false, status: res.status, data: payload, error: payload?.error || 'task_claim_failed' }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 请求服务端在 T-30/T-20 对当前预热任务重新排序并返回 keep/switch 建议。
 * @param {string} baseUrl 服务地址
 * @param {{clientId:string,accountId:string,currentCandidateKey?:string,currentRoomId?:string,filters?:object,excludeKeys?:string[],stage?:string,limit?:number,timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function reviewPoolTask(baseUrl, options = {}) {
  const body = {
    clientId: String(options.clientId || '').trim(),
    accountId: String(options.accountId || '').trim(),
    currentCandidateKey: String(options.currentCandidateKey || '').trim(),
    currentRoomId: String(options.currentRoomId || '').trim(),
    filters: (options.filters && typeof options.filters === 'object') ? options.filters : {},
    excludeKeys: Array.isArray(options.excludeKeys) ? options.excludeKeys : [],
    stage: String(options.stage || '').trim(),
    limit: Math.max(1, Math.min(12, Number(options.limit || 5)))
  }
  const res = await requestJSON(baseUrl, '/task/review', {
    method: 'POST',
    body,
    timeoutMs: Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    return { ok: false, status: res.status, data: payload, error: payload?.error || 'task_review_failed' }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 续租已领取任务。
 * @param {string} baseUrl 服务地址
 * @param {{clientId:string,accountId:string,leaseId:string,leaseSec?:number,timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function renewPoolTask(baseUrl, options = {}) {
  const res = await requestJSON(baseUrl, '/task/renew', {
    method: 'POST',
    body: {
      clientId: String(options.clientId || '').trim(),
      accountId: String(options.accountId || '').trim(),
      leaseId: String(options.leaseId || '').trim(),
      leaseSec: Math.max(10, Number(options.leaseSec || 35))
    },
    timeoutMs: Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    return { ok: false, status: res.status, data: payload, error: payload?.error || 'task_renew_failed' }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 主动释放当前任务。
 * @param {string} baseUrl 服务地址
 * @param {{clientId:string,accountId:string,leaseId:string,reason?:string,timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function releasePoolTask(baseUrl, options = {}) {
  const res = await requestJSON(baseUrl, '/task/release', {
    method: 'POST',
    body: {
      clientId: String(options.clientId || '').trim(),
      accountId: String(options.accountId || '').trim(),
      leaseId: String(options.leaseId || '').trim(),
      reason: String(options.reason || '').trim()
    },
    timeoutMs: Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    return { ok: false, status: res.status, data: payload, error: payload?.error || 'task_release_failed' }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 完成当前任务，并可选从候选池移除。
 * @param {string} baseUrl 服务地址
 * @param {{clientId:string,accountId:string,leaseId:string,result?:string,removeCandidate?:boolean,timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function finishPoolTask(baseUrl, options = {}) {
  const res = await requestJSON(baseUrl, '/task/finish', {
    method: 'POST',
    body: {
      clientId: String(options.clientId || '').trim(),
      accountId: String(options.accountId || '').trim(),
      leaseId: String(options.leaseId || '').trim(),
      result: String(options.result || '').trim(),
      removeCandidate: options.removeCandidate !== false
    },
    timeoutMs: Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    return { ok: false, status: res.status, data: payload, error: payload?.error || 'task_finish_failed' }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 上报执行反馈到服务端学习桶。
 * @param {string} baseUrl 服务地址
 * @param {{clientId?:string,accountId?:string,event:string,candidateKey?:string,roomId?:string,lotteryId?:string,lotteryName?:string,authorNickname?:string,conditions?:Array,joinTotal?:number,luckyCount?:number,onlineTotal?:number,totalAmount?:number,prizeType?:any,prizeInfo?:object,predictedProbability?:number,predictedJoinTotal?:number,remainingSec?:number,endTime?:number,startTime?:number,joinedAt?:number,rewardAmount?:number,joinMode?:string,reason?:string,extra?:object,timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function reportPoolTaskFeedback(baseUrl, options = {}) {
  const res = await requestJSON(baseUrl, '/task/feedback', {
    method: 'POST',
    body: {
      clientId: String(options.clientId || '').trim(),
      accountId: String(options.accountId || '').trim(),
      event: String(options.event || '').trim(),
      candidateKey: String(options.candidateKey || '').trim(),
      roomId: String(options.roomId || '').trim(),
      lotteryId: String(options.lotteryId || '').trim(),
      lotteryName: String(options.lotteryName || '').trim(),
      authorNickname: String(options.authorNickname || '').trim(),
      conditions: Array.isArray(options.conditions) ? options.conditions : [],
      joinTotal: Number(options.joinTotal || 0),
      luckyCount: Number(options.luckyCount || 0),
      onlineTotal: Number(options.onlineTotal || 0),
      totalAmount: Number(options.totalAmount || 0),
      prizeType: options.prizeType ?? null,
      prizeInfo: (options.prizeInfo && typeof options.prizeInfo === 'object') ? options.prizeInfo : {},
      predictedProbability: Number(options.predictedProbability || 0),
      predictedJoinTotal: Number(options.predictedJoinTotal || 0),
      remainingSec: Math.max(0, Number(options.remainingSec || 0)),
      endTime: Number(options.endTime || 0),
      startTime: Number(options.startTime || 0),
      joinedAt: Number(options.joinedAt || 0),
      rewardAmount: Number(options.rewardAmount || 0),
      joinMode: String(options.joinMode || '').trim(),
      reason: String(options.reason || '').trim(),
      extra: (options.extra && typeof options.extra === 'object') ? options.extra : {}
    },
    timeoutMs: Number(options.timeoutMs || 1800)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    return { ok: false, status: res.status, data: payload, error: payload?.error || 'task_feedback_failed' }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 拉取服务端任务调试摘要和当前租约列表。
 * @param {string} baseUrl 服务地址
 * @param {{clientId?:string,accountId?:string,filters?:object,limit?:number,timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function fetchPoolTaskDebug(baseUrl, options = {}) {
  const params = new URLSearchParams()
  params.set('limit', String(Math.max(1, Math.min(500, Number(options.limit || 50)))))
  const filters = (options.filters && typeof options.filters === 'object') ? options.filters : null
  if (filters) {
    Object.entries(filters).forEach(([key, rawValue]) => {
      if (rawValue === undefined || rawValue === null || rawValue === '') return
      if (typeof rawValue === 'boolean') {
        params.set(key, rawValue ? '1' : '0')
        return
      }
      const numeric = Number(rawValue)
      if (Number.isFinite(numeric)) {
        params.set(key, String(numeric))
        return
      }
      params.set(key, String(rawValue))
    })
  }
  const clientId = String(options.clientId || '').trim()
  const accountId = String(options.accountId || '').trim()
  if (clientId) params.set('clientId', clientId)
  if (accountId) params.set('accountId', accountId)

  const res = await requestJSON(baseUrl, `/task/debug?${params.toString()}`, {
    timeoutMs: Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    return { ok: false, status: res.status, data: payload, error: payload?.error || 'task_debug_failed' }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 拉取服务端分配的扫描分片，并顺带完成客户端心跳续约。
 * @param {string} baseUrl 服务地址
 * @param {{clientId:string,categories?:string[],timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function fetchPoolScanAssignment(baseUrl, options = {}) {
  const params = new URLSearchParams()
  params.set('clientId', String(options.clientId || '').trim())
  const categories = Array.isArray(options.categories) ? options.categories : []
  if (categories.length > 0) {
    params.set('categories', categories.map(item => String(item || '').trim()).filter(Boolean).join(','))
  }
  const telemetry = (options.telemetry && typeof options.telemetry === 'object') ? options.telemetry : null
  if (telemetry) {
    const numericKeys = ['riskLevel', 'cooldownRemainMs', 'hardRiskCount', 'busyAccounts', 'idleAccounts', 'activeScanners']
    numericKeys.forEach((key) => {
      const rawValue = Number(telemetry[key] || 0)
      if (Number.isFinite(rawValue) && rawValue > 0) {
        params.set(key, String(Math.max(0, Math.floor(rawValue))))
      }
    })
  }
  const res = await requestJSON(baseUrl, `/scan/assignment?${params.toString()}`, {
    timeoutMs: Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    return { ok: false, status: res.status, data: payload, error: payload?.error || 'scan_assignment_failed' }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 请求服务端发放一次扫描许可证，用于集群级硬限流。
 * @param {string} baseUrl 服务地址
 * @param {{clientId:string,accountId?:string,kind:string,cost?:number,timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function requestPoolScanPermit(baseUrl, options = {}) {
  const res = await requestJSON(baseUrl, '/scan/permit', {
    method: 'POST',
    body: {
      clientId: String(options.clientId || '').trim(),
      accountId: String(options.accountId || '').trim(),
      kind: String(options.kind || '').trim(),
      cost: Math.max(1, Number(options.cost || 1))
    },
    timeoutMs: Number(options.timeoutMs || 1600)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    return { ok: false, status: res.status, data: payload, error: payload?.error || 'scan_permit_failed' }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 领取共享全站 maxTime 游标。
 * @param {string} baseUrl 服务地址
 * @param {{clientId:string,accountId:string,leaseTtlMs?:number,timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function claimPoolAllScanCursor(baseUrl, options = {}) {
  const res = await requestJSON(baseUrl, '/scan/all/claim', {
    method: 'POST',
    body: {
      clientId: String(options.clientId || '').trim(),
      accountId: String(options.accountId || '').trim(),
      leaseTtlMs: Math.max(10000, Number(options.leaseTtlMs || 18000))
    },
    timeoutMs: Number(options.timeoutMs || 1800)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    return { ok: false, status: res.status, data: payload, error: payload?.error || 'all_scan_claim_failed' }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 回传共享全站 maxTime 游标的推进结果。
 * @param {string} baseUrl 服务地址
 * @param {{clientId:string,accountId:string,slotId:string,usedCursorMaxTime?:number,nextCursorMaxTime?:number,hasMore?:boolean,rawRooms?:number,hintedRooms?:number,qualifiedRooms?:number,error?:string,timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function reportPoolAllScanCursor(baseUrl, options = {}) {
  const res = await requestJSON(baseUrl, '/scan/all/report', {
    method: 'POST',
    body: {
      clientId: String(options.clientId || '').trim(),
      accountId: String(options.accountId || '').trim(),
      slotId: String(options.slotId || '').trim(),
      usedCursorMaxTime: Math.max(0, Number(options.usedCursorMaxTime || 0)),
      nextCursorMaxTime: Math.max(0, Number(options.nextCursorMaxTime || 0)),
      hasMore: options.hasMore === true,
      rawRooms: Math.max(0, Number(options.rawRooms || 0)),
      hintedRooms: Math.max(0, Number(options.hintedRooms || 0)),
      qualifiedRooms: Math.max(0, Number(options.qualifiedRooms || 0)),
      error: String(options.error || '').trim()
    },
    timeoutMs: Number(options.timeoutMs || 1800)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    return { ok: false, status: res.status, data: payload, error: payload?.error || 'all_scan_report_failed' }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 拉取当前服务端租约列表。
 * @param {string} baseUrl 服务地址
 * @param {{clientId?:string,accountId?:string,filters?:object,limit?:number,timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function fetchPoolTaskLeases(baseUrl, options = {}) {
  const params = new URLSearchParams()
  params.set('limit', String(Math.max(1, Math.min(1000, Number(options.limit || 200)))))
  const filters = (options.filters && typeof options.filters === 'object') ? options.filters : null
  if (filters) {
    Object.entries(filters).forEach(([key, rawValue]) => {
      if (rawValue === undefined || rawValue === null || rawValue === '') return
      if (typeof rawValue === 'boolean') {
        params.set(key, rawValue ? '1' : '0')
        return
      }
      const numeric = Number(rawValue)
      if (Number.isFinite(numeric)) {
        params.set(key, String(numeric))
        return
      }
      params.set(key, String(rawValue))
    })
  }
  const clientId = String(options.clientId || '').trim()
  const accountId = String(options.accountId || '').trim()
  if (clientId) params.set('clientId', clientId)
  if (accountId) params.set('accountId', accountId)

  const res = await requestJSON(baseUrl, `/task/leases?${params.toString()}`, {
    timeoutMs: Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    return { ok: false, status: res.status, data: payload, error: payload?.error || 'task_leases_failed' }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 拉取服务端学习桶调试信息。
 * @param {string} baseUrl 服务地址
 * @param {{limit?:number,timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function fetchPoolLearningDebug(baseUrl, options = {}) {
  const params = new URLSearchParams()
  params.set('limit', String(Math.max(1, Math.min(500, Number(options.limit || 120)))))
  const res = await requestJSON(baseUrl, `/learning/debug?${params.toString()}`, {
    timeoutMs: Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    return { ok: false, status: res.status, data: payload, error: payload?.error || 'learning_debug_failed' }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 获取当前客户端授权状态。
 * @param {string} baseUrl 服务地址
 * @param {{clientId?:string,fingerprint?:string,timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function fetchLicenseStatus(baseUrl, options = {}) {
  const params = new URLSearchParams()
  const clientId = String(options.clientId || '').trim()
  const fingerprint = String(options.fingerprint || '').trim()
  if (clientId) params.set('clientId', clientId)
  if (fingerprint) params.set('fingerprint', fingerprint)
  const query = params.toString()
  const res = await requestJSON(baseUrl, `/license/status${query ? `?${query}` : ''}`, {
    timeoutMs: Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    return { ok: false, status: res.status, data: payload, error: payload?.error || 'license_status_failed' }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 使用授权码激活当前客户端。
 * @param {string} baseUrl 服务地址
 * @param {{licenseKey:string,clientId?:string,fingerprint?:string,appVersion?:string,currentAccounts?:number,timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function activateLicense(baseUrl, options = {}) {
  const res = await requestJSON(baseUrl, '/license/activate', {
    method: 'POST',
    body: {
      licenseKey: String(options.licenseKey || '').trim(),
      clientId: String(options.clientId || '').trim(),
      fingerprint: String(options.fingerprint || '').trim(),
      appVersion: String(options.appVersion || '').trim(),
      currentAccounts: Math.max(0, Number(options.currentAccounts || 0))
    },
    timeoutMs: Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    return { ok: false, status: res.status, data: payload, error: payload?.error || 'license_activate_failed' }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 为当前设备开启一次性 3 天试用。
 * @param {string} baseUrl 服务地址
 * @param {{clientId?:string,fingerprint?:string,appVersion?:string,timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function startLicenseTrial(baseUrl, options = {}) {
  const res = await requestJSON(baseUrl, '/license/trial/start', {
    method: 'POST',
    body: {
      clientId: String(options.clientId || '').trim(),
      fingerprint: String(options.fingerprint || '').trim(),
      appVersion: String(options.appVersion || '').trim()
    },
    timeoutMs: Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    return { ok: false, status: res.status, data: payload, error: payload?.error || 'license_trial_start_failed' }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 创建一次性扫码绑定会话，二维码 60 秒内有效。
 * @param {string} baseUrl 服务地址
 * @param {{clientId?:string,fingerprint?:string,appVersion?:string,adUnlockDays?:number,timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function createLicenseBindSession(baseUrl, options = {}) {
  const res = await requestJSON(baseUrl, '/license/bind-session/create', {
    method: 'POST',
    body: {
      clientId: String(options.clientId || '').trim(),
      fingerprint: String(options.fingerprint || '').trim(),
      appVersion: String(options.appVersion || '').trim(),
      adUnlockDays: Math.max(0, Number(options.adUnlockDays || 0))
    },
    timeoutMs: Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    return { ok: false, status: res.status, data: payload, error: payload?.error || 'license_bind_create_failed' }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 查询一次性扫码绑定会话状态，供客户端轮询授权结果。
 * @param {string} baseUrl 服务地址
 * @param {{bindToken?:string,timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function fetchLicenseBindSessionStatus(baseUrl, options = {}) {
  const params = new URLSearchParams()
  const bindToken = String(options.bindToken || '').trim()
  if (bindToken) params.set('bindToken', bindToken)
  const query = params.toString()
  const res = await requestJSON(baseUrl, `/license/bind-session/status${query ? `?${query}` : ''}`, {
    timeoutMs: Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    return { ok: false, status: res.status, data: payload, error: payload?.error || 'license_bind_status_failed' }
  }
  return { ok: true, status: res.status, data: payload }
}
