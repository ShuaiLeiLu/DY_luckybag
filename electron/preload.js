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
  'room-chat',
  'scan-debug-log'
])

const EVENT_CHANNELS = new Set([
  'browser-closed',
  'douyin-response'
])

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * invoke 方法：向主进程发起白名单 IPC 调用并返回结果。
   */
  invoke(channel, payload) {
    if (!INVOKE_CHANNELS.has(channel)) {
      throw new Error(`IPC invoke channel is not allowed: ${channel}`)
    }
    return ipcRenderer.invoke(channel, payload)
  },
  /**
   * on 方法：订阅白名单 IPC 事件并返回取消订阅函数。
   */
  on(channel, handler) {
    if (!EVENT_CHANNELS.has(channel)) {
      throw new Error(`IPC event channel is not allowed: ${channel}`)
    }
    /**
     * wrapped 方法：包装 IPC 事件回调，屏蔽原始 event 参数。
     */
    const wrapped = (_event, ...args) => handler(...args)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  }
})
