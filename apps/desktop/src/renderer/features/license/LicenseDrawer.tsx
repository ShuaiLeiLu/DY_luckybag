import type { ReactNode } from 'react'
import type { LicenseSnapshot } from '@shared/models'
import { formatRelative } from '../../lib/runtime'
import type { LicenseBindSession } from './types'

export type LicenseDrawerProps = {
  open: boolean
  license: LicenseSnapshot
  accessModeText: string
  licenseKey: string
  licenseBusy: boolean
  bindBusy: boolean
  bindSession: LicenseBindSession | null
  miniAppCodeUrl: string
  onLicenseKeyChange: (value: string) => void
  onStartTrial: () => void
  onActivate: () => void
  onRefreshBindStatus: () => void
  onClose: () => void
}

/**
 * 独立授权抽屉：
 * - 让授权与设置中心解耦
 * - 聚合试用、激活、小程序绑定三类动作
 */
export function LicenseDrawer(props: LicenseDrawerProps) {
  const bindStatus = toBindStatusText(props.bindSession)
  const bindToken = String(props.bindSession?.bindToken || '').trim()
  const bindRemaining = getBindRemainingText(props.bindSession)
  const trialRemaining = props.license.accessMode === 'trial' ? formatRelative(props.license.trialRemainingSec) : '-'
  const showMiniAppCode = Boolean(props.miniAppCodeUrl)
  const miniAppPlaceholder = getMiniAppPlaceholder(props.bindSession, props.bindBusy)
  const refreshButtonText = bindToken ? '刷新绑定状态' : '暂无绑定会话'

  return (
    <div className={`pointer-events-none fixed inset-3 z-30 transition duration-300 md:inset-y-4 md:left-auto md:right-4 md:w-[380px] ${props.open ? 'translate-x-0 opacity-100' : 'translate-x-[110%] opacity-0'}`}>
      <div className="glass pointer-events-auto flex h-full flex-col rounded-[30px] p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">授权中心</h2>
            <p className="mt-1 text-sm text-slate-400">试用、授权码激活和小程序绑定。</p>
          </div>
          <button className="rounded-full border border-slate-700/80 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800/60" onClick={props.onClose}>
            关闭
          </button>
        </div>

        <div className="scrollbar-thin mt-5 flex-1 space-y-5 overflow-auto pr-1">
          <DrawerPanel title="授权状态">
            <DrawerDetailRow label="授权模式" value={props.accessModeText} />
            <DrawerDetailRow label="授权状态" value={props.license.authorized ? '已授权' : '未授权'} />
            <DrawerDetailRow label="试用剩余" value={trialRemaining} />
            <DrawerDetailRow label="服务提示" value={props.license.message || '-'} />
          </DrawerPanel>

          <DrawerPanel title="授权码">
            <DrawerInput label="授权码" value={props.licenseKey} onChange={props.onLicenseKeyChange} />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-100 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={props.licenseBusy}
                onClick={props.onStartTrial}
              >
                {props.licenseBusy ? '处理中...' : '开始试用'}
              </button>
              <button
                className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-3 text-sm text-cyan-100 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={props.licenseBusy}
                onClick={props.onActivate}
              >
                {props.licenseBusy ? '处理中...' : '激活授权'}
              </button>
            </div>
          </DrawerPanel>

          <DrawerPanel title="绑定小程序">
            <div className="rounded-2xl border border-cyan-400/20 bg-gradient-to-b from-slate-900/60 to-slate-950/70 p-3">
              {showMiniAppCode ? (
                <div className="mx-auto flex h-48 w-48 items-center justify-center rounded-2xl border border-slate-700/70 bg-white p-2 shadow-[0_10px_28px_rgba(15,23,42,0.35)]">
                  <img
                    src={props.miniAppCodeUrl}
                    alt="mini-app-code"
                    className="h-full w-full rounded-xl object-contain [image-rendering:pixelated] [filter:contrast(1.28)_saturate(0.25)]"
                  />
                </div>
              ) : (
                <div className="flex h-44 items-center justify-center rounded-xl border border-dashed border-slate-700 px-4 text-center text-sm text-slate-400">
                  {miniAppPlaceholder}
                </div>
              )}
            </div>
            <DrawerDetailRow label="绑定状态" value={bindStatus} />
            <DrawerDetailRow label="剩余时长" value={bindRemaining} />
            <button
              className="w-full rounded-2xl border border-slate-600/80 bg-slate-900/80 px-3 py-3 text-sm text-slate-100 transition hover:bg-slate-800/60 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={props.bindBusy || !bindToken}
              onClick={props.onRefreshBindStatus}
            >
              {refreshButtonText}
            </button>
          </DrawerPanel>
        </div>
      </div>
    </div>
  )
}

function DrawerPanel(props: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[24px] border border-slate-700/70 bg-slate-950/55 p-4">
      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">{props.title}</h3>
      <div className="mt-4 space-y-3">{props.children}</div>
    </section>
  )
}

function DrawerDetailRow(props: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-2xl border border-slate-700/70 bg-slate-950/45 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <span className="text-slate-400">{props.label}</span>
      <span className="max-w-full break-all text-left text-slate-100 sm:max-w-[58%] sm:text-right">{props.value}</span>
    </div>
  )
}

function DrawerInput(props: { label: string; value: string; onChange: (value: string) => void }) {
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

function hasBindReference(session: LicenseBindSession | null): boolean {
  const bindToken = String(session?.bindToken || '').trim()
  const sceneCode = String(session?.sceneCode || '').trim()
  return Boolean(bindToken || sceneCode)
}

function getBindStatusKey(session: LicenseBindSession | null): string {
  if (!session) return 'idle'
  const status = String(session.status || '').trim().toLowerCase()
  if (status) return status
  return hasBindReference(session) ? 'pending' : 'idle'
}

function getMiniAppPlaceholder(session: LicenseBindSession | null, busy: boolean): string {
  const status = getBindStatusKey(session)
  if (status === 'granted') return '今日签到已完成。'
  if (status === 'scanned') return '已扫码绑定，请在小程序端完成签到。'
  if (status === 'authorized' && !hasBindReference(session)) return '当前仅授权生效，尚未生成绑定会话。'
  return busy ? '正在生成小程序码...' : '正在自动生成小程序码...'
}

function getBindRemainingText(session: LicenseBindSession | null): string {
  if (!session) return '-'
  const status = getBindStatusKey(session)
  if (status === 'granted') return '已完成'
  if (status === 'authorized' && !hasBindReference(session)) return '-'
  return formatRelative(Number(session.remainingSec || 0))
}

function toBindStatusText(session: LicenseBindSession | null): string {
  const status = getBindStatusKey(session)
  if (status === 'idle') return '待生成'
  if (status === 'pending' || status === 'created' || status === 'new' || status === 'waiting') return '待扫码'
  if (status === 'scanned') return '已扫码'
  if (status === 'granted') return '已签到'
  if (status === 'authorized') return '已授权（未绑定）'
  if (status === 'binding' || status === 'processing') return '处理中'
  if (status === 'expired' || status === 'timeout') return '已过期'
  if (status === 'failed' || status === 'error') return '失败'
  return '处理中'
}