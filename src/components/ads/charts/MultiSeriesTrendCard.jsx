import { useMemo, useState } from 'react'
import {
  buildSeries,
  buildSvgPath,
  formatCompactValue,
  formatMetricValue,
  formatShortDate,
  getLabels,
  getPeakPoint,
  getPointPosition,
  getValueBounds,
  shortenChartLabel,
} from '../../../utils/chartSeriesTransform'
import ChartKpiStrip from './ChartKpiStrip'
import ChartLegendList from './ChartLegendList'

const FRAME = { x: 46, y: 20, width: 570, height: 250 }
const PRIMARY = '#003925'
const COMPARISON = '#1d5fd1'
const SERIES_COLORS = [
  PRIMARY,
  COMPARISON,
  '#6f8f83',
  '#9b7b3e',
  '#7b88a8',
  '#9a6f84',
  '#4f8a9a',
  '#8a8f63',
]

function buildAreaPath(values = [], bounds, frame) {
  const finiteIndexes = values
    .map((value, index) => ({ value, index }))
    .filter((point) => point.value != null)
  if (finiteIndexes.length === 0) return ''

  const first = finiteIndexes[0]
  const last = finiteIndexes[finiteIndexes.length - 1]
  const line = finiteIndexes
    .map((point, pointIndex) => {
      const { x, y } = getPointPosition(point.value, point.index, values.length, bounds, frame)
      return `${pointIndex === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
  const firstX = getPointPosition(first.value, first.index, values.length, bounds, frame).x
  const lastX = getPointPosition(last.value, last.index, values.length, bounds, frame).x
  const baseline = frame.y + frame.height
  return `${line} L ${lastX.toFixed(1)} ${baseline.toFixed(1)} L ${firstX.toFixed(1)} ${baseline.toFixed(1)} Z`
}

function getTickIndexes(length) {
  if (length <= 1) return [0]
  if (length <= 6) return Array.from({ length }, (_, index) => index)
  const last = length - 1
  return [...new Set([0, Math.round(last * 0.25), Math.round(last * 0.5), Math.round(last * 0.75), last])].sort((a, b) => a - b)
}

function truncateSvgText(text, maxLength = 22) {
  const value = String(text ?? '')
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1)}…`
}

export default function MultiSeriesTrendCard({ group }) {
  const labels = getLabels(group)
  const [activePoint, setActivePoint] = useState(null)
  const allSeries = useMemo(
    () => buildSeries(group).sort((a, b) => b.total - a.total),
    [group],
  )
  const seriesKey = allSeries.map((series) => series.id).join('|')
  const defaultHiddenSeriesIds = new Set(allSeries.slice(3).map((series) => series.id))
  const [hiddenState, setHiddenState] = useState(() => ({
    seriesKey,
    ids: defaultHiddenSeriesIds,
  }))
  const hiddenSeriesIds = hiddenState.seriesKey === seriesKey ? hiddenState.ids : defaultHiddenSeriesIds
  const rankedSeries = useMemo(() => {
    const visible = allSeries.filter((series) => !hiddenSeriesIds.has(series.id))
    return visible.length > 0 ? visible : allSeries.slice(0, 1)
  }, [allSeries, hiddenSeriesIds])
  const primary = rankedSeries[0]
  const bounds = getValueBounds(rankedSeries)
  const peak = primary ? getPeakPoint(primary, labels) : null
  const tickIndexes = getTickIndexes(labels.length)
  const primaryTotal = primary?.total ?? null
  const allTotal = rankedSeries.reduce((sum, series) => sum + series.total, 0)
  const average = rankedSeries.length > 0 ? allTotal / rankedSeries.length : null
  const visibleActivePoint = activePoint?.seriesKey === seriesKey ? activePoint : null
  const activeX = visibleActivePoint?.x ?? null

  if (!primary) return null

  function getSeriesVisual(series) {
    const index = Math.max(0, allSeries.findIndex((item) => item.id === series.id))
    if (index === 0) return { color: PRIMARY, width: 6.2, opacity: 1, dash: '', pointRadius: 4.9, priority: 3 }
    if (index === 1) return { color: COMPARISON, width: 4.2, opacity: 0.9, dash: '', pointRadius: 4.3, priority: 2 }
    return { color: SERIES_COLORS[index % SERIES_COLORS.length], width: 2.8, opacity: 0.74, dash: '', pointRadius: 3.3, priority: 1 }
  }

  function toggleSeries(item) {
    setHiddenState((prev) => {
      const currentHiddenIds = prev.seriesKey === seriesKey ? prev.ids : defaultHiddenSeriesIds
      const next = new Set(currentHiddenIds)
      if (next.has(item.id)) {
        next.delete(item.id)
      } else {
        const visibleCount = allSeries.filter((series) => !next.has(series.id)).length
        if (visibleCount <= 1) return prev
        next.add(item.id)
      }
      setActivePoint(null)
      return { seriesKey, ids: next }
    })
  }

  function showPointTooltip(series, value, index) {
    const point = getPointPosition(value, index, series.values.length, bounds, FRAME)
    const visual = getSeriesVisual(series)
    setActivePoint({
      ...point,
      value,
      index,
      label: labels[index],
      seriesLabel: series.label,
      seriesKey,
      usePercent: series.usePercent,
      color: visual.color,
    })
  }

  function getTooltipFrame(point) {
    const width = 164
    const height = 58
    const x = Math.max(54, Math.min(point.x + 12, 650 - width))
    const y = Math.max(8, point.y - height - 12)
    return { x, y, width, height }
  }

  const kpis = [
    { label: '合計値', value: formatMetricValue(allTotal, primary?.usePercent), note: `${rankedSeries.length}系列` },
    { label: '主系列', value: formatMetricValue(primaryTotal, primary?.usePercent), note: primary ? shortenChartLabel(primary.label, 26) : '-' },
    { label: '系列平均', value: formatMetricValue(average, primary?.usePercent), note: '表示系列あたり' },
    { label: '最大日', value: peak ? formatMetricValue(peak.value, primary?.usePercent) : '-', note: peak ? formatShortDate(peak.label) : '-' },
  ]

  const legendItems = allSeries.slice(0, 8).map((series, index) => ({
    id: series.id,
    label: series.label,
    value: series.total,
    usePercent: series.usePercent,
    color: SERIES_COLORS[index % SERIES_COLORS.length],
    lineStyle: index >= 2 ? 'muted' : 'solid',
    note: index === 0 ? '主系列を強調' : index === 1 ? '比較系列' : '文脈線',
    disabled: hiddenSeriesIds.has(series.id),
  }))

  const seriesForRender = [...rankedSeries].sort((a, b) => getSeriesVisual(a).priority - getSeriesVisual(b).priority)
  const activeTooltipFrame = visibleActivePoint ? getTooltipFrame(visibleActivePoint) : null

  function renderPrimaryArea() {
    const originalPrimary = allSeries[0]
    if (!originalPrimary || hiddenSeriesIds.has(originalPrimary.id)) return null
    return <path d={buildAreaPath(originalPrimary.values, bounds, FRAME)} fill="url(#trendPrimaryFill)" />
  }

  function renderPaths() {
    return seriesForRender.map((series) => {
      const visual = getSeriesVisual(series)
      return (
        <path
          key={series.id}
          d={buildSvgPath(series.values, bounds, FRAME)}
          fill="none"
          stroke={visual.color}
          strokeWidth={visual.width}
          strokeDasharray={visual.dash}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={visual.opacity}
        />
      )
    })
  }

  function renderSeriesPoints(series) {
    const visual = getSeriesVisual(series)
    return series.values.map((value, index) => {
      if (value == null) return null
      const point = getPointPosition(value, index, series.values.length, bounds, FRAME)
      const isPeak = series.id === primary.id && peak?.index === index
      const fill = isPeak ? '#d9911f' : visual.color
      return (
        <g key={`${series.id}-${index}`}>
          <circle
            cx={point.x}
            cy={point.y}
            r={isPeak ? 6.6 : visual.pointRadius}
            stroke="#fbfcf7"
            strokeWidth="2"
            fill={fill}
            opacity={visual.opacity}
            pointerEvents="none"
          />
          <circle
            data-testid="trend-point"
            cx={point.x}
            cy={point.y}
            r="10"
            fill="transparent"
            tabIndex={0}
            onFocus={() => showPointTooltip(series, value, index)}
            onMouseEnter={() => showPointTooltip(series, value, index)}
            onMouseLeave={() => setActivePoint(null)}
          >
            <title>{`${labels[index]} / ${series.label}: ${formatMetricValue(value, series.usePercent)}`}</title>
          </circle>
        </g>
      )
    })
  }

  function renderPoints() {
    return seriesForRender.map((series) => (
      <g key={`${series.id}-points`}>{renderSeriesPoints(series)}</g>
    ))
  }

  function renderTooltip() {
    if (!visibleActivePoint || !activeTooltipFrame) return null
    return (
      <g pointerEvents="none">
        <line
          x1={visibleActivePoint.x}
          x2={activeTooltipFrame.x}
          y1={visibleActivePoint.y}
          y2={activeTooltipFrame.y + activeTooltipFrame.height / 2}
          stroke={visibleActivePoint.color}
          strokeWidth="1.3"
          opacity="0.55"
        />
        <rect
          x={activeTooltipFrame.x}
          y={activeTooltipFrame.y}
          width={activeTooltipFrame.width}
          height={activeTooltipFrame.height}
          rx="12"
          fill="#fffefa"
          stroke={visibleActivePoint.color}
          strokeOpacity="0.24"
          filter="drop-shadow(0 8px 14px rgba(0, 57, 37, 0.14))"
        />
        <circle cx={activeTooltipFrame.x + 14} cy={activeTooltipFrame.y + 17} r="4" fill={visibleActivePoint.color} />
        <text x={activeTooltipFrame.x + 24} y={activeTooltipFrame.y + 20} fill="#425149" fontSize="11" fontWeight="900">
          {formatShortDate(visibleActivePoint.label)}
        </text>
        <text x={activeTooltipFrame.x + 14} y={activeTooltipFrame.y + 41} fill="#003925" fontSize="18" fontWeight="900">
          {formatMetricValue(visibleActivePoint.value, visibleActivePoint.usePercent)}
        </text>
        <text x={activeTooltipFrame.x + 72} y={activeTooltipFrame.y + 41} fill="#425149" fontSize="10" fontWeight="800">
          {truncateSvgText(shortenChartLabel(visibleActivePoint.seriesLabel, 26), 18)}
        </text>
      </g>
    )
  }

  return (
    <div className="space-y-5">
      <ChartKpiStrip items={kpis} />

      <div className="space-y-4">
        <div className="rounded-xl border border-outline-variant/20 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black tracking-[0.14em] text-primary">主線 + 比較線 + 文脈線</p>
              <p className="mt-1 text-sm font-bold text-on-surface-variant japanese-text">
                初期表示は上位3系列までに絞り、4系列目以降は凡例クリックで追加できます。
              </p>
            </div>
            <p className="rounded-xl border border-primary/10 bg-white/85 px-4 py-3 text-xs font-black text-on-surface-variant shadow-sm">
              凡例クリックで系列を非表示
            </p>
          </div>

          <svg role="img" aria-label={`${group?.title ?? 'グラフ'}の読みやすい推移`} viewBox="0 0 660 330" className="h-[380px] w-full">
            <defs>
              <linearGradient id="trendPrimaryFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={PRIMARY} stopOpacity="0.22" />
                <stop offset="70%" stopColor={PRIMARY} stopOpacity="0.07" />
                <stop offset="100%" stopColor={PRIMARY} stopOpacity="0" />
              </linearGradient>
            </defs>
            <rect x="0" y="0" width="660" height="330" rx="18" fill="#fbfcf7" />
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
              const y = FRAME.y + FRAME.height * ratio
              const value = bounds.max - (bounds.max - bounds.min) * ratio
              return (
                <g key={ratio}>
                  <line x1={FRAME.x} x2={FRAME.x + FRAME.width} y1={y} y2={y} stroke="#ccd8d0" strokeDasharray="4 8" strokeWidth="1.2" />
                  <text x="12" y={y + 4} fill="#66736b" fontSize="12" fontWeight="700">
                    {formatCompactValue(value)}
                  </text>
                </g>
              )
            })}

            {renderPrimaryArea()}
            {renderPaths()}
            {activeX != null && (
              <line x1={activeX} x2={activeX} y1={FRAME.y} y2={FRAME.y + FRAME.height} stroke="#003925" strokeDasharray="5 7" strokeWidth="1.4" opacity="0.28" />
            )}
            {renderPoints()}
            {renderTooltip()}

            {tickIndexes.map((index) => {
              const x = FRAME.x + (labels.length <= 1 ? FRAME.width / 2 : (index / (labels.length - 1)) * FRAME.width)
              return (
                <text key={`${labels[index]}-${index}`} x={x} y="308" textAnchor="middle" fill="#66736b" fontSize="12" fontWeight="800">
                  {formatShortDate(labels[index])}
                </text>
              )
            })}
          </svg>
        </div>

        <ChartLegendList items={legendItems} title="凡例 / 読みどころ" layout="grid" onToggleItem={toggleSeries} />
      </div>

      <details className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-4">
        <summary className="cursor-pointer text-sm font-black text-primary japanese-text">日別値テーブルを開く</summary>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-outline-variant/20 text-left text-[11px] font-black tracking-[0.08em] text-on-surface-variant">
                <th className="px-3 py-2">系列</th>
                {labels.map((label) => <th key={label} className="px-3 py-2 text-right">{formatShortDate(label)}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {rankedSeries.slice(0, 6).map((series) => (
                <tr key={series.id}>
                  <td className="max-w-[220px] truncate px-3 py-2 text-xs font-black text-on-surface" title={series.label}>{shortenChartLabel(series.label, 34)}</td>
                  {series.values.map((value, index) => (
                    <td key={`${series.id}-${index}`} className="px-3 py-2 text-right text-xs font-bold tabular-nums text-on-surface-variant">
                      {formatMetricValue(value, series.usePercent)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
