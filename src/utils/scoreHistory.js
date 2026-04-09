/**
 * Score history persistence for past run comparison.
 * Stores the last 10 run scores per analysis kind in localStorage.
 */

const STORAGE_KEY = 'is-score-history'
const MAX_ENTRIES = 10

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function save(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch { /* quota exceeded — ignore */ }
}

/**
 * Record a completed run's score.
 * @param {string} kind — 'compare' | 'discovery' | 'creative-review'
 * @param {object} entry — { score: number, label?: string, timestamp: number }
 */
export function recordScore(kind, entry) {
  const data = load()
  if (!data[kind]) data[kind] = []
  data[kind] = [entry, ...data[kind]].slice(0, MAX_ENTRIES)
  save(data)
}

/**
 * Get score history for a kind.
 * @param {string} kind
 * @returns {Array<{ score: number, label?: string, timestamp: number }>}
 */
export function getScoreHistory(kind) {
  return load()[kind] || []
}

/**
 * Get the previous score for comparison (second entry in history).
 * @param {string} kind
 * @returns {number|null}
 */
export function getPreviousScore(kind) {
  const history = getScoreHistory(kind)
  return history.length >= 2 ? history[1].score : null
}

/**
 * Format a score delta like "+5" or "-3".
 */
export function formatScoreDelta(current, previous) {
  if (previous == null || current == null) return null
  const delta = current - previous
  if (delta === 0) return null
  return delta > 0 ? `+${delta}` : `${delta}`
}
