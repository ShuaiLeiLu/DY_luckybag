import { useMemo } from 'react'
import { formatRelative } from '../../lib/runtime'

export type LotteryListPanelProps = {
  lotteriesByAccount: Record<string, Record<string, any>[]>
  accountsMap: Record<string, string> // accountId -> nickname
}

/**
 * 福袋列表横向宽屏面板
 */
export function LotteryListPanel(props: LotteryListPanelProps) {
  const allLotteries = useMemo(() => {
    const list: Array<Record<string, any> & { _accountId: string }> = []
    Object.entries(props.lotteriesByAccount).forEach(([accountId, lotteries]) => {
      if (Array.isArray(lotteries)) {
        lotteries.forEach((lot) => {
          list.push({ ...lot, _accountId: accountId })
        })
      }
    })
    return list
  }, [props.lotteriesByAccount])

  return (
    <aside className="glass flex h-full flex-col overflow-hidden rounded-[26px] p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">可抢福袋列表</h2>
          <p className="text-sm text-slate-400">目前系统获取到的直播间福袋列表。</p>
        </div>
        <div className="text-[12px] text-slate-500 bg-slate-900/50 px-3 py-1 rounded-full">
          可用福袋: <span className="font-mono text-cyan-400 font-bold ml-1">{allLotteries.length}</span>
        </div>
      </div>

      <div className="scrollbar-thin flex-1 overflow-auto pr-2 pb-2">
        {allLotteries.length === 0 ? (
          <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-slate-700/80 bg-slate-900/40 text-sm text-slate-500">
            暂无活跃福袋
          </div>
        ) : (
          <div className="min-w-[600px]">
            <div className="grid grid-cols-[1fr_2fr_1.5fr_1fr_1fr_1fr] gap-4 px-4 py-2 border-b border-slate-800 text-[12px] font-semibold tracking-wider text-slate-500 uppercase">
              <div>操作账号</div>
              <div>所在直播间</div>
              <div>福袋奖励</div>
              <div>福袋名额</div>
              <div>开奖时间</div>
              <div className="text-right">状态</div>
            </div>
            
            <div className="space-y-1 mt-2">
              {allLotteries.map((item, index) => {
                const accountName = props.accountsMap[item._accountId] || item._accountId
                
                // 解析探测对象字段（兼顾不同阶段 payload 写法）
                const title = item.title || item.prize_info?.prize_name || item.lotteryName || item.label || '未知奖励'
                const status = item.status || item.state || item.joinStatus || '排队中'
                const anchor = item.anchorName || item.authorNickname || item.room_id || '未知直播间'
                
                const luckyCount = item.winner_num || item.luckyCount || item.prize_info?.lucky_count || '-'
                const rawEndTime = item.end_time || item.endTime || item.draw_time || 0
                const remaining = item.remainingSec || (rawEndTime > 0 ? Math.max(0, rawEndTime - Math.floor(Date.now() / 1000)) : null)
                
                return (
                  <div 
                    key={`${item._accountId}_${index}`} 
                    className="grid grid-cols-[1fr_2fr_1.5fr_1fr_1fr_1fr] items-center gap-4 rounded-xl border border-transparent bg-slate-900/30 px-4 py-3 transition hover:border-slate-700 hover:bg-slate-900/60"
                  >
                    <div>
                      <span className="rounded bg-cyan-500/10 px-2 py-1 text-[11px] font-medium text-cyan-300 border border-cyan-500/20">
                        {accountName}
                      </span>
                    </div>
                    
                    <div className="truncate text-[13px] text-slate-300 font-medium">
                      {anchor}
                    </div>
                    
                    <div className="truncate text-[13px] font-semibold text-amber-300">
                      {title}
                    </div>
                    
                    <div className="text-[13px] font-mono text-slate-400">
                      {luckyCount} 份
                    </div>
                    
                    <div className="text-[13px] text-slate-400">
                      {remaining !== null ? (
                        <span className={remaining < 60 ? 'text-red-400' : 'text-emerald-400'}>
                          {remaining}s 后
                        </span>
                      ) : (
                        '-'
                      )}
                    </div>
                    
                    <div className="text-right">
                      <span className="rounded-full bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-300">
                        {status}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
