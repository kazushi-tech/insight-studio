export default function PartialSuccessBanner({ fetchedSites }) {
  if (!fetchedSites || fetchedSites.length === 0) return null

  const fallback = fetchedSites.filter((site) => site.analysis_source === 'search_result_fallback')
  const failed = fetchedSites.filter((site) => {
    if (site.analysis_source === 'search_result_fallback') return false
    if (site.analysis_source === 'failed') return true
    return Boolean(site.error)
  })
  const success = fetchedSites.filter((site) => !failed.includes(site) && !fallback.includes(site))

  if (failed.length === 0 && fallback.length === 0) return null

  return (
    <div className="bg-amber-50 dark:bg-warning-container border border-amber-200 dark:border-warning/30 rounded-[0.75rem] px-5 py-3 space-y-2">
      <p className="text-sm text-amber-800 dark:text-on-warning-container font-bold flex items-center gap-2">
        <span className="material-symbols-outlined text-lg">warning</span>
        {success.length} / {fetchedSites.length} 件をページ取得できました
        {fallback.length > 0 && `、${fallback.length} 件は検索結果ベースで補完分析`}
        {failed.length > 0 && `（${failed.length} 件未分析）`}
      </p>
      <div className="text-xs text-amber-700 dark:text-on-warning-container space-y-1">
        {fallback.map((site, i) => (
          <div key={`fallback-${i}`} className="flex items-center gap-2">
            <span className="material-symbols-outlined text-sm text-amber-500">info</span>
            <span className="font-mono truncate max-w-[400px]">{site.url || site.domain}</span>
            <span className="text-amber-700 dark:text-on-warning-container">ページ取得に失敗したため検索結果から補完分析</span>
          </div>
        ))}
        {failed.map((site, i) => (
          <div key={`failed-${i}`} className="flex items-center gap-2">
            <span className="material-symbols-outlined text-sm text-red-400">close</span>
            <span className="font-mono truncate max-w-[400px]">{site.url || site.domain}</span>
            <span className="text-amber-600 dark:text-warning">{site.error}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
