import type { AccountSession } from '@shared/models'
import { statusText } from '../../lib/runtime'

export type TaskDetailPanelProps = {
  selectedAccount: AccountSession | null
  accounts: AccountSession[]
}

export function TaskDetailPanel(props: TaskDetailPanelProps) {
  const totalWins = props.accounts.reduce((sum, acc) => sum + Number(acc.todayLotteryWinCount || 0), 0)
  const totalDiamonds = props.accounts.reduce((sum, acc) => sum + Number(acc.todayEarnedDiamonds || 0), 0)
  const totalParticipation = props.accounts.reduce((sum, acc) => sum + Number(acc.participationCount || 0), 0)

  return (
    <aside className="glass flex flex-col rounded-[26px] p-4 2xl:min-h-0">
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-white">账号概览</h2>
        <p className="text-[12px] text-slate-400 mt-0.5">汇总展示账号参与与收益状态</p>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2">
        <div className="flex flex-col items-center justify-center rounded-2xl bg-gradient-to-b from-slate-800/40 to-slate-900/60 p-2 border border-slate-700/50">
          <span className="text-[11px] text-slate-400 mb-1">总参与场次</span>
          <span className="font-mono text-[18px] font-bold text-blue-300">{totalParticipation}</span>
        </div>
        <div className="flex flex-col items-center justify-center rounded-2xl bg-gradient-to-b from-slate-800/40 to-slate-900/60 p-2 border border-slate-700/50">
          <span className="text-[11px] text-slate-400 mb-1">累计中奖</span>
          <span className="font-mono text-[18px] font-bold text-emerald-300">{totalWins}</span>
        </div>
        <div className="flex flex-col items-center justify-center rounded-2xl bg-gradient-to-b from-slate-800/40 to-slate-900/60 p-2 border border-amber-500/10">
          <span className="text-[11px] text-amber-200/50 mb-1">累计收益</span>
          <span className="font-mono text-[18px] font-bold text-amber-300">{totalDiamonds}</span>
        </div>
      </div>

      <div className="flex-1 rounded-2xl bg-slate-900/30 p-3.5 border border-slate-800/60 flex flex-col justify-center">
        {props.selectedAccount ? (
          <div className="grid grid-cols-2 gap-y-2.5 gap-x-4">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-500">当前账号</span>
              <span className="font-semibold text-slate-200">{props.selectedAccount.nickname || props.selectedAccount.id}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-500">运行状态</span>
              <span className="font-semibold text-slate-200">{statusText(props.selectedAccount.runtimeState)}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-500">今日参与</span>
              <span className="font-mono font-medium text-slate-300">{props.selectedAccount.participationCount || 0} 场</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-500">今日收益</span>
              <span className="font-mono font-bold text-amber-400">{props.selectedAccount.todayEarnedDiamonds || 0}</span>
            </div>
            <div className="col-span-2 flex justify-between items-center text-xs mt-1 border-t border-slate-800/80 pt-2.5">
              <span className="text-slate-500 shrink-0">当前任务</span>
              <span className="font-medium text-cyan-200/90 truncate ml-3 text-right">
                {props.selectedAccount.currentTaskLotteryName || props.selectedAccount.currentTaskLabel || '空闲轮询中...'}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-[12px] text-slate-500 italic">
            请选择一个账号查看详情
          </div>
        )}
      </div>
    </aside>
  )
}
