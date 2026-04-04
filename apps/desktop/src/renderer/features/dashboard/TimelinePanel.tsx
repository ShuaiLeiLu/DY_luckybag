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
    <aside className="glass flex flex-col rounded-[26px] p-3 2xl:min-h-0">
      <div className="mb-2">
        <div>
          <h2 className="text-base font-semibold text-white">日志</h2>
          <p className="text-xs text-slate-400">仅展示本次运行会话日志。</p>
        </div>
      </div>
      <div
        ref={props.logListRef}
        onScroll={props.onLogListScroll}
        className="scrollbar-thin flex-1 space-y-1.5 overflow-auto pr-1"
      >
        {props.logs.map((entry) => (
          <div key={entry.id} className="rounded-2xl border border-slate-700/70 bg-slate-950/55 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className={`rounded-full border px-2 py-1 text-[11px] uppercase tracking-[0.18em] ${toneByType(entry.type)}`}>
                {textByType(entry.type)}
              </span>
              <span className="text-xs text-slate-500">{entry.time}</span>
            </div>
            <div className="mt-2 text-sm leading-6 text-slate-200">{entry.message}</div>
          </div>
        ))}
      </div>
    </aside>
  )
}

function toneByType(type: TimelineLogEntry['type']) {
  if (type === 'success') return 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
  if (type === 'warning') return 'border-amber-400/20 bg-amber-500/10 text-amber-200'
  if (type === 'error') return 'border-rose-400/20 bg-rose-500/10 text-rose-200'
  return 'border-slate-400/20 bg-slate-500/10 text-slate-200'
}

function textByType(type: TimelineLogEntry['type']) {
  if (type === 'warning') return '警告'
  if (type === 'error') return '错误'
  if (type === 'success') return '成功'
  return '信息'
}
