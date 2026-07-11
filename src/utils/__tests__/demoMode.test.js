import { describe, expect, it } from 'vitest'
import { shouldShowDemoMode } from '../demoMode'

describe('shouldShowDemoMode', () => {
  it('allows an authenticated case user to use either verified demo flag', () => {
    expect(shouldShowDemoMode({
      isAdsAuthenticated: true,
      user: { role: 'case_user', is_demo: true },
      currentCase: { is_demo: false },
    })).toBe(true)
    expect(shouldShowDemoMode({
      isAdsAuthenticated: true,
      user: { role: 'case_user', is_demo: false },
      currentCase: { is_demo: true },
    })).toBe(true)
  })

  it('rejects admin, unauthenticated, and normal customer display state', () => {
    expect(shouldShowDemoMode({
      isAdsAuthenticated: true,
      user: { role: 'admin', is_demo: true },
      currentCase: { is_demo: true },
    })).toBe(false)
    expect(shouldShowDemoMode({
      isAdsAuthenticated: false,
      user: { role: 'case_user', is_demo: true },
      currentCase: { is_demo: true },
    })).toBe(false)
    expect(shouldShowDemoMode({
      isAdsAuthenticated: true,
      user: { role: 'case_user', is_demo: false },
      currentCase: { is_demo: false },
    })).toBe(false)
  })
})
