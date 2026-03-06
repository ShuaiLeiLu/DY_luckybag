const { contextBridge, ipcRenderer } = require('electron')

const INVOKE_CHANNELS = new Set([
  'load-all-tokens',
  'check-browser-exists',
  'launch-browser',
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
  'room-chat'
])

const EVENT_CHANNELS = new Set([
  'browser-closed',
  'douyin-response'
])

contextBridge.exposeInMainWorld('electronAPI', {
  invoke(channel, payload) {
    if (!INVOKE_CHANNELS.has(channel)) {
      throw new Error(`IPC invoke channel is not allowed: ${channel}`)
    }
    return ipcRenderer.invoke(channel, payload)
  },
  on(channel, handler) {
    if (!EVENT_CHANNELS.has(channel)) {
      throw new Error(`IPC event channel is not allowed: ${channel}`)
    }
    const wrapped = (_event, ...args) => handler(...args)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  }
})

