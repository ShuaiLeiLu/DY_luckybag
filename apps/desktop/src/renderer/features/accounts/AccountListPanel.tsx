import { Button, Card, Empty, Tag } from 'antd'
import { PlusOutlined, UserOutlined } from '@ant-design/icons'
import type { AccountSession } from '@shared/models'
import { AccountCard } from './AccountCard'

export interface AccountListPanelProps {
  accounts: AccountSession[]
  selectedAccountId: string
  onSelectAccount: (accountId: string) => void
  onToggleAccount: (account: AccountSession) => void
  onReloginAccount: (account: AccountSession) => void
  onDeleteAccount: (account: AccountSession) => void
  onAddAccount?: () => void
  extraActions?: React.ReactNode
}

export function AccountListPanel({
  accounts,
  selectedAccountId,
  onSelectAccount,
  onToggleAccount,
  onReloginAccount,
  onDeleteAccount,
  onAddAccount,
  extraActions
}: AccountListPanelProps) {
  const activeCount = accounts.filter((a) => a.actionActive).length

  return (
    <Card
      className="flex flex-col border-slate-800 bg-slate-900/60 shadow-sm"
      styles={{
        header: { borderBottom: '1px solid rgba(148, 163, 184, 0.08)', padding: '12px 16px' },
        body: { padding: '16px', overflow: 'auto', flex: 1 }
      }}
      title={
        <div className="flex items-center gap-2">
          <UserOutlined className="text-blue-400" />
          <span className="text-sm font-semibold text-slate-100">已接入账号</span>
          <Tag color="default" bordered={false} className="text-xs">
            {activeCount}/{accounts.length} 运行中
          </Tag>
        </div>
      }
      extra={
        extraActions || (
          onAddAccount ? (
            <Button
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              onClick={onAddAccount}
              className="bg-emerald-600 hover:bg-emerald-500 text-xs"
            >
              添加账号
            </Button>
          ) : null
        )
      }
    >
      {accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10">
          <Empty
            description={
              <span className="text-xs text-slate-400">
                暂无账号，点击右上角或左下角“添加账号”扫码接入
              </span>
            }
          >
            {onAddAccount && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                size="small"
                onClick={onAddAccount}
                className="bg-emerald-600 hover:bg-emerald-500 text-xs mt-2"
              >
                立即添加账号
              </Button>
            )}
          </Empty>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
          {accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              selected={selectedAccountId === account.id}
              onSelect={() => onSelectAccount(account.id)}
              onToggle={() => onToggleAccount(account)}
              onRelogin={() => onReloginAccount(account)}
              onDelete={() => onDeleteAccount(account)}
            />
          ))}
        </div>
      )}
    </Card>
  )
}
