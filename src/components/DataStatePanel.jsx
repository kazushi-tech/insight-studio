const STATE_COPY = {
  loading: { icon: 'progress_activity', title: 'データを確認しています' },
  partial: { icon: 'info', title: '確認できた範囲を表示しています' },
  empty: { icon: 'inbox', title: 'この期間のデータはありません' },
  retrying: { icon: 'sync', title: 'もう一度確認しています' },
  error: { icon: 'error', title: 'データを確認できませんでした' },
}

export default function DataStatePanel({
  state,
  title,
  message,
  onRetry,
  retryLabel = 'もう一度確認する',
  children,
}) {
  if (state === 'full') return children || null

  const copy = STATE_COPY[state] || STATE_COPY.error
  const isBusy = state === 'loading' || state === 'retrying'
  const role = state === 'error' ? 'alert' : 'status'

  return (
    <section
      className="rounded-2xl bg-surface-container-lowest px-5 py-6 sm:px-6"
      role={role}
      aria-live={state === 'error' ? 'assertive' : 'polite'}
      aria-busy={isBusy || undefined}
    >
      <div className="flex items-start gap-4">
        <span
          className={`material-symbols-outlined grid size-11 shrink-0 place-items-center rounded-xl bg-primary/[0.07] text-2xl text-primary ${isBusy ? 'animate-spin motion-reduce:animate-none' : ''}`}
          aria-hidden="true"
        >
          {copy.icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-extrabold text-on-surface japanese-text">{title || copy.title}</h2>
          {message && <p className="mt-2 text-sm font-semibold leading-7 text-on-surface-variant japanese-text">{message}</p>}
          {children && <div className="mt-4">{children}</div>}
          {onRetry && !isBusy && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-black text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span className="material-symbols-outlined text-lg" aria-hidden="true">refresh</span>
              {retryLabel}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
