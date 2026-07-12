import { normalizeApiError } from './apiError'

const BASE = '/api/ads'
let tokenProvider = null

export function setPlatformAuthTokenProvider(provider) {
  tokenProvider = typeof provider === 'function' ? provider : null
}

export class PlatformApiError extends Error {
  constructor(problem, status, body) {
    super(problem.message)
    this.name = 'PlatformApiError'
    this.status = status
    this.body = body
    this.code = problem.code
    this.category = problem.category
    this.retryable = problem.retryable
    this.requestId = problem.requestId
    this.fieldErrors = problem.fieldErrors
  }
}

function segment(value, label) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) throw new TypeError(`${label} is required`)
  return encodeURIComponent(normalized)
}

function requireIdempotencyKey(value) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (normalized.length < 8 || normalized.length > 255) {
    throw new TypeError('idempotencyKey must contain between 8 and 255 characters')
  }
  return normalized
}

export function createPlatformApi({
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
        '操作を完了できませんでした。少し待って再試行してください。',
      )
      throw new PlatformApiError(problem, response.status, errorBody)
    }
    if (response.status === 204) return null
    return response.json()
  }

  const projectPath = (projectId) => `/projects/${segment(projectId, 'projectId')}`

  return {
    bootstrap(payload) {
      return request('/auth/bootstrap', { method: 'POST', body: payload })
    },
    me() {
      return request('/auth/me', { method: 'GET' })
    },
    listProjects() {
      return request('/projects', { method: 'GET' })
    },
    createProject(payload, { idempotencyKey } = {}) {
      return request('/projects', {
        method: 'POST',
        headers: { 'Idempotency-Key': requireIdempotencyKey(idempotencyKey) },
        body: payload,
      })
    },
    getProject(projectId) {
      return request(projectPath(projectId), { method: 'GET' })
    },
    updateProject(projectId, payload) {
      return request(projectPath(projectId), { method: 'PATCH', body: payload })
    },
    archiveProject(projectId, version) {
      return request(projectPath(projectId), { method: 'DELETE', body: { version } })
    },
    listProjectMembers(projectId) {
      return request(`${projectPath(projectId)}/members`, { method: 'GET' })
    },
    createProjectMember(projectId, payload, { idempotencyKey } = {}) {
      return request(`${projectPath(projectId)}/members`, {
        method: 'POST',
        headers: { 'Idempotency-Key': requireIdempotencyKey(idempotencyKey) },
        body: payload,
      })
    },
    updateProjectMember(projectId, userId, payload) {
      return request(
        `${projectPath(projectId)}/members/${segment(userId, 'userId')}`,
        { method: 'PATCH', body: payload },
      )
    },
    deleteProjectMember(projectId, userId) {
      return request(
        `${projectPath(projectId)}/members/${segment(userId, 'userId')}`,
        { method: 'DELETE' },
      )
    },
    getDataSource(projectId) {
      return request(`${projectPath(projectId)}/data-source`, { method: 'GET' })
    },
    putDataSource(projectId, payload) {
      return request(`${projectPath(projectId)}/data-source`, { method: 'PUT', body: payload })
    },
    deleteDataSource(projectId) {
      return request(`${projectPath(projectId)}/data-source`, { method: 'DELETE' })
    },
    testDataSource(projectId) {
      return request(`${projectPath(projectId)}/data-source/test`, { method: 'POST' })
    },
  }
}

export const platformApi = createPlatformApi()
