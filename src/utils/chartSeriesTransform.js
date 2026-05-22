export function toFiniteNumber(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const parsed = Number(String(value).trim().replace(/,/g, '').replace(/[%％]$/, ''))
  return Number.isFinite(parsed) ? parsed : null
}

export function isPercentMetric(text) {
  return /(ctr|cvr|rate|ratio|share|bounce|engagement|pct|percent|割合|率|%|％)/i.test(String(text ?? ''))
}

export function formatMetricValue(value, usePercent = false) {
  const numeric = toFiniteNumber(value)
  if (numeric == null) return '-'
  return `${numeric.toLocaleString('ja-JP', {
    maximumFractionDigits: usePercent ? 2 : 1,
    minimumFractionDigits: 0,
  })}${usePercent ? '%' : ''}`
}

export function formatCompactValue(value) {
  const numeric = toFiniteNumber(value)
  if (numeric == null) return '-'
  const abs = Math.abs(numeric)
  if (abs >= 1000000) return `${(numeric / 1000000).toFixed(1)}M`
  if (abs >= 1000) return `${(numeric / 1000).toFixed(1)}K`
  return numeric.toLocaleString('ja-JP', { maximumFractionDigits: 1 })
}

export function shortenChartLabel(label, maxLength = 34) {
  const text = String(label ?? '').trim()
  if (!text) return '未対応ラベル'
  const withoutProtocol = text.replace(/^https?:\/\//, '')
  if (withoutProtocol.length <= maxLength) return withoutProtocol
  return `${withoutProtocol.slice(0, Math.max(8, maxLength - 1))}…`
}

export function formatShortDate(label) {
  const text = String(label ?? '')
  const match = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (match) return `${Number(match[2])}/${Number(match[3])}`
  const compactMatch = text.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compactMatch) return `${Number(compactMatch[2])}/${Number(compactMatch[3])}`
  return text.length > 8 ? text.slice(5) : text
}

export function getLabels(group = {}) {
  return Array.isArray(group?.labels) ? group.labels.map((label) => String(label ?? '')) : []
}

export function getDatasets(group = {}) {
  return Array.isArray(group?.datasets) ? group.datasets : []
}

export function buildSeries(group = {}) {
  const labels = getLabels(group)
  return getDatasets(group)
    .map((dataset, index) => {
      const label = String(dataset?.label || `系列 ${index + 1}`)
      const usePercent = Boolean(dataset?.isPercent) || isPercentMetric(`${group?.title ?? ''} ${label}`)
      const values = labels.map((_, valueIndex) => toFiniteNumber(dataset?.data?.[valueIndex]))
      const finiteValues = values.filter((value) => value != null)
      const total = finiteValues.reduce((sum, value) => sum + value, 0)
      return {
        id: `${label}-${index}`,
        label,
        usePercent,
        values,
        finiteValues,
        total,
        index,
      }
    })
    .filter((series) => series.finiteValues.length > 0)
}

export function getValueBounds(seriesList = []) {
  const values = seriesList.flatMap((series) => series.values).filter((value) => value != null)
  if (values.length === 0) return { min: 0, max: 1 }
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (min === max) return { min: min - 1, max: max + 1 }
  const pad = Math.max((max - min) * 0.12, 1)
  return { min: Math.min(0, min - pad), max: max + pad }
}

export function getPointPosition(value, index, count, bounds, frame) {
  const x = frame.x + (count <= 1 ? frame.width / 2 : (index / (count - 1)) * frame.width)
  const ratio = bounds.max === bounds.min ? 0.5 : (value - bounds.min) / (bounds.max - bounds.min)
  const y = frame.y + frame.height - ratio * frame.height
  return { x, y }
}

export function buildSvgPath(values = [], bounds, frame) {
  const finiteIndexes = values
    .map((value, index) => ({ value, index }))
    .filter((point) => point.value != null)
  if (finiteIndexes.length === 0) return ''
  return finiteIndexes
    .map((point, pointIndex) => {
      const { x, y } = getPointPosition(point.value, point.index, values.length, bounds, frame)
      return `${pointIndex === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
}

export function getPeakPoint(series, labels) {
  return series.values.reduce((best, value, index) => {
    if (value == null) return best
    if (!best || value > best.value) return { value, index, label: labels[index] }
    return best
  }, null)
}

export function getLatestPoint(series, labels) {
  for (let index = series.values.length - 1; index >= 0; index -= 1) {
    const value = series.values[index]
    if (value != null) return { value, index, label: labels[index] }
  }
  return null
}

export function buildRankingRows(group = {}, limit = 15) {
  const labels = getLabels(group)
  const dataset = getDatasets(group)[0] ?? {}
  const usePercent = Boolean(dataset?.isPercent) || isPercentMetric(`${group?.title ?? ''} ${dataset?.label ?? ''}`)
  const rows = labels
    .map((label, index) => ({
      label,
      value: toFiniteNumber(dataset?.data?.[index]),
      raw: dataset?.data?.[index],
      index,
    }))
    .filter((row) => row.value != null)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
  const max = Math.max(...rows.map((row) => row.value), 1)
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  return rows.map((row, index) => ({
    ...row,
    rank: index + 1,
    share: total > 0 ? row.value / total : 0,
    width: Math.max(4, (row.value / max) * 100),
    usePercent,
  }))
}

export function buildLowSampleRows(group = {}, limit = 12) {
  const labels = getLabels(group)
  return buildSeries(group)
    .map((series) => {
      const points = series.values
        .map((value, index) => ({
          date: labels[index] ?? `日付 ${index + 1}`,
          value,
        }))
        .filter((point) => point.value != null && point.value > 0)
      return {
        label: series.label,
        total: points.reduce((sum, point) => sum + point.value, 0),
        points,
      }
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
}

export function getActualCount(group = {}) {
  const raw =
    group?.actualCount ??
    group?.metadata?.actualCount ??
    String(group?.coverageLabel ?? group?.metadata?.coverageLabel ?? '').match(/上位(\d+)件/)?.[1]
  const count = Number(raw)
  return Number.isFinite(count) ? count : null
}

export function getAllFiniteValues(group = {}) {
  return buildSeries(group).flatMap((series) => series.finiteValues)
}
