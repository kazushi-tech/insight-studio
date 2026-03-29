export default function KpiGrid({ kpis }) {
  if (!Array.isArray(kpis) || kpis.length === 0) return null

  return (
    <div className={`grid gap-3 mb-5 ${kpis.length >= 4 ? 'grid-cols-2 lg:grid-cols-4' : `grid-cols-${kpis.length}`}`}>
      {kpis.map((kpi, index) => (
        <div
          key={`${kpi.label}-${index}`}
          className={`rounded-[0.75rem] px-4 py-3 ${
            index === 0 ? 'border-l-4 border-gold bg-gold/8' : 'border-l-4 border-outline-variant/20 bg-surface-container-low'
          }`}
        >
          <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant truncate">{kpi.label}</p>
          <p className="text-2xl font-extrabold text-on-surface tabular-nums mt-1">{kpi.value}</p>
          {kpi.trend && (
            <p className={`text-xs font-semibold mt-1 flex items-center gap-1 ${
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
