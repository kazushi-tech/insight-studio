import { Link } from 'react-router-dom'
import DomainPlaceholder from './DomainPlaceholder'

export default function DiscoveredLpGrid({ discoveries }) {
  if (!discoveries || discoveries.length === 0) return null

  return (
    <div className="space-y-10">
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <h3 className="headline-lg text-on-surface flex items-center gap-3 japanese-text">
            <span className="material-symbols-outlined text-primary-container">verified</span>
            発見されたLP一覧
          </h3>
        </div>
        <span className="inline-flex items-center justify-center px-4 py-2 bg-primary-container/10 text-primary-container label-md rounded-full">{discoveries.length}件</span>
      </div>

      <div className="grid grid-cols-3 gap-10">
        {discoveries.map((item, i) => {
          const isFallback = item.analysis_source === 'search_result_fallback'
          const isFailed = item.analysis_source === 'failed' || (item.error && !isFallback)

          return (
            <div
              key={item.url ?? i}
              className={`surface-elevated rounded-xl overflow-hidden elevation-hover ${
                isFailed ? 'opacity-60 ghost-border-thin border-red-200/50' :
                isFallback ? 'ghost-border-thin border-amber-200/50' :
                'ghost-border-thin'
              }`}
            >
              <div className="relative aspect-[4/3] overflow-hidden rounded-t-[0.75rem] bg-surface-container">
                <DomainPlaceholder domain={item.domain || new URL(item.url || 'https://unknown').hostname} />
                {item.og_image_url && (
                  <img
                    src={item.og_image_url}
                    alt={item.title || item.url}
                    className="absolute inset-0 w-full h-full object-cover transition-opacity duration-500 opacity-0"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onLoad={(e) => e.target.classList.add('opacity-100')}
                    onError={(e) => {
                      const img = e.target
                      if (!img.dataset.retried) {
                        img.dataset.retried = 'true'
                        img.removeAttribute('crossorigin')
                        img.src = item.og_image_url + (item.og_image_url.includes('?') ? '&' : '?') + '_r=1'
                      } else {
                        img.style.display = 'none'
                      }
                    }}
                  />
                )}
                {(item.score != null) && (
                  <div className="absolute top-3 right-3 bg-surface-container-lowest/90 backdrop-blur px-3 py-2 rounded-lg text-center shadow-md">
                    <span className="text-[10px] font-bold text-on-surface-variant block uppercase tracking-wider">SCORE</span>
                    <span className="text-2xl font-black text-secondary tabular-nums leading-none">{item.score}</span>
                  </div>
                )}
                {isFailed && (
                  <div className="absolute bottom-3 left-3 right-3 bg-red-50/90 dark:bg-error-container backdrop-blur px-3 py-1.5 rounded-lg">
                    <span className="text-xs text-red-700 dark:text-on-error-container font-bold">取得失敗: {item.error}</span>
                  </div>
                )}
                {isFallback && (
                  <div className="absolute bottom-3 left-3 right-3 bg-amber-50/90 dark:bg-warning-container backdrop-blur px-3 py-1.5 rounded-lg">
                    <span className="text-xs text-amber-800 dark:text-on-warning-container font-bold">検索結果スニペットから補完分析</span>
                  </div>
                )}
              </div>
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <h4 className="font-bold text-on-surface japanese-text">{item.title || item.url}</h4>
                  {item.url && (
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-on-surface-variant hover:text-primary transition-colors" aria-label="外部リンクを開く">
                      <span className="material-symbols-outlined text-lg">open_in_new</span>
                    </a>
                  )}
                </div>
                {item.description && (
                  <p className="text-xs text-on-surface-variant mt-2 leading-relaxed japanese-text line-clamp-3">{item.description}</p>
                )}
                {item.domain && !item.description && (
                  <p className="text-xs text-on-surface-variant mt-2 font-mono">{item.domain}</p>
                )}
              </div>
              {item.url && !isFailed && (
                <div className="border-t border-outline-variant/8 px-5 py-3 flex items-center gap-2">
                  {isFallback ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center flex-1 gap-1.5 px-4 py-2 bg-secondary/10 text-secondary text-xs font-bold rounded-lg hover:bg-secondary/20 transition-colors japanese-text"
                    >
                      サイトを開く
                      <span className="material-symbols-outlined text-sm">open_in_new</span>
                    </a>
                  ) : (
                    <Link
                      to={`/compare?seed=${encodeURIComponent(item.url)}`}
                      className="inline-flex items-center justify-center flex-1 gap-1.5 px-4 py-2 bg-secondary/10 text-secondary text-xs font-bold rounded-lg hover:bg-secondary/20 transition-colors japanese-text"
                    >
                      LP比較で深掘り
                      <span className="material-symbols-outlined text-sm">arrow_forward</span>
                    </Link>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
