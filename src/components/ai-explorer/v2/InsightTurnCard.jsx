import MarkdownRenderer from '../../MarkdownRenderer'
import UserPromptPill from './UserPromptPill'
import InsightChartPanel from './InsightChartPanel'
import InsightSummaryHero from './InsightSummaryHero'
import { matchRelevantCharts } from '../../../utils/adsReports'
import { extractInsightMeta } from '../../../utils/adsResponse'
import styles from './AiExplorerV2.module.css'

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
export default function InsightTurnCard({
  turn = {},
  size = 'normal',
  chartGroups,
  insightMeta,
}) {
  const { userPrompt = '', userTimestamp, aiContent = '', aiTimestamp, isError } = turn

  const derivedMeta = insightMeta ?? extractInsightMeta(aiContent)
  const renderContent = derivedMeta?._strippedMarkdown ?? aiContent

  const relevantCharts = Array.isArray(chartGroups) && chartGroups.length > 0
    ? matchRelevantCharts(renderContent, chartGroups, { limit: 3 })
    : []

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

      {derivedMeta && <InsightSummaryHero meta={derivedMeta} />}

      <div className={styles.turnBody}>
        <MarkdownRenderer content={renderContent} variant="ai-insight" size={size} />
        {relevantCharts.length > 0 && <InsightChartPanel groups={relevantCharts} />}
      </div>
    </article>
  )
}
