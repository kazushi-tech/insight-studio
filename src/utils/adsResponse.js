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

function stripInsightBlocks(markdown) {
  const withoutFencedBlocks = String(markdown || '')
    .replace(/```insight-report\s*\n[\s\S]*?\n```\s*/g, '')
    .replace(/```insight-meta\s*\n[\s\S]*?\n```\s*/g, '')
  return stripEmbeddedInsightReports(withoutFencedBlocks).trim()
}

function looksLikeInsightReportV2(value) {
  if (!isPlainObject(value)) return false
  return [
    'executive_summary',
    'evidence_table',
    'interpretation',
    'hypotheses',
    'limitations',
    'review_status',
  ].some((key) => Object.prototype.hasOwnProperty.call(value, key))
}

function collectJsonObjects(markdown) {
  const source = String(markdown || '')
  const objects = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{') {
      if (depth === 0) start = index
      depth += 1
      continue
    }

    if (char !== '}' || depth === 0) continue

    depth -= 1
    if (depth !== 0 || start < 0) continue

    const raw = source.slice(start, index + 1)
    try {
      const parsed = JSON.parse(raw)
      objects.push({ raw, parsed, start, end: index + 1 })
    } catch {
      // Ignore non-JSON braces in Markdown prose.
    }
    start = -1
  }

  return objects
}

function countBackslashesBefore(source, index) {
  let count = 0
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    count += 1
  }
  return count
}

function unescapeStructuralJsonQuotes(raw) {
  return String(raw || '').replace(/(^|[^\\])\\"/g, '$1"')
}

function collectEscapedJsonObjects(markdown) {
  const source = String(markdown || '')
  const objects = []
  let start = -1
  let depth = 0
  let inString = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const slashCount = char === '"' ? countBackslashesBefore(source, index) : 0
    const isStructuralQuote = char === '"' && slashCount === 1

    if (isStructuralQuote) {
      inString = !inString
      continue
    }

    if (inString) continue

    if (char === '{') {
      if (depth === 0) start = index
      depth += 1
      continue
    }

    if (char !== '}' || depth === 0) continue

    depth -= 1
    if (depth !== 0 || start < 0) continue

    const raw = source.slice(start, index + 1)
    try {
      const parsed = JSON.parse(unescapeStructuralJsonQuotes(raw))
      objects.push({ raw, parsed, start, end: index + 1 })
    } catch {
      // Ignore escaped text that only looks like JSON.
    }
    start = -1
  }

  return objects
}

function findEmbeddedInsightReport(markdown) {
  const validReport = [
    ...collectJsonObjects(markdown),
    ...collectEscapedJsonObjects(markdown),
  ].find(({ parsed }) => looksLikeInsightReportV2(parsed)) || null
  return validReport || recoverMalformedInsightReport(markdown)
}

function stripEmbeddedInsightReports(markdown) {
  const source = String(markdown || '')
  const objects = [
    ...collectJsonObjects(source),
    ...collectEscapedJsonObjects(source),
  ].filter(({ parsed }) => looksLikeInsightReportV2(parsed))
    .sort((a, b) => a.start - b.start)
  if (objects.length === 0) return source

  let cursor = 0
  let stripped = ''
  objects.forEach(({ start, end }) => {
    if (start < cursor) return
    stripped += source.slice(cursor, start)
    cursor = end
  })
  stripped += source.slice(cursor)
  return stripped
}

function recoverMalformedInsightReport(markdown) {
  const source = String(markdown || '')
  const versionMatch = source.match(/\\?"version\\?"\s*:\s*\\?"insight_report_v2\\?"/)
  if (!versionMatch) return null

  const versionIndex = versionMatch.index ?? -1
  const start = source.lastIndexOf('{', versionIndex)
  if (start < 0) return null

  const rest = source.slice(start)
  const agentTraceMatch = rest.match(/,\s*\\?"agent_trace\\?"\s*:/)
  if (!agentTraceMatch || agentTraceMatch.index == null) {
    return recoverMalformedInsightReportFromText(source, start)
  }

  const raw = rest.slice(0, agentTraceMatch.index).replace(/,\s*$/, '') + '}'
  const normalizedRaw = raw.includes('\\"') ? unescapeStructuralJsonQuotes(raw) : raw
  try {
    const parsed = JSON.parse(normalizedRaw)
    if (!looksLikeInsightReportV2(parsed)) return null
    return { raw: rest, parsed, start, end: source.length, recovered: true }
  } catch {
    return recoverMalformedInsightReportFromText(source, start)
  }
}

