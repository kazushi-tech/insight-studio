function renderInline(text, keyPrefix) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean)

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${keyPrefix}-bold-${index}`}>{part.slice(2, -2)}</strong>
    }

    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={`${keyPrefix}-code-${index}`} className="px-1.5 py-0.5 rounded bg-surface-container text-xs">
          {part.slice(1, -1)}
        </code>
      )
    }

    return <span key={`${keyPrefix}-text-${index}`}>{part}</span>
  })
}

function isTableSeparator(line) {
  return /^\|?[\s:-]+(\|[\s:-]+)+\|?$/.test(line.trim())
}

function parseTableRow(line) {
  const text = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells = []
  let current = ''

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (char === '\\' && text[index + 1] === '|') {
      current += '|'
      index += 1
      continue
    }

    if (char === '|') {
      cells.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  cells.push(current.trim())
  return cells
}

function normalizeTableRow(row, expectedLength) {
  if (row.length === expectedLength) return row
  if (row.length < expectedLength) {
    return [...row, ...Array.from({ length: expectedLength - row.length }, () => '')]
  }

  const overflowCount = row.length - expectedLength
  return [row.slice(0, overflowCount + 1).join(' | '), ...row.slice(overflowCount + 1)]
}

function isNumericCell(text) {
  const trimmed = text.trim()
  return /^[-+¥$]?[\d,]+\.?\d*[%％回件円]?$/.test(trimmed) || /^[-▲△]?\d/.test(trimmed)
}

function isPlainHttpUrl(text) {
  return /^https?:\/\/\S+$/i.test(text.trim())
}

function shortenUrlForDisplay(url) {
  return url.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\?.*$/, '')
}

function getColumnClass(header, cellIndex) {
  const normalized = String(header ?? '').trim().toLowerCase()

  if (cellIndex === 0 || /(title|page|landing|location|url|path|keyword|query|campaign|content|source)/i.test(normalized)) {
    return 'min-w-[18rem] max-w-[32rem]'
  }

  if (/(date|period|day|week|month|event_date)/i.test(normalized)) {
    return 'min-w-[7rem]'
  }

  if (/(users|sessions|page_views|pageviews|views|pv|count|rate|ratio|ctr|cpc|cpa|cv|avg|cost|revenue|value|time|duration|bounce|engagement|impressions|clicks)/i.test(normalized)) {
    return 'min-w-[6.5rem]'
  }

  return 'min-w-[8rem]'
}

function renderTableCellContent(cell, keyPrefix) {
  const trimmed = cell.trim()

  if (isPlainHttpUrl(trimmed)) {
    return (
      <a
        href={trimmed}
        target="_blank"
        rel="noopener noreferrer"
        className="text-secondary underline-offset-2 hover:underline break-all"
      >
        {shortenUrlForDisplay(trimmed)}
      </a>
    )
  }

  return renderInline(cell, keyPrefix)
}

function makeHeadingId(title, index) {
  const base = 'toc-' + title.replace(/[^\w\u3000-\u9fff]/g, '-').toLowerCase()
  return `${base}-${index}`
}

export default function MarkdownRenderer({ content, className = '' }) {
  const markdown = typeof content === 'string' ? content.trim() : ''

  if (!markdown) return null

  const lines = markdown.split(/\r?\n/)
  const blocks = []
  let index = 0
  let headingCounter = 0

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    if (trimmed.startsWith('```')) {
      const buffer = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        buffer.push(lines[index])
        index += 1
      }
      index += 1
      blocks.push(
        <pre key={`code-${blocks.length}`} className="overflow-x-auto rounded-2xl bg-surface-container p-4 text-xs text-on-surface-variant">
          <code>{buffer.join('\n')}</code>
        </pre>,
      )
      continue
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const title = headingMatch[2]
      const Tag = level === 1 ? 'h2' : level === 2 ? 'h3' : 'h4'
      const sizeClass = level === 1 ? 'text-2xl' : level === 2 ? 'text-xl' : 'text-lg'
      const hId = makeHeadingId(title, headingCounter++)
      blocks.push(
        <Tag key={`heading-${blocks.length}`} id={hId} className={`${sizeClass} font-bold japanese-text text-on-surface scroll-mt-20`}>
          {title}
        </Tag>,
      )
      index += 1
      continue
    }

    if (trimmed.startsWith('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const headers = parseTableRow(lines[index])
      const rows = []
      index += 2
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        rows.push(normalizeTableRow(parseTableRow(lines[index]), headers.length))
        index += 1
      }

      blocks.push(
        <div key={`table-${blocks.length}`} className="my-4 max-w-full overflow-x-auto rounded-lg border border-outline-variant/20">
          <table className="min-w-full table-auto text-[13px] border-collapse">
            <thead className="bg-surface-container-low">
              <tr>
                {headers.map((header, cellIndex) => (
                  <th
                    key={`th-${cellIndex}`}
                    className={`px-3.5 py-3 text-left font-bold whitespace-nowrap border border-outline-variant/20 ${getColumnClass(header, cellIndex)}`}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr
                  key={`tr-${rowIndex}`}
                  className={`hover:bg-surface-container/40 transition-colors ${
                    rowIndex % 2 === 0 ? '' : 'bg-surface-container-low/30'
                  }`}
                >
                  {row.map((cell, cellIndex) => {
                    const numeric = isNumericCell(cell)
                    const header = headers[cellIndex] ?? ''
                    const columnClass = getColumnClass(header, cellIndex)
                    return (
                      <td
                        key={`td-${rowIndex}-${cellIndex}`}
                        title={cell}
                        className={`px-3.5 py-2.5 border border-outline-variant/10 align-top ${columnClass} ${
                          numeric ? 'text-right font-mono tabular-nums whitespace-nowrap' : ''
                        } ${!numeric ? 'whitespace-normal break-words [overflow-wrap:anywhere]' : ''}`}
                      >
                        {renderTableCellContent(cell, `table-${rowIndex}-${cellIndex}`)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items = []
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ''))
        index += 1
      }
      blocks.push(
        <ul key={`list-${blocks.length}`} className="space-y-2 pl-6 list-disc text-sm text-on-surface-variant">
          {items.map((item, itemIndex) => (
            <li key={`li-${itemIndex}`}>{renderInline(item, `list-${itemIndex}`)}</li>
          ))}
        </ul>,
      )
      continue
    }

    const paragraph = []
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].trim().startsWith('```') &&
      !lines[index].trim().startsWith('|') &&
      !/^(#{1,3})\s+/.test(lines[index].trim()) &&
      !/^[-*]\s+/.test(lines[index].trim())
    ) {
      paragraph.push(lines[index].trim())
      index += 1
    }

    blocks.push(
      <p key={`p-${blocks.length}`} className="text-sm leading-7 whitespace-pre-wrap text-on-surface-variant japanese-text">
        {renderInline(paragraph.join(' '), `p-${blocks.length}`)}
      </p>,
    )
  }

  return <div className={`space-y-5 ${className}`}>{blocks}</div>
}
