const https = require('https')

/**
 * 完整的抖音直播API签名算法
 */

// ==================== 辅助函数 ====================

function se(str, length, ch) {
  const s = String(str)
  if (s.length >= length) return s
  return ch.repeat(length - s.length) + s
}

// ==================== RC4加密 ====================

function rc4_encrypt(plaintext, key) {
  const s = []
  for (var i = 0; i < 256; i++) {
    s[i] = i
  }
  var j = 0
  for (var i = 0; i < 256; i++) {
    j = (j + s[i] + key.charCodeAt(i % key.length)) % 256
    var temp = s[i]
    s[i] = s[j]
    s[j] = temp
  }
  var i = 0
  var j = 0
  const cipher = []
  for (let k = 0; k < plaintext.length; k++) {
    i = (i + 1) % 256
    j = (j + s[i]) % 256
    var temp = s[i]
    s[i] = s[j]
    s[j] = temp
    const t = (s[i] + s[j]) % 256
    cipher.push(String.fromCharCode(s[t] ^ plaintext.charCodeAt(k)))
  }
  return cipher.join('')
}

// ==================== SM3哈希算法 ====================

function le(e, r) {
  return ((e << (r %= 32)) | (e >>> (32 - r))) >>> 0
}

function de(e) {
  return 0 <= e && e < 16 ? 2043430169 : 16 <= e && e < 64 ? 2055708042 : void 0
}

function pe(e, r, t, n) {
  return 0 <= e && e < 16 ? (r ^ t ^ n) >>> 0 : 16 <= e && e < 64 ? ((r & t) | (r & n) | (t & n)) >>> 0 : (void 0, 0)
}

function he(e, r, t, n) {
  return 0 <= e && e < 16 ? (r ^ t ^ n) >>> 0 : 16 <= e && e < 64 ? ((r & t) | (~r & n)) >>> 0 : (void 0, 0)
}

function reset() {
  this.reg[0] = 1937774191
  this.reg[1] = 1226093241
  this.reg[2] = 388252375
  this.reg[3] = 3666478592
  this.reg[4] = 2842636476
  this.reg[5] = 372324522
  this.reg[6] = 3817729613
  this.reg[7] = 2969243214
  this['chunk'] = []
  this['size'] = 0
}

function write(e) {
  const a =
    'string' == typeof e
      ? (function (e2) {
          const n = encodeURIComponent(e2)['replace'](/%([0-9A-F]{2})/g, function (e3, r) {
            return String['fromCharCode']('0x' + r)
          })
          const a2 = new Array(n['length'])
          return (
            Array['prototype']['forEach']['call'](n, function (e3, r) {
              a2[r] = e3.charCodeAt(0)
            }),
            a2
          )
        })(e)
      : e
  this.size += a.length
  let f = 64 - this['chunk']['length']
  if (a['length'] < f) this['chunk'] = this['chunk'].concat(a)
  else
    for (this['chunk'] = this['chunk'].concat(a.slice(0, f)); this['chunk'].length >= 64; )
      this['_compress'](this['chunk']),
        f < a['length'] ? (this['chunk'] = a['slice'](f, Math['min'](f + 64, a['length']))) : (this['chunk'] = []),
        (f += 64)
}

function sum(e, t) {
  e && (this['reset'](), this['write'](e)), this['_fill']()
  for (var f = 0; f < this.chunk['length']; f += 64) this._compress(this['chunk']['slice'](f, f + 64))
  let i = null
  if (t == 'hex') {
    i = ''
    for (f = 0; f < 8; f++) i += se(this['reg'][f]['toString'](16), 8, '0')
  } else
    for (i = new Array(32), f = 0; f < 8; f++) {
      let c = this.reg[f]
      ;(i[4 * f + 3] = (255 & c) >>> 0),
        (c >>>= 8),
        (i[4 * f + 2] = (255 & c) >>> 0),
        (c >>>= 8),
        (i[4 * f + 1] = (255 & c) >>> 0),
        (c >>>= 8),
        (i[4 * f] = (255 & c) >>> 0)
    }
  return this['reset'](), i
}

