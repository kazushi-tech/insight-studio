const WRAPPER_KEYS = [
  'data',
  'result',
  'results',
  'payload',
  'output',
  'value',
  'insight',
  'insights',
  'report',
  'analysis',
  'content',
  'response',
]

const DEFAULT_TEXT_KEYS = [
  'report_md',
  'summary_md',
  'analysis_md',
  'content_md',
  'response_md',
  'report',
  'summary',
  'ai_insight',
  'analysis',
  'content',
  'response',
  'body',
  'text',
  'message',
  'markdown',
  'md',
  'answer',
  'description',
  'detail',
]

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function isNonEmptyText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function textFromValue(value) {
  if (isNonEmptyText(value)) return value.trim()

  if (Array.isArray(value) && value.length > 0 && value.every(isNonEmptyText)) {
    return value.map((item) => item.trim()).join('\n\n')
  }

  return null
}

function getCandidateObjects(payload) {
  const queue = [payload]
  const visited = new Set()
  const candidates = []

  while (queue.length > 0) {
    const current = queue.shift()
    if (!isPlainObject(current) || visited.has(current)) continue

    visited.add(current)
    candidates.push(current)

    WRAPPER_KEYS.forEach((key) => {
      const next = current[key]
      if (isPlainObject(next)) queue.push(next)

      if (Array.isArray(next)) {
        next.forEach((item) => {
          if (isPlainObject(item)) queue.push(item)
        })
      }
    })
  }

  return candidates
}

function scoreCandidate(candidate) {
  return Object.entries(candidate).reduce((score, [key, value]) => {
    if (DEFAULT_TEXT_KEYS.includes(key)) return score + 4
    if (key === 'sections' && Array.isArray(value)) return score + 5
    if (Array.isArray(value) && value.length > 0) return score + 2
    if (isPlainObject(value) && Object.keys(value).length > 0) return score + 1
    if (textFromValue(value)) return score + 2
    return score
  }, 0)
}

export function normalizeAdsPayload(payload) {
  if (!isPlainObject(payload)) return payload

  const candidates = getCandidateObjects(payload)
  if (candidates.length === 0) return payload

  return candidates.reduce((best, candidate) =>
    scoreCandidate(candidate) > scoreCandidate(best) ? candidate : best,
  candidates[0])
}

export function getAdsText(payload, preferredKeys = DEFAULT_TEXT_KEYS) {
  const directText = textFromValue(payload)
  if (directText) return directText

  const candidates = getCandidateObjects(payload)
  for (const candidate of candidates) {
    for (const key of preferredKeys) {
      const text = textFromValue(candidate[key])
      if (text) return text
    }
  }

  return null
}

export function getAdsSections(payload) {
  const candidates = getCandidateObjects(payload)

  for (const candidate of candidates) {
    if (Array.isArray(candidate.sections)) return candidate.sections
    if (Array.isArray(candidate.report_sections)) return candidate.report_sections
  }

  return []
}

/**
 * Extracts the insight-meta JSON block emitted at the end of AI responses.
 * Backend convention: the AI is instructed to append a final fenced block:
 *   ```insight-meta
 *   { "tldr": [...], "key_metrics": [...], "recommended_charts": [...] }
 *   ```
 * Returns null when the block is missing OR JSON is invalid OR the
 * minimum shape contract isn't met. Never throws.
 *
 * @param {string} markdown
 * @returns {{ tldr: string[], key_metrics: Array<{label: string, value: string, delta?: 'up'|'down'|'flat'}>, recommended_charts: string[], _strippedMarkdown: string } | null}
 */
export function extractInsightMeta(markdown) {
  if (!markdown || typeof markdown !== 'string') return null
  const match = markdown.match(/```insight-meta\s*\n([\s\S]*?)\n```/)
  if (!match) return null
  let parsed
  try {
    parsed = JSON.parse(match[1])
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const tldr = Array.isArray(parsed.tldr)
    ? parsed.tldr.filter((s) => typeof s === 'string')
    : []
  const key_metrics = Array.isArray(parsed.key_metrics)
    ? parsed.key_metrics
        .filter(
          (m) =>
            m &&
            typeof m === 'object' &&
            typeof m.label === 'string' &&
            typeof m.value === 'string',
        )
        .map((m) => ({
          label: m.label,
          value: m.value,
          delta:
            m.delta === 'up' || m.delta === 'down' || m.delta === 'flat'
              ? m.delta
              : undefined,
        }))
    : []
  const recommended_charts = Array.isArray(parsed.recommended_charts)
    ? parsed.recommended_charts.filter((c) => typeof c === 'string')
    : []
  if (tldr.length === 0 && key_metrics.length === 0 && recommended_charts.length === 0) {
    return null
  }
  // Strip the fenced block from the markdown so MarkdownRenderer doesn't render it
  const strippedMarkdown = markdown
    .replace(/```insight-meta\s*\n[\s\S]*?\n```\s*/g, '')
    .trim()
  return { tldr, key_metrics, recommended_charts, _strippedMarkdown: strippedMarkdown }
}

const OPERATIONAL_CARD_DEFS = [
  { key: 'cause', title: '原因', patterns: [/原因/, /推定原因/, /なぜ/] },
  { key: 'implication', title: '広告運用上の示唆', patterns: [/広告運用上の示唆/, /示唆/, /運用上/] },
  { key: 'metric', title: '次に見るべき数値', patterns: [/次に見るべき数値/, /見るべき指標/, /次に見るべきKPI/, /指標/] },
  { key: 'action', title: '今週やる施策', patterns: [/今週やる施策/, /次アクション/, /優先施策/, /施策/] },
  { key: 'expectedKpi', title: '期待KPI', patterns: [/期待KPI/, /期待効果/, /改善目標/] },
]

function normalizeLine(line) {
  return String(line || '')
    .replace(/^\s*(?:[-*•]|\d+[.．)])\s*/, '')
    .replace(/\*\*/g, '')
    .trim()
}

function findHeadingSection(markdown, patterns) {
  const lines = String(markdown || '').split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const heading = lines[i].match(/^#{2,4}\s+(.+)$/)
    if (!heading) continue
    const title = heading[1].replace(/\*\*/g, '').trim()
    if (!patterns.some((pattern) => pattern.test(title))) continue
    const body = []
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^#{2,4}\s+/.test(lines[j])) break
      const cleaned = normalizeLine(lines[j])
      if (cleaned && !cleaned.startsWith('|')) body.push(cleaned)
      if (body.length >= 3) break
    }
    if (body.length > 0) return body.join(' ')
  }
  return ''
}

function findInlineSection(markdown, patterns) {
  const lines = String(markdown || '').split(/\r?\n/)
  for (const rawLine of lines) {
    const line = normalizeLine(rawLine)
    if (!line) continue
    for (const pattern of patterns) {
      if (!pattern.test(line)) continue
      const value = line.replace(pattern, '').replace(/^[:：\s]+/, '').trim()
      if (value) return value
    }
  }
  return ''
}

export function extractOperationalInsightCards(markdown) {
  if (!markdown || typeof markdown !== 'string') return []
  return OPERATIONAL_CARD_DEFS
    .map((def) => ({
      key: def.key,
      title: def.title,
      body: findHeadingSection(markdown, def.patterns) || findInlineSection(markdown, def.patterns),
    }))
    .filter((card) => card.body)
}
