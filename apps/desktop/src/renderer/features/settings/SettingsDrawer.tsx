import {
  Button,
  Descriptions,
  Divider,
  Drawer,
  Input,
  InputNumber,
  Slider,
  Switch,
  Tag,
} from 'antd'
import {
  SettingOutlined,
  FilterOutlined,
  ThunderboltOutlined,
  CloudSyncOutlined,
  CloudDownloadOutlined,
} from '@ant-design/icons'
import type { DesktopSettings, UpdateSnapshot } from '@shared/models'

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
      size={420}
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
                disabled checked={false}
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
                disabled checked={false}
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
                disabled checked={false}
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

        <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-4 space-y-2">
          <div className="text-sm font-semibold text-slate-200">纯安卓协议执行</div>
          <p className="text-xs text-slate-400">在账号卡片导入安卓会话，并通过“验证协议”检查当前账号身份及目标福袋详情。</p>
          <p className="text-xs text-slate-400">红包领取及随机互动协议尚未验收，当前停用。签名是否可用以真实接口响应为准。</p>
        </div>

        <div className="space-y-3 rounded-xl border border-slate-800/80 bg-slate-900/50 p-4">
          <div className="text-xs font-medium text-slate-200">任务池服务地址</div>
          <Input aria-label="任务池服务地址" value={settings.poolServerUrl} onChange={(e) => onChange({ poolServerUrl: e.target.value })} />
          <Input.Password aria-label="任务池访问令牌" placeholder="任务池访问令牌" value={settings.poolServerToken} onChange={(e) => onChange({ poolServerToken: e.target.value })} />
          <div className="flex items-center justify-between text-xs text-slate-200">
            <span>重启后恢复运行中的账号</span>
            <Switch checked={settings.resumeOnStartup} onChange={(checked) => onChange({ resumeOnStartup: checked })} />
          </div>
          <div className="flex items-center justify-between text-xs text-slate-200">
            <span>启用签名热更新</span>
            <Switch checked={settings.hotUpdateEnabled} onChange={(checked) => onChange({ hotUpdateEnabled: checked })} />
          </div>
          {settings.hotUpdateEnabled && <>
            <Input aria-label="热更新清单地址" placeholder="HTTPS 清单地址" value={settings.hotUpdateManifestUrl} onChange={(e) => onChange({ hotUpdateManifestUrl: e.target.value })} />
            <Input.TextArea aria-label="热更新验证公钥" placeholder="Ed25519 PEM 公钥" rows={3} value={settings.hotUpdatePublicKey} onChange={(e) => onChange({ hotUpdatePublicKey: e.target.value })} />
          </>}
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
              styles={{ label: { color: '#94a3b8', fontSize: '11px', width: '90px' }, content: { color: '#f1f5f9', fontSize: '12px' } }}
            >
              <Descriptions.Item label="当前版本">
                <Tag color="blue" variant="filled" className="m-0">
                  {updateState.currentVersion || 'v3.0.0'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="最新版本">
                <Tag color="cyan" variant="filled" className="m-0">
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
