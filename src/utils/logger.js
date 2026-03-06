const LEVEL_PRIORITY = Object.freeze({
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
})

const STORAGE_KEY = 'DY_LOG_LEVEL'

function normalizeLogLevel(raw, fallback = 'info') {
  const value = String(raw || '').trim().toLowerCase()
  if (Object.prototype.hasOwnProperty.call(LEVEL_PRIORITY, value)) {
    return value
  }
  return fallback
}

function defaultLogLevel() {
  return import.meta.env?.DEV ? 'info' : 'warn'
}

function readWindowLevel() {
  if (typeof window === 'undefined') return ''
  try {
    const cache = window.localStorage?.getItem(STORAGE_KEY)
    if (cache) return cache
  } catch (_) {
    // ignore storage failures
  }
  return String(window.__DY_LOG_LEVEL__ || '')
}

function resolveLogLevel(fallback = defaultLogLevel()) {
  const envLevel = import.meta.env?.VITE_LOG_LEVEL || ''
  const windowLevel = readWindowLevel()
  return normalizeLogLevel(windowLevel || envLevel, normalizeLogLevel(fallback, 'info'))
}

export function setGlobalLogLevel(level) {
  const normalized = normalizeLogLevel(level, defaultLogLevel())
  if (typeof window !== 'undefined') {
    window.__DY_LOG_LEVEL__ = normalized
    try {
      window.localStorage?.setItem(STORAGE_KEY, normalized)
    } catch (_) {
      // ignore storage failures
    }
  }
  return normalized
}

export function createLogger(scope = 'renderer', options = {}) {
  let currentLevel = resolveLogLevel(options.defaultLevel || defaultLogLevel())
  const prefix = scope ? `[${scope}]` : ''

  const shouldLog = (level) => LEVEL_PRIORITY[level] <= LEVEL_PRIORITY[currentLevel]

  const emit = (level, printer) => (...args) => {
    if (!shouldLog(level)) return
    printer(prefix, ...args)
  }

  return {
    getLevel() {
      return currentLevel
    },
    setLevel(level) {
      currentLevel = normalizeLogLevel(level, currentLevel)
      return currentLevel
    },
    refreshFromWindow() {
      currentLevel = resolveLogLevel(currentLevel)
      return currentLevel
    },
    error: emit('error', console.error.bind(console)),
    warn: emit('warn', console.warn.bind(console)),
    info: emit('info', console.log.bind(console)),
    debug: emit('debug', (console.debug || console.log).bind(console))
  }
}

export { LEVEL_PRIORITY, normalizeLogLevel }