function recoverMalformedInsightReportFromText(source, start) {
  const text = String(source || '')
  const executive_summary = []
  const summaryMatch = text.match(/\\?"executive_summary\\?"\s*:\s*\[\s*\\?"([^"\\]{12,500})/)
  if (summaryMatch?.[1]) executive_summary.push(summaryMatch[1].trim())

  const evidence_table = extractMalformedEvidenceRows(text)
  const limitations = extractMalformedLimitations(text)

  if (executive_summary.length === 0 && evidence_table.length === 0 && limitations.length === 0) {
    return null
  }

  return {
    raw: text.slice(start),
    parsed: {
      version: 'insight_report_v2',
      executive_summary,
      evidence_table,
      limitations,
      review_status: {
        verdict: 'recovered',
        notes: ['壊れた内部traceを除外し、ユーザー向け根拠だけを復元'],
      },
      agent_trace: [],
    },
    start,
    end: text.length,
    recovered: true,
  }
}

function extractMalformedEvidenceRows(text) {
  const rows = extractJsonishEvidenceRows(text)
  const normalizedText = String(text || '').replace(/\\n/g, '\n')
  const lines = normalizedText.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue
    if (/^-+\s*\|/.test(trimmed.replace(/^\|/, ''))) continue

    const cells = trimmed.split('|').slice(1, -1).map((cell) => cell.trim())
    if (cells.length < 5) continue
    if (cells.some((cell) => /^-+$/.test(cell))) continue
    if (/chart_id|metric|value|period/i.test(cells.join(' '))) continue

    const [source, title, metric, value, period] = cells
    if (!/^chart_\d+/i.test(source) || !metric || !value) continue
    rows.push({
      claim: [title, metric, value, period].filter(Boolean).join(' / '),
      metric,
      value,
      period,
      source,
      confidence: 'recovered',
    })
  }
  const seen = new Set()
  return rows.filter((row) => {
    const key = [row.source, row.metric, row.value, row.period, row.claim].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 8)
}

function extractJsonishEvidenceRows(text) {
  const normalizedText = String(text || '')
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
  const blocks = normalizedText.match(/\{[^{}]{0,1800}?"(?:claim|metric|value|period|source|chart_id)"[^{}]{0,1800}?\}/g) || []
  return blocks
    .map((block) => {
      const field = (...keys) => {
        for (const key of keys) {
          const match = block.match(new RegExp(`"${key}"\\s*:\\s*"([^"]{1,700})"`))
          if (match?.[1]) return match[1].trim()
        }
        return ''
      }
      const claim = field('claim', 'finding')
      const metric = field('metric')
      const value = field('value')
      const period = field('period')
      const source = field('source', 'chart_id')
      if (!metric || !value) return null
      return {
        claim: claim || [source, metric, value, period].filter(Boolean).join(' / '),
        metric,
        value,
        period,
        source,
        confidence: field('confidence') || 'recovered',
      }
    })
    .filter(Boolean)
}

function extractMalformedLimitations(text) {
  const limitations = []
  const limitationMatch = String(text || '').match(/未取得扱い[:：]\s*([^"}\]]{4,160})/)
  if (limitationMatch?.[1]) limitations.push(limitationMatch[1].trim())

  const kpis = ['広告費', 'CPA', 'ROAS', 'CTR', 'CPC', 'インプレッション']
    .filter((kpi) => text.includes(kpi))
  if (kpis.length > 0 && /未取得|存在しない|断定禁止/.test(text)) {
    limitations.push(`${[...new Set(kpis)].join(' / ')} は入力に存在しないため判断保留`)
  }
  return [...new Set(limitations)].slice(0, 4)
}

function normalizeTextArray(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim()
      if (isPlainObject(item)) {
        const title = typeof item.title === 'string' ? item.title.trim() : ''
        const body = typeof item.body === 'string'
          ? item.body.trim()
          : typeof item.note === 'string'
          ? item.note.trim()
          : typeof item.text === 'string'
          ? item.text.trim()
          : ''
        return [title, body].filter(Boolean).join(': ')
      }
      return ''
    })
    .filter(Boolean)
}

function normalizeInsightItems(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'string') return { title: '', body: item.trim(), evidence: [], priority: '' }
      if (!isPlainObject(item)) return null
      const title = typeof item.title === 'string'
        ? item.title.trim()
        : typeof item.label === 'string'
        ? item.label.trim()
        : ''
      const body = typeof item.body === 'string'
        ? item.body.trim()
        : typeof item.text === 'string'
        ? item.text.trim()
        : typeof item.note === 'string'
        ? item.note.trim()
        : ''
      const evidence = normalizeTextArray(item.evidence)
      const priority = typeof item.priority === 'string' ? item.priority.trim() : ''
      if (!title && !body && evidence.length === 0) return null
      return { title, body, evidence, priority }
    })
    .filter(Boolean)
}

