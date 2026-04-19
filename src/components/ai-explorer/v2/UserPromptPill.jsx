import { useState } from 'react'
import styles from './AiExplorerV2.module.css'

/**
 * UserPromptPill — inline chip surfacing the user's question at the top of an
 * InsightTurnCard. Collapsed by default (first line / ellipsis). Clicking the
 * pill expands it to the full prompt; timestamp appears alongside when
 * expanded so the turn's origin stays visible without dominating the card.
 */
export default function UserPromptPill({ content = '', timestamp }) {
  const [expanded, setExpanded] = useState(false)

  const hasContent = typeof content === 'string' && content.trim().length > 0
  if (!hasContent) return null

  return (
    <div className={styles.promptPillWrap}>
      <button
        type="button"
        className={`${styles.promptPill} ${expanded ? styles.promptPillExpanded : ''}`}
        aria-expanded={expanded}
        aria-label={expanded ? 'ユーザーの質問を折りたたむ' : 'ユーザーの質問を展開する'}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: '1rem' }}>
          psychology_alt
        </span>
        {expanded ? (
          <span className="japanese-text" style={{ whiteSpace: 'pre-wrap' }}>
            {content}
          </span>
        ) : (
          <span className={`${styles.promptPillSummary} japanese-text`}>{content}</span>
        )}
      </button>
      {expanded && timestamp && (
        <span className={styles.timestamp} aria-label={`送信日時 ${timestamp}`}>
          {timestamp}
        </span>
      )}
    </div>
  )
}
