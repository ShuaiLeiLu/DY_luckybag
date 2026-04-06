import type { ReactNode } from 'react'
import type { LicenseSnapshot } from '@shared/models'
import { formatRelative } from '../../lib/runtime'
import type { LicenseBindSession } from './types'

export type LicenseGateProps = {
  license: LicenseSnapshot
  licenseKey: string
  announcementMarkdown: string
  bindBusy: boolean
  bindSession: LicenseBindSession | null
  miniAppCodeUrl: string
  miniAppScanCodeUrl: string
  onLicenseKeyChange: (value: string) => void
  onStartTrial: () => void
  onActivate: () => void
  onCreateBindSession: () => void
  onRefreshBindStatus: () => void
  onBackToMain: () => void
  busy: boolean
}

/**
 * 授权门禁页仅负责渲染门禁 UI。
 * 具体授权动作与状态变更均由上层注入，避免组件内耦合业务逻辑。
 */
export function LicenseGate(props: LicenseGateProps) {
  const bindToken = String(props.bindSession?.bindToken || '').trim()
  const bindStatus = toBindStatusText(props.bindSession)
  const bindRemaining = getBindRemainingText(props.bindSession)
  const showMiniAppCode = Boolean(props.miniAppCodeUrl)
  const showMiniAppScanCode = Boolean(props.miniAppScanCodeUrl)
  const miniAppPlaceholder = getMiniAppPlaceholder(props.bindSession, props.bindBusy)

  return (
    <div className="grid gap-4 lg:h-full lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,460px)]">
      <section className="glass flex min-h-[320px] flex-col rounded-[32px] p-5 sm:p-6 xl:p-8">
        <div className="flex flex-1 flex-col">
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
          <div className="mt-6 flex min-h-[220px] flex-1 flex-col rounded-[24px] border border-cyan-400/25 bg-slate-950/40 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-100/90">公告</div>
            <div className="mt-3 flex-1 overflow-auto rounded-2xl border border-slate-700/70 bg-slate-950/55 p-4">
              <MarkdownNotice markdown={props.announcementMarkdown} />
            </div>
          </div>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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

        <div className="mt-6 rounded-[24px] border border-slate-700/70 bg-slate-950/55 p-4">
          <div className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-300">小程序绑定</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-cyan-400/20 bg-gradient-to-b from-slate-900/60 to-slate-950/70 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-100/90">微信扫一扫直达</div>
              {showMiniAppCode ? (
                <div className="mx-auto flex h-44 w-44 items-center justify-center rounded-2xl border border-slate-700/70 bg-white p-2 shadow-[0_10px_28px_rgba(15,23,42,0.35)]">
                  <img
                    src={props.miniAppCodeUrl}
                    alt="mini-app-launch-code"
                    className="h-full w-full rounded-xl object-contain [image-rendering:pixelated]"
                  />
                </div>
              ) : (
                <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-slate-700 px-4 text-center text-sm text-slate-400">
                  {miniAppPlaceholder}
                </div>
              )}
              <div className="mt-2 text-xs leading-5 text-slate-400">用于微信首页扫一扫，直接跳转到小程序并带入绑定参数。</div>
            </div>
            <div className="rounded-2xl border border-emerald-400/20 bg-gradient-to-b from-slate-900/60 to-slate-950/70 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-100/90">小程序内扫一扫</div>
              {showMiniAppScanCode ? (
                <div className="mx-auto flex h-44 w-44 items-center justify-center rounded-2xl border border-slate-700/70 bg-white p-2 shadow-[0_10px_28px_rgba(15,23,42,0.35)]">
                  <img
                    src={props.miniAppScanCodeUrl}
                    alt="mini-app-scan-code"
                    className="h-full w-full rounded-xl object-contain [image-rendering:pixelated]"
                  />
                </div>
              ) : (
                <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-slate-700 px-4 text-center text-sm text-slate-400">
                  {miniAppPlaceholder}
                </div>
              )}
              <div className="mt-2 text-xs leading-5 text-slate-400">已进入小程序时，点击小程序内扫一扫，扫描此码可直接绑定当前桌面端。</div>
            </div>
          </div>
          <div className="mt-3 grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
            <DeviceField label="绑定状态" value={bindStatus} />
            <DeviceField label="剩余时长" value={bindRemaining} />
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-2.5 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={props.bindBusy}
              onClick={props.onCreateBindSession}
            >
              {props.bindBusy ? '生成中...' : '刷新双码'}
            </button>
            <button
              className="rounded-2xl border border-slate-600/80 bg-slate-900/80 px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:bg-slate-800/60 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={props.bindBusy || !bindToken}
              onClick={props.onRefreshBindStatus}
            >
              刷新绑定状态
            </button>
          </div>
        </div>

        <button
          className="mt-4 rounded-2xl border border-slate-600/80 bg-slate-900/85 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:bg-slate-800/70"
          onClick={props.onBackToMain}
        >
          返回主页面
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
      <div className="mt-2 overflow-x-auto whitespace-nowrap text-sm font-mono text-slate-100">{props.value || '-'}</div>
    </div>
  )
}

