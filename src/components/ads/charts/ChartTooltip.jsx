export default function ChartTooltip({ label = 'ホバー値', value = '-', note = '' }) {
  return (
    <div className="rounded-xl border border-primary/10 bg-white/85 px-4 py-3 shadow-sm backdrop-blur">
      <p className="text-[10px] font-black tracking-[0.12em] text-on-surface-variant">{label}</p>
      <p className="mt-1 text-lg font-black text-primary tabular-nums">{value}</p>
      {note && <p className="mt-1 max-w-[220px] truncate text-[11px] font-bold text-on-surface-variant" title={note}>{note}</p>}
    </div>
  )
}
