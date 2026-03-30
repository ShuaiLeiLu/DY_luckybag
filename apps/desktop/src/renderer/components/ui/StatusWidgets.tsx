/**
 * 轻量展示组件：用于首页统计卡片、状态标签和通用详情行。
 * 保持纯展示职责，方便在多个页面复用。
 */
export function StatCard(props: { label: string; value: string; helper: string; tone: 'emerald' | 'cyan' | 'amber' | 'violet' }) {
  const toneMap = {
    emerald: 'from-emerald-400/20 to-emerald-500/5 border-emerald-300/20 text-emerald-100',
    cyan: 'from-cyan-400/20 to-cyan-500/5 border-cyan-300/20 text-cyan-100',
    amber: 'from-amber-300/20 to-amber-500/5 border-amber-300/20 text-amber-100',
    violet: 'from-violet-400/20 to-violet-500/5 border-violet-300/20 text-violet-100'
  }

  return (
    <div className={`min-w-0 rounded-[22px] border bg-gradient-to-br px-4 py-3 ${toneMap[props.tone]}`}>
      <div className="text-xs uppercase tracking-[0.24em] text-slate-400">{props.label}</div>
      <div className="mt-2 text-3xl font-semibold text-white">{props.value}</div>
      <div className="mt-1 text-xs text-slate-400">{props.helper}</div>
    </div>
  )
}

export function ClusterBadge(props: { label: string; value: string }) {
  return (
    <div className="rounded-full border border-slate-700/80 bg-slate-950/45 px-3 py-2">
      <span className="text-slate-500">{props.label}</span>
      <span className="ml-2 font-medium text-slate-100">{props.value}</span>
    </div>
  )
}

export function DetailRow(props: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-2xl border border-slate-700/70 bg-slate-950/45 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <span className="text-slate-400">{props.label}</span>
      <span className="max-w-full break-all text-left text-slate-100 sm:max-w-[58%] sm:text-right">{props.value}</span>
    </div>
  )
}
