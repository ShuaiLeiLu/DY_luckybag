const fs = require('fs')
const path = require('path')

const SETTINGS_FILE_NAME = 'desktop-settings.json'
const HISTORY_ALL_FILE_NAME = 'lottery-history-records.jsonl'
const JOIN_RECORDS_FILE_NAME = 'lottery-join-records.jsonl'
const WIN_RECORDS_FILE_NAME = 'lottery-win-records.jsonl'
const ACCOUNT_LOGS_DIR_NAME = 'account-logs'
const TIMELINE_LOGS_FILE_NAME = 'timeline-runtime.txt'
const BUILTIN_DEFAULT_SETTINGS = Object.freeze(require('../src/shared/defaultSettings.json'))

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function resolveProjectRootPath(baseDir = '') {
  const fromEnv = String(process.env.DY_PROJECT_ROOT || '').trim()
  if (fromEnv) return path.resolve(fromEnv)
  const safeBaseDir = String(baseDir || '').trim()
  if (safeBaseDir) {
    return path.dirname(path.resolve(safeBaseDir))
  }
  return path.resolve(__dirname, '..', '..', '..')
}

function resolveProjectConfigPath() {
  return path.join(resolveProjectRootPath(''), 'config.json')
}

function safeParseJSON(raw, fallback) {
  try {
    return JSON.parse(String(raw || ''))
  } catch (_) {
    return fallback
  }
}

function asPlainObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  return fallback
}

function clonePlainObject(value, fallback = {}) {
  try {
    return asPlainObject(JSON.parse(JSON.stringify(asPlainObject(value, fallback))), fallback)
  } catch (_) {
    return fallback
  }
}

function toSafeNumber(value, fallback = 0) {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

function clampLimit(limit, fallback = 160, max = 500) {
  const normalized = Math.floor(toSafeNumber(limit, fallback))
  if (!Number.isFinite(normalized) || normalized <= 0) return fallback
  return Math.min(max, normalized)
}

function normalizeEventLevel(raw) {
  const normalized = String(raw || '').trim().toLowerCase()
  if (normalized === 'warning') return 'warning'
  if (normalized === 'error') return 'error'
  if (normalized === 'success') return 'success'
  if (normalized === 'debug') return 'debug'
  return 'info'
}

function sanitizeFileSegment(raw, fallback = 'unknown') {
  const normalized = String(raw || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.\s]+|[_.\s]+$/g, '')
  return normalized || fallback
}

function pad2(value) {
  return String(Math.max(0, Number(value) || 0)).padStart(2, '0')
}

function formatLocalDateParts(ms) {
  const date = new Date(Math.max(0, Number(ms) || Date.now()))
  const yyyy = String(date.getFullYear())
  const MM = pad2(date.getMonth() + 1)
  const dd = pad2(date.getDate())
  const hh = pad2(date.getHours())
  const mm = pad2(date.getMinutes())
  const ss = pad2(date.getSeconds())
  return {
    day: `${yyyy}-${MM}-${dd}`,
    ts: `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`
  }
}

function mergeSettings(base, patch = {}) {
  const next = asPlainObject(patch, {})
  const { noticeMarkdown: _legacyNoticeMarkdown, ...sanitizedNext } = next
  return {
    ...base,
    ...sanitizedNext,
    hitRate: { ...base.hitRate, ...asPlainObject(sanitizedNext.hitRate) },
    secondInspect: { ...base.secondInspect, ...asPlainObject(sanitizedNext.secondInspect) },
    filterFanClub: { ...base.filterFanClub, ...asPlainObject(sanitizedNext.filterFanClub) },
    onlyRedPacketMode: { ...base.onlyRedPacketMode, ...asPlainObject(sanitizedNext.onlyRedPacketMode) },
    onlyPhysicalPrize: { ...base.onlyPhysicalPrize, ...asPlainObject(sanitizedNext.onlyPhysicalPrize) },
    preferBigRedPacket: { ...base.preferBigRedPacket, ...asPlainObject(sanitizedNext.preferBigRedPacket) },
    filterOnline: { ...base.filterOnline, ...asPlainObject(sanitizedNext.filterOnline) },
    participationCount: { ...base.participationCount, ...asPlainObject(sanitizedNext.participationCount) },
    singleAccountDuration: { ...base.singleAccountDuration, ...asPlainObject(sanitizedNext.singleAccountDuration) },
    scanConfig: { ...base.scanConfig, ...asPlainObject(sanitizedNext.scanConfig) },
    androidBridge: { ...base.androidBridge, ...asPlainObject(sanitizedNext.androidBridge) }
  }
}

