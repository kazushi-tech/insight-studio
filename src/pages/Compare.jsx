import { useState, useCallback } from 'react'
import { scan } from '../api/marketLens'
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

  return (
    <div className="flex items-center gap-4 text-xs text-on-surface-variant">
      <span className="flex items-center gap-1.5 px-3 py-1 bg-surface-container rounded-full font-bold">
        <span className={`w-1.5 h-1.5 rounded-full ${
          run.status === 'running' ? 'bg-amber-400 animate-pulse' :
          run.status === 'completed' ? 'bg-emerald-500' :
          'bg-red-400'
        }`} />
        {run.status === 'running' ? '分析中…' : run.status === 'completed' ? '完了' : 'エラー'}
      </span>
      {result?.run_id && <span className="text-outline font-mono">run: {result.run_id}</span>}
      {result?.status && result.status !== run.status && (
        <span className="px-3 py-1 bg-surface-container rounded-full font-bold">{result.status}</span>
      )}
      {elapsed && <span>{formatElapsed(elapsed)}</span>}
    </div>
  )
}

export default function Compare() {
  const { geminiKey, hasGeminiKey } = useAuth()
  const { getRun, startRun, completeRun, failRun, clearRun } = useAnalysisRuns()

  const run = getRun('compare')
  const [urls, setUrls] = useState(() => run?.input?.urls || { target: '', compA: '', compB: '' })

  const loading = run?.status === 'running'
  const error = run?.status === 'failed' ? run.error : null
  const result = run?.result || null
  const canSubmit = urls.target && (urls.compA || urls.compB) && hasGeminiKey && !loading

  const handleScan = useCallback(async () => {
    startRun('compare', { urls })

    try {
      const urlList = [urls.target, urls.compA, urls.compB].filter(Boolean)
      const data = await scan(urlList, geminiKey)
      completeRun('compare', data, { run_id: data.run_id })
    } catch (e) {
      failRun('compare', e.message)
    }
  }, [urls, geminiKey, startRun, completeRun, failRun])

  const handleRetry = useCallback(() => {
    clearRun('compare')
  }, [clearRun])

  const overallScore = result?.overall_score ?? result?.score ?? null
  const scores = result?.scores ?? {}
  const hasScores = overallScore != null || Object.values(scores).some((v) => v != null)
  const report = result?.report_md ?? result?.report ?? result?.analysis ?? ''
  const extracted = result?.extracted ?? null

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
        <div className="flex flex-col items-end gap-2">
          <button
            className="px-8 py-3 bg-primary text-on-primary rounded-xl font-bold flex items-center gap-2 hover:opacity-90 transition-all shadow-xl shadow-primary/20 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!canSubmit}
            onClick={handleScan}
          >
            {loading ? (
              <>
                <LoadingSpinner size="sm" />
                <span>分析中…</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-lg">bolt</span>
                分析開始
              </>
            )}
          </button>
          <p className="text-xs text-on-surface-variant japanese-text">重いLPは 30〜90 秒ほどかかることがあります。</p>
        </div>
      </div>

      {error && (
        <ErrorBanner message={error} onRetry={handleRetry} />
      )}

      {/* Meta Band */}
      {run && run.status !== 'failed' && <MetaBand run={run} />}

      {/* Preview Area */}
      <div className="grid grid-cols-2 gap-8">
        <div className="bg-surface-container-lowest rounded-[16px] shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6 min-h-[400px] flex flex-col overflow-hidden transition-transform hover:scale-[1.01]">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-on-surface-variant uppercase tracking-[0.15em]">INSIGHT STUDIO (CONTROL)</p>
            <span className="text-[10px] text-outline">Desktop View</span>
          </div>
          {urls.target ? (
            <iframe src={urls.target} title="Target LP" className="w-full flex-1 min-h-[360px] rounded-[16px] overflow-hidden" sandbox="allow-scripts allow-same-origin" />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center">
              <span className="material-symbols-outlined text-6xl text-outline-variant mb-4">web</span>
              <p className="text-on-surface-variant text-sm japanese-text">自社LPのプレビューがここに表示されます</p>
            </div>
          )}
        </div>
        <div className="bg-surface-container-lowest rounded-[16px] shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6 min-h-[400px] flex flex-col overflow-hidden transition-transform hover:scale-[1.01]">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-on-surface-variant uppercase tracking-[0.15em]">COMPETITOR ALPHA</p>
            <span className="text-[10px] text-outline">Desktop View</span>
          </div>
          {urls.compA ? (
            <iframe src={urls.compA} title="Competitor LP" className="w-full flex-1 min-h-[360px] rounded-[16px] overflow-hidden" sandbox="allow-scripts allow-same-origin" />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center">
              <span className="material-symbols-outlined text-6xl text-outline-variant mb-4">web</span>
              <p className="text-on-surface-variant text-sm japanese-text">競合LPのプレビューがここに表示されます</p>
            </div>
          )}
        </div>
      </div>

      {/* Result Area */}
      {result && (
        <div className="space-y-8">
          <div className={`grid gap-8 ${hasScores ? 'grid-cols-12' : ''}`}>
            {/* Score Panel — only shown when backend returns scores */}
            {hasScores && (
              <div className="col-span-4 bg-gradient-to-br from-secondary to-secondary-fixed-dim p-8 rounded-2xl text-on-secondary min-h-[300px]">
                <p className="text-xs uppercase tracking-[0.2em] font-bold opacity-80">OVERALL STRATEGY SCORE</p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-7xl font-black tabular-nums">{overallScore ?? '--'}</span>
                  <span className="text-2xl font-bold opacity-60">/100</span>
                </div>
                <div className="mt-8 space-y-3 text-sm">
                  {scores.ux != null && <div className="flex justify-between border-b border-white/20 pb-2"><span>UXコンバージョン率</span><span className="font-bold">{scores.ux}</span></div>}
                  {scores.conversion != null && <div className="flex justify-between border-b border-white/20 pb-2"><span>コンバージョン</span><span className="font-bold">{scores.conversion}</span></div>}
                  {scores.brand != null && <div className="flex justify-between border-b border-white/20 pb-2"><span>ブランド信頼性</span><span className="font-bold">{scores.brand}</span></div>}
                  {scores.trust != null && <div className="flex justify-between border-b border-white/20 pb-2"><span>信頼性</span><span className="font-bold">{scores.trust}</span></div>}
                  {scores.seo != null && <div className="flex justify-between"><span>SEO最適化</span><span className="font-bold">{scores.seo}</span></div>}
                </div>
                {result?.summary && (
                  <p className="mt-6 text-xs leading-relaxed opacity-80">{result.summary}</p>
                )}
              </div>
            )}

            {/* Report — primary display */}
            <div className={`${hasScores ? 'col-span-8' : 'w-full'} bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-8 min-h-[300px]`}>
              <div className="flex items-center gap-2 text-on-surface-variant mb-6">
                <span className="material-symbols-outlined text-secondary">description</span>
                <span className="text-sm font-bold">分析レポート</span>
              </div>
              {extracted && (
                <div className="mb-6 p-4 bg-surface-container rounded-xl text-sm space-y-2">
                  <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">抽出データ</p>
                  <pre className="text-xs text-on-surface-variant whitespace-pre-wrap overflow-x-auto">{typeof extracted === 'string' ? extracted : JSON.stringify(extracted, null, 2)}</pre>
                </div>
              )}
              {report ? (
                <div className="pl-9 text-on-surface-variant text-sm leading-relaxed">
                  <MarkdownRenderer content={report} />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-on-surface-variant">
                  <span className="material-symbols-outlined text-4xl text-outline-variant mb-2">check_circle</span>
                  <p className="text-sm japanese-text">分析が完了しましたが、レポートデータが含まれていません。</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Empty State — before any scan */}
      {!result && !error && !loading && (
        <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-8 min-h-[200px]">
          <div className="flex items-center gap-2 text-on-surface-variant mb-6">
            <span className="material-symbols-outlined">description</span>
            <span className="text-sm font-bold">分析レポート</span>
          </div>
          <p className="text-on-surface-variant text-sm japanese-text">URLを入力し「分析開始」を押すと、AIが競合比較レポートを生成します。</p>
        </div>
      )}
    </div>
  )
}
