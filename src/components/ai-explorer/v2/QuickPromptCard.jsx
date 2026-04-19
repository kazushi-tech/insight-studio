import styles from './AiExplorerV2.module.css'

/**
 * QuickPromptCard — "suggested question" tile rendered in the empty state and
 * (compact variant) inside the composer. Icon chip + bold title + supporting
 * description. Disabled state suppresses hover and fades the card.
 */
export default function QuickPromptCard({
  icon = 'lightbulb',
  title,
  description,
  onClick,
  disabled = false,
}) {
  return (
    <button
      type="button"
      className={styles.quickPromptCard}
      onClick={onClick}
      disabled={disabled}
      aria-label={title}
    >
      <span className={styles.quickPromptIcon} aria-hidden="true">
        <span className="material-symbols-outlined">{icon}</span>
      </span>
      <span className={`${styles.quickPromptTitle} japanese-text`}>{title}</span>
      {description && (
        <span className={`${styles.quickPromptDescription} japanese-text`}>{description}</span>
      )}
    </button>
  )
}
