import { beforeEach, describe, expect, it, vi } from 'vitest'


describe('Ads Insights short-lived token provider', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('uses an async in-memory token without persisting it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, cases: [] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const api = await import('../adsInsights')
    api.setAuthTokenProvider(async () => 'clerk-short-lived-token')

    await api.getCases()

    const headers = fetchMock.mock.calls[0][1].headers
    expect(headers.get('Authorization')).toBe('Bearer clerk-short-lived-token')
    expect(localStorage.getItem('is_ads_token')).toBeNull()
  })
})
