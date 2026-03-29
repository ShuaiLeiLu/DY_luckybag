const defaults = require('./config.example')

let localOverrides = {}
try {
  localOverrides = require('./config.local')
} catch (error) {
  if (!error || error.code !== 'MODULE_NOT_FOUND') {
    throw error
  }
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function readStoredEnv() {
  try {
    if (typeof wx !== 'undefined' && wx && typeof wx.getStorageSync === 'function') {
      const raw = wx.getStorageSync('miniappActiveEnv')
      return String(raw || '').trim()
    }
  } catch (_) {}
  return ''
}

function writeStoredEnv(nextEnv) {
  try {
    if (typeof wx !== 'undefined' && wx && typeof wx.setStorageSync === 'function') {
      wx.setStorageSync('miniappActiveEnv', String(nextEnv || '').trim())
      return true
    }
  } catch (_) {}
  return false
}

const defaultEnvs = isPlainObject(defaults.ENVIRONMENTS) ? defaults.ENVIRONMENTS : {}
const localEnvs = isPlainObject(localOverrides.ENVIRONMENTS) ? localOverrides.ENVIRONMENTS : {}
const environments = {
  ...defaultEnvs,
  ...localEnvs
}

const configuredEnv = String(localOverrides.ACTIVE_ENV || '').trim()
const storedEnv = readStoredEnv()
const defaultEnv = String(defaults.ACTIVE_ENV || '').trim()
const activeEnv = configuredEnv || storedEnv || defaultEnv || 'local'

const envProfile = isPlainObject(environments[activeEnv]) ? environments[activeEnv] : {}

const merged = {
  ...defaults,
  ...localOverrides,
  ENVIRONMENTS: environments,
  ACTIVE_ENV: activeEnv,
  ...envProfile
}

module.exports = {
  ...merged,
  getAvailableEnvs() {
    return Object.keys(environments)
  },
  setActiveEnv(nextEnv) {
    const target = String(nextEnv || '').trim()
    if (!target || !isPlainObject(environments[target])) {
      return false
    }
    return writeStoredEnv(target)
  }
}
