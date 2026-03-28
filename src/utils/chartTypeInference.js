export const SUPPORTED_CHART_TYPES = ['line', 'bar_horizontal', 'doughnut', 'area']

export const CHART_TYPE_LABELS = {
  line: 'Line / Trend',
  bar_horizontal: 'Horizontal Bar',
  doughnut: 'Doughnut',
  area: 'Area',
}

// Strong percent signals — "構成" alone is too weak and matches count-based composition
const STRONG_PERCENT_KEYWORDS = /構成比|割合|比率|シェア|%|％|share|ratio/i
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

/**
 * Check if a group has strong percent signal in title or dataset label.
 */
function hasStrongPercentSignal(group, dataset) {
  const title = String(group?.title ?? '')
  const datasetLabel = String(dataset?.label ?? '')
  return STRONG_PERCENT_KEYWORDS.test(title) || STRONG_PERCENT_KEYWORDS.test(datasetLabel)
}

/**
 * Check if a group has ranking-related keywords that should NOT be doughnut.
 */
function hasRankingSignal(group, dataset) {
  const title = String(group?.title ?? '')
  const datasetLabel = String(dataset?.label ?? '')
  return RANKING_KEYWORDS.test(title) || RANKING_KEYWORDS.test(datasetLabel)
}

/**
 * Check if the renderer can safely draw this group as a doughnut.
 * Requirements: single dataset, at least 2 valid data points, labels match data.
 */
function canRenderDoughnut(group) {
  const datasets = Array.isArray(group?.datasets) ? group.datasets : []
  const labels = Array.isArray(group?.labels) ? group.labels : []

  if (datasets.length !== 1) return false

  const dataset = datasets[0]
  const data = Array.isArray(dataset?.data) ? dataset.data : []
  const numericValues = data.map(normalizeNumeric).filter((v) => v != null)

  if (numericValues.length < 2) return false
  if (labels.length < numericValues.length) return false

  return true
}

/**
 * Check if a bar_horizontal group qualifies for doughnut promotion.
 * Strict conditions: single dataset, 2-6 labels, sum ~100, all values 0-100,
 * strong percent keyword present, no ranking keyword.
 */
function isPromotableDoughnut(group) {
  const datasets = Array.isArray(group?.datasets) ? group.datasets : []
  const labels = Array.isArray(group?.labels) ? group.labels : []

  if (datasets.length !== 1) return false
  if (labels.length < 2 || labels.length > 6) return false

  const dataset = datasets[0]
  const data = Array.isArray(dataset?.data) ? dataset.data : []
  const numericValues = data.map(normalizeNumeric).filter((v) => v != null)

  if (numericValues.length < 2) return false

  // All values must be in 0–100 range
  if (numericValues.some((v) => v < 0 || v > 100)) return false

  // Sum must be ~100 (98–102)
  const sum = numericValues.reduce((a, b) => a + b, 0)
  if (sum < 98 || sum > 102) return false

  // Must have strong percent signal (not just "構成")
  if (!hasStrongPercentSignal(group, dataset)) return false

  // Must NOT have ranking signal
  if (hasRankingSignal(group, dataset)) return false

  return true
}

/**
 * Returns presentation metadata for a chart group.
 * chartType: the effective type to render
 * usePercent: whether values should be formatted with %
 * promotionSource: 'raw' if backend-provided, 'promoted' if frontend-inferred
 */
export function resolveChartPresentation(group) {
  const raw = group?.chartType ?? 'line'
  const dataset = Array.isArray(group?.datasets) ? group.datasets[0] : null

  // Explicit doughnut from backend — only pass through if renderer can handle it
  if (raw === 'doughnut') {
    if (canRenderDoughnut(group)) {
      return {
        chartType: 'doughnut',
        usePercent: hasStrongPercentSignal(group, dataset),
        promotionSource: 'raw',
      }
    }
    // Fallback: render as bar_horizontal (closer semantics than line)
    return {
      chartType: 'bar_horizontal',
      usePercent: false,
      promotionSource: 'raw',
    }
  }

  // Explicit area from backend
  if (raw === 'area') {
    return { chartType: 'area', usePercent: false, promotionSource: 'raw' }
  }

  // Strict doughnut promotion from bar_horizontal
  if (raw === 'bar_horizontal' && isPromotableDoughnut(group)) {
    return {
      chartType: 'doughnut',
      usePercent: true, // promoted doughnut always percent (sum ~100 guaranteed)
      promotionSource: 'promoted',
    }
  }

  // Known types pass through
  if (raw === 'line' || raw === 'bar_horizontal') {
    return { chartType: raw, usePercent: false, promotionSource: 'raw' }
  }

  // Unknown falls back to line
  return { chartType: 'line', usePercent: false, promotionSource: 'raw' }
}

/**
 * Thin wrapper — returns just the effective chart type.
 * Used by AnalysisGraphs summary where only the type matters.
 */
export function resolveChartType(group) {
  return resolveChartPresentation(group).chartType
}
