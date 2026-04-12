import SourceBadge from './SourceBadge'

export default function CreativeReference({ creativeRefs }) {
  if (!creativeRefs?.length) return null

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <h3 className="text-lg font-extrabold text-on-surface japanese-text">\u30af\u30ea\u30a8\u30a4\u30c6\u30a3\u30d6\u30ea\u30d5\u30a1\u30ec\u30f3\u30b9</h3>
        <SourceBadge source="excel" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
        {creativeRefs.slice(0, 8).map((ref, idx) => (
          <div key={idx} className="bg-surface-container-lowest rounded-xl overflow-hidden shadow-sm border border-outline-variant/10 hover:shadow-md transition-shadow group">
            {ref.imageUrl ? (
              <div className="aspect-video bg-surface-container-low overflow-hidden relative">
                <img
                  src={ref.imageUrl}
                  alt={ref.name ?? `Creative ${idx + 1}`}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  onError={(e) => { e.target.style.display = 'none' }}
                />
                {ref.kpis?.ctr != null && (
                  <span className="absolute top-2 right-2 text-[9px] font-bold bg-white/90 text-on-surface px-1.5 py-0.5 rounded shadow-sm">
                    CTR {ref.kpis.ctr.toFixed(2)}%
                  </span>
                )}
              </div>
            ) : (
              <div className="aspect-video bg-surface-container-low flex items-center justify-center">
                <span className="material-symbols-outlined text-3xl text-outline-variant">image</span>
              </div>
            )}
            <div className="p-3 space-y-1">
              <p className="text-xs font-bold text-on-surface truncate japanese-text">
                {ref.name ?? `Creative ${idx + 1}`}
              </p>
              {ref.kpis && (
                <div className="flex gap-2 flex-wrap">
                  {ref.kpis.click != null && (
                    <span className="text-[9px] text-on-surface-variant">{ref.kpis.click.toLocaleString('ja-JP')} clicks</span>
                  )}
                  {ref.kpis.cv != null && (
                    <span className="text-[9px] text-on-surface-variant">{ref.kpis.cv} CV</span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
