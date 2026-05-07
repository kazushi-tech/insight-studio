import { useEffect, useMemo, useRef } from 'react'
import { LoadingSpinner, ErrorBanner } from '../../ui'
import InsightTurnCard from './InsightTurnCard'
import LoadingSkeleton from './LoadingSkeleton'
import QuickPromptCard from './QuickPromptCard'
import styles from './AiExplorerV2.module.css'
import timelineStyles from './InsightTimeline.module.css'

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

const QUERY_LABELS = {
  lp: 'LP/ページ',
  conversions: 'CVイベント',
  acquisition: '流入チャネル',
  landing_page: 'ランディングページ',
  device: 'デバイス',
  creative: 'クリエイティブ',
  raw_events: '生データ',
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

function firstLineAfter(markdown, labels) {
  const source = String(markdown || '')
  for (const label of labels) {
    const match = source.match(new RegExp(`${label}\\s*[:：]\\s*([^\\n]+)`, 'i'))
    if (match?.[1]) return match[1]
  }
  return ''
}

function extractMetricFromMarkdown(markdown) {
  const match = String(markdown || '').match(/(CVR|CPA|CTR|CPC|ROAS|CV|売上|セッション)[^。\n]{0,28}(?:悪化|改善|上昇|低下|増加|減少|削減)?/i)
  return match?.[0] || ''
}

function extractMissingData(markdown) {
  const source = String(markdown || '')
  const matches = source.match(/(?:未取得|不足|要確認|未計測)[^。\n、,]{0,24}(?:データ|CVR|CPA|ROAS|CV|チャネル|キャンペーン|広告費|コンバージョン|指標)/g)
  return [...new Set(matches || [])].slice(0, 4)
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
    actions[0]?.title || firstLineAfter(latest, ['最優先', '今週やる施策', '次アクション', '改善タスク']),
    latest ? '回答内の最優先タスクを確認' : '分析データを生成して最優先施策を確認',
  )
  const missingData = extractMissingData(sourceMd)

  return {
    summary: compactText(
      reportBundle?.decision_summary?.summary || firstLineAfter(latest, ['結論', '考察サマリー', '要約']),
      latest ? '回答本文から主要な判断を先に確認できます' : '質問後に、結論・施策・根拠・不足データをここへ整理します',
    ),
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
    missingData: missingData.length > 0 ? missingData : ['CVデータ', 'チャネル別CVR', 'CPA / ROAS', 'コンバージョン内訳'],
    actions: [
      topAction,
      ...actions.slice(1, 3).map((item) => compactText(item.title || item.action, '次タスク')),
    ].slice(0, 3),
  }
}

function formatSetupQueries(setupState) {
  const queryTypes = Array.isArray(setupState?.queryTypes) ? setupState.queryTypes : []
  if (queryTypes.length === 0) return '未選択'
  return queryTypes.map((key) => QUERY_LABELS[key] ?? key).join(' / ')
}

function formatSetupPeriods(setupState) {
  const periods = Array.isArray(setupState?.periods) ? setupState.periods : []
  if (periods.length === 0) return '未選択'
  if (periods.length === 1) return periods[0]
  return `${periods[0]} 〜 ${periods[periods.length - 1]}`
}

function InsightDecisionBoard({ reportBundle, messages }) {
  const state = buildDecisionBoardState({ reportBundle, messages })
  return (
    <section className={timelineStyles.decisionBoard} data-testid="insight-decision-board" aria-labelledby="insight-decision-board-title">
      <div className={timelineStyles.summaryPanel}>
        <p className={timelineStyles.eyebrow}>考察サマリー</p>
        <h2 id="insight-decision-board-title" className={`${timelineStyles.decisionTitle} japanese-text`}>
          {state.topAction}
        </h2>
        <p className={`${timelineStyles.summaryText} japanese-text`}>{state.summary}</p>
      </div>

      <div className={timelineStyles.actionPanel} aria-label="今週やる3施策">
        <p className={timelineStyles.eyebrow}>今週やる3施策</p>
        <div className={timelineStyles.actionList}>
          {state.actions.map((action, idx) => (
            <div key={`${action}-${idx}`} className={timelineStyles.actionItem}>
              <b>{`P${idx}`}</b>
              <p className="japanese-text">{action}</p>
            </div>
          ))}
        </div>
      </div>

      <div className={timelineStyles.evidencePanel} aria-label="根拠指標">
        <p className={timelineStyles.eyebrow}>根拠指標</p>
        <div className={timelineStyles.metricGrid}>
          {[
            ['最重要変化指標', state.topMetric],
            ['推定原因', state.cause],
            ['期待KPI', state.expectedKpi],
            ['データ期間', state.period],
            ['信頼度', state.confidence],
          ].map(([label, value]) => (
            <div key={label} className={timelineStyles.metricItem}>
              <span>{label}</span>
              <strong className="japanese-text">{value}</strong>
            </div>
          ))}
        </div>
      </div>

      <aside className={timelineStyles.missingPanel} aria-label="未取得データ">
        <p className={timelineStyles.eyebrow}>未取得データ</p>
        <div className={timelineStyles.missingChips}>
          {state.missingData.map((item) => (
            <span key={item} className={`${timelineStyles.missingChip} japanese-text`}>{item}</span>
          ))}
        </div>
      </aside>
    </section>
  )
}

