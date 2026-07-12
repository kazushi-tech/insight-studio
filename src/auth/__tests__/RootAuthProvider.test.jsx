import { describe, expect, it } from 'vitest'

import { resolveRootAuthMode } from '../rootAuthMode'

describe('RootAuthProvider configuration', () => {
  it('fails closed when the identity provider is missing in production', () => {
    expect(resolveRootAuthMode({ key: '', isProduction: true })).toBe('configuration_error')
  })

  it('keeps the legacy adapter available only for local development', () => {
    expect(resolveRootAuthMode({ key: '', isProduction: false })).toBe('legacy_development')
  })

  it('uses the external identity provider whenever configured', () => {
    expect(resolveRootAuthMode({ key: 'pk_test_example', isProduction: true })).toBe('clerk')
  })
})
