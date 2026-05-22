import { useMemo, useState } from 'react'
import {
  buildSeries,
  buildSvgPath,
  formatCompactValue,
  formatMetricValue,
  formatShortDate,
  getLabels,
  getPointPosition,
  getValueBounds,
  shortenChartLabel,
} from '../../../utils/chartSeriesTransform'
import ChartKpiStrip from './ChartKpiStrip'
import ChartTooltip from './ChartTooltip'

const FRAME = { x: 46, y: 20, width: 570, height: 230 }
const PRIMARY = '#003925'
const ALERT = '#c83232'

function buildFocusedAreaPath(values = [], bounds, frame) {
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
  const zeroY = getPointPosition(0, 0, 1, bounds, frame).y
  return `${line} L ${lastX.toFixed(1)} ${zeroY.toFixed(1)} L ${firstX.toFixed(1)} ${zeroY.toFixed(1)} Z`
}

export default function AnomalyDetectionCard({ group }) {
  const labels = getLabels(group)
  const seriesList = useMemo(() => buildSeries(group), [group])
  const [selectedId, setSelectedId] = useState(seriesList[0]?.id ?? '')
  const [activePoint, setActivePoint] = useState(null)
  const selected = seriesList.find((series) => series.id === selectedId) ?? seriesList[0]
  const bounds = getValueBounds(selected ? [selected] : [])
  const visibleActivePoint = activePoint?.seriesId === selected?.id ? activePoint : null
  const activeX = visibleActivePoint
    ? getPointPosition(visibleActivePoint.value, visibleActivePoint.index, selected?.values?.length ?? 1, bounds, FRAME).x
    : null
  const events = selected
    ? selected.values
        .map((value, index) => ({ value, index, label: labels[index] }))
        .filter((point) => point.value != null && Math.abs(point.value) >= 2)
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    : []
  const strongest = events[0]

  const kpis = [
    { label: '検知数', value: `${events.length}件`, note: selected ? shortenChartLabel(selected.label, 24) : '-' },
    { label: '最大逸脱日', value: strongest ? formatShortDate(strongest.label) : '-', note: strongest ? formatMetricValue(strongest.value) : '閾値超えなし' },
    { label: '選択指標', value: selected ? shortenChartLabel(selected.label, 20) : '-', note: '1指標フォーカス' },
    { label: '重ね描き', value: 'しない', note: 'チップで切替' },
  ]

  if (!selected) return null

  return (
    <div className="space-y-5">
      <ChartKpiStrip items={kpis} />

      <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-3">
        <div className="flex flex-wrap gap-2">
          {seriesList.map((series) => (
            <button
              key={series.id}
              type="button"
              onClick={() => {
                setSelectedId(series.id)
                setActivePoint(null)
              }}
              className={`rounded-xl px-3 py-2 text-xs font-black transition ${
                selected.id === series.id
                  ? 'bg-primary text-on-primary shadow-sm'
                  : 'border border-outline-variant/20 bg-white text-on-surface hover:border-primary/30'
              }`}
              title={series.label}
            >
              {shortenChartLabel(series.label, 24)}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-outline-variant/20 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black tracking-[0.14em] text-primary">Z-score フォーカスチャート</p>
              <p className="mt-1 text-sm font-bold text-on-surface-variant japanese-text">
                選択中の1指標だけを太い線と面で表示し、点にマウスを置くと日付と値を固定表示します。
              </p>
            </div>
            <ChartTooltip
              label={visibleActivePoint ? formatShortDate(visibleActivePoint.label) : strongest ? formatShortDate(strongest.label) : 'ホバー詳細'}
              value={formatMetricValue(visibleActivePoint?.value ?? strongest?.value)}
              note={visibleActivePoint?.seriesLabel ?? selected.label}
            />
          </div>
          <svg role="img" aria-label="Z-score anomaly focused chart" viewBox="0 0 660 300" className="mt-3 h-[320px] w-full">
            <defs>
              <linearGradient id="anomalyFocusFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={PRIMARY} stopOpacity="0.18" />
                <stop offset="100%" stopColor={PRIMARY} stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <rect x="0" y="0" width="660" height="300" rx="18" fill="#fbfcf7" />
            {[-2, 0, 2].map((threshold) => {
              const y = getPointPosition(threshold, 0, 1, bounds, FRAME).y
              return (
                <g key={threshold}>
                  <line x1={FRAME.x} x2={FRAME.x + FRAME.width} y1={y} y2={y} stroke={threshold === 0 ? '#66736b' : '#d56d6d'} strokeDasharray={threshold === 0 ? '0' : '8 7'} strokeWidth={threshold === 0 ? '1.8' : '1.5'} />
                  <text x="14" y={y + 4} fill={threshold === 0 ? '#66736b' : '#ad3434'} fontSize="12" fontWeight="900">
                    {threshold > 0 ? '+' : ''}{threshold}
                  </text>
                </g>
              )
            })}
            <path d={buildFocusedAreaPath(selected.values, bounds, FRAME)} fill="url(#anomalyFocusFill)" />
            <path d={buildSvgPath(selected.values, bounds, FRAME)} fill="none" stroke={PRIMARY} strokeLinecap="round" strokeLinejoin="round" strokeWidth="6.2" />
            {activeX != null && (
              <line x1={activeX} x2={activeX} y1={FRAME.y} y2={FRAME.y + FRAME.height} stroke={PRIMARY} strokeDasharray="5 7" strokeWidth="1.5" opacity="0.36" />
            )}
            {selected.values.map((value, index) => {
              if (value == null) return null
              const point = getPointPosition(value, index, selected.values.length, bounds, FRAME)
              const anomalous = Math.abs(value) >= 2
              return (
                <g key={`${selected.id}-${index}`}>
                  <circle cx={point.x} cy={point.y} r={anomalous ? 7 : 4.8} fill={anomalous ? ALERT : PRIMARY} stroke="#fbfcf7" strokeWidth="2.2" />
                  <circle
                    data-testid="anomaly-point"
                    cx={point.x}
                    cy={point.y}
                    r="12"
                    fill="transparent"
                    tabIndex={0}
                    onFocus={() => setActivePoint({ ...point, value, index, label: labels[index], seriesLabel: selected.label, seriesId: selected.id })}
                    onMouseEnter={() => setActivePoint({ ...point, value, index, label: labels[index], seriesLabel: selected.label, seriesId: selected.id })}
                    onMouseLeave={() => setActivePoint(null)}
                  >
                    <title>{`${labels[index]} / ${selected.label}: ${formatMetricValue(value)}`}</title>
                  </circle>
                </g>
              )
            })}
            {[0, Math.floor(labels.length / 2), labels.length - 1].filter((value, index, self) => self.indexOf(value) === index).map((index) => {
              const x = FRAME.x + (labels.length <= 1 ? FRAME.width / 2 : (index / (labels.length - 1)) * FRAME.width)
              return (
                <text key={index} x={x} y="278" textAnchor="middle" fill="#66736b" fontSize="12" fontWeight="800">
                  {formatShortDate(labels[index])}
                </text>
              )
            })}
          </svg>
        </div>

        <aside className="rounded-xl border border-amber-200 bg-amber-50/70 p-5">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div>
              <p className="text-[10px] font-black tracking-[0.14em] text-amber-800">主メッセージ</p>
              <h4 className="mt-2 text-lg font-black text-on-surface japanese-text">
                {events.length > 0 ? `${events.length}件の異常候補を検知` : '閾値を超える異常候補はありません'}
              </h4>
              <p className="mt-2 text-sm font-bold leading-7 text-on-surface-variant japanese-text">
                {strongest
                  ? `${formatShortDate(strongest.label)} の ${shortenChartLabel(selected.label, 24)} が最も大きく逸脱しています。`
                  : '現在の指標では ±2 を超えるZ-scoreはありません。'}
              </p>
            </div>
            <p className="rounded-xl bg-surface-container-lowest px-4 py-3 text-xs font-black text-amber-900">
              現在値範囲: {formatCompactValue(bounds.min)} 〜 {formatCompactValue(bounds.max)}
            </p>
          </div>
        </aside>
      </div>

      <div className="overflow-hidden rounded-xl border border-outline-variant/20 bg-white">
        <div className="grid grid-cols-[160px_minmax(220px,1fr)_120px_120px] border-b border-outline-variant/20 bg-[#fbfcf7] px-4 py-3 text-[11px] font-black tracking-[0.08em] text-on-surface-variant">
          <span>日付</span>
          <span>指標</span>
          <span className="text-right">Z-score</span>
          <span className="text-right">判定</span>
        </div>
        {(events.length ? events : [{ label: '-', value: null }]).slice(0, 8).map((event, index) => (
          <div key={`${event.label}-${index}`} className="grid grid-cols-[160px_minmax(220px,1fr)_120px_120px] items-center border-b border-outline-variant/10 px-4 py-3 last:border-b-0">
            <p className="text-sm font-black text-on-surface">{event.label === '-' ? '-' : formatShortDate(event.label)}</p>
            <p className="truncate text-sm font-bold text-on-surface-variant" title={selected.label}>{shortenChartLabel(selected.label, 42)}</p>
            <p className="text-right text-sm font-black text-primary tabular-nums">{formatMetricValue(event.value)}</p>
            <p className="text-right text-[11px] font-black text-error">{event.value == null ? '正常範囲' : '要確認'}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
