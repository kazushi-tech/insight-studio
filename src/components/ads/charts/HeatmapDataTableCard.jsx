import {
  buildSeries,
  formatMetricValue,
  formatShortDate,
  getLabels,
  shortenChartLabel,
} from '../../../utils/chartSeriesTransform'
import ChartKpiStrip from './ChartKpiStrip'

function getLatestLabel(labels) {
  for (let index = labels.length - 1; index >= 0; index -= 1) {
    if (labels[index]) return formatShortDate(labels[index])
  }
  return '-'
}

function getPeriodLabel(labels) {
  if (!labels.length) return '-'
  const first = formatShortDate(labels[0])
  const latest = getLatestLabel(labels)
  return first === latest ? first : `${first} - ${latest}`
}

function getMaxValue(seriesList) {
  const values = seriesList.flatMap((series) => series.finiteValues)
  return values.length ? Math.max(...values) : null
}

function getCellStyle(value, maxValue) {
  if (value == null || maxValue == null || maxValue <= 0) return undefined
  const width = Math.max(5, Math.min(100, (value / maxValue) * 100))
  return {
    background: `linear-gradient(90deg, rgba(0, 57, 37, 0.18) ${width}%, rgba(255, 255, 255, 0) ${width}%)`,
  }
}

export default function HeatmapDataTableCard({ group }) {
  const labels = getLabels(group)
  const series = buildSeries(group)
  const maxValue = getMaxValue(series)
  const columnMaxValues = series.map((item) => (item.finiteValues.length ? Math.max(...item.finiteValues) : null))
  const rowCount = labels.length
  const kpis = [
    { label: '行数', value: `${rowCount}行`, note: '日付 / 項目' },
    { label: '系列数', value: `${series.length}系列`, note: '列で比較' },
    { label: '最大値', value: formatMetricValue(maxValue), note: '全セル内' },
    { label: '対象期間', value: getPeriodLabel(labels), note: `最新 ${getLatestLabel(labels)}` },
  ]

  if (!labels.length || !series.length) return null

  return (
    <div className="space-y-5">
      <ChartKpiStrip items={kpis} />

      <div className="rounded-xl border border-outline-variant/20 bg-white p-4">
        <div className="mb-4">
          <p className="text-[10px] font-black tracking-[0.14em] text-primary">データテーブル</p>
          <p className="mt-1 text-sm font-bold text-on-surface-variant japanese-text">
            日付や項目が多いため、グラフではなく色付きテーブルで値の大小を確認します。
          </p>
        </div>

        <div className="max-h-[560px] overflow-auto rounded-xl border border-outline-variant/20 bg-[#fbfcf7]">
          <table className="min-w-full border-separate border-spacing-0 text-sm" aria-label={`${group?.title ?? 'グラフ'}のデータテーブル`}>
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 min-w-32 border-b border-outline-variant/20 bg-[#f4f7ec] px-4 py-3 text-left text-[11px] font-black tracking-[0.08em] text-on-surface-variant">
                  日付 / 項目
                </th>
                {series.map((item) => (
                  <th
                    key={item.id}
                    className="sticky top-0 z-10 min-w-36 border-b border-outline-variant/20 bg-[#f4f7ec] px-4 py-3 text-right text-[11px] font-black tracking-[0.08em] text-on-surface-variant"
                    title={item.label}
                  >
                    {shortenChartLabel(item.label, 24)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {labels.map((label, rowIndex) => (
                <tr key={`${label}-${rowIndex}`} className="group">
                  <th
                    className="sticky left-0 z-10 max-w-56 border-b border-outline-variant/10 bg-[#fbfcf7] px-4 py-2.5 text-left text-xs font-black text-on-surface group-hover:bg-primary/[0.04]"
                    title={label}
                  >
                    {formatShortDate(shortenChartLabel(label, 34))}
                  </th>
                  {series.map((item, seriesIndex) => {
                    const value = item.values[rowIndex]
                    return (
                      <td
                        key={`${item.id}-${rowIndex}`}
                        data-testid="heatmap-data-cell"
                        className="border-b border-outline-variant/10 bg-white px-4 py-2.5 text-right font-black tabular-nums text-on-surface group-hover:bg-primary/[0.035]"
                        style={getCellStyle(value, columnMaxValues[seriesIndex])}
                      >
                        {formatMetricValue(value, item.usePercent)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