function normalizeMetricCards(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!isPlainObject(item)) return null
      const label = typeof item.label === 'string'
        ? item.label.trim()
        : typeof item.title === 'string'
        ? item.title.trim()
        : ''
      const valueText = typeof item.value === 'string'
        ? item.value.trim()
        : typeof item.current === 'string'
        ? item.current.trim()
        : ''
      const note = typeof item.note === 'string'
        ? item.note.trim()
        : typeof item.body === 'string'
        ? item.body.trim()
        : ''
      const delta =
        item.delta === 'up' || item.delta === 'down' || item.delta === 'flat'
          ? item.delta
          : undefined
      if (!label || !valueText) return null
      return { label, value: valueText, delta, note }
    })
    .filter(Boolean)
}

function normalizeActionItems(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index) => {
      if (typeof item === 'string') {
        const body = item.trim()
        return body ? { label: `P${index}`, title: body, body: '', owner: '', due: '', evidence: [] } : null
      }
      if (!isPlainObject(item)) return null
      const label = typeof item.label === 'string' ? item.label.trim() : `P${index}`
      const title = typeof item.title === 'string'
        ? item.title.trim()
        : typeof item.task === 'string'
        ? item.task.trim()
        : ''
      const body = typeof item.body === 'string'
        ? item.body.trim()
        : typeof item.note === 'string'
        ? item.note.trim()
        : ''
      const owner = typeof item.owner === 'string' ? item.owner.trim() : ''
      const due = typeof item.due === 'string' ? item.due.trim() : ''
      const evidence = normalizeTextArray(item.evidence)
      if (!title && !body) return null
      return { label, title, body, owner, due, evidence }
    })
    .filter(Boolean)
}

/**
 * Extracts the structured HTML-report contract emitted by AI responses.
 * The AI appends a final fenced block:
 *   ```insight-report
 *   { "summary": "...", "metric_cards": [...], "findings": [...] }
 *   ```
 * The block is parsed into a safe React-renderable object. No raw HTML is
 * accepted. Returns null for missing, invalid, or empty report blocks.
 *
 * @param {string} markdown
 * @returns {{
 *   summary: string,
 *   metric_cards: Array<{label: string, value: string, delta?: 'up'|'down'|'flat', note?: string}>,
 *   findings: Array<{title: string, body: string, evidence: string[], priority?: string}>,
 *   risks: Array<{title: string, body: string, evidence: string[], priority?: string}>,
 *   actions: Array<{label: string, title: string, body: string, owner: string, due: string, evidence: string[]}>,
 *   evidence: string[],
 *   recommended_charts: string[],
 *   _strippedMarkdown: string,
 * } | null}
 */
