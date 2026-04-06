import { useState, useRef, useEffect } from 'react'

export default function ProjectFormModal({ onClose, project }) {
  const isEdit = !!project
  const [form, setForm] = useState({
    id: project?.id || '',
    name: project?.name || '',
    client: project?.client || '',
    bqDatasetId: '',
    emails: project ? [] : [''],
    description: '',
  })
  const modalRef = useRef(null)

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return
      const modal = modalRef.current
      if (!modal) return
      const focusable = modal.querySelectorAll('button, input, textarea, select')
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

  const updateField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  const addEmail = () => setForm((prev) => ({ ...prev, emails: [...prev.emails, ''] }))
  const removeEmail = (idx) => setForm((prev) => ({ ...prev, emails: prev.emails.filter((_, i) => i !== idx) }))
  const updateEmail = (idx, value) => setForm((prev) => {
    const emails = [...prev.emails]
    emails[idx] = value
    return { ...prev, emails }
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    // TODO: call createCase / updateCase API
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-on-background/40 backdrop-blur-[8px] p-4" onClick={onClose}>
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-form-title"
        className="bg-surface-container-lowest w-full max-w-[560px] rounded-[12px] shadow-2xl overflow-hidden flex flex-col border border-white/20"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-8 pt-8 pb-4">
          <h2 id="project-form-title" className="text-2xl font-headline font-bold text-primary leading-tight japanese-text">
            {isEdit ? 'プロジェクト編集' : '新規プロジェクト作成'}
          </h2>
          <p className="text-on-surface-variant text-sm mt-1 japanese-text">
            {isEdit ? 'プロジェクト情報を更新します。' : '分析を開始するための基本情報を入力してください。'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="px-8 py-4 space-y-6 overflow-y-auto flex-1">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider japanese-text">プロジェクトID</label>
                <input
                  className="w-full bg-surface-container-low rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary transition-all text-sm outline-none"
                  placeholder="PRJ-2024-001"
                  value={form.id}
                  onChange={(e) => updateField('id', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider japanese-text">クライアント名</label>
                <input
                  className="w-full bg-surface-container-low rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary transition-all text-sm outline-none"
                  placeholder="株式会社インサイト"
                  value={form.client}
                  onChange={(e) => updateField('client', e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider japanese-text">プロジェクト名</label>
              <input
                className="w-full bg-surface-container-low rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary transition-all text-sm outline-none"
                placeholder="Q3 マーケット分析レポート"
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider japanese-text">BQ Dataset ID</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-primary-container text-lg">database</span>
                <input
                  className="w-full bg-surface-container-low rounded-lg pl-10 pr-4 py-3 focus:ring-2 focus:ring-primary transition-all text-sm outline-none font-mono"
                  placeholder="project_analytics_dataset_v1"
                  value={form.bqDatasetId}
                  onChange={(e) => updateField('bqDatasetId', e.target.value)}
                />
              </div>
            </div>

            {!isEdit && (
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider japanese-text">招待メール</label>
                <div className="flex flex-wrap gap-2 p-2 bg-surface-container-low rounded-lg min-h-[46px]">
                  {form.emails.map((email, idx) => (
                    <span key={idx} className="inline-flex items-center gap-1 bg-primary-container text-on-primary px-3 py-1 rounded-full text-xs">
                      {email || 'email@example.com'}
                      <button type="button" onClick={() => removeEmail(idx)} className="material-symbols-outlined text-[14px] cursor-pointer">close</button>
                    </span>
                  ))}
                  <input
                    className="bg-transparent focus:ring-0 text-sm flex-1 min-w-[120px] outline-none"
                    placeholder="メールアドレスを入力..."
                    onBlur={(e) => { if (e.target.value) { updateEmail(form.emails.length - 1, e.target.value); addEmail() } }}
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider japanese-text">説明</label>
              <textarea
                className="w-full bg-surface-container-low rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary transition-all text-sm outline-none resize-none"
                placeholder="プロジェクトの目的や概要を記入してください..."
                rows={3}
                value={form.description}
                onChange={(e) => updateField('description', e.target.value)}
              />
            </div>
          </div>

          {/* Footer */}
          <div className="px-8 py-6 bg-surface-container-low flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-6 py-2.5 text-on-surface-variant font-bold text-xs uppercase tracking-widest hover:bg-surface-container-high rounded-lg transition-colors">
              キャンセル
            </button>
            <button type="submit" className="button-primary px-8 py-2.5 text-xs uppercase tracking-widest">
              {isEdit ? '更新' : 'プロジェクトを作成'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
