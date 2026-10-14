/**
 * 抖音 Android 原生协议签名算法（社区公开参考实现的 JS 转写）
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
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body)
  return crypto.createHash('md5').update(text, 'utf8').digest('hex').toUpperCase()
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
  signAndroidHeaders
}
