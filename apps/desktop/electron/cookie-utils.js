const crypto = require('crypto')

function normalizeCookieHeaderString(raw = '') {
  return String(raw || '')
    .replace(/\r?\n/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function doesCookieDomainMatchHost(domain = '', host = '') {
  const normalizedDomain = String(domain || '').replace(/^\./, '').trim().toLowerCase()
  const normalizedHost = String(host || '').trim().toLowerCase()
  if (!normalizedDomain || !normalizedHost) return false
  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`)
}

function cookieHostScore(cookie = {}, host = '') {
  const normalizedHost = String(host || '').trim().toLowerCase()
  const domain = String(cookie?.domain || '').replace(/^\./, '').trim().toLowerCase()
  if (!domain) return 0
  if (domain === normalizedHost) return 3
  if (domain === 'douyin.com') return 2
  if (normalizedHost.endsWith(`.${domain}`)) return 1
  return 0
}

function buildCookieStringForHost(cookies = [], host = 'live.douyin.com') {
  const normalizedHost = String(host || '').trim().toLowerCase()
  const bestByName = new Map()
  for (const item of Array.isArray(cookies) ? cookies : []) {
    const name = String(item?.name || '').trim()
    const value = String(item?.value || '').trim()
    if (!name || !value) continue
    const domain = String(item?.domain || '').trim()
    if (domain && !doesCookieDomainMatchHost(domain, normalizedHost)) continue
    const current = bestByName.get(name)
    if (!current) {
      bestByName.set(name, item)
      continue
    }
    const currentScore = cookieHostScore(current, normalizedHost)
    const nextScore = cookieHostScore(item, normalizedHost)
    if (nextScore > currentScore) {
      bestByName.set(name, item)
      continue
    }
    if (nextScore === currentScore) {
      const currentPathLen = String(current?.path || '').length
      const nextPathLen = String(item?.path || '').length
      if (nextPathLen > currentPathLen) {
        bestByName.set(name, item)
      }
    }
  }
  const header = Array.from(bestByName.values())
    .filter(c => c?.name && c?.value)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    .map(c => `${c.name}=${c.value}`)
    .join('; ')
  return normalizeCookieHeaderString(header)
}

function normalizeCookieSnapshotItem(cookie = {}) {
  const name = String(cookie?.name || '').trim()
  const value = String(cookie?.value || '').trim()
  if (!name || !value) return null
  const domain = String(cookie?.domain || '').trim()
  const pathValue = String(cookie?.path || '/').trim() || '/'
  const sameSiteRaw = String(cookie?.sameSite || 'unspecified').trim().toLowerCase()
  const sameSite = ['no_restriction', 'lax', 'strict', 'unspecified'].includes(sameSiteRaw)
    ? sameSiteRaw
    : 'unspecified'
  return {
    name,
    value,
    domain,
    path: pathValue,
    secure: cookie?.secure !== false,
    httpOnly: !!cookie?.httpOnly,
    session: !!cookie?.session,
    expirationDate: Number(cookie?.expirationDate || 0),
    sameSite
  }
}

function resolveCookieUrlFromSnapshot(cookie = {}) {
  const domain = String(cookie?.domain || '').replace(/^\./, '').trim().toLowerCase()
  if (domain.includes('live.douyin.com')) return 'https://live.douyin.com/'
  return 'https://www.douyin.com/'
}

function parseCookieString(cookieString = '') {
  const result = {}
  String(cookieString || '')
    .split(';')
    .forEach((item) => {
      const index = item.indexOf('=')
      if (index <= 0) return
      const key = item.slice(0, index).trim()
      const value = item.slice(index + 1).trim()
      if (key) result[key] = value
    })
  return result
}

function normalizeCookieValue(name, rawValue) {
  let value = String(rawValue ?? '').trim().replace(/[\r\n]/g, '')
  if (!value) return ''
  const kvPrefix = `${name}=`
  if (value.startsWith(kvPrefix)) {
    value = value.slice(kvPrefix.length).trim()
  }
  const semiIdx = value.indexOf(';')
  if (semiIdx >= 0) {
    value = value.slice(0, semiIdx).trim()
  }
  return value
}

function cookieObjToString(cookieObj) {
  const parts = []
  for (const [key, value] of Object.entries(cookieObj || {})) {
    if (value) {
      parts.push(`${key}=${value}`)
    }
  }
  return parts.join('; ')
}

function generateMsToken(length = 120) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789='
  const bytes = crypto.randomBytes(length)
  let token = ''
  for (let i = 0; i < length; i++) {
    token += chars[bytes[i] % chars.length]
  }
  return token
}

function extractParamsFromCookie(cookieString) {
  const cookies = {}
  if (cookieString) {
    cookieString.split(';').forEach(cookie => {
      const [key, value] = cookie.trim().split('=')
      if (key && value) {
        cookies[key] = value
      }
    })
  }

  return {
    msToken: generateMsToken(),
    verifyFp: cookies.s_v_web_id || null,
    fp: cookies.s_v_web_id || null,
    screen_width: cookies.dy_swidth || '2560',
    screen_height: cookies.dy_sheight || '1440',
    cpu_core_num: cookies.device_web_cpu_core || '24',
    device_memory: cookies.device_web_memory_size || '8'
  }
}

module.exports = {
  normalizeCookieHeaderString,
  doesCookieDomainMatchHost,
  cookieHostScore,
  buildCookieStringForHost,
  normalizeCookieSnapshotItem,
  resolveCookieUrlFromSnapshot,
  parseCookieString,
  normalizeCookieValue,
  cookieObjToString,
  generateMsToken,
  extractParamsFromCookie
}
