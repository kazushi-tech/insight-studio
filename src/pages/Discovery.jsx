import { useState, useCallback } from 'react'
import { discoveryAnalyze } from '../api/marketLens'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { LoadingSpinner, ErrorBanner } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useAnalysisRuns } from '../contexts/AnalysisRunsContext'

function formatElapsed(ms) {
  if (!ms) return null
  const sec = Math.round(ms / 1000)
  return sec < 60 ? `${sec}秒` : `${Math.floor(sec / 60)}分${sec % 60}秒`
}

function MetaBand({ run }) {
  if (!run || run.status === 'idle') return null
  const result = run.result
  const elapsed = run.startedAt && run.finishedAt ? run.finishedAt - run.startedAt : null
  const fallbackCount = Array.isArray(result?.fetched_sites)
    ? result.fetched_sites.filter((site) => site.analysis_source === 'search_result_fallback').length
    : 0

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-on-surface-variant">
      {/* Status */}
      <span className="flex items-center gap-1.5 px-3 py-1 bg-surface-container rounded-full font-bold">
        <span className={`w-1.5 h-1.5 rounded-full ${
          run.status === 'running' ? 'bg-amber-400 animate-pulse' :
          run.status === 'completed' ? 'bg-emerald-500' :
          'bg-red-400'
        }`} />
        {run.status === 'running' ? '分析中…' : run.status === 'completed' ? '完了' : 'エラー'}
      </span>
      {result?.search_id && <span className="text-outline font-mono">search: {result.search_id}</span>}
      {result?.industry && (
        <span className="px-3 py-1 rounded-full bg-surface-container font-bold">{result.industry}</span>
      )}
      {result?.candidate_count != null && <span>{result.candidate_count} 件候補</span>}
      {result?.analyzed_count != null && <span>{result.analyzed_count} サイト分析</span>}
      {fallbackCount > 0 && <span>{fallbackCount} 件補完</span>}
      {elapsed && <span>{formatElapsed(elapsed)}</span>}
    </div>
  )
}

