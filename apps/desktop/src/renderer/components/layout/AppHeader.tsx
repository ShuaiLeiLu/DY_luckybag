import { useState } from 'react'
import { Badge, Button, Modal, Space, Tag, Tooltip } from 'antd'
import {
  SoundOutlined,
  CloudDownloadOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined
} from '@ant-design/icons'
import type { DispatchSummary, LicenseSnapshot, UpdateSnapshot } from '@shared/models'
import { formatRelative } from '../../lib/runtime'
import { MarkdownNotice } from '../../features/license/LicenseGate'

interface AppHeaderProps {
  totalDiamonds: number
  totalWins: number
  totalParticipation: number
  runningCount: number
  accountCount: number
  dispatchSummary: DispatchSummary
  license: LicenseSnapshot
  announcementMarkdown: string
  updateState: UpdateSnapshot
  useHotUpdateBadge: boolean
  onInstallUpdate: () => void
}

export function AppHeader({
  totalDiamonds,
  totalWins,
  totalParticipation,
  runningCount,
  accountCount,
  dispatchSummary,
  license,
  announcementMarkdown,
  updateState,
  useHotUpdateBadge,
  onInstallUpdate
}: AppHeaderProps) {
  const [noticeModalOpen, setNoticeModalOpen] = useState(false)

  const isTrial = license.accessMode === 'trial'
  const isAuthorized = license.authorized || isTrial

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800/80 bg-slate-950/70 px-6 backdrop-blur-md select-none">
      {/* 核心指标看板 */}
      <div className="flex items-center gap-6 overflow-x-auto scrollbar-thin py-1">
        {/* 今日收益 */}
        <div className="flex flex-col">
          <span className="text-[11px] text-slate-400 font-medium">今日收益</span>
          <div className="flex items-baseline gap-1">
            <span className="font-mono text-lg font-bold text-amber-400">{totalDiamonds}</span>
            <span className="text-[11px] text-slate-500">钻</span>
          </div>
        </div>

        <div className="h-7 w-px bg-slate-800" />

        {/* 累计中奖 */}
        <div className="flex flex-col">
          <span className="text-[11px] text-slate-400 font-medium">总计中奖</span>
          <div className="flex items-baseline gap-1">
            <span className="font-mono text-lg font-bold text-emerald-400">{totalWins}</span>
            <span className="text-[11px] text-slate-500">次</span>
          </div>
        </div>

        <div className="h-7 w-px bg-slate-800" />

        {/* 参与人次 */}
        <div className="flex flex-col">
          <span className="text-[11px] text-slate-400 font-medium">参与人次</span>
          <div className="flex items-baseline gap-1">
            <span className="font-mono text-lg font-bold text-sky-400">{totalParticipation}</span>
            <span className="text-[11px] text-slate-500">次</span>
          </div>
        </div>

        <div className="h-7 w-px bg-slate-800" />

        {/* 在线账号 */}
        <div className="flex flex-col">
          <span className="text-[11px] text-slate-400 font-medium">在线账号</span>
          <div className="flex items-baseline gap-1">
            <span className="font-mono text-lg font-bold text-indigo-400">{runningCount}</span>
            <span className="text-[11px] text-slate-500">/ {accountCount}</span>
          </div>
        </div>

        <div className="h-7 w-px bg-slate-800" />

        {/* 服务端福袋池 */}
        <Tooltip title={dispatchSummary.connected ? '服务端实时候选福袋池' : '未连接到福袋服务端'}>
          <div className="flex flex-col cursor-help">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-400 font-medium">服务端池</span>
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  dispatchSummary.connected ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : 'bg-rose-500'
                }`}
              />
            </div>
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-lg font-bold text-teal-300">
                {dispatchSummary.validCandidates}
              </span>
              <span className="text-[11px] text-slate-500">个</span>
            </div>
          </div>
        </Tooltip>

        <div className="h-7 w-px bg-slate-800" />

        {/* 客户端可抢数 */}
        <div className="flex flex-col">
          <span className="text-[11px] text-slate-400 font-medium">客户端可抢</span>
          <div className="flex items-baseline gap-1">
            <span className="font-mono text-lg font-bold text-cyan-400">
              {dispatchSummary.availableCandidates}
            </span>
            <span className="text-[11px] text-slate-500">个</span>
          </div>
        </div>
      </div>

      {/* 右侧状态与操作 */}
      <div className="flex items-center gap-3 shrink-0 pl-4">
        {/* 系统公告按钮 */}
        {announcementMarkdown ? (
          <>
            <Button
              type="text"
              size="small"
              icon={<SoundOutlined className="text-amber-400" />}
              onClick={() => setNoticeModalOpen(true)}
              className="text-xs text-slate-300 hover:text-amber-300 hover:bg-amber-400/10 px-2.5 h-8 border border-amber-500/20"
            >
              系统公告
            </Button>
            <Modal
              title={
                <div className="flex items-center gap-2 text-base font-semibold text-slate-100">
                  <SoundOutlined className="text-amber-400" />
                  系统公告
                </div>
              }
              open={noticeModalOpen}
              onCancel={() => setNoticeModalOpen(false)}
              footer={[
                <Button key="ok" type="primary" onClick={() => setNoticeModalOpen(false)}>
                  我知道了
                </Button>
              ]}
              width={560}
            >
              <div className="max-h-[360px] overflow-auto py-2">
                <MarkdownNotice markdown={announcementMarkdown} />
              </div>
            </Modal>
          </>
        ) : null}

        {/* 更新提示 */}
        {!useHotUpdateBadge && updateState.status === 'downloaded' && (
          <Button
            type="primary"
            size="small"
            icon={<CloudDownloadOutlined />}
            onClick={onInstallUpdate}
            className="bg-blue-600 hover:bg-blue-500 animate-pulse text-xs h-8 font-medium"
          >
            新版本就绪
          </Button>
        )}

        {/* 授权状态徽章 */}
        <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-1.5">
          <span className="text-[11px] text-slate-400">授权:</span>
          {isAuthorized ? (
            isTrial ? (
              <span className="flex items-center gap-1 text-xs font-medium text-amber-300">
                <ClockCircleOutlined className="text-[11px]" />
                试用中 (余{formatRelative(license.trialRemainingSec)})
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs font-medium text-emerald-400">
                <CheckCircleOutlined className="text-[11px]" />
                已授权
              </span>
            )
          ) : (
            <span className="flex items-center gap-1 text-xs font-medium text-rose-400">
              <ExclamationCircleOutlined className="text-[11px]" />
              {license.message || '未授权'}
            </span>
          )}
        </div>
      </div>
    </header>
  )
}
