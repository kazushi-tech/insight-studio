import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import { platformApi } from '../../api/platform'
import { useModalDialog } from '../../hooks/useModalDialog'

const STEP_LABELS = ['案件情報', 'データ接続', '接続確認']

function operationKey(prefix) {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}:${id}`
}

function generatedSlug(name) {
  const ascii = String(name || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)
  return ascii || `site-${Date.now().toString(36)}`
}

function safeMessage(step) {
  if (step === 0) return '案件情報を保存できませんでした。入力内容を確認して、もう一度お試しください。'
  if (step === 1) return 'データ接続を保存できませんでした。権限と入力内容を確認してください。'
  return '接続を確認できませんでした。権限設定の反映後にもう一度お試しください。'
}

function formatObservedDate(value) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return '確認中'
  return new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium' }).format(date)
}

export default function ProjectEditorDialog({ project, onClose, onSaved }) {
  const [step, setStep] = useState(0)
  const [savedProject, setSavedProject] = useState(project || null)
  const [name, setName] = useState(project?.name || '')
  const [description, setDescription] = useState(project?.description || '')
  const [cloudProject, setCloudProject] = useState('')
  const [dataLocation, setDataLocation] = useState('')
  const [conversionEvents, setConversionEvents] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [testResult, setTestResult] = useState(null)
  const serviceAccount = import.meta.env.VITE_BQ_SERVICE_ACCOUNT_EMAIL || ''
  const hasUnsavedChanges = step === 0
    ? name !== (project?.name || '') || description !== (project?.description || '')
    : step === 1 && Boolean(cloudProject.trim() || dataLocation.trim() || conversionEvents.trim())

  function requestClose() {
    if (busy) return
    if (hasUnsavedChanges && !window.confirm('入力中の変更を破棄して閉じますか？')) return
    onClose()
  }

  const { dialogRef, initialFocusRef } = useModalDialog(requestClose)

  const eventNames = useMemo(() => conversionEvents
    .split(/[\s,、]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 20), [conversionEvents])

  async function saveDetails() {
    if (!name.trim()) return
    setBusy(true)
    setMessage('')
    try {
      let response
      if (savedProject) {
        response = await platformApi.updateProject(savedProject.id, {
          version: savedProject.version,
          name: name.trim(),
          description: description.trim() || null,
        })
      } else {
        response = await platformApi.createProject({
          name: name.trim(),
          slug: generatedSlug(name),
          description: description.trim() || null,
          is_demo: false,
        }, { idempotencyKey: operationKey('project-create') })
      }
      setSavedProject(response.project)
      setStep(1)
    } catch {
      setMessage(safeMessage(0))
    } finally {
      setBusy(false)
    }
  }

  async function saveConnection() {
    if (!savedProject) return
    if (!cloudProject.trim() && !dataLocation.trim()) {
      setStep(2)
      setTestResult({ skipped: true })
      return
    }
    if (!cloudProject.trim() || !dataLocation.trim()) {
      setMessage('2つの接続情報を入力してください。接続を後で行う場合は、両方を空欄にします。')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      await platformApi.putDataSource(savedProject.id, {
        source_type: 'ga4_bigquery',
        gcp_project_id: cloudProject.trim(),
        dataset_id: dataLocation.trim(),
        scope_kind: 'customer',
        safe_config: { conversion_events: eventNames },
      })
      setStep(2)
      setTestResult(null)
    } catch {
      setMessage(safeMessage(1))
    } finally {
      setBusy(false)
    }
  }

  async function testConnection() {
    if (!savedProject || testResult?.skipped) return
    setBusy(true)
    setMessage('')
    try {
      const response = await platformApi.testDataSource(savedProject.id)
      setTestResult(response)
    } catch {
      setTestResult({ connected: false })
      setMessage(safeMessage(2))
    } finally {
      setBusy(false)
    }
  }

  function finish() {
    onSaved(savedProject)
    onClose()
  }

  return createPortal(
    <div className="fixed inset-0 z-[110] grid place-items-center overflow-y-auto bg-black/45 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-editor-title"
        className="my-auto w-full max-w-2xl overflow-hidden rounded-2xl bg-surface-container-lowest shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-outline-variant/30 px-5 py-5 sm:px-7">
          <div>
            <p className="text-xs font-black tracking-[0.16em] text-primary">{project ? 'EDIT PROJECT' : 'NEW PROJECT'}</p>
            <h2 id="project-editor-title" className="mt-1 text-2xl font-extrabold text-on-surface japanese-text">
              {project ? '案件を編集' : '分析するサイトを登録'}
            </h2>
          </div>
          <button ref={initialFocusRef} type="button" onClick={requestClose} disabled={busy} className="grid size-11 place-items-center rounded-xl text-on-surface-variant hover:bg-surface-container disabled:opacity-50" aria-label="閉じる">
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </header>

        <ol className="grid grid-cols-3 gap-2 px-5 pt-5 sm:px-7" aria-label="登録手順">
          {STEP_LABELS.map((label, index) => (
            <li key={label} className={`rounded-xl px-2 py-3 text-center text-xs font-bold ${index === step ? 'bg-primary text-on-primary' : index < step ? 'bg-primary-fixed text-on-primary-fixed' : 'bg-surface-container text-on-surface-variant'}`} aria-current={index === step ? 'step' : undefined}>
              <span className="block text-[10px] opacity-70">{index + 1}</span>{label}
            </li>
          ))}
        </ol>

        <div className="max-h-[62vh] overflow-y-auto px-5 py-6 sm:px-7">
          {step === 0 && (
            <div className="space-y-5">
              <label className="block text-sm font-bold text-on-surface">
                案件名
                <input name="project-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={200} autoComplete="off" spellCheck={false} className="mt-2 min-h-11 w-full rounded-xl border border-outline-variant/50 bg-surface px-4 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" placeholder="例：自社コーポレートサイト" />
              </label>
              <label className="block text-sm font-bold text-on-surface">
                メモ（任意）
                <textarea name="project-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={5000} rows={4} autoComplete="off" className="mt-2 w-full rounded-xl border border-outline-variant/50 bg-surface px-4 py-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" placeholder="確認したい目的や社内メモ" />
              </label>
              <p className="rounded-xl bg-primary/[0.06] px-4 py-3 text-sm leading-7 text-on-surface-variant japanese-text">案件名は顧客向けレポートにも表示されます。内部IDは自動で安全に作成します。</p>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div className="rounded-xl bg-primary/[0.06] p-4 text-sm leading-7 text-on-surface-variant japanese-text">
                <p className="font-extrabold text-on-surface">先に読み取り専用の権限を設定します</p>
                <p className="mt-1">Insight Studio用アカウントへ「データ閲覧」と「分析ジョブ実行」の最小権限だけを付与してください。</p>
                {serviceAccount ? <code className="mt-3 block overflow-x-auto rounded-lg bg-surface px-3 py-2 text-xs text-on-surface">{serviceAccount}</code> : <p className="mt-2 font-bold text-primary">付与先アカウントは運用担当者から案内します。</p>}
              </div>
              <label className="block text-sm font-bold text-on-surface">
                Google Cloudのプロジェクト名
                <input name="cloud-project" value={cloudProject} onChange={(event) => setCloudProject(event.target.value)} autoComplete="off" spellCheck={false} className="mt-2 min-h-11 w-full rounded-xl border border-outline-variant/50 bg-surface px-4 font-mono text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" placeholder="例：my-analytics-project" />
              </label>
              <label className="block text-sm font-bold text-on-surface">
                アクセス対象のデータ保存先
                <input name="data-location" value={dataLocation} onChange={(event) => setDataLocation(event.target.value)} autoComplete="off" spellCheck={false} className="mt-2 min-h-11 w-full rounded-xl border border-outline-variant/50 bg-surface px-4 font-mono text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" placeholder="例：analytics_123456789" />
              </label>
              <div>
                <label htmlFor="project-conversion-events" className="block text-sm font-bold text-on-surface">成果として数えるイベント（任意）</label>
                <input id="project-conversion-events" name="conversion-events" aria-describedby="project-conversion-events-help" value={conversionEvents} onChange={(event) => setConversionEvents(event.target.value)} autoComplete="off" spellCheck={false} className="mt-2 min-h-11 w-full rounded-xl border border-outline-variant/50 bg-surface px-4 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" placeholder="例：generate_lead, purchase" />
                <span id="project-conversion-events-help" className="mt-2 block text-xs font-normal leading-6 text-on-surface-variant">保存後は識別情報をこの画面に再表示しません。変更時だけ入力し直します。</span>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              {testResult?.skipped ? (
                <div className="rounded-2xl bg-surface-container p-5">
                  <h3 className="font-extrabold text-on-surface">接続設定は後で行います</h3>
                  <p className="mt-2 text-sm leading-7 text-on-surface-variant">案件は保存済みです。レポートを作る前に、この画面からデータ接続を完了してください。</p>
                </div>
              ) : testResult?.connected ? (
                <div className="rounded-2xl bg-primary-fixed p-5 text-on-primary-fixed">
                  <h3 className="flex items-center gap-2 font-extrabold"><span className="material-symbols-outlined" aria-hidden="true">check_circle</span>接続を確認できました</h3>
                  <p className="mt-2 text-sm leading-7">読み取り専用でデータを確認できます。案件一覧には接続済みとして表示します。</p>
                  {testResult.latest_data_date && <p className="mt-2 text-xs font-bold">確認できた最新日: {formatObservedDate(testResult.latest_data_date)}</p>}
                  {Array.isArray(testResult.conversion_events) && testResult.conversion_events.length > 0 && (
                    <ul className="mt-3 space-y-1 text-xs" aria-label="成果イベントの確認結果">
                      {testResult.conversion_events.map((event) => (
                        <li key={event.name} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-white/45 px-3 py-2">
                          <span className="min-w-0 break-words font-bold">{event.name}</span>
                          <span>{event.status === 'measured' ? '直近90日で確認済み' : '直近90日は0件'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {testResult.conversion_event_status === 'not_configured' && <p className="mt-3 text-xs font-bold">成果イベントは未設定です。成果レポートを使う前に設定してください。</p>}
                </div>
              ) : (
                <div className="rounded-2xl border border-outline-variant/40 p-5">
                  <h3 className="font-extrabold text-on-surface">権限設定が反映されたら接続を確認します</h3>
                  <p className="mt-2 text-sm leading-7 text-on-surface-variant">反映に少し時間がかかることがあります。失敗しても案件情報は失われません。</p>
                  <button type="button" onClick={testConnection} disabled={busy} className="mt-4 min-h-11 rounded-xl bg-primary px-5 text-sm font-black text-on-primary disabled:opacity-50">{busy ? '確認しています…' : '接続を確認'}</button>
                </div>
              )}
            </div>
          )}

          {message && <p role="alert" className="mt-5 rounded-xl bg-error-container px-4 py-3 text-sm font-bold text-on-error-container japanese-text">{message}</p>}
        </div>

        <footer className="flex flex-col-reverse gap-3 border-t border-outline-variant/30 bg-surface-container-low px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <button type="button" onClick={requestClose} disabled={busy} className="min-h-11 rounded-xl px-5 text-sm font-bold text-on-surface-variant hover:bg-surface-container disabled:opacity-50">キャンセル</button>
          {step === 0 && <button type="button" onClick={saveDetails} disabled={busy || !name.trim()} className="min-h-11 rounded-xl bg-primary px-6 text-sm font-black text-on-primary disabled:opacity-50">{busy ? '保存しています…' : '保存して次へ'}</button>}
          {step === 1 && <div className="flex flex-col-reverse gap-2 sm:flex-row"><button type="button" onClick={() => setStep(0)} disabled={busy} className="min-h-11 rounded-xl px-5 text-sm font-bold text-on-surface-variant hover:bg-surface-container">戻る</button><button type="button" onClick={saveConnection} disabled={busy} className="min-h-11 rounded-xl bg-primary px-6 text-sm font-black text-on-primary disabled:opacity-50">{busy ? '保存しています…' : cloudProject || dataLocation ? '接続情報を保存' : '後で接続する'}</button></div>}
          {step === 2 && <div className="flex flex-col-reverse gap-2 sm:flex-row"><button type="button" onClick={() => setStep(1)} disabled={busy} className="min-h-11 rounded-xl px-5 text-sm font-bold text-on-surface-variant hover:bg-surface-container">戻る</button><button type="button" onClick={finish} disabled={busy || (!testResult?.connected && !testResult?.skipped)} className="min-h-11 rounded-xl bg-primary px-6 text-sm font-black text-on-primary disabled:opacity-50">完了</button></div>}
        </footer>
      </section>
    </div>,
    document.body,
  )
}
