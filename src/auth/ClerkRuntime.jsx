import { useMemo } from 'react'
import { ClerkProvider, useAuth as useClerkAuth, useOrganization, useUser } from '@clerk/react'

import { AuthProvider } from '../contexts/AuthContext'
import { clerkJaLocalization } from './clerkJaLocalization'

function ClerkSessionBridge({ children }) {
  const auth = useClerkAuth()
  const { user } = useUser()
  const { organization, membership } = useOrganization()
  const clerkSession = useMemo(() => ({
    isLoaded: auth.isLoaded,
    isSignedIn: auth.isSignedIn,
    getToken: auth.getToken,
    signOut: auth.signOut,
    userId: auth.userId,
    organizationId: auth.orgId || organization?.id || null,
    organizationRole: auth.orgRole || membership?.role || null,
    profile: user ? {
      displayName: user.fullName || user.firstName || '',
      primaryEmail: user.primaryEmailAddress?.emailAddress || '',
    } : null,
  }), [
    auth.getToken,
    auth.isLoaded,
    auth.isSignedIn,
    auth.orgId,
    auth.orgRole,
    auth.signOut,
    auth.userId,
    membership?.role,
    organization?.id,
    user,
  ])
  return <AuthProvider clerkSession={clerkSession}>{children}</AuthProvider>
}

export default function ClerkRuntime({ publishableKey, children }) {
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      localization={clerkJaLocalization}
      afterSignOutUrl="/login"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
    >
      <ClerkSessionBridge>{children}</ClerkSessionBridge>
    </ClerkProvider>
  )
}
