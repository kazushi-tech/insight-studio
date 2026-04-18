import { useMemo } from 'react'
import styles from './PriorityActionHeroV2.module.css'

/**
 * Stitch 2.0 priority-actions hero.
 *
 * Prefers `envelope.priority_actions[]` when provided, falls back to parsing
 * markdown (same heading set as v1). Surfaces up to 3 actions as tonally
 * layered cards with a leading gold accent rail.
 */

const HEADINGS = [
  /##\s*(?:\d+[.．]?\s*)?最優先施策[^\n]*/,
  /##\s*(?:\d+[.．]?\s*)?優先施策[^\n]*/,
  /##\s*(?:\d+[.．]?\s*)?実行プラン[^\n]*/,
  /##\s*(?:\d+[.．]?\s*)?推奨(?:事項|施策)[^\n]*/,
  /##\s*(?:\d+[.．]?\s*)?(?:広告運用)?アクションプラン[^\n]*/,
  /##\s*(?:\d+[.．]?\s*)?改善提案[^\n]*/,
]

function findPrioritySection(reportMd) {
  if (typeof reportMd !== 'string') return ''
  for (const hp of HEADINGS) {
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

function extractActionsFromMd(sectionMd) {
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

function resolveActions({ envelope, reportMd }) {
  const envActions = envelope?.priority_actions
  if (Array.isArray(envActions) && envActions.length > 0) {
    return envActions.slice(0, 3).map((a) => ({
      title: a.title || '',
      detail: a.detail || '',
    }))
  }
  return extractActionsFromMd(findPrioritySection(reportMd))
}

export default function PriorityActionHeroV2({ envelope, reportMd }) {
  const actions = useMemo(() => resolveActions({ envelope, reportMd }), [envelope, reportMd])

  if (!actions.length) return null

  return (
    <section className={`${styles.hero} md-v2-enter`} aria-label="最優先施策">
      <div className={styles.header}>
        <span className={styles.headerDot} aria-hidden="true" />
        <span className={styles.headerLabel}>Priority Actions — 最優先施策</span>
      </div>

      <div className={styles.grid}>
        {actions.map((action, idx) => (
          <article key={idx} className={styles.card}>
            <div className={styles.index} aria-hidden="true">
              {String(idx + 1).padStart(2, '0')}
            </div>
            <h3 className={styles.title}>{action.title}</h3>
            {action.detail && (
              <p className={styles.detail}>
                {action.detail.length > 160 ? action.detail.slice(0, 157) + '…' : action.detail}
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
