function displayHost(discovery) {
  if (discovery.domain) return discovery.domain
  if (!discovery.url) return '不明なサイト'
  try {
    return new URL(discovery.url).hostname || '不明なサイト'
  } catch {
    return '不明なサイト'
  }
}

export default function ScoreDistributionChart({ discoveries }) {
  const scored = (discoveries || []).filter((discovery) => discovery.score != null)
  if (!scored.length) return null

  return (
    <section className="bg-surface-container-lowest rounded-[0.75rem] panel-card-hover p-6" aria-labelledby="score-distribution-title">
      <div className="flex items-center gap-2 text-on-surface-variant mb-4">
        <span className="material-symbols-outlined text-secondary text-lg">bar_chart</span>
        <h2 id="score-distribution-title" className="text-sm font-bold">候補との近さ</h2>
      </div>
      <ol className="space-y-4">
        {scored.map((discovery, index) => {
          const host = displayHost(discovery)
          const score = Math.max(0, Math.min(100, Number(discovery.score) || 0))
          return (
            <li key={`${discovery.id || discovery.url || host}-${index}`}>
              <div className="mb-1.5 flex items-center justify-between gap-3 text-xs font-bold text-on-surface-variant">
                <span className="min-w-0 truncate" title={host}>{host}</span>
                <span aria-label={`${host}との近さ ${score}点`}>{score}<span aria-hidden="true"> / 100</span></span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-surface-container" aria-hidden="true">
                <div
                  className={`h-full rounded-full ${index === 0 ? 'bg-primary' : 'bg-primary/35'}`}
                  style={{ width: `${score}%` }}
                />
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
