import { useState, useRef, useEffect } from 'react'
import { createCase, updateCase, getCaseBqStatus } from '../api/adsInsights'

const STEPS = [
  { label: '基本情報', icon: 'description' },
  { label: 'BigQuery接続', icon: 'database' },
  { label: 'セキュリティ & 確認', icon: 'verified_user' },
]

function StepIndicator({ current, steps }) {
  return (
    <div className="flex items-center gap-2 px-8 py-4 bg-surface-container-low/50">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-2 flex-1">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
            i < current ? 'bg-secondary text-on-secondary' :
            i === current ? 'bg-primary text-on-primary' :
            'bg-surface-container-high text-on-surface-variant'
          }`}>
            {i < current ? (
              <span className="material-symbols-outlined text-sm">check</span>
            ) : (
              i + 1
            )}
          </div>
          <span className={`text-xs font-bold hidden sm:block ${
            i === current ? 'text-primary' : 'text-on-surface-variant'
          }`}>
            {step.label}
          </span>
          {i < steps.length - 1 && (
            <div className={`flex-1 h-0.5 rounded-full mx-2 ${
              i < current ? 'bg-secondary' : 'bg-surface-container-high'
            }`} />
          )}
        </div>
      ))}
    </div>
  )
}

export default function ProjectFormModal({ onClose, project }) {
  const isEdit = !!project
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [form, setForm] = useState({
    case_id: project?.case_id || '',
    name: project?.name || '',
    description: project?.description || '',
    dataset_id: project?.dataset_id || '',
    password: '',
    status: project?.status || 'active',
  })

  // BQ test state
  const [bqTesting, setBqTesting] = useState(false)
  const [bqResult, setBqResult] = useState(null)

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

  const handleBqTest = async () => {
    if (!form.case_id || !form.dataset_id) return
    setBqTesting(true)
    setBqResult(null)
    try {
      const result = await getCaseBqStatus(form.case_id)
      setBqResult(result)
    } catch (e) {
      setBqResult({ error: e.message })
    } finally {
      setBqTesting(false)
    }
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const payload = { ...form }
      if (!payload.dataset_id) payload.dataset_id = null
      if (!payload.password) payload.password = null

      if (isEdit) {
        await updateCase(project.case_id, payload)
      } else {
        await createCase(payload)
      }
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const canGoNext = () => {
    if (step === 0) return form.name.trim() && form.case_id.trim()
    return true
  }

  const renderStep0 = () => (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider japanese-text">プロジェクト名 *</label>
        <input
          className="w-full bg-surface-container-low rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary transition-all text-sm outline-none"
          placeholder="例: ベタビット広告分析"
          value={form.name}
          onChange={(e) => updateField('name', e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider japanese-text">案件ID *</label>
        <input
          className="w-full bg-surface-container-low rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary transition-all text-sm outline-none font-mono"
          placeholder="例: betabit_ads"
          value={form.case_id}
          onChange={(e) => updateField('case_id', e.target.value)}
          disabled={isEdit}
        />
        {isEdit && <p className="text-[10px] text-on-surface-variant">案件IDは変更できません</p>}
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider japanese-text">説明</label>
        <textarea
          className="w-full bg-surface-container-low rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary transition-all text-sm outline-none resize-none"
          placeholder="プロジェクトの目的や概要を記入..."
          rows={3}
          value={form.description}
          onChange={(e) => updateField('description', e.target.value)}
        />
      </div>

      {isEdit && (
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider japanese-text">ステータス</label>
          <select
            className="bg-surface-container-low rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary transition-all text-sm outline-none"
            value={form.status}
            onChange={(e) => updateField('status', e.target.value)}
          >
            <option value="active">アクティブ</option>
            <option value="inactive">停止中</option>
          </select>
        </div>
      )}
    </div>
  )

  const renderStep1 = () => (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider japanese-text">Dataset ID</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-primary-container text-lg">database</span>
          <input
            className="w-full bg-surface-container-low rounded-lg pl-10 pr-4 py-3 focus:ring-2 focus:ring-primary transition-all text-sm outline-none font-mono"
            placeholder="analytics_XXXXXXXXX"
            value={form.dataset_id}
            onChange={(e) => { updateField('dataset_id', e.target.value); setBqResult(null) }}
          />
        </div>
      </div>

      {form.dataset_id && form.case_id && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={handleBqTest}
            disabled={bqTesting}
            className="flex items-center gap-2 px-5 py-2.5 bg-secondary-container text-on-secondary-container rounded-lg text-sm font-bold hover:brightness-110 transition-all disabled:opacity-50"
          >
            {bqTesting ? (
              <>
                <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                接続テスト中...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-sm">cable</span>
                接続テスト
              </>
            )}
          </button>

          {bqResult && (
            <div className={`p-4 rounded-lg ${bqResult.connected ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
              {bqResult.connected ? (
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-emerald-600">check_circle</span>
                  <span className="text-sm font-bold text-emerald-700">
                    接続成功 — {bqResult.tables_found}テーブル検出
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-red-600">error</span>
                  <span className="text-sm font-bold text-red-700">
                    {bqResult.error || '接続に失敗しました'}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="bg-surface-container-low/50 rounded-lg p-4">
        <p className="text-xs text-on-surface-variant japanese-text">
          <span className="material-symbols-outlined text-xs align-middle mr-1">info</span>
          BigQuery接続は後から設定することも可能です。スキップして次に進めます。
        </p>
      </div>
    </div>
  )

  const renderStep2 = () => (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider japanese-text">パスワード</label>
        <input
          type="password"
          className="w-full bg-surface-container-low rounded-lg px-4 py-3 focus:ring-2 focus:ring-primary transition-all text-sm outline-none"
          placeholder={isEdit ? '変更する場合のみ入力' : 'パスワードを設定（任意）'}
          value={form.password}
          onChange={(e) => updateField('password', e.target.value)}
        />
      </div>

      {/* Summary */}
      <div className="space-y-3">
        <h4 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider japanese-text">入力内容の確認</h4>
        <div className="bg-surface-container-low rounded-lg divide-y divide-outline-variant/10">
          <div className="flex justify-between px-4 py-3">
            <span className="text-xs text-on-surface-variant">プロジェクト名</span>
            <span className="text-sm font-bold">{form.name || '—'}</span>
          </div>
          <div className="flex justify-between px-4 py-3">
            <span className="text-xs text-on-surface-variant">案件ID</span>
            <span className="text-sm font-mono">{form.case_id || '—'}</span>
          </div>
          <div className="flex justify-between px-4 py-3">
            <span className="text-xs text-on-surface-variant">説明</span>
            <span className="text-sm max-w-[250px] truncate">{form.description || '—'}</span>
          </div>
          <div className="flex justify-between px-4 py-3">
            <span className="text-xs text-on-surface-variant">Dataset ID</span>
            <span className="text-sm font-mono">{form.dataset_id || '未設定'}</span>
          </div>
          <div className="flex justify-between px-4 py-3">
            <span className="text-xs text-on-surface-variant">パスワード</span>
            <span className="text-sm">{form.password ? '●●●●●●' : isEdit ? '変更なし' : '未設定'}</span>
          </div>
          {isEdit && (
            <div className="flex justify-between px-4 py-3">
              <span className="text-xs text-on-surface-variant">ステータス</span>
              <span className="text-sm font-bold">{form.status === 'active' ? 'アクティブ' : '停止中'}</span>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-error-container/30 text-error text-sm font-bold">
          {error}
        </div>
      )}
    </div>
  )

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-on-background/40 backdrop-blur-[8px] p-4" onClick={onClose}>
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-form-title"
        className="bg-surface-container-lowest w-full max-w-[600px] rounded-[12px] shadow-2xl overflow-hidden flex flex-col border border-white/20"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-8 pt-8 pb-2">
          <h2 id="project-form-title" className="text-2xl font-headline font-bold text-primary leading-tight japanese-text">
            {isEdit ? 'プロジェクト編集' : '新規プロジェクト作成'}
          </h2>
          <p className="text-on-surface-variant text-sm mt-1 japanese-text">
            {isEdit ? 'プロジェクト情報を更新します。' : 'ステップに沿って情報を入力してください。'}
          </p>
        </div>

        {/* Step Indicator */}
        <StepIndicator current={step} steps={STEPS} />

        {/* Content */}
        <div className="px-8 py-6 overflow-y-auto flex-1 max-h-[50vh]">
          {step === 0 && renderStep0()}
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
        </div>

        {/* Footer */}
        <div className="px-8 py-6 bg-surface-container-low flex justify-between items-center">
          <div>
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                className="px-6 py-2.5 text-on-surface-variant font-bold text-xs uppercase tracking-widest hover:bg-surface-container-high rounded-lg transition-colors"
              >
                戻る
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="px-6 py-2.5 text-on-surface-variant font-bold text-xs uppercase tracking-widest hover:bg-surface-container-high rounded-lg transition-colors">
              キャンセル
            </button>
            {step < 2 ? (
              <button
                type="button"
                onClick={() => setStep(step + 1)}
                disabled={!canGoNext()}
                className="button-primary px-8 py-2.5 text-xs uppercase tracking-widest disabled:opacity-50"
              >
                次へ
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || !canGoNext()}
                className="button-primary px-8 py-2.5 text-xs uppercase tracking-widest disabled:opacity-50"
              >
                {submitting ? '送信中...' : isEdit ? '更新' : 'プロジェクトを作成'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