function normalizeServerUrl(raw) {
  return String(raw || '').trim().replace(/\/+$/, '')
}

function migrateFudaiUrlToHttp9090(raw, fallback = '') {
  const normalized = normalizeServerUrl(raw)
  if (!normalized) return normalized
  try {
    const parsed = new URL(/^https?:\/\//i.test(normalized) ? normalized : `http://${normalized}`)
    const host = String(parsed.hostname || '').trim().toLowerCase()
    if (host !== 'fudai.shuai.help') return normalized
    const next = new URL(parsed.toString())
    next.protocol = 'http:'
    next.port = '9090'
    return normalizeServerUrl(next.toString())
  } catch (_) {
    return fallback || normalized
  }
}

function isLegacyLoopbackPoolServerUrl(raw) {
  const normalized = normalizeServerUrl(raw)
  if (!normalized) return false

  try {
    const resolved = /^https?:\/\//i.test(normalized) ? normalized : `http://${normalized}`
    const parsed = new URL(resolved)
    const host = String(parsed.hostname || '').trim().toLowerCase()
    const port = String(parsed.port || (parsed.protocol === 'https:' ? '443' : '80'))
    if (port !== '9090') return false
    if (host === 'localhost') return true

    const octets = host.split('.')
    return (
      octets.length === 4 &&
      octets.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255) &&
      Number(octets[0]) === 127 &&
      Number(octets[1]) === 0 &&
      Number(octets[2]) === 0 &&
      Number(octets[3]) === 1
    )
  } catch (_) {
    return false
  }
}

function loadDesktopConfigDefaults() {
  const projectConfigPath = resolveProjectConfigPath()
  try {
    if (!fs.existsSync(projectConfigPath)) return {}
    const raw = fs.readFileSync(projectConfigPath, 'utf8')
    const parsed = asPlainObject(safeParseJSON(raw, {}), {})
    return asPlainObject(parsed.desktop, {})
  } catch (_) {
    return {}
  }
}

const DEFAULT_SETTINGS = Object.freeze(mergeSettings(BUILTIN_DEFAULT_SETTINGS, loadDesktopConfigDefaults()))

function normalizeSettings(raw = {}) {
  const merged = mergeSettings(DEFAULT_SETTINGS, raw)
  merged.poolServerUrl = migrateFudaiUrlToHttp9090(merged.poolServerUrl, DEFAULT_SETTINGS.poolServerUrl)
  merged.hotUpdateManifestUrl = migrateFudaiUrlToHttp9090(merged.hotUpdateManifestUrl, DEFAULT_SETTINGS.hotUpdateManifestUrl)

  const mergedPoolServerUrl = normalizeServerUrl(merged.poolServerUrl)
  const defaultPoolServerUrl = normalizeServerUrl(DEFAULT_SETTINGS.poolServerUrl)
  const mergedHotUpdateManifestUrl = normalizeServerUrl(merged.hotUpdateManifestUrl)
  const defaultHotUpdateManifestUrl = normalizeServerUrl(DEFAULT_SETTINGS.hotUpdateManifestUrl)
  if (
    isLegacyLoopbackPoolServerUrl(mergedPoolServerUrl) &&
    defaultPoolServerUrl &&
    !isLegacyLoopbackPoolServerUrl(defaultPoolServerUrl)
  ) {
    merged.poolServerUrl = DEFAULT_SETTINGS.poolServerUrl
  }

  // Older packaged builds persisted hot-update as disabled because main-process defaults
  // did not include the manifest URL. Adopt the project/default hot-update settings when
  // the stored value is still the legacy empty+disabled combination.
  if (
    merged.hotUpdateEnabled !== true &&
    !mergedHotUpdateManifestUrl &&
    DEFAULT_SETTINGS.hotUpdateEnabled === true &&
    defaultHotUpdateManifestUrl
  ) {
    merged.hotUpdateEnabled = true
    merged.hotUpdateManifestUrl = DEFAULT_SETTINGS.hotUpdateManifestUrl
  }

  return merged
}

