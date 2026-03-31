import type { ReactNode } from 'react'
import type { DesktopSettings, UpdateSnapshot } from '@shared/models'
import { DetailRow } from '../../components/ui/StatusWidgets'

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

/**
 * 设置抽屉仅保留系统配置能力：
 * - 筛选/执行/更新
 * - 不再承载授权流程，避免职责混杂
 */
export function SettingsDrawer(props: SettingsDrawerProps) {
  return (
    <div className={`pointer-events-none fixed inset-3 z-20 transition duration-300 md:inset-y-4 md:left-auto md:right-4 md:w-[380px] ${props.open ? 'translate-x-0 opacity-100' : 'translate-x-[110%] opacity-0'}`}>
      <div className="glass pointer-events-auto flex h-full flex-col rounded-[30px] p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">设置中心</h2>
            <p className="mt-1 text-sm text-slate-400">修改筛选阈值、执行参数和更新操作。</p>
          </div>
          <button className="rounded-full border border-slate-700/80 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800/60" onClick={props.onClose}>
            关闭
          </button>
        </div>

        <div className="scrollbar-thin mt-5 flex-1 space-y-5 overflow-auto pr-1">
          <Panel title="筛选">
            <SwitchRow
              label="过滤粉丝团"
              checked={props.settings.filterFanClub.enabled}
              onChange={(checked) => props.onNestedChange((settings) => ({ ...settings, filterFanClub: { enabled: checked } }))}
            />
            <SwitchRow
              label="只抢实物"
              checked={props.settings.onlyPhysicalPrize.enabled}
              onChange={(checked) => props.onNestedChange((settings) => ({ ...settings, onlyPhysicalPrize: { enabled: checked } }))}
            />
            <SwitchRow
              label="优先大红包"
              checked={props.settings.preferBigRedPacket.enabled}
              onChange={(checked) => props.onNestedChange((settings) => ({
                ...settings,
                preferBigRedPacket: { ...settings.preferBigRedPacket, enabled: checked }
              }))}
            />
            <RangeInput
              label="大红包阈值"
              value={String(props.settings.preferBigRedPacket.threshold)}
              onChange={(value) => props.onNestedChange((settings) => ({
                ...settings,
                preferBigRedPacket: {
                  ...settings.preferBigRedPacket,
                  threshold: Number(value || 40)
                }
              }))}
            />
            <RangeInput
              label="命中率下限"
              value={String(props.settings.hitRate.value)}
              onChange={(value) => props.onNestedChange((settings) => ({
                ...settings,
                hitRate: {
                  ...settings.hitRate,
                  value: Number(value || 0.08)
                }
              }))}
            />
          </Panel>

          <Panel title="执行">
            <SwitchRow
              label="自动抢红包"
              checked={props.settings.enableRedPacket}
              onChange={(checked) => props.onChange({ enableRedPacket: checked })}
            />
            <SwitchRow
              label="随机互动"
              checked={props.settings.randomInteraction}
              onChange={(checked) => props.onChange({ randomInteraction: checked })}
            />
            <RangeInput
              label="抢后停留（秒）"
              value={String(props.settings.stayDuration)}
              onChange={(value) => props.onChange({ stayDuration: Number(value || 18) })}
            />
          </Panel>

          <Panel title="更新与学习">
            <DetailRow label="更新状态" value={props.updateStatusText} />
            <DetailRow label="当前版本" value={props.updateState.currentVersion} />
            <DetailRow label="最新版本" value={props.updateState.latestVersion || '-'} />
            <DetailRow label="学习反馈数" value={String(props.learningSummary?.feedbackCount || 0)} />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-3 text-sm text-cyan-100 transition hover:bg-cyan-500/20" onClick={props.onDownloadUpdate}>
                下载更新
              </button>
              <button className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-100 transition hover:bg-emerald-500/20" onClick={props.onInstallUpdate}>
                安装更新
              </button>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}

function Panel(props: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[24px] border border-slate-700/70 bg-slate-950/55 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">{props.title}</h3>
      <div className="mt-4 space-y-3">{props.children}</div>
    </section>
  )
}

function Input(props: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <div className="mb-2 text-xs uppercase tracking-[0.16em] text-slate-500">{props.label}</div>
      <input
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className="w-full rounded-2xl border border-slate-700/80 bg-slate-900/80 px-3 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-400/60"
      />
    </label>
  )
}

function RangeInput(props: { label: string; value: string; onChange: (value: string) => void }) {
  return <Input {...props} />
}

function SwitchRow(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      className="flex w-full items-center justify-between rounded-2xl border border-slate-700/80 bg-slate-900/80 px-3 py-3 text-sm text-slate-200 transition hover:border-slate-500"
      onClick={() => props.onChange(!props.checked)}
    >
      <span>{props.label}</span>
      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${props.checked ? 'bg-emerald-400 text-slate-950' : 'bg-slate-700 text-slate-200'}`}>
        {props.checked ? '开' : '关'}
      </span>
    </button>
  )
}
