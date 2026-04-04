import type { AccountSession } from '@shared/models'
import { statusText, statusTone } from '../../lib/runtime'

export type AccountCardProps = {
  account: AccountSession
  selected: boolean
  onSelect: () => void
  onToggle: () => void
  onRelogin: () => void
  onInspect: () => void
  onHide: () => void
  onDelete: () => void
}

/**
 * 账号卡片：只负责单账号展示和交互触发。
 * 业务动作通过回调上抛，避免与页面状态耦合。
 */
export function AccountCard(props: AccountCardProps) {
  return (
    <div
      className={`rounded-[24px] border p-4 transition ${
        props.selected
          ? 'border-cyan-300/40 bg-cyan-500/10 shadow-[0_0_0_1px_rgba(34,211,238,0.16)]'
          : 'border-slate-700/80 bg-slate-950/50 hover:border-slate-500'
      }`}
    >
      <button className="w-full text-left" onClick={props.onSelect}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-base font-semibold text-white">{props.account.nickname}</div>
            <div className="mt-1 text-xs text-slate-500">{props.account.id}</div>
          </div>
          <span className={`self-start rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(props.account.runtimeState)}`}>
            {statusText(props.account.runtimeState)}
          </span>
        </div>
      </button>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <Metric label="今日参与" value={String(props.account.participationCount)} />
        <Metric label="今日收益" value={String(props.account.todayEarnedDiamonds)} />
        <Metric label="本轮提交" value={String(props.account.scanUploadSubmitted || 0)} />
        <Metric label="本轮有效" value={String(props.account.scanUploadAccepted || 0)} />
        <Metric label="候选池总量" value={String(props.account.poolActiveCandidates || 0)} />
        <Metric label="候选池有效" value={String(props.account.poolValidCandidates || 0)} />
        <Metric label="任务阶段" value={props.account.currentTaskStage || '空闲'} />
        <Metric label="租约" value={props.account.currentTaskLeaseRemainingSec ? `${props.account.currentTaskLeaseRemainingSec}s` : '-'} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <button className="rounded-full bg-emerald-400 px-3 py-2 font-semibold text-slate-950 transition hover:bg-emerald-300" onClick={props.onToggle}>
          {props.account.actionActive ? '暂停' : '启动'}
        </button>
        <button className="rounded-full border border-slate-600/80 px-3 py-2 text-slate-100 transition hover:bg-slate-800/60" onClick={props.onRelogin}>
          重新扫码
        </button>
        <button className="rounded-full border border-slate-600/80 px-3 py-2 text-slate-100 transition hover:bg-slate-800/60" onClick={props.onInspect}>
          显示窗口
        </button>
        <button className="rounded-full border border-slate-600/80 px-3 py-2 text-slate-100 transition hover:bg-slate-800/60" onClick={props.onHide}>
          隐藏窗口
        </button>
      </div>
      <button className="mt-2 w-full rounded-full border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200 transition hover:bg-rose-500/20" onClick={props.onDelete}>
        删除账号
      </button>
    </div>
  )
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/45 px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{props.label}</div>
      <div className="mt-2 truncate text-lg font-semibold text-white">{props.value}</div>
    </div>
  )
}
