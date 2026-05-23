import MarkdownRenderer from '../../MarkdownRenderer'
import UserPromptPill from './UserPromptPill'
import InsightHtmlReport from './InsightHtmlReport'
import InsightSummaryHero from './InsightSummaryHero'
import { extractInsightMeta, extractInsightReport, extractOperationalInsightCards } from '../../../utils/adsResponse'
import { buildChartEvidencePack } from '../../../utils/adsReports'
import styles from './AiExplorerV2.module.css'
import cardStyles from './InsightTurnCard.module.css'

/**
 * InsightTurnCard — a single user prompt + AI response rendered as one
 * full-width card. Replaces the v1 chat-bubble pair. Phase 3 derives
 * `insight-meta` from `turn.aiContent` (if
 * not passed explicitly) and renders the InsightSummaryHero at the top of
 * the card. The insight-meta fenced block is stripped from the markdown so
 * users don't see it. Fully backwards-compatible: if no meta is present,
 * the hero is hidden and the original content is rendered as before.
 */
const ACTION_LABELS = ['P0', 'P1', 'P2']
const FORBIDDEN_AD_METRIC_PATTERN = /(CVR|CPA|CTR|CPC|ROAS|広告費|インプレッション)/i
const UNKNOWN_OR_LIMITATION_PATTERN = /(未取得|不明|含まれない|断定しない|存在しない|追加データ|必要|要確認)/i

function cleanText(value) {
  return String(value || '').replace(/\*\*/g, '').replace(/^[\s\-・]+/, '').trim()
}

function collectMarkdownBullets(markdown, keywords, limit = 4) {
  const lines = String(markdown || '').split('\n')
  const collected = []
  let capture = false

  for (const rawLine of lines) {
    const line = cleanText(rawLine)
    if (/^#{1,4}\s*/.test(rawLine) || /[:：]$/.test(line)) {
      capture = keywords.some((keyword) => line.includes(keyword))
      continue
    }
    if (capture && /^[-*・]\s+/.test(rawLine.trim())) {
      collected.push(cleanText(line))
    }
    if (collected.length >= limit) break
  }

  return collected
}

function extractActionRows(markdown, operationalCards) {
  const source = String(markdown || '')
  const candidates = [
    ...collectMarkdownBullets(source, ['施策', 'アクション', '改善', '今週'], 3),
    ...operationalCards.filter((card) => card.key === 'action').map((card) => card.body),
  ]
  const unique = [...new Set(candidates.map((item) => cleanText(item)).filter(Boolean))]
  const fallback = [
    '最重要KPIの取得条件を確認し、効果検証できる状態にする',
    '悪化した導線を優先して、LPまたは広告訴求を修正する',
    'チャネル別の差分を見て、伸ばす配信と止める配信を分ける',
  ]

  return ACTION_LABELS.map((label, index) => ({
    label,
    task: unique[index] || fallback[index],
    evidence: collectMarkdownBullets(source, ['根拠', '観測', '指標'], 3)[index] || '回答本文の根拠セクションを参照',
    owner: index === 0 ? '運用担当' : index === 1 ? 'クリエイティブ担当' : '分析担当',
    due: index === 0 ? '今すぐ' : index === 1 ? '今週中' : '次回確認',
  }))
}

function extractMetricRows(markdown) {
  const source = String(markdown || '')
  const metricPattern = /(PV|セッション|直帰率|CVR|CPA|CTR|CPC|ROAS|CV|売上|広告費)[^。\n|]{0,50}/gi
  const rows = [...new Set(source.match(metricPattern) || [])]
    .filter((row) => !(FORBIDDEN_AD_METRIC_PATTERN.test(row) && UNKNOWN_OR_LIMITATION_PATTERN.test(row)))
    .slice(0, 4)

  if (rows.length === 0) {
    return []
  }

  return rows.map((row) => {
    const metric = row.match(/PV|セッション|直帰率|CVR|CPA|CTR|CPC|ROAS|CV|売上|広告費/i)?.[0] || '指標'
    const delta = row.match(/[+-]?\d+(?:\.\d+)?\s*(?:%|pt|円|件)?/)?.[0] || '変化あり'
    return [metric, delta, cleanText(row)]
  })
}

