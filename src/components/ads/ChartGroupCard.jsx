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

  return `Dataset ${index + 1}`
}

function isPercentLike(label) {
  return /(ctr|cvr|rate|ratio|share|bounce|engagement|pct|percent|割合|率)/i.test(
    String(label ?? ''),
  )
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

function buildPreviewItems(group, effectiveChartType, doughnutUsePercent) {
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
      .slice(0, 3)
    if (segments.length === 0) return []
    return [
      `上位: ${segments.map((s) => `${s.label} ${formatValue(s.value, doughnutUsePercent)}`).join(' / ')}`,
    ]
  }

  if (effectiveChartType === 'bar_horizontal') {
    return datasets.slice(0, 3).flatMap((dataset, index) => {
      const label = getDatasetLabel(dataset, index)
      const usePercent = isPercentLike(label) || Boolean(dataset?.isPercent)
      const values = (Array.isArray(dataset?.data) ? dataset.data : [])
        .map((value, valueIndex) => [valueIndex, normalizeNumericValue(value)])
        .filter(([, value]) => value != null)
        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
        .slice(0, 3)

      if (values.length === 0) return []

      return [
        `${label}: ${values
          .map(([valueIndex, value]) => `${labels[valueIndex] ?? `項目 ${valueIndex + 1}`} ${formatValue(value, usePercent)}`)
          .join(' / ')}`,
      ]
    })
  }

  return datasets.slice(0, 3).flatMap((dataset, index) => {
    const label = getDatasetLabel(dataset, index)
    const usePercent = isPercentLike(label) || Boolean(dataset?.isPercent)
    const values = (Array.isArray(dataset?.data) ? dataset.data : [])
      .map((value, valueIndex) => ({
        index: valueIndex,
        label: labels[valueIndex] ?? `項目 ${valueIndex + 1}`,
        value: normalizeNumericValue(value),
      }))
      .filter((item) => item.value != null)

    if (values.length === 0) return []

    const first = values[0]
    const last = values[values.length - 1]
    const peak = values.reduce((best, current) => (current.value > best.value ? current : best))
    const delta =
      values.length >= 2 && first.value !== 0
        ? ((last.value - first.value) / Math.abs(first.value)) * 100
        : null

    const deltaLabel =
      delta == null
        ? ''
        : ` / 初回比 ${delta >= 0 ? '+' : ''}${delta.toLocaleString('ja-JP', {
            maximumFractionDigits: 1,
          })}%`

    return [
      `${label}: 最新 ${formatValue(last.value, usePercent)} / ピーク ${peak.label} ${formatValue(peak.value, usePercent)}${deltaLabel}`,
    ]
  })
}

function buildChartDatasets(group, effectiveChartType) {
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
      const color = dataset?.borderColor || dataset?.backgroundColor || PALETTE[index % PALETTE.length]
      const data = (Array.isArray(dataset?.data) ? dataset.data : []).map(normalizeNumericValue)
      const common = {
        label,
        data,
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

      const usePercent = isPercentLike(label) || Boolean(dataset?.isPercent)
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
  const previewItems = useMemo(() => buildPreviewItems(group, effectiveChartType, doughnutUsePercent), [group, effectiveChartType, doughnutUsePercent])
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

    const { isDoughnut, isHorizontal, useSinglePointMode, datasets: chartDatasets } = buildChartDatasets(group, effectiveChartType)

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
                  padding: 12,
                  callbacks: {
                    label(context) {
                      const lbl = context.label || ''
                      const val = context.parsed
                      return `${lbl}: ${formatValue(val, doughnutUsePercent)}`
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
                  padding: 12,
                  callbacks: {
                    label(context) {
                      const datasetLabel = context.dataset.label || ''
                      const rawValue = isHorizontal ? context.parsed.x : context.parsed.y
                      const usePercent = isPercentLike(datasetLabel)
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
                  grid: { color: withAlpha(colors.grid, '88') },
                },
                y: {
                  ticks: {
                    color: colors.muted,
                    font: { size: 10 },
                    callback: (value) =>
                      isHorizontal ? chartLabels[value] ?? value : formatAxisValue(value),
                  },
                  grid: { color: withAlpha(colors.grid, '88') },
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
    <article className="bg-surface-container-lowest rounded-[0.75rem] ghost-border p-6 panel-card-hover">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div className="space-y-3 min-w-0">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-on-surface-variant">
              Chart Group
            </p>
            <h3 className="text-lg font-bold text-on-surface japanese-text break-words">
              {group?.title || '無題グラフ'}
            </h3>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-3 py-1 rounded-full bg-primary-container text-on-primary-container font-semibold">
              {CHART_TYPE_LABELS[effectiveChartType] ?? 'Line / Trend'}
            </span>
            {group?._periodTag && (
              <span className="px-3 py-1 rounded-full bg-secondary-container/40 text-on-secondary-container font-semibold">
                {group._periodTag}
              </span>
            )}
            <span className="px-3 py-1 rounded-full bg-surface-container text-on-surface-variant font-semibold">
              {datasets.length} 系列
            </span>
            <span className="px-3 py-1 rounded-full bg-surface-container text-on-surface-variant font-semibold">
              {labels.length} 点
            </span>
          </div>
        </div>
      </div>

      {hasRenderableData ? (
        <div className="space-y-5">
          <div className={effectiveChartType === 'doughnut' ? 'relative h-[300px] max-w-[380px] mx-auto' : 'relative h-[320px] md:h-[360px]'}>
            <canvas ref={canvasRef} />
          </div>

          {previewItems.length > 0 && (
            <div className="grid gap-2">
              {previewItems.map((item, index) => (
                <div
                  key={`${group?.title ?? 'group'}-preview-${index}`}
                  className="rounded-[0.75rem] bg-surface-container-low px-4 py-3 text-xs text-on-surface-variant leading-6"
                >
                  {item}
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
