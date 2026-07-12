import { describe, expect, it } from 'vitest'

import { apiErrorSearchText, normalizeApiError } from '../apiError'

describe('normalizeApiError', () => {
  it('reads the report.v2 public error envelope', () => {
    expect(normalizeApiError({
      ok: false,
      error: {
        code: 'project_forbidden',
        category: 'authorization',
        user_message: 'この案件を閲覧する権限がありません。',
        retryable: false,
        request_id: 'req_123',
        field_errors: { project_id: ['not_allowed'] },
      },
    }, 403)).toEqual({
      code: 'project_forbidden',
      category: 'authorization',
      message: 'この案件を閲覧する権限がありません。',
      retryable: false,
      requestId: 'req_123',
      fieldErrors: { project_id: ['not_allowed'] },
    })
  })

  it('keeps legacy detail and error_code compatible during migration', () => {
    const result = normalizeApiError({
      error_code: 'bq_credentials_missing',
      detail: '接続設定を確認してください。',
      retryable: false,
    }, 503)

    expect(result.code).toBe('bq_credentials_missing')
    expect(result.message).toBe('接続設定を確認してください。')
    expect(apiErrorSearchText({ error_code: result.code }, 503)).toContain('bq_credentials_missing')
  })

  it('never renders an object as [object Object]', () => {
    const result = normalizeApiError({ error: { code: 'internal_error' } }, 500)
    expect(result.message).not.toContain('[object Object]')
  })
})
