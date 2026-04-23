import { useEffect, useMemo, useRef, useState } from 'react'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { AUTH_EXPIRED_MESSAGE, neonGenerate } from '../api/adsInsights'
import { getScans, classifyError } from '../api/marketLens'
import { LoadingSpinner, ErrorBanner } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useAdsSetup } from '../contexts/AdsSetupContext'
import { useAnalysisRuns } from '../contexts/AnalysisRunsContext'
import { useUserProfile } from '../contexts/UserProfileContext'
import { useReportHistory } from '../contexts/ReportHistoryContext'
import {
  buildAiChartContext,
  buildAnalysisInstructions,
  extractMarkdownSummary,
  regenerateAdsReportBundle,
} from '../utils/adsReports'
import { getAdsText, normalizeAdsPayload } from '../utils/adsResponse'
import { getAnalysisModel } from '../utils/analysisProvider'
import { useUiVersion } from '../hooks/useUiVersion'
import InsightTimeline from '../components/ai-explorer/v2/InsightTimeline'

function formatAnalysisError(error) {
  if (error.isAuthError) return AUTH_EXPIRED_MESSAGE

  const info = classifyError(error)
  // 全カテゴリで label + guidance を使用する
  if (info.category !== 'unknown') {
    return `${info.label}。${info.guidance}`
  }

  const msg = error.message || ''
  return msg.length > 200 ? msg.slice(0, 200) + '…' : msg
}

const QUICK_PROMPTS = [
  { icon: 'warning', label: 'コンバージョン流出ポイントを特定して', color: 'text-red-500' },
  { icon: 'lightbulb', label: '最も効果的な流入チャネルとその理由', color: 'text-emerald-500' },
  { icon: 'compare_arrows', label: '期間比較で一番変化が大きい指標は？', color: 'text-purple-500' },
]

function summarizeHistory(items) {
  if (!Array.isArray(items) || items.length === 0) return null

  const recent = items.slice(0, 5)
  const lines = recent.map((item) => {
    const title = item.title || item.url || '不明'
    const score = item.score != null ? `スコア: ${item.score}` : ''
    const date = item.created_at || item.date || ''
    return [title, score, date].filter(Boolean).join(' | ')
  })

  return lines.join('\n')
}

function isAssistantMessage(message) {
  return message?.role === 'assistant' || message?.role === 'ai'
}

function toConversationHistory(messages) {
  return messages.slice(-6).map((message) => ({
    role: isAssistantMessage(message) ? 'assistant' : 'user',
    text:
      typeof message?.text === 'string' && message.text.length > 800
        ? `${message.text.slice(0, 800)}…(省略)`
        : message?.text ?? '',
  }))
}

