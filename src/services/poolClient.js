const DEFAULT_POOL_SERVER_URL = 'http://127.0.0.1:9090'
const DEFAULT_TIMEOUT_MS = 3200

export function normalizePoolServerUrl(text) {
  let url = String(text || '').trim().replace(/\/+$/, '')
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`
  }
  return url
}

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v)
}

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

export async function fetchPoolTop(baseUrl, limit = 80, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 80))
  const res = await requestJSON(baseUrl, `/pool/top?limit=${safeLimit}`, { timeoutMs })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    return { ok: false, status: res.status, data: payload, error: payload?.error || 'pool_top_failed' }
  }
  return { ok: true, status: res.status, data: payload }
}
