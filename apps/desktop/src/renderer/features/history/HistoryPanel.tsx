import type { LotteryHistoryRecord } from '@shared/models'

export type HistoryPanelProps = {
  records: LotteryHistoryRecord[]
}

export function HistoryPanel(props: HistoryPanelProps) {
  return (
    <aside className="glass flex h-full flex-col overflow-hidden rounded-[26px] p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">历史记录</h2>
          <p className="text-sm text-slate-400">查看账号近期参与和结果，便于复盘。</p>
        </div>
        <div className="rounded-full border border-slate-700 bg-slate-900/50 px-3 py-1 text-xs text-slate-300">
          共 {props.records.length} 条
        </div>
      </div>

      <div className="scrollbar-thin flex-1 space-y-2 overflow-auto pr-1">
        {props.records.length === 0 ? (
          <div className="flex h-56 items-center justify-center rounded-2xl border border-dashed border-slate-700/80 bg-slate-900/40 text-sm text-slate-400">
            暂无历史记录
          </div>
        ) : null}

        {props.records.map((record) => {
          const result = formatResultText(record)
          const amount = Number(record.rewardAmount || 0)
          return (
            <article
              key={`${record.id}_${record.accountId}_${record.createdAt}`}
              className="rounded-2xl border border-slate-700/70 bg-slate-900/35 px-4 py-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="truncate pr-3 text-sm font-semibold text-slate-100">
                  {record.lotteryName || '未命名福袋'}
                </div>
                <div className="shrink-0 text-xs text-slate-500">{formatTime(record.createdAt || record.joinedAt)}</div>
              </div>

              <div className="grid gap-2 text-xs text-slate-300 sm:grid-cols-4">
                <Field label="账号" value={record.accountNickname || record.accountId || '-'} />
                <Field label="直播间" value={record.authorNickname || record.roomId || '-'} />
                <Field label="结果" value={result} />
                <Field label="收益" value={amount > 0 ? `+${amount}` : '0'} tone={amount > 0 ? 'text-amber-300' : 'text-slate-300'} />
              </div>
            </article>
          )
        })}
      </div>
    </aside>
  )
}

function Field(props: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-800/80 bg-slate-950/50 px-2.5 py-2">
      <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-slate-500">{props.label}</div>
      <div className={`truncate text-sm ${props.tone || 'text-slate-200'}`}>{props.value}</div>
    </div>
  )
}

function formatTime(ts: number) {
  if (!Number.isFinite(ts) || ts <= 0) return '-'
  const date = new Date(ts)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d} ${h}:${min}`
}

function formatResultText(record: LotteryHistoryRecord) {
  const status = String(record.resultStatus || '').toLowerCase()
  if (Number(record.rewardAmount || 0) > 0 || status === 'won' || status === 'win') return '中奖'
  if (status) return status
  return record.recordType === 'win' ? '中奖' : '未中奖'
}
