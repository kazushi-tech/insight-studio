import { afterEach, describe, expect, it, vi } from 'vitest'

import { runAdsGeminiBudgetSmokeTest } from '../adsInsights'

describe('runAdsGeminiBudgetSmokeTest', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('uses Gemini 3.1 Flash-Lite for the budget smoke test', async () => {
    localStorage.setItem('insight-studio-client-id', 'test-client')
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await runAdsGeminiBudgetSmokeTest('AIza-test')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, options] = fetchMock.mock.calls[0]
    expect(JSON.parse(options.body)).toEqual({ model: 'gemini-3.1-flash-lite' })
  })
})
