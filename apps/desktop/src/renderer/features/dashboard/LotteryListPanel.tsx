import { useMemo } from 'react'
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
    return list.sort((a, b) => {
      const aEnd = Number(a.remainingSec || a.end_time || a.endTime || a.draw_time || Number.MAX_SAFE_INTEGER)
      const bEnd = Number(b.remainingSec || b.end_time || b.endTime || b.draw_time || Number.MAX_SAFE_INTEGER)
      return aEnd - bEnd
    })
  }, [props.lotteriesByAccount])

  return (
    <aside className="flex h-full flex-col bg-slate-900 border border-slate-800 p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-100">可抢福袋列表</h2>
          <p className="text-xs text-slate-400 mt-1">目前系统获取到的各个直播间待开奖可抢福袋。</p>
        </div>
        <div className="text-[12px] text-slate-400 bg-slate-800 px-3 py-1.5 rounded-md border border-slate-700/50">
          可用福袋: <span className="font-mono text-cyan-400 font-bold ml-1">{allLotteries.length}</span>
        </div>
      </div>

      <div className="scrollbar-thin flex-1 overflow-auto pr-2 pb-2">
        {allLotteries.length === 0 ? (
          <div className="flex h-48 items-center justify-center rounded-xl border border-slate-800 bg-slate-800/30 text-sm text-slate-500">
            暂无可参与福袋，账号启动后会在这里展示待抢目标
          </div>
        ) : (
          <div className="min-w-[600px] border border-slate-800 bg-slate-800/20 rounded-lg overflow-hidden">
            <div className="grid grid-cols-[1fr_2fr_1.5fr_1fr_1fr_1fr] gap-4 px-4 py-2.5 border-b border-slate-800 bg-slate-800/40 text-xs font-semibold tracking-wider text-slate-400">
              <div>操作账号</div>
              <div>所在直播间</div>
              <div>福袋奖励</div>
              <div>福袋名额</div>
              <div>开奖时间</div>
              <div className="text-right">状态</div>
            </div>
            
            <div className="divide-y divide-slate-800/50">
              {allLotteries.map((item, index) => {
                const accountName = props.accountsMap[item._accountId] || item._accountId
                
                // 解析探测对象字段（兼顾不同阶段 payload 写法）
                const title = item.title || item.prize_info?.prize_name || item.lotteryName || item.label || '未知奖励'
                const status = item.status || item.state || item.joinStatus || '排队中'
                const anchor = item.anchorName || item.authorNickname || item.room_id || '未知直播间'
                
                const luckyCount = item.winner_num || item.luckyCount || item.prize_info?.lucky_count || '-'
                const rawEndTime = item.end_time || item.endTime || item.draw_time || 0
                const remaining = item.remainingSec || (rawEndTime > 0 ? Math.max(0, rawEndTime - Math.floor(Date.now() / 1000)) : null)
                const probability = Number(item.predictedProbability || item.simpleProbability || 0)
                
                return (
                  <div 
                    key={`${item._accountId}_${index}`} 
                    className="grid grid-cols-[1fr_2fr_1.5fr_1fr_1fr_1fr] items-center gap-4 px-4 py-3 transition hover:bg-slate-800/40"
                  >
                    <div>
                      <span className="rounded bg-slate-800 px-2 py-1 text-xs font-medium text-slate-300 border border-slate-700">
                        {accountName}
                      </span>
                    </div>
                    
                    <div className="truncate text-xs text-slate-200">
                      {anchor}
                    </div>
                    
                    <div className="truncate text-xs font-medium text-amber-200">
                      {title}
                      {probability > 0 ? (
                        <span className="ml-2 text-[11px] text-cyan-300">{(probability * 100).toFixed(1)}%</span>
                      ) : null}
                    </div>
                    
                    <div className="text-xs text-slate-400">
                      {luckyCount} 份
                    </div>
                    
                    <div className="text-xs text-slate-400">
                      {remaining !== null ? (
                        <span className={remaining < 60 ? 'text-rose-400 font-medium' : 'text-emerald-400'}>
                          {remaining}s 后
                        </span>
                      ) : (
                        '-'
                      )}
                    </div>
                    
                    <div className="text-right text-xs">
                      <span className={`${status.includes('中') ? 'text-amber-400' : 'text-slate-400'}`}>
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