function extractMissingItems(markdown) {
  const matches = String(markdown || '').match(/(?:未取得|不足|未計測|要確認)[^。\n、,]{0,28}(?:データ|CVR|CPA|ROAS|CV|チャネル|キャンペーン|広告費|指標)/g)
  return [...new Set(matches || [])].slice(0, 5)
}

function normalizeAgentTrace(trace) {
  return Array.isArray(trace)
    ? trace.filter((item) => item && typeof item === 'object')
    : []
}

function normalizeNumberToken(value) {
  const raw = String(value ?? '').replace(/,/g, '').trim()
  if (!raw) return ''
  const number = Number(raw)
  if (!Number.isFinite(number)) return ''
  return Number.isInteger(number) ? String(number) : String(number)
}

function extractPromptNumbers(prompt) {
  const values = new Set()
  for (const match of String(prompt || '').matchAll(/\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?/g)) {
    const token = normalizeNumberToken(match[0])
    if (!token) continue
    const numeric = Number(token)
    if (Number.isInteger(numeric) && numeric >= 1900 && numeric <= 2099) continue
    values.add(token)
  }
  return values
}

function buildDateTokens(prompt) {
  const source = String(prompt || '')
  const tokens = new Set()
  const add = (month, day) => {
    const m = Number(month)
    const d = Number(day)
    if (!m || !d) return
    tokens.add(`${m}/${d}`)
    tokens.add(`${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`)
  }
  for (const match of source.matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日/g)) add(match[2], match[3])
  for (const match of source.matchAll(/(?:^|[^\d])(\d{1,2})\/(\d{1,2})(?:[^\d]|$)/g)) add(match[1], match[2])
  return tokens
}

function pointMatchesPromptDate(point, dateTokens) {
  if (dateTokens.size === 0) return true
  const labels = [point?.label, point?.rawLabel, ...(Array.isArray(point?.aliases) ? point.aliases : [])]
    .map((value) => String(value || ''))
  return labels.some((label) => dateTokens.has(label))
}

