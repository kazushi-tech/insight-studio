import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { AuthProvider, useAuth } from '../AuthContext'
import { platformApi } from '../../api/platform'

function Probe() {
  const auth = useAuth()
  return (
    <div>
      <span data-testid="mode">{auth.authMode}</span>
      <span data-testid="authenticated">{String(auth.isAdsAuthenticated)}</span>
      <span data-testid="role">{auth.user?.workspace_role || 'none'}</span>
      <button type="button" onClick={auth.logoutAds}>ログアウト</button>
    </div>
  )
}

describe('AuthContext Clerk bridge', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('hydrates only the server-authorized workspace roles and keeps tokens out of storage', async () => {
    localStorage.setItem('is_user', JSON.stringify({ role: 'admin' }))
    const getToken = vi.fn().mockResolvedValue('short-lived-token')
    vi.spyOn(platformApi, 'me').mockResolvedValue({
      user: { id: 'app-user-1', platform_role: null, display_name: '担当者' },
      workspace: { id: 'workspace-1', name: 'Example' },
      workspace_role: 'workspace_admin',
      project_roles: { 'project-1': 'project_editor' },
    })
    render(
      <AuthProvider clerkSession={{
        isLoaded: true,
        isSignedIn: true,
        getToken,
        signOut: vi.fn(),
        profile: { displayName: 'Clerk表示名' },
      }}>
        <Probe />
      </AuthProvider>,
    )

    expect(await screen.findByTestId('role')).toHaveTextContent('workspace_admin')
    expect(screen.getByTestId('mode')).toHaveTextContent('clerk')
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true')
    expect(localStorage.getItem('is_user')).toBeNull()
    expect(localStorage.getItem('is_ads_token')).toBeNull()
  })

  it('signs out through Clerk and clears the in-memory platform session', async () => {
    const signOut = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(platformApi, 'me').mockResolvedValue({
      user: { id: 'u-1' }, workspace: { id: 'w-1' }, workspace_role: 'workspace_owner', project_roles: {},
    })
    const user = userEvent.setup()
    render(<AuthProvider clerkSession={{ isLoaded: true, isSignedIn: true, getToken: vi.fn(), signOut }}><Probe /></AuthProvider>)
    await screen.findByText('workspace_owner')
    await user.click(screen.getByRole('button', { name: 'ログアウト' }))
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false')
  })
})
