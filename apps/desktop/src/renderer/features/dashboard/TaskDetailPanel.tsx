import type { AccountSession } from '@shared/models'
import { formatRelative, statusText } from '../../lib/runtime'

export type TaskDetailPanelProps = {
  selectedAccount: AccountSession | null
  accounts: AccountSession[]
  onToggleAccount?: (account: AccountSession) => void
  onReloginAccount?: (account: AccountSession) => void
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

      <div className="flex-1 rounded-2xl bg-slate-900/30 p-3.5 border border-slate-800/60 flex flex-col gap-4">
        {props.selectedAccount ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold text-slate-100">
                  {props.selectedAccount.nickname || props.selectedAccount.id}
                </div>
                <div className="mt-1 text-xs text-slate-500">{props.selectedAccount.id}</div>
              </div>
              <div className="flex gap-2">
                <button
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    props.selectedAccount.actionActive
                      ? 'bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                      : 'bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                  }`}
                  onClick={() => props.onToggleAccount?.(props.selectedAccount as AccountSession)}
                >
                  {props.selectedAccount.actionActive ? '暂停执行' : '启动执行'}
                </button>
                <button
                  className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-700"
                  onClick={() => props.onReloginAccount?.(props.selectedAccount as AccountSession)}
                >
                  重新登录
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <InfoCard label="运行状态" value={statusText(props.selectedAccount.runtimeState)} tone="text-cyan-200" />
              <InfoCard label="当前阶段" value={formatStageText(props.selectedAccount)} />
              <InfoCard label="当前直播间" value={props.selectedAccount.currentRoom || '-'} />
              <InfoCard label="目标主播" value={props.selectedAccount.currentTaskAnchor || '-'} />
              <InfoCard label="当前目标" value={props.selectedAccount.currentTaskLotteryName || props.selectedAccount.currentTaskLabel || '空闲轮询中...'} spanFull />
              <InfoCard label="租约剩余" value={props.selectedAccount.currentTaskLeaseRemainingSec > 0 ? formatRelative(props.selectedAccount.currentTaskLeaseRemainingSec) : '-'} />
              <InfoCard label="任务评分" value={props.selectedAccount.currentTaskScore > 0 ? props.selectedAccount.currentTaskScore.toFixed(2) : '-'} />
              <InfoCard label="候选池可抢" value={String(props.selectedAccount.poolAvailableCandidates || 0)} />
              <InfoCard label="扫描上报" value={`${props.selectedAccount.scanUploadAccepted || 0} / ${props.selectedAccount.scanUploadSubmitted || 0}`} />
            </div>

            <div className="rounded-2xl border border-slate-800/80 bg-slate-950/55 p-3">
              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">流程进度</div>
              <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
                {buildFlowSteps(props.selectedAccount).map((step) => (
                  <div
                    key={step.label}
                    className={`rounded-xl border px-3 py-2 text-xs ${
                      step.active
                        ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100'
                        : step.done
                          ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100'
                          : 'border-slate-800 bg-slate-900/60 text-slate-500'
                    }`}
                  >
                    <div className="font-medium">{step.label}</div>
                    <div className="mt-1 text-[11px] opacity-80">{step.text}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-[12px] text-slate-500 italic">
            请选择一个账号查看详情
          </div>
        )}
      </div>
    </aside>
  )
}

function InfoCard(props: { label: string; value: string; tone?: string; spanFull?: boolean }) {
  return (
    <div className={`rounded-xl border border-slate-800/80 bg-slate-950/50 px-3 py-2 ${props.spanFull ? 'col-span-2' : ''}`}>
      <div className="mb-1 text-[11px] uppercase tracking-[0.12em] text-slate-500">{props.label}</div>
      <div className={`truncate text-sm ${props.tone || 'text-slate-200'}`}>{props.value || '-'}</div>
    </div>
  )
}

function formatStageText(account: AccountSession) {
  const stage = String(account.currentTaskStage || '').trim()
  if (!stage) return account.actionActive ? '等待目标' : '未启动'
  const mapping: Record<string, string> = {
    claimed: '已领取任务',
    joining: '准备参与',
    waiting_draw: '等待开奖',
    post_draw_stay: '开奖后停留'
  }
  return mapping[stage] || stage
}

function buildFlowSteps(account: AccountSession) {
  const runtime = account.runtimeState
  const activeIndex =
    runtime === 'login_required' ? 0
      : runtime === 'ready' || runtime === 'paused' ? 1
        : runtime === 'scanning' || runtime === 'preheating' ? 2
          : runtime === 'claiming' ? 3
            : runtime === 'joining' ? 4
              : runtime === 'waiting_result' || runtime === 'cooldown' ? 5
                : -1

  const currentTask = account.currentTaskLotteryName || account.currentTaskLabel || '等待任务'
  const room = account.currentRoom || account.currentTaskAnchor || '等待进入直播间'

  return [
    { label: '登录账号', text: account.token ? '登录态已就绪' : '等待扫码登录' },
    { label: '启动账号', text: account.actionActive ? '执行中' : '未启动' },
    { label: '扫描候选', text: (account.poolValidCandidates || account.poolAvailableCandidates) > 0 ? `候选 ${account.poolAvailableCandidates || 0} 个` : '等待候选池刷新' },
    { label: '领取目标', text: currentTask },
    { label: '进入直播间', text: room },
    { label: '参与并等开奖', text: account.currentTaskLeaseRemainingSec > 0 ? `剩余 ${formatRelative(account.currentTaskLeaseRemainingSec)}` : '等待参与确认' }
  ].map((item, index) => ({
    ...item,
    done: activeIndex > index,
    active: activeIndex === index
  }))
}