function normalizeHistoryRecord(record = {}) {
  const joinedAt = Math.max(0, toSafeNumber(record.joinedAt, 0))
  const createdAt = Math.max(0, toSafeNumber(record.createdAt, joinedAt || Date.now()))
  const rewardAmount = Math.max(0, toSafeNumber(record.rewardAmount, 0))
  const resultStatusText = String(record.resultStatus || '').trim()
  const rawType = String(record.recordType || '').trim().toLowerCase()
  const recordType = rawType === 'win' || resultStatusText.toLowerCase() === 'won' || rewardAmount > 0 ? 'win' : 'join'

  return {
    id: Math.max(0, toSafeNumber(record.id, 0)),
    recordType,
    accountId: String(record.accountId || '').trim(),
    accountNickname: String(record.accountNickname || '').trim(),
    roomId: String(record.roomId || '').trim(),
    webRid: String(record.webRid || '').trim(),
    lotteryId: String(record.lotteryId || record.lottery_id || '').trim(),
    authorNickname: String(record.authorNickname || '').trim(),
    lotteryName: String(record.lotteryName || record.prize_name || '').trim(),
    predictedProbability: toSafeNumber(record.predictedProbability, 0),
    predictedJoinTotal: Math.max(0, toSafeNumber(record.predictedJoinTotal, 0)),
    joinTotal: Math.max(0, toSafeNumber(record.joinTotal, 0)),
    luckyCount: Math.max(0, toSafeNumber(record.luckyCount, 0)),
    onlineTotal: Math.max(0, toSafeNumber(record.onlineTotal, 0)),
    totalAmount: Math.max(0, toSafeNumber(record.totalAmount, record.total_amount || 0)),
    prizeType: record.prizeType ?? null,
    prizeInfo: asPlainObject(record.prizeInfo, {}),
    conditions: Array.isArray(record.conditions) ? record.conditions : [],
    remainingSec: Math.max(0, toSafeNumber(record.remainingSec, 0)),
    serverScore: toSafeNumber(record.serverScore, 0),
    startTime: Math.max(0, toSafeNumber(record.startTime, 0)),
    joinMode: String(record.joinMode || '').trim(),
    joinStatus: String(record.joinStatus || 'success').trim() || 'success',
    resultStatus: resultStatusText || (recordType === 'win' ? 'won' : 'pending'),
    resultReason: String(record.resultReason || '').trim() || (recordType === 'win' ? 'won' : 'pending_draw'),
    joinedAt,
    endTime: Math.max(0, toSafeNumber(record.endTime, 0)),
    rewardAmount,
    createdAt
  }
}

function appendJsonLine(filePath, payload) {
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8')
}

function resolveRuntimeLogsDir(baseDir, stateDir) {
  const projectRuntimeLogsDir = path.join(resolveProjectRootPath(baseDir), 'runtime-logs')
  try {
    ensureDir(projectRuntimeLogsDir)
    return projectRuntimeLogsDir
  } catch (_) {
    const fallbackDir = path.join(stateDir, 'runtime-logs')
    ensureDir(fallbackDir)
    return fallbackDir
  }
}

function appendTextLine(filePath, line) {
  fs.appendFileSync(filePath, `${String(line || '').replace(/\r?\n+/g, ' ').trim()}\n`, 'utf8')
}

function readJsonObjectFile(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback
    const raw = fs.readFileSync(filePath, 'utf8')
    return asPlainObject(safeParseJSON(raw, fallback), fallback)
  } catch (_) {
    return fallback
  }
}

function writeJsonObjectFile(filePath, payload) {
  const dir = path.dirname(filePath)
  ensureDir(dir)
  fs.writeFileSync(filePath, `${JSON.stringify(asPlainObject(payload, {}), null, 2)}\n`, 'utf8')
}

function readJsonLines(filePath) {
  try {
    if (!fs.existsSync(filePath)) return []
    const raw = fs.readFileSync(filePath, 'utf8')
    if (!raw.trim()) return []
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => safeParseJSON(line, null))
      .filter((item) => item && typeof item === 'object')
  } catch (_) {
    return []
  }
}

function writeJsonLines(filePath, items = []) {
  const dir = path.dirname(filePath)
  ensureDir(dir)
  const normalized = Array.isArray(items) ? items : []
  const raw = normalized.length > 0
    ? `${normalized.map((item) => JSON.stringify(item)).join('\n')}\n`
    : ''
  fs.writeFileSync(filePath, raw, 'utf8')
}

