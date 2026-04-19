/**
 * InsightSummaryHero — Phase 3 Stitch 2.0 summary card rendered at the top of
 * each AI insight turn. Consumes the parsed `insight-meta` JSON block emitted
 * by the backend at the end of a response.
 *
 * Returns null when the meta is missing or all three lists are empty.
 * Fully backwards-compatible: if the backend stops emitting meta, this
 * component silently renders nothing.
 */
export default function InsightSummaryHero({ meta, onChartChipClick }) {
  if (!meta) return null
  const tldr = Array.isArray(meta.tldr) ? meta.tldr : []
  const key_metrics = Array.isArray(meta.key_metrics) ? meta.key_metrics : []
  const recommended_charts = Array.isArray(meta.recommended_charts)
    ? meta.recommended_charts
    : []

  if (tldr.length === 0 && key_metrics.length === 0 && recommended_charts.length === 0) {
    return null
  }

  return (
    <section
      className="rounded-2xl bg-primary/5 border border-primary/10 p-6 mb-6 md-v2-enter"
      data-testid="insight-summary-hero"
    >
      <header className="flex items-center gap-2 mb-3">
        <span className="material-symbols-outlined text-primary" aria-hidden="true">
          auto_awesome
        </span>
        <p className="text-[11px] font-bold tracking-[0.18em] uppercase text-primary/70">
          考察サマリー
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6">
        {tldr.length > 0 && (
          <div>
            <ul className="space-y-2" data-testid="insight-summary-tldr">
              {tldr.map((line, idx) => (
                <li
                  key={`tldr-${idx}`}
                  className="flex gap-2 text-base text-on-surface"
                >
                  <span
                    className="material-symbols-outlined text-primary text-base mt-1"
                    aria-hidden="true"
                  >
                    arrow_right
                  </span>
                  <span className="japanese-text">{line}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {key_metrics.length > 0 && (
          <div
            className="grid grid-cols-2 gap-2"
            data-testid="insight-summary-metrics"
          >
            {key_metrics.map((m, idx) => (
              <div
                key={`metric-${idx}`}
                className="rounded-xl bg-surface-container-lowest p-3 border border-outline-variant/15"
              >
                <p className="text-[11px] font-bold text-on-surface-variant tracking-wider uppercase mb-1">
                  {m.label}
                </p>
                <div className="flex items-baseline gap-1.5">
                  <p className="text-xl font-bold text-on-surface font-mono">
                    {m.value}
                  </p>
                  {m.delta === 'up' && (
                    <span
                      className="material-symbols-outlined text-emerald-600 text-base"
                      data-testid="metric-delta-up"
                      aria-label="上昇"
                    >
                      trending_up
                    </span>
                  )}
                  {m.delta === 'down' && (
                    <span
                      className="material-symbols-outlined text-red-600 text-base"
                      data-testid="metric-delta-down"
                      aria-label="下降"
                    >
                      trending_down
                    </span>
                  )}
                  {m.delta === 'flat' && (
                    <span
                      className="material-symbols-outlined text-on-surface-variant text-base"
                      data-testid="metric-delta-flat"
                      aria-label="横ばい"
                    >
                      trending_flat
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {recommended_charts.length > 0 && (
        <div
          className="mt-4 pt-4 border-t border-primary/10 flex flex-wrap gap-2"
          data-testid="insight-summary-chart-chips"
        >
          <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mr-2 self-center">
            推奨グラフ
          </span>
          {recommended_charts.map((c, idx) => (
            <button
              key={`chart-${idx}`}
              type="button"
              onClick={() => onChartChipClick?.(c)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container-lowest border border-outline-variant/20 hover:border-primary/40 transition-colors text-xs font-bold text-on-surface"
            >
              <span
                className="material-symbols-outlined text-primary text-sm"
                aria-hidden="true"
              >
                bar_chart
              </span>
              <span className="japanese-text">{c}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
