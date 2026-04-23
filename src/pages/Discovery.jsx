import { useState, useCallback, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { startDiscoveryJob, getDiscoveryJob, classifyError, warmMarketLensBackend } from '../api/marketLens'
import MarkdownRenderer from '../components/MarkdownRenderer'
import DataCoverageCard from '../components/DataCoverageCard'
import { LoadingSpinner, ErrorBanner } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useRbac } from '../contexts/RbacContext'
import { useAnalysisRuns } from '../contexts/AnalysisRunsContext'
import { useBackendReadiness } from '../contexts/BackendReadinessContext'
import { getAnalysisModel, getAnalysisProviderLabel } from '../utils/analysisProvider'
import { copyReportToClipboard, buildDiscoveryReportText } from '../utils/reportExport'
import { recordScore } from '../utils/scoreHistory'
import { checkReportQuality, splitReportSections, stripModelDates, stripTruncatedTables, splitIssuesBySeverity } from '../utils/reportQuality'
import { stripV2CoveredSections } from '../utils/reportSections'
import PrintButton from '../components/report/PrintButton'
import ReportQualityBadge from '../components/report/ReportQualityBadge'
import ReportViewV2 from '../components/report/v2/ReportViewV2'
import { extractCompetitiveSet, extractKpis } from '../utils/kpiExtractor'
import { useReportEnvelope } from '../hooks/useReportEnvelope'
import ScoreDistributionChart from './discovery/ScoreDistributionChart'
import MetaBand from './discovery/MetaBand'
import PartialSuccessBanner from './discovery/PartialSuccessBanner'
import DomainPlaceholder from './discovery/DomainPlaceholder'
import DiscoveredLpGrid from './discovery/DiscoveredLpGrid'
import {
  POLL_INTERVAL_INITIAL_MS,
  POLL_INTERVAL_SLOW_MS,
  POLL_SLOWDOWN_AFTER_MS,
  POLL_MAX_NETWORK_ERRORS,
  POLL_SOFT_WARNING_MS,
  POLL_HARD_CEILING_MS,
  POLL_STALE_TIMEOUT_MS,
  STAGE_TIMEOUT_MS,
  DISCOVERY_AUTO_RESUBMIT_MAX,
  STAGE_LABELS,
  STAGE_TYPICAL_SEC,
  STAGE_ORDER,
  getPollIntervalMs,
  isAutoResubmitEligible,
} from './discovery/pollingConstants'


const FONT_SIZES = [
  { key: 'normal', label: 'S' },
  { key: 'large', label: 'M' },
  { key: 'xlarge', label: 'L' },
]


const DISCOVERY_ACTIVE_JOB_KEY = 'is-discovery-active-job'

function persistActiveJob(jobId, pollUrl, url) {
  try { sessionStorage.setItem(DISCOVERY_ACTIVE_JOB_KEY, JSON.stringify({ jobId, pollUrl, url, startedAt: Date.now() })) } catch { /* intentionally empty */ }
}
function clearActiveJob() {
  try { sessionStorage.removeItem(DISCOVERY_ACTIVE_JOB_KEY) } catch { /* intentionally empty */ }
}
function getActiveJob() {
  try {
    const raw = sessionStorage.getItem(DISCOVERY_ACTIVE_JOB_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Date.now() - parsed.startedAt > POLL_HARD_CEILING_MS) { clearActiveJob(); return null }
    return parsed
  } catch { return null }
}

