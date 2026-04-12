import type { RefObject } from 'react'

export type TimelineLogEntry = {
  id: number
  time: string
  type: 'info' | 'warning' | 'error' | 'success'
  message: string
}

export type TimelinePanelProps = {
  logs: TimelineLogEntry[]
  logListRef: RefObject<HTMLDivElement | null>
  onLogListScroll: () => void
}

/**
 * 时间线面板专注日志过滤与展示。
 * 滚动跟随策略由上层控制，组件只承接受控属性与事件。
 */
export function TimelinePanel(props: TimelinePanelProps) {
  return (
    <aside className="flex h-full flex-col p-4 bg-slate-900">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-100">系统日志</h2>
          <p className="text-xs text-slate-400 mt-1">实时显示运行任务的系统操作日志。</p>
        </div>
      </div>
      <div
        ref={props.logListRef}
        onScroll={props.onLogListScroll}
        className="scrollbar-thin flex-1 space-y-0.5 overflow-auto pr-2"
      >
        {props.logs.length === 0 && (
          <div className="text-sm text-slate-500 italic flex h-full items-center justify-center">暂无日志输出...</div>
        )}
        {props.logs.map((entry) => (
          <div key={entry.id} className="flex items-start gap-2 hover:bg-slate-800/60 px-2 py-1 rounded transition">
            <div className="w-[68px] shrink-0 font-mono text-[11px] text-slate-500 pt-[2px]">{entry.time}</div>
            <div className={`shrink-0 font-semibold text-[10px] mt-[2px] w-[34px] ${toneByType(entry.type)}`}>
              {textByType(entry.type)}
            </div>
            <div className="text-[12px] leading-5 text-slate-300 break-all">{entry.message}</div>
          </div>
        ))}
      </div>
    </aside>
  )
}

function toneByType(type: TimelineLogEntry['type']) {
  if (type === 'success') return 'text-emerald-400'
  if (type === 'warning') return 'text-amber-400'
  if (type === 'error') return 'text-rose-400'
  return 'text-cyan-400'
}

function textByType(type: TimelineLogEntry['type']) {
  if (type === 'warning') return '[WARN]'
  if (type === 'error') return '[FAIL]'
  if (type === 'success') return '[OK]'
  return '[INFO]'
}
