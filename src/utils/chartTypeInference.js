export const SUPPORTED_CHART_TYPES = ['line', 'bar_horizontal', 'doughnut', 'area']

export const CHART_TYPE_LABELS = {
  line: '推移',
  bar_horizontal: '横棒比較',
  doughnut: '構成比',
  area: 'エリア推移',
}

const PERCENT_KEYWORDS = /構成|構成比|割合|比率|シェア|%|％|share|ratio/i
const RANKING_KEYWORDS = /top\s*\d|ランキング|地域別|os別|検索|クエリ|lp分析/i
const AREA_KEYWORDS = /推移|日別|月別|週別|トレンド|trend/i

function normalizeNumeric(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const parsed = Number(value.trim().replace(/,/g, '').replace(/[%％]$/, ''))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function textOf(group, dataset) {
  return `${group?.title ?? ''} ${dataset?.label ?? ''}`
}

function hasPercentSignal(group, dataset) {
  return PERCENT_KEYWORDS.test(textOf(group, dataset))
}

function hasRankingSignal(group, dataset) {
  return RANKING_KEYWORDS.test(textOf(group, dataset))
}

function hasAreaSignal(group) {
  return AREA_KEYWORDS.test(String(group?.title ?? ''))
}

function canRenderDoughnut(group) {
  const datasets = Array.isArray(group?.datasets) ? group.datasets : []
  if (datasets.length !== 1) return false
  const data = Array.isArray(datasets[0]?.data) ? datasets[0].data : []
  const numericValues = data.map(normalizeNumeric).filter((v) => v != null)
  return numericValues.length >= 2
}

/**
 * Doughnut promotion from bar_horizontal.
 * Relaxed: single dataset, 2–8 labels, non-negative values, no ranking keywords.
 */
function isPromotableDoughnut(group) {
  const datasets = Array.isArray(group?.datasets) ? group.datasets : []
  const labels = Array.isArray(group?.labels) ? group.labels : []

  if (datasets.length !== 1) return false
  if (labels.length < 2 || labels.length > 8) return false

  const dataset = datasets[0]
  if (hasRankingSignal(group, dataset)) return false

  const data = Array.isArray(dataset?.data) ? dataset.data : []
  const numericValues = data.map(normalizeNumeric).filter((v) => v != null)

  if (numericValues.length < 2) return false
  if (numericValues.some((v) => v < 0)) return false

  return true
}

/**
 * Area promotion from single-dataset line with time-series title.
 */
function isPromotableArea(group) {
  const datasets = Array.isArray(group?.datasets) ? group.datasets : []
  const labels = Array.isArray(group?.labels) ? group.labels : []

  if (datasets.length !== 1) return false
  if (labels.length < 3) return false
  if (!hasAreaSignal(group)) return false

  return true
}

/**
 * Returns presentation metadata for a chart group.
 */
export function resolveChartPresentation(group) {
  const raw = group?.chartType ?? 'line'
  const dataset = Array.isArray(group?.datasets) ? group.datasets[0] : null

  // Explicit doughnut from backend
  if (raw === 'doughnut') {
    if (canRenderDoughnut(group)) {
      return {
        chartType: 'doughnut',
        usePercent: hasPercentSignal(group, dataset),
        promotionSource: 'raw',
      }
    }
    return { chartType: 'bar_horizontal', usePercent: false, promotionSource: 'raw' }
  }

  // Explicit area from backend
  if (raw === 'area') {
    return { chartType: 'area', usePercent: false, promotionSource: 'raw' }
  }

  // Doughnut promotion from bar_horizontal
  if (raw === 'bar_horizontal' && isPromotableDoughnut(group)) {
    return {
      chartType: 'doughnut',
      usePercent: hasPercentSignal(group, dataset),
      promotionSource: 'promoted',
    }
  }

  // Area promotion from single-dataset line with time-series title
  if (raw === 'line' && isPromotableArea(group)) {
    return { chartType: 'area', usePercent: false, promotionSource: 'promoted' }
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
 */
export function resolveChartType(group) {
  return resolveChartPresentation(group).chartType
}
