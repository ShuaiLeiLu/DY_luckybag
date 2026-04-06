const fs = require('fs')
const path = require('path')
const { DatabaseSync } = require('node:sqlite')

const PROJECT_CONFIG_PATH = path.resolve(__dirname, '..', '..', '..', 'config.json')
const LEGACY_FIXED_POOL_SERVER_URL = 'http://127.0.0.1:9090'
const JOIN_RECORDS_FILE_NAME = 'lottery-join-records.jsonl'
const WIN_RECORDS_FILE_NAME = 'lottery-win-records.jsonl'
const ACCOUNT_LOGS_DIR_NAME = 'account-logs'
const TIMELINE_LOGS_FILE_NAME = 'timeline-runtime.txt'
const BUILTIN_DEFAULT_SETTINGS = Object.freeze({
  poolServerUrl: 'https://fudai.shuai.help',
  updateFeedUrl: 'https://updates.example.com/dy-fudai/windows',
  hotUpdateEnabled: false,
  hotUpdateManifestUrl: '',
  hotUpdateReloadOnApply: false,
  noticeMarkdown: '',
  stayDuration: 18,
  enableRedPacket: true,
  randomInteraction: true,
  hitRate: { enabled: true, value: 0.08 },
  secondInspect: { enabled: true, value: 0.05 },
  filterFanClub: { enabled: true },
  onlyPhysicalPrize: { enabled: false },
  preferBigRedPacket: { enabled: true, threshold: 40 },
  filterOnline: { enabled: false, value: 0 },
  participationCount: { enabled: false, value: 120 },
  singleAccountDuration: { enabled: false, value: 6 },
  scanConfig: { countPerPage: 15, pagesPerCategory: 12, allCount: 24 }
})

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
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
  return {
    ...base,
    ...next,
    hitRate: { ...base.hitRate, ...asPlainObject(next.hitRate) },
    secondInspect: { ...base.secondInspect, ...asPlainObject(next.secondInspect) },
    filterFanClub: { ...base.filterFanClub, ...asPlainObject(next.filterFanClub) },
    onlyPhysicalPrize: { ...base.onlyPhysicalPrize, ...asPlainObject(next.onlyPhysicalPrize) },
    preferBigRedPacket: { ...base.preferBigRedPacket, ...asPlainObject(next.preferBigRedPacket) },
    filterOnline: { ...base.filterOnline, ...asPlainObject(next.filterOnline) },
    participationCount: { ...base.participationCount, ...asPlainObject(next.participationCount) },
    singleAccountDuration: { ...base.singleAccountDuration, ...asPlainObject(next.singleAccountDuration) },
    scanConfig: { ...base.scanConfig, ...asPlainObject(next.scanConfig) }
  }
}

function normalizeServerUrl(raw) {
  return String(raw || '').trim().replace(/\/+$/, '')
}

function loadDesktopConfigDefaults() {
  try {
    if (!fs.existsSync(PROJECT_CONFIG_PATH)) return {}
    const raw = fs.readFileSync(PROJECT_CONFIG_PATH, 'utf8')
    const parsed = asPlainObject(safeParseJSON(raw, {}), {})
    return asPlainObject(parsed.desktop, {})
  } catch (_) {
    return {}
  }
}

const DEFAULT_SETTINGS = Object.freeze(mergeSettings(BUILTIN_DEFAULT_SETTINGS, loadDesktopConfigDefaults()))

