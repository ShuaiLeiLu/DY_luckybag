import { useState } from 'react'
import type { LotteryHistoryRecord } from '@shared/models'

export type HistoryPanelProps = {
  records: LotteryHistoryRecord[]
}

export function HistoryPanel(props: HistoryPanelProps) {
  const [filter, setFilter] = useState<'all' | 'won'>('all')

  const filteredRecords = props.records.filter((record) => {
    if (filter === 'won') {
      const isWon = Number(record.rewardAmount || 0) > 0 || String(record.resultStatus || '').toLowerCase() === 'won' || record.recordType === 'win'
      return isWon
    }
    return true
  })

  return (
    <aside className="flex h-full flex-col bg-slate-900 border border-slate-800 p-4 rounded-xl overflow-hidden shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">历史记录</h2>
            <p className="text-xs text-slate-400 mt-1">查看账号近期参与详情及开奖结果。</p>
          </div>
          <div className="flex items-center rounded-lg bg-slate-800/80 p-1 border border-slate-700/50">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${filter === 'all' ? 'bg-slate-700 text-slate-100 font-medium shadow-sm' : 'text-slate-400 hover:text-slate-300'}`}
            >
              已抢福袋
            </button>
            <button
              onClick={() => setFilter('won')}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${filter === 'won' ? 'bg-emerald-500/20 text-emerald-400 font-medium shadow-sm border border-emerald-500/20' : 'text-slate-400 hover:text-slate-300'}`}
            >
              已中福袋
            </button>
          </div>
        </div>
        <div className="rounded-md border border-slate-700/50 bg-slate-800 px-3 py-1.5 text-xs text-slate-400">
          共 {filteredRecords.length} 条
        </div>
      </div>

      <div className="scrollbar-thin flex-1 space-y-2 overflow-auto pr-2">
        {filteredRecords.length === 0 ? (
          <div className="flex h-56 items-center justify-center rounded-xl border border-slate-800 bg-slate-800/30 text-sm text-slate-500">
            {filter === 'won' ? '暂无中奖记录' : '暂无历史记录'}
          </div>
        ) : null}

        {filteredRecords.map((record) => {
          const result = formatResultText(record)
          const amount = Number(record.rewardAmount || 0)
          return (
            <article
              key={`${record.id}_${record.accountId}_${record.createdAt}`}
              className="rounded-lg border border-slate-800 bg-slate-800/40 px-4 py-3 transition hover:bg-slate-800/60"
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="truncate pr-3 text-sm font-semibold text-slate-200">
                  {record.lotteryName || '未命名福袋'}
                </div>
                <div className="shrink-0 text-xs text-slate-500">{formatTime(record.createdAt || record.joinedAt)}</div>
              </div>

              <div className="grid gap-2 text-xs text-slate-300 sm:grid-cols-4">
                <Field label="账号" value={record.accountNickname || record.accountId || '-'} />
                <Field label="直播间" value={record.authorNickname || record.roomId || '-'} />
                <Field label="结果" value={result} />
                <Field label="收益" value={amount > 0 ? `+${amount}` : '0'} tone={amount > 0 ? 'text-emerald-400 font-bold' : 'text-slate-400'} />
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
    <div className="rounded-md border border-slate-800/80 bg-slate-900/50 px-3 py-2">
      <div className="mb-1 text-[11px] text-slate-500 font-medium">{props.label}</div>
      <div className={`truncate text-xs ${props.tone || 'text-slate-300'}`}>{props.value}</div>
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
