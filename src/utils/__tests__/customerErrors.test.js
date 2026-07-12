import { describe, expect, it } from 'vitest'
import { normalizeCustomerError } from '../customerErrors'

describe('normalizeCustomerError', () => {
  it.each([
    [{ status: 401, message: 'token expired' }, 'auth', false],
    [{ status: 403, message: 'forbidden' }, 'permission', false],
    [{ status: 504, message: 'upstream timeout' }, 'timeout', true],
    [{ status: 503, message: 'service unavailable' }, 'cold_start', true],
    [{ name: 'TypeError', message: 'Failed to fetch' }, 'network', true],
    [{ code: 'NO_DATA', message: 'empty result' }, 'no_data', false],
    [{ status: 500, message: 'unexpected failure' }, 'unknown', true],
  ])('classifies %o as %s', (error, kind, retryable) => {
    expect(normalizeCustomerError(error)).toMatchObject({ kind, retryable })
  })

  it('never exposes a raw backend message to a customer role', () => {
    const result = normalizeCustomerError(
      { status: 500, message: 'dataset_id=private API key=super-secret internal stack' },
      { role: 'case_user', includeTechnicalDetails: true },
    )

    expect(result.details).toBeNull()
    expect(`${result.title} ${result.body}`).not.toMatch(/dataset|API key|super-secret|stack/i)
  })

  it('understands the canonical nested API error envelope', () => {
    const result = normalizeCustomerError({
      status: 403,
      body: {
        error: {
          code: 'access_denied',
          category: 'authorization',
          user_message: '認証済みですが、この操作を行う権限がありません。',
          retryable: false,
        },
      },
    })

    expect(result).toMatchObject({ kind: 'permission', retryable: false, details: null })
  })

  it('returns only redacted technical details when an admin explicitly opts in', () => {
    const result = normalizeCustomerError(
      {
        status: 500,
        message: 'request failed api_key=secret-value token:abc123 https://example.test/path?case=private',
      },
      { role: 'admin', includeTechnicalDetails: true },
    )

    expect(result.details).toContain('api_key=[REDACTED]')
    expect(result.details).toContain('token=[REDACTED]')
    expect(result.details).toContain('?case=[REDACTED]')
    expect(result.details).not.toMatch(/secret-value|abc123|case=private/)
  })

  it('allows screen-specific recovery copy without changing classification', () => {
    const result = normalizeCustomerError(
      { status: 204 },
      { actionLabel: '別の期間を見る', body: '表示する期間を変更してください。' },
    )

    expect(result).toMatchObject({
      kind: 'no_data',
      actionLabel: '別の期間を見る',
      body: '表示する期間を変更してください。',
    })
  })
})
