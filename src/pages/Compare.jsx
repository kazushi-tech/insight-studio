import { useState, useCallback } from 'react'
import { scan } from '../api/marketLens'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { LoadingSpinner, ErrorBanner } from '../components/ui'
import { useAnalysisRuns } from '../contexts/AnalysisRunsContext'
import { useAuth } from '../contexts/AuthContext'
import { getAnalysisProviderLabel } from '../utils/analysisProvider'


function formatElapsed(ms) {
  if (!ms) return null
  const sec = Math.round(ms / 1000)
  return sec < 60 ? `${sec}秒` : `${Math.floor(sec / 60)}分${sec % 60}秒`
}

function getHostname(value) {
  if (!value) return ''

  try {
    return new URL(value).hostname
  } catch {
    return ''
  }
}

function getScanErrorMessage(data) {
  if (!data || data.status !== 'error') return ''

  if (typeof data.error === 'string' && data.error.trim()) {
    return data.error.trim()
  }

  const report = typeof data.report_md === 'string' ? data.report_md : ''
  const match = report.match(/LLM分析エラー:[^\r\n]+/)
  return match?.[0] || '分析に失敗しました。しばらく待って再試行してください。'
}

function extractModelFromReport(reportMd) {
  if (!reportMd) return null
  const match = reportMd.match(/(?:モデル|Model)\s*[:：]\s*`?([^`\r\n]+)`?/i)
  return match?.[1]?.trim() || null
}

function parseExecutionMeta(reportMd) {
  if (!reportMd) return null
  const metaMatch = reportMd.match(/(?:#{1,4}\s*)?(?:実行メタデータ|Execution Metadata)[\s\S]*$/i)
  if (!metaMatch) return null

  const metaBlock = metaMatch[0]
  const entries = {}

  const patterns = [
    { key: 'model', label: 'モデル', regex: /(?:モデル|Model)\s*[:：]\s*`?([^`\r\n]+)`?/i },
    { key: 'tokens', label: 'トークン数', regex: /(?:トークン|Tokens?)\s*[:：]\s*`?([^`\r\n]+)`?/i },
    { key: 'inputTokens', label: '入力トークン', regex: /(?:入力トークン|Input Tokens?)\s*[:：]\s*`?([^`\r\n]+)`?/i },
    { key: 'outputTokens', label: '出力トークン', regex: /(?:出力トークン|Output Tokens?)\s*[:：]\s*`?([^`\r\n]+)`?/i },
    { key: 'status', label: 'ステータス', regex: /(?:ステータス|Status)\s*[:：]\s*`?([^`\r\n]+)`?/i },
    { key: 'runId', label: 'Run ID', regex: /(?:Run\s*ID|実行ID)\s*[:：]\s*`?([^`\r\n]+)`?/i },
    { key: 'timestamp', label: 'タイムスタンプ', regex: /(?:タイムスタンプ|Timestamp|日時)\s*[:：]\s*`?([^`\r\n]+)`?/i },
  ]

  for (const { key, label, regex } of patterns) {
    const m = metaBlock.match(regex)
    if (m) entries[key] = { label, value: m[1].trim() }
  }

  if (Object.keys(entries).length === 0) return null
  return entries
}

function inferExecutionEngine(providerLabel, modelName) {
  const normalizedProvider = String(providerLabel || '').trim().toLowerCase()
  const normalizedModel = String(modelName || '').trim().toLowerCase()

  if (normalizedProvider.includes('claude') || normalizedModel.startsWith('claude')) {
    return 'Claude'
  }
  if (normalizedProvider.includes('gemini') || normalizedModel.startsWith('gemini')) {
    return 'Gemini'
  }
  return 'server-side analysis'
}

function getExecutionMetaEntries(executionMeta, { providerLabel, modelName }) {
  if (!executionMeta) return []

  return [
    { key: 'route', label: '実行経路', value: 'Market Lens backend' },
    { key: 'engine', label: '実行エンジン', value: inferExecutionEngine(providerLabel, modelName) },
    ...Object.entries(executionMeta).map(([key, entry]) => ({
      key,
      label: entry.label,
      value: entry.value,
    })),
  ]
}

