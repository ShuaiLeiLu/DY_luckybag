const { contextBridge, ipcRenderer } = require('electron')
const channels = new Set([
  'protocol:list-sessions', 'protocol:import-session', 'protocol:remove-session', 'protocol:session-status', 'protocol:verify',
  'protocol:login-start', 'protocol:login-status', 'protocol:login-submit', 'protocol:login-cancel',
  'search-live-by-all', 'search-live-by-category', 'get-lottery-detail', 'get-lottery-result', 'get-redpacket-detail',
  'attend-lottery', 'room-like', 'room-chat', 'scan-debug-log',
  'desktop:get-bootstrap', 'desktop:save-settings', 'desktop:get-update-state', 'desktop:check-for-updates',
  'desktop:download-update', 'desktop:install-update', 'desktop:get-hot-update-state', 'desktop:check-hot-update',
  'desktop:append-event', 'desktop:append-account-log', 'desktop:append-history-record',
  'desktop:save-runtime', 'desktop:enqueue-feedback', 'desktop:purge-account-data'
])
const events = new Set(['desktop:update-state', 'desktop:hot-update-state', 'protocol:session-saved'])
function invoke(channel, payload) {
  if (!channels.has(channel)) throw new Error('IPC invoke channel is not allowed')
  return ipcRenderer.invoke(channel, payload)
}
function on(channel, handler) {
  if (!events.has(channel)) throw new Error('IPC event channel is not allowed')
  const listener = (_event, payload) => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}
contextBridge.exposeInMainWorld('electronAPI', { invoke, on, desktop: {
  getBootstrap: () => invoke('desktop:get-bootstrap'),
  saveSettings: settings => invoke('desktop:save-settings', settings),
  getUpdateState: () => invoke('desktop:get-update-state'),
  checkForUpdates: () => invoke('desktop:check-for-updates'),
  downloadUpdate: () => invoke('desktop:download-update'),
  installUpdate: () => invoke('desktop:install-update'),
  getHotUpdateState: () => invoke('desktop:get-hot-update-state'),
  checkHotUpdate: () => invoke('desktop:check-hot-update'),
  appendEvent: record => invoke('desktop:append-event', record),
  appendAccountLog: record => invoke('desktop:append-account-log', record),
  appendHistoryRecord: record => invoke('desktop:append-history-record', record),
  purgeAccountData: accountId => invoke('desktop:purge-account-data', { accountId }),
  onUpdateState: handler => on('desktop:update-state', handler),
  onHotUpdateState: handler => on('desktop:hot-update-state', handler)
} })
