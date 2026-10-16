/**
 * 实验性 Android 签名候选函数，尚未验证与官方实现兼容。
 * 固定向量测试只验证本地计算一致性，不证明服务端接受。
 *
 * 覆盖请求头：
 * - x-khronos: Unix 秒级时间戳
 * - x-ladon:   protobuf 字节 → 16 字节大端 uint32 四元组 → 4 轮 Feistel 变换 → Base64
 * - x-argus:   同一 Feistel 核心 → 4 个 uint32 的 hex 串
 * - x-gorgon:  md5(khronos) 前 4 位 + md5(query)/md5(body) 首 2 字节交换 → 去重下标打包
 * 以及 POST body 的 x-ss-stub（body MD5 大写 HEX）。
 */

const crypto = require('crypto')

const FEISTEL_CONSTS = Object.freeze([0xe489d5a4, 0xe963a41f, 0xb5c929f6, 0x873563b1])

function leftRotate32(value, bits) {
  const n = value >>> 0
  return ((n << bits) | (n >>> (32 - bits))) >>> 0
}

function func0(a, b, c) {
  return (
    leftRotate32(a, 1) ^
    leftRotate32(b, 8) ^
    leftRotate32(c, 16) ^
    leftRotate32(c, 24)
  ) >>> 0
}

function func1(a, b, c) {
  return (
    leftRotate32(a, 1) ^
    leftRotate32(b, 8) ^
    leftRotate32(c, 7) ^
    leftRotate32(b, 16)
  ) >>> 0
}

function func2(a, b, c) {
  return (
    leftRotate32(a, 1) ^
    leftRotate32(b, 8) ^
    leftRotate32(c, 16) ^
    leftRotate32(a, 24)
  ) >>> 0
}

function func3(a, b, c) {
  return (
    leftRotate32(a, 1) ^
    leftRotate32(b, 8) ^
    leftRotate32(b, 7) ^
    leftRotate32(c, 24)
  ) >>> 0
}

const FEISTEL_FUNCS = Object.freeze([func0, func1, func2, func3])

/**
 * protobuf 风格编码：按 key 升序，第 i 对写 [2i, len(k), k..., 2i+1, len(v), v...]
 * 返回 number[]（字节列表）
 */
function buildProtobufLikeBytes(params = {}) {
  const keys = Object.keys(params || {}).sort()
  const list = []
  keys.forEach((key, i) => {
    const k = Buffer.from(String(key), 'utf8')
    const raw = params[key]
    const v = Buffer.from(raw === null || raw === undefined ? '' : String(raw), 'utf8')
    list.push(2 * i, k.length)
    for (const b of k) list.push(b)
    list.push(2 * i + 1, v.length)
    for (const b of v) list.push(b)
  })
  return list
}

/**
 * 取 protobuf 字节列表首元素之后的内容，补齐/截断到 16 字节
 */
function packTo16(pbList) {
  const body = (pbList || []).slice(1, 17)
  const bytes = new Array(16).fill(0)
  for (let i = 0; i < body.length && i < 16; i += 1) {
    bytes[i] = body[i] & 0xff
  }
  return Buffer.from(bytes)
}

/**
 * 4 轮 Feistel 混合变换
 */
function feistelTransform(buf) {
  let a = buf.readUInt32BE(0)
  let b = buf.readUInt32BE(4)
  let c = buf.readUInt32BE(8)
  let d = buf.readUInt32BE(12)
  for (let i = 0; i < 4; i += 1) {
    const f = FEISTEL_FUNCS[i]
    const k = FEISTEL_CONSTS[i]
    const e = a, f2 = b, g = c, h = d
    a = (f(b, c, d) ^ e ^ k) >>> 0
    b = (f(c, d, a) ^ f2 ^ k) >>> 0
    c = (f(d, a, b) ^ g ^ k) >>> 0
    d = (f(a, b, c) ^ h ^ k) >>> 0
  }
  return [a, b, c, d]
}

function md5Bytes(text) {
  return crypto.createHash('md5').update(String(text), 'utf8').digest()
}

/** x-khronos：秒级时间戳 */
function getXKhronos() {
  return String(Math.floor(Date.now() / 1000))
}

/** x-ss-stub：body 的 MD5 大写 HEX */
function getXSsStub(body) {
  if (!body) return ''
  // Hash the bytes that are transmitted, including non-UTF-8 payloads.
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8')
  return crypto.createHash('md5').update(bytes).digest('hex').toUpperCase()
}

/** x-ladon：16 字节 Feistel 结果的 Base64 */
function getXLadon(pbList) {
  const packed = packTo16(pbList)
  const [a, b, c, d] = feistelTransform(packed)
  const buf = Buffer.alloc(16)
  buf.writeUInt32BE(a, 0)
  buf.writeUInt32BE(b, 4)
  buf.writeUInt32BE(c, 8)
  buf.writeUInt32BE(d, 12)
  return buf.toString('base64')
}

