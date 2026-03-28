import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function isNumericCell(text) {
  const trimmed = String(text ?? '').trim()
  return /^[-+¥$]?[\d,]+\.?\d*[%％回件円]?$/.test(trimmed) || /^[-▲△]?\d/.test(trimmed)
}

function isPlainHttpUrl(text) {
  return /^https?:\/\/\S+$/i.test(String(text ?? '').trim())
}

function shortenUrlForDisplay(url) {
  return String(url).trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\?.*$/, '')
}

function getColumnClass(header, cellIndex) {
  const normalized = String(header ?? '').trim().toLowerCase()

  if (cellIndex === 0 || /(title|page|landing|location|url|path|keyword|query|campaign|content|source)/i.test(normalized)) {
    return 'min-w-[14rem] max-w-[28rem]'
  }

  if (/(date|period|day|week|month|event_date)/i.test(normalized)) {
    return 'min-w-[6rem]'
  }

  if (/(users|sessions|page_views|pageviews|views|pv|count|rate|ratio|ctr|cpc|cpa|cv|avg|cost|revenue|value|time|duration|bounce|engagement|impressions|clicks)/i.test(normalized)) {
    return 'min-w-[4.5rem]'
  }

  return 'min-w-[5.5rem]'
}

function makeHeadingId(text) {
  const base = 'toc-' + String(text).replace(/[^\w\u3000-\u9fff]/g, '-').toLowerCase()
  return `${base}-${Math.random().toString(36).slice(2, 6)}`
}

const SIZE_PRESETS = {
  normal: {
    h1: 'text-2xl',
    h2: 'text-xl',
    h3: 'text-lg',
    paragraph: 'text-sm leading-7',
    list: 'text-sm',
    quote: 'text-sm',
    table: 'text-[13px]',
    code: 'text-xs',
    pre: 'text-xs',
  },
  large: {
    h1: 'text-[2rem]',
    h2: 'text-[1.65rem]',
    h3: 'text-[1.35rem]',
    paragraph: 'text-base leading-8',
    list: 'text-base',
    quote: 'text-base',
    table: 'text-sm',
    code: 'text-sm',
    pre: 'text-sm',
  },
  xlarge: {
    h1: 'text-[2.2rem]',
    h2: 'text-[1.8rem]',
    h3: 'text-[1.5rem]',
    paragraph: 'text-lg leading-9',
    list: 'text-lg',
    quote: 'text-lg',
    table: 'text-base',
    code: 'text-sm',
    pre: 'text-sm',
  },
}

function getComponents(size = 'normal') {
  const preset = SIZE_PRESETS[size] ?? SIZE_PRESETS.normal

  return {
    h1: ({ children }) => {
      const id = makeHeadingId(String(children))
      return <h2 id={id} className={`${preset.h1} font-bold japanese-text text-on-surface scroll-mt-20`}>{children}</h2>
    },
    h2: ({ children }) => {
      const id = makeHeadingId(String(children))
      return <h3 id={id} className={`${preset.h2} font-bold japanese-text text-on-surface scroll-mt-20`}>{children}</h3>
    },
    h3: ({ children }) => {
      const id = makeHeadingId(String(children))
      return <h4 id={id} className={`${preset.h3} font-bold japanese-text text-on-surface scroll-mt-20`}>{children}</h4>
    },
    p: ({ children }) => (
      <p className={`${preset.paragraph} whitespace-pre-wrap text-on-surface-variant japanese-text`}>{children}</p>
    ),
    strong: ({ children }) => <strong>{children}</strong>,
    code: ({ children, className }) => {
      const isBlock = className?.includes('language-')
      if (isBlock) {
        return <code>{children}</code>
      }
      return (
        <code className={`px-1.5 py-0.5 rounded bg-surface-container ${preset.code}`}>{children}</code>
      )
    },
    pre: ({ children }) => (
      <pre className={`overflow-x-auto rounded-[0.75rem] bg-surface-container p-4 ${preset.pre} text-on-surface-variant`}>
        {children}
      </pre>
    ),
    blockquote: ({ children }) => (
      <blockquote className={`border-l-3 border-secondary/50 bg-surface-container-low/50 pl-4 pr-3 py-3 rounded-r-[0.5rem] ${preset.quote} text-on-surface-variant italic`}>
        {children}
      </blockquote>
    ),
    ul: ({ children, depth }) => {
      const indent = depth > 0 ? 'pl-5' : 'pl-6'
      return (
        <ul className={`space-y-1.5 ${indent} list-disc ${preset.list} text-on-surface-variant`}>
          {children}
        </ul>
      )
    },
    ol: ({ children, depth }) => {
      const indent = depth > 0 ? 'pl-5' : 'pl-6'
      return (
        <ol className={`space-y-1.5 ${indent} list-decimal ${preset.list} text-on-surface-variant`}>
          {children}
        </ol>
      )
    },
    li: ({ children }) => <li>{children}</li>,
    table: ({ children }) => (
      <div className="my-4 max-w-full overflow-x-auto rounded-[0.75rem]">
        <table className={`min-w-full table-auto border-collapse ${preset.table}`}>
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-surface-container-low">{children}</thead>,
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children, isHeader }) => {
      if (isHeader) return <tr>{children}</tr>
      return <tr className="hover:bg-surface-container/40 transition-colors">{children}</tr>
    },
    th: ({ children, style }) => {
      const text = String(children ?? '')
      const cellIndex = 0
      const columnClass = getColumnClass(text, cellIndex)
      const align = style?.textAlign === 'right' ? 'text-right' : style?.textAlign === 'center' ? 'text-center' : 'text-left'
      return (
        <th className={`px-3.5 py-3 font-bold whitespace-nowrap border-b border-outline-variant/10 ${align} ${columnClass}`}>
          {children}
        </th>
      )
    },
    td: ({ children, style }) => {
      const text = String(children ?? '')
      const numeric = isNumericCell(text)
      const url = isPlainHttpUrl(text)
      const align = style?.textAlign === 'right' ? 'text-right' : style?.textAlign === 'center' ? 'text-center' : ''

      const content = url ? (
        <a
          href={text.trim()}
          target="_blank"
          rel="noopener noreferrer"
          className="text-secondary underline-offset-2 hover:underline break-all"
        >
          {shortenUrlForDisplay(text)}
        </a>
      ) : children

      return (
        <td
          title={text}
          className={`px-3.5 py-2.5 align-top ${align} ${
            numeric ? 'text-right font-mono tabular-nums whitespace-nowrap' : ''
          } ${!numeric ? 'whitespace-normal break-words [overflow-wrap:anywhere]' : ''}`}
        >
          {content}
        </td>
      )
    },
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-secondary underline-offset-2 hover:underline"
      >
        {children}
      </a>
    ),
  }
}

export default function MarkdownRenderer({ content, className = '', size = 'normal' }) {
  const markdown = typeof content === 'string' ? content.trim() : ''
  const components = getComponents(size)

  if (!markdown) return null

  return (
    <div className={`space-y-5 ${className}`}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </Markdown>
    </div>
  )
}
