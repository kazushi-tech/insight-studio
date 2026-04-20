import { useState, useEffect, useRef } from 'react'

export default function CaseAuthModal({ caseInfo, onClose, onAuthenticate }) {
  const [step, setStep] = useState('password') // 'password' | 'totp'
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)
  const modalRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [step])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return

      const modal = modalRef.current
      if (!modal) return
      const focusable = modal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handlePasswordSubmit = async () => {
    if (!password.trim()) {
      setError('パスワードを入力してください')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const caseId = caseInfo.id || caseInfo.case_id
      const result = await onAuthenticate(caseId, password)
      if (result?.status === 'totp_required') {
        setStep('totp')
        setLoading(false)
        return
      }
      onClose()
    } catch (e) {
      setError(e.message || '認証に失敗しました')
      setLoading(false)
    }
  }

  const handleTotpSubmit = async () => {
    const trimmed = totpCode.trim()
    if (!/^\d{6}$/.test(trimmed)) {
      setError('6桁の認証コードを入力してください')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const caseId = caseInfo.id || caseInfo.case_id
      const result = await onAuthenticate(caseId, password, { totpCode: trimmed })
      if (result?.status === 'totp_required') {
        setError('認証コードが正しくありません')
        setLoading(false)
        return
      }
      onClose()
    } catch (e) {
      setError(e.message || '認証に失敗しました')
      setLoading(false)
    }
  }

  const handleSubmit = () => {
    if (step === 'password') handlePasswordSubmit()
    else handleTotpSubmit()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSubmit()
    }
  }

  const handleBack = () => {
    setStep('password')
    setTotpCode('')
    setError(null)
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="case-auth-title"
        className="bg-surface-container-lowest rounded-xl shadow-lg w-[400px] p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 id="case-auth-title" className="text-lg font-bold japanese-text">
            {step === 'password' ? '案件の認証' : '2要素認証'}
          </h3>
          <button
            onClick={onClose}
            className="text-on-surface-variant hover:text-primary transition-colors"
            aria-label="閉じる"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="space-y-2">
          <p className="text-sm text-on-surface-variant japanese-text">
            {step === 'password'
              ? '以下の案件にアクセスするにはパスワードが必要です。'
              : 'Google Authenticator 等に表示されている 6 桁の認証コードを入力してください。'}
          </p>
          <div className="flex items-center gap-2 bg-surface-container rounded-lg px-4 py-3">
            <span className="material-symbols-outlined text-on-surface-variant">folder</span>
            <span className="font-medium japanese-text">{caseInfo?.name || '案件'}</span>
          </div>
        </div>

        {step === 'password' ? (
          <div className="space-y-2">
            <label className="text-sm font-bold text-on-surface-variant japanese-text">
              パスワード
            </label>
            <input
              ref={inputRef}
              type="password"
              className="w-full bg-surface-container-low rounded-xl py-3 px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-secondary"
              placeholder="パスワードを入力"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setError(null)
              }}
              onKeyDown={handleKeyDown}
            />
            {error && <p className="text-xs text-error japanese-text">{error}</p>}
          </div>
        ) : (
          <div className="space-y-2">
            <label className="text-sm font-bold text-on-surface-variant japanese-text">
              認証コード（6桁）
            </label>
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              className="w-full bg-surface-container-low rounded-xl py-3 px-4 text-lg tracking-[0.4em] font-mono outline-none focus-visible:ring-2 focus-visible:ring-secondary"
              placeholder="123456"
              value={totpCode}
              onChange={(e) => {
                setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                setError(null)
              }}
              onKeyDown={handleKeyDown}
            />
            {error && <p className="text-xs text-error japanese-text">{error}</p>}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          {step === 'totp' && (
            <button
              onClick={handleBack}
              disabled={loading}
              className="px-5 py-2 text-on-surface-variant hover:text-primary font-bold text-sm transition-colors disabled:opacity-50"
            >
              戻る
            </button>
          )}
          <button
            onClick={onClose}
            className="px-5 py-2 text-on-surface-variant hover:text-primary font-bold text-sm transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-5 py-2 bg-primary text-on-primary rounded-xl font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50"
          >
            {loading ? '認証中...' : '認証'}
          </button>
        </div>
      </div>
    </div>
  )
}
