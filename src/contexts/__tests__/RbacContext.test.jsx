import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RbacProvider, useRbac } from '../RbacContext'

const authState = vi.hoisted(() => ({
  user: null,
  isAdsAuthenticated: false,
}))

vi.mock('../AuthContext', () => ({
  useAuth: () => authState,
}))

function Probe() {
  const { isAuthenticated } = useRbac()
  return <output aria-label="rbac-authenticated">{String(isAuthenticated)}</output>
}

describe('RbacContext authentication invariant', () => {
  beforeEach(() => {
    authState.user = null
    authState.isAdsAuthenticated = false
  })

  it('does not authenticate a restored user without valid ads authentication', () => {
    authState.user = { role: 'case_user', case_id: 'stale-case' }

    render(<RbacProvider><Probe /></RbacProvider>)

    expect(screen.getByLabelText('rbac-authenticated')).toHaveTextContent('false')
  })

  it('authenticates only when the user and the auth bridge are both valid', () => {
    authState.user = { role: 'member', workspace_role: 'workspace_member' }
    authState.isAdsAuthenticated = true

    render(<RbacProvider><Probe /></RbacProvider>)

    expect(screen.getByLabelText('rbac-authenticated')).toHaveTextContent('true')
  })
})
