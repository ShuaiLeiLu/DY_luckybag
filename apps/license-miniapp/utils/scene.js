function safeDecode(value) {
  try {
    return decodeURIComponent(String(value || '').trim())
  } catch (_) {
    return String(value || '').trim()
  }
}

function parseSceneCode(input) {
  const raw = String(input || '').trim()
  if (!raw) return ''

  const extractFromQuery = (queryString) => {
    const params = {}
    String(queryString || '')
      .replace(/^\?/, '')
      .split('&')
      .forEach((pair) => {
        if (!pair) return
        const [rawKey, rawValue] = pair.split('=')
        const key = safeDecode(rawKey)
        if (!key) return
        params[key] = safeDecode(rawValue)
      })
    return params.scene || params.sceneCode || params.bindToken || ''
  }

  const queryIndex = raw.indexOf('?')
  if (queryIndex >= 0) {
    const fromQuery = extractFromQuery(raw.slice(queryIndex + 1))
    if (fromQuery) return fromQuery
  }

  const sceneMatch = raw.match(/(?:^|[?&])(scene|sceneCode|bindToken)=([^&]+)/i)
  if (sceneMatch && sceneMatch[2]) {
    return safeDecode(sceneMatch[2])
  }

  return safeDecode(raw)
}

function parseSceneFromScanResult(scanResult) {
  if (!scanResult) return ''
  const path = String(scanResult.path || '').trim()
  if (path) {
    return parseSceneCode(path)
  }
  const result = String(scanResult.result || '').trim()
  if (result) {
    return parseSceneCode(result)
  }
  return ''
}

module.exports = {
  parseSceneCode,
  parseSceneFromScanResult
}
