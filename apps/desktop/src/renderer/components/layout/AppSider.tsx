import { Button, Menu, Space, Tag, Typography } from 'antd'
import type { MenuProps } from 'antd'
import {
  DashboardOutlined,
  UserOutlined,
  HistoryOutlined,
  FileTextOutlined,
  PlusOutlined,
  SettingOutlined,
  SafetyCertificateOutlined
} from '@ant-design/icons'
import type { LicenseSnapshot } from '@shared/models'

export type MainView = 'dashboard' | 'accounts' | 'history' | 'logs'

interface AppSiderProps {
  activeView: MainView
  onViewChange: (view: MainView) => void
  appVersion: string
  license: LicenseSnapshot
  onAddAccount: () => void
  onOpenSettings: () => void
  onOpenLicenseGate: () => void
}

const menuItems: MenuProps['items'] = [
  {
    key: 'dashboard',
    icon: <DashboardOutlined />,
    label: '工作总览'
  },
  {
    key: 'accounts',
    icon: <UserOutlined />,
    label: '账号管理'
  },
  {
    key: 'history',
    icon: <HistoryOutlined />,
    label: '历史记录'
  },
  {
    key: 'logs',
    icon: <FileTextOutlined />,
    label: '系统日志'
  }
]

export function AppSider({
  activeView,
  onViewChange,
  appVersion,
  license,
  onAddAccount,
  onOpenSettings,
  onOpenLicenseGate
}: AppSiderProps) {
  const isAuthorized = license.authorized || license.accessMode === 'trial'

  return (
    <div className="flex h-full flex-col justify-between border-r border-slate-800/80 bg-slate-950/80 select-none">
      {/* 顶部 Logo 与系统标题 */}
      <div>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800/60">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-blue-600 to-cyan-400 text-white font-black shadow-md shadow-blue-500/20">
            抖
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm tracking-wide text-slate-100">福袋工作台</span>
              <Tag bordered={false} color="blue" className="m-0 text-[10px] px-1.5 py-0 leading-normal">
                v{appVersion}
              </Tag>
            </div>
            <Typography.Text type="secondary" className="text-[11px]">
              自动化监控与调度
            </Typography.Text>
          </div>
        </div>

        {/* 导航菜单 */}
        <div className="p-3">
          <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            导航菜单
          </div>
          <Menu
            mode="inline"
            selectedKeys={[activeView]}
            items={menuItems}
            onClick={({ key }) => onViewChange(key as MainView)}
            className="border-none bg-transparent"
            style={{ fontSize: 13 }}
          />
        </div>
      </div>

      {/* 底部操作区 */}
      <div className="border-t border-slate-800/60 p-4 space-y-3">
        <Button
          type="primary"
          icon={<PlusOutlined />}
          block
          onClick={onAddAccount}
          className="bg-emerald-600 hover:bg-emerald-500 font-medium h-9 shadow-sm shadow-emerald-950"
        >
          添加账号
        </Button>

        <div className="grid grid-cols-2 gap-2">
          <Button
            icon={<SettingOutlined />}
            size="small"
            onClick={onOpenSettings}
            className="text-xs text-slate-300 border-slate-700 bg-slate-900/60 hover:bg-slate-800"
          >
            设置
          </Button>
          <Button
            icon={<SafetyCertificateOutlined />}
            size="small"
            onClick={onOpenLicenseGate}
            className="text-xs text-slate-300 border-slate-700 bg-slate-900/60 hover:bg-slate-800"
          >
            授权
          </Button>
        </div>

        <div className="flex items-center justify-between px-1 pt-1 text-[11px]">
          <span className="text-slate-500">授权状态</span>
          {isAuthorized ? (
            <Tag color="success" bordered={false} className="m-0 text-[10px]">
              {license.accessMode === 'trial' ? '试用中' : '已授权'}
            </Tag>
          ) : (
            <Tag color="error" bordered={false} className="m-0 text-[10px]">
              未授权
            </Tag>
          )}
        </div>
      </div>
    </div>
  )
}
