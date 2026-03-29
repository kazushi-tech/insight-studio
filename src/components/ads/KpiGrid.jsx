const GRID_COL_MAP = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
}

export default function KpiGrid({ kpis }) {
  if (!Array.isArray(kpis) || kpis.length === 0) return null

  const gridClass = kpis.length >= 4
    ? 'grid-cols-2 lg:grid-cols-4'
    : GRID_COL_MAP[kpis.length] ?? 'grid-cols-2'

  return (
    <div className={`grid gap-4 mb-6 ${gridClass}`}>
      {kpis.map((kpi, index) => (
        <div
          key={`${kpi.label}-${index}`}
          className={`rounded-[0.75rem] p-5 ghost-border ${
            index === 0 ? 'border-l-4 border-gold bg-gold/8' : 'bg-surface-container-lowest'
          }`}
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface-variant truncate">{kpi.label}</p>
          <p className="text-2xl font-extrabold text-on-surface tabular-nums mt-1.5">{kpi.value}</p>
          {kpi.trend && (
            <p className={`text-[10px] font-bold mt-2 flex items-center gap-1 ${
              kpi.tone === 'positive' ? 'text-success' : kpi.tone === 'negative' ? 'text-error' : 'text-on-surface-variant'
            }`}>
              <span className="material-symbols-outlined text-sm">
                {kpi.tone === 'positive' ? 'trending_up' : kpi.tone === 'negative' ? 'trending_down' : 'trending_flat'}
              </span>
              {kpi.trend}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