export default function AiExplorer() {
  const { isV2 } = useUiVersion()
  const {
    isAdsAuthenticated,
    analysisKey,
    analysisProvider,
    hasAnalysisKey,
  } = useAuth()
  const { setupState, reportBundle, setReportBundle } = useAdsSetup()
  const { getDraft, setDraft, clearDraft } = useAnalysisRuns()
  const { avatarInitial } = useUserProfile()
  const { restoreTarget, clearRestoreTarget, addEntry } = useReportHistory()

  const FONT_SIZE_KEY = 'is-ai-chat-font-size'
  const USER_TEXT_SIZE = { normal: 'text-sm', large: 'text-base', xlarge: 'text-lg' }

  const [input, setInput] = useState('')
  const [messages, setMessages] = useState(() => {
    const draft = getDraft('ai-explorer')
    if (!draft || !Array.isArray(draft.messages)) return []
    return draft.messages
      .filter((m) => m && typeof m.role === 'string' && typeof m.text === 'string')
      .slice(-50)
  })
  const [loading, setLoading] = useState(false)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState(null)
  const [status, setStatus] = useState('')
  const [contextMode, setContextMode] = useState(() => {
    const draft = getDraft('ai-explorer')
    return draft?.contextMode === 'ads-with-ml' ? 'ads-with-ml' : 'ads-only'
  })
  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem(FONT_SIZE_KEY)
    return saved === 'large' || saved === 'xlarge' ? saved : 'normal'
  })
  const [mlContextSummary, setMlContextSummary] = useState(null)
  const [mlLoading, setMlLoading] = useState(false)
  const [mlStatus, setMlStatus] = useState('idle')
  const chatEndRef = useRef(null)
  const abortRef = useRef(null)
  const submittingRef = useRef(false)

  // アンマウント時にリトライ中のリクエストをキャンセル
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  const draftTimerRef = useRef(null)
  useEffect(() => {
    clearTimeout(draftTimerRef.current)
    draftTimerRef.current = setTimeout(() => {
      setDraft('ai-explorer', { messages: messages.slice(-50), contextMode })
    }, 500)
    return () => clearTimeout(draftTimerRef.current)
  }, [messages, contextMode, setDraft])

  // Subscribe to restoreTarget — replaces messages/reportBundle from a history entry.
  // No API calls: MarkdownRenderer and InsightChartPanel render purely from state.
  useEffect(() => {
    if (!restoreTarget?.entry) return
    const entry = restoreTarget.entry

    // Archive current in-progress session before overwriting (if any).
    if (messages.length > 0 && reportBundle?.reportMd) {
      addEntry({ setupState, reportBundle, messages, contextMode })
    }

    const restoredMessages = Array.isArray(entry.messages) ? entry.messages : []
    const restoredContextMode = entry.contextMode === 'ads-with-ml' ? 'ads-with-ml' : 'ads-only'

    setMessages(restoredMessages)
    setContextMode(restoredContextMode)
    setReportBundle({
      ...(entry.reportBundle ?? {}),
      source: 'restored_from_history',
    })
    setDraft('ai-explorer', { messages: restoredMessages, contextMode: restoredContextMode })
    setStatus('✓ 履歴から復元しました（API 未使用）')
    clearRestoreTarget()
  }, [restoreTarget]) // eslint-disable-line react-hooks/exhaustive-deps -- one-shot per restoreTarget

  function handleFontSizeChange(size) {
    setFontSize(size)
    localStorage.setItem(FONT_SIZE_KEY, size)
  }

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!setupState || !isAdsAuthenticated) return
    if (reportBundle?.source === 'bq_generate_batch') return
    if (reportBundle?.source === 'restored_from_history') return

    let cancelled = false

    ;(async () => {
      setReportLoading(true)
      setReportError(null)
      try {
        const nextBundle = await regenerateAdsReportBundle(setupState)
        if (!cancelled) setReportBundle(nextBundle)
      } catch (e) {
        if (!cancelled) {
          setReportError(
            e.isAuthError
              ? AUTH_EXPIRED_MESSAGE
              : e.message,
          )
        }
      } finally {
        if (!cancelled) setReportLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isAdsAuthenticated, reportBundle?.source, setReportBundle, setupState])

  useEffect(() => {
    if (contextMode !== 'ads-with-ml') {
      setMlContextSummary(null)
      setMlStatus('idle')
      return
    }

    setMlLoading(true)
    setMlStatus('loading')

    let cancelled = false
    let retried = false
    let retryTimer = null

    getScans()
      .then((data) => {
        if (cancelled) return
        const items = data.scans ?? data.history ?? data.results ?? (Array.isArray(data) ? data : [])
        const summary = summarizeHistory(items)
        setMlContextSummary(summary)
        setMlStatus(summary ? 'ready' : 'empty')
      })
      .catch((e) => {
        if (cancelled) return
        const info = classifyError(e)
        if (!retried && (info.category === 'cold_start' || info.category === 'network')) {
          retried = true
          retryTimer = setTimeout(() => {
            retryTimer = null
            if (cancelled) return
            setMlLoading(true)
            setMlStatus('loading')
            getScans()
              .then((data) => {
                if (cancelled) return
                const items = data.scans ?? data.history ?? data.results ?? (Array.isArray(data) ? data : [])
                const summary = summarizeHistory(items)
                setMlContextSummary(summary)
                setMlStatus(summary ? 'ready' : 'empty')
              })
              .catch(() => {
                if (cancelled) return
                setMlContextSummary(null)
                setMlStatus('error')
              })
              .finally(() => { if (!cancelled) setMlLoading(false) })
          }, 5000)
          setMlStatus('cold_start')
          setMlLoading(false)
          return
        }
        setMlContextSummary(null)
        if (e.status === 404 || info.category === 'not_found') {
          setMlStatus('unavailable')
        } else if (info.category === 'cold_start') {
          setMlStatus('cold_start')
        } else {
          setMlStatus('error')
        }
      })
      .finally(() => { if (!cancelled && !retried) setMlLoading(false) })

    return () => {
      cancelled = true
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
    }
  }, [contextMode])

  const chartContext = useMemo(
    () => buildAiChartContext(reportBundle?.chartGroups ?? []),
    [reportBundle?.chartGroups],
  )

  const promptDisabled =
    !isAdsAuthenticated || !hasAnalysisKey || !reportBundle?.reportMd || loading || reportLoading

  async function handleSend(text) {
    const prompt = (text ?? input).trim()
    // 二重発火防止: submittingRef は同期的に set されるため React 状態の遅延を回避
    if (!prompt || submittingRef.current || loading || !reportBundle?.reportMd) return
    submittingRef.current = true

    setInput('')

    const userMessage = { role: 'user', text: prompt }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setLoading(true)
    setStatus('考察生成中...')

    try {
      const analysisInstructions = buildAnalysisInstructions(
        setupState?.queryTypes ?? [],
        setupState?.periods ?? [],
      )
      const enrichedPrompt = [
        analysisInstructions,
        contextMode === 'ads-with-ml' && mlContextSummary
          ? `[補助コンテキスト: Market Lens]\n${mlContextSummary}`
          : '',
        `---\n${prompt}`,
      ].filter(Boolean).join('\n\n')

      const isFirstMessage = messages.length === 0
      const packContext = isFirstMessage
        ? reportBundle.reportMd
        : extractMarkdownSummary(reportBundle.reportMd) || reportBundle.reportMd

      const neonPayload = {
        mode: 'question',
        model: getAnalysisModel(analysisProvider) || 'claude-sonnet-4-20250514',
        provider: analysisProvider || 'anthropic',
        temperature: messages.length === 0 ? 0.3 : 0.6,
        message: enrichedPrompt,
        point_pack_md: packContext,
        style_reference: '',
        style_preset: 'mixed',
        data_source: 'bq',
        bq_query_types: setupState?.queryTypes ?? [],
        conversation_history: toConversationHistory(nextMessages),
        ai_chart_context: chartContext,
      }

      const controller = new AbortController()
      abortRef.current = controller

      const MAX_RETRIES = 2
      const RETRY_DELAYS = [1500, 4000]
      let data = null
      let _lastError = null

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (controller.signal.aborted) return
        try {
          if (attempt > 0) {
            setStatus(`リトライ中 (${attempt}/${MAX_RETRIES})...`)
            await new Promise((resolve, reject) => {
              const id = setTimeout(resolve, RETRY_DELAYS[attempt - 1])
              controller.signal.addEventListener('abort', () => {
                clearTimeout(id)
                reject(new DOMException('Aborted', 'AbortError'))
              }, { once: true })
            })
          }
          data = await neonGenerate(neonPayload, analysisKey)
          break
        } catch (err) {
          if (err.name === 'AbortError') return
          _lastError = err
          const { retryable } = classifyError(err)
          if (!retryable || attempt === MAX_RETRIES) {
            throw err
          }
        }
      }

      const normalized = normalizeAdsPayload(data)
      if (data?.ok === false || normalized?.ok === false) {
        throw new Error(data?.error || normalized?.error || 'AI 考察の生成に失敗しました。')
      }

      const aiContent = getAdsText(data) ?? getAdsText(normalized)
      if (!aiContent) {
        throw new Error('AI 応答本文を取得できませんでした。')
      }

      const assistantMessage = { role: 'assistant', text: aiContent }
      setMessages([...nextMessages, assistantMessage])

      const hasTable = /\|.+\|/.test(aiContent)
      const hasBoldMetric = /\*\*[\d,.]+[%％]?(\s*(増|減|上昇|低下|改善|悪化))?(\*\*)?/.test(aiContent)
      const hasNumericRef = /\d{2,}([,.]\d+)*(%|％|件|人|回|円|万|億)/.test(aiContent)
      const isLowQuality = aiContent.length < 100
        ? !aiContent.includes('不明') && !aiContent.includes('未取得')
        : !hasTable && !hasBoldMetric && !hasNumericRef
      if (isLowQuality) {
        const hints = [
          !hasTable && !hasBoldMetric ? '表や数値比較' : '',
          !hasNumericRef ? '具体的な指標値' : '',
        ].filter(Boolean).join('・') || '具体性'
        setStatus(`⚠️ 応答に${hints}が不足しています。「コンバージョン流出ポイント」「期間比較で最も変化した指標」等、具体的な質問で改善します。`)
      } else {
        setStatus('✓ 考察生成完了')
      }
    } catch (e) {
      const errorMsg = formatAnalysisError(e)
      setStatus(`生成エラー: ${errorMsg}`)
      setMessages([
        ...nextMessages,
        { role: 'assistant', text: `エラー: ${errorMsg}`, isError: true },
      ])
    } finally {
      setLoading(false)
      submittingRef.current = false
    }
  }

  async function handleRefreshReport() {
    if (!setupState || !isAdsAuthenticated || reportLoading) return

    setReportLoading(true)
    setReportError(null)
    setStatus('分析データを再取得中...')

    try {
      const nextBundle = await regenerateAdsReportBundle(setupState)
      setReportBundle(nextBundle)
      setStatus('✓ 分析データを更新しました')
    } catch (e) {
      const errorMsg = e.isAuthError ? AUTH_EXPIRED_MESSAGE : e.message
      setReportError(errorMsg)
      setStatus(`更新エラー: ${errorMsg}`)
    } finally {
      setReportLoading(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const mlIndicatorTone = mlLoading
    ? 'text-on-surface-variant'
    : mlStatus === 'ready'
    ? 'text-emerald-600'
    : mlStatus === 'unavailable'
    ? 'text-amber-700'
    : mlStatus === 'cold_start'
    ? 'text-sky-700'
    : mlStatus === 'error'
    ? 'text-red-700'
    : 'text-on-surface-variant'

  const mlIndicatorDot = mlLoading
    ? 'bg-amber-400 animate-pulse'
    : mlStatus === 'ready'
    ? 'bg-emerald-500'
    : mlStatus === 'unavailable'
    ? 'bg-amber-500'
    : mlStatus === 'cold_start'
    ? 'bg-sky-400 animate-pulse'
    : mlStatus === 'error'
    ? 'bg-red-500'
    : 'bg-outline-variant'

  const mlIndicatorLabel = mlLoading
    ? '読込中…'
    : mlStatus === 'ready'
    ? '履歴接続済'
    : mlStatus === 'empty'
    ? '履歴なし'
    : mlStatus === 'unavailable'
    ? '連携停止中'
    : mlStatus === 'cold_start'
    ? 'サーバー起動中'
    : mlStatus === 'error'
    ? '読込失敗'
    : '未接続'

  const statusTone = status.startsWith('生成エラー') || status.startsWith('更新エラー')
    ? 'bg-red-50 dark:bg-error-container border-red-200 dark:border-error/30 text-red-700 dark:text-on-error-container'
    : status.startsWith('⚠️')
    ? 'bg-amber-50 dark:bg-warning-container border-amber-200 dark:border-warning/30 text-amber-800 dark:text-on-warning-container'
    : status.startsWith('✓')
    ? 'bg-emerald-50 dark:bg-success-container border-emerald-200 dark:border-success/30 text-emerald-700 dark:text-on-success-container'
    : 'bg-surface-container border-outline-variant/30 text-on-surface-variant'
  const statusIcon = status.startsWith('生成エラー') || status.startsWith('更新エラー')
    ? 'error'
    : status.startsWith('⚠️')
    ? 'warning'
    : status.startsWith('✓')
    ? 'check_circle'
    : 'info'

  if (isV2) {
    return (
      <InsightTimeline
        messages={messages}
        input={input}
        setInput={setInput}
        onSend={handleSend}
        loading={loading}
        promptDisabled={promptDisabled}
        fontSize={fontSize}
        status={status}
        statusTone={statusTone}
        statusIcon={statusIcon}
        contextMode={contextMode}
        setContextMode={setContextMode}
        handleFontSizeChange={handleFontSizeChange}
        mlIndicatorTone={mlIndicatorTone}
        mlIndicatorDot={mlIndicatorDot}
        mlIndicatorLabel={mlIndicatorLabel}
        reportLoading={reportLoading}
        setupState={setupState}
        isAdsAuthenticated={isAdsAuthenticated}
        handleRefreshReport={handleRefreshReport}
        hasAnalysisKey={hasAnalysisKey}
        onClearChat={() => { setMessages([]); setStatus(''); clearDraft('ai-explorer') }}
        mlStatus={mlStatus}
        reportError={reportError}
        reportBundle={reportBundle}
        chartGroups={reportBundle?.chartGroups}
      />
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="px-6 pt-5 pb-3 space-y-3">
        {!isAdsAuthenticated && (
          <div className="flex items-center gap-3 bg-amber-50 dark:bg-warning-container border border-amber-200 dark:border-warning/30 rounded-[0.75rem] px-5 py-3 text-sm text-amber-800 dark:text-on-warning-container mb-4">
            <span className="material-symbols-outlined text-lg">warning</span>
            <span className="japanese-text">考察スタジオへのログインが必要です。ヘッダーの鍵アイコンから認証してください。</span>
          </div>
        )}
      {!hasAnalysisKey && (
        <div className="flex items-center gap-3 bg-amber-50 dark:bg-warning-container border border-amber-200 dark:border-warning/30 rounded-[0.75rem] px-5 py-3 text-sm text-amber-800 dark:text-on-warning-container mb-4">
          <span className="material-symbols-outlined text-lg">warning</span>
          <span className="japanese-text">分析用 Claude API キーが未設定です。設定画面から設定してください。</span>
        </div>
      )}
        {reportError && (
          <div className="mb-4">
            <ErrorBanner message={reportError} onRetry={handleRefreshReport} />
          </div>
        )}
        {reportLoading && !reportBundle?.reportMd && (
          <div className="flex items-center gap-3 bg-surface-container rounded-[0.75rem] px-5 py-3 text-sm text-on-surface-variant mb-4">
            <LoadingSpinner size="sm" label="分析データコンテキストを再構築しています…" />
          </div>
        )}
        {!reportBundle?.reportMd && (
          <div className="flex items-center gap-3 bg-surface-container rounded-[0.75rem] px-5 py-3 text-sm text-on-surface-variant mb-4">
            <span className="material-symbols-outlined text-lg">info</span>
            <span className="japanese-text">`ads-insights` repo 準拠では、分析データ生成後にそのコンテキストを使って考察を生成します。先にセットアップを完了してください。</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {status && (
              <div className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-bold ${statusTone}`}>
                <span className="material-symbols-outlined text-base">{statusIcon}</span>
                <span className="japanese-text">{status}</span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[11px] font-bold text-on-surface-variant uppercase tracking-[0.24em]">Context</p>
              <div className="flex bg-surface-container rounded-full p-0.5">
                <button
                  onClick={() => setContextMode('ads-only')}
                  className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
                    contextMode === 'ads-only'
                      ? 'bg-primary text-on-primary'
                      : 'text-on-surface-variant hover:bg-surface-container-high'
                  }`}
                >
                  広告データのみ
                </button>
                <button
                  onClick={() => setContextMode('ads-with-ml')}
                  className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
                    contextMode === 'ads-with-ml'
                      ? 'bg-primary text-on-primary'
                      : 'text-on-surface-variant hover:bg-surface-container-high'
                  }`}
                >
                  + Market Lens
                </button>
              </div>
              {contextMode === 'ads-with-ml' && (
                <span className={`text-xs flex items-center gap-1 ${mlIndicatorTone}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${mlIndicatorDot}`} />
                  {mlIndicatorLabel}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[11px] font-bold text-on-surface-variant uppercase tracking-[0.24em]">Size</p>
              <div className="flex bg-surface-container rounded-full p-0.5">
                {[
                  { key: 'normal', label: '小' },
                  { key: 'large', label: '中' },
                  { key: 'xlarge', label: '大' },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => handleFontSizeChange(opt.key)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                      fontSize === opt.key
                        ? 'bg-primary text-on-primary'
                        : 'text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setMessages([]); setStatus(''); clearDraft('ai-explorer') }}
              disabled={messages.length === 0}
              className="px-4 py-2 bg-surface-container text-on-surface-variant rounded-[0.75rem] font-bold text-xs flex items-center gap-2 hover:opacity-90 transition-all disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-sm">delete_sweep</span>
              チャット消去
            </button>
            <button
              onClick={handleRefreshReport}
              disabled={!setupState || !isAdsAuthenticated || reportLoading}
              className="px-4 py-2 bg-secondary text-on-secondary rounded-[0.75rem] font-bold text-xs flex items-center gap-2 hover:opacity-90 transition-all disabled:opacity-50"
            >
              {reportLoading ? <LoadingSpinner size="sm" /> : <span className="material-symbols-outlined text-sm">sync</span>}
              コンテキスト更新
            </button>
          </div>
        </div>

        {contextMode === 'ads-with-ml' && mlStatus === 'unavailable' && (
          <p className="text-xs text-amber-700 dark:text-warning japanese-text">
            Market Lens の履歴 API が停止中のため、広告データのみで回答します。
          </p>
        )}
        {contextMode === 'ads-with-ml' && mlStatus === 'cold_start' && (
          <p className="text-xs text-sky-700 dark:text-on-info-container japanese-text">
            Market Lens バックエンドが起動中です。1〜2分後にコンテキスト更新を試してください。広告データのみで回答します。
          </p>
        )}
        {contextMode === 'ads-with-ml' && mlStatus === 'error' && (
          <p className="text-xs text-red-700 dark:text-on-error-container japanese-text">
            Market Lens の履歴取得に失敗しました。広告データのみで回答します。
          </p>
        )}

        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-bold text-on-surface-variant uppercase tracking-[0.24em]">Quick Analysis</p>
            <div className="grid grid-cols-3 gap-6">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt.label}
                  onClick={() => handleSend(prompt.label)}
                  disabled={promptDisabled}
                  className="flex flex-col items-start gap-3 p-5 rounded-xl bg-surface-container-lowest ghost-border hover:shadow-[0_10px_30px_rgba(25,29,30,0.06)] transition-shadow text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className={`material-symbols-outlined text-[22px] ${prompt.color}`}>{prompt.icon}</span>
                  <span className="japanese-text">{prompt.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 pt-3 pb-6 space-y-6" aria-live="polite">
        {messages.length === 0 && (
          <div className="text-center py-20 text-on-surface-variant">
            <div className="w-16 h-16 bg-primary-container/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="material-symbols-outlined text-4xl text-primary-container">auto_awesome</span>
            </div>
            <p className="text-[2rem] font-extrabold japanese-text text-on-surface">AI エクスプローラー</p>
            <p className="text-sm mt-2">分析データとグラフ要約を根拠に、BQ データの質問へ具体的に回答します</p>
          </div>
        )}

        {messages.map((message, index) =>
          isAssistantMessage(message) ? (
            <div key={index} className="flex gap-4">
              <div className="w-10 h-10 bg-primary-container/20 rounded-full flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-primary-container text-lg">auto_awesome</span>
              </div>
              <div>
                <p className="text-xs font-bold text-on-surface-variant mb-1">AI 考察エンジン</p>
                <div className={`bg-surface-container-lowest rounded-2xl rounded-tl-none panel-card-hover p-8 max-w-5xl ${message.isError ? 'border border-red-200 dark:border-error/30' : ''}`}>
                  <MarkdownRenderer content={message.text} className="text-sm" size={fontSize} />
                </div>
              </div>
            </div>
          ) : (
            <div key={index} className="flex justify-end gap-4">
              <div className="bg-primary-container text-on-primary rounded-2xl rounded-tr-none px-6 py-4 max-w-3xl">
                <p className={`${USER_TEXT_SIZE[fontSize]} leading-relaxed text-on-primary japanese-text`}>{message.text}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-secondary-container flex items-center justify-center text-sm font-bold text-on-secondary-container shrink-0">
                {avatarInitial}
              </div>
            </div>
          ),
        )}

        {loading && (
          <div className="flex gap-4">
            <div className="w-10 h-10 bg-primary-container/20 rounded-full flex items-center justify-center shrink-0">
              <LoadingSpinner size="sm" />
            </div>
            <div>
              <p className="text-xs font-bold text-on-surface-variant mb-1">AI 考察エンジン</p>
              <div className="bg-surface-container-lowest rounded-2xl rounded-tl-none panel-card-hover p-6">
                <p className={`${USER_TEXT_SIZE[fontSize]} text-on-surface-variant japanese-text`}>考察を生成中…</p>
              </div>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      <div className="px-6 pb-6 pt-2 backdrop-blur-sm">
        {messages.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt.label}
                onClick={() => handleSend(prompt.label)}
                disabled={promptDisabled}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container text-xs font-medium text-on-surface-variant hover:bg-surface-container-high transition-all disabled:opacity-50"
              >
                <span className={`material-symbols-outlined text-sm ${prompt.color}`}>{prompt.icon}</span>
                <span className="japanese-text">{prompt.label}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-3 rounded-full bg-surface-container px-6 py-2">
          <input
            className="flex-1 bg-transparent outline-none text-sm"
            placeholder="AIにデータについて質問する..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={promptDisabled}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || promptDisabled}
            className="w-10 h-10 bg-primary-container text-on-primary rounded-full flex items-center justify-center hover:opacity-88 transition-all disabled:opacity-45 disabled:cursor-not-allowed"
            aria-label="送信"
          >
            <span className="material-symbols-outlined">send</span>
          </button>
        </div>
        <div className="flex items-center justify-center gap-6 mt-3 text-xs text-on-surface-variant">
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-xs">lock</span>
            エンタープライズ品質の暗号化
          </span>
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-xs">verified_user</span>
            学習データとしての利用はされません
          </span>
        </div>
      </div>
    </div>
  )
}
