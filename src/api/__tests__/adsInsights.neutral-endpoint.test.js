import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('adsInsights neutral AI endpoint', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    localStorage.clear()
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

    const { AI_GENERATE_ENDPOINT, neonGenerate, setToken } = await import('../adsInsights')
    setToken('test-token')

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

  it('explains a proxy 502 as an unavailable analysis server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => ({}),
    })))

    const { bqPeriods } = await import('../adsInsights')

    await expect(bqPeriods({
      dataset_id: 'analytics_311324674',
      granularity: 'monthly',
    })).rejects.toThrow('分析サーバーに接続できません')
  })

  it('does not treat a BigQuery configuration error as an expired customer session', async () => {
    const onAuthError = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({
        error: 'bq_credentials_missing',
        message: 'BigQuery認証情報が未設定です。',
      }),
    })))

    const { bqPeriods, setOnAuthError } = await import('../adsInsights')
    setOnAuthError(onAuthError)

    await expect(bqPeriods({ dataset_id: 'analytics_311324674' })).rejects.toThrow('BigQuery認証情報')
    expect(onAuthError).not.toHaveBeenCalled()
  })
})
