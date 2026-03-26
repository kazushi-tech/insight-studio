import { useState } from 'react'
import { reviewByType } from '../api/marketLens'
import { useAuth } from '../contexts/AuthContext'

const REVIEW_AVAILABLE = false

export default function CreativeReview() {
  const { geminiKey, hasGeminiKey } = useAuth()
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  const canSubmit = REVIEW_AVAILABLE && url && hasGeminiKey && !loading

  async function handleReview() {
    if (!REVIEW_AVAILABLE) return
    setError(null)
    setLoading(true)
    try {
      const data = await reviewByType('ad-lp', { url }, geminiKey)
      setResult(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const totalScore = result?.total_score ?? result?.score ?? null
  const scores = result?.scores ?? result?.categories ?? []
  const report = result?.report_md ?? result?.report ?? result?.analysis ?? ''

  return (
    <div className="p-10 max-w-[1400px] mx-auto space-y-10">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2 text-sm text-on-surface-variant mb-2">
            <span>競合LP分析</span>
            <span className="material-symbols-outlined text-sm">chevron_right</span>
            <span className="text-secondary font-bold">クリエイティブ・レビュー</span>
          </div>
          <h2 className="text-4xl font-extrabold text-[#1A1A2E] tracking-tight">Creative Review & Scoring</h2>
        </div>
      </div>

      {!REVIEW_AVAILABLE && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-sm text-amber-800">
          <span className="material-symbols-outlined text-lg">construction</span>
          <div>
            <p className="font-bold japanese-text">この機能は現在利用できません</p>
            <p className="mt-1 japanese-text">Market Lens backend の review API 契約が更新されたため、クリエイティブレビュー機能を一時停止しています。対応が完了次第、再度ご利用いただけます。</p>
          </div>
        </div>
      )}

      {!hasGeminiKey && REVIEW_AVAILABLE && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 text-sm text-amber-800">
          <span className="material-symbols-outlined text-lg">warning</span>
          <span className="japanese-text">Gemini API キーが未設定です。ヘッダーの鍵アイコンから設定してください。</span>
        </div>
      )}

      {/* URL Input + Action */}
      <div className="flex gap-4">
        <div className="relative flex-1">
          <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant">link</span>
          <input
            className="w-full bg-surface-container-lowest rounded-xl py-4 pl-12 pr-4 text-sm outline-none focus:ring-2 focus:ring-secondary/40 transition-all shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] disabled:opacity-50"
            placeholder="診断するLPのURLを入力"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={!REVIEW_AVAILABLE}
          />
        </div>
        <button
          className="px-8 py-4 bg-primary text-on-primary rounded-xl font-bold flex items-center gap-2 hover:opacity-90 transition-all shadow-xl shadow-primary/20 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!canSubmit}
          onClick={handleReview}
        >
          {loading ? (
            <>
              <span className="material-symbols-outlined text-lg animate-spin">progress_activity</span>
              診断中…
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-lg">bolt</span>
              AI診断を実行
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-5 py-3 text-sm text-red-700">
          <span className="material-symbols-outlined text-lg">error</span>
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-12 gap-8">
        {/* LP Preview */}
        <div className="col-span-6 bg-surface-container rounded-2xl min-h-[500px] flex flex-col items-center justify-center relative overflow-hidden">
          {url && REVIEW_AVAILABLE ? (
            <iframe src={url} title="Review Target" className="w-full h-full min-h-[500px] rounded-2xl" sandbox="allow-scripts allow-same-origin" />
          ) : (
            <>
              <div className="absolute top-4 left-4 flex gap-2">
                <span className="px-3 py-1 bg-surface-container-lowest rounded-lg text-xs font-bold">ANALYSIS TARGET</span>
              </div>
              <span className="material-symbols-outlined text-8xl text-outline-variant/40">image</span>
              <p className="text-on-surface-variant text-sm mt-4 japanese-text">LPプレビュー画像</p>
            </>
          )}
        </div>

        {/* Score Panel */}
        <div className="col-span-6 space-y-6">
          {/* Score Summary */}
          <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-xl font-bold">Performance Radar</h3>
                <p className="text-sm text-on-surface-variant">4-axis comparative scoring</p>
              </div>
              <div className="w-16 h-16 bg-primary text-on-primary rounded-xl flex flex-col items-center justify-center">
                <span className="text-xs">Total Score</span>
                <span className="text-2xl font-black">{totalScore ?? '--'}</span>
              </div>
            </div>
            {/* Score bars */}
            {Array.isArray(scores) && scores.length > 0 && (
              <div className="mt-6 space-y-3">
                {scores.map((s, i) => (
                  <div key={s.label ?? s.name ?? i} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="font-bold japanese-text">{s.label ?? s.name}</span>
                      <span className="font-bold tabular-nums">{s.score ?? s.value}/10</span>
                    </div>
                    <div className="h-2 bg-surface-container rounded-full overflow-hidden">
                      <div className="h-full bg-secondary rounded-full" style={{ width: `${((s.score ?? s.value ?? 0) / 10) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!result && (
              <div className="h-40 flex items-center justify-center mt-4">
                <div className="w-40 h-40 border-2 border-outline-variant/30 rotate-45 rounded-lg flex items-center justify-center">
                  <div className="w-24 h-24 bg-secondary/10 rounded-lg" />
                </div>
              </div>
            )}
          </div>

          {/* Analysis Report */}
          <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6 space-y-5">
            <h3 className="text-xl font-bold japanese-text">分析レポート</h3>
            {report ? (
              <div className="text-sm text-on-surface-variant leading-relaxed whitespace-pre-wrap japanese-text">{report}</div>
            ) : (
              <p className="text-on-surface-variant text-sm japanese-text">URLを入力して「AI診断を実行」を押すと、レビュー結果が表示されます。</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
