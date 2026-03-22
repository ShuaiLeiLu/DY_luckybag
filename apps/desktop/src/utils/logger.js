const LEVEL_PRIORITY = Object.freeze({
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
})

const STORAGE_KEY = 'DY_LOG_LEVEL'

/**
 * 规范化日志级别。
 * @param {string} raw 原始级别
 * @param {string} fallback 兜底级别
 * @returns {'error'|'warn'|'info'|'debug'}
 */
function normalizeLogLevel(raw, fallback = 'info') {
  const value = String(raw || '').trim().toLowerCase()
  if (Object.prototype.hasOwnProperty.call(LEVEL_PRIORITY, value)) {
    return value
  }
  return fallback
}

/**
 * 返回前端默认日志级别。
 * @returns {string}
 */
function defaultLogLevel() {
  return 'warn'
}

/**
 * 从 window/localStorage 中读取日志级别。
 * @returns {string}
 */
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

/**
 * 解析最终日志级别（window > env > fallback）。
 * @param {string} fallback 兜底级别
 * @returns {string}
 */
function resolveLogLevel(fallback = defaultLogLevel()) {
  const envLevel = import.meta.env?.VITE_LOG_LEVEL || ''
  const windowLevel = readWindowLevel()
  return normalizeLogLevel(windowLevel || envLevel, normalizeLogLevel(fallback, 'info'))
}

/**
 * 设置全局日志级别并持久化到 localStorage。
 * @param {string} level 日志级别
 * @returns {string}
 */
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

/**
 * 创建前端日志实例。
 * @param {string} scope 日志命名空间
 * @param {{defaultLevel?: string}} options 配置项
 * @returns {{getLevel:Function,setLevel:Function,refreshFromWindow:Function,error:Function,warn:Function,info:Function,debug:Function}}
 */
export function createLogger(scope = 'renderer', options = {}) {
  let currentLevel = resolveLogLevel(options.defaultLevel || defaultLogLevel())
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
     * refreshFromWindow 方法：从窗口配置刷新日志级别，保持前后端一致。
     */
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
