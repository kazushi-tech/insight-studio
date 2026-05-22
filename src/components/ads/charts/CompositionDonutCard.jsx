import { useMemo } from 'react'
import {
  formatMetricValue,
  getDatasets,
  getLabels,
  shortenChartLabel,
  toFiniteNumber,
} from '../../../utils/chartSeriesTransform'
import ChartKpiStrip from './ChartKpiStrip'
import ChartLegendList from './ChartLegendList'

const PALETTE = ['#2f66d8', '#f0a313', '#12a87a', '#d34a5f', '#7357c7', '#2f80a7', '#8a6f37', '#7b8a83']
const RADIUS = 84
const STROKE_WIDTH = 34
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function buildRows(group) {
  const labels = getLabels(group)
  const dataset = getDatasets(group)[0] ?? {}
  const values = Array.isArray(dataset.data) ? dataset.data : []
  const usePercent = Boolean(dataset?.isPercent)
  const rows = labels
    .map((label, index) => ({
      label,
      value: toFiniteNumber(values[index]),
      color: PALETTE[index % PALETTE.length],
      usePercent,
    }))
    .filter((row) => row.value != null && row.value >= 0)
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  return rows.map((row) => ({
    ...row,
    share: total > 0 ? row.value / total : 0,
  }))
}

export default function CompositionDonutCard({ group }) {
  const rows = useMemo(() => buildRows(group), [group])
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  const topRows = [...rows].sort((a, b) => b.value - a.value)
  const top = topRows[0]
  const second = topRows[1]
  const averageShare = rows.length > 0 ? 1 / rows.length : null
  const rowsWithOffsets = rows.reduce((acc, row) => {
    const segmentOffset = acc.offset
    const length = Math.max(0, row.share * CIRCUMFERENCE)
    acc.items.push({ ...row, length, segmentOffset })
    acc.offset += length
    return acc
  }, { items: [], offset: 0 }).items

  const kpis = [
    { label: '最大', value: top ? `${Math.round(top.share * 100)}%` : '-', note: top ? shortenChartLabel(top.label, 24) : '-' },
    { label: '第2位', value: second ? `${Math.round(second.share * 100)}%` : '-', note: second ? shortenChartLabel(second.label, 24) : '-' },
    { label: '平均', value: averageShare != null ? `${Math.round(averageShare * 100)}%` : '-', note: `${rows.length}項目` },
  ]

  const legendItems = rows.map((row) => ({
    label: row.label,
    value: row.value,
    usePercent: row.usePercent,
    color: row.color,
    note: `${(row.share * 100).toFixed(1)}%`,
  }))

  if (!rows.length || total <= 0) return null

  return (
    <div className="space-y-5">
      <ChartKpiStrip items={kpis} />

      <div className="rounded-xl border border-outline-variant/20 bg-white p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black tracking-[0.14em] text-primary">構成比の色分け</p>
            <p className="mt-1 text-sm font-bold text-on-surface-variant japanese-text">
              色と項目の対応を下の凡例で固定表示しています。
            </p>
          </div>
          {top && (
            <div className="rounded-xl bg-primary/[0.06] px-4 py-2 text-right">
              <p className="text-[10px] font-black text-primary">最大項目</p>
              <p className="text-sm font-black text-on-surface">{shortenChartLabel(top.label, 28)}</p>
            </div>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1fr)] lg:items-center">
          <svg role="img" aria-label={`${group?.title ?? '構成比グラフ'}の項目別構成比`} viewBox="0 0 360 260" className="h-[300px] w-full">
            <rect x="0" y="0" width="360" height="260" rx="18" fill="#fbfcf7" />
            <g transform="translate(180 122) rotate(-90)">
              <circle r={RADIUS} fill="none" stroke="#e8eee8" strokeWidth={STROKE_WIDTH} />
              {rowsWithOffsets.map((row, index) => {
                return (
                  <circle
                    key={`${row.label}-${index}`}
                    r={RADIUS}
                    fill="none"
                    stroke={row.color}
                    strokeWidth={STROKE_WIDTH}
                    strokeDasharray={`${row.length} ${CIRCUMFERENCE - row.length}`}
                    strokeDashoffset={-row.segmentOffset}
                  >
                    <title>{`${row.label}: ${(row.share * 100).toFixed(1)}% / ${formatMetricValue(row.value, row.usePercent)}`}</title>
                  </circle>
                )
              })}
            </g>
            <circle cx="180" cy="122" r="58" fill="#fbfcf7" />
            <text x="180" y="116" textAnchor="middle" fill="#003925" fontSize="13" fontWeight="900">
              合計
            </text>
            <text x="180" y="140" textAnchor="middle" fill="#003925" fontSize="22" fontWeight="900">
              {formatMetricValue(total, rows[0]?.usePercent)}
            </text>
          </svg>

          <div className="space-y-3">
            {topRows.slice(0, 4).map((row, index) => (
              <div key={`${row.label}-summary`} className="grid grid-cols-[32px_minmax(0,1fr)_72px] items-center gap-3 rounded-xl bg-surface-container-low px-3 py-2">
                <span className="grid size-8 place-items-center rounded-lg text-xs font-black text-on-primary" style={{ backgroundColor: row.color }}>
                  {index + 1}
                </span>
                <p className="truncate text-sm font-black text-on-surface" title={row.label}>
                  {shortenChartLabel(row.label, 42)}
                </p>
                <p className="text-right text-sm font-black text-primary tabular-nums">{(row.share * 100).toFixed(1)}%</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <ChartLegendList items={legendItems} title="項目とカラー" layout="grid" />
    </div>
  )
}
