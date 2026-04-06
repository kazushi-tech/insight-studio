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

  // 1. 狭い番号列（最優先 — cellIndex===0 より前にチェック）
  if (/^(#|番号|no\.?|順位|rank)$/i.test(normalized)) {
    return 'w-[3rem] min-w-[3rem] text-center'
  }

  // 2. 優先度列
  if (/^(優先度|priority|重要度)$/i.test(normalized)) {
    return 'min-w-[4.5rem] max-w-[5.5rem]'
  }

  // 3. メインコンテンツ列（提案・施策）
  if (/^(提案|改善|内容|施策|recommendation|suggestion|description)$/i.test(normalized)) {
    return 'min-w-[22rem] max-w-[40rem]'
  }

  // 4. 効果・インパクト列
  if (/^(期待効果|効果|impact|expected.?effect)$/i.test(normalized)) {
    return 'min-w-[10rem] max-w-[16rem]'
  }

  // 5. タイトル系 or 先頭列フォールバック
  if (cellIndex === 0 || /(title|page|landing|location|url|path|keyword|query|campaign|content|source)/i.test(normalized)) {
    return 'min-w-[14rem] max-w-[28rem]'
  }

  // 6. 日付
  if (/(date|period|day|week|month|event_date)/i.test(normalized)) {
    return 'min-w-[6rem]'
  }

  // 7. メトリクス
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

function splitMarkdownSections(markdown) {
  const lines = markdown.split('\n')
  const sections = []
  let currentHeading = null
  let currentBody = []
  let inCodeBlock = false

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock
    }

    if (!inCodeBlock && /^## /.test(line)) {
      if (currentHeading !== null || currentBody.length > 0) {
        sections.push({
          heading: currentHeading,
          body: currentBody.join('\n').trim(),
        })
      }
      currentHeading = line.replace(/^## /, '').trim()
      currentBody = []
    } else {
      currentBody.push(line)
    }
  }

  if (currentHeading !== null || currentBody.length > 0) {
    sections.push({
      heading: currentHeading,
      body: currentBody.join('\n').trim(),
    })
  }

  return sections
}

function isRecommendationSection(heading) {
  if (!heading) return false
  const text = heading.toLowerCase()
  return text.includes('推奨') || text.includes('改善') || text.includes('提案') || text.includes('recommend')
}

function getSectionIcon(headingText) {
  const text = headingText.toLowerCase()
  if (text.includes('市場') || text.includes('業界') || text.includes('概要')) return 'insights'
  if (text.includes('競合') || text.includes('動向')) return 'group'
  if (text.includes('cta') || text.includes('効果') || text.includes('分析')) return 'touch_app'
  if (text.includes('推奨') || text.includes('改善') || text.includes('推奨事項')) return 'recommend'
  return 'article'
}