function PartialSuccessBanner({ fetchedSites }) {
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
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 space-y-2">
      <p className="text-sm text-amber-800 font-bold flex items-center gap-2">
        <span className="material-symbols-outlined text-lg">warning</span>
        {success.length} / {fetchedSites.length} 件をページ取得できました
        {fallback.length > 0 && `、${fallback.length} 件は検索結果ベースで補完分析`}
        {failed.length > 0 && `（${failed.length} 件未分析）`}
      </p>
      <div className="text-xs text-amber-700 space-y-1">
        {fallback.map((site, i) => (
          <div key={`fallback-${i}`} className="flex items-center gap-2">
            <span className="material-symbols-outlined text-sm text-amber-500">info</span>
            <span className="font-mono truncate max-w-[400px]">{site.url || site.domain}</span>
            <span className="text-amber-700">ページ取得に失敗したため検索結果から補完分析</span>
          </div>
        ))}
        {failed.map((site, i) => (
          <div key={`failed-${i}`} className="flex items-center gap-2">
            <span className="material-symbols-outlined text-sm text-red-400">close</span>
            <span className="font-mono truncate max-w-[400px]">{site.url || site.domain}</span>
            <span className="text-amber-600">{site.error}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Discovery() {
  const { geminiKey, hasGeminiKey } = useAuth()
  const { getRun, startRun, completeRun, failRun, clearRun } = useAnalysisRuns()

  const run = getRun('discovery')
  const [url, setUrl] = useState(() => run?.input?.url || '')

  const loading = run?.status === 'running'
  const error = run?.status === 'failed' ? run.error : null
  const result = run?.result || null
  const discoveries = result?.fetched_sites ?? result?.competitors ?? result?.results ?? []
  const canSubmit = url && hasGeminiKey && !loading

  const handleDiscover = useCallback(async () => {
    startRun('discovery', { url })

    try {
      const data = await discoveryAnalyze(url, geminiKey)
      completeRun('discovery', data, { search_id: data.search_id })
    } catch (e) {
      failRun('discovery', e.message)
    }
  }, [url, geminiKey, startRun, completeRun, failRun])

  const handleRetry = useCallback(() => {
    clearRun('discovery')
  }, [clearRun])

  return (
    <div className="p-10 max-w-[1400px] mx-auto space-y-10">
      <div>
        <h2 className="text-4xl font-extrabold text-[#1A1A2E] tracking-tight japanese-text">Discovery Hub</h2>
        <p className="text-on-surface-variant mt-2 text-base">URLを入力するだけで、市場の競合他社とそのパフォーマンスを瞬時に可視化します。</p>
      </div>

      {!hasGeminiKey && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 text-sm text-amber-800">
          <span className="material-symbols-outlined text-lg">warning</span>
          <span className="japanese-text">Gemini API キーが未設定です。ヘッダーの鍵アイコンから設定してください。</span>
        </div>
      )}

      {/* URL Input */}
      <div className="flex gap-4">
        <div className="relative flex-1">
          <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant">link</span>
          <input
            className="w-full bg-surface-container-lowest rounded-xl py-4 pl-12 pr-4 text-sm outline-none focus:ring-2 focus:ring-secondary/40 transition-all shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)]"
            placeholder="競合他社のURLを入力"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <button
          className="px-8 py-4 bg-primary text-on-primary rounded-xl font-bold flex items-center gap-2 hover:opacity-90 transition-all shadow-xl shadow-primary/20 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!canSubmit}
          onClick={handleDiscover}
        >
          {loading ? (
            <>
              <LoadingSpinner size="sm" />
              <span>検索中…</span>
            </>
          ) : (
            <>
              <span className="material-symbols-outlined">search</span>
              競合を発見
            </>
          )}
        </button>
      </div>

      <p className="text-xs text-on-surface-variant japanese-text">競合探索と比較分析には 30〜90 秒ほどかかることがあります。</p>

      {/* Meta Band */}
      <MetaBand run={run} />

      {/* Error */}
      {error && (
        <ErrorBanner message={error} onRetry={handleRetry} />
      )}

      {/* Partial Success Banner */}
      {result?.fetched_sites && <PartialSuccessBanner fetchedSites={result.fetched_sites} />}

      {/* Report */}
      {result?.report_md && (
        <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-8 space-y-5">
          <div className="flex items-center gap-2 text-on-surface-variant mb-4">
            <span className="material-symbols-outlined">description</span>
            <span className="text-sm font-bold">分析レポート</span>
          </div>
          <MarkdownRenderer content={result.report_md} />
        </div>
      )}

      {/* Discovered LPs */}
      {discoveries.length > 0 && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-2xl font-bold text-[#1A1A2E] flex items-center gap-2 japanese-text">
              <span className="material-symbols-outlined text-secondary">verified</span>
              発見されたLP一覧
            </h3>
            <span className="text-sm text-on-surface-variant">{discoveries.length} 件</span>
          </div>

          <div className="grid grid-cols-3 gap-6">
            {discoveries.map((item, i) => {
              const isFallback = item.analysis_source === 'search_result_fallback'
              const isFailed = item.analysis_source === 'failed' || (item.error && !isFallback)

              return (
                <div
                  key={item.url ?? item.name ?? i}
                  className={`bg-surface-container-lowest rounded-[16px] shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] overflow-hidden group transition-transform hover:scale-[1.01] ${
                    isFailed ? 'opacity-60 ring-1 ring-red-200' : isFallback ? 'ring-1 ring-amber-200' : ''
                  }`}
                >
                  <div className="h-48 bg-surface-container relative">
                    <span className="material-symbols-outlined absolute inset-0 m-auto text-6xl text-outline-variant/50">
                      {isFailed ? 'error_outline' : isFallback ? 'warning' : 'web'}
                    </span>
                    {(item.score != null) && (
                      <div className="absolute top-3 right-3 bg-surface-container-lowest/90 backdrop-blur px-3 py-2 rounded-lg text-center">
                        <span className="text-[10px] font-bold text-on-surface-variant block uppercase tracking-wider">SCORE</span>
                        <span className="text-2xl font-black text-secondary tabular-nums leading-none">{item.score}</span>
                      </div>
                    )}
                    {isFailed && (
                      <div className="absolute bottom-3 left-3 right-3 bg-red-50/90 backdrop-blur px-3 py-1.5 rounded-lg">
                        <span className="text-xs text-red-700 font-bold">取得失敗: {item.error}</span>
                      </div>
                    )}
                    {isFallback && (
                      <div className="absolute bottom-3 left-3 right-3 bg-amber-50/90 backdrop-blur px-3 py-1.5 rounded-lg">
                        <span className="text-xs text-amber-800 font-bold">検索結果スニペットから補完分析</span>
                      </div>
                    )}
                  </div>
                  <div className="p-5">
                    <div className="flex items-start justify-between">
                      <h4 className="font-bold text-[#1A1A2E] japanese-text">{item.title ?? item.name ?? item.url}</h4>
                      {item.url && (
                        <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-on-surface-variant hover:text-primary transition-colors">
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
                    <div className="border-t border-outline-variant/15 px-5 py-3 text-center">
                      <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-secondary hover:text-primary transition-colors japanese-text">
                        {isFallback ? 'サイトを開く →' : '分析する →'}
                      </a>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {!loading && discoveries.length === 0 && !result && !error && (
        <div className="text-center py-20 text-on-surface-variant">
          <span className="material-symbols-outlined text-6xl text-outline-variant mb-4 block">explore</span>
          <p className="text-lg font-bold japanese-text">URLを入力して競合を発見しましょう</p>
          <p className="text-sm mt-1">AIが自動的に競合LPを検出・分析します</p>
        </div>
      )}
    </div>
  )
}
