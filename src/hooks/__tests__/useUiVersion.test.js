import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolveUiVersion } from '../useUiVersion'

describe('useUiVersion (resolveUiVersion)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  afterEach(() => {
    window.localStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  it('defaults to v2 when no query or storage set', () => {
    expect(resolveUiVersion()).toBe('v2')
  })

  it('reads ?ui=v2 from URL', () => {
    window.history.replaceState({}, '', '/?ui=v2')
    expect(resolveUiVersion()).toBe('v2')
  })

  it('ignores invalid ?ui values (falls back to v2 default)', () => {
    window.history.replaceState({}, '', '/?ui=v99')
    expect(resolveUiVersion()).toBe('v2')
  })

  it('falls back to localStorage when query missing', () => {
    window.localStorage.setItem('reportUiVersion', 'v2')
    expect(resolveUiVersion()).toBe('v2')
  })

  it('query wins over localStorage', () => {
    window.localStorage.setItem('reportUiVersion', 'v2')
    window.history.replaceState({}, '', '/?ui=v1')
    expect(resolveUiVersion()).toBe('v1')
  })
})
