import { getActiveJudgmentColors } from './reportTheme'
import { useTheme } from '../../contexts/ThemeContext'

export default function JudgmentBadge({ verdict, showIcon = true, size = 'sm', className = '' }) {
  useTheme() // subscribe to theme changes so inline styles update on toggle
  const def = getActiveJudgmentColors()[verdict]
  if (!def) return <span className={className}>{verdict}</span>

  const sizeClasses = size === 'xs'
    ? 'px-1.5 py-0.5 text-[10px] gap-1'
    : size === 'md'
      ? 'px-2.5 py-1 text-sm gap-1.5'
      : 'px-2 py-0.5 text-xs gap-1'

  return (
    <span
      className={`inline-flex items-center rounded-full font-bold whitespace-nowrap ${sizeClasses} ${className}`}
      style={{ backgroundColor: def.bg, color: def.text }}
    >
      <span
        className="inline-block rounded-full shrink-0"
        style={{
          backgroundColor: def.dot,
          width: size === 'xs' ? '6px' : '8px',
          height: size === 'xs' ? '6px' : '8px',
        }}
        aria-hidden="true"
      />
      {showIcon && (
        <span
          className="material-symbols-outlined"
          style={{
            fontSize: size === 'xs' ? '12px' : size === 'md' ? '16px' : '14px',
            color: def.dot,
          }}
          aria-hidden="true"
        >
          {def.icon}
        </span>
      )}
      {verdict}
    </span>
  )
}
