import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createBillingApi, setBillingAuthTokenProvider } from '../billing'


function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  localStorage.clear()
  setBillingAuthTokenProvider(null)
})
describe('billing API client', () => {
  it('uses canonical hosted billing routes and never accepts a client price id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true, url: 'https://checkout.example/' }))
    const api = createBillingApi({ fetchImpl, getToken: async () => 'clerk-token' })
    await api.createCheckoutSession('starter', { idempotencyKey: 'checkout-request-1' })
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/ads/billing/checkout-sessions')
    expect(options.headers.get('Authorization')).toBe('Bearer clerk-token')
    expect(options.headers.get('Idempotency-Key')).toBe('checkout-request-1')
    expect(JSON.parse(options.body)).toEqual({ plan_key: 'starter' })
    expect(options.body).not.toContain('price')
    expect(localStorage.length).toBe(0)
  })

  it('requires idempotency for checkout and portal', () => {
    const api = createBillingApi({ fetchImpl: vi.fn() })
    expect(() => api.createCheckoutSession('starter')).toThrow(TypeError)
    expect(() => api.createPortalSession()).toThrow(TypeError)
  })
})
