import { useMemo } from 'react'
import { Card, Empty, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { GiftOutlined } from '@ant-design/icons'

export type LotteryListPanelProps = {
  lotteriesByAccount: Record<string, Record<string, any>[]>
  accountsMap: Record<string, string> // accountId -> nickname
}

interface FlattenedLotteryItem {
  key: string
  accountId: string
  accountName: string
  anchor: string
  title: string
  luckyCount: string | number
  remaining: number | null
  probability: number
  status: string
}

export function LotteryListPanel({
  lotteriesByAccount,
  accountsMap
}: LotteryListPanelProps) {
  const dataSource = useMemo(() => {
    const list: FlattenedLotteryItem[] = []
    Object.entries(lotteriesByAccount).forEach(([accountId, lotteries]) => {
      if (Array.isArray(lotteries)) {
        lotteries.forEach((item, index) => {
          const accountName = accountsMap[accountId] || accountId
          const title =
            item.title || item.prize_info?.prize_name || item.lotteryName || item.label || '未知奖励'
          const status = item.status || item.state || item.joinStatus || '排队中'
          const anchor = item.anchorName || item.authorNickname || item.room_id || '未知直播间'
          const luckyCount =
            item.winner_num || item.luckyCount || item.prize_info?.lucky_count || '-'
          const rawEndTime = item.end_time || item.endTime || item.draw_time || 0
          const remaining =
            item.remainingSec ??
            (rawEndTime > 0 ? Math.max(0, rawEndTime - Math.floor(Date.now() / 1000)) : null)
          const probability = Number(item.predictedProbability || item.simpleProbability || 0)

          list.push({
            key: `${accountId}_${item.lotteryId || item.id || index}`,
            accountId,
            accountName,
            anchor,
            title,
            luckyCount,
            remaining,
            probability,
            status
          })
        })
      }
    })

    return list.sort((a, b) => {
      const aEnd = a.remaining ?? Number.MAX_SAFE_INTEGER
      const bEnd = b.remaining ?? Number.MAX_SAFE_INTEGER
      return aEnd - bEnd
    })
  }, [lotteriesByAccount, accountsMap])

  const columns: ColumnsType<FlattenedLotteryItem> = [
    {
      title: '操作账号',
      dataIndex: 'accountName',
      key: 'accountName',
      width: 120,
      render: (text) => (
        <Tag bordered={false} color="blue" className="text-xs font-medium max-w-[100px] truncate">
          {text}
        </Tag>
      )
    },
    {
      title: '直播间/主播',
      dataIndex: 'anchor',
      key: 'anchor',
      width: 140,
      render: (text) => (
        <span className="truncate inline-block max-w-[130px] text-xs text-slate-300" title={text}>
          {text}
        </span>
      )
    },
    {
      title: '福袋奖励',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (text, record) => (
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate text-xs font-medium text-amber-300" title={text}>
            {text}
          </span>
          {record.probability > 0 ? (
            <Tag bordered={false} color="cyan" className="text-[10px] px-1 py-0 m-0">
              {(record.probability * 100).toFixed(1)}%
            </Tag>
          ) : null}
        </div>
      )
    },
    {
      title: '名额',
      dataIndex: 'luckyCount',
      key: 'luckyCount',
      width: 80,
      render: (text) => <span className="font-mono text-xs text-slate-400">{text} 份</span>
    },
    {
      title: '开奖时间',
      dataIndex: 'remaining',
      key: 'remaining',
      width: 110,
      sorter: (a, b) => (a.remaining ?? 999999) - (b.remaining ?? 999999),
      render: (remaining) => {
        if (remaining === null || remaining === undefined) return <span className="text-xs text-slate-500">-</span>
        const isUrgent = remaining <= 60
        return (
          <span
            className={`font-mono text-xs font-semibold ${
              isUrgent ? 'text-rose-400 animate-pulse' : 'text-emerald-400'
            }`}
          >
            {remaining}s 后
          </span>
        )
      }
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      align: 'right',
      render: (status: string) => {
        const isJoining = status.includes('中') || status.includes('参')
        return (
          <Tag bordered={false} color={isJoining ? 'processing' : 'default'} className="m-0 text-xs">
            {status}
          </Tag>
        )
      }
    }
  ]

  return (
    <Card
      className="flex h-full flex-col border-slate-800 bg-slate-900/60 shadow-sm"
      styles={{
        header: { borderBottom: '1px solid rgba(148, 163, 184, 0.08)', padding: '12px 16px' },
        body: { padding: '0', overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column' }
      }}
      title={
        <div className="flex items-center gap-2">
          <GiftOutlined className="text-amber-400" />
          <span className="text-sm font-semibold text-slate-100">待开福袋池</span>
          <Tag color="cyan" bordered={false} className="text-xs font-mono">
            {dataSource.length} 个
          </Tag>
        </div>
      }
    >
      <div className="flex-1 overflow-auto">
        <Table<FlattenedLotteryItem>
          rowKey="key"
          columns={columns}
          dataSource={dataSource}
          size="small"
          pagination={false}
          scroll={{ y: 220 }}
          locale={{
            emptyText: (
              <div className="py-8">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    <span className="text-xs text-slate-500">
                      暂无可参与福袋，账号启动扫描后将实时在此展示
                    </span>
                  }
                />
              </div>
            )
          }}
        />
      </div>
    </Card>
  )
}
