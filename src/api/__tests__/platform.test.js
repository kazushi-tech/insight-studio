import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createPlatformApi, setPlatformAuthTokenProvider } from '../platform'


function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  localStorage.clear()
  setPlatformAuthTokenProvider(null)
})

describe('platform API client', () => {
  it('uses the same-origin Ads service and a memory-only token provider', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true, projects: [] }))
    const api = createPlatformApi({
      fetchImpl,
      getToken: async () => 'short-lived-clerk-token',
    })
    await api.listProjects()
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/ads/projects')
    expect(options.headers.get('Authorization')).toBe('Bearer short-lived-clerk-token')
    expect(localStorage.getItem('is_ads_token')).toBeNull()
  })

  it('requires idempotency for project and invitation creation', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    const api = createPlatformApi({ fetchImpl })
    expect(() => api.createProject({ name: 'Site' })).toThrow(TypeError)
    expect(() => api.createProjectMember('p1', { email: 'a@example.com' })).toThrow(TypeError)

    await api.createProject(
      { name: 'Site', slug: 'site' },
      { idempotencyKey: 'project-create-1' },
    )
    expect(fetchImpl.mock.calls[0][1].headers.get('Idempotency-Key')).toBe('project-create-1')
  })

  it('encodes resource identifiers and normalizes safe errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      ok: false,
      error: {
        code: 'not_found',
        category: 'resource',
        user_message: '見つかりませんでした。',
        retryable: false,
        request_id: 'req-1',
        field_errors: [],
      },
    }, 404))
    const api = createPlatformApi({ fetchImpl })
    await expect(api.getProject('project/a')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
      message: '見つかりませんでした。',
    })
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/ads/projects/project%2Fa')
  })
})
