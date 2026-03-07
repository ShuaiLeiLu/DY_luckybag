const DEFAULT_POOL_SERVER_URL = 'http://110.40.169.26:9090'
const DEFAULT_TIMEOUT_MS = 3200

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
    const res = await fetch(`${normalizePoolServerUrl(baseUrl)}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
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
  return DEFAULT_POOL_SERVER_URL
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

  if (typeof limit === 'object' && limit !== null) {
    safeLimit = Math.max(1, Math.min(5000, Number(limit.limit) || 80))
    safeTimeout = Number(limit.timeoutMs || DEFAULT_TIMEOUT_MS)
    filters = (limit.filters && typeof limit.filters === 'object') ? limit.filters : null
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

  const res = await requestJSON(baseUrl, `/pool/top?${params.toString()}`, { timeoutMs: safeTimeout })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    return { ok: false, status: res.status, data: payload, error: payload?.error || 'pool_top_failed' }
  }
  return { ok: true, status: res.status, data: payload }
}
