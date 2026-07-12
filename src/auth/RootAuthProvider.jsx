import { lazy, Suspense } from 'react'

import { AuthProvider } from '../contexts/AuthContext'
import { resolveRootAuthMode } from './rootAuthMode'

const ClerkRuntime = lazy(() => import('./ClerkRuntime'))
const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || ''

function AuthLoading() {
  return (
    <div className="grid min-h-dvh place-items-center bg-surface px-6" role="status" aria-live="polite">
      <div className="flex items-center gap-3 text-sm font-bold text-on-surface-variant">
        <span className="material-symbols-outlined animate-spin motion-reduce:animate-none" aria-hidden="true">progress_activity</span>
        安全なログインを準備しています
      </div>
    </div>
  )
}

function AuthConfigurationError() {
  return (
    <main className="grid min-h-dvh place-items-center bg-surface px-6" id="main-content" tabIndex={-1}>
      <section className="w-full max-w-lg rounded-2xl bg-surface-container-lowest p-8 text-center shadow-sm" role="alert">
        <span className="material-symbols-outlined text-4xl text-error" aria-hidden="true">lock</span>
        <h1 className="mt-4 text-balance text-2xl font-extrabold text-on-surface">ログイン機能を準備できませんでした</h1>
        <p className="mt-3 text-pretty text-sm leading-7 text-on-surface-variant">
          設定を確認しています。時間をおいて再度開くか、Insight Studioの運用窓口へお問い合わせください。
        </p>
      </section>
    </main>
  )
}

export default function RootAuthProvider({ children }) {
  const mode = resolveRootAuthMode({ key: publishableKey, isProduction: import.meta.env.PROD })
  if (mode === 'configuration_error') return <AuthConfigurationError />
  if (mode === 'legacy_development') return <AuthProvider>{children}</AuthProvider>
  return (
    <Suspense fallback={<AuthLoading />}>
      <ClerkRuntime publishableKey={publishableKey}>{children}</ClerkRuntime>
    </Suspense>
  )
}
