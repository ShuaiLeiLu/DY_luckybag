const LEVEL_PRIORITY = Object.freeze({
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
})

/**
 * normalizeLogLevel 方法：归一化级别。
 */
function normalizeLogLevel(raw, fallback = 'warn') {
  const value = String(raw || '').trim().toLowerCase()
  if (Object.prototype.hasOwnProperty.call(LEVEL_PRIORITY, value)) {
    return value
  }
  return fallback
}

/**
 * readEnvLogLevel 方法：读取环境变量级别。
 */
function readEnvLogLevel() {
  return process.env.DY_LOG_LEVEL || process.env.LOG_LEVEL || ''
}

/**
 * createLogger 方法：创建带作用域与级别控制的日志器实例。
 */
function createLogger(scope = 'electron', options = {}) {
  const fallbackLevel = normalizeLogLevel(options.defaultLevel || 'warn', 'warn')
  let currentLevel = normalizeLogLevel(readEnvLogLevel(), fallbackLevel)
  const prefix = scope ? `[${scope}]` : ''

  /**
   * shouldLog 方法：判断当前日志级别是否允许输出该条日志。
   */
  const shouldLog = (level) => LEVEL_PRIORITY[level] <= LEVEL_PRIORITY[currentLevel]

  /**
   * emit 方法：封装带级别过滤与作用域前缀的日志输出函数。
   */
  const emit = (level, printer) => (...args) => {
    if (!shouldLog(level)) return
    printer(prefix, ...args)
  }

  return {
    /**
     * getLevel 方法：返回当前生效的日志级别。
     */
    getLevel() {
      return currentLevel
    },
    /**
     * setLevel 方法：更新并返回新的日志级别。
     */
    setLevel(level) {
      currentLevel = normalizeLogLevel(level, currentLevel)
      return currentLevel
    },
    /**
     * refreshFromEnv 方法：从环境变量刷新日志级别配置。
     */
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