function MarkdownNotice(props: { markdown: string }) {
  const blocks = parseMarkdownBlocks(props.markdown)
  return (
    <div className="space-y-3 text-sm leading-7 text-slate-200">
      {blocks.map((block, index) => {
        if (block.type === 'h1') return <h1 key={index} className="text-xl font-semibold text-white">{renderInline(block.text)}</h1>
        if (block.type === 'h2') return <h2 key={index} className="text-lg font-semibold text-white">{renderInline(block.text)}</h2>
        if (block.type === 'h3') return <h3 key={index} className="text-base font-semibold text-white">{renderInline(block.text)}</h3>
        if (block.type === 'ul') {
          return (
            <ul key={index} className="list-disc space-y-1 pl-5 text-slate-200">
              {block.items.map((item, itemIndex) => (
                <li key={`${index}_${itemIndex}`}>{renderInline(item)}</li>
              ))}
            </ul>
          )
        }
        return <p key={index} className="whitespace-pre-wrap text-slate-200">{renderInline(block.text)}</p>
      })}
    </div>
  )
}

type MarkdownBlock =
  | { type: 'h1' | 'h2' | 'h3' | 'p'; text: string }
  | { type: 'ul'; items: string[] }

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const source = String(markdown || '').replace(/\r/g, '')
  if (!source.trim()) {
    return [{ type: 'p', text: '暂无公告。' }]
  }

  const blocks: MarkdownBlock[] = []
  const lines = source.split('\n')
  let paragraph: string[] = []
  let listItems: string[] = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    blocks.push({ type: 'p', text: paragraph.join('\n') })
    paragraph = []
  }

  const flushList = () => {
    if (!listItems.length) return
    blocks.push({ type: 'ul', items: [...listItems] })
    listItems = []
  }

  for (const rawLine of lines) {
    const line = String(rawLine || '')
    const trimmed = line.trim()
    if (!trimmed) {
      flushParagraph()
      flushList()
      continue
    }
    const listMatch = trimmed.match(/^[-*]\s+(.+)$/)
    if (listMatch) {
      flushParagraph()
      listItems.push(listMatch[1])
      continue
    }
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      flushParagraph()
      flushList()
      const level = headingMatch[1].length
      const text = headingMatch[2]
      if (level === 1) blocks.push({ type: 'h1', text })
      else if (level === 2) blocks.push({ type: 'h2', text })
      else blocks.push({ type: 'h3', text })
      continue
    }
    flushList()
    paragraph.push(trimmed)
  }

  flushParagraph()
  flushList()
  return blocks
}

function renderInline(text: string): ReactNode[] {
  const source = String(text || '')
  const result: ReactNode[] = []
  const pattern = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*)/g
  let lastIndex = 0
  let key = 0

  for (;;) {
    const match = pattern.exec(source)
    if (!match) break
    const start = match.index
    if (start > lastIndex) {
      result.push(source.slice(lastIndex, start))
    }

    if (match[2] && match[3]) {
      result.push(
        <a
          key={`a_${key += 1}`}
          href={match[3]}
          target="_blank"
          rel="noreferrer"
          className="text-cyan-200 underline decoration-cyan-400/60 underline-offset-2 hover:text-cyan-100"
        >
          {match[2]}
        </a>
      )
    } else if (match[4]) {
      result.push(<strong key={`b_${key += 1}`} className="font-semibold text-white">{match[4]}</strong>)
    } else if (match[5]) {
      result.push(<code key={`c_${key += 1}`} className="rounded bg-slate-900 px-1.5 py-0.5 text-[12px] text-cyan-100">{match[5]}</code>)
    } else if (match[6]) {
      result.push(<em key={`i_${key += 1}`} className="italic text-slate-100">{match[6]}</em>)
    } else {
      result.push(match[0])
    }
    lastIndex = pattern.lastIndex
  }

  if (lastIndex < source.length) {
    result.push(source.slice(lastIndex))
  }
  return result
}

function getBindStatusKey(session: LicenseBindSession | null): string {
  if (!session) return 'idle'
  const status = String(session.status || '').trim().toLowerCase()
  if (status) return status
  const hasRef = Boolean(String(session.bindToken || '').trim() || String(session.sceneCode || '').trim())
  return hasRef ? 'pending' : 'idle'
}

function getMiniAppPlaceholder(session: LicenseBindSession | null, busy: boolean): string {
  const status = getBindStatusKey(session)
  if (status === 'granted') return '今日签到已完成。'
  if (status === 'scanned') return '已扫码绑定，请在小程序端完成签到。'
  if (status === 'authorized') return '当前仅授权生效，尚未生成绑定会话。'
  return busy ? '正在生成小程序码...' : '点击“生成小程序码”开始绑定。'
}

function getBindRemainingText(session: LicenseBindSession | null): string {
  if (!session) return '-'
  const status = getBindStatusKey(session)
  if (status === 'granted') return '已完成'
  if (status === 'authorized') return '-'
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