/** x-argus：同一核心的 hex 串输出 */
function getXArgus(pbList) {
  const packed = packTo16(pbList)
  const result = feistelTransform(packed)
  return result.map((n) => (n >>> 0).toString(16).padStart(8, '0')).join('')
}

/**
 * x-gorgon：
 * head = md5(khronos)[:4] 的 4 个 nibble
 * + md5(query) 首 2 字节（交换）+ md5(body) 首 2 字节（交换）
 * 去重排序 → 每个元素取下标 → 两两打包为一字节 → `004-` + hex
 */
function getYGorgonParts(khronos, query = '', body = '') {
  const s = md5Bytes(khronos).subarray(0, 2)
  const head = []
  for (const byte of s) {
    head.push(byte >> 4, byte & 0x0f)
  }
  if (query) {
    const dq = md5Bytes(query)
    head.push(dq[1], dq[0])
  }
  if (body) {
    const db = md5Bytes(body)
    head.push(db[1], db[0])
  }
  return head
}

function getXGorgon(khronos, query = '', body = '') {
  const head = getYGorgonParts(khronos, query, body)
  if (head.length === 0) return ''
  const uniqueList = Array.from(new Set(head)).sort((x, y) => x - y)
  const indices = head.map((v) => uniqueList.indexOf(v))

  const packed = []
  for (let i = 0; i + 1 < indices.length; i += 2) {
    packed.push(((indices[i] << 4) | (indices[i + 1] & 0x0f)) & 0xff)
  }

  const hexBody = packed.map((b) => b.toString(16).padStart(2, '0')).join('')
  return `004-${hexBody}`
}

/** 将 query 串还原成 { key: value } 字典，用于 protobuf 编码 */
function parseQueryToParams(queryString = '') {
  const params = {}
  const text = String(queryString || '')
  if (!text) return params
  for (const pair of text.split('&')) {
    if (!pair) continue
    const idx = pair.indexOf('=')
    if (idx === -1) {
      params[decodeURIComponent(pair)] = ''
    } else {
      params[decodeURIComponent(pair.slice(0, idx))] = decodeURIComponent(pair.slice(idx + 1))
    }
  }
  return params
}

/**
 * 一次性产出 Android 原生请求头
 * @param {object} ctx
 * @param {string} ctx.query - 已编码的 query 串（不含 '?'）
 * @param {string|Buffer} [ctx.body] - POST body
 * @param {Record<string, any>} [ctx.params] - 参数字典（提供时优先用于 protobuf 编码）
 */
function signAndroidHeaders({ query = '', body = '', params = null } = {}) {
  const pbList = params
    ? buildProtobufLikeBytes(params)
    : buildProtobufLikeBytes(parseQueryToParams(query))

  const khronos = getXKhronos()
  const bodyText = body
    ? (Buffer.isBuffer(body) ? body.toString('utf8') : String(body))
    : ''

  const headers = {
    'x-khronos': khronos,
    'x-ladon': getXLadon(pbList),
    'x-argus': getXArgus(pbList),
    'x-gorgon': getXGorgon(khronos, query, bodyText)
  }
  if (bodyText) {
    headers['x-ss-stub'] = getXSsStub(bodyText)
  }
  return headers
}

/* ------------------------------------------------------------------ *
 * 候选软件签名 experimental-aes-v2；没有平台接受或设备绑定认证的证据。
 * 线上候选头：x-argus、x-ss-req-ticket；下面的 security AES 仅保留作离线历史向量。
 * 加密：AES-128-CBC，key="security" 前 8 字节 + 补零，IV 全零，NoPadding，零填充。
 * ------------------------------------------------------------------ */

const NATIVE_AES_KEY = Buffer.from([115, 101, 99, 117, 114, 105, 116, 121, 0, 0, 0, 0, 0, 0, 0, 0])
const NATIVE_AES_IV = Buffer.alloc(16, 0)

function aesCbcEncrypt(data) {
  const cipher = crypto.createCipheriv('aes-128-cbc', NATIVE_AES_KEY, NATIVE_AES_IV)
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(data), cipher.final()])
}

function zeroPad16(buf) {
  const pad = (16 - (buf.length % 16)) % 16
  return pad ? Buffer.concat([buf, Buffer.alloc(pad, 0)]) : buf
}

function buildSortedParamString(params = {}) {
  const keys = Object.keys(params || {}).sort()
  return keys
    .map((k) => {
      const raw = params[k]
      return `${k}=${raw === null || raw === undefined ? '' : String(raw)}`
    })
    .join('&')
}

/**
 * x-argus（package1）
 * raw = str(ts) + md5(sortedParamStr)[:8] + sortedParamStr，零填充到 16 的倍数，AES-CBC。
 */
