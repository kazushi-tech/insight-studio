import { useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { OrganizationSwitcher, SignIn, SignOutButton } from '@clerk/react'
import { useAuth } from '../contexts/AuthContext'
import { loginCase, getCaseTrustToken, warmAdsInsightsBackend } from '../api/adsInsights'
import { salesContactUrl } from './landing/salesContact'
import { normalizeCustomerError } from '../utils/customerErrors'

const CURRENT_CASE_STORAGE_KEY = 'insight-studio-current-case'

const LOGIN_STEPS = [
  '発行されたパスワードを入力',
  '対象サイトと見る期間を確認',
  'まとめからレポートを読む',
]

const CLERK_LOGIN_STEPS = [
  '招待されたメールアドレスで本人確認',
  '契約企業を選択',
  '対象サイトのレポートを確認',
]

function getCaseId(caseItem) {
  return caseItem?.case_id || caseItem?.id || ''
}

function getSavedCaseId() {
  try {
    const saved = localStorage.getItem(CURRENT_CASE_STORAGE_KEY)
    const parsed = saved ? JSON.parse(saved) : null
    return getCaseId(parsed)
  } catch {
    return ''
  }
}

export default function Login() {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pendingTotp, setPendingTotp] = useState(null)
  const [totpCode, setTotpCode] = useState('')
  const errorRef = useRef(null)
  const {
    authMode,
    clerkLoaded,
    clerkSignedIn,
    loading: authLoading,
    loginAds,
    loginWithCase,
    platformSyncError,
    clerkOrganizationId,
    user,
  } = useAuth()

  useEffect(() => {
    if (authMode === 'legacy') void warmAdsInsightsBackend()
  }, [authMode])

  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])

  if (user) {
    return <Navigate to={user.role === 'case_user' ? '/ads/wizard' : '/'} replace />
  }

  if (authMode === 'clerk') {
    return (
      <div className="min-h-dvh overflow-x-hidden bg-[#f8f6ef] text-on-surface">
        <header className="border-b border-primary/10 bg-white/85 backdrop-blur-lg">
          <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-5 sm:px-8">
            <Link to="/lp" className="font-headline text-xl font-extrabold text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">Insight Studio</Link>
            <Link to="/lp#product-preview" className="inline-flex min-h-11 items-center rounded-full border border-primary/15 bg-white px-4 py-2 text-sm font-bold text-primary hover:bg-primary/5">画面サンプルを見る</Link>
          </div>
        </header>
        <main className="mx-auto grid w-full max-w-6xl items-stretch gap-5 px-4 py-8 sm:px-8 sm:py-12 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-8 lg:py-16">
          <aside className="order-2 relative overflow-hidden rounded-[2rem] bg-primary p-7 text-white shadow-[0_24px_70px_rgba(0,57,37,0.15)] sm:p-10 lg:order-1 lg:p-12" aria-label="ログイン後の流れ">
            <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '30px 30px' }} />
            <div className="relative z-10">
              <p className="text-xs font-bold tracking-widest text-primary-fixed-dim">ご利用中のお客様へ</p>
              <h1 className="mt-4 text-pretty font-headline text-3xl font-extrabold leading-tight sm:text-4xl">本人確認から、<br className="hidden sm:block" />安全にレポートへ。</h1>
              <p className="mt-5 max-w-md text-sm leading-7 text-primary-fixed/80 sm:text-base">パスワードをInsight Studioへ保存せず、招待された企業と案件の権限を毎回確認します。</p>
              <ol className="mt-8 space-y-4">{CLERK_LOGIN_STEPS.map((step, index) => <li key={step} className="flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-3"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-gold text-sm font-black text-[#3f2c00]">{index + 1}</span><span className="text-sm font-bold sm:text-base">{step}</span></li>)}</ol>
            </div>
          </aside>
          <section className="order-1 grid min-h-[36rem] place-items-center rounded-[2rem] bg-white p-5 shadow-[0_18px_55px_rgba(31,39,34,0.08)] ring-1 ring-primary/10 sm:p-8 lg:order-2" aria-label="ログイン">
            {!clerkLoaded && <p role="status" className="flex items-center gap-3 text-sm font-bold text-on-surface-variant"><span className="material-symbols-outlined animate-spin motion-reduce:animate-none" aria-hidden="true">progress_activity</span>安全なログインを準備しています</p>}
            {clerkLoaded && !clerkSignedIn && (
              <SignIn
                routing="hash"
                fallbackRedirectUrl="/"
                appearance={{
                  variables: { colorPrimary: '#003925', borderRadius: '0.75rem', fontFamily: 'Manrope, sans-serif' },
                  elements: { cardBox: 'shadow-none', card: 'shadow-none' },
                }}
              />
            )}
            {clerkLoaded && clerkSignedIn && (
              <div className="w-full max-w-md text-center">
                <h2 className="text-2xl font-extrabold text-on-surface">契約企業を確認しています</h2>
                <p role={platformSyncError ? 'alert' : 'status'} className="mt-3 text-sm leading-7 text-on-surface-variant">{authLoading ? '招待とサイトの権限を安全に照合しています。' : platformSyncError ? '契約企業を確認できませんでした。企業を選び直すか、管理者へお問い合わせください。' : 'まもなく画面へ移動します。'}</p>
                {platformSyncError && <div className="mt-6 space-y-4"><OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/onboarding" /><Link to="/onboarding" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-black text-on-primary">{clerkOrganizationId ? 'この企業の登録を続ける' : '契約企業を設定する'}</Link><SignOutButton><button type="button" className="min-h-11 rounded-xl px-4 text-sm font-bold text-primary underline">別のメールアドレスでログイン</button></SignOutButton></div>}
              </div>
            )}
          </section>
        </main>
      </div>
    )
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

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
        setError(result?.ok === false ? '認証コードが正しくありません' : '認証に失敗しました')
      } catch (err) {
        setError(err?.status === 401 ? '認証コードが正しくありません' : normalizeCustomerError(err).body)
      } finally {
        setLoading(false)
      }
      return
    }

    if (!password) {
      setError('パスワードを入力してください')
      return
    }

    setLoading(true)
    setError('')
    try {
      const savedCaseId = getSavedCaseId()
      const caseResult = await loginCase('', password, {
        deviceTrustToken: getCaseTrustToken(savedCaseId),
      }).catch((err) => {
        if (err?.status === 401 || err?.status === 404) return null
        throw err
      })

      if (caseResult?.ok) {
        loginWithCase(caseResult)
        return
      }
      if (caseResult?.totp_required) {
        setPendingTotp({ caseId: caseResult.case_id, caseName: caseResult.name, password })
        return
      }

      const adminResult = await loginAds(password).catch((err) => {
        if (err?.status === 401) return null
        throw err
      })
      if (adminResult) return

      setError('パスワードが正しくありません')
    } catch (err) {
      setError(err?.status === 401 ? 'パスワードが正しくありません' : normalizeCustomerError(err, { body: 'ログインできませんでした。少し待って、もう一度お試しください。' }).body)
    } finally {
      setLoading(false)
    }
  }

  const handleTotpCancel = () => {
    setPendingTotp(null)
    setTotpCode('')
    setError('')
  }

  return (
    <div className="min-h-dvh overflow-x-hidden bg-[#f8f6ef] text-on-surface">
      <header className="border-b border-primary/10 bg-white/85 backdrop-blur-lg">
        <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link to="/lp" className="font-headline text-xl font-extrabold text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
            Insight Studio
          </Link>
          <Link to="/lp#product-preview" className="inline-flex min-h-11 items-center rounded-full border border-primary/15 bg-white px-4 py-2 text-sm font-bold text-primary transition-colors hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary sm:px-5">
            画面サンプルを見る
          </Link>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-6xl items-stretch gap-5 px-4 py-8 sm:px-8 sm:py-12 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-8 lg:py-16">
        <aside className="order-2 relative overflow-hidden rounded-[2rem] bg-primary p-7 text-white shadow-[0_24px_70px_rgba(0,57,37,0.15)] sm:p-10 lg:order-1 lg:p-12" aria-labelledby="login-guide-title">
          <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '30px 30px' }} />
          <div className="relative z-10">
            <p className="text-xs font-bold tracking-widest text-primary-fixed-dim">ご利用中のお客様へ</p>
            <h1 id="login-guide-title" className="mt-4 text-pretty font-headline text-3xl font-extrabold leading-tight sm:text-4xl">
              サイトの状態を、<br className="hidden sm:block" />見る順番から確認。
            </h1>
            <p className="mt-5 max-w-md text-sm leading-7 text-primary-fixed/80 sm:text-base">
              ログイン後は、対象サイト、見る期間、レポートの順に案内します。難しい設定名を覚える必要はありません。
            </p>
            <ol className="mt-8 space-y-4">
              {LOGIN_STEPS.map((step, index) => (
                <li key={step} className="flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-gold text-sm font-black text-[#3f2c00]">{index + 1}</span>
                  <span className="text-sm font-bold sm:text-base">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </aside>

        <section className="order-1 rounded-[2rem] bg-white p-6 shadow-[0_18px_55px_rgba(31,39,34,0.08)] ring-1 ring-primary/10 sm:p-10 lg:order-2 lg:p-12" aria-labelledby="login-title">
          <div className="mx-auto max-w-md">
            <p className="text-sm font-bold text-primary">顧客用ログイン</p>
            <h2 id="login-title" className="mt-2 text-3xl font-extrabold tracking-tight text-on-surface">
              {pendingTotp ? '認証コードを入力' : 'ご利用画面へログイン'}
            </h2>
            <p className="mt-3 text-sm leading-7 text-on-surface-variant">
              {pendingTotp
                ? `${pendingTotp.caseName} の認証アプリに表示される6桁のコードを入力してください。`
                : '導入時に発行されたパスワードを入力してください。対象サイトは自動で選ばれます。'}
            </p>

            {error && (
              <div ref={errorRef} id="login-error" role="alert" aria-live="assertive" tabIndex={-1} className="mt-6 flex items-start gap-3 rounded-2xl border border-error/20 bg-error-container/45 px-4 py-3 text-sm text-on-error-container outline-none">
                <span className="material-symbols-outlined text-xl" aria-hidden="true">error</span>
                <span>{error}</span>
              </div>
            )}

            <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
              {!pendingTotp ? (
                <div className="space-y-2">
                  <label htmlFor="login-password" className="block text-sm font-bold text-on-surface">
                    パスワード
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined pointer-events-none absolute inset-y-0 left-4 flex items-center text-xl text-on-surface-variant" aria-hidden="true">lock</span>
                    <input
                      id="login-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? 'login-error' : undefined}
                      spellCheck={false}
                      placeholder="発行されたパスワード"
                      value={password}
                      onChange={(event) => { setPassword(event.target.value); setError('') }}
                      disabled={loading}
                      className="h-13 w-full rounded-xl border border-outline-variant/55 bg-[#fbfbf7] py-3 pl-12 pr-12 text-base text-on-surface outline-none transition-[border-color,box-shadow,background-color] placeholder:text-on-surface-variant/60 focus:border-primary/35 focus:bg-white focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-wait disabled:opacity-60"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
                      className="absolute inset-y-0 right-2 grid min-w-11 place-items-center rounded-lg text-on-surface-variant transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <span className="material-symbols-outlined text-xl" aria-hidden="true">{showPassword ? 'visibility_off' : 'visibility'}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <label htmlFor="login-totp" className="block text-sm font-bold text-on-surface">認証コード（6桁）</label>
                  <input
                    id="login-totp"
                    name="totp-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? 'login-error' : undefined}
                    pattern="\d{6}"
                    maxLength={6}
                    placeholder="123456"
                    value={totpCode}
                    onChange={(event) => { setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }}
                    disabled={loading}
                    className="h-13 w-full rounded-xl border border-outline-variant/55 bg-[#fbfbf7] px-4 py-3 text-center font-mono text-xl tracking-[0.35em] text-on-surface outline-none transition-[border-color,box-shadow,background-color] focus:border-primary/35 focus:bg-white focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-wait disabled:opacity-60"
                  />
                  <button type="button" onClick={handleTotpCancel} className="min-h-11 text-sm font-bold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-primary">
                    パスワード入力に戻る
                  </button>
                </div>
              )}

              <button type="submit" disabled={loading} className="inline-flex min-h-13 w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-base font-extrabold text-on-primary shadow-lg shadow-primary/15 transition-[transform,opacity] hover:-translate-y-0.5 hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary disabled:translate-y-0 disabled:cursor-wait disabled:opacity-55">
                {loading ? (
                  <>
                    <span className="material-symbols-outlined animate-spin" aria-hidden="true">progress_activity</span>
                    {pendingTotp ? '認証中…' : 'ログイン中…'}
                  </>
                ) : (
                  <>
                    {pendingTotp ? '認証する' : 'ログインする'}
                    <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
                  </>
                )}
              </button>
            </form>

            <div className="mt-8 border-t border-outline-variant/40 pt-6 text-center">
              <p className="text-sm text-on-surface-variant">パスワードをお持ちでない場合</p>
              <a href={salesContactUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center gap-1 font-bold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-primary">
                導入条件を相談する
                <span className="material-symbols-outlined text-lg" aria-hidden="true">open_in_new</span>
              </a>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
