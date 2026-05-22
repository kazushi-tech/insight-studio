import MarkdownRenderer from '../../MarkdownRenderer'
import UserPromptPill from './UserPromptPill'
import InsightChartPanel from './InsightChartPanel'
import InsightHtmlReport from './InsightHtmlReport'
import InsightSummaryHero from './InsightSummaryHero'
import { getChartEvidenceReference, matchRelevantCharts } from '../../../utils/adsReports'
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

function chartChipKey(group, index) {
  const title = group?.title || group?.label || 'chart'
  const period = group?.periodTag || group?.period || group?.dateRange || group?.range || ''
  const stableId = group?.id || group?.key || group?.metricKey || group?.sourceKey || ''
  return `${title}-${period}-${stableId}-${index}`
}

function toFiniteChartNumber(value) {
  if (value == null || value === '') return null
  const numeric = Number(String(value).replace(/,/g, '').replace(/[%％]$/, '').trim())
  return Number.isFinite(numeric) ? numeric : null
}

function formatChartValue(value) {
  const numeric = toFiniteChartNumber(value)
  if (numeric == null) return String(value ?? '-')
  return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format(numeric)
}

function getChartSnapshot(group) {
  const labels = Array.isArray(group?.labels) ? group.labels : []
  const datasets = Array.isArray(group?.datasets) ? group.datasets : []
  const rows = datasets.slice(0, 3).map((dataset) => {
    const data = Array.isArray(dataset?.data) ? dataset.data : []
    const validPoints = data
      .map((value, index) => ({
        value: toFiniteChartNumber(value),
        rawValue: value,
        label: labels[index] ?? `#${index + 1}`,
      }))
      .filter((point) => point.value != null)
    const latest = validPoints[validPoints.length - 1] ?? null
    const max = validPoints.reduce((best, point) => (!best || point.value > best.value ? point : best), null)
    return {
      label: dataset?.label || 'データ',
      latest,
      max,
      count: validPoints.length,
    }
  }).filter((row) => row.count > 0)

  return {
    labelCount: labels.length,
    seriesCount: datasets.length,
    rows,
  }
}

