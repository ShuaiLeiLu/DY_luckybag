import { Button, Card, Descriptions, Empty, Space, Steps, Tag } from 'antd'
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  ApiOutlined,
  DashboardOutlined
} from '@ant-design/icons'
import type { AccountSession } from '@shared/models'
import { formatRelative, statusText } from '../../lib/runtime'

export type TaskDetailPanelProps = {
  selectedAccount: AccountSession | null
  accounts: AccountSession[]
  onToggleAccount?: (account: AccountSession) => void
  onReloginAccount?: (account: AccountSession) => void
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

function getFlowCurrentStep(account: AccountSession): number {
  const runtime = account.runtimeState
  if (runtime === 'login_required') return 0
  if (runtime === 'ready' || runtime === 'paused') return 1
  if (runtime === 'scanning' || runtime === 'preheating') return 2
  if (runtime === 'claiming') return 3
  if (runtime === 'joining') return 4
  if (runtime === 'waiting_result' || runtime === 'cooldown') return 5
  return 1
}

export function TaskDetailPanel({
  selectedAccount,
  onToggleAccount,
  onReloginAccount
}: TaskDetailPanelProps) {
  if (!selectedAccount) {
    return (
      <Card
        className="flex h-full flex-col border-slate-800 bg-slate-900/60 shadow-sm"
        title={
          <div className="flex items-center gap-2">
            <DashboardOutlined className="text-cyan-400" />
            <span className="text-sm font-semibold text-slate-100">账号实时状态</span>
          </div>
        }
      >
        <div className="flex h-48 flex-col items-center justify-center">
          <Empty description={<span className="text-xs text-slate-400">请选择一个账号查看详情</span>} />
        </div>
      </Card>
    )
  }

  const isRunning = selectedAccount.actionActive
  const currentStep = getFlowCurrentStep(selectedAccount)

  const stepsItems = [
    {
      title: '登录',
      description: selectedAccount.token ? '已就绪' : '待验证'
    },
    {
      title: '启动',
      description: isRunning ? '执行中' : '已暂停'
    },
    {
      title: '扫描',
      description: `池:${selectedAccount.poolAvailableCandidates || 0}`
    },
    {
      title: '领取',
      description: selectedAccount.currentTaskLotteryName ? '已锁定' : '轮询'
    },
    {
      title: '进房',
      description: selectedAccount.currentRoom || '等待'
    },
    {
      title: '开奖',
      description:
        selectedAccount.currentTaskLeaseRemainingSec > 0
          ? `${selectedAccount.currentTaskLeaseRemainingSec}s`
          : '待开'
    }
  ]

  return (
    <Card
      className="flex h-full flex-col border-slate-800 bg-slate-900/60 shadow-sm"
      styles={{
        header: { borderBottom: '1px solid rgba(148, 163, 184, 0.08)', padding: '12px 16px' },
        body: { padding: '16px', overflow: 'auto', flex: 1 }
      }}
      title={
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DashboardOutlined className="text-cyan-400" />
            <span className="text-sm font-semibold text-slate-100">
              {selectedAccount.nickname || selectedAccount.id}
            </span>
            <Tag bordered={false} color={isRunning ? 'success' : 'warning'} className="text-xs">
              {statusText(selectedAccount.runtimeState)}
            </Tag>
          </div>
          <Space orientation="horizontal" size="small">
            <Button
              size="small"
              type={isRunning ? 'default' : 'primary'}
              icon={isRunning ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
              className={
                isRunning
                  ? 'text-amber-400 border-amber-500/30 bg-amber-500/10 text-xs'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-xs'
              }
              onClick={() => onToggleAccount?.(selectedAccount)}
            >
              {isRunning ? '暂停' : '启动'}
            </Button>
            <Button
              size="small"
              icon={<ApiOutlined />}
              className="text-xs text-slate-300 bg-slate-800/60 border-slate-700 hover:bg-slate-700"
              onClick={() => onReloginAccount?.(selectedAccount)}
            >验证</Button>
          </Space>
        </div>
      }
    >
      <div className="space-y-4">
        {/* 关键信息描述 */}
        <Descriptions
          size="small"
          column={{ xs: 1, sm: 2, md: 2, lg: 2, xl: 2, xxl: 3 }}
          bordered
          className="rounded-lg overflow-hidden bg-slate-950/40"
          labelStyle={{
            color: '#94a3b8',
            fontSize: '11px',
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            width: '90px'
          }}
          contentStyle={{ color: '#e2e8f0', fontSize: '12px' }}
        >
          <Descriptions.Item label="当前阶段">
            <span className="font-medium text-cyan-300">{formatStageText(selectedAccount)}</span>
          </Descriptions.Item>
          <Descriptions.Item label="租约剩余">
            <span className="font-mono text-emerald-400 font-semibold">
              {selectedAccount.currentTaskLeaseRemainingSec > 0
                ? formatRelative(selectedAccount.currentTaskLeaseRemainingSec)
                : '-'}
            </span>
          </Descriptions.Item>
          <Descriptions.Item label="当前直播间">
            <span className="truncate max-w-[140px] inline-block" title={selectedAccount.currentRoom || '-'}>
              {selectedAccount.currentRoom || '-'}
            </span>
          </Descriptions.Item>
          <Descriptions.Item label="目标主播">
            <span className="truncate max-w-[140px] inline-block" title={selectedAccount.currentTaskAnchor || '-'}>
              {selectedAccount.currentTaskAnchor || '-'}
            </span>
          </Descriptions.Item>
          <Descriptions.Item label="目标福袋" span={2}>
            <span className="text-amber-300 font-medium truncate max-w-[280px] inline-block" title={selectedAccount.currentTaskLotteryName || selectedAccount.currentTaskLabel || '空闲轮询中'}>
              {selectedAccount.currentTaskLotteryName || selectedAccount.currentTaskLabel || '空闲轮询中'}
            </span>
          </Descriptions.Item>
          <Descriptions.Item label="任务评分">
            <span className="font-mono text-sky-400">
              {selectedAccount.currentTaskScore > 0 ? selectedAccount.currentTaskScore.toFixed(2) : '-'}
            </span>
          </Descriptions.Item>
          <Descriptions.Item label="扫描上报">
            <span className="font-mono text-slate-300">
              {selectedAccount.scanUploadAccepted || 0} / {selectedAccount.scanUploadSubmitted || 0}
            </span>
          </Descriptions.Item>
        </Descriptions>

        {/* 执行阶段步骤条 */}
        <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3.5">
          <div className="mb-2.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            自动化调度流
          </div>
          <Steps
            size="small"
            current={currentStep}
            items={stepsItems.map((item, index) => ({
              title: <span className="text-xs">{item.title}</span>,
              description: <span className="text-[10px] text-slate-400">{item.description}</span>,
              status: index < currentStep ? 'finish' : index === currentStep ? (isRunning ? 'process' : 'wait') : 'wait'
            }))}
          />
        </div>
      </div>
    </Card>
  )
}
