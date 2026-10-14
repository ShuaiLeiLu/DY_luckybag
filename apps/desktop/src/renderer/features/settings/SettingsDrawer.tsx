import { useState } from 'react'
import {
  Button,
  Card,
  Descriptions,
  Divider,
  Drawer,
  Form,
  Input,
  InputNumber,
  Radio,
  Slider,
  Space,
  Switch,
  Tag,
  Typography,
  message
} from 'antd'
import {
  SettingOutlined,
  FilterOutlined,
  ThunderboltOutlined,
  CloudSyncOutlined,
  CloudDownloadOutlined,
  AndroidOutlined,
  ApiOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined
} from '@ant-design/icons'
import type { DesktopSettings, UpdateSnapshot, AndroidBridgeStatus, RequestBackendType } from '@shared/models'

type AnyRecord = Record<string, any>

export type SettingsDrawerProps = {
  open: boolean
  settings: DesktopSettings
  updateState: UpdateSnapshot
  updateStatusText: string
  learningSummary: AnyRecord | null
  onClose: () => void
  onChange: (patch: Partial<DesktopSettings>) => void
  onNestedChange: (updater: (settings: DesktopSettings) => DesktopSettings) => void
  onInstallUpdate: () => void
  onDownloadUpdate: () => void
}

export function SettingsDrawer({
  open,
  settings,
  updateState,
  updateStatusText,
  learningSummary,
  onClose,
  onChange,
  onNestedChange,
  onInstallUpdate,
  onDownloadUpdate
}: SettingsDrawerProps) {
  const [testingBridge, setTestingBridge] = useState(false)
  const [bridgeStatus, setBridgeStatus] = useState<AndroidBridgeStatus | null>(null)

  const handleTestBridge = async () => {
    setTestingBridge(true)
    try {
      const res = await window.electronAPI?.desktop?.checkAndroidBridgeStatus?.({
        serverUrl: settings.androidBridge?.serverUrl,
        token: settings.androidBridge?.token
      })
      setBridgeStatus(res || null)
      if (res?.connected && res?.ticketGuardReady) {
        message.success('Android 服务连接成功，TicketGuard 已就绪')
      } else if (res?.connected) {
        message.warning('Android 服务已连接，但 TicketGuard 尚未就绪')
      } else {
        message.error(res?.error || '无法连接到 Android 服务')
      }
    } catch (err: any) {
      setBridgeStatus({
        available: false,
        connected: false,
        ticketGuardReady: false,
        authenticated: false,
        error: err?.message || '测试连接失败'
      })
      message.error(err?.message || '测试连接失败')
    } finally {
      setTestingBridge(false)
    }
  }

  return (
    <Drawer
      title={
        <div className="flex items-center gap-2 text-slate-100 font-semibold">
          <SettingOutlined className="text-blue-400" />
          <span>系统与策略设置</span>
        </div>
      }
      open={open}
      onClose={onClose}
      width={420}
      styles={{
        body: { padding: '20px 24px', backgroundColor: '#090f1d' },
        header: { backgroundColor: '#0b1324', borderBottom: '1px solid rgba(148, 163, 184, 0.1)' }
      }}
    >
      <div className="space-y-6">
        {/* 1. 筛选过滤策略 */}
        <div>
          <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            <FilterOutlined className="text-cyan-400" />
            <span>筛选过滤策略</span>
          </div>

          <div className="space-y-3 rounded-xl border border-slate-800/80 bg-slate-900/50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-slate-200">过滤粉丝团福袋</div>
                <div className="text-[11px] text-slate-500">跳过需要加入粉丝团或灯牌要求的福袋</div>
              </div>
              <Switch
                size="small"
                checked={settings.filterFanClub.enabled}
                onChange={(checked) =>
                  onNestedChange((prev) => ({
                    ...prev,
                    filterFanClub: { enabled: checked }
                  }))
                }
              />
            </div>

            <Divider className="my-2 border-slate-800/60" />

            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-slate-200">只抢实物奖品</div>
                <div className="text-[11px] text-slate-500">仅参与有实物礼品奖项的福袋</div>
              </div>
              <Switch
                size="small"
                checked={settings.onlyPhysicalPrize.enabled}
                onChange={(checked) =>
                  onNestedChange((prev) => ({
                    ...prev,
                    onlyPhysicalPrize: { enabled: checked }
                  }))
                }
              />
            </div>

            <Divider className="my-2 border-slate-800/60" />

            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-slate-200">优先大红包</div>
                <div className="text-[11px] text-slate-500">超过指定金额阈值时提升调度优先级</div>
              </div>
              <Switch
                size="small"
                checked={settings.preferBigRedPacket.enabled}
                onChange={(checked) =>
                  onNestedChange((prev) => ({
                    ...prev,
                    preferBigRedPacket: { ...prev.preferBigRedPacket, enabled: checked }
                  }))
                }
              />
            </div>

            {settings.preferBigRedPacket.enabled && (
              <div className="mt-2 pl-2">
                <div className="mb-1 text-[11px] text-slate-400">大红包阈值 (钻石/元)</div>
                <InputNumber
                  size="small"
                  min={1}
                  max={10000}
                  className="w-full"
                  value={settings.preferBigRedPacket.threshold}
                  onChange={(val) =>
                    onNestedChange((prev) => ({
                      ...prev,
                      preferBigRedPacket: {
                        ...prev.preferBigRedPacket,
                        threshold: Number(val || 40)
                      }
                    }))
                  }
                />
              </div>
            )}

            <Divider className="my-2 border-slate-800/60" />

            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-200">命中率下限</span>
                <span className="font-mono text-xs text-cyan-400">
                  {(settings.hitRate.value * 100).toFixed(0)}%
                </span>
              </div>
              <Slider
                min={0.01}
                max={0.5}
                step={0.01}
                value={settings.hitRate.value}
                onChange={(val) =>
                  onNestedChange((prev) => ({
                    ...prev,
                    hitRate: { ...prev.hitRate, value: Number(val) }
                  }))
                }
              />
            </div>
          </div>
        </div>

        {/* 2. 执行与交互策略 */}
        <div>
          <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            <ThunderboltOutlined className="text-amber-400" />
            <span>执行与交互策略</span>
          </div>

          <div className="space-y-3 rounded-xl border border-slate-800/80 bg-slate-900/50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-slate-200">自动参与抢红包</div>
                <div className="text-[11px] text-slate-500">检测到直播间红包时自动领取</div>
              </div>
              <Switch
                size="small"
                checked={settings.enableRedPacket}
                onChange={(checked) => onChange({ enableRedPacket: checked })}
              />
            </div>

            <Divider className="my-2 border-slate-800/60" />

            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-slate-200">只抢红包模式</div>
                <div className="text-[11px] text-slate-500">跳过所有福袋，专门参与秒抢红包</div>
              </div>
              <Switch
                size="small"
                checked={settings.onlyRedPacketMode.enabled}
                onChange={(checked) =>
                  onNestedChange((prev) => ({
                    ...prev,
                    onlyRedPacketMode: { enabled: checked },
                    enableRedPacket: checked ? true : prev.enableRedPacket
                  }))
                }
              />
            </div>

            <Divider className="my-2 border-slate-800/60" />

            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-slate-200">随机弹幕互动</div>
                <div className="text-[11px] text-slate-500">开奖等待阶段模拟真人发送活跃弹幕</div>
              </div>
              <Switch
                size="small"
                checked={settings.randomInteraction}
                onChange={(checked) => onChange({ randomInteraction: checked })}
              />
            </div>

            <Divider className="my-2 border-slate-800/60" />

            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-200">抢后停留时间 (秒)</span>
                <span className="font-mono text-xs text-amber-400">
                  {settings.stayDuration} 秒
                </span>
              </div>
              <Slider
                min={3}
                max={120}
                value={settings.stayDuration}
                onChange={(val) => onChange({ stayDuration: Number(val) })}
              />
            </div>
          </div>
        </div>

        {/* 3. 请求后端与 Android 原生服务 */}
        <div>
          <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            <AndroidOutlined className="text-emerald-400" />
            <span>请求后端与 Android 服务</span>
          </div>

          <div className="space-y-4 rounded-xl border border-slate-800/80 bg-slate-900/50 p-4">
            <div>
              <div className="text-xs font-medium text-slate-200 mb-1">请求后端引擎</div>
              <div className="text-[11px] text-slate-500 mb-3">
                选择抖音请求的底层引擎。Android 模式需要原生伴生服务与合法 TicketGuard 运行时。
              </div>
              <Radio.Group
                value={settings.requestBackend || 'web'}
                onChange={(e) => onChange({ requestBackend: e.target.value as RequestBackendType })}
                className="w-full flex flex-col gap-2"
              >
                <Radio value="web" className="text-slate-300 text-xs">
                  <span>Web 端请求 (默认，成熟稳定)</span>
                </Radio>
                <Radio value="auto" className="text-slate-300 text-xs">
                  <span>自动选择 (Android 可用优先，自动回退 Web)</span>
                </Radio>
                <Radio value="android" className="text-slate-300 text-xs">
                  <span>Android 原生端 (仅在 TicketGuard 就绪时使用)</span>
                </Radio>
              </Radio.Group>
            </div>

            <Divider className="my-2 border-slate-800/60" />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-200">Android 伴生服务地址</span>
                <span className="text-[11px] text-slate-500">局域网或本地 HTTP</span>
              </div>
              <Input
                size="small"
                value={settings.androidBridge?.serverUrl || 'http://127.0.0.1:8765'}
                placeholder="http://127.0.0.1:8765"
                onChange={(e) =>
                  onNestedChange((prev) => ({
                    ...prev,
                    androidBridge: {
                      ...(prev.androidBridge || { enabled: false, token: '' }),
                      serverUrl: e.target.value
                    }
                  }))
                }
                className="text-xs bg-slate-800/50 border-slate-700 text-slate-200"
              />

              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-200">配对访问 Token (可选)</span>
              </div>
              <Input.Password
                size="small"
                value={settings.androidBridge?.token || ''}
                placeholder="安全通信 Token"
                onChange={(e) =>
                  onNestedChange((prev) => ({
                    ...prev,
                    androidBridge: {
                      ...(prev.androidBridge || { enabled: false, serverUrl: 'http://127.0.0.1:8765' }),
                      token: e.target.value
                    }
                  }))
                }
                className="text-xs bg-slate-800/50 border-slate-700 text-slate-200"
              />

              <div className="pt-1 flex items-center justify-between">
                <Button
                  size="small"
                  icon={testingBridge ? <SyncOutlined spin /> : <ApiOutlined />}
                  loading={testingBridge}
                  onClick={handleTestBridge}
                  className="text-xs border-slate-700 bg-slate-800/60 text-slate-300 hover:bg-slate-700"
                >
                  测试 Android 服务状态
                </Button>

                {bridgeStatus && (
                  <div className="flex items-center gap-1.5 text-xs">
                    {bridgeStatus.connected ? (
                      <Tag color="success" className="m-0 text-[11px]">已连接</Tag>
                    ) : (
                      <Tag color="error" className="m-0 text-[11px]">未连接</Tag>
                    )}
                    {bridgeStatus.ticketGuardReady ? (
                      <Tag color="blue" className="m-0 text-[11px]">TicketGuard 就绪</Tag>
                    ) : (
                      <Tag color="warning" className="m-0 text-[11px]">TicketGuard 未就绪</Tag>
                    )}
                  </div>
                )}
              </div>

              {bridgeStatus?.capabilities && bridgeStatus.capabilities.length > 0 && (
                <div className="text-[11px] text-slate-400 flex items-center gap-1 pt-1">
                  <span>支持能力:</span>
                  {bridgeStatus.capabilities.map((cap) => (
                    <Tag key={cap} color="default" className="text-[10px] m-0">
                      {cap}
                    </Tag>
                  ))}
                </div>
              )}

              {bridgeStatus?.error && (
                <div className="text-[11px] text-rose-400 bg-rose-950/30 p-2 rounded border border-rose-900/50">
                  {bridgeStatus.error}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 4. 系统更新与模型 */}
        <div>
          <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            <CloudSyncOutlined className="text-emerald-400" />
            <span>系统版本与状态</span>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-4 space-y-3">
            <Descriptions
              size="small"
              column={1}
              className="bg-transparent"
              labelStyle={{ color: '#94a3b8', fontSize: '11px', width: '90px' }}
              contentStyle={{ color: '#f1f5f9', fontSize: '12px' }}
            >
              <Descriptions.Item label="当前版本">
                <Tag color="blue" bordered={false} className="m-0">
                  {updateState.currentVersion || 'v3.0.0'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="最新版本">
                <Tag color="cyan" bordered={false} className="m-0">
                  {updateState.latestVersion || '-'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="更新状态">
                <span className="text-xs text-slate-300">{updateStatusText}</span>
              </Descriptions.Item>
              <Descriptions.Item label="学习反馈">
                <span className="font-mono text-xs text-emerald-400">
                  {learningSummary?.feedbackCount || 0} 条
                </span>
              </Descriptions.Item>
            </Descriptions>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <Button
                size="small"
                icon={<CloudDownloadOutlined />}
                onClick={onDownloadUpdate}
                className="text-xs border-slate-700 bg-slate-800/60 text-slate-300 hover:bg-slate-700"
              >
                下载更新
              </Button>
              <Button
                size="small"
                type="primary"
                onClick={onInstallUpdate}
                className="text-xs bg-emerald-600 hover:bg-emerald-500"
              >
                安装并重启
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Drawer>
  )
}
