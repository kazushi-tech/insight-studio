import { normalizeApiError } from './apiError'

let defaultTokenProvider = null
const ADS_API_PREFIX = '/api/ads'

/**
 * Register a short-lived in-memory token source (for example Clerk getToken).
 * This module never reads or writes authentication tokens in localStorage.
 */
export function setProjectReportsAuthTokenProvider(provider) {
  defaultTokenProvider = typeof provider === 'function' ? provider : null
}

export class ProjectReportApiError extends Error {
  constructor(problem, status, body) {
    super(problem.message)
    this.name = 'ProjectReportApiError'
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

function normalizedBaseUrl(value) {
  return typeof value === 'string' ? value.replace(/\/+$/, '') : ''
}

function idempotencyKey(value) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (normalized.length < 8 || normalized.length > 255) {
    throw new TypeError('idempotencyKey must contain between 8 and 255 characters')
  }
  return normalized
}

export function projectReportsUrl(projectRef, { baseUrl = '' } = {}) {
  return `${normalizedBaseUrl(baseUrl)}${ADS_API_PREFIX}/projects/${segment(projectRef, 'projectRef')}/reports`
}

export function projectReportCsvUrl(projectRef, reportId, { baseUrl = '' } = {}) {
  return `${projectReportsUrl(projectRef, { baseUrl })}/${segment(reportId, 'reportId')}/export.csv`
}

export function projectReportQuestionUrl(projectRef, reportId, { baseUrl = '' } = {}) {
  return `${projectReportsUrl(projectRef, { baseUrl })}/${segment(reportId, 'reportId')}/questions`
}

export function publicReportShareUrl(token, { baseUrl = '' } = {}) {
  return `${normalizedBaseUrl(baseUrl)}${ADS_API_PREFIX}/report-shares/${segment(token, 'token')}`
}

async function parseErrorBody(response) {
  try {
    return await response.json()
  } catch {
    return {}
  }
}

export function createProjectReportsApi({
  fetchImpl = (...args) => globalThis.fetch(...args),
  getToken = null,
  baseUrl = '',
} = {}) {
  const root = normalizedBaseUrl(baseUrl)

  async function request(path, { body, headers: extraHeaders, ...options } = {}) {
    const headers = new Headers(extraHeaders || {})
    headers.set('Accept', 'application/json')
    if (body !== undefined) headers.set('Content-Type', 'application/json')

    const token = typeof getToken === 'function' ? await getToken() : null
    if (token) headers.set('Authorization', `Bearer ${token}`)

    const response = await fetchImpl(`${root}${path}`, {
      ...options,
      cache: 'no-store',
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) {
      const errorBody = await parseErrorBody(response)
      const problem = normalizeApiError(
        errorBody,
        response.status,
        `Report API error: ${response.status}`,
      )
      throw new ProjectReportApiError(problem, response.status, errorBody)
    }
    if (response.status === 204) return null
    return response.json()
  }

  function reportsPath(projectRef) {
    return `${ADS_API_PREFIX}/projects/${segment(projectRef, 'projectRef')}/reports`
  }

  async function listProjectReports(projectRef) {
    return request(reportsPath(projectRef), { method: 'GET' })
  }

  async function createProjectReport(projectRef, payload, { idempotencyKey: key } = {}) {
    return request(reportsPath(projectRef), {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey(key) },
      body: payload,
    })
  }

  async function getProjectReport(projectRef, reportId) {
    return request(`${reportsPath(projectRef)}/${segment(reportId, 'reportId')}`, {
      method: 'GET',
    })
  }

  async function askProjectReportQuestion(projectRef, reportId, question) {
    const normalizedQuestion = typeof question === 'string' ? question.trim() : ''
    if (!normalizedQuestion || normalizedQuestion.length > 2_000) {
      throw new TypeError('question must contain between 1 and 2000 characters')
    }
    return request(
      `${reportsPath(projectRef)}/${segment(reportId, 'reportId')}/questions`,
      {
        method: 'POST',
        body: { question: normalizedQuestion },
      },
    )
  }

  async function deleteProjectReport(projectRef, reportId) {
    return request(`${reportsPath(projectRef)}/${segment(reportId, 'reportId')}`, {
      method: 'DELETE',
    })
  }

  async function importProjectReport(projectRef, payload, { idempotencyKey: key } = {}) {
    return request(`${reportsPath(projectRef)}/import`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey(key) },
      body: payload,
    })
  }

  async function createProjectReportShare(
    projectRef,
    reportId,
    { expiresInDays = 7 } = {},
  ) {
    return request(
      `${reportsPath(projectRef)}/${segment(reportId, 'reportId')}/shares`,
      {
        method: 'POST',
        body: { expires_in_days: expiresInDays },
      },
    )
  }

  async function revokeProjectReportShare(projectRef, reportId, shareId) {
    return request(
      `${reportsPath(projectRef)}/${segment(reportId, 'reportId')}/shares/${segment(shareId, 'shareId')}`,
      { method: 'DELETE' },
    )
  }

  async function fetchProjectReportCsv(projectRef, reportId) {
    const path = projectReportCsvUrl(projectRef, reportId)
    const headers = new Headers({ Accept: 'text/csv' })
    const token = typeof getToken === 'function' ? await getToken() : null
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const response = await fetchImpl(`${root}${path}`, {
      method: 'GET',
      cache: 'no-store',
      headers,
    })
    if (!response.ok) {
      const errorBody = await parseErrorBody(response)
      const problem = normalizeApiError(
        errorBody,
        response.status,
        `Report API error: ${response.status}`,
      )
      throw new ProjectReportApiError(problem, response.status, errorBody)
    }
    return response.text()
  }

  async function fetchPublicReportShare(token) {
    const response = await fetchImpl(publicReportShareUrl(token, { baseUrl: root }), {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      headers: new Headers({ Accept: 'application/json' }),
    })
    if (!response.ok) {
      const errorBody = await parseErrorBody(response)
      const problem = normalizeApiError(
        errorBody,
        response.status,
        `Report share API error: ${response.status}`,
      )
      throw new ProjectReportApiError(problem, response.status, errorBody)
    }
    return response.json()
  }

  return {
    listProjectReports,
    createProjectReport,
    getProjectReport,
    askProjectReportQuestion,
    deleteProjectReport,
    importProjectReport,
    createProjectReportShare,
    revokeProjectReportShare,
    fetchProjectReportCsv,
    fetchPublicReportShare,
    projectReportCsvUrl: (projectRef, reportId) => projectReportCsvUrl(
      projectRef,
      reportId,
      { baseUrl: root },
    ),
  }
}

const defaultApi = createProjectReportsApi({
  getToken: () => defaultTokenProvider?.(),
})

export const listProjectReports = (...args) => defaultApi.listProjectReports(...args)
export const createProjectReport = (...args) => defaultApi.createProjectReport(...args)
export const getProjectReport = (...args) => defaultApi.getProjectReport(...args)
export const askProjectReportQuestion = (...args) => defaultApi.askProjectReportQuestion(...args)
export const deleteProjectReport = (...args) => defaultApi.deleteProjectReport(...args)
export const importProjectReport = (...args) => defaultApi.importProjectReport(...args)
export const createProjectReportShare = (...args) => defaultApi.createProjectReportShare(...args)
export const revokeProjectReportShare = (...args) => defaultApi.revokeProjectReportShare(...args)
export const fetchProjectReportCsv = (...args) => defaultApi.fetchProjectReportCsv(...args)
export const fetchPublicReportShare = (...args) => defaultApi.fetchPublicReportShare(...args)
