import { beforeEach, describe, expect, it, vi } from 'vitest'


describe('Market Lens short-lived token provider', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('adds a provider token without writing a legacy JWT', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, items: [] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const api = await import('../marketLens')
    api.setMarketLensAuthTokenProvider(async () => 'clerk-market-token')

    await api.getScans()

    const headers = fetchMock.mock.calls[0][1].headers
    expect(headers.Authorization).toBe('Bearer clerk-market-token')
    expect(localStorage.getItem('is_ads_token')).toBeNull()
  })
})
