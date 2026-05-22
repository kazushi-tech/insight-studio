import { formatMetricValue, shortenChartLabel } from '../../../utils/chartSeriesTransform'

function LegendMarker({ item }) {
  if (item.lineStyle) {
    return (
      <span className="flex w-10 shrink-0 items-center" aria-hidden="true">
        <span
          className={`h-1 w-full rounded-full ${item.lineStyle === 'dashed' ? 'border-t-4 border-dashed bg-transparent' : ''}`}
          style={{
            backgroundColor: item.lineStyle === 'dashed' ? 'transparent' : item.color ?? '#003925',
            borderColor: item.color ?? '#003925',
            opacity: item.lineStyle === 'muted' ? 0.75 : 1,
          }}
        />
      </span>
    )
  }

  return <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: item.color ?? '#003925' }} aria-hidden="true" />
}

export default function ChartLegendList({ items = [], title = '読み分け', layout = 'stack', onToggleItem = null }) {
  if (!items.length) return null
  const listClass =
    layout === 'grid'
      ? 'mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3'
      : 'mt-3 space-y-2'

  return (
    <aside className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-4">
      <p className="text-[10px] font-black tracking-[0.14em] text-on-surface-variant">{title}</p>
      <div className={listClass}>
        {items.map((item, index) => {
          const interactive = typeof onToggleItem === 'function'
          const className = `flex min-w-0 items-center gap-3 rounded-lg bg-surface-container-lowest px-3 py-2 text-left transition ${
            item.disabled ? 'opacity-45 grayscale' : ''
          } ${interactive ? 'cursor-pointer hover:bg-primary/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30' : ''}`
          const content = (
            <>
            <LegendMarker item={item} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-black text-on-surface" title={item.label}>
                {shortenChartLabel(item.label, layout === 'grid' ? 42 : 30)}
              </p>
              {item.note && <p className="truncate text-[10px] font-bold text-on-surface-variant">{item.disabled ? '非表示中' : item.note}</p>}
            </div>
            <span className="shrink-0 text-xs font-black text-primary tabular-nums">
              {formatMetricValue(item.value, item.usePercent)}
            </span>
            </>
          )
          if (interactive) {
            return (
              <button
                key={`${item.label}-${index}`}
                type="button"
                className={className}
                aria-pressed={!item.disabled}
                onClick={() => onToggleItem(item)}
              >
                {content}
              </button>
            )
          }
          return <div key={`${item.label}-${index}`} className={className}>{content}</div>
        })}
      </div>
    </aside>
  )
}
