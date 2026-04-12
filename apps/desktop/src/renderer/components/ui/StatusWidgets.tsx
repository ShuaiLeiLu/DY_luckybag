/**
 * 轻量展示组件：用于通用详情行。
 * 保持纯展示职责，方便在多个页面复用。
 */
export function DetailRow(props: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-2xl border border-slate-700/70 bg-slate-950/45 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <span className="text-slate-400">{props.label}</span>
      <span className="max-w-full break-all text-left text-slate-100 sm:max-w-[58%] sm:text-right">{props.value}</span>
    </div>
  )
}
