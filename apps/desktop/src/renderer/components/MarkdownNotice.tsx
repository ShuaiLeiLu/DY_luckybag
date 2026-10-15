import type { ReactNode } from 'react'

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