function normalizeSettings(raw = {}) {
  const merged = mergeSettings(DEFAULT_SETTINGS, raw)
  const mergedPoolServerUrl = normalizeServerUrl(merged.poolServerUrl)
  const defaultPoolServerUrl = normalizeServerUrl(DEFAULT_SETTINGS.poolServerUrl)
  const legacyPoolServerUrl = normalizeServerUrl(LEGACY_FIXED_POOL_SERVER_URL)

  // 兼容旧版本历史：曾强制写死本地地址，升级后优先恢复 config.json 中的默认地址。
  if (mergedPoolServerUrl === legacyPoolServerUrl && defaultPoolServerUrl && defaultPoolServerUrl !== legacyPoolServerUrl) {
    merged.poolServerUrl = DEFAULT_SETTINGS.poolServerUrl
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

function appendTextLine(filePath, line) {
  fs.appendFileSync(filePath, `${String(line || '').replace(/\r?\n+/g, ' ').trim()}\n`, 'utf8')
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
  const accountLogsDir = path.join(stateDir, ACCOUNT_LOGS_DIR_NAME)
  ensureDir(accountLogsDir)
  const dbPath = path.join(stateDir, 'desktop.sqlite')
  const joinRecordsPath = path.join(stateDir, JOIN_RECORDS_FILE_NAME)
  const winRecordsPath = path.join(stateDir, WIN_RECORDS_FILE_NAME)
  const timelineLogsPath = path.join(stateDir, TIMELINE_LOGS_FILE_NAME)
  const db = new DatabaseSync(dbPath)

  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runtime_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lottery_history_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_type TEXT NOT NULL,
      account_id TEXT NOT NULL,
      lottery_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_runtime_events_created_at ON runtime_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_lottery_history_records_created_at ON lottery_history_records(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_lottery_history_records_type_created_at ON lottery_history_records(record_type, created_at DESC);
  `)

  // Runtime timeline logs are session-only and should start fresh on every app launch.
  db.prepare('DELETE FROM runtime_events').run()

  function getSettings() {
    const row = db.prepare(`
      SELECT setting_value
      FROM app_settings
      WHERE setting_key = 'desktop_settings'
      LIMIT 1
    `).get()

    const parsed = row ? safeParseJSON(row.setting_value, {}) : {}
    return normalizeSettings(parsed)
  }

  function saveSettings(patch = {}) {
    const merged = normalizeSettings({
      ...getSettings(),
      ...(patch && typeof patch === 'object' ? patch : {})
    })
    db.prepare(`
      INSERT INTO app_settings (setting_key, setting_value, updated_at)
      VALUES ('desktop_settings', ?, ?)
      ON CONFLICT(setting_key) DO UPDATE
      SET setting_value = excluded.setting_value,
          updated_at = excluded.updated_at
    `).run(JSON.stringify(merged), Date.now())
    return merged
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
    const result = db.prepare(`
      INSERT INTO lottery_history_records (record_type, account_id, lottery_id, room_id, created_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      payload.recordType,
      payload.accountId,
      payload.lotteryId,
      payload.roomId,
      payload.createdAt,
      JSON.stringify(payload)
    )
    const item = {
      ...payload,
      id: Number(result.lastInsertRowid || 0)
    }
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
    const rows = normalizedType === 'join' || normalizedType === 'win'
      ? db.prepare(`
        SELECT id, record_type, created_at, payload_json
        FROM lottery_history_records
        WHERE record_type = ?
        ORDER BY id DESC
        LIMIT ?
      `).all(normalizedType, safeLimit)
      : db.prepare(`
        SELECT id, record_type, created_at, payload_json
        FROM lottery_history_records
        ORDER BY id DESC
        LIMIT ?
      `).all(safeLimit)

    return rows.map((row) => normalizeHistoryRecord({
      ...safeParseJSON(row.payload_json, {}),
      id: Number(row.id || 0),
      recordType: String(row.record_type || ''),
      createdAt: Number(row.created_at || 0)
    })).reverse()
  }

  function purgeAccountData(accountId) {
    const targetId = String(accountId || '').trim()
    if (!targetId) {
      return { success: false, error: 'account_id_required' }
    }

    const historyDeleteResult = db.prepare(`
      DELETE FROM lottery_history_records
      WHERE account_id = ?
    `).run(targetId)

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
      deletedHistoryRows: Number(historyDeleteResult?.changes || 0),
      deletedAccountLogFiles: removedLogFiles,
      deletedAccountLogBytes: removedLogBytes,
      deletedJoinJsonlRows: Number(joinPurge.removed || 0),
      deletedWinJsonlRows: Number(winPurge.removed || 0)
    }
  }

  return {
    dbPath,
    accountLogsDir,
    historyFiles: {
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
