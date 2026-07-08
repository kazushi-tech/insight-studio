import {
  formatMetricValue,
  getDatasets,
  getLabels,
  getAllFiniteValues,
  shortenChartLabel,
  toFiniteNumber,
} from '../../../utils/chartSeriesTransform'
import ChartKpiStrip from './ChartKpiStrip'

function buildRows(group) {
  if (Array.isArray(group?.rows) && group.rows.length > 0) {
    return group.rows.map((row, index) => ({
      label: row.label ?? row.lp ?? row.pagePath ?? `LP ${index + 1}`,
      sessions: toFiniteNumber(row.sessions),
      bounceSessions: toFiniteNumber(row.bounceSessions ?? row.bounce_sessions),
      bounceRate: toFiniteNumber(row.bounceRate ?? row.bounce_rate),
    }))
  }

  const labels = getLabels(group)
  const dataset = getDatasets(group)[0] ?? {}
  return labels.map((label, index) => ({
    label,
    sessions: null,
    bounceSessions: null,
    bounceRate: toFiniteNumber(dataset?.data?.[index]),
  }))
}

export default function FlatMetricDiagnosticCard({ group }) {
  const values = getAllFiniteValues(group)
  const min = values.length ? Math.min(...values) : null
  const max = values.length ? Math.max(...values) : null
  const rows = buildRows(group)
  const rate = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  const variance = min != null && max != null ? max - min : null
  const kpis = [
    { label: '比較LP数', value: `${rows.length}件`, note: '比較対象' },
    { label: '直帰率', value: formatMetricValue(rate, true), note: '全LP同一' },
    { label: '分散', value: formatMetricValue(variance), note: '差がない状態' },
    { label: '比較有用性', value: '低い', note: '棒グラフ非表示' },
  ]

  return (
    <div className="space-y-5">
      <ChartKpiStrip items={kpis} />

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-5">
          <p className="text-[10px] font-black tracking-[0.14em] text-amber-800">診断完了</p>
          <h4 className="mt-2 text-lg font-black text-on-surface japanese-text">ランディングページ比較（直帰率）</h4>
          <p className="mt-2 text-sm font-bold leading-7 text-on-surface japanese-text">
            すべてのLPが同じ直帰率のため、順位や棒グラフで比較しても改善優先度は読み取れません。
          </p>
          <p className="mt-3 text-sm font-black text-amber-900">比較有用性: 低い</p>
          <span className="mt-3 inline-flex rounded-full bg-white/70 px-3 py-1 text-[11px] font-black text-amber-900">
            比較差なし
          </span>
        </div>

        <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-5">
          <p className="text-[10px] font-black tracking-[0.14em] text-primary">次に見ること</p>
          <p className="mt-2 text-sm font-black text-primary">平均ページ/セッション</p>
          <ul className="mt-3 space-y-2 text-sm font-bold leading-6 text-on-surface-variant japanese-text">
            <li>計測設定で session_start / bounce 判定が固定化していないか確認。</li>
            <li>平均ページ/セッションや engagement time など、差が出る補助指標を見る。</li>
            <li>LP別のセッション数が少ない場合は期間を延ばして再取得する。</li>
          </ul>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-outline-variant/20 bg-white">
        <div className="grid min-w-[760px] grid-cols-[minmax(240px,1fr)_110px_130px_110px_110px] border-b border-outline-variant/20 bg-[#fbfcf7] px-4 py-3 text-[11px] font-black tracking-[0.08em] text-on-surface-variant sm:grid-cols-[minmax(280px,1fr)_120px_140px_120px_120px]">
          <span>LP</span>
          <span className="text-right">sessions</span>
          <span className="text-right">bounce sessions</span>
          <span className="text-right">bounce rate</span>
          <span className="text-right">status</span>
        </div>
        {rows.slice(0, 15).map((row, index) => (
          <div key={`${row.label}-${index}`} className="grid min-w-[760px] grid-cols-[minmax(240px,1fr)_110px_130px_110px_110px] items-center border-b border-outline-variant/10 px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(280px,1fr)_120px_140px_120px_120px]">
            <p className="truncate text-sm font-black text-on-surface" title={row.label}>{shortenChartLabel(row.label, 66)}</p>
            <p className="text-right text-xs font-bold tabular-nums text-on-surface-variant">{formatMetricValue(row.sessions)}</p>
            <p className="text-right text-xs font-bold tabular-nums text-on-surface-variant">{formatMetricValue(row.bounceSessions)}</p>
            <p className="text-right text-xs font-black tabular-nums text-primary">{formatMetricValue(row.bounceRate, true)}</p>
            <p className="text-right text-[11px] font-black text-amber-800">同一値</p>
          </div>
        ))}
      </div>
    </div>
  )
}
