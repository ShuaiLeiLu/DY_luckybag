const crypto = require('crypto')
const os = require('os')
const { contextBridge, ipcRenderer } = require('electron')

const INVOKE_CHANNELS = new Set([
  'load-all-tokens',
  'check-browser-exists',
  'launch-browser',
  'set-live-stream-blocking',
  'set-account-monitoring',
  'navigate-to',
  'execute-script',
  'close-browser',
  'delete-token',
  'get-user-info',
  'clear-account-cache',
  'get-login-token',
  'save-token',
  'load-token',
  'set-cookies',
  'search-live-by-all',
  'search-live-by-category',
  'get-lottery-detail',
  'collect-lotteries-by-category',
  'attend-lottery',
  'room-like',
  'room-chat',
  'scan-debug-log',
  'desktop:get-bootstrap',
  'desktop:save-settings',
  'desktop:show-account-window',
  'desktop:hide-account-window',
  'desktop:get-update-state',
  'desktop:check-for-updates',
  'desktop:download-update',
  'desktop:install-update',
  'desktop:append-event'
])

const EVENT_CHANNELS = new Set([
  'browser-closed',
  'douyin-response',
  'desktop:update-state'
])

function buildMachineFingerprint() {
  const interfaces = os.networkInterfaces()
  const macs = []
  Object.values(interfaces || {}).forEach((list) => {
    ;(Array.isArray(list) ? list : []).forEach((item) => {
      const mac = String(item?.mac || '').trim().toLowerCase()
      if (!mac || mac === '00:00:00:00:00:00') return
      macs.push(mac)
    })
  })
  const stableParts = [
    os.hostname(),
    os.platform(),
    os.arch(),
    ...macs.sort()
  ]
  const raw = stableParts.join('|')
  return `machine_${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32)}`
}

const MACHINE_FINGERPRINT = buildMachineFingerprint()

function invoke(channel, payload) {
  if (!INVOKE_CHANNELS.has(channel)) {
    throw new Error(`IPC invoke channel is not allowed: ${channel}`)
  }
  return ipcRenderer.invoke(channel, payload)
}

function on(channel, handler) {
  if (!EVENT_CHANNELS.has(channel)) {
    throw new Error(`IPC event channel is not allowed: ${channel}`)
  }
  const wrapped = (_event, ...args) => handler(...args)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

contextBridge.exposeInMainWorld('electronAPI', {
  machineFingerprint: MACHINE_FINGERPRINT,
  invoke,
  on,
  desktop: {
    getBootstrap() {
      return invoke('desktop:get-bootstrap')
    },
    saveSettings(settings) {
      return invoke('desktop:save-settings', settings)
    },
    showAccountWindow(accountId) {
      return invoke('desktop:show-account-window', { accountId })
    },
    hideAccountWindow(accountId) {
      return invoke('desktop:hide-account-window', { accountId })
    },
    setAccountMonitoring(accountId, enabled) {
      return invoke('set-account-monitoring', { accountId, enabled })
    },
    getUpdateState() {
      return invoke('desktop:get-update-state')
    },
    checkForUpdates() {
      return invoke('desktop:check-for-updates')
    },
    downloadUpdate() {
      return invoke('desktop:download-update')
    },
    installUpdate() {
      return invoke('desktop:install-update')
    },
    appendEvent(event) {
      return invoke('desktop:append-event', event)
    },
    onUpdateState(handler) {
      return on('desktop:update-state', handler)
    }
  }
})