function stripExecutionMeta(reportMd) {
  if (!reportMd) return reportMd
  return reportMd.replace(/\n*(?:#{1,4}\s*)?(?:実行メタデータ|Execution Metadata)[\s\S]*$/i, '').trimEnd()
}

function MetaBand({ run, modelName }) {
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
      {run.meta?.providerLabel && (
        <span className="px-3 py-1 bg-surface-container rounded-full font-bold">{run.meta.providerLabel}</span>
      )}
      {modelName && (
        <span className="px-3 py-1 bg-surface-container rounded-full font-mono">{modelName}</span>
      )}
      {elapsed && <span>{formatElapsed(elapsed)}</span>}
    </div>
  )
}

export default function Compare() {
  const { analysisKey, analysisProvider, hasAnalysisKey } = useAuth()
  const { getRun, startRun, completeRun, failRun, clearRun } = useAnalysisRuns()

  const run = getRun('compare')
  const [urls, setUrls] = useState(() => run?.input?.urls || { target: '', compA: '', compB: '' })

  const loading = run?.status === 'running'
  const error = run?.status === 'failed' ? run.error : null
  const result = run?.result || null
  const providerLabel = getAnalysisProviderLabel(analysisProvider)
  const canSubmit = urls.target && (urls.compA || urls.compB) && hasAnalysisKey && !loading

  const handleScan = useCallback(async () => {
    if (!analysisKey || !analysisProvider) return

    startRun('compare', { urls })

    try {
      const urlList = [urls.target, urls.compA, urls.compB].filter(Boolean)

      const data = await scan(urlList, {
        apiKey: analysisKey,
        provider: analysisProvider,
      })

      const scanError = getScanErrorMessage(data)

      if (scanError) {
        failRun('compare', scanError)
        return
      }

      completeRun('compare', data, {
        run_id: data.run_id,
        providerLabel,
      })
    } catch (e) {
      failRun('compare', e.message || '分析に失敗しました。しばらく待って再試行してください。')
    }
  }, [
    urls,
    analysisKey,
    analysisProvider,
    providerLabel,
    startRun,
    completeRun,
    failRun,
  ])

  const handleRetry = useCallback(() => {
    clearRun('compare')
  }, [clearRun])

  const overallScore = result?.overall_score ?? result?.score ?? null
  const scores = result?.scores ?? {}
  const hasScores = overallScore != null || Object.values(scores).some((v) => v != null)
  const rawReport = result?.report_md ?? result?.report ?? result?.analysis ?? ''
  const executionMeta = parseExecutionMeta(rawReport)
  const report = executionMeta ? stripExecutionMeta(rawReport) : rawReport
  const modelName = executionMeta?.model?.value || extractModelFromReport(rawReport)
  const executionMetaEntries = getExecutionMetaEntries(executionMeta, {
    providerLabel: run?.meta?.providerLabel,
    modelName,
  })
  const extracted = result?.extracted ?? null
  const siteCards = [
    { key: 'target', label: '自社 LP', subtitle: 'Control', url: urls.target },
    { key: 'compA', label: '競合 A', subtitle: 'Competitor Alpha', url: urls.compA },
    { key: 'compB', label: '競合 B', subtitle: 'Competitor Beta', url: urls.compB },
  ].filter((site) => site.url)

  return (
    <div className="p-10 max-w-[1400px] mx-auto space-y-10">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-[2.75rem] font-extrabold text-on-surface tracking-tight japanese-text">LP比較・競合分析</h2>
          <p className="text-secondary max-w-2xl mt-2">自社と競合のLPを並列比較し、AIが戦略的な改善点を提示します</p>
        </div>
        <span className="inline-flex items-center gap-2 px-4 py-2 bg-surface-container rounded-full text-sm font-bold text-secondary">
          <span className="material-symbols-outlined text-sm">auto_awesome</span>
          AI POWERED
        </span>
      </div>

      <div className="flex items-center gap-3 bg-surface-container rounded-[0.75rem] px-5 py-3 text-sm text-on-surface-variant">
        <span className="material-symbols-outlined text-lg">info</span>
        <span className="japanese-text">LP比較分析は分析用 Claude API キーを Market Lens backend に送信して実行します。Gemini は分析に使わず、レポートのモデル名には backend が返した実行モデルをそのまま表示します。</span>
      </div>
      {!hasAnalysisKey && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-[0.75rem] px-5 py-3 text-sm text-amber-800">
          <span className="material-symbols-outlined text-lg">warning</span>
          <span className="japanese-text">LP比較分析には Claude API キーが必要です。設定画面から設定してください。</span>
        </div>
      )}

      {/* URL Inputs */}
      <div className="bg-surface-container-lowest p-8 rounded-xl ghost-border">
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
                  className="w-full bg-surface-container-low rounded-[0.75rem] py-4 pl-10 pr-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-secondary transition-all"
                  placeholder={placeholder}
                  value={urls[key]}
                  onChange={(e) => setUrls({ ...urls, [key]: e.target.value })}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <div className="flex flex-col items-end gap-2">
          <button
            className="button-primary disabled:opacity-50 disabled:cursor-not-allowed"
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
      {run && run.status !== 'failed' && <MetaBand run={run} modelName={modelName} />}

      {/* Analysis Targets */}
      {siteCards.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-bold text-on-surface japanese-text">分析対象サイト</h3>
              <p className="text-sm text-on-surface-variant japanese-text">
                埋め込みプレビューはサイト側で拒否されやすいため廃止し、分析対象だけを明示しています。
              </p>
            </div>
            <span className="text-xs text-on-surface-variant">{siteCards.length} 件を比較</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {siteCards.map((site) => (
              <div
                key={site.key}
                className="bg-surface-container-lowest rounded-[0.75rem] panel-card-hover p-6 space-y-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-on-surface-variant uppercase tracking-[0.15em]">{site.subtitle}</p>
                    <h4 className="text-lg font-bold text-on-surface japanese-text mt-1">{site.label}</h4>
                  </div>
                  <a
                    href={site.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 w-10 h-10 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-primary transition-colors"
                    aria-label={`${site.label} を新しいタブで開く`}
                  >
                    <span className="material-symbols-outlined text-lg">open_in_new</span>
                  </a>
                </div>

                <div className="rounded-[0.75rem] bg-surface-container p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-bold text-on-surface">
                    <span className="material-symbols-outlined text-secondary text-base">language</span>
                    {getHostname(site.url) || 'URL確認待ち'}
                  </div>
                  <p className="text-xs text-on-surface-variant break-all">{site.url}</p>
                </div>

                <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                  <span className="material-symbols-outlined text-sm">bolt</span>
                  実際の取得と比較分析はサーバー側で実行されます
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Result Area */}
      {result && (
        <div className="space-y-8">
          {/* Score Header — full-width prominent score display */}
          {hasScores && (
            <div className="bg-gradient-to-br from-primary-container to-[#2a2a4e] p-8 rounded-[0.75rem] text-white">
              <div className="flex items-center gap-10">
                <div className="shrink-0">
                  <p className="text-xs uppercase tracking-[0.2em] font-bold text-white/70">OVERALL STRATEGY SCORE</p>
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-7xl font-black tabular-nums text-primary-container">{overallScore ?? '--'}</span>
                    <span className="text-2xl font-bold text-white/50">/100</span>
                  </div>
                </div>
                <div className="flex-1 grid grid-cols-2 lg:grid-cols-5 gap-4 text-sm">
                  {scores.ux != null && <div className="text-center"><span className="block text-xs text-white/60 mb-1">UXコンバージョン率</span><span className="text-2xl font-bold">{scores.ux}</span></div>}
                  {scores.conversion != null && <div className="text-center"><span className="block text-xs text-white/60 mb-1">コンバージョン</span><span className="text-2xl font-bold">{scores.conversion}</span></div>}
                  {scores.brand != null && <div className="text-center"><span className="block text-xs text-white/60 mb-1">ブランド信頼性</span><span className="text-2xl font-bold">{scores.brand}</span></div>}
                  {scores.trust != null && <div className="text-center"><span className="block text-xs text-white/60 mb-1">信頼性</span><span className="text-2xl font-bold">{scores.trust}</span></div>}
                  {scores.seo != null && <div className="text-center"><span className="block text-xs text-white/60 mb-1">SEO最適化</span><span className="text-2xl font-bold">{scores.seo}</span></div>}
                </div>
              </div>
              {result?.summary && (
                <p className="mt-6 text-xs leading-relaxed opacity-80 max-w-3xl">{result.summary}</p>
              )}
            </div>
          )}

          {/* Report — primary display with green left accent */}
          <div className={`max-w-4xl mx-auto bg-surface-container-lowest rounded-[0.75rem] panel-card-hover p-8 min-h-[300px] ${hasScores ? 'border-l-4 border-primary-container' : ''}`}>
            <div className="flex items-center gap-2 text-on-surface-variant mb-6">
              <span className="material-symbols-outlined text-secondary">description</span>
              <span className="text-sm font-bold">分析レポート</span>
            </div>
            {extracted && (
              <div className="mb-6 p-4 bg-surface-container rounded-[0.75rem] text-sm space-y-2">
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

          {/* Execution Metadata — structured display */}
          {executionMeta && (
            <div className="max-w-4xl mx-auto bg-surface-container-lowest rounded-[0.75rem] p-6">
              <div className="flex items-center gap-2 text-on-surface-variant mb-4">
                <span className="material-symbols-outlined text-secondary text-base">info</span>
                <span className="text-xs font-bold uppercase tracking-widest">実行メタデータ</span>
              </div>
              <p className="text-xs text-on-surface-variant mb-4 japanese-text">
                ここには LP比較分析 backend が返した実行情報を表示しています。
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {executionMetaEntries.map(({ key, label, value }) => (
                  <div key={key} className="rounded-xl px-4 py-3 bg-surface-container">
                    <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1">{label}</p>
                    <p className="text-sm font-mono font-bold truncate text-on-surface" title={value}>
                      {value}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty State — before any scan */}
      {!result && !error && !loading && (
        <div className="bg-surface-container-lowest rounded-[0.75rem] panel-card-hover p-8 min-h-[200px]">
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
