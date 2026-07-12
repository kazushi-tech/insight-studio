import { useCallback, useEffect, useMemo, useState } from 'react'

import { legalApi } from '../api/legal'
import DataStatePanel from './DataStatePanel'


function operationKey(prefix) {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}:${id}`
}

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('ja-JP')
}

function exportStatusLabel(status) {
  return {
    requested: '受付済み',
    processing: '準備中',
    ready: '受け取り可能',
    failed: '準備できませんでした',
    expired: '期限切れ',
  }[status] || '確認中'
}

export default function LegalPrivacySettingsCard({ user, enabled }) {
  const role = user?.platform_role ?? user?.workspace_role ?? user?.role
  const canManageWorkspace = role === 'platform_admin' || role === 'workspace_owner'
  const [documents, setDocuments] = useState([])
  const [acceptance, setAcceptance] = useState(null)
  const [deletions, setDeletions] = useState([])
  const [exports, setExports] = useState([])
  const [confirmed, setConfirmed] = useState({})
  const [state, setState] = useState('loading')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!enabled) return
    if (!quiet) {
      setState('loading')
      setMessage('')
    }
    try {
      const [documentResponse, acceptanceResponse, deletionResponse, exportResponse] = await Promise.all([
        legalApi.getDocuments(),
        legalApi.getAcceptanceStatus(),
        legalApi.listDeletionRequests(),
        legalApi.listDataExports(),
      ])
      setDocuments(Array.isArray(documentResponse.documents) ? documentResponse.documents : [])
      setAcceptance(acceptanceResponse)
      setDeletions(Array.isArray(deletionResponse.deletion_requests) ? deletionResponse.deletion_requests : [])
      setExports(Array.isArray(exportResponse.exports) ? exportResponse.exports : [])
      setState('ready')
    } catch {
      setState('error')
      setMessage('規約とデータ管理の状態を確認できませんでした。')
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return undefined
    let active = true
    Promise.all([
      legalApi.getDocuments(),
      legalApi.getAcceptanceStatus(),
      legalApi.listDeletionRequests(),
      legalApi.listDataExports(),
    ]).then(([documentResponse, acceptanceResponse, deletionResponse, exportResponse]) => {
      if (!active) return
      setDocuments(Array.isArray(documentResponse.documents) ? documentResponse.documents : [])
      setAcceptance(acceptanceResponse)
      setDeletions(Array.isArray(deletionResponse.deletion_requests) ? deletionResponse.deletion_requests : [])
      setExports(Array.isArray(exportResponse.exports) ? exportResponse.exports : [])
      setState('ready')
    }).catch(() => {
      if (!active) return
      setState('error')
      setMessage('規約とデータ管理の状態を確認できませんでした。')
    })
    return () => { active = false }
  }, [enabled])

  useEffect(() => {
    if (!enabled || !exports.some((item) => ['requested', 'processing'].includes(item.status))) {
      return undefined
    }
    const timer = window.setTimeout(() => { load({ quiet: true }) }, 10000)
    return () => window.clearTimeout(timer)
  }, [enabled, exports, load])

  const statusByKey = useMemo(() => new Map(
    (acceptance?.documents || []).map((item) => [item.document_key, item]),
  ), [acceptance?.documents])

  if (!enabled) return null

  async function accept(document) {
    if (!confirmed[document.document_key]) return
    setBusy(true)
    setMessage('')
    try {
      await legalApi.acceptDocument(document.document_key, document.version, {
        idempotencyKey: operationKey(`accept-${document.document_key}`),
      })
      await load()
      setMessage('最新版への同意を記録しました。')
    } catch {
      setMessage('同意を記録できませんでした。最新版を開き直して再試行してください。')
    } finally {
      setBusy(false)
    }
  }

  async function requestExport(scope) {
    setBusy(true)
    setMessage('')
    try {
      await legalApi.requestDataExport(scope, { idempotencyKey: operationKey(`export-${scope}`) })
      await load()
      setMessage('データ出力を受け付けました。準備完了後にお知らせします。')
    } catch {
      setMessage('データ出力を受け付けられませんでした。')
    } finally {
      setBusy(false)
    }
  }

  async function downloadExport(item, format) {
    setBusy(true)
    setMessage('')
    try {
      const download = await legalApi.downloadDataExport(item.job_id, format)
      const href = URL.createObjectURL(download.blob)
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = download.filename
      anchor.rel = 'noopener'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(href)
      await load()
      setMessage('データを安全に受け取りました。')
    } catch {
      setMessage('データを受け取れませんでした。期限と準備状況を確認してください。')
    } finally {
      setBusy(false)
    }
  }

  async function requestDeletion(scope) {
    const label = scope === 'workspace' ? '契約企業全体' : 'ご自身のアカウント'
    if (!window.confirm(`${label}の削除を申請しますか？30日以内は取り消せます。`)) return
    setBusy(true)
    setMessage('')
    try {
      await legalApi.requestDeletion(scope, { idempotencyKey: operationKey(`delete-${scope}`) })
      await load()
      setMessage('削除申請を受け付けました。実行までは30日間です。')
    } catch {
      setMessage('削除申請を受け付けられませんでした。最後の所有者は、先に別の所有者を設定してください。')
    } finally {
      setBusy(false)
    }
  }

  async function cancelDeletion(requestId) {
    setBusy(true)
    try {
      await legalApi.cancelDeletion(requestId, { idempotencyKey: operationKey('cancel-delete') })
      await load()
      setMessage('削除申請を取り消しました。')
    } catch {
      setMessage('削除申請を取り消せませんでした。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-5 rounded-2xl bg-surface-container-lowest p-5 shadow-sm sm:p-6" aria-labelledby="legal-privacy-settings-title">
      <div>
        <h2 id="legal-privacy-settings-title" className="text-lg font-extrabold text-on-surface japanese-text">規約への同意とデータ管理</h2>
        <p className="mt-1 text-sm leading-7 text-on-surface-variant japanese-text">会社承認済みの最新版だけを表示し、同意した版を記録します。</p>
      </div>

      {state === 'loading' && <DataStatePanel state="loading" message="規約の最新版を確認しています。" />}
      {state === 'error' && <DataStatePanel state="error" message={message} onRetry={load} />}
      {state === 'ready' && (
        <>
          <div className="space-y-3">
            {documents.map((document) => {
              const status = statusByKey.get(document.document_key)
              return (
                <article key={document.document_key} className="rounded-xl bg-surface-container p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="font-extrabold text-on-surface japanese-text">{document.title}</h3>
                      <p className="mt-1 text-xs text-on-surface-variant">版 {document.version}・{formatDate(document.effective_at)}適用</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${status?.accepted ? 'bg-primary-container text-on-primary-container' : 'bg-error-container text-on-error-container'}`}>
                      {status?.accepted ? '同意済み' : '同意が必要'}
                    </span>
                  </div>
                  <a href={document.public_url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 items-center text-sm font-bold text-primary underline underline-offset-4">承認済みの全文を確認</a>
                  {!status?.accepted && (
                    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                      <label className="flex min-h-11 items-center gap-3 text-sm font-bold japanese-text">
                        <input
                          type="checkbox"
                          checked={Boolean(confirmed[document.document_key])}
                          onChange={(event) => setConfirmed((current) => ({ ...current, [document.document_key]: event.target.checked }))}
                          className="h-5 w-5"
                        />
                        最新版を確認し、同意します
                      </label>
                      <button type="button" disabled={busy || !confirmed[document.document_key]} onClick={() => accept(document)} className="min-h-11 rounded-xl bg-primary px-4 text-sm font-black text-on-primary disabled:opacity-50">同意を記録</button>
                    </div>
                  )}
                </article>
              )
            })}
          </div>

          {message && <p role="status" className="rounded-xl bg-secondary-container px-4 py-3 text-sm font-bold text-on-secondary-container japanese-text">{message}</p>}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-outline-variant/40 p-4">
              <h3 className="font-extrabold japanese-text">データを受け取る</h3>
              <p className="mt-1 text-xs leading-6 text-on-surface-variant japanese-text">申請後、本人確認済みの安全な方法で準備します。</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => requestExport('account')} className="min-h-11 rounded-xl bg-surface-container px-4 text-sm font-bold text-primary disabled:opacity-50">自分のデータを申請</button>
                {canManageWorkspace && <button type="button" disabled={busy} onClick={() => requestExport('workspace')} className="min-h-11 rounded-xl bg-surface-container px-4 text-sm font-bold text-primary disabled:opacity-50">企業全体を申請</button>}
              </div>
              {exports.length > 0 && (
                <div className="mt-4 space-y-2" aria-label="データ出力の準備状況">
                  {exports.slice(0, 5).map((item) => (
                    <div key={item.job_id} className="rounded-xl bg-surface-container p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-bold japanese-text">
                          {item.scope === 'workspace' ? '企業全体' : 'ご自身'}のデータ
                        </p>
                        <span className="text-xs font-bold text-on-surface-variant">
                          {exportStatusLabel(item.status)}
                        </span>
                      </div>
                      {item.status === 'ready' && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button type="button" disabled={busy} onClick={() => downloadExport(item, 'json')} className="min-h-11 rounded-xl bg-primary px-4 text-sm font-black text-on-primary disabled:opacity-50">標準形式で受け取る</button>
                          <button type="button" disabled={busy} onClick={() => downloadExport(item, 'csv')} className="min-h-11 rounded-xl bg-surface px-4 text-sm font-bold text-primary disabled:opacity-50">表形式で受け取る</button>
                        </div>
                      )}
                      {item.expires_at && item.status === 'ready' && (
                        <p className="mt-2 text-xs text-on-surface-variant">受取期限: {formatDate(item.expires_at)}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-xl border border-error/20 p-4">
              <h3 className="font-extrabold japanese-text">削除を申請する</h3>
              <p className="mt-1 text-xs leading-6 text-on-surface-variant japanese-text">実行まで30日間あり、その間は取り消せます。</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => requestDeletion('account')} className="min-h-11 rounded-xl px-4 text-sm font-bold text-error hover:bg-error-container disabled:opacity-50">アカウント削除を申請</button>
                {canManageWorkspace && <button type="button" disabled={busy} onClick={() => requestDeletion('workspace')} className="min-h-11 rounded-xl px-4 text-sm font-bold text-error hover:bg-error-container disabled:opacity-50">企業全体の削除を申請</button>}
              </div>
            </div>
          </div>

          {deletions.filter((item) => item.status === 'requested').map((item) => (
            <div key={item.id} className="flex flex-col gap-3 rounded-xl bg-error-container/60 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-bold text-on-error-container japanese-text">{item.scope === 'workspace' ? '企業全体' : 'アカウント'}の削除予定: {formatDate(item.execute_after)}</p>
              <button type="button" disabled={busy} onClick={() => cancelDeletion(item.id)} className="min-h-11 rounded-xl bg-surface px-4 text-sm font-black text-primary disabled:opacity-50">申請を取り消す</button>
            </div>
          ))}
        </>
      )}
    </section>
  )
}
