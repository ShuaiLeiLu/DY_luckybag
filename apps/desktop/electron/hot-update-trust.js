const crypto = require('node:crypto')
function canonicalJSON(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJSON(value[key])).join(',') + '}'
  return JSON.stringify(value)
}
function secureResourceURL(value, parent) {
  const url = new URL(value, parent)
  const loopback = ['127.0.0.1','localhost','[::1]'].includes(url.hostname)
  if (url.username || url.password || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))) throw new Error('更新资源需要 HTTPS，HTTP 仅允许本机地址')
  if (parent && url.origin !== new URL(parent).origin) throw new Error('更新资源必须与清单同源')
  return url.toString()
}
function verifyManifest(raw, publicKey, manifestUrl) {
  if (!publicKey) throw new Error('未配置热更新公钥')
  const { signature, ...payload } = raw || {}
  if (typeof signature !== 'string' || !crypto.verify(null, Buffer.from(canonicalJSON(payload)), publicKey, Buffer.from(signature,'base64'))) throw new Error('热更新清单签名验证失败')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(payload.version || '') || payload.version.includes('..')) throw new Error('更新版本号非法')
  secureResourceURL(manifestUrl)
  return payload
}
module.exports = { canonicalJSON, secureResourceURL, verifyManifest }
