const fs = require('node:fs')
const path = require('node:path')
const { AndroidProtocolClient } = require('../apps/desktop/electron/android-protocol-client')
const { AndroidSignatureProvider } = require('../apps/desktop/electron/android-signature-provider')
const { ProtocolRuntime, PROFILE_PATH } = require('../apps/desktop/electron/protocol-runtime')
const { normalizeProtocolSession } = require('../apps/desktop/electron/protocol-session-store')

async function main() {
  const args = process.argv.slice(2)
  const value = flag => { const index = args.indexOf(flag); return index < 0 ? '' : args[index + 1] || '' }
  if (args.includes('--help')) {
    console.log('node scripts/protocol-diagnose.cjs [--session <local.json> --room-id <digits>] [--anonymous] [--output <report.json>]')
    return
  }
  const report = { checkedAt: new Date().toISOString(), mode: 'native-protocol',
    simulatorRequired: false, sessionProvided: Boolean(value('--session')), localSignature: null, verification: null }
  const signer = new AndroidSignatureProvider()
  const signed = await signer.signRequest({ method: 'GET', query: 'aid=1128', params: { aid: '1128' }, headers: {} })
  report.localSignature = { generated: true, implementation: 'experimental-aes-v2', platformVerified: false,
    headerNames: Object.keys(signed.headers), note: '只确认本地生成，不证明平台接受或设备认证有效' }
  let session
  if (value('--session')) {
    const filename = path.resolve(value('--session'))
    if (fs.statSync(filename).size > 131072) throw new Error('会话文件不能超过 128 KiB')
    try { session = normalizeProtocolSession(JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''))) }
    catch { throw new Error('会话格式不完整，请提供包含 Cookie、设备标识和 User-Agent 的有效会话 JSON 数据') }
  }
  const runtime = new ProtocolRuntime({ getSession: id => session?.accountId === id ? session : null })
  report.verification = await runtime.verify({ accountId: session?.accountId || '', roomId: value('--room-id') })
  if (args.includes('--anonymous') && !session) {
    try {
      const json = await new AndroidProtocolClient({ timeoutMs: 10000, baseUrl: 'https://aweme.snssdk.com' }).get(PROFILE_PATH)
      report.anonymous = { requestSent: true, jsonResponse: true, businessCode: Number.isFinite(Number(json.status_code)) ? Number(json.status_code) : null,
        authenticationVerified: false, signatureVerified: false, note: '匿名响应仅用于连通性诊断' }
    } catch (error) {
      report.anonymous = { requestSent: true, jsonResponse: error.businessCode !== undefined, code: error.code || 'NETWORK_ERROR', statusCode: error.statusCode || 0, businessCode: error.businessCode ?? null,
        transportCode: error.transportCode, authenticationVerified: false, signatureVerified: false }
    }
  }
  if (value('--output')) {
    const filename = path.resolve(value('--output'))
    if (value('--session') && filename.toLowerCase() === path.resolve(value('--session')).toLowerCase()) throw new Error('报告路径不能覆盖会话文件')
    fs.mkdirSync(path.dirname(filename), { recursive: true })
    fs.writeFileSync(filename, JSON.stringify(report, null, 2) + '\n')
  }
  console.log(JSON.stringify(report, null, 2))
  if (session && report.verification.details.status !== 'verified') process.exitCode = 2
}
if (require.main === module) main().catch(() => { console.error('协议诊断未完成：请检查输入文件和参数；未输出凭据或上游原文。'); process.exitCode = 1 })
module.exports = { main }
