/**
 * 共通UIコンポーネント: LoadingSpinner, SkeletonBlock, ErrorBanner
 */

export function LoadingSpinner({ size = 'md', label }) {
  const sizeClass = size === 'sm' ? 'text-base' : size === 'lg' ? 'text-3xl' : 'text-2xl'

  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-3">
      <span className={`material-symbols-outlined animate-spin ${sizeClass} text-on-surface-variant`}>
        progress_activity
      </span>
      {label && <span className="text-sm text-on-surface-variant japanese-text">{label}</span>}
      <span className="sr-only">{label || '読み込み中'}</span>
    </span>
  )
}

export function SkeletonBlock({ variant = 'rect', width, height, lines = 3 }) {
  if (variant === 'text') {
    return (
      <div className="space-y-3" aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <div
            key={i}
            className="h-4 skeleton-sweep"
            style={{ width: i === lines - 1 ? '60%' : '100%' }}
          />
        ))}
      </div>
    )
  }

  if (variant === 'card') {
    return (
      <div className="bg-surface-container rounded-[0.75rem] p-6 space-y-4" aria-hidden="true">
        <div className="h-4 skeleton-sweep w-1/3" />
        <div className="h-3 skeleton-sweep w-full" />
        <div className="h-3 skeleton-sweep w-2/3" />
      </div>
    )
  }

  return (
    <div
      className="skeleton-sweep"
      style={{ width: width ?? '100%', height: height ?? '120px' }}
      aria-hidden="true"
    />
  )
}

export function ErrorBanner({ message, onRetry }) {
  return (
    <div role="alert" className="flex items-center gap-3 bg-error-container/40 border border-error/20 rounded-[0.75rem] px-5 py-3 text-sm text-on-error-container">
      <span className="material-symbols-outlined text-lg">error</span>
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="shrink-0 px-4 py-1.5 text-error font-bold text-xs hover:bg-error/5 rounded-lg transition-colors focus-ring"
        >
          再試行
        </button>
      )}
    </div>
  )
}