function ReferencedChartsReport({ groups }) {
  const list = Array.isArray(groups) ? groups : []
  if (list.length === 0) return null

  return (
    <section className={cardStyles.referencedChartsReport} aria-label="参照した広告グラフ" data-testid="referenced-chart-report">
      <div className={cardStyles.sectionHeader}>
        <span className="material-symbols-outlined" aria-hidden="true">monitoring</span>
        <h3 className="japanese-text">参照した広告グラフ</h3>
      </div>
      <div className={cardStyles.referenceCards}>
        {list.map((group, index) => {
          const reference = getChartEvidenceReference(group, index)
          const snapshot = getChartSnapshot(group)
          return (
            <article key={chartChipKey(group, index)} className={cardStyles.referenceCard}>
              <div className={cardStyles.referenceCardHeader}>
                <span translate="no">{reference.chartId}</span>
                <strong className="japanese-text">{group.title || reference.title || 'グラフ'}</strong>
              </div>
              <div className={cardStyles.referenceMeta}>
                <span className="japanese-text">{group.chartType || 'chart'}</span>
                <span className="japanese-text">{reference.periodTag || group._periodTag || '期間未指定'}</span>
                <span className="japanese-text">{snapshot.seriesCount}系列 / {snapshot.labelCount}点</span>
              </div>
              {snapshot.rows.length > 0 && (
                <div className={cardStyles.referenceMiniTable}>
                  <div>系列</div>
                  <div>最新</div>
                  <div>最大</div>
                  {snapshot.rows.map((row) => (
                    <div key={`${reference.chartId}-${row.label}`} className={cardStyles.referenceMiniRow}>
                      <span className="japanese-text">{row.label}</span>
                      <b>{row.latest ? `${row.latest.label}: ${formatChartValue(row.latest.rawValue)}` : '-'}</b>
                      <b>{row.max ? `${row.max.label}: ${formatChartValue(row.max.rawValue)}` : '-'}</b>
                    </div>
                  ))}
                </div>
              )}
            </article>
          )
        })}
      </div>
      <InsightChartPanel
        groups={list}
        defaultExpanded
        title="グラフ本文"
        description="AIが根拠として使ったグラフを同じカード内で確認できます。"
      />
    </section>
  )
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

function StructuredInsightReport({ report, relevantCharts }) {
  if (!report) return null

  return (
    <div className={cardStyles.structuredReport} data-testid="insight-report-v2">
      {report.executive_summary.length > 0 && (
        <section className={cardStyles.summaryPanel} aria-label="重要結論">
          <div className={cardStyles.sectionHeader}>
            <span className="material-symbols-outlined" aria-hidden="true">verified</span>
            <h3 className="japanese-text">重要結論</h3>
          </div>
          <div className={cardStyles.summaryList}>
            {report.executive_summary.map((item, index) => (
              <p key={`${item}-${index}`} className="japanese-text">
                <b>{String(index + 1).padStart(2, '0')}</b>
                <span>{item}</span>
              </p>
            ))}
          </div>
        </section>
      )}

      {report.evidence_table.length > 0 && (
        <section className={cardStyles.metricSection} aria-label="根拠テーブル">
          <div className={cardStyles.sectionHeader}>
            <span className="material-symbols-outlined" aria-hidden="true">dataset</span>
            <h3 className="japanese-text">根拠テーブル</h3>
          </div>
          <div className={cardStyles.evidenceTable}>
            <div className={cardStyles.tableHead}>主張</div>
            <div className={cardStyles.tableHead}>指標</div>
            <div className={cardStyles.tableHead}>値</div>
            <div className={cardStyles.tableHead}>根拠</div>
            {report.evidence_table.map((row, index) => (
              <div key={`${row.claim}-${row.value}-${index}`} className={cardStyles.tableRow}>
                <p className="japanese-text">{row.claim || '-'}</p>
                <strong>{row.metric || '-'}</strong>
                <span>{row.value || '-'}</span>
                <p className="japanese-text">{[row.period, row.source, row.confidence].filter(Boolean).join(' / ') || '-'}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <ReferencedChartsReport groups={relevantCharts} />

      {report.interpretation.length > 0 && (
        <section className={cardStyles.factPanel} aria-label="読み解き">
          <div className={cardStyles.sectionHeader}>
            <span className="material-symbols-outlined" aria-hidden="true">manage_search</span>
            <h3 className="japanese-text">読み解き</h3>
          </div>
          {report.interpretation.map((item, index) => (
            <p key={`${item}-${index}`} className="japanese-text">{item}</p>
          ))}
        </section>
      )}

      {report.hypotheses.length > 0 && (
        <section className={cardStyles.inferencePanel} aria-label="仮説と不足データ">
          <div className={cardStyles.sectionHeader}>
            <span className="material-symbols-outlined" aria-hidden="true">psychology_alt</span>
            <h3 className="japanese-text">仮説と不足データ</h3>
          </div>
          {report.hypotheses.map((item, index) => (
            <p key={`${item.hypothesis}-${index}`} className="japanese-text">
              {[item.hypothesis, item.evidence, item.missing_data].filter(Boolean).join(' / ')}
            </p>
          ))}
        </section>
      )}

      {report.actions.length > 0 && (
        <section className={cardStyles.actionTableSection} aria-label="優先施策">
          <div className={cardStyles.sectionHeader}>
            <span className="material-symbols-outlined" aria-hidden="true">task_alt</span>
            <h3 className="japanese-text">優先施策</h3>
          </div>
          <div className={cardStyles.actionTable}>
            {report.actions.map((row, index) => (
              <div key={`${row.priority}-${row.action}-${index}`} className={cardStyles.actionRow}>
                <b>{row.priority || `P${index}`}</b>
                <div>
                  <strong className="japanese-text">{row.action || '施策未指定'}</strong>
                  <p className="japanese-text">{row.rationale || '根拠は根拠テーブルを参照'}</p>
                </div>
                <span className="japanese-text">検証指標</span>
                <em className="japanese-text">{row.expected_metric || '未取得/不明'}</em>
              </div>
            ))}
          </div>
        </section>
      )}

      {report.limitations.length > 0 && (
        <section className={cardStyles.missingBand} aria-label="制約">
          <div className={cardStyles.sectionHeader}>
            <span className="material-symbols-outlined" aria-hidden="true">error</span>
            <h3 className="japanese-text">制約・判断保留</h3>
          </div>
          <div className={cardStyles.missingList}>
            {report.limitations.map((item, index) => (
              <span key={`${item}-${index}`} className="japanese-text">{item}</span>
            ))}
          </div>
        </section>
      )}

      {report.review_status && (
        <section className={cardStyles.reviewBand} aria-label="レビュー状態">
          <span className="material-symbols-outlined" aria-hidden="true">rule</span>
          <strong className="japanese-text">Review: {report.review_status.verdict || 'checked'}</strong>
          {report.review_status.notes?.length > 0 && (
            <span className="japanese-text">{report.review_status.notes.join(' / ')}</span>
          )}
        </section>
      )}

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

function isStructuredReportV2(report) {
  return Array.isArray(report?.executive_summary) || Array.isArray(report?.evidence_table)
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
  const hasStructuredV2Report = isStructuredReportV2(derivedReport)

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
        hasStructuredV2Report ? (
          <StructuredInsightReport report={derivedReport} relevantCharts={relevantCharts} />
        ) : (
          <InsightHtmlReport report={derivedReport} />
        )
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
          <MarkdownRenderer content={renderContent} variant="ai-insight" size={size} />
          {relevantCharts.length > 0 && <InsightChartPanel groups={relevantCharts} />}
        </div>
      )}
    </article>
  )
}
