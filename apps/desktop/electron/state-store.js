const fs = require('fs')
const path = require('path')
const { DatabaseSync } = require('node:sqlite')

const DESKTOP_CONFIG_PATH = path.resolve(__dirname, '..', 'config.json')
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

function createStateStore(baseDir) {
  const stateDir = path.join(baseDir, 'state')
  ensureDir(stateDir)
  const dbPath = path.join(stateDir, 'desktop.sqlite')
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
  `)

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
    `).all(Math.max(1, Math.min(500, Number(limit) || 160))).map((row) => ({
      id: Number(row.id || 0),
      scope: String(row.scope || 'desktop'),
      level: String(row.level || 'info'),
      message: String(row.message || ''),
      createdAt: Number(row.created_at || 0)
    })).reverse()
  }

  return {
    dbPath,
    getSettings,
    saveSettings,
    appendEvent,
    listEvents
  }
}

module.exports = {
  createStateStore,
  DEFAULT_SETTINGS
}
