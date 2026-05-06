import { useEffect, useMemo, useRef } from 'react'
import { LoadingSpinner, ErrorBanner } from '../../ui'
import InsightTurnCard from './InsightTurnCard'
import LoadingSkeleton from './LoadingSkeleton'
import QuickPromptCard from './QuickPromptCard'
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
    title: 'CV悪化の原因を特定',
    description:
      '直近期間のファネル変化から、CV悪化の主因と最初に潰すべき箇所を出します。',
  },
  {
    icon: 'lightbulb',
    title: 'CPA改善の優先施策',
    description:
      'CPAへの影響が大きい順に、配信・LP・訴求の修正タスクへ分解します。',
  },
  {
    icon: 'compare_arrows',
    title: '流入チャネル別の勝ち筋',
    description:
      'チャネル別に伸ばすべき導線、止めるべき配信、追加で見るKPIを整理します。',
  },
  {
    icon: 'construction',
    title: 'LP/広告/配信設定のどこを直すべきか',
    description:
      'LP改善、広告文、入札・ターゲティングを混ぜずに担当別タスクへ落とします。',
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

function latestAssistantText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    const role = msg?.role === 'ai' ? 'assistant' : msg?.role
    if (role === 'assistant' && typeof msg.text === 'string') return msg.text
  }
  return ''
}

