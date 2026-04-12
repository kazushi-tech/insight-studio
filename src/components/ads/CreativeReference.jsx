import SourceBadge from './SourceBadge'

export default function CreativeReference({ creativeRefs }) {
  if (!creativeRefs?.length) return null

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <h3 className="text-lg font-extrabold text-on-surface japanese-text">クリエイティブリファレンス</h3>
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
              <div className="aspect-video bg-surface-container-low p-3 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="material-symbols-outlined text-2xl text-outline-variant">text_fields</span>
                  <span className="text-[9px] font-bold text-on-surface-variant border border-outline-variant/30 px-1.5 py-0.5 rounded-full">
                    TEXT AD
                  </span>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-bold text-on-surface line-clamp-2 japanese-text">
                    {ref.name ?? `Creative ${idx + 1}`}
                  </p>
                  {ref.description && (
                    <p className="text-[10px] text-on-surface-variant line-clamp-3 japanese-text">
                      {ref.description}
                    </p>
                  )}
                </div>
              </div>
            )}
            <div className="p-3 space-y-1">
              <p className="text-xs font-bold text-on-surface truncate japanese-text">
                {ref.name ?? `Creative ${idx + 1}`}
              </p>
              {ref.subtitle && (
                <p className="text-[10px] text-on-surface-variant truncate japanese-text">
                  {ref.subtitle}
                </p>
              )}
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
