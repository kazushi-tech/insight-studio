import { buildLowSampleRows, formatMetricValue, formatShortDate, getActualCount, getLabels, shortenChartLabel } from '../../../utils/chartSeriesTransform'

export default function LowSampleSearchCard({ group }) {
  const rows = buildLowSampleRows(group)
  const labels = getLabels(group)
  const actualCount = getActualCount(group) ?? rows.reduce((sum, row) => sum + row.total, 0)

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-5">
        <p className="text-[10px] font-black tracking-[0.14em] text-amber-800">低サンプル検索クエリ</p>
        <h4 className="mt-2 text-xl font-black text-on-surface japanese-text">この期間の検索イベントは{formatMetricValue(actualCount)}件です</h4>
        <p className="mt-2 text-sm font-bold leading-7 text-on-surface-variant japanese-text">
          トレンドを強く断定せず、発生日・語句・raw count をそのまま確認します。
        </p>
      </div>

      <div className="rounded-xl border border-outline-variant/20 bg-white p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-black tracking-[0.14em] text-primary">発生日の点表示</p>
            <p className="mt-1 text-sm font-bold text-on-surface-variant">日付別に発生有無だけを薄く確認します。</p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="rounded-xl border border-primary/15 bg-primary/[0.06] px-4 py-2 text-xs font-black text-primary">
              期間を延ばす
            </button>
            <button type="button" className="rounded-xl border border-outline-variant/25 bg-surface-container-low px-4 py-2 text-xs font-black text-on-surface">
              raw data 表示
            </button>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl border border-outline-variant/15 bg-surface-container-low p-3">
          <div className="flex min-w-[640px] items-end gap-2">
            {labels.map((label, index) => {
              const count = rows.reduce((sum, row) => sum + row.points.filter((point) => point.date === label).reduce((s, point) => s + point.value, 0), 0)
              return (
                <div key={`${label}-${index}`} className="flex min-w-9 flex-col items-center gap-2">
                  <div className={`size-3 rounded-full ${count > 0 ? 'bg-primary' : 'bg-outline-variant/35'}`} title={`${label}: ${count}件`} />
                  <span className="text-[10px] font-black text-on-surface-variant">{formatShortDate(label)}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-outline-variant/20 bg-white">
        <div className="grid grid-cols-[minmax(220px,1fr)_120px_minmax(280px,1.2fr)] border-b border-outline-variant/20 bg-[#fbfcf7] px-4 py-3 text-[11px] font-black tracking-[0.08em] text-on-surface-variant">
          <span>検索語</span>
          <span className="text-right">raw count 表示</span>
          <span>発生日</span>
        </div>
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[minmax(220px,1fr)_120px_minmax(280px,1.2fr)] items-center border-b border-outline-variant/10 px-4 py-3 last:border-b-0">
            <p className="truncate text-sm font-black text-on-surface" title={row.label}>{shortenChartLabel(row.label, 48)}</p>
            <p className="text-right text-sm font-black text-primary tabular-nums">{formatMetricValue(row.total)}</p>
            <div className="flex flex-wrap gap-2">
              {row.points.map((point) => (
                <span key={`${row.label}-${point.date}`} className="rounded-lg bg-primary/[0.07] px-2 py-1 text-[11px] font-black text-primary">
                  {formatShortDate(point.date)} ({formatMetricValue(point.value)})
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