function bootstrapHistoryAllFile(historyAllPath, legacyPaths = []) {
  try {
    if (fs.existsSync(historyAllPath)) return
    const legacy = legacyPaths
      .flatMap((filePath) => readJsonLines(filePath))
      .map((item) => normalizeHistoryRecord(item))
      .filter((item) => item.recordType === 'join' || item.recordType === 'win')
      .sort((a, b) => {
        const createdDiff = Number(a.createdAt || 0) - Number(b.createdAt || 0)
        if (createdDiff !== 0) return createdDiff
        return Number(a.id || 0) - Number(b.id || 0)
      })
      .map((item, index) => ({
        ...item,
        id: index + 1
      }))
    if (legacy.length <= 0) return
    writeJsonLines(historyAllPath, legacy)
  } catch (_) {
    // ignore bootstrap errors and allow runtime to continue
  }
}

function buildTextLogLine({ createdAt = Date.now(), level = 'info', scope = 'desktop', accountId = '', message = '' } = {}) {
  const dateParts = formatLocalDateParts(createdAt)
  const levelText = String(level || 'info').toUpperCase()
  const scopeText = String(scope || 'desktop').trim() || 'desktop'
  const accountText = String(accountId || '').trim()
  const body = String(message || '').replace(/\r?\n+/g, ' ').trim()
  const accountSeg = accountText ? ` [${accountText}]` : ''
  return `[${dateParts.ts}] [${levelText}] [${scopeText}]${accountSeg} ${body}`.trim()
}

function purgeJsonlByAccount(filePath, accountId) {
  const targetId = String(accountId || '').trim()
  if (!targetId) return { removed: 0, kept: 0 }
  if (!fs.existsSync(filePath)) return { removed: 0, kept: 0 }
  const raw = fs.readFileSync(filePath, 'utf8')
  if (!raw.trim()) return { removed: 0, kept: 0 }
  const lines = raw.split('\n').filter(Boolean)
  const kept = []
  let removed = 0
  for (const line of lines) {
    const parsed = safeParseJSON(line, null)
    const recordAccountId = String(parsed?.accountId || '').trim()
    if (recordAccountId && recordAccountId === targetId) {
      removed += 1
      continue
    }
    kept.push(line)
  }
  const nextRaw = kept.length > 0 ? `${kept.join('\n')}\n` : ''
  fs.writeFileSync(filePath, nextRaw, 'utf8')
  return { removed, kept: kept.length }
}

