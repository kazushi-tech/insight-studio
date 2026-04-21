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

const ERROR_CATEGORY_STYLES = {
  timeout:       { icon: 'schedule',       bg: 'bg-amber-50 dark:bg-warning-container',          border: 'border-amber-200 dark:border-warning/30',         text: 'text-amber-800 dark:text-on-warning-container',  btnText: 'text-amber-700 dark:text-warning' },
  cold_start:    { icon: 'restart_alt',    bg: 'bg-sky-50 dark:bg-info-container',               border: 'border-sky-200 dark:border-info/30',              text: 'text-sky-800 dark:text-on-info-container',       btnText: 'text-sky-700 dark:text-info' },
  network:       { icon: 'wifi_off',       bg: 'bg-orange-50 dark:bg-warning-container',         border: 'border-orange-200 dark:border-warning/30',        text: 'text-orange-800 dark:text-on-warning-container', btnText: 'text-orange-700 dark:text-warning' },
  auth_error:    { icon: 'lock',           bg: 'bg-red-50 dark:bg-error-container',              border: 'border-red-200 dark:border-error/30',             text: 'text-red-800 dark:text-on-error-container',      btnText: 'text-red-700 dark:text-error' },
  invalid_input: { icon: 'edit_note',      bg: 'bg-amber-50 dark:bg-warning-container',          border: 'border-amber-200 dark:border-warning/30',         text: 'text-amber-800 dark:text-on-warning-container',  btnText: 'text-amber-700 dark:text-warning' },
  upstream:      { icon: 'cloud_off',      bg: 'bg-rose-50 dark:bg-error-container',             border: 'border-rose-200 dark:border-error/30',            text: 'text-rose-800 dark:text-on-error-container',     btnText: 'text-rose-700 dark:text-error' },
  not_found:     { icon: 'search_off',     bg: 'bg-slate-50 dark:bg-surface-container-high',     border: 'border-slate-200 dark:border-outline-variant',    text: 'text-slate-700 dark:text-on-surface-variant',    btnText: 'text-slate-600 dark:text-on-surface' },
  rate_limit:    { icon: 'hourglass_top',  bg: 'bg-amber-50 dark:bg-warning-container',          border: 'border-amber-200 dark:border-warning/30',         text: 'text-amber-800 dark:text-on-warning-container',  btnText: 'text-amber-700 dark:text-warning' },
  overloaded:    { icon: 'cloud_queue',    bg: 'bg-violet-50 dark:bg-primary-container/30',      border: 'border-violet-200 dark:border-primary/20',        text: 'text-violet-800 dark:text-on-primary-container', btnText: 'text-violet-700 dark:text-primary' },
}

/**
 * @param {{ message: string, onRetry?: () => void, errorInfo?: { category: string, label: string, guidance: string, retryable: boolean } }} props
 */
export function ErrorBanner({ message, onRetry, errorInfo }) {
  const style = (errorInfo?.category && ERROR_CATEGORY_STYLES[errorInfo.category]) || null
  const icon = style?.icon || 'error'
  const bg = style?.bg || 'bg-error-container/40'
  const border = style?.border || 'border-error/20'
  const text = style?.text || 'text-on-error-container'
  const btnText = style?.btnText || 'text-error'
  const showRetry = onRetry && (errorInfo ? errorInfo.retryable !== false : true)

  return (
    <div role="alert" className={`flex flex-col gap-2 ${bg} border ${border} rounded-[0.75rem] px-5 py-3 text-sm ${text}`}>
      <div className="flex items-center gap-3">
        <span className="material-symbols-outlined text-lg">{icon}</span>
        <span className="flex-1">{message}</span>
        {errorInfo?.label && (
          <span className={`shrink-0 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${bg} ${border} border`}>
            {errorInfo.label}
          </span>
        )}
        {showRetry && (
          <button
            onClick={onRetry}
            className={`shrink-0 px-4 py-1.5 ${btnText} font-bold text-xs hover:opacity-70 rounded-lg transition-colors focus-ring`}
          >
            再試行
          </button>
        )}
      </div>
      {errorInfo?.guidance && (
        <p className="text-xs opacity-75 ml-8">{errorInfo.guidance}</p>
      )}
    </div>
  )
}
