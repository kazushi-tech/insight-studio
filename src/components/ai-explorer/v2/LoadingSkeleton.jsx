import styles from './AiExplorerV2.module.css'
import UserPromptPill from './UserPromptPill'

/**
 * LoadingSkeleton — placeholder surfacing during AI generation. Shows the
 * pending user prompt pill (optional) on top and a shimmering progress +
 * skeleton-bar card below. Keeps the same vertical rhythm as InsightTurnCard
 * so the timeline does not jump when the real response arrives.
 */
export default function LoadingSkeleton({
  withPromptPill = false,
  promptText = '',
  promptTimestamp,
}) {
  return (
    <div className={styles.skeletonWrap} aria-live="polite" aria-busy="true">
      {withPromptPill && promptText && (
        <UserPromptPill content={promptText} timestamp={promptTimestamp} />
      )}
      <div className={styles.skeletonRoot} role="status" aria-label="考察を生成中">
        <div className={styles.skeletonHeader}>
          <span className={`material-symbols-outlined ${styles.skeletonHeaderIcon}`} aria-hidden="true">
            auto_awesome
          </span>
          <span className={`${styles.skeletonLabel} japanese-text`}>考察を生成中です… ✨</span>
        </div>
        <div className={styles.skeletonProgressTrack} aria-hidden="true">
          <div className={styles.skeletonProgressFill} />
        </div>
        <p className={`${styles.skeletonCaption} japanese-text`}>データを分析中…</p>
        <div className={styles.skeletonBars} aria-hidden="true">
          <div className={styles.skeletonBar} style={{ width: '92%' }} />
          <div className={styles.skeletonBar} style={{ width: '78%' }} />
          <div className={styles.skeletonBar} style={{ width: '64%' }} />
        </div>
      </div>
    </div>
  )
}
