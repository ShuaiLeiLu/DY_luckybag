const crypto = require('crypto')
const os = require('os')
const { contextBridge, ipcRenderer } = require('electron')

const INVOKE_CHANNELS = new Set([
  'load-all-tokens',
  'check-browser-exists',
  'launch-browser',
  'set-live-stream-blocking',
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

/**
 * buildMachineFingerprint 方法：生成稳定机器指纹，优先使用网卡 MAC，其次回退主机信息。
 */
function buildMachineFingerprint() {
  const interfaces = os.networkInterfaces()
  const macs = []
  Object.values(interfaces || {}).forEach(list => {
    ;(Array.isArray(list) ? list : []).forEach(item => {
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

contextBridge.exposeInMainWorld('electronAPI', {
  machineFingerprint: MACHINE_FINGERPRINT,
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
