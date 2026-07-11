import { useEffect, useMemo, useRef } from 'react'
import { LoadingSpinner, ErrorBanner } from '../../ui'
import InsightTurnCard from './InsightTurnCard'
import LoadingSkeleton from './LoadingSkeleton'
import QuickPromptCard from './QuickPromptCard'
import styles from './AiExplorerV2.module.css'
import { CUSTOMER_AI_PROMPT_CARDS } from '../../../utils/customerReport'

/**
 * InsightTimeline — v2 container replacing the bubble feed in AiExplorer.jsx.
 * Pure presentational: all state/handlers come in as props from AiExplorer.
 * Business logic (neonGenerate, MarketLens context, draft persistence) stays
 * in AiExplorer so v1 parity is preserved when ?ui=v1.
 */

const DEFAULT_QUICK_PROMPTS = CUSTOMER_AI_PROMPT_CARDS

const LEGACY_FORMAT_ERROR_TEXT = 'この回答は表示形式を整えられませんでした。'

function normalizeLegacyAssistantMessageText(text) {
  const value = String(text ?? '')
  if (!value.includes(LEGACY_FORMAT_ERROR_TEXT)) return value
  return [
    '## 古い形式の回答です',
    '',
    'このセッションには、以前のAI回答形式で保存された壊れた回答が残っています。',
    'セッションをクリアするか、同じ質問を再試行して再生成してください。',
  ].join('\n')
}

function groupMessagesIntoTurns(messages) {
  if (!Array.isArray(messages)) return []
  const turns = []
  let pendingUser = null

  for (const message of messages) {
    if (!message || typeof message.role !== 'string') continue
    const role = message.role === 'ai' ? 'assistant' : message.role

    if (role === 'user') {
      if (pendingUser) {
        turns.push({ userPrompt: pendingUser.text, userTimestamp: pendingUser.timestamp, aiContent: '', aiTimestamp: null, isError: false, pending: true })
      }
      pendingUser = { text: message.text ?? '', timestamp: message.timestamp }
    } else if (role === 'assistant') {
      const isLegacyFormatError = String(message.text ?? '').includes(LEGACY_FORMAT_ERROR_TEXT)
      turns.push({
        userPrompt: pendingUser?.text ?? '',
        userTimestamp: pendingUser?.timestamp,
        aiContent: normalizeLegacyAssistantMessageText(message.text),
        aiTimestamp: message.timestamp,
        isError: !!message.isError,
        fallbackNotice: message.fallbackNotice,
        legacyFormatError: isLegacyFormatError,
        caveats: Array.isArray(message.caveats) ? message.caveats : [],
        analysisContext: message.analysisContext,
        parseStatus: message.parseStatus,
        fallbackUsed: message.fallbackUsed,
        agentTrace: message.agentTrace,
      })
      pendingUser = null
    }
  }

  if (pendingUser) {
    turns.push({
      userPrompt: pendingUser.text,
      userTimestamp: pendingUser.timestamp,
      aiContent: '',
      aiTimestamp: null,
      isError: false,
      pending: true,
    })
  }

  return turns
}