function _compress(t) {
  if (t < 64);
  else {
    for (
      var f = (function (e) {
          for (var r = new Array(132), t2 = 0; t2 < 16; t2++)
            (r[t2] = e[4 * t2] << 24),
              (r[t2] |= e[4 * t2 + 1] << 16),
              (r[t2] |= e[4 * t2 + 2] << 8),
              (r[t2] |= e[4 * t2 + 3]),
              (r[t2] >>>= 0)
          for (var n = 16; n < 68; n++) {
            let a = r[n - 16] ^ r[n - 9] ^ le(r[n - 3], 15)
            ;(a = a ^ le(a, 15) ^ le(a, 23)), (r[n] = (a ^ le(r[n - 13], 7) ^ r[n - 6]) >>> 0)
          }
          for (n = 0; n < 64; n++) r[n + 68] = (r[n] ^ r[n + 4]) >>> 0
          return r
        })(t),
        i = this['reg'].slice(0),
        c = 0;
      c < 64;
      c++
    ) {
      let o = le(i[0], 12) + i[4] + le(de(c), c),
        s = ((o = le((o = (4294967295 & o) >>> 0), 7)) ^ le(i[0], 12)) >>> 0,
        u = pe(c, i[0], i[1], i[2])
      u = (4294967295 & (u = u + i[3] + s + f[c + 68])) >>> 0
      let b = he(c, i[4], i[5], i[6])
      ;(b = (4294967295 & (b = b + i[7] + o + f[c])) >>> 0),
        (i[3] = i[2]),
        (i[2] = le(i[1], 9)),
        (i[1] = i[0]),
        (i[0] = u),
        (i[7] = i[6]),
        (i[6] = le(i[5], 19)),
        (i[5] = i[4]),
        (i[4] = (b ^ le(b, 9) ^ le(b, 17)) >>> 0)
    }
    for (let l = 0; l < 8; l++) this['reg'][l] = (this['reg'][l] ^ i[l]) >>> 0
  }
}

function _fill() {
  let a = 8 * this['size'],
    f = this['chunk']['push'](128) % 64
  for (64 - f < 8 && (f -= 64); f < 56; f++) this.chunk['push'](0)
  for (var i = 0; i < 4; i++) {
    const c = Math['floor'](a / 4294967296)
    this['chunk'].push((c >>> (8 * (3 - i))) & 255)
  }
  for (i = 0; i < 4; i++) this['chunk']['push']((a >>> (8 * (3 - i))) & 255)
}

function SM3() {
  this.reg = []
  this.chunk = []
  this.size = 0
  this.reset()
}

SM3.prototype.reset = reset
SM3.prototype.write = write
SM3.prototype.sum = sum
SM3.prototype._compress = _compress
SM3.prototype._fill = _fill

// ==================== Base64编码 ====================

function result_encrypt(long_str, num = null) {
  let temp_int
  const s_obj = {
    s0: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=',
    s1: 'Dkdpgh4ZKsQB80/Mfvw36XI1R25+WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe=',
    s2: 'Dkdpgh4ZKsQB80/Mfvw36XI1R25-WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe=',
    s3: 'ckdp1h4ZKsUB80/Mfvw36XIgR25+WQAlEi7NLboqYTOPuzmFjJnryx9HVGDaStCe',
    s4: 'Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnry79HbGcaStCe'
  }
  const constant = {
    0: 16515072,
    1: 258048,
    2: 4032,
    str: s_obj[num]
  }
  let result = ''
  let lound = 0
  let long_int = get_long_int(lound, long_str)
  for (let i = 0; i < (long_str.length / 3) * 4; i++) {
    if (Math.floor(i / 4) !== lound) {
      lound += 1
      long_int = get_long_int(lound, long_str)
    }
    const key = i % 4
    switch (key) {
      case 0:
        temp_int = (long_int & constant['0']) >> 18
        result += constant['str'].charAt(temp_int)
        break
      case 1:
        temp_int = (long_int & constant['1']) >> 12
        result += constant['str'].charAt(temp_int)
        break
      case 2:
        temp_int = (long_int & constant['2']) >> 6
        result += constant['str'].charAt(temp_int)
        break
      case 3:
        temp_int = long_int & 63
        result += constant['str'].charAt(temp_int)
        break
    }
  }
  return result
}

function get_long_int(round, long_str) {
  round = round * 3
  return (long_str.charCodeAt(round) << 16) | (long_str.charCodeAt(round + 1) << 8) | long_str.charCodeAt(round + 2)
}

// ==================== 随机数生成 ====================

