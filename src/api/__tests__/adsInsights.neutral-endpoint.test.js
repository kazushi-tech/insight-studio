import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('adsInsights neutral AI endpoint', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    localStorage.clear()
    localStorage.setItem('is_ads_token', 'test-token')
  })

  it('sends neonGenerate requests to /api/insights/neon/generate', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        answer_markdown: '## 結論\n中立APIで返りました。',
        parse_status: 'json',
        fallback_used: false,
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { AI_GENERATE_ENDPOINT, neonGenerate } = await import('../adsInsights')

    const result = await neonGenerate({
      provider: 'google',
      model: 'gemini-2.5-flash',
      message: '5月のPV数で一番高かった日はいつ？原因は何だと思う？',
    }, 'AIza-test-key')

    expect(AI_GENERATE_ENDPOINT).toBe('/api/insights/neon/generate')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/insights/neon/generate')
    expect(url).not.toContain('/api/ads/neon/generate')
    expect(options.method).toBe('POST')
    expect(options.headers.get('Authorization')).toBe('Bearer test-token')
    expect(options.headers.get('X-Gemini-API-Key')).toBe('AIza-test-key')
    expect(result.answer_markdown).toContain('中立API')
  })
})
