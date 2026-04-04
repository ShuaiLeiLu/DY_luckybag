import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState
} from 'react'

export type UiLogEntry = {
  id: number
  time: string
  type: 'info' | 'warning' | 'error' | 'success'
  message: string
}

let logSeq = 0

function buildLogEntry(message: string, type: UiLogEntry['type'] = 'info'): UiLogEntry {
  return {
    id: ++logSeq,
    time: new Date().toLocaleTimeString(),
    type,
    message: String(message || '')
  }
}

/**
 * 时间线日志状态钩子：
 * - 统一管理日志列表、搜索过滤、自动滚动跟随
 * - 统一上报日志到桌面事件流
 */
export function useTimelineLogs() {
  const logListRef = useRef<HTMLDivElement | null>(null)
  const logAutoFollowRef = useRef(true)
  const [logs, setLogs] = useState<UiLogEntry[]>([])
  const latestLogId = logs.length > 0 ? logs[logs.length - 1].id : 0

  const handleLogListScroll = useEffectEvent(() => {
    const container = logListRef.current
    if (!container) return
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    logAutoFollowRef.current = distanceToBottom <= 48
  })

  useEffect(() => {
    if (!logAutoFollowRef.current) return
    const raf = window.requestAnimationFrame(() => {
      const container = logListRef.current
      if (!container) return
      container.scrollTop = container.scrollHeight
    })
    return () => window.cancelAnimationFrame(raf)
  }, [latestLogId])

  const addLog = useEffectEvent((message: string, type: UiLogEntry['type'] = 'info') => {
    const entry = buildLogEntry(message, type)
    startTransition(() => {
      setLogs((current) => [...current.slice(-359), entry])
    })
  })

  return {
    logs,
    logListRef,
    handleLogListScroll,
    addLog
  }
}
