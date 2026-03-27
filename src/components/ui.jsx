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
            className="h-4 bg-surface-container rounded-lg animate-pulse"
            style={{ width: i === lines - 1 ? '60%' : '100%' }}
          />
        ))}
      </div>
    )
  }

  if (variant === 'card') {
    return (
      <div className="bg-surface-container rounded-xl animate-pulse p-6 space-y-4" aria-hidden="true">
        <div className="h-4 bg-surface-container-high rounded w-1/3" />
        <div className="h-3 bg-surface-container-high rounded w-full" />
        <div className="h-3 bg-surface-container-high rounded w-2/3" />
      </div>
    )
  }

  return (
    <div
      className="bg-surface-container rounded-xl animate-pulse"
      style={{ width: width ?? '100%', height: height ?? '120px' }}
      aria-hidden="true"
    />
  )
}

export function ErrorBanner({ message, onRetry }) {
  return (
    <div role="alert" className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-5 py-3 text-sm text-red-700">
      <span className="material-symbols-outlined text-lg">error</span>
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="shrink-0 px-4 py-1.5 bg-red-100 hover:bg-red-200 text-red-800 rounded-lg text-xs font-bold transition-colors"
        >
          再試行
        </button>
      )}
    </div>
  )
}