function getComponents(size = 'normal', variant = null) {
  const preset = SIZE_PRESETS[size] ?? SIZE_PRESETS.normal
  const isEP = variant === 'essential-pack'
  const isDiscovery = variant === 'discovery'

  return {
    h1: ({ children }) => {
      const id = makeHeadingId(String(children))
      return <h2 id={id} className={`${preset.h1} font-bold japanese-text text-on-surface scroll-mt-20`}>{children}</h2>
    },
    h2: ({ children }) => {
      const id = makeHeadingId(String(children))
      const headingText = String(children)

      if (isDiscovery) {
        const icon = getSectionIcon(headingText)
        return (
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 rounded-xl bg-primary/5 flex items-center justify-center text-primary shrink-0">
              <span className="material-symbols-outlined text-2xl">{icon}</span>
            </div>
            <h3 id={id} className="text-2xl font-bold text-primary japanese-text">{children}</h3>
          </div>
        )
      }

      return <h3 id={id} className={`${preset.h2} font-bold japanese-text text-on-surface scroll-mt-20`}>{children}</h3>
    },
    h3: ({ children }) => {
      const id = makeHeadingId(String(children))
      return <h4 id={id} className={`${preset.h3} font-bold japanese-text text-on-surface scroll-mt-20`}>{children}</h4>
    },
    p: ({ children }) => (
      <p className={`${preset.paragraph} whitespace-pre-wrap text-on-surface-variant japanese-text`}>{children}</p>
    ),
    strong: ({ children }) => {
      if (isDiscovery) {
        return <strong className="text-on-surface font-bold">{children}</strong>
      }
      return <strong>{children}</strong>
    },
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

      if (isDiscovery) {
        return (
          <ul className={`space-y-4 pl-0 list-none ${preset.list} text-on-surface-variant`}>
            {children}
          </ul>
        )
      }

      return (
        <ul className={`space-y-1.5 ${indent} list-disc ${preset.list} text-on-surface-variant`}>
          {children}
        </ul>
      )
    },
    ol: ({ children, depth }) => {
      const indent = depth > 0 ? 'pl-5' : 'pl-6'

      if (isDiscovery) {
        return (
          <ol className={`space-y-6 pl-0 list-none counter-reset-[discovery-counter] ${preset.list} text-on-surface-variant`}>
            {children}
          </ol>
        )
      }

      return (
        <ol className={`space-y-1.5 ${indent} list-decimal ${preset.list} text-on-surface-variant`}>
          {children}
        </ol>
      )
    },
    li: ({ children, index }) => {
      if (isDiscovery) {
        // 番号付きリストかどうかを判定（ol内ならindexがnumber）
        if (typeof index === 'number') {
          return (
            <li className="relative pl-16 min-h-14 flex items-start leading-relaxed counter-increment-[discovery-counter]">
              <span className="absolute left-0 top-0 w-14 h-14 rounded-full border-2 border-primary/10 flex items-center justify-center text-primary text-xl font-extrabold">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="pt-3">{children}</span>
            </li>
          )
        }
        // 箇条書きリスト
        return (
          <li className="relative pl-7 leading-[1.8] mb-3">
            <span className="material-symbols-outlined absolute left-0 top-[0.1em] text-secondary text-base" style={{ fontVariationSettings: "'FILL' 1" }}>fiber_manual_record</span>
            {children}
          </li>
        )
      }
      return <li>{children}</li>
    },
    table: ({ children }) => {
      if (isDiscovery) {
        return (
          <div className="my-5 max-w-full overflow-x-auto rounded-[0.75rem] ghost-border-thin -mx-2">
            <table className={`min-w-full table-auto border-collapse ${preset.table}`}>
              {children}
            </table>
          </div>
        )
      }
      return (
        <div className={`my-5 max-w-full overflow-x-auto rounded-[0.75rem] ${isEP ? 'ghost-border' : ''}`}>
          <table className={`min-w-full table-auto border-collapse ${preset.table}`}>
            {children}
          </table>
        </div>
      )
    },
    thead: ({ children }) => {
      if (isDiscovery) return <thead className="bg-primary/5">{children}</thead>
      return <thead className="bg-surface-container-low">{children}</thead>
    },
    tbody: ({ children }) => {
      if (isDiscovery) return <tbody className="divide-y divide-outline-variant/5">{children}</tbody>
      if (isEP) return <tbody className="divide-y divide-outline-variant/10">{children}</tbody>
      return <tbody>{children}</tbody>
    },
    tr: ({ children, isHeader }) => {
      if (isHeader) return <tr>{children}</tr>
      if (isDiscovery) {
        return <tr className="hover:bg-primary/[0.02] transition-colors">{children}</tr>
      }
      if (isEP) {
        return <tr className="group hover:bg-surface-container-low/40 transition-colors">{children}</tr>
      }
      return <tr className="hover:bg-surface-container/40 transition-colors">{children}</tr>
    },
    th: ({ children, style, node }) => {
      const text = String(children ?? '')
      const cellIndex = node?.position?.start?.column ?? 1
      const isFirstCol = cellIndex <= 1
      const columnClass = getColumnClass(text, isFirstCol ? 0 : 1)
      const align = style?.textAlign === 'right' ? 'text-right' : style?.textAlign === 'center' ? 'text-center' : 'text-left'

      if (isDiscovery) {
        return (
          <th className={`px-5 py-3.5 text-[13px] font-bold text-primary whitespace-nowrap border-b-2 border-primary/15 ${align} ${columnClass}`}>
            {children}
          </th>
        )
      }

      if (isEP) {
        return (
          <th className={`px-8 py-4 text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant whitespace-nowrap ${align} ${columnClass} ${
            isFirstCol ? 'ep-sticky-col bg-surface-container-low' : ''
          }`}>
            {children}
          </th>
        )
      }

      return (
        <th className={`px-3.5 py-3 font-bold whitespace-nowrap border-b border-outline-variant/10 ${align} ${columnClass}`}>
          {children}
        </th>
      )
    },
    td: ({ children, style, node }) => {
      const text = String(children ?? '')
      const numeric = isNumericCell(text)
      const url = isPlainHttpUrl(text)
      const cellIndex = node?.position?.start?.column ?? 1
      const isFirstCol = cellIndex <= 1
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

      if (isDiscovery) {
        return (
          <td
            title={text}
            className={`px-5 py-4 align-top leading-relaxed ${align} ${
              numeric ? 'text-right font-mono tabular-nums whitespace-nowrap' : ''
            } ${!numeric ? 'whitespace-normal break-words [overflow-wrap:anywhere]' : ''} border-b border-outline-variant/8`}
          >
            {content}
          </td>
        )
      }

      if (isEP) {
        return (
          <td
            title={text}
            className={`px-8 py-3.5 align-top ${align} ${
              numeric ? 'text-right font-mono tabular-nums whitespace-nowrap font-medium text-on-surface' : ''
            } ${!numeric ? 'whitespace-normal break-words [overflow-wrap:anywhere]' : ''} ${
              isFirstCol ? 'ep-sticky-col font-semibold text-on-surface' : ''
            }`}
          >
            {content}
          </td>
        )
      }

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

export default function MarkdownRenderer({ content, className = '', size = 'normal', variant = null }) {
  const markdown = typeof content === 'string' ? content.trim() : ''
  const components = getComponents(size, variant)
  const isDiscovery = variant === 'discovery'

  if (!markdown) return null

  if (isDiscovery) {
    const sections = splitMarkdownSections(markdown)
    const sectionBodyComponents = { ...components }
    sectionBodyComponents.h2 = () => null

    return (
      <div className={`discovery-report space-y-8 ${className}`}>
        {sections.map((section, i) => {
          if (section.heading === null) {
            if (!section.body) return null
            return (
              <div key={`preamble-${i}`}>
                <Markdown remarkPlugins={[remarkGfm]} components={components}>
                  {section.body}
                </Markdown>
              </div>
            )
          }

          const icon = getSectionIcon(section.heading)
          const isRec = isRecommendationSection(section.heading)

          return (
            <section
              key={`section-${i}`}
              className="section-card bg-surface-container-lowest rounded-2xl p-8 border-l-[4px] border-primary"
            >
              <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 rounded-xl bg-primary/5 flex items-center justify-center text-primary shrink-0">
                  <span className="material-symbols-outlined text-3xl">{icon}</span>
                </div>
                <h3 className="text-2xl font-bold text-primary japanese-text">{section.heading}</h3>
              </div>

              {isRec ? (
                <div className="bg-primary/5 p-8 rounded-2xl">
                  <Markdown remarkPlugins={[remarkGfm]} components={sectionBodyComponents}>
                    {section.body}
                  </Markdown>
                </div>
              ) : (
                <div className="space-y-6">
                  <Markdown remarkPlugins={[remarkGfm]} components={sectionBodyComponents}>
                    {section.body}
                  </Markdown>
                </div>
              )}
            </section>
          )
        })}
      </div>
    )
  }

  return (
    <div className={`space-y-5 ${className}`}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </Markdown>
    </div>
  )
}
