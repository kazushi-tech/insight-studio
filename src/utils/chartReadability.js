function toFiniteNumber(value) {
  if (value == null || value === '') return null
  const normalized =
    typeof value === 'string' ? Number(value.trim().replace(/,/g, '').replace(/[%％]$/, '')) : Number(value)
  return Number.isFinite(normalized) ? normalized : null
}

function getCoverageActualCount(group) {
  const raw =
    group?.actualCount ??
    group?.metadata?.actualCount ??
    String(group?.coverageLabel ?? group?.metadata?.coverageLabel ?? '').match(/上位(\d+)件/)?.[1]
  const count = Number(raw)
  return Number.isFinite(count) ? count : null
}

function getSeriesValues(dataset) {
  return (Array.isArray(dataset?.data) ? dataset.data : [])
    .map(toFiniteNumber)
    .filter((value) => value != null)
}

function getAllValues(group) {
  return (Array.isArray(group?.datasets) ? group.datasets : []).flatMap(getSeriesValues)
}

function hasWarning(group, warning) {
  return Array.isArray(group?.warnings) && group.warnings.includes(warning)
}

function isSearchTrend(group, chartType) {
  const title = String(group?.title ?? '')
  const queryType = group?.queryType ?? group?.metadata?.queryType
  return chartType === 'line' && queryType === 'search' && title.includes('日別推移')
}

function isBounceRanking(group, chartType) {
  const title = String(group?.title ?? '')
  return chartType === 'bar_horizontal' && /直帰率|bounce/i.test(title)
}

function isFlatValues(values) {
  if (values.length < 2) return false
  const min = Math.min(...values)
  const max = Math.max(...values)
  const tolerance = Math.max(0.0001, Math.abs(max) * 0.0001)
  return Math.abs(max - min) <= tolerance
}

export function analyzeChartReadability(group = {}, chartType = group?.chartType ?? 'line') {
  const labels = Array.isArray(group?.labels) ? group.labels : []
  const datasets = Array.isArray(group?.datasets) ? group.datasets : []
  const values = getAllValues(group)
  const maxValue = values.length > 0 ? Math.max(...values) : null
  const minValue = values.length > 0 ? Math.min(...values) : null
  const actualCount = getCoverageActualCount(group)
  const isLowSample =
    hasWarning(group, 'low_sample') ||
    (actualCount != null && actualCount < 5) ||
    (values.length > 0 && maxValue != null && maxValue <= 2 && values.length <= 12)
  const flatSeries = isFlatValues(values)
  const searchTrend = isSearchTrend(group, chartType)
  const bounceRanking = isBounceRanking(group, chartType)
  const hasTooManyLineSeries = chartType === 'line' && datasets.length > 3
  const hasTooManyXAxisLabels = chartType === 'line' && labels.length > 12

  let recommendedDisplayMode = 'chart'
  if (searchTrend && (isLowSample || (maxValue != null && maxValue <= 2))) {
    recommendedDisplayMode = 'low_sample_table'
  } else if (bounceRanking && flatSeries) {
    recommendedDisplayMode = 'flat_diagnostic'
  } else if (hasTooManyLineSeries || hasTooManyXAxisLabels) {
    recommendedDisplayMode = 'focused_line'
  } else if (chartType === 'bar_horizontal' && labels.length >= 10) {
    recommendedDisplayMode = 'readable_ranking'
  }

  return {
    actualCount,
    finiteValueCount: values.length,
    hasTooManyLineSeries,
    hasTooManyXAxisLabels,
    isBounceRanking: bounceRanking,
    isFlatSeries: flatSeries,
    isLowSample,
    isSearchTrend: searchTrend,
    maxValue,
    minValue,
    recommendedDisplayMode,
    seriesCount: datasets.length,
    xAxisLabelCount: labels.length,
  }
}

export function shortenChartLabel(label, maxLength = 36) {
  const text = String(label ?? '').trim()
  if (text.length <= maxLength) return text || '未対応ラベル'
  const withoutProtocol = text.replace(/^https?:\/\//, '')
  if (withoutProtocol.length <= maxLength) return withoutProtocol
  return `${withoutProtocol.slice(0, Math.max(8, maxLength - 1))}…`
}

export function summarizeDataset(dataset = {}) {
  const values = getSeriesValues(dataset)
  return values.reduce((sum, value) => sum + value, 0)
}

export function getChartRows(group = {}, limit = 20) {
  const labels = Array.isArray(group?.labels) ? group.labels : []
  const datasets = Array.isArray(group?.datasets) ? group.datasets : []
  const primaryDataset = datasets[0] ?? {}
  const values = Array.isArray(primaryDataset?.data) ? primaryDataset.data : []
  return labels.slice(0, limit).map((label, index) => ({
    label: String(label ?? `項目 ${index + 1}`),
    value: toFiniteNumber(values[index]),
  }))
}

export function getTrendOccurrenceRows(group = {}, limit = 8) {
  const labels = Array.isArray(group?.labels) ? group.labels : []
  const datasets = Array.isArray(group?.datasets) ? group.datasets : []
  return datasets
    .map((dataset) => {
      const points = (Array.isArray(dataset?.data) ? dataset.data : [])
        .map((value, index) => ({
          date: labels[index] ?? `日付 ${index + 1}`,
          value: toFiniteNumber(value),
        }))
        .filter((point) => point.value != null && point.value > 0)
      const total = points.reduce((sum, point) => sum + point.value, 0)
      return {
        label: String(dataset?.label ?? '検索語'),
        total,
        dates: points.map((point) => `${point.date} (${point.value})`),
      }
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
}
