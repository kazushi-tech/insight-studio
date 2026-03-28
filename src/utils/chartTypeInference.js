export const SUPPORTED_CHART_TYPES = ['line', 'bar_horizontal', 'doughnut', 'area']

export const CHART_TYPE_LABELS = {
  line: 'Line / Trend',
  bar_horizontal: 'Horizontal Bar',
  doughnut: 'Doughnut',
  area: 'Area',
}

const COMPOSITION_KEYWORDS = /構成|構成比|シェア|比率|割合|share|ratio/i
const RANKING_KEYWORDS = /top|ランキング|地域別|os別|検索|クエリ|lp/i

function normalizeNumeric(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const parsed = Number(value.trim().replace(/,/g, '').replace(/[%％]$/, ''))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function isDoughnutCandidate(group) {
  const datasets = Array.isArray(group?.datasets) ? group.datasets : []
  const labels = Array.isArray(group?.labels) ? group.labels : []
  const title = String(group?.title ?? '')

  // Must be single dataset
  if (datasets.length !== 1) return false

  // Valid label count: 2–6
  if (labels.length < 2 || labels.length > 6) return false

  const dataset = datasets[0]
  const data = Array.isArray(dataset?.data) ? dataset.data : []
  const numericValues = data.map(normalizeNumeric).filter((v) => v != null)

  // Need at least 2 valid numeric points
  if (numericValues.length < 2) return false

  // Sum must be ~100 (98–102)
  const sum = numericValues.reduce((a, b) => a + b, 0)
  if (sum < 98 || sum > 102) return false

  // Must contain composition keyword in title or dataset label
  const datasetLabel = String(dataset?.label ?? '')
  const hasCompositionKeyword =
    COMPOSITION_KEYWORDS.test(title) || COMPOSITION_KEYWORDS.test(datasetLabel)
  if (!hasCompositionKeyword) return false

  // Must NOT contain ranking keyword
  if (RANKING_KEYWORDS.test(title) || RANKING_KEYWORDS.test(datasetLabel)) return false

  return true
}

export function resolveChartType(group) {
  const raw = group?.chartType ?? 'line'

  // If backend explicitly sends a supported type, respect it
  if (raw === 'area' || raw === 'doughnut') return raw

  // Strict doughnut promotion from bar_horizontal only
  if (raw === 'bar_horizontal' && isDoughnutCandidate(group)) return 'doughnut'

  // Known types pass through, unknown falls back to line
  if (raw === 'line' || raw === 'bar_horizontal') return raw

  return 'line'
}
