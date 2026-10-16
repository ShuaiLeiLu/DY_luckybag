const { app, BrowserWindow, ipcMain, safeStorage, dialog } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { createLogger } = require('./logger')
const { createDesktopWindow } = require('./desktop-window')
const { createUpdateService } = require('./update-service')
const { createHotUpdateService } = require('./hot-update-service')
const { createFeedbackOutbox } = require('./feedback-outbox')
const { createProtocolSessionStore } = require('./protocol-session-store')
const { ProtocolRuntime } = require('./protocol-runtime')
const { AndroidProtocolClient } = require('./android-protocol-client')
const { createProtocolDeviceStore } = require('./protocol-device-store')
const { NativeLoginProvider } = require('./native-login-provider')
const { ProtocolLoginService } = require('./protocol-login-service')
const { createProductionSignerFactory } = require('./android-sdk-adapter')

const customRoot = Boolean(process.env.DY_PROJECT_ROOT)
const projectRoot = customRoot ? path.resolve(process.env.DY_PROJECT_ROOT)
  : app.isPackaged ? path.dirname(process.execPath) : path.resolve(__dirname, '../../..')
process.env.DY_PROJECT_ROOT = projectRoot
const { createStateStore } = require('./state-store')
const dataDir = !app.isPackaged || customRoot ? path.join(projectRoot, 'dy-fudai-desktop') : app.getPath('userData')
fs.mkdirSync(dataDir, { recursive: true })
app.setPath('userData', dataDir)
const logger = createLogger('desktop')
let mainWindow, state, sessions, protocol, login, updates, hotUpdates, outbox, flushTimer
function emit(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}
function createHot(settings) {
  return createHotUpdateService({ userDataDir: app.getPath('userData'), appVersion: app.getVersion(),
    enabled: settings.hotUpdateEnabled === true, manifestUrl: settings.hotUpdateManifestUrl || '',
    publicKey: settings.hotUpdatePublicKey || '', reloadOnApply: settings.hotUpdateReloadOnApply === true,
    onChange: snapshot => emit('desktop:hot-update-state', snapshot) })
}
function bootstrap() {
  return { appVersion: app.getVersion(), settings: state.getSettings(), update: updates.getSnapshot(),
    runtimeStates: state.listRuntimes(), feedbackPending: outbox.size(),
    events: state.listEvents(80), historyRecords: state.listHistoryRecords(240) }
}
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, payload) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Unsupported IPC sender')
    try { return await fn(payload) }
    catch (error) { return { success: false, code: error.code || 'LOCAL_ERROR', error: error.message } }
  })
}
function registerHandlers() {
  handle('desktop:get-bootstrap', bootstrap)
  handle('desktop:save-settings', async payload => {
    const settings = state.saveSettings(payload || {})
    if (updates.getSnapshot().feedUrl !== settings.updateFeedUrl) updates = createUpdateService({
      feedUrl: settings.updateFeedUrl, onChange: snapshot => emit('desktop:update-state', snapshot) })
    const previous = hotUpdates.getSnapshot()
    if (previous.enabled !== settings.hotUpdateEnabled || previous.manifestUrl !== settings.hotUpdateManifestUrl ||
      previous.reloadOnApply !== settings.hotUpdateReloadOnApply || hotUpdates.publicKey !== settings.hotUpdatePublicKey) {
      hotUpdates = createHot(settings)
      await hotUpdates.init()
    }
    return { success: true, settings }
  })
  handle('protocol:list-sessions', () => ({ success: true, accounts: sessions.list() }))
  handle('protocol:login-start', input => login.start(input))
  handle('protocol:login-status', ({ attemptId } = {}) => login.snapshot(attemptId))
  handle('protocol:login-submit', input => login.submit(input))
  handle('protocol:login-cancel', ({ attemptId } = {}) => login.cancel(attemptId))
  handle('protocol:session-status', ({ accountId } = {}) => protocol.status(accountId))
  handle('protocol:import-session', async ({ filePath, accountId } = {}) => {
    if (!filePath) {
      const selection = await dialog.showOpenDialog(mainWindow, { title: '导入安卓协议会话',
        properties: ['openFile'], filters: [{ name: '安卓会话 JSON', extensions: ['json'] }] })
      if (selection.canceled) return { success: false, canceled: true }
      filePath = selection.filePaths[0]
    }
    if (fs.statSync(filePath).size > 131072) throw new Error('会话文件不能超过 128 KiB')
    let input
    try { input = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')) }
    catch { throw new Error('无法解析会话 JSON 文件') }
    if (accountId && input.accountId !== accountId) throw new Error('重新导入的 accountId 必须与当前账号一致')
    const account = sessions.save(input)
    protocol.invalidate(account.id)
    return { success: true, account }
  })
  handle('protocol:remove-session', ({ accountId } = {}) => {
    if (login.current?.accountId === accountId) login.cancel()
    sessions.remove(accountId)
    protocol.invalidate(accountId)
    return { success: true }
  })
  handle('protocol:verify', input => protocol.verify(input))
  const methods = { 'get-lottery-detail': 'getLotteryDetail', 'get-redpacket-detail': 'getRedpacketDetail',
    'get-lottery-result': 'getLotteryResult', 'search-live-by-all': 'searchLiveByAll',
    'search-live-by-category': 'searchLiveByCategory', 'attend-lottery': 'attendLottery',
    'room-like': 'roomLike', 'room-chat': 'roomChat' }
  for (const [channel, method] of Object.entries(methods)) handle(channel, input => protocol.call(method, input))
  handle('desktop:get-update-state', () => updates.getSnapshot())
  handle('desktop:check-for-updates', () => updates.check())
  handle('desktop:download-update', () => updates.download())
  handle('desktop:install-update', () => ({ success: updates.install() }))
  handle('desktop:get-hot-update-state', () => hotUpdates.getSnapshot())
  handle('desktop:check-hot-update', () => hotUpdates.check())
  handle('desktop:append-event', payload => ({ success: true, item: state.appendEvent(payload) }))
  handle('desktop:append-account-log', payload => ({ success: true, item: state.appendAccountLog(payload) }))
  handle('desktop:append-history-record', payload => ({ success: true, item: state.appendHistoryRecord(payload) }))
  handle('desktop:save-runtime', payload => ({ success: true, item: state.saveRuntime(payload) }))
  handle('desktop:purge-account-data', ({ accountId } = {}) => ({ success: true, result: state.purgeAccountData(accountId) }))
  handle('desktop:enqueue-feedback', payload => {
    const eventId = outbox.enqueue(payload)
    void outbox.flush().catch(() => {})
    return { success: true, eventId, pending: outbox.size() }
  })
  handle('scan-debug-log', () => ({ success: true }))
}
app.whenReady().then(async () => {
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  state = createStateStore(app.getPath('userData'))
  sessions = createProtocolSessionStore({ filePath: path.join(app.getPath('userData'), 'state/protocol-sessions.json'), safeStorage })
  // Only an explicitly configured loopback fixture can replace upstream during offline tests.
  let clientFactory
  if (process.env.DY_PROTOCOL_FIXTURE_URL) {
    const fixture = new URL(process.env.DY_PROTOCOL_FIXTURE_URL)
    if (fixture.protocol !== 'http:' || fixture.hostname !== '127.0.0.1') throw new Error('Protocol fixture must use IPv4 loopback')
    clientFactory = session => new AndroidProtocolClient({ baseUrl: fixture.origin, deviceInfo: session.deviceInfo,
      userAgent: session.userAgent, authHeaders: session.authHeaders })
  }
  const signerFactory = createProductionSignerFactory({ allowExperimental: Boolean(process.env.DY_PROTOCOL_FIXTURE_URL) })
  protocol = new ProtocolRuntime({ getSession: id => sessions.get(id), clientFactory, signerFactory })
  const deviceStore = createProtocolDeviceStore({ filePath: path.join(app.getPath('userData'), 'state/protocol-device.json'), safeStorage })
  login = new ProtocolLoginService({ sessions, deviceStore,
    providerFactory: () => new NativeLoginProvider({ deviceStore, clientFactory, signerFactory }),
    onSaved: account => { protocol.invalidate(account.id); emit('protocol:session-saved', account) } })
  const settings = state.getSettings()
  updates = createUpdateService({ feedUrl: settings.updateFeedUrl, onChange: snapshot => emit('desktop:update-state', snapshot) })
  hotUpdates = createHot(settings)
  await hotUpdates.init()
  outbox = createFeedbackOutbox({ filePath: path.join(app.getPath('userData'), 'state/feedback-outbox.json'), send: async payload => {
    const current = state.getSettings()
    const response = await fetch(current.poolServerUrl.replace(/\/+$/, '') + '/task/feedback', { method: 'POST',
      headers: { 'content-type': 'application/json', ...(current.poolServerToken ? { authorization: 'Bearer ' + current.poolServerToken } : {}) },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) })
    if (!response.ok || (await response.json()).ok !== true) throw new Error('Feedback not acknowledged')
  } })
  registerHandlers()
  mainWindow = createDesktopWindow({ app, BrowserWindow, logger,
    DESKTOP_DEV_SERVER_URL: process.env.DY_DESKTOP_DEV_URL || 'http://localhost:5180',
    getHotUpdateEntry: () => {
      const entry = hotUpdates.getAppliedEntryFile()
      if (!entry) return ''
      const html = fs.readFileSync(entry, 'utf8')
      return html.includes('native-protocol-runtime-v1') && html.includes('native-qr-login-v1') ? entry : ''
    } })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // Reloads/unmounts must not leave an invisible login waiting to commit credentials.
  mainWindow.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) login.cancel()
  })
  mainWindow.webContents.on('render-process-gone', () => login.cancel())
  mainWindow.on('closed', () => login.dispose())
  flushTimer = setInterval(() => void outbox.flush().catch(() => {}), 5000)
  flushTimer.unref()
}).catch(error => { logger.error('桌面端初始化失败', error.message); app.exit(1) })
app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => { clearInterval(flushTimer); login?.dispose(); protocol?.dispose?.() })
