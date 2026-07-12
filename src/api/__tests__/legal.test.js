import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createLegalApi, setLegalAuthTokenProvider } from '../legal'


function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  localStorage.clear()
  setLegalAuthTokenProvider(null)
})

describe('legal API client', () => {
  it('uses canonical same-origin routes and memory-only auth', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ ok: true, documents: [] }))
    const api = createLegalApi({ fetchImpl, getToken: async () => 'clerk-token' })
    await api.getDocuments()
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/ads/legal/documents')
    expect(options.headers.get('Authorization')).toBe('Bearer clerk-token')
    expect(localStorage.length).toBe(0)
  })

  it('requires idempotency for all writes and encodes deletion IDs', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ ok: true }))
    const api = createLegalApi({ fetchImpl })
    expect(() => api.acceptDocument('terms', '1.0')).toThrow(TypeError)
    expect(() => api.requestDataExport('account')).toThrow(TypeError)
    expect(() => api.requestDeletion('account')).toThrow(TypeError)
    expect(() => api.cancelDeletion('request/1')).toThrow(TypeError)
    await api.cancelDeletion('request/1', { idempotencyKey: 'cancel-request-1' })
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/ads/legal/deletion-requests/request%2F1/cancel')
  })

  it('lists export status and downloads with in-memory authorization', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ ok: true, exports: [] }))
      .mockResolvedValueOnce(new Response('{"scope":"account"}', {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': 'attachment; filename="insight-studio-data-20260712.json"',
        },
      }))
    const api = createLegalApi({ fetchImpl, getToken: async () => 'short-lived-token' })

    await api.listDataExports()
    const download = await api.downloadDataExport('job/1', 'json')

    expect(fetchImpl.mock.calls[0][0]).toBe('/api/ads/legal/data-exports')
    expect(fetchImpl.mock.calls[1][0]).toBe('/api/ads/legal/data-exports/job%2F1/download?format=json')
    expect(fetchImpl.mock.calls[1][1].headers.get('Authorization')).toBe('Bearer short-lived-token')
    expect(download.filename).toBe('insight-studio-data-20260712.json')
    expect(await download.blob.text()).toContain('account')
    expect(localStorage.length).toBe(0)
  })
})
