import { useState, useRef, useEffect } from 'react'
import { generateInsights } from '../api/adsInsights'
import { getScans } from '../api/marketLens'
import { useAuth } from '../contexts/AuthContext'

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

export default function AiExplorer() {
  const { isAdsAuthenticated } = useAuth()
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [contextMode, setContextMode] = useState('ads-only')
  const [mlContextSummary, setMlContextSummary] = useState(null)
  const [mlLoading, setMlLoading] = useState(false)
  const [mlStatus, setMlStatus] = useState('idle')
  const chatEndRef = useRef(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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

  async function handleSend(text) {
    const prompt = text ?? input.trim()
    if (!prompt || loading) return

    setInput('')

    const userMessage = { role: 'user', content: prompt }
    setMessages((prev) => [...prev, userMessage])
    setLoading(true)

    try {
      const enrichedPrompt = mlContextSummary
        ? `[Market Lens Summary]\n${mlContextSummary}\n\n[Question]\n${prompt}`
        : prompt
      const data = await generateInsights({ type: 'chat', prompt: enrichedPrompt })
      const aiContent = data.response ?? data.analysis ?? data.content ?? JSON.stringify(data)
      setMessages((prev) => [...prev, { role: 'ai', content: aiContent }])
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'ai', content: `エラー: ${e.message}`, isError: true }])
    } finally {
      setLoading(false)
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

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="px-10 pt-8 pb-4">
        {!isAdsAuthenticated && (
          <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 text-sm text-amber-800 mb-4">
            <span className="material-symbols-outlined text-lg">warning</span>
            <span className="japanese-text">考察スタジオへのログインが必要です。ヘッダーの鍵アイコンから認証してください。</span>
          </div>
        )}

        <div className="flex items-center gap-3 mb-4">
          <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest">CONTEXT</p>
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

        {contextMode === 'ads-with-ml' && mlStatus === 'unavailable' && (
          <p className="text-xs text-amber-700 mb-4 japanese-text">
            Market Lens の履歴 API が停止中のため、広告データのみで回答します。
          </p>
        )}
        {contextMode === 'ads-with-ml' && mlStatus === 'error' && (
          <p className="text-xs text-red-700 mb-4 japanese-text">
            Market Lens の履歴取得に失敗しました。広告データのみで回答します。
          </p>
        )}

        <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-4">QUICK ANALYSIS</p>
        <div className="flex gap-4">
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt.label}
              onClick={() => handleSend(prompt.label)}
              disabled={!isAdsAuthenticated || loading}
              className="flex items-center gap-3 px-6 py-3 bg-surface-container-lowest rounded-xl border border-outline-variant/30 hover:border-secondary/50 hover:shadow-lg transition-all text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className={`material-symbols-outlined ${prompt.color}`}>{prompt.icon}</span>
              <span className="japanese-text">{prompt.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-10 py-6 space-y-6">
        {messages.length === 0 && (
          <div className="text-center py-20 text-on-surface-variant">
            <span className="material-symbols-outlined text-6xl text-outline-variant mb-4 block">smart_toy</span>
            <p className="text-lg font-bold japanese-text">AI考察エンジン</p>
            <p className="text-sm mt-1">データについて質問すると、AIが考察を生成します</p>
          </div>
        )}

        {messages.map((message, index) =>
          message.role === 'ai' ? (
            <div key={index} className="flex gap-4">
              <div className="w-10 h-10 bg-primary-container rounded-xl flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-gold text-lg">smart_toy</span>
              </div>
              <div className={`bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6 max-w-3xl ${message.isError ? 'border border-red-200' : ''}`}>
                <div className="text-sm leading-relaxed whitespace-pre-wrap japanese-text">{message.content}</div>
                <p className="text-xs text-on-surface-variant mt-3">AI 考察エンジン</p>
              </div>
            </div>
          ) : (
            <div key={index} className="flex justify-end gap-4">
              <div className="bg-primary-container text-on-primary rounded-2xl px-6 py-4 max-w-2xl">
                <p className="text-sm leading-relaxed text-white japanese-text">{message.content}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-secondary-container flex items-center justify-center text-sm font-bold text-on-secondary-container shrink-0">
                田
              </div>
            </div>
          )
        )}

        {loading && (
          <div className="flex gap-4">
            <div className="w-10 h-10 bg-primary-container rounded-xl flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-gold text-lg animate-spin">progress_activity</span>
            </div>
            <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6">
              <p className="text-sm text-on-surface-variant japanese-text">考察を生成中…</p>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      <div className="px-10 pb-6 pt-2">
        <div className="flex items-center gap-3 bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] px-6 py-3">
          <input
            className="flex-1 bg-transparent outline-none text-sm"
            placeholder="AIにデータについて質問する..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!isAdsAuthenticated}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || loading || !isAdsAuthenticated}
            className="w-10 h-10 bg-secondary text-on-secondary rounded-full flex items-center justify-center hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
