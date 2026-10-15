import { Avatar, Button, Card, Popconfirm, Tag, Tooltip } from 'antd'
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  QrcodeOutlined,
  DeleteOutlined,
  UserOutlined,
  TrophyOutlined,
  FieldTimeOutlined
} from '@ant-design/icons'
import type { AccountSession } from '@shared/models'
import { statusText, statusTone } from '../../lib/runtime'

export type AccountCardProps = {
  account: AccountSession
  selected: boolean
  onSelect: () => void
  onToggle: () => void
  onRelogin: () => void
  onDelete: () => void
}

function getTagColor(state: string) {
  switch (state) {
    case 'running':
    case 'scanning':
    case 'joining':
    case 'claiming':
      return 'success'
    case 'paused':
      return 'warning'
    case 'login_required':
      return 'error'
    case 'waiting':
    case 'ready':
      return 'processing'
    default:
      return 'default'
  }
}

export function AccountCard({
  account,
  selected,
  onSelect,
  onToggle,
  onRelogin,
  onDelete
}: AccountCardProps) {
  const isRunning = account.actionActive

  return (
    <Card
      size="small"
      hoverable
      className={`transition-all duration-200 cursor-pointer ${
        selected
          ? 'border-blue-500/80 bg-blue-950/20 shadow-md shadow-blue-500/10 ring-1 ring-blue-500/50'
          : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900/90'
      }`}
      onClick={onSelect}
      styles={{
        body: { padding: '12px 14px' }
      }}
    >
      {/* 头部：头像、昵称、状态 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar
            size={36}
            className={`font-bold shrink-0 ${
              isRunning ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-200'
            }`}
            icon={<UserOutlined />}
          >
            {account.nickname ? account.nickname[0] : null}
          </Avatar>
          <div className="flex flex-col min-w-0">
            <span className="truncate text-sm font-semibold text-slate-100">
              {account.nickname || account.id}
            </span>
            <span className="truncate text-[11px] text-slate-500 font-mono">
              {account.id}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {account.requestBackend === 'android' && (
            <Tag bordered={false} color="cyan" className="m-0 text-[10px] px-1.5 py-0.5">
              Android
            </Tag>
          )}
          <Tag
            bordered={false}
            color={getTagColor(account.runtimeState)}
            className="m-0 text-xs px-2 py-0.5"
          >
            {statusText(account.runtimeState)}
          </Tag>
        </div>
      </div>

      {/* 统计指标行 */}
      <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-950/60 p-2 border border-slate-800/60 text-center">
        <div>
          <div className="text-[10px] text-slate-400">参与场次</div>
          <div className="font-mono text-xs font-bold text-slate-200 mt-0.5">
            {account.participationCount || 0}
          </div>
        </div>
        <div className="border-x border-slate-800/60">
          <div className="text-[10px] text-slate-400">今日收益</div>
          <div className="font-mono text-xs font-bold text-amber-400 mt-0.5">
            {account.todayEarnedDiamonds || 0}
          </div>
        </div>
        <div className="overflow-hidden">
          <div className="text-[10px] text-slate-400">当前任务</div>
          <div className="truncate text-[11px] font-medium text-cyan-300 mt-0.5" title={account.currentTaskLotteryName || account.currentTaskLabel || '待命'}>
            {account.currentTaskLotteryName || account.currentTaskLabel || account.currentTaskStage || '待命'}
          </div>
        </div>
      </div>

      {/* 底部快捷操作 */}
      <div
        className="mt-3 flex items-center gap-1.5 pt-1 border-t border-slate-800/50"
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          size="small"
          type={isRunning ? 'default' : 'primary'}
          icon={isRunning ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
          className={isRunning ? 'flex-1 text-amber-400 border-amber-500/30 bg-amber-500/10 text-xs' : 'flex-1 bg-emerald-600 hover:bg-emerald-500 text-xs'}
          onClick={onToggle}
        >
          {isRunning ? '暂停' : '启动'}
        </Button>

        <Tooltip title="重新打开浏览器扫码登录">
          <Button
            size="small"
            icon={<QrcodeOutlined />}
            className="flex-1 text-xs text-slate-300 bg-slate-800/60 border-slate-700 hover:bg-slate-700"
            onClick={onRelogin}
          >
            重新扫码
          </Button>
        </Tooltip>

        <Popconfirm
          title="确认删除账号？"
          description="删除后将断开当前会话并清除本地登录凭证。"
          okText="确认删除"
          cancelText="取消"
          okButtonProps={{ danger: true, size: 'small' }}
          cancelButtonProps={{ size: 'small' }}
          onConfirm={onDelete}
        >
          <Button
            size="small"
            danger
            type="text"
            icon={<DeleteOutlined />}
            className="text-xs px-2 text-rose-400 hover:bg-rose-500/10"
          />
        </Popconfirm>
      </div>
    </Card>
  )
}