export function extractInsightReport(markdown) {
  if (!markdown || typeof markdown !== 'string') return null
  const match = markdown.match(/```insight-report\s*\n([\s\S]*?)\n```/)
  const embedded = match ? null : findEmbeddedInsightReport(markdown)
  const rawCandidate = match ? match[1] : embedded?.raw ?? markdown.trim()

  let parsed
  if (embedded && !match) {
    parsed = embedded.parsed
  } else {
    try {
      parsed = JSON.parse(rawCandidate)
    } catch {
      return null
    }
  }
  if (!isPlainObject(parsed)) return null

  const hasV2Shape = looksLikeInsightReportV2(parsed)

  if (hasV2Shape) {
    const report = {
      version: typeof parsed.version === 'string' ? parsed.version : 'insight_report_v2',
      executive_summary: normalizeStringArray(parsed.executive_summary),
      evidence_table: normalizeObjectArray(parsed.evidence_table).map((row) => ({
        claim: String(row.claim ?? row.finding ?? '').trim(),
        metric: String(row.metric ?? '').trim(),
        value: String(row.value ?? '').trim(),
        period: String(row.period ?? '').trim(),
        source: String(row.source ?? row.chart_id ?? '').trim(),
        confidence: String(row.confidence ?? '').trim(),
      })).filter((row) => row.claim || row.metric || row.value),
      interpretation: normalizeStringArray(parsed.interpretation),
      hypotheses: normalizeObjectArray(parsed.hypotheses).map((item) => ({
        hypothesis: String(item.hypothesis ?? item.summary ?? '').trim(),
        evidence: String(item.evidence ?? '').trim(),
        missing_data: String(item.missing_data ?? item.required_data ?? '').trim(),
      })).filter((item) => item.hypothesis || item.evidence || item.missing_data),
      actions: normalizeObjectArray(parsed.actions).map((item) => ({
        priority: String(item.priority ?? '').trim(),
        action: String(item.action ?? item.task ?? '').trim(),
        rationale: String(item.rationale ?? item.reason ?? '').trim(),
        expected_metric: String(item.expected_metric ?? item.expectedKpi ?? '').trim(),
      })).filter((item) => item.priority || item.action || item.rationale),
      limitations: normalizeStringArray(parsed.limitations),
      review_status: parsed.review_status && typeof parsed.review_status === 'object'
        ? {
            verdict: String(parsed.review_status.verdict ?? '').trim(),
            notes: normalizeStringArray(parsed.review_status.notes),
            blocking_issues: normalizeStringArray(parsed.review_status.blocking_issues),
            checked_items: normalizeStringArray(parsed.review_status.checked_items),
            unsupported_kpis: normalizeStringArray(parsed.review_status.unsupported_kpis),
            evidence_consistency: isPlainObject(parsed.review_status.evidence_consistency)
              ? parsed.review_status.evidence_consistency
              : null,
          }
        : null,
      agent_trace: normalizeAgentTrace(parsed.agent_trace),
    }

    const hasContent =
      report.executive_summary.length > 0 ||
      report.evidence_table.length > 0 ||
      report.interpretation.length > 0 ||
      report.hypotheses.length > 0 ||
      report.actions.length > 0 ||
      report.limitations.length > 0

    const strippedMarkdown = embedded?.recovered ? '' : (match || embedded ? stripInsightBlocks(markdown) : '')
    return hasContent ? { ...report, _strippedMarkdown: strippedMarkdown } : null
  }

  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : ''
  const metric_cards = normalizeMetricCards(parsed.metric_cards)
  const findings = normalizeInsightItems(parsed.findings)
  const risks = normalizeInsightItems(parsed.risks)
  const actions = normalizeActionItems(parsed.actions)
  const evidence = normalizeTextArray(parsed.evidence)
  const recommended_charts = normalizeTextArray(parsed.recommended_charts)

  if (
    !summary &&
    metric_cards.length === 0 &&
    findings.length === 0 &&
    risks.length === 0 &&
    actions.length === 0 &&
    evidence.length === 0 &&
    recommended_charts.length === 0
  ) {
    return null
  }

  return {
    summary,
    metric_cards,
    findings,
    risks,
    actions,
    evidence,
    recommended_charts,
    _strippedMarkdown: match ? stripInsightBlocks(markdown) : '',
  }
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
  const agent_trace = normalizeAgentTrace(parsed.agent_trace)
  const review_status = parsed.review_status && typeof parsed.review_status === 'object'
    ? {
        verdict: String(parsed.review_status.verdict ?? '').trim(),
        notes: normalizeStringArray(parsed.review_status.notes),
        blocking_issues: normalizeStringArray(parsed.review_status.blocking_issues),
        checked_items: normalizeStringArray(parsed.review_status.checked_items),
        unsupported_kpis: normalizeStringArray(parsed.review_status.unsupported_kpis),
        evidence_consistency: isPlainObject(parsed.review_status.evidence_consistency)
          ? parsed.review_status.evidence_consistency
          : null,
      }
    : null
  if (tldr.length === 0 && key_metrics.length === 0 && recommended_charts.length === 0 && agent_trace.length === 0) {
    return null
  }
  // Strip the fenced block from the markdown so MarkdownRenderer doesn't render it
  const strippedMarkdown = stripInsightBlocks(markdown)
  return { tldr, key_metrics, recommended_charts, agent_trace, review_status, _strippedMarkdown: strippedMarkdown }
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : []
}

function normalizeObjectArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    : []
}

function normalizeAgentTrace(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      stage: String(item.stage ?? '').trim(),
      label: String(item.label ?? item.stage ?? '').trim(),
      status: String(item.status ?? '').trim(),
      mode: String(item.mode ?? '').trim(),
      summary: String(item.summary ?? item.excerpt ?? '').trim(),
      checks: normalizeStringArray(item.checks),
      issues: normalizeStringArray(item.issues),
      excerpt: String(item.excerpt ?? '').trim(),
    }))
    .filter((item) => item.stage || item.label)
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
