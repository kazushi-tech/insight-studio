import { useEffect, useState } from 'react'
import { CreateOrganization, useOrganization } from '@clerk/react'
import { Link, Navigate, useNavigate } from 'react-router-dom'

import { platformApi } from '../api/platform'
import { useAuth } from '../contexts/AuthContext'

function ClerkOnboarding() {
  const navigate = useNavigate()
  const { organization, isLoaded } = useOrganization()
  const { refreshPlatformSession, user } = useAuth()
  const [busy, setBusy] = useState(false)
  const [bootstrapped, setBootstrapped] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (bootstrapped && user) navigate('/settings?onboarding=1', { replace: true })
  }, [bootstrapped, navigate, user])

  if (user) return <Navigate to="/settings?onboarding=1" replace />

  async function connectWorkspace() {
    if (!organization) return
    setBusy(true)
    setMessage('')
    try {
      await platformApi.bootstrap({
        workspace_name: organization.name,
        workspace_slug: organization.slug || undefined,
      })
      setBootstrapped(true)
      refreshPlatformSession()
    } catch {
      setMessage('契約企業を登録できませんでした。招待または企業選択を確認してください。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-dvh bg-[#f8f6ef] px-4 py-8 text-on-surface sm:px-6 sm:py-12">
      <div className="mx-auto max-w-3xl space-y-6">
        <Link to="/login" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold text-primary hover:bg-primary/5"><span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>ログインへ戻る</Link>
        <header>
          <p className="text-xs font-black tracking-[0.16em] text-primary">GET STARTED</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight japanese-text">契約企業を設定</h1>
          <p className="mt-3 text-sm leading-7 text-on-surface-variant japanese-text">企業ごとに案件・レポート・請求を分けます。個人用の領域へ顧客データは保存しません。</p>
        </header>

        {!isLoaded && <p role="status" className="rounded-2xl bg-white p-6 text-sm font-bold text-on-surface-variant">企業情報を確認しています…</p>}
        {isLoaded && !organization && (
          <section className="grid place-items-center rounded-2xl bg-white p-5 shadow-sm sm:p-8" aria-label="企業を作成">
            <CreateOrganization routing="hash" afterCreateOrganizationUrl="/onboarding" skipInvitationScreen={false} />
          </section>
        )}
        {isLoaded && organization && (
          <section className="rounded-2xl bg-white p-6 shadow-sm sm:p-8" aria-labelledby="selected-organization-title">
            <h2 id="selected-organization-title" className="text-xl font-extrabold japanese-text">{organization.name}</h2>
            <p className="mt-2 text-sm leading-7 text-on-surface-variant japanese-text">この企業をInsight Studioの契約企業として登録します。登録後、規約確認と利用方法の選択へ進みます。</p>
            {message && <p role="alert" className="mt-4 rounded-xl bg-error-container px-4 py-3 text-sm font-bold text-on-error-container">{message}</p>}
            <button type="button" onClick={connectWorkspace} disabled={busy || bootstrapped} className="mt-5 min-h-11 rounded-xl bg-primary px-6 text-sm font-black text-on-primary disabled:opacity-50">{busy || bootstrapped ? '安全に登録しています…' : 'この企業で続ける'}</button>
          </section>
        )}
      </div>
    </main>
  )
}

export default function Onboarding() {
  const { authMode, clerkLoaded, clerkSignedIn } = useAuth()
  if (authMode !== 'clerk') return <Navigate to="/login" replace />
  if (!clerkLoaded) return <main className="grid min-h-dvh place-items-center"><h1 className="sr-only">契約企業の設定</h1><p role="status">安全なログインを準備しています</p></main>
  if (!clerkSignedIn) return <Navigate to="/login" replace />
  return <ClerkOnboarding />
}
