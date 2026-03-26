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
