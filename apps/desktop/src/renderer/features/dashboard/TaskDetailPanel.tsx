import type { AccountSession } from '@shared/models'
import { statusText } from '../../lib/runtime'
import { DetailRow } from '../../components/ui/StatusWidgets'

type AnyRecord = Record<string, any>

export type TaskDetailPanelProps = {
  selectedAccount: AccountSession | null
}

/**
 * 任务详情面板只聚合账号任务数据展示。
 * 账号派发、角色切换等行为由上层管理，保持组件职责单一。
 */
export function TaskDetailPanel(props: TaskDetailPanelProps) {
  return (
    <aside className="glass scrollbar-thin flex flex-col overflow-auto rounded-[26px] p-4 2xl:min-h-0">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-white">任务详情</h2>
        <p className="text-sm text-slate-400">选中账号后查看当前租约和派单细节。</p>
      </div>
      <div className="space-y-3">
        <DetailRow label="账号" value={props.selectedAccount?.nickname || '未选择'} />
        <DetailRow label="角色" value={formatScanRoleText(props.selectedAccount?.scanRole || '')} />
        <DetailRow label="状态" value={props.selectedAccount ? statusText(props.selectedAccount.runtimeState) : '-'} />
        <DetailRow label="当前任务" value={props.selectedAccount?.currentTaskLotteryName || props.selectedAccount?.currentTaskLabel || '暂无'} />
      </div>
    </aside>
  )
}

function formatScanRoleText(role: string) {
  if (role === 'scanner') return '扫描账号'
  if (role === 'worker') return '执行账号'
  return role || '-'
}
