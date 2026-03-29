import { useEffect, useMemo, useRef } from 'react'
import Chart from 'chart.js/auto'
import { useTheme } from '../../contexts/ThemeContext'
import { resolveChartPresentation, CHART_TYPE_LABELS } from '../../utils/chartTypeInference'

const PALETTE = [
  '#2563eb',
  '#f59e0b',
  '#10b981',
  '#ef4444',
  '#8b5cf6',
  '#14b8a6',
  '#f97316',
  '#ec4899',
]

function getThemeColor(variableName, fallback) {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim()
  return value || fallback
}

function withAlpha(color, alpha = '33') {
  if (typeof color !== 'string') return color
  if (/^#([0-9a-f]{6})$/i.test(color)) return `${color}${alpha}`
  return color
}

function normalizeNumericValue(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null

  if (typeof value === 'string') {
    const normalized = value.trim().replace(/,/g, '').replace(/[%％]$/, '')
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function getDatasetLabel(dataset, index) {
  if (typeof dataset?.label === 'string' && dataset.label.trim().length > 0) {
    return dataset.label.trim()
  }

  return `系列 ${index + 1}`
}

function isPercentLike(label) {
  return /(ctr|cvr|rate|ratio|share|bounce|engagement|pct|percent|割合|率)/i.test(
    String(label ?? ''),
  )
}

function datasetUsesPercent(dataset, index) {
  return Boolean(dataset?.isPercent) || isPercentLike(getDatasetLabel(dataset, index))
}

function getSeriesPoints(labels, dataset, index) {
  const points = (Array.isArray(dataset?.data) ? dataset.data : [])
    .map((value, valueIndex) => ({
      index: valueIndex,
      label: labels[valueIndex] ?? `項目 ${valueIndex + 1}`,
      value: normalizeNumericValue(value),
    }))
    .filter((point) => point.value != null)

  if (points.length === 0) return null

  return {
    seriesLabel: getDatasetLabel(dataset, index),
    usePercent: datasetUsesPercent(dataset, index),
    points,
  }
}

function formatValue(value, usePercent = false) {
  if (value == null || !Number.isFinite(value)) return '-'

  return `${value.toLocaleString('ja-JP', {
    maximumFractionDigits: usePercent ? 2 : 1,
    minimumFractionDigits: 0,
  })}${usePercent ? '%' : ''}`
}

function formatAxisValue(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return value

  const abs = Math.abs(numeric)
  if (abs >= 1_000_000) return `${(numeric / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(numeric / 1_000).toFixed(1)}K`
  return numeric.toLocaleString('ja-JP')
}

function buildKeyInsights(group, effectiveChartType, doughnutUsePercent) {
  const labels = Array.isArray(group?.labels) ? group.labels : []
  const datasets = Array.isArray(group?.datasets) ? group.datasets : []

  if (effectiveChartType === 'doughnut') {
    const dataset = datasets[0]
    if (!dataset) return []
    const data = (Array.isArray(dataset?.data) ? dataset.data : []).map(normalizeNumericValue)
    const segments = labels
      .map((lbl, i) => ({ label: lbl, value: data[i] }))
      .filter((s) => s.value != null && s.value > 0)
      .sort((a, b) => b.value - a.value)
    if (segments.length === 0) return []

    const total = segments.reduce((sum, s) => sum + s.value, 0)
    const avg = total / segments.length
    const usePercent = doughnutUsePercent || datasetUsesPercent(dataset, 0)
    const insights = []
    if (segments[0]) insights.push({ key: '最大', label: segments[0].label, value: formatValue(segments[0].value, usePercent), tone: 'accent' })
    if (segments[1]) insights.push({ key: '第2位', label: segments[1].label, value: formatValue(segments[1].value, usePercent), tone: 'neutral' })
    insights.push({ key: '平均', label: '平均', value: formatValue(avg, usePercent), tone: 'neutral' })
    return insights.slice(0, 3)
  }

  if (effectiveChartType === 'bar_horizontal') {
    const rankedValues = datasets
      .map((dataset, index) => getSeriesPoints(labels, dataset, index))
      .filter(Boolean)
      .flatMap((series) =>
        series.points.map((point) => ({
          ...point,
          seriesLabel: series.seriesLabel,
          usePercent: series.usePercent,
        })),
      )
      .sort((a, b) => b.value - a.value)

    if (rankedValues.length === 0) return []

    const includeSeriesLabel = datasets.length > 1

    return rankedValues.slice(0, 3).map((v, i) => ({
      key: `上位${i + 1}`,
      label: includeSeriesLabel ? `${v.label} · ${v.seriesLabel}` : v.label,
      value: formatValue(v.value, v.usePercent),
      tone: i === 0 ? 'accent' : 'neutral',
    }))
  }

  const series = datasets
    .map((dataset, index) => getSeriesPoints(labels, dataset, index))
    .filter(Boolean)

  if (series.length === 0) return []

  if (series.length === 1) {
    const [{ points, usePercent }] = series
    const last = points[points.length - 1]
    const peak = points.reduce((best, current) => (current.value > best.value ? current : best))
    const first = points[0]
    const delta = points.length >= 2 && first.value !== 0
      ? ((last.value - first.value) / Math.abs(first.value)) * 100
      : null
    const trendTone = delta == null ? 'neutral' : delta >= 0 ? 'positive' : 'negative'

    const insights = [
      { key: '最新', label: last.label, value: formatValue(last.value, usePercent), tone: 'accent' },
      { key: 'ピーク', label: peak.label, value: formatValue(peak.value, usePercent), tone: 'neutral' },
    ]
    if (delta != null) {
      insights.push({
        key: '推移',
        label: '初回比',
        value: `${delta >= 0 ? '+' : ''}${delta.toLocaleString('ja-JP', { maximumFractionDigits: 1 })}%`,
        tone: trendTone,
      })
    }
    return insights.slice(0, 3)
  }

  const latestWinner = series
    .map((item) => ({
      ...item,
      last: item.points[item.points.length - 1],
    }))
    .reduce((best, current) => (current.last.value > best.last.value ? current : best))

  const peakWinner = series
    .map((item) => ({
      ...item,
      peak: item.points.reduce((best, current) => (current.value > best.value ? current : best)),
    }))
    .reduce((best, current) => (current.peak.value > best.peak.value ? current : best))

  return [
    {
      key: '最新',
      label: `${latestWinner.seriesLabel} · ${latestWinner.last.label}`,
      value: formatValue(latestWinner.last.value, latestWinner.usePercent),
      tone: 'accent',
    },
    {
      key: 'ピーク',
      label: `${peakWinner.seriesLabel} · ${peakWinner.peak.label}`,
      value: formatValue(peakWinner.peak.value, peakWinner.usePercent),
      tone: 'neutral',
    },
    {
      key: '系列',
      label: `${labels.length}点で比較`,
      value: `${series.length}系列`,
      tone: 'neutral',
    },
  ]
}

function buildChartDatasets(group, effectiveChartType, doughnutUsePercent) {
  const labels = Array.isArray(group?.labels) ? group.labels : []
  const datasets = Array.isArray(group?.datasets) ? group.datasets : []
  const isDoughnut = effectiveChartType === 'doughnut'
  const isArea = effectiveChartType === 'area'
  const isHorizontal = effectiveChartType === 'bar_horizontal'
  const isLine = effectiveChartType === 'line'
  const useSinglePointMode = isLine && labels.length === 1
  const useSparseLineMode = isLine && labels.length >= 2 && labels.length <= 3

  if (isDoughnut) {
    const dataset = datasets[0]
    const data = (Array.isArray(dataset?.data) ? dataset.data : []).map(normalizeNumericValue)
    return {
      isDoughnut: true,
      isHorizontal: false,
      useSinglePointMode: false,
      datasets: [
        {
          label: getDatasetLabel(dataset, 0),
          data,
          formatAsPercent: doughnutUsePercent || datasetUsesPercent(dataset, 0),
          backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]),
          borderColor: 'var(--color-surface-container-lowest, #ffffff)',
          borderWidth: 2,
        },
      ],
    }
  }

  return {
    isDoughnut: false,
    isHorizontal,
    useSinglePointMode,
    datasets: datasets.map((dataset, index) => {
      const label = getDatasetLabel(dataset, index)
      const usePercent = datasetUsesPercent(dataset, index)
      const color = dataset?.borderColor || dataset?.backgroundColor || PALETTE[index % PALETTE.length]
      const data = (Array.isArray(dataset?.data) ? dataset.data : []).map(normalizeNumericValue)
      const common = {
        label,
        data,
        formatAsPercent: usePercent,
        borderColor: color,
        spanGaps: true,
      }

      if (isHorizontal) {
        return {
          ...common,
          type: 'bar',
          backgroundColor: dataset?.backgroundColor || withAlpha(color, '66'),
          borderWidth: dataset?.borderWidth ?? 1,
          borderRadius: 8,
          maxBarThickness: 28,
        }
      }

      if (isArea) {
        return {
          ...common,
          type: 'line',
          backgroundColor: withAlpha(color, '22'),
          tension: dataset?.tension ?? 0.3,
          fill: true,
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          pointBackgroundColor: color,
        }
      }

      if (useSinglePointMode) {
        return {
          ...common,
          type: 'bar',
          backgroundColor: dataset?.backgroundColor || withAlpha(color, '88'),
          borderWidth: 2,
          borderRadius: 8,
          maxBarThickness: 72,
        }
      }

      if (useSparseLineMode || isLine) {
        return {
          ...common,
          type: 'line',
          backgroundColor: dataset?.backgroundColor || 'transparent',
          tension: dataset?.tension ?? 0.3,
          fill: Boolean(dataset?.fill),
          borderWidth: useSparseLineMode ? 3 : 2,
          pointRadius: useSparseLineMode ? 4.5 : 3,
          pointHoverRadius: useSparseLineMode ? 6 : 5,
          pointBackgroundColor: color,
        }
      }

      return {
        ...common,
        type: usePercent ? 'bar' : 'line',
        backgroundColor: usePercent ? dataset?.backgroundColor || withAlpha(color, '66') : 'transparent',
        tension: 0.3,
        fill: false,
        borderWidth: usePercent ? 1 : 2,
        pointRadius: usePercent ? 0 : 3,
        pointBackgroundColor: color,
        borderRadius: usePercent ? 8 : 0,
      }
    }),
  }
}

export default function ChartGroupCard({ group }) {
  const { theme } = useTheme()
  const canvasRef = useRef(null)
  const chartRef = useRef(null)
  const labels = Array.isArray(group?.labels) ? group.labels : []
  const datasets = Array.isArray(group?.datasets) ? group.datasets : []
  const presentation = useMemo(() => resolveChartPresentation(group), [group])
  const effectiveChartType = presentation.chartType
  const doughnutUsePercent = presentation.usePercent
  const keyInsights = useMemo(() => buildKeyInsights(group, effectiveChartType, doughnutUsePercent), [group, effectiveChartType, doughnutUsePercent])
  const hasRenderableData = labels.length > 0 && datasets.some((dataset) => Array.isArray(dataset?.data))

  useEffect(() => {
    if (!group || !canvasRef.current || !hasRenderableData) return

    chartRef.current?.destroy()

    const colors = {
      legend: getThemeColor('--color-on-surface', '#191c1d'),
      muted: getThemeColor('--color-on-surface-variant', '#47464c'),
      grid: getThemeColor('--color-outline-variant', '#c8c5cd'),
      surface: getThemeColor('--color-surface-container-lowest', '#ffffff'),
    }
    const chartLabels = Array.isArray(group?.labels) ? group.labels : []

    const { isDoughnut, isHorizontal, useSinglePointMode, datasets: chartDatasets } = buildChartDatasets(group, effectiveChartType, doughnutUsePercent)

    const singlePointLabelPlugin = useSinglePointMode
      ? [
          {
            id: 'singlePointLabel',
            afterDatasetsDraw(chart) {
              const { ctx } = chart

              chart.data.datasets.forEach((dataset, datasetIndex) => {
                const meta = chart.getDatasetMeta(datasetIndex)

                meta.data.forEach((bar, pointIndex) => {
                  const value = dataset.data[pointIndex]
                  if (value == null) return

                  ctx.save()
                  ctx.fillStyle = colors.legend
                  ctx.font = '600 11px Manrope, sans-serif'
                  ctx.textAlign = 'center'
                  ctx.fillText(formatAxisValue(value), bar.x, bar.y - 8)
                  ctx.restore()
                })
              })
            },
          },
        ]
      : []

    chartRef.current = new Chart(canvasRef.current.getContext('2d'), {
      type: isDoughnut ? 'doughnut' : 'bar',
      data: {
        labels: chartLabels,
        datasets: chartDatasets,
      },
      plugins: singlePointLabelPlugin,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        ...(isDoughnut
          ? {
              cutout: '60%',
              plugins: {
                legend: {
                  display: true,
                  position: 'bottom',
                  labels: {
                    color: colors.legend,
                    font: { size: 12, weight: '600' },
                    padding: 14,
                    usePointStyle: true,
                    boxWidth: 10,
                    boxHeight: 10,
                  },
                },
                tooltip: {
                  backgroundColor: colors.surface,
                  titleColor: colors.legend,
                  bodyColor: colors.muted,
                  borderColor: colors.grid,
                  borderWidth: 1,
                  cornerRadius: 12,
                  padding: 12,
                  callbacks: {
                    label(context) {
                      const lbl = context.label || ''
                      const val = context.parsed
                      const usePercent = Boolean(context.dataset.formatAsPercent)
                      return `${lbl}: ${formatValue(val, usePercent)}`
                    },
                  },
                },
              },
            }
          : {
              indexAxis: isHorizontal ? 'y' : 'x',
              interaction: {
                mode: 'index',
                intersect: false,
              },
              plugins: {
                legend: {
                  display: true,
                  position: 'bottom',
                  labels: {
                    color: colors.legend,
                    font: { size: 12, weight: '600' },
                    padding: 14,
                    usePointStyle: true,
                    boxWidth: 10,
                    boxHeight: 10,
                  },
                },
                tooltip: {
                  backgroundColor: colors.surface,
                  titleColor: colors.legend,
                  bodyColor: colors.muted,
                  borderColor: colors.grid,
                  borderWidth: 1,
                  cornerRadius: 12,
                  padding: 12,
                  callbacks: {
                    label(context) {
                      const datasetLabel = context.dataset.label || ''
                      const rawValue = isHorizontal ? context.parsed.x : context.parsed.y
                      const usePercent = Boolean(context.dataset.formatAsPercent)
                      return `${datasetLabel}: ${formatValue(rawValue, usePercent)}`
                    },
                  },
                },
              },
              scales: {
                x: {
                  ticks: {
                    color: colors.muted,
                    font: { size: 10 },
                    maxRotation: isHorizontal ? 0 : 40,
                    minRotation: 0,
                  },
                  grid: { color: withAlpha(colors.grid, '44') },
                },
                y: {
                  ticks: {
                    color: colors.muted,
                    font: { size: 10 },
                    callback: (value) =>
                      isHorizontal ? chartLabels[value] ?? value : formatAxisValue(value),
                  },
                  grid: { color: withAlpha(colors.grid, '44') },
                },
              },
            }),
      },
    })

    return () => {
      chartRef.current?.destroy()
      chartRef.current = null
    }
  }, [group, effectiveChartType, doughnutUsePercent, hasRenderableData, theme])

  return (
    <article className="bg-surface-container-lowest rounded-[0.75rem] border border-outline-variant/10 p-8 shadow-sm hover:shadow-[0_10px_30px_rgba(25,28,29,0.06)] transition-all flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div className="space-y-2 min-w-0">
          <h3 className="text-lg font-bold text-on-surface japanese-text break-words">
            {group?.title || '無題グラフ'}
          </h3>
          <div className="flex flex-wrap gap-2">
            <span className="bg-secondary-fixed text-on-secondary-fixed text-[10px] px-2 py-0.5 rounded font-bold uppercase">
              {CHART_TYPE_LABELS[effectiveChartType] ?? '推移'}
            </span>
            {group?._periodTag && (
              <span className="text-on-surface-variant text-[10px] font-medium border border-outline-variant/20 px-2 py-0.5 rounded">
                {group._periodTag}
              </span>
            )}
            <span className="text-on-surface-variant text-[10px] font-medium border border-outline-variant/20 px-2 py-0.5 rounded">
              {datasets.length} 系列
            </span>
            <span className="text-on-surface-variant text-[10px] font-medium border border-outline-variant/20 px-2 py-0.5 rounded">
              {labels.length} 点
            </span>
          </div>
        </div>
      </div>

      {hasRenderableData ? (
        <div className="flex-1 flex flex-col">
          <div className={`mb-8 ${effectiveChartType === 'doughnut'
            ? 'relative h-[300px] max-w-[380px] mx-auto'
            : 'relative h-[280px] bg-surface-container-low/30 rounded-[0.75rem] p-4'
          }`}>
            <canvas ref={canvasRef} />
          </div>

          {keyInsights.length > 0 && (
            <div className="grid grid-cols-3 gap-4 pt-6 border-t border-outline-variant/10">
              {keyInsights.map((insight, index) => (
                <div
                  key={`${group?.title ?? 'group'}-insight-${index}`}
                  className="bg-surface-container-low p-3 rounded-lg"
                >
                  <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">{insight.key}</p>
                  <p className={`text-sm font-extrabold tabular-nums ${
                    insight.tone === 'positive' ? 'text-success'
                      : insight.tone === 'negative' ? 'text-error'
                      : insight.tone === 'accent' ? 'text-on-surface'
                      : 'text-on-surface'
                  }`}>{insight.value}</p>
                  <p className="text-[10px] text-on-surface-variant mt-0.5 truncate">{insight.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-[0.75rem] border border-dashed border-outline-variant/50 bg-surface-container-low px-5 py-8 text-center text-sm text-on-surface-variant">
          このグラフグループには描画できるデータ系列がありません。
        </div>
      )}
    </article>
  )
}
