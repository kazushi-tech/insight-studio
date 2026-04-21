import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getCasesPublic, loginCase, getCaseTrustToken } from '../api/adsInsights'

// Dark theme tokens (isolated from app's light theme)
const DK = {
  bg: '#0c0c1f',
  card: '#1A1A2E',
  input: '#333348',
  inputFocus: '#37374d',
  text: '#e2e0fc',
  textMuted: '#d2c5b1',
  outline: '#9a8f7d',
  gold: '#f2c35b',
  goldDark: '#d4a843',
  onGold: '#402d00',
  error: '#ffb4ab',
  errorBg: 'rgba(147,0,10,0.20)',
  ring: '#f2c35b',
}

export default function Login() {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // TOTP step: pending case awaiting 6-digit code
  const [pendingTotp, setPendingTotp] = useState(null) // { caseId, caseName, password }
  const [totpCode, setTotpCode] = useState('')
  const { loginAds, loginWithCase, user } = useAuth()

  // Prefetch active cases for parallel login attempts
  const [activeCases, setActiveCases] = useState([])
  useEffect(() => {
    getCasesPublic()
      .then((data) => setActiveCases(data.cases || (Array.isArray(data) ? data : [])))
      .catch(() => setActiveCases([]))
  }, [])

  // Already logged in — case_user は直接 wizard へ、admin はホームへ
  if (user) {
    return <Navigate to={user.role === 'case_user' ? '/ads/wizard' : '/'} replace />
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    // Step 2: TOTP submission
    if (pendingTotp) {
      const trimmed = totpCode.trim()
      if (!/^\d{6}$/.test(trimmed)) {
        setError('6桁の認証コードを入力してください')
        return
      }
      setLoading(true)
      setError('')
      try {
        const result = await loginCase(pendingTotp.caseId, pendingTotp.password, {
          totpCode: trimmed,
          deviceTrustToken: getCaseTrustToken(pendingTotp.caseId),
        })
        if (result?.ok) {
          loginWithCase(result)
          return
        }
        setError(result?.error || '認証コードが正しくありません')
      } catch (err) {
        setError(err?.message || '認証コードが正しくありません')
      } finally {
        setLoading(false)
      }
      return
    }

    // Step 1: password submission
    if (!password) {
      setError('パスワードを入力してください')
      return
    }
    setLoading(true)
    setError('')
    try {
      // Admin を先に試す（hit すれば 401 ゼロ）
      const adminResult = await loginAds(password).catch(() => null)
      if (adminResult) {
        // loginAds が成功 → AuthContext で処理済み
        return
      }

      // device trust token がある case を優先して直列試行
      const sortedCases = [...activeCases].sort((a, b) => {
        const aId = a.case_id || a.id
        const bId = b.case_id || b.id
        const aHas = getCaseTrustToken(aId) ? 1 : 0
        const bHas = getCaseTrustToken(bId) ? 1 : 0
        return bHas - aHas
      })

      for (const c of sortedCases) {
        const caseId = c.case_id || c.id
        const r = await loginCase(caseId, password, { deviceTrustToken: getCaseTrustToken(caseId) }).catch(() => null)
        if (r?.ok) {
          loginWithCase(r)
          return
        }
        if (r?.totp_required) {
          setPendingTotp({ caseId: r.case_id, caseName: r.name, password })
          return
        }
      }

      setError('パスワードが正しくありません')
    } catch {
      setError('ログインに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const handleTotpCancel = () => {
    setPendingTotp(null)
    setTotpCode('')
    setError('')
  }

  const hasError = !!error
  const inputRing = hasError ? '1px solid #ffb4ab' : 'none'
  const inputRingFocus = hasError ? `0 0 0 1px #ffb4ab` : `0 0 0 1px ${DK.ring}`

  return (
    <div
      className="min-h-screen flex flex-col overflow-x-hidden relative"
      style={{ backgroundColor: DK.bg, color: DK.text, fontFamily: "'Manrope', sans-serif" }}
    >
      {/* Decorative Blur Gradients */}
      <div
        className="fixed top-0 -left-[10%] w-[40%] h-full opacity-40 blur-[120px] pointer-events-none"
        style={{ backgroundColor: DK.card }}
      />
      <div
        className="fixed top-0 -right-[10%] w-[40%] h-full opacity-40 blur-[120px] pointer-events-none"
        style={{ backgroundColor: DK.card }}
      />

      {/* Header */}
      <header className="flex justify-center items-center py-8 w-full z-50">
        <div className="text-2xl font-bold tracking-tighter" style={{ color: DK.gold }}>
          Insight Studio
        </div>
      </header>

      {/* Main */}
      <main className="flex-grow flex items-center justify-center px-6 relative z-10">
        <div
          className="w-full max-w-[420px] rounded-2xl p-10 flex flex-col items-center"
          style={{ backgroundColor: DK.card }}
        >
          {/* Logo */}
          <div className="mb-10 text-center">
            <h1
              className="text-3xl font-extrabold tracking-tight mb-2"
              style={{ color: DK.gold, letterSpacing: '-0.02em' }}
            >
              Insight Studio
            </h1>
            <p
              className="text-xs uppercase font-medium"
              style={{ color: DK.textMuted, letterSpacing: '0.2em' }}
            >
              AD OPS &amp; ANALYSIS
            </p>
          </div>

          {/* Error Banner */}
          {hasError && (
            <div
              className="w-full rounded-xl px-4 py-3 mb-6 flex items-center gap-3"
              style={{ backgroundColor: DK.errorBg }}
            >
              <span className="material-symbols-outlined text-[20px]" style={{ color: DK.error }}>
                error
              </span>
              <span className="text-sm" style={{ color: DK.error }}>
                {error}
              </span>
            </div>
          )}

          <form className="w-full space-y-6" onSubmit={handleSubmit}>
            {!pendingTotp ? (
              <>
                {/* Password Field */}
                <div className="space-y-2">
                  <label
                    className="block text-xs font-semibold ml-1"
                    style={{ color: DK.textMuted }}
                  >
                    パスワード
                  </label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none transition-colors"
                      style={{ color: DK.textMuted }}
                    >
                      <span className="material-symbols-outlined text-[20px]">lock</span>
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setError('') }}
                      disabled={loading}
                      autoFocus
                      className="w-full h-12 pl-12 pr-12 border-none rounded-xl transition-all duration-200 outline-none"
                      style={{
                        backgroundColor: DK.input,
                        color: DK.text,
                        border: inputRing,
                      }}
                      onFocus={(e) => { e.target.style.boxShadow = inputRingFocus; e.target.style.backgroundColor = DK.inputFocus }}
                      onBlur={(e) => { e.target.style.boxShadow = 'none'; e.target.style.backgroundColor = DK.input }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-4 flex items-center transition-colors"
                      style={{ color: DK.textMuted }}
                      onMouseEnter={(e) => e.currentTarget.style.color = DK.gold}
                      onMouseLeave={(e) => e.currentTarget.style.color = DK.textMuted}
                      tabIndex={-1}
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        {showPassword ? 'visibility_off' : 'visibility'}
                      </span>
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* TOTP step */}
                <div className="space-y-2">
                  <label
                    className="block text-xs font-semibold ml-1"
                    style={{ color: DK.textMuted }}
                  >
                    認証コード（6桁） — {pendingTotp.caseName}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="\d{6}"
                    maxLength={6}
                    placeholder="123456"
                    value={totpCode}
                    onChange={(e) => {
                      setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                      setError('')
                    }}
                    disabled={loading}
                    autoFocus
                    className="w-full h-12 px-4 border-none rounded-xl text-lg tracking-[0.4em] font-mono outline-none"
                    style={{
                      backgroundColor: DK.input,
                      color: DK.text,
                      border: inputRing,
                    }}
                    onFocus={(e) => { e.target.style.boxShadow = inputRingFocus; e.target.style.backgroundColor = DK.inputFocus }}
                    onBlur={(e) => { e.target.style.boxShadow = 'none'; e.target.style.backgroundColor = DK.input }}
                  />
                  <p className="text-xs pt-1" style={{ color: DK.textMuted }}>
                    Google Authenticator 等に表示されている 6 桁のコードを入力してください。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleTotpCancel}
                  className="text-xs underline"
                  style={{ color: DK.textMuted }}
                >
                  パスワード入力に戻る
                </button>
              </>
            )}

            {/* Login Button */}
            <div className="pt-4">
              <button
                type="submit"
                disabled={loading}
                className="w-full h-12 font-bold rounded-xl flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] transition-all shadow-lg relative"
                style={{
                  background: `linear-gradient(135deg, ${DK.gold}, ${DK.goldDark})`,
                  color: DK.onGold,
                  opacity: loading ? 0.5 : 1,
                  boxShadow: `0 10px 25px ${DK.bg}80`,
                }}
              >
                {loading ? (
                  <>
                    <span
                      className="inline-block w-5 h-5 rounded-full border-2 animate-spin"
                      style={{ borderColor: `${DK.onGold}40`, borderTopColor: DK.onGold }}
                    />
                    {pendingTotp ? '認証中...' : 'ログイン中...'}
                  </>
                ) : (
                  <>
                    {pendingTotp ? '認証' : 'ログイン'}
                    <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}