function gener_random(random, option) {
  return [
    (random & 255 & 170) | (option[0] & 85), // 163
    (random & 255 & 85) | (option[0] & 170), //87
    (random >> 8 & 255 & 170) | (option[1] & 85), //37
    (random >> 8 & 255 & 85) | (option[1] & 170) //41
  ]
}

function generate_random_str() {
  let random_str_list = []
  random_str_list = random_str_list.concat(gener_random(Math.random() * 1e4, [3, 45]))
  random_str_list = random_str_list.concat(gener_random(Math.random() * 1e4, [1, 0]))
  random_str_list = random_str_list.concat(gener_random(Math.random() * 1e4, [1, 5]))
  return String.fromCharCode.apply(null, random_str_list)
}

// ==================== 签名生成 ====================

function generate_rc4_bb_str(url_search_params, user_agent, window_env_str, suffix = 'cus', Arguments = [0, 1, 14]) {
  const sm3 = new SM3()
  const start_time = Date.now()
  const url_search_params_list = sm3.sum(sm3.sum(url_search_params + suffix))
  const cus = sm3.sum(sm3.sum(suffix))
  const ua = sm3.sum(result_encrypt(rc4_encrypt(user_agent, String.fromCharCode.apply(null, [390625e-8, 1, Arguments[2]])), 's3'))
  const end_time = Date.now()
  const b = {
    8: 3, // 固定
    10: end_time, //3次加密结束时间
    15: {
      aid: 6383,
      pageId: 6241
    },
    16: start_time, //3次加密开始时间
    18: 44
  }
  b[20] = (b[16] >> 24) & 255
  b[21] = (b[16] >> 16) & 255
  b[22] = (b[16] >> 8) & 255
  b[23] = b[16] & 255
  b[24] = (b[16] / 256 / 256 / 256 / 256) >> 0
  b[25] = (b[16] / 256 / 256 / 256 / 256 / 256) >> 0
  b[26] = (Arguments[0] >> 24) & 255
  b[27] = (Arguments[0] >> 16) & 255
  b[28] = (Arguments[0] >> 8) & 255
  b[29] = Arguments[0] & 255
  b[30] = (Arguments[1] / 256) & 255
  b[31] = (Arguments[1] % 256) & 255
  b[32] = (Arguments[1] >> 24) & 255
  b[33] = (Arguments[1] >> 16) & 255
  b[34] = (Arguments[2] >> 24) & 255
  b[35] = (Arguments[2] >> 16) & 255
  b[36] = (Arguments[2] >> 8) & 255
  b[37] = Arguments[2] & 255
  b[38] = url_search_params_list[21]
  b[39] = url_search_params_list[22]
  b[40] = cus[21]
  b[41] = cus[22]
  b[42] = ua[23]
  b[43] = ua[24]
  b[44] = (b[10] >> 24) & 255
  b[45] = (b[10] >> 16) & 255
  b[46] = (b[10] >> 8) & 255
  b[47] = b[10] & 255
  b[48] = b[8]
  b[49] = (b[10] / 256 / 256 / 256 / 256) >> 0
  b[50] = (b[10] / 256 / 256 / 256 / 256 / 256) >> 0
  b[51] = b[15]['pageId']
  b[52] = (b[15]['pageId'] >> 24) & 255
  b[53] = (b[15]['pageId'] >> 16) & 255
  b[54] = (b[15]['pageId'] >> 8) & 255
  b[55] = b[15]['pageId'] & 255
  b[56] = b[15]['aid']
  b[57] = b[15]['aid'] & 255
  b[58] = (b[15]['aid'] >> 8) & 255
  b[59] = (b[15]['aid'] >> 16) & 255
  b[60] = (b[15]['aid'] >> 24) & 255
  const window_env_list = []
  for (let index = 0; index < window_env_str.length; index++) {
    window_env_list.push(window_env_str.charCodeAt(index))
  }
  b[64] = window_env_list.length
  b[65] = b[64] & 255
  b[66] = (b[64] >> 8) & 255
  b[69] = [].length
  b[70] = b[69] & 255
  b[71] = (b[69] >> 8) & 255
  b[72] =
    b[18] ^
    b[20] ^
    b[26] ^
    b[30] ^
    b[38] ^
    b[40] ^
    b[42] ^
    b[21] ^
    b[27] ^
    b[31] ^
    b[35] ^
    b[39] ^
    b[41] ^
    b[43] ^
    b[22] ^
    b[28] ^
    b[32] ^
    b[36] ^
    b[23] ^
    b[29] ^
    b[33] ^
    b[37] ^
    b[44] ^
    b[45] ^
    b[46] ^
    b[47] ^
    b[48] ^
    b[49] ^
    b[50] ^
    b[24] ^
    b[25] ^
    b[52] ^
    b[53] ^
    b[54] ^
    b[55] ^
    b[57] ^
    b[58] ^
    b[59] ^
    b[60] ^
    b[65] ^
    b[66] ^
    b[70] ^
    b[71]
  let bb = [
    b[18],
    b[20],
    b[52],
    b[26],
    b[30],
    b[34],
    b[58],
    b[38],
    b[40],
    b[53],
    b[42],
    b[21],
    b[27],
    b[54],
    b[55],
    b[31],
    b[35],
    b[57],
    b[39],
    b[41],
    b[43],
    b[22],
    b[28],
    b[32],
    b[60],
    b[36],
    b[23],
    b[29],
    b[33],
    b[37],
    b[44],
    b[45],
    b[59],
    b[46],
    b[47],
    b[48],
    b[49],
    b[50],
    b[24],
    b[25],
    b[65],
    b[66],
    b[70],
    b[71]
  ]
  bb = bb.concat(window_env_list).concat(b[72])
  return rc4_encrypt(String.fromCharCode.apply(null, bb), String.fromCharCode.apply(null, [121]))
}