export default function Discovery() {
  const {
    analysisKey,
    analysisProvider,
    hasAnalysisKey,
  } = useAuth()
  const { isAdmin } = useRbac()
  const { getRun, startRun, updateRunMeta, completeRun, failRun, clearRun, getDraft, setDraft } = useAnalysisRuns()
  const backendStatus = useBackendReadiness()

  const run = getRun('discovery')
  const [url, setUrl] = useState(() => getDraft('discovery')?.url || run?.input?.url || '')
  const [fontSize, setFontSize] = useState('normal')
  const [copyToast, setCopyToast] = useState('')
  const [tickNow, setTickNow] = useState(() => Date.now())
  const pollTimerRef = useRef(null)
  const pollErrorCountRef = useRef(0)
  const pollStartTimeRef = useRef(0)
  const pollStoppedRef = useRef(false)
  const stageTrackRef = useRef(null)  // { stage: string, startTime: number }
  const lastUpdatedAtRef = useRef(null)
  const staleStartRef = useRef(null)
  const resubmitCountRef = useRef(0)
  const submitOptionsRef = useRef(null)
  const softWarningShownRef = useRef(false)

  const loading = run?.status === 'running'
  const error = run?.status === 'failed' ? run.error : null
  const errorInfo = run?.status === 'failed' ? run.errorInfo : null
  const result = run?.result || null
  const shouldFetchReportEnvelope = run?.meta?.jobId && run?.status === 'completed'
  const { envelope: discoveryEnvelope } = useReportEnvelope(
    shouldFetchReportEnvelope ? 'discovery' : null,
    shouldFetchReportEnvelope ? run.meta.jobId : null,
  )
  const compareRun = getRun('compare')
  const compareResult = compareRun?.status === 'completed' ? compareRun.result : null
  const allDiscoveries = result?.fetched_sites ?? result?.competitors ?? result?.results ?? []
  const discoveries = allDiscoveries.filter((item) => {
    const isFailed = item.analysis_source === 'failed' || (item.error && item.analysis_source !== 'search_result_fallback')
    return !isFailed
  })
  const providerLabel = getAnalysisProviderLabel(analysisProvider)
  const canSubmit = url && hasAnalysisKey && !loading

  useEffect(() => {
    if (!loading) return undefined

    const timerId = window.setInterval(() => {
      setTickNow(Date.now())
    }, 1000)

    return () => window.clearInterval(timerId)
  }, [loading])

  const resetPollingTracking = useCallback((resetStartTime = false) => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
    pollErrorCountRef.current = 0
    lastUpdatedAtRef.current = null
    staleStartRef.current = null
    stageTrackRef.current = null
    softWarningShownRef.current = false
    if (resetStartTime || !pollStartTimeRef.current) {
      pollStartTimeRef.current = Date.now()
    }
  }, [])

  const stopPolling = useCallback(() => {
    pollStoppedRef.current = true
    resetPollingTracking(false)
  }, [resetPollingTracking])

  // Warm up backend on mount (cold-start mitigation)
  useEffect(() => {
    void warmMarketLensBackend()
  }, [])

  // Cleanup on unmount (imperative — avoids stale closure from stopPolling dependency)
  useEffect(() => () => {
    pollStoppedRef.current = true
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
  }, [])

  const pollJob = useCallback(function pollJobCallback(jobId, options = {}) {
    const pollPath = options.pollPath || jobId
    const initialPollIntervalMs = getPollIntervalMs(options.pollIntervalMs)
    const resetStartTime = options.resetStartTime !== false

    pollStoppedRef.current = false
    resetPollingTracking(resetStartTime)

    async function tick() {
      // Guard: bail if polling was stopped (e.g. unmount, user cancel, new run)
      if (pollStoppedRef.current) return

      const tickElapsed = Date.now() - pollStartTimeRef.current
      const tickStage = stageTrackRef.current?.stage
      const tickStaleDuration = staleStartRef.current ? Date.now() - staleStartRef.current : 0
      console.info('[Discovery] tick', { elapsed: tickElapsed, stage: tickStage, staleDuration: tickStaleDuration })

      // Guard: hard ceiling — stale 検知も効かなかった場合の最終安全弁
      if (Date.now() - pollStartTimeRef.current > POLL_HARD_CEILING_MS) {
        stopPolling()
        clearActiveJob()
        console.warn('[Discovery] Hard ceiling reached', { elapsed: POLL_HARD_CEILING_MS })
        failRun('discovery', '分析がタイムアウトしました。再試行してください。', {
          category: 'timeout', label: 'タイムアウト',
          guidance: '分析に時間がかかりすぎています。再試行してください。', retryable: true,
        })
        return
      }

      // Soft warning — バックエンドは生きているが時間がかかっている
      if (Date.now() - pollStartTimeRef.current > POLL_SOFT_WARNING_MS && !softWarningShownRef.current) {
        softWarningShownRef.current = true
        console.warn('[Discovery] Soft warning — backend still responding')
        updateRunMeta('discovery', {
          statusLabel: '通常より時間がかかっていますが、サーバーは応答中です…',
        })
      }

      try {
        const data = await getDiscoveryJob(pollPath)
        pollErrorCountRef.current = 0

        // Stale detection: if updated_at hasn't changed for POLL_STALE_TIMEOUT_MS, fail
        if ((data.status === 'running' || data.status === 'queued') && data.updated_at) {
          const updatedAtStr = String(data.updated_at)
          if (updatedAtStr === lastUpdatedAtRef.current) {
            if (!staleStartRef.current) {
              staleStartRef.current = Date.now()
              console.info('[Discovery] Stale detection started', { updatedAt: updatedAtStr })
            } else if (Date.now() - staleStartRef.current > POLL_STALE_TIMEOUT_MS) {
              stopPolling()
              clearActiveJob()
              const lastStage = stageTrackRef.current?.stage
              const stageHint = lastStage ? `（ステージ: ${STAGE_LABELS[lastStage] || lastStage}）` : ''
              failRun('discovery', `サーバーが応答しなくなりました${stageHint}。再試行してください。`, {
                category: 'stale', label: 'サーバー無応答',
                guidance: `分析ジョブが進行していません${stageHint}。再試行してください。`, retryable: true,
              })
              return
            }
          } else {
            lastUpdatedAtRef.current = updatedAtStr
            staleStartRef.current = null
          }
        }

        // Pseudo-progress: during analyze stage, increment 90→99% based on elapsed time
        let displayProgress = data.progress_pct
        if (data.stage === 'analyze' && displayProgress != null) {
          const analyzeElapsed = (Date.now() - pollStartTimeRef.current) / 1000
          // Increment ~1% every 5 seconds, capped at 99%
          const bonus = Math.min(9, Math.floor(analyzeElapsed / 2))
          displayProgress = Math.min(99, Math.max(displayProgress, 90 + bonus))
        }

        updateRunMeta('discovery', {
          stage: data.stage,
          progress_pct: displayProgress,
          message: data.message,
          statusLabel: null,
          jobId,
          pollUrl: pollPath,
        })

        // Track current stage for user-facing context. Backend owns stage-stall detection.
        if (data.stage && (data.status === 'running' || data.status === 'queued')) {
          if (!stageTrackRef.current || data.stage !== stageTrackRef.current.stage) {
            const prevStage = stageTrackRef.current?.stage
            console.info('[Discovery] Stage transition', { from: prevStage || '(none)', to: data.stage, elapsed: tickElapsed })
            stageTrackRef.current = { stage: data.stage, startTime: Date.now() }
          }
        }

        // Stage-level timeout detection
        if (stageTrackRef.current) {
          const { stage, startTime } = stageTrackRef.current
          const stageLimit = STAGE_TIMEOUT_MS[stage]
          if (stageLimit && Date.now() - startTime > stageLimit) {
            stopPolling()
            clearActiveJob()
            const stageLabel = STAGE_LABELS[stage] || stage
            console.warn('[Discovery] Stage timeout', { stage, elapsed: Date.now() - startTime })
            failRun('discovery', `${stageLabel}がタイムアウトしました。再試行してください。`, {
              category: 'timeout', label: `${stageLabel}タイムアウト`,
              guidance: 'バックエンドの処理が停止した可能性があります。再試行してください。',
              retryable: true,
            })
            return
          }
        }

        if (data.status === 'completed' && data.result) {
          stopPolling()
          clearActiveJob()
          console.info('[Discovery] Job completed', { jobId, elapsed: tickElapsed, hasReport: !!data.result.report_md })

          // report_md 存在チェック
          if (!data.result.report_md) {
            console.warn('[Discovery] Completed but report_md missing', { jobId, keys: Object.keys(data.result) })
            failRun('discovery', 'レポート生成は完了しましたが、本文が空でした。再試行してください。', {
              category: 'upstream', label: 'レポート空', guidance: '再試行すると解決する場合があります。', retryable: true,
            })
            return
          }

          completeRun('discovery', data.result, {
            search_id: data.result.search_id,
            providerLabel,
            jobId,
          })

          // Record avg score from fetched sites
          const sites = data.result?.fetched_sites || []
          const scoredSites = sites.filter(s => s.score != null && s.analysis_source !== 'failed')
          if (scoredSites.length > 0) {
            const avgScore = Math.round(scoredSites.reduce((sum, s) => sum + s.score, 0) / scoredSites.length)
            recordScore('discovery', { score: avgScore, timestamp: Date.now() })
          }
          return
        }

        // completed + result null
        if (data.status === 'completed' && !data.result) {
          stopPolling()
          clearActiveJob()
          console.warn('[Discovery] Completed but result is null', { jobId })
          failRun('discovery', 'ジョブは完了しましたが、結果データがありません。再試行してください。', {
            category: 'upstream', label: '結果なし', retryable: true,
          })
          return
        }

        if (data.status === 'failed') {
          console.warn('[Discovery] Job failed', { jobId, elapsed: tickElapsed, error: data.error })
          const detail = data.error?.detail || data.message || 'ジョブが失敗しました'
          const retryable = data.error?.retryable ?? true
          const failedStage = data.error?.stage || data.stage
          if (
            isAutoResubmitEligible(detail, retryable, failedStage, null) &&
            resubmitCountRef.current < DISCOVERY_AUTO_RESUBMIT_MAX &&
            submitOptionsRef.current?.url
          ) {
            try {
              console.info('[Discovery] Auto-resubmit attempt', { count: resubmitCountRef.current + 1, detail })
              // Warm backend before resubmit to avoid immediate cold-start failure
              await Promise.race([
                warmMarketLensBackend().catch(() => null),
                new Promise((resolve) => setTimeout(resolve, 5000)),
              ])

              updateRunMeta('discovery', {
                stage: 'queued',
                progress_pct: 0,
                message: '自動再試行中…',
                statusLabel: '自動再試行中…',
              })

              const nextData = await startDiscoveryJob(
                submitOptionsRef.current.url,
                submitOptionsRef.current.requestOptions,
              )
              if (pollStoppedRef.current) return

              resubmitCountRef.current += 1
              updateRunMeta('discovery', {
                jobId: nextData.job_id,
                stage: nextData.stage,
                progress_pct: 0,
                providerLabel,
                pollUrl: nextData.poll_url,
                pollIntervalMs: getPollIntervalMs(nextData.retry_after_sec),
                message: '自動再試行中…',
                statusLabel: '自動再試行中…',
              })

              persistActiveJob(nextData.job_id, nextData.poll_url, submitOptionsRef.current.url)

              pollJobCallback(nextData.job_id, {
                pollPath: nextData.poll_url,
                pollIntervalMs: nextData.retry_after_sec,
                resetStartTime: false,
              })
              return
            } catch (resubmitError) {
              stopPolling()
              clearActiveJob()
              const info = classifyError(resubmitError)
              failRun('discovery', resubmitError.message || detail, info)
              return
            }
          }

          stopPolling()
          clearActiveJob()
          const info = {
            category: 'upstream',
            label: 'ジョブエラー',
            guidance: detail,
            retryable,
          }
          failRun('discovery', detail, info)
          return
        }

        // Still running or queued — schedule next poll with adaptive backoff
        const elapsed = Date.now() - pollStartTimeRef.current
        const baseInterval = elapsed > POLL_SLOWDOWN_AFTER_MS
          ? POLL_INTERVAL_SLOW_MS
          : POLL_INTERVAL_INITIAL_MS
        const nextPollIntervalMs = Number(data.retry_after_sec) > 0
          ? Number(data.retry_after_sec) * 1000
          : baseInterval
        pollTimerRef.current = setTimeout(tick, nextPollIntervalMs)
      } catch (e) {
        pollErrorCountRef.current += 1
        if (pollErrorCountRef.current >= POLL_MAX_NETWORK_ERRORS) {
          stopPolling()
          clearActiveJob()
          const info = classifyError(e)
          failRun('discovery', e.message || 'ポーリング中にエラーが発生しました', info)
          return
        }
        // Transient error — retry with adaptive interval
        const elapsedOnError = Date.now() - pollStartTimeRef.current
        const retryInterval = elapsedOnError > POLL_SLOWDOWN_AFTER_MS
          ? POLL_INTERVAL_SLOW_MS
          : POLL_INTERVAL_INITIAL_MS
        pollTimerRef.current = setTimeout(tick, retryInterval)
      }
    }

    pollTimerRef.current = setTimeout(tick, initialPollIntervalMs)
  }, [updateRunMeta, completeRun, failRun, stopPolling, providerLabel, resetPollingTracking])

  // Resume active job on mount (page reload / navigation)
  useEffect(() => {
    const activeJob = getActiveJob()
    if (!activeJob) return

    // loading=true（ナビゲーション復帰）でもポーリングを再開
    if (!loading) {
      if (activeJob.url && !url) setUrl(activeJob.url)
      startRun('discovery', { url: activeJob.url })
    }

    // ハードコード 'analyze' ではなく最後のステージを継承
    const currentStage = run?.meta?.stage || 'analyze'
    updateRunMeta('discovery', {
      stage: currentStage,
      statusLabel: '前回のジョブを再開中…',
      jobId: activeJob.jobId,
    })

    pollJob(activeJob.jobId, {
      pollPath: activeJob.pollUrl,
      resetStartTime: true,
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- mount only

  const handleDiscover = useCallback(async () => {
    console.info('[Discovery] handleDiscover start', { url, provider: analysisProvider })
    if (!analysisKey || !analysisProvider) {
      console.warn('[Discovery] Missing auth', { hasKey: !!analysisKey, hasProvider: !!analysisProvider })
      startRun('discovery', { url })
      failRun('discovery', 'APIキーまたはプロバイダーが設定されていません。設定画面を確認してください。', {
        category: 'auth_error', label: '設定不足',
        guidance: '設定 → AI設定 から Claude API キーを入力してください。', retryable: false,
      })
      return
    }

    stopPolling()
    startRun('discovery', { url })
    resubmitCountRef.current = 0
    const requestOptions = {
      apiKey: analysisKey,
      provider: analysisProvider,
      model: getAnalysisModel(analysisProvider),
    }
    submitOptionsRef.current = { url, requestOptions }

    const PRE_POLL_TIMEOUT_MS = 60_000 // ウォームアップ + ジョブ作成の合計上限

    try {
      updateRunMeta('discovery', { stage: 'warming' })

      // ── ウォームアップ + ジョブ作成を 60秒でタイムアウト ──
      console.info('[Discovery] warmup starting...')
      const data = await Promise.race([
        (async () => {
          const warmResult = await warmMarketLensBackend()
          console.info('[Discovery] warmup result:', warmResult)
          if (!warmResult) {
            throw Object.assign(new Error('サーバー起動に失敗しました'), {
              isPrePollTimeout: false,
              category: 'cold_start',
            })
          }
          updateRunMeta('discovery', { stage: 'queued', warmEndedAt: Date.now() })

          console.info('[Discovery] submitting job...')
          const jobData = await startDiscoveryJob(url, requestOptions)
          console.info('[Discovery] job started:', jobData.job_id)
          return jobData
        })(),
        new Promise((_, reject) =>
          setTimeout(() => reject(Object.assign(
            new Error('サーバーへの接続がタイムアウトしました。再試行してください。'),
            { isPrePollTimeout: true }
          )), PRE_POLL_TIMEOUT_MS)
        ),
      ])

      updateRunMeta('discovery', {
        jobId: data.job_id,
        stage: data.stage,
        progress_pct: 0,
        providerLabel,
        pollUrl: data.poll_url,
        pollIntervalMs: getPollIntervalMs(data.retry_after_sec),
        statusLabel: null,
      })

      persistActiveJob(data.job_id, data.poll_url, url)

      pollJob(data.job_id, {
        pollPath: data.poll_url,
        pollIntervalMs: data.retry_after_sec,
      })
    } catch (e) {
      if (e.isPrePollTimeout) {
        failRun('discovery', e.message, {
          category: 'timeout', label: '接続タイムアウト',
          guidance: 'サーバーへの接続に60秒以上かかりました。再試行してください。',
          retryable: true,
        })
      } else if (e.category === 'cold_start') {
        failRun('discovery', e.message, {
          category: 'cold_start', label: 'サーバー起動失敗',
          guidance: 'バックエンドが起動できませんでした。', retryable: true,
        })
      } else {
        const info = classifyError(e)
        if (e.stage) {
          info.label = `${info.label}（${e.stage}）`
        }
        failRun('discovery', e.message, info)
      }
    }
  }, [url, analysisKey, analysisProvider, providerLabel, startRun, updateRunMeta, failRun, stopPolling, pollJob])

  const handleRetry = useCallback(() => {
    stopPolling()
    resubmitCountRef.current = 0
    submitOptionsRef.current = null
    clearRun('discovery')
  }, [clearRun, stopPolling])

  return (
    <div className="p-10 max-w-[1400px] mx-auto space-y-10">
      <div>
        <h2 className="display-lg text-on-surface tracking-tight japanese-text">Discovery Hub</h2>
        <p className="body-lg text-on-surface-variant max-w-2xl mt-4">URLを入力するだけで、市場の競合他社とそのパフォーマンスを瞬時に可視化します。</p>
      </div>

      {!hasAnalysisKey && (
        <div className="flex items-center gap-3 bg-amber-50 dark:bg-warning-container border border-amber-200 dark:border-warning/30 rounded-[0.75rem] px-5 py-3 text-sm text-amber-800 dark:text-on-warning-container">
          <span className="material-symbols-outlined text-lg">warning</span>
          <span className="japanese-text">競合発見には Claude API キーが必要です。設定画面から設定してください。</span>
        </div>
      )}
      <div className="flex items-center gap-3 bg-surface-container rounded-[0.75rem] px-5 py-3 text-sm text-on-surface-variant">
        <span className="material-symbols-outlined text-lg">travel_explore</span>
        <span className="japanese-text">競合発見の分析は Claude で実行します。必要な検索設定はサーバー側で処理します。</span>
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
                <span>{STAGE_LABELS[run?.meta?.stage] || '検索中…'}</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined">search</span>
                競合を発見
              </>
            )}
          </button>
        </div>
        <div className="flex items-center gap-2 mt-4">
          <span className={`w-2 h-2 rounded-full ${
            backendStatus.ready ? 'bg-emerald-500' :
            backendStatus.warming ? 'bg-orange-400 animate-pulse' :
            'bg-gray-400'
          }`} />
          <span className="text-xs text-on-surface-variant japanese-text">
            {backendStatus.ready ? 'サーバー準備完了' :
             backendStatus.warming ? 'サーバー起動中…' :
             'サーバー状態確認中'}
          </span>
        </div>
      </div>

      {/* Meta Band */}
      <MetaBand run={run} now={tickNow} />

      {/* Error */}
      {error && (
        <ErrorBanner message={error} onRetry={handleRetry} errorInfo={errorInfo} />
      )}

      {/* Partial Success Banner */}
      {result?.fetched_sites && <PartialSuccessBanner fetchedSites={result.fetched_sites} />}

      {/* Report */}
      {result?.report_md && (() => {
        const { body: discBody, appendix: discAppendix } = splitReportSections(result.report_md)
        const cleanBody = stripV2CoveredSections(stripTruncatedTables(stripModelDates(discBody)))
        const discBackendQuality = {
          qualityStatus: result?.quality_status,
          qualityIssues: result?.quality_issues,
          qualityIsCritical: result?.quality_is_critical,
        }
        const { issues: discQIssues } = checkReportQuality(result.report_md, discBackendQuality)

        return (
          <>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-on-surface-variant">
                <span className="material-symbols-outlined">description</span>
                <span className="text-sm font-bold">分析レポート</span>
              </div>
              <button
                onClick={async () => {
                  try {
                    await copyReportToClipboard(buildDiscoveryReportText({ discoveries, reportMd: result?.report_md }))
                    setCopyToast('コピーしました')
                    setTimeout(() => setCopyToast(''), 2000)
                  } catch {
                    setCopyToast('コピー失敗')
                    setTimeout(() => setCopyToast(''), 2000)
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-container hover:bg-surface-container-high text-on-surface-variant text-xs font-bold rounded-lg transition-colors print:hidden"
              >
                <span className="material-symbols-outlined text-sm">content_copy</span>
                レポートをコピー
              </button>
              {copyToast && (
                <span className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:text-on-success-container bg-emerald-50 dark:bg-success-container rounded-lg transition-opacity">
                  <span className="material-symbols-outlined text-sm">check_circle</span>
                  {copyToast}
                </span>
              )}
              <PrintButton
                onBeforePrint={() => {
                  // Phase Q2-3: confirm dialog only for admin — clients never see quality state.
                  if (isAdmin) {
                    const { blockers } = splitIssuesBySeverity(discQIssues)
                    if (blockers.length > 0) {
                      return window.confirm(
                        'このレポートには欠損セクションがあります。クライアント提出用PDFを作成しますか？\n（推奨: 先に「対象を絞って再実行」）'
                      )
                    }
                  }
                  return true
                }}
              />
              {/* Phase Q2-3: quality badge (admin only, hidden in print) */}
              <ReportQualityBadge
                issues={discQIssues}
                onRegenerate={() => {
                  setUrl(result?.brand_url || url)
                  handleRetry()
                }}
              />
              <div className="flex items-center gap-1 bg-surface-container rounded-full p-1 print:hidden">
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
            <div className="mb-6">
              <ReportViewV2 envelope={discoveryEnvelope} reportMd={result.report_md} />
            </div>
            <MarkdownRenderer content={cleanBody} size={fontSize} variant="discovery" />
            {result?.fetched_sites && <DataCoverageCard extracted={result.fetched_sites} className="mt-8" />}
            {/* KPI Tracking Card */}
            {(() => {
              const kpis = extractKpis(cleanBody)
              if (kpis.length === 0) {
                return (
                  <div className="mt-6 bg-surface-container-lowest rounded-2xl p-5 border border-outline-variant/8 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 text-on-surface-variant">
                      <span className="material-symbols-outlined text-lg">tracking</span>
                      <span className="text-sm">KPI目標値が見つかりませんでした。Section 5を含む再分析で抽出できます。</span>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 bg-secondary/10 text-secondary text-xs font-bold rounded-lg hover:bg-secondary/20 transition-colors japanese-text"
                      onClick={handleDiscover}
                      disabled={loading || !url}
                    >
                      <span className="material-symbols-outlined text-sm">refresh</span>
                      再分析
                    </button>
                  </div>
                )
              }
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
            {/* Cross-link to Compare report */}
            {compareResult?.report_md && (() => {
              const discBrands = extractCompetitiveSet(result.report_md)
              const compBrands = extractCompetitiveSet(compareResult.report_md)
              const overlap = discBrands.filter((b) => compBrands.includes(b))
              if (overlap.length === 0) return null
              return (
                <div className="mt-6 bg-primary/5 rounded-2xl p-6 border border-primary/10">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="material-symbols-outlined text-primary text-lg">compare_arrows</span>
                    <span className="text-sm font-bold text-primary">関連レポート</span>
                  </div>
                  <p className="text-xs text-on-surface-variant mb-3">
                    以下のブランドがLP比較レポートでも分析されています: {overlap.join('、')}
                  </p>
                  <Link
                    to="/compare"
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary/10 text-primary text-xs font-bold rounded-lg hover:bg-primary/20 transition-colors"
                  >
                    <span className="material-symbols-outlined text-sm">open_in_new</span>
                    LP比較レポートを表示
                  </Link>
                </div>
              )
            })()}
            {discAppendix && (
              <details className="mt-8">
                <summary className="cursor-pointer text-xs font-bold text-on-surface-variant uppercase tracking-widest hover:text-on-surface transition-colors flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm">info</span>
                  Appendix（監査・再確認用）
                </summary>
                <div className="mt-4 pt-4 border-t border-outline-variant/10">
                  <MarkdownRenderer content={discAppendix} size={fontSize} />
                </div>
              </details>
            )}
          </>
        )
      })()}

      {/* Score Distribution Chart */}
      {discoveries.length > 0 && <ScoreDistributionChart discoveries={discoveries} />}

      {/* Discovered LPs */}
      {discoveries.length > 0 && <DiscoveredLpGrid discoveries={discoveries} />}

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
