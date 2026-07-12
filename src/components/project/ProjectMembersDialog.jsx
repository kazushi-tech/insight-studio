import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { platformApi } from '../../api/platform'
import { useModalDialog } from '../../hooks/useModalDialog'

const ROLE_LABELS = {
  project_editor: 'レポート作成・質問',
  project_viewer: '閲覧・共有のみ',
  workspace_owner: '契約所有者',
  workspace_admin: '企業管理者',
}

function operationKey() {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `project-invite:${id}`
}

export default function ProjectMembersDialog({ project, onClose }) {
  const busyRef = useRef(false)
  const [members, setMembers] = useState([])
  const [pending, setPending] = useState([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('project_viewer')
  const [state, setState] = useState('loading')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [messageTone, setMessageTone] = useState('status')

  function requestClose() {
    if (busyRef.current) return
    if (email.trim() && !window.confirm('入力中の招待先を破棄して閉じますか？')) return
    onClose()
  }

  const { dialogRef, initialFocusRef: closeRef } = useModalDialog(requestClose)

  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  const load = useCallback(async () => {
    setState('loading')
    setMessage('')
    setMessageTone('status')
    try {
      const response = await platformApi.listProjectMembers(project.id)
      setMembers(Array.isArray(response.members) ? response.members : [])
      setState('ready')
    } catch {
      setState('error')
      setMessage('メンバー一覧を確認できませんでした。')
      setMessageTone('error')
    }
  }, [project.id])

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  async function invite() {
    const normalized = email.trim().toLowerCase()
    if (!normalized) return
    setBusy(true)
    setMessage('')
    setMessageTone('status')
    try {
      const response = await platformApi.createProjectMember(project.id, {
        email: normalized,
        role,
      }, { idempotencyKey: operationKey() })
      setPending((current) => [...current, response.invitation || { email: normalized, role, status: 'pending' }])
      setEmail('')
      setMessage('招待メールを送信しました。参加が完了すると一覧へ反映されます。')
      setMessageTone('success')
    } catch {
      setMessage('招待を送信できませんでした。メールアドレスと権限を確認してください。')
      setMessageTone('error')
    } finally {
      setBusy(false)
    }
  }

  async function remove(member) {
    if (!window.confirm('このメンバーの案件アクセスを削除しますか？')) return
    setBusy(true)
    setMessage('')
    setMessageTone('status')
    try {
      await platformApi.deleteProjectMember(project.id, member.app_user_id)
      await load()
      setMessage('案件へのアクセスを削除しました。')
      setMessageTone('success')
    } catch {
      setMessage('アクセスを削除できませんでした。最後の所有者やご自身は削除できません。')
      setMessageTone('error')
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[110] grid place-items-center overflow-y-auto bg-black/45 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="project-members-title" className="my-auto w-full max-w-xl overflow-hidden rounded-2xl bg-surface-container-lowest shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-outline-variant/30 px-5 py-5 sm:px-7">
          <div>
            <p className="text-xs font-black tracking-[0.16em] text-primary">MEMBERS</p>
            <h2 id="project-members-title" className="mt-1 text-2xl font-extrabold text-on-surface japanese-text">{project.name}のメンバー</h2>
          </div>
          <button ref={closeRef} type="button" onClick={requestClose} disabled={busy} className="grid size-11 place-items-center rounded-xl text-on-surface-variant hover:bg-surface-container" aria-label="閉じる"><span className="material-symbols-outlined" aria-hidden="true">close</span></button>
        </header>

        <div className="max-h-[68vh] space-y-6 overflow-y-auto px-5 py-6 sm:px-7">
          <div className="rounded-2xl bg-surface-container p-4">
            <h3 className="text-sm font-extrabold text-on-surface">メールで招待</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_11rem]">
              <label className="text-xs font-bold text-on-surface-variant">メールアドレス<input name="member-email" type="email" autoComplete="email" spellCheck={false} value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-outline-variant/50 bg-surface px-3 text-sm text-on-surface outline-none focus:border-primary" placeholder="member@example.com" /></label>
              <label className="text-xs font-bold text-on-surface-variant">できること<select name="member-role" value={role} onChange={(event) => setRole(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-outline-variant/50 bg-surface px-3 text-sm text-on-surface outline-none focus:border-primary"><option value="project_viewer">閲覧・共有のみ</option><option value="project_editor">レポート作成・質問</option></select></label>
            </div>
            <button type="button" onClick={invite} disabled={busy || !email.trim()} className="mt-3 min-h-11 rounded-xl bg-primary px-5 text-sm font-black text-on-primary disabled:opacity-50">{busy ? '送信しています…' : '招待を送信'}</button>
          </div>

          {message && state !== 'error' && <p role={messageTone === 'error' ? 'alert' : 'status'} className={`rounded-xl px-4 py-3 text-sm font-bold japanese-text ${messageTone === 'error' ? 'bg-error-container text-on-error-container' : 'bg-secondary-container text-on-secondary-container'}`}>{message}</p>}

          {pending.length > 0 && <section aria-labelledby="pending-invites-title"><h3 id="pending-invites-title" className="text-sm font-extrabold text-on-surface">参加待ち</h3><ul className="mt-2 space-y-2">{pending.map((item, index) => <li key={`${item.email || item.email_hash || 'pending'}-${index}`} className="rounded-xl border border-dashed border-outline-variant px-4 py-3 text-sm text-on-surface-variant"><span className="font-bold">招待を送信済み</span><span className="ml-2 text-xs">{ROLE_LABELS[item.role] || '閲覧・共有のみ'}</span></li>)}</ul></section>}

          <section aria-labelledby="active-members-title">
            <h3 id="active-members-title" className="text-sm font-extrabold text-on-surface">参加済み</h3>
            {state === 'loading' && <p role="status" className="mt-3 text-sm text-on-surface-variant">確認しています…</p>}
            {state === 'error' && <div className="mt-3"><p role="alert" className="text-sm font-bold text-error">{message}</p><button type="button" onClick={load} className="mt-2 min-h-11 rounded-xl bg-primary px-4 text-sm font-bold text-on-primary">もう一度確認</button></div>}
            {state === 'ready' && members.length === 0 && <p className="mt-3 rounded-xl bg-surface-container px-4 py-4 text-sm text-on-surface-variant">参加済みメンバーはまだいません。</p>}
            {state === 'ready' && members.length > 0 && <ul className="mt-3 divide-y divide-outline-variant/30">{members.map((member) => <li key={member.app_user_id} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-on-surface">{member.display_name || 'メンバー'}</p><p className="truncate text-xs text-on-surface-variant">{ROLE_LABELS[member.role] || member.role}</p></div><button type="button" onClick={() => remove(member)} disabled={busy} className="min-h-11 shrink-0 rounded-xl px-3 text-sm font-bold text-error hover:bg-error-container disabled:opacity-50" aria-label={`${member.display_name || 'メンバー'}のアクセスを削除`}>削除</button></li>)}</ul>}
          </section>
        </div>
      </section>
    </div>,
    document.body,
  )
}
