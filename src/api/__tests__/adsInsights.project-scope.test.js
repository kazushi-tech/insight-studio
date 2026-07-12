import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('Ads Insights project scope transport', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('sends the selected project only in the scope header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, periods: [] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const api = await import('../adsInsights')
    api.setAuthTokenProvider(async () => 'short-lived-token')

    await api.bqPeriods({
      granularity: 'monthly',
      dataset_id: 'managed',
      project_ref: 'project-a',
    })

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/ads/bq/periods?granularity=monthly')
    expect(options.headers.get('X-Insight-Project')).toBe('project-a')
    expect(options.headers.get('Authorization')).toBe('Bearer short-lived-token')
  })

  it('does not duplicate project scope or managed dataset in a report body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const api = await import('../adsInsights')

    await api.bqGenerateBatch({
      project_ref: 'project-a',
      dataset_id: 'managed',
      query_types: ['pv'],
      period: '2026-07',
    })

    const options = fetchMock.mock.calls[0][1]
    expect(options.headers.get('X-Insight-Project')).toBe('project-a')
    expect(JSON.parse(options.body)).toEqual({
      query_types: ['pv'],
      period: '2026-07',
    })
  })

  it('scopes AI questions without exposing the project in the request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const api = await import('../adsInsights')

    await api.neonGenerate({
      project_ref: 'project-a',
      provider: 'anthropic',
      message: '要点を教えて',
    })

    const options = fetchMock.mock.calls[0][1]
    expect(options.headers.get('X-Insight-Project')).toBe('project-a')
    expect(JSON.parse(options.body)).toEqual({
      provider: 'anthropic',
      message: '要点を教えて',
    })
  })
})
