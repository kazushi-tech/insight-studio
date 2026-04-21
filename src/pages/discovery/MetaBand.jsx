import { STAGE_LABELS, STAGE_ORDER, STAGE_TYPICAL_SEC, estimateRemaining, formatElapsed } from './pollingConstants'

export default function MetaBand({ run, now }) {
  if (!run || run.status === 'idle') return null
  const result = run.result
  const warmEndedAt = run.meta?.warmEndedAt
  const elapsed = run.startedAt && run.finishedAt ? run.finishedAt - run.startedAt : null
  const runningElapsed = run.startedAt && run.status === 'running'
    ? Math.max(0, now - run.startedAt)
    : null
  const fallbackCount = Array.isArray(result?.fetched_sites)
    ? result.fetched_sites.filter((site) => site.analysis_source === 'search_result_fallback').length
    : 0
  const stage = run.meta?.stage
  const isWarming = stage === 'warming'
  const progressPct = run.meta?.progress_pct
  const stageLabel = stage ? STAGE_LABELS[stage] || stage : null
  const statusLabel = run.meta?.statusLabel
  const remaining = run.status === 'running' && stage ? estimateRemaining(stage, runningElapsed) : null

  let elapsedDisplay = elapsed ? formatElapsed(elapsed) : null
  if (elapsed && warmEndedAt && run.startedAt) {
    const warmMs = warmEndedAt - run.startedAt
    const analysisMs = elapsed - warmMs
    if (warmMs > 1000) {
      elapsedDisplay = `起動: ${formatElapsed(warmMs)} + 分析: ${formatElapsed(analysisMs)}`
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-xs text-on-surface-variant">
        <span className="flex items-center gap-1.5 px-3 py-1 bg-surface-container rounded-full font-bold">
          <span className={`w-1.5 h-1.5 rounded-full ${
            run.status === 'running' ? 'bg-amber-400 animate-pulse' :
            run.status === 'completed' ? 'bg-emerald-500' :
            'bg-red-400'
          }`} />
          {run.status === 'running' ? (statusLabel || stageLabel || '分析中…') : run.status === 'completed' ? '完了' : 'エラー'}
        </span>
        {isWarming && (
          <span className="px-3 py-1 rounded-full bg-orange-50 dark:bg-warning-container text-orange-700 dark:text-warning font-bold">サーバー起動中…</span>
        )}
        {remaining && (
          <span className="px-3 py-1 rounded-full bg-amber-50 dark:bg-warning-container text-amber-700 dark:text-warning font-bold">{remaining}</span>
        )}
        {result?.search_id && <span className="text-outline font-mono">search: {result.search_id}</span>}
        {result?.industry && (
          <span className="px-3 py-1 rounded-full bg-surface-container font-bold">{result.industry}</span>
        )}
        {result?.candidate_count != null && result?.analyzed_count != null ? (
          <span>分析: {result.analyzed_count} サイト{result.candidate_count > result.analyzed_count ? ` / 候補: ${result.candidate_count} サイト中 ${result.candidate_count - result.analyzed_count} サイト未分析` : ''}</span>
        ) : (
          <>
            {result?.candidate_count != null && <span>{result.candidate_count} 件候補</span>}
            {result?.analyzed_count != null && <span>{result.analyzed_count} サイト分析</span>}
          </>
        )}
        {run.meta?.providerLabel && (
          <span className="px-3 py-1 rounded-full bg-surface-container font-bold">{run.meta.providerLabel}</span>
        )}
        {fallbackCount > 0 && <span>{fallbackCount} 件補完</span>}
        {elapsedDisplay && <span>{elapsedDisplay}</span>}
      </div>
      {run.status === 'running' && isWarming && (
        <div className="w-full bg-surface-container rounded-full h-1.5 overflow-hidden">
          <div className="h-full bg-orange-400 rounded-full animate-pulse" style={{ width: '100%' }} />
        </div>
      )}
      {run.status === 'running' && !isWarming && progressPct != null && (
        <div className="w-full bg-surface-container rounded-full h-1.5 overflow-hidden">
          <div
            className="h-full bg-secondary rounded-full transition-all duration-700 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}
    </div>
  )
}
