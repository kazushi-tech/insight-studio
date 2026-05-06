import { Link } from 'react-router-dom'
import './AiContextRail.css'

function StatusPill({ label, value, tone = 'neutral' }) {
  if (!label && !value) return null
  return (
    <span className={`ai-context-rail__pill ai-context-rail__pill--${tone}`}>
      {label && <b>{label}</b>}
      {value && <span>{value}</span>}
    </span>
  )
}

export default function AiContextRail({
  screenName,
  status,
  inputSummary,
  evidence = [],
  suggestedQuestions = [],
  primaryAction,
  primaryActionTo = '/ads/ai',
  primaryActionLabel = 'AI考察で開く',
  helperText,
  className = '',
  children,
}) {
  const question = suggestedQuestions[0] || primaryAction || `${screenName || 'この画面'}について質問したい`
  const actionHref = `${primaryActionTo}${primaryActionTo.includes('?') ? '&' : '?'}question=${encodeURIComponent(question)}`

  return (
    <aside className={`ai-context-rail ${className}`} data-testid="ai-context-rail" aria-label={`${screenName}のAIアシスタント`}>
      <div className="ai-context-rail__header">
        <div>
          <p className="ai-context-rail__eyebrow">AIアシスタント</p>
          <h2 className="ai-context-rail__title japanese-text">{screenName}</h2>
        </div>
        <span className="ai-context-rail__icon material-symbols-outlined" aria-hidden="true">forum</span>
      </div>

      {helperText && (
        <p className="ai-context-rail__body japanese-text">{helperText}</p>
      )}

      <div className="ai-context-rail__section">
        <p className="ai-context-rail__section-title">現在の文脈</p>
        <div className="ai-context-rail__stack">
          <StatusPill label="状態" value={status} tone={status === '完了' ? 'good' : status?.includes('エラー') ? 'warn' : 'neutral'} />
          <StatusPill label="入力" value={inputSummary} />
        </div>
      </div>

      {evidence.length > 0 && (
        <div className="ai-context-rail__section">
          <p className="ai-context-rail__section-title">確認する根拠</p>
          <div className="ai-context-rail__evidence">
            {evidence.map((item) => (
              <span key={item} className="ai-context-rail__evidence-chip japanese-text">{item}</span>
            ))}
          </div>
        </div>
      )}

      {suggestedQuestions.length > 0 && (
        <div className="ai-context-rail__section">
          <p className="ai-context-rail__section-title">質問候補</p>
          <div className="ai-context-rail__questions">
            {suggestedQuestions.map((item) => (
              <Link
                key={item}
                to={`/ads/ai?question=${encodeURIComponent(item)}`}
                className="ai-context-rail__question japanese-text"
              >
                {item}
              </Link>
            ))}
          </div>
        </div>
      )}

      {children}

      <Link to={actionHref} className="ai-context-rail__primary japanese-text">
        <span className="material-symbols-outlined" aria-hidden="true">auto_awesome</span>
        {primaryActionLabel}
      </Link>
    </aside>
  )
}
