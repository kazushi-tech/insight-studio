export default function ChartKpiStrip({ items = [] }) {
  if (!items.length) return null

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-primary/10 bg-surface-container-low px-4 py-3">
          <p className="text-[10px] font-black tracking-[0.12em] text-on-surface-variant">{item.label}</p>
          <p className="mt-1 truncate text-xl font-black text-primary tabular-nums" title={item.value}>
            {item.value}
          </p>
          {item.note && <p className="mt-1 truncate text-[11px] font-bold text-on-surface-variant" title={item.note}>{item.note}</p>}
        </div>
      ))}
    </div>
  )
}
