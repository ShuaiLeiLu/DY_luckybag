function safeDecode(value) {
  try {
    return decodeURIComponent(String(value || '').trim())
  } catch (_) {
    return String(value || '').trim()
  }
}

const SCENE_CODE_RE = /^b[0-9a-z]+-[0-9a-f]{6,32}$/i
const BIND_TOKEN_RE = /^BT-[A-Z0-9-]{8,}$/i

function normalizeText(value) {
  const raw = safeDecode(value)
  if (!raw) return ''
  let text = String(raw).trim()
  if (!text) return ''
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim()
  }
  return text
}

function isValidBindRef(value) {
  const text = normalizeText(value)
  if (!text) return false
  return SCENE_CODE_RE.test(text) || BIND_TOKEN_RE.test(text)
}

function extractBindRef(value) {
  const text = normalizeText(value)
  if (!text) return ''
  if (isValidBindRef(text)) return text

  const marker = text.match(/(?:^|[?&#=\s])(b[0-9a-z]+-[0-9a-f]{6,32}|BT-[A-Z0-9-]{8,})(?:$|[?&#\s])/i)
  if (marker && marker[1] && isValidBindRef(marker[1])) {
    return normalizeText(marker[1])
  }
  return ''
}

function extractFromQuery(queryString) {
  if (!queryString) return ''
  const params = {}
  String(queryString)
    .replace(/^\?/, '')
    .split('&')
    .forEach((pair) => {
      if (!pair) return
      const [rawKey, rawValue] = pair.split('=')
      const key = normalizeText(rawKey)
      if (!key) return
      params[key] = normalizeText(rawValue)
    })

  const candidates = [params.scene, params.sceneCode, params.bindToken]
  for (const value of candidates) {
    const hit = extractBindRef(value)
    if (hit) return hit
  }
  return ''
}

function parseSceneCode(input) {
  const raw = normalizeText(input)
  if (!raw) return ''
  const directHit = extractBindRef(raw)
  if (directHit) return directHit

  const queryIndex = raw.indexOf('?')
  if (queryIndex >= 0) {
    const fromQuery = extractFromQuery(raw.slice(queryIndex + 1))
    if (fromQuery) return fromQuery
  }

  const sceneMatch = raw.match(/(?:^|[?&#])(scene|sceneCode|bindToken)=([^&#]+)/i)
  if (sceneMatch && sceneMatch[2]) {
    const value = extractBindRef(sceneMatch[2])
    if (value) return value
  }

  return ''
}

function parseSceneFromScanResult(scanResult) {
  if (!scanResult) return ''
  const candidates = [
    scanResult.path,
    scanResult.result,
    scanResult.rawData
  ]

  for (const item of candidates) {
    const hit = parseSceneCode(item)
    if (hit) return hit
  }

  return ''
}

module.exports = {
  parseSceneCode,
  parseSceneFromScanResult
}
