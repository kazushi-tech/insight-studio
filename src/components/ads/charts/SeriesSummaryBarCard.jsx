import { useMemo } from 'react'
import {
  buildSeries,
  formatMetricValue,
  formatShortDate,
  getLabels,
  getPeakPoint,
  shortenChartLabel,
} from '../../../utils/chartSeriesTransform'
import ChartKpiStrip from './ChartKpiStrip'

const SERIES_COLORS = ['#003925', '#1d5fd1', '#0f766e', '#9b7b3e', '#7b88a8', '#9a6f84', '#4f8a9a', '#8a8f63']

function getLatest(series, labels) {
  for (let index = series.values.length - 1; index >= 0; index -= 1) {
    const value = series.values[index]
    if (value != null) return { value, index, label: labels[index] }
  }
  return null
}

export default function SeriesSummaryBarCard({ group }) {
  const labels = getLabels(group)
  const rows = useMemo(() => {
    return buildSeries(group)
      .sort((a, b) => b.total - a.total)
      .map((series, index) => {
        const latest = getLatest(series, labels)
        const peak = getPeakPoint(series, labels)
        return {
          ...series,
          color: SERIES_COLORS[index % SERIES_COLORS.length],
          latest,
          peak,
          rank: index + 1,
        }
      })
  }, [group, labels])
  const maxTotal = Math.max(...rows.map((row) => row.total), 1)
  const latestLeader = [...rows]
    .filter((row) => row.latest)
    .sort((a, b) => b.latest.value - a.latest.value)[0]
  const kpis = [
    { label: '系列数', value: `${rows.length}系列`, note: '折れ線なし' },
    { label: '最大合計', value: formatMetricValue(rows[0]?.total, rows[0]?.usePercent), note: rows[0] ? shortenChartLabel(rows[0].label, 24) : '-' },
    { label: '最新最大', value: formatMetricValue(latestLeader?.latest?.value, latestLeader?.usePercent), note: latestLeader ? shortenChartLabel(latestLeader.label, 24) : '-' },
    { label: '比較軸', value: '横棒', note: '合計順' },
  ]

  if (!rows.length) return null

  return (
    <div className="space-y-5">
      <ChartKpiStrip items={kpis} />

      <div className="rounded-xl border border-outline-variant/20 bg-white p-4">
        <div className="mb-4">
          <p className="text-[10px] font-black tracking-[0.14em] text-primary">項目別サマリー棒グラフ</p>
          <p className="mt-1 text-sm font-bold text-on-surface-variant japanese-text">
            3系列以上は重ね折れ線を使わず、合計・最新値・最大日を横棒で比較します。
          </p>
        </div>

        <div className="space-y-3">
          {rows.slice(0, 12).map((row) => {
            const width = Math.max(3, (row.total / maxTotal) * 100)
            return (
              <article
                key={row.id}
                data-testid="series-summary-bar-row"
                className="rounded-xl border border-outline-variant/15 bg-[#fbfcf7] p-3"
              >
                <div className="mb-2 grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3">
                  <span className="grid size-8 place-items-center rounded-lg bg-primary text-xs font-black text-on-primary">
                    {row.rank}
                  </span>
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-black text-on-surface" title={row.label}>
                      {shortenChartLabel(row.label, 72)}
                    </h4>
                    <p className="mt-0.5 text-[11px] font-bold text-on-surface-variant">
                      最新 {formatMetricValue(row.latest?.value, row.usePercent)} ({formatShortDate(row.latest?.label)}) / 最大 {formatMetricValue(row.peak?.value, row.usePercent)} ({formatShortDate(row.peak?.label)})
                    </p>
                  </div>
                  <strong className="rounded-full bg-white px-3 py-1 text-xs font-black text-primary shadow-sm tabular-nums">
                    {formatMetricValue(row.total, row.usePercent)}
                  </strong>
                </div>

                <div className="grid grid-cols-[minmax(0,1fr)_72px] items-center gap-3">
                  <div className="h-8 rounded-lg bg-surface-container-low p-1">
                    <div
                      className="h-full rounded-md shadow-sm"
                      style={{ width: `${width}%`, backgroundColor: row.color }}
                    />
                  </div>
                  <span className="text-right text-xs font-black text-on-surface-variant tabular-nums">
                    {width.toFixed(1)}%
                  </span>
                </div>
              </article>
            )
          })}
        </div>
      </div>
    </div>
  )
}
