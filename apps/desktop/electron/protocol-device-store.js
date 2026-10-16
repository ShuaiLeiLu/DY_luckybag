const fs = require('node:fs')
const path = require('node:path')
const { validProfile } = require('./native-login-provider')

// One installation, shared by account switches. Only server-issued IDs are persisted.
function createProtocolDeviceStore({ filePath, safeStorage }) {
  const requireEncryption = () => {
    if (!safeStorage?.isEncryptionAvailable()) throw Object.assign(new Error('系统凭据加密服务不可用'), { code: 'LOGIN_STORAGE_UNAVAILABLE' })
  }
  return {
    assertAvailable: requireEncryption,
    get() {
      requireEncryption()
      if (!fs.existsSync(filePath)) return null
      const envelope = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      if (envelope.version !== 1 || envelope.encrypted !== true) throw new Error('设备存储格式无效')
      const profile = JSON.parse(safeStorage.decryptString(Buffer.from(envelope.payload, 'base64')))
      if (!validProfile(profile)) throw new Error('已存设备参数无效')
      return profile
    },
    save(profile) {
      requireEncryption()
      if (!validProfile(profile)) throw new Error('拒绝保存未注册的设备参数')
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      const temp = filePath + '.tmp'
      fs.writeFileSync(temp, JSON.stringify({ version: 1, encrypted: true,
        payload: safeStorage.encryptString(JSON.stringify(profile)).toString('base64') }), { mode: 0o600 })
      fs.renameSync(temp, filePath)
    }
  }
}
module.exports = { createProtocolDeviceStore }