function nativeXArgus(params, timestamp) {
  const paramStr = buildSortedParamString(params)
  const md5First8 = md5Bytes(paramStr).subarray(0, 8)
  const raw = Buffer.concat([
    Buffer.from(String(timestamp), 'utf8'),
    md5First8,
    Buffer.from(paramStr, 'utf8')
  ])
  return aesCbcEncrypt(zeroPad16(raw)).toString('hex').toUpperCase()
}

/**
 * x-security-argus（两层）
 * 一层字符串 = 时间戳各位数字 + [204]
 * 二层字符串 = 以 md5(sortedParamStr) 字节填充的固定模板 (+ body 时追加 [204, md5(body)[0..3]])
 * 组合 = 一层 + 二层，零填充后 AES-CBC，hex 大写。
 */
function getSecurityFirstLayer(timestamp) {
  const digits = String(timestamp).split('').map((c) => Number(c))
  return [...digits, 204]
}

function getSecuritySecondLayer(md5Digest, bodyText) {
  const q = md5Digest
  const list = [
    q[2], q[15], q[3], 204, q[5], q[8], q[9], q[6], q[7], 204,
    q[10], q[3], q[12], 204, 2, 11, 11, 204, 4, 11, 7, q[13], 204,
    8, 9, 10, 11, 13, 14, 2, 11, 12, 4, 2, 11, 1, 204, 0, 9, 5, 4,
    204, 3, 6, 0, 7, 8, 1, 2, 15, 9, 15, 5, 0, 7, 13, 14, 6, 10, 2, 7, 3, 13, 1
  ]
  if (bodyText) {
    const mb = md5Bytes(bodyText)
    list.push(204, mb[0], mb[1], mb[2], mb[3])
  }
  return list
}

function nativeXSecurityArgus(params, timestamp, body = '') {
  const paramStr = buildSortedParamString(params)
  const bodyText = body ? (Buffer.isBuffer(body) ? body.toString('utf8') : String(body)) : ''
  const first = getSecurityFirstLayer(timestamp)
  const second = getSecuritySecondLayer(md5Bytes(paramStr), bodyText)
  return aesCbcEncrypt(zeroPad16(Buffer.from([...first, ...second]))).toString('hex').toUpperCase()
}

/**
 * 一次性产出候选签名头，不能据此认定 TicketGuard 已就绪。
 * @param {object} ctx
 * @param {string} [ctx.query] - 原始 query 串（不含 '?'），当未提供 params 时使用
 * @param {Record<string, any>} [ctx.params] - 参数字典（优先）
 * @param {string|Buffer} [ctx.body] - POST body
 * @param {number|string} [ctx.timestamp] - 秒级时间戳，缺省用当前时间
 * @param {number} [ctx.requestTicketMs] - 请求层在签名前确定的毫秒时间戳
 * @param {boolean} [ctx.passport] - Passport 移动接口样本中仅出现请求票据，无 x-argus
 */
function signNativeAndroidHeaders({ query = '', params = null, body = '', timestamp, requestTicketMs, passport = false } = {}) {
  const resolvedParams = params || parseQueryToParams(query)
  const ticketMs = requestTicketMs !== undefined ? Number(requestTicketMs) : timestamp !== undefined && timestamp !== null && timestamp !== ''
    ? Number(timestamp) * 1000
    : Date.now()
  if (!Number.isSafeInteger(ticketMs) || ticketMs <= 0) throw new Error('Invalid request timestamp')
  if (passport) {
    // Trusted capture: the Passport mobile endpoints carry only x-ss-req-ticket.
    return { 'x-ss-req-ticket': String(ticketMs) }
  }
  const ts = Math.floor(ticketMs / 1000)

  return {
    'x-argus': nativeXArgus(resolvedParams, ts),
    // Official SsInterceptor uses System.currentTimeMillis(), independently of
    // the seconds used by this still-unverified candidate x-argus algorithm.
    'x-ss-req-ticket': String(ticketMs)
  }
}

module.exports = {
  FEISTEL_CONSTS,
  leftRotate32,
  func0,
  func1,
  func2,
  func3,
  feistelTransform,
  buildProtobufLikeBytes,
  packTo16,
  getXKhronos,
  getXSsStub,
  getXLadon,
  getXArgus,
  getYGorgonParts,
  getXGorgon,
  parseQueryToParams,
  signAndroidHeaders,
  // 实验性候选计算，不包含真实 TicketGuard 设备密钥证明
  NATIVE_AES_KEY,
  NATIVE_AES_IV,
  aesCbcEncrypt,
  zeroPad16,
  buildSortedParamString,
  nativeXArgus,
  nativeXSecurityArgus,
  signNativeAndroidHeaders
}
