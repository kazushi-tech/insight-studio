import MarkdownRenderer from '../../MarkdownRenderer'
import UserPromptPill from './UserPromptPill'
import InsightChartPanel from './InsightChartPanel'
import InsightHtmlReport from './InsightHtmlReport'
import InsightSummaryHero from './InsightSummaryHero'
import { matchRelevantCharts } from '../../../utils/adsReports'
import { extractInsightMeta, extractInsightReport, extractOperationalInsightCards } from '../../../utils/adsResponse'
import styles from './AiExplorerV2.module.css'
import cardStyles from './InsightTurnCard.module.css'

/**
 * InsightTurnCard — a single user prompt + AI response rendered as one
 * full-width card. Replaces the v1 chat-bubble pair. Phase 2 wires up the
 * `chartGroups` prop to surface related charts under the AI markdown via
 * InsightChartPanel. Phase 3 derives `insight-meta` from `turn.aiContent` (if
 * not passed explicitly) and renders the InsightSummaryHero at the top of
 * the card. The insight-meta fenced block is stripped from the markdown so
 * users don't see it. Fully backwards-compatible: if no meta is present,
 * the hero is hidden and the original content is rendered as before.
 */
const ACTION_LABELS = ['P0', 'P1', 'P2']

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
  const rows = [...new Set(source.match(metricPattern) || [])].slice(0, 4)

  if (rows.length === 0) {
    return [
      ['CV / CVR', '本文参照', 'コンバージョン定義と取得状況を確認'],
      ['CPA / ROAS', '本文参照', '広告費と売上の紐づき確認'],
      ['流入チャネル', '本文参照', 'チャネル別の差分を見る'],
    ]
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

function chartChipKey(group, index) {
  const title = group?.title || group?.label || 'chart'
  const period = group?.periodTag || group?.period || group?.dateRange || group?.range || ''
  const stableId = group?.id || group?.key || group?.metricKey || group?.sourceKey || ''
  return `${title}-${period}-${stableId}-${index}`
}

function InsightReportSections({ content, operationalCards, relevantCharts }) {
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
          {metricRows.map(([metric, delta, note]) => (
            <div key={`${metric}-${note}`} className={cardStyles.tableRow}>
              <strong>{metric}</strong>
              <span>{delta}</span>
              <p className="japanese-text">{note}</p>
            </div>
          ))}
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
          {(missingItems.length > 0 ? missingItems : ['CVデータ', 'チャネル別CVR', '広告費 / CPA']).map((item) => (
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

      {relevantCharts.length > 0 && (
        <section className={cardStyles.chartChipSection} aria-label="関連グラフチップ">
          <span className={cardStyles.chartChipLabel}>関連グラフ</span>
          <div className={cardStyles.chartChips}>
            {relevantCharts.map((group, index) => (
              <span key={chartChipKey(group, index)} className={`${cardStyles.chartChip} japanese-text`}>
                <span className="material-symbols-outlined" aria-hidden="true">monitoring</span>
                {group.title || group.label || 'グラフ'}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

export default function InsightTurnCard({
  turn = {},
  size = 'normal',
  chartGroups,
  insightMeta,
}) {
  const { userPrompt = '', userTimestamp, aiContent = '', aiTimestamp, isError } = turn

  const derivedReport = extractInsightReport(aiContent)
  const derivedMeta = insightMeta ?? extractInsightMeta(aiContent)
  const renderContent = derivedReport?._strippedMarkdown ?? derivedMeta?._strippedMarkdown ?? aiContent

  const relevantCharts = Array.isArray(chartGroups) && chartGroups.length > 0
    ? matchRelevantCharts(renderContent, chartGroups, { limit: 3 })
    : []
  const operationalCards = extractOperationalInsightCards(renderContent)

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

      {derivedReport ? (
        <InsightHtmlReport report={derivedReport} />
      ) : derivedMeta ? (
        <InsightSummaryHero meta={derivedMeta} />
      ) : null}

      {!derivedReport && operationalCards.length > 0 && (
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

      {!derivedReport && !isError && renderContent && (
        <InsightReportSections
          content={renderContent}
          operationalCards={operationalCards}
          relevantCharts={relevantCharts}
        />
      )}

      {derivedReport ? (
        renderContent && (
          <details className={`${styles.turnBody} ${cardStyles.longFormDetails}`}>
            <summary className={cardStyles.longFormSummary}>
              <span className="material-symbols-outlined" aria-hidden="true">article</span>
              <span className="japanese-text">詳細なAI回答を開く</span>
            </summary>
            <MarkdownRenderer content={renderContent} variant="ai-insight" size={size} />
            {relevantCharts.length > 0 && <InsightChartPanel groups={relevantCharts} />}
          </details>
        )
      ) : (
        <div className={styles.turnBody}>
          <div className={cardStyles.longFormHeader}>
            <span className="material-symbols-outlined" aria-hidden="true">article</span>
            <h3 className="japanese-text">AIによる考察回答</h3>
          </div>
          <MarkdownRenderer content={renderContent} variant="ai-insight" size={size} />
          {relevantCharts.length > 0 && <InsightChartPanel groups={relevantCharts} />}
        </div>
      )}
    </article>
  )
}
