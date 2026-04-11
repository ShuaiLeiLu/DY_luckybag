import type { AccountSession } from '@shared/models'
import { statusText, statusTone } from '../../lib/runtime'

export type AccountCardProps = {
  account: AccountSession
  selected: boolean
  onSelect: () => void
  onToggle: () => void
  onRelogin: () => void
  onDelete: () => void
}

/**
 * 账号卡片：高度精简优化的现代化内联卡片设计
 */
export function AccountCard(props: AccountCardProps) {
  return (
    <div
      className={`group relative flex w-full flex-col gap-3 rounded-[20px] border p-3.5 transition-all cursor-pointer ${
        props.selected
          ? 'border-cyan-300/40 bg-cyan-500/10 shadow-[0_0_0_1px_rgba(34,211,238,0.16)]'
          : 'border-slate-700/50 bg-slate-900/30 hover:border-slate-500 hover:bg-slate-900/60'
      }`}
      onClick={props.onSelect}
    >
      {/* Header: Avatar, Nickname & Status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-800 text-sm font-bold text-slate-300 shadow-inner border border-slate-700">
            {props.account.nickname?.[0] || '?'}
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-slate-100">{props.account.nickname}</span>
            <span className="text-[10px] text-slate-500">{props.account.id}</span>
          </div>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusTone(props.account.runtimeState)}`}>
          {statusText(props.account.runtimeState)}
        </span>
      </div>

      {/* Primary Metrics (Compact Row) */}
      <div className="flex gap-4 border-y border-slate-800/60 py-2.5 px-1 mt-1">
        <div className="flex flex-1 flex-col">
           <span className="text-[10px] text-slate-500 mb-0.5">参与场次</span>
           <span className="font-mono text-sm font-medium text-slate-300">{props.account.participationCount || 0}</span>
        </div>
        <div className="flex flex-1 flex-col border-l border-slate-800/60 pl-4">
           <span className="text-[10px] text-slate-500 mb-0.5">获取收益</span>
           <span className="font-mono text-sm font-medium text-amber-300">{props.account.todayEarnedDiamonds || 0}</span>
        </div>
        <div className="flex flex-[1.2] flex-col border-l border-slate-800/60 pl-4 overflow-hidden">
           <span className="text-[10px] text-slate-500 mb-0.5">当前任务</span>
           <span className="truncate text-[12px] font-medium text-slate-300 mt-px">{props.account.currentTaskStage || '待命'}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 pt-1 opacity-40 transition-opacity duration-300 group-hover:opacity-100">
        <button 
          className="flex-1 rounded-[10px] bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-400 transition hover:bg-emerald-500/20" 
          onClick={(e) => { e.stopPropagation(); props.onToggle(); }}
        >
          {props.account.actionActive ? '暂停执行' : '启动执行'}
        </button>
        <button 
          className="flex-1 rounded-[10px] bg-slate-800/60 px-2.5 py-1.5 text-[11px] text-slate-300 transition hover:bg-slate-700 hover:text-white" 
          onClick={(e) => { e.stopPropagation(); props.onRelogin(); }}
        >
          重新扫码
        </button>
        <button 
          className="flex-1 rounded-[10px] bg-rose-500/5 px-2.5 py-1.5 text-[11px] text-rose-400/80 transition hover:bg-rose-500/20 hover:text-rose-300 border border-transparent hover:border-rose-500/30" 
          onClick={(e) => { e.stopPropagation(); props.onDelete(); }}
        >
          删除账号
        </button>
      </div>
    </div>
  )
}