function sign(url_search_params, user_agent, arg) {
  const result_str =
    generate_random_str() +
    generate_rc4_bb_str(url_search_params, user_agent, '1536|747|1536|834|0|30|0|0|1536|834|1536|864|1525|747|24|24|Win32', 'cus', arg)
  return result_encrypt(result_str, 's4') + '='
}

function sign_datail(params, userAgent) {
  return sign(params, userAgent, [0, 1, 14])
}

function sign_reply(params, userAgent) {
  return sign(params, userAgent, [0, 1, 8])
}

// ==================== API请求封装 ====================

const liveHost = 'https://live.douyin.com'

const commonParams = {
  device_platform: 'webapp',
  aid: '6383',
  channel: 'channel_pc_web',
  update_version_code: '170400',
  pc_client_type: '1',
  version_code: '190500',
  version_name: '19.5.0',
  cookie_enabled: 'true',
  screen_width: '2560',
  screen_height: '1440',
  browser_language: 'zh-CN',
  browser_platform: 'Win32',
  browser_name: 'Chrome',
  browser_version: '126.0.0.0',
  browser_online: 'true',
  engine_name: 'Blink',
  engine_version: '126.0.0.0',
  os_name: 'Windows',
  os_version: '10',
  cpu_core_num: '24',
  device_memory: '8',
  platform: 'PC',
  downlink: '10',
  effective_type: '4g',
  round_trip_time: '50'
}

const commonHeaders = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'sec-fetch-site': 'same-origin',
  'sec-fetch-mode': 'cors',
  'sec-fetch-dest': 'empty',
  'sec-ch-ua-platform': '"Windows"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
  referer: 'https://www.douyin.com/?recommend=1',
  priority: 'u=1, i',
  pragma: 'no-cache',
  'cache-control': 'no-cache',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  accept: 'application/json, text/plain, */*',
  dnt: '1'
}

const DEBUG_DY_API = process.env.DEBUG_DY_API === '1'

function cookieToObj(cookie) {
  const obj = {}
  if (!cookie) return obj
  const cookies = cookie.split(';')
  for (let i = 0; i < cookies.length; i++) {
    const [key, value] = cookies[i].trim().split('=')
    if (key) obj[key] = value
  }
  return obj
}

