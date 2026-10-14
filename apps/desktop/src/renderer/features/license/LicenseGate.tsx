import type { ReactNode } from 'react'
import { Alert, Button, Card, Divider, Input, Space, Spin, Tag, Typography } from 'antd'
import {
  SafetyCertificateOutlined,
  QrcodeOutlined,
  KeyOutlined,
  ArrowLeftOutlined,
  ReloadOutlined,
  SoundOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined
} from '@ant-design/icons'
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

export function LicenseGate({
  license,
  licenseKey,
  announcementMarkdown,
  bindBusy,
  bindSession,
  miniAppCodeUrl,
  miniAppScanCodeUrl,
  onLicenseKeyChange,
  onStartTrial,
  onActivate,
  onCreateBindSession,
  onRefreshBindStatus,
  onBackToMain,
  busy
}: LicenseGateProps) {
  const bindToken = String(bindSession?.bindToken || '').trim()
  const bindStatus = toBindStatusText(bindSession)
  const bindRemaining = getBindRemainingText(bindSession)
  const showMiniAppCode = Boolean(miniAppCodeUrl)
  const showMiniAppScanCode = Boolean(miniAppScanCodeUrl)
  const miniAppPlaceholder = getMiniAppPlaceholder(bindSession, bindBusy)

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card
        className="w-full max-w-2xl border-slate-800 bg-slate-900/90 shadow-2xl backdrop-blur-xl"
        styles={{
          body: { padding: '32px' }
        }}
      >
        <div className="flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-400 border border-blue-500/20 text-2xl">
            <SafetyCertificateOutlined />
          </div>
          <Typography.Title level={3} className="!text-slate-100 !mb-1">
            设备授权与激活
          </Typography.Title>
          <Typography.Paragraph type="secondary" className="!mb-6 text-xs">
            {license.message || '请开始免费试用，或通过正式授权码/小程序扫码激活服务'}
          </Typography.Paragraph>
        </div>

        <div className="space-y-4">
          {/* 1. 试用通道 */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-xl border border-slate-800/90 bg-slate-950/60 p-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-200">新设备首次体验</span>
                <Tag color="cyan" bordered={false} className="text-[10px]">
                  3天免费
                </Tag>
              </div>
              <div className="mt-1 text-xs text-slate-400">
                每台设备可免费领取3天全功能体验，体验期满可扫码续签或输入激活码。
              </div>
            </div>
            <Button
              type="primary"
              loading={busy}
              onClick={onStartTrial}
              className="bg-emerald-600 hover:bg-emerald-500 font-medium shrink-0 h-9"
            >
              开始 3 天试用
            </Button>
          </div>

          {/* 2. 授权码激活通道 */}
          <div className="rounded-xl border border-slate-800/90 bg-slate-950/60 p-4">
            <div className="mb-2 text-xs font-semibold text-slate-300">正式授权码激活</div>
            <div className="flex gap-2">
              <Input
                placeholder="请输入 32 位正式设备授权码"
                prefix={<KeyOutlined className="text-slate-500" />}
                value={licenseKey}
                onChange={(e) => onLicenseKeyChange(e.target.value)}
                className="bg-slate-900 border-slate-700 text-slate-100"
              />
              <Button
                type="primary"
                loading={busy}
                onClick={onActivate}
                disabled={!licenseKey.trim()}
                className="bg-blue-600 hover:bg-blue-500 shrink-0 font-medium"
              >
                直接激活
              </Button>
            </div>
          </div>

          {/* 3. 小程序扫码签到/续期 */}
          <div className="rounded-xl border border-slate-800/90 bg-slate-950/60 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <QrcodeOutlined className="text-cyan-400" />
                <span className="text-xs font-semibold text-slate-200">微信小程序快捷绑定 / 签到</span>
              </div>
              <Button
                type="link"
                size="small"
                loading={bindBusy}
                icon={<ReloadOutlined />}
                onClick={onCreateBindSession}
                className="text-xs text-cyan-400 hover:text-cyan-300 p-0"
              >
                刷新签到码
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* 小程序码 */}
              <div className="flex flex-col items-center justify-center rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <span className="mb-2 text-[11px] font-medium text-slate-400">微信扫一扫直达</span>
                {showMiniAppCode ? (
                  <div className="rounded-lg bg-white p-2">
                    <img
                      src={miniAppCodeUrl}
                      alt="小程序码"
                      className="h-28 w-28 object-contain"
                    />
                  </div>
                ) : (
                  <div className="flex h-28 w-28 items-center justify-center rounded-lg border border-dashed border-slate-700 text-center text-[11px] text-slate-500 p-2">
                    {miniAppPlaceholder}
                  </div>
                )}
              </div>

              {/* 小程序内扫一扫 */}
              <div className="flex flex-col items-center justify-center rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <span className="mb-2 text-[11px] font-medium text-slate-400">小程序内扫一扫</span>
                {showMiniAppScanCode ? (
                  <div className="rounded-lg bg-white p-2">
                    <img
                      src={miniAppScanCodeUrl}
                      alt="小程序扫码码"
                      className="h-28 w-28 object-contain"
                    />
                  </div>
                ) : (
                  <div className="flex h-28 w-28 items-center justify-center rounded-lg border border-dashed border-slate-700 text-center text-[11px] text-slate-500 p-2">
                    {miniAppPlaceholder}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between text-xs text-slate-400 px-1">
              <div className="flex items-center gap-3">
                <span>
                  绑定状态: <strong className="text-slate-200">{bindStatus}</strong>
                </span>
                <span>
                  剩余时长: <strong className="text-slate-200">{bindRemaining}</strong>
                </span>
              </div>
              <Button
                size="small"
                type="text"
                disabled={bindBusy || !bindToken}
                onClick={onRefreshBindStatus}
                className="text-xs text-slate-300 hover:text-white"
              >
                刷新状态
              </Button>
            </div>
          </div>

          {/* 公告信息 */}
          {announcementMarkdown ? (
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/20 p-4">
              <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-cyan-300">
                <SoundOutlined />
                <span>系统公告</span>
              </div>
              <div className="max-h-28 overflow-auto scrollbar-thin text-xs text-slate-300">
                <MarkdownNotice markdown={announcementMarkdown} />
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-6 flex justify-center">
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={onBackToMain}
            className="text-xs text-slate-300 border-slate-700 bg-slate-800/60 hover:bg-slate-700"
          >
            返回主工作台
          </Button>
        </div>
      </Card>
    </div>
  )
}

export function MarkdownNotice(props: { markdown: string }) {
  const blocks = parseMarkdownBlocks(props.markdown)
  return (
    <div className="space-y-2 text-xs leading-5 text-slate-300">
      {blocks.map((block, index) => {
        if (block.type === 'h1') return <h1 key={index} className="text-base font-semibold text-white">{renderInline(block.text)}</h1>
        if (block.type === 'h2') return <h2 key={index} className="text-sm font-semibold text-white">{renderInline(block.text)}</h2>
        if (block.type === 'h3') return <h3 key={index} className="text-xs font-semibold text-white">{renderInline(block.text)}</h3>
        if (block.type === 'ul') {
          return (
            <ul key={index} className="list-disc space-y-1 pl-4 text-slate-300">
              {block.items.map((item, itemIndex) => (
                <li key={`${index}_${itemIndex}`}>{renderInline(item)}</li>
              ))}
            </ul>
          )
        }
        return <p key={index} className="whitespace-pre-wrap text-slate-300">{renderInline(block.text)}</p>
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
          className="text-cyan-400 underline decoration-cyan-400/60 underline-offset-2 hover:text-cyan-300"
        >
          {match[2]}
        </a>
      )
    } else if (match[4]) {
      result.push(<strong key={`b_${key += 1}`} className="font-semibold text-white">{match[4]}</strong>)
    } else if (match[5]) {
      result.push(<code key={`c_${key += 1}`} className="rounded bg-slate-950 px-1.5 py-0.5 text-[11px] text-cyan-200">{match[5]}</code>)
    } else if (match[6]) {
      result.push(<em key={`i_${key += 1}`} className="italic text-slate-200">{match[6]}</em>)
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
  return busy ? '正在生成小程序码...' : '点击“刷新签到码”开始绑定。'
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
