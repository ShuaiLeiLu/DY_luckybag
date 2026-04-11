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
    <div className="flex min-h-full items-center justify-center p-4">
      <section className="glass flex w-full max-w-2xl flex-col items-center rounded-[32px] p-6 shadow-2xl sm:p-8">
        <div className="mb-6 inline-flex items-center gap-3 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.25em] text-cyan-200">
          授权验证
        </div>

        <h1 className="text-center text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          抖音福袋工作台
        </h1>
        <p className="mt-3 text-center text-sm leading-6 text-slate-300">
          {props.license.message || '请开始试用或使用正式授权码激活服务'}
        </p>

        <div className="mt-8 flex w-full flex-col gap-4">
          <div className="flex flex-col items-center justify-between gap-4 rounded-[24px] border border-slate-700/60 bg-slate-900/40 p-4 sm:flex-row">
            <div className="flex-1">
              <div className="text-sm font-semibold text-white">新设备首次登录</div>
              <div className="mt-1 text-xs text-slate-400">我们将为您提供3天完整试用授权，结束后需要正式授权。</div>
            </div>
            <button
              className="w-full shrink-0 rounded-2xl bg-emerald-500 px-6 py-3 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 sm:w-auto disabled:cursor-not-allowed disabled:opacity-60"
              disabled={props.busy}
              onClick={props.onStartTrial}
            >
              {props.busy ? '处理中...' : '开始 3 天试用'}
            </button>
          </div>

          <div className="flex flex-col gap-3 rounded-[24px] border border-slate-700/60 bg-slate-900/40 p-4 sm:flex-row sm:items-center">
            <input
              value={props.licenseKey}
              onChange={(event) => props.onLicenseKeyChange(event.target.value)}
              className="flex-1 rounded-2xl border border-slate-700/80 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-400/70"
              placeholder="输入正式授权码"
            />
            <button
              className="w-full shrink-0 rounded-2xl border border-cyan-400/30 bg-cyan-500/10 px-6 py-3 text-sm font-bold text-cyan-100 transition hover:bg-cyan-500/20 sm:w-auto disabled:cursor-not-allowed disabled:opacity-60"
              disabled={props.busy}
              onClick={props.onActivate}
            >
              {props.busy ? '处理中...' : '直接激活'}
            </button>
          </div>
        </div>

        <div className="mt-8 w-full">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-bold uppercase tracking-[0.16em] text-slate-300">移动端快捷签到</div>
            <button
              className="text-xs font-semibold text-cyan-300 underline underline-offset-2 hover:text-cyan-200 disabled:opacity-50"
              disabled={props.bindBusy}
              onClick={props.onCreateBindSession}
            >
              {props.bindBusy ? '生成中...' : '刷新签到码'}
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-700/60 bg-slate-900/30 p-4">
              <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100/90 hover:text-white">微信扫一扫直达</div>
              {showMiniAppCode ? (
                <div className="flex h-36 w-36 items-center justify-center rounded-2xl bg-white p-2">
                  <img
                    src={props.miniAppCodeUrl}
                    alt="mini-app-launch-code"
                    className="h-full w-full rounded-xl object-contain [image-rendering:pixelated]"
                  />
                </div>
              ) : (
                <div className="flex h-36 w-36 items-center justify-center rounded-xl border border-dashed border-slate-700 text-center text-xs text-slate-500 p-2">
                  {miniAppPlaceholder}
                </div>
              )}
            </div>
            <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-700/60 bg-slate-900/30 p-4">
              <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-100/90 hover:text-white">小程序内扫一扫</div>
              {showMiniAppScanCode ? (
                <div className="flex h-36 w-36 items-center justify-center rounded-2xl bg-white p-2">
                  <img
                    src={props.miniAppScanCodeUrl}
                    alt="mini-app-scan-code"
                    className="h-full w-full rounded-xl object-contain [image-rendering:pixelated]"
                  />
                </div>
              ) : (
                <div className="flex h-36 w-36 items-center justify-center rounded-xl border border-dashed border-slate-700 text-center text-xs text-slate-500 p-2">
                  {miniAppPlaceholder}
                </div>
              )}
            </div>
          </div>
          
          <div className="mt-4 flex items-center justify-between text-xs text-slate-400 px-2">
            <div className="flex items-center gap-2">
              <span>状态：<strong className="text-slate-200">{bindStatus}</strong></span>
              <span>/ 剩余时长：<strong className="text-slate-200">{bindRemaining}</strong></span>
            </div>
            <button
              className="font-medium hover:text-white disabled:opacity-50"
              disabled={props.bindBusy || !bindToken}
              onClick={props.onRefreshBindStatus}
            >
              刷新状态
            </button>
          </div>
        </div>

        {props.announcementMarkdown && (
          <div className="mt-8 w-full rounded-[24px] border border-cyan-500/10 bg-cyan-950/10 p-5 shadow-inner">
            <div className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-cyan-200/70">
              系统公告
            </div>
            <div className="max-h-[160px] overflow-auto scrollbar-thin">
              <MarkdownNotice markdown={props.announcementMarkdown} />
            </div>
          </div>
        )}

        <button
          className="mt-10 rounded-full border border-slate-700/60 px-6 py-2 text-sm font-medium text-slate-400 transition hover:bg-slate-800/60 hover:text-white"
          onClick={props.onBackToMain}
        >
          返回主工作台
        </button>
      </section>
    </div>
  )
}

export function MarkdownNotice(props: { markdown: string }) {
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
