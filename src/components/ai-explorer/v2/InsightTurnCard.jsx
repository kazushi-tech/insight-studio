import MarkdownRenderer from '../../MarkdownRenderer'
import UserPromptPill from './UserPromptPill'
import InsightChartPanel from './InsightChartPanel'
import { matchRelevantCharts } from '../../../utils/adsReports'
import styles from './AiExplorerV2.module.css'

/**
 * InsightTurnCard — a single user prompt + AI response rendered as one
 * full-width card. Replaces the v1 chat-bubble pair. Phase 2 wires up the
 * `chartGroups` prop to surface related charts under the AI markdown via
 * InsightChartPanel. `insightMeta` remains accepted-but-ignored for Phase 3.
 */
export default function InsightTurnCard({
  turn = {},
  size = 'normal',
  chartGroups,
  // eslint-disable-next-line no-unused-vars
  insightMeta,
}) {
  const { userPrompt = '', userTimestamp, aiContent = '', aiTimestamp, isError } = turn

  const relevantCharts = Array.isArray(chartGroups) && chartGroups.length > 0
    ? matchRelevantCharts(aiContent, chartGroups, { limit: 3 })
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

      <div className={styles.turnBody}>
        <MarkdownRenderer content={aiContent} variant="ai-insight" size={size} />
        {relevantCharts.length > 0 && <InsightChartPanel groups={relevantCharts} />}
      </div>
    </article>
  )
}
