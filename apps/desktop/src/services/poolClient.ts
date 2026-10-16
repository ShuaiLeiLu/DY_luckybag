export const FIXED_POOL_SERVER_URL = 'http://127.0.0.1:9090'
let configuredPoolServerUrl = FIXED_POOL_SERVER_URL
let configuredPoolToken = ''
export function persistPoolServerToken(token: string) { configuredPoolToken = String(token || '').trim() }
const DEFAULT_TIMEOUT_MS = 3200
const CLIENT_ID_STORAGE_KEY = 'DY_POOL_CLIENT_ID'

type PoolFilters = Record<string, unknown>
type PoolOptions = Record<string, any>
type PoolClientResponse<T = unknown> = {
  ok: boolean
  status: number
  data: T
  error?: string
}

interface RequestJSONOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown | null
  timeoutMs?: number
}

type PoolTelemetry = {
  riskLevel?: number
  cooldownRemainMs?: number
  hardRiskCount?: number
  busyAccounts?: number
  idleAccounts?: number
  activeScanners?: number
}

function toStringValue(value: unknown) {
  return String(value ?? '').trim()
}

function toFiniteNumber(value: unknown, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function appendFilters(params: URLSearchParams, filters: PoolFilters | null | undefined) {
  if (!filters) return
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

function notifyPayloadError(payload: Record<string, unknown>, fallback: string) {
  return toStringValue(payload.error ?? fallback) || fallback
}

function getOptionValue(options: PoolOptions | null | undefined, key: string) {
  return options ? options[key] : undefined
}

function getStringOption(options: PoolOptions | null | undefined, key: string, fallback = '') {
  return toStringValue(getOptionValue(options, key) ?? fallback)
}

function getNumberOption(options: PoolOptions | null | undefined, key: string, fallback = 0) {
  return toFiniteNumber(getOptionValue(options, key), fallback)
}

function getBooleanOption(options: PoolOptions | null | undefined, key: string) {
  return getOptionValue(options, key) === true
}

function getArrayOption<T = unknown>(options: PoolOptions | null | undefined, key: string): T[] {
  const value = getOptionValue(options, key)
  return Array.isArray(value) ? (value as T[]) : []
}

function getRecordOption<T extends Record<string, unknown> = PoolFilters>(options: PoolOptions | null | undefined, key: string): T | null {
  const value = getOptionValue(options, key)
  return ensureObjectRecord<T>(value)
}

type PoolPayload = Record<string, unknown>

type OptionAccessor = {
  str: (key: string, fallback?: string) => string
  num: (key: string, fallback?: number) => number
  bool: (key: string) => boolean
  arr: <T = unknown>(key: string) => T[]
  record: <T extends Record<string, unknown> = PoolFilters>(key: string) => T | null
}

function createOptionAccessor(options: PoolOptions | null | undefined): OptionAccessor {
  const normalized = options ?? {}
  return {
    str: (key, fallback = '') => getStringOption(normalized, key, fallback),
    num: (key, fallback = 0) => getNumberOption(normalized, key, fallback),
    bool: (key) => getBooleanOption(normalized, key),
    arr: (key) => getArrayOption(normalized, key),
    record: (key) => getRecordOption(normalized, key)
  }
}

/**
 * 规范化筛选服务地址（补协议、去结尾斜杠）。
 */
export function normalizePoolServerUrl(text: string = '') {
  let url = text.trim().replace(/\/+$/, '')
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
function isObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function ensureObjectRecord<T extends Record<string, unknown>>(value: unknown): T | null {
  if (isObject(value)) {
    return value as T
  }
  return null
}

/**
 * 统一 JSON 请求封装（超时、错误格式归一）。
 * @param baseUrl 服务地址
 * @param path 接口路径
 * @param options 请求选项
 * @returns Promise
 */
async function requestJSON(
  baseUrl: string,
  path: string,
  { method = 'GET', body = null, timeoutMs = DEFAULT_TIMEOUT_MS }: RequestJSONOptions = {}
): Promise<PoolClientResponse<PoolPayload | null>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), Math.max(300, Number(timeoutMs) || DEFAULT_TIMEOUT_MS))
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    const stableClientId = toStringValue(resolvePoolClientId())
    if (stableClientId) headers['x-pool-client-id'] = stableClientId
    if (configuredPoolToken) headers['authorization'] = 'Bearer ' + configuredPoolToken

    const res = await fetch(`${normalizePoolServerUrl(baseUrl)}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    })
    const responseData = await res.json().catch(() => ({})) as unknown
    const payload: PoolPayload = ensureObjectRecord(responseData) ?? {}
    if (!res.ok) {
      const errorReason = toStringValue(payload.error ?? `http_${res.status}`)
      return { ok: false, status: res.status, data: payload, error: errorReason || `http_${res.status}` }
    }
    return { ok: true, status: res.status, data: payload }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error || 'request_failed')
    return { ok: false, status: 0, data: null, error: errorMessage }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 解析当前客户端应使用的筛选服务地址。
 * 未配置时回退到内置本地地址。
 * @returns {string}
 */
export function resolvePoolServerUrl() {
  const normalized = normalizePoolServerUrl(configuredPoolServerUrl)
  return normalized || normalizePoolServerUrl(FIXED_POOL_SERVER_URL)
}

/**
 * 更新当前运行时使用的服务端地址。
 * @param {string} url 服务地址
 * @returns {string} 规范化后的地址
 */
export function persistPoolServerUrl(url: string) {
  const normalized = normalizePoolServerUrl(url)
  configuredPoolServerUrl = normalized || FIXED_POOL_SERVER_URL
  return resolvePoolServerUrl()
}

/**
 * 获取当前客户端稳定实例ID，用于服务端任务租约隔离。
 * @returns {string}
 */
export function resolvePoolClientId() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const existing = toStringValue(window.localStorage.getItem(CLIENT_ID_STORAGE_KEY))
      if (existing) return existing
      const next = `client_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
      window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, next)
      return next
    }
  } catch (_) {}
  return `client_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 批量上报候选福袋到服务端。
 * @param {string} baseUrl 服务地址
 * @param {string} sourceId 来源ID
 * @param {Array} candidates 候选列表
 * @param {number|object} timeoutOrOptions 超时毫秒或扩展参数
 * @returns {Promise<object>}
 */
export async function upsertPoolCandidates(
  baseUrl: string,
  sourceId: string,
  candidates: unknown,
  timeoutOrOptions: number | PoolOptions = DEFAULT_TIMEOUT_MS
): Promise<PoolClientResponse> {
  const list = Array.isArray(candidates) ? candidates : []
  if (list.length === 0) return { ok: true, data: { ok: true, accepted: 0 }, status: 0 }
  const optionsObject = (timeoutOrOptions && typeof timeoutOrOptions === 'object')
    ? (timeoutOrOptions as PoolOptions)
    : null
  const accessor = createOptionAccessor(optionsObject)
  const timeoutMs = Number.isFinite(Number(timeoutOrOptions)) && typeof timeoutOrOptions === 'number'
    ? Number(timeoutOrOptions)
    : accessor.num('timeoutMs', DEFAULT_TIMEOUT_MS)
  const filters = accessor.record('filters')
  const claimTask = accessor.bool('claimTask')
  const clientId = accessor.str('clientId')
  const accountId = accessor.str('accountId')
  const leaseSec = clampInt(accessor.num('leaseSec', 35), 10, Number.MAX_SAFE_INTEGER)
  const topLimit = clampInt(accessor.num('topLimit', 5), 1, 20)
  const preferKeys = accessor.arr<string>('preferKeys')
  const excludeKeys = accessor.arr<string>('excludeKeys')

  const body: PoolPayload = {
    sourceId: sourceId || 'client',
    candidates: list,
    topLimit
  }
  if (filters) body.filters = filters
  if (claimTask) body.claimTask = true
  if (clientId) body.clientId = clientId
  if (accountId) body.accountId = accountId
  if (claimTask) body.leaseSec = leaseSec
  if (preferKeys.length > 0) body.preferKeys = preferKeys
  if (excludeKeys.length > 0) body.excludeKeys = excludeKeys

  return requestJSON(baseUrl, '/candidate/batch-upsert', {
    method: 'POST',
    body,
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
export async function fetchPoolTop(
  baseUrl: string,
  limit: number | PoolOptions = 80,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<PoolClientResponse> {
  const limitOptions = (typeof limit === 'object' && limit !== null)
    ? (limit as PoolOptions)
    : null
  const accessor = createOptionAccessor(limitOptions)
  const rawLimit = typeof limit === 'number'
    ? clampInt(limit, 1, 5000)
    : clampInt(accessor.num('limit', 80), 1, 5000)
  const safeLimit = rawLimit
  const safeTimeout = accessor.num('timeoutMs', timeoutMs)
  const filters = accessor.record('filters')
  const clientId = accessor.str('clientId')
  const accountId = accessor.str('accountId')
  const includeClaimedSelf = accessor.bool('includeClaimedSelf')

  const params = new URLSearchParams()
  params.set('limit', String(safeLimit))
  appendFilters(params, filters)
  if (clientId) params.set('clientId', clientId)
  if (accountId) params.set('accountId', accountId)
  if (includeClaimedSelf) params.set('includeClaimedSelf', '1')

  const res = await requestJSON(baseUrl, `/pool/top?${params.toString()}`, { timeoutMs: safeTimeout })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    const errorMessage = notifyPayloadError(payload, 'pool_top_failed')
    return { ok: false, status: res.status, data: payload, error: errorMessage }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 从服务端共享池领取一个执行任务。
 * @param {string} baseUrl 服务地址
 * @param {{clientId:string,accountId:string,leaseSec?:number,filters?:object,preferKeys?:string[],excludeKeys?:string[],timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function claimPoolTask(baseUrl: string, options: PoolOptions = {}): Promise<PoolClientResponse> {
  const accessor = createOptionAccessor(options)
  const body: Record<string, unknown> = {
    clientId: accessor.str('clientId'),
    accountId: accessor.str('accountId'),
    leaseSec: clampInt(accessor.num('leaseSec', 35), 10, Number.MAX_SAFE_INTEGER),
    filters: accessor.record('filters') ?? {},
    preferKeys: accessor.arr<string>('preferKeys'),
    excludeKeys: accessor.arr<string>('excludeKeys')
  }
  const res = await requestJSON(baseUrl, '/task/claim', {
    method: 'POST',
    body,
    timeoutMs: accessor.num('timeoutMs', DEFAULT_TIMEOUT_MS)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    const errorMessage = notifyPayloadError(payload, 'task_claim_failed')
    return { ok: false, status: res.status, data: payload, error: errorMessage }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 续租已领取任务。
 * @param {string} baseUrl 服务地址
 * @param {{clientId:string,accountId:string,leaseId:string,leaseSec?:number,timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function renewPoolTask(baseUrl: string, options: PoolOptions = {}): Promise<PoolClientResponse> {
  const accessor = createOptionAccessor(options)
  const res = await requestJSON(baseUrl, '/task/renew', {
    method: 'POST',
    body: {
      clientId: accessor.str('clientId'),
      accountId: accessor.str('accountId'),
      leaseId: accessor.str('leaseId'),
      leaseSec: clampInt(accessor.num('leaseSec', 35), 10, Number.MAX_SAFE_INTEGER)
    },
    timeoutMs: accessor.num('timeoutMs', DEFAULT_TIMEOUT_MS)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    const errorMessage = notifyPayloadError(payload, 'task_renew_failed')
    return { ok: false, status: res.status, data: payload, error: errorMessage }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 主动释放当前任务。
 * @param {string} baseUrl 服务地址
 * @param {{clientId:string,accountId:string,leaseId:string,reason?:string,timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function releasePoolTask(baseUrl: string, options: PoolOptions = {}): Promise<PoolClientResponse> {
  const accessor = createOptionAccessor(options)
  const res = await requestJSON(baseUrl, '/task/release', {
    method: 'POST',
    body: {
      clientId: accessor.str('clientId'),
      accountId: accessor.str('accountId'),
      leaseId: accessor.str('leaseId'),
      reason: accessor.str('reason')
    },
    timeoutMs: accessor.num('timeoutMs', DEFAULT_TIMEOUT_MS)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    const errorMessage = notifyPayloadError(payload, 'task_release_failed')
    return { ok: false, status: res.status, data: payload, error: errorMessage }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 完成当前任务，并可选从候选池移除。
 * @param {string} baseUrl 服务地址
 * @param {{clientId:string,accountId:string,leaseId:string,result?:string,removeCandidate?:boolean,timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function finishPoolTask(baseUrl: string, options: PoolOptions = {}): Promise<PoolClientResponse> {
  const accessor = createOptionAccessor(options)
  const res = await requestJSON(baseUrl, '/task/finish', {
    method: 'POST',
    body: {
      clientId: accessor.str('clientId'),
      accountId: accessor.str('accountId'),
      leaseId: accessor.str('leaseId'),
      result: accessor.str('result'),
      removeCandidate: getOptionValue(options, 'removeCandidate') === false ? false : true
    },
    timeoutMs: accessor.num('timeoutMs', DEFAULT_TIMEOUT_MS)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    const errorMessage = notifyPayloadError(payload, 'task_finish_failed')
    return { ok: false, status: res.status, data: payload, error: errorMessage }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 上报执行反馈到服务端学习桶。
 * @param {string} baseUrl 服务地址
 * @param {{clientId?:string,accountId?:string,event:string,candidateKey?:string,roomId?:string,lotteryId?:string,lotteryName?:string,authorNickname?:string,conditions?:Array,joinTotal?:number,luckyCount?:number,onlineTotal?:number,totalAmount?:number,prizeType?:any,prizeInfo?:object,predictedProbability?:number,predictedJoinTotal?:number,remainingSec?:number,endTime?:number,startTime?:number,joinedAt?:number,rewardAmount?:number,joinMode?:string,reason?:string,extra?:object,timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function reportPoolTaskFeedback(baseUrl: string, options: PoolOptions = {}): Promise<PoolClientResponse> {
  const accessor = createOptionAccessor(options)
  const res = await requestJSON(baseUrl, '/task/feedback', {
    method: 'POST',
    body: {
      eventId: accessor.str('eventId'),
      clientId: accessor.str('clientId'),
      accountId: accessor.str('accountId'),
      event: accessor.str('event'),
      candidateKey: accessor.str('candidateKey'),
      roomId: accessor.str('roomId'),
      lotteryId: accessor.str('lotteryId'),
      lotteryName: accessor.str('lotteryName'),
      authorNickname: accessor.str('authorNickname'),
      conditions: accessor.arr('conditions'),
      joinTotal: accessor.num('joinTotal', 0),
      luckyCount: accessor.num('luckyCount', 0),
      onlineTotal: accessor.num('onlineTotal', 0),
      totalAmount: accessor.num('totalAmount', 0),
      prizeType: getOptionValue(options, 'prizeType') ?? null,
      prizeInfo: accessor.record('prizeInfo') ?? {},
      predictedProbability: accessor.num('predictedProbability', 0),
      predictedJoinTotal: accessor.num('predictedJoinTotal', 0),
      remainingSec: Math.max(0, Math.floor(accessor.num('remainingSec', 0))),
      endTime: Math.floor(accessor.num('endTime', 0)),
      startTime: Math.floor(accessor.num('startTime', 0)),
      joinedAt: Math.floor(accessor.num('joinedAt', 0)),
      rewardAmount: accessor.num('rewardAmount', 0),
      joinMode: accessor.str('joinMode'),
      reason: accessor.str('reason'),
      extra: accessor.record('extra') ?? {}
    },
    timeoutMs: accessor.num('timeoutMs', 1800)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    const errorMessage = notifyPayloadError(payload, 'task_feedback_failed')
    return { ok: false, status: res.status, data: payload, error: errorMessage }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 拉取服务端任务调试摘要和当前租约列表。
 * @param {string} baseUrl 服务地址
 * @param {{clientId?:string,accountId?:string,filters?:object,limit?:number,timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function fetchPoolTaskDebug(baseUrl: string, options: PoolOptions = {}): Promise<PoolClientResponse> {
  const accessor = createOptionAccessor(options)
  const params = new URLSearchParams()
  params.set('limit', String(clampInt(accessor.num('limit', 50), 1, 500)))
  appendFilters(params, accessor.record('filters'))
  const clientId = accessor.str('clientId')
  const accountId = accessor.str('accountId')
  if (clientId) params.set('clientId', clientId)
  if (accountId) params.set('accountId', accountId)

  const res = await requestJSON(baseUrl, `/task/debug?${params.toString()}`, {
    timeoutMs: accessor.num('timeoutMs', DEFAULT_TIMEOUT_MS)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    const errorMessage = notifyPayloadError(payload, 'task_debug_failed')
    return { ok: false, status: res.status, data: payload, error: errorMessage }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 拉取服务端分配的扫描分片，并顺带完成客户端心跳续约。
 * @param {string} baseUrl 服务地址
 * @param {{clientId:string,categories?:string[],timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function fetchPoolScanAssignment(baseUrl: string, options: PoolOptions = {}): Promise<PoolClientResponse> {
  const accessor = createOptionAccessor(options)
  const params = new URLSearchParams()
  const clientId = accessor.str('clientId')
  if (clientId) params.set('clientId', clientId)
  const categories = accessor.arr<string>('categories')
  if (categories.length > 0) {
    params.set('categories', categories.map(item => item ? String(item).trim() : '').filter(Boolean).join(','))
  }
  const telemetry = accessor.record<PoolTelemetry>('telemetry')
  if (telemetry) {
    const numericKeys: (keyof PoolTelemetry)[] = ['riskLevel', 'cooldownRemainMs', 'hardRiskCount', 'busyAccounts', 'idleAccounts', 'activeScanners']
    numericKeys.forEach((key) => {
      const rawValue = Number(telemetry[key] ?? 0)
      if (Number.isFinite(rawValue) && rawValue > 0) {
        params.set(key, String(Math.max(0, Math.floor(rawValue))))
      }
    })
  }
  const res = await requestJSON(baseUrl, `/scan/assignment?${params.toString()}`, {
    timeoutMs: accessor.num('timeoutMs', DEFAULT_TIMEOUT_MS)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    const errorMessage = notifyPayloadError(payload, 'scan_assignment_failed')
    return { ok: false, status: res.status, data: payload, error: errorMessage }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 请求服务端发放一次扫描许可证，用于集群级硬限流。
 * @param {string} baseUrl 服务地址
 * @param {{clientId:string,accountId?:string,kind:string,cost?:number,timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function requestPoolScanPermit(baseUrl: string, options: PoolOptions = {}): Promise<PoolClientResponse> {
  const accessor = createOptionAccessor(options)
  const res = await requestJSON(baseUrl, '/scan/permit', {
    method: 'POST',
    body: {
      clientId: accessor.str('clientId'),
      accountId: accessor.str('accountId'),
      kind: accessor.str('kind'),
      cost: clampInt(accessor.num('cost', 1), 1, Number.MAX_SAFE_INTEGER)
    },
    timeoutMs: accessor.num('timeoutMs', 1600)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    const errorMessage = notifyPayloadError(payload, 'scan_permit_failed')
    return { ok: false, status: res.status, data: payload, error: errorMessage }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 领取共享全站 maxTime 游标。
 * @param {string} baseUrl 服务地址
 * @param {{clientId:string,accountId:string,leaseTtlMs?:number,timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function claimPoolAllScanCursor(baseUrl: string, options: PoolOptions = {}): Promise<PoolClientResponse> {
  const accessor = createOptionAccessor(options)
  const res = await requestJSON(baseUrl, '/scan/all/claim', {
    method: 'POST',
    body: {
      clientId: accessor.str('clientId'),
      accountId: accessor.str('accountId'),
      leaseTtlMs: Math.max(10000, accessor.num('leaseTtlMs', 18000))
    },
    timeoutMs: accessor.num('timeoutMs', 1800)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    const errorMessage = notifyPayloadError(payload, 'all_scan_claim_failed')
    return { ok: false, status: res.status, data: payload, error: errorMessage }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 回传共享全站 maxTime 游标的推进结果。
 * @param {string} baseUrl 服务地址
 * @param {{clientId:string,accountId:string,slotId:string,usedCursorMaxTime?:number,nextCursorMaxTime?:number,hasMore?:boolean,rawRooms?:number,hintedRooms?:number,qualifiedRooms?:number,error?:string,timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function reportPoolAllScanCursor(baseUrl: string, options: PoolOptions = {}): Promise<PoolClientResponse> {
  const accessor = createOptionAccessor(options)
  const res = await requestJSON(baseUrl, '/scan/all/report', {
    method: 'POST',
    body: {
      clientId: accessor.str('clientId'),
      accountId: accessor.str('accountId'),
      slotId: accessor.str('slotId'),
      usedCursorMaxTime: Math.max(0, accessor.num('usedCursorMaxTime', 0)),
      nextCursorMaxTime: Math.max(0, accessor.num('nextCursorMaxTime', 0)),
      hasMore: accessor.bool('hasMore'),
      rawRooms: Math.max(0, accessor.num('rawRooms', 0)),
      hintedRooms: Math.max(0, accessor.num('hintedRooms', 0)),
      qualifiedRooms: Math.max(0, accessor.num('qualifiedRooms', 0)),
      error: accessor.str('error')
    },
    timeoutMs: accessor.num('timeoutMs', 1800)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    const errorMessage = notifyPayloadError(payload, 'all_scan_report_failed')
    return { ok: false, status: res.status, data: payload, error: errorMessage }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 拉取服务端学习桶调试信息。
 * @param {string} baseUrl 服务地址
 * @param {{limit?:number,timeoutMs?:number}} options 参数
 * @returns {Promise<object>}
 */
export async function fetchPoolLearningDebug(baseUrl: string, options: PoolOptions = {}): Promise<PoolClientResponse> {
  const accessor = createOptionAccessor(options)
  const params = new URLSearchParams()
  params.set('limit', String(clampInt(accessor.num('limit', 120), 1, 500)))
  const res = await requestJSON(baseUrl, `/learning/debug?${params.toString()}`, {
    timeoutMs: accessor.num('timeoutMs', DEFAULT_TIMEOUT_MS)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    const errorMessage = notifyPayloadError(payload, 'learning_debug_failed')
    return { ok: false, status: res.status, data: payload, error: errorMessage }
  }
  return { ok: true, status: res.status, data: payload }
}

/**
 * 获取桌面端公告 Markdown 文本。
 * @param {string} baseUrl 服务地址
 * @param {{timeoutMs?:number}} options 请求参数
 * @returns {Promise<object>}
 */
export async function fetchDesktopNotice(baseUrl: string, options: PoolOptions = {}): Promise<PoolClientResponse> {
  const accessor = createOptionAccessor(options)
  const res = await requestJSON(baseUrl, '/desktop/notice', {
    timeoutMs: accessor.num('timeoutMs', DEFAULT_TIMEOUT_MS)
  })
  if (!res.ok) return res
  const payload = isObject(res.data) ? res.data : {}
  if (payload.ok !== true) {
    const errorMessage = notifyPayloadError(payload, 'desktop_notice_failed')
    return { ok: false, status: res.status, data: payload, error: errorMessage }
  }
  return { ok: true, status: res.status, data: payload }
}