function AdsAiSetupGuide({ setupState, isAdsAuthenticated, reportBundle, onOpenSetup, onOpenGraphs }) {
  const setupComplete = Boolean(
    isAdsAuthenticated &&
    setupState?.datasetId &&
    Array.isArray(setupState?.periods) &&
    setupState.periods.length > 0,
  )
  const items = [
    ['接続', isAdsAuthenticated ? 'ログイン済み' : '未ログイン'],
    ['クエリ', formatSetupQueries(setupState)],
    ['期間', formatSetupPeriods(setupState)],
    ['AIコンテキスト', reportBundle?.reportMd ? '生成済み' : setupComplete ? '更新待ち' : '未生成'],
  ]

  return (
    <section className={styles.setupGuidePanel} data-testid="ads-ai-setup-guide" aria-label="AI考察セットアップ導線">
      <div className={styles.setupGuideMain}>
        <span className="material-symbols-outlined" aria-hidden="true">tune</span>
        <div>
          <p className={`${styles.setupGuideEyebrow} japanese-text`}>最初にここからセットアップ</p>
          <h2 className={`${styles.setupGuideTitle} japanese-text`}>クエリと期間を選ぶと、AI考察の根拠が更新されます</h2>
          <p className={`${styles.setupGuideBody} japanese-text`}>
            広告グラフのセットアップで「欲しいクエリ」と「分析期間」を選択し、生成されたグラフ要約をこの画面のAI回答へ渡します。
          </p>
        </div>
      </div>

      <div className={styles.setupGuideMeta} aria-label="現在のセットアップ状態">
        {items.map(([label, value]) => (
          <div key={label} className={styles.setupGuideChip}>
            <span className="japanese-text">{label}</span>
            <strong className="japanese-text">{value}</strong>
          </div>
        ))}
      </div>

      <div className={styles.setupGuideActions}>
        <button type="button" className={styles.setupGuidePrimary} onClick={onOpenSetup}>
          <span className="material-symbols-outlined" aria-hidden="true">settings_suggest</span>
          {setupState ? 'セットアップで選び直す' : 'セットアップを開始'}
        </button>
        <button type="button" className={styles.setupGuideSecondary} onClick={onOpenGraphs}>
          <span className="material-symbols-outlined" aria-hidden="true">stacked_line_chart</span>
          広告グラフで確認
        </button>
      </div>
    </section>
  )
}

function SetupRequirementPanel({ setupState, isAdsAuthenticated, reportBundle, onOpenSetup }) {
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
      label: 'クエリ・期間',
      ok: Array.isArray(setupState?.periods) && setupState.periods.length > 0,
      action: setupState?.periods?.length ? `${formatSetupQueries(setupState)} / ${setupState.periods.length}期間` : 'セットアップでクエリと期間を選択',
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
      <div className={styles.requirementGrid}>
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
      </div>
      <button type="button" className={styles.requirementAction} onClick={onOpenSetup}>
        <span className="material-symbols-outlined" aria-hidden="true">settings_suggest</span>
        セットアップウィザードを開く
      </button>
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
  onOpenSetup,
  onOpenGraphs,
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
          onOpenSetup={onOpenSetup}
        />
      </div>

      <AdsAiSetupGuide
        setupState={setupState}
        isAdsAuthenticated={isAdsAuthenticated}
        reportBundle={reportBundle}
        onOpenSetup={onOpenSetup}
        onOpenGraphs={onOpenGraphs}
      />

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
