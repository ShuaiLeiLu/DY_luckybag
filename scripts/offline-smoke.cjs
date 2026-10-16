/* Real Electron UI/IPC + native HTTP protocol client + real Go pool, no upstream account access. */
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawn, execFileSync } = require('node:child_process')
const crypto = require('node:crypto')
const http = require('node:http')
const net = require('node:net')
const { signNativeAndroidHeaders } = require('../apps/desktop/electron/android-sign-algorithms')
const root = path.resolve(__dirname, '..')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitUntil(check, timeout = 20000) {
  const until = Date.now() + timeout
  while (Date.now() < until) { if (await check()) return; await delay(100) }
  throw new Error('Offline smoke timeout')
}
async function electronTest() {
  const { app, BrowserWindow, session } = require('electron')
  const profile = process.env.DY_PROJECT_ROOT
  assert.ok(profile && path.resolve(profile).startsWith(path.join(root, '.tmp') + path.sep))
  app.setPath('userData', path.join(profile, 'empty-profile'))
  Object.defineProperty(app, 'isPackaged', { get: () => true })
  app.disableHardwareAcceleration()
  if (process.platform === 'linux') app.commandLine.appendSwitch('password-store', 'basic')
  app.on('browser-window-created', (_event, win) => { win.hide(); win.on('show', () => win.hide()) })
  const packagedMain = process.env.DY_PROTOCOL_APP_ARCHIVE
    ? path.join(path.resolve(process.env.DY_PROTOCOL_APP_ARCHIVE), 'apps/desktop/electron/main.js') : ''
  require(packagedMain || '../apps/desktop/electron/main')
  await app.whenReady()
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !/^(?:file:|devtools:|data:|https?:\/\/127\.0\.0\.1(?::|\/))/.test(details.url) })
  })
  let win
  await waitUntil(() => { win = BrowserWindow.getAllWindows()[0]; return win && !win.webContents.isLoading() })
  const evaluate = script => win.webContents.executeJavaScript(script)
  await waitUntil(async () => (await evaluate('document.body.innerText')).includes('设置'))
  const invoke = (channel, payload) => evaluate(`window.electronAPI.invoke(${JSON.stringify(channel)},${JSON.stringify(payload)})`)
  assert.equal((await invoke('desktop:get-bootstrap')).settings.requestBackend, 'android')
  assert.equal(await evaluate(`(() => { try { window.electronAPI.invoke('execute-script',{}); return false } catch { return true } })()`), true)
  const blocked = await invoke('attend-lottery', { accountId: 'dy_10001', roomId: '123', lotteryId: '456' })
  assert.equal(blocked.success, false)
  await evaluate(`Array.from(document.querySelectorAll('button')).find(x=>x.innerText.trim()==='添加账号').click()`)
  await waitUntil(async () => !!await evaluate(`document.querySelector('img[alt="抖音安卓协议登录二维码"]')`))
  await waitUntil(async () => (await evaluate('document.body.innerText')).includes('已扫码，请在手机上确认登录'))
  await waitUntil(async () => (await evaluate('document.body.innerText')).includes('登录成功，会话已自动保存'))
  assert.equal((await invoke('protocol:login-status')).state, 'completed')
  assert.equal(JSON.stringify(await invoke('protocol:login-status')).includes('fixture-account-secret'), false)
  await evaluate(`Array.from(document.querySelectorAll('button')).find(x=>x.innerText.replace(/\\s/g,'')==='完成').click()`)
  const accounts = await invoke('protocol:list-sessions')
  assert.equal(accounts.accounts.length, 1)
  assert.equal(JSON.stringify(accounts).includes('cookie'), false)
  await evaluate('location.reload()')
  await waitUntil(async () => (await evaluate('document.body.innerText')).includes('协议测试账号'))
  await evaluate(`Array.from(document.querySelectorAll('button')).find(x=>x.innerText.trim()==='验证协议').click()`)
  await waitUntil(async () => !!await evaluate(`document.querySelector('#protocol-room-id')`))
  await evaluate(`(() => {
    const input=document.querySelector('#protocol-room-id');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'123');
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`)
  await delay(100)
  await evaluate(`Array.from(document.querySelectorAll('button')).find(x=>x.innerText.trim()==='验证登录态与福袋详情').click()`)
  await waitUntil(async () => (await evaluate('document.body.innerText')).includes('LOTTERY_DETAIL_CONFIRMED'))
  assert.equal((await evaluate('document.body.innerText')).includes('重新扫码登录'), true)
  assert.equal((await evaluate('document.body.innerText')).includes('本次读取请求已接受'), true)
  const attended = await invoke('attend-lottery', { accountId: 'dy_10001', roomId: '123', lotteryId: '456' })
  assert.equal(attended.success, true)
  assert.equal((await invoke('attend-lottery', { accountId: 'other', roomId: '123', lotteryId: '456' })).success, false)
  const pending = { accountId: 'dy_10001', intent: 'running', pendingDraw: { lottery: { lottery_id: '456', roomId: '123' }, record: { id: 1 } } }
  assert.equal((await invoke('desktop:save-runtime', pending)).success, true)
  const feedback = { clientId: 'smoke-client', accountId: 'dy_10001', roomId: '123', lotteryId: '456', event: 'draw_won', rewardAmount: 5, remainingSec: 19.5 }
  await invoke('desktop:enqueue-feedback', feedback)
  await invoke('desktop:enqueue-feedback', feedback)
  await waitUntil(() => JSON.parse(fs.readFileSync(path.join(profile, 'dy-fudai-desktop/state/feedback-outbox.json'), 'utf8')).length === 0)
  assert.equal((await invoke('desktop:get-bootstrap')).runtimeStates.dy_10001.pendingDraw.lottery.lottery_id, '456')
  const credentials = fs.readFileSync(path.join(profile, 'dy-fudai-desktop/state/protocol-sessions.json'), 'utf8')
  assert.equal(credentials.includes('fixture-account-secret'), false)
  const devices = fs.readFileSync(path.join(profile, 'dy-fudai-desktop/state/protocol-device.json'), 'utf8')
  assert.equal(JSON.parse(devices).encrypted, true)
  fs.writeFileSync(path.join(profile, 'desktop-smoke-ok.json'), JSON.stringify({ ipc: true, nativeProtocol: true,
    nativeQRLogin: true, encryptedSession: true, encryptedDevice: true, restoredAccount: true,
    noWebIPC: true, accountIsolation: true, durableFeedback: true, runtime: true }))
  app.exit(0)
}
async function nodeTest() {
  fs.mkdirSync(path.join(root, '.tmp'), { recursive: true })
  const dir = fs.mkdtempSync(path.join(root, '.tmp', 'native-smoke-'))
  const token = crypto.randomBytes(32).toString('hex')
  const executable = path.join(dir, process.platform === 'win32' ? 'poolserver.exe' : 'poolserver')
  const goBin = process.env.GO_BIN || 'go'
  execFileSync(goBin, ['build', '-buildvcs=false', '-o', executable, './cmd/poolserver'], { cwd: path.join(root, 'apps/pool-server'), stdio: 'pipe', windowsHide: true })
  const socket = net.createServer()
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
  const poolPort = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  let sideEffects = 0
  let loginPolls = 0
  const received = []
  const upstream = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    const url = new URL(req.url, 'http://127.0.0.1')
    let body = ''; for await (const chunk of req) body += chunk
    const ticket = String(req.headers['x-ss-req-ticket'] || '')
    if (!/^\d{13}$/.test(ticket) || Math.abs(Date.now() - Number(ticket)) > 30000) {
      res.writeHead(401); res.end(JSON.stringify({ status_code: 8 })); return
    }
    // Transport tickets use milliseconds; the experimental signature vector's
    // timestamp input still uses seconds. This fixture is not platform validation.
    const isPassport = url.pathname.startsWith('/passport/mobile/')
    const expected = signNativeAndroidHeaders({ query: url.search.slice(1), body, timestamp: Math.floor(Number(ticket) / 1000), passport: isPassport })
    expected['x-ss-req-ticket'] = ticket
    if (Object.entries(expected).some(([k,v]) => req.headers[k] !== v)) {
      res.writeHead(401); res.end(JSON.stringify({ status_code: 8 })); return
    }
    if (isPassport && req.headers['x-argus'] !== undefined) { res.writeHead(401); res.end(JSON.stringify({ status_code: 8 })); return }
    received.push(url.pathname)
    if (url.pathname === '/service/2/device_register/') {
      assert.equal(req.method, 'POST')
      assert.equal(JSON.parse(body).magic_tag, 'ss_app_log')
      res.end(JSON.stringify({ device_id_str: '111', install_id_str: '222' })); return
    }
    if (!isPassport) assert.equal(url.searchParams.get('device_id'), '111')
    if (url.pathname === '/passport/mobile/get_qrcode/') {
      // Trusted capture: exact nine-parameter set, no deviceInfo expansion.
      assert.equal([...url.searchParams.keys()].join('&'),
        'service&account_sdk_source&aid&version_code&passport-sdk-version&request_from_account_sdk&is_from_ttaccountsdk&need_logo&source')
      assert.equal(url.searchParams.get('version_code'), '40.7.0')
      assert.equal(url.searchParams.get('source'), 'pad')
      assert.equal(url.searchParams.get('service'), 'https://aweme.snssdk.com')
      res.end(JSON.stringify({ message: 'success', data: { token: 'fixture-qr-token', expire_time: Math.floor(Date.now()/1000)+120,
        ds: 'fixture-ds', qrcode: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM6sAAAAASUVORK5CYII=' } })); return
    }
    if (url.pathname === '/passport/mobile/check_qrconnect/') {
      assert.equal([...url.searchParams.keys()].join('&'),
        'service&scene&account_sdk_source&aid&version_code&passport-sdk-version&request_from_account_sdk&is_from_ttaccountsdk&token')
      assert.equal(url.searchParams.get('token'), 'fixture-qr-token')
      assert.equal(req.headers['x-tt-dt'], 'fixture-ds')
      assert.equal(req.headers['x-tt-env'], 'api_sdk')
      assert.match(String(req.headers['x-tt-trace-id']), /^01-01\d{13}\d{6}-[0-9a-f]+-01$/)
      loginPolls++
      res.end(JSON.stringify({ message: 'success', data: loginPolls === 1 ? { status: 'scanned' } : {
        status: 'confirmed', user_data: { user_id: '10001', session_key: 'fixture-account-secret' }
      } })); return
    }
    assert.equal(req.headers.cookie, 'sessionid=fixture-account-secret')
    if (url.pathname === '/aweme/v1/user/profile/self/') res.end(JSON.stringify({ status_code: 0, user: { uid: '10001', nickname: '协议测试账号' } }))
    else if (url.pathname === '/webcast/lottery/melon/lottery_info/') res.end(JSON.stringify({ status_code: 0, data: { lottery_info: {
      lottery_id_str: '456', room_id: '123', draw_time: Math.floor(Date.now()/1000)+120,
      candidate_num: 3, lucky_count: 1, conditions: [], prize_info: { name: '离线协议夹具奖品' }
    } } }))
    else if (url.pathname === '/webcast/lottery/melon/') {
      assert.equal(url.searchParams.has('lottery_id'), false)
      assert.equal(new URLSearchParams(body).get('lottery_id'), '456')
      sideEffects++; res.end(JSON.stringify({ status_code: 0, data: { status: 0 } }))
    } else { res.writeHead(404); res.end('{}') }
  })
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + poolPort
  const config = { desktop: { poolServerUrl: base, poolServerToken: token, requestBackend: 'android', hotUpdateEnabled: false, resumeOnStartup: false },
    poolServer: { server: { host: '127.0.0.1', port: poolPort, apiToken: token }, redis: { enabled: false }, pool: { feedbackLogPath: path.join(dir, 'feedback.jsonl') } } }
  const configPath = path.join(dir, 'config.json')
  fs.writeFileSync(configPath, JSON.stringify(config))
  const pool = spawn(executable, [], { cwd: dir, env: { ...process.env, POOL_CONFIG_FILE: configPath, POOL_API_TOKEN: token, POOL_REDIS_ENABLED: 'false' }, windowsHide: true, stdio: 'ignore' })
  const call = async (route, body, authenticated = true) => {
    const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'content-type': 'application/json' } : {}),
      ...(authenticated ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined })
    return { status: response.status, data: await response.json() }
  }
  let electron
  try {
    await waitUntil(async () => { try { return (await call('/health')).status === 200 } catch { return false } })
    assert.equal((await call('/pool/top', null, false)).status, 401)
    assert.equal((await call('/candidate/batch-upsert', { sourceId: 'smoke', candidates: [{ roomId: '123', lotteryId: '456', endTime: Date.now()+120000, conditions: [{ type: 6 }] }] })).data.ok, true)
    const owner = { clientId: 'smoke-client', accountId: 'dy_10001', filters: { requireType3And6: false } }
    const first = await call('/task/claim', owner)
    assert.equal(first.data.claimed, true)
    assert.equal((await call('/task/claim', owner)).data.lease.leaseId, first.data.lease.leaseId)
    assert.equal((await call('/task/claim', { ...owner, accountId: 'other' })).data.claimed, false)
    const env = { ...process.env, DY_PROJECT_ROOT: dir, DY_PROTOCOL_FIXTURE_URL: 'http://127.0.0.1:' + upstream.address().port, NODE_ENV: 'production' }
    delete env.ELECTRON_RUN_AS_NODE
    electron = spawn(require('electron'), [__filename, '--electron-test', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], { cwd: dir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    for (const stream of [electron.stdout, electron.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-6000) })
    const watchdog = setTimeout(() => electron.kill(), 60000)
    const code = await new Promise((resolve, reject) => { electron.on('exit', resolve); electron.on('error', reject) })
    clearTimeout(watchdog)
    assert.equal(code, 0, output.replaceAll(token, '[redacted]'))
    assert.ok(fs.existsSync(path.join(dir, 'desktop-smoke-ok.json')))
    assert.equal(sideEffects, 1)
    assert.deepEqual(received, ['/service/2/device_register/', '/passport/mobile/get_qrcode/',
      '/passport/mobile/check_qrconnect/', '/passport/mobile/check_qrconnect/', '/aweme/v1/user/profile/self/',
      '/aweme/v1/user/profile/self/', '/webcast/lottery/melon/lottery_info/', '/webcast/lottery/melon/'])
    const learning = await call('/learning/debug')
    assert.equal(learning.data.summary.feedbackCount, 1)
    assert.equal(learning.data.summary.drawWon, 1)
    console.log('Offline smoke passed: fixture QR login + encrypted session/device + Electron UI/IPC + protocol HTTP + Go pool.')
    console.log('Evidence: ' + path.join(dir, 'desktop-smoke-ok.json'))
  } finally {
    if (electron && electron.exitCode === null) electron.kill()
    pool.kill()
    await new Promise(resolve => { if (pool.exitCode !== null) resolve(); else pool.once('exit', resolve) })
    await new Promise(resolve => upstream.close(resolve))
  }
}
if (process.versions.electron) electronTest().catch(error => { console.error(error.message); require('electron').app.exit(1) })
else nodeTest().catch(error => { console.error(error); process.exitCode = 1 })
