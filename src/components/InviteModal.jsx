import { useState, useRef, useEffect, useCallback } from 'react'
import { getProjectMembers, inviteMember, removeMember } from '../api/adsInsights'

const PERMISSION_LABELS = {
  owner: '所有者',
  admin: '管理者',
  edit: '編集可',
  view: '閲覧のみ',
}

const PERMISSION_OPTIONS = ['view', 'edit']

export default function InviteModal({ onClose, project }) {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitePermission, setInvitePermission] = useState('view')
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState(null)
  const modalRef = useRef(null)

  const projectId = project?.case_id

  const fetchMembers = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const data = await getProjectMembers(projectId)
      setMembers(Array.isArray(data) ? data : data.members || [])
    } catch {
      // API may not be available yet — show empty
      setMembers([])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchMembers()
  }, [fetchMembers])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return
      const modal = modalRef.current
      if (!modal) return
      const focusable = modal.querySelectorAll('button, input, select')
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus() }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    modalRef.current?.querySelector('input')?.focus()
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !projectId) return
    setInviting(true)
    setError(null)
    try {
      await inviteMember(projectId, inviteEmail.trim(), invitePermission)
      setInviteEmail('')
      await fetchMembers()
    } catch (e) {
      setError(e.message)
    } finally {
      setInviting(false)
    }
  }

  const handleRemove = async (userId) => {
    if (!projectId) return
    setError(null)
    try {
      await removeMember(projectId, userId)
      await fetchMembers()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-on-background/40 backdrop-blur-[8px] p-4" onClick={onClose}>
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-modal-title"
        className="bg-surface-container-lowest w-full max-w-lg rounded-[12px] shadow-2xl overflow-hidden border border-outline-variant/15"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-8 pt-8 pb-4 flex justify-between items-start">
          <div>
            <h2 id="invite-modal-title" className="text-2xl font-headline font-bold text-primary tracking-tight japanese-text">アクセス共有</h2>
            <p className="text-on-surface-variant text-sm mt-1 japanese-text">
              プロジェクト「{project?.name || '—'}」へのアクセス権限を管理します。
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-surface-container rounded-full transition-colors">
            <span className="material-symbols-outlined text-on-surface-variant">close</span>
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-8 mb-2 p-3 rounded-lg bg-error-container/30 text-error text-sm font-bold">
            {error}
          </div>
        )}

        {/* Invitation Form */}
        <div className="px-8 py-6 bg-surface-container-low/50">
          <label className="block text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-3 japanese-text">新規メンバーを招待</label>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <input
                className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-lg px-4 py-2.5 focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm transition-all"
                placeholder="メールアドレスを入力"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
              />
            </div>
            <div className="w-full sm:w-32 relative">
              <select
                className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-lg px-3 py-2.5 pr-8 focus:ring-1 focus:ring-primary focus:border-primary outline-none text-sm appearance-none cursor-pointer"
                value={invitePermission}
                onChange={(e) => setInvitePermission(e.target.value)}
              >
                {PERMISSION_OPTIONS.map((p) => (
                  <option key={p} value={p}>{PERMISSION_LABELS[p]}</option>
                ))}
              </select>
              <span className="material-symbols-outlined absolute right-2 top-2.5 pointer-events-none text-on-surface-variant text-lg">expand_more</span>
            </div>
            <button
              type="button"
              onClick={handleInvite}
              disabled={inviting || !inviteEmail.trim()}
              className="bg-primary-container text-white px-6 py-2.5 rounded-lg text-sm font-bold uppercase tracking-wider hover:brightness-110 active:scale-95 transition-all whitespace-nowrap disabled:opacity-50"
            >
              {inviting ? '招待中...' : '招待'}
            </button>
          </div>
        </div>

        {/* Current Members */}
        <div className="px-8 py-6">
          <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-4 japanese-text">
            現在のメンバー ({members.length})
          </h3>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <span className="material-symbols-outlined animate-spin text-primary">progress_activity</span>
              <span className="ml-2 text-sm text-on-surface-variant">読み込み中...</span>
            </div>
          ) : members.length === 0 ? (
            <p className="text-sm text-on-surface-variant text-center py-6 japanese-text">メンバーはまだ登録されていません</p>
          ) : (
            <div className="space-y-4 max-h-72 overflow-y-auto pr-2">
              {members.map((member) => (
                <div key={member.user_id || member.userId} className="flex items-center justify-between group">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full overflow-hidden bg-surface-container-high ring-2 ring-primary/5 flex items-center justify-center text-sm font-bold text-primary">
                      {(member.display_name || member.displayName || member.email || '?').charAt(0)}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-on-surface japanese-text">{member.display_name || member.displayName || member.email}</div>
                      <div className="text-xs text-on-surface-variant">{member.email}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-tight ${
                      member.permission === 'owner' || member.role === 'admin'
                        ? 'bg-secondary-container text-on-secondary-container'
                        : 'bg-surface-variant text-on-surface-variant'
                    }`}>
                      {PERMISSION_LABELS[member.permission || member.role] || member.permission || member.role}
                    </span>
                    {member.permission !== 'owner' && member.role !== 'admin' && (
                      <button
                        onClick={() => handleRemove(member.user_id || member.userId)}
                        className="p-1.5 text-outline opacity-0 group-hover:opacity-100 hover:text-error hover:bg-error-container/20 rounded-full transition-all"
                      >
                        <span className="material-symbols-outlined text-lg">delete</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-8 py-6 bg-surface-container flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-2 rounded-lg text-sm font-semibold text-on-surface-variant hover:bg-surface-variant transition-colors">
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
