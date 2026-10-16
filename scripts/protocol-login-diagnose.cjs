const fs = require('node:fs')
const path = require('node:path')
const { NativeLoginProvider, APP, ACCOUNT_PARAMS } = require('../apps/desktop/electron/native-login-provider')
const { safeError } = require('../apps/desktop/electron/protocol-login-service')

async function main() {
  const args = process.argv.slice(2)
  const index = args.indexOf('--output')
  const output = index >= 0 ? args[index + 1] : ''
  if (index >= 0 && (!output || output.startsWith('--'))) throw new Error('Missing report path')
  const report = { checkedAt: new Date().toISOString(), mode: 'android-mobile-qr',
    simulatorRequired: false, webExecution: false, signatureImplementation: 'experimental-aes-v2',
    client: { appVersion: APP.version_name, versionCode: APP.version_code,
      manifestVersionCode: APP.manifest_version_code, updateVersionCode: APP.update_version_code,
      passportSdkVersion: ACCOUNT_PARAMS['passport-sdk-version'] },
    device: 'not_tested', qr: 'not_tested', polling: 'not_tested',
    authentication: 'not_tested', sessionSaved: false }
  if (args.includes('--live')) {
    const provider = new NativeLoginProvider()
    try {
      report.stage = 'device_registration'
      await provider.prepare(); report.device = 'server_assigned'
      report.stage = 'qr_request'
      const qr = await provider.createQR(); report.qr = 'server_issued'; report.expiresAt = qr.expiresAt
      report.stage = 'qr_poll'
      const state = await provider.poll(); report.polling = state.state
      report.note = '只验证设备注册、真实二维码申请及一次扫码状态读取；未扫码，未保存账号会话。'
    } catch (error) { report.error = safeError(error); process.exitCode = 2 }
    finally { provider.dispose() }
  } else report.note = '追加 --live 才会请求平台；该命令不输出二维码、Cookie、令牌或设备标识。'
  if (output) {
    const filename = path.resolve(output)
    // Diagnostic outputs cannot overwrite existing files (including session files).
    fs.mkdirSync(path.dirname(filename), { recursive: true })
    fs.writeFileSync(filename, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  }
  console.log(JSON.stringify(report, null, 2))
}
if (require.main === module) main().catch(() => { console.error('登录诊断未完成，请检查报告路径；不会覆盖已有文件。'); process.exitCode = 1 })
module.exports = { main }
