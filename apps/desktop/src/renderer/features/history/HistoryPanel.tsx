import { useState, useMemo } from 'react'
import { Card, Segmented, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { HistoryOutlined } from '@ant-design/icons'
import type { LotteryHistoryRecord } from '@shared/models'

export type HistoryPanelProps = {
  records: LotteryHistoryRecord[]
}

function formatTime(ts: number) {
  if (!Number.isFinite(ts) || ts <= 0) return '-'
  const date = new Date(ts)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  const sec = String(date.getSeconds()).padStart(2, '0')
  return `${y}-${m}-${d} ${h}:${min}:${sec}`
}

function isWonRecord(record: LotteryHistoryRecord): boolean {
  const amount = Number(record.rewardAmount || 0)
  const status = String(record.resultStatus || '').toLowerCase()
  return amount > 0 || status === 'won' || status === 'win' || record.recordType === 'win'
}

export function HistoryPanel({ records }: HistoryPanelProps) {
  const [filter, setFilter] = useState<string>('all')

  const totalWonCount = useMemo(() => {
    return records.filter(isWonRecord).length
  }, [records])

  const totalRewardDiamonds = useMemo(() => {
    return records.reduce((sum, r) => sum + Number(r.rewardAmount || 0), 0)
  }, [records])

  const filteredRecords = useMemo(() => {
    if (filter === 'won') {
      return records.filter(isWonRecord)
    }
    return records
  }, [records, filter])

  const columns: ColumnsType<LotteryHistoryRecord> = [
    {
      title: '状态',
      key: 'resultStatus',
      width: 90,
      render: (_, record) => {
        const won = isWonRecord(record)
        return (
          <Tag bordered={false} color={won ? 'success' : 'default'} className="text-xs">
            {won ? '已中奖' : '未中奖'}
          </Tag>
        )
      }
    },
    {
      title: '福袋名称',
      dataIndex: 'lotteryName',
      key: 'lotteryName',
      ellipsis: true,
      render: (text) => (
        <span className="font-medium text-xs text-slate-200" title={text || '未命名福袋'}>
          {text || '未命名福袋'}
        </span>
      )
    },
    {
      title: '参与账号',
      key: 'account',
      width: 140,
      render: (_, record) => (
        <span className="text-xs text-slate-300">
          {record.accountNickname || record.accountId || '-'}
        </span>
      )
    },
    {
      title: '所属直播间',
      key: 'room',
      width: 140,
      render: (_, record) => (
        <span className="truncate inline-block max-w-[130px] text-xs text-slate-400" title={record.authorNickname || record.roomId || '-'}>
          {record.authorNickname || record.roomId || '-'}
        </span>
      )
    },
    {
      title: '奖励收益',
      dataIndex: 'rewardAmount',
      key: 'rewardAmount',
      width: 100,
      render: (amount) => {
        const val = Number(amount || 0)
        return val > 0 ? (
          <span className="font-mono text-xs font-bold text-amber-400">+{val} 钻</span>
        ) : (
          <span className="font-mono text-xs text-slate-500">0</span>
        )
      }
    },
    {
      title: '参与时间',
      key: 'time',
      width: 160,
      render: (_, record) => (
        <span className="font-mono text-xs text-slate-400">
          {formatTime(record.createdAt || record.joinedAt)}
        </span>
      )
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
          <HistoryOutlined className="text-blue-400" />
          <span className="text-sm font-semibold text-slate-100">历史参与记录</span>
          <Tag color="default" bordered={false} className="text-xs font-mono">
            共 {records.length} 场
          </Tag>
        </div>
      }
      extra={
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 text-xs">
            <span className="text-slate-400">
              中奖率:{' '}
              <strong className="text-emerald-400 font-mono">
                {records.length > 0 ? ((totalWonCount / records.length) * 100).toFixed(1) : 0}%
              </strong>
            </span>
            <span className="text-slate-400">
              累计钻:{' '}
              <strong className="text-amber-400 font-mono">+{totalRewardDiamonds}</strong>
            </span>
          </div>
          <Segmented
            size="small"
            value={filter}
            onChange={(val) => setFilter(val as string)}
            options={[
              { label: '全部记录', value: 'all' },
              { label: '仅中奖', value: 'won' }
            ]}
          />
        </div>
      }
    >
      <div className="flex-1 overflow-auto">
        <Table<LotteryHistoryRecord>
          rowKey={(record) => `${record.id}_${record.accountId}_${record.createdAt}`}
          columns={columns}
          dataSource={filteredRecords}
          size="small"
          pagination={{
            defaultPageSize: 15,
            showSizeChanger: true,
            pageSizeOptions: ['15', '30', '50'],
            size: 'small',
            className: 'px-4'
          }}
          scroll={{ y: 'calc(100vh - 280px)' }}
        />
      </div>
    </Card>
  )
}
