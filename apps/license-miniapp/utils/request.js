const { BASE_URL } = require('../config')

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${String(BASE_URL || '').replace(/\/+$/, '')}${path}`,
      method: options.method || 'GET',
      data: options.data || {},
      header: {
        'content-type': 'application/json',
        ...(options.header || {})
      },
      timeout: Number(options.timeout || 12000),
      success(res) {
        const payload = res.data || {}
        if (payload.ok !== true) {
          reject(new Error(String(payload.error || payload.message || 'request_failed')))
          return
        }
        resolve(payload)
      },
      fail(err) {
        reject(err)
      }
    })
  })
}

function wxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(res) {
        if (!res.code) {
          reject(new Error('wx_login_code_empty'))
          return
        }
        resolve(res.code)
      },
      fail: reject
    })
  })
}

module.exports = {
  request,
  wxLogin
}
