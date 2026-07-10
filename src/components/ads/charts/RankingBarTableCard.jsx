import { useState } from 'react'
import { buildRankingRows, formatMetricValue, shortenChartLabel } from '../../../utils/chartSeriesTransform'
import ChartKpiStrip from './ChartKpiStrip'
import ChartTooltip from './ChartTooltip'

const BAR_COLORS = ['#003925', '#2563eb', '#b87512', '#b4533c', '#7c3aed', '#0f766e', '#64748b']

export default function RankingBarTableCard({ group }) {
  const rows = buildRankingRows(group, 15)
  const [activeRank, setActiveRank] = useState(rows[0]?.rank ?? null)
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  const top = rows[0]
  const isRate = Boolean(top?.usePercent)
  const average = rows.length > 0 ? total / rows.length : null
  const minimum = rows.length > 0 ? Math.min(...rows.map((row) => row.value)) : null
  const activeRow = rows.find((row) => row.rank === activeRank) ?? top
  const kpis = isRate
    ? [
        { label: '表示件数', value: `${rows.length}件`, note: '高い順に表示' },
        { label: '高い値', value: formatMetricValue(top?.value, true), note: top ? shortenChartLabel(top.label, 24) : '-' },
        { label: '平均', value: formatMetricValue(average, true), note: '表示項目の平均' },
        { label: '値の範囲', value: `${formatMetricValue(minimum, true)}〜${formatMetricValue(top?.value, true)}`, note: '合計はしません' },
      ]
    : [
        { label: '表示件数', value: `${rows.length}件`, note: '上位15件まで' },
        { label: 'トップ値', value: formatMetricValue(top?.value, false), note: top ? shortenChartLabel(top.label, 24) : '-' },
        { label: '表示内合計', value: formatMetricValue(total, false), note: '表示行だけの合算' },
        { label: '表示内シェア', value: top && total > 0 ? `${((top.value / total) * 100).toFixed(1)}%` : '-', note: '全体比ではありません' },
      ]

  return (
    <div className="space-y-5">
      <ChartKpiStrip items={kpis} />

      <div className="rounded-xl border border-outline-variant/20 bg-white p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black tracking-[0.14em] text-primary">横棒比較</p>
            <p className="mt-1 text-sm font-bold text-on-surface-variant japanese-text">
              {isRate
                ? '割合は合計せず、値の高い順と平均を同じ画面で確認します。'
                : 'ラベルと値を同じ行にまとめ、シェアは表示中の項目内で計算しています。'}
            </p>
          </div>
          <ChartTooltip
            label={activeRow ? shortenChartLabel(activeRow.label, 42) : 'ホバー詳細'}
            value={formatMetricValue(activeRow?.value, activeRow?.usePercent)}
            note={activeRow
              ? isRate
                ? `${activeRow.rank}位 / 表示項目の平均 ${formatMetricValue(average, true)}`
                : `${activeRow.rank}位 / 表示内シェア ${(activeRow.share * 100).toFixed(1)}%`
              : '行にマウスを置くと表示'}
          />
        </div>

        <div className="space-y-2" role="list" aria-label={`${group?.title ?? 'ランキング'}の横棒比較`}>
          {rows.map((row) => (
            <div
              key={`${row.label}-${row.rank}`}
              role="listitem"
              tabIndex={0}
              data-testid="ranking-bar-row"
              className={`group w-full rounded-xl border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                activeRow?.rank === row.rank
                  ? 'border-primary/25 bg-primary/[0.045] shadow-sm'
                  : 'border-outline-variant/15 bg-[#fbfcf7] hover:border-primary/20 hover:bg-primary/[0.025]'
              }`}
              aria-label={isRate
                ? `${row.rank}位 ${row.label} ${formatMetricValue(row.value, true)}`
                : `${row.rank}位 ${row.label} ${formatMetricValue(row.value, false)} 表示内シェア ${(row.share * 100).toFixed(1)}%`}
              onFocus={() => setActiveRank(row.rank)}
              onMouseEnter={() => setActiveRank(row.rank)}
            >
              <div className="mb-2 grid grid-cols-[32px_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[40px_minmax(0,1fr)_auto] sm:gap-3">
                <span className={`grid size-8 place-items-center rounded-lg text-xs font-black ${row.rank <= 3 ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-on-surface-variant'}`}>
                  {row.rank}
                </span>
                <span className="min-w-0 truncate text-sm font-black text-on-surface">
                  {shortenChartLabel(row.label, 78)}
                </span>
                <span className="col-span-2 justify-self-start rounded-full bg-white px-3 py-1 text-xs font-black tabular-nums text-primary shadow-sm sm:col-span-1 sm:justify-self-auto">
                  {formatMetricValue(row.value, row.usePercent)}
                </span>
              </div>

              <div className="grid grid-cols-[minmax(0,1fr)_72px] items-center gap-3">
                <div className="h-8 rounded-lg bg-surface-container-low p-1">
                  <div
                    className="flex h-full min-w-8 items-center justify-end rounded-md pr-2 text-[11px] font-black text-white shadow-sm transition-all"
                    style={{
                      width: `${row.width}%`,
                      backgroundColor: BAR_COLORS[Math.min(row.rank - 1, BAR_COLORS.length - 1)],
                    }}
                  >
                    {row.width >= 22 ? (isRate ? formatMetricValue(row.value, true) : `${(row.share * 100).toFixed(1)}%`) : ''}
                  </div>
                </div>
                <div
                  className={`text-right text-xs font-black tabular-nums ${activeRow?.rank === row.rank ? 'text-primary' : 'text-on-surface-variant'}`}
                >
                  {isRate ? formatMetricValue(row.value, true) : `${(row.share * 100).toFixed(1)}%`}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
