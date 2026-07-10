import { Link } from 'react-router-dom'

export default function DiscoveredLpGrid({ discoveries }) {
  if (!discoveries || discoveries.length === 0) return null

  return (
    <section className="space-y-4 rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-5 shadow-sm">
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary japanese-text">競合候補一覧</p>
          <h3 className="mt-1 flex items-center gap-2 text-xl font-extrabold text-on-surface japanese-text">
            <span className="material-symbols-outlined text-primary" aria-hidden="true">verified</span>
            取得できた競合候補
          </h3>
          <p className="mt-1 text-sm text-on-surface-variant japanese-text">取得済みと補完分析を分けて確認できます。</p>
        </div>
        <span className="inline-flex items-center justify-center rounded-full bg-primary-container/10 px-4 py-2 text-sm font-black text-primary-container">{discoveries.length}件</span>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {discoveries.map((item, i) => {
          const isFallback = item.analysis_source === 'search_result' || item.analysis_source === 'search_result_fallback'
          const isFailed = item.analysis_source === 'failed' || (item.error && !isFallback)
          const domain = item.domain || (() => {
            try { return new URL(item.url || 'https://unknown').hostname } catch { return 'unknown' }
          })()
          const initial = domain.replace(/^www\./, '').charAt(0).toUpperCase()

          return (
            <article
              key={item.url ?? i}
              className={`rounded-lg border bg-surface-container-low p-4 ${
                isFailed ? 'opacity-60 ghost-border-thin border-red-200/50' :
                isFallback ? 'ghost-border-thin border-amber-200/50' :
                'ghost-border-thin'
              }`}
            >
              <div className="flex min-w-0 gap-3">
                <div className="grid size-12 shrink-0 place-items-center rounded-lg bg-primary/10 text-lg font-black text-primary">
                  {initial}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="truncate text-sm font-extrabold text-on-surface japanese-text">{item.title || item.url}</h4>
                      <p className="mt-0.5 truncate text-xs font-mono text-on-surface-variant">{domain}</p>
                    </div>
                    {item.url && (
                      <a href={item.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-on-surface-variant transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-secondary" aria-label={`${domain}を新しいタブで開く`}>
                        <span className="material-symbols-outlined text-lg" aria-hidden="true">open_in_new</span>
                      </a>
                    )}
                  </div>
                  {item.description && (
                    <p className="mt-2 line-clamp-2 text-xs leading-6 text-on-surface-variant japanese-text">{item.description}</p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                      isFailed ? 'bg-red-50 text-red-700' :
                      isFallback ? 'bg-amber-50 text-amber-800' :
                      'bg-emerald-50 text-emerald-700'
                    }`}>
                      {isFailed ? '取得失敗' : isFallback ? '補完分析' : '取得済み'}
                    </span>
                    {item.url && !isFailed && (
                      isFallback ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg bg-secondary/10 px-3 py-1.5 text-xs font-bold text-secondary transition-colors hover:bg-secondary/20 focus-visible:ring-2 focus-visible:ring-secondary japanese-text"
                        >
                          サイトを開く
                          <span className="material-symbols-outlined text-sm" aria-hidden="true">open_in_new</span>
                        </a>
                      ) : (
                        <Link
                          to={`/compare?seed=${encodeURIComponent(item.url)}`}
                          className="inline-flex items-center gap-1 rounded-lg bg-secondary/10 px-3 py-1.5 text-xs font-bold text-secondary transition-colors hover:bg-secondary/20 focus-visible:ring-2 focus-visible:ring-secondary japanese-text"
                        >
                          LP比較で深掘り
                          <span className="material-symbols-outlined text-sm" aria-hidden="true">arrow_forward</span>
                        </Link>
                      )
                    )}
                  </div>
                </div>
              </div>
              {isFailed && item.error && (
                <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 dark:bg-error-container dark:text-on-error-container">
                  {item.error}
                </p>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
