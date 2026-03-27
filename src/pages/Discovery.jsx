import { useState } from 'react'
import { discoveryAnalyze } from '../api/marketLens'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { LoadingSpinner, ErrorBanner } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'

export default function Discovery() {
  const { geminiKey, hasGeminiKey } = useAuth()
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [discoveries, setDiscoveries] = useState([])

  const canSubmit = url && hasGeminiKey && !loading

  async function handleDiscover() {
    setError(null)
    setLoading(true)
    setResult(null)
    setDiscoveries([])
    try {
      const data = await discoveryAnalyze(url, geminiKey)
      setResult(data)
      const items = data.fetched_sites ?? data.competitors ?? data.results ?? (Array.isArray(data) ? data : [data])
      setDiscoveries(items)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-10 max-w-[1400px] mx-auto space-y-10">
      <div>
        <h2 className="text-4xl font-extrabold text-[#1A1A2E] tracking-tight japanese-text">Discovery Hub</h2>
        <p className="text-on-surface-variant mt-2 text-lg">URLを入力するだけで、市場の競合他社とそのパフォーマンスを瞬時に可視化します。</p>
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

      {error && (
        <ErrorBanner message={error} />
      )}

      {result?.report_md && (
        <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-8 space-y-5">
          <div className="flex flex-wrap items-center gap-3 text-xs text-on-surface-variant">
            <span className="px-3 py-1 rounded-full bg-surface-container font-bold">
              {result.industry || '業界未分類'}
            </span>
            <span>{result.candidate_count ?? discoveries.length} 件候補</span>
            <span>{result.analyzed_count ?? discoveries.length} 件分析</span>
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
            {discoveries.map((item, i) => (
              <div
                key={item.url ?? item.name ?? i}
                className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] overflow-hidden group"
              >
                <div className="h-48 bg-surface-container relative">
                  <span className="material-symbols-outlined absolute inset-0 m-auto text-6xl text-outline-variant/50">
                    web
                  </span>
                  {(item.score != null) && (
                    <div className="absolute top-3 right-3 bg-surface-container-lowest/90 backdrop-blur px-3 py-1 rounded-lg">
                      <span className="text-xs font-bold text-on-surface-variant">SCORE</span>{' '}
                      <span className="text-lg font-black text-secondary tabular-nums">{item.score}</span>
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
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && discoveries.length === 0 && (
        <div className="text-center py-20 text-on-surface-variant">
          <span className="material-symbols-outlined text-6xl text-outline-variant mb-4 block">explore</span>
          <p className="text-lg font-bold japanese-text">URLを入力して競合を発見しましょう</p>
          <p className="text-sm mt-1">AIが自動的に競合LPを検出・分析します</p>
        </div>
      )}
    </div>
  )
}
