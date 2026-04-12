import ChartGroupCard from './ChartGroupCard'
import SourceBadge from './SourceBadge'

function formatKpiValue(key, value) {
  if (typeof value !== 'number') return value
  if (/(ctr|cvr|roas)/i.test(key)) {
    return `${value.toLocaleString('ja-JP', { maximumFractionDigits: 2 })}%`
  }
  if (/(cost|cpa|cpc|revenue)/i.test(key)) {
    return `¥${value.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}`
  }
  return value.toLocaleString('ja-JP', { maximumFractionDigits: 2 })
}

export default function ImportedAdDetails({ excelImport }) {
  if (!excelImport?.chartGroups?.length) return null

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <h3 className="text-lg font-extrabold text-on-surface japanese-text">広告詳細</h3>
        <SourceBadge source="excel" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {excelImport.chartGroups.map((group, idx) => (
          <ChartGroupCard key={`excel-${group.title}-${idx}`} group={group} />
        ))}
      </div>

      {/* KPI summary row */}
      {excelImport.kpis && Object.keys(excelImport.kpis).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {Object.entries(excelImport.kpis).map(([key, value]) => (
            <div key={key} className="bg-surface-container-low p-3 rounded-xl text-center">
              <p className="text-[10px] font-bold text-on-surface-variant uppercase">{key}</p>
              <p className="text-lg font-extrabold text-on-surface tabular-nums">
                {formatKpiValue(key, value)}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
