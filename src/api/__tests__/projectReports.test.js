import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ProjectReportApiError,
  createProjectReportsApi,
  listProjectReports,
  projectReportCsvUrl,
  projectReportQuestionUrl,
  publicReportShareUrl,
  setProjectReportsAuthTokenProvider,
} from '../projectReports'


function jsonResponse(body = { ok: true }, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(String(body)),
  }
}

beforeEach(() => {
  localStorage.clear()
  setProjectReportsAuthTokenProvider(null)
  vi.restoreAllMocks()
})

describe('projectReports API contract', () => {
  it('matches every M-106 route and sends Idempotency-Key', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, reports: [] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, report: { id: 'r1' } }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, report: { id: 'r1' } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: 'deleted' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, report: { id: 'r2' } }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, share: { id: 's1', token: 'once' } }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: 'revoked' }))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue('metric_key,value\nusers,3\n'),
      })
    const api = createProjectReportsApi({
      fetchImpl,
      getToken: vi.fn().mockResolvedValue('short-lived-jwt'),
      baseUrl: 'https://example.test/',
    })

    await api.listProjectReports('project one')
    await api.createProjectReport('project one', { client_entry_id: 'entry-1' }, {
      idempotencyKey: 'create-key-123',
    })
    await api.getProjectReport('project one', 'report/one')
    await api.deleteProjectReport('project one', 'report/one')
    await api.importProjectReport('project one', {
      client_entry_id: 'legacy-1',
      source_schema: 'report.v1',
      report: { schema_version: 'report.v1' },
    }, { idempotencyKey: 'import-key-123' })
    await api.createProjectReportShare('project one', 'report/one', { expiresInDays: 3 })
    await api.revokeProjectReportShare('project one', 'report/one', 'share/one')
    const csv = await api.fetchProjectReportCsv('project one', 'report/one')

    const root = 'https://example.test/api/ads/projects/project%20one/reports'
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      root,
      root,
      `${root}/report%2Fone`,
      `${root}/report%2Fone`,
      `${root}/import`,
      `${root}/report%2Fone/shares`,
      `${root}/report%2Fone/shares/share%2Fone`,
      `${root}/report%2Fone/export.csv`,
    ])
    expect(fetchImpl.mock.calls.map(([, options]) => options.method)).toEqual([
      'GET', 'POST', 'GET', 'DELETE', 'POST', 'POST', 'DELETE', 'GET',
    ])
    expect(fetchImpl.mock.calls[1][1].headers.get('Idempotency-Key')).toBe('create-key-123')
    expect(fetchImpl.mock.calls[4][1].headers.get('Idempotency-Key')).toBe('import-key-123')
    expect(fetchImpl.mock.calls[5][1].body).toBe(JSON.stringify({ expires_in_days: 3 }))
    expect(fetchImpl.mock.calls.every(([, options]) => (
      options.headers.get('Authorization') === 'Bearer short-lived-jwt'
    ))).toBe(true)
    expect(fetchImpl.mock.calls.every(([, options]) => options.cache === 'no-store')).toBe(true)
    expect(csv).toContain('users,3')
    expect(api.projectReportCsvUrl('project one', 'report/one')).toBe(
      `${root}/report%2Fone/export.csv`,
    )
  })

  it('uses the canonical nested API error contract', async () => {
    const api = createProjectReportsApi({
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({
        ok: false,
        error: {
          code: 'report_forbidden',
          category: 'authorization',
          user_message: 'このレポートを操作する権限がありません。',
          retryable: false,
          request_id: 'req_report_1',
          field_errors: { project_id: ['not_allowed'] },
        },
      }, { status: 403 })),
    })

    const error = await api.listProjectReports('p1').catch((caught) => caught)

    expect(error).toBeInstanceOf(ProjectReportApiError)
    expect(error).toMatchObject({
      status: 403,
      code: 'report_forbidden',
      category: 'authorization',
      message: 'このレポートを操作する権限がありません。',
      retryable: false,
      requestId: 'req_report_1',
      fieldErrors: { project_id: ['not_allowed'] },
    })
  })

  it('requires idempotency locally and never persists the JWT', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, reports: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
    setProjectReportsAuthTokenProvider(async () => 'memory-only-jwt')

    await listProjectReports('p1')
    const headers = fetchMock.mock.calls[0][1].headers

    expect(headers.get('Authorization')).toBe('Bearer memory-only-jwt')
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)

    const isolated = createProjectReportsApi({ fetchImpl: fetchMock })
    await expect(isolated.createProjectReport('p1', {}, {})).rejects.toThrow(
      'idempotencyKey',
    )
  })

  it('builds an encoded same-origin CSV URL without a token query parameter', () => {
    const url = projectReportCsvUrl('project/1', 'report 1')
    expect(url).toBe('/api/ads/projects/project%2F1/reports/report%201/export.csv')
    expect(url).not.toContain('token')
  })

  it('asks only from a saved report identity and sends only the trimmed question', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      answer: {
        answerable: true,
        text: '訪問数は120です。',
        confidence: 'high',
        citations: [{ evidence_key: 'metric:sessions', title: '訪問数' }],
        reason: null,
      },
    }))
    const api = createProjectReportsApi({
      fetchImpl,
      getToken: vi.fn().mockResolvedValue('memory-only-token'),
    })

    const response = await api.askProjectReportQuestion(
      'project/one',
      'report one',
      '  訪問数はどうなっていますか  ',
    )

    expect(response.answer.answerable).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/ads/projects/project%2Fone/reports/report%20one/questions')
    expect(options).toMatchObject({ method: 'POST', cache: 'no-store' })
    expect(options.headers.get('Authorization')).toBe('Bearer memory-only-token')
    expect(JSON.parse(options.body)).toEqual({ question: '訪問数はどうなっていますか' })
    expect(options.body).not.toMatch(/report\.v2|evidence|dataset|token/i)
    expect(projectReportQuestionUrl('project/one', 'report one')).toBe(url)
  })

  it('rejects empty or oversized questions before making a request', async () => {
    const fetchImpl = vi.fn()
    const api = createProjectReportsApi({ fetchImpl })

    await expect(api.askProjectReportQuestion('p1', 'r1', '  ')).rejects.toThrow(
      'question must contain between 1 and 2000 characters',
    )
    await expect(api.askProjectReportQuestion('p1', 'r1', 'a'.repeat(2_001))).rejects.toThrow(
      'question must contain between 1 and 2000 characters',
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fetches a public share without credentials or an auth header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      share: { report: { schema_version: 'report.v2' } },
    }))
    const getToken = vi.fn().mockResolvedValue('must-not-be-used')
    const api = createProjectReportsApi({ fetchImpl, getToken })

    await api.fetchPublicReportShare('token/value')

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/ads/report-shares/token%2Fvalue')
    expect(options).toMatchObject({ method: 'GET', cache: 'no-store', credentials: 'omit' })
    expect(options.headers.get('Authorization')).toBeNull()
    expect(getToken).not.toHaveBeenCalled()
    expect(publicReportShareUrl('share token')).toBe('/api/ads/report-shares/share%20token')
  })
})
