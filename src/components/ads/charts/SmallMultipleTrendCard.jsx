import { useMemo, useState } from 'react'
import {
  buildSeries,
  buildSvgPath,
  formatMetricValue,
  formatShortDate,
  getSeriesAggregate,
  getLabels,
  getPeakPoint,
  getPointPosition,
  getValueBounds,
  shortenChartLabel,
} from '../../../utils/chartSeriesTransform'
import ChartKpiStrip from './ChartKpiStrip'
import ChartTooltip from './ChartTooltip'

const FRAME = { x: 62, y: 28, width: 616, height: 236 }
const COLORS = ['#003925', '#2563eb', '#b87512', '#b4533c', '#7c3aed', '#0f766e', '#64748b', '#be185d']

function getLatestPoint(series, labels) {
  for (let index = series.values.length - 1; index >= 0; index -= 1) {
    const value = series.values[index]
    if (value != null) return { value, index, label: labels[index] }
  }
  return null
}

function getTickLabels(labels) {
  if (labels.length <= 1) return labels.map((label, index) => ({ label, index }))
  const last = labels.length - 1
  return [
    { label: labels[0], index: 0 },
    { label: labels[Math.round(last / 2)], index: Math.round(last / 2) },
    { label: labels[last], index: last },
  ]
}

export default function SmallMultipleTrendCard({ group }) {
  const labels = getLabels(group)
  const rows = useMemo(
    () =>
      buildSeries(group)
        .sort((a, b) => (getSeriesAggregate(b) ?? 0) - (getSeriesAggregate(a) ?? 0))
        .map((series, index) => ({
          ...series,
          aggregate: getSeriesAggregate(series),
          color: COLORS[index % COLORS.length],
          latest: getLatestPoint(series, labels),
          peak: getPeakPoint(series, labels),
          rank: index + 1,
        })),
    [group, labels],
  )
  const [activeRowId, setActiveRowId] = useState(rows[0]?.id ?? null)
  const [activePoint, setActivePoint] = useState(null)
  const activeRow = rows.find((row) => row.id === activeRowId) ?? rows[0]
  const tickLabels = getTickLabels(labels)
  const bounds = activeRow ? getValueBounds([activeRow]) : { min: 0, max: 1 }
  const path = activeRow ? buildSvgPath(activeRow.values, bounds, FRAME) : ''
  const latestPoint = activeRow?.latest
  const displayPoint = activePoint ?? latestPoint
  const total = rows.reduce((sum, row) => sum + row.total, 0)
  const top = rows[0]
  const isRate = Boolean(top?.usePercent)
  const visibleRateValues = rows.flatMap((row) => row.finiteValues ?? [])
  const visibleAverage = visibleRateValues.length > 0
    ? visibleRateValues.reduce((sum, value) => sum + value, 0) / visibleRateValues.length
    : null
  const latestLeader = [...rows].filter((row) => row.latest).sort((a, b) => b.latest.value - a.latest.value)[0]
  const kpis = isRate
    ? [
        { label: '系列数', value: `${rows.length}系列`, note: '選んで比較' },
        { label: '高い平均', value: formatMetricValue(top?.aggregate, true), note: top ? shortenChartLabel(top.label, 24) : '-' },
        { label: '最新最大', value: formatMetricValue(latestLeader?.latest?.value, true), note: latestLeader ? shortenChartLabel(latestLeader.label, 24) : '-' },
        { label: '表示値の平均', value: formatMetricValue(visibleAverage, true), note: '割合は合計しません' },
      ]
    : [
        { label: '系列数', value: `${rows.length}系列`, note: '選んで比較' },
        { label: '最大合計', value: formatMetricValue(top?.total, false), note: top ? shortenChartLabel(top.label, 24) : '-' },
        { label: '最新最大', value: formatMetricValue(latestLeader?.latest?.value, false), note: latestLeader ? shortenChartLabel(latestLeader.label, 24) : '-' },
        { label: '表示内合計', value: formatMetricValue(total, false), note: `${labels.length}日分` },
      ]

  if (!rows.length) return null

  function selectRow(row) {
    setActiveRowId(row.id)
    setActivePoint(null)
  }

  function showPoint(value, index) {
    if (!activeRow) return
    setActivePoint({
      value,
      index,
      label: labels[index],
    })
  }

  return (
    <div className="space-y-5">
      <ChartKpiStrip items={kpis} />

      <div className="rounded-xl border border-outline-variant/20 bg-white p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black tracking-[0.14em] text-primary">系列フォーカス推移</p>
            <p className="mt-1 text-sm font-bold text-on-surface-variant japanese-text">
              系列を左で選び、右の大きな推移で日別の変化とホバー値を確認します。
            </p>
          </div>
          <ChartTooltip
            label={activeRow ? shortenChartLabel(activeRow.label, 32) : '選択中'}
            value={formatMetricValue(displayPoint?.value, activeRow?.usePercent)}
            note={displayPoint ? `${formatShortDate(displayPoint.label)} / 最大 ${formatMetricValue(activeRow?.peak?.value, activeRow?.usePercent)}` : '点にマウスを置くと表示'}
          />
        </div>

        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" role="list" aria-label={`${group?.title ?? '日別推移'}の系列切替`}>
            {rows.slice(0, 10).map((row) => (
              <button
                key={row.id}
                type="button"
                data-testid="small-multiple-trend-row"
                className={`w-full rounded-xl border px-3 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                  activeRow?.id === row.id
                    ? 'border-primary/25 bg-primary/[0.045] shadow-sm'
                    : 'border-outline-variant/15 bg-[#fbfcf7] hover:border-primary/20 hover:bg-primary/[0.025]'
                }`}
                aria-pressed={activeRow?.id === row.id}
                onClick={() => selectRow(row)}
                onFocus={() => selectRow(row)}
                onMouseEnter={() => selectRow(row)}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg text-[11px] font-black text-white" style={{ backgroundColor: row.color }}>
                    {row.rank}
                  </span>
                  <p className="truncate text-sm font-black text-on-surface" title={row.label}>
                    {shortenChartLabel(row.label, 30)}
                  </p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-white px-2 py-1.5">
                    <p className="text-[9px] font-black tracking-[0.1em] text-on-surface-variant">最新</p>
                    <p className="truncate text-sm font-black text-primary tabular-nums">{formatMetricValue(row.latest?.value, row.usePercent)}</p>
                  </div>
                  <div className="rounded-lg bg-white px-2 py-1.5">
                    <p className="text-[9px] font-black tracking-[0.1em] text-on-surface-variant">{row.usePercent ? '期間平均' : '合計'}</p>
                    <p className="truncate text-sm font-black text-on-surface tabular-nums">{formatMetricValue(row.aggregate, row.usePercent)}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="min-w-0 rounded-xl border border-outline-variant/15 bg-[#fbfcf7] p-4">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-lg font-black text-on-surface" title={activeRow?.label}>
                  {shortenChartLabel(activeRow?.label, 62)}
                </p>
                <p className="mt-1 text-xs font-bold text-on-surface-variant">
                  最新 {formatShortDate(activeRow?.latest?.label)} / 最大 {formatShortDate(activeRow?.peak?.label)}
                </p>
              </div>
              <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:min-w-[260px]">
                <div className="rounded-xl bg-white px-3 py-2 text-right shadow-sm">
                  <p className="text-[10px] font-black tracking-[0.1em] text-on-surface-variant">表示値</p>
                  <p className="text-2xl font-black text-primary tabular-nums">{formatMetricValue(displayPoint?.value, activeRow?.usePercent)}</p>
                </div>
                <div className="rounded-xl bg-white px-3 py-2 text-right shadow-sm">
                  <p className="text-[10px] font-black tracking-[0.1em] text-on-surface-variant">{activeRow?.usePercent ? '期間平均' : '合計'}</p>
                  <p className="text-2xl font-black text-on-surface tabular-nums">{formatMetricValue(activeRow?.aggregate, activeRow?.usePercent)}</p>
                </div>
              </div>
            </div>

            <svg role="img" aria-label={`${activeRow?.label ?? '選択系列'}の大きな推移`} viewBox="0 0 720 340" className="h-[300px] w-full sm:h-[420px]">
              <rect x="0" y="0" width="720" height="340" rx="18" fill="#fffefa" />
              {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                const y = FRAME.y + FRAME.height * ratio
                const value = bounds.max - (bounds.max - bounds.min) * ratio
                return (
                  <g key={ratio}>
                    <line x1={FRAME.x} x2={FRAME.x + FRAME.width} y1={y} y2={y} stroke="#dbe4dd" strokeDasharray="4 8" />
                    <text x="18" y={y + 4} fill="#66736b" fontSize="12" fontWeight="800">
                      {formatMetricValue(value, activeRow?.usePercent)}
                    </text>
                  </g>
                )
              })}
              <path d={path} fill="none" stroke={activeRow?.color ?? '#003925'} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
              {activeRow?.values.map((value, index) => {
                if (value == null) return null
                const point = getPointPosition(value, index, activeRow.values.length, bounds, FRAME)
                const isActive = displayPoint?.index === index
                const isPeak = activeRow.peak?.index === index
                return (
                  <g key={`${activeRow.id}-${index}`}>
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r={isActive || isPeak ? 7 : 4.8}
                      fill={isPeak ? '#d9911f' : activeRow.color}
                      stroke="#fffefa"
                      strokeWidth="2.5"
                      pointerEvents="none"
                    />
                    <circle
                      data-testid="focused-trend-point"
                      cx={point.x}
                      cy={point.y}
                      r="14"
                      fill="transparent"
                      pointerEvents="all"
                      tabIndex={index === activeRow.latest?.index || index === activeRow.peak?.index ? 0 : -1}
                      onFocus={() => showPoint(value, index)}
                      onMouseEnter={() => showPoint(value, index)}
                      onMouseMove={() => showPoint(value, index)}
                      onPointerEnter={() => showPoint(value, index)}
                      onPointerMove={() => showPoint(value, index)}
                    >
                      <title>{`${formatShortDate(labels[index])}: ${formatMetricValue(value, activeRow.usePercent)}`}</title>
                    </circle>
                  </g>
                )
              })}
              {displayPoint && (
                <>
                  {(() => {
                    const point = getPointPosition(displayPoint.value, displayPoint.index, activeRow.values.length, bounds, FRAME)
                    return (
                      <g pointerEvents="none">
                        <line x1={point.x} x2={point.x} y1={FRAME.y} y2={FRAME.y + FRAME.height} stroke={activeRow.color} strokeDasharray="5 7" strokeWidth="1.5" opacity="0.36" />
                        <rect x={Math.min(point.x + 12, 560)} y={Math.max(12, point.y - 74)} width="136" height="62" rx="12" fill="#fffefa" stroke={activeRow.color} strokeOpacity="0.25" />
                        <text x={Math.min(point.x + 26, 574)} y={Math.max(34, point.y - 50)} fill="#425149" fontSize="11" fontWeight="900">
                          {formatShortDate(displayPoint.label)}
                        </text>
                        <text x={Math.min(point.x + 26, 574)} y={Math.max(58, point.y - 26)} fill="#003925" fontSize="20" fontWeight="900">
                          {formatMetricValue(displayPoint.value, activeRow.usePercent)}
                        </text>
                      </g>
                    )
                  })()}
                </>
              )}
              {tickLabels.map((tick) => {
                const x = FRAME.x + (labels.length <= 1 ? FRAME.width / 2 : (tick.index / (labels.length - 1)) * FRAME.width)
                return (
                  <text key={`${activeRow?.id}-${tick.index}`} x={x} y="314" textAnchor="middle" fill="#66736b" fontSize="12" fontWeight="900">
                    {formatShortDate(tick.label)}
                  </text>
                )
              })}
            </svg>
          </div>
        </div>
      </div>
    </div>
  )
}
