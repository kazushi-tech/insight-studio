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
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

export default function MarkdownRenderer({ content, className = '' }) {
  const markdown = typeof content === 'string' ? content.trim() : ''

  if (!markdown) return null

  const lines = markdown.split(/\r?\n/)
  const blocks = []
  let index = 0

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
      blocks.push(
        <Tag key={`heading-${blocks.length}`} className={`${sizeClass} font-bold japanese-text text-on-surface`}>
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
        rows.push(parseTableRow(lines[index]))
        index += 1
      }

      blocks.push(
        <div key={`table-${blocks.length}`} className="overflow-x-auto rounded-2xl border border-outline-variant/20">
          <table className="w-full text-sm">
            <thead className="bg-surface-container-low">
              <tr>
                {headers.map((header, cellIndex) => (
                  <th key={`th-${cellIndex}`} className="px-4 py-3 text-left font-bold">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`tr-${rowIndex}`} className="border-t border-outline-variant/10">
                  {row.map((cell, cellIndex) => (
                    <td key={`td-${rowIndex}-${cellIndex}`} className="px-4 py-3 align-top whitespace-pre-wrap">
                      {renderInline(cell, `table-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
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
