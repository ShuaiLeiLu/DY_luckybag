import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
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
  const [logQuery, setLogQuery] = useState('')
  const deferredLogQuery = useDeferredValue(logQuery)

  const filteredLogs = useMemo(() => {
    const keyword = deferredLogQuery.trim().toLowerCase()
    if (!keyword) return logs
    return logs.filter((entry) => entry.message.toLowerCase().includes(keyword))
  }, [logs, deferredLogQuery])

  const latestFilteredLogId = filteredLogs.length > 0 ? filteredLogs[filteredLogs.length - 1].id : 0

  const handleLogListScroll = useEffectEvent(() => {
    const container = logListRef.current
    if (!container) return
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    logAutoFollowRef.current = distanceToBottom <= 48
  })

  useEffect(() => {
    if (!deferredLogQuery.trim()) return
    logAutoFollowRef.current = true
  }, [deferredLogQuery])

  useEffect(() => {
    if (!logAutoFollowRef.current) return
    const raf = window.requestAnimationFrame(() => {
      const container = logListRef.current
      if (!container) return
      container.scrollTop = container.scrollHeight
    })
    return () => window.cancelAnimationFrame(raf)
  }, [latestFilteredLogId, deferredLogQuery])

  const appendEvent = useEffectEvent(async (message: string, type: UiLogEntry['type']) => {
    const level = type === 'success' ? 'success' : type === 'warning' ? 'warning' : type === 'error' ? 'error' : 'info'
    try {
      await window.electronAPI.desktop.appendEvent({ level, message, scope: 'desktop' })
    } catch (_) {
      // ignore
    }
  })

  const addLog = useEffectEvent((message: string, type: UiLogEntry['type'] = 'info') => {
    const entry = buildLogEntry(message, type)
    startTransition(() => {
      setLogs((current) => [...current.slice(-359), entry])
    })
    appendEvent(message, type)
  })

  const replaceLogs = useEffectEvent((entries: UiLogEntry[]) => {
    const nextMax = entries.reduce((max, entry) => Math.max(max, Number(entry.id || 0)), 0)
    logSeq = Math.max(logSeq, nextMax)
    startTransition(() => {
      setLogs(entries)
    })
  })

  return {
    logs,
    filteredLogs,
    logQuery,
    setLogQuery,
    logListRef,
    handleLogListScroll,
    addLog,
    replaceLogs
  }
}
