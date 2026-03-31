import type { LicenseSnapshot } from '@shared/models'

export type LicenseGateProps = {
  license: LicenseSnapshot
  licenseKey: string
  accessModeText: string
  serverUrl: string
  onLicenseKeyChange: (value: string) => void
  onStartTrial: () => void
  onActivate: () => void
  busy: boolean
  clientId: string
  fingerprint: string
}

/**
 * 授权门禁页仅负责渲染门禁 UI。
 * 具体授权动作与状态变更均由上层注入，避免组件内耦合业务逻辑。
 */
export function LicenseGate(props: LicenseGateProps) {
  return (
    <div className="grid gap-4 lg:h-full lg:grid-cols-[minmax(0,1.05fr)_minmax(280px,420px)]">
      <section className="glass flex min-h-[320px] flex-col justify-between rounded-[32px] p-5 sm:p-6 xl:p-8">
        <div>
          <div className="inline-flex items-center gap-3 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100">
            SERVICE DISPATCH EDITION
          </div>
          <h1 className="mt-6 max-w-xl text-3xl font-semibold leading-tight text-white sm:text-4xl">
            3 天设备试用 + 正式授权
            <br />
            进入新的桌面调度台
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
            当前版本采用服务端统一派单、客户端隐藏执行池与高密度账号调度。试用期内完整开放，便于快速验证执行链路和调度效果。
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <FeaturePanel title="服务端派单" description="候选池统一筛选，客户端只负责执行与回传。" />
          <FeaturePanel title="隐藏执行池" description="多账号默认隐藏运行，人工检查时再拉起窗口。" />
          <FeaturePanel title="授权状态机" description="试用、激活、过期、锁定都由服务端状态驱动。" />
        </div>
      </section>

      <section className="glass flex flex-col rounded-[32px] p-5 sm:p-6">
        <div>
          <h2 className="text-2xl font-semibold text-white">设备接入</h2>
          <p className="mt-2 text-sm text-slate-400">{props.license.message || '请先开始试用或输入授权码。'}</p>
        </div>

        <div className="mt-4 grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
          <DeviceField label="POOL SERVER" value={props.serverUrl} />
          <DeviceField label="CLIENT ID" value={props.clientId} />
          <DeviceField label="FINGERPRINT" value={props.fingerprint} />
          <DeviceField label="ACCESS MODE" value={props.accessModeText} />
        </div>

        <div className="mt-4 rounded-[24px] border border-cyan-400/20 bg-cyan-500/10 p-4 text-sm text-cyan-100">
          服务端地址由内置策略控制，当前版本不再支持在门禁页直接修改。
        </div>

        <div className="mt-6 rounded-[24px] border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          <div className="font-semibold">试用说明</div>
          <div className="mt-1 text-amber-100/80">每台设备首次安装可获得 3 天完整试用。试用结束后需要正式授权才可进入主调度台。</div>
        </div>

        <button
          className="mt-5 rounded-2xl bg-emerald-400 px-4 py-3 font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={props.busy}
          onClick={props.onStartTrial}
        >
          {props.busy ? '处理中...' : '开始 3 天试用'}
        </button>

        <label className="mt-6 text-xs uppercase tracking-[0.2em] text-slate-500">授权码</label>
        <input
          value={props.licenseKey}
          onChange={(event) => props.onLicenseKeyChange(event.target.value)}
          className="mt-2 rounded-2xl border border-slate-700/80 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-400/70"
          placeholder="输入正式授权码"
        />
        <button
          className="mt-4 rounded-2xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-3 font-semibold text-cyan-100 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={props.busy}
          onClick={props.onActivate}
        >
          {props.busy ? '处理中...' : '激活正式授权'}
        </button>
      </section>
    </div>
  )
}

function FeaturePanel(props: { title: string; description: string }) {
  return (
    <div className="rounded-[24px] border border-slate-700/70 bg-slate-950/55 p-4">
      <div className="text-sm font-semibold text-white">{props.title}</div>
      <div className="mt-2 text-sm leading-6 text-slate-400">{props.description}</div>
    </div>
  )
}

function DeviceField(props: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/55 px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{props.label}</div>
      <div className="mt-2 break-all text-sm text-slate-100">{props.value || '-'}</div>
    </div>
  )
}
