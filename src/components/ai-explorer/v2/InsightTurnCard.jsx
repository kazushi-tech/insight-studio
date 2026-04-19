import MarkdownRenderer from '../../MarkdownRenderer'
import UserPromptPill from './UserPromptPill'
import styles from './AiExplorerV2.module.css'

/**
 * InsightTurnCard — a single user prompt + AI response rendered as one
 * full-width card. Replaces the v1 chat-bubble pair. Phase 1 leaves
 * `chartGroups` and `insightMeta` as accepted-but-ignored props so Phase 2/3
 * integration sites don't have to change their call shape.
 */
export default function InsightTurnCard({
  turn = {},
  size = 'normal',
  // eslint-disable-next-line no-unused-vars
  chartGroups,
  // eslint-disable-next-line no-unused-vars
  insightMeta,
}) {
  const { userPrompt = '', userTimestamp, aiContent = '', aiTimestamp, isError } = turn

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
      </div>
    </article>
  )
}
