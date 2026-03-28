import { useEffect, useMemo, useRef, useState } from 'react'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { AUTH_EXPIRED_MESSAGE, neonGenerate } from '../api/adsInsights'
import { getScans } from '../api/marketLens'
import { LoadingSpinner, ErrorBanner } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useAdsSetup } from '../contexts/AdsSetupContext'
import { useUserProfile } from '../contexts/UserProfileContext'
import {
  buildAiChartContext,
  regenerateAdsReportBundle,
} from '../utils/adsReports'
import { getAdsText, normalizeAdsPayload } from '../utils/adsResponse'

const QUICK_PROMPTS = [
  { icon: 'warning', label: 'リスクを要約して', color: 'text-red-500' },
  { icon: 'lightbulb', label: 'ROI改善のアイデア', color: 'text-emerald-500' },
  { icon: 'compare_arrows', label: '先月と比較して', color: 'text-purple-500' },
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
  return messages.slice(-10).map((message) => ({
    role: isAssistantMessage(message) ? 'assistant' : 'user',
    text:
      typeof message?.text === 'string' && message.text.length > 500
        ? `${message.text.slice(0, 500)}…(省略)`
        : message?.text ?? '',
  }))
}

export default function AiExplorer() {
  const { isAdsAuthenticated, geminiKey, hasGeminiKey } = useAuth()
  const { setupState, reportBundle, setReportBundle } = useAdsSetup()
  const { avatarInitial } = useUserProfile()
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState(null)
  const [status, setStatus] = useState('')
  const [contextMode, setContextMode] = useState('ads-only')
  const [mlContextSummary, setMlContextSummary] = useState(null)
  const [mlLoading, setMlLoading] = useState(false)
  const [mlStatus, setMlStatus] = useState('idle')
  const chatEndRef = useRef(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!setupState || !isAdsAuthenticated) return
    if (reportBundle?.source === 'bq_generate_batch') return

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

    getScans()
      .then((data) => {
        const items = data.scans ?? data.history ?? data.results ?? (Array.isArray(data) ? data : [])
        const summary = summarizeHistory(items)
        setMlContextSummary(summary)
        setMlStatus(summary ? 'ready' : 'empty')
      })
      .catch((e) => {
        setMlContextSummary(null)
        setMlStatus(e.status === 404 ? 'unavailable' : 'error')
      })
      .finally(() => setMlLoading(false))
  }, [contextMode])

  const chartContext = useMemo(
    () => buildAiChartContext(reportBundle?.chartGroups ?? []),
    [reportBundle?.chartGroups],
  )

  const promptDisabled =
    !isAdsAuthenticated || !hasGeminiKey || !reportBundle?.reportMd || loading || reportLoading

  async function handleSend(text) {
    const prompt = (text ?? input).trim()
    if (!prompt || loading || !reportBundle?.reportMd) return

    setInput('')

    const userMessage = { role: 'user', text: prompt }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setLoading(true)
    setStatus('考察生成中...')

    try {
      const enrichedPrompt =
        contextMode === 'ads-with-ml' && mlContextSummary
          ? `${prompt}\n\n[補助コンテキスト: Market Lens]\n${mlContextSummary}`
          : prompt

      const data = await neonGenerate(
        {
          mode: 'question',
          model: 'gemini-2.5-flash',
          temperature: 0.7,
          message: enrichedPrompt,
          point_pack_md: reportBundle.reportMd,
          style_reference: '',
          style_preset: 'mixed',
          data_source: 'bq',
          bq_query_types: setupState?.queryTypes ?? [],
          conversation_history: toConversationHistory(nextMessages),
          ai_chart_context: chartContext,
        },
        geminiKey,
      )

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

      if (aiContent.length < 100 && !aiContent.includes('不明') && !aiContent.includes('未取得')) {
        setStatus('⚠️ AI応答が短いです。質問を具体化すると改善する場合があります。')
      } else {
        setStatus('✓ 考察生成完了')
      }
    } catch (e) {
      const errorMsg = e.isAuthError ? AUTH_EXPIRED_MESSAGE : e.message
      setStatus(`生成エラー: ${errorMsg}`)
      setMessages([
        ...nextMessages,
        { role: 'assistant', text: `エラー: ${errorMsg}`, isError: true },
      ])
    } finally {
      setLoading(false)
    }
  }

  async function handleRefreshReport() {
    if (!setupState || !isAdsAuthenticated || reportLoading) return

    setReportLoading(true)
    setReportError(null)
    setStatus('要点パックとグラフを再取得中...')

    try {
      const nextBundle = await regenerateAdsReportBundle(setupState)
      setReportBundle(nextBundle)
      setStatus('✓ 要点パックとグラフを更新しました')
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
    : mlStatus === 'error'
    ? 'text-red-700'
    : 'text-on-surface-variant'

  const mlIndicatorDot = mlLoading
    ? 'bg-amber-400 animate-pulse'
    : mlStatus === 'ready'
    ? 'bg-emerald-500'
    : mlStatus === 'unavailable'
    ? 'bg-amber-500'
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
    : mlStatus === 'error'
    ? '読込失敗'
    : '未接続'

  const statusTone = status.startsWith('生成エラー') || status.startsWith('更新エラー')
    ? 'bg-red-50 border-red-200 text-red-700'
    : status.startsWith('⚠️')
    ? 'bg-amber-50 border-amber-200 text-amber-800'
    : status.startsWith('✓')
    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
    : 'bg-surface-container border-outline-variant/30 text-on-surface-variant'
  const statusIcon = status.startsWith('生成エラー') || status.startsWith('更新エラー')
    ? 'error'
    : status.startsWith('⚠️')
    ? 'warning'
    : status.startsWith('✓')
    ? 'check_circle'
    : 'info'

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="px-10 pt-5 pb-3 space-y-3">
        {!isAdsAuthenticated && (
          <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-[0.75rem] px-5 py-3 text-sm text-amber-800 mb-4">
            <span className="material-symbols-outlined text-lg">warning</span>
            <span className="japanese-text">考察スタジオへのログインが必要です。ヘッダーの鍵アイコンから認証してください。</span>
          </div>
        )}
        {!hasGeminiKey && (
          <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-[0.75rem] px-5 py-3 text-sm text-amber-800 mb-4">
            <span className="material-symbols-outlined text-lg">warning</span>
            <span className="japanese-text">Gemini API キーが未設定です。ヘッダーの鍵アイコンから設定してください。</span>
          </div>
        )}
        {reportError && (
          <div className="mb-4">
            <ErrorBanner message={reportError} onRetry={handleRefreshReport} />
          </div>
        )}
        {reportLoading && !reportBundle?.reportMd && (
          <div className="flex items-center gap-3 bg-surface-container rounded-[0.75rem] px-5 py-3 text-sm text-on-surface-variant mb-4">
            <LoadingSpinner size="sm" label="要点パックとグラフコンテキストを再構築しています…" />
          </div>
        )}
        {!reportBundle?.reportMd && (
          <div className="flex items-center gap-3 bg-surface-container rounded-[0.75rem] px-5 py-3 text-sm text-on-surface-variant mb-4">
            <span className="material-symbols-outlined text-lg">info</span>
            <span className="japanese-text">`ads-insights` repo 準拠では、要点パック生成後にその `point_pack_md` を使って考察を生成します。先にセットアップを完了してください。</span>
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
          </div>
          <button
            onClick={handleRefreshReport}
            disabled={!setupState || !isAdsAuthenticated || reportLoading}
            className="px-4 py-2 bg-secondary text-on-secondary rounded-[0.75rem] font-bold text-xs flex items-center gap-2 hover:opacity-90 transition-all disabled:opacity-50"
          >
            {reportLoading ? <LoadingSpinner size="sm" /> : <span className="material-symbols-outlined text-sm">sync</span>}
            コンテキスト更新
          </button>
        </div>

        {contextMode === 'ads-with-ml' && mlStatus === 'unavailable' && (
          <p className="text-xs text-amber-700 japanese-text">
            Market Lens の履歴 API が停止中のため、広告データのみで回答します。
          </p>
        )}
        {contextMode === 'ads-with-ml' && mlStatus === 'error' && (
          <p className="text-xs text-red-700 japanese-text">
            Market Lens の履歴取得に失敗しました。広告データのみで回答します。
          </p>
        )}

        <div className="space-y-2">
          <p className="text-[11px] font-bold text-on-surface-variant uppercase tracking-[0.24em]">Quick Analysis</p>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt.label}
                onClick={() => handleSend(prompt.label)}
                disabled={promptDisabled}
                className="flex shrink-0 items-center gap-2 px-4 py-2.5 bg-surface-container-lowest rounded-[0.75rem] ghost-border hover:border-secondary/40 transition-colors text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className={`material-symbols-outlined text-[18px] ${prompt.color}`}>{prompt.icon}</span>
                <span className="japanese-text">{prompt.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-10 pt-3 pb-6 space-y-6" aria-live="polite">
        {messages.length === 0 && (
          <div className="text-center py-20 text-on-surface-variant">
            <span className="material-symbols-outlined text-6xl text-outline-variant mb-4 block">smart_toy</span>
            <p className="text-lg font-bold japanese-text">AI考察エンジン</p>
            <p className="text-sm mt-1">要点パックとグラフ要約を根拠に、BQ データの質問へ具体的に回答します</p>
          </div>
        )}

        {messages.map((message, index) =>
          isAssistantMessage(message) ? (
            <div key={index} className="flex gap-4">
              <div className="w-10 h-10 bg-primary-container rounded-xl flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-gold text-lg">smart_toy</span>
              </div>
              <div className={`bg-surface-container-lowest rounded-[0.75rem] panel-card-hover p-6 max-w-3xl ${message.isError ? 'border border-red-200' : ''}`}>
                <MarkdownRenderer content={message.text} className="text-sm" />
                <p className="text-xs text-on-surface-variant mt-3">AI 考察エンジン</p>
              </div>
            </div>
          ) : (
            <div key={index} className="flex justify-end gap-4">
              <div className="bg-primary-container text-on-primary rounded-[0.75rem] px-6 py-4 max-w-2xl">
                <p className="text-sm leading-relaxed text-on-primary japanese-text">{message.text}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-secondary-container flex items-center justify-center text-sm font-bold text-on-secondary-container shrink-0">
                {avatarInitial}
              </div>
            </div>
          ),
        )}

        {loading && (
          <div className="flex gap-4">
            <div className="w-10 h-10 bg-primary-container rounded-xl flex items-center justify-center shrink-0">
              <LoadingSpinner size="sm" />
            </div>
            <div className="bg-surface-container-lowest rounded-[0.75rem] panel-card-hover p-6">
              <p className="text-sm text-on-surface-variant japanese-text">考察を生成中…</p>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      <div className="px-10 pb-6 pt-2">
        <div className="flex items-center gap-3 bg-surface-container-lowest rounded-[0.75rem] ghost-border px-6 py-3">
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
            className="w-10 h-10 bg-gold text-primary-container rounded-full flex items-center justify-center hover:opacity-88 transition-all disabled:opacity-45 disabled:cursor-not-allowed"
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
