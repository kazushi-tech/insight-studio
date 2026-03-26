import { useState } from 'react'
import { scan } from '../api/marketLens'
import { useAuth } from '../contexts/AuthContext'

export default function Compare() {
  const { geminiKey, hasGeminiKey } = useAuth()
  const [urls, setUrls] = useState({ target: '', compA: '', compB: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  const canSubmit = urls.target && (urls.compA || urls.compB) && hasGeminiKey && !loading

  async function handleScan() {
    setError(null)
    setLoading(true)
    try {
      const urlList = [urls.target, urls.compA, urls.compB].filter(Boolean)
      const data = await scan(urlList, geminiKey)
      setResult(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const overallScore = result?.overall_score ?? result?.score ?? null
  const scores = result?.scores ?? {}
  const report = result?.report_md ?? result?.report ?? result?.analysis ?? ''

  return (
    <div className="p-10 max-w-[1400px] mx-auto space-y-10">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-4xl font-extrabold text-[#1A1A2E] tracking-tight japanese-text">LP比較・競合分析</h2>
          <p className="text-on-surface-variant mt-2 text-lg">自社と競合のLPを並列比較し、AIが戦略的な改善点を提示します</p>
        </div>
        <span className="inline-flex items-center gap-2 px-4 py-2 bg-surface-container rounded-full text-sm font-bold text-secondary">
          <span className="material-symbols-outlined text-sm">auto_awesome</span>
          AI POWERED
        </span>
      </div>

      {!hasGeminiKey && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 text-sm text-amber-800">
          <span className="material-symbols-outlined text-lg">warning</span>
          <span className="japanese-text">Gemini API キーが未設定です。ヘッダーの鍵アイコンから設定してください。</span>
        </div>
      )}

      {/* URL Inputs */}
      <div className="grid grid-cols-3 gap-6">
        {[
          { key: 'target', label: '自社URL (Target)', placeholder: 'https://your-site.jp/lp01' },
          { key: 'compA', label: '競合URL A (Competitor)', placeholder: 'https://competitor-a.com/landing' },
          { key: 'compB', label: '競合URL B (Competitor)', placeholder: 'https://competitor-b.com/campaign' },
        ].map(({ key, label, placeholder }) => (
          <div key={key}>
            <label className="text-sm font-bold text-on-surface-variant mb-2 block japanese-text">{label}</label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg">link</span>
              <input
                className="w-full bg-surface-container-low rounded-xl py-3 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-secondary/40 transition-all"
                placeholder={placeholder}
                value={urls[key]}
                onChange={(e) => setUrls({ ...urls, [key]: e.target.value })}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <button
          className="px-8 py-3 bg-primary text-on-primary rounded-xl font-bold flex items-center gap-2 hover:opacity-90 transition-all shadow-xl shadow-primary/20 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!canSubmit}
          onClick={handleScan}
        >
          {loading ? (
            <>
              <span className="material-symbols-outlined text-lg animate-spin">progress_activity</span>
              分析中…
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-lg">bolt</span>
              分析開始
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

      {/* Preview Area */}
      <div className="grid grid-cols-2 gap-8">
        <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6 min-h-[400px] flex flex-col items-center justify-center">
          {urls.target ? (
            <iframe src={urls.target} title="Target LP" className="w-full h-full min-h-[400px] rounded-lg" sandbox="allow-scripts allow-same-origin" />
          ) : (
            <>
              <span className="material-symbols-outlined text-6xl text-outline-variant mb-4">web</span>
              <p className="text-on-surface-variant text-sm japanese-text">自社LPのプレビューがここに表示されます</p>
              <p className="text-xs text-outline mt-1">INSIGHT STUDIO (CONTROL)</p>
            </>
          )}
        </div>
        <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6 min-h-[400px] flex flex-col items-center justify-center">
          {urls.compA ? (
            <iframe src={urls.compA} title="Competitor LP" className="w-full h-full min-h-[400px] rounded-lg" sandbox="allow-scripts allow-same-origin" />
          ) : (
            <>
              <span className="material-symbols-outlined text-6xl text-outline-variant mb-4">web</span>
              <p className="text-on-surface-variant text-sm japanese-text">競合LPのプレビューがここに表示されます</p>
              <p className="text-xs text-outline mt-1">COMPETITOR ALPHA</p>
            </>
          )}
        </div>
      </div>

      {/* Score & Report Area */}
      <div className="grid grid-cols-12 gap-8">
        <div className="col-span-4 bg-gradient-to-br from-secondary to-secondary-fixed-dim p-8 rounded-2xl text-on-secondary min-h-[300px]">
          <p className="text-xs uppercase tracking-widest font-bold opacity-80">OVERALL STRATEGY SCORE</p>
          <div className="mt-4 flex items-baseline gap-1">
            <span className="text-7xl font-black tabular-nums">{overallScore ?? '--'}</span>
            <span className="text-2xl font-bold opacity-60">/100</span>
          </div>
          <div className="mt-8 space-y-3 text-sm">
            <div className="flex justify-between"><span>UXコンバージョン率</span><span className="font-bold">{scores.ux ?? scores.conversion ?? '--'}</span></div>
            <div className="flex justify-between"><span>ブランド信頼性</span><span className="font-bold">{scores.brand ?? scores.trust ?? '--'}</span></div>
            <div className="flex justify-between"><span>SEO最適化</span><span className="font-bold">{scores.seo ?? '--'}</span></div>
          </div>
        </div>
        <div className="col-span-8 bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-8 min-h-[300px]">
          <div className="flex items-center gap-2 text-on-surface-variant mb-6">
            <span className="material-symbols-outlined">description</span>
            <span className="text-sm font-bold">分析レポート</span>
          </div>
          {report ? (
            <div className="text-sm text-on-surface leading-relaxed whitespace-pre-wrap japanese-text">{report}</div>
          ) : (
            <p className="text-on-surface-variant text-sm japanese-text">URLを入力し「分析開始」を押すと、AIが競合比較レポートを生成します。</p>
          )}
        </div>
      </div>
    </div>
  )
}
