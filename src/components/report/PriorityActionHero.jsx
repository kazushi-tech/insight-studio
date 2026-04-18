import { useMemo } from 'react'

/**
 * Hero strip that surfaces the top-3 priority actions.
 *
 * Parses markdown body to find an action-oriented section heading and extracts
 * the first 3 items (bullets or numbered). Renders as 3 gold-accent KPI cards —
 * 16px radius per Botanical design spec. Heading keywords mirror the backend
 * quality gate (`report_generator.py::_quality_gate_check`) so that "quality
 * OK but hero missing" divergences cannot occur.
 *
 * Renders null when nothing extractable is found so the page layout is unchanged.
 */

function findPrioritySection(reportMd) {
  if (typeof reportMd !== 'string') return ''
  // Headings likely to contain priority actions, in priority order.
  // Kept in sync with backend action-plan detection keywords.
  const headings = [
    /##\s*(?:\d+[.．]?\s*)?最優先施策[^\n]*/,
    /##\s*(?:\d+[.．]?\s*)?優先施策[^\n]*/,
    /##\s*(?:\d+[.．]?\s*)?実行プラン[^\n]*/,
    /##\s*(?:\d+[.．]?\s*)?推奨(?:事項|施策)[^\n]*/,
    /##\s*(?:\d+[.．]?\s*)?(?:広告運用)?アクションプラン[^\n]*/,
    /##\s*(?:\d+[.．]?\s*)?改善提案[^\n]*/,
  ]
  for (const hp of headings) {
    const match = reportMd.match(hp)
    if (!match) continue
    const start = match.index + match[0].length
    const rest = reportMd.slice(start)
    const endMatch = rest.match(/\n##\s/)
    const end = endMatch ? endMatch.index : rest.length
    return rest.slice(0, end)
  }
  return ''
}

function extractActions(sectionMd) {
  if (!sectionMd) return []
  const lines = sectionMd.split(/\r?\n/)
  const actions = []
  let current = null

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.．)])\s+(.+)$/)
    if (bullet) {
      if (current) actions.push(current)
      const text = bullet[1].replace(/\*\*/g, '').trim()
      current = { title: text, detail: '' }
    } else if (current && line.trim() && !/^\s*[#|]/.test(line)) {
      current.detail = (current.detail ? current.detail + ' ' : '') + line.trim().replace(/\*\*/g, '')
    }
    if (actions.length >= 3 && current === null) break
  }
  if (current) actions.push(current)

  return actions.slice(0, 3).map((a) => {
    const splitMatch = a.title.match(/^(.+?)[:：](.+)$/)
    if (splitMatch) {
      return {
        title: splitMatch[1].trim(),
        detail: splitMatch[2].trim() || a.detail,
      }
    }
    return a
  })
}

export default function PriorityActionHero({ reportMd }) {
  const actions = useMemo(() => {
    const section = findPrioritySection(reportMd)
    return extractActions(section)
  }, [reportMd])

  if (!actions.length) return null

  return (
    <section
      className="bg-gradient-to-br from-[color:var(--color-accent-gold-container)] to-[color:var(--color-surface-container-lowest)] rounded-2xl p-6 border border-[color:var(--color-accent-gold)]/30 print:break-inside-avoid"
      aria-label="最優先施策"
    >
      <div className="flex items-center gap-2 mb-4">
        <span
          className="material-symbols-outlined"
          style={{ color: 'var(--color-accent-gold)', fontSize: '20px' }}
          aria-hidden="true"
        >
          rocket_launch
        </span>
        <span className="text-xs font-bold uppercase tracking-[0.15em] text-on-surface-variant">最優先施策</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {actions.map((action, idx) => (
          <div
            key={idx}
            className="bg-surface-container-lowest rounded-2xl p-5 border-l-[3px] flex flex-col gap-2"
            style={{ borderLeftColor: 'var(--color-accent-gold)' }}
          >
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center justify-center w-7 h-7 rounded-full font-black text-xs"
                style={{
                  backgroundColor: 'var(--color-accent-gold)',
                  color: 'var(--color-on-primary)',
                }}
                aria-hidden="true"
              >
                {idx + 1}
              </span>
              <h4 className="text-sm font-bold text-on-surface leading-snug japanese-text flex-1">
                {action.title}
              </h4>
            </div>
            {action.detail && (
              <p className="text-xs text-on-surface-variant leading-relaxed japanese-text">
                {action.detail.length > 140 ? action.detail.slice(0, 137) + '…' : action.detail}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
