export default function SourceBadge({ source }) {
  const config = source === 'excel'
    ? { label: 'ATOM月次Excel', icon: 'table_chart' }
    : source === 'ga4'
    ? { label: 'GA4 / BigQuery', icon: 'analytics' }
    : { label: source ?? '複合データ', icon: 'merge_type' }

  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-on-surface-variant border border-outline-variant/30 px-2 py-0.5 rounded uppercase tracking-wider">
      <span className="material-symbols-outlined text-[12px]">{config.icon}</span>
      {config.label}
    </span>
  )
}
