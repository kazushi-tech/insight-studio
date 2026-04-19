import { useEffect, useMemo, useRef } from 'react'
import { LoadingSpinner, ErrorBanner } from '../../ui'
import InsightTurnCard from './InsightTurnCard'
import LoadingSkeleton from './LoadingSkeleton'
import QuickPromptCard from './QuickPromptCard'
import PeriodSelector from './PeriodSelector'
import styles from './AiExplorerV2.module.css'

/**
 * InsightTimeline — v2 container replacing the bubble feed in AiExplorer.jsx.
 * Pure presentational: all state/handlers come in as props from AiExplorer.
 * Business logic (neonGenerate, MarketLens context, draft persistence) stays
 * in AiExplorer so v1 parity is preserved when ?ui=v1.
 */

const DEFAULT_QUICK_PROMPTS = [
  {
    icon: 'warning',
    title: 'コンバージョン流出ポイントを特定して',
    description:
      '直近期間のファネル全体を分析し、離脱率が高いステップと改善優先順位を提示します。',
  },
  {
    icon: 'lightbulb',
    title: '最も効果的な流入チャネルとその理由',
    description:
      'CVR・CPAの観点から最も効率的なチャネルを特定し、その背景を考察します。',
  },
  {
    icon: 'compare_arrows',
    title: '期間比較で一番変化が大きい指標は？',
    description:
      '前期と比較して最も変動した指標をピックアップし、要因仮説を提示します。',
  },
]

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
      turns.push({
        userPrompt: pendingUser?.text ?? '',
        userTimestamp: pendingUser?.timestamp,
        aiContent: message.text ?? '',
        aiTimestamp: message.timestamp,
        isError: !!message.isError,
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
  loading = false,
  promptDisabled = false,
  fontSize = 'normal',
  status = '',
  statusTone = '',
  statusIcon = 'info',
  contextMode,
  setContextMode,
  handleFontSizeChange,
  mlIndicatorTone,
  mlIndicatorDot,
  mlIndicatorLabel,
  reportLoading = false,
  setupState,
  isAdsAuthenticated,
  handleRefreshReport,
  hasAnalysisKey = true,
  onClearChat,
  quickPrompts = DEFAULT_QUICK_PROMPTS,
  mlStatus,
  reportError,
  reportBundle,
  currentRun,
}) {
  const endRef = useRef(null)

  useEffect(() => {
    if (typeof endRef.current?.scrollIntoView === 'function') {
      endRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, loading])

  const turns = useMemo(() => groupMessagesIntoTurns(messages), [messages])

  // Pending turn = trailing user prompt without an assistant reply (loading).
  const pendingTurn = turns.length > 0 && turns[turns.length - 1].pending ? turns[turns.length - 1] : null
  const completedTurns = pendingTurn ? turns.slice(0, -1) : turns

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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {!isAdsAuthenticated && (
          <div className={`${styles.banner} ${styles.bannerWarning}`}>
            <span className="material-symbols-outlined" aria-hidden="true">warning</span>
            <span className="japanese-text">
              考察スタジオへのログインが必要です。ヘッダーの鍵アイコンから認証してください。
            </span>
          </div>
        )}
        {!hasAnalysisKey && (
          <div className={`${styles.banner} ${styles.bannerWarning}`}>
            <span className="material-symbols-outlined" aria-hidden="true">warning</span>
            <span className="japanese-text">
              分析用 Claude API キーが未設定です。設定画面から設定してください。
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
              `ads-insights` repo 準拠では、分析データ生成後にそのコンテキストを使って考察を生成します。先にセットアップを完了してください。
            </span>
          </div>
        )}
      </div>

      {/* ───────── Header controls ───────── */}
      <header className={styles.header}>
        <div className={styles.headerControls}>
          <div className={styles.headerLeft}>
            {status && (
              <div className={`${styles.statusChip} ${statusTone}`} role="status">
                <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: '1rem' }}>
                  {statusIcon}
                </span>
                <span className="japanese-text">{status}</span>
              </div>
            )}
            {setContextMode && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <p style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.24em', textTransform: 'uppercase', color: '#707973' }}>
                  Context
                </p>
                <div style={{ display: 'inline-flex', background: '#f4f4ef', borderRadius: 999, padding: '0.125rem' }}>
                  <button
                    type="button"
                    onClick={() => setContextMode('ads-only')}
                    className="japanese-text"
                    style={{
                      padding: '0.375rem 0.875rem',
                      borderRadius: 999,
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      background: contextMode === 'ads-only' ? '#003925' : 'transparent',
                      color: contextMode === 'ads-only' ? '#ffffff' : '#404943',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    広告データのみ
                  </button>
                  <button
                    type="button"
                    onClick={() => setContextMode('ads-with-ml')}
                    className="japanese-text"
                    style={{
                      padding: '0.375rem 0.875rem',
                      borderRadius: 999,
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      background: contextMode === 'ads-with-ml' ? '#003925' : 'transparent',
                      color: contextMode === 'ads-with-ml' ? '#ffffff' : '#404943',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    + Market Lens
                  </button>
                </div>
                {contextMode === 'ads-with-ml' && mlIndicatorLabel && (
                  <span className={`text-xs ${mlIndicatorTone ?? ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem' }}>
                    <span className={`${mlIndicatorDot ?? ''}`} style={{ width: '0.375rem', height: '0.375rem', borderRadius: 999 }} />
                    {mlIndicatorLabel}
                  </span>
                )}
              </div>
            )}
            {handleFontSizeChange && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <p style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.24em', textTransform: 'uppercase', color: '#707973' }}>
                  Size
                </p>
                <div style={{ display: 'inline-flex', background: '#f4f4ef', borderRadius: 999, padding: '0.125rem' }}>
                  {[
                    { key: 'normal', label: '小' },
                    { key: 'large', label: '中' },
                    { key: 'xlarge', label: '大' },
                  ].map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => handleFontSizeChange(opt.key)}
                      style={{
                        padding: '0.375rem 0.75rem',
                        borderRadius: 999,
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        background: fontSize === opt.key ? '#003925' : 'transparent',
                        color: fontSize === opt.key ? '#ffffff' : '#404943',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className={styles.headerRight}>
            <PeriodSelector analysisRun={currentRun} />
            <button
              type="button"
              onClick={onClearChat}
              disabled={messages.length === 0}
              className="japanese-text"
              style={{
                padding: '0.5rem 0.875rem',
                borderRadius: 12,
                background: '#f4f4ef',
                color: '#404943',
                border: 'none',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.375rem',
                opacity: messages.length === 0 ? 0.5 : 1,
              }}
              aria-label="チャット消去"
            >
              <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: '1rem' }}>
                delete_sweep
              </span>
              チャット消去
            </button>
            <button
              type="button"
              onClick={handleRefreshReport}
              disabled={!setupState || !isAdsAuthenticated || reportLoading}
              className="japanese-text"
              style={{
                padding: '0.5rem 0.875rem',
                borderRadius: 12,
                background: '#003925',
                color: '#ffffff',
                border: 'none',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.375rem',
                opacity: (!setupState || !isAdsAuthenticated || reportLoading) ? 0.5 : 1,
              }}
              aria-label="コンテキスト更新"
            >
              {reportLoading ? <LoadingSpinner size="sm" /> : (
                <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: '1rem' }}>
                  sync
                </span>
              )}
              コンテキスト更新
            </button>
          </div>
        </div>

        {contextMode === 'ads-with-ml' && mlStatus === 'unavailable' && (
          <p className="japanese-text" style={{ fontSize: '0.75rem', color: '#93580f' }}>
            Market Lens の履歴 API が停止中のため、広告データのみで回答します。
          </p>
        )}
        {contextMode === 'ads-with-ml' && mlStatus === 'cold_start' && (
          <p className="japanese-text" style={{ fontSize: '0.75rem', color: '#0369a1' }}>
            Market Lens バックエンドが起動中です。1〜2分後にコンテキスト更新を試してください。広告データのみで回答します。
          </p>
        )}
        {contextMode === 'ads-with-ml' && mlStatus === 'error' && (
          <p className="japanese-text" style={{ fontSize: '0.75rem', color: '#ba1a1a' }}>
            Market Lens の履歴取得に失敗しました。広告データのみで回答します。
          </p>
        )}
      </header>

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
                分析データとグラフ要約を根拠に、BQデータの質問へ具体的に回答します。以下のプロンプトから始めるか、独自の質問を入力してください。
              </p>
              <div className={`${styles.emptyQuickPrompts} ${styles.quickPromptGrid}`}>
                {quickPrompts.map(renderQuickPromptCard)}
              </div>
            </section>
          ) : (
            <>
              {completedTurns.map((turn, idx) => (
                <InsightTurnCard key={idx} turn={turn} size={fontSize} />
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

        <div className={styles.composerInput}>
          <input
            className={`${styles.composerField} japanese-text`}
            placeholder="データに対する質問や分析したい仮説を入力してください…"
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
