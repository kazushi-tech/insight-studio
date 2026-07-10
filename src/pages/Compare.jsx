import { useState, useCallback, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { scan, startScanJob, getScanJob, classifyError, warmMarketLensBackend } from '../api/marketLens'
import MarkdownRenderer from '../components/MarkdownRenderer'
import DataCoverageCard from '../components/DataCoverageCard'
import { LoadingSpinner, ErrorBanner } from '../components/ui'
import { useAnalysisRuns } from '../contexts/AnalysisRunsContext'
import { useAuth } from '../contexts/AuthContext'
import { getAnalysisModel, getAnalysisProviderLabel } from '../utils/analysisProvider'
import { getScoreLabel } from '../utils/scoreThresholds'
import { copyReportToClipboard, buildCompareReportText } from '../utils/reportExport'
import { recordScore, getPreviousScore, formatScoreDelta } from '../utils/scoreHistory'
import { checkReportQuality, splitReportSections, stripModelDates, stripTruncatedTables } from '../utils/reportQuality'
import PrintButton from '../components/report/PrintButton'
import ReportQualityBadge from '../components/report/ReportQualityBadge'
import ReportViewV2 from '../components/report/v2/ReportViewV2'
import AiContextRail from '../components/ai-assistant/AiContextRail'
import { extractCompetitiveSet, extractKpis } from '../utils/kpiExtractor'
import { useReportEnvelope } from '../hooks/useReportEnvelope'
import { useAsyncJob } from '../hooks/useAsyncJob'

// ─── Constants ───────────────────────────────────────────────

const SCAN_POLL_HARD_CEILING_MS = 660_000  // 11 min — backend overall 600s + 60s 余裕
const SCAN_POLL_STALE_TIMEOUT_MS = 90_000
const SCAN_POLL_SOFT_WARNING_MS = 300_000

const SCAN_STAGE_LABELS = {
  queued: 'ジョブ準備中…',
  fetching_lps: 'LP を取得中…',
  analyzing: '比較分析中…',
  complete: '完了',
  failed: 'エラー',
}

function getReadableScoreLabel(score) {
  const { color } = getScoreLabel(score)
  if (score >= 80) return { label: '特に良い', color }
  if (score >= 60) return { label: '良い', color }
  if (score >= 40) return { label: '見直し余地あり', color }
  return { label: '優先して見直す', color }
}

// Pseudo-stage messages cycling based on elapsed time (fallback when no real stage)
function getPseudoStageMessage(elapsedMs) {
  if (!elapsedMs) return null
  const sec = elapsedMs / 1000
  if (sec < 20) return 'サーバー起動中…'
  if (sec < 60) return 'AI がブランド情報を解析中…'
  if (sec < 150) return '競合 LP を取得中…'
  if (sec < 360) return '比較レポートを生成中…'
  return 'AI 分析の最終仕上げ中…'
}

// ─── sessionStorage helpers ──────────────────────────────────

const ACTIVE_SCAN_JOB_KEY = 'is-compare-active-scan-job'

function persistActiveScanJob(jobId, pollUrl, urls) {
  try {
    sessionStorage.setItem(ACTIVE_SCAN_JOB_KEY, JSON.stringify({ jobId, pollUrl, urls, startedAt: Date.now() }))
  } catch { /* intentionally empty */ }
}
function clearActiveScanJob() {
  try { sessionStorage.removeItem(ACTIVE_SCAN_JOB_KEY) } catch { /* intentionally empty */ }
}
function getActiveScanJob() {
  try {
    const raw = sessionStorage.getItem(ACTIVE_SCAN_JOB_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Date.now() - parsed.startedAt > SCAN_POLL_HARD_CEILING_MS) { clearActiveScanJob(); return null }
    return parsed
  } catch { return null }
}

// ─── Utility functions ───────────────────────────────────────

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

function isScanJobFallbackEligible(error) {
  const status = Number(error?.status || 0)
  const msg = String(error?.message || '').toLowerCase()
  return error?.isTimeout ||
    error?.name === 'AbortError' ||
    status === 502 ||
    status === 503 ||
    status === 529 ||
    msg.includes('timeout') ||
    msg.includes('タイムアウト') ||
    msg.includes('overloaded')
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
  return 'server-side analysis'
}

function getExecutionMetaEntries(executionMeta, { providerLabel, modelName }) {
  if (!executionMeta) return []
  return [
    { key: 'route', label: '実行経路', value: '競合分析サービス' },
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

// ─── MetaBand ────────────────────────────────────────────────

function MetaBand({ run, modelName, now }) {
  if (!run || run.status === 'idle') return null
  const result = run.result
  const elapsed = run.startedAt && run.finishedAt ? run.finishedAt - run.startedAt : null
  const runningElapsed = run.startedAt && run.status === 'running'
    ? Math.max(0, now - run.startedAt)
    : null
  const recovering = Boolean(run.meta?.recoveryMode)

  const stage = run.meta?.stage
  const progressPct = run.meta?.progress_pct
  const stageLabel = stage ? SCAN_STAGE_LABELS[stage] || stage : null
  const pseudoStageMsg = run.status === 'running' && !stageLabel
    ? getPseudoStageMessage(runningElapsed)
    : null
  const statusLabel = run.meta?.statusLabel

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-4 text-xs text-on-surface-variant">
        <span className="flex items-center gap-1.5 px-3 py-1 bg-surface-container rounded-full font-bold">
          <span className={`w-1.5 h-1.5 rounded-full ${
            run.status === 'running' ? 'bg-amber-400 animate-pulse' :
            run.status === 'completed' ? 'bg-emerald-500' :
            'bg-red-400'
          }`} />
          {run.status === 'running'
            ? (statusLabel || stageLabel || pseudoStageMsg || '分析中…')
            : run.status === 'completed' ? '完了' : 'エラー'}
        </span>
        {result?.run_id && <span className="text-outline font-mono">run: {result.run_id}</span>}
        {result?.status && result.status !== run.status && (
          <span className="px-3 py-1 bg-surface-container rounded-full font-bold">{result.status}</span>
        )}
        {run.meta?.providerLabel && (
          <span className="px-3 py-1 bg-surface-container rounded-full font-bold">{run.meta.providerLabel}</span>
        )}
        {recovering && (
          <span className="px-3 py-1 bg-sky-50 dark:bg-info-container text-sky-700 dark:text-on-info-container rounded-full font-bold">履歴確認中</span>
        )}
        {modelName && (
          <span className="px-3 py-1 bg-surface-container rounded-full font-mono">{modelName}</span>
        )}
        {runningElapsed != null && (
          <span className="text-on-surface-variant">{formatElapsed(runningElapsed)} 経過</span>
        )}
        {elapsed != null && run.status !== 'running' && (
          <span className="text-on-surface-variant">{formatElapsed(elapsed)}</span>
        )}
        {run.status === 'running' && runningElapsed == null && (
          <span className="text-xs text-amber-600 dark:text-warning">通常 3〜10 分</span>
        )}
      </div>
      {/* Progress bar */}
      {run.status === 'running' && progressPct != null && (
        <div className="w-full bg-surface-container rounded-full h-1.5 overflow-hidden">
          <div
            className="h-full bg-secondary rounded-full transition-all duration-700 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}
      {run.status === 'running' && progressPct == null && (
        <div className="w-full bg-surface-container rounded-full h-1.5 overflow-hidden">
          <div className="h-full bg-amber-400 rounded-full animate-pulse" style={{ width: '100%' }} />
        </div>
      )}
    </div>
  )
}

// ─── ExtractedDataPanel ──────────────────────────────────────

const EXTRACTED_LABELS = {
  title: 'タイトル',
  meta_description: 'Meta Description',
  og_type: 'OG Type',
  h1: 'H1',
  hero_copy: 'Hero Copy',
  main_cta: 'Main CTA',
  secondary_ctas: 'Secondary CTAs',
  pricing_snippet: 'Pricing',
  feature_bullets: 'Features',
  faq_items: 'FAQ',
  testimonials: '顧客の声',
  body_text_snippet: '本文抜粋',
}

function hasValue(v) {
  if (v == null || v === '') return false
  if (Array.isArray(v) && v.length === 0) return false
  return true
}

function formatValue(v) {
  if (Array.isArray(v)) return v.join(' / ')
  if (typeof v === 'string' && v.length > 200) return v.slice(0, 200) + '…'
  return String(v)
}

function ExtractedDataPanel({ extracted }) {
  const items = Array.isArray(extracted) ? extracted : [extracted]
  const [open, setOpen] = useState(false)

  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-xs font-bold text-on-surface-variant uppercase tracking-widest hover:text-on-surface transition-colors"
      >
        <span className={`material-symbols-outlined text-sm transition-transform ${open ? 'rotate-90' : ''}`}>
          chevron_right
        </span>
        抽出データ ({items.length} サイト)
      </button>
      {open && (
        <div className="mt-3 space-y-4">
          {items.map((site, i) => {
            const available = Object.entries(EXTRACTED_LABELS).filter(([key]) => hasValue(site[key]))
            const total = Object.keys(EXTRACTED_LABELS).length
            return (
              <div key={site.url || i} className="p-4 bg-surface-container rounded-[0.75rem] text-sm space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-on-surface truncate max-w-[70%]">{site.url}</p>
                  <span className="text-xs text-on-surface-variant">{available.length}/{total} 取得成功</span>
                </div>
                {site.error && (
                  <p className="text-xs text-red-500">エラー: {site.error}</p>
                )}
                <div className="grid grid-cols-1 gap-1.5">
                  {available.map(([key, label]) => (
                    <div key={key} className="flex gap-2 text-xs">
                      <span className="font-bold text-on-surface-variant shrink-0 w-32">{label}</span>
                      <span className="text-on-surface break-all">{formatValue(site[key])}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CompareImage2Guide({ providerLabel }) {
  return (
    <details className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-5 shadow-sm">
      <summary className="cursor-pointer list-none focus-visible:ring-2 focus-visible:ring-secondary">
        <span className="flex items-center justify-between gap-4">
          <span>
            <strong className="block text-sm text-on-surface japanese-text">この分析で分かること</strong>
            <span className="mt-1 block text-xs text-on-surface-variant japanese-text">入力前に確認したい場合だけ開いてください</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary/[0.06] px-3 py-2 text-xs font-bold text-primary">
            {providerLabel}
            <span className="material-symbols-outlined text-base" aria-hidden="true">expand_more</span>
          </span>
        </span>
      </summary>
      <div className="mt-5 border-t border-outline-variant/15 pt-5">
        <p className="max-w-3xl text-sm leading-7 text-on-surface-variant japanese-text">
          公開ページに書かれている内容を読み取り、訴求・行動ボタン・信頼材料の違いと、見直す順番を整理します。
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          {[
            ['1', 'URLを入力', '自社LPと競合LPを最大2件まで指定'],
            ['2', '違いを確認', '訴求・行動ボタン・信頼材料を比較'],
            ['3', '直す順番を決める', 'AIの評価を参考に人が最終判断'],
          ].map(([step, title, body]) => (
            <article key={step} className="rounded-xl border border-outline-variant/15 bg-surface-container-low p-4">
              <span className="inline-grid size-8 place-items-center rounded-lg bg-primary text-on-primary text-sm font-black">{step}</span>
              <h3 className="mt-3 text-sm font-extrabold text-on-surface japanese-text">{title}</h3>
              <p className="mt-2 text-xs leading-6 text-on-surface-variant japanese-text">{body}</p>
            </article>
          ))}
        </div>
      </div>
    </details>
  )
}

// ─── Main Component ──────────────────────────────────────────

export default function Compare() {
  const { analysisKey, analysisProvider, hasAnalysisKey } = useAuth()
  const { getRun, startRun, updateRunMeta, completeRun, failRun, clearRun, getDraft, setDraft } = useAnalysisRuns()
  const { pollJob, stopPolling } = useAsyncJob()

  // Warm up backend on mount (cold-start mitigation)
  useEffect(() => {
    void warmMarketLensBackend()
  }, [])

  const run = getRun('compare')
  const defaults = { target: '', compA: '', compB: '' }

  // Must run BEFORE the urls useState that calls getActiveScanJob() and clears expired entries
  const [expiredJobNotice, setExpiredJobNotice] = useState(() => {
    try {
      const raw = sessionStorage.getItem(ACTIVE_SCAN_JOB_KEY)
      if (!raw) return false
      const parsed = JSON.parse(raw)
      return !!(parsed?.startedAt && Date.now() - parsed.startedAt > SCAN_POLL_HARD_CEILING_MS)
    } catch { return false }
  })

  const [urls, setUrls] = useState(() => getDraft('compare')?.urls || run?.input?.urls || getActiveScanJob()?.urls || defaults)

  // Real-time elapsed ticker
  const [tickNow, setTickNow] = useState(() => Date.now())
  useEffect(() => {
    const loading = run?.status === 'running'
    if (!loading) return undefined
    const id = window.setInterval(() => setTickNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [run?.status])

  const loading = run?.status === 'running'
  const error = run?.status === 'failed' ? run.error : null
  const errorInfo = run?.status === 'failed' ? run.errorInfo : null
  const result = run?.result || null
  const { envelope: scanEnvelope } = useReportEnvelope(
    result?.run_id ? 'scan' : null,
    result?.run_id || null,
  )
  const discoveryRun = getRun('discovery')
  const discoveryResult = discoveryRun?.status === 'completed' ? discoveryRun.result : null
  const recoveryMode = loading && Boolean(run?.meta?.recoveryMode)
  const recoveryMessage = run?.meta?.recoveryMessage || 'タイムアウト後の完了結果を確認しています…'
  const recoveredFromHistory = run?.status === 'completed' && Boolean(run?.meta?.recoveredFromHistory)
  const providerLabel = getAnalysisProviderLabel(analysisProvider)
  const canSubmit = urls.target && (urls.compA || urls.compB) && hasAnalysisKey && !loading

  // ─── Job handlers ─────────────────────────────────────────

  const handleJobComplete = useCallback((result) => {
    clearActiveScanJob()
    const scanError = getScanErrorMessage(result)
    if (scanError) {
      failRun('compare', scanError, {
        category: 'upstream', label: 'バックエンドエラー',
        guidance: 'サーバー側の分析でエラーが発生しました。入力URLや条件を変えて再試行してください。',
        retryable: true,
      })
      return
    }
    completeRun('compare', result, { run_id: result.run_id, providerLabel })
    const finalScore = result.overall_score ?? result.score
    if (finalScore != null) {
      recordScore('compare', { score: finalScore, label: urls.target, timestamp: Date.now() })
    }
  }, [failRun, completeRun, providerLabel, urls.target])

  const handleJobFail = useCallback((message, info) => {
    clearActiveScanJob()
    failRun('compare', message, info)
  }, [failRun])

  const handleJobProgress = useCallback(({ stage, progress_pct, message, statusLabel }) => {
    updateRunMeta('compare', { stage, progress_pct, message, statusLabel })
  }, [updateRunMeta])

  // ─── Resume active job on mount ───────────────────────────

  const resumeAttemptedRef = useRef(false)
  useEffect(() => {
    if (resumeAttemptedRef.current) return
    resumeAttemptedRef.current = true

    // expiredJobNotice is already set via useState initializer (runs before getActiveScanJob clears it)
    const activeJob = getActiveScanJob()
    if (!activeJob) return

    if (!run || run.status === 'idle') {
      startRun('compare', { urls: activeJob.urls })
    }

    updateRunMeta('compare', {
      stage: 'analyzing',
      statusLabel: '前回のジョブを再開中…',
      jobId: activeJob.jobId,
    })

    pollJob(activeJob.pollUrl, {
      fetchJobStatus: getScanJob,
      onComplete: handleJobComplete,
      onFail: handleJobFail,
      onProgress: handleJobProgress,
      intervalMs: 3000,
      hardCeilingMs: SCAN_POLL_HARD_CEILING_MS,
      staleTimeoutMs: SCAN_POLL_STALE_TIMEOUT_MS,
      softWarningMs: SCAN_POLL_SOFT_WARNING_MS,
      resetStartTime: true,
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- mount only

  // ─── handleScan ───────────────────────────────────────────

  const handleScan = useCallback(async () => {
    console.info('[Compare] handleScan called', { target: urls.target, compA: urls.compA, compB: urls.compB })
    if (!analysisKey || !analysisProvider) {
      console.warn('[Compare] Missing auth', { hasKey: !!analysisKey, hasProvider: !!analysisProvider })
      startRun('compare', { urls })
      failRun('compare', 'APIキーまたはプロバイダーが設定されていません。設定画面を確認してください。', {
        category: 'auth_error', label: '設定不足',
        guidance: '設定 → AI設定 から Gemini または Claude の分析用 API キーを入力してください。', retryable: false,
      })
      return
    }

    const urlList = [urls.target, urls.compA, urls.compB].filter(Boolean)
    stopPolling()
    startRun('compare', { urls })
    updateRunMeta('compare', { providerLabel })

    try {
      updateRunMeta('compare', { statusLabel: 'サーバー起動待ち…' })

      let warmResult
      try {
        warmResult = await Promise.race([
          warmMarketLensBackend(),
          new Promise((_, reject) =>
            setTimeout(() => reject(Object.assign(
              new Error('サーバーへの接続がタイムアウトしました。再試行してください。'),
              { isWarmupTimeout: true },
            )), 45_000)
          ),
        ])
      } catch (warmErr) {
        if (warmErr.isWarmupTimeout) {
          failRun('compare', warmErr.message, {
            category: 'timeout', label: '接続タイムアウト',
            guidance: 'サーバーへの接続に時間がかかりすぎました。再試行してください。',
            retryable: true,
          })
        } else {
          failRun('compare', warmErr.message || 'サーバー起動に失敗しました。', {
            category: 'cold_start', label: 'サーバー起動失敗',
            guidance: 'バックエンドが起動できませんでした。', retryable: true,
          })
        }
        return
      }
      if (!warmResult) {
        failRun('compare', 'サーバー起動に失敗しました。しばらく待って再試行してください。', {
          category: 'cold_start', label: 'サーバー起動失敗',
          guidance: 'バックエンドが起動できませんでした。ネットワーク接続を確認してください。',
          retryable: true,
        })
        return
      }
      console.info('[Compare] Backend warm, submitting scan job')

      const requestOptions = {
        apiKey: analysisKey,
        provider: analysisProvider,
        model: getAnalysisModel(analysisProvider),
      }

      let jobData
      try {
        jobData = await startScanJob(urlList, requestOptions)
      } catch (jobError) {
        if (!isScanJobFallbackEligible(jobError)) throw jobError

        console.warn('[Compare] scan job creation failed; falling back to sync scan', {
          status: jobError.status,
          message: jobError.message,
        })
        updateRunMeta('compare', {
          stage: 'analyzing',
          statusLabel: 'ジョブ開始に失敗したため、同期分析で復旧中…',
          fallbackMode: true,
        })

        const fallbackResult = await scan(urlList, requestOptions)
        handleJobComplete(fallbackResult)
        updateRunMeta('compare', {
          fallbackMode: true,
          recoveredFromJobStartFailure: true,
          providerLabel,
        })
        return
      }

      console.info('[Compare] Scan job started', { jobId: jobData.job_id, pollUrl: jobData.poll_url })
      persistActiveScanJob(jobData.job_id, jobData.poll_url, urls)
      updateRunMeta('compare', {
        jobId: jobData.job_id,
        stage: 'queued',
        progress_pct: 0,
        statusLabel: null,
      })

      pollJob(jobData.poll_url, {
        fetchJobStatus: getScanJob,
        onComplete: handleJobComplete,
        onFail: handleJobFail,
        onProgress: handleJobProgress,
        intervalMs: Number(jobData.retry_after_sec) > 0 ? Number(jobData.retry_after_sec) * 1000 : 3000,
        hardCeilingMs: SCAN_POLL_HARD_CEILING_MS,
        staleTimeoutMs: SCAN_POLL_STALE_TIMEOUT_MS,
        softWarningMs: SCAN_POLL_SOFT_WARNING_MS,
        resetStartTime: true,
      })
    } catch (e) {
      const info = classifyError(e)
      failRun('compare', e.message || '分析に失敗しました。しばらく待って再試行してください。', info)
    }
  }, [
    urls,
    analysisKey,
    analysisProvider,
    providerLabel,
    startRun,
    updateRunMeta,
    failRun,
    stopPolling,
    pollJob,
    handleJobComplete,
    handleJobFail,
    handleJobProgress,
  ])

  const handleRetry = useCallback(() => {
    stopPolling()
    clearActiveScanJob()
    clearRun('compare')
  }, [clearRun, stopPolling])

  const handleCancel = useCallback(() => {
    stopPolling()
    clearActiveScanJob()
    clearRun('compare')
    console.info('[Compare] Job cancelled by user')
  }, [stopPolling, clearRun])

  const overallScore = result?.overall_score ?? result?.score ?? null
  const scores = result?.scores ?? {}
  const hasScores = overallScore != null || Object.values(scores).some((v) => v != null)
  const rawReport = result?.report_md ?? result?.report ?? result?.analysis ?? ''
  const executionMeta = parseExecutionMeta(rawReport)
  const strippedReport = executionMeta ? stripExecutionMeta(rawReport) : rawReport
  const backendQuality = {
    qualityStatus: result?.quality_status,
    qualityIssues: result?.quality_issues,
    qualityIsCritical: result?.quality_is_critical,
  }
  const { body: reportBody, appendix: reportAppendix } = splitReportSections(strippedReport)
  const report = stripTruncatedTables(stripModelDates(reportBody))
  const { issues: qualityIssues } = checkReportQuality(strippedReport, backendQuality)
  const modelName = executionMeta?.model?.value || extractModelFromReport(rawReport)
  const executionMetaEntries = getExecutionMetaEntries(executionMeta, {
    providerLabel: run?.meta?.providerLabel,
    modelName,
  })
  const extracted = result?.extracted ?? null
  const siteCards = [
    { key: 'target', label: '自社 LP', subtitle: '比較基準', url: urls.target },
    { key: 'compA', label: '競合 A', subtitle: '競合候補 A', url: urls.compA },
    { key: 'compB', label: '競合 B', subtitle: '競合候補 B', url: urls.compB },
  ].filter((site) => site.url)
  const compareRailStatus = loading ? '分析中' : error ? 'エラー' : result ? 'レポート生成済み' : '入力待ち'
  const compareRailInput = siteCards.length > 0
    ? siteCards.map((site) => getHostname(site.url) || site.label).join(' / ')
    : 'URL未入力'

  return (
    <div className={`mx-auto grid w-full max-w-[1480px] grid-cols-1 gap-6 p-4 sm:p-6 2xl:p-8 ${result ? '2xl:grid-cols-[minmax(0,1fr)_336px] 2xl:items-start' : ''}`}>
      {/* Header */}
      <div className="min-w-0">
        <span className="inline-flex items-center gap-2 rounded-full bg-primary/[0.07] px-3 py-1.5 text-xs font-bold text-primary japanese-text">
          <span className="material-symbols-outlined text-base" aria-hidden="true">compare_arrows</span>
          競合LP比較
        </span>
        <h1 className="mt-4 text-3xl font-black tracking-tight text-on-surface sm:text-4xl japanese-text">自社と競合のページを比べる</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-on-surface-variant sm:text-base japanese-text">
          自社ページと競合ページの公開情報を読み取り、伝え方や行動ボタンの違いを整理します。
        </p>
      </div>

      {result && (
        <AiContextRail
          className="hidden 2xl:col-start-2 2xl:row-start-1 2xl:row-span-[99] 2xl:block"
          screenName="LP比較アシスタント"
          status={compareRailStatus}
          inputSummary={compareRailInput}
          evidence={['CTA差分', '信頼要素', 'オファー', 'ファネル段階']}
          suggestedQuestions={[
            '競合AがCVRで優位な理由を詳しく分析して',
            '不足している証拠だけを一覧にして',
            '最初に直すCTAを1つに絞って',
          ]}
          questionGroups={[
            {
              title: 'この結果について',
              questions: [
                'オファー訴求を強化する具体策を提案して',
                '信頼要素で強化すべきポイントは？',
                'LPの離脱ポイントを推定して',
              ],
            },
            {
              title: '比較条件',
              questions: [
                '自社と競合の比較条件を確認して',
                '未取得データが判断へ与える影響は？',
              ],
            },
          ]}
          contextItems={[
            '観測事実とAI推論を分けて確認',
            'CTA・オファー・信頼要素を優先',
            '不足根拠は施策化前に再確認',
          ]}
          nextActions={[
            { label: '競合を探す', to: '/discovery', icon: 'travel_explore', primary: true },
            { label: 'ホームに戻る', to: '/', icon: 'home' },
          ]}
          primaryAction="LP比較レポートを広告施策へ落とし込む"
          primaryActionLabel="AI考察で深掘り"
          helperText="比較結果を読みながら、競合妥当性・獲得影響・欠損根拠を確認します。"
        />
      )}

      {hasAnalysisKey ? (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200/70 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-900 dark:border-success/30 dark:bg-success-container dark:text-on-success-container">
          <span className="material-symbols-outlined mt-0.5 text-lg" aria-hidden="true">check_circle</span>
          <span className="japanese-text"><strong>分析の準備はできています。</strong> 現在は {providerLabel} を使用します。</span>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-warning/30 dark:bg-warning-container dark:text-on-warning-container sm:flex-row sm:items-center">
          <span className="material-symbols-outlined text-lg" aria-hidden="true">key</span>
          <span className="flex-1 japanese-text"><strong>分析用 API キーが必要です。</strong> Gemini または Claude のキーを登録すると実行できます。</span>
          <Link to="/settings" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-amber-900 px-4 py-2 text-sm font-bold text-white focus-visible:ring-2 focus-visible:ring-secondary dark:bg-warning dark:text-on-warning">
            設定画面を開く
          </Link>
        </div>
      )}

      {/* URL Inputs */}
      <section className="min-w-0 rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-5 shadow-sm sm:p-6">
        <div className="mb-5">
          <h2 className="text-lg font-extrabold text-on-surface japanese-text">比較するページを入力</h2>
          <p className="mt-1 text-sm text-on-surface-variant japanese-text">自社URLと、競合URLを1件以上入力してください。</p>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-3">
          {[
            { key: 'target', label: '自社URL', placeholder: '例: https://your-site.jp/lp01…' },
            { key: 'compA', label: '競合URL A', placeholder: '例: https://competitor-a.com/landing…' },
            { key: 'compB', label: '競合URL B', placeholder: '例: https://competitor-b.com/campaign…' },
          ].map(({ key, label, placeholder }) => (
            <div key={key}>
              <label htmlFor={`compare-url-${key}`} className="text-sm font-bold text-on-surface-variant mb-2 block japanese-text">{label}</label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg" aria-hidden="true">link</span>
                <input
                  id={`compare-url-${key}`}
                  name={`compare-url-${key}`}
                  type="url"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full bg-surface-container-low rounded-[0.75rem] py-4 pl-10 pr-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-secondary transition-[box-shadow,background-color]"
                  placeholder={placeholder}
                  value={urls[key]}
                  onChange={(e) => {
                    const next = { ...urls, [key]: e.target.value }
                    setUrls(next)
                    setDraft('compare', { urls: next })
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-col gap-3 border-t border-outline-variant/15 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-6 text-on-surface-variant japanese-text">分析には通常3〜10分かかります。処理中に別の画面へ移動しても再開できます。</p>
          <div className="flex shrink-0 items-center gap-3">
            {loading && (
              <button
                className="inline-flex items-center gap-2 px-4 py-2 rounded-[0.75rem] bg-surface-container hover:bg-surface-container-high text-on-surface-variant text-sm font-bold transition-colors"
                onClick={handleCancel}
              >
                <span className="material-symbols-outlined text-lg">cancel</span>
                キャンセル
              </button>
            )}
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
          </div>
        </div>
      </section>

      {!result && <CompareImage2Guide providerLabel={providerLabel} />}

      {error && (
        <ErrorBanner message={error} onRetry={handleRetry} errorInfo={errorInfo} />
      )}

      {expiredJobNotice && (
        <div className="flex items-center gap-3 rounded-[0.75rem] border border-amber-200 bg-amber-50 dark:bg-warning-container dark:border-warning/30 px-5 py-3 text-sm text-amber-800 dark:text-on-warning-container">
          <span className="material-symbols-outlined text-lg">timer_off</span>
          <span className="japanese-text flex-1">前回のジョブはタイムアウト上限（11分）を超えました。URLを確認して再実行してください。</span>
          <button
            className="shrink-0 hover:opacity-70 transition-opacity"
            onClick={() => setExpiredJobNotice(false)}
            aria-label="閉じる"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      )}

      {recoveryMode && (
        <div className="flex items-center gap-3 rounded-[0.75rem] border border-sky-200 dark:border-info/30 bg-sky-50 dark:bg-info-container px-5 py-3 text-sm text-sky-800 dark:text-on-info-container">
          <span className="material-symbols-outlined text-lg">history</span>
          <span className="japanese-text">{recoveryMessage}</span>
        </div>
      )}

      {recoveredFromHistory && (
        <div className="flex items-center gap-3 rounded-[0.75rem] border border-emerald-200 dark:border-success/30 bg-emerald-50 dark:bg-success-container px-5 py-3 text-sm text-emerald-800 dark:text-on-success-container">
          <span className="material-symbols-outlined text-lg">task_alt</span>
          <span className="japanese-text">ブラウザ側ではタイムアウトしましたが、server 側で完了していた比較結果を履歴から復旧しました。</span>
        </div>
      )}

      {/* Meta Band */}
      {run && run.status !== 'failed' && (
        <MetaBand run={run} modelName={modelName} now={tickNow} />
      )}

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
          {/* Score Header */}
          {hasScores && (
            <section className="rounded-xl border border-primary/15 bg-surface-container-lowest p-5 shadow-sm sm:p-6">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
                <div className="shrink-0 lg:w-64">
                  <p className="text-sm font-extrabold text-on-surface japanese-text">AI評価（参考値）</p>
                  <p className="mt-1 text-xs leading-6 text-on-surface-variant japanese-text">公開ページの内容から算出した目安です。実際の成果を保証する数値ではありません。</p>
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-5xl font-black tabular-nums text-primary">{overallScore ?? '--'}</span>
                    <span className="text-lg font-bold text-on-surface-variant">/100</span>
                  </div>
                  {overallScore != null && (() => {
                    const { label, color } = getReadableScoreLabel(overallScore)
                    return <span className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-bold ${color}`}>{label}</span>
                  })()}
                  {(() => {
                    const prev = getPreviousScore('compare')
                    const delta = formatScoreDelta(overallScore, prev)
                    if (!delta) return null
                    const isUp = delta.startsWith('+')
                    return (
                      <span className={`mt-2 ml-2 inline-block rounded-full px-2.5 py-1 text-xs font-bold ${isUp ? 'bg-emerald-100 text-emerald-700 dark:bg-success-container dark:text-on-success-container' : 'bg-rose-100 text-rose-700 dark:bg-error-container dark:text-on-error-container'}`}>
                        前回比 {delta}
                      </span>
                    )
                  })()}
                </div>
                <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                  {[
                    ['使いやすさ', scores.ux],
                    ['申込みへの導線', scores.conversion],
                    ['ブランドの伝わり方', scores.brand],
                    ['安心材料', scores.trust],
                    ['検索での見つけやすさ', scores.seo],
                  ].filter(([, value]) => value != null).map(([label, value]) => {
                    const scoreLabel = getReadableScoreLabel(value)
                    return (
                      <div key={label} className="rounded-xl bg-surface-container-low p-4">
                        <span className="block min-h-10 text-xs font-bold leading-5 text-on-surface-variant japanese-text">{label}</span>
                        <span className="mt-2 block text-2xl font-black tabular-nums text-on-surface">{value}</span>
                        <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${scoreLabel.color}`}>{scoreLabel.label}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
              {result?.summary && (
                <p className="mt-5 border-t border-outline-variant/15 pt-4 text-sm leading-7 text-on-surface-variant japanese-text">{result.summary}</p>
              )}
            </section>
          )}

          {/* Report */}
          <div className={`min-h-[300px] rounded-xl bg-surface-container-lowest p-5 shadow-sm sm:p-6 ${hasScores ? 'border-l-4 border-primary' : ''}`}>
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-on-surface-variant">
                <span className="material-symbols-outlined text-secondary">description</span>
                <span className="text-sm font-bold">分析レポート</span>
              </div>
              {result && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => {
                      const text = buildCompareReportText({ overallScore, scores, summary: result?.summary, report })
                      copyReportToClipboard(text)
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-container hover:bg-surface-container-high text-on-surface-variant text-xs font-bold rounded-lg transition-colors print:hidden"
                  >
                    <span className="material-symbols-outlined text-sm">content_copy</span>
                    レポートをコピー
                  </button>
                  <PrintButton />
                  <ReportQualityBadge issues={qualityIssues} />
                </div>
              )}
            </div>
            {extracted && (
              <ExtractedDataPanel extracted={extracted} />
            )}
            {report ? (
              <>
                <ReportViewV2 envelope={scanEnvelope} reportMd={rawReport || report} kind="compare" />
                <details className="mt-6 rounded-lg border border-outline-variant/15 bg-surface-container-low p-4">
                  <summary className="cursor-pointer text-sm font-bold text-on-surface japanese-text">詳細な分析文（Markdown）を表示</summary>
                  <div className="mt-4 border-t border-outline-variant/10 pt-4">
                    <MarkdownRenderer content={report} variant="discovery" />
                  </div>
                </details>
                {extracted && <DataCoverageCard extracted={extracted} className="mt-8" />}
                {/* KPI Tracking Card */}
                {(() => {
                  const kpis = extractKpis(report)
                  if (kpis.length === 0) return null
                  return (
                    <div className="mt-6 bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/8">
                      <div className="flex items-center gap-2 mb-4">
                        <span className="material-symbols-outlined text-secondary text-lg">tracking</span>
                        <span className="text-sm font-bold text-on-surface">KPI目標値</span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {kpis.map((kpi, i) => (
                          <div key={i} className="rounded-xl px-4 py-3 bg-surface-container">
                            <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1">{kpi.label}</p>
                            <p className="text-sm font-mono font-bold text-on-surface">{kpi.value}{kpi.tone === 'positive' ? ' ↑' : kpi.tone === 'negative' ? ' ↓' : ''}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}
                {/* Cross-link to Discovery report */}
                {discoveryResult?.report_md && (() => {
                  const compBrands = extractCompetitiveSet(rawReport)
                  const discBrands = extractCompetitiveSet(discoveryResult.report_md)
                  const overlap = compBrands.filter((b) => discBrands.includes(b))
                  if (overlap.length === 0) return null
                  return (
                    <div className="mt-6 bg-primary/5 rounded-2xl p-6 border border-primary/10">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="material-symbols-outlined text-primary text-lg">travel_explore</span>
                        <span className="text-sm font-bold text-primary">関連レポート</span>
                      </div>
                      <p className="text-xs text-on-surface-variant mb-3">
                        以下のブランドが競合発見レポートでも分析されています: {overlap.join('、')}
                      </p>
                      <Link
                        to="/discovery"
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary/10 text-primary text-xs font-bold rounded-lg hover:bg-primary/20 transition-colors"
                      >
                        <span className="material-symbols-outlined text-sm">open_in_new</span>
                        競合発見レポートを表示
                      </Link>
                    </div>
                  )
                })()}
                {reportAppendix && (
                  <details className="mt-8">
                    <summary className="cursor-pointer text-xs font-bold text-on-surface-variant uppercase tracking-widest hover:text-on-surface transition-colors flex items-center gap-2">
                      <span className="material-symbols-outlined text-sm">info</span>
                      Appendix（監査・再確認用）
                    </summary>
                    <div className="mt-4 pt-4 border-t border-outline-variant/10">
                      <MarkdownRenderer content={reportAppendix} />
                    </div>
                  </details>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-on-surface-variant">
                <span className="material-symbols-outlined text-4xl text-amber-400 mb-2">info</span>
                <p className="text-sm japanese-text font-bold">分析は完了しましたが、レポート本文が空でした。</p>
                <p className="text-xs mt-1">対象サイトの構造によっては分析データが取得できない場合があります。別のURLで再試行してください。</p>
              </div>
            )}
          </div>

          {/* Execution Metadata */}
          {executionMeta && (
            <details className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-5">
              <summary className="cursor-pointer list-none">
                <span className="flex items-center gap-2 text-sm font-bold text-on-surface-variant japanese-text">
                  <span className="material-symbols-outlined text-base" aria-hidden="true">info</span>
                  分析の実行情報（管理用）
                </span>
              </summary>
              <div className="mt-5 border-t border-outline-variant/10 pt-5">
                <div className="mb-4 flex items-center gap-2 text-on-surface-variant">
                <span className="material-symbols-outlined text-secondary text-base">info</span>
                <span className="text-xs font-bold uppercase tracking-widest">実行メタデータ</span>
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                  {executionMetaEntries.map(({ key, label, value }) => (
                    <div key={key} className="rounded-xl bg-surface-container px-4 py-3">
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">{label}</p>
                      <p className="truncate font-mono text-sm font-bold text-on-surface" title={value}>
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </details>
          )}
        </div>
      )}

      {/* Empty State */}
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