function getMsToken(randomLength = 120) {
  let randomStr = ''
  const baseStr = 'ABCDEFGHIGKLMNOPQRSTUVWXYZabcdefghigklmnopqrstuvwxyz0123456789='
  const length = baseStr.length - 1
  for (let i = 0; i < randomLength; i++) {
    randomStr += baseStr[Math.floor(Math.random() * length)]
  }
  return randomStr
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function handleParams(params, headers) {
  const cookie = headers.cookie
  if (!cookie) return params

  const cookieObj = cookieToObj(cookie)
  params.msToken = getMsToken()
  params.screen_width = cookieObj.dy_swidth || 2560
  params.screen_height = cookieObj.dy_sheight || 1440
  params.cpu_core_num = cookieObj.device_web_cpu_core || 24
  params.device_memory = cookieObj.device_web_memory_size || 8
  params.verifyFp = cookieObj.s_v_web_id || null
  params.fp = cookieObj.s_v_web_id || null
  return params
}

function requestJson(url, headers, timeoutMs = 10000, method = 'GET') {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers
    }

    const reqHeaders = options.headers || {}
    if (method !== 'GET' && !('content-length' in Object.keys(reqHeaders).reduce((acc, k) => (acc[k.toLowerCase()] = true, acc), {}))) {
      reqHeaders['content-length'] = '0'
    }
    options.headers = reqHeaders

    const req = https.request(options, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(Buffer.from(c)))
      res.on('end', () => {
        try {
          const buf = Buffer.concat(chunks)
          const text = buf.toString('utf8')
          const contentType = String(res.headers['content-type'] || '').toLowerCase()
          const looksLikeHtml = /^\s*</.test(text) || text.includes('<!DOCTYPE')
          if (!contentType.includes('json') && looksLikeHtml) {
            const snippet = text.slice(0, 160).replace(/\s+/g, ' ')
            const err = new Error(`Non-JSON response: status=${res.statusCode}, content-type=${contentType || 'unknown'}, body=${snippet}`)
            err.code = 'NON_JSON_RESPONSE'
            err.statusCode = res.statusCode
            err.contentType = contentType
            err.bodySnippet = snippet
            reject(err)
            return
          }
          const json = JSON.parse(text)
          resolve({ statusCode: res.statusCode, headers: res.headers, json })
        } catch (e) {
          if (e instanceof SyntaxError) {
            e.code = e.code || 'JSON_PARSE_ERROR'
          }
          reject(e)
        }
      })
    })

    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Request timeout'))
    })
    req.end()
  })
}

async function douyinLiveRemote(uri, params, headers, method = 'GET') {
  const p = { ...params, ...commonParams }
  const h = { ...commonHeaders, ...headers }
  const cookieObj = cookieToObj(h.cookie || '')

  // 抖音风控下常出现 444 + HTML。详情接口重试过多会放大风控，控制为2次。
  const maxAttempts = uri.includes('/webcast/lottery/melon/lottery_info/') ? 2 : 3
  let lastError = null

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const handledParams = await handleParams({ ...p }, h)
      const query = new URLSearchParams(handledParams).toString()
      const a_bogus = uri.includes('reply') ? sign_reply(query, h['User-Agent']) : sign_datail(query, h['User-Agent'])
      const finalParams = { ...handledParams, a_bogus }
      const url = `${liveHost}${uri}?${new URLSearchParams(finalParams).toString()}`

      const reqHeaders = {
        ...h,
        origin: 'https://live.douyin.com',
        referer: h.referer || 'https://live.douyin.com/',
        'x-secsdk-csrf-request': '1'
      }
      if (cookieObj.passport_csrf_token) {
        reqHeaders['x-tt-passport-csrf-token'] = cookieObj.passport_csrf_token
        reqHeaders['x-secsdk-csrf-token'] = cookieObj.passport_csrf_token
      }

      if (DEBUG_DY_API) {
        console.log(`[API请求] ${uri}${attempt > 0 ? ` (retry ${attempt}/${maxAttempts - 1})` : ''}`)
        console.log(`[a_bogus] ${a_bogus.substring(0, 30)}...`)
      }

      const timeoutMs = uri.includes('/webcast/lottery/melon/lottery_info/') ? 4500 : 10000
      const res = await requestJson(url, reqHeaders, timeoutMs, method)
      return res.json
    } catch (error) {
      lastError = error
      const code = error?.code
      const statusCode = Number(error?.statusCode || 0)
      const retryable =
        code === 'NON_JSON_RESPONSE' ||
        code === 'JSON_PARSE_ERROR' ||
        statusCode === 403 ||
        statusCode === 429 ||
        statusCode === 444

      if (!retryable || attempt >= maxAttempts - 1) {
        throw error
      }

      if (DEBUG_DY_API) {
        console.log(`[API重试] ${uri} code=${code || 'unknown'} status=${statusCode || 'unknown'} attempt=${attempt + 1}`)
      }

      const backoffMs = 350 + attempt * 450 + Math.floor(Math.random() * 220)
      await sleep(backoffMs)
    }
  }

  throw lastError || new Error('请求失败')
}

module.exports = {
  commonHeaders,
  commonParams,
  douyinLiveRemote
}
