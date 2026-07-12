import { useMemo, useState } from 'react'
import * as defaultReportsApi from '../../api/projectReports'
import { normalizeCustomerError } from '../../utils/customerErrors'
import {
  canManageReportShares,
  customerReportPrintPath,
  customerReportShareUrl,
  findPersistedReportId,
} from '../../utils/reportSharing'

function formatExpiry(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '7日後まで'
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function ActionButton({ icon, children, className = '', ...props }) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    >
      <span className="material-symbols-outlined text-lg" aria-hidden="true">{icon}</span>
      {children}
    </button>
  )
}

export default function ReportOutputActions({
  projectRef,
  report,
  persistedReportId = '',
  historyEntries = [],
  historyState = 'idle',
  onSaveReport = null,
  user = null,
  reportsApi = defaultReportsApi,
}) {
  const reportId = useMemo(
    () => findPersistedReportId(historyEntries, report, persistedReportId),
    [historyEntries, persistedReportId, report],
  )
  const [busyAction, setBusyAction] = useState('')
  const [feedback, setFeedback] = useState(null)
  const [error, setError] = useState(null)
  const [share, setShare] = useState(null)
  const canShare = canManageReportShares(user, projectRef)
  const isSaving = historyState === 'saving'
  const scopeKey = `${projectRef || ''}:${reportId || ''}:${report?.report_id || ''}`
  const activeShare = share?.scopeKey === scopeKey ? share : null
  const activeFeedback = feedback?.scopeKey === scopeKey ? feedback.text : ''
  const activeError = error?.scopeKey === scopeKey ? error.value : null

  async function runAction(name, operation) {
    if (busyAction) return
    setBusyAction(name)
    setFeedback(null)
    setError(null)
    try {
      await operation()
    } catch (caught) {
      setError({
        scopeKey,
        value: normalizeCustomerError(caught, { role: user?.role }),
      })
    } finally {
      setBusyAction('')
    }
  }

  function handleSave() {
    if (typeof onSaveReport !== 'function') return
    void runAction('save', async () => {
      const entry = await onSaveReport()
      if (!entry) throw new Error('report_history_save_unavailable')
      setFeedback({ scopeKey, text: '履歴への保存を開始しました。完了すると共有と出力を使えます。' })
    })
  }

  function handleCsv() {
    if (!projectRef || !reportId) return
    void runAction('csv', async () => {
      const csv = await reportsApi.fetchProjectReportCsv(projectRef, reportId)
      const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = 'web-report.csv'
      link.hidden = true
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(objectUrl)
      setFeedback({ scopeKey, text: '根拠数値のCSVを保存しました。' })
    })
  }

  function handleCreateShare() {
    if (!projectRef || !reportId || !canShare) return
    void runAction('share', async () => {
      const response = await reportsApi.createProjectReportShare(projectRef, reportId, {
        expiresInDays: 7,
      })
      const created = response?.share
      const token = typeof created?.token === 'string' ? created.token : ''
      const id = created?.id ?? created?.share_id
      if (!token || !id) throw new Error('report_share_invalid')
      setShare({
        scopeKey,
        id,
        token,
        expiresAt: created.expires_at ?? null,
        url: customerReportShareUrl(token),
      })
      setFeedback({ scopeKey, text: '7日間の閲覧専用リンクを発行しました。' })
    })
  }

  function handleCopyShare() {
    if (!activeShare?.url) return
    void runAction('copy', async () => {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable')
      await navigator.clipboard.writeText(activeShare.url)
      setFeedback({ scopeKey, text: '共有リンクをコピーしました。' })
    })
  }

  function handleRevokeShare() {
    if (!projectRef || !reportId || !activeShare?.id || !canShare) return
    if (!window.confirm('この共有リンクを失効しますか？リンクを知っている方も閲覧できなくなります。')) return
    void runAction('revoke', async () => {
      await reportsApi.revokeProjectReportShare(projectRef, reportId, activeShare.id)
      setShare(null)
      setFeedback({ scopeKey, text: '共有リンクを失効しました。' })
    })
  }

  const unavailable = !projectRef || !reportId

  return (
    <section className="rounded-2xl bg-surface-container-lowest p-5 shadow-sm" aria-labelledby="report-output-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-primary">Share &amp; Export</p>
          <h2 id="report-output-title" className="mt-1 text-lg font-extrabold text-on-surface japanese-text">共有と出力</h2>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-7 text-on-surface-variant japanese-text">
            印刷用画面、根拠数値のCSV、期限付きの閲覧専用リンクを使えます。
          </p>
        </div>
        {!unavailable && (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <a
              href={customerReportPrintPath(projectRef, reportId)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-surface-container px-4 py-2 text-sm font-black text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span className="material-symbols-outlined text-lg" aria-hidden="true">print</span>
              印刷・PDF保存
            </a>
            <ActionButton
              icon="download"
              onClick={handleCsv}
              disabled={Boolean(busyAction)}
              className="bg-surface-container text-primary"
            >
              {busyAction === 'csv' ? '準備中' : '根拠数値CSV'}
            </ActionButton>
          </div>
        )}
      </div>

      {unavailable && (
        <div className="mt-5 rounded-xl bg-warning-container/70 p-4" role="status">
          <p className="text-sm font-extrabold text-on-surface japanese-text">
            {!projectRef ? '案件を確認してから出力できます。' : '先にこのレポートを履歴へ保存してください。'}
          </p>
          <p className="mt-1 text-xs font-semibold leading-6 text-on-surface-variant japanese-text">
            保存完了前のレポートから、別のレポートを誤って共有することはありません。
          </p>
          {projectRef && typeof onSaveReport === 'function' && (
            <ActionButton
              icon="save"
              onClick={handleSave}
              disabled={Boolean(busyAction) || isSaving}
              className="mt-3 bg-primary text-on-primary"
            >
              {isSaving || busyAction === 'save' ? '履歴へ保存中' : '履歴へ保存'}
            </ActionButton>
          )}
        </div>
      )}

      {!unavailable && canShare && (
        <div className="mt-5 rounded-2xl bg-surface-container-low p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-extrabold text-on-surface japanese-text">7日間の閲覧専用リンク</h3>
              <p className="mt-1 text-xs font-semibold leading-6 text-on-surface-variant japanese-text">
                リンクを知っている方だけが閲覧できます。必要がなくなったら失効してください。
              </p>
            </div>
            {!activeShare && (
              <ActionButton
                icon="link"
                onClick={handleCreateShare}
                disabled={Boolean(busyAction)}
                className="shrink-0 bg-primary text-on-primary"
              >
                {busyAction === 'share' ? '発行中' : '共有リンクを発行'}
              </ActionButton>
            )}
          </div>

          {activeShare && (
            <div className="mt-4 rounded-xl bg-white p-4">
              <label htmlFor="report-share-url" className="text-xs font-bold text-on-surface-variant japanese-text">
                閲覧期限: {formatExpiry(activeShare.expiresAt)}
              </label>
              <input
                id="report-share-url"
                readOnly
                value={activeShare.url}
                onFocus={(event) => event.currentTarget.select()}
                className="mt-2 min-h-11 w-full rounded-xl bg-surface-container-low px-3 py-2 text-sm text-on-surface focus-visible:outline-2 focus-visible:outline-primary"
              />
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <ActionButton
                  icon="content_copy"
                  onClick={handleCopyShare}
                  disabled={Boolean(busyAction)}
                  className="bg-primary text-on-primary"
                >
                  リンクをコピー
                </ActionButton>
                <a
                  href={activeShare.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-surface-container px-4 py-2 text-sm font-black text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <span className="material-symbols-outlined text-lg" aria-hidden="true">open_in_new</span>
                  表示を確認
                </a>
                <ActionButton
                  icon="link_off"
                  onClick={handleRevokeShare}
                  disabled={Boolean(busyAction)}
                  className="text-error hover:bg-error-container/50"
                >
                  {busyAction === 'revoke' ? '失効中' : 'リンクを失効'}
                </ActionButton>
              </div>
            </div>
          )}
        </div>
      )}

      {!unavailable && !canShare && (
        <p className="mt-4 rounded-xl bg-surface-container-low px-4 py-3 text-xs font-semibold leading-6 text-on-surface-variant japanese-text">
          共有リンクの発行は契約管理者に依頼してください。印刷とCSV保存は利用できます。
        </p>
      )}

      {(activeFeedback || activeError) && (
        <div
          className={`mt-4 rounded-xl px-4 py-3 text-sm font-bold japanese-text ${activeError ? 'bg-error-container text-on-error-container' : 'bg-success-container text-on-success-container'}`}
          role={activeError ? 'alert' : 'status'}
          aria-live={activeError ? 'assertive' : 'polite'}
        >
          {activeError ? `${activeError.title} ${activeError.body}` : activeFeedback}
        </div>
      )}
    </section>
  )
}
