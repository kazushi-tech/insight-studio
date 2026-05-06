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

function getChartAccent(group, effectiveChartType) {
  const title = String(group?.title ?? '')
  if (effectiveChartType === 'doughnut') {
    return { icon: 'donut_large', label: '構成比', tone: 'from-emerald-50 to-teal-50' }
  }
  if (effectiveChartType === 'bar_horizontal') {
    return { icon: 'leaderboard', label: '順位比較', tone: 'from-lime-50 to-emerald-50' }
  }
  if (/異常|alert|anomaly|急変|変化/i.test(title)) {
    return { icon: 'emergency_home', label: '異常検知', tone: 'from-amber-50 to-orange-50' }
  }
  if (/流入|channel|source|referral/i.test(title)) {
    return { icon: 'conversion_path', label: '流入経路', tone: 'from-cyan-50 to-emerald-50' }
  }
  if (/LP|ページ|page/i.test(title)) {
    return { icon: 'web_asset', label: 'LP行動', tone: 'from-slate-50 to-emerald-50' }
  }
  return { icon: 'monitoring', label: '時系列', tone: 'from-emerald-50 to-white' }
}

function getChartScaleSummary(labels, datasets) {
  const values = datasets
    .flatMap((dataset) => (Array.isArray(dataset?.data) ? dataset.data : []))
    .map(normalizeNumericValue)
    .filter((value) => value != null)

  if (values.length === 0) {
    return { min: '-', max: '-', range: '-', count: labels.length }
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  return {
    min: formatAxisValue(min),
    max: formatAxisValue(max),
    range: formatAxisValue(max - min),
    count: labels.length,
  }
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
      pointBorderColor: '#ffffff',
      pointBorderWidth: 2,
      pointHitRadius: 10,
      spanGaps: true,
    }

      if (isHorizontal) {
        return {
          ...common,
          type: 'bar',
          backgroundColor: dataset?.backgroundColor || withAlpha(color, '66'),
          borderWidth: dataset?.borderWidth ?? 1,
          borderRadius: 12,
          borderSkipped: false,
          maxBarThickness: 34,
        }
      }

      if (isArea) {
        return {
          ...common,
          type: 'line',
          backgroundColor: withAlpha(color, '22'),
          tension: dataset?.tension ?? 0.3,
          fill: true,
          borderWidth: 3,
          pointRadius: 4,
          pointHoverRadius: 7,
          pointBackgroundColor: color,
        }
      }

      if (useSinglePointMode) {
        return {
          ...common,
          type: 'bar',
          backgroundColor: dataset?.backgroundColor || withAlpha(color, '88'),
          borderWidth: 0,
          borderRadius: 14,
          borderSkipped: false,
          maxBarThickness: 72,
        }
      }

      if (useSparseLineMode || isLine) {
        return {
          ...common,
          type: 'line',
          backgroundColor: dataset?.backgroundColor || 'transparent',
          tension: dataset?.tension ?? 0.3,
          fill: index === 0 || Boolean(dataset?.fill),
          borderWidth: useSparseLineMode ? 4 : 3,
          pointRadius: useSparseLineMode ? 5.5 : 4,
          pointHoverRadius: useSparseLineMode ? 8 : 7,
          pointBackgroundColor: color,
        }
      }

      return {
        ...common,
        type: usePercent ? 'bar' : 'line',
        backgroundColor: usePercent ? dataset?.backgroundColor || withAlpha(color, '66') : withAlpha(color, '14'),
        tension: 0.3,
        fill: !usePercent && index === 0,
        borderWidth: usePercent ? 0 : 3,
        pointRadius: usePercent ? 0 : 4,
        pointBackgroundColor: color,
        borderRadius: usePercent ? 12 : 0,
        borderSkipped: false,
      }
    }),
  }
}