function compactText(value, fallback) {
  const text = String(value || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()
  return text || fallback
}

function extractMetricFromMarkdown(markdown) {
  const match = String(markdown || '').match(/(CVR|CPA|CTR|CPC|ROAS|CV|売上|セッション)[^。\n]{0,28}(?:悪化|改善|上昇|低下|増加|減少|削減)?/i)
  return match?.[0] || ''
}

function buildDecisionBoardState({ reportBundle, messages }) {
  const latest = latestAssistantText(messages)
  const sourceMd = latest || reportBundle?.reportMd || ''
  const actions = Array.isArray(reportBundle?.actions)
    ? reportBundle.actions
    : []
  const periods = Array.isArray(reportBundle?.periods)
    ? reportBundle.periods.map((p) => p.label || p.name || p).filter(Boolean).join(' / ')
    : ''
  const topAction = compactText(
    actions[0]?.title || latest.match(/(?:最優先|今週やる施策|次アクション)[:：]\s*([^\n]+)/)?.[1],
    latest ? '回答内の最優先タスクを確認' : '分析データを生成して最優先施策を確認',
  )

  return {
    topMetric: compactText(
      reportBundle?.decision_summary?.top_metric || extractMetricFromMarkdown(sourceMd),
      'CV / CPA / CVR の変化',
    ),
    cause: compactText(
      reportBundle?.decision_summary?.cause || latest.match(/(?:原因|推定原因)[:：]\s*([^\n]+)/)?.[1],
      latest ? '回答本文の原因セクションを確認' : '分析データ生成後に推定原因を表示',
    ),
    topAction,
    expectedKpi: compactText(
      reportBundle?.decision_summary?.expected_kpi || latest.match(/(?:期待KPI|KPI)[:：]\s*([^\n]+)/)?.[1],
      '初回は CVR / CPA の方向性で判定',
    ),
    period: compactText(periods || reportBundle?.periodLabel || reportBundle?.period, '現在の分析データ期間'),
    confidence: compactText(reportBundle?.decision_summary?.confidence, latest ? '中' : '評価保留'),
    actions: [
      topAction,
      ...actions.slice(1, 3).map((item) => compactText(item.title || item.action, '次タスク')),
    ].slice(0, 3),
  }
}

function InsightDecisionBoard({ reportBundle, messages }) {
  const state = buildDecisionBoardState({ reportBundle, messages })
  return (
    <section className={styles.decisionBoard} data-testid="insight-decision-board" aria-labelledby="insight-decision-board-title">
      <div className={styles.decisionBoardMain}>
        <p className={styles.decisionEyebrow}>AIグラフチャット / Python集計済み</p>
        <h2 id="insight-decision-board-title" className={`${styles.decisionTitle} japanese-text`}>
          グラフを見ながらAIに質問
        </h2>
        <p className="japanese-text" style={{ marginTop: '0.5rem', color: 'var(--color-on-surface-variant)', fontWeight: 700 }}>
          {state.topAction}
        </p>
        <div className={styles.decisionMetaGrid}>
          <div className={styles.decisionMeta}>
            <span>最重要変化指標</span>
            <strong>{state.topMetric}</strong>
          </div>
          <div className={styles.decisionMeta}>
            <span>推定原因</span>
            <strong>{state.cause}</strong>
          </div>
          <div className={styles.decisionMeta}>
            <span>期待KPI</span>
            <strong>{state.expectedKpi}</strong>
          </div>
          <div className={styles.decisionMeta}>
            <span>データ期間</span>
            <strong>{state.period}</strong>
          </div>
          <div className={styles.decisionMeta}>
            <span>信頼度</span>
            <strong>{state.confidence}</strong>
          </div>
        </div>
      </div>
      <aside className={styles.decisionBoardSide} aria-label="優先アクション">
        <p className={styles.decisionEyebrow}>優先アクション</p>
        <div className={styles.decisionActionList}>
          {state.actions.map((action, idx) => (
            <div key={`${action}-${idx}`} className={styles.decisionAction}>
              <b>{idx + 1}</b>
              <p className="japanese-text">{action}</p>
            </div>
          ))}
        </div>
      </aside>
    </section>
  )
}

function SetupRequirementPanel({ setupState, isAdsAuthenticated, reportBundle }) {
  const requirements = [
    {
      key: 'auth',
      label: '認証',
      ok: Boolean(isAdsAuthenticated),
      action: isAdsAuthenticated ? '完了' : 'ヘッダーの鍵アイコンからログイン',
    },
    {
      key: 'case',
      label: '案件',
      ok: Boolean(setupState?.datasetId),
      action: setupState?.datasetId ? setupState.datasetId : '案件にGA4の保存先IDを設定',
    },
    {
      key: 'period',
      label: '期間',
      ok: Array.isArray(setupState?.periods) && setupState.periods.length > 0,
      action: setupState?.periods?.length ? `${setupState.periods.length}期間` : '分析期間を選択',
    },
    {
      key: 'report',
      label: 'レポート生成',
      ok: Boolean(reportBundle?.reportMd),
      action: reportBundle?.reportMd ? '生成済み' : 'セットアップ後にコンテキスト更新',
    },
  ]

  if (requirements.every((item) => item.ok)) return null

  return (
    <section className={styles.requirementPanel} aria-label="Ads AI 利用条件">
      {requirements.map((item) => (
        <div key={item.key} className={item.ok ? styles.requirementOk : styles.requirementTodo}>
          <span className="material-symbols-outlined" aria-hidden="true">
            {item.ok ? 'check_circle' : 'radio_button_unchecked'}
          </span>
          <div>
            <strong className="japanese-text">{item.label}</strong>
            <p className="japanese-text">{item.action}</p>
          </div>
        </div>
      ))}
    </section>
  )
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
  chartGroups,
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
              Gemini または Claude の分析用 API キーが未設定です。設定画面から設定してください。
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
        <SetupRequirementPanel
          setupState={setupState}
          isAdsAuthenticated={isAdsAuthenticated}
          reportBundle={reportBundle}
        />
      </div>

      <InsightDecisionBoard reportBundle={reportBundle} messages={messages} />

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
                <p style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--color-outline)' }}>
                  参照データ
                </p>
                <div style={{ display: 'inline-flex', background: 'var(--color-surface-container-low)', borderRadius: 999, padding: '0.125rem' }}>
                  <button
                    type="button"
                    onClick={() => setContextMode('ads-only')}
                    className="japanese-text"
                    style={{
                      padding: '0.375rem 0.875rem',
                      borderRadius: 999,
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      background: contextMode === 'ads-only' ? 'var(--color-primary)' : 'transparent',
                      color: contextMode === 'ads-only' ? 'var(--color-on-primary)' : 'var(--color-on-surface-variant)',
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
                      background: contextMode === 'ads-with-ml' ? 'var(--color-primary)' : 'transparent',
                      color: contextMode === 'ads-with-ml' ? 'var(--color-on-primary)' : 'var(--color-on-surface-variant)',
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
                <p style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--color-outline)' }}>
                  文字サイズ
                </p>
                <div style={{ display: 'inline-flex', background: 'var(--color-surface-container-low)', borderRadius: 999, padding: '0.125rem' }}>
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
                        background: fontSize === opt.key ? 'var(--color-primary)' : 'transparent',
                        color: fontSize === opt.key ? 'var(--color-on-primary)' : 'var(--color-on-surface-variant)',
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
            <button
              type="button"
              onClick={onClearChat}
              disabled={messages.length === 0}
              className="japanese-text"
              style={{
                padding: '0.5rem 0.875rem',
                borderRadius: 12,
                background: 'var(--color-surface-container-low)',
                color: 'var(--color-on-surface-variant)',
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
                background: 'var(--color-primary)',
                color: 'var(--color-on-primary)',
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
          <p className="japanese-text" style={{ fontSize: '0.75rem', color: 'var(--color-warning)' }}>
            Market Lens の履歴 API が停止中のため、広告データのみで回答します。
          </p>
        )}
        {contextMode === 'ads-with-ml' && mlStatus === 'cold_start' && (
          <p className="japanese-text" style={{ fontSize: '0.75rem', color: 'var(--color-info)' }}>
            Market Lens バックエンドが起動中です。1〜2分後にコンテキスト更新を試してください。広告データのみで回答します。
          </p>
        )}
        {contextMode === 'ads-with-ml' && mlStatus === 'error' && (
          <p className="japanese-text" style={{ fontSize: '0.75rem', color: 'var(--color-error)' }}>
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
                <InsightTurnCard key={idx} turn={turn} size={fontSize} chartGroups={chartGroups} />
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
