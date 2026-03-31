import { useState, useCallback } from 'react'
import { discoveryAnalyze } from '../api/marketLens'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { LoadingSpinner, ErrorBanner } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useAnalysisRuns } from '../contexts/AnalysisRunsContext'
import { getAnalysisModel, getAnalysisProviderLabel } from '../utils/analysisProvider'

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
      {run.meta?.providerLabel && (
        <span className="px-3 py-1 rounded-full bg-surface-container font-bold">{run.meta.providerLabel}</span>
      )}
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
    <div className="bg-amber-50 border border-amber-200 rounded-[0.75rem] px-5 py-3 space-y-2">
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

const FONT_SIZES = [
  { key: 'normal', label: 'S' },
  { key: 'large', label: 'M' },
  { key: 'xlarge', label: 'L' },
]

function domainColor(domain) {
  let hash = 0
  for (let i = 0; i < domain.length; i++) hash = domain.charCodeAt(i) + ((hash << 5) - hash)
  const h = Math.abs(hash) % 360
  return `hsl(${h}, 35%, 45%)`
}

function DomainPlaceholder({ domain }) {
  const initial = (domain || '?').replace(/^www\./, '').charAt(0).toUpperCase()
  const color = domainColor(domain || '')
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3"
         style={{ background: `linear-gradient(135deg, ${color}18, ${color}30, ${color}18)` }}>
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl font-black text-white shadow-lg"
           style={{ backgroundColor: color }}>
        {initial}
      </div>
      <span className="text-xs font-bold text-on-surface-variant/60 tracking-wide truncate max-w-[200px]">
        {(domain || '').replace(/^www\./, '')}
      </span>
      <span className="material-symbols-outlined text-on-surface-variant/15 absolute bottom-3 right-3 text-4xl">language</span>
    </div>
  )
}

export default function Discovery() {
  const {
    analysisKey,
    analysisProvider,
    hasAnalysisKey,
  } = useAuth()
  const { getRun, startRun, completeRun, failRun, clearRun, getDraft, setDraft, clearDraft } = useAnalysisRuns()

  const run = getRun('discovery')
  const [url, setUrl] = useState(() => getDraft('discovery')?.url || run?.input?.url || '')
  const [fontSize, setFontSize] = useState('normal')

  const loading = run?.status === 'running'
  const error = run?.status === 'failed' ? run.error : null
  const result = run?.result || null
  const allDiscoveries = result?.fetched_sites ?? result?.competitors ?? result?.results ?? []
  const discoveries = allDiscoveries.filter((item) => {
    const isFailed = item.analysis_source === 'failed' || (item.error && item.analysis_source !== 'search_result_fallback')
    return !isFailed
  })
  const providerLabel = getAnalysisProviderLabel(analysisProvider)
  const canSubmit = url && hasAnalysisKey && !loading

  const handleDiscover = useCallback(async () => {
    if (!analysisKey || !analysisProvider) return

    startRun('discovery', { url })

    try {
      const data = await discoveryAnalyze(url, {
        apiKey: analysisKey,
        provider: analysisProvider,
        model: getAnalysisModel(analysisProvider),
      })
      completeRun('discovery', data, {
        search_id: data.search_id,
        providerLabel,
      })
    } catch (e) {
      failRun('discovery', e.message)
    }
  }, [url, analysisKey, analysisProvider, providerLabel, startRun, completeRun, failRun])

  const handleRetry = useCallback(() => {
    clearRun('discovery')
  }, [clearRun])

  const handleClear = useCallback(() => {
    clearRun('discovery')
    clearDraft('discovery')
    setUrl('')
  }, [clearRun, clearDraft])

  return (
    <div className="p-10 max-w-[1400px] mx-auto space-y-10">
      <div>
        <h2 className="display-lg text-on-surface tracking-tight japanese-text">Discovery Hub</h2>
        <p className="body-lg text-on-surface-variant max-w-2xl mt-4">URLを入力するだけで、市場の競合他社とそのパフォーマンスを瞬時に可視化します。</p>
      </div>

      {!hasAnalysisKey && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-[0.75rem] px-5 py-3 text-sm text-amber-800">
          <span className="material-symbols-outlined text-lg">warning</span>
          <span className="japanese-text">競合発見には Claude API キーが必要です。設定画面から設定してください。</span>
        </div>
      )}
      <div className="flex items-center gap-3 bg-surface-container rounded-[0.75rem] px-5 py-3 text-sm text-on-surface-variant">
        <span className="material-symbols-outlined text-lg">travel_explore</span>
        <span className="japanese-text">競合発見の分析は Claude で実行します。Gemini は分析には使わず、必要な検索設定はサーバー側で処理します。</span>
      </div>

      {/* URL Input */}
      <div className="bg-surface-container-lowest p-8 rounded-xl ghost-border">
        <div className="flex gap-4">
          <div className="relative flex-1">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant">link</span>
            <input
              className="w-full bg-surface-container-low rounded-[0.75rem] py-4 pl-12 pr-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-secondary transition-all"
              placeholder="競合他社のURLを入力"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setDraft('discovery', { url: e.target.value })
              }}
            />
          </div>
          <button
            className="button-primary py-4 disabled:opacity-50 disabled:cursor-not-allowed"
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
        <p className="text-xs text-on-surface-variant japanese-text mt-4">競合探索と比較分析には 30〜90 秒ほどかかることがあります。</p>
      </div>

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
        <>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-on-surface-variant">
              <span className="material-symbols-outlined">description</span>
              <span className="text-sm font-bold">分析レポート</span>
            </div>
            <div className="flex items-center gap-1 bg-surface-container rounded-full p-1">
              <span className="material-symbols-outlined text-on-surface-variant text-base px-1">text_fields</span>
              {FONT_SIZES.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setFontSize(key)}
                  className={`px-3 py-1 text-xs font-bold rounded-full transition-colors ${
                    fontSize === key
                      ? 'bg-primary-container text-on-primary-container'
                      : 'text-on-surface-variant hover:bg-surface-container-low'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <MarkdownRenderer content={result.report_md} size={fontSize} variant="discovery" />
        </>
      )}

      {/* Discovered LPs */}
      {discoveries.length > 0 && (
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
                    {/* Domain Placeholder (always rendered as base layer) */}
                    <DomainPlaceholder domain={item.domain || new URL(item.url || 'https://unknown').hostname} />
                    {/* OG Image (overlays placeholder on successful load) */}
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
                      <h4 className="font-bold text-on-surface japanese-text">{item.title || item.url}</h4>
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
                    <div className="border-t border-outline-variant/8 px-5 py-3">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center w-full gap-1.5 px-4 py-2 bg-secondary/10 text-secondary text-xs font-bold rounded-lg hover:bg-secondary/20 transition-colors japanese-text"
                      >
                        {isFallback ? 'サイトを開く' : '分析する'}
                        <span className="material-symbols-outlined text-sm">arrow_forward</span>
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
