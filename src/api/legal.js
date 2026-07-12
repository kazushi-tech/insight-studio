import { normalizeApiError } from './apiError'

const BASE = '/api/ads/legal'
let tokenProvider = null

export function setLegalAuthTokenProvider(provider) {
  tokenProvider = typeof provider === 'function' ? provider : null
}

export class LegalApiError extends Error {
  constructor(problem, status, body) {
    super(problem.message)
    this.name = 'LegalApiError'
    this.status = status
    this.body = body
    this.code = problem.code
    this.category = problem.category
    this.retryable = problem.retryable
    this.requestId = problem.requestId
  }
}

function key(value) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (normalized.length < 8 || normalized.length > 255) {
    throw new TypeError('idempotencyKey must contain between 8 and 255 characters')
  }
  return normalized
}

function segment(value, label) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) throw new TypeError(`${label} is required`)
  return encodeURIComponent(normalized)
}

export function createLegalApi({
  fetchImpl = (...args) => globalThis.fetch(...args),
  getToken = null,
  baseUrl = BASE,
} = {}) {
  const root = String(baseUrl || '').replace(/\/+$/, '')

  async function authorizedFetch(path, { body, headers: extraHeaders, ...options } = {}) {
    const headers = new Headers(extraHeaders || {})
    headers.set('Accept', 'application/json')
    if (body !== undefined) headers.set('Content-Type', 'application/json')
    const provider = typeof getToken === 'function' ? getToken : tokenProvider
    const token = provider ? await provider() : null
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return fetchImpl(`${root}${path}`, {
      ...options,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  }

  async function throwResponseError(response) {
    const errorBody = await response.json().catch(() => ({}))
    const problem = normalizeApiError(
      errorBody,
      response.status,
      '手続きを完了できませんでした。少し待って再試行してください。',
    )
    throw new LegalApiError(problem, response.status, errorBody)
  }

  async function request(path, options = {}) {
    const response = await authorizedFetch(path, options)
    if (!response.ok) {
      await throwResponseError(response)
    }
    return response.json()
  }

  return {
    getDocuments() {
      return request('/documents', { method: 'GET' })
    },
    getAcceptanceStatus() {
      return request('/acceptance-status', { method: 'GET' })
    },
    acceptDocument(documentKey, version, { idempotencyKey } = {}) {
      return request('/acceptances', {
        method: 'POST',
        headers: { 'Idempotency-Key': key(idempotencyKey) },
        body: { document_key: documentKey, version },
      })
    },
    requestDataExport(scope, { idempotencyKey } = {}) {
      return request('/data-exports', {
        method: 'POST',
        headers: { 'Idempotency-Key': key(idempotencyKey) },
        body: { scope },
      })
    },
    listDataExports() {
      return request('/data-exports', { method: 'GET' })
    },
    getDataExport(jobId) {
      return request(`/data-exports/${segment(jobId, 'jobId')}`, { method: 'GET' })
    },
    async downloadDataExport(jobId, format = 'json') {
      if (format !== 'json' && format !== 'csv') throw new TypeError('format must be json or csv')
      const response = await authorizedFetch(
        `/data-exports/${segment(jobId, 'jobId')}/download?format=${format}`,
        { method: 'GET' },
      )
      if (!response.ok) await throwResponseError(response)
      const disposition = response.headers.get('content-disposition') || ''
      const filenameMatch = disposition.match(/filename="?([^";]+)"?/i)
      return {
        blob: await response.blob(),
        filename: filenameMatch?.[1] || `insight-studio-data.${format}`,
      }
    },
    listDeletionRequests() {
      return request('/deletion-requests', { method: 'GET' })
    },
    requestDeletion(scope, { idempotencyKey } = {}) {
      return request('/deletion-requests', {
        method: 'POST',
        headers: { 'Idempotency-Key': key(idempotencyKey) },
        body: { scope },
      })
    },
    cancelDeletion(requestId, { idempotencyKey } = {}) {
      return request(`/deletion-requests/${segment(requestId, 'requestId')}/cancel`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key(idempotencyKey) },
      })
    },
  }
}

export const legalApi = createLegalApi()
