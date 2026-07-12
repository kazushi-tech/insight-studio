import { normalizeApiError } from './apiError'

const BASE = '/api/ads/billing'
let tokenProvider = null

export function setBillingAuthTokenProvider(provider) {
  tokenProvider = typeof provider === 'function' ? provider : null
}

export class BillingApiError extends Error {
  constructor(problem, status, body) {
    super(problem.message)
    this.name = 'BillingApiError'
    this.status = status
    this.body = body
    this.code = problem.code
    this.category = problem.category
    this.retryable = problem.retryable
    this.requestId = problem.requestId
  }
}

function idempotencyKey(value) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (normalized.length < 8 || normalized.length > 255) {
    throw new TypeError('idempotencyKey must contain between 8 and 255 characters')
  }
  return normalized
}

export function createBillingApi({
  fetchImpl = (...args) => globalThis.fetch(...args),
  getToken = null,
  baseUrl = BASE,
} = {}) {
  const root = String(baseUrl || '').replace(/\/+$/, '')

  async function request(path, { body, headers: extraHeaders, ...options } = {}) {
    const headers = new Headers(extraHeaders || {})
    headers.set('Accept', 'application/json')
    if (body !== undefined) headers.set('Content-Type', 'application/json')
    const provider = typeof getToken === 'function' ? getToken : tokenProvider
    const token = provider ? await provider() : null
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const response = await fetchImpl(`${root}${path}`, {
      ...options,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}))
      const problem = normalizeApiError(
        errorBody,
        response.status,
        '契約情報を更新できませんでした。少し待って再試行してください。',
      )
      throw new BillingApiError(problem, response.status, errorBody)
    }
    return response.json()
  }

  return {
    getSubscription() {
      return request('/subscription', { method: 'GET' })
    },
    createCheckoutSession(planKey, { idempotencyKey: key } = {}) {
      const normalizedPlanKey = typeof planKey === 'string' ? planKey.trim() : ''
      if (!normalizedPlanKey) throw new TypeError('planKey is required')
      return request('/checkout-sessions', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey(key) },
        body: { plan_key: normalizedPlanKey },
      })
    },
    createPortalSession({ idempotencyKey: key } = {}) {
      return request('/portal-sessions', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey(key) },
        body: {},
      })
    },
  }
}

export const billingApi = createBillingApi()
