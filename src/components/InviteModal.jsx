import { useState, useRef, useEffect } from 'react'

const MOCK_MEMBERS = [
  { userId: 'u1', displayName: '佐藤 健一', email: 'sato.k@insight-studio.jp', permission: 'owner' },
  { userId: 'u2', displayName: '田中 瑞希', email: 'm.tanaka@design.com', permission: 'edit' },
  { userId: 'u3', displayName: 'Alex Rivers', email: 'alex.r@studio.net', permission: 'view' },
]

const PERMISSION_LABELS = {
  owner: '所有者',
  edit: '編集可',
  view: '閲覧のみ',
}

const PERMISSION_OPTIONS = ['view', 'edit']

export default function InviteModal({ onClose, project }) {
  const [members, setMembers] = useState(MOCK_MEMBERS)
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitePermission, setInvitePermission] = useState('view')
  const modalRef = useRef(null)

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

  const handleInvite = () => {
    if (!inviteEmail.trim()) return
    setMembers((prev) => [
      ...prev,
      { userId: `u${Date.now()}`, displayName: inviteEmail.split('@')[0], email: inviteEmail, permission: invitePermission },
    ])
    setInviteEmail('')
  }

  const handleRemove = (userId) => {
    setMembers((prev) => prev.filter((m) => m.userId !== userId))
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
              プロジェクト「{project?.name || 'Project Alpha'}」へのアクセス権限を管理します。
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-surface-container rounded-full transition-colors">
            <span className="material-symbols-outlined text-on-surface-variant">close</span>
          </button>
        </div>

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
              className="bg-primary-container text-white px-6 py-2.5 rounded-lg text-sm font-bold uppercase tracking-wider hover:brightness-110 active:scale-95 transition-all whitespace-nowrap"
            >
              招待
            </button>
          </div>
        </div>

        {/* Current Members */}
        <div className="px-8 py-6">
          <h3 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-4 japanese-text">
            現在のメンバー ({members.length})
          </h3>
          <div className="space-y-4 max-h-72 overflow-y-auto pr-2">
            {members.map((member) => (
              <div key={member.userId} className="flex items-center justify-between group">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-surface-container-high ring-2 ring-primary/5 flex items-center justify-center text-sm font-bold text-primary">
                    {member.displayName.charAt(0)}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-on-surface japanese-text">{member.displayName}</div>
                    <div className="text-xs text-on-surface-variant">{member.email}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-tight ${
                    member.permission === 'owner'
                      ? 'bg-secondary-container text-on-secondary-container'
                      : 'bg-surface-variant text-on-surface-variant'
                  }`}>
                    {PERMISSION_LABELS[member.permission]}
                  </span>
                  {member.permission !== 'owner' && (
                    <button
                      onClick={() => handleRemove(member.userId)}
                      className="p-1.5 text-outline opacity-0 group-hover:opacity-100 hover:text-error hover:bg-error-container/20 rounded-full transition-all"
                    >
                      <span className="material-symbols-outlined text-lg">delete</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 py-6 bg-surface-container flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-2 rounded-lg text-sm font-semibold text-on-surface-variant hover:bg-surface-variant transition-colors">
            キャンセル
          </button>
          <button onClick={onClose} className="button-primary px-8 py-2 text-sm uppercase tracking-wider">
            完了
          </button>
        </div>
      </div>
    </div>
  )
}
