import { describe, expect, it, vi } from 'vitest'

import { clientEvent, reportClientEvent } from '../client'


describe('privacy-safe client observability', () => {
  it('drops URL, identity, dataset, token, API key, and exception contents', () => {
    const event = clientEvent('error', 'failed', {
      request_id: 'req-1',
      error_code: 'request_failed',
      url: 'https://private.example/path',
      dataset: 'customer_dataset',
      email: 'person@example.com',
      jwt: 'header.payload.signature',
      api_key: 'secret',
      error: new Error('provider body'),
    })
    expect(event.request_id).toBe('req-1')
    expect(event.error_code).toBe('request_failed')
    expect(event).not.toHaveProperty('url')
    expect(event).not.toHaveProperty('dataset')
    expect(event).not.toHaveProperty('email')
    expect(event).not.toHaveProperty('jwt')
    expect(event).not.toHaveProperty('api_key')
    expect(event).not.toHaveProperty('error')
  })

  it('emits a single JSON line', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    reportClientEvent('error', 'failed', { error_code: 'safe_code' })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(JSON.parse(spy.mock.calls[0][0])).toMatchObject({
      level: 'error',
      event: 'failed',
      error_code: 'safe_code',
    })
    spy.mockRestore()
  })
})
