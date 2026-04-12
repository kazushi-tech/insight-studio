import ChartGroupCard from './ChartGroupCard'
import SourceBadge from './SourceBadge'

export default function ImportedAdDetails({ excelImport }) {
  if (!excelImport?.chartGroups?.length) return null

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <h3 className="text-lg font-extrabold text-on-surface japanese-text">\u5e83\u544a\u8a73\u7d30</h3>
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
                {typeof value === 'number'
                  ? /(ctr|cvr|roas)/i.test(key)
                    ? `${value.toLocaleString('ja-JP', { maximumFractionDigits: 2 })}%`
                    : value.toLocaleString('ja-JP')
                  : value}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
