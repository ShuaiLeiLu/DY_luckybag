const LEVEL_PRIORITY = Object.freeze({
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
})

function normalizeLogLevel(raw, fallback = 'info') {
  const value = String(raw || '').trim().toLowerCase()
  if (Object.prototype.hasOwnProperty.call(LEVEL_PRIORITY, value)) {
    return value
  }
  return fallback
}

function readEnvLogLevel() {
  return process.env.DY_LOG_LEVEL || process.env.LOG_LEVEL || ''
}

function createLogger(scope = 'electron', options = {}) {
  const fallbackLevel = normalizeLogLevel(options.defaultLevel || 'info', 'info')
  let currentLevel = normalizeLogLevel(readEnvLogLevel(), fallbackLevel)
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
    refreshFromEnv() {
      currentLevel = normalizeLogLevel(readEnvLogLevel(), currentLevel)
      return currentLevel
    },
    error: emit('error', console.error.bind(console)),
    warn: emit('warn', console.warn.bind(console)),
    info: emit('info', console.log.bind(console)),
    debug: emit('debug', (console.debug || console.log).bind(console))
  }
}

module.exports = {
  createLogger,
  normalizeLogLevel,
  LEVEL_PRIORITY
}