export default function InsightTimeline({
  messages = [],
  input = '',
  setInput,
  onSend,
  onClearChat,
  loading = false,
  promptDisabled = false,
  fontSize = 'normal',
  status = '',
  statusTone = '',
  statusIcon = 'info',
  reportLoading = false,
  setupState,
  isAdsAuthenticated,
  handleRefreshReport,
  hasAnalysisKey = true,
  onRetryPrompt,
  quickPrompts = DEFAULT_QUICK_PROMPTS,
  reportError,
  reportBundle,
  chartGroups,
  isDemo = false,
}) {
  const endRef = useRef(null)

  useEffect(() => {
    if (typeof endRef.current?.scrollIntoView === 'function') {
      const reduceMotion = typeof window !== 'undefined'
        && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      endRef.current.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' })
    }
  }, [messages, loading])

  const turns = useMemo(() => groupMessagesIntoTurns(messages), [messages])

  // Pending turn = trailing user prompt without an assistant reply.
  // Only render it while a request is actively loading; restored drafts can
  // otherwise leave a permanent skeleton after reload.
  const danglingPendingTurn = turns.length > 0 && turns[turns.length - 1].pending ? turns[turns.length - 1] : null
  const pendingTurn = loading ? danglingPendingTurn : null
  const completedTurns = danglingPendingTurn ? turns.slice(0, -1) : turns

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!promptDisabled && input.trim()) {
        onSend?.()
      }
    }
  }

  const renderQuickPromptCard = (prompt, idx) => (
    <QuickPromptCard
      key={prompt.title ?? idx}
      icon={prompt.icon}
      title={prompt.title}
      description={prompt.description}
      disabled={promptDisabled}
      onClick={() => onSend?.(prompt.title)}
    />
  )

  return (
    <div className={`ui-v2 ${styles.root}`} data-testid="ai-explorer-v2">
      {/* ───────── Banners ───────── */}
      <div className={styles.bannerStack}>
        {isDemo && (
          <div data-testid="demo-ai-notice" className={`${styles.banner} ${styles.bannerInfo}`}>
            <span className="material-symbols-outlined" aria-hidden="true">science</span>
            <span className="japanese-text">デモでは固定された架空回答を表示します。外部AIは利用しません。</span>
          </div>
        )}
        {!isAdsAuthenticated && (
          <div className={`${styles.banner} ${styles.bannerWarning}`}>
            <span className="material-symbols-outlined" aria-hidden="true">warning</span>
            <span className="japanese-text">
              Webサイト分析への接続が必要です。ヘッダーの鍵アイコンから認証してください。
            </span>
          </div>
        )}
        {!hasAnalysisKey && !isDemo && (
          <div className={`${styles.banner} ${styles.bannerInfo}`}>
            <span className="material-symbols-outlined" aria-hidden="true">data_check</span>
            <span className="japanese-text">
              APIキーなしの根拠整理モードで利用できます。Geminiを設定すると、安価な1回生成と厳格検査で詳しい考察に切り替わります。
            </span>
          </div>
        )}
        {reportError && (
          <ErrorBanner message={reportError} onRetry={handleRefreshReport} />
        )}
        {reportLoading && !reportBundle?.reportMd && (
          <div className={`${styles.banner} ${styles.bannerInfo}`}>
            <LoadingSpinner size="sm" label="分析データコンテキストを再構築しています…" />
          </div>
        )}
        {!reportBundle?.reportMd && (
          <div className={`${styles.banner} ${styles.bannerInfo}`}>
            <span className="material-symbols-outlined" aria-hidden="true">info</span>
            <span className="japanese-text">
              {setupState
                ? '分析データのコンテキストを準備しています。完了後、この画面でそのままAIへ質問できます。'
                : '先に広告グラフのセットアップを完了してください。'}
            </span>
          </div>
        )}
      </div>

      <div className={styles.sessionToolbar} data-testid="ai-session-toolbar">
        <div className={styles.sessionMeta}>
          <span className="material-symbols-outlined" aria-hidden="true">forum</span>
          <div>
            <p className="japanese-text">現在のAI考察セッション</p>
            <small className="japanese-text">
              {messages.length > 0
                ? `${Math.ceil(messages.length / 2)}件のやり取りを保持中。精度を戻すなら新しいセッションで聞き直せます。`
                : '新しい質問は履歴なしの状態で開始されます。'}
            </small>
          </div>
        </div>
        <div className={styles.sessionActions}>
          {status && (
            <span className={`${styles.statusPill} ${statusTone}`}>
              <span className="material-symbols-outlined" aria-hidden="true">{statusIcon}</span>
              <span className="japanese-text">{status}</span>
            </span>
          )}
          <button
            type="button"
            className={styles.sessionClearButton}
            onClick={onClearChat}
            disabled={messages.length === 0 || loading}
            title="現在のAI考察セッションをクリア"
          >
            <span className="material-symbols-outlined" aria-hidden="true">delete_sweep</span>
            <span className="japanese-text">セッションをクリア</span>
          </button>
        </div>
      </div>

      {/* ───────── Timeline body ───────── */}
      <div className={styles.timelineWrap} aria-live="polite">
        <div className={styles.timeline}>
          {messages.length === 0 ? (
            <section className={styles.emptyState} data-testid="ai-explorer-v2-empty">
              <div className={styles.emptyIcon} aria-hidden="true">
                <span className="material-symbols-outlined">auto_awesome</span>
              </div>
              <h2 className={`${styles.emptyTitle} japanese-text`}>AI考察を始めましょう</h2>
              <p className={`${styles.emptyBody} japanese-text`}>
                Web成果データと根拠グラフをもとに、専門用語を使わず回答します。以下の質問から始めるか、知りたいことを入力してください。
              </p>
              <div className={`${styles.emptyQuickPrompts} ${styles.quickPromptGrid}`}>
                {quickPrompts.map(renderQuickPromptCard)}
              </div>
            </section>
          ) : (
            <>
              {completedTurns.map((turn, idx) => (
                <InsightTurnCard
                  key={idx}
                  turn={turn}
                  size={fontSize}
                  chartGroups={chartGroups}
                  onRetry={onRetryPrompt ? () => onRetryPrompt(turn.userPrompt) : undefined}
                />
              ))}
              {(pendingTurn || loading) && (
                <LoadingSkeleton
                  withPromptPill={!!pendingTurn}
                  promptText={pendingTurn?.userPrompt ?? ''}
                  promptTimestamp={pendingTurn?.userTimestamp}
                />
              )}
            </>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* ───────── Composer ───────── */}
      <div className={styles.composerBar}>
        {messages.length > 0 && (
          <div className={styles.composerQuickChips}>
            {quickPrompts.map((prompt) => (
              <button
                key={prompt.title}
                type="button"
                className={`${styles.composerChip} japanese-text`}
                onClick={() => onSend?.(prompt.title)}
                disabled={promptDisabled}
              >
                <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: '0.875rem' }}>
                  {prompt.icon}
                </span>
                {prompt.title}
              </button>
            ))}
          </div>
        )}

        {messages.length > 0 && (
          <div className={styles.composerTools}>
            <button
              type="button"
              className={`${styles.composerToolButton} japanese-text`}
              onClick={() => onClearChat?.()}
              disabled={loading}
            >
              <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: '0.875rem' }}>
                delete_sweep
              </span>
              チャット消去
            </button>
          </div>
        )}

        <div className={styles.composerInput}>
          <input
            className={`${styles.composerField} japanese-text`}
            placeholder="例: 今日やることを3つに絞って"
            value={input}
            onChange={(e) => setInput?.(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={promptDisabled}
            aria-label="AIへの質問を入力"
          />
          <button
            type="button"
            onClick={() => onSend?.()}
            disabled={!input.trim() || promptDisabled}
            className={styles.composerSend}
            aria-label="送信"
          >
            <span className="material-symbols-outlined" aria-hidden="true">send</span>
          </button>
        </div>

        <div className={`${styles.composerSecurity} japanese-text`}>
          <span>
            <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: '0.875rem' }}>
              lock
            </span>
            エンタープライズ品質の暗号化
          </span>
          <span>
            <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: '0.875rem' }}>
              verified_user
            </span>
            学習データとしての利用はされません
          </span>
        </div>
      </div>
    </div>
  )
}
