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
  auth_error:    { icon: 'lock',           bg: 'bg-amber-50 dark:bg-warning-container',          border: 'border-amber-200 dark:border-warning/30',         text: 'text-amber-800 dark:text-on-warning-container',  btnText: 'text-amber-700 dark:text-warning' },
  invalid_input: { icon: 'edit_note',      bg: 'bg-amber-50 dark:bg-warning-container',          border: 'border-amber-200 dark:border-warning/30',         text: 'text-amber-800 dark:text-on-warning-container',  btnText: 'text-amber-700 dark:text-warning' },
  upstream:      { icon: 'cloud_sync',     bg: 'bg-amber-50 dark:bg-warning-container',          border: 'border-amber-200 dark:border-warning/30',         text: 'text-amber-800 dark:text-on-warning-container',  btnText: 'text-amber-700 dark:text-warning' },
  not_found:     { icon: 'search_off',     bg: 'bg-slate-50 dark:bg-surface-container-high',     border: 'border-slate-200 dark:border-outline-variant',    text: 'text-slate-700 dark:text-on-surface-variant',    btnText: 'text-slate-600 dark:text-on-surface' },
  rate_limit:    { icon: 'hourglass_top',  bg: 'bg-amber-50 dark:bg-warning-container',          border: 'border-amber-200 dark:border-warning/30',         text: 'text-amber-800 dark:text-on-warning-container',  btnText: 'text-amber-700 dark:text-warning' },
  overloaded:    { icon: 'cloud_queue',    bg: 'bg-violet-50 dark:bg-primary-container/30',      border: 'border-violet-200 dark:border-primary/20',        text: 'text-violet-800 dark:text-on-primary-container', btnText: 'text-violet-700 dark:text-primary' },
  stale:         { icon: 'sync_problem',   bg: 'bg-sky-50 dark:bg-info-container',               border: 'border-sky-200 dark:border-info/30',              text: 'text-sky-800 dark:text-on-info-container',       btnText: 'text-sky-700 dark:text-info' },
  billing:       { icon: 'credit_card_off', bg: 'bg-amber-50 dark:bg-warning-container',         border: 'border-amber-200 dark:border-warning/30',         text: 'text-amber-800 dark:text-on-warning-container',  btnText: 'text-amber-700 dark:text-warning' },
  conflict:      { icon: 'hourglass_empty', bg: 'bg-sky-50 dark:bg-info-container',              border: 'border-sky-200 dark:border-info/30',              text: 'text-sky-800 dark:text-on-info-container',       btnText: 'text-sky-700 dark:text-info' },
  unknown:       { icon: 'help',           bg: 'bg-slate-50 dark:bg-surface-container-high',     border: 'border-slate-200 dark:border-outline-variant',    text: 'text-slate-700 dark:text-on-surface-variant',    btnText: 'text-slate-600 dark:text-on-surface' },
}

const ERROR_NEXT_STEPS = {
  timeout: ['入力内容はそのままです', '少し待ってから再試行してください'],
  cold_start: ['サービスの準備に時間がかかっています', '1〜2分待ってから再試行してください'],
  network: ['通信状態を確認してください', '入力内容を確認してから再試行してください'],
  auth_error: ['追加分析の設定を確認してください', '設定後に同じ画面から再試行できます'],
  invalid_input: ['URL形式と必須項目を確認してください', 'URLは https:// から入力してください'],
  upstream: ['入力内容はそのままです', '少し待ってから同じ条件で再試行してください'],
  not_found: ['入力したURLや画像を確認してください', '必要な場合は選び直して再試行してください'],
  rate_limit: ['利用上限に達している可能性があります', '時間を置いてから再試行してください'],
  overloaded: ['現在、処理が混み合っています', '数分待ってから再試行してください'],
  stale: ['処理をもう一度実行してください', '同じ状態が続く場合は導入担当者へご連絡ください'],
  billing: ['追加分析の利用設定を確認してください', '確認後に同じ画面から再試行できます'],
  conflict: ['別の処理が完了するまでお待ちください', '完了後にもう一度実行してください'],
}

/**
 * @param {{ message: string, onRetry?: () => void, errorInfo?: { category: string, label: string, guidance: string, retryable: boolean } }} props
 */
export function ErrorBanner({ message, onRetry, errorInfo }) {
  const category = errorInfo?.category || 'unknown'
  const style = ERROR_CATEGORY_STYLES[category] || ERROR_CATEGORY_STYLES.unknown
  const icon = style?.icon || 'error'
  const bg = style?.bg || 'bg-error-container/40'
  const border = style?.border || 'border-error/20'
  const text = style?.text || 'text-on-error-container'
  const btnText = style?.btnText || 'text-error'
  const showRetry = onRetry && (errorInfo ? errorInfo.retryable !== false : true)
  const nextSteps = ERROR_NEXT_STEPS[category] || null

  return (
    <div role="alert" className={`flex flex-col gap-2 ${bg} border ${border} rounded-[0.75rem] px-5 py-3 text-sm ${text}`}>
      <div className="flex items-center gap-3">
        <span className="material-symbols-outlined text-lg" aria-hidden="true">{icon}</span>
        <span className="flex-1">{message}</span>
        {errorInfo?.label && (
          <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-bold ${bg} ${border}`}>
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
      {nextSteps && (
        <div className="ml-8 flex flex-wrap gap-2" aria-label="次に確認すること">
          {nextSteps.map((step) => (
            <span key={step} className={`inline-flex items-center gap-1 rounded-full border ${border} bg-white/40 dark:bg-black/10 px-2.5 py-1 text-xs font-bold`}>
              <span className="material-symbols-outlined text-sm" aria-hidden="true">checklist</span>
              {step}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