function createStateStore(baseDir) {
  const stateDir = path.join(baseDir, 'state')
  ensureDir(stateDir)
  const runtimeLogsDir = resolveRuntimeLogsDir(baseDir, stateDir)
  const accountLogsDir = path.join(runtimeLogsDir, ACCOUNT_LOGS_DIR_NAME)
  ensureDir(accountLogsDir)
  const settingsPath = path.join(stateDir, SETTINGS_FILE_NAME)
  const historyAllPath = path.join(stateDir, HISTORY_ALL_FILE_NAME)
  const joinRecordsPath = path.join(stateDir, JOIN_RECORDS_FILE_NAME)
  const winRecordsPath = path.join(stateDir, WIN_RECORDS_FILE_NAME)
  const timelineLogsPath = path.join(runtimeLogsDir, TIMELINE_LOGS_FILE_NAME)
  bootstrapHistoryAllFile(historyAllPath, [joinRecordsPath, winRecordsPath])
  let cachedSettings = null
  let historySeq = readJsonLines(historyAllPath)
    .reduce((maxId, item) => Math.max(maxId, Math.max(0, toSafeNumber(item?.id, 0))), 0)

  function getSettings() {
    if (cachedSettings) return clonePlainObject(cachedSettings, DEFAULT_SETTINGS)
    cachedSettings = normalizeSettings(readJsonObjectFile(settingsPath, {}))
    return clonePlainObject(cachedSettings, DEFAULT_SETTINGS)
  }

  function saveSettings(patch = {}) {
    const merged = normalizeSettings({
      ...getSettings(),
      ...(patch && typeof patch === 'object' ? patch : {})
    })
    writeJsonObjectFile(settingsPath, merged)
    cachedSettings = merged
    return clonePlainObject(merged, DEFAULT_SETTINGS)
  }

  function clearRuntimeEvents() {
    // runtime timeline switched to session-only memory; no DB persistence.
  }

  function appendEvent(event = {}) {
    const createdAt = Math.max(0, toSafeNumber(event.createdAt, Date.now()))
    const scope = String(event.scope || 'desktop').trim() || 'desktop'
    const level = normalizeEventLevel(event.level)
    const message = String(event.message || '').replace(/\r?\n+/g, ' ').trim()
    if (message) {
      appendTextLine(
        timelineLogsPath,
        buildTextLogLine({ createdAt, scope, level, message })
      )
    }
    return {
      id: Date.now(),
      scope,
      level,
      message,
      createdAt
    }
  }

  function listEvents(_limit = 160) {
    return []
  }

  function appendHistoryRecord(record = {}) {
    const payload = normalizeHistoryRecord(record)
    if (payload.id > 0) {
      historySeq = Math.max(historySeq, payload.id)
    } else {
      historySeq += 1
    }
    const item = {
      ...payload,
      id: payload.id > 0 ? payload.id : historySeq
    }
    appendJsonLine(historyAllPath, item)
    appendJsonLine(item.recordType === 'win' ? winRecordsPath : joinRecordsPath, item)
    return item
  }

  function appendAccountLog(record = {}) {
    const accountId = String(record.accountId || '').trim() || 'unknown'
    const scope = String(record.scope || 'desktop').trim() || 'desktop'
    const level = normalizeEventLevel(record.level)
    const message = String(record.message || '').replace(/\r?\n+/g, ' ').trim()
    if (!message) {
      return { success: false, error: 'message_empty' }
    }
    const createdAt = Math.max(0, toSafeNumber(record.createdAt, Date.now()))
    const dateParts = formatLocalDateParts(createdAt)
    const fileDir = path.join(accountLogsDir, sanitizeFileSegment(accountId))
    ensureDir(fileDir)
    const filePath = path.join(fileDir, `${dateParts.day}.txt`)
    appendTextLine(
      filePath,
      buildTextLogLine({ createdAt, accountId, scope, level, message })
    )
    return {
      success: true,
      accountId,
      scope,
      level,
      message,
      createdAt,
      filePath
    }
  }

  function listHistoryRecords(limit = 200, options = {}) {
    const normalizedType = String(options?.recordType || 'all').trim().toLowerCase()
    const safeLimit = clampLimit(limit, 200, 1000)
    const all = readJsonLines(historyAllPath)
      .map((item) => normalizeHistoryRecord(item))
      .filter((item) => item.recordType === 'join' || item.recordType === 'win')

    const filtered = (normalizedType === 'join' || normalizedType === 'win')
      ? all.filter((item) => item.recordType === normalizedType)
      : all

    return filtered
      .sort((a, b) => {
        const idDiff = Number(b.id || 0) - Number(a.id || 0)
        if (idDiff !== 0) return idDiff
        return Number(b.createdAt || 0) - Number(a.createdAt || 0)
      })
      .slice(0, safeLimit)
      .reverse()
  }

  function purgeAccountData(accountId) {
    const targetId = String(accountId || '').trim()
    if (!targetId) {
      return { success: false, error: 'account_id_required' }
    }

    const historyAllPurge = purgeJsonlByAccount(historyAllPath, targetId)

    const accountLogDir = path.join(accountLogsDir, sanitizeFileSegment(targetId))
    let removedLogFiles = 0
    let removedLogBytes = 0
    if (fs.existsSync(accountLogDir)) {
      const entries = fs.readdirSync(accountLogDir)
      for (const entry of entries) {
        const filePath = path.join(accountLogDir, entry)
        try {
          const stat = fs.statSync(filePath)
          if (stat.isFile()) {
            removedLogFiles += 1
            removedLogBytes += Number(stat.size || 0)
          }
        } catch (_) {
          // ignore stat errors
        }
      }
      fs.rmSync(accountLogDir, { recursive: true, force: true })
    }

    const joinPurge = purgeJsonlByAccount(joinRecordsPath, targetId)
    const winPurge = purgeJsonlByAccount(winRecordsPath, targetId)

    return {
      success: true,
      accountId: targetId,
      deletedHistoryRows: Number(historyAllPurge.removed || 0),
      deletedAccountLogFiles: removedLogFiles,
      deletedAccountLogBytes: removedLogBytes,
      deletedJoinJsonlRows: Number(joinPurge.removed || 0),
      deletedWinJsonlRows: Number(winPurge.removed || 0)
    }
  }

  return {
    dbPath: null,
    settingsPath,
    historyAllPath,
    runtimeLogsDir,
    accountLogsDir,
    historyFiles: {
      all: historyAllPath,
      join: joinRecordsPath,
      win: winRecordsPath
    },
    getSettings,
    saveSettings,
    clearRuntimeEvents,
    appendEvent,
    listEvents,
    appendAccountLog,
    appendHistoryRecord,
    listHistoryRecords,
    purgeAccountData
  }
}

module.exports = {
  createStateStore,
  DEFAULT_SETTINGS
}
