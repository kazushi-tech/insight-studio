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

export default function RootAuthProvider({ children }) {
  const mode = resolveRootAuthMode({ key: publishableKey })
  if (mode === 'legacy') return <AuthProvider>{children}</AuthProvider>
  return (
    <Suspense fallback={<AuthLoading />}>
      <ClerkRuntime publishableKey={publishableKey}>{children}</ClerkRuntime>
    </Suspense>
  )
}