export default function ChartGroupCard({ group, featured = false }) {
  const { theme } = useTheme()
  const canvasRef = useRef(null)
  const chartRef = useRef(null)
  const labels = useMemo(() => (Array.isArray(group?.labels) ? group.labels : []), [group])
  const datasets = useMemo(() => (Array.isArray(group?.datasets) ? group.datasets : []), [group])
  const presentation = useMemo(() => resolveChartPresentation(group), [group])
  const effectiveChartType = presentation.chartType
  const doughnutUsePercent = presentation.usePercent
  const keyInsights = useMemo(() => buildKeyInsights(group, effectiveChartType, doughnutUsePercent), [group, effectiveChartType, doughnutUsePercent])
  const accent = useMemo(() => getChartAccent(group, effectiveChartType), [group, effectiveChartType])
  const scaleSummary = useMemo(() => getChartScaleSummary(labels, datasets), [labels, datasets])
  const hasRenderableData = labels.length > 0 && datasets.some((dataset) => Array.isArray(dataset?.data))

  useEffect(() => {
    if (!group || !canvasRef.current || !hasRenderableData) return

    chartRef.current?.destroy()

    const colors = {
      legend: getThemeColor('--color-on-surface', '#191c1d'),
      muted: getThemeColor('--color-on-surface-variant', '#47464c'),
      grid: getThemeColor('--color-outline-variant', '#c8c5cd'),
      surface: getThemeColor('--color-surface-container-lowest', '#ffffff'),
      primary: getThemeColor('--color-primary', '#003925'),
      primarySoft: getThemeColor('--color-primary-container', '#d7f5df'),
    }
    const chartLabels = Array.isArray(group?.labels) ? group.labels : []

    const { isDoughnut, isHorizontal, useSinglePointMode, datasets: chartDatasets } = buildChartDatasets(group, effectiveChartType, doughnutUsePercent)
    const ctx = canvasRef.current.getContext('2d')
    const chartGradient = ctx.createLinearGradient(0, 0, 0, featured ? 340 : 280)
    chartGradient.addColorStop(0, withAlpha(colors.primary, '28'))
    chartGradient.addColorStop(1, withAlpha(colors.primary, '03'))
    const styledDatasets = chartDatasets.map((dataset, index) => ({
      ...dataset,
      borderColor: index === 0 && !isDoughnut ? colors.primary : dataset.borderColor,
      backgroundColor:
        !isDoughnut && dataset.type === 'line' && dataset.fill
          ? chartGradient
          : dataset.backgroundColor,
      borderDash: !isDoughnut && dataset.type === 'line' && index > 2 ? [6, 5] : dataset.borderDash,
    }))

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

    const plotSurfacePlugin = {
      id: 'plotSurface',
      beforeDraw(chart) {
        const { ctx: drawCtx, chartArea } = chart
        if (!chartArea) return

        drawCtx.save()
        drawCtx.fillStyle = isDoughnut ? withAlpha(colors.primarySoft, '44') : '#f8fbf6'
        drawCtx.strokeStyle = withAlpha(colors.primary, '22')
        drawCtx.lineWidth = 1
        const radius = 18
        const x = chartArea.left - 10
        const y = chartArea.top - 12
        const w = chartArea.right - chartArea.left + 20
        const h = chartArea.bottom - chartArea.top + 24
        drawCtx.beginPath()
        drawCtx.moveTo(x + radius, y)
        drawCtx.lineTo(x + w - radius, y)
        drawCtx.quadraticCurveTo(x + w, y, x + w, y + radius)
        drawCtx.lineTo(x + w, y + h - radius)
        drawCtx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
        drawCtx.lineTo(x + radius, y + h)
        drawCtx.quadraticCurveTo(x, y + h, x, y + h - radius)
        drawCtx.lineTo(x, y + radius)
        drawCtx.quadraticCurveTo(x, y, x + radius, y)
        drawCtx.closePath()
        drawCtx.fill()
        drawCtx.stroke()
        drawCtx.restore()
      },
      afterDatasetsDraw(chart) {
        if (isDoughnut) return
        const { ctx: drawCtx } = chart
        drawCtx.save()
        drawCtx.font = '800 10px Manrope, sans-serif'
        drawCtx.textBaseline = 'middle'

        chart.data.datasets.slice(0, 3).forEach((dataset, datasetIndex) => {
          const meta = chart.getDatasetMeta(datasetIndex)
          if (meta.hidden || !meta.data?.length) return

          const lastIndex = [...dataset.data].map((value, index) => ({ value, index })).reverse().find((item) => item.value != null)?.index
          if (lastIndex == null) return

          const element = meta.data[lastIndex]
          const value = dataset.data[lastIndex]
          const label = formatAxisValue(value)
          drawCtx.fillStyle = dataset.borderColor || colors.primary

          if (isHorizontal) {
            drawCtx.textAlign = 'left'
            drawCtx.fillText(label, element.x + 8, element.y)
          } else {
            drawCtx.textAlign = 'left'
            drawCtx.fillText(label, Math.min(element.x + 8, chart.chartArea.right - 34), element.y - 10)
          }
        })
        drawCtx.restore()
      },
    }

    chartRef.current = new Chart(ctx, {
      type: isDoughnut ? 'doughnut' : 'bar',
      data: {
        labels: chartLabels,
        datasets: styledDatasets,
      },
      plugins: [plotSurfacePlugin, ...singlePointLabelPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        ...(isDoughnut
          ? {
              cutout: '60%',
              layout: { padding: 14 },
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
                    borderRadius: 999,
                  },
                },
                tooltip: {
                  backgroundColor: '#053c2a',
                  titleColor: colors.legend,
                  bodyColor: '#f8fff7',
                  borderColor: withAlpha(colors.primary, '55'),
                  borderWidth: 1,
                  cornerRadius: 14,
                  padding: 14,
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
              layout: { padding: { top: 18, right: 18, bottom: 6, left: 6 } },
              plugins: {
                legend: {
                  display: true,
                  position: 'bottom',
                  labels: {
                    color: colors.legend,
                    font: { size: 12, weight: '800' },
                    padding: 18,
                    usePointStyle: true,
                    boxWidth: 12,
                    boxHeight: 12,
                    borderRadius: 999,
                  },
                },
                tooltip: {
                  backgroundColor: '#053c2a',
                  titleColor: '#f8fff7',
                  bodyColor: '#d7f5df',
                  borderColor: withAlpha(colors.primary, '55'),
                  borderWidth: 1,
                  cornerRadius: 14,
                  padding: 14,
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
                    font: { size: 10, weight: '700' },
                    maxRotation: isHorizontal ? 0 : 45,
                    minRotation: 0,
                  },
                  grid: { color: withAlpha(colors.grid, '35'), drawTicks: false },
                  border: { color: withAlpha(colors.primary, '22') },
                },
                y: {
                  ticks: {
                    color: colors.muted,
                    font: { size: 10, weight: '700' },
                    callback: (value) =>
                      isHorizontal ? chartLabels[value] ?? value : formatAxisValue(value),
                  },
                  grid: { color: withAlpha(colors.grid, '35'), drawTicks: false },
                  border: { color: withAlpha(colors.primary, '22') },
                },
              },
            }),
      },
    })

    return () => {
      chartRef.current?.destroy()
      chartRef.current = null
    }
  }, [group, effectiveChartType, doughnutUsePercent, hasRenderableData, theme, featured])

  return (
    <article className={`group relative overflow-hidden rounded-[1.35rem] border shadow-[0_18px_45px_rgba(0,57,37,0.08)] transition-all hover:-translate-y-0.5 hover:shadow-[0_26px_60px_rgba(0,57,37,0.14)] flex flex-col bg-gradient-to-br ${accent.tone} ${
      featured ? 'border-primary/30 ring-1 ring-primary/10' : 'border-primary/15'
    }`}>
      <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-primary via-emerald-500 to-accent-gold" />
      <div className="p-6 pb-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2 min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-black tracking-[0.16em] uppercase text-primary">
            <span className="material-symbols-outlined text-base" aria-hidden="true">{accent.icon}</span>
            {accent.label} Graph
          </div>
          <h3 className={`${featured ? 'text-2xl' : 'text-xl'} font-black leading-tight text-primary japanese-text break-words`}>
            {group?.title || '無題グラフ'}
          </h3>
          <div className="flex flex-wrap gap-2">
            <span className="bg-primary text-on-primary text-[10px] px-2.5 py-1 rounded-full font-black uppercase">
              {CHART_TYPE_LABELS[effectiveChartType] ?? '推移'}
            </span>
            {group?._periodTag && (
              <span className="text-primary text-[10px] font-black bg-surface-container-lowest/80 border border-primary/15 px-2.5 py-1 rounded-full">
                {group._periodTag}
              </span>
            )}
            <span className="text-on-surface-variant text-[10px] font-bold bg-surface-container-lowest/70 border border-outline-variant/15 px-2.5 py-1 rounded-full">
              {datasets.length} 系列
            </span>
            <span className="text-on-surface-variant text-[10px] font-bold bg-surface-container-lowest/70 border border-outline-variant/15 px-2.5 py-1 rounded-full">
              {labels.length} 点
            </span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 rounded-2xl border border-primary/10 bg-surface-container-lowest/80 p-2 text-center">
          {[
            ['MAX', scaleSummary.max],
            ['MIN', scaleSummary.min],
            ['RANGE', scaleSummary.range],
          ].map(([label, value]) => (
            <div key={label} className="min-w-14 rounded-xl bg-primary/[0.055] px-2 py-2">
              <p className="text-[9px] font-black tracking-[0.12em] text-on-surface-variant">{label}</p>
              <p className="mt-1 text-xs font-black tabular-nums text-primary">{value}</p>
            </div>
          ))}
        </div>
      </div>
      </div>

      {hasRenderableData ? (
        <div className="flex-1 flex flex-col px-6 pb-6">
          <div className={`relative overflow-hidden border border-primary/15 bg-surface-container-lowest/85 shadow-inner ${effectiveChartType === 'doughnut'
            ? `${featured ? 'h-[360px]' : 'h-[320px]'} rounded-[1.1rem] px-4 py-5`
            : `${featured ? 'h-[380px]' : 'h-[320px]'} rounded-[1.1rem] p-5`
          }`}>
            <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-full bg-primary/[0.08] px-3 py-1 text-[10px] font-black tracking-[0.14em] text-primary">
              PYTHON PLOT CANVAS
            </div>
            <canvas ref={canvasRef} />
          </div>

          {keyInsights.length > 0 && (
            <div className="mt-5 grid grid-cols-3 gap-3">
              {keyInsights.map((insight, index) => (
                <div
                  key={`${group?.title ?? 'group'}-insight-${index}`}
                  className={`rounded-2xl border p-4 ${
                    index === 0
                      ? 'border-primary/20 bg-primary text-on-primary'
                      : 'border-primary/10 bg-surface-container-lowest/80 text-on-surface'
                  }`}
                >
                  <p className={`text-[10px] font-black uppercase tracking-wider mb-1 ${index === 0 ? 'text-on-primary/75' : 'text-on-surface-variant'}`}>{insight.key}</p>
                  <p className={`text-sm font-extrabold tabular-nums ${
                    index === 0 ? 'text-on-primary'
                      : insight.tone === 'positive' ? 'text-success'
                        : insight.tone === 'negative' ? 'text-error'
                          : 'text-primary'
                  }`}>{insight.value}</p>
                  <p className={`text-[10px] mt-0.5 truncate ${index === 0 ? 'text-on-primary/70' : 'text-on-surface-variant'}`}>{insight.label}</p>
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
