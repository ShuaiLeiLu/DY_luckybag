const fs = require('fs')
const path = require('path')
const { DatabaseSync } = require('node:sqlite')

const DESKTOP_CONFIG_PATH = path.resolve(__dirname, '..', 'config.json')
const JOIN_RECORDS_FILE_NAME = 'lottery-join-records.jsonl'
const WIN_RECORDS_FILE_NAME = 'lottery-win-records.jsonl'
const BUILTIN_DEFAULT_SETTINGS = Object.freeze({
  poolServerUrl: 'http://110.40.169.26:9090',
  updateFeedUrl: 'https://updates.example.com/dy-fudai/windows',
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

function loadDesktopConfigDefaults() {
  try {
    if (!fs.existsSync(DESKTOP_CONFIG_PATH)) return {}
    const raw = fs.readFileSync(DESKTOP_CONFIG_PATH, 'utf8')
    return asPlainObject(safeParseJSON(raw, {}), {})
  } catch (_) {
    return {}
  }
}

const DEFAULT_SETTINGS = Object.freeze(mergeSettings(BUILTIN_DEFAULT_SETTINGS, loadDesktopConfigDefaults()))

function normalizeSettings(raw = {}) {
  return mergeSettings(DEFAULT_SETTINGS, raw)
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

function createStateStore(baseDir) {
  const stateDir = path.join(baseDir, 'state')
  ensureDir(stateDir)
  const dbPath = path.join(stateDir, 'desktop.sqlite')
  const joinRecordsPath = path.join(stateDir, JOIN_RECORDS_FILE_NAME)
  const winRecordsPath = path.join(stateDir, WIN_RECORDS_FILE_NAME)
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
    db.prepare('DELETE FROM runtime_events').run()
  }

  function appendEvent(event = {}) {
    const payload = {
      scope: String(event.scope || 'desktop'),
      level: String(event.level || 'info'),
      message: String(event.message || ''),
      createdAt: Date.now()
    }
    const result = db.prepare(`
      INSERT INTO runtime_events (scope, level, message, created_at)
      VALUES (?, ?, ?, ?)
    `).run(payload.scope, payload.level, payload.message, payload.createdAt)
    return {
      id: Number(result.lastInsertRowid || 0),
      scope: payload.scope,
      level: payload.level,
      message: payload.message,
      createdAt: payload.createdAt
    }
  }

  function listEvents(limit = 160) {
    return db.prepare(`
      SELECT id, scope, level, message, created_at
      FROM runtime_events
      ORDER BY id DESC
      LIMIT ?
    `).all(clampLimit(limit, 160, 500)).map((row) => ({
      id: Number(row.id || 0),
      scope: String(row.scope || 'desktop'),
      level: String(row.level || 'info'),
      message: String(row.message || ''),
      createdAt: Number(row.created_at || 0)
    })).reverse()
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

  return {
    dbPath,
    historyFiles: {
      join: joinRecordsPath,
      win: winRecordsPath
    },
    getSettings,
    saveSettings,
    clearRuntimeEvents,
    appendEvent,
    listEvents,
    appendHistoryRecord,
    listHistoryRecords
  }
}

module.exports = {
  createStateStore,
  DEFAULT_SETTINGS
}