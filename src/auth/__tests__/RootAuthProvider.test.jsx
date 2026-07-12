import { describe, expect, it } from 'vitest'

import { resolveRootAuthMode } from '../rootAuthMode'

describe('RootAuthProvider configuration', () => {
  it('keeps the existing password login available when Clerk is not configured in production', () => {
    expect(resolveRootAuthMode({ key: '', isProduction: true })).toBe('legacy')
  })

  it('uses the same password login fallback in local development', () => {
    expect(resolveRootAuthMode({ key: '', isProduction: false })).toBe('legacy')
  })

  it('uses the external identity provider whenever configured', () => {
    expect(resolveRootAuthMode({ key: 'pk_test_example', isProduction: true })).toBe('clerk')
  })
})
