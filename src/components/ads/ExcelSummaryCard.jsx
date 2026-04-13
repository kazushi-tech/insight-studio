import SourceBadge from './SourceBadge'

export default function ExcelSummaryCard({ summary }) {
  if (!summary) return null

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <h3 className="text-lg font-extrabold text-on-surface japanese-text">Excel要約</h3>
        <SourceBadge source="excel" />
      </div>

      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-sm overflow-hidden">
        {/* Readiness / Coverage badges */}
        {(summary.readiness || summary.coverageNote) && (
          <div className="px-6 pt-5 pb-3 flex flex-wrap gap-2">
            {summary.readiness && (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-accent-gold bg-accent-gold/10 border border-accent-gold/20 px-3 py-1 rounded-full">
                <span className="material-symbols-outlined text-sm">info</span>
                {summary.readiness}
              </span>
            )}
            {summary.coverageNote && (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-on-surface-variant bg-surface-container-high px-3 py-1 rounded-full">
                <span className="material-symbols-outlined text-sm">text_fields</span>
                {summary.coverageNote}
              </span>
            )}
          </div>
        )}

        {/* Highlights */}
        <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          {summary.highlights.map((h, i) => (
            <div
              key={i}
              className="bg-surface-container-low rounded-xl p-4 border border-outline-variant/10"
            >
              <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm">
                  {i === 0 ? 'trending_up' : i === 1 ? 'pie_chart' : 'emoji_events'}
                </span>
                {h.label}
              </p>
              <p className="text-sm font-bold text-on-surface japanese-text leading-relaxed">
                {h.text}
              </p>
            </div>
          ))}
        </div>

        {/* Recommended Action */}
        {summary.recommendedAction && (
          <div className="mx-6 mb-5 bg-primary-container/10 border-l-4 border-primary rounded-r-lg p-4">
            <p className="text-[10px] font-bold text-primary uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm">lightbulb</span>
              推奨アクション
            </p>
            <p className="text-sm font-bold text-on-surface japanese-text">
              {summary.recommendedAction}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