function recoverEvidenceRowsFromCharts(userPrompt, chartGroups) {
  const promptNumbers = extractPromptNumbers(userPrompt)
  if (promptNumbers.size === 0 || !Array.isArray(chartGroups) || chartGroups.length === 0) return []

  const dateTokens = buildDateTokens(userPrompt)
  const pack = buildChartEvidencePack(chartGroups, { scopeLabel: 'AI考察 復旧表示', maxCharts: 36 })
  const rows = []

  for (const chart of pack?.charts || []) {
    for (const series of chart.series || []) {
      for (const point of series.points || []) {
        const value = normalizeNumberToken(point.value)
        if (!promptNumbers.has(value) || !pointMatchesPromptDate(point, dateTokens)) continue
        rows.push({
          claim: `${chart.title} の ${series.label} は ${point.label} に ${value} です`,
          metric: series.label,
          value,
          period: point.label,
          source: chart.chart_id,
          confidence: 'recovered',
        })
      }
    }
  }

  const seen = new Set()
  return rows.filter((row) => {
    const key = [row.source, row.metric, row.value, row.period].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 8)
}

function buildSafeRecoveredReport({ userPrompt, aiContent, agentTrace, chartGroups }) {
  const evidenceRows = recoverEvidenceRowsFromCharts(userPrompt, chartGroups)
  if (evidenceRows.length === 0) return null
  const metrics = evidenceRows.map((row) => `${row.metric} ${row.value}`).join('、')
  const unsupportedKpis = ['広告費', 'CPA', 'ROAS', 'CTR', 'CPC', 'インプレッション']
    .filter((kpi) => String(userPrompt || aiContent || '').includes(kpi))

  return {
    version: 'insight_report_v2',
    executive_summary: [
      `${evidenceRows[0].period || '該当日'} は ${evidenceRows[0].source} で ${metrics} が確認できます。内部レポート本文の整形に失敗したため、画面上のグラフ根拠から安全に復旧表示しています。`,
    ],
    evidence_table: evidenceRows,
    interpretation: [
      'PV、セッション、ユーザーが同じ日に揃って上がっている場合、まず流入量そのものの増加として読みます。',
      '原因の断定には source / medium、LP、検索クエリ、イベント・広告配信変更の同日確認が必要です。',
    ],
    hypotheses: [
      {
        hypothesis: '特定チャネルまたは特定LPへの流入増が、同日のPV・セッション・ユーザー増に寄与した可能性があります。',
        evidence: evidenceRows.map((row) => row.source).filter(Boolean).join(' / '),
        missing_data: 'source / medium別、LP別、検索クエリ別、広告媒体別の同日内訳',
      },
    ],
    actions: [
      { priority: 'P0', action: '同日の流入元別セッションを確認', rationale: '3指標が同日に増えているため', expected_metric: 'source / medium別セッション' },
      { priority: 'P1', action: '伸びたLPと検索クエリを照合', rationale: 'PV増が特定ページ起点かを分けるため', expected_metric: 'LP別セッション / 検索クエリ' },
      { priority: 'P2', action: '媒体データと配信変更履歴を突合', rationale: 'GA4だけでは広告費・CPA・ROASを断定できないため', expected_metric: '広告費 / CPA / ROAS / CTR' },
    ],
    limitations: [
      '内部AIレポートのJSON整形に失敗したため、表示可能なグラフ根拠に限定して復旧しています。',
      unsupportedKpis.length > 0
        ? `${unsupportedKpis.join(' / ')} は入力に存在しない限り判断保留です。`
        : '広告費 / CPA / ROAS / CTR / CPC / インプレッションは入力に存在しない限り判断保留です。',
    ],
    review_status: {
      verdict: 'recovered',
      notes: ['chartGroupsから数値復旧', '内部JSON非表示', '追加生成なし'],
      blocking_issues: [],
      checked_items: ['chart_id', 'metric', 'value', 'period'],
      unsupported_kpis: unsupportedKpis,
    },
    agent_trace: agentTrace,
    _strippedMarkdown: '',
  }
}

function hasInsightReportArtifact(content) {
  const source = String(content || '')
  return /\\?"version\\?"\s*:\s*\\?"insight_report_v2\\?"/.test(source) ||
    /\\?"agent_trace\\?"\s*:/.test(source) ||
    /```insight-report\s*\n/i.test(source)
}

function AgentTracePanel({ trace = [] }) {
  const items = normalizeAgentTrace(trace)
  if (items.length === 0) return null
  const completedCount = items.filter((item) => ['completed', 'repaired'].includes(item.status)).length
  const usesLlm = items.some((item) => item.mode === 'llm_stage')

  return (
    <details className={cardStyles.agentTracePanel} data-testid="agent-trace-panel">
      <summary className="japanese-text">
        <span className="material-symbols-outlined" aria-hidden="true">account_tree</span>
        <span>
          <strong>複数ステージAIレビュー</strong>
          <em>{items.length}つの役割で順番に検査 / {completedCount}件完了 / {usesLlm ? 'LLM stage含む' : 'deterministic fallback'}</em>
        </span>
      </summary>
      <div className={cardStyles.agentTraceList}>
        {items.map((item, index) => (
          <article key={`${item.stage}-${index}`} className={cardStyles.agentTraceItem}>
            <div className={cardStyles.agentTraceHead}>
              <b>{index + 1}</b>
              <div>
                <strong>{item.label || item.stage}</strong>
                <span>{item.summary || item.excerpt || '検査完了'}</span>
              </div>
              <mark data-mode={item.mode || 'unknown'}>{item.mode || 'unknown'}</mark>
            </div>
            {item.checks?.length > 0 && (
              <p className="japanese-text">確認: {item.checks.slice(0, 4).join(' / ')}</p>
            )}
            {item.issues?.length > 0 && (
              <p className={cardStyles.agentTraceIssue}>要確認: {item.issues.slice(0, 3).join(' / ')}</p>
            )}
          </article>
        ))}
      </div>
    </details>
  )
}

function EvidenceStatusBand({ report }) {
  const status = report?.review_status
  if (!status) return null
  const verdict = String(status.verdict || 'checked').toLowerCase()
  const isPass = verdict === 'pass'
  const evidenceRows = Array.isArray(report?.evidence_table) ? report.evidence_table : []
  const first = evidenceRows[0] || {}
  const unsupported = Array.isArray(status.unsupported_kpis) ? status.unsupported_kpis : []

  return (
    <section
      className={`${cardStyles.evidenceStatusBand} ${isPass ? cardStyles.evidenceStatusPass : cardStyles.evidenceStatusWarn}`}
      data-testid="evidence-status-band"
      aria-label="数値照合状態"
    >
      <span className="material-symbols-outlined" aria-hidden="true">{isPass ? 'verified' : 'warning'}</span>
      <div>
        <strong className="japanese-text">{isPass ? '数値照合済み' : '数値照合は要確認'}</strong>
        <p className="japanese-text">
          {[
            first.source ? `chart_id: ${first.source}` : '',
            first.claim ? `参照: ${first.claim}` : '',
            first.metric ? `指標: ${first.metric}` : '',
            first.value ? `値: ${first.value}` : '',
            first.period ? `期間: ${first.period}` : '',
            `Review: ${status.verdict || 'checked'}`,
            unsupported.length > 0 ? `未取得KPI: ${unsupported.join(' / ')}` : '',
          ].filter(Boolean).join(' / ')}
        </p>
      </div>
    </section>
  )
}

function InsightReportSections({ content, operationalCards }) {
  const metricRows = extractMetricRows(content)
  const observations = collectMarkdownBullets(content, ['観測', '事実', '現状', '指標'], 4)
  const inferences = collectMarkdownBullets(content, ['推論', '原因', '解釈', '仮説'], 4)
  const missingItems = extractMissingItems(content)
  const actionRows = extractActionRows(content, operationalCards)

  return (
    <div className={cardStyles.reportFlow} data-testid="insight-report-flow">
      <section className={cardStyles.metricSection} aria-label="根拠指標テーブル">
        <div className={cardStyles.sectionHeader}>
          <span className="material-symbols-outlined" aria-hidden="true">table_chart</span>
          <h3 className="japanese-text">根拠指標テーブル</h3>
        </div>
        <div className={cardStyles.metricTable}>
          <div className={cardStyles.tableHead}>指標</div>
          <div className={cardStyles.tableHead}>変化</div>
          <div className={cardStyles.tableHead}>読み取り</div>
          {metricRows.length > 0 ? metricRows.map(([metric, delta, note]) => (
            <div key={`${metric}-${note}`} className={cardStyles.tableRow}>
              <strong>{metric}</strong>
              <span>{delta}</span>
              <p className="japanese-text">{note}</p>
            </div>
          )) : (
            <div className={cardStyles.emptyTableNote}>
              <p className="japanese-text">回答本文から根拠指標を自動抽出できませんでした。下の本文で明示された数値だけを確認してください。</p>
            </div>
          )}
        </div>
      </section>

      <div className={cardStyles.splitGrid}>
        <section className={cardStyles.factPanel} aria-label="観測事実">
          <div className={cardStyles.sectionHeader}>
            <span className="material-symbols-outlined" aria-hidden="true">fact_check</span>
            <h3 className="japanese-text">観測事実</h3>
          </div>
          {(observations.length > 0 ? observations : ['本文内の数値変化と比較期間を確認']).map((item) => (
            <p key={item} className="japanese-text">{item}</p>
          ))}
        </section>
        <section className={cardStyles.inferencePanel} aria-label="AI推論">
          <div className={cardStyles.sectionHeader}>
            <span className="material-symbols-outlined" aria-hidden="true">psychology_alt</span>
            <h3 className="japanese-text">AI推論</h3>
          </div>
          {(inferences.length > 0 ? inferences : ['原因は仮説として扱い、未取得データで追加検証']).map((item) => (
            <p key={item} className="japanese-text">{item}</p>
          ))}
        </section>
      </div>

      <section className={cardStyles.missingBand} aria-label="未取得データ">
        <div className={cardStyles.sectionHeader}>
          <span className="material-symbols-outlined" aria-hidden="true">error</span>
          <h3 className="japanese-text">未取得データ</h3>
        </div>
        <div className={cardStyles.missingList}>
          {(missingItems.length > 0 ? missingItems : ['回答内で未取得/不明と明記された項目を確認']).map((item) => (
            <span key={item} className="japanese-text">{item}</span>
          ))}
        </div>
      </section>

      <section className={cardStyles.actionTableSection} aria-label="3施策の実行表">
        <div className={cardStyles.sectionHeader}>
          <span className="material-symbols-outlined" aria-hidden="true">task_alt</span>
          <h3 className="japanese-text">3施策の実行表</h3>
        </div>
        <div className={cardStyles.actionTable}>
          {actionRows.map((row) => (
            <div key={row.label} className={cardStyles.actionRow}>
              <b>{row.label}</b>
              <div>
                <strong className="japanese-text">{row.task}</strong>
                <p className="japanese-text">{row.evidence}</p>
              </div>
              <span className="japanese-text">{row.owner}</span>
              <em className="japanese-text">{row.due}</em>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function StructuredInsightReport({ report }) {
  if (!report) return null

  return (
    <div className={cardStyles.markdownReport} data-testid="insight-report-v2">
      <h2 className="japanese-text">AI考察レポート</h2>
      <EvidenceStatusBand report={report} />

      {report.executive_summary.length > 0 && (
        <section className={cardStyles.markdownReportSection} aria-label="重要結論">
          <h3 className="japanese-text">重要結論</h3>
          {report.executive_summary.slice(0, 3).map((item, index) => (
            <p key={`${item}-${index}`} className="japanese-text">{item}</p>
          ))}
        </section>
      )}

      {report.evidence_table.length > 0 && (
        <section className={cardStyles.markdownReportSection} aria-label="根拠テーブル">
          <h3 className="japanese-text">根拠テーブル</h3>
          <div className={cardStyles.simpleTableWrap}>
            <table className={cardStyles.simpleEvidenceTable}>
              <thead>
                <tr>
                  <th>chart_id</th>
                  <th>グラフ/主張</th>
                  <th>指標</th>
                  <th>値</th>
                  <th>期間</th>
                </tr>
              </thead>
              <tbody>
                {report.evidence_table.slice(0, 6).map((row, index) => (
                  <tr key={`${row.source}-${row.metric}-${row.value}-${index}`}>
                    <td translate="no">{row.source || '-'}</td>
                    <td className="japanese-text">{row.claim || '-'}</td>
                    <td>{row.metric || '-'}</td>
                    <td><strong>{row.value || '-'}</strong></td>
                    <td>{row.period || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {report.interpretation.length > 0 && (
        <section className={cardStyles.markdownReportSection} aria-label="読み解き">
          <h3 className="japanese-text">読み解き</h3>
          {report.interpretation.slice(0, 4).map((item, index) => (
            <p key={`${item}-${index}`} className="japanese-text">{item}</p>
          ))}
        </section>
      )}

      {report.hypotheses.length > 0 && (
        <section className={cardStyles.markdownReportSection} aria-label="仮説と不足データ">
          <h3 className="japanese-text">仮説と不足データ</h3>
          {report.hypotheses.slice(0, 3).map((item, index) => (
            <p key={`${item.hypothesis}-${index}`} className="japanese-text">
              <strong>仮説:</strong> {item.hypothesis || '未記載'}
              {item.missing_data ? ` / 確認するデータ: ${item.missing_data}` : ''}
            </p>
          ))}
        </section>
      )}

      {report.actions.length > 0 && (
        <section className={cardStyles.markdownReportSection} aria-label="次に見ること">
          <h3 className="japanese-text">次に見ること</h3>
          <ol className={cardStyles.simpleActionList}>
            {report.actions.slice(0, 3).map((row, index) => (
              <li key={`${row.priority}-${row.action}-${index}`} className="japanese-text">
                <strong>{row.priority || `P${index}`}: {row.action || '確認項目'}</strong>
                {row.rationale && <span>{row.rationale}</span>}
                {row.expected_metric && <em>見る指標: {row.expected_metric}</em>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {report.limitations.length > 0 && (
        <section className={cardStyles.markdownReportSection} aria-label="制約">
          <h3 className="japanese-text">制約・判断保留</h3>
          {report.limitations.slice(0, 4).map((item, index) => (
            <p key={`${item}-${index}`} className="japanese-text">{item}</p>
          ))}
        </section>
      )}

      {report.review_status && (
        <section className={cardStyles.simpleReview} aria-label="レビュー状態">
          <strong className="japanese-text">Review: {report.review_status.verdict || 'checked'}</strong>
          {report.review_status.notes?.length > 0 && (
            <span className="japanese-text">{report.review_status.notes.join(' / ')}</span>
          )}
          {report.review_status.blocking_issues?.length > 0 && (
            <span className="japanese-text">要確認: {report.review_status.blocking_issues.join(' / ')}</span>
          )}
        </section>
      )}

      <AgentTracePanel trace={report.agent_trace} />
    </div>
  )
}

function isStructuredReportV2(report) {
  return Array.isArray(report?.executive_summary) || Array.isArray(report?.evidence_table)
}

export default function InsightTurnCard({
  turn = {},
  size = 'normal',
  insightMeta,
  chartGroups = [],
}) {
  const { userPrompt = '', userTimestamp, aiContent = '', aiTimestamp, isError } = turn

  const derivedReport = extractInsightReport(aiContent)
  const derivedMeta = insightMeta ?? extractInsightMeta(aiContent)
  const agentTrace = normalizeAgentTrace(turn.agentTrace ?? derivedReport?.agent_trace ?? derivedMeta?.agent_trace)
  if (derivedReport && agentTrace.length > 0 && (!derivedReport.agent_trace || derivedReport.agent_trace.length === 0)) {
    derivedReport.agent_trace = agentTrace
  }
  const renderContent = derivedReport?._strippedMarkdown ?? derivedMeta?._strippedMarkdown ?? aiContent
  const shouldHideRawArtifact = !derivedReport && hasInsightReportArtifact(renderContent)
  const recoveredReport = shouldHideRawArtifact
    ? buildSafeRecoveredReport({ userPrompt, aiContent, agentTrace, chartGroups })
    : null
  const displayReport = derivedReport ?? recoveredReport
  const hasStructuredV2Report = isStructuredReportV2(displayReport)
  const fallbackContent = shouldHideRawArtifact ? '' : renderContent

  const operationalCards = shouldHideRawArtifact ? [] : extractOperationalInsightCards(renderContent)

  return (
    <article
      className={`${styles.turnCard} ${isError ? styles.turnCardError : ''} md-v2-enter`}
      data-testid="insight-turn-card"
    >
      <header className={styles.turnHeader}>
        <div className={styles.aiAvatar} aria-hidden="true">
          <span className="material-symbols-outlined">auto_awesome</span>
        </div>
        <div className={styles.turnHeaderMeta}>
          <p className={styles.aiLabel}>AI 考察エンジン</p>
          {aiTimestamp && (
            <span className={styles.timestamp} aria-label={`応答日時 ${aiTimestamp}`}>
              {aiTimestamp}
            </span>
          )}
        </div>
      </header>

      <UserPromptPill content={userPrompt} timestamp={userTimestamp} />

      {displayReport ? (
        hasStructuredV2Report ? (
          <StructuredInsightReport report={displayReport} />
        ) : (
          <InsightHtmlReport report={displayReport} />
        )
      ) : derivedMeta ? (
        <InsightSummaryHero meta={derivedMeta} />
      ) : null}

      {!displayReport && operationalCards.length > 0 && (
        <div className={styles.operationalCards} data-testid="operational-insight-cards">
          {operationalCards.map((card) => (
            <section key={card.key} className={styles.operationalCard}>
              <span className="material-symbols-outlined" aria-hidden="true">
                {card.key === 'cause' ? 'manage_search' :
                  card.key === 'implication' ? 'tips_and_updates' :
                  card.key === 'metric' ? 'monitoring' :
                  card.key === 'expectedKpi' ? 'speed' : 'task_alt'}
              </span>
              <div>
                <h3 className="japanese-text">{card.title}</h3>
                <p className="japanese-text">{card.body}</p>
              </div>
            </section>
          ))}
        </div>
      )}

      {!displayReport && !isError && fallbackContent && (
        <InsightReportSections
          content={fallbackContent}
          operationalCards={operationalCards}
        />
      )}

      {displayReport ? (
        derivedReport && renderContent && (
          <details className={cardStyles.markdownDetails}>
            <summary className="japanese-text">
              <span className="material-symbols-outlined" aria-hidden="true">article</span>
              詳細なAI回答を開く
            </summary>
            <div className={styles.turnBody}>
              <MarkdownRenderer content={renderContent} variant="ai-insight" size={size} />
            </div>
          </details>
        )
      ) : (
        <div className={styles.turnBody}>
          <div className={cardStyles.longFormHeader}>
            <span className="material-symbols-outlined" aria-hidden="true">article</span>
            <h3 className="japanese-text">AIによる考察回答</h3>
          </div>
          {fallbackContent ? (
            <MarkdownRenderer content={fallbackContent} variant="ai-insight" size={size} />
          ) : (
            <p className="japanese-text text-sm text-on-surface-variant" data-testid="insight-report-artifact-hidden">
              内部確認データは非表示にしました。次回生成時は根拠テーブルとして整形表示されます。
            </p>
          )}
        </div>
      )}
    </article>
  )
}
