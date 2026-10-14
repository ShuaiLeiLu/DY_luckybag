import { useState, type RefObject } from 'react'
import { Card, Empty, Radio, Tag, Typography } from 'antd'
import { FileTextOutlined } from '@ant-design/icons'

export type TimelineLogEntry = {
  id: number
  time: string
  type: 'info' | 'warning' | 'error' | 'success'
  message: string
}

export type TimelinePanelProps = {
  logs: TimelineLogEntry[]
  logListRef: RefObject<HTMLDivElement | null>
  onLogListScroll: () => void
}

export function TimelinePanel({
  logs,
  logListRef,
  onLogListScroll
}: TimelinePanelProps) {
  const [filterType, setFilterType] = useState<string>('all')

  const filteredLogs = logs.filter((log) => {
    if (filterType === 'all') return true
    return log.type === filterType
  })

  return (
    <Card
      className="flex h-full flex-col border-slate-800 bg-slate-900/60 shadow-sm"
      styles={{
        header: { borderBottom: '1px solid rgba(148, 163, 184, 0.08)', padding: '10px 16px' },
        body: { padding: '8px 12px', overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column' }
      }}
      title={
        <div className="flex items-center gap-2">
          <FileTextOutlined className="text-blue-400" />
          <span className="text-sm font-semibold text-slate-100">实时系统日志</span>
          <span className="font-mono text-xs text-slate-400">({filteredLogs.length})</span>
        </div>
      }
      extra={
        <Radio.Group
          size="small"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          buttonStyle="solid"
          className="text-xs"
        >
          <Radio.Button value="all">全部</Radio.Button>
          <Radio.Button value="success">成功</Radio.Button>
          <Radio.Button value="warning">警告</Radio.Button>
          <Radio.Button value="error">错误</Radio.Button>
        </Radio.Group>
      }
    >
      <div
        ref={logListRef}
        onScroll={onLogListScroll}
        className="scrollbar-thin flex-1 overflow-auto space-y-1 pr-1 font-mono text-xs"
      >
        {filteredLogs.length === 0 ? (
          <div className="flex h-40 items-center justify-center">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span className="text-xs text-slate-500">暂无日志</span>} />
          </div>
        ) : (
          filteredLogs.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start gap-2 rounded px-2 py-1 transition-colors hover:bg-slate-800/60"
            >
              <span className="shrink-0 text-[11px] text-slate-500 pt-[1px] select-none">
                {entry.time}
              </span>
              <span className="shrink-0">
                {entry.type === 'success' && (
                  <Tag color="success" bordered={false} className="m-0 text-[10px] px-1 py-0 leading-normal">
                    成功
                  </Tag>
                )}
                {entry.type === 'warning' && (
                  <Tag color="warning" bordered={false} className="m-0 text-[10px] px-1 py-0 leading-normal">
                    警告
                  </Tag>
                )}
                {entry.type === 'error' && (
                  <Tag color="error" bordered={false} className="m-0 text-[10px] px-1 py-0 leading-normal">
                    失败
                  </Tag>
                )}
                {entry.type === 'info' && (
                  <Tag color="blue" bordered={false} className="m-0 text-[10px] px-1 py-0 leading-normal">
                    信息
                  </Tag>
                )}
              </span>
              <span className="break-all text-[12px] text-slate-300 leading-tight">
                {entry.message}
              </span>
            </div>
          ))
        )}
      </div>
    </Card>
  )
}
